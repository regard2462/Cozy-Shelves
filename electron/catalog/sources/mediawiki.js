// MediaWiki action-API / REST helpers shared by the Wikisource and Wikibooks sources.
'use strict';
const C = require('../../feeds/common');
const U = require('./util');

const opts = { ua: C.WIKI_UA, headers: { 'Api-User-Agent': C.WIKI_UA }, timeout: 20000 };
const api = (host, params) => `https://${host}/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
const pageUrl = (host, title) => `https://${host}/wiki/${encodeURIComponent(String(title).replace(/ /g, '_'))}`;

/** Full-text search. Returns { hits:[{title, pageid, snippet, wordcount, size}], total, hasMore }. */
async function search(net, host, q, { limit = 20, offset = 0, ns = 0 } = {}) {
  const j = await net.json(api(host, { action: 'query', list: 'search', srsearch: q, srlimit: String(limit), sroffset: String(offset), srnamespace: String(ns), srprop: 'snippet|wordcount|size|timestamp' }), opts);
  if (j.error) throw new Error(j.error.info || 'search failed');
  const hits = (j.query?.search || []).map((s) => ({ title: s.title, pageid: s.pageid, snippet: U.stripTags(s.snippet || ''), wordcount: s.wordcount || null, size: s.size || null, timestamp: s.timestamp || null }));
  return { hits, total: j.query?.searchinfo?.totalhits ?? null, hasMore: !!j.continue?.sroffset };
}

/** Members of a category (main namespace). `cont` is the cmcontinue token for paging. */
async function categoryMembers(net, host, category, { limit = 20, cont = null, sort = 'sortkey', dir = 'asc' } = {}) {
  const p = { action: 'query', list: 'categorymembers', cmtitle: category, cmlimit: String(limit), cmnamespace: '0', cmtype: 'page', cmsort: sort, cmdir: dir === 'desc' ? 'desc' : 'asc' };
  if (cont) p.cmcontinue = cont;
  const j = await net.json(api(host, p), opts);
  if (j.error) throw new Error(j.error.info || 'category failed');
  return { hits: (j.query?.categorymembers || []).map((m) => ({ title: m.title, pageid: m.pageid, snippet: '' })), cont: j.continue?.cmcontinue || null };
}

async function random(net, host, n = 20) {
  const j = await net.json(api(host, { action: 'query', list: 'random', rnnamespace: '0', rnlimit: String(n), rnfilterredir: 'nonredirects' }), { ...opts, ttl: 0 });
  return { hits: (j.query?.random || []).map((m) => ({ title: m.title, pageid: m.id, snippet: '' })) };
}

async function prefixSearch(net, host, prefix, limit = 100) {
  const j = await net.json(api(host, { action: 'query', list: 'prefixsearch', pssearch: prefix, pslimit: String(limit), psnamespace: '0' }), opts);
  return (j.query?.prefixsearch || []).map((m) => m.title);
}

/** Best-effort thumbnails / intro extracts for a list of titles (PageImages + TextExtracts).
 *  Chunked, because a page of results can ask for more titles than one request may carry – the last
 *  entries used to come back without a cover and without a description. */
const ENRICH_CHUNK = 20;   // exlimit for anonymous clients
async function enrich(net, host, titles) {
  const out = {};
  if (!titles.length) return out;
  const chunks = [];
  for (let i = 0; i < titles.length; i += ENRICH_CHUNK) chunks.push(titles.slice(i, i + ENRICH_CHUNK));
  await Promise.all(chunks.map(async (chunk) => {
    try {
      const n = String(chunk.length);
      const j = await net.json(api(host, { action: 'query', titles: chunk.join('|'), prop: 'pageimages|extracts', piprop: 'thumbnail', pithumbsize: '240', pilimit: n, exintro: '1', explaintext: '1', exchars: '320', exlimit: n, redirects: '1' }), opts);
      for (const p of j.query?.pages || []) {
        if (!p || !p.title) continue;
        out[p.title] = { thumbnail: p.thumbnail?.source ? C.absolutize(p.thumbnail.source) : null, extract: C.collapseWs(p.extract || '') || null };
      }
    } catch (e) { /* optional */ }
  }));
  return out;
}

/** Page HTML (Parsoid via REST, fallback action=parse). Returns { html, title }. */
async function pageHtml(net, host, title) {
  title = String(title || '').trim();
  const enc = encodeURIComponent(title.replace(/ /g, '_'));
  try {
    const r = await net.text(`https://${host}/api/rest_v1/page/html/${enc}?redirect=true`, { ...opts, headers: { ...opts.headers, Accept: 'text/html' } });
    if (r.ok && r.text) return { html: r.text, title };
    if (r.status === 404) throw new Error('Seite nicht gefunden: ' + title);
  } catch (e) { if (/nicht gefunden/.test(e.message)) throw e; }
  const j = await net.json(api(host, { action: 'parse', page: title, prop: 'text|displaytitle', redirects: '1', disabletoc: '1', disableeditsection: '1' }), opts);
  if (j.error) throw new Error(j.error.info || 'page not found');
  return { html: j.parse?.text || '', title: j.parse?.title || title };
}

/** Title without the "Book/ Chapter" subpage part. */
function rootTitle(title) { const i = String(title).indexOf('/'); return i > 0 ? title.slice(0, i).trim() : title; }

module.exports = { api, pageUrl, search, categoryMembers, random, prefixSearch, enrich, pageHtml, rootTitle, opts };
