// The garden as a place to walk in: the height of the ground, the lake and its shore, the paths, the jetty, where you
// may walk, what stands in the way and where animals may roam. Data and arithmetic only (no meshes, no materials):
// garden.js builds the scenery from it, layout.js places the benches, the player walks on it (world.js wires
// groundHeight and keepInside into player.js), the rain ends on it (environment.js), and every other module that needs
// the outside asks here (the OUTDOOR object at the end; garden.js re-exports it).
//
// Coordinates as everywhere in the world: metres, +x east, +z north (the glass front of the hall faces +z), y up.
import * as THREE from 'three';
import { seeded, clamp } from '../core/hash.js';

export const GROUND_Y = -0.1;                  // the lawn: 10 cm below the deck and the floors
/** The house as the garden sees it (layout.js: FACADE_Z = HALL.z1 + HALL.wall, the outer faces of the hall and the
 *  book room, TERRACE.deck; outdoor2-check compares them). The deck's top lies at y = 0, level with the floors. */
export const HOUSE = { front: 5.85, hallX: 8.85, roomX: 11.35, back: -23.95, deck: { x0: -8.8, x1: 8.8, z0: 5.85, z1: 9.7 } };

const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** Length of (x, z) (Math.hypot is several times slower, and the ground asks for every vertex). */
const len2 = (x, z) => Math.sqrt(x * x + z * z);

// ---------------------------------------------------------------- the lake ---------------------------------------
/** An oval pond west of the path; `level` is the water surface. Its shore is not a perfect ellipse (shoreScale). */
export const LAKE = { x: -36, z: 47, rx: 25, rz: 15, level: GROUND_Y - 0.5 };
export const WATER_Y = LAKE.level;
// The functions the ground asks for every vertex read plain numbers, not the objects' fields: reading those, V8 threw
// away its optimized terrainHeight again and again ("insufficient type feedback", over a million times while the
// garden was built), and every call took ten times as long.
const LX = LAKE.x, LZ = LAKE.z, LRX = LAKE.rx, LRZ = LAKE.rz;
/** How far the shore lies from the centre in a direction (1 = the ellipse): small bays and points. */
export function shoreScale(a) { return 1 + 0.05 * Math.sin(2 * a + 0.7) + 0.035 * Math.sin(3 * a + 2.1) + 0.02 * Math.sin(7 * a + 4.0); }
/** 0 at the lake's centre, 1 at its shore (where the ground meets the water), > 1 on land. */
export function lakeDist(x, z) {
  const u = (x - LX) / LRX, v = (z - LZ) / LRZ;
  return len2(u, v) / shoreScale(Math.atan2(v, u));
}
/** The hollow of the lake below the lawn: a gentle bank up to 0.35 beyond the shore, a shallow shelf, then deeper. */
function lakeDip(lk) {
  if (lk >= 1.35) return 0;
  if (lk >= 1) { const u = (lk - 1) / 0.35; return 0.5 * (1 - u) * (1 - u); }
  const w = 1 - lk;
  return 0.5 + Math.min(4, 2.86 * w + 4 * w * w);
}

// ---------------------------------------------------------------- the ground ---------------------------------------
// the house with the terrace and the lawn in front of it: no hills, no trees
const KEEP_X0 = -17, KEEP_X1 = 17, KEEP_Z0 = -32, KEEP_Z1 = 24;
export const keepDist = (x, z) => len2(Math.max(0, KEEP_X0 - x, x - KEEP_X1), Math.max(0, KEEP_Z0 - z, z - KEEP_Z1));
// thirty hills (x, z, height, radius), flat in one array: terrainHeight runs through them for every vertex of the ground
const HILLS = (() => {
  const r = seeded(77), out = new Float64Array(30 * 4);
  for (let i = 0; i < 30; i++) {
    const a = r() * Math.PI * 2, d = 45 + r() * 170;
    out.set([Math.cos(a) * d, Math.sin(a) * d, 1.5 + r() * 6.5, 30 + r() * 60], i * 4);
  }
  return out;
})();
/** Smooth value noise (about -1 … 1) on a 1 m lattice, for the small humps of the shore. */
const NOISE = (() => { const r = seeded(91), t = new Float32Array(256); for (let i = 0; i < 256; i++) t[i] = r() * 2 - 1; return t; })();
function noiseAt(i, j) { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return NOISE[(h ^ (h >>> 16)) & 255]; }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = noiseAt(xi, zi), b = noiseAt(xi + 1, zi), c = noiseAt(xi, zi + 1), d = noiseAt(xi + 1, zi + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
/** The middle of the pebble beach beside the jetty (where the jetty leaves the shore, see JETTY). */
const BEACH_X = -20.8, BEACH_Z = 36.3;
/** A low rise at the edge of the meadow with a bench on top: the view over the lake. */
export const KNOLL = { x: 14.5, z: 43, h: 2.1, r: 13 };
const KNOLL_X = KNOLL.x, KNOLL_Z = KNOLL.z, KNOLL_R = KNOLL.r, KNOLL_H = KNOLL.h;
function knoll(x, z) { const d = len2(x - KNOLL_X, z - KNOLL_Z); if (d >= KNOLL_R) return 0; const c = Math.cos((d / KNOLL_R) * Math.PI / 2); return KNOLL_H * c * c; }

/** Height of the ground: the lawn at GROUND_Y, hills further out, the knoll, the hollow of the lake, higher land far off. */
export function terrainHeight(x, z) {
  let h = 0;
  for (let i = 0; i < HILLS.length; i += 4) {
    const dx = x - HILLS[i], dz = z - HILLS[i + 1], hr = HILLS[i + 3];
    if (dx > hr || dx < -hr || dz > hr || dz < -hr) continue;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < hr) { const c = Math.cos((d / hr) * Math.PI / 2); h += HILLS[i + 2] * c * c; }
  }
  const r = len2(x, z);
  h += smooth(80, 210, r) * 12;                        // the land rises towards the horizon
  const lk = lakeDist(x, z);
  h *= Math.pow(smooth(4, 64, keepDist(x, z)), 1.4) * smooth(1.05, 1.9, lk);
  h += knoll(x, z);
  // small humps and hollows along the waterline: the shore wanders a little instead of drawing a clean curve
  // (not on the beach beside the jetty: a smooth slope into the water there)
  if (lk > 0.82 && lk < 1.3) h += (0.07 * vnoise(x * 0.31, z * 0.31) + 0.035 * vnoise(x * 0.9 + 17, z * 0.9 + 5)) * smooth(0.82, 0.95, lk) * (1 - smooth(1.12, 1.3, lk)) * smooth(4, 9, len2(x - BEACH_X, z - BEACH_Z));
  return GROUND_Y + h - lakeDip(lk);
}

// ---------------------------------------------------------------- the jetty and the paths --------------------------
/** The first point from `p` along `d` where the ground reaches the water (bisection on the way out). */
function waterlineAlong(p, d, max = 30) {
  let a = 0, b = max;
  for (let i = 0; i < 40; i++) { const t = (a + b) / 2; if (terrainHeight(p[0] + d[0] * t, p[1] + d[1] * t) > LAKE.level) a = t; else b = t; }
  return [p[0] + d[0] * a, p[1] + d[1] * a];
}
/**
 * The jetty: a walk of boards from the end of the gravel path out over the water, a wider platform at its end with a
 * bench that looks over the lake. `root` lies on land, `dir` points out over the water; `top` is the height of the
 * boards. Its outline (`corners`) is part of the walkable area.
 */
export const JETTY = (() => {
  const d = new THREE.Vector2(-3.6, 2.4).normalize(), dir = [d.x, d.y];
  const shore = waterlineAlong([-14.5, 32.1], dir);
  const root = [shore[0] - dir[0] * 2.4, shore[1] - dir[1] * 2.4];
  const len = 10.5, width = 1.7, platLen = 3.2, platWidth = 3.4;
  const top = Math.max(LAKE.level + 0.44, terrainHeight(root[0], root[1]) + 0.08);
  const side = [dir[1], -dir[0]];                      // to the right, looking out over the water
  const at = (along, across) => [root[0] + dir[0] * along + side[0] * across, root[1] + dir[1] * along + side[1] * across];
  const end = at(len, 0);
  // the outline, counter-clockwise seen from above with +z up: right side out, round the platform, left side back
  const corners = [at(0, width / 2), at(len - platLen, width / 2), at(len - platLen, platWidth / 2), at(len, platWidth / 2), at(len, -platWidth / 2), at(len - platLen, -platWidth / 2), at(len - platLen, -width / 2), at(0, -width / 2)];
  return { root, dir, side, shore, len, width, platLen, platWidth, top, end, at, corners, yaw: Math.atan2(dir[0], dir[1]) };
})();
/** True on the boards of the jetty (or its platform). */
export function onJetty(x, z) {
  const J = JETTY, rx = x - J.root[0], rz = z - J.root[1];
  const along = rx * J.dir[0] + rz * J.dir[1], across = Math.abs(rx * J.side[0] + rz * J.side[1]);
  if (along < 0 || along > J.len) return false;
  return across <= (along > J.len - J.platLen ? J.platWidth : J.width) / 2;
}

// the gravel path from the terrace down to the jetty
export const PATH = new THREE.CatmullRomCurve3([[0, 9.75], [0.2, 12.5], [-1.4, 17], [-4.4, 22.5], [-8.6, 27.5], [-12.6, 30.6], [JETTY.root[0] - JETTY.dir[0] * 1.6, JETTY.root[1] - JETTY.dir[1] * 1.6], [JETTY.root[0] + JETTY.dir[0] * 0.4, JETTY.root[1] + JETTY.dir[1] * 0.4]].map(([x, z]) => new THREE.Vector3(x, 0, z)));
export const PATH_SAMPLES = PATH.getSpacedPoints(90);
const boxOf = (pts) => pts.reduce((b, p) => [Math.min(b[0], p.x), Math.max(b[1], p.x), Math.min(b[2], p.z), Math.max(b[3], p.z)], [Infinity, -Infinity, Infinity, -Infinity]);
const PATH_BOX = boxOf(PATH_SAMPLES);
function distTo(samples, box, x, z) {
  // far from the path's box the box distance is enough (the ground asks for every vertex)
  const bx = Math.max(box[0] - x, 0, x - box[1]), bz = Math.max(box[2] - z, 0, z - box[3]);
  if (bx > 8 || bz > 8) return len2(bx, bz);
  let best = Infinity; for (const p of samples) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < best) best = d; } return Math.sqrt(best);
}
/** Distance to the middle of the gravel path. */
export function pathDist(x, z) { return distTo(PATH_SAMPLES, PATH_BOX, x, z); }
/**
 * Trodden trails through the grass: from the gravel path across the meadow up to the bench on the knoll, along the
 * edge of the wood to the north shore, and back along the east shore to the jetty.
 */
export const TRAILS = [
  [[-1.2, 15.2], [2.4, 20.5], [6.4, 26.6], [9.6, 33.0], [11.4, 39.0], [11.0, 44.4]],
  [[11.0, 44.4], [8.6, 49.0], [3.4, 52.4], [-3.5, 54.0], [-9.0, 53.2]],
  [[-9.0, 53.2], [-9.6, 48.0], [-10.6, 42.5], [-13.2, 37.6], [JETTY.root[0] + 1.2, JETTY.root[1] - 0.4]],
].map((pts) => new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z))));
const TRAIL_SAMPLES = TRAILS.flatMap((c) => c.getSpacedPoints(Math.ceil(c.getLength() / 0.6)));
const TRAIL_BOX = boxOf(TRAIL_SAMPLES);
/** Distance to the nearest trodden trail. */
export function trailDist(x, z) { return distTo(TRAIL_SAMPLES, TRAIL_BOX, x, z); }

/** What you stand on: the deck (level with the floors), the boards of the jetty, else the ground. */
export function groundHeight(x, z) {
  const D = HOUSE.deck;
  // the deck, and the doorway in the glass front behind it: level with the floors
  if (x >= D.x0 && x <= D.x1 && z >= D.z0 - 0.45 && z <= D.z1) return 0;
  if (onJetty(x, z)) return JETTY.top;
  return terrainHeight(x, z);
}

// ---------------------------------------------------------------- benches ------------------------------------------
/** The benches outside (layout.js places them as seats; world.js builds them): on the jetty's platform looking over the
 *  lake, and on the knoll looking back over the meadow to the lake and the house. `rot`: the bench faces local +z. */
export const BENCHES = (() => {
  const J = JETTY, p = J.at(J.len - J.platLen / 2 - 0.35, 0);
  const kx = KNOLL.x + 0.4, kz = KNOLL.z + 0.3;
  return [
    { id: 'jettybench', x: p[0], z: p[1], y: J.top, rot: J.yaw, label: { de: 'Bank am Steg', en: 'Bench on the jetty' } },
    { id: 'knollbench', x: kx, z: kz, y: terrainHeight(kx, kz), rot: -1.72, label: { de: 'Bank auf dem Hügel', en: 'Bench on the hill' } },
  ];
})();

// ---------------------------------------------------------------- the fire bowl -------------------------------------
/** A forged fire bowl on the lawn west of the path, between the house and the lake (firebowl.js builds it), with four
 *  log stumps round it to sit on (layout.js places them as seats; each faces the bowl, the first one looks past it over
 *  the lake). `y`: the ground under the bowl, `r`: what the bowl keeps clear; `view`: where the place "Feuerschale"
 *  stands, looking at it. */
export const FIREBOWL = (() => {
  const x = -16.4, z = 19.6, y = terrainHeight(x, z), sit = 1.85;
  const lake = Math.atan2(LAKE.z - z, LAKE.x - x);
  const compass = (dx, dz) => (Math.abs(dz) > Math.abs(dx) ? (dz > 0 ? ['Nord', 'north'] : ['Süd', 'south']) : dx > 0 ? ['Ost', 'east'] : ['West', 'west']);
  const seats = [0, 1, 2, 3].map((k) => {
    const a = lake + Math.PI + k * Math.PI / 2 + 0.12, sx = x + Math.cos(a) * sit, sz = z + Math.sin(a) * sit;
    const [de, en] = compass(sx - x, sz - z);
    return { id: 'firestump' + (k + 1), x: sx, z: sz, y: terrainHeight(sx, sz), rot: Math.atan2(x - sx, z - sz), seed: 3 + k * 7, label: { de: `Baumstumpf am Feuer (${de})`, en: `Stump by the fire (${en})` } };
  });
  const va = lake + Math.PI + Math.PI / 4 + 0.12, vx = x + Math.cos(va) * 3.4, vz = z + Math.sin(va) * 3.4;
  return { x, z, y, r: 0.5, seats, view: { x: vx, z: vz, yaw: Math.atan2(vx - x, vz - z) } };
})();

// ---------------------------------------------------------------- the walkable area --------------------------------
/** A point on the shore in direction `a` from the lake's centre (on the ellipse's own scale), where the ground lies
 *  `above` metres over the water. */
export function shorePoint(a, above = 0.0) {
  const cu = Math.cos(a), cv = Math.sin(a);
  let lo = 0.6, hi = 1.6;
  for (let i = 0; i < 36; i++) {
    const m = (lo + hi) / 2, x = LAKE.x + cu * m * LAKE.rx, z = LAKE.z + cv * m * LAKE.rz;
    if (terrainHeight(x, z) > LAKE.level + above) hi = m; else lo = m;
  }
  const m = (lo + hi) / 2;
  return [LAKE.x + cu * m * LAKE.rx, LAKE.z + cv * m * LAKE.rz];
}
/** The angle of a point as seen from the lake's centre (the same scale as shorePoint). */
export const lakeAngle = (x, z) => Math.atan2((z - LAKE.z) / LAKE.rz, (x - LAKE.x) / LAKE.rx);
const deg = Math.PI / 180;

/**
 * Where you can walk outside, one polygon (counter-clockwise, [x, z]): the deck and the lawn in front of the glass
 * front, the meadow up to the fence in the east and the edge of the wood in the north, the knoll, the east and south
 * shore of the lake with the jetty, and back along the shrubs in the west. Everywhere else a natural limit stands at
 * its edge: the house, hedges, the fence, the undergrowth of the wood, the water.
 */
// the outline of the walkable area beside the house, along the fence in the east, along the edge of the wood in the
// north and along the shrubs in the west (the shore lies between the north and the west part)
export const EAST_EDGE = [[9.05, 6.2], [16.5, 6.45], [24.6, 7.4], [26.4, 10.5], [27.0, 20], [27.2, 31], [26.8, 41], [25.4, 49.5]];
export const NORTH_EDGE = [[25.4, 49.5], [21.5, 53.6], [14.5, 55.6], [6.5, 57.0], [-1.5, 57.8], [-7.5, 58.6]];
export const WEST_EDGE = [[-33.5, 29.6], [-30.5, 25.2], [-27.4, 19.0], [-23.6, 13.4], [-18.5, 8.6], [-13.0, 6.45], [-9.05, 6.2]];
export const REGION = (() => {
  // first the hall: its glass front and doors hold you there, so the edge runs inside it, out of the way of the doorway
  const pts = [[-8.8, 4.0], [8.8, 4.0], ...EAST_EDGE, ...NORTH_EDGE.slice(1)];
  // the shore from the north-east round the east bay to the south, with the jetty, then along the south shore
  const jettyA = lakeAngle(JETTY.root[0] + JETTY.dir[0] * 3, JETTY.root[1] + JETTY.dir[1] * 3);
  const span = 6.5 * deg;                              // the shore points left out where the jetty leaves the land
  // (it starts where the edge of the wood meets the water: no sharp corner there)
  const a0 = lakeAngle(...NORTH_EDGE[NORTH_EDGE.length - 1]) - 3 * deg, a1 = -84 * deg;
  const shore = [];
  let jetty = false;
  for (let a = a0; a > a1; a -= 2 * deg) {
    if (Math.abs(a - jettyA) < span) continue;
    if (a < jettyA - span && !jetty) { jetty = true; shore.push(...JETTY.corners); }
    shore.push(shorePoint(a, 0.0));
  }
  pts.push(...shore, ...WEST_EDGE);
  return pts;
})();
/** A line moved sideways by d (to the right of its direction: outwards for the outline of the walkable area). */
function offsetLine(line, d) {
  return line.map((p, i) => {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = len2(dx, dz) || 1;
    return [p[0] + (dz / l) * d, p[1] - (dx / l) * d];
  });
}
/** A band along a line between the offsets d0 and d1 (a polygon). */
const band = (line, d0, d1) => [...offsetLine(line, d0), ...offsetLine(line, d1).reverse()];
/** The fence along the meadow in the east, 40 cm beyond the edge of the walkable area. */
export const FENCE_LINE = offsetLine(EAST_EDGE.slice(2), 0.4);
const REGION_MID = [2, 30];   // well inside: the way back for a point that lies exactly on the edge
const REGION_BOX = (() => { const b = [Infinity, -Infinity, Infinity, -Infinity]; for (const [x, z] of REGION) { b[0] = Math.min(b[0], x); b[1] = Math.max(b[1], x); b[2] = Math.min(b[2], z); b[3] = Math.max(b[3], z); } return b; })();

/** Inside polygon `poly` ([[x, z], …])? (Even-odd rule.) */
export function inPolygon(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
/** The nearest point on the outline of `poly` to (x, z): [px, pz, distance]. */
function nearestOnOutline(poly, x, z) {
  let best = Infinity, bx = 0, bz = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [cx, cz] = poly[i];
    const ex = cx - ax, ez = cz - az, l2 = ex * ex + ez * ez || 1e-9;
    const t = clamp(((x - ax) * ex + (z - az) * ez) / l2, 0, 1);
    const px = ax + ex * t, pz = az + ez * t, d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < best) { best = d; bx = px; bz = pz; }
  }
  return [bx, bz, Math.sqrt(best)];
}
// A coarse grid over the walkable area for quick answers (the garden asks for every blade of grass): the signed distance
// to the edge at each cell's middle, inside positive. A cell further inside or outside than its half diagonal needs no
// exact test.
const RG = (() => {
  const s = 1.5, x0 = REGION_BOX[0] - 2, z0 = REGION_BOX[2] - 2, nx = Math.ceil((REGION_BOX[1] - x0 + 2) / s), nz = Math.ceil((REGION_BOX[3] - z0 + 2) / s);
  const d = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + (i + 0.5) * s, z = z0 + (j + 0.5) * s;
    d[j * nx + i] = (inPolygon(REGION, x, z) ? 1 : -1) * nearestOnOutline(REGION, x, z)[2];
  }
  return { s, x0, z0, nx, nz, d, half: s * 0.7072 };
})();
/** Outside the house (beyond the facade line) the walkable area applies; inside, the walls do. */
export const outside = (x, z) => z > HOUSE.front - 0.4;
/** True where you may walk outside (with `r` metres to spare to the edge). */
export function inRegion(x, z, r = 0) {
  if (x < REGION_BOX[0] || x > REGION_BOX[1] || z < REGION_BOX[2] || z > REGION_BOX[3]) return false;
  const i = Math.floor((x - RG.x0) / RG.s), j = Math.floor((z - RG.z0) / RG.s), dc = RG.d[j * RG.nx + i];
  if (dc + RG.half < 0) return false;
  if (dc - RG.half >= Math.max(r, 0)) return true;
  if (!inPolygon(REGION, x, z)) return false;
  return r <= 0 || nearestOnOutline(REGION, x, z)[2] >= r;
}

// ---------------------------------------------------------------- trees and other obstacles ------------------------
/** Trunk radius at the foot (with the flare of the roots) per metre of scale, and how far the lowest branches reach out
 *  around the stem (spruces wear a skirt of branches down to the ground, a shrub is a ball of leaves). */
const STEM = { beech: 0.35, oak: 0.44, birch: 0.21, spruce: 0.35, pine: 0.32, bush: 0.05, fruit: 0.24 };
const SKIRT = { spruce: 1.25, bush: 1.0 };

/**
 * Where the trees stand ([{ x, z, sp, variant, scale, rot }]): groups framing the lawn, birches on the shore, solitary
 * trees on the meadow, the edge of the wood with its undergrowth along the walkable area, hedges beside the house and
 * the wood on the hills all round. Deterministic.
 */
export const TREES = (() => {
  const rnd = seeded(2031), out = [];
  const near = (x, z, gap) => out.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < gap * gap);
  // the hall, the passage and the book room with a margin
  const houseLot = (x, z, m) => (Math.abs(x) < HOUSE.hallX + m && z < HOUSE.front + m && z > -HOUSE.front - m) || (Math.abs(x) < 2.1 + m && z < -5.5 && z > -9.2) || (Math.abs(x) < HOUSE.roomX + m && z < -8.85 + m && z > HOUSE.back - m);
  /** inside: a solitary tree on the walkable area (2.2 m clear of its edge); else it stands beyond the edge by
   *  `margin`. keep: not on the lawn round the house either (the wood). */
  const free = (x, z, gap = 3.2, { inside = false, margin = 2.5, keep = false } = {}) => {
    if (houseLot(x, z, 1.5) || (keep && keepDist(x, z) < 1.5)) return false;
    if (lakeDist(x, z) < 1.12) return false;
    if (pathDist(x, z) < 3.0 || trailDist(x, z) < 2.0 || onJetty(x, z)) return false;
    if (len2(x - JETTY.root[0], z - JETTY.root[1]) < 6) return false;
    for (const b of BENCHES) if (len2(x - b.x, z - b.z) < 3.2) return false;
    if (len2(x - FIREBOWL.x, z - FIREBOWL.z) < 4.5) return false;
    if (inside) { if (!inRegion(x, z, 2.2)) return false; }
    else if (inPolygon(REGION, x, z) || nearestOnOutline(REGION, x, z)[2] < margin) return false;
    return !near(x, z, gap);
  };
  const add = (x, z, sp, gap, opts) => { if (!free(x, z, gap, opts)) return false; out.push({ x, z, sp, variant: Math.floor(rnd() * 2), scale: 0.85 + rnd() * 0.3, rot: rnd() * Math.PI * 2 }); return true; };
  // solitary trees on the walkable area: an old oak and a group on the meadow, birches on the east shore, a pine beside
  // the knoll (they get colliders, the others stand beyond the edge)
  for (const [x, z, sp] of [[8.5, 31.5, 'oak'], [21.0, 18.5, 'oak'], [23.2, 25.6, 'birch'], [19.4, 14.2, 'beech'], [-3.4, 37.0, 'birch'], [-0.6, 40.4, 'birch'], [-12.2, 41.2, 'birch'], [-14.6, 53.2, 'birch'], [18.9, 46.2, 'pine'], [-22.3, 29.0, 'birch']]) add(x, z, sp, 2.5, { inside: true });
  // groups framing the lawn
  const groups = [[-24, 21, 6, ['beech', 'oak', 'birch']], [31, 17, 6, ['oak', 'birch', 'beech']], [32, 38, 6, ['spruce', 'spruce', 'birch']], [21, -12, 4, ['beech', 'spruce']], [-22, -16, 4, ['oak', 'birch']], [0, -44, 5, ['spruce', 'beech', 'pine']]];
  for (const [cx, cz, n, sps] of groups) for (let i = 0, tries = 0; i < n && tries < 60; tries++) if (add(cx + (rnd() - 0.5) * 11, cz + (rnd() - 0.5) * 11, sps[Math.floor(rnd() * sps.length)], 4.2)) i++;
  // birches along the far shores of the lake
  for (let i = 0, tries = 0; i < 12 && tries < 120; tries++) {
    const a = rnd() * Math.PI * 2, r = 1.18 + rnd() * 0.3;
    if (add(LAKE.x + Math.cos(a) * LAKE.rx * r, LAKE.z + Math.sin(a) * LAKE.rz * r, rnd() < 0.7 ? 'birch' : 'beech', 4)) i++;
  }
  // the edge of the wood just beyond the walkable area in the north and east: trees close together, shrubs in front
  const along = (line, step, fn) => {
    for (let k = 0; k < line.length - 1; k++) {
      const a = line[k], b = line[k + 1], dx = b[0] - a[0], dz = b[1] - a[1], len = len2(dx, dz), nx = dz / len, nz = -dx / len;
      for (let s = rnd() * step; s < len; s += step * (0.75 + rnd() * 0.5)) fn(a[0] + dx * s / len, a[1] + dz * s / len, nx, nz);
    }
  };
  along(NORTH_EDGE, 3.6, (x, z, nx, nz) => {
    const d = 4.5 + rnd() * 3.5; add(x + nx * d, z + nz * d, ['beech', 'spruce', 'oak', 'birch', 'spruce'][Math.floor(rnd() * 5)], 3.4);
    const e = 1.4 + rnd() * 0.9; add(x + nx * e, z + nz * e, 'bush', 2.0, { margin: 1.1 });
  });
  along(EAST_EDGE.slice(3), 4.4, (x, z, nx, nz) => {
    const d = 5 + rnd() * 4; add(x + nx * d, z + nz * d, ['spruce', 'beech', 'oak', 'spruce'][Math.floor(rnd() * 4)], 3.6);
    if (rnd() < 0.55) { const e = 2.2 + rnd() * 1.2; add(x + nx * e, z + nz * e, 'bush', 2.2, { margin: 1.6 }); }
  });
  // hedges beside the house and shrubs along the west side
  along(EAST_EDGE.slice(0, 3), 1.8, (x, z, nx, nz) => add(x + nx * 1.35, z + nz * 1.35, 'bush', 1.6, { margin: 0.8 }));
  along(WEST_EDGE.slice(4), 1.8, (x, z, nx, nz) => add(x + nx * 1.35, z + nz * 1.35, 'bush', 1.6, { margin: 0.8 }));
  along(WEST_EDGE.slice(0, 5), 2.2, (x, z, nx, nz) => {
    const e = 1.4 + rnd() * 0.7; add(x + nx * e, z + nz * e, 'bush', 1.8, { margin: 1.0 });
    if (rnd() < 0.6) { const d = 4.5 + rnd() * 4; add(x + nx * d, z + nz * d, ['beech', 'oak', 'birch'][Math.floor(rnd() * 3)], 3.6); }
  });
  // the wood round the clearing: close to the walkable area, thinning out further away
  for (let i = 0; i < 2400; i++) {
    const x = -50 + rnd() * 100, z = -4 + rnd() * 92;
    const d = inPolygon(REGION, x, z) ? 0 : nearestOnOutline(REGION, x, z)[2];
    if (d < 4 || rnd() > 1.15 - d / 30) continue;
    const q = rnd();
    add(x, z, q < 0.34 ? 'spruce' : q < 0.58 ? 'beech' : q < 0.74 ? 'oak' : q < 0.88 ? 'birch' : 'pine', 3.9, { keep: true });
  }
  // the wood: mixed near the garden, darker firs and pines further out
  for (let i = 0; i < 3600 && out.length < 520; i++) {
    const a = rnd() * Math.PI * 2, r = 34 + Math.pow(rnd(), 0.8) * 118;
    const x = Math.cos(a) * r, z = Math.sin(a) * r + 6;
    const far = r > 75, q = rnd();
    const sp = far ? (q < 0.55 ? 'spruce' : q < 0.72 ? 'pine' : q < 0.9 ? 'beech' : 'oak') : (q < 0.3 ? 'beech' : q < 0.48 ? 'oak' : q < 0.66 ? 'birch' : q < 0.88 ? 'spruce' : 'pine');
    add(x, z, sp, far ? 4.4 : 4.6, { keep: true });
  }
  // fruit trees on the lawn west of the path, seen from the hall's glass front: blossom in spring, apples in autumn
  // (seasons.js; added last, so the wood above stays as it was)
  for (const [x, z] of [[-9.2, 14.8], [-12.9, 11.2], [-21.8, 21.4], [-11.8, 25.8]]) add(x, z, 'fruit', 2.5, { inside: true });
  for (const t of out) t.r = (SKIRT[t.sp] || STEM[t.sp] || 0.3) * t.scale;
  return out;
})();

/** Things you cannot walk through on the walkable area: [{ x, z, r }] (trunks, shrubs, the stones on the shore are
 *  added by addObstacle). In 8 m cells for the lookups of the player and the animals. */
export const OBSTACLES = [];
const CELL = 8, cells = new Map();
const cellKey = (i, j) => i * 4096 + j;
export function addObstacle(x, z, r, what = 'stone') {
  const o = { x, z, r, what };
  OBSTACLES.push(o);
  const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL), j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = cellKey(i, j); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(o); }
  return o;
}
for (const t of TREES) if (inPolygon(REGION, t.x, t.z) || nearestOnOutline(REGION, t.x, t.z)[2] < 4) addObstacle(t.x, t.z, t.r, t.sp);

// the benches: three circles along each (1.6 m long, 0.6 m deep)
for (const b of BENCHES) for (const k of [-0.5, 0, 0.5]) addObstacle(b.x + Math.cos(b.rot) * k, b.z - Math.sin(b.rot) * k, 0.33, 'bench');

// ---------------------------------------------------------------- the feeding station ------------------------------
/**
 * The feeding station on the meadow east of the lawn (feeder.js builds it, layout.js places it, wildlife.js lets the
 * deer eat there): a hay rack with a gable roof and a trough under it, and a salt lick on a post beside it. Seen from the
 * terrace and the east part of the glass front. Some 16 m south of it stands a small open-fronted hide with a bench,
 * facing the rack. Local frames: the rack's long axis is its local x (turned by `rot` about y, as three.js turns it: local
 * x → (cos rot, −sin rot)), the hide looks along its local +z.
 *   rack      { len, half (half its depth), hay [bottom, top] (the hay between the slats), trough (the trough's rim height) }
 *   salt      the salt lick post in the rack's frame [x, z], its height and the block on it
 *   at(x, z)  a point of the rack's frame → [x, z] in the world
 *   hide      { x, z, y, rot, w, d }, view: the place in the Orte menu (standing in front of the hide, looking at the rack)
 */
export const FEEDER = (() => {
  const x = 20.0, z = 30.0, hx = 25.0, hz = 14.6;
  // the rack's axis points at the hide, turned a little: from there you see its gable end and the deer on both sides
  const toHide = Math.atan2(-(hz - z), hx - x), rot = toHide + 0.3;
  const c = Math.cos(rot), s = Math.sin(rot);
  const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  const hideRot = Math.atan2(x - hx, z - hz);          // the hide's local +z towards the rack
  const vx = hx + Math.sin(hideRot) * 0.9, vz = hz + Math.cos(hideRot) * 0.9;
  return {
    x, z, rot, y: terrainHeight(x, z), at,
    rack: { len: 1.7, half: 0.45, hay: [0.62, 1.2], trough: 0.45 },
    salt: { at: [1.55, -2.05], h: 0.68, block: 0.11 },
    hide: { x: hx, z: hz, y: terrainHeight(hx, hz), rot: hideRot, w: 2.3, d: 1.5 },
    view: { x: vx, z: vz, yaw: Math.atan2(-(x - vx), -(z - vz)) },
  };
})();
// the rack (with the trough under it and the roof's posts) and the salt lick's post; the hide as a whole (you sit down
// on its bench from the meadow in front of it, as on the other benches)
for (const lx of [-0.56, 0, 0.56]) { const [ox, oz] = FEEDER.at(lx, 0); addObstacle(ox, oz, 0.56, 'feeder'); }
{ const [ox, oz] = FEEDER.at(...FEEDER.salt.at); addObstacle(ox, oz, 0.14, 'feeder'); }
{
  const H = FEEDER.hide, c = Math.cos(H.rot), s = Math.sin(H.rot);
  for (const lx of [-0.75, 0, 0.75]) for (const lz of [-0.4, 0.2]) addObstacle(H.x + lx * c + lz * s, H.z - lx * s + lz * c, 0.42, 'hide');
}
// the fire bowl and the stumps round it (firebowl.js)
addObstacle(FIREBOWL.x, FIREBOWL.z, FIREBOWL.r, 'firebowl');
for (const s of FIREBOWL.seats) addObstacle(s.x, s.z, 0.25, 'stump');

/** The pebble beach beside the jetty (1 on the beach, 0 away from it): only near the water. */
export function beachWeight(x, z) {
  const d = len2(x - JETTY.shore[0], z - JETTY.shore[1]);
  if (d > 7) return 0;
  const above = terrainHeight(x, z) - LAKE.level;
  return (1 - smooth(3.0, 6.5, d)) * (1 - smooth(0.22, 0.5, above));
}

/**
 * Stones ([{ x, z, s (size in m), sink (how far into the ground), seed, pebble }]): pebbles on the beach beside the
 * jetty, boulders along the shore (some in the shallow water), a few on the meadow and on the knoll. The bigger ones on
 * the walkable area are obstacles.
 */
export const STONES = (() => {
  const rnd = seeded(4711), out = [];
  const clear = (x, z, gap) => !onJetty(x, z) && pathDist(x, z) > 1.1 && trailDist(x, z) > 0.9
    && BENCHES.every((b) => len2(x - b.x, z - b.z) > 2.0) && out.every((s) => len2(s.x - x, s.z - z) > gap + s.s * 0.5)
    && len2(x - JETTY.root[0], z - JETTY.root[1]) > 1.4 && obstaclesNear(x, z, 0.4).length === 0;
  // pebbles: on the beach, from the wet sand into the shallow water
  for (let i = 0; i < 900 && out.length < 240; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 8, x = JETTY.shore[0] + Math.cos(a) * r, z = JETTY.shore[1] + Math.sin(a) * r;
    const above = terrainHeight(x, z) - LAKE.level;
    if (above < -0.18 || above > 0.4 || beachWeight(x, z) < 0.3 || !clear(x, z, 0.05)) continue;
    const s = 0.05 + Math.pow(rnd(), 2.2) * 0.13;
    out.push({ x, z, s, sink: s * 0.35, seed: i, pebble: true });
  }
  // boulders along the shore: the walkable east and south shore and the far shores
  for (let i = 0, n = 0; i < 400 && n < 34; i++) {
    const a = rnd() * Math.PI * 2, [sx, sz] = shorePoint(a, 0), dx = sx - LAKE.x, dz = sz - LAKE.z, l = len2(dx, dz);
    const off = -1.4 + rnd() * 2.8, x = sx + dx / l * off, z = sz + dz / l * off;
    if (beachWeight(x, z) > 0.05 || !clear(x, z, 2.2)) continue;
    const s = 0.3 + Math.pow(rnd(), 1.6) * 0.75;
    out.push({ x, z, s, sink: s * 0.3, seed: 1000 + i }); n++;
    if (rnd() < 0.5) {   // often a smaller one beside it
      const b = rnd() * Math.PI * 2, x2 = x + Math.cos(b) * s * 0.9, z2 = z + Math.sin(b) * s * 0.9;
      if (clear(x2, z2, 0.1)) out.push({ x: x2, z: z2, s: s * (0.35 + rnd() * 0.3), sink: s * 0.12, seed: 2000 + i });
    }
  }
  // a few on the meadow, on the knoll and at the edge of the wood
  for (const [x, z, s] of [[12.6, 41.0, 0.55], [17.6, 41.6, 0.4], [16.0, 46.6, 0.7], [3.5, 46.0, 0.45], [22.8, 33.0, 0.6], [-6.5, 50.5, 0.5], [-26.5, 27.5, 0.65], [-14.8, 12.5, 0.4]]) if (clear(x, z, 1)) out.push({ x, z, s, sink: s * 0.3, seed: Math.round(x * 31 + z) });
  for (const s of out) if (!s.pebble && s.s > 0.32 && (inPolygon(REGION, s.x, s.z) || nearestOnOutline(REGION, s.x, s.z)[2] < 2)) addObstacle(s.x, s.z, s.s * 0.45, 'stone');
  return out;
})();
/** The obstacles whose circle comes within `r` of (x, z). */
export function obstaclesNear(x, z, r = 0) {
  const out = [];
  const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL), j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const o of cells.get(cellKey(i, j)) || []) if (!out.includes(o) && (o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + r) ** 2) out.push(o);
  return out;
}

/**
 * Keep a walker of radius `r` on the walkable area: `p` ({ x, z }, changed in place) is pushed out of trunks and back
 * inside the edge. Only outside the house (the walls hold inside). Returns true when it had to move it.
 */
export function keepInside(p, r) {
  if (!outside(p.x, p.z)) return false;
  let moved = false;
  for (let iter = 0; iter < 10; iter++) {
    let again = false;
    for (const o of obstaclesNear(p.x, p.z, r)) {
      const dx = p.x - o.x, dz = p.z - o.z, d = len2(dx, dz), min = o.r + r;
      if (d >= min) continue;
      if (d < 1e-6) { p.x += min; continue; }
      p.x = o.x + dx / d * min; p.z = o.z + dz / d * min; again = true;
    }
    const inside = inPolygon(REGION, p.x, p.z);
    const [cx, cz, d] = nearestOnOutline(REGION, p.x, p.z);
    if (inside && d >= r - 1e-6) { if (!again) break; moved = true; continue; }
    // back inside: to the nearest point of the edge, then r further in
    let nx = inside ? p.x - cx : cx - p.x, nz = inside ? p.z - cz : cz - p.z;
    const nl = len2(nx, nz);
    if (nl < 1e-9) { nx = REGION_MID[0] - p.x; nz = REGION_MID[1] - p.z; const m = len2(nx, nz) || 1; nx /= m; nz /= m; } else { nx /= nl; nz /= nl; }
    p.x = cx + nx * r; p.z = cz + nz * r; moved = true;
  }
  return moved;
}
/** True when a walker of radius `r` fits at (x, z) outside: on the walkable area and clear of every obstacle. */
export function freeOutside(x, z, r) {
  if (!outside(x, z)) return true;
  if (!inRegion(x, z, r)) return false;
  return obstaclesNear(x, z, r).length === 0;
}

// ---------------------------------------------------------------- zones for animals --------------------------------
/** The lake's outline at the waterline (counter-clockwise, 2° steps). */
export const LAKE_OUTLINE = (() => { const out = []; for (let a = -Math.PI; a < Math.PI; a += 2 * deg) out.push(shorePoint(a, 0)); return out; })();
/**
 * Where animals may roam ([[x, z], …] polygons). None of them overlaps the house or the deck.
 *   meadow      the open meadow in the north-east of the walkable area (people walk there too)
 *   forestEdge  a band along the edge of the wood beyond the fence and the undergrowth, north and east
 *   farShore    the west and north shore of the lake, beyond the water as seen from the jetty
 *   clearing    the open land south-west of the lake, beyond the shrubs in the west
 */
export const ZONES = (() => {
  // the far shore: from the north round the west to the south-west, between 0.8 and 13 m from the water
  const inner = [], outer = [];
  for (let a = 58 * deg; a <= 262 * deg; a += 4 * deg) {
    const [x, z] = shorePoint(a, 0.1), dx = x - LAKE.x, dz = z - LAKE.z, l = len2(dx, dz);
    inner.push([x + dx / l * 0.8, z + dz / l * 0.8]); outer.push([x + dx / l * 13, z + dz / l * 13]);
  }
  return {
    walkable: REGION,
    lake: LAKE_OUTLINE,
    meadow: [[4, 22], [24, 12], [25.2, 46], [16, 52.5], [2, 52], [-4, 44]],
    forestEdge: band([...EAST_EDGE.slice(3), ...NORTH_EDGE.slice(1)], 1.4, 15),
    farShore: [...inner, ...outer.reverse()],
    clearing: band(WEST_EDGE.slice(0, 5), 3, 16),
  };
})();
/** Inside zone `name` (a key of ZONES)? */
export function inZone(name, x, z) { const poly = ZONES[name]; return !!poly && inPolygon(poly, x, z); }
/** A random point in zone `name` that is on dry land and clear of obstacles by `r`; null after 200 tries. */
export function randomPointInZone(name, rnd = Math.random, r = 0.5) {
  const poly = ZONES[name]; if (!poly) return null;
  const b = boxOf(poly.map(([x, z]) => ({ x, z })));
  for (let i = 0; i < 200; i++) {
    const x = b[0] + rnd() * (b[1] - b[0]), z = b[2] + rnd() * (b[3] - b[2]);
    if (!inPolygon(poly, x, z) || terrainHeight(x, z) < LAKE.level + 0.03 || obstaclesNear(x, z, r).length) continue;
    return { x, z, y: terrainHeight(x, z) };
  }
  return null;
}

/**
 * Everything above in one object, the stable interface for other modules (the animals, effects); garden.js re-exports
 * it. Metres, +x east, +z north, y up.
 *   terrainHeight(x, z) → y of the ground (the lake bed under the water)
 *   groundHeight(x, z)  → y of what a person stands on: the deck (0), the jetty's boards, else the ground
 *   waterY              the lake's surface;  isWater(x, z) → true over the lake;  lakeDist(x, z) → 0 middle … 1 shore … >1 land
 *   outside(x, z)       true beyond the glass front (where the walkable area applies)
 *   inRegion(x, z, r?)  on the walkable area (with r metres to its edge);  freeOutside(x, z, r) → and clear of obstacles
 *   keepInside(p, r)    pushes { x, z } back onto the walkable area and out of the obstacles (the player uses it)
 *   obstacles           [{ x, z, r, what }] trunks, shrubs, big stones, benches, posts on and round the walkable area
 *   obstaclesNear(x, z, r) → the obstacles whose circle comes within r of (x, z)
 *   zones               polygons [[x, z], …]: walkable, lake, meadow (inside the walkable area), forestEdge, farShore,
 *                       clearing (outside it); inZone(name, x, z); randomPointInZone(name, rnd?, r?) → { x, y, z } | null
 *   trees [{ x, z, sp, scale, r }], stones [{ x, z, s }], benches [{ id, x, z, y, rot }], lake { x, z, rx, rz, level },
 *   house { front, hallX, roomX, back, deck }, jetty { root, dir, len, top, corners, at(along, across) },
 *   knoll { x, z, h, r }, fence [[x, z], …] (the split-rail fence along the meadow in the east), pathDist(x, z),
 *   trailDist(x, z)
 *   feeder              the feeding station on the meadow and the hide facing it (FEEDER above)
 */
export const OUTDOOR = {
  terrainHeight, groundHeight, waterY: WATER_Y,
  isWater: (x, z) => lakeDist(x, z) < 1.3 && terrainHeight(x, z) < LAKE.level,
  inRegion, outside, freeOutside, keepInside, obstacles: OBSTACLES, obstaclesNear,
  zones: ZONES, inZone, randomPointInZone,
  trees: TREES, stones: STONES, lake: LAKE, house: HOUSE, jetty: JETTY, knoll: KNOLL, benches: BENCHES, fence: FENCE_LINE,
  pathDist, trailDist, lakeDist,
  feeder: FEEDER,
};
// the fire bowl west of the lawn: { x, z, y, r, seats [{ id, x, z, y, rot }], view } (firebowl.js)
OUTDOOR.firebowl = FIREBOWL;
