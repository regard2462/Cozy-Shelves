// Project Gutenberg via the Gutendex API (https://gutendex.com) – ~75.000 public-domain books.
'use strict';
const U = require('./util');

const API = 'https://gutendex.com/books/';
const TOPICS = { chess: 'chess', philosophy: 'philosophy', history: 'history', economics: 'economics', fairytales: 'fairy tales', poetry: 'poetry', science: 'science', children: 'children', drama: 'drama', adventure: 'adventure' };

const source = {
  id: 'gutenberg', name: 'Project Gutenberg', icon: '📜', kind: 'books', lang: ['en', 'de', 'fr', 'es', 'it', 'la'], canSearch: true,
  description: { de: 'Über 75.000 gemeinfreie Bücher als EPUB, HTML und Text, gesammelt seit 1971.', en: 'Over 75,000 public-domain books as EPUB, HTML and plain text – the classic free library.' },
  chips: [
    { id: 'popular', label: { de: 'Beliebt', en: 'Popular' } },
    { id: 'german', label: { de: 'Deutsch', en: 'German' } },
    { id: 'chess', label: { de: 'Schach', en: 'Chess' } },
    { id: 'philosophy', label: { de: 'Philosophie', en: 'Philosophy' } },
    { id: 'history', label: { de: 'Geschichte', en: 'History' } },
    { id: 'economics', label: { de: 'Wirtschaft', en: 'Economics' } },
    { id: 'fairytales', label: { de: 'Märchen', en: 'Fairy tales' } },
    { id: 'poetry', label: { de: 'Lyrik', en: 'Poetry' } },
    { id: 'science', label: { de: 'Wissenschaft', en: 'Science' } },
    { id: 'children', label: { de: 'Kinderbücher', en: 'Children' } },
    { id: 'adventure', label: { de: 'Abenteuer', en: 'Adventure' } },
  ],

  async search(query, opts, { net }) {
    const q = U.norm(query);
    const p = U.page(opts);
    const params = new URLSearchParams({ search: q, page: String(p) });
    addLang(params, opts?.lang);
    return toResult(await net.json(API + '?' + params), p);
  },

  async browse(browseId, opts, { net }) {
    const p = U.page(opts);
    const params = new URLSearchParams({ page: String(p), sort: 'popular' });
    if (browseId === 'german') params.set('languages', 'de');
    else {
      addLang(params, opts?.lang);
      if (TOPICS[browseId]) params.set('topic', TOPICS[browseId]);
    }
    return toResult(await net.json(API + '?' + params), p);
  },

  /** Gutenberg HTML edition → readable HTML for the in-app reader. */
  readUrlFor(item) { const f = item.formats.find((x) => x.type === 'html'); return f ? f.url : null; },
};

function addLang(params, lang) {
  if (lang === 'de') params.set('languages', 'de');
  else if (lang === 'en') params.set('languages', 'en');
}

function toResult(json, p) {
  const items = (json?.results || []).map(parseBook).filter(Boolean);
  const total = Number(json?.count) || items.length;
  return U.result(items, { total, page: p, hasMore: !!json?.next });
}

function parseBook(b) {
  if (!b || b.id == null) return null;
  // one URL per format type; prefer editions with images (epub3.images / html.images)
  const best = {};
  const score = (url) => (/noimages/.test(url) ? 0 : /images/.test(url) ? 2 : 1) + (/epub3/.test(url) ? 0.5 : 0);
  for (const [mime, url] of Object.entries(b.formats || {})) {
    if (!url || /\.zip$/i.test(url) || /rdf\+xml|octet-stream|image\//.test(mime)) continue;
    const type = U.typeOf(mime);
    if (!type || type === 'audio-rss') continue;
    if (!best[type] || score(url) > score(best[type])) best[type] = url;
  }
  const formats = Object.entries(best).map(([type, url]) => ({ type, url, label: type === 'epub' ? (/noimages/.test(url) ? 'EPUB' : 'EPUB (mit Bildern)') : type.toUpperCase() }));
  const cover = b.formats?.['image/jpeg'] || `https://www.gutenberg.org/cache/epub/${b.id}/pg${b.id}.cover.medium.jpg`;
  const authors = (b.authors || []).map((a) => U.flipName(a.name)).filter(Boolean);
  const years = (b.authors || []).map((a) => a.birth_year).filter(Boolean);
  return U.mkItem('gutenberg', b.id, {
    title: b.title, author: authors.join(', '), year: null, language: U.langCode(b.languages), subjects: [...(b.subjects || []), ...(b.bookshelves || []).map((s) => String(s).replace(/^Browsing:\s*/i, ''))],
    cover, description: Array.isArray(b.summaries) ? b.summaries[0] : (b.summary || ''), formats,
    readOnlineUrl: `https://www.gutenberg.org/ebooks/${b.id}`, downloads: b.download_count, license: b.copyright === false ? 'Public Domain' : (b.copyright ? 'Copyrighted (free)' : null),
    canRead: formats.some((f) => f.type === 'html'), meta: { gutenbergId: b.id, authorBorn: years[0] || null, mediaType: b.media_type || null },
  });
}

module.exports = { ...source, parseBook, toResult };
