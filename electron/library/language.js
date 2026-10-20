// The language of a book, the pure part. The metadata of PDFs and EPUBs often holds no language at all ('<¦', 'ƒ*ªþ×',
// 'to˚‹j') or one in a form the app does not use ('eng', 'DE-DE', 'en-US', 'Deutsch', 'German', and 'Germa': the
// indexer keeps at most five characters). normalizeLanguage turns every value into a two-letter ISO 639-1 code or null
// (unknown); the book card and the read-aloud rely on that. No Electron, no Node APIs.
'use strict';

/** ISO 639-1 */
const ISO1 = new Set(('aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el '
  + 'en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk '
  + 'kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or '
  + 'os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty '
  + 'ug uk ur uz ve vi vo wa wo xh yi yo za zh zu').split(' '));
/** Withdrawn two-letter codes that still turn up. */
const OLD = { iw: 'he', in: 'id', ji: 'yi', jw: 'jv', mo: 'ro' };
/** ISO 639-2 (bibliographic and terminology codes) of the languages books are likely to be written in. */
const ISO2 = {
  eng: 'en', ger: 'de', deu: 'de', gsw: 'de', fre: 'fr', fra: 'fr', spa: 'es', ita: 'it', por: 'pt', dut: 'nl', nld: 'nl', rus: 'ru',
  pol: 'pl', swe: 'sv', dan: 'da', nor: 'no', nob: 'nb', nno: 'nn', fin: 'fi', cze: 'cs', ces: 'cs', slo: 'sk', slk: 'sk', gre: 'el',
  ell: 'el', tur: 'tr', jpn: 'ja', chi: 'zh', zho: 'zh', kor: 'ko', ara: 'ar', heb: 'he', lat: 'la', hun: 'hu', rum: 'ro', ron: 'ro',
  ukr: 'uk', bul: 'bg', hrv: 'hr', srp: 'sr', slv: 'sl', cat: 'ca', ice: 'is', isl: 'is', est: 'et', lav: 'lv', lit: 'lt', per: 'fa',
  fas: 'fa', hin: 'hi', ind: 'id', vie: 'vi', tha: 'th', gle: 'ga', wel: 'cy', cym: 'cy', baq: 'eu', eus: 'eu', glg: 'gl', afr: 'af',
  epo: 'eo', ltz: 'lb', bos: 'bs', mac: 'mk', mkd: 'mk', alb: 'sq', sqi: 'sq', arm: 'hy', hye: 'hy', geo: 'ka', kat: 'ka', yid: 'yi',
};
/** Names of languages in English, in German and in the language itself (lower case). */
const NAMES = {
  english: 'en', englisch: 'en', german: 'de', deutsch: 'de', french: 'fr', 'französisch': 'fr', 'français': 'fr', francais: 'fr',
  spanish: 'es', spanisch: 'es', 'español': 'es', espanol: 'es', castellano: 'es', italian: 'it', italienisch: 'it', italiano: 'it',
  dutch: 'nl', 'niederländisch': 'nl', nederlands: 'nl', portuguese: 'pt', portugiesisch: 'pt', 'português': 'pt', portugues: 'pt',
  russian: 'ru', russisch: 'ru', 'русский': 'ru', polish: 'pl', polnisch: 'pl', polski: 'pl', swedish: 'sv', schwedisch: 'sv',
  svenska: 'sv', danish: 'da', 'dänisch': 'da', dansk: 'da', norwegian: 'no', norwegisch: 'no', norsk: 'no', finnish: 'fi',
  finnisch: 'fi', suomi: 'fi', czech: 'cs', tschechisch: 'cs', 'čeština': 'cs', greek: 'el', griechisch: 'el', turkish: 'tr',
  'türkisch': 'tr', 'türkçe': 'tr', japanese: 'ja', japanisch: 'ja', chinese: 'zh', chinesisch: 'zh', korean: 'ko', koreanisch: 'ko',
  arabic: 'ar', arabisch: 'ar', hebrew: 'he', 'hebräisch': 'he', latin: 'la', latein: 'la', latina: 'la', hungarian: 'hu',
  ungarisch: 'hu', magyar: 'hu', romanian: 'ro', 'rumänisch': 'ro', ukrainian: 'uk', ukrainisch: 'uk', catalan: 'ca', katalanisch: 'ca',
  'català': 'ca', icelandic: 'is', 'isländisch': 'is', esperanto: 'eo',
};
const NAME_LIST = Object.keys(NAMES);

/**
 * A two-letter language code (ISO 639-1) for whatever the metadata says, or null when it names no language.
 *  'de', 'DE-DE', 'de_AT', 'en-US', 'zh-Hans-CN' → the first subtag; 'eng' → 'en', 'ger' / 'deu' → 'de';
 *  'German', 'Deutsch', 'English (US)' → by the name; 'Germa', 'Engli' (cut off) → by the start of a name, when only one
 *  language starts that way; everything else ('<¦', 'ƒ*ªþ×', 'und', 'mul', 'xx') → null.
 */
function normalizeLanguage(value) {
  if (value == null) return null;
  let s = String(value).normalize('NFC').trim().toLowerCase();
  if (!s) return null;
  s = s.split(/[,;/|]/)[0].trim().replace(/\.[a-z0-9-]+$/, '');   // a list: the first one; "de_DE.UTF-8": no encoding
  const m = /^([a-z]{2,3})(?:[-_][a-z0-9]{1,8})*$/.exec(s);
  if (m) {
    const c = m[1];
    if (c.length === 2) return ISO1.has(c) ? c : (OLD[c] || null);
    if (ISO2[c]) return ISO2[c];
  }
  const word = s.replace(/\([^)]*\)/g, ' ').replace(/[^\p{L}]+/gu, ' ').trim().split(' ')[0];
  if (!word || word.length < 4) return null;
  if (NAMES[word]) return NAMES[word];
  const codes = new Set(NAME_LIST.filter((n) => n.startsWith(word)).map((n) => NAMES[n]));
  return codes.size === 1 ? [...codes][0] : null;
}

module.exports = { normalizeLanguage };
