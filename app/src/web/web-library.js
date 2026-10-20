// The library of the browser version: the desktop's electron/library/library.js without Node. Books come from
// folder sources (web-files.js: a directory handle or the files of <input webkitdirectory>), the records, the
// reading state, the history and the statistics live in IndexedDB (idb.js), the covers as blobs next to them, and
// every book is read in the page itself (core/index-book.js: metadata, cover, text sample). Departments, shelves and
// everything a file name says are the shared rules of electron/library/shelving.js, so the shelves look the same as
// on the desktop. Events go out as on the desktop: 'library:update', 'library:book', 'library:scan'.
import { FORMAT_OF, extName, baseName, assignFromFolder, setBookDepartment, publicBook, computeDepartments, moveBook, applyIndexMeta, needsClassify, searchBooks, colorFromString, titleFromFilename, authorFromFilename, localDay, classify, INHERIT_FIELDS, UPDATE_FIELDS, PENDING_SHELF } from '../../../electron/library/shelving.js';
import { DEFAULT_DEPARTMENT } from '../../../electron/library/taxonomy.js';
import { normalizeLanguage } from '../../../electron/library/language.js';
import { isFinished, noteProgress, setReadMark, migrateFinished, streakOf, booksReadIn, readingGoal } from '../../../electron/library/reading-log.js';
import { findDuplicates } from '../../../electron/library/duplicates.js';
import { weakKind, COVER_CHECK } from '../../../electron/library/cover-match.js';
import { idb, WebStore } from './idb.js';
import { listBooks, sourceFromHandle, sourceFromFiles, sourceFromBridge, permissionOf, requestPermission, saveHandle, loadHandle, dropHandle, pickDirectory, pickWithInput, canPickDirectory, canPickBridge, pickBridgeFolder, bridge } from './web-files.js';
import { indexBook } from '../core/index-book.js';

// DOCX and RTF need the main process (mammoth, the RTF reader): the browser version leaves them on the disk
const WEB_SKIP_FORMATS = new Set(['docx', 'rtf']);
const INDEX_TIMEOUT_MS = 120000;
const MAX_INDEX_ATTEMPTS = 2;

/** A stable id for a book: the folder's name and the path inside it (64-bit FNV-1a as 16 hex characters). */
export function hashId(s) {
  let h1 = 0x811c9dc5, h2 = 0x050c5d1f;
  for (const c of String(s)) { const x = c.codePointAt(0); h1 = Math.imul(h1 ^ x, 16777619) >>> 0; h2 = Math.imul(h2 ^ (x + 11), 16777619) >>> 0; }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
const idFor = (sourceName, relPath) => hashId(`${sourceName}|${relPath}`.toLowerCase().replace(/\\/g, '/'));

async function dataUrlToBlob(dataUrl) {
  const i = String(dataUrl).indexOf(',');
  const meta = dataUrl.slice(5, i), b64 = dataUrl.slice(i + 1);
  const type = meta.split(';')[0] || 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  return new Blob([bytes], { type });
}

export class WebLibrary {
  /**
   * @param settings  the WebStore of the settings (folders: [{ id, path, mode, kind }])
   * @param emit      (channel, payload) → the listeners of api.library.on*
   */
  constructor({ settings, emit }) {
    this.settings = settings;
    this.emit = emit;
    this.db = new WebStore('library', { books: {}, history: [], schema: 1 });
    this.stats = new WebStore('stats', { days: {}, sessions: [] });
    this.books = {};
    this.sources = new Map();        // folder id → source (web-files.js)
    this.coverUrls = new Map();      // book id → blob: URL of its cover
    this.fileUrls = new Map();       // book id → blob: URL of the file (the reader), few at a time
    this.queue = [];
    this.indexing = null;
    this.scanState = { active: false, done: 0, total: 0, phase: 'idle', unavailable: [] };
    this._notifyTimer = null;
    this.ready = this.init();
  }

  // ---------------------------------------------------------------- start --
  async init() {
    await this.db.load(); await this.stats.load();
    this.books = this.db.get('books');
    let changed = false;
    for (const b of Object.values(this.books)) {
      const lang = normalizeLanguage(b.language);
      if ((b.language ?? null) !== lang) { b.language = lang; changed = true; }
      if (migrateFinished(b)) changed = true;
      if (b.indexed === false && b.indexAttempts >= MAX_INDEX_ATTEMPTS) { b.indexed = true; changed = true; }
    }
    if (changed) this.db.save();
    // the folders the user chose: handles come back from IndexedDB, the folders of the Android app are asked for
    // again (the app kept the permission), the files of the fallback picker are gone
    for (const f of this.settings.get('folders') || []) {
      if (!f || !f.id) continue;
      if (f.kind === 'handle') {
        const h = await loadHandle(f.id);
        const src = h ? sourceFromHandle(h, { id: f.id, mode: f.mode }) : { id: f.id, name: f.path, mode: f.mode, kind: 'handle', handle: null, available: false };
        if (h) { src.permission = await permissionOf(h); src.available = src.permission === 'granted'; }
        this.sources.set(f.id, src);
      } else if (f.kind === 'bridge') this.sources.set(f.id, sourceFromBridge({ id: f.id, key: f.key, name: f.path, mode: f.mode || 'structured' }));
      else this.sources.set(f.id, { id: f.id, name: f.path, mode: f.mode || 'structured', kind: 'files', files: null, available: false });
    }
    await this.loadCoverUrls();
    this.groupDuplicates();
    // as on the desktop, the folders are read again at every start (new books, books not indexed yet); folders without
    // their permission wait for the click in the menu (reopen)
    if ([...this.sources.values()].some((s) => s.available)) setTimeout(() => this.scanAll(), 400);
    return this;
  }
  async loadCoverUrls() {
    const [keys, blobs] = await Promise.all([idb.keys('covers'), idb.getAll('covers')]);
    (keys || []).forEach((k, i) => { if (!String(k).endsWith('.book') && blobs[i]) this.setCoverUrl(k, blobs[i]); });
  }
  setCoverUrl(id, blob) {
    const old = this.coverUrls.get(id);
    if (old) { try { URL.revokeObjectURL(old); } catch {} }
    this.coverUrls.set(id, URL.createObjectURL(blob));
  }

  // ---------------------------------------------------------------- folders --
  /** The folders as the settings list them. */
  folders() { return (this.settings.get('folders') || []).slice(); }
  /** What the user has to do before a folder can be read again: [{ id, name, kind, reason }], reason 'permission'
   *  (a kept handle wants its click), 'repick' (the fallback picker keeps nothing) or 'lost' (the Android app no
   *  longer has the folder's permission: the folder was removed, or the access revoked in the system settings). */
  attention() {
    const out = [];
    for (const s of this.sources.values()) {
      if (s.available) continue;
      out.push({ id: s.id, name: s.name, kind: s.kind, reason: s.kind === 'handle' && s.handle ? 'permission' : s.kind === 'bridge' ? 'lost' : 'repick' });
    }
    return out;
  }
  /** The folder picker (the app's, the native one, else the input): a new folder source, scanned at once. Returns the folders. */
  async addFolder(mode = 'structured') {
    let src = null;
    if (canPickBridge()) {
      const picked = await pickBridgeFolder();
      if (!picked) return null;
      src = sourceFromBridge({ key: picked.key, name: picked.name, mode });
    } else if (canPickDirectory()) {
      const handle = await pickDirectory();
      if (!handle) return null;
      src = sourceFromHandle(handle, { mode });
      await saveHandle(src.id, handle);
    } else {
      const files = await pickWithInput();
      if (!files) return null;
      src = sourceFromFiles(files, { mode });
    }
    return this.addSource(src);
  }
  /** Adds a source made elsewhere (a handle from the OPFS in the checks, a FileList, a folder of the app) and scans. */
  async addSource(src) {
    // the same folder picked again (same name, same kind): the new handle, files or key replace the old ones
    const twin = [...this.sources.values()].find((s) => s.name === src.name && s.kind === src.kind && s.mode === src.mode);
    if (twin) { src.id = twin.id; if (twin.kind === 'bridge' && twin.key && twin.key !== src.key) this.forgetInApp(twin.key); }
    // a handle is kept in IndexedDB: Chromium finds the folder again after a reload (with the permission asked once)
    if (src.kind === 'handle' && src.handle) await saveHandle(src.id, src.handle);
    src.available = true;
    this.sources.set(src.id, src);
    const folders = this.folders().filter((f) => f.id !== src.id);
    const entry = { id: src.id, path: src.name, mode: src.mode, kind: src.kind };
    if (src.kind === 'bridge') entry.key = src.key;
    folders.push(entry);
    this.settings.set('folders', folders);
    await this.settings.flush();
    this.scanAll();
    return folders;
  }
  /** The permission for a kept handle once more (a click in the page), or the picker again (the fallback input, the app). */
  async reopen(id) {
    const s = this.sources.get(id);
    if (!s) return false;
    if (s.kind === 'handle' && s.handle) {
      if (!(await requestPermission(s.handle))) return false;
      s.available = true; s.permission = 'granted';
      this.scanAll();
      return true;
    }
    if (s.kind === 'bridge') {
      const picked = await pickBridgeFolder();
      if (!picked) return false;
      if (s.key && s.key !== picked.key) this.forgetInApp(s.key);
      const fresh = sourceFromBridge({ id, key: picked.key, name: s.name, mode: s.mode });
      fresh.available = true;
      this.sources.set(id, fresh);
      this.settings.set('folders', this.folders().map((f) => (f.id === id ? { ...f, key: picked.key } : f)));
      await this.settings.flush();
      this.scanAll();
      return true;
    }
    const files = await pickWithInput();
    if (!files) return false;
    const fresh = sourceFromFiles(files, { id, mode: s.mode });
    fresh.name = s.name;   // the books keep their ids even when the folder was renamed outside
    this.sources.set(id, fresh);
    this.scanAll();
    return true;
  }
  async setFolders(folders) {
    const keep = new Set((folders || []).map((f) => f.id));
    for (const id of [...this.sources.keys()]) {
      if (keep.has(id)) continue;
      const s = this.sources.get(id);
      this.sources.delete(id);
      await dropHandle(id);
      if (s?.kind === 'bridge' && s.key) this.forgetInApp(s.key);
    }
    this.settings.set('folders', (folders || []).filter((f) => f && f.id));
    await this.settings.flush();
    this.scanAll();
    return this.folders();
  }
  /** The Android app gives the folder's permission back (the user removed the folder here). */
  forgetInApp(key) { try { bridge()?.forgetFolder(key); } catch (e) { console.warn('[web-library] forgetFolder', e?.message || e); } }

  // ---------------------------------------------------------------- state --
  publicBook(b) { return publicBook(b, this.dups); }
  groupDuplicates(live = Object.values(this.books).filter((b) => !b.missing)) {
    this.dups = findDuplicates(live.map((b) => ({ id: b.id, title: b.title || titleFromFilename(b.path), author: b.author || authorFromFilename(b.path) || '', year: b.year, isbn: b.isbn, contentHash: b.contentHash, size: b.size })));
    return this.dups;
  }
  getState() {
    const live = Object.values(this.books).filter((b) => !b.missing);
    this.groupDuplicates(live);
    const books = live.map((b) => this.publicBook(b));
    return { books, departments: computeDepartments(books, (id) => this.books[id]?.title || ''), folders: this.folders(), scan: this.scanState, web: { attention: this.attention(), canPick: canPickDirectory() || canPickBridge() } };
  }
  /** 'library:update' 250 ms after the last change, but at the latest 1.5 s after the first one: small books index
   *  faster than every 250 ms here, and the shelves would otherwise wait for the whole run. */
  notify() {
    const now = Date.now();
    if (!this._notifyFirst) this._notifyFirst = now;
    clearTimeout(this._notifyTimer);
    const fire = () => { this._notifyFirst = 0; this._notifyTimer = null; this.emit('library:update', this.getState()); };
    if (now - this._notifyFirst >= 1500) { fire(); return; }
    this._notifyTimer = setTimeout(fire, 250);
  }
  notifyBook(id) { const b = this.books[id]; if (b) this.emit('library:book', this.publicBook(b)); }

  // ---------------------------------------------------------------- scan --
  async scanAll() {
    if (this._scanning) { this._scanAgain = true; return; }
    this._scanning = true;
    try {
      this.scanState = { active: true, done: 0, total: 0, phase: 'scan', unavailable: [] };
      this.emit('library:scan', this.scanState);
      const seen = new Set(), okFolders = new Set();
      for (const src of this.sources.values()) {
        let ok = false;
        try { ok = await this.scanSource(src, seen); } catch (e) { console.error('[web-library] scan failed', src.name, e); }
        if (ok) okFolders.add(src.id); else this.scanState.unavailable.push(src.name);
      }
      this.sweepMissing(okFolders, seen);
      this.db.save();
      this.scanState.phase = 'index';
      this.scanState.total = this.queue.length;
      this.scanState.done = 0;
      this.notify();
      this.pumpIndex();
    } finally {
      this._scanning = false;
      if (this._scanAgain) { this._scanAgain = false; this.scanAll(); }
    }
  }
  /** @returns true when the source could be read */
  async scanSource(src, seen) {
    const entries = await listBooks(src);
    if (!entries) { src.available = false; return false; }
    src.available = true;
    let found = 0;
    for (const e of entries) {
      const ext = extName(e.name);
      const format = FORMAT_OF(ext);
      if (WEB_SKIP_FORMATS.has(format)) continue;
      const id = idFor(src.name, e.relPath);
      seen.add(id);
      found++;
      let b = this.books[id];
      const path = src.name + '/' + e.relPath;
      const changed = !b || b.size !== e.size || b.mtime !== e.mtime;
      if (!b) {
        b = this.books[id] = {
          id, path, relPath: e.relPath, folder: src.name, folderId: src.id, folderMode: src.mode || 'structured', format,
          size: e.size, mtime: e.mtime, addedAt: Date.now(), bookmarks: [], annotations: [], positions: [], readingSeconds: 0, timesOpened: 0,
          progress: 0, lastLocation: null, borrowed: false, indexed: false, hasCover: false,
        };
        this.inheritFromMissing(b, seen);
      } else {
        b.missing = false; b.missingSince = null; b.path = path; b.relPath = e.relPath; b.folder = src.name; b.folderId = src.id; b.folderMode = src.mode || 'structured';
        if (changed) { b.size = e.size; b.mtime = e.mtime; b.indexed = false; b.indexAttempts = 0; }
      }
      if (!b.born) b.born = Math.round(Math.min(Date.now(), e.mtime || Date.now()));
      assignFromFolder(b, { mode: src.mode || 'structured' }, (x) => this.autoClassify(x));
      if (!b.indexed && !this.queue.includes(id)) this.queue.push(id);
    }
    // sanity brake: a folder that used to hold books and now yields none is treated as unavailable
    if (found === 0 && Object.values(this.books).some((b) => b.folderId === src.id && !b.missing)) return false;
    return true;
  }
  /** A book that moved inside the folder (same name and size, its old record gone): its reading state comes along. */
  inheritFromMissing(b, seen) {
    for (const o of Object.values(this.books)) {
      if (o.id === b.id || o.size !== b.size || baseName(o.path).toLowerCase() !== baseName(b.path).toLowerCase() || seen.has(o.id)) continue;
      for (const k of INHERIT_FIELDS) if (o[k] !== undefined) b[k] = o[k];
      if (o.hasCover) { idb.get('covers', o.id).then((blob) => { if (blob) { idb.put('covers', b.id, blob); this.setCoverUrl(b.id, blob); } idb.del('covers', o.id); }); b.hasCover = true; }
      idb.get('text', o.id).then((t) => { if (t) idb.put('text', b.id, t); idb.del('text', o.id); });
      delete this.books[o.id];
      break;
    }
  }
  sweepMissing(okFolders, seen) {
    for (const b of Object.values(this.books)) {
      if (!this.sources.has(b.folderId)) { if (!b.missing) { b.missing = true; b.missingSince = Date.now(); } continue; }
      if (!okFolders.has(b.folderId)) continue;   // folder unavailable: leave the books alone (an unplugged drive)
      if (seen.has(b.id)) { if (b.missing) { b.missing = false; b.missingSince = null; } continue; }
      if (!b.missing) { b.missing = true; b.missingSince = Date.now(); }
    }
  }

  // ---------------------------------------------------------------- index --
  async fileOf(id) {
    const b = this.books[id];
    if (!b) return null;
    const src = this.sources.get(b.folderId);
    if (!src || !src.available) return null;
    const entries = this._entries?.get(src.id) || (await this.cacheEntries(src));
    const e = entries.get(b.relPath);
    if (!e) return null;
    try { return await e.file(); } catch { return null; }
  }
  async cacheEntries(src) {
    const list = (await listBooks(src)) || [];
    const map = new Map(list.map((e) => [e.relPath, e]));
    (this._entries ||= new Map()).set(src.id, map);
    return map;
  }
  pumpIndex() {
    if (this.indexing) return;
    let id, b;
    for (;;) {
      id = this.queue.shift();
      if (id === undefined) break;
      b = this.books[id];
      if (b && !b.missing) break;
      b = null;
    }
    if (!b) {
      this.scanState.active = false; this.scanState.phase = 'idle'; this.scanState.current = null;
      this._entries = null;
      this.emit('library:scan', this.scanState);
      return;
    }
    this.indexing = { id, started: Date.now() };
    this.scanState.active = true;
    this.scanState.current = b.title || baseName(b.path);
    this.emit('library:scan', this.scanState);
    this.indexOne(b).catch((e) => console.warn('[web-library] index', e));
  }
  async indexOne(b) {
    const id = b.id;
    let result;
    const file = await this.fileOf(id);
    if (!file) result = { error: 'file not available', metadata: {} };
    else {
      const job = { id, name: baseName(b.path), format: b.format, size: b.size, file };
      result = await Promise.race([indexBook(job), new Promise((r) => setTimeout(() => r({ error: 'timeout', metadata: {} }), INDEX_TIMEOUT_MS))]);
    }
    await this.onIndexResult(id, result);
    this.indexing = null;
    // a short breath between two books: the world keeps its frames while the shelves fill
    setTimeout(() => this.pumpIndex(), 15);
  }
  async onIndexResult(id, result) {
    const b = this.books[id];
    if (!b) return;
    if (result.error) {
      b.indexAttempts = (b.indexAttempts || 0) + 1;
      b.indexError = String(result.error);
      b.indexed = !/timeout|file not available/i.test(b.indexError) || b.indexAttempts >= MAX_INDEX_ATTEMPTS;
      if (!b.indexed && !this.queue.includes(id)) this.queue.push(id);
      if (result.cover && !b.hasCover) await this.storeCover(b, result, true);
    } else {
      b.indexError = null; b.indexAttempts = 0;
      const sample = applyIndexMeta(b, result);
      if (sample) idb.put('text', id, sample); else idb.del('text', id);
      if (result.cover) await this.storeCover(b, result, !!result.coverGenerated);
      b.coverColor = result.coverColor || b.coverColor || colorFromString(b.title);
      b.indexed = true;
      if (needsClassify(b)) this.autoClassify(b, sample);
    }
    this.scanState.done++;
    this.db.save();
    this.notifyBook(id);
    this.notify();
  }
  async storeCover(b, result, generated) {
    try {
      const blob = await dataUrlToBlob(result.cover);
      await idb.put('covers', b.id, blob);
      this.setCoverUrl(b.id, blob);
      b.hasCover = true;
      b.coverGenerated = generated;
      b.coverSource = 'book';
      b.coverVersion = (b.coverVersion || 0) + 1;
      // page 1 judged: a blank page, one flat colour or plain text is no cover
      if (generated || result.coverStats) { b.coverWeak = generated ? null : weakKind(result.coverStats); b.coverCheck = COVER_CHECK; }
    } catch (e) { console.warn('[web-library] cover store failed', e?.message || e); }
  }
  /** The departments that exist because of pre-sorted folders: classify() prefers their shelves. */
  folderDepartments() {
    if (this._folderDeps && Date.now() - this._folderDepsAt < 3000) return this._folderDeps;
    this._folderDeps = computeDepartments(Object.values(this.books).filter((x) => !x.missing && x.departmentSource === 'folder').map((x) => this.publicBook(x)));
    this._folderDepsAt = Date.now();
    return this._folderDeps;
  }
  /** The classifier of the desktop, offline (title, keywords, ISBN, the text sample); the desktop's refinement through
   *  the book catalogues is not here. */
  autoClassify(b, textSample) {
    const run = (sample) => {
      const res = classify({ ...b, textSample: sample || '' }, this.folderDepartments());
      setBookDepartment(b, res.departmentId || DEFAULT_DEPARTMENT, res.shelf || null, null);
      b.departmentSource = 'auto';
      b.classifyConfidence = res.confidence;
    };
    if (textSample !== undefined) run(textSample);
    else idb.get('text', b.id).then((t) => { run(t || ''); this.db.save(); this.notify(); });
  }

  // ---------------------------------------------------------------- the files for the reader --
  coverUrl(id) { return this.coverUrls.get(id) || ''; }
  /** A blob: URL of the book's file for foliate-js and pdf.js; the last few stay valid, older ones are revoked. */
  async bookUrl(id) {
    const file = await this.fileOf(id);
    if (!file) return null;
    const old = this.fileUrls.get(id);
    if (old) { try { URL.revokeObjectURL(old); } catch {} }
    const url = URL.createObjectURL(file);
    this.fileUrls.delete(id); this.fileUrls.set(id, url);
    while (this.fileUrls.size > 3) { const [k, u] = this.fileUrls.entries().next().value; try { URL.revokeObjectURL(u); } catch {} this.fileUrls.delete(k); }
    return url;
  }
  async readText(id) {
    const b = this.books[id];
    const file = await this.fileOf(id);
    if (!b || !file) return null;
    if (['epub', 'pdf', 'mobi', 'azw', 'azw3', 'cbz', 'docx', 'rtf'].includes(b.format)) return null;
    const text = await file.text();
    if (text.slice(0, 4096).includes('\0')) return null;
    if (b.format === 'md') { try { const { marked } = await import('marked'); return { html: marked.parse(text), title: b.title }; } catch { return { text, title: b.title }; } }
    return { text, title: b.title };
  }

  // ---------------------------------------------------------------- mutation --
  updateBook(id, patch) {
    const b = this.books[id];
    if (!b) return null;
    const before = b.progress;
    for (const [k, v] of Object.entries(patch || {})) if (UPDATE_FIELDS.includes(k)) b[k] = v;
    if (patch && 'language' in patch) b.language = normalizeLanguage(b.language);
    if (patch && 'progress' in patch) noteProgress(b, before);
    this.db.save();
    this.notifyBook(id);
    return this.publicBook(b);
  }
  markRead(id, read) {
    const b = this.books[id];
    if (!b) return null;
    if (setReadMark(b, !!read)) { this.db.save(); this.notifyBook(id); }
    return this.publicBook(b);
  }
  setDepartment(id, department, shelf) {
    const b = this.books[id];
    if (!b) return null;
    moveBook(b, department, shelf, Object.values(this.books).filter((x) => !x.missing));
    this._folderDeps = null;
    this.db.save(); this.notify();
    return this.publicBook(b);
  }
  openBook(id) {
    const b = this.books[id];
    if (!b) return null;
    b.timesOpened = (b.timesOpened || 0) + 1; b.lastRead = Date.now();
    const hist = this.db.get('history');
    hist.unshift({ id, at: Date.now(), type: 'open' });
    if (hist.length > 500) hist.length = 500;
    this.db.save();
    return this.publicBook(b);
  }
  borrow(id, flag) {
    const b = this.books[id];
    if (!b) return null;
    b.borrowed = !!flag; b.borrowedAt = flag ? Date.now() : null;
    const hist = this.db.get('history');
    hist.unshift({ id, at: Date.now(), type: flag ? 'borrow' : 'return', location: b.lastLocation, progress: b.progress });
    if (hist.length > 500) hist.length = 500;
    this.db.save(); this.notifyBook(id);
    return this.publicBook(b);
  }
  history(limit = 60) {
    return this.db.get('history').slice(0, limit)
      .map((h) => ({ ...h, book: this.books[h.id] && !this.books[h.id].missing ? this.publicBook(this.books[h.id]) : null }))
      .filter((h) => h.book);
  }
  addReadingTime(id, seconds) {
    const b = this.books[id];
    if (!b || !(seconds > 0)) return;
    seconds = Math.min(seconds, 600);
    b.readingSeconds = (b.readingSeconds || 0) + seconds; b.lastRead = Date.now();
    const day = localDay();
    const days = this.stats.get('days');
    days[day] = days[day] || { seconds: 0, books: {} };
    days[day].seconds += seconds;
    days[day].books[id] = (days[day].books[id] || 0) + seconds;
    this.stats.save(); this.db.save();
  }
  getStats() {
    const days = this.stats.get('days');
    const list = Object.entries(days).sort((a, b) => a[0].localeCompare(b[0]));
    const { streak, today } = streakOf(days);
    const totals = {};
    for (const [, v] of list) for (const [id, s] of Object.entries(v.books)) totals[id] = (totals[id] || 0) + s;
    const top = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id, s]) => ({ book: this.books[id] && !this.books[id].missing ? this.publicBook(this.books[id]) : null, seconds: s })).filter((x) => x.book);
    const books = Object.values(this.books).filter((b) => !b.missing);
    const year = new Date().getFullYear();
    const dups = this.dups || this.groupDuplicates();
    const read = booksReadIn(Object.values(this.books), year, (id) => dups.groupOf.get(id)?.id || null);
    const goal = { year, count: read.count, target: readingGoal(this.settings.get('shelves')?.readingGoal), ids: read.ids.slice(0, 60) };
    return { days: Object.fromEntries(list.slice(-90)), streak, readToday: today, top, totalSeconds: list.reduce((a, [, v]) => a + v.seconds, 0), totalBooks: books.length, started: books.filter((b) => b.progress > 0).length, finished: books.filter((b) => isFinished(b)).length, goal };
  }
  search(query, { limit = 100 } = {}) {
    return searchBooks(Object.values(this.books).filter((b) => !b.missing), query, { limit, publicBook: (b) => this.publicBook(b) });
  }
  /** The text samples (the first pages of every book) in place of the desktop's full-text index. */
  async searchText(query, limit = 40) {
    const q = (query || '').toLowerCase().trim();
    if (!q) return [];
    const out = [];
    const [keys, texts] = await Promise.all([idb.keys('text'), idb.getAll('text')]);
    for (let i = 0; i < (keys || []).length; i++) {
      const b = this.books[keys[i]];
      const sample = texts[i];
      if (!b || b.missing || typeof sample !== 'string') continue;
      const idx = sample.toLowerCase().indexOf(q);
      if (idx >= 0) {
        out.push({ book: this.publicBook(b), excerpt: sample.slice(Math.max(0, idx - 80), idx + 120).replace(/\s+/g, ' ') });
        if (out.length >= limit) break;
      }
    }
    return out;
  }
  getBook(id) { const b = this.books[id]; return b ? this.publicBook(b) : null; }
  reindex(id) { const b = this.books[id]; if (b) { b.indexed = false; b.indexAttempts = 0; if (!this.queue.includes(id)) this.queue.push(id); this.pumpIndex(); } }
  reindexAll() { for (const b of Object.values(this.books)) { if (!b.missing) { b.indexed = false; b.indexAttempts = 0; if (!this.queue.includes(b.id)) this.queue.push(b.id); } } this.scanState = { active: true, done: 0, total: this.queue.length, phase: 'index', unavailable: [] }; this.pumpIndex(); }
  /** Everything written now (the checks wait for it before a reload). */
  flush() { return Promise.all([this.db.flush(), this.stats.flush(), this.settings.flush()]); }
}

export { PENDING_SHELF };
