// Shared helpers for the catalog sources (item construction, name/format normalisation).
'use strict';
const C = require('../../feeds/common');

const MIME_TYPE = [
  [/epub/i, 'epub'], [/pdf/i, 'pdf'], [/mobipocket|x-mobi|kindle|azw/i, 'mobi'], [/html/i, 'html'], [/plain|text\/txt|^text$/i, 'txt'], [/rss|xml\+rss|audio/i, 'audio-rss'],
];
/** Map a MIME type or file extension to the catalog format type. */
function typeOf(mimeOrExt) {
  const s = String(mimeOrExt || '').toLowerCase();
  if (/kepub/.test(s)) return null; // Kobo variant – not useful here
  for (const [re, t] of MIME_TYPE) if (re.test(s)) return t;
  return null;
}
const EXT = { epub: 'epub', pdf: 'pdf', mobi: 'mobi', html: 'html', txt: 'txt', 'audio-rss': 'rss' };
const FORMAT_PRIORITY = ['auto', 'epub', 'pdf', 'mobi', 'html', 'txt', 'audio-rss'];
function sortFormats(formats) {
  return [...formats].sort((a, b) => FORMAT_PRIORITY.indexOf(a.type) - FORMAT_PRIORITY.indexOf(b.type));
}

/** "Joyce, James" → "James Joyce"; "Goethe, Johann Wolfgang von" → "Johann Wolfgang von Goethe". */
function flipName(name) {
  name = C.collapseWs(name).replace(/\s*\(\s*(\d{3,4}|ca\.|b\.|d\.)[^)]*\)\s*$/i, ''); // "(1888-1942)"
  const parts = name.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return name.replace(/,\s*$/, '');
  const [last, first, ...rest] = parts;
  if (/\d/.test(first) || /^(jr|sr|junior|senior)\.?$/i.test(first)) return C.collapseWs(last + (/\d/.test(first) ? '' : ' ' + first));
  // trailing life dates ("Lasker, Emanuel, 1868-1941") are dropped, other suffixes ("Jr.") kept
  const suffix = rest.filter((r) => !/\d/.test(r) && !/^(b|d|fl|ca)\.?$/i.test(r)).join(' ');
  return C.collapseWs(`${first} ${last}${suffix ? ' ' + suffix : ''}`);
}

const LANG_NAMES = { de: 'Deutsch', en: 'English', fr: 'Français', es: 'Español', it: 'Italiano', la: 'Latina', nl: 'Nederlands', pt: 'Português', ru: 'Русский', el: 'Ελληνικά', sv: 'Svenska', da: 'Dansk', pl: 'Polski', cs: 'Čeština', hu: 'Magyar', fi: 'Suomi', no: 'Norsk', zh: '中文', ja: '日本語' };
const LANG_CODES = { german: 'de', deutsch: 'de', ger: 'de', deu: 'de', english: 'en', eng: 'en', french: 'fr', fre: 'fr', fra: 'fr', spanish: 'es', spa: 'es', italian: 'it', ita: 'it', latin: 'la', lat: 'la', dutch: 'nl', dut: 'nl', nld: 'nl', portuguese: 'pt', por: 'pt', russian: 'ru', rus: 'ru', greek: 'el', gre: 'el', ell: 'el', swedish: 'sv', swe: 'sv', danish: 'da', dan: 'da', polish: 'pl', pol: 'pl', czech: 'cs', cze: 'cs', ces: 'cs', hungarian: 'hu', hun: 'hu', finnish: 'fi', fin: 'fi', norwegian: 'no', nor: 'no', chinese: 'zh', chi: 'zh', zho: 'zh', japanese: 'ja', jpn: 'ja' };
/** Normalise a language value ("German", "ger", "de-DE", ["eng"]) to a 2-letter code where possible. */
function langCode(v) {
  if (Array.isArray(v)) v = v[0];
  if (!v) return null;
  let s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (LANG_CODES[s]) return LANG_CODES[s];
  s = s.split(/[-_;,]/)[0];
  if (LANG_CODES[s]) return LANG_CODES[s];
  return s.length === 2 ? s : s.slice(0, 2);
}
function langName(code) { return LANG_NAMES[code] || (code ? code.toUpperCase() : ''); }

function stripTags(s) { return C.htmlToText(s || ''); }

/** Build a catalog item with all fields present (defensive defaults). */
function mkItem(source, localId, f = {}) {
  const formats = sortFormats((f.formats || []).filter((x) => x && x.url && x.type));
  return {
    id: `${source}:${localId}`, source,
    title: C.collapseWs(f.title || '') || '(ohne Titel)',
    author: C.collapseWs(f.author || '') || null,
    year: f.year != null && String(f.year).trim() ? String(f.year).trim().slice(0, 4) : null,
    language: f.language || null,
    // the panel shows the first few and expands the rest on demand, so keep a generous list here
    subjects: (f.subjects || []).map((s) => C.collapseWs(String(s))).filter(Boolean).slice(0, 40),
    cover: f.cover || null,
    description: C.collapseWs(f.description || '').slice(0, 1500) || null,
    formats,
    readOnlineUrl: f.readOnlineUrl || null,
    downloads: f.downloads != null ? Number(f.downloads) || 0 : null,
    license: f.license || null,
    canRead: !!f.canRead,
    kind: f.kind || 'book',
    meta: f.meta || {},
    extra: f.extra || null,
  };
}

const page = (opts) => Math.max(1, parseInt(opts?.page, 10) || 1);
const norm = (q) => C.collapseWs(q || '');
function result(items, { total = null, page = 1, hasMore = false, note = null } = {}) { return { items, total, page, hasMore: !!hasMore, note }; }

module.exports = { typeOf, EXT, sortFormats, flipName, langCode, langName, stripTags, mkItem, page, norm, result };
