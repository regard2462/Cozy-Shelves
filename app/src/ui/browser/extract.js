// Reader mode extraction: the live HTML of the page (see SNAPSHOT_SCRIPT) is parsed into an inert document
// (DOMParser: no scripts run, nothing is loaded), Mozilla Readability finds the article, and a strict allow-list
// sanitizer keeps only text markup, links, images, tables and lists. The result is inserted into the app's own
// document, so nothing executable may survive this file.
import { hostOf, isWeb } from './util.js';

const KEEP = new Set(['p', 'br', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'em', 'i', 'strong', 'b', 'a', 'img',
  'figure', 'figcaption', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'hr', 'sup', 'sub', 'small', 'span', 'div', 'dl', 'dt',
  'dd', 'cite', 'q', 'abbr', 'mark', 'del', 'ins', 'u', 's', 'section', 'time', 'address', 'kbd', 'var', 'samp', 'wbr', 'details', 'summary']);
const DROP = new Set(['script', 'style', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button', 'select',
  'textarea', 'option', 'label', 'fieldset', 'legend', 'svg', 'math', 'canvas', 'video', 'audio', 'source', 'track', 'template', 'link', 'meta',
  'base', 'head', 'title', 'nav', 'menu', 'dialog', 'portal', 'slot', 'map', 'area', 'progress', 'meter', 'aside']);
const RENAME = { h1: 'h2', article: 'div', header: 'div', footer: 'div', main: 'div', center: 'div', font: 'span', big: 'span', tt: 'code', strike: 's' };
const TRACKING_IMG = /(\/pixel|\/tracking|\/beacon|doubleclick|\/1x1|ivwbox|ioam\.de|\/counter|scorecardresearch|\/analytics|facebook\.com\/tr)/i;
const LAZY_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-orig-file', 'data-hi-res-src', 'data-full-src', 'data-lazy', 'data-url'];

/** Absolute http(s) URL or null. */
function abs(u, base) {
  if (!u) return null;
  const s = String(u).trim();
  if (!s || /^(javascript|data|vbscript|file|blob):/i.test(s)) return null;
  try { const x = new URL(s.startsWith('//') ? 'https:' + s : s, base); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; }
}
/** The largest candidate of a srcset. */
function fromSrcset(v, base) {
  let best = null, bestW = 0;
  for (const part of String(v || '').split(/,\s+/)) {
    const [u, d] = part.trim().split(/\s+/);
    const w = parseFloat(d) || 1;
    if (u && w >= bestW) { const a = abs(u, base); if (a) { best = a; bestW = w; } }
  }
  return best;
}

/** HTML fragment → sanitized fragment { html, text }. */
export function sanitizeArticle(html, base) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '');
  const root = tpl.content;
  for (const el of [...root.querySelectorAll('*')]) {
    if (!el.isConnected && !root.contains(el)) continue;
    const tag = el.localName;
    if (DROP.has(tag) || el.hasAttribute('data-lsb-hidden') || el.getAttribute('aria-hidden') === 'true' && !el.querySelector('img')) { el.remove(); continue; }
    if (tag === 'picture') {
      const img = el.querySelector('img');
      const srcset = el.querySelector('source[srcset]')?.getAttribute('srcset');
      if (img) { if (srcset && !img.getAttribute('src')) img.setAttribute('data-src', fromSrcset(srcset, base) || ''); el.replaceWith(img); } else el.remove();
      continue;
    }
    if (RENAME[tag]) {
      const n = tpl.content.ownerDocument.createElement(RENAME[tag]);
      while (el.firstChild) n.appendChild(el.firstChild);
      el.replaceWith(n);
      continue;
    }
    if (!KEEP.has(tag)) { el.replaceWith(...el.childNodes); continue; }
  }
  for (const el of [...root.querySelectorAll('*')]) {
    const tag = el.localName;
    const keep = {};
    if (tag === 'a') {
      const href = el.getAttribute('href') || '';
      if (href.startsWith('#') && href.length > 1) keep.href = href;
      else { const a = abs(href, base); if (a) keep.href = a; else if (/^mailto:/i.test(href)) keep.href = href; }
      if (el.getAttribute('title')) keep.title = el.getAttribute('title');
    } else if (tag === 'img') {
      let src = el.getAttribute('src');
      if (!src || /^data:/i.test(src) || /(blank|spacer|placeholder|lazy|transparent)\.(gif|png|svg)/i.test(src)) {
        for (const k of LAZY_ATTRS) if (el.getAttribute(k)) { src = el.getAttribute(k); break; }
      }
      let a = abs(src, base);
      if (!a && el.getAttribute('srcset')) a = fromSrcset(el.getAttribute('srcset'), base);
      if (!a && el.getAttribute('data-srcset')) a = fromSrcset(el.getAttribute('data-srcset'), base);
      const w = parseInt(el.getAttribute('width') || '0', 10), hgt = parseInt(el.getAttribute('height') || '0', 10);
      if (!a || TRACKING_IMG.test(a) || (w > 0 && w <= 3) || (hgt > 0 && hgt <= 3)) { el.remove(); continue; }
      keep.src = a;
      if (el.getAttribute('alt')) keep.alt = el.getAttribute('alt').slice(0, 300);
      if (w > 0 && hgt > 0) { keep.width = String(w); keep.height = String(hgt); }
    } else if (tag === 'td' || tag === 'th') {
      for (const k of ['colspan', 'rowspan']) if (/^\d{1,2}$/.test(el.getAttribute(k) || '')) keep[k] = el.getAttribute(k);
    } else if (tag === 'ol') {
      if (/^-?\d{1,6}$/.test(el.getAttribute('start') || '')) keep.start = el.getAttribute('start');
    } else if (tag === 'time' && el.getAttribute('datetime')) keep.datetime = el.getAttribute('datetime').slice(0, 60);
    else if (tag === 'abbr' && el.getAttribute('title')) keep.title = el.getAttribute('title').slice(0, 200);
    if ((el.id || '') && /^[\w-]{1,80}$/.test(el.id)) keep.id = 'lsb-' + el.id;
    const lang = el.getAttribute('lang');
    if (lang && /^[a-zA-Z-]{2,12}$/.test(lang)) keep.lang = lang;
    for (const at of [...el.attributes]) el.removeAttribute(at.name);
    for (const [k, v] of Object.entries(keep)) el.setAttribute(k, v);
    if (tag === 'img') { el.setAttribute('decoding', 'async'); el.setAttribute('referrerpolicy', 'no-referrer'); }
  }
  // in-page links point at the renamed ids
  for (const a of root.querySelectorAll('a[href^="#"]')) a.setAttribute('href', '#lsb-' + a.getAttribute('href').slice(1));
  // empty wrappers left over from the page layout (an inline element holding a single space stays: it is
  // the space between two words)
  const INLINE = new Set(['span', 'strong', 'em', 'b', 'i', 'small', 'a']);
  for (let pass = 0; pass < 3; pass++) {
    let removed = 0;
    for (const el of [...root.querySelectorAll('p, div, span, li, ul, ol, section, figure, strong, em, b, i, h2, h3, h4, h5, h6, blockquote, small, a')]) {
      if (el.querySelector('img, table, hr, br, pre') || el.localName === 'a' && el.hasAttribute('id')) continue;
      const t = el.textContent;
      if (INLINE.has(el.localName) ? t === '' : !t.trim()) { el.remove(); removed++; }
    }
    if (!removed) break;
  }
  // serialized from the inert template: no image of the fragment is requested before it is shown
  return { html: tpl.innerHTML, text: (root.textContent || '').replace(/\s+/g, ' ').trim() };
}

/** "weiter" / "nächste Seite" / rel=next on the same host: the continuation of a multi-page article. */
function findNext(doc, url) {
  const host = hostOf(url);
  const rel = doc.querySelector('link[rel="next"], a[rel="next"]');
  const pick = (href) => { const a = abs(href, url); return a && hostOf(a) === host && a.split('#')[0] !== url.split('#')[0] ? a : null; };
  if (rel) { const a = pick(rel.getAttribute('href')); if (a) return a; }
  const RE = /^\s*(weiter|nächste seite|nächster teil|nächstes kapitel|next page|next|fortsetzung)\s*[»›>→]*\s*$/i;
  for (const a of doc.querySelectorAll('a[href]')) {
    if (RE.test(a.textContent || '') || /^\s*(nächste seite|next page)\s*$/i.test(a.getAttribute('aria-label') || '')) { const r = pick(a.getAttribute('href')); if (r) return r; }
  }
  return null;
}

/** Every link and image source of the parsed page as an absolute URL. */
function absolutizeDocument(doc, base) {
  const fix = (v) => { const a = abs(v, base); return a || null; };
  for (const el of doc.querySelectorAll('a[href]')) {
    const h = el.getAttribute('href');
    if (!h || h.startsWith('#')) continue;
    const a = fix(h);
    if (a) el.setAttribute('href', a); else if (!/^mailto:/i.test(h)) el.removeAttribute('href');
  }
  for (const el of doc.querySelectorAll('img, source, video')) {
    for (const k of ['src', 'poster', ...LAZY_ATTRS]) {
      const v = el.getAttribute(k);
      if (v && !/^data:/i.test(v)) { const a = fix(v); if (a) el.setAttribute(k, a); }
    }
    for (const k of ['srcset', 'data-srcset']) {
      const v = el.getAttribute(k);
      if (v) el.setAttribute(k, v.split(/,\s+/).map((part) => { const [u, d] = part.trim().split(/\s+/); const a = fix(u); return a ? (d ? `${a} ${d}` : a) : ''; }).filter(Boolean).join(', '));
    }
  }
}

/** Page furniture that makes Readability drop real content: MediaWiki wraps each section heading in a
 *  box together with its edit links, and the link density of that box gets the heading removed. */
function precleanDocument(doc) {
  for (const el of doc.querySelectorAll('.mw-editsection, .mw-jump-link, .mw-cite-backlink, .noprint.mw-empty-elt')) el.remove();
  for (const box of doc.querySelectorAll('div.mw-heading')) {
    const hd = box.querySelector('h1, h2, h3, h4, h5, h6');
    if (hd) box.replaceWith(hd);
  }
}

function metaContent(doc, ...names) {
  for (const n of names) {
    const el = doc.querySelector(`meta[property="${n}"], meta[name="${n}"]`);
    const v = el?.getAttribute('content');
    if (v && v.trim()) return v.trim();
  }
  return '';
}

/**
 * Snapshot ({ html, url, title, lang }) → article
 * { url, title, byline, site, lang, excerpt, published, html, text, words, minutes, next, image }.
 */
export async function toArticle(snap) {
  if (!snap || !snap.html) throw new Error('Die Seite ist leer.');
  const url = isWeb(snap.url) ? snap.url : '';
  const mod = await import('@mozilla/readability');
  const Readability = mod.Readability || mod.default?.Readability;
  const doc = new DOMParser().parseFromString(snap.html, 'text/html');
  for (const el of doc.querySelectorAll('[data-lsb-hidden]')) el.remove();
  // A <base> element would collide with the app's CSP (base-uri 'self'), so every address is made absolute
  // here, before Readability resolves the rest against the app's own URL.
  if (url) absolutizeDocument(doc, url);
  precleanDocument(doc);
  const h1 = (doc.querySelector('h1')?.textContent || '').replace(/\s+/g, ' ').trim();
  const next = url ? findNext(doc, url) : null;
  const image = abs(metaContent(doc, 'og:image', 'twitter:image'), url);
  const published = metaContent(doc, 'article:published_time', 'date', 'dc.date', 'DC.date.issued');
  const siteMeta = metaContent(doc, 'og:site_name', 'application-name');
  const r = new Readability(doc, { charThreshold: 250, keepClasses: false }).parse();
  if (!r || !r.content) throw new Error('Auf dieser Seite wurde kein Artikeltext gefunden.');
  const clean = sanitizeArticle(r.content, url);
  const words = clean.text ? clean.text.split(' ').length : 0;
  if (words < 25) throw new Error('Auf dieser Seite wurde kein Artikeltext gefunden.');
  const lang = String(r.lang || snap.lang || '').slice(0, 2).toLowerCase();
  let title = (r.title || snap.title || hostOf(url)).replace(/\s+/g, ' ').trim();
  // "Lesesaal – Wikipedia": the page's own <h1> is the real title when the document title starts with it
  if (h1 && h1.length >= 2 && h1.length < title.length && title.toLowerCase().startsWith(h1.toLowerCase())) title = h1;
  let byline = (r.byline || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const site = (r.siteName || siteMeta || hostOf(url)).trim().slice(0, 120);
  if (byline && [site.toLowerCase(), hostOf(url).toLowerCase()].includes(byline.toLowerCase())) byline = '';
  return {
    url, title, byline,
    site, lang: /^[a-z]{2}$/.test(lang) ? lang : '',
    excerpt: (r.excerpt || '').trim().slice(0, 600), published: r.publishedTime || published || '',
    html: clean.html, text: clean.text, words, minutes: Math.max(1, Math.round(words / 220)), next, image,
  };
}

/** Article from the catalogue's server-side reader ('catalog:readUrl'), for pages without a live view. */
export function fromCatalog(r, url) {
  if (!r || !r.html) throw new Error('Kein lesbarer Text gefunden.');
  const clean = sanitizeArticle(r.html, url);
  const words = clean.text ? clean.text.split(' ').length : 0;
  if (words < 25) throw new Error('Auf dieser Seite wurde kein Artikeltext gefunden.');
  return {
    url: r.url || url, title: r.title || hostOf(url), byline: r.author || '', site: r.source || hostOf(url), lang: r.language || '',
    excerpt: '', published: '', html: clean.html, text: clean.text, words, minutes: Math.max(1, Math.round(words / 220)), next: null, image: r.image || null,
  };
}
