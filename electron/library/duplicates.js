// Duplicate books, the pure part: the same book in several folders or formats. Three kinds of evidence, each strict
// enough that two volumes of a series or two different books never meet:
//  • 'file'  the same file twice (same size and the same first 64 KB, library.js contentHash),
//  • 'isbn'  the same ISBN, when the titles share a word and the authors do not differ,
//  • 'title' the same title and author once file-name parts (a note of a download site like "(example.org)", the parts
//    after " -- ", hashes), edition notes
//    ("2. Auflage", "Third Edition"), umlauts and punctuation are set aside, and no two different years.
// Two editions with different years are duplicates only by their file or their ISBN. library.js groups the copies
// (findDuplicates), the shelves show one of them (preferredCopy, app/src/world/shelf-arrange.js), nothing is deleted.
// No Electron, no Node APIs: the renderer bundles this module as well.
'use strict';

/** Lower case, ß → ss, no accents and no umlaut dots; "ue" reads like "ü" and "u" ("Buecher" = "Bücher" = "Bucher"). */
function fold(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ø/g, 'o').replace(/([aou])e/g, '$1');
}

// parts of file names that are no title: the scheme of some download sites ("Title -- Author -- Year -- Publisher --
// hash -- Source"), a site's note in brackets ("(example.org)", "[example.net]") or alone ("example.org"), format and
// scan notes, file hashes, copies made by Windows ("Buch (1)", "Buch - Kopie"). A note counts as a site when it has the
// form of a domain in lower case; "(St.Gallen)" or "(vol.ii)" do not.
const JUNK = [
  /\s+--\s.*$/,
  /[([{]\s*(?:e-?book|epub|pdf|mobi|azw3?|retail|scan|ocr)\s*[)\]}]/gi,
  /[([{]\s*(?:[a-z0-9][a-z0-9-]*\.)+(?![ivxlcdm]+\s*[)\]}])[a-z]{2,6}\s*[)\]}]/g,
  /(?<![\w.@/-])(?:[a-z0-9][a-z0-9-]*\.)+(?:org|com|net|info|rs|is|li|st|se|to|cc|ru)(?![\w.])/g,
  /\b[0-9a-f]{32,40}\b/gi,
  /\s*\(\d{1,2}\)\s*$/,
  /\s*[-–]\s*(?:kopie|copy)(?:\s*\(\d+\))?\s*$/i,
  /^(?:kopie von|copy of)\s+/i,
];
// edition notes: in brackets anywhere, or at the end after a separator
const EDITION_BRACKETS = /[([{][^)\]}]*\b(?:auflage|aufl|ausgabe|edition|edn|neuauflage|nachdruck|reprint|kindle)\b[^)\]}]*[)\]}]/gi;
const ORDINALS = 'first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|erste|zweite|dritte|vierte|fünfte|sechste|siebte|achte|neunte|zehnte';
const EDITION_ADJ = 'überarbeitete|aktualisierte|erweiterte|ergänzte|durchgesehene|verbesserte|korrigierte|neu bearbeitete|vollständig überarbeitete|revised|updated|expanded|enlarged|illustrated|annotated|anniversary|international|special|kindle|deluxe|collector[\'’]?s';
const EDITION_TAIL = new RegExp(`[\\s,.:;–—-]+(?:(?:\\d+(?:st|nd|rd|th)?\\.?\\s*,?\\s*)|(?:(?:${ORDINALS})\\s+))?(?:(?:${EDITION_ADJ})\\s+)*(?:auflage|aufl\\.?|ausgabe|edition|edn\\.?)\\s*$`, 'i');
const EDITION_WORD = /[\s,.:;–—-]+(?:neuauflage|sonderausgabe|taschenbuchausgabe|taschenbuch|jubiläumsausgabe|lizenzausgabe|erstausgabe|e-?book-ausgabe|kindle-ausgabe|ungekürzte ausgabe|vollständige ausgabe|ungekürzt|unabridged|reprint|nachdruck)\s*$/i;
const ARTICLE_HEAD = /^(?:der|die|das|ein|eine|the|a|an|le|la|les|el|il)\s+/;
const ARTICLE_TAIL = /\s+(?:der|die|das|the|a|an)$/;

const titleCache = new Map();
/**
 * The title as two copies of one book have it in common. Numbers stay ("Band 2" and "Band 3" never meet), so do
 * subtitles: "Walden" and "Walden: Life in the Woods" are two keys (a subtitle often names another volume).
 */
function titleKey(title) {
  const raw = String(title || '');
  let k = titleCache.get(raw);
  if (k !== undefined) return k;
  let s = raw.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  for (const re of JUNK) s = s.replace(re, ' ').trim();
  s = s.replace(EDITION_BRACKETS, ' ').trim();
  for (let i = 0; i < 3; i++) { const t = s.replace(EDITION_TAIL, '').replace(EDITION_WORD, '').trim(); if (t === s || !t) break; s = t; }
  k = fold(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(ARTICLE_HEAD, '').replace(ARTICLE_TAIL, '').trim();
  if (titleCache.size > 20000) titleCache.clear();
  titleCache.set(raw, k);
  return k;
}

const PARTICLE = /^(?:von|van|de|der|den|du|la|le|di|da|del|zu|vom|ten|ter)$/i;
const HONORIFIC = /^(?:dr|prof|phd|md|jr|sr|ii|iii|iv|hrsg|ed|eds|hg|mag|dipl|ing|mba|sir|dame|u\.?a|et al)\.?$/i;
const authorCache = new Map();
/**
 * The first author as { surname, given } ("Hoffmann, Ernst Theodor Amadeus", "Ernst Theodor Amadeus Hoffmann", "E. T. A.
 * Hoffmann" alike), or null.
 * Further authors ("A and B", "A; B", "A / B", "A, B, C") are left out.
 */
function authorParts(author) {
  const raw = String(author || '');
  if (authorCache.has(raw)) return authorCache.get(raw);
  let a = raw.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/_/g, ' ').replace(/\bet\s+al\.?/gi, ' ').replace(/\s+/g, ' ').trim();
  a = a.split(/\s*;\s*|\s+(?:and|und|&|et|y|u\.)\s+|\s*\/\s*/i)[0] || '';
  let surname = '', given = '';
  const parts = a.split(',').map((x) => x.trim()).filter(Boolean);
  const words = (x) => x.split(/\s+/).filter((w) => w && !HONORIFIC.test(w));
  if (parts.length >= 2) {
    const x = words(parts[0]), y = words(parts[1]);
    // "Fontane, Theodor", "von Droste-Hülshoff, Annette" (a surname first) or "Theodor Fontane, Theodor Storm" (a list)
    if (y.length && y.length <= 3 && (x.length === 1 || (x.length === 2 && PARTICLE.test(x[0])))) { surname = x[x.length - 1]; given = y.join(' '); }
    else a = parts[0];
  }
  if (!surname) {
    const w = words(a);
    if (w.length) { surname = w[w.length - 1]; given = w.slice(0, -1).filter((x) => !PARTICLE.test(x)).join(' '); }
  }
  const sur = fold(surname).replace(/[^\p{L}\p{N}]+/gu, '');
  // surname/given folded for comparing, last/first as written for sorting (the collator orders "Goethe" before "Gorki")
  const res = sur.length >= 2 ? { surname: sur, given: fold(given).replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim(), last: surname, first: given } : null;
  if (authorCache.size > 20000) authorCache.clear();
  authorCache.set(raw, res);
  return res;
}
/** Two authors are the same person: the same surname, and the first given names do not start differently. */
function sameAuthor(a, b) {
  if (!a || !b || a.surname !== b.surname) return false;
  const ia = a.given.charAt(0), ib = b.given.charAt(0);
  return !ia || !ib || ia === ib;
}

/** ISBN-13 digits ("978-3-16-148410-0", an ISBN-10 converted), or null. */
function isbnKey(isbn) {
  const d = String(isbn || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  if (d.length === 13 && /^97[89]\d{10}$/.test(d)) return d;
  if (d.length === 10 && /^\d{9}[\dX]$/.test(d)) {
    const core = '978' + d.slice(0, 9);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 ? 3 : 1);
    return core + ((10 - (sum % 10)) % 10);
  }
  return null;
}

const STOP = new Set(['der', 'die', 'das', 'und', 'oder', 'ein', 'eine', 'fur', 'mit', 'von', 'the', 'and', 'for', 'with', 'from', 'band', 'teil', 'volume', 'book', 'buch']);
const words = (key) => key.split(' ').filter((w) => w.length >= 4 && !STOP.has(w));

/**
 * Groups of copies of the same book. books: records with id, title, author, year, isbn, contentHash, size.
 * @returns { groups: [{ id, ids, reasons }], groupOf: Map(id → group) } — only groups of two or more; a group's id is
 *          the smallest id in it, `reasons` the kinds of evidence that joined it ('file', 'isbn', 'title').
 */
function findDuplicates(books) {
  const list = (books || []).filter((b) => b && b.id && !b.missing);
  const parent = new Map(list.map((b) => [b.id, b.id]));
  const why = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b, reason) => {
    const ra = find(a), rb = find(b);
    const r = new Set([...(why.get(ra) || []), ...(why.get(rb) || []), reason]);
    if (ra !== rb) parent.set(rb, ra);
    why.set(ra, r);
  };
  const bucket = (map, key, b) => { if (!key) return; const arr = map.get(key); if (arr) arr.push(b); else map.set(key, [b]); };
  const byHash = new Map(), byIsbn = new Map(), byTitle = new Map();
  const info = new Map();
  for (const b of list) {
    const t = titleKey(b.title), au = authorParts(b.author);
    info.set(b.id, { t, au, year: Number(b.year) || null });
    if (b.contentHash) bucket(byHash, b.contentHash + ':' + (b.size || ''), b);
    bucket(byIsbn, isbnKey(b.isbn), b);
    if (t.length >= 2 && au) bucket(byTitle, t + '|' + au.surname, b);
  }
  for (const arr of byHash.values()) for (let i = 1; i < arr.length; i++) union(arr[0].id, arr[i].id, 'file');
  const pairs = (arr, ok, reason) => { for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) if (ok(info.get(arr[i].id), info.get(arr[j].id))) union(arr[i].id, arr[j].id, reason); };
  // an ISBN found in a book's text may belong to another book: the titles have to share a word, the authors may not differ
  for (const arr of byIsbn.values()) if (arr.length > 1 && arr.length <= 12) pairs(arr, (x, y) => {
    if (x.au && y.au && !sameAuthor(x.au, y.au)) return false;
    const wy = new Set(words(y.t));
    return words(x.t).some((w) => wy.has(w));
  }, 'isbn');
  for (const arr of byTitle.values()) if (arr.length > 1 && arr.length <= 12) pairs(arr, (x, y) => sameAuthor(x.au, y.au) && (!x.year || !y.year || x.year === y.year), 'title');
  const members = new Map();
  for (const b of list) { const r = find(b.id); const arr = members.get(r); if (arr) arr.push(b.id); else members.set(r, [b.id]); }
  const groups = [];
  const groupOf = new Map();
  for (const [root, ids] of members) {
    if (ids.length < 2) continue;
    ids.sort();
    const g = { id: ids[0], ids, reasons: [...(why.get(root) || [])].sort() };
    groups.push(g);
    for (const id of ids) groupOf.set(id, g);
  }
  groups.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { groups, groupOf };
}

/** EPUB before PDF before the rest: the order in which a copy is preferred for the shelf. */
const FORMAT_RANK = { epub: 0, pdf: 1, azw3: 2, mobi: 3, fb2: 4, cbz: 5, docx: 6, html: 7, md: 8, rtf: 9, txt: 10 };
const rankOf = (b) => FORMAT_RANK[b?.format] ?? 11;
const reading = (b) => ((Number(b?.progress) || 0) > 0.005 || (Number(b?.readingSeconds) || 0) > 0 || !!b?.finishedAt ? 1 : 0);
/**
 * The copy the shelf shows: the one being read (the latest), else the preferred format (EPUB, PDF, others), then one with
 * a cover, then the shorter path. Deterministic for the same records.
 */
function preferredCopy(copies) {
  let best = null;
  for (const b of copies || []) {
    if (!b) continue;
    if (!best) { best = b; continue; }
    const d = (reading(b) - reading(best)) || ((b.lastRead || 0) - (best.lastRead || 0)) || (rankOf(best) - rankOf(b))
      || ((b.hasCover !== false ? 1 : 0) - (best.hasCover !== false ? 1 : 0))
      || (String(best.relPath || best.path || '').length - String(b.relPath || b.path || '').length)
      || (String(best.id) < String(b.id) ? -1 : 1);
    if (d > 0) best = b;
  }
  return best;
}

module.exports = { fold, titleKey, authorParts, sameAuthor, isbnKey, findDuplicates, preferredCopy, FORMAT_RANK };
