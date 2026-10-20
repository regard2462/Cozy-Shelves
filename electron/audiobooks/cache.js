// The tag cache of the audiobook scanner (<userData>/audiobook-tags.json): file → { s: size, m: mtime, t: tags }.
// A file is read again only when its size or modification time changed, or when the tag reader changed (VERSION).
// Written explicitly (flush) and atomically, not after every entry: a first scan of a large collection adds thousands.
const fs = require('fs');
const path = require('path');

const VERSION = 1;   // raise when tags.js reads something new, so that cached results are read again

/** The tags without their empty fields (the cache stays small). */
function compact(meta) {
  const o = {};
  for (const [k, v] of Object.entries(meta || {})) {
    if (v == null || v === false || k === 'reads' || k === 'bytes' || (Array.isArray(v) && !v.length)) continue;
    o[k] = v;
  }
  return o;
}

class TagCache {
  constructor(file) {
    this.file = file; this.map = new Map(); this.dirty = false;
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (j && j.v === VERSION && j.files && typeof j.files === 'object') for (const [k, e] of Object.entries(j.files)) this.map.set(k, e);
    } catch { /* no cache yet, or a broken one: it is rebuilt */ }
  }
  key(p) { const n = path.normalize(String(p)); return process.platform === 'win32' ? n.toLowerCase() : n; }
  /** The cached tags when the file is unchanged, else null. */
  get(p, size, mtime) {
    const e = this.map.get(this.key(p));
    return e && e.s === size && e.m === mtime ? { chapters: [], ...e.t } : null;
  }
  set(p, size, mtime, meta) { this.map.set(this.key(p), { s: size, m: mtime, t: compact(meta) }); this.dirty = true; }
  /** Change the cached tags of an unchanged file (the duration the player measured). */
  patch(p, fields) {
    const e = this.map.get(this.key(p)); if (!e) return false;
    e.t = compact({ ...e.t, ...fields }); this.dirty = true; return true;
  }
  /** Forget the files that are gone: `seen` holds the files of the folders that could be read, `keepUnder` the
   *  folders that could not (their entries stay for when the drive is back). */
  prune(seen, keepUnder = []) {
    const keep = new Set([...seen].map((p) => this.key(p)));
    const roots = keepUnder.map((r) => this.key(r) + path.sep);
    for (const k of [...this.map.keys()]) if (!keep.has(k) && !roots.some((r) => k.startsWith(r))) { this.map.delete(k); this.dirty = true; }
  }
  get size() { return this.map.size; }
  flush() {
    if (!this.dirty) return;
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify({ v: VERSION, files: Object.fromEntries(this.map) }));
      fs.renameSync(tmp, this.file);
      this.dirty = false;
    } catch (e) { console.error('[audiobooks] tag cache not written', e.message); try { fs.unlinkSync(tmp); } catch {} }
  }
}

module.exports = { TagCache, compact, VERSION };
