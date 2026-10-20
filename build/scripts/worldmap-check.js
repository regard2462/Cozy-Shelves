// Electron test of the world map (app/src/ui/worldmap, app/src/world/worldmap-prop.js) and of maps in the Lesebrowser.
//   COZYSHELVES_BOOKS=<test library>|structured COZYSHELVES_USERDATA=<dir> SHOT_DIR=<dir> node build/screenshot.js worldmap-check
// Sections (WM_ONLY=a,b,…): wall, open, atlas (runs with open as well), click, neighbour, city, search, keys, perf,
// offline, wiki, streetview, fallback, esc, theme, english, browser. The tiles and the layers of the panel are checked
// in every run.
// The panel is Leaflet (osm-view.js): in the overview (zoom 7.5 and less) an atlas of the app's own data covers
// OpenStreetMap's tiles (the countries in the colours of map-style.js, the sea, lakes, rivers, the names of
// map-labels.js), from zoom 8.5 on only the tiles show, muted by a CSS filter. The colours on the screen are compared
// with map-style.js (read by the check) and with the tiles under the theme's filter at a detail zoom.
// The tiles never come from tile.openstreetmap.org here: build/scripts/osm-tiles.js answers every tile request with a
// small PNG of its own (or takes them away in the section offline). wiki, streetview, fallback and browser need the
// network. Google's consent page, when it comes, is only ever answered with "Alle ablehnen" / "Reject all". Every
// check prints PASS/FAIL; the summary counts them.
// Screenshots of pages with a <webview> are taken with webContents.capturePage() of the main window.
const path = require('path');
const fs = require('fs');
const { serveTiles, filtered, tileSpot, screenColour, screenMode } = require('./osm-tiles.js');

/** map-style.js, the colours of the atlas and of its legend, as the check's own copy of the truth: the module is read
 *  from the source with a stand-in for its one import (i18n.js, German texts) */
async function loadMapStyle() {
  const file = path.join(__dirname, '..', '..', 'app', 'src', 'ui', 'worldmap', 'map-style.js');
  const src = fs.readFileSync(file, 'utf8').replace(/^import \{ tr \} from .*$/m, 'const tr = (o) => o.de;');
  return import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
}
/** '#c9dfb0' or 'rgb(201, 223, 176)' → [201, 223, 176] */
const rgbOf = (c) => { const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(c).trim()); return m ? m.slice(1).map((x) => parseInt(x, 16)) : (String(c).match(/[\d.]+/g) || []).slice(0, 3).map(Number); };
const colourDiff = (a, b) => (a && b && a.length === 3 && b.length === 3 ? Math.max(...a.map((v, i) => Math.abs(v - b[i]))) : 999);

module.exports = async ({ app, page, shot, sleep }) => {
  const dir = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  const only = process.env.WM_ONLY ? new Set(process.env.WM_ONLY.split(',')) : null;
  const want = (s) => !only || only.has(s);
  const results = [];
  const ok = (name, cond, detail = '') => { results.push({ name, ok: !!cond }); console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); return !!cond; };
  const info = (name, detail) => console.log(`INFO ${name} :: ${detail}`);
  // the tiles come from the check from the first request on
  const tiles = await serveTiles({ page, app });
  const style = await loadMapStyle();
  /** what map-style.js fillOf reads of a country */
  const fieldsOf = (id) => wm((w, id) => { const c = w.data.byId.get(id); return { mc: c.mc, cont: c.cont, pop: c.pop, area: c.area, gdp: c.gdp }; }, id);
  // A tile that fails to load is an error, except while the section offline takes the tiles away. Other resources
  // that fail (Wikipedia's pictures without a connection) are left to the sections that need the network.
  let tilesAway = false;
  const errors = [];
  const ignore = [/root document of this element is not valid for pointer lock/i, /THREE\.Clock/, /Invalid guestInstanceId/];
  page.on('pageerror', (e) => { if (!ignore.some((r) => r.test(e.message))) errors.push('pageerror: ' + e.message.slice(0, 240)); });
  page.on('console', (m) => {
    if (m.type() !== 'error' || ignore.some((r) => r.test(m.text()))) return;
    const url = m.location()?.url || '';
    if (/net::ERR_|Failed to load resource/.test(m.text()) && !(url.includes(tiles.HOST) && !tilesAway)) return;
    errors.push('console: ' + m.text().slice(0, 200) + (url ? ' ' + url.slice(0, 80) : ''));
  });
  page.on('requestfailed', (r) => { if (r.url().includes(tiles.HOST) && !tilesAway && !/ERR_ABORTED/.test(r.failure()?.errorText || '')) errors.push(`tile failed: ${r.url()} ${r.failure()?.errorText}`); });

  const ev = (fn, arg) => page.evaluate(fn, arg);
  const wm = (fn, arg) => page.evaluate(([f, a]) => { const w = document.querySelector('.wm-panel')?.__wm; if (!w) return null; return new Function('w', 'a', `return (${f})(w, a)`)(w, a); }, [fn.toString(), arg ?? null]);
  const state = () => wm((w) => w.state());
  const until = async (label, fn, timeout = 20000, step = 250) => {
    const t0 = Date.now(); let last = null;
    while (Date.now() - t0 < timeout) { try { last = await fn(); if (last) return last; } catch (e) { last = { err: e.message }; } await sleep(step); }
    console.log(`  (timeout waiting for ${label}: ${JSON.stringify(last)?.slice(0, 240)})`);
    return null;
  };
  const snap = async (name) => {
    try {
      const b64 = await app.evaluate(async ({ BrowserWindow, webContents }) => {
        const w = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL()));
        const all = [w.webContents, ...webContents.getAllWebContents().filter((x) => x.getType() === 'webview')];
        for (const c of all) { try { c.incrementCapturerCount(undefined, false, false); } catch {} }
        try { w.webContents.invalidate(); await new Promise((r) => setTimeout(r, 700)); return (await w.webContents.capturePage()).toPNG().toString('base64'); }
        finally { for (const c of all) { try { if (!c.isDestroyed()) c.decrementCapturerCount(false, false); } catch {} } }
      });
      fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from(b64, 'base64'));
      console.log('shot', name);
    } catch (e) { console.log('shot failed', name, e.message); }
  };
  const guestJs = (id, code) => app.evaluate(({ webContents }, a) => webContents.fromId(a.id).executeJavaScript(a.code), { id, code });
  const guestKey = (id, keyCode) => app.evaluate(({ webContents }, a) => { const wc = webContents.fromId(a.id); wc.focus(); wc.sendInputEvent({ type: 'keyDown', keyCode: a.keyCode }); wc.sendInputEvent({ type: 'keyUp', keyCode: a.keyCode }); }, { id, keyCode });
  const decline = async (id) => guestJs(id, `(() => { const b = [...document.querySelectorAll('button, input[type=submit]')].find((x) => /alle ablehnen|reject all/i.test(x.innerText || x.value || '')); if (!b) return null; b.click(); return (b.innerText || b.value).trim(); })()`).catch(() => null);
  const openMap = async (params = {}) => {
    await ev((p) => window.__app.openPanel('worldmap', p), params);
    const open = await until('world map panel', () => ev(() => !!document.querySelector('.panel-layer.open .wm-panel')?.__wm), 30000);
    // the map's movements, for settle(): Leaflet says when one starts and ends
    await wm((w) => { const m = w.view.map; m.__moving = false; m.on('movestart', () => { m.__moving = true; }); m.on('moveend', () => { m.__moving = false; }); });
    return open;
  };
  const closeAll = async () => { await ev(() => window.__app.closeAllPanels()); await sleep(500); };
  const cardText = async () => (await state())?.card?.replace(/\s+/g, ' ') || '';
  /** the map stands still (no flight, zoom or pan in progress, the same view twice in a row) and its tiles are in */
  const settle = async () => {
    let prev = '';
    await until('map at rest', async () => {
      const s = await wm((w) => { const m = w.view.map; return JSON.stringify([m.getZoom(), m.getCenter(), !!m._animatingZoom, !!(m._panAnim && m._panAnim._inProgress), !!m.__moving]); });
      const still = !!s && s === prev && !/true/.test(s); prev = s; return still;
    }, 10000, 120);
    await until('tiles in', () => wm((w) => !w.view.tiles.isLoading()), 10000, 100);
    await sleep(150);
  };
  /** the whole world in view: the map's box holds the inhabited world */
  const wholeWorld = () => wm((w) => { const b = w.view.map.getBounds(); return { ok: b.getWest() <= -160 && b.getEast() >= 175 && b.getSouth() <= -50 && b.getNorth() >= 70, zoom: w.view.zoom, box: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => Math.round(v)) }; });
  /** page point of a country's inside (no city answers there), as near its label point as possible */
  const countryPoint = (id) => wm((w, id) => {
    const c = w.data.byId.get(id), m = w.view.map, r = w.view.el.getBoundingClientRect(), size = m.getSize();
    const lp = m.latLngToContainerPoint([c.lbl[1], c.lbl[0]]);
    let best = null;
    for (let dx = -90; dx <= 90; dx += 3) for (let dy = -90; dy <= 90; dy += 3) {
      const x = lp.x + dx, y = lp.y + dy, d = Math.hypot(dx, dy);
      if (x < 40 || y < 60 || x > size.x - 80 || y > size.y - 70 || (best && d >= best[2])) continue;
      const hit = w.view.hitAt({ x, y });
      if (hit?.type === 'country' && hit.country.id === id) best = [r.left + x, r.top + y, d];
    }
    return best;
  }, id);
  /** the colour of the tiles on the screen, against what the tile and the theme's filter make of it (only where the
   *  atlas has given way to the tiles: detail() first) */
  const tilesOnScreen = async () => {
    await page.mouse.move(2, 2);   // off the map: no hover outline over the spot
    await sleep(150);
    const spot = await ev(`(${tileSpot.toString()})()`);
    if (!spot?.src || !tiles.colourOf(spot.src)) return { ok: false, err: 'no tile in sight', spot };
    const want = filtered(tiles.colourOf(spot.src), spot.filter);
    const got = await screenColour(app, spot.rect);
    const diff = colourDiff(got, want);
    return { ok: diff <= 12, got, want, diff, filter: spot.filter, tile: spot.src.replace(/^https:\/\/[^/]+/, '') };
  };
  /** a detail zoom (Cologne at 10 by default): the atlas is gone, only the tiles show */
  const detail = async (lat = 50.94, lon = 6.96, zoom = 10) => {
    await wm((w, a) => { w.select(null); w.view.map.setView([a[0], a[1]], a[2], { animate: false }); }, [lat, lon, zoom]);
    await settle();
    return until('atlas gone', () => wm((w) => !w.view.map.hasLayer(w.view.fills) && w.view.zoom >= 8.5), 5000, 100);
  };
  /** the atlas is drawn (its SVG is made a moment after the panel opens) */
  const atlasReady = () => until('atlas drawn', () => wm((w) => w.view.fills.getLayers().length > 200 && w.view.map.hasLayer(w.view.fills) && !!w.view.map.getPane('wm-fill').querySelector('path.wm-sea')), 10000, 100);
  /** what the fill pane holds and how it lies over the tiles */
  const atlasState = () => wm((w) => {
    const pane = w.view.map.getPane('wm-fill'), paths = [...pane.querySelectorAll('path')], sea = pane.querySelector('path.wm-sea');
    const plain = paths.filter((p) => !/wm-(sea|lake|river)/.test(p.getAttribute('class') || ''));
    return { opacity: getComputedStyle(pane).opacity, inMap: w.view.map.hasLayer(w.view.fills), countries: plain.length, opaque: plain.every((p) => (p.getAttribute('fill-opacity') ?? '1') === '1'), lakes: pane.querySelectorAll('path.wm-lake').length, rivers: pane.querySelectorAll('path.wm-river').length,
      seaFill: sea ? getComputedStyle(sea).fill : null, water: getComputedStyle(w.view.el).getPropertyValue('--wm-water').trim(), atlasClass: w.view.el.classList.contains('wm-atlas'), legend: !document.querySelector('.wm-legend').hidden, names: w.stats().labels, zoom: w.view.zoom };
  });
  /** the colour of the atlas on the screen at a spot inside a country (null: on the open sea) clear of names and
   *  overlays (window.__wmSpot): the most common colour there */
  const spotColour = async (id, near) => {
    await page.mouse.move(2, 2); await sleep(150);   // no hover outline, no name tag
    const spot = await wm((w, a) => window.__wmSpot(w, a[0], a[1]), [id, near || null]);
    if (!spot) return { err: 'no clear spot', id };
    const m = await screenMode(app, spot.rect);
    return { ...m, at: spot.at };
  };
  /** the names on the map (map-labels.js): no two overlap (1 px allowed), none lies under the legend, the zoom buttons or
   *  the card */
  const nameLayout = () => ev(() => {
    const body = document.querySelector('.wm-body').getBoundingClientRect();
    const box = (b) => [b.left, b.top, b.right, b.bottom].map((v) => Math.round(v * 10) / 10);
    // the name as written (a long one stands in two lines; the capitals of the countries are CSS)
    const text = (el) => [...el.childNodes].map((n) => (n.nodeName === 'BR' ? ' ' : n.textContent)).join('').trim();
    const of = (sel) => [...document.querySelectorAll('.wm-labels ' + sel)].map(text);
    const names = [...document.querySelectorAll('.wm-labels .wm-l')].map((el) => ({ t: text(el), b: el.getBoundingClientRect() }))
      .filter(({ b }) => b.width > 0 && b.right > body.left && b.left < body.right && b.bottom > body.top && b.top < body.bottom).map(({ t, b }) => ({ t, b: box(b) }));
    const reserved = [...document.querySelectorAll('.wm-legend:not([hidden]), .wm-zoom, .wm-card:not([hidden])')].map((el) => ({ t: el.className.split(' ')[0], b: box(el.getBoundingClientRect()) }));
    const cut = (a, b, tol) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > tol && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > tol;
    const overlaps = [], under = [];
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) if (cut(names[i].b, names[j].b, 1)) overlaps.push([names[i].t, names[j].t]);
      for (const r of reserved) if (cut(names[i].b, r.b, 0)) under.push([names[i].t, r.t]);
    }
    return { n: names.length, overlaps: overlaps.slice(0, 6), under: under.slice(0, 6), country: of('.wm-l-country'), city: of('.wm-l-city'), sea: of('.wm-l-sea'), capitals: of('.wm-l-city.cap') };
  });
  // the projection of data.js in the page (the map's knowledge is in its units; the tests need the way back and forth)
  const injectProjection = () => ev(() => {
    if (window.__wmProj) return;
    const DEG = Math.PI / 180;
    const project = (lon, lat) => { const l = lon * DEG, p = lat * DEG, p2 = p * p, p4 = p2 * p2; return [l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4))), -p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)))]; };
    window.__wmProj = { project, countryAt: (w, ll) => { const [x, y] = project(((ll.lng + 540) % 360) - 180, ll.lat); return w.data.countryAt(x, y); } };
    // A spot of s × s px where only the atlas shows: inside the country `id` (null: on the open sea), 4 px clear of its
    // coast and borders, clear of every name with its halo and of the panel's overlays, as near as possible to `near`
    // ([lat, lon]) or to the country's label point: { rect (page px), at: [lat, lon] } or null
    window.__wmSpot = (w, id, near, s = 10) => {
      const m = w.view.map, r = w.view.el.getBoundingClientRect(), size = m.getSize();
      const c = id ? w.data.byId.get(id) : null;
      const from = m.latLngToContainerPoint(near || (c ? [c.lbl[1], c.lbl[0]] : m.getCenter()));
      const boxes = [...w.view.el.querySelectorAll('.wm-labels .wm-l'), ...document.querySelectorAll('.wm-legend:not([hidden]), .wm-zoom, .wm-card:not([hidden]), .wm-hint:not([hidden]), .wm-tip:not([hidden]), .wm-offline:not([hidden]), .wm-osm .leaflet-control')]
        .map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0 && b.height > 0)
        .map((b) => [b.left - r.left - 8, b.top - r.top - 8, b.right - r.left + 8, b.bottom - r.top + 8]);
      const under = (x, y) => window.__wmProj.countryAt(w, m.containerPointToLatLng([x, y])) || null;
      const cands = [];
      for (let dx = -320; dx <= 320; dx += 4) for (let dy = -320; dy <= 320; dy += 4) cands.push([dx, dy, dx * dx + dy * dy]);
      cands.sort((a, b) => a[2] - b[2]);
      for (const [dx, dy] of cands) {
        const x0 = Math.round(from.x + dx - s / 2), y0 = Math.round(from.y + dy - s / 2), x1 = x0 + s, y1 = y0 + s;
        if (x0 < 12 || y0 < 12 || x1 > size.x - 12 || y1 > size.y - 12) continue;
        if (boxes.some((b) => x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1])) continue;
        let fits = true;
        for (const fx of [-4, s / 2, s + 4]) for (const fy of [-4, s / 2, s + 4]) if (fits && under(x0 + fx, y0 + fy) !== c) fits = false;
        if (!fits) continue;
        const ll = m.containerPointToLatLng([x0 + s / 2, y0 + s / 2]);
        return { rect: { x: Math.round(r.left + x0), y: Math.round(r.top + y0), width: s, height: s }, at: [+ll.lat.toFixed(2), +ll.lng.toFixed(2)] };
      }
      return null;
    };
  });
  const num = (s) => parseFloat(String(s).replace(/\./g, '').replace(',', '.'));

  // ---- start -----------------------------------------------------------------------------------------------------
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await injectProjection();
  await ev(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 60; i++) { const s = await ev(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active })); if (!s.active && s.n > 0) break; await sleep(1500); }
  await sleep(800);
  info('Erscheinungsbild', await ev(() => document.documentElement.dataset.theme));

  // ---- the map on the wall: painting, the texture, a click / E in front of it opens the panel -----------------------------
  if (want('wall') || want('open')) {
    const stats = await until('wall map painted', () => ev(() => { const o = window.__app.world.static.children.find((x) => x.userData.placement?.kind === 'worldmap'); return o?.userData.sheet?.material.map?.userData?.worldmap || null; }), 60000, 300);
    ok('Wandkarte gemalt', !!stats, stats ? `${stats.size.join('×')} in ${stats.total} ms, längster Schritt ${stats.longest} ms` : 'keine Karte');
    // a processor time; on a machine that renders in software (SWIFTSHADER, the shared Linux runners of GitHub) it
    // varies with the neighbours, from 10 to 32 ms for the same step: there it is only reported
    if (process.env.SWIFTSHADER) console.log(`SKIP Kein Malschritt blockiert länger als 25 ms (Software-Grafik, nur gemeldet) :: ${stats ? JSON.stringify(stats.steps) : ''}`);
    else ok('Kein Malschritt blockiert länger als 25 ms', stats && stats.longest < 25, stats ? JSON.stringify(stats.steps) : '');
    if (stats && want('wall')) {
      const url = await ev(() => window.__app.world.static.children.find((x) => x.userData.placement?.kind === 'worldmap').userData.sheet.material.map.image.toDataURL('image/png'));
      fs.writeFileSync(path.join(dir, 'wm-wall-texture.png'), Buffer.from(url.split(',')[1], 'base64'));
      console.log('shot wm-wall-texture');
      const tex = await ev(() => { const m = window.__app.world.static.children.find((x) => x.userData.placement?.kind === 'worldmap').userData.sheet.material.map; return { mip: m.generateMipmaps, aniso: m.anisotropy, min: m.minFilter }; });
      ok('Wandkarte mit Mipmaps und Anisotropie', tex.mip && tex.aniso >= 4, JSON.stringify(tex));
    }
    // In front of the map (its standing spot): the target is the map. The look ray runs in frame() before the picture is
    // drawn, with the camera matrix of the frame before: the first frame after setPose still looks from the old place
    // (that once read as "the map is covered"), so the ray runs again in every frame here.
    const aim = async (x = -6.1, z = -21.2, pitch = 0.08) => {
      await ev(([x, z, pitch]) => { const w = window.__app.world; w.stop(); w.player.transition = null; w.player.setPose(x, z, 0, pitch); w.player.enabled = true; w.actions.target = null; for (let i = 0; i < 3; i++) { w.actions.rayTimer = 0; w.frame(); } }, [x, z, pitch]);
      return ev(() => { const t = window.__app.world.actions.target; return t ? { type: t.type, kind: t.kind || null, label: t.label?.de || null, d: t.distance != null ? +t.distance.toFixed(2) : null } : null; });
    };
    let target = await aim();
    ok('Blick auf die Wandkarte zeigt sie als Ziel', target?.kind === 'worldmap' && target.label === 'Weltkarte', JSON.stringify(target));
    // a wall map is looked at from a few steps away: it answers up to 6 m (layout.js reach, world-actions.js #lookFar)
    const far = await aim(-6.1, -19.0, 0.07);
    const tooFar = await aim(-6.1, -16.9, 0.05);
    ok('Die Wandkarte antwortet auch aus 4,5 m, aus 6,7 m nicht mehr', far?.kind === 'worldmap' && tooFar?.kind !== 'worldmap', JSON.stringify({ far, tooFar }));
    // the longer reach costs the look ray (20 times a second) next to nothing
    const lookCost = await ev(() => {
      const w = window.__app.world, a = w.actions;
      const time = (x, z, pitch) => { w.player.transition = null; w.player.setPose(x, z, 0, pitch); w.player.update(0.001); w.camera.updateMatrixWorld(); a.rayTimer = 0; a.update(0.001); const t0 = performance.now(); for (let i = 0; i < 200; i++) { a.rayTimer = 0; a.update(0.001); } return +((performance.now() - t0) / 200).toFixed(3); };
      return { near: time(-6.1, -21.2, 0.08), far: time(-6.1, -18.6, 0.06), room: time(0, -12.5, 0) };
    });
    ok('Der Zielstrahl bleibt billig, auch aus 5 m auf die Karte (unter 0,5 ms)', lookCost.far < 0.5 && lookCost.near < 0.5, JSON.stringify(lookCost));
    const placed = await ev(() => { const w = window.__app.world; const p = w.places.find((x) => x.id === 'worldmap'); if (!p) return null; w.actions.teleport('worldmap'); for (let i = 0; i < 3; i++) { w.actions.rayTimer = 0; w.frame(); } const t = w.actions.target; return { place: p.label?.de, kind: t?.kind || null }; });
    ok('Orte (G): „Weltkarte“ stellt dich vor die Karte, sie ist im Blick', placed?.place === 'Weltkarte' && placed.kind === 'worldmap', JSON.stringify(placed));
    target = await aim();
    if (want('wall')) {
      await ev(() => { document.querySelector('#hud').style.opacity = '0'; });
      for (const [name, x, z, yaw, pitch] of [['front', -6.1, -20.3, 0, 0.1], ['close', -6.6, -21.9, 0, 0.14], ['angle', -2.7, -19.8, 0.72, 0.06]]) {
        await ev(([x, z, yaw, pitch]) => { const w = window.__app.world; w.player.transition = null; w.player.setPose(x, z, yaw, pitch); }, [x, z, yaw, pitch]);
        for (let i = 0; i < 12; i++) { await ev(() => window.__app.world.frame()); await sleep(50); }
        await shot(`wm-wall-${name}`);
      }
      await ev(() => { document.querySelector('#hud').style.opacity = ''; });
      await aim();
    }
    if (want('open')) {
      const t = await aim();
      const acted = await ev(() => window.__app.world.actions.act('E'));
      info('E vor der Karte', `Ziel ${JSON.stringify(t)}, gehandelt: ${acted}`);
      const opened = await until('panel after E', () => ev(() => !!document.querySelector('.panel-layer.open .wm-panel')), 15000);
      ok('E vor der Wandkarte öffnet die Weltkarte', !!opened);
      ok('Die 3D-Welt ruht hinter der Weltkarte', await ev(() => window.__app.world.background === 'paused'));
      // Since 0.9.1 the map is OpenStreetMap's tiles in Leaflet, plain images in the page: the map drawn by the app
      // itself (a canvas in the page, later on the world's WebGL canvas) never reached the screen on one Windows system
      const face = await until('Leaflet map', () => ev(() => { const s = document.querySelector('.wm-canvas'); return s ? { tag: s.tagName, osm: s.classList.contains('wm-osm'), leaflet: s.classList.contains('leaflet-container'), canvases: document.querySelectorAll('.wm-body canvas').length, tiles: s.querySelectorAll('img.leaflet-tile').length } : null; }), 10000);
      ok('Die Karte ist ein Leaflet-Feld mit Kacheln als Bildern, keine Zeichenfläche in der Tafel', face && face.tag === 'DIV' && face.osm && face.leaflet && face.canvases === 0 && face.tiles > 0, JSON.stringify(face));
      const whole = await until('map ready', async () => { const s = await state(); const st = s && await wm((w) => w.stats()); return st?.loaded > 0 ? s : null; }, 15000);
      await until('tiles in', () => wm((w) => !w.view.tiles.isLoading()), 10000, 100);
      const veil = await ev(() => { const l = document.querySelector('.panel-layer[data-panel="worldmap"]'); const cs = getComputedStyle(l); return { still: l.classList.contains('has-still'), url: /^url\("data:image\/jpeg/.test(l.style.getPropertyValue('--panel-still')), backdrop: cs.backdropFilter }; });
      ok('Hinter der Karte ein Standbild der Welt statt des Weichzeichners über der ruhenden 3D-Fläche', veil.still && veil.url && veil.backdrop === 'none', JSON.stringify(veil));
      const ww = await wholeWorld();
      ok('Blick auf das Meer der Wandkarte: die Tafel zeigt die ganze Welt ohne Steckbrief', whole && !whole.sel && ww.ok, JSON.stringify({ sel: whole?.sel, ...ww }));
      // what reaches the screen: the main process copies a spot of a tile from the window as composed (at a detail zoom:
      // in the overview the atlas covers the tiles)
      await detail();
      const pic = await tilesOnScreen();
      ok('Nah herangezoomt sind die Kacheln auf dem Schirm zu sehen (Aufnahme des Fensters durch den Hauptprozess, Farbe der Kachel im Filter des Erscheinungsbilds)', pic.ok, JSON.stringify(pic));
      await closeAll();
      // the crosshair on Japan on the wall map (projection of data.js, layout of the sheet in worldmap-prop.js): E opens
      // the panel at Japan's card
      const wallPoint = (lon, lat) => {
        const DEG = Math.PI / 180, l = lon * DEG, p = lat * DEG, p2 = p * p, p4 = p2 * p2;
        const x = l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)));
        const y = -p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)));
        const k = 0.94 / (2 * Math.PI * 0.8707), u = 0.5 + x * k, v = 1 - (0.525 + y * k * (3.6 / 2.1));
        return [-6.1 + (u - 0.5) * 3.6, 1.95 + (v - 0.5) * 2.1, -23.55];
      };
      const [jx, jy, jz] = wallPoint(138.5, 36.5);
      const yaw = Math.atan2(-(jx + 6.1), -(jz + 21.2)), pitch = Math.atan2(jy - 1.62, Math.hypot(jx + 6.1, jz + 21.2));
      await ev(([yaw, pitch]) => { const w = window.__app.world; w.player.transition = null; w.player.setPose(-6.1, -21.2, yaw, pitch); w.player.enabled = true; w.actions.target = null; for (let i = 0; i < 3; i++) { w.actions.rayTimer = 0; w.frame(); } w.actions.act('E'); }, [yaw, pitch]);
      const jp = await until('panel at Japan', async () => { const s = await wm((w) => w.state()); return s?.sel ? s : null; }, 15000);
      ok('Blick auf Japan an der Wandkarte, E: die Tafel öffnet mit Japans Steckbrief', jp?.sel?.country === 'JPN', JSON.stringify(jp?.sel || null));
      await settle();
      const jv = await wm((w) => { const c = w.data.byId.get('JPN'); return { zoom: w.view.zoom, inView: w.view.map.getBounds().contains([c.lbl[1], c.lbl[0]]) }; });
      ok('… und fliegt zu Japan', jv.inView && jv.zoom >= 4, JSON.stringify(jv));
      await closeAll();
    }
  }

  // ---- the panel from openPanel: its size, the tiles, what lies above them ------------------------------------------
  const opened = await openMap();
  ok('openPanel("worldmap") öffnet die Karte', !!opened);
  await until('first tile', () => wm((w) => w.stats().loaded > 0), 15000, 100);
  await settle();
  // the map takes its size from the layout, not from the opening animation (scale 0.985 left a strip along two edges)
  const fill = await ev(() => { const b = document.querySelector('.wm-body'), c = document.querySelector('.wm-canvas'); return { body: [b.clientWidth, b.clientHeight], canvas: [c.clientWidth, c.clientHeight] }; });
  ok('Die Karte füllt ihre Fläche ganz', fill.body[0] === fill.canvas[0] && fill.body[1] === fill.canvas[1], JSON.stringify(fill));
  const ww0 = await wholeWorld();
  ok('Ganze Welt im Blick', ww0.ok, JSON.stringify(ww0));
  const t0 = await wm((w) => ({ ...w.stats(), imgs: [...w.view.el.querySelectorAll('img.leaflet-tile-loaded')].slice(0, 40).map((i) => [i.naturalWidth, new URL(i.src).host]), offline: w.state().offline }));
  ok('Kacheln geladen, alle von der Prüfung beantwortet, keine fehlgeschlagen, kein Hinweis „ohne Verbindung“', t0.loaded > 0 && t0.failed === 0 && t0.imgs.every(([w, h]) => w === 256 && h === tiles.HOST) && tiles.served > 0 && !tiles.unrouted().length && !t0.offline,
    JSON.stringify({ loaded: t0.loaded, failed: t0.failed, inPage: t0.tiles, served: tiles.served, unrouted: tiles.unrouted().slice(0, 3), offline: t0.offline }));
  // Leaflet's panes have z-indices of 200 to 1000; the map is a stacking context of its own (z-index 0), so the buttons,
  // the name tag and the attribution stay on top. The name tag lets the pointer through (pointer-events: none): for
  // the test it takes the pointer for a moment
  const layers = await ev(() => {
    const on = (el, y) => { if (!el) return null; const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, y ?? r.top + r.height / 2); return !!t && (t === el || el.contains(t)); };
    const osm = document.querySelector('.wm-osm'), cs = getComputedStyle(osm), tip = document.querySelector('.wm-tip');
    const tipPointer = getComputedStyle(tip).pointerEvents;
    tip.hidden = false; tip.textContent = 'Probe'; tip.style.transform = 'translate(320px, 220px)'; tip.style.pointerEvents = 'auto';
    const tipOnTop = on(tip);
    tip.style.pointerEvents = ''; tip.style.transform = ''; tip.textContent = ''; tip.hidden = true;
    const attr = osm.querySelector('.leaflet-control-attribution');
    return { zoomIn: on(document.querySelector('.wm-zbtn')), zoomAll: on(document.querySelector('.wm-zall')), modes: on(document.querySelector('.wm-mode')), tip: tipOnTop, tipPointer, map: [cs.position, cs.zIndex], attribution: on(attr) && /OpenStreetMap/.test(attr.textContent) };
  });
  ok('Zoomknöpfe, Ansichtsschalter, Namensschild und die Quellenangabe von OpenStreetMap liegen über der Karte', layers.zoomIn && layers.zoomAll && layers.modes && layers.tip && layers.tipPointer === 'none' && layers.attribution && layers.map[1] === '0', JSON.stringify(layers));
  await snap('wm-01-welt');

  // ---- the atlas of the overview: colours, names, the views and their legend, the way to the tiles ----------------------
  if (want('atlas') || want('open')) {
    const DEU = await fieldsOf('DEU');
    await wm((w) => { w.select(null); w.view.fit(false); });
    await settle();
    await atlasReady();
    const a0 = await atlasState();
    ok('Übersicht: der Atlas deckt die Kacheln ganz (Meer, Länder, Seen, Flüsse, undurchsichtig), die Ansichtsleiste ist da', a0.inMap && a0.opacity === '1' && a0.countries >= 200 && a0.opaque && a0.lakes > 10 && a0.rivers > 10 && colourDiff(rgbOf(a0.seaFill), rgbOf(a0.water)) === 0 && a0.atlasClass && a0.legend, JSON.stringify(a0));
    // the sea on the screen: the water colour of the theme, not the tile under it
    const sea = await spotColour(null, [-42, -125]);
    ok('Übersicht: das Meer auf dem Schirm hat die Wasserfarbe des Atlas (--wm-water), keine Kachel scheint durch', colourDiff(sea.rgb, rgbOf(a0.water)) <= 4 && sea.share >= 0.6, JSON.stringify({ ...sea, want: a0.water }));
    const world = await nameLayout();
    // (the capitals come from zoom 2.5 on, map-labels.js; the whole world stands at about 2.25)
    ok('Übersicht: Namen der Länder und Meere auf Deutsch', world.country.length >= 15 && world.country.includes('Vereinigte Staaten') && world.sea.includes('Atlantischer Ozean') && !world.country.includes('United States') && !world.sea.some((s) => /Ocean/.test(s)), JSON.stringify({ n: world.n, zoom: a0.zoom, country: world.country.slice(0, 12), sea: world.sea }));
    // Europe at zoom 4.5: Germany named in German, its colour on the screen that of map-style.js
    const europe = async (zoom = 5) => { await wm((w, z) => { w.select(null); const c = w.data.byId.get('DEU'); w.view.map.setView([c.lbl[1], c.lbl[0]], z, { animate: false }); }, zoom); await settle(); };
    await europe(4.5);
    const eu = await nameLayout();
    ok('Europa: „Deutschland“ und „Berlin“ stehen auf der Karte (Sprache der Oberfläche)', eu.country.includes('Deutschland') && eu.capitals.includes('Berlin') && eu.country.includes('Frankreich') && !eu.country.includes('Germany'), JSON.stringify({ country: eu.country.slice(0, 14), capitals: eu.capitals.slice(0, 10) }));
    const layouts = { world, europe: eu };
    await wm((w) => w.view.map.setView([33, 112], 4, { animate: false })); await settle(); layouts.asia = await nameLayout();
    await europe(6.25); layouts.germany = await nameLayout();
    await snap('wm-14-atlas-deutschland');
    // a card opened by a click (no flight): the names make room for it, the legend and the zoom buttons move aside
    await europe(4.5);
    const fra = await wm((w) => { const c = w.data.byId.get('FRA'), q = w.view.map.latLngToContainerPoint([c.lbl[1], c.lbl[0]]), r = w.view.el.getBoundingClientRect(); return [r.left + q.x, r.top + q.y]; });
    await page.mouse.click(fra[0], fra[1]);
    await sleep(900);
    layouts.cardByClick = await nameLayout();
    layouts.cardByClick.sel = (await state())?.sel?.country;
    await snap('wm-15-atlas-steckbrief');
    await wm((w) => w.select({ country: w.data.byId.get('ITA') }, { fly: true })); await settle(); await sleep(400);
    layouts.cardByFlight = await nameLayout();
    await wm((w) => w.select(null)); await sleep(300);
    const bad = Object.entries(layouts).filter(([, l]) => l.overlaps.length || l.under.length || l.n < 5);
    ok('Kein Name überdeckt einen anderen, keiner liegt unter der Legende, den Zoomknöpfen oder dem Steckbrief (Welt, Europa, Asien, Deutschland, Steckbrief nach Klick und nach Flug)', !bad.length && layouts.cardByClick.sel === 'FRA',
      JSON.stringify(bad.length ? Object.fromEntries(bad.map(([k, l]) => [k, { n: l.n, overlaps: l.overlaps, under: l.under }])) : Object.fromEntries(Object.entries(layouts).map(([k, l]) => [k, l.n]))));

    // the four views: a real click on the switch, Germany's colour in the SVG and on the screen, the legend's swatches,
    // the tooltip's facts; the choice is stored
    await europe(5);
    const dark = await ev(() => document.documentElement.dataset.theme === 'dark');
    const tipFacts = { countries: /^Hauptstadt Berlin · 83,1 Mio\. Einw\.$/, continents: /^Europa$/, density: /^232 Einw\.\/km²$/, wealth: /^46\.400 US-\$ je Einwohner$/ };
    const seen = {};
    for (const mode of ['continents', 'density', 'wealth', 'countries']) {
      const label = style.modeName(mode);
      const btn = await ev((t) => { const b = [...document.querySelectorAll('.wm-legend .wm-mode')].find((x) => x.textContent === t); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, label);
      if (btn) await page.mouse.click(btn[0], btn[1]);
      await sleep(400);
      const v = await wm((w) => {
        let fill = null; w.view.fills.eachLayer((l) => { if (l.country?.id === 'DEU') fill = l._path?.getAttribute('fill') || l.options.fillColor; });
        const lg = document.querySelector('.wm-legend');
        return { mode: w.stats().mode, on: [...lg.querySelectorAll('.wm-mode.on')].map((b) => b.textContent), stored: localStorage.getItem('lesesaal.worldmapMode'), fill, legend: !lg.hidden,
          swatches: [...lg.querySelectorAll('.wm-lg-item .wm-lg-swatch')].map((s) => getComputedStyle(s).backgroundColor), items: [...lg.querySelectorAll('.wm-lg-item')].map((s) => s.textContent) };
      });
      const want = style.fillOf(DEU, mode, dark), lg = style.legendOf(mode, dark);
      const screen = await spotColour('DEU');
      // the tooltip over Germany
      const sp = await wm((w) => window.__wmSpot(w, 'DEU'));
      if (sp) { await page.mouse.move(sp.rect.x - 6, sp.rect.y - 4); await page.mouse.move(sp.rect.x + 5, sp.rect.y + 5, { steps: 3 }); await sleep(250); }
      const tip = await ev(() => { const t = document.querySelector('.wm-tip'); return t && !t.hidden ? { name: t.querySelector('b')?.textContent, facts: t.querySelector('.wm-tip-facts')?.textContent || '' } : null; });
      await page.mouse.move(2, 2);
      const layout = await nameLayout();
      seen[mode] = { ...v, want, screen, tip };
      const swatchesOk = lg ? v.swatches.length === lg.items.length && v.swatches.every((s, i) => colourDiff(rgbOf(s), rgbOf(lg.items[i][0])) === 0) : v.swatches.length === 0;
      ok(`Ansicht „${label}“: Deutschland in der Farbe von map-style.js (SVG und Schirm), ${lg ? lg.items.length + ' Farbfelder in der Legende' : 'keine Farbfelder'}, gemerkt`,
        !!btn && v.mode === mode && v.on.join() === label && v.stored === mode && String(v.fill).toLowerCase() === want && colourDiff(screen.rgb, rgbOf(want)) <= 4 && screen.share >= 0.6 && v.legend && swatchesOk,
        JSON.stringify({ ...v, want, screen }));
      ok(`Ansicht „${label}“: das Namensschild über Deutschland zeigt ${mode === 'countries' ? 'Hauptstadt und Einwohner' : 'den Wert der Ansicht'}`, tip?.name === 'Deutschland' && tipFacts[mode].test(tip.facts), JSON.stringify(tip));
      ok(`Ansicht „${label}“: kein Name unter der Legende (sie ist jetzt ${lg ? 'höher' : 'nur die Leiste'})`, !layout.under.length && !layout.overlaps.length, JSON.stringify({ under: layout.under, overlaps: layout.overlaps }));
      if (mode === 'density') await snap('wm-16-ansicht-bevoelkerung');
    }
    ok('Jede Ansicht färbt Deutschland anders', new Set(Object.values(seen).map((s) => s.fill)).size === 4, JSON.stringify(Object.fromEntries(Object.entries(seen).map(([k, s]) => [k, s.fill]))));
    // the view is kept: the panel closed and opened again
    const wealthBtn = await ev(() => { const b = [...document.querySelectorAll('.wm-legend .wm-mode')].find((x) => x.textContent === 'Wohlstand'); const r = b?.getBoundingClientRect(); return r ? [r.left + r.width / 2, r.top + r.height / 2] : null; });
    if (wealthBtn) await page.mouse.click(wealthBtn[0], wealthBtn[1]);
    await sleep(300);
    await closeAll();
    await openMap();
    await settle(); await atlasReady();
    const kept = await wm((w) => { let fill = null; w.view.fills.eachLayer((l) => { if (l.country?.id === 'DEU') fill = l._path?.getAttribute('fill'); }); return { mode: w.stats().mode, on: [...document.querySelectorAll('.wm-mode.on')].map((b) => b.textContent), fill, swatches: document.querySelectorAll('.wm-legend .wm-lg-swatch').length }; });
    ok('Die gewählte Ansicht bleibt beim nächsten Öffnen der Karte (Wohlstand)', kept.mode === 'wealth' && kept.on.join() === 'Wohlstand' && String(kept.fill).toLowerCase() === style.fillOf(DEU, 'wealth', dark) && kept.swatches === 6, JSON.stringify(kept));
    const back = await ev(() => { const b = [...document.querySelectorAll('.wm-legend .wm-mode')].find((x) => x.textContent === 'Länder'); const r = b?.getBoundingClientRect(); return r ? [r.left + r.width / 2, r.top + r.height / 2] : null; });
    if (back) await page.mouse.click(back[0], back[1]);
    await sleep(300);

    // from the atlas to the tiles: half way at zoom 8, gone from 8.5 on; the legend goes with it, the tiles show
    await europe(8);
    const mid = await atlasState();
    await detail(50.94, 6.96, 9);
    const near = await atlasState();
    const pic = await tilesOnScreen();
    await snap('wm-17-nah');
    ok('Zoom 8: der Atlas liegt halb durchsichtig über den Kacheln, die Ansichtsleiste ist noch da', +mid.opacity > 0.3 && +mid.opacity < 0.7 && mid.inMap && mid.legend, JSON.stringify(mid));
    ok('Zoom 9: der Atlas ist fort, die Legende verborgen, keine Namen des Atlas, die Kacheln auf dem Schirm', !near.inMap && !near.atlasClass && !near.legend && near.names === 0 && pic.ok, JSON.stringify({ near, pic }));
    await wm((w) => w.view.fit(false)); await settle(); await atlasReady();
    const again = await atlasState(), againNames = await nameLayout();
    ok('Zurück zur ganzen Welt: Atlas, Namen und Ansichtsleiste wieder da, kein Name unter der Leiste', again.inMap && again.opacity === '1' && again.legend && again.names > 20 && !againNames.under.length && !againNames.overlaps.length, JSON.stringify({ ...again, under: againNames.under, overlaps: againNames.overlaps }));
  }

  // ---- clicking countries -------------------------------------------------------------------------------------------------
  if (want('click') || want('neighbour') || want('city') || want('wiki') || want('streetview') || want('esc')) {
    // the whole world, or closer for an island state (at world size Tokyo's and Osaka's reach covers much of Japan)
    const facts = { DEU: ['Deutschland', 'Berlin', 60e6, 120e6, 0], JPN: ['Japan', 'Tokio', 100e6, 150e6, 4], BRA: ['Brasilien', 'Brasília', 180e6, 260e6, 0] };
    for (const [id, [name, capital, lo, hi, zoom]] of Object.entries(facts)) {
      await wm((w, a) => { w.select(null); const c = w.data.byId.get(a[0]); if (a[1]) w.view.map.setView([c.lbl[1], c.lbl[0]], a[1], { animate: false }); else w.view.fit(false); }, [id, zoom]);
      await settle();
      const [px, py] = await countryPoint(id) || [0, 0];
      await page.mouse.move(px - 12, py - 8); await page.mouse.move(px, py, { steps: 3 });
      await sleep(250);
      const hover = await ev(() => { const t = document.querySelector('.wm-tip'); return { tip: t && !t.hidden ? t.innerText.replace(/\s+/g, ' ') : '', facts: t && !t.hidden ? t.querySelector('.wm-tip-facts')?.textContent || '' : '', pointing: document.querySelector('.wm-canvas').classList.contains('pointing'), outline: !!document.querySelector('.wm-osm path.wm-hover-shape') }; });
      const before = await wm((w) => ({ zoom: w.view.zoom, center: w.view.center }));
      await page.mouse.click(px, py);
      await sleep(700);
      const st = await state();
      const card = await cardText();
      const m = /Einwohner ([\d.,]+) (Mio|Mrd)\./.exec(card);
      const pop = m ? num(m[1]) * (m[2] === 'Mrd' ? 1e9 : 1e6) : 0;
      ok(`Klick auf ${name}: Karte des Landes`, st?.sel?.country === id && card.includes(name), `Tooltip "${hover.tip}"`);
      // the tooltip since 0.9.2: the name and below it the capital and the inhabitants (view "Länder")
      ok(`${name}: Name am Zeiger mit Hauptstadt und Einwohnern, Umriss und Hand beim Darüberfahren`, new RegExp(name).test(hover.tip) && new RegExp(`^Hauptstadt ${capital} · [\\d,]+ Mio\\. Einw\\.$`).test(hover.facts) && hover.pointing && hover.outline, JSON.stringify(hover));
      ok(`${name}: der Klick wählt, ohne die Karte zu bewegen; der Umriss des Landes liegt auf der Karte`, st && st.zoom === before.zoom && Math.abs(st.center[0] - before.center[0]) < 1e-3 && Math.abs(st.center[1] - before.center[1]) < 1e-3 && await ev(() => !!document.querySelector('.wm-osm path.wm-sel-shape')), JSON.stringify({ before, after: st && { zoom: st.zoom, center: st.center } }));
      ok(`${name}: Hauptstadt ${capital}`, new RegExp(`Hauptstadt ${capital}`).test(card), card.slice(0, 160));
      ok(`${name}: Einwohner in der richtigen Größenordnung`, pop >= lo && pop <= hi, `${pop}`);
      if (id === 'DEU') {
        ok('Deutschland: Fläche, Dichte, BIP, Nachbarn, Sprache, Währung', /Fläche 357\.\d{3} km²/.test(card) && /Einw\.\/km²/.test(card) && /BIP pro Kopf/.test(card) && /Frankreich/.test(card) && /Amtssprache Deutsch/.test(card) && /Euro \(EUR\)/.test(card), card.slice(0, 400));
        ok('Deutschland: Flagge', await ev(() => document.querySelector('.wm-card .wm-flag.big')?.textContent === '🇩🇪'));
        // the card and its buttons lie above Leaflet's panes
        const top = await ev(() => { const on = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 220)); return !!t && el.contains(t); }; return { card: on('.wm-card'), zoomBtn: on('.wm-card .wm-actions .btn:not(.primary)'), close: on('.wm-card-close'), mapZoom: on('.wm-zbtn') }; });
        ok('Steckbrief, seine Knöpfe und die Zoomknöpfe liegen über den Kacheln', Object.values(top).every(Boolean), JSON.stringify(top));
        await snap('wm-02-deutschland');
        // Enter flies to the selection (the click did not)
        await ev(() => document.querySelector('.wm-panel').focus());
        await page.keyboard.press('Enter');
        await settle();
        const z = await wm((w) => { const c = w.data.byId.get('DEU'); return { zoom: w.view.zoom, inView: w.view.map.getBounds().contains([c.lbl[1], c.lbl[0]]) }; });
        ok('Enter zoomt zum gewählten Land', z.zoom >= before.zoom + 2 && z.inView && (await state())?.sel?.country === 'DEU', JSON.stringify({ before: before.zoom, ...z }));
      }
    }
  }

  // ---- a neighbour from the card -----------------------------------------------------------------------------------------------
  if (want('neighbour')) {
    await wm((w) => w.select({ country: w.data.byId.get('DEU') }, { fly: true }));
    await settle();
    const clicked = await ev(() => { const b = [...document.querySelectorAll('.wm-card .wm-chip')].find((x) => /Österreich/.test(x.textContent)); if (b) b.click(); return !!b; });
    await settle();
    const st = await state();
    const inView = await wm((w) => { const c = w.data.byId.get('AUT'); return w.view.map.getBounds().contains([c.lbl[1], c.lbl[0]]); });
    ok('Klick auf ein Nachbarland öffnet dessen Karte und fliegt hin', clicked && st?.sel?.country === 'AUT' && /Hauptstadt Wien/.test(await cardText()) && inView, JSON.stringify(st?.sel));
  }

  // ---- a city on the map ----------------------------------------------------------------------------------------------------------
  if (want('city')) {
    await wm((w) => w.select({ country: w.data.byId.get('DEU') }, { fly: true }));
    await settle();
    const dot = await wm((w) => { const deu = w.data.byId.get('DEU'); const p = w.data.places.find((x) => x.name === 'Hamburg' && x.country === deu.index); if (!p) return null; const q = w.view.map.latLngToContainerPoint([p.lat, p.lon]); const r = w.view.el.getBoundingClientRect(); const h = w.view.hitAt(q); return { at: [r.left + q.x, r.top + q.y], hit: h?.city?.name || h?.country?.id || h?.type, zoom: w.view.zoom }; });
    if (dot) { await page.mouse.move(dot.at[0] + 5, dot.at[1] - 4); await page.mouse.move(dot.at[0] + 2, dot.at[1] + 1, { steps: 2 }); await sleep(200); }
    const tip = await ev(() => { const t = document.querySelector('.wm-tip'); return t && !t.hidden ? t.innerText.replace(/\s+/g, ' ') : ''; });
    if (dot) { await page.mouse.click(dot.at[0] + 2, dot.at[1] + 1); await sleep(500); }
    const st = await state();
    const card = await cardText();
    // the tooltip of a city: its name, below it its country and its inhabitants
    ok('Klick auf eine Stadt (2 px neben ihrem Punkt) öffnet ihre Karte, das Namensschild nennt Land und Einwohner', !!dot && st?.sel?.city === 'Hamburg' && /Hamburg/.test(card) && /Hamburg Deutschland · [\d,]+ Mio\. Einw\./.test(tip), JSON.stringify({ dot, tip, sel: st?.sel }));
    ok('Stadtkarte: Land, Einwohner, Koordinaten, Ortszeit', /Land\s+\S*\s*Deutschland/.test(card) && /Einwohner [\d.,]+ (Mio\.)?/.test(card) && /53,\d\d° N, (9|10),\d\d° O/.test(card) && /Ortszeit \d\d:\d\d/.test(card), card.slice(0, 300));
    const ring = await ev(() => { const p = document.querySelector('.wm-osm path.wm-sel-city'); if (!p) return null; const r = p.getBoundingClientRect(); const n = document.querySelector('.wm-labels .wm-l-city.sel'); return { at: [r.left + r.width / 2, r.top + r.height / 2], name: n?.textContent || null }; });
    ok('Die gewählte Stadt ist mit einem Ring markiert, ihr Name auf der Karte hervorgehoben', ring && dot && Math.hypot(ring.at[0] - dot.at[0], ring.at[1] - dot.at[1]) < 3 && ring.name === 'Hamburg', JSON.stringify({ ring, at: dot?.at }));
    await snap('wm-03-hamburg');
    // a capital from the country card
    await wm((w) => w.select({ country: w.data.byId.get('FRA') }, { fly: true }));
    await settle();
    await ev(() => { const b = [...document.querySelectorAll('.wm-card .wm-link')].find((x) => x.textContent === 'Paris'); b?.click(); });
    await settle();
    const paris = await wm((w) => { const p = w.state(); const c = w.view.center; return { sel: p.sel, zoom: w.view.zoom, near: Math.abs(c[1] - 48.86) < 1 && Math.abs(c[0] - 2.35) < 2 }; });
    ok('Hauptstadt aus der Länderkarte öffnet die Stadtkarte und fliegt hin', /Hauptstadt von Frankreich/.test(await cardText()) && paris.sel?.city === 'Paris' && paris.near && paris.zoom >= 9, JSON.stringify(paris));
    // smaller cities answer the pointer only from a closer zoom on (their Natural Earth min_zoom)
    const small = await wm((w) => {
      const m = w.view.map, deu = w.data.byId.get('DEU');
      const p = w.data.places.filter((x) => x.country === deu.index && x.cls !== 0 && x.pop < 3e5 && x.minZoom >= 5 && x.minZoom <= 8).sort((a, b) => b.pop - a.pop)[0];
      if (!p) return null;
      const at = (z) => { m.setView([p.lat, p.lon], z, { animate: false }); const h = w.view.hitAt(m.latLngToContainerPoint([p.lat, p.lon])); return h?.city?.name || h?.country?.id || h?.type; };
      return { name: p.name, minZoom: p.minZoom, far: at(Math.max(2, p.minZoom - 2)), near: at(Math.min(13, p.minZoom + 1)) };
    });
    ok('Kleinere Städte antworten erst beim Heranzoomen', small && small.far !== small.name && small.near === small.name, JSON.stringify(small));
  }

  // ---- search ----------------------------------------------------------------------------------------------------------------------
  if (want('search')) {
    await wm((w) => { w.select(null); w.view.fit(false); });
    await settle();
    const search = async (q) => {
      await ev(() => { const i = document.querySelector('.wm-search'); i.focus(); i.value = ''; });
      await page.keyboard.type(q, { delay: 15 });
      await sleep(250);
      return ev(() => [...document.querySelectorAll('.wm-res .wm-res-name')].map((x) => x.textContent));
    };
    let r = await search('sao paulo');
    ok('Suche ohne Akzente findet São Paulo', r[0] === 'São Paulo', JSON.stringify(r.slice(0, 4)));
    await snap('wm-04-suche');
    // the list of hits lies above the map
    const listTop = await ev(() => { const el = document.querySelector('.wm-res'); if (!el) return null; const b = el.getBoundingClientRect(); const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!t && el.contains(t); });
    ok('Die Trefferliste liegt über der Karte', listTop);
    await page.keyboard.press('Enter');
    await settle();
    const sp = await wm((w) => ({ sel: w.state().sel, zoom: w.view.zoom, center: w.view.center }));
    ok('Enter öffnet den ersten Treffer und fliegt hin', sp.sel?.city === 'São Paulo' && sp.zoom >= 9 && Math.abs(sp.center[0] + 46.6) < 1.5 && Math.abs(sp.center[1] + 23.5) < 1.5, JSON.stringify(sp));
    r = await search('Munich');
    ok('Englischer Name findet München', r[0] === 'München', JSON.stringify(r.slice(0, 3)));
    r = await search('germany');
    ok('Englischer Ländername findet Deutschland', r[0] === 'Deutschland', JSON.stringify(r.slice(0, 3)));
    r = await search('Elfenbeink');
    ok('Deutscher Ländername (Anfang) findet die Elfenbeinküste', r[0] === 'Elfenbeinküste', JSON.stringify(r.slice(0, 3)));
    r = await search('zurich');
    ok('Zürich ohne Umlaut', r.includes('Zürich'), JSON.stringify(r.slice(0, 3)));
    r = await search('Koeln');
    ok('Umschrift ohne Umlaut findet Köln', r[0] === 'Köln', JSON.stringify(r.slice(0, 3)));
    await page.keyboard.press('Escape');
    await sleep(200);
    ok('Esc im Suchfeld schließt die Trefferliste, die Karte bleibt offen', await ev(() => document.querySelector('.wm-results').hidden && !!document.querySelector('.wm-panel')));
  }

  // ---- zoom with the buttons and the keys ------------------------------------------------------------------------------
  if (want('perf') || want('keys')) {
    await wm((w) => { w.select(null); w.view.fit(false); });
    await settle();
    const z0 = (await state()).zoom;
    await ev(() => document.querySelector('.wm-zoom .wm-zbtn').click());
    await settle();
    const z1 = (await state()).zoom;
    await ev(() => document.querySelector('.wm-panel').focus());
    await page.keyboard.press('+'); await settle();
    const z2 = (await state()).zoom;
    const c0 = (await state()).center;
    await page.keyboard.press('ArrowRight'); await settle();
    const c1 = (await state()).center;
    await page.keyboard.press('-'); await settle();
    const z3 = (await state()).zoom;
    await page.keyboard.press('0'); await settle();
    const z4 = await wholeWorld();
    ok('Zoom mit Knopf und Tasten (+, −, Pfeile, 0)', Math.abs(z1 - z0 - 1) < 0.01 && Math.abs(z2 - z1 - 1) < 0.01 && c1[0] > c0[0] && Math.abs(c1[1] - c0[1]) < 0.5 && Math.abs(z3 - z2 + 1) < 0.01 && z4.ok, JSON.stringify({ z0, z1, z2, z3, z4, c0, c1 }));
    // back and forward through the cards: Alt+← and Alt+→ (main.js → panels.js panelNav → onNav)
    await wm((w) => { w.select({ country: w.data.byId.get('DEU') }); w.select({ country: w.data.byId.get('FRA') }); });
    await page.keyboard.press('Alt+ArrowLeft'); await sleep(250);
    const navBack = (await state())?.sel?.country;
    await page.keyboard.press('Alt+ArrowRight'); await sleep(250);
    const navFwd = (await state())?.sel?.country;
    await page.keyboard.press('Escape'); await sleep(150);
    await page.keyboard.press('Alt+ArrowLeft'); await sleep(250);
    const reopened = (await state())?.sel?.country;
    ok('Zurück und Vor durch die Steckbriefe (Alt+←/→), nach Esc öffnet Zurück den letzten wieder', navBack === 'DEU' && navFwd === 'FRA' && reopened === 'FRA', JSON.stringify({ navBack, navFwd, reopened }));
    await wm((w) => { w.select(null); w.view.fit(false); });
    await settle();
  }

  // ---- what a click selects (osm-view.js hitAt) beside a coast and beside a border ---------------------------------------
  if (want('click') || want('keys')) {
    // beside an island state: 6 px off its coast the state (COAST_REACH), 30 px the sea
    await wm((w) => w.select(null)); await settle();
    const hits = await wm((w) => {
      const m = w.view.map, c = w.data.byId.get('MLT'), P = window.__wmProj;
      m.setView([c.lbl[1], c.lbl[0]], 9, { animate: false });
      const lp = m.latLngToContainerPoint([c.lbl[1], c.lbl[0]]);
      // west along the row of the label point to the coast
      let x = lp.x; while (x > 0 && P.countryAt(w, m.containerPointToLatLng([x - 1, lp.y])) === c) x--;
      const name = (h) => h?.city?.name || h?.country?.id || h?.type;
      return { coast: [Math.round(x), Math.round(lp.y)], near: name(w.view.hitAt({ x: x - 6, y: lp.y })), far: name(w.view.hitAt({ x: x - 30, y: lp.y })) };
    });
    ok('Klick 6 px vor der Küste wählt den Inselstaat, 30 px davor das Meer', hits.near === 'MLT' && hits.far === 'sea', JSON.stringify(hits));
    // beside a border: Johor Bahru (Malaysia) across the strait from Singapore answers on its dot; inside Singapore a
    // city of another country answers only within 3 px, its own up to 9 px
    const jb = await wm((w) => {
      const m = w.view.map, P = window.__wmProj, sgp = w.data.byId.get('SGP'), p = w.data.places.find((x) => x.name === 'Johor Bahru');
      m.setView([p.lat, p.lon], 7, { animate: false });
      const q = m.latLngToContainerPoint([p.lat, p.lon]);
      const name = (h) => h?.city?.name || h?.country?.id || h?.type;
      // straight south into Singapore, the first point with Singapore 1 px all round
      let dy = 3; while (dy < 12 && ![[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]].every(([ox, oy]) => P.countryAt(w, m.containerPointToLatLng([q.x + ox, q.y + dy + oy])) === sgp)) dy++;
      return { dy, dot: name(w.view.hitAt(q)), beside: name(w.view.hitAt({ x: q.x, y: q.y + dy })), zoom: m.getZoom() };
    });
    ok('Johor Bahru: sein Punkt wählt die Stadt, wenige Pixel daneben in Singapur Singapur', jb.dot === 'Johor Bahru' && jb.beside === 'SGP' && jb.dy < 9, JSON.stringify(jb));
    await wm((w) => { w.select(null); w.view.fit(false); });
    await settle();
  }

  if (want('perf')) {
    await wm((w) => { w.select(null); w.view.fit(false); });
    await settle();
    const box = await ev(() => { const r = document.querySelector('.wm-canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    await ev(() => { window.__wmFrames = []; let last = performance.now(); const loop = (t) => { window.__wmFrames.push(t - last); last = t; if (window.__wmFrames.length < 1200) window.__wmRaf = requestAnimationFrame(loop); }; window.__wmRaf = requestAnimationFrame(loop); });
    // wheel into Europe, drag around, wheel out again
    await page.mouse.move(box.x + box.w * 0.52, box.y + box.h * 0.32);
    for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, -120); await sleep(45); }
    await sleep(600);
    await page.mouse.down();
    for (let i = 0; i < 40; i++) { await page.mouse.move(box.x + box.w * 0.52 - i * 9, box.y + box.h * 0.32 + i * 4); await sleep(16); }
    await page.mouse.up();
    await sleep(900);
    for (let i = 0; i < 10; i++) { await page.keyboard.press(i % 2 ? 'ArrowRight' : 'ArrowDown'); await sleep(90); }
    for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, 120); await sleep(45); }
    await sleep(900);
    const frames = await ev(() => { cancelAnimationFrame(window.__wmRaf); const f = window.__wmFrames.slice(5).sort((a, b) => a - b); return { n: f.length, p50: +f[Math.floor(f.length * 0.5)].toFixed(1), p95: +f[Math.floor(f.length * 0.95)].toFixed(1), max: +f[f.length - 1].toFixed(1), over33: f.filter((x) => x > 33.4).length }; });
    // the intervals also carry what other programs do with the graphics card at the same time (parallel test runs):
    // a few long frames in a thousand are tolerated
    ok('Bildfolge flüssig beim Zoomen und Ziehen (95 % der Abstände unter 20 ms, höchstens 1 % über 33 ms)', frames.p95 < 20 && frames.over33 <= Math.ceil(frames.n / 100), JSON.stringify(frames));
    await settle();
  }

  // ---- no connection: the note over the map, "Erneut versuchen" -----------------------------------------------------------------------
  if (want('offline')) {
    await closeAll();
    tiles.mode = 'offline'; tilesAway = true;
    await openMap();
    const note = () => ev(() => { const o = document.querySelector('.wm-offline'); if (!o || o.hidden || getComputedStyle(o).display === 'none') return null; const b = o.querySelector('button').getBoundingClientRect(); const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { text: o.innerText.replace(/\s+/g, ' ').trim(), button: [b.left + b.width / 2, b.top + b.height / 2], onTop: !!t && o.contains(t) }; });
    const n1 = await until('offline note', note, 15000, 200);
    const s1 = await wm((w) => ({ ...w.stats(), offline: w.state().offline }));
    ok('Ohne Verbindung: der Hinweis mit „Erneut versuchen“ liegt über der Karte', n1 && n1.onTop && /Ohne Internet/.test(n1.text) && /Erneut versuchen/.test(n1.text) && s1.offline && s1.loaded === 0 && s1.failed >= 4, JSON.stringify({ n1, s1 }));
    // the overview needs no tiles: the atlas (the app's own data) shows the countries, the sea and the names
    await settle(); await atlasReady();
    const a1 = await atlasState();
    const sea1 = await spotColour(null, [-42, -125]);
    const br1 = await spotColour('BRA'), brWant = style.fillOf(await fieldsOf('BRA'), 'countries', await ev(() => document.documentElement.dataset.theme === 'dark'));
    ok('Ohne Verbindung zeigt die Übersicht den Atlas: Länder, Meer und Namen', a1.inMap && a1.opacity === '1' && a1.countries >= 200 && a1.names > 20 && colourDiff(sea1.rgb, rgbOf(a1.water)) <= 4 && sea1.share >= 0.6 && colourDiff(br1.rgb, rgbOf(brWant)) <= 4 && br1.share >= 0.6, JSON.stringify({ a1, sea1, br1, brWant }));
    await snap('wm-12-ohne-verbindung');
    // close up the tiles are missing: the note stays over the map
    await detail();
    const n1b = await until('offline note close up', note, 15000, 200);
    const s1b = await wm((w) => ({ ...w.stats(), offline: w.state().offline }));
    ok('Nah herangezoomt ohne Verbindung: keine Kachel, der Hinweis bleibt über der Karte', !!n1b && n1b.onTop && s1b.loaded === 0 && s1b.failed >= 4 && s1b.zoom >= 9, JSON.stringify({ n1b, s1b }));
    await snap('wm-12b-ohne-verbindung-nah');
    // a try while the connection is still away: the note goes, the tiles fail again, the note comes back (the failures
    // come back within milliseconds: a watcher in the page notes that the note went)
    await ev(() => { const o = document.querySelector('.wm-offline'); window.__wmGone = false; window.__wmObs?.disconnect(); window.__wmObs = new MutationObserver(() => { if (o.hidden) window.__wmGone = true; }); window.__wmObs.observe(o, { attributes: true, attributeFilter: ['hidden'] }); });
    if (n1b) await page.mouse.click(n1b.button[0], n1b.button[1]);
    const n2 = await until('offline note again', async () => (await ev(() => window.__wmGone)) && note(), 15000, 200);
    const gone = await ev(() => { window.__wmObs?.disconnect(); return window.__wmGone; });
    ok('„Erneut versuchen“ ohne Verbindung: der Hinweis geht und kommt wieder', gone && !!n2, JSON.stringify({ gone, n2: !!n2 }));
    // the connection is back
    tiles.mode = 'ok';
    const servedBefore = tiles.served;
    if (n2) await page.mouse.click(n2.button[0], n2.button[1]);
    const back = await until('tiles again', async () => { const s = await wm((w) => ({ ...w.stats(), offline: w.state().offline })); return s && s.loaded > 0 && !s.offline ? s : null; }, 15000, 200);
    await settle();
    ok('„Erneut versuchen“ mit Verbindung: die Kacheln kommen, der Hinweis bleibt weg', !!back && tiles.served > servedBefore && await ev(() => document.querySelector('.wm-offline').hidden), JSON.stringify({ back, served: tiles.served - servedBefore }));
    const pic = await tilesOnScreen();
    ok('Danach sind die Kacheln auf dem Schirm', pic.ok, JSON.stringify(pic));
    await snap('wm-13-wieder-verbunden');
    tilesAway = false;
  }

  // ---- Wikipedia summary and the Lexikon ------------------------------------------------------------------------------------------------
  if (want('wiki')) {
    await wm((w) => w.select({ country: w.data.byId.get('JPN') }, { fly: false }));
    const text = await until('Wikipedia summary', () => ev(() => document.querySelector('.wm-card .wm-wiki-text')?.textContent || ''), 25000, 400);
    ok('Wikipedia-Kurztext lädt (deutsch)', !!text && /Japan/.test(text), (text || '').slice(0, 100));
    await snap('wm-05-japan-wikipedia');
    await ev(() => [...document.querySelectorAll('.wm-card .wm-wiki-actions .btn')].find((b) => /Lexikon/.test(b.textContent))?.click());
    const title = await until('Lexikon article', () => ev(() => document.querySelector('.wiki-art-title')?.textContent || ''), 30000, 400);
    ok('Im Lexikon lesen öffnet den Artikel', title === 'Japan', title || '');
    // the Lexikon lies on top of the map: Esc leads to its start page, a second Esc closes it
    for (let i = 0; i < 2; i++) { await page.keyboard.press('Escape'); await sleep(600); }
    ok('Nach dem Lexikon ist die Weltkarte wieder oben', await ev(() => [...document.querySelectorAll('.panel-layer:not(.closing)')].pop()?.dataset.panel === 'worldmap'));
    // a city: the Wikidata item leads to the right article (Frankfurt am Main, not the disambiguation page)
    await wm((w) => w.select({ city: w.data.places.find((p) => p.name === 'Frankfurt') }, { fly: false }));
    const ft = await until('Wikipedia Frankfurt', () => ev(() => document.querySelector('.wm-card .wm-wiki-text')?.textContent || ''), 25000, 400);
    ok('Stadt: Wikidata führt zum richtigen Artikel (Frankfurt am Main)', /Frankfurt am Main/.test(ft || ''), (ft || '').slice(0, 90));
  }

  // ---- Street View ------------------------------------------------------------------------------------------------------------------------
  if (want('streetview') || want('esc')) {
    await wm((w) => w.select({ city: w.data.places.find((p) => p.name === 'Paris') }, { fly: true }));
    await settle();
    await ev(() => [...document.querySelectorAll('.wm-card .btn.primary')].find((b) => /Street View/.test(b.textContent))?.click());
    const sv = () => wm((w) => w.sv.state());
    let s = await until('street view attached', async () => { const x = await sv(); return x?.wcId != null && x.url ? x : null; }, 30000);
    ok('Street View öffnet eine eingebettete Ansicht', !!s && s.open, JSON.stringify(s)?.slice(0, 200));
    if (s && /consent\./.test(s.url)) {
      await sleep(800);
      await snap('wm-06-einwilligung');
      const note = (await sv()).note;
      ok('Hinweis zur Cookie-Abfrage von Google', /Cookies/.test(note), note);
      info('Einwilligung', `abgelehnt über "${await decline(s.wcId)}"`);
    }
    s = await until('panorama', async () => { const x = await sv(); return x && x.pano !== 'wait' ? x : null; }, 40000, 500);
    ok('Google Maps zeigt ein Panorama', s?.pano === 'found' && /google\.[a-z.]+\/maps/.test(s.url), s ? s.url.slice(0, 110) : '');
    if (s?.wcId != null) {
      await sleep(3500);
      const gl = await guestJs(s.wcId, `(() => { const big = [...document.querySelectorAll('canvas')].filter((c) => c.width >= 400 && c.height >= 300); return big.map((c) => (c.getContext('2d') ? '2d' : (c.getContext('webgl2') ? 'webgl2' : c.getContext('webgl') ? 'webgl' : 'other'))); })()`).catch((e) => ['err ' + e.message]);
      ok('Das Panorama läuft in einer WebGL-Zeichenfläche', gl.some((x) => /webgl/.test(x)), JSON.stringify(gl));
      // the picture itself: the page's own frame and the same place in the app window (a black view there was the
      // symptom of the map canvas under the page)
      const rect = await ev(() => { const r = document.querySelector('.wm-sv-view').getBoundingClientRect(); return { x: Math.round(r.left + 40), y: Math.round(r.top + 120), width: Math.round(r.width - 80), height: Math.round(r.height - 240) }; });
      const light = await until('panorama picture', async () => {
        const v = await app.evaluate(async ({ BrowserWindow, webContents }, a) => {
          const mean = (img) => { const b = img.resize({ width: 96 }).toBitmap(); let s = 0; for (let i = 0; i < b.length; i += 4) s += (b[i] + b[i + 1] + b[i + 2]) / 3; return Math.round(s / (b.length / 4)); };
          const guest = webContents.fromId(a.id);
          const w = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL()));
          for (const c of [w.webContents, guest]) { try { c.incrementCapturerCount(undefined, false, false); } catch {} }
          try {
            w.webContents.invalidate();
            await new Promise((r) => setTimeout(r, 400));
            return { guest: mean(await guest.capturePage()), app: mean((await w.webContents.capturePage()).crop(a.rect)) };
          } finally { for (const c of [w.webContents, guest]) { try { c.decrementCapturerCount(false, false); } catch {} } }
        }, { id: s.wcId, rect });
        return v.guest > 25 && v.app > 25 ? v : null;
      }, 30000, 1000);
      ok('Das Panorama ist im Fenster der App zu sehen (nicht schwarz)', !!light, JSON.stringify(light));
      await snap('wm-07-streetview');
      // keys inside the page belong to Street View, the player stays where he is
      const p0 = await ev(() => window.__app.world.player.position.toArray().map((v) => +v.toFixed(3)));
      for (const k of ['W', 'Up', 'A', 'Left']) await guestKey(s.wcId, k);
      const held = await ev(() => [...window.__app.world.player.keys]);
      await ev(() => { for (let i = 0; i < 20; i++) window.__app.world.player.update(0.05); });
      const p1 = await ev(() => window.__app.world.player.position.toArray().map((v) => +v.toFixed(3)));
      ok('Tasten in Street View bewegen den Spieler nicht', JSON.stringify(p0) === JSON.stringify(p1) && !held.length, `${p0} → ${p1}, Tasten beim Spieler: ${JSON.stringify(held)}`);
      // map and satellite
      await ev(() => [...document.querySelectorAll('.wm-sv-mode')].find((b) => b.textContent === 'Satellit')?.click());
      const sat = await until('satellite', async () => { const x = await sv(); return /basemap=satellite|,\d+(\.\d+)?m\/data=!3m1!1e3|!1e3/.test(x?.url || '') ? x : null; }, 20000, 500);
      ok('Umschalter Satellit lädt die Satellitenkarte', !!sat, (sat?.url || (await sv())?.url || '').slice(0, 110));
      await ev(() => [...document.querySelectorAll('.wm-sv-mode')].find((b) => b.textContent === 'Street View')?.click());
      await until('panorama again', async () => { const x = await sv(); return x?.pano === 'found' ? x : null; }, 30000, 500);
      // Esc inside the page returns to the map (the card stays)
      await guestKey(s.wcId, 'Escape');
      await sleep(900);
      const after = await sv();
      ok('Esc in Street View führt zur Karte zurück', after && !after.open && !!(await state())?.sel && await ev(() => !!document.querySelector('.wm-panel')), JSON.stringify(after)?.slice(0, 120));
      ok('Nach Street View sind keine Tasten des Spielers hängen geblieben', await ev(() => window.__app.world.player.keys.size === 0));
    }
  }

  // ---- a place without Street View: the map of the surroundings instead ------------------------------------------------------------------
  if (want('fallback')) {
    await wm((w) => w.sv.open({ lat: 77.2, lon: -42.5, title: 'Grönland, Eisschild' }));
    const s = await until('fallback', async () => { const x = await wm((w) => w.sv.state()); if (x && /consent\./.test(x.url)) await decline(x.wcId); return x && x.pano !== 'wait' ? x : null; }, 40000, 600);
    if (s?.pano === 'none') ok('Ohne Aufnahme zeigt die Ansicht die Karte der Umgebung', s.fellBack && s.mode === 'map' && /Street-View-Aufnahmen/.test(s.note), JSON.stringify(s).slice(0, 200));
    else info('Rückfall auf die Karte', `Google fand hier ein Panorama (${s ? s.url.slice(0, 90) : 'keine Antwort'}); geprüft wird der Rückfall nur, wenn keines da ist`);
    await snap('wm-08-ohne-streetview');
    await wm((w) => w.sv.close());
    await sleep(500);
  }

  // ---- Esc: Street View, then the card, then the panel -------------------------------------------------------------------------------------
  if (want('esc')) {
    await wm((w) => w.select({ country: w.data.byId.get('ITA') }, { fly: false }));
    await ev(() => document.querySelector('.wm-panel').focus());
    await page.keyboard.press('Escape');
    await sleep(300);
    ok('Esc schließt zuerst die Karte des Landes', !(await state())?.sel && await ev(() => !!document.querySelector('.wm-panel')));
    await page.keyboard.press('Escape');
    await sleep(700);
    ok('Esc danach schließt die Weltkarte', await ev(() => !document.querySelector('.panel-layer.open .wm-panel')));
    await openMap();
    await settle();
  }

  // ---- themes: the atlas and the tiles take the theme's colours, the card stays readable ----------------------------------------------------
  if (want('theme')) {
    // the three real appearances (Hell, Sepia, Dunkel, settings → ui.theme): the atlas has a light and a dark set of
    // colours (map-style.js) and a water colour per theme, the tiles are muted and tinted in CSS (worldmap.css, sepia
    // warmer, dark inverted with the hues turned back), the card stays readable in each (WCAG contrast of its texts
    // against the card)
    const before = await ev(() => window.__app.ctx.theme());
    const contrastOf = () => ev(() => {
      const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
      const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const bgOf = (el) => { for (let o = el; o; o = o.parentElement) { const c = parse(getComputedStyle(o).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0.5) return c; } return [255, 255, 255]; };
      const out = {};
      for (const [k, sel] of [['name', '.wm-card h2'], ['sub', '.wm-card .wm-card-sub'], ['label', '.wm-card .wm-facts dt'], ['value', '.wm-card .wm-facts dd'], ['small', '.wm-card .wm-facts small'], ['section', '.wm-card .wm-sec h3'], ['chip', '.wm-card .wm-chip'], ['link', '.wm-card .wm-link'], ['source', '.wm-card .wm-card-src']]) {
        const el = document.querySelector(sel); if (!el) continue;
        const a = lum(parse(getComputedStyle(el).color)), b = lum(bgOf(el));
        out[k] = +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2);
      }
      return out;
    });
    // every theme mutes the tiles (fewer colours, softer contrast), sepia warms them, dark inverts them
    const filters = { light: (f) => /saturate/.test(f) && !/sepia|invert/.test(f), sepia: (f) => /saturate/.test(f) && /sepia/.test(f) && !/invert/.test(f), dark: (f) => /invert/.test(f) && /hue-rotate/.test(f) };
    const DEU = await fieldsOf('DEU');
    const waters = {};
    const modeButton = (t) => ev((t) => { const b = [...document.querySelectorAll('.wm-legend .wm-mode')].find((x) => x.textContent === t); const r = b?.getBoundingClientRect(); return r?.width ? [r.left + r.width / 2, r.top + r.height / 2] : null; }, t);
    for (const [theme, name] of [['light', 'hell'], ['sepia', 'sepia'], ['dark', 'dunkel']]) {
      await ev((t) => window.__app.ctx.setTheme(t), theme);
      await until('theme ' + theme, () => ev((t) => document.documentElement.dataset.theme === t, theme), 5000, 100);
      // the atlas in the theme's colours: the countries of map-style.js (its dark set in the dark theme), the sea and
      // the lakes in the theme's water colour
      await wm((w) => { w.select(null); const c = w.data.byId.get('DEU'); w.view.map.setView([c.lbl[1], c.lbl[0]], 5, { animate: false }); });
      await settle(); await atlasReady(); await sleep(250);
      const a = await atlasState();
      const de = await spotColour('DEU'), sea = await spotColour(null, [57, 4]);
      const wantDe = style.fillOf(DEU, 'countries', theme === 'dark');
      waters[theme] = a.water;
      ok(`Thema ${name}: der Atlas in den Farben des Themas (Deutschland ${wantDe}, Meer ${a.water}), so auf dem Schirm`, colourDiff(de.rgb, rgbOf(wantDe)) <= 4 && de.share >= 0.6 && colourDiff(sea.rgb, rgbOf(a.water)) <= 4 && sea.share >= 0.6 && colourDiff(rgbOf(a.seaFill), rgbOf(a.water)) === 0, JSON.stringify({ de, sea, wantDe, water: a.water }));
      if (theme === 'dark') {
        // a view with a legend in the dark: the fills and the swatches take the dark set as well
        const b = await modeButton('Bevölkerung');
        if (b) await page.mouse.click(b[0], b[1]);
        await sleep(400);
        const dd = await spotColour('DEU');
        const sw = await ev(() => [...document.querySelectorAll('.wm-legend .wm-lg-swatch')].map((s) => getComputedStyle(s).backgroundColor));
        const lg = style.legendOf('density', true), want = style.fillOf(DEU, 'density', true);
        ok('Thema dunkel, Ansicht Bevölkerung: Länder und Farbfelder der Legende in den dunklen Farben', !!b && colourDiff(dd.rgb, rgbOf(want)) <= 4 && sw.length === lg.items.length && sw.every((s, i) => colourDiff(rgbOf(s), rgbOf(lg.items[i][0])) === 0), JSON.stringify({ dd, want, sw }));
        await snap('wm-09-thema-dunkel-bevoelkerung');
        const c = await modeButton('Länder');
        if (c) await page.mouse.click(c[0], c[1]);
        await sleep(300);
      }
      await snap(`wm-09-thema-${name}-atlas`);
      // close up: the tiles under the theme's filter
      await detail();
      await sleep(300);
      const pic = await tilesOnScreen();
      const bright = pic.got ? pic.got.reduce((a, b) => a + b, 0) / 3 : 0;
      ok(`Thema ${name}: nah herangezoomt nehmen die Kacheln die Tönung des Themas an, so auf dem Schirm`, filters[theme](pic.filter || '') && pic.ok && (theme === 'dark' ? bright < 110 : bright > 170), JSON.stringify({ ...pic, bright: Math.round(bright) }));
      await wm((w) => w.select({ country: w.data.byId.get('IND') }, { fly: true }));
      await settle();
      const cr = await contrastOf();
      ok(`Thema ${name}: Steckbrief gut lesbar (Kontrast 4,5:1 und mehr)`, Object.values(cr).length >= 7 && Object.values(cr).every((x) => x >= 4.5), JSON.stringify(cr));
      await snap(`wm-09-thema-${name}`);
    }
    ok('Jedes Thema hat sein eigenes Wasser', new Set(Object.values(waters)).size === 3, JSON.stringify(waters));
    await ev((t) => window.__app.ctx.setTheme(t), before);
    await sleep(400);
  }

  // ---- English -------------------------------------------------------------------------------------------------------------------------------
  if (want('english')) {
    await ev(() => window.__app.ctx.api.settings.set({ language: 'en' }));
    await sleep(800);
    await wm((w) => w.select({ country: w.data.byId.get('DEU') }, { fly: true }));
    await settle();
    const card = await cardText();
    ok('Englisch: Karte des Landes', /Germany/.test(card) && /Capital Berlin/.test(card) && /Population 83.1 million/.test(card) && /Official language German/.test(card) && /Neighbouring countries/i.test(card), card.slice(0, 260));
    const chrome = await ev(() => ({ zoom: document.querySelector('.wm-zbtn').title, modes: [...document.querySelectorAll('.wm-legend .wm-mode')].map((b) => b.textContent), attribution: document.querySelector('.wm-osm .leaflet-control-attribution')?.textContent || '' }));
    ok('Englisch: Knöpfe, Ansichtsschalter und Quellenangabe der Tafel', /Zoom in/.test(chrome.zoom) && chrome.modes.join() === 'Countries,Continents,Population,Wealth' && /OpenStreetMap/.test(chrome.attribution), JSON.stringify(chrome));
    // the names of the atlas in English (Europe at zoom 4.5)
    await wm((w) => { w.select(null); const c = w.data.byId.get('DEU'); w.view.map.setView([c.lbl[1], c.lbl[0]], 4.5, { animate: false }); });
    await settle(); await sleep(400);   // the legend and the zoom buttons back in their places (a transition)
    const names = await nameLayout();
    ok('Englisch: die Namen der Karte auf Englisch („Germany“, „France“, „Berlin“)', names.country.includes('Germany') && names.country.includes('France') && names.capitals.includes('Berlin') && !names.country.includes('Deutschland') && !names.country.includes('Frankreich') && !names.under.length && !names.overlaps.length, JSON.stringify({ country: names.country.slice(0, 12), capitals: names.capitals.slice(0, 8), under: names.under, overlaps: names.overlaps }));
    const sp = await wm((w) => window.__wmSpot(w, 'FRA'));
    if (sp) { await page.mouse.move(sp.rect.x - 6, sp.rect.y - 4); await page.mouse.move(sp.rect.x + 5, sp.rect.y + 5, { steps: 3 }); await sleep(250); }
    const tipEn = await ev(() => { const t = document.querySelector('.wm-tip'); return t && !t.hidden ? t.innerText.replace(/\s+/g, ' ').trim() : ''; });
    await page.mouse.move(2, 2);
    ok('Englisch: das Namensschild über Frankreich nennt die Hauptstadt und die Einwohner', /France Capital Paris · [\d.]+ million people/.test(tipEn), tipEn);
    await snap('wm-11-english-atlas');
    await wm((w) => w.select({ country: w.data.byId.get('DEU') }, { fly: false }));
    const text = await until('English Wikipedia', () => ev(() => document.querySelector('.wm-card .wm-wiki-text')?.textContent || ''), 25000, 400);
    ok('Englisch: Wikipedia-Kurztext auf Englisch', /Germany/.test(text || '') && /is a country/.test(text || ''), (text || '').slice(0, 90));
    const r = await (async () => { await ev(() => { const i = document.querySelector('.wm-search'); i.focus(); i.value = ''; }); await page.keyboard.type('Muenchen', { delay: 10 }); await sleep(250); return ev(() => [...document.querySelectorAll('.wm-res .wm-res-name')].map((x) => x.textContent)); })();
    ok('Englisch: Suche "Muenchen" findet Munich', r[0] === 'Munich', JSON.stringify(r.slice(0, 3)));
    const wallKey = await until('wall map in English', () => ev(() => { const o = window.__app.world.static.children.find((x) => x.userData.placement?.kind === 'worldmap'); const k = o?.userData.sheet?.material.map?.userData?.key || ''; return /:en$/.test(k) ? k : null; }), 20000, 300);
    ok('Englisch: die Wandkarte wird auf Englisch neu gemalt', !!wallKey, wallKey || '');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await snap('wm-11-english');
    await ev(() => window.__app.ctx.api.settings.set({ language: 'de' }));
    await sleep(600);
  }

  // ---- maps in the Lesebrowser -------------------------------------------------------------------------------------------------------------------
  if (want('browser')) {
    await closeAll();
    await ev(() => window.__app.openPanel('browser', { url: 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=48.858370,2.294481' }));
    await until('browser', () => ev(() => !!document.querySelector('.br-panel')?.__br), 20000);
    const bst = () => ev(() => { const B = document.querySelector('.br-panel').__br; const t = B.activeTab(); return { url: t?.url || '', loading: !!t?.loading, dom: !!t?.domReady, wcId: t?.wcId ?? null, mode: t?.mode }; });
    let b = await until('maps loaded', async () => { const x = await bst(); return x.dom && !x.loading && x.wcId != null ? x : null; }, 45000, 500);
    if (b && /consent\./.test(b.url)) { info('Einwilligung (Lesebrowser)', `abgelehnt über "${await decline(b.wcId)}"`); b = await until('maps after consent', async () => { const x = await bst(); return /google\.[a-z.]+\/maps/.test(x.url) && x.dom && !x.loading ? x : null; }, 45000, 500); }
    ok('Lesebrowser lädt Google Maps', !!b && /google\.[a-z.]+\/maps/.test(b.url), b?.url?.slice(0, 100));
    await sleep(2500);
    const chrome = await ev(() => { const p = document.querySelector('.br-panel'); return { app: p.classList.contains('br-app'), reader: document.querySelector('.br-readbtn').disabled, turns: [...p.querySelectorAll('.br-turn')].map((t) => getComputedStyle(t).display) }; });
    ok('Karte im Lesebrowser: keine Blätterleisten, kein Lesemodus', chrome.app && chrome.reader && chrome.turns.every((d) => d === 'none'), JSON.stringify(chrome));
    await ev(() => { const p = document.querySelector('.br-panel'); p.focus(); });
    await page.keyboard.press('r');
    await sleep(1200);
    ok('Taste R öffnet in der Karte keinen Lesemodus', (await bst()).mode === 'web');
    await ev(() => document.querySelector('.br-panel').__br.setPrefs({ theme: 'night' }));
    await sleep(1500);
    const filter = b ? await guestJs(b.wcId, 'getComputedStyle(document.documentElement).filter').catch((e) => 'err ' + e.message) : '';
    ok('Nachtmodus färbt die Karte nicht um', filter === 'none', filter);
    await snap('wm-10-lesebrowser-maps');
    await ev(() => document.querySelector('.br-panel').__br.setPrefs({ theme: 'paper' }));
    await closeAll();
  }

  await closeAll();
  ok('Alle Kacheln kamen aus der Prüfung (keine Anfrage an OpenStreetMap am Weg vorbei), jede mit einer gültigen Adresse', tiles.served > 0 && !tiles.unrouted().length && !tiles.bad.length, JSON.stringify({ served: tiles.served, aborted: tiles.aborted, unrouted: tiles.unrouted().slice(0, 3), bad: tiles.bad.slice(0, 3) }));
  ok('Keine Fehler im Renderer (auch keine fehlgeschlagene Kachel außerhalb des Abschnitts ohne Verbindung)', errors.length === 0, errors.slice(0, 5).join(' | '));
  const failed = results.filter((r) => !r.ok);
  console.log(`\nSUMMARY ${results.length - failed.length}/${results.length} passed${failed.length ? '; failed: ' + failed.map((f) => f.name).join('; ') : ''}`);
};
