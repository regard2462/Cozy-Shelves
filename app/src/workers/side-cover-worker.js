// Makes the cells of the side covers (app/src/world/side-covers.js) off the main thread: a cover image is fetched,
// decoded at 256 px height and trimmed to the proportions of the book's face; a book without one gets its title card
// (world/book-art.js drawTypoCover, with the page's web fonts loaded here as well). The cell gets its border and its
// smaller levels (world/side-cell.js).
//   { type: 'cover', id, url, aspect } | { type: 'typo', id, book, aspect }
//   → { type: 'cell', id, levels, mean } with the pixel buffers transferred, or { type: 'error', id }
import { paintCell, paintCoverCell, SIDE_CELL } from '../world/side-cell.js';
import { drawTypoCover } from '../world/book-art.js';

let ctx = null;
const cellContext = () => (ctx ||= new OffscreenCanvas(SIDE_CELL.w, SIDE_CELL.h).getContext('2d', { willReadFrequently: true }));

// the faces the title cards use (book-art.js WEBFONTS), their Latin parts (German, English, French …): from the
// stylesheets of the fonts in app/vendor/fonts, so the cards look as they do in the page
const FACES = [['Playfair Display', '700', 'normal', 'playfair-display/700.css'], ['EB Garamond', '600', 'normal', 'eb-garamond/600.css'],
  ['EB Garamond', '400', 'italic', 'eb-garamond/400-italic.css'], ['EB Garamond', '500', 'normal', 'eb-garamond/500.css']];
let fonts = null;
function loadFonts() {
  fonts ||= Promise.all(FACES.map(async ([family, weight, style, css]) => {
    try {
      const at = new URL('../vendor/fonts/' + css, self.location.href);
      const text = await (await fetch(at)).text();
      for (const block of text.split('@font-face').slice(1)) {
        const src = /url\(([^)]+?\.woff2)\)/.exec(block)?.[1];
        if (!src || !/-latin(-ext)?-/.test(src)) continue;
        const range = /unicode-range:\s*([^;}]+)/.exec(block)?.[1]?.trim();
        const face = new FontFace(family, `url(${new URL(src, at).href})`, { weight, style, ...(range ? { unicodeRange: range } : {}) });
        self.fonts.add(face);
        await face.load();
      }
    } catch { /* the card falls back to Georgia, as in the page before its fonts arrive */ }
  }));
  return fonts;
}

async function cover(m) {
  const res = await fetch(m.url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const bitmap = await createImageBitmap(await res.blob(), { resizeHeight: 256, resizeQuality: 'high' });
  try { return paintCoverCell(cellContext(), bitmap, m.aspect); } finally { bitmap.close(); }
}
let card = null;
async function typo(m) {
  await loadFonts();
  // drawn in the proportions of the face, then scaled into the cell (the shelf shader scales it back)
  const W = 160, H = Math.round(W / m.aspect);
  if (!card || card.height !== H) card = new OffscreenCanvas(W, H);
  const g = card.getContext('2d');
  g.clearRect(0, 0, W, H);
  drawTypoCover(g, m.book, W, H);
  return paintCell(cellContext(), (c, x, y, w, h) => { c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'medium'; c.drawImage(card, x, y, w, h); });
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m?.type !== 'cover' && m?.type !== 'typo') return;
  try {
    const { levels, mean } = m.type === 'cover' ? await cover(m) : await typo(m);
    self.postMessage({ type: 'cell', id: m.id, levels, mean }, levels.map((l) => l.buffer));
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String(err?.message || err) });
  }
};
