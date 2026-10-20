// Standard Ebooks (https://standardebooks.org) – carefully typeset public-domain EPUBs.
// New releases via the public OPDS feed; search via the HTML result page (parsed defensively).
'use strict';
const U = require('./util');
const C = require('../../feeds/common');
const { parseOpds } = require('../opds');

const SITE = 'https://standardebooks.org';
const OPDS_NEW = SITE + '/feeds/opds/new-releases';
const ATOM_NEW = SITE + '/feeds/atom/new-releases';
const SUBJECTS = { fiction: 'fiction', nonfiction: 'nonfiction', philosophy: 'philosophy', poetry: 'poetry', adventure: 'adventure', mystery: 'mystery', history: 'history', drama: 'drama', science: 'science', childrens: 'childrens' };

const source = {
  id: 'standardebooks', name: 'Standard Ebooks', icon: '✒️', kind: 'books', lang: ['en'], canSearch: true,
  description: { de: 'Liebevoll gesetzte, korrigierte EPUB-Ausgaben gemeinfreier Klassiker (englisch).', en: 'Lovingly typeset, proofread EPUB editions of public-domain classics.' },
  chips: [
    { id: 'new', label: { de: 'Neuerscheinungen', en: 'New releases' } },
    { id: 'fiction', label: { de: 'Romane', en: 'Fiction' } },
    { id: 'nonfiction', label: { de: 'Sachbuch', en: 'Nonfiction' } },
    { id: 'philosophy', label: { de: 'Philosophie', en: 'Philosophy' } },
    { id: 'poetry', label: { de: 'Lyrik', en: 'Poetry' } },
    { id: 'adventure', label: { de: 'Abenteuer', en: 'Adventure' } },
    { id: 'mystery', label: { de: 'Krimi', en: 'Mystery' } },
    { id: 'history', label: { de: 'Geschichte', en: 'History' } },
    { id: 'childrens', label: { de: 'Kinderbücher', en: 'Children' } },
  ],

  async search(query, opts, { net }) {
    const q = U.norm(query);
    const p = U.page(opts);
    const url = `${SITE}/ebooks?query=${encodeURIComponent(q)}&page=${p}`;
    const r = await net.text(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const parsed = parseSearchHtml(r.text, url);
    return U.result(parsed.items, { total: null, page: p, hasMore: parsed.hasMore });
  },

  async browse(browseId, opts, { net }) {
    const p = U.page(opts);
    if (browseId === 'new' || !SUBJECTS[browseId]) {
      // the OPDS feed became patron-only (HTTP 401); the public Atom feed and the HTML listing stay open
      for (const feedUrl of [OPDS_NEW, ATOM_NEW]) {
        const r = await net.text(feedUrl, { xml: true, headers: { Accept: 'application/atom+xml, application/xml;q=0.9, */*;q=0.5' } });
        if (!r.ok) continue;
        const feed = parseOpds(r.text, feedUrl);
        const items = feed.publications.map(fromPublication).filter((i) => i && i.formats.length);
        if (items.length) return U.result(items, { total: items.length, page: 1, hasMore: false });
      }
      const listUrl = `${SITE}/ebooks?sort=newest&page=${p}`;
      const html = await net.text(listUrl);
      if (!html.ok) throw new Error(`HTTP ${html.status}`);
      const listed = parseSearchHtml(html.text, listUrl);
      return U.result(listed.items, { total: null, page: p, hasMore: listed.hasMore });
    }
    // subject listings are HTML pages (the subject OPDS feeds are patron-only)
    const url = `${SITE}/ebooks?tags%5B%5D=${encodeURIComponent(SUBJECTS[browseId])}&page=${p}`;
    const r = await net.text(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const parsed = parseSearchHtml(r.text, url);
    return U.result(parsed.items, { total: null, page: p, hasMore: parsed.hasMore });
  },
};

/**
 * URL of the compatible EPUB for a book page path (/ebooks/author/title[/translator]). Without
 * "?source=download" the site answers with a thank-you page instead of the file (since 2024).
 */
function epubUrlFor(bookPath) {
  const m = /\/ebooks\/(.+?)\/?$/.exec(bookPath || '');
  if (!m) return null;
  const segs = m[1].split('/').filter(Boolean);
  if (segs.length < 2) return null;
  return `${SITE}/ebooks/${segs.join('/')}/downloads/${segs.join('_')}.epub?source=download`;
}
/** Acquisition links of the feeds point at the same thank-you page: ask for the file itself. */
const directDownload = (href) => (/^https?:\/\/(www\.)?standardebooks\.org\/ebooks\/.+\/downloads\/[^?#]+$/i.test(href || '') ? href + '?source=download' : href);

function fromPublication(pub) {
  const pageUrl = (pub.id && /^https?:/.test(pub.id) ? pub.id : null) || pub.links.find((l) => l.rel.includes('alternate'))?.href || null;
  const formats = [];
  for (const l of pub.acquisition) {
    const type = U.typeOf(l.type);
    if (!type || type === 'audio-rss') continue;
    if (type === 'epub' && /advanced|kepub/.test(l.href)) continue; // keep the "compatible" epub
    if (formats.some((f) => f.type === type)) continue;
    formats.push({ type, url: directDownload(l.href), label: type === 'epub' ? 'EPUB' : type === 'mobi' ? 'Kindle (azw3)' : type.toUpperCase() });
  }
  if (!formats.length && pageUrl) { const u = epubUrlFor(new URL(pageUrl).pathname); if (u) formats.push({ type: 'epub', url: u, label: 'EPUB' }); }
  const slug = pageUrl ? pageUrl.replace(/^https?:\/\/[^/]+\/ebooks\//, '') : pub.title;
  return U.mkItem('standardebooks', slug, {
    title: pub.title, author: pub.authors.map((a) => a.name).filter(Boolean).join(', '), year: null, language: U.langCode(pub.language) || 'en',
    subjects: pub.subjects.map((s) => s.name), cover: pub.thumbnail || pub.cover, description: pub.summary || (pub.content ? U.stripTags(pub.content.value) : ''),
    formats, readOnlineUrl: pageUrl, license: 'Public Domain (US)',
    // every Standard Ebook has a clean single-page HTML edition → one click to read it in the app
    canRead: !!pageUrl, meta: { published: pub.published || null, ...(pageUrl ? { web: true, url: singlePageUrl(pageUrl), follow: false } : {}) },
  });
}

/** https://standardebooks.org/ebooks/<author>/<book> → …/text/single-page (the whole book as one page). */
function singlePageUrl(pageUrl) {
  return String(pageUrl).replace(/\/+$/, '') + '/text/single-page';
}

/** Parse the /ebooks?query=… result page. Returns { items, hasMore }. */
function parseSearchHtml(html, baseUrl) {
  const doc = C.parseHtml(html);
  const items = [];
  const seen = new Set();
  let cards = [...doc.querySelectorAll('[typeof="schema:Book"], ol.ebooks-list > li, ul.ebooks-list > li, .ebooks-list li')];
  if (!cards.length) cards = [...doc.querySelectorAll('li')].filter((li) => li.querySelector('a[href^="/ebooks/"]'));
  for (const li of cards) {
    const link = li.querySelector('a[href^="/ebooks/"][property="schema:url"], p a[href^="/ebooks/"], a[href^="/ebooks/"]');
    const href = li.getAttribute('about') || (link && link.getAttribute('href'));
    if (!href || !/^\/ebooks\/[^/]+\/[^/]+/.test(href) || seen.has(href)) continue;
    seen.add(href);
    const title = C.collapseWs(li.querySelector('[property="schema:name"]')?.textContent || link?.textContent || '');
    const authorEls = [...new Set([...li.querySelectorAll('[property="schema:author"] [property="schema:name"], .author [property="schema:name"], p.author a')].map((a) => a.closest('[property="schema:author"], p.author a, .author') || a))];
    const author = C.collapseWs(authorEls.map((a) => a.textContent).join(', ') || li.querySelector('.author, [property="schema:author"]')?.textContent || '');
    const img = li.querySelector('img');
    const cover = C.absolutize(img && (img.getAttribute('src') || img.getAttribute('data-src')), baseUrl);
    if (!title) continue;
    const epub = epubUrlFor(href);
    items.push(U.mkItem('standardebooks', href.replace(/^\/ebooks\//, ''), {
      title, author, language: 'en', cover, formats: epub ? [{ type: 'epub', url: epub, label: 'EPUB' }] : [], readOnlineUrl: SITE + href, license: 'Public Domain (US)',
      canRead: true, meta: { web: true, url: singlePageUrl(SITE + href), follow: false },
    }));
  }
  const hasMore = !!doc.querySelector('a[rel="next"], nav a[href*="page="]:last-of-type');
  return { items, hasMore: hasMore && items.length >= 12 };
}

module.exports = { ...source, fromPublication, parseSearchHtml, epubUrlFor, singlePageUrl };
