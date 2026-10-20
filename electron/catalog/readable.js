// Turning catalog items into readable HTML: wiki pages (Wikisource/Wikibooks incl. chapter subpages),
// Gutenberg HTML editions, Projekt Gutenberg-DE / Zeno works and arbitrary web pages (Readability +
// "weiter"/next-link following). Output: { title, author, html, chapters:[{title,id}], url, source, pages }.
'use strict';
const C = require('../feeds/common');
const MW = require('./sources/mediawiki');

const MAX_HTML = 6 * 1024 * 1024;     // total html size per book
const MAX_CHAPTERS = 150;
const MAX_PAGES = 60;                 // pages followed via next links (a reader's worth, not a crawl)
const PAGE_PAUSE = 250;               // ms between two requests to the same host
const NEXT_TEXT = /^(\s*[»›>→]+\s*)?(weiter|nächste[sr]?( seite| kapitel)?|next( page| chapter)?|vorwärts|fortsetzung|continue|suivant)(\s*[»›>→]+)?\s*$/i;
const PREV_TEXT = /^(\s*[«‹<←]+\s*)?(zurück|vorherige[sr]?( seite| kapitel)?|previous( page| chapter)?|prev|back)(\s*[«‹<←]+)?\s*$/i;

// --- wiki --------------------------------------------------------------------------------------------
const NS_RE = /^(Datei|File|Kategorie|Category|Spezial|Special|Hilfe|Help|Wikisource|Wikibooks|Benutzer|User|Vorlage|Template|Index|Seite|Page|Diskussion|Talk|Autor|Author|Regal|Shelf|Modul|Module|MediaWiki|Portal|Wikijunior|Kochbuch|Cookbook|Rezept):/i;
const WIKI_REMOVE = ['script', 'style', 'link', 'meta', 'noscript', '.mw-editsection', '.noprint', '.ws-noexport', '.navbox', '.metadata', '.ambox', '.catlinks', '.toc', '#toc', '.mw-indicators', '.printfooter', '.mw-jump-link', '.mw-empty-elt', '.mw-cite-backlink', '.sistersitebox', '.noexcerpt', '.mw-authority-control', '.mw-hidden-catlinks', '.ext-discussiontools-init-section', '#headertemplate', '.headertemplate', '#Textdaten', '.textdaten', '.wst-textdaten', 'table.wst-header', '.ws-header', '#headerContainer', '.ws-summary', '.mw-kartographer-container', '.mw-references-wrap + .mw-empty-elt', '.wb-navigation', '.noarticletext', 'div.printfooter', '.mw-page-container-inner > .vector-column-start'];

function titleFromWikiHref(href) {
  if (!href) return null;
  let t = null;
  if (href.startsWith('./')) t = href.slice(2);
  else if (href.startsWith('/wiki/')) t = href.slice(6);
  else { const m = /^(?:https?:)?\/\/[a-z-]+\.(?:m\.)?wiki(?:source|books)\.org\/wiki\/(.+)$/i.exec(href); if (m) t = m[1]; }
  if (t == null) return null;
  const h = t.indexOf('#'); let frag = null;
  if (h >= 0) { frag = t.slice(h + 1); t = t.slice(0, h); }
  try { t = decodeURIComponent(t); } catch {}
  return { title: t.replace(/_/g, ' ').trim(), frag };
}

/** Sanitize a Wikisource/Wikibooks page. Returns { html, text, author, next, prev, subpages:[titles], toc }. */
function sanitizeWikiHtml(html, { host, title }) {
  const doc = C.parseHtml(html);
  const root = doc.body;
  const base = `https://${host}/`;
  // metadata from the header boxes before they are removed
  let author = null, next = null, prev = null;
  const authorEl = root.querySelector('#header_author_text, .header_author_text, [id="header_author_text"]');
  if (authorEl) author = C.collapseWs(authorEl.textContent);
  if (!author) {
    for (const cell of root.querySelectorAll('th, td, dt')) {
      if (/^(Autor|Author|Verfasser)(in)?:?$/i.test(C.collapseWs(cell.textContent))) { const v = cell.nextElementSibling; if (v) { author = C.collapseWs(v.textContent).slice(0, 120); break; } }
    }
  }
  const nextEl = root.querySelector('#headernext a, .headernext a, [id="headernext"] a, a[rel="next"]');
  const prevEl = root.querySelector('#headerprevious a, .headerprevious a, [id="headerprevious"] a, a[rel="prev"]');
  const asTitle = (el) => { const t = el && titleFromWikiHref(el.getAttribute('href')); return t && !NS_RE.test(t.title) ? t.title : null; };
  next = asTitle(nextEl); prev = asTitle(prevEl);
  for (const a of root.querySelectorAll('a')) {
    const txt = C.collapseWs(a.textContent);
    if (!next && NEXT_TEXT.test(txt)) next = asTitle(a);
    if (!prev && PREV_TEXT.test(txt)) prev = asTitle(a);
  }
  // subpages (chapters) in document order
  const subpages = [];
  const seen = new Set();
  const base0 = String(title || '').replace(/_/g, ' ');
  const prefixes = [base0 + '/', base0 + ': ', base0 + ':'];
  for (const a of root.querySelectorAll('a[href]')) {
    const t = titleFromWikiHref(a.getAttribute('href'));
    if (t && t.title !== base0 && prefixes.some((p) => t.title.startsWith(p)) && !seen.has(t.title) && !NS_RE.test(t.title)) { seen.add(t.title); subpages.push(t.title); }
  }
  for (const sel of WIKI_REMOVE) { try { for (const el of root.querySelectorAll(sel)) el.remove(); } catch {} }
  // de.wikisource "Textdaten" box / en.wikisource header tables that escaped the selectors above
  for (const t of [...root.querySelectorAll('table')]) { const tx = C.collapseWs(t.textContent); if (tx.length < 2500 && /Textdaten|Bearbeitungsstand|Korrekturstand|Fertig\b|Erscheinungsdatum|Kurzbeschreibung/.test(tx)) t.remove(); }
  // links: internal → data-wiki, external keep href
  for (const a of [...root.querySelectorAll('a')]) {
    const href = a.getAttribute('href') || '';
    for (const attr of [...a.attributes]) if (!['href', 'title', 'class'].includes(attr.name)) a.removeAttribute(attr.name);
    if (href.startsWith('#')) { a.setAttribute('data-anchor', href.slice(1)); a.removeAttribute('href'); continue; }
    const t = titleFromWikiHref(href);
    if (t) {
      a.removeAttribute('href');
      if (NS_RE.test(t.title) || /\bnew\b/.test(a.getAttribute('class') || '')) { unwrap(a); continue; }
      a.setAttribute('data-wiki', t.title);
      continue;
    }
    const abs = C.absolutize(href, base);
    if (abs) { a.setAttribute('href', abs); a.setAttribute('data-ext', '1'); } else unwrap(a);
  }
  for (const img of [...root.querySelectorAll('img')]) {
    const src = C.absolutize(img.getAttribute('src'), base);
    if (!src) { img.remove(); continue; }
    img.setAttribute('src', src); img.removeAttribute('srcset');
    const w = parseInt(img.getAttribute('width') || '0', 10);
    if (w && w <= 2) img.remove();
  }
  // Wikisource "Seite:" page-number markers and page links are noise in a book
  for (const el of root.querySelectorAll('.pagenum, .ws-pagenum, span[id^="pagenum"], .mw-page-nr, .pageNumber, .ws-page-number')) el.remove();
  const toc = []; let n = 0;
  for (const h of root.querySelectorAll('h2, h3')) {
    const text = C.collapseWs(h.textContent); if (!text) continue;
    let id = h.getAttribute('id') || h.parentElement?.getAttribute('id'); if (!id) id = 'wsec-' + (++n);
    h.setAttribute('id', id); toc.push({ id, text, level: h.tagName === 'H2' ? 2 : 3 });
  }
  const s = C.sanitizeHtml(root.innerHTML, { baseUrl: base, keepClasses: true, keepIds: true, keepStyle: true, keepData: ['data-wiki', 'data-ext', 'data-anchor'] });
  return { html: s.html, text: s.text, author, next, prev, subpages, toc, firstImage: s.firstImage };
}
function unwrap(el) { const p = el.parentNode; if (!p) return; while (el.firstChild) p.insertBefore(el.firstChild, el); p.removeChild(el); }

/** Read a wiki item: main page + (optionally) all chapter subpages, concatenated. */
async function readWiki(item, opts, { net }) {
  const { host, title, lang } = item.meta;
  const main = await MW.pageHtml(net, host, title);
  const page = sanitizeWikiHtml(main.html, { host, title: main.title });
  const chapters = [{ title: main.title, id: 'ch1', html: page.html, words: C.collapseWs(page.text).split(' ').length }];
  let truncated = false;
  if (opts?.chapters !== 'first') {
    // chapter list: links on the main page (TOC order) ∪ prefix search (both "Buch/ Kapitel" and "Buch: Kapitel")
    let titles = [...page.subpages];
    for (const pre of ['/', ': ']) { try { for (const t of await MW.prefixSearch(net, host, title + pre, 100)) if (!titles.includes(t) && t !== title && !NS_RE.test(t)) titles.push(t); } catch {} }
    titles = titles.filter((t) => t !== main.title && t !== title).slice(0, MAX_CHAPTERS);
    if (titles.length > MAX_CHAPTERS) truncated = true;
    const limit = C.pLimit(3);
    let size = page.html.length;
    const results = await Promise.all(titles.map((t) => limit(async () => { try { const r = await MW.pageHtml(net, host, t); return { title: t, page: sanitizeWikiHtml(r.html, { host, title: t }) }; } catch { return null; } })));
    for (const r of results) {
      if (!r) continue;
      if (size + r.page.html.length > MAX_HTML) { truncated = true; break; }
      size += r.page.html.length;
      chapters.push({ title: r.title.startsWith(title) ? r.title.slice(title.length).replace(/^[\/:]\s*/, '') || r.title : r.title, id: 'ch' + (chapters.length + 1), html: r.page.html });
    }
    // single-page works with header navigation (en.wikisource): follow "next" a limited number of times
    if (chapters.length === 1 && page.next) {
      let nxt = page.next, hops = 0; const seen = new Set([main.title]);
      while (nxt && hops < 60 && !seen.has(nxt) && size < MAX_HTML) {
        seen.add(nxt); hops++;
        try { const r = await MW.pageHtml(net, host, nxt); const pg = sanitizeWikiHtml(r.html, { host, title: nxt }); size += pg.html.length; chapters.push({ title: nxt.replace(/^.*\//, ''), id: 'ch' + (chapters.length + 1), html: pg.html }); nxt = pg.next; }
        catch { break; }
      }
    }
  }
  return assemble({ title: main.title.replace(/\/.*$/, ''), author: page.author || item.author || null, chapters, url: item.readOnlineUrl, source: item.source === 'wikibooks' ? 'Wikibooks' : 'Wikisource', lang, truncated, image: page.firstImage || item.cover || null });
}

// --- web pages ---------------------------------------------------------------------------------------
const CONTENT_SELECTORS = ['#gutenb', '.zenoCOMain', '#zenoCOMain', 'article.mw-body', '#mw-content-text', 'main article', 'article', '[role="main"]', 'main', '#content', '.content'];

/** A page's own title. og:title is only a last resort: the redesigned projekt-gutenberg.org puts one
 *  constant, wrong og:title on every single page. The <h1> wins when it also appears in <title>;
 *  otherwise the h1 is a site banner ("Online-Bibliothek" on zeno.org) and <title> is the real one. */
function pageTitle(doc) {
  const h1 = C.collapseWs(doc.querySelector('h1')?.textContent || '');
  const docTitle = C.collapseWs(doc.title || '');
  // "Titel – Seitenname" / "Titel | Seitenname" → the first segment
  const firstSeg = C.collapseWs(docTitle.split(/\s+[|–—·»]\s+|\s-\s/)[0]) || docTitle;
  if (h1 && (!docTitle || docTitle.toLowerCase().includes(h1.toLowerCase()) || h1.toLowerCase().includes(firstSeg.toLowerCase()))) return h1;
  return firstSeg || h1 || C.collapseWs(doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || '');
}

/** Links that look like parts of the same work/issue: same host, below the current path. */
function collectChapterLinks(doc, url, abs) {
  let base;
  try { base = new URL(url); } catch { return []; }
  // the "directory" of the current page: /a/b/c → /a/b/ , /a/b/ → /a/b/
  const prefix = base.pathname.endsWith('/') ? base.pathname : base.pathname.replace(/\/[^/]*$/, '/');
  const self = base.origin + base.pathname.replace(/\/$/, '');
  const out = [], seen = new Set();
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = abs(a.getAttribute('href'));
    if (!href) continue;
    let u;
    try { u = new URL(href); } catch { continue; }
    if (u.hostname !== base.hostname) continue;
    const clean = u.origin + u.pathname.replace(/\/$/, '') + (u.search || '');
    if (clean === self || seen.has(clean)) continue;
    const legacy = /\/chap\d+\.html?$/i.test(u.pathname);          // old Projekt-Gutenberg-DE editions
    if (!legacy && !(u.pathname.startsWith(prefix) && u.pathname.length > prefix.length)) continue;
    if (/\.(pdf|epub|zip|mobi|jpe?g|png|gif|svg|mp3|mp4|m4a|ogg)$/i.test(u.pathname)) continue;
    seen.add(clean);
    out.push({ title: C.collapseWs(a.textContent), url: u.origin + u.pathname + (u.search || '') });
    if (out.length >= MAX_CHAPTERS) break;
  }
  return out;
}

/** Extract one web page: { title, author, html, text, next, prev, image, chapters:[{title,url}] }. */
function extractPage(html, url, { readability = true } = {}) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;
  const abs = (h) => C.absolutize(h, url);
  const title = pageTitle(doc);
  const author = C.collapseWs(doc.querySelector('meta[name="author"], meta[property="article:author"], meta[name="dc.creator"], meta[name="DC.Creator"]')?.getAttribute('content') || doc.querySelector('.author, [rel="author"], .byline')?.textContent || '').slice(0, 120) || null;
  const image = abs(doc.querySelector('meta[property="og:image"]')?.getAttribute('content'));
  let next = abs(doc.querySelector('link[rel="next"]')?.getAttribute('href') || doc.querySelector('a[rel="next"]')?.getAttribute('href'));
  let prev = abs(doc.querySelector('link[rel="prev"]')?.getAttribute('href') || doc.querySelector('a[rel="prev"]')?.getAttribute('href'));
  const sameHost = (u) => { try { return new URL(u).hostname === new URL(url).hostname; } catch { return false; } };
  for (const a of doc.querySelectorAll('a[href]')) {
    if (next && prev) break;
    const txt = C.collapseWs(a.textContent);
    const href = abs(a.getAttribute('href'));
    if (!href || !sameHost(href)) continue;
    if (!next && NEXT_TEXT.test(txt) && href !== url) next = href;
    if (!prev && PREV_TEXT.test(txt) && href !== url) prev = href;
  }
  const chapters = collectChapterLinks(doc, url, abs);
  if (next && next.split('#')[0] === url.split('#')[0]) next = null;
  // MediaWiki boilerplate ("[Bearbeiten | Quelltext bearbeiten]", navigation boxes) is no text of the page
  for (const el of doc.querySelectorAll('.mw-editsection, .mw-jump-link, .noprint, .navbox, .catlinks, .printfooter, #toc, .toc')) el.remove();
  // known content containers first, Readability otherwise
  let content = null;
  for (const sel of CONTENT_SELECTORS) {
    const el = doc.querySelector(sel);
    if (el && C.collapseWs(el.textContent).length > 200) { content = el.innerHTML; break; }
  }
  if (!content && readability) {
    try { const { Readability } = require('@mozilla/readability'); const art = new Readability(doc, { keepClasses: false, charThreshold: 200 }).parse(); if (art && art.content) content = art.content; } catch {}
  }
  if (!content) content = doc.body ? doc.body.innerHTML : '';
  dom.window.close();
  const s = C.sanitizeHtml(content, { baseUrl: url, preferLazy: true });
  // drop navigation remnants ("weiter >>", "<< zurück") from the text
  const cleaned = s.html.replace(/<p>\s*(<a [^>]*>)?\s*(&lt;&lt;|&gt;&gt;|«|»)?\s*(weiter|zurück|next|previous)\s*(&lt;&lt;|&gt;&gt;|«|»)?\s*(<\/a>)?\s*<\/p>/gi, '');
  return { title, author, html: cleaned, text: s.text, next, prev, image: image || s.firstImage || null, chapters };
}

const SERIAL_RE = /\/chap(?:ter)?[-_/]?\d+(?:\.html?)?\/?$/i;
/** chapter links that form a numbered series (…/chapter/1, …/chap001.html) */
const looksSerial = (list) => list.filter((c) => SERIAL_RE.test(c.url)).length >= 2;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Read a web page; with follow=true the "next" chain is walked (multi-page works).
 *  With `index: true` the page is treated as a directory: its article links become the chapters
 *  (bpb dossiers / APuZ issues, where nothing readable is on the landing page itself). */
async function readWeb(url, opts, { net, onProgress }) {
  url = String(url || '').trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url.replace(/^\/+/, '');
  const follow = opts?.follow !== false;
  const index = !!opts?.index;
  const maxPages = Math.min(MAX_PAGES, opts?.maxPages || MAX_PAGES);
  const visited = new Set();
  const chapters = [];
  let cur = url, first = null, size = 0, truncated = false, hops = 0;
  while (cur && !visited.has(key(cur)) && chapters.length < maxPages) {
    visited.add(key(cur));
    if (hops++) await pause(PAGE_PAUSE);              // never hammer one host with back-to-back requests
    const r = await net.text(cur, { timeout: 30000, ttl: 0 });
    if (!r.ok) { if (!chapters.length) throw new Error(`HTTP ${r.status} für ${cur}`); break; }
    if (r.contentType && !/html|xml|text\/plain|^$/i.test(r.contentType)) { if (!chapters.length) throw new Error('Keine Webseite (' + r.contentType + ')'); break; }
    const landed = r.url || cur;
    visited.add(key(landed));                          // a 301 /x → /x/ must not be fetched again
    const page = extractPage(r.text, landed);
    if (!first) first = page;
    if (C.collapseWs(page.text).length > 0) chapters.push({ title: page.title || `Seite ${chapters.length + 1}`, id: 'ch' + (chapters.length + 1), html: page.html, url: landed });
    size += page.html.length;
    onProgress?.({ pages: chapters.length, url: cur });
    if (index && chapters.length <= 1) break;          // the directory itself is only the cover page
    if (!follow) break;
    // title pages that list numbered chapters: start with the first chapter when there is no next link
    let nxt = page.next;
    if (!nxt && chapters.length === 1 && looksSerial(page.chapters)) nxt = page.chapters.find((c) => SERIAL_RE.test(c.url)).url;
    if (size > MAX_HTML) { truncated = true; break; }
    cur = nxt;
  }
  if (!first) throw new Error('Kein lesbarer Text auf der Seite gefunden');
  if (index) {
    const r = await readIndexPages(first, chapters, { net, onProgress }, maxPages);
    truncated = truncated || r.truncated;
  }
  // chapter titles: drop the repeated site title part ("Faust I - Kapitel 3 | Projekt Gutenberg" → "Kapitel 3")
  for (const c of chapters) c.title = c.title.replace(/\s*[|–-]\s*(Projekt Gutenberg(-DE)?|Zeno\.org|Wikisource|Wikibooks)\s*$/i, '');
  // pages of a work sometimes all report the same <title>; then number them instead of repeating it
  if (chapters.length > 1 && new Set(chapters.map((c) => c.title)).size === 1) {
    for (let i = 1; i < chapters.length; i++) chapters[i].title = `Kapitel ${i}`;
  }
  const bookTitle = commonPrefix(chapters.map((c) => c.title)) || first.title || url;
  for (const c of chapters) {
    if (chapters.length < 2 || !bookTitle || !c.title.startsWith(bookTitle)) continue;
    const t = c.title.slice(bookTitle.length).replace(/^[\s|–:-]+/, '');
    if (t) c.title = t;
  }
  let host = url; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  return assemble({ title: bookTitle, author: first.author, chapters, url, source: host, lang: opts?.lang || null, truncated, image: first.image });
}
function key(u) { return String(u).split('#')[0].replace(/\/$/, ''); }

/** A portal whose article list only exists as an RSS/Atom feed (bpb renders its grids client-side):
 *  read the feed, then every entry becomes one chapter. */
async function readFeed(feedUrl, item, opts, { net, onProgress }) {
  const X = require('./xml');
  const r = await net.text(feedUrl, { xml: true, ttl: 0, timeout: 30000, headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} für den Feed`);
  const root = X.parseXml(r.text);
  if (!root) throw new Error('Der Feed konnte nicht gelesen werden.');
  const entries = [];
  if (root.local === 'rss' || root.local === 'rdf' || X.child(root, 'channel')) {
    const channel = X.child(root, 'channel') || root;
    for (const it of X.children(channel, 'item')) entries.push({ title: C.collapseWs(X.childText(it, 'title')), url: C.collapseWs(X.childText(it, 'link')) });
  } else {
    for (const e of X.children(root, 'entry')) {
      const link = X.children(e, 'link').find((l) => !X.attr(l, 'rel') || X.attr(l, 'rel') === 'alternate');
      entries.push({ title: C.collapseWs(X.childText(e, 'title')), url: link ? X.attr(link, 'href') : '' });
    }
  }
  const list = entries.filter((e) => /^https?:\/\//i.test(e.url)).slice(0, Math.min(25, opts?.maxPages || 25));
  if (!list.length) throw new Error('Der Feed enthält keine Artikel.');
  const limit = C.pLimit(3);
  const chapters = [];
  const pages = await Promise.all(list.map((e, i) => limit(async () => {
    await pause(PAGE_PAUSE * (i % 3));
    try {
      const p = await net.text(e.url, { timeout: 30000, ttl: 0 });
      if (!p.ok) return null;
      const ex = extractPage(p.text, p.url || e.url);
      onProgress?.({ pages: chapters.length + 1, url: e.url });
      return C.collapseWs(ex.text).length > 300 ? { title: e.title || ex.title, html: ex.html, url: e.url, image: ex.image } : null;
    } catch { return null; }
  })));
  let size = 0, truncated = false;
  for (const p of pages) {
    if (!p) continue;
    if (size + p.html.length > MAX_HTML) { truncated = true; break; }
    size += p.html.length;
    chapters.push({ title: p.title, id: 'ch' + (chapters.length + 1), html: p.html, url: p.url });
  }
  if (!chapters.length) throw new Error('Aus diesem Portal ließ sich kein Text lesen.');
  let host = feedUrl; try { host = new URL(feedUrl).hostname.replace(/^www\./, ''); } catch {}
  return assemble({ title: item?.title || host, author: item?.author || null, chapters, url: item?.readOnlineUrl || feedUrl, source: host, lang: item?.language || 'de', truncated, image: pages.find((p) => p && p.image)?.image || null });
}

/** Directory mode: fetch the articles linked from the landing page, one chapter each. */
async function readIndexPages(first, chapters, { net, onProgress }, maxPages) {
  const NAV = /^(mehr|weiter|alle|alle anzeigen|home|startseite|start|impressum|datenschutz|kontakt|suche|suchen|newsletter|presse|english|deutsch|de|en|zum inhalt|nach oben|login|anmelden|rss|hilfe|über uns|sitemap)$/i;
  const links = first.chapters
    .filter((c) => c.title && c.title.length > 6 && !NAV.test(c.title) && !/^https?:/i.test(c.title))
    .filter((c, i, a) => a.findIndex((x) => x.title === c.title) === i)   // one entry per teaser (image + headline link)
    .slice(0, Math.min(40, maxPages));
  if (!links.length) return { truncated: false };
  const limit = C.pLimit(3);
  let truncated = false;
  const pages = await Promise.all(links.map((l, i) => limit(async () => {
    await pause(PAGE_PAUSE * (i % 3));
    try {
      const r = await net.text(l.url, { timeout: 30000, ttl: 0 });
      if (!r.ok || (r.contentType && !/html|xml|text\/plain|^$/i.test(r.contentType))) return null;
      const p = extractPage(r.text, r.url || l.url);
      onProgress?.({ pages: chapters.length + 1, url: l.url });
      return C.collapseWs(p.text).length > 400 ? { title: p.title || l.title, html: p.html, url: l.url } : null;
    } catch { return null; }
  })));
  let size = chapters.reduce((n, c) => n + c.html.length, 0);
  for (const p of pages) {
    if (!p) continue;
    if (size + p.html.length > MAX_HTML) { truncated = true; break; }
    size += p.html.length;
    chapters.push({ title: p.title, id: 'ch' + (chapters.length + 1), html: p.html, url: p.url });
  }
  return { truncated };
}

function commonPrefix(list) {
  if (list.length < 2) return '';
  let p = list[0];
  for (const s of list.slice(1)) { let i = 0; while (i < p.length && i < s.length && p[i] === s[i]) i++; p = p.slice(0, i); if (!p) break; }
  if (p && list.some((s) => s.length > p.length && /\S/.test(s[p.length]) && /\S/.test(p[p.length - 1]))) p = p.slice(0, p.lastIndexOf(' ') + 1); // cut mid-word
  p = p.replace(/[\s|–:-]+$/, '').trim();
  // a trailing chapter word ("Faust – Kapitel", "… – Teil") belongs to the chapter titles
  return p.replace(/[\s|–:-]*\b(Teil|Kapitel|Chapter|Part|Seite|Page|Abschnitt|Buch|Book|Band|Volume|Vol\.?)\s*$/i, '').replace(/[\s|–:-]+$/, '').trim();
}

// --- gutenberg html edition ---------------------------------------------------------------------------
async function readGutenbergHtml(item, opts, { net }) {
  const url = item.formats.find((f) => f.type === 'html')?.url;
  if (!url) throw new Error('Keine HTML-Ausgabe');
  const r = await net.text(url, { timeout: 60000, ttl: 0 });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const doc = C.parseHtml(r.text);
  for (const el of doc.querySelectorAll('.pg-boilerplate, #pg-header, #pg-footer, section.pgheader, section.pgfooter')) el.remove();
  let html = doc.body.innerHTML;
  // legacy editions: cut at the *** START/END *** markers
  const start = html.search(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG/i);
  if (start > 0) { const p = html.indexOf('</p>', start); if (p > 0) html = html.slice(p + 4); }
  const end = html.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG/i);
  if (end > 0) { const p = html.lastIndexOf('<p', end); html = html.slice(0, p > 0 ? p : end); }
  const s = C.sanitizeHtml(html, { baseUrl: r.url || url, keepClasses: true, keepStyle: true });
  return assemble({ title: item.title, author: item.author, chapters: [{ title: item.title, id: 'ch1', html: s.html }], url: item.readOnlineUrl || url, source: 'Project Gutenberg', lang: item.language, truncated: false, image: item.cover });
}

// --- assembly ----------------------------------------------------------------------------------------
function assemble({ title, author, chapters, url, source, lang, truncated, image }) {
  const parts = chapters.map((c, i) => `<section class="cat-chapter" id="${c.id}">${chapters.length > 1 ? `<h2 class="cat-chapter-title" id="${c.id}-h">${escapeHtml(c.title)}</h2>` : ''}${c.html}</section>`);
  if (truncated) parts.push(`<p class="cat-note"><em>… (gekürzt, das Werk ist sehr umfangreich; der Rest kann im Browser gelesen werden)</em></p>`);
  return { title: C.collapseWs(title), author: author || null, html: parts.join('\n'), chapters: chapters.map((c) => ({ title: c.title, id: c.id, url: c.url || null })), url, source, language: lang || null, pages: chapters.length, truncated: !!truncated, image: image || null, chapterHtml: chapters.map((c) => ({ title: c.title, html: c.html })) };
}
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// --- internet archive: the OCR full text of a scan ------------------------------------------------------
const TXT_CHAPTER = 45000;            // characters per generated chapter

/** Read `<id>_djvu.txt` of an Internet Archive item (Open Library delegates here too). */
async function readArchiveText(item, opts, { net }) {
  const id = item.meta.identifier;
  const direct = `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(id)}_djvu.txt`;
  let r = await net.text(direct, { timeout: 60000, ttl: 0 }).catch(() => null);
  if (!r || !r.ok || /html/i.test(r.contentType || '')) {
    // some items name the text file differently – ask the metadata API
    const meta = await net.json(`https://archive.org/metadata/${encodeURIComponent(id)}`, { timeout: 25000 });
    const f = (meta?.files || []).find((x) => x && /_djvu\.txt$/i.test(x.name || '')) || (meta?.files || []).find((x) => x && /\.txt$/i.test(x.name || ''));
    if (!f) throw new Error('Für dieses Digitalisat gibt es keinen Volltext. Bitte als PDF oder EPUB herunterladen.');
    r = await net.text(`https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(f.name)}`, { timeout: 60000, ttl: 0 });
  }
  if (!r.ok) throw new Error(`HTTP ${r.status} für den Volltext`);
  const chapters = textToChapters(r.text, item.title);
  if (!chapters.length) throw new Error('Der Volltext dieses Digitalisats ist leer.');
  return assemble({ title: item.title, author: item.author, chapters, url: item.readOnlineUrl, source: 'Internet Archive', lang: item.language, truncated: false, image: item.cover });
}

/** Plain OCR text → paragraphs, grouped into readable chapters. */
function textToChapters(text, title) {
  const paras = String(text || '').replace(/\r/g, '').split(/\n{2,}/).map((p) => C.collapseWs(p)).filter((p) => p.length > 1);
  const chapters = [];
  let buf = [], size = 0;
  const flush = () => {
    if (!buf.length) return;
    chapters.push({ title: chapters.length ? `Abschnitt ${chapters.length + 1}` : (title || 'Text'), id: 'ch' + (chapters.length + 1), html: buf.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n') });
    buf = []; size = 0;
  };
  for (const p of paras) {
    buf.push(p); size += p.length;
    if (size > TXT_CHAPTER) flush();
    if (chapters.length >= MAX_CHAPTERS) break;
  }
  flush();
  return chapters;
}

/** Dispatcher used by 'catalog:readHtml'. */
async function readItem(item, opts, deps) {
  if (!item || typeof item !== 'object') throw new Error('kein Eintrag');
  const meta = item.meta || {};
  if (meta.wiki) return readWiki(item, opts, deps);
  if (meta.feed) {
    try { return await readFeed(meta.feed, item, opts, deps); }
    catch (e) { if (!meta.url && !item.readOnlineUrl) throw e; }
  }
  if (meta.web || meta.url) return readWeb(meta.url || item.readOnlineUrl, { follow: meta.follow !== false, index: !!meta.index, lang: item.language }, deps);
  if (item.source === 'gutenberg' && (item.formats || []).some((f) => f.type === 'html')) return readGutenbergHtml(item, opts, deps);
  // several candidate pages (arXiv: the HTML rendering first, then the abstract page)
  if (Array.isArray(meta.readAlts) && meta.readAlts.length) {
    let last = null;
    for (const alt of meta.readAlts) {
      try { return await readWeb(alt, { follow: false, lang: item.language }, deps); } catch (e) { last = e; }
    }
    if (meta.identifier) return readArchiveText(item, opts, deps);
    throw last || new Error('Dieser Eintrag lässt sich nicht direkt lesen.');
  }
  if (meta.identifier && (item.source === 'archive' || item.source === 'openlibrary')) return readArchiveText(item, opts, deps);
  const html = (item.formats || []).find((f) => f.type === 'html')?.url || item.readOnlineUrl;
  if (html) return readWeb(html, { follow: false, lang: item.language }, deps);
  throw new Error('Dieser Eintrag lässt sich nicht direkt lesen. Bitte herunterladen.');
}

module.exports = { readItem, readWiki, readWeb, readFeed, readArchiveText, readGutenbergHtml, extractPage, sanitizeWikiHtml, titleFromWikiHref, commonPrefix, textToChapters, pageTitle, NEXT_TEXT };
