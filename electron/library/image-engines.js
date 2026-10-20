// Image search engines for the covers the book catalogues do not know, usable without an account: Bing and Yandex
// (and DuckDuckGo, whose search lives in web-covers.js). Each one is asked with its own small budget (cover-sources.js
// HOSTS: Bing at most 8 searches a minute, Yandex 2, DuckDuckGo one every three minutes) and rests for a long while on
// any sign of throttling (429, 403, a captcha page): the reader's address must never be blocked, and their own searches
// in the browser must keep working. Engines that answered a plain request with a captcha or a challenge when this was
// built (Yahoo, Brave, Qwant, Ecosia, Startpage, Seznam, Dogpile) are not asked at all.
//
// Only the query (title, author, "Buch"/"book cover") goes to an engine. Pictures load from the engine's own image cache
// (Bing's thumbnails in any size up to the original, Yandex's small ones), never from the websites the pictures come
// from. The pure part: URLs, parsers, the check for a challenge; web-covers.js asks.
'use strict';

const unhtml = (s) => String(s || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#215;/g, '×').replace(/&amp;/g, '&');
const siteOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^(www\d?|m|de|en|mobile)\./, ''); } catch { return ''; } };

// ---------------------------------------------------------------- Bing ------------------------------------------------
/** Bing's image search (the page's own endpoint for more results): strict safe search, the market of the language. */
function bingUrl(query) {
  const mkt = query.lang === 'de' ? 'de-DE' : query.lang === 'en' ? 'en-US' : null;
  const p = new URLSearchParams({ q: query.q, first: '0', count: '35', adlt: 'strict', mmasync: '1' });
  if (mkt) { p.set('mkt', mkt); p.set('setlang', query.lang); }
  return 'https://www.bing.com/images/async?' + p;
}
/** A Bing thumbnail in a height of its cache ("…/th?id=OIP.…&pid=15.1" with h=…), the original's size at most. */
const bingThumb = (turl, h) => String(turl || '').replace(/&h=\d+/, '') + '&h=' + h;
/** The results of Bing's answer: { rank, title, url (page), image (original), thumbnail (Bing's cache), width, height }. */
function parseBing(html) {
  const out = [];
  const parts = String(html || '').split(/class="iusc"/).slice(1);
  parts.forEach((part, rank) => {
    const m = /\bm="(\{[^"]*\})"/.exec(part);
    if (!m) return;
    let d;
    try { d = JSON.parse(unhtml(m[1])); } catch { return; }
    if (!d.turl || !/^https:\/\/[\w.-]+\.bing\.net\/th\?/i.test(d.turl)) return;
    const dim = /<span class="nowrap">\s*(\d+)\s*(?:×|&#215;|x)\s*(\d+)/.exec(part);
    out.push({ rank, title: unhtml(d.t || d.desc || ''), url: String(d.purl || ''), image: String(d.murl || ''), thumbnail: d.turl, width: dim ? +dim[1] : 0, height: dim ? +dim[2] : 0, engine: 'bing' });
  });
  return out;
}

// ---------------------------------------------------------------- Yandex ----------------------------------------------
/** Yandex's image search, the family filter on. */
function yandexUrl(query) {
  return 'https://yandex.com/images/search?' + new URLSearchParams({ text: query.q, family: 'yes' });
}
/** The results of Yandex's page (the state of its app in data-state): the same shape as Bing's. */
function parseYandex(html) {
  const s = String(html || '');
  const re = /data-state="([^"]*)"/g;
  let m;
  while ((m = re.exec(s))) {
    if (!m[1].includes('origUrl')) continue;
    let state;
    try { state = JSON.parse(unhtml(m[1])); } catch { continue; }
    const ents = state?.initialState?.serpList?.items?.entities;
    if (!ents || typeof ents !== 'object') continue;
    return Object.values(ents)
      .filter((e) => e && e.origUrl && e.image)
      .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))
      .map((e, i) => ({
        rank: Number.isFinite(e.pos) ? e.pos : i, title: String(e.snippet?.title || e.alt || ''), url: String(e.snippet?.url || ''), image: String(e.origUrl),
        thumbnail: String(e.image).replace(/^\/\//, 'https://'), width: e.origWidth || e.width || 0, height: e.origHeight || e.height || 0, engine: 'yandex',
      }));
  }
  return [];
}

// ---------------------------------------------------------------- throttling -----------------------------------------
/** An engine says "too many" or wants a human: 429, 403, 503, or a page asking for a captcha or a challenge. */
function isChallenge(r) {
  if (!r) return false;
  if (r.status === 429 || r.status === 403 || r.status === 503) return true;
  if (/showcaptcha|\/captcha|challenge/i.test(r.url || '')) return true;
  const head = r.buffer ? r.buffer.toString('utf8', 0, Math.min(r.buffer.length, 20000)) : '';
  return /captcha|are you a robot|unusual traffic|verify you are (?:a )?human|anubis_challenge|cf-chl|ich bin kein roboter/i.test(head) && !/class="iusc"|origUrl/.test(head);
}

const ENGINES = ['bing', 'yandex', 'duckduckgo'];
const ENGINE_NAME = { bing: 'Bing', yandex: 'Yandex', duckduckgo: 'DuckDuckGo' };
// the searches an engine takes in a minute (cover-sources.js HOSTS, web-covers.js DDG_PAUSE): free engines are asked in
// proportion to them, so that each one's budget lasts
const ENGINE_RATE = { bing: 8, yandex: 2, duckduckgo: 1 / 3 };
// the index an engine's pictures come from: DuckDuckGo shows Bing's, so the two agreeing is one voice, not two
const indexOf = (engine) => (engine === 'duckduckgo' ? 'bing' : engine || 'bing');

module.exports = { ENGINES, ENGINE_NAME, ENGINE_RATE, indexOf, bingUrl, bingThumb, parseBing, yandexUrl, parseYandex, isChallenge, siteOf, unhtml };
