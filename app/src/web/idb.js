// A small IndexedDB layer for the browser version: one database "lesesaal-web" with
//   kv       documents by key (settings, library, stats, history, the chosen folders)
//   covers   the cover of a book as a Blob (JPEG), by book id; '<id>.book' keeps the book's own picture
//   text     the text sample of a book (a string), by book id
//   handles  FileSystemDirectoryHandle objects, by folder id (Chromium keeps them across reloads)
//   paintings the watercolours painted at the easel, by name
// Every call opens the database once and keeps it; a browser that blocks IndexedDB (a private window with
// storage switched off) makes every read answer undefined and every write a no-op, the app then runs without memory.
const DB_NAME = 'lesesaal-web';
const DB_VERSION = 1;
const STORES = ['kv', 'covers', 'text', 'handles', 'paintings'];

let dbPromise = null;
function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { resolve(null); return; }
    req.onupgradeneeded = () => { const db = req.result; for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s); };
    req.onsuccess = () => { const db = req.result; db.onversionchange = () => { try { db.close(); } catch {} dbPromise = null; }; resolve(db); };
    req.onerror = () => { console.warn('[idb] open failed', req.error?.message); resolve(null); };
    req.onblocked = () => console.warn('[idb] open blocked by another tab');
  });
  return dbPromise;
}

function run(store, mode, fn) {
  return open().then((db) => {
    if (!db) return undefined;
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(store, mode); } catch (e) { reject(e); return; }
      const os = tx.objectStore(store);
      let result;
      try { const r = fn(os); if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; }; else result = r; } catch (e) { reject(e); return; }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
    });
  });
}

export const idb = {
  get: (store, key) => run(store, 'readonly', (os) => os.get(key)).catch(() => undefined),
  getAll: (store) => run(store, 'readonly', (os) => os.getAll()).catch(() => []),
  keys: (store) => run(store, 'readonly', (os) => os.getAllKeys()).catch(() => []),
  put: (store, key, value) => run(store, 'readwrite', (os) => os.put(value, key)).then(() => true).catch((e) => { console.warn('[idb] put failed', store, key, e?.message || e); return false; }),
  del: (store, key) => run(store, 'readwrite', (os) => os.delete(key)).then(() => true).catch(() => false),
  clear: (store) => run(store, 'readwrite', (os) => os.clear()).then(() => true).catch(() => false),
  /** Several writes in one transaction: [[key, value], …]; a value of undefined deletes the key. */
  putMany: (store, pairs) => run(store, 'readwrite', (os) => { for (const [k, v] of pairs) { if (v === undefined) os.delete(k); else os.put(v, k); } return true; }).then(() => true).catch((e) => { console.warn('[idb] putMany failed', store, e?.message || e); return false; }),
  available: () => open().then((db) => !!db),
};

/**
 * A JSON document in the kv store with debounced writes, after electron/store.js: get(key) / set(key, value) /
 * save() / flush(). `defaults` fills in missing keys (deepDefaults, so new settings arrive in old documents).
 */
export class WebStore {
  static DEBOUNCE_MS = 400;
  static MAX_WAIT_MS = 2500;
  constructor(name, defaults = {}) {
    this.name = name;
    this.defaults = defaults;
    this.data = structuredClone(defaults);
    this.timer = null;
    this.firstDirtyAt = 0;
    this.listeners = new Set();
    this.loaded = false;
    this.writing = Promise.resolve();
  }
  /** Reads the document (once); later calls answer at once. */
  async load() {
    if (this.loaded) return this.data;
    const parsed = await idb.get('kv', this.name);
    this.data = deepDefaults(this.defaults, parsed && typeof parsed === 'object' ? parsed : undefined);
    this.loaded = true;
    return this.data;
  }
  get(key) { return key ? this.data[key] : this.data; }
  set(key, value) {
    if (typeof key === 'object') Object.assign(this.data, key);
    else this.data[key] = value;
    this.save();
    for (const l of this.listeners) l(this.data);
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  save() {
    const now = Date.now();
    if (!this.firstDirtyAt) this.firstDirtyAt = now;
    if (now - this.firstDirtyAt >= WebStore.MAX_WAIT_MS) { this.flush(); return; }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), WebStore.DEBOUNCE_MS);
  }
  /** Writes now; the returned promise settles when IndexedDB has it (tests wait for it before a reload). */
  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    this.firstDirtyAt = 0;
    // structuredClone: the document must not change while the transaction serializes it
    const snapshot = structuredClone(this.data);
    this.writing = this.writing.then(() => idb.put('kv', this.name, snapshot));
    return this.writing;
  }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Fill in missing keys from `defaults` recursively (arrays are taken from `parsed` wholesale), as electron/store.js. */
export function deepDefaults(defaults, parsed) {
  if (!isPlainObject(defaults)) return parsed === undefined ? structuredClone(defaults) : parsed;
  if (!isPlainObject(parsed)) return structuredClone(defaults);
  const out = { ...parsed };
  for (const [k, v] of Object.entries(defaults)) {
    if (isPlainObject(v)) out[k] = deepDefaults(v, parsed[k]);
    else if (out[k] === undefined) out[k] = structuredClone(v);
  }
  return out;
}
