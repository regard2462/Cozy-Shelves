// Preview images for the cards. MediathekViewWeb has none, so the programme page of the broadcaster
// (url_website) is read up to </head> (at most 256 KB) and its og:image / twitter:image / JSON-LD
// thumbnail is taken. arte pages carry theirs far behind the head, their player API is asked instead.
// Images are scaled to 640 px JPEG and cached in userData/mediathek/thumbs (misses for three days).
// The English-language sources name their pictures directly (image(url)); those skip the programme page.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HEAD_LIMIT = 256 * 1024;
const IMAGE_LIMIT = 6 * 1024 * 1024;
const MISS_TTL = 3 * 864e5;
const CONCURRENCY = 4;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const ENT = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (a, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] || a))
  .replace(/\\u0026/g, '&').replace(/\\\//g, '/');
const abs = (u, base) => { try { const x = new URL(decode(u).trim(), base); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };
/** Placeholder images some sites return for missing pages. */
const GENERIC = /sharing-icon|default[-_]?(?:share|og)|placeholder|fallback/i;
const EXT_TYPES = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

/** The preview image named in an HTML head (og:image, twitter:image, image_src, JSON-LD). */
function extractImage(html, baseUrl) {
  const s = String(html || '');
  const metas = s.match(/<meta\b[^>]*>/gi) || [];
  const pick = (names) => {
    for (const name of names) {
      for (const m of metas) {
        const key = (/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(m) || [])[1];
        if (!key || key.toLowerCase() !== name) continue;
        const content = (/\bcontent\s*=\s*"([^"]*)"/i.exec(m) || /\bcontent\s*=\s*'([^']*)'/i.exec(m) || [])[1];
        const u = content && abs(content, baseUrl);
        if (u && !GENERIC.test(u)) return u;
      }
    }
    return null;
  };
  let url = pick(['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src', 'thumbnailurl', 'image']);
  if (!url) { const m = /<link\b[^>]*rel=["']image_src["'][^>]*>/i.exec(s); const href = m && (/href=["']([^"']+)["']/i.exec(m[0]) || [])[1]; url = href ? abs(href, baseUrl) : null; }
  if (!url) {
    const m = /"thumbnailUrl"\s*:\s*\[?\s*"([^"]+)"/.exec(s) || /"image"\s*:\s*\{[^{}]*"url"\s*:\s*"([^"]+)"/.exec(s) || /"image"\s*:\s*"(https?:[^"]+)"/.exec(s);
    url = m ? abs(m[1], baseUrl) : null;
  }
  return url && !GENERIC.test(url) ? url : null;
}

/** Ask the image services of the broadcasters for a smaller rendition (fewer bytes to fetch). */
function sizedImage(url) {
  let u = String(url);
  if (/ardmediathek\.de\/img\?/.test(u)) u = u.replace(/imwidth=\d+/, 'imwidth=640');
  else if (/(?:zdf|3sat|zdfheute)\.de\/assets\//.test(u)) u = u.replace(/~\d+x\d+/, '~768x432');
  else if (/epg-image\.zdf\.de/.test(u)) u = u.replace(/layout=\d+x\d+/, 'layout=768x432');
  else if (/api-cdn\.arte\.tv\/img\/v2\/image\//.test(u)) u = u.replace(/\/\d+x\d+(\?|$)/, '/640x360$1');
  return u;
}

const arteProgramId = (url) => (/arte\.tv\/(\w\w)\/videos\/(\d{6}-\d{3}-[A-Z])/.exec(String(url || '')) || []).slice(1);

/** Read a response body until </head> or `limit` bytes, then cancel the rest. */
async function readHead(res, limit = HEAD_LIMIT) {
  if (!res.body || !res.body.getReader) return (await res.text()).slice(0, limit);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let text = '', bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      text += dec.decode(value, { stream: true });
      if (/<\/head>/i.test(text) || bytes >= limit) break;
    }
  } finally { try { await reader.cancel(); } catch {} }
  return text;
}

async function readCapped(res, limit) {
  const len = Number(res.headers.get('content-length')) || 0;
  if (len > limit) throw new Error('Bild zu groß');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > limit) throw new Error('Bild zu groß');
  return buf;
}

/**
 * deps: { fetch, dir, isWebsite(url) → bool (only pages of Mediathek results), isImage(url) → bool (pictures named by
 * a source), resize(buf) → jpeg Buffer|null }
 * thumb(website) / image(url) → Promise<{ file, type } | null>
 */
function createThumbs({ fetch, dir, isWebsite = () => true, isImage = () => false, resize = null, now = Date.now, timeout = 12000 } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const inflight = new Map();
  let running = 0;
  const queue = [];
  const slot = () => new Promise((r) => { if (running < CONCURRENCY) { running++; r(); } else queue.push(r); });
  const release = () => { const n = queue.shift(); if (n) n(); else running--; };
  const keyOf = (url) => crypto.createHash('sha1').update(String(url)).digest('hex');

  async function get(url, init = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeout);
    try { return await fetch(url, { ...init, signal: ctrl.signal, headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'de-DE,de;q=0.9', ...(init.headers || {}) } }); }
    finally { clearTimeout(timer); }
  }

  async function imageUrlFor(website) {
    const [lang, pid] = arteProgramId(website);
    if (pid) {
      try {
        const res = await get(`https://api.arte.tv/api/player/v2/config/${lang || 'de'}/${pid}`, { headers: { Accept: 'application/json' } });
        if (res.ok) { const j = await res.json(); const img = j && j.data && j.data.attributes && j.data.attributes.metadata && j.data.attributes.metadata.images && j.data.attributes.metadata.images[0]; if (img && img.url) return img.url; }
      } catch {}
    }
    const res = await get(website, { headers: { Accept: 'text/html,application/xhtml+xml' } });
    if (!res.ok) { try { await res.body?.cancel?.(); } catch {} return null; }
    const html = await readHead(res);
    return extractImage(html, res.url || website);
  }

  async function resolve(website, direct = false) {
    const key = keyOf(website);
    const file = path.join(dir, key + '.jpg'), miss = path.join(dir, key + '.none');
    for (const [ext, type] of Object.entries(EXT_TYPES)) {
      const f = path.join(dir, key + ext);
      if (fs.existsSync(f)) { try { const t = new Date(); fs.utimesSync(f, t, t); } catch {} return { file: f, type }; }
    }
    try { if (now() - fs.statSync(miss).mtimeMs < MISS_TTL) return null; } catch {}
    await slot();
    try {
      const imgUrl = direct ? website : await imageUrlFor(website);
      if (!imgUrl) { fs.writeFileSync(miss, ''); return null; }
      let res = await get(sizedImage(imgUrl), { headers: { Accept: 'image/jpeg,image/png;q=0.9,image/*;q=0.5' } });
      if (!res.ok && sizedImage(imgUrl) !== imgUrl) res = await get(imgUrl, { headers: { Accept: 'image/jpeg,image/png;q=0.9,image/*;q=0.5' } });
      if (!res.ok || !/^image\//i.test(res.headers.get('content-type') || '')) { fs.writeFileSync(miss, ''); return null; }
      const buf = await readCapped(res, IMAGE_LIMIT);
      const jpeg = resize ? resize(buf) : null;
      if (jpeg && jpeg.length > 500) { fs.writeFileSync(file, jpeg); return { file, type: 'image/jpeg' }; }
      const type = sniffType(buf);
      if (!type) { fs.writeFileSync(miss, ''); return null; }
      const other = path.join(dir, key + Object.keys(EXT_TYPES).find((x) => EXT_TYPES[x] === type));
      fs.writeFileSync(other, buf);
      return { file: other, type };
    } catch (e) {
      // network trouble is no reason to give up on this card for three days
      if (!/timeout|ENOTFOUND|ERR_|fetch failed|abort/i.test(String(e && e.message))) { try { fs.writeFileSync(miss, ''); } catch {} }
      return null;
    } finally { release(); }
  }

  function thumb(website) {
    if (!website || !/^https?:\/\//i.test(website) || !isWebsite(website)) return Promise.resolve(null);
    if (inflight.has(website)) return inflight.get(website);
    const p = resolve(website).finally(() => inflight.delete(website));
    inflight.set(website, p);
    return p;
  }
  /** A picture a source names itself (no programme page in between), scaled and cached like the others. */
  function image(url) {
    if (!url || !/^https:\/\//i.test(url) || !isImage(url)) return Promise.resolve(null);
    const k = 'img:' + url;
    if (inflight.has(k)) return inflight.get(k);
    const p = resolve(url, true).finally(() => inflight.delete(k));
    inflight.set(k, p);
    return p;
  }

  /** Keep the cache below `maxFiles` (least recently used first out). */
  function prune(maxFiles = 3000) {
    try {
      const files = fs.readdirSync(dir).map((f) => { const p = path.join(dir, f); try { return { p, t: fs.statSync(p).mtimeMs }; } catch { return null; } }).filter(Boolean);
      if (files.length <= maxFiles) return 0;
      files.sort((a, b) => a.t - b.t);
      const drop = files.slice(0, files.length - maxFiles);
      for (const f of drop) { try { fs.unlinkSync(f.p); } catch {} }
      return drop.length;
    } catch { return 0; }
  }

  return { thumb, image, prune };
}

function sniffType(b) {
  if (!b || b.length < 4) return null;
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.length >= 12 && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  return null;
}

module.exports = { createThumbs, extractImage, sizedImage, arteProgramId, sniffType };
