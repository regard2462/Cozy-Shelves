// Library manager: scanning folders, indexing (via hidden renderer), classification,
// persistence of reading state, borrowing, bookmarks, annotations and statistics.
//
// Departments come from two sources:
//  • a pre-sorted ('structured') books folder: every top-level folder IS a department (id `folder:<name>`,
//    shown without its numbering), the folder a book sits in below it is its shelf ("Regal"). Departments
//    follow the natural order of the folder names, shelves the order of their folders ("01 …" before "02 …").
//  • an 'auto' books folder: books are classified into the FIXED taxonomy (library/taxonomy.js).
// Books directly in a structured root and records that cannot be placed land in "Verschiedenes".
// Windows shortcuts (.lnk) in a books folder are no books: a shortcut to a book marks it as a must-read.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Store } = require('../store');
const { classify, extractIsbn, lookupOnline, stripNumbering, norm, departmentIdFromFolder, folderDepartmentId, isFolderDepartmentId, folderDisplayName, isLeftoverFolder } = require('./classify');
const { DEPARTMENTS, DEFAULT_DEPARTMENT, departmentById, departmentOrder, legacyDepartmentId } = require('./taxonomy');
const { extractTextAndMeta } = require('./textformats');
const { weakKind, COVER_CHECK } = require('./cover-match');
const { normalizeLanguage } = require('./language');
const { isFinished, noteProgress, setReadMark, migrateFinished, streakOf, booksReadIn, readingGoal } = require('./reading-log');
const { findDuplicates } = require('./duplicates');
// the pure part (names, departments and shelves, index results), shared with the browser version (shelving.js)
const S = require('./shelving');
const { BOOK_EXT, FORMAT_OF, MAX_DEPTH, IGNORE_DIRS, MIN_FILE_SIZE, TEXT_SAMPLE_MAX, PENDING_SHELF, INHERIT_FIELDS, UPDATE_FIELDS, isNoteOrTemp, skipDir, clean, localDay, looksLikeAuthor, titleFromFilename, authorFromFilename, guessLanguage, colorFromString, isChessBook } = S;

const ONLINE_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const ONLINE_CACHE_MAX = 4000;
const MISSING_PURGE_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_INDEX_ATTEMPTS = 3;
const SCHEMA = 3;

class Library {
  /**
   * @param readShortcut (file) → absolute target path of a Windows shortcut or a symbolic link, or null (electron/main.js)
   */
  constructor({ userData, settings, getIndexer, emit, readShortcut = null }) {
    this.userData = userData;
    this.settings = settings;
    this.getIndexer = getIndexer;
    this.readShortcut = readShortcut;
    this.shortcutCache = new Map();   // .lnk path → { mtime, target }
    this.emit = emit; // (channel, payload) → broadcast to renderer
    this.coversDir = path.join(userData, 'covers');
    this.textDir = path.join(userData, 'text');
    fs.mkdirSync(this.coversDir, { recursive: true });
    fs.mkdirSync(this.textDir, { recursive: true });
    this.db = new Store(path.join(userData, 'library.json'), { books: {}, history: [], onlineCache: {}, schema: 0 });
    this.stats = new Store(path.join(userData, 'stats.json'), { days: {}, sessions: [] });
    this.books = this.db.get('books');
    this.queue = [];
    this.indexing = null;
    this.scanState = { active: false, done: 0, total: 0, phase: 'idle', unavailable: [] };
    this.onlineQueue = [];
    this.onlineBusy = false;
    this.watchers = [];
    this.watchWaits = new Map();      // file still being copied → timer of its next size check (watchError)
    this.watchErrorCodes = new Set(); // error codes of the watchers already logged
    this.watchPollMs = 2000;
    this._notifyTimer = null;
    this.idleListeners = [];
    this.migrate();
  }

  // ------------------------------------------------------------- migration --
  /** Bring an existing library.json onto the fixed department set (runs once). */
  migrate() {
    const books = Object.values(this.books);
    const schema = this.db.get('schema') || 0;
    let changed = false;
    const spill = [], relang = [];
    const reshelve = [];   // [book, its text sample]: shelved again below
    for (const b of books) {
      if (!b || typeof b !== 'object') continue;
      // no department id (the oldest records), or an id the fixed set no longer has
      if (!b.departmentId || (!departmentById(b.departmentId) && !isFolderDepartmentId(b.departmentId))) {
        const legacy = legacyDepartmentId(b.department);
        if (!legacy && b.departmentSource !== 'manual' && b.departmentSource !== 'folder') {
          // a department of an earlier version that no longer exists: the book is shelved again, like a new book in
          // an automatic folder; its reading data (position, bookmarks, notes …) stays as it is
          this.setBookDepartment(b, DEFAULT_DEPARTMENT, null, null);
          reshelve.push([b, typeof b.textSample === 'string' ? b.textSample : undefined]);
        } else {
          const id = legacy || (b.department ? departmentIdFromFolder(b.department) : null) || DEFAULT_DEPARTMENT;
          b.departmentId = id;
          const dep = departmentById(id);
          // Hand-sorted books keep their shelf; their department label becomes the canonical one.
          if (b.departmentSource === 'folder' && b.department && !b.shelf) b.shelf = stripNumbering(b.department) || null;
          b.department = dep ? dep.de : 'Verschiedenes';
        }
        changed = true;
      }
      if (b.missing && !b.missingSince) { b.missingSince = Date.now(); changed = true; }
      if (typeof b.textSample === 'string' && b.textSample) { spill.push([b.id, b.textSample]); delete b.textSample; changed = true; }
      // 0.7: the language as two letters or nothing ('Germa', 'eng', 'DE-DE', '<¦'); books read before finishedAt existed
      const lang = normalizeLanguage(b.language);
      if ((b.language ?? null) !== lang) { if (b.language && !lang) relang.push(b.id); b.language = lang; changed = true; }
      if (migrateFinished(b)) changed = true;
    }
    // shelved again by the classifier, offline: title, metadata and the text sample (the online refinement follows when
    // the book is indexed again)
    if (reshelve.length) {
      const folders = this.folderDepartments();
      for (const [b, sample] of reshelve) {
        const res = classify({ ...b, textSample: sample !== undefined ? sample : this.readTextSample(b.id) }, folders);
        this.setBookDepartment(b, res.departmentId, res.shelf || null, null);
        b.departmentSource = 'auto';
        b.classifyConfidence = res.confidence;
      }
    }
    if (schema < 1) { this.db.set('schema', 1); changed = true; }
    // schema 2: isChess was true for every book of "Spiele & Schach" (cards, Sudoku, poker …)
    if (schema < 2) {
      for (const b of books) if (b && b.isChess) b.isChess = isChessBook(b, this.readTextSample(b.id));
      this.db.set('schema', 2); changed = true;
    }
    // schema 3: the top-level folders of a pre-sorted books folder are departments of their own (they used to
    // be mapped into the fixed taxonomy, a folder like "Kochbücher" ended up in "Verschiedenes"). The scan does the same
    // for every book it finds; doing it here already gives the first frame the right rooms.
    if (schema < SCHEMA) {
      for (const b of books) if (b && b.departmentSource === 'folder' && b.folderMode === 'structured' && b.relPath) this.assignFromFolder(b, { mode: 'structured' });
      this.db.set('schema', SCHEMA); changed = true;
    }
    if (spill.length) this.spillTextSamples(spill);
    if (relang.length) this.guessLanguages(relang);
    this.purgeMissing();
    if (changed) this.db.save();
  }
  /** Books whose language was no language at all ('<¦', 'ƒ*ªþ×'): guessed from their text sample, in the background. */
  guessLanguages(ids) {
    const step = () => {
      for (const id of ids.splice(0, 40)) {
        const b = this.books[id];
        if (b && !b.language) b.language = guessLanguage(this.readTextSample(id) || b.title);
      }
      if (ids.length) setTimeout(step, 30);
      else { this.db.save(); this.notify(); }
    };
    setTimeout(step, 80);
  }
  /** Move textSample blobs out of library.json into <userData>/text/<id>.txt, in the background. */
  spillTextSamples(pairs) {
    const step = () => {
      const chunk = pairs.splice(0, 40);
      for (const [id, text] of chunk) this.writeTextSample(id, text);
      if (pairs.length) setTimeout(step, 30);
      else this.db.save();
    };
    setTimeout(step, 50);
  }
  /** Drop long-missing records (and their cover/text files) unless they carry user data. */
  purgeMissing() {
    const now = Date.now();
    let removed = 0;
    for (const b of Object.values(this.books)) {
      if (!b.missing || !b.missingSince || now - b.missingSince < MISSING_PURGE_MS) continue;
      const hasUserData = (b.bookmarks || []).length || (b.annotations || []).length || (b.positions || []).length || b.progress > 0.02 || b.readingSeconds > 300 || !!b.finishedAt;
      if (hasUserData) { b.description = null; this.removeTextSample(b.id); continue; }
      this.removeTextSample(b.id);
      try { fs.rmSync(this.coverPath(b.id), { force: true }); } catch {}
      try { fs.rmSync(this.coverBackupPath(b.id), { force: true }); } catch {}
      delete this.books[b.id];
      removed++;
    }
    if (removed) { console.log('[library] purged', removed, 'long-missing books'); this.db.save(); }
  }

  // ---------------------------------------------------------------- state --
  publicBook(b) { return S.publicBook(b, this.dups); }
  getState() {
    const live = Object.values(this.books).filter((b) => !b.missing);
    this.groupDuplicates(live);
    const books = live.map((b) => this.publicBook(b));
    return { books, departments: this.computeDepartments(books), folders: this.settings.get('folders'), scan: this.scanState };
  }
  /**
   * The copies of the same book (duplicates.js), with the title and author the shelves show (from the file name until the
   * book is indexed). Kept in this.dups for publicBook.
   */
  groupDuplicates(live = Object.values(this.books).filter((b) => !b.missing)) {
    this.dups = findDuplicates(live.map((b) => ({ id: b.id, title: b.title || titleFromFilename(b.path), author: b.author || authorFromFilename(b.path) || '', year: b.year, isbn: b.isbn, contentHash: b.contentHash, size: b.size })));
    return this.dups;
  }
  /**
   * Departments in a stable order, never by book count (the 3D room must not reshuffle): first the user's own
   * folders in the natural order of their names ("sonstiges" and the like last), then the departments of the
   * fixed taxonomy in its canonical order, "Verschiedenes" at the very end.
   * Contract: { id, name, nameEn, kind: 'folder'|'taxonomy', count, source, shelves: [{ name, key, bookIds, neutral? }] }.
   * A neutral shelf holds the books that lie directly in a department's folder: it carries the department's
   * name and gets no label of its own in the room.
   */
  computeDepartments(books) { return S.computeDepartments(books, (id) => this.books[id]?.title || ''); }
  notify() {
    clearTimeout(this._notifyTimer);
    this._notifyTimer = setTimeout(() => this.emit('library:update', this.getState()), 250);
  }
  notifyBook(id) {
    const b = this.books[id];
    if (b) this.emit('library:book', this.publicBook(b));
  }

  // ---------------------------------------------------------------- scan ---
  async scanAll() {
    const folders = this.settings.get('folders') || [];
    this.scanState = { active: true, done: 0, total: 0, phase: 'scan', unavailable: [] };
    this.emit('library:scan', this.scanState);
    const seen = new Set();
    const okFolders = new Set();
    const shortcuts = [];
    for (const f of folders) {
      let ok = false;
      try { ok = await this.scanFolder(f, seen, shortcuts); } catch (e) { console.error('[library] scan failed', f.path, e); }
      if (ok) okFolders.add(f.path);
      else this.scanState.unavailable.push(f.path);
    }
    this.sweepMissing(folders, okFolders, seen);
    this.applyMustRead(shortcuts, okFolders);
    this.db.save();
    this.scanState.phase = 'index';
    this.scanState.total = this.queue.length;
    this.scanState.done = 0;
    this.notify();
    this.pumpIndex();
    this.setupWatchers(folders);
  }

  /**
   * Mark books as missing — but only in folders that actually scanned. An unplugged
   * drive or an unreadable share must not empty the shelves.
   */
  sweepMissing(folders, okFolders, seen) {
    const listed = new Set(folders.map((f) => f.path));
    for (const b of Object.values(this.books)) {
      const stillListed = listed.has(b.folder);
      const folderOk = okFolders.has(b.folder);
      if (!stillListed) { if (!b.missing) { b.missing = true; b.missingSince = Date.now(); } continue; }
      if (!folderOk) continue;                       // folder unavailable → leave the books alone
      if (seen.has(b.id)) { if (b.missing) { b.missing = false; b.missingSince = null; } continue; }
      if (!b.missing) { b.missing = true; b.missingSince = Date.now(); }
    }
  }

  /**
   * @param shortcuts  collects the Windows shortcuts (.lnk) and the symbolic links found on the way (see applyMustRead)
   * @returns true when the folder was readable (and plausibly complete).
   */
  async scanFolder(folderEntry, seen, shortcuts = null) {
    const root = folderEntry.path;
    let st;
    try { st = fs.statSync(root); } catch { return false; }
    if (!st.isDirectory()) return false;
    const files = [], links = new Set();
    if (!walk(root, files, 0, links)) return false;  // root unreadable
    let found = 0;
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      // a symbolic link to a book (Linux, macOS) is what a shortcut is on Windows: a must-read mark, no book of its own
      if (ext === '.lnk' || links.has(file)) { shortcuts?.push(file); continue; }
      if (!BOOK_EXT.has(ext)) continue;
      const base = path.basename(file);
      if (isNoteOrTemp(base, ext)) continue;
      let fst;
      try { fst = fs.statSync(file); } catch { continue; }
      if (fst.size < MIN_FILE_SIZE) continue;
      const rel = path.relative(root, file);
      // resource folders of saved web pages are skipped by walk(); this catches the classic names anywhere
      if (/(_files|_dateien)[\\/]/i.test(rel)) continue;
      const id = idFor(file);
      seen.add(id);
      found++;
      let b = this.books[id];
      const changed = !b || b.size !== fst.size || b.mtime !== fst.mtimeMs;
      if (!b) {
        b = this.books[id] = {
          id, path: file, relPath: rel, folder: root, folderMode: folderEntry.mode || 'structured', format: FORMAT_OF(ext),
          size: fst.size, mtime: fst.mtimeMs, addedAt: Date.now(), bookmarks: [], annotations: [], positions: [], readingSeconds: 0, timesOpened: 0,
          progress: 0, lastLocation: null, borrowed: false, indexed: false, hasCover: false, contentHash: contentHash(file, fst.size),
        };
        this.inheritFromMissing(b, seen);
      } else {
        b.missing = false; b.missingSince = null; b.path = file; b.relPath = rel; b.folder = root; b.folderMode = folderEntry.mode || 'structured';
        if (changed) { b.size = fst.size; b.mtime = fst.mtimeMs; b.indexed = false; b.indexAttempts = 0; b.contentHash = contentHash(file, fst.size); }
        else if (!b.contentHash) b.contentHash = contentHash(file, fst.size);
      }
      // when the file came into the folder (its creation time): "Zuletzt hinzugefügt" on the shelves (shelf-order.js)
      if (!b.born) b.born = Math.round(Math.min(Date.now(), fst.birthtimeMs > 0 ? fst.birthtimeMs : fst.mtimeMs));
      this.assignFromFolder(b, folderEntry);
      if (!b.indexed && !this.queue.includes(id)) this.queue.push(id);
    }
    // sanity brake: a folder that used to hold books and now yields none is treated as unavailable
    if (found === 0) {
      const had = Object.values(this.books).some((b) => b.folder === root && !b.missing);
      if (had) { console.warn('[library] folder yielded no books, treating as unavailable:', root); return false; }
    }
    return true;
  }

  inheritFromMissing(b, seen) {
    // A book that moved: same content (hash of size + first 64 KB) → carry over reading state.
    // The predecessor may not be flagged `missing` yet (the sweep runs after the scan), so a
    // record whose file is gone counts as well — otherwise moving a book loses its bookmarks.
    if (!b.contentHash) return;
    for (const o of Object.values(this.books)) {
      if (o.id === b.id || o.size !== b.size || o.contentHash !== b.contentHash) continue;
      if (!o.missing && (seen?.has(o.id) || fs.existsSync(o.path))) continue;
      // the reading state, the metadata, the cover, read or not, the series, when it arrived, the web metadata
      for (const k of INHERIT_FIELDS) if (o[k] !== undefined) b[k] = o[k];
      if (o.hasCover) {
        try { fs.copyFileSync(this.coverPath(o.id), this.coverPath(b.id)); b.hasCover = true; } catch {}
        try { fs.rmSync(this.coverPath(o.id), { force: true }); } catch {}
      }
      // the book's own cover, kept while a cover from the internet is shown
      try { if (fs.existsSync(this.coverBackupPath(o.id))) fs.renameSync(this.coverBackupPath(o.id), this.coverBackupPath(b.id)); } catch {}
      try { fs.renameSync(this.textPath(o.id), this.textPath(b.id)); } catch {}
      delete this.books[o.id];
      break;
    }
  }

  /**
   * Pre-sorted ('structured') folders: the top-level folder IS the book's department, the folder the file
   * actually sits in below it is its shelf (the most specific label the user gave it). A file directly in the
   * top-level folder has no shelf of its own (no second label with the department's name). Files directly in
   * the books folder itself go to "Verschiedenes". 'auto' folders keep the fixed taxonomy.
   */
  assignFromFolder(b, folderEntry) { S.assignFromFolder(b, folderEntry, (x) => this.autoClassify(x)); }

  /** A department of the fixed taxonomy (auto mode, "Verschiedenes", a manual choice). */
  setBookDepartment(b, departmentId, shelf, shelfKey) { S.setBookDepartment(b, departmentId, shelf, shelfKey); }
  /** The department of a top-level folder (raw name, e.g. "02 Schach") and the shelf of a sub folder (raw name). */
  setFolderDepartment(b, topRaw, shelfRaw) { S.setFolderDepartment(b, topRaw, shelfRaw); }

  /**
   * Windows shortcuts and symbolic links in the books folders ("00 Must-Read" holds links to the books to read
   * first): every book a shortcut points to is a must-read. The shortcuts themselves are no books. Books in folders that could not be
   * read keep their mark.
   */
  applyMustRead(shortcuts, okFolders) {
    if (!this.readShortcut) return false;
    const marked = new Set();
    const live = Object.values(this.books).filter((b) => !b.missing);
    const key = (p) => path.normalize(p).toLowerCase();
    for (const lnk of shortcuts || []) {
      let target = null;
      try {
        const mtime = fs.statSync(lnk).mtimeMs;
        const hit = this.shortcutCache.get(lnk);
        if (hit && hit.mtime === mtime) target = hit.target;
        else { target = this.readShortcut(lnk) || null; this.shortcutCache.set(lnk, { mtime, target }); }
      } catch { target = null; }
      if (!target) continue;
      // a link to a folder (a symbolic link or junction to a sub folder, a shortcut to one) names no book: without this,
      // the folder's path was taken for a cut-off one, and the single book in the folder became a must-read
      try { if (fs.statSync(target).isDirectory()) continue; } catch { /* a target that is gone or cut off: see below */ }
      let b = this.books[idFor(target)];
      // Windows hands out at most 260 characters of the target: a longer path arrives cut off. The one book whose
      // path starts with it, or else whose file name starts with the shortcut's name, is meant.
      if (!b || b.missing) {
        const t = key(target);
        let cands = live.filter((x) => key(x.path).startsWith(t));
        if (cands.length !== 1) { const n = path.basename(lnk, path.extname(lnk)).toLowerCase(); cands = live.filter((x) => path.basename(x.path).toLowerCase().startsWith(n)); }
        b = cands.length === 1 ? cands[0] : null;
      }
      if (b && !b.missing) marked.add(b.id);
    }
    let changed = false;
    for (const b of Object.values(this.books)) {
      if (okFolders && !okFolders.has(b.folder)) continue;
      const want = marked.has(b.id);
      if (!!b.mustRead !== want) { if (want) b.mustRead = true; else delete b.mustRead; changed = true; }
    }
    return changed;
  }

  setupWatchers(folders) {
    for (const w of this.watchers) { try { w.close(); } catch {} }
    this.watchers = [];
    for (const t of this.watchWaits.values()) clearTimeout(t);
    this.watchWaits.clear();
    let chokidar;
    try { chokidar = require('chokidar'); } catch { return; }
    for (const f of folders) {
      if (!fs.existsSync(f.path)) continue;
      try {
        const w = chokidar.watch(f.path, { ignoreInitial: true, depth: MAX_DEPTH, awaitWriteFinish: { stabilityThreshold: 1500 }, ignored: watchIgnored });
        let timer;
        const trigger = () => { clearTimeout(timer); timer = setTimeout(() => this.rescanQuiet(), 2500); };
        w.on('add', trigger).on('unlink', trigger).on('change', trigger).on('addDir', trigger).on('unlinkDir', trigger);
        w.on('error', (e) => this.watchError(w, e, trigger));
        this.watchers.push(w);
      } catch (e) { console.error('[library] watcher failed', e.message); }
    }
  }
  /**
   * A large file that is still being copied into a books folder can answer chokidar's size check with EBUSY (or
   * EPERM). chokidar then reports an error in place of the new book and from then on ignores the writes to that file.
   * Here the file is checked every watchPollMs until it can be read and its size holds, then the folders are scanned
   * again. Without a listener the error would be thrown as an uncaught exception.
   */
  watchError(w, err, trigger) {
    const code = err?.code || err?.message || String(err);
    if (!this.watchErrorCodes.has(code)) { this.watchErrorCodes.add(code); console.warn('[library] watcher:', code, err?.path || ''); }
    const file = err?.path;
    if (!file || !path.isAbsolute(file)) { trigger(); return; }
    w._pendingWrites?.delete?.(file);   // chokidar's own wait for this file ended with the error: let it watch the file again
    if (this.watchWaits.has(file)) return;
    let last = -1, checks = 0;
    const check = () => {
      let size = -1;
      try { size = fs.statSync(file).size; } catch (e) { if (e.code === 'ENOENT') { this.watchWaits.delete(file); return; } }
      if ((size >= 0 && size === last) || ++checks > 900) { this.watchWaits.delete(file); trigger(); return; }
      last = size;
      this.watchWaits.set(file, setTimeout(check, this.watchPollMs));
    };
    this.watchWaits.set(file, setTimeout(check, this.watchPollMs));
  }
  async rescanQuiet() {
    const folders = this.settings.get('folders') || [];
    const seen = new Set();
    const okFolders = new Set();
    const unavailable = [];
    const shortcuts = [];
    for (const f of folders) {
      let ok = false;
      try { ok = await this.scanFolder(f, seen, shortcuts); } catch {}
      if (ok) okFolders.add(f.path); else unavailable.push(f.path);
    }
    this.sweepMissing(folders, okFolders, seen);
    this.applyMustRead(shortcuts, okFolders);
    this.db.save();
    this.scanState.unavailable = unavailable;
    this.scanState.total = this.scanState.done + this.queue.length;
    this.notify();
    this.pumpIndex();
  }

  // ---------------------------------------------------------------- index --
  coverPath(id) { return path.join(this.coversDir, id + '.jpg'); }
  /** The book's own cover (page 1 or the title card) while one from the internet is shown. */
  coverBackupPath(id) { return path.join(this.coversDir, id + '.book.jpg'); }
  textPath(id) { return path.join(this.textDir, id + '.txt'); }
  writeTextSample(id, text) {
    try {
      if (!text) { this.removeTextSample(id); return; }
      fs.writeFileSync(this.textPath(id), String(text).slice(0, TEXT_SAMPLE_MAX), 'utf8');
    } catch (e) { console.warn('[library] text write failed', id, e.message); }
  }
  readTextSample(id) {
    try { return fs.readFileSync(this.textPath(id), 'utf8'); } catch { return ''; }
  }
  removeTextSample(id) { try { fs.rmSync(this.textPath(id), { force: true }); } catch {} }

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
      this.scanState.active = false; this.scanState.phase = 'idle';
      this.emit('library:scan', this.scanState);
      for (const fn of this.idleListeners) { try { fn(); } catch (e) { console.warn('[library] idle listener', e); } }
      return;
    }
    const indexer = this.getIndexer();
    if (!indexer) { this.queue.unshift(id); setTimeout(() => this.pumpIndex(), 1000); return; }
    this.indexing = { id, started: Date.now() };
    this.scanState.active = true;
    this.scanState.current = b.title || path.basename(b.path);
    this.emit('library:scan', this.scanState);
    indexer.webContents.send('index-job', { id, url: `book://${id}/${encodeURIComponent(path.basename(b.path))}`, format: b.format, name: path.basename(b.path), size: b.size });
    // watchdog scales with file size (a 400 MB PDF on a cold disk is not "broken")
    const budget = Math.min(12 * 60000, Math.max(60000, 45000 + (b.size / 1048576) * 3000));
    this.indexTimeout = setTimeout(() => {
      if (this.indexing && this.indexing.id === id) {
        console.warn('[library] index timeout', b.path);
        this.onIndexResult(id, { error: 'timeout' });
      }
    }, budget);
  }

  /**
   * The page of the indexer window died (electron/main.js): the book it was reading counts as a failed try and goes to
   * the end of the queue; the queue waits for the new page (getIndexer gives null until it says ready).
   */
  indexerGone(reason) {
    if (this.indexing) this.onIndexResult(this.indexing.id, { error: 'crash: ' + (reason || 'renderer gone') });
  }

  async onIndexResult(id, result) {
    const current = !!(this.indexing && this.indexing.id === id);
    if (current) { clearTimeout(this.indexTimeout); this.indexing = null; }
    const b = this.books[id];
    if (!b) { if (current) setTimeout(() => this.pumpIndex(), 10); return; }
    if (!current && (!result || result.error)) return;   // late failure for a book we moved on from
    if (result.error) {
      const transient = /timeout|crash|destroy|busy|abort|network|EBUSY|EPERM/i.test(String(result.error));
      b.indexAttempts = (b.indexAttempts || 0) + 1;
      b.indexError = String(result.error);
      b.indexed = !transient || b.indexAttempts >= MAX_INDEX_ATTEMPTS;
      // retry at the end of the queue; the try counts as done below, so the total grows with it (the HUD shows done/total)
      if (!b.indexed && !this.queue.includes(id)) { this.queue.push(id); if (current) this.scanState.total++; }
    } else {
      b.indexError = null;
      b.indexAttempts = 0;
      // the indexer window cannot open DOCX and RTF: their text and metadata come from the main process
      if ((b.format === 'docx' || b.format === 'rtf') && !result.textSample) result = await withMainProcessText(b, result);
      // title, author, language, series, publisher, year, subjects, description, pages, ISBN, chess (shelving.js)
      const sample = S.applyIndexMeta(b, result);
      this.writeTextSample(id, sample);
      let keptWeb = false;
      if (result.cover) {
        try {
          const buf = Buffer.from(result.cover.split(',')[1], 'base64');
          const generated = !!result.coverGenerated;   // the indexer's title card, not an image from the book
          // page 1 judged: a blank page, one flat colour or plain text is no cover (web-covers.js looks for one)
          const weak = generated || !result.coverStats ? null : weakKind(result.coverStats);
          if (b.coverSource === 'web' && (generated || weak || b.coverChoice === 'web' || b.coverChoice === 'own')) {
            // still no cover of its own (or the reader picked the one from the internet or a picture of their own): it
            // stays, the book's own one is kept behind it
            fs.writeFileSync(this.coverBackupPath(id), buf);
            b.coverBook = { generated, color: result.coverColor || null };
            keptWeb = true;
          } else {
            fs.writeFileSync(this.coverPath(id), buf);
            if (b.coverSource === 'web') { delete b.coverWeb; delete b.coverBook; b.coverSource = 'book'; try { fs.rmSync(this.coverBackupPath(id), { force: true }); } catch {} }
            b.hasCover = true;
            b.coverGenerated = generated;
            b.coverVersion = (b.coverVersion || 0) + 1;
          }
          if (generated || result.coverStats) { b.coverWeak = weak; b.coverCheck = COVER_CHECK; }
        } catch (e) { console.error('[library] cover write failed', e.message); }
      }
      if (!keptWeb) b.coverColor = result.coverColor || b.coverColor || colorFromString(b.title);
      b.indexed = true;
      if (S.needsClassify(b)) this.autoClassify(b, sample);
    }
    if (current) this.scanState.done++;
    this.db.save();
    this.notifyBook(id);
    this.notify();
    if (current) setTimeout(() => this.pumpIndex(), 10);
  }

  /**
   * The departments that already exist because of pre-sorted folders — classify() prefers
   * their shelves. Memoised: this is O(library) and used to run once per indexed book.
   */
  folderDepartments() {
    if (this._folderDeps && Date.now() - this._folderDepsAt < 3000) return this._folderDeps;
    this._folderDeps = this.computeDepartments(Object.values(this.books).filter((x) => !x.missing && x.departmentSource === 'folder').map((x) => this.publicBook(x)));
    this._folderDepsAt = Date.now();
    return this._folderDeps;
  }

  autoClassify(b, textSample) {
    const res = classify({ ...b, textSample: textSample !== undefined ? textSample : this.readTextSample(b.id) }, this.folderDepartments());
    this.setBookDepartment(b, res.departmentId, res.shelf || null, null);
    b.departmentSource = 'auto';
    b.classifyConfidence = res.confidence;
    // refine silently online (subjects/description) then reclassify if confidence is low
    this.onlineQueue.push(b.id);
    this.pumpOnline();
  }

  pruneOnlineCache(cache) {
    const keys = Object.keys(cache);
    if (keys.length <= ONLINE_CACHE_MAX) return;
    keys.sort((a, b) => (cache[a]?.at || 0) - (cache[b]?.at || 0));
    for (const k of keys.slice(0, keys.length - ONLINE_CACHE_MAX)) delete cache[k];
  }

  async pumpOnline() {
    if (this.onlineBusy || !this.onlineQueue.length) return;
    this.onlineBusy = true;
    const id = this.onlineQueue.shift();
    const b = this.books[id];
    try {
      if (b && !b.missing) {
        const cacheKey = b.isbn || ('t:' + (b.title || '').toLowerCase().slice(0, 60));
        const cache = this.db.get('onlineCache');
        const rec = cache[cacheKey];
        let info = rec && rec.info && Date.now() - (rec.at || 0) < ONLINE_CACHE_TTL ? rec.info : null;
        if (!info) {
          // lookupOnline throws when no service could be reached — never cache that.
          try {
            info = await lookupOnline(b);
            cache[cacheKey] = { at: Date.now(), info };
            this.pruneOnlineCache(cache);
            this.db.save();
          } catch (e) { console.warn('[library] metadata service unreachable:', e.message); info = null; }
        }
        if (info && info.source) {
          b.onlineSubjects = info.subjects || [];
          // "Metadaten aus dem Internet ergänzen" off: the lookup still sorts the book, but fills in nothing
          const fill = this.settings.get?.('webMetadata') !== false;
          if (fill && !b.description && info.description) b.description = clean(info.description, 2000);
          if (fill && !b.year && info.year) b.year = info.year;
          if (fill && !b.publisher && info.publisher) b.publisher = info.publisher;
          if (fill && (!b.author || b.author.length < 3) && info.author) b.author = info.author;
          if (b.departmentSource === 'auto') {
            const res = classify({ ...b, textSample: this.readTextSample(b.id) }, this.folderDepartments());
            if (res.confidence >= (b.classifyConfidence || 0) - 0.05) {
              this.setBookDepartment(b, res.departmentId, res.shelf || b.shelf || null, b.shelfKey);
              b.classifyConfidence = res.confidence;
            }
          }
          this.db.save();
          this.notifyBook(id);
          this.notify();
        }
      }
    } catch (e) { console.warn('[library] online lookup failed', e.message); }
    this.onlineBusy = false;
    setTimeout(() => this.pumpOnline(), 1200);
  }

  // ------------------------------------------------------------- mutation --
  updateBook(id, patch) {
    const b = this.books[id];
    if (!b) return null;
    const before = b.progress;
    for (const [k, v] of Object.entries(patch || {})) if (UPDATE_FIELDS.includes(k)) b[k] = v;
    if (patch && 'language' in patch) b.language = normalizeLanguage(b.language);
    // read up to 97 %: the book counts as read from now on (reading-log.js)
    if (patch && 'progress' in patch) noteProgress(b, before);
    this.db.save();
    this.notifyBook(id);
    return this.publicBook(b);
  }
  /** "Als gelesen markieren" (read true) / "Als ungelesen markieren" (false): reading-log.js setReadMark. */
  markRead(id, read) {
    const b = this.books[id];
    if (!b) return null;
    if (setReadMark(b, !!read)) { this.db.save(); this.notifyBook(id); }
    return this.publicBook(b);
  }
  /**
   * Move a book by hand. `department` is a department id ('folder:…' or a taxonomy id) or a display name:
   *  • the name of an existing folder department → that department (the user's own folders win),
   *  • a department of the fixed taxonomy (also legacy names) → that department,
   *  • any other name → a department of that name of its own ("Neue Abteilung" in the terminal).
   * A shelf with the department's own name, or none, means the department's neutral shelf. The choice is
   * sticky: the scanner leaves manual books alone, even when their file sits in another folder.
   */
  setDepartment(id, department, shelf) {
    const b = this.books[id];
    if (!b) return null;
    S.moveBook(b, department, shelf, Object.values(this.books).filter((x) => !x.missing));
    this._folderDeps = null;
    this.db.save(); this.notify();
    return this.publicBook(b);
  }
  /** { kind: 'folder'|'taxonomy', id, name, key?, shelves? } for a department id or name (see setDepartment). */
  resolveDepartment(department) { return S.resolveDepartment(department, Object.values(this.books).filter((x) => !x.missing)); }
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
    // the streak: local calendar days in a row with at least 5 minutes of reading (reading-log.js)
    const { streak, today } = streakOf(days);
    const totals = {};
    for (const [, v] of list) for (const [id, s] of Object.entries(v.books)) totals[id] = (totals[id] || 0) + s;
    const top = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id, s]) => ({ book: this.books[id] && !this.books[id].missing ? this.publicBook(this.books[id]) : null, seconds: s })).filter((x) => x.book);
    const books = Object.values(this.books).filter((b) => !b.missing);
    // the reading goal: the books read this year (a book that exists twice once; missing files still count)
    const year = new Date().getFullYear();
    const dups = this.dups || this.groupDuplicates();
    const read = booksReadIn(Object.values(this.books), year, (id) => dups.groupOf.get(id)?.id || null);
    const goal = { year, count: read.count, target: readingGoal(this.settings.get?.('shelves')?.readingGoal), ids: read.ids.slice(0, 60) };
    return { days: Object.fromEntries(list.slice(-90)), streak, readToday: today, top, totalSeconds: list.reduce((a, [, v]) => a + v.seconds, 0), totalBooks: books.length, started: books.filter((b) => b.progress > 0).length, finished: books.filter((b) => isFinished(b)).length, goal };
  }
  search(query, { limit = 100 } = {}) {
    return S.searchBooks(Object.values(this.books).filter((b) => !b.missing), query, { limit, publicBook: (b) => this.publicBook(b) });
  }
  /** Full-text search over the indexed text samples (stored next to the DB, not inside it). */
  searchText(query, limit = 40, { samples = false } = {}) {
    // the full-text index answers when there is one (electron/search/fulltext.js sets textSearch), the samples otherwise
    if (this.textSearch && !samples) return this.textSearch(query, limit).then((r) => r || this.searchText(query, limit, { samples: true }));
    const q = (query || '').toLowerCase().trim();
    if (!q) return [];
    const out = [];
    let reads = 0;
    for (const b of Object.values(this.books)) {
      if (b.missing || b.textLength === 0) continue;
      if (reads++ > 4000) break;
      const sample = this.readTextSample(b.id);
      if (!sample) continue;
      const idx = sample.toLowerCase().indexOf(q);
      if (idx >= 0) {
        out.push({ book: this.publicBook(b), excerpt: sample.slice(Math.max(0, idx - 80), idx + 120).replace(/\s+/g, ' ') });
        if (out.length >= limit) break;
      }
    }
    return out;
  }
  getBook(id) { const b = this.books[id]; return b ? this.publicBook(b) : null; }
  getBookPath(id) { return this.books[id]?.path || null; }
  reindex(id) {
    const b = this.books[id];
    if (!b) return;
    b.indexed = false; b.indexAttempts = 0;
    if (!this.queue.includes(id)) this.queue.push(id);
    // the HUD shows done/total while the indexer works: the book counts in the total (rescanQuiet does the same)
    this.scanState.total = this.scanState.done + this.queue.length;
    this.pumpIndex();
  }
  reindexAll() { for (const b of Object.values(this.books)) { if (!b.missing) { b.indexed = false; b.indexAttempts = 0; if (!this.queue.includes(b.id)) this.queue.push(b.id); } } this.scanState = { active: true, done: 0, total: this.queue.length, phase: 'index', unavailable: [] }; this.pumpIndex(); }
  flush() { this.db.flush(); this.stats.flush(); }

  // ------------------------------------------------------------- covers from the internet (web-covers.js) --
  /** fn() runs whenever the indexer has nothing left to do. */
  onIdle(fn) { this.idleListeners.push(fn); return () => { this.idleListeners = this.idleListeners.filter((x) => x !== fn); }; }
  /** The judgement of page 1 for a book indexed before covers were checked (stats: cover-match.js pageStats). */
  applyCoverCheck(id, stats) {
    const b = this.books[id];
    if (!b) return;
    const weak = stats ? weakKind(stats) : null;
    const changed = (b.coverWeak || null) !== weak;
    b.coverWeak = weak;
    b.coverCheck = COVER_CHECK;
    this.db.save();
    if (changed) this.notifyBook(id);
  }
  /**
   * A cover from the internet becomes the book's cover: { jpeg (Buffer), color, image, page, site, via, choice }.
   * The book's own picture (page 1 or the title card) is kept next to it for "Cover aus dem Buch verwenden".
   */
  applyWebCover(id, cover) {
    const b = this.books[id];
    if (!b || !cover?.jpeg?.length) return null;
    try {
      if (b.coverSource !== 'web') {
        b.coverBook = { generated: !!b.coverGenerated, color: b.coverColor || null };
        if (fs.existsSync(this.coverPath(id))) fs.copyFileSync(this.coverPath(id), this.coverBackupPath(id));
      }
      fs.writeFileSync(this.coverPath(id), cover.jpeg);
    } catch (e) { console.error('[library] web cover write failed', e.message); return null; }
    b.hasCover = true;
    b.coverGenerated = false;
    b.coverSource = 'web';
    b.coverWeb = { image: cover.image || null, page: cover.page || null, site: cover.site || null, via: cover.via || null, at: Date.now() };
    if (cover.choice) b.coverChoice = cover.choice; else delete b.coverChoice;
    if (cover.color) b.coverColor = cover.color;
    b.coverVersion = (b.coverVersion || 0) + 1;
    this.db.save();
    this.notifyBook(id);
    return this.publicBook(b);
  }
  /** Back to the book's own cover; `choice` 'book' keeps the automatic search away from it. */
  restoreBookCover(id, { choice = 'book' } = {}) {
    const b = this.books[id];
    if (!b) return null;
    if (b.coverSource === 'web') {
      const own = b.coverBook || {};
      try {
        if (fs.existsSync(this.coverBackupPath(id))) { fs.copyFileSync(this.coverBackupPath(id), this.coverPath(id)); fs.rmSync(this.coverBackupPath(id), { force: true }); }
      } catch (e) { console.error('[library] cover restore failed', e.message); }
      b.coverGenerated = !!own.generated;
      if (own.color) b.coverColor = own.color;
      delete b.coverWeb; delete b.coverBook;
    }
    b.coverSource = 'book';
    if (choice) b.coverChoice = choice; else delete b.coverChoice;
    b.coverVersion = (b.coverVersion || 0) + 1;
    this.db.save();
    this.notifyBook(id);
    return this.publicBook(b);
  }
}

// ---------------------------------------------------------------- helpers --
// (what a file name says, chess books, colours and the like live in shelving.js, shared with the browser version)
/** Index result of a DOCX/RTF book, completed with the text and metadata the main process can read. */
async function withMainProcessText(b, result) {
  try {
    const x = await extractTextAndMeta(b.path, b.format);
    if (!x) return result;
    const meta = { ...(result.metadata || {}) };
    for (const [k, v] of Object.entries(x.metadata || {})) if ((Array.isArray(v) ? v.length : v) && !(Array.isArray(meta[k]) ? meta[k].length : meta[k])) meta[k] = v;
    const text = x.text.replace(/\s+/g, ' ').trim();
    return { ...result, metadata: meta, textSample: text.slice(0, TEXT_SAMPLE_MAX), pageCount: Math.max(1, Math.round(x.text.length / 1800)) };
  } catch (e) {
    console.warn('[library] text extraction failed', b.path, e.message);
    return result;
  }
}
/** @returns false when the directory itself could not be read. */
function walk(dir, out, depth, links = null) {
  if (depth > MAX_DEPTH) return true;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  // the pages next to their resource folders: "-Dateien" / "-files" only count as such when the page is there
  const pages = new Set(entries.filter((e) => !e.isDirectory() && /\.(html?|xhtml|mht|mhtml)$/i.test(e.name)).map((e) => e.name.replace(/\.[^.]+$/, '').toLowerCase()));
  for (const e of entries) {
    // hidden and system folders, "$Temp", "$RECYCLE.BIN" …
    if (e.name.startsWith('.') || IGNORE_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (skipDir(e.name, pages)) continue;   // "$Temp", the resource folder of a saved web page (shelving.js)
      walk(p, out, depth + 1, links);
    } else if (e.isFile()) out.push(p);
    else if (links && e.isSymbolicLink()) { out.push(p); links.add(p); }
  }
  return true;
}
/** chokidar ignore predicate — mirrors the scanner's skip list. */
function watchIgnored(p, stats) {
  const base = path.basename(p || '');
  if (!base) return false;
  if (base.startsWith('.') || IGNORE_DIRS.has(base)) return true;
  if (/(_files|_dateien)$/i.test(base)) return true;
  const isDir = stats ? stats.isDirectory() : !path.extname(base);
  if (isDir && base.startsWith('$')) return true;
  if (!isDir && isNoteOrTemp(base, path.extname(base).toLowerCase())) return true;
  return false;
}
function idFor(file) { return crypto.createHash('sha1').update(path.normalize(file).toLowerCase()).digest('hex').slice(0, 16); }
/** Cheap content fingerprint: size + first 64 KB. Distinguishes two same-named copies. */
function contentHash(file, size) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(Math.min(65536, size));
      fs.readSync(fd, buf, 0, buf.length, 0);
      return crypto.createHash('sha1').update(String(size) + ':').update(buf).digest('hex').slice(0, 24);
    } finally { fs.closeSync(fd); }
  } catch { return null; }
}

module.exports = { Library, BOOK_EXT, titleFromFilename, authorFromFilename, looksLikeAuthor, localDay, walk, watchIgnored, isChessBook, DEPARTMENTS };
