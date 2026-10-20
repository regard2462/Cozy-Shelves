// Live TV: the channel list (live-channels.json), newer stream addresses from the Zapp backend
// (api.zapp.mediathekview.de, refreshed at most twice a day, the bundled list is the fallback) and
// "what is on now" per channel from the same backend. `fetch` is injected (tests, Electron net).
// The English news channels (group 'en') are not in Zapp. They play only from addresses their broadcasters publish
// themselves, unchanged: a channel with `resolve` looks its address up when it starts (stream(id): DW English in the
// DW website's live data, NHK WORLD-JAPAN in the list its web player reads), the others have a fixed published
// address. A channel that refuses its address (FRANCE 24 English: its master answers 403)
// shows that it is not reachable, nothing is put together from other addresses. DW English also says what is on.
'use strict';
const path = require('path');
const fs = require('fs');

const ZAPP = 'https://api.zapp.mediathekview.de/v1';
const DW_NOW = 'https://www.dw.com/graph-api/en/livestream/english';
const UA = 'CozyShelves/0.3 (Mediathek)';
const REFRESH = 12 * 3600e3;
const NOW_TTL = 3 * 60e3;
const STREAM_TTL = 60e3;      // a looked-up address is used for a minute

const validStream = (u) => /^https:\/\/[^\s"']+\.m3u8(\?[^\s"']*)?$/i.test(String(u || ''));
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** Programme texts of the Zapp backend carry HTML (<b>, <br/>, entities): plain text with line breaks. */
const plain = (s) => String(s || '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (a, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? a))
  .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/** { url, path } of a JSON document of the broadcaster that names the stream ("data.items.0.src"). */
const validResolve = (r) => !!r && /^https:\/\/[^\s"']+$/i.test(String(r.url || '')) && /^[\w$]+(\.[\w$]+)*$/.test(String(r.path || ''));

function loadBundled() {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'live-channels.json'), 'utf8'));
  return data.channels.filter((c) => c && c.id && (validStream(c.stream) || validResolve(c.resolve))).map((c) => (c.resolve && !validResolve(c.resolve) ? (({ resolve: _, ...rest }) => rest)(c) : c));
}

/** The value at a dotted path of a JSON document (array indexes as numbers). */
const pick = (json, dotted) => String(dotted).split('.').reduce((o, k) => (o == null ? undefined : o[k]), json);

/** Apply a Zapp channelInfoList ({ id: { streamUrl, name } }) to the channel list (only valid https m3u8). */
function applyZapp(list, info) {
  if (!info || typeof info !== 'object') return list;
  return list.map((c) => {
    const z = c.zapp && info[c.zapp];
    return z && validStream(z.streamUrl) && z.streamUrl !== c.stream ? { ...c, stream: z.streamUrl, updated: true } : c;
  });
}

function createLive({ fetch, onStreams, now = Date.now, timeout = 8000 } = {}) {
  let channels = loadBundled();
  let refreshedAt = 0, refreshing = null;
  const nowCache = new Map();
  if (onStreams) onStreams(channels);

  async function getJson(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeout);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  function refresh() {
    if (refreshing) return refreshing;
    if (now() - refreshedAt < REFRESH) return Promise.resolve(channels);
    refreshing = getJson(ZAPP + '/channelInfoList')
      .then((info) => { channels = applyZapp(channels, info); refreshedAt = now(); if (onStreams) onStreams(channels); return channels; })
      .catch((e) => { refreshedAt = now() - REFRESH + 15 * 60e3; console.warn('[mediathek] Zapp-Senderliste nicht erreichbar:', e.message); return channels; })
      .finally(() => { refreshing = null; });
    return refreshing;
  }

  /** The channel list; waits at most ~2.5 s for a first refresh from the Zapp backend. A channel with `resolve` plays
   *  through media://live/<id>/master.m3u8, which asks stream(id) for its address when the channel starts. */
  async function list() {
    if (!refreshedAt) await Promise.race([refresh(), new Promise((r) => setTimeout(r, 2500))]);
    else refresh();
    return channels.map((c) => ({ ...c, live: true, src: c.resolve ? `media://live/${encodeURIComponent(c.id)}/master.m3u8` : undefined }));
  }

  /** The address of a channel's stream as its broadcaster publishes it right now, unchanged (null: unknown channel or
   *  no address). A channel with `resolve` reads it from the broadcaster's document; when that is not reachable it
   *  falls back to the published address in the list, if it has one. */
  const streams = new Map();
  async function stream(id) {
    const c = channels.find((x) => x.id === id);
    if (!c) return null;
    if (!c.resolve) return validStream(c.stream) ? c.stream : null;
    const hit = streams.get(id);
    if (hit && now() - hit.at < STREAM_TTL) return hit.url;
    try {
      const url = pick(await getJson(c.resolve.url), c.resolve.path);
      if (!validStream(url)) throw new Error('no stream address');
      streams.set(id, { at: now(), url });
      return url;
    } catch (e) {
      console.warn('[mediathek] live address of', id, e.message);
      return validStream(c.stream) ? c.stream : null;
    }
  }

  /** DW English: what is on now, from the live page of the DW website. */
  async function dwNow() {
    const json = await getJson(DW_NOW);
    const ch = json && json.data && Array.isArray(json.data.livestreamChannels) ? json.data.livestreamChannels[0] : null;
    const t = now();
    const slot = ch && (ch.nextTimeSlots || []).find((x) => Date.parse(x.startDate) <= t && t < Date.parse(x.endDate));
    if (!slot) return null;
    const el = slot.programElement || {};
    return { title: plain((slot.program && slot.program.name) || el.name || ''), subtitle: el.name ? plain(el.name) : null, description: el.teaser ? plain(el.teaser) : null, start: Date.parse(slot.startDate) || null, end: Date.parse(slot.endDate) || null };
  }

  /** What is on now: { [id]: { title, subtitle, start, end } } for the given channel ids (unknown ids → absent). */
  async function current(ids) {
    const out = {};
    await Promise.all((ids || []).map(async (id) => {
      const c = channels.find((x) => x.id === id);
      if (!c || (!c.zapp && c.now !== 'dw')) return;
      const hit = nowCache.get(id);
      if (hit && now() - hit.at < NOW_TTL && (!hit.value || !hit.value.end || hit.value.end > now())) { if (hit.value) out[id] = hit.value; return; }
      try {
        let value;
        if (c.now === 'dw') value = await dwNow();
        else {
          const json = await getJson(ZAPP + '/shows/' + encodeURIComponent(c.zapp));
          const s = json && Array.isArray(json.shows) ? json.shows[0] : null;
          value = s ? { title: plain(s.title), subtitle: s.subtitle ? plain(s.subtitle) : null, description: s.description ? plain(s.description) : null, start: Date.parse(s.startTime) || null, end: Date.parse(s.endTime) || null } : null;
        }
        nowCache.set(id, { at: now(), value });
        if (value) out[id] = value;
      } catch { nowCache.set(id, { at: now() - NOW_TTL + 30e3, value: null }); }
    }));
    return out;
  }

  return { list, current, refresh, stream, get channels() { return channels; } };
}

module.exports = { createLive, applyZapp, loadBundled, validStream, validResolve, pick, plain };
