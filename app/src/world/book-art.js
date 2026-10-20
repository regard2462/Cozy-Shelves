// The look of the books: fresh binding colours (the cover colour when it is a pleasant one, otherwise a
// modern cloth palette), clean spine designs for the shelf atlas (no gilt, cached per book) and a
// typographic front cover for books without a cover image.
import { hashStr, seeded, clamp } from '../core/hash.js';

export const CELL_W = 64, CELL_H = 512;

// ---------------------------------------------------------------- colour -----------------------------
/** Modern cloth and paper colours, from light to deep. */
export const PALETTE = [
  [0xf1, 0xe9, 0xda], // cream
  [0xf2, 0xcf, 0xc2], // blush
  [0xa9, 0xdb, 0xc9], // mint
  [0xb4, 0xb0, 0xdc], // lavender
  [0x7f, 0xb4, 0xe0], // sky blue
  [0x9c, 0xbf, 0x9f], // sage
  [0xe6, 0x9f, 0xa3], // rose
  [0xe2, 0xa8, 0x3f], // mustard
  [0xed, 0x86, 0x3d], // tangerine
  [0xe8, 0x70, 0x55], // coral
  [0xd4, 0x45, 0x3d], // tomato
  [0xc2, 0x5e, 0x40], // terracotta
  [0x2e, 0xa0, 0x92], // jade
  [0x7a, 0x8c, 0x3c], // olive
  [0x3b, 0x72, 0xc6], // cobalt
  [0x1f, 0x7b, 0x7a], // teal
  [0x8a, 0x4f, 0x9c], // plum
  [0xa8, 0x3e, 0x6e], // berry
  [0x2f, 0x6e, 0x51], // forest
  [0x17, 0x5f, 0x76], // petrol
  [0x27, 0x44, 0x7c], // navy
  [0x39, 0x3e, 0x46], // charcoal
];
export const PAPER = [0xf6, 0xf1, 0xe7];      // warm white: light ink, labels, bands
export const INK = [0x24, 0x27, 0x2d];        // charcoal ink on light grounds

const toLin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const fromLin = (v) => Math.round(clamp(v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055, 0, 1) * 255);
/** sRGB [0..255] → OKLCH [L 0..1, C, h degrees] */
export function oklch([r, g, b]) {
  const lr = toLin(r), lg = toLin(g), lb = toLin(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return [L, Math.hypot(A, B), (Math.atan2(B, A) * 180 / Math.PI + 360) % 360];
}
/** OKLCH → sRGB [0..255]; the chroma is reduced until the colour fits into sRGB. */
export function fromOklch(L, C, h) {
  const a0 = Math.cos(h * Math.PI / 180), b0 = Math.sin(h * Math.PI / 180);
  for (let i = 0; i < 30; i++, C *= 0.9) {
    const a = C * a0, b = C * b0;
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
    if (rgb.every((v) => v > -0.002 && v < 1.002) || i === 29) return rgb.map(fromLin);
  }
  return [128, 128, 128];
}
const luminance = ([r, g, b]) => 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** Ink with the better contrast on a ground: warm white or charcoal. */
export const inkOn = (ground) => (contrast(ground, PAPER) >= contrast(ground, INK) * 0.82 ? PAPER : INK);
export const rgb = (c, a = 1) => (a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);

/** A canvas in the page, or an OffscreenCanvas in a worker (workers/side-cover-worker.js draws title cards too). */
function makeCanvas(w, h) {
  if (typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return c;
}

let parser = null;
function parseColor(c) {
  if (!c) return null;
  parser = parser || makeCanvas(1, 1).getContext('2d');
  parser.fillStyle = '#010203'; parser.fillStyle = c;
  const m = /^#([0-9a-f]{6})$/i.exec(parser.fillStyle);
  if (!m || parser.fillStyle === '#010203') return null;
  return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
}

// ---------------------------------------------------------------- covers -----------------------------
// The indexer draws a title card for every book without a cover image (core/cover-art.js) and stores it
// as the cover. Since 0.4 the record says so (coverGenerated). Older cards were dark cloth with gilt frames,
// and their stored colour is one of these grounds, which the average of a real image never hits.
const LEGACY_GROUNDS = new Set(['#5b2a2a', '#1f3a4d', '#2f4a2e', '#4a3b6b', '#6b3d1f', '#2a2a2a', '#7a2f3f', '#245c5a', '#8a5a1e', '#3b3b5c', '#5c4a2b', '#1c4d3a']);
/**
 * True when the book shows the title card: the indexer made one, or page 1 of the book is no cover (blank, one flat
 * colour, plain text: coverWeak) and neither a cover from the internet nor the reader's own choice replaced it.
 */
export const isGeneratedCover = (book) => {
  if (!book || book.coverSource === 'web') return false;
  // the reader chose the title card in the book info ("Generiertes Titelbild")
  if (book.coverChoice === 'card') return true;
  if (book.coverWeak && book.coverChoice !== 'book') return true;
  return book.coverGenerated === true || (book.coverGenerated === undefined && LEGACY_GROUNDS.has(String(book.coverColor || '').toLowerCase()));
};
/** True when the book has a real cover image (neither missing nor a generated title card). */
export const hasCoverImage = (book) => !!book && book.hasCover !== false && !isGeneratedCover(book);

// ---------------------------------------------------------------- bindings ---------------------------
/**
 * The cover colour as a binding, when it is a pleasant one: clearly coloured, neither muddy brown, grey,
 * near black nor paper white. It is brightened a little so the shelves look fresh under the warm lamps.
 */
function freshCoverColor(c) {
  const [L, C, h] = oklch(c);
  if (C < 0.075 || L < 0.3 || L > 0.93) return null;              // grey, near black, paper white
  if (h > 30 && h < 100 && (C < 0.13 || L < 0.55)) return null;    // brown, khaki, olive drab
  return fromOklch(clamp(L, 0.46, 0.8), clamp(C * 1.1, 0.085, 0.19), h);
}

const bindingMemo = new Map();
/**
 * The colour a book is bound in. Average cover colours are mostly muddy (a whole shelf of brown), scanned
 * PDFs are white and unindexed books have none; all of those get a deterministic colour from the palette,
 * with a slightly different dye lot per book.
 */
export function bindingColor(book) {
  const key = (book?.id || '') + '|' + (book?.coverColor || '');
  let c = bindingMemo.get(key);
  if (c) return c;
  // the colour of a stand-in title card says nothing about the book: those get a palette colour too
  c = isGeneratedCover(book) ? null : freshCoverColor(parseColor(book?.coverColor) || [128, 128, 128]);
  if (!c) {
    const rnd = seeded(hashStr((book?.id || '') + 'cloth'));
    const [L, C, h] = oklch(PALETTE[Math.floor(rnd() * PALETTE.length)]);
    c = fromOklch(clamp(L + (rnd() - 0.5) * 0.06, 0.25, 0.95), C * (0.9 + rnd() * 0.2), h + (rnd() - 0.5) * 8);
  }
  if (bindingMemo.size > 20000) bindingMemo.clear();
  bindingMemo.set(key, c);
  return c;
}

/** A second colour that goes with `base` (bands, blocks, cover shapes); never a gold or yellow. */
export function accentFor(base, rnd) {
  const [L, , h] = oklch(base);
  if (rnd() < 0.45) return L > 0.62 ? INK : PAPER;
  const fits = PALETTE.filter((p) => {
    const [pl, pc, ph] = oklch(p);
    const dh = Math.min(Math.abs(ph - h), 360 - Math.abs(ph - h));
    return !(ph > 60 && ph < 110 && pc > 0.08) && (Math.abs(pl - L) > 0.22 || (dh > 70 && pc > 0.06));
  });
  return fits.length ? fits[Math.floor(rnd() * fits.length)] : (L > 0.62 ? INK : PAPER);
}

// ---------------------------------------------------------------- type -------------------------------
const SANS = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
const SANS_NARROW = 'Bahnschrift, "Segoe UI", "Arial Narrow", Arial, sans-serif';
const DISPLAY = '"Playfair Display", Georgia, serif';
const SERIF = '"EB Garamond", Georgia, serif';
// the web fonts must be loaded before a canvas can use them; drawing earlier silently falls back to Georgia
const WEBFONTS = ['700 32px "Playfair Display"', '600 32px "EB Garamond"', 'italic 400 32px "EB Garamond"', '500 32px "EB Garamond"'];
let fontsReady = typeof document === 'undefined' || !document.fonts;
const fontsLoading = fontsReady ? Promise.resolve() : Promise.all(WEBFONTS.map((f) => document.fonts.load(f).catch(() => null))).then(() => { fontsReady = true; });
export const fontsLoaded = () => fontsReady;
export const whenFontsLoaded = () => fontsLoading;

/** Type pairings for spines: [title family, weight, uppercase?, tracking em] and the author style. */
const PAIRINGS = [
  { title: SANS, weight: 600, upper: false, track: 0, author: SERIF, aWeight: 'italic 400', aUpper: false, aTrack: 0 },
  { title: SANS_NARROW, weight: 600, upper: true, track: 0.06, author: SERIF, aWeight: 'italic 400', aUpper: false, aTrack: 0 },
  { title: DISPLAY, weight: 700, upper: false, track: 0, author: SANS, aWeight: '600', aUpper: true, aTrack: 0.14 },
  { title: SERIF, weight: 600, upper: false, track: 0.01, author: SANS, aWeight: '600', aUpper: true, aTrack: 0.14 },
  { title: SANS, weight: 700, upper: true, track: 0.08, author: SANS, aWeight: '400', aUpper: false, aTrack: 0.02 },
];

/** "Storm, Theodor" → "Theodor Storm"; lists keep their first name. */
export function shortAuthor(author) {
  let a = String(author || '').split(/;|\s&\s|\sund\s|\sand\s/)[0].trim();
  const parts = a.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 2 && !/\s/.test(parts[0]) && parts[1].split(/\s+/).length <= 3) a = parts[1] + ' ' + parts[0];
  else a = parts[0] || '';
  return a.replace(/\s+/g, ' ').slice(0, 60);
}
/** The main title without a subtitle ("Titel: Untertitel", "Titel - Untertitel", "Titel (Reihe)"). */
export function mainTitle(title) {
  const t = String(title || '').trim();
  const cut = t.split(/\s*[:(]\s*|\s+[-–—]\s+|\.\s+(?=[A-ZÄÖÜ])/)[0].trim();
  return cut.length >= 3 ? cut : t;
}

// ---------------------------------------------------------------- spines ----------------------------
let grainCanvases = null;
/** Fine cloth grain (transparent, a few percent light and dark fibres) laid over every spine and cover. */
function grain(k) {
  if (!grainCanvases) {
    grainCanvases = [0, 1, 2].map((s) => {
      const c = makeCanvas(CELL_W, CELL_H);
      const g = c.getContext('2d'); const img = g.createImageData(CELL_W, CELL_H); const d = img.data;
      const rnd = seeded(9001 + s * 77);
      const rows = new Float32Array(CELL_H).map(() => rnd() - 0.5);
      for (let y = 0; y < CELL_H; y++) for (let x = 0; x < CELL_W; x++) {
        const n = (rnd() - 0.5) * 0.9 + rows[y] * 0.8 + (x % 2 ? 0.08 : -0.08);
        const i = (y * CELL_W + x) * 4;
        const v = n > 0 ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = Math.round(Math.min(1, Math.abs(n)) * 16);
      }
      g.putImageData(img, 0, 0);
      return c;
    });
  }
  return grainCanvases[k % grainCanvases.length];
}

function roundRect(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }

/** A small geometric imprint at the foot of the spine (sx: along-scale that keeps it round). */
function drawMark(g, kind, cx, cy, color, sx) {
  g.save(); g.translate(cx, cy); g.scale(1, sx); g.fillStyle = color; g.strokeStyle = color;
  switch (kind) {
    case 0: g.beginPath(); g.arc(0, 0, 5.5, 0, Math.PI * 2); g.fill(); break;
    case 1: g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 6.5, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(0, 0, 2, 0, Math.PI * 2); g.fill(); break;
    case 2: roundRect(g, -5.5, -5.5, 11, 11, 2); g.fill(); break;
    case 3: g.beginPath(); g.moveTo(0, -7); g.lineTo(6.5, 5); g.lineTo(-6.5, 5); g.closePath(); g.fill(); break;
    case 4: g.fillRect(-8, -4, 16, 2.4); g.fillRect(-8, 1.6, 16, 2.4); break;
    default: g.beginPath(); g.arc(-4, 0, 3.4, 0, Math.PI * 2); g.arc(4, 0, 3.4, 0, Math.PI * 2); g.fill(); break;
  }
  g.restore();
}

/**
 * Text along the spine. y0..y1 is the physical stretch (canvas y, 0 = head of the spine) it may occupy,
 * `across` the offset from the centre line in reading direction (negative = above the line).
 * German spines read from the foot upwards, English ones from the head down. Returns the length used.
 */
function spineText(g, text, { font, color, y0, y1, align = 'center', across = 0, track = 0, sx, up }) {
  g.save();
  g.translate(CELL_W / 2, CELL_H / 2);
  g.rotate(up ? -Math.PI / 2 : Math.PI / 2);
  g.scale(sx, 1);
  g.font = font; g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  if ('letterSpacing' in g) g.letterSpacing = track ? `${track}em` : '0px';
  const m = g.measureText(text);
  const len = m.width * sx;
  const yc = align === 'center' ? (y0 + y1) / 2 : align === 'head' ? y0 + len / 2 : y1 - len / 2;
  const X = up ? CELL_H / 2 - yc : yc - CELL_H / 2;
  g.fillText(text, X / sx, across + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  g.restore();
  return len;
}
function measureAlong(g, text, font, track, sx) {
  g.save(); g.font = font; if ('letterSpacing' in g) g.letterSpacing = track ? `${track}em` : '0px';
  const w = g.measureText(text).width * sx; g.restore(); return w;
}

const even = (v) => Math.round(v / 2) * 2;
const evenDown = (v) => Math.floor(v / 2) * 2;

/**
 * Draws one spine into a CELL_W × CELL_H canvas (0,0 = head of the spine). w, h: physical spine width
 * and height in metres, so the lettering keeps its proportions on thin and thick books alike.
 */
export function drawSpine(g, book, w = 0.03, h = 0.22) {
  const rnd = seeded(hashStr(book.id + ':spine'));
  const base = bindingColor(book);
  const ink = inkOn(base);
  const mmPx = (w * 1000) / CELL_W;                             // millimetres per canvas pixel across
  // along-scale for undistorted glyphs, in steps: every distinct transform or size is a new set of glyphs to
  // rasterise, and continuous values made the first drawing of a shelf several times slower
  const sx = Math.round(clamp((w / CELL_W) / (h / CELL_H), 0.6, 1.6) * 10) / 10;
  const up = !/^en/i.test(book.language || '');                // German spines read upwards, English ones down
  const pair = PAIRINGS[Math.floor(rnd() * PAIRINGS.length)];
  const r = rnd();
  const style = r < 0.3 ? 'plain' : r < 0.55 ? 'band' : r < 0.7 ? 'block' : r < 0.82 ? 'stripes' : 'label';
  const accent = accentFor(base, rnd);
  const accentInk = inkOn(accent);
  const mark = Math.floor(rnd() * 6);
  const W = CELL_W, H = CELL_H;

  g.save();
  g.fillStyle = rgb(base); g.fillRect(0, 0, W, H);
  // colour fields
  let head = 16, foot = H - 16, markY = H - 26, markInk = ink;
  if (style === 'band') {
    const bh = Math.round(52 + rnd() * 26), atHead = rnd() < 0.5;
    g.fillStyle = rgb(accent);
    if (atHead) { g.fillRect(0, 0, W, bh); head = bh + 16; } else { g.fillRect(0, H - bh, W, bh); foot = H - bh - 14; markY = H - bh / 2; markInk = accentInk; }
    if (atHead) foot = H - 46;
  } else if (style === 'block') {
    const bh = Math.round(H * (0.24 + rnd() * 0.1));
    g.fillStyle = rgb(accent); g.fillRect(0, H - bh, W, bh);
    foot = H - bh - 14; markY = H - bh / 2; markInk = accentInk;
  } else if (style === 'stripes') {
    g.fillStyle = rgb(accent);
    for (const y of [26, 34, H - 58, H - 50]) g.fillRect(0, y, W, 3.5);
    head = 50; foot = H - 72;
  } else {
    foot = H - 50;
  }
  // cloth grain and the rounded back
  g.drawImage(grain(Math.floor(rnd() * 3)), 0, 0);
  const sh = g.createLinearGradient(0, 0, W, 0);
  sh.addColorStop(0, 'rgba(0,0,0,0.24)'); sh.addColorStop(0.1, 'rgba(0,0,0,0.05)'); sh.addColorStop(0.35, 'rgba(255,255,255,0.06)');
  sh.addColorStop(0.65, 'rgba(255,255,255,0.02)'); sh.addColorStop(0.9, 'rgba(0,0,0,0.06)'); sh.addColorStop(1, 'rgba(0,0,0,0.26)');
  g.fillStyle = sh; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, 0, W, 2); g.fillRect(0, H - 2, W, 2);

  // lettering
  const author = shortAuthor(book.author);
  let title = String(book.title || '').replace(/\s+/g, ' ').trim() || '…';
  const fMax = even(clamp(18 / mmPx, 16, 34));
  let zone0 = head, zone1 = foot, textInk = ink;
  if (style === 'label') {
    // a light (or dark) paper label carries the title
    const inset = Math.max(5, Math.round(2.2 / mmPx));
    const l0 = Math.round(62 + rnd() * 20), l1 = Math.round(H * (0.66 + rnd() * 0.08));
    const label = oklch(base)[0] > 0.72 ? INK : PAPER;
    g.fillStyle = rgb(label); roundRect(g, inset, l0, W - inset * 2, l1 - l0, 3); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(inset, l1 - 2, W - inset * 2, 2);
    zone0 = l0 + 12; zone1 = l1 - 12; textInk = inkOn(label);
    // the author goes below the label
    if (author) {
      const aF = even(clamp(fMax * 0.46, 11, 15));
      const aFont = `${pair.aWeight} ${aF}px ${pair.author}`;
      let a = pair.aUpper ? author.toUpperCase() : author;
      if (measureAlong(g, a, aFont, pair.aTrack, sx) > foot - l1 - 18) a = a.split(' ').pop();
      if (measureAlong(g, a, aFont, pair.aTrack, sx) <= foot - l1 - 18) spineText(g, a, { font: aFont, color: rgb(ink, 0.85), y0: l1 + 12, y1: foot, align: 'center', track: pair.aTrack, sx, up });
    }
  }
  const zoneLen = zone1 - zone0;
  const tFont = (f) => `${pair.weight} ${f}px ${pair.title}`;
  const shown = (t) => (pair.upper ? t.toUpperCase() : t);
  // lengths are measured once at a reference size: they scale with the font size (tracking is in em)
  const REF = 32, widths = new Map();
  const lenAt = (t, f) => { let w = widths.get(t); if (w == null) { w = measureAlong(g, shown(t), tFont(REF), pair.track, sx); widths.set(t, w); } return (w * f) / REF; };
  // author first (head side), then the title; the author yields when there is no room
  let aText = style === 'label' ? '' : author;
  const aF = even(clamp(fMax * 0.5, 11, 17));
  const aFont = `${pair.aWeight} ${aF}px ${pair.author}`;
  const thick = w >= 0.036 && !!aText;       // thick spines stack title and author across the width
  let aLen = aText && !thick ? measureAlong(g, pair.aUpper ? aText.toUpperCase() : aText, aFont, pair.aTrack, sx) : 0;
  if (aLen > zoneLen * 0.45) { aText = aText.split(' ').pop(); aLen = measureAlong(g, pair.aUpper ? aText.toUpperCase() : aText, aFont, pair.aTrack, sx); }
  if (aLen > zoneLen * 0.45) { aText = ''; aLen = 0; }
  const gap = aLen ? 18 : 0;
  const room = zoneLen - aLen - gap;
  const fMin = Math.max(16, even(fMax * 0.62));
  const sizeFor = (t) => Math.min(fMax, evenDown((REF * room) / Math.max(1, lenAt(t, REF))));
  let f = sizeFor(title), lines = null;
  if (f < fMin && sizeFor(mainTitle(title)) >= fMin) { title = mainTitle(title); f = sizeFor(title); }
  if (f < fMin) {
    // two lines across the spine, split where both halves are about equally long
    const t = mainTitle(title);
    const words = t.split(' ');
    const f2 = Math.min(even(fMax * 0.56), 20);
    if (words.length > 1 && f2 >= 12) {
      let best = null;
      for (let i = 1; i < words.length; i++) {
        const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
        const m = Math.max(lenAt(a, f2), lenAt(b, f2));
        if (!best || m < best.m) best = { a, b, m };
      }
      if (best && best.m <= room) { lines = [best.a, best.b]; f = f2; }
    }
    if (!lines) {
      // cut at the longest prefix that fits with an ellipsis (binary search)
      f = fMin;
      let lo = 1, hi = t.length;
      while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (lenAt(t.slice(0, mid).trim() + '…', f) <= room) lo = mid; else hi = mid - 1; }
      title = t.slice(0, Math.max(1, lo)).trim() + '…';
    }
  }
  const color = rgb(textInk);
  if (thick && !lines) {
    // title above, author below, both centred along the zone
    const tf = Math.min(f, 26);
    spineText(g, shown(title), { font: tFont(tf), color, y0: zone0, y1: zone1, across: -tf * 0.32, track: pair.track, sx, up });
    const a = pair.aUpper ? author.toUpperCase() : author;
    spineText(g, measureAlong(g, a, aFont, pair.aTrack, sx) <= zoneLen ? a : a.split(' ').pop(), { font: aFont, color: rgb(textInk, 0.82), y0: zone0, y1: zone1, across: aF * 1.05, track: pair.aTrack, sx, up });
  } else {
    // physical order from the head: author, title (the German foot-up reading meets the title first)
    const authorAtHead = rnd() < 0.62;
    const aStart = authorAtHead ? zone0 : zone1 - aLen;
    const t0 = authorAtHead ? zone0 + aLen + gap : zone0, t1 = authorAtHead ? zone1 : zone1 - aLen - gap;
    if (lines) {
      spineText(g, shown(lines[0]), { font: tFont(f), color, y0: t0, y1: t1, across: -f * 0.58, track: pair.track, sx, up });
      spineText(g, shown(lines[1]), { font: tFont(f), color, y0: t0, y1: t1, across: f * 0.58, track: pair.track, sx, up });
    } else {
      spineText(g, shown(title), { font: tFont(f), color, y0: t0, y1: t1, track: pair.track, sx, up });
    }
    if (aLen) spineText(g, pair.aUpper ? aText.toUpperCase() : aText, { font: aFont, color: rgb(textInk, 0.82), y0: aStart, y1: aStart + aLen, track: pair.aTrack, sx, up });
  }
  drawMark(g, mark, W / 2, markY, rgb(markInk, 0.9), sx);
  g.restore();
}

// ---------------------------------------------------------------- spine cache -----------------------
// Every drawing is kept for the next rebuild, in cells of a few shared "sheets" (4096 × 512 px, 64 cells):
// a canvas of its own per book cost more to create than the drawing itself. 128 KB per cell: 640 cells are
// 80 MB. A department with more books raises the limit to its own size, otherwise every rebuild would evict
// the drawings it is about to need again.
const SHEET_CELLS = 64;
const SPINE_CACHE_BASE = 640;
let spineCacheMax = SPINE_CACHE_BASE;
const sheets = [];               // { canvas, ctx }
const freeSlots = [];
let slotCount = 0;
const spineCache = new Map();    // book id → { key, slot }  (Map order = least recently used first)
const DESIGN = 6;                // bump when drawSpine changes, so old drawings are not reused
const stats = { drawn: 0, hits: 0 };

/** Makes room for the `n` spines of one build. */
export function reserveSpines(n) { spineCacheMax = Math.max(SPINE_CACHE_BASE, n + 32); }
export const spineCacheStats = () => ({ size: spineCache.size, sheets: sheets.length, ...stats });
/** Everything the spine drawing of a book depends on (books.js keeps its atlases while this stays the same). */
export const spineDrawingKey = (book, w, h) => spineKey(book, w, h);

function spineKey(book, w, h) {
  return [DESIGN, book.title || '', book.author || '', book.language || '', book.coverColor || '', w.toFixed(4), h.toFixed(4), fontsReady ? 1 : 0].join('|');
}
function takeSlot() {
  if (freeSlots.length) return freeSlots.pop();
  if (spineCache.size >= spineCacheMax) {           // reuse the cell of the least recently used drawing
    const [id, old] = spineCache.entries().next().value;
    spineCache.delete(id);
    return old.slot;
  }
  const slot = slotCount++;
  if (Math.floor(slot / SHEET_CELLS) >= sheets.length) {
    const canvas = document.createElement('canvas'); canvas.width = SHEET_CELLS * CELL_W; canvas.height = CELL_H;
    sheets.push({ canvas, ctx: canvas.getContext('2d') });
  }
  return slot;
}
/**
 * Where the spine drawing of a book is: { canvas, x, y } of a CELL_W × CELL_H cell. It is drawn once and
 * reused on every rebuild while title, author, language, colour and size stay the same.
 */
export function spineCell(book, w, h) {
  const key = spineKey(book, w, h);
  let e = spineCache.get(book.id);
  if (e) spineCache.delete(book.id);
  if (!e || e.key !== key) {
    const slot = e ? e.slot : takeSlot();
    const { ctx } = sheets[Math.floor(slot / SHEET_CELLS)];
    ctx.save();
    ctx.translate((slot % SHEET_CELLS) * CELL_W, 0);
    ctx.beginPath(); ctx.rect(0, 0, CELL_W, CELL_H); ctx.clip();
    drawSpine(ctx, book, w, h);
    ctx.restore();
    e = { key, slot };
    stats.drawn++;
  } else stats.hits++;
  spineCache.set(book.id, e);
  while (spineCache.size > spineCacheMax) { const [id, old] = spineCache.entries().next().value; spineCache.delete(id); freeSlots.push(old.slot); }
  return { canvas: sheets[Math.floor(e.slot / SHEET_CELLS)].canvas, x: (e.slot % SHEET_CELLS) * CELL_W, y: 0 };
}
/** The spine drawing as a canvas of its own (for a stand-alone book mesh). */
export function spineCanvas(book, w, h) {
  const cell = spineCell(book, w, h);
  const c = document.createElement('canvas'); c.width = CELL_W; c.height = CELL_H;
  c.getContext('2d').drawImage(cell.canvas, cell.x, cell.y, CELL_W, CELL_H, 0, 0, CELL_W, CELL_H);
  return c;
}

// ---------------------------------------------------------------- typographic cover -----------------
function wrap(g, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = []; let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}
function fitLines(g, text, family, weight, maxW, maxLines, size, minSize) {
  let lines;
  for (; size >= minSize; size -= 2) {
    g.font = `${weight} ${size}px ${family}`;
    lines = wrap(g, text, maxW);
    if (lines.length <= maxLines && lines.every((l) => g.measureText(l).width <= maxW)) return { lines, size };
  }
  g.font = `${weight} ${minSize}px ${family}`;
  lines = wrap(g, text, maxW).slice(0, maxLines);
  const last = lines.length - 1;
  while (lines[last].length > 3 && g.measureText(lines[last] + '…').width > maxW) lines[last] = lines[last].slice(0, -1);
  if (wrap(g, text, maxW).length > maxLines) lines[last] = lines[last].trim() + '…';
  return { lines, size: minSize };
}

/**
 * Front cover for a book without a cover image: its binding colour, title and author in a simple modern
 * layout. W × H in pixels; the caller picks the proportions of the cover face.
 */
export function drawTypoCover(g, book, W, H) {
  const rnd = seeded(hashStr(book.id + ':cover'));
  const base = bindingColor(book);
  const ink = inkOn(base);
  const accent = accentFor(base, rnd);
  const title = mainTitle(book.title || '') || '…';
  const sub = String(book.title || '').slice(title.length).replace(/^[\s:.\-–—(]+|\)$/g, '').trim();
  const author = shortAuthor(book.author);
  const m = Math.round(W * 0.09);
  g.save();
  g.fillStyle = rgb(base); g.fillRect(0, 0, W, H);
  const style = Math.floor(rnd() * 3);
  g.textBaseline = 'alphabetic';
  if (style === 0) {
    // Swiss: big sans title at the top left, a circle, the author at the foot
    g.fillStyle = rgb(accent); g.beginPath(); g.arc(W * 0.74, H * 0.64, W * 0.3, 0, Math.PI * 2); g.fill();
    const t = fitLines(g, title, SANS, 700, W - m * 2, 4, Math.round(W * 0.13), Math.round(W * 0.07));
    g.fillStyle = rgb(ink); g.textAlign = 'left';
    t.lines.forEach((l, i) => g.fillText(l, m, m + t.size * (0.9 + i * 1.08)));
    if (sub) { const s = fitLines(g, sub, SANS, 400, W - m * 2, 2, Math.round(W * 0.05), Math.round(W * 0.04)); g.fillStyle = rgb(ink, 0.8); s.lines.forEach((l, i) => g.fillText(l, m, m + t.size * (0.9 + t.lines.length * 1.08) + s.size * (0.6 + i * 1.2))); }
    if (author) {
      if ('letterSpacing' in g) g.letterSpacing = '0.12em';
      let size = Math.round(W * 0.045);
      do g.font = `600 ${size}px ${SANS}`; while (g.measureText(author.toUpperCase()).width > W - m * 2 && --size > 9);
      g.fillStyle = rgb(ink); g.fillText(author.toUpperCase(), m, H - m);
      if ('letterSpacing' in g) g.letterSpacing = '0px';
      g.fillStyle = rgb(ink, 0.7); g.fillRect(m, H - m - W * 0.075, W * 0.16, 2);
    }
  } else if (style === 1) {
    // centred serif title, a short rule, the author in italics, a small mark at the foot
    const t = fitLines(g, title, DISPLAY, 700, W - m * 2.4, 5, Math.round(W * 0.11), Math.round(W * 0.06));
    g.fillStyle = rgb(ink); g.textAlign = 'center';
    const lh = t.size * 1.12, y0 = H * 0.4 - (t.lines.length - 1) * lh / 2;
    t.lines.forEach((l, i) => g.fillText(l, W / 2, y0 + i * lh));
    let y = y0 + (t.lines.length - 1) * lh + t.size * 0.9;
    if (sub) { const s = fitLines(g, sub, SERIF, 500, W - m * 2.6, 2, Math.round(W * 0.05), Math.round(W * 0.04)); g.fillStyle = rgb(ink, 0.8); s.lines.forEach((l, i) => g.fillText(l, W / 2, y + s.size * (0.4 + i * 1.2))); y += s.size * (0.4 + s.lines.length * 1.2); }
    g.fillStyle = rgb(accent === PAPER || accent === INK ? ink : accent); g.fillRect(W / 2 - W * 0.09, y, W * 0.18, 3);
    if (author) { const a = fitLines(g, author, SERIF, 'italic 400', W - m * 2, 2, Math.round(W * 0.06), Math.round(W * 0.045)); g.fillStyle = rgb(ink, 0.9); a.lines.forEach((l, i) => g.fillText(l, W / 2, y + a.size * (1.7 + i * 1.15))); }
    drawMark(g, Math.floor(rnd() * 6), W / 2, H - m * 1.1, rgb(ink, 0.85), 1);
  } else {
    // two blocks: the title on the binding colour, the author on a light (or dark) field below
    const split = Math.round(H * 0.66);
    const field = oklch(base)[0] > 0.72 ? INK : PAPER;
    g.fillStyle = rgb(field); g.fillRect(0, split, W, H - split);
    g.fillStyle = rgb(accent === field ? (field === PAPER ? INK : PAPER) : accent); g.fillRect(0, split - 5, W, 5);
    const serif = rnd() < 0.5;
    const t = fitLines(g, title, serif ? DISPLAY : SANS, 700, W - m * 2, 4, Math.round(W * 0.12), Math.round(W * 0.065));
    g.fillStyle = rgb(ink); g.textAlign = 'left';
    const lh = t.size * 1.08;
    t.lines.forEach((l, i) => g.fillText(l, m, split - m * 0.8 - (t.lines.length - 1 - i) * lh));
    if (author) { const a = fitLines(g, author, serif ? SANS : SERIF, serif ? 600 : 'italic 400', W - m * 2, 2, Math.round(W * 0.055), Math.round(W * 0.04)); g.fillStyle = rgb(inkOn(field)); a.lines.forEach((l, i) => g.fillText(l, m, split + m + a.size * (0.8 + i * 1.15))); }
  }
  // cloth grain over everything, stretched from the spine grain
  g.globalAlpha = 0.8; g.drawImage(grain(Math.floor(rnd() * 3)), 0, 0, W, H); g.globalAlpha = 1;
  g.restore();
}
