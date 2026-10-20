// Text rules of the full-text search, shared by the indexer window (bundled into indexer.js), the index worker (Node)
// and the reader (highlights): folding (case, umlauts, accents), tokens, a light German/English stemmer, the cleaned
// text of a page (words a PDF hyphenated at a line end are joined again) with a map back to its source pieces, the
// query language ("phrase", word*, all words on one page) and the places where a query matches a text.
// Index and query must agree to the letter: NORM_VERSION is stored with the index, a change rebuilds it.
'use strict';

const NORM_VERSION = 1;

/* ------------------------------------------------------------------ folding -- */

// letters that NFKD does not take apart, and the German umlauts written out (Müller = Mueller)
const SPECIAL = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i', 'ſ': 's' };
const SPECIAL_RX = /[äöüßæœøłđðþıſ]/g;
const APOSTROPHES = /['’ʼ]/g;
const MARKS = /\p{M}+/gu;
const ASCII = /^[\x00-\x7f]*$/;

/** A word in its comparable form: lower case, umlauts as ae/oe/ue, ß as ss, accents and apostrophes removed. */
function fold(word) {
  const w = String(word).toLowerCase();
  if (ASCII.test(w)) return w.indexOf("'") >= 0 ? w.replace(APOSTROPHES, '') : w;
  return w.normalize('NFC').replace(SPECIAL_RX, (c) => SPECIAL[c]).normalize('NFKD').replace(MARKS, '').replace(APOSTROPHES, '');
}

/** "buecher" → "bucher": the umlauts of a stem become plain vowels, so that a plural with umlaut finds its singular. */
const deUmlaut = (w) => (w.indexOf('e') < 0 ? w : w.replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u'));

/* ------------------------------------------------------------------ stemming -- */

// Endings removed from a folded word, the longest that leaves a stem of three letters with a vowel. German plural and
// case endings (Bücher, Büchern, Buches), English plurals and verb forms (books, stories, played, running).
const A_ENDINGS = ['ern', 'ies', 'ing', 'em', 'en', 'er', 'es', 'ed', 'e', 's'];
// comparative and superlative ("schönsten" → "schön" after A took "en")
const B_ENDINGS = ['est', 'st'];
const VOWEL = /[aeiouy]/;
// an "s" is no plural ending after these letters (Haus, Status, Kreis, glass)
const NO_S_BEFORE = new Set(['s', 'u', 'i']);
// "st" is an ending only after these letters (Snowball's valid st-endings)
const ST_BEFORE = new Set(['b', 'd', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 't']);

function stripEnding(w, endings, tag) {
  for (const e of endings) {
    if (w.length <= e.length || !w.endsWith(e)) continue;
    let stem = w.slice(0, -e.length);
    if (e === 'ies') stem += 'i';
    if (stem.length < 3 || !VOWEL.test(stem)) continue;
    const before = stem[stem.length - 1];
    if (e === 's' && NO_S_BEFORE.has(before)) continue;
    if (e === 'st' && !ST_BEFORE.has(before)) continue;
    if (e === 'ed' && before === 'e') continue;            // speed, need, agreed
    if (tag && (e === 'ing' || e === 'ed')) tag.verb = true;
    return stem;
  }
  return w;
}

/**
 * The stem of a folded word: a light stemmer for German and English together (the language of a page is often
 * unknown, and a book in one language quotes the other). Inflection endings go (twice at most, Problemen → Problem
 * → Probl), then the comparative, a doubled consonant of an English verb (running → run), y → i (story, stories)
 * and last the umlauts (Bücher → buech → buch = Buch). Numbers and words with digits (1945, e4) stay as they are.
 */
function stem(f) {
  if (f.length < 3 || /\d/.test(f)) return f;
  const tag = { verb: false };
  let w = stripEnding(stripEnding(f, A_ENDINGS, tag), A_ENDINGS, tag);
  const b = stripEnding(w, B_ENDINGS, null);
  if (b !== w) w = stripEnding(b, A_ENDINGS, null);
  if (tag.verb && w.length > 3 && w[w.length - 1] === w[w.length - 2] && !'lsz'.includes(w[w.length - 1]) && !VOWEL.test(w[w.length - 1])) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith('y')) w = w.slice(0, -1) + 'i';
  return deUmlaut(w);
}

// Words too frequent to be worth an entry in the index (folded). They still count inside a "phrase".
const STOPWORDS = new Set(`
der die das den dem des ein eine einer eines einem einen und oder aber als auch an am auf aus bei bis da dass durch fuer
im in ins ist nicht mit nach noch nur sich so um von vom vor war wie wir zu zum zur es er sie ich du ihr ihm ihn ihre sein
seine seiner seinen seinem seines hat haben hatte hatten wird werden wurde wurden sind dann denn doch schon wenn man was
wo ob mir mich dir dich uns euch diese dieser dieses diesen diesem jener sehr ueber unter zwischen gegen ohne kein keine
the a an and or of to in on at is are was were be been being it its this that these those with for as by from not but
have has had which who whom what will would can could should shall do does did so if than then there their they them
he she his her hers we you i my me our your us into out up about all any some no yes
`.split(/\s+/).filter(Boolean));

const MAX_WORD = 48;

/** The index term of a word, or null for a word the index leaves out (stop words, single characters, garbage). */
function termOf(word) {
  const f = fold(word);
  if (f.length < 2 || f.length > MAX_WORD || STOPWORDS.has(f)) return null;
  return stem(f);
}

/* ------------------------------------------------------------------ tokens -- */

// a word: letters and digits (with combining marks), inner apostrophes kept ("don't", "geht's"); everything else
// separates words, hyphens too ("E-Mail" is "e" "mail", "Caro-Kann" "caro" "kann")
const WORD_RX = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’ʼ][\p{L}\p{M}]+)*/gu;

/** Every word of `text` with its position: [{ a, b, w }] (b exclusive). */
function words(text) {
  const out = [];
  WORD_RX.lastIndex = 0;
  for (let m; (m = WORD_RX.exec(text));) out.push({ a: m.index, b: m.index + m[0].length, w: m[0] });
  return out;
}

/** The index terms of a text: every term once, separated by spaces (the input of the FTS table). */
function indexTerms(text) {
  const seen = new Set();
  const cache = new Map();
  WORD_RX.lastIndex = 0;
  for (let m; (m = WORD_RX.exec(text));) {
    const w = m[0];
    let t = cache.get(w);
    if (t === undefined) { t = termOf(w); cache.set(w, t); }
    if (t) seen.add(t);
  }
  return [...seen].join(' ');
}

/** Number of letters in a text (a page "has text" when it has some). */
function letterCount(text) {
  const m = String(text).match(/\p{L}/gu);
  return m ? m.length : 0;
}

/* ------------------------------------------------------------------ cleaned text -- */

const CONJ_AFTER_HYPHEN = new Set(['und', 'oder', 'bis', 'sowie', 'bzw', 'beziehungsweise', 'als', 'wie', 'noch', 'and', 'or', 'nor', 'to']);
const HYPHENS = '-­‐';
const isSpaceCh = (c) => c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === ' ' || c === ' ' || c === ' ' || c === ' ' || c === ' ' || c === ' ' || c === ' ' || c === '　';
const isLetter = (c) => !!c && /\p{L}/u.test(c);
const isLower = (c) => !!c && /\p{Ll}/u.test(c);
const INVISIBLE = /[​‌‍⁠﻿]/;

/**
 * The text of a page or a section, cleaned the same way for the index and for the highlights in the reader:
 * pieces = [{ str, eol? }] in reading order (pdf.js text items with hasEOL, or the text nodes of a document with
 * '\n' pieces at block boundaries). Runs of white space become one space, or one '\n' when they hold a line break;
 * soft hyphens disappear; a word hyphenated at a line end is joined ("Bü-\nchern" → "Büchern") unless the next word
 * is a conjunction ("Ost- und West"). With { map: true } the result also says where every character came from:
 * src[i] is the position in the raw text (the pieces joined, '\n' after an eol piece), starts[k] where piece k begins.
 * @returns {{ text: string, src?: Int32Array, starts?: number[] }}
 */
function cleanText(pieces, { map = false } = {}) {
  const starts = [];
  let raw = '';
  for (const p of pieces) {
    starts.push(raw.length);
    raw += p.str || '';
    if (p.eol) raw += '\n';
  }
  const n = raw.length;
  const src = map ? new Int32Array(n) : null;
  let out = '';
  let last = '';            // the last character written
  let pending = '';         // white space waiting to be written: ' ', or '\n' when it holds a line break
  for (let i = 0; i < n; i++) {
    const c = raw[i];
    if (HYPHENS.includes(c) && !pending && isLetter(last)) {
      // a hyphen at the end of a line: "Bü-\nchern" is one word, "Schach-\nWeltmeister" keeps its hyphen without the
      // break, "Ost-\nund West" stays as it is
      let j = i + 1;
      while (j < n && isSpaceCh(raw[j])) j++;
      if (j < n && raw[j] === '\n') {
        let k = j + 1;
        while (k < n && (isSpaceCh(raw[k]) || raw[k] === '\n')) k++;
        if (k < n && isLetter(raw[k])) {
          let e = k;
          while (e < n && isLetter(raw[e])) e++;
          const conj = CONJ_AFTER_HYPHEN.has(raw.slice(k, e).toLowerCase());
          if (c === '­' || (isLower(raw[k]) && !conj)) { i = k - 1; continue; }
          if (!isLower(raw[k])) {
            if (src) src[out.length] = i;
            out += c; last = c; i = k - 1;
            continue;
          }
        }
      }
      if (c === '­') continue;         // a soft hyphen inside a line is invisible
    } else if (c === '­' || INVISIBLE.test(c)) continue;
    if (c === '\n' || c === ' ' || c === ' ') { pending = '\n'; continue; }
    if (isSpaceCh(c)) { if (!pending) pending = ' '; continue; }
    if (pending) {
      if (out) { if (src) src[out.length] = i - 1; out += pending; }
      pending = '';
    }
    if (src) src[out.length] = i;
    out += c;
    last = c;
  }
  if (!map) return { text: out };
  return { text: out, src: src.subarray(0, out.length), starts };
}

/** [piece index, offset in that piece] of a raw position (cleanText starts). */
function pieceAt(starts, rawIndex) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= rawIndex) lo = mid; else hi = mid - 1;
  }
  return [lo, rawIndex - starts[lo]];
}

/* ------------------------------------------------------------------ queries -- */

// "phrase", „Phrase“, “phrase”, »Phrase«
const QUOTED = /["„“”»«]([^"„“”»«]*)["„“”»«]?/g;

/**
 * The query language: words must all occur on the same page (in any form: Bücher finds Buch), a "phrase in quotes"
 * must occur as written (case and umlaut spelling aside), a word ending in * is a prefix (Schach* finds Schachbrett).
 * A word that splits into several (Caro-Kann, 1.e4) is a phrase of its parts.
 * @returns {{ items: Array, terms: Array, empty: boolean, common: boolean, text: string }}
 *   items: [{ kind: 'word', f, s, pre?, raw } | { kind: 'phrase', tokens: [{ f, s }], raw }]
 *   terms: the index terms that must be on a page: [{ s, pre? }]
 */
function parseQuery(input) {
  const text = String(input || '').normalize('NFC').trim().slice(0, 400);
  const items = [];
  // a quoted word or phrase must stand on the page as written ("Bücher" finds Bücher, not Buch)
  const rest = text.replace(QUOTED, (all, inner) => {
    const toks = words(inner).map((t) => fold(t.w)).filter((f) => f.length <= MAX_WORD).map((f) => ({ f, s: stem(f) }));
    if (toks.length) items.push({ kind: 'phrase', tokens: toks, raw: inner.trim() });
    return ' ';
  });
  for (const chunk of rest.split(/\s+/)) {
    if (!chunk) continue;
    const prefix = /\*+$/.test(chunk);
    const toks = words(chunk.replace(/\*+$/, '')).map((t) => fold(t.w)).filter((f) => f.length <= MAX_WORD);
    if (!toks.length) continue;
    if (toks.length > 1) { items.push({ kind: 'phrase', tokens: toks.map((f) => ({ f, s: stem(f) })), raw: chunk }); continue; }
    const f = toks[0];
    const item = { kind: 'word', f, s: stem(f), raw: chunk };
    // a prefix needs three letters: shorter ones match half the dictionary
    if (prefix && f.length >= 3) item.pre = deUmlaut(f);
    items.push(item);
  }
  // the index terms: the stems of the words and of the phrase parts, without stop words and single characters
  const terms = [];
  const seen = new Set();
  const add = (t) => { const k = t.s + (t.pre ? '*' + t.pre : ''); if (!seen.has(k)) { seen.add(k); terms.push(t); } };
  for (const it of items) {
    if (it.kind === 'word') { if (indexable(it.f)) add(it.pre ? { s: it.s, pre: it.pre } : { s: it.s }); }
    else for (const t of it.tokens) if (indexable(t.f)) add({ s: t.s });
  }
  return { text, items, terms, empty: !items.length, common: !!items.length && !terms.length };
}
const indexable = (f) => f.length >= 2 && f.length <= MAX_WORD && !STOPWORDS.has(f);

/** The MATCH expression of the FTS table for a parsed query (all terms on the page), or '' for none. */
function ftsMatch(q) {
  return q.terms.map((t) => (t.pre ? `("${t.pre}"* OR "${t.s}")` : `"${t.s}"`)).join(' AND ');
}

/**
 * Where the query matches a cleaned text: [{ a, b, item, exact }] in text order (b exclusive). Words match in any
 * form (same stem, or the prefix), phrases word for word in their folded form; stop words alone are not marked.
 */
function findMatches(text, q) {
  if (!q || !q.items.length) return [];
  const toks = words(text);
  const cache = new Map();
  const info = (w) => { let x = cache.get(w); if (!x) { const f = fold(w); x = { f, s: stem(f), d: null }; cache.set(w, x); } return x; };
  const out = [];
  q.items.forEach((it, idx) => {
    if (it.kind === 'word') {
      if (!indexable(it.f)) return;
      for (const t of toks) {
        const x = info(t.w);
        let hit = x.s === it.s;
        if (!hit && it.pre) { if (x.d == null) x.d = deUmlaut(x.f); hit = x.d.startsWith(it.pre); }
        if (hit) out.push({ a: t.a, b: t.b, item: idx, exact: x.f === it.f });
      }
    } else {
      const n = it.tokens.length;
      for (let i = 0; i + n <= toks.length; i++) {
        let k = 0;
        while (k < n && info(toks[i + k].w).f === it.tokens[k].f) k++;
        if (k === n) { out.push({ a: toks[i].a, b: toks[i + n - 1].b, item: idx, exact: true }); i += n - 1; }
      }
    }
  });
  out.sort((x, y) => x.a - y.a || y.b - x.b);
  // overlapping marks (a word inside a phrase) become one
  const merged = [];
  for (const m of out) {
    const prev = merged[merged.length - 1];
    if (prev && m.a < prev.b) { if (m.b > prev.b) prev.b = m.b; prev.exact = prev.exact || m.exact; continue; }
    merged.push({ ...m });
  }
  return merged;
}

// what is left of a German or English page after the umlauts: quotes, dashes, spaces (NFKD turns them into other
// characters that are no letters either, so they may stay as they are)
const PLAIN_REST = /^[\x00-\x7f «» -⁯]*$/;
/** A whole text folded like its words (fold), positions are not kept: for quick tests only. */
function foldText(text) {
  let t = String(text).toLowerCase();
  if (!ASCII.test(t)) {
    if (/[̀-ͯ]/.test(t)) t = t.normalize('NFC');
    t = t.replace(SPECIAL_RX, (c) => SPECIAL[c]);
    // accents, ligatures, other scripts: taken apart like the words (é → e, й → и)
    if (!PLAIN_REST.test(t)) t = t.normalize('NFKD').replace(MARKS, '');
  }
  return t.replace(APOSTROPHES, '');
}
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Does the text hold every phrase of the query (the index only knows that the words are on the page)? */
function hasPhrases(text, q) {
  const phrases = q.items.filter((it) => it.kind === 'phrase');
  if (!phrases.length) return true;
  // a quick test on the folded text first (most candidate pages of a phrase of common words fail here): the words of
  // each phrase one after the other with anything but letters and digits between them. It may let a page through
  // that the word by word comparison then rejects, never the other way round.
  if (!q._phraseRx) q._phraseRx = phrases.map((it) => new RegExp('(?:^|[^a-z0-9])' + it.tokens.map((t) => escapeRx(t.f)).join('[^a-z0-9]+') + '(?![a-z0-9])'));
  const folded = foldText(text);
  if (!q._phraseRx.every((rx) => rx.test(folded))) return false;
  const marks = findMatches(text, { items: phrases });
  const found = new Set(marks.map((m) => m.item));
  return phrases.every((_, i) => found.has(i));
}

/**
 * A short excerpt around the best place of a text (most different query items close together, the exact spelling
 * first): { text, marks: [[a, b]], pre, post } with marks relative to the excerpt, pre/post: text was cut there.
 */
function snippet(text, q, width = 240) {
  const marks = findMatches(text, q);
  const flat = (s) => s.replace(/\s/g, ' ');
  if (!marks.length) {
    const cut = text.length > width ? text.lastIndexOf(' ', width) : text.length;
    const end = cut > width * 0.6 ? cut : Math.min(text.length, width);
    return { text: flat(text.slice(0, end)), marks: [], pre: false, post: end < text.length, count: 0 };
  }
  let best = 0, bestScore = -1;
  for (let i = 0; i < marks.length; i++) {
    const items = new Set();
    let exact = 0;
    for (let j = i; j < marks.length && marks[j].b - marks[i].a <= width * 0.7; j++) { items.add(marks[j].item); if (marks[j].exact) exact++; }
    const score = items.size * 100 + exact * 3 - i * 0.001;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  const first = marks[best];
  // some words before the first mark, cut at a word boundary
  let start = Math.max(0, first.a - Math.round(width * 0.28));
  if (start > 0) { const sp = text.indexOf(' ', start); start = sp >= 0 && sp < first.a ? sp + 1 : start; }
  let end = Math.min(text.length, start + width);
  if (end < text.length) { const sp = text.lastIndexOf(' ', end); if (sp > first.b) end = sp; }
  if (end < first.b) end = Math.min(text.length, first.b);
  const inside = marks.filter((m) => m.a >= start && m.b <= end).map((m) => [m.a - start, m.b - start]);
  return { text: flat(text.slice(start, end)), marks: inside, pre: start > 0, post: end < text.length, count: marks.length };
}

module.exports = {
  NORM_VERSION, STOPWORDS, fold, deUmlaut, stem, termOf, words, indexTerms, letterCount,
  cleanText, pieceAt, parseQuery, ftsMatch, findMatches, hasPhrases, snippet,
};
