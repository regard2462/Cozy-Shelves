// Shared helpers for the feeds/podcasts/wiki/dict backend modules.
// Pure Node – no Electron dependency at load time (electron.net is picked up lazily when available),
// so everything here can be unit-tested with plain `node`.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';
const WIKI_UA = 'CozyShelves/0.1 (personal desktop reading app) node-fetch';

// --- fetch ---------------------------------------------------------------------------------------
let electronNet;
function getNet() {
  if (electronNet === undefined) {
    try { const e = require('electron'); electronNet = e && typeof e === 'object' && e.net && typeof e.net.fetch === 'function' ? e.net : null; }
    catch { electronNet = null; }
  }
  return electronNet;
}

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
/** Only http(s) addresses are fetched on behalf of the renderer (see fetchRaw). */
const isWebAddress = (u) => /^https?:\/\//i.test(String(u || ''));

/**
 * Read a response body with a hard size cap (streamed when the platform allows it). With `truncate` a larger
 * body is cut at the cap instead of refused; the returned buffer then carries `truncated = true`.
 */
async function readCapped(res, maxBytes, url, truncate = false) {
  const declared = parseInt(res.headers.get('content-length') || '', 10);
  if (!truncate && Number.isFinite(declared) && declared > maxBytes) throw new Error(`response too large (${declared} > ${maxBytes} bytes) for ${url}`);
  const body = res.body;
  if (!body || typeof body.getReader !== 'function') {
    let buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) {
      if (!truncate) throw new Error(`response too large (> ${maxBytes} bytes) for ${url}`);
      buf = buf.subarray(0, maxBytes); buf.truncated = true;
    }
    return buf;
  }
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      try { await reader.cancel(); } catch {}
      if (!truncate) throw new Error(`response too large (> ${maxBytes} bytes) for ${url}`);
      chunks.push(Buffer.from(value.subarray(0, maxBytes - total)));
      const buf = Buffer.concat(chunks, maxBytes); buf.truncated = true;
      return buf;
    }
    total += value.byteLength;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

/**
 * Fetch raw bytes with timeout and a size cap. Returns { ok, status, url, contentType, buffer, truncated }.
 * `url` is the FINAL url after redirects: electron's net.fetch documents `Response.url` as
 * unreliable, so redirects are followed by hand (relative links in the payload must be
 * resolved against the url the payload actually came from). Throws on network error/timeout.
 */
async function fetchRaw(url, { timeout = 15000, headers = {}, method = 'GET', body, ua, maxBytes = DEFAULT_MAX_BYTES, truncate = false, maxRedirects = 5 } = {}) {
  // Electron's net.fetch also answers file:, app:, book: and the other schemes of the app: an address handed in by a
  // page (an article, a podcast feed, a web page to read) must stay a web address, or this would read local files
  if (!isWebAddress(url)) throw new Error('not a web address: ' + String(url).slice(0, 120));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout after ' + timeout + ' ms')), timeout);
  try {
    const net = getNet();
    const doFetch = net ? net.fetch.bind(net) : globalThis.fetch;
    const reqHeaders = { 'User-Agent': ua || BROWSER_UA, 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.7', ...headers };
    let current = url, curMethod = method, curBody = body, hops = 0, manual = true, res;
    for (;;) {
      try {
        res = await doFetch(current, { method: curMethod, body: curBody, signal: ctrl.signal, redirect: manual ? 'manual' : 'follow', headers: reqHeaders });
      } catch (e) {
        if (manual && !ctrl.signal.aborted) { manual = false; continue; }   // platform without 'manual' support
        throw e;
      }
      const location = res.headers.get('location');
      // Chromium hands back an opaque redirect (status 0, no headers) instead of the 3xx —
      // in that case redo the request letting the platform follow the chain itself.
      if (manual && (res.type === 'opaqueredirect' || res.status === 0 || (REDIRECT_STATUS.has(res.status) && !location))) {
        manual = false; current = url; curMethod = method; curBody = body; hops = 0;
        continue;
      }
      if (manual && REDIRECT_STATUS.has(res.status) && location && hops < maxRedirects) {
        let next;
        try { next = new URL(location, current).href; } catch { break; }
        if (!/^https?:/i.test(next)) break;
        try { await res.body?.cancel?.(); } catch {}
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && curMethod === 'POST')) { curMethod = 'GET'; curBody = undefined; }
        current = next; hops++;
        continue;
      }
      break;
    }
    const buffer = await readCapped(res, maxBytes, current, truncate);
    const reported = typeof res.url === 'string' && /^https?:\/\//i.test(res.url) ? res.url : null;
    return { ok: res.ok, status: res.status, url: hops ? current : (reported || current), contentType: res.headers.get('content-type') || '', buffer, redirects: hops, truncated: !!buffer.truncated };
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error('timeout after ' + timeout + ' ms');
    throw e;
  } finally { clearTimeout(timer); }
}

function sniffCharset(buffer, contentType, isXml) {
  const m = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType || '');
  if (m) return m[1];
  const head = buffer.subarray(0, 2048).toString('latin1');
  if (isXml || /^\s*<\?xml/.test(head)) {
    const x = /<\?xml[^>]*encoding\s*=\s*["']([\w-]+)["']/i.exec(head);
    if (x) return x[1];
  }
  const h = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);
  if (h) return h[1];
  return 'utf-8';
}

function decodeBuffer(buffer, contentType, isXml) {
  let enc = sniffCharset(buffer, contentType, isXml).toLowerCase();
  if (enc === 'utf8') enc = 'utf-8';
  let text;
  try { text = new TextDecoder(enc, { fatal: false }).decode(buffer); }
  catch { text = buffer.toString('utf8'); }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

async function fetchText(url, opts = {}) {
  const r = await fetchRaw(url, opts);
  r.text = decodeBuffer(r.buffer, r.contentType, !!opts.xml);
  delete r.buffer;
  return r;
}

async function fetchJson(url, opts = {}) {
  const r = await fetchText(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  try { return JSON.parse(r.text); } catch { throw new Error('invalid JSON from ' + url); }
}

// --- misc ----------------------------------------------------------------------------------------
const sha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
const shortId = (s, n = 16) => sha1(s).slice(0, n);

function pLimit(concurrency) {
  let active = 0; const queue = [];
  const next = () => { if (active >= concurrency || !queue.length) return; active++; const { fn, resolve, reject } = queue.shift(); Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); }); };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

function absolutize(u, base) {
  if (!u) return null;
  u = String(u).trim();
  if (!u) return null;
  if (/^data:image\//i.test(u)) return u;
  if (u.startsWith('//')) u = 'https:' + u;
  try { const abs = new URL(u, base || undefined); if (!/^https?:$/.test(abs.protocol)) return null; return abs.href; } catch { return null; }
}

function collapseWs(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

// --- image proxy -----------------------------------------------------------------------------------
// Article images must not be fetched by the renderer straight from the publisher's CDN
// (that leaks the reader's IP and defeats the offline/CSP contract). The main process
// installs a proxy here (feeds.js registers the img:// protocol); without one everything
// keeps working with the original URLs, which is what the offline tests rely on.
let imageProxy = null;
function setImageProxy(fn) { imageProxy = typeof fn === 'function' ? fn : null; }
function hasImageProxy() { return !!imageProxy; }
function proxyImage(u) {
  if (!u || !imageProxy || !/^https?:/i.test(u)) return u || null;
  try { return imageProxy(u) || u; } catch { return u; }
}

function summarize(text, max = 300) {
  text = collapseWs(text);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' '));
  return (i > max * 0.6 ? cut.slice(0, i) : cut).replace(/[,;:\s]+$/, '') + ' …';
}

function readingMinutes(text) { const words = collapseWs(text).split(' ').filter(Boolean).length; return Math.max(1, Math.round(words / 220)); }

function toMs(d) {
  if (!d) return null;
  if (typeof d === 'number') return d;
  const t = Date.parse(String(d).trim());
  return Number.isFinite(t) ? t : null;
}

// --- HTML parsing / sanitizing ---------------------------------------------------------------------
let sharedWindow = null;
function getWindow() {
  if (!sharedWindow) {
    const { JSDOM } = require('jsdom');
    sharedWindow = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://localhost/' }).window;
  }
  return sharedWindow;
}
/** Parse an HTML fragment/document into a detached Document (scripts never run). */
function parseHtml(html) {
  const w = getWindow();
  return new w.DOMParser().parseFromString(String(html || ''), 'text/html');
}

const DROP_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'noscript', 'link', 'meta', 'svg', 'video', 'audio', 'canvas', 'template', 'map', 'area', 'base', 'head', 'title', 'nav', 'menu', 'dialog', 'math', 'frame', 'frameset', 'applet', 'source', 'track', 'option', 'label', 'fieldset', 'legend', 'progress', 'meter', 'slot', 'portal']);
const KEEP_TAGS = new Set(['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'em', 'i', 'strong', 'b', 'a', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'hr', 'sup', 'sub', 'small', 'span', 'div', 'dl', 'dt', 'dd', 'cite', 'q', 'abbr', 'mark', 'del', 'ins', 'u', 's', 'section', 'article', 'aside', 'header', 'footer', 'time', 'address', 'kbd', 'var', 'samp', 'wbr', 'details', 'summary', 'colgroup', 'col', 'big', 'tt', 'strike', 'center', 'font']);
const RENAME = { center: 'div', font: 'span', big: 'span', tt: 'code', strike: 's', h1: 'h2', article: 'div', header: 'div', footer: 'div', aside: 'div' };
const TRACKING_RE = /(\/pixel|tracking|\/stats\/|feedburner\.com\/~r|\bbeacon\b|doubleclick|\/counter|\bimpression\b|smartadserver|metrics\.|\/1x1|piano\.io|ivwbox|wp-stats|feedsportal|\/analytics)/i;

function unwrap(el) {
  const p = el.parentNode; if (!p) return;
  while (el.firstChild) p.insertBefore(el.firstChild, el);
  p.removeChild(el);
}

/**
 * Sanitize an HTML fragment for display inside the app.
 *  opts.baseUrl  – for absolutizing links/images
 *  opts.keepClasses / keepIds / keepStyle / keepData – attribute policy (wiki mode)
 *  opts.allowedTags – extra allowed tag names
 * Returns { html, text, images:[urls], firstImage }.
 */
function sanitizeHtml(html, opts = {}) {
  const doc = parseHtml(html);
  const body = doc.body;
  const base = opts.baseUrl || null;
  const keepTags = new Set(KEEP_TAGS); for (const t of opts.allowedTags || []) keepTags.add(t);
  const drop = new Set(DROP_TAGS); for (const t of opts.allowedTags || []) drop.delete(t);
  const images = [];
  // depth-first over a snapshot so that removing/unwrapping is safe
  const all = [...body.querySelectorAll('*')];
  for (const el of all) {
    if (!el.parentNode) continue;
    const tag = el.tagName.toLowerCase();
    if (drop.has(tag)) { el.remove(); continue; }
    if (tag === 'picture') { const img = el.querySelector('img'); if (img) el.replaceWith(img); else el.remove(); continue; }
    if (!keepTags.has(tag)) { unwrap(el); continue; }
  }
  for (const el of [...body.querySelectorAll('*')]) {
    if (!el.parentNode) continue;
    let tag = el.tagName.toLowerCase();
    if (RENAME[tag] && !opts.keepClasses) {
      const n = doc.createElement(RENAME[tag]);
      for (const a of [...el.attributes]) n.setAttribute(a.name, a.value);
      while (el.firstChild) n.appendChild(el.firstChild);
      el.replaceWith(n);
      cleanAttrs(n, RENAME[tag]);
      continue;
    }
    cleanAttrs(el, tag);
  }
  function cleanAttrs(el, tag) {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      let keep = false;
      if (n.startsWith('on') || n === 'srcset' || n === 'sizes' || n === 'loading' || n === 'decoding') keep = false;
      else if (n === 'href' && tag === 'a') keep = true;
      else if (tag === 'img' && ['src', 'alt', 'title', 'width', 'height', 'data-src', 'data-lazy-src', 'data-original', 'data-srcset'].includes(n)) keep = true;
      else if ((tag === 'td' || tag === 'th') && ['colspan', 'rowspan', 'scope', 'headers'].includes(n)) keep = true;
      else if (tag === 'ol' && (n === 'start' || n === 'reversed')) keep = true;
      else if (tag === 'time' && n === 'datetime') keep = true;
      else if (tag === 'abbr' && n === 'title') keep = true;
      else if (tag === 'details' && n === 'open') keep = true;
      else if (n === 'lang' || n === 'dir') keep = true;
      else if (n === 'class' && opts.keepClasses) keep = true;
      else if (n === 'id' && opts.keepIds) keep = true;
      else if (n === 'style' && opts.keepStyle) keep = true;
      else if (n.startsWith('data-') && opts.keepData && opts.keepData.includes(n)) keep = true;
      if (!keep) el.removeAttribute(a.name);
    }
    if (tag === 'a') {
      const href = el.getAttribute('href');
      if (href) {
        const abs = absolutize(href, base);
        if (abs) el.setAttribute('href', abs);
        else if (/^mailto:/i.test(href) || href.startsWith('#')) el.setAttribute('href', href);
        else if (opts.keepData && (el.hasAttribute('data-wiki') || el.hasAttribute('data-anchor'))) el.removeAttribute('href');
        else el.removeAttribute('href');
      }
    }
    if (tag === 'img') {
      let src = el.getAttribute('src');
      if (!src || /^data:image\/gif/i.test(src) || (opts.preferLazy && (el.getAttribute('data-src') || el.getAttribute('data-lazy-src')))) src = el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('data-original') || src;
      if (!src && el.getAttribute('data-srcset')) src = el.getAttribute('data-srcset').split(',')[0].trim().split(/\s+/)[0];
      for (const d of ['data-src', 'data-lazy-src', 'data-original', 'data-srcset']) el.removeAttribute(d);
      const abs = absolutize(src, base);
      const w = parseInt(el.getAttribute('width') || '0', 10), hgt = parseInt(el.getAttribute('height') || '0', 10);
      const tiny = (w > 0 && w <= 2) || (hgt > 0 && hgt <= 2);
      if (!abs || tiny || (!abs.startsWith('data:') && TRACKING_RE.test(abs))) { el.remove(); return; }
      el.setAttribute('src', opts.noProxy ? abs : proxyImage(abs));
      if (!/^\d+$/.test(el.getAttribute('width') || '')) el.removeAttribute('width');
      if (!/^\d+$/.test(el.getAttribute('height') || '')) el.removeAttribute('height');
      if (!opts.keepClasses) { el.removeAttribute('width'); el.removeAttribute('height'); }
      el.setAttribute('loading', 'lazy');
      images.push(abs);
    }
    if (n_isStyle(el) && opts.keepStyle) {
      const st = el.getAttribute('style') || '';
      const cleaned = st.split(';').filter((d) => d.trim() && !/url\s*\(|expression|behavior|position\s*:|import|javascript/i.test(d)).join(';');
      if (cleaned) el.setAttribute('style', cleaned); else el.removeAttribute('style');
    }
  }
  function n_isStyle(el) { return el.hasAttribute('style'); }
  // remove empty inline/block containers (no text, no media)
  for (let pass = 0; pass < 3; pass++) {
    let removed = 0;
    for (const el of [...body.querySelectorAll('p, div, span, li, ul, ol, blockquote, figure, section, strong, em, b, i, h2, h3, h4, small, td')]) {
      if (!el.parentNode) continue;
      if (el.querySelector('img, table, hr, br, td, video, iframe, details')) continue;
      if (el.tagName === 'TD') continue;
      if (collapseWs(el.textContent).length === 0) { el.remove(); removed++; }
    }
    if (!removed) break;
  }
  // unwrap <a> around nothing
  for (const a of [...body.querySelectorAll('a')]) if (!a.hasAttribute('href') && !a.hasAttribute('data-wiki') && !a.hasAttribute('data-anchor')) unwrap(a);
  const text = collapseWs(body.textContent);
  return { html: body.innerHTML, text, images, firstImage: images[0] || null };
}

/** Plain text from HTML (entities decoded, tags stripped, whitespace collapsed). */
function htmlToText(html) {
  if (!html) return '';
  // rss-parser hands over elements with attributes (<subtitle type="html">) as { _: text, $: attrs } with
  // a null prototype – String() on those throws "Cannot convert object to primitive value"
  if (typeof html === 'object') html = typeof html._ === 'string' ? html._ : typeof html['#text'] === 'string' ? html['#text'] : '';
  html = String(html);
  if (!html) return '';
  if (!/[<&]/.test(html)) return collapseWs(html);
  try { return collapseWs(parseHtml(String(html).replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)\b[^>]*>/gi, '$& ')).body.textContent); }
  catch { return collapseWs(String(html).replace(/<[^>]+>/g, ' ')); }
}

/**
 * A text field that says nothing: empty (also an HTML body without text) or a placeholder a feed generator wrote in
 * place of a missing value ("None" from Python, "null", "undefined", "NaN", "n/a", a dash). Such a summary reached the
 * newspaper as text and the panel showed it with a drop cap ("N one").
 */
const PLACEHOLDER_TEXT = /^(?:none|null|undefined|nan|n\/a|k\.\s?a\.|-|–|—)$/i;
function isPlaceholderText(v) {
  if (v == null) return true;
  const t = htmlToText(v);
  return !t || PLACEHOLDER_TEXT.test(t);
}

function firstImageFromHtml(html, base) {
  if (!html) return null;
  const m = /<img[^>]+(?:src|data-src)\s*=\s*["']([^"']+)["']/i.exec(html);
  if (!m) return null;
  const u = absolutize(m[1], base);
  return u && !TRACKING_RE.test(u) ? u : null;
}

// --- disk cache ------------------------------------------------------------------------------------
class DiskCache {
  constructor(dir, { memoryLimit = 60 } = {}) { this.dir = dir; this.mem = new Map(); this.memoryLimit = memoryLimit; }
  file(key) { return path.join(this.dir, key.replace(/[^\w.-]+/g, '_') + '.json'); }
  get(key) {
    if (this.mem.has(key)) return this.mem.get(key);
    try {
      const f = this.file(key);
      if (!fs.existsSync(f)) return null;
      const v = JSON.parse(fs.readFileSync(f, 'utf8'));
      this.remember(key, v);
      return v;
    } catch { return null; }
  }
  set(key, data) {
    const entry = { at: Date.now(), data };
    this.remember(key, entry);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const f = this.file(key);
      fs.writeFileSync(f + '.tmp', JSON.stringify(entry));
      fs.renameSync(f + '.tmp', f);
    } catch (e) { console.error('[feeds] cache write failed', key, e.message); }
    return entry;
  }
  remember(key, entry) { this.mem.set(key, entry); if (this.mem.size > this.memoryLimit) this.mem.delete(this.mem.keys().next().value); }
  delete(key) { this.mem.delete(key); try { fs.unlinkSync(this.file(key)); } catch {} }
  age(key) { const e = this.get(key); return e ? Date.now() - e.at : Infinity; }
}

module.exports = { BROWSER_UA, WIKI_UA, DEFAULT_MAX_BYTES, isWebAddress, fetchRaw, fetchText, fetchJson, decodeBuffer, sha1, shortId, pLimit, absolutize, collapseWs, summarize, readingMinutes, toMs, parseHtml, getWindow, sanitizeHtml, htmlToText, isPlaceholderText, firstImageFromHtml, DiskCache, setImageProxy, hasImageProxy, proxyImage };
