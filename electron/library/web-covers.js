// Covers and metadata from the internet for books without them. A book without a real cover (the indexer's title card,
// an empty page 1, a plain title page or text without any picture: cover-match.js weakKind) is looked up in book
// catalogues first (cover-sources.js: Open Library, Goodreads, Apple Books, the Deutsche Nationalbibliothek, the
// Internet Archive, Google Books; Amazon's picture of an edition by its ISBN or ASIN), which answer within a second or
// two. Each catalogue has a budget of its own, and a book asks the one that is free right now and promises most for its
// language: many books go to different catalogues at once. book-match.js decides which record is the book (ISBN, title
// words, author, language, volume); the picture of the best record becomes the cover, the records fill in what the book
// does not say itself (author, year, publisher, ISBN, language, series and volume).
//
// Only when the catalogues know nothing, the picture that appears on the most sites in a DuckDuckGo image search
// becomes the cover (strict safe search, every picture through DuckDuckGo's own image proxy). DuckDuckGo turns an
// address away for a quarter of an hour after six or seven searches, even when they come more than a minute apart (and
// that would hit the reader's own searches in the browser too): its searches keep a pause of three minutes, never more
// than four in a quarter of an hour, back off when the service declines, and a book without a result is asked again
// only after days.
//
// The background search takes one book at a time once the indexer is idle (a new book gets its cover within seconds);
// "Alle Cover jetzt laden" (cover-batch.js) goes through all of them at once. Only title, author and ISBN of a book are
// sent anywhere, and only for books (BOOK_FORMATS): the title of a letter or of the reader's notes never leaves.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Store } = require('../store');
const M = require('./cover-match');
const BM = require('./book-match');
const { Net, makeSources, amazonCover } = require('./cover-sources');
const { CoverBatch } = require('./cover-batch');
const IE = require('./image-engines');

const COVER_CHECK = M.COVER_CHECK;
const DDG_PAUSE = 180e3;                       // between two automatic searches
const DDG_PAUSE_MIN = 150e3, DDG_PAUSE_MAX = 600e3;
const DDG_BLOCK = 15 * 60e3;                   // the first back-off after a refusal, doubled each time, 6 h at most
const DDG_WINDOW = 15 * 60e3, DDG_WINDOW_MAX = 4;   // never more searches than this in a quarter of an hour
const DDG_MANUAL_GAP = 60e3;                   // "Im Web suchen" in the book info: at least a minute after the last search
const NET_PAUSE = 5 * 60e3;                    // after a network error (offline, timeout)
const MISS_DAYS = [7, 14, 30, 60];             // a book without a result is asked again after so many days
const SOFT_RETRY = 60 * 60e3;                  // a book that could not be asked at all (every service away)
const FAST_RETRY = 14 * 24 * 3600e3;           // the catalogues are asked again for a book they did not know
const META_RETRY = 60 * 24 * 3600e3;           // metadata asked again after so long
const META_TRIGGER = ['author', 'year', 'publisher'];   // a book lacking one of these is looked up for its metadata
const THUMBS = 20;                             // results of an image search whose thumbnails are compared
// the image search engines besides DuckDuckGo (image-engines.js): where their searches go, how long they rest after a
// sign of throttling (doubled each time, half a day at most)
const ENGINE_URL = { bing: 'https://www.bing.com/images/async', yandex: 'https://yandex.com/images/search' };
const ENGINE_REST = { bing: 30 * 60e3, yandex: 60 * 60e3 }, ENGINE_REST_MAX = 12 * 3600e3;
const MIN_HEIGHT = 300;                        // a cover must be at least that tall (pixels of the picture)
const COVER_PX = 900;                          // the stored cover: a JPEG at most this tall (the big card on a 1440p screen)
// Only books are looked up: the formats books come in, and a PDF of book length. The title of a letter, an invoice or
// the reader's own notes (DOCX, text, Markdown, a short PDF) never goes to a catalogue or a search engine.
const BOOK_FORMATS = new Set(['pdf', 'epub', 'mobi', 'azw3', 'fb2', 'cbz']);
const MIN_PAGES = 24;
const CACHE_MS = 6 * 3600e3;                   // search results kept for the choice in the book info
const CACHE_DDG = 8, CACHE_PICK = 24;          // books whose results are kept (least recently used go first)
const DAY = 24 * 3600e3;
// where a cover comes from, as the book info names it
const SOURCE_SITE = { openlibrary: 'openlibrary.org', apple: 'books.apple.com', dnb: 'dnb.de', google: 'books.google.com', goodreads: 'goodreads.com', amazon: 'amazon.com', archive: 'archive.org' };
// the catalogues in the order their pictures are tried: publishers' covers of the German market first for German books
// (Amazon's picture of an edition by its ISBN next), the scanned copies of the Internet Archive last
const PRIORITY = {
  de: { dnb: 6, amazon: 5, apple: 4, goodreads: 3, google: 2, openlibrary: 1, archive: 0 },
  other: { apple: 6, amazon: 5, goodreads: 4, openlibrary: 3, google: 2, dnb: 1, archive: 0 },
};
// the catalogues in the order they are asked when several are free (what each knew of the online sample)
const FIRST = {
  de: { dnb: 5, openlibrary: 4, goodreads: 4, apple: 3, google: 3, archive: 2 },
  other: { openlibrary: 5, goodreads: 5, apple: 4, google: 3, archive: 2, dnb: 0 },
};
const FREE_MS = 100;                           // a host that may be asked within this counts as free

const proxied = (u) => 'https://external-content.duckduckgo.com/iu/?' + new URLSearchParams({ u, f: '1', nofb: '1' });
/** Bing's thumbnails come in any height: 300 px are plenty for comparing (a quarter of the bytes). */
const smallThumb = (u) => (/^https:\/\/tse\d*\.(mm|explicit)\.bing\.net\/th/i.test(u) && !/[?&]h=\d/.test(u) ? u + (u.includes('?') ? '&' : '?') + 'h=300' : u);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isDdg = (u) => { try { return /(^|\.)duckduckgo\.com$/i.test(new URL(u).hostname); } catch { return false; } };

/** Read a response body with a size cap. */
async function readCapped(res, maxBytes) {
  const declared = parseInt(res.headers.get('content-length') || '', 10);
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('response too large');
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('response too large');
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { try { await reader.cancel(); } catch {} throw new Error('response too large'); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

/**
 * The network: a session of its own that keeps nothing on disk (no cookies of the search engine next to the app's),
 * Chromium's stack (system proxy and certificates). Plain fetch outside Electron.
 */
function makeFetch() {
  let doFetch = null;
  const get = () => {
    if (doFetch) return doFetch;
    try {
      const { session } = require('electron');
      const ses = session && typeof session.fromPartition === 'function' ? session.fromPartition('lesesaal-covers') : null;
      if (ses && typeof ses.fetch === 'function') doFetch = ses.fetch.bind(ses);
    } catch {}
    return (doFetch = doFetch || globalThis.fetch);
  };
  return async (url, { headers = {}, timeout = 15000, maxBytes = 8 << 20 } = {}) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await get()(url, { headers, signal: ctrl.signal, redirect: 'follow', bypassCustomProtocolHandlers: true });
      const buffer = await readCapped(res, maxBytes);
      // url: where the answer came from after redirects (an engine that sends a captcha page instead of results)
      return { ok: res.ok, status: res.status, contentType: res.headers.get('content-type') || '', retryAfter: res.headers.get('retry-after') || null, url: res.url || url, buffer };
    } catch (e) {
      throw new Error(ctrl.signal.aborted ? 'timeout' : (e && e.message) || String(e));
    } finally { clearTimeout(timer); }
  };
}

/**
 * Test runs: COZYSHELVES_COVERS_FIXTURES=<folder> answers every request from responses saved there (keyed by the address)
 * and, with COZYSHELVES_COVERS_RECORD=1, saves what it fetches for the next run (DuckDuckGo only with
 * COZYSHELVES_COVERS_RECORD_DDG=1: a recording must never risk the block). Without a saved response the request fails like
 * a machine without network, or, with `synth` (cover-synth.js, COZYSHELVES_COVERS_SYNTH=1), gets a made-up catalogue answer.
 */
function fixtureFetch(dir, real, record, synth = null) {
  fs.mkdirSync(dir, { recursive: true });
  // an address is matched without what does not change the answer: the session token of a search (vqd), the safe search
  // switch of the JSON request, the height asked of a Bing thumbnail
  const norm = (u) => {
    let s = String(u).replace(/([?&])vqd=[\d-]+/, '$1vqd=');
    try {
      const x = new URL(s);
      if (x.pathname === '/i.js') x.searchParams.delete('kp');
      if (x.hostname === 'www.googleapis.com') x.searchParams.delete('key');      // the reader's key is never kept
      if (x.hostname === 'external-content.duckduckgo.com' && x.searchParams.get('u')) x.searchParams.set('u', x.searchParams.get('u').replace(/[?&]h=300$/, ''));
      s = x.href;
    } catch {}
    return s;
  };
  // the saved answers by their address (each file pair: <key>.json with the address, <key>.bin with the body)
  const index = new Map();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try { const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (m.url) index.set(norm(m.url), { ...m, body: path.join(dir, f.slice(0, -5) + '.bin') }); } catch {}
  }
  const ddgRecord = !!process.env.COZYSHELVES_COVERS_RECORD_DDG;
  return async (url, opts) => {
    const hit = index.get(norm(url));
    if (hit && fs.existsSync(hit.body)) return { ok: hit.ok, status: hit.status, contentType: hit.contentType, buffer: fs.readFileSync(hit.body), saved: true };
    if (synth) { const s = await synth(url); if (s) return { ...s, saved: true }; }
    if (!record || (isDdg(url) && !ddgRecord)) throw new Error('offline (no fixture for ' + String(url).slice(0, 80) + ')');
    const r = await real(url, opts);
    // a refusal is not kept (the next recording asks again); "nothing here" (404) is an answer
    if (!r.ok && r.status !== 404) return r;
    const k = crypto.createHash('sha1').update(norm(url)).digest('hex').slice(0, 20);
    fs.writeFileSync(path.join(dir, k + '.bin'), r.buffer);
    fs.writeFileSync(path.join(dir, k + '.json'), JSON.stringify({ url: norm(url), ok: r.ok, status: r.status, contentType: r.contentType }));
    index.set(norm(url), { url, ok: r.ok, status: r.status, contentType: r.contentType, body: path.join(dir, k + '.bin') });
    return r;
  };
}

/** A small map that forgets the entry used least recently once it holds `max`. */
class Lru {
  constructor(max) { this.max = max; this.map = new Map(); }
  get(k) { const v = this.map.get(k); if (v !== undefined) { this.map.delete(k); this.map.set(k, v); } return v; }
  set(k, v) { this.map.delete(k); this.map.set(k, v); while (this.map.size > this.max) this.map.delete(this.map.keys().next().value); return v; }
  delete(k) { this.map.delete(k); }
  get size() { return this.map.size; }
}

class WebCovers {
  /**
   * @param library   the Library (records and cover files)
   * @param settings  the settings store (`webCovers`: covers from the internet, `webMetadata`: metadata, both default on)
   * @param decode    (job) → Promise of the indexer window's look at a picture (app/src/indexer.js imageJob):
   *                  { ok, width, height, box, grid, aspect, preview?, jpeg?, color?, stats? }
   * @param fetch     (url, { headers, timeout, maxBytes }) → Promise<{ ok, status, contentType, buffer }>
   * @param pace      scales the pauses between requests to one host (0: none, for saved answers)
   * @param emit      (channel, payload) → to the renderer (the progress of "Alle Cover jetzt laden")
   */
  constructor({ library, settings, userData, decode, fetch = null, now = () => Date.now(), pause = null, log = console, network = true, pace = null, gap = null, emit = () => {}, ready = () => true }) {
    this.library = library;
    this.network = network;
    this.settings = settings;
    this.decode = decode;
    this.ready = ready;              // the indexer window can decode pictures
    this.now = now;
    this.log = log;
    const env = process.env;
    const real = fetch || makeFetch();
    const fixtures = env.COZYSHELVES_COVERS_FIXTURES;
    let synth = null;
    if (fixtures && env.COZYSHELVES_COVERS_SYNTH) { try { synth = require('./cover-synth').makeSynth(); } catch (e) { log.warn?.('[covers] no synthetic answers', e.message); } }
    const base = fixtures ? fixtureFetch(fixtures, real, !!env.COZYSHELVES_COVERS_RECORD, synth) : real;
    // every request to DuckDuckGo is counted (the search, its JSON, every thumbnail and picture through its proxy)
    this.fetch = (url, opts) => { if (isDdg(url)) { this.stats.ddgRequests++; this.store.data.ddg.count = (this.store.data.ddg.count || 0) + 1; } return base(url, opts); };
    this.basePause = pause ?? (env.COZYSHELVES_COVERS_PAUSE ? +env.COZYSHELVES_COVERS_PAUSE : DDG_PAUSE);
    this.store = new Store(path.join(userData, 'web-covers.json'), {
      misses: {}, fast: {}, rests: {}, placeholders: [], batch: null,
      ddg: { until: 0, strikes: 0, pause: this.basePause, last: 0, ok: 0, recent: [], count: 0 },
    });
    // a pause given for a test run applies as it is; otherwise never below the base (the base may have grown)
    const d = this.store.data.ddg;
    d.pause = pause != null || env.COZYSHELVES_COVERS_PAUSE ? this.basePause : Math.max(d.pause || 0, this.basePause);
    if (!Array.isArray(d.recent)) d.recent = [];
    delete this.store.data.ol;                  // the Open Library pauses of 0.6 (cover-sources.js keeps them now)
    // records of books that are gone
    for (const k of ['misses', 'fast']) for (const id of Object.keys(this.store.data[k])) if (!library.books[id]) delete this.store.data[k][id];
    const paceScale = pace ?? (env.COZYSHELVES_COVERS_PACE != null ? +env.COZYSHELVES_COVERS_PACE : fixtures && !env.COZYSHELVES_COVERS_RECORD ? 0 : 1);
    this.net = new Net({ fetch: this.fetch, now, log, pace: paceScale, rests: this.store.data.rests });
    this.sources = makeSources(this.net);
    this.gap = gap ?? (env.COZYSHELVES_COVERS_GAP != null ? +env.COZYSHELVES_COVERS_GAP : paceScale ? 1500 : 0);
    this.priority = [];
    this.cache = new Lru(CACHE_DDG);            // book id → { at, query, groups, cands, via } (DuckDuckGo, for the choice)
    this.picks = new Lru(CACHE_PICK);           // book id → { at, items } (the catalogues' pictures, for the choice)
    this.qkeys = new Map();                     // book id → { sig, q } (the key of a book's search, kept per title)
    this.inFlight = new Set();
    this.decoding = 0; this.decodeQueue = [];
    this.timer = null; this.timerDue = 0; this.busy = false; this.again = false; this.stopped = false;
    this.current = null;
    this.stats = { searches: 0, found: 0, misses: 0, checks: 0, refused: 0, fast: 0, fastFound: 0, meta: 0, ddgRequests: 0, webFound: 0, engines: {} };
    this.batch = new CoverBatch(this, { emit: (s) => emit('covers:batch', s) });
  }

  /** The search in the background runs: the setting is on (default) and this run may use the network. */
  enabled() { const v = this.settings?.get?.('webCovers'); return this.network && v !== false; }
  /** Metadata from the internet: the setting is on (default) and this run may use the network. */
  metaEnabled() { const v = this.settings?.get?.('webMetadata'); return this.network && v !== false; }
  get state() { return this.store.data; }
  stop() { this.stopped = true; clearTimeout(this.timer); this.batch.stop(); this.store.flush(); }

  // ------------------------------------------------------------------ which books --------------------------------
  /** Page 1 (the cached cover) of an indexed book has not been looked at yet. */
  needsCheck(b) {
    return !!b && !b.missing && b.indexed && b.hasCover && !b.coverGenerated && b.coverSource !== 'web' && (b.coverCheck || 0) < COVER_CHECK;
  }
  /** A book that may be looked up at all (see BOOK_FORMATS): indexed, there, of book length, with a title. */
  lookable(b) {
    if (!b || b.missing || !b.indexed) return false;
    if (!BOOK_FORMATS.has(b.format) || (b.format === 'pdf' && !(b.pageCount >= MIN_PAGES))) return false;
    return String(b.title || '').trim().length >= 3;
  }
  /** A book without a real cover that may get one from the internet. A cover the reader chose stays, whatever it is. */
  needsCover(b) {
    if (!this.lookable(b) || b.coverSource === 'web' || b.coverChoice) return false;
    return b.coverGenerated === true || !!b.coverWeak;
  }
  /** The key of a book's search: changes when its title, author or ISBN change (then it is asked again at once). */
  qkey(b) { return this.keys(b).q; }
  /** The image search's query of a book (cover-match.js coverQuery), kept like the key. */
  ddgQuery(b) { return this.keys(b).dq; }
  keys(b) {
    const sig = `${b.title}|${b.author}|${b.isbn}|${b.language}`;
    const c = this.qkeys.get(b.id);
    if (c && c.sig === sig) return c;
    const k = BM.bookKey(b);
    const dq = M.coverQuery(b);
    // the image search only for a title it can find: one with an author, or one of several words that says what it is
    // ("Strategie" alone finds any book about strategy)
    const e = { sig, q: [k.all.join(' '), k.surnames.join(' '), k.isbns[0] || ''].join('|'), dq: dq.q, img: dq.authorWords.length > 0 || BM.distinctive(dq.titleWords) };
    this.qkeys.set(b.id, e);
    return e;
  }
  /** The catalogues have not been asked about this book (for its present title), or long ago without a result. */
  fastDue(b) {
    const f = this.state.fast[b.id];
    if (!f || f.q !== this.qkey(b)) return true;
    if (f.hit) return false;
    return this.now() - f.at > (f.soft ? SOFT_RETRY : FAST_RETRY);
  }
  /** Asked DuckDuckGo before without a result, and not long enough ago (a changed title asks again at once). */
  missedRecently(b, q) {
    const m = this.state.misses[b.id];
    if (!m || m.q !== q) return false;
    const n = Math.max(1, m.tries || 1);
    const wait = m.soft ? Math.min(2 * DAY, SOFT_RETRY * 4 ** (n - 1)) : MISS_DAYS[Math.min(MISS_DAYS.length, n) - 1] * DAY;
    return this.now() - m.at < wait;
  }
  nextCheck() {
    for (const b of Object.values(this.library.books)) if (this.needsCheck(b)) return b;
    return null;
  }
  /** The next book for the catalogues: the one whose info card is open, then the newest, must-read books first. */
  nextFast() {
    const books = this.library.books;
    while (this.priority.length) {
      const b = books[this.priority[this.priority.length - 1]];
      if (b && this.needsCover(b) && !this.inFlight.has(b.id) && this.fastDue(b)) return b;
      this.priority.pop();
    }
    let best = null;
    for (const b of Object.values(books)) {
      if (!this.needsCover(b) || this.inFlight.has(b.id) || !this.fastDue(b)) continue;
      if (!best || (!!b.mustRead - !!best.mustRead || (b.addedAt || 0) - (best.addedAt || 0) || String(best.title).localeCompare(String(b.title), 'de')) > 0) best = b;
    }
    return best;
  }
  /** The next book for the image search engines: the catalogues did not know it, the engines were not asked lately. */
  nextBook() {
    const books = this.library.books;
    const ok = (b) => !this.inFlight.has(b.id) && this.imageDue(b);
    for (let i = this.priority.length - 1; i >= 0; i--) { const b = books[this.priority[i]]; if (b && ok(b)) return b; }
    let best = null;
    for (const b of Object.values(books)) {
      if (!ok(b)) continue;
      // must-read books first (they lie on the display boards), then in the order of the titles
      if (!best || (!!b.mustRead - !!best.mustRead || String(best.title).localeCompare(String(b.title), 'de')) > 0) best = b;
    }
    return best;
  }
  /** A field the catalogues may fill in is missing (author, year, publisher), and the catalogues were not asked lately. */
  metaDue(b) {
    if (!this.lookable(b) || !META_TRIGGER.some((f) => BM.missing(b, f))) return false;
    const w = b.metaWeb;
    if (!w || w.q !== this.qkey(b)) return true;
    return this.now() - (w.at || 0) > META_RETRY;
  }
  nextMeta() {
    if (!this.metaEnabled()) return null;
    for (const b of Object.values(this.library.books)) {
      if (this.inFlight.has(b.id)) continue;
      // values found before and lost when the file was read again: back without asking anyone
      if (b.metaWeb?.val && this.lookable(b)) this.reapplyMeta(b);
      if (this.metaDue(b)) return b;
    }
    return null;
  }
  /** The book whose info card is open goes first. */
  prioritize(id) {
    if (!this.library.books[id]) return false;
    this.priority = this.priority.filter((x) => x !== id);
    this.priority.push(id);
    this.kick(500);
    return true;
  }

  // ------------------------------------------------------------------ the loop ----------------------------------
  kick(delay = 0) {
    if (this.stopped) return;
    const due = this.now() + delay;
    if (this.timer && this.timerDue <= due) return;
    clearTimeout(this.timer);
    this.timerDue = due;
    this.timer = setTimeout(() => { this.timer = null; this.pump(); }, Math.max(0, delay));
  }
  /** Milliseconds until DuckDuckGo may be asked again (its pause, its refusal, its window of a quarter of an hour). */
  ddgWait(gap = null) {
    const d = this.state.ddg;
    const recent = (d.recent || []).filter((t) => this.now() - t < DDG_WINDOW);
    const full = recent.length >= DDG_WINDOW_MAX ? recent[recent.length - DDG_WINDOW_MAX] + DDG_WINDOW - this.now() : 0;
    return Math.max(0, d.until - this.now(), d.last + (gap ?? d.pause) - this.now(), full);
  }
  async pump() {
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    let wait = null;
    try {
      while (!this.stopped) {
        const lib = this.library;
        if (lib.indexing || lib.queue?.length) { wait = 10e3; break; }        // the indexer goes first
        const check = this.nextCheck();
        if (check) {
          const ok = await this.checkCover(check);
          if (!ok) { wait = 5e3; break; }
          await sleep(15);
          continue;
        }
        if (!this.enabled() && !this.metaEnabled()) break;
        // "Alle Cover jetzt laden" paused: the search in the background rests as well
        if (this.batch.data?.state === 'paused') break;
        // the catalogues, one book at a time (while "Alle Cover jetzt laden" runs, it does this itself)
        if (!this.batch.running) {
          const b = this.enabled() ? this.nextFast() : null;
          if (b) { await this.fastCover(b); await sleep(this.gap); continue; }
          const m = this.metaEnabled() ? this.nextMeta() : null;
          if (m) { await this.fastMeta(m); await sleep(this.gap); continue; }
        }
        // the image search engines for the books the catalogues did not know, each within its budget (while "Alle
        // Cover jetzt laden" runs, it asks them itself)
        if (!this.enabled() || this.batch.running) break;
        const b = this.nextBook();
        if (!b) break;
        const w = this.imageWait();
        if (w > 0) { wait = Math.min(w, 6 * 3600e3) + Math.round(Math.random() * 5e3); break; }
        await this.imageCover(b);
        await sleep(this.gap);
      }
    } catch (e) {
      this.log.warn?.('[covers] pump failed', e);
      wait = 60e3;
    } finally {
      this.busy = false;
      this.current = null;
      this.store.save();
    }
    if (this.again) { this.again = false; this.kick(100); }
    else if (wait != null) this.kick(wait);
  }

  /** Looks at page 1 (the cached cover) of a book indexed before covers were checked. false: try again later. */
  async checkCover(b) {
    const url = `cover://${b.id}/${b.id}.jpg`;
    let r = null;
    try { r = await this.decode({ url, stats: true }); } catch (e) { r = { ok: false, error: e.message }; }
    if (!r || !r.ok) {
      if (r?.error === 'no indexer' || r?.error === 'timeout') return false;
      // a cover file that cannot be read: nothing to judge
      this.library.applyCoverCheck(b.id, null);
      return true;
    }
    this.stats.checks++;
    this.library.applyCoverCheck(b.id, r.stats);
    return true;
  }
  /** Pictures go to the indexer window two at a time: a batch of many books never piles them up there. */
  async decodeLimited(job) {
    while (this.decoding >= 2) await new Promise((r) => this.decodeQueue.push(r));
    this.decoding++;
    try { return await this.decode(job); } catch (e) { return { ok: false, error: e.message }; }
    finally { this.decoding--; const next = this.decodeQueue.shift(); if (next) next(); }
  }

  // ------------------------------------------------------------------ the catalogues -------------------------------
  /** The reader's own key for Google Books (settings googleBooksKey), '' when there is none. */
  googleKey() { return String(this.settings?.get?.('googleBooksKey') || '').trim(); }
  /**
   * The catalogues that answer a kind of question ('isbn', 'asin', 'title') for a book of a language: the DNB not for
   * books in another language than German, Google only while it is not resting after "no quota" (a key of the reader's
   * ends a rest that came without one).
   */
  askable(by, lang) {
    const key = this.googleKey();
    return Object.keys(this.sources).filter((n) => {
      if (!this.sources[n].by.includes(by)) return false;
      if (n === 'dnb' && lang && lang !== 'de') return false;
      if (n === 'google') {
        const rest = this.state.rests['www.googleapis.com'];
        if (rest && rest.until > this.now()) {
          if (key && !rest.keyed) delete this.state.rests['www.googleapis.com'];
          else return false;
        }
      }
      return true;
    });
  }
  /**
   * The catalogue to ask next: of `names` not in `asked`, one that is free right now (its host's pause and budget) and
   * promises most for the language; when none is free, the one free soonest. null when every one was asked.
   */
  nextSource(names, asked, lang) {
    const first = FIRST[lang === 'de' ? 'de' : 'other'];
    let best = null;
    for (const name of names) {
      if (asked.has(name)) continue;
      const w = this.net.wait(this.sources[name].host);
      const k = { name, free: w <= FREE_MS ? 1 : 0, w, p: first[name] ?? 1 };
      if (!best || (k.free - best.free || k.p - best.p || best.w - k.w) > 0) best = k;
    }
    return best ? best.name : null;
  }
  /** Amazon's number for a record's picture: its ASIN, else the ISBN-10 of its own ISBN. */
  amazonId(rec) { return rec?.asin || BM.isbn10(rec?.isbnOwn || rec?.isbns?.[0]) || null; }

  /**
   * Looks a book up in the catalogues: its ISBN first (or the ASIN in its file name), then its title (and author), then,
   * for a title cut off in its file name, its first words. Each question goes to one catalogue at a time, the best free
   * one, until a record that is the book has a picture (`cover`) or any such record is there (metadata): a batch spreads
   * over all catalogues at once. `every` asks all of them at once (the choice in the book info).
   * Returns { bk, matched (records that are the book, best first), answered (a catalogue replied), cover (the stored
   * picture) | null }.
   */
  async lookup(b, { cover = true, every = false } = {}) {
    let bk = BM.bookKey(b);
    const results = [];
    let answered = false;
    const key = this.googleKey();
    const run = async (name, q) => {
      const r = await this.sources[name].search(name === 'google' ? { ...q, key } : q);
      if (r.answered) answered = true;
      // a rest after "no quota" with the reader's key stays (a new key ends it, see askable)
      if (name === 'google' && key) { const rest = this.state.rests['www.googleapis.com']; if (rest && rest.until > this.now()) rest.keyed = true; }
      results.push({ name, ...r });
    };
    const strong = (k) => this.match(k, results).filter((x) => x.rank >= 2);
    const enough = (k) => !every && (cover ? strong(k).some((x) => x.rec.cover || this.amazonId(x.rec)) : strong(k).length > 0);
    const plans = [];
    /** The questions for one key of the book, each to one free catalogue after the other; true when a record is the book. */
    const search = async (k) => {
      // the surname of the first author ("Fontane, Theodor" and "Theodor Fontane" alike)
      const surname = k.surnames[0] ? (BM.personName(BM.splitNames(k.author)[0] || '').split(/\s+/).pop() || '') : '';
      const questions = [];
      if (k.isbns.length) questions.push({ by: 'isbn', q: { isbn: k.isbns[0], isbns: k.isbns, lang: k.qlang }, cap: 2 });
      else if (k.asin) questions.push({ by: 'asin', q: { asin: k.asin }, cap: 1 });
      BM.queriesFor(k).forEach((t, i) => questions.push({ by: 'title', q: { title: t.title, author: surname, lang: k.qlang }, cap: i ? 2 : 4 }));
      for (const qu of questions) {
        if (enough(k)) break;
        const names = this.askable(qu.by, k.qlang);
        // Google filters by the language the book names itself (not the one guessed from the title)
        const ask = (n) => run(n, n === 'google' && qu.by === 'title' ? { ...qu.q, lang: k.lang } : qu.q);
        if (every) {
          await Promise.all(names.map(ask));
          if (this.match(k, results).length) break;
          continue;
        }
        const asked = new Set();
        plans.push({ k, names, asked, ask });
        while (asked.size < qu.cap && !enough(k)) {
          const n = this.nextSource(names, asked, k.qlang);
          if (!n) break;
          asked.add(n);
          await ask(n);
        }
      }
      return strong(k).length > 0;
    };
    const known = await search(bk);
    // a file name the indexer read the other way round ("Heinrich von Kleist - Michael Kohlhaas": the title is a person's
    // name, the author field holds the title): turned around once
    if (!known && bk.author && !bk.isbns.length && M.looksLikeName(bk.title)) {
      const alt = BM.bookKey({ ...b, title: bk.author, author: bk.title });
      if (alt.all.length && (await search(alt))) bk = alt;
    }
    let matched = this.match(bk, results);
    let found = cover && !every ? await this.pickCover(bk, matched) : null;
    // only a doubtful picture (a 3D mock-up on white, a page of text), a lesser edition, or the book known without a
    // picture that loads: two more catalogues get a chance
    if (cover && !every && (found?.suspect || found?.lesser || (!found && matched.some((m) => m.rank >= 2)))) {
      const plan = plans.find((x) => x.k === bk && x.asked.size < x.names.length);
      for (let i = 0; plan && i < 2; i++) {
        const n = this.nextSource(plan.names, plan.asked, bk.qlang);
        if (!n) break;
        plan.asked.add(n);
        await plan.ask(n);
      }
      matched = this.match(bk, results);
      found = await this.pickCover(bk, matched);
    }
    return { bk, matched, answered, cover: found };
  }
  /** The records that are the book, best first (book-match.js matchRecord), each { rec, level, rank, score, … }. */
  match(bk, results) {
    const seen = new Set(), out = [];
    for (const r of results) for (const rec of r.records || []) {
      const key = rec.source + '|' + (rec.id || rec.title) + '|' + (rec.cover?.url || '');
      if (seen.has(key)) continue;
      seen.add(key);
      const m = BM.matchRecord(bk, rec);
      if (m.ok) out.push({ rec, ...m });
    }
    const pri = PRIORITY[bk.qlang === 'de' ? 'de' : 'other'];
    return out.sort((a, b) => b.rank - a.rank || b.score - a.score || (pri[b.rec.source] || 0) - (pri[a.rec.source] || 0) || b.lang - a.lang);
  }
  /**
   * The records with a picture in the order their pictures are tried: the surest match, then an edition for readers
   * before a lesser one (for learners, printed on demand), then the catalogue (for German books the publishers' covers
   * of the DNB first), then the edition of the publisher most editions come from, the language, the title score.
   */
  coverOrder(bk, matched) {
    const pri = PRIORITY[bk.qlang === 'de' ? 'de' : 'other'];
    const lesserBook = BM.isLesser({ title: bk.text });
    const main = BM.mainPublisher(matched.filter((m) => m.rec.source === 'dnb').map((m) => m.rec));
    const key = (m) => ({ l: !lesserBook && BM.isLesser(m.rec) ? 1 : 0, p: main && BM.pubKey(m.rec.publisher) === main ? 1 : 0 });
    // Amazon's picture of the edition a sure record names by its ISBN or ASIN (the record stays the one of the metadata)
    const all = [...matched];
    for (const m of matched) {
      const id = m.rank >= 2 ? this.amazonId(m.rec) : null;
      const c = id && amazonCover(id);
      if (c && !all.some((x) => x.rec.cover?.url === c.url)) all.push({ ...m, rec: { ...m.rec, source: 'amazon', cover: c, page: 'https://www.amazon.de/dp/' + (/^B0/.test(id) ? id : BM.isbn10(id) || id), base: m.rec } });
    }
    return all.filter((m) => m.rec.cover?.url).map((m) => ({ m, k: key(m) }))
      .sort((a, b) => b.m.rank - a.m.rank || a.k.l - b.k.l || (pri[b.m.rec.source] || 0) - (pri[a.m.rec.source] || 0) || b.k.p - a.k.p || b.m.lang - a.m.lang || b.m.score - a.m.score)
      .map((x) => x.m);
  }
  /**
   * The cover among the records: the first picture of a sure match that loads and is a book cover (at least 300 px
   * tall, upright, not empty or one-coloured, no placeholder). A doubtful picture (on a white ground like a 3D mock-up,
   * or a page of plain text like a scanned flap) is taken only when no other one is good (`suspect`). A plain title
   * without a known author counts only when two catalogues show the same picture. null: better no cover than a wrong one.
   */
  async pickCover(bk, matched) {
    const cands = this.coverOrder(bk, matched);
    const tried = new Set(), perSource = {};
    let doubtful = null;
    for (const m of cands.filter((x) => x.rank >= 2)) {
      if (tried.size >= 5) break;
      // two pictures of one catalogue at most: when they do not load, the others get their turn
      if (tried.has(m.rec.cover.url) || (perSource[m.rec.source] || 0) >= 2) continue;
      tried.add(m.rec.cover.url);
      perSource[m.rec.source] = (perSource[m.rec.source] || 0) + 1;
      const c = await this.fetchCover(m.rec.cover.url);
      if (!c) continue;
      const found = this.coverOf(c.d, { image: m.rec.cover.url, page: m.rec.page, site: SOURCE_SITE[m.rec.source], via: m.rec.source, sha: c.sha, level: m.level });
      found.rec = m.rec.base || m.rec;
      // a lesser edition (for learners, printed on demand) is taken, but another catalogue may have a better one
      found.lesser = BM.isLesser(m.rec) && !BM.isLesser({ title: bk.text });
      if (!c.suspect) return found;
      if (!doubtful) { doubtful = found; doubtful.suspect = true; }
    }
    if (doubtful) return doubtful;
    const weak = cands.filter((x) => x.rank === 1).slice(0, 4);
    if (new Set(weak.map((x) => x.rec.source)).size >= 2) {
      const got = [];
      for (const m of weak) { const c = await this.fetchCover(m.rec.cover.url); if (c) got.push({ c, m }); }
      for (let i = 0; i < got.length; i++) for (let j = i + 1; j < got.length; j++) {
        const [a, b] = [got[i], got[j]];
        if (a.m.rec.source === b.m.rec.source || !M.samePicture(a.c.fp, b.c.fp)) continue;
        const best = (b.c.d.jpegHeight || 0) > (a.c.d.jpegHeight || 0) ? b : a;
        const found = this.coverOf(best.c.d, { image: best.m.rec.cover.url, page: best.m.rec.page, site: SOURCE_SITE[best.m.rec.source], via: best.m.rec.source, sha: best.c.sha, level: 'agree' });
        found.rec = best.m.rec.base || best.m.rec;
        return found;
      }
    }
    return null;
  }
  /**
   * One picture of a catalogue, loaded and looked at: { d (the indexer's look), sha, fp, suspect } or null. suspect: on
   * a uniform ground (`framed`, a 3D mock-up of the book on white) or light paper with nothing but text (a scanned page).
   */
  async fetchCover(url) {
    let r;
    try { r = await this.net.get(url, { timeout: 25000, maxBytes: 12 << 20, accept: 'image/*', retries: 1 }); } catch { return null; }
    if (!r.ok || !r.buffer || r.buffer.length < 1500 || (r.contentType && !/^image\//i.test(r.contentType))) return null;
    const sha = crypto.createHash('sha1').update(r.buffer).digest('hex').slice(0, 16);
    if (this.state.placeholders.includes(sha)) return null;
    const d = await this.decodeLimited({ bytes: r.buffer, grid: true, jpeg: COVER_PX, stats: true });
    if (!this.usable(d) || !(d.aspect >= 0.45 && d.aspect <= 0.95)) return null;
    return { d, sha, fp: M.fingerprint(d.grid, d.aspect), suspect: !!d.framed || M.weakKind(d.stats) === 'text' };
  }
  /**
   * The same file for records of different titles is no cover but a host's "no picture" image: it is remembered as
   * such, and books that got it before go back to their title card (and are looked up again). Two books that matched
   * the same record (a work in two files, two volumes under one title) share its picture rightly.
   */
  placeholder(sha, rec) {
    if (!sha) return false;
    if (this.state.placeholders.includes(sha)) return true;
    const key = BM.titleInfo(rec?.title || '').all;
    const others = Object.values(this.library.books).filter((x) => x.coverSource === 'web' && x.coverWeb?.sha === sha && !x.coverChoice);
    const differ = others.filter((x) => { const o = BM.titleInfo(x.coverWeb.rt || '').all; return !o.length || !key.length || (BM.coverage(o, key) < 0.5 && BM.coverage(key, o) < 0.5); });
    if (!differ.length) return false;
    this.state.placeholders.push(sha);
    if (this.state.placeholders.length > 200) this.state.placeholders.splice(0, this.state.placeholders.length - 200);
    for (const x of others) { this.library.restoreBookCover(x.id, { choice: null }); delete this.state.fast[x.id]; }
    this.log.warn?.(`[covers] one picture for ${others.length + 1} different books: a placeholder, set back`);
    return true;
  }

  /**
   * Finds a cover in the catalogues and stores it (with the metadata the records add, when that setting is on).
   * Returns { found, answered } or { skipped } for a book that is looked up right now.
   */
  async fastCover(b, { meta = this.metaEnabled() } = {}) {
    if (this.inFlight.has(b.id)) return { skipped: true };
    this.inFlight.add(b.id);
    const q = this.qkey(b);
    this.current = { id: b.id, title: b.title };
    try {
      const res = await this.lookup(b, { cover: true });
      this.stats.fast++;
      const cur = this.library.books[b.id];
      if (!cur) return { gone: true };
      let found = false;
      if (res.cover && this.needsCover(cur) && !this.placeholder(res.cover.sha, res.cover.rec)) {
        if (this.library.applyWebCover(b.id, res.cover)) {
          // the file's fingerprint and the record's title: a placeholder of a catalogue shows up under other titles
          if (cur.coverWeb) { cur.coverWeb.sha = res.cover.sha; cur.coverWeb.rt = String(res.cover.rec?.title || '').slice(0, 80); }
          found = true;
          this.stats.fastFound++; this.stats.found++;
          delete this.state.misses[b.id];
        }
      }
      this.state.fast[b.id] = found ? { at: this.now(), q, hit: true } : res.answered ? { at: this.now(), q, hit: false } : { at: this.now(), q, hit: false, soft: true };
      if (meta) this.applyMeta(b.id, res.matched, q, found ? res.cover.rec : null);
      this.log.log?.(`[covers] "${res.bk.title}": ` + (found ? `${res.cover.via} ${res.cover.width}×${res.cover.height} (${res.cover.level})` : res.answered ? 'not in the catalogues' : 'catalogues not reachable'));
      return { found, answered: res.answered };
    } catch (e) {
      this.log.warn?.('[covers] lookup failed', b.title, e);
      this.state.fast[b.id] = { at: this.now(), q, hit: false, soft: true };
      return { found: false, answered: false, error: e.message };
    } finally {
      this.inFlight.delete(b.id);
      this.store.save();
    }
  }
  /** Metadata only (the book has a cover): the catalogues without pictures. */
  async fastMeta(b) {
    if (this.inFlight.has(b.id)) return { skipped: true };
    this.inFlight.add(b.id);
    const q = this.qkey(b);
    try {
      const res = await this.lookup(b, { cover: false });
      const cur = this.library.books[b.id];
      if (!cur) return { gone: true };
      // no catalogue could be asked: again in an hour
      if (!res.answered) { cur.metaWeb = { ...(cur.metaWeb || {}), at: this.now() - META_RETRY + SOFT_RETRY, q }; this.library.db.save(); return { filled: false }; }
      return { filled: this.applyMeta(b.id, res.matched, q) };
    } catch (e) {
      this.log.warn?.('[covers] metadata lookup failed', b.title, e);
      return { filled: false, error: e.message };
    } finally { this.inFlight.delete(b.id); }
  }
  /**
   * The metadata of the matched records go into the book: only fields it lacks (book-match.js metadataFrom), with
   * where each came from (`metaWeb.src`) and the values (`metaWeb.val`, so that they come back without a request
   * when the file is read again). A program's name in the author field ("Microsoft Office User") counts as missing;
   * it is kept in `metaWeb.was`. true when a field was filled in.
   */
  applyMeta(id, matched, q, chosen = null) {
    const b = this.library.books[id];
    if (!b || !this.metaEnabled()) return false;
    const strong = matched.filter((m) => m.rank >= 2).map((m) => ({ ...m.rec, rank: m.rank }));
    const { patch, src } = BM.metadataFrom(b, strong, { chosen });
    const prev = b.metaWeb || {};
    const was = { ...(prev.was || {}) };
    if (patch.author && b.author) was.author = b.author;
    Object.assign(b, patch);
    b.metaWeb = { at: this.now(), q, src: { ...(prev.src || {}), ...src }, val: { ...(prev.val || {}), ...patch } };
    if (Object.keys(was).length) b.metaWeb.was = was;
    this.library.db.save();
    const n = Object.keys(patch).length;
    if (n) { this.stats.meta++; this.library.notifyBook(id); }
    return n > 0;
  }
  /** Values from the catalogues the book lost when its file was read again (the indexer starts from the file). */
  reapplyMeta(b) {
    const val = b.metaWeb?.val || {};
    let n = 0;
    for (const [k, v] of Object.entries(val)) if (BM.missing(b, k) && v != null && v !== '') { b[k] = v; n++; }
    if (n) { this.library.db.save(); this.library.notifyBook(b.id); }
    return n;
  }

  // ------------------------------------------------------------------ the image search engines ---------------------
  /** The image search engines the reader allows (settings coverEngines: Bing, Yandex, DuckDuckGo; all by default). */
  engines() {
    const c = this.settings?.get?.('coverEngines') || {};
    return IE.ENGINES.filter((e) => c[e] !== false);
  }
  /** Milliseconds until an engine may be asked: its budget and rest (DuckDuckGo: its pause and window, a minute by hand). */
  engineWait(name, manual = false) {
    if (name === 'duckduckgo') return this.ddgWait(manual ? DDG_MANUAL_GAP : null);
    return this.net.wait(ENGINE_URL[name]);
  }
  /** The time until the first engine the reader allows is free (0: now; Infinity: none allowed). */
  imageWait(manual = false) {
    const list = this.engines();
    return list.length ? Math.min(...list.map((e) => this.engineWait(e, manual))) : Infinity;
  }
  /** The book waits for the image search: the catalogues did not know it, the engines were not asked lately, and its title can be found. */
  imageDue(b) {
    return this.needsCover(b) && !this.fastDue(b) && this.engines().length > 0 && this.keys(b).img && !this.missedRecently(b, this.ddgQuery(b));
  }
  /**
   * The image search for a book: of the engines that are free right now the one with the most of its budget left (its
   * searches so far against those it takes in a minute: Bing most often, DuckDuckGo seldom); a second engine with an
   * index of its own only when the first gave nothing convincing, and its votes join the first's (the same picture on
   * two engines wins); an engine that cannot answer (offline, a captcha) makes way for the next free one. `only`: these
   * engines (a test), `manual`: the reader asked (DuckDuckGo then after a minute).
   * Returns { query, cands, groups, pick, answered, asked, blocked }.
   */
  async webSearch(b, { max = 2, manual = false, only = null } = {}) {
    const query = M.coverQuery(b);
    const order = (only || this.engines()).map((e) => ({ e, k: ((this.stats.engines[e] || 0) + 1) / IE.ENGINE_RATE[e] })).sort((x, y) => x.k - y.k);
    let cands = [], answered = false, blocked = false, asked = 0, pick = null;
    const heard = new Set();          // the indexes that answered (Bing's pictures also come through DuckDuckGo)
    for (const { e } of order) {
      if (heard.size >= max || this.stopped) break;          // an engine that could not answer does not count
      if (this.engineWait(e, manual) > 0 || heard.has(IE.indexOf(e))) continue;
      asked++;
      const r = await this.searchEngine(e, query);
      if (!r.ok) { blocked = blocked || !!r.blocked; continue; }
      answered = true;
      heard.add(IE.indexOf(e));
      cands = cands.concat(r.cands);
      pick = M.pickCover(cands, query);
      if (pick && pick.confidence === 'cluster') break;
    }
    const groups = pick ? pick.groups : M.scoreClusters(M.clusterCandidates(cands), query);
    return { query, cands, groups, pick, answered, asked, blocked };
  }
  /** One engine's search with its results analysed (the thumbnails from the engine's own cache). { ok, cands, blocked } */
  async searchEngine(name, query) {
    this.stats.engines[name] = (this.stats.engines[name] || 0) + 1;
    if (name === 'duckduckgo') return this.searchDdg(query);
    const url = name === 'bing' ? IE.bingUrl(query) : IE.yandexUrl(query);
    let r;
    try { r = await this.net.get(url, { timeout: 15000, maxBytes: 4 << 20, retries: 0, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', headers: browserHeaders(query.lang) }); }
    catch (e) {
      if (e.code === 'busy') this.net.rest(url, ENGINE_REST[name], ENGINE_REST_MAX, 'too many requests');
      this.log.warn?.(`[covers] ${name}: ${e.code || e.message}`);
      return { ok: false, blocked: e.code === 'busy' || e.code === 'rest', error: e.code };
    }
    if (IE.isChallenge(r)) { this.net.rest(url, ENGINE_REST[name], ENGINE_REST_MAX, 'a captcha or a challenge'); this.stats.refused++; return { ok: false, blocked: true }; }
    if (!r.ok) return { ok: false, error: 'status ' + r.status };
    const html = r.buffer.toString('utf8');
    const cands = await this.analyse(name === 'bing' ? IE.parseBing(html) : IE.parseYandex(html), name);
    if (cands.unreachable) return { ok: false, error: 'thumbnails' };
    return { ok: true, cands };
  }
  /**
   * The image search for a book the catalogues did not know, its pick stored as the cover. A book the engines answered
   * without a convincing picture is a miss, asked again after days; one no engine could answer comes back within hours;
   * when no engine was free nothing changes (the book stays due). Returns { cover, answered, asked }.
   */
  async imageCover(b, opts = {}) {
    if (this.inFlight.has(b.id)) return { cover: null, answered: false, asked: 0, skipped: true };
    this.inFlight.add(b.id);
    this.current = { id: b.id, title: b.title };
    try {
      const res = await this.webSearch(b, opts);
      const query = res.query;
      let found = null;
      if (res.answered) {
        this.cache.set(b.id, { at: this.now(), query, groups: res.groups, cands: res.cands, via: 'web' });
        if (res.pick) found = await this.downloadGroup(res.pick.group);
      }
      const cur = this.library.books[b.id];
      this.log.log?.(`[covers] "${query.q}" (${query.region}): ` + (found ? `${found.via} ${found.site || ''} ${found.width}×${found.height}` : res.answered ? 'nothing convincing' : res.asked ? 'not answered' : 'no engine free'));
      if (found && cur && this.needsCover(cur)) {
        this.library.applyWebCover(b.id, found);
        delete this.state.misses[b.id];
        this.stats.found++; this.stats.webFound++;
      } else if (!found && res.asked) {
        const prev = this.state.misses[b.id];
        const again = prev && prev.q === query.q;
        this.state.misses[b.id] = res.answered
          ? { at: this.now(), q: query.q, tries: (again && !prev.soft ? prev.tries || 1 : 0) + 1 }
          : { at: this.now(), q: query.q, soft: true, tries: (again && prev.soft ? prev.tries || 1 : 0) + 1 };
        if (res.answered) this.stats.misses++;
      }
      this.store.save();
      return { cover: found, answered: res.answered, asked: res.asked };
    } finally { this.inFlight.delete(b.id); }
  }
  /** The image search for one book: the cover found and stored, or null. */
  async findCover(b, opts = {}) { return (await this.imageCover(b, opts)).cover; }
  /** One image search: the results, their analysed thumbnails, the groups and the pick. */
  async searchDdg(query) {
    const d = this.state.ddg;
    const before = d.last;
    d.last = this.now();
    d.recent = [...(d.recent || []).filter((t) => this.now() - t < DDG_WINDOW), d.last];
    this.stats.searches++;
    const ua = browserUa();
    let results;
    try {
      const page = await this.fetch('https://duckduckgo.com/?' + new URLSearchParams({ q: query.q, iax: 'images', ia: 'images', kp: '1', kl: query.region }), {
        headers: { 'User-Agent': ua, 'Accept-Language': acceptLanguage(query.lang), Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }, timeout: 15000, maxBytes: 2 << 20 });
      if (!page.ok) return this.refused('page ' + page.status);
      const vqd = /vqd=["']?([\d-]+)/.exec(page.buffer.toString('utf8'))?.[1];
      if (!vqd) return this.refused('no vqd');
      // p=1 and kp=1: safe search on, strict
      const js = await this.fetch('https://duckduckgo.com/i.js?' + new URLSearchParams({ l: query.region, o: 'json', q: query.q, vqd, f: ',,,,,', p: '1', kp: '1' }), {
        headers: { 'User-Agent': ua, 'Accept-Language': acceptLanguage(query.lang), Accept: 'application/json, text/javascript, */*; q=0.01', Referer: 'https://duckduckgo.com/' }, timeout: 15000, maxBytes: 4 << 20 });
      if (!js.ok) return this.refused('i.js ' + js.status);
      let data;
      try { data = JSON.parse(js.buffer.toString('utf8')); } catch { return this.refused('i.js not json'); }
      results = Array.isArray(data.results) ? data.results : [];
      // a saved answer (test run) asked nobody: no pause
      if (page.saved && js.saved) { d.last = before; d.recent.pop(); }
    } catch (e) {
      // offline, a timeout, a reset connection: no strike, a short pause
      d.until = Math.max(d.until, this.now() + NET_PAUSE);
      this.log.warn?.('[covers] DuckDuckGo unreachable:', e.message);
      return { ok: false, error: e.message };
    }
    d.strikes = 0;
    d.ok = (d.ok || 0) + 1;
    if (d.ok >= 10 && d.pause > Math.max(DDG_PAUSE_MIN, this.basePause)) { d.pause = Math.max(DDG_PAUSE_MIN, this.basePause, Math.round(d.pause * 0.9)); d.ok = 0; }
    const cands = await this.analyse(results);
    if (cands.unreachable) {
      d.until = Math.max(d.until, this.now() + NET_PAUSE);
      this.log.warn?.('[covers] DuckDuckGo image proxy unreachable');
      return { ok: false, error: 'proxy' };
    }
    const pick = M.pickCover(cands, query);
    return { ok: true, cands, pick, groups: pick ? pick.groups : M.scoreClusters(M.clusterCandidates(cands), query) };
  }
  /** DuckDuckGo declined (a block page, no token): back off, longer every time, and search less often for a while. */
  refused(why) {
    const d = this.state.ddg;
    d.strikes = (d.strikes || 0) + 1;
    d.ok = 0;
    d.until = this.now() + Math.min(6 * 3600e3, DDG_BLOCK * 2 ** (d.strikes - 1));
    d.pause = Math.min(DDG_PAUSE_MAX, Math.round((d.pause || this.basePause) * 1.5));
    this.stats.refused++;
    this.log.warn?.(`[covers] DuckDuckGo declined (${why}), next search in ${Math.round((d.until - this.now()) / 60e3)} min`);
    this.store.save();
    return { ok: false, blocked: true };
  }

  /**
   * The thumbnails of the first results of an engine, four at a time, each analysed by the indexer window: proportions of
   * the content, fingerprints and a small preview. They come from the engine's own image cache: DuckDuckGo's proxy (it
   * shows Bing's copies), Bing's thumbnails, Yandex's; never from the websites the pictures belong to.
   */
  async analyse(results, engine = 'duckduckgo') {
    const list = [];
    results.slice(0, THUMBS).forEach((r, rank) => {
      if (!r || !r.thumbnail || !/^https?:/i.test(r.thumbnail)) return;
      if (engine === 'duckduckgo' && !(r.width > 0 && r.height > 0)) return;
      if (r.width > 0 && r.height > 0 && r.width / r.height > 2.2) return;   // panoramas (a banner may still show the cover in a frame)
      list.push({ rank, r });
    });
    const cands = [];
    let fetched = 0;
    for (let i = 0; i < list.length; i += 4) {
      await Promise.all(list.slice(i, i + 4).map(async ({ rank, r }) => {
        try {
          const t = await this.engineImage(engine, r.thumbnail, 240);
          if (!t || !t.ok || !t.buffer.length) return;
          fetched++;
          const d = await this.decodeLimited({ bytes: t.buffer, grid: true, preview: 220, stats: true });
          if (!d || !d.ok || !d.grid) return;
          // an empty or one-coloured picture is a placeholder ("no picture"), never a cover, however many shops show it
          const weak = M.weakKind(d.stats);
          if (weak === 'blank' || weak === 'uniform') return;
          cands.push({
            rank, engine, site: M.siteOf(r.url), title: String(r.title || ''), url: String(r.url || ''), image: String(r.image || ''), thumbnail: r.thumbnail,
            width: r.width, height: r.height, aspect: d.aspect, fp: M.fingerprint(d.grid, d.aspect), preview: d.preview || null,
          });
        } catch (e) { /* one thumbnail less */ }
      }));
    }
    cands.sort((a, b) => a.rank - b.rank);
    cands.unreachable = list.length > 0 && fetched === 0;     // not one thumbnail came through: the cache is away
    return cands;
  }
  /** A picture from an engine's cache: Bing's in the height asked for, Yandex's small one, the rest through DuckDuckGo's proxy. */
  async engineImage(engine, url, height) {
    const opts = { timeout: height > 300 ? 25000 : 12000, maxBytes: height > 300 ? 16 << 20 : 3 << 20 };
    if (engine === 'bing') return this.net.get(IE.bingThumb(url, height), { ...opts, retries: 0, accept: 'image/*', headers: browserHeaders() });
    if (engine === 'yandex') return this.net.get(url, { ...opts, retries: 0, accept: 'image/*', headers: browserHeaders() });
    return this.fetch(proxied(height > 300 ? url : smallThumb(url)), { headers: { 'User-Agent': browserUa(), Referer: 'https://duckduckgo.com/' }, ...opts });
  }

  /**
   * The picture of a group as a cover: the largest copy at least 300 px tall that really is the picture of its thumbnail
   * (a host may send a placeholder instead). A copy found by Bing comes from Bing's cache in up to 900 px, any other
   * one through DuckDuckGo's proxy (when the reader allows DuckDuckGo): no website sees the reader's address. Failing
   * every copy, a thumbnail itself when it is tall enough.
   */
  async downloadGroup(group, { choice = null } = {}) {
    const ddgOk = this.engines().includes('duckduckgo');
    for (const m of M.downloadOrder(group, MIN_HEIGHT).slice(0, 4)) {
      const engine = m.engine || 'duckduckgo';
      if (engine !== 'bing' && engine !== 'duckduckgo' && !ddgOk) continue;
      try {
        const r = engine === 'bing' ? await this.engineImage('bing', m.thumbnail, COVER_PX) : await this.engineImage('duckduckgo', m.image, COVER_PX);
        if (!r || !r.ok || r.buffer.length < 2000) continue;
        const d = await this.decodeLimited({ bytes: r.buffer, grid: true, jpeg: COVER_PX, stats: true });
        if (!this.usable(d)) continue;
        if (!M.verifyDownload(m.fp, M.fingerprint(d.grid, d.aspect))) continue;
        return this.coverOf(d, { image: m.image, page: m.url, site: m.site, via: engine, choice });
      } catch (e) { /* the next copy */ }
    }
    const thumbs = [group.rep, ...group.members.filter((m) => m !== group.rep)].filter((m) => M.downloadable(m) && m.thumbnail).slice(0, 3);
    for (const m of thumbs) {
      const engine = m.engine || 'duckduckgo';
      try {
        const r = await this.engineImage(engine, m.thumbnail, engine === 'bing' ? COVER_PX : 300);
        if (!r || !r.ok) continue;
        const d = await this.decodeLimited({ bytes: r.buffer, grid: true, jpeg: COVER_PX, stats: true });
        if (!this.usable(d)) continue;
        return this.coverOf(d, { image: m.image, page: m.url, site: m.site, via: engine, choice });
      } catch (e) { /* the next one */ }
    }
    return null;
  }
  /** Decoded, tall enough, not an empty or one-coloured placeholder. */
  usable(d) {
    if (!d || !d.ok || !d.jpeg || !d.grid) return false;
    if ((d.boxHeight || d.height || 0) < MIN_HEIGHT) return false;
    const weak = M.weakKind(d.stats);
    return weak !== 'blank' && weak !== 'uniform';
  }
  coverOf(d, { image, page, site, via, choice = null, sha = null, level = null }) {
    return { jpeg: Buffer.from(String(d.jpeg).split(',')[1] || '', 'base64'), color: d.color || null, width: d.jpegWidth || 0, height: d.jpegHeight || 0, image, page, site, via, choice, sha, level };
  }

  // ------------------------------------------------------------------ the info card ------------------------------
  /**
   * The pictures for "Anderes Cover": the catalogues' pictures of every record that is the book (each catalogue asked
   * once, the previews loaded small), then the groups of an image search when one is at hand (`web`: search now with
   * the engines that are free; otherwise the wait). Each item { key, preview, source ('web' for the image search),
   * engines, site, title, info, width, height, sites, current }.
   */
  async candidates(id, { refresh = false, web = false } = {}) {
    const b = this.library.books[id];
    if (!b) return { ok: false, error: 'unknown book' };
    const cur = b.coverSource === 'web' ? b.coverWeb?.image : null;
    let pick = this.picks.get(id);
    if ((!pick || refresh || this.now() - pick.at > CACHE_MS) && this.network) {
      const res = await this.lookup(b, { cover: true, every: true });
      const items = [];
      for (const m of this.coverOrder(res.bk, res.matched)) {
        const c = m.rec.cover;
        if (items.some((x) => x.url === c.url) || items.length >= 10) continue;
        let r = null;
        try { r = await this.net.get(c.preview || c.url, { timeout: 15000, maxBytes: 4 << 20, accept: 'image/*', retries: 1 }); } catch {}
        if (!r || !r.ok || r.buffer.length < 1000 || (r.contentType && !/^image\//i.test(r.contentType))) continue;
        const d = await this.decodeLimited({ bytes: r.buffer, preview: 220, stats: true });
        if (!d?.ok || !d.preview || ['blank', 'uniform'].includes(M.weakKind(d.stats))) continue;
        const r0 = m.rec;
        items.push({ url: c.url, preview: d.preview, source: r0.source, site: SOURCE_SITE[r0.source], page: r0.page, title: [r0.title, r0.subtitle].filter(Boolean).join(': '),
          info: [BM.isEdition(r0) && r0.source !== 'apple' ? BM.yearOf(r0.year) : null, r0.publisher ? String(r0.publisher).slice(0, 40) : null].filter(Boolean).join(' · '), level: m.level });
      }
      pick = this.picks.set(id, { at: this.now(), items });
    }
    const out = (pick?.items || []).map((it, i) => ({ key: `f:${pick.at}:${i}`, preview: it.preview, source: it.source, site: it.site, title: it.title, info: it.info, sites: 1, current: !!cur && cur === it.url }));
    // the image search: the groups of the last one, or a new one when the reader asks for it and an engine is free
    let entry = this.cache.get(id);
    if (entry && this.now() - entry.at > CACHE_MS) { this.cache.delete(id); entry = null; }
    let webState = entry ? 'done' : 'none', webWait = 0;
    if (!entry && web && this.network) {
      if (!this.engines().length) webState = 'off';
      else if ((webWait = this.imageWait(true)) > 0) webState = 'wait';
      else {
        const res = await this.webSearch(b, { manual: true });
        if (res.answered) { entry = this.cache.set(id, { at: this.now(), query: res.query, groups: res.groups, cands: res.cands, via: 'web' }); webState = 'done'; }
        else { webState = res.blocked ? 'busy' : 'offline'; webWait = this.imageWait(true); }
      }
    }
    if (entry) {
      entry.groups
        .filter((g) => g.rep?.preview && g.members.some(M.downloadable) && g.aspect >= 0.45 && g.aspect <= 1.05)
        .slice(0, 12)
        .forEach((g) => out.push({ key: `d:${entry.at}:${entry.groups.indexOf(g)}`, preview: g.rep.preview, source: 'web', engines: [...new Set(g.members.map((m) => m.engine || 'duckduckgo'))], site: g.rep.site, title: g.rep.title, sites: g.sites,
          width: Math.max(...g.members.map((m) => m.width || 0)), height: Math.max(...g.members.map((m) => m.height || 0)), current: !!cur && g.members.some((m) => m.image === cur) }));
    }
    return { ok: true, items: out, web: { state: webState, wait: webWait }, offline: !this.network, own: await this.ownPreview(b) };
  }
  /** A small picture of the book's own page 1 when the book shows something else (a cover from the internet, the title card). */
  async ownPreview(b) {
    let file = null;
    if (b.coverSource === 'web' && !b.coverBook?.generated) file = this.library.coverBackupPath(b.id);
    else if (b.coverSource !== 'web' && b.coverChoice === 'card' && !b.coverGenerated) file = this.library.coverPath(b.id);
    if (!file) return null;
    try {
      if (!fs.existsSync(file)) return null;
      const d = await this.decodeLimited({ bytes: fs.readFileSync(file), preview: 220 });
      return d?.ok && d.preview ? { preview: d.preview } : null;
    } catch { return null; }
  }
  /** The reader picked a picture: it becomes the cover and stays (no automatic search replaces it). */
  async choose(id, key) {
    const [kind, at, idx] = String(key || '').split(':');
    let found = null;
    if (kind === 'f') {
      const pick = this.picks.get(id);
      const it = pick && pick.at === +at ? pick.items[+idx] : null;
      if (!it) return { ok: false, error: 'stale' };
      const c = await this.fetchCover(it.url);
      if (c) { found = this.coverOf(c.d, { image: it.url, page: it.page, site: it.site, via: it.source, sha: c.sha, choice: 'web' }); found.rt = it.title; }
    } else {
      const entry = this.cache.get(id);
      if (!entry || entry.at !== +at || !entry.groups[+idx]) return { ok: false, error: 'stale' };
      found = await this.downloadGroup(entry.groups[+idx], { choice: 'web' });
    }
    if (!found) return { ok: false, error: 'download' };
    const book = this.library.applyWebCover(id, found);
    if (book && found.sha && this.library.books[id]?.coverWeb) Object.assign(this.library.books[id].coverWeb, { sha: found.sha, rt: found.rt || null });
    delete this.state.misses[id];
    this.store.save();
    return { ok: !!book, book };
  }
  /** A picture of the reader's own (a file): it becomes the cover for good. */
  async chooseFile(id, file) {
    if (!this.library.books[id]) return { ok: false, error: 'unknown book' };
    let bytes;
    try {
      const st = fs.statSync(file);
      if (!st.isFile() || st.size > 40 << 20) return { ok: false, error: 'file' };
      bytes = fs.readFileSync(file);
    } catch { return { ok: false, error: 'file' }; }
    const d = await this.decodeLimited({ bytes, grid: true, jpeg: COVER_PX, stats: true });
    if (!d?.ok || !d.jpeg) return { ok: false, error: 'undecodable' };
    const book = this.library.applyWebCover(id, this.coverOf(d, { image: null, page: null, site: null, via: 'file', choice: 'own' }));
    this.store.save();
    return { ok: !!book, book };
  }
  /** Back to the book's own cover, for good (until the reader picks another). */
  useBookCover(id) {
    const book = this.library.restoreBookCover(id, { choice: 'book' });
    return { ok: !!book, book };
  }
  /** The generated title card, for good: no search replaces it (app/src/world/book-art.js isGeneratedCover). */
  useTitleCard(id) {
    const book = this.library.restoreBookCover(id, { choice: 'card' });
    return { ok: !!book, book };
  }

  /** How far the covers have come: for the settings and the progress of "Alle Cover jetzt laden". */
  status() {
    const books = Object.values(this.library.books).filter((b) => !b.missing);
    let web = 0, pending = 0, missed = 0, waiting = 0, meta = 0, lastMiss = 0;
    for (const b of books) {
      if (b.metaWeb?.src && Object.keys(b.metaWeb.src).length) meta++;
      if (b.coverSource === 'web') { web++; continue; }
      if (!this.needsCover(b)) continue;
      if (this.fastDue(b)) { pending++; continue; }
      // waiting for the image search, or without a match (asked lately, a title it cannot find, every engine off)
      if (this.imageDue(b)) waiting++;
      else { missed++; lastMiss = Math.max(lastMiss, this.state.misses[b.id]?.at || 0, this.state.fast[b.id]?.at || 0); }
    }
    const d = this.state.ddg;
    // the image search engines: on or off, how long until each may be asked again
    const engines = {};
    for (const e of IE.ENGINES) engines[e] = { on: this.engines().includes(e), wait: this.engineWait(e), searches: this.stats.engines[e] || 0 };
    const iw = this.imageWait();
    return {
      enabled: this.enabled(), metadata: this.metaEnabled(), web, pending, waiting, missed, lastMiss, meta,
      checking: books.filter((b) => this.needsCheck(b)).length, current: this.current,
      pausedUntil: Math.max(d.until, 0) > this.now() ? d.until : 0, imageNext: Number.isFinite(iw) && iw > 60e3 ? this.now() + iw : 0, engines,
      batch: this.batch.status(), stats: this.stats, rests: Object.fromEntries(Object.entries(this.state.rests).filter(([, r]) => r.until > this.now())),
    };
  }
  /** "Erneut versuchen": the books without a match are asked again at once (the catalogues, then the image search). */
  forgetMisses() {
    let n = 0;
    for (const b of Object.values(this.library.books)) {
      if (!this.needsCover(b)) continue;
      if (this.state.fast[b.id] || this.state.misses[b.id]) n++;
      delete this.state.fast[b.id]; delete this.state.misses[b.id];
    }
    this.store.save();
    return n;
  }
}

/** The headers of a browser for the image search engines (the language of the book first). */
function browserHeaders(lang) {
  return { 'User-Agent': browserUa(), 'Accept-Language': acceptLanguage(lang) };
}
function browserUa() {
  const v = process.versions.chrome || '140.0.0.0';
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
}
function acceptLanguage(lang) {
  return lang === 'en' ? 'en-US,en;q=0.9' : lang === 'de' || !lang ? 'de-DE,de;q=0.9,en;q=0.7' : `${lang};q=0.9,en;q=0.6`;
}

// ---------------------------------------------------------------- wiring into the app -------------------------------
/**
 * The indexer window decodes pictures for the main process: `decode(job)` sends it an 'image-job' and waits for its
 * answer (app/src/indexer.js). A window that is not ready answers { ok: false, error: 'no indexer' }.
 */
function makeDecoder(ipcMain, getIndexer) {
  const pending = new Map();
  let seq = 0;
  ipcMain.handle('indexer:image-result', (e, id, result) => {
    const p = pending.get(id);
    if (p) { pending.delete(id); clearTimeout(p.timer); p.resolve(result || { ok: false }); }
    return true;
  });
  return (job) => {
    const win = getIndexer();
    if (!win || win.isDestroyed?.()) return Promise.resolve({ ok: false, error: 'no indexer' });
    const id = ++seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: 'timeout' }); }, 30000);
      pending.set(id, { resolve, timer });
      try { win.webContents.send('image-job', { id, ...job }); } catch (e) { clearTimeout(timer); pending.delete(id); resolve({ ok: false, error: e.message }); }
    });
  };
}

let instance = null;
function register({ ipcMain, app, settings, library, broadcast, dialog, getMainWindow }) {
  if (!library) return;
  // automated test runs (build/screenshot.js) stay off the network unless a test asks for the covers (covers-check)
  const env = process.env;
  const network = !env.COZYSHELVES_TEST || !!env.COZYSHELVES_COVERS_FIXTURES || !!env.COZYSHELVES_COVERS_LIVE;
  const covers = instance = new WebCovers({ library, settings, userData: app.getPath('userData'), decode: makeDecoder(ipcMain, () => library.getIndexer()), network,
    emit: (ch, p) => broadcast?.(ch, p), ready: () => !!library.getIndexer() });
  ipcMain.handle('covers:status', () => covers.status());
  ipcMain.handle('covers:candidates', (e, id, opts) => covers.candidates(id, opts || {}));
  ipcMain.handle('covers:choose', (e, id, key) => covers.choose(id, key));
  ipcMain.handle('covers:useBook', (e, id) => covers.useBookCover(id));
  ipcMain.handle('covers:useCard', (e, id) => covers.useTitleCard(id));
  ipcMain.handle('covers:prioritize', (e, id) => covers.prioritize(id));
  // "Eigenes Bild wählen": the system's file dialog (a test passes the file itself)
  ipcMain.handle('covers:chooseFile', async (e, id, file = null) => {
    if (!file || !env.COZYSHELVES_TEST) {
      const win = getMainWindow?.();
      const r = await dialog.showOpenDialog(win, { title: library.settings?.get?.('language') === 'en' ? 'Choose a picture' : 'Bild wählen', properties: ['openFile'], filters: [{ name: 'Bilder / Pictures', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'] }] });
      if (r.canceled || !r.filePaths?.[0]) return { ok: false, error: 'canceled' };
      file = r.filePaths[0];
    }
    return covers.chooseFile(id, file);
  });
  // "Alle Cover jetzt laden": start, pause, resume, cancel, retry (the books without a match again)
  ipcMain.handle('covers:batch', (e, cmd) => {
    if (cmd === 'start') covers.batch.start();
    else if (cmd === 'retry') { covers.forgetMisses(); covers.batch.start({ retry: true }); }
    else if (cmd === 'pause') covers.batch.pause();
    else if (cmd === 'resume') covers.batch.resume();
    else if (cmd === 'cancel') covers.batch.cancel();
    return covers.status();
  });
  // the loop wakes up when the indexer is done and when a setting is switched on
  library.onIdle?.(() => { covers.kick(3000); covers.batch.wake(); });
  settings.onChange?.((s) => { if (s?.webCovers !== false || s?.webMetadata !== false) covers.kick(1000); if (s?.webCovers === false) covers.batch.pause(); });
  app.on('before-quit', () => covers.stop());
  covers.kick(20e3);
  covers.batch.restore();
}

module.exports = { WebCovers, register, makeDecoder, fixtureFetch, proxied, BOOK_FORMATS, SOURCE_SITE, get instance() { return instance; } };
