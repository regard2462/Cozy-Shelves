// German text normalisation + grapheme-to-phoneme (G2P) for the Piper/VITS voices (Thorsten & Co.).
//
// Why a hand-written G2P and not eSpeak-NG?
//   Piper models are trained on eSpeak-NG IPA. The only eSpeak build that ships with this app
//   (node_modules/phonemizer, embedded in kokoro-js) is an ENGLISH-ONLY wasm build – `phonemize(t,'de')`
//   throws "Invalid language identifier". Adding a German-capable eSpeak/piper-phonemize wasm would mean
//   pulling a new binary dependency into the tree. This module instead implements German letter-to-sound
//   rules directly, emitting exactly the IPA symbol inventory that the Piper `phoneme_id_map` contains
//   (see docs/TTS.md). German orthography is highly regular, so a rule set plus a lexicon for the frequent
//   irregular/function words gets very close.
//
// The phonemiser is pluggable: `setPhonemizer(fn)` replaces `germanPhonemes` at runtime, so a real
// espeak-ng/piper-phonemize wasm can be dropped in later without touching the worker or the client.
//
// Pure module – no DOM, no worker globals, no ONNX. Unit-testable with plain node:
//   node --input-type=module -e "import('./app/src/workers/piper-de.js').then(m => console.log(m.germanPhonemes('Guten Tag!')))"

// --- phoneme inventory (all of these exist in every rhasspy/piper-voices de_DE phoneme_id_map) ---------
export const DE_PHONEME_SET = new Set([
  'a', 'aː', 'ɛ', 'ɛː', 'eː', 'ɪ', 'iː', 'ɔ', 'oː', 'ʊ', 'uː', 'ʏ', 'yː', 'œ', 'øː', 'ə', 'ɐ',
  'p', 'b', 't', 'd', 'k', 'ɡ', 'f', 'v', 's', 'z', 'ʃ', 'ʒ', 'ç', 'x', 'h', 'm', 'n', 'ŋ', 'l', 'ʁ', 'j', 'ʔ',
]);

const LONG = { a: 'aː', e: 'eː', i: 'iː', o: 'oː', u: 'uː', 'ä': 'ɛː', 'ö': 'øː', 'ü': 'yː', y: 'yː' };
const SHORT = { a: 'a', e: 'ɛ', i: 'ɪ', o: 'ɔ', u: 'ʊ', 'ä': 'ɛ', 'ö': 'œ', 'ü': 'ʏ', y: 'ʏ' };
// tense but short: unstressed open syllables ("Melodie" → meloˈdiː, "Auto" → ˈaʊ̯to)
const TENSE = { a: 'a', e: 'e', i: 'i', o: 'o', u: 'u', 'ä': 'ɛ', 'ö': 'ø', 'ü': 'y', y: 'y' };
const VOWEL_CHARS = 'aeiouäöüy';
const isVowel = (c) => !!c && VOWEL_CHARS.includes(c);
const isCons = (c) => !!c && /[a-zß]/.test(c) && !isVowel(c);

// --- 1. text normalisation --------------------------------------------------------------------------
const ONES = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
const TENS = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];
const ORDINAL_IRREG = { 1: 'erste', 3: 'dritte', 7: 'siebte', 8: 'achte' };

/** 0 … 999 999 999 999 → German words ("einundzwanzig", "zweitausenddreihundert"). */
export function numberToGerman(n, opts = {}) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n < 20) return n === 1 && opts.attributive ? 'ein' : ONES[n];
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)], o = n % 10;
    return o ? (o === 1 ? 'ein' : ONES[o]) + 'und' + t : t;
  }
  if (n < 1000) {
    const h = Math.floor(n / 100), r = n % 100;
    return (h === 1 ? 'ein' : ONES[h]) + 'hundert' + (r ? numberToGerman(r) : '');
  }
  if (n < 1000000) {
    const th = Math.floor(n / 1000), r = n % 1000;
    return (th === 1 ? 'ein' : numberToGerman(th, { attributive: true })) + 'tausend' + (r ? numberToGerman(r) : '');
  }
  for (const [limit, one, many] of [[1e9, 'eine Million', 'Millionen'], [1e12, 'eine Milliarde', 'Milliarden']]) {
    if (n < limit) {
      const unit = limit / 1e6 === 1e3 ? 1e6 : 1e9;
      const cnt = Math.floor(n / unit), r = n % unit;
      const head = cnt === 1 ? one : numberToGerman(cnt, { attributive: true }) + ' ' + many;
      return head + (r ? ' ' + numberToGerman(r) : '');
    }
  }
  return String(n).split('').map((d) => ONES[Number(d)]).join(' ');
}

/** "3." → "dritte", "21." → "einundzwanzigste" */
export function ordinalToGerman(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (ORDINAL_IRREG[n]) return ORDINAL_IRREG[n];
  const base = numberToGerman(n);
  return base + (n < 20 ? 'te' : 'ste');
}

/** Years read as "neunzehnhundertvierundachtzig" (1100–1999) resp. "zweitausend…". */
function yearToGerman(n) {
  if (n >= 1100 && n < 2000) {
    const hundreds = Math.floor(n / 100), rest = n % 100;
    return numberToGerman(hundreds) + 'hundert' + (rest ? numberToGerman(rest) : '');
  }
  return numberToGerman(n);
}

// Abbreviations. Letters in JS regexps: \b only knows ASCII, so umlaut-initial words use (?<![\p{L}]) instead.
const ABBREV = [
  [/\bz\.\s?B\./gi, 'zum Beispiel'], [/\bu\.\s?a\./gi, 'unter anderem'], [/\bd\.\s?h\./gi, 'das heißt'],
  [/\bu\.\s?s\.\s?w\./gi, 'und so weiter'], [/\busw\./gi, 'und so weiter'], [/\busf\./gi, 'und so fort'], [/\bbzw\./gi, 'beziehungsweise'],
  [/\bggf\.?s?\b/gi, 'gegebenenfalls'], [/\bevtl\./gi, 'eventuell'], [/\binkl\./gi, 'inklusive'],
  [/\bexkl\./gi, 'exklusive'], [/\bca\./gi, 'circa'], [/\bvgl\./gi, 'vergleiche'], [/\betc\./gi, 'et cetera'],
  [/\bDr\./g, 'Doktor'], [/\bProf\./g, 'Professor'], [/\bNr\./g, 'Nummer'], [/\bAbb\./g, 'Abbildung'],
  [/\bMio\./gi, 'Millionen'], [/\bMrd\./gi, 'Milliarden'], [/\bJh\./gi, 'Jahrhundert'], [/\bJhd?t?\./gi, 'Jahrhundert'],
  [/\bggü\./gi, 'gegenüber'], [/\bsog\./gi, 'sogenannt'], [/\bHrsg\./gi, 'Herausgeber'], [/\bAufl\./gi, 'Auflage'],
  [/\bi\.\s?d\.\s?R\./gi, 'in der Regel'], [/(?<![\p{L}])o\.\s?ä\./giu, 'oder ähnlich'], [/\bv\.\s?a\./gi, 'vor allem'],
  [/\bu\.\s?U\./g, 'unter Umständen'], [/\bz\.\s?T\./g, 'zum Teil'], [/\bu\.\s?v\.\s?m\./gi, 'und vieles mehr'],
  [/\bv\.\s?Chr\./g, 'vor Christus'], [/\bn\.\s?Chr\./g, 'nach Christus'], [/\bbspw\./gi, 'beispielsweise'],
  [/\binsb\./gi, 'insbesondere'], [/\bzzgl\./gi, 'zuzüglich'], [/\bbzgl\./gi, 'bezüglich'], [/\bsog\./gi, 'sogenannt'],
  [/\bBd\.(?=\s*\d)/g, 'Band'], [/\bKap\.(?=\s*[\dIVX])/g, 'Kapitel'], [/\bAbs\.(?=\s*\d)/g, 'Absatz'],
  [/\bArt\.(?=\s*\d)/g, 'Artikel'], [/\bS\.(?=\s*\d)/g, 'Seite'], [/\bTab\.(?=\s*\d)/g, 'Tabelle'], [/\bAnm\.(?=\s*\d)/g, 'Anmerkung'],
  [/\b(\d+)\s?ff\./g, '$1 folgende'], [/\bHr\.(?=\s+\p{Lu})/gu, 'Herr'], [/\bFr\.(?=\s+\p{Lu})/gu, 'Frau'],
  [/\bSt\.(?=\s+\p{Lu})/gu, 'Sankt'], [/\bStr\./g, 'Straße'], [/\bTel\./g, 'Telefon'], [/\bTsd\./g, 'Tausend'],
  [/\bStd\./g, 'Stunden'], [/\bMin\./g, 'Minuten'], [/\bSek\./g, 'Sekunden'], [/\bgeb\.(?=\s*\d)/g, 'geboren'],
  [/\bgest\.(?=\s*\d)/g, 'gestorben'], [/\bmind\.(?=\s*\d)/gi, 'mindestens'], [/\bmax\.(?=\s*\d)/gi, 'maximal'], [/\bmin\.(?=\s*\d)/g, 'mindestens'],
];
const SYMBOLS = [
  [/€/g, ' Euro'], [/\$/g, ' Dollar'], [/£/g, ' Pfund'], [/%/g, ' Prozent'], [/‰/g, ' Promille'],
  [/§§/g, 'Paragrafen '], [/§/g, 'Paragraf '], [/&/g, ' und '], [/°\s?C\b/g, ' Grad Celsius'], [/°/g, ' Grad'],
  [/\bkm\/h\b/g, 'Kilometer pro Stunde'], [/\bm\/s\b/g, 'Meter pro Sekunde'],
  [/\+/g, ' plus '], [/(?<=\s)=(?=\s)/g, ' gleich '], [/[@]/g, ' at '],
  [/(\d)\s*[–—−]\s*(\d)/g, '$1 bis $2'], [/\s[–—−]\s/g, ', '], [/[–—−]/g, ' '],
  [/[«»„“”‚‘’"']/g, ' '], [/[(){}\[\]]/g, ' '], [/…/g, '.'], [/\s\/\s/g, ' '],
];
// units after a number: [symbol, plural, singular (feminine units only, they need "eine")]
const UNITS = [
  ['km²', 'Quadratkilometer'], ['m²', 'Quadratmeter'], ['qm', 'Quadratmeter'], ['m³', 'Kubikmeter'], ['km', 'Kilometer'],
  ['cm', 'Zentimeter'], ['mm', 'Millimeter'], ['kg', 'Kilogramm'], ['mg', 'Milligramm'], ['ml', 'Milliliter'],
  ['kWh', 'Kilowattstunden', 'Kilowattstunde'], ['kW', 'Kilowatt'], ['MB', 'Megabyte'], ['GB', 'Gigabyte'], ['TB', 'Terabyte'],
  ['KB', 'Kilobyte'], ['ha', 'Hektar'], ['min', 'Minuten', 'Minute'], ['h', 'Stunden', 'Stunde'], ['m', 'Meter'],
  ['g', 'Gramm'], ['l', 'Liter'], ['s', 'Sekunden', 'Sekunde'],
];
const UNIT_RE = new RegExp(`(\\d+(?:,\\d+)?)\\s?(${UNITS.map((u) => u[0]).join('|')})(?![\\p{L}\\d²³/])`, 'gu');
const UNIT_WORD = Object.fromEntries(UNITS.map(([k, pl, sg]) => [k, { pl, one: sg ? 'eine ' + sg : 'ein ' + pl }]));
const FRACTIONS = { '1/2': 'einhalb', '1/3': 'ein Drittel', '2/3': 'zwei Drittel', '1/4': 'ein Viertel', '3/4': 'drei Viertel', '1/8': 'ein Achtel' };
// nouns after which "3." is an ordinal ("am 3. Oktober", "im 19. Jahrhundert")
const ORDINAL_NOUN_RE = /^\s+(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember|Jahrhundert|Jahrtausend|Lebensjahr|Klasse|Stock|Etage|Auflage|Kapitel|Band|Teil|Akt|Szene|Platz|Mal|Tag|Woche|Monat|Jahr|Quartal|Semester|Sinfonie|Symphonie|Weltkrieg|Reich|Armee|Division|Generation|Runde|Spieltag|Liga|Ausgabe|Fassung|Folge|Staffel|Stufe|Schritt|Absatz|Vers|Strophe|Satz|Preis|Advent|Geburtstag|Jahrestag|Todestag|Bezirk|Buch|Kongress|Parteitag|Mose|Korinther|Johannes)\b/u;
// determiners and prepositions before an ordinal ("am 3." → "am dritten", "der 3." → "der dritte")
const ORDINAL_CUE_RE = /(?:^|[^\p{L}])((?:an|auf|in|mit|zu|von|bei|nach|aus|vor|seit|unter|über|neben|zwischen)\s+)?(am|im|vom|zum|beim|dem|den|des|seit|ab|bis|der|die|das|ein|eine|einem|einen|einer|eines|jeden|jedem|jedes)\s+$/iu;
const NOMINATIVE_CUES = new Set(['der', 'die', 'das', 'ein', 'eine']);
const ORDINAL_CHAIN_RE = /\b(?:am|im|vom|zum|beim|dem|den|des|seit|ab)\s+\d{1,3}\.\s*(?:und|oder|bis|,)\s+$/i;
const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
function romanToInt(r) {
  let n = 0;
  for (let i = 0; i < r.length; i++) { const v = ROMAN[r[i]], w = ROMAN[r[i + 1]] || 0; n += v < w ? -v : v; }
  return n;
}

/**
 * Expands numbers, abbreviations and symbols so that the phonemizer (espeak-ng, or the rules below as a fallback)
 * only ever sees words. espeak-ng would read "3. Oktober" as the end of a sentence and "1990" as
 * "eintausendneunhundertneunzig", so dates, years and ordinals are written out here.
 * @param {string} text
 * @returns {string}
 */
export function normalizeGermanText(text) {
  let s = String(text || '')
    .replace(/\u00AD/g, '').replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬀ/g, 'ff').replace(/ﬃ/g, 'ffi').replace(/ﬄ/g, 'ffl')
    .replace(/½/g, ' 1/2').replace(/¼/g, ' 1/4').replace(/¾/g, ' 3/4');
  for (const [re, rep] of ABBREV) s = s.replace(re, rep);
  // Roman numerals: "Kapitel IV" → "Kapitel vier", "Ludwig XIV." → "Ludwig der Vierzehnte", "XIX. Jahrhundert"
  s = s.replace(/\b(Kapitel|Teil|Band|Buch|Akt|Szene|Abschnitt|Gesang|Brief)\s+([IVXLC]{1,6})\b/g, (m, w, r) => `${w} ${numberToGerman(romanToInt(r))}`);
  s = s.replace(/\b(\p{Lu}\p{Ll}+)\s+([IVX]{1,5})\.(?=\s|$)/gu, (m, name, r) => (romanToInt(r) > 0 && romanToInt(r) < 40 ? `${name} der ${capitalize(ordinalToGerman(romanToInt(r)))}` : m));
  s = s.replace(/\b([IVXL]{1,6})\.(?=\s+Jahrhundert)/g, (m, r) => romanToInt(r) + '.');
  // 1.000.000 / 3.500 – a number written with thousand separators is never a year reading
  s = s.replace(/\b\d{1,3}(?:\.\d{3})+\b/g, (m) => ' ' + numberToGerman(Number(m.replace(/\./g, ''))) + ' ');
  // money: "24,95 €" → "vierundzwanzig Euro fünfundneunzig", "5,– €" → "fünf Euro"
  const money = (a, c, unit) => `${numberToGerman(+a, { attributive: true })} ${unit}${c && +c ? ' ' + numberToGerman(+c) : ''}`;
  s = s.replace(/\b(\d+)(?:,(\d{2}|[-–]{1,2}))?\s?(€|EUR\b|Euro\b)/g, (m, a, c, u) => money(a, /\d/.test(c || '') ? c : '', 'Euro'));
  s = s.replace(/(€|EUR)\s?(\d+)(?:,(\d{2}))?\b/g, (m, u, a, c) => money(a, c, 'Euro'));
  s = s.replace(/\$\s?(\d+)(?:[.,](\d{2}))?\b/g, (m, a, c) => money(a, c, 'Dollar'));
  // times "14:30" / "8.30 Uhr" → "vierzehn Uhr dreißig"
  s = s.replace(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s?(Uhr)?/g, (m, h, mi) => `${numberToGerman(+h)} Uhr${+mi ? ' ' + numberToGerman(+mi) : ''}`);
  s = s.replace(/\b(\d{1,2})\.(\d{2})\s?Uhr\b/g, (m, h, mi) => `${numberToGerman(+h)} Uhr${+mi ? ' ' + numberToGerman(+mi) : ''}`);
  // results and ratios "2:1" → "zwei zu eins"
  s = s.replace(/\b(\d{1,3}):(\d{1,3})\b/g, (m, a, b) => `${numberToGerman(+a)} zu ${numberToGerman(+b)}`);
  // dates 3.5.1984
  s = s.replace(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/g, (m, d, mo, y) => `${ordinalToGerman(+d)}n ${ordinalToGerman(+mo)}n ${yearToGerman(+y)}`);
  // ordinals "3." – after an article or preposition with its ending, before a month, "Jahrhundert" etc. as "-te";
  // anything else (e.g. "auf Seite 3.") is a number at the end of a sentence
  s = s.replace(/\b(\d{1,3})\.(?=\s|$)/g, (m, d, at, all) => {
    const before = all.slice(Math.max(0, at - 16), at), after = all.slice(at + m.length);
    // "aus dem 17. und 18. Jahrhundert": the second ordinal takes the case of the first
    if (ORDINAL_CHAIN_RE.test(all.slice(Math.max(0, at - 24), at))) return ordinalToGerman(+d) + 'n';
    const cue = ORDINAL_CUE_RE.exec(before);
    if (cue) {
      // "der" after a preposition is dative ("an der 3. Stelle" → "dritten")
      const w = cue[2].toLowerCase();
      const nominative = NOMINATIVE_CUES.has(w) && !(w === 'der' && cue[1]);
      return ordinalToGerman(+d) + (nominative ? '' : 'n');
    }
    if (ORDINAL_NOUN_RE.test(after)) return ordinalToGerman(+d);
    return m;
  });
  // fractions "1/2 Liter" → "einhalb Liter"
  s = s.replace(/\b(\d)\/(\d)\b/g, (m) => FRACTIONS[m] || m.replace('/', ' durch '));
  // units after a number: "1,85 m" → "1,85 Meter", "1 h" → "1 Stunde"
  s = s.replace(UNIT_RE, (m, num, unit) => (num === '1' ? UNIT_WORD[unit].one : `${num} ${UNIT_WORD[unit].pl}`));
  // decimals; a point between digits is a section number ("2.5" → "zwei Punkt fünf") – as digits espeak-ng would
  // end the sentence there
  s = s.replace(/\b(\d+),(\d+)\b/g, (m, a, b) => `${numberToGerman(+a)} Komma ${b.split('').map((d) => ONES[+d]).join(' ')}`);
  s = s.replace(/\b(\d+)\.(?=\d)/g, (m, a) => `${a} Punkt `);
  for (const [re, rep] of SYMBOLS) s = s.replace(re, rep);
  // letters and digits in one word: "B12" → "B zwölf", "A320" → "A dreihundertzwanzig"
  s = s.replace(/(\p{L})(\d+)\b/gu, '$1 $2');
  // plain numbers (years get the "neunzehnhundert…" reading)
  s = s.replace(/\b\d{1,12}\b/g, (m) => (m.length === 4 && +m >= 1100 && +m < 2100 ? yearToGerman(+m) : numberToGerman(+m)));
  // leftover digits (very long numbers) digit by digit
  s = s.replace(/\d/g, (d) => ' ' + ONES[+d] + ' ');
  return s.replace(/\s+([,.;:!?])/g, '$1').replace(/\s+/g, ' ').trim();
}
const capitalize = (w) => w.charAt(0).toUpperCase() + w.slice(1);

// --- 2. lexicon (frequent + irregular words) ---------------------------------------------------------
// Values are ready-made phoneme strings; 'ˈ' marks the stressed syllable.
export const DE_LEXICON = Object.freeze(Object.fromEntries(Object.entries({
  der: 'deːɐ̯', die: 'diː', das: 'das', und: 'ʊnt', ist: 'ɪst', nicht: 'nɪçt', ein: 'aɪ̯n', eine: 'ˈaɪ̯nə',
  einen: 'ˈaɪ̯nən', einem: 'ˈaɪ̯nəm', einer: 'ˈaɪ̯nɐ', eines: 'ˈaɪ̯nəs', ich: 'ɪç', sie: 'ziː', er: 'eːɐ̯',
  es: 'ɛs', wir: 'viːɐ̯', ihr: 'iːɐ̯', mit: 'mɪt', auf: 'aʊ̯f', 'für': 'fyːɐ̯', von: 'fɔn', zu: 'tsuː',
  den: 'deːn', dem: 'deːm', des: 'dɛs', im: 'ɪm', in: 'ɪn', an: 'an', dass: 'das', 'daß': 'das',
  wird: 'vɪʁt', sind: 'zɪnt', auch: 'aʊ̯x', wie: 'viː', nach: 'naːx', bei: 'baɪ̯', aus: 'aʊ̯s', noch: 'nɔx',
  aber: 'ˈaːbɐ', oder: 'ˈoːdɐ', wenn: 'vɛn', nur: 'nuːɐ̯', sich: 'zɪç', 'über': 'ˈyːbɐ', als: 'als', so: 'zoː',
  kann: 'kan', hat: 'hat', haben: 'ˈhaːbən', war: 'vaːɐ̯', wurde: 'ˈvʊʁdə', werden: 'ˈveːɐ̯dən', mehr: 'meːɐ̯',
  schon: 'ʃoːn', sehr: 'zeːɐ̯', hier: 'hiːɐ̯', durch: 'dʊʁç', um: 'ʊm', vor: 'foːɐ̯', bis: 'bɪs',
  zwischen: 'ˈtsvɪʃən', diese: 'ˈdiːzə', dieser: 'ˈdiːzɐ', dieses: 'ˈdiːzəs', diesem: 'ˈdiːzəm', ihre: 'ˈiːʁə',
  sein: 'zaɪ̯n', seine: 'ˈzaɪ̯nə', mein: 'maɪ̯n', meine: 'ˈmaɪ̯nə', keine: 'ˈkaɪ̯nə', kein: 'kaɪ̯n',
  nichts: 'nɪçts', man: 'man', ihn: 'iːn', ihm: 'iːm', ihnen: 'ˈiːnən', uns: 'ʊns', euch: 'ɔʏ̯ç',
  dich: 'dɪç', dir: 'diːɐ̯', mich: 'mɪç', mir: 'miːɐ̯', doch: 'dɔx', jetzt: 'jɛtst', dann: 'dan', denn: 'dɛn',
  weil: 'vaɪ̯l', ob: 'ɔp', obwohl: 'ɔpˈvoːl', wieder: 'ˈviːdɐ', immer: 'ˈɪmɐ', ganz: 'ɡants', alle: 'ˈalə',
  alles: 'ˈaləs', etwas: 'ˈɛtvas', viel: 'fiːl', viele: 'ˈfiːlə', vielleicht: 'fiˈlaɪ̯çt', gegen: 'ˈɡeːɡən',
  ohne: 'ˈoːnə', unter: 'ˈʊntɐ', 'während': 'ˈvɛːʁənt', seit: 'zaɪ̯t', muss: 'mʊs', 'muß': 'mʊs',
  musste: 'ˈmʊstə', 'können': 'ˈkœnən', konnte: 'ˈkɔntə', sollte: 'ˈzɔltə', 'würde': 'ˈvʏʁdə', hatte: 'ˈhatə',
  hatten: 'ˈhatən', waren: 'ˈvaːʁən', wurden: 'ˈvʊʁdən', gibt: 'ɡiːpt', geht: 'ɡeːt', kommt: 'kɔmt',
  sagte: 'ˈzaːktə', sagt: 'zaːkt', macht: 'maxt', machen: 'ˈmaxən', zum: 'tsʊm', zur: 'tsuːɐ̯', beim: 'baɪ̯m',
  vom: 'fɔm', ins: 'ɪns', ans: 'ans', am: 'am', was: 'vas', wer: 'veːɐ̯', wo: 'voː', wann: 'van',
  warum: 'vaˈʁʊm', wieso: 'viˈzoː', heute: 'ˈhɔʏ̯tə', gestern: 'ˈɡɛstɐn', morgen: 'ˈmɔʁɡən',
  jahr: 'jaːɐ̯', jahre: 'ˈjaːʁə', jahren: 'ˈjaːʁən', zeit: 'tsaɪ̯t', mensch: 'mɛnʃ', menschen: 'ˈmɛnʃən',
  leben: 'ˈleːbən', welt: 'vɛlt', frau: 'fʁaʊ̯', mann: 'man', kind: 'kɪnt', kinder: 'ˈkɪndɐ', haus: 'haʊ̯s',
  buch: 'buːx', 'bücher': 'ˈbyːçɐ', stadt: 'ʃtat', land: 'lant', tag: 'taːk', tage: 'ˈtaːɡə', nacht: 'naxt',
  wasser: 'ˈvasɐ', gut: 'ɡuːt', neu: 'nɔʏ̯', 'groß': 'ɡʁoːs', klein: 'klaɪ̯n', lang: 'laŋ', deutsch: 'dɔʏ̯tʃ',
  deutschland: 'ˈdɔʏ̯tʃlant', europa: 'ɔʏ̯ˈʁoːpa', berlin: 'bɛɐ̯ˈliːn', wien: 'viːn', 'münchen': 'ˈmʏnçən',
  computer: 'kɔmˈpjuːtɐ', internet: 'ˈɪntɐnɛt', information: 'ɪnfɔʁmaˈtsi̯oːn', musik: 'muˈziːk',
  natur: 'naˈtuːɐ̯', kultur: 'kʊlˈtuːɐ̯', problem: 'pʁoˈbleːm', moment: 'moˈmɛnt', hotel: 'hoˈtɛl',
  familie: 'faˈmiːli̯ə', geschichte: 'ɡəˈʃɪçtə', beispiel: 'ˈbaɪ̯ʃpiːl', arbeit: 'ˈaʁbaɪ̯t', wort: 'vɔʁt',
  'wörter': 'ˈvœʁtɐ', seite: 'ˈzaɪ̯tə', seiten: 'ˈzaɪ̯tən', kapitel: 'kaˈpɪtəl', roman: 'ʁoˈmaːn',
  autor: 'ˈaʊ̯toːɐ̯', autorin: 'aʊ̯ˈtoːʁɪn', bibliothek: 'bibli̯oˈteːk', lesen: 'ˈleːzən', liest: 'liːst',
  stimme: 'ˈʃtɪmə', sprache: 'ˈʃpʁaːxə', deutsche: 'ˈdɔʏ̯tʃə', englisch: 'ˈɛŋlɪʃ', jahrhundert: 'jaːɐ̯ˈhʊndɐt',
  eins: 'aɪ̯ns', zwei: 'tsvaɪ̯', drei: 'dʁaɪ̯', vier: 'fiːɐ̯', 'fünf': 'fʏnf', sechs: 'zɛks', sieben: 'ˈziːbən',
  acht: 'axt', neun: 'nɔʏ̯n', zehn: 'tseːn', elf: 'ɛlf', 'zwölf': 'tsvœlf', hundert: 'ˈhʊndɐt',
  tausend: 'ˈtaʊ̯zənt', million: 'mɪˈli̯oːn', millionen: 'mɪˈli̯oːnən', null: 'nʊl',
  januar: 'ˈjanuaːɐ̯', februar: 'ˈfeːbʁuaːɐ̯', 'märz': 'mɛʁts', april: 'aˈpʁɪl', mai: 'maɪ̯', juni: 'ˈjuːni',
  juli: 'ˈjuːli', august: 'aʊ̯ˈɡʊst', september: 'zɛpˈtɛmbɐ', oktober: 'ɔkˈtoːbɐ', november: 'noˈvɛmbɐ',
  dezember: 'deˈtsɛmbɐ', montag: 'ˈmoːntaːk', dienstag: 'ˈdiːnstaːk', mittwoch: 'ˈmɪtvɔx',
  donnerstag: 'ˈdɔnɐstaːk', freitag: 'ˈfʁaɪ̯taːk', samstag: 'ˈzamstaːk', sonntag: 'ˈzɔntaːk',
  ja: 'jaː', nein: 'naɪ̯n', bitte: 'ˈbɪtə', danke: 'ˈdaŋkə', hallo: 'haˈloː', 'tschüss': 'tʃʏs',
  herr: 'hɛʁ', frau_: 'fʁaʊ̯', 'straße': 'ˈʃtʁaːsə', 'größer': 'ˈɡʁøːsɐ', 'schön': 'ʃøːn', 'möglich': 'ˈmøːklɪç',
  teil: 'taɪ̯l', ende: 'ˈɛndə', anfang: 'ˈanfaŋ', hand: 'hant', auge: 'ˈaʊ̯ɡə', augen: 'ˈaʊ̯ɡən',
  kopf: 'kɔpf', herz: 'hɛʁts', 'tür': 'tyːɐ̯', fenster: 'ˈfɛnstɐ', tisch: 'tɪʃ', stuhl: 'ʃtuːl',
  zimmer: 'ˈtsɪmɐ', 'körper': 'ˈkœʁpɐ', 'natürlich': 'naˈtyːɐ̯lɪç', eigentlich: 'ˈaɪ̯ɡəntlɪç',
  wirklich: 'ˈvɪʁklɪç', 'plötzlich': 'ˈplœtslɪç', endlich: 'ˈɛntlɪç', 'nämlich': 'ˈnɛːmlɪç',
  sondern: 'ˈzɔndɐn', zwar: 'tsvaːɐ̯', bereits: 'bəˈʁaɪ̯ts', jedoch: 'jeˈdɔx', damit: 'daˈmɪt',
  dabei: 'daˈbaɪ̯', dafür: 'daˈfyːɐ̯', darauf: 'daˈʁaʊ̯f', davon: 'daˈfɔn', wobei: 'voˈbaɪ̯',
  quelle: 'ˈkvɛlə', 'qualität': 'kvaliˈtɛːt', 'universität': 'univɛʁziˈtɛːt', theater: 'teˈaːtɐ',
  chemie: 'çeˈmiː', chor: 'koːɐ̯', charakter: 'kaˈʁaktɐ', chance: 'ˈʃãːsə', chef: 'ʃɛf',
  journalist: 'ʒʊʁnaˈlɪst', garage: 'ɡaˈʁaːʒə', orange: 'oˈʁãːʒə', restaurant: 'ʁɛstoˈʁãː',
  vase: 'ˈvaːzə', villa: 'ˈvɪla', vulkan: 'vʊlˈkaːn', vitamin: 'vitaˈmiːn', video: 'ˈviːdeo',
  klavier: 'klaˈviːɐ̯', 'nervös': 'nɛʁˈvøːs', revolution: 'ʁevoluˈtsi̯oːn', version: 'vɛʁˈzi̯oːn',
  // long vowels before "ch"/consonant clusters that the length rules would shorten
  hoch: 'hoːx', suchen: 'ˈzuːxən', sucht: 'zuːxt', kuchen: 'ˈkuːxən',
  besuch: 'bəˈzuːx', versuch: 'fɛɐ̯ˈzuːx', tuch: 'tuːx', fluch: 'fluːx', mond: 'moːnt', obst: 'oːpst',
  sprachen: 'ˈʃpʁaːxən',
  erde: 'ˈeːɐ̯də', pferd: 'pfeːɐ̯t', wert: 'veːɐ̯t', art: 'aːɐ̯t', arzt: 'aːɐ̯tst', 'städte': 'ˈʃtɛːtə',
  kraft: 'kʁaft', schrift: 'ʃʁɪft', hochzeit: 'ˈhɔxtsaɪ̯t',
  // frequent loans whose stress the rules would put on the first syllable
  tomate: 'toˈmaːtə', telefon: 'teləˈfoːn', mikrofon: 'mikʁoˈfoːn', balkon: 'balˈkoːn', beton: 'beˈtoːn',
  physik: 'fyˈziːk', fabrik: 'faˈbʁiːk', kritik: 'kʁiˈtiːk', politik: 'poliˈtiːk', genau: 'ɡəˈnaʊ̯',
  genug: 'ɡəˈnuːk', papier: 'paˈpiːɐ̯', maschine: 'maˈʃiːnə', person: 'pɛɐ̯ˈzoːn', kamera: 'ˈkaməʁa',
  minute: 'miˈnuːtə', sekunde: 'zeˈkʊndə', student: 'ʃtuˈdɛnt', museum: 'muˈzeːʊm', zentrum: 'ˈtsɛntʁʊm',
  unser: 'ˈʊnzɐ', unsere: 'ˈʊnzəʁə', unseren: 'ˈʊnzəʁən', unserem: 'ˈʊnzəʁəm', unserer: 'ˈʊnzəʁɐ',
  unseres: 'ˈʊnzəʁəs', unten: 'ˈʊntən', unser_: 'ˈʊnzɐ', werk: 'vɛʁk', werke: 'ˈvɛʁkə', herr_: 'hɛʁ',
  herren: 'ˈhɛʁən', damen: 'ˈdaːmən', dame: 'ˈdaːmə',
}).map(([k, v]) => {
  const word = k.replace(/_$/, '');
  // eSpeak inserts a glottal stop before a word-initial vowel in German
  let ph = v;
  if ('aeiouäöü'.includes(word[0]) && !ph.includes('ʔ')) {
    const si = ph.indexOf('ˈ');
    ph = si === 0 ? 'ˈʔ' + ph.slice(1) : 'ʔ' + ph;
  }
  return [word, ph];
})));

// --- 3. affixes -------------------------------------------------------------------------------------
// Prefix phonemes are tabulated – deriving them from the letter rules gets the vowel length wrong
// ("an-" is closed/short, "vor-" is long) and the reduced vowels of be-/ge-/ver- are irregular anyway.
const UNSTRESSED_PREFIXES = { ver: 'fɛɐ̯', zer: 'tsɛɐ̯', ent: 'ɛnt', emp: 'ɛmp', be: 'bə', ge: 'ɡə', er: 'ɛɐ̯' };
const STRESSED_PREFIXES = {
  'gegenüber': 'ɡeːɡənˈʔyːbɐ', 'auseinander': 'aʊ̯sʔaɪ̯ˈnandɐ', 'zusammen': 'tsuˈzamən', 'zurück': 'tsuˈʁʏk',
  'zwischen': 'ˈtsvɪʃən', 'hinter': 'ˈhɪntɐ', 'wieder': 'ˈviːdɐ', 'vorbei': 'foːɐ̯ˈbaɪ̯', 'gegen': 'ˈɡeːɡən',
  'unter': 'ˈʊntɐ', 'durch': 'ˈdʊʁç', 'über': 'ˈyːbɐ', 'voran': 'foˈʁan', 'nach': 'ˈnaːx', 'fort': 'ˈfɔʁt',
  'heim': 'ˈhaɪ̯m', 'auf': 'ˈaʊ̯f', 'aus': 'ˈaʊ̯s', 'ein': 'ˈaɪ̯n', 'mit': 'ˈmɪt', 'vor': 'ˈfoːɐ̯', 'weg': 'ˈvɛk',
  'her': 'ˈheːɐ̯', 'hin': 'ˈhɪn', 'bei': 'ˈbaɪ̯', 'los': 'ˈloːs', 'ab': 'ˈap', 'an': 'ˈan', 'um': 'ˈʊm',
  'un': 'ˈʊn', 'ur': 'ˈuːɐ̯', 'zu': 'ˈtsuː',
};
const PREFIX_ORDER_STRESSED = Object.keys(STRESSED_PREFIXES).sort((a, b) => b.length - a.length);
const PREFIX_ORDER_UNSTRESSED = ['ver', 'zer', 'ent', 'emp', 'be', 'ge', 'er'];
// consonant letter clusters that can start a German syllable – used to reject bogus prefix splits
const VALID_ONSET_RE = /^(?:sch|sp|st|tsch|ch|ph|th|qu|pf|[bcdfghjklmnpqrstvwxzß])(?:[lrh]?)/;
function startsValidOnset(s) {
  if (!s) return false;
  if (isVowel(s[0])) return true;
  const m = VALID_ONSET_RE.exec(s);
  if (!m) return false;
  // reject clusters like "nt", "rb", "ns" that a syllable cannot start with
  const two = s.slice(0, 2);
  if (/^(sch|sp|st|ch|ph|th|qu|pf)/.test(s)) return true;
  if (isVowel(s[1]) || !s[1]) return true;
  return /^(bl|br|dr|fl|fr|gl|gr|kl|kn|kr|pl|pr|sl|tr|vl|vr|wr|schl|schm|schn|schr|schw)/.test(two) || /^(bl|br|dr|fl|fr|gl|gr|kl|kn|kr|pl|pr|tr)/.test(two);
}
// suffixes that carry the word stress: [regex, offset of the stressed vowel inside the match]
const STRESSED_SUFFIXES = [
  [/ieren(de[nmrs]?|d)?$/, 0], [/iert(e[nmrs]?)?$/, 0], [/ier(e[nmrs]?|s?t)?$/, 0],
  [/[st]ion(en)?$/, 2], [/ität(en)?$/, 1], [/tät(en)?$/, 1], [/ismus$/, 0], [/ist(en|in|innen)?$/, 0],
  [/enz(en)?$/, 0], [/anz(en)?$/, 0], [/ent(en|in)?$/, 0], [/ant(en|in)?$/, 0], [/eur(e|in)?$/, 0],
  [/age(n)?$/, 0], [/ade(n)?$/, 0], [/ei(en)?$/, 0], [/ie$/, 0], [/ös$/, 0], [/iv(e[nmrs]?)?$/, 0],
  [/ell(e[nmrs]?)?$/, 0], [/abel$/, 0], [/ibel$/, 0], [/esse$/, 0], [/ett(e[nmrs]?)?$/, 0],
];

function splitPrefixes(word) {
  const prefixes = [];
  let rest = word;
  for (let guard = 0; guard < 3; guard++) {
    let hit = null;
    for (const p of PREFIX_ORDER_STRESSED) {
      const stem = rest.slice(p.length);
      // a separable prefix needs a stem with its own vowel, a pronounceable onset and no vowel start
      if (rest.startsWith(p) && stem.length >= 4 && /[aeiouäöüy]/.test(stem) && !isVowel(stem[0]) && startsValidOnset(stem)) { hit = { p, stressed: true }; break; }
    }
    if (!hit) {
      for (const p of PREFIX_ORDER_UNSTRESSED) {
        const stem = rest.slice(p.length);
        // ≥4 letters left, real onset, no geminate right after the prefix ("besser", "Bett" are no prefixes).
        // be-/ge- also take vowel-initial stems ("geöffnet" → ɡəˈʔœfnət).
        const vowelStem = isVowel(stem[0]); // "geöffnet", "verändern", "erinnern" keep a glottal stop
        if (rest.startsWith(p) && stem.length >= 4 && (isCons(stem[0]) || vowelStem) && startsValidOnset(stem)
          && !/^(.)\1/.test(stem) && /[aeiouäöüy]/.test(stem)) { hit = { p, stressed: false }; break; }
      }
    }
    if (!hit) break;
    prefixes.push(hit);
    rest = rest.slice(hit.p.length);
  }
  return { prefixes, stem: rest };
}

// --- 4. letter-to-sound -----------------------------------------------------------------------------
// A "segment" is one grapheme cluster with its phonemes; vowel segments carry the syllable nuclei.
function transcribeWord(word, opts = {}) {
  const w = word;
  const segs = [];
  const push = (g, ph, vowel = false, extra = null) => segs.push({ g, ph: Array.isArray(ph) ? ph : [ph], vowel, ...(extra || {}) });
  const at = (i) => w[i] || '';
  const nextVowelIsNear = (i) => { // number of consonant letters between i and the next vowel
    let n = 0, j = i;
    while (j < w.length && !isVowel(w[j])) { if (w[j] === 'h' && n === 0) { j++; continue; } n++; j++; }
    return { consonants: n, hasVowel: j < w.length };
  };

  let i = 0;
  const wordStart = opts.wordStart !== false;
  while (i < w.length) {
    const c = w[i], c2 = w.slice(i, i + 2), c3 = w.slice(i, i + 3), c4 = w.slice(i, i + 4);

    // ---- vowels & diphthongs ----
    if (isVowel(c)) {
      let nucleus = c, len = 1, ph = null;
      if (c2 === 'ei' || c2 === 'ai' || c2 === 'ey' || c2 === 'ay') { ph = ['a', 'ɪ', '̯']; len = 2; nucleus = c2; }
      else if (c2 === 'au') { ph = ['a', 'ʊ', '̯']; len = 2; nucleus = c2; }
      else if (c2 === 'eu' || c2 === 'äu') { ph = ['ɔ', 'ʏ', '̯']; len = 2; nucleus = c2; }
      else if (c2 === 'ie') {
        // "ie" is /iː/ unless it is a hiatus ("Familie", "Aktien") – then /i/ + following vowel
        len = 2; nucleus = 'ie'; ph = ['iː'];
        if (/^ie[nrs]?$/.test(w.slice(i)) && i > 0 && 'lnrt'.includes(at(i - 1)) && w.length > 5) ph = ['i', 'ə'];
      } else if (c2 === 'aa' || c2 === 'ee' || c2 === 'oo') { ph = [LONG[c]]; len = 2; nucleus = c2; }
      let open = false; // "open" = long only because a single consonant follows; may reduce when unstressed
      if (!ph) {
        // length by the following consonant cluster
        const after = i + len;
        const h = at(after) === 'h';
        const { consonants, hasVowel } = nextVowelIsNear(after);
        let long;
        if (/^ig$/.test(w.slice(i))) long = false;                              // "-ig" → [ɪç]
        else if (h) long = true;
        else if (!hasVowel && consonants === 0) { long = true; open = true; }   // open final syllable: "da", "Auto"
        else if (/^(ck|tz|ss|ll|mm|nn|tt|pp|ff|rr|bb|dd|gg|kk)/.test(w.slice(after))) long = false;
        else if (w.slice(after, after + 1) === 'ß') long = true;
        else { long = consonants <= 1; open = long && hasVowel; }
        ph = [long ? LONG[c] : SHORT[c]];
      }
      push(nucleus, ph, true, { open, base: nucleus.length === 1 ? nucleus : null });
      i += len;
      if (at(i) === 'h' && (i + 1 >= w.length || isCons(at(i + 1)) || at(i + 1) === 'e')) {
        // silent lengthening h ("gehen" → geː-ən, "Uhr", "ihn"); an 'h' before a full vowel stays audible
        if (!(at(i + 1) === 'e' && isVowel(at(i + 2)))) { push('h', [], false); i++; }
      }
      continue;
    }

    // ---- consonant clusters (longest match first) ----
    if (c4 === 'tsch') { push(c4, ['t', 'ʃ']); i += 4; continue; }
    if (c4 === 'dsch' && i === 0) { push(c4, ['d', 'ʒ']); i += 4; continue; } // "Dschungel" – not "Freund|schaft"
    if (c3 === 'sch') {
      // "-chen"/"-lich" style s|ch boundaries are rare enough to ignore
      push(c3, ['ʃ']); i += 3; continue;
    }
    if (c3 === 'chs' && !/chst/.test(w.slice(i))) { push(c3, ['k', 's']); i += 3; continue; }
    if (c2 === 'ch') {
      let ph;
      if (i === 0 && wordStart) ph = /^[eiäöüy]/.test(at(2)) ? ['ç'] : ['k'];
      else {
        const prev = segs.length ? segs[segs.length - 1] : null;
        const prevG = prev ? prev.g : '';
        ph = /^(a|o|u|au)$/.test(prevG) ? ['x'] : ['ç'];
      }
      push(c2, ph); i += 2; continue;
    }
    if (c2 === 'ck') { push(c2, ['k']); i += 2; continue; }
    if (c2 === 'ph') { push(c2, ['f']); i += 2; continue; }
    if (c2 === 'th') { push(c2, ['t']); i += 2; continue; }
    if (c2 === 'rh') { push(c2, ['ʁ']); i += 2; continue; }
    if (c2 === 'qu') { push(c2, ['k', 'v']); i += 2; continue; }
    if (c2 === 'pf') { push(c2, ['p', 'f']); i += 2; continue; }
    if (c2 === 'tz') { push(c2, ['t', 's']); i += 2; continue; }
    if (c2 === 'ng' && !(opts.splitNG && opts.splitNG === i)) { push(c2, ['ŋ']); i += 2; continue; }
    if (c2 === 'nk') { push(c2, ['ŋ', 'k']); i += 2; continue; }
    if (c2 === 'ss') { push(c2, ['s']); i += 2; continue; }
    if (/^(ll|mm|nn|tt|pp|ff|rr|bb|dd|gg)$/.test(c2)) { push(c2, [c === 'g' ? 'ɡ' : c === 'r' ? 'ʁ' : c === 'v' ? 'f' : c]); i += 2; continue; }
    if (c3 === 'tio' || c4 === 'tial' || c4 === 'tiel') { push('ti', ['t', 's', 'i', '̯']); i += 2; continue; }

    // word-initial (or prefix-initial) sp-/st-
    if ((c2 === 'sp' || c2 === 'st') && i === 0 && wordStart) { push(c[0], ['ʃ']); i += 1; continue; }

    switch (c) {
      case 's': {
        const nx = at(i + 1);
        const prevG = segs.length ? segs[segs.length - 1].g : '';
        const voiced = isVowel(nx) && (i === 0 || isVowel(prevG[prevG.length - 1]) || /^(l|m|n|r)$/.test(prevG));
        push('s', [voiced ? 'z' : 's']); i++; continue;
      }
      case 'ß': push('ß', ['s']); i++; continue;
      case 'z': push('z', ['t', 's']); i++; continue;
      case 'x': push('x', ['k', 's']); i++; continue;
      case 'w': push('w', ['v']); i++; continue;
      case 'v': push('v', [opts.foreignV ? 'v' : (i === 0 && wordStart ? 'f' : isVowel(at(i + 1)) && isVowel(at(i - 1)) ? 'v' : 'f')]); i++; continue;
      case 'j': push('j', ['j']); i++; continue;
      case 'g': {
        // word-final "-ig" (also "-igkeit", "-iglich") is [ɪç]; "-ige", "-igt" keep [ɡ]
        if (i === w.length - 1 && at(i - 1) === 'i') { push('g', ['ç']); i++; continue; }
        if (at(i - 1) === 'i' && /^g(keit|lich)/.test(w.slice(i))) { push('g', ['ç']); i++; continue; }
        push('g', ['ɡ']); i++; continue;
      }
      case 'r': {
        const nx = at(i + 1);
        if (isVowel(nx)) { push('r', ['ʁ']); i++; continue; }
        let prev = null;                                // last vowel segment (skip the silent h)
        for (let k = segs.length - 1; k >= 0; k--) { if (segs[k].vowel) { prev = segs[k]; break; } if (segs[k].ph.length) break; }
        const prevLong = prev && /ː/.test(prev.ph.join(''));
        const rest = w.slice(i + 1);
        const earlierVowel = segs.filter((s) => s.vowel).length > 1;
        // unstressed "-er" (ending or before a compound boundary: "Wörterbuch") → [ɐ]
        const newMorpheme = isCons(rest[0]) && /[aeiouäöüy]/.test(rest) && startsValidOnset(rest);
        if (prev && prev.g === 'e' && earlierVowel && (rest === '' || /^(n|s|t|st|ns|m|nd)$/.test(rest) || newMorpheme)) {
          prev.ph = ['ɐ']; prev.open = false; prev.g = 'e'; push('r', []); i++; continue;
        }
        if (prev && prevLong) { push('r', ['ɐ', '̯']); i++; continue; }
        push('r', ['ʁ']); i++; continue;
      }
      case 'h': push('h', [isVowel(at(i + 1)) ? 'h' : '']); i++; continue;
      case 'c': push('c', [/^[eiäöüy]/.test(at(i + 1)) ? 'ts' : 'k']); i++; continue;
      case 'y': push('y', ['j']); i++; continue;
      case 'b': case 'd': case 'f': case 'k': case 'l': case 'm': case 'n': case 'p': case 't':
        push(c, [c]); i++; continue;
      default:
        i++; continue; // unknown letter: skip
    }
  }

  // final devoicing (Auslautverhärtung)
  const DEVOICE = { b: 'p', d: 't', 'ɡ': 'k', v: 'f', z: 's', 'ʒ': 'ʃ' };
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k];
    if (s.vowel || !s.ph.length) continue;
    const last = s.ph[s.ph.length - 1];
    if (!DEVOICE[last]) continue;
    let nextPh = null;
    for (let m = k + 1; m < segs.length; m++) { if (segs[m].ph.length) { nextPh = segs[m]; break; } }
    const atEnd = !nextPh;
    const beforeObstruent = nextPh && !nextPh.vowel && /^[ptkfsʃçxtsh]/.test(nextPh.ph[0]);
    if (atEnd || beforeObstruent) s.ph[s.ph.length - 1] = DEVOICE[last];
  }
  // "-ig" → [ɪç] only word finally; "-igt/-igs" keeps [ɪk]
  return segs;
}

function chooseStress(stem) {
  for (const [re, offset] of STRESSED_SUFFIXES) {
    const m = re.exec(stem);
    if (!m || m.index === 0) continue;
    // the offset points at the stressed vowel inside the match; snap to the next vowel letter
    let p = m.index + offset;
    while (p < stem.length && !isVowel(stem[p])) p++;
    if (p < stem.length) return p;
  }
  const first = /[aeiouäöüy]/.exec(stem);
  return first ? first.index : -1;
}

/** Word (already lower-cased, letters only) → phoneme string. */
export function germanWord(word) {
  const w = String(word || '').toLowerCase();
  if (!w) return '';
  if (DE_LEXICON[w]) return DE_LEXICON[w];
  // inflected form of a lexicon entry ("natürlichen" = natürlich + en)
  for (const [end, ph] of [['en', 'ən'], ['em', 'əm'], ['es', 'əs'], ['er', 'ɐ'], ['e', 'ə'], ['s', 's'], ['n', 'n']]) {
    if (!w.endsWith(end) || w.length - end.length < 4) continue;
    const base = DE_LEXICON[w.slice(0, -end.length)];
    if (base && !base.endsWith('ɐ̯') && !base.endsWith('ə')) return base + ph;
  }

  const { prefixes, stem } = splitPrefixes(w);
  const stressInStem = chooseStress(stem);
  const stressedPrefix = prefixes.findIndex((p) => p.stressed);

  const parts = [];
  let out = [];
  const emit = (segs, stressCharIndex) => {
    // find the vowel segment that owns stressCharIndex
    let charPos = 0, stressSeg = -1;
    for (let k = 0; k < segs.length; k++) {
      // the stressed letter may sit inside a consonant cluster ("na-ti-on"): take the vowel that owns it
      // or the next vowel segment after it
      if (segs[k].vowel && stressCharIndex < charPos + segs[k].g.length) { stressSeg = k; break; }
      charPos += segs[k].g.length;
    }
    if (stressSeg < 0) stressSeg = segs.findIndex((s) => s.vowel);
    for (let k = 0; k < segs.length; k++) {
      const s = segs[k];
      if (!s.vowel || k === stressSeg) continue;
      const restChars = segs.slice(k + 1).map((x) => x.g).join('');
      if (s.g === 'e' && s.ph[0] !== 'ɐ') {
        const noVowelAfter = !/[aeiouäöüy]/.test(restChars);
        const weakEnding = /^[lnmr](?![aeiouäöüy])/.test(restChars);
        // "-ere", "-estes", "-enen": an unstressed 'e' in front of the final unstressed 'e' reduces too
        const beforeFinalE = /^[^aeiouäöüy]{1,2}e[^aeiouäöüy]{0,2}$/.test(restChars);
        if (noVowelAfter || weakEnding || beforeFinalE) { s.ph = ['ə']; continue; }
      }
      // unstressed open syllable: tense but short ("Melodie" → meloˈdiː, "Auto" → ˈaʊ̯to)
      if (s.open && s.base && TENSE[s.base]) s.ph = [TENSE[s.base]];
    }
    // syllable onset for the stress mark: consonants directly before the stressed nucleus
    let onset = stressSeg;
    while (onset > 0 && !segs[onset - 1].vowel) onset--;
    if (onset > 0 && stressSeg - onset > 1) onset = stressSeg - (isValidOnset(segs.slice(stressSeg - 2, stressSeg)) ? 2 : 1);
    const flat = [];
    segs.forEach((s, k) => {
      if (k === onset && stressSeg >= 0) flat.push('ˈ');
      if (k === 0 && s.vowel) flat.push('ʔ');   // glottal stop before a word/morpheme-initial vowel
      for (const p of s.ph) if (p) flat.push(p);
    });
    return flat;
  };

  prefixes.forEach((p, idx) => {
    const table = p.stressed ? STRESSED_PREFIXES[p.p] : UNSTRESSED_PREFIXES[p.p];
    let ph = Array.from(table || '');
    if (p.stressed && idx !== stressedPrefix) ph = ph.filter((x) => x !== 'ˈ');
    if (isVowel(p.p[0])) { const si = ph.indexOf('ˈ'); ph.splice(si >= 0 ? si + 1 : 0, 0, 'ʔ'); }
    // a stressed prefix table already carries its own 'ˈ'
    parts.push(ph);
  });

  const stemSegs = transcribeWord(stem, { wordStart: true });
  parts.push(emit(stemSegs, stressedPrefix >= 0 ? -1 : stressInStem));
  out = parts.flat();
  // exactly one primary stress
  let seen = false;
  out = out.filter((p) => { if (p !== 'ˈ') return true; if (seen) return false; seen = true; return true; });
  if (!seen) {
    const firstVowelIdx = out.findIndex((p) => /^[aeiouɛɔʊɪʏœøəɐy]/.test(p));
    if (firstVowelIdx > 0 && out.length > 2) out.splice(Math.max(0, firstVowelIdx - 1), 0, 'ˈ');
  }
  return out.join('');
}

function isValidOnset(segs) {
  if (segs.length !== 2) return false;
  const s = segs.map((x) => x.ph.join('')).join('');
  return /^(ʃt|ʃp|ʃl|ʃm|ʃn|ʃʁ|ʃv|pl|bl|kl|ɡl|fl|pʁ|bʁ|tʁ|dʁ|kʁ|ɡʁ|fʁ|ʃ|kv|ts|pf|tʃ)$/.test(s);
}

// --- 5. text → phoneme string ------------------------------------------------------------------------
const KEEP_PUNCT = new Set([',', '.', '!', '?', ';', ':', '-', '(', ')', "'", '"']);

let phonemizerImpl = null;
/** Replace the built-in rules with a real phonemiser (e.g. an espeak-ng wasm) – see docs/TTS.md. */
export function setPhonemizer(fn) { phonemizerImpl = typeof fn === 'function' ? fn : null; }
export function hasCustomPhonemizer() { return !!phonemizerImpl; }

/**
 * German text → eSpeak-style IPA phoneme string for a Piper model.
 * Punctuation is preserved (Piper's phoneme_id_map contains it and the prosody depends on it).
 */
export function germanPhonemes(text) {
  if (phonemizerImpl) return phonemizerImpl(text);
  const norm = normalizeGermanText(text);
  const out = [];
  const tokens = norm.match(/[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*|[.,!?;:()"'-]|\s+/gu) || [];
  const pushSpace = () => { if (out.length && out[out.length - 1] !== ' ') out.push(' '); };
  for (const tk of tokens) {
    if (/^\s+$/.test(tk)) { pushSpace(); continue; }
    if (tk.length === 1 && KEEP_PUNCT.has(tk)) { out.push(tk); continue; }
    const cleaned = tk.replace(/[’']/g, '').toLowerCase();
    // hyphenated compounds are transcribed part by part
    const pieces = cleaned.split('-').filter(Boolean);
    const ph = pieces.map((p) => germanWord(p)).filter(Boolean).join('');
    if (ph) out.push(ph);
  }
  return out.join('').replace(/\s+/g, ' ').trim();
}

/**
 * The rules above write textbook IPA (ʁ, ʔ, aː, ɐ̯ …), but the voices were trained on espeak-ng's German, which has
 * none of those symbols: the model ids for ʁ or ʔ were never trained and come out as noise. Only used when espeak-ng
 * cannot be loaded, this maps the rule output onto espeak-ng's conventions: r for ʁ, no glottal stop, ɑː for long a,
 * ɾ for the vocalised r after a long vowel, ɜ for unstressed -er, the stress mark in front of the vowel, ç
 * decomposed like Piper does it (c + U+0327).
 */
export function germanPhonemesEspeakStyle(text) {
  let s = germanPhonemes(text)
    .replace(/ʔ/g, '').replace(/ʁ/g, 'r').replace(/aː/g, 'ɑː')
    .replace(/aɪ̯/g, 'aɪ').replace(/aʊ̯/g, 'aʊ').replace(/ɔʏ̯/g, 'ɔø')
    .replace(/(ː)ɐ̯/g, '$1ɾ').replace(/ɐ̯/g, 'ɾ').replace(/ɐ/g, 'ɜ').replace(/ʏ/g, 'y').replace(/i̯/g, 'j')
    .replace(/̯/g, '');
  // espeak-ng puts the stress mark directly before the vowel ("tˈɑːk", not "ˈtɑːk")
  s = s.replace(/([ˈˌ])([^aeiouyøœɛɪɔʊəɜɑɐ\s ˈˌ.,!?;:]+)/g, '$2$1');
  return s.normalize('NFD');
}

// --- 6. phonemes → model ids -------------------------------------------------------------------------
/**
 * Piper's id encoding: BOS, PAD, then every phoneme followed by PAD, then EOS.
 * Unknown symbols are dropped (they cannot be represented by the model).
 * @param {string} phonemes
 * @param {Record<string, number[]>} idMap  the model's phoneme_id_map
 * @returns {{ ids: number[], dropped: string[] }}
 */
export function phonemesToIds(phonemes, idMap) {
  const id = (s) => { const v = idMap[s]; return Array.isArray(v) ? v[0] : typeof v === 'number' ? v : undefined; };
  const BOS = id('^') ?? 1, EOS = id('$') ?? 2, PAD = id('_') ?? 0;
  const ids = [BOS, PAD];
  const dropped = [];
  for (const ch of Array.from(String(phonemes || ''))) {
    const v = id(ch);
    if (v === undefined) { if (ch.trim()) dropped.push(ch); continue; }
    ids.push(v, PAD);
  }
  ids.push(EOS);
  return { ids, dropped };
}

/**
 * Builds the ONNX feeds of a Piper VITS graph in a runtime-independent shape so that they can be unit
 * tested without onnxruntime. The worker turns each entry into an ort.Tensor(type, data, dims).
 *   input         int64  [1, T]   phoneme ids
 *   input_lengths int64  [1]      T
 *   scales        float32 [3]     [noise_scale, length_scale, noise_w]   – length_scale = base / speed
 *   sid           int64  [1]      speaker id, multi-speaker models only
 * @param {number[]} ids
 * @param {object} config   the parsed <voice>.onnx.json
 * @param {number} speed    0.5 … 2 (higher = faster; Piper's length_scale works the other way round)
 * @param {{ speakerId?: number, multiSpeaker?: boolean }} [opts]
 */
export function buildPiperInputs(ids, config = {}, speed = 1, opts = {}) {
  const inf = config.inference || {};
  const noise = typeof inf.noise_scale === 'number' ? inf.noise_scale : 0.667;
  const noiseW = typeof inf.noise_w === 'number' ? inf.noise_w : 0.8;
  const baseLen = typeof inf.length_scale === 'number' ? inf.length_scale : 1;
  const sp = Math.min(2, Math.max(0.5, Number(speed) || 1));
  const big = (arr) => { const b = new BigInt64Array(arr.length); for (let i = 0; i < arr.length; i++) b[i] = BigInt(arr[i]); return b; };
  const feeds = {
    input: { type: 'int64', data: big(ids), dims: [1, ids.length] },
    input_lengths: { type: 'int64', data: big([ids.length]), dims: [1] },
    scales: { type: 'float32', data: Float32Array.from([noise, baseLen / sp, noiseW]), dims: [3] },
  };
  const multi = opts.multiSpeaker ?? (Number(config.num_speakers || 1) > 1);
  if (multi) {
    let sid = Number(opts.speakerId ?? config.speaker_id ?? 0);
    if (!Number.isFinite(sid) || sid < 0) sid = 0;
    const max = Number(config.num_speakers || 1) - 1;
    feeds.sid = { type: 'int64', data: big([Math.min(sid, Math.max(0, max))]), dims: [1] };
  }
  return feeds;
}

/** Resolves a named speaker ("neutral", "amused" …) of a multi-speaker model to its numeric id. */
export function speakerId(config, name) {
  const map = config?.speaker_id_map;
  if (!map) return 0;
  if (name != null && Object.prototype.hasOwnProperty.call(map, name)) return Number(map[name]) || 0;
  if (Object.prototype.hasOwnProperty.call(map, 'neutral')) return Number(map.neutral) || 0;
  const first = Object.values(map)[0];
  return Number(first) || 0;
}

// --- 7. Kokoro (StyleTTS2) German – "Martin" ----------------------------------------------------------
// The second German engine is a Kokoro-82M graph (Godelaune/Kokoro-82M-ONNX-German-Martin, Apache-2.0,
// fine-tuned from kikiri-tts/kikiri-german-martin). It is the SAME architecture the English voice already
// uses, so it runs on the same onnxruntime-web – but it expects a completely different token alphabet than
// Piper: not a per-model `phoneme_id_map` but Kokoro's fixed 178-symbol table.
//
// How the reference stack tokenises (verified against the sources, see docs/TTS.md):
//   kikiri trained with misaki 0.9.4 + espeak-ng 1.50 → `misaki.espeak.EspeakG2P`, which phonemises with
//   `tie='^'` and then folds the tied diphthongs/affricates into Kokoro's single-character symbols
//   (a^ɪ→I, a^ʊ→W, ɔ^ɪ→Y, t^s→ʦ, t^ʃ→ʧ, d^ʒ→ʤ …). Kokoro's KModel and kokoro-onnx then BOTH map the
//   remaining characters through the vocabulary and silently DROP everything that is not in it.
// We reproduce that exactly, starting from the eSpeak-style IPA that `germanPhonemes()` already produces.
//
// Consequence worth knowing: German /ʏ/ (short "ü") and the non-syllabic mark U+032F are not in Kokoro's
// vocabulary, so the reference pipeline drops them – the model was trained on text where they were already
// missing ("fünf" → "fnf"), and feeding a substitute would take it out of its training distribution.
// `KOKORO_DE_SUBSTITUTIONS` is the one place to change that if it ever turns out to sound better.

/** Kokoro's phoneme → token id table (hexgrad/Kokoro-82M config.json; identical in kokoro-js and kokoro-onnx). */
export const KOKORO_VOCAB = Object.freeze({
  ';': 1, ':': 2, ',': 3, '.': 4, '!': 5, '?': 6, '—': 9, '…': 10, '"': 11, '(': 12, ')': 13, '“': 14,
  '”': 15, ' ': 16, '̃': 17, 'ʣ': 18, 'ʥ': 19, 'ʦ': 20, 'ʨ': 21, 'ᵝ': 22, 'ꭧ': 23, 'A': 24,
  'I': 25, 'O': 31, 'Q': 33, 'S': 35, 'T': 36, 'W': 39, 'Y': 41, 'ᵊ': 42, 'a': 43, 'b': 44, 'c': 45,
  'd': 46, 'e': 47, 'f': 48, 'h': 50, 'i': 51, 'j': 52, 'k': 53, 'l': 54, 'm': 55, 'n': 56, 'o': 57,
  'p': 58, 'q': 59, 'r': 60, 's': 61, 't': 62, 'u': 63, 'v': 64, 'w': 65, 'x': 66, 'y': 67, 'z': 68,
  'ɑ': 69, 'ɐ': 70, 'ɒ': 71, 'æ': 72, 'β': 75, 'ɔ': 76, 'ɕ': 77, 'ç': 78, 'ɖ': 80, 'ð': 81, 'ʤ': 82,
  'ə': 83, 'ɚ': 85, 'ɛ': 86, 'ɜ': 87, 'ɟ': 90, 'ɡ': 92, 'ɥ': 99, 'ɨ': 101, 'ɪ': 102, 'ʝ': 103,
  'ɯ': 110, 'ɰ': 111, 'ŋ': 112, 'ɳ': 113, 'ɲ': 114, 'ɴ': 115, 'ø': 116, 'ɸ': 118, 'θ': 119, 'œ': 120,
  'ɹ': 123, 'ɾ': 125, 'ɻ': 126, 'ʁ': 128, 'ɽ': 129, 'ʂ': 130, 'ʃ': 131, 'ʈ': 132, 'ʧ': 133, 'ʊ': 135,
  'ʋ': 136, 'ʌ': 138, 'ɣ': 139, 'ɤ': 140, 'χ': 142, 'ʎ': 143, 'ʒ': 147, 'ʔ': 148, 'ˈ': 156, 'ˌ': 157,
  'ː': 158, 'ʰ': 162, 'ʲ': 164, '↓': 169, '→': 171, '↗': 172, '↘': 173, 'ᵻ': 177,
});

export const KOKORO_MAX_PHONEMES = 510;   // kokoro-onnx MAX_PHONEME_LENGTH; the style pack has 510 rows
export const KOKORO_SAMPLE_RATE = 24000;
export const KOKORO_STYLE_DIM = 256;

const NB = '\u032F';       // combining inverted breve below – the non-syllabic mark of German diphthongs
const TILDE = '\u0303';    // combining tilde – the nasal mark Kokoro's vocabulary does have
/**
 * Longest-match rewrites from the eSpeak-style IPA of `germanPhonemes()` to Kokoro symbols.
 * The first block is misaki's `EspeakG2P.e2m`, the rest normalises what this app's G2P writes but eSpeak
 * spells differently (the non-syllabic mark, precomposed nasal vowels, symbols outside the vocabulary).
 */
export const KOKORO_DE_SUBSTITUTIONS = Object.freeze({
  // diphthongs → misaki's single-character symbols (eSpeak de: aɪ, aʊ, ɔɪ; this G2P adds U+032F)
  ['aɪ' + NB]: 'I', 'aɪ': 'I',
  ['aʊ' + NB]: 'W', 'aʊ': 'W',
  ['ɔʏ' + NB]: 'Y', 'ɔʏ': 'Y', ['ɔɪ' + NB]: 'Y', 'ɔɪ': 'Y',
  ['eɪ' + NB]: 'A', 'eɪ': 'A', ['oʊ' + NB]: 'O', 'oʊ': 'O',
  // affricates
  'ts': 'ʦ', 'tʃ': 'ʧ', 'dʒ': 'ʤ', 'dz': 'ʣ',
  // precomposed nasal vowels → base + combining tilde (U+0303 is in the vocabulary, the precomposed
  // letter is not). Key and value look identical in an editor: the key is one code point, the value two.
  '\u00E3': 'a' + TILDE, '\u00F5': 'o' + TILDE, '\u1EBD': 'e' + TILDE,
  '\u0129': 'i' + TILDE, '\u0169': 'u' + TILDE,
  // leftovers: the vocalised r and the hiatus i keep their base vowel, the diacritic goes
  ['ɐ' + NB]: 'ɐ', ['i' + NB]: 'i', ['u' + NB]: 'u', ['y' + NB]: 'y', [NB]: '',
  // not in Kokoro's vocabulary – dropped exactly like misaki/kokoro-onnx do
  '\u028F': '', '-': '', '\u2010': '', "'": '', '\u2019': '', '\u00B4': '', '`': '',
});
const KOKORO_SUB_KEYS = Object.keys(KOKORO_DE_SUBSTITUTIONS).sort((a, b) => b.length - a.length);

/**
 * eSpeak-style German IPA (the output of `germanPhonemes()`) → Kokoro phoneme string.
 * Everything the vocabulary does not know is dropped, which is what the reference implementations do.
 * @param {string} ipa
 * @returns {{ phonemes: string, dropped: string[] }}
 */
export function ipaToKokoro(ipa) {
  let s = String(ipa || '');
  for (const from of KOKORO_SUB_KEYS) {
    if (!from || !s.includes(from)) continue;
    s = s.split(from).join(KOKORO_DE_SUBSTITUTIONS[from]);
  }
  const out = [];
  const dropped = [];
  for (const ch of Array.from(s)) {
    if (Object.prototype.hasOwnProperty.call(KOKORO_VOCAB, ch)) out.push(ch);
    else if (ch.trim()) dropped.push(ch);
  }
  // collapse the runs of spaces the drops may leave behind
  return { phonemes: out.join('').replace(/ {2,}/g, ' ').trim(), dropped };
}

/** German text → Kokoro phoneme string with the built-in rules (the fallback when espeak-ng cannot be loaded). */
export function germanKokoroPhonemes(text) {
  return ipaToKokoro(germanPhonemes(text)).phonemes;
}

// misaki's EspeakG2P asks espeak-ng for tied phonemes (tie '^') and folds the tied pairs into single symbols. The
// Piper build of espeak-ng has no tie output, so ts and tʃ are decided by the spelling: z and tz are the affricate ʦ,
// c before a front vowel and -tion may be; the letters t+s ("nichts", "Geburtstag") stay two phonemes when espeak-ng
// makes a ts of them at all; "tsch" is ʧ only at the start of a word ("Tschüss" – "Deutsch" is t+ʃ). On 1 423 test
// sentences 95 % come out identical to misaki 0.9.4 + espeak-ng 1.52 word for word, the rest differ by one affricate
// or one secondary stress.
const KOKORO_DIPHTHONGS = [['aɪ', 'I'], ['aʊ', 'W'], ['ɔɪ', 'Y'], ['eɪ', 'A'], ['oʊ', 'O'], ['əʊ', 'Q'], ['dʒ', 'ʤ']];
const TIE_SOURCES = /(tsch)|(dsch)|(tz|zz|z)|(c(?=[eiyäöü]))|(ti(?=[aeouö]))|([td]t?s(?!ch))/g;
function affricatesFromSpelling(text) {
  const seq = [];
  const words = String(text || '').toLowerCase().replace(/(\p{L})['’](\p{L})/gu, '$1$2').match(/\p{L}+/gu) || [];
  for (const word of words) {
    TIE_SOURCES.lastIndex = 0;
    let m;
    while ((m = TIE_SOURCES.exec(word))) {
      if (m[1]) seq.push({ type: 'tʃ', tied: m.index === 0 });
      else if (m[2]) continue;                                            // dsch → dʒ, always one phoneme
      else if (m[3]) seq.push({ type: 'ts', tied: true });
      else if (m[4] || m[5]) { if (m[4] || m.index > 0) seq.push({ type: 'ts', tied: true, optional: true }); }
      else seq.push({ type: 'ts', tied: false, optional: true });          // t+s letters, often t+z in espeak-ng
    }
  }
  return seq;
}
/** Aligns the t+s / t+ʃ occurrences of the phonemes with the spelling (dynamic programming, order kept). */
function alignAffricates(occ, want) {
  const n = occ.length, m = want.length;
  const skipWant = (w) => (w.optional ? 0.1 : 1);
  const cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let j = 1; j <= m; j++) cost[0][j] = cost[0][j - 1] + skipWant(want[j - 1]);
  for (let i = 1; i <= n; i++) {
    cost[i][0] = cost[i - 1][0] + 1;
    for (let j = 1; j <= m; j++) {
      const match = occ[i - 1].type === want[j - 1].type ? cost[i - 1][j - 1] : Infinity;
      cost[i][j] = Math.min(match, cost[i - 1][j] + 1, cost[i][j - 1] + skipWant(want[j - 1]));
    }
  }
  // walk back: tied flag per occurrence, null where the spelling had nothing for it
  const flags = new Array(n).fill(null);
  for (let i = n, j = m; i > 0;) {
    if (j > 0 && occ[i - 1].type === want[j - 1].type && cost[i][j] === cost[i - 1][j - 1]) { flags[i - 1] = want[j - 1].tied; i--; j--; }
    else if (j > 0 && cost[i][j] === cost[i][j - 1] + skipWant(want[j - 1])) j--;
    else i--;
  }
  return flags;
}

/**
 * espeak-ng phonemes of the Piper build (one string per sentence, NFD) → Kokoro phoneme string in misaki's
 * conventions: NFC, "??" back to ʊɐ (the Piper build's spelling of that vowel), short ü as ʏ (which Kokoro's
 * vocabulary then drops, exactly as in training), tied pairs folded into Kokoro's single symbols.
 * @param {string|string[]} sentences  espeak-ng output
 * @param {string} text                the (normalised) text it came from – decides ts/ʦ and tʃ/ʧ
 * @returns {{ phonemes: string, dropped: string[] }}
 */
export function espeakToKokoro(sentences, text) {
  const list = (Array.isArray(sentences) ? sentences : [sentences]).map((x) => String(x || '').normalize('NFC').replace(/\?\?/g, 'ʊɐ')).filter(Boolean);
  let s = list.join(' ').replace(/y(?!ː)/g, 'ʏ');
  // the affricates: every t+s / t+ʃ of the phonemes against the spelling; an occurrence the spelling does not
  // explain gets the German majority (ts tied, tʃ not)
  const occ = [...s.matchAll(/t(?=[sʃ])/g)].map((m) => ({ at: m.index, type: s[m.index + 1] === 's' ? 'ts' : 'tʃ' }));
  const flags = alignAffricates(occ, affricatesFromSpelling(text));
  const chars = Array.from(s);   // all symbols here are single UTF-16 units, so string and array indexes agree
  for (let k = occ.length - 1; k >= 0; k--) {
    const tied = flags[k] ?? occ[k].type === 'ts';
    if (tied) chars.splice(occ[k].at, 2, occ[k].type === 'ts' ? 'ʦ' : 'ʧ');
  }
  s = chars.join('');
  for (const [a, b] of KOKORO_DIPHTHONGS) s = s.split(a).join(b);
  s = s.replace(/[-^]/g, '');
  const out = [], dropped = [];
  for (const ch of Array.from(s)) {
    if (Object.prototype.hasOwnProperty.call(KOKORO_VOCAB, ch)) out.push(ch);
    else if (ch.trim()) dropped.push(ch);
  }
  return { phonemes: out.join('').replace(/ {2,}/g, ' ').trim(), dropped };
}

/**
 * Kokoro's id encoding: `[0, …ids, 0]`. Unknown symbols cannot occur any more after `ipaToKokoro()`,
 * but a caller may pass raw phonemes, so they are dropped here as well.
 * @returns {{ ids: number[], tokens: number[] }}  `tokens` = the padded row that goes into the graph
 */
export function kokoroTokens(phonemes) {
  const ids = [];
  for (const ch of Array.from(String(phonemes || ''))) {
    const v = KOKORO_VOCAB[ch];
    if (typeof v === 'number') ids.push(v);
  }
  return { ids, tokens: [0, ...ids, 0] };
}

/**
 * Splits a phoneme string into pieces of at most `max` tokens, preferring sentence punctuation, then
 * clause punctuation, then spaces – the same order kokoro-onnx uses.
 */
export function splitKokoroPhonemes(phonemes, max = KOKORO_MAX_PHONEMES) {
  const all = Array.from(String(phonemes || ''));
  if (all.length <= max) return all.length ? [all.join('')] : [];
  const out = [];
  let start = 0;
  while (start < all.length) {
    if (all.length - start <= max) { out.push(all.slice(start).join('')); break; }
    const window = all.slice(start, start + max);
    let cut = -1;
    for (const test of [(c) => '.!?'.includes(c), (c) => ',;:'.includes(c), (c) => c === ' ']) {
      for (let i = window.length - 1; i > max * 0.3; i--) if (test(window[i])) { cut = i + 1; break; }
      if (cut > 0) break;
    }
    if (cut <= 0) cut = max;
    out.push(window.slice(0, cut).join('').trim());
    start += cut;
  }
  return out.filter(Boolean);
}

/**
 * The style vector for a token count. Kokoro voice packs are [510, 1, 256]; kokoro-onnx (the reference
 * implementation of this very model) takes row `n - 1` for `n` phonemes, clamped to the last row.
 * @param {Float32Array} pack  510 × 256 floats
 * @param {number} tokenCount  number of phoneme ids WITHOUT the two zero pads
 */
export function kokoroStyle(pack, tokenCount) {
  const rows = Math.floor(pack.length / KOKORO_STYLE_DIM) || 1;
  const row = Math.min(Math.max(Number(tokenCount) || 1, 1), rows) - 1;
  return pack.slice(row * KOKORO_STYLE_DIM, (row + 1) * KOKORO_STYLE_DIM);
}

/**
 * Builds the ONNX feeds of the Kokoro graph, runtime-independent so that they can be unit tested.
 * Graph (read out of kokoro-martin.onnx itself, opset 17):
 *   tokens   int64   [1, T]   [0, …phoneme ids, 0]
 *   style    float32 [1, 256] the row of the voice pack that matches the phoneme count
 *   speed    float32 [1]      0.5 … 2, higher = faster
 *   waveform float32 [N]      24 kHz mono   ·   duration int64 [T] (frames per token, unused here)
 */
export function buildKokoroInputs(tokens, style, speed = 1) {
  const sp = Math.min(2, Math.max(0.5, Number(speed) || 1));
  const big = new BigInt64Array(tokens.length);
  for (let i = 0; i < tokens.length; i++) big[i] = BigInt(tokens[i]);
  return {
    tokens: { type: 'int64', data: big, dims: [1, tokens.length] },
    style: { type: 'float32', data: style instanceof Float32Array ? style : Float32Array.from(style), dims: [1, KOKORO_STYLE_DIM] },
    speed: { type: 'float32', data: Float32Array.from([sp]), dims: [1] },
  };
}

// --- 8. .npy / .npz (the voice pack) ------------------------------------------------------------------
const td = () => new TextDecoder('latin1');

/**
 * Parses a single `.npy` buffer. Only the dtypes a Kokoro voice pack can have are supported.
 * @param {ArrayBuffer|Uint8Array} buf
 * @returns {{ dtype: string, shape: number[], data: Float32Array|Float64Array }}
 */
export function parseNpy(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const magic = String.fromCharCode(...u8.slice(1, 6));
  if (u8[0] !== 0x93 || magic !== 'NUMPY') throw new Error('Keine .npy-Datei');
  const major = u8[6];
  const headerLen = major >= 2
    ? new DataView(u8.buffer, u8.byteOffset + 8, 4).getUint32(0, true)
    : new DataView(u8.buffer, u8.byteOffset + 8, 2).getUint16(0, true);
  const dataOff = (major >= 2 ? 12 : 10) + headerLen;
  const header = td().decode(u8.subarray(major >= 2 ? 12 : 10, dataOff));
  const descr = /'descr'\s*:\s*'([^']+)'/.exec(header)?.[1] || '';
  const fortran = /'fortran_order'\s*:\s*True/.test(header);
  const shape = (/'shape'\s*:\s*\(([^)]*)\)/.exec(header)?.[1] || '')
    .split(',').map((x) => x.trim()).filter(Boolean).map(Number);
  if (fortran) throw new Error('.npy in Fortran-Reihenfolge wird nicht unterstützt');
  const body = u8.subarray(dataOff);
  // the payload is not necessarily 4-byte aligned inside the zip, so copy before casting
  const copy = new Uint8Array(body.length);
  copy.set(body);
  let data;
  if (descr === '<f4' || descr === '=f4' || descr === 'f4') data = new Float32Array(copy.buffer, 0, Math.floor(copy.length / 4));
  else if (descr === '<f8' || descr === '=f8' || descr === 'f8') data = Float32Array.from(new Float64Array(copy.buffer, 0, Math.floor(copy.length / 8)));
  else throw new Error('Nicht unterstützter .npy-Datentyp: ' + descr);
  return { dtype: descr, shape, data };
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Diese Umgebung kann keine komprimierten .npz-Dateien lesen');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Parses a `.npz` (a ZIP of `.npy` members) without any dependency – the central directory is read from
 * the end of the file, stored members are sliced, deflated ones go through DecompressionStream.
 * @param {ArrayBuffer|Uint8Array} buf
 * @returns {Promise<Record<string, { dtype: string, shape: number[], data: Float32Array }>>}
 */
export async function parseNpz(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  // End of central directory: signature PK\x05\x06, at most 64 KiB of comment behind it
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (u8[i] === 0x50 && u8[i + 1] === 0x4B && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Keine .npz-Datei (kein ZIP-Verzeichnis gefunden)');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const out = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) throw new Error('Beschädigtes .npz-Verzeichnis');
    const method = dv.getUint16(off + 10, true);
    const compressed = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const local = dv.getUint32(off + 42, true);
    const name = td().decode(u8.subarray(off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extraLen + commentLen;
    // the local header repeats name/extra with its own lengths
    if (dv.getUint32(local, true) !== 0x04034b50) throw new Error('Beschädigter .npz-Eintrag: ' + name);
    const dataAt = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = u8.subarray(dataAt, dataAt + compressed);
    let member;
    if (method === 0) member = raw;
    else if (method === 8) member = await inflateRaw(raw);
    else throw new Error(`Nicht unterstützte ZIP-Kompression (${method}) in ${name}`);
    out[name.replace(/\.npy$/i, '')] = parseNpy(member);
  }
  return out;
}

/**
 * Picks the voice pack out of a parsed `.npz` and flattens it to 510 × 256 floats.
 * @param {Record<string, {shape:number[], data:Float32Array}>} npz
 * @param {string} [name]  the array to use; the only/first one when omitted
 */
export function kokoroVoicePack(npz, name) {
  const keys = Object.keys(npz || {});
  if (!keys.length) throw new Error('Die Stimmdatei enthält keine Daten');
  const key = name && npz[name] ? name : keys[0];
  const arr = npz[key];
  const dim = arr.shape.length ? arr.shape[arr.shape.length - 1] : KOKORO_STYLE_DIM;
  if (dim !== KOKORO_STYLE_DIM) throw new Error(`Unerwartete Form der Stimmdatei: [${arr.shape.join(', ')}]`);
  return { name: key, shape: arr.shape, data: arr.data };
}

export default { germanPhonemes, germanWord, normalizeGermanText, numberToGerman, ordinalToGerman, phonemesToIds, buildPiperInputs, speakerId, setPhonemizer, ipaToKokoro, germanKokoroPhonemes, kokoroTokens, splitKokoroPhonemes, kokoroStyle, buildKokoroInputs, parseNpy, parseNpz, kokoroVoicePack, KOKORO_VOCAB };
