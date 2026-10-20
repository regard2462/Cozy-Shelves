// The order of the books inside a shelf, the pure part: by title, author (surname), year, publisher, series (the
// volumes in their order), the latest additions or the latest read. The departments and their shelves stay where they
// are; only the books inside a shelf move (app/src/world/shelf-arrange.js applies it, setting shelves.sort).
// A series comes from the metadata (series, seriesIndex: the EPUB's calibre/EPUB 3 series, or what the cover strand's
// catalogue lookup filled in) or from the title: "Band 3", "Bd. 3", "Vol. 2", "Teil 1", "#4", "(Reihe Nr. 5)",
// "Teil II", "Zweiter Band". No Electron, no Node APIs: the renderer bundles this module as well.
'use strict';

const { fold, authorParts } = require('./duplicates');

const SORT_MODES = ['title', 'author', 'year', 'publisher', 'series', 'added', 'read'];
const collator = new Intl.Collator('de', { numeric: true });

const KEYWORD = String.raw`(?:band|bd|bde|vol|volume|teil|tl|part|pt|book|buch|nr|no|nummer|number|folge|episode|ep|tome|tomo|livre)\.?`;
const NUM = String.raw`(\d{1,4}(?:[.,]\d{1,2})?|[ivx]{1,6})`;
const SEP = String.raw`[\s,:;.–—-]`;
const ROMAN = /^(x{0,3})(ix|iv|v?i{0,3})$/i;
const ORDINAL_WORDS = { erster: 1, erste: 1, erstes: 1, zweiter: 2, zweite: 2, zweites: 2, dritter: 3, dritte: 3, drittes: 3, vierter: 4, vierte: 4, viertes: 4, 'fünfter': 5, 'fünfte': 5, 'fünftes': 5, sechster: 6, sechste: 6, sechstes: 6, siebter: 7, siebte: 7, siebenter: 7, siebtes: 7, achter: 8, achte: 8, achtes: 8, neunter: 9, neunte: 9, neuntes: 9, zehnter: 10, zehnte: 10, zehntes: 10 };
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eins: 1, zwei: 2, drei: 3, vier: 4, 'fünf': 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10 };

// "Title (Series, Band 3)", "Title [Series #4]", "Title (Band 2)"
const RE_BRACKET = new RegExp(String.raw`[(\[]\s*([^()\[\]]*?)${SEP}*(?:${KEYWORD}\s*|#\s*)${NUM}\s*[)\]]`, 'i');
// "Series, Band 3: Title", "Series Band 3", "Series - Teil II", "Series Vol. 2"
const RE_INLINE = new RegExp(String.raw`^(.*?\S)${SEP}+${KEYWORD}\s*${NUM}(?![\p{L}\p{N}])`, 'iu');
// "Series #4", "Series #4: Title"
const RE_HASH = /^(.*?\S)\s*#\s*(\d{1,4})(?!\d)/;
// "Der grüne Heinrich. Erster Band", "Krieg und Frieden, Zweiter Teil"
const RE_ORDINAL = new RegExp(String.raw`^(.*?\S)${SEP}+(${Object.keys(ORDINAL_WORDS).join('|')})\s+(?:band|teil|buch)(?![\p{L}])`, 'iu');
// "Series, Book One", "Series Part Two", "Series Teil drei"
const RE_WORD = new RegExp(String.raw`^(.*?\S)${SEP}+${KEYWORD}\s+(${Object.keys(NUMBER_WORDS).join('|')})(?![\p{L}])`, 'iu');

function numberOf(s) {
  const t = String(s || '').trim();
  if (/^\d/.test(t)) { const n = parseFloat(t.replace(',', '.')); return Number.isFinite(n) ? n : null; }
  const m = ROMAN.exec(t);
  if (!m || !t) return null;
  const val = { i: 1, v: 5, x: 10 };
  let n = 0;
  const u = t.toLowerCase();
  for (let i = 0; i < u.length; i++) { const v = val[u[i]], next = val[u[i + 1]] || 0; n += v < next ? -v : v; }
  return n > 0 ? n : null;
}
const cleanName = (s) => String(s || '').replace(/[\s,:;.–—\-([]+$/, '').replace(/^[\s,:;.–—\-)\]]+/, '').trim();

const seriesCache = new Map();
/**
 * The series and volume a title names: { name, index } or null. Numbers that are part of a title ("1848", "Kilometer
 * 451", "Zimmer 13") are no volume: only a word like Band, Teil, Vol., Nr. or a "#" in front makes one.
 */
function parseSeries(title) {
  const raw = String(title || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (seriesCache.has(raw)) return seriesCache.get(raw);
  let res = null;
  let m = RE_BRACKET.exec(raw);
  if (m) {
    const index = numberOf(m[2]);
    const name = cleanName(m[1]) || cleanName(raw.slice(0, m.index));
    if (index != null && name) res = { name, index };
  }
  if (!res && (m = RE_INLINE.exec(raw))) { const index = numberOf(m[2]); const name = cleanName(m[1]); if (index != null && name) res = { name, index }; }
  if (!res && (m = RE_HASH.exec(raw))) { const name = cleanName(m[1]); if (name) res = { name, index: Number(m[2]) }; }
  if (!res && (m = RE_ORDINAL.exec(raw))) { const name = cleanName(m[1]); if (name) res = { name, index: ORDINAL_WORDS[m[2].toLowerCase()] }; }
  if (!res && (m = RE_WORD.exec(raw))) { const name = cleanName(m[1]); if (name) res = { name, index: NUMBER_WORDS[m[2].toLowerCase()] }; }
  if (seriesCache.size > 20000) seriesCache.clear();
  seriesCache.set(raw, res);
  return res;
}
/** The series key for grouping: folded, without punctuation. */
const seriesKey = (name) => fold(name).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** A book's series: the metadata (series, seriesIndex), else the title. { key, name, index } or null. */
function seriesOf(b) {
  if (!b) return null;
  if (b.series && String(b.series).trim()) {
    const idx = Number(b.seriesIndex);
    return { key: seriesKey(b.series), name: String(b.series).trim(), index: Number.isFinite(idx) ? idx : (parseSeries(b.title)?.index ?? null) };
  }
  const p = parseSeries(b.title);
  return p ? { key: seriesKey(p.name), name: p.name, index: p.index } : null;
}

/** The author as a library sorts it: "surname given names", as written ('' without an author). */
function authorSortKey(author) {
  const p = authorParts(author);
  return p ? `${p.last} ${p.first}`.replace(/\s+/g, ' ').trim().toLowerCase() : '';
}
/** The publisher without its legal form ("Verlag", "GmbH", "Inc.", "Publishing"): "Rowohlt Taschenbuch Verlag GmbH" → "rowohlt taschenbuch". */
function publisherKey(p) {
  return fold(p).replace(/\b(?:verlag|verlagsgruppe|verlagsgesellschaft|gmbh|co|kg|ag|ohg|mbh|inc|ltd|llc|plc|publishing|publishers?|press|books|edition|editions)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

const byText = (a, b) => collator.compare(a || '', b || '');
const byTitle = (a, b) => byText(a.title, b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** Books with the value first (in its order), the books without it after them by title. */
const present = (va, vb) => (va ? 0 : 1) - (vb ? 0 : 1);
/** Inside a series: the volumes in their order, a volume without a number after them. */
function bySeries(a, b) {
  const sa = seriesOf(a), sb = seriesOf(b);
  const d = present(sa, sb);
  if (d || !sa) return d;
  return byText(sa.key, sb.key) || ((sa.index ?? Infinity) - (sb.index ?? Infinity)) || 0;
}

/** The comparator of a sort mode (SORT_MODES); every one ends on the title and the id, so the order is stable. */
function compareFor(mode) {
  switch (mode) {
    case 'author': return (a, b) => {
      const ka = authorSortKey(a.author), kb = authorSortKey(b.author);
      return present(ka, kb) || byText(ka, kb) || bySeries(a, b) || byTitle(a, b);
    };
    case 'year': return (a, b) => {
      const ya = Number(a.year) || 0, yb = Number(b.year) || 0;
      return present(ya, yb) || (ya - yb) || byTitle(a, b);
    };
    case 'publisher': return (a, b) => {
      const pa = publisherKey(a.publisher), pb = publisherKey(b.publisher);
      return present(pa, pb) || byText(pa, pb) || bySeries(a, b) || byTitle(a, b);
    };
    case 'series': return (a, b) => bySeries(a, b) || byTitle(a, b);
    case 'added': return (a, b) => ((b.born || b.addedAt || 0) - (a.born || a.addedAt || 0)) || byTitle(a, b);
    case 'read': return (a, b) => present(a.lastRead, b.lastRead) || ((b.lastRead || 0) - (a.lastRead || 0)) || byTitle(a, b);
    default: return byTitle;
  }
}

/** The ids of a shelf in the order of `mode` (unknown ids keep their place at the end). */
function sortIds(ids, booksById, mode = 'title') {
  const known = [], unknown = [];
  for (const id of ids || []) { const b = booksById?.[id]; if (b) known.push(b); else unknown.push(id); }
  known.sort(compareFor(SORT_MODES.includes(mode) ? mode : 'title'));
  return [...known.map((b) => b.id), ...unknown];
}

module.exports = { SORT_MODES, parseSeries, seriesOf, seriesKey, authorSortKey, publisherKey, compareFor, sortIds };
