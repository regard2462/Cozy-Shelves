// Downloads of the Mediathek (main process).
//   MP4: streamed into "<name>.mp4.part", resumed with a Range request, renamed when complete.
//   HLS: the playlist of the chosen quality (plus the German audio rendition when the audio is separate)
//        is fetched segment by segment into one file per track ("<name>.ts", MPEG-TS or fragmented MP4);
//        a byte-range playlist "<name>.m3u8" next to it lets hls.js play the film offline through
//        media://local, other players (VLC …) open the .ts file itself.
//   Subtitles are saved as "<name>.vtt". The index lives in userData/mediathek/downloads.json; downloads
//   that were running when the app closed are "unterbrochen" after a restart and can be resumed.
// Progress: broadcast('mediathek:download', entry) at most every 300 ms per download.
// Qualities (0.7): any key of item.video (low, sd, hd of MediathekViewWeb, the sizes of an English-language source), or
// 'h<height>' for a film that is one HLS master (NHK): then the variant of that height is saved. options(item) lists
// them with their real picture sizes and file sizes.
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const playlist = require('./playlist');
const errors = require('./errors');
const { toVtt } = require('./subtitles');
const { Store } = require('../store');

const UA = 'CozyShelves/0.3 (Mediathek)';
const PROGRESS_MS = 300;
const INACTIVITY = 45000;
const CONNECT_TIMEOUT = 30000;
const MAX_PARALLEL = 2;
const RETRIES = 3;
const QUALITIES = ['low', 'sd', 'hd'];
const keysOf = (item) => Object.keys((item && item.video) || {}).filter((k) => typeof item.video[k] === 'string' && item.video[k]);
/** One HLS master for every quality key (NHK, live TV): its variants are the qualities. */
const singleMaster = (item) => { const ks = keysOf(item); return ks.length > 0 && new Set(ks.map((k) => item.video[k])).size === 1 && (!!item.hls || /\.m3u8(\?|$)/i.test(item.video[ks[0]])); };

/** A title as a Windows file name: "20:00" becomes "20.00", "?" and "*" go, other forbidden characters become spaces. */
function sanitize(s) {
  return String(s || '').normalize('NFC')
    .replace(/(\d):(\d)/g, '$1.$2')
    .replace(/[?*"<>]+/g, '')
    .replace(/[:/\\|\x00-\x1f]+/g, ' ')
    .replace(/\s+([!,.;])/g, '$1')
    .replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '').trim();
}
const pad2 = (n) => String(n).padStart(2, '0');
/** "Tatort · Schlafende Hunde (ARD, 21.09.2026)", without the topic when the title already contains it. */
function baseName(item, channelName = (c) => c) {
  const d = item.timestamp ? new Date(item.timestamp) : null;
  // a film that only knows its year (Internet Archive) is named by the year
  const date = item.year ? String(item.year) : d ? `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}` : '';
  let title = sanitize(item.title) || 'Sendung';
  const topic = sanitize(item.topic);
  if (topic && !title.toLowerCase().includes(topic.toLowerCase())) title = `${topic} · ${title}`;
  if (title.length > 120) title = title.slice(0, 120).replace(/\s+\S*$/, '');
  const tail = [sanitize(channelName(item.channel)), date].filter(Boolean).join(', ');
  return tail ? `${title} (${tail})` : title;
}
const jobId = (item, quality) => crypto.createHash('sha1').update(`${item.id}|${quality}`).digest('hex').slice(0, 16);

class HttpError extends Error {
  constructor(status, url, finalUrl) { super('HTTP ' + status); this.status = status; this.url = url; this.finalUrl = finalUrl; }
}
/** A German sentence (and the kind) for whatever went wrong. */
function describe(e) {
  if (e && e.kind) return { kind: e.kind, message: e.message };
  if (e instanceof HttpError) { const kind = errors.classify({ status: e.status, url: e.url, finalUrl: e.finalUrl }); return { kind, message: errors.message(kind) }; }
  const msg = String(e && e.message || e || '');
  if (/Zeitüberschreitung|timeout/i.test(msg)) return { kind: 'offline', message: 'Die Verbindung zum Sender wurde unterbrochen. Der Download lässt sich fortsetzen.' };
  if (/ENOSPC/i.test(msg)) return { kind: 'disk', message: 'Auf dem Laufwerk ist nicht genug Platz.' };
  if (/EACCES|EPERM/i.test(msg)) return { kind: 'disk', message: 'In den Download-Ordner darf nicht geschrieben werden.' };
  const kind = errors.classify({ status: 0, error: msg });
  return { kind, message: kind === 'unknown' ? (msg || errors.message('unknown')) : errors.message(kind) };
}
const fail = (kind, message) => Object.assign(new Error(message || errors.message(kind)), { kind });

function createDownloads({ fetch, fetchPlaylist = null, indexFile, folder, broadcast = () => {}, trusted = (x) => x, channelName, lfileUrl = null, onRoot = () => {} }) {
  const store = new Store(indexFile, { downloads: [] });
  const data = store.get();
  if (!Array.isArray(data.downloads)) data.downloads = [];
  const running = new Map();   // id → { ctrl }
  const lastEmit = new Map();

  // downloads that were running when the app closed
  for (const d of data.downloads) {
    if (d.status === 'running' || d.status === 'queued') { d.status = 'paused'; d.error = 'Unterbrochen, als Cozy Shelves beendet wurde.'; }
    if (d.dir) onRoot(d.dir);
  }
  store.save();

  const find = (id) => data.downloads.find((d) => d.id === id);
  function view(d) {
    const fraction = d.kind === 'hls' ? (d.segTotal ? (d.segDone || 0) / d.segTotal : 0) : (d.total ? d.bytes / d.total : 0);
    return {
      id: d.id, item: d.item, quality: d.quality, height: d.height || null, kind: d.kind, status: d.status, error: d.error || null, errorKind: d.errorKind || null,
      bytes: d.bytes || 0, total: d.total || null, fraction: d.status === 'done' ? 1 : Math.max(0, Math.min(1, fraction)), speed: d.speed || 0,
      file: d.file, dir: d.dir, subtitle: d.subtitle || null, createdAt: d.createdAt, finishedAt: d.finishedAt || null,
    };
  }
  function emit(d, force) {
    const now = Date.now();
    if (!force && now - (lastEmit.get(d.id) || 0) < PROGRESS_MS) return;
    lastEmit.set(d.id, now);
    try { broadcast('mediathek:download', view(d)); } catch {}
  }
  const persist = () => store.save();

  async function request(url, { headers = {}, signal, method = 'GET' } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('Zeitüberschreitung')), CONNECT_TIMEOUT);
    const onAbort = () => ctrl.abort(signal.reason);
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    try {
      const res = await fetch(url, { method, headers: { 'User-Agent': UA, Accept: '*/*', ...headers }, redirect: 'follow', signal: ctrl.signal });
      if (/geoprotection/i.test(res.url || '')) { try { await res.body?.cancel(); } catch {} throw new HttpError(451, url, res.url); }
      return res;
    } finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); }
  }
  async function text(url, signal) {
    // playlists come with the address they finally came from (relative segment addresses depend on it)
    if (fetchPlaylist) {
      const r = await fetchPlaylist(url, { signal });
      if (r.geo) throw new HttpError(451, url, r.url);
      if (r.status < 200 || r.status >= 300) throw new HttpError(r.status, url, r.url);
      return { text: r.text, url: r.url || url };
    }
    const res = await request(url, { signal });
    if (!res.ok) { try { await res.body?.cancel(); } catch {} throw new HttpError(res.status, url, res.url); }
    return { text: await res.text(), url: res.url || url };
  }

  /** Stream a response body into an open file handle; resets the inactivity timer on every chunk. */
  async function pump(res, fh, d, signal, onChunk) {
    const reader = res.body.getReader();
    let idle = null, timedOut = false;
    const bump = () => { clearTimeout(idle); idle = setTimeout(() => { timedOut = true; reader.cancel(new Error('Zeitüberschreitung')).catch(() => {}); }, INACTIVITY); };
    const onAbort = () => reader.cancel(signal.reason).catch(() => {});
    signal.addEventListener('abort', onAbort, { once: true });
    let written = 0;
    try {
      bump();
      for (;;) {
        const { value, done } = await reader.read();
        if (signal.aborted) throw signal.reason || new Error('Abgebrochen');
        if (timedOut) throw new Error('Zeitüberschreitung');
        if (done) break;
        bump();
        await fh.write(value);
        written += value.byteLength;
        onChunk(value.byteLength);
      }
    } finally { clearTimeout(idle); signal.removeEventListener('abort', onAbort); }
    if (signal.aborted) throw signal.reason || new Error('Abgebrochen');
    return written;
  }

  function speedMeter(d) {
    const samples = [];
    return (n) => {
      const t = Date.now();
      samples.push([t, n]);
      while (samples.length > 1 && t - samples[0][0] > 4000) samples.shift();
      const span = (t - samples[0][0]) / 1000;
      d.speed = span > 0.5 ? Math.round(samples.reduce((s, x) => s + x[1], 0) / span) : d.speed || 0;
    };
  }

  // ---- MP4 ------------------------------------------------------------------------------------------
  async function runMp4(d, signal) {
    const url = d.url;
    const part = d.file + '.part';
    let have = 0;
    try { have = fs.statSync(part).size; } catch {}
    let res = await request(url, { headers: have > 0 ? { Range: `bytes=${have}-` } : {}, signal });
    if (res.status === 416 && have > 0) {
      // the part may already be complete: ask for the size
      try { await res.body?.cancel(); } catch {}
      const head = await request(url, { headers: { Range: 'bytes=0-0' }, signal });
      const total = parseTotal(head.headers.get('content-range'));
      try { await head.body?.cancel(); } catch {}
      if (total && total === have) { d.total = total; d.bytes = have; return finishFile(d, part); }
      have = 0;
      res = await request(url, { signal });
    }
    if (!res.ok) { try { await res.body?.cancel(); } catch {} throw new HttpError(res.status, url, res.url); }
    let append = false;
    if (res.status === 206) {
      const cr = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(res.headers.get('content-range') || '');
      if (cr && +cr[1] === have) { append = true; d.total = cr[3] === '*' ? null : +cr[3]; }
      else { try { await res.body?.cancel(); } catch {} have = 0; res = await request(url, { signal }); if (!res.ok) throw new HttpError(res.status, url, res.url); d.total = Number(res.headers.get('content-length')) || null; }
    } else d.total = Number(res.headers.get('content-length')) || null;
    const ct = res.headers.get('content-type') || '';
    if (/text\/html/i.test(ct)) { try { await res.body?.cancel(); } catch {} throw fail('gone', 'Der Sender hat statt des Films eine Webseite geliefert. Die Sendung ist vermutlich nicht mehr verfügbar.'); }
    d.bytes = append ? have : 0;
    const fh = await fsp.open(part, append ? 'a' : 'w');
    const meter = speedMeter(d);
    try {
      await pump(res, fh, d, signal, (n) => { d.bytes += n; meter(n); emit(d); });
    } finally { await fh.close(); }
    if (d.total && d.bytes < d.total) throw fail('offline', 'Die Verbindung wurde unterbrochen, bevor der Film vollständig war. Der Download lässt sich fortsetzen.');
    if (!d.total) d.total = d.bytes;
    return finishFile(d, part);
  }
  const parseTotal = (cr) => { const m = /\/(\d+)\s*$/.exec(cr || ''); return m ? +m[1] : null; };
  function finishFile(d, part) {
    try { fs.unlinkSync(d.file); } catch {}
    fs.renameSync(part, d.file);
  }

  // ---- HLS ------------------------------------------------------------------------------------------
  /** Fetch one track (video or separate audio) into `<file>.part`, resuming after `st.segDone` segments. */
  async function fetchTrack(d, st, media, file, signal, meter) {
    const part = file + '.part';
    const expected = (st.initLength || 0) + st.parts.reduce((s, p) => s + p.length, 0);
    let size = -1;
    try { size = fs.statSync(part).size; } catch {}
    if (size < expected) { d.bytes -= expected; d.segDone -= st.segDone; st.segDone = 0; st.parts = []; st.initLength = 0; }
    const fh = await fsp.open(part, st.segDone > 0 ? 'r+' : 'w');
    try {
      if (st.segDone > 0) await fh.truncate(expected);
      let pos = st.segDone > 0 ? expected : 0;
      if (media.map && !st.initLength) {
        const headers = media.map.byterange ? { Range: `bytes=${media.map.byterange.offset}-${media.map.byterange.offset + media.map.byterange.length - 1}` } : {};
        const buf = await fetchBuffer(media.map.uri, headers, signal);
        await fh.write(buf, 0, buf.length, pos);
        pos += buf.length; st.initLength = buf.length; d.bytes += buf.length;
      }
      for (let i = st.segDone; i < media.segments.length; i++) {
        const seg = media.segments[i];
        const headers = seg.byterange ? { Range: `bytes=${seg.byterange.offset}-${seg.byterange.offset + seg.byterange.length - 1}` } : {};
        const buf = await fetchBuffer(seg.uri, headers, signal);
        await fh.write(buf, 0, buf.length, pos);
        pos += buf.length;
        st.parts.push({ duration: seg.duration, length: buf.length });
        st.segDone = i + 1;
        d.bytes += buf.length;
        d.segDone = (d.segDone || 0) + 1;
        meter(buf.length);
        emit(d);
        if (i % 10 === 9) persist();
      }
    } finally { await fh.close(); }
  }
  async function fetchBuffer(url, headers, signal) {
    let lastErr;
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      if (signal.aborted) throw signal.reason || new Error('Abgebrochen');
      try {
        const res = await request(url, { headers, signal });
        if (!res.ok) { try { await res.body?.cancel(); } catch {} throw new HttpError(res.status, url, res.url); }
        return Buffer.from(await res.arrayBuffer());
      } catch (e) {
        lastErr = e;
        if (signal.aborted || (e instanceof HttpError && e.status >= 400 && e.status < 500)) throw e;
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      }
    }
    throw lastErr;
  }
  const extOf = (media) => {
    if (media.map) return '.mp4';
    const u = (media.segments[0] && media.segments[0].uri) || '';
    if (/\.aac(\?|$)/i.test(u)) return '.aac';
    if (/\.(m4s|mp4|m4a|cmfv|cmfa)(\?|$)/i.test(u)) return '.mp4';
    return '.ts';
  };

  async function runHls(d, signal) {
    d.hls = d.hls || {};
    const h = d.hls;
    if (!h.videoUrl) {
      const master = await text(d.url, signal);
      if (!playlist.isPlaylist(master.text)) throw fail('format');
      const m = playlist.parseMaster(master.text, master.url);
      if (m.isMaster) {
        const v = playlist.pickVariant(m.variants, d.quality);
        if (!v) throw fail('format');
        h.videoUrl = v.uri;
        const aud = v.audio ? playlist.pickAudio(m.media, v.audio) : null;
        if (aud && aud.uri) h.audioUrl = aud.uri;
        h.info = { bandwidth: v.bandwidth, codecs: v.codecs, width: v.width, height: v.height };
      } else h.videoUrl = master.url;
    }
    const videoPl = await text(h.videoUrl, signal);
    const video = playlist.parseMedia(videoPl.text, videoPl.url);
    if (!video.endlist) throw fail('live');
    if (video.encrypted) throw fail('encrypted');
    if (!video.segments.length) throw fail('format');
    let audio = null;
    if (h.audioUrl) {
      const a = await text(h.audioUrl, signal);
      audio = playlist.parseMedia(a.text, a.url);
      if (audio.encrypted) throw fail('encrypted');
      if (!audio.segments.length) audio = null;
    }
    d.segTotal = video.segments.length + (audio ? audio.segments.length : 0);
    h.video = h.video || { segDone: 0, parts: [], initLength: 0 };
    if (audio) h.audio = h.audio || { segDone: 0, parts: [], initLength: 0 };
    d.segDone = h.video.segDone + (h.audio ? h.audio.segDone : 0);
    d.bytes = [h.video, h.audio].filter(Boolean).reduce((s, t) => s + (t.initLength || 0) + t.parts.reduce((x, p) => x + p.length, 0), 0);
    const vExt = extOf(video);
    const vFile = path.join(d.dir, d.base + vExt);
    d.file = vFile;
    const meter = speedMeter(d);
    await fetchTrack(d, h.video, video, vFile, signal, meter);
    let aFile = null;
    if (audio) {
      aFile = path.join(d.dir, d.base + '.audio' + extOf(audio));
      await fetchTrack(d, h.audio, audio, aFile, signal, meter);
    }
    // finish: rename the parts, write the byte-range playlists
    finishFile({ file: vFile }, vFile + '.part');
    if (aFile) finishFile({ file: aFile }, aFile + '.part');
    // URIs inside a playlist are URL-encoded (titles contain spaces, "%", "#" …)
    const vName = encodeURIComponent(path.basename(vFile));
    const vList = playlist.buildByteRangePlaylist(vName, h.video.parts, { init: h.video.initLength ? { length: h.video.initLength } : null, targetDuration: video.targetDuration });
    const main = path.join(d.dir, d.base + '.m3u8');
    if (aFile) {
      const aList = playlist.buildByteRangePlaylist(encodeURIComponent(path.basename(aFile)), h.audio.parts, { init: h.audio.initLength ? { length: h.audio.initLength } : null, targetDuration: audio.targetDuration });
      fs.writeFileSync(path.join(d.dir, d.base + '.video.m3u8'), vList);
      fs.writeFileSync(path.join(d.dir, d.base + '.audio.m3u8'), aList);
      fs.writeFileSync(main, playlist.buildLocalMaster({ video: encodeURIComponent(d.base + '.video.m3u8'), audio: encodeURIComponent(d.base + '.audio.m3u8'), ...(h.info || {}) }));
    } else fs.writeFileSync(main, vList);
    d.playlist = main;
    d.total = d.bytes;
  }

  // ---- common ---------------------------------------------------------------------------------------
  async function fetchSubtitle(d, signal) {
    if (!d.item.subtitle || d.subtitle) return;
    try {
      const { text: t } = await text(d.item.subtitle, signal);
      const file = path.join(d.dir, d.base + '.vtt');
      fs.writeFileSync(file, toVtt(t));
      d.subtitle = file;
    } catch (e) { console.warn('[mediathek] Untertitel nicht gespeichert:', e.message); }
  }

  async function run(d) {
    const ctrl = new AbortController();
    running.set(d.id, { ctrl });
    d.status = 'running'; d.error = null; d.errorKind = null; d.speed = 0;
    emit(d, true); persist();
    try {
      fs.mkdirSync(d.dir, { recursive: true });
      if (d.kind === 'hls') await runHls(d, ctrl.signal);
      else await runMp4(d, ctrl.signal);
      await fetchSubtitle(d, ctrl.signal);
      d.status = 'done'; d.finishedAt = Date.now(); d.speed = 0;
      try { d.size = fs.statSync(d.file).size; } catch {}
    } catch (e) {
      if (ctrl.signal.aborted && ctrl.signal.reason && ctrl.signal.reason.pause) { d.status = 'paused'; d.error = null; }
      else if (ctrl.signal.aborted && ctrl.signal.reason && ctrl.signal.reason.remove) { running.delete(d.id); return; }
      else { const x = describe(e); d.status = 'error'; d.error = x.message; d.errorKind = x.kind; }
      d.speed = 0;
    } finally {
      running.delete(d.id);
    }
    emit(d, true); persist();
    pumpQueue();
  }

  function pumpQueue() {
    for (const d of data.downloads) {
      if (running.size >= MAX_PARALLEL) break;
      if (d.status === 'queued' && !running.has(d.id)) run(d);
    }
  }

  /** Start (or resume) a download. quality: a key of item.video ('low' | 'sd' | 'hd', 'h720' …) or 'h<height>' for a
   *  film that is one HLS master. */
  function start(rawItem, quality = 'sd') {
    const item = trusted(rawItem);
    if (!item) throw fail('forbidden', 'Diese Sendung kann nicht heruntergeladen werden.');
    if (item.live) throw fail('live');
    const keys = keysOf(item);
    let q, url;
    if (keys.includes(quality)) { q = quality; url = item.video[q]; }
    else if (/^h\d{3,4}$/.test(String(quality)) && singleMaster(item)) { q = quality; url = item.video[keys[0]]; }
    else { q = keys.includes('sd') ? 'sd' : keys[0]; url = q && item.video[q]; }
    if (!url) throw fail('gone');
    const height = (item.heights && item.heights[q] && (item.heights[q].p || item.heights[q].height)) || (/^h(\d{3,4})$/.exec(q) || [])[1] || null;
    const id = jobId(item, q);
    let d = find(id);
    // a finished download whose file was deleted in the meantime starts over in the current folder
    if (d && d.status === 'done' && !fs.existsSync(d.file)) { data.downloads = data.downloads.filter((x) => x !== d); d = null; }
    if (d) {
      if (d.status === 'done' || running.has(id)) return view(d);
      d.status = 'queued'; d.error = null;
    } else {
      const dir = folder();
      fs.mkdirSync(dir, { recursive: true });
      onRoot(dir);
      let base = baseName(item, channelName), n = 2;
      while (data.downloads.some((x) => x.dir === dir && x.base === base) || fs.existsSync(path.join(dir, base + '.mp4')) || fs.existsSync(path.join(dir, base + '.ts'))) base = `${baseName(item, channelName)} ${n++}`;
      d = { id, item, quality: q, height: height ? Number(height) : null, url, kind: item.hls || /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'mp4', status: 'queued', dir, base, file: path.join(dir, base + '.mp4'), bytes: 0, total: null, createdAt: Date.now() };
      data.downloads.unshift(d);
    }
    emit(d, true); persist();
    pumpQueue();
    return view(d);
  }

  function pause(id) {
    const r = running.get(id);
    if (r) { r.ctrl.abort(Object.assign(new Error('Angehalten'), { pause: true })); return true; }
    const d = find(id);
    if (d && d.status === 'queued') { d.status = 'paused'; emit(d, true); persist(); return true; }
    return false;
  }
  function resume(id) {
    const d = find(id);
    if (!d || running.has(id) || d.status === 'done') return false;
    d.status = 'queued'; d.error = null;
    emit(d, true); persist(); pumpQueue();
    return true;
  }
  /** Remove a download from the list; with files: true the film, playlists, parts and subtitles go too. */
  function remove(id, { files = true } = {}) {
    const d = find(id);
    if (!d) return false;
    const r = running.get(id);
    if (r) r.ctrl.abort(Object.assign(new Error('Entfernt'), { remove: true }));
    if (files) {
      const names = fs.existsSync(d.dir) ? fs.readdirSync(d.dir).filter((f) => f === d.base + '.vtt' || f.startsWith(d.base + '.')) : [];
      for (const f of names) {
        // only files of exactly this download: "<base>.<ext>" or "<base>.<track>.<ext>[.part]"
        if (!/^(\.(video|audio))?\.(mp4|ts|aac|m3u8|vtt)(\.part)?$/i.test(f.slice(d.base.length))) continue;
        try { fs.unlinkSync(path.join(d.dir, f)); } catch {}
      }
    }
    data.downloads = data.downloads.filter((x) => x.id !== id);
    persist();
    try { broadcast('mediathek:download', { id, removed: true }); } catch {}
    return true;
  }

  /** What the player needs to play a finished download offline. */
  function playable(id) {
    const d = find(id);
    if (!d || d.status !== 'done') return null;
    if (!fs.existsSync(d.file)) return { missing: true };
    const sub = d.subtitle && fs.existsSync(d.subtitle) && lfileUrl ? lfileUrl(d.subtitle) : null;
    if (d.kind === 'hls') return { src: `media://local/${Buffer.from(d.playlist, 'utf8').toString('base64url')}/${encodeURIComponent(path.basename(d.playlist))}`, hls: true, subtitleUrl: sub, local: true };
    return { src: lfileUrl ? lfileUrl(d.file) : null, hls: false, subtitleUrl: sub, local: true };
  }

  /** Sizes of the qualities in bytes (MP4: Range request, HLS: bandwidth × duration when a master exists). */
  const sizeCache = new Map();
  async function sizes(rawItem) {
    const item = trusted(rawItem);
    if (!item) return {};
    const out = {};
    await Promise.all(keysOf(item).map(async (q) => {
      const url = item.video[q];
      if (!url) return;
      if (sizeCache.has(url)) { out[q] = sizeCache.get(url); return; }
      try {
        if (item.hls) {
          const ctrl = new AbortController();
          const m = await text(url, ctrl.signal);
          const pm = playlist.parseMaster(m.text, m.url);
          if (pm.isMaster) { const v = playlist.pickVariant(pm.variants, q); if (v && v.bandwidth && item.duration) out[q] = Math.round(v.bandwidth / 8 * item.duration); }
        } else {
          const res = await request(url, { headers: { Range: 'bytes=0-0' } });
          const total = parseTotal(res.headers.get('content-range')) || (res.status === 200 ? Number(res.headers.get('content-length')) || null : null);
          try { await res.body?.cancel(); } catch {}
          if (res.ok && total) out[q] = total;
          else if (!res.ok) out[q] = { error: errors.classify({ status: res.status, url, finalUrl: res.url }) };
        }
        if (out[q] != null) sizeCache.set(url, out[q]);
      } catch {}
    }));
    return out;
  }

  /**
   * What the download menu offers: [{ quality, height, width, bytes, error }], biggest picture first. A film that is one
   * HLS master offers its variants ('h<height>', bandwidth × duration); every other key its file (with `heightsOf`, the
   * picture sizes of heights.js).
   */
  async function options(rawItem, heightsOf = null) {
    const item = trusted(rawItem);
    if (!item) return [];
    if (singleMaster(item)) {
      const url = item.video[keysOf(item)[0]];
      try {
        const m = await text(url, new AbortController().signal);
        const pm = playlist.parseMaster(m.text, m.url);
        const byHeight = new Map();
        for (const v of pm.variants) if (v.height && (!byHeight.has(v.height) || byHeight.get(v.height).bandwidth < v.bandwidth)) byHeight.set(v.height, v);
        return [...byHeight.values()].sort((a, b) => b.height - a.height)
          .map((v) => ({ quality: 'h' + v.height, height: v.height, width: v.width, bytes: v.bandwidth && item.duration ? Math.round(v.bandwidth / 8 * item.duration) : null }));
      } catch { return keysOf(item).slice(0, 1).map((q) => ({ quality: q, height: null, width: null, bytes: null })); }
    }
    const [bytes, hs] = await Promise.all([sizes(item), heightsOf ? heightsOf(item).catch(() => ({})) : Promise.resolve({})]);
    const RANK = { low: 0, sd: 1, hd: 2 };
    return keysOf(item).map((q) => {
      const h = hs[q] || (item.heights && item.heights[q]) || null;
      const b = bytes[q];
      return { quality: q, height: h ? (h.p || h.height) : null, width: h ? h.width : null, bytes: typeof b === 'number' ? b : null, error: b && b.error ? b.error : null };
    }).sort((a, b) => ((b.height || 0) - (a.height || 0)) || ((b.bytes || 0) - (a.bytes || 0)) || ((RANK[b.quality] ?? 0) - (RANK[a.quality] ?? 0)));
  }

  function shutdown() {
    for (const [id, r] of running) { const d = find(id); if (d) { d.status = 'paused'; d.error = 'Unterbrochen, als Cozy Shelves beendet wurde.'; } r.ctrl.abort(Object.assign(new Error('Beendet'), { pause: true })); }
    store.flush();
  }

  return {
    list: () => data.downloads.map(view),
    start, pause, resume, remove, playable, sizes, options, shutdown,
    flush: () => store.flush(),
    roots: () => [...new Set(data.downloads.map((d) => d.dir).filter(Boolean))],
    items: () => data.downloads.map((d) => d.item),
    get: (id) => { const d = find(id); return d ? view(d) : null; },
  };
}

module.exports = { createDownloads, baseName, sanitize, describe };
