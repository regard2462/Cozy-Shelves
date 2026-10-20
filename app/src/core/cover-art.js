// Covers for books without a cover image, plus colour helpers. The title card is the same modern one the
// book shows in the room (world/book-art.js): the indexer stores it, and the UI draws it again for older
// records whose stored card still is the dark cloth with gilt frames from before 0.4.
import { drawTypoCover, bindingColor, inkOn, rgb, isGeneratedCover, fontsLoaded, whenFontsLoaded } from '../world/book-art.js';

export function hashString(s) {
  let h = 2166136261;
  for (const c of String(s || '')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

const hex = (c) => '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Stand-in cover for a book without a cover image, as the indexer stores it. `id` ties the binding colour to
 * the book (the room uses the same one); without an id the title and author decide.
 */
export async function makeTypographicCover(title, author = '', id = '') {
  await whenFontsLoaded();
  const book = { id: id || 'typo:' + title + '|' + author, title: title || '', author: author || '', coverGenerated: true };
  const W = 600, H = 900;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  drawTypoCover(c.getContext('2d'), book, W, H);
  return { dataUrl: c.toDataURL('image/jpeg', 0.9), color: hex(bindingColor(book)), generated: true };
}

const typoCache = new Map();
/** The title card of a book as an image URL, drawn once per title (and again after the web fonts arrived). */
export function typoCoverUrl(book, W = 360, H = 540) {
  const key = `${book.id}|${book.title || ''}|${book.author || ''}|${W}`;
  let url = typoCache.get(key);
  if (!url) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    drawTypoCover(c.getContext('2d'), book, W, H);
    url = c.toDataURL('image/jpeg', 0.9);
    // drawn before the fonts were loaded, the card used a fallback face: draw it again next time
    if (!fontsLoaded()) return url;
    if (typoCache.size >= 96) typoCache.delete(typoCache.keys().next().value);
  }
  typoCache.delete(key); typoCache.set(key, url);
  return url;
}

/**
 * The cover to show for a library book: the real image, the title card for a book with only a stand-in,
 * null for a book that has no cover yet (not indexed).
 */
export function coverSrc(book, api) {
  if (!book || book.hasCover === false) return null;
  if (isGeneratedCover(book)) return typoCoverUrl(book);
  return typeof api?.library?.coverUrl === 'function' ? api.library.coverUrl(book.id, book.coverVersion) || null : null;
}

/**
 * A cover changed while the book is listed somewhere (a cover from the internet arrived, the reader picked another):
 * every list picture of the book (coverThumb, the computer's covers) shows the new one.
 */
export function refreshCoverImages(book, api) {
  if (!book?.id || typeof document === 'undefined') return;
  const src = coverSrc(book, api);
  if (!src) return;
  for (const img of document.querySelectorAll(`img[data-cover-id="${CSS.escape(book.id)}"]`)) if (img.getAttribute('src') !== src) img.src = src;
}

export function averageColor(ctx, w, h) {
  try {
    const data = ctx.getImageData(0, 0, w, h).data;
    let r = 0, g = 0, b = 0, n = 0;
    const step = Math.max(1, Math.floor((w * h) / 4000)) * 4;
    for (let i = 0; i < data.length; i += step) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
    r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
    return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
  } catch { return '#6b4a2a'; }
}

/**
 * Small cover for lists (basket, menu, computer): the real cover or the title card, otherwise a tile in the
 * book's binding colour with the initials. A cover that fails to load (deleted cache) falls back the same way,
 * so a list never shows a broken image.
 */
export function coverThumb(book, api, cls = 'cover-thumb') {
  const placeholder = () => {
    const d = document.createElement('div');
    d.className = cls + ' cover-ph';
    const ground = bindingColor(book || {});
    d.style.background = rgb(ground);
    d.style.color = rgb(inkOn(ground));
    const words = String(book?.title || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
    d.textContent = (words.slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase();
    d.setAttribute('aria-hidden', 'true');
    return d;
  };
  const src = coverSrc(book, api);
  if (!src) return placeholder();
  const img = document.createElement('img');
  img.className = cls; img.alt = ''; img.loading = 'lazy';
  img.dataset.coverId = book.id;
  img.addEventListener('error', () => img.replaceWith(placeholder()), { once: true });
  img.src = src;
  return img;
}
