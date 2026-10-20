const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...args) => ipcRenderer.invoke(ch, ...args);
const on = (ch, fn) => { const h = (e, payload) => fn(payload); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };

const api = {
  isElectron: true,
  // generic escape hatch for feature modules that register their own IPC handlers
  invoke: (channel, ...args) => invoke(channel, ...args),
  on: (channel, fn) => on(channel, fn),
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch),
    onChange: (fn) => on('settings:changed', fn),
  },
  ui: {
    // one synchronous call while the page's <head> is parsed (app/theme-boot.js): 'light' | 'sepia' | 'dark'
    themeSync: () => { try { return ipcRenderer.sendSync('ui:theme-sync'); } catch { return null; } },
  },
  library: {
    getState: () => invoke('library:state'),
    onUpdate: (fn) => on('library:update', fn),
    onBook: (fn) => on('library:book', fn),
    onScan: (fn) => on('library:scan', fn),
    rescan: () => invoke('library:rescan'),
    reindexAll: () => invoke('library:reindexAll'),
    reindex: (id) => invoke('library:reindex', id),
    addFolder: (mode) => invoke('library:addFolder', mode),
    setFolders: (folders) => invoke('library:setFolders', folders),
    book: (id) => invoke('library:book', id),
    update: (id, patch) => invoke('library:update', id, patch),
    setDepartment: (id, dep, shelf) => invoke('library:setDepartment', id, dep, shelf),
    open: (id) => invoke('library:open', id),
    borrow: (id, flag) => invoke('library:borrow', id, flag),
    history: (limit) => invoke('library:history', limit),
    addReadingTime: (id, seconds) => invoke('library:readingTime', id, seconds),
    stats: () => invoke('library:stats'),
    search: (q, opts) => invoke('library:search', q, opts),
    searchText: (q) => invoke('library:searchText', q),
    bookUrl: (id) => invoke('library:bookUrl', id),
    readText: (id) => invoke('library:readText', id),
    // v: the record's coverVersion, so that a new picture (a cover from the internet) is never taken from a cache
    coverUrl: (id, v) => `cover://${id}/${id}.jpg` + (v ? `?v=${v}` : ''),
    revealFile: (id) => invoke('library:revealFile', id),
  },
  files: {
    pickFolder: (title) => invoke('files:pickFolder', title),
    pickFile: (title, filters) => invoke('files:pickFile', title, filters),
    list: (folder, exts) => invoke('files:list', folder, exts),
    url: (absPath) => invoke('files:url', absPath),
    savePainting: (dataUrl, name) => invoke('files:savePainting', dataUrl, name),
    paintings: () => invoke('files:paintings'),
    deletePainting: (p) => invoke('files:deletePainting', p),
    exportImage: (dataUrl, suggested) => invoke('files:exportImage', dataUrl, suggested),
    readJson: (p) => invoke('files:readJson', p),
    readTextFile: (p) => invoke('files:readTextFile', p),
  },
  app: {
    quit: () => invoke('app:quit'),
    toggleFullscreen: () => invoke('app:toggleFullscreen'),
    setFullscreen: (v) => invoke('app:setFullscreen', v),
    openExternal: (url) => invoke('app:openExternal', url),
    info: () => invoke('app:info'),
    fetch: (url, opts) => invoke('app:fetch', url, opts),
    // streaming fetch (e.g. ndjson): returns stream id; chunks arrive via onStream
    streamStart: (url, opts) => invoke('app:stream:start', url, opts),
    streamStop: (id) => invoke('app:stream:stop', id),
    onStream: (fn) => on('app:stream', fn), // payload: { id, type: 'data'|'end'|'error', chunk?, error? }
    // a part of the window as a PNG data URL (the reader's diagram snip, when no page picture is at hand)
    capturePage: (rect) => invoke('app:capturePage', rect),
    // a line for <userData>/logs/renderer.log (errors of the page, the world map's check of its own picture)
    log: (entry) => invoke('app:log', entry),
    gpuInfo: () => invoke('app:gpuInfo'),
  },
  // --- feeds / news / podcasts / wikipedia / dictionary (electron/feeds) ---
  feeds: {
    list: () => invoke('feeds:list'),
    fetch: (feedId, opts) => invoke('feeds:fetch', feedId, opts),
    article: (url, feedId) => invoke('feeds:article', url, feedId),
    add: (url, category, lang) => invoke('feeds:add', url, category, lang),
    remove: (feedId) => invoke('feeds:remove', feedId),
    check: (url) => invoke('feeds:check', url),
    readState: () => invoke('feeds:readState'),
    markRead: (feedId, itemId) => invoke('feeds:markRead', feedId, itemId),
    onUpdate: (fn) => on('feeds:update', fn),
  },
  podcasts: {
    search: (term, lang) => invoke('podcasts:search', term, lang),
    curated: () => invoke('podcasts:curated'),
    subscriptions: () => invoke('podcasts:subscriptions'),
    subscribe: (feedUrl, meta) => invoke('podcasts:subscribe', feedUrl, meta),
    unsubscribe: (feedUrl) => invoke('podcasts:unsubscribe', feedUrl),
    episodes: (feedUrl) => invoke('podcasts:episodes', feedUrl),
    importOpml: () => invoke('podcasts:importOpml'),
    exportOpml: () => invoke('podcasts:exportOpml'),
    getPositions: () => invoke('podcasts:positions'),
    setPosition: (episodeId, seconds, done) => invoke('podcasts:setPosition', episodeId, seconds, done),
  },
  wiki: {
    featured: (lang, date) => invoke('wiki:featured', lang, date),
    search: (lang, q) => invoke('wiki:search', lang, q),
    page: (lang, title) => invoke('wiki:page', lang, title),
    summary: (lang, title) => invoke('wiki:summary', lang, title),
    random: (lang) => invoke('wiki:random', lang),
  },
  dict: {
    define: (word, lang) => invoke('dict:define', word, lang),
    translate: (text, from, to) => invoke('dict:translate', text, from, to),
  },
  // --- text to speech: German via Python sidecar (Kartoffelbox / Chatterbox) ---
  tts: {
    status: () => invoke('tts:status'),
    germanSpeak: (text, opts) => invoke('tts:german', text, opts),
    setup: () => invoke('tts:setup'),
    start: () => invoke('tts:start'),
    stop: () => invoke('tts:stop'),
    pickPrompt: () => invoke('tts:pickPrompt'),
    onStatus: (fn) => on('tts:status', fn),
  },
};

contextBridge.exposeInMainWorld('api', api);
