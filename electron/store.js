// Tiny JSON document store with debounced atomic writes.
const fs = require('fs');
const path = require('path');

const DEBOUNCE_MS = 400;
const MAX_WAIT_MS = 2500; // never postpone a write longer than this, however busy we are

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Fill in missing keys from `defaults` recursively (arrays are taken from `parsed` wholesale). */
function deepDefaults(defaults, parsed) {
  if (!isPlainObject(defaults)) return parsed === undefined ? structuredClone(defaults) : parsed;
  if (!isPlainObject(parsed)) return structuredClone(defaults);
  const out = { ...parsed };
  for (const [k, v] of Object.entries(defaults)) {
    if (isPlainObject(v)) out[k] = deepDefaults(v, parsed[k]);
    else if (out[k] === undefined) out[k] = structuredClone(v);
  }
  return out;
}

class Store {
  static seq = 0;
  constructor(file, defaults = {}) {
    this.file = file;
    this.defaults = defaults;
    this.data = this.#load();
    this.timer = null;
    this.firstDirtyAt = 0;
    this.listeners = new Set();
  }
  #load() {
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        return deepDefaults(this.defaults, parsed);
      }
    } catch (e) {
      console.error('[store] failed to read', this.file, e.message);
      try { fs.copyFileSync(this.file, this.file + '.corrupt-' + Date.now()); } catch {}
    }
    return structuredClone(this.defaults);
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
    if (now - this.firstDirtyAt >= MAX_WAIT_MS) { this.flush(); return; }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS);
  }
  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    this.firstDirtyAt = 0;
    // every write gets its own temporary file: two writers (a second app instance, a flush during quit)
    // used to share "<file>.tmp", and the second rename then failed with ENOENT
    const tmp = `${this.file}.${process.pid}-${++Store.seq}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const fd = fs.openSync(tmp, 'w');
      try {
        fs.writeFileSync(fd, JSON.stringify(this.data));
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[store] failed to write', this.file, e.message);
      try { fs.unlinkSync(tmp); } catch {}
    }
  }
}

module.exports = { Store, deepDefaults };
