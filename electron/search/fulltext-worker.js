// The index worker: a thread of the main process that owns the SQLite file of the full-text index (fulltext-db.js),
// so that storing pages and answering queries never blocks the main process (protocols, IPC, the windows).
// Messages { id, op, args } are answered with { id, ok, result } or { id, ok: false, error }, one at a time.
'use strict';
const { parentPort, workerData } = require('worker_threads');
const { FulltextDB } = require('./fulltext-db');
const { parseQuery } = require('./textnorm');

let db = null;
// the last parsed query: the panel asks for the same one several times (match, then the hits of each book)
let lastText = null, lastQuery = null;
const parsed = (text) => { if (text !== lastText) { lastText = text; lastQuery = parseQuery(text); } return lastQuery; };

const ops = {
  open() { db = new FulltextDB(workerData.file).open(); return { books: db.list(), size: db.size() }; },
  list: () => db.list(),
  begin: (id, key, kind, opts) => db.begin(id, key, kind, opts),
  add: (id, units, next) => db.add(id, units, next),
  finish: (id, info) => db.finish(id, info),
  remove(ids) { let n = 0; for (const id of ids) if (db.remove(id)) n++; return n; },
  rekey: (from, to) => db.rekey(from, to),
  clear() { db.clear(); return { books: [], size: db.size() }; },
  match: (text) => db.match(parsed(text)),
  /** [{ id, offset, count }] → [{ id, total, hits: [{ u, snippet, s, o, len, page, pos, chapter }] }] */
  hits(text, wanted, width) {
    const q = parsed(text);
    return wanted.map(({ id, offset = 0, count = 3 }) => {
      const units = db.unitsOf(q, id);
      return { id, total: units.length, hits: db.snippets(q, id, units.slice(offset, offset + count), width) };
    });
  },
  unitText: (id, u) => db.unitText(id, u),
  size: () => db.size(),
  optimize: () => db.optimize(),
  merge: (pages) => db.merge(pages),
  compact: () => db.compact(),
  close() { db?.close(); db = null; return true; },
};

parentPort.on('message', ({ id, op, args }) => {
  let reply;
  try {
    if (!db && op !== 'open') throw new Error('index not open');
    reply = { id, ok: true, result: ops[op](...(args || [])) };
  } catch (e) { reply = { id, ok: false, error: String(e?.message || e) }; }
  parentPort.postMessage(reply);
});
