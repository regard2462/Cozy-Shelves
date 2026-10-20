// World map data (app/data/worldmap, built by build/worldmap-data.js) and the projection shared by the panel
// "Weltkarte" and the wall map in the book room.
//
// Projection: Natural Earth I (Šavrič, Patterson, Jenny, Jenny 2011), a polynomial compromise projection.
// World coordinates are the projection's own units with y pointing down (x in ±2.7353, y in ±1.4219):
// the canvas maps them with one scale and one offset.
//
// The file is a topology: arcs (every border line once), countries as rings of arc references. Decoding
// projects every arc once; rings, Path2D objects and a coarser level of detail for the zoomed-out map are
// built from them, so neighbouring countries always share exactly the same line.

const DEG = Math.PI / 180;
export const WORLD_W = 2 * Math.PI * 0.8707;       // width of the projected world
export const WORLD_H = 2 * 1.4219;                 // height (pole line to pole line)

/** lon/lat in degrees → world [x, y] (y down). */
export function project(lon, lat) {
  const l = lon * DEG, p = lat * DEG, p2 = p * p, p4 = p2 * p2;
  const x = l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)));
  const y = p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)));
  return [x, -y];
}
/** world [x, y] → [lon, lat] in degrees, or null outside the map. */
export function unproject(x, y) {
  const yy = -y;
  if (Math.abs(yy) > 1.4219) return null;
  let p = yy;
  for (let i = 0; i < 12; i++) {
    const p2 = p * p, p4 = p2 * p2;
    const f = p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))) - yy;
    const d = 1.007226 + p2 * (3 * 0.015085 + p4 * (-7 * 0.044475 + 9 * 0.028874 * p2 - 11 * 0.005916 * p4));
    const step = f / d;
    p -= step;
    if (Math.abs(step) < 1e-10) break;
  }
  const p2 = p * p, p4 = p2 * p2;
  const k = 0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4));
  const l = x / k;
  if (Math.abs(l) > Math.PI + 1e-9) return null;
  return [l / DEG, p / DEG];
}

/** The outline of the projected world (meridians ±180°, pole lines), for the sea and the frame. */
export function outlinePoints(step = 2) {
  const pts = [];
  for (let lat = -90; lat <= 90; lat += step) pts.push(project(-180, lat));
  for (let lat = 90; lat >= -90; lat -= step) pts.push(project(180, lat));
  return pts;
}

/** Great-circle distance in km. */
export function distanceKm(lon1, lat1, lon2, lat2) {
  const a = Math.sin((lat2 - lat1) * DEG / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin((lon2 - lon1) * DEG / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ------------------------------------------------------------------------------------------------ loading --------
let loading = null;
/** Loads and decodes the map once per session (shared by the panel and the wall map). */
export function loadWorld() {
  if (!loading) {
    loading = (async () => {
      const get = async (f) => { const r = await fetch('./data/worldmap/' + f); if (!r.ok) throw new Error(f + ': HTTP ' + r.status); return r.json(); };
      const [w, p] = await Promise.all([get('world.json'), get('places.json')]);
      return decode(w, p);
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}

function decodeLine(enc, q) {
  const n = enc.length / 2;
  const out = new Float32Array(n * 2);
  let lon = 0, lat = 0;
  for (let i = 0; i < n; i++) {
    lon += enc[i * 2]; lat += enc[i * 2 + 1];
    const [x, y] = project(lon / q, lat / q);
    out[i * 2] = x; out[i * 2 + 1] = y;
  }
  return out;
}

/** Radial distance, then Douglas–Peucker in world units: the coarse level of detail of an arc. */
function coarsen(pts, tol) {
  const n = pts.length / 2;
  if (n <= 2) return pts;
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [0, n - 1];
  const t2 = tol * tol;
  while (stack.length) {
    const b = stack.pop(), a = stack.pop();
    const ax = pts[a * 2], ay = pts[a * 2 + 1], dx = pts[b * 2] - ax, dy = pts[b * 2 + 1] - ay, len2 = dx * dx + dy * dy;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i * 2] - ax, py = pts[i * 2 + 1] - ay;
      let d2;
      if (len2 < 1e-18) d2 = px * px + py * py;
      else { const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2)); const qx = px - t * dx, qy = py - t * dy; d2 = qx * qx + qy * qy; }
      if (d2 > best) { best = d2; bi = i; }
    }
    if (best > t2) { keep[bi] = 1; stack.push(a, bi, bi, b); }
  }
  // a closed arc (an island) keeps at least a triangle
  if (pts[0] === pts[(n - 1) * 2] && pts[1] === pts[(n - 1) * 2 + 1]) {
    let k = 0; for (let i = 0; i < n; i++) k += keep[i];
    if (k < 4) { keep[Math.floor(n / 3)] = 1; keep[Math.floor(2 * n / 3)] = 1; }
  }
  let m = 0; for (let i = 0; i < n; i++) if (keep[i]) m++;
  const out = new Float32Array(m * 2);
  for (let i = 0, j = 0; i < n; i++) if (keep[i]) { out[j++] = pts[i * 2]; out[j++] = pts[i * 2 + 1]; }
  return out;
}

/** A ring from arc references (~i = arc i reversed); the shared end point of consecutive arcs appears once. */
function ringFrom(refs, arcs) {
  let len = 0;
  for (const r of refs) len += arcs[r < 0 ? ~r : r].length / 2;
  const out = new Float32Array(len * 2);
  let j = 0;
  refs.forEach((r, k) => {
    const a = arcs[r < 0 ? ~r : r], n = a.length / 2;
    for (let s = 0; s < n; s++) {
      if (k > 0 && s === 0) continue;
      const i = r < 0 ? n - 1 - s : s;
      out[j++] = a[i * 2]; out[j++] = a[i * 2 + 1];
    }
  });
  return out.subarray(0, j);
}

function bboxOf(rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (let i = 0; i < r.length; i += 2) { const x = r[i], y = r[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}
const ringArea = (r) => { let s = 0; for (let i = 0, n = r.length / 2, k = n - 1; i < n; k = i++) s += r[k * 2] * r[i * 2 + 1] - r[i * 2] * r[k * 2 + 1]; return Math.abs(s / 2); };

/** Even-odd point test over all rings (the same rule the canvas fills with). */
export function inRings(rings, x, y) {
  let c = false;
  for (const r of rings) {
    const n = r.length / 2;
    for (let i = 0, k = n - 1; i < n; k = i++) {
      const xi = r[i * 2], yi = r[i * 2 + 1], xk = r[k * 2], yk = r[k * 2 + 1];
      if ((yi > y) !== (yk > y) && x < (xk - xi) * (y - yi) / (yk - yi) + xi) c = !c;
    }
  }
  return c;
}

export function pathOf(lines, closed) {
  const p = new Path2D();
  for (const r of lines) {
    if (r.length < 4) continue;
    p.moveTo(r[0], r[1]);
    for (let i = 2; i < r.length; i += 2) p.lineTo(r[i], r[i + 1]);
    if (closed) p.closePath();
  }
  return p;
}

function decode(w, p) {
  const q = w.q;
  const arcs = w.arcs.map((a) => decodeLine(a, q));
  const COARSE = 0.0032;           // ≈ 1 px on a window-wide map
  let coarseArcs = null;
  const coarse = () => coarseArcs || (coarseArcs = arcs.map((a) => coarsen(a, COARSE)));

  const countries = w.countries.map((c, index) => {
    const polys = c.shape.map((poly) => poly.map((ring) => ringFrom(ring, arcs)));
    const rings = polys.flat();
    const parts = polys.map((poly) => ({ rings: poly, bbox: bboxOf([poly[0]]), area: ringArea(poly[0]) }));
    const [lx, ly] = project(c.lbl[0], c.lbl[1]);
    return {
      ...c, index, rings, parts, bbox: bboxOf(rings), label: [lx, ly],
      path: null, coarsePath: null,
      coarseRings: () => c.shape.flatMap((poly) => poly.map((ring) => ringFrom(ring, coarse()))),
    };
  });
  const byId = new Map(countries.map((c) => [c.id, c]));

  const coastLines = w.coast.map((i) => arcs[i]);
  const borderLines = [];
  for (let i = 0; i < w.border.length; i += 3) borderLines.push({ line: arcs[w.border[i]], a: w.border[i + 1], b: w.border[i + 2], arc: w.border[i] });
  const lakes = w.lakes.map((l) => decodeLine(l, q));
  const rivers = w.rivers.map((r) => ({ rank: r[0], line: decodeLine(r.slice(1), q) }));

  const F = Object.fromEntries(p.fields.map((f, i) => [f, i]));
  const places = p.rows.map((r, index) => {
    const lon = r[F.lon1000] / 1000, lat = r[F.lat1000] / 1000;
    const [x, y] = project(lon, lat);
    return {
      index, name: r[F.name], de: r[F.de] || r[F.name], en: r[F.en] || r[F.name], alt: r[F.alt] || '',
      lon, lat, x, y, pop: r[F.pop], cls: r[F.cls], country: r[F.country], wd: r[F.wikidata] || '', region: r[F.region] || '',
      tz: r[F.tz] >= 0 ? p.tz[r[F.tz]] : '', minZoom: r[F.minZoom10] / 10,
      // the municipality's population from Wikidata (with its year) when known; pop is Natural Earth's estimate
      // for the urban area and decides which cities the map labels first
      popCity: r[F.popWd] || 0, popYear: r[F.popWdYear] || 0,
    };
  });
  const citiesOf = new Map();
  for (const pl of places) {
    if (pl.country < 0) continue;
    let list = citiesOf.get(pl.country);
    if (!list) citiesOf.set(pl.country, list = []);
    list.push(pl);
  }
  for (const list of citiesOf.values()) list.sort((a, b) => (b.popCity || b.pop) - (a.popCity || a.pop));

  return {
    q, source: w.source, arcs, countries, byId, places, citiesOf, lakes, rivers, coastLines, borderLines, coarse, coastArcs: w.coast,
    /** Path2D of a country, fine or coarse. */
    countryPath(c, fine = true) {
      if (fine) return c.path || (c.path = pathOf(c.rings, true));
      return c.coarsePath || (c.coarsePath = pathOf(c.coarseRings(), true));
    },
    /** The country under a world point (bounding boxes first, then the even-odd test). */
    countryAt(x, y) {
      let best = null;
      for (const c of countries) {
        const b = c.bbox;
        if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
        if (!inRings(c.rings, x, y)) continue;
        // an enclave lies inside its neighbour's outline as a hole: the smaller hit is the right one
        if (!best || (b[2] - b[0]) * (b[3] - b[1]) < (best.bbox[2] - best.bbox[0]) * (best.bbox[3] - best.bbox[1])) best = c;
      }
      return best;
    },
    /** The part of a country worth zooming to: its largest part plus the parts near it (France without Guiana). */
    focusBox(c) {
      const main = c.parts.reduce((a, b) => (b.area > a.area ? b : a), c.parts[0]);
      if (!main) return c.bbox;
      const [x0, y0, x1, y1] = main.bbox;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, reach = Math.max(0.02, Math.hypot(x1 - x0, y1 - y0)) * 0.9;
      let box = [x0, y0, x1, y1];
      for (const part of c.parts) {
        if (part === main) continue;
        const b = part.bbox, px = (b[0] + b[2]) / 2, py = (b[1] + b[3]) / 2;
        if (Math.hypot(px - cx, py - cy) > reach) continue;
        box = [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])];
      }
      return box;
    },
  };
}

// ------------------------------------------------------------------------------------------------ text helpers ----
/** Lower case without diacritics: "São Tomé" → "sao tome", "Straße" → "strasse". */
export function fold(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/đ/g, 'd').replace(/ł/g, 'l').replace(/ı/g, 'i').toLowerCase().replace(/[’'`´]/g, '').replace(/[-‐‑–—_.,/()]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Flag emoji from an ISO 3166-1 alpha-2 code ("" when there is none). */
export function flagOf(iso2) {
  if (!/^[A-Z]{2}$/.test(iso2 || '')) return '';
  return String.fromCodePoint(...[...iso2].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}
