// The painted textures of texture-paint.js, kept and painted ahead. Painting them took seconds on the main thread at
// every start (4.6 of the 9 s to the start menu on a desktop, far more on a phone), so:
//   * what was painted is kept in IndexedDB as PNGs (exact: the pictures are opaque) and restored before the world is
//     built; textures.js takes the restored pictures as the materials ask for them (`take`);
//   * at a first start (nothing kept) the standard set is painted by workers in parallel (texture-worker.js) while the
//     main thread loads the library, and the main thread waits for them before the build (`ready`); whatever the
//     workers have not painted (a wall colour of the user's) the main thread paints itself, as before;
//   * everything painted anywhere goes into the store in idle time after the start (`settle`).
// The store is keyed by the hash of texture-paint.js that the build wrote into the bundle: new painters, new pictures.
import { optsOf, PAINTERS } from './texture-paint.js';

const VERSION = typeof COZYSHELVES_TEXTURES !== 'undefined' ? COZYSHELVES_TEXTURES : 'dev';
const DB_NAME = 'lesesaal-textures', STORE = 'images';
// the pictures every build asks for with the default settings (materials.js, furniture.js, floors.js, nature.js), as
// their keys (texture-paint.js keyOf; the list comes from perf-startup's TEXTURES line); a texture the user's settings
// add (a wall colour) is painted on the main thread at a first start and kept then. The rugs are not in it: they are
// drawn with paths, and a worker's canvas (software) edges a path a little differently from the page's (on the
// graphics card), up to 186 steps along the lines of the pattern (texture-pixels); painted on the main thread at a
// first start and kept from there, they stay the rugs they always were.
export const STANDARD = [
  'planks:oak:7:1024:10', 'wood:oak:1:512:1:x:1:0.7', 'wood:oak:3:512:1:y:1:0.6', 'wood:oak:1:512:1:x:1:0.6',
  'wood:ebony:1:512:1:x:1:0.6', 'wood:oak:1:512:1:y:1.7:0.5', 'wood:ash:11:512:1:x:1:0.5',
  'wood:ash:1:512:1:x:1:0.6', 'wood:pine:1:512:1:x:1:0.6', 'wood:ash:1:512:1:y:1.7:0.5', 'wood:oak:1:512:1:y:1:0.6',
  'wood:oak:5:512:1:x:1:0.7', 'wood:walnut:1:512:1:y:1.7:0.5', 'wood:cherry:1:512:1:x:1:0.6',
  'wood:walnut:1:512:1:x:1:0.6', 'wood:oak:2:512:1:x:1.7:0.45', 'wood:oak:1:512:1:x:1:0.5',
  'marble:12:512:#e7e2d8:#b5ada0',
  'marble:12:512:#ece8e1:#c2baae', 'plaster:#f7f3ec:3:512:0.55', 'leather:#a4623b:8:512', 'plaster:#f7f2ea:3:512:0.55', 'leather:#8e9c86:8:512',
  'plaster:#f3eee6:3:512:0.55', 'brick:4:512:white', 'coffer:#f1ede5:512',
  'paint:#efebe3:9:256', 'paint:#a9b6a0:9:256', 'paint:#ddd6ca:9:256', 'paint:#f3efe7:9:256',
  'fabric:#3f6f6d:3:256:1', 'fabric:#6f8f8a:3:256:1', 'fabric:#3f6f6d:20:256:1', 'fabric:#e9dfcf:31:256:1',
  'fabric:#3f6f6d:12:256:1', 'fabric:#b4674a:42:256:1', 'fabric:#c9973f:11:256:1', 'fabric:#b4674a:4:256:1',
  'fabric:#c9b48a:9:256:1', 'fabric:#b4674a:3:256:1', 'fabric:#8fa487:3:256:1', 'fabric:#f0e6d4:20:256:1',
  'fabric:#d4a45c:7:256:1', 'fabric:#b4674a:20:256:1', 'fabric:#e9e2d4:40:256:1', 'fabric:#c9a86a:44:256:1',
  'fabric:#3f6f6d:40:256:1', 'fabric:#c9973f:41:256:1', 'fabric:#3f6f6d:43:256:1', 'fabric:#3f6f6d:9:256:1',
  'fabric:#c9973f:3:256:1', 'paper:256:15',
  // the quick sketches in the frames (ui/paintings.js)
  'sketch:11:mountain-lake', 'sketch:23:lily-pond', 'sketch:37:haystacks', 'sketch:41:sunset-sea',
  'sketch:53:garden-path', 'sketch:67:lavender', 'sketch:71:misty-forest', 'sketch:83:meadow', 'sketch:97:sailboat',
  'sketch:101:winter', 'sketch:113:lighthouse', 'sketch:127:rainy-city', 'sketch:131:lily-pond', 'sketch:139:meadow',
  'sketch:149:mountain-lake',
];

let db = null, dbTried = false;
function open() {
  if (dbTried) return Promise.resolve(db);
  dbTried = true;
  return new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch { resolve(null); return; }
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => { console.warn('[textures] no store:', req.error?.message); resolve(null); };
    req.onblocked = () => resolve(null);
  });
}
function tx(mode, fn) {
  return open().then((d) => {
    if (!d) return undefined;
    return new Promise((resolve, reject) => {
      let t;
      try { t = d.transaction(STORE, mode); } catch (e) { reject(e); return; }
      const os = t.objectStore(STORE);
      let result;
      try { const r = fn(os); if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; }; } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('aborted'));
    });
  });
}

class TextureStore {
  constructor() {
    this.images = new Map();     // key → { name: ImageBitmap } restored from the store or painted by a worker
    this.pending = [];           // [key, { name: canvas | ImageBitmap | Blob }] painted here, to be kept
    this.restored = 0; this.painted = 0; this.kept = 0; this.took = 0;
    this.readyPromise = null;
    this.stats = {};             // (the checks) key → ms the main thread took to paint it
    this.painters = PAINTERS; this.optsOf = optsOf;   // (the checks: a painting made here to compare with)
  }
  /** Begin: restore what is kept, then paint the standard set in workers (only what is not kept). */
  start() {
    if (this.readyPromise) return this.readyPromise;
    const t0 = performance.now();
    this.readyPromise = this.#restore().then(() => this.#prefetch()).catch((e) => { console.warn('[textures] start', e?.message || e); }).then(() => { this.startMs = Math.round(performance.now() - t0); });
    return this.readyPromise;
  }
  /** Resolves when the restored and the prefetched pictures are at hand (the build waits for it). */
  ready() { return this.readyPromise || Promise.resolve(); }
  async #restore() {
    if (typeof indexedDB === 'undefined') return;
    const rows = await tx('readonly', (os) => os.getAll()).catch(() => null);
    if (!rows) return;
    const stale = rows.filter((r) => r.v !== VERSION);
    if (stale.length) { await tx('readwrite', (os) => { for (const r of stale) os.delete(r.k); }).catch(() => {}); }
    const good = rows.filter((r) => r.v === VERSION && r.blob);
    // (turned over: WebGL ignores three's flipY for a bitmap, a canvas is turned over at its upload)
    const bitmaps = await Promise.all(good.map((r) => createImageBitmap(r.blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'flipY' }).catch(() => null)));
    good.forEach((r, i) => { if (!bitmaps[i]) return; let e = this.images.get(r.key); if (!e) this.images.set(r.key, e = {}); e[r.name] = bitmaps[i]; this.restored++; });
  }
  #prefetch() {
    const jobs = STANDARD.map((key) => ({ key, ...optsOf(key) })).filter((j) => j.kind && !this.images.has(j.key));
    if (!jobs.length || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return Promise.resolve();
    const n = Math.max(1, Math.min(4, jobs.length, (navigator.hardwareConcurrency || 4) - 1));
    const workers = [];
    try { for (let i = 0; i < n; i++) workers.push(new Worker(new URL('./texture-worker.js', import.meta.url), { type: 'module', name: 'textures-' + i })); }
    catch (e) { console.warn('[textures] no worker:', e?.message || e); for (const w of workers) w.terminate(); return Promise.resolve(); }
    // the big pictures first, so that no worker ends up with the longest one last
    const queue = jobs.sort((a, b) => (b.opts.size || 512) - (a.opts.size || 512));
    // a worker answers twice per painting: the pictures at once (the build goes on), the PNGs for the store when
    // settle() asks for them (the encoding would take the processor from the shaders' compile meanwhile)
    let left = queue.length, blobsLeft = queue.length, resolved = false;
    const stop = () => { for (const w of workers) w.terminate(); this.workers = null; };
    this.workers = workers;
    return new Promise((resolve) => {
      const done = () => { if (--left <= 0 && !resolved) { resolved = true; resolve(); } };
      const stored = () => { if (--blobsLeft <= 0) { stop(); if (this.settled) this.settle().catch(() => {}); } };   // (PNGs that came after the first settle)
      const feed = (w) => { const j = queue.shift(); if (!j) return; w.postMessage(j); w.__job = j; };
      for (const w of workers) {
        w.onmessage = (e) => {
          const { key, images, blobs, error } = e.data;
          if (images) { this.images.set(key, images); this.painted++; done(); feed(w); }
          else if (blobs) { this.pending.push([key, blobs]); stored(); }
          else if (error) { console.warn('[textures] worker:', error); done(); stored(); feed(w); }
        };
        w.onerror = (e) => { console.warn('[textures] worker failed:', e?.message || e); if (w.__job) { done(); stored(); } w.__job = null; while (queue.length) { queue.shift(); done(); stored(); } };
        feed(w);
      }
      // a worker that never answers (a browser without canvases in workers) must not hold the start, nor stay
      setTimeout(() => { if (!resolved) { resolved = true; resolve(); } }, 45000);
      setTimeout(() => { if (blobsLeft > 0) { blobsLeft = 0; stop(); } }, 180000);
    });
  }
  /** The pictures kept or painted ahead for this key, once: textures.js takes them for its textures. */
  take(key) {
    const e = this.images.get(key);
    if (!e) return null;
    this.images.delete(key); this.took++;
    return e;
  }
  /** Pictures the main thread painted: kept in idle time (settle). */
  remember(key, images) { this.pending.push([key, images]); }
  /** After the start: the pending pictures into the store (PNGs encoded off the main thread), the restored pictures
   *  nobody asked for released. */
  async settle() {
    this.settled = true;
    // the PNGs of what the workers painted (they kept the canvases for this)
    if (this.workers && !this.encodeAsked) { this.encodeAsked = true; for (const w of this.workers) w.postMessage({ encode: true }); }
    for (const e of this.images.values()) for (const b of Object.values(e)) b.close?.();
    this.images.clear();
    if (typeof indexedDB === 'undefined' || !(await open())) { this.pending.length = 0; return; }
    const idle = () => new Promise((r) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 2000 }) : setTimeout(r, 50)));
    while (this.pending.length) {
      const [key, images] = this.pending.shift();
      await idle();
      const rows = [];
      for (const [name, img] of Object.entries(images)) {
        const blob = await toBlob(img).catch(() => null);
        if (blob) rows.push({ k: `${key}\u0001${name}`, v: VERSION, key, name, blob });
      }
      if (rows.length) await tx('readwrite', (os) => { for (const r of rows) os.put(r, r.k); }).then(() => { this.kept += rows.length; }).catch((e) => console.warn('[textures] keep', e?.message || e));
    }
  }
  /** (the checks) */
  info() { return { version: VERSION, restored: this.restored, painted: this.painted, took: this.took, kept: this.kept, pending: this.pending.length, startMs: this.startMs ?? null, stats: this.stats }; }
}
function toBlob(img) {
  if (img instanceof Blob) return Promise.resolve(img);
  if (typeof OffscreenCanvas !== 'undefined' && img instanceof OffscreenCanvas) return img.convertToBlob({ type: 'image/png' });
  if (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) return new Promise((res, rej) => img.toBlob((b) => (b ? res(b) : rej(new Error('no blob'))), 'image/png'));
  return Promise.reject(new Error('not a picture'));
}

export const textureStore = new TextureStore();
