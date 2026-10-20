// Records of book catalogues (Open Library, Apple Books, the Deutsche Nationalbibliothek, Google Books) matched against
// a book of the library: the title words (subtitles, edition notes, titles cut off in a file name), the volume, the
// author's surname, the ISBN, the language and the kind of publication (no audio book, no summary of the book). Also
// the metadata a matched record adds to a book (author, year, publisher, ISBN, language, series and volume). The pure
// part: no network, no Electron (web-covers.js asks the catalogues, test-cover-sources.js tests this with recorded
// answers).
'use strict';
const { words, cleanTitle, firstAuthor, looksLikeName, titleLanguage } = require('./cover-match');

// ---------------------------------------------------------------- language -------------------------------------------
const LANG2 = new Set('de en fr es it nl pt pl ru sv da no nb nn fi cs sk sl hr sr hu ro bg uk el tr la ca eu gl et lv lt is ga cy ja zh ko ar he hi fa id ms th vi'.split(' '));
const LANG3 = { ger: 'de', deu: 'de', gsw: 'de', eng: 'en', fre: 'fr', fra: 'fr', spa: 'es', ita: 'it', dut: 'nl', nld: 'nl', por: 'pt', pol: 'pl', rus: 'ru', swe: 'sv', dan: 'da', nor: 'no', nob: 'no', nno: 'no', fin: 'fi', cze: 'cs', ces: 'cs', slo: 'sk', slk: 'sk', hun: 'hu', rum: 'ro', ron: 'ro', gre: 'el', ell: 'el', tur: 'tr', lat: 'la', cat: 'ca', jpn: 'ja', chi: 'zh', zho: 'zh', kor: 'ko', ara: 'ar', heb: 'he', ukr: 'uk' };
const LANG_NAME = { german: 'de', deutsch: 'de', english: 'en', englisch: 'en', french: 'fr', français: 'fr', francais: 'fr', französisch: 'fr', spanish: 'es', español: 'es', spanisch: 'es', italian: 'it', italiano: 'it', italienisch: 'it', dutch: 'nl', nederlands: 'nl', niederländisch: 'nl' };
/** 'de', 'de-DE', 'ger', 'German' → 'de'; anything else (garbage from PDF metadata, '<¦', 'Germa') → null. */
function normLang(v) {
  const s = String(Array.isArray(v) ? v[0] || '' : v || '').trim().toLowerCase();
  if (!s) return null;
  const m = /^([a-z]{2})(?:[-_][a-z0-9]{2,8})*$/.exec(s);
  if (m) return LANG2.has(m[1]) ? (m[1] === 'nb' || m[1] === 'nn' ? 'no' : m[1]) : null;
  return LANG3[s] || LANG_NAME[s] || null;
}
/** A rough language of a longer text (a blurb), for records that carry none. */
function textLanguage(text) {
  const t = ' ' + String(text || '').toLowerCase().replace(/<[^>]*>/g, ' ').slice(0, 3000) + ' ';
  const count = (list) => list.reduce((n, w) => n + (t.split(w).length - 1), 0);
  const de = count([' und ', ' der ', ' die ', ' das ', ' nicht ', ' ist ', ' mit ', ' sich ', ' auch ', ' eine ', ' für ', ' wie ']);
  const en = count([' the ', ' and ', ' of ', ' to ', ' is ', ' with ', ' that ', ' this ', ' are ', ' for ', ' your ', ' you ']);
  if (de + en < 4) return null;
  return de > en * 1.5 ? 'de' : en > de * 1.5 ? 'en' : null;
}

// ---------------------------------------------------------------- ISBN -----------------------------------------------
function valid13(d) { let s = 0; for (let i = 0; i < 12; i++) s += (i % 2 ? 3 : 1) * +d[i]; return (10 - (s % 10)) % 10 === +d[12]; }
function valid10(d) { let s = 0; for (let i = 0; i < 9; i++) s += (10 - i) * +d[i]; return (s + (d[9] === 'X' ? 10 : +d[9])) % 11 === 0; }
/** An ISBN in its 13-digit form ("3-16-148410-X" → "9783161484100"), null when it is none. */
function isbn13(v) {
  const d = String(v || '').toUpperCase().replace(/[^0-9X]/g, '');
  if (d.length === 13 && /^97[89]\d{10}$/.test(d) && valid13(d)) return d;
  if (d.length === 10 && /^\d{9}[\dX]$/.test(d) && valid10(d)) {
    const core = '978' + d.slice(0, 9);
    let s = 0;
    for (let i = 0; i < 12; i++) s += (i % 2 ? 3 : 1) * +core[i];
    return core + ((10 - (s % 10)) % 10);
  }
  return null;
}
const isbnList = (list) => [...new Set((Array.isArray(list) ? list : [list]).map(isbn13).filter(Boolean))];
/** The ISBN-10 of an ISBN (Amazon's pictures go by it); null for a 979 ISBN, which has none. */
function isbn10(v) {
  const d = isbn13(v);
  if (!d || !d.startsWith('978')) return null;
  const core = d.slice(3, 12);
  let s = 0;
  for (let i = 0; i < 9; i++) s += (10 - i) * +core[i];
  const c = (11 - (s % 11)) % 11;
  return core + (c === 10 ? 'X' : String(c));
}
// Amazon's number of an edition (Kindle editions have no ISBN): many file names carry it, "… (B0XAMPLE12).pdf"
const ASIN = /\b(B0[0-9A-Z]{8})\b/;

// ---------------------------------------------------------------- titles ---------------------------------------------
const sameWord = (a, b) => a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)));
/** Share of the words of `need` that occur in `have` (a long word also counts when one starts with the other). */
function coverage(need, have) {
  if (!need.length) return 0;
  let n = 0;
  for (const w of need) if (have.some((x) => sameWord(w, x))) n++;
  return n / need.length;
}
/** The words of `a` are the first words of `b`, in their order. */
const isPrefixOf = (a, b) => a.length > 0 && a.length <= b.length && a.every((w, i) => sameWord(w, b[i]));
/** Enough of a title to name one book: "Die Leiden des jungen Werthers" is, "Der Sandmann" or "Strategie" is not. */
const distinctive = (ws) => { const n = ws.join('').length; return (ws.length >= 3 && n >= 16) || (ws.length >= 2 && n >= 19); };

// what editions and shops add to a title
const EDITION = new RegExp([
  String.raw`\(\s*(?:german|english|deutsche?|englische?)\s+(?:edition|ausgabe)\s*\)`,
  String.raw`\b\d{1,2}(?:st|nd|rd|th)?\.?\s*(?:auflage|aufl\.|edition|ed\.|ausgabe)`,
  String.raw`\b(?:first|second|third|fourth|fifth|sixth|revised|updated|expanded|new|international|special|anniversary|kindle|german|english|illustrated|annotated|deluxe|20th anniversary|25th anniversary|erweiterte|überarbeitete|ueberarbeitete|aktualisierte|neue|vollständig überarbeitete|ungekürzte|ungekuerzte|deutsche)\s+(?:edition|ausgabe|auflage|neuausgabe|fassung)`,
  String.raw`\b(?:neuausgabe|sonderausgabe|taschenbuchausgabe|lizenzausgabe|jubiläumsausgabe|e-?book|epub|mobi|azw3?|kindle|hardcover|paperback|taschenbuch|gebundene ausgabe|ungekürzt|ungekuerzt|unabridged)\b`,
].join('|'), 'gi');

const ORDINAL = { erster: 1, erste: 1, ersten: 1, zweiter: 2, zweite: 2, zweiten: 2, dritter: 3, dritte: 3, dritten: 3, vierter: 4, vierte: 4, fünfter: 5, fuenfter: 5, fünfte: 5, sechster: 6, siebter: 7, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7 };
const NUMWORD = { eins: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
function roman(s) {
  const v = { i: 1, v: 5, x: 10, l: 50, c: 100 };
  const t = String(s).toLowerCase();
  if (!/^[ivxlc]+$/.test(t)) return null;
  let n = 0;
  for (let i = 0; i < t.length; i++) { const a = v[t[i]], b = v[t[i + 1]] || 0; n += a < b ? -a : a; }
  return n > 0 && n < 200 ? n : null;
}
const VOL_WORD = '(?:band|bd|teil|tl|vol|volume|buch|book|part|tome|tomo|folge|heft|nr|no|nummer|number)';
const VOL_PATTERNS = [
  // "Band 3", "Bd. 3", "Vol. II", "Book 2", "Teil 1", "Nr. 5"
  [new RegExp(String.raw`\b${VOL_WORD}\.?\s*(\d{1,3}|[ivxlc]{1,6})\b`, 'i'), (m) => (/^\d+$/.test(m[1]) ? +m[1] : roman(m[1]))],
  // "3. Band", "1. Teil"
  [/\b(\d{1,3})\.\s*(?:band|teil|buch|folge)\b/i, (m) => +m[1]],
  // "erster Teil", "Second Book"
  [new RegExp(String.raw`\b(${Object.keys(ORDINAL).join('|')})\s+(?:band|teil|buch|book|part|volume)\b`, 'i'), (m) => ORDINAL[m[1].toLowerCase()]],
  // "Band zwei", "Book Three"
  [new RegExp(String.raw`\b(?:band|teil|buch|book|part|volume)\s+(${Object.keys(NUMWORD).join('|')})\b`, 'i'), (m) => NUMWORD[m[1].toLowerCase()]],
  // "#4", "(Lotta Haldenbruck 3)" at the end
  [/#\s*(\d{1,3})\b/, (m) => +m[1]],
  [/\((?:[^()]*?\s)?(\d{1,3})\)\s*$/, (m) => +m[1]],
];
/** The volume a title names ("Band 3", "Vol. II", "erster Teil", "#4"), null when none. */
function volumeOf(t) {
  for (const [re, f] of VOL_PATTERNS) { const m = re.exec(String(t || '')); if (m) { const v = f(m); if (v) return v; } }
  return null;
}
const stripVolume = (t) => VOL_PATTERNS.reduce((s, [re]) => s.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), ' '), String(t || ''));

// a title ending with one of these words was cut off ("Practical Exercises and")
const TRAIL = new Set('and or of the a an for to in on with by at from as und oder der die das des dem den ein eine einer eines mit für fur im zum zur von vom auf aus bei als de la le et du el y'.split(' '));
/**
 * What a title is made of: the whole title without what files and shops add (edition notes, "(example.org)", a year),
 * its words, the words of the main title and of the subtitle, the volume, and whether it looks cut off.
 */
function titleInfo(raw, sub = '') {
  let t = String(raw || '').replace(/[\u0098\u009c]/g, '').replace(/&#15[26];/g, '');
  t = cleanTitle(t).replace(EDITION, ' ').replace(/\(\s*\)|\[\s*\]/g, ' ').replace(/\s+/g, ' ').trim();
  let s = String(sub || '').replace(/[\u0098\u009c]/g, '').replace(EDITION, ' ').replace(/\s+/g, ' ').trim();
  const volume = volumeOf(t + ' ' + s);
  let main = t;
  if (!s) {
    // "Main: Sub", "Main - Sub", "Main. Sub", "Main (Sub)", "Main, or Sub"
    const m = /^(.+?)(?:\s*:\s+|\s+[-–—]\s+|\.\s+(?=\p{Lu})|,\s+(?:or|oder)\s+|\s*\((?!\d{1,3}\)))(.+)$/u.exec(t);
    if (m && words(m[1]).length) { main = m[1]; s = m[2].replace(/\)\s*$/, ''); }
  }
  const all = words(stripVolume(t + (sub ? ' ' + s : '')));
  const lastRaw = (t.split(/\s+/).pop() || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return { text: t, all, main: words(stripVolume(main)), sub: words(stripVolume(s)), volume, cut: TRAIL.has(lastRaw) || t.length >= 70 };
}

/**
 * The title score of a record for a book, 0 … 1, with how it was reached:
 *   same       the same words
 *   main       the same main title, one of the two without a subtitle
 *   prefix+sub the record's main title starts the book's title and the rest is the record's subtitle (cut off or not)
 *   prefix     the record's main title starts the book's title, the record has no subtitle (a distinctive title only)
 *   cut        the book's title (cut off in the file name) starts the record's title
 */
function titleScore(bk, ck) {
  const B = bk.all, C = ck.all;
  if (!B.length || !C.length) return { score: 0, how: 'empty', distinct: false };
  const inC = coverage(B, C), inB = coverage(C, B);
  if (inC >= 0.85 && inB >= 0.85) return { score: 1, how: 'same', distinct: distinctive(B) };
  if (coverage(bk.main, ck.main) === 1 && coverage(ck.main, bk.main) === 1 && (!bk.sub.length || !ck.sub.length)) return { score: 0.95, how: 'main', distinct: distinctive(bk.main) };
  if (isPrefixOf(ck.main, B)) {
    const rest = B.slice(ck.main.length);
    if (ck.sub.length && coverage(rest, ck.sub) >= 0.75) return { score: 0.95, how: 'prefix+sub', distinct: distinctive(B) };
    if (!ck.sub.length) return { score: distinctive(ck.main) ? 0.9 : 0.6, how: 'prefix', distinct: distinctive(ck.main) };
  }
  if (bk.cut && isPrefixOf(B, C) && distinctive(B)) return { score: 0.9, how: 'cut', distinct: true };
  return { score: Math.round(Math.min(inC, inB) * 0.8 * 100) / 100, how: 'words', distinct: false };
}

// ---------------------------------------------------------------- authors --------------------------------------------
/** "Fontane, Theodor" → "Theodor Fontane" (a single name stays). */
function personName(s) {
  const t = String(s || '').replace(/[\u0098\u009c]/g, '').replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim();
  const p = t.split(',').map((x) => x.trim()).filter(Boolean);
  if (p.length === 2 && p[0].split(/\s+/).length <= 3 && p[1].split(/\s+/).length <= 3 && !/^(?:jr|sr|ii|iii)\.?$/i.test(p[1])) return p[1] + ' ' + p[0];
  return p.length >= 2 && /^(?:jr|sr)\.?$/i.test(p[p.length - 1]) ? p.slice(0, -1).join(', ') : t;
}
/** The names of a credit line: "Maren Holloway & Tobias Fairweather", "A und B", "A; B", "Ann Lee, Bo Chen" (not "Lee, Ann"). */
function splitNames(s) {
  const out = [];
  for (const part of String(s || '').split(/\s*(?:;|&|\/|\bund\b|\band\b|\bmit\b|\bwith\b)\s*/i)) {
    const p = part.trim();
    if (!p) continue;
    const c = p.split(',').map((x) => x.trim()).filter(Boolean);
    if (c.length >= 2 && c.every((x) => x.split(/\s+/).length >= 2)) out.push(...c); else out.push(p);
  }
  return out;
}
/** The surnames of a book's author field (words folded like the titles). */
function surnames(author) {
  const out = [];
  for (const n of splitNames(author)) {
    const w = words(personName(n));
    if (w.length) out.push(w[w.length - 1]);
  }
  return [...new Set(out)];
}
/** 1: the record names the book's author, -1: it names others, 0: one of the two names nobody. */
function authorMatch(bk, rec) {
  if (!bk.surnames.length || !rec.authors?.length) return 0;
  const have = words(rec.authors.map(personName).join(' '));
  return bk.surnames.some((s) => have.some((w) => sameWord(s, w))) ? 1 : -1;
}

// ---------------------------------------------------------------- the book ------------------------------------------
// editions for learners and schools (simplified texts, readers with materials) and reprints printed on demand (the
// classics have hundreds of those): the same book, but rarely the one the reader holds, so their pictures, years,
// publishers and series come last
const LEARNER = /\b(?:leicht gemacht|leichte sprache|einfach(?:e)? (?:lesen|deutsch|lektüre)|easy readers?|graded readers?|lektüren?|lektürehilfe|lesehefte?|hamburger lesehefte|deutsch kompetent|textausgabe mit|schulausgabe|schullektüre|kommentar und materialien|text und kommentar|mit materialien|deutsch als fremdsprache|daf|vereinfachte fassung|in einfacher sprache|leicht verständliche[rn]? sprache|klarer,? moderner sprache|lesestufe|klett lektüre|textanalyse und interpretation)\b/i;
// (Klett-Cotta is a publisher of literature, Ernst Klett one of schoolbooks)
const LESSER_PUB = /\b(?:klett(?!-cotta)|cornelsen|schöningh|westermann|hueber|langenscheidt|bange|buchner|stark verlag|erläuterungen|books on demand|bod|createspace|independently published|epubli|tredition|neobooks|grin|lulu|kdp)\b/i;
/** A record of a lesser edition: for learners or schools (Klett readers, Lesehefte) or printed on demand (BoD, CreateSpace). */
const isLesser = (rec) => LEARNER.test(`${rec.title || ''} ${rec.subtitle || ''} ${rec.series || ''}`) || LESSER_PUB.test(String(rec.publisher || ''));
// series of a publisher (paperback lines, school series) are no series of the story
const PUBLISHER_SERIES = /\b(?:taschenbuch|tb|rororo|dtv|fischer|suhrkamp|insel|reclam|universal-bibliothek|diogenes|detebe|goldmann|heyne|bastei|piper|btb|penguin|vintage|classics?|klassik|bibliothek|edition|collection|library|lektüre|lesehefte|readers?|leicht|kompetent|einfach|ausgabe)\b/i;
// summaries, study guides, audio books and the like: another publication about the book
const COMPANION = /\b(?:zusammenfassung|summary|summaries|analyse des bestsellers|analysis of|study guide|lektürehilfe|lekturehilfe|lektüreschlüssel|interpretation(?:en)? zu|arbeitsheft|lösungsheft|lösungen zu|teacher'?s (?:manual|guide|edition)|hörbuch|horbuch|audiobook|audio cd|hörspiel|vollständige lesung|gekürzte lesung|ungekürzte lesung|cliffsnotes|sparknotes|quicklet|shortcut edition|instaread|book summary|kurzfassung|motivanalyse|unterrichtsmaterial|reader'?s guide|discussion guide|colou?ring book|malbuch|sammelband|box ?set)\b/i;
const NOT_PERSON = /\b(user|admin|administrator|owner|unknown|unbekannt|microsoft|office|adobe|acrobat|windows|scanner|calibre|pdf|word)\b/i;
// a title that names the file instead of the book ("Microsoft Word - manuscript_final", "Scan_0001"): its ISBN decides
// a part of an edition split in parts ("Walden, Part One", "Teil 2"), outside of parentheses (a series named there)
const SPLIT_PART = /\b(?:part|teil)\s*(?:\d{1,3}|[ivx]{1,5}|one|two|three|four|five|eins|zwei|drei|vier|fünf)\b/i;
const JUNK_TITLE = /^(?:microsoft\s+word|untitled|unbenannt|ohne titel|dokument\s*\d*|document\s*\d*|scan|img[\s_-]*\d|manuscript|druckvorlage)\b|\.(?:docx?|indd|qxd|pdf|tex)\b/i;
/**
 * The book as the matching sees it: the whole title (a file name "Author - Title" or "Title - Author" gives its author
 * back, as for the image search in cover-match.js coverQuery), its words, the author's surnames, the ISBN it carries,
 * its language (`lang`: known from the book, used to refuse other editions; `qlang`: also guessed from the title, used
 * to pick the shop's country), its volume.
 */
function bookKey(book) {
  // an ASIN in the title or the file name: kept for Amazon's picture, left out of the title's words
  const asin = (ASIN.exec(`${book?.title || ''} ${book?.relPath || ''}`) || [])[1] || null;
  let title = cleanTitle(String(book?.title || '').replace(/[[(]?\s*\bB0[0-9A-Z]{8}\b\s*[\])]?/g, ' '));
  const raw = String(book?.author || '').trim();
  let author = raw && looksLikeName(firstAuthor(raw)) ? raw : '';
  if (!author && / [-–] /.test(title)) {
    const [head, ...rest] = title.split(/ [-–] /);
    const tail = rest.join(' - ').trim();
    if (looksLikeName(head) && tail.length >= 3) { author = head.trim(); title = tail; }
    else if (rest.length === 1 && looksLikeName(tail) && head.length >= 3) { author = tail; title = head.trim(); }
  } else if (author && / [-–] /.test(title)) {
    // "Mary Shelley - Frankenstein" with the author known (filled in later): the name is no part of the title
    const parts = title.split(/ [-–] /);
    const sur = new Set(surnames(author));
    const isAuthor = (p) => looksLikeName(p) && sur.has(words(p).pop());
    if (parts.length >= 2 && isAuthor(parts[0])) title = parts.slice(1).join(' - ').trim();
    else if (parts.length >= 2 && isAuthor(parts[parts.length - 1])) title = parts.slice(0, -1).join(' - ').trim();
  }
  const info = titleInfo(title);
  const lang = normLang(book?.language);
  return {
    id: book?.id || null, title, text: info.text, all: info.all, main: info.main, sub: info.sub, volume: info.volume, cut: info.cut,
    author, surnames: surnames(author), isbns: isbnList([book?.isbn].filter(Boolean)), asin, lang, qlang: lang || titleLanguage(info.text) || null,
    junk: !info.all.length || JUNK_TITLE.test(info.text),
  };
}

// ---------------------------------------------------------------- one record -----------------------------------------
const LEVELS = { isbn: 4, author: 3, title: 2, weak: 1 };
/**
 * How well a catalogue record fits a book. `rec`: { source, title, subtitle, authors[], isbns[], language, kind,
 * seriesIndex }. Returns { ok, level ('isbn'|'author'|'title'|'weak'), rank, score, how, author, lang, isbn, why }:
 *   isbn    the record carries the book's ISBN (and its title or author fits at least a little)
 *   author  the title fits and the record names the book's author
 *   title   the title fits word for word and is distinctive, the author is unknown on one side
 *   weak    the title fits but is too plain to trust alone: only when another source shows the same picture
 * A record of another kind (audio book, summary), another volume, another language or another author is refused.
 */
function matchRecord(bk, rec) {
  const no = (why) => ({ ok: false, level: null, rank: 0, score: 0, why });
  if (!rec || !rec.title) return no('empty');
  if (rec.kind === 'audio' || rec.kind === 'video') return no('kind');
  const blob = `${rec.title} ${rec.subtitle || ''}`;
  if (COMPANION.test(blob) && !COMPANION.test(bk.text)) return no('companion');
  const ck = titleInfo(rec.title, rec.subtitle || '');
  const isbn = bk.isbns.length > 0 && (rec.isbns || []).some((i) => bk.isbns.includes(i));
  const t = titleScore(bk, ck);
  const author = authorMatch(bk, rec);
  const lang = bk.lang && rec.language ? (bk.lang === rec.language ? 1 : -1) : 0;
  const recVol = ck.volume || (Number.isFinite(rec.seriesIndex) ? rec.seriesIndex : null);
  if (bk.volume && recVol && bk.volume !== recVol && !isbn) return no('volume');
  if (!bk.volume && !isbn && SPLIT_PART.test(String(rec.title).replace(/\([^)]*\)|\[[^\]]*\]/g, ' '))) return no('volume');
  if (lang < 0 && !isbn) return no('language');
  if (author < 0 && !isbn) return no('author');
  const score = Math.round(t.score * (bk.volume && !recVol ? 0.88 : 1) * 100) / 100;
  let level = null;
  if (isbn && (t.score >= 0.3 || author > 0 || bk.junk)) level = 'isbn';
  else if (score >= 0.85 && author > 0) level = 'author';
  else if (score >= 0.9 && author === 0 && t.distinct) level = 'title';
  else if (score >= 0.85 && author === 0) level = 'weak';
  return { ok: !!level, level, rank: LEVELS[level] || 0, score, how: t.how, author, lang, isbn, why: level ? null : 'title ' + t.how + ' ' + score };
}

// ---------------------------------------------------------------- series ---------------------------------------------
/** "3", "Bd. 3", "Band 3", "Teil 2", "Nr. 12", "Vol. 1", "3.2", "[3]" → the number; null without one. */
function seriesNumber(v) {
  const s = String(v || '');
  const m = /(\d{1,4})(?:[.,](\d{1,2}))?/.exec(s);
  if (m) { const n = +m[1] + (m[2] ? +('0.' + m[2]) : 0); return n > 0 && n < 10000 ? n : null; }
  const r = /\b([IVXLC]{1,6})\b/.exec(s);
  return r ? roman(r[1]) : null;
}
/** A series name without the marks of the catalogue: "¬Die¬ Harry-Potter-Serie ;" → "Die Harry-Potter-Serie". */
const seriesName = (s) => String(s || '').replace(/[\u0098\u009c]/g, '').replace(/&#15[26];/g, '').replace(/\s*[;,/:=]\s*$/, '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- metadata ------------------------------------------
/** A year of four digits in a date or a catalogue's "[2025]", "c2017", "Nov 14, 2016". */
function yearOf(v) {
  const m = /(?:^|[^\d])(1[5-9]\d\d|20\d\d)(?:[^\d]|$)/.exec(String(v ?? ''));
  const y = m ? +m[1] : null;
  return y && y <= new Date().getFullYear() + 1 ? y : null;
}
// fields filled in from the catalogues, in the order of their importance (`series` and `seriesIndex` go together)
const META_FIELDS = ['author', 'year', 'publisher', 'isbn', 'language', 'series', 'seriesIndex'];
/** Is the value of a book field empty (or, for the author, the name of a program instead of a person)? */
function missing(book, field) {
  const v = book?.[field];
  if (field === 'author') return !v || !String(v).trim() || NOT_PERSON.test(String(v));
  if (field === 'language') return !normLang(v);
  if (field === 'year' || field === 'seriesIndex') return !(Number(v) > 0);
  return v == null || !String(v).trim();
}
const cleanText = (s, max = 120) => (s ? String(s).replace(/[\u0098\u009c]/g, '').replace(/&#15[26];/g, '').replace(/\s+/g, ' ').replace(/^[\s,;:/]+|[\s,;:/]+$/g, '').trim().slice(0, max) : null);
const pubKey = (p) => (words(String(p || '')).find((w) => w.length >= 3) || '');
/** The publisher most editions of the records come from (at least two), '' when none stands out. */
function mainPublisher(records) {
  const n = new Map();
  for (const r of records) { const k = pubKey(r.publisher); if (k && !isLesser(r)) n.set(k, (n.get(k) || 0) + 1); }
  let best = '', most = 1;
  for (const [k, c] of n) if (c > most) { best = k; most = c; }
  return best;
}
/** A record of one edition (not Open Library's record of the work, whose "first published" is often wrong). */
const isEdition = (r) => !(r.source === 'openlibrary' && /^\/works\//.test(String(r.id || '')));
/**
 * What the matched records add to a book: only fields the book lacks. `records`: matched records (matchRecord level
 * 'title' or better, with `rank`), best first; `chosen`: the record whose picture became the cover.
 *   year       the one of the cover's edition, else the earliest edition the catalogues know (Apple's date is the
 *              e-book's: it can only come too late); never Open Library's year of the work (often wrong), never one of
 *              a lesser edition (school editions, prints on demand)
 *   publisher  the one of the cover's edition, else the publisher most editions come from
 *   isbn       only when the cover comes from the DNB and the DNB names exactly one edition (a guessed ISBN of another
 *              edition would make two different files look like the same book)
 *   series     a series of the story (its name shares a word with the title, or several records name it), not a
 *              publisher's paperback line or school series
 * Returns { patch, src } (src: field → the catalogue it came from).
 */
function metadataFrom(book, records, { chosen = null } = {}) {
  const patch = {}, src = {};
  const take = (field, value, source) => { if (value == null || value === '' || Number.isNaN(value) || field in patch || !missing(book, field)) return; patch[field] = value; src[field] = source; };
  if (!records.length) return { patch, src };
  const plain = records.filter((r) => !isLesser(r));
  const pool = plain.length ? plain : records;
  for (const r of [chosen, ...pool].filter(Boolean)) if (r.authors?.length) { take('author', r.authors.slice(0, 3).map(personName).join(', '), r.source); break; }
  // the year of the edition whose cover the book shows, else the earliest edition (one wrong early year of a catalogue
  // weighs less when the cover's edition decides)
  if (chosen && isEdition(chosen) && !isLesser(chosen)) take('year', yearOf(chosen.year), chosen.source);
  const dated = pool.filter((r) => isEdition(r) && yearOf(r.year)).sort((a, b) => yearOf(a.year) - yearOf(b.year));
  if (dated.length) take('year', yearOf(dated[0].year), dated[0].source);
  if (chosen && !isLesser(chosen)) take('publisher', cleanText(chosen.publisher), chosen.source);
  const main = mainPublisher(pool);
  const byMain = main && pool.find((r) => pubKey(r.publisher) === main);
  if (byMain) take('publisher', cleanText(byMain.publisher), byMain.source);
  for (const r of pool) take('publisher', cleanText(r.publisher), r.source);
  const dnb = records.filter((r) => r.source === 'dnb' && r.kind !== 'audio');
  if (chosen && chosen.source === 'dnb' && dnb.length === 1 && dnb[0].isbnOwn && dnb[0].isbnOwn === chosen.isbnOwn) take('isbn', chosen.isbnOwn, 'dnb');
  for (const r of [chosen, ...records].filter(Boolean)) take('language', normLang(r.language), r.source);
  const titleWords = words(book?.title || '');
  for (const r of pool) {
    if (!r.series || !missing(book, 'series')) continue;
    const name = seriesName(r.series);
    const ws = words(name);
    const named = pool.filter((x) => x.series && coverage(words(seriesName(x.series)), ws) === 1).length;
    if (PUBLISHER_SERIES.test(name) || (Number.isFinite(r.seriesIndex) && r.seriesIndex > 120)) continue;
    if (!(coverage(ws, titleWords) > 0 || named >= 2)) continue;
    take('series', name, r.source);
    if (Number.isFinite(r.seriesIndex)) take('seriesIndex', r.seriesIndex, r.source);
    break;
  }
  return { patch, src };
}

/**
 * The searches for a book, best first: the main title and the author, then (for a title cut off in its file name or a
 * long one) its first words. Each { title, author }.
 */
function queriesFor(bk) {
  const raw = String(bk.title || '').replace(/\s+/g, ' ').trim();
  let t = raw;
  // without the cut-off end ("… Exercises and")
  for (;;) { const last = (t.split(' ').pop() || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); if (!TRAIL.has(last) || !t.includes(' ')) break; t = t.slice(0, t.lastIndexOf(' ')).trim(); }
  const main = titleInfo(t).main.length ? (/^(.+?)(?:\s*:\s+|\s+[-–—]\s+)/.exec(t)?.[1] || t) : t;
  const out = [{ title: main.slice(0, 120), author: bk.author }];
  const n = words(main).length;
  if (bk.cut || n >= 6) {
    const parts = main.split(' ');
    let k = parts.length, kept = n;
    // the first words: all but the last two of the title's words, at least three
    while (k > 1 && kept > Math.max(3, n - 2)) { k--; if (words(parts[k]).length) kept--; }
    while (k > 1 && TRAIL.has(parts[k - 1].toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))) k--;
    const short = parts.slice(0, k).join(' ').replace(/[\s,;:.-]+$/, '');
    if (short && short !== main && words(short).length >= 3) out.push({ title: short, author: bk.author, short: true });
  }
  return out;
}

module.exports = {
  normLang, textLanguage, isbn13, isbn10, isbnList, titleInfo, titleScore, volumeOf, coverage, isPrefixOf, distinctive, sameWord,
  personName, splitNames, surnames, authorMatch, bookKey, matchRecord, LEVELS, COMPANION, seriesNumber, seriesName, yearOf,
  META_FIELDS, missing, metadataFrom, queriesFor, isLesser, isEdition, mainPublisher, pubKey,
};
