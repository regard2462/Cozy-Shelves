// The backend of the browser version: the window.api of electron/preload.js, built in the page itself.
// app/src/main-web.js installs it before app/src/main.js runs, so core/api.js and every panel see the same surface as on
// the desktop. What the browser cannot do is listed in `features` (core/platform.js has()) and the panels hide it:
//   settings            IndexedDB (idb.js WebStore), the same defaults and migrations as settings.json
//   library             web/web-library.js: a folder picked with the File System Access API (Chromium) or the
//                       webkitdirectory input (Firefox, Safari), covers from the books, everything in IndexedDB
//   files               paintings of the easel in IndexedDB; pictures through the file picker; no folders
//   app                 fetch with CORS (the hosts that allow it), streams (Lichess), full screen, no quit
//   wiki, dict          electron/feeds/wiki.js and dict.js themselves, on the browser's fetch (web/common-web.js)
//   feeds, podcasts, catalog, mediathek, audiobooks, fulltext, covers, tts sidecar: not here (no CORS, no proxy,
//                       no node:sqlite, no language models)
import { DEFAULTS, migrateSettings, deepMerge, PHONE_GRAPHICS, migratePhoneGraphics } from '../../../electron/settings-defaults.js';
import * as wiki from '../../../electron/feeds/wiki.js';
import * as dict from '../../../electron/feeds/dict.js';
import { idb, WebStore } from '../web/idb.js';
import { WebLibrary } from '../web/web-library.js';
import { sourceFromHandle, sourceFromFiles, sourceFromBridge, bridgeFolderPicked, bridge } from '../web/web-files.js';

// the version is written in by build/web.js
const VERSION = typeof COZYSHELVES_VERSION !== 'undefined' ? COZYSHELVES_VERSION : 'web';
// the Android app (android/): the same page with window.AndroidBooks for the folders, the links and the screen
const ANDROID = !!bridge();

/** What the browser version leaves out (core/platform.js has(feature)). */
export const WEB_FEATURES = {
  feeds: false, podcasts: false, catalog: false, mediathek: false, browser: false, audiobooks: false, fulltext: false,
  webCovers: false, quit: false, revealFile: false, pickFolder: false, musicFolder: false, paintingsFolder: false,
  ttsDownloads: false, streetview: false, gpuLog: false,
};
const UNAVAILABLE = () => new Error('Nur in der Cozy-Shelves-App für den Desktop / Only in the Cozy Shelves desktop app');

/** A phone or a tablet (a touch screen, the Android app, a small screen): it starts with the quality 'mobile'. */
function phoneLike() {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
  const small = Math.min(screen?.width || 1920, screen?.height || 1080) < 900;
  return ANDROID || coarse || small || /Android|iPhone|iPad/i.test(navigator.userAgent);
}
/** Nothing before this fits a phone: the first start on a touch screen or a small browser lowers the graphics. */
function freshProfileOverrides() {
  const o = { fulltext: { enabled: false }, webCovers: false, webMetadata: false, firstRun: true };
  if (phoneLike()) o.graphics = { ...PHONE_GRAPHICS };
  else o.graphics = { quality: 'medium', ssao: false, godrays: false };
  return o;
}

export async function installWebApi() {
  const listeners = new Map();
  const on = (ch) => (fn) => { if (!listeners.has(ch)) listeners.set(ch, new Set()); listeners.get(ch).add(fn); return () => listeners.get(ch)?.delete(fn); };
  const emit = (ch, p) => { for (const fn of [...(listeners.get(ch) || [])]) { try { fn(p); } catch (e) { console.error('[api-web]', ch, e); } } };

  // ---- settings --------------------------------------------------------------------------------------------------
  const settings = new WebStore('settings', DEFAULTS);
  const fresh = (await idb.get('kv', 'settings')) === undefined;
  await settings.load();
  if (fresh) deepMerge(settings.data, freshProfileOverrides());
  // (a fresh profile is marked as migrated: it has the defaults of this version)
  if (fresh) settings.data.graphics.tierSchema = 1;
  const phoneMigrated = migratePhoneGraphics(settings.data, phoneLike());
  if (migrateSettings(settings.data) || fresh || phoneMigrated) settings.save();
  // the appearance is read by app/theme-boot.js from localStorage before the page is drawn (no sync IPC here)
  try { localStorage.setItem('lesesaal.theme', settings.data?.ui?.theme || 'sepia'); } catch {}

  // ---- library ---------------------------------------------------------------------------------------------------
  const lib = new WebLibrary({ settings, emit });
  await lib.ready;
  const L = (fn) => async (...a) => { await lib.ready; return fn(...a); };
  const library = {
    getState: L(() => lib.getState()),
    onUpdate: on('library:update'), onBook: on('library:book'), onScan: on('library:scan'),
    rescan: L(() => { lib.scanAll(); return true; }),
    reindexAll: L(() => { lib.reindexAll(); return true; }),
    reindex: L((id) => { lib.reindex(id); return true; }),
    addFolder: L((mode) => lib.addFolder(mode)),
    setFolders: L((folders) => lib.setFolders(folders)),
    book: L((id) => lib.getBook(id)),
    update: L((id, patch) => lib.updateBook(id, patch)),
    setDepartment: L((id, dep, shelf) => lib.setDepartment(id, dep, shelf)),
    open: L((id) => lib.openBook(id)),
    borrow: L((id, flag) => lib.borrow(id, flag)),
    history: L((limit) => lib.history(limit)),
    addReadingTime: L((id, s) => lib.addReadingTime(id, s)),
    stats: L(() => lib.getStats()),
    search: L((q, opts) => lib.search(q, opts)),
    searchText: L((q) => lib.searchText(q)),
    bookUrl: L((id) => lib.bookUrl(id)),
    readText: L((id) => lib.readText(id)),
    coverUrl: (id) => lib.coverUrl(id),
    revealFile: async () => { throw UNAVAILABLE(); },
  };

  // ---- files: the paintings of the easel, pictures from the file picker -------------------------------------------
  const pickImageFile = (accept = 'image/*') => new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0';
    let done = false;
    const finish = (f) => { if (done) return; done = true; input.remove(); window.removeEventListener('focus', onFocus); resolve(f ? URL.createObjectURL(f) : null); };
    const onFocus = () => setTimeout(() => { if (!done && !input.files?.length) finish(null); }, 800);
    input.addEventListener('change', () => finish(input.files?.[0] || null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    window.addEventListener('focus', onFocus);
    input.click();
  });
  const download = (dataUrl, name) => {
    const a = document.createElement('a');
    a.href = dataUrl; a.download = name || 'bild.png'; a.style.display = 'none';
    document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 1000);
    return name || 'bild.png';
  };
  const files = {
    pickFolder: async () => null,
    pickFile: async (title, filters) => pickImageFile((filters || []).some((f) => (f.extensions || []).includes('png')) ? 'image/*' : '*/*'),
    list: async () => [],
    url: async (p) => p,
    savePainting: async (dataUrl, name) => {
      // letters of every script stay: the gallery shows the file name as the title
      const file = String(name || 'aquarell-' + Date.now()).replace(/[^\p{L}\p{N}.-]+/gu, '_') + '.png';
      await idb.put('paintings', file, { name: file, dataUrl, mtime: Date.now() });
      return { path: file, url: dataUrl };
    },
    paintings: async () => {
      const list = (await idb.getAll('paintings')) || [];
      return list.filter((p) => p && p.dataUrl).map((p) => ({ path: p.name, name: p.name, url: p.dataUrl, mtime: p.mtime || 0 })).sort((a, b) => b.mtime - a.mtime);
    },
    deletePainting: async (p) => { if (typeof p === 'string') await idb.del('paintings', p); return true; },
    exportImage: async (dataUrl, suggested) => download(dataUrl, suggested || 'bild.png'),
    readJson: async () => null,
    readTextFile: async () => null,
  };

  // ---- app -------------------------------------------------------------------------------------------------------
  const isWebUrl = (u) => /^https?:\/\//i.test(String(u || ''));
  const streams = new Map();
  const app = {
    quit: async () => { if (ANDROID) { bridge().exit(); return; } throw UNAVAILABLE(); },
    // the Android app is full screen by itself (immersive); a browser toggles the Fullscreen API
    toggleFullscreen: async () => { if (ANDROID) return true; try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch (e) { console.warn('[api-web] fullscreen', e?.message || e); } return !!document.fullscreenElement; },
    setFullscreen: async (v) => { if (ANDROID) return true; try { if (v && !document.fullscreenElement) await document.documentElement.requestFullscreen(); else if (!v && document.fullscreenElement) await document.exitFullscreen(); } catch {} return !!document.fullscreenElement; },
    // a link to the outside: the system's browser (window.open does nothing in the WebView)
    openExternal: async (url) => { if (!isWebUrl(url)) return; if (ANDROID) bridge().openExternal(String(url)); else window.open(url, '_blank', 'noopener'); },
    info: async () => ({ version: VERSION, platform: ANDROID ? 'android' : 'web', web: true, android: ANDROID, hidden: false, isDev: false, userAgent: navigator.userAgent, secure: window.isSecureContext }),
    // the same shape as the desktop's proxy; only hosts that allow CORS answer here
    fetch: async (url, opts) => {
      if (!isWebUrl(url)) return { ok: false, status: 0, error: 'Nur http(s)-Adressen sind erlaubt' };
      try {
        const res = await fetch(url, { method: opts?.method || 'GET', headers: opts?.headers || {}, body: opts?.body });
        const ct = res.headers.get('content-type') || '';
        if (opts?.binary) { const buf = new Uint8Array(await res.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return { ok: res.ok, status: res.status, contentType: ct, base64: btoa(bin) }; }
        return { ok: res.ok, status: res.status, contentType: ct, text: await res.text(), url: res.url };
      } catch (err) { return { ok: false, status: 0, error: err.message }; }
    },
    streamStart: async (url, opts) => {
      if (!isWebUrl(url)) throw new Error('Nur http(s)-Adressen sind erlaubt');
      const id = 's' + Date.now() + Math.random().toString(36).slice(2, 7);
      const ctrl = new AbortController();
      streams.set(id, ctrl);
      (async () => {
        try {
          const res = await fetch(url, { headers: { Accept: 'application/x-ndjson', ...(opts?.headers || {}) }, signal: ctrl.signal });
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          for (;;) { const { value, done } = await reader.read(); if (done) break; emit('app:stream', { id, type: 'data', chunk: dec.decode(value, { stream: true }) }); }
          emit('app:stream', { id, type: 'end' });
        } catch (err) { if (!ctrl.signal.aborted) emit('app:stream', { id, type: 'error', error: err.message }); }
        streams.delete(id);
      })();
      return id;
    },
    streamStop: async (id) => { streams.get(id)?.abort(); streams.delete(id); return true; },
    onStream: on('app:stream'),
    capturePage: async () => null,
    log: async (entry) => { logLines.push({ t: Date.now(), ...entry }); if (logLines.length > 50) logLines.shift(); },
    gpuInfo: async () => null,
  };
  const logLines = [];

  // ---- wiki and dictionary: the desktop's handlers, on the browser's fetch ----------------------------------------
  const handlers = new Map();
  const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn), on: () => {} };
  const fakeApp = { getPath: () => 'web', getVersion: () => VERSION };
  try { wiki.register({ ipcMain, app: fakeApp }); } catch (e) { console.warn('[api-web] wiki', e); }
  try { dict.register({ ipcMain, app: fakeApp, settings: { get: (k) => settings.get(k) } }); } catch (e) { console.warn('[api-web] dict', e); }
  // the few other channels the panels call directly
  handlers.set('library:markRead', async (e, id, read) => { await lib.ready; return lib.markRead(id, read); });
  // the browser version: a folder's permission once more, or the folder picked again (a button in the menu)
  handlers.set('web:reopen', async (e, id) => { await lib.ready; return lib.reopen(id); });
  handlers.set('fulltext:status', async () => ({ enabled: false, total: 0, done: 0, notext: 0, errors: 0, bytes: 0, running: false, paused: 'off', current: null, web: true }));
  handlers.set('fulltext:search', async (e, { q } = {}) => ({ ok: false, q, books: [], totalBooks: 0, totalHits: 0, error: 'Nur in der Cozy-Shelves-App für den Desktop / Only in the Cozy Shelves desktop app' }));
  handlers.set('fulltext:activity', async () => true);
  handlers.set('audiobooks:state', async () => ({ folders: [], books: [], scan: { active: false, phase: 'idle', done: 0, total: 0, unavailable: [] } }));
  handlers.set('pad:mouse', async () => false);
  const invoke = async (ch, ...args) => {
    const fn = handlers.get(ch);
    if (!fn) throw new Error(`${ch}: ${UNAVAILABLE().message}`);
    return fn(null, ...args);
  };
  const viaInvoke = (ch) => (...a) => invoke(ch, ...a);
  const unavailable = (names) => Object.fromEntries(names.map((n) => [n, async () => { throw UNAVAILABLE(); }]));

  const api = {
    isElectron: false, platform: ANDROID ? 'android' : 'web', web: true, android: ANDROID, features: WEB_FEATURES, version: VERSION,
    invoke, on: (ch, fn) => on(ch)(fn),
    settings: {
      get: async () => settings.get(),
      set: async (patch) => { deepMerge(settings.data, patch || {}); settings.save(); emit('settings:changed', settings.get()); return settings.get(); },
      onChange: on('settings:changed'),
    },
    ui: { themeSync: () => { try { return settings.get()?.ui?.theme || null; } catch { return null; } } },
    library, files, app,
    feeds: { ...unavailable(['list', 'fetch', 'article', 'add', 'remove', 'check', 'readState', 'markRead']), list: async () => [], readState: async () => ({}), onUpdate: on('feeds:update') },
    podcasts: { ...unavailable(['search', 'curated', 'subscribe', 'unsubscribe', 'episodes', 'importOpml', 'exportOpml']), subscriptions: async () => [], getPositions: async () => ({}), setPosition: async () => {} },
    wiki: { featured: viaInvoke('wiki:featured'), search: viaInvoke('wiki:search'), page: viaInvoke('wiki:page'), summary: viaInvoke('wiki:summary'), random: viaInvoke('wiki:random') },
    dict: { define: viaInvoke('dict:define'), translate: viaInvoke('dict:translate') },
    catalog: { invoke: async () => { throw UNAVAILABLE(); }, on: () => () => {} },
    tts: { status: async () => ({ available: false, running: false, starting: false, web: true }), germanSpeak: async () => { throw UNAVAILABLE(); }, setup: async () => ({ ok: false, reason: 'web' }), start: async () => ({ available: false }), stop: async () => ({ available: false }), pickPrompt: async () => null, onStatus: on('tts:status') },
  };
  window.api = api;
  // the test hooks of build/scripts/web-check.js: a folder from a handle (the OPFS) or a FileList, and a flush before a
  // reload; androidFolder is the answer of the app's folder picker (MainActivity.kt deliverPick), and in debug builds a
  // folder handed over by the check (DebugHooks.kt USE_FOLDER): without a waiting pick it is added as a new source
  window.__cozyshelvesWeb = {
    library: lib, settings, idb, log: logLines, version: VERSION, android: ANDROID,
    useHandle: (handle, mode = 'structured') => lib.addSource(sourceFromHandle(handle, { mode })),
    useFiles: (fileList, mode = 'structured') => lib.addSource(sourceFromFiles(fileList, { mode })),
    androidFolder: (result) => {
      if (bridgeFolderPicked(result)) return true;
      if (!result?.key) return false;
      lib.ready.then(() => lib.addSource(sourceFromBridge({ key: String(result.key), name: String(result.name || 'Bücher'), mode: result.mode || 'structured' })))
        .catch((e) => console.warn('[api-web] androidFolder', e));
      return true;
    },
    reopen: (id) => lib.reopen(id),
    flush: () => lib.flush(),
  };
  return api;
}
