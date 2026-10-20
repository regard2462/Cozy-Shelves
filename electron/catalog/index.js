// Online catalog ("Fernleihe"): free public sources (Project Gutenberg, Standard Ebooks, Projekt
// Gutenberg-DE, Wikisource, Wikibooks, Internet Archive, Open Library, OAPEN/DOAB, LibriVox, arXiv,
// Zeno.org, any web page) → search / browse / download into the library / read online.
//
// IPC (all via api.invoke):
//   'catalog:sources'                         → [{ id, name, icon, description:{de,en}, lang[], kind, canSearch, urlInput, browse:[{id,label:{de,en}}] }]
//   'catalog:search'   (sourceId, query, {lang, page})        → { items, total, page, hasMore, note }
//   'catalog:browse'   (sourceId, browseId, {lang, page, cont}) → same (+ cont for category paging)
//   'catalog:download' (item, formatIndex)    → { path, bookId, existed?, built? }   progress: api.on('catalog:progress', {id, received, total, done, error, path, bookId, phase})
//   'catalog:toEpub'   (item)                 → { path, bookId }  (WS Export / in-app EPUB builder)
//   'catalog:readHtml' (item, {chapters:'all'|'first'}) → { title, author, html, chapters, url, source, pages, truncated }
//   'catalog:readHref' – alias of 'catalog:readHtml' (older builds of the panel used that name)
//   'catalog:readUrl'  (url, {follow, index})  → same ("Webseite als Buch lesen")
//   'catalog:cancel'   (itemId)               → boolean
// Network errors are translated into German sentences before they cross the IPC boundary – the user
// never sees a raw "net::ERR_CONNECTION_TIMED_OUT".
// Electron is required lazily inside register() so the parsers are testable in plain Node.
'use strict';
const path = require('path');
const sources = require('./sources');
const readable = require('./readable');
const { createNet } = require('./net');
const { createDownloader } = require('./download');

const RESULT_TTL = 10 * 60 * 1000;

/** Everything the IPC layer needs, independent of Electron (tests inject a fake net/settings/library). */
function createCatalog({ net, settings, library, broadcast }) {
  const results = new Map();
  const memo = (key, fn) => {
    const c = results.get(key);
    if (c && Date.now() - c.at < RESULT_TTL) return c.value;
    const value = fn().catch((e) => { results.delete(key); throw e; });
    results.set(key, { at: Date.now(), value });
    if (results.size > 120) results.delete(results.keys().next().value);
    return value;
  };
  const srcOf = (id) => { const s = sources.byId[id]; if (!s) throw new Error('Unbekannte Quelle: ' + id); return s; };
  const normOpts = (o) => ({ lang: o?.lang === 'de' || o?.lang === 'en' ? o.lang : null, page: Math.max(1, parseInt(o?.page, 10) || 1), cont: o?.cont || null });
  const deps = { net };
  const downloader = createDownloader({ settings, library, broadcast, net, sources, readable });

  return {
    sources: () => sources.describe(),
    async search(sourceId, query, opts) {
      const s = srcOf(sourceId); const o = normOpts(opts); const q = String(query || '').trim();
      if (!q) return { items: [], total: 0, page: 1, hasMore: false, note: null };
      try {
        const r = await memo(`s:${sourceId}:${o.lang}:${o.page}:${q.toLowerCase()}`, () => s.search(q, o, deps));
        return finish(r, o.page);
      } catch (e) { throw friendlyError(e, s.name); }
    },
    async browse(sourceId, browseId, opts) {
      const s = srcOf(sourceId); const o = normOpts(opts);
      try {
        const r = await memo(`b:${sourceId}:${o.lang}:${o.page}:${o.cont || ''}:${browseId || ''}`, () => s.browse(browseId, o, deps));
        return finish(r, o.page);
      } catch (e) { throw friendlyError(e, s.name); }
    },
    download: (item, formatIndex) => downloader.download(item, formatIndex).catch((e) => { throw friendlyError(e, item && item.readOnlineUrl); }),
    toEpub: (item) => downloader.toEpub(item).catch((e) => { throw friendlyError(e, item && item.readOnlineUrl); }),
    cancel: (id) => downloader.cancel(id),
    readHtml: (item, opts) => readable.readItem(item, opts || {}, deps).catch((e) => { throw friendlyError(e, item && (item.meta?.url || item.readOnlineUrl)); }),
    readUrl: (url, opts) => readable.readWeb(url, opts || {}, deps).catch((e) => { throw friendlyError(e, url); }),
    _downloader: downloader,
  };
}

/** Chromium / Node network errors must never reach the user as "net::ERR_CONNECTION_TIMED_OUT". */
const NET_MESSAGES = [
  [/ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT|timeout after|Zeitüberschreitung/i, (h) => `${h} antwortet nicht (Zeitüberschreitung). Bitte später noch einmal versuchen.`],
  [/ERR_NAME_NOT_RESOLVED|ENOTFOUND|getaddrinfo/i, (h) => `${h} ist nicht erreichbar. Bitte die Internetverbindung prüfen.`],
  [/ERR_CONNECTION_REFUSED|ECONNREFUSED/i, (h) => `${h} verweigert die Verbindung.`],
  [/ERR_SSL|ERR_CERT|EPROTO/i, (h) => `${h} bietet keine gesicherte (HTTPS-)Verbindung an.`],
  [/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_NETWORK|fetch failed/i, (h) => `Keine Verbindung zu ${h}. Bitte die Internetverbindung prüfen.`],
  [/ERR_ABORTED/i, () => 'Abgebrochen.'],
];

function friendlyError(err, hint) {
  const msg = String((err && err.message) || err || '');
  if (!/net::|ERR_[A-Z_]+|ENOTFOUND|ECONNREFUSED|EPROTO|getaddrinfo|fetch failed|timeout after/i.test(msg)) return err instanceof Error ? err : new Error(msg || 'Unbekannter Fehler');
  const m = /https?:\/\/([^/\s)]+)/i.exec(msg) || /https?:\/\/([^/\s)]+)/i.exec(String(hint || ''));
  const host = m ? m[1] : (hint && !/^https?:/i.test(String(hint)) ? String(hint) : 'Die Quelle');
  for (const [re, fn] of NET_MESSAGES) if (re.test(msg)) { const e = new Error(fn(host)); e.cause = err; return e; }
  const e = new Error(`${host} konnte nicht geladen werden.`);
  e.cause = err;
  return e;
}

function finish(r, page) {
  const items = Array.isArray(r?.items) ? r.items : [];
  return { items, total: r?.total ?? null, page: r?.page || page, hasMore: !!r?.hasMore, note: r?.note || null, cont: r?.cont || null };
}

function register(ctx) {
  const { ipcMain, app, settings, library, broadcast } = ctx;
  const net = createNet({ cacheDir: path.join(app.getPath('userData'), 'feeds-cache', 'catalog') });
  const cat = createCatalog({ net, settings, library, broadcast });
  ipcMain.handle('catalog:sources', () => cat.sources());
  ipcMain.handle('catalog:search', (e, sourceId, query, opts) => cat.search(sourceId, query, opts));
  ipcMain.handle('catalog:browse', (e, sourceId, browseId, opts) => cat.browse(sourceId, browseId, opts));
  ipcMain.handle('catalog:download', (e, item, formatIndex) => cat.download(item, formatIndex));
  ipcMain.handle('catalog:toEpub', (e, item) => cat.toEpub(item));
  ipcMain.handle('catalog:cancel', (e, id) => cat.cancel(id));
  ipcMain.handle('catalog:readHtml', (e, item, opts) => cat.readHtml(item, opts));
  // alias: older panel builds invoked 'catalog:readHref' – keep both names working
  ipcMain.handle('catalog:readHref', (e, item, opts) => cat.readHtml(item, opts));
  ipcMain.handle('catalog:readUrl', (e, url, opts) => cat.readUrl(url, opts));
  return cat;
}

module.exports = { register, createCatalog, friendlyError };
