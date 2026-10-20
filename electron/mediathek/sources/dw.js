// DW (Deutsche Welle) in English: the video list of the DW media centre (api.dw.com, the API of the DW apps, no key).
// A list page has 30 teasers, newest first; the detail of a video names its MP4 files in six sizes (1080p to 270p)
// and an HLS master. The API has no search: a search looks through the newest 150 videos.
'use strict';
const { createRequester, plain, makeItem, page, matches, byDate } = require('./common');

const API = 'https://api.dw.com/api';
const LANGUAGE = 2;                 // 2 = English
const PAGE = 30;
const LIST_TTL = 10 * 60e3, DETAIL_TTL = 60 * 60e3;
const SEARCH_PAGES = 5;
const HOSTS = ['tvdownloaddw-a.akamaihd.net', 'hlsvod.dw.com'];
const IMAGE_HOSTS = ['static.dw.com'];
const TOPICS = [
  { id: 'all', title: { de: 'Neueste Videos', en: 'Latest videos' } },
  { id: 'long', title: { de: 'Dokumentationen und Reportagen', en: 'Documentaries and reports' }, sub: { de: 'ab 20 Minuten', en: '20 minutes and longer' } },
  { id: 'short', title: { de: 'Kurz erklärt', en: 'In brief' }, sub: { de: 'bis 5 Minuten', en: 'up to 5 minutes' } },
];

/** A teaser of the media centre → item (lazy: the files come with the detail). */
function fromTeaser(t) {
  if (!t || t.type !== 'VideoTeaser' || !t.reference || !t.reference.id) return null;
  const sizes = (t.image && t.image.sizes) || [];
  const img = sizes.find((s) => s.width >= 600) || sizes[sizes.length - 1];
  const id = String(t.reference.id);
  return makeItem({
    id: 'dw:' + id, source: 'dw', channel: 'DW.EN', topic: '', title: plain(t.name), description: plain(t.teaserText),
    timestamp: Date.parse(t.displayDate) || 0, duration: Number(t.duration) || 0, image: img ? img.url : null,
    website: null, lazy: true, ref: id,
  });
}

/** The detail of a video → { video, heights, ... } (MP4 sizes from "avc_1280x720"). */
function fromDetail(d, base) {
  const main = (d && d.mainContent) || {};
  const video = {}, heights = {};
  for (const s of main.sources || []) {
    if (!/^mp4$/i.test(s.format || '') || !/^https:\/\//.test(s.url || '')) continue;
    const m = /(\d{3,4})x(\d{3,4})/.exec(s.quality || s.url);
    if (!m) continue;
    const key = 'h' + m[2];
    if (video[key]) continue;
    video[key] = s.url;
    heights[key] = { width: +m[1], height: +m[2] };
  }
  const hls = (main.sources || []).find((s) => /^hls$/i.test(s.format || '') && /^https:\/\//.test(s.url || ''));
  if (!Object.keys(video).length && hls) video.hls = hls.url;
  const teaser = plain(d.teaser || '');
  return {
    ...base,
    title: plain(d.name) || base.title,
    description: teaser.length > (base.description || '').length ? teaser : base.description,
    topic: plain(d.categoryName) || base.topic,
    duration: Number(main.duration) || base.duration,
    website: /^https:\/\//.test(d.permaLink || main.permaLink || '') ? (d.permaLink || main.permaLink) : base.website,
    video, heights: Object.keys(heights).length ? heights : null, hls: !Object.keys(heights).length && !!hls,
    lazy: false,
  };
}

function createDw({ fetch, now = Date.now } = {}) {
  const req = createRequester({ fetch, name: 'DW', now });
  const listPage = (n) => req.memo('p' + n, LIST_TTL, async () => {
    const j = await req.get(`${API}/list/mediacenter/${LANGUAGE}?pageIndex=${n}`, { json: true });
    return { items: ((j && j.items) || []).map(fromTeaser).filter(Boolean), total: (j && j.paginationInfo && j.paginationInfo.availableItems) || 0, pages: (j && j.paginationInfo && j.paginationInfo.availablePages) || 1 };
  });
  async function pages(count) {
    const out = await Promise.all(Array.from({ length: count }, (_, i) => listPage(i + 1).catch((e) => (i ? { items: [] } : Promise.reject(e)))));
    return byDate(out.flatMap((p) => p.items));
  }

  async function list({ topic, text, offset = 0, size = 40 } = {}) {
    // a plain list pages through the API, filters and searches look through the newest pages
    if (!text && (!topic || topic === 'all')) {
      const first = Math.floor(offset / PAGE) + 1, last = Math.floor((offset + size - 1) / PAGE) + 1;
      const got = await Promise.all(Array.from({ length: last - first + 1 }, (_, i) => listPage(first + i)));
      const all = byDate(got.flatMap((p) => p.items));
      const skip = offset - (first - 1) * PAGE;
      const items = all.slice(skip, skip + size);
      const total = got[0].total || all.length;
      return { items, total, totalRelation: 'eq', offset, size, hasMore: last < (got[0].pages || 1) && items.length > 0, received: items.length };
    }
    let all = await pages(SEARCH_PAGES);
    if (topic === 'long') all = all.filter((it) => it.duration >= 1200);
    if (topic === 'short') all = all.filter((it) => it.duration && it.duration <= 300);
    if (text) all = all.filter((it) => matches(it, text));
    return page(all, { offset, size });
  }

  async function resolve(item) {
    const id = item && (item.ref || String(item.id || '').replace(/^dw:/, ''));
    if (!/^\d+$/.test(String(id || ''))) throw new Error('Unbekanntes DW-Video');
    const d = await req.memo('d' + id, DETAIL_TTL, () => req.get(`${API}/detail/video/${id}`, { json: true }));
    const base = item.title ? item : fromTeaser({ type: 'VideoTeaser', name: d.name, reference: { id }, displayDate: d.displayDate, duration: d.mainContent && d.mainContent.duration });
    return fromDetail(d, base);
  }

  return { id: 'dw', channel: 'DW.EN', hosts: HOSTS, imageHosts: IMAGE_HOSTS, search: true, topics: async () => TOPICS, list, resolve };
}

module.exports = { createDw, fromTeaser, fromDetail, TOPICS };
