// The audiobooks of the user's audiobook folders: the scanned records (scan.js), their covers, where the listener is
// in each one (position, finished, speed) and the folder watchers. Plain Node: Electron comes in through the options
// (makeThumbs, urlFor, emit), so the unit tests run it without a window.
//
// Public record (state().books): { id, kind, title, author, narrator, series, seriesIndex, year, genre, description,
//   duration, trackCount, chapterCount, formats, size, mtime, added, path, folder, cover: { thumb, large, color } | null,
//   progress: { track, offset, position, duration, finished, lastPlayed, rate } | null }
// Full record (book(id)): the public one with tracks [{ url, name, title, duration, exact, start }] and
//   chapters [{ track, offset, title }].
const fs = require('fs');
const path = require('path');
const { Store } = require('../store');
const { scanFolders } = require('./scan');
const { readPicture } = require('./tags');
const { TagCache } = require('./cache');

const WATCH_DEBOUNCE = 4000;
const DESC_MAX = 800;

class AudiobookLibrary {
  /**
   * @param userData    data folder (audiobooks.json, audiobook-tags.json, audiobook-covers/)
   * @param getFolders  () → [{ path }] (settings.audiobooks.folders)
   * @param emit        (channel, payload) → to the renderer
   * @param urlFor      (absPath) → URL the renderer can load (lfile://…)
   * @param makeThumbs  (buffer, basePath) → { thumb, large, color } (files written next to basePath) or null
   */
  constructor({ userData, getFolders, emit = () => {}, urlFor = (p) => p, makeThumbs = null }) {
    this.userData = userData; this.getFolders = getFolders; this.emit = emit; this.urlFor = urlFor; this.makeThumbs = makeThumbs;
    this.coversDir = path.join(userData, 'audiobook-covers');
    this.store = new Store(path.join(userData, 'audiobooks.json'), { books: {}, covers: {}, schema: 1 });
    this.cache = new TagCache(path.join(userData, 'audiobook-tags.json'));
    this.books = [];                 // scanned records, in the order of the scan
    this.byId = new Map();
    this.scanState = { active: false, phase: 'idle', done: 0, total: 0, unavailable: [], files: 0, at: 0 };
    this.scanning = null; this.again = false;
    this.watchers = []; this.watchTimer = null;
    this.coverQueue = []; this.coverBusy = false;
  }

  // ------------------------------------------------------------------------------------------------ scanning --
  /** Scan all folders (one scan at a time; a request during a scan runs once more afterwards). */
  scan() {
    if (this.scanning) { this.again = true; return this.scanning; }
    this.scanning = (async () => {
      try {
        do { this.again = false; await this.#scanOnce(); } while (this.again);
      } finally { this.scanning = null; }
    })();
    return this.scanning;
  }
  async #scanOnce() {
    const folders = (this.getFolders() || []).filter((f) => f && f.path);
    this.scanState = { ...this.scanState, active: true, phase: 'walk', done: 0, total: 0 };
    this.emit('audiobooks:scan', this.scanState);
    let last = 0;
    const res = await scanFolders(folders, {
      cache: this.cache,
      onProgress: ({ phase, done, total }) => {
        this.scanState.phase = phase; this.scanState.done = done; this.scanState.total = total;
        const now = Date.now();
        if (now - last > 300 || done === total) { last = now; this.emit('audiobooks:scan', this.scanState); }
        if (done && done % 400 === 0) this.cache.flush();
      },
    });
    this.cache.prune(res.seen, res.unavailable);
    this.cache.flush();
    // books of folders that could not be read (an unplugged drive) stay as they were
    const kept = this.books.filter((b) => res.unavailable.some((r) => b.root === r) && folders.some((f) => f.path === b.root));
    const next = [...res.books, ...kept.filter((k) => !res.books.some((b) => b.id === k.id))];
    this.#carryOver(next);
    this.books = next;
    this.byId = new Map(next.map((b) => [b.id, b]));
    const now = Date.now();
    for (const b of next) { const s = this.#progress(b.id, true); if (!s.added) s.added = now; }
    this.store.save();
    this.scanState = { active: false, phase: 'idle', done: res.files, total: res.files, unavailable: res.unavailable, files: res.files, at: now };
    this.emit('audiobooks:scan', this.scanState);
    this.notify(true);
    this.#queueCovers();
    this.watch();
  }
  /** An audiobook that moved (new place, same title, author and length) keeps where the listener was. */
  #carryOver(next) {
    const known = this.store.data.books;
    const ids = new Set(next.map((b) => b.id));
    const gone = this.books.filter((b) => !ids.has(b.id) && known[b.id]?.position > 0);
    for (const b of next) {
      if (known[b.id]) continue;
      const twin = gone.find((g) => g.title === b.title && g.author === b.author && Math.abs(g.duration - b.duration) < 2);
      if (twin) { known[b.id] = { ...known[twin.id] }; delete known[twin.id]; }
    }
  }
  #progress(id, create = false) {
    const all = this.store.data.books;
    if (!all[id] && create) all[id] = {};
    return all[id] || null;
  }

  // ------------------------------------------------------------------------------------------------ covers --
  #coverFiles(id) { return this.store.data.covers[id] || null; }
  /** Covers of books whose picture is new or changed, a few at a time in the background. */
  #queueCovers() {
    if (!this.makeThumbs) return;
    for (const b of this.books) {
      if (!b.cover) continue;
      const c = this.#coverFiles(b.id);
      if (c && c.sig === b.cover.sig && fs.existsSync(c.thumb || '')) continue;
      if (!this.coverQueue.includes(b.id)) this.coverQueue.push(b.id);
    }
    this.#pumpCovers();
  }
  async #pumpCovers() {
    if (this.coverBusy) return;
    this.coverBusy = true;
    let made = 0;
    try {
      while (this.coverQueue.length) {
        const id = this.coverQueue.shift();
        const b = this.byId.get(id); if (!b?.cover) continue;
        try {
          const buf = b.cover.kind === 'embedded' ? (await readPicture(b.cover.file, b.cover.picture))?.data : await fs.promises.readFile(b.cover.file);
          if (!buf?.length) continue;
          fs.mkdirSync(this.coversDir, { recursive: true });
          const old = this.#coverFiles(id);
          const out = this.makeThumbs(buf, path.join(this.coversDir, `${id}-${b.cover.sig}`));
          if (!out) continue;
          this.store.data.covers[id] = { sig: b.cover.sig, ...out };
          if (old) for (const k of ['thumb', 'large']) if (old[k] && old[k] !== out[k]) { try { fs.rmSync(old[k], { force: true }); } catch {} }
          made++;
          if (made % 8 === 0) this.notify();
        } catch (e) { console.warn('[audiobooks] cover failed', b.title, e.message); }
        // nativeImage works synchronously: give the main process room between two covers
        await new Promise((r) => setImmediate(r));
      }
    } finally { this.coverBusy = false; }
    if (made) { this.store.save(); this.notify(); }
  }

  // ------------------------------------------------------------------------------------------------ state --
  #public(b) {
    const p = this.#progress(b.id) || {};
    const c = b.cover ? this.#coverFiles(b.id) : null;
    const cover = c && c.sig === b.cover.sig && c.thumb ? { thumb: this.urlFor(c.thumb), large: this.urlFor(c.large || c.thumb), color: c.color || null } : null;
    return {
      id: b.id, kind: b.kind, title: b.title, author: b.author || null, narrator: b.narrator || null, series: b.series || null, seriesIndex: b.seriesIndex ?? null,
      year: b.year || null, genre: b.genre || null, description: b.description ? b.description.slice(0, DESC_MAX) : null,
      duration: b.duration, trackCount: b.tracks.length, chapterCount: b.chapters.length, formats: b.formats, size: b.size, mtime: b.mtime,
      added: p.added || null, path: b.path, folder: b.root, cover,
      progress: p.lastPlayed || p.finished ? { track: p.track ?? 0, offset: p.offset ?? 0, position: p.position ?? 0, duration: p.duration ?? b.duration, finished: !!p.finished, lastPlayed: p.lastPlayed || null, rate: p.rate || null } : null,
    };
  }
  state() {
    return { folders: (this.getFolders() || []).map((f) => ({ path: f.path })), books: this.books.map((b) => this.#public(b)), scan: this.scanState };
  }
  /** One audiobook with its tracks and chapters (URLs the renderer can play), null when unknown. */
  book(id) {
    const b = this.byId.get(id);
    if (!b) return null;
    return {
      ...this.#public(b),
      tracks: b.tracks.map((t) => ({ url: this.urlFor(t.path), name: t.name, title: t.title, duration: t.duration, exact: t.exact, start: t.start })),
      chapters: b.chapters.map((c) => ({ ...c })),
    };
  }
  /** The renderer saves where the listener is: { track, offset, position, duration, finished, rate }. */
  setProgress(id, patch = {}) {
    const b = this.byId.get(id); if (!b) return null;
    const p = this.#progress(id, true);
    for (const k of ['track', 'offset', 'position', 'duration', 'rate']) if (Number.isFinite(patch[k])) p[k] = patch[k];
    if (patch.finished != null) p.finished = !!patch.finished;
    if (patch.reset) { delete p.track; delete p.offset; delete p.position; p.finished = false; }
    p.lastPlayed = patch.touch === false ? (p.lastPlayed || null) : Date.now();
    this.store.save();
    const pub = this.#public(b).progress;
    this.emit('audiobooks:progress', { id, progress: pub });
    return pub;
  }
  /** The player measured a track's real length (an MP3 without a frame count is only estimated while scanning). */
  setTrackDuration(id, index, seconds) {
    const b = this.byId.get(id), t = b?.tracks[index];
    if (!t || !(seconds > 0) || Math.abs((t.duration || 0) - seconds) < 0.5) return false;
    t.duration = seconds; t.exact = true;
    let start = 0;
    for (const x of b.tracks) { x.start = start; start += x.duration; }
    b.duration = start;
    this.cache.patch(t.path, { duration: seconds, durationExact: true });
    clearTimeout(this.durTimer);
    this.durTimer = setTimeout(() => { this.cache.flush(); this.notify(); }, 1500);
    return true;
  }
  notify(now = false) {
    clearTimeout(this.notifyTimer);
    const send = () => this.emit('audiobooks:update', this.state());
    if (now) send(); else this.notifyTimer = setTimeout(send, 250);
  }

  // ------------------------------------------------------------------------------------------------ watching --
  /** New, changed or removed files in a folder start a quiet rescan a few seconds later. */
  watch() {
    const roots = (this.getFolders() || []).map((f) => f.path).filter((p) => p && fs.existsSync(p));
    const key = roots.join('|');
    if (key === this.watchKey) return;
    this.unwatch();
    this.watchKey = key;
    let chokidar;
    try { chokidar = require('chokidar'); } catch { return; }
    const wanted = /\.(mp3|m4a|m4b|aac|ogg|oga|opus|flac|wav|jpe?g|png|webp|bmp|gif)$/i;
    const ignored = (p, st) => {
      const base = path.basename(p || '');
      if (!base) return false;
      if (base.startsWith('.') || base.startsWith('$') || /^(node_modules|system volume information)$/i.test(base)) return true;
      return !!st && st.isFile() && !wanted.test(base);
    };
    for (const root of roots) {
      try {
        const w = chokidar.watch(root, { ignoreInitial: true, depth: 12, ignored, awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 250 } });
        const trigger = () => { clearTimeout(this.watchTimer); this.watchTimer = setTimeout(() => this.scan(), WATCH_DEBOUNCE); };
        w.on('add', trigger).on('unlink', trigger).on('change', trigger).on('addDir', trigger).on('unlinkDir', trigger).on('error', () => {});
        this.watchers.push(w);
      } catch (e) { console.warn('[audiobooks] watcher failed', e.message); }
    }
  }
  unwatch() { for (const w of this.watchers) { try { w.close(); } catch {} } this.watchers = []; this.watchKey = null; clearTimeout(this.watchTimer); }
  flush() { this.store.flush(); this.cache.flush(); }
  dispose() { this.unwatch(); this.flush(); clearTimeout(this.notifyTimer); clearTimeout(this.durTimer); }
}

module.exports = { AudiobookLibrary };
