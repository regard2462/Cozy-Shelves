// Internet Archive texts (https://archive.org) – scanned/digitised books with EPUB/PDF downloads.
// Search via advancedsearch.php, file list via the metadata API (resolved lazily at download time).
'use strict';
const U = require('./util');

const FIELDS = ['identifier', 'title', 'creator', 'year', 'date', 'language', 'subject', 'description', 'downloads', 'format', 'licenseurl', 'rights', 'publisher'];
const BASE_Q = 'mediatype:texts AND (format:epub OR format:"Text PDF" OR format:pdf) AND NOT collection:(inlibrary OR printdisabled OR lendinglibrary) AND NOT access-restricted-item:true';
const LANG_Q = { de: 'language:(ger OR German OR deu OR de)', en: 'language:(eng OR English OR en)' };
const BROWSE = {
  german: { q: 'collection:(gutenberg OR europeanlibraries OR americana OR toronto OR opensource) AND ' + LANG_Q.de, sort: 'downloads desc' },
  popular: { q: '', sort: 'downloads desc' },
  chess: { q: 'subject:(chess OR schach)', sort: 'downloads desc' },
  history: { q: 'subject:(history OR geschichte)', sort: 'downloads desc' },
  philosophy: { q: 'subject:(philosophy OR philosophie)', sort: 'downloads desc' },
  economics: { q: 'subject:(economics OR "political economy" OR wirtschaft OR volkswirtschaft)', sort: 'downloads desc' },
  politics: { q: 'subject:(politics OR "political science" OR politik)', sort: 'downloads desc' },
  travel: { q: 'subject:(travel OR "description and travel" OR reise)', sort: 'downloads desc' },
  recent: { q: '', sort: 'publicdate desc' },
};

const source = {
  id: 'archive', name: 'Internet Archive', icon: '🏛️', kind: 'books', lang: ['en', 'de', 'fr', 'la'], canSearch: true,
  description: { de: 'Millionen digitalisierter Bücher aus Bibliotheken weltweit, als Scan in PDF und EPUB (nur frei zugängliche Titel).', en: 'Millions of digitised books from libraries worldwide – scans as PDF and EPUB (freely accessible items only).' },
  chips: [
    { id: 'popular', label: { de: 'Meistgeladen', en: 'Most downloaded' } },
    { id: 'german', label: { de: 'Deutsche Bücher', en: 'German books' } },
    { id: 'recent', label: { de: 'Neu digitalisiert', en: 'Recently added' } },
    { id: 'chess', label: { de: 'Schach', en: 'Chess' } },
    { id: 'history', label: { de: 'Geschichte', en: 'History' } },
    { id: 'philosophy', label: { de: 'Philosophie', en: 'Philosophy' } },
    { id: 'economics', label: { de: 'Wirtschaft', en: 'Economics' } },
    { id: 'politics', label: { de: 'Politik', en: 'Politics' } },
    { id: 'travel', label: { de: 'Reisen', en: 'Travel' } },
  ],

  async search(query, opts, { net }) {
    const p = U.page(opts);
    const q = U.norm(query).replace(/[()"\[\]{}:]/g, ' ').trim();
    const parts = [`(${quoteWords(q)})`, BASE_Q];
    if (LANG_Q[opts?.lang]) parts.push(LANG_Q[opts.lang]);
    return toResult(await net.json(searchUrl(parts.join(' AND '), p, 'downloads desc')), p);
  },

  async browse(browseId, opts, { net }) {
    const p = U.page(opts);
    const spec = BROWSE[browseId] || BROWSE.popular;
    const parts = [BASE_Q];
    if (spec.q) parts.push(spec.q);
    if (browseId !== 'german' && LANG_Q[opts?.lang]) parts.push(LANG_Q[opts.lang]);
    return toResult(await net.json(searchUrl(parts.join(' AND '), p, spec.sort)), p);
  },

  /** Resolve `ia://<identifier>#<type>` to a concrete download URL using the metadata API. */
  async resolveFormat(format, { net }) {
    const m = /^ia:\/\/([^#]+)(?:#(\w+))?/.exec(format.url || '');
    if (!m) return format;
    const id = m[1], want = m[2] || format.type;
    const meta = await net.json(`https://archive.org/metadata/${encodeURIComponent(id)}`, { timeout: 25000 });
    const file = pickFile(meta?.files || [], want);
    if (!file) throw new Error(`Keine ${String(want).toUpperCase()}-Datei im Archiv-Eintrag ${id}`);
    return { ...format, type: want === 'auto' ? U.typeOf(file.name.split('.').pop()) || 'pdf' : want, url: `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(file.name)}`, size: Number(file.size) || null };
  },
};

function quoteWords(q) {
  // "title:(a b) OR creator:(a b) OR a b" – plain words in default fields plus title/creator boost
  const words = q.split(/\s+/).filter(Boolean).map((w) => w.replace(/[^\p{L}\p{N}'’.-]/gu, '')).filter(Boolean);
  if (!words.length) return '*';
  const j = words.join(' ');
  return `title:(${j}) OR creator:(${j}) OR subject:(${j}) OR (${j})`;
}

function searchUrl(q, page, sort) {
  const params = new URLSearchParams({ q, rows: '25', page: String(page), output: 'json' });
  for (const f of FIELDS) params.append('fl[]', f);
  if (sort) params.append('sort[]', sort);
  return 'https://archive.org/advancedsearch.php?' + params;
}

const first = (v) => (Array.isArray(v) ? v[0] : v);
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

function pickFile(files, want) {
  const byExt = (re, extra) => files.filter((f) => f && f.name && re.test(f.name) && (!extra || extra(f)));
  const notBw = (f) => !/_bw\.pdf$/i.test(f.name);
  const prefer = {
    epub: () => byExt(/\.epub$/i)[0],
    pdf: () => byExt(/\.pdf$/i, (f) => notBw(f) && !/_text\.pdf$/i.test(f.name) && f.source === 'original')[0] || byExt(/_text\.pdf$/i)[0] || byExt(/\.pdf$/i, notBw)[0] || byExt(/\.pdf$/i)[0],
    mobi: () => byExt(/\.(mobi|azw3?)$/i)[0],
    txt: () => byExt(/_djvu\.txt$/i)[0] || byExt(/\.txt$/i)[0],
  };
  if (want === 'auto') return prefer.epub() || prefer.pdf() || prefer.txt() || null;
  return prefer[want] ? prefer[want]() || null : null;
}

function parseDoc(d) {
  if (!d || !d.identifier) return null;
  const fmts = arr(d.format).map((f) => String(f).toLowerCase());
  const formats = [];
  if (fmts.some((f) => f === 'epub')) formats.push({ type: 'epub', url: `ia://${d.identifier}#epub`, label: 'EPUB' });
  if (fmts.some((f) => /pdf/.test(f))) formats.push({ type: 'pdf', url: `ia://${d.identifier}#pdf`, label: 'PDF' });
  if (!formats.length) formats.push({ type: 'auto', url: `ia://${d.identifier}#auto`, label: 'EPUB/PDF' });
  if (fmts.some((f) => /djvutxt/.test(f))) formats.push({ type: 'txt', url: `ia://${d.identifier}#txt`, label: 'Text (OCR)' });
  const year = first(d.year) || (first(d.date) ? String(first(d.date)).slice(0, 4) : null);
  const lic = first(d.licenseurl) || first(d.rights) || null;
  return U.mkItem('archive', d.identifier, {
    title: first(d.title), author: arr(d.creator).slice(0, 3).map(U.flipName).join(', '), year, language: U.langCode(first(d.language)), subjects: arr(d.subject).flatMap((s) => String(s).split(/;\s*/)),
    cover: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`, description: U.stripTags(arr(d.description).join(' ')), formats,
    readOnlineUrl: `https://archive.org/details/${encodeURIComponent(d.identifier)}`, downloads: d.downloads, license: lic ? (/publicdomain|public domain/i.test(lic) ? 'Public Domain' : /creativecommons/i.test(lic) ? 'Creative Commons' : String(lic).slice(0, 60)) : 'frei zugänglich',
    // scans carry an OCR full text (<id>_djvu.txt) – readable.js reads it, so every card can offer "Lesen"
    canRead: true,
    meta: { identifier: d.identifier, publisher: first(d.publisher) || null },
  });
}

function toResult(json, p) {
  const docs = json?.response?.docs || [];
  const total = Number(json?.response?.numFound) || docs.length;
  return U.result(docs.map(parseDoc).filter(Boolean), { total, page: p, hasMore: p * 25 < total && docs.length > 0 });
}

module.exports = { ...source, parseDoc, toResult, pickFile, searchUrl };
