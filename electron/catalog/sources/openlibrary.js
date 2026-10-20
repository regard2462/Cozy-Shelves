// Open Library (https://openlibrary.org) – catalogue search limited to books with a free, public scan
// on the Internet Archive; downloads resolve through the Archive metadata (ia:// formats).
'use strict';
const U = require('./util');

const FIELDS = 'key,title,author_name,first_publish_year,language,subject,ia,cover_i,public_scan_b,edition_count,number_of_pages_median,first_sentence';
// order = order of the browse chips: the broad, generally useful subjects first, the niches last
const BROWSE = {
  classics: { q: 'subject:classics' }, german: { q: 'language:ger' }, literature: { q: 'subject:literature' }, history: { q: 'subject:history' },
  philosophy: { q: 'subject:philosophy' }, science: { q: 'subject:science' }, economics: { q: 'subject:economics' }, politics: { q: 'subject:"political science"' },
  psychology: { q: 'subject:psychology' }, art: { q: 'subject:art' }, religion: { q: 'subject:religion' }, poetry: { q: 'subject:poetry' },
  fairy: { q: 'subject:"fairy tales"' }, travel: { q: 'subject:"description and travel"' }, chess: { q: 'subject:chess' },
};

const source = {
  id: 'openlibrary', name: 'Open Library', icon: '🗂️', kind: 'books', lang: ['en', 'de', 'fr'], canSearch: true,
  description: { de: 'Der Katalog des Internet Archive, hier nur Bücher mit frei lesbarem Scan (Public Domain).', en: 'The Internet Archive catalogue – restricted here to books with a freely readable public scan.' },
  chips: [
    { id: 'classics', label: { de: 'Klassiker', en: 'Classics' } },
    { id: 'german', label: { de: 'Deutsch', en: 'German' } },
    { id: 'literature', label: { de: 'Literatur', en: 'Literature' } },
    { id: 'history', label: { de: 'Geschichte', en: 'History' } },
    { id: 'philosophy', label: { de: 'Philosophie', en: 'Philosophy' } },
    { id: 'science', label: { de: 'Wissenschaft', en: 'Science' } },
    { id: 'economics', label: { de: 'Wirtschaft', en: 'Economics' } },
    { id: 'politics', label: { de: 'Politik', en: 'Politics' } },
    { id: 'psychology', label: { de: 'Psychologie', en: 'Psychology' } },
    { id: 'art', label: { de: 'Kunst', en: 'Art' } },
    { id: 'religion', label: { de: 'Religion', en: 'Religion' } },
    { id: 'poetry', label: { de: 'Lyrik', en: 'Poetry' } },
    { id: 'fairy', label: { de: 'Märchen', en: 'Fairy tales' } },
    { id: 'travel', label: { de: 'Reisen', en: 'Travel' } },
    { id: 'chess', label: { de: 'Schach', en: 'Chess' } },
  ],

  async search(query, opts, { net }) {
    const p = U.page(opts);
    return toResult(await net.json(url({ q: U.norm(query), lang: opts?.lang, page: p })), p);
  },
  async browse(browseId, opts, { net }) {
    const p = U.page(opts);
    const spec = BROWSE[browseId] || BROWSE.classics;
    return toResult(await net.json(url({ q: spec.q, lang: browseId === 'german' ? null : opts?.lang, page: p, sort: 'readinglog' })), p);
  },
  resolveFormat: (format, deps) => require('./archive').resolveFormat(format, deps),
};

function url({ q, lang, page, sort }) {
  const params = new URLSearchParams({ q, has_fulltext: 'true', public_scan_b: 'true', limit: '20', page: String(page), fields: FIELDS });
  if (lang === 'de') params.set('language', 'ger'); else if (lang === 'en') params.set('language', 'eng');
  if (sort) params.set('sort', sort);
  return 'https://openlibrary.org/search.json?' + params;
}

// Open Library's `subject` field is the raw, unordered Solr array: hundreds of entries, most of them
// catalogue noise. Rank it so the broad, useful subjects come first and the narrow ones last.
const SUBJECT_NOISE = /^(accessible book|protected daisy|in library|internet archive wishlist|overdrive|lending library|popular print disabled books|large type books|reading level|open library staff picks|new york times bestseller)/i;
const SUBJECT_DROP = /( -- |\bin fiction\b|\bin literature\b|^nyt:|^lcsh:|^fast:|\d{4}-\d{4}|^\d+$|accessible_book|protected_daisy)/i;

function rankSubjects(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const s = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!s || s.length < 3 || s.length > 48) continue;
    if (SUBJECT_NOISE.test(s) || SUBJECT_DROP.test(s)) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    const words = s.split(' ').length;
    // broad first: short, word-only, title-cased terms score highest
    let score = 0;
    if (words === 1) score += 4; else if (words === 2) score += 2.5; else if (words === 3) score += 1;
    if (/^[A-ZÄÖÜ]/.test(s)) score += 1;
    if (/[0-9(),.:;\/]/.test(s)) score -= 2;
    if (s.length > 30) score -= 1;
    out.push({ s, score });
  }
  return out.sort((a, b) => b.score - a.score || a.s.localeCompare(b.s)).map((x) => x.s);
}

function parseDoc(d) {
  if (!d || !d.key) return null;
  const ia = Array.isArray(d.ia) ? d.ia[0] : d.ia;
  if (!ia) return null;
  const formats = [{ type: 'auto', url: `ia://${ia}#auto`, label: 'EPUB/PDF' }, { type: 'pdf', url: `ia://${ia}#pdf`, label: 'PDF' }, { type: 'epub', url: `ia://${ia}#epub`, label: 'EPUB' }];
  return U.mkItem('openlibrary', d.key.replace(/^\/works\//, ''), {
    title: d.title, author: (d.author_name || []).slice(0, 3).join(', '), year: d.first_publish_year, language: U.langCode(d.language),
    subjects: rankSubjects(d.subject), cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : `https://archive.org/services/img/${encodeURIComponent(ia)}`,
    description: Array.isArray(d.first_sentence) ? d.first_sentence[0] : (d.first_sentence || ''), formats, readOnlineUrl: `https://archive.org/details/${encodeURIComponent(ia)}`,
    // the scan's OCR full text is readable in-app (readable.js → archive.org/download/<id>/<id>_djvu.txt)
    license: 'Public Domain (Scan)', canRead: true, meta: { identifier: ia, olKey: d.key, pages: d.number_of_pages_median || null },
  });
}

function toResult(json, p) {
  const docs = json?.docs || [];
  const total = Number(json?.numFound ?? json?.num_found) || docs.length;
  return U.result(docs.map(parseDoc).filter(Boolean), { total, page: p, hasMore: p * 20 < total && docs.length > 0 });
}

module.exports = { ...source, parseDoc, toResult, rankSubjects };
