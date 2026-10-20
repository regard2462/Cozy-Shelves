// NASA: the videos of the NASA Image and Video Library (images-api.nasa.gov, open API without a key). NASA material
// is generally not subject to copyright in the United States. A search result names the video; its files (MP4 in up
// to four sizes, often English captions as WebVTT) come from the collection of the asset when it is opened.
'use strict';
const { createRequester, plain, makeItem, page, byDate, https } = require('./common');

const API = 'https://images-api.nasa.gov';
const ASSETS = 'https://images-assets.nasa.gov';
const LIST_TTL = 30 * 60e3, ASSET_TTL = 6 * 3600e3;
const HOSTS = ['images-assets.nasa.gov'];
const IMAGE_HOSTS = ['images-assets.nasa.gov'];
const TOPICS = [
  { id: 'recent', title: { de: 'Neueste Videos', en: 'Latest videos' } },
  { id: 'popular', title: { de: 'Beliebt', en: 'Popular' } },
  { id: 'q:Artemis', title: { de: 'Artemis', en: 'Artemis' } },
  { id: 'q:Apollo', title: { de: 'Apollo', en: 'Apollo' } },
  { id: 'q:International Space Station', title: { de: 'Internationale Raumstation', en: 'International Space Station' } },
  { id: 'q:Mars', title: { de: 'Mars', en: 'Mars' } },
  { id: 'q:Hubble', title: { de: 'Hubble', en: 'Hubble' } },
  { id: 'q:Webb', title: { de: 'James Webb', en: 'James Webb' } },
  { id: 'q:Earth', title: { de: 'Erde', en: 'Earth' } },
  { id: 'q:Sun', title: { de: 'Sonne', en: 'Sun' } },
];

/** The NASA centres the API names by their abbreviation. */
const CENTERS = { HQ: 'NASA Headquarters', JSC: 'Johnson Space Center', KSC: 'Kennedy Space Center', JPL: 'Jet Propulsion Laboratory', GSFC: 'Goddard Space Flight Center',
  MSFC: 'Marshall Space Flight Center', ARC: 'Ames Research Center', LARC: 'Langley Research Center', AFRC: 'Armstrong Flight Research Center', GRC: 'Glenn Research Center', SSC: 'Stennis Space Center' };

/** A collection item of the API → item (lazy: the files come from the asset's collection.json). */
function fromItem(c) {
  const d = c && c.data && c.data[0];
  if (!d || d.media_type !== 'video' || !d.nasa_id) return null;
  const links = c.links || [];
  const img = links.find((l) => l.rel === 'preview') || links.find((l) => /~thumb\.jpg$/.test(l.href || '')) || links.find((l) => l.render === 'image');
  return makeItem({
    id: 'nasa:' + d.nasa_id, source: 'nasa', channel: 'NASA', topic: (d.keywords && d.keywords[0]) || CENTERS[String(d.center || '').toUpperCase()] || d.center || '',
    title: plain(d.title), description: plain(d.description || d.description_508 || ''), timestamp: Date.parse(d.date_created) || 0,
    image: img ? https(img.href) : null, website: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}`,
    lazy: true, ref: d.nasa_id, collection: https(c.href),
  });
}

/** The files of an asset → { video: { <key>: url }, subtitle }; '~orig' only when nothing else exists. */
function filesOf(urls) {
  const list = (urls || []).map((u) => { try { return new URL(https(String(u))).href; } catch { return null; } }).filter(Boolean);
  const named = (n) => list.find((u) => new RegExp(`~${n}\\.mp4$`, 'i').test(u));
  const video = {};
  for (const n of ['large', 'medium', 'small', 'mobile']) { const u = named(n); if (u) video[n] = u; }
  if (!Object.keys(video).length) { const o = named('orig'); if (o) video.orig = o; }
  const subtitle = list.find((u) => /\.vtt$/i.test(u)) || list.find((u) => /\.srt$/i.test(u)) || null;
  return { video, subtitle };
}

function createNasa({ fetch, heights = null, now = Date.now } = {}) {
  const req = createRequester({ fetch, name: 'NASA', now });
  const year = () => new Date(now()).getUTCFullYear();

  async function search(params, { offset = 0, size = 40 } = {}) {
    const n = Math.max(1, Math.min(100, size));
    const p = Math.floor(offset / n) + 1;
    const qs = new URLSearchParams({ media_type: 'video', page: String(p), page_size: String(n), ...params });
    const j = await req.memo('s:' + qs, LIST_TTL, () => req.get(`${API}/search?${qs}`, { json: true }));
    const items = ((j && j.collection && j.collection.items) || []).map(fromItem).filter(Boolean);
    const total = (j && j.collection && j.collection.metadata && j.collection.metadata.total_hits) || items.length;
    return { items, total, totalRelation: 'eq', offset, size: n, hasMore: p * n < total, received: items.length };
  }

  async function list({ topic, text, offset = 0, size = 40 } = {}) {
    if (text) return search({ q: String(text) }, { offset, size });
    if (topic === 'popular') {
      const j = await req.memo('popular', LIST_TTL, () => req.get(`${ASSETS}/popular.json`, { json: true }));
      return page(((j && j.collection && j.collection.items) || []).map(fromItem).filter(Boolean), { offset, size });
    }
    if (topic && topic.startsWith('q:')) return search({ q: topic.slice(2) }, { offset, size });
    // the newest videos: this year's (and last year's early in January), newest first
    const r = await search({ year_start: String(year() - (new Date(now()).getUTCMonth() === 0 ? 1 : 0)) }, { offset, size: Math.max(size, 100) });
    const items = byDate(r.items).filter((it) => it.timestamp <= now() + 864e5);
    return { ...r, items: items.slice(0, size), received: r.received };
  }

  async function resolve(item) {
    const id = item.ref || String(item.id || '').replace(/^nasa:/, '');
    const coll = item.collection || `${ASSETS}/video/${encodeURIComponent(id)}/collection.json`;
    const urls = await req.memo('c:' + coll, ASSET_TTL, () => req.get(new URL(coll).href, { json: true }));
    const { video, subtitle } = filesOf(urls);
    if (!Object.keys(video).length) throw new Error('Zu diesem NASA-Video gibt es keine abspielbare Datei.');
    const out = { ...item, video, subtitle: item.subtitle || subtitle, lazy: false };
    if (heights) {
      const hs = await heights.ofItem({ video }).catch(() => ({}));
      if (Object.keys(hs).length) out.heights = hs;
      // two files of the same size: the smaller name stays (the bigger one is the master upload)
      const seen = new Map();
      for (const k of ['large', 'medium', 'small', 'mobile', 'orig']) {
        if (!out.heights || !out.heights[k]) continue;
        const p = out.heights[k].p;
        if (seen.has(p)) { delete out.video[seen.get(p)]; delete out.heights[seen.get(p)]; }
        seen.set(p, k);
      }
      // the API names no length, the file header does
      if (!out.duration && out.heights) out.duration = Math.max(0, ...Object.values(out.heights).map((h) => h.duration || 0));
    }
    return out;
  }

  return { id: 'nasa', channel: 'NASA', hosts: HOSTS, imageHosts: IMAGE_HOSTS, search: true, topics: async () => TOPICS, list, resolve };
}

module.exports = { createNasa, fromItem, filesOf, TOPICS };
