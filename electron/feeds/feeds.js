// Newspapers & magazines: RSS/Atom feeds, full-text extraction (feed content / tagesschau API / Readability),
// disk cache, read state, feed health check.  Pure parsing functions are exported for tests; Electron is
// only required inside register().
const fs = require('fs');
const path = require('path');
const RssParser = require('rss-parser');
const C = require('./common');
const { CATEGORIES, FEEDS, migrateCategoryId } = require('./feedlist');

const FEED_TTL = 20 * 60 * 1000;
const ARTICLE_TTL = 24 * 60 * 60 * 1000;
const FULLTEXT_MIN = 1500;
const MAX_ITEMS = 60;
const READ_KEEP = 3000;
const FEED_MAX_BYTES = 20 * 1024 * 1024;   // a feed that big is not a feed
const ARTICLE_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_MAX_BYTES = 12 * 1024 * 1024;

const parser = new RssParser({
  timeout: 15000,
  customFields: {
    feed: ['language', 'subtitle', ['itunes:image', 'itunesImage'], 'image', 'icon', 'logo'],
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
      ['media:group', 'mediaGroup', { keepArray: true }],
      ['itunes:image', 'itunesImage'],
      ['content:encoded', 'contentEncoded'],
      ['dc:creator', 'dcCreator'],
      'description', 'summary', 'category', 'updated', 'published', 'image',
    ],
  },
});

// --- feed parsing -----------------------------------------------------------------------------------
function pickMediaImage(item) {
  const cands = [];
  const consider = (m) => {
    if (!m) return;
    const attrs = m.$ || m;
    if (!attrs || typeof attrs !== 'object') return;
    const url = attrs.url || attrs.href;
    if (!url) return;
    const type = attrs.type || '';
    const medium = attrs.medium || '';
    if (type && !/^image\//.test(type) && medium !== 'image') return;
    if (medium && medium !== 'image') return;
    if (/\.(mp4|mp3|m4a|webm|ogg|mov)(\?|$)/i.test(url)) return;
    cands.push({ url, w: parseInt(attrs.width || '0', 10) || 0 });
  };
  for (const m of item.mediaContent || []) consider(m);
  for (const g of item.mediaGroup || []) { for (const m of (g['media:content'] || [])) consider(m); for (const m of (g['media:thumbnail'] || [])) consider(m); }
  for (const m of item.mediaThumbnail || []) consider(m);
  if (item.enclosure && item.enclosure.url && (!item.enclosure.type || /^image\//.test(item.enclosure.type)) && !/\.(mp3|m4a|mp4|ogg|webm)(\?|$)/i.test(item.enclosure.url)) cands.push({ url: item.enclosure.url, w: 0 });
  if (item.itunesImage) { const u = typeof item.itunesImage === 'string' ? item.itunesImage : item.itunesImage.$?.href || item.itunesImage.href; if (u) cands.push({ url: u, w: 0 }); }
  if (item.image) { const u = typeof item.image === 'string' ? item.image : item.image.url || item.image.$?.href; if (typeof u === 'string') cands.push({ url: u, w: 0 }); }
  if (!cands.length) return null;
  cands.sort((a, b) => b.w - a.w);
  return cands[0].url;
}

function itemId(item) {
  const key = (typeof item.guid === 'string' && item.guid) || (typeof item.id === 'string' && item.id) || item.link || (item.title + '|' + (item.isoDate || item.pubDate || ''));
  return C.shortId(key);
}

function authorOf(item) {
  const a = item.creator || item.dcCreator || item.author;
  if (!a) return null;
  if (typeof a === 'string') return C.collapseWs(a).slice(0, 120) || null;
  if (a.name) return C.collapseWs(Array.isArray(a.name) ? a.name[0] : a.name);
  if (a._) return C.collapseWs(a._);
  return null;
}

/** Normalize one rss-parser item into Cozy Shelves item shape. */
function normalizeItem(item, feed) {
  const base = feed.link || feed.url || undefined;
  const link = C.absolutize(item.link, base) || (typeof item.guid === 'string' && /^https?:/.test(item.guid) ? item.guid : null);
  // a field that holds nothing but a placeholder ("None", an empty body) counts as missing (common.js isPlaceholderText)
  const text = (v) => (C.isPlaceholderText(v) ? '' : v);
  const [encoded, body, summaryField, description, snippet] = [item.contentEncoded, item.content, item.summary, item.description, item.contentSnippet].map(text);
  const rawFull = encoded || (body && body.length > (summaryField || '').length ? body : null) || body || summaryField || description || '';
  const rawShort = summaryField || description || snippet || '';
  let content = null, textLen = 0, hasFullText = false, image = null;
  if (rawFull) {
    const s = C.sanitizeHtml(rawFull, { baseUrl: link || base, preferLazy: true });
    textLen = s.text.length;
    hasFullText = textLen >= FULLTEXT_MIN || (feed.fullText === true && textLen >= 600);
    if (hasFullText) content = s.html;
    image = s.firstImage;
  }
  image = C.proxyImage(C.absolutize(pickMediaImage(item), base)) || image || null;
  const summarySource = rawShort && C.htmlToText(rawShort).length > 40 ? rawShort : rawFull;
  const summary = C.summarize(C.htmlToText(summarySource), 300);
  const date = C.toMs(item.isoDate) || C.toMs(item.pubDate) || C.toMs(item.published) || C.toMs(item.updated) || null;
  return {
    id: itemId(item), title: C.collapseWs(C.htmlToText(item.title || '')) || '(ohne Titel)', link, date, author: authorOf(item),
    summary, image, content, hasFullText, textLength: textLen,
    categories: (item.categories || []).map((c) => (typeof c === 'string' ? c : c._ || c.$?.term || '')).filter(Boolean).slice(0, 6),
  };
}

/** Parse RSS 0.9/1.0/2.0 or Atom XML text → { feed, items } in Cozy Shelves shape. */
async function parseFeedXml(xml, meta = {}) {
  xml = String(xml || '').replace(/^﻿/, '').replace(/^[\s\S]*?(?=<\?xml|<rss|<feed|<rdf:RDF)/i, '');
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml)) throw new Error('not a feed (no <rss>, <feed> or <rdf:RDF>)');
  const parsed = await parser.parseString(xml);
  const feedLink = C.absolutize(parsed.link, meta.url) || meta.homepage || null;
  const feedLogo = (parsed.image && parsed.image.url) || (typeof parsed.itunesImage === 'object' ? parsed.itunesImage.$?.href : parsed.itunesImage) || parsed.logo || parsed.icon || null;
  const feed = {
    id: meta.id || C.shortId(meta.url || parsed.title || 'feed'), title: C.collapseWs(C.htmlToText(meta.title || parsed.title || meta.url || 'Feed')),
    url: meta.url || parsed.feedUrl || null, link: feedLink, description: C.summarize(C.htmlToText(parsed.description || parsed.subtitle || ''), 200),
    image: typeof feedLogo === 'string' ? C.absolutize(feedLogo, feedLink) : null, lang: meta.lang || (parsed.language || '').slice(0, 2) || null,
    category: meta.category || null, fullText: meta.fullText ?? 'readability',
  };
  const items = [];
  const seen = new Set();
  for (const it of parsed.items.slice(0, MAX_ITEMS)) {
    const n = normalizeItem(it, { ...meta, link: feedLink });
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    items.push(n);
  }
  items.sort((a, b) => (b.date || 0) - (a.date || 0));
  return { feed, items };
}

// --- tagesschau JSON API -----------------------------------------------------------------------------
function tsImage(img) {
  if (!img) return null;
  const v = img.imageVariants || img;
  if (!v || typeof v !== 'object') return null;
  // 960 px fill the article column; the 1920 variant is three times the bytes (a hundred teasers at once ran
  // into the image proxy's timeout)
  for (const k of ['16x9-960', '16x9-1280', '16x9-840', '16x9-640', '16x9-1920', '1x1-840', '1x1-640', '16x9-512', '16x9-256']) if (v[k]) return v[k];
  const any = Object.values(v).find((x) => typeof x === 'string' && /^https?:/.test(x));
  return any || null;
}

function tsBlocksToHtml(content, base) {
  if (!Array.isArray(content)) return '';
  const out = [];
  for (const b of content) {
    if (!b || typeof b !== 'object') continue;
    const t = b.type;
    if (t === 'text' || t === 'headline') {
      const v = typeof b.value === 'string' ? b.value.trim() : '';
      if (!v) continue;
      if (t === 'headline') out.push(/^<h\d/i.test(v) ? v : `<h2>${v}</h2>`);
      else out.push(/^<(p|ul|ol|blockquote|h\d|div)/i.test(v) ? v : `<p>${v}</p>`);
    } else if (t === 'quotation') {
      const q = b.quotation && (b.quotation.text || b.quotation.value) || (typeof b.value === 'string' ? b.value : '');
      if (q) out.push(`<blockquote>${q}</blockquote>`);
    } else if (t === 'image') {
      const img = b.image || b.gallery?.[0] || b;
      const src = tsImage(img);
      if (src) out.push(`<figure><img src="${src}" alt="${C.collapseWs(img.alttext || img.title || '').replace(/"/g, '&quot;')}"><figcaption>${C.collapseWs(img.title || img.alttext || '')}${img.copyright ? ' <small>' + C.collapseWs(img.copyright) + '</small>' : ''}</figcaption></figure>`);
    } else if (t === 'box') {
      const bx = b.box || {};
      const src = tsImage(bx.image);
      out.push(`<aside class="box">${src ? `<img src="${src}" alt="">` : ''}${bx.title ? `<h3>${bx.title}</h3>` : ''}${bx.text ? `<div>${bx.text}</div>` : ''}${bx.link ? `<p><a href="${bx.link}">${bx.linkText || 'Mehr'}</a></p>` : ''}</aside>`);
    } else if (t === 'list') {
      const items = (b.list && b.list.items) || b.items || [];
      if (items.length) out.push(`<ul>${items.map((i) => `<li>${typeof i === 'string' ? i : i.value || i.text || ''}</li>`).join('')}</ul>`);
    }
    // video / audio / htmlEmbed / related / socialmedia are skipped
  }
  return out.join('\n');
}

/** Parse a tagesschau api2u JSON response → { feed, items } (full text, images). */
function parseTagesschau(json, meta = {}) {
  const news = Array.isArray(json.news) ? json.news : (json.regional || json.items || []);
  const feed = { id: meta.id || 'tagesschau', title: meta.title || 'tagesschau', url: meta.url || null, link: meta.homepage || 'https://www.tagesschau.de', description: 'Nachrichten der ARD', image: null, lang: 'de', category: meta.category || 'news', fullText: true, type: 'tagesschau' };
  const items = [];
  for (const n of news) {
    if (!n || n.type === 'video' || n.type === 'audio' || (!n.title && !n.detailsweb)) continue;
    const link = n.detailsweb || n.shareURL || n.details || null;
    const html = tsBlocksToHtml(n.content, link);
    const s = html ? C.sanitizeHtml(html, { baseUrl: link }) : { html: '', text: '', firstImage: null };
    const hasFullText = s.text.length >= 400;
    const kicker = n.topline ? C.collapseWs(n.topline) : '';
    items.push({
      id: C.shortId(n.sophoraId || n.externalId || link || n.title), title: C.collapseWs(n.title || ''), link, date: C.toMs(n.date), author: null,
      summary: C.summarize(n.firstSentence || s.text, 300), image: C.proxyImage(tsImage(n.teaserImage)), content: hasFullText ? s.html : null, hasFullText, textLength: s.text.length,
      categories: [kicker, ...(n.tags || []).map((t) => t.tag || t).slice(0, 4)].filter(Boolean), kicker, detailsUrl: n.details || null, ressort: n.ressort || null,
    });
  }
  items.sort((a, b) => (b.date || 0) - (a.date || 0));
  return { feed, items };
}

// --- article extraction (Readability) ----------------------------------------------------------------
function metaImage(doc, base) {
  for (const sel of ['meta[property="og:image"]', 'meta[property="og:image:url"]', 'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]', 'link[rel="image_src"]']) {
    const el = doc.querySelector(sel);
    const v = el && (el.getAttribute('content') || el.getAttribute('href'));
    const abs = C.absolutize(v, base);
    if (abs) return abs;
  }
  return null;
}

/** Extract the readable article from a fetched HTML page. Returns Cozy Shelves article shape or null. */
function extractArticle(html, url) {
  const { JSDOM } = require('jsdom');
  const { Readability } = require('@mozilla/readability');
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;
  const image = metaImage(doc, url);
  const siteName = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || null;
  const lang = (doc.documentElement.getAttribute('lang') || '').slice(0, 2) || null;
  const published = doc.querySelector('meta[property="article:published_time"]')?.getAttribute('content') || null;
  // the page-level lazy-loading attributes are picked up by the sanitizer
  for (const img of doc.querySelectorAll('img[data-src], img[data-lazy-src], img[data-original]')) {
    const s = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original');
    if (s && !/^data:/.test(img.getAttribute('src') || '') && img.getAttribute('src')) continue;
    if (s) img.setAttribute('src', s);
  }
  let article = null;
  try { article = new Readability(doc, { keepClasses: false, charThreshold: 300 }).parse(); } catch (e) { console.error('[feeds] readability failed', url, e.message); }
  dom.window.close();
  if (!article || !article.content) return null;
  const s = C.sanitizeHtml(article.content, { baseUrl: url });
  return {
    title: C.collapseWs(article.title || doc.title || ''), byline: article.byline ? C.collapseWs(article.byline).slice(0, 160) : null, content: s.html, textContent: s.text,
    excerpt: C.summarize(article.excerpt || s.text, 300), image: C.proxyImage(image) || s.firstImage || null, siteName: siteName || article.siteName || null, lang: article.lang || lang, published: C.toMs(published),
    readingMinutes: C.readingMinutes(s.text), url, source: 'readability',
  };
}

/** Build the article object from full feed content. */
function articleFromItem(item, feed) {
  const text = C.htmlToText(item.content);
  return { title: item.title, byline: item.author || null, content: item.content, textContent: text, excerpt: item.summary, image: item.image || C.proxyImage(C.firstImageFromHtml(item.content, item.link)), siteName: feed?.title || null, lang: feed?.lang || null, published: item.date, readingMinutes: C.readingMinutes(text), url: item.link, source: feed?.type === 'tagesschau' ? 'tagesschau' : 'feed' };
}

/** Analyse a parsed feed for the "add feed" preview / health check. */
function analyseFeed(res) {
  const items = res.items || [];
  const full = items.filter((i) => i.hasFullText).length;
  const withImg = items.filter((i) => i.image).length;
  return {
    ok: true, title: res.feed.title, link: res.feed.link, description: res.feed.description, image: res.feed.image, lang: res.feed.lang,
    itemCount: items.length, fullText: items.length > 0 && full >= Math.ceil(items.length * 0.6), fullTextItems: full, imageCount: withImg,
    hasImages: withImg >= Math.ceil(items.length * 0.4), sample: items.slice(0, 5).map((i) => i.title), newest: items[0]?.date || null,
    avgTextLength: items.length ? Math.round(items.reduce((a, i) => a + (i.textLength || 0), 0) / items.length) : 0,
  };
}

/** Discover a feed URL inside an HTML page (<link rel="alternate" type="application/rss+xml">). */
/**
 * What went wrong with a feed, in German: the messages reach the user (feed check dialog, the tooltip of a
 * broken feed, the empty page of a single feed). The HTTP status stays in brackets for the curious.
 */
function feedError(err) {
  const msg = String((err && err.message) || err || '');
  const http = /^HTTP (\d{3})/.exec(msg);
  let text;
  if (http) {
    const code = +http[1];
    text = code === 404 || code === 410 ? `Unter dieser Adresse gibt es keinen Feed mehr (HTTP ${code}).`
      : code === 401 || code === 403 ? `Die Website verweigert den Abruf (HTTP ${code}).`
        : code >= 300 && code < 400 ? `Die Website leitet den Abruf um, ohne ein Ziel zu nennen (HTTP ${code}).`
          : code >= 500 ? `Der Server der Website meldet einen Fehler (HTTP ${code}).`
            : `Der Abruf ist fehlgeschlagen (HTTP ${code}).`;
  } else if (/not a feed/i.test(msg)) text = 'Unter dieser Adresse liegt kein RSS- oder Atom-Feed.';
  else if (/HTML page, no feed found/i.test(msg)) text = 'Die Seite nennt keinen Feed. Die Adresse eines RSS- oder Atom-Feeds funktioniert direkt.';
  else if (/timeout after|Zeitüberschreitung|TIMED_OUT/i.test(msg)) text = 'Die Website antwortet nicht (Zeitüberschreitung).';
  else if (/ENOTFOUND|getaddrinfo|NAME_NOT_RESOLVED/i.test(msg)) text = 'Die Website ist nicht erreichbar (ENOTFOUND). Das kommt vor, wenn keine Internetverbindung besteht oder es die Adresse nicht mehr gibt.';
  else if (/ECONNREFUSED|ECONNRESET|fetch failed|ERR_CONNECTION|ERR_INTERNET|ERR_NETWORK/i.test(msg)) text = 'Keine Verbindung zur Website.';
  else if (/too large|maxBytes|zu groß/i.test(msg)) text = 'Der Feed ist zu groß.';
  else text = msg || 'Der Feed konnte nicht gelesen werden.';
  // no `cause`: Electron would print its whole stack for every broken feed that crosses the IPC boundary
  return new Error(text);
}

// Pages that link no feed: the usual places of a feed on the same site are tried in this order.
const FEED_GUESSES = ['/feed/', '/rss.xml', '/feed.xml', '/atom.xml', '/index.xml', '/rss/', '/rss'];
async function guessFeedUrl(pageUrl) {
  let origin;
  try { origin = new URL(pageUrl).origin; } catch { return null; }
  for (const p of FEED_GUESSES) {
    const u = origin + p;
    try {
      const r = await C.fetchText(u, { xml: true, timeout: 8000, maxBytes: FEED_MAX_BYTES, headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5' } });
      if (r.ok && /<(rss|feed|rdf:RDF)[\s>]/i.test(r.text.slice(0, 4000))) return r.url || u;
    } catch { /* next guess */ }
  }
  return null;
}

function discoverFeedUrl(html, base) {
  const doc = C.parseHtml(html);
  for (const l of doc.querySelectorAll('link[rel~="alternate"]')) {
    const t = (l.getAttribute('type') || '').toLowerCase();
    if (/rss|atom|xml|json/.test(t)) { const u = C.absolutize(l.getAttribute('href'), base); if (u) return u; }
  }
  const a = [...doc.querySelectorAll('a[href]')].find((x) => /\/(feed|rss|atom)(\.xml|\/)?$|\.rss$|rss\.xml|feed\.xml|\?feed=/i.test(x.getAttribute('href') || ''));
  return a ? C.absolutize(a.getAttribute('href'), base) : null;
}

// --- register (Electron) ----------------------------------------------------------------------------
function register(ctx) {
  const { ipcMain, app, broadcast } = ctx;
  const { Store } = require('../store');
  const userData = app.getPath('userData');
  const cache = new C.DiskCache(path.join(userData, 'feeds-cache'), { memoryLimit: 40 });
  const articleCache = new C.DiskCache(path.join(userData, 'feeds-cache', 'articles'), { memoryLimit: 30 });
  const state = new Store(path.join(userData, 'feeds-state.json'), { userFeeds: [], read: {}, health: {}, index: {} });
  const inflight = new Map();
  const limit = C.pLimit(4);
  let healthRunning = false, healthStartedAt = 0, healthTotal = 0, healthDone = 0;
  const HEALTH_MAX_MS = 10 * 60 * 1000;

  const allFeeds = () => [...FEEDS, ...(state.get('userFeeds') || []).map((f) => ({ ...f, custom: true }))];
  const findFeed = (idOrUrl) => allFeeds().find((f) => f.id === idOrUrl || f.url === idOrUrl) || null;
  const readSet = () => state.get('read') || {};

  // --- one-off migration + housekeeping --------------------------------------------------------
  // Category ids are persisted on user feeds; renaming a category must not orphan them
  // (the news panel filters with a strict `f.category === c.id`).
  (function migrateState() {
    let dirty = false;
    const userFeeds = state.get('userFeeds') || [];
    for (const f of userFeeds) {
      const next = migrateCategoryId(f.category);
      if (next !== f.category) { f.category = next; dirty = true; }
    }
    // drop health/index entries of feeds that no longer exist (ad-hoc fetches used to leak in)
    const known = new Set(allFeeds().map((f) => f.id));
    for (const key of ['index', 'health']) {
      const obj = state.get(key) || {};
      let touched = false;
      for (const id of Object.keys(obj)) if (!known.has(id)) { delete obj[id]; touched = true; }
      if (touched) { state.set(key, obj); dirty = true; }
    }
    if (dirty) { state.set('userFeeds', userFeeds); console.log('[feeds] migrated feeds-state.json'); }
  })();

  // --- image proxy (img://) ---------------------------------------------------------------------
  // Article images are fetched by the MAIN process and cached on disk, so the renderer never
  // talks to publisher CDNs itself. If the scheme cannot be registered we silently keep the
  // original URLs (nothing breaks, the images are simply loaded directly again).
  const imageDir = path.join(userData, 'feeds-cache', 'img');
  const IMG_TYPES = /^image\/(jpeg|png|gif|webp|avif|svg\+xml|bmp|x-icon|vnd\.microsoft\.icon)/i;
  // A news page asks for a hundred pictures at once. Queued behind each other in the network stack, the last ones
  // ran into the timeout before their download had even begun: at most IMG_PARALLEL fetches per host run at a
  // time, and the timeout (30 s: some papers send megabyte photos) starts when a fetch really starts.
  const IMG_PARALLEL = 6;
  const hostSlots = new Map();   // host → { active, waiting: [resolve] }
  async function perHost(host, fn) {
    let q = hostSlots.get(host);
    if (!q) { q = { active: 0, waiting: [] }; hostSlots.set(host, q); }
    if (q.active >= IMG_PARALLEL) await new Promise((res) => q.waiting.push(res));   // the slot is handed over
    else q.active++;
    try { return await fn(); }
    finally {
      const next = q.waiting.shift();
      if (next) next();
      else if (--q.active === 0) hostSlots.delete(host);
    }
  }
  function installImageProxy() {
    if (process.env.COZYSHELVES_NO_IMG_PROXY) return;
    let protocol;
    try { ({ protocol } = require('electron')); } catch { return; }
    if (!protocol || typeof protocol.handle !== 'function') return;
    try {
      protocol.handle('img', async (request) => {
        try {
          const enc = new URL(request.url).pathname.split('/').filter(Boolean).pop() || '';
          const target = Buffer.from(enc, 'base64url').toString('utf8');
          if (!/^https?:\/\//i.test(target)) return new Response('Bad request', { status: 400 });
          const key = C.sha1(target);
          const file = path.join(imageDir, key);
          const metaFile = file + '.type';
          if (fs.existsSync(file)) {
            let type = 'image/jpeg';
            try { type = fs.readFileSync(metaFile, 'utf8') || type; } catch {}
            return new Response(fs.readFileSync(file), { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'max-age=86400' } });
          }
          const r = await perHost(new URL(target).host, () => C.fetchRaw(target, { timeout: 30000, maxBytes: IMAGE_MAX_BYTES, headers: { Accept: 'image/*,*/*;q=0.8' } }));
          if (!r.ok) return new Response('Upstream ' + r.status, { status: 502 });
          const type = (r.contentType || '').split(';')[0].trim() || 'image/jpeg';
          if (!IMG_TYPES.test(type)) return new Response('Not an image', { status: 415 });
          try {
            fs.mkdirSync(imageDir, { recursive: true });
            fs.writeFileSync(file + '.tmp', r.buffer); fs.renameSync(file + '.tmp', file);
            fs.writeFileSync(metaFile, type);
          } catch {}
          return new Response(r.buffer, { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'max-age=86400' } });
        } catch (e) {
          return new Response('Image proxy failed: ' + e.message, { status: 502 });
        }
      });
      C.setImageProxy((u) => 'img://cache/' + Buffer.from(u, 'utf8').toString('base64url'));
      console.log('[feeds] image proxy active (img://)');
    } catch (e) { console.warn('[feeds] image proxy unavailable:', e.message); }
  }
  if (typeof app.whenReady === 'function') app.whenReady().then(installImageProxy).catch(() => {});

  function unreadFor(feedId) {
    const idx = (state.get('index') || {})[feedId];
    if (!idx || !idx.ids) return null;
    const read = readSet();
    return idx.ids.filter((id) => !read[id]).length;
  }

  function updateIndex(feedId, res, feed) {
    if (feed && feed.adhoc) return;               // one-off URL fetches must not pile up in the state file
    const index = state.get('index') || {};
    index[feedId] = { ids: res.items.map((i) => i.id), fetchedAt: Date.now(), title: res.feed.title, itemCount: res.items.length, newest: res.items[0]?.date || null };
    state.set('index', index);
  }

  function setHealth(feedId, h, feed) {
    if (feed && feed.adhoc) return { ...h, checkedAt: Date.now() };
    const health = state.get('health') || {};
    health[feedId] = { ...(health[feedId] || {}), ...h, checkedAt: Date.now() };
    state.set('health', health);
    broadcast('feeds:update', { type: 'health', feedId, health: health[feedId] });
    return health[feedId];
  }

  function decorate(f) {
    const health = (state.get('health') || {})[f.id] || { status: 'unknown' };
    const idx = (state.get('index') || {})[f.id];
    return { ...f, health, unread: unreadFor(f.id), itemCount: idx?.itemCount ?? null, lastFetched: idx?.fetchedAt || null, cached: !!idx };
  }

  async function fetchFeedNow(feed) {
    let res;
    if (feed.type === 'tagesschau') {
      try {
        const json = await C.fetchJson(feed.url, { timeout: 15000, maxBytes: FEED_MAX_BYTES, headers: { Accept: 'application/json' } });
        res = parseTagesschau(json, feed);
        if (!res.items.length) throw new Error('tagesschau API returned no items');
      } catch (e) {
        if (!feed.rss) throw e;
        console.warn('[feeds] tagesschau API failed, falling back to RSS:', e.message);
        const r = await C.fetchText(feed.rss, { xml: true, maxBytes: FEED_MAX_BYTES, headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        res = await parseFeedXml(r.text, feed);
      }
    } else {
      const r = await C.fetchText(feed.url, { xml: true, maxBytes: FEED_MAX_BYTES, headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (/<html[\s>]/i.test(r.text.slice(0, 2000)) && !/<(rss|feed|rdf:RDF)[\s>]/i.test(r.text)) {
        const discovered = discoverFeedUrl(r.text, r.url) || await guessFeedUrl(r.url || feed.url);
        if (!discovered) throw new Error('URL is an HTML page, no feed found');
        const r2 = await C.fetchText(discovered, { xml: true, maxBytes: FEED_MAX_BYTES });
        if (!r2.ok) throw new Error('HTTP ' + r2.status + ' for discovered feed ' + discovered);
        res = await parseFeedXml(r2.text, { ...feed, url: discovered });
        res.feed.discoveredFrom = feed.url;
      } else res = await parseFeedXml(r.text, feed);
    }
    res.feed = { ...feed, ...res.feed, id: feed.id || res.feed.id, title: feed.title || res.feed.title, fetchedAt: Date.now() };
    return res;
  }

  async function loadFeed(feed, { force = false } = {}) {
    const key = feed.id;
    const entry = cache.get(key);
    const age = entry ? Date.now() - entry.at : Infinity;
    if (entry && age < FEED_TTL && !force) return { ...entry.data, fromCache: true, age };
    const doFetch = () => {
      if (inflight.has(key)) return inflight.get(key);
      const p = fetchFeedNow(feed).then((res) => {
        cache.set(key, res);
        updateIndex(feed.id, res, feed);
        setHealth(feed.id, { status: 'ok', error: null, itemCount: res.items.length, fullText: res.items.filter((i) => i.hasFullText).length, images: res.items.filter((i) => i.image).length }, feed);
        broadcast('feeds:update', { type: 'feed', feedId: feed.id, unread: unreadFor(feed.id), itemCount: res.items.length, fetchedAt: Date.now() });
        return res;
      }).catch((err) => { const e = feedError(err); setHealth(feed.id, { status: 'broken', error: e.message }, feed); throw e; }).finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    };
    if (entry && !force) {
      // stale: serve immediately, revalidate in background
      doFetch().catch(() => {});
      return { ...entry.data, fromCache: true, stale: true, age };
    }
    try { return await doFetch(); }
    catch (e) { if (entry) return { ...entry.data, fromCache: true, stale: true, age, error: e.message }; throw e; }
  }

  async function checkUrl(url) {
    url = String(url || '').trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try { url = new URL(url).href; } catch { return { ok: false, url, error: 'Das ist keine gültige Internetadresse.' }; }
    try {
      const res = await fetchFeedNow({ id: C.shortId(url), url, fullText: 'readability' });
      return { ...analyseFeed(res), url: res.feed.url || url, discoveredFrom: res.feed.discoveredFrom || null };
    } catch (e) {
      // a site that is already in the curated list (heise.de without a feed link): say where it is
      const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
      const h = host(url);
      const known = h && allFeeds().find((f) => host(f.homepage || '') === h || host(f.url) === h);
      if (known) {
        const cat = CATEGORIES.find((c) => c.id === known.category);
        return { ok: false, url, error: `Diese Website ist schon als „${known.title}“ in der Rubrik „${cat ? cat.de : known.category}“ dabei.`, known: known.id };
      }
      return { ok: false, url, error: feedError(e).message };
    }
  }

  ipcMain.handle('feeds:list', () => ({
    categories: CATEGORIES.map((c) => ({ ...c })),
    feeds: allFeeds().map(decorate),
    // a reloaded window has to be able to recover a running health check (it used to
    // leave the "Prüfen" button disabled forever when the broadcast was missed)
    health: { running: healthRunning, startedAt: healthStartedAt, total: healthTotal, done: healthDone },
  }));

  ipcMain.handle('feeds:fetch', async (e, idOrUrl, opts) => {
    let feed = findFeed(idOrUrl);
    if (!feed) {
      if (!/^https?:\/\//i.test(String(idOrUrl || ''))) throw new Error('unknown feed ' + idOrUrl);
      feed = { id: C.shortId(idOrUrl), url: idOrUrl, title: null, lang: null, category: 'custom', fullText: 'readability', adhoc: true };
    }
    const res = await loadFeed(feed, { force: !!opts?.force });
    const read = readSet();
    return { ...res, items: res.items.map((i) => ({ ...i, read: !!read[i.id] })) };
  });

  ipcMain.handle('feeds:fetchMany', async (e, ids, opts) => {
    const out = {};
    await Promise.all((ids || []).map((id) => limit(async () => {
      const feed = findFeed(id);
      if (!feed) { out[id] = { error: 'unknown feed' }; return; }
      try {
        const res = await loadFeed(feed, { force: !!opts?.force });
        const read = readSet();
        out[id] = { ...res, items: res.items.map((i) => ({ ...i, read: !!read[i.id], feedId: feed.id, feedTitle: res.feed.title, feedLang: res.feed.lang })) };
      } catch (err) { out[id] = { error: err.message, feed }; }
    })));
    return out;
  });

  ipcMain.handle('feeds:article', async (e, url, feedId) => {
    if (!url) throw new Error('no url');
    const key = C.shortId(url, 24);
    const cached = articleCache.get(key);
    if (cached && Date.now() - cached.at < ARTICLE_TTL) return { ...cached.data, fromCache: true };
    const feed = feedId ? findFeed(feedId) : null;
    // 1. full text already in the feed?
    const entry = feedId ? cache.get(feedId) : null;
    const item = entry?.data?.items?.find((i) => i.link === url);
    if (item && item.hasFullText && item.content) {
      const art = articleFromItem(item, feed || entry.data.feed);
      articleCache.set(key, art);
      return art;
    }
    // 2. tagesschau details JSON
    if (item && item.detailsUrl) {
      try {
        const json = await C.fetchJson(item.detailsUrl);
        const html = tsBlocksToHtml(json.content, url);
        const s = C.sanitizeHtml(html, { baseUrl: url });
        if (s.text.length > 300) {
          const art = { title: json.title || item.title, byline: null, content: s.html, textContent: s.text, excerpt: item.summary, image: C.proxyImage(tsImage(json.teaserImage)) || item.image, siteName: 'tagesschau', lang: 'de', published: C.toMs(json.date) || item.date, readingMinutes: C.readingMinutes(s.text), url, source: 'tagesschau' };
          articleCache.set(key, art); return art;
        }
      } catch (err) { console.warn('[feeds] tagesschau details failed', err.message); }
    }
    // 3. fetch the page and run Readability
    const r = await C.fetchText(url, { timeout: 15000, maxBytes: ARTICLE_MAX_BYTES, headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const art = extractArticle(r.text, r.url || url);
    if (!art || art.textContent.length < 200) {
      if (item) { const fb = articleFromItem({ ...item, content: item.content || `<p>${item.summary}</p>` }, feed); fb.partial = true; fb.source = 'summary'; return fb; }
      throw new Error('Artikeltext konnte nicht extrahiert werden / could not extract article text');
    }
    if (item) { art.title = art.title || item.title; art.image = art.image || item.image; art.published = art.published || item.date; art.byline = art.byline || item.author; art.siteName = art.siteName || feed?.title || null; }
    articleCache.set(key, art);
    return art;
  });

  ipcMain.handle('feeds:check', (e, url) => checkUrl(url));

  ipcMain.handle('feeds:add', async (e, url, category, lang) => {
    const info = await checkUrl(url);
    if (!info.ok) throw new Error(info.error || 'feed could not be read');
    const feeds = state.get('userFeeds') || [];
    if (allFeeds().some((f) => f.url === info.url)) throw new Error('Dieser Feed ist bereits vorhanden.');
    const feed = { id: 'u-' + C.shortId(info.url, 12), title: info.title || info.url, url: info.url, lang: lang || info.lang || 'de', category: migrateCategoryId(category), fullText: info.fullText ? true : 'readability', hasImages: info.hasImages, homepage: info.link || null, custom: true, addedAt: Date.now() };
    feeds.push(feed);
    state.set('userFeeds', feeds);
    setHealth(feed.id, { status: 'ok', error: null, itemCount: info.itemCount });
    broadcast('feeds:update', { type: 'list' });
    return decorate(feed);
  });

  ipcMain.handle('feeds:remove', (e, feedId) => {
    const feeds = (state.get('userFeeds') || []).filter((f) => f.id !== feedId);
    state.set('userFeeds', feeds);
    cache.delete(feedId);
    const index = state.get('index') || {}; delete index[feedId]; state.set('index', index);
    broadcast('feeds:update', { type: 'list' });
    return true;
  });

  ipcMain.handle('feeds:readState', () => ({ read: readSet() }));

  ipcMain.handle('feeds:markRead', (e, feedId, itemId, flag = true) => {
    const read = { ...readSet() };
    if (flag === false) delete read[itemId]; else read[itemId] = Date.now();
    const keys = Object.keys(read);
    if (keys.length > READ_KEEP) { keys.sort((a, b) => read[a] - read[b]); for (const k of keys.slice(0, keys.length - READ_KEEP)) delete read[k]; }
    state.set('read', read);
    return { feedId, itemId, unread: feedId ? unreadFor(feedId) : null };
  });

  ipcMain.handle('feeds:markAllRead', (e, feedId) => {
    const idx = (state.get('index') || {})[feedId];
    if (!idx) return { feedId, unread: 0 };
    const read = { ...readSet() }; const now = Date.now();
    for (const id of idx.ids) read[id] = read[id] || now;
    state.set('read', read);
    return { feedId, unread: 0 };
  });

  ipcMain.handle('feeds:health', async (e, ids) => {
    // A run that somehow never finished must not block the UI forever.
    if (healthRunning && Date.now() - healthStartedAt > HEALTH_MAX_MS) {
      healthRunning = false;
      broadcast('feeds:update', { type: 'health-done', total: healthTotal, stale: true });
    }
    if (healthRunning) return { started: false, running: true, startedAt: healthStartedAt, total: healthTotal, done: healthDone };
    const feeds = ids && ids.length ? ids.map(findFeed).filter(Boolean) : allFeeds();
    healthRunning = true; healthStartedAt = Date.now(); healthTotal = feeds.length; healthDone = 0;
    broadcast('feeds:update', { type: 'health-start', total: feeds.length, startedAt: healthStartedAt });
    (async () => {
      try {
        await Promise.all(feeds.map((f) => limit(async () => {
          try {
            const res = await fetchFeedNow(f);
            cache.set(f.id, res); updateIndex(f.id, res, f);
            const a = analyseFeed(res);
            setHealth(f.id, { status: res.items.length ? 'ok' : 'empty', error: null, itemCount: a.itemCount, fullText: a.fullTextItems, images: a.imageCount, newest: a.newest }, f);
          } catch (err) { setHealth(f.id, { status: 'broken', error: feedError(err).message }, f); }
          healthDone++;
          broadcast('feeds:update', { type: 'health-progress', done: healthDone, total: feeds.length });
        })));
      } catch (err) {
        console.error('[feeds] health check failed', err.message);
      } finally {
        healthRunning = false;
        broadcast('feeds:update', { type: 'health-done', total: feeds.length });
      }
    })();
    return { started: true, total: feeds.length, startedAt: healthStartedAt };
  });

  ipcMain.handle('feeds:refreshAll', async (e, category, opts) => {
    const feeds = allFeeds().filter((f) => !category || f.category === category);
    const results = { ok: 0, failed: 0, feeds: {} };
    await Promise.all(feeds.map((f) => limit(async () => {
      try { const res = await loadFeed(f, { force: !!opts?.force }); results.ok++; results.feeds[f.id] = { itemCount: res.items.length, unread: unreadFor(f.id) }; }
      catch (err) { results.failed++; results.feeds[f.id] = { error: err.message }; }
    })));
    return results;
  });

  ipcMain.handle('feeds:clearCache', () => {
    try { fs.rmSync(path.join(userData, 'feeds-cache'), { recursive: true, force: true }); } catch {}
    cache.mem.clear(); articleCache.mem.clear();
    state.set('index', {});
    return true;
  });

  app.on('before-quit', () => { try { state.flush(); } catch {} });
}

module.exports = { register, parseFeedXml, parseTagesschau, tsBlocksToHtml, extractArticle, articleFromItem, analyseFeed, discoverFeedUrl, feedError, normalizeItem, pickMediaImage, FULLTEXT_MIN };
