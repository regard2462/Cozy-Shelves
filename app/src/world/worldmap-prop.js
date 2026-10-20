// The world map on the wall of the book room (placement 'worldmap', opened like the other stations: E or a click
// opens the panel "Weltkarte"). A light oak frame with a narrow black steel slip around a paper map drawn from the
// same data as the panel (app/data/worldmap): warm paper, a muted blue sea with water lining along the coasts, soft
// country colours, borders, rivers, graticule, and the names of oceans, continents, large countries and capitals.
//
// The map is painted once per session and language into a canvas in short steps (no step blocks the main thread
// for long; worldMapStats() reports the times) and shared by every rebuild of the room. Until it is ready the frame
// shows plain paper. 3072 × 1792 pixels at high quality (2048 × 1195 otherwise), mipmapped, anisotropic.
import * as THREE from 'three';
import { Parts, boxGeo, planeGeo } from './geo.js';
import { M } from './materials.js';
import { loadWorld, project, outlinePoints, WORLD_W } from '../ui/worldmap/data.js';
import { i18n } from '../core/i18n.js';
import { bus } from '../core/bus.js';

const V = (x, y, z) => [x, y, z];
const PAPER = '#f3ecdf';
const INK = '#3d352c';
const SEA = '#c7d7dc';
const SEA_LINE = 'rgba(62, 104, 128, 0.55)';
const LAND = ['#e8dcbc', '#d8e0c1', '#ecd4c4', '#d2ded5', '#e4d6de', '#efe3c2', '#d9d3e3'];
// the world on the sheet: this share of its width, its middle at this share of its height (from the top)
const WORLD_SHARE = 0.94, WORLD_MID = 0.525;

const cache = { key: '', texture: null, promise: null, stats: null, spec: null };
const sheets = new Set();    // the map materials in the scene (a rebuild of the room disposes them and they leave)
const retired = new Set();   // paintings of another language or size, freed once no map shows them any more

/**
 * @param opts { w, h: size of the map sheet in metres (without the frame), quality: 'high'|'medium'|'low', anisotropy }
 */
export function worldMapProp({ w = 3.6, h = 2.1, quality = 'high', anisotropy = 8 } = {}) {
  const g = new THREE.Group(); g.name = 'worldmap';
  const oak = M.wood('oak', { contrast: 0.5 });
  const steel = M.blackMetal();
  const p = new Parts();
  const t = 0.06, d = 0.05, slip = 0.012;
  // oak frame (the vertical members run between the horizontal ones, nothing overlaps), a black steel slip inside it
  p.add(boxGeo(w + 2 * (t + slip), t, d), oak, V(0, h / 2 + slip + t / 2, 0));
  p.add(boxGeo(w + 2 * (t + slip), t, d), oak, V(0, -h / 2 - slip - t / 2, 0));
  p.add(boxGeo(t, h + 2 * slip, d), oak, V(-w / 2 - slip - t / 2, 0, 0));
  p.add(boxGeo(t, h + 2 * slip, d), oak, V(w / 2 + slip + t / 2, 0, 0));
  p.add(boxGeo(w + 2 * slip, slip, d * 0.7), steel, V(0, h / 2 + slip / 2, -d * 0.1));
  p.add(boxGeo(w + 2 * slip, slip, d * 0.7), steel, V(0, -h / 2 - slip / 2, -d * 0.1));
  p.add(boxGeo(slip, h, d * 0.7), steel, V(-w / 2 - slip / 2, 0, -d * 0.1));
  p.add(boxGeo(slip, h, d * 0.7), steel, V(w / 2 + slip / 2, 0, -d * 0.1));
  p.add(boxGeo(w + 2 * slip, h + 2 * slip, 0.012), M.plain(0xe9e2d4, { roughness: 0.95 }), V(0, 0, -d / 2 + 0.006));   // backing board
  g.add(p.build({ name: 'worldmap-frame' }));

  const spec = { size: quality === 'high' ? 3072 : 2048, aspect: w / h, anisotropy };
  const key = `${spec.size}:${i18n.lang}`;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0, map: cache.key === key && cache.texture ? cache.texture : placeholder(), emissive: 0xffffff, emissiveIntensity: 0.1 });
  mat.emissiveMap = mat.map;
  mat.userData.disposable = true; mat.userData.keepMap = true;   // the painted map outlives a rebuild of the room
  sheets.add(mat);
  mat.addEventListener('dispose', () => sheets.delete(mat));
  cache.spec = spec;
  const sheet = new THREE.Mesh(planeGeo(w, h), mat);
  sheet.position.z = -d / 2 + 0.0135;
  sheet.castShadow = false; sheet.receiveShadow = true;
  sheet.userData.wallMapSheet = { w, h };      // wallMapAim: where on the map a look ray hits it
  g.add(sheet);
  g.userData.footprint = null;
  g.userData.sheet = sheet;
  ensureMap(spec);
  return g;
}

/** The painting for the current language on every map in the scene (painted first when needed). */
function ensureMap(spec) {
  const key = `${spec.size}:${i18n.lang}`;
  if (cache.key === key && cache.texture) { applyMap(cache.texture); return; }
  paintWorldMap({ ...spec, key }).then((tex) => { if (tex && cache.key === key) applyMap(tex); }).catch((e) => console.warn('[worldmap] wall map not painted', e));
}
function applyMap(tex) {
  for (const m of sheets) if (m.map !== tex) { m.map = tex; m.emissiveMap = tex; }
  for (const old of retired) if (old !== tex) old.dispose();
  retired.clear();
}
// another language paints the map again; the room itself is not rebuilt for it
bus.on('i18n:change', () => { if (sheets.size && cache.spec) ensureMap(cache.spec); });

/**
 * Where a look ray met the painted map (a raycaster hit with uv, world-actions.js aimHit): [x, y] in the map's
 * coordinates (data.js), so the panel can open at the country looked at; null on the frame or without a hit. The
 * inverse of the layout in paintWorldMap (WORLD_SHARE, WORLD_MID; the canvas texture is flipped, v counts from the
 * bottom).
 */
export function wallMapAim(hit) {
  const sheet = hit?.object?.userData?.wallMapSheet;
  if (!sheet || !hit.uv) return null;
  const k = WORLD_SHARE / WORLD_W;            // sheet widths per world unit
  return [(hit.uv.x - 0.5) / k, (1 - hit.uv.y - WORLD_MID) * (sheet.h / sheet.w) / k];
}

/** Times of the last painting (for build/scripts/worldmap-check.js). */
export const worldMapStats = () => cache.stats;

let placeholderTex = null;
function placeholder() {
  if (placeholderTex) return placeholderTex;
  const c = document.createElement('canvas'); c.width = c.height = 4;
  const x = c.getContext('2d'); x.fillStyle = PAPER; x.fillRect(0, 0, 4, 4);
  placeholderTex = new THREE.CanvasTexture(c); placeholderTex.colorSpace = THREE.SRGBColorSpace;
  return placeholderTex;
}

// ------------------------------------------------------------------------------------------------- painting ------
const nextSlice = () => new Promise((r) => setTimeout(r, 0));

function paintWorldMap({ size, aspect, anisotropy, key }) {
  if (cache.key === key && cache.promise) return cache.promise;
  if (cache.texture) retired.add(cache.texture);
  cache.key = key; cache.texture = null;
  cache.promise = (async () => {
    const steps = [];
    const step = async (name, fn) => { const t0 = performance.now(); await fn(); steps.push([name, +(performance.now() - t0).toFixed(1)]); await nextSlice(); };
    const t0 = performance.now();
    const data = await loadWorld();
    try { await Promise.all(['600 60px "Cormorant Garamond"', 'italic 500 40px "Cormorant Garamond"', '600 30px "EB Garamond"'].map((f) => document.fonts.load(f))); } catch {}
    const W = size, H = Math.round(size / aspect);
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const de = i18n.lang !== 'en';
    // the world takes 94 % of the width; the band above it carries the title, the band below scale and source
    const k = (W * WORLD_SHARE) / WORLD_W;
    const ox = W / 2, oy = H * WORLD_MID;
    const sx = (x) => ox + x * k, sy = (y) => oy + y * k;
    const toPx = () => ctx.setTransform(k, 0, 0, k, ox, oy);
    const reset = () => ctx.setTransform(1, 0, 0, 1, 0, 0);
    const u = W / 3072;                                       // one "design pixel"
    const outline = new Path2D();
    outlinePoints(1).forEach(([x, y], i) => (i ? outline.lineTo(x, y) : outline.moveTo(x, y)));
    outline.closePath();
    const lines = (list, closed) => { const pth = new Path2D(); for (const r of list) { if (r.length < 4) continue; pth.moveTo(r[0], r[1]); for (let i = 2; i < r.length; i += 2) pth.lineTo(r[i], r[i + 1]); if (closed) pth.closePath(); } return pth; };
    const taken = [];
    const free = (x, y, w, h) => !taken.some((r) => x < r[0] + r[2] && x + w > r[0] && y < r[1] + r[3] && y + h > r[1]);
    const take = (x, y, w, h) => taken.push([x - 4 * u, y - 2 * u, w + 8 * u, h + 4 * u]);

    await step('paper', () => {
      ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
      // a fine paper grain from one small noise tile, and a faint darkening towards the edges
      const n = document.createElement('canvas'); n.width = n.height = 192;
      const nx = n.getContext('2d'), img = nx.createImageData(192, 192);
      let s = 7;
      for (let i = 0; i < img.data.length; i += 4) { s = (s * 16807) % 2147483647; const v = 110 + (s % 90); img.data[i] = v; img.data[i + 1] = v - 6; img.data[i + 2] = v - 16; img.data[i + 3] = 10 + (s % 14); }
      nx.putImageData(img, 0, 0);
      ctx.fillStyle = ctx.createPattern(n, 'repeat'); ctx.fillRect(0, 0, W, H);
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.62);
      vg.addColorStop(0, 'rgba(120, 95, 60, 0)'); vg.addColorStop(1, 'rgba(120, 95, 60, 0.10)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      // neat line: a thin and a fine line
      ctx.strokeStyle = INK; ctx.lineWidth = 3 * u; ctx.strokeRect(22 * u, 22 * u, W - 44 * u, H - 44 * u);
      ctx.lineWidth = 1.2 * u; ctx.strokeRect(32 * u, 32 * u, W - 64 * u, H - 64 * u);
    });
    await step('sea', () => {
      toPx();
      const g = ctx.createRadialGradient(0, 0, 0.3, 0, 0, 2.9);
      g.addColorStop(0, '#cddde1'); g.addColorStop(1, '#b9ced6');
      ctx.fillStyle = g; ctx.fill(outline);
      // water lining: the sea darkens in soft bands along every coast
      const coast = lines(data.coastArcs.map((i) => data.arcs[i]), false);
      ctx.save(); ctx.clip(outline);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (const [wpx, a] of [[26, 0.05], [15, 0.07], [7, 0.1]]) { ctx.strokeStyle = `rgba(52, 96, 122, ${a})`; ctx.lineWidth = wpx * u / k; ctx.stroke(coast); }
      ctx.restore();
      // graticule every 15°, equator and tropics a little stronger
      const grat = (lons, lats) => { const pth = new Path2D(); for (const lon of lons) { for (let lat = -90; lat <= 90; lat += 1) { const [x, y] = project(lon, lat); lat === -90 ? pth.moveTo(x, y) : pth.lineTo(x, y); } } for (const lat of lats) { for (let lon = -180; lon <= 180; lon += 1) { const [x, y] = project(lon, lat); lon === -180 ? pth.moveTo(x, y) : pth.lineTo(x, y); } } return pth; };
      const range = (a, b, s) => { const r = []; for (let v = a; v <= b; v += s) r.push(v); return r; };
      ctx.strokeStyle = 'rgba(60, 96, 118, 0.22)'; ctx.lineWidth = 1.2 * u / k; ctx.stroke(grat(range(-165, 165, 15), range(-75, 75, 15).filter((v) => v)));
      ctx.setLineDash([10 * u / k, 7 * u / k]); ctx.strokeStyle = 'rgba(60, 96, 118, 0.38)'; ctx.lineWidth = 1.6 * u / k;
      ctx.stroke(grat([0], [0, 23.44, -23.44, 66.56, -66.56])); ctx.setLineDash([]);
    });
    const countries = data.countries;
    for (let i = 0; i < countries.length; i += 50) {
      await step('land ' + i, () => {
        toPx();
        for (const c of countries.slice(i, i + 50)) { ctx.fillStyle = LAND[(c.mc - 1) % LAND.length]; ctx.fill(data.countryPath(c, true), 'evenodd'); }
      });
    }
    await step('water', () => {
      toPx();
      ctx.fillStyle = '#c8d8dd'; ctx.fill(lines(data.lakes, true), 'evenodd');
      ctx.strokeStyle = 'rgba(52, 96, 122, 0.55)'; ctx.lineWidth = 1 * u / k; ctx.stroke(lines(data.lakes, true));
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(70, 118, 150, 0.75)'; ctx.lineWidth = 1.5 * u / k;
      ctx.stroke(lines(data.rivers.filter((r) => r.rank <= 3).map((r) => r.line), false));
    });
    await step('lines', () => {
      toPx();
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(92, 72, 58, 0.7)'; ctx.lineWidth = 1.6 * u / k;
      ctx.stroke(lines(data.borderLines.map((b) => b.line), false));
      ctx.strokeStyle = SEA_LINE; ctx.lineWidth = 1.6 * u / k;
      ctx.stroke(lines(data.coastArcs.map((i) => data.arcs[i]), false));
      ctx.strokeStyle = INK; ctx.lineWidth = 3 * u / k; ctx.stroke(outline);
    });
    ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const txt = (s, x, y, font, color, spacing = '0px', halo = null, haloW = 0) => {
      ctx.font = font; ctx.letterSpacing = spacing;
      if (halo) { ctx.strokeStyle = halo; ctx.lineWidth = haloW; ctx.strokeText(s, x, y); }
      ctx.fillStyle = color; ctx.fillText(s, x, y);
    };
    const measure = (s, font, spacing) => { ctx.font = font; ctx.letterSpacing = spacing; return ctx.measureText(s).width; };
    // a label on the sea must lie inside the map's outline with both ends (canvas pixels, the path in world units)
    const inside = (x0, x1, y) => { ctx.save(); toPx(); const ok = ctx.isPointInPath(outline, x0, y) && ctx.isPointInPath(outline, x1, y); ctx.restore(); return ok; };
    // capitals of the larger countries (their rings are placed first, names keep clear of them)
    const caps = countries.filter((c) => c.lr <= 3 && c.area >= 180000).map((c) => data.places[c.cap?.[0]]).filter(Boolean);
    const R = 5 * u;
    await step('labels: title, continents', () => {
      reset();
      ctx.textAlign = 'center';
      txt(de ? 'Die Staaten der Erde' : 'The Countries of the World', W / 2, 78 * u, `600 ${58 * u}px "Cormorant Garamond", Georgia, serif`, INK, `${3 * u}px`);
      txt(de ? 'Politische Weltkarte · Projektion Natural Earth I' : 'Political map of the world · Natural Earth I projection', W / 2, 124 * u, `italic 500 ${26 * u}px "Cormorant Garamond", Georgia, serif`, '#6a5d4d', `${1 * u}px`);
      take(W / 2 - 520 * u, 40 * u, 1040 * u, 100 * u);
      for (const pl of caps) take(sx(pl.x) - R, sy(pl.y) - R, 2 * R, 2 * R);
      // continents in large, very pale, widely spaced letters under everything else (as in an atlas); Australia and
      // Antarctica are named as countries
      const conts = [[de ? 'NORDAMERIKA' : 'NORTH AMERICA', -99, 52], [de ? 'SÜDAMERIKA' : 'SOUTH AMERICA', -62, -30], [de ? 'EUROPA' : 'EUROPE', 16, 55],
        [de ? 'AFRIKA' : 'AFRICA', 18, 3], [de ? 'ASIEN' : 'ASIA', 98, 63]];
      for (const [s, lon, lat] of conts) {
        const [x0, y0] = project(lon, lat);
        txt(s, sx(x0), sy(y0), `600 ${62 * u}px "Cormorant Garamond", Georgia, serif`, 'rgba(92, 72, 50, 0.13)', `${(62 * u * 0.6).toFixed(1)}px`);
      }
    });
    // country names in spaced capitals, scaled with the country; a long name gets smaller until it fits. Placed in steps
    // of 20, the largest first: all of them in one step took up to 29 ms on a slow processor, a frame and more
    const names = countries.filter((c) => c.lr <= 4 && c.area > 250000).sort((a, b) => b.area - a.area);
    for (let i = 0; i < names.length; i += 20) await step('labels: countries ' + i, () => {
      reset();
      ctx.textAlign = 'center';
      for (const c of names.slice(i, i + 20)) {
        const name = (de ? c.de : c.en).toLocaleUpperCase(de ? 'de-DE' : 'en-GB');
        const bw = (c.bbox[2] - c.bbox[0]) * k;
        let px = Math.max(17, Math.min(40, Math.sqrt(c.area) / 60)) * u, font, spacing, tw;
        for (;;) {
          font = `600 ${px.toFixed(1)}px "Cormorant Garamond", Georgia, serif`; spacing = `${(px * 0.12).toFixed(1)}px`;
          tw = measure(name, font, spacing);
          if (tw <= bw * 1.1 || c.area >= 3e6 || px <= 15 * u) break;
          px *= 0.9;
        }
        if (tw > bw * 1.3 && c.area < 3e6) continue;
        for (const [dx, dy] of [[0, 0], [0, -1.4], [0, 1.4], [-0.2, 0], [0.2, 0]]) {
          const x = sx(c.label[0]) + dx * tw, y = sy(c.label[1]) + dy * px;
          if (!free(x - tw / 2, y - px / 2, tw, px)) continue;
          take(x - tw / 2, y - px / 2, tw, px);
          txt(name, x, y, font, 'rgba(61, 53, 44, 0.86)', spacing, 'rgba(243, 236, 223, 0.55)', 5 * u);
          break;
        }
      }
    });
    await step('labels: capitals', () => {
      reset();
      for (const pl of caps) {
        const x = sx(pl.x), y = sy(pl.y);
        const name = de ? pl.de : pl.en;
        const font = `500 ${17 * u}px "EB Garamond", Georgia, serif`;
        const tw = measure(name, font, '0px');
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fillStyle = PAPER; ctx.fill(); ctx.lineWidth = 2 * u; ctx.strokeStyle = INK; ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 1.8 * u, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
        for (const [dx, dy, al] of [[R + 5 * u, 0, 'left'], [-(R + 5 * u), 0, 'right'], [0, -(R + 12 * u), 'center'], [0, R + 12 * u, 'center']]) {
          const x0 = al === 'left' ? x + dx : al === 'right' ? x + dx - tw : x - tw / 2;
          if (!free(x0, y + dy - 10 * u, tw, 20 * u)) continue;
          take(x0, y + dy - 10 * u, tw, 20 * u);
          ctx.textAlign = al;
          txt(name, x + dx, y + dy + 1 * u, font, INK, '0px', 'rgba(243, 236, 223, 0.8)', 4 * u);
          break;
        }
      }
    });
    await step('labels: seas, scale', () => {
      reset();
      ctx.textAlign = 'center';
      // oceans and a few seas in italic letter-spaced blue
      const seas = [
        [de ? 'PAZIFISCHER OZEAN' : 'PACIFIC OCEAN', -140, 6, 30], [de ? 'PAZIFISCHER OZEAN' : 'PACIFIC OCEAN', 158, 18, 30],
        [de ? 'ATLANTISCHER OZEAN' : 'ATLANTIC OCEAN', -40, 27, 30], [de ? 'ATLANTISCHER OZEAN' : 'ATLANTIC OCEAN', -16, -24, 30],
        [de ? 'INDISCHER OZEAN' : 'INDIAN OCEAN', 78, -24, 30], [de ? 'NORDPOLARMEER' : 'ARCTIC OCEAN', 2, 80.5, 24],
        [de ? 'SÜDPOLARMEER' : 'SOUTHERN OCEAN', 60, -61, 24], [de ? 'Mittelmeer' : 'Mediterranean Sea', 18, 34.3, 17],
        [de ? 'Karibisches Meer' : 'Caribbean Sea', -75, 14.5, 17], [de ? 'Golf von Mexiko' : 'Gulf of Mexico', -90.5, 25, 16],
        [de ? 'Arabisches Meer' : 'Arabian Sea', 63, 14, 17], [de ? 'Golf von Bengalen' : 'Bay of Bengal', 88.5, 14.5, 16],
        [de ? 'Südchinesisches Meer' : 'South China Sea', 114, 12.5, 16], [de ? 'Beringmeer' : 'Bering Sea', -176, 57.5, 16],
        [de ? 'Tasmansee' : 'Tasman Sea', 161, -38, 16], [de ? 'Hudson Bay' : 'Hudson Bay', -86, 60, 15],
      ];
      for (const [s, lon, lat, sz] of seas) {
        const [x0, y0] = project(lon, lat);
        const px = sz * u, font = `italic 500 ${px}px "Cormorant Garamond", Georgia, serif`, spacing = `${(sz >= 24 ? 0.32 : 0.08) * px}px`;
        const tw = measure(s, font, spacing);
        const x = sx(x0), y = sy(y0);
        if (!free(x - tw / 2, y - px / 2, tw, px) || !inside(x - tw / 2, x + tw / 2, y)) continue;
        take(x - tw / 2, y - px / 2, tw, px);
        txt(s, x, y, font, 'rgba(46, 88, 112, 0.85)', spacing);
      }
      ctx.letterSpacing = '0px';
      // scale at the equator and the source, in the band below the map
      const kmPerPx = (2 * Math.PI * 6371.0088 * 0.8707) / (WORLD_W * k);
      const barKm = 5000, barPx = barKm / kmPerPx;
      const by = H - 68 * u, bx = 90 * u;
      ctx.fillStyle = INK; ctx.strokeStyle = INK; ctx.lineWidth = 2 * u;
      ctx.strokeRect(bx, by - 6 * u, barPx, 12 * u);
      for (let i = 0; i < 5; i += 2) ctx.fillRect(bx + i * barPx / 5, by - 6 * u, barPx / 5, 12 * u);
      ctx.textAlign = 'center';
      for (let i = 0; i <= 5; i++) txt((i * 1000).toLocaleString(de ? 'de-DE' : 'en-GB') + (i === 5 ? ' km' : ''), bx + i * barPx / 5 + (i === 5 ? 12 * u : 0), by - 24 * u, `500 ${16 * u}px "EB Garamond", Georgia, serif`, INK);
      ctx.textAlign = 'right';
      txt(de ? 'Maßstab am Äquator · Karte: Natural Earth (gemeinfrei)' : 'Scale at the equator · Map: Natural Earth (public domain)', W - 90 * u, by, `italic 500 ${17 * u}px "EB Garamond", Georgia, serif`, '#6a5d4d');
    });
    let tex = null;
    await step('texture', () => {
      tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.max(1, Math.min(16, anisotropy || 8));
      tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    });
    if (cache.key !== key) { tex.dispose(); return null; }     // the language changed again meanwhile
    cache.texture = tex;
    cache.stats = { size: [W, H], total: +(performance.now() - t0).toFixed(0), longest: Math.max(...steps.map((s) => s[1])), steps };
    tex.userData.worldmap = cache.stats;                      // the tests read the times from the texture
    tex.userData.key = key;
    return tex;
  })();
  cache.promise.catch(() => { cache.key = ''; cache.promise = null; });
  return cache.promise;
}
