// The browser version's stand-in for electron/feeds/common.js. The web build (build/web.js) resolves every
// `require('../feeds/common')` of the backend modules it bundles (electron/feeds/wiki.js, dict.js, library/classify.js)
// to this module, so the Wikipedia and dictionary handlers run in the page on the browser's fetch (those hosts
// answer with CORS headers). Only the helpers those modules use are here; the HTML is sanitized by the renderer's own
// sanitizer (ui/reader/link-nav.js) in place of the jsdom one.
import { sanitizeHtml as rendererSanitizeHtml } from '../ui/reader/link-nav.js';

export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';
export const WIKI_UA = 'CozyShelves/0.1 (personal desktop reading app) node-fetch';
export const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Fetch text with a timeout: { ok, status, url, contentType, text }. The browser follows redirects itself and
 * forbids the User-Agent header, so `ua` and the manual redirect handling of the desktop are not here. Only
 * http(s) addresses leave the page.
 */
export async function fetchText(url, { timeout = 15000, headers = {}, method = 'GET', body } = {}) {
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('only http(s) addresses: ' + url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const h = { ...headers };
    for (const k of Object.keys(h)) if (/^(user-agent|api-user-agent|accept-language)$/i.test(k)) delete h[k];   // forbidden or pointless in a browser
    const res = await fetch(url, { method, body, headers: h, signal: ctrl.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, url: res.url || url, contentType: res.headers.get('content-type') || '', text, redirects: 0, truncated: false };
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error('timeout after ' + timeout + ' ms');
    throw e;
  } finally { clearTimeout(timer); }
}
export async function fetchJson(url, opts = {}) {
  const r = await fetchText(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  try { return JSON.parse(r.text); } catch { throw new Error('invalid JSON from ' + url); }
}
export async function fetchRaw(url, opts = {}) {
  const r = await fetchText(url, opts);
  return { ...r, buffer: new TextEncoder().encode(r.text) };
}
export function decodeBuffer(buffer) { return new TextDecoder('utf-8').decode(buffer); }

/** Cache keys only (no crypto in the page for this): a 64-bit FNV-1a as 16 hex characters, stretched like a SHA-1 hex. */
export function sha1(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (const c of String(s)) { const x = c.codePointAt(0); h1 = Math.imul(h1 ^ x, 16777619) >>> 0; h2 = Math.imul(h2 ^ (x + 7), 16777619) >>> 0; }
  const hex = (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'));
  return (hex + hex + hex).slice(0, 40);
}
export const shortId = (s, n = 16) => sha1(s).slice(0, n);

export function pLimit(concurrency) {
  let active = 0; const queue = [];
  const next = () => { if (active >= concurrency || !queue.length) return; active++; const { fn, resolve, reject } = queue.shift(); Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); }); };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}
export function absolutize(u, base) {
  if (!u) return null;
  u = String(u).trim();
  if (!u) return null;
  if (/^data:image\//i.test(u)) return u;
  if (u.startsWith('//')) u = 'https:' + u;
  try { const abs = new URL(u, base || undefined); if (!/^https?:$/.test(abs.protocol)) return null; return abs.href; } catch { return null; }
}
export function collapseWs(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
export function summarize(text, max = 300) { const t = collapseWs(text); return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t; }
export function readingMinutes(text) { const words = collapseWs(text).split(' ').filter(Boolean).length; return Math.max(1, Math.round(words / 220)); }
export function toMs(d) {
  if (!d) return null;
  if (typeof d === 'number') return d;
  const t = Date.parse(String(d).trim());
  return Number.isFinite(t) ? t : null;
}
export function parseHtml(html) { return new DOMParser().parseFromString(String(html || ''), 'text/html'); }
export function getWindow() { return window; }
export function htmlToText(html) {
  if (!html) return '';
  if (typeof html === 'object') html = typeof html._ === 'string' ? html._ : typeof html['#text'] === 'string' ? html['#text'] : '';
  html = String(html);
  if (!html) return '';
  if (!/[<&]/.test(html)) return collapseWs(html);
  try { return collapseWs(parseHtml(html.replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)\b[^>]*>/gi, '$& ')).body.textContent); }
  catch { return collapseWs(html.replace(/<[^>]+>/g, ' ')); }
}
export function firstImageFromHtml(html, base) {
  try { const img = parseHtml(html).querySelector('img[src]'); return img ? absolutize(img.getAttribute('src'), base) : null; } catch { return null; }
}
/** Known-safe HTML (the renderer's sanitizer), its text and its pictures: { html, text, images, firstImage }. */
export function sanitizeHtml(html, opts = {}) {
  const keepData = opts.keepData || [];
  const out = rendererSanitizeHtml(html, opts.baseUrl || '', { keepClasses: !!opts.keepClasses, keepIds: !!opts.keepIds, keepData });
  const doc = parseHtml(out);
  const images = [...doc.querySelectorAll('img[src]')].map((i) => i.getAttribute('src')).filter(Boolean);
  return { html: out, text: collapseWs(doc.body.textContent), images, firstImage: images[0] || null };
}
/** The disk cache of the desktop is a memory cache here (a page reload starts afresh; the hosts are quick). */
export class DiskCache {
  constructor(dir, { memoryLimit = 60 } = {}) { this.dir = dir; this.mem = new Map(); this.memoryLimit = memoryLimit; }
  get(key) { return this.mem.has(key) ? this.mem.get(key) : null; }
  set(key, data) { const entry = { at: Date.now(), data }; this.remember(key, entry); return entry; }
  remember(key, entry) { this.mem.set(key, entry); if (this.mem.size > this.memoryLimit) this.mem.delete(this.mem.keys().next().value); }
  delete(key) { this.mem.delete(key); }
  age(key) { const e = this.get(key); return e ? Date.now() - e.at : Infinity; }
}
export function setImageProxy() {}
export function hasImageProxy() { return false; }
export function proxyImage(u) { return u || null; }
