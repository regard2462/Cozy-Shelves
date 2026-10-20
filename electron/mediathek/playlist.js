// HLS playlists (m3u8): parsing, URI rewriting for the media:// proxy and the byte-range playlists of
// downloaded films. Pure functions, no Electron: tested by test-mediathek.js.
'use strict';

// \s also matches a byte order mark (U+FEFF)
const isPlaylist = (text) => /^\s*#EXTM3U/.test(String(text || ''));

/** Attribute list of a tag line: #EXT-X-MEDIA:TYPE=AUDIO,URI="a.m3u8" → { TYPE: 'AUDIO', URI: 'a.m3u8' } */
function parseAttrs(s) {
  const out = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = m[2].startsWith('"') ? m[2].slice(1, -1) : m[2];
  return out;
}
const tagOf = (line) => { const i = line.indexOf(':'); return i < 0 ? line : line.slice(0, i); };
const attrsOf = (line) => { const i = line.indexOf(':'); return i < 0 ? {} : parseAttrs(line.slice(i + 1)); };

const resolve = (uri, base) => { try { return new URL(uri, base).href; } catch { return null; } };
/** Only real web addresses are rewritten; data:, skd: (DRM) and friends stay as they are. */
const isWeb = (u) => /^https?:\/\//i.test(u || '');

/** Tags whose URI attribute points at another playlist (the rest point at segments, keys, init sections). */
const PLAYLIST_TAGS = new Set(['#EXT-X-MEDIA', '#EXT-X-I-FRAME-STREAM-INF', '#EXT-X-RENDITION-REPORT']);

/**
 * Map every URI of a playlist: plain URI lines (variants, segments) and URI="…" / SERVER-URI="…" attributes
 * of any tag (EXT-X-MEDIA, EXT-X-I-FRAME-STREAM-INF, EXT-X-KEY, EXT-X-MAP, EXT-X-PART …).
 * fn(uri, kind) returns the replacement or null (keep); kind is 'playlist' | 'segment' | 'key' | 'map' | 'other'.
 */
function mapUris(text, fn) {
  const lines = String(text).split(/\r?\n/);
  const master = lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'));
  return lines.map((raw) => {
    const line = raw.trim();
    if (!line) return raw;
    if (line.startsWith('#')) {
      if (!/(?:^|[,:])(?:SERVER-)?URI="/.test(line)) return raw;
      const tag = tagOf(line);
      const kind = PLAYLIST_TAGS.has(tag) ? 'playlist' : tag === '#EXT-X-KEY' || tag === '#EXT-X-SESSION-KEY' ? 'key' : tag === '#EXT-X-MAP' ? 'map' : tag === '#EXT-X-PART' || tag === '#EXT-X-PRELOAD-HINT' ? 'segment' : 'other';
      return line.replace(/((?:^|[,:])(?:SERVER-)?URI=)"([^"]*)"/g, (all, pre, uri) => {
        const next = fn(uri, kind);
        return next == null ? all : `${pre}"${next}"`;
      });
    }
    const next = fn(line, master ? 'playlist' : 'segment');
    return next == null ? raw : next;
  }).join('\n');
}

/**
 * Rewrite every URI of a playlist for the proxy: relative, root-relative and absolute URIs are resolved
 * against `base` (the address the playlist came from) and handed to map(absUrl, kind). data:, skd:
 * (DRM) and other non-web URIs stay untouched.
 */
function rewrite(text, base, map) {
  return mapUris(text, (uri, kind) => {
    const abs = resolve(uri, base);
    return abs && isWeb(abs) ? map(abs, kind) : null;
  });
}

/** Master playlist → { variants: [{ uri, bandwidth, width, height, codecs, audio, subtitles, frameRate }],
 *  media: [{ type, groupId, name, language, default, autoselect, uri }] } with absolute URIs. */
function parseMaster(text, base) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim());
  const variants = [], media = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      const a = attrsOf(line);
      let j = i + 1;
      while (j < lines.length && (!lines[j] || lines[j].startsWith('#'))) j++;
      if (j >= lines.length) break;
      const [w, h] = String(a.RESOLUTION || '').split('x').map((n) => parseInt(n, 10));
      variants.push({ uri: resolve(lines[j], base), bandwidth: parseInt(a['AVERAGE-BANDWIDTH'] || a.BANDWIDTH, 10) || 0, peak: parseInt(a.BANDWIDTH, 10) || 0, width: w || 0, height: h || 0, codecs: a.CODECS || '', audio: a.AUDIO || null, subtitles: a.SUBTITLES || null, frameRate: parseFloat(a['FRAME-RATE']) || 0 });
      i = j;
    } else if (line.startsWith('#EXT-X-MEDIA:')) {
      const a = attrsOf(line);
      media.push({ type: a.TYPE, groupId: a['GROUP-ID'], name: a.NAME || '', language: (a.LANGUAGE || '').toLowerCase(), default: a.DEFAULT === 'YES', autoselect: a.AUTOSELECT === 'YES', uri: a.URI ? resolve(a.URI, base) : null, channels: a.CHANNELS || null });
    }
  }
  return { variants, media, isMaster: variants.length > 0 };
}

/** Media playlist → { segments: [{ uri, duration, byterange? }], endlist, targetDuration, mediaSequence,
 *  encrypted, map, duration }. byterange = { length, offset } (offset may be null = "continues"). */
function parseMedia(text, base) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim());
  const segments = [];
  let duration = 0, pending = null, range = null, endlist = false, targetDuration = 0, mediaSequence = 0, encrypted = false, map = null, lastEnd = 0, discontinuity = false;
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) { pending = parseFloat(line.slice(8)) || 0; continue; }
    if (line.startsWith('#EXT-X-BYTERANGE:')) {
      const [len, off] = line.slice(17).split('@');
      const length = parseInt(len, 10);
      const offset = off != null ? parseInt(off, 10) : lastEnd;
      range = { length, offset };
      lastEnd = offset + length;
      continue;
    }
    if (line.startsWith('#EXT-X-ENDLIST')) { endlist = true; continue; }
    if (line.startsWith('#EXT-X-DISCONTINUITY')) { discontinuity = true; continue; }
    if (line.startsWith('#EXT-X-TARGETDURATION:')) { targetDuration = parseFloat(line.slice(22)) || 0; continue; }
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) { mediaSequence = parseInt(line.slice(22), 10) || 0; continue; }
    if (line.startsWith('#EXT-X-KEY:')) { const a = attrsOf(line); if (a.METHOD && a.METHOD !== 'NONE') encrypted = true; continue; }
    if (line.startsWith('#EXT-X-MAP:')) {
      const a = attrsOf(line);
      let br = null;
      if (a.BYTERANGE) { const [len, off] = a.BYTERANGE.split('@'); br = { length: parseInt(len, 10), offset: parseInt(off || '0', 10) }; }
      map = { uri: resolve(a.URI, base), byterange: br };
      continue;
    }
    if (line.startsWith('#')) continue;
    const seg = { uri: resolve(line, base), duration: pending || 0 };
    if (range) seg.byterange = range;
    if (discontinuity) seg.discontinuity = true;
    segments.push(seg);
    duration += seg.duration;
    pending = null; range = null; discontinuity = false;
  }
  return { segments, endlist, targetDuration, mediaSequence, encrypted, map, duration };
}

/**
 * The variant a download should take for a quality: 'low' → the smallest, 'hd' → the largest, 'sd' → the
 * largest one not above 960×540 (or the middle one). Redundant backups (same resolution/bandwidth) collapse.
 */
function pickVariant(variants, quality = 'sd') {
  const uniq = [];
  for (const v of variants) if (!uniq.some((u) => u.bandwidth === v.bandwidth && u.height === v.height)) uniq.push(v);
  const sorted = uniq.sort((a, b) => (a.height - b.height) || (a.bandwidth - b.bandwidth));
  if (!sorted.length) return null;
  // 'h720' (0.7): the best variant of that height, else the biggest below it, else the smallest
  const want = /^h(\d{3,4})$/.exec(String(quality));
  if (want) { const fit = sorted.filter((v) => v.height && v.height <= +want[1]); return fit.length ? fit[fit.length - 1] : sorted[0]; }
  if (quality === 'low') return sorted[0];
  if (quality === 'hd') return sorted[sorted.length - 1];
  const sd = sorted.filter((v) => v.height && v.height <= 576);
  return sd.length ? sd[sd.length - 1] : sorted[Math.floor((sorted.length - 1) / 2)];
}

/** The audio rendition for a variant whose audio lives in a separate playlist: German first, then DEFAULT. */
function pickAudio(media, groupId) {
  const list = media.filter((m) => m.type === 'AUDIO' && m.uri && (!groupId || m.groupId === groupId));
  if (!list.length) return null;
  const de = (m) => /^(de|deu|ger)(-|$)/.test(m.language) && !/deskription|klare|description|audiodesc/i.test(m.name);
  return list.find((m) => de(m) && m.default) || list.find(de) || list.find((m) => m.default) || list[0];
}

/**
 * Playlist for a downloaded film: every segment is a byte range of one concatenated file (MPEG-TS or,
 * with an init section, fragmented MP4). hls.js plays it offline, VLC plays the file itself.
 * parts = [{ duration, length }] in file order, init = { length } | null.
 */
function buildByteRangePlaylist(fileName, parts, { init = null, targetDuration } = {}) {
  const td = Math.max(1, Math.ceil(targetDuration || Math.max(1, ...parts.map((p) => p.duration || 0))));
  const out = ['#EXTM3U', '#EXT-X-VERSION:' + (init ? 6 : 4), '#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-TARGETDURATION:' + td, '#EXT-X-MEDIA-SEQUENCE:0'];
  let offset = 0;
  if (init) { out.push(`#EXT-X-MAP:URI="${fileName}",BYTERANGE="${init.length}@0"`); offset = init.length; }
  for (const p of parts) {
    out.push('#EXTINF:' + (p.duration || 0).toFixed(3) + ',');
    out.push(`#EXT-X-BYTERANGE:${p.length}@${offset}`);
    out.push(fileName);
    offset += p.length;
  }
  out.push('#EXT-X-ENDLIST', '');
  return out.join('\n');
}

/** Master playlist for a download with a separate audio file (video.m3u8 + audio.m3u8 next to it). */
function buildLocalMaster({ video, audio, bandwidth, codecs, width, height }) {
  const out = ['#EXTM3U', '#EXT-X-VERSION:4'];
  if (audio) out.push(`#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Deutsch",LANGUAGE="de",DEFAULT=YES,AUTOSELECT=YES,URI="${audio}"`);
  const res = width && height ? `,RESOLUTION=${width}x${height}` : '';
  const cod = codecs ? `,CODECS="${codecs}"` : '';
  out.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth || 1000000}${res}${cod}${audio ? ',AUDIO="aud"' : ''}`, video, '');
  return out.join('\n');
}

module.exports = { isPlaylist, parseAttrs, mapUris, rewrite, parseMaster, parseMedia, pickVariant, pickAudio, buildByteRangePlaylist, buildLocalMaster, resolve };
