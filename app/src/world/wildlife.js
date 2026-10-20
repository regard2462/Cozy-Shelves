// Wild animals in the garden: roe deer (a doe with her fawn, one or two does), a red deer stag, a fox and, rarely, a
// wolf step out of the wood, graze on the meadows and go back. They come where somebody can see them: on the meadow in
// front of the hall's glass front and the terrace, at the feeding station on the meadow (outdoor.js FEEDER), where the
// deer eat hay from the rack, from the trough under it and lick the salt, and on the lawn round the book room, in sight
// of its windows (wildlife-views.js). How often is a setting (settings.wildlifeRate): 'often' (several groups out at
// once, in different places, a new one soon after one has left), 'normal', or 'rare' (the scheduler of 0.6: one group
// now and then). Most at dawn and dusk, fewer at night (foxes, deer at the edge of the wood), weather lowers the rate
// a little, a storm much. They keep to open ground (a path grid round the trees, the lake, the house, the lawn by the
// terrace and the feeder) and stand on the terrain. When you come out and walk up to them they look up and may step
// away; come too close and a deer trots off briskly (never a gallop; a fox as well) to open ground a little way off,
// where you still see it, slows down, stops, looks back and calms down; its visit goes on at other places, away from
// you, and ends when it was meant to. Only a group you chase a third time within a few minutes, or one you corner,
// leaves for the wood. Behind the glass, or sitting still in the hide, you do not bother them. The wolf watches you a
// while and then walks away. Their models (wildlife-models.js) are built on idle frames before the first visit.
import * as THREE from 'three';
import { terrainHeight, OUTDOOR } from './garden.js';
import { TERRACE, FACADE_Z, ROOM } from './layout.js';
import { sunPosition } from './environment.js';
import { NATURE } from './nature.js';
import { seasonOf } from './season.js';
import { createAnimal, prepareSpecies, prewarmMesh, applyPose, legOffsets, COAT_LIST, reachFor, setNightLook } from './wildlife-models.js';
import { houseViews, lookingOut, WINDOW_SIDES } from './wildlife-views.js';
import { clamp, lerp, smoothstep } from './geo.js';

const TAU = Math.PI * 2;
const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const rand = (a, b) => a + Math.random() * (b - a);
const V3 = (x, z) => new THREE.Vector3(x, 0, z);
/** Pick from `list` with probability proportional to weight(item). */
function weighted(list, weight) {
  const w = list.map(weight), sum = w.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
  return list[list.length - 1];
}

/**
 * The garden as the animals know it: the only place here that reads garden.js and layout.js, so a changed outdoor area
 * only changes this function. The garden's shape comes from outdoor.js (OUTDOOR, re-exported by garden.js).
 *   height(x, z)   ground height (m)
 *   blocked(x, z)  no animal stands here: near a trunk or shrub (`clearance` m added), near a big stone, a bench, the
 *                  feeding station, the hide or the fence along the meadow, in the lake or on its wet shore, at the
 *                  jetty, at the house (2.4 m round its walls), on the terrace or the mown lawn in front of it
 *   bounds         the area of the path grid: the garden north of the house and the lawn and the wood round the book room
 *   meadow(x, z)   the meadow on the walkable area (OUTDOOR zone 'meadow')
 *   hide           what hides an animal from somebody at a window ({ x, z, r }: shrubs, the low branches of spruces,
 *                  trunks, the feeding station and the hide)
 *   indoors(p)     the player is in the house: the animals take no notice of him
 */
export function wildlifeGround(world, clearance = 1.1) {
  const trees = world.env?.garden?.trees || OUTDOOR.trees;
  // trees in 8 m cells; an animal walks round the trunk, the low branches of a spruce, the heart of a shrub (between
  // two shrubs it pushes through their outer twigs, as deer do in a hedge: the row of shrubs along the meadow has
  // gaps for them)
  const CELL = 8, cells = new Map(), key = (i, j) => i * 4096 + j;
  for (const t of trees) {
    const r = t.sp === 'bush' ? 0.6 * t.scale + clearance * 0.5 : (t.sp === 'spruce' ? 2.6 : 0.45) * t.scale + clearance;
    for (let i = Math.floor((t.x - r) / CELL); i <= Math.floor((t.x + r) / CELL); i++) for (let j = Math.floor((t.z - r) / CELL); j <= Math.floor((t.z + r) / CELL); j++) {
      const k = key(i, j); if (!cells.has(k)) cells.set(k, []); cells.get(k).push({ x: t.x, z: t.z, r });
    }
  }
  const J = OUTDOOR.jetty, fence = OUTDOOR.fence, near = clearance * 0.5, F = OUTDOOR.feeder;
  const A = TERRACE.area, H = OUTDOOR.house, lawn = { x0: A.x0 - 4.5 - near, x1: A.x1 + 4.5 + near, z0: -H.front, z1: A.z1 + 4.5 + near };
  // the hall, the passage and the book room, some 2 m round their walls
  const m = 1.9 + near, inHouse = (x, z) => (Math.abs(x) < H.hallX + m && z < H.front + m && z > -H.front - m) || (Math.abs(x) < 2.1 + m && z < -5.5 && z > -9.2) || (Math.abs(x) < H.roomX + m && z < -8.85 + m && z > H.back - m);
  const byFence = (x, z, d) => {
    for (let i = 0; i < fence.length - 1; i++) {
      const [ax, az] = fence[i], [bx, bz] = fence[i + 1], ex = bx - ax, ez = bz - az;
      const t = clamp(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez), 0, 1), dx = ax + ex * t - x, dz = az + ez * t - z;
      if (dx * dx + dz * dz < d * d) return true;
    }
    return false;
  };
  const SOLID = new Set(['stone', 'bench', 'post', 'hide']);
  // the feeding station as it stands (the player keeps out of a wider ring, outdoor.js): the rack with its trough, a
  // rectangle in its own frame, and the post of the salt lick. Deer stand right at the trough to eat.
  const fc = F ? Math.cos(F.rot) : 1, fs = F ? Math.sin(F.rot) : 0, [sx, sz] = F ? F.at(...F.salt.at) : [0, 0];
  const atFeeder = (x, z, pad) => {
    if (!F) return false;
    const dx = x - F.x, dz = z - F.z, lx = dx * fc - dz * fs, lz = dx * fs + dz * fc;
    if (Math.abs(lx) < F.rack.len / 2 + 0.1 + pad && Math.abs(lz) < F.rack.half + 0.08 + pad) return true;
    return (x - sx) ** 2 + (z - sz) ** 2 < (0.1 + pad) ** 2;
  };
  const hide = trees.filter((t) => Math.abs(t.x) < 95 && t.z > -100 && t.z < 110).map((t) => ({ x: t.x, z: t.z, r: (t.sp === 'bush' ? 1.6 : t.sp === 'spruce' ? 2.8 : 0.45) * t.scale }));
  if (F) hide.push({ x: F.x, z: F.z, r: 0.7 }, { x: F.hide.x, z: F.hide.z, r: 1.1 });
  return {
    height: terrainHeight,
    blocked(x, z) {
      if (inHouse(x, z)) return true;
      if (x > lawn.x0 && x < lawn.x1 && z > lawn.z0 && z < lawn.z1) return true;   // the terrace and the mown lawn
      // the jetty with its foot on the shore (outdoor.js JETTY: root on land, dir out over the water)
      const jx = x - J.root[0], jz = z - J.root[1], along = jx * J.dir[0] + jz * J.dir[1], across = Math.abs(jx * J.side[0] + jz * J.side[1]);
      if (along > -2 && along < J.len + 1 && across < (along > J.len - J.platLen ? J.platWidth : J.width) / 2 + 1.2) return true;
      if (byFence(x, z, 0.4 + near)) return true;                           // the split-rail fence along the meadow
      const list = cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (list) for (const t of list) if ((t.x - x) ** 2 + (t.z - z) ** 2 < t.r * t.r) return true;
      for (const o of OUTDOOR.obstaclesNear(x, z, near)) if (SOLID.has(o.what)) return true;
      if (atFeeder(x, z, near)) return true;
      return terrainHeight(x, z) < OUTDOOR.waterY + 0.1;                     // the lake and its wet shore
    },
    bounds: { x0: -72, x1: 72, z0: -84, z1: 100 },
    meadow: (x, z) => OUTDOOR.inZone('meadow', x, z),
    hide,
    indoors: (p) => p.z < FACADE_Z - 0.05,
  };
}

// ---------------------------------------------------------------- the path grid ---------------------------------------
const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/** Small binary min-heap of (index, priority). */
class Heap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(key, pri) { const k = this.k, p = this.p; let i = k.length; k.push(key); p.push(pri); while (i > 0) { const up = (i - 1) >> 1; if (p[up] <= pri) break; k[i] = k[up]; p[i] = p[up]; i = up; } k[i] = key; p[i] = pri; }
  pop() {
    const k = this.k, p = this.p, top = k[0], lk = k.pop(), lp = p.pop();
    if (k.length) { let i = 0; const n = k.length; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && p[c + 1] < p[c]) c++; if (p[c] >= lp) break; k[i] = k[c]; p[i] = p[c]; i = c; } k[i] = lk; p[i] = lp; }
    return top;
  }
}
/** Free and blocked metres of the garden (1 m cells), its connected regions, A* paths and lines of sight. Built a few
 *  rows per frame (build() returns true when it is done). */
class Field {
  constructor(G, cell = 1) {
    const { x0, x1, z0, z1 } = G.bounds;
    this.G = G; this.x0 = x0; this.z0 = z0; this.cell = cell;
    this.w = Math.ceil((x1 - x0) / cell); this.h = Math.ceil((z1 - z0) / cell);
    this.blocked = new Uint8Array(this.w * this.h); this.row = 0; this.ready = false;
  }
  build(rows = 1e9) {
    const { w, h, cell } = this;
    for (let n = 0; n < rows && this.row < h; n++, this.row++) {
      const j = this.row;
      for (let i = 0; i < w; i++) if (i === 0 || j === 0 || i === w - 1 || j === h - 1 || this.G.blocked(this.x0 + (i + 0.5) * cell, this.z0 + (j + 0.5) * cell)) this.blocked[j * w + i] = 1;
    }
    if (this.row < h) return false;
    // connected regions: the big ones are the garden and the lawn round the house (pockets between trees are left out)
    const region = this.region = new Int32Array(w * h).fill(-1), stack = [], sizes = [];
    let id = 0;
    for (let s = 0; s < w * h; s++) {
      if (this.blocked[s] || region[s] >= 0) continue;
      let n = 0; region[s] = id; stack.push(s);
      while (stack.length) {
        const cur = stack.pop(), ci = cur % w, cj = (cur - ci) / w; n++;
        for (const [di, dj] of NB) if (this.#step(ci, cj, di, dj)) { const k = (cj + dj) * w + ci + di; if (region[k] < 0) { region[k] = id; stack.push(k); } }
      }
      sizes.push(n); id++;
    }
    this.big = Uint8Array.from(sizes, (n) => (n >= 300 ? 1 : 0));
    this.ready = true;
    return true;
  }
  #step(i, j, di, dj) { return this.freeCell(i + di, j + dj) && (!di || !dj || (this.freeCell(i + di, j) && this.freeCell(i, j + dj))); }
  freeCell(i, j) { return i >= 0 && j >= 0 && i < this.w && j < this.h && !this.blocked[j * this.w + i]; }
  ci(x) { return Math.floor((x - this.x0) / this.cell); }
  cj(z) { return Math.floor((z - this.z0) / this.cell); }
  free(x, z) { return this.freeCell(this.ci(x), this.cj(z)); }
  /** The connected region of (x, z), or −1. */
  regionAt(x, z) { const i = this.ci(x), j = this.cj(z); return this.freeCell(i, j) ? this.region[j * this.w + i] : -1; }
  /** Free and in one of the big regions. */
  open(x, z) { const r = this.regionAt(x, z); return r >= 0 && !!this.big[r]; }
  /** The nearest open point within `r` metres (or null). */
  nearestOpen(x, z, r = 3) {
    if (this.open(x, z)) return new THREE.Vector3(x, 0, z);
    for (let d = 1; d <= r; d++) for (let a = 0; a < 8 * d; a++) {
      const t = (a / (8 * d)) * TAU, px = x + Math.cos(t) * d, pz = z + Math.sin(t) * d;
      if (this.open(px, pz)) return new THREE.Vector3(px, 0, pz);
    }
    return null;
  }
  /** Every cell the segment touches is free (a supercover walk). */
  lineFree(ax, az, bx, bz) {
    const c = this.cell; let i = this.ci(ax), j = this.cj(az); const ie = this.ci(bx), je = this.cj(bz);
    if (!this.freeCell(i, j)) return false;
    const dx = bx - ax, dz = bz - az, si = Math.sign(dx), sj = Math.sign(dz);
    const tdx = si ? c / Math.abs(dx) : Infinity, tdz = sj ? c / Math.abs(dz) : Infinity;
    let tx = si ? ((si > 0 ? this.x0 + (i + 1) * c - ax : ax - (this.x0 + i * c)) / Math.abs(dx)) : Infinity;
    let tz = sj ? ((sj > 0 ? this.z0 + (j + 1) * c - az : az - (this.z0 + j * c)) / Math.abs(dz)) : Infinity;
    let guard = Math.abs(ie - i) + Math.abs(je - j) + 4;
    while ((i !== ie || j !== je) && guard-- > 0) {
      if (Math.min(tx, tz) > 1) break;
      if (Math.abs(tx - tz) < 1e-9) { if (!this.freeCell(i + si, j) || !this.freeCell(i, j + sj)) return false; i += si; j += sj; tx += tdx; tz += tdz; }
      else if (tx < tz) { i += si; tx += tdx; } else { j += sj; tz += tdz; }
      if (!this.freeCell(i, j)) return false;
    }
    return this.freeCell(ie, je);
  }
  /** The length of the way (m, over the cells) from a to every cell up to `maxD` away (Infinity further, or where it
   *  cannot go): Dijkstra. */
  flood(a, maxD = 100) {
    const { w } = this, n = w * this.h, d = new Float32Array(n).fill(Infinity), done = new Uint8Array(n), heap = new Heap();
    const ai = this.ci(a.x), aj = this.cj(a.z);
    if (!this.freeCell(ai, aj)) return d;
    d[aj * w + ai] = 0; heap.push(aj * w + ai, 0);
    while (heap.size) {
      const cur = heap.pop();
      if (done[cur]) continue;
      done[cur] = 1;
      if (d[cur] > maxD) break;
      const ci = cur % w, cj = (cur - ci) / w;
      for (const [di, dj] of NB) {
        if (!this.#step(ci, cj, di, dj)) continue;
        const k = (cj + dj) * w + ci + di, nd = d[cur] + (di && dj ? 1.4142 : 1) * this.cell;
        if (nd < d[k]) { d[k] = nd; heap.push(k, nd); }
      }
    }
    return d;
  }
  /** A walkable polyline from a to b (both open, in the same region), or null: A* over the cells, then pulled straight
   *  where it can. `avoid` ([{ x, z, r }]): places to keep away from (other groups; those at a or b do not count).
   *  `budget`: give up after so many cells (a way that is not there costs no more than that). */
  path(a, b, avoid = null, budget = Infinity) {
    const { w } = this, si = this.ci(a.x), sj = this.cj(a.z), gi = this.ci(b.x), gj = this.cj(b.z);
    if (!this.open(a.x, a.z) || !this.open(b.x, b.z) || this.regionAt(a.x, a.z) !== this.regionAt(b.x, b.z)) return null;
    const keep = avoid?.filter((q) => Math.hypot(q.x - a.x, q.z - a.z) > q.r + 1 && Math.hypot(q.x - b.x, q.z - b.z) > q.r + 1);
    const away = keep?.length ? (k) => { const ki = k % w, x = this.x0 + (ki + 0.5) * this.cell, z = this.z0 + ((k - ki) / w + 0.5) * this.cell; for (const q of keep) if ((q.x - x) ** 2 + (q.z - z) ** 2 < q.r * q.r) return true; return false; } : null;
    const clearOf = (p, q) => !keep?.length || keep.every((o) => segDist(o, p, q) > o.r * 0.8);
    const start = sj * w + si, goal = gj * w + gi, n = w * this.h;
    if (!this.g || this.g.length !== n) { this.g = new Float32Array(n); this.prev = new Int32Array(n); this.closed = new Uint8Array(n); }
    const g = this.g.fill(Infinity), prev = this.prev.fill(-1), closed = this.closed.fill(0), heap = new Heap();
    const hc = (k) => { const ki = k % w, kj = (k - ki) / w, dx = Math.abs(ki - gi), dz = Math.abs(kj - gj); return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz); };
    g[start] = 0; heap.push(start, hc(start));
    let found = start === goal, spent = 0;
    while (heap.size && !found) {
      const cur = heap.pop(); if (closed[cur]) continue; closed[cur] = 1;
      if (cur === goal) { found = true; break; }
      if (++spent > budget) break;
      const ci = cur % w, cj = (cur - ci) / w;
      for (const [di, dj] of NB) {
        if (!this.#step(ci, cj, di, dj)) continue;
        const k = (cj + dj) * w + ci + di; if (closed[k] || (away && away(k))) continue;
        const ng = g[cur] + (di && dj ? 1.4142 : 1);
        if (ng < g[k]) { g[k] = ng; prev[k] = cur; heap.push(k, ng + hc(k)); }
      }
    }
    if (!found) return null;
    const cells = []; for (let k = goal; k >= 0; k = prev[k]) { cells.push(k); if (k === start) break; }
    cells.reverse();
    const pts = [new THREE.Vector3(a.x, 0, a.z)];
    for (let k = 1; k < cells.length - 1; k++) { const ci = cells[k] % w; pts.push(new THREE.Vector3(this.x0 + (ci + 0.5) * this.cell, 0, this.z0 + ((cells[k] - ci) / w + 0.5) * this.cell)); }
    pts.push(new THREE.Vector3(b.x, 0, b.z));
    // string pulling
    const out = [pts[0]]; let i = 0;
    while (i < pts.length - 1) { let j = pts.length - 1; while (j > i + 1 && !(this.lineFree(pts[i].x, pts[i].z, pts[j].x, pts[j].z) && clearOf(pts[i], pts[j]))) j--; out.push(pts[j]); i = j; }
    return out;
  }
}

// ---------------------------------------------------------------- the animals ------------------------------------------
// distances (m) at which a kind looks up at a player outside and at which it walks or trots off
const SHY = { roe: [24, 14], fawn: [24, 14], stag: [28, 17], fox: [18, 10], wolf: [30, 15] };
const GROUPS = { fawn: (w) => (w ? ['roe', 'roe'] : ['roe', 'fawn']), roe: () => (Math.random() < 0.25 ? ['roe', 'roe'] : ['roe']), stag: () => ['stag'], fox: () => ['fox'], wolf: () => ['wolf'] };
const LEAN = { roe: 0.42, fawn: 0.28, stag: 0.7, fox: 0.26, wolf: 0.48 };   // half the distance between fore and hind feet
const DEER = new Set(['roe', 'fawn', 'stag']);
// The flight: how far from the player a kind stops when it has run off (m: in sight of him, inside its alert distance),
// how long it then stands and watches him (s), how fast it runs (`trot` m/s: a brisk trot, quicker than its ordinary
// trot and never a gallop; the gallop of wildlife-models.js is a test pose only), how quickly it gets going and slows
// down (m/s²); `sit`: how often a fox sits down to watch. A group that has to run a third time within CHASE.window
// seconds leaves for the wood. The wolf keeps its own manner. A group that has run from the player keeps CLEAR m less
// than its alert distance away from him on every way it plans for a while.
const FLIGHT = {
  roe: { stop: [16, 24], watch: [7, 13], trot: 3.4, accel: 3, brake: 3 },
  stag: { stop: [18, 26], watch: [8, 15], trot: 3.8, accel: 3, brake: 3 },
  fox: { stop: [12, 18], watch: [3, 6], trot: 3.2, accel: 3, brake: 3, sit: 0.6 },
};
FLIGHT.fawn = FLIGHT.roe;
const CHASE = { flights: 3, window: 300 }, CLEAR = 4;
/** Distance from p to the segment a–b (in x and z). */
function segDist(p, a, b) {
  const ex = b.x - a.x, ez = b.z - a.z, t = clamp(((p.x - a.x) * ex + (p.z - a.z) * ez) / (ex * ex + ez * ez || 1e-9), 0, 1);
  return Math.hypot(a.x + ex * t - p.x, a.z + ez * t - p.z);
}

/**
 * How often they come (settings.wildlifeRate): how many groups may be out at once by day, at dusk and at night, the
 * pause before a new group comes to a place another one has left (s), the pause between two starts anywhere, how long
 * they graze at a spot, at how many spots, how long they stay at the feeding station, and when the first comes after
 * the start. 'rare' is the scheduler of 0.6 (rate(): one group at a time, a few an hour).
 */
const MODES = {
  often: { groups: [3, 3, 1], gap: [10, 30], next: [5, 14], graze: [45, 95], spots: [2, 4], feed: [100, 210], first: [5, 15], nightGap: 2.2 },
  normal: { groups: [1, 2, 1], gap: [50, 140], next: [30, 70], graze: [25, 55], spots: [1, 3], feed: [60, 140], first: [30, 70], nightGap: 2.5 },
  rare: null,
};
/** Weather: fewer groups and longer pauses in rain and storm, a little longer ones in snow and fog. */
const WEATHER = { storm: { groups: -2, gap: 2.6 }, rain: { groups: -1, gap: 1.5 }, snow: { groups: 0, gap: 1.2 }, fog: { groups: 0, gap: 1.15 } };

/**
 * The places they visit (`side`: the side of the house they are seen from, wildlife-views.js; `box`: where their
 * grazing spots lie [x0, x1, z0, z1]; `room`: seen from the book room; `pull`: how much they like it). The feeding
 * station has stations to eat at instead of spots.
 */
// `from(x, z)`: where they may come out of the wood towards it (out of sight of that side of the house): the wood north
// of the meadow, west of the lake beyond the shrubs, and all round the book room.
const NORTH_WOOD = (x, z) => z > 52 && x > -26 && x < 40, WEST_WOOD = (x, z) => x < -30 && z > -8 && z < 34;
const ROOM_WOOD = (x, z) => !OUTDOOR.inRegion(x, z, -2) && z < 12;
const STAGES = [
  { id: 'meadow', side: 'north', box: [-6, 27, 18, 56], pull: 1.2, from: NORTH_WOOD },
  { id: 'lakeside', side: 'north', box: [-32, -6, 14, 42], pull: 0.8, from: (x, z) => NORTH_WOOD(x, z) || WEST_WOOD(x, z) },
  { id: 'feeder', side: 'north', feeder: true, pull: 1.5, from: NORTH_WOOD },
  { id: 'south', side: 'south', room: true, box: [-30, 30, -64, -28], pull: 1, from: ROOM_WOOD },
  { id: 'east', side: 'east', room: true, box: [16, 52, -46, -2], pull: 1, from: ROOM_WOOD },
  { id: 'west', side: 'west', room: true, box: [-52, -16, -46, -2], pull: 1, from: ROOM_WOOD },
];

class Beast {
  constructor(owner, kind, winter) {
    this.owner = owner; this.kind = kind;
    this.A = createAnimal(kind, winter);
    this.mesh = this.A.mesh; this.G = this.A.spec.gait;
    this.scale = rand(0.94, 1.05); this.mesh.scale.setScalar(this.scale);   // no two quite alike
    this.walk = this.G.walk[0]; this.trotSpeed = this.G.trot[0]; this.gallopSpeed = this.G.gallop?.[0] || 0;
    this.accel = 0; this.brake = 0; this.spin = false;   // in flight: quicker to start and to stop, it turns on the spot first
    this.pos = new THREE.Vector3(); this.yaw = 0; this.speed = 0; this.want = 0; this.turnRate = 0;
    this.path = null; this.pathI = 0; this.trail = []; this._ahead = new THREE.Vector3(); this._dodge = new THREE.Vector3();
    this.state = 'stand'; this.stateT = 0; this.hold = null; this.gone = false;
    this.P = { phase: Math.random(), move: 0, trot: 0, gallop: 0, sit: 0, stride: 1, graze: 0, alert: 0, yaw: 0, pitch: 0, tilt: 0, bend: 0, earL: [0, 0, 0], earR: [0, 0, 0], tail: [0, 0], lean: 0, roll: 0, shift: 0 };
    this.goal = { graze: 0, alert: 0, yaw: 0, pitch: 0, tilt: 0 };
    this.t = Math.random() * 10; this.flickT = rand(1, 4); this.flick = [0, 0]; this.swishT = rand(2, 6); this.swish = 0; this.lookT = rand(4, 10);
    this.lean = 0; this.roll = 0;
    this.chewing = 0; this.chew = 0; this.tug = 0; this.licking = 0;   // feeding: chewing, a pull at the hay, licking salt
  }
  setState(s) { this.state = s; this.stateT = 0; }
  place(x, z, yaw) { this.pos.set(x, this.owner.G.height(x, z), z); this.yaw = yaw; this.trail.length = 0; }
  /** Walk (or trot) along a path; null when there is none. */
  go(points, speed) { if (points && points.length < 2) points = null; this.path = points; this.pathI = 1; this.want = points ? speed : 0; this.arrived = false; return !!points; }
  /** A new way of its own (leaving, fleeing, the next spot): any step aside is over. */
  head(points, speed) { this.aside = null; return this.go(points, speed); }
  /** A point `d` m back along the way it came (the fawn walks there). */
  trailPoint(d) {
    let acc = 0, prev = this.pos;
    for (let i = this.trail.length - 1; i >= 0; i--) { const p = this.trail[i], s = Math.hypot(p.x - prev.x, p.z - prev.z); if (acc + s >= d) { const f = (d - acc) / (s || 1); return new THREE.Vector3(lerp(prev.x, p.x, f), 0, lerp(prev.z, p.z, f)); } acc += s; prev = p; }
    return prev.clone();
  }

  /** A point `look` metres ahead on the path, from where the animal is (it never cuts a corner by more than that). */
  #ahead(look) {
    const P = this.path, p = this.pos;
    // waypoints it has passed (or nearly reached) are done, and so is one whose corner it has cut: nearer to the next
    // leg than to this one (else it would circle round a point beside it, the way into a feeding place has sharp turns)
    for (;;) {
      const a = P[this.pathI - 1], b = P[this.pathI], abx = b.x - a.x, abz = b.z - a.z;
      const t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / (abx * abx + abz * abz || 1e-6);
      if (this.pathI < P.length - 1 && (t >= 1 || Math.hypot(b.x - p.x, b.z - p.z) < 0.25 || segDist(p, b, P[this.pathI + 1]) < segDist(p, a, b) - 0.02)) { this.pathI++; continue; }
      let x = a.x + abx * Math.min(1, Math.max(0, t)), z = a.z + abz * Math.min(1, Math.max(0, t)), left = look;
      for (let i = this.pathI; i < P.length; i++) {
        const sx = P[i].x - x, sz = P[i].z - z, d = Math.hypot(sx, sz);
        if (d >= left) return this._ahead.set(x + sx / d * left, 0, z + sz / d * left);
        left -= d; x = P[i].x; z = P[i].z;
      }
      return this._ahead.set(x, 0, z);
    }
  }
  /** Follow the path (or head for `target`): turn at a limited rate, slow down in sharp turns and at the end (not when
   *  `slow` is false: a follower running after its leader keeps its pace). */
  steer(dt, target = null, stop = 0.3, slow = true) {
    const p = this.pos;
    let q = target;
    if (this.path) q = this.#ahead(Math.min(1.8, 0.45 + 0.25 * this.speed));
    let v = 0;
    if (q) {
      // an animal of another group close in front bends the way past it, to the side away from it (to the right when it
      // is straight ahead: two that meet both keep right and pass each other); one behind it does not matter
      const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
      for (const o of this.owner.beasts) {
        if (o === this || o.visit === this.visit || !this.visit) continue;
        const ox = o.pos.x - p.x, oz = o.pos.z - p.z, od = Math.hypot(ox, oz);
        if (od > 1.8 || od < 1e-3 || ox * rz - oz * rx < -0.3 * od) continue;
        if (q !== this._dodge) q = this._dodge.copy(q);
        const side = (ox * rx + oz * rz) / od, k = 1.5 * (1.8 - od) / 1.8 * (side > 0.15 ? -1 : 1);
        q.x += rx * k; q.z += rz * k;
      }
      const fin = this.path && this.path[this.path.length - 1], end = !this.path || this.pathI >= this.path.length - 1;
      const dx = q.x - p.x, dz = q.z - p.z, d = fin && end ? Math.hypot(fin.x - p.x, fin.z - p.z) : Math.hypot(dx, dz);
      if (end && d < stop) { if (this.path) { this.path = null; this.arrived = true; } }
      else {
        // (a deer that bolts swings round on its hind legs before it runs: `spin`)
        const e = wrap(Math.atan2(dx, dz) - this.yaw), rate = lerp(lerp(1.5, 2.4, this.P.trot), 2.7, this.P.gallop) * (this.speed < 0.3 ? 1.4 : 1) * (this.spin && this.speed < 1.5 ? 2.4 : 1);
        const turn = clamp(e, -rate * dt, rate * dt);
        this.yaw = wrap(this.yaw + turn); this.turnRate = turn / Math.max(dt, 1e-4);
        v = (this.yieldT > 0 || (this.spin && Math.abs(e) > 1.1) ? 0 : this.want) * clamp((Math.cos(e) - 0.15) / 0.85, 0.1, 1);
        if (end && slow) v = Math.min(v, Math.max(0.12, d * 0.9));
      }
    } else this.turnRate = 0;
    this.speed += clamp(v - this.speed, -(this.brake || 2.2) * dt, (this.accel || 1.5) * dt);
    if (this.speed < 1e-3) this.speed = 0;
    const ox = p.x, oz = p.z;
    p.x += Math.sin(this.yaw) * this.speed * dt; p.z += Math.cos(this.yaw) * this.speed * dt;
    // never into a tree, the rack or the house: the grid keeps them off by a margin, and a step that would still go in
    // (a tight turn, a short cut beside the mother) is not taken
    if (this.speed > 0 && this.owner.obstacleAt(p.x, p.z) && !this.owner.obstacleAt(ox, oz)) { p.x = ox; p.z = oz; this.speed *= 0.5; }
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.z - p.z) > 0.35) { this.trail.push(new THREE.Vector3(p.x, 0, p.z)); if (this.trail.length > 40) this.trail.shift(); }
  }
  /** Turn on the spot towards `yaw` (at a feeding place). */
  face(yaw, dt) { const e = wrap(yaw - this.yaw), turn = clamp(e, -1.3 * dt, 1.3 * dt); this.yaw = wrap(this.yaw + turn); this.turnRate = turn / Math.max(dt, 1e-4); }

  /** Pose: ease towards the goals, step the gait, ears, tail; stand on the ground. `posed` false: only the numbers. */
  animate(dt, posed) {
    const P = this.P, g = this.goal, G = this.G;
    this.t += dt;
    const ease = (k, v, r) => { P[k] += (v - P[k]) * (1 - Math.exp(-r * dt)); };
    ease('graze', g.graze, 1.6); ease('alert', g.alert, 2.5); ease('yaw', g.yaw, 2.2); ease('pitch', g.pitch, 2.2); ease('tilt', g.tilt, 3);
    // walk or trot by speed; a slower walk takes shorter steps; in flight it trots quicker with longer strides (the
    // gallop of a deer begins well above its flight pace: only the test pose reaches it); a fox may sit down to watch
    // (`sit`)
    const trot = smoothstep(this.walk * 1.25, this.trotSpeed * 0.8, this.speed);
    P.trot += (trot - P.trot) * (1 - Math.exp(-4 * dt));
    const gallop = this.gallopSpeed ? smoothstep(this.trotSpeed * 1.6, this.gallopSpeed * 0.8, this.speed) : 0;
    P.gallop += (gallop - P.gallop) * (1 - Math.exp(-5 * dt));
    P.sit += ((this.sit ? 1 : 0) - P.sit) * (1 - Math.exp(-3 * dt));
    // (turning on the spot it steps round)
    const pivot = this.speed < 0.15 ? Math.min(0.6, Math.abs(this.turnRate) * 0.5) : 0;
    P.move += (Math.max(smoothstep(0.02, 0.18, this.speed), pivot) - P.move) * (1 - Math.exp(-6 * dt));
    P.stride = trot > 0.5 ? clamp(this.speed / this.trotSpeed, 0.7, 1.3) : clamp(0.45 + 0.55 * this.speed / this.walk, 0.45, 1.1);
    if (P.gallop > 0.5) P.stride = clamp(this.speed / this.gallopSpeed, 0.65, 1.15);
    const strideM = lerp(lerp(G.walk[1], G.trot[1], P.trot), G.gallop?.[1] ?? 0, G.gallop ? P.gallop : 0) * P.stride;
    P.phase = (P.phase + dt * (this.speed + pivot * 0.6) / Math.max(0.1, strideM)) % 1;
    P.bend += (clamp(this.turnRate * 0.12, -0.18, 0.18) - P.bend) * (1 - Math.exp(-4 * dt));
    P.shift = Math.sin(this.t * 0.37) * (1 - P.move);
    // ear flicks: now and then one ear turns back and springs forward again
    this.flickT -= dt;
    if (this.flickT <= 0) { this.flickT = rand(1.2, this.A.spec.deer ? 5 : 8); this.flick[Math.random() < 0.5 ? 0 : 1] = 1; }
    for (let i = 0; i < 2; i++) this.flick[i] = Math.max(0, this.flick[i] - dt * 2.6);
    const fk = (i) => { const f = this.flick[i]; return f > 0.75 ? (1 - f) * 4 : f / 0.75; };
    P.earL[0] = 0.35 * fk(0) - P.graze * 0.12; P.earL[1] = 0.6 * fk(0) + P.alert * 0.1 * Math.sin(this.t * 0.9); P.earL[2] = -0.12 * P.graze;
    P.earR[0] = 0.35 * fk(1) - P.graze * 0.12; P.earR[1] = 0.6 * fk(1) - P.alert * 0.1 * Math.sin(this.t * 0.9 + 1); P.earR[2] = -0.12 * P.graze;
    // tail: deer flick it now and then, canids carry it a little higher at the trot
    this.swishT -= dt;
    if (this.swishT <= 0) { this.swishT = rand(2.5, 8); this.swish = 1; }
    this.swish = Math.max(0, this.swish - dt * 1.8);
    const sw = Math.sin(this.swish * Math.PI * 3) * this.swish;
    P.tail[0] = this.A.spec.deer ? 0.25 * this.swish + 0.2 * P.alert + 0.6 * P.gallop * P.move : 0.12 * P.trot * P.move - 0.05 * (1 - P.move);
    P.tail[1] = this.A.spec.deer ? 0.35 * sw : 0.25 * sw;
    // grazing and feeding: the jaw works (the head moves a little while it chews), a pull at the hay jerks the head
    // back, licking salt nods it quickly
    this.chew += ((this.A.spec.deer ? Math.max(P.graze, this.chewing) : 0) - this.chew) * (1 - Math.exp(-3 * dt));
    this.tug = Math.max(0, this.tug - dt * 2.2);
    const nod = this.chew * 0.03 * Math.sin(this.t * 9.5) - 0.16 * Math.sin(Math.min(1, this.tug) * Math.PI) + this.licking * 0.045 * Math.sin(this.t * 7.3);
    // the body follows the slope under its feet
    const H = this.owner.G.height, L = LEAN[this.kind], fx = Math.sin(this.yaw) * L, fz = Math.cos(this.yaw) * L;
    const hf = H(this.pos.x + fx, this.pos.z + fz), hb = H(this.pos.x - fx, this.pos.z - fz);
    const hl = H(this.pos.x + fz * 0.4, this.pos.z - fx * 0.4), hr = H(this.pos.x - fz * 0.4, this.pos.z + fx * 0.4);
    this.lean += (Math.atan2(hb - hf, 2 * L) - this.lean) * (1 - Math.exp(-6 * dt));
    this.roll += (Math.atan2(hl - hr, 0.8 * L) * 0.6 - this.roll) * (1 - Math.exp(-6 * dt));
    this.pos.y = (hf + hb) / 2;
    if (!posed) return;
    const pitch = P.pitch; P.pitch += nod; P.lean = this.lean; P.roll = this.roll;
    applyPose(this.A, P);
    P.pitch = pitch;
    this.mesh.position.copy(this.pos); this.mesh.rotation.y = this.yaw;
  }
}

// ---------------------------------------------------------------- the visits --------------------------------------------
export class Wildlife {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group(); this.group.name = 'wildlife';
    world.scene.add(this.group);
    this.prewarm = prewarmMesh(); this.group.add(this.prewarm);
    // soft shadows under the animals: one instanced quad each (the contact shadows' program, world.js)
    const tex = blobTexture();
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, 12);
    this.blobs.count = 0; this.blobs.visible = false; this.blobs.frustumCulled = false; this.blobs.renderOrder = 11; this.blobs.name = 'wildlife-shadows';
    this.group.add(this.blobs);
    // tracks in the snow: hoof and paw prints, the newest 160 of each; they fade once the animals are gone
    this.prints = [printTexture(true), printTexture(false)].map((map) => {
      const m = new THREE.InstancedMesh(this.blobs.geometry, new THREE.MeshBasicMaterial({ map, color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 160);
      m.count = 0; m.visible = false; m.frustumCulled = false; m.renderOrder = 11; m.name = 'wildlife-tracks'; m.userData.next = 0;
      this.group.add(m); return m;
    });
    this.beasts = []; this.visits = [];
    this.enabled = true;
    this.wait = null;                   // until the first visit may come (set on the first frame, by the setting)
    this.checkT = 0; this.log = []; this.clock = 0; this.stageWait = {};
    this.prep = null; this.G = null; this.field = null;
    this.playerPrev = new THREE.Vector3(); this.playerMove = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._v = new THREE.Vector3(); this._f = new THREE.Frustum(); this._pm = new THREE.Matrix4();
  }

  /** The first visit of the day (0.6 tests and the rare scheduler read `visit`). */
  get visit() { return this.visits[0] || null; }
  setEnabled(on) { this.enabled = !!on; if (!on) this.clear(); }
  dispose() { this.clear(); this.world.scene.remove(this.group); this.blobs.geometry.dispose(); for (const m of [this.blobs, ...this.prints]) m.material.dispose(); }

  /** Everything the visits need: the garden's grid, the places and their spots, then one species after the other. A
   *  little per frame, or (`big`: a panel lies over the world, as the main menu does after the start) a whole part per
   *  frame, or (`all`) at once. */
  #prepare(all = false, big = false) {
    if (!this.prep) {
      this.G = wildlifeGround(this.world); this.field = new Field(this.G);
      this.views = houseViews(this.G.hide, this.G.height);
      this.prep = COAT_LIST.map(([k, w]) => ({ kind: k, winter: w, step: prepareSpecies(k, w) }));
      this.prepTimes = { grid: 0, stages: 0, steps: [] };
    }
    // the animal drawn in the last frame (out of sight) has uploaded its geometry: away with it
    if (this.upload) { this.group.remove(this.upload.mesh); this.upload.mesh.skeleton.dispose(); this.upload = null; }
    do {
      const t = performance.now();
      if (!this.field.ready) { this.field.build(all || big ? 1e9 : 3); this.prepTimes.grid += performance.now() - t; }
      else if (!this.stages || this.stages.length < STAGES.length) { this.#stage(STAGES[this.stages?.length || 0]); this.prepTimes.stages += performance.now() - t; }
      else if (this.prep.length) {
        const p = this.prep[0];
        let done = p.step();
        while (big && !done) done = p.step();
        this.prepTimes.steps.push([p.kind + (p.winter ? ':w' : '') + ':' + p.step.last, +(performance.now() - t).toFixed(1)]);
        if (done) {
          this.prep.shift();
          // drawn once far below the ground, so its buffers are on the graphics card before the first visit
          if (!all) { this.upload = createAnimal(p.kind, p.winter); this.upload.mesh.position.y = -100; this.upload.mesh.frustumCulled = false; this.group.add(this.upload.mesh); }
        }
      } else if (!this.stations) { this.#stations(); }
    } while (all && (!this.field.ready || (this.stages?.length || 0) < STAGES.length || this.prep.length || !this.stations));
    return this.#ready() && !this.upload;
  }
  #ready() { return !!this.field?.ready && this.stages?.length === STAGES.length && !this.prep?.length && !!this.stations; }
  /** Build everything now (tests); the timings of the steps in ms. */
  prepareAll() { this.#prepare(true); return this.prepInfo(); }
  /** How the preparation went: the grid's time, the places' time, the number of steps, the slowest step. */
  prepInfo() {
    const st = this.prepTimes?.steps || [], slow = st.reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0]);
    return { grid: Math.round(this.prepTimes?.grid || 0), stages: Math.round(this.prepTimes?.stages || 0), steps: st.length, max: slow[1], slowest: slow[0], total: Math.round(st.reduce((a, b) => a + b[1], 0)), ready: this.#ready() };
  }

  /** One place: its grazing spots (open ground with 2 m round it, seen from its side of the house) and where the
   *  animals come out of the wood to it, hidden from that side. */
  #stage(def) {
    const F = this.field, G = this.G, V = this.views, st = { ...def, spots: [], entries: [] };
    (this.stages ||= []).push(st);
    const sides = def.side === 'north' ? ['north', 'terrace'] : [def.side];
    const S = WINDOW_SIDES.find((s) => s.id === def.side), P = S.pane;
    const win = P.axis === 'x' ? V3((P.a0 + P.a1) / 2, P.at + P.out) : V3(P.at + P.out, (P.a0 + P.a1) / 2);
    const fd = OUTDOOR.feeder;
    if (def.feeder) st.center = V3(fd.x, fd.z);
    else {
      const [x0, x1, z0, z1] = def.box;
      for (let z = z0; z <= z1; z += 2) for (let x = x0; x <= x1; x += 2) {
        if (!F.open(x, z)) continue;
        if (def.id === 'meadow' && (!G.meadow(x, z) || Math.hypot(x - fd.x, z - fd.z) < 7)) continue;
        if (def.id === 'lakeside' && !OUTDOOR.inRegion(x, z, 0.8)) continue;
        let ok = true;
        for (let k = 0; ok && k < 8; k++) ok = F.free(x + Math.cos(k * TAU / 8) * 2, z + Math.sin(k * TAU / 8) * 2);
        if (!ok) continue;
        const seen = sides.reduce((n, id) => n + V.count(id, x, z), 0);
        if (!seen) continue;
        // most likely in plain sight, near the window's axis and close enough to be noticed: 9 to 20 m away
        const d = Math.hypot(x - win.x, z - win.z), ax = ((x - win.x) * S.n[0] + (z - win.z) * S.n[1]) / (d || 1);
        const s = V3(x, z); s.stage = def.id; s.seen = seen; s.dist = d;
        s.w = seen * seen * (0.35 + 0.65 * ax * ax) * (d < 9 ? 0.6 : d < 20 ? 1 : Math.max(0.2, 1 - (d - 20) / 18));
        st.spots.push(s);
      }
      st.center = st.spots.reduce((c, s) => c.add(s), V3(0, 0)).multiplyScalar(1 / Math.max(1, st.spots.length));
    }
    st.entries = this.#entries(st, sides);
  }
  /** Where the animals of a place come from: open ground in the wood it may be reached from (`from`), 14 to 60 m from
   *  the place and out of sight of its side of the house (no window and no spot on the terrace sees it, however far),
   *  spread out round it, the nearer ones more often. Reachable from the place by a way not much longer than the
   *  straight line. */
  #entries(st, sides) {
    const F = this.field, V = this.views, c = st.center, cand = [], o = F.nearestOpen(c.x, c.z, 4), reg = o ? F.regionAt(o.x, o.z) : -1;
    // the way from each place to the middle of the place: no long way round (behind the fence, round a thicket)
    const D = o ? F.flood(o, 80) : null, way = new Map();
    for (let z = c.z - 60; z <= c.z + 60; z += 3) for (let x = c.x - 60; x <= c.x + 60; x += 3) {
      const d = Math.hypot(x - c.x, z - c.z);
      if (d < 14 || d > 60 || !st.from(x, z) || !F.open(x, z) || F.regionAt(x, z) !== reg) continue;
      const wd = D ? D[F.cj(z) * F.w + F.ci(x)] : d;
      if (wd > Math.min(75, d * 1.35 + 12)) continue;
      if (sides.some((id) => V.count(id, x, z, 1.0, 140) > 0)) continue;
      const p = V3(x, z); way.set(p, wd); cand.push(p);
    }
    // spread out: one after the other, each as far as possible from those taken (the first ones the nearest)
    cand.sort((a, b) => way.get(a) - way.get(b));
    const picks = cand.slice(0, 1);
    while (picks.length < 14 && picks.length < cand.length) {
      let best = null, bd = -Infinity;
      for (const p of cand) { if (picks.includes(p)) continue; let m = Infinity; for (const q of picks) m = Math.min(m, p.distanceToSquared(q)); m -= (way.get(p) * 0.6) ** 2; if (m > bd) { bd = m; best = p; } }
      if (!best) break;
      picks.push(best);
    }
    return picks.map((p) => ({ edge: p, hide: p }));
  }

  /** The places to eat at the feeding station: the rack has four (two on each side), its trough the same places, the
   *  salt lick one. For each kind: where it stands (its chest at the trough's rim), which way it faces, and the poses
   *  that bring its muzzle to the hay, into the trough and to the salt. */
  #stations() {
    const FD = OUTDOOR.feeder, R = FD.rack, c = Math.cos(FD.rot), s = Math.sin(FD.rot);
    const W = (lx, lz) => V3(FD.x + lx * c + lz * s, FD.z - lx * s + lz * c);
    const [lo, hi] = R.hay, list = [], rim = R.half + 0.08;
    // the face of the hay between the bars at height y: they lean out from the floor of the V to the top rails
    const hayZ = (y) => R.half * clamp((y - lo) / (hi - lo), 0, 1) - 0.03;
    const CHEST = { roe: 0.3, fawn: 0.2, stag: 0.5 };   // from the middle of the body to the chest
    for (const side of [-1, 1]) for (const a of [-0.42, 0.42]) {
      const n = W(0, side).sub(W(0, 0)), st = { id: `rack${side > 0 ? 'E' : 'W'}${a > 0 ? 1 : 0}`, type: 'rack', by: null, poses: {} };
      for (const kind of ['roe', 'fawn', 'stag']) {
        // the highest hay it reaches with its chest at the trough's rim (or, a big animal, further out): there its muzzle
        // meets the face of the hay
        let rack = null, D = rim + CHEST[kind];
        for (let h = hi - 0.04; h > lo + 0.04 && !rack; h -= 0.02) {
          const q = reachFor(kind, h), need = q ? q.f + hayZ(h) : 0;
          if (q && need > rim + CHEST[kind] - 0.08) { rack = q; D = Math.max(need, rim + CHEST[kind]); }
        }
        // the trough: the lowered muzzle comes down inside it
        const q = reachFor(kind, R.trough - 0.06), tz = q ? D - q.f : -1;
        const trough = q && tz > 0.06 && tz < R.half ? q.r : null;
        if (!rack && trough == null) continue;
        const stand = W(a, side * D);
        st.poses[kind] = { stand, yaw: Math.atan2(-n.x, -n.z), out: stand.clone().addScaledVector(n, 1.3), rack: rack?.r ?? null, trough };
      }
      list.push(st);
    }
    // the salt lick: the block on its post, from the side away from the rack
    const [sx, sz] = FD.salt.at, post = W(sx, sz), dir = post.clone().sub(W(0, 0)).setY(0).normalize();
    const salt = { id: 'salt', type: 'salt', by: null, poses: {} };
    for (const kind of ['roe', 'stag']) {
      const r = reachFor(kind, FD.salt.h + FD.salt.block * 0.5);
      if (!r) continue;
      const stand = post.clone().addScaledVector(dir, Math.max(r.f + 0.03, CHEST[kind] + 0.1));
      salt.poses[kind] = { stand, yaw: Math.atan2(-dir.x, -dir.z), out: stand.clone().addScaledVector(dir, 1.3), salt: r.r };
    }
    list.push(salt);
    // keep only the places an animal can stand on and walk to in a straight line from its `out` point
    for (const st of list) for (const [kind, ps] of Object.entries(st.poses)) {
      const ok = !this.obstacleAt(ps.stand.x, ps.stand.z, 0.3) && this.#clearLine(ps.out, ps.stand) && this.field.nearestOpen(ps.out.x, ps.out.z, 2);
      if (!ok) delete st.poses[kind];
    }
    this.stations = list;
  }

  #winter() { return this.#weather() === 'snow' || (this.seasonOverride ?? seasonOf(this.world.settings?.season)) === 'winter'; }
  #snowOnGround() { return this.#weather() === 'snow' || NATURE.uSnow.value > 0.5; }
  #hour() { return this.hourOverride ?? this.world.currentHour?.() ?? 12; }
  #weather() { return this.weatherOverride ?? this.world.weatherState?.().name ?? this.world.settings?.weather ?? 'clear'; }
  #mode() { const m = this.modeOverride ?? this.world.settings?.wildlifeRate; return m in MODES ? m : 'often'; }
  /** dusk: 1 round sunrise and sunset, 0 by day and in the depth of the night; night: the sun well below the horizon. */
  #light() { const y = sunPosition(this.#hour()).y; return { dusk: 1 - smoothstep(0.02, 0.2, Math.abs(y + 0.02)), night: y < -0.08, sun: y }; }
  /** Visits per second while nobody is out (after a pause of 3 to 4 minutes since the last one) on 'rare': on average
   *  one every 15 minutes by day, every 4 at dawn and dusk, every 40 at night; far fewer in a storm or rain. */
  rate() {
    const { dusk, night } = this.#light();
    const base = (night ? 1 / 2400 : 1 / 900) + dusk / 300;
    return base * ({ storm: 0.06, rain: 0.45, snow: 0.8, fog: 0.75 }[this.#weather()] ?? 1);
  }
  /** Visits may start (tests switch this off): anywhere, in the house as outside. */
  #watching() { return this.watchOverride ?? true; }

  /** Where the player can see them from now: the places on his side of the house (the book room has its windows, the
   *  hall and the garden the north), and the one he looks at. */
  #focus() {
    if (this.focusOverride) return this.focusOverride;
    const cam = this.world.camera, p = cam.position;
    cam.getWorldDirection(this._v);
    const room = p.z < ROOM.z1 + 0.3 && p.z > ROOM.z0 - 1 && Math.abs(p.x) < ROOM.x1 + 1;
    const stages = this.stages.filter((s) => !!s.room === room);
    let primary = null;
    if (room) { const side = lookingOut(p, this._v); primary = stages.find((s) => s.side === side) || null; }
    else {
      // the place most nearly ahead (within 40°, and not too far)
      let best = Math.cos(0.7);
      for (const s of stages) {
        const dx = s.center.x - p.x, dz = s.center.z - p.z, d = Math.hypot(dx, dz) || 1;
        const dot = (dx * this._v.x + dz * this._v.z) / (d * (Math.hypot(this._v.x, this._v.z) || 1));
        if (d < 70 && dot > best) { best = dot; primary = s; }
      }
    }
    return { stages, primary };
  }
  /** The places as the player would see them from a window side ('north', 'south', … or null for all), for tests. */
  focusFor(side) {
    if (!side) return null;
    const room = !['north', 'terrace'].includes(side), stages = this.stages.filter((s) => !!s.room === room);
    return { stages, primary: room ? stages.find((s) => s.side === side) : null };
  }

  #pickKind(stage) {
    const { night } = this.#light(), n = night ? 1 : 0;
    // at the feeding station the deer; a wolf at most every forty minutes ('rare': as in 0.6)
    const wolf = this.#mode() === 'rare' ? 0.07 * (0.4 + 1.6 * n) : (this.clock - (this.lastWolf ?? -1e9) > 2400 ? 0.03 * (0.5 + 1.5 * n) : 0);
    const w = stage?.feeder ? { fawn: 0.42, roe: 0.38, stag: 0.2 } : { fawn: 0.3 * (1 - 0.5 * n), roe: 0.2 * (1 - 0.3 * n), stag: 0.2 * (1 - 0.2 * n), fox: 0.22 * (1 + 0.8 * n), wolf };
    return weighted(Object.keys(w), (k) => w[k]);
  }

  /** Start a visit now: a group of `kind` (fawn: a doe with her fawn) steps out of the wood towards `stage` (by
   *  default where the player is looking). False when it cannot. */
  start(kind = null, stage = null) {
    this.#prepare(true);
    if (typeof stage === 'string') stage = this.stages.find((s) => s.id === stage);
    if (!stage) { const f = this.#focus(); stage = f.primary || weighted(f.stages, (s) => s.pull); }
    kind ||= this.#pickKind(stage);
    if (stage.feeder && !DEER.has(kind)) kind = 'roe';
    if (!stage.entries.length || (!stage.feeder && !stage.spots.length)) return false;
    // a start the player does not see: outside the view, or far off
    const cam = this.world.camera; cam.updateMatrixWorld();
    this._f.setFromProjectionMatrix(this._pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const cp = cam.position, hidden = stage.entries.filter((e) => (!this._f.containsPoint(this._s.set(e.hide.x, this.G.height(e.hide.x, e.hide.z) + 0.6, e.hide.z)) || Math.hypot(e.hide.x - cp.x, e.hide.z - cp.z) > 58) && Math.hypot(e.edge.x - cp.x, e.edge.z - cp.z) > 25);
    // not where another group walks in or out; the nearer ones first (they are soon in sight), in a random order
    const others = [...this.beasts.map((b) => b.pos), ...this.beasts.flatMap((b) => (b.exit ? [b.exit] : []))];
    const apart = (e) => others.every((o) => Math.hypot(e.hide.x - o.x, e.hide.z - o.z) > 20 && Math.hypot(e.edge.x - o.x, e.edge.z - o.z) > 20);
    let pool = hidden.filter(apart);
    if (!pool.length) pool = stage.entries.filter(apart);
    if (!pool.length) return false;
    const goal = stage.center;
    const order = pool.map((e) => ({ e, k: Math.hypot(e.edge.x - goal.x, e.edge.z - goal.z) * rand(0.8, 1.25) })).sort((a, b) => a.k - b.k).map((o) => o.e);
    const kinds = GROUPS[kind](this.#winter());
    for (const entry of order.slice(0, 6)) {
      let path = null, station = null, spot = null;
      if (stage.feeder) {
        station = this.#freeStation(kinds[0]);
        if (!station) return false;
        path = this.#pathTo(entry.hide, station.poses[kinds[0]]);
      } else {
        spot = this.#spot(stage, entry.edge);
        path = spot && this.#way(entry.hide, spot, null);
      }
      if (!path) continue;
      const M = MODES[this.#mode()];
      const visit = { kind, stage: stage.id, t: 0, entry, n: kinds.length, storm: this.#weather() === 'storm', spots: M ? Math.round(rand(M.spots[0], M.spots[1])) : 1 + Math.floor(rand(0.6, 2.99)) };
      const lead = this.#add(kinds[0], entry.hide, path, visit);
      lead.setState('walk'); lead.go(path, lead.walk); lead.goalSpot = spot;
      if (station) this.#take(lead, station);
      // the others start a little behind the leader, on open ground
      const back = entry.hide.clone().sub(path[1]).setY(0).normalize();
      for (const k of kinds.slice(1)) {
        const at = entry.hide.clone().addScaledVector(back, 1.6);
        const b = this.#add(k, this.field.open(at.x, at.z) ? at : entry.hide, null, visit);
        b.yaw = lead.yaw; b.lead = lead; b.setState('follow');
      }
      visit.lead = lead;
      if (visit.storm) visit.spots = 1;
      this.visits.push(visit);
      if (kind === 'wolf') this.lastWolf = this.clock;
      visit.log = { t: this.clock, kind, n: kinds.length, stage: stage.id };
      this.log.push(visit.log); if (this.log.length > 600) this.log.shift();
      return true;
    }
    return false;
  }
  /** A grazing place of `stage`: open, not too near the last one, away from the other groups, most likely one in
   *  plain sight; at night rather at the far side, by the edge of the wood. */
  #spot(stage, from, minD = 8) {
    // not where somebody stands outside: they would only turn and go again
    const pp = this.world.player.position, out = !this.G.indoors(pp), night = this.#light().night;
    const others = this.visits.filter((v) => v.stage !== stage.id || v.lead?.pos !== from).flatMap((v) => (v.lead && !v.lead.gone ? [v.lead.goalSpot || v.lead.pos] : []));
    const ok = (s) => (!out || Math.hypot(s.x - pp.x, s.z - pp.z) > 30) && others.every((o) => Math.hypot(s.x - o.x, s.z - o.z) > 14);
    let c = stage.spots.filter((s) => s.distanceTo(from) > minD && s.distanceTo(from) < 45 && ok(s));
    if (!c.length) c = stage.spots.filter(ok);
    if (!c.length) c = stage.spots;
    const s = weighted(c, (p) => p.w * (night ? 0.3 + smoothstep(12, 26, p.dist) : 1));
    return s.clone().add(new THREE.Vector3(rand(-0.8, 0.8), 0, rand(-0.8, 0.8)));
  }
  /** Where the other groups are (5 m round each of their animals and round where they are heading): a way keeps
   *  clear of them, if it can; a group the player has startled a short while ago keeps clear of him as well (`player`). */
  #others(visit, player = true) {
    const out = [];
    if (player && this.#shy(visit)) { const pp = this.world.player.position; out.push({ x: pp.x, z: pp.z, r: (SHY[visit.kind]?.[0] ?? 24) - CLEAR }); }
    for (const b of this.beasts) {
      if (b.visit === visit) continue;
      out.push({ x: b.pos.x, z: b.pos.z, r: 5 });
      if (b.goalSpot && !b.lead) out.push({ x: b.goalSpot.x, z: b.goalSpot.z, r: 5 });
      // the way it is walking, a point every 3 m
      if (b.path && !b.lead) {
        let prev = b.pos;
        for (let i = b.pathI; i < b.path.length; i++) {
          const q = b.path[i], d = Math.hypot(q.x - prev.x, q.z - prev.z);
          for (let k = 3; k < d; k += 3) out.push({ x: prev.x + (q.x - prev.x) * k / d, z: prev.z + (q.z - prev.z) * k / d, r: 3 });
          out.push({ x: q.x, z: q.z, r: 3 }); prev = q;
        }
      }
    }
    return out;
  }
  /** A way from a to b round the other groups, or straight through when there is none round them. */
  #way(a, b, visit, budget = Infinity) { return this.field.path(a, b, this.#others(visit), budget) || this.field.path(a, b, null, budget); }
  /** A free place at the feeding station for `kind` (the rack first). */
  #freeStation(kind, near = null, types = ['rack', 'salt']) {
    const c = this.stations.filter((s) => !s.by && s.poses[kind] && types.includes(s.type) && (!near || s.poses[kind].stand.distanceTo(near) < 5));
    if (!c.length) return null;
    return weighted(c, (s) => (s.type === 'rack' ? 3 : 1));
  }
  #take(b, st) { if (b.station) this.#release(b); st.by = b; b.station = st; b.feedFor = null; }
  #release(b) { if (b.station && b.station.by === b) b.station.by = null; b.station = null; b.chewing = 0; b.licking = 0; }
  /** The way to a feeding place: over the grid to its `out` point, then straight in. */
  #pathTo(from, ps, b = null) {
    const o = this.field.nearestOpen(ps.out.x, ps.out.z, 2), p = o && this.#pathFrom(from, o, b);
    if (!p) return null;
    if (o.distanceTo(ps.out) > 0.05) p.push(ps.out.clone());
    p.push(ps.stand.clone());
    return p;
  }
  /** The feeding place `b` stands in (within 0.7 m of where it eats): its own, the one it left last, or any other. */
  #standAt(from, b) {
    if (!b || !this.stations) return null;
    let best = null, bd = 0.7;
    for (const st of [b.station, b.lastStation, ...this.stations]) {
      const ps = st?.poses[b.kind], d = ps ? Math.hypot(ps.stand.x - from.x, ps.stand.z - from.z) : Infinity;
      if (d < bd) { bd = d; best = ps; }
    }
    return best;
  }
  /** Where a way over the grid can begin for an animal at `p`: there, or (beside the rack, the house, a tree) the
   *  nearest open place it can walk to in a straight line. */
  #start(p) {
    if (this.field.open(p.x, p.z)) return p;
    for (let d = 1; d <= 3; d++) for (let a = 0; a < 8 * d; a++) {
      const t = (a / (8 * d)) * TAU, q = V3(p.x + Math.cos(t) * d, p.z + Math.sin(t) * d);
      if (this.field.open(q.x, q.z) && this.#clearLine(p, q)) return q;
    }
    return this.field.nearestOpen(p.x, p.z, 3);
  }
  /** A path from where `b` stands to `goal` (open): from a feeding place it steps back out of it first, the way it
   *  came in, never across the rack. */
  #pathFrom(from, goal, b = null, budget = Infinity) {
    const ps = this.#standAt(from, b);
    if (ps) {
      const o = this.field.nearestOpen(ps.out.x, ps.out.z, 2), p = o && this.#way(o, goal, b?.visit, budget);
      return p && [from.clone(), ps.out.clone(), ...p.slice(o.distanceTo(ps.out) < 0.3 ? 1 : 0)];
    }
    const start = this.#start(from);
    const p = start && this.#way(start, goal, b?.visit, budget);
    if (p && start !== from) p.unshift(from.clone());
    return p;
  }
  #add(kind, at, path, visit) {
    const b = new Beast(this, kind, this.#winter());
    const next = path?.[1] || at;
    b.place(at.x, at.z, Math.atan2(next.x - at.x, next.z - at.z) || 0);
    b.visit = visit;
    this.beasts.push(b); this.group.add(b.mesh);
    b.animate(0, true);
    return b;
  }
  #remove(b) { this.#release(b); this.group.remove(b.mesh); b.mesh.skeleton.dispose(); const i = this.beasts.indexOf(b); if (i >= 0) this.beasts.splice(i, 1); b.gone = true; }
  /** Remove every animal at once (setting switched off, tests). */
  clear() {
    for (const b of [...this.beasts]) this.#remove(b);
    this.visits.length = 0; this.blobs.count = 0; this.blobs.visible = false;
    for (const m of this.prints) { m.count = 0; m.visible = false; m.userData.next = 0; }
    for (const s of this.stations || []) s.by = null;
    this.tracks = 0;
    if (this.upload) { this.group.remove(this.upload.mesh); this.upload.mesh.skeleton.dispose(); this.upload = null; }
  }

  /**
   * Tests and screenshots: put an animal (fawn: with her mother beside her) at { x, z } facing `yaw`. With `hold` it
   * stays there in `pose` ('stand', 'graze', 'alert', 'sit', 'walk', 'trot', 'gallop': the legs move, it does not; 'rack', 'trough',
   * 'salt': feeding at the station `station`), otherwise it goes on like a visitor from there. `winter` gives the
   * winter coat.
   */
  spawn(kind, { x = 0, z = 30, yaw = 0, hold = false, pose = 'stand', winter, mother = true, station = null } = {}) {
    this.#prepare(true);
    const was = this.weatherOverride, wasSeason = this.seasonOverride;
    if (winter != null) { this.weatherOverride = winter ? 'snow' : 'clear'; this.seasonOverride = winter ? 'winter' : 'summer'; }
    const visit = { kind, stage: station ? 'feeder' : 'meadow', t: 0, n: 1, spots: 2, spawned: true };
    let at = V3(x, z);
    const st = station ? this.stations.find((s) => s.id === station) : null;
    if (st?.poses[kind]) { at = st.poses[kind].stand; yaw = st.poses[kind].yaw; }
    const b = this.#add(kind, at, null, visit);
    b.yaw = yaw; b.hold = hold ? pose : null;
    if (st?.poses[kind]) this.#take(b, st);
    const out = [b];
    if (kind === 'fawn' && mother && !st) {
      const m = this.#add('roe', new THREE.Vector3(x + Math.cos(yaw) * 1.6 - Math.sin(yaw) * 0.6, 0, z - Math.sin(yaw) * 1.6 - Math.cos(yaw) * 0.6), null, visit);
      m.yaw = yaw + 0.3; m.hold = b.hold; b.lead = m; out.push(m);
      if (!hold) { b.setState('follow'); this.#graze(m); m.visits = 2; }
    } else if (!hold) { if (st) { b.setState('feed'); b.feedT = 0; } else this.#graze(b); }
    visit.lead = out.find((a) => !a.lead) || b; visit.n = out.length;
    if (!hold) this.visits.push(visit);
    this.weatherOverride = was; this.seasonOverride = wasSeason;
    for (const a of out) a.animate(0, true);
    this.#blobs();
    return out;
  }

  // ------------------------------------------------------------------ every frame ----
  update(dt, posed = true) {
    if (!this.enabled) return;
    // another render path (the graphics quality draws without the composer on 'low'): draw the warm-up triangle again
    const path = this.world.bloom?.enabled || this.world.ao?.enabled;
    if (path !== this.renderPath) { this.renderPath = path; this.prewarm.userData.frames = 0; this.prewarm.visible = true; }
    if (this.tracks) this.#fadeTracks(dt);
    if (this.wait == null) { const M = MODES[this.#mode()]; this.wait = M ? rand(...M.first) : rand(70, 160); }
    if (!this.prepDone && this.#ready() && !this.upload) this.prepDone = true;   // built at once (tests)
    if (!this.prepDone) {
      // the models are built while a panel covers the world (the main menu after the start), or else bit by bit in
      // the last 45 seconds before a visit may come
      this.wait -= dt;
      const covered = this.world.background === 'dim';
      if (covered || this.wait < 45) this.prepDone = this.#prepare(false, covered);
      if (!this.prepDone) return;
    }
    dt = Math.min(dt, 0.1);
    this.clock += dt;
    this.#direct(dt);
    if (!this.beasts.length) return;
    for (const v of this.visits) {
      v.t += dt;
      // (a safety net: no visit lasts for ever)
      if (v.t > 1500 && !v.leaving && !v.spawned) this.#sendHome(v);
      if (v.t > 2400 && !v.spawned) for (const b of this.beasts) if (b.visit === v) b.done = true;
    }
    // the player: where, and is he moving (an observer who stands still is soon ignored); in the house or sitting in
    // the hide he does not bother them
    const pp = this.world.player.position;
    this.playerMove = lerp(this.playerMove, Math.min(3, Math.hypot(pp.x - this.playerPrev.x, pp.z - this.playerPrev.z) / Math.max(dt, 1e-3)), 1 - Math.exp(-3 * dt));
    this.playerPrev.copy(pp);
    const hidden = this.G.indoors(pp) || this.world.actions?.seatedId === 'feederhide';
    const snow = posed && this.#snowOnGround();
    setNightLook(this.#light());
    this.#giveWay(dt);
    for (const b of this.beasts) {
      b.stateT += dt;
      if (!b.hold) this.#unstick(b, dt);
      if (b.hold) this.#hold(b, dt);
      else if (b.station && b.state !== 'walk' && b.state !== 'flee' && b.state !== 'leave' && !(b.lead && b.state === 'follow')) this.#feed(b, dt, hidden ? null : pp);
      else if (b.lead) this.#follow(b, dt, hidden ? null : pp);
      else this.#think(b, dt, hidden ? null : pp);
      b.animate(dt, posed);
      if (snow && !b.hold && b.P.move > 0.5) this.#steps(b);
    }
    for (const b of [...this.beasts]) if (b.done) this.#remove(b);
    for (const v of [...this.visits]) if (!this.beasts.some((b) => b.visit === v)) this.#ended(v);
    if (posed) this.#blobs();
  }

  /** Two groups meet on their way (in a gap in the shrubs, on the meadow): the one that came later stops until the
   *  other has passed (it is in front of it, or they come closer); a group on its way home goes first. One on its way
   *  that comes up behind an animal of another group standing in the way finds a way round it, and a grazing leader
   *  that sees another group's animal coming at it steps aside. */
  #giveWay(dt) {
    const rank = (b) => ((b.lead || b).state === 'flee' ? 2e9 : 0) + (b.visit?.leaving ? 1e9 : 0) - (b.visit?.log?.t ?? 0);
    for (const b of this.beasts) {
      b.yieldT = Math.max(0, (b.yieldT || 0) - dt);
      b.replanT = Math.max(0, (b.replanT || 0) - dt);
      if (b.aside && !b.path) {
        // stepped aside: on again once nobody with right of way is coming close
        const busy = this.beasts.some((o) => o.visit !== b.visit && (o.speed > 0.15 || o.path) && rank(o) > rank(b) && o.pos.distanceTo(b.pos) < 4.5);
        if (busy) continue;
        const p = this.#pathFrom(b.pos, b.aside.end, b);
        if (p) b.go(p, b.aside.speed);
        b.aside = null;
        continue;
      }
      const bvx = Math.sin(b.yaw) * b.speed, bvz = Math.cos(b.yaw) * b.speed, still = b.speed < 0.1 && !b.path;
      for (const o of this.beasts) {
        if (o.visit === b.visit || b.hold) continue;
        const dx = o.pos.x - b.pos.x, dz = o.pos.z - b.pos.z, d = Math.hypot(dx, dz);
        if (d > 3.6) continue;
        const ahead = !still && (dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw)) > d * 0.3;
        if (o.speed < 0.15) {
          // standing in the way: round it (with the others as places to keep clear of)
          if (ahead && b.path && !b.replanT && b.state !== 'tostation' && !(b.station && d > 2)) {
            b.replanT = 3;
            const end = b.path[b.path.length - 1], to = this.field.open(end.x, end.z) ? end : this.field.nearestOpen(end.x, end.z, 3);
            const from = this.#start(b.pos);
            const p = to && from && this.field.path(from, to, this.#others(b.visit));
            if (p) { if (from !== b.pos) p.unshift(b.pos.clone()); if (to !== end) p.push(end.clone()); b.go(p, b.want); }
          }
          continue;
        }
        const closing = dx * (Math.sin(o.yaw) * o.speed - bvx) + dz * (Math.cos(o.yaw) * o.speed - bvz) < 0;
        if (still) {
          // standing or grazing: a few steps away from the one coming
          if (closing && !b.lead && !b.station && (b.state === 'graze' || b.state === 'look')) {
            const x = b.pos.x - dx / d * 1.8, z = b.pos.z - dz / d * 1.8;
            if (this.field.open(x, z) && this.#clearLine(b.pos, V3(x, z))) b.go([b.pos.clone(), V3(x, z)], 0.6);
          }
          continue;
        }
        if ((ahead || closing) && rank(o) > rank(b)) {
          // out of its way: two metres to the side of the other's way, if there is room, else a stop
          if (!b.aside && b.path && !b.station && (b.state === 'walk' || b.state === 'leave')) {
            const hx = Math.sin(o.yaw), hz = Math.cos(o.yaw), side = Math.sign((b.pos.x - o.pos.x) * hz - (b.pos.z - o.pos.z) * hx) || 1;
            const x = b.pos.x + hz * side * 2.2, z = b.pos.z - hx * side * 2.2, end = b.path[b.path.length - 1];
            if (this.field.open(x, z) && this.field.open(end.x, end.z) && this.#clearLine(b.pos, V3(x, z))) { b.aside = { end: end.clone(), speed: b.want }; b.go([b.pos.clone(), V3(x, z)], b.walk * 0.9); break; }
          }
          b.yieldT = 0.8; break;
        }
      }
    }
  }

  /** Who comes next, and where. 'often' and 'normal': up to a few groups at once, each at a place of its own, first
   *  the place the player is looking at, a new group soon after one has gone; 'rare': one group now and then. */
  #direct(dt) {
    const M = MODES[this.#mode()], W = WEATHER[this.#weather()] || { groups: 0, gap: 1 };
    this.wait -= dt;
    for (const k in this.stageWait) this.stageWait[k] -= dt;
    if (this.wait > 0) return;
    if (!M) {
      // rare: one group at a time, checked every 5 seconds against rate()
      if (this.visits.length) return;
      this.wait = 5;
      if (!this.#watching() || Math.random() > 1 - Math.exp(-this.rate() * 5)) return;
      if (!this.start()) this.wait = 30;
      return;
    }
    this.wait = 1;
    if (!this.#watching()) return;
    const L = this.#light(), want = Math.max(1, M.groups[L.night ? 2 : L.dusk > 0.5 ? 1 : 0] + W.groups);
    const focus = this.#focus(), active = this.visits.filter((v) => !v.leaving), seen = active.some((v) => focus.stages.some((s) => s.id === v.stage));
    // nobody left where the player can see (all on their way home): the next one comes at once (in a storm they keep
    // to the wood: the pauses stay)
    const hurry = !seen && W.gap < 2;
    const free = (s) => !active.some((v) => v.stage === s.id) && (hurry || !(this.stageWait[s.id] > 0)) && !(s.feeder && this.#byFeeder());
    let stage = focus.primary && free(focus.primary) ? focus.primary : null;
    if (!stage) { const c = focus.stages.filter(free); if (c.length) stage = weighted(c, (s) => s.pull); }
    if (!stage) return;
    // a group on its way home counts while it can still be seen from the house (and never more than three of them)
    const shown = this.visits.filter((v) => !v.leaving || this.#inSight(v)).length;
    if (active.length >= want || shown > want || this.visits.length > want + 3) {
      // every place taken: a group that cannot be seen from where the player is now goes home early, to make room for
      // one where he looks
      if (stage === focus.primary) { const idle = active.find((v) => !focus.stages.some((s) => s.id === v.stage)); if (idle) this.#sendHome(idle); }
      return;
    }
    if (this.start(null, stage)) this.wait = hurry ? 2 : rand(...M.next) * W.gap;
    else this.stageWait[stage.id] = 15;
  }
  /** One of the group's animals can be seen from the house. */
  #inSight(v) { return this.beasts.some((b) => b.visit === v && this.views.seen(b.pos.x, b.pos.z)); }
  /** A group has gone ('rare': the next one anywhere after 3 to 4 minutes). */
  #ended(v) {
    const i = this.visits.indexOf(v); if (i >= 0) this.visits.splice(i, 1);
    if (!v.spawned && v.log) v.log.duration = v.t;
    if (!MODES[this.#mode()] && !this.visits.length) this.wait = rand(180, 260);
    if (!v.left) this.#leaving(v);
  }
  /** A group turns to go: its place is free for the next one after a pause (longer at night and in bad weather; in a
   *  storm every place waits). */
  #leaving(v) {
    v.leaving = true; v.left = true; if (v.log) v.log.leftAt = this.clock;
    const M = MODES[this.#mode()], W = WEATHER[this.#weather()] || { gap: 1 };
    if (M) this.stageWait[v.stage] = rand(...M.gap) * W.gap * (this.#light().night ? M.nightGap : 1);
    // in a storm a while before the next group comes anywhere
    if (M && W.gap >= 2) this.wait = Math.max(this.wait, rand(...M.gap) * W.gap * 1.5);
  }
  #sendHome(v) { if (v.lead && !v.lead.gone) this.#leave(v.lead, null, false, 'room'); else this.#leaving(v); }

  /** On its way and not getting anywhere for a while (a group in the way that does not move on, a way that ends in a
   *  tight spot): a new way from where it stands, or home. */
  #unstick(b, dt) {
    const moving = b.path && (b.state === 'walk' || b.state === 'leave' || b.state === 'flee' || b.state === 'tostation');
    if (!moving || !b.stallAt || Math.hypot(b.pos.x - b.stallAt.x, b.pos.z - b.stallAt.z) > 0.6) { b.stallAt = moving ? b.pos.clone() : null; b.stall = 0; return; }
    b.stall += dt;
    if (b.stall < 12) return;
    b.stall = 0; b.stallAt = null; b.unstuck = (b.unstuck || 0) + 1; this.unstuckCount = (this.unstuckCount || 0) + 1;
    const end = b.path[b.path.length - 1];
    if (b.unstuck > 2) { if (b.lead) this.#releaseFollower(b); else if (b.state === 'flee' && b.flight && !b.visit?.leaving) this.#wary(b); else if (b.state === 'leave' || b.state === 'flee') b.done = true; else this.#leave(b, null, false, 'stuck'); return; }
    if (b.station && b.state !== 'leave' && b.state !== 'flee') {
      // another feeding place, or none
      const st = b.station; this.#release(b);
      const next = this.#freeStation(b.kind, b.pos, [st.type === 'salt' ? 'rack' : 'salt', 'rack']);
      const p = next && next !== st && this.#pathTo(b.pos, next.poses[b.kind], b);
      if (p) { this.#take(b, next); b.go(p, b.walk * 0.8); return; }
      if (b.lead) b.setState('follow'); else this.#leave(b, null, false, 'stuck');
      return;
    }
    const p = this.#pathFrom(b.pos, this.field.nearestOpen(end.x, end.z, 3) || end, b);
    if (p) { b.go(p, b.want || b.walk); return; }
    if (!b.lead) this.#leave(b, null, false, 'stuck'); else b.done = true;
  }

  /** Test poses: stands, grazes, looks up, or walks, trots and gallops on the spot, sits (a fox); at the feeding station
   *  eats hay, from the trough or licks salt. */
  #hold(b, dt) {
    const h = b.hold, ps = b.station?.poses[b.kind];
    const r = h === 'rack' ? ps?.rack : h === 'trough' ? ps?.trough : h === 'salt' ? ps?.salt : null;
    b.goal.graze = h === 'graze' ? 1 : r != null ? Math.max(0, r) : 0; b.goal.alert = h === 'alert' ? 1 : r != null ? Math.max(0, -r) : 0;
    b.chewing = r != null && h !== 'salt' ? 1 : 0; b.licking = h === 'salt' ? 1 : 0;
    b.sit = h === 'sit';
    const v = h === 'walk' ? b.walk : h === 'trot' ? b.trotSpeed : h === 'gallop' ? b.gallopSpeed || b.trotSpeed * 1.4 : 0, x = b.pos.x, z = b.pos.z;
    b.speed = v; b.want = 0;
    if (v) { b.P.move = 1; }
    b.pos.x = x; b.pos.z = z;
  }

  /** The leader of a group. */
  #think(b, dt, player) {
    const [alertD, fleeD] = SHY[b.kind], d = player ? Math.hypot(player.x - b.pos.x, player.z - b.pos.z) : Infinity;
    const v = b.visit, M = MODES[this.#mode()];
    // (the time a flight and the calm after it take does not count against the visit)
    if (v && (b.state === 'flee' || b.state === 'wary')) v.lost = (v.lost || 0) + dt;
    if (b.state !== 'flee' && b.state !== 'leave') {
      // a storm that comes up drives them away, a long visit ends; somebody walking up makes them look, coming close
      // makes them run
      if (this.#weather() === 'storm' && !v?.storm) this.#leave(b, null, false, 'storm');
      else if (v && v.t - (v.lost || 0) > (M ? 720 : 300)) this.#leave(b, null, false, 'time');
      else if (b.kind === 'wolf') {
        if (d < fleeD) this.#leave(b, player, true, 'wolf');
        else if (d < alertD && b.state !== 'watch') this.#watch(b);
      } else if (d < fleeD && (this.playerMove > 0.4 || d < fleeD * 0.6)) this.#flee(b, player);
      else if (d < alertD && this.playerMove > 0.4 && b.state !== 'alert' && b.state !== 'wary') {
        // (what it was grazing goes on afterwards)
        b.grazeLeft = b.state === 'graze' || b.state === 'look' ? Math.max(0, b.grazeFor - b.grazeT) : null;
        b.setState('alert'); b.go(null, 0); b.stillT = 0; b.stepped = false;
      }
    } else if (b.state === 'leave' && FLIGHT[b.kind] && d < fleeD && this.playerMove > 0.4) this.#flee(b, player);   // on its way home: it hurries
    const look = (yaw, pitch = 0) => { b.goal.yaw = clamp(wrap(yaw - b.yaw), -1.25, 1.25); b.goal.pitch = pitch; };
    const atPlayer = () => { if (player) look(Math.atan2(player.x - b.pos.x, player.z - b.pos.z), -0.05); };
    switch (b.state) {
      case 'walk':
        b.goal.graze = 0; b.goal.alert = 0; look(b.yaw);
        b.steer(dt, null, b.station ? 0.12 : 0.3);
        if (!b.path && !b.aside) { if (b.station) { b.setState('feed'); b.feedT = 0; } else this.#graze(b); }
        break;
      case 'graze': {
        // head down; a step now and then, a look round now and then
        b.goal.alert = 0; b.grazeT += dt;
        if (b.path) { b.steer(dt); b.goal.graze = 0.6; } else { b.steer(dt); b.goal.graze = 1; }
        b.goal.yaw = Math.sin(b.t * (b.A.spec.deer ? 0.3 : 0.8)) * (b.A.spec.deer ? 0.12 : 0.35);
        b.lookT -= dt;
        if (b.lookT <= 0) { b.lookT = rand(5, 12); b.after = 'graze'; b.setState('look'); b.lookYaw = rand(-1, 1); b.go(null, 0); break; }
        if (!b.path && b.stateT > b.nextStep) { b.nextStep = b.stateT + rand(3, 9); this.#nibble(b); }
        if (b.grazeT > b.grazeFor) this.#moveOn(b);
        break;
      }
      case 'look':
        // it raises its head and looks round; a player outside nearby gets a glance
        b.goal.graze = 0; b.goal.alert = 0.55;
        if (player && d < 40) atPlayer(); else look(b.yaw + b.lookYaw * (b.stateT < 1.4 ? 1 : -0.6), -0.02);
        b.steer(dt); b.grazeT += dt;
        if (b.stateT > 2.8) { b.state = b.after || 'graze'; b.goal.yaw = 0; }
        break;
      case 'alert':
        // head up, ears forward, it stares at the player (turning to keep him in view); when he comes on it takes a few
        // steps away; when he has stood still a while or gone it calms down: back to its grazing, or on its way
        b.goal.graze = 0; b.goal.alert = 1; atPlayer();
        if (player) {
          this.#faceHalf(b, player, dt);
          if (!b.stepped && FLIGHT[b.kind] && d < (alertD + fleeD) / 2 && this.playerMove > 0.4 && b.stateT > 1) this.#stepAway(b, player);
        }
        b.steer(dt);
        b.stillT = this.playerMove < 0.15 && !b.path ? (b.stillT || 0) + dt : 0;
        if (d > alertD + 4 || b.stillT > 6) {
          if (b.station) b.setState('feed');
          else if (b.grazeLeft != null || !this.#walkOn(b)) { this.#graze(b); b.grazeFor = Math.max(rand(8, 18), b.grazeLeft || 0); }
        }
        break;
      case 'wary':
        // after a flight: it stands half turned towards the player, head up, ears forward, and watches him (a fox may sit
        // down to do so); once he has kept away for a while it calms down
        b.goal.graze = 0; b.goal.alert = 1;
        b.steer(dt);
        if (player) {
          this.#faceHalf(b, player, dt); atPlayer();
          if (d < alertD && this.playerMove > 0.4) b.stateT = Math.min(b.stateT, b.waryFor * 0.5);
        } else look(b.yaw);
        if (b.stateT > b.waryFor) this.#relax(b);
        break;
      case 'watch':
        // the wolf: a long look, then it turns away and walks off
        b.goal.graze = 0; b.goal.alert = 1; atPlayer();
        b.steer(dt);
        if (b.stateT > b.watchFor) this.#leave(b, player, false, 'wolf');
        break;
      case 'flee':
        // on the run, head up; it slows to a trot and a walk where it means to stop, then stands and looks back (or, on
        // its way home, goes on into the wood)
        b.goal.graze = 0; b.goal.alert = 0.6; look(b.yaw);
        if (b.flight) this.#flightPace(b, d);
        else if (d > fleeD * 2.2 && b.want > b.walk) b.want = b.walk * 1.15;
        b.steer(dt);
        if (!b.path && !b.aside) {
          if (b.flight && !v?.leaving) this.#wary(b);
          else { b.done = true; for (const f of this.beasts) if (f.lead === b) f.done = true; }
        }
        break;
      case 'leave':
        b.goal.graze = 0; b.goal.alert = 0.2; look(b.yaw + (b.kind === 'wolf' && b.stateT > 3 && b.stateT < 5.5 ? 0.9 : 0));
        b.steer(dt);
        if (!b.path && !b.aside) { b.done = true; for (const f of this.beasts) if (f.lead === b) f.done = true; }
        break;
      default: b.steer(dt); if (b.stateT > 2) this.#graze(b);
    }
  }
  #graze(b) {
    const M = MODES[this.#mode()];
    b.setState('graze'); b.go(null, 0); b.grazeT = 0; b.nextStep = rand(2, 6);
    b.grazeFor = (M ? rand(...M.graze) : rand(10, 24)) * (b.visit?.storm ? 0.4 : 1);
    if (b.resume != null) { b.grazeFor = b.resume; b.resume = null; }   // the rest of what a flight broke off
  }
  /** Done grazing here: on to the next spot of its place, or home. */
  #moveOn(b) {
    const v = b.visit, stage = this.stages.find((s) => s.id === v?.stage);
    // (the pause where a flight ended is no grazing place of its own)
    if (b.extra) b.extra = false; else v.spots = (v.spots ?? 1) - 1;
    if (v.spots > 0 && stage && !v.leaving) {
      if ((this.#shy(v) || (stage.feeder && this.#byFeeder())) && this.#replan(b, stage)) return;
      if (stage.feeder) {
        const st = this.#freeStation(b.kind);
        const p = st && this.#pathTo(b.pos, st.poses[b.kind], b);
        if (p) { this.#take(b, st); b.setState('walk'); b.head(p, b.walk * 0.9); return; }
      } else {
        const s = this.#spot(stage, b.pos), p = s && this.#pathFrom(b.pos, s, b);
        if (p) { b.goalSpot = s; b.setState('walk'); b.head(p, b.walk); return; }
      }
    }
    this.#leave(b, null, false, 'done');
  }
  /** A slow step or two on to fresh grass. */
  #nibble(b) {
    const a = b.yaw + rand(-0.6, 0.6), dd = rand(0.5, 1.6), x = b.pos.x + Math.sin(a) * dd, z = b.pos.z + Math.cos(a) * dd;
    if (this.field.open(x, z) && this.field.lineFree(b.pos.x, b.pos.z, x, z)) b.go([b.pos.clone(), new THREE.Vector3(x, 0, z)], 0.3);
  }
  #watch(b) { b.setState('watch'); b.go(null, 0); b.watchFor = rand(3, 6); }
  /** Home: away from the player (if any) to the edge of the wood, trotting when `hurry`, and out of sight there. `why`
   *  the visit ends ('done', 'chased', 'cornered', 'storm', 'time', 'wolf', 'room', 'stuck'; tests read it). */
  #leave(b, player, hurry = false, why = null) {
    const from = player || b.pos, here = b.pos, stage = this.stages.find((s) => s.id === b.visit?.stage);
    if (why && b.visit && !b.lead && !b.visit.leaving) b.visit.leftFor = why;
    if (b.visit && !b.lead && !b.visit.left) this.#leaving(b.visit);
    if (b.station) b.lastStation = b.station;
    this.#release(b);
    for (const f of this.beasts) if (f.lead === b) this.#releaseFollower(f);
    // by one of the ways into the wood its place has (any place's, when it has none)
    const entries = stage?.entries?.length ? stage.entries : this.stages.flatMap((s) => s.entries);
    const ranked = entries.map((e) => {
      const ax = e.edge.x - here.x, az = e.edge.z - here.z, da = Math.hypot(ax, az) || 1;
      const away = player ? ((here.x - from.x) * ax + (here.z - from.z) * az) / (da * (Math.hypot(here.x - from.x, here.z - from.z) || 1)) : 0;
      // not where another group comes in or goes out
      const busy = this.beasts.some((o) => o !== b && o.lead !== b && (o.exit === e.hide || (o.visit?.entry === e && o.visit.t < 60)));
      return { e, score: da * 0.02 - away * 1.5 + Math.random() * 0.4 + (busy ? 5 : 0) };
    }).sort((a, b2) => a.score - b2.score);
    b.setState('leave');
    for (const { e } of ranked.slice(0, 6)) {
      const p = this.#pathFrom(here, e.edge, b);
      if (p) {
        if (e.hide !== e.edge) p.push(e.hide.clone());
        b.exit = e.hide;
        b.head(p, hurry ? b.trotSpeed * 0.85 : b.walk); return;
      }
    }
    b.go(null, 0); b.done = true;
  }
  /** A follower leaves its feeding place: it steps back out of it before it follows the leader again (in a `hurry`
   *  out past the point in front of it without stopping there). */
  #releaseFollower(f, hurry = false) {
    const ps = this.#standAt(f.pos, f);
    if (ps) {
      f.exitTo = ps.out.clone(); f.exitT = 15; f.exitHurry = hurry;
      const far = ps.out.clone().sub(ps.stand).setY(0).normalize().multiplyScalar(1.5).add(ps.out);
      if (hurry && this.field.open(far.x, far.z) && this.#clearLine(ps.out, far)) f.exitTo = far;
    }
    this.#release(f);
    if (f.state !== 'follow') f.setState('follow');
  }

  // ------------------------------------------------------------------ the flight ----
  /** The player came too close: off it trots, briskly (quicker than its ordinary trot, never a gallop), over open
   *  ground to a place a little way off where he still sees it; there it stops, looks back and calms down, and its visit
   *  goes on. Made to run a third time within CHASE.window seconds, or hemmed in, the group makes for the wood. */
  #flee(b, player) {
    const v = b.visit;
    // what it was eating it finishes elsewhere afterwards: the rest of its grazing, or of its meal at the rack
    const rest = b.station ? Math.max(15, (b.feedFor ?? 0) - (b.feedT || 0)) : b.state === 'graze' || b.state === 'look' ? Math.max(10, b.grazeFor - b.grazeT) : b.state === 'alert' ? b.grazeLeft : null;
    if (b.resume == null && rest != null) b.resume = rest;
    if (v) {
      v.flights = (v.flights || []).filter((t) => this.clock - t < CHASE.window); v.flights.push(this.clock);
      v.scare = { x: b.pos.x, z: b.pos.z, t: this.clock };
    }
    const t0 = performance.now(), path = v && !v.leaving && v.flights.length < CHASE.flights ? this.#flightPath(b, player) : null;
    this.planMs = Math.max(this.planMs || 0, performance.now() - t0);
    if (!path) {
      this.#leave(b, player, true, v && v.flights.length >= CHASE.flights ? 'chased' : 'cornered');
      b.setState('flee'); this.#bolt(b);
      return;
    }
    if (b.station) b.lastStation = b.station;
    this.#release(b);
    for (const f of this.beasts) if (f.lead === b) this.#releaseFollower(f, true);   // the fawn leaves the trough and runs with her
    b.setState('flee'); b.head(path, 0); b.goalSpot = null; this.#bolt(b);
  }
  /** Off at the pace of its flight (a brisk trot, the same whether the player walked or ran at it), swinging round
   *  first, gently getting going. */
  #bolt(b) {
    const f = FLIGHT[b.kind] || FLIGHT.roe, run = f.trot * rand(0.96, 1.04);
    b.flight = { speed: run, t: this.clock }; b.want = run;
    b.accel = f.accel; b.brake = f.brake; b.spin = true; b.sit = false;
  }
  /** Where it runs to: open ground in the garden (or just at the edge of the wood) the stop distance away from the
   *  player, as nearly straight away from him as it can, where he can still see it, not where another group grazes. The
   *  way there never comes nearer to him than it is now and is not much longer than the straight line. Null when there
   *  is no such place: he has driven it to the edge of the wood. */
  #flightPath(b, pp) {
    const F = this.field, f = FLIGHT[b.kind], d0 = Math.hypot(b.pos.x - pp.x, b.pos.z - pp.z), away = Math.atan2(b.pos.x - pp.x, b.pos.z - pp.z);
    const ps = this.#standAt(b.pos, b), from = ps ? F.nearestOpen(ps.out.x, ps.out.z, 2) : this.#start(b.pos);
    if (!from) return null;
    const reg = F.regionAt(from.x, from.z), flat = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);
    const others = this.visits.filter((o) => o !== b.visit).flatMap((o) => (o.lead && !o.lead.gone ? [o.lead.goalSpot || o.lead.pos] : []));
    const cand = [];
    // (a run of at least 8 m: a few seconds at the trot, not a step or two)
    for (let R = f.stop[0]; R <= f.stop[1]; R += 2) for (let k = -7; k <= 7; k++) {
      const a = away + k * 0.18, x = pp.x + Math.sin(a) * R, z = pp.z + Math.cos(a) * R, run = Math.hypot(x - b.pos.x, z - b.pos.z);
      if (run < 8 || !F.open(x, z) || F.regionAt(x, z) !== reg) continue;
      let room = 0; for (let m = 0; m < 8; m++) if (F.free(x + Math.cos(m * TAU / 8) * 2.5, z + Math.sin(m * TAU / 8) * 2.5)) room++;
      if (room < 7) continue;
      const garden = OUTDOOR.inRegion(x, z) ? 1 : 0;
      if (!garden && !OUTDOOR.inRegion(x + (pp.x - x) * 3 / R, z + (pp.z - z) * 3 / R)) continue;
      const seen = this.#inView(pp, x, z) ? 1 : 0, crowd = others.some((o) => flat(o, { x, z }) < 14) ? 1 : 0;
      cand.push({ to: V3(x, z), run, score: 1.2 * Math.cos(k * 0.18) + 1.2 * seen + 0.6 * garden - 2 * crowd - run / 70 - Math.abs(R - f.stop[0] - 4) / 25 + Math.random() * 0.3 });
    }
    cand.sort((p, q) => q.score - p.score);
    const keep = [{ x: pp.x, z: pp.z, r: Math.max(4, d0 - 2.5) }];
    for (const avoid of [[...keep, ...this.#others(b.visit, false)], keep]) {
      for (const c of cand.slice(0, 5)) {
        const p = this.#pathAvoiding(b, c.to, avoid, 3000);
        if (!p) continue;
        let len = 0, near = Infinity;
        for (let i = 1; i < p.length; i++) { len += flat(p[i], p[i - 1]); near = Math.min(near, segDist(pp, p[i - 1], p[i])); }
        if (len < c.run * 1.5 + 8 && near > d0 - 3) return p;
      }
    }
    return null;
  }
  /** Would the player at `pp` (his eye) see an animal standing at (x, z): nothing that hides it (trunks, shrubs, the
   *  low branches of spruces) and no rise of the ground (the knoll) between his eye and its back? */
  #inView(pp, x, z) {
    if (!this.views.clear(pp.x, pp.z, x, z)) return false;
    const H = this.G.height, y1 = H(x, z) + 0.6;
    for (let k = 1; k < 16; k++) { const t = k / 16; if (H(pp.x + (x - pp.x) * t, pp.z + (z - pp.z) * t) > pp.y + (y1 - pp.y) * t - 0.05) return false; }
    return true;
  }
  /** A way from where `b` stands to `goal` round `avoid` (from a feeding place it steps back out of it first). */
  #pathAvoiding(b, goal, avoid, budget) {
    const ps = this.#standAt(b.pos, b);
    if (ps) {
      const o = this.field.nearestOpen(ps.out.x, ps.out.z, 2), p = o && this.field.path(o, goal, avoid, budget);
      return p && [b.pos.clone(), ps.out.clone(), ...p.slice(o.distanceTo(ps.out) < 0.3 ? 1 : 0)];
    }
    const start = this.#start(b.pos), p = start && this.field.path(start, goal, avoid, budget);
    if (p && start !== b.pos) p.unshift(b.pos.clone());
    return p;
  }
  /** On the run: at the pace of its flight until near the end of its way (the stop lies inside its alert distance),
   *  then an easier trot over the last metres, a walk and a stop; on its way home it slows to a walk once well away
   *  from him. */
  #flightPace(b, d) {
    const alertD = SHY[b.kind][0], run = b.flight.speed;
    if (b.visit?.leaving) { b.want = d < alertD ? run : d < alertD + 12 ? Math.min(run, b.trotSpeed * 0.9) : b.walk * 1.15; return; }
    const left = this.#pathLeft(b);
    b.want = left > 4 ? run : left > 1.8 ? Math.max(b.walk * 1.2, Math.min(run, b.trotSpeed * 0.85)) : b.walk;
  }
  /** How far it still has to go on its way (m). */
  #pathLeft(b) {
    const P = b.path; if (!P) return 0;
    let s = Math.hypot(P[b.pathI].x - b.pos.x, P[b.pathI].z - b.pos.z);
    for (let i = b.pathI + 1; i < P.length; i++) s += Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z);
    return s;
  }
  /** At the end of its flight: it stops and watches the player for a while (a fox may sit down to do so), the longer
   *  the more often he has made it run. */
  #wary(b) {
    const f = FLIGHT[b.kind] || FLIGHT.roe;
    b.setState('wary'); b.go(null, 0); b.flight = null; b.accel = 0; b.brake = 0; b.spin = false;
    b.waryFor = rand(...f.watch) * (1 + 0.3 * Math.max(0, (b.visit?.flights?.length || 1) - 1));
    b.sit = !!f.sit && Math.random() < (this.sitOverride ?? f.sit);   // (tests: sitOverride 0 or 1)
  }
  /** Calm again: a few mouthfuls where it stands, then on to grazing places away from the player and from where he
   *  startled it (#moveOn, #replan); what the flight broke off it finishes there. */
  #relax(b) {
    const rest = b.resume; b.resume = null; b.sit = false;
    this.#graze(b); b.grazeFor = rand(10, 22); b.extra = true; b.resume = rest;
  }
  /** It turns on the spot until the player is no further round than its head can turn: half towards him. */
  #faceHalf(b, p, dt) {
    if (b.speed > 0.2 || b.path) return;
    const to = Math.atan2(p.x - b.pos.x, p.z - b.pos.z), e = wrap(to - b.yaw);
    if (Math.abs(e) > 1.15) b.face(to - Math.sign(e) * 0.8, dt);
  }
  /** The player keeps coming: a few slow steps away (over its shoulder it keeps an eye on him). */
  #stepAway(b, p) {
    b.stepped = true;
    const a = Math.atan2(b.pos.x - p.x, b.pos.z - p.z);
    for (const da of [0, 0.5, -0.5, 1, -1]) {
      const r = rand(3, 5), q = V3(b.pos.x + Math.sin(a + da) * r, b.pos.z + Math.cos(a + da) * r);
      if (this.field.open(q.x, q.z) && this.#clearLine(b.pos, q)) { b.go([b.pos.clone(), q], b.walk * 0.9); return; }
    }
  }
  /** The alert is over and it was on its way to a grazing place: on it goes. */
  #walkOn(b) {
    const p = b.goalSpot && this.#pathFrom(b.pos, b.goalSpot, b);
    if (!p) return false;
    b.setState('walk'); b.head(p, b.walk); return true;
  }
  /** The player startled this group a short while ago and is still outside: it keeps away from him. */
  #shy(v) {
    const pp = this.world.player.position;
    return !!v?.scare && this.clock - v.scare.t < CHASE.window && !this.G.indoors(pp) && this.world.actions?.seatedId !== 'feederhide';
  }
  /** The player stands outside within `r` m of the feeding station (not sitting in the hide): the deer keep away from it. */
  #byFeeder(r = 20) {
    const pp = this.world.player.position, FD = OUTDOOR.feeder;
    return !this.G.indoors(pp) && this.world.actions?.seatedId !== 'feederhide' && Math.hypot(pp.x - FD.x, pp.z - FD.z) < r;
  }
  /** After a flight (or with the player by the rack), the next place: back to the rack only when he is away from it
   *  (well away after a flight from there), else a grazing place away from him and from where he startled it, or on
   *  grazing where it is. */
  #replan(b, stage) {
    if (stage.feeder && !this.#byFeeder(this.#shy(b.visit) ? 32 : 20)) return false;
    const t0 = performance.now(), r = this.#refuge(b);
    this.planMs = Math.max(this.planMs || 0, performance.now() - t0);
    if (r) { b.goalSpot = r.spot; b.setState('walk'); b.head(r.path, b.walk); return true; }
    this.#graze(b); b.goalSpot = b.pos.clone(); return true;
  }
  /** A grazing place for a group the player has startled (or kept from the rack): any place on its side of the house,
   *  its alert distance from him (and a way there that comes no nearer to him than it stands now: it stopped inside
   *  that distance), away from where he startled it, not where another group grazes, the nearer ones first, and no long
   *  way round to get there (round the lake, or round the player). { spot, path } or null. */
  #refuge(b) {
    const v = b.visit, pp = this.world.player.position, S = v.scare, room = !!this.stages.find((s) => s.id === v.stage)?.room;
    const safe = Math.max(FLIGHT[b.kind]?.stop[1] ?? 30, SHY[v.kind]?.[0] ?? 0), keep = Math.min(SHY[v.kind]?.[0] - CLEAR + 1, Math.hypot(b.pos.x - pp.x, b.pos.z - pp.z) - 1);
    const others = this.visits.filter((o) => o !== v).flatMap((o) => (o.lead && !o.lead.gone ? [o.lead.goalSpot || o.lead.pos] : []));
    // (on this side of him and of the lake: a place it would have to go round him or the water for is not worth a search)
    const across = (s) => { for (let k = 1; k < 8; k++) if (OUTDOOR.lakeDist(b.pos.x + (s.x - b.pos.x) * k / 8, b.pos.z + (s.z - b.pos.z) * k / 8) < 1.05) return true; return false; };
    const c = [];
    for (const st of this.stages) {
      if (!!st.room !== room) continue;
      for (const s of st.spots) {
        const dh = Math.hypot(s.x - b.pos.x, s.z - b.pos.z);
        // (not back towards where he startled it: no nearer to there than it stands now, and 12 m at least)
        if (dh < 6 || dh > 60 || Math.hypot(s.x - pp.x, s.z - pp.z) < safe || (S && Math.hypot(s.x - S.x, s.z - S.z) < Math.max(12, Math.hypot(b.pos.x - S.x, b.pos.z - S.z) - 2))) continue;
        if (segDist(pp, b.pos, s) < keep || across(s) || others.some((o) => Math.hypot(s.x - o.x, s.z - o.z) < 14)) continue;
        c.push(s);
      }
    }
    for (let n = 0; n < 5 && c.length; n++) {
      const s = weighted(c, (p) => p.w / (1 + Math.hypot(p.x - b.pos.x, p.z - b.pos.z) / 20));
      c.splice(c.indexOf(s), 1);
      const spot = s.clone().add(new THREE.Vector3(rand(-0.8, 0.8), 0, rand(-0.8, 0.8))), start = this.#start(b.pos);
      const path = start && this.field.path(start, spot, this.#others(v), 2000);
      if (!path) continue;
      if (start !== b.pos) path.unshift(b.pos.clone());
      let len = 0, near = Infinity;
      for (let i = 1; i < path.length; i++) { len += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z); near = Math.min(near, segDist(pp, path[i - 1], path[i])); }
      if (len < Math.hypot(spot.x - b.pos.x, spot.z - b.pos.z) * 1.5 + 10 && near > keep - 2) return { spot, path };
    }
    return null;
  }

  /** At the feeding station: walk in, eat hay from the rack, from the trough under it or lick the salt, chewing, a pull
   *  at the hay now and then, look up and round between bites, ears flicking; after a while back to the others, or
   *  home. */
  #feed(b, dt, player) {
    const st = b.station, ps = st.poses[b.kind], lead = !b.lead;
    if (!ps) { this.#release(b); return; }
    if (lead) {
      // the leader stays shy: somebody walking up makes it look, coming close makes it go
      const [alertD, fleeD] = SHY[b.kind], d = player ? Math.hypot(player.x - b.pos.x, player.z - b.pos.z) : Infinity;
      if (this.#weather() === 'storm' && !b.visit?.storm) { this.#leave(b, null, false, 'storm'); return; }
      if (d < fleeD && (this.playerMove > 0.4 || d < fleeD * 0.6)) { this.#flee(b, player); return; }
      if (d < alertD && this.playerMove > 0.4 && b.state !== 'alert') { b.lastStation = st; b.setState('alert'); b.chewing = 0; return; }
      if (b.state === 'alert') {
        b.goal.graze = 0; b.goal.alert = 1; b.goal.yaw = player ? clamp(wrap(Math.atan2(player.x - b.pos.x, player.z - b.pos.z) - b.yaw), -1.25, 1.25) : 0;
        b.steer(dt);
        if (d > alertD + 4 || (this.playerMove < 0.15 && b.stateT > 7)) {
          // (looked up on its way to the rack: on it goes)
          const p = Math.hypot(b.pos.x - ps.stand.x, b.pos.z - ps.stand.z) > 0.5 && this.#pathTo(b.pos, ps, b);
          if (p) { b.setState('walk'); b.go(p, b.walk * 0.8); } else b.setState('feed');
        }
        return;
      }
    } else if (!b.lead || b.lead.gone || b.lead.done || b.lead.state === 'leave' || b.lead.state === 'flee') { this.#releaseFollower(b); return; }
    if (b.state === 'tostation') {
      // a follower walks to its place: to the point in front of it, then straight in
      if (!b.path) b.go([b.pos.clone(), ps.out.clone(), ps.stand.clone()], b.walk * 0.8);
      b.goal.graze = 0; b.goal.alert = 0; b.goal.yaw = 0;
      b.steer(dt, null, 0.12);
      if (!b.path) { b.setState('feed'); b.feedT = 0; }
      return;
    }
    if (b.state === 'look') {
      // head up out of the rack, a look round, back to the food
      b.chewing = 0.6; b.licking = 0; b.goal.graze = 0; b.goal.alert = 0.6;
      b.goal.yaw = clamp(b.lookYaw * (b.stateT < 1.5 ? 1 : -0.5), -1, 1); b.goal.pitch = -0.03;
      if (b.stateT > 3) { b.setState('feed'); b.goal.yaw = 0; }
      return;
    }
    // feeding
    const M = MODES[this.#mode()];
    if (b.feedFor == null && b.resume != null) { b.feedFor = b.resume; b.resume = null; }   // the rest of a meal a flight broke off
    b.feedFor ??= (M ? rand(...M.feed) : rand(40, 90)) * (lead ? 1 : rand(0.6, 1.1));
    b.feedT = (b.feedT || 0) + dt;
    b.face(ps.yaw, dt); b.speed = Math.max(0, b.speed - dt * 2); b.want = 0;
    // pick what to eat: hay from the rack, now and then from the trough; at the salt lick, salt
    if (b.food == null || b.feedT > (b.foodT || 0)) {
      b.food = st.type === 'salt' ? 'salt' : ps.rack == null ? 'trough' : ps.trough != null && Math.random() < 0.3 ? 'trough' : 'rack';
      b.foodT = b.feedT + rand(12, 30);
    }
    const r = b.food === 'salt' ? ps.salt : b.food === 'trough' ? ps.trough : ps.rack;
    b.goal.graze = Math.max(0, r); b.goal.alert = Math.max(0, -r); b.goal.yaw = 0; b.goal.pitch = 0;
    b.chewing = b.food === 'salt' ? 0.3 : 1; b.licking = b.food === 'salt' ? 1 : 0;
    if (b.food === 'rack') { b.tugT = (b.tugT ?? rand(1, 4)) - dt; if (b.tugT <= 0) { b.tugT = rand(2.5, 7); b.tug = 1; } }
    b.lookT -= dt;
    if (b.lookT <= 0) { b.lookT = rand(6, 15); b.lookYaw = rand(-1, 1); b.setState('look'); return; }
    if (b.feedT > b.feedFor) {
      b.lastStation = st;
      if (lead) {
        // enough: on to another place (the salt, the rack) or home
        b.visit.spots = (b.visit.spots ?? 1) - 1;
        const next = b.visit.spots > 0 && !b.visit.leaving && this.#freeStation(b.kind, b.pos, st.type === 'salt' ? ['rack'] : ['salt', 'rack']);
        const p = next && this.#pathTo(b.pos, next.poses[b.kind], b);
        if (p) { b.lastStation = st; this.#take(b, next); b.feedT = 0; b.food = null; b.setState('walk'); b.go(p, b.walk * 0.8); return; }
        this.#leave(b, null, false, 'done');
      } else this.#releaseFollower(b);
    }
  }

  /** The fawn (or a second doe): along the leader's trail while she walks, beside her while she grazes, and at the
   *  feeding station at a place of its own next to hers. */
  #follow(b, dt, player) {
    const m = b.lead;
    if (!m || m.gone || m.done) { b.done = true; return; }
    if (b.exitTo) {
      // out of its feeding place first, the way it came in
      b.want = m.state === 'flee' ? m.flight?.speed || b.trotSpeed * 1.25 : b.walk * 0.8; b.goal.graze = 0; b.goal.alert = m.P.alert * 0.5; b.goal.yaw = 0;
      if (m.state === 'flee') { b.accel = m.accel; b.brake = m.brake; b.spin = true; }
      b.steer(dt, b.exitTo, 0.3, !b.exitHurry);
      b.exitT -= dt;
      if (Math.hypot(b.pos.x - b.exitTo.x, b.pos.z - b.exitTo.z) < (b.exitHurry ? 1 : 0.35) || b.exitT < 0) b.exitTo = null;
      return;
    }
    // the leader eats at the feeding station: take a free place near hers (the fawn the trough), walk there
    if (m.station && m.state !== 'walk' && !b.station && (b.stateT > 2 || b.state !== 'follow')) {
      const st = this.#freeStation(b.kind, m.pos, ['rack', 'salt']);
      if (st && this.#clearLine(b.pos, st.poses[b.kind].out)) { this.#take(b, st); b.setState('tostation'); b.go(null, 0); return; }
    }
    const moving = m.speed > 0.2 || m.path;
    let target;
    if (moving) {
      target = m.trailPoint(b.kind === 'fawn' ? 1.7 : 2.6); b.side = null;
      // (on the run it heads where she runs to, from the moment she bolts; its pace keeps it behind her)
      if (m.state === 'flee') {
        // (towards her next turn, tested over the first 8 m of the way there)
        const q = m.path?.[m.pathI] || V3(m.pos.x + Math.sin(m.yaw) * 3, m.pos.z + Math.cos(m.yaw) * 3), qd = Math.hypot(q.x - b.pos.x, q.z - b.pos.z);
        if (this.#clearLine(b.pos, qd > 8 ? V3(b.pos.x + (q.x - b.pos.x) * 8 / qd, b.pos.z + (q.z - b.pos.z) * 8 / qd) : q)) target = q;
      }
      // round a corner: the newest point of her trail it can reach in a straight line (she walked only open ground). The
      // line is tested against the obstacles themselves: her trail may graze the grid's safety margin, and from in there
      // every grid line would fail.
      if (!this.#clearLine(b.pos, target)) {
        for (let i = m.trail.length - 1; i >= 0; i--) if (this.#clearLine(b.pos, m.trail[i])) { target = m.trail[i]; break; }
      }
    }
    else {
      if (!b.side || b.side.distanceTo(m.pos) > 3.2) {
        for (let k = 0; k < 8; k++) {
          const a = m.yaw + Math.PI * (0.45 + Math.random() * 1.1) * (Math.random() < 0.5 ? -1 : 1), r = rand(1.3, 2.4);
          const s = new THREE.Vector3(m.pos.x + Math.sin(a) * r, 0, m.pos.z + Math.cos(a) * r);
          if (this.field.open(s.x, s.z) && this.#clearLine(b.pos, s)) { b.side = s; break; }
        }
      }
      target = b.side || b.pos.clone();
    }
    // an animal of another group close by: a step aside, away from it
    for (const o of this.beasts) {
      if (o.visit === b.visit) continue;
      const ox = b.pos.x - o.pos.x, oz = b.pos.z - o.pos.z, od = Math.hypot(ox, oz);
      if (od < 3 && od > 1e-3) { if (target === b.pos || target === b.side) target = target.clone(); target = target.clone().add(this._v.set(ox / od, 0, oz / od).multiplyScalar((3 - od) * 0.9)); }
    }
    const d = Math.hypot(target.x - b.pos.x, target.z - b.pos.z);
    b.path = null;
    b.want = d < 0.35 ? 0 : d > 4 ? b.trotSpeed : d > 1.3 ? b.walk * 1.1 : b.walk * 0.5;
    // (on the run it keeps up with her, some three metres behind her: faster than she is while it lags, slower while it
    // is beside or ahead of her, as quick to start and to stop, but never faster than a brisk trot of its own, so that
    // it does not break into the gallop; her trot otherwise it matches as before)
    if (m.state === 'flee') {
      const dm = Math.hypot(m.pos.x - b.pos.x, m.pos.z - b.pos.z), ahead = (b.pos.x - m.pos.x) * Math.sin(m.yaw) + (b.pos.z - m.pos.z) * Math.cos(m.yaw);
      b.want = Math.min(b.trotSpeed * 1.5, m.speed * (ahead > -1 || dm < 2 ? 0.8 : clamp(1 + 0.2 * (dm - 3), 0.8, 1.45)));
    } else if (m.P.trot > 0.5) b.want = Math.max(b.want, Math.min(b.trotSpeed, m.speed * 1.05));
    b.accel = m.accel; b.brake = m.brake; b.spin = m.spin;
    b.steer(dt, d < 0.35 ? null : target, 0.3, m.state !== 'flee');
    // it copies its mother: grazing, looking up
    const still = b.speed < 0.1;
    b.goal.graze = still && m.P.graze > 0.5 ? 1 : 0;
    b.goal.alert = m.P.alert;
    b.goal.yaw = still ? ((m.state === 'alert' || m.state === 'wary') && player ? clamp(wrap(Math.atan2(player.x - b.pos.x, player.z - b.pos.z) - b.yaw), -1.2, 1.2) : Math.sin(b.t * 0.5) * 0.3) : 0;
    b.goal.tilt = still && b.kind === 'fawn' ? Math.sin(b.t * 0.23) * 0.12 : 0;
  }

  /** Nothing in the way between a and b (sampled every 0.3 m against the obstacles, 0.35 m round them). */
  #clearLine(a, b) {
    const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(d / 0.3);
    for (let i = 1; i <= n; i++) if (this.obstacleAt(a.x + (b.x - a.x) * i / n, a.z + (b.z - a.z) * i / n, 0.35)) return false;
    return true;
  }
  /** A print in the snow where a foot comes down. */
  #steps(b) {
    const offs = legOffsets(b.P.trot, b.P.gallop), prev = b.legPh || (b.legPh = [0, 0, 0, 0]);
    for (let i = 0; i < 4; i++) {
      const ph = (((b.P.phase + offs[i]) % 1) + 1) % 1;
      if (prev[i] > 0.75 && ph < 0.25) {
        const bone = b.A.legs[i][3], set = this.prints[b.A.spec.deer ? 0 : 1], k = b.A.spec.k;
        bone.updateWorldMatrix(true, false); bone.getWorldPosition(this._s);
        if (this.world.tracks) { this.world.tracks.animal(b.A.spec.deer, this._s.x, this._s.z, b.yaw, i, k * b.scale); prev[i] = ph; continue; }   // pressed into the snow (tracks.js)
        const len = b.A.spec.deer ? 0.05 + 0.025 * k : 0.03 + 0.03 * k;   // a roe deer's print is 7.5 cm long, a wolf's 9
        this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, b.yaw);
        this._s.y = this.G.height(this._s.x, this._s.z) + 0.015;
        this._m.compose(this._s, this._q, this._v.set(len * 0.8, 1, len));
        const n = set.userData.next; set.setMatrixAt(n, this._m); set.userData.next = (n + 1) % 160;
        set.count = Math.max(set.count, n + 1); set.visible = true; set.instanceMatrix.needsUpdate = true;
        set.material.opacity = 0.4; this.tracks = 1;
      }
      prev[i] = ph;
    }
  }
  /** The tracks stay while the animals are out and it snows, then fade within a minute. */
  #fadeTracks(dt) {
    if (this.beasts.length && this.#snowOnGround()) return;
    this.tracks = Math.max(0, this.tracks - dt / (this.#snowOnGround() ? 60 : 4));
    for (const m of this.prints) { m.material.opacity = 0.4 * this.tracks; if (!this.tracks) { m.count = 0; m.visible = false; m.userData.next = 0; } }
  }
  /** The soft shadow under every animal. */
  #blobs() {
    let n = 0;
    for (const b of this.beasts) {
      if (n >= this.blobs.instanceMatrix.count) break;
      const L = LEAN[b.kind];
      this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, b.yaw);
      this._m.compose(this._s.set(b.pos.x, b.pos.y + 0.03, b.pos.z), this._q, this._v.set(L * 1.35, 1, L * 3.4));
      this.blobs.setMatrixAt(n++, this._m);
    }
    this.blobs.count = n; this.blobs.visible = n > 0; this.blobs.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------ tests ----
  /**
   * Run the scheduler and the visits quickly (no posing). `mode` the setting, `side` where the player looks out from
   * ('north', 'south', 'east', 'west'; null: from the hall), `watching` false: nothing may start. Returns the visits,
   * the most groups and animals out at once, the shortest pause between two visits of one place, how much of the time
   * an animal was in sight of the house (`seen`, and per window side `bySide`), the longest time nothing was in sight
   * once the first had come (`maxDark`, ending at `darkAt`), two settled groups at one place (`shared`), the nearest
   * two groups came (`crowd`, m; `crowdSeen`: where one of them was in sight of the house; `close`: the share of that
   * time two groups were within 4 m) and steps into obstacles. `probe(t, mask)` is called once a second.
   */
  simulate(seconds, { hour = null, weather = null, watching = true, step = 0.1, mode = null, side = null, probe = null } = {}) {
    this.clear(); this.#prepare(true);
    const saved = [this.hourOverride, this.weatherOverride, this.watchOverride, this.log, this.clock, this.modeOverride, this.focusOverride, this.wait, { ...this.stageWait }, this.lastWolf];
    this.hourOverride = hour; this.weatherOverride = weather; this.watchOverride = watching; this.log = []; this.clock = 0; this.modeOverride = mode; this.stageWait = {}; this.lastWolf = undefined; this.unstuckCount = 0;
    this.focusOverride = this.focusFor(side) || this.focusFor('north');
    const M = MODES[this.#mode()]; this.wait = M ? rand(...M.first) : rand(70, 160);
    let maxBeasts = 0, maxGroups = 0, maxSettled = 0, bad = 0, margin = 0, shared = 0, crowd = Infinity, crowdAt = null, crowdSeen = Infinity, crowdSeenAt = null, close = 0, seen = 0, samples = 0, dark = 0, maxDark = 0, darkAt = null, first = null;
    const lingering = [];
    const bySide = Object.fromEntries(WINDOW_SIDES.map((s) => [s.id, 0])), badList = [];
    for (let t = 0, next = 0; t < seconds; t += step) {
      this.update(step, false);
      const leads = this.beasts.filter((b) => !b.lead);
      maxBeasts = Math.max(maxBeasts, this.beasts.length); maxGroups = Math.max(maxGroups, leads.length);
      maxSettled = Math.max(maxSettled, this.visits.filter((v) => !v.leaving).length);
      // visits of more than a quarter of an hour (and, `t2`, of more than half an hour): what their animals do
      for (const v of this.visits) {
        if (v.t > 900 && !v.reported && lingering.length < 6) { v.reported = lingering.push({ t: Math.round(t), kind: v.kind, stage: v.stage, leaving: !!v.leaving, animals: this.beasts.filter((b) => b.visit === v).map((b) => `${b.kind}:${b.state}:${b.stateT.toFixed(0)}${b.station ? ':' + b.station.id : ''}${b.path ? ':path' + b.pathI + '/' + b.path.length : ''}${b.aside ? ':aside' : ''}@${b.pos.x.toFixed(1)},${b.pos.z.toFixed(1)} v${b.speed.toFixed(2)}`) }); }
        if (v.t > 1800 && v.reported && !v.reported2) { v.reported2 = true; const l = lingering[v.reported - 1]; if (l) l.t2 = Math.round(t); }
      }
      const stagesNow = this.visits.filter((v) => !v.leaving).map((v) => v.stage);
      if (new Set(stagesNow).size < stagesNow.length) shared++;
      for (const b of this.beasts) {
        if (!this.field.free(b.pos.x, b.pos.z) && !b.station) margin++;
        if (this.obstacleAt(b.pos.x, b.pos.z)) { bad++; if (badList.length < 12) badList.push(`${b.kind}:${b.state}@${b.pos.x.toFixed(1)},${b.pos.z.toFixed(1)}`); }
        for (const o of this.beasts) if (o.visit !== b.visit && b.pos.distanceTo(o.pos) < crowd) { crowd = b.pos.distanceTo(o.pos); crowdAt = `${b.kind}:${b.state}/${o.kind}:${o.state}@${b.pos.x.toFixed(1)},${b.pos.z.toFixed(1)} t${t}`; }
      }
      if (t < next) continue;
      next += 1;
      // once a second: who is in sight of the house, how near two groups come where they can be seen, and how often
      // two groups are within 4 m of each other there
      samples++;
      let mask = 0;
      const seenB = this.beasts.map((b) => this.views.seen(b.pos.x, b.pos.z));
      for (const m of seenB) mask |= m;
      let near = false;
      for (let i = 0; i < this.beasts.length; i++) for (let j = i + 1; j < this.beasts.length; j++) {
        const a = this.beasts[i], b = this.beasts[j], d = a.pos.distanceTo(b.pos);
        if (a.visit === b.visit || !(seenB[i] || seenB[j])) continue;
        if (d < 4) near = true;
        if (d < crowdSeen) { crowdSeen = d; crowdSeenAt = `${a.kind}:${a.state}/${b.kind}:${b.state}@${a.pos.x.toFixed(1)},${a.pos.z.toFixed(1)}`; }
      }
      if (near) close++;
      WINDOW_SIDES.forEach((s, i) => { if (mask & (1 << i)) bySide[s.id]++; });
      probe?.(t, mask);
      if (mask) { seen++; dark = 0; first ??= t; } else if (first != null) { dark += 1; if (dark > maxDark) { maxDark = dark; darkAt = Math.round(t); } }
    }
    const visits = this.log; this.clear();
    [this.hourOverride, this.weatherOverride, this.watchOverride, this.log, this.clock, this.modeOverride, this.focusOverride, this.wait, this.stageWait, this.lastWolf] = saved;
    // the pause between the end of one visit and the start of the next one at the same place (rare: anywhere)
    const gaps = [];
    for (let i = 1; i < visits.length; i++) {
      const prev = [...visits.slice(0, i)].reverse().find((v) => (M ? v.stage === visits[i].stage : true) && v.duration != null);
      if (prev) gaps.push(visits[i].t - prev.t - prev.duration);
    }
    for (const s in bySide) bySide[s] = +(bySide[s] / Math.max(1, samples)).toFixed(3);
    return { seconds, visits, perHour: visits.length / (seconds / 3600), maxBeasts, maxGroups, maxSettled, minGap: gaps.length ? Math.min(...gaps) : null, bad, badList, margin, shared, crowd: crowd === Infinity ? null : +crowd.toFixed(1), crowdAt, crowdSeen: crowdSeen === Infinity ? null : +crowdSeen.toFixed(1), crowdSeenAt, close: +(close / Math.max(1, seen)).toFixed(3), unstuck: this.unstuckCount, lingering, seen: +(seen / Math.max(1, samples)).toFixed(3), bySide, maxDark, darkAt, first };
  }
  /** Is (x, z) at a tree, in the lake, at the house or on the terrace and its lawn (`r` m round the obstacles)? */
  obstacleAt(x, z, r = 0.25) { const g = (this._raw ||= {}); g[r] ||= wildlifeGround(this.world, r); return g[r].blocked(x, z); }
  /** The animals as they are now. */
  info() {
    return {
      enabled: this.enabled, mode: this.#mode(), wait: +(this.wait ?? 0).toFixed(1), prepared: this.#ready(), visits: this.visits.map((v) => ({ kind: v.kind, stage: v.stage, t: +v.t.toFixed(1), leaving: !!v.leaving, spots: v.spots, flights: v.flights?.length || 0, leftFor: v.leftFor || null })),
      animals: this.beasts.map((b) => ({ kind: b.kind, state: b.hold ? 'hold:' + b.hold : b.state, stage: b.visit?.stage, station: b.station?.id, x: +b.pos.x.toFixed(2), z: +b.pos.z.toFixed(2), y: +b.pos.y.toFixed(3), ground: +this.G.height(b.pos.x, b.pos.z).toFixed(3), speed: +b.speed.toFixed(2), gait: b.P.gallop > 0.5 ? 'gallop' : b.P.trot > 0.5 ? 'trot' : b.P.move > 0.5 ? 'walk' : b.P.sit > 0.5 ? 'sit' : 'stand', visible: b.mesh.visible })),
    };
  }
}

/** A cloven hoof print (two pointed halves) or a paw print (pad and four toes), toes towards v = 0 (forward). */
function printTexture(hoof) {
  const N = 64, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.9)';
  if (hoof) {
    for (const sd of [-1, 1]) { g.beginPath(); g.ellipse(32 + sd * 9, 34, 7, 22, sd * -0.08, 0, Math.PI * 2); g.fill(); }
  } else {
    g.beginPath(); g.ellipse(32, 22, 12, 10, 0, 0, Math.PI * 2); g.fill();
    for (const [x, y] of [[17, 39], [47, 39], [26, 50], [38, 50]]) { g.beginPath(); g.ellipse(x, y, 5.5, 7, 0, 0, Math.PI * 2); g.fill(); }
  }
  return new THREE.CanvasTexture(c);
}
let blobTex = null;
function blobTexture() {
  if (blobTex) return blobTex;
  const N = 64, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, N, N);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}
