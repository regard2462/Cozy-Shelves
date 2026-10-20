// Graffiti murals for the plaster walls (walls.js, "Wandgestaltung"): a sprayed background that runs round each room
// (a fade with haze, flowing ribbons, a band of clouds, a skyline of houses and books or waves above the panelling,
// paint dripping from the cornice), pieces (words in bubble or sharp letters with fades, outlines, highlights and a
// 3D block), characters, and smaller things round them (sparkles, stars, arrows, bubbles, splashes). Pure 2D canvas
// code without three.js: the worker (app/src/workers/wall-art-worker.js) paints every wall on an OffscreenCanvas.
// Seeded: one seed, one mural.
//
// A wall is painted in its own metres: u runs along the wall from its left end (as seen from the room), y is the
// height above the floor. The planner keeps pieces and characters off doors, windows, pictures, lamps, the chimney and
// the furniture in front of the wall, and in the book room above the shelves.

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- random, colour ----------------------------------
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const range = (r, a, b) => a + (b - a) * r();
const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];
const seedOf = (r) => Math.floor(r() * 1e9);
function rgbOf(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function hexOf([r, g, b]) { return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join(''); }
/** a → b by t (sRGB, good enough for paint). */
export function mix(a, b, t) { const x = rgbOf(a), y = rgbOf(b); return hexOf([lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)]); }
/** Darker (k < 0, towards a deep blue-black, as shadows on paint look) or lighter (k > 0, towards white). */
const shade = (c, k) => (k < 0 ? mix(c, '#140f24', -k) : mix(c, '#ffffff', k));
const rgba = (c, a) => { const [r, g, b] = rgbOf(c); return `rgba(${r},${g},${b},${a})`; };

// ---------------------------------------------------------------- palettes -----------------------------------------
// One palette per variant (seed 1 is the first, seed 9 the first again): the background fade (top → bottom) with haze in it, two ribbons that flow round the room,
// the band above the panelling (`floor`), the fills of the pieces (each a fade top → bottom), outline, 3D block, the
// cut line round the pieces, accents for the small things, the paint that drips from the cornice.
export const PALETTES = [
  { name: 'Abendrot', bg: ['#33246a', '#7f3584', '#d85a62', '#f6a85d'], haze: ['#b8478c', '#4c2a80', '#ff8f5e', '#e06a8a'],
    ribbons: [['#ffcf6b', 0.88], ['#ff8fc0', 0.6]], floor: 'skyline', floorColors: ['#24123c', '#3e1f5c'], cloud: '#ffc0c8', cloudShade: '#e08aa6', cloudLine: '#7d3576',
    fills: [['#8ffaff', '#3cc9e8', '#2f7fe0'], ['#fff3a0', '#ffd44d', '#ff9a3c'], ['#c0ff9e', '#4fe0a0', '#18a88f']],
    outline: '#1b0f2e', block: ['#0b3558', '#1d77a6'], cut: '#fff4dc', glow: '#ffe2b0', accents: ['#7ff7ff', '#ffe066', '#ff8fc8', '#ffffff'], drip: '#2a1648',
    backdrops: ['sun', 'rays', 'sun', 'cloud'], extras: 'stars' },
  { name: 'Ozean', bg: ['#0c4f6c', '#18839a', '#55c0c8', '#a6e6e2'], haze: ['#2aa8b8', '#0a4766', '#b0f0f0', '#1f95a8'],
    ribbons: [['#ffffff', 0.5], ['#ffd25a', 0.9]], floor: 'waves', floorColors: ['#0a3f5a', '#126e86'], cloud: '#e8fbff', cloudShade: '#9ad6e2', cloudLine: '#1c6880',
    fills: [['#ffe680', '#ffb340', '#ff6a4d'], ['#ffbde0', '#ff6fb0', '#d0367f'], ['#fff9e0', '#ffe3a0', '#ffbf6a']],
    outline: '#0a1a2a', block: ['#5c1a42', '#a1346a'], cut: '#ffffff', glow: '#ffffff', accents: ['#ffe680', '#ff6fb0', '#ffffff', '#ff8a4d'], drip: '#ffffff',
    backdrops: ['splash', 'cloud', 'rays', 'none'], extras: 'rings' },
  { name: 'Zitrus', bg: ['#ffc12e', '#ffe170', '#eef59a', '#d8f2a8'], haze: ['#ffad2a', '#fff6c2', '#c2ec7e', '#ffd04a'],
    ribbons: [['#7b3fe4', 0.85], ['#ff4fa3', 0.75]], floor: 'hills', floorColors: ['#45b866', '#2f9a52'], cloud: '#ffffff', cloudShade: '#f3e39a', cloudLine: '#c3952a',
    fills: [['#ff9cdc', '#f0459f', '#9e2179'], ['#9acdff', '#3f7ff0', '#2838b0'], ['#b0ffd1', '#2fd99a', '#0e8a77']],
    outline: '#1f1238', block: ['#341776', '#6c3fcf'], cut: '#ffffff', glow: '#ffffff', accents: ['#7b3fe4', '#f0459f', '#2fd99a', '#ffffff'], drip: '#7b3fe4',
    backdrops: ['splash', 'rays', 'splash', 'none'], extras: null },
  { name: 'Himmel', bg: ['#2b78cc', '#4f9fe2', '#8fcdf1', '#c3e9f8'], haze: ['#78c0f0', '#3a86d6', '#bfe6fa', '#5eaee8'],
    ribbons: [['#ffffff', 0.5], ['#ffd64a', 0.92]], floor: 'clouds', floorColors: ['#ffffff', '#b9d9f1'], cloud: '#ffffff', cloudShade: '#b6d6ef', cloudLine: '#5d93c9',
    fills: [['#fff06a', '#ffb13c', '#ff5268'], ['#ff9ad6', '#d66bff', '#7a54f0'], ['#b6ff8f', '#3ed6a0', '#1a9ec2']],
    outline: '#1c1640', block: ['#33207a', '#7b4bd6'], cut: '#ffffff', glow: '#ffffff', accents: ['#ffe14d', '#ff5a7a', '#8cf27a', '#ff9be0'], drip: '#ffffff',
    backdrops: ['cloud', 'rays', 'cloud', 'splash'], extras: 'rings' },
  { name: 'Nacht', bg: ['#0f1640', '#232a6e', '#463494', '#6a46a8'], haze: ['#33399a', '#5c37a6', '#16246a', '#8a4cb0'],
    ribbons: [['#5ff2ff', 0.75], ['#ff5fae', 0.75]], floor: 'skyline', floorColors: ['#080a22', '#1a1745'], cloud: '#4a4ea6', cloudShade: '#2c3080', cloudLine: '#8a8fe6',
    fills: [['#fff27a', '#ff9a3c', '#ff3c7e'], ['#8afcff', '#3cb8ff', '#5a5cff'], ['#c4ff7a', '#4fe08a', '#11a87a']],
    outline: '#06061a', block: ['#100c34', '#2c2878'], cut: '#ffffff', glow: '#9fe8ff', accents: ['#ffee70', '#7ffcff', '#ff6fb0', '#ffffff'], drip: '#ff3c7e',
    backdrops: ['moon', 'rays', 'none', 'moon'], extras: 'stars' },
  { name: 'Minze', bg: ['#0f8277', '#35b8a2', '#8fe0c8', '#d2f6e6'], haze: ['#62d8bc', '#0b6b72', '#e0fff2', '#2aa597'],
    ribbons: [['#ffffff', 0.55], ['#ff7a5c', 0.9]], floor: 'waves', floorColors: ['#0d6f72', '#1693a0'], cloud: '#ffffff', cloudShade: '#a6e6d4', cloudLine: '#2a8a82',
    fills: [['#ffe07a', '#ff9a5a', '#ff4f5a'], ['#e6b0ff', '#b46cff', '#6f37dc'], ['#fff6b0', '#ffe04d', '#f2a51f']],
    outline: '#152340', block: ['#1f3277', '#4a5fc4'], cut: '#ffffff', glow: '#ffffff', accents: ['#ff6f59', '#ffe04d', '#b46cff', '#ffffff'], drip: '#ff6f59',
    backdrops: ['splash', 'cloud', 'rays', 'splash'], extras: 'rings' },
  { name: 'Retro', bg: ['#e98f32', '#f3c26c', '#f8e3b2', '#fcf1d8'], haze: ['#ffb24f', '#e07a28', '#fff4d8', '#f5a443'],
    ribbons: [['#d8402a', 0.88], ['#1f8f8a', 0.85]], floor: 'stripes', floorColors: ['#c8352a', '#ec6f24', '#f4b630', '#1f8f8a'], cloud: '#fff6e0', cloudShade: '#f0d39a', cloudLine: '#b5722b',
    fills: [['#ff9566', '#ec4b2f', '#b0222a'], ['#86e6cf', '#2aa59a', '#16676c'], ['#fff2ac', '#ffd23f', '#f0961c']],
    outline: '#2a1710', block: ['#552816', '#984822'], cut: '#fffaf0', glow: '#fff3d6', accents: ['#1f8f8a', '#e2492f', '#fff7e3', '#3a5fa8'], drip: '#c8352a',
    backdrops: ['sun', 'rays', 'none', 'sun'], extras: null },
  { name: 'Pastell', bg: ['#9481e0', '#e494c0', '#ffc9a6', '#ffe6c4'], haze: ['#bba8ff', '#ff94bc', '#fff0d0', '#c49cf0'],
    ribbons: [['#ffffff', 0.6], ['#5fe6cc', 0.85]], floor: 'clouds', floorColors: ['#ffffff', '#e4cdf2'], cloud: '#ffffff', cloudShade: '#e2cdf0', cloudLine: '#9474c4',
    fills: [['#86f2dc', '#2ec4b0', '#128a8a'], ['#a6d8ff', '#4f9cff', '#2f52d0'], ['#ffe27a', '#ffad4a', '#ff7043']],
    outline: '#2a1b4d', block: ['#3a2b88', '#6d5bd0'], cut: '#ffffff', glow: '#ffffff', accents: ['#ffe066', '#2ec4b0', '#ff6fa8', '#ffffff'], drip: '#ffffff',
    backdrops: ['cloud', 'rays', 'none', 'cloud'], extras: 'stars' },
];

// ---------------------------------------------------------------- letters --------------------------------------------
// Skeletons in a box of height 1 (y up); the letter is that line drawn with a thick pen. M/L/C as in SVG (absolute),
// Z closes, E an ellipse (cx, cy, rx, ry), D a dot (umlauts, exclamation mark).
const GLYPHS = {
  A: [0.74, 'M0,0 L0,0.52 C0,0.86,0.16,1,0.37,1 C0.58,1,0.74,0.86,0.74,0.52 L0.74,0', 'M0,0.4 L0.74,0.4'],
  B: [0.64, 'M0,0 L0,1 L0.32,1 C0.6,1,0.6,0.55,0.3,0.55 L0,0.55', 'M0.26,0.55 C0.7,0.55,0.7,0,0.32,0 L0,0'],
  C: [0.66, 'M0.66,0.8 C0.55,1.03,0,1.05,0,0.5 C0,-0.05,0.55,-0.03,0.66,0.2'],
  D: [0.68, 'M0,0 L0,1 L0.22,1 C0.76,1,0.76,0,0.22,0 Z'],
  E: [0.58, 'M0.58,1 L0,1 L0,0 L0.58,0', 'M0,0.5 L0.46,0.5'],
  F: [0.58, 'M0.58,1 L0,1 L0,0', 'M0,0.5 L0.46,0.5'],
  G: [0.7, 'M0.66,0.8 C0.55,1.03,0,1.05,0,0.5 C0,-0.05,0.6,-0.06,0.7,0.28 L0.7,0.42 L0.42,0.42'],
  H: [0.66, 'M0,0 L0,1', 'M0.66,0 L0.66,1', 'M0,0.5 L0.66,0.5'],
  I: [0, 'M0,0 L0,1'],
  J: [0.5, 'M0.5,1 L0.5,0.32 C0.5,-0.08,0,-0.08,0,0.24'],
  K: [0.62, 'M0,0 L0,1', 'M0.62,1 L0.06,0.48 L0.62,0'],
  L: [0.54, 'M0,1 L0,0 L0.54,0'],
  M: [0.86, 'M0,0 L0,1 L0.43,0.4 L0.86,1 L0.86,0'],
  N: [0.66, 'M0,0 L0,1 L0.66,0 L0.66,1'],
  O: [0.72, 'E0.36,0.5,0.36,0.5'],
  P: [0.62, 'M0,0 L0,1 L0.3,1 C0.62,1,0.62,0.46,0.3,0.46 L0,0.46'],
  R: [0.64, 'M0,0 L0,1 L0.3,1 C0.62,1,0.62,0.5,0.3,0.5 L0,0.5', 'M0.26,0.5 L0.64,0'],
  S: [0.62, 'M0.6,0.84 C0.48,1.05,0.03,1.05,0.03,0.76 C0.03,0.5,0.62,0.54,0.62,0.25 C0.62,-0.05,0.12,-0.05,0,0.16'],
  T: [0.66, 'M0,1 L0.66,1', 'M0.33,1 L0.33,0'],
  U: [0.66, 'M0,1 L0,0.36 C0,-0.1,0.66,-0.1,0.66,0.36 L0.66,1'],
  V: [0.7, 'M0,1 L0.35,0 L0.7,1'],
  W: [0.92, 'M0,1 L0.2,0 L0.46,0.62 L0.72,0 L0.92,1'],
  X: [0.66, 'M0,1 L0.66,0', 'M0,0 L0.66,1'],
  Y: [0.66, 'M0,1 L0.33,0.5 L0.66,1', 'M0.33,0.5 L0.33,0'],
  Z: [0.62, 'M0,1 L0.62,1 L0,0 L0.62,0'],
  '!': [0, 'M0,1 L0,0.4', 'D0,0'],
  '?': [0.54, 'M0,0.78 C0.04,1.05,0.54,1.05,0.54,0.74 C0.54,0.5,0.27,0.54,0.27,0.34', 'D0.27,0'],
  '-': [0.4, 'M0,0.5 L0.4,0.5'],
};
const UMLAUT = { 'Ä': 'A', 'Ö': 'O', 'Ü': 'U' };
const ARROW_OK = new Set(['A', 'E', 'F', 'H', 'I', 'K', 'L', 'M', 'N', 'R', 'T', 'V', 'W', 'X', 'Y', 'Z']);

/** The letter styles: pen width T, outline, the 3D block, how the letters sit together. */
export const LETTER_STYLES = {
  // round, fat letters that overlap a little
  bubble: { T: 0.46, out: 0.08, cut: 0.07, block: [0.15, 0.14], over: 0.1, curve: 16, join: 'round', cap: 'round', slant: 0, rot: 0.07, bounce: 0.06, arrows: 0 },
  // slanted, faceted letters with arrows on some ends (a readable wildstyle)
  sharp: { T: 0.32, out: 0.065, cut: 0.065, block: [0.16, 0.12], over: 0.02, curve: 3, join: 'miter', cap: 'square', slant: 0.2, rot: 0.06, bounce: 0.09, arrows: 0.45 },
};

function parseSkeleton(src, curveSteps) {
  const lines = [], dots = [];
  let cur = null, x = 0, y = 0;
  for (const tok of src.trim().split(/\s+/)) {
    const cmd = tok[0], n = tok.length > 1 ? tok.slice(1).split(',').map(Number) : [];
    if (cmd === 'M') { cur = [[n[0], n[1]]]; lines.push(cur); [x, y] = n; }
    else if (cmd === 'L') { cur.push([n[0], n[1]]); [x, y] = n; }
    else if (cmd === 'C') {
      for (let i = 1; i <= curveSteps; i++) {
        const t = i / curveSteps, s = 1 - t;
        cur.push([s * s * s * x + 3 * s * s * t * n[0] + 3 * s * t * t * n[2] + t * t * t * n[4], s * s * s * y + 3 * s * s * t * n[1] + 3 * s * t * t * n[3] + t * t * t * n[5]]);
      }
      x = n[4]; y = n[5];
    } else if (cmd === 'Z') { cur.closed = true; }
    else if (cmd === 'E') {
      const steps = Math.max(8, curveSteps * 3);
      cur = []; cur.closed = true; lines.push(cur);
      for (let i = 0; i < steps; i++) { const a = Math.PI / 2 + (i / steps) * TAU; cur.push([n[0] + Math.cos(a) * n[2], n[1] + Math.sin(a) * n[3]]); }
    } else if (cmd === 'D') dots.push([n[0], n[1]]);
  }
  return { lines, dots };
}

const glyphCache = new Map();
/** A letter in a style: the stroke path, filled extras (dots, arrow heads), the polylines (for highlights and drips). */
function glyph(ch, styleName, arrowSeed = 0) {
  const key = ch + '|' + styleName + '|' + arrowSeed;
  if (glyphCache.has(key)) return glyphCache.get(key);
  const st = LETTER_STYLES[styleName];
  const base = UMLAUT[ch] || ch;
  const def = GLYPHS[base] || GLYPHS['-'];
  const w = def[0];
  const lines = [], dots = [];
  for (const src of def.slice(1)) { const p = parseSkeleton(src, st.curve); lines.push(...p.lines); dots.push(...p.dots); }
  if (UMLAUT[ch]) dots.push([w * 0.2, 1.36], [w * 0.8, 1.36]);
  const strokes = new Path2D();
  for (const l of lines) {
    strokes.moveTo(l[0][0], l[0][1]);
    for (let i = 1; i < l.length; i++) strokes.lineTo(l[i][0], l[i][1]);
    if (l.closed) strokes.closePath();
  }
  const fills = new Path2D();
  let hasFills = false;
  for (const [x, y] of dots) { fills.moveTo(x + st.T * 0.38, y); fills.arc(x, y, st.T * 0.38, 0, TAU); hasFills = true; }
  // arrow heads on free ends (sharp style): a triangle that continues the stroke, only where an end is a straight
  // stroke (on C, G, S or U it would turn the letter into another one)
  if (st.arrows && arrowSeed && ARROW_OK.has(base)) {
    const r = rng(arrowSeed);
    for (const l of lines) {
      if (l.closed || l.length < 2) continue;
      for (const end of [0, 1]) {
        if (r() > st.arrows) continue;
        const a = end ? l[l.length - 1] : l[0], b = end ? l[l.length - 2] : l[1];
        let dx = a[0] - b[0], dy = a[1] - b[1]; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
        // only ends that point out of the letter (up, down, or sideways at the top or bottom)
        if (Math.abs(dy) < 0.5 && a[1] > 0.2 && a[1] < 0.8) continue;
        const tip = [a[0] + dx * st.T * 1.5, a[1] + dy * st.T * 1.5], nx = -dy, ny = dx, wing = st.T * 0.95;
        fills.moveTo(a[0] + nx * wing, a[1] + ny * wing); fills.lineTo(tip[0], tip[1]); fills.lineTo(a[0] - nx * wing, a[1] - ny * wing); fills.closePath();
        hasFills = true;
      }
    }
  }
  const g = { ch, w, T: st.T, strokes, fills: hasFills ? fills : null, lines, dots, top: dots.length && UMLAUT[ch] ? 1.36 + st.T * 0.38 : 1 };
  glyphCache.set(key, g);
  return g;
}

/** Draws a letter grown to pen width `width` (outline, cut and block passes draw it wider than the face). */
function glyphPass(g, glyphDef, width, style, st) {
  g.lineJoin = st.join; g.lineCap = st.cap; g.miterLimit = 3;
  g.lineWidth = width; g.strokeStyle = style; g.stroke(glyphDef.strokes);
  if (glyphDef.fills) {
    g.fillStyle = style; g.fill(glyphDef.fills);
    const extra = width - glyphDef.T;
    if (extra > 0.001) { g.lineWidth = extra; g.lineJoin = 'round'; g.stroke(glyphDef.fills); }
  }
}

/**
 * Letters of a word laid out in letter units: [{ g, x, y, r, s }] plus the extent. Every letter gets a little rotation,
 * bounce and size of its own (seeded), and a sharp word gets arrow heads on some free ends.
 */
function layoutWord(word, styleName, r) {
  const st = LETTER_STYLES[styleName];
  const letters = [];
  let x = 0;
  for (const ch of word) {
    const g = glyph(ch, styleName, st.arrows ? 1 + Math.floor(r() * 9999) : 0);
    const s = 1 + (r() - 0.5) * 0.1;
    letters.push({ g, x: x + st.T / 2, y: (r() - 0.5) * 2 * st.bounce, r: (r() - 0.5) * 2 * st.rot, s });
    x += (g.w + st.T) * s - st.over;
  }
  const w = x + st.over + Math.abs(st.slant) * 0.6;
  const top = Math.max(...letters.map((l) => l.y + l.g.top * l.s)) + st.T / 2;
  const bottom = Math.min(...letters.map((l) => l.y)) - st.T / 2;
  return { letters, w, top, bottom, st };
}
/** The size of a word's piece in letter units: letters, outline, cut and block. */
function pieceUnits(lay) {
  const st = lay.st;
  return { wu: lay.w + st.T + 2 * (st.out + st.cut) + st.block[0] + 0.3, hu: lay.top - lay.bottom + 2 * (st.out + st.cut) + st.block[1] + 0.1 };
}

// ---------------------------------------------------------------- planning -------------------------------------------
// The words of the pieces in the language of the interface (planMural `lang`); the first of a room is its headline.
// `throw`: quick throw-ups, short words in chrome and black, no 3D. The English words are what a sprayer would write
// in English, not word for word translations; every letter of them has a glyph above.
export const MURAL_WORDS = {
  de: {
    hall: ['LESESAAL', 'LESEN', 'LIES', 'BUCH'],
    room: ['BÜCHER', 'WISSEN', 'SEITEN', 'WORTE', 'KAPITEL', 'LESEZEIT', 'POESIE', 'FANTASIE', 'BUCH', 'LIES'],
    throw: ['ABC', 'OHA', 'WOW', 'TEXT', 'ZACK', 'LOS'],
  },
  en: {
    hall: ['LIBRARY', 'READ', 'STORY', 'BOOK'],
    room: ['BOOKS', 'WISDOM', 'PAGES', 'WORDS', 'CHAPTER', 'STORYTIME', 'POETRY', 'IMAGINE', 'BOOK', 'READ'],
    throw: ['ABC', 'WHOA', 'WOW', 'TEXT', 'BAM', 'GO'],
  },
};
/** The language of a mural: 'de' or 'en' (anything else paints the German words). */
export const muralLang = (lang) => (lang === 'en' ? 'en' : 'de');
/** Characters per room. */
const CHAR_CAP = { hall: 3, room: 4, passage: 1 };
const CHROME = ['#ffffff', '#d2d5df', '#8a8fa4'];
const CELL = 0.1;   // planning grid: 10 cm

export function makeGrid(wall) {
  const cols = Math.max(1, Math.ceil(wall.len / CELL)), rows = Math.max(1, Math.ceil((wall.y1 - wall.y0) / CELL));
  const cells = new Uint8Array(cols * rows).fill(2);    // 0 free, 1 small things only, 2 nothing (no wall, blocked, taken)
  const grid = { cols, rows, cells, wall };
  // only where there is wall (doors and windows are gaps between the parts)
  for (const p of wall.parts || [{ u0: 0, u1: wall.len, y0: wall.y0, y1: wall.y1 }]) {
    for (let j = 0; j < rows; j++) {
      const y = wall.y0 + (j + 0.5) * CELL;
      if (y < p.y0 || y > p.y1) continue;
      for (let i = 0; i < cols; i++) { const u = (i + 0.5) * CELL; if (u >= p.u0 && u <= p.u1) cells[j * cols + i] = 0; }
    }
  }
  for (let j = 0; j < rows; j++) {
    const y = wall.y0 + (j + 0.5) * CELL;
    // the cornice hides the top of the skin
    if (y > (wall.top ?? 99)) for (let i = 0; i < cols; i++) cells[j * cols + i] = 2;
    else if (y < (wall.pieceMin ?? -1)) for (let i = 0; i < cols; i++) if (cells[j * cols + i] < 1) cells[j * cols + i] = 1;
  }
  for (const b of wall.blocks || []) mark(grid, b, b.soft ? 1 : 2, b.margin ?? 0.08);
  return grid;
}
function mark(grid, box, v, margin = 0) {
  const { cols, rows, cells, wall } = grid;
  const i0 = clamp(Math.floor((box.u0 - margin) / CELL), 0, cols), i1 = clamp(Math.ceil((box.u1 + margin) / CELL), 0, cols);
  const j0 = clamp(Math.floor((box.y0 - margin - wall.y0) / CELL), 0, rows), j1 = clamp(Math.ceil((box.y1 + margin - wall.y0) / CELL), 0, rows);
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) if (cells[j * cols + i] < v) cells[j * cols + i] = v;
}
/** Is the box [u ± r] × [y ± r] free up to value `maxV` (and on the wall)? */
function freeAt(grid, u, y, r, maxV = 1) {
  const { cols, rows, cells, wall } = grid;
  const i0 = Math.floor((u - r) / CELL), i1 = Math.floor((u + r) / CELL), j0 = Math.floor((y - r - wall.y0) / CELL), j1 = Math.floor((y + r - wall.y0) / CELL);
  if (i0 < 0 || j0 < 0 || i1 >= cols || j1 >= rows) return false;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (cells[j * cols + i] > maxV) return false;
  return true;
}
/** Maximal rectangles of free cells (value ≤ maxV), via the histogram method; every maximal one is a candidate. */
export function freeRects(grid, maxV = 0) {
  const { cols, rows, cells, wall } = grid;
  const hgt = new Int32Array(cols), out = [];
  for (let j = rows - 1; j >= 0; j--) {          // from the top row down: hgt = free cells upwards from row j
    for (let i = 0; i < cols; i++) hgt[i] = cells[j * cols + i] <= maxV ? hgt[i] + 1 : 0;
    const stack = [];
    for (let i = 0; i <= cols; i++) {
      const hh = i < cols ? hgt[i] : 0;
      let start = i;
      while (stack.length && stack[stack.length - 1][1] >= hh) {
        const [si, sh] = stack.pop();
        if (sh > 0) out.push({ u0: si * CELL, u1: i * CELL, y0: wall.y0 + j * CELL, y1: wall.y0 + (j + sh) * CELL });
        start = si;
      }
      stack.push([start, hh]);
    }
  }
  return out;
}

/** A gentle wave along the room: periodic over the loop when there is one (so it meets itself in the corner). */
function makeWave(r, P, looped, { amp, len }) {
  const n = looped ? Math.max(1, Math.round(P / len)) : P / len;
  return { a: amp * range(r, 0.7, 1.2), k: TAU * n / P, p: r() * TAU };
}
const waveAt = (w, s) => w.a * Math.sin(w.k * s + w.p);

/**
 * The composition of every wall for one seed: palette, letter style, the background that runs round each room and per
 * wall the pieces, characters and small things. `walls`: the wall specs of walls.js. `lang` ('de' | 'en') picks the
 * words of the pieces and throw-ups; colours, figures and places stay the same in both languages as far as the words
 * allow (a longer word may take another stretch of wall).
 */
export function planMural(walls, seed, lang = 'de') {
  seed = Math.max(1, Math.floor(seed) || 1);
  const r = rng(seed * 7919 + 17);
  const palette = PALETTES[(seed - 1) % PALETTES.length];
  // most variants paint round bubble letters, every third one the sharp style
  const letterStyle = seed % 3 === 0 ? 'sharp' : 'bubble';
  const WORDS = MURAL_WORDS[muralLang(lang)], THROW_WORDS = WORDS.throw;
  const plan = { seed, lang: muralLang(lang), palette, letterStyle, rooms: {}, walls: {}, stats: { pieces: 0, characters: 0, decor: 0, words: [], throwWords: [] } };
  const usedWords = new Set();
  // the characters take turns, so a room shows each of them at most once
  const characters = ['cat', 'owl', 'book', 'worm'];
  const charTurn = {};
  const charsIn = {};

  // --- round each room: haze, ribbons, the band above the panelling, speckles, paint dripping from the cornice ------
  for (const wall of walls) {
    if (plan.rooms[wall.room]) continue;
    const mine = walls.filter((w) => w.room === wall.room);
    const looped = !!wall.loop;
    const P = wall.loop || mine.reduce((a, w) => Math.max(a, w.s0 + w.len), 0);
    const y0 = wall.y0, top = wall.top ?? wall.y1, H = top - y0;
    const rr = rng(seed * 31 + hashStr(wall.room));
    const haze = [];
    for (let s = 0; s < P; s += range(rr, 1.6, 3.0)) haze.push({ s, y: range(rr, y0 + 0.2, top - 0.1), r: range(rr, 1.2, 2.6), c: pick(rr, palette.haze), a: range(rr, 0.35, 0.75) });
    // two ribbons that flow round the room: a long swell and a shorter one on top
    const ribbons = palette.ribbons.map(([c, alpha], i) => ({
      y: y0 + H * (i ? range(rr, 0.62, 0.72) : range(rr, 0.36, 0.46)), c, alpha,
      w1: makeWave(rr, P, looped, { amp: H * 0.11, len: range(rr, 8, 12) }), w2: makeWave(rr, P, looped, { amp: H * 0.04, len: range(rr, 3, 4.5) }),
      width: range(rr, 0.2, 0.32) * (H / 3.5), ww: makeWave(rr, P, looped, { amp: 0.4, len: range(rr, 5, 7) }),
    }));
    // the band above the panelling
    const floor = { kind: palette.floor, h: Math.min(0.85, H * 0.2), items: [], rows: [] };
    if (floor.kind === 'clouds') {
      for (const [row, y, rad] of [[0, 0.32, 0.36], [1, 0.12, 0.3]]) {
        const bumps = [];
        for (let s = -0.4; s < P + 0.4; s += range(rr, 0.5, 0.85) * rad / 0.33) bumps.push({ s, r: rad * range(rr, 0.75, 1.3), y: y0 + y * (H / 3.5) + range(rr, -0.05, 0.08) });
        floor.rows.push({ row, bumps });
      }
    } else if (floor.kind === 'skyline') {
      // houses, and in the front row now and then a few giant books standing between them
      const k = H / 3.6;
      for (const row of [0, 1]) {
        for (let s = -0.6; s < P + 0.6;) {
          if (row === 1 && rr() < 0.3) {
            for (let n = 2 + Math.floor(rr() * 3); n > 0; n--) {
              const w = range(rr, 0.16, 0.28);
              floor.items.push({ row, s, w, h: range(rr, 0.5, 0.95) * k, book: true, lean: n === 1 && rr() < 0.5, c: pick(rr, palette.accents), seed: seedOf(rr) });
              s += w + 0.012;
            }
            s += range(rr, 0.05, 0.2);
            continue;
          }
          const w = range(rr, 0.35, 1.0) * (row ? 0.85 : 1);
          floor.items.push({ row, s, w, h: (row ? range(rr, 0.25, 0.7) : range(rr, 0.45, 1.05)) * k, roof: pick(rr, ['flat', 'flat', 'peak', 'antenna', 'dome', 'step']), seed: seedOf(rr) });
          s += w + (rr() < 0.25 ? range(rr, 0.05, 0.3) : 0);
        }
      }
    } else if (floor.kind === 'waves') {
      for (const row of [0, 1]) floor.rows.push({ row, y: y0 + (row ? 0.14 : 0.32) * (H / 3.5), w1: makeWave(rr, P, looped, { amp: 0.07, len: range(rr, 1.4, 2.2) }), w2: makeWave(rr, P, looped, { amp: 0.035, len: range(rr, 0.5, 0.8) }) });
    } else if (floor.kind === 'hills') {
      for (const row of [0, 1]) floor.rows.push({ row, y: y0 + (row ? 0.18 : 0.42) * (H / 3.5), w1: makeWave(rr, P, looped, { amp: 0.18, len: range(rr, 4, 7) }), w2: makeWave(rr, P, looped, { amp: 0.06, len: range(rr, 1.5, 2.5) }) });
    }
    const speckles = [];
    for (let s = 0; s < P; s += range(rr, 1.2, 2.6)) speckles.push({ s, y: range(rr, y0 + 0.3, top - 0.2), r: range(rr, 0.25, 0.6), n: Math.floor(range(rr, 60, 160)), c: rr() < 0.6 ? '#ffffff' : palette.outline, a: range(rr, 0.25, 0.55), seed: seedOf(rr) });
    const drips = [];
    if (palette.drip) for (let s = 0; s < P; s += range(rr, 0.12, 0.5)) drips.push({ s, len: rr() < 0.18 ? range(rr, 0.35, 1.0) : range(rr, 0.04, 0.28), w: range(rr, 0.012, 0.03) });
    plan.rooms[wall.room] = { loop: wall.loop || 0, P, haze, ribbons, floor, speckles, drips, band: range(rr, 0.07, 0.12), dripSeed: seedOf(rr) };
  }

  for (const wall of walls) {
    const wr = rng(seed * 101 + hashStr(wall.id));
    const grid = makeGrid(wall);
    const items = [], bg = [];
    const anchors = [];      // pieces and characters: the small things gather round them

    // --- the big things: pieces in the widest free stretches, characters beside them ------------------------------
    // a long wall carries two pieces and characters, a short one a piece and a character
    const bigs = wall.room === 'passage' ? ['character'] : wall.len >= 20 ? ['piece', 'piece', 'character', 'character'] : wall.len >= 9 ? ['piece', 'character'] : ['piece'];
    for (const kind of bigs) {
      if (kind === 'piece') {
        const cands = freeRects(grid, 0).filter((c) => c.u1 - c.u0 >= 1.9 && c.y1 - c.y0 >= 0.95);
        if (!cands.length) continue;
        // the stretches that allow the biggest letters (a word of five letters is about 2.6 times as wide as high)
        const kOf = (c) => Math.min((c.u1 - c.u0) / 5.3, Math.min(c.y1 - c.y0, 2.0) / 2.0, 0.8) * (1.1 - Math.abs((c.u0 + c.u1) / 2 / wall.len - 0.5) * 0.6);
        cands.sort((a, b) => kOf(b) - kOf(a));
        // the word and stretch that go together best: big letters, the first words of the list a little more often
        let best = null;
        for (const c of cands.slice(0, 6)) {
          const box = { u0: c.u0 + 0.12, u1: c.u1 - 0.12, y0: c.y0 + 0.08, y1: Math.min(c.y1 - 0.06, c.y0 + 2.0) };
          const words = WORDS[wall.room] || WORDS.room;
          words.forEach((word, wi) => {
            if (usedWords.has(word)) return;
            const { wu, hu } = pieceUnits(layoutWord(word, letterStyle, rng(hashStr(word) + seed)));
            const k = Math.min((box.u1 - box.u0) / wu, (box.y1 - box.y0) / hu, 0.95);
            if (k < 0.3) return;
            // the first word of a room's list (Lesesaal, Bücher) is its headline
            const sc = k * Math.pow(word.length, 0.25) * (wi === 0 ? 1.6 : 1.2 - wi * 0.03) * (0.9 + wr() * 0.2);
            if (!best || sc > best.sc) best = { word, k, sc, wu, hu, box };
          });
        }
        if (!best) continue;
        usedWords.add(best.word);
        const w = best.wu * best.k, h = best.hu * best.k;
        const box = best.box, cu = (box.u0 + box.u1) / 2, cy = (box.y0 + box.y1) / 2;
        const it = { type: 'piece', word: best.word, style: letterStyle, k: best.k, u: cu - w / 2, y: cy - h / 2, w, h, fill: plan.stats.pieces % palette.fills.length,
          fillin: pick(wr, ['split', 'bubbles', 'shine', 'split', 'bubbles']), backdrop: pick(wr, palette.backdrops), seed: seedOf(wr) };
        items.push(it); anchors.push(it);
        plan.stats.pieces++; plan.stats.words.push(best.word);
        mark(grid, { u0: it.u - 0.2, u1: it.u + it.w + 0.2, y0: it.y - 0.12, y1: it.y + it.h + 0.12 }, 2);
      } else {
        // the library cat, an owl on books, a flying book: at most a few per room
        if ((charsIn[wall.room] = (charsIn[wall.room] || 0)) >= (CHAR_CAP[wall.room] ?? 3)) continue;
        const cands = freeRects(grid, 0).filter((c) => c.u1 - c.u0 >= 0.75 && c.y1 - c.y0 >= 0.85);
        if (!cands.length) continue;
        const size = (c) => Math.min(c.y1 - c.y0, 1.6) * Math.min(c.u1 - c.u0, 1.5);
        cands.sort((a, b) => size(b) - size(a));
        const c = cands[0];
        charTurn[wall.room] ??= Math.floor(r() * characters.length);
        const kind = characters[charTurn[wall.room]++ % characters.length];
        const aspect = { book: 1.25, cat: 0.92, owl: 0.8, worm: 0.95 }[kind];
        const h = Math.min(c.y1 - c.y0 - 0.1, (c.u1 - c.u0 - 0.1) / aspect, wall.room === 'passage' ? 1.1 : 1.55);
        if (h < 0.7) continue;
        const w = h * aspect;
        const it = { type: 'character', kind, u: (c.u0 + c.u1) / 2 - w / 2, y: c.y0 + 0.05 + (c.y1 - c.y0 - 0.1 - h) * (kind === 'book' ? 0.6 : 0.15), w, h, flip: wr() < 0.5, seed: seedOf(wr) };
        items.push(it); anchors.push(it); plan.stats.characters++; charsIn[wall.room]++;
        mark(grid, { u0: it.u - 0.12, u1: it.u + w + 0.12, y0: it.y - 0.08, y1: it.y + h + 0.08 }, 2);
      }
    }

    // --- a throw-up: a quick word in chrome and black wherever a stretch is free (also where a shelf may stand) ------
    {
      const cands = freeRects(grid, 1).filter((c) => c.u1 - c.u0 >= 1.3 && c.y1 - c.y0 >= 0.62);
      if (cands.length && wr() < 0.85) {
        cands.sort((a, b) => (b.u1 - b.u0) * Math.min(b.y1 - b.y0, 1) - (a.u1 - a.u0) * Math.min(a.y1 - a.y0, 1));
        const c = cands[Math.floor(wr() * Math.min(4, cands.length))];
        const fresh = THROW_WORDS.filter((x) => !usedWords.has(x));
        const word = pick(wr, fresh.length ? fresh : THROW_WORDS), st = LETTER_STYLES.bubble;
        usedWords.add(word);
        const lay = layoutWord(word, 'bubble', rng(hashStr(word) + seed + 7));
        const wu = lay.w + st.T + 2 * st.out + 0.3, hu = lay.top - lay.bottom + 2 * st.out + 0.12;
        const k = Math.min((c.u1 - c.u0 - 0.2) / wu, (c.y1 - c.y0 - 0.1) / hu, 0.42);
        if (k > 0.22) {
          const w = wu * k, h = hu * k;
          const it = { type: 'throw', word, style: 'bubble', k, u: c.u0 + 0.1 + wr() * (c.u1 - c.u0 - 0.2 - w), y: c.y0 + 0.05 + wr() * (c.y1 - c.y0 - 0.1 - h), w, h, seed: seedOf(wr), layoutSeed: hashStr(word) + seed + 7 };
          items.push(it); plan.stats.throws = (plan.stats.throws || 0) + 1; plan.stats.throwWords.push(word);
          mark(grid, { u0: it.u - 0.1, u1: it.u + w + 0.1, y0: it.y - 0.08, y1: it.y + h + 0.08 }, 2);
        }
      }
    }

    // --- small things round the pieces and characters: sparkles, stars, bubbles, an arrow, a crown -----------------
    const decor = [];
    const put = (kind, u, y, size, extra = {}) => {
      if (!freeAt(grid, u, y, size * 0.8, 1) || decor.some((d) => Math.hypot(d.u - u, d.y - y) < (d.size + size) * 0.85)) return false;
      decor.push({ type: 'decor', kind, u, y, size, rot: (wr() - 0.5) * 0.5, color: pick(wr, palette.accents), seed: seedOf(wr), ...extra });
      mark(grid, { u0: u - size * 0.7, u1: u + size * 0.7, y0: y - size * 0.7, y1: y + size * 0.7 }, 2);
      return true;
    };
    for (const a of anchors) {
      const isPiece = a.type === 'piece';
      // just outside the piece or character: beside it, above its ends, under it
      const spots = (s) => [[a.u - 0.25 - s, a.y + a.h * 0.55], [a.u + a.w + 0.25 + s, a.y + a.h * 0.6], [a.u + a.w * 0.15, a.y + a.h + 0.15 + s], [a.u + a.w * 0.85, a.y + a.h + 0.15 + s],
        [a.u + a.w * 0.5, a.y - 0.15 - s], [a.u - 0.25 - s, a.y + s], [a.u + a.w + 0.25 + s, a.y + s]];
      let n = isPiece ? 4 : 2;
      for (let i = 0; i < 7 && n > 0; i++) {
        const kind = isPiece ? pick(wr, ['star', 'sparkles', 'bubbles', 'arrow', 'star', 'sparkles']) : pick(wr, ['sparkles', 'bubbles', 'star']);
        const size = kind === 'arrow' ? range(wr, 0.3, 0.42) : kind === 'sparkles' ? range(wr, 0.16, 0.24) : range(wr, 0.14, 0.22);
        const [u, y] = spots(size)[i];
        if (put(kind, u, y, size, kind === 'arrow' ? { dir: u < a.u + a.w / 2 ? -1 : 1 } : {})) n--;
      }
      // a crown on the first letters (part of the piece, so no room check)
      if (isPiece && wr() < 0.45) decor.push({ type: 'decor', kind: 'crown', u: a.u + a.w * range(wr, 0.14, 0.26), y: a.y + a.h * 0.86, size: a.k * 0.26, rot: (wr() - 0.5) * 0.4, color: pick(wr, palette.accents), seed: seedOf(wr) });
    }
    // --- and a few things on the free wall (behind shelves too, where they may show) -------------------------------
    const free = [];
    for (let j = 0; j < grid.rows; j++) for (let i = 0; i < grid.cols; i++) if (grid.cells[j * grid.cols + i] <= 1) free.push([i, j]);
    const target = Math.round(free.length * CELL * CELL / 3.2);
    for (let tries = 0, n = 0; tries < target * 10 && n < target; tries++) {
      const [i, j] = free[Math.floor(wr() * free.length)] || [0, 0];
      const kind = pick(wr, ['splat', 'halftone', 'sparkles', 'stars', 'splat', 'bubbles', 'bolt', 'dots']);
      const size = kind === 'halftone' ? range(wr, 0.35, 0.6) : kind === 'splat' ? range(wr, 0.2, 0.34) : range(wr, 0.14, 0.24);
      if (put(kind, (i + 0.5) * CELL, wall.y0 + (j + 0.5) * CELL, size)) n++;
    }
    items.push(...decor);
    plan.stats.decor += decor.length;

    // --- background of this wall: rings / stars in the sky ----------------------------------------------------------
    if (palette.extras === 'rings') for (let n = 0; n < wall.len / 2.6; n++) bg.push({ kind: 'ring', u: wr() * wall.len, y: range(wr, wall.y0 + 0.6, (wall.top ?? wall.y1) - 0.3), r: range(wr, 0.18, 0.5), seed: seedOf(wr) });
    if (palette.extras === 'stars') for (let n = 0; n < wall.len * 5; n++) bg.push({ kind: 'starlet', u: wr() * wall.len, y: range(wr, wall.y0 + (wall.y1 - wall.y0) * 0.35, wall.y1), r: range(wr, 0.006, 0.018), seed: seedOf(wr) });
    plan.walls[wall.id] = { items, bg };
  }
  return plan;
}

// ---------------------------------------------------------------- painting ------------------------------------------
const newCanvas = (w, h) => new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
/** A canvas that is painted on the CPU: a GPU canvas in the worker kept the graphics card busy for whole frames
 *  (the world stood still for up to half a second while a mural was painted). */
const ctx2d = (c) => c.getContext('2d', { willReadFrequently: true });
let canFilter = null;
function blurFilter(g) { if (canFilter == null) canFilter = 'filter' in g; return canFilter; }

/**
 * Paints one wall onto `canvas` (its size is the wall's length × band height at `density` pixels per metre).
 * `plan` from planMural with the same walls.
 */
export function paintWall(canvas, wall, plan, density) {
  const P = new WallPainter(canvas, wall, plan, density);
  const wp = plan.walls[wall.id] || { items: [], bg: [] };
  P.background();
  for (const b of wp.bg) P.bgThing(b);
  P.speckles();
  P.ribbons();
  P.floorBand();
  P.dripBand();
  // the small things behind, the characters, the pieces, then the shine on top
  const front = new Set(['sparkles', 'star', 'arrow', 'crown', 'bubbles']);
  for (const it of wp.items) if (it.type === 'throw') P.piece(it);
  for (const it of wp.items) if (it.type === 'decor' && !front.has(it.kind)) P.decor(it);
  for (const it of wp.items) if (it.type === 'character') P.character(it);
  for (const it of wp.items) if (it.type === 'piece') P.piece(it);
  for (const it of wp.items) if (it.type === 'decor' && front.has(it.kind)) P.decor(it);
  P.finish();
}

class WallPainter {
  constructor(canvas, wall, plan, D) {
    this.canvas = canvas; this.g = ctx2d(canvas); this.D = D;
    this.wall = wall; this.plan = plan; this.pal = plan.palette; this.room = plan.rooms[wall.room];
    this.top = wall.y1;
  }
  /** The wall's metres (u along, y up) on a canvas whose top-left corner sits at (u0, yTop). */
  frame(g, u0 = 0, yTop = this.top) { g.setTransform(this.D, 0, 0, -this.D, -u0 * this.D, yTop * this.D); }
  /** Room things that run round the corners: every copy of `s` that lands on this wall. */
  *onWall(s, reach) {
    const { wall } = this, loop = this.room.loop;
    for (const k of loop ? [-1, 0, 1] : [0]) {
      const u = s + k * loop - wall.s0;
      if (u > -reach && u < wall.len + reach) yield u;
    }
  }

  // --- background ------------------------------------------------------------------------------------------------------
  background() {
    const { g, wall, pal } = this;
    this.frame(g);
    const fade = g.createLinearGradient(0, wall.y1, 0, wall.y0);
    pal.bg.forEach((c, i) => fade.addColorStop(i / (pal.bg.length - 1), c));
    g.fillStyle = fade; g.fillRect(-0.1, wall.y0 - 0.1, wall.len + 0.2, wall.y1 - wall.y0 + 0.2);
    for (const hz of this.room.haze) {
      for (const u of this.onWall(hz.s, hz.r)) {
        const rg = g.createRadialGradient(u, hz.y, 0, u, hz.y, hz.r);
        rg.addColorStop(0, rgba(hz.c, hz.a)); rg.addColorStop(0.5, rgba(hz.c, hz.a * 0.5)); rg.addColorStop(1, rgba(hz.c, 0));
        g.fillStyle = rg; g.fillRect(u - hz.r, hz.y - hz.r, hz.r * 2, hz.r * 2);
      }
    }
  }
  bgThing(b) {
    const { g } = this;
    this.frame(g);
    if (b.kind === 'ring') {
      const rg = g.createRadialGradient(b.u - b.r * 0.3, b.y + b.r * 0.3, b.r * 0.1, b.u, b.y, b.r);
      rg.addColorStop(0, 'rgba(255,255,255,0.0)'); rg.addColorStop(0.75, 'rgba(255,255,255,0.08)'); rg.addColorStop(0.97, 'rgba(255,255,255,0.4)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(b.u, b.y, b.r, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = b.r * 0.07; g.lineCap = 'round';
      g.beginPath(); g.arc(b.u, b.y, b.r * 0.78, Math.PI * 0.55, Math.PI * 0.85); g.stroke();
      g.beginPath(); g.arc(b.u, b.y, b.r * 0.78, Math.PI * 0.92, Math.PI * 0.97); g.stroke();
    } else if (b.kind === 'starlet') {
      const r = rng(b.seed);
      g.fillStyle = rgba('#ffffff', 0.45 + r() * 0.5); g.beginPath(); g.arc(b.u, b.y, b.r, 0, TAU); g.fill();
      if (r() < 0.12) this.sparkle(g, b.u, b.y, b.r * 9, '#ffffff');
    }
  }
  /** Fine dots, as a can sprays them past the edge of a shape. */
  speckles() {
    const { g } = this;
    this.frame(g);
    for (const sp of this.room.speckles) {
      for (const u of this.onWall(sp.s, sp.r)) {
        const r = rng(sp.seed);
        g.fillStyle = sp.c;
        for (let i = 0; i < sp.n; i++) {
          const a = r() * TAU, d = sp.r * Math.sqrt(r());
          g.globalAlpha = sp.a * (1 - d / sp.r) * (0.4 + r() * 0.6);
          g.beginPath(); g.arc(u + Math.cos(a) * d, sp.y + Math.sin(a) * d * 0.8, 0.003 + r() * r() * 0.012, 0, TAU); g.fill();
        }
      }
    }
    g.globalAlpha = 1;
  }
  /** Two broad ribbons of paint that flow along the walls and round the corners. */
  ribbons() {
    const { g, wall, room } = this;
    this.frame(g);
    for (const rb of room.ribbons) {
      const at = (u) => { const s = wall.s0 + u; return [rb.y + waveAt(rb.w1, s) + waveAt(rb.w2, s), rb.width * (1 + waveAt(rb.ww, s))]; };
      const upper = [], lower = [];
      for (let u = -0.3; u <= wall.len + 0.3; u += 0.05) { const [y, w] = at(u); upper.push([u, y + w / 2]); lower.push([u, y - w / 2]); }
      const band = new Path2D();
      upper.forEach(([u, y], i) => (i ? band.lineTo(u, y) : band.moveTo(u, y)));
      for (let i = lower.length - 1; i >= 0; i--) band.lineTo(lower[i][0], lower[i][1]);
      band.closePath();
      // a soft shadow under it, the band, a lighter rim along its top and a darker one along its bottom
      g.save(); g.translate(0.03, -0.05); g.fillStyle = rgba(this.pal.outline, 0.16); g.fill(band); g.restore();
      g.globalAlpha = rb.alpha; g.fillStyle = rb.c; g.fill(band); g.globalAlpha = 1;
      const edge = (pts, style, width) => { g.strokeStyle = style; g.lineWidth = width; g.lineJoin = 'round'; g.beginPath(); pts.forEach(([u, y], i) => (i ? g.lineTo(u, y) : g.moveTo(u, y))); g.stroke(); };
      edge(upper.map(([u, y]) => [u, y - 0.02]), rgba('#ffffff', 0.55), 0.018);
      edge(lower.map(([u, y]) => [u, y + 0.012]), rgba(shade(rb.c, -0.45), 0.35), 0.02);
    }
  }
  /** The band above the panelling: clouds, a skyline of houses and books, waves, hills or stripes. */
  floorBand() {
    const { g, wall, room, pal } = this;
    const fl = room.floor;
    this.frame(g);
    const base = wall.y0 - 0.2;
    if (fl.kind === 'clouds') {
      for (const row of fl.rows) {
        const p = new Path2D();
        let any = false;
        for (const bmp of row.bumps) for (const u of this.onWall(bmp.s, bmp.r)) { p.moveTo(u + bmp.r, bmp.y); p.arc(u, bmp.y, bmp.r, 0, TAU); any = true; }
        if (!any) continue;
        p.rect(-0.5, base, wall.len + 1, (row.bumps[0]?.y ?? wall.y0) - base);
        const top = Math.max(...row.bumps.map((b) => b.y + b.r));
        const fill = row.row ? pal.floorColors[0] : mix(pal.floorColors[0], pal.bg[1], 0.3);
        const lg = g.createLinearGradient(0, top, 0, wall.y0);
        lg.addColorStop(0, fill); lg.addColorStop(0.55, fill); lg.addColorStop(1, row.row ? pal.floorColors[1] : mix(pal.floorColors[1], pal.bg[1], 0.4));
        g.lineWidth = 0.035; g.strokeStyle = rgba(pal.cloudLine, row.row ? 0.6 : 0.3); g.lineJoin = 'round'; g.stroke(p);
        g.fillStyle = lg; g.fill(p);
        if (row.row) {
          g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 0.022; g.lineCap = 'round';
          for (const bmp of row.bumps) for (const u of this.onWall(bmp.s, bmp.r)) { g.beginPath(); g.arc(u, bmp.y, bmp.r * 0.72, Math.PI * 0.58, Math.PI * 0.82); g.stroke(); }
        }
      }
    } else if (fl.kind === 'skyline') {
      for (const row of [0, 1]) {
        const col = row ? pal.floorColors[0] : mix(pal.floorColors[1], pal.bg[2], 0.25);
        for (const b of fl.items) {
          if (b.row !== row) continue;
          for (const u of this.onWall(b.s + b.w / 2, b.w)) this.building(g, u - b.w / 2, wall.y0 - 0.05, b, col);
        }
      }
    } else if (fl.kind === 'waves' || fl.kind === 'hills') {
      for (const row of fl.rows) {
        const p = new Path2D(); p.moveTo(-0.3, base);
        const crest = [];
        for (let u = -0.3; u <= wall.len + 0.3; u += 0.04) { const s = wall.s0 + u; const y = row.y + waveAt(row.w1, s) + waveAt(row.w2, s); crest.push([u, y]); p.lineTo(u, y); }
        p.lineTo(wall.len + 0.3, base); p.closePath();
        const c = row.row ? pal.floorColors[0] : pal.floorColors[1];
        const lg = g.createLinearGradient(0, row.y + 0.2, 0, wall.y0);
        lg.addColorStop(0, shade(c, 0.12)); lg.addColorStop(1, shade(c, -0.15));
        g.fillStyle = lg; g.fill(p);
        g.strokeStyle = fl.kind === 'waves' ? 'rgba(255,255,255,0.85)' : rgba(shade(c, 0.35), 0.9); g.lineWidth = fl.kind === 'waves' ? 0.03 : 0.02; g.lineJoin = 'round'; g.lineCap = 'round';
        g.beginPath(); crest.forEach(([u, y], i) => (i ? g.lineTo(u, y - 0.01) : g.moveTo(u, y - 0.01))); g.stroke();
        if (fl.kind === 'waves') {
          const r = rng(this.plan.seed + row.row * 7 + hashStr(wall.id));
          g.fillStyle = 'rgba(255,255,255,0.7)';
          for (let i = 0; i < wall.len * 6; i++) { const k = Math.floor(r() * crest.length); const [u, y] = crest[k]; g.beginPath(); g.arc(u + (r() - 0.5) * 0.05, y - 0.03 - r() * 0.12, 0.005 + r() * 0.012, 0, TAU); g.fill(); }
        }
      }
    } else if (fl.kind === 'stripes') {
      const n = pal.floorColors.length, h = 0.075;
      for (let i = 0; i < n; i++) {
        const y = wall.y0 + 0.06 + (n - 1 - i) * (h + 0.018);
        g.fillStyle = pal.floorColors[i]; g.fillRect(-0.1, y, wall.len + 0.2, h);
      }
    }
  }
  /** A house of the skyline, or a standing book (with spine bands). */
  building(g, u, y0, b, col) {
    const r = rng(b.seed), w = b.w, h = b.h, pal = this.pal;
    if (b.book) {
      // a giant book on its end: a coloured spine with bands at top and bottom, a title label, a highlight
      const c = mix(b.c, col, 0.3);
      g.save();
      if (b.lean) { g.translate(u + w, y0); g.rotate(-0.16); g.translate(-(u + w), -y0); }
      g.fillStyle = c; g.beginPath(); g.roundRect(u, y0, w, h, [0, 0, w * 0.18, w * 0.18]); g.fill();
      g.fillStyle = rgba(shade(c, -0.45), 0.9);
      for (const yy of [y0 + h - w * 0.35, y0 + h - w * 0.55, y0 + w * 0.3]) g.fillRect(u, yy, w, w * 0.08);
      g.fillStyle = rgba('#fff6e0', 0.9); g.fillRect(u + w * 0.3, y0 + h * 0.35, w * 0.4, h * 0.3);
      g.fillStyle = rgba(shade(c, -0.5), 0.6); for (let i = 0; i < 3; i++) g.fillRect(u + w * 0.42, y0 + h * (0.4 + i * 0.07), w * 0.16, h * 0.035);
      g.fillStyle = rgba('#ffffff', 0.28); g.fillRect(u + w * 0.12, y0 + h * 0.06, w * 0.08, h * 0.86);
      g.restore();
      return;
    }
    g.fillStyle = col;
    g.fillRect(u, y0, w, h);
    const t = y0 + h;
    if (b.roof === 'peak') { g.beginPath(); g.moveTo(u - 0.02, t); g.lineTo(u + w / 2, t + w * 0.35); g.lineTo(u + w + 0.02, t); g.fill(); }
    else if (b.roof === 'dome') { g.beginPath(); g.arc(u + w / 2, t, w * 0.32, 0, Math.PI); g.fill(); }
    else if (b.roof === 'step') { g.fillRect(u + w * 0.2, t, w * 0.6, h * 0.12); g.fillRect(u + w * 0.38, t + h * 0.12, w * 0.24, h * 0.1); }
    else if (b.roof === 'antenna') { g.fillRect(u + w * 0.6, t, 0.015, h * 0.3); g.fillRect(u + w * 0.3, t, w * 0.2, 0.06); }
    // lit windows
    const lit = pal.name === 'Nacht' ? '#ffd86b' : '#ffcf7a';
    for (let yy = y0 + 0.12; yy < t - 0.1; yy += 0.16) for (let xx = u + 0.07; xx < u + w - 0.09; xx += 0.13) {
      if (r() < 0.45) { g.fillStyle = rgba(lit, 0.55 + r() * 0.4); g.fillRect(xx, yy, 0.055, 0.075); }
    }
  }
  /** Paint running down from the cornice: a wavy band with drips, the same all round the room. */
  dripBand() {
    const { g, wall, room, pal } = this;
    if (!room.drips.length) return;
    this.frame(g);
    const top = wall.y1 + 0.02, band = room.band + (wall.y1 - (wall.top ?? wall.y1));
    const wave = (s) => band * (0.78 + 0.22 * Math.sin(s * 3.1 + room.dripSeed % 7) * Math.sin(s * 1.3 + 1.7));
    const path = new Path2D();
    path.moveTo(-0.2, top + 0.2);
    for (let u = -0.2; u <= wall.len + 0.2; u += 0.04) path.lineTo(u, top - wave(wall.s0 + u));
    path.lineTo(wall.len + 0.2, top + 0.2); path.closePath();
    for (const d of room.drips) {
      for (const u of this.onWall(d.s, 0.1)) {
        const y0 = top - wave(d.s) + 0.01, y1 = y0 - d.len;
        path.moveTo(u - d.w / 2, y0); path.lineTo(u - d.w * 0.42, y1 + d.w); path.arc(u, y1 + d.w * 0.55, d.w * 0.62, Math.PI, 0, false); path.lineTo(u + d.w / 2, y0); path.closePath();
      }
    }
    const col = pal.drip;
    g.fillStyle = rgba(shade(col, -0.4), 0.3); g.save(); g.translate(0.008, -0.012); g.fill(path); g.restore();
    g.fillStyle = col; g.fill(path);
  }

  // --- the finish: spray grain, a little darker towards the panelling and the cornice -----------------------------------------
  finish() {
    const { g, canvas, wall } = this;
    this.frame(g);
    const lg = g.createLinearGradient(0, wall.y0, 0, wall.y0 + 0.5);
    lg.addColorStop(0, 'rgba(20,12,40,0.16)'); lg.addColorStop(1, 'rgba(20,12,40,0)');
    g.fillStyle = lg; g.fillRect(-0.1, wall.y0 - 0.1, wall.len + 0.2, 0.62);
    g.setTransform(1, 0, 0, 1, 0, 0);
    const n = 128, tile = newCanvas(n, n), tg = ctx2d(tile), img = tg.createImageData(n, n), r = rng(hashStr(this.wall.id) + this.plan.seed);
    for (let i = 0; i < n * n; i++) { const v = r(); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v < 0.5 ? 255 : 0; img.data[i * 4 + 3] = Math.round(Math.abs(v - 0.5) * 2 * 34); }
    tg.putImageData(img, 0, 0);
    g.globalCompositeOperation = 'soft-light';
    g.fillStyle = g.createPattern(tile, 'repeat'); g.fillRect(0, 0, canvas.width, canvas.height);
    g.globalCompositeOperation = 'source-over';
  }

  // --- shapes -----------------------------------------------------------------------------------------------------------
  cloud(g, cx, cy, w, h, r, { fill, shadeC, line, alpha = 1, lineWidth = 0.08 }) {
    const bumps = [];
    const n = 4 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, x = cx - w / 2 + t * w;
      const rad = h * (0.38 + Math.sin(t * Math.PI) * 0.32) * (0.85 + r() * 0.3);
      bumps.push([x, cy - h * 0.2 + rad * 0.55, rad]);
    }
    const shape = new Path2D();
    for (const [x, y, rad] of bumps) { shape.moveTo(x + rad, y); shape.arc(x, y, rad, 0, TAU); }
    shape.roundRect(cx - w / 2 + h * 0.2, cy - h / 2, w - h * 0.4, h * 0.42 + 0.001, h * 0.21);
    g.save(); g.globalAlpha = alpha;
    g.lineWidth = h * lineWidth; g.strokeStyle = line; g.lineJoin = 'round'; g.stroke(shape);
    const lg = g.createLinearGradient(0, cy + h * 0.6, 0, cy - h / 2);
    lg.addColorStop(0, fill); lg.addColorStop(0.55, fill); lg.addColorStop(1, shadeC);
    g.fillStyle = lg; g.fill(shape);
    g.strokeStyle = rgba('#ffffff', 0.85); g.lineWidth = h * 0.045; g.lineCap = 'round';
    for (const [x, y, rad] of bumps.slice(0, 3)) { g.beginPath(); g.arc(x, y, rad * 0.7, Math.PI * 0.6, Math.PI * 0.85); g.stroke(); }
    g.restore();
  }
  /** A paint splash: a lumpy blob, droplets thrown out round it and a few streaks. */
  splat(g, cx, cy, rad, color, r, alpha = 1, { stretch = 1 } = {}) {
    g.save(); g.globalAlpha = alpha; g.fillStyle = color;
    const n = 22, pts = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU; const k = 0.7 + r() * 0.5 + (r() < 0.25 ? r() * 0.5 : 0); pts.push([cx + Math.cos(a) * rad * k, cy + Math.sin(a) * rad * k]); }
    g.beginPath();
    for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if (i === 0) g.moveTo(m[0], m[1]); else g.quadraticCurveTo(a[0], a[1], m[0], m[1]); }
    g.quadraticCurveTo(pts[0][0], pts[0][1], (pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2);
    g.fill();
    for (let i = 0; i < 16; i++) {
      const a = r() * TAU, d = rad * (1.1 + r() * 1.2), s = rad * (0.03 + r() * 0.1) * (2.2 - d / rad) * 0.7;
      g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, Math.max(0.004, s), 0, TAU); g.fill();
    }
    g.lineCap = 'round'; g.strokeStyle = color;
    for (let i = 0; i < 5; i++) {
      const a = r() * TAU, d0 = rad * 0.8, d1 = rad * (1.3 + r() * 0.6);
      g.lineWidth = rad * (0.04 + r() * 0.05);
      g.beginPath(); g.moveTo(cx + Math.cos(a) * d0, cy + Math.sin(a) * d0); g.lineTo(cx + Math.cos(a) * d1, cy + Math.sin(a) * d1); g.stroke();
    }
    // a drip or two run down from it (thin ones, also under a big splash)
    const dw = Math.min(rad * 0.07, 0.03);
    for (let i = 0; i < 2; i++) {
      const x = cx + (r() - 0.5) * rad, l = Math.min(rad * (0.5 + r() * 0.9), 0.8);
      g.save(); g.translate(x, 0); g.scale(1 / stretch, 1);
      g.lineWidth = dw; g.beginPath(); g.moveTo(0, cy - rad * 0.5); g.lineTo(0, cy - rad * 0.5 - l); g.stroke();
      g.beginPath(); g.arc(0, cy - rad * 0.5 - l, dw * 0.85, 0, TAU); g.fill();
      g.restore();
    }
    g.restore();
  }

  /** A temporary canvas over [u0, u1] × [ya, yb] of the wall (pieces and characters are composed on it). */
  layer(u0, u1, ya, yb) {
    const D = this.D, c = newCanvas((u1 - u0) * D, (yb - ya) * D), g = ctx2d(c);
    g.setTransform(D, 0, 0, -D, -u0 * D, yb * D);
    return { c, g, u0, yb };
  }
  /** Draws `src` blurred (radius in metres) onto `g` at (x, y) px, with a fallback for contexts without filter. */
  blurred(g, src, x, y, radius, alpha) {
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = alpha;
    if (blurFilter(g)) { g.filter = `blur(${Math.max(1, radius * this.D).toFixed(1)}px)`; g.drawImage(src, x, y); }
    else { const s = newCanvas(src.width / 4, src.height / 4); ctx2d(s).drawImage(src, 0, 0, s.width, s.height); g.imageSmoothingQuality = 'high'; g.drawImage(s, x, y, src.width, src.height); }
    g.restore();
  }
  /** The layer onto the wall: a soft sprayed shadow and a faint overspray halo round it. */
  composite(L, { shadow = 0.28, halo = 0.3 } = {}) {
    const { g, D } = this;
    const x = L.u0 * D, y = (this.top - L.yb) * D;
    if (halo > 0) this.blurred(g, L.c, x, y, 0.018, halo);
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    g.shadowColor = `rgba(16, 10, 30, ${shadow})`; g.shadowBlur = 0.05 * D; g.shadowOffsetX = 0.03 * D; g.shadowOffsetY = 0.045 * D;
    g.drawImage(L.c, x, y);
    g.restore();
  }

  // --- pieces -------------------------------------------------------------------------------------------------------------
  piece(it) {
    const { D } = this;
    const r = rng(it.seed);
    // a throw-up: chrome letters with one black outline, no cut line and no 3D block
    const throwUp = it.type === 'throw';
    const pal = throwUp ? { ...this.pal, outline: '#0c0b14' } : this.pal;
    const lay = layoutWord(it.word, it.style, rng(it.layoutSeed ?? (hashStr(it.word) + this.plan.seed)));
    const st = throwUp ? { ...lay.st, out: lay.st.out * 1.3, cut: 0, block: [0, 0] } : lay.st, k = it.k;
    const fill = throwUp ? CHROME : pal.fills[it.fill % pal.fills.length];
    // the word's frame in wall metres: letter units → metres, centred in the item box
    const wordW = lay.w * k, wordH = (lay.top - lay.bottom) * k;
    const ox = it.u + (it.w - wordW - st.block[0] * k) / 2;
    const oy = it.y + (it.h - wordH + st.block[1] * k) / 2 - lay.bottom * k;
    const pad = (st.T + st.out + st.cut + 0.35) * k;
    if (it.backdrop && it.backdrop !== 'none') this.backdrop(it, r);
    const L = this.layer(it.u - pad, it.u + it.w + pad, it.y - pad, it.y + it.h + pad);
    const lg = L.g;
    const place = (gg, l, dx = 0, dy = 0) => {
      gg.translate(ox + l.x * k + dx, oy + l.y * k + dy); gg.rotate(l.r); gg.scale(k * l.s, k * l.s);
      if (st.slant) gg.transform(1, 0, st.slant, 1, 0, 0);
    };
    const pass = (gg, l, width, style, dx = 0, dy = 0) => { gg.save(); place(gg, l, dx, dy); glyphPass(gg, l.g, width, style, st); gg.restore(); };
    const bx = st.block[0] * k, by = -st.block[1] * k;
    const steps = Math.max(2, Math.ceil(Math.hypot(bx, by) * D / 1.2));
    const wOut = st.T + 2 * st.out, wBlockOut = wOut + 2 * st.out * 0.85, wCut = wBlockOut + 2 * st.cut;
    // 1 the cut line round everything, with a sprayed glow outside it
    const C = this.layer(L.u0, L.u0 + L.c.width / D, L.yb - L.c.height / D, L.yb);
    if (!throwUp) {
      for (let s = 0; s <= steps; s++) for (const l of lay.letters) pass(C.g, l, wCut, pal.cut, bx * s / steps, by * s / steps);
      this.blurred(lg, C.c, 0, 0, 0.05, 0.75);
      lg.save(); lg.setTransform(1, 0, 0, 1, 0, 0); lg.drawImage(C.c, 0, 0); lg.restore();
      // 2 the block's outline, 3 the block, shaded from far to near
      for (let s = 1; s <= steps; s++) for (const l of lay.letters) pass(lg, l, wBlockOut, pal.outline, bx * s / steps, by * s / steps);
      for (let s = steps; s >= 1; s--) { const t = s / steps; const col = mix(pal.block[1], pal.block[0], t); for (const l of lay.letters) pass(lg, l, wOut, col, bx * s / steps, by * s / steps); }
    }
    // 4 letter by letter: the outline, then the face on its own layer (fade, fill-in, highlights)
    const F = C;   // reused as the face layer
    const fg = F.g;
    const faceTop = oy + lay.top * k, faceBottom = oy + lay.bottom * k;
    for (const l of lay.letters) {
      pass(lg, l, wOut, pal.outline);
      fg.save(); fg.setTransform(1, 0, 0, 1, 0, 0); fg.clearRect(0, 0, F.c.width, F.c.height); fg.restore();
      pass(fg, l, st.T, '#ffffff');
      fg.globalCompositeOperation = 'source-in';
      const fade = fg.createLinearGradient(0, faceTop, 0, faceBottom);
      fade.addColorStop(0, fill[0]); fade.addColorStop(0.5, fill[1]); fade.addColorStop(1, fill[2]);
      fg.fillStyle = fade; fg.fillRect(L.u0, faceBottom - 1, L.c.width / D, faceTop - faceBottom + 2);
      fg.globalCompositeOperation = 'source-atop';
      this.fillIn(fg, throwUp ? { ...it, fillin: 'shine' } : it, fill, ox, oy, k, lay, pal);
      this.highlights(fg, l, place, st);
      fg.globalCompositeOperation = 'source-over';
      lg.save(); lg.setTransform(1, 0, 0, 1, 0, 0); lg.drawImage(F.c, 0, 0); lg.restore();
    }
    // 5 drips from the bottoms of some letters, 6 a sparkle or two on the letters
    this.letterDrips(lg, lay, place, st, k, fill, r);
    for (let i = throwUp ? 2 : 0; i < 3; i++) {
      const l = lay.letters[Math.floor(r() * lay.letters.length)];
      const p = this.toWord(l, [l.g.w * (r() < 0.5 ? 0 : 1) + (r() - 0.5) * 0.2, 0.95], place);
      this.sparkle(lg, p[0], p[1], st.T * k * (0.5 + r() * 0.4), '#ffffff');
    }
    this.composite(L, throwUp ? { shadow: 0.2, halo: 0.2 } : { shadow: 0.32, halo: 0.25 });
  }
  /** A point of a letter (letter units) in wall metres. */
  toWord(l, [x, y], place) {
    const m = new DOMMatrix(); const fake = { translate: (a, b) => m.translateSelf(a, b), rotate: (a) => m.rotateSelf(a * 180 / Math.PI), scale: (a, b) => m.scaleSelf(a, b), transform: (a, b, c, d, e, f) => m.multiplySelf(new DOMMatrix([a, b, c, d, e, f])) };
    place(fake, l);
    const p = m.transformPoint({ x, y });
    return [p.x, p.y];
  }
  /** What lies inside the letters on top of the fade. */
  fillIn(fg, it, fill, ox, oy, k, lay, pal = this.pal) {
    const r = rng(it.seed + 5);
    const top = oy + lay.top * k, bottom = oy + lay.bottom * k, left = ox - lay.st.T * k, right = ox + (lay.w + lay.st.T) * k;
    if (it.fillin === 'split') {
      // a scalloped cloud line across the lower third: below it the third colour, a little darker
      const yy = bottom + (top - bottom) * 0.36, sc = (top - bottom) * 0.1;
      const p = new Path2D(); p.moveTo(left, bottom - 1);
      p.lineTo(left, yy);
      for (let x = left; x < right; x += sc * 2) p.arc(x + sc, yy, sc, Math.PI, 0, true);
      p.lineTo(right, bottom - 1); p.closePath();
      fg.fillStyle = shade(fill[2], -0.1); fg.fill(p);
      fg.lineWidth = k * 0.022; fg.strokeStyle = rgba(shade(fill[0], 0.5), 0.9); fg.stroke(p);
      fg.fillStyle = rgba('#ffffff', 0.55);
      for (let i = 0; i < 10; i++) { fg.beginPath(); fg.arc(lerp(left, right, r()), lerp(bottom, yy - sc, r()), k * (0.02 + r() * 0.035), 0, TAU); fg.fill(); }
    } else if (it.fillin === 'bubbles') {
      for (let i = 0; i < Math.round((right - left) / k * 2.5); i++) {
        const x = lerp(left, right, r()), y = lerp(bottom, lerp(bottom, top, 0.6), r()), rad = k * (0.035 + r() * 0.09);
        fg.fillStyle = rgba(shade(fill[0], 0.35), 0.55); fg.beginPath(); fg.arc(x, y, rad, 0, TAU); fg.fill();
        fg.lineWidth = k * 0.012; fg.strokeStyle = rgba(pal.outline, 0.45); fg.stroke();
        fg.fillStyle = '#ffffff'; fg.beginPath(); fg.arc(x - rad * 0.35, y + rad * 0.35, rad * 0.25, 0, TAU); fg.fill();
      }
    } else if (it.fillin === 'shine') {
      // two diagonal streaks of light, like chrome
      fg.save(); fg.globalAlpha = 0.3; fg.fillStyle = '#ffffff';
      for (let x = left; x < right; x += k * 1.6) {
        fg.beginPath(); fg.moveTo(x, top); fg.lineTo(x + k * 0.22, top); fg.lineTo(x - k * 0.2, bottom); fg.lineTo(x - k * 0.42, bottom); fg.closePath(); fg.fill();
        fg.beginPath(); fg.moveTo(x + k * 0.3, top); fg.lineTo(x + k * 0.36, top); fg.lineTo(x - k * 0.06, bottom); fg.lineTo(x - k * 0.12, bottom); fg.closePath(); fg.fill();
      }
      fg.restore();
    }
    // a soft darkening at the bottom edge of every face: round letters
    const sh = fg.createLinearGradient(0, bottom + (top - bottom) * 0.3, 0, bottom);
    sh.addColorStop(0, rgba(pal.outline, 0)); sh.addColorStop(1, rgba(pal.outline, 0.3));
    fg.fillStyle = sh; fg.fillRect(left, bottom - 0.05, right - left, (top - bottom) * 0.3 + 0.05);
  }
  /** White highlights along the upper left edges of the strokes. */
  highlights(fg, l, place, st) {
    const up = [-0.6, 0.8];
    fg.save(); place(fg, l);
    fg.lineCap = 'round'; fg.lineJoin = 'round'; fg.strokeStyle = 'rgba(255,255,255,0.92)'; fg.lineWidth = st.T * 0.13;
    const inset = st.T / 2 - st.T * 0.17;
    for (const line of l.g.lines) {
      let run = [];
      const flush = () => {
        if (run.length >= 3) {
          const a = Math.floor(run.length * 0.15), b = Math.ceil(run.length * 0.85);
          const part = run.slice(a, Math.max(a + 2, b));
          const len = part.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - part[i - 1][0], p[1] - part[i - 1][1]) : 0), 0);
          if (len > 0.12) { fg.beginPath(); fg.moveTo(part[0][0], part[0][1]); for (const p of part) fg.lineTo(p[0], p[1]); fg.stroke(); }
        }
        run = [];
      };
      const n = line.length;
      for (let i = 0; i < n; i++) {
        const a = line[Math.max(0, i - 1)], b = line[Math.min(n - 1, i + 1)];
        let tx = b[0] - a[0], ty = b[1] - a[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        let nx = -ty, ny = tx; if (nx * up[0] + ny * up[1] < 0) { nx = -nx; ny = -ny; }
        if (nx * up[0] + ny * up[1] > 0.45) {
          // long straight segments get points in between, so their highlight is drawn too
          const p = [line[i][0] + nx * inset, line[i][1] + ny * inset];
          if (run.length) { const q = run[run.length - 1], d = Math.hypot(p[0] - q[0], p[1] - q[1]); for (let s = 1; s < d / 0.05; s++) run.push([q[0] + (p[0] - q[0]) * s * 0.05 / d, q[1] + (p[1] - q[1]) * s * 0.05 / d]); }
          run.push(p);
        } else flush();
      }
      flush();
    }
    // a white dot near the top left
    fg.fillStyle = '#ffffff';
    const p0 = l.g.lines[0]?.[0];
    if (p0) { fg.beginPath(); fg.arc(p0[0] - st.T * 0.12, Math.min(1, p0[1]) - st.T * 0.05, st.T * 0.07, 0, TAU); fg.fill(); }
    fg.restore();
  }
  letterDrips(lg, lay, place, st, k, fill, r) {
    const n = Math.max(1, Math.round(lay.letters.length * 0.45));
    for (let i = 0; i < n; i++) {
      const l = lay.letters[Math.floor(r() * lay.letters.length)];
      // the lowest point of the letter
      let low = null;
      for (const line of l.g.lines) for (const p of line) if (!low || p[1] < low[1]) low = p;
      if (!low) continue;
      const [x, y] = this.toWord(l, [low[0] + (r() - 0.5) * 0.25, low[1] - st.T * 0.3], place);
      const len = k * (0.12 + r() * 0.45), w = k * st.T * (0.08 + r() * 0.06);
      const drip = (width, col) => {
        lg.lineCap = 'round'; lg.strokeStyle = col; lg.fillStyle = col;
        lg.lineWidth = width; lg.beginPath(); lg.moveTo(x, y); lg.lineTo(x, y - len); lg.stroke();
        lg.beginPath(); lg.arc(x, y - len - width * 0.25, width * 0.85, 0, TAU); lg.fill();
      };
      drip(w + st.out * k * 0.8, this.pal.outline);
      drip(w, fill[2]);
      lg.strokeStyle = 'rgba(255,255,255,0.7)'; lg.lineWidth = w * 0.25; lg.beginPath(); lg.moveTo(x - w * 0.2, y - len * 0.2); lg.lineTo(x - w * 0.2, y - len * 0.75); lg.stroke();
    }
  }
  /** Something bold behind a piece so it stands out from the background. */
  backdrop(it, r) {
    const { g, pal } = this;
    this.frame(g);
    const cx = it.u + it.w / 2, cy = it.y + it.h / 2;
    if (it.backdrop === 'cloud') this.cloud(g, cx, cy + it.h * 0.06, it.w * 1.06, it.h * 1.0, r, { fill: pal.cloud, shadeC: pal.cloudShade, line: pal.cloudLine, lineWidth: 0.05 });
    else if (it.backdrop === 'rays') {
      // a sunburst of soft rays from behind the word
      const n = 18, R = Math.max(it.w, it.h) * 0.75;
      g.save();
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU + r() * 0.05, a1 = a0 + TAU / n * 0.5;
        const p = new Path2D(); p.moveTo(cx, cy); p.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R * 0.62); p.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R * 0.62); p.closePath();
        const rg = g.createRadialGradient(cx, cy, 0, cx, cy, R);
        rg.addColorStop(0, rgba(pal.glow, 0.55)); rg.addColorStop(0.6, rgba(pal.glow, 0.22)); rg.addColorStop(1, rgba(pal.glow, 0));
        g.fillStyle = rg; g.fill(p);
      }
      g.restore();
    } else if (it.backdrop === 'splash') {
      // an oval splash a little larger than the word
      const rad = it.h * 0.62, sx = it.w * 0.6 / rad;
      g.save(); g.translate(cx, cy); g.scale(Math.max(1, sx), 1);
      this.splat(g, 0, 0, rad, pick(r, pal.accents.filter((c) => c !== '#ffffff')), r, 0.85, { stretch: Math.max(1, sx) });
      g.restore();
    }
    else if (it.backdrop === 'sun' || it.backdrop === 'moon') {
      const R = it.h * 0.62, sx = cx + it.w * (r() < 0.5 ? -0.28 : 0.28), sy = cy + it.h * 0.12;
      const rg = g.createRadialGradient(sx, sy, R * 0.6, sx, sy, R * 1.8);
      rg.addColorStop(0, rgba(it.backdrop === 'sun' ? '#ffd27a' : '#cfe8ff', 0.6)); rg.addColorStop(1, rgba(it.backdrop === 'sun' ? '#ff8a5c' : '#9fb8ff', 0));
      g.fillStyle = rg; g.beginPath(); g.arc(sx, sy, R * 1.8, 0, TAU); g.fill();
      if (it.backdrop === 'sun') {
        const lg = g.createLinearGradient(0, sy + R, 0, sy - R); lg.addColorStop(0, '#fff0a0'); lg.addColorStop(1, '#ff8f5a');
        g.fillStyle = lg; g.beginPath(); g.arc(sx, sy, R, 0, TAU); g.fill();
        g.save(); g.beginPath(); g.arc(sx, sy, R, 0, TAU); g.clip();
        for (let i = 0; i < 6; i++) { const yy = sy - R * 0.05 - i * R * 0.17; g.fillStyle = rgba(pal.bg[1], 0.9); g.fillRect(sx - R, yy - R * (0.02 + i * 0.012), R * 2, R * (0.04 + i * 0.024)); }
        g.restore();
      } else {
        g.fillStyle = '#f2f6ff'; g.beginPath(); g.arc(sx, sy, R * 0.8, 0, TAU); g.fill();
        g.fillStyle = rgba('#b9c6e6', 0.7); for (const [dx, dy, rr] of [[-0.3, 0.2, 0.16], [0.25, -0.15, 0.12], [0.05, 0.4, 0.08]]) { g.beginPath(); g.arc(sx + dx * R, sy + dy * R, rr * R, 0, TAU); g.fill(); }
      }
    }
  }

  // --- characters -----------------------------------------------------------------------------------------------------
  /**
   * A character is a list of parts, back to front: { path, fill (colour or [top, bottom]), stroke?: pen width for line
   * parts, detail(g) }. Each part is outlined like the letters; a soft glow lifts the figure off the background.
   */
  character(it) {
    const { pal, g: wg } = this;
    const r = rng(it.seed);
    const parts = { cat: catParts, owl: owlParts, book: bookParts, worm: wormParts }[it.kind](pal, r);
    // the glow behind
    this.frame(wg);
    const cx = it.u + it.w / 2, cy = it.y + it.h * 0.5, R = Math.max(it.w, it.h) * 0.75;
    const rg = wg.createRadialGradient(cx, cy, 0, cx, cy, R);
    rg.addColorStop(0, rgba(pal.glow, 0.55)); rg.addColorStop(0.6, rgba(pal.glow, 0.2)); rg.addColorStop(1, rgba(pal.glow, 0));
    wg.fillStyle = rg; wg.beginPath(); wg.ellipse(cx, cy, R, R * 0.85, 0, 0, TAU); wg.fill();
    const pad = 0.12;
    const L = this.layer(it.u - pad, it.u + it.w + pad, it.y - pad, it.y + it.h + pad);
    const g = L.g, unit = it.h;            // character units: height 1
    const place = (gg) => { gg.translate(it.u + it.w / 2, it.y); gg.scale(it.flip ? -unit : unit, unit); };
    const out = 0.016;
    const grow = (gg, p, extra, style) => {
      gg.save(); place(gg);
      gg.lineJoin = 'round'; gg.lineCap = 'round'; gg.strokeStyle = style; gg.fillStyle = style;
      if (p.stroke) { gg.lineWidth = p.stroke + 2 * extra; gg.stroke(p.path); }
      else { gg.fill(p.path); if (extra > 0) { gg.lineWidth = 2 * extra; gg.stroke(p.path); } }
      gg.restore();
    };
    for (const p of parts) {
      if (!p.noOutline) grow(g, p, out, pal.outline);
      g.save(); place(g);
      const style = Array.isArray(p.fill) ? (() => { const lg = g.createLinearGradient(0, p.box[1], 0, p.box[0]); lg.addColorStop(0, p.fill[0]); lg.addColorStop(1, p.fill[1]); return lg; })() : p.fill;
      g.lineJoin = 'round'; g.lineCap = 'round';
      if (p.stroke) { g.lineWidth = p.stroke; g.strokeStyle = style; g.stroke(p.path); }
      else { g.fillStyle = style; g.fill(p.path); }
      if (p.detail) { g.save(); if (!p.stroke) g.clip(p.path); p.detail(g); g.restore(); }
      g.restore();
    }
    this.composite(L, { shadow: 0.3, halo: 0.2 });
  }

  // --- small things ---------------------------------------------------------------------------------------------------
  decor(it) {
    const { g, pal } = this;
    this.frame(g);
    const r = rng(it.seed);
    g.save(); g.translate(it.u, it.y); g.rotate(it.rot);
    const s = it.size, col = it.color, ink = pal.outline;
    const outlined = (path, fillStyle, lw = s * 0.08) => {
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.lineWidth = lw; g.strokeStyle = ink; g.stroke(path);
      g.fillStyle = fillStyle; g.fill(path);
    };
    const block = (path, dx, dy) => { g.save(); g.translate(dx, dy); g.lineWidth = s * 0.08; g.strokeStyle = ink; g.lineJoin = 'round'; g.stroke(path); g.fillStyle = shade(col, -0.5); g.fill(path); g.restore(); };
    switch (it.kind) {
      case 'star': {
        const p = starPath(0, 0, s, s * 0.46, 5);
        block(p, s * 0.09, -s * 0.09);
        const lg = g.createLinearGradient(0, s, 0, -s); lg.addColorStop(0, shade(col, 0.5)); lg.addColorStop(1, col);
        outlined(p, lg);
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(-s * 0.18, s * 0.3, s * 0.09, 0, TAU); g.fill();
        break;
      }
      case 'stars': {
        for (let i = 0; i < 3; i++) {
          const x = (r() - 0.5) * s * 2.2, y = (r() - 0.5) * s * 1.6, rr = s * (0.25 + r() * 0.3);
          const p = starPath(x, y, rr, rr * 0.45, 5);
          outlined(p, i % 2 ? '#ffffff' : col, rr * 0.12);
        }
        break;
      }
      case 'sparkles': {
        this.sparkle(g, 0, 0, s, '#ffffff');
        this.sparkle(g, s * 0.75, s * 0.55, s * 0.45, r() < 0.5 ? '#ffffff' : shade(col, 0.5));
        this.sparkle(g, -s * 0.6, -s * 0.5, s * 0.3, '#ffffff');
        break;
      }
      case 'bubbles': {
        for (let i = 0; i < 3 + Math.floor(r() * 2); i++) {
          const x = (r() - 0.5) * s * 1.6, y = (r() - 0.5) * s * 1.6, rad = s * (0.18 + r() * 0.3);
          const p = new Path2D(); p.arc(x, y, rad, 0, TAU);
          const rg = g.createRadialGradient(x - rad * 0.3, y + rad * 0.3, rad * 0.1, x, y, rad);
          rg.addColorStop(0, shade(col, 0.6)); rg.addColorStop(1, col);
          outlined(p, rg, rad * 0.14);
          g.strokeStyle = '#ffffff'; g.lineWidth = rad * 0.14; g.beginPath(); g.arc(x, y, rad * 0.62, Math.PI * 0.55, Math.PI * 0.95); g.stroke();
        }
        break;
      }
      case 'splat': this.splat(g, 0, 0, s * 0.7, col, r, 0.92); break;
      case 'dots': {
        g.fillStyle = col;
        for (let i = 0; i < 9; i++) { g.beginPath(); g.arc((r() - 0.5) * s * 2, (r() - 0.5) * s * 2, s * (0.04 + r() * 0.07), 0, TAU); g.fill(); }
        break;
      }
      case 'bolt': {
        const p = new Path2D();
        p.moveTo(s * 0.15, s); p.lineTo(-s * 0.45, -s * 0.05); p.lineTo(-s * 0.02, -s * 0.05); p.lineTo(-s * 0.2, -s); p.lineTo(s * 0.45, s * 0.12); p.lineTo(s * 0.04, s * 0.12); p.closePath();
        block(p, s * 0.08, -s * 0.06);
        outlined(p, col);
        break;
      }
      case 'halftone': {
        g.fillStyle = rgba(col === '#ffffff' ? pal.accents[0] : col, 0.8);
        const step = s * 0.16;
        for (let y = -s; y <= s; y += step) for (let x = -s; x <= s; x += step) {
          const d = Math.hypot(x, y) / s; if (d > 1) continue;
          const rad = step * 0.48 * (1 - d) * (0.6 + 0.4 * (y + s) / (2 * s));
          if (rad > 0.002) { g.beginPath(); g.arc(x + ((Math.round(y / step) % 2) ? step / 2 : 0), y, rad, 0, TAU); g.fill(); }
        }
        break;
      }
      case 'crown': {
        const p = new Path2D();
        p.moveTo(-s, -s * 0.45); p.lineTo(-s, s * 0.35); p.lineTo(-s * 0.5, -s * 0.05); p.lineTo(0, s * 0.55); p.lineTo(s * 0.5, -s * 0.05); p.lineTo(s, s * 0.35); p.lineTo(s, -s * 0.45); p.closePath();
        const lg = g.createLinearGradient(0, s * 0.6, 0, -s * 0.5); lg.addColorStop(0, '#fff1a0'); lg.addColorStop(1, '#ffb52e');
        block(p, s * 0.08, -s * 0.08);
        outlined(p, lg);
        for (const [x, y] of [[-s, s * 0.35], [0, s * 0.55], [s, s * 0.35]]) { const q = new Path2D(); q.arc(x, y + s * 0.12, s * 0.13, 0, TAU); outlined(q, col === '#ffffff' ? pal.accents[1] : col, s * 0.05); }
        break;
      }
      case 'arrow': {
        // a curved arrow sweeping out from the piece
        const dir = it.dir || 1, pts = [];
        for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push([dir * (-s + t * s * 2), -s * 0.35 + Math.sin(t * Math.PI) * s * 0.55 + t * s * 0.25]); }
        const w0 = s * 0.2, head = s * 0.42;
        const left = [], right = [];
        for (let i = 0; i < pts.length - 1; i++) {
          const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], len = Math.hypot(x1 - x0, y1 - y0) || 1, nx = -(y1 - y0) / len, ny = (x1 - x0) / len, w = w0 * (0.55 + 0.45 * i / pts.length);
          left.push([x0 + nx * w / 2, y0 + ny * w / 2]); right.push([x0 - nx * w / 2, y0 - ny * w / 2]);
        }
        const [ex, ey] = pts[pts.length - 1], [px, py] = pts[pts.length - 2];
        const dl = Math.hypot(ex - px, ey - py) || 1, tx = (ex - px) / dl, ty = (ey - py) / dl;
        const p = new Path2D();
        left.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
        p.lineTo(ex - ty * head * 0.5, ey + tx * head * 0.5); p.lineTo(ex + tx * head * 0.8, ey + ty * head * 0.8); p.lineTo(ex + ty * head * 0.5, ey - tx * head * 0.5);
        for (let i = right.length - 1; i >= 0; i--) p.lineTo(right[i][0], right[i][1]);
        p.closePath();
        block(p, s * 0.07, -s * 0.07);
        const lg = g.createLinearGradient(0, s * 0.5, 0, -s * 0.5); lg.addColorStop(0, shade(col, 0.45)); lg.addColorStop(1, col);
        outlined(p, lg, s * 0.06);
        break;
      }
    }
    g.restore();
  }
  /** A four-pointed sparkle with a soft glow. */
  sparkle(g, x, y, s, col) {
    g.save();
    const rg = g.createRadialGradient(x, y, 0, x, y, s * 0.9);
    rg.addColorStop(0, rgba(col, 0.75)); rg.addColorStop(1, rgba(col, 0));
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, s * 0.9, 0, TAU); g.fill();
    const p = new Path2D();
    p.moveTo(x, y + s);
    p.quadraticCurveTo(x + s * 0.08, y + s * 0.08, x + s * 0.7, y); p.quadraticCurveTo(x + s * 0.08, y - s * 0.08, x, y - s);
    p.quadraticCurveTo(x - s * 0.08, y - s * 0.08, x - s * 0.7, y); p.quadraticCurveTo(x - s * 0.08, y + s * 0.08, x, y + s);
    g.fillStyle = col; g.fill(p);
    g.restore();
  }
}

function starPath(cx, cy, ro, ri, n) {
  const p = new Path2D();
  for (let i = 0; i < n * 2; i++) {
    const a = Math.PI / 2 + (i / (n * 2)) * TAU, rad = i % 2 ? ri : ro;
    const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
    if (i) p.lineTo(x, y); else p.moveTo(x, y);
  }
  p.closePath();
  return p;
}
const ellipse = (cx, cy, rx, ry, rot = 0) => { const p = new Path2D(); p.ellipse(cx, cy, rx, ry, rot, 0, TAU); return p; };
const poly = (pts, close = true) => { const p = new Path2D(); pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); if (close) p.closePath(); return p; };

// ---------------------------------------------------------------- characters ----------------------------------------
// In character units: height 1, x = 0 in the middle, y = 0 at the bottom (y up).

/** The library cat, sitting, with round glasses, reading a book. */
function catParts(pal, r) {
  const fur = pick(r, [['#d9bf9c', '#a8875f'], ['#ffb35c', '#ff8f3a'], ['#c9c7d3', '#8f8ca3']]), belly = ['#fff1d8', '#ffd9a8'], ink = pal.outline;
  const book = pick(r, pal.fills)[1];
  const tail = new Path2D(); tail.moveTo(0.18, 0.08); tail.bezierCurveTo(0.5, 0.02, 0.52, 0.32, 0.4, 0.46); tail.bezierCurveTo(0.33, 0.55, 0.4, 0.63, 0.47, 0.6);
  const body = ellipse(0, 0.3, 0.27, 0.29);
  const feet = new Path2D(); feet.ellipse(-0.14, 0.035, 0.1, 0.05, 0, 0, TAU); feet.moveTo(0.24, 0.035); feet.ellipse(0.14, 0.035, 0.1, 0.05, 0, 0, TAU);
  const head = ellipse(0, 0.7, 0.27, 0.225);
  const earL = poly([[-0.25, 0.74], [-0.22, 0.99], [-0.05, 0.89]]), earR = poly([[0.25, 0.74], [0.22, 0.99], [0.05, 0.89]]);
  const cover = poly([[-0.25, 0.33], [0, 0.29], [0.25, 0.33], [0.25, 0.1], [0, 0.07], [-0.25, 0.1]]);
  const pages = poly([[-0.22, 0.32], [0, 0.29], [0.22, 0.32], [0.22, 0.12], [0, 0.09], [-0.22, 0.12]]);
  const paws = new Path2D(); paws.ellipse(-0.24, 0.22, 0.06, 0.05, 0.3, 0, TAU); paws.moveTo(0.3, 0.22); paws.ellipse(0.24, 0.22, 0.06, 0.05, -0.3, 0, TAU);
  const stripes = (g, ys) => { g.strokeStyle = shade(fur[1], -0.35); g.lineCap = 'round'; for (const [x0, y0, x1, y1, w] of ys) { g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + 0.03, x1, y1); g.stroke(); } };
  return [
    { path: tail, stroke: 0.085, fill: fur[1], box: [0, 0.65] },
    { path: body, fill: fur, box: [0.01, 0.6], detail: (g) => { g.fillStyle = ellipseFill(g, belly); g.fill(ellipse(0, 0.26, 0.16, 0.2)); stripes(g, [[-0.27, 0.42, -0.15, 0.4, 0.035], [-0.28, 0.32, -0.17, 0.3, 0.03], [0.27, 0.42, 0.15, 0.4, 0.035], [0.28, 0.32, 0.17, 0.3, 0.03]]); shadeSide(g, 0, 0.3, 0.3); } },
    { path: feet, fill: belly, box: [0, 0.09] },
    { path: cover, fill: [shade(book, 0.15), shade(book, -0.2)], box: [0.07, 0.33] },
    { path: pages, fill: ['#ffffff', '#efe6d4'], box: [0.09, 0.32], detail: (g) => { g.strokeStyle = 'rgba(60,50,80,0.45)'; g.lineWidth = 0.008; for (let i = 0; i < 6; i++) for (const s of [-1, 1]) { const y = 0.27 - i * 0.028; g.beginPath(); g.moveTo(s * 0.03, y - 0.004); g.lineTo(s * (0.03 + 0.15 - (i === 5 ? 0.06 : 0)), y + 0.012); g.stroke(); } g.strokeStyle = 'rgba(60,50,80,0.5)'; g.lineWidth = 0.01; g.beginPath(); g.moveTo(0, 0.29); g.lineTo(0, 0.09); g.stroke(); } },
    { path: paws, fill: belly, box: [0.17, 0.27] },
    { path: earL, fill: fur, box: [0.74, 0.99], detail: (g) => { g.fillStyle = '#ff9fb2'; g.fill(poly([[-0.21, 0.79], [-0.2, 0.93], [-0.1, 0.87]])); } },
    { path: earR, fill: fur, box: [0.74, 0.99], detail: (g) => { g.fillStyle = '#ff9fb2'; g.fill(poly([[0.21, 0.79], [0.2, 0.93], [0.1, 0.87]])); } },
    { path: head, fill: [shade(fur[0], 0.12), fur[1]], box: [0.48, 0.93], detail: (g) => {
      stripes(g, [[-0.06, 0.92, -0.04, 0.84, 0.025], [0, 0.93, 0, 0.85, 0.025], [0.06, 0.92, 0.04, 0.84, 0.025]]);
      g.fillStyle = ellipseFill(g, belly); g.fill(ellipse(0, 0.6, 0.13, 0.08));
      // eyes behind round glasses, looking down into the book
      for (const s of [-1, 1]) {
        g.fillStyle = '#ffffff'; g.fill(ellipse(s * 0.1, 0.705, 0.062, 0.066));
        g.fillStyle = '#2b2a1a'; g.fill(ellipse(s * 0.1, 0.685, 0.036, 0.042));
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(s * 0.1 - 0.014, 0.7, 0.012, 0, TAU); g.fill();
        g.strokeStyle = ink; g.lineWidth = 0.016; g.beginPath(); g.arc(s * 0.1, 0.705, 0.078, 0, TAU); g.stroke();
      }
      g.beginPath(); g.moveTo(-0.025, 0.72); g.quadraticCurveTo(0, 0.735, 0.025, 0.72); g.stroke();
      g.fillStyle = '#ff7f9e'; g.fill(poly([[-0.025, 0.625], [0.025, 0.625], [0, 0.6]]));
      g.strokeStyle = ink; g.lineWidth = 0.01; g.beginPath(); g.moveTo(0, 0.6); g.quadraticCurveTo(-0.02, 0.57, -0.045, 0.585); g.moveTo(0, 0.6); g.quadraticCurveTo(0.02, 0.57, 0.045, 0.585); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 0.007;
      for (const s of [-1, 1]) for (const dy of [0.02, 0, -0.02]) { g.beginPath(); g.moveTo(s * 0.13, 0.6 + dy * 0.5); g.lineTo(s * 0.32, 0.6 + dy * 1.8); g.stroke(); }
      shadeSide(g, 0, 0.7, 0.28);
    } },
  ];
}
/** An owl with glasses on a stack of books. */
function owlParts(pal, r) {
  const f = pal.fills;
  const books = [[-0.33, 0.0, 0.66, 0.11, f[0][1], -0.01], [-0.29, 0.11, 0.6, 0.1, f[1][1], 0.025], [-0.31, 0.21, 0.58, 0.1, f[2][1], -0.02]];
  const parts = books.map(([x, y, w, h, c, rot]) => {
    const p = new Path2D(); const cx = x + w / 2, cy = y + h / 2;
    const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([a, b]) => [cx + a * Math.cos(rot) - b * Math.sin(rot), cy + a * Math.sin(rot) + b * Math.cos(rot)]);
    pts.forEach(([a, b], i) => (i ? p.lineTo(a, b) : p.moveTo(a, b))); p.closePath();
    return { path: p, fill: [shade(c, 0.2), shade(c, -0.15)], box: [y, y + h], detail: (g) => {
      g.fillStyle = '#fff6e6'; g.fillRect(cx + w / 2 - 0.07, y + 0.015, 0.06, h - 0.03);
      g.strokeStyle = 'rgba(80,60,40,0.35)'; g.lineWidth = 0.004; for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(cx + w / 2 - 0.07, y + h * i / 5); g.lineTo(cx + w / 2 - 0.01, y + h * i / 5); g.stroke(); }
      g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(cx - w / 2 + 0.06, y + h * 0.35, 0.04, h * 0.3); g.fillRect(cx - w / 2 + 0.13, y + h * 0.35, 0.18, h * 0.08);
    } };
  });
  const feather = pick(r, [['#b98cff', '#7b4fd6'], ['#7fd7ff', '#3a8fe0'], ['#ffb36b', '#e0702f']]);
  const body = ellipse(0, 0.57, 0.21, 0.27);
  const wingL = new Path2D(); wingL.moveTo(-0.18, 0.7); wingL.quadraticCurveTo(-0.33, 0.5, -0.2, 0.34); wingL.quadraticCurveTo(-0.14, 0.5, -0.18, 0.7);
  const wingR = new Path2D(); wingR.moveTo(0.18, 0.7); wingR.quadraticCurveTo(0.33, 0.5, 0.2, 0.34); wingR.quadraticCurveTo(0.14, 0.5, 0.18, 0.7);
  const tufts = poly([[-0.17, 0.74], [-0.2, 0.92], [-0.06, 0.8], [0.06, 0.8], [0.2, 0.92], [0.17, 0.74]]);
  const feet = new Path2D(); for (const s of [-1, 1]) for (const d of [-0.025, 0, 0.025]) { feet.moveTo(s * 0.07 + d + 0.015, 0.31); feet.ellipse(s * 0.07 + d, 0.31, 0.015, 0.025, 0, 0, TAU); }
  parts.push(
    { path: tufts, fill: [feather[0], feather[1]], box: [0.74, 0.92] },
    { path: wingL, fill: [feather[1], shade(feather[1], -0.25)], box: [0.34, 0.7] },
    { path: wingR, fill: [feather[1], shade(feather[1], -0.25)], box: [0.34, 0.7] },
    { path: body, fill: [shade(feather[0], 0.1), feather[1]], box: [0.3, 0.84], detail: (g) => {
      g.fillStyle = '#fff3dc'; g.fill(ellipse(0, 0.48, 0.13, 0.15));
      g.strokeStyle = shade(feather[1], -0.2); g.lineWidth = 0.009; g.lineCap = 'round';
      for (let i = 0; i < 9; i++) { const x = -0.08 + (i % 3) * 0.08 + (Math.floor(i / 3) % 2) * 0.04, y = 0.54 - Math.floor(i / 3) * 0.06; g.beginPath(); g.moveTo(x - 0.02, y + 0.012); g.quadraticCurveTo(x, y - 0.012, x + 0.02, y + 0.012); g.stroke(); }
      // face: two discs, big eyes behind round glasses, a beak
      g.fillStyle = '#fff3dc'; g.fill(ellipse(-0.075, 0.69, 0.1, 0.095)); g.fill(ellipse(0.075, 0.69, 0.1, 0.095));
      for (const s of [-1, 1]) {
        g.fillStyle = '#ffd23f'; g.fill(ellipse(s * 0.075, 0.69, 0.058, 0.058));
        g.fillStyle = '#1b1530'; g.fill(ellipse(s * 0.075, 0.69, 0.032, 0.034));
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(s * 0.075 - 0.012, 0.703, 0.011, 0, TAU); g.fill();
        g.strokeStyle = pal.outline; g.lineWidth = 0.017; g.beginPath(); g.arc(s * 0.075, 0.69, 0.077, 0, TAU); g.stroke();
      }
      g.fillStyle = '#ff9a2e'; g.fill(poly([[-0.025, 0.64], [0.025, 0.64], [0, 0.595]]));
      shadeSide(g, 0, 0.57, 0.25);
    } },
    { path: feet, fill: '#ff9a2e', box: [0.29, 0.34] },
  );
  return parts;
}
/** An open book flying on its pages, with motion lines. */
function bookParts(pal, r) {
  const c = pick(r, pal.fills)[1];
  const cover = new Path2D(); cover.moveTo(-0.62, 0.62); cover.quadraticCurveTo(-0.3, 0.86, 0, 0.66); cover.quadraticCurveTo(0.3, 0.86, 0.62, 0.62); cover.lineTo(0.56, 0.18); cover.quadraticCurveTo(0.28, 0.36, 0, 0.2); cover.quadraticCurveTo(-0.28, 0.36, -0.56, 0.18); cover.closePath();
  const left = new Path2D(); left.moveTo(-0.56, 0.66); left.quadraticCurveTo(-0.28, 0.86, 0, 0.7); left.lineTo(0, 0.25); left.quadraticCurveTo(-0.28, 0.4, -0.51, 0.24); left.closePath();
  const right = new Path2D(); right.moveTo(0.56, 0.66); right.quadraticCurveTo(0.28, 0.86, 0, 0.7); right.lineTo(0, 0.25); right.quadraticCurveTo(0.28, 0.4, 0.51, 0.24); right.closePath();
  const lines = (s) => (g) => { g.strokeStyle = 'rgba(50,40,80,0.45)'; g.lineWidth = 0.012; g.lineCap = 'round'; for (let i = 0; i < 6; i++) { const t = 0.12 + i * 0.075; g.beginPath(); g.moveTo(s * 0.06, 0.66 - t); g.quadraticCurveTo(s * 0.24, 0.73 - t + 0.04, s * (0.44 - (i === 5 ? 0.12 : 0)), 0.66 - t + 0.02); g.stroke(); } };
  const trail = new Path2D(); for (const [y, l] of [[0.2, 0.3], [0.32, 0.42], [0.1, 0.22]]) { trail.moveTo(-0.66, y); trail.lineTo(-0.66 - l, y - 0.06); }
  return [
    { path: trail, stroke: 0.035, fill: '#ffffff', box: [0, 1] },
    { path: cover, fill: [shade(c, 0.2), shade(c, -0.25)], box: [0.18, 0.86] },
    { path: left, fill: ['#ffffff', '#f1e7d6'], box: [0.24, 0.86], detail: lines(-1) },
    { path: right, fill: ['#ffffff', '#ece0cc'], box: [0.24, 0.86], detail: lines(1) },
  ];
}
/** The bookworm: a worm with round glasses that has eaten its way out through the cover of a thick book. */
function wormParts(pal, r) {
  const c = pick(r, pal.fills)[2], ink = pal.outline;
  const skin = ['#b8f07a', '#5fc24a'];
  const book = new Path2D(); book.roundRect(-0.36, 0, 0.62, 0.78, [0.02, 0.05, 0.05, 0.02]);
  const pages = new Path2D(); pages.moveTo(0.26, 0.04); pages.lineTo(0.33, 0.07); pages.lineTo(0.33, 0.79); pages.lineTo(0.26, 0.77); pages.closePath();
  const body = new Path2D(); body.moveTo(-0.04, 0.42); body.bezierCurveTo(-0.04, 0.66, 0.06, 0.8, 0.22, 0.8); body.bezierCurveTo(0.34, 0.8, 0.38, 0.72, 0.36, 0.66);
  const head = ellipse(0.3, 0.8, 0.15, 0.13);
  return [
    { path: pages, fill: ['#fff8ea', '#e8dcc4'], box: [0.04, 0.79], detail: (g) => { g.strokeStyle = 'rgba(90,70,50,0.35)'; g.lineWidth = 0.004; for (let i = 1; i < 12; i++) { const y = 0.06 + i * 0.06; g.beginPath(); g.moveTo(0.265, y - 0.002); g.lineTo(0.33, y + 0.02); g.stroke(); } } },
    { path: book, fill: [shade(c, 0.22), shade(c, -0.22)], box: [0, 0.78], detail: (g) => {
      g.fillStyle = rgba(shade(c, -0.45), 0.85); g.fillRect(-0.36, 0, 0.07, 0.78);
      g.fillStyle = rgba('#fff4dc', 0.92); g.fillRect(-0.22, 0.56, 0.38, 0.12);
      g.fillStyle = rgba(shade(c, -0.4), 0.7); g.fillRect(-0.18, 0.6, 0.3, 0.025); g.fillRect(-0.18, 0.635, 0.2, 0.02);
      // the hole it ate
      g.fillStyle = '#1b1222'; g.fill(ellipse(-0.04, 0.4, 0.105, 0.09));
      g.strokeStyle = rgba('#ffffff', 0.35); g.lineWidth = 0.012; g.beginPath(); g.ellipse(-0.04, 0.4, 0.12, 0.105, 0, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      shadeSide(g, -0.05, 0.4, 0.42);
    } },
    { path: body, stroke: 0.15, fill: skin[1], box: [0.4, 0.85], detail: (g) => {
      g.strokeStyle = rgba(shade(skin[1], -0.4), 0.8); g.lineWidth = 0.012; g.lineCap = 'round';
      for (const [x, y, a] of [[-0.04, 0.5, 0], [-0.03, 0.58, 0.15], [0.01, 0.66, 0.4], [0.07, 0.73, 0.7], [0.15, 0.78, 1.1]]) { g.beginPath(); g.moveTo(x - Math.cos(a) * 0.07, y + Math.sin(a) * 0.07); g.lineTo(x + Math.cos(a) * 0.07, y - Math.sin(a) * 0.07); g.stroke(); }
      g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 0.02; g.beginPath(); g.moveTo(-0.09, 0.47); g.bezierCurveTo(-0.09, 0.65, 0.02, 0.76, 0.14, 0.79); g.stroke();
    } },
    { path: head, fill: skin, box: [0.67, 0.93], detail: (g) => {
      for (const sx of [0.25, 0.36]) {
        g.fillStyle = '#ffffff'; g.fill(ellipse(sx, 0.83, 0.042, 0.046));
        g.fillStyle = '#1b1530'; g.fill(ellipse(sx + 0.008, 0.825, 0.022, 0.026));
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(sx, 0.836, 0.008, 0, TAU); g.fill();
        g.strokeStyle = ink; g.lineWidth = 0.013; g.beginPath(); g.arc(sx, 0.83, 0.055, 0, TAU); g.stroke();
      }
      g.beginPath(); g.moveTo(0.29, 0.84); g.lineTo(0.32, 0.84); g.stroke();
      g.strokeStyle = ink; g.lineWidth = 0.012; g.lineCap = 'round'; g.beginPath(); g.arc(0.31, 0.75, 0.045, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
      g.fillStyle = 'rgba(255,120,140,0.55)'; g.fill(ellipse(0.2, 0.76, 0.025, 0.016)); g.fill(ellipse(0.42, 0.76, 0.025, 0.016));
      shadeSide(g, 0.3, 0.8, 0.15);
    } },
  ];
}
function ellipseFill(g, [a, b]) { const lg = g.createLinearGradient(0, 0.45, 0, 0.05); lg.addColorStop(0, a); lg.addColorStop(1, b); return lg; }
/** Paint a part rounder: dark towards its lower right, light at its upper left (inside the part's clip). */
function shadeSide(g, cx, cy, rad) {
  const dk = g.createRadialGradient(cx - rad * 0.4, cy + rad * 0.4, rad * 0.4, cx - rad * 0.2, cy + rad * 0.2, rad * 1.5);
  dk.addColorStop(0, 'rgba(20,10,40,0)'); dk.addColorStop(1, 'rgba(20,10,40,0.35)');
  g.fillStyle = dk; g.fillRect(cx - rad * 2, cy - rad * 2, rad * 4, rad * 4);
}
