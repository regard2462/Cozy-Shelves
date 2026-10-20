// Internet Archive: public-domain films from the Moving Image Archive (archive.org, advancedsearch and metadata API).
// The Prelinger Archives (educational and industrial films, public domain by the collection's terms) and the
// collections of feature films, silent films, film noir, science fiction, comedies, classic TV and cartoons, there only
// items the archive marks as public domain. A search result names the film; its MP4 derivatives (with their sizes)
// and subtitles come from the metadata of the item when it is opened. Adult titles are left out.
'use strict';
const { createRequester, plain, makeItem, parseDuration } = require('./common');

const SEARCH = 'https://archive.org/advancedsearch.php';
const META = 'https://archive.org/metadata/';
const LIST_TTL = 30 * 60e3, META_TTL = 6 * 3600e3;
const HOSTS = ['archive.org'];
const IMAGE_HOSTS = ['archive.org'];
const COLLECTIONS = [
  { id: 'prelinger', title: { de: 'Prelinger Archives', en: 'Prelinger Archives' }, sub: { de: 'Lehr-, Werbe- und Industriefilme 1903 bis 1980', en: 'Educational, advertising and industrial films, 1903 to 1980' }, pd: false },
  { id: 'feature_films', title: { de: 'Spielfilme', en: 'Feature films' }, pd: true },
  { id: 'silent_films', title: { de: 'Stummfilme', en: 'Silent films' }, pd: true },
  { id: 'Film_Noir', title: { de: 'Film noir', en: 'Film noir' }, pd: true },
  { id: 'SciFi_Horror', title: { de: 'Science-Fiction und Horror', en: 'Science fiction and horror' }, pd: true },
  { id: 'Comedy_Films', title: { de: 'Komödien', en: 'Comedies' }, pd: true },
  { id: 'classic_tv', title: { de: 'Fernsehklassiker', en: 'Classic TV' }, pd: true },
  { id: 'animationandcartoons', title: { de: 'Zeichentrick', en: 'Animation and cartoons' }, pd: true },
];
// no 'collection': items list hundreds of favourite lists there (several kB per film); the topic names the collection
const FIELDS = ['identifier', 'title', 'description', 'date', 'year', 'runtime', 'creator'];
const ADULT = /\b(sex|sexy|nud(e|es|ist|ists|ity)|erotic|porn\w*|xxx|strip(per|tease)|burlesque|nympho\w*|lust)\b/i;

/** The Lucene query for a collection (or all of them) and a search text. */
function queryFor(topic, text) {
  const coll = COLLECTIONS.find((c) => c.id === topic);
  const one = (c) => (c.pd ? `(collection:(${c.id}) AND licenseurl:*publicdomain*)` : `collection:(${c.id})`);
  let q = `(${coll ? one(coll) : COLLECTIONS.map(one).join(' OR ')}) AND mediatype:(movies)`;
  const words = String(text || '').replace(/[^\p{L}\p{N}\s'-]+/gu, ' ').trim();
  if (words) q += ` AND (${words.split(/\s+/).map((w) => `(title:(${w}) OR description:(${w}) OR subject:(${w}))`).join(' AND ')})`;
  return q;
}

const yearOf = (d) => { const m = /^(\d{4})/.exec(String((d && (d.date || d.year)) || '')); return m ? +m[1] : null; };
const first = (v) => (Array.isArray(v) ? v[0] : v);

function fromDoc(d, topic = null) {
  if (!d || !d.identifier) return null;
  const title = plain(first(d.title)) || d.identifier;
  if (ADULT.test(title) || ADULT.test(plain(first(d.description)).slice(0, 400))) return null;
  const coll = COLLECTIONS.find((x) => x.id === topic) || [].concat(d.collection || []).map((c) => COLLECTIONS.find((x) => x.id === c)).find(Boolean);
  const year = yearOf(d);
  return makeItem({
    id: 'ia:' + d.identifier, source: 'archive', channel: 'IA', topic: coll ? coll.title.en : 'Internet Archive', title,
    description: plain(first(d.description)).slice(0, 4000), timestamp: year ? Date.UTC(year, 0, 1) : 0, year,
    duration: parseDuration(first(d.runtime)), image: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`,
    website: `https://archive.org/details/${encodeURIComponent(d.identifier)}`, lazy: true, ref: d.identifier, collectionId: coll ? coll.id : null,
  });
}

/** The playable files of an item: H.264 MP4 derivatives by size, the biggest per size, plus subtitles. */
function filesOf(meta, id) {
  const files = (meta && meta.files) || [];
  const url = (name) => `https://archive.org/download/${encodeURIComponent(id)}/${String(name).split('/').map(encodeURIComponent).join('/')}`;
  const video = {}, heights = {};
  let length = 0;
  for (const f of files) {
    if (!/\.mp4$/i.test(f.name || '') || !/h\.264|mpeg4/i.test(f.format || '') || /hires/i.test(f.format || '')) continue;
    if (f.source !== 'derivative' && !/^h\.264/i.test(f.format || '')) continue;
    const h = parseInt(f.height, 10), w = parseInt(f.width, 10);
    if (!h) continue;
    const key = 'h' + h;
    if (video[key] && (Number(f.size) || 0) <= (Number(heights[key].size) || 0)) continue;
    video[key] = url(f.name);
    heights[key] = { width: w || 0, height: h, size: Number(f.size) || null };
    length = Math.max(length, parseFloat(f.length) || 0);
  }
  const sub = files.find((f) => /\.vtt$/i.test(f.name || '')) || files.find((f) => /\.srt$/i.test(f.name || '') && /en|eng|english|asr/i.test(f.name)) || files.find((f) => /\.srt$/i.test(f.name || ''));
  return { video, heights, subtitle: sub ? url(sub.name) : null, duration: Math.round(length) };
}

function createArchive({ fetch, now = Date.now } = {}) {
  const req = createRequester({ fetch, name: 'Internet Archive', now });

  async function list({ topic, text, sort, offset = 0, size = 40 } = {}) {
    const rows = Math.max(1, Math.min(100, size));
    const pageNo = Math.floor(offset / rows) + 1;
    const order = text && (!sort || sort === 'relevance') ? null : sort === 'new' ? 'publicdate desc' : sort === 'old' ? 'date asc' : 'downloads desc';
    const qs = new URLSearchParams({ q: queryFor(topic, text), rows: String(rows), page: String(pageNo), output: 'json' });
    for (const f of FIELDS) qs.append('fl[]', f);
    if (order) qs.append('sort[]', order);
    const j = await req.memo('s:' + qs, LIST_TTL, () => req.get(`${SEARCH}?${qs}`, { json: true }));
    const docs = (j && j.response && j.response.docs) || [];
    const items = docs.map((d) => fromDoc(d, topic)).filter(Boolean);
    const total = (j && j.response && j.response.numFound) || items.length;
    return { items, total, totalRelation: 'eq', offset, size: rows, hasMore: pageNo * rows < total, received: docs.length };
  }

  async function resolve(item) {
    const id = item.ref || String(item.id || '').replace(/^ia:/, '');
    const meta = await req.memo('m:' + id, META_TTL, () => req.get(META + encodeURIComponent(id), { json: true }));
    const f = filesOf(meta, id);
    if (!Object.keys(f.video).length) throw new Error('Zu diesem Film gibt es im Internet Archive keine abspielbare Datei.');
    const base = item.title ? item : fromDoc({ identifier: id, ...(meta && meta.metadata) }) || item;
    return { ...base, video: f.video, heights: f.heights, subtitle: f.subtitle, duration: f.duration || base.duration, lazy: false };
  }

  const topics = async () => COLLECTIONS.map((c) => ({ id: c.id, title: c.title, sub: c.sub || null }));
  return { id: 'archive', channel: 'IA', hosts: HOSTS, imageHosts: IMAGE_HOSTS, search: true, topics, list, resolve };
}

module.exports = { createArchive, fromDoc, filesOf, queryFor, COLLECTIONS };
