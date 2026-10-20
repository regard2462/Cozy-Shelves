// Main-process side of the reading browser (app/src/ui/browser): content blocker, JavaScript and image
// switches, keyboard shortcuts from inside the guest pages, download offers, the browser's own data file,
// and the three ways to keep a page: EPUB into the library, a chapter in a "Sammelband", a PDF.
//
// IPC (all through api.invoke / api.on):
//   'browser:info'                 → { ua, mobileUA, blockerHosts }
//   'browser:navigate' (wcId, url) → true when the guest was told to load the address (http/https only)
//   'browser:data:get'             → { bookmarks, readingList, history, closed, session }
//   'browser:data:set' (patch)     → true           (only the keys above, validated and capped)
//   'browser:saveBook' (article)   → { path, bookId, title }
//   'browser:collections'          → [{ path, title, chapters, mtime, bookId, kind }]
//   'browser:appendChapter' ({ target:{path}|{title}, chapter, images }) → { path, bookId, chapters, created }
//   'browser:pdf' ({ wcId }|{ article }) → { path, bookId }
//   'browser:blocked' (wcId)       → number of blocked requests on the current page
//   events: 'browser:key' {id, key, code, ctrl, shift, alt, meta}, 'browser:download' {id, url, filename, mime, size},
//           'browser:blocked' {id, count}; 'browser:popup' {id, url, disposition} comes from main.js (hardenWebviews).
//
// Rules for the guest partition come from settings.browser (written by the renderer):
//   adblock, js, images, textOnly, sites: { host: { js, adblock } }.
// Only one webRequest listener per event is possible on a session, so blocker, image switch and script switch
// share one onBeforeRequest; the JavaScript switch also adds a "script-src 'none'" CSP in onHeadersReceived.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Store } = require('../store');
const C = require('../feeds/common');
const blocklist = require('./blocklist');
const { buildEpub, appendChapters, readEpubSummary } = require('../catalog/epub');
const { libraryFolder, sanitizeName, libraryIdFor } = require('../catalog/download');

const DATA_DEFAULTS = { bookmarks: [], readingList: [], history: [], closed: [], session: null };
const LIMITS = { bookmarks: 1000, readingList: 500, history: 800, closed: 25 };
const WEB_FOLDER = 'Webseite als Buch';     // same folder as the catalogue's "Webseite als Buch"
const COLLECTION_FOLDER = 'Sammelbände';
const MAX_ARTICLE_HTML = 4 * 1024 * 1024;
const MAX_IMAGES = 80;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_IMAGES_TOTAL = 40 * 1024 * 1024;
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

// keys the guest may not keep for itself: they belong to the browser around it
const SHORTCUTS = new Set([
  'ctrl+t', 'ctrl+w', 'ctrl+tab', 'ctrl+shift+tab', 'ctrl+pagedown', 'ctrl+pageup', 'ctrl+shift+t', 'ctrl+l', 'ctrl+d',
  'ctrl+f', 'ctrl+s', 'ctrl+p', 'ctrl+r', 'f5', 'ctrl+shift+r', 'f3', 'shift+f3', 'f6', 'alt+arrowleft', 'alt+arrowright',
  'alt+home', 'ctrl++', 'ctrl+shift++', 'ctrl+=', 'ctrl+shift+=', 'ctrl+-', 'ctrl+0', 'ctrl+h',
]);

// map applications (the same list as isAppPage in app/src/ui/browser/util.js)
const APP_PAGES = [
  /^https:\/\/(www\.)?google\.[a-z.]{2,6}\/maps(\/|\?|#|$)/i,
  /^https:\/\/maps\.google\.[a-z.]{2,6}\//i,
  /^https:\/\/earth\.google\.com\//i,
  /^https:\/\/(www\.)?openstreetmap\.(org|de)\//i,
];
const isAppPage = (u) => APP_PAGES.some((re) => re.test(String(u || '')));

const str = (v, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');
const isWeb = (u) => /^https?:\/\//i.test(String(u || ''));
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
const siteOf = (u) => hostOf(u).replace(/^www\./, '');

function register(ctx) {
  const { ipcMain, app, settings, library, broadcast, BROWSER_PARTITION } = ctx;
  const electron = require('electron');
  const { session, webContents, BrowserWindow } = electron;

  // ---- data file (history, reading list, bookmarks, tabs) -------------------------------------------------
  const data = new Store(path.join(app.getPath('userData'), 'browser-data.json'), DATA_DEFAULTS);
  app.on('before-quit', () => { try { data.flush(); } catch {} });

  ipcMain.handle('browser:data:get', () => data.get());
  ipcMain.handle('browser:data:set', (e, patch) => {
    if (!patch || typeof patch !== 'object') return false;
    const next = {};
    for (const key of Object.keys(DATA_DEFAULTS)) {
      if (!(key in patch)) continue;
      if (key === 'session') next.session = cleanSession(patch.session);
      else next[key] = cleanList(patch[key], LIMITS[key]);
    }
    if (Object.keys(next).length) data.set(next);
    return true;
  });

  // ---- rules --------------------------------------------------------------------------------------------------
  let rules = readRules(settings.get('browser'));
  try { settings.onChange?.((d) => { rules = readRules(d && d.browser); }); } catch {}

  const ses = session.fromPartition(BROWSER_PARTITION);
  const cleanUA = ses.getUserAgent().replace(/\s(Electron|lesesaal)\/\S+/gi, '');
  ses.setUserAgent(cleanUA);

  const blocked = new Map();     // webContents id → count on the current page
  const topUrl = new Map();      // webContents id → committed top-level URL
  let blockedTimer = null;
  const dirty = new Set();
  function markDirty(id) {
    dirty.add(id);
    if (blockedTimer) return;
    blockedTimer = setTimeout(() => {
      blockedTimer = null;
      for (const i of dirty) broadcast('browser:blocked', { id: i, count: blocked.get(i) || 0 });
      dirty.clear();
    }, 400);
  }
  const bumpBlocked = (id) => { blocked.set(id, (blocked.get(id) || 0) + 1); markDirty(id); };
  const siteRule = (url) => rules.sites[siteOf(url)] || {};
  const jsAllowed = (url) => { const s = siteRule(url); return typeof s.js === 'boolean' ? s.js : rules.js; };
  const blockerOn = (url) => rules.adblock && siteRule(url).adblock !== false;

  ses.webRequest.onBeforeRequest((details, cb) => {
    try {
      const id = details.webContentsId;
      const type = details.resourceType;
      if (type === 'mainFrame') {
        if (blockerOn(details.url) && details.method === 'GET') {
          const clean = blocklist.stripTracking(details.url);
          if (clean !== details.url) return cb({ redirectURL: clean });
        }
        return cb({});
      }
      if (id == null) return cb({});
      const top = topUrl.get(id) || safeUrl(id);
      if (!top) return cb({});
      const host = hostOf(details.url);
      // a listed network is still allowed on its own site (visiting outbrain.com itself works)
      if (blockerOn(top) && blocklist.isBlockedHost(host) && blocklist.blockedEntry(host) !== blocklist.blockedEntry(hostOf(top))) {
        bumpBlocked(id);
        return cb({ cancel: true });
      }
      // a map (Google Maps, Street View) is made of pictures: the reading switches "Bilder aus" and "Nur Text" leave it whole
      const app = isAppPage(top);
      if ((type === 'image' || type === 'imageset') && (!rules.images || rules.textOnly) && !app) return cb({ cancel: true });
      if (type === 'media' && rules.textOnly && !app) return cb({ cancel: true });
      if (type === 'script' && !jsAllowed(top)) return cb({ cancel: true });
      cb({});
    } catch { cb({}); }
  });

  // JavaScript off: every document of that site gets a CSP that forbids scripts (inline ones included).
  // The browser's own helper (webContents.executeJavaScript) is not affected by a page's CSP.
  ses.webRequest.onHeadersReceived((details, cb) => {
    try {
      const type = details.resourceType;
      if (type !== 'mainFrame' && type !== 'subFrame') return cb({});
      const top = type === 'mainFrame' ? details.url : (topUrl.get(details.webContentsId) || safeUrl(details.webContentsId) || details.url);
      if (jsAllowed(top)) return cb({});
      const headers = { ...(details.responseHeaders || {}) };
      const key = Object.keys(headers).find((k) => k.toLowerCase() === 'content-security-policy') || 'Content-Security-Policy';
      headers[key] = [...(headers[key] || []), "script-src 'none'; object-src 'none'"];
      cb({ responseHeaders: headers });
    } catch { cb({}); }
  });

  function safeUrl(id) {
    try { const wc = webContents.fromId(id); return wc && !wc.isDestroyed() ? wc.getURL() : ''; } catch { return ''; }
  }

  // downloads: main.js cancels every download of the guest partition; the page's offer is passed to the panel
  ses.on('will-download', (e, item, wc) => {
    try {
      broadcast('browser:download', {
        id: wc && !wc.isDestroyed() ? wc.id : null, url: item.getURL(), filename: item.getFilename(),
        mime: item.getMimeType(), size: item.getTotalBytes() || 0,
      });
    } catch {}
  });

  // guests: keyboard shortcuts and the committed URL (for the per-site rules)
  app.on('web-contents-created', (e, wc) => {
    if (wc.getType() !== 'webview') return;
    const id = wc.id;
    // no window ever, from the very first moment (main.js replaces this with the tab-opening handler on attach)
    try { wc.setWindowOpenHandler(() => ({ action: 'deny' })); } catch {}
    wc.on('did-start-navigation', (ev, url, isInPlace, isMainFrame) => {
      const main = ev?.isMainFrame ?? isMainFrame;
      const same = ev?.isSameDocument ?? isInPlace;
      if (main && !same) { blocked.set(id, 0); markDirty(id); }
    });
    wc.on('did-navigate', (ev, url) => { topUrl.set(id, url); });
    wc.on('before-input-event', (ev, input) => {
      if (input.type !== 'keyDown') return;
      const combo = comboOf(input);
      const passive = input.key === 'Escape' && !input.control && !input.alt && !input.meta;
      if (!SHORTCUTS.has(combo) && !passive) return;
      if (!passive) ev.preventDefault();
      broadcast('browser:key', { id, key: input.key, code: input.code, ctrl: !!(input.control || input.meta), shift: !!input.shift, alt: !!input.alt, repeat: !!input.isAutoRepeat, passive });
    });
    wc.once('destroyed', () => { blocked.delete(id); topUrl.delete(id); dirty.delete(id); });
  });

  ipcMain.handle('browser:info', () => ({ ua: cleanUA, mobileUA: MOBILE_UA, blockerHosts: blocklist.size }));
  // navigation of a guest: a load that is replaced by the next one rejects with ERR_ABORTED, which is normal
  ipcMain.handle('browser:navigate', (e, id, url) => {
    const wc = webContents.fromId(Number(id));
    if (!wc || wc.isDestroyed() || wc.getType() !== 'webview' || wc.session !== ses || !isWeb(url)) return false;
    wc.loadURL(String(url)).catch(() => {});
    return true;
  });
  ipcMain.handle('browser:blocked', (e, id) => blocked.get(Number(id)) || 0);

  // ---- saving -------------------------------------------------------------------------------------------------
  const webDir = () => ensureDir(path.join(libraryFolder(settings), 'Online-Katalog', WEB_FOLDER));
  const collectionDir = () => ensureDir(path.join(libraryFolder(settings), 'Online-Katalog', COLLECTION_FOLDER));
  const rescan = () => { try { library?.rescanQuiet?.(); } catch (e) { console.warn('[browser] rescan failed', e.message); } };

  ipcMain.handle('browser:saveBook', async (e, raw) => {
    const a = cleanArticle(raw);
    const { html, resources } = raw?.images === false ? { html: a.html, resources: [] } : await embedImages(a.html, a.url);
    const buf = buildEpub({
      title: a.title, author: a.byline || a.site, language: a.lang, identifier: 'urn:lesesaal:web:' + C.sha1(a.url).slice(0, 20),
      source: a.site, sourceUrl: a.url, description: a.excerpt, chapters: [{ title: a.title, html }], resources,
    });
    const target = uniquePath(path.join(webDir(), fileName(a.title, a.site, 'epub')));
    writeAtomic(target, buf);
    rescan();
    return { path: target, bookId: libraryIdFor(target), title: a.title };
  });

  ipcMain.handle('browser:collections', () => {
    const out = [];
    for (const [dir, kind] of [[collectionDir(), 'collection'], [webDir(), 'web']]) {
      let names = [];
      try { names = fs.readdirSync(dir).filter((n) => /\.epub$/i.test(n)); } catch {}
      for (const n of names) {
        const p = path.join(dir, n);
        try {
          const st = fs.statSync(p);
          const sum = readEpubSummary(fs.readFileSync(p));
          out.push({ path: p, title: sum.title || n.replace(/\.epub$/i, ''), chapters: sum.chapters, mtime: st.mtimeMs, bookId: libraryIdFor(p), kind });
        } catch { /* not an EPUB we can read */ }
      }
    }
    return out.sort((x, y) => (x.kind === y.kind ? y.mtime - x.mtime : x.kind === 'collection' ? -1 : 1));
  });

  ipcMain.handle('browser:appendChapter', async (e, req) => {
    const a = cleanArticle(req?.chapter);
    const { html, resources } = req?.images === false ? { html: a.html, resources: [] } : await embedImages(a.html, a.url);
    const chapter = { title: a.title, html: chapterHtml(a, html) };
    const t = req?.target || {};
    if (t.path) {
      const p = path.normalize(String(t.path));
      const allowed = [collectionDir(), webDir()].some((d) => ctx.isInside(p, d));
      if (!allowed || !/\.epub$/i.test(p) || !fs.existsSync(p)) throw new Error('Dieser Sammelband ist nicht im Regal.');
      const next = appendChapters(fs.readFileSync(p), [chapter], { resources, language: a.lang });
      writeAtomic(p, next);
      rescan();
      return { path: p, bookId: libraryIdFor(p), chapters: readEpubSummary(next).chapters, created: false };
    }
    const title = C.collapseWs(str(t.title, 160)) || 'Sammelband';
    const buf = buildEpub({
      title, author: 'Cozy Shelves', language: a.lang, identifier: 'urn:lesesaal:sammelband:' + crypto.randomUUID(),
      source: 'Lesebrowser', chapters: [chapter], resources, forceChapterTitles: true,
    });
    const target = uniquePath(path.join(collectionDir(), sanitizeName(title).slice(0, 140) + '.epub'));
    writeAtomic(target, buf);
    rescan();
    return { path: target, bookId: libraryIdFor(target), chapters: 1, created: true };
  });

  ipcMain.handle('browser:pdf', async (e, req) => {
    let buf, title, site;
    if (req?.article) {
      const a = cleanArticle(req.article);
      title = a.title; site = a.site;
      buf = await printArticle(a);
    } else {
      const wc = webContents.fromId(Number(req?.wcId));
      if (!wc || wc.isDestroyed() || wc.getType() !== 'webview') throw new Error('Die Seite ist nicht mehr geöffnet.');
      title = C.collapseWs(str(req?.title, 180)) || wc.getTitle() || siteOf(wc.getURL());
      site = siteOf(wc.getURL());
      buf = await wc.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } });
    }
    const target = uniquePath(path.join(webDir(), fileName(title, site, 'pdf')));
    writeAtomic(target, buf);
    rescan();
    return { path: target, bookId: libraryIdFor(target) };
  });

  /** The reader view as a PDF: a hidden window without JavaScript renders the sanitized article. */
  async function printArticle(a) {
    const tmp = path.join(os.tmpdir(), `lesesaal-print-${process.pid}-${Date.now()}.html`);
    const fontsCss = pathToFileUrl(path.join(__dirname, '..', '..', 'app', 'vendor', 'fonts', 'fonts.css'));
    fs.writeFileSync(tmp, `<!doctype html><html lang="${escAttr(a.lang || 'de')}"><head><meta charset="utf-8"><title>${escText(a.title)}</title>
<link rel="stylesheet" href="${fontsCss}"><style>
@page { size: A4; margin: 22mm 20mm 24mm; }
body { font-family: "EB Garamond", Georgia, serif; font-size: 12pt; line-height: 1.5; color: #111; hyphens: auto; text-align: justify; }
h1 { font-family: "Cormorant Garamond", "EB Garamond", Georgia, serif; font-size: 25pt; line-height: 1.1; margin: 0 0 6pt; text-align: left; }
h2, h3, h4 { line-height: 1.2; text-align: left; break-after: avoid; }
.meta { color: #555; font-style: italic; margin: 0 0 18pt; } img { max-width: 100%; height: auto; break-inside: avoid; display: block; margin: 8pt auto; }
figure { margin: 10pt 0; break-inside: avoid; } figcaption { font-size: 10pt; color: #555; text-align: center; }
pre, code { font-family: Consolas, monospace; font-size: 10pt; white-space: pre-wrap; } blockquote { margin: 8pt 18pt; font-style: italic; }
table { border-collapse: collapse; font-size: 10.5pt; } td, th { border: 0.5pt solid #999; padding: 2pt 5pt; } a { color: inherit; }
.src { margin-top: 24pt; padding-top: 6pt; border-top: 0.5pt solid #999; font-size: 9.5pt; color: #555; text-align: left; word-break: break-all; }
</style></head><body><h1>${escText(a.title)}</h1><p class="meta">${escText([a.byline, a.site].filter(Boolean).join(' · '))}</p>${a.html}<p class="src">${escText(a.url)}</p></body></html>`);
    const win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'lesesaal-print' } });
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve(), 25000);    // slow images: print what is there
        win.webContents.once('did-finish-load', () => { clearTimeout(t); resolve(); });
        win.webContents.once('did-fail-load', (ev, code, desc) => { if (code !== -3) { clearTimeout(t); reject(new Error(desc || 'Laden fehlgeschlagen')); } });
        win.loadFile(tmp).catch(() => {});
      });
      return await win.webContents.printToPDF({
        pageSize: 'A4', printBackground: false, displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: '<div style="width:100%;font-size:8pt;color:#777;text-align:center;font-family:Georgia,serif"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
        margins: { marginType: 'custom', top: 0.8, bottom: 0.9, left: 0.8, right: 0.8 },
      });
    } finally {
      try { win.destroy(); } catch {}
      try { fs.unlinkSync(tmp); } catch {}
    }
  }

  /** Downloads the article's images (through the browser partition, so referer and cookies match) and
   *  rewrites the <img> sources to files inside the EPUB. Images that fail are dropped quietly. */
  async function embedImages(html, pageUrl) {
    const doc = C.parseHtml(`<div>${html || ''}</div>`);
    const root = doc.body.firstElementChild;
    const imgs = [...root.querySelectorAll('img')].slice(0, MAX_IMAGES);
    for (const extra of [...root.querySelectorAll('img')].slice(MAX_IMAGES)) extra.remove();
    const resources = [];
    const byUrl = new Map();
    let total = 0;
    const limit = C.pLimit(4);
    await Promise.all(imgs.map((img) => limit(async () => {
      const src = originalImageUrl(img.getAttribute('src'));
      if (!src) { img.remove(); return; }
      try {
        let res = byUrl.get(src);
        if (!res) {
          // the referrer goes in as fetch option: a "Referer" header makes Chromium refuse the request
          const r = await ses.fetch(src, { referrer: pageUrl, headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' }, signal: AbortSignal.timeout(15000) });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
          const ext = IMAGE_TYPES[type];
          if (!ext) throw new Error('kein Bild');
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length > MAX_IMAGE_BYTES || total + buf.length > MAX_IMAGES_TOTAL) throw new Error('zu groß');
          total += buf.length;
          res = { name: `img/${C.sha1(src).slice(0, 16)}.${ext}`, data: buf, mime: type === 'image/jpg' ? 'image/jpeg' : type };
          byUrl.set(src, res);
          resources.push(res);
        }
        img.setAttribute('src', res.name);
        img.removeAttribute('loading');
      } catch { img.remove(); }
    })));
    return { html: root.innerHTML, resources };
  }

  return { rules: () => rules };
}

// ---- helpers ------------------------------------------------------------------------------------------------------
function readRules(b) {
  b = b && typeof b === 'object' ? b : {};
  const sites = {};
  if (b.sites && typeof b.sites === 'object') {
    for (const [host, v] of Object.entries(b.sites)) if (v && typeof v === 'object') sites[String(host).toLowerCase().replace(/^www\./, '')] = { js: typeof v.js === 'boolean' ? v.js : undefined, adblock: v.adblock === false ? false : undefined };
  }
  return { adblock: b.adblock !== false, js: b.js !== false, images: b.images !== false, textOnly: !!b.textOnly, sites };
}

/** 'ctrl+shift+t', 'alt+arrowleft', 'f5' … (meta counts as ctrl). */
function comboOf(input) {
  const key = String(input.key || '').toLowerCase();
  const parts = [];
  if (input.control || input.meta) parts.push('ctrl');
  if (input.shift) parts.push('shift');
  if (input.alt) parts.push('alt');
  parts.push(key === ' ' ? 'space' : key);
  return parts.join('+');
}

function cleanList(list, max) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const it of list) {
    if (!it || typeof it !== 'object' || !isWeb(it.url)) continue;
    const o = { url: str(it.url, 4000), title: str(it.title, 400) };
    for (const k of ['id', 'folder', 'site', 'mode']) if (typeof it[k] === 'string') o[k] = it[k].slice(0, 200);
    for (const k of ['at', 'addedAt', 'readAt', 'progress', 'visits', 'frac']) if (Number.isFinite(it[k])) o[k] = it[k];
    if (typeof it.read === 'boolean') o.read = it.read;
    out.push(o);
    if (out.length >= max) break;
  }
  return out;
}
function cleanSession(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.tabs)) return null;
  const tabs = [];
  for (const t of s.tabs.slice(0, 30)) {
    if (!t || typeof t !== 'object') continue;
    tabs.push({ url: isWeb(t.url) ? str(t.url, 4000) : '', title: str(t.title, 400), mode: t.mode === 'reader' ? 'reader' : t.mode === 'web' ? 'web' : 'start', frac: Number.isFinite(t.frac) ? Math.min(1, Math.max(0, t.frac)) : 0, mobile: !!t.mobile });
  }
  return { tabs, active: Number.isInteger(s.active) ? Math.max(0, Math.min(tabs.length - 1, s.active)) : 0, at: Date.now() };
}

/** Validates the article the renderer extracted. Its HTML is sanitized once more here (defence in depth). */
function cleanArticle(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Kein Artikel');
  const url = isWeb(raw.url) ? String(raw.url) : '';
  if (!url) throw new Error('Die Seite hat keine Webadresse.');
  let html = String(raw.html || '');
  if (!html.trim()) throw new Error('Kein Text zum Speichern gefunden.');
  if (html.length > MAX_ARTICLE_HTML) html = html.slice(0, MAX_ARTICLE_HTML);
  // images of the catalogue's reading view come through the img:// cache; the book needs the originals
  html = html.replace(/(\bsrc=["'])img:\/\/cache\/([\w-]+)/g, (m, pre, b64) => { const u = originalImageUrl('img://cache/' + b64); return u ? pre + u : pre; });
  const s = C.sanitizeHtml(html, { baseUrl: url, noProxy: true });
  const lang = /^[a-z]{2}(-[A-Za-z]{2})?$/.test(String(raw.lang || '')) ? String(raw.lang).slice(0, 5) : 'de';
  const site = C.collapseWs(str(raw.site, 120)) || siteOf(url);
  return { url, lang, site, html: s.html, title: C.collapseWs(str(raw.title, 300)) || site, byline: C.collapseWs(str(raw.byline, 200)), excerpt: C.collapseWs(str(raw.excerpt, 600)) };
}

/** The chapter of a Sammelband: byline and source travel with the text. */
function chapterHtml(a, html) {
  const meta = [a.byline, a.site].filter(Boolean).map(escText).join(' · ');
  return `${meta ? `<p class="lsb-meta"><em>${meta}</em></p>` : ''}${html}<p class="lsb-source">${escText(a.url)}</p>`;
}

/** img:// proxy URLs (feeds image cache) point at the original image. */
function originalImageUrl(src) {
  const s = String(src || '').trim();
  const m = /^img:\/\/cache\/([\w-]+)/.exec(s);
  if (m) { try { const u = Buffer.from(m[1], 'base64url').toString('utf8'); return isWeb(u) ? u : null; } catch { return null; } }
  return isWeb(s) ? s : null;
}

function fileName(title, site, ext) {
  let t = sanitizeName(title) || 'Webseite';
  const s = sanitizeName(site);
  const room = 150 - ext.length - 1 - (s ? s.length + 3 : 0);
  if (t.length > room) t = t.slice(0, Math.max(20, room)).replace(/\s+\S*$/, '');
  return `${t}${s && !t.toLowerCase().includes(s.toLowerCase()) ? ' - ' + s : ''}.${ext}`;
}
function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p), base = p.slice(0, -ext.length);
  for (let i = 2; i < 500; i++) { const q = `${base} (${i})${ext}`; if (!fs.existsSync(q)) return q; }
  return `${base} (${Date.now()})${ext}`;
}
function writeAtomic(p, buf) {
  fs.writeFileSync(p + '.part', buf);
  fs.renameSync(p + '.part', p);
}
function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); return d; }
function pathToFileUrl(p) { return require('url').pathToFileURL(p).href; }
const escText = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');

module.exports = { register, readRules, comboOf, cleanList, cleanSession, originalImageUrl, fileName };
