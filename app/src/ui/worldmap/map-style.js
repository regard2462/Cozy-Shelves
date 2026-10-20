// How the world map paints the countries (osm-view.js) and what its legend says (worldmap-panel.js). Four views:
//   countries   the political map of an atlas: soft colours, neighbours never alike (Natural Earth's MAPCOLOR7, `mc`)
//   continents  one colour per continent
//   density     inhabitants per km², six classes
//   wealth      gross domestic product per head in US dollars, six classes
// Every view has a light and a dark set of colours; the tiles under the colours stay the same (CARTO's basemaps
// without labels, see osm-view.js). A country without a value (no GDP known) is painted in `none`.
import { tr } from '../../core/i18n.js';

export const MODES = ['countries', 'continents', 'density', 'wealth'];

const POLITICAL = {
  light: ['#f3d9a4', '#c9dfb0', '#f2bfa8', '#bcd3e6', '#e8c6dd', '#d9d0ec', '#f6e7a8'],
  dark: ['#5d6f91', '#4c7a6c', '#7e5f72', '#857153', '#55798a', '#6a6290', '#6f8256'],
};
const CONTINENTS = {
  'Europe': ['#8fb3de', '#3c5a80'], 'Asia': ['#f0c27b', '#7c5f30'], 'Africa': ['#e59a77', '#7a4532'],
  'North America': ['#9ccf9a', '#3f6b3e'], 'South America': ['#c7dd85', '#5d6e2f'], 'Oceania': ['#c4a6dc', '#5e4774'],
  'Antarctica': ['#e8eef3', '#5c6670'], 'Seven seas (open ocean)': ['#b9d3d6', '#3f5d61'],
};
const CONTINENT_NAMES = {
  'Europe': ['Europa', 'Europe'], 'Asia': ['Asien', 'Asia'], 'Africa': ['Afrika', 'Africa'],
  'North America': ['Nordamerika', 'North America'], 'South America': ['Südamerika', 'South America'],
  'Oceania': ['Ozeanien', 'Oceania'], 'Antarctica': ['Antarktis', 'Antarctica'],
};
// six classes each, light to strong (one hue, so that more reads as darker on both themes)
const DENSITY = { steps: [10, 50, 100, 250, 500], light: ['#fbefd9', '#f6d6a8', '#efb57a', '#e28e55', '#c9663a', '#9c4325'], dark: ['#3b3226', '#5a4630', '#7a5a35', '#9b6c38', '#bf7f3d', '#e39a52'] };
const WEALTH = { steps: [1000, 4000, 12000, 30000, 60000], light: ['#eef3df', '#d4e6b8', '#addb9a', '#7cc28a', '#4e9f7d', '#2d7769'], dark: ['#2d3428', '#3c4d33', '#4c6a3e', '#5b8a4e', '#6aab62', '#86cf82'] };
const NONE = { light: '#e6e2da', dark: '#3a3936' };

/** Inhabitants per km² of a country (0 when unknown). */
export const densityOf = (c) => (c.pop > 0 && c.area > 0 ? c.pop / c.area : 0);
/** GDP per head in US dollars (the data holds the GDP in millions; 0 when unknown). */
export const perHeadOf = (c) => (c.gdp > 0 && c.pop > 0 ? (c.gdp * 1e6) / c.pop : 0);
const classOf = (v, steps) => { let i = 0; while (i < steps.length && v >= steps[i]) i++; return i; };

/** The fill colour of a country in a view, light or dark. */
export function fillOf(c, mode, dark) {
  const k = dark ? 'dark' : 'light';
  if (mode === 'continents') { const p = CONTINENTS[c.cont]; return p ? p[dark ? 1 : 0] : NONE[k]; }
  if (mode === 'density') { const v = densityOf(c); return v > 0 ? DENSITY[k][classOf(v, DENSITY.steps)] : NONE[k]; }
  if (mode === 'wealth') { const v = perHeadOf(c); return v > 0 ? WEALTH[k][classOf(v, WEALTH.steps)] : NONE[k]; }
  const p = POLITICAL[k];
  return p[((c.mc || 1) - 1) % p.length];
}

/** How strongly the atlas lies over the tiles at a zoom: whole in the overview, gone once the towns and streets of the
 *  tiles are worth seeing (Natural Earth's outlines are made for a continent on the screen, not for a single town). */
export const ATLAS_UNTIL = 7.5, ATLAS_GONE = 8.5;
export function fillOpacity(mode, zoom) {
  if (zoom <= ATLAS_UNTIL) return 1;
  if (zoom >= ATLAS_GONE) return 0;
  return 1 - (zoom - ATLAS_UNTIL) / (ATLAS_GONE - ATLAS_UNTIL);
}

const num = (n) => new Intl.NumberFormat(tr({ de: 'de-DE', en: 'en-GB' }), { maximumFractionDigits: 0 }).format(n);

/** The name of a view for the switch. */
export function modeName(mode) {
  return tr({
    countries: { de: 'Länder', en: 'Countries' }, continents: { de: 'Kontinente', en: 'Continents' },
    density: { de: 'Bevölkerung', en: 'Population' }, wealth: { de: 'Wohlstand', en: 'Wealth' },
  }[mode]);
}

/** The legend of a view: a title and its classes [colour, text] (none for the political map). */
export function legendOf(mode, dark) {
  const k = dark ? 'dark' : 'light';
  if (mode === 'continents') {
    return { title: '', items: Object.entries(CONTINENT_NAMES).filter(([c]) => c !== 'Antarctica').map(([c, n]) => [CONTINENTS[c][dark ? 1 : 0], tr({ de: n[0], en: n[1] })]) };
  }
  if (mode === 'density' || mode === 'wealth') {
    const S = mode === 'density' ? DENSITY : WEALTH, f = num;
    const items = S[k].map((col, i) => [col, i === 0 ? tr({ de: 'unter {v}', en: 'under {v}' }, { v: f(S.steps[0]) }) : i === S.steps.length ? tr({ de: 'ab {v}', en: '{v} and more' }, { v: f(S.steps[i - 1]) }) : `${f(S.steps[i - 1])}–${f(S.steps[i])}`]);
    return { title: mode === 'density' ? tr({ de: 'Einwohner je km²', en: 'Inhabitants per km²' }) : tr({ de: 'Wirtschaftsleistung je Einwohner (BIP, US-$)', en: 'Economic output per head (GDP, US$)' }), items };
  }
  return null;
}

/** The continent's name in the interface language. */
export const continentName = (cont) => { const n = CONTINENT_NAMES[cont]; return n ? tr({ de: n[0], en: n[1] }) : ''; };
