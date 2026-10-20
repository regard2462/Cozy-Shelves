// Numbers, names and the translations of the Natural Earth categories for the cards of the world map.
import { tr, i18n } from '../../core/i18n.js';

const loc = () => (i18n.lang === 'en' ? 'en-GB' : 'de-DE');
const de = () => i18n.lang !== 'en';
const num = (v, digits = 0) => Number(v).toLocaleString(loc(), { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** 83,1 Mio. · 1,41 Mrd. · 12.345 (English: 83.1 million …) */
export function people(n) {
  if (!(n > 0)) return '';
  if (n >= 1e9) return de() ? `${num(n / 1e9, 2)} Mrd.` : `${num(n / 1e9, 2)} billion`;
  if (n >= 1e6) return de() ? `${num(n / 1e6, n >= 1e7 ? 1 : 2)} Mio.` : `${num(n / 1e6, n >= 1e7 ? 1 : 2)} million`;
  return num(Math.round(n));
}
/** Natural Earth GDP (million US dollars) → 3,86 Bio. US-$ / US$ 3.86 trillion */
export function money(millions) {
  if (!(millions > 0)) return '';
  const v = millions * 1e6;
  if (de()) {
    if (v >= 1e12) return `${num(v / 1e12, 2)} Bio. US-$`;
    if (v >= 1e9) return `${num(v / 1e9, v >= 1e11 ? 0 : 1)} Mrd. US-$`;
    return `${num(v / 1e6, 0)} Mio. US-$`;
  }
  if (v >= 1e12) return `US$ ${num(v / 1e12, 2)} trillion`;
  if (v >= 1e9) return `US$ ${num(v / 1e9, v >= 1e11 ? 0 : 1)} billion`;
  return `US$ ${num(v / 1e6, 0)} million`;
}
export const perHead = (usd) => (usd > 0 ? (de() ? `${num(Math.round(usd / 100) * 100)} US-$` : `US$ ${num(Math.round(usd / 100) * 100)}`) : '');
export const area = (km2) => (km2 >= 100 ? `${num(Math.round(km2))} km²` : km2 > 0 ? `${num(km2, km2 < 10 ? 2 : 1)} km²` : '');
export const density = (d) => (d > 0 ? tr({ de: '{n} Einw./km²', en: '{n} per km²' }, { n: num(d, d < 10 ? 1 : 0) }) : '');
export function coords(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S', ew = lon >= 0 ? (de() ? 'O' : 'E') : 'W';
  return `${num(Math.abs(lat), 2)}° ${ns}, ${num(Math.abs(lon), 2)}° ${ew}`;
}
/** The local time at a place (IANA time zone) with its short zone name, or ''. */
export function localTime(tz) {
  if (!tz) return '';
  try { return new Intl.DateTimeFormat(loc(), { hour: '2-digit', minute: '2-digit', timeZone: tz, timeZoneName: 'short' }).format(new Date()); } catch { return ''; }
}
export const year = (y) => (y > 0 ? String(y) : '');

const CONTINENT = {
  Africa: ['Afrika', 'Africa'], Antarctica: ['Antarktika', 'Antarctica'], Asia: ['Asien', 'Asia'], Europe: ['Europa', 'Europe'],
  'North America': ['Nordamerika', 'North America'], Oceania: ['Ozeanien', 'Oceania'], 'South America': ['Südamerika', 'South America'],
  'Seven seas (open ocean)': ['Inseln im offenen Meer', 'Islands in the open ocean'],
};
const SUBREGION = {
  'Australia and New Zealand': ['Australien und Neuseeland', 'Australia and New Zealand'], Caribbean: ['Karibik', 'Caribbean'],
  'Central America': ['Zentralamerika', 'Central America'], 'Central Asia': ['Zentralasien', 'Central Asia'], 'Eastern Africa': ['Ostafrika', 'Eastern Africa'],
  'Eastern Asia': ['Ostasien', 'Eastern Asia'], 'Eastern Europe': ['Osteuropa', 'Eastern Europe'], Melanesia: ['Melanesien', 'Melanesia'],
  Micronesia: ['Mikronesien', 'Micronesia'], 'Middle Africa': ['Zentralafrika', 'Middle Africa'], 'Northern Africa': ['Nordafrika', 'Northern Africa'],
  'Northern America': ['Nördliches Amerika', 'Northern America'], 'Northern Europe': ['Nordeuropa', 'Northern Europe'], Polynesia: ['Polynesien', 'Polynesia'],
  'South America': ['Südamerika', 'South America'], 'South-Eastern Asia': ['Südostasien', 'South-Eastern Asia'], 'Southern Africa': ['Südliches Afrika', 'Southern Africa'],
  'Southern Asia': ['Südasien', 'Southern Asia'], 'Southern Europe': ['Südeuropa', 'Southern Europe'], 'Western Africa': ['Westafrika', 'Western Africa'],
  'Western Asia': ['Westasien', 'Western Asia'], 'Western Europe': ['Westeuropa', 'Western Europe'], Antarctica: ['Antarktika', 'Antarctica'],
  'Seven seas (open ocean)': ['offenes Meer', 'open ocean'],
};
const INCOME = {
  1: ['hohes Einkommen (OECD)', 'high income (OECD)'], 2: ['hohes Einkommen (nicht OECD)', 'high income (non-OECD)'],
  3: ['oberes mittleres Einkommen', 'upper middle income'], 4: ['unteres mittleres Einkommen', 'lower middle income'], 5: ['niedriges Einkommen', 'low income'],
};
const ECONOMY = {
  1: ['Industrieland (G7)', 'developed (G7)'], 2: ['Industrieland', 'developed'], 3: ['Schwellenland (BRIC)', 'emerging (BRIC)'],
  4: ['Schwellenland (MIKT)', 'emerging (MIKT)'], 5: ['Schwellenland (G20)', 'emerging (G20)'], 6: ['Entwicklungsland', 'developing'],
  7: ['am wenigsten entwickeltes Land', 'least developed'],
};
const pick = (table, key) => { const v = table[key]; return v ? (de() ? v[0] : v[1]) : ''; };
export const continent = (c) => pick(CONTINENT, c) || c || '';
export const subregion = (s) => pick(SUBREGION, s) || s || '';
export const income = (n) => pick(INCOME, n);
export const economy = (n) => pick(ECONOMY, n);

/** Label of a place's status. cls: 0 capital, 1 further seat of state institutions, 2 capital of a dependent area,
 *  3 regional capital, 4 regional capital (second level), 5 town, 6 other (station, historic place). */
export function placeStatus(cls, countryName) {
  switch (cls) {
    case 0: return tr({ de: 'Hauptstadt von {c}', en: 'Capital of {c}' }, { c: countryName });
    case 1: return tr({ de: 'Sitz weiterer Staatsorgane von {c}', en: 'Seat of further state institutions of {c}' }, { c: countryName });
    case 2: return tr({ de: 'Hauptort eines Gebiets', en: 'Capital of a territory' });
    case 3: case 4: return tr({ de: 'Hauptstadt einer Region oder Provinz', en: 'Capital of a region or province' });
    case 6: return tr({ de: 'Station oder historischer Ort', en: 'Station or historic place' });
    default: return tr({ de: 'Stadt', en: 'Town or city' });
  }
}
