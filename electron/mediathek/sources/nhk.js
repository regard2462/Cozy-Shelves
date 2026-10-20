// NHK WORLD-JAPAN, the international service of Japan's public broadcaster: on-demand episodes in English from the
// open API of its website (api.nhkworld.jp/showsapi). Every episode is an HLS master (180p to 720p) that stays online
// for a few weeks. Topics are the categories of NHK WORLD (Documentary, Food, Travel …); the API has no search, a
// search looks through the newest 300 episodes.
'use strict';
const { createRequester, plain, makeItem, page, matches, byDate } = require('./common');

const API = 'https://api.nhkworld.jp/showsapi/v1/en';
const SITE = 'https://www3.nhk.or.jp';
const MAX = 100;                    // the API refuses larger pages
const LIST_TTL = 15 * 60e3, TOPIC_TTL = 6 * 3600e3;
const SEARCH_PAGES = 3;
const HOSTS = ['masterpl.hls.nhkworld.jp'];
const IMAGE_HOSTS = ['www3.nhk.or.jp'];

const abs = (u) => (u ? (/^https?:\/\//.test(u) ? u : SITE + (u.startsWith('/') ? u : '/' + u)) : null);

/** An episode of the API → item (null when it has no video or is no longer online). */
function fromEpisode(e, now = Date.now()) {
  const v = e && e.video;
  if (!v || !/^https:\/\/[^\s]+\.m3u8/.test(v.url || '')) return null;
  if (v.expired_at && Date.parse(v.expired_at) < now) return null;
  const imgs = (e.images || []).slice().sort((a, b) => a.width - b.width);
  const img = imgs.find((i) => i.width >= 600) || imgs[imgs.length - 1];
  return makeItem({
    id: 'nhk:' + e.id, source: 'nhk', channel: 'NHK', topic: plain(e.video_program && e.video_program.title) || 'NHK WORLD-JAPAN',
    title: plain(e.title), description: plain(e.description), timestamp: Date.parse(v.published_at) || Date.parse(e.first_broadcasted_at) || 0,
    duration: Number(v.duration) || 0, image: img ? abs(img.url) : null, website: abs(e.url), video: { hls: v.url }, hls: true,
    expires: Date.parse(v.expired_at) || null, programId: e.video_program && e.video_program.id,
    categories: (e.categories || []).map((c) => c.name),
  });
}

function createNhk({ fetch, now = Date.now } = {}) {
  const req = createRequester({ fetch, name: 'NHK WORLD-JAPAN', now });
  const path = (topic) => {
    const m = /^(category|program):([\w-]+)$/.exec(topic || '');
    if (!m) return 'video_episodes';
    return m[1] === 'category' ? `categories/${m[2]}/video_episodes` : `video_programs/${m[2]}/video_episodes`;
  };
  const fetchPage = (topic, offset, limit) => req.memo(`${path(topic)}|${offset}|${limit}`, LIST_TTL, async () => {
    const j = await req.get(`${API}/${path(topic)}?limit=${limit}&offset=${offset}`, { json: true });
    return { items: ((j && j.items) || []).map((e) => fromEpisode(e, now())).filter(Boolean), total: (j && j.pagination && j.pagination.total) || 0, count: (j && j.pagination && j.pagination.count) || 0 };
  });

  async function list({ topic, text, offset = 0, size = 40 } = {}) {
    if (!text) {
      // pages of at most 100; expired episodes are left out, so a page may hold fewer items than asked for
      const limit = Math.min(MAX, Math.max(1, size));
      const p = await fetchPage(topic, Math.max(0, offset), limit);
      return { items: p.items, total: p.total, totalRelation: 'eq', offset, size: limit, hasMore: offset + p.count < p.total, received: p.count };
    }
    const got = await Promise.all(Array.from({ length: SEARCH_PAGES }, (_, i) => fetchPage(topic, i * MAX, MAX).catch((e) => (i ? { items: [] } : Promise.reject(e)))));
    return page(byDate(got.flatMap((p) => p.items)).filter((it) => matches({ ...it, description: `${it.description} ${(it.categories || []).join(' ')}` }, text)), { offset, size });
  }

  const topics = () => req.memo('topics', TOPIC_TTL, async () => {
    const j = await req.get(`${API}/categories`, { json: true });
    return ((j && j.items) || [])
      .filter((c) => c.video_episodes && c.video_episodes.total > 0)
      .map((c) => ({ id: 'category:' + c.id, title: { de: plain(c.name), en: plain(c.name) }, count: c.video_episodes.total }))
      .sort((a, b) => b.count - a.count);
  });

  /** Episodes carry their master already; resolving only refreshes an episode that came from the Merkliste. */
  async function resolve(item) { return { ...item, lazy: false }; }

  return { id: 'nhk', channel: 'NHK', hosts: HOSTS, imageHosts: IMAGE_HOSTS, search: true, topics, list, resolve };
}

module.exports = { createNhk, fromEpisode };
