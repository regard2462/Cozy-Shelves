// The covers on the sides of the books on the shelves. A book stands with its spine to the room; wherever a face of its
// cover is open to view (at the two ends of every row: next to the bookend, a plant or the side of the case; and next to
// a gap: a book in the basket, one pulled out right now) that face shows the cover picture instead of the binding colour.
// Seen from the room the front cover lies right of the spine, the back cover left of it. The back shows the front's
// picture as well: most books only have that one, and mirrored every letter would read backwards. Books without a cover
// image show their title card (book-art.js drawTypoCover), like the face-out copies on the boards.
//
// The pictures are small and share one atlas (cells of 128 × 192 px: 120 × 184 for the picture and a 4 px border that
// repeats its edge, side-cell.js), and every cell brings its own seven mip levels: neighbouring cells never bleed into
// each other, and nothing regenerates the mipmaps of the whole atlas. The atlas fills lazily, the faces nearest to the
// viewer first:
//  • the cells are made in a worker (workers/side-cover-worker.js): a cover image is fetched, decoded at 256 px height
//    and trimmed to the proportions of the face like a print (no stretching), a title card is drawn in those proportions
//    with the page's web fonts; the main thread only puts the finished pixels on the graphics card (painting there cost
//    6 ms a cell on average and up to 50 ms, a title card 25 ms; without a worker it does that in idle time);
//  • a few cells a frame go onto the graphics card (seven small texSubImage2D through copyTextureToTexture, about
//    0.1 ms a cell);
//  • the shelf shader (books.js) reads the atlas on the two cover faces only, with one attribute per book: no new shader
//    program, nothing rebuilt when a picture arrives, a short fade from the binding colour to the picture;
//  • a cell belongs to a book, not to a place: a rebuild (another order, the case "Gelesen", new books) keeps the cells,
//    and when the atlas is full, the cells of the faces furthest away go to nearer ones.
import * as THREE from 'three';
import { hasCoverImage, drawTypoCover, fontsLoaded } from './book-art.js';
import { SIDE_CELL, SIDE_LEVELS, CROP_TOP, paintCell, paintCoverCell } from './side-cell.js';

export { SIDE_CELL };
const CW = SIDE_CELL.w - 2 * SIDE_CELL.pad, CH = SIDE_CELL.h - 2 * SIDE_CELL.pad;   // the picture in a cell: 120 × 184
const ATLAS_W = 4096;
export const SIDE_COLS = ATLAS_W / SIDE_CELL.w;
const MIN_ROWS = 6, MAX_ROWS = 16;      // 192 to 512 cells: 24 to 64 MB on the graphics card with the mip levels
const OPEN_GAP = 0.012;                 // metres: a face next to a gap at least this wide is open to view
const SOON = 3;                         // seconds the neighbours of the book under the crosshair count as open
const IN_FLIGHT = 4;                    // cover images with the worker at the same time
const FRAME_CELLS = 3, FRAME_MS = 1;    // cells put on the graphics card in one frame, and the time they may take
const PLAN_EVERY = 0.25;                // seconds between two looks at which faces are nearest
const READY_MAX = 12;                   // finished cells waiting for the graphics card at most (the rest waits to be made)
/** Seconds a face takes from the binding colour to its picture. */
export const SIDE_FADE = 0.25;

let placeholder = null;
/** Bound before the atlas exists (no face reads it then). */
function blank() {
  if (!placeholder) { placeholder = new THREE.DataTexture(new Uint8Array([140, 133, 120, 255]), 1, 1); placeholder.needsUpdate = true; }
  return placeholder;
}
/** Shared by every shelf material (books.js makeSpineMaterial): the atlas, its size in pixels and the clock of the fade. */
export const SIDE_UNIFORMS = {
  uSideAtlas: { value: null },
  uSideSize: { value: new THREE.Vector2(ATLAS_W, MIN_ROWS * SIDE_CELL.h) },
  uSideTime: { value: 0 },
};

/**
 * The part of a picture (uv, v upwards) that a face of these proportions shows: trimmed like a print, never stretched
 * (the same as side-cell.js cropOf). `img` and `face`: width / height. Writes into `rect` (x, y, w, h).
 */
export function sideCrop(rect, img, face) {
  if (!(img > 0) || !(face > 0)) return rect.set(0, 0, 1, 1);
  if (img > face) { const w = face / img; return rect.set((1 - w) / 2, 0, w, 1); }
  const h = img / face;
  return rect.set(0, (1 - h) * (1 - CROP_TOP), 1, h);
}

async function decodeSmall(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob(), { resizeHeight: 256, resizeQuality: 'high' });
  } catch { return null; }
}
const idle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 120 }) : setTimeout(() => fn({ didTimeout: true, timeRemaining: () => 0 }), 30));

export class SideCovers {
  /** @param opts { renderer, coverUrl(id) } */
  constructor(opts = {}) {
    this.opts = opts;
    this.atlas = null; this.rows = 0;
    this.cells = new Map();          // book id → { slot, key, state: 'wait'|'load'|'ready'|'fail', shown, at, used, kind, mean }
    this.free = [];                  // free cells of the atlas (the lowest last: pop takes it first)
    this.entries = null;             // book id → shelf entry (books.js), the current build
    this.rowsOf = new Map();         // row of a case → its entries along the shelf
    this.open = new Map();           // book id → { front, back }: the faces open to view now
    this.soon = new Map();           // book id → seconds: next to the book under the crosshair, open in a moment
    this.queue = [];                 // books whose cell waits for its picture, nearest first
    this.jobs = new Map(); this.jobId = 0;   // cover images with the worker
    this.paintQ = []; this.idling = false;   // title cards (and covers without the worker) to paint in idle time
    this.decoding = 0;               // cover images decoded here (only without the worker)
    this.done = [];                  // cells ready for the graphics card: { id, c, key, levels, mean, kind }
    this.time = 0; this.planIn = 0; this.dirty = true;
    this.stats = { uploads: 0, ms: 0, max: 0, covers: 0, cards: 0, cardMs: 0, cardMax: 0, failed: 0, evicted: 0, grown: 0, worker: true };
    SIDE_UNIFORMS.uSideAtlas.value ||= blank();
  }

  get capacity() { return this.rows * SIDE_COLS; }

  /** A new build of the shelves: book id → entry (books.js, with pos, row, slotX, w, d, h, mesh, index) and the rows. */
  attach(entries, rowsOf) {
    this.entries = entries; this.rowsOf = rowsOf;
    this.open.clear();
    if (this.off) return;
    for (const list of rowsOf.values()) this.#openRow(list);
    this.#ensureAtlas();
    // what is ready shows at once on the new shelves, without a fade
    for (const [id, c] of this.cells) { const e = entries.get(id); if (e && c.shown != null) this.#show(e, c); }
    this.dirty = true;
  }

  /** A book of this row was hidden, shown, pulled out or put back: which faces are open now. */
  rowChanged(e) {
    const list = this.rowsOf.get(e?.row);
    if (this.off || !list || !list.includes(e)) return;
    this.#openRow(list);
    this.dirty = true;
  }
  /** The crosshair rests on `e`: its neighbours are about to show a face (the book comes out). */
  anticipate(e) {
    const list = this.rowsOf.get(e?.row); if (!list) return;
    const i = list.indexOf(e); if (i < 0) return;
    for (const step of [-1, 1]) {
      for (let k = i + step; k >= 0 && k < list.length; k += step) { const n = list[k]; if (n.hidden || n.preview) continue; this.soon.set(n.book.id, SOON); break; }
    }
    this.dirty = true;
  }
  /** A book's record changed (a new cover, a chosen one, page 1 turned out to be none): its cell is made again. */
  updateBook(book) { if (book && this.cells.has(book.id)) this.dirty = true; }

  /**
   * The small picture of a book's side, for the pulled-out book until its large cover is there: the atlas, with the
   * cell's picture in `rect` (uv). null when the book has none yet.
   */
  cellFor(id, rect) {
    const c = this.cells.get(id);
    if (!c || c.shown == null || !this.atlas) return null;
    const H = this.rows * SIDE_CELL.h;
    const x = (c.slot % SIDE_COLS) * SIDE_CELL.w + SIDE_CELL.pad, y = Math.floor(c.slot / SIDE_COLS) * SIDE_CELL.h + SIDE_CELL.pad;
    rect.set(x / ATLAS_W, y / H, CW / ATLAS_W, CH / H);
    return this.atlas;
  }

  /** Once a frame (books.js update). */
  update(dt, camera) {
    this.time += dt;
    SIDE_UNIFORMS.uSideTime.value = this.time;
    if (this.off) return;
    for (const [id, t] of this.soon) { if (t - dt <= 0) this.soon.delete(id); else this.soon.set(id, t - dt); }
    this.planIn -= dt;
    if (this.entries && camera && (this.dirty || this.planIn <= 0)) { this.#plan(camera.position); this.dirty = false; this.planIn = PLAN_EVERY; }
    this.#startLoads();
    this.#pump();
  }

  // ------------------------------------------------------------------ which faces ----
  /** The faces of a row open to view: at both ends of the books that show, and next to a gap of OPEN_GAP or more. */
  #openRow(list) {
    let prev = null;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.hidden || e.preview) { this.open.delete(e.book.id); continue; }
      let next = null;
      for (let k = i + 1; k < list.length; k++) if (!list[k].hidden && !list[k].preview) { next = list[k]; break; }
      const back = !prev || e.slotX - (prev.slotX + prev.w) >= OPEN_GAP;
      const front = !next || next.slotX - (e.slotX + e.w) >= OPEN_GAP;
      if (front || back) this.open.set(e.book.id, { front, back }); else this.open.delete(e.book.id);
      prev = e;
    }
  }

  /** What a cell must show for this entry: its cover image (the address carries the version) or its title card. */
  #keyOf(e) {
    const b = e.book;
    const url = hasCoverImage(b) ? this.opts.coverUrl?.(b.id) : null;
    const what = url ? 'img|' + url : `typo|${b.title || ''}|${b.author || ''}|${b.coverColor || ''}|${b.coverChoice || ''}|${fontsLoaded() ? 1 : 0}`;
    return what + '|' + (e.d / e.h).toFixed(3);
  }

  /** The open faces nearest to the viewer get a cell (the furthest give theirs up when the atlas is full). */
  #plan(cam) {
    const want = [];
    for (const id of this.open.keys()) { const e = this.entries.get(id); if (e) want.push([this.soon.has(id) ? -1 : e.pos.distanceToSquared(cam), id, e]); }
    // the neighbours of the book under the crosshair come first
    for (const id of this.soon.keys()) { if (this.open.has(id)) continue; const e = this.entries.get(id); if (e) want.push([-1, id, e]); }
    want.sort((a, b) => a[0] - b[0]);
    const n = Math.min(want.length, this.capacity);
    const keep = new Set();
    for (let i = 0; i < n; i++) keep.add(want[i][1]);
    this.queue.length = 0;
    for (let i = 0; i < n; i++) {
      const [, id, e] = want[i];
      const key = this.#keyOf(e);
      let c = this.cells.get(id);
      if (!c) {
        const slot = this.#takeSlot(keep);
        if (slot == null) break;
        c = { slot, key, state: 'wait', shown: null, at: 0, used: this.time, kind: null, mean: null };
        this.cells.set(id, c);
      }
      c.used = this.time;
      c.key = key;
      // a new picture for a cell that shows an old one: the old one stays until the new one is there; a picture that
      // could not be made is not asked for again until the book changes
      if ((c.state === 'ready' && c.shown !== key) || (c.state === 'fail' && c.failed !== key)) c.state = 'wait';
      if (c.state === 'wait') this.queue.push(id);
    }
  }
  #takeSlot(keep) {
    if (this.free.length) return this.free.pop();
    // the cell of the book least recently wanted (the faces furthest away or no longer open)
    let best = null;
    for (const [id, c] of this.cells) if (!keep.has(id) && c.state !== 'load' && (!best || c.used < best[1].used)) best = [id, c];
    if (!best) return null;
    const [id, c] = best;
    this.cells.delete(id);
    const e = this.entries?.get(id);
    if (e) this.#hide(e);
    this.stats.evicted++;
    return c.slot;
  }

  // ------------------------------------------------------------------ pictures ----
  #alive(j) { return this.cells.get(j.id) === j.c && j.c.key === j.key; }
  /** A picture that came too late for its cell (another one is wanted now): the cell asks again. */
  #drop(j) { if (this.cells.get(j.id) === j.c && j.c.state === 'load') { j.c.state = 'wait'; this.dirty = true; } }
  /** No picture for this cell (not even a title card): the face keeps its binding colour. */
  #fail(j) { this.stats.failed++; if (this.#alive(j)) { j.c.state = 'fail'; j.c.failed = j.key; } }

  #startLoads() {
    while (this.queue.length && this.jobs.size + this.decoding < IN_FLIGHT && this.done.length < READY_MAX) {
      const id = this.queue.shift();
      const c = this.cells.get(id), e = this.entries?.get(id);
      if (!c || !e || c.state !== 'wait') continue;
      c.state = 'load';
      const job = { id, c, key: c.key, book: e.book, aspect: e.d / e.h, kind: 'typo' };
      const url = hasCoverImage(job.book) ? this.opts.coverUrl?.(id) : null;
      if (url) job.kind = 'cover';
      if (this.#post(job, url)) continue;
      if (!url) { this.#paintLater(job); continue; }
      // without the worker: decoded here (off the main thread as well) and trimmed into its cell in idle time
      this.decoding++;
      decodeSmall(url).then((bitmap) => {
        this.decoding--;
        if (!bitmap) { this.stats.failed++; job.kind = 'typo'; }
        if (!this.#alive(job)) { bitmap?.close(); this.#drop(job); return; }
        job.bitmap = bitmap;
        this.#paintLater(job);
      });
    }
  }
  /** The job to the worker: a cover image (url) or the title card. false without a worker. */
  #post(job, url) {
    const worker = this.#worker();
    if (!worker) return false;
    const n = ++this.jobId;
    this.jobs.set(n, job);
    const b = job.book;
    const book = { id: b.id, title: b.title, author: b.author, coverColor: b.coverColor, coverGenerated: b.coverGenerated, coverWeak: b.coverWeak, coverChoice: b.coverChoice, coverSource: b.coverSource, hasCover: b.hasCover };
    worker.postMessage(url ? { type: 'cover', id: n, url, aspect: job.aspect } : { type: 'typo', id: n, book, aspect: job.aspect });
    return true;
  }
  #worker() {
    if (this.worker !== undefined) return this.worker;
    try {
      this.worker = new Worker(new URL('./side-cover-worker.js', import.meta.url), { type: 'module', name: 'side-covers' });
      this.worker.onmessage = (ev) => this.#onCell(ev.data);
      // a worker that cannot start: the books keep their binding colour, title cards still come
      this.worker.onerror = (ev) => { console.warn('[side covers] worker', ev.message || ev); this.#stopWorker(); };
    } catch { this.worker = null; this.stats.worker = false; }
    return this.worker;
  }
  #stopWorker() {
    this.worker?.terminate?.(); this.worker = null; this.stats.worker = false;
    for (const j of this.jobs.values()) this.#drop(j);
    this.jobs.clear();
  }
  #onCell(m) {
    const j = this.jobs.get(m?.id);
    if (!j) return;
    this.jobs.delete(m.id);
    if (!this.#alive(j)) { this.#drop(j); return; }
    if (m.type !== 'cell') {
      // a cover that cannot be loaded gets the title card, like a book without one
      if (j.kind === 'cover') { this.stats.failed++; j.kind = 'typo'; if (!this.#post(j, null)) this.#paintLater(j); }
      else this.#fail(j);
      return;
    }
    j.levels = m.levels; j.mean = m.mean;
    if (j.kind === 'typo') this.stats.cards++;
    this.done.push(j);
  }

  /** Without the worker, the cells are painted here in idle time (a few ms each, a title card up to some 25 ms). */
  #paintLater(job) {
    this.paintQ.push(job);
    this.#kick();
  }
  #kick() {
    if (this.idling || !this.paintQ.length) return;
    this.idling = true;
    idle((d) => this.#runPaint(d));
  }
  #runPaint(deadline) {
    this.idling = false;
    let n = 0;
    while (this.paintQ.length && this.done.length < READY_MAX && (deadline.didTimeout ? n < 1 : deadline.timeRemaining() > 4)) {
      const j = this.paintQ.shift();
      if (!this.#alive(j)) { j.bitmap?.close(); this.#drop(j); continue; }
      const t0 = performance.now();
      if (!this.ctx) this.ctx = Object.assign(document.createElement('canvas'), { width: SIDE_CELL.w, height: SIDE_CELL.h }).getContext('2d', { willReadFrequently: true });
      try {
        if (j.bitmap) Object.assign(j, paintCoverCell(this.ctx, j.bitmap, j.aspect));
        else {
          // the title card in the proportions of the face, scaled into the cell (the shelf shader scales it back)
          const W = 160, H = Math.round(W / j.aspect);
          const card = Object.assign(document.createElement('canvas'), { width: W, height: H });
          drawTypoCover(card.getContext('2d', { willReadFrequently: true }), j.book, W, H);
          Object.assign(j, paintCell(this.ctx, (g, x, y, w, h) => { g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'medium'; g.drawImage(card, x, y, w, h); }));
        }
        this.done.push(j);
      } catch { this.#fail(j); }
      j.bitmap?.close(); j.bitmap = null;
      const ms = performance.now() - t0;
      if (j.kind === 'typo') { this.stats.cards++; this.stats.cardMs += ms; this.stats.cardMax = Math.max(this.stats.cardMax, ms); }
      n++;
    }
    if (this.paintQ.length) this.#kick();
  }

  /** Up to FRAME_CELLS cells a frame onto the graphics card, within FRAME_MS. */
  #pump() {
    if (!this.done.length || !this.atlas) return;
    const t0 = performance.now();
    for (let n = 0; n < FRAME_CELLS && this.done.length && performance.now() - t0 < FRAME_MS;) {
      const j = this.done.shift();
      if (!this.#alive(j)) { this.#drop(j); continue; }
      const c = j.c, a = performance.now();
      let ok = true;
      try { this.#upload(c.slot, j.levels); } catch { ok = false; }
      const ms = performance.now() - a;
      this.stats.uploads++; this.stats.ms += ms; this.stats.max = Math.max(this.stats.max, ms);
      n++;
      if (!ok) { this.stats.failed++; c.state = 'wait'; continue; }
      if (j.kind === 'cover') this.stats.covers++;
      const first = c.shown == null;
      c.state = 'ready'; c.shown = j.key; c.kind = j.kind; c.mean = j.mean;
      if (first) c.at = this.time;      // the first picture fades in, a new one replaces the old at once
      const e = this.entries?.get(j.id);
      if (e) this.#show(e, c);
    }
    if (this.paintQ.length) this.#kick();
  }
  #upload(slot, levels) {
    const r = this.opts.renderer;
    if (!this.levelTex) this.levelTex = levels.map((_, k) => new THREE.DataTexture(null, SIDE_CELL.w >> k, SIDE_CELL.h >> k));
    const x = (slot % SIDE_COLS) * SIDE_CELL.w, y = Math.floor(slot / SIDE_COLS) * SIDE_CELL.h;
    const at = this.at || (this.at = new THREE.Vector2());
    // the rows come top first: the atlas turns them over on the way up (flipY), the picture stands upright in v
    for (let k = 0; k < SIDE_LEVELS; k++) { const t = this.levelTex[k]; t.image.data = levels[k]; r.copyTextureToTexture(t, this.atlas, null, at.set(x >> k, y >> k), 0, k); t.image.data = null; }
  }

  // ------------------------------------------------------------------ the atlas ----
  /** The atlas, as many rows as this build needs (with room to spare); a library that grew gets a larger one. */
  #ensureAtlas() {
    const r = this.opts.renderer;
    if (!r?.copyTextureToTexture || (!this.atlas && !this.open.size)) return;   // (no books, no atlas)
    const need = this.open.size + 24;
    const rows = Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.ceil((need * 1.25) / SIDE_COLS)));
    if (this.atlas && rows <= this.rows) return;
    const H = rows * SIDE_CELL.h;
    const tex = new THREE.FramebufferTexture(ATLAS_W, H);
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;        // every cell brings its own levels (#upload)
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    try {
      r.initTexture(tex);               // storage for all levels, nothing uploaded
      // the levels below a cell's own seven: a quiet tone (only a face of a pixel or two reads them)
      for (let k = SIDE_LEVELS; k < 16; k++) {
        const w = Math.max(1, ATLAS_W >> k), h = Math.max(1, Math.floor(H / 2 ** k));
        r.copyTextureToTexture(new THREE.DataTexture(new Uint8Array(w * h * 4).fill(128), w, h), tex, null, new THREE.Vector2(0, 0), 0, k);
        if (w === 1 && h === 1) break;
      }
    } catch (err) { console.warn('[side covers] no atlas', err); tex.dispose(); return; }
    const old = this.atlas, oldRows = this.rows;
    if (old) {
      // the pictures of the old atlas move over on the graphics card: nothing is made again
      let moved = true;
      try {
        for (let k = 0; k < SIDE_LEVELS; k++) {
          const box = new THREE.Box2(new THREE.Vector2(0, 0), new THREE.Vector2(ATLAS_W >> k, (oldRows * SIDE_CELL.h) >> k));
          r.copyTextureToTexture(old, tex, box, new THREE.Vector2(0, 0), k, k);
        }
      } catch { moved = false; }
      if (!moved) for (const c of this.cells.values()) { c.shown = null; c.state = 'wait'; }
      this.stats.grown++;
    }
    this.atlas = tex; this.rows = rows;
    SIDE_UNIFORMS.uSideAtlas.value = tex;
    SIDE_UNIFORMS.uSideSize.value.set(ATLAS_W, H);
    for (let s = rows * SIDE_COLS - 1; s >= oldRows * SIDE_COLS; s--) this.free.push(s);
    old?.dispose();
  }

  /** The cell's picture on a book's two cover faces (books.js reads aSide: cell, start of the fade, shown). */
  #show(e, c) { this.#write(e, c.slot, c.at, 1); }
  #hide(e) { this.#write(e, 0, 0, 0); }
  #write(e, slot, at, on) {
    const a = e.mesh?.geometry?.attributes?.aSide;
    if (!a) return;
    a.setXYZW(e.index, slot, at, on, 0);
    a.addUpdateRange(e.index * 4, 4);
    a.needsUpdate = true;
  }

  // ------------------------------------------------------------------ for the checks ----
  /** The pictures on (the default) or off: off, every face shows its binding colour and nothing is loaded. */
  setEnabled(on) {
    if (this.off === !on) return;
    this.off = !on;
    this.open.clear();
    if (on) { for (const list of this.rowsOf.values()) this.#openRow(list); this.#ensureAtlas(); }
    for (const [id, c] of this.cells) { const e = this.entries?.get(id); if (e && c.shown != null) { if (on) this.#show(e, c); else this.#hide(e); } }
    this.dirty = true;
  }
  /** Forget every cell (the faces go back to the binding colour, and everything is loaded anew). */
  reset() {
    for (const [id, c] of this.cells) { const e = this.entries?.get(id); if (e) this.#hide(e); this.free.push(c.slot); }
    this.cells.clear(); this.done.length = 0; this.paintQ.length = 0; this.queue.length = 0;
    this.free.sort((a, b) => b - a);
    this.dirty = true;
  }
  /** Where a book's cell lies in the atlas (pixels, level 0, rows counted from the foot of the atlas). */
  cellRect(id) {
    const c = this.cells.get(id);
    if (!c) return null;
    return { x: (c.slot % SIDE_COLS) * SIDE_CELL.w, y: Math.floor(c.slot / SIDE_COLS) * SIDE_CELL.h, w: SIDE_CELL.w, h: SIDE_CELL.h, pad: SIDE_CELL.pad, atlasH: this.rows * SIDE_CELL.h };
  }
  info() {
    let ready = 0, cover = 0, typo = 0, loading = 0, waiting = 0, openReady = 0;
    for (const [id, c] of this.cells) {
      if (c.shown != null) { ready++; if (c.kind === 'cover') cover++; else typo++; if (this.open.has(id)) openReady++; }
      if (c.state === 'load') loading++; else if (c.state === 'wait') waiting++;
    }
    let front = 0, back = 0;
    for (const o of this.open.values()) { if (o.front) front++; if (o.back) back++; }
    return { capacity: this.capacity, rows: this.rows, cells: this.cells.size, ready, cover, typo, loading, waiting, open: this.open.size, openReady, front, back, soon: this.soon.size, queued: this.queue.length, inFlight: this.jobs.size, done: this.done.length, ...this.stats };
  }
  /** Every open face: [{ id, front, back, state, kind, slot, mean, shown (what the cell shows) }]. */
  faces() {
    return [...this.open].map(([id, o]) => { const c = this.cells.get(id); return { id, front: o.front, back: o.back, state: c ? (c.shown != null ? 'ready' : c.state) : null, kind: c?.kind || null, slot: c?.slot ?? null, mean: c?.mean || null, shown: c?.shown || null }; });
  }
}
