// The real picture size of every quality of a film ("1080p", "720p", "540p" …), so that the player and the
// settings can name resolutions instead of "Niedrig / Mittel / Hoch".
//   1. the addresses of the broadcasters, where they name the size reliably (ARD "…_1280x720-50p…", MDR
//      "….avc540.mp4", ZDF "…_3360k_p36v17.mp4", arte "…_MP4-2200_…", NDR ".hd.mp4" …),
//   2. the header of the MP4 file otherwise: a few small Range requests walk the boxes to the video track
//      (tkhd: width and height, hdlr 'vide', stsd: the codec), wherever the moov box sits.
// An HLS playlist stays without a size here: the player reads the levels of a master itself, and only the published
// address is ever requested (no master is guessed next to a variant).
// Results are kept in userData/mediathek/heights.json (keyed by address). Pure functions plus an injected fetch.
'use strict';

const UA = 'CozyShelves/0.7 (Mediathek)';
/** The usual picture heights; a measured class within 2.5 % of one of them takes its name. */
const LADDER = [144, 180, 216, 240, 270, 288, 360, 432, 480, 540, 576, 720, 1080, 1440, 2160];
const STD_WIDTHS = [3840, 2560, 1920, 1280, 1024, 960, 854, 768, 720, 640, 512, 480, 426, 384, 320, 256];

/**
 * The class of a picture: its height, the short side of a portrait video, and for films wider than 16:9 with a
 * standard width (a letterboxed 1920 × 800) the height that width stands for (1080).
 */
function classOf(width, height) {
  const w = Math.round(Number(width) || 0), h = Math.round(Number(height) || 0);
  if (!h) return 0;
  let v = h;
  if (w && w < h) v = w;
  else if (w && w / h > 1.85 && STD_WIDTHS.some((s) => Math.abs(w - s) / s < 0.015)) v = Math.max(h, Math.round(w * 9 / 16));
  return LADDER.find((l) => Math.abs(l - v) / l <= 0.025) || v;
}
const labelOf = (p) => (p ? `${p}p` : '');

// ---- 1. addresses ------------------------------------------------------------------------------------------
const PATTERNS = [
  // width × height in the name: ARD "…_1280x720-50p-3200kbit.mp4", hr, DW "…_AVC_960x540.mp4"
  [/[_\-/.](\d{3,4})x(\d{3,4})(?=[_\-.])/i, (m) => ({ width: +m[1], height: +m[2] })],
  // MDR, KiKA, rbb, SWR, WDR: ".avc360.mp4", "-avc720.mp4", ".avc-1080.mp4", "_AVC-360.mp4"
  [/avc-?(\d{3,4})\.mp4(?:$|[?#])/i, (m) => ({ height: +m[1] })],
  // Radio Bremen: "_360p.mp4", "_576i.mp4", "_1080p.mp4"
  [/_(\d{3,4})[pi]\.mp4(?:$|[?#])/i, (m) => ({ height: +m[1] })],
  // ZDF, 3sat, phoenix, ZDFtivi: "…_3360k_p36v17.mp4" (p11 differs from film to film and is read from the file)
  [/zdf-a\.akamaihd\.net\/.*_\d+k_p(35|36|37)v\d+\.mp4(?:$|[?#])/i, (m) => ({ 35: { width: 1024, height: 576 }, 36: { width: 1280, height: 720 }, 37: { width: 1920, height: 1080 } }[m[1]])],
  // arte: "…_MP4-2200_AMM-PTWEB…"
  [/arteptweb-a\.akamaihd\.net\/.*_MP4-(800|1500|2200)_/i, (m) => ({ 800: { width: 640, height: 360 }, 1500: { width: 720, height: 406 }, 2200: { width: 1280, height: 720 } }[m[1]])],
  // NDR: ".ln.mp4", ".hd.mp4", ".1080.mp4"
  [/ndr-progressive\.ard-mcdn\.de\/.*\.(ln|hd|1080)\.mp4(?:$|[?#])/i, (m) => ({ ln: { width: 640, height: 360 }, hd: { width: 1280, height: 720 }, 1080: { width: 1920, height: 1080 } }[m[1].toLowerCase()])],
  // BR, ARD alpha: "_E.mp4", "_X.mp4", "_HD.mp4"
  [/cdn-storage\.br\.de\/.*_(E|X|HD)\.mp4(?:$|[?#])/, (m) => ({ E: { width: 640, height: 360 }, X: { width: 1280, height: 720 }, HD: { width: 1920, height: 1080 } }[m[1]])],
  // SR: "_N.mp4", "_P.mp4", "_H.mp4"
  [/srstorage\d*-a\.akamaihd\.net\/.*_(N|P|H)\.mp4(?:$|[?#])/, (m) => ({ N: { width: 640, height: 360 }, P: { width: 1280, height: 720 }, H: { width: 1920, height: 1080 } }[m[1]])],
];

/** The size an address names, { width?, height } or null. Only patterns checked against the files themselves. */
function fromUrl(url) {
  const u = String(url || '');
  if (!/^https?:\/\//i.test(u)) return null;
  for (const [re, fn] of PATTERNS) {
    const m = re.exec(u);
    if (!m) continue;
    const v = fn(m);
    if (v && v.height >= 100 && v.height <= 4320) return { ...v };
  }
  return null;
}

// ---- 2. the MP4 header ---------------------------------------------------------------------------------------
/** Box headers inside buf[off, end): [{ type, off, size, hdr }] (size Infinity = to the end of the file). */
function boxes(buf, off, end) {
  const out = [];
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    let hdr = 8;
    if (size === 1) {
      if (off + 16 > end) { out.push({ type, off, size: null, hdr: 16 }); break; }
      size = Number(buf.readBigUInt64BE(off + 8)); hdr = 16;
    } else if (size === 0) size = Infinity;
    out.push({ type, off, size, hdr });
    if (!Number.isFinite(size) || size < hdr) break;
    off += size;
  }
  return out;
}
const child = (buf, box, type) => (box && Number.isFinite(box.size) ? boxes(buf, box.off + box.hdr, Math.min(buf.length, box.off + box.size)).find((b) => b.type === type) : null);

/** A trak box (whole or its first bytes) → { video, width, height, codec } as far as the bytes reach. */
function parseTrak(buf, trak) {
  const out = { video: false, width: 0, height: 0, codec: null };
  const tkhd = child(buf, trak, 'tkhd');
  if (tkhd && tkhd.off + tkhd.size <= buf.length) {
    const p = tkhd.off + tkhd.hdr;
    const base = p + (buf[p] === 1 ? 88 : 76);
    if (base + 8 <= buf.length) { out.width = buf.readUInt32BE(base) / 65536; out.height = buf.readUInt32BE(base + 4) / 65536; }
  }
  const mdia = child(buf, trak, 'mdia');
  const hdlr = child(buf, mdia, 'hdlr');
  if (hdlr && hdlr.off + hdlr.hdr + 12 <= buf.length) out.video = buf.toString('latin1', hdlr.off + hdlr.hdr + 8, hdlr.off + hdlr.hdr + 12) === 'vide';
  else out.video = out.width > 0 && out.height > 0;
  const stsd = child(buf, child(buf, child(buf, mdia, 'minf'), 'stbl'), 'stsd');
  if (stsd && stsd.off + stsd.hdr + 16 <= buf.length) out.codec = buf.toString('latin1', stsd.off + stsd.hdr + 12, stsd.off + stsd.hdr + 16);
  return out;
}

/** mvhd → duration in seconds. */
function parseMvhd(buf, mvhd) {
  if (!mvhd || mvhd.off + mvhd.hdr + 32 > buf.length) return 0;
  const p = mvhd.off + mvhd.hdr;
  const v1 = buf[p] === 1;
  const scale = buf.readUInt32BE(p + (v1 ? 20 : 12));
  const dur = v1 ? Number(buf.readBigUInt64BE(p + 24)) : buf.readUInt32BE(p + 16);
  return scale ? dur / scale : 0;
}

/**
 * Read the picture size of a remote MP4: { width, height, codec, duration, size, requests } or null.
 * fetch(url, init) → Response (Electron net.fetch or a fake). At most `maxRequests` small Range requests.
 */
async function probeMp4(url, { fetch, timeout = 12000, maxRequests = 10, signal } = {}) {
  let requests = 0, total = null;
  async function read(start, length) {
    if (++requests > maxRequests) throw new Error('too many requests');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeout);
    if (signal) signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*', Range: `bytes=${start}-${start + length - 1}` }, redirect: 'follow', signal: ctrl.signal });
      if (!res.ok) { try { await res.body?.cancel(); } catch {} throw new Error('HTTP ' + res.status); }
      const m = /\/(\d+)\s*$/.exec(res.headers.get('content-range') || '');
      if (m) total = +m[1];
      if (res.status === 200) {
        // no Range support: take the first bytes only
        if (start > 0) { try { await res.body?.cancel(); } catch {} throw new Error('no range support'); }
        total = Number(res.headers.get('content-length')) || total;
        const reader = res.body.getReader();
        const chunks = []; let n = 0;
        while (n < length) { const { value, done } = await reader.read(); if (done) break; chunks.push(value); n += value.byteLength; }
        try { await reader.cancel(); } catch {}
        return Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, length);
      }
      return Buffer.from(await res.arrayBuffer());
    } finally { clearTimeout(timer); }
  }
  const head = await read(0, 65536);
  if (head.length < 16 || !/^(ftyp|styp|moov|free|skip|wide|mdat|pdin)$/.test(head.toString('latin1', 4, 8))) return null;
  // the top level: ftyp, free, mdat, moov … in any order; boxes behind the first 64 KB are read one header at a time
  let pos = 0, moov = null;
  for (let guard = 0; guard < 24 && !moov; guard++) {
    let b;
    if (pos + 16 <= head.length) b = boxes(head, pos, head.length)[0];
    else {
      if (total != null && pos >= total) break;
      const h = await read(pos, 16);
      b = boxes(h, 0, h.length)[0];
      if (b) b = { ...b, off: pos };
    }
    if (!b || b.size == null) break;
    if (b.type === 'moov') { moov = b; break; }
    if (!Number.isFinite(b.size)) break;
    pos += b.size;
  }
  if (!moov || !Number.isFinite(moov.size)) return null;
  // the moov box: its start comes from the first read or from one more request
  let buf = head, base = 0;
  if (moov.off + Math.min(moov.size, 4096) > head.length) { buf = await read(moov.off, Math.min(moov.size, 65536)); base = moov.off; }
  const local = (off) => off - base;
  const mbox = { ...moov, off: local(moov.off) };
  const duration = parseMvhd(buf, child(buf, mbox, 'mvhd'));
  // walk the traks: whole ones inside the buffer, the others by their first 4 KB
  let p = mbox.off + mbox.hdr;
  const end = mbox.off + moov.size;
  for (let guard = 0; guard < 64 && p < end; guard++) {
    let b, tb = buf, toff = p;
    if (p + 16 <= buf.length) b = boxes(buf, p, buf.length)[0];
    if (!b || (b.type === 'trak' && p + Math.min(b.size, 4096) > buf.length)) {
      tb = await read(p + base, 4096); toff = 0;
      b = boxes(tb, 0, tb.length)[0];
    }
    if (!b || !Number.isFinite(b.size) || b.size < 8) break;
    if (b.type === 'trak') {
      const t = parseTrak(tb, { ...b, off: toff });
      if (t.video && t.height > 0) return { width: Math.round(t.width), height: Math.round(t.height), codec: t.codec, duration, size: total, requests };
    }
    p += b.size;
  }
  return { width: 0, height: 0, codec: null, duration, size: total, requests };
}

// ---- cache and the combined lookup ---------------------------------------------------------------------------------
/**
 * deps: { fetch, store?: { get(url), set(url, v) } }
 * sizeOf(url) → { width, height, codec } | null      (address pattern, cache or MP4 header)
 */
function createHeights({ fetch, store = null, now = Date.now } = {}) {
  const inflight = new Map();
  async function look(url) {
    const named = fromUrl(url);
    if (named) return { ...named, from: 'url' };
    const hit = store && store.get(url);
    if (hit && hit.height) return { width: hit.width || 0, height: hit.height, codec: hit.codec || null, duration: hit.duration || 0, from: 'cache' };
    let v = null;
    // a playlist names no size of its own (the player reads the levels of a master itself); only addresses that are
    // published are requested, none is put together next to them
    if (!/\.m3u8(\?|$)/i.test(url)) {
      try { const p = await probeMp4(url, { fetch }); if (p && p.height) v = { width: p.width, height: p.height, codec: p.codec, duration: Math.round(p.duration || 0) }; } catch {}
    }
    if (v && store) store.set(url, { ...v, at: now() });
    return v ? { ...v, from: 'probe' } : null;
  }
  function sizeOf(url) {
    if (!/^https?:\/\//i.test(url || '')) return Promise.resolve(null);
    if (inflight.has(url)) return inflight.get(url);
    const p = look(url).finally(() => inflight.delete(url));
    inflight.set(url, p);
    return p;
  }
  /** Heights of every quality of an item: { key: { width, height, p, label, codec } } (unknown keys are left out). */
  async function ofItem(item) {
    const out = {};
    const v = (item && item.video) || {};
    const known = (item && item.heights) || {};
    const keys = Object.keys(v).filter((k) => typeof v[k] === 'string' && v[k]);
    // one master for every quality (live TV, NHK): the player reads its levels itself
    if (keys.length && new Set(keys.map((k) => v[k])).size === 1 && (item.hls || /\.m3u8(\?|$)/i.test(v[keys[0]]))) return out;
    await Promise.all(keys.map(async (k) => {
      if (known[k] && known[k].height) { out[k] = { ...known[k], p: known[k].p || classOf(known[k].width, known[k].height) }; return; }
      const s = await sizeOf(v[k]).catch(() => null);
      if (s && s.height) out[k] = { width: s.width || 0, height: s.height, codec: s.codec || null, duration: s.duration || 0, p: classOf(s.width, s.height) };
    }));
    for (const k of Object.keys(out)) out[k].label = labelOf(out[k].p);
    return out;
  }
  return { sizeOf, ofItem };
}

/** A small JSON cache for createHeights ({ get, set }); at most `max` addresses, the oldest go first. */
function createHeightStore(file, { max = 4000 } = {}) {
  const { Store } = require('../store');
  const store = new Store(file, { sizes: {} });
  const data = store.get();
  if (!data.sizes || typeof data.sizes !== 'object') data.sizes = {};
  return {
    get: (url) => data.sizes[url] || null,
    set(url, v) {
      data.sizes[url] = v;
      const keys = Object.keys(data.sizes);
      if (keys.length > max) { keys.sort((a, b) => (data.sizes[a].at || 0) - (data.sizes[b].at || 0)); for (const k of keys.slice(0, keys.length - max)) delete data.sizes[k]; }
      store.save();
    },
    flush: () => store.flush(),
  };
}

module.exports = { classOf, labelOf, fromUrl, probeMp4, boxes, parseTrak, createHeights, createHeightStore, LADDER };
