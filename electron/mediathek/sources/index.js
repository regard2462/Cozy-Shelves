// The English-language sources of the Mediathek (0.7): DW, NHK WORLD-JAPAN, NASA, the Internet Archive and TED,
// each a module with list(opts), resolve(item) and topics(). The panel asks them through mediathek:query with
// { source } (one source) or { sources: [...] } (a search over several, merged with a cursor per source).
// Every source names the hosts its films and pictures come from; only these reach the proxy allowlist.
'use strict';
const { createDw } = require('./dw');
const { createNhk } = require('./nhk');
const { createNasa } = require('./nasa');
const { createArchive } = require('./archive');
const { createTed } = require('./ted');

const FACTORIES = [createDw, createNhk, createNasa, createArchive, createTed];

const hostOf = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.hostname.toLowerCase() : null; } catch { return null; } };

/** Interleave lists (one per source) so that every source shows up near the top: a, b, c, a, b, c … */
function interleave(lists) {
  const out = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}
const SORTS = {
  new: (a, b) => (b.timestamp || 0) - (a.timestamp || 0),
  old: (a, b) => (a.timestamp || 0) - (b.timestamp || 0),
  long: (a, b) => (b.duration || 0) - (a.duration || 0),
  short: (a, b) => (a.duration || 0) - (b.duration || 0),
};

/**
 * deps: { fetch, heights (heights.js createHeights), extra: [{ id, channel, list(opts) }] (e.g. arte in English via
 * MediathekViewWeb), now }
 */
function createSources({ fetch, heights = null, extra = [], now = Date.now } = {}) {
  const list = FACTORIES.map((f) => f({ fetch, heights, now }));
  const all = [...list, ...extra];
  const byId = new Map(all.map((s) => [s.id, s]));
  const byChannel = new Map(all.map((s) => [s.channel, s]));
  const mediaHosts = new Set(list.flatMap((s) => s.hosts || []));
  const imageHosts = new Set(list.flatMap((s) => s.imageHosts || []));

  /** One source: its list, topic or search. */
  async function query1(opts) {
    const s = byId.get(opts.source) || byChannel.get(opts.source);
    if (!s) throw new Error('Unbekannte Quelle: ' + opts.source);
    return s.list(opts);
  }

  /**
   * Several sources at once (the English search): `cursor` = { [sourceId]: offset } of the next page (absent on the
   * first). Every source gives about size / n items per page; the merged page follows `sort` ('relevance' interleaves).
   */
  async function queryMany(opts) {
    const ids = (opts.sources || []).filter((id) => byId.has(id));
    const cursor = opts.cursor && typeof opts.cursor === 'object' ? opts.cursor : {};
    const per = Math.max(6, Math.ceil((opts.size || 40) / Math.max(1, ids.length)));
    const active = ids.filter((id) => cursor[id] !== null);
    const results = await Promise.all(active.map(async (id) => {
      try { return { id, r: await byId.get(id).list({ ...opts, source: id, sources: undefined, offset: cursor[id] || 0, size: per }) }; }
      catch (e) { return { id, error: e }; }
    }));
    const ok = results.filter((x) => x.r);
    if (!ok.length && results.length) throw results[0].error;
    const next = { ...cursor };
    for (const x of results) next[x.id] = x.r && x.r.hasMore ? (cursor[x.id] || 0) + (x.r.received || x.r.items.length) : null;
    const dmin = opts.durationMin || 0, dmax = opts.durationMax || 0;
    const fits = (it) => (!dmin || !it.duration || it.duration >= dmin) && (!dmax || !it.duration || it.duration <= dmax);
    const lists = ok.map((x) => x.r.items.filter(fits));
    const merged = SORTS[opts.sort] ? lists.flat().sort(SORTS[opts.sort]) : interleave(lists);
    const total = ok.reduce((n, x) => n + (x.r.total || 0), 0);
    return { items: merged, total, totalRelation: 'eq', offset: 0, size: merged.length, hasMore: Object.values(next).some((v) => v != null), received: merged.length, cursor: next, failed: results.filter((x) => x.error).map((x) => x.id) };
  }

  async function resolve(item) {
    const s = item && byId.get(item.source);
    if (!s || !s.resolve) return item;
    return s.resolve(item);
  }

  return {
    all: list,
    get: (id) => byId.get(id) || byChannel.get(id) || null,
    query: (opts) => (Array.isArray(opts.sources) ? queryMany(opts) : query1(opts)),
    resolve,
    topics: async (id) => { const s = byId.get(id) || byChannel.get(id); return s && s.topics ? s.topics() : []; },
    /** Media hosts of the sources (the allowlist takes item hosts only from these). */
    isMediaHost: (u) => { const h = hostOf(u); return !!h && mediaHosts.has(h); },
    isImageHost: (u) => { const h = hostOf(u); return !!h && imageHosts.has(h); },
    mediaHosts, imageHosts,
  };
}

module.exports = { createSources, interleave, hostOf };
