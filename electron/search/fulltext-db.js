// The full-text index on disk: one SQLite file (node:sqlite, built into Electron) in <userData>/fulltext.
//
//   books  one row per book: its id, the key of the file it was read from (content hash, size, time), the state
//          ('partial' while it is read, 'done', 'notext' for scans without a text layer, 'error'), how far it got
//   terms  an FTS5 table without content and positions (detail=none): the postings term → pages. Its rowid encodes the
//          book and the page: ord · 2^20 + unit, so the pages of one book are one rowid range
//   units  the cleaned text of every page (PDF) or chunk of about 2000 characters (EPUB, text formats), deflate
//          compressed (on pages this small it packs better and ten times faster than brotli), for the excerpts; for chunks also where they lie in the book (section, offset, length) and
//          what the reader shows there (print page, position, chapter)
//
// Only words are indexed (their stems, see textnorm.js); phrases are checked against the page text. A book is
// added in batches (one transaction each, `next` moves with them), so an interrupted book resumes where it stopped
// and never holds a page twice. Used inside the index worker (fulltext-worker.js) and directly by the unit tests.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { NORM_VERSION, ftsMatch, hasPhrases, snippet } = require('./textnorm');

const SCHEMA = 2;
const UNIT = 1048576;            // 2^20 units per book: rowid = ord * UNIT + unit
const PHRASE_BUDGET_MS = 800;    // a phrase query reads candidate pages for at most this long (answers within a second)

const pack = (text) => zlib.deflateRawSync(Buffer.from(text, 'utf8'), { level: 6 });
const unpack = (z) => zlib.inflateRawSync(z).toString('utf8');

class FulltextDB {
  /** @param file the database file (its folder is created) */
  constructor(file) {
    this.file = file;
    this.db = null;
    this.byId = new Map();    // id → book row
    this.byOrd = new Map();   // ord → book row
    this.cache = new Map();   // MATCH expression → { counts, units: Map(ord → [unit]) } of recent queries
  }

  open() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    try { this.#connect(); }
    catch (e) {
      // a damaged or foreign file: start a new index (it is only a cache of the books' text)
      console.warn('[fulltext] index unreadable, starting a new one:', e.message);
      this.#discard();
      this.#connect();
    }
    return this;
  }

  #connect() {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(this.file);
    try {
      db.exec('PRAGMA auto_vacuum = INCREMENTAL');   // takes effect for a new file only
      db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA cache_size = -8000; PRAGMA temp_store = MEMORY');
      db.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)');
      const ver = db.prepare("SELECT v FROM meta WHERE k = 'version'").get()?.v;
      const want = `${SCHEMA}.${NORM_VERSION}`;
      if (ver && ver !== want) {
        // other rules for words or another layout: the old index means nothing any more
        db.exec('DROP TABLE IF EXISTS terms; DROP TABLE IF EXISTS units; DROP TABLE IF EXISTS books');
      }
      db.exec(`CREATE TABLE IF NOT EXISTS books (
        ord INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, key TEXT NOT NULL, state TEXT NOT NULL, kind TEXT,
        units INTEGER DEFAULT 0, next INTEGER DEFAULT 0, pages INTEGER DEFAULT 0, chars INTEGER DEFAULT 0,
        tries INTEGER DEFAULT 0, error TEXT, at INTEGER DEFAULT 0)`);
      db.exec(`CREATE TABLE IF NOT EXISTS units (rowid INTEGER PRIMARY KEY, z BLOB NOT NULL,
        s INTEGER, o INTEGER, len INTEGER, page TEXT, pos INTEGER, chapter TEXT)`);
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS terms USING fts5(t, content='', contentless_delete=1, detail=none,
        tokenize="unicode61 remove_diacritics 0")`);
      db.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('version', ?)").run(want);
    } catch (e) { try { db.close(); } catch {} throw e; }
    this.db = db;
    this.st = {
      insTerm: db.prepare('INSERT INTO terms (rowid, t) VALUES (?, ?)'),
      insUnit: db.prepare('INSERT OR REPLACE INTO units (rowid, z, s, o, len, page, pos, chapter) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
      getUnit: db.prepare('SELECT rowid, z, s, o, len, page, pos, chapter FROM units WHERE rowid = ?'),
      delTerms: db.prepare('DELETE FROM terms WHERE rowid >= ? AND rowid < ?'),
      delUnits: db.prepare('DELETE FROM units WHERE rowid >= ? AND rowid < ?'),
    };
    this.#loadBooks();
  }

  #loadBooks() {
    this.byId.clear(); this.byOrd.clear();
    for (const r of this.db.prepare('SELECT * FROM books').all()) { const row = { ...r }; this.byId.set(row.id, row); this.byOrd.set(row.ord, row); }
  }

  #discard() {
    try { this.db?.close(); } catch {}
    this.db = null;
    for (const f of [this.file, this.file + '-wal', this.file + '-shm', this.file + '-journal']) { try { fs.rmSync(f, { force: true }); } catch {} }
  }

  close() { try { this.db?.close(); } catch {} this.db = null; }

  /** Everything gone: a new, empty index (Index neu aufbauen). */
  clear() { this.#discard(); this.cache.clear(); this.#connect(); }

  /** The rows of all books (a copy). */
  list() { return [...this.byId.values()].map((r) => ({ ...r })); }

  #tx(fn) {
    this.db.exec('BEGIN');
    try { const r = fn(); this.db.exec('COMMIT'); return r; }
    catch (e) { try { this.db.exec('ROLLBACK'); } catch {} throw e; }
  }

  #dropRows(ord) {
    this.st.delTerms.run(ord * UNIT, (ord + 1) * UNIT);
    this.st.delUnits.run(ord * UNIT, (ord + 1) * UNIT);
  }

  /**
   * A book is about to be read: { ord, next }. The same file half read before goes on at `next` (when `resume`),
   * anything else starts over with no pages.
   */
  begin(id, key, kind, { resume = false } = {}) {
    this.cache.clear();
    const row = this.byId.get(id);
    if (row && resume && row.key === key && row.state === 'partial' && row.kind === kind) return { ord: row.ord, next: row.next };
    return this.#tx(() => {
      if (row) {
        this.#dropRows(row.ord);
        this.db.prepare("UPDATE books SET key = ?, state = 'partial', kind = ?, units = 0, next = 0, pages = 0, chars = 0, error = NULL, at = ? WHERE ord = ?").run(key, kind, Date.now(), row.ord);
        Object.assign(row, { key, state: 'partial', kind, units: 0, next: 0, pages: 0, chars: 0, error: null, at: Date.now() });
        return { ord: row.ord, next: 0 };
      }
      const ord = (this.db.prepare('SELECT max(ord) AS m FROM books').get().m || 0) + 1;
      this.db.prepare("INSERT INTO books (ord, id, key, state, kind, at) VALUES (?, ?, ?, 'partial', ?, ?)").run(ord, id, key, kind, Date.now());
      const r = { ord, id, key, state: 'partial', kind, units: 0, next: 0, pages: 0, chars: 0, tries: 0, error: null, at: Date.now() };
      this.byId.set(id, r); this.byOrd.set(ord, r);
      return { ord, next: 0 };
    });
  }

  /**
   * One batch of pages/chunks: [{ u, text, terms, s?, o?, len?, page?, pos?, chapter? }]; `next` is the first unit
   * after the batch. Units before the book's `next` are already stored and skipped.
   */
  add(id, units, next) {
    const row = this.byId.get(id);
    if (!row || row.state !== 'partial') return false;
    this.cache.clear();
    const fresh = units.filter((x) => x.u >= row.next && x.u < UNIT);
    let pages = 0, chars = 0;
    this.#tx(() => {
      for (const x of fresh) {
        if (!x.text) continue;
        const rowid = row.ord * UNIT + x.u;
        if (x.terms) this.st.insTerm.run(rowid, x.terms);
        this.st.insUnit.run(rowid, pack(x.text), x.s ?? null, x.o ?? null, x.len ?? null, x.page ?? null, x.pos ?? null, x.chapter ?? null);
        pages++; chars += x.text.length;
      }
      const n = Math.max(row.next, next | 0);
      this.db.prepare('UPDATE books SET next = ?, pages = pages + ?, chars = chars + ? WHERE ord = ?').run(n, pages, chars, row.ord);
      row.next = n; row.pages += pages; row.chars += chars;
    });
    return true;
  }

  /**
   * The book is read to its end: state 'done' or 'error', with its number of units. A book with (almost) no text is
   * 'notext': a scan without a text layer, a comic, a PDF of pictures (its few text pages stay searchable).
   */
  finish(id, { state = 'done', units = null, error = null } = {}) {
    const row = this.byId.get(id);
    if (!row) return null;
    this.cache.clear();
    const tries = state === 'error' ? (row.tries || 0) + 1 : 0;
    const u = units ?? row.units ?? row.next;
    // a PDF whose pages carry hardly a letter each is a scan (page numbers or a stamp do not count as text)
    if (state === 'done' && row.chars < (row.kind === 'pdf' ? Math.max(20, 12 * u) : 20)) state = 'notext';
    this.db.prepare('UPDATE books SET state = ?, units = ?, error = ?, tries = ?, at = ? WHERE ord = ?').run(state, u, error ? String(error).slice(0, 300) : null, tries, Date.now(), row.ord);
    Object.assign(row, { state, units: u, error: error ? String(error).slice(0, 300) : null, tries, at: Date.now() });
    return { ...row };
  }

  /** A book that left the library leaves the index. */
  remove(id) {
    const row = this.byId.get(id);
    if (!row) return false;
    this.cache.clear();
    this.#tx(() => { this.#dropRows(row.ord); this.db.prepare('DELETE FROM books WHERE ord = ?').run(row.ord); });
    this.byId.delete(id); this.byOrd.delete(row.ord);
    return true;
  }

  /** A book that moved to another folder (another id, the same file): its pages stay. */
  rekey(fromId, toId) {
    const row = this.byId.get(fromId);
    if (!row || this.byId.has(toId)) return false;
    this.db.prepare('UPDATE books SET id = ? WHERE ord = ?').run(toId, row.ord);
    this.byId.delete(fromId); row.id = toId; this.byId.set(toId, row);
    this.cache.clear();
    return true;
  }

  /**
   * The books whose pages hold every term of a parsed query (textnorm.parseQuery), phrases checked against the page
   * text: { books: [{ id, hits }], phraseChecked, capped }. The units of each book come from unitsOf().
   */
  match(q) {
    const expr = ftsMatch(q);
    if (!expr) return { books: [] };
    const phrases = q.items.some((it) => it.kind === 'phrase');
    let entry = this.cache.get(expr + (phrases ? '|' + q.text : ''));
    if (!entry) {
      entry = { counts: new Map(), units: new Map(), capped: false };
      if (!phrases) {
        for (const r of this.db.prepare('SELECT rowid >> 20 AS ord, count(*) AS n FROM terms WHERE terms MATCH ? GROUP BY 1').all(expr)) entry.counts.set(r.ord, r.n);
      } else {
        // phrases: the candidate pages are read and checked (the index has no word positions), the books with the most
        // candidates first; a phrase of very common words stops after PHRASE_BUDGET_MS with the books checked so far
        const t0 = Date.now();
        const books = this.db.prepare('SELECT rowid >> 20 AS ord, count(*) AS n FROM terms WHERE terms MATCH ? GROUP BY 1').all(expr).sort((a, b) => b.n - a.n);
        const pages = this.db.prepare('SELECT rowid FROM terms WHERE terms MATCH ? AND rowid >= ? AND rowid < ? ORDER BY rowid');
        for (const { ord } of books) {
          if (Date.now() - t0 > PHRASE_BUDGET_MS) { entry.capped = true; break; }
          const list = [];
          for (const r of pages.iterate(expr, ord * UNIT, (ord + 1) * UNIT)) {
            const unit = this.st.getUnit.get(r.rowid);
            if (unit && hasPhrases(unpack(unit.z), q)) list.push(r.rowid - ord * UNIT);
          }
          if (list.length) { entry.counts.set(ord, list.length); entry.units.set(ord, list); }
        }
      }
      this.#remember(expr + (phrases ? '|' + q.text : ''), entry);
    }
    const books = [];
    for (const [ord, hits] of entry.counts) {
      const row = this.byOrd.get(ord);
      if (row) books.push({ id: row.id, hits, pages: row.pages, kind: row.kind, state: row.state });
    }
    return { books, capped: entry.capped };
  }

  #remember(key, entry) {
    this.cache.delete(key);
    this.cache.set(key, entry);
    while (this.cache.size > 6) this.cache.delete(this.cache.keys().next().value);
  }

  /** The matching units of one book in page order (after match() with the same query). */
  unitsOf(q, id) {
    const row = this.byId.get(id);
    const expr = ftsMatch(q);
    if (!row || !expr) return [];
    const phrases = q.items.some((it) => it.kind === 'phrase');
    const key = expr + (phrases ? '|' + q.text : '');
    let entry = this.cache.get(key);
    // the checked pages of a phrase query exist only after match() (it may have left the cache meanwhile)
    if (phrases && !entry) { this.match(q); entry = this.cache.get(key); }
    if (entry?.units.has(row.ord)) return entry.units.get(row.ord);
    if (phrases) return [];
    const list = this.db.prepare('SELECT rowid FROM terms WHERE terms MATCH ? AND rowid >= ? AND rowid < ? ORDER BY rowid')
      .all(expr, row.ord * UNIT, (row.ord + 1) * UNIT).map((r) => r.rowid - row.ord * UNIT);
    if (entry) entry.units.set(row.ord, list);
    return list;
  }

  /** Excerpts for units of a book: [{ u, snippet, s, o, len, page, pos, chapter }]. */
  snippets(q, id, units, width) {
    const row = this.byId.get(id);
    if (!row) return [];
    const out = [];
    for (const u of units) {
      const r = this.st.getUnit.get(row.ord * UNIT + u);
      if (!r) continue;
      out.push({ u, snippet: snippet(unpack(r.z), q, width), s: r.s, o: r.o, len: r.len, page: r.page, pos: r.pos, chapter: r.chapter });
    }
    return out;
  }

  /** The stored text of one unit (tests, the reader's fallback). */
  unitText(id, u) {
    const row = this.byId.get(id);
    const r = row ? this.st.getUnit.get(row.ord * UNIT + u) : null;
    return r ? unpack(r.z) : null;
  }

  /** Bytes on disk (the file and its write-ahead log). */
  size() {
    let n = 0;
    for (const f of [this.file, this.file + '-wal']) { try { n += fs.statSync(f).size; } catch {} }
    return n;
  }

  /** All FTS segments merged into one (the smallest and fastest index; for tests and a finished rebuild). */
  optimize() {
    this.db.exec("INSERT INTO terms (terms) VALUES ('optimize')");
    return this.compact();
  }

  /**
   * One step of merging the FTS segments, about `pages` pages of work, so that a query never waits long for it.
   * @returns true while there was work to do
   */
  merge(pages = 200) {
    // the FTS5 structure record (rowid 10 of terms_data) lists the segments: unchanged means nothing was merged
    const structure = () => this.db.prepare('SELECT block FROM terms_data WHERE id = 10').get()?.block;
    const before = structure();
    this.db.prepare("INSERT INTO terms (terms, rank) VALUES ('merge', ?)").run(pages);
    const after = structure();
    return !!before && !!after && Buffer.compare(Buffer.from(before), Buffer.from(after)) !== 0;
  }

  /** Free pages released by removed books, and the write-ahead log folded back into the file. */
  compact() {
    this.db.exec('PRAGMA incremental_vacuum');
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return this.size();
  }
}

module.exports = { FulltextDB, UNIT };
