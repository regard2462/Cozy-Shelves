// MediathekViewWeb client (https://mediathekviewweb.de, data of the MediathekView project): search,
// channel and topic lists, normalisation of the results into the items the panel and the player use.
//
// Item: { id, channel, topic, title, description, timestamp (ms), duration (s), size (bytes of 'sd'),
//         website, subtitle, video: { low, sd, hd }, heights, hls, variant, geo }
// heights (0.7): the picture sizes the addresses name ({ sd: { width, height, p } }), see heights.js fromUrl; the
// others are read from the files when a film plays (mediathek:heights).
// variant: accessibility / language version ('ad' Audiodeskription, 'dgs' Gebärdensprache, 'ks' klare
// Sprache, 'ut' mit Untertiteln, 'ov' Originalversion) or null. Pure module: `fetch` is injected.
'use strict';
const channels = require('./channels');
const { fromUrl, classOf } = require('./heights');

const API = 'https://mediathekviewweb.de/api';
const UA = 'CozyShelves/0.3 (Mediathek)';
const TTL = 5 * 60 * 1000;
const MAX_SIZE = 200;

const clean = (u) => { const s = String(u || '').trim(); return /^https?:\/\//i.test(s) ? s : null; };
const isHls = (u) => /\.m3u8(\?|$)/i.test(u || '');

const VARIANTS = [
  ['ad', /\([^()]*\b(?:Audiodeskription|Hörfassung)\b[^()]*\)/i],
  ['dgs', /\([^()]*(?:Gebärdensprache|\bDGS\b)[^()]*\)/i],
  ['ks', /\([^()]*\b(?:klarer?n? Sprache|Leichte Sprache)\b[^()]*\)/i],
  ['ov', /\((?:[^()]*\s)?(?:Originalversion|OV|OmU)\b[^()]*\)/i],
  ['ut', /\(mit Untertiteln?\)/i],
];
function variantOf(title) {
  for (const [id, re] of VARIANTS) if (re.test(title || '')) return id;
  return null;
}
/** Variants hidden from rows and search results unless asked for: the plain version is always listed too. */
const HIDDEN_VARIANTS = new Set(['ad', 'dgs', 'ks', 'ut']);
const baseTitle = (t) => String(t || '').replace(/\s*\((?:[^()]*\b)?(?:Audiodeskription|Hörfassung|Gebärdensprache|DGS|klarer?n? Sprache|Leichte Sprache|mit Untertiteln?|Originalversion(?: mit Untertiteln?)?|OV|OmU)\b[^()]*\)\s*/gi, ' ').replace(/\s+/g, ' ').trim();

/** Where a film may be played: 'de' Germany only, 'at' Austria, 'dach' D-A-CH, null = worldwide/unknown. */
function geoOf(url) {
  const u = String(url || '');
  if (/cms-austria|geoprotection/i.test(u)) return 'at';
  if (/akamaihd\.net\/dach\//i.test(u)) return 'dach';
  if (/akamaihd\.net\/de\/|cdn-storage\.br\.de\/geo\/|\/deutschlandweit\//i.test(u)) return 'de';
  return null;
}

function normalize(r) {
  if (!r || typeof r !== 'object') return null;
  let low = clean(r.url_video_low), sd = clean(r.url_video), hd = clean(r.url_video_hd);
  if (!sd) sd = hd || low;
  if (!sd) return null;
  if (hd === sd) hd = null;
  if (low === sd) low = null;
  const duration = Number(r.duration) || 0;
  const ts = Number(r.timestamp) || 0;
  const heights = {};
  for (const [k, u] of Object.entries({ low, sd, hd })) { const h = u && fromUrl(u); if (h) heights[k] = { width: h.width || 0, height: h.height, p: classOf(h.width, h.height) }; }
  return {
    id: String(r.id || `${r.channel}|${r.topic}|${r.title}|${ts}`),
    channel: String(r.channel || ''),
    topic: String(r.topic || '').trim(),
    title: String(r.title || '').trim() || String(r.topic || '').trim(),
    description: String(r.description || '').trim(),
    timestamp: ts * 1000,
    duration,
    size: Number(r.size) || null,
    website: clean(r.url_website),
    subtitle: clean(r.url_subtitle),
    video: { low, sd, hd },
    heights: Object.keys(heights).length ? heights : null,
    hls: isHls(sd) || isHls(hd) || isHls(low),
    variant: variantOf(r.title),
    geo: geoOf(sd),
  };
}

/** Same film listed twice (identical channel, topic, title and time) → keep the first one. */
function dedupe(items, { variants = false } = {}) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it) continue;
    if (!variants && it.variant && HIDDEN_VARIANTS.has(it.variant)) continue;
    const key = `${it.channel}|${it.topic}|${it.title}|${it.timestamp}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/**
 * The search syntax of MediathekViewWeb: "!ard" channel, "#tatort" topic, "+title words", "*description",
 * ">60" at least 60 minutes, "<10" at most 10 minutes. Everything else searches title and topic.
 */
function parseSearch(text) {
  const out = { words: [], channels: [], topics: [], titles: [], descriptions: [], durationMin: null, durationMax: null };
  for (const tok of String(text || '').split(/\s+/).filter(Boolean)) {
    const rest = tok.slice(1).replace(/,/g, ' ').trim();
    if (tok[0] === '!' && rest) out.channels.push(rest);
    else if (tok[0] === '#' && rest) out.topics.push(rest);
    else if (tok[0] === '+' && rest) out.titles.push(rest);
    else if (tok[0] === '*' && rest) out.descriptions.push(rest);
    else if (tok[0] === '>' && /^\d+$/.test(rest)) out.durationMin = parseInt(rest, 10) * 60;
    else if (tok[0] === '<' && /^\d+$/.test(rest)) out.durationMax = parseInt(rest, 10) * 60;
    else out.words.push(tok);
  }
  return out;
}

/**
 * Query options → request body of /api/query.
 *   text          free text (MediathekViewWeb syntax allowed)
 *   inDescription also search the descriptions
 *   channels      exact channel ids (OR); default = the German-language channels
 *   topic         exact topic (topic.keyword)
 *   topics        several exact topics (OR)
 *   topicsLike    words in the topic, several phrases OR'ed ("Terra X" also finds "Terra X History")
 *   durationMin / durationMax  seconds
 *   sort          'new' | 'old' | 'long' | 'short' | 'relevance'
 *   offset, size
 */
function buildBody(o = {}) {
  const s = parseSearch(o.text);
  const queries = [];
  const words = s.words.join(' ').trim();
  if (words) queries.push({ fields: o.inDescription ? ['title', 'topic', 'description'] : ['title', 'topic'], query: words });
  for (const t of s.titles) queries.push({ fields: ['title'], query: t });
  for (const d of s.descriptions) queries.push({ fields: ['description'], query: d });
  // topics: exact ones (Sender view, curated rows) and "#word" (analysed topic field)
  const exactTopics = [o.topic, ...(o.topics || [])].filter(Boolean);
  for (const t of exactTopics) queries.push({ fields: ['topic.keyword'], query: String(t) });
  for (const t of [...s.topics, ...(o.topicsLike || [])]) if (t) queries.push({ fields: ['topic'], query: String(t) });
  // channels: chips (exact ids) or "!name" (analysed field); none → all German-language channels
  const chans = (o.channels && o.channels.length ? o.channels : null);
  if (s.channels.length) for (const c of s.channels) queries.push({ fields: ['channel'], query: c });
  else for (const c of chans || (o.allChannels ? [] : channels.germanIds())) queries.push({ fields: ['channel.keyword'], query: c });
  const sort = { new: ['timestamp', 'desc'], old: ['timestamp', 'asc'], long: ['duration', 'desc'], short: ['duration', 'asc'] }[o.sort || 'new'];
  const body = {
    queries,
    future: false,
    offset: Math.max(0, parseInt(o.offset, 10) || 0),
    size: Math.min(MAX_SIZE, Math.max(1, parseInt(o.size, 10) || 40)),
  };
  if (sort) { body.sortBy = sort[0]; body.sortOrder = sort[1]; }
  const dmin = s.durationMin ?? o.durationMin, dmax = s.durationMax ?? o.durationMax;
  if (dmin != null && dmin > 0) body.duration_min = dmin;
  if (dmax != null && dmax > 0) body.duration_max = dmax;
  return body;
}

/** Network and API failures as German sentences (the panel shows them as they are). */
function friendly(err) {
  const msg = String(err && err.message || err || '');
  if (/ENOTFOUND|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|getaddrinfo|ERR_NETWORK_CHANGED|fetch failed|ECONNREFUSED|ERR_CONNECTION/i.test(msg)) return new Error('Keine Verbindung zu MediathekViewWeb. Bitte die Internetverbindung prüfen.');
  if (/timeout|ETIMEDOUT|ERR_TIMED_OUT|abort/i.test(msg)) return new Error('MediathekViewWeb antwortet gerade nicht. Bitte später noch einmal versuchen.');
  if (/HTTP 5\d\d/.test(msg)) return new Error('MediathekViewWeb hat gerade eine Störung. Bitte später noch einmal versuchen.');
  return err instanceof Error ? err : new Error(msg || 'Unbekannter Fehler');
}

/**
 * The client. deps: { fetch(url, init) → Response, onItems(items) (allowlist hook), now() }.
 * Identical requests within five minutes come from the memory cache; at most four requests run at once.
 */
function createClient({ fetch, onItems, now = Date.now, timeout = 15000 } = {}) {
  const cache = new Map();
  let running = 0;
  const waiting = [];
  const slot = () => new Promise((res) => { if (running < 4) { running++; res(); } else waiting.push(res); });
  const release = () => { const next = waiting.shift(); if (next) next(); else running--; };

  async function request(url, init) {
    await slot();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeout);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json', ...(init && init.headers) } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) { throw friendly(e); }
    finally { clearTimeout(timer); release(); }
  }
  function memo(key, ttl, fn) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttl) return hit.value;
    const value = fn().catch((e) => { cache.delete(key); throw e; });
    cache.set(key, { at: now(), value });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return value;
  }

  async function query(opts = {}) {
    const body = buildBody(opts);
    const key = 'q:' + JSON.stringify(body) + (opts.variants ? ':v' : '');
    return memo(key, TTL, async () => {
      const json = await request(API + '/query', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
      if (json && json.err) throw new Error(Array.isArray(json.err) ? json.err.join(', ') : String(json.err));
      const raw = (json && json.result && json.result.results) || [];
      const all = raw.map(normalize).filter(Boolean).filter((it) => !channels.EXCLUDED.has(it.channel));
      const items = dedupe(all, { variants: !!opts.variants });
      const info = (json && json.result && json.result.queryInfo) || {};
      if (onItems) onItems(all);
      return { items, total: Number(info.totalResults) || items.length, totalRelation: info.totalRelation || 'eq', offset: body.offset, size: body.size, hasMore: raw.length >= body.size, received: raw.length };
    });
  }

  /** Other versions of the same broadcast (Audiodeskription, Gebärdensprache …). */
  async function variants(item) {
    if (!item || !item.title) return [];
    const base = baseTitle(item.title);
    const r = await query({ text: '+' + base.split(/\s+/).slice(0, 6).join(' '), channels: [item.channel], topic: item.topic || undefined, size: 20, variants: true });
    return r.items.filter((x) => x.id !== item.id && baseTitle(x.title).toLowerCase() === base.toLowerCase() && Math.abs(x.timestamp - item.timestamp) < 3 * 864e5);
  }

  const channelList = () => memo('channels', 24 * 3600e3, async () => {
    const json = await request(API + '/channels');
    return ((json && json.channels) || []).filter((c) => !channels.EXCLUDED.has(c));
  });
  const topics = (channel) => memo('topics:' + channel, 3600e3, async () => {
    const json = await request(API + '/topics?channel=' + encodeURIComponent(channel));
    return ((json && json.topics) || []).filter(Boolean);
  });

  return { query, variants, channels: channelList, topics, clear: () => cache.clear() };
}

module.exports = { createClient, normalize, dedupe, buildBody, parseSearch, variantOf, baseTitle, geoOf, friendly, HIDDEN_VARIANTS, UA };
