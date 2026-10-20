// Mediathek backend: ARD, ZDF, arte, 3sat … via MediathekViewWeb, the English-language sources (DW, NHK WORLD-JAPAN,
// NASA, Internet Archive, TED; sources/*.js), live TV (Zapp channel list and the English news channels),
// the media:// protocol (CORS-clean proxy for every film, subtitles as WebVTT, preview images, offline
// playlists), Merkliste / Weiterschauen, downloads and the real picture sizes of the qualities (heights.js).
//
// IPC (renderer: api.invoke('mediathek:…')):
//   query(opts) → { items, total, hasMore, offset }        search / rows (see mvw.js buildBody); with { source } one
//                                                           English-language source, with { sources, cursor } several
//   resolve(item) → item                                    the files of a source item (sizes, subtitles)
//   heights(item) → { key: { width, height, p, label } }    the real picture sizes of the qualities of a film
//   sourceTopics(id) → [{ id, title, sub? }]                 topics of a source (categories, programmes, collections)
//   variants(item) → items                                  Audiodeskription, Gebärdensprache … of a film
//   channels() → { channels, groups }                       topics(channel) → string[]
//   live() → channels                                       liveNow(ids) → { id: { title, start, end } }
//   diagnose(url) → { kind, message, status }               why a film does not play
//   sizes(item) → { low, sd, hd }                           bytes per quality
//   downloadOptions(item) → [{ quality, height, bytes }]    the download menu: real picture and file sizes
//   favorites() · setFavorite(item, on)                     Merkliste
//   progress() · position(item, pos, dur) · startAt(id) · continue() · forget(id)   Weiterschauen
//   download(item, quality) · downloads() · pause(id) · resume(id) · remove(id, { files }) · playable(id) · reveal(id)
//   folder() · pickFolder() · resetFolder()                 download folder (settings.mediathek.folder)
//   stats()                                                 proxy counters (tests)
// Events: 'mediathek:download' (download entry, throttled progress).
'use strict';
const path = require('path');
const fs = require('fs');
const mvw = require('./mvw');
const channels = require('./channels');
const { Allowlist, hostOf } = require('./allowlist');
const { createLive } = require('./live');
const { createLibrary, defaultFile, slim } = require('./library');
const { createThumbs } = require('./thumbs');
const { createDownloads } = require('./downloads');
const { createMediaProtocol } = require('./proxy');
const { toVtt } = require('./subtitles');
const errors = require('./errors');
const { createSources } = require('./sources');
const { createHeights, createHeightStore } = require('./heights');

let instance = null;

function register(ctx) {
  const { ipcMain, app, settings, broadcast, getMainWindow, lfileUrl, dialog, protocol, allowedRoots, isInside } = ctx;
  const { net, nativeImage, shell } = require('electron');
  const fetch = (url, init = {}) => net.fetch(url, { ...init, bypassCustomProtocolHandlers: true });

  /**
   * A playlist through net.request, following redirects by hand: net.fetch hides where a redirect led,
   * but relative addresses inside a playlist need that final address, and ORF answers viewers outside
   * Austria with a redirect to its "geoprotection" playlist. → { status, url, text, geo }
   */
  function fetchPlaylist(url, { headers = {}, timeout = 20000, signal, limit = 8 * 1024 * 1024 } = {}) {
    return new Promise((resolve, reject) => {
      let finalUrl = url, hops = 0, settled = false;
      const req = net.request({ url, redirect: 'manual', useSessionCookies: false });
      for (const [k, v] of Object.entries({ 'User-Agent': mvw.UA, Accept: '*/*', ...headers })) req.setHeader(k, v);
      const finish = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); fn(v); };
      const onAbort = () => { try { req.abort(); } catch {} finish(reject, signal.reason || new Error('Abgebrochen')); };
      const timer = setTimeout(() => { try { req.abort(); } catch {} finish(reject, new Error('timeout')); }, timeout);
      if (signal) { if (signal.aborted) return onAbort(); signal.addEventListener('abort', onAbort, { once: true }); }
      req.on('redirect', (status, method, redirectUrl) => {
        finalUrl = redirectUrl;
        if (/geoprotection/i.test(redirectUrl) || ++hops > 8 || !/^https?:/i.test(redirectUrl)) { try { req.abort(); } catch {} finish(resolve, { status: /geoprotection/i.test(redirectUrl) ? 451 : 310, url: redirectUrl, text: '', geo: /geoprotection/i.test(redirectUrl) }); return; }
        req.followRedirect();
      });
      req.on('response', (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (c) => { size += c.length; if (size > limit) { try { req.abort(); } catch {} finish(reject, new Error('Playlist zu groß')); } else chunks.push(c); });
        res.on('end', () => finish(resolve, { status: res.statusCode, url: finalUrl, text: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', (e) => finish(reject, e));
      });
      req.on('error', (e) => finish(reject, e));
      req.end();
    });
  }
  const userDir = path.join(app.getPath('userData'), 'mediathek');
  fs.mkdirSync(userDir, { recursive: true });

  const allow = new Allowlist();
  const websites = new Set();
  const images = new Set();
  // items of the English-language sources only bring addresses on the hosts their source names
  let sources = null;
  const noteItems = (items) => {
    for (const it of items || []) {
      if (!it) continue;
      if (it.source && sources) {
        allow.addItem(it, sources.isMediaHost);
        if (typeof it.image === 'string' && sources.isImageHost(it.image)) images.add(it.image);
        continue;
      }
      allow.addItem(it);
      const h = it.website && hostOf(it.website); if (h) websites.add(h);
    }
  };
  const client = mvw.createClient({ fetch, onItems: noteItems });
  const live = createLive({ fetch, onStreams: (list) => list.forEach((c) => { if (c.stream) allow.add(c.stream); }) });
  const heightStore = createHeightStore(path.join(userDir, 'heights.json'));
  const heights = createHeights({ fetch, store: heightStore });
  // arte's English programmes come from MediathekViewWeb like every arte film
  const arteEn = { id: 'arte-en', channel: 'ARTE.EN', list: (o) => client.query({ ...o, source: undefined, sources: undefined, cursor: undefined, channels: ['ARTE.EN'] }), topics: async () => [] };
  sources = createSources({ fetch, heights, extra: [arteEn] });
  const library = createLibrary({ file: defaultFile(app.getPath('userData')), allow });
  noteItems(library.favorites());
  noteItems(library.continueList(500).map((e) => e.item));

  /** An item handed in by the renderer: only addresses whose hosts came out of the Mediathek survive. */
  function trusted(item) {
    if (!item || !item.id || !item.video || typeof item.video !== 'object') return null;
    const ok = (u) => (typeof u === 'string' && allow.has(u) ? u : null);
    const video = {};
    for (const [k, u] of Object.entries(item.video)) if (ok(u)) video[k] = u;
    if (!Object.keys(video).length) return null;
    const s = slim(item);
    return { ...s, video, heights: s.heights || null, subtitle: ok(item.subtitle), live: !!item.live };
  }

  // a download folder from the time the program was called Cozystacks (0.8.0 to 0.9.2) or Lesesaal (until 0.7.2)
  // stays in use
  const defaultFolder = () => require('../data-folder').keptFolder(app.getPath('videos'), 'Cozy Shelves Mediathek', ['Cozystacks Mediathek', 'Lesesaal Mediathek']);
  const folder = () => { const m = settings.get('mediathek'); return m && typeof m.folder === 'string' && m.folder ? m.folder : defaultFolder(); };
  allowedRoots.add(folder());

  const thumbs = createThumbs({
    fetch, dir: path.join(userDir, 'thumbs'),
    isWebsite: (u) => websites.has(hostOf(u)),
    isImage: (u) => images.has(u) && sources.isImageHost(u),
    resize: (buf) => {
      const img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) return null;
      const { width } = img.getSize();
      return (width > 640 ? img.resize({ width: 640, quality: 'good' }) : img).toJPEG(82);
    },
  });
  setTimeout(() => thumbs.prune(3000), 20000);

  const downloads = createDownloads({
    fetch, fetchPlaylist, indexFile: path.join(userDir, 'downloads.json'), folder, broadcast, trusted, lfileUrl,
    channelName: (id) => channels.info(id).name,
    onRoot: (dir) => { try { allowedRoots.add(dir); } catch {} },
  });
  noteItems(downloads.items());

  const media = createMediaProtocol({ fetch, fetchPlaylist, allow, thumbs, toVtt, lfileUrl, isInside, localRoots: () => [folder(), ...downloads.roots()], liveStream: async (id) => { const url = await live.stream(id); if (url) allow.add(url); return url; } });
  protocol.handle('media', (request) => media.handle(request).catch((e) => {
    console.error('[mediathek] media://', e);
    return new Response('Fehler', { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
  }));

  async function diagnose(url) {
    if (!/^https?:\/\//i.test(url || '')) return { kind: 'unknown', message: errors.message('unknown') };
    if (!allow.has(url)) return { kind: 'forbidden', message: errors.message('forbidden') };
    if (/\.m3u8?(\?|$)/i.test(url)) {
      try {
        const r = await fetchPlaylist(url, { timeout: 12000 });
        const kind = r.geo ? errors.classify({ status: 451, url, finalUrl: r.url }) : r.status >= 200 && r.status < 300 ? 'format' : errors.classify({ status: r.status, url, finalUrl: r.url });
        return { kind, message: errors.message(kind), status: r.status };
      } catch (e) {
        const kind = errors.classify({ status: 0, url, error: String(e && e.message || e) });
        return { kind, message: errors.message(kind), status: 0 };
      }
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('timeout')), 12000);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': mvw.UA, Range: 'bytes=0-2047' }, redirect: 'follow', signal: ctrl.signal });
      try { await res.body?.cancel(); } catch {}
      const kind = /geoprotection/i.test(res.url || '') ? errors.classify({ status: 451, url, finalUrl: res.url }) : res.ok ? 'format' : errors.classify({ status: res.status, url, finalUrl: res.url });
      return { kind, message: errors.message(kind), status: res.status };
    } catch (e) {
      const kind = errors.classify({ status: 0, url, error: String(e && e.message || e) });
      return { kind, message: errors.message(kind), status: 0 };
    } finally { clearTimeout(timer); }
  }

  const handle = (name, fn) => ipcMain.handle('mediathek:' + name, (e, ...args) => fn(...args));
  handle('query', async (opts) => {
    const o = opts || {};
    if (!o.source && !Array.isArray(o.sources)) return client.query(o);
    const r = await sources.query(o);
    noteItems(r.items);
    return r;
  });
  /** The files of an item of a source (sizes, subtitles); only addresses on the hosts of its source are passed on. */
  handle('resolve', async (item) => {
    if (!item || !item.source || !sources.get(item.source)) return item;
    const onHost = (u) => (typeof u === 'string' && sources.isMediaHost(u) ? u : null);
    const ask = { ...item, video: null, subtitle: null, collection: onHost(item.collection) };
    if (item.video && typeof item.video === 'object') {
      ask.video = {};
      for (const [k, u] of Object.entries(item.video)) if (typeof u === 'string' && sources.isMediaHost(u)) ask.video[k] = u;
    }
    const r = await sources.resolve(ask);
    noteItems([r]);
    return r;
  });
  handle('heights', async (item) => { const t = trusted(item); return t ? heights.ofItem(t) : {}; });
  handle('sourceTopics', (id) => sources.topics(String(id || '')));
  handle('variants', (item) => client.variants(item).catch(() => []));
  handle('channels', () => ({ channels: channels.CHANNELS, groups: channels.GROUPS }));
  handle('topics', (channel) => client.topics(String(channel || '')));
  handle('live', () => live.list());
  handle('liveNow', (ids) => live.current(Array.isArray(ids) ? ids : []));
  handle('diagnose', (url) => diagnose(String(url || '')));
  handle('sizes', (item) => downloads.sizes(item));
  handle('downloadOptions', (item) => downloads.options(item, (it) => heights.ofItem(it)));
  handle('favorites', () => library.favorites());
  handle('setFavorite', (item, on) => library.setFavorite(item, !!on));
  handle('progress', () => library.progressMap());
  handle('position', (item, pos, dur) => library.position(item, pos, dur));
  handle('startAt', (id) => library.startAt(String(id || '')));
  handle('continue', () => library.continueList(60));
  handle('forget', (id) => library.forget(String(id || '')));
  handle('download', (item, quality) => downloads.start(item, quality));
  handle('downloads', () => downloads.list());
  handle('pause', (id) => downloads.pause(id));
  handle('resume', (id) => downloads.resume(id));
  handle('remove', (id, opts) => downloads.remove(id, opts || {}));
  handle('playable', (id) => downloads.playable(id));
  handle('reveal', (id) => {
    const d = downloads.get(id);
    if (!d) return false;
    const f = d.status === 'done' && fs.existsSync(d.file) ? d.file : d.dir;
    if (fs.existsSync(f)) shell.showItemInFolder(f);
    return true;
  });
  handle('folder', () => ({ folder: folder(), isDefault: folder() === defaultFolder() }));
  handle('pickFolder', async () => {
    const r = await dialog.showOpenDialog(getMainWindow(), { properties: ['openDirectory', 'createDirectory'], title: 'Ordner für Mediathek-Downloads wählen', defaultPath: folder() });
    if (r.canceled || !r.filePaths[0]) return null;
    settings.set('mediathek', { ...(settings.get('mediathek') || {}), folder: r.filePaths[0] });
    allowedRoots.add(r.filePaths[0]);
    return r.filePaths[0];
  });
  handle('resetFolder', () => { settings.set('mediathek', { ...(settings.get('mediathek') || {}), folder: null }); allowedRoots.add(folder()); return folder(); });
  handle('stats', () => ({ ...media.stats, allowlist: allow.size }));

  app.on('before-quit', () => { try { downloads.shutdown(); library.flush(); heightStore.flush(); } catch {} });
  instance = { client, live, library, downloads, media, allow, sources, heights };
  return instance;
}

module.exports = { register, get instance() { return instance; } };
