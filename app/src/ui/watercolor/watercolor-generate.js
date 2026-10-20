// Procedural watercolor pictures: plans brush strokes for a motif (wet-in-wet washes first, progressively drier
// layers, salt-like blooms, dry-brush details) and runs them through the physical simulation (watercolor-sim.js).
// Importable without the panel; the 3D world uses generateWatercolor() at start-up for the paintings on the walls.
import { createWatercolorSim, PIGMENTS, pigmentFromColor } from './watercolor-sim.js';

export const MOTIFS = [
  { id: 'mountain-lake', de: 'Berge am See', en: 'Mountains by the lake' },
  { id: 'sunset-sea', de: 'Sonnenuntergang am Meer', en: 'Sunset over the sea' },
  { id: 'misty-forest', de: 'Wald im Nebel', en: 'Forest in the mist' },
  { id: 'meadow', de: 'Blumenwiese', en: 'Flower meadow' },
  { id: 'sailboat', de: 'Segelboot', en: 'Sailing boat' },
  { id: 'lavender', de: 'Lavendelfeld', en: 'Lavender field' },
  { id: 'rainy-city', de: 'Stadt im Regen', en: 'City in the rain' },
  { id: 'winter', de: 'Winterlandschaft', en: 'Winter landscape' },
  { id: 'lily-pond', de: 'Seerosenteich', en: 'Water-lily pond' },
  { id: 'haystacks', de: 'Heuhaufen im Abendlicht', en: 'Haystacks in evening light' },
  { id: 'lighthouse', de: 'Küste mit Leuchtturm', en: 'Coast with lighthouse' },
  { id: 'garden-path', de: 'Gartenweg', en: 'Garden path' },
];

const PI = Object.fromEntries(PIGMENTS.map((p, i) => [p.id, i]));
const { quinrose: ROSE, indianred: INDRED, cadyellow: YELLOW, hookers: HOOKER, cerulean: CERUL, ultramarine: ULTRA, burntsienna: SIENNA, paynes: PAYNE, sapgreen: SAP, ochre: OCHRE, alizarin: ALIZ, phthalo: PHTHALO } = PI;

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const tick = () => new Promise((r) => setTimeout(r, 0));

// shared offscreen simulations (one per simScale), generations are serialised
const shared = new Map();
let queue = Promise.resolve();
function sharedSim(w, h, simScale) {
  let s = shared.get(simScale);
  if (!s) { s = createWatercolorSim({ width: w, height: h, simScale, numPigmentTextures: 3, undoLevels: 0 }); shared.set(simScale, s); }
  else if (s.width !== w || s.height !== h) s.resize(w, h);
  return s;
}
let running = 0, disposeWhenIdle = false;
function freeShared() { for (const s of shared.values()) { try { s.destroy(); } catch (e) { console.warn('[watercolor] dispose', e); } } shared.clear(); }
/**
 * Frees the shared offscreen simulations (WebGL2 contexts). Safe to call from any consumer: while a generation
 * is still running the disposal is deferred until the queue has drained.
 */
export function disposeGenerator() {
  if (running > 0) { disposeWhenIdle = true; return; }
  disposeWhenIdle = false;
  freeShared();
}

// ---------------------------------------------------------------------------------------------------------------
// Painter: stroke planning helpers on top of the simulation API
// ---------------------------------------------------------------------------------------------------------------
function makePainter(sim, rng, W, H, quality, onProgress) {
  const u = W / 100;                                   // 1 unit = 1 % of the width
  let mask = null;                                     // (x, y) => true to protect an area (masking fluid)
  let stageBase = 0, stageSpan = 1;
  const jit = (a) => (rng() - 0.5) * 2 * a;
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const choose = (mix) => {                            // mix: [[pigment, load, weight?], …] | pigment
    if (typeof mix === 'number' || mix === null) return [mix, 1];
    let tot = 0; for (const m of mix) tot += m[2] ?? 1;
    let r = rng() * tot;
    for (const m of mix) { r -= m[2] ?? 1; if (r <= 0) return m; }
    return mix[mix.length - 1];
  };
  function dab(x, y, o) {
    if (x < -o.radius || y < -o.radius || x > W + o.radius || y > H + o.radius) return;
    if (mask && mask(x, y, o.radius)) return;
    sim.stroke({ x, y, ...o });
  }
  /** a small round scribble (several dabs) – a single dab would be too faint */
  function dot(x, y, o) { const r = o.radius * 0.35; for (let i = 0; i < 4; i++) { const a = i * 1.7 + rng(); dab(x + Math.cos(a) * r, y + Math.sin(a) * r, o); } }
  function strokeLine(x0, y0, x1, y1, o, spacing = 0.3) {
    const d = Math.hypot(x1 - x0, y1 - y0), step = Math.max(0.6, o.radius * spacing), n = Math.max(1, Math.ceil(d / step));
    const ang = Math.atan2(y1 - y0, x1 - x0);
    for (let i = 0; i <= n; i++) { const t = i / n; dab(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, { angle: ang, ...o }); }
  }
  const LOAD = 1.7;
  const opts = (o, [pig, load]) => ({ radius: o.radius * (0.85 + 0.3 * rng()), pigment: pig, water: o.water ?? 0.6, pressure: o.pressure ?? (0.5 + 0.4 * rng()), load: (o.load ?? 1) * load * LOAD, mode: o.mode, aspect: o.aspect, soft: o.soft, edgeNoise: o.edgeNoise });
  function intersections(poly, y) {
    const xs = [];
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) xs.push(x0 + (y - y0) / (y1 - y0) * (x1 - x0));
    }
    return xs.sort((a, b) => a - b);
  }
  const P = {
    u, W, H, rng, jit, pick, choose, setMask(fn) { mask = fn; }, dab, dot, strokeLine,
    rect: (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
    /** fills a polygon with horizontal (or vertical) strokes */
    fill(poly, o) {
      const r = o.radius, rowStep = r * (o.rowStep ?? 0.7);
      const ys = poly.map((p) => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const rows = [];
      for (let y = y0 + rowStep * 0.4; y < y1; y += rowStep) rows.push(y);
      if (o.shuffle) rows.sort(() => rng() - 0.5);
      const segLen = r * (o.segment ?? 7);
      for (const y of rows) {
        const xs = intersections(poly, y);
        for (let i = 0; i + 1 < xs.length; i += 2) {
          const t = (y - y0) / Math.max(1, y1 - y0);
          const wat = typeof o.water === 'function' ? o.water(t) : o.water;
          const a = xs[i] + jit(r * 0.4), b = xs[i + 1] + jit(r * 0.4);
          const yy = y + jit(r * 0.15);
          // the row is painted in segments; each segment takes a (new) colour from the mix, like re-loading the brush
          const nSeg = Math.max(1, Math.round(Math.abs(b - a) / segLen * (0.7 + 0.6 * rng())));
          const ltr = rng() < 0.5;
          for (let k = 0; k < nSeg; k++) {
            const mix = o.top && o.bottom ? (rng() > t ? o.top : o.bottom) : o.mix;
            const oo = opts({ ...o, water: wat }, choose(mix));
            const s0 = a + (b - a) * (k / nSeg), s1 = a + (b - a) * ((k + 1) / nSeg) + (k < nSeg - 1 ? r * 0.5 : 0);
            if (ltr) strokeLine(s0, yy, s1, yy + jit(r * 0.1), oo, 0.3); else strokeLine(s1, yy, s0, yy + jit(r * 0.1), oo, 0.3);
          }
        }
      }
    },
    /** vertical strokes inside a polygon (reflections) */
    fillV(poly, o) {
      const r = o.radius, colStep = r * (o.rowStep ?? 1.0);
      const xs0 = poly.map((p) => p[0]), x0 = Math.min(...xs0), x1 = Math.max(...xs0);
      const ys = poly.map((p) => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
      for (let x = x0 + colStep * 0.4; x < x1; x += colStep) {
        const c = choose(o.mix), oo = opts(o, c);
        const len = (y1 - y0) * (o.lenFrac ?? 1) * (0.6 + 0.4 * rng());
        strokeLine(x + jit(r * 0.4), y0, x + jit(r * 1.2), Math.min(y1, y0 + len), oo, 0.3);
      }
    },
    line(pts, o, spacing = 0.3) {
      const c = choose(o.mix ?? o.pigment ?? null), oo = opts(o, c);
      for (let i = 0; i + 1 < pts.length; i++) strokeLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], oo, spacing);
    },
    dots(n, poly, o) {
      const xs0 = poly.map((p) => p[0]), x0 = Math.min(...xs0), x1 = Math.max(...xs0);
      const ys = poly.map((p) => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
      let placed = 0, tries = 0;
      while (placed < n && tries++ < n * 8) {
        const x = x0 + rng() * (x1 - x0), y = y0 + rng() * (y1 - y0);
        const xs = intersections(poly, y); let inside = false;
        for (let i = 0; i + 1 < xs.length; i += 2) if (x >= xs[i] && x <= xs[i + 1]) inside = true;
        if (!inside) continue;
        const c = choose(o.mix ?? null), oo = opts(o, c);
        const rr = oo.radius * (o.sizeAt ? o.sizeAt((y - y0) / Math.max(1, y1 - y0)) : 1);
        if (o.len) strokeLine(x, y, x + jit(o.len), y + jit(o.len * 0.4), { ...oo, radius: rr }, 0.35); else dot(x, y, { ...oo, radius: rr });
        placed++;
      }
    },
    /** ridge line polygon from left to right: heights between yMin (peaks) and yMax (base), closed at yBase */
    ridge(yMin, yMax, yBase, peaks = 5, jag = 0.5) {
      const pts = [[-u * 2, yMax]];
      const n = peaks * 2 + 1; let x = -u * 2;
      for (let i = 1; i < n; i++) {
        x += (W + u * 4) / (n - 1) * (0.6 + 0.8 * rng());
        const peak = i % 2 === 1;
        const y = peak ? yMin + (yMax - yMin) * rng() * 0.5 : yMax - (yMax - yMin) * rng() * 0.35;
        pts.push([x, y]);
        if (jag > 0 && peak) pts.push([x + u * (1 + 2 * rng()), y + (yMax - yMin) * jag * 0.25 * rng()]);
      }
      pts.push([W + u * 2, yMax], [W + u * 2, yBase], [-u * 2, yBase]);
      return pts;
    },
    /** rough tree crown polygon */
    blob(cx, cy, rx, ry, n = 10, rough = 0.25) { const p = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; const k = 1 + jit(rough); p.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]); } return p; },
    conifer(cx, base, h, w) { return [[cx, base - h], [cx + w * 0.5, base], [cx - w * 0.5, base]]; },
    async settle(n) { const total = Math.max(1, Math.round(n * quality)); for (let i = 0; i < total; i += 25) { sim.step(Math.min(25, total - i)); await tick(); } },
    dry() { sim.dry(); },
    async stage(frac, label) { onProgress?.(stageBase + stageSpan * Math.min(1, frac), label); await tick(); },
    setStageWindow(base, span) { stageBase = base; stageSpan = span; },
  };
  return P;
}

// ---------------------------------------------------------------------------------------------------------------
// Motifs
// ---------------------------------------------------------------------------------------------------------------
const SKY = { warm: [[CERUL, 0.7, 2], [ULTRA, 0.5, 1]], pale: [[OCHRE, 0.25, 1], [ROSE, 0.25, 1], [CERUL, 0.3, 1]] };

async function skyWash(P, y1, o = {}) {
  const { W, u } = P;
  P.fill(P.rect(-u, -u, W + u, y1), { top: o.top || SKY.warm, bottom: o.bottom || SKY.pale, water: 0.95, radius: 4.5 * u, load: o.load ?? 0.8, rowStep: 0.8 });
  if (o.clouds !== false) P.dots(o.clouds ?? 5, P.rect(u * 5, y1 * 0.15, W - u * 5, y1 * 0.7), { mix: null, water: 1, radius: 4 * u, len: 8 * u, pressure: 1 });
}

const MOTIF_FNS = {
  async 'mountain-lake'(P) {
    const { W, H, u, rng } = P;
    const hor = H * (0.52 + 0.08 * rng());
    await P.stage(0.02, 'sky');
    await skyWash(P, hor * 1.02);
    await P.settle(70); P.dry();
    await P.stage(0.25, 'mountains');
    P.fill(P.ridge(hor * 0.45, hor * 0.82, hor + u, 5, 0.9), { mix: [[ULTRA, 0.7, 2], [ROSE, 0.4, 1], [CERUL, 0.4, 1]], water: 0.8, radius: 2.2 * u, load: 0.9 });
    await P.settle(40);
    P.fill(P.ridge(hor * 0.66, hor * 0.96, hor + u, 3, 0.8), { mix: [[PAYNE, 1, 2], [ULTRA, 0.8, 1], [SIENNA, 0.5, 1]], water: 0.6, radius: 2 * u, load: 1.3 });
    P.dots(14, P.ridge(hor * 0.7, hor * 0.95, hor, 3, 0), { mix: null, water: 1, radius: 1.2 * u });   // salt-like blooms
    await P.settle(80); P.dry();
    await P.stage(0.5, 'lake');
    const lakeBottom = H * 0.84;
    P.fill(P.rect(-u, hor, W + u, lakeBottom), { top: [[CERUL, 0.6, 2], [ULTRA, 0.5, 1]], bottom: [[ULTRA, 0.8, 2], [PHTHALO, 0.5, 1]], water: 0.9, radius: 3 * u, load: 0.7 });
    P.fillV(P.rect(0, hor + u, W, hor + H * 0.14), { mix: [[PAYNE, 0.4, 2], [ULTRA, 0.4, 1], [ROSE, 0.3, 1]], water: 0.9, radius: 1.4 * u, load: 0.25, rowStep: 2.4, lenFrac: 0.8 });
    await P.settle(70); P.dry();
    await P.stage(0.72, 'shore');
    P.fill(P.rect(-u, lakeBottom - u, W + u, H + u), { mix: [[SAP, 0.9, 2], [SIENNA, 0.7, 1], [OCHRE, 0.6, 1]], water: 0.55, radius: 2.5 * u, load: 1 });
    const nTrees = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < nTrees; i++) { const cx = (rng() < 0.5 ? rng() * 0.25 : 0.75 + rng() * 0.25) * W; const hgt = H * (0.16 + 0.14 * rng()); P.fill(P.conifer(cx, lakeBottom + u * 2, hgt, hgt * 0.45), { mix: [[HOOKER, 1.2, 2], [PAYNE, 0.9, 1]], water: 0.35, radius: 0.8 * u, load: 1.2, rowStep: 0.5, segment: 30 }); }
    await P.settle(40);
    for (let i = 0; i < 6; i++) { const y = hor + (lakeBottom - hor) * (0.2 + 0.8 * rng()); P.line([[u * (5 + 30 * rng()), y], [u * (40 + 55 * rng()), y + P.jit(u * 0.3)]], { pigment: ULTRA, water: 0.08, radius: 0.55 * u, load: 0.25, mode: 'dry' }); }
    await P.settle(40); P.dry();
  },

  async 'sunset-sea'(P) {
    const { W, H, u, rng } = P;
    const hor = H * (0.55 + 0.08 * rng());
    const sun = { x: W * (0.3 + 0.4 * rng()), y: hor - H * (0.06 + 0.1 * rng()), r: u * (4 + 2.5 * rng()) };
    P.setMask((x, y, r) => Math.hypot(x - sun.x, y - sun.y) < sun.r + r * 0.7);
    await P.stage(0.02, 'sky');
    P.fill(P.rect(-u, -u, W + u, hor + u), { top: [[ULTRA, 0.7, 2], [ROSE, 0.5, 1]], bottom: [[YELLOW, 0.7, 2], [ROSE, 0.5, 1], [OCHRE, 0.4, 1]], water: 0.95, radius: 4.5 * u, load: 0.9, rowStep: 0.8 });
    P.dots(4, P.rect(u * 5, hor * 0.1, W - u * 5, hor * 0.5), { mix: [[ALIZ, 0.5], [ROSE, 0.5]], water: 0.9, radius: 3 * u, len: 12 * u, aspect: 0.35 });
    await P.settle(80); P.dry();
    P.setMask(null);
    await P.stage(0.35, 'sea');
    P.fill(P.rect(-u, hor, W + u, H + u), { top: [[ROSE, 0.5, 1], [YELLOW, 0.5, 1], [ULTRA, 0.6, 2]], bottom: [[ULTRA, 1, 2], [PHTHALO, 0.8, 2], [ALIZ, 0.4, 1]], water: 0.85, radius: 3 * u, load: 0.8 });
    for (let i = 0; i < 12; i++) { const y = hor + (H - hor) * rng() * 0.6; P.line([[sun.x + P.jit(u * 6), y], [sun.x + P.jit(u * 10), y]], { pigment: null, water: 1, radius: 1.2 * u }); }
    await P.settle(80); P.dry();
    await P.stage(0.65, 'headland');
    const side = rng() < 0.5 ? 0 : 1;
    const land = [[side ? W + u : -u, hor - H * 0.02], [side ? W * 0.55 : W * 0.45, hor - H * 0.03], [side ? W * 0.45 : W * 0.55, hor + u], [side ? W + u : -u, hor + u]];
    P.fill(land, { mix: [[PAYNE, 1.2, 2], [ALIZ, 0.6, 1], [ULTRA, 0.8, 1]], water: 0.45, radius: 1.6 * u, load: 1.4 });
    await P.settle(30);
    for (let i = 0; i < 10; i++) { const y = hor + (H - hor) * (0.3 + 0.7 * rng()); P.line([[u * 40 * rng(), y], [u * (50 + 50 * rng()), y + P.jit(u * 0.2)]], { pigment: PAYNE, water: 0.08, radius: 0.55 * u, load: 0.25, mode: 'dry' }); }
    await P.settle(40); P.dry();
  },

  async 'misty-forest'(P) {
    const { W, H, u, rng } = P;
    await P.stage(0.02, 'mist');
    P.fill(P.rect(-u, -u, W + u, H + u), { top: [[PAYNE, 0.25, 2], [CERUL, 0.25, 1]], bottom: [[OCHRE, 0.25, 1], [PAYNE, 0.3, 1]], water: 1, radius: 5 * u, load: 0.6, rowStep: 0.8 });
    await P.settle(40);
    const layers = 4;
    for (let L = 0; L < layers; L++) {
      await P.stage(0.15 + 0.2 * L, 'trees');
      const depth = L / (layers - 1);                                     // 0 far, 1 near
      const base = H * (0.55 + 0.42 * depth), load = 0.3 + 0.6 * depth, water = 0.9 - 0.35 * depth;
      const mix = [[PAYNE, load, 2], [HOOKER, load * 0.9, 2], [ULTRA, load * 0.6, 1], [SAP, load * 0.7, 1]];
      const n = 9 - L * 1.5;
      for (let i = 0; i < n; i++) {
        const cx = (i + rng()) / n * W, hgt = H * (0.16 + 0.24 * depth) * (0.7 + 0.6 * rng()), w = hgt * (0.3 + 0.2 * rng());
        if (rng() < 0.75 || L === 3) { P.fill(P.conifer(cx, base, hgt, w), { mix, water, radius: (0.6 + 0.7 * depth) * u, load: 1, rowStep: 0.5, segment: 30 }); if (depth > 0.4) P.line([[cx, base - hgt * 0.25], [cx, base + u * 0.5]], { pigment: PAYNE, water: 0.3, radius: 0.22 * u, load: 1 }); }
        else { P.fill(P.blob(cx, base - hgt * 0.62, w * 1.1, hgt * 0.36, 14, 0.18), { mix, water, radius: (0.7 + 0.6 * depth) * u, load: 0.9, rowStep: 0.5, segment: 30 }); P.line([[cx, base - hgt * 0.35], [cx, base]], { pigment: SIENNA, water: water * 0.6, radius: 0.4 * u, load: load }); }
      }
      await P.settle(35);
      if (L === 1) P.dry();
    }
    await P.stage(0.85, 'path');
    P.fill([[W * 0.46, H * 0.84], [W * 0.54, H * 0.84], [W * 0.8, H + u], [W * 0.2, H + u]], { mix: [[OCHRE, 0.4, 2], [SIENNA, 0.35, 1], [PAYNE, 0.3, 1]], water: 0.8, radius: 2 * u, load: 0.6 });
    await P.settle(40); P.dry();
  },

  async 'meadow'(P) {
    const { W, H, u, rng } = P;
    const hor = H * (0.38 + 0.1 * rng());
    await P.stage(0.02, 'sky');
    await skyWash(P, hor + u, { clouds: 4 });
    await P.settle(50); P.dry();
    await P.stage(0.3, 'meadow');
    P.fill(P.rect(-u, hor - u, W + u, H + u), { top: [[SAP, 0.6, 2], [YELLOW, 0.5, 1], [CERUL, 0.3, 1]], bottom: [[HOOKER, 0.9, 2], [SAP, 0.9, 2], [OCHRE, 0.4, 1]], water: 0.85, radius: 3.5 * u, load: 0.9 });
    P.fill(P.ridge(hor * 0.8, hor - u, hor + u, 3, 0), { mix: [[HOOKER, 0.6, 1], [ULTRA, 0.4, 1]], water: 0.8, radius: 1.6 * u, load: 0.7 });   // distant hedge
    await P.settle(70); P.dry();
    await P.stage(0.6, 'flowers');
    const flowers = [[ROSE, 1.2, 3], [ALIZ, 1, 2], [YELLOW, 1.1, 3], [ULTRA, 0.9, 1], [INDRED, 0.9, 1]];
    P.dots(Math.round(120 + 80 * rng()), P.rect(0, hor + u * 2, W, H), { mix: flowers, water: 0.4, radius: 1.1 * u, sizeAt: (t) => 0.35 + 0.9 * t, pressure: 0.7 });
    await P.settle(30);
    P.dots(60, P.rect(0, hor + u * 4, W, H), { mix: [[HOOKER, 1.2, 2], [SAP, 1, 1]], water: 0.25, radius: 0.5 * u, len: 3 * u, sizeAt: (t) => 0.4 + 0.8 * t });
    const nTrees = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < nTrees; i++) { const cx = W * (0.1 + 0.8 * rng()), r = u * (4 + 4 * rng()); P.fill(P.blob(cx, hor - r * 0.6, r, r * 0.8, 10, 0.3), { mix: [[HOOKER, 1, 2], [SAP, 0.9, 1], [PAYNE, 0.6, 1]], water: 0.5, radius: 1.2 * u, load: 1 }); P.line([[cx, hor - r * 0.2], [cx, hor + u]], { pigment: SIENNA, water: 0.3, radius: 0.5 * u, load: 1.2 }); }
    await P.settle(50); P.dry();
  },

  async 'sailboat'(P) {
    const { W, H, u, rng } = P;
    const hor = H * (0.5 + 0.08 * rng());
    const boat = { x: W * (0.35 + 0.3 * rng()), y: hor + H * (0.12 + 0.12 * rng()), s: u * (5 + 3 * rng()) };
    const sail = [[boat.x - boat.s * 0.2, boat.y - boat.s * 0.2], [boat.x + boat.s * 0.1, boat.y - boat.s * 2.6], [boat.x + boat.s * 1.3, boat.y - boat.s * 0.2]];
    const inTri = (p, t) => { const s = (a, b, c) => (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1]); const d1 = s(p, t[0], t[1]), d2 = s(p, t[1], t[2]), d3 = s(p, t[2], t[0]); return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); };
    P.setMask((x, y, r) => inTri([x, y], sail) || inTri([x + r * 0.7, y], sail) || inTri([x - r * 0.7, y], sail) || inTri([x, y + r * 0.7], sail));
    await P.stage(0.02, 'sky');
    await skyWash(P, hor + u, { clouds: 6 });
    await P.settle(60); P.dry();
    await P.stage(0.3, 'sea');
    P.fill(P.rect(-u, hor, W + u, H + u), { top: [[CERUL, 0.7, 2], [ULTRA, 0.5, 1]], bottom: [[ULTRA, 0.9, 2], [PHTHALO, 0.7, 1], [HOOKER, 0.3, 1]], water: 0.85, radius: 3 * u, load: 0.85 });
    await P.settle(60); P.dry();
    P.setMask(null);
    await P.stage(0.55, 'coast');
    if (rng() < 0.8) P.fill(P.ridge(hor - H * 0.06, hor - u * 0.5, hor + u * 0.5, 3, 0.2), { mix: [[ULTRA, 0.5, 2], [ROSE, 0.3, 1]], water: 0.7, radius: 1.5 * u, load: 0.7 });
    await P.settle(30);
    await P.stage(0.7, 'boat');
    P.line([[sail[0][0], sail[0][1]], [sail[1][0], sail[1][1]]], { pigment: PAYNE, water: 0.3, radius: 0.35 * u, load: 1.4 });     // mast
    P.fill([[sail[0][0] + boat.s * 0.1, sail[0][1] + boat.s * 0.1], [sail[1][0], sail[1][1] + boat.s * 0.3], [sail[2][0] - boat.s * 0.15, sail[2][1] + boat.s * 0.05]], { mix: [[OCHRE, 0.25, 1], [ULTRA, 0.2, 1]], water: 0.5, radius: 0.8 * u, load: 0.5, rowStep: 2.2 });
    P.fill([[boat.x - boat.s * 0.6, boat.y - boat.s * 0.1], [boat.x + boat.s * 1.6, boat.y - boat.s * 0.1], [boat.x + boat.s * 1.3, boat.y + boat.s * 0.35], [boat.x - boat.s * 0.3, boat.y + boat.s * 0.35]], { mix: [[SIENNA, 1.4, 2], [INDRED, 1.2, 1], [PAYNE, 1, 1]], water: 0.35, radius: 0.7 * u, load: 1.3 });
    await P.settle(30);
    P.fillV([[boat.x - boat.s * 0.4, boat.y + boat.s * 0.4], [boat.x + boat.s * 1.4, boat.y + boat.s * 0.4], [boat.x + boat.s * 1.2, boat.y + boat.s * 1.6], [boat.x - boat.s * 0.2, boat.y + boat.s * 1.6]], { mix: [[PAYNE, 0.6, 1], [SIENNA, 0.5, 1]], water: 0.7, radius: 0.7 * u, load: 0.6, rowStep: 1.5, lenFrac: 0.8 });
    for (let i = 0; i < 14; i++) { const y = hor + (H - hor) * rng(); P.line([[W * rng() * 0.8, y], [W * (0.2 + 0.8 * rng()), y + P.jit(u * 0.2)]], { pigment: ULTRA, water: 0.08, radius: 0.55 * u, load: 0.25, mode: 'dry' }); }
    await P.settle(50); P.dry();
  },

  async 'lavender'(P) {
    const { W, H, u, rng } = P;
    const hor = H * (0.34 + 0.08 * rng());
    const vp = { x: W * (0.3 + 0.4 * rng()), y: hor };
    await P.stage(0.02, 'sky');
    await skyWash(P, hor + u, { top: [[CERUL, 0.6, 2], [ROSE, 0.3, 1]], bottom: [[OCHRE, 0.3, 1], [ROSE, 0.3, 1]], clouds: 3 });
    await P.settle(50); P.dry();
    await P.stage(0.25, 'hills');
    P.fill(P.ridge(hor * 0.75, hor - u, hor + u, 3, 0.1), { mix: [[ULTRA, 0.5, 1], [SAP, 0.5, 1], [ROSE, 0.3, 1]], water: 0.8, radius: 1.8 * u, load: 0.7 });
    P.fill(P.rect(-u, hor - u * 0.5, W + u, H + u), { top: [[OCHRE, 0.5, 2], [ROSE, 0.3, 1]], bottom: [[OCHRE, 0.7, 2], [SIENNA, 0.5, 1]], water: 0.85, radius: 3 * u, load: 0.7 });
    await P.settle(60); P.dry();
    await P.stage(0.5, 'rows');
    const rows = 9 + Math.floor(rng() * 5);
    for (let i = 0; i <= rows; i++) {
      const xb = -W * 0.4 + (W * 1.8) * i / rows;                               // bottom x of the row
      const pts = []; const n = 14;
      for (let k = 0; k <= n; k++) { const t = k / n; const y = vp.y + (H + u * 2 - vp.y) * Math.pow(t, 1.6); const x = vp.x + (xb - vp.x) * Math.pow(t, 1.6); pts.push([x, y]); }
      for (let k = 0; k + 1 < pts.length; k++) {
        const t = k / n, r = u * (0.35 + 2.4 * t);
        P.strokeLine(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], { radius: r, pigment: rng() < 0.6 ? ULTRA : ROSE, water: 0.45 + 0.3 * (1 - t), pressure: 0.6 + 0.3 * rng(), load: 1 + 0.6 * t, aspect: 0.6 }, 0.45);
        if (t > 0.3 && rng() < 0.6) P.dab(pts[k][0] + P.jit(r), pts[k][1] + P.jit(r * 0.5), { radius: r * 0.8, pigment: rng() < 0.5 ? ALIZ : PHTHALO, water: 0.4, pressure: 0.6, load: 0.9 });
      }
      if (i % 3 === 0) await P.settle(12);
    }
    await P.settle(40);
    await P.stage(0.8, 'tree');
    const tx = W * (0.15 + 0.7 * rng()), r = u * (3 + 3 * rng());
    P.fill(P.blob(tx, hor - r * 0.9, r * 1.2, r, 10, 0.3), { mix: [[HOOKER, 1.1, 2], [PAYNE, 0.8, 1]], water: 0.45, radius: 1 * u, load: 1.1 });
    P.line([[tx, hor - r * 0.3], [tx, hor + u]], { pigment: PAYNE, water: 0.3, radius: 0.4 * u, load: 1.3 });
    await P.settle(50); P.dry();
  },

  async 'rainy-city'(P) {
    const { W, H, u, rng } = P;
    const hor = H * (0.55 + 0.05 * rng());
    await P.stage(0.02, 'sky');
    P.fill(P.rect(-u, -u, W + u, H + u), { top: [[PAYNE, 0.5, 2], [ULTRA, 0.4, 1]], bottom: [[PAYNE, 0.35, 1], [OCHRE, 0.3, 1]], water: 1, radius: 5 * u, load: 0.7, rowStep: 0.8 });
    await P.settle(40);
    await P.stage(0.25, 'buildings');
    const cols = [[PAYNE, 1.1, 3], [INDRED, 0.9, 2], [OCHRE, 0.8, 1], [ULTRA, 0.8, 1], [SIENNA, 0.9, 1]];
    let x = -u * 2; const buildings = [];
    while (x < W + u) { const w = u * (5 + 10 * rng()), hgt = H * (0.12 + 0.3 * rng()); buildings.push([x, w, hgt]); x += w * (0.9 + 0.3 * rng()); }
    for (const [bx, w, hgt] of buildings) P.fill(P.rect(bx, hor - hgt, bx + w, hor + u), { mix: [cols[Math.floor(rng() * cols.length)]], water: 0.75, radius: 1.4 * u, load: 1, dir: 'v' });
    await P.settle(50);
    for (const [bx, w, hgt] of buildings) { for (let k = 0; k < Math.floor(w * hgt / (u * u * 12)); k++) if (rng() < 0.5) P.dot(bx + w * (0.15 + 0.7 * rng()), hor - hgt * (0.15 + 0.75 * rng()), { radius: 0.45 * u, pigment: YELLOW, water: 0.35, pressure: 0.8, load: 1.6 }); }
    await P.settle(30); P.dry();
    await P.stage(0.55, 'street');
    P.fill(P.rect(-u, hor, W + u, H + u), { mix: [[PAYNE, 0.6, 2], [ULTRA, 0.4, 1], [OCHRE, 0.3, 1]], water: 0.9, radius: 3 * u, load: 0.6 });
    for (const [bx, w, hgt] of buildings) P.fillV(P.rect(bx + u * 0.5, hor, bx + w - u * 0.5, hor + Math.min(H - hor, hgt * 0.8)), { mix: [[PAYNE, 0.7, 2], [INDRED, 0.6, 1], [OCHRE, 0.5, 1], [YELLOW, 0.6, 1]], water: 0.85, radius: 1.1 * u, load: 0.8, rowStep: 1.3, lenFrac: 0.9 });
    P.dots(24, P.rect(0, hor + u, W, H), { mix: [[YELLOW, 0.8, 2], [ALIZ, 0.6, 1]], water: 0.9, radius: 0.6 * u, len: 5 * u });
    await P.settle(60);
    await P.stage(0.8, 'people');
    const n = 7 + Math.floor(rng() * 6);
    for (let i = 0; i < n; i++) {
      const px = W * (0.08 + 0.84 * rng()), py = hor + (H - hor) * (0.15 + 0.7 * rng()), s = u * (1.5 + 2.5 * (py - hor) / (H - hor));
      P.line([[px, py - s * 2.2], [px, py]], { pigment: PAYNE, water: 0.3, radius: s * 0.35, load: 1.4 });
      P.dot(px, py - s * 2.4, { radius: s * 1.1, pigment: rng() < 0.6 ? ALIZ : (rng() < 0.5 ? YELLOW : ULTRA), water: 0.3, pressure: 0.9, load: 1.6, aspect: 0.45 });
      P.line([[px + P.jit(s * 0.5), py], [px + P.jit(s * 0.5), py + s * 1.6]], { pigment: PAYNE, water: 0.8, radius: s * 0.3, load: 0.6 });
    }
    for (let i = 0; i < 30; i++) { const rx = W * rng(), ry = H * rng(); P.line([[rx, ry], [rx - u * 1.5, ry + u * 6]], { pigment: null, water: 0.9, radius: 0.35 * u, mode: 'lift', load: 0.6 }); }
    await P.settle(60); P.dry();
  },

  async 'winter'(P) {
    const { W, H, u, rng } = P;
    const hor = H * (0.5 + 0.1 * rng());
    await P.stage(0.02, 'sky');
    P.fill(P.rect(-u, -u, W + u, hor + u), { top: [[ULTRA, 0.4, 2], [PAYNE, 0.35, 1]], bottom: [[ROSE, 0.2, 1], [OCHRE, 0.2, 1], [CERUL, 0.2, 1]], water: 0.95, radius: 4.5 * u, load: 0.6, rowStep: 0.8 });
    await P.settle(60); P.dry();
    await P.stage(0.3, 'snow');
    P.fill(P.ridge(hor * 0.7, hor - u, hor + u, 3, 0.1), { mix: [[ULTRA, 0.35, 2], [PAYNE, 0.3, 1]], water: 0.8, radius: 2 * u, load: 0.5 });
    for (let i = 0; i < 7; i++) { const y = hor + (H - hor) * (0.1 + 0.9 * rng()); P.line([[-u, y + P.jit(u)], [W * (0.3 + 0.7 * rng()), y + P.jit(u * 2)]], { mix: [[ULTRA, 0.3, 2], [CERUL, 0.3, 1]], water: 0.85, radius: 2.5 * u, load: 0.35, aspect: 0.5 }); }
    await P.settle(50); P.dry();
    await P.stage(0.55, 'house');
    const hx = W * (0.55 + 0.25 * rng()), hy = hor + H * 0.06, hw = u * 12, hh = u * 7;
    P.fill(P.rect(hx - hw / 2, hy - hh, hx + hw / 2, hy), { mix: [[SIENNA, 1.2, 2], [INDRED, 1, 1], [PAYNE, 0.7, 1]], water: 0.35, radius: 0.7 * u, load: 1.3, rowStep: 0.5, segment: 40 });
    P.fill([[hx - hw * 0.62, hy - hh + u * 0.3], [hx, hy - hh - u * 5.5], [hx + hw * 0.62, hy - hh + u * 0.3]], { mix: [[ULTRA, 0.35, 1], [PAYNE, 0.3, 1]], water: 0.5, radius: 0.7 * u, load: 0.5, rowStep: 0.6 });
    P.line([[hx - hw * 0.62, hy - hh + u * 0.3], [hx, hy - hh - u * 5.5], [hx + hw * 0.62, hy - hh + u * 0.3]], { pigment: PAYNE, water: 0.3, radius: 0.25 * u, load: 1.2 });
    P.dot(hx - hw * 0.2, hy - hh * 0.5, { radius: u * 0.9, pigment: YELLOW, water: 0.3, pressure: 1, load: 1.8, aspect: 0.8 });
    P.dot(hx + hw * 0.25, hy - hh * 0.5, { radius: u * 0.9, pigment: YELLOW, water: 0.3, pressure: 1, load: 1.8, aspect: 0.8 });
    P.line([[hx + hw * 0.3, hy - hh - u * 3], [hx + hw * 0.5, hy - hh - u * 9], [hx + hw * 0.2, hy - hh - u * 14]], { pigment: PAYNE, water: 0.9, radius: 0.9 * u, load: 0.35 });
    await P.settle(30);
    await P.stage(0.75, 'trees');
    const n = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const tx = W * (0.05 + 0.4 * rng()), base = hor + H * (0.05 + 0.25 * rng()), hgt = H * (0.2 + 0.25 * rng());
      const branch = (x, y, len, ang, depth) => {
        const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
        P.line([[x, y], [x2, y2]], { pigment: PAYNE, water: 0.15, radius: u * (0.18 + 0.22 * depth), load: 1.4, mode: depth > 1 ? 'wet' : 'dry' });
        if (depth <= 0) return;
        const k = 2 + Math.floor(rng() * 2);
        for (let j = 0; j < k; j++) branch(x2, y2, len * (0.55 + 0.2 * rng()), ang + P.jit(0.9), depth - 1);
      };
      branch(tx, base, hgt * 0.4, -Math.PI / 2 + P.jit(0.15), 3);
    }
    for (let i = 0; i < 4; i++) { const cx = W * (0.05 + 0.9 * rng()), hgt = H * (0.1 + 0.15 * rng()); P.fill(P.conifer(cx, hor + H * (0.02 + 0.3 * rng()), hgt, hgt * 0.5), { mix: [[HOOKER, 1.1, 2], [PAYNE, 1, 1]], water: 0.35, radius: 0.8 * u, load: 1.2, rowStep: 0.5, segment: 30 }); }
    await P.settle(50); P.dry();
  },

  async 'lily-pond'(P) {
    const { W, H, u, rng } = P;
    await P.stage(0.02, 'water');
    P.fill(P.rect(-u, -u, W + u, H + u), { top: [[HOOKER, 0.9, 2], [PHTHALO, 0.8, 2], [ROSE, 0.5, 1]], bottom: [[ULTRA, 0.9, 2], [HOOKER, 1, 2], [OCHRE, 0.4, 1]], water: 1, radius: 4.5 * u, load: 0.9, rowStep: 0.7 });
    P.fillV(P.rect(0, 0, W, H * 0.7), { mix: [[SAP, 0.7, 2], [PAYNE, 0.7, 1], [ROSE, 0.5, 1]], water: 0.9, radius: 1.6 * u, load: 0.6, rowStep: 2.2, lenFrac: 0.9 });
    P.dots(10, P.rect(0, 0, W, H * 0.6), { mix: [[ROSE, 0.5], [CERUL, 0.5]], water: 1, radius: 3 * u, len: 8 * u, aspect: 0.4 });
    await P.settle(90); P.dry();
    await P.stage(0.4, 'pads');
    const rows = 5 + Math.floor(rng() * 3);
    for (let r = 0; r < rows; r++) {
      const t = (r + 0.5) / rows, y = H * (0.22 + 0.75 * t * t), n = 5 + Math.floor(rng() * 4), size = u * (1.2 + 3.5 * t);
      for (let i = 0; i < n; i++) { if (rng() < 0.25) continue; const x = W * ((i + rng() * 1.4 - 0.2) / n); P.fill(P.blob(x, y + P.jit(size * 1.2), size * (0.8 + 0.6 * rng()), size * (0.3 + 0.2 * rng()), 8, 0.15), { mix: [[SAP, 1, 2], [HOOKER, 1.1, 2], [YELLOW, 0.5, 1], [PAYNE, 0.5, 1]], water: 0.5 - 0.15 * t, radius: 0.5 * size, load: 0.9 + 0.5 * t, rowStep: 0.55 }); }
      await P.settle(10);
    }
    await P.settle(40);
    await P.stage(0.75, 'flowers');
    for (let i = 0; i < 12 + rng() * 10; i++) { const t = rng(), y = H * (0.3 + 0.65 * t), x = W * rng(), s = u * (0.6 + 1.8 * t); P.dot(x, y, { radius: s, pigment: ROSE, water: 0.3, pressure: 0.8, load: 1.6 }); P.dot(x, y - s * 0.3, { radius: s * 0.5, pigment: YELLOW, water: 0.25, pressure: 0.8, load: 1.6 }); P.dot(x, y + s * 0.4, { radius: s * 0.7, pigment: ALIZ, water: 0.3, pressure: 0.7, load: 1.2, aspect: 0.5 }); }
    await P.settle(50); P.dry();
  },

  async 'haystacks'(P) {
    const { W, H, u, rng } = P;
    const hor = H * (0.4 + 0.1 * rng());
    await P.stage(0.02, 'sky');
    P.fill(P.rect(-u, -u, W + u, hor + u), { top: [[ROSE, 0.5, 2], [ULTRA, 0.3, 1]], bottom: [[YELLOW, 0.6, 2], [OCHRE, 0.5, 1], [ROSE, 0.3, 1]], water: 0.95, radius: 4.5 * u, load: 0.7, rowStep: 0.8 });
    await P.settle(60); P.dry();
    await P.stage(0.3, 'field');
    P.fill(P.ridge(hor * 0.85, hor - u, hor + u, 3, 0), { mix: [[ULTRA, 0.4, 1], [ROSE, 0.3, 1], [HOOKER, 0.3, 1]], water: 0.8, radius: 1.6 * u, load: 0.7 });
    P.fill(P.rect(-u, hor - u * 0.5, W + u, H + u), { top: [[OCHRE, 0.7, 2], [YELLOW, 0.5, 1]], bottom: [[OCHRE, 0.9, 2], [SIENNA, 0.7, 1], [SAP, 0.4, 1]], water: 0.8, radius: 3 * u, load: 0.9 });
    await P.settle(60); P.dry();
    await P.stage(0.55, 'haystacks');
    const n = 2 + Math.floor(rng() * 3);
    const stacks = []; for (let i = 0; i < n; i++) stacks.push({ x: W * (0.12 + 0.76 * rng()), y: hor + (H - hor) * (0.15 + 0.6 * rng()) });
    stacks.sort((a, b) => a.y - b.y);
    for (const s of stacks) {
      const size = u * (6 + 8 * (s.y - hor) / (H - hor));
      const body = [[s.x - size, s.y], [s.x - size * 0.8, s.y - size * 0.8], [s.x, s.y - size * 1.5], [s.x + size * 0.8, s.y - size * 0.8], [s.x + size, s.y]];
      P.fill(body, { mix: [[OCHRE, 1.1, 2], [YELLOW, 0.8, 1], [SIENNA, 0.8, 1]], water: 0.55, radius: 0.9 * u, load: 1.1 });
      P.fill([[s.x + size * 0.1, s.y - size * 1.45], [s.x + size * 0.8, s.y - size * 0.8], [s.x + size, s.y], [s.x + size * 0.15, s.y]], { mix: [[SIENNA, 1.1, 2], [ULTRA, 0.7, 1], [ALIZ, 0.6, 1]], water: 0.45, radius: 0.8 * u, load: 1.2 });
      P.fill([[s.x - size * 0.9, s.y - u * 0.3], [s.x + size * 1.1, s.y - u * 0.3], [s.x + size * 3, s.y + size * 0.5], [s.x + size * 0.5, s.y + size * 0.6]], { mix: [[ULTRA, 0.6, 2], [ROSE, 0.4, 1]], water: 0.6, radius: 1 * u, load: 0.7 });
      await P.settle(20);
    }
    for (let i = 0; i < 12; i++) { const y = hor + (H - hor) * (0.2 + 0.8 * rng()); P.line([[W * rng() * 0.7, y], [W * (0.3 + 0.7 * rng()), y + P.jit(u * 0.4)]], { pigment: SIENNA, water: 0.08, radius: 0.55 * u, load: 0.25, mode: 'dry' }); }
    await P.settle(50); P.dry();
  },

  async 'lighthouse'(P) {
    const { W, H, u, rng } = P;
    const hor = H * (0.5 + 0.08 * rng());
    const lx = W * (0.25 + 0.5 * rng()), cliffTop = hor - H * (0.05 + 0.1 * rng()), lw = u * 4, lh = H * (0.22 + 0.1 * rng());
    P.setMask((x, y, r) => x > lx - lw * 0.7 - r * 0.7 && x < lx + lw * 0.7 + r * 0.7 && y < cliffTop && y > cliffTop - lh - u * 2 - r * 0.7);
    await P.stage(0.02, 'sky');
    await skyWash(P, hor + u, { top: [[PAYNE, 0.5, 1], [CERUL, 0.6, 2], [ULTRA, 0.4, 1]], bottom: [[OCHRE, 0.3, 1], [CERUL, 0.3, 1]], clouds: 7 });
    await P.settle(60); P.dry();
    await P.stage(0.3, 'sea');
    P.fill(P.rect(-u, hor, W + u, H + u), { top: [[CERUL, 0.7, 2], [ULTRA, 0.6, 1]], bottom: [[ULTRA, 1, 2], [PHTHALO, 0.7, 1], [HOOKER, 0.4, 1]], water: 0.85, radius: 3 * u, load: 0.9 });
    for (let i = 0; i < 16; i++) { const y = hor + (H - hor) * rng(); P.line([[W * rng(), y], [W * rng(), y + P.jit(u * 0.5)]], { pigment: null, water: 1, radius: 0.9 * u }); }
    await P.settle(60); P.dry();
    await P.stage(0.55, 'cliff');
    const side = lx < W / 2 ? -1 : 1;
    const cliff = [[lx - side * u * 3 - lw * 2, cliffTop + u * 0.5], [lx - side * u * 1, cliffTop], [lx + side * u * 8, cliffTop + u * 1.5], [lx + side * u * 18, cliffTop + u * 6], [lx + side * u * 30, hor + H * 0.06], [lx + side * u * 45, hor + H * 0.2], [lx + side * u * 70, H + u], [lx - side * u * 3 - lw * 2, H + u]];
    for (let i = 1; i < 6; i++) cliff[i][1] += P.jit(u * 1.5);
    if (side < 0) cliff.reverse();
    P.fill(cliff, { mix: [[SIENNA, 1, 2], [PAYNE, 0.9, 2], [OCHRE, 0.7, 1], [SAP, 0.7, 1]], water: 0.55, radius: 1.5 * u, load: 1.1, segment: 5 });
    P.fill([[cliff[0][0], cliff[0][1]], [cliff[1][0], cliff[1][1]], [cliff[2][0], cliff[2][1]], [cliff[3][0], cliff[3][1]], [cliff[3][0], cliff[3][1] + u * 4], [cliff[0][0], cliff[0][1] + u * 4]], { mix: [[SAP, 0.9, 2], [HOOKER, 0.7, 1]], water: 0.6, radius: 1 * u, load: 0.9 });
    await P.settle(40);
    P.setMask(null);
    await P.stage(0.75, 'tower');
    const bands = 4;
    for (let b = 0; b < bands; b++) { if (b % 2 === 0) P.fill(P.rect(lx - lw * 0.55, cliffTop - lh + lh * b / bands, lx + lw * 0.55, cliffTop - lh + lh * (b + 1) / bands), { mix: [[INDRED, 1.3, 1]], water: 0.3, radius: 0.5 * u, load: 1.4, rowStep: 1.2 }); }
    P.fill(P.rect(lx - lw * 0.6, cliffTop - lh - u * 1.6, lx + lw * 0.6, cliffTop - lh), { mix: [[PAYNE, 1.2, 1]], water: 0.3, radius: 0.45 * u, load: 1.3, rowStep: 1.2 });
    P.dot(lx, cliffTop - lh - u * 0.8, { radius: u * 0.9, pigment: YELLOW, water: 0.3, pressure: 1, load: 1.6 });
    P.line([[lx - lw * 0.55, cliffTop - lh], [lx - lw * 0.5, cliffTop]], { pigment: PAYNE, water: 0.25, radius: 0.22 * u, load: 1 });
    for (let i = 0; i < 10; i++) { const y = hor + (H - hor) * (0.3 + 0.7 * rng()); P.line([[W * rng() * 0.6, y], [W * (0.4 + 0.6 * rng()), y + P.jit(u * 0.3)]], { pigment: ULTRA, water: 0.08, radius: 0.55 * u, load: 0.25, mode: 'dry' }); }
    await P.settle(50); P.dry();
  },

  async 'garden-path'(P) {
    const { W, H, u, rng } = P;
    await P.stage(0.02, 'light');
    P.fill(P.rect(-u, -u, W + u, H + u), { top: [[YELLOW, 0.35, 2], [SAP, 0.4, 2], [CERUL, 0.3, 1]], bottom: [[SAP, 0.5, 2], [OCHRE, 0.4, 1], [HOOKER, 0.4, 1]], water: 1, radius: 5 * u, load: 0.6, rowStep: 0.8 });
    await P.settle(40);
    await P.stage(0.2, 'foliage');
    const vp = { x: W * (0.4 + 0.2 * rng()), y: H * (0.35 + 0.1 * rng()) };
    const path = [[vp.x - u * 2, vp.y], [vp.x + u * 2, vp.y], [W * (0.75 + 0.15 * rng()), H + u], [W * (0.1 + 0.15 * rng()), H + u]];
    for (let L = 0; L < 3; L++) {
      const depth = L / 2, n = 10 - 3 * L;
      for (let i = 0; i < n; i++) {
        const left = rng() < 0.5, t = 0.15 + 0.8 * rng();
        const px = left ? vp.x - u * (2 + 40 * t) * (1 + depth) : vp.x + u * (2 + 40 * t) * (1 + depth);
        const py = vp.y + (H - vp.y) * t * (0.9 + 0.3 * depth) - u * (8 + 15 * depth) * rng();
        const r = u * (3 + 6 * t) * (0.7 + 0.5 * depth);
        P.fill(P.blob(px, py, r * (1 + 0.5 * rng()), r * 0.8, 10, 0.35), { mix: [[SAP, 0.9 + 0.4 * depth, 2], [HOOKER, 0.9 + 0.5 * depth, 2], [YELLOW, 0.6, 1], [PAYNE, 0.5 + 0.4 * depth, 1]], water: 0.8 - 0.35 * depth, radius: (1 + 0.8 * depth) * u, load: 1 });
      }
      await P.settle(35);
      if (L === 0) P.dry();
    }
    await P.stage(0.6, 'path');
    P.fill(path, { top: [[OCHRE, 0.4, 1], [SIENNA, 0.3, 1]], bottom: [[OCHRE, 0.7, 2], [SIENNA, 0.6, 1], [ULTRA, 0.3, 1]], water: 0.65, radius: 2 * u, load: 0.8 });
    await P.settle(40);
    await P.stage(0.75, 'flowers');
    const flowers = [[ROSE, 1.2, 3], [ALIZ, 1, 2], [YELLOW, 1, 2], [ULTRA, 0.9, 1], [INDRED, 0.8, 1]];
    P.dots(90, [[vp.x - u * 3, vp.y], [-u, H * 0.55], [-u, H + u], [path[3][0] - u, H + u]], { mix: flowers, water: 0.35, radius: 0.9 * u, sizeAt: (t) => 0.3 + t, pressure: 0.7 });
    P.dots(90, [[vp.x + u * 3, vp.y], [W + u, H * 0.55], [W + u, H + u], [path[2][0] + u, H + u]], { mix: flowers, water: 0.35, radius: 0.9 * u, sizeAt: (t) => 0.3 + t, pressure: 0.7 });
    P.dots(24, path, { mix: [[ULTRA, 0.4, 1], [SIENNA, 0.5, 1]], water: 0.3, radius: 0.5 * u, len: 3 * u, sizeAt: (t) => 0.4 + t });
    await P.settle(50); P.dry();
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Public generation API
// ---------------------------------------------------------------------------------------------------------------
function withSim(o, fn) {
  const run = async () => {
    const own = !!o.sim;
    running++;
    try {
      const sim = o.sim || sharedSim(o.width, o.height, o.simScale ?? 0.5);
      const nPig = sim.pigments.length;
      sim.clear();
      sim.setWet(true);
      sim.setDryingSpeed(o.dryingSpeed ?? 1);
      try { return await fn(sim, own); }
      finally { if (!own) { sim.clear(); sim.truncatePigments(nPig); } }
    } finally {
      running--;
      if (running === 0 && disposeWhenIdle) { disposeWhenIdle = false; freeShared(); }
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

/**
 * Paints a motif. seed -> deterministic. Returns a PNG data URL (composited with paper).
 * opts: { seed, motif (id | 'random'), width, height, onProgress(frac, label), quality (0..1, step budget), simScale, sim (paint on a given sim), paper, paperSeed, dryingSpeed }
 */
export function generateWatercolor(opts = {}) {
  const o = { seed: 1, motif: 'random', width: 1024, height: 768, quality: 1, ...opts };
  return withSim(o, async (sim, own) => {
    const rng = mulberry32((o.seed * 7919) | 0);
    const motif = (o.motif === 'random' || !MOTIF_FNS[o.motif]) ? MOTIFS[Math.floor(rng() * MOTIFS.length)].id : o.motif;
    const paper = o.paper || (rng() < 0.5 ? 'cold' : 'rough'), paperSeed = o.paperSeed ?? (1 + Math.floor(rng() * 500));
    if (!own) sim.setPaper(paper, paperSeed);
    const P = makePainter(sim, rng, sim.width, sim.height, o.quality, o.onProgress);
    await MOTIF_FNS[motif](P);
    sim.dry();
    o.onProgress?.(1, 'done');
    return sim.toDataURL();
  });
}

/** Loads a data URL / URL / ImageBitmap / HTMLImageElement / canvas and returns something drawable. */
async function toDrawable(src) {
  if (typeof src !== 'string') return src;
  const viaImg = (u) => new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('image load failed')); img.src = u; });
  if (src.startsWith('data:') || src.startsWith('blob:')) return viaImg(src);
  try { const r = await fetch(src); if (!r.ok) throw new Error('fetch ' + r.status); return await createImageBitmap(await r.blob()); }
  catch { return viaImg(src); }
}

function kmeans(samples, k, rng, iters = 10) {
  const n = samples.length / 3;
  const centers = [];
  for (let i = 0; i < k; i++) { const j = Math.floor(rng() * n) * 3; centers.push([samples[j], samples[j + 1], samples[j + 2]]); }
  // spread initial centres along luminance so that light and dark are both represented
  centers.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
  const labels = new Uint8Array(n);
  for (let it = 0; it < iters; it++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const r = samples[i * 3], g = samples[i * 3 + 1], b = samples[i * 3 + 2];
      let best = 0, bd = 1e9;
      for (let c = 0; c < k; c++) { const d = (r - centers[c][0]) ** 2 + (g - centers[c][1]) ** 2 + (b - centers[c][2]) ** 2; if (d < bd) { bd = d; best = c; } }
      labels[i] = best; sums[best][0] += r; sums[best][1] += g; sums[best][2] += b; sums[best][3]++;
    }
    for (let c = 0; c < k; c++) if (sums[c][3]) centers[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
  }
  return { centers, labels };
}

/**
 * Turns a photo into a watercolor painting: colours are quantised into 5-7 layers, painted light to dark
 * (big wet washes first, then edge-following medium strokes), keeping some white paper.
 * opts: { strokes (density factor), seed, width, height, onProgress, quality, simScale, sim }
 */
export function generateFromImage(src, opts = {}) {
  const o = { strokes: 1, seed: 1, width: 1024, height: 768, quality: 1, ...opts };
  return withSim(o, async (sim, own) => {
    const img = await toDrawable(src);
    const W = sim.width, H = sim.height;
    const rng = mulberry32((o.seed * 104729 + 17) | 0);
    if (!own) sim.setPaper(o.paper || 'cold', o.paperSeed ?? (1 + Math.floor(rng() * 500)));
    // --- analyse the image at a coarse grid
    const cell = Math.max(2, Math.round(W / 160));
    const gw = Math.floor(W / cell), gh = Math.floor(H / cell);
    const c2 = document.createElement('canvas'); c2.width = gw; c2.height = gh;
    const g = c2.getContext('2d', { willReadFrequently: true });
    const iw = img.naturalWidth || img.videoWidth || img.width, ih = img.naturalHeight || img.videoHeight || img.height;
    const s = Math.max(gw / iw, gh / ih), dw = iw * s, dh = ih * s;
    g.drawImage(img, (gw - dw) / 2, (gh - dh) / 2, dw, dh);
    const px = g.getImageData(0, 0, gw, gh).data;
    const n = gw * gh, samples = new Float32Array(n * 3), lum = new Float32Array(n);
    for (let i = 0; i < n; i++) { samples[i * 3] = px[i * 4] / 255; samples[i * 3 + 1] = px[i * 4 + 1] / 255; samples[i * 3 + 2] = px[i * 4 + 2] / 255; lum[i] = 0.3 * samples[i * 3] + 0.59 * samples[i * 3 + 1] + 0.11 * samples[i * 3 + 2]; }
    const K = 6;
    const { centers, labels } = kmeans(samples, K, rng);
    const order = centers.map((c, i) => [0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2], i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);   // light -> dark
    const rank = new Array(K); order.forEach((ci, r) => { rank[ci] = r; });
    // --- pigments: one custom pigment per cluster (slightly saturated, darker clusters granulate more)
    const pig = centers.map((c, i) => {
      const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
      const sat = c.map((v) => Math.min(0.98, Math.max(0.03, l + (v - l) * 1.25)));
      return sim.addPigment(pigmentFromColor(sat, { id: 'img' + i, rho: 0.008 + 0.012 * (1 - l), omega: 0.1 + 0.4 * (1 - l), sigma: 1.5 + 2 * l, transparency: 0.8 }));
    });
    const P = makePainter(sim, rng, W, H, o.quality, o.onProgress);
    const u = W / 100;
    const gx = (i) => (i % gw + 0.5) * cell, gy = (i) => (Math.floor(i / gw) + 0.5) * cell;
    const highlight = (i) => lum[i] > 0.92;
    // --- gradient (Sobel) for edge strokes
    const gradM = new Float32Array(n), gradA = new Float32Array(n);
    for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
      const i = y * gw + x, L = (xx, yy) => lum[yy * gw + xx];
      const dx = (L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1)) - (L(x - 1, y - 1) + 2 * L(x - 1, y) + L(x - 1, y + 1));
      const dy = (L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1)) - (L(x - 1, y - 1) + 2 * L(x, y - 1) + L(x + 1, y - 1));
      gradM[i] = Math.hypot(dx, dy); gradA[i] = Math.atan2(dy, dx);
    }
    // --- stage 1: soft wet underpainting in each cell's own (light) colour, leaving highlights white
    await P.stage(0.05, 'washes');
    const washR = 3 * u, step1 = Math.max(1, Math.round(washR * 1.1 / cell));
    for (let yy = 0; yy < gh; yy += step1) for (let xx = 0; xx < gw; xx += step1) {
      const i = yy * gw + xx; if (highlight(i)) continue;
      const r = rank[labels[i]];
      P.dab(gx(i) + P.jit(cell), gy(i) + P.jit(cell), { radius: washR * (0.8 + 0.4 * rng()), pigment: pig[labels[i]], water: 0.95, pressure: 0.6, load: 0.3 + 0.08 * r, soft: 0.8 });
    }
    await P.settle(50);
    // --- stage 2: one layer per cluster (light to dark), progressively drier and smaller, only its own cells
    for (let r = 0; r < K; r++) {
      await P.stage(0.15 + 0.55 * (r / K), 'layer ' + r);
      const ci = order[r], depth = r / (K - 1);
      const rad = u * (2.4 - 1.7 * depth), step = Math.max(1, Math.round(rad * 1.1 / cell));
      const water = 0.85 - 0.5 * depth, load = 0.4 + 0.5 * depth;
      const cells = [];
      for (let yy = 0; yy < gh; yy += step) for (let xx = 0; xx < gw; xx += step) { const i = yy * gw + xx; if (!highlight(i) && labels[i] === ci && rng() < o.strokes) cells.push(i); }
      cells.sort(() => rng() - 0.5);
      for (const i of cells) {
        const a = gradM[i] > 0.15 ? gradA[i] + Math.PI / 2 : rng() * Math.PI;
        const len = rad * (0.8 + 1.2 * rng());
        P.strokeLine(gx(i) - Math.cos(a) * len, gy(i) - Math.sin(a) * len, gx(i) + Math.cos(a) * len, gy(i) + Math.sin(a) * len, { radius: rad * (0.8 + 0.4 * rng()), pigment: pig[ci], water, pressure: 0.5 + 0.4 * rng(), load, aspect: 0.7 }, 0.45);
      }
      await P.settle(25 + 10 * (1 - depth));
      if (r === 2 || r === 4) P.dry();
    }
    // --- stage 3: edge-following dark strokes
    await P.stage(0.8, 'edges');
    const edges = [];
    for (let i = 0; i < n; i++) if (gradM[i] > 0.35 && rng() < 0.5 * o.strokes) edges.push(i);
    edges.sort(() => rng() - 0.5);
    for (const i of edges.slice(0, 900)) {
      const a = gradA[i] + Math.PI / 2, len = u * (0.8 + 1.5 * rng());
      // darker side of the edge
      const sx = Math.round(Math.cos(gradA[i])), sy = Math.round(Math.sin(gradA[i]));
      const j = Math.min(n - 1, Math.max(0, i - sy * gw - sx));
      const ci = labels[j];
      if (rank[ci] < 2) continue;
      P.strokeLine(gx(i) - Math.cos(a) * len, gy(i) - Math.sin(a) * len, gx(i) + Math.cos(a) * len, gy(i) + Math.sin(a) * len, { radius: u * 0.4, pigment: pig[ci], water: 0.3, pressure: 0.7, load: 0.6 }, 0.45);
    }
    await P.settle(40);
    sim.dry();
    o.onProgress?.(1, 'done');
    return sim.toDataURL();
  });
}
