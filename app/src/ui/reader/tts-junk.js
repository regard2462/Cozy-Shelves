// Junk detection for read-aloud: text that must never reach a voice. A PDF can look perfect on screen and still
// carry broken text: fonts whose ToUnicode map gives the wrong characters (letters moved by a few places, private use
// characters, CJK ideographs), diagrams set in a chess diagram font ("$tMvWlVmT%"), scans without OCR (no text) or
// symbol rows. Read aloud, all of that is gibberish. Pure functions, no DOM: also used by the Node tests
// (electron/tts/test-reading.js).
import { isChessToken } from './tts-chess.js';

// letter frequencies (per cent) of the languages a European library mostly holds, accents folded onto the base
// letters: real prose of a few sentences matches one of them closely, letters moved by a broken font map do not
const FREQ = {
  de: { e: 16.4, n: 9.8, i: 7.6, s: 7.3, r: 7.0, a: 7.1, t: 6.2, d: 5.1, h: 4.8, u: 4.8, l: 3.4, c: 2.7, g: 3.0, m: 2.5, o: 2.9, b: 1.9, w: 1.9, f: 1.7, k: 1.2, z: 1.1, p: 0.8, v: 0.85, j: 0.27, y: 0.04, x: 0.03, q: 0.02 },
  en: { e: 12.7, t: 9.1, a: 8.2, o: 7.5, i: 7.0, n: 6.7, s: 6.3, h: 6.1, r: 6.0, d: 4.3, l: 4.0, c: 2.8, u: 2.8, m: 2.4, w: 2.4, f: 2.2, g: 2.0, y: 2.0, p: 1.9, b: 1.5, v: 1.0, k: 0.8, j: 0.15, x: 0.15, q: 0.1, z: 0.07 },
  fr: { e: 16.6, a: 7.6, i: 7.5, s: 7.9, n: 7.1, r: 6.6, t: 7.2, o: 5.8, l: 5.5, u: 6.3, d: 3.7, c: 3.3, m: 3.0, p: 2.5, v: 1.8, q: 1.4, f: 1.1, b: 0.9, g: 0.9, h: 0.7, j: 0.6, x: 0.4, y: 0.1, z: 0.1 },
  es: { e: 13.7, a: 12.5, o: 8.7, s: 8.0, r: 6.9, n: 6.7, i: 6.3, d: 5.9, l: 5.0, c: 4.7, t: 4.6, u: 3.9, m: 3.2, p: 2.5, b: 1.4, g: 1.0, v: 0.9, y: 0.9, q: 0.9, h: 0.7, f: 0.7, z: 0.5, j: 0.4, x: 0.2 },
  it: { e: 11.8, a: 11.7, i: 11.3, o: 9.8, n: 6.9, l: 6.5, r: 6.4, t: 5.6, s: 5.0, c: 4.5, d: 3.7, p: 3.1, u: 3.0, m: 2.5, v: 2.1, g: 1.6, h: 1.5, f: 1.2, b: 0.9, q: 0.5, z: 0.5 },
  nl: { e: 18.9, n: 10.0, a: 7.5, t: 6.8, i: 6.5, r: 6.4, o: 6.1, d: 5.9, s: 3.7, l: 3.6, g: 3.4, v: 2.9, h: 2.4, k: 2.3, m: 2.2, u: 2.0, b: 1.6, p: 1.6, w: 1.5, j: 1.5, z: 1.4, c: 1.2, f: 0.8 },
  la: { i: 11.4, e: 11.4, a: 8.9, u: 8.5, t: 8.0, s: 7.6, r: 6.7, n: 6.3, o: 5.4, m: 5.4, c: 3.9, l: 3.2, p: 2.9, d: 2.7, b: 1.6, q: 1.5, g: 1.2, v: 1.0, f: 0.9, h: 0.7, x: 0.6 },
};
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const VECTORS = Object.fromEntries(Object.entries(FREQ).map(([k, f]) => {
  const v = ALPHABET.split('').map((c) => f[c] || 0.01);
  const n = Math.hypot(...v);
  return [k, v.map((x) => x / n)];
}));
const VOWELS = /[aeiouyäöüàáâãåæéèêëíìîïóòôõøœúùûüýÿ]/i;
// characters no readable text consists of: control characters (besides white space), private use, unassigned,
// surrogates, the replacement character and the symbols a broken font map produces most
const BAD_CHAR = /[\p{Cc}\p{Co}\p{Cn}\p{Cs}\uFFFD¦ª¯¸º÷þÞðÐ¤¨]/u;
const LATIN = /\p{Script=Latin}/u;
const OTHER_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Thai}\p{Script=Devanagari}]/u;

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ø/g, 'o');

/** How well the letters of `text` match the letter frequencies of a European language: 0…1 (1 = like real prose). */
export function letterFit(text) {
  const counts = new Array(26).fill(0);
  let n = 0;
  for (const ch of fold(String(text || '').toLowerCase())) {
    const k = ch.charCodeAt(0) - 97;
    if (k >= 0 && k < 26) { counts[k]++; n++; }
  }
  if (!n) return 0;
  const norm = Math.hypot(...counts);
  let best = 0;
  for (const v of Object.values(VECTORS)) {
    let dot = 0;
    for (let i = 0; i < 26; i++) dot += v[i] * counts[i];
    best = Math.max(best, dot / norm);
  }
  return best;
}

/** Case changes inside a word after its first letter: "McDonald" 2, "tMvWlVmT" 7, "WLAN" 0. */
function caseSwitches(word) {
  let n = 0, prev = null;
  for (const ch of word.slice(1)) {
    const up = ch !== ch.toLowerCase() ? true : ch !== ch.toUpperCase() ? false : null;
    if (up === null) continue;
    if (prev !== null && up !== prev) n++;
    prev = up;
  }
  return n;
}

/** A word a voice can say: a vowel in it (or short like "Dr", "kg"), at most two changes between capitals and small letters. */
export function plausibleWord(word) {
  const w = String(word || '').replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  if (!w || !/\p{L}/u.test(w)) return true;
  if (caseSwitches(w) > 2) return false;
  if (LATIN.test(w) && w.length >= 4 && !VOWELS.test(w)) return false;
  return true;
}

/**
 * Inspects a text (a PDF page, a paragraph, a line) and says whether it is readable.
 * @returns {{ junk: boolean, reason: string|null, chars: number, letters: number, words: number }}
 *   reason: 'chars' (control, private use, symbols of a broken font map), 'script' (letters of many scripts or none
 *   a German or English voice can say), 'symbols' (mostly signs, e.g. the rows of a diagram font), 'words' (words no
 *   one can say: no vowels, capitals and small letters alternating), 'letters' (letters in the wrong frequencies:
 *   a font map that moved them).
 */
export function inspectText(text) {
  const s = String(text || '');
  const chars = [...s.replace(/\s+/g, '')];
  const res = { junk: false, reason: null, chars: chars.length, letters: 0, words: 0 };
  if (chars.length < 3) return res;
  let bad = 0, letters = 0, latin = 0, other = 0, digits = 0;
  for (const ch of chars) {
    if (BAD_CHAR.test(ch)) bad++;
    if (/\p{L}/u.test(ch)) { letters++; if (LATIN.test(ch)) latin++; else if (OTHER_SCRIPT.test(ch)) other++; }
    else if (/\p{N}/u.test(ch)) digits++;
  }
  res.letters = letters;
  const tokens = s.split(/\s+/).filter(Boolean);
  res.words = tokens.length;
  const chessShare = tokens.length ? tokens.filter((t) => isChessToken(t)).length / tokens.length : 0;
  const chessy = chessShare >= 0.3;
  if (bad / chars.length >= 0.08) return { ...res, junk: true, reason: 'chars' };
  if (letters >= 4 && other / letters > 0.3) return { ...res, junk: true, reason: 'script' };
  if (!chessy && (letters + digits) / chars.length < 0.5) return { ...res, junk: true, reason: 'symbols' };
  // words: a diagram row in a chess font, letters without vowels
  const wordy = tokens.filter((t) => /\p{L}{2,}/u.test(t) && !isChessToken(t));
  if (wordy.length >= 1) {
    const implausible = wordy.filter((t) => !plausibleWord(t)).length;
    if (implausible / wordy.length > (wordy.length >= 4 ? 0.34 : 0.5)) return { ...res, junk: true, reason: 'words' };
  }
  // letters moved by a broken font map: only judged on enough letters. Prose, lists and registers of the languages
  // above match at 0.85 or more, text whose letters a broken map moved by a few places at 0.72 or less; chess
  // notation (many a to h) is left alone
  if (latin >= 120 && chessShare < 0.1 && letterFit(s) < 0.8) return { ...res, junk: true, reason: 'letters' };
  return res;
}

/** true when the text holds nothing a voice should say (see inspectText). */
export const isJunk = (text) => inspectText(text).junk;
