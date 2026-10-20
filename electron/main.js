const { app, BrowserWindow, protocol, net, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { getSettings, deepMerge, themeOf, THEME_BG, THEMES } = require('./settings');
const { Library } = require('./library/library');

const APP_DIR = path.normalize(path.join(__dirname, '..', 'app'));
const isDev = !app.isPackaged;

// Until 0.7.2 the program was called Lesesaal, from 0.8.0 to 0.9.2 Cozystacks. The data folder of the newest former
// name that holds data (settings, library, covers, reading positions and the stores of the pages behind
// app://lesesaal) stays in use as long as the folder under the new name holds none, so an update keeps everything
// (electron/data-folder.js). A folder given with --user-data-dir (test runs) is left alone.
try {
  const dir = require('./data-folder').dataFolder({ given: app.commandLine.hasSwitch('user-data-dir'), current: app.getPath('userData'), appData: app.getPath('appData') });
  if (dir !== app.getPath('userData')) app.setPath('userData', dir);
} catch (e) { console.error('[main] data folder', e); }
/** Partition of the in-app reading browser (app/src/ui/browser/browser-panel.js). */
const BROWSER_PARTITION = 'persist:lesesaal-browser';

// Content-Security-Policy for the app's own pages (app://). It must allow the WASM workers
// (three.js, stockfish, kokoro) and remote cover images, but nothing may be evaluated from a string,
// and the only frames allowed are the <webview> of the browser panel.
// Two policies: the documents (index.html, indexer.html, fulltext.html and the blob: iframes of the books, which inherit
// the policy of their document) get no blob: scripts. foliate-js renders every section of a book in an iframe of the
// app's own origin with allow-scripts and hands every resource of the book to it as a blob: URL, scripts included; its
// README asks for a policy that allows nothing but 'self'. With blob: allowed, a book's script ran inside the app and
// reached window.api through its parent window (build/scripts/epub-script-check.js). The workers (their policy comes
// with their own script's response) keep blob: scripts: Kokoro's onnxruntime imports its WebAssembly glue as a blob: module.
const cspFor = ({ blobScripts }) => [
  "default-src 'self' app:",
  `script-src 'self' app: ${blobScripts ? 'blob: ' : ''}'wasm-unsafe-eval'`,
  // blob: carries the stylesheets and embedded fonts of an EPUB: foliate-js hands every resource of a book to its
  // section document as a blob: URL (without it poems lose their line breaks and wide pictures overflow)
  "style-src 'self' app: blob: 'unsafe-inline'",
  // img: is the feeds module's image proxy (electron/feeds/feeds.js)
  "img-src 'self' app: book: cover: lfile: img: media: data: blob: https: http:",
  // media: is the Mediathek proxy (electron/mediathek) – it keeps every film CORS-clean for the projection screen
  "media-src 'self' app: book: cover: lfile: img: media: data: blob: https: http:",
  "font-src 'self' app: data: blob:",
  "connect-src 'self' app: book: cover: lfile: img: media: data: blob: https: http: ws: wss:",
  "worker-src 'self' app: blob:",
  // foliate-js renders every book section in a blob: iframe - without blob: the reader stays empty
  "frame-src 'self' app: blob: https: http:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');
const CSP_DOCUMENT = cspFor({ blobScripts: false }), CSP_WORKER = cspFor({ blobScripts: true });

// --- custom schemes ---------------------------------------------------------
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, allowServiceWorkers: true } },
  { scheme: 'book', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: true } },
  { scheme: 'cover', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: true } },
  { scheme: 'lfile', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: true } },
  // article images are proxied through img:// by electron/feeds/feeds.js
  { scheme: 'img', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  // films of the Mediathek are proxied through media:// (electron/mediathek) – Range requests, CORS headers
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let mainWin = null;
let indexerWin = null;
let settings, library;
const allowedRoots = new Set();

const MIME = { '.html': 'text/html', '.htm': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.opus': 'audio/ogg', '.pdf': 'application/pdf', '.epub': 'application/epub+zip', '.txt': 'text/plain', '.md': 'text/markdown', '.xml': 'application/xml', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.mp4': 'video/mp4', '.webm': 'video/webm' };
const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

function corsHeaders(extra = {}) {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Expose-Headers': '*', 'Cache-Control': 'no-cache', ...extra };
}

const fail = (status, msg) => new Response(msg || 'Not found', { status, headers: corsHeaders() });

/** Serve a local file with Range support (seeking in audio/video and in large PDFs needs 206). */
function serveFile(filePath, request) {
  let stat;
  try {
    if (!filePath) return fail(404);
    stat = fs.statSync(filePath);
    if (!stat.isFile()) return fail(404);
  } catch { return fail(404); }
  const headers = new Headers(corsHeaders({ 'Content-Type': mimeOf(filePath), 'Accept-Ranges': 'bytes' }));
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers?.get?.('Range') || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? parseInt(range[1], 10) : null;
    let end = range[2] ? parseInt(range[2], 10) : null;
    if (start == null) { start = Math.max(0, stat.size - (end || 0)); end = stat.size - 1; }     // "bytes=-500"
    if (end == null || end >= stat.size) end = stat.size - 1;
    if (!(start >= 0) || start > end) return new Response(null, { status: 416, headers: new Headers(corsHeaders({ 'Content-Range': `bytes */${stat.size}` })) });
    headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    headers.set('Content-Length', String(end - start + 1));
    return new Response(Readable.toWeb(fs.createReadStream(filePath, { start, end })), { status: 206, headers });
  }
  headers.set('Content-Length', String(stat.size));
  return new Response(Readable.toWeb(fs.createReadStream(filePath)), { status: 200, headers });
}

/** true when `p` lies inside `root` (and not merely shares its prefix: /books vs /books-private). */
function isInside(p, root) {
  const a = path.normalize(p), b = path.normalize(root);
  const rel = path.relative(b, a);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
const inAllowedRoot = (p) => [...allowedRoots].some((r) => { try { return isInside(p, r); } catch { return false; } });

function registerProtocols() {
  protocol.handle('app', (request) => {
    let rel;
    try { rel = decodeURIComponent(new URL(request.url).pathname); } catch { return fail(400, 'Bad request'); }
    if (rel === '/' || rel === '') rel = '/index.html';
    if (rel.includes('\0')) return fail(400, 'Bad request');
    // path traversal: join+normalize first, then verify the result is really inside app/
    const file = path.normalize(path.join(APP_DIR, rel));
    if (!isInside(file, APP_DIR)) return fail(403, 'Forbidden');
    return serveFile(file, request);
  });
  protocol.handle('book', (request) => {
    const id = idFromUrl(request.url);
    if (!id) return fail(400, 'Bad request');
    let p = null;
    try { p = library?.getBookPath(id) || null; } catch {}
    return serveFile(p, request);
  });
  protocol.handle('cover', (request) => {
    const id = (idFromUrl(request.url) || '').replace(/\.jpg$/i, '');
    if (!id) return fail(400, 'Bad request');
    let p = null;
    try { p = library ? library.coverPath(id) : null; } catch {}
    return serveFile(p, request);
  });
  protocol.handle('lfile', (request) => {
    // lfile://local/<base64url of absolute path>   (restricted to allowed roots)
    let enc;
    try { enc = new URL(request.url).pathname.split('/').filter(Boolean)[0] || ''; } catch { return fail(400, 'Bad'); }
    let p;
    try { p = Buffer.from(enc, 'base64url').toString('utf8'); } catch { return fail(400, 'Bad'); }
    if (!p || p.includes('\0')) return fail(400, 'Bad');
    p = path.normalize(p);
    if (!inAllowedRoot(p)) return fail(403, 'Forbidden');
    return serveFile(p, request);
  });
}

/** Only real web addresses may be fetched on behalf of the renderer. */
function isWebUrl(u) {
  try { const p = new URL(String(u)).protocol; return p === 'http:' || p === 'https:'; } catch { return false; }
}

/** book://<id>/<name> and cover://<id>/<id>.jpg – tolerant of malformed URLs. */
function idFromUrl(raw) {
  try {
    const url = new URL(raw);
    const id = url.hostname || url.pathname.split('/').filter(Boolean)[0] || '';
    return /^[\w-]{1,64}$/.test(id) ? id : null;
  } catch { return null; }
}

function lfileUrl(absPath) {
  allowedRoots.add(path.dirname(absPath));
  return `lfile://local/${Buffer.from(absPath, 'utf8').toString('base64url')}/${encodeURIComponent(path.basename(absPath))}`;
}

// --- windows ----------------------------------------------------------------
function createMainWindow() {
  const s = settings.get();
  // Automated test runs (build/screenshot.js sets COZYSHELVES_HIDDEN) must not pop up on the developer's
  // desktop: the window is placed left of every display, has no taskbar button and never takes focus.
  const hidden = !!process.env.COZYSHELVES_HIDDEN;
  let hiddenPos = {};
  if (hidden) {
    const { screen } = require('electron');
    const minX = Math.min(0, ...screen.getAllDisplays().map((d) => d.bounds.x));
    hiddenPos = { x: minX - 1600 - 400, y: 0, skipTaskbar: true, fullscreenable: false };
  }
  // the window background matches the appearance (Hell, Sepia, Dunkel): no bright flash before the first paint
  const queryTheme = new URLSearchParams(process.env.COZYSHELVES_QUERY || '').get('theme');
  const theme = THEMES.includes(queryTheme) ? queryTheme : themeOf(s);
  mainWin = new BrowserWindow({
    ...hiddenPos,
    width: 1600, height: 900, minWidth: 1024, minHeight: 640,
    title: 'Cozy Shelves', backgroundColor: THEME_BG[theme], show: false,
    fullscreen: !hidden && !!s.window?.fullscreen, autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false,
      webgl: true, backgroundThrottling: false, spellcheck: false,
      webviewTag: true,   // the in-app reading browser; every guest is locked down in will-attach-webview
    },
  });
  mainWin.once('ready-to-show', () => { if (hidden) mainWin.showInactive(); else mainWin.show(); });
  mainWin.loadURL('app://lesesaal/index.html' + (process.env.COZYSHELVES_QUERY ? '?' + process.env.COZYSHELVES_QUERY : ''));
  // closing the window ends the app: the hidden indexer window would keep the process alive otherwise, invisible, holding
  // the single-instance lock, and every later start ended at once (0.5 and 0.6.0 stayed in the background like that)
  mainWin.on('closed', () => { mainWin = null; if (!app.isQuitting) app.quit(); });
  // no second window is ever opened: links from the app go to the in-app browser panel, and the guest
  // pages inside it may not pop anything up at all
  // window.open / target=_blank in the app: shown in the in-app reading browser (the explicit
  // "Im Systembrowser öffnen" buttons use app:openExternal instead)
  mainWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) broadcast('browser:open', url); return { action: 'deny' }; });
  // a link inside a book iframe must never replace the application window itself
  mainWin.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) e.preventDefault(); });
  hardenWebviews(mainWin.webContents);
  // the side buttons of a mouse arrive on Windows as app commands: back and forward inside the open panel
  mainWin.on('app-command', (e, cmd) => {
    if (cmd === 'browser-backward' || cmd === 'browser-forward') broadcast('app:nav', cmd === 'browser-backward' ? -1 : 1);
  });
  mainWin.on('enter-full-screen', () => settings.set({ window: { ...settings.get('window'), fullscreen: true } }));
  mainWin.on('leave-full-screen', () => settings.set({ window: { ...settings.get('window'), fullscreen: false } }));
  if (isDev && process.env.COZYSHELVES_DEVTOOLS) mainWin.webContents.openDevTools({ mode: 'detach' });
}

/** Everything the <webview> of the browser panel is allowed to be: no node, no preload, sandboxed,
 *  own partition, no popup windows, no permissions. The renderer cannot loosen any of this. */
function hardenWebviews(contents) {
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    delete webPreferences.preloadURL;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webviewTag = false;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    webPreferences.experimentalFeatures = false;
    // Electron derives the guest's preferences from `params` before this event, so the values that matter
    // are set on webPreferences (params are kept in sync for the record).
    webPreferences.partition = BROWSER_PARTITION;
    params.partition = BROWSER_PARTITION;
    // Popups reach the window-open handler below, which denies every window. With popups disabled Chromium
    // drops them before the handler runs, and links with target="_blank" do nothing at all.
    webPreferences.disablePopups = false;
    params.allowpopups = true;
    if (params.src && !/^https?:\/\//i.test(params.src)) event.preventDefault();
  });
  contents.on('did-attach-webview', (e, guest) => {
    guest.setWindowOpenHandler(({ url, disposition }) => {
      // "open in a new window" inside a page never creates a window: the reading browser opens a tab for it
      // (electron/browser, event 'browser:popup'); without a main window it stays a navigation in the same view
      if (/^https?:/i.test(url)) {
        if (mainWin && !mainWin.isDestroyed()) broadcast('browser:popup', { id: guest.id, url, disposition: String(disposition || '') });
        else { try { guest.loadURL(url); } catch {} }
      }
      return { action: 'deny' };
    });
    guest.on('will-navigate', (ev, url) => { if (!/^https?:\/\//i.test(url)) ev.preventDefault(); });
  });
}

function createIndexerWindow() {
  indexerWin = new BrowserWindow({
    width: 900, height: 900, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload-indexer.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, offscreen: false, backgroundThrottling: false },
  });
  indexerWin.loadURL('app://lesesaal/indexer.html');
  indexerWin.on('closed', () => { indexerWin = null; indexerReady = false; });
  // The page died (out of memory on a broken PDF, a crash of Chromium). Without this the window stayed with its dead page:
  // every later book ran into the index timeout (a minute and more each) and was given up after three of them, and the
  // covers from the internet had no decoder any more. The book being read counts as a failed try (it is read again,
  // three times at most), and the page is loaded again; it says indexer:ready when it is back.
  indexerWin.webContents.on('render-process-gone', (_e, d) => {
    indexerReady = false;
    note('renderer.log', { kind: 'indexer-gone', reason: d?.reason, exitCode: d?.exitCode }, 256);
    try { library?.indexerGone(d?.reason); } catch (e) { console.error('[main] indexer gone', e); }
    if (!app.isQuitting && indexerWin && !indexerWin.isDestroyed()) setTimeout(() => { try { if (!app.isQuitting && indexerWin && !indexerWin.isDestroyed()) indexerWin.webContents.reload(); } catch (e) { console.error('[main] indexer reload', e); } }, 500);
  });
}

/** CSP for our own pages + a strict permission policy for the app and for the browser guests. */
function hardenSessions() {
  const own = session.defaultSession;
  // OpenStreetMap's tile servers ask every application to send its own User-Agent (tile usage policy): the world
  // map's tiles go out as Cozy Shelves, not as the Chromium inside it
  own.webRequest.onBeforeSendHeaders({ urls: ['https://tile.openstreetmap.org/*'] }, (details, cb) => {
    details.requestHeaders['User-Agent'] = `CozyShelves/${app.getVersion()} (walkable 3D library)`;
    cb({ requestHeaders: details.requestHeaders });
  });
  own.webRequest.onHeadersReceived((details, cb) => {
    if (!/^app:\/\//i.test(details.url || '')) return cb({});
    const headers = { ...details.responseHeaders };
    for (const k of Object.keys(headers)) if (/^content-security-policy$/i.test(k)) delete headers[k];
    // a document (and with it the blob: iframes of the books) gets the policy without blob: scripts, see cspFor
    const document = details.resourceType === 'mainFrame' || details.resourceType === 'subFrame';
    headers['Content-Security-Policy'] = [document ? CSP_DOCUMENT : CSP_WORKER];
    headers['X-Content-Type-Options'] = ['nosniff'];
    cb({ responseHeaders: headers });
  });
  // the app's own pages may capture the mouse (looking around), go full screen and write the clipboard;
  // everything else is denied (electron/permissions.js). Hidden test windows never go full screen.
  require('./permissions').applyAppPermissions(own, { fullscreen: !process.env.COZYSHELVES_HIDDEN });

  // the in-app browser: full screen on request (a film, Street View) and nothing else, no device access and no
  // downloads started by the page; hidden test windows never go full screen
  const guests = session.fromPartition(BROWSER_PARTITION);
  require('./permissions').applyGuestPermissions(guests, { fullscreen: !process.env.COZYSHELVES_HIDDEN });
  guests.on('will-download', (e) => e.preventDefault());
}

function broadcast(channel, payload) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload);
}

// --- IPC --------------------------------------------------------------------
function registerIpc() {
  // settings
  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.handle('settings:set', (e, patch) => {
    const d = settings.get();
    const before = themeOf(d);
    deepMerge(d, patch); settings.set(d);
    const theme = themeOf(d);
    if (theme !== before && mainWin && !mainWin.isDestroyed()) { try { mainWin.setBackgroundColor(THEME_BG[theme]); } catch {} }
    broadcast('settings:changed', d);
    return d;
  });
  // app/theme-boot.js asks synchronously while <head> is parsed: the appearance is set before the first paint
  ipcMain.on('ui:theme-sync', (e) => { try { e.returnValue = themeOf(settings.get()); } catch { e.returnValue = null; } });

  // library
  ipcMain.handle('library:state', () => library.getState());
  ipcMain.handle('library:rescan', () => { library.scanAll(); return true; });
  ipcMain.handle('library:reindexAll', () => { library.reindexAll(); return true; });
  ipcMain.handle('library:reindex', (e, id) => { library.reindex(id); return true; });
  ipcMain.handle('library:addFolder', async (e, mode) => {
    const r = await dialog.showOpenDialog(mainWin, { properties: ['openDirectory'], title: settings.get('language') === 'en' ? 'Choose a folder with books' : 'Ordner mit Büchern wählen' });
    if (r.canceled || !r.filePaths[0]) return null;
    const folders = settings.get('folders') || [];
    if (!folders.some((f) => f.path === r.filePaths[0])) folders.push({ path: r.filePaths[0], mode: mode || 'auto' });
    settings.set('folders', folders);
    allowedRoots.add(r.filePaths[0]);   // a folder added at runtime must be servable at once (covers, html books)
    library.scanAll();
    return folders;
  });
  ipcMain.handle('library:setFolders', (e, folders) => {
    settings.set('folders', folders);
    for (const f of folders || []) if (f && f.path) allowedRoots.add(f.path);
    library.scanAll();
    return folders;
  });
  ipcMain.handle('library:book', (e, id) => library.getBook(id));
  ipcMain.handle('library:update', (e, id, patch) => library.updateBook(id, patch));
  ipcMain.handle('library:setDepartment', (e, id, dep, shelf) => library.setDepartment(id, dep, shelf));
  ipcMain.handle('library:open', (e, id) => library.openBook(id));
  ipcMain.handle('library:borrow', (e, id, flag) => library.borrow(id, flag));
  ipcMain.handle('library:history', (e, limit) => library.history(limit));
  ipcMain.handle('library:readingTime', (e, id, seconds) => library.addReadingTime(id, seconds));
  ipcMain.handle('library:stats', () => library.getStats());
  // "Als gelesen markieren" / "Als ungelesen markieren" (the book card, C on a book; api.invoke)
  ipcMain.handle('library:markRead', (e, id, read) => library.markRead(id, read));
  ipcMain.handle('library:search', (e, q, opts) => library.search(q, opts));
  ipcMain.handle('library:searchText', (e, q) => library.searchText(q));
  ipcMain.handle('library:bookUrl', (e, id) => {
    const p = library.getBookPath(id);
    if (!p) return null;
    const b = library.getBook(id);
    // HTML books are served through lfile so that relative resources resolve
    if (b.format === 'html') return lfileUrl(p);
    return `book://${id}/${encodeURIComponent(path.basename(p))}`;
  });
  const BINARY_FORMATS = new Set(['epub', 'pdf', 'mobi', 'azw', 'azw3', 'cbz', 'cbr', 'djvu', 'zip', 'doc', 'odt', 'jpg', 'png']);
  ipcMain.handle('library:readText', async (e, id) => {
    const p = library.getBookPath(id);
    const b = library.getBook(id);
    if (!p || !b) return null;
    if (b.format === 'docx') {
      const mammoth = require('mammoth');
      const r = await mammoth.convertToHtml({ path: p });
      return { html: r.value, title: b.title };
    }
    if (b.format === 'rtf') {
      // a real RTF reader: umlauts arrive as \'fc or \u252 escapes, tables and fields are no text
      const { rtfToText } = require('./library/textformats');
      return { text: rtfToText(fs.readFileSync(p, 'latin1')).text, title: b.title };
    }
    // never hand a binary (epub/pdf/cbz …) to the reader as if it were UTF-8 text – those formats are
    // opened through book:// + foliate-js; a mis-detected one used to arrive as a wall of mojibake
    if (BINARY_FORMATS.has(String(b.format || '').toLowerCase())) return null;
    const buf = fs.readFileSync(p);
    if (buf.subarray(0, 4096).includes(0)) return null;
    const text = buf.toString('utf8');
    if (b.format === 'md') { const { marked } = require('marked'); return { html: marked.parse(text), title: b.title }; }
    return { text, title: b.title };
  });
  ipcMain.handle('library:revealFile', (e, id) => { const p = library.getBookPath(id); if (p) shell.showItemInFolder(p); });

  // indexer results
  ipcMain.handle('indexer:result', (e, id, result) => { library.onIndexResult(id, result); return true; });

  // files: images / music folders and saved paintings
  // a folder/file the user picked in the system dialog is theirs to use → it becomes servable
  ipcMain.handle('files:pickFolder', async (e, title) => {
    const r = await dialog.showOpenDialog(mainWin, { properties: ['openDirectory'], title: title || 'Ordner wählen' });
    if (r.canceled || !r.filePaths[0]) return null;
    allowedRoots.add(r.filePaths[0]);
    return r.filePaths[0];
  });
  ipcMain.handle('files:pickFile', async (e, title, filters) => {
    const r = await dialog.showOpenDialog(mainWin, { properties: ['openFile'], title: title || 'Datei wählen', filters: filters || [] });
    if (r.canceled || !r.filePaths[0]) return null;
    allowedRoots.add(path.dirname(r.filePaths[0]));
    return r.filePaths[0];
  });
  ipcMain.handle('files:list', (e, folder, exts) => {
    if (!folder || !fs.existsSync(folder)) return [];
    allowedRoots.add(folder);
    const wanted = new Set((exts || []).map((x) => x.toLowerCase()));
    const out = [];
    const walk = (d, depth) => {
      if (depth > 3) return;
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, ent.name);
        if (ent.isDirectory()) walk(p, depth + 1);
        else if (!wanted.size || wanted.has(path.extname(ent.name).toLowerCase())) out.push({ path: p, name: ent.name, url: lfileUrl(p) });
      }
    };
    try { walk(folder, 0); } catch {}
    return out;
  });
  // only files under a root the user already opened (library folder, picked folder/file, userData)
  ipcMain.handle('files:url', (e, absPath) => {
    if (!absPath || typeof absPath !== 'string') return null;
    const p = path.normalize(absPath);
    if (!inAllowedRoot(p) && !inAllowedRoot(path.dirname(p))) return null;
    return lfileUrl(p);
  });
  ipcMain.handle('files:savePainting', (e, dataUrl, name) => {
    const dir = path.join(app.getPath('userData'), 'paintings');
    fs.mkdirSync(dir, { recursive: true });
    // letters of every script stay: the gallery shows the file name as the title (\w would drop ü, ä, ß …)
    const file = path.join(dir, String(name || 'aquarell-' + Date.now()).replace(/[^\p{L}\p{N}.-]+/gu, '_') + '.png');
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    return { path: file, url: lfileUrl(file) };
  });
  ipcMain.handle('files:paintings', () => {
    const dir = path.join(app.getPath('userData'), 'paintings');
    if (!fs.existsSync(dir)) return [];
    allowedRoots.add(dir);
    return fs.readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => ({ path: path.join(dir, f), name: f, url: lfileUrl(path.join(dir, f)), mtime: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.mtime - a.mtime);
  });
  ipcMain.handle('files:deletePainting', (e, p) => {
    const dir = path.join(app.getPath('userData'), 'paintings');
    if (typeof p === 'string' && isInside(p, dir)) { try { fs.unlinkSync(p); } catch {} }
    return true;
  });
  ipcMain.handle('files:exportImage', async (e, dataUrl, suggested) => {
    const r = await dialog.showSaveDialog(mainWin, { defaultPath: suggested || 'bild.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (r.canceled) return null;
    fs.writeFileSync(r.filePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
    return r.filePath;
  });
  const readableFile = (absPath) => {
    if (!absPath || typeof absPath !== 'string' || absPath.includes('\0')) return null;
    const p = path.normalize(absPath);
    return inAllowedRoot(p) || isInside(p, app.getPath('userData')) ? p : null;
  };
  ipcMain.handle('files:readJson', (e, absPath) => { const p = readableFile(absPath); if (!p) return null; try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } });
  ipcMain.handle('files:readTextFile', (e, absPath) => { const p = readableFile(absPath); if (!p) return null; try { return fs.readFileSync(p, 'utf8'); } catch { return null; } });

  // app
  ipcMain.handle('app:quit', () => app.quit());
  // a hidden test window (COZYSHELVES_HIDDEN) never goes full screen: it would cover a real display
  const mayFullscreen = () => !!mainWin && !process.env.COZYSHELVES_HIDDEN;
  ipcMain.handle('app:toggleFullscreen', () => { if (mayFullscreen()) mainWin.setFullScreen(!mainWin.isFullScreen()); return mainWin?.isFullScreen(); });
  ipcMain.handle('app:setFullscreen', (e, v) => { if (mayFullscreen()) mainWin.setFullScreen(!!v); return mainWin?.isFullScreen(); });
  ipcMain.handle('app:openExternal', (e, url) => { if (/^https?:/.test(url)) shell.openExternal(url); });
  // the reader's diagram snip: a rectangle of the window (CSS pixels) as a PNG data URL
  ipcMain.handle('app:capturePage', async (e, r) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || !r) return null;
    const rect = { x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) };
    const img = await win.webContents.capturePage(rect);
    return img.isEmpty() ? null : img.toDataURL();
  });
  // hidden: the renderer then leaves the Fullscreen API alone (a film in full screen stays inside the window)
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), userData: app.getPath('userData'), platform: process.platform, isDev, hidden: !!process.env.COZYSHELVES_HIDDEN }));
  ipcMain.handle('app:fetch', async (e, url, opts) => {
    // generic fetch proxy for the renderer (avoids CORS for public APIs); returns text.
    // http/https only: file://, app://, book:// … would turn this into a local file reader.
    if (!isWebUrl(url)) return { ok: false, status: 0, error: 'Nur http(s)-Adressen sind erlaubt' };
    try {
      const res = await net.fetch(url, { method: opts?.method || 'GET', headers: { 'User-Agent': 'CozyShelves/0.1 (personal library app)', ...(opts?.headers || {}) }, body: opts?.body, bypassCustomProtocolHandlers: true });
      const ct = res.headers.get('content-type') || '';
      if (opts?.binary) { const buf = Buffer.from(await res.arrayBuffer()); return { ok: res.ok, status: res.status, contentType: ct, base64: buf.toString('base64') }; }
      return { ok: res.ok, status: res.status, contentType: ct, text: await res.text(), url: res.url };
    } catch (err) { return { ok: false, status: 0, error: err.message }; }
  });

  // streaming fetch for ndjson APIs (Lichess TV etc.)
  const streams = new Map();
  ipcMain.handle('app:stream:start', async (e, url, opts) => {
    if (!isWebUrl(url)) throw new Error('Nur http(s)-Adressen sind erlaubt');
    const id = 's' + Date.now() + Math.random().toString(36).slice(2, 7);
    const ctrl = new AbortController();
    streams.set(id, ctrl);
    (async () => {
      try {
        const res = await net.fetch(url, { headers: { 'User-Agent': 'CozyShelves/0.1 (personal library app)', Accept: 'application/x-ndjson', ...(opts?.headers || {}) }, signal: ctrl.signal });
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          broadcast('app:stream', { id, type: 'data', chunk: dec.decode(value, { stream: true }) });
        }
        broadcast('app:stream', { id, type: 'end' });
      } catch (err) { if (!ctrl.signal.aborted) broadcast('app:stream', { id, type: 'error', error: err.message }); }
      streams.delete(id);
    })();
    return id;
  });
  ipcMain.handle('app:stream:stop', (e, id) => { streams.get(id)?.abort(); streams.delete(id); return true; });

  // feature modules
  for (const mod of ['./feeds/index', './tts/index', './catalog/index', './mediathek/index', './browser/index', './library/web-covers', './audiobooks/index', './search/fulltext']) {
    try { require(mod).register({ ipcMain, app, settings, library, broadcast, getMainWindow: () => mainWin, lfileUrl, dialog, protocol, allowedRoots, isInside, serveFile, BROWSER_PARTITION }); }
    catch (e) { console.error('[main] module failed', mod, e); }
  }
  // the gamepad's pointer: real mouse input in the app's own window (electron/pad-input.js)
  try { require('./pad-input').register({ ipcMain, getMainWindow: () => mainWin }); }
  catch (e) { console.error('[main] module failed', './pad-input', e); }
}

// --- lifecycle --------------------------------------------------------------
// On Linux the Vulkan feature also moves Chromium's compositing to Vulkan, which can leave the window black with some
// drivers: there WebGPU stays as Chromium ships it, and the German voice runs on the CPU when it gets no adapter.
app.commandLine.appendSwitch('enable-features', process.platform === 'linux' ? 'WebGPU' : 'Vulkan,WebGPU');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// automated test runs (build/screenshot.js) must stay silent on the developer's speakers
if (process.env.COZYSHELVES_MUTE) app.commandLine.appendSwitch('mute-audio');
if (process.env.COZYSHELVES_SOFTWARE_GL) {
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('use-gl', 'angle');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
}

// One instance per data folder: a second start (another click on the shortcut) brings the running window to the front.
// Two instances rendered the world twice on the graphics card and wrote the same library.json and settings.json.
// The lock belongs to the data folder, so test runs with their own COZYSHELVES_USERDATA are not affected.
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else app.on('second-instance', () => {
  if (process.env.COZYSHELVES_HIDDEN) return;
  // no window left (it was closed while the app kept running): open a new one instead of doing nothing
  if (!mainWin || mainWin.isDestroyed()) { if (app.isReady() && settings) createMainWindow(); return; }
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show(); mainWin.focus();
});

// The graphics process ended (a driver hiccup, a crash; Chromium starts a new one and the renderer builds the world again,
// app/src/main.js restartAfterGpu): a line in <userData>/logs/gpu.log with the time, the reason and the version, so that
// a display fault can be told apart from a crash when it is reported. Nothing else goes into it; it stays small.
/** One line (JSON with the time and the version) appended to <userData>/logs/<name>; the file is rotated at `maxKB`. */
function note(name, entry, maxKB = 64) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs'), file = path.join(dir, name);
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > maxKB * 1024) fs.renameSync(file, file + '.1');
    fs.appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), ...entry, version: app.getVersion() }) + '\n');
  } catch { /* a note only */ }
}
app.on('child-process-gone', (_e, d) => {
  if (d?.type === 'GPU') note('gpu.log', { reason: d.reason, exitCode: d.exitCode });
});
// Errors of the page (uncaught exceptions, rejected promises, what a feature wants on record: app/src/main.js
// watchErrors, the world map's check of its own picture) go to <userData>/logs/renderer.log, so that a fault on the
// user's system can be read afterwards. Short lines, at most 256 KB, then rotated; the renderer sends at most a few
// a minute.
ipcMain.handle('app:log', (e, entry) => {
  if (!entry || typeof entry !== 'object') return false;
  const slim = {};
  for (const [k, v] of Object.entries(entry).slice(0, 24)) slim[k] = typeof v === 'string' ? v.slice(0, 600) : v;
  note('renderer.log', slim, 256);
  return true;
});
app.on('render-process-gone', (_e, contents, d) => note('renderer.log', { kind: 'render-process-gone', reason: d?.reason, exitCode: d?.exitCode, url: contents?.getURL?.().slice(0, 120) }, 256));
// what Chromium says about the graphics of this system (for the record when a picture does not reach the screen)
ipcMain.handle('app:gpuInfo', async () => {
  let basic = null;
  try { basic = await app.getGPUInfo('basic'); } catch { /* none */ }
  const dev = basic?.gpuDevice?.[0] || null;
  return { features: app.getGPUFeatureStatus(), device: dev ? { vendorId: dev.vendorId, deviceId: dev.deviceId, driverVersion: dev.driverVersion || basic?.auxAttributes?.driverVersion } : null, angle: basic?.auxAttributes?.glRenderer || null };
});

app.whenReady().then(() => {
  if (!singleInstance) return;
  settings = getSettings();
  // First start: no folder is added on its own. The welcome card asks for one (app/src/ui/welcome.js), and it comes
  // back on every start without a books folder. COZYSHELVES_BOOKS (test runs) puts its folders in on the first start, so
  // a test library never mixes with any other folder. Settings of earlier versions keep their folders.
  if (settings.get('firstRun')) {
    const seeds = [];
    if (process.env.COZYSHELVES_BOOKS) {
      for (const spec of process.env.COZYSHELVES_BOOKS.split(';')) { const [p, mode] = spec.split('|'); if (p) seeds.push({ path: p, mode: mode || 'structured' }); }
    }
    settings.set({ folders: seeds, firstRun: false });
  }
  for (const f of settings.get('folders') || []) allowedRoots.add(f.path);

  registerProtocols();
  hardenSessions();
  library = new Library({
    userData: app.getPath('userData'), settings, getIndexer: () => (indexerWin && !indexerWin.isDestroyed() && indexerReady && !indexerWin.webContents.isCrashed() ? indexerWin : null), emit: broadcast,
    // Windows shortcuts in a books folder ("00 Must-Read") mark the books they point to (library.applyMustRead)
    // the target of a must-read mark: a symbolic link (every system) or a Windows shortcut (.lnk)
    readShortcut: (p) => {
      try {
        if (fs.lstatSync(p).isSymbolicLink()) return fs.realpathSync(p);
        return process.platform === 'win32' ? shell.readShortcutLink(p).target || null : null;
      } catch { return null; }
    },
  });
  registerIpc();
  ipcMain.handle('indexer:ready', () => { indexerReady = true; library.pumpIndex(); return true; });
  createMainWindow();
  createIndexerWindow();
  setTimeout(() => library.scanAll(), 800);

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
});
let indexerReady = false;

app.on('window-all-closed', () => { app.quit(); });
app.on('before-quit', () => {
  app.isQuitting = true;
  try { library?.flush(); settings?.flush(); } catch {}
  try { require('./tts/index').shutdown?.(); } catch {}
  // a safety net: whatever might still hold the process (a hidden window made on the way out, a worker), it ends after a
  // few seconds. A process left running invisibly holds the single-instance lock, and every later start does nothing.
  setTimeout(() => { try { app.exit(0); } catch {} }, 6000).unref?.();
});
process.on('uncaughtException', (e) => console.error('[main] uncaught', e));
