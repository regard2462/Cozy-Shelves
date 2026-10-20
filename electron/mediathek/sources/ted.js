// TED Talks: the official video podcasts of TED ("TED Talks Daily", HD and SD video; feeds.feedburner.com). TED stopped
// adding talks to the video feeds in May 2025, the 150 or so talks in them stay available as MP4 from TED's servers.
// Talks are under CC BY-NC-ND 4.0: watching and saving them for yourself is allowed. The two feeds are joined by the
// talk number, so most talks come in two sizes; the sizes come from the files.
'use strict';
const { createRequester, makeItem, parseRss, page, matches, byDate } = require('./common');

const FEEDS = { hd: 'https://feeds.feedburner.com/TedtalksHD', sd: 'https://feeds.feedburner.com/TEDTalks_video' };
const FEED_TTL = 12 * 3600e3;
const HOSTS = ['download.ted.com', 'py.tedcdn.com'];
const IMAGE_HOSTS = ['pi.tedcdn.com'];

/** "Title | Speaker" → [title, speaker]. */
function splitTitle(t) {
  const i = String(t || '').lastIndexOf(' | ');
  return i > 0 ? [t.slice(0, i).trim(), t.slice(i + 3).trim()] : [String(t || '').trim(), ''];
}
const talkOf = (e) => e.talkId || (/:(\d+)$/.exec(e.guid || '') || [])[1] || e.guid || e.enclosure;

/** The entries of both feeds → one item per talk, the HD file as 'hd', the SD file as 'sd'. */
function merge(hdItems, sdItems) {
  const talks = new Map();
  for (const [kind, list] of [['hd', hdItems], ['sd', sdItems]]) {
    for (const e of list || []) {
      if (!/^https:\/\/download\.ted\.com\/[^\s]+\.mp4/i.test(e.enclosure || '')) continue;
      const id = String(talkOf(e));
      const [title, speaker] = splitTitle(e.title);
      const t = talks.get(id) || makeItem({
        id: 'ted:' + id, source: 'ted', channel: 'TED', topic: speaker || 'TED', title, description: e.description, timestamp: e.date,
        duration: e.duration, image: e.image || null, website: e.link || null, video: {}, lazy: true, speaker,
      });
      if (!t.video[kind]) t.video[kind] = e.enclosure;
      talks.set(id, t);
    }
  }
  return byDate([...talks.values()]);
}

function createTed({ fetch, heights = null, now = Date.now } = {}) {
  const req = createRequester({ fetch, name: 'TED', now });
  const all = () => req.memo('talks', FEED_TTL, async () => {
    const [hd, sd] = await Promise.all([
      req.get(FEEDS.hd, { accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.5' }).then((x) => parseRss(x).items),
      req.get(FEEDS.sd, { accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.5' }).then((x) => parseRss(x).items).catch(() => []),
    ]);
    return merge(hd, sd);
  });

  async function list({ text, offset = 0, size = 40, sort } = {}) {
    let items = await all();
    if (text) items = items.filter((it) => matches(it, text));
    if (sort === 'long') items = items.slice().sort((a, b) => b.duration - a.duration);
    if (sort === 'short') items = items.slice().sort((a, b) => a.duration - b.duration);
    return page(items, { offset, size });
  }

  async function resolve(item) {
    const out = { ...item, lazy: false };
    if (heights && item.video) {
      const hs = await heights.ofItem({ video: item.video }).catch(() => ({}));
      if (Object.keys(hs).length) out.heights = hs;
    }
    return out;
  }

  return { id: 'ted', channel: 'TED', hosts: HOSTS, imageHosts: IMAGE_HOSTS, search: true, topics: async () => [], list, resolve };
}

module.exports = { createTed, merge, splitTitle };
