// Language detection (German / English) and sentence splitting for the read-aloud feature.
// Pure functions, no DOM – also usable in Node (`node --input-type=module -e "import('./tts-lang.js')…"`).
import { isChessToken, startsWithMove } from './tts-chess.js';

const DE_WORDS = new Set(('der die das und ist nicht ein eine einen einem einer ich sie er es wir ihr mit auf für von zu den dem des im in an dass daß wird sind auch wie nach bei aus noch aber oder wenn nur sich über als so kann hat haben war wurde werden mehr schon sehr hier durch um vor bis zwischen diese dieser dieses ihre sein seine mein meine keine nichts man ihn ihm ihnen uns euch dich dir mich mir doch jetzt dann denn weil ob obwohl wieder immer schon ganz alle alles etwas nichts viel vielleicht gegen ohne unter während seit muss musste können konnte sollte würde hatte hatten waren wurden gibt geht kommt sagte sagt macht machen dieses jener jene welche welcher zum zur beim vom ins ans aufs').split(' '));
const EN_WORDS = new Set(('the and is are was were of to in that it with for as on at by this from be have has had not but they you he she we his her their there which would could should will can about into than then them these those what when where who why how been being do does did an or if so no my your our its also just very more most some any all one out out up down over under after before because while through between each other only new first last long great little own same still even never always might must may shall').split(' '));
// tokens that are near-certain markers of one language
const DE_STRONG = new Set(['und', 'nicht', 'ist', 'das', 'dass', 'daß', 'ich', 'sie', 'wir', 'mit', 'für', 'auch', 'eine', 'einen', 'einem', 'einer', 'dem', 'den', 'des', 'sich', 'noch', 'schon', 'oder', 'aber', 'wird', 'sind', 'werden', 'wurde', 'zwischen', 'über', 'während', 'jetzt', 'immer']);
const EN_STRONG = new Set(['the', 'and', 'is', 'are', 'was', 'were', 'of', 'that', 'with', 'this', 'from', 'have', 'has', 'not', 'they', 'you', 'which', 'would', 'could', 'there', 'their', 'what', 'been', 'because', 'into', 'through']);

/** Returns { de, en } scores in [0..1] (fraction of tokens that look like the language) plus token count. */
export function scoreLanguages(text) {
  const s = String(text || '').toLowerCase();
  const tokens = s.match(/[a-zäöüßáéíóúàèìòùâêîôûñç']+/g) || [];
  let de = 0, en = 0;
  for (const t of tokens) {
    if (DE_WORDS.has(t)) de += DE_STRONG.has(t) ? 2 : 1;
    if (EN_WORDS.has(t)) en += EN_STRONG.has(t) ? 2 : 1;
  }
  // orthographic evidence
  const umlauts = (s.match(/[äöüß]/g) || []).length;
  de += umlauts * 2;
  const enPatterns = (s.match(/\b(?:th[aeiou]|wh[aeio]|[a-z]+n't|[a-z]+'s|[a-z]+ing\b|[a-z]+tion\b)/g) || []).length;
  en += enPatterns * 0.5;
  const dePatterns = (s.match(/\b(?:sch[a-z]|[a-z]+ung\b|[a-z]+keit\b|[a-z]+lich\b|[a-z]+chen\b|ge[a-z]+t\b)/g) || []).length;
  de += dePatterns * 0.5;
  const n = Math.max(1, tokens.length);
  return { de: de / n, en: en / n, tokens: tokens.length };
}

/**
 * detectLanguage(text) → 'de' | 'en' | null   (null = not enough evidence / undecidable)
 * Works on single sentences (needs ~2 recognisable tokens) and prefers the clearer signal.
 */
export function detectLanguage(text) {
  const { de, en, tokens } = scoreLanguages(text);
  if (!tokens) return null;
  const minEvidence = tokens < 4 ? 0.34 : 0.12;
  if (de === en) return null;
  if (de > en) return de >= minEvidence && de >= en * 1.5 ? 'de' : null;
  return en >= minEvidence && en >= de * 1.5 ? 'en' : null;
}

// --- the language of a book or a paragraph ------------------------------------------------------------------
// Book metadata is often wrong: a word processor writes 'en-US' into a German PDF, a converter leaves bytes of a
// broken string ('<¦'), many PDFs have none at all. Read with the wrong voice, a German text sounds like gibberish.
// So the text decides whenever it is clear, the metadata only when the text is not, then the language of the app,
// then German.
const LANG_NAMES = {
  de: ['de', 'ger', 'deu', 'german', 'germa', 'germ', 'deutsch', 'deutsc', 'deuts', 'allemand', 'alemán', 'aleman', 'tedesco'],
  en: ['en', 'eng', 'english', 'engl', 'englisch', 'anglais', 'inglés', 'ingles', 'inglese'],
  fr: ['fr', 'fre', 'fra', 'french', 'français', 'francais', 'französisch'],
  es: ['es', 'spa', 'spanish', 'español', 'espanol', 'spanisch'],
  it: ['it', 'ita', 'italian', 'italiano', 'italienisch'],
  nl: ['nl', 'nld', 'dut', 'dutch', 'nederlands', 'niederländisch'],
  la: ['la', 'lat', 'latin', 'latein'],
};
const NAME_TO_CODE = new Map(Object.entries(LANG_NAMES).flatMap(([code, names]) => names.map((n) => [n, code])));

/**
 * The language code of a metadata entry: 'de-DE', 'DE', 'Germa', 'ger', 'Deutsch' → 'de'; 'en-US', 'eng' → 'en';
 * another valid tag → its two letters ('fr', 'pl'); garbage ('<¦', 'ƒ*ªþ×'), 'und', 'mul', 'x-…' or nothing → null.
 */
export function normalizeLangCode(raw) {
  const s = String(raw ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (!s) return null;
  const head = s.split(/[-;,\s]/)[0];
  if (NAME_TO_CODE.has(head)) return NAME_TO_CODE.get(head);
  if (NAME_TO_CODE.has(s)) return NAME_TO_CODE.get(s);
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(s)) return null;
  if (['und', 'mul', 'zxx', 'mis'].includes(head) || head.startsWith('x')) return null;
  return head.length === 2 ? head : null;   // an unknown three-letter code says too little
}

/**
 * The language to read a text in, 'de' or 'en' (the languages of the voices).
 * @param {string} text   a sample of the book (the first pages) or one paragraph
 * @param {{ meta?: string, ui?: string }} [opts]   meta = the language in the book's metadata, ui = of the app
 * @returns {{ lang: 'de'|'en', source: 'text'|'meta'|'ui'|'default', meta: string|null }}
 */
export function chooseLanguage(text, { meta, ui } = {}) {
  const m = normalizeLangCode(meta);
  const det = detectLanguage(text);
  if (det) return { lang: det, source: 'text', meta: m };
  if (m === 'de' || m === 'en') return { lang: m, source: 'meta', meta: m };
  const u = normalizeLangCode(ui);
  if (u === 'de' || u === 'en') return { lang: u, source: 'ui', meta: m };
  return { lang: 'de', source: 'default', meta: m };
}

/**
 * Languages for the paragraphs of a reading. The base comes from chooseLanguage() over the beginning (`sample`
 * characters); a single paragraph changes to the other language only on clear evidence (at least `minTokens` words
 * and twice the score of the base language), so the English quote in a German book is read in English while
 * headings, names and short lines stay in the language of the book.
 * @param {string[]} paragraphs
 * @param {{ meta?: string, ui?: string, base?: 'de'|'en', sample?: number, minTokens?: number }} [opts]
 *   base: a language decided before (on an earlier page of the book) that the later pages keep
 * @returns {{ base: 'de'|'en', source: string, langs: ('de'|'en')[] }}
 */
export function planLanguages(paragraphs, { meta, ui, base, sample = 4000, minTokens = 5 } = {}) {
  const list = (paragraphs || []).map((p) => String(p || ''));
  let choice;
  if (base === 'de' || base === 'en') choice = { lang: base, source: 'kept' };
  else {
    // the paragraphs of the beginning vote, weighted by their length: a German book with an English quote stays German
    let head = '', de = 0, en = 0;
    for (const p of list) {
      if (head.length > sample) break;
      head += p + '\n';
      const d = detectLanguage(p);
      if (d === 'de') de += p.length; else if (d === 'en') en += p.length;
    }
    if (de + en >= 40 && Math.max(de, en) >= 0.6 * (de + en)) choice = { lang: de >= en ? 'de' : 'en', source: 'text' };
    else choice = chooseLanguage(head, { meta, ui });
  }
  const other = choice.lang === 'de' ? 'en' : 'de';
  const langs = list.map((p) => {
    const sc = scoreLanguages(p);
    if (sc.tokens < minTokens) return choice.lang;
    const own = choice.lang === 'de' ? sc.de : sc.en, theirs = other === 'de' ? sc.de : sc.en;
    return detectLanguage(p) === other && theirs >= 2 * Math.max(own, 0.02) ? other : choice.lang;
  });
  return { base: choice.lang, source: choice.source, langs };
}

// --- sentence splitting -------------------------------------------------------------------------------------
// abbreviations that never end a sentence (lower case, without the trailing period; compact forms like "z.b" included)
const ABBR_DE = 'z b u d o i v z.b u.a d.h o.ä i.d.r v.a bzw ca dr prof nr hr hrn fr frl st vgl evtl ggf ggfs etc usw jh bd abs art mio mrd tsd inkl exkl zzgl bzgl sog geb gest std sek tel str hrsg aufl kap abb tab anm jg fa co ing dipl mag med jur phil rer nat chr n.chr v.chr allg bes dgl engl ev ff gegr hl insb kath lat lt mtl nachm vorm od pl sg röm spez tägl urspr verh verw wiss zit zw zzt jan feb mär märz apr jun jul aug sep sept okt nov dez mwst ust pos bsp vs ps nb a.d a.m p.m evang hg ehem eigtl entspr erg forts geb gem ggü hins insg jhd jhdt kl km m cm mm kg mg ml l h min tsd stck skt sog stellv tägl u.u u.ä u.v.m u.s.w usf verf vorm wg wtl zw'.split(' ');
const ABBR_EN = 'mr mrs ms dr prof sr jr st mt vs etc e.g i.e fig vol approx inc ltd co corp jan feb mar apr jun jul aug sep sept oct nov dec a.m p.m u.s u.k u.s.a ed eds ch sec gen col capt lt sgt rev hon esq ave blvd rd dept univ assn bros cf op ca viz al ph.d m.d b.a m.a b.sc m.sc d.c a.d b.c misc dept est max min no nos p pp para pt pts qty ref repr sq tel vs vols wt yr yrs govt hwy natl intl assoc bldg mfg'.split(' ');
// abbreviations that only count when followed by a number ("No. 5", "S. 12", "p. 7")
const ABBR_NUM = new Set(['no', 'nos', 'nr', 's', 'p', 'pp', 'bd', 'abs', 'art', 'kap', 'tel', 'fig', 'vol', 'ch', 'sec', 'pos', 'jg', 'anm', 'abb', 'tab', 'para', 'pt', 'ref', 'sq', 'min', 'max', 'ca', 'approx', 'est']);
const SETS = { de: new Set(ABBR_DE), en: new Set(ABBR_EN) };
const ALL = new Set([...ABBR_DE, ...ABBR_EN]);
const ORDINAL_NOUNS_DE = /^(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember|Jan\.|Feb\.|Mär\.|Apr\.|Jun\.|Jul\.|Aug\.|Sep\.|Sept\.|Okt\.|Nov\.|Dez\.|Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag|Jahrhundert|Jh\.|Jahrtausend|Lebensjahr|Klasse|Stock|Etage|Auflage|Aufl\.|Kapitel|Buch|Band|Teil|Akt|Szene|Platz|Mal|Tag|Woche|Monat|Jahr|Halbjahr|Quartal|Bezirk|Semester|Sinfonie|Symphonie|Weltkrieg|Reich|Armee|Division|Generation|Runde|Spieltag|Liga|Ausgabe|Fassung|Folge|Staffel|Stufe|Schritt|Position|Stelle|Zeile|Absatz|Vers|Strophe|Satz|Preis|Sieg|Versuch|Anlauf|Advent|Weihnachtstag|Geburtstag|Hochzeitstag|Todestag|Jahrestag|Person|Wahlgang|Durchgang|Halbzeit|Minute|Sekunde|Stunde)\b/;
const ORDINAL_CUES_DE = new Set('am im den dem des der die das vom zum zur bis seit ab nach vor jeden jedes jede jeder ein eine einen einem einer mein meine meinen meinem sein seine seinen seinem ihr ihre ihren ihrem unser unsere unseren euer eure beim an in auf um unter über zwischen als zum kapitel teil band abschnitt punkt'.split(' '));

const OPEN_QUOTES = '"\'“„«»‹›‚‘(\\[';
const CLOSE_QUOTES = '"\'”“»«›‹’)\\]';
const TERMINAL_RE = new RegExp(`([.!?…]+)([${CLOSE_QUOTES}]*)(?=\\s|$)`, 'g');

function stripQuotes(w) { return w.replace(new RegExp(`^[${OPEN_QUOTES}]+`), '').replace(new RegExp(`[${CLOSE_QUOTES}]+$`), ''); }

function isBoundary(para, m, start, lang) {
  const punct = m[1];
  const end = m.index + m[0].length;
  const rest = para.slice(end).replace(/^\s+/, '');
  const nextChar = rest.charAt(0);
  if (!nextChar) return true; // end of paragraph
  const before = para.slice(start, m.index);
  const lastWord = stripQuotes((/(\S+)$/.exec(before) || ['', ''])[1] || '');
  const lw = lastWord.toLowerCase().replace(/\.+$/, '');
  // continuation: next word starts lower case → probably not a sentence end ("z. B. äpfel", "„Was?“ fragte er")
  if (/\p{Ll}/u.test(nextChar)) return false;
  // chess notation: "2. Sf3", "12... Sf6", "Dd7? 13. Lxf7+! Kxf7" – a move number or an annotated move before a move
  if (startsWithMove(rest) && (/^\d{1,3}$/.test(lastWord) || isChessToken(lastWord))) return false;
  if (!/^\.+$/.test(punct)) return true; // ! ? … always end (unless lower-case continuation above)
  if (punct.length >= 2) return true;    // "..." followed by upper case
  // period rules
  if (!lastWord) return true;
  const set = lang === 'de' ? SETS.de : lang === 'en' ? SETS.en : ALL;
  if (set.has(lw)) {
    if (ABBR_NUM.has(lw)) return !/^\d/.test(nextChar);
    return false;
  }
  if (ABBR_NUM.has(lw) && /^\d/.test(nextChar)) return false;
  // initials: "E. T. A. Hoffmann", "z. B." – a single letter (any case) before the period
  if (/^\p{L}$/u.test(lastWord)) return false;
  // numbers: German ordinals "am 3. Mai", "das 19. Jahrhundert", "die 2. Auflage"; a year (4 digits) ends the sentence
  if (/^\d+$/.test(lastWord)) {
    if (lastWord.length <= 2 && lang !== 'en') {
      const prevWord = stripQuotes((/(\S+)\s+\S+$/.exec(before) || ['', ''])[1] || '').toLowerCase().replace(/\.+$/, '');
      if (ABBR_NUM.has(prevWord)) return true;           // "Nr. 5. Fertig" – a reference number, not an ordinal
      if (ORDINAL_NOUNS_DE.test(rest)) return false;      // "3. Mai", "19. Jahrhundert"
      if (ORDINAL_CUES_DE.has(prevWord)) return false;    // "am 3. Tag", "die 2. Ausgabe"
      if (/^\d/.test(nextChar)) return false;            // "3. 4. und 5. Platz"
    }
    return true;
  }
  return true;
}

/**
 * Splits text into sentences suitable for TTS. Handles abbreviations (German + English), initials, ordinals,
 * decimals, quotes and ellipses; paragraph breaks always split; overly long sentences are chunked at clause
 * boundaries (`maxLen`, default 320 chars) and tiny fragments ("1.", "A.") are merged into their neighbour (`minLen`).
 * @param {string} text
 * @param {'de'|'en'|'auto'|null} [lang]
 * @param {{maxLen?:number, minLen?:number}} [opts]
 * @returns {string[]}
 */
export function splitSentences(text, lang = 'auto', opts = {}) {
  const maxLen = opts.maxLen || 320;
  const minLen = opts.minLen ?? 2;
  let s = String(text || '').replace(/\r\n?/g, '\n').replace(/\u00AD/g, '').replace(/[\t\f\v ]+/g, ' ');
  if (!s.trim()) return [];
  if (!lang || lang === 'auto') lang = detectLanguage(s) || 'auto';
  // hyphenated line breaks (PDF): "Wör-\nter" → "Wörter"
  s = s.replace(/(\p{Ll})-\n(\p{Ll})/gu, '$1$2');
  // line breaks: keep as boundary after terminal punctuation or after short (heading-like) lines; else join
  const lines = s.split('\n');
  const paras = [];
  let cur = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { if (cur) paras.push(cur); cur = ''; continue; }
    if (!cur) { cur = line; continue; }
    const endsSentence = new RegExp(`[.!?…:][${CLOSE_QUOTES}]*$`).test(cur);
    const heading = cur.length <= 50 && !/[,;]$/.test(cur) && /^[\p{Lu}\d„"“«»(]/u.test(line);
    if (endsSentence || heading) { paras.push(cur); cur = line; }
    else cur += ' ' + line;
  }
  if (cur) paras.push(cur);

  const out = [];
  for (const para of paras) {
    let start = 0;
    TERMINAL_RE.lastIndex = 0;
    let m;
    while ((m = TERMINAL_RE.exec(para))) {
      if (m.index < start) continue;
      if (isBoundary(para, m, start, lang)) {
        const sent = para.slice(start, m.index + m[0].length).trim();
        if (sent) out.push(sent);
        start = m.index + m[0].length;
      }
    }
    const tail = para.slice(start).trim();
    if (tail) out.push(tail);
  }

  // merge tiny fragments ("1.", "A.", lone quotes) into the following sentence
  const merged = [];
  let carry = '';
  for (const sent of out) {
    const joined = carry ? carry + ' ' + sent : sent;
    if (joined.replace(/[^\p{L}\p{N}]/gu, '').length < minLen) { carry = joined; continue; }
    merged.push(joined); carry = '';
  }
  if (carry) { if (merged.length) merged[merged.length - 1] += ' ' + carry; else merged.push(carry); }

  // chunk very long sentences at clause boundaries
  const result = [];
  for (const sent of merged) for (const c of chunkLong(sent, maxLen)) result.push(c);
  return result;
}

function chunkLong(sent, maxLen) {
  if (sent.length <= maxLen) return [sent];
  const parts = [];
  let rest = sent;
  while (rest.length > maxLen) {
    const window = rest.slice(0, maxLen);
    let cut = -1;
    for (const re of [/[;:]\s(?=\S)/g, /[,–—]\s(?=\S)/g, /\s(?=\S)/g]) {
      let mm; let last = -1;
      while ((mm = re.exec(window))) if (mm.index > maxLen * 0.3) last = mm.index + mm[0].length;
      if (last > 0) { cut = last; break; }
    }
    if (cut <= 0) cut = maxLen;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * Normalises text for a TTS engine: collapses whitespace, removes footnote markers and control characters, joins the
 * words a PDF hyphenated at the end of a line and shortens web addresses to their domain.
 */
export function normalizeForSpeech(text) {
  return String(text || '')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ')
    .replace(/\u00AD/g, '')
    // "Wör- ter" (a PDF line end) → "Wörter"; "Ein- und Ausgang", "be- oder entlasten" keep their hyphen
    .replace(/(\p{Ll}{2,})-\s+(?!(?:und|oder|bis|sowie|bzw|beziehungsweise|als|wie|noch|and|or|nor|to)\b)(\p{Ll}{2,})/gu, '$1$2')
    // "https://www.zeit.de/politik/artikel" → "zeit.de": the path is never worth hearing
    .replace(/\bhttps?:\/\/(?:www\.)?([\w-]+(?:\.[\w-]+)+)\S*?(?=[.,;:!?)\]]*(?:\s|$))/gi, '$1')
    .replace(/\bwww\.([\w-]+(?:\.[\w-]+)+)\S*?(?=[.,;:!?)\]]*(?:\s|$))/gi, '$1')
    .replace(/\[\d{1,3}\]/g, '')            // [12] footnote references
    .replace(/[⁰¹²³⁴-⁹]+/g, '') // superscript footnote markers
    // trailing footnote digits ("Wort12,") – at least three lower-case letters must precede them so that
    // "Vitamin B12.", "COVID19", "Airbus A320" or "Abschnitt A2," keep their number
    .replace(/(?<=\p{Ll}{3})\d{1,2}(?=[\s,.;])/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
