// Where the birds of the garden can be (birds.js): the perches on real branches of the trees and shrubs near the
// house, the lawn and the lake (the centre lines of the trees' bark, trees.js) and on a few bare twigs that stick out of
// their crowns (dead twigs and top shoots: there a bird sits in plain sight; drawn with the trees' bark), the front
// edge of the roof, the posts
// and rails of the fence, the posts and the wires of the string lights over the terrace, the mooring posts of the
// jetty, the backs of the benches, the rims of the planters and the big stones; the ground they feed on (the lawn, the
// deck, the meadow, the gravel path, the boards of the jetty, the beach); and what they must not fly through (the
// house, the trunks). Every perch except the branches is checked against the real meshes (a ray straight down), so a
// bird never stands in the air when the scenery changes.
import * as THREE from 'three';
import { NATURE } from './nature.js';
import { HALL, ROOM, PASSAGE, FACADE_Z, TERRACE } from './layout.js';
import { OUTDOOR, JETTY, FENCE_LINE, BENCHES, STONES, onJetty, beachWeight, pathDist, inZone, groundHeight, terrainHeight, WATER_Y } from './outdoor.js';

const TAU = Math.PI * 2;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

/** The wind of the garden at a point (nature.js natWind): the trees bend with it, so the birds on them do too. */
export function windAt(x, z, out = _w) {
  const t = NATURE.uTime.value, k = NATURE.uWind.value;
  const gust = 0.62 + 0.38 * Math.sin(t * 0.41 + x * 0.031 - z * 0.017) * Math.sin(t * 0.23 + z * 0.026 + 1.3);
  const ph = x * 0.11 + z * 0.07;
  return out.set((0.75 + 0.35 * Math.sin(t * 1.07 + ph)) * gust * k, 0, 0.3 * Math.sin(t * 1.61 + ph * 1.7 + 0.7) * gust * k);
}
/** How far a point `h` m up a tree standing at (x, z) is moved by the wind now (as the bark shader moves it). */
export function swayAt(x, z, h, out) { windAt(x, z, out); return out.multiplyScalar(h * h * 0.0011); }

/** The house as boxes the birds keep out of (the roofs are their top faces: a bird on the edge of the roof stands on it). */
export const HOUSE_BOXES = [
  { x0: -(HALL.x1 + HALL.wall + 0.25), x1: HALL.x1 + HALL.wall + 0.25, z0: HALL.z0 - HALL.wall - 0.25, z1: FACADE_Z + 0.25, y1: HALL.h + 0.38 },
  { x0: -PASSAGE.w / 2 - 0.8, x1: PASSAGE.w / 2 + 0.8, z0: PASSAGE.z0 - 0.3, z1: PASSAGE.z1 + 0.3, y1: PASSAGE.h + 0.4 },
  { x0: ROOM.x0 - 0.95, x1: ROOM.x1 + 0.95, z0: ROOM.z0 - 0.95, z1: ROOM.z1 + 0.95, y1: ROOM.h + 0.38 },
];
/** Inside the house (with `m` metres to spare)? */
export function inHouse(x, y, z, m = 0) {
  for (const b of HOUSE_BOXES) if (x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m && y < b.y1 + m) return true;
  return false;
}

/**
 * The places of the birds, built once the garden stands (a few milliseconds; tests build them at once):
 *   perches   [{ kind, p, a, b, u, dir, yaw, r, size, tree, h, exposure, site, by }]: p the point on top of the perch
 *             (a, b: the ends of the stretch a bird may hop along, u where it sits on it), dir the direction of the
 *             branch or edge (a bird sits across it), yaw a preferred heading or null, size the biggest bird (m) it
 *             carries, tree the tree it belongs to ({ x, z, base }, it sways), site the group of perches it is part of
 *   sites     [{ id, kind, x, y, z, perches: [] }]: a tree, a shrub, the roof, the fence, the terrace, the jetty
 *   ground    areas to feed on: { name, sample(rnd) → { x, y, z } | null }
 *   trunks    [{ x, z, r, y1 }] in 8 m cells: what flying birds keep out of
 */
export class BirdPlaces {
  constructor(world) {
    this.world = world;
    this.perches = []; this.sites = []; this.trunks = []; this.cells = new Map();
    this.steps = this.#build(); this.ready = false; this.ms = 0; this.slowest = 0; this.parts = [];
  }
  /** One part of the work (some trees, the built things, the ground): true once all is done. A few milliseconds each,
   *  so the catalogue can be made over some frames without a stall. */
  step() {
    if (this.ready) return true;
    const t = performance.now();
    this.ready = !!this.steps.next().done;
    const d = performance.now() - t;
    this.parts.push(+d.toFixed(1)); this.ms += d; this.slowest = Math.max(this.slowest, d);
    return this.ready;
  }
  /** All of it now (tests). */
  all() { while (!this.step()); return this; }
  *#build() {
    yield* this.#trees();
    yield;
    yield* this.#structures();
    yield;
    this.#ground();
  }

  // ---------------------------------------------------------------- trees and shrubs --------------------------------
  /** Branches of the trees near the house, the lawn, the meadow and the lake: points on top of the bark where it is
   *  thin and not too steep, most of them out where the crown is open (birds sit there, and they are seen). */
  *#trees() {
    const garden = this.world.env?.garden, list = garden?.trees || OUTDOOR.trees;
    let n = 0;
    // the trees round the garden and round the house (the book room's windows look out at them as well)
    const near = (t) => Math.abs(t.x) < 62 && t.z > -62 && t.z < 78 && !inHouse(t.x, 1, t.z, 2);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (const t of list) {
      if (++n % 30 === 0) yield;
      const tp = garden?.template?.(t.sp, t.variant, 0);
      const m = t.matrix;
      if (!tp || !m) continue;
      const s = t.scale, base = new THREE.Vector3().setFromMatrixPosition(m);
      // the trunk for flying birds (also of trees far off: a flight may pass them)
      const trunkR = (t.sp === 'bush' ? 0.06 : (t.r || 0.3) * 0.75) + 0.15;
      this.#addTrunk({ x: t.x, z: t.z, r: t.sp === 'spruce' ? 0.5 * s : trunkR, y0: base.y, y1: base.y + tp.height * s * (t.sp === 'bush' ? 0.5 : t.sp === 'spruce' ? 1 : 0.8), sp: t.sp });
      if (!near(t) || !tp.paths?.length) continue;
      const site = { id: this.sites.length, kind: t.sp === 'bush' ? 'shrub' : 'tree', sp: t.sp, x: t.x, y: base.y + tp.crown.y * s, z: t.z, r: tp.crown.rw * s, perches: [] };
      const crown = tp.crown, bush = t.sp === 'bush', conifer = t.sp === 'spruce' || t.sp === 'pine';
      const cands = [];
      tp.paths.forEach((path, pi) => {
        const pts = path.pts, rad = path.rad;
        if (pi === 0) return;   // the trunk (its top is the twig out of the crown's top, below)
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1], r = (rad[i] + rad[i + 1]) / 2;
          const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
          if (len < 0.08 || r * s > 0.11 || r * s < 0.004) continue;
          if (Math.abs(dy) / len > 0.62) continue;                                   // too steep to sit on
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, mz = (a.z + b.z) / 2;
          if (my * s < (bush ? 0.45 : 1.6)) continue;
          // how far out in the crown (1 at its rim) and how far from the trunk
          const out = Math.hypot(Math.hypot(mx, mz) / crown.rw, (my - crown.y) / crown.rh), axis = Math.hypot(mx, mz);
          if (axis * s < (bush ? 0.15 : 0.6)) continue;
          const tip = i === pts.length - 2;
          cands.push({ a, b, r, score: out + (tip ? 0.35 : 0) + rnd() * 0.3 });
        }
      });
      // bare twigs out of the crown: the birds that are to be seen sit there
      const twigs = this.#twigsOf(t, tp);
      for (const tw of twigs) {
        const n = tw.pts.length, i = Math.min(n - 2, Math.max(0, Math.round((n - 1) * 0.72)));
        // the shoot out of the top: a bird stands on its tip (crows, blackbirds and jackdaws sit up there)
        if (tw.top) { const tip = tw.pts[n - 1]; cands.push({ a: tip, b: tip, r: tw.rad[n - 1] * 0.5, top: true, score: 6 }); continue; }
        cands.push({ a: tw.pts[i], b: tw.pts[i + 1], r: (tw.rad[i] + tw.rad[i + 1]) / 2, twig: true, score: 5 });
      }
      // the best ones, not too close together
      cands.sort((p, q) => q.score - p.score);
      const max = bush ? 7 : conifer ? 9 : 14, taken = [];
      for (const c of cands) {
        if (taken.length >= max) break;
        const mid = c.a.clone().add(c.b).multiplyScalar(0.5);
        if (taken.some((q) => q.distanceTo(mid) < (bush ? 0.3 : 0.7))) continue;
        taken.push(mid);
        const A = c.a.clone().applyMatrix4(m), B = c.b.clone().applyMatrix4(m), r = c.r * s;
        A.y += r; B.y += r;
        const dir = B.clone().sub(A); dir.y = 0;
        if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0); else dir.normalize();
        const P = A.clone().lerp(B, 0.5);
        // a big bird needs a strong branch: a thin twig only carries the small ones
        const size = c.top ? 0.55 : r > 0.03 ? 0.6 : r > 0.014 ? 0.3 : 0.17;
        const ex = Math.min(1.3, Math.hypot(Math.hypot(P.x - t.x, P.z - t.z) / (crown.rw * s), (P.y - base.y - crown.y * s) / (crown.rh * s)));
        this.#addPerch({ kind: c.twig ? 'twig' : c.top ? 'top' : bush ? 'shrub' : 'branch', p: P, a: A, b: B, u: 0.5, dir, yaw: null, r, size: c.twig ? (r > 0.011 ? 0.3 : 0.17) : size, tree: { x: t.x, z: t.z, base: base.y }, exposure: c.twig ? 1.6 : c.top ? 1.7 : ex, site, out: new THREE.Vector3(P.x - t.x, 0, P.z - t.z).normalize() });
      }
      if (site.perches.length) this.sites.push(site);
    }
  }
  /**
   * A few bare twigs sticking out of the crown of tree t (per template, cached): one up out of the top (the top shoot of
   * a spruce, a dead twig on a beech) and some out of its upper sides, each from inside the foliage to a little beyond
   * it, with a short side twig. In the template's frame: [{ pts, rad }]. They are drawn with the tree's bark (birds.js).
   */
  #twigsOf(t, tp) {
    const key = t.sp + t.variant;
    this.twigSets ||= new Map();
    let set = this.twigSets.get(key);
    if (!set) {
      set = { sp: t.sp, variant: t.variant, twigs: makeTwigs(t.sp, tp, 101 + t.variant * 7 + t.sp.length), trees: [] };
      this.twigSets.set(key, set);
    }
    set.trees.push(t);
    return set.twigs;
  }
  #addTrunk(tr) {
    this.trunks.push(tr);
    const i0 = Math.floor((tr.x - tr.r) / 8), i1 = Math.floor((tr.x + tr.r) / 8), j0 = Math.floor((tr.z - tr.r) / 8), j1 = Math.floor((tr.z + tr.r) / 8);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = i * 4096 + j; if (!this.cells.has(k)) this.cells.set(k, []); this.cells.get(k).push(tr); }
  }
  #addPerch(p) {
    p.id = this.perches.length; p.by = null;
    p.out ||= new THREE.Vector3(0, 0, 1);
    this.perches.push(p); p.site.perches.push(p);
    return p;
  }

  // ---------------------------------------------------------------- built things ------------------------------------
  /** The meshes a ray may hit (the garden's built things and the furniture outside), with their boxes and a tag: the
   *  name of the garden's part they belong to ('fence', 'jetty', 'posts', 'stones', 'roof' for the roofs) or the kind
   *  of furniture ('parkbench', 'planter'). */
  #targets() {
    const out = [], box = new THREE.Box3();
    const take = (o, tag) => {
      if (!o.isMesh || o.isInstancedMesh || o.isBatchedMesh || !o.geometry || o.name === 'ground' || o.name === 'lake' || o.name === 'path') return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      o.updateWorldMatrix(true, false);
      box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      if (!tag) tag = box.min.y > HALL.h - 0.5 && box.max.x - box.min.x > 6 ? 'roof' : '';
      if (tag) out.push({ o, box: box.clone(), tag });
    };
    for (const c of this.world.env?.scenery?.children || []) c.traverse((o) => take(o, c.name));
    for (const c of this.world.static?.children || []) {
      const kind = c.userData.placement?.kind;
      if (kind === 'parkbench' || kind === 'planter') c.traverse((o) => take(o, kind));
    }
    return out;
  }
  /** The top of whatever stands at (x, z) between y0 and y1 (the first face looking up) among the targets tagged
   *  `tags`, or null. */
  #topAt(x, z, y0, y1, tags) {
    this.rays ||= new THREE.Raycaster();
    const ray = this.rays, hits = [];
    ray.set(_v.set(x, y1, z), new THREE.Vector3(0, -1, 0)); ray.far = y1 - y0;
    for (const t of this.targets) {
      if (!tags.includes(t.tag)) continue;
      if (x < t.box.min.x - 0.01 || x > t.box.max.x + 0.01 || z < t.box.min.z - 0.01 || z > t.box.max.z + 0.01 || t.box.min.y > y1 || t.box.max.y < y0) continue;
      ray.intersectObject(t.o, false, hits);
    }
    hits.sort((a, b) => a.distance - b.distance);
    for (const h of hits) { const n = h.face?.normal; if (!n) continue; _w.copy(n).transformDirection(h.object.matrixWorld); if (_w.y > 0.6) return h.point.y; }
    return null;
  }
  *#structures() {
    this.targets = this.#targets();
    const add = (site, kind, x, z, y0, y1, dir, yaw, size, r, tags) => {
      const y = this.#topAt(x, z, y0, y1, tags);
      if (y == null) return null;
      const p = new THREE.Vector3(x, y, z);
      return this.#addPerch({ kind, p, a: p.clone(), b: p.clone(), u: 0.5, dir: dir.clone(), yaw, r, size, tree: null, exposure: 1, site });
    };
    const newSite = (kind, x, y, z) => { const s = { id: this.sites.length, kind, x, y, z, r: 3, perches: [] }; this.sites.push(s); return s; };
    const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
    // the front edge of the hall's roof, looking out over the garden
    {
      const top = HALL.h + 0.38, hx = HALL.x1 + HALL.wall + 0.2, site = newSite('roof', 0, top, FACADE_Z);
      for (let x = -hx + 0.3; x <= hx - 0.3; x += 0.55) add(site, 'roof', x, FACADE_Z + 0.1, top - 0.5, top + 0.6, X, 0, 0.6, 0.03, ['roof']);
      if (!site.perches.length) this.sites.pop();
    }
    yield;
    // the fence along the meadow: post tops and the top rail between them
    {
      const pts = [];
      for (let k = 0; k < FENCE_LINE.length - 1; k++) {
        const [ax, az] = FENCE_LINE[k], [bx, bz] = FENCE_LINE[k + 1], n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 2.4));
        for (let i = 0; i < n; i++) pts.push([ax + (bx - ax) * i / n, az + (bz - az) * i / n]);
      }
      pts.push(FENCE_LINE[FENCE_LINE.length - 1]);
      let site = null;
      pts.forEach(([x, z], i) => {
        if (i % 4 === 0) { const y = terrainHeight(x, z); site = newSite('fence', x, y + 1, z); }
        const g = terrainHeight(x, z), nx = pts[Math.min(pts.length - 1, i + 1)], pv = pts[Math.max(0, i - 1)];
        const dir = new THREE.Vector3(nx[0] - pv[0], 0, nx[1] - pv[1]).normalize();
        add(site, 'post', x, z, g + 0.5, g + 1.6, dir, null, 0.6, 0.05, ['fence']);
        if (i < pts.length - 1) {
          const q = pts[i + 1], mx = (x + q[0]) / 2, mz = (z + q[1]) / 2, gm = terrainHeight(mx, mz);
          const rail = add(site, 'rail', mx, mz, gm + 0.5, gm + 1.3, dir, null, 0.35, 0.04, ['fence']);
          if (rail) {
            // a bird may hop along the rail
            rail.a = new THREE.Vector3(mx, rail.p.y, mz).addScaledVector(dir, -0.7); rail.b = new THREE.Vector3(mx, rail.p.y, mz).addScaledVector(dir, 0.7);
          }
        }
      });
      for (let i = this.sites.length - 1; i >= 0; i--) if (this.sites[i].kind === 'fence' && !this.sites[i].perches.length) this.sites.splice(i, 1);
    }
    yield;
    // the terrace: the tops of the string-light posts, the wires between them and the house, the rims of the planters
    {
      const site = newSite('terrace', 0, 2.8, TERRACE.postZ);
      for (const x of TERRACE.posts) add(site, 'post', x, TERRACE.postZ, 2.2, 3.2, X, 0, 0.35, 0.035, ['posts']);
      // the wires: read from the scenery itself (thin lines over the deck)
      this.world.env?.scenery?.traverse((o) => {
        if (!o.isLineSegments) return;
        const pos = o.geometry.attributes.position, a = new THREE.Vector3(), b = new THREE.Vector3();
        for (let i = 0; i + 1 < pos.count; i += 2) {
          a.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(pos, i + 1).applyMatrix4(o.matrixWorld);
          const len = a.distanceTo(b);
          if (len < 0.15 || Math.abs(b.y - a.y) / len > 0.3 || a.y < 2.3 || a.z > TERRACE.postZ + 0.3 || Math.abs(a.x) > 9) continue;
          const dir = b.clone().sub(a).setY(0).normalize(), mid = a.clone().lerp(b, 0.5);
          if (site.perches.some((p) => p.p.distanceTo(mid) < 0.3)) continue;
          // facing the garden, across the wire
          const px = dir.z > 0 ? dir.z : -dir.z, pz = dir.z > 0 ? -dir.x : dir.x;
          const face = pz >= 0 ? Math.atan2(px, pz) : Math.atan2(-px, -pz);
          this.#addPerch({ kind: 'wire', p: mid.clone().setY(mid.y + 0.004), a: a.clone().setY(a.y + 0.004), b: b.clone().setY(b.y + 0.004), u: 0.5, dir, yaw: face, r: 0.004, size: 0.2, tree: null, exposure: 1, site });
        }
      });
      for (const x of TERRACE.planters) for (const dx of [-0.5, 0, 0.5]) add(site, 'rim', x + dx, TERRACE.planterZ + 0.2, 0.2, 1.0, X, null, 0.3, 0.03, ['planter']);
      if (!site.perches.length) this.sites.pop();
    }
    yield;
    // the jetty: the mooring posts at its end, the back of its bench; the bench on the knoll
    {
      const J = JETTY, site = newSite('jetty', J.end[0], J.top, J.end[1]);
      for (const c of [-1, 1]) { const [x, z] = J.at(J.len - 0.16, c * (J.platWidth / 2 - 0.16)); add(site, 'post', x, z, J.top, J.top + 1.2, new THREE.Vector3(J.dir[0], 0, J.dir[1]), null, 0.6, 0.1, ['jetty']); }
      for (const b of BENCHES) {
        const bs = b.id === 'jettybench' ? site : newSite('bench', b.x, b.y + 0.9, b.z);
        // the top of the backrest: the highest face across the bench, then points along it
        const c = Math.cos(b.rot), s = Math.sin(b.rot), along = new THREE.Vector3(c, 0, -s), across = new THREE.Vector3(s, 0, c);
        let best = null;
        for (let k = -0.45; k <= 0.45; k += 0.03) {
          const y = this.#topAt(b.x + across.x * k, b.z + across.z * k, b.y + 0.55, b.y + 1.4, ['parkbench']);
          if (y != null && (!best || y > best.y + 0.01)) best = { k, y };
        }
        if (best) for (const d of [-0.55, -0.2, 0.2, 0.55]) {
          const x = b.x + across.x * best.k + along.x * d, z = b.z + across.z * best.k + along.z * d;
          add(bs, 'bench', x, z, best.y - 0.1, best.y + 0.1, along, null, 0.35, 0.025, ['parkbench']);
        }
        if (!bs.perches.length && bs !== site) this.sites.splice(this.sites.indexOf(bs), 1);
      }
      if (!site.perches.length) this.sites.splice(this.sites.indexOf(site), 1);
    }
    yield;
    // big stones on the shore and the meadow (wagtail-like perches for the small birds, a lookout for crows)
    {
      for (const st of STONES) {
        if (st.pebble || st.s < 0.45 || Math.abs(st.x) > 45 || st.z > 70) continue;
        const site = newSite('stone', st.x, terrainHeight(st.x, st.z), st.z);
        const g = terrainHeight(st.x, st.z);
        add(site, 'stone', st.x, st.z, g - 0.3, g + st.s + 0.4, X, null, 0.6, 0.15, ['stones']);
        if (!site.perches.length) this.sites.pop();
      }
    }
    this.targets = null;
  }

  // ---------------------------------------------------------------- the ground --------------------------------------
  /** Areas to feed on: each samples a free point with the height of what a bird stands on there. */
  #ground() {
    const hf = this.world.env?.garden?.heightField;
    const height = (x, z) => {
      if (onJetty(x, z)) return JETTY.top;
      const D = OUTDOOR.house.deck;
      if (x >= D.x0 && x <= D.x1 && z >= D.z0 && z <= D.z1) return 0;
      if (hf && x > hf.x0 && x < hf.x0 + hf.w && z > hf.z0 && z < hf.z0 + hf.d) return hf.meshAt(x, z) + (pathDist(x, z) < 0.7 ? 0.025 : 0);
      return terrainHeight(x, z);
    };
    this.height = height;
    const free = (x, z, r = 0.25) => !OUTDOOR.obstaclesNear(x, z, r).length && !inHouse(x, 1, z, 0.2);
    const area = (name, box, ok) => ({
      name, x: (box[0] + box[1]) / 2, z: (box[2] + box[3]) / 2,
      sample: (rnd = Math.random, near = null, rad = 3) => {
        for (let i = 0; i < 24; i++) {
          const x = near ? near.x + (rnd() - 0.5) * 2 * rad : box[0] + rnd() * (box[1] - box[0]);
          const z = near ? near.z + (rnd() - 0.5) * 2 * rad : box[2] + rnd() * (box[3] - box[2]);
          if (x < box[0] || x > box[1] || z < box[2] || z > box[3] || !ok(x, z) || !free(x, z)) continue;
          return new THREE.Vector3(x, height(x, z), z);
        }
        return null;
      },
    });
    const deckFree = (x, z) => this.world.player?.isFree ? this.world.player.isFree(x, z, -0.12) : true;
    const D = OUTDOOR.house.deck;
    this.ground = {
      lawn: area('lawn', [-10, 10, 10.4, 21.5], (x, z) => terrainHeight(x, z) > WATER_Y + 0.2),
      deck: area('deck', [D.x0 + 0.3, D.x1 - 0.3, D.z0 + 0.35, D.z1 - 0.2], deckFree),
      meadow: area('meadow', [-4, 26, 12, 53], (x, z) => inZone('meadow', x, z)),
      path: area('path', [-14, 2, 10, 33], (x, z) => pathDist(x, z) < 0.45),
      jetty: area('jetty', [JETTY.root[0] - 12, JETTY.root[0] + 2, JETTY.root[1] - 2, JETTY.root[1] + 12], (x, z) => onJetty(x, z) && Math.hypot(x - BENCHES[0].x, z - BENCHES[0].z) > 1.1),
      beach: area('beach', [JETTY.shore[0] - 8, JETTY.shore[0] + 8, JETTY.shore[1] - 8, JETTY.shore[1] + 8], (x, z) => beachWeight(x, z) > 0.35 && terrainHeight(x, z) > WATER_Y + 0.03),
    };
  }

  // ---------------------------------------------------------------- questions ---------------------------------------
  /** Does the straight flight from a to b pass through the house or a trunk (with `m` m to spare)? */
  blocked(a, b, m = 0.15) {
    const d = a.distanceTo(b), n = Math.max(2, Math.ceil(d / 0.4));
    for (let i = 1; i < n; i++) {
      const t = i / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
      if (inHouse(x, y, z, m) || this.trunkAt(x, y, z, m)) return true;
    }
    return false;
  }
  /** The trunk at a point (r + m round its axis, below its top), or null. */
  trunkAt(x, y, z, m = 0) {
    const list = this.cells.get(Math.floor(x / 8) * 4096 + Math.floor(z / 8));
    if (list) for (const t of list) if (y < t.y1 && y > t.y0 - 1 && (t.x - x) ** 2 + (t.z - z) ** 2 < (t.r + m) ** 2) return t;
    return null;
  }
  /** The perch's point now: where it is plus the sway of its tree (out). */
  perchPoint(p, out, u = p.u) {
    out.copy(p.a).lerp(p.b, u);
    if (p.tree) out.add(swayAt(p.tree.x, p.tree.z, out.y - p.tree.base, _v));
    return out;
  }
  /** Free perches of a site that carry a bird of `size` (m), nearest to `near` first when given. */
  free(site, size, near = null) {
    const list = site.perches.filter((p) => !p.by && p.size >= size);
    if (near) list.sort((a, b) => a.p.distanceToSquared(near) - b.p.distanceToSquared(near));
    return list;
  }
}

/**
 * Bare twigs for a tree template: from the foliage (its cards) the reach of the crown in a few directions, then a twig
 * from some way inside it to 0.3 to 0.5 m beyond, curving up a little, with a short side twig. [{ pts, rad }].
 */
function makeTwigs(sp, tp, seed) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const pos = tp.leaves.attributes.position, c = new THREE.Vector3(0, tp.crown.y, 0), v = new THREE.Vector3(), d = new THREE.Vector3();
  const bush = sp === 'bush', conifer = sp === 'spruce' || sp === 'pine';
  // directions: straight up, then round the upper part of the crown
  const dirs = [new THREE.Vector3(0.05, 1, 0.02).normalize()];
  const n = bush ? 4 : conifer ? 3 : 5, a0 = rnd() * TAU;
  for (let i = 0; i < n; i++) {
    const a = a0 + i * TAU / n + (rnd() - 0.5) * 0.5, el = conifer ? 0.15 + rnd() * 0.2 : 0.3 + rnd() * 0.45;
    dirs.push(new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)));
  }
  const out = [];
  for (const dir of dirs) {
    // how far the foliage reaches in that direction (the farthest card corner within some 25 degrees)
    let reach = 0;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).sub(c);
      const l = v.length(); if (l < 1e-3) continue;
      if (v.dot(dir) / l > 0.9) reach = Math.max(reach, l);
    }
    if (!reach) continue;
    const len = bush ? 0.55 + rnd() * 0.25 : 0.9 + rnd() * 0.5, beyond = bush ? 0.22 : 0.32 + rnd() * 0.18;
    const tip = c.clone().addScaledVector(dir, reach + beyond), base = c.clone().addScaledVector(dir, Math.max(0.3, reach + beyond - len));
    const bend = new THREE.Vector3((rnd() - 0.5) * 0.15, 0.12, (rnd() - 0.5) * 0.15);
    const pts = [], rad = [], N = 4, r0 = bush ? 0.012 : 0.017;
    for (let i = 0; i <= N; i++) { const k = i / N; pts.push(base.clone().lerp(tip, k).addScaledVector(bend, Math.sin(k * Math.PI) * len * 0.25)); rad.push(r0 * (1 - 0.65 * k) + 0.002); }
    out.push({ pts, rad, top: dir === dirs[0] });
    // a short side twig from the middle
    const m = pts[2], side = d.set(rnd() - 0.5, 0.4 + rnd() * 0.3, rnd() - 0.5).normalize();
    if (rnd() < 0.8) out.push({ pts: [m.clone(), m.clone().addScaledVector(side, len * 0.18), m.clone().addScaledVector(side, len * 0.32)], rad: [rad[2] * 0.7, rad[2] * 0.5, 0.0025], side: true });
  }
  return out;
}
/** The geometry of a set of twigs: tapered tubes with the attributes of the bark (position, normal, uv, aOcc). */
export function twigGeometry(twigs) {
  const P = [], N = [], U = [], O = [], I = [], sides = 5;
  const t = new THREE.Vector3(), s1 = new THREE.Vector3(), s2 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), x = new THREE.Vector3(1, 0, 0);
  for (const tw of twigs) {
    const first = P.length / 3, n = tw.pts.length;
    let along = 0;
    for (let i = 0; i < n; i++) {
      t.copy(tw.pts[Math.min(n - 1, i + 1)]).sub(tw.pts[Math.max(0, i - 1)]).normalize();
      s1.crossVectors(t, Math.abs(t.y) < 0.95 ? up : x).normalize(); s2.crossVectors(s1, t).normalize();
      if (i) along += tw.pts[i].distanceTo(tw.pts[i - 1]);
      for (let k = 0; k <= sides; k++) {
        const a = (k / sides) * TAU, nx = s1.x * Math.cos(a) + s2.x * Math.sin(a), ny = s1.y * Math.cos(a) + s2.y * Math.sin(a), nz = s1.z * Math.cos(a) + s2.z * Math.sin(a);
        P.push(tw.pts[i].x + nx * tw.rad[i], tw.pts[i].y + ny * tw.rad[i], tw.pts[i].z + nz * tw.rad[i]); N.push(nx, ny, nz); U.push(k / sides, along * 3); O.push(1);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < sides; k++) { const a = first + i * (sides + 1) + k, b = a + 1, c = a + sides + 1, d = c + 1; I.push(a, c, b, b, c, d); }
    // the tip closed (a bird stands on the tip of the top shoot)
    const tip = tw.pts[n - 1], last = first + (n - 1) * (sides + 1), ci = P.length / 3;
    P.push(tip.x + t.x * tw.rad[n - 1] * 0.5, tip.y + t.y * tw.rad[n - 1] * 0.5, tip.z + t.z * tw.rad[n - 1] * 0.5); N.push(t.x, t.y, t.z); U.push(0.5, along * 3); O.push(1);
    for (let k = 0; k < sides; k++) I.push(last + k + 1, last + k, ci);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('aOcc', new THREE.Float32BufferAttribute(O, 1));
  g.setIndex(I);
  return g;
}

export { TAU };

