// Full-text search, main process side. It decides which books the index still lacks, hands them one at a time to a
// hidden window of its own (app/fulltext.html, app/src/search/extract.js reads their text page by page), stores the
// pages through the index worker (fulltext-worker.js → fulltext-db.js) and answers the search panel
// (app/src/ui/search/search-panel.js).
//
// Indexing is background work of the lowest kind: it waits until the library has read new books (covers and
// metadata first) and pauses while the user reads, listens to read-aloud, watches a film or the world drops frames
// (app/src/ui/search/activity.js reports that). The reading window runs at a lower process priority, exists only while
// there is something to read and is renewed after a number of books (hundreds of PDFs in one page leave memory behind).
// A book that was half read when the app closed goes on at that page after the next start; a book whose file changed is
// read again, a book that left the library leaves the index, a book that only moved keeps its pages.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const { parseQuery, findMatches } = require('./textnorm');

const FORMATS = new Set(['pdf', 'epub', 'mobi', 'azw3', 'fb2', 'fbz', 'cbz', 'txt', 'md', 'html', 'docx', 'rtf']);
const START_DELAY = 20000;        // the world builds its rooms and compiles its shaders first
const STALL_MS = 180000;          // a book without progress for this long (while it may run) is given up
const RETRY_ERROR_MS = 7 * 86400000;
const MAX_TRIES = 3;
// the reading window: renewed after this many books or when it holds more memory than this (it starts at about 150 MB),
// closed when it has had nothing to do for a while (sooner when nothing is left to read)
const WIN_BOOKS = 120;
const WIN_MAX_MB = 350;
const WIN_IDLE_MS = 15000, WIN_PAUSED_MS = 90000;

/** The file a book was read from: content hash, size and modification time (a changed file is read again). */
const keyOf = (b) => `${b.contentHash || ''}:${b.size || 0}:${Math.round(b.mtime || 0)}`;
const langOf = (b) => { const l = String(b.language || '').slice(0, 2).toLowerCase(); return l === 'de' || l === 'en' ? l : 'other'; };

/** @param makeTextWindow  tests only: makes a stand-in for the reading window (electron/search/test-fulltext.js) */
function register({ ipcMain, app, settings, library, broadcast, makeTextWindow = null }) {
  const dir = path.join(app.getPath('userData'), 'fulltext');
  const file = path.join(dir, 'index.sqlite');
  const delay = Number.isFinite(+process.env.COZYSHELVES_FULLTEXT_DELAY) && process.env.COZYSHELVES_FULLTEXT_DELAY !== '' ? +process.env.COZYSHELVES_FULLTEXT_DELAY : START_DELAY;

  let worker = null, opening = null, workerError = null;
  let seq = 0;
  const calls = new Map();
  const rows = new Map();          // mirror of the index's book rows: id → row
  let live = [];                   // the library's books the index should hold (not missing, a format with text)
  let queue = [];                  // books still to read, best first
  let current = null;              // the book being read: { jobId, id, key, title, unit, units, lastProgress }
  let activity = { reading: false, tts: false, film: false, busy: false };
  let started = false, gateOpen = null, statusTimer = null, sizeBytes = 0, addedSinceOptimize = 0, syncing = false;
  let jobSeq = 0;
  let textWin = null, textReady = false, textBooks = 0, lastWork = 0;
  const startedAt = new Map();     // id → the page the last job of that book started at (the checks see the resume)

  const enabled = () => settings.get('fulltext')?.enabled !== false;
  let quitting = false;   // set in before-quit: no new reading window, no new job
  const readyWin = () => (textWin && !textWin.isDestroyed() && textReady ? textWin : null);
  const fromTextWin = (e) => !!textWin && !textWin.isDestroyed() && e.sender === textWin.webContents;

  // ---------------------------------------------------------------- the reading window
  /** The hidden window that reads the books: made when there is a book to read; null until it has said hello. */
  function openTextWindow() {
    // never a new window while the app quits: a job still on its way would keep the process alive, hidden, and with it
    // the single-instance lock (every later start would end at once)
    if (quitting) return null;
    if (textWin && !textWin.isDestroyed()) return readyWin();
    textReady = false; textBooks = 0; lastWork = Date.now();
    const win = textWin = makeTextWindow ? makeTextWindow() : new (require('electron').BrowserWindow)({
      show: false, width: 800, height: 600, skipTaskbar: true,
      webPreferences: { preload: path.join(__dirname, '..', 'preload-fulltext.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false, spellcheck: false },
    });
    win.loadURL('app://lesesaal/fulltext.html');
    // a page that crashes while it reads a book: that book counts as a failed try (no endless crashing on one file)
    win.webContents.on('render-process-gone', () => { if (textWin === win) closeTextWindow({ failed: 'crash' }); });
    win.on('closed', () => { if (textWin === win) { textWin = null; textReady = false; } });
    return null;
  }
  function closeTextWindow({ failed = null } = {}) {
    const win = textWin;
    textWin = null; textReady = false;
    if (current) { if (failed) finishCurrent({ state: 'error', error: failed }); else abortCurrent(); }
    try { if (win && !win.isDestroyed()) win.destroy(); } catch {}
  }
  /** Memory of the reading window in MB (private bytes where the system reports them). */
  function textWinMB() {
    try {
      const pid = textWin?.webContents.getOSProcessId();
      const m = app.getAppMetrics?.().find((x) => x.pid === pid);
      return (m?.memory?.privateBytes || m?.memory?.workingSetSize || 0) / 1024;
    } catch { return 0; }
  }

  // ---------------------------------------------------------------- the worker
  function call(op, ...args) {
    if (!worker) return Promise.reject(new Error('index closed'));
    const id = ++seq;
    return new Promise((resolve, reject) => { calls.set(id, { resolve, reject }); worker.postMessage({ id, op, args }); });
  }
  function startWorker() {
    if (opening) return opening;
    workerError = null;
    worker = new Worker(path.join(__dirname, 'fulltext-worker.js'), { workerData: { file } });
    worker.on('message', ({ id, ok, result, error }) => { const c = calls.get(id); if (!c) return; calls.delete(id); if (ok) c.resolve(result); else c.reject(new Error(error)); });
    worker.on('error', (e) => { console.error('[fulltext] worker failed', e); workerError = String(e?.message || e); });
    worker.on('exit', () => {
      for (const c of calls.values()) c.reject(new Error('index closed'));
      calls.clear(); worker = null; opening = null;
    });
    opening = call('open').then((r) => {
      rows.clear();
      for (const row of r.books) rows.set(row.id, row);
      sizeBytes = r.size;
      return true;
    }).catch((e) => { workerError = e.message; console.error('[fulltext] index failed to open', e); return false; });
    return opening;
  }
  async function stopWorker() {
    abortCurrent();
    const w = worker;
    if (!w) return;
    try { await Promise.race([call('close'), new Promise((r) => setTimeout(r, 1500))]); } catch {}
    try { await w.terminate(); } catch {}
  }
  const ready = async () => (enabled() ? (worker ? opening : startWorker()) : false);

  // ---------------------------------------------------------------- what the index lacks
  async function sync() {
    if (syncing || !started || !enabled() || !(await ready())) return;
    syncing = true;
    try {
      const books = library.books || {};
      live = Object.values(books).filter((b) => b && !b.missing && FORMATS.has(b.format));
      const liveIds = new Set(live.map((b) => b.id));
      // gone from the library: out of the index, unless the same file turns up under another path (a moved book)
      const gone = [...rows.keys()].filter((id) => !liveIds.has(id));
      if (gone.length) {
        const newcomers = new Map();
        for (const b of live) if (!rows.has(b.id)) newcomers.set(keyOf(b), b.id);
        const remove = [];
        for (const id of gone) {
          const to = newcomers.get(rows.get(id).key);
          if (to && await call('rekey', id, to)) { const row = rows.get(id); rows.delete(id); row.id = to; rows.set(to, row); newcomers.delete(row.key); }
          else remove.push(id);
        }
        if (remove.length) {
          if (current && remove.includes(current.id)) abortCurrent();
          await call('remove', remove);
          for (const id of remove) rows.delete(id);
        }
      }
      if (current && (!liveIds.has(current.id) || keyOf(books[current.id]) !== current.key)) abortCurrent();
      const now = Date.now();
      queue = live.filter((b) => {
        if (!b.indexed) return false;            // the library reads it first (covers, metadata, a broken file)
        if (current?.id === b.id) return false;
        const row = rows.get(b.id);
        if (!row || row.key !== keyOf(b)) return true;
        if (row.state === 'partial') return true;
        if (row.state === 'error') return row.tries < MAX_TRIES && now - (row.at || 0) > RETRY_ERROR_MS;
        return false;
      });
      // a book started before goes on first, then the books read most recently, then the small ones (many books soon)
      const rank = (b) => { const row = rows.get(b.id); return row?.state === 'partial' && row.key === keyOf(b) ? 0 : 1; };
      queue.sort((a, b) => rank(a) - rank(b) || (b.lastRead || 0) - (a.lastRead || 0) || (a.size || 0) - (b.size || 0));
      if (!queue.length && !current && addedSinceOptimize >= 10 && !tidying) tidy();
    } catch (e) { console.warn('[fulltext] sync failed', e.message); }
    finally { syncing = false; }
    pushStatus();
    dispatch();
  }

  /** After many new books: merge the index in small steps between queries, then fold the log into the file. */
  let tidying = false;
  async function tidy() {
    tidying = true;
    addedSinceOptimize = 0;
    try {
      for (let i = 0; i < 400 && worker && !current && !queue.length; i++) {
        if (!(await call('merge', 300))) break;
        await new Promise((r) => setTimeout(r, 400));
      }
      if (worker && !current) sizeBytes = await call('compact');
    } catch (e) { console.warn('[fulltext] tidying failed', e.message); }
    tidying = false;
    pushStatus();
  }

  // ---------------------------------------------------------------- the gate: may a book be read right now?
  function pauseReason() {
    if (!enabled()) return 'off';
    if (library.indexing || library.queue?.length) return 'library';
    if (activity.reading) return 'reading';
    if (activity.tts) return 'tts';
    if (activity.film) return 'film';
    if (activity.busy) return 'busy';
    return null;
  }
  function sendGate(force = false) {
    const open = !pauseReason();
    if (open === gateOpen && !force) return;
    gateOpen = open;
    if (open && current) current.lastProgress = Date.now();
    try { readyWin()?.webContents.send('fulltext-gate', open); } catch {}
    pushStatus();
  }

  /** The reading window works below the normal priority: the world, the reader and everything else go first. */
  function lowerPriority() {
    // COZYSHELVES_FULLTEXT_PRIORITY=normal (timing runs on a busy test machine): the window keeps its normal priority
    if (process.env.COZYSHELVES_FULLTEXT_PRIORITY === 'normal') return;
    try {
      const pid = textWin?.webContents.getOSProcessId();
      if (pid) os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch { /* not allowed: it runs at normal priority */ }
  }

  async function dispatch() {
    if (quitting) return;
    if (!started || current || !queue.length || pauseReason() || !worker) return;
    const win = openTextWindow();
    if (!win) return;            // it says hello when it is ready, and this runs again
    const b = queue.shift();
    if (!b || b.missing) return dispatch();
    const key = keyOf(b), kind = b.format === 'pdf' ? 'pdf' : 'flow';
    const row = rows.get(b.id);
    // PDFs go on at the page where they stopped; the chunks of the other formats are cheap to read again
    const resume = kind === 'pdf' && row?.state === 'partial' && row.key === key && row.kind === 'pdf';
    const job = current = { jobId: ++jobSeq, id: b.id, key, title: b.title || path.basename(b.path), unit: 0, units: 0, lastProgress: Date.now() };
    let begun;
    try { begun = await call('begin', b.id, key, kind, { resume }); }
    catch (e) { console.warn('[fulltext] begin failed', e.message); if (current === job) current = null; return; }
    if (current !== job) return;
    rows.set(b.id, { ...(row || {}), id: b.id, key, kind, state: 'partial', next: begun.next, pages: resume ? row.pages : 0, chars: resume ? row.chars : 0, tries: row?.tries || 0 });
    job.unit = begun.next;
    startedAt.set(b.id, begun.next);
    if (win.isDestroyed()) { current = null; return; }
    lastWork = Date.now();
    sendGate(true);
    win.webContents.send('fulltext-job', {
      jobId: job.jobId, id: b.id, from: begun.next, format: b.format, name: path.basename(b.path),
      url: `book://${b.id}/${encodeURIComponent(path.basename(b.path))}`, title: b.title || '', author: b.author || '', language: b.language || '',
    });
    pushStatus();
  }

  function abortCurrent() {
    if (!current) return;
    try { readyWin()?.webContents.send('fulltext-abort', current.jobId); } catch {}
    current = null;
  }

  async function finishCurrent(result) {
    const job = current;
    current = null;
    lastWork = Date.now();
    // a fresh window after many books, or when this one holds too much
    if (textWin && (++textBooks >= WIN_BOOKS || textWinMB() > WIN_MAX_MB)) closeTextWindow();
    try {
      const row = await call('finish', job.id, result);
      if (row) rows.set(job.id, row);
      addedSinceOptimize++;
      sizeBytes = await call('size');
    } catch (e) { console.warn('[fulltext] finish failed', e.message); }
    pushStatus();
    setTimeout(dispatch, 250);
  }

  // ---------------------------------------------------------------- status for the panel and the settings
  function status() {
    let total = 0, done = 0, notext = 0, errors = 0;
    for (const b of Object.values(library.books || {})) {
      if (!b || b.missing || !FORMATS.has(b.format)) continue;
      total++;
      const row = rows.get(b.id);
      if (!row || row.key !== keyOf(b)) continue;
      if (row.state === 'done') done++;
      else if (row.state === 'notext') { done++; notext++; }
      else if (row.state === 'error') { done++; errors++; }
    }
    const reason = pauseReason();
    return {
      enabled: enabled(), ready: !!worker && !workerError, error: workerError, started,
      total, done, notext, errors, bytes: sizeBytes,
      running: !!current && !reason, paused: current || queue.length ? reason : null, waiting: queue.length,
      current: current ? { id: current.id, title: current.title, unit: current.unit, units: current.units } : null,
    };
  }
  function pushStatus() {
    if (statusTimer) return;
    statusTimer = setTimeout(() => { statusTimer = null; broadcast('fulltext:status', status()); }, 600);
  }

  // ---------------------------------------------------------------- searching
  /** Book order: pages with hits (saturating, longer books need more), and the words in title or author. */
  function scored(found, parsed) {
    const done = [...rows.values()].filter((r) => r.pages > 0);
    const avg = done.length ? done.reduce((a, r) => a + r.pages, 0) / done.length : 1;
    const items = parsed.items.length || 1;
    const k1 = 2, bl = 0.6;
    return found.map((r) => {
      const b = library.books[r.id];
      const tf = (r.hits * (k1 + 1)) / (r.hits + k1 * (1 - bl + bl * Math.max(1, r.pages) / avg));
      const inTitle = new Set(findMatches(`${b.title || ''} ${b.author || ''}`, parsed).map((m) => m.item)).size;
      return { ...r, score: tf + 1.5 * (inTitle / items) };
    });
  }
  const hitOut = (kind, h) => (kind === 'pdf'
    ? { u: h.u, page: String(h.u + 1), loc: { p: h.u }, snippet: h.snippet }
    : { u: h.u, page: h.page || null, pos: h.pos || null, chapter: h.chapter || null, loc: { s: h.s, o: h.o, len: h.len }, snippet: h.snippet });

  async function search({ q = '', department = null, language = null, offset = 0, limit = 30, hits = 3 } = {}) {
    const t0 = Date.now();
    const parsed = parseQuery(q);
    const base = { q: parsed.text, status: status() };
    if (parsed.empty) return { ...base, ok: true, empty: true, books: [] };
    if (parsed.common) return { ...base, ok: true, common: true, books: [] };
    if (!enabled()) return { ...base, ok: false, off: true, books: [] };
    if (!(await ready())) return { ...base, ok: false, error: workerError || 'index unavailable', books: [] };
    const m = await call('match', parsed.text);
    const found = m.books.filter((r) => {
      const b = library.books[r.id];
      if (!b || b.missing) return false;
      if (department && b.department !== department) return false;
      if (language && langOf(b) !== language) return false;
      return true;
    });
    const ranked = scored(found, parsed).sort((a, b) => b.score - a.score || b.hits - a.hits || String(library.books[a.id].title || '').localeCompare(String(library.books[b.id].title || ''), 'de'));
    const page = ranked.slice(offset, offset + limit);
    const detail = page.length ? await call('hits', parsed.text, page.map((r) => ({ id: r.id, offset: 0, count: hits })), 260) : [];
    const byId = new Map(detail.map((d) => [d.id, d]));
    return {
      ...base, ok: true, ms: Date.now() - t0, capped: !!m.capped, offset,
      totalBooks: ranked.length, totalHits: ranked.reduce((a, r) => a + r.hits, 0),
      books: page.map((r) => ({ id: r.id, hits: r.hits, kind: r.kind, score: Math.round(r.score * 1000) / 1000, items: (byId.get(r.id)?.hits || []).map((h) => hitOut(r.kind, h)) })),
    };
  }

  async function more({ q = '', id, offset = 0, count = 20 } = {}) {
    if (!(await ready())) return { id, items: [] };
    const parsed = parseQuery(q);
    if (parsed.empty || parsed.common) return { id, items: [] };
    const [d] = await call('hits', parsed.text, [{ id, offset, count }], 260);
    const kind = rows.get(id)?.kind || 'flow';
    return { id, total: d?.total || 0, items: (d?.hits || []).map((h) => hitOut(kind, h)) };
  }

  /**
   * The computer's catalogue ("Volltext", library:searchText) asks the index as well: [{ book, excerpt }] in the order
   * of the panel, or null while there is no index (the library then searches its text samples).
   */
  library.textSearch = async (q, limit = 40) => {
    if (!enabled() || !rows.size) return null;
    const r = await search({ q, limit, hits: 1 }).catch(() => null);
    if (!r?.ok || r.empty || r.common) return null;
    return r.books.filter((b) => library.books[b.id]).map((b) => ({ book: library.publicBook(library.books[b.id]), excerpt: (b.items[0]?.snippet?.text || '').trim() }));
  };

  /** The text of a TXT/MD/HTML/DOCX/RTF book as the reader gets it (electron/main.js library:readText). */
  async function source(id) {
    const b = library.books[id];
    if (!b || b.missing || !b.path) return null;
    if (b.format === 'docx') return { html: (await require('mammoth').convertToHtml({ path: b.path })).value };
    if (b.format === 'rtf') return { text: require('../library/textformats').rtfToText(fs.readFileSync(b.path, 'latin1')).text };
    const buf = fs.readFileSync(b.path);
    if (buf.subarray(0, 4096).includes(0)) return null;
    const text = buf.toString('utf8');
    if (b.format === 'md') return { html: require('marked').marked.parse(text) };
    return { text };
  }

  // ---------------------------------------------------------------- IPC: the reading window
  ipcMain.handle('fulltext:source', (e, id) => (fromTextWin(e) ? source(id).catch(() => null) : null));
  ipcMain.handle('fulltext:units', async (e, jobId, units, next, info) => {
    if (!fromTextWin(e) || !current || current.jobId !== jobId) return { stop: true };
    const job = current;
    try { await call('add', job.id, Array.isArray(units) ? units : [], next | 0); }
    catch (err) { console.warn('[fulltext] storing pages failed', err.message); return { stop: true }; }
    if (current !== job) return { stop: true };
    job.unit = next | 0;
    const row = rows.get(job.id);
    if (row) row.next = Math.max(row.next || 0, next | 0);
    if (info?.units) job.units = info.units;
    job.lastProgress = Date.now();
    pushStatus();
    return { stop: false, open: !pauseReason() };
  });
  ipcMain.handle('fulltext:end', async (e, jobId, result) => {
    if (!fromTextWin(e) || !current || current.jobId !== jobId) return false;
    await finishCurrent({ state: ['done', 'error'].includes(result?.state) ? result.state : 'done', units: result?.units ?? null, error: result?.error || null });
    return true;
  });

  // ---------------------------------------------------------------- IPC: the app
  // { detail: true } adds the rows of the index (the checks follow a book's progress with it)
  ipcMain.handle('fulltext:status', (e, opts) => (opts?.detail ? { ...status(), books: [...rows.values()].map(({ id, state, kind, next, units, pages, chars, at }) => ({ id, state, kind, next, units, pages, chars, at, from: startedAt.get(id) ?? null })) } : status()));
  ipcMain.handle('fulltext:search', (e, opts) => search(opts || {}).catch((err) => ({ ok: false, error: err.message, books: [] })));
  ipcMain.handle('fulltext:more', (e, opts) => more(opts || {}).catch(() => ({ items: [] })));
  ipcMain.handle('fulltext:activity', (e, a) => {
    activity = { reading: !!a?.reading, tts: !!a?.tts, film: !!a?.film, busy: !!a?.busy };
    sendGate();
    return status();
  });
  ipcMain.handle('fulltext:rebuild', async () => {
    abortCurrent();
    if (!(await ready())) return status();
    const r = await call('clear');
    rows.clear(); sizeBytes = r.size; queue = [];
    await sync();
    return status();
  });
  // switched off: the index can be deleted to free the disk
  ipcMain.handle('fulltext:delete', async () => {
    if (enabled()) return status();
    await stopWorker();
    for (const f of ['index.sqlite', 'index.sqlite-wal', 'index.sqlite-shm']) { try { fs.rmSync(path.join(dir, f), { force: true }); } catch {} }
    rows.clear(); sizeBytes = 0;
    pushStatus();
    return status();
  });
  ipcMain.handle('fulltext:size', () => {
    let n = 0;
    for (const f of ['index.sqlite', 'index.sqlite-wal']) { try { n += fs.statSync(path.join(dir, f)).size; } catch {} }
    return n;
  });

  // ---------------------------------------------------------------- life cycle
  let wasEnabled = enabled();
  settings.onChange?.(() => {
    const on = enabled();
    if (on === wasEnabled) return;
    wasEnabled = on;
    if (on) { startWorker(); sync(); } else { closeTextWindow(); stopWorker().then(() => pushStatus()); }
    sendGate();
  });
  library.onIdle?.(() => { sendGate(); sync(); });
  const tick = setInterval(() => {
    if (!started) return;
    sendGate();
    // a book that makes no progress although it may run (a PDF that hangs pdf.js): given up, the window renewed
    if (current && !pauseReason() && Date.now() - current.lastProgress > STALL_MS) {
      console.warn('[fulltext] giving up', current.title);
      closeTextWindow({ failed: 'timeout' });
    }
    // nothing to read for a while (or paused for long): the window goes, it is made again when needed
    if (textWin && !current && Date.now() - lastWork > (queue.length ? WIN_PAUSED_MS : WIN_IDLE_MS)) closeTextWindow();
    dispatch();
  }, 1000);
  const syncTick = setInterval(() => sync(), 5000);
  setTimeout(() => { started = true; if (enabled()) startWorker(); sync(); }, delay);
  // the reading window has loaded (a new one knows nothing of a book before it)
  ipcMain.on('fulltext:hello', (e) => {
    if (!fromTextWin(e)) return;
    textReady = true; lastWork = Date.now();
    lowerPriority();
    if (current) current = null;
    sendGate(true);
    dispatch();
  });
  app.on('before-quit', () => {
    quitting = true;
    clearInterval(tick); clearInterval(syncTick);
    try { if (textWin && !textWin.isDestroyed()) textWin.destroy(); } catch {}
    try { worker?.terminate(); } catch {}
  });
}

module.exports = { register, keyOf, FORMATS };
