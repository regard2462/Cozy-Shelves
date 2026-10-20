// Shared in-app link navigation for the reading panels (reader, newspaper, encyclopedia, podcasts, catalogue).
//
// Nothing in the app opens the system browser on its own: a link in app content (news article, Wikipedia
// page, podcast show notes, catalogue page) opens in the in-app reading browser, ctx.openPanel('browser',
// { url }). Links inside a book stay in the reading view itself: the reader fetches the page through the
// backend (`catalog:readUrl` → electron/catalog/readable.js, api.app.fetch as fallback) and shows it as a
// book with a back stack. Only the explicit "Im Systembrowser öffnen" action calls api.app.openExternal.
//
//   import { openInApp, fetchReadable, sanitizeFragment, openSystemBrowser } from '../reader/link-nav.js';
//   openInApp(url, ctx, { reader: true });     // the reading browser (optionally straight in its reader mode)
//   const doc = await fetchReadable(api, url); // { title, author, html, url, source, language }
//   el.append(sanitizeFragment(remoteHtml, baseUrl));
//   interceptLinks(el, ctx, baseUrl);          // every <a href> inside el opens in the reading browser
import { tr } from '../../core/i18n.js';

/* ---------------------------------------------------------------- URLs ---- */

export const isHttpUrl = (u) => /^https?:\/\//i.test(String(u || '').trim());
/** a scheme we can load ourselves (app://, book://, lfile://, blob:, file:) */
export const isLocalUrl = (u) => /^(app|book|cover|lfile|blob|file|data):/i.test(String(u || '').trim());

export function normalizeUrl(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  if (s.startsWith('//')) return 'https:' + s;
  return 'https://' + s.replace(/^\/+/, '');
}

/** Resolve a (possibly relative) href against a base URL. Returns '' when it cannot be resolved. */
export function resolveUrl(href, base) {
  const s = String(href || '').trim();
  if (!s) return '';
  if (/^(javascript|vbscript):/i.test(s)) return '';
  try { return base ? new URL(s, base).href : new URL(s).href; } catch { return /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : ''; }
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return String(url || ''); }
}

/* ------------------------------------------------------------ local files ---- */

/** C:\Bücher\seite.html → file:///C:/B%C3%BCcher/seite.html ('%', '#', '?' in names stay part of the path). */
export function fileUrlFromPath(p) {
  const s = String(p || '').replace(/\\/g, '/');
  if (!s) return null;
  const safe = s.replace(/%/g, '%25').replace(/#/g, '%23').replace(/\?/g, '%3F');
  try { return new URL('file://' + (safe.startsWith('/') ? '' : '/') + safe).href; } catch { return null; }
}
/** file:///C:/B%C3%BCcher/seite.html → C:/Bücher/seite.html */
export function pathFromFileUrl(u) {
  try {
    let p = decodeURIComponent(new URL(u).pathname);
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
    return p;
  } catch { return null; }
}

/**
 * Images of a local HTML/Markdown book: their relative paths are turned into lfile:// URLs through the main
 * process (api.files.url only serves files below the library folders). Unresolvable images are dropped.
 */
export async function localizeResources(html, fileBase, api, max = 300) {
  if (!html || !fileBase || typeof api?.files?.url !== 'function') return html;
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  const cache = new Map();
  const toLfile = async (ref) => {
    let abs;
    try { abs = new URL(ref, fileBase); } catch { return null; }
    if (abs.protocol !== 'file:') return null;
    const p = pathFromFileUrl(abs.href);
    if (!cache.has(p)) cache.set(p, api.files.url(p).catch(() => null));
    return cache.get(p);
  };
  let n = 0;
  for (const el of doc.querySelectorAll('img[src], source[src], video[poster], audio[src], video[src]')) {
    if (n++ >= max) break;
    for (const attr of ['src', 'poster']) {
      const v = (el.getAttribute(attr) || '').trim();
      if (!v || /^(https?|data|blob|lfile|book|cover|app):/i.test(v)) continue;
      const u = await toLfile(v);
      if (u) el.setAttribute(attr, u); else el.removeAttribute(attr);
    }
    el.removeAttribute('srcset');
  }
  return doc.body.innerHTML;
}

/** api.invoke / api.catalog.invoke (the mock keeps the catalog channels on api.catalog). */
export function rpc(api, channel, ...args) {
  if (api?.catalog?.invoke) return api.catalog.invoke(channel, ...args);
  if (api?.invoke) return api.invoke(channel, ...args);
  return Promise.reject(new Error('backend unavailable'));
}

/* ------------------------------------------------------------ sanitizer ---- */

const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'APPLET', 'FRAME', 'FRAMESET', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'OPTION', 'LINK', 'META', 'BASE', 'NOSCRIPT', 'TEMPLATE', 'CANVAS', 'DIALOG', 'SLOT', 'PORTAL']);
const KEEP = new Set(['A', 'ABBR', 'ARTICLE', 'ASIDE', 'B', 'BLOCKQUOTE', 'BR', 'CAPTION', 'CITE', 'CODE', 'COL', 'COLGROUP', 'DD', 'DEL', 'DETAILS', 'DFN', 'DIV', 'DL', 'DT', 'EM', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'I', 'IMG', 'INS', 'KBD', 'LI', 'MAIN', 'MARK', 'NAV', 'OL', 'P', 'PRE', 'Q', 'RP', 'RT', 'RUBY', 'S', 'SAMP', 'SECTION', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUMMARY', 'SUP', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TIME', 'TR', 'U', 'UL', 'VAR', 'WBR']);
const ATTRS = {
  A: ['href', 'title'], IMG: ['src', 'alt', 'title', 'width', 'height'], TD: ['colspan', 'rowspan'], TH: ['colspan', 'rowspan', 'scope'],
  OL: ['start', 'reversed', 'type'], TIME: ['datetime'], COL: ['span'], COLGROUP: ['span'], DETAILS: ['open'], BLOCKQUOTE: ['cite'], Q: ['cite'],
};
const GLOBAL_ATTRS = ['dir', 'lang'];

function safeUrl(value, base, { allowData = false, image = false } = {}) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (s.startsWith('#')) return s;
  if (allowData && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(s)) return s;
  // images of articles and encyclopedia pages come through the main process's image proxy (electron/feeds/feeds.js)
  if (image && /^img:\/\/cache\/[\w-]+$/i.test(s)) return s;
  const abs = resolveUrl(s, base);
  if (!abs) return '';
  return /^(https?|mailto|tel|app|book|cover|lfile|blob|file):/i.test(abs) ? abs : '';
}

/**
 * Turn untrusted remote HTML into a DocumentFragment of known-safe nodes.
 * Parsing happens in an inert DOMParser document, so no script runs and no resource is fetched
 * before the nodes are inspected.
 * @param {string} html
 * @param {string} baseUrl  links/images are resolved against this
 * @param {{keepClasses?:boolean, keepIds?:boolean, keepData?:string[], ownerDocument?:Document}} opts
 *   ownerDocument: where the safe nodes are created. An <img> created by the live document starts loading at
 *   once, so callers that only want the HTML string (sanitizeHtml) build it in an inert document.
 */
export function sanitizeFragment(html, baseUrl = '', opts = {}) {
  const { keepClasses = false, keepIds = false, keepData = [], ownerDocument = document } = opts;
  const out = ownerDocument;
  const frag = out.createDocumentFragment();
  let doc;
  try { doc = new DOMParser().parseFromString(String(html || ''), 'text/html'); } catch { return frag; }
  const walk = (node, into) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) { into.appendChild(out.createTextNode(child.nodeValue)); continue; }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toUpperCase();
      if (DROP.has(tag)) continue;
      if (!KEEP.has(tag)) { walk(child, into); continue; } // unwrap unknown elements, keep their text
      const el = out.createElement(tag.toLowerCase());
      const allowed = [...(ATTRS[tag] || []), ...GLOBAL_ATTRS];
      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase();
        const val = attr.value;
        if (name === 'class' && keepClasses) { el.setAttribute('class', val); continue; }
        if (name === 'id' && keepIds) { el.setAttribute('id', val); continue; }
        if (name.startsWith('data-') && keepData.includes(name)) { el.setAttribute(name, val); continue; }
        if (!allowed.includes(name)) continue;
        if (name === 'href') { const u = safeUrl(val, baseUrl); if (u) el.setAttribute('href', u); continue; }
        if (name === 'src') { const u = safeUrl(val, baseUrl, { allowData: true, image: true }); if (u) { el.setAttribute('src', u); el.setAttribute('loading', 'lazy'); } continue; }
        el.setAttribute(name, val);
      }
      if (tag === 'IMG' && !el.getAttribute('src')) continue;
      walk(child, el);
      into.appendChild(el);
    }
  };
  walk(doc.body, frag);
  return frag;
}

/** Sanitized HTML string (for makeTextBook, which wants HTML). Built in an inert document: no image loads. */
export function sanitizeHtml(html, baseUrl = '', opts = {}) {
  const inert = document.implementation.createHTMLDocument('');
  const wrap = inert.createElement('div');
  wrap.appendChild(sanitizeFragment(html, baseUrl, { ...opts, ownerDocument: inert }));
  return wrap.innerHTML;
}

/* ------------------------------------------------- readable extraction ---- */

const CONTENT_SELECTORS = ['article', 'main', '[role="main"]', '#content', '.content', '#mw-content-text', '.post', '.entry-content'];

/** Client-side fallback extraction (used when the backend readable service is unavailable). */
export function extractReadable(html, url) {
  let doc;
  try { doc = new DOMParser().parseFromString(String(html || ''), 'text/html'); } catch { return null; }
  const title = (doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || doc.querySelector('h1')?.textContent || doc.title || '').replace(/\s+/g, ' ').trim();
  const author = (doc.querySelector('meta[name="author"], meta[property="article:author"]')?.getAttribute('content') || '').replace(/\s+/g, ' ').trim();
  for (const el of doc.querySelectorAll('script, style, noscript, nav, header, footer, aside, form, iframe')) el.remove();
  let best = null, bestLen = 0;
  for (const sel of CONTENT_SELECTORS) {
    for (const el of doc.querySelectorAll(sel)) {
      const len = (el.textContent || '').replace(/\s+/g, ' ').trim().length;
      if (len > bestLen) { best = el; bestLen = len; }
    }
  }
  if (!best || bestLen < 200) { best = doc.body; bestLen = (doc.body?.textContent || '').length; }
  if (!best || bestLen < 40) return null;
  const clean = sanitizeHtml(best.innerHTML, url);
  if (!clean.trim()) return null;
  return { title: title || hostOf(url), author: author || '', html: clean, url, source: hostOf(url), language: (doc.documentElement.getAttribute('lang') || '').slice(0, 2) || null };
}

/**
 * Fetch a URL and return readable content for the reading view.
 * 1. the backend extractor (`catalog:readUrl`, Readability + sanitizer)
 * 2. api.app.fetch + client-side extraction
 * 3. for app-internal schemes (book://, lfile://, app://) a plain fetch
 * @throws when nothing readable could be produced
 */
export async function fetchReadable(api, url, opts = {}) {
  const u = normalizeUrl(url);
  if (!u) throw new Error(tr({ de: 'Leere Adresse', en: 'Empty address' }));
  let firstError = null;

  if (isHttpUrl(u)) {
    try {
      const r = await rpc(api, 'catalog:readUrl', u, { follow: false, ...opts });
      if (r && r.html) return { title: r.title || hostOf(u), author: r.author || '', html: r.html, url: r.url || u, source: r.source || hostOf(u), language: r.language || null, chapters: r.chapters || null };
    } catch (e) { firstError = e; }
  }

  let res = null;
  try { res = await api?.app?.fetch?.(u, {}); } catch (e) { firstError = firstError || e; }
  if (res && res.ok === false && res.error) firstError = firstError || new Error(res.error);
  let text = res?.ok ? res.text : null;
  if (text == null && isLocalUrl(u)) {
    try { const r = await fetch(u); if (r.ok) text = await r.text(); } catch (e) { firstError = firstError || e; }
  }
  if (text != null) {
    const type = res?.contentType || '';
    if (/^(text\/plain|application\/(x-)?plain)/i.test(type) || (!/html|xml/i.test(type) && /^\s*[^<]/.test(text) && type)) {
      return { title: hostOf(u), author: '', text, url: res?.url || u, source: hostOf(u), language: null };
    }
    // opts.baseUrl: the address relative links really belong to (a local page read through lfile://)
    const x = extractReadable(text, opts.baseUrl || res?.url || u);
    if (x) return x;
  }
  throw firstError || new Error(tr({ de: 'Kein lesbarer Inhalt gefunden', en: 'No readable content found' }));
}

/* ------------------------------------------------------------ actions ----- */

/** The explicit opt-in escape hatch. Everything else stays inside the app. */
export function openSystemBrowser(api, url) {
  const u = normalizeUrl(url);
  if (!u) return Promise.resolve(false);
  return Promise.resolve(api?.app?.openExternal?.(u)).then(() => true).catch(() => false);
}

export const externalLabel = () => tr({ de: 'Im Systembrowser öffnen', en: 'Open in system browser' });

/**
 * Open a link from app content inside the app: the reading browser panel shows it (opts.reader asks it to
 * start in its reader mode). Only when that panel cannot be opened at all does the reading view take over.
 * mailto:/tel: links cannot be shown by any view; they are reported through ctx.toast.
 */
export async function openInApp(url, ctx, opts = {}) {
  const u = normalizeUrl(url);
  if (!u) return false;
  if (/^(mailto|tel|sms|geo):/i.test(u)) {
    ctx?.toast?.(tr({ de: 'Dieser Link öffnet ein anderes Programm und lässt sich in Cozy Shelves nicht anzeigen.', en: 'This link opens another application and cannot be shown in the reading room.' }));
    return false;
  }
  if (!isHttpUrl(u) && !isLocalUrl(u)) return false;
  // the browser only loads web addresses; app-internal files (book://, lfile:// …) stay in the reading view
  if (opts.prefer !== 'reader' && isHttpUrl(u) && await openBrowserPanel(u, ctx, { reader: !!opts.reader })) return true;
  try {
    await ctx.openPanel('reader', { external: { url: u, title: opts.title || '' }, from: opts.from || null });
    return true;
  } catch (e) {
    console.warn('[link-nav] reader panel failed', e);
    return false;
  }
}

/** The in-app reading browser (app/src/ui/browser/). false when the panel is not available. */
export async function openBrowserPanel(url, ctx, extra = {}) {
  if (typeof ctx?.openPanel !== 'function') return false;
  try { await ctx.openPanel('browser', { url: normalizeUrl(url), ...(extra.reader ? { reader: true } : {}) }); return true; }
  catch { return false; }
}

/**
 * Route every hyperlink inside `root` (sanitized remote HTML) to the reading browser. In-page anchors (#…)
 * scroll within `root`; `filter(a, href)` may claim a link first (return true = handled, e.g. wiki links).
 */
export function interceptLinks(root, ctx, baseUrl = '', filter = null) {
  const onClick = (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a || !root.contains(a)) return;
    e.preventDefault();
    const href = a.getAttribute('href') || '';
    if (!href) return;
    if (href.startsWith('#')) {
      const id = decodeURIComponent(href.slice(1));
      const target = id && (root.querySelector('#' + CSS.escape(id)) || root.querySelector(`[name="${CSS.escape(id)}"]`));
      target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (filter && filter(a, href) === true) return;
    openInApp(resolveUrl(href, baseUrl) || href, ctx, { title: (a.textContent || '').trim().slice(0, 80) });
  };
  root.addEventListener('click', onClick);
  // a middle click would otherwise ask for a new window, which Electron hands to the system browser
  const onAux = (e) => { if (e.button === 1 && e.target.closest?.('a[href]')) onClick(e); };
  root.addEventListener('auxclick', onAux);
  return () => { root.removeEventListener('click', onClick); root.removeEventListener('auxclick', onAux); };
}
