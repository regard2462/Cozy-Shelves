// "Alle Cover jetzt laden": every book without a real cover at once, six books at a time, in the main process (each
// asks the catalogue that is free right now, so the six spread over all of them). Each
// book goes through the book catalogues first (web-covers.js fastCover); a book they do not know goes to the image
// search engines right away when one of them has budget left (web-covers.js imageCover: Bing, Yandex, DuckDuckGo, each
// within its own budget), otherwise it waits in a queue the workers go through as the engines' budgets allow. Each
// cover is stored the moment it is found (one JPEG, the world takes it from the next frame on without a rebuild),
// nothing of a picture stays in memory afterwards, and one book that fails never stops the others. The run can be
// paused and cancelled, and it goes on after a restart where it stopped (its state lives in web-covers.json).
'use strict';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WORKERS = 6;
const EMIT_MS = 250;

class CoverBatch {
  /**
   * @param wc       the WebCovers instance (its store keeps the batch: state.batch)
   * @param emit     (status) → the renderer (settings panel)
   */
  constructor(wc, { workers = WORKERS, emit = () => {} } = {}) {
    this.wc = wc;
    this.workers = workers;
    this.emit = emit;
    this.active = 0;
    this.current = new Map();      // book id → title, the books asked about right now
    this.waiting = false;          // the indexer is busy (it goes first)
    this.engineWait = 0;           // only books for the image search are left, and no engine is free before this
    this.runStart = 0;
    this.lastEmit = 0; this.emitTimer = null;
    this.peak = { rss: 0, heap: 0 };
  }
  get data() { return this.wc.state.batch; }
  get running() { return this.data?.state === 'running'; }

  /** { state: 'idle'|'running'|'paused'|'done'|'cancelled', total, done, found, missed, failed, skipped, later, current[], … } */
  status() {
    const d = this.data;
    if (!d) return { state: 'idle', total: 0, done: 0, found: 0, missed: 0, failed: 0, skipped: 0, later: 0, current: [] };
    const elapsed = (d.elapsed || 0) + (this.runStart ? Date.now() - this.runStart : 0);
    const asked = Math.max(0, d.done - d.skipped);
    return {
      state: d.state, total: d.total, done: d.done, found: d.found, missed: d.missed, failed: d.failed, skipped: d.skipped, later: (d.later || []).length,
      current: [...this.current.values()], waiting: this.waiting, engineWait: this.engineWait, startedAt: d.startedAt, finishedAt: d.finishedAt || 0,
      elapsed, perBook: asked ? Math.round(elapsed / asked) : 0, perMinute: elapsed > 5000 ? Math.round((asked / elapsed) * 60e3 * 10) / 10 : 0, peak: { ...this.peak },
    };
  }
  /** Is a book still to be asked: by the catalogues, or by the image search engines? */
  due(b) { return !!b && this.wc.needsCover(b) && (this.wc.fastDue(b) || this.wc.imageDue(b)); }
  /** A new run over the books without a real cover that were not asked lately (retry: all of them). */
  start({ retry = false } = {}) {
    if (this.running) return this.status();
    const wc = this.wc;
    const books = Object.values(wc.library.books).filter((b) => wc.needsCover(b) && (retry || this.due(b)));
    // must-read books first, then in the order they stand in the room (folder by folder)
    books.sort((a, b) => !!b.mustRead - !!a.mustRead || String(a.relPath || a.title).localeCompare(String(b.relPath || b.title), 'de', { numeric: true }));
    // ids: the books in their order, next: the first one not taken yet, active: those asked about right now (a restart
    // asks them again), later: those waiting for a free image search engine
    wc.state.batch = { state: 'running', ids: books.map((b) => b.id), total: books.length, next: 0, active: [], later: [], done: 0, found: 0, missed: 0, failed: 0, skipped: 0, startedAt: Date.now(), finishedAt: 0, elapsed: 0, retry: !!retry };
    this.peak = { rss: 0, heap: 0 };
    wc.store.save();
    this.notify(true);
    this.run();
    return this.status();
  }
  pause() {
    if (!this.running) return;
    this.data.state = 'paused';
    this.wc.store.save();
    this.notify(true);
  }
  resume() {
    const d = this.data;
    if (!d || d.state !== 'paused') return;
    d.state = 'running';
    this.wc.store.save();
    this.notify(true);
    this.run();
  }
  cancel() {
    const d = this.data;
    if (!d || (d.state !== 'running' && d.state !== 'paused')) return;
    d.state = 'cancelled';
    d.finishedAt = Date.now();
    d.ids = []; d.next = 0; d.active = []; d.later = [];
    this.wc.store.save();
    this.notify(true);
  }
  /**
   * After a restart: a run that was going on continues (a paused one waits for "Fortsetzen"); the books that were being
   * asked about when the app quit come first again.
   */
  restore() {
    const d = this.data;
    if (d && (d.state === 'running' || d.state === 'paused') && d.active?.length) {
      d.ids = [...d.active, ...d.ids.slice(d.next)];
      d.next = 0; d.active = [];
      this.wc.store.save();
    }
    if (this.running) this.run();
  }
  /** The indexer became idle: a waiting run goes on. */
  wake() { if (this.running && !this.active) this.run(); }
  /** The app quits: the state stays as it is (a running batch continues at the next start). */
  stop() { clearTimeout(this.emitTimer); }

  run() {
    if (!this.running || this.active) return;
    this.runStart = Date.now();
    for (let i = 0; i < this.workers; i++) this.worker();
  }
  /** The next book: from the list, then from the queue for the image search once an engine is free. null: nothing left. */
  async take(d) {
    const wc = this.wc;
    for (;;) {
      if (!this.running || wc.stopped || this.data !== d) return null;
      if (d.next < d.ids.length) return { id: d.ids[d.next++], image: false };
      if (!(d.later || []).length) return null;
      const w = wc.imageWait();
      // every engine switched off meanwhile: the books waiting for one count as not found
      if (!Number.isFinite(w)) { d.done += d.later.length; d.missed += d.later.length; d.later = []; this.notify(); return null; }
      if (w <= 0) { this.engineWait = 0; return { id: d.later.shift(), image: true }; }
      if (!this.engineWait) { this.engineWait = Date.now() + w; this.notify(); }
      await sleep(Math.min(w + 50, 2000));
    }
  }
  async worker() {
    this.active++;
    const wc = this.wc, lib = wc.library;
    try {
      while (this.running && !wc.stopped) {
        // the indexer goes first, and the pictures need its window
        if (lib.indexing || lib.queue?.length || !wc.ready()) { if (!this.waiting) { this.waiting = true; this.notify(); } await sleep(2000); continue; }
        if (this.waiting) { this.waiting = false; this.notify(); }
        if (!wc.enabled()) { this.pause(); break; }
        const d = this.data;
        const next = await this.take(d);
        if (!next) break;
        const id = next.id;
        const b = lib.books[id];
        if (!this.due(b) || wc.inFlight.has(id)) { d.done++; d.skipped++; continue; }
        this.current.set(id, b.title || '');
        (d.active = d.active || []).push(id);
        this.notify();
        let r;
        try { r = await this.book(b); } catch (e) { r = { error: e.message }; }
        this.current.delete(id);
        if (this.data !== d) break;                       // cancelled and started again meanwhile
        d.active = d.active.filter((x) => x !== id);
        if (r.later) { (d.later = d.later || []).push(id); this.notify(); continue; }
        d.done++;
        if (r.found) d.found++;
        else if (r.error || r.answered === false) d.failed++;
        else if (r.skipped) d.skipped++;
        else d.missed++;
        this.sample();
        wc.store.save();
        this.notify();
      }
    } catch (e) {
      wc.log.warn?.('[covers] batch worker', e);
    } finally {
      this.active--;
      if (!this.active) this.finish();
    }
  }
  /**
   * One book: the catalogues (when not asked yet), then the image search engines when one is free now; when none is,
   * { later: true } and the book waits in the queue. { found, answered, skipped, error, later }
   */
  async book(b) {
    const wc = this.wc;
    if (wc.fastDue(b)) {
      const r = await wc.fastCover(b);
      if (r.found || r.skipped || r.gone || r.error || r.answered === false) return r;
    }
    const cur = wc.library.books[b.id];
    if (!cur || !wc.imageDue(cur)) return { found: false, answered: true };
    if (wc.imageWait() > 0) return { later: true };
    const r = await wc.imageCover(cur);
    if (r.skipped) return { skipped: true };
    if (!r.asked) return { later: true };                // the engine was taken by another worker meanwhile
    return { found: !!r.cover, answered: r.answered };
  }
  finish() {
    const d = this.data;
    if (this.runStart) { if (d) d.elapsed = (d.elapsed || 0) + Date.now() - this.runStart; this.runStart = 0; }
    this.current.clear();
    this.waiting = false; this.engineWait = 0;
    if (d && d.state === 'running' && d.next >= d.ids.length && !(d.later || []).length && !this.wc.stopped) {
      d.state = 'done';
      d.finishedAt = Date.now();
      d.ids = []; d.next = 0; d.active = []; d.later = [];
      this.wc.kick(2000);
    }
    this.wc.store.save();
    this.notify(true);
  }
  /** The memory of the main process at its highest during the run (the batch check reads it). */
  sample() {
    const m = process.memoryUsage();
    this.peak.rss = Math.max(this.peak.rss, Math.round(m.rss / 1048576));
    this.peak.heap = Math.max(this.peak.heap, Math.round(m.heapUsed / 1048576));
  }
  notify(now = false) {
    const fire = () => { this.emitTimer = null; this.lastEmit = Date.now(); try { this.emit(this.status()); } catch {} };
    if (now) { clearTimeout(this.emitTimer); fire(); return; }
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(fire, Math.max(0, EMIT_MS - (Date.now() - this.lastEmit)));
  }
}

module.exports = { CoverBatch, WORKERS };
