// Builds the offline data of the world map (app/data/worldmap) from Natural Earth (public domain) and Wikidata (CC0).
//
//   node build/worldmap-data.js <folder with the Natural Earth GeoJSON files> [--refresh]
//
// The folder is filled once, for example with
//   for f in ne_10m_admin_0_countries_deu ne_10m_populated_places ne_50m_lakes ne_50m_rivers_lake_centerlines; do
//     curl -sSLO "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/$f.geojson"; done
// The answers of Wikidata (official languages, currencies, areas, population of the cities) are kept in the same
// folder (wikidata-countries.json, wikidata-places.json); --refresh asks Wikidata again.
//
// Inputs, from https://github.com/nvkelso/natural-earth-vector/tree/master/geojson:
//   ne_10m_admin_0_countries_deu.geojson     countries in the German point of view (Crimea belongs to Ukraine,
//                                            Somaliland to Somalia, Northern Cyprus to Cyprus, Western Sahara
//                                            is a territory of its own); simplified here to the density of 1:50 Mio.
//   ne_10m_populated_places.geojson          cities, capitals
//   ne_50m_lakes.geojson                     large lakes (drawn over the land)
//   ne_50m_rivers_lake_centerlines.geojson   large rivers
//
// Output (app/data/worldmap):
//   world.json   a topology like TopoJSON: every border line is stored once (arcs), countries refer to it, so the
//                simplification keeps neighbours seamless; plus coastlines, borders, lakes, rivers and the facts of
//                every country (population, GDP, income group, capital, neighbours, area)
//   places.json  7 300 cities: names (de/en/local), position, population, capital status, country, region,
//                time zone, Wikidata id
//
// No packages: plain Node. The numbers of the run are printed at the end.
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
if (!SRC || !fs.existsSync(SRC)) { console.error('usage: node build/worldmap-data.js <folder with the Natural Earth GeoJSON files>'); process.exit(1); }
const OUT = path.join(__dirname, '..', 'app', 'data', 'worldmap');

const Q = 100;               // coordinates are stored as integer lon/lat × Q (0.01° ≈ 1.1 km)
const TOL = 0.018;           // Douglas–Peucker tolerance in degrees (x scaled with cos(lat))
const MIN_PART_KM2 = 30;     // smaller islands are left out; the three largest parts of every country always stay
const R = 6371.0088;         // mean earth radius in km
const EPS = 1e-7;

const read = (f) => JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8'));
const rad = (d) => d * Math.PI / 180;
const keyOf = (p) => Math.round(p[0] * 1e7) + ',' + Math.round(p[1] * 1e7);
const onCut = (p) => Math.abs(p[0]) >= 180 - 1e-6 || p[1] <= -90 + 1e-6;

/** Rings of a geometry without the closing point and without repeated points. */
function polygonsOf(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  const out = [];
  for (const poly of polys) {
    const rings = [];
    for (const ring of poly) {
      const pts = [];
      for (const p of ring) { const q = [p[0], p[1]]; const last = pts[pts.length - 1]; if (!last || keyOf(last) !== keyOf(q)) pts.push(q); }
      while (pts.length > 1 && keyOf(pts[0]) === keyOf(pts[pts.length - 1])) pts.pop();
      if (pts.length >= 3) rings.push(pts);
    }
    if (rings.length) out.push(rings);
  }
  return out;
}

/** Area of a ring on the sphere in km² (Chamberlain & Duquette 2007), always positive. */
function ringAreaKm2(ring) {
  let s = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[(i + n - 1) % n], b = ring[i], c = ring[(i + 1) % n];
    s += rad(c[0] - a[0]) * Math.sin(rad(b[1]));
  }
  return Math.abs(s * R * R / 2);
}
const polyAreaKm2 = (poly) => Math.max(0, ringAreaKm2(poly[0]) - poly.slice(1).reduce((a, r) => a + ringAreaKm2(r), 0));

function inRing(x, y, ring) {
  let c = false;
  for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
    const xi = ring[i][0], yi = ring[i][1], xk = ring[k][0], yk = ring[k][1];
    if ((yi > y) !== (yk > y) && x < (xk - xi) * (y - yi) / (yk - yi) + xi) c = !c;
  }
  return c;
}
const inPoly = (x, y, poly) => inRing(x, y, poly[0]) && !poly.slice(1).some((h) => inRing(x, y, h));

/** Douglas–Peucker for an open polyline (first and last point stay). x is scaled with cos(lat). */
function simplify(pts, tol) {
  if (pts.length <= 2) return pts.slice();
  const lat = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const kx = Math.max(0.2, Math.cos(rad(lat)));
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[a][0] * kx, ay = pts[a][1], bx = pts[b][0] * kx, by = pts[b][1];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][0] * kx - ax, py = pts[i][1] - ay;
      let d2;
      if (len2 < 1e-18) d2 = px * px + py * py;
      else { const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2)); const qx = px - t * dx, qy = py - t * dy; d2 = qx * qx + qy * qy; }
      if (d2 > best) { best = d2; bi = i; }
    }
    if (best > t2) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((p, i) => keep[i]);
}
/** A closed ring (first point repeated at the end): split at the point farthest from the start. */
function simplifyClosed(pts, tol) {
  const open = pts.slice(0, -1);
  if (open.length <= 4) return pts.slice();
  let far = 1, best = -1;
  for (let i = 1; i < open.length; i++) { const d = (open[i][0] - open[0][0]) ** 2 + (open[i][1] - open[0][1]) ** 2; if (d > best) { best = d; far = i; } }
  const a = simplify(pts.slice(0, far + 1), tol), b = simplify(pts.slice(far), tol);
  const out = [...a, ...b.slice(1)];
  if (out.length < 4) {                        // a small island keeps a triangle at least
    const step = Math.max(1, Math.floor(open.length / 3));
    return [open[0], open[step], open[Math.min(open.length - 1, step * 2)], open[0]];
  }
  return out;
}

/** Quantised, delta-encoded polyline: [x0, y0, dx1, dy1, …]. Repeated points are dropped (the ends stay). */
function encode(pts, closed = false) {
  const q = pts.map((p) => [Math.round(p[0] * Q), Math.round(p[1] * Q)]);
  const out = [];
  let px = 0, py = 0, n = 0;
  q.forEach((p, i) => {
    const last = i === q.length - 1;
    if (n && p[0] === px && p[1] === py && !(last && !closed && n === 1)) return;
    out.push(p[0] - px, p[1] - py); px = p[0]; py = p[1]; n++;
  });
  return out;
}

// ---------------------------------------------------------------- countries ---------------------------------------
const countriesGeo = read('ne_10m_admin_0_countries_deu.geojson');
const feats = countriesGeo.features.map((f) => ({ props: f.properties, polys: polygonsOf(f.geometry) })).filter((f) => f.polys.length);
feats.sort((a, b) => String(a.props.ADM0_A3).localeCompare(String(b.props.ADM0_A3)));
console.log('countries', feats.length, 'parts', feats.reduce((a, f) => a + f.polys.length, 0), 'points', feats.reduce((a, f) => a + f.polys.reduce((b, p) => b + p.reduce((c, r) => c + r.length, 0), 0), 0));

// ---- junctions: a point where rings meet with different neighbours (the start or end of a shared border) ----
const occ = new Map();
for (const f of feats) for (const poly of f.polys) for (const ring of poly) {
  const n = ring.length;
  const keys = ring.map(keyOf);
  ring.keys = keys;
  for (let i = 0; i < n; i++) {
    const k = keys[i], prev = keys[(i + n - 1) % n], next = keys[(i + 1) % n];
    const o = occ.get(k);
    if (!o) occ.set(k, { a: prev, b: next, j: onCut(ring[i]) });
    else if (!((o.a === prev && o.b === next) || (o.a === next && o.b === prev))) o.j = true;
  }
}

// ---- cut every ring at its junctions into arcs; an arc shared by two rings is stored once ------------------------
const arcs = [];            // [{ pts: [[lon, lat], …], keys }]
const arcIndex = new Map();
function arcRef(pts, keys) {
  const fwd = keys.join(';');
  if (arcIndex.has(fwd)) return arcIndex.get(fwd);
  const rev = keys.slice().reverse().join(';');
  if (arcIndex.has(rev)) return ~arcIndex.get(rev);
  const i = arcs.length;
  arcs.push({ pts, keys });
  arcIndex.set(fwd, i);
  return i;
}
for (const f of feats) {
  f.shape = f.polys.map((poly) => poly.map((ring) => {
    const n = ring.length, keys = ring.keys;
    const J = [];
    for (let i = 0; i < n; i++) if (occ.get(keys[i]).j) J.push(i);
    if (!J.length) {
      // a ring without junctions (an island, an enclave): one closed arc, rotated to a canonical start
      let m = 0; for (let i = 1; i < n; i++) if (keys[i] < keys[m]) m = i;
      const idx = [...Array(n).keys()].map((i) => (m + i) % n);
      const fwdIdx = [...idx, idx[0]];
      const revIdx = [idx[0], ...idx.slice(1).reverse(), idx[0]];
      const fk = fwdIdx.map((i) => keys[i]).join(';'), rk = revIdx.map((i) => keys[i]).join(';');
      if (arcIndex.has(fk)) return [arcIndex.get(fk)];
      if (arcIndex.has(rk)) return [~arcIndex.get(rk)];
      return [arcRef(fwdIdx.map((i) => ring[i]), fwdIdx.map((i) => keys[i]))];
    }
    const refs = [];
    for (let j = 0; j < J.length; j++) {
      const a = J[j], b = J[(j + 1) % J.length];
      const idx = [];
      for (let i = a; ; i = (i + 1) % n) { idx.push(i); if (i === b && idx.length > 1) break; if (idx.length > n + 1) break; }
      refs.push(arcRef(idx.map((i) => ring[i]), idx.map((i) => keys[i])));
    }
    return refs;
  }));
}
console.log('arcs', arcs.length);

// ---- what every arc is: coast, border between two countries, inside one country, or the map's cut line ---------
const uses = arcs.map(() => []);
feats.forEach((f, ci) => f.shape.forEach((poly) => poly.forEach((ring) => ring.forEach((r) => uses[r < 0 ? ~r : r].push(ci)))));
arcs.forEach((a, i) => {
  const u = uses[i];
  a.cut = a.pts.every(onCut);
  a.kind = a.cut ? 'cut' : u.length === 1 ? 'coast' : u.length === 2 && u[0] !== u[1] ? 'border' : 'inner';
  a.between = a.kind === 'border' ? [u[0], u[1]] : null;
});

// ---- neighbours: countries that share a border arc (land borders only) ------------------------------------------
const nb = feats.map(() => new Set());
for (const a of arcs) if (a.kind === 'border') { nb[a.between[0]].add(a.between[1]); nb[a.between[1]].add(a.between[0]); }

// ---- area on the sphere from the full-resolution outlines --------------------------------------------------------
feats.forEach((f) => { f.partAreas = f.polys.map(polyAreaKm2); f.area = f.partAreas.reduce((a, b) => a + b, 0); });

// ---- leave out small islands; the three largest parts of a country always stay ---------------------------------
feats.forEach((f) => {
  const order = f.partAreas.map((a, i) => [a, i]).sort((x, y) => y[0] - x[0]).map((x) => x[1]);
  const top = new Set(order.slice(0, 3));
  f.keep = f.shape.map((poly, i) => top.has(i) || f.partAreas[i] >= MIN_PART_KM2);
  f.keptShape = f.shape.filter((poly, i) => f.keep[i]);
});

// ---- simplify every used arc once; renumber --------------------------------------------------------------------------
const used = new Set();
for (const f of feats) for (const poly of f.keptShape) for (const ring of poly) for (const r of ring) used.add(r < 0 ? ~r : r);
const newIndex = new Map();
const outArcs = [];
let pointsOut = 0;
for (let i = 0; i < arcs.length; i++) {
  if (!used.has(i)) continue;
  const a = arcs[i];
  const closed = a.keys.length > 3 && a.keys[0] === a.keys[a.keys.length - 1];
  const s = closed ? simplifyClosed(a.pts, TOL) : simplify(a.pts, TOL);
  const enc = encode(s, closed);
  pointsOut += enc.length / 2;
  newIndex.set(i, outArcs.length);
  outArcs.push(enc);
}
const remap = (r) => (r < 0 ? ~newIndex.get(~r) : newIndex.get(r));
console.log('arcs kept', outArcs.length, 'points', pointsOut);

const coast = [], border = [];
for (const [i, j] of newIndex) {
  const a = arcs[i];
  if (a.kind === 'coast') coast.push(j);
  else if (a.kind === 'border') border.push(j, a.between[0], a.between[1]);
}

// ---------------------------------------------------------------- places ---------------------------------------------
const placesGeo = read('ne_10m_populated_places.geojson');
const CLS = { 'Admin-0 capital': 0, 'Admin-0 capital alt': 1, 'Admin-0 region capital': 2, 'Admin-1 capital': 3, 'Admin-1 region capital': 4, 'Populated place': 5, 'Populated Place': 5 };
const countryIdx = new Map(feats.map((f, i) => [f.props.ADM0_A3, i]));
const bboxes = feats.map((f) => {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const poly of f.polys) for (const p of poly[0]) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  return [x0, y0, x1, y1];
});
function countryAt(x, y) {
  for (let i = 0; i < feats.length; i++) {
    const b = bboxes[i];
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
    if (feats[i].polys.some((poly) => inPoly(x, y, poly))) return i;
  }
  return -1;
}
// the places name their country with ADM0_A3; a few country units use another code there (South Sudan: SSD/SDS)
const codeIdx = new Map(countryIdx);
feats.forEach((f, i) => { for (const k of [f.props.ISO_A3, f.props.ISO_A3_EH]) if (/^[A-Z]{3}$/.test(String(k || '')) && !codeIdx.has(k)) codeIdx.set(k, i); });
const tzList = [], tzIndex = new Map();
const places = placesGeo.features.map((f) => {
  const p = f.properties;
  const cls0 = p.FCLASS_DE || p.FEATURECLA;
  const lon = p.LONGITUDE ?? f.geometry.coordinates[0], lat = p.LATITUDE ?? f.geometry.coordinates[1];
  let c = countryAt(lon, lat);
  const own = codeIdx.has(p.ADM0_A3) ? codeIdx.get(p.ADM0_A3) : -1;
  if (c < 0) c = own;
  const tz = p.TIMEZONE || '';
  if (tz && !tzIndex.has(tz)) { tzIndex.set(tz, tzList.length); tzList.push(tz); }
  return {
    name: String(p.NAME || '').trim(), de: String(p.NAME_DE || '').trim(), en: String(p.NAME_EN || '').trim(), alt: String(p.NAMEALT || '').trim(),
    lon, lat, pop: Math.max(0, p.POP_MAX || 0), cls: CLS[cls0] ?? 6, c, own, a3: p.ADM0_A3,
    wd: p.WIKIDATAID || '', adm1: String(p.ADM1NAME || '').trim(), tz: tz ? tzIndex.get(tz) : -1, minZoom: p.MIN_ZOOM ?? 10,
  };
});
// Capitals. The national capital is the Admin-0 capital Natural Earth files under the country; dependencies (Greenland,
// Hong Kong, Puerto Rico …) have an Admin-0 region capital or, failing that, an Admin-1 capital. Where Natural Earth
// differs from the German-language Wikipedia, this table decides: the first name is the capital (null: none), the
// others are seats of further state institutions (government, parliament, courts). Places that end up neither are
// shown as regional capitals (Johannesburg, Yangon, Lagos, Hargeisa …).
const CAPITALS = {
  ZAF: ['Pretoria', 'Cape Town', 'Bloemfontein'], BOL: ['Sucre', 'La Paz'], CIV: ['Yamoussoukro', 'Abidjan'], MMR: ['Naypyidaw'],
  TZA: ['Dodoma', 'Dar es Salaam'], LKA: ['Sri Jayawardenepura Kotte', 'Colombo'], BEN: ['Porto-Novo', 'Cotonou'],
  NGA: ['Abuja'], PHL: ['Manila'], JPN: ['Tokyo'], ISR: ['Jerusalem'], MAR: ['Rabat'], SAH: [], PSX: [null, 'Ramallah'],
  MYS: ['Kuala Lumpur', 'Putrajaya'], NLD: ['Amsterdam', 'The Hague'], CHL: ['Santiago', 'Valparaíso'], SWZ: ['Mbabane', 'Lobamba'],
};
const capitalOf = feats.map(() => []), seatOf = feats.map(() => []);
const findPlace = (ci, name) => places.findIndex((pl) => (pl.own === ci || pl.c === ci) && (pl.name === name || pl.en === name));
feats.forEach((f, ci) => {
  const fixed = CAPITALS[f.props.ADM0_A3];
  if (fixed) {
    fixed.forEach((name, k) => {
      if (!name) return;
      const i = findPlace(ci, name);
      if (i < 0) { console.warn('capital not found', f.props.ADM0_A3, name); return; }
      (k === 0 ? capitalOf : seatOf)[ci].push(i);
    });
    return;
  }
  const all = places.map((pl, i) => [pl, i]);
  const byPop = (a, b) => b[0].pop - a[0].pop;
  let cand = all.filter(([pl]) => pl.cls === 0 && pl.own === ci);
  if (!cand.length) cand = all.filter(([pl]) => pl.cls === 2 && (pl.own === ci || pl.c === ci)).sort(byPop).slice(0, 1);
  if (!cand.length && f.props.HOMEPART !== 1 && f.props.TYPE !== 'Sovereign country') cand = all.filter(([pl]) => pl.cls === 3 && pl.own === ci).sort(byPop).slice(0, 1);
  if (cand.length) capitalOf[ci].push(cand[0][1]);
  for (const [, i] of cand.slice(1)) seatOf[ci].push(i);
  for (const [pl, i] of all) if (pl.cls === 1 && pl.own === ci && pl.c === ci) seatOf[ci].push(i);
});
const isCapital = new Set(capitalOf.flat()), isSeat = new Set(seatOf.flat());
places.forEach((pl, i) => { if ((pl.cls === 0 || pl.cls === 1) && !isCapital.has(i) && !isSeat.has(i)) pl.cls = 3; });
places.forEach((pl, i) => { if (isSeat.has(i)) pl.cls = 1; });

// order: capitals, then by population (the client relies on it for label priority); remember the new indices
const order = places.map((pl, i) => i).sort((a, b) => {
  const ca = isCapital.has(a) ? 0 : 1, cb = isCapital.has(b) ? 0 : 1;
  return ca - cb || places[b].pop - places[a].pop || places[a].name.localeCompare(places[b].name);
});
const placeNew = new Map(order.map((old, i) => [old, i]));
const rows = order.map((i) => {
  const pl = places[i];
  const de = pl.de && pl.de !== pl.name ? pl.de : 0, en = pl.en && pl.en !== pl.name ? pl.en : 0;
  return [pl.name, de, en, Math.round(pl.lon * 1000), Math.round(pl.lat * 1000), pl.pop, isCapital.has(i) ? 0 : pl.cls, pl.c, pl.wd || 0, pl.adm1 || 0, pl.tz, Math.round(pl.minZoom * 10), pl.alt || 0];
});

// ---------------------------------------------------------------- lakes and rivers -------------------------------------
const lakes = [];
for (const f of read('ne_50m_lakes.geojson').features) {
  const p = f.properties;
  if ((p.scalerank ?? 9) > 5) continue;
  for (const poly of polygonsOf(f.geometry)) {
    const outer = poly[0];
    if (ringAreaKm2(outer) < 280) continue;          // Lake Constance, Lake Geneva and Balaton stay
    const s = simplifyClosed([...outer, outer[0]], TOL);
    if (s.length >= 4) lakes.push(encode(s.slice(0, -1), true));
  }
}
const rivers = [];
for (const f of read('ne_50m_rivers_lake_centerlines.geojson').features) {
  const p = f.properties;
  const rank = p.scalerank ?? 9;
  if (rank > 5) continue;            // 'Lake Centerline' included: the Nile, the Vistula and the Mississippi run through lakes
  const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
  for (const line of lines) {
    const s = simplify(line.map((q) => [q[0], q[1]]), TOL * 1.5);
    if (s.length >= 2) rivers.push([rank, ...encode(s)]);
  }
}

// ---------------------------------------------------------------- Wikidata (CC0) -----------------------------------------
// Official languages, currencies and the official area are not part of Natural Earth. They come from Wikidata (CC0), one
// query per 40 countries; the answer is kept next to the Natural Earth files (wikidata-countries.json), so a second run
// needs no network (--refresh asks again).
async function wikidataFacts(qids) {
  const cache = path.join(SRC, 'wikidata-countries.json');
  if (fs.existsSync(cache) && !process.argv.includes('--refresh')) return JSON.parse(fs.readFileSync(cache, 'utf8'));
  const out = { fetched: new Date().toISOString().slice(0, 10), items: {} };
  const strip = (u) => String(u).replace('http://www.wikidata.org/entity/', '');
  for (let i = 0; i < qids.length; i += 40) {
    const batch = qids.slice(i, i + 40);
    const q = `SELECT ?item ?area ?lang ?langDe ?langEn ?cur ?code ?curDe ?curEn WHERE {
      VALUES ?item { ${batch.map((x) => 'wd:' + x).join(' ')} }
      OPTIONAL { ?item p:P2046 ?as . ?as a wikibase:BestRank ; psn:P2046/wikibase:quantityAmount ?area . }
      OPTIONAL { ?item p:P37 ?ls . ?ls a wikibase:BestRank ; ps:P37 ?lang .
        FILTER NOT EXISTS { ?ls pq:P582 ?le } FILTER NOT EXISTS { ?ls pq:P518 ?lp } FILTER NOT EXISTS { ?ls pq:P1001 ?lj }
        OPTIONAL { ?lang rdfs:label ?langDe FILTER(lang(?langDe) = 'de') } OPTIONAL { ?lang rdfs:label ?langEn FILTER(lang(?langEn) = 'en') } }
      OPTIONAL { ?item p:P38 ?cs . ?cs a wikibase:BestRank ; ps:P38 ?cur .
        FILTER NOT EXISTS { ?cs pq:P582 ?ce }
        OPTIONAL { ?cur wdt:P498 ?code } OPTIONAL { ?cur rdfs:label ?curDe FILTER(lang(?curDe) = 'de') } OPTIONAL { ?cur rdfs:label ?curEn FILTER(lang(?curEn) = 'en') } }
    }`;
    const r = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), { headers: { 'User-Agent': 'CozyShelves-worldmap-build/1.0 (offline map data for a personal library app)', Accept: 'application/sparql-results+json' } });
    if (!r.ok) throw new Error('Wikidata HTTP ' + r.status);
    const j = await r.json();
    for (const b of j.results.bindings) {
      const id = strip(b.item.value);
      const it = out.items[id] || (out.items[id] = { area: 0, lang: {}, cur: {} });
      if (b.area) it.area = Math.max(it.area, parseFloat(b.area.value) / 1e6);
      if (b.lang) it.lang[strip(b.lang.value)] = [b.langDe?.value || '', b.langEn?.value || ''];
      if (b.cur) it.cur[strip(b.cur.value)] = [b.code?.value || '', b.curDe?.value || '', b.curEn?.value || ''];
    }
    process.stdout.write(`wikidata ${Math.min(qids.length, i + 40)}/${qids.length}
`);
    await new Promise((res) => setTimeout(res, 1200));
  }
  fs.writeFileSync(cache, JSON.stringify(out));
  return out;
}

// The population of the cities: Natural Earth's POP_MAX mixes city and urban area (Mannheim 2.4 million, Munich
// 1.3 million); Wikidata has the official number of the municipality with its date. POP_MAX stays for the order in
// which the map labels cities, the card shows Wikidata's number when there is one.
async function wikidataPopulation(qids) {
  const cache = path.join(SRC, 'wikidata-places.json');
  if (fs.existsSync(cache) && !process.argv.includes('--refresh')) return JSON.parse(fs.readFileSync(cache, 'utf8'));
  const out = { fetched: new Date().toISOString().slice(0, 10), items: {} };
  const strip = (u) => String(u).replace('http://www.wikidata.org/entity/', '');
  for (let i = 0; i < qids.length; i += 350) {
    const batch = qids.slice(i, i + 350);
    const q = `SELECT ?item ?pop ?date WHERE { VALUES ?item { ${batch.map((x) => 'wd:' + x).join(' ')} }
      ?item p:P1082 ?ps . ?ps a wikibase:BestRank ; ps:P1082 ?pop . OPTIONAL { ?ps pq:P585 ?date } }`;
    let j = null;
    for (let attempt = 0; attempt < 3 && !j; attempt++) {
      const r = await fetch('https://query.wikidata.org/sparql', { method: 'POST', headers: { 'User-Agent': 'CozyShelves-worldmap-build/1.0 (offline map data for a personal library app)', Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'format=json&query=' + encodeURIComponent(q) });
      if (r.ok) j = await r.json(); else { console.warn('wikidata population HTTP', r.status); await new Promise((res) => setTimeout(res, 5000)); }
    }
    if (!j) throw new Error('Wikidata population query failed');
    for (const b of j.results.bindings) {
      const id = strip(b.item.value), pop = Math.round(parseFloat(b.pop.value)), year = b.date ? parseInt(b.date.value, 10) || 0 : 0;
      const cur = out.items[id];
      if (!(pop > 0)) continue;
      if (!cur || year > cur[1] || (year === cur[1] && pop > cur[0])) out.items[id] = [pop, year];
    }
    process.stdout.write(`wikidata population ${Math.min(qids.length, i + 350)}/${qids.length}
`);
    await new Promise((res) => setTimeout(res, 1500));
  }
  fs.writeFileSync(cache, JSON.stringify(out));
  return out;
}

(async () => {
const wd = await wikidataFacts([...new Set(feats.map((f) => f.props.WIKIDATAID).filter(Boolean))]);
const wdPop = await wikidataPopulation([...new Set(places.map((pl) => pl.wd).filter((q) => /^Q\d+$/.test(q)))]);
rows.forEach((r) => { const v = wdPop.items[r[8]]; r.push(v ? v[0] : 0, v ? v[1] : 0); });
// the official area when it describes the same territory (within 10 %; a small country's outline is too coarse to measure)
function areaOf(f) {
  const ne = f.area, w = wd.items[f.props.WIKIDATAID]?.area || 0;
  const round = (a) => (a < 100 ? Math.round(a * 100) / 100 : Math.round(a));
  if (w > 0 && (ne < 1000 ? w / Math.max(ne, 1e-3) < 50 : w / ne > 0.9 && w / ne < 1.1)) return [round(w), 'wd'];
  return [round(ne), 'ne'];
}
// [de, en] (languages) or [code, de, en] (currencies); an entry without any label is left out
const listOf = (obj) => Object.values(obj || {}).filter((v) => v.slice(-2).some(Boolean));

// ---------------------------------------------------------------- write --------------------------------------------------
const TYPE = { 'Sovereign country': 'sov', Country: 'country', Dependency: 'dep', Disputed: 'disp', Indeterminate: 'ind', Sovereignty: 'sov', 'Lease': 'lease' };
const code2 = (p) => [p.ISO_A2, p.ISO_A2_EH, p.WB_A2].find((v) => /^[A-Z]{2}$/.test(String(v || ''))) || '';
const code3 = (p) => [p.ISO_A3, p.ISO_A3_EH, p.ADM0_A3].find((v) => /^[A-Z]{3}$/.test(String(v || ''))) || '';
const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
const homeOf = new Map();
feats.forEach((f) => { if (f.props.HOMEPART === 1) homeOf.set(f.props.SOV_A3, f.props.ADM0_A3); });
const countries = feats.map((f, ci) => {
  const p = f.props;
  const type = TYPE[p.TYPE] || 'other';
  const home = homeOf.get(p.SOV_A3);
  return {
    id: p.ADM0_A3, iso2: code2(p), iso3: code3(p),
    de: p.NAME_DE || p.NAME, en: p.NAME_EN || p.NAME, formal: p.FORMAL_EN || 0,
    type, sov: (type === 'dep' || type === 'country') && p.HOMEPART !== 1 && home && home !== p.ADM0_A3 ? home : 0,
    cont: p.CONTINENT, sub: p.SUBREGION,
    pop: num(p.POP_EST), popY: num(p.POP_YEAR), gdp: num(p.GDP_MD), gdpY: num(p.GDP_YEAR),
    inc: parseInt(p.INCOME_GRP, 10) || 0, eco: parseInt(p.ECONOMY, 10) || 0,
    wd: p.WIKIDATAID || 0, area: areaOf(f)[0], areaSrc: areaOf(f)[1],
    lang: listOf(wd.items[p.WIKIDATAID]?.lang), cur: listOf(wd.items[p.WIKIDATAID]?.cur),
    lbl: [Math.round(p.LABEL_X * 100) / 100, Math.round(p.LABEL_Y * 100) / 100], lr: p.LABELRANK || 9, minL: p.MIN_LABEL ?? 5, maxL: p.MAX_LABEL ?? 10,
    mc: p.MAPCOLOR7 || 1,   // one of seven colours, neighbours never share one
    nb: [...nb[ci]].map((j) => feats[j].props.ADM0_A3).sort(),
    cap: capitalOf[ci].map((i) => placeNew.get(i)), seat: seatOf[ci].map((i) => placeNew.get(i)),
    shape: f.keptShape.map((poly) => poly.map((ring) => ring.map(remap))),
  };
});

// the point-of-view units (Palestine, Hong Kong, Guantanamo …) can share Natural Earth's colour with a neighbour:
// the smaller one takes a free colour
{
  const byId = new Map(countries.map((c) => [c.id, c]));
  for (const c of [...countries].sort((a, b) => a.area - b.area)) {
    const taken = new Set(c.nb.map((n) => byId.get(n)?.mc));
    if (taken.has(c.mc)) c.mc = [1, 2, 3, 4, 5, 6, 7].find((k) => !taken.has(k)) || c.mc;
  }
}

fs.mkdirSync(OUT, { recursive: true });
const world = {
  v: 1, q: Q,
  source: 'Natural Earth 1:10m Admin 0 Countries, German point of view (ne_10m_admin_0_countries_deu), simplified; 1:50m lakes and rivers. Public domain. Languages, currencies, official area: Wikidata (CC0), ' + wd.fetched + '.',
  arcs: outArcs, coast, border, countries, lakes, rivers,
};
const places_ = { v: 1, source: 'Natural Earth 1:10m Populated Places (public domain); population of the municipality: Wikidata (CC0), ' + wdPop.fetched + '.', fields: ['name', 'de', 'en', 'lon1000', 'lat1000', 'pop', 'cls', 'country', 'wikidata', 'region', 'tz', 'minZoom10', 'alt', 'popWd', 'popWdYear'], tz: tzList, rows };
fs.writeFileSync(path.join(OUT, 'world.json'), JSON.stringify(world));
fs.writeFileSync(path.join(OUT, 'places.json'), JSON.stringify(places_));
const size = (f) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + ' KB';
console.log('world.json', size('world.json'), 'places.json', size('places.json'));
console.log('coast arcs', coast.length, 'border arcs', border.length / 3, 'lakes', lakes.length, 'rivers', rivers.length, 'places', rows.length, 'time zones', tzList.length);
const noCap = countries.filter((c) => !c.cap.length).map((c) => c.id);
console.log('without capital', noCap.length, noCap.join(' '));
const show = (id) => { const c = countries.find((x) => x.id === id); console.log(id, c.de, 'area', c.area, c.areaSrc, 'nb', c.nb.join(','), 'cap', c.cap.map((i) => rows[i][1] || rows[i][0]).join('/'), 'seat', c.seat.map((i) => rows[i][1] || rows[i][0]).join('/'), 'lang', c.lang.map((l) => l[0]).join(','), 'cur', c.cur.map((x) => x[0] + ' ' + x[1]).join(',')); };
for (const id of ['DEU', 'FRA', 'UKR', 'RUS', 'SOM', 'CYP', 'JPN', 'BRA', 'USA', 'BOL', 'NLD', 'LSO', 'ZAF', 'KOS', 'SAH', 'MAR', 'ISR', 'PSX', 'GRL', 'VAT', 'ITA', 'SDS', 'FRO', 'PRI', 'TZA', 'MMR', 'CIV', 'NRU', 'HKG', 'TWN', 'CHN', 'IND', 'AUS', 'CAN', 'EGY']) if (countryIdx.has(id)) show(id);
console.log('places with a Wikidata population', rows.filter((r) => r[13] > 0).length, 'of', rows.length);
console.log('area from Wikidata', countries.filter((c) => c.areaSrc === 'wd').length, 'computed', countries.filter((c) => c.areaSrc === 'ne').map((c) => c.id).join(' '));
})().catch((e) => { console.error(e); process.exit(1); });
