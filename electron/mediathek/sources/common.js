// Shared helpers of the English-language sources (sources/*.js): requests with a deadline and a small memory cache,
// a minimal RSS reader for the video podcasts, plain text from HTML, durations, and the item every source returns.
//
// Item (the same shape as a MediathekViewWeb film, see mvw.js, plus a few fields):
//   { id: '<source>:<id>', source, channel, topic, title, description, timestamp (ms), duration (s), website, image,
//     subtitle, video: { <key>: url } | null, heights: { <key>: { width, height } }, hls, lazy, lang: 'en', geo: null,
//     variant: null }
// `lazy` items carry no addresses yet: mediathek:resolve fetches them (DW, NASA, Internet Archive, TED).
'use strict';

const UA = 'CozyShelves/0.7 (Mediathek)';
const TIMEOUT = 15000;

/** Network failures as English/German neutral errors the panel shows as they are. */
function friendly(name, err) {
  const msg = String((err && err.message) || err || '');
  if (/ENOTFOUND|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|getaddrinfo|ERR_NETWORK_CHANGED|fetch failed|ECONNREFUSED|ERR_CONNECTION/i.test(msg)) return new Error(`Keine Verbindung zu ${name}. Bitte die Internetverbindung prüfen.`);
  if (/timeout|ETIMEDOUT|ERR_TIMED_OUT|abort/i.test(msg)) return new Error(`${name} antwortet gerade nicht. Bitte später noch einmal versuchen.`);
  if (/HTTP 5\d\d/.test(msg)) return new Error(`${name} hat gerade eine Störung. Bitte später noch einmal versuchen.`);
  return err instanceof Error ? err : new Error(msg || 'Unbekannter Fehler');
}

/**
 * A requester bound to one source: get(url, { json, accept }) with a deadline, at most `parallel` requests at once and
 * a memory cache (memo(key, ttl, fn)).
 */
function createRequester({ fetch, name, now = Date.now, parallel = 3, timeout = TIMEOUT } = {}) {
  let running = 0;
  const waiting = [];
  const slot = () => new Promise((r) => { if (running < parallel) { running++; r(); } else waiting.push(r); });
  const release = () => { const n = waiting.shift(); if (n) n(); else running--; };
  const cache = new Map();

  async function get(url, { json = false, accept, headers = {}, method = 'GET' } = {}) {
    await slot();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeout);
    try {
      const res = await fetch(url, { method, headers: { 'User-Agent': UA, Accept: accept || (json ? 'application/json' : '*/*'), ...headers }, redirect: 'follow', signal: ctrl.signal });
      if (!res.ok) { try { await res.body?.cancel(); } catch {} throw new Error('HTTP ' + res.status); }
      return json ? await res.json() : await res.text();
    } catch (e) { throw friendly(name, e); }
    finally { clearTimeout(timer); release(); }
  }
  /** Whether a file exists: one byte with a Range request, the body is never read. → { ok, status, total } */
  async function head(url) {
    await slot();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeout);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*', Range: 'bytes=0-0' }, redirect: 'follow', signal: ctrl.signal });
      const total = Number((/\/(\d+)\s*$/.exec(res.headers.get('content-range') || '') || [])[1]) || Number(res.headers.get('content-length')) || null;
      try { await res.body?.cancel(); } catch {}
      return { ok: res.ok, status: res.status, total };
    } catch (e) { return { ok: false, status: 0, total: null, error: String(e && e.message || e) }; }
    finally { clearTimeout(timer); release(); }
  }
  function memo(key, ttl, fn) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttl) return hit.value;
    const value = Promise.resolve().then(fn).catch((e) => { cache.delete(key); throw e; });
    cache.set(key, { at: now(), value });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return value;
  }
  return { get, head, memo, clear: () => cache.clear() };
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (a, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? a));
/** Plain text from a bit of HTML (descriptions of feeds and APIs). */
const plain = (s) => decode(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ''))
  .replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/** "00:12:41", "12:41", "761", "106 min", "1:31:44", "45 minutes" → seconds (0 when unknown). */
function parseDuration(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : 0;
  const s = String(v).trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s));
  let m = /^(\d+):(\d{1,2}):(\d{1,2})/.exec(s);
  if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3];
  m = /^(\d+):(\d{1,2})\s*min/.exec(s);
  if (m) return +m[1] * 3600 + +m[2] * 60;
  m = /^(\d+):(\d{1,2})$/.exec(s);
  if (m) return +m[1] * 60 + +m[2];
  m = /^(\d+(?:\.\d+)?)\s*(?:min|minutes|mins|m\b)/.exec(s);
  if (m) return Math.round(parseFloat(m[1]) * 60);
  return 0;
}

/** RSS 2.0 items with what a video podcast needs (title, description, link, guid, date, enclosure, duration, image). */
function parseRss(xml) {
  const text = String(xml || '');
  const tag = (block, name) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block); return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : ''; };
  const attr = (block, name, a) => { const m = new RegExp(`<${name}\\b[^>]*\\b${a}="([^"]*)"`, 'i').exec(block); return m ? decode(m[1]) : ''; };
  const channelPart = text.split(/<item[\s>]/i)[0];
  const channel = { title: plain(tag(channelPart, 'title')), image: attr(channelPart, 'itunes:image', 'href') || tag(tag(channelPart, 'image'), 'url'), link: tag(channelPart, 'link'), language: tag(channelPart, 'language') };
  const items = [];
  for (const m of text.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const b = m[1];
    items.push({
      title: plain(tag(b, 'title')),
      description: plain(tag(b, 'description') || tag(b, 'itunes:summary') || tag(b, 'content:encoded')),
      link: decode(tag(b, 'link')),
      guid: plain(tag(b, 'guid')),
      date: Date.parse(tag(b, 'pubDate')) || 0,
      enclosure: attr(b, 'enclosure', 'url'),
      type: attr(b, 'enclosure', 'type'),
      duration: parseDuration(tag(b, 'itunes:duration')),
      image: attr(b, 'itunes:image', 'href') || attr(b, 'media:thumbnail', 'url'),
      author: plain(tag(b, 'itunes:author')),
      talkId: tag(b, 'jwplayer:talkId'),
    });
  }
  return { channel, items };
}

/** The item every source returns, with defaults for the fields of a MediathekViewWeb film. */
function makeItem(fields) {
  return {
    id: '', source: '', channel: '', topic: '', title: '', description: '', timestamp: 0, duration: 0, size: null,
    website: null, image: null, subtitle: null, video: null, heights: null, hls: false, lazy: false, lang: 'en', geo: null, variant: null,
    ...fields,
  };
}

const https = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u.replace(/^http:\/\//i, 'https://') : null);

/** Items of several pages or sources, newest first, without repeats. */
function byDate(items) {
  const seen = new Set();
  return items.filter((it) => it && !seen.has(it.id) && seen.add(it.id)).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

/** A search over a list the source returns as a whole: every word must begin a word of title, topic or description. */
function matches(item, text) {
  const words = String(text || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = ` ${item.title} ${item.topic} ${item.description}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
  return words.every((w) => { const x = w.replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); return !x || hay.includes(' ' + x); });
}

/** offset/size paging over a finished list → the result shape of mediathek:query. */
function page(list, { offset = 0, size = 40 } = {}) {
  const o = Math.max(0, parseInt(offset, 10) || 0), n = Math.max(1, Math.min(200, parseInt(size, 10) || 40));
  const items = list.slice(o, o + n);
  return { items, total: list.length, totalRelation: 'eq', offset: o, size: n, hasMore: o + n < list.length, received: items.length };
}

module.exports = { UA, createRequester, friendly, plain, decode, parseDuration, parseRss, makeItem, https, byDate, matches, page };
