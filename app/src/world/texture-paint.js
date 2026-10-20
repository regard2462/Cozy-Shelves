// The painters of the procedural textures (no asset files): wood, planks, parquet, plaster, wallpaper, coffers, brick,
// fabric, leather, marble, paper, rugs. Pure canvas work, no three.js: textures.js turns the canvases into textures
// on the main thread, texture-worker.js paints them in a worker (OffscreenCanvas) at a first start, and
// texture-store.js keeps them as PNGs for the next start. Every painter has a key of its parameters (keyOf) and
// returns { map, normalMap?, roughnessMap? } with canvases (no memory here: textures.js caches the textures by key).

// ---- noise helpers ---------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function makeValueNoise(seed, size = 256) {
  const rnd = mulberry32(seed);
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const s = size;
  const fade = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    x = ((x % s) + s) % s; y = ((y % s) + s) % s;
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = (x0 + 1) % s, y1 = (y0 + 1) % s;
    const fx = fade(x - x0), fy = fade(y - y0);
    const a = g[y0 * s + x0], b = g[y0 * s + x1], c = g[y1 * s + x0], d = g[y1 * s + x1];
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  };
}
function fbm(noise, x, y, oct = 4, lac = 2, gain = 0.5) {
  let v = 0, a = 1, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { v += a * noise(x * f, y * f); n += a; a *= gain; f *= lac; }
  return v / n;
}

/** A canvas: the page's in a window, an OffscreenCanvas in a worker (its pixels kept in memory: they are read back
 *  for the picture and the PNG, and a bitmap taken from a worker's canvas on the graphics card never reached the
 *  page's WebGL context under ANGLE: "texture is not a shared image", empty pictures). */
export function canvas(w, h) {
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d', { willReadFrequently: true });
  return c;
}
// height (Float32Array 0..1) → normal map canvas
function normalFromHeight(hgt, w, h, strength = 2) {
  const c = canvas(w, h); const ctx = c.getContext('2d'); const img = ctx.createImageData(w, h); const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = hgt[y * w + ((x - 1 + w) % w)], r = hgt[y * w + ((x + 1) % w)], u = hgt[((y - 1 + h) % h) * w + x], dn = hgt[((y + 1) % h) * w + x];
    const nx = (l - r) * strength, ny = (u - dn) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz);
    const i = (y * w + x) * 4;
    d[i] = (nx / len * 0.5 + 0.5) * 255; d[i + 1] = (ny / len * 0.5 + 0.5) * 255; d[i + 2] = (nz / len * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
function grayCanvas(vals, w, h, lo = 0, hi = 1) {
  const c = canvas(w, h); const ctx = c.getContext('2d'); const img = ctx.createImageData(w, h); const d = img.data;
  for (let i = 0; i < w * h; i++) { const v = Math.max(0, Math.min(1, (vals[i] - lo) / (hi - lo))) * 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0); return c;
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
function mixColor(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

// ---- wood ------------------------------------------------------------------
/** Plank wood (planks along x). tone: 'oak'|'walnut'|'mahogany'|'pine'|'ebony'|'cherry' */
function paintWood({ tone = 'oak', seed = 1, size = 512, planks = 4, along = 'x', grainScale = 1, contrast = 1 } = {}) {
  // light, natural tones: the old dark walnut/orange oak made the rooms look brown and dim
  const tones = {
    oak: ['#cdb597', '#b09878', '#decdb4'], walnut: ['#7a5a40', '#5b412e', '#977457'], mahogany: ['#8a4a33', '#6a3322', '#a5614a'],
    pine: ['#d8b98c', '#bb9868', '#e8d2ab'], ebony: ['#2e2a27', '#1d1a18', '#403a35'], cherry: ['#a8704e', '#86553a', '#c08a66'], maple: ['#e0c8a2', '#c8ad84', '#eedbbb'],
    ash: ['#dccaa9', '#c3ad88', '#eadcc2'],
  };
  const [base, dark, light] = tones[tone].map(hex);
  const w = size, h = size;
  const noise = makeValueNoise(seed * 7 + 1, 128);
  const noise2 = makeValueNoise(seed * 13 + 3, 64);
  const col = canvas(w, h); const ctx = col.getContext('2d'); const img = ctx.createImageData(w, h); const d = img.data;
  const hgt = new Float32Array(w * h); const rough = new Float32Array(w * h);
  const rnd = mulberry32(seed);
  const plankOffsets = Array.from({ length: planks }, () => rnd() * 100);
  const plankTints = Array.from({ length: planks }, () => (rnd() - 0.5) * 0.25);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ax = along === 'x' ? x : y, ay = along === 'x' ? y : x; // ax along grain
    const plank = Math.floor(ay / (h / planks));
    const pOff = plankOffsets[plank];
    const gy = (ay % (h / planks)) / (h / planks);
    // grain: rings along the plank with wobble
    const wob = fbm(noise, ax * 0.01 * grainScale + pOff, ay * 0.02 * grainScale, 4) * 6;
    const ring = Math.sin((ay * 0.11 + wob + fbm(noise2, ax * 0.003, ay * 0.05, 3) * 9) * grainScale);
    const fine = fbm(noise2, ax * 0.06, ay * 0.6, 3);
    let t = clamp01(0.5 + (ring * 0.28 + (fine - 0.5) * 0.35) * contrast + plankTints[plank]);
    let c = t < 0.5 ? mixColor(dark, base, t * 2) : mixColor(base, light, (t - 0.5) * 2);
    // plank gaps
    const edge = Math.min(gy, 1 - gy) * (h / planks);
    let gap = edge < 1.5 ? 0.45 : edge < 4 ? 0.85 : 1;
    c = c.map((v) => v * gap);
    const i = (y * w + x) * 4;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    hgt[y * w + x] = t * 0.35 + (edge < 1.5 ? -0.5 : 0) + fine * 0.1;
    rough[y * w + x] = 0.55 + (1 - t) * 0.25 + (fine - 0.5) * 0.1;
  }
  ctx.putImageData(img, 0, 0);
  return { map: col, normalMap: normalFromHeight(hgt, w, h, 1.6), roughnessMap: grayCanvas(rough, w, h) };
}

/**
 * Wide oiled oak boards ("Landhausdielen"): `rows` boards across one texture tile, each row with one
 * butt joint at a random place, per-board tint, long calm grain and slightly bevelled edges.
 * Boards run along u. The tile wraps in both directions.
 */
function paintPlanks({ tone = 'oak', seed = 7, size = 1024, rows = 10 } = {}) {
  const tones = { oak: ['#c3aa8b', '#a68f71', '#d5c2a6'], ash: ['#d6c7ae', '#bcab8f', '#e4d8c4'], walnut: ['#8a664a', '#6b4d36', '#a37f60'] };
  const [base, dark, light] = (tones[tone] || tones.oak).map(hex);
  const w = size, h = size, rowH = h / rows;
  const rnd = mulberry32(seed * 101 + 7);
  const joints = Array.from({ length: rows }, () => rnd() * w);
  // calm: boards differ only slightly, the grain is soft and the joints are fine
  const tints = Array.from({ length: rows * 2 }, () => (rnd() - 0.5) * 0.06);
  const offs = Array.from({ length: rows * 2 }, () => rnd() * 500);
  const n1 = makeValueNoise(seed * 3 + 1, 128), n2 = makeValueNoise(seed * 5 + 2, 64);
  const col = canvas(w, h); const ctx = col.getContext('2d'); const img = ctx.createImageData(w, h); const d = img.data;
  const hgt = new Float32Array(w * h), rough = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const r = Math.floor(y / rowH), ly = y - r * rowH;
    for (let x = 0; x < w; x++) {
      // which board of this row: left or right of the joint (the tile wraps, so the joint splits the row in two)
      const jx = joints[r];
      const b = x < jx ? 0 : 1, id = r * 2 + b;
      const edgeY = Math.min(ly, rowH - ly), edgeX = Math.min(Math.abs(x - jx), Math.abs(x - jx + w), Math.abs(x - jx - w));
      const edge = Math.min(edgeY, edgeX);
      // long grain: stretched noise along the board, a few soft growth lines
      const u = x + offs[id], v = ly + offs[id] * 0.3;
      const streak = fbm(n1, u * 0.004, v * 0.09, 4);
      const lines = Math.sin(v * 0.55 + fbm(n2, u * 0.002, v * 0.02, 3) * 9) * 0.5 + 0.5;
      const fine = fbm(n2, u * 0.05, v * 0.8, 2);
      let t = clamp01(0.5 + (streak - 0.5) * 0.5 + (lines - 0.5) * 0.07 + (fine - 0.5) * 0.06 + tints[id]);
      let c = t < 0.5 ? mixColor(dark, base, t * 2) : mixColor(base, light, (t - 0.5) * 2);
      const gap = edge < 0.9 ? 0.84 : edge < 1.8 ? 0.96 : 1;
      c = c.map((q) => q * gap);
      const i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
      hgt[y * w + x] = (edge < 0.9 ? 0.35 : edge < 2 ? 0.62 : 0.7) + fine * 0.03;
      rough[y * w + x] = 0.58 + (1 - t) * 0.12 + (edge < 2 ? 0.1 : 0);
    }
  }
  ctx.putImageData(img, 0, 0);
  return { map: col, normalMap: normalFromHeight(hgt, w, h, 0.6), roughnessMap: grayCanvas(rough, w, h) };
}

/** Painted panelling: an even coat with the faintest brush marks along the boards. */
function paintPaint({ color = '#a9b49e', seed = 9, size = 256 } = {}) {
  const base = hex(color); const w = size, h = size;
  const n1 = makeValueNoise(seed + 13, 64), n2 = makeValueNoise(seed + 31, 32);
  const col = canvas(w, h); const ctx = col.getContext('2d'); const img = ctx.createImageData(w, h); const d = img.data;
  const hgt = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const brush = fbm(n1, x * 0.02, y * 0.4, 3), cloud = fbm(n2, x * 0.02, y * 0.02, 2);
    const v = 0.97 + (brush - 0.5) * 0.035 + (cloud - 0.5) * 0.03;
    const i = (y * w + x) * 4; d[i] = base[0] * v; d[i + 1] = base[1] * v; d[i + 2] = base[2] * v; d[i + 3] = 255;
    hgt[y * w + x] = brush * 0.4;
  }
  ctx.putImageData(img, 0, 0);
  return { map: col, normalMap: normalFromHeight(hgt, w, h, 0.35) };
}

/** Herringbone / plank parquet floor */
function paintParquet({ seed = 2, size = 1024, tone = 'oak', pattern = 'herringbone' } = {}) {
  const tones = { oak: ['#a4743d', '#6e4722', '#c39456'], walnut: ['#5c3b23', '#3a2314', '#7d5636'], cherry: ['#8d4d2d', '#5a2c19', '#aa6a45'] };
  const [base, dark, light] = tones[tone].map(hex);
  const w = size, h = size;
  const noise = makeValueNoise(seed * 5 + 11, 128), noise2 = makeValueNoise(seed * 9 + 2, 64);
  const col = canvas(w, h); const ctx = col.getContext('2d'); const img = ctx.createImageData(w, h); const d = img.data;
  const hgt = new Float32Array(w * h), rough = new Float32Array(w * h);
  const pw = size / 8, ph = pw / 4; // plank size
  const tintOf = (i, j) => { const r = mulberry32(i * 73856093 ^ j * 19349663 ^ seed)(); return (r - 0.5) * 0.3; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let u, v, pi, pj, gx, gy;
    if (pattern === 'herringbone') {
      // two diagonal orientations in a checker of cells
      const cell = pw; const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      const lx = x - cx * cell, ly = y - cy * cell;
      const diag = (cx + cy) % 2 === 0;
      const a = diag ? (lx + ly) : (lx - ly + cell);
      const b = diag ? (lx - ly + cell) : (lx + ly);
      pi = Math.floor(a / (ph * 1.4142)); pj = cx * 31 + cy * 17 + Math.floor(b / (pw * 1.4142));
      u = b; v = a; gx = (a % (ph * 1.4142)); gy = 0;
      var edge = Math.min(gx, ph * 1.4142 - gx);
    } else {
      pj = Math.floor(y / ph); const off = (pj % 3) * (pw / 3); pi = Math.floor((x + off) / pw);
      u = (x + off) % pw; v = y % ph; edge = Math.min(u, pw - u, v, ph - v);
    }
    const tint = tintOf(pi, pj);
    const wob = fbm(noise, (u + pi * 37) * 0.02, (v + pj * 11) * 0.05, 3) * 5;
    const ring = Math.sin((v + pj * 3) * 0.35 + wob);
    const fine = fbm(noise2, u * 0.08 + pi, v * 0.5 + pj, 3);
    let t = clamp01(0.5 + ring * 0.2 + (fine - 0.5) * 0.3 + tint);
    let c = t < 0.5 ? mixColor(dark, base, t * 2) : mixColor(base, light, (t - 0.5) * 2);
    const gap = edge < 1.2 ? 0.5 : edge < 3 ? 0.88 : 1;
    c = c.map((q) => q * gap);
    const i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    hgt[y * w + x] = t * 0.3 + (edge < 1.2 ? -0.6 : 0);
    rough[y * w + x] = 0.42 + (1 - t) * 0.2;
  }
  ctx.putImageData(img, 0, 0);
  return { map: col, normalMap: normalFromHeight(hgt, w, h, 1.4), roughnessMap: grayCanvas(rough, w, h) };
}

// ---- plaster / walls ---------------------------------------------------------
function paintPlaster({ color = '#e4d6bd', seed = 3, size = 512, strength = 1 } = {}) {
  const base = hex(color); const w = size, h = size;
  const n1 = makeValueNoise(seed + 21, 128), n2 = makeValueNoise(seed + 77, 32);
  const col = canvas(w, h); const ctx = col.getContext('2d'); const img = ctx.createImageData(w, h); const d = img.data;
  const hgt = new Float32Array(w * h), rough = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const big = fbm(n2, x * 0.01, y * 0.01, 3), fine = fbm(n1, x * 0.15, y * 0.15, 4);
    const v = 0.93 + (big - 0.5) * 0.05 * strength + (fine - 0.5) * 0.08 * strength;
    const i = (y * w + x) * 4; d[i] = base[0] * v; d[i + 1] = base[1] * v; d[i + 2] = base[2] * v; d[i + 3] = 255;
    hgt[y * w + x] = fine * 0.5 + big * 0.3; rough[y * w + x] = 0.9 - (fine - 0.5) * 0.1;
  }
  ctx.putImageData(img, 0, 0);
  return { map: col, normalMap: normalFromHeight(hgt, w, h, 0.9 * strength), roughnessMap: grayCanvas(rough, w, h) };
}

// ---- striped wallpaper (hall) ---------------------------------------------------
/** Regency stripes, tone on tone: a broad matt band, a satin band and a fine pinstripe, on a slightly
 *  cloudy paper. One texture tile covers 1.2 m of wall (boxGeoUV tile) = 8 stripe periods. */
function paintWallpaper({ color = '#e3d5b8', seed = 5, size = 512 } = {}) {
  const base = hex(color);
  const w = size, h = size, period = size / 8;
  const n1 = makeValueNoise(seed + 21, 128), n2 = makeValueNoise(seed + 5, 32);
  const col = canvas(w, h); const ctx = col.getContext('2d'); const img = ctx.createImageData(w, h); const d = img.data;
  const hgt = new Float32Array(w * h), rough = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, u = (x % period) / period;
    let tone = 1, r = 0.86, bump = 0;
    if (u < 0.46) { tone = 0.955; r = 0.9; }                          // matt band
    else if (u > 0.52 && u < 0.94) { tone = 1.0; r = 0.66; }          // satin band (a faint sheen)
    if (Math.abs(u - 0.49) < 0.012 || Math.abs(u - 0.97) < 0.01) { tone = 1.035; bump = 0.4; }   // pinstripes
    const paper = 0.975 + (fbm(n1, x * 0.12, y * 0.12, 3) - 0.5) * 0.04 + (fbm(n2, x * 0.01, y * 0.01, 2) - 0.5) * 0.03;
    for (let k = 0; k < 3; k++) d[i * 4 + k] = Math.min(255, base[k] * tone * paper);
    d[i * 4 + 3] = 255;
    hgt[i] = bump + paper * 0.2; rough[i] = r;
  }
  ctx.putImageData(img, 0, 0);
  return { map: col, normalMap: normalFromHeight(hgt, w, h, 0.5), roughnessMap: grayCanvas(rough, w, h) };
}

// ---- coffered ceiling ------------------------------------------------------------
/** Four coffers per tile (the ceiling plane tiles every 2.2 m, so one coffer is 1.1 m): a raised
 *  moulded frame, a recessed field that darkens towards its edges, and a small rosette. */
function paintCoffer({ color = '#d9cdb5', size = 512 } = {}) {
  const base = hex(color);
  const w = size, h = size, cell = size / 2;
  const n1 = makeValueNoise(41, 128);
  const col = canvas(w, h); const ctx = col.getContext('2d'); const img = ctx.createImageData(w, h); const d = img.data;
  const hgt = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = (x % cell) / cell, v = (y % cell) / cell;
    const e = Math.min(u, v, 1 - u, 1 - v);            // 0 at the frame's centre line … 0.5 in the middle
    let height, shade;
    if (e < 0.06) { height = 1; shade = 1.04; }                                   // frame
    else if (e < 0.085) { height = 1 - (e - 0.06) / 0.025 * 0.55; shade = 0.93; } // bevel
    else if (e < 0.1) { height = 0.45; shade = 0.97; }                            // bead
    else { height = 0.3; shade = 0.9 + Math.min(1, (e - 0.1) / 0.2) * 0.07; }     // field, darker near its edge
    const r = Math.hypot(u - 0.5, v - 0.5);
    if (r < 0.06) { height = 0.3 + (0.06 - r) * 6; shade = 1.0 + (0.06 - r) * 0.8; } // rosette
    const n = 0.98 + (fbm(n1, x * 0.1, y * 0.1, 3) - 0.5) * 0.05;
    const i = y * w + x;
    for (let k = 0; k < 3; k++) d[i * 4 + k] = Math.min(255, base[k] * shade * n);
    d[i * 4 + 3] = 255;
    hgt[i] = height;
  }
  ctx.putImageData(img, 0, 0);
  return { map: col, normalMap: normalFromHeight(hgt, w, h, 2.2) };
}

// ---- brick / stone (fireplace) -----------------------------------------------
function paintBrick({ seed = 4, size = 512, tone = 'red' } = {}) {
  const w = size, h = size; const noise = makeValueNoise(seed + 5, 128);
  const col = canvas(w, h); const ctx = col.getContext('2d'); const img = ctx.createImageData(w, h); const d = img.data;
  const hgt = new Float32Array(w * h), rough = new Float32Array(w * h);
  const bw = size / 6, bh = size / 14, mortar = size / 110;
  // 'white': limewashed brick, the terracotta shows through here and there
  const palette = tone === 'red' ? [['#8a4a35'], ['#9a5a40'], ['#7a3f2c'], ['#a56b4f'], ['#6f3a2a']]
    : tone === 'white' ? [['#ece6dc'], ['#e4ddd1'], ['#f2eee7'], ['#e8dfd2'], ['#dcc9b8']]
    : [['#8d8577'], ['#a29a8b'], ['#7a7266'], ['#b1a897'], ['#6a6357']];
  const mortarCol = tone === 'white' ? [214, 207, 196] : [150, 140, 128];
  const rnd = mulberry32(seed);
  const tints = new Map();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const row = Math.floor(y / bh); const off = (row % 2) * bw / 2; const colI = Math.floor((x + off) / bw);
    const lx = (x + off) % bw, ly = y % bh;
    const inMortar = lx < mortar || ly < mortar;
    const k = row * 1000 + colI;
    if (!tints.has(k)) tints.set(k, hex(palette[Math.floor(rnd() * palette.length)][0]).map((v) => v * (tone === 'white' ? 0.94 + rnd() * 0.08 : 0.85 + rnd() * 0.3)));
    const n = fbm(noise, x * 0.08, y * 0.08, 3);
    let c;
    if (inMortar) c = mortarCol.map((v) => v * (0.85 + n * 0.3));
    else c = tints.get(k).map((v) => v * (tone === 'white' ? 0.93 + n * 0.12 : 0.85 + n * 0.3));
    const i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    hgt[y * w + x] = inMortar ? 0.2 : 0.6 + n * 0.3; rough[y * w + x] = inMortar ? 0.95 : 0.8;
  }
  ctx.putImageData(img, 0, 0);
  return { map: col, normalMap: normalFromHeight(hgt, w, h, 2.2), roughnessMap: grayCanvas(rough, w, h) };
}

// ---- fabric / leather ---------------------------------------------------------
function paintFabric({ color = '#7a3b2e', seed = 6, size = 256, weave = 1 } = {}) {
  const base = hex(color); const w = size, h = size; const noise = makeValueNoise(seed + 9, 64);
  const col = canvas(w, h); const ctx = col.getContext('2d'); const img = ctx.createImageData(w, h); const d = img.data;
  const hgt = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const wv = (Math.sin(x * 1.2) * Math.sin(y * 1.2)) * 0.5 + 0.5;
    const n = fbm(noise, x * 0.1, y * 0.1, 3);
    const v = 0.85 + wv * 0.14 * weave + (n - 0.5) * 0.18;
    const i = (y * w + x) * 4; d[i] = base[0] * v; d[i + 1] = base[1] * v; d[i + 2] = base[2] * v; d[i + 3] = 255;
    hgt[y * w + x] = wv * 0.6 + n * 0.4;
  }
  ctx.putImageData(img, 0, 0);
  return { map: col, normalMap: normalFromHeight(hgt, w, h, 0.8) };
}
function paintLeather({ color = '#5a2f1f', seed = 8, size = 512 } = {}) {
  const base = hex(color); const w = size, h = size; const n1 = makeValueNoise(seed + 3, 128), n2 = makeValueNoise(seed + 4, 32);
  const col = canvas(w, h); const ctx = col.getContext('2d'); const img = ctx.createImageData(w, h); const d = img.data;
  const hgt = new Float32Array(w * h), rough = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const cells = fbm(n1, x * 0.12, y * 0.12, 2); const pores = Math.pow(fbm(n1, x * 0.5, y * 0.5, 2), 3);
    const big = fbm(n2, x * 0.01, y * 0.01, 3);
    const v = 0.8 + (cells - 0.5) * 0.25 - pores * 0.2 + (big - 0.5) * 0.25;
    const i = (y * w + x) * 4; d[i] = base[0] * v; d[i + 1] = base[1] * v; d[i + 2] = base[2] * v; d[i + 3] = 255;
    hgt[y * w + x] = cells * 0.7 - pores * 0.5; rough[y * w + x] = 0.45 + pores * 0.3 + (big - 0.5) * 0.15;
  }
  ctx.putImageData(img, 0, 0);
  return { map: col, normalMap: normalFromHeight(hgt, w, h, 1.2), roughnessMap: grayCanvas(rough, w, h) };
}

// ---- rug -------------------------------------------------------------------
/** A calm modern flat-weave: a light ground (p2), a wide diamond lattice in thin lines (p3), small motifs
 *  where the lines cross (p0/p1), a plain two-line border. The busy kilim and persian fields read as old. */
function modernRug(c, ctx, { w, h, S, rnd, p0, p1, p2, p3, seed }) {
  ctx.fillStyle = p2; ctx.fillRect(0, 0, w, h);
  const pad = S * 0.06;
  ctx.strokeStyle = p1; ctx.lineWidth = S * 0.018; ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);
  ctx.strokeStyle = p3; ctx.lineWidth = S * 0.005; ctx.strokeRect(pad + S * 0.03, pad + S * 0.03, w - (pad + S * 0.03) * 2, h - (pad + S * 0.03) * 2);
  const inner = pad + S * 0.06;
  ctx.save(); ctx.beginPath(); ctx.rect(inner, inner, w - inner * 2, h - inner * 2); ctx.clip();
  const step = S * 0.2;
  ctx.strokeStyle = p3; ctx.globalAlpha = 0.55; ctx.lineWidth = Math.max(2, S * 0.004);
  for (let k = -Math.ceil(h / step) - 2; k < Math.ceil(w / step) + 2; k++) {
    ctx.beginPath(); ctx.moveTo(k * step, 0); ctx.lineTo(k * step + h, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(k * step, h); ctx.lineTo(k * step + h, 0); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // crossings lie on a lattice of step/2 × step/2 offsets
  for (let y = -step; y < h + step; y += step / 2) for (let x = -step; x < w + step; x += step) {
    const ox = (Math.round(y / (step / 2)) % 2) * (step / 2);
    const cx = x + ox, cy = y, r = S * 0.016;
    ctx.fillStyle = rnd() < 0.5 ? p0 : p1;
    ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  // woven texture and a very soft dye variation
  const img = ctx.getImageData(0, 0, w, h); const d = img.data;
  const noise = makeValueNoise(seed + 44, 128);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = (0.93 + fbm(noise, x * 0.3, y * 0.3, 2) * 0.1) * (y % 3 === 0 ? 0.985 : 1);
    const i = (y * w + x) * 4; d[i] *= v; d[i + 1] *= v; d[i + 2] *= v;
  }
  ctx.putImageData(img, 0, 0);
  return { map: c };
}

/**
 * Hand-knotted look: a guard-band border, a field of small repeating motifs, a medallion
 * with pendants and corner spandrels, plus knot noise and abrash (subtle dye banding).
 * `style`: 'persian' | 'kilim' | 'runner' | 'modern'
 */
function paintRug({ seed = 10, size = 1024, palette = ['#7a2e2a', '#c9a35a', '#2f3f4a', '#e7dcc4'], style = 'persian', ratio = 0.66 } = {}) {
  const w = size, h = Math.max(96, Math.round(size * ratio));
  const c = canvas(w, h); const ctx = c.getContext('2d');
  const rnd = mulberry32(seed);
  const [p0, p1, p2, p3] = palette;
  const S = Math.min(w, h);
  if (style === 'modern') return modernRug(c, ctx, { w, h, S, rnd, p0, p1, p2, p3, seed });

  // --- ground + borders -----------------------------------------------------
  ctx.fillStyle = p2; ctx.fillRect(0, 0, w, h);
  const bands = [[0.030, p1], [0.052, p0], [0.085, p1], [0.100, p3], [0.112, p0]];
  for (const [f, col] of bands) { const b = S * f; ctx.fillStyle = col; ctx.fillRect(b, b, w - 2 * b, h - 2 * b); }
  const fieldPad = S * 0.112;
  const fw = w - 2 * fieldPad, fh = h - 2 * fieldPad;

  // --- main border ornament (running boteh) ---------------------------------
  const boteh = (x, y, r, col) => {
    ctx.fillStyle = col; ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.bezierCurveTo(x + r * 0.9, y - r * 0.7, x + r * 0.8, y + r * 0.6, x, y + r);
    ctx.bezierCurveTo(x - r * 0.8, y + r * 0.6, x - r * 0.9, y - r * 0.7, x, y - r);
    ctx.closePath(); ctx.fill();
  };
  const bMid = S * 0.0685, bR = S * 0.022;
  const nx = Math.max(6, Math.round(w / (S * 0.075)));
  for (let i = 0; i < nx; i++) {
    const x = bMid + (i + 0.5) * (w - 2 * bMid) / nx;
    boteh(x, bMid, bR, i % 2 ? p3 : p2); boteh(x, h - bMid, bR, i % 2 ? p2 : p3);
  }
  const ny = Math.max(4, Math.round(h / (S * 0.075)));
  for (let i = 0; i < ny; i++) {
    const y = bMid + (i + 0.5) * (h - 2 * bMid) / ny;
    boteh(bMid, y, bR, i % 2 ? p3 : p2); boteh(w - bMid, y, bR, i % 2 ? p2 : p3);
  }

  // --- field ------------------------------------------------------------------
  ctx.save(); ctx.beginPath(); ctx.rect(fieldPad, fieldPad, fw, fh); ctx.clip();
  const star = (x, y, r, col, points = 8) => {
    ctx.fillStyle = col; ctx.beginPath();
    for (let i = 0; i < points * 2; i++) { const a = (i * Math.PI) / points - Math.PI / 2; const rr = i % 2 ? r * 0.46 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  };
  if (style === 'kilim') {
    const step = S * 0.085;
    for (let y = fieldPad; y < fieldPad + fh; y += step) for (let x = fieldPad; x < fieldPad + fw; x += step) {
      const k = rnd();
      ctx.fillStyle = k < 0.34 ? p1 : k < 0.67 ? p3 : p0;
      ctx.beginPath(); ctx.moveTo(x + step / 2, y); ctx.lineTo(x + step, y + step / 2); ctx.lineTo(x + step / 2, y + step); ctx.lineTo(x, y + step / 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = p2; ctx.fillRect(x + step * 0.42, y + step * 0.42, step * 0.16, step * 0.16);
    }
  } else {
    // dense herati field
    const step = S * 0.072;
    for (let y = fieldPad - step; y < fieldPad + fh + step; y += step) {
      for (let x = fieldPad - step; x < fieldPad + fw + step; x += step) {
        const ox = ((Math.round(y / step)) % 2) * step / 2;
        star(x + ox, y, step * 0.24, p1, 8);
        ctx.strokeStyle = p3; ctx.lineWidth = Math.max(1, S * 0.0022);
        ctx.beginPath(); ctx.ellipse(x + ox, y, step * 0.42, step * 0.24, 0, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // medallion (not on runners – they have a row of them instead)
    const meds = style === 'runner' ? [0.22, 0.5, 0.78] : [0.5];
    for (const my of meds) {
      const cxm = w / 2, cym = style === 'runner' ? h * 0.5 : h / 2;
      const cxr = style === 'runner' ? w * my : cxm;
      const R = style === 'runner' ? Math.min(fh * 0.42, fw * 0.12) : Math.min(fh * 0.40, fw * 0.28);
      const rings = [[1.0, p3], [0.84, p0], [0.66, p1], [0.46, p3], [0.26, p2], [0.12, p1]];
      for (const [f, col] of rings) {
        ctx.fillStyle = col; ctx.beginPath();
        for (let i = 0; i < 32; i++) { const a = (i * Math.PI) / 16; const rr = R * f * (i % 2 ? 0.76 : 1); ctx.lineTo(cxr + Math.cos(a) * rr, cym + Math.sin(a) * rr * 0.92); }
        ctx.closePath(); ctx.fill();
      }
      if (style !== 'runner') {
        ctx.fillStyle = p3;
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cxr, cym + s * R * 1.22, R * 0.16, R * 0.3, 0, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    // corner spandrels
    if (style !== 'runner') {
      ctx.fillStyle = p0;
      for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const x = fieldPad + sx * fw, y = fieldPad + sy * fh;
        ctx.beginPath(); ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + (sx ? -1 : 1) * fw * 0.3, y + (sy ? -1 : 1) * fh * 0.06, x + (sx ? -1 : 1) * fw * 0.3, y + (sy ? -1 : 1) * fh * 0.36);
        ctx.lineTo(x, y + (sy ? -1 : 1) * fh * 0.36); ctx.closePath(); ctx.fill();
      }
    }
  }
  ctx.restore();

  // --- fringes on the short sides ---------------------------------------------
  const fringe = Math.max(4, S * 0.022);
  ctx.fillStyle = '#e8ddc2';
  ctx.fillRect(0, 0, w, S * 0.012); ctx.fillRect(0, h - S * 0.012, w, S * 0.012);
  ctx.strokeStyle = 'rgba(225,214,186,0.9)'; ctx.lineWidth = Math.max(1, S * 0.003);
  for (let x = 2; x < w; x += Math.max(3, S * 0.008)) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (rnd() - 0.5) * 3, fringe); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + (rnd() - 0.5) * 3, h - fringe); ctx.stroke();
  }

  // --- knot noise + abrash -----------------------------------------------------
  const img = ctx.getImageData(0, 0, w, h); const d = img.data;
  const noise = makeValueNoise(seed + 44, 128), band = makeValueNoise(seed + 91, 32);
  for (let y = 0; y < h; y++) {
    const ab = 0.94 + fbm(band, 0.5, y * 0.02, 2) * 0.12;
    for (let x = 0; x < w; x++) {
      const knot = ((x % 3 === 0 ? 0.96 : 1) * (y % 2 === 0 ? 0.98 : 1));
      const v = (0.88 + fbm(noise, x * 0.45, y * 0.45, 2) * 0.24) * ab * knot;
      const i = (y * w + x) * 4; d[i] *= v; d[i + 1] *= v; d[i + 2] *= v;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { map: c };
}

// ---- marble / stone -------------------------------------------------------------
function paintMarble({ seed = 12, size = 512, base = '#d8d2c6', vein = '#7d7468' } = {}) {
  const b = hex(base), v = hex(vein); const w = size, h = size; const n1 = makeValueNoise(seed + 1, 128), n2 = makeValueNoise(seed + 2, 64);
  const col = canvas(w, h); const ctx = col.getContext('2d'); const img = ctx.createImageData(w, h); const d = img.data; const rough = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = Math.abs(Math.sin((x * 0.015 + fbm(n1, x * 0.02, y * 0.02, 4) * 8 + y * 0.004) * 2));
    const veins = Math.pow(1 - t, 12) * 0.8 + Math.pow(1 - Math.abs(Math.sin(y * 0.02 + fbm(n2, x * 0.01, y * 0.03, 3) * 6)), 20) * 0.5;
    const c = mixColor(b, v, clamp01(veins)); const i = (y * w + x) * 4;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; rough[y * w + x] = 0.25 + veins * 0.2;
  }
  ctx.putImageData(img, 0, 0);
  return { map: col, roughnessMap: grayCanvas(rough, w, h) };
}

// ---- paper (open book pages) ---------------------------------------------------
function paintPaper({ size = 256, seed = 15 } = {}) {
  const w = size, h = size; const noise = makeValueNoise(seed, 64);
  const col = canvas(w, h); const ctx = col.getContext('2d'); const img = ctx.createImageData(w, h); const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = 235 + (fbm(noise, x * 0.2, y * 0.2, 3) - 0.5) * 26; const i = (y * w + x) * 4; d[i] = v + 8; d[i + 1] = v + 2; d[i + 2] = v - 14; d[i + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return { map: col };
}

// ---- newspapers (the main thread only: fonts) ----------------------------------------
/** The paper grain of a newspaper page (newspaperTexture draws the rest with fonts): two octaves of value noise
 *  (makeValueNoise and fbm, sampled at x · 0.3, y · 0.3) multiplied into the page. The cell and the eased fraction of
 *  every column and every row are worked out once per octave instead of per pixel, with the same expressions in the
 *  same order: the same bytes, ten times faster (the nine pages of the rack took 190 ms of every start). */
export function paperGrain(ctx, width, height, seed) {
  const s = 64, rnd = mulberry32(seed + 7), g = new Float32Array(s * s);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const fade = (t) => t * t * (3 - 2 * t);
  const axis = (len, f) => {
    const i0 = new Int32Array(len), i1 = new Int32Array(len), t = new Float64Array(len);
    for (let k = 0; k < len; k++) { let x = k * 0.3 * f; x = ((x % s) + s) % s; const x0 = Math.floor(x); i0[k] = x0; i1[k] = (x0 + 1) % s; t[k] = fade(x - x0); }
    return { i0, i1, t };
  };
  const xa = axis(width, 1), xb = axis(width, 2), ya = axis(height, 1), yb = axis(height, 2);
  const img = ctx.getImageData(0, 0, width, height); const d = img.data;
  for (let y = 0; y < height; y++) {
    const ra0 = ya.i0[y] * s, ra1 = ya.i1[y] * s, fya = ya.t[y], rb0 = yb.i0[y] * s, rb1 = yb.i1[y] * s, fyb = yb.t[y];
    for (let x = 0; x < width; x++) {
      // fbm: 1 × the first octave + 0.5 × the second, over 1.5
      let fx = xa.t[x], x0 = xa.i0[x], x1 = xa.i1[x];
      let a = g[ra0 + x0], b = g[ra0 + x1], c = g[ra1 + x0], e = g[ra1 + x1];
      let v = 0;
      v += 1 * ((a + (b - a) * fx) * (1 - fya) + (c + (e - c) * fx) * fya);
      fx = xb.t[x]; x0 = xb.i0[x]; x1 = xb.i1[x];
      a = g[rb0 + x0]; b = g[rb0 + x1]; c = g[rb1 + x0]; e = g[rb1 + x1];
      v += 0.5 * ((a + (b - a) * fx) * (1 - fyb) + (c + (e - c) * fx) * fyb);
      const w = 0.96 + v / 1.5 * 0.07, i = (y * width + x) * 4;
      d[i] *= w; d[i + 1] *= w; d[i + 2] *= w * 0.99;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ---- the quick sketches in the frames (ui/paintings.js) --------------------------------------
const SKETCH_PALETTES = {
  'mountain-lake': ['#bcd0e3', '#7d9bb8', '#3f5d72', '#e7ecef'],
  'lily-pond': ['#cfe0d0', '#7fa682', '#3f6b52', '#efe6c8'],
  'haystacks': ['#f0dfae', '#d9b475', '#a97c45', '#e9e2cd'],
  'sunset-sea': ['#f6d2a6', '#e79b6b', '#8a5a6b', '#f7ead8'],
  'garden-path': ['#dfe4c0', '#a8bd7e', '#6d854f', '#efe8d2'],
  lavender: ['#ded3ea', '#a493c6', '#6c5f92', '#efeaf3'],
  'misty-forest': ['#d7dfd8', '#93a894', '#4f6b58', '#eef1ec'],
  meadow: ['#e5eac4', '#b4c887', '#7d9b57', '#f2f0da'],
  sailboat: ['#cfe2ee', '#88aac6', '#456a87', '#f4efe2'],
  winter: ['#e9eff4', '#bcc9d6', '#7d8ea1', '#fbfcfd'],
  lighthouse: ['#dbe6ee', '#9bb3c6', '#5a7085', '#f0e3cf'],
  'rainy-city': ['#d4d7dd', '#9aa0aa', '#5f666f', '#e9e6de'],
};
/**
 * A quick, soft landscape in watercolour colours for a frame until the proper watercolour has been painted
 * (ui/paintings.js): milliseconds, not seconds. 640 × 460.
 */
function paintSketch({ seed = 11, motif = 'meadow' } = {}) {
  const W = 640, H = 460;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const rn = mulberry32(seed * 7919 + 13);
  const [sky, mid, dark, paper] = SKETCH_PALETTES[motif] || SKETCH_PALETTES.meadow;

  ctx.fillStyle = paper; ctx.fillRect(0, 0, W, H);
  // wash of sky
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.72);
  g.addColorStop(0, sky); g.addColorStop(1, paper);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * 0.72);
  // sun / moon
  ctx.globalAlpha = 0.5; ctx.fillStyle = paper;
  ctx.beginPath(); ctx.arc(W * (0.2 + rn() * 0.6), H * (0.15 + rn() * 0.15), 26 + rn() * 22, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;

  // three soft hill bands
  const bands = [[0.52, mid, 0.55], [0.62, dark, 0.7], [0.72, dark, 0.9]];
  for (const [y, col, alpha] of bands) {
    ctx.globalAlpha = alpha * 0.75;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, H * y + rn() * 20);
    for (let x = 0; x <= W; x += 40) {
      const yy = H * y + Math.sin((x / W) * (2 + rn() * 3) * Math.PI + seed) * (10 + rn() * 26);
      ctx.lineTo(x, yy);
    }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // foreground: water or meadow
  const fg = ctx.createLinearGradient(0, H * 0.72, 0, H);
  fg.addColorStop(0, dark); fg.addColorStop(1, mid);
  ctx.globalAlpha = 0.72; ctx.fillStyle = fg; ctx.fillRect(0, H * 0.72, W, H * 0.28); ctx.globalAlpha = 1;

  // a few trees / strokes
  ctx.globalAlpha = 0.6; ctx.fillStyle = dark;
  for (let i = 0; i < 16; i++) {
    const x = rn() * W, y = H * (0.66 + rn() * 0.26), s = 8 + rn() * 26;
    ctx.beginPath(); ctx.ellipse(x, y, s * 0.42, s, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // paper grain + a wet edge so it reads as watercolour, not as a gradient
  const img = ctx.getImageData(0, 0, W, H); const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rn() - 0.5) * 16;
    d[i] = Math.min(255, d[i] + n); d[i + 1] = Math.min(255, d[i + 1] + n); d[i + 2] = Math.min(255, d[i + 2] + n);
  }
  ctx.putImageData(img, 0, 0);
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.78);
  vig.addColorStop(0, 'rgba(255,255,255,0)'); vig.addColorStop(1, 'rgba(255,252,242,0.55)');
  ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);
  return { map: c };
}

/** The painters by kind, and the key of a painting: its kind and every parameter that shapes it. */
export const PAINTERS = { wood: paintWood, planks: paintPlanks, paint: paintPaint, parquet: paintParquet, plaster: paintPlaster, wallpaper: paintWallpaper, coffer: paintCoffer, brick: paintBrick, fabric: paintFabric, leather: paintLeather, rug: paintRug, marble: paintMarble, paper: paintPaper, sketch: paintSketch };
const KEYS = {
  wood: ({ tone = 'oak', seed = 1, size = 512, planks = 4, along = 'x', grainScale = 1, contrast = 1 }) => `wood:${tone}:${seed}:${size}:${planks}:${along}:${grainScale}:${contrast}`,
  planks: ({ tone = 'oak', seed = 7, size = 1024, rows = 10 }) => `planks:${tone}:${seed}:${size}:${rows}`,
  paint: ({ color = '#a9b49e', seed = 9, size = 256 }) => `paint:${color}:${seed}:${size}`,
  parquet: ({ seed = 2, size = 1024, tone = 'oak', pattern = 'herringbone' }) => `parquet:${seed}:${size}:${tone}:${pattern}`,
  plaster: ({ color = '#e4d6bd', seed = 3, size = 512, strength = 1 }) => `plaster:${color}:${seed}:${size}:${strength}`,
  wallpaper: ({ color = '#e3d5b8', seed = 5, size = 512 }) => `wallpaper:${color}:${seed}:${size}`,
  coffer: ({ color = '#d9cdb5', size = 512 }) => `coffer:${color}:${size}`,
  brick: ({ seed = 4, size = 512, tone = 'red' }) => `brick:${seed}:${size}:${tone}`,
  fabric: ({ color = '#7a3b2e', seed = 6, size = 256, weave = 1 }) => `fabric:${color}:${seed}:${size}:${weave}`,
  leather: ({ color = '#5a2f1f', seed = 8, size = 512 }) => `leather:${color}:${seed}:${size}`,
  rug: ({ seed = 10, size = 1024, palette = ['#7a2e2a', '#c9a35a', '#2f3f4a', '#e7dcc4'], style = 'persian', ratio = 0.66 }) => `rug:${seed}:${size}:${palette.join()}:${style}:${ratio}`,
  marble: ({ seed = 12, size = 512, base = '#d8d2c6', vein = '#7d7468' }) => `marble:${seed}:${size}:${base}:${vein}`,
  paper: ({ size = 256, seed = 15 }) => `paper:${size}:${seed}`,
  sketch: ({ seed = 11, motif = 'meadow' }) => `sketch:${seed}:${motif}`,
};
export function keyOf(kind, opts = {}) { return KEYS[kind](opts); }
// the fields of a key in order (n: a number, s: a string, p: a palette of colours joined by commas), so that a key
// names its painting again (texture-store.js: the standard set is a list of keys)
const FIELDS = {
  wood: [['tone', 's'], ['seed', 'n'], ['size', 'n'], ['planks', 'n'], ['along', 's'], ['grainScale', 'n'], ['contrast', 'n']],
  planks: [['tone', 's'], ['seed', 'n'], ['size', 'n'], ['rows', 'n']],
  paint: [['color', 's'], ['seed', 'n'], ['size', 'n']],
  parquet: [['seed', 'n'], ['size', 'n'], ['tone', 's'], ['pattern', 's']],
  plaster: [['color', 's'], ['seed', 'n'], ['size', 'n'], ['strength', 'n']],
  wallpaper: [['color', 's'], ['seed', 'n'], ['size', 'n']],
  coffer: [['color', 's'], ['size', 'n']],
  brick: [['seed', 'n'], ['size', 'n'], ['tone', 's']],
  fabric: [['color', 's'], ['seed', 'n'], ['size', 'n'], ['weave', 'n']],
  leather: [['color', 's'], ['seed', 'n'], ['size', 'n']],
  rug: [['seed', 'n'], ['size', 'n'], ['palette', 'p'], ['style', 's'], ['ratio', 'n']],
  marble: [['seed', 'n'], ['size', 'n'], ['base', 's'], ['vein', 's']],
  paper: [['size', 'n'], ['seed', 'n']],
  sketch: [['seed', 'n'], ['motif', 's']],
};
/** The kind and the parameters a key stands for ({ kind, opts }), or null for a key of no painter. */
export function optsOf(key) {
  const parts = String(key).split(':'), kind = parts.shift(), fields = FIELDS[kind];
  if (!fields || parts.length !== fields.length) return null;
  const opts = {};
  fields.forEach(([name, type], i) => { const v = parts[i]; opts[name] = type === 'n' ? +v : type === 'p' ? v.split(',') : v; });
  if (Object.values(opts).some((v) => typeof v === 'number' && !Number.isFinite(v))) return null;
  return keyOf(kind, opts) === key ? { kind, opts } : null;
}
