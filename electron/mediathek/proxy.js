// The media:// protocol. Every remote film reaches the one <video> element through it, so the element
// stays CORS-clean and the projection screen may use it as a WebGL texture.
//
//   media://proxy/<base64url of an http(s) address>[/<name>]   films, HLS playlists and segments
//   media://subs/<base64url>                                    subtitles of the broadcaster → WebVTT
//   media://thumb/<base64url of the programme page>             preview image (see thumbs.js)
//   media://image/<base64url of a picture>                      picture of an English-language source (thumbs.js)
//   media://local/<base64url of a downloaded .m3u8>             offline playlist, segments via lfile://
//   media://live/<channel id>/master.m3u8                       a live channel whose address is looked up when it
//                                                               starts (live.js stream): its published master
//
// The proxy forwards Range, passes status, Content-Range, Content-Length, Content-Type and Accept-Ranges
// through and answers with Access-Control-Allow-Origin: *. HLS playlists are rewritten so that every
// variant, segment, key, init section and rendition is requested through media:// as well. Only hosts
// on the allowlist are reached (see allowlist.js).
'use strict';
const fs = require('fs');
const path = require('path');
const playlist = require('./playlist');
const errors = require('./errors');

const UA = 'CozyShelves/0.3 (Mediathek)';
const CONNECT_TIMEOUT = 20000;
const PLAYLIST_LIMIT = 8 * 1024 * 1024;
const SUBS_LIMIT = 6 * 1024 * 1024;
const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified'];

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64url');
const unb64 = (s) => { try { return Buffer.from(String(s || ''), 'base64url').toString('utf8'); } catch { return ''; } };
const tailOf = (u) => { try { return (new URL(u).pathname.split('/').pop() || 'x').replace(/[^\w.-]+/g, '_').slice(-60) || 'x'; } catch { return 'x'; } };
const proxyUrl = (u) => `media://proxy/${b64(u)}/${tailOf(u)}`;

function cors(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type, X-Mediathek-Error',
    ...extra,
  };
}
const answer = (status, text, extra) => new Response(status === 204 || status === 304 ? null : (text || ''), { status, headers: cors({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra }) });
const failWith = (kind, status) => answer(status || (kind === 'geo' || kind === 'geo-at' || kind === 'geo-ch' ? 451 : kind === 'gone' ? 404 : kind === 'offline' ? 502 : 502), errors.message(kind), { 'X-Mediathek-Error': kind });

const looksLikePlaylist = (url, ct) => { if (/mpegurl|m3u8/i.test(ct || '')) return true; try { return /\.m3u8?$/i.test(new URL(url).pathname); } catch { return false; } };

async function readText(res, limit) {
  const len = Number(res.headers.get('content-length')) || 0;
  if (len > limit) throw new Error('zu groß');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > limit) throw new Error('zu groß');
  return buf.toString('utf8');
}

const isPlaylistUrl = (url) => { try { return /\.m3u8?$/i.test(new URL(url).pathname); } catch { return false; } };

/**
 * A playlist with the address it finally came from. Electron's net.fetch follows redirects without telling
 * where to (Response.url stays empty), but relative addresses inside a playlist refer to that final address,
 * and ORF sends viewers outside Austria to a "geoprotection" playlist. The default works with any fetch
 * that reports Response.url; index.js hands in one built on net.request that follows redirects by hand.
 * → { status, url (final), text, geo (true when a redirect led to the geo block) }
 */
function fetchPlaylistWith(fetch) {
  return async (url, { headers = {}, timeout = CONNECT_TIMEOUT } = {}) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeout);
    try {
      const res = await fetch(url, { headers, redirect: 'follow', signal: ctrl.signal });
      const finalUrl = res.url || url;
      if (/geoprotection/i.test(finalUrl)) { try { await res.body?.cancel(); } catch {} return { status: 451, url: finalUrl, text: '', geo: true }; }
      if (!res.ok) { try { await res.body?.cancel(); } catch {} return { status: res.status, url: finalUrl, text: '' }; }
      return { status: res.status, url: finalUrl, text: await readText(res, PLAYLIST_LIMIT) };
    } finally { clearTimeout(timer); }
  };
}

/**
 * deps: { fetch (Electron net.fetch or a fake), fetchPlaylist? (see fetchPlaylistWith), allow (Allowlist),
 *         thumbs ({ thumb(url) }), toVtt, localRoots() → [dir], lfileUrl(absPath) → url, isInside }
 */
function createMediaProtocol({ fetch, fetchPlaylist = fetchPlaylistWith(fetch), allow, thumbs, toVtt, localRoots = () => [], lfileUrl, isInside, liveStream = null }) {
  const stats = { proxy: 0, playlists: 0, subs: 0, thumbs: 0, local: 0, refused: 0, open: 0, cancelled: 0 };
  const subsCache = new Map();

  function rewritten(text, base) {
    stats.playlists++;
    const out = playlist.rewrite(text, base, (abs) => { allow.add(abs); return proxyUrl(abs); });
    return new Response(out, { status: 200, headers: cors({ 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' }) });
  }

  /** fetch with a deadline for the response headers only (bodies of films may stream for hours). */
  async function upstream(url, { method = 'GET', headers = {}, signal, ctrl = new AbortController() } = {}) {
    const timer = setTimeout(() => ctrl.abort(new Error('timeout')), CONNECT_TIMEOUT);
    if (signal) { if (signal.aborted) ctrl.abort(signal.reason); else signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true }); }
    try {
      return await fetch(url, { method, headers: { 'User-Agent': UA, Accept: '*/*', ...headers }, redirect: 'follow', signal: ctrl.signal });
    } finally { clearTimeout(timer); }
  }

  /**
   * The body of a film for the renderer. When the <video> element drops the request (seeking, another
   * quality, stop), Electron cancels this stream and the request to the broadcaster is aborted with it,
   * so no connection to the CDN stays open in the background.
   */
  function relay(body, ctrl) {
    const reader = body.getReader();
    let closed = false;
    stats.open++;
    const done = () => { if (!closed) { closed = true; stats.open--; } };
    return new ReadableStream({
      async pull(c) {
        try {
          const { value, done: end } = await reader.read();
          if (end) { done(); c.close(); return; }
          c.enqueue(value);
        } catch (e) { done(); c.error(e); }
      },
      cancel(reason) { done(); stats.cancelled++; try { ctrl.abort(reason); } catch {} return reader.cancel(reason).catch(() => {}); },
    });
  }

  async function proxy(request, target) {
    if (!/^https?:\/\//i.test(target)) { stats.refused++; return answer(400, 'Nur http(s)-Adressen'); }
    if (!allow.has(target)) { stats.refused++; return answer(403, 'Adresse gehört nicht zur Mediathek'); }
    const method = request.method === 'HEAD' ? 'HEAD' : 'GET';
    const range = request.headers.get('range');
    // playlists: fetched whole, with the address they finally came from, and rewritten
    if (method === 'GET' && !range && isPlaylistUrl(target)) {
      let r;
      try { r = await fetchPlaylist(target, { headers: { 'User-Agent': UA, Accept: '*/*' } }); }
      catch (e) { return failWith(errors.classify({ status: 0, url: target, error: String(e && e.message || e) })); }
      if (r.geo) return failWith(errors.classify({ status: 451, url: target, finalUrl: r.url }));
      if (r.status < 200 || r.status >= 300) return failWith(errors.classify({ status: r.status, url: target, finalUrl: r.url }), r.status);
      if (!playlist.isPlaylist(r.text)) return answer(502, 'Keine Playlist');
      return rewritten(r.text, r.url || target);
    }
    let res;
    const ctrl = new AbortController();
    try { res = await upstream(target, { method, headers: range ? { Range: range } : {}, ctrl }); }
    catch (e) { return failWith(errors.classify({ status: 0, url: target, error: String(e && e.message || e) })); }
    const finalUrl = res.url || target;
    if (/geoprotection/i.test(finalUrl)) { try { await res.body?.cancel(); } catch {} return failWith(errors.classify({ status: 451, url: target, finalUrl })); }
    if (!res.ok && res.status !== 206) {
      try { await res.body?.cancel(); } catch {}
      return failWith(errors.classify({ status: res.status, url: target, finalUrl }), res.status);
    }
    const ct = res.headers.get('content-type') || '';
    if (method === 'GET' && !range && looksLikePlaylist(finalUrl, ct)) {
      let text;
      try { text = await readText(res, PLAYLIST_LIMIT); } catch (e) { return failWith('unknown'); }
      if (!playlist.isPlaylist(text)) return answer(200, text, { 'Content-Type': ct || 'application/octet-stream' });
      return rewritten(text, finalUrl);
    }
    stats.proxy++;
    const headers = cors({ 'Cache-Control': 'no-store' });
    for (const h of PASS_HEADERS) { const v = res.headers.get(h); if (v) headers[h] = v; }
    if (!headers['accept-ranges'] && (res.status === 206 || headers['content-range'])) headers['accept-ranges'] = 'bytes';
    return new Response(method === 'HEAD' || !res.body ? null : relay(res.body, ctrl), { status: res.status, headers });
  }

  async function subs(target) {
    if (!/^https?:\/\//i.test(target) || !allow.has(target)) { stats.refused++; return answer(403, 'Adresse gehört nicht zur Mediathek'); }
    stats.subs++;
    let vtt = subsCache.get(target);
    if (!vtt) {
      let res;
      try { res = await upstream(target, { headers: { Accept: 'application/ttml+xml, application/xml, text/vtt, */*' } }); }
      catch (e) { return failWith(errors.classify({ status: 0, url: target, error: String(e && e.message || e) })); }
      if (!res.ok) { try { await res.body?.cancel(); } catch {} return failWith(errors.classify({ status: res.status, url: target }), res.status); }
      try { vtt = toVtt(await readText(res, SUBS_LIMIT)); }
      catch (e) { return answer(415, 'Untertitel nicht lesbar'); }
      subsCache.set(target, vtt);
      if (subsCache.size > 24) subsCache.delete(subsCache.keys().next().value);
    }
    return new Response(vtt, { status: 200, headers: cors({ 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'no-store' }) });
  }

  async function thumb(website, direct = false) {
    stats.thumbs++;
    const hit = thumbs ? await (direct ? thumbs.image?.(website) : thumbs.thumb(website))?.catch?.(() => null) : null;
    // no picture is no error: 204 lets the card keep its typographic face without a console message
    if (!hit) return answer(204);
    try {
      const buf = fs.readFileSync(hit.file);
      return new Response(buf, { status: 200, headers: cors({ 'Content-Type': hit.type, 'Content-Length': String(buf.length), 'Cache-Control': 'max-age=86400' }) });
    } catch { return answer(404, 'Kein Bild'); }
  }

  /** A downloaded HLS film: the playlist next to the media file, its relative URIs turned into lfile:// URLs. */
  function local(file) {
    const p = path.normalize(file || '');
    if (!p || !/\.m3u8$/i.test(p) || !localRoots().some((r) => { try { return isInside(p, r); } catch { return false; } })) { stats.refused++; return answer(403, 'Kein Download der Mediathek'); }
    let text;
    try { text = fs.readFileSync(p, 'utf8'); } catch { return answer(404, 'Datei fehlt'); }
    stats.local++;
    const dir = path.dirname(p);
    const out = playlist.mapUris(text, (uri, kind) => {
      if (/^[a-z]+:/i.test(uri)) return null;
      let name = uri;
      try { name = decodeURIComponent(uri); } catch {}
      const abs = path.normalize(path.join(dir, name));
      if (!isInside(abs, dir)) return null;
      // nested playlists (separate audio) are local playlists again, media files go straight to lfile://
      return kind === 'playlist' || /\.m3u8$/i.test(abs) ? `media://local/${b64(abs)}/${encodeURIComponent(path.basename(abs))}` : lfileUrl(abs);
    });
    return new Response(out, { status: 200, headers: cors({ 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' }) });
  }

  async function handle(request) {
    if (request.method === 'OPTIONS') return answer(204);
    let url;
    try { url = new URL(request.url); } catch { return answer(400, 'Ungültige Adresse'); }
    const [key] = url.pathname.split('/').filter(Boolean);
    const target = unb64(key);
    switch (url.hostname) {
      case 'proxy': return proxy(request, target);
      case 'subs': return subs(target);
      case 'thumb': return thumb(target);
      case 'image': return thumb(target, true);
      case 'local': return local(target);
      case 'live': {
        // the key is the channel id here: the master at the address its broadcaster publishes right now, unchanged
        const address = liveStream ? await liveStream(decodeURIComponent(key || '')).catch(() => null) : null;
        if (!address) return failWith('offline');
        return proxy(request, address);
      }
      default: return answer(404, 'Unbekannt');
    }
  }

  return { handle, stats, proxyUrl };
}

module.exports = { createMediaProtocol, fetchPlaylistWith, proxyUrl, b64, unb64 };
