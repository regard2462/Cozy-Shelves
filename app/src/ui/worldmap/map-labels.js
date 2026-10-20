// The names on the world map's atlas (osm-view.js): countries, capitals, cities and seas in the language of the
// interface, from the app's own data (Natural Earth, Wikidata). The map speaks one language and shows only as much as
// fits: the names are placed in the order of their importance, and a name that would touch one already placed stays
// away. From zoom 8 on OpenStreetMap's tiles show their own names (towns, streets) and this layer keeps only the
// selected place.
//
// The names are plain elements in a pane of their own (no canvas), placed in Leaflet's layer coordinates so that they
// move with the map while it is dragged; they are placed anew after every move and every zoom.
import L from 'leaflet';
import { unproject } from './data.js';
import { i18n } from '../../core/i18n.js';

export const DETAIL_ZOOM = 8;       // from here on the tiles' own names show (map-style.js ATLAS_UNTIL, ATLAS_GONE)

// shorter names on the map for a few long official ones (the card keeps the full name)
const SHORT = {
  CHN: ['China', 'China'], COD: ['DR Kongo', 'DR Congo'], COG: ['Kongo', 'Congo'], USA: ['Vereinigte Staaten', 'United States'],
  CYP: ['Zypern', 'Cyprus'], FSM: ['Mikronesien', 'Micronesia'], ARE: ['Emirate', 'Emirates'], CAF: ['Zentralafrika', 'Central Africa'],
  SGS: ['Südgeorgien', 'South Georgia'], BIH: ['Bosnien-Herz.', 'Bosnia-Herz.'],
};
const countryName = (c, de) => (SHORT[c.id] ? SHORT[c.id][de ? 0 : 1] : de ? c.de : c.en);

// seas and oceans: [lat, lon, de, en, from zoom, to zoom]
const SEAS = [
  [22, -150, 'Pazifischer Ozean', 'Pacific Ocean', 1, 4.5], [-28, -125, 'Pazifischer Ozean', 'Pacific Ocean', 1, 4.5],
  [18, -42, 'Atlantischer Ozean', 'Atlantic Ocean', 1, 4.5], [-24, -16, 'Atlantischer Ozean', 'Atlantic Ocean', 1.5, 4.5],
  [-22, 78, 'Indischer Ozean', 'Indian Ocean', 1, 4.5], [-62, 40, 'Südlicher Ozean', 'Southern Ocean', 1, 3.5],
  [78, 5, 'Nordpolarmeer', 'Arctic Ocean', 2, 4],
  [35, 18, 'Mittelmeer', 'Mediterranean Sea', 3.5, 6.5], [56, 3.5, 'Nordsee', 'North Sea', 4.5, 7.5],
  [57.5, 19.3, 'Ostsee', 'Baltic Sea', 4.5, 7.5], [43.3, 34.5, 'Schwarzes Meer', 'Black Sea', 4.5, 7.5],
  [42, 50.6, 'Kaspisches Meer', 'Caspian Sea', 4.5, 7.5], [20.5, 38.2, 'Rotes Meer', 'Red Sea', 5, 7.5],
  [15, -75, 'Karibisches Meer', 'Caribbean Sea', 3.5, 6.5], [25, -90, 'Golf von Mexiko', 'Gulf of Mexico', 3.5, 6.5],
  [15, 64, 'Arabisches Meer', 'Arabian Sea', 3.5, 6], [15, 88.5, 'Golf von Bengalen', 'Bay of Bengal', 3.5, 6],
  [13, 114, 'Südchinesisches Meer', 'South China Sea', 3.5, 6], [29, 125.5, 'Ostchinesisches Meer', 'East China Sea', 4.5, 6.5],
  [40.5, 135, 'Japanisches Meer', 'Sea of Japan', 4, 6.5], [58, -178, 'Beringmeer', 'Bering Sea', 3.5, 6],
  [-39, 160, 'Tasmansee', 'Tasman Sea', 3.5, 6], [60, -86, 'Hudson Bay', 'Hudson Bay', 3.5, 6],
  [63.5, -2, 'Nordmeer', 'Norwegian Sea', 4, 6.5], [48.5, -7.5, 'Keltische See', 'Celtic Sea', 5.5, 7.5],
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// text widths without drawing anything: a 2D context used only for measureText
let measureCtx = null;
function textWidth(text, font) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}
/** A long name in two lines, broken at the space nearest the middle (Demokratische Republik / Kongo). */
function lines(name, max = 15) {
  if (name.length <= max || !name.includes(' ')) return [name];
  let best = -1;
  for (let i = 0; i < name.length; i++) if (name[i] === ' ' && (best < 0 || Math.abs(i - name.length / 2) < Math.abs(best - name.length / 2))) best = i;
  return [name.slice(0, best), name.slice(best + 1)];
}

export const LabelLayer = L.Layer.extend({
  // opts.reserved(): boxes [x0, y0, x1, y1] in the map's own px that the names keep clear of (legend, buttons, card)
  initialize(data, opts = {}) {
    this.data = data;
    this.reserved = opts.reserved || null;
    this.selected = null;
    this.fontFamily = '';
  },
  onAdd(map) {
    this._map = map;
    if (!map.getPane('wm-labels')) { const p = map.createPane('wm-labels'); p.style.zIndex = 450; p.style.pointerEvents = 'none'; }
    this._el = L.DomUtil.create('div', 'wm-labels', map.getPane('wm-labels'));
    this.fontFamily = getComputedStyle(map.getContainer()).getPropertyValue('--font-ui').trim() || 'sans-serif';
    map.on('moveend zoomend viewreset resize', this.redraw, this);
    map.on('zoomstart', this._fade, this);
    this.redraw();
  },
  onRemove(map) {
    map.off('moveend zoomend viewreset resize', this.redraw, this);
    map.off('zoomstart', this._fade, this);
    this._el.remove();
  },
  setSelected(sel) { this.selected = sel; this.redraw(); },
  /** Names at every zoom (no tiles came: the atlas is all there is). */
  setAlways(on) { if (!!on !== !!this.always) { this.always = !!on; this.redraw(); } },
  _fade() { this._el?.classList.add('zooming'); },

  /** Places the names for the view as it stands. */
  redraw() {
    const map = this._map;
    if (!map || !this._el) return;
    const z = map.getZoom(), de = i18n.lang !== 'en';
    const bounds = map.getBounds().pad(0.08);
    const size = map.getSize(), origin = map.containerPointToLayerPoint([0, 0]);
    const placed = [];   // boxes [x0, y0, x1, y1] in layer px
    for (const r of this.reserved?.() || []) placed.push([origin.x + r[0], origin.y + r[1], origin.x + r[2], origin.y + r[3]]);
    const html = [];
    const free = (b) => {
      // whole inside the map or not at all (a name cut by the edge reads as a different word)
      if (b[0] < origin.x + 2 || b[1] < origin.y + 2 || b[2] > origin.x + size.x - 2 || b[3] > origin.y + size.y - 2) return false;
      for (const q of placed) if (b[0] < q[2] + 4 && b[2] > q[0] - 4 && b[1] < q[3] + 3 && b[3] > q[1] - 3) return false;
      return true;
    };
    const pt = (lat, lon) => map.latLngToLayerPoint([lat, lon]);
    const sel = this.selected;
    const selCountry = sel?.country && !sel.city ? sel.country : null, selCity = sel?.city || null;

    // a city: its dot and its name to the right (else to the left)
    const city = (p, cls) => {
      const capital = p.cls === 0;
      const fs = capital ? 12.5 : 11.5, weight = capital ? 600 : 500;
      const name = de ? p.de : p.en;
      const w = textWidth(name, `${weight} ${fs}px ${this.fontFamily}`) + 2, h = fs + 4;
      const q = pt(p.lat, p.lon);
      const r = capital ? 4 : 3;
      const right = [q.x - r, q.y - h / 2, q.x + r + 5 + w, q.y + h / 2];
      const left = [q.x - r - 5 - w, q.y - h / 2, q.x + r, q.y + h / 2];
      const box = free(right) ? right : free(left) ? left : null;
      if (!box) return false;
      placed.push(box);
      html.push(`<div class="wm-l wm-l-city${capital ? ' cap' : ''}${cls || ''}${box === left ? ' left' : ''}" style="transform:translate(${Math.round(q.x)}px,${Math.round(q.y)}px)"><i></i><span style="font-size:${fs}px">${esc(name)}</span></div>`);
      return true;
    };

    if (selCity) city(selCity, ' sel');
    if (z < DETAIL_ZOOM || this.always) {
      // seas first (they lie where nothing else is), then the countries by rank, then capitals and cities
      for (const s of SEAS) {
        if (z < s[4] || z > s[5] || !bounds.contains([s[0], s[1]])) continue;
        const fs = Math.min(15, 11 + (z - s[4]) * 1.2), ls = lines(de ? s[2] : s[3], 12);
        const w = Math.max(...ls.map((l) => textWidth(l, `italic 500 ${fs}px ${this.fontFamily}`))) * 1.12 + 4, h = ls.length * (fs + 3);
        const q = pt(s[0], s[1]), box = [q.x - w / 2, q.y - h / 2, q.x + w / 2, q.y + h / 2];
        if (!free(box)) continue;
        placed.push(box);
        html.push(`<div class="wm-l wm-l-sea" style="transform:translate(${Math.round(q.x)}px,${Math.round(q.y)}px);font-size:${fs.toFixed(1)}px">${ls.map(esc).join('<br>')}</div>`);
      }
      const countries = this.data.countries
        .filter((c) => c === selCountry || (z >= c.minL - 0.7 && z <= c.maxL + 3))
        .sort((a, b) => (b === selCountry) - (a === selCountry) || a.lr - b.lr || b.area - a.area);
      for (const c of countries) {
        const ll = unproject(c.label[0], c.label[1]);
        if (!ll || !bounds.contains([ll[1], ll[0]])) continue;
        const fs = Math.max(10, Math.min(19, 10.5 + (z - c.minL) * 1.5 + Math.max(0, 4 - c.lr) * 0.5));
        const caps = fs >= 12;
        const font = `${caps ? 600 : 500} ${fs.toFixed(1)}px ${this.fontFamily}`;
        const ls = lines(countryName(c, de));
        // the capitals stand apart by 0.08 em (worldmap.css .wm-l-country.caps)
        const w = Math.max(...ls.map((l) => textWidth(caps ? l.toUpperCase() : l, font) + (caps ? l.length * 0.08 * fs : 0))) + 4, h = ls.length * (fs + 2);
        const q = pt(ll[1], ll[0]), box = [q.x - w / 2, q.y - h / 2, q.x + w / 2, q.y + h / 2];
        if (c !== selCountry && !free(box)) continue;
        placed.push(box);
        html.push(`<div class="wm-l wm-l-country${caps ? ' caps' : ''}${c === selCountry ? ' sel' : ''}" style="transform:translate(${Math.round(q.x)}px,${Math.round(q.y)}px);font-size:${fs.toFixed(1)}px">${ls.map(esc).join('<br>')}</div>`);
      }
      // capitals from zoom 2 (the large ones by Natural Earth's own zoom), then the other cities half a step after theirs
      const cities = [];
      for (const p of this.data.places) {
        if (p === selCity) continue;
        const need = p.cls === 0 ? Math.max(2, p.minZoom - 0.5) : p.minZoom + 0.5;
        if (z < need || !bounds.contains([p.lat, p.lon])) continue;
        cities.push(p);
      }
      cities.sort((a, b) => (a.cls === 0 ? 0 : 1) - (b.cls === 0 ? 0 : 1) || (b.popCity || b.pop) - (a.popCity || a.pop));
      let n = 0;
      for (const p of cities) { if (n >= 80) break; if (city(p)) n++; }
    }
    this._el.innerHTML = html.join('');
    this._el.classList.remove('zooming');
  },
});
