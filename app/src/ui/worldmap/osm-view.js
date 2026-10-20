// The map of the panel "Weltkarte" since 0.9.1, in Leaflet. The tiles are plain images in the page, composed like
// every other picture of the interface: the map drawn by the app itself (a canvas, 0.5 to 0.9.0) never reached the
// screen on one Windows system, whatever way it took.
//
// Since 0.9.2 the map is quiet. In the overview (the world down to a country) it is an atlas made from the app's own
// data: the countries painted in the colours of the chosen view (map-style.js: countries, continents, population,
// wealth), the lakes and the great rivers over them, and the names in the language of the interface (map-labels.js).
// From zoom 7.5 to 8.5 the colours give way to OpenStreetMap's tiles, muted in CSS, with their own names of towns
// and streets. The tiles lie under the colours all the time: should the outlines (SVG) not show on a system, the
// map is still there. (CARTO's quiet basemaps without names were tried first; they ask for an API key since 2026
// and print "API KEY REQUIRED" over the map without one.)
//
// The countries and cities of data.js stay the knowledge behind the map: the pointer finds the country or city under
// it (even-odd test on the Natural Earth outlines, the city dots of the places), a selected country is outlined, and
// the panel's cards, search and history work as before. Without a connection the tiles do not come, the colours and
// names do (they are part of the app); the panel says so (opts.onTiles).
//
//   new OsmView(el, data, { onHover(hit, e), onClick(hit, e), onTiles({ loaded, failed }), dark, mode })
//   hit: null | { type: 'sea'|'country'|'city', country?, city?, lonlat: [lon, lat] }
import L from 'leaflet';
import { project, unproject } from './data.js';
import { LabelLayer } from './map-labels.js';
import { MODES, fillOf, fillOpacity } from './map-style.js';

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · Natural Earth · Wikidata';
const CITY_REACH = 9;        // a city answers this far from its point (CSS px)
const COAST_REACH = 7;       // a click this close to a coast still finds the country (small island states)
const SMALL = 12;            // a country smaller than this on the screen (CSS px) gets a ring around it
const WORLD = [[-56, -171], [77, 181]];

export class OsmView {
  constructor(el, data, opts = {}) {
    this.el = el; this.data = data; this.opts = opts;
    this.destroyed = false;
    this.tileStats = { loaded: 0, failed: 0 };
    this.zacc = 0;
    this.hoverKey = '';
    this.latlngs = new Map();          // country index → its outline as Leaflet rings (made once)
    this.dark = !!opts.dark;
    this.mode = MODES.includes(opts.mode) ? opts.mode : 'countries';
    // one world, no copies beside it: the atlas is drawn once (Leaflet repeats tiles, not shapes)
    const map = this.map = L.map(el, {
      zoomControl: false, attributionControl: true, keyboard: false, maxBounds: [[-89, -215], [89, 215]], maxBoundsViscosity: 0.85,
      minZoom: 1, maxZoom: 19, zoomSnap: 0.25, zoomDelta: 1, wheelPxPerZoomLevel: 90,
      fadeAnimation: true, zoomAnimation: true, inertia: true,
    });
    // a press and release up to 8 px apart (|dx| + |dy|, as Leaflet measures) is a click, not a drag: a slightly
    // trembling hand still selects (Leaflet's own 3 px made a drag of it; the map before took 6 px)
    if (map.dragging?._draggable) map.dragging._draggable.options.clickTolerance = 8;
    map.attributionControl.setPrefix(false);
    map.attributionControl.setPosition('bottomleft');
    L.control.scale({ imperial: false, position: 'bottomleft', maxWidth: 140 }).addTo(map);
    this.tiles = L.tileLayer(TILES, { maxZoom: 19, keepBuffer: 2, attribution: ATTRIBUTION, className: 'wm-tiles' }).addTo(map);
    // without tiles (no connection) the atlas stays at every zoom, else close up there would be only water
    const noTiles = () => { const off = this.tileStats.failed >= 4 && this.tileStats.loaded === 0; if (off !== !!this.noTiles) { this.noTiles = off; this.labels?.setAlways(off); this.#zoomed(); } };
    this.tiles.on('tileload', () => { this.tileStats.loaded++; noTiles(); this.opts.onTiles?.(this.tileStats); });
    this.tiles.on('tileerror', () => { this.tileStats.failed++; noTiles(); this.opts.onTiles?.(this.tileStats); });
    // the atlas: one SVG in a pane between the tiles and the outlines of hover and selection; the app's names above
    // everything (map-labels.js)
    map.createPane('wm-fill').style.zIndex = 350;
    map.getPane('wm-fill').style.pointerEvents = 'none';
    this.fillRenderer = L.svg({ pane: 'wm-fill', padding: 0.3 });
    this.fills = L.layerGroup();
    this.labels = new LabelLayer(data, { reserved: opts.reserved }).addTo(map);
    this.selLayer = L.layerGroup().addTo(map);
    this.hoverLayer = L.layerGroup().addTo(map);
    // the colours are made once the panel stands (250 outlines, about 100 000 points)
    this.fillTimer = setTimeout(() => this.#buildFills(), 0);
    map.on('zoomend', () => this.#zoomed());
    map.on('mousemove', (e) => this.#hover(e.containerPoint, e.originalEvent));
    map.on('mouseout', () => { this.#setHover(null); this.opts.onHover?.(null, null); });
    map.on('click', (e) => this.opts.onClick?.(this.hitAt(e.containerPoint), e.originalEvent));
    // the ring around a tiny selected country comes and goes with the zoom
    map.on('zoomend', () => { if (this.selected?.country && !this.selected.city) this.setSelected(this.selected); });
    this.fit(false);
    this.#zoomed();
  }

  get zoom() { return this.map.getZoom(); }

  #buildFills() {
    if (this.destroyed) return;
    const deg = (line) => { const out = []; for (let i = 0; i < line.length; i += 2) { const ll = unproject(line[i], line[i + 1]); if (ll) out.push([ll[1], ll[0]]); } return out; };
    // the sea of the atlas covers the tiles (their coasts and names do not match Natural Earth's outlines)
    this.fills.addLayer(L.rectangle([[-89, -540], [89, 540]], { renderer: this.fillRenderer, interactive: false, className: 'wm-sea', stroke: false, fillOpacity: 1 }));
    for (const c of this.data.countries) {
      const shape = L.polygon(this.#rings(c), { renderer: this.fillRenderer, interactive: false, smoothFactor: 1.2, ...this.#fillStyle(c) });
      shape.country = c;
      this.fills.addLayer(shape);
    }
    // the lakes over the countries, the great rivers (Natural Earth's ranks 1 and 2) as fine lines; their colour in CSS
    for (const lake of this.data.lakes) this.fills.addLayer(L.polygon(deg(lake), { renderer: this.fillRenderer, interactive: false, smoothFactor: 1.2, className: 'wm-lake', stroke: false, fillOpacity: 1 }));
    this.rivers = this.data.rivers.filter((r) => r.rank <= 2).map((r) => L.polyline(deg(r.line), { renderer: this.fillRenderer, interactive: false, smoothFactor: 1.5, className: 'wm-river r' + r.rank, weight: r.rank === 1 ? 1.3 : 0.9 }));
    for (const r of this.rivers) this.fills.addLayer(r);
    this.#zoomed();
  }
  #fillStyle(c) {
    return { fillColor: fillOf(c, this.mode, this.dark), fillOpacity: 1, color: this.dark ? '#20262c' : '#ffffff', weight: 0.8, opacity: 0.9 };
  }
  /** After a zoom: how strongly the atlas lies over the tiles (map-style.js fillOpacity). */
  #zoomed() {
    const z = this.map.getZoom(), op = this.noTiles ? 1 : fillOpacity(this.mode, z);
    this.map.getPane('wm-fill').style.opacity = String(op);
    if (op > 0 && !this.map.hasLayer(this.fills)) this.fills.addTo(this.map);
    else if (op === 0 && this.map.hasLayer(this.fills)) this.fills.remove();
    this.el.classList.toggle('wm-atlas', op > 0.5);
    if ((op > 0) !== this.atlasShown) { this.atlasShown = op > 0; this.opts.onAtlas?.(this.atlasShown); }
    this.el.dataset.zoom = String(Math.floor(z));
  }
  /** The view of the map (map-style.js MODES). */
  setMode(mode) {
    if (!MODES.includes(mode) || mode === this.mode) return;
    this.mode = mode;
    this.fills.eachLayer((l) => { if (l.country) l.setStyle(this.#fillStyle(l.country)); });
    this.#zoomed();
    this.labels.redraw();      // the legend has another height now
  }
  /** The theme changed: the dark colours of the countries or the light ones (the tiles are tinted in CSS). */
  setDark(dark) {
    if (!!dark === this.dark) return;
    this.dark = !!dark;
    this.fills.eachLayer((l) => { if (l.country) l.setStyle(this.#fillStyle(l.country)); });
  }
  get center() { const c = this.map.getCenter(); return [+c.lng.toFixed(4), +c.lat.toFixed(4)]; }

  /** What lies under a point of the map (container px): a city near it, else the country, else the sea. */
  hitAt(pt) {
    const p = L.point(pt.x ?? pt[0], pt.y ?? pt[1]);
    const ll = this.map.containerPointToLatLng(p);
    const lon = ((ll.lng + 540) % 360) - 180, lat = ll.lat;
    const z = this.map.getZoom(), bounds = this.map.getBounds().pad(0.05);
    // a city of another country than the one under the point answers only on its dot (within 3 px): Singapore at 16 px
    // lies within 9 px of Johor Bahru everywhere, and a click in Singapore opened the Malaysian city
    const under = this.#countryAt(ll);
    let best = null, bestD = Infinity;
    for (const c of this.data.places) {
      if (c.minZoom > z + 0.5) continue;
      if (!bounds.contains([c.lat, c.lon])) continue;
      const q = this.map.latLngToContainerPoint([c.lat, c.lon]);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < (under && c.country !== under.index ? 3 : CITY_REACH) && d < bestD) { bestD = d; best = c; }
    }
    // in a country too small to see (Malta, Andorra at a low zoom) only the dot itself opens the city, the rest of the
    // reach belongs to the country
    if (best && bestD > 3) { const c = best.country >= 0 ? this.data.countries[best.country] : null; if (c && this.#tiny(c)) best = null; }
    if (best) return { type: 'city', city: best, lonlat: [best.lon, best.lat] };
    const country = under || this.#countryNear(p);
    return country ? { type: 'country', country, lonlat: [lon, lat] } : { type: 'sea', lonlat: [lon, lat] };
  }
  #countryAt(ll) {
    if (Math.abs(ll.lat) >= 85) return null;
    const [x, y] = project(((ll.lng + 540) % 360) - 180, ll.lat);
    return this.data.countryAt(x, y);
  }
  /** Just off a coast: the country a few pixels away (twelve points on each of three small circles, so that an island
   *  a few pixels wide is not stepped over; the smallest country wins, so a click beside Malta finds Malta and not
   *  Italy). */
  #countryNear(p) {
    let best = null, area = Infinity;
    for (let k = 0; k < 36; k++) {
      const a = ((k % 12) / 12) * Math.PI * 2 + (k >= 12 ? Math.PI / 12 : 0), r = COAST_REACH * [0.4, 0.7, 1][Math.floor(k / 12)];
      const c = this.#countryAt(this.map.containerPointToLatLng(L.point(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r)));
      if (!c) continue;
      const b = c.bbox, s = (b[2] - b[0]) * (b[3] - b[1]);
      if (s < area) { area = s; best = c; }
    }
    return best;
  }
  /** Is the country smaller than SMALL px on the screen at this zoom? */
  #tiny(c) {
    const [x0, y0, x1, y1] = c.bbox;
    const a = unproject(x0, y0), b = unproject(x1, y1);
    if (!a || !b) return false;
    const pa = this.map.latLngToContainerPoint([a[1], a[0]]), pb = this.map.latLngToContainerPoint([b[1], b[0]]);
    return Math.max(Math.abs(pa.x - pb.x), Math.abs(pa.y - pb.y)) < SMALL;
  }
  /** A ring around a country too small to see on the screen at this zoom (else null). */
  #ringFor(c, className) {
    if (!this.#tiny(c)) return null;
    const [x0, y0, x1, y1] = c.bbox;
    const m = unproject(c.label ? c.label[0] : (x0 + x1) / 2, c.label ? c.label[1] : (y0 + y1) / 2);
    return m ? L.circleMarker([m[1], m[0]], { className, interactive: false, radius: 11, weight: 2, fillOpacity: 0.08 }) : null;
  }

  #hover(pt, e) {
    const hit = this.hitAt(pt);
    this.#setHover(hit);
    this.opts.onHover?.(hit, e);
  }
  #setHover(hit) {
    const key = hit?.type === 'country' ? 'k' + hit.country.index : hit?.type === 'city' ? 'c' + hit.city.index : '';
    this.el.classList.toggle('pointing', !!key);
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    this.hoverLayer.clearLayers();
    if (hit?.type === 'country' && hit.country !== this.selected?.country) {
      L.polygon(this.#rings(hit.country), { className: 'wm-hover-shape', interactive: false, weight: 1.5, fillOpacity: 0.06 }).addTo(this.hoverLayer);
      this.#ringFor(hit.country, 'wm-hover-shape')?.addTo(this.hoverLayer);
    }
  }
  /** The pad's cross: the hover and the click at a point of the map. */
  hoverAt(x, y) {
    // the name tag stands at the cross as it stands at the mouse (the panel places it by the event's client point)
    const r = this.el.getBoundingClientRect();
    this.#hover(L.point(x, y), { clientX: r.left + x, clientY: r.top + y });
  }
  clickAt(x, y) { this.opts.onClick?.(this.hitAt(L.point(x, y)), null); }

  /** A country's outline as Leaflet rings: the Natural Earth rings of data.js turned back into degrees. */
  #rings(c) {
    let r = this.latlngs.get(c.index);
    if (r) return r;
    r = c.rings.map((ring) => {
      const out = [];
      for (let i = 0; i < ring.length; i += 2) { const ll = unproject(ring[i], ring[i + 1]); if (ll) out.push([ll[1], ll[0]]); }
      return out;
    });
    this.latlngs.set(c.index, r);
    return r;
  }
  /** The box of a country worth showing (data.focusBox: its main part and the parts near it) in degrees. */
  #boundsOf(c) {
    const [x0, y0, x1, y1] = this.data.focusBox(c);
    const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1], [(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1]].map(([x, y]) => unproject(x, y)).filter(Boolean);
    if (!pts.length) return L.latLngBounds(WORLD);
    return L.latLngBounds(pts.map(([lon, lat]) => [lat, lon]));
  }

  setSelected(sel) {
    this.selected = sel;
    this.labels.setSelected(sel);
    this.selLayer.clearLayers();
    this.hoverLayer.clearLayers(); this.hoverKey = '';
    if (sel?.country && !sel.city) {
      L.polygon(this.#rings(sel.country), { className: 'wm-sel-shape', interactive: false, weight: 2.5, fillOpacity: 0.1 }).addTo(this.selLayer);
      this.#ringFor(sel.country, 'wm-sel-shape')?.addTo(this.selLayer);
    }
    if (sel?.city) L.circleMarker([sel.city.lat, sel.city.lon], { className: 'wm-sel-city', interactive: false, radius: 9, weight: 3, fillOpacity: 0.25 }).addTo(this.selLayer);
  }

  /** The whole world. */
  fit(animate = true) { this.map.fitBounds(WORLD, { animate, padding: [8, 8] }); }
  /** To a country (its main part), leaving `right` px free for the card. */
  flyToCountry(c, { right = 0, maxZoom = 10 } = {}) {
    this.map.flyToBounds(this.#boundsOf(c), { paddingTopLeft: [24, 24], paddingBottomRight: [right + 24, 24], maxZoom, duration: 0.8 });
  }
  /** To a city: a large one shows its area, a small one a little closer. */
  flyToCity(p, { right = 0, zoom } = {}) {
    const z = zoom ?? Math.max(this.map.getZoom(), p.cls === 0 || p.pop > 1e6 ? 10 : 11);
    this.#flyLeaving([p.lat, p.lon], z, right);
  }
  /** Closer to a city: two levels in, at least 13. */
  zoomIntoCity(p, { right = 0 } = {}) { this.#flyLeaving([p.lat, p.lon], Math.min(17, Math.max(13, this.map.getZoom() + 2)), right); }
  #flyLeaving(latlng, z, right) {
    // the point lands in the middle of the part of the map the card leaves free
    const target = this.map.project(latlng, z).add([right / 2, 0]);
    this.map.flyTo(this.map.unproject(target, z), z, { duration: 0.8 });
  }
  /** Zoom by a factor about a point of the map (container px; the middle when not given). Small steps (the pad's
   *  triggers, a frame each) add up until they make a quarter level. */
  zoomAt(f, x, y) {
    this.zacc += Math.log2(f);
    const step = Math.trunc(this.zacc * 4) / 4;
    if (!step) return;
    this.zacc -= step;
    const pt = x == null ? this.map.getSize().divideBy(2) : L.point(x, y);
    this.map.setZoomAround(pt, this.map.getZoom() + step, { animate: Math.abs(step) >= 0.5 });
  }
  panBy(dx, dy, animate = true) { this.map.panBy([dx, dy], { animate }); }
  resize() { this.map.invalidateSize({ pan: false }); }
  /** The interface's language changed: the names of the atlas anew. */
  invalidate() { this.labels.redraw(); }
  /** Try the tiles again (after the connection came back). Not tiles.redraw(): Leaflet 1.9.4 takes the map's zoom
   *  there unrounded, and at the whole world's zoom of 2.25 the tiles were asked for as /2.25/x/y.png, which no server
   *  has. Off the map and on again, the layer starts like a new view, with the zoom of its tiles rounded. */
  reload() { this.tileStats = { loaded: 0, failed: 0 }; this.noTiles = false; this.labels.setAlways(false); this.#zoomed(); this.tiles.remove(); this.tiles.addTo(this.map); }
  stats() { return { ...this.tileStats, zoom: this.zoom, tiles: this.el.querySelectorAll('.leaflet-tile-pane img.leaflet-tile-loaded').length, mode: this.mode, labels: this.el.querySelectorAll('.wm-l').length }; }
  destroy() { this.destroyed = true; clearTimeout(this.fillTimer); this.map.remove(); }
}
