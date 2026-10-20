// The pure part of the library: what a file name says about a book, which department and shelf a folder gives it,
// how the departments and shelves are put together from the records, how an index result is written into a record.
// No Node dependency on purpose: electron/library/library.js (the desktop, with the file system) and
// app/src/web/web-library.js (the browser version, with the File System Access API and IndexedDB) share it, and the
// renderer bundles it like reading-log.js or duplicates.js.
const { classify, extractIsbn, stripNumbering, norm, folderDepartmentId, isFolderDepartmentId, folderDisplayName, isLeftoverFolder } = require('./classify');
const { DEFAULT_DEPARTMENT, departmentById, departmentOrder, legacyDepartmentId } = require('./taxonomy');
const { normalizeLanguage } = require('./language');
const { isFinished } = require('./reading-log');

const BOOK_EXT = new Set(['.pdf', '.epub', '.mobi', '.azw', '.azw3', '.azw4', '.prc', '.kf8', '.fb2', '.fbz', '.cbz', '.txt', '.md', '.markdown', '.html', '.htm', '.xhtml', '.docx', '.rtf']);
const FORMAT_OF = (ext) => ({ '.markdown': 'md', '.htm': 'html', '.xhtml': 'html', '.azw': 'mobi', '.azw4': 'azw3', '.prc': 'mobi', '.kf8': 'azw3' }[ext] || ext.slice(1));

const MAX_DEPTH = 8;                          // folder depth: scanner and watcher share it
const IGNORE_DIRS = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information']);
const MIN_FILE_SIZE = 512;
const TEXT_SAMPLE_MAX = 20000;
const PENDING_SHELF = 'Neuzugänge';

const PUBLIC_FIELDS = ['id', 'path', 'relPath', 'folder', 'folderMode', 'format', 'size', 'mtime', 'title', 'author', 'language', 'isbn', 'publisher', 'year', 'subjects', 'description', 'department', 'departmentId', 'departmentEn', 'departmentKey', 'shelf', 'shelfKey', 'departmentSource', 'mustRead', 'hasCover', 'coverColor', 'coverGenerated', 'coverWeak', 'coverSource', 'coverWeb', 'coverChoice', 'coverVersion', 'pageCount', 'lastLocation', 'progress', 'lastRead', 'addedAt', 'bookmarks', 'annotations', 'readingSeconds', 'timesOpened', 'borrowed', 'borrowedAt', 'missing', 'indexed', 'indexError', 'isChess', 'positions', 'currentPageText'];
// metadata from the book catalogues (web-covers.js): the series and the volume in it, and where filled-in fields came from
PUBLIC_FIELDS.push('series', 'seriesIndex', 'metaWeb');
/** Fields of the shelves (0.7): read by hand or not, the series, when the file arrived (reading-log.js, shelf-order.js). */
const SHELF_FIELDS = ['finishedAt', 'readMark', 'series', 'seriesIndex', 'born'];
/** What a book that moved (same content, another path) takes over from its old record (library.js inheritFromMissing). */
const INHERIT_FIELDS = ['lastLocation', 'progress', 'lastRead', 'bookmarks', 'annotations', 'positions', 'readingSeconds', 'timesOpened', 'title', 'author', 'isbn', 'subjects', 'description', 'language', 'coverColor', 'coverGenerated', 'coverWeak', 'coverCheck', 'coverSource', 'coverWeb', 'coverBook', 'coverChoice', 'coverVersion', 'pageCount', 'isChess', ...SHELF_FIELDS, 'publisher', 'year', 'series', 'seriesIndex', 'metaWeb'];
/** What api.library.update may change (the reader, the chess board, the book info). */
const UPDATE_FIELDS = ['lastLocation', 'progress', 'lastRead', 'bookmarks', 'annotations', 'positions', 'title', 'author', 'language', 'isChess', 'currentPageText'];

/** The last part of a path, with either kind of separator (the browser has no `path`). */
const baseName = (p) => { const s = String(p || ''); const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')); return i >= 0 ? s.slice(i + 1) : s; };
const extName = (p) => { const b = baseName(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i).toLowerCase() : ''; };

/** Natural order of folder names ("2 …" before "10 …"); folders that say "not sorted yet" go last. */
const byFolderName = (a, b) => (isLeftoverFolder(a) - isLeftoverFolder(b)) || String(a).localeCompare(String(b), 'de', { numeric: true, sensitivity: 'base' });

// ---------------------------------------------------------------- files and names --
/**
 * Office lock files (~$…) and the user's own notes next to the books ("_Hinweise.txt", "_Dubletten.txt") are no
 * books. A book whose name happens to start with an underscore ("_ - Lesetipps.htm") is one.
 */
function isNoteOrTemp(base, ext) {
  if (base.startsWith('.') || base.startsWith('~$')) return true;
  return base.startsWith('_') && (ext === '.txt' || ext === '.md' || ext === '.markdown');
}
/** Resource folder of a saved web page: "Seite_files", "Seite_dateien" (Chrome, Edge), "Seite-Dateien" (Firefox). */
const RESOURCE_DIR = /^(.+?)(_files|_dateien|-dateien|-files)$/i;
/** Is this folder skipped by the scanner? `pages` holds the lower-case names (without extension) of the HTML files next to it. */
function skipDir(name, pages = new Set()) {
  if (name.startsWith('.') || IGNORE_DIRS.has(name) || name.startsWith('$')) return true;
  const res = RESOURCE_DIR.exec(name);
  return !!(res && (/^_/.test(res[2]) || pages.has(res[1].toLowerCase())));
}
/** Is this file a book the scanner takes (by its name and size)? */
function isBookFile(name, size, relPath = '') {
  const ext = extName(name);
  if (!BOOK_EXT.has(ext) || isNoteOrTemp(baseName(name), ext)) return false;
  if (size < MIN_FILE_SIZE) return false;
  // resource folders of saved web pages are skipped by the walk; this catches the classic names anywhere
  return !/(_files|_dateien)[\\/]/i.test(relPath);
}

function clean(s, max = 400) { if (!s) return null; s = String(typeof s === 'object' ? (s.name || Object.values(s)[0] || '') : s).replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null; }
function normalizeIsbn(s) { if (!s) return null; const d = String(s).replace(/[^0-9Xx]/g, ''); return d.length === 13 || d.length === 10 ? extractIsbn('isbn ' + d) : null; }
function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
// "Ein Roman", "A Novel", "Eine Biographie" … look like names but are genre tags.
const NOT_AN_AUTHOR = /^(ein|eine|einer|a|an|the|der|die|das|mit|aus|von|band|teil|roman|novel|thriller|krimi|biographie|biografie|autobiography|memoir|erzählungen?|gedichte|handbuch|ratgeber|kochbuch|lehrbuch|komplett|ungekürzt|deutsch|english)\b/i;
/** Does the tail of a "Title - Tail" filename look like a person's name? */
function looksLikeAuthor(s) {
  const t = String(s || '').trim();
  if (!t || t.length > 40 || /\d/.test(t)) return false;
  if (NOT_AN_AUTHOR.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((w) => /^[A-ZÄÖÜ][\wÀ-ÿ'’.-]*\.?$/.test(w));
}
/**
 * Title from a filename. Only the *author* tail is stripped: a subtitle after " - " is part of the title
 * ("Walden - Life in the Woods").
 */
function titleFromFilename(file) {
  let base = baseName(file).replace(/\.[^.]+$/, '');
  // the scheme of some download sites: "Title -- Author -- Year -- Publisher -- hash -- Source"
  if (base.includes(' -- ')) base = base.split(' -- ')[0];
  // a site's note in brackets: a domain in lower case, "(example.org)" (not "(St.Gallen)" or "(vol.ii)")
  base = base.replace(/\s*\((?:[a-z0-9][a-z0-9-]*\.)+(?![ivxlcdm]+\))[a-z]{2,6}\)/g, '').replace(/\s*\(?\d{3,4}\)?$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  // "Title - Author": drop the tail only when it really is a person and a title remains
  if (base.includes(' - ')) {
    const parts = base.split(' - ');
    const tail = parts[parts.length - 1].trim();
    const head = parts.slice(0, -1).join(' - ').trim();
    if (parts.length >= 2 && looksLikeAuthor(tail) && head.split(/\s+/).length >= 2) base = head;
  }
  return base || baseName(file);
}
function authorFromFilename(file) {
  const base = baseName(file).replace(/\.[^.]+$/, '');
  if (base.includes(' -- ')) { const p = base.split(' -- '); if (p[1] && !/^\d{4}$/.test(p[1].trim())) return p[1].replace(/_/g, '.').trim().slice(0, 80); }
  if (base.includes(' - ')) { const p = base.split(' - '); const a = p[p.length - 1].trim(); if (looksLikeAuthor(a)) return a.replace(/;$/, ''); }
  return null;
}
function guessLanguage(text) {
  if (!text) return null;
  const t = ' ' + text.toLowerCase().slice(0, 6000) + ' ';
  const de = [' und ', ' der ', ' die ', ' das ', ' nicht ', ' ist ', ' mit ', ' sich ', ' auch ', ' eine ', ' wird '].reduce((a, w) => a + (t.split(w).length - 1), 0);
  const en = [' the ', ' and ', ' of ', ' to ', ' is ', ' with ', ' that ', ' this ', ' are ', ' for ', ' not '].reduce((a, w) => a + (t.split(w).length - 1), 0);
  if (de === 0 && en === 0) return null;
  return de > en * 1.2 ? 'de' : en > de * 1.2 ? 'en' : null;
}
function colorFromString(s) {
  let h = 0; for (const c of String(s || 'x')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360, sat = 35 + (h >> 8) % 30, light = 28 + (h >> 16) % 22;
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}
// words with "schach" (Schachbuch, Fernschach, Schachtaktik) but not Schacht, Schachtel or Schachtelhalm
const CHESS_WORD = /schach(?!tel|t(?:e[ns]?)?(?![\p{L}]))|chess/iu;
// numbered moves in German or English notation: "12. Sf3", "1.e4", "23... Dxd4", "5. O-O"
const CHESS_MOVE = /\b\d{1,3}\.\s?(?:\.\.\s?)?(?:[KDTLSQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x?[a-h]?[1-8]|O-O(?:-O)?|0-0(?:-0)?)/g;
/**
 * Is this a chess book (the reader then puts a board next to it)? The department cannot tell: "Spiele &
 * Schach" also holds books about cards, Sudoku or poker. The user's folders, the title and real move
 * notation in the text can.
 */
function isChessBook(b, sample = '') {
  if (CHESS_WORD.test(`${b.relPath || ''} ${b.shelf || ''} ${b.title || ''}`)) return true;
  return (String(sample).slice(0, 20000).match(CHESS_MOVE) || []).length >= 3;
}

// ---------------------------------------------------------------- departments and shelves --
/** A department of the fixed taxonomy (auto mode, "Verschiedenes", a manual choice). */
function setBookDepartment(b, departmentId, shelf, shelfKey) {
  const dep = departmentById(departmentId) || departmentById(DEFAULT_DEPARTMENT);
  b.departmentId = dep.id;
  b.department = dep.de;
  b.departmentEn = dep.en;
  b.departmentKey = null;
  b.shelf = shelf || null;
  b.shelfKey = shelfKey || null;
}
/** The department of a top-level folder (raw name, e.g. "02 Schach") and the shelf of a sub folder (raw name). */
function setFolderDepartment(b, topRaw, shelfRaw) {
  const name = folderDisplayName(topRaw);
  b.departmentId = folderDepartmentId(topRaw);
  b.department = name;
  b.departmentEn = name;
  b.departmentKey = String(topRaw);
  const shelf = shelfRaw ? folderDisplayName(shelfRaw) : null;
  // a sub folder with the department's own name is no shelf of its own
  b.shelf = shelf && norm(shelf) !== norm(name) ? shelf : null;
  b.shelfKey = b.shelf ? String(shelfRaw) : null;
}
/**
 * Pre-sorted ('structured') folders: the top-level folder IS the book's department, the folder the file
 * actually sits in below it is its shelf (the most specific label the user gave it). A file directly in the
 * top-level folder has no shelf of its own (no second label with the department's name). Files directly in
 * the books folder itself go to "Verschiedenes". 'auto' folders keep the fixed taxonomy.
 * @param autoClassify (b) → classifies an indexed book of a folder that used to be pre-sorted (the indexer would not come back to it)
 */
function assignFromFolder(b, folderEntry, autoClassify = null) {
  if (b.departmentSource === 'manual') return;
  const parts = String(b.relPath || '').split(/[\\/]/);
  if (folderEntry.mode === 'structured' && parts.length > 1) {
    setFolderDepartment(b, parts[0], parts.length > 2 ? parts[parts.length - 2] : null);
    b.departmentSource = 'folder';
  } else if (folderEntry.mode === 'structured') {
    setBookDepartment(b, DEFAULT_DEPARTMENT, null, null);
    b.departmentSource = 'folder';
  } else {
    // auto mode: keep classification if already done; else park it in Verschiedenes. A folder that used to be
    // pre-sorted gets classified now (its books are indexed already, the indexer would not come back to them).
    if (isFolderDepartmentId(b.departmentId) && b.indexed && autoClassify) autoClassify(b);
    else if (!b.departmentId || b.departmentSource === 'pending' || isFolderDepartmentId(b.departmentId)) {
      setBookDepartment(b, DEFAULT_DEPARTMENT, PENDING_SHELF, null);
      b.departmentSource = 'pending';
    }
  }
}
/** The record as the renderer sees it (PUBLIC_FIELDS and the fields of the shelves). `dups` from duplicates.js findDuplicates. */
function publicBook(b, dups = null) {
  const o = {};
  for (const k of PUBLIC_FIELDS) if (b[k] !== undefined) o[k] = b[k];
  o.title = o.title || titleFromFilename(b.path);
  if (!o.departmentId) o.departmentId = DEFAULT_DEPARTMENT;
  if (!o.departmentEn) o.departmentEn = isFolderDepartmentId(o.departmentId) ? (o.department || '') : ((departmentById(o.departmentId) || {}).en || 'Miscellaneous');
  // the shelves (0.7): read or not, the series, the other copies of the same book (reading-log.js, duplicates.js)
  for (const k of SHELF_FIELDS) if (b[k] !== undefined) o[k] = b[k];
  o.finished = isFinished(b);
  const dup = dups?.groupOf.get(b.id);
  if (dup) { o.dupGroup = dup.id; o.dupReasons = dup.reasons; }
  return o;
}
/**
 * Departments in a stable order, never by book count (the 3D room must not reshuffle): first the user's own
 * folders in the natural order of their names ("sonstiges" and the like last), then the departments of the
 * fixed taxonomy in its canonical order, "Verschiedenes" at the very end.
 * Contract: { id, name, nameEn, kind: 'folder'|'taxonomy', count, source, shelves: [{ name, key, bookIds, neutral? }] }.
 * A neutral shelf holds the books that lie directly in a department's folder: it carries the department's
 * name and gets no label of its own in the room.
 * @param titleOf (id) → the title the books of a shelf are sorted by
 */
function computeDepartments(books, titleOf = () => '') {
  const map = new Map();
  for (const b of books) {
    let d;
    if (isFolderDepartmentId(b.departmentId)) {
      const name = b.department || folderDisplayName(b.departmentId.slice(7));
      d = map.get(b.departmentId);
      if (!d) map.set(b.departmentId, d = { id: b.departmentId, name, nameEn: b.departmentEn || name, kind: 'folder', key: b.departmentKey || name, shelves: new Map(), count: 0, sources: {} });
      const key = b.departmentKey || name;
      if (byFolderName(key, d.key) < 0) d.key = key;          // "01 Schach" and "Schach" in two roots: one department
    } else {
      const id = b.departmentId || legacyDepartmentId(b.department) || DEFAULT_DEPARTMENT;
      const dep = departmentById(id) || departmentById(DEFAULT_DEPARTMENT);
      d = map.get(dep.id);
      if (!d) map.set(dep.id, d = { id: dep.id, name: dep.de, nameEn: dep.en, kind: 'taxonomy', shelves: new Map(), count: 0, sources: {} });
    }
    d.count++;
    d.sources[b.departmentSource || 'auto'] = (d.sources[b.departmentSource || 'auto'] || 0) + 1;
    // folder departments: books without a shelf lie directly in the department's folder (the neutral shelf)
    const neutral = !b.shelf && (d.kind === 'folder' || b.departmentSource === 'folder');
    const sh = b.shelf || (neutral ? '\u0000' : PENDING_SHELF);
    if (!d.shelves.has(sh)) d.shelves.set(sh, neutral ? { name: d.name, key: '', neutral: true, bookIds: [] } : { name: sh, key: b.shelfKey || sh, bookIds: [] });
    const shelfRec = d.shelves.get(sh);
    if (!neutral && b.shelfKey && (!shelfRec.key || shelfRec.key === sh)) shelfRec.key = b.shelfKey;
    shelfRec.bookIds.push(b.id);
  }
  const title = (id) => titleOf(id) || '';
  const deps = [...map.values()].map((d) => ({
    id: d.id, name: d.name, nameEn: d.nameEn, kind: d.kind, key: d.key, count: d.count,
    source: Object.entries(d.sources).sort((a, b) => b[1] - a[1])[0][0],
    shelves: [...d.shelves.values()]
      // the books lying directly in the folder first, then the sub folders in their own order
      .sort((a, b) => (b.neutral ? 1 : 0) - (a.neutral ? 1 : 0) || byFolderName(a.key || a.name, b.key || b.name))
      .map((s) => ({ ...s, bookIds: s.bookIds.sort((x, y) => title(x).localeCompare(title(y), 'de', { numeric: true })) })),
  }));
  deps.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    if (a.kind === 'folder') return byFolderName(a.key, b.key);
    return departmentOrder(a.id) - departmentOrder(b.id);
  });
  for (const d of deps) delete d.key;
  return deps;
}
/**
 * { kind: 'folder'|'taxonomy', id, name, key?, shelves? } for a department id or name (see setDepartment).
 * @param books every live record (not missing)
 */
function resolveDepartment(department, books) {
  const raw = String(department || '').trim();
  if (!raw) return { kind: 'taxonomy', id: DEFAULT_DEPARTMENT };
  const current = computeDepartments(books);
  const folderKey = (d) => { let k = null; for (const x of books) if (x.departmentId === d.id && x.departmentKey && (!k || byFolderName(x.departmentKey, k) < 0)) k = x.departmentKey; return k || d.name; };
  const byId = current.find((d) => d.id === raw);
  if (byId) return byId.kind === 'folder' ? { kind: 'folder', id: byId.id, name: byId.name, key: folderKey(byId), shelves: byId.shelves } : { kind: 'taxonomy', id: byId.id, shelves: byId.shelves };
  if (isFolderDepartmentId(raw)) { const name = folderDisplayName(raw.slice(7)); return { kind: 'folder', id: raw, name, key: name }; }
  const byName = current.find((d) => d.kind === 'folder' && norm(d.name) === norm(raw));
  if (byName) return { kind: 'folder', id: byName.id, name: byName.name, key: folderKey(byName), shelves: byName.shelves };
  const legacy = legacyDepartmentId(raw);
  if (legacy) return { kind: 'taxonomy', id: legacy, shelves: current.find((d) => d.id === legacy)?.shelves };
  return { kind: 'folder', id: folderDepartmentId(raw), name: folderDisplayName(raw), key: raw };
}
/**
 * Move a book by hand. `department` is a department id ('folder:…' or a taxonomy id) or a display name:
 *  • the name of an existing folder department → that department (the user's own folders win),
 *  • a department of the fixed taxonomy (also legacy names) → that department,
 *  • any other name → a department of that name of its own ("Neue Abteilung" in the terminal).
 * A shelf with the department's own name, or none, means the department's neutral shelf. The choice is
 * sticky: the scanner leaves manual books alone, even when their file sits in another folder.
 * @param books every live record (for the departments that exist)
 */
function moveBook(b, department, shelf, books) {
  const dep = resolveDepartment(department, books);
  if (dep.kind === 'folder') {
    b.departmentId = dep.id; b.department = dep.name; b.departmentEn = dep.name; b.departmentKey = dep.key;
  } else setBookDepartment(b, dep.id, null, null);
  let sh = String(shelf || '').trim();
  if (sh && norm(sh) === norm(b.department)) sh = '';
  b.shelf = sh || null;
  // join an existing shelf with its own sort key ("03 Geld & Banken")
  const known = sh ? dep.shelves?.find((s) => !s.neutral && norm(s.name) === norm(sh)) : null;
  b.shelfKey = sh ? (known?.key || sh) : null;
  b.departmentSource = 'manual';
}

// ---------------------------------------------------------------- index results and searching --
/**
 * The metadata of an index result (app/src/indexer.js, app/src/web/web-indexer.js) written into the record: title,
 * author, language, series, publisher, year, subjects, description, page count, ISBN, chess. The cover itself is
 * stored by the caller (a file on the desktop, a blob in the browser).
 * @returns the text sample, cut to TEXT_SAMPLE_MAX
 */
function applyIndexMeta(b, result) {
  const m = result.metadata || {};
  const sample = (result.textSample || '').slice(0, TEXT_SAMPLE_MAX);
  b.title = clean(m.title) || b.title || titleFromFilename(b.path);
  b.author = clean(m.author) || b.author || authorFromFilename(b.path) || '';
  b.language = normalizeLanguage(m.language) || normalizeLanguage(b.language) || null;   // two letters or none (language.js)
  if (m.series && clean(m.series)) { b.series = clean(m.series, 200); b.seriesIndex = m.seriesIndex != null && Number.isFinite(+m.seriesIndex) ? +m.seriesIndex : null; }
  b.publisher = clean(m.publisher) || b.publisher || null;
  b.year = m.year || b.year || null;
  b.subjects = Array.isArray(m.subjects) ? m.subjects.slice(0, 30) : (b.subjects || []);
  b.description = clean(m.description, 2000) || b.description || null;
  b.pageCount = result.pageCount || b.pageCount || null;
  b.textLength = sample.length;
  b.isbn = normalizeIsbn(m.isbn) || extractIsbn(baseName(b.path)) || extractIsbn(sample) || b.isbn || null;
  if (!b.language) b.language = guessLanguage(sample || b.title);
  b.isChess = isChessBook(b, sample);
  return sample;
}
/** Does the indexed book need the classifier (an automatic folder, or parked in "Neuzugänge")? */
function needsClassify(b) {
  return b.departmentSource === 'pending' || (b.folderMode === 'auto' && b.departmentSource !== 'manual' && b.departmentSource !== 'folder');
}
/** The books that match a query: every term in title, author, department, shelf, subjects, ISBN or file name. */
function searchBooks(books, query, { limit = 100, publicBook: pub = (b) => b } = {}) {
  const q = (query || '').toLowerCase().trim();
  if (!q) return books.slice(0, limit).map(pub);
  const terms = q.split(/\s+/);
  const scored = [];
  for (const b of books) {
    const hay = `${b.title || ''} ${b.author || ''} ${b.department || ''} ${b.shelf || ''} ${(b.subjects || []).join(' ')} ${b.isbn || ''} ${baseName(b.path)}`.toLowerCase();
    let s = 0;
    for (const t of terms) { if (hay.includes(t)) s += (b.title || '').toLowerCase().includes(t) ? 3 : 1; else { s = 0; break; } }
    if (s > 0) scored.push([s, b]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, limit).map(([, b]) => pub(b));
}

module.exports = {
  BOOK_EXT, FORMAT_OF, MAX_DEPTH, IGNORE_DIRS, MIN_FILE_SIZE, TEXT_SAMPLE_MAX, PENDING_SHELF, PUBLIC_FIELDS, SHELF_FIELDS, INHERIT_FIELDS, UPDATE_FIELDS,
  baseName, extName, byFolderName, isNoteOrTemp, RESOURCE_DIR, skipDir, isBookFile, clean, normalizeIsbn, localDay, looksLikeAuthor, titleFromFilename, authorFromFilename,
  guessLanguage, colorFromString, isChessBook, setBookDepartment, setFolderDepartment, assignFromFolder, publicBook, computeDepartments, resolveDepartment, moveBook,
  applyIndexMeta, needsClassify, searchBooks, classify, stripNumbering,
};
