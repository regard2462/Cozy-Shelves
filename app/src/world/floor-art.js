// The floors of the rooms (floors.js, "Fußboden"): every style painted as one tile of three textures in the floor's
// own metres: the colour, the normals (from heights in millimetres) and the roughness. Pure array code without
// three.js and without a canvas: the worker (app/src/workers/floor-worker.js) paints them off the main thread, and a
// check can paint them in Node. Every tile wraps in both directions; where the style has joints, the edges of the
// tile lie on them (floors.js shifts whole rows of tiles against each other).
import { FLOOR_SPECS } from './floor-styles.js';

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const hexRgb = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** A number in [0, 1) for integer coordinates (the same for the same coordinates). */
function hash3(i, j, k) {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(k | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- noise -----------------------------------------------
// One lattice of random values for all noise. vn: value noise with a period of 1024 cells (for coordinates inside a
// board or a slab, where no tile edge cuts through); pn: value noise that wraps every p cells (for the whole tile).
const LN = 1024, LM = LN - 1;
let LAT = null;
function lattice() {
  if (!LAT) { LAT = new Float32Array(LN * LN); const r = rng(9173); for (let i = 0; i < LAT.length; i++) LAT[i] = r(); }
  return LAT;
}
function vn(x, y) {
  const L = LAT, xi = Math.floor(x), yi = Math.floor(y);
  let fx = x - xi, fy = y - yi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const x0 = xi & LM, y0 = yi & LM, x1 = (x0 + 1) & LM, r0 = y0 * LN, r1 = ((y0 + 1) & LM) * LN;
  const a = L[r0 + x0], b = L[r0 + x1], c = L[r1 + x0], d = L[r1 + x1];
  return a + (b - a) * fx + (c - a + (a - b + d - c) * fx) * fy;
}
function fbm(x, y, oct) {
  let s = 0, a = 0.5, t = 0;
  for (let k = 0; k < oct; k++) { s += a * vn(x + k * 131.7, y + k * 71.3); t += a; x *= 2.03; y *= 2.03; a *= 0.5; }
  return s / t;
}
function pn(x, y, p, o) {
  const L = LAT, xi = Math.floor(x), yi = Math.floor(y);
  let fx = x - xi, fy = y - yi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p, x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
  const ox = o & LM, oy = (o >> 10) & LM, r0 = ((y0 + oy) & LM) * LN, r1 = ((y1 + oy) & LM) * LN;
  const a = L[r0 + ((x0 + ox) & LM)], b = L[r0 + ((x1 + ox) & LM)], c = L[r1 + ((x0 + ox) & LM)], d = L[r1 + ((x1 + ox) & LM)];
  return a + (b - a) * fx + (c - a + (a - b + d - c) * fx) * fy;
}
/** Round, irregular spots (specks, fossils, pits): two value noises at different angles multiplied; thresholds near
 *  the top give blobs that do not line up with the lattice. */
function spot(x, y) {
  return vn(0.8 * x - 0.6 * y + 211, 0.6 * x + 0.8 * y + 97) * vn(0.28 * x + 0.96 * y + 31, -0.96 * x + 0.28 * y + 517);
}
/** fbm over the tile (u, v in tile units): `p` cells per tile in the first octave, wrapping at every octave. */
function pfbm(u, v, p, oct, o) {
  let s = 0, a = 0.5, t = 0;
  for (let k = 0; k < oct; k++) { s += a * pn(u * p, v * p, p, o + k * 92821); t += a; p *= 2; a *= 0.5; }
  return s / t;
}
/** Fine noise in the tile's metres at about `f` cells per metre, rounded so that it wraps with the tile (sand in a
 *  joint, fibres of a carpet: things that run across the edge of the tile). */
function tileNoise(s, f, o = 0) {
  const P = Math.max(1, Math.round(s.T * f)), k = P / s.T;
  return (fx, fy) => pn(fx * k, fy * k, P, o);
}

// ---------------------------------------------------------------- the canvas of a tile -------------------------------
/** The arrays one style paints into: colour (RGBA 0…255), height (mm), roughness (0…1). */
function surface(style, size) {
  const spec = FLOOR_SPECS[style], T = spec.tile, W = size, H = size;
  lattice();
  return { style, spec, T, W, H, px: T / W, col: new Uint8ClampedArray(W * H * 4), hgt: new Float32Array(W * H), rgh: new Float32Array(W * H) };
}
function put(s, i, r, g, b, h, ro) {
  const c = s.col, k = i * 4;
  c[k] = r; c[k + 1] = g; c[k + 2] = b; c[k + 3] = 255;
  s.hgt[i] = h; s.rgh[i] = ro;
}
/** Colour of a tone ramp [dark, base, light] at t (0 dark … 0.5 base … 1 light). */
function ramp(tones, t, out) {
  const [d, b, l] = tones;
  if (t < 0.5) { const k = t * 2; out[0] = d[0] + (b[0] - d[0]) * k; out[1] = d[1] + (b[1] - d[1]) * k; out[2] = d[2] + (b[2] - d[2]) * k; }
  else { const k = Math.min(1, (t - 0.5) * 2); out[0] = b[0] + (l[0] - b[0]) * k; out[1] = b[1] + (l[1] - b[1]) * k; out[2] = b[2] + (l[2] - b[2]) * k; }
  return out;
}

// ---------------------------------------------------------------- wood -------------------------------------------------
/** A piece of wood (a board, a parquet strip): its own grain from the tree it was cut from. */
function woodPiece(r, o) {
  const flat = r() < o.flatShare;                       // flat-sawn: arches; else rift and quarter-sawn: nearly straight
  return {
    tint: 1 + (r() - 0.5) * o.tintVar, warm: (r() - 0.5) * o.warmVar,
    c0: (r() * 3 - 1) * o.width * 1000, d0: 2 + r() * (flat ? 16 : 70), slope: flat ? 0.02 + r() * 0.05 : r() * 0.005,
    a0: r() * 3000, ox: r() * 500, oy: r() * 500, sap: o.sapShare && r() < o.sapShare ? (r() < 0.5 ? 1 : -1) : 0,
    lip: (r() - 0.5) * o.lip, spacing: o.spacing * (0.7 + r() * 0.6),
  };
}
const _c = [0, 0, 0];
/**
 * One pixel of wood: `a` along the grain, `c` across (metres from the piece's corner), `wid` the width of the piece,
 * `edge` the distance to its nearest edge (metres). Writes colour, height and roughness.
 */
function woodPixel(s, i, p, a, c, wid, edge, o) {
  const am = a * 1000, cm = c * 1000;
  // growth rings: the log's rings cut by the face of the board (arches on flat-sawn boards, lines on the others),
  // their width changing from year to year
  const wob = (vn(am * 0.0035 + p.ox, cm * 0.022 + p.oy) - 0.5) * 2;
  const dz = p.d0 + p.slope * (am - p.a0), dc = cm - p.c0;
  let R = Math.sqrt(dc * dc + dz * dz) + wob * o.wobble;
  R += (vn(R * 0.05 + p.ox, p.oy) - 0.5) * p.spacing * 2.4;
  const ph = R / p.spacing, year = Math.floor(ph), f = ph - year;
  const strength = 0.45 + vn(year * 0.43 + p.oy, p.ox) * 1.1;          // some years darker than others
  // earlywood (the band of big pores where a year starts) and latewood (denser, darker towards the year's end)
  const early = (1 - sstep(0, o.earlyW, f)) * sstep(0, 0.03, f);
  const late = sstep(0.3, 0.95, f);
  // pores: short dark dashes along the grain, most of them in the earlywood
  const pore = sstep(0.6, 0.82, vn(am * 0.15 + p.oy, cm * 2.3 + p.ox));
  const dash = pore * (o.poreEarly * early + o.poreAll);
  // broad figure across the rings and the colour drifting slowly along the board
  const figure = vn(R / (p.spacing * 5) + p.ox, p.oy * 0.7) - 0.5;
  const drift = vn(am * 0.0011 + p.ox * 0.3, cm * 0.005 + p.oy * 0.3) - 0.5;
  let t = 0.6 + (p.tint - 1) * 1.1 + drift * o.drift + figure * o.figure - (late * o.contrast + early * o.contrast * 0.45) * strength - dash * o.pores;
  ramp(o.tones, clamp01(t), _c);
  // warmth: a little more red or more grey from board to board
  let r = _c[0] * (1 + p.warm), g = _c[1], b = _c[2] * (1 - p.warm * 0.8);
  if (p.sap) {
    // sapwood: a pale band along one edge of some boards, its border wandering softly
    const fromEdge = p.sap > 0 ? c : wid - c;
    const sap = (1 - sstep(o.sapWidth * 0.5, o.sapWidth * 1.2, fromEdge + (vn(am * 0.004 + 7, p.oy) - 0.5) * o.sapWidth)) * 0.85;
    if (sap > 0) { const k = 0.9 + (t - 0.5) * 0.3; r = lerp(r, o.sap[0] * k, sap); g = lerp(g, o.sap[1] * k, sap); b = lerp(b, o.sap[2] * k, sap); }
  }
  const poreDark = dash;
  // the joint: a fine dark line, the micro bevel beside it a shade darker
  const gap = sstep(o.gap * 0.5, o.gap * 0.5 + s.px * 0.9, edge);
  const bev = sstep(0, o.bevel, edge);
  const shade = (0.4 + 0.6 * gap) * (0.9 + 0.1 * bev);
  r *= shade; g *= shade; b *= shade;
  const across = (c / wid) * 2 - 1;
  const h = p.lip + o.cup * (1 - across * across) + late * 0.012 - poreDark * 0.02 - (1 - bev) * (1 - bev) * o.bevelDepth - (1 - gap) * 0.5;
  const ro = o.rough + (1 - t) * 0.05 + poreDark * 0.07 + (1 - bev) * 0.12 + (1 - gap) * 0.3;
  put(s, i, r, g, b, h, clamp01(ro));
}

/** Boards in rows along x: `rows` per tile, each row cut into boards of random lengths that wrap round the tile. */
function boards(s, o) {
  const { W, H, T, px } = s;
  const r = rng(o.seed);
  const rows = Math.max(1, Math.round(T / o.width)), rowH = T / rows;
  const rowsData = [];
  for (let k = 0; k < rows; k++) {
    // lengths that add up to the tile exactly, starting at a random point of the row
    const n = Math.max(1, Math.round(T / ((o.lenMin + o.lenMax) / 2)));
    const lens = Array.from({ length: n }, () => lerp(o.lenMin, o.lenMax, r()));
    const sum = lens.reduce((x, y) => x + y, 0);
    let at = r() * T;
    const list = lens.map((l) => { const b = { start: at, len: l * T / sum, p: woodPiece(r, { ...o, width: rowH }) }; at += b.len; return b; });
    // which board each column belongs to
    const idx = new Int16Array(W), along = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) * px;
      for (let j = 0; j < list.length; j++) {
        const d = ((u - list[j].start) % T + T) % T;
        if (d < list[j].len) { idx[x] = j; along[x] = d; break; }
      }
    }
    rowsData.push({ list, idx, along });
  }
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) * px, k = Math.min(rows - 1, Math.floor(v / rowH)), row = rowsData[k], c = v - k * rowH;
    const dc = Math.min(c, rowH - c);
    for (let x = 0; x < W; x++) {
      const b = row.list[row.idx[x]], a = row.along[x];
      const edge = Math.min(dc, a, b.len - a);
      woodPixel(s, y * W + x, b.p, a, c, rowH, edge, o);
    }
  }
}

/**
 * Herringbone (Fischgrät): strips w × n·w at 45°. In the frame turned by 45° the strips stand alternately along and
 * across: H blocks [k, k+n] × [k, k+1] and V blocks [k+n, k+n+1] × [k+1−n, k+1] (in strip widths), repeated by the
 * lattice (1, 1) and (n, −n). Along x the pattern repeats every √2·w, along z every n·√2·w.
 */
const SEAM = 1e-9;   // (in strip widths: far below a pixel, far above the rounding of the coordinates)
function herringbone(s, o) {
  const { W, H, px } = s;
  const w = o.width, n = o.ratio, q = 1 / (Math.SQRT2 * w);
  const Mx = Math.round(s.T / (Math.SQRT2 * w)), My = Math.round(s.T / (n * Math.SQRT2 * w));
  const r = rng(o.seed);
  const pieces = new Map();
  const pieceOf = (type, k, m) => {
    const key = type * 100000 + (((k % Mx) + Mx) % Mx) * 100 + (((m % My) + My) % My);
    let p = pieces.get(key);
    if (!p) { p = woodPiece(r, { ...o, width: w }); pieces.set(key, p); }
    return p;
  };
  for (let y = 0; y < H; y++) {
    const fy = (y + 0.5) * px;
    for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) * px;
      const X = (fx - fy) * q, Y = (fx + fy) * q;
      const m0 = Math.floor((X - Y) / (2 * n));
      let done = false;
      // the strips are tested a hair wider than they are (SEAM): a pixel whose centre lies exactly on the seam between two
      // strips (every 64th diagonal of the tile does, the pattern's period is a multiple of the pixel) fell between the two
      // half-open tests when floating point put it a bit outside both, and the fallback below painted it as a dark pit
      for (let dm = 0; dm < 3 && !done; dm++) {
        const m = m0 + (dm === 0 ? 0 : dm === 1 ? -1 : 1);
        const qx = X - m * n, qy = Y + m * n;
        let k = Math.floor(qy);
        if (qx >= k - SEAM && qx < k + n + SEAM) {
          const a = (qx - k) * w, c = (qy - k) * w;
          woodPixel(s, y * W + x, pieceOf(0, k, m), a, c, w, Math.min(a, n * w - a, c, w - c), o);
          done = true; break;
        }
        k = Math.floor(qx) - n;
        if (qy >= k + 1 - n - SEAM && qy < k + 1 + SEAM) {
          const a = (k + 1 - qy) * w, c = (qx - k - n) * w;
          woodPixel(s, y * W + x, pieceOf(1, k, m), a, c, w, Math.min(a, n * w - a, c, w - c), o);
          done = true;
        }
      }
      if (!done) put(s, y * W + x, 60, 40, 25, -0.5, 0.6);
    }
  }
}

// ---------------------------------------------------------------- stone and tiles ------------------------------------
/** A grid of square tiles of side `cell` with joints `joint` wide: per pixel the tile (i, j), the position in it and the
 *  distance to its edge (negative in the joint). */
function gridAt(fx, fy, cell, joint, out) {
  const i = Math.floor(fx / cell), j = Math.floor(fy / cell);
  const lx = fx - i * cell, ly = fy - j * cell;
  out.i = i; out.j = j; out.lx = lx; out.ly = ly;
  out.edge = Math.min(lx, cell - lx, ly, cell - ly) - joint / 2;
  return out;
}

/** Polished marble in a chequerboard: white Carrara and black Marquina, each square with veins of its own. */
function marble(s) {
  const { W, H, px, T } = s;
  const cell = 0.4, joint = 0.002, n = Math.round(T / cell);
  const r = rng(51);
  const sq = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const white = (i + j) % 2 === 0, a = r() * Math.PI, b = a + 0.6 + r() * 1.2;
    sq.push({
      white, ca: Math.cos(a), sa: Math.sin(a), cb: Math.cos(b), sb: Math.sin(b), ox: r() * 400, oy: r() * 400,
      lip: (r() - 0.5) * 0.06, tx: (r() - 0.5) * 0.25, ty: (r() - 0.5) * 0.25, tone: (r() - 0.5) * 0.05,
      // vein spacing and thickness (mm): Carrara soft grey veins, Marquina thin white ones
      sp1: white ? 130 + r() * 110 : 160 + r() * 140, th1: white ? 1.6 + r() * 1.8 : 0.45 + r() * 0.6, w1: 0.9 + r() * 0.8,
      sp2: white ? 60 + r() * 50 : 55 + r() * 45, th2: white ? 0.35 : 0.22,
    });
  }
  const WHITE = { base: [236, 233, 228], cloud: [217, 214, 208], vein: [120, 126, 136], halo: [196, 198, 201], fine: [170, 173, 179] };
  const BLACK = { base: [24, 24, 27], cloud: [40, 39, 43], vein: [228, 223, 214], halo: [70, 68, 70], fine: [150, 147, 144] };
  const g = {};
  const sandAt = tileNoise(s, 2600, 1), microAt = tileNoise(s, 900, 2);
  for (let y = 0; y < H; y++) {
    const fy = (y + 0.5) * px;
    for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) * px, idx = y * W + x;
      gridAt(fx, fy, cell, joint, g);
      const t = sq[(((g.j % n) + n) % n) * n + (((g.i % n) + n) % n)];
      if (g.edge < -px * 0.5) {
        const sand = sandAt(fx, fy);
        put(s, idx, 196 + sand * 16, 190 + sand * 15, 178 + sand * 14, -0.6, 0.86);
        continue;
      }
      const P = t.white ? WHITE : BLACK;
      const X = g.lx * 1000, Y = g.ly * 1000;                                          // mm in the square
      // main veins: long lines that wander across the square in one direction, thicker and thinner, fading in and out
      const qa = X * t.ca + Y * t.sa, qb = -X * t.sa + Y * t.ca;
      const warp = fbm(X * 0.004 + t.ox, Y * 0.004 + t.oy, 4) - 0.5, warp2 = fbm(X * 0.013 + t.oy, Y * 0.013 + t.ox, 3) - 0.5;
      const phi1 = qb / t.sp1 + warp * t.w1 + warp2 * 0.22;
      const d1 = Math.abs(phi1 - Math.round(phi1)) * t.sp1;
      const th = t.th1 * (0.35 + 1.3 * vn(qa * 0.012 + t.ox, t.oy + Math.round(phi1) * 7));
      const on1 = sstep(0.28, 0.62, vn(qa * 0.005 + t.oy + Math.round(phi1) * 13, t.ox));
      const vein = Math.exp(-(d1 / th) * (d1 / th)) * on1, halo = Math.exp(-(d1 / (th * 5)) * (d1 / (th * 5))) * on1;
      // fine veins in another direction, only here and there
      const qc = X * t.cb + Y * t.sb;
      const phi2 = qc / t.sp2 + (fbm(X * 0.009 + 50, Y * 0.009 + t.ox, 3) - 0.5) * 3;
      const d2 = Math.abs(phi2 - Math.round(phi2)) * t.sp2;
      const fine = Math.exp(-(d2 / t.th2) * (d2 / t.th2)) * sstep(0.6, 0.85, vn(qc * 0.007 + 9 + Math.round(phi2) * 5, X * 0.002 + Y * 0.002 + t.oy));
      // soft clouds in the stone (grey drifts through the white)
      const cloud = fbm(X * 0.005 + t.oy, Y * 0.005 + t.ox, 4);
      const k = clamp01((cloud - 0.38) * (t.white ? 2.3 : 1.7));
      let rr = lerp(P.base[0], P.cloud[0], k), gg = lerp(P.base[1], P.cloud[1], k), bb = lerp(P.base[2], P.cloud[2], k);
      const hs = Math.min(1, halo * (t.white ? 0.45 : 0.35)), vs = Math.min(1, vein * (t.white ? 0.8 : 0.92)), fs = Math.min(1, fine * (t.white ? 0.4 : 0.5));
      rr = lerp(lerp(lerp(rr, P.halo[0], hs), P.fine[0], fs), P.vein[0], vs);
      gg = lerp(lerp(lerp(gg, P.halo[1], hs), P.fine[1], fs), P.vein[1], vs);
      bb = lerp(lerp(lerp(bb, P.halo[2], hs), P.fine[2], fs), P.vein[2], vs);
      const tone = 1 + t.tone;
      // a polished edge: a fine bevel, a hint of shadow in it
      const bev = sstep(0, 0.0012, g.edge), lip = t.lip + t.tx * (g.lx - cell / 2) + t.ty * (g.ly - cell / 2);
      const sh = 0.82 + 0.18 * bev;
      const micro = microAt(fx, fy);
      put(s, idx, rr * tone * sh, gg * tone * sh, bb * tone * sh, lip - (1 - bev) * (1 - bev) * 0.5 + micro * 0.004 - vein * 0.004, clamp01((t.white ? 0.13 : 0.11) + vein * 0.05 + micro * 0.03 + (1 - bev) * 0.25));
    }
  }
}

/** Handmade terracotta (Cotto): warm tiles that differ from each other, mottled and a little uneven, with a sandy joint. */
function terracotta(s) {
  const { W, H, px, T } = s;
  const cell = 0.3, joint = 0.009, n = Math.round(T / cell);
  const pal = ['#b0552f', '#bd6537', '#a34a2b', '#c27443', '#9a4628', '#c6804e', '#b25e36', '#a9532f'].map(hexRgb);
  const r = rng(77);
  const tiles = [];
  for (let k = 0; k < n * n; k++) {
    const c = pal[Math.floor(r() * pal.length)], l = 1 + (r() - 0.5) * 0.14;
    tiles.push({ c: [c[0] * l, c[1] * l, c[2] * l], ox: r() * 600, oy: r() * 600, lip: (r() - 0.5) * 0.5, tx: (r() - 0.5) * 2.2, ty: (r() - 0.5) * 2.2, wax: (r() - 0.5) * 0.1 });
  }
  const g = {};
  const sandAt = tileNoise(s, 1800, 3);
  for (let y = 0; y < H; y++) {
    const fy = (y + 0.5) * px, v = fy / T;
    for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) * px, idx = y * W + x;
      gridAt(fx, fy, cell, joint, g);
      // the edge of a handmade tile wobbles a little
      const edge = g.edge + (pn(fx / T * 240, v * 240, 240, 5) - 0.5) * 0.0016;
      const sand = sandAt(fx, fy), dirt = pfbm(fx / T, v, 24, 3, 77);
      const jr = 172 - dirt * 28 + sand * 22, jg = 160 - dirt * 26 + sand * 20, jb = 140 - dirt * 22 + sand * 18;
      if (edge < -px) { put(s, idx, jr, jg, jb, -2.4 + sand * 0.25, 0.93); continue; }
      const t = tiles[(((g.j % n) + n) % n) * n + (((g.i % n) + n) % n)];
      const lxm = g.lx * 1000, lym = g.ly * 1000;
      const mott = fbm(lxm * 0.012 + t.ox, lym * 0.012 + t.oy, 4), fine = vn(lxm * 0.6 + t.oy, lym * 0.6 + t.ox);
      const dark = sstep(0.6, 0.68, spot(lxm * 0.5 + t.ox * 2, lym * 0.5 + t.oy * 2)), lime = sstep(0.64, 0.72, spot(lxm * 0.42 + t.oy, lym * 0.42 + t.ox * 3));
      // fired darker towards the edges, lighter clouds in the middle, dark grains and pale bits of lime
      const burn = 1 - 0.13 * (1 - sstep(0, 0.035, edge));
      const k = (0.86 + (mott - 0.5) * 0.36 + (fine - 0.5) * 0.06) * burn * (1 - dark * 0.3);
      let rr = t.c[0] * k, gg = t.c[1] * k, bb = t.c[2] * k;
      rr = lerp(rr, 220, lime * 0.5); gg = lerp(gg, 196, lime * 0.5); bb = lerp(bb, 160, lime * 0.5);
      // rounded edges, a soft dip here and there, a slightly tilted tile
      const round = 1 - sstep(0, 0.0045, edge);
      const h = t.lip + t.tx * (g.lx / cell - 0.5) + t.ty * (g.ly / cell - 0.5) + (mott - 0.5) * 0.45 - round * round * 1.4 - dark * 0.1;
      const cov = sstep(-px, px, edge);   // the joint's sand blends into the rounded edge
      put(s, idx, lerp(jr, rr, cov), lerp(jg, gg, cov), lerp(jb, bb, cov), lerp(-2.4, h, cov), lerp(0.93, clamp01(0.5 + t.wax + (1 - mott) * 0.12 + round * 0.15), cov));
    }
  }
}

/** Limestone slabs in rows of 40 and 60 cm, 40 to 80 cm long, honed, with fossils, clouds and slightly chipped edges. */
function stone(s) {
  const { W, H, px, T } = s;
  const joint = 0.004;
  const r = rng(91);
  const rowHs = [0.6, 0.4, 0.6, 0.4, 0.4];
  const pal = ['#cfc6b4', '#c8bca6', '#d6cdbc', '#c0b49f', '#cbc2b1', '#d1c4ab', '#bfb7a8'].map(hexRgb);
  const rows = [];
  let y0 = 0;
  for (const rh of rowHs) {
    // slab lengths of 40, 60 and 80 cm that fill the row exactly (no sliver at its end)
    const lens = [];
    let rem = T;
    while (rem > 0.8 + 1e-6) {
      const fit = [0.4, 0.6, 0.8].filter((l) => rem - l >= 0.4 - 1e-6);
      const l = fit[Math.floor(r() * fit.length)];
      lens.push(l); rem -= l;
    }
    lens.push(Math.round(rem * 10) / 10);
    let at = Math.round(r() * T / 0.2) * 0.2;
    const slabs = lens.map((l) => { const c = pal[Math.floor(r() * pal.length)], k = 1 + (r() - 0.5) * 0.1; const sl = { start: at, len: l, c: [c[0] * k, c[1] * k, c[2] * k], ox: r() * 700, oy: r() * 700, tx: (r() - 0.5) * 1.6, ty: (r() - 0.5) * 1.6, lip: (r() - 0.5) * 0.5, bed: r() < 0.35 }; at += l; return sl; });
    rows.push({ y0, h: rh, slabs });
    y0 += rh;
  }
  const sandAt = tileNoise(s, 2200, 4);
  for (let y = 0; y < H; y++) {
    const fy = (y + 0.5) * px;
    let row = rows[rows.length - 1];
    for (const rw of rows) if (fy >= rw.y0 && fy < rw.y0 + rw.h) { row = rw; break; }
    const ly = fy - row.y0;
    for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) * px, idx = y * W + x;
      let sl = row.slabs[0], lx = 0;
      for (const c of row.slabs) { const d = ((fx - c.start) % T + T) % T; if (d < c.len) { sl = c; lx = d; break; } }
      const lxm = lx * 1000, lym = ly * 1000;
      // chipped edges: the edge of the slab bites in here and there
      const chip = sstep(0.72, 0.95, vn(lxm * 0.05 + sl.ox, lym * 0.05 + sl.oy)) * 0.003;
      const edge = Math.min(lx, sl.len - lx, ly, row.h - ly) - joint / 2 - chip;
      const sand = sandAt(fx, fy);
      if (edge < -px) { put(s, idx, 146 + sand * 18, 140 + sand * 16, 130 + sand * 15, -3 + sand * 0.3, 0.95); continue; }
      const cloud = fbm(lxm * 0.006 + sl.ox, lym * 0.006 + sl.oy, 4), grain = vn(lxm * 0.8 + sl.oy, lym * 0.8 + sl.ox), grain2 = vn(lxm * 2.1 + 9, lym * 2.1 + sl.ox);
      // fossils: small darker fragments, a few pale spots
      const fos = spot(lxm * 0.3 + sl.oy * 2, lym * 0.3 + sl.ox * 2), fosDark = sstep(0.62, 0.72, fos);
      const pale = sstep(0.66, 0.74, spot(lxm * 0.12 + sl.ox, lym * 0.12 + 40));
      let k = 0.93 + (cloud - 0.5) * 0.16 + (grain - 0.5) * 0.06 + (grain2 - 0.5) * 0.05 - fosDark * 0.16 + pale * 0.05;
      // faint bedding along some slabs
      if (sl.bed) k += (vn(lym * 0.22 + (cloud - 0.5) * 9, lxm * 0.004 + sl.ox) - 0.5) * 0.045;
      const round = 1 - sstep(0, 0.003, edge);
      k *= 1 - round * 0.12;
      const relief = (fbm(lxm * 0.02 + sl.ox, lym * 0.02 + sl.oy, 3) - 0.5) * 0.35 + (grain - 0.5) * 0.04;
      const h = sl.lip + sl.tx * (lx / sl.len - 0.5) + sl.ty * (ly / row.h - 0.5) + relief - round * round * 1.6 - fosDark * 0.05;
      const cov = sstep(-px, px, edge);
      put(s, idx, lerp(146, sl.c[0] * k, cov), lerp(140, sl.c[1] * k, cov), lerp(130, sl.c[2] * k, cov), lerp(-3, h, cov), lerp(0.95, clamp01(0.52 + (0.5 - relief) * 0.12 + round * 0.2 + (grain2 - 0.5) * 0.06), cov));
    }
  }
}

/** Polished terrazzo: marble chips of many colours and sizes in a pale cement, brass strips round fields of a metre. */
function terrazzo(s) {
  const { W, H, px, T } = s;
  const field = 1.0, strip = 0.003;
  // the cement: warm white with fine sand
  const sandAt = tileNoise(s, 2400, 5), brassAt = tileNoise(s, 700, 6);
  for (let y = 0; y < H; y++) {
    const fy = (y + 0.5) * px, v = fy / T;
    for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) * px;
      const sand = sandAt(fx, fy), cl = pfbm(fx / T, v, 12, 3, 31);
      const k = 0.97 + (sand - 0.5) * 0.08 + (cl - 0.5) * 0.06;
      const pit = sand > 0.97 ? 1 : 0;
      put(s, y * W + x, 226 * k, 221 * k, 211 * k, -pit * 0.08, 0.24 + (sand - 0.5) * 0.04 + pit * 0.2);
    }
  }
  // the chips: convex stones, many small, some middle, a few large; they wrap round the tile
  const r = rng(63);
  // white and grey marble most of all, some black, a little terracotta, ochre and green
  const kinds = [[243, 240, 233, 0.3], [224, 219, 208, 0.17], [192, 189, 183, 0.15], [140, 138, 135, 0.1], [56, 55, 58, 0.09], [172, 104, 78, 0.07], [196, 162, 104, 0.06], [146, 156, 138, 0.04], [208, 176, 160, 0.02]];
  const total = kinds.reduce((a, k) => a + k[3], 0);
  const cover = 0.72 * T * T;
  let area = 0;
  const mask = new Float32Array(W * H);
  while (area < cover) {
    const q = r();
    const rad = q < 0.62 ? 0.0015 + r() * 0.0015 : q < 0.93 ? 0.003 + r() * 0.0032 : 0.0062 + r() * 0.0055;
    let pick = r() * total, kind = kinds[0];
    for (const k of kinds) { pick -= k[3]; if (pick <= 0) { kind = k; break; } }
    const cx = r() * T, cy = r() * T, nv = 5 + Math.floor(r() * 4), rot = r() * TAU;
    const pts = [];
    for (let k = 0; k < nv; k++) { const a = rot + (k + 0.15 + r() * 0.7) / nv * TAU, rr = rad * (0.68 + r() * 0.5); pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
    const tone = 1 + (r() - 0.5) * 0.14, ox = r() * 900;
    area += Math.PI * rad * rad * 0.8;
    for (const du of [-T, 0, T]) for (const dv of [-T, 0, T]) {
      const x0 = cx + du, y0 = cy + dv;
      if (x0 + rad < 0 || x0 - rad > T || y0 + rad < 0 || y0 - rad > T) continue;
      chip(s, mask, pts, x0, y0, rad, kind, tone, ox);
    }
  }
  // the brass strips along the fields' edges
  for (let y = 0; y < H; y++) {
    const fy = (y + 0.5) * px;
    const dy = Math.abs(((fy + field / 2) % field) - field / 2);
    for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) * px;
      const dx = Math.abs(((fx + field / 2) % field) - field / 2);
      const d = Math.min(dx, dy) - strip / 2;
      if (d > px) continue;
      const cov = 1 - sstep(-px, px, d), idx = y * W + x, c = s.col, k4 = idx * 4;
      const br = 0.92 + brassAt(fx, fy) * 0.16;
      c[k4] = lerp(c[k4], 176 * br, cov); c[k4 + 1] = lerp(c[k4 + 1], 140 * br, cov); c[k4 + 2] = lerp(c[k4 + 2], 84 * br, cov);
      s.rgh[idx] = lerp(s.rgh[idx], 0.3, cov); s.hgt[idx] = lerp(s.hgt[idx], 0, cov);
    }
  }
}
/** One chip into the cement: a convex polygon `pts` round (cx, cy), soft at its edge (distance to the edges). */
function chip(s, mask, pts, cx, cy, rad, kind, tone, ox) {
  const { W, H, px } = s;
  const x0 = Math.max(0, Math.floor((cx - rad) / px)), x1 = Math.min(W - 1, Math.ceil((cx + rad) / px));
  const y0 = Math.max(0, Math.floor((cy - rad) / px)), y1 = Math.min(H - 1, Math.ceil((cy + rad) / px));
  const nv = pts.length, nx = new Float32Array(nv), ny = new Float32Array(nv), nd = new Float32Array(nv);
  for (let k = 0; k < nv; k++) {
    const a = pts[k], b = pts[(k + 1) % nv];
    let ex = b[0] - a[0], ey = b[1] - a[1]; const l = Math.hypot(ex, ey) || 1; ex /= l; ey /= l;
    nx[k] = ey; ny[k] = -ex; nd[k] = nx[k] * a[0] + ny[k] * a[1];   // outward normal (counter-clockwise points)
  }
  const c = s.col;
  for (let y = y0; y <= y1; y++) {
    const py = (y + 0.5) * px - cy;
    for (let x = x0; x <= x1; x++) {
      const pxx = (x + 0.5) * px - cx;
      let d = -1;
      for (let k = 0; k < nv; k++) { const e = nx[k] * pxx + ny[k] * py - nd[k]; if (e > d) d = e; }
      if (d > px) continue;
      const cov = 1 - sstep(-px * 0.7, px * 0.7, d), idx = y * W + x, k4 = idx * 4;
      const n = 0.94 + vn(pxx * 3000 + ox, py * 3000) * 0.12;
      c[k4] = lerp(c[k4], kind[0] * tone * n, cov); c[k4 + 1] = lerp(c[k4 + 1], kind[1] * tone * n, cov); c[k4 + 2] = lerp(c[k4 + 2], kind[2] * tone * n, cov);
      s.rgh[idx] = lerp(s.rgh[idx], 0.15 + (n - 0.94) * 0.2, cov);
      s.hgt[idx] = lerp(s.hgt[idx], 0.01, cov);
      if (cov > mask[idx]) mask[idx] = cov;
    }
  }
}

/** Cut-pile carpet: tufts in rows, every tuft a little lighter or darker (heather), soft fibres, very matt. */
function carpet(s) {
  const { W, H, px, T } = s;
  const nx = Math.round(T / 0.0022), ny = Math.round(T / 0.0025), sx = T / nx, sy = T / ny;
  const base = hexRgb('#5a6474');
  // every tuft: its centre a little off the grid, its yarn a little lighter or darker (a few much more: heather)
  const jx = new Float32Array(nx * ny), jy = new Float32Array(nx * ny), tn = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, h3 = hash3(i, j, 41);
    jx[k] = (hash3(i, j, 17) - 0.5) * 0.5; jy[k] = (hash3(i, j, 29) - 0.5) * 0.5;
    tn[k] = 1 + (h3 - 0.5) * 0.1 + (h3 > 0.97 ? 0.08 : h3 < 0.02 ? -0.09 : 0);
  }
  const fibAt = tileNoise(s, 4200, 7), fib2At = tileNoise(s, 1500, 8);
  for (let y = 0; y < H; y++) {
    const fy = (y + 0.5) * px, v = fy / T;
    const ty = Math.floor(fy / sy);
    for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) * px, tx = Math.floor(fx / sx);
      // the nearest tuft of the 3 × 3 round this one (wrapping with the tile)
      let best = 9, tone = 1;
      for (let j = -1; j <= 1; j++) {
        const cj = ty + j, wj = ((cj % ny) + ny) % ny;
        for (let i = -1; i <= 1; i++) {
          const ci = tx + i, k = wj * nx + ((ci % nx) + nx) % nx;
          const ddx = fx - (ci + 0.5 + jx[k]) * sx, ddy = fy - (cj + 0.5 + jy[k]) * sy;
          const d = (ddx * ddx + ddy * ddy) / (sx * sx);
          if (d < best) { best = d; tone = tn[k]; }
        }
      }
      const bump = Math.exp(-best * 2.2);
      const fib = fibAt(fx, fy), fib2 = fib2At(fx, fy);
      const shade = pfbm(fx / T, v, 6, 3, 13);
      const k = tone * (0.84 + bump * 0.2 + (fib - 0.5) * 0.12 + (fib2 - 0.5) * 0.06 + (shade - 0.5) * 0.08);
      put(s, y * W + x, base[0] * k, base[1] * k, base[2] * k, bump * 0.6 + fib * 0.18, clamp01(0.93 + (fib - 0.5) * 0.08));
    }
  }
}

/** Encaustic cement tiles in five colours: a star in the middle of each tile, rings that close where four tiles meet,
 *  diamonds where two meet; matt, the pigment a little cloudy, the edges a little worn. */
function cement(s) {
  const { W, H, px, T } = s;
  const cell = 0.2, joint = 0.0015, n = Math.round(T / cell);
  const C = { cream: hexRgb('#ebe1cb'), navy: hexRgb('#2f4366'), teal: hexRgb('#358581'), coral: hexRgb('#d2684e'), mustard: hexRgb('#d9a443') };
  const r = rng(39);
  const tiles = Array.from({ length: n * n }, () => ({ tone: 1 + (r() - 0.5) * 0.06, ox: r() * 500, oy: r() * 500, lip: (r() - 0.5) * 0.12, wear: r() }));
  const g = {};
  const col = [0, 0, 0];
  const lay = (c, cov) => { col[0] = lerp(col[0], c[0], cov); col[1] = lerp(col[1], c[1], cov); col[2] = lerp(col[2], c[2], cov); };
  // inside where d < 0; the pigment's border wanders a little (`wob`, per pixel)
  let wob = 0;
  const aa = (d) => 1 - sstep(-px * 0.8, px * 0.8, d + wob);
  const sandAt = tileNoise(s, 2000, 9);
  for (let y = 0; y < H; y++) {
    const fy = (y + 0.5) * px;
    for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) * px, idx = y * W + x;
      gridAt(fx, fy, cell, joint, g);
      const sand = sandAt(fx, fy);
      if (g.edge < -px) { put(s, idx, 150 + sand * 20, 146 + sand * 18, 138 + sand * 16, -0.8, 0.9); continue; }
      const t = tiles[(((g.j % n) + n) % n) * n + (((g.i % n) + n) % n)];
      const X = g.lx - cell / 2, Y = g.ly - cell / 2, dx = Math.abs(X), dy = Math.abs(Y);
      wob = (vn(g.lx * 300 + t.ox, g.ly * 300 + t.oy) - 0.5) * 0.0007;
      col[0] = C.cream[0]; col[1] = C.cream[1]; col[2] = C.cream[2];
      // rings round the corners (they close where four tiles meet)
      const rc = Math.hypot(cell / 2 - dx, cell / 2 - dy);
      lay(C.navy, aa(rc - 0.06)); lay(C.cream, aa(rc - 0.047)); lay(C.coral, aa(rc - 0.04)); lay(C.mustard, aa(rc - 0.02));
      // half diamonds in the middle of the edges (whole ones across two tiles)
      const dd = Math.min(dx + (cell / 2 - dy), (cell / 2 - dx) + dy);
      lay(C.teal, aa(dd - 0.03)); lay(C.cream, aa(dd - 0.017)); lay(C.navy, aa(dd - 0.009));
      // the star in the middle: eight points, a cream ring and a mustard heart
      const rr = Math.hypot(X, Y), th = Math.atan2(Y, X);
      const star = 0.064 * (0.58 + 0.42 * Math.pow(Math.abs(Math.cos(4 * th)), 1.6));
      lay(C.teal, aa(rr - star)); lay(C.cream, aa(rr - 0.026)); lay(C.coral, aa(rr - 0.019)); lay(C.mustard, aa(rr - 0.008));
      // cloudy pigment, a worn edge
      const lxm = g.lx * 1000, lym = g.ly * 1000;
      const cloud = fbm(lxm * 0.02 + t.ox, lym * 0.02 + t.oy, 3), grain = vn(lxm * 0.9 + t.oy, lym * 0.9 + t.ox);
      const worn = (1 - sstep(0, 0.006 + t.wear * 0.006, g.edge + (grain - 0.5) * 0.002)) * (0.25 + t.wear * 0.5);
      let k = t.tone * (0.95 + (cloud - 0.5) * 0.12 + (grain - 0.5) * 0.05);
      let rr2 = col[0] * k, gg = col[1] * k, bb = col[2] * k;
      rr2 = lerp(rr2, 214, worn * 0.4); gg = lerp(gg, 206, worn * 0.4); bb = lerp(bb, 192, worn * 0.4);
      const bev = sstep(0, 0.0008, g.edge);
      const cov = sstep(-px, px, g.edge);
      const h = t.lip + (cloud - 0.5) * 0.03 - (1 - bev) * (1 - bev) * 0.5 - (grain > 0.97 ? 0.06 : 0);
      put(s, idx, lerp(150, rr2, cov), lerp(146, gg, cov), lerp(138, bb, cov), lerp(-0.8, h, cov), lerp(0.9, clamp01(0.56 + (cloud - 0.5) * 0.12 + worn * 0.15 + (1 - bev) * 0.2), cov));
    }
  }
}

// The woods: oak is ring-porous (a band of pores where each year starts), walnut a little, maple not at all.
const OAKISH = { flatShare: 0.6, tintVar: 0.14, warmVar: 0.05, lip: 0.04, wobble: 7, drift: 0.34, figure: 0.16, contrast: 0.24, earlyW: 0.2, poreEarly: 0.9, poreAll: 0.12, pores: 0.18, sapShare: 0, sapWidth: 0.03, sap: [190, 160, 120], gap: 0.0003, bevel: 0.0012, bevelDepth: 0.45, cup: 0.05 };
const PAINT = {
  walnut: (s) => boards(s, { ...OAKISH, seed: 11, width: 0.18, lenMin: 1.1, lenMax: 2.3, tones: [[44, 30, 22], [92, 64, 45], [140, 102, 72]], spacing: 5.5, contrast: 0.3, figure: 0.24, drift: 0.42, earlyW: 0.14, poreEarly: 0.45, poreAll: 0.07, pores: 0.14, rough: 0.34, sapShare: 0.1, sapWidth: 0.045, sap: [152, 120, 88], tintVar: 0.22, warmVar: 0.05 }),
  maple: (s) => boards(s, { ...OAKISH, seed: 23, width: 0.14, lenMin: 0.7, lenMax: 1.5, tones: [[188, 164, 128], [220, 203, 172], [238, 228, 206]], spacing: 2.6, contrast: 0.09, figure: 0.12, drift: 0.24, earlyW: 0.1, poreEarly: 0, poreAll: 0.05, pores: 0.06, rough: 0.31, flatShare: 0.4, tintVar: 0.08, warmVar: 0.04, wobble: 4 }),
  herringbone: (s) => herringbone(s, { ...OAKISH, seed: 5, width: 0.07, ratio: 6, tones: [[112, 80, 52], [160, 122, 84], [200, 164, 120]], spacing: 3.6, contrast: 0.22, rough: 0.33, tintVar: 0.16, warmVar: 0.05, lip: 0.05, gap: 0.00025, bevel: 0.0008, bevelDepth: 0.3, cup: 0.02 }),
  marble, terracotta, stone, terrazzo, carpet, cement,
};

// ---------------------------------------------------------------- the three textures --------------------------------
/** Normals from the heights (mm; tile pixels of `pxmm` mm, wrapping), the roughness at half the size. */
function finish(s) {
  const { W, H, hgt, rgh } = s, pxmm = s.px * 1000;
  const normal = new Uint8ClampedArray(W * H * 4);
  const k = 1 / (2 * pxmm);
  for (let y = 0; y < H; y++) {
    const up = ((y - 1 + H) % H) * W, dn = ((y + 1) % H) * W, row = y * W;
    for (let x = 0; x < W; x++) {
      const l = hgt[row + ((x - 1 + W) % W)], r = hgt[row + ((x + 1) % W)];
      // rows run along +v (the texture is uploaded without flipping): the y slope is the one towards the next row
      const dxh = (r - l) * k, dyh = (hgt[dn + x] - hgt[up + x]) * k;
      const nx = -dxh, ny = -dyh, inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = (row + x) * 4;
      normal[i] = (nx * inv * 0.5 + 0.5) * 255; normal[i + 1] = (ny * inv * 0.5 + 0.5) * 255; normal[i + 2] = (inv * 0.5 + 0.5) * 255; normal[i + 3] = 255;
    }
  }
  const w2 = W >> 1, h2 = H >> 1, rough = new Uint8ClampedArray(w2 * h2 * 4);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
    const a = (y * 2) * W + x * 2;
    const v = (rgh[a] + rgh[a + 1] + rgh[a + W] + rgh[a + W + 1]) * 0.25 * 255;
    const i = (y * w2 + x) * 4;
    rough[i] = rough[i + 1] = rough[i + 2] = v; rough[i + 3] = 255;
  }
  return { w: W, h: H, color: s.col, normal, rough, rw: w2, rh: h2 };
}

/** Paints one floor style: { w, h, color, normal (RGBA w × h), rough (RGBA rw × rh), ms }. `size` defaults to the
 *  style's own (floor-styles.js). */
export function paintFloor(style, size) {
  const spec = FLOOR_SPECS[style];
  if (!spec || !PAINT[style]) throw new Error('unknown floor ' + style);
  const t0 = performance.now();
  const s = surface(style, size || spec.size);
  PAINT[style](s);
  const out = finish(s);
  out.ms = Math.round(performance.now() - t0);
  return out;
}

/** A small picture for the settings: about `metres` of the floor at w × h, lit from the upper left (RGBA). */
export function paintFloorPreview(style, w, h, metres = 0.9) {
  const spec = FLOOR_SPECS[style];
  if (!spec) throw new Error('unknown floor ' + style);
  const size = Math.max(64, Math.min(1024, Math.round(w * 2 * spec.tile / metres) & ~1));
  // the oak boards are textures.js's own: painted here with the walnut painter in oak tones, close enough for a swatch
  const s = surface(style, size);
  if (style === 'oak') boards(s, { ...OAKISH, seed: 7, width: 0.24, lenMin: 1.2, lenMax: 2.4, tones: [[166, 143, 113], [195, 170, 139], [213, 194, 166]], spacing: 4, contrast: 0.08, pores: 0.04, drift: 0.4, rough: 0.5, tintVar: 0.05, warmVar: 0.02, wobble: 4 });
  else PAINT[style](s);
  const f = finish(s);
  // two pixels of the tile per pixel of the picture: averaged, and lit from the upper left by the normals
  const out = new Uint8ClampedArray(w * h * 4), L = [-0.45, -0.5, 0.74];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const sx = Math.min(size - 1, x * 2 + i), sy = Math.min(size - 1, y * 2 + j), k = (sy * size + sx) * 4;
      const nx = f.normal[k] / 127.5 - 1, ny = f.normal[k + 1] / 127.5 - 1, nz = f.normal[k + 2] / 127.5 - 1;
      const lit = 0.78 + 0.32 * Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      r += f.color[k] * lit; g += f.color[k + 1] * lit; b += f.color[k + 2] * lit;
    }
    const k = (y * w + x) * 4;
    out[k] = r / 4; out[k + 1] = g / 4; out[k + 2] = b / 4; out[k + 3] = 255;
  }
  return out;
}
