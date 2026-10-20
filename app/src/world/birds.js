// Birds in the garden. Sparrows, chaffinches and tits keep together in small flocks and flit between the hedges, the
// trees, the terrace and the ground; blackbirds hop and run on the lawn; crows and jackdaws walk on the meadow and sit
// on the roof, the tops of the trees and the posts of the jetty; by day a buzzard circles high on the thermals; in
// spring and summer swallows hunt low over the meadow and the lake and rest on the wires of the string lights; at dusk
// a barn owl glides along the meadow now and then. At night the songbirds roost unseen, in winter there are fewer and
// no swallows, in rain they sit more, in a storm they shelter.
//   Flight: each bird steers towards the next point of its way (flocks with separation, alignment and cohesion), keeps
// out of the house and the trunks, banks into its turns and beats its wings by its kind: bursts of beats with the
// wings shut in between (the bounding flight of the small birds), beats and glides, a steady beat (crows), soaring.
// A take-off is a jump with fast, deep beats; a landing a flare: the body upright, the wings spread and beating
// forward, the legs reaching for the perch, the tail fanned. Perched birds look round, preen, hop along the branch and
// fly off when somebody comes close outside.
//   Drawing: every kind is an instanced mesh posed in the vertex shader (bird-models.js), near and far geometry. The
// perches are real branches and built things (bird-places.js).
import * as THREE from 'three';
import { buildBird, creatureMaterial, poseAttributes, joints, KINDS, SHAPES } from './bird-models.js';
import { BirdPlaces, inHouse, twigGeometry, HOUSE_BOXES } from './bird-places.js';
import { barkMaterial } from './trees.js';
import { FACADE_Z } from './layout.js';
import { WATER_Y, LAKE, lakeDist, terrainHeight, inZone } from './outdoor.js';
import { clamp, lerp, smoothstep } from './geo.js';

const TAU = Math.PI * 2, G = 9.81;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
/** Weighted choice from { key: weight }. */
function choose(weights) {
  let r = Math.random() * Object.values(weights).reduce((a, b) => a + b, 0);
  for (const [k, w] of Object.entries(weights)) { r -= w; if (r <= 0) return k; }
  return Object.keys(weights)[0];
}

/**
 * The species as they behave.
 *   kinds        the plumages a bird of the species may wear
 *   flight       'bound' (bursts of beats, then the wings shut), 'flapglide', 'flap', 'soar', 'hawk', 'owl'
 *   beat         wing beats a second; top / bottom: the arm's elevation at the top and the bottom of a beat (rad);
 *                foldArm / foldHand: how far arm and hand fold back in the upstroke; lag: the hand trailing the arm;
 *                twist: the roll of the wing in the beat; glide: the wings when gliding (elevation, bend, sweep of arm
 *                and hand)
 *   cruise, acc  speed (m/s) and the most it accelerates or turns with (m/s²)
 *   flee         how close (m) the player may come outside before it flies off
 *   sites        the kinds of perch it uses with weights; ground: the areas it feeds on, groundShare: how often it goes
 *                down to feed when it moves
 *   land         from how far (m) a landing starts; stay: how long it stays (s, by day)
 */
export const SPECIES = {
  sparrow: { kinds: ['sparrowM', 'sparrowF'], flight: 'bound', beat: 11, top: 1.05, bottom: -0.85, foldArm: 0.5, foldHand: 1.05, lag: 0.45, twist: 0.3, glide: [0.02, 0.06, 0.12, 0.2], cruise: 6, acc: 16,
    flee: 4, sites: { shrub: 4, tree: 1, roof: 1.2, terrace: 1.6, fence: 0.3 }, ground: { deck: 2, lawn: 2, path: 1 }, groundShare: 0.45, land: 1.2, stay: [8, 30], hop: true },
  chaffinch: { kinds: ['chaffinchM', 'chaffinchF'], flight: 'bound', beat: 10, top: 1.0, bottom: -0.85, foldArm: 0.5, foldHand: 1.0, lag: 0.45, twist: 0.3, glide: [0.02, 0.06, 0.12, 0.2], cruise: 7, acc: 15,
    flee: 5, sites: { tree: 3, shrub: 1, fence: 1, stone: 0.3 }, ground: { meadow: 2, lawn: 1, path: 0.6 }, groundShare: 0.35, land: 1.3, stay: [10, 40], hop: true },
  tit: { kinds: ['greattit', 'bluetit'], flight: 'bound', beat: 12, top: 1.05, bottom: -0.85, foldArm: 0.5, foldHand: 1.05, lag: 0.45, twist: 0.3, glide: [0.02, 0.06, 0.12, 0.2], cruise: 5.5, acc: 16,
    flee: 3.5, sites: { tree: 3, shrub: 3, fence: 0.6, terrace: 0.5 }, ground: { lawn: 0.5 }, groundShare: 0.1, land: 1.1, stay: [6, 22], hop: true },
  blackbird: { kinds: ['blackbirdM', 'blackbirdF'], flight: 'flapglide', beat: 8, top: 0.95, bottom: -0.8, foldArm: 0.4, foldHand: 0.85, lag: 0.4, twist: 0.25, glide: [-0.02, 0.05, 0.12, 0.22], cruise: 7, acc: 12,
    flee: 5, sites: { shrub: 2, tree: 1, roof: 1, fence: 0.4, top: 0.6 }, ground: { lawn: 4, path: 1, meadow: 1 }, groundShare: 0.65, land: 1.5, stay: [15, 50], run: true },
  crow: { kinds: ['crow'], flight: 'flap', beat: 3.6, top: 0.75, bottom: -0.65, foldArm: 0.22, foldHand: 0.5, lag: 0.32, twist: 0.2, glide: [0.06, 0.1, 0.02, 0.06], cruise: 9, acc: 7,
    flee: 15, sites: { top: 3, roof: 1, tree: 1, jetty: 0.6, stone: 0.4, fence: 0.6 }, ground: { meadow: 3, lawn: 0.5 }, groundShare: 0.5, land: 3.2, stay: [20, 70], walk: true },
  jackdaw: { kinds: ['jackdaw'], flight: 'flap', beat: 4.8, top: 0.8, bottom: -0.7, foldArm: 0.25, foldHand: 0.55, lag: 0.33, twist: 0.2, glide: [0.05, 0.08, 0.02, 0.06], cruise: 9, acc: 9,
    flee: 11, sites: { roof: 3, top: 2, tree: 1, fence: 0.6 }, ground: { meadow: 2, lawn: 1 }, groundShare: 0.4, land: 2.6, stay: [15, 50], walk: true },
  buzzard: { kinds: ['buzzard'], flight: 'soar', beat: 2.8, top: 0.6, bottom: -0.45, foldArm: 0.15, foldHand: 0.3, lag: 0.25, twist: 0.15, glide: [0.13, 0.16, 0, 0], cruise: 10, acc: 3, flee: 0 },
  swallow: { kinds: ['swallow'], flight: 'hawk', beat: 7, top: 0.85, bottom: -0.7, foldArm: 0.35, foldHand: 0.7, lag: 0.35, twist: 0.25, glide: [0.0, 0.05, 0.42, 0.55], cruise: 9, acc: 22,
    flee: 2.5, sites: { terrace: 1 }, land: 1.3, stay: [15, 40] },
  owl: { kinds: ['owl'], flight: 'owl', beat: 2.6, top: 0.85, bottom: -0.7, foldArm: 0.25, foldHand: 0.5, lag: 0.3, twist: 0.2, glide: [0.05, 0.06, 0.0, 0.05], cruise: 6, acc: 5, flee: 0 },
};
/** How many of a kind of bird can be drawn at once (the instanced meshes are made this large). */
const CAP = { sparrowM: 7, sparrowF: 7, chaffinchM: 4, chaffinchF: 4, greattit: 4, bluetit: 4, blackbirdM: 2, blackbirdF: 2, crow: 3, jackdaw: 5, buzzard: 2, swallow: 8, owl: 1 };
/** The hen of a kind that has the cock's shape (drawn with its mesh). */
const HEN = { sparrowM: 'sparrowF', chaffinchM: 'chaffinchF', blackbirdM: 'blackbirdF' };
/** Up to this distance (m) a bird of the size is drawn with the near geometry, up to `far` at all. */
const LOD = (span) => ({ near: 14 + span * 45, far: span > 0.8 ? 700 : span > 0.5 ? 220 : 110 });
/** The quality 'mobile' draws the twigs in the crowns up to this distance (m) only (#twigsNear). */
const TWIGS_NEAR = 40;

/** The wing half folded, swept back: the pose of the rig while it blends into the folded wing (bird-models.js aFold). */
const CLOSED = { e: -0.3, b: 0, sw: 1.1, roll: 0.6, hs: 1.4 };

// ---------------------------------------------------------------- one bird ---------------------------------------------
class Bird {
  constructor(owner, species, kind, flock = null) {
    this.owner = owner; this.species = species; this.S = SPECIES[species]; this.kind = kind; this.flock = flock;
    this.shape = SHAPES[KINDS[kind]]; this.J = joints(KINDS[kind]);
    this.span = this.shape.wing.span; this.scale = rand(0.94, 1.06);
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.acc = new THREE.Vector3();
    this.yaw = rand(-Math.PI, Math.PI); this.pitch = 0; this.bank = 0;
    this.state = 'perch'; this.t = 0; this.stayT = 10;
    this.perch = null; this.spot = null; this.target = null; this.path = null; this.pathI = 0; this.land = null;
    // wings: what they do (closed, flap, glide, bound, flare) and their pose now
    this.wing = { mode: 'closed', phase: Math.random(), freq: this.S.beat * rand(0.92, 1.08), k: 1, beats: 0, plan: 0, hold: 0, e: CLOSED.e, b: CLOSED.b, sw: CLOSED.sw, roll: CLOSED.roll, hs: CLOSED.hs, closed: 1 };
    this.head = { yaw: 0, pitch: 0, ty: 0, tp: 0, timer: rand(0.2, 1) };
    this.tail = { spread: 0, tilt: 0, flick: 0 };
    this.legs = 0; this.crouch = 0;
    this.preen = 0; this.preenT = rand(10, 40); this.hopT = rand(2, 8); this.hop = null; this.peck = 0; this.pecks = 0;
    this.upright = this.shape.upright; this.uprightNow = this.shape.upright;
    this.lastFlee = -99; this.seen = false; this.dist = 1e9;
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3();
  }
  get flying() { return this.state === 'fly' || this.state === 'takeoff' || this.state === 'land' || this.state === 'soar' || this.state === 'hawk' || this.state === 'glide'; }
}

// ---------------------------------------------------------------- the birds of the garden ------------------------------
export class Birds {
  constructor(owner) {
    this.owner = owner; this.world = owner.world;
    this.group = new THREE.Group(); this.group.name = 'birds';
    this.list = []; this.flocks = [];
    // a mesh (near and far) per kind; the hens of the sparrow, the chaffinch and the blackbird share the cock's (their
    // plumage packed into the geometry: bird-models.js; one draw call less each)
    this.meshes = new Map(); this.alt = new Set();
    for (const kind of Object.keys(KINDS)) {
      if (this.meshes.has(kind)) continue;
      const hen = HEN[kind], pair = [0, 1].map((lod) => buildBird(kind, lod, hen));
      const both = hen && pair.every((g) => g.userData.paired === hen);
      const cap = CAP[kind] + (both ? CAP[hen] : 0);
      const ms = pair.map((g, lod) => {
        const at = poseAttributes(g, cap);
        const m = new THREE.InstancedMesh(g, creatureMaterial(), cap);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.count = 0; m.visible = false; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true;
        m.userData.noAO = true; m.userData.at = at; m.userData.n = 0; m.renderOrder = 10; m.name = `bird-${kind}${both ? '+' + hen : ''}-${lod}`;
        this.group.add(m);
        return m;
      });
      this.meshes.set(kind, ms);
      if (both) { this.meshes.set(hen, ms); this.alt.add(hen); }
    }
    this.meshSets = [...new Set(this.meshes.values())];
    this.places = null; this.censusT = 0; this.clock = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(); this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._c = new THREE.Vector3();
    this._f = new THREE.Frustum(); this._pm = new THREE.Matrix4(); this._sph = new THREE.Sphere();
  }
  dispose() { for (const ms of this.meshSets) for (const m of ms) { m.geometry.dispose(); m.dispose(); } for (const bm of this.twigMeshes || []) bm.dispose(); }

  /** Build the perch catalogue (once the garden stands) and the bare twigs the birds sit on in the crowns: a part per
   *  call (the twigs in a call of their own), or (`all`) everything at once. True when done. */
  prepare(all = true) {
    if (this.places) return true;
    if (!this.world.env?.garden) return false;
    this.building ||= new BirdPlaces(this.world);
    if (all) this.building.all();
    else if (!this.building.ready) { this.building.step(); return false; }
    this.places = this.building; this.#twigs();
    return true;
  }
  /** The twigs out of the crowns (bird-places.js): one batched mesh for all of them (one draw call) with a bark material
   *  of the trees and each tree's own tint, so their shader program is the trees' one; the bark of a twig this thin
   *  shows no grain, so the oak's serves for all. */
  #twigs() {
    for (const bm of this.twigMeshes || []) { this.group.remove(bm); bm.dispose(); }
    this.twigMeshes = [];
    const sets = [...(this.places.twigSets?.values() || [])];
    if (!sets.length) return;
    const geos = sets.map((st) => twigGeometry(st.twigs));
    let verts = 0, idx = 0, inst = 0;
    for (const g of geos) { verts += g.attributes.position.count; idx += g.index.count; }
    for (const st of sets) inst += st.trees.length;
    const white = new THREE.Color(1, 1, 1);
    const bm = new THREE.BatchedMesh(inst, verts, idx, barkMaterial('oak'));
    sets.forEach((st, i) => { const gid = bm.addGeometry(geos[i]); for (const t of st.trees) { const id = bm.addInstance(gid); bm.setMatrixAt(id, t.matrix); bm.setColorAt(id, t.barkTint || white); } });
    for (const g of geos) g.dispose();
    // a few hundred small instances: drawn all together (no culling and sorting of each on the processor every frame)
    bm.perObjectFrustumCulled = false; bm.sortObjects = false;
    bm.castShadow = false; bm.receiveShadow = false; bm.userData.noAO = true; bm.renderOrder = 10; bm.name = 'twigs';
    this.group.add(bm);
    this.twigMeshes.push(bm);
  }

  // ---------------------------------------------------------------- who is about ------------------------------------
  /** The flocks that should be about now: [{ species, n }] by the season, the light and the weather. */
  want(c) {
    const { season, light, weather } = c;
    const out = [], winter = season === 'winter', storm = weather === 'storm';
    const add = (species, n) => { if (n > 0) out.push({ species, n }); };
    if (storm) return light === 'day' ? [{ species: 'blackbird', n: 1 }] : [];
    if (light === 'day') {
      add('sparrow', winter ? 6 : 5); if (!winter) add('sparrow', 4);
      add('chaffinch', winter ? 3 : 4);
      add('tit', winter ? 5 : 4);
      add('blackbird', 1); add('blackbird', 1);
      if (weather !== 'fog') { add('crow', 2); add('jackdaw', winter ? 3 : 4); }
      if ((weather === 'clear' || weather === 'overcast') && !winter) add('buzzard', 1);
      if (season === 'summer' && weather !== 'snow' && weather !== 'fog') add('swallow', 6);
      if (season === 'spring' && weather !== 'snow' && weather !== 'fog') add('swallow', 3);
    } else if (light === 'dusk') {
      // the blackbirds sing from the roof and the tops of the trees, the swallows hunt on until it is dark
      add('blackbird', 1); add('blackbird', 1);
      if (season === 'summer' && weather === 'clear') add('swallow', 4);
    }
    return out;
  }
  /** The season, the light and the weather now (tests override them). */
  conditions() {
    const w = this.world, o = this.owner;
    const season = o.seasonNow();
    const y = o.sunHeight();
    const light = y > 0.035 ? 'day' : y > -0.075 ? 'dusk' : 'night';
    return { season, light, weather: o.weatherNow(), sunY: y };
  }
  /** Bring the flocks in line with want(): new ones come from out of sight, those no longer wanted fly off. */
  #census(c, instant = false) {
    const want = this.want(c);
    const have = this.flocks.filter((f) => !f.leaving && !f.temp);
    // match flock for flock by species
    const left = [...have];
    for (const w of want) {
      const i = left.findIndex((f) => f.species === w.species);
      if (i >= 0) { left.splice(i, 1); continue; }
      this.#spawnFlock(w.species, w.n, instant || !this.ready);
    }
    for (const f of left) this.#dismiss(f, instant);
  }
  #spawnFlock(species, n, instant) {
    const S = SPECIES[species];
    const flock = { species, birds: [], leader: null, leaving: false, site: null, id: (this.flockId = (this.flockId || 0) + 1) };
    this.flocks.push(flock);
    for (let i = 0; i < n; i++) {
      const kind = species === 'blackbird' ? (this.flocks.filter((f) => f.species === 'blackbird').length % 2 ? 'blackbirdM' : 'blackbirdF') : pick(S.kinds);
      if (this.#count(kind) >= CAP[kind]) continue;
      const b = new Bird(this, species, kind, flock);
      flock.birds.push(b); this.list.push(b);
    }
    flock.leader = flock.birds[0] || null;
    if (!flock.leader) { this.flocks.splice(this.flocks.indexOf(flock), 1); return null; }
    if (S.flight === 'soar') { for (const b of flock.birds) this.#startSoar(b, true); return flock; }
    if (S.flight === 'hawk') { for (const b of flock.birds) this.#startHawk(b, true); return flock; }
    if (S.flight === 'owl') { for (const b of flock.birds) this.#startOwl(b); return flock; }
    // the flock sits somewhere (at the start or behind the player's back) or comes flying in; when there is no room
    // near the focus, further off
    let site = null;
    const placed = [];
    for (let tries = 0; tries < 4 && !placed.length; tries++) {
      site = this.#pickSite(flock, null, instant ? null : 'hidden', tries >= 2 ? 'any' : tries === 1);
      for (const b of site ? flock.birds : []) {
        const where = this.#placeFor(b, site, placed[0]?.pos || null);
        if (where) { this.#settle(b, where); placed.push(b); }
      }
    }
    for (const b of flock.birds) if (!placed.includes(b)) b.gone = true;
    flock.birds = flock.birds.filter((b) => !b.gone); this.list = this.list.filter((b) => !b.gone);
    flock.leader = flock.birds[0] || null;
    if (!flock.leader) { this.flocks.splice(this.flocks.indexOf(flock), 1); return null; }
    flock.site = site;
    return flock;
  }
  #count(kind) { let n = 0; for (const b of this.list) if (b.kind === kind) n++; return n; }
  /** A flock no longer wanted: out of sight it goes at once, in sight it flies off into the wood first. */
  #dismiss(flock, instant) {
    flock.leaving = true;
    for (const b of flock.birds) {
      if (instant || !b.seen) { b.gone = true; continue; }
      const away = this.#offstage(b.pos);
      b.leaveAt = away;
      if (b.state === 'soar' || b.state === 'hawk' || b.state === 'glide') { b.state = 'fly'; this.#route(b, away, null); continue; }
      if (b.flying) { this.#route(b, away, null); continue; }
      this.#takeoff(b, away, null);
    }
  }
  /** A point far off in the wood, away from the player: where leaving birds go. */
  #offstage(from) {
    const p = this.world.camera.position, a = Math.atan2(from.x - p.x, from.z - p.z) + rand(-0.6, 0.6);
    const x = clamp(p.x + Math.sin(a) * 70, -90, 90), z = clamp(p.z + Math.cos(a) * 70, 15, 120);
    return new THREE.Vector3(x, terrainHeight(x, z) + rand(10, 18), Math.max(z, FACADE_Z + 12));
  }

  // ---------------------------------------------------------------- choosing where to go ----------------------------
  /**
   * Where the life of the garden should be: round the player outside, in front of him behind the glass (the lawn seen
   * from the hall, the trees outside the book room's windows). Smoothed over some seconds, so it does not swing with
   * every turn of the head; it only decides where the birds go next.
   */
  #focus(dt = 0) {
    const cam = this.world.camera, p = cam.position, f = this._focus ||= new THREE.Vector3(p.x, 0, p.z + 10);
    let x = p.x, z = p.z;
    if (!this.owner.playerOutside()) {
      cam.getWorldDirection(this._w); const l = Math.hypot(this._w.x, this._w.z) || 1;
      x += this._w.x / l * 14; z += this._w.z / l * 14;
    }
    const k = dt ? 1 - Math.exp(-dt / 6) : 1;
    f.x += (x - f.x) * k; f.z += (z - f.z) * k;
    return f;
  }
  /** A site for a flock: by the species' weights and how near it is to the focus (`wide`: further off, 'any': anywhere),
   *  away from the player when fleeing, out of sight when `hidden`. { site, kind } or { ground, p }. */
  #pickSite(flock, from, mode = null, wide = false) {
    const S = SPECIES[flock.species], P = this.places, focus = this.#focus(), any = wide === 'any';
    // mostly within some 30 m of the focus, now and then further off (a flock comes over from the edge of the wood)
    if (!wide) wide = mode === 'hidden' || Math.random() < 0.15;
    const near = (x, z) => { if (any) return 1; const d = Math.hypot(x - focus.x, z - focus.z); return wide ? (d < 60 ? Math.exp(-d / 25) : 0) : d < 30 ? Math.exp(-d / 9) : 0; };
    const groundW = S.groundShare && Object.keys(S.ground || {}).length ? S.groundShare : 0;
    const wantGround = mode !== 'hidden' && mode !== 'flee' && Math.random() < groundW && !this.owner.wet();
    if (wantGround) {
      const w = {}; for (const [name, k] of Object.entries(S.ground)) { const a = P.ground[name]; if (a) w[name] = k * near(a.x, a.z); }
      const area = P.ground[choose(w)];
      // a spot near the focus when the area reaches it
      const spot = area?.sample(Math.random, Math.random() < 0.6 ? focus : null, 5) || area?.sample(Math.random);
      if (spot && this.#okSpot(spot, flock, mode, from)) return { ground: area, p: spot };
    }
    const kinds = { ...S.sites };
    // in rain they keep to the cover of the shrubs and trees
    if (this.owner.wet()) { for (const k of Object.keys(kinds)) if (k !== 'shrub' && k !== 'tree') kinds[k] *= 0.2; }
    const size = this.#size(flock), need = flock.birds.length;
    const cands = [], ws = [];
    for (const site of P.sites) {
      if (site === flock.site) continue;
      const k = site.kind === 'tree' && kinds.top && site.perches.some((p) => p.kind === 'top' && !p.by && p.size >= size) && (!kinds.tree || Math.random() < kinds.top / (kinds.top + kinds.tree)) ? 'top' : site.kind;
      const kw = kinds[k]; if (!kw) continue;
      let room = 0; for (const p of site.perches) if (!p.by && p.size >= size && (k !== 'top' || p.kind === 'top' || p.size >= 0.5)) room++;
      if (room < Math.min(need, k === 'top' ? 1 : need)) continue;
      const w = kw * near(site.x, site.z);
      if (w > 0) { cands.push({ site, kind: k }); ws.push(w); }
    }
    if (!cands.length && !wide) return this.#pickSite(flock, from, mode, true);
    for (let tries = 0; tries < 16 && cands.length; tries++) {
      let r = Math.random() * ws.reduce((a, b) => a + b, 0), i = 0;
      for (; i < ws.length - 1; i++) { r -= ws[i]; if (r <= 0) break; }
      const c = cands[i];
      if (this.#okSpot(this._s.set(c.site.x, c.site.y, c.site.z), flock, mode, from, true)) return c;
      ws[i] = 0;
    }
    return null;
  }
  #size(flock) { return Math.max(...flock.birds.map((b) => b.span * 0.4)); }
  /** A target that makes sense: near enough (a flight of a few to 50 m), away from the player when fleeing, not where
   *  the player stands outside, out of view when it should not be seen arriving. */
  #okSpot(p, flock, mode, from = null, site = false) {
    const lead = flock.leader || flock.birds[0], pl = this.world.player.position;
    const placed = lead && lead.pos.lengthSq() > 0;
    const d = placed ? lead.pos.distanceTo(p) : 10;
    const outside = this.owner.playerOutside();
    const dp = Math.hypot(p.x - pl.x, p.z - pl.z);
    if (outside && !site && dp < SPECIES[flock.species].flee * 1.6) return false;
    if (mode === 'flee' && placed && dp < Math.hypot(lead.pos.x - pl.x, lead.pos.z - pl.z) + 5) return false;
    if (mode === 'hidden') return !this.#inView(p, 1) || dp > 45;
    return d > 2.5 && d < 50;
  }
  #inView(p, r) {
    const cam = this.world.camera; cam.updateMatrixWorld();
    this._f.setFromProjectionMatrix(this._pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    return this._f.intersectsSphere(this._sph.set(p, r));
  }
  /** A free place at a site for one bird: a perch near `near`, or a spot on the ground. */
  #placeFor(b, site, near) {
    if (!site) return null;
    if (site.ground) {
      const spot = site.ground.sample(Math.random, site.p, 1.6);
      return spot ? { ground: site.ground, p: spot } : null;
    }
    const size = b.span * 0.4, by = near?.lengthSq() ? near : null;
    // not right next to the player outside
    const pl = this.world.player.position, keep = this.owner.playerOutside() ? b.S.flee * 1.4 : 0;
    const free = this.places.free(site.site, size, by).filter((p) => !keep || Math.hypot(p.p.x - pl.x, p.p.z - pl.z) > keep);
    const tops = site.kind === 'top' ? free.filter((p) => p.kind === 'top') : [];
    const list = tops.length ? tops : free;
    if (!list.length) return null;
    // the first of a flock takes an open perch (out in the crown, where it is seen), the others one near it
    if (by) return { perch: Math.random() < 0.75 ? list[0] : list[Math.floor(Math.random() * Math.min(4, list.length))] };
    let r = Math.random() * list.reduce((a, p) => a + p.exposure ** 3, 0);
    for (const p of list) { r -= p.exposure ** 3; if (r <= 0) return { perch: p }; }
    return { perch: list[0] };
  }

  // ---------------------------------------------------------------- states ------------------------------------------
  /** Sit on a perch or stand on the ground at once (no flight): at the start and for flocks coming in out of sight. */
  #settle(b, where) {
    if (where.perch) {
      const p = where.perch; p.by = b; b.perch = p; b.spot = null;
      b.state = 'perch'; b.yaw = this.#perchYaw(b, p);
      this.places.perchPoint(p, b.pos);
    } else {
      b.perch = null; b.spot = where; b.state = 'ground'; b.pos.copy(where.p); b.yaw = rand(-Math.PI, Math.PI);
    }
    b.t = 0; b.stayT = rand(...(b.S.stay || [10, 30])) * (this.owner.wet() ? 2.2 : 1);
    b.vel.set(0, 0, 0); b.pitch = b.upright; b.uprightNow = b.upright; b.bank = 0;
    Object.assign(b.wing, { mode: 'closed', e: CLOSED.e, b: CLOSED.b, sw: CLOSED.sw, roll: CLOSED.roll, hs: CLOSED.hs, closed: 1 });
    b.legs = -b.upright;
  }
  /** Which way a bird sits on a perch: across a branch (mostly facing out of the crown), along the given heading. */
  #perchYaw(b, p) {
    if (p.yaw != null) return p.yaw + rand(-0.4, 0.4);
    const d = p.dir, n1 = Math.atan2(d.z, -d.x), n2 = Math.atan2(-d.z, d.x);
    // the side facing out of the tree (or the player, now and then)
    const o = Math.atan2(p.out.x, p.out.z);
    return Math.abs(wrap(n1 - o)) < Math.abs(wrap(n2 - o)) ? (Math.random() < 0.8 ? n1 : n2) : (Math.random() < 0.8 ? n2 : n1);
  }
  /** Leave the perch (or the ground) for a target: a crouch, a jump and fast deep beats. */
  #takeoff(b, target, where) {
    if (b.perch) { b.perch.by = null; }
    b.perch = null; b.spot = null;
    b.state = 'takeoff'; b.t = 0;
    b.where = where;
    // away from where it sat: towards the target, up
    const to = this._v.copy(target).sub(b.pos); to.y = 0;
    const d = to.length() || 1; to.divideScalar(d);
    const up = b.span > 0.5 ? 1.6 : 2.2;
    b.vel.set(to.x * 1.6, up, to.z * 1.6);
    b.yaw = Math.atan2(to.x, to.z) * 0.6 + b.yaw * 0.4;
    this.#route(b, target, where);
    b.state = 'takeoff'; b.t = 0;
    Object.assign(b.wing, { mode: 'flap', k: 1.25, beats: 0 });
    b.wing.phase = 0.92;
  }
  /** The way to a target: a straight line when it is free, else over the house or round the obstacle. */
  #route(b, target, where) {
    b.target = target.clone(); b.where = where;
    const P = this.places, a = b.pos, pts = [];
    // the approach: a little above and out from the perch, the way the bird will come in
    let app = null;
    if (where) {
      const L = b.S.land * (b.span > 0.5 ? 1.2 : 1);
      const out = where.perch ? where.perch.out : this._w.copy(target).sub(a).setY(0).normalize().negate();
      app = target.clone().addScaledVector(out, L * 1.05); app.y += L * 0.45;
      if (where.perch?.kind === 'roof') { app.z = Math.max(app.z, FACADE_Z + L); app.y = Math.max(app.y, target.y + 0.4); }
    }
    const end = app || target;
    const mid = a.clone().lerp(end, 0.5), dist = a.distanceTo(end);
    // the small birds keep low between the trees, the big ones fly higher over the garden
    const lift = b.span > 0.5 ? Math.min(14, 2 + dist * 0.25) : Math.min(2.5, 0.25 + dist * 0.05);
    mid.y = Math.max(a.y, end.y) + lift;
    const ground = terrainHeight(mid.x, mid.z); if (mid.y < ground + 2) mid.y = ground + 2;
    if (dist > 5) pts.push(mid);
    pts.push(end);
    // free of the house and the trunks? else up and over
    let prev = a;
    for (let i = 0; i < pts.length; i++) {
      if (P.blocked(prev, pts[i], 0.25)) {
        const over = prev.clone().lerp(pts[i], 0.5); over.y = Math.max(over.y, 8.2);
        if (!P.blocked(prev, over, 0.25) && !P.blocked(over, pts[i], 0.25)) { pts.splice(i, 0, over); i++; }
        else { const over2 = over.clone(); over2.y = 11; pts.splice(i, 0, over2); i++; }
      }
      prev = pts[i];
    }
    b.path = pts; b.pathI = 0; b.land = null;
    b.state = 'fly'; b.t = 0;
  }
  /** Fly to a new place: a perch or a spot on the ground (where), or just away (where = null). */
  #flyTo(b, where) {
    const target = where.perch ? this.places.perchPoint(where.perch, new THREE.Vector3()) : where.p.clone();
    if (where.perch) where.perch.by = b;
    // a hop under way ends here (a hop over the ground is no hop along a branch)
    b.hop = null; b.pecks = 0; b.peck = 0;
    if (b.flying) this.#route(b, target, where); else this.#takeoff(b, target, where);
  }

  // ---------------------------------------------------------------- every frame -------------------------------------
  /** The quality 'mobile' (world.mobile): the twigs of a tree only within TWIGS_NEAR metres, checked four times a second.
   *  Each is a draw of its own in the batch; further out they are thinner than a pixel of a phone's picture. The other
   *  qualities draw them all, as before. */
  #twigsNear(dt) {
    const bm = this.twigMeshes?.[0];
    if (!bm) return;
    const mobile = !!this.world.mobile;
    if (!mobile && !this.twigsCut) return;
    this.twigsT = (this.twigsT || 0) - dt;
    if (mobile && this.twigsT > 0 && this.twigsCut) return;
    this.twigsT = 0.25;
    const cam = this.world.camera?.position;
    if (!cam) return;
    if (this.twigsOf !== bm) {
      // (where each instance stands: its matrix's translation, once per batch)
      const m = new THREE.Matrix4(), at = [];
      for (let i = 0; i < bm.instanceCount; i++) { bm.getMatrixAt(i, m); at.push(m.elements[12], m.elements[14]); }
      this.twigsAt = at; this.twigsOf = bm;
    }
    const at = this.twigsAt, r2 = TWIGS_NEAR * TWIGS_NEAR;
    for (let i = 0; i < bm.instanceCount; i++) {
      const dx = at[i * 2] - cam.x, dz = at[i * 2 + 1] - cam.z;
      const show = !mobile || dx * dx + dz * dz < r2;
      if (bm.getVisibleAt(i) !== show) bm.setVisibleAt(i, show);
    }
    this.twigsCut = mobile;
  }
  update(dt, posed = true) {
    if (!this.places) return;
    this.clock += dt;
    this.#twigsNear(dt);
    // who is about: now and then, and at once when the time, the weather or the season changed
    const c = this.conditions(), key = `${c.season}|${c.light}|${c.weather}`;
    this.censusT -= dt;
    if (!this.manual && (key !== this.condKey || this.censusT <= 0)) {
      const changed = this.condKey !== undefined && key !== this.condKey;
      this.condKey = key; this.censusT = 3;
      this.#census(c, !this.ready || (changed && this.owner.jumped));
      this.ready = true;
    }
    // now and then at dusk (more seldom at night) a barn owl along the meadow
    if (!this.manual && c.light !== 'day' && c.sunY > -0.32 && (c.weather === 'clear' || c.weather === 'overcast' || c.weather === 'fog')) {
      this.owlT = (this.owlT ?? rand(20, 90)) - dt;
      if (this.owlT <= 0 && !this.flocks.some((f) => f.species === 'owl')) {
        this.owlT = c.light === 'dusk' ? rand(120, 300) : rand(300, 700);
        const f = this.#spawnFlock('owl', 1, false); if (f) f.temp = true;
      }
    }
    const pl = this.world.player.position, outside = this.owner.playerOutside();
    const cam = this.world.camera.position;
    this.#focus(dt);
    this.playerMove = lerp(this.playerMove || 0, Math.min(3, Math.hypot(pl.x - (this.plx ?? pl.x), pl.z - (this.plz ?? pl.z)) / Math.max(dt, 1e-3)), 1 - Math.exp(-3 * dt));
    this.plx = pl.x; this.plz = pl.z;
    for (const b of this.list) {
      b.dist = b.pos.distanceTo(cam);
      if (b.frozen) continue;
      // far birds that only sit are looked after less often
      b.acc0 = (b.acc0 || 0) + dt;
      const slow = !b.flying && b.dist > 45 && !b.hop;
      if (slow && b.acc0 < 0.2) continue;
      const step = Math.min(b.acc0, 0.25); b.acc0 = 0;
      b.t += step;
      switch (b.state) {
        case 'perch': this.#perched(b, step, outside, pl); break;
        case 'ground': this.#onGround(b, step, outside, pl); break;
        case 'takeoff': case 'fly': this.#fly(b, step); break;
        case 'land': this.#landing(b, step); break;
        case 'soar': this.#soar(b, step); break;
        case 'hawk': this.#hawk(b, step, outside, pl); break;
        case 'glide': this.#owlFly(b, step); break;
      }
      // (should a bird ever end up nowhere, it goes; the census brings another)
      if (!Number.isFinite(b.pos.x + b.pos.y + b.pos.z + b.vel.x + b.vel.y + b.vel.z)) { b.gone = true; continue; }
      this.#wings(b, step);
    }
    if (this.list.some((b) => b.gone)) {
      for (const b of this.list) if (b.gone) for (const p of [b.perch, b.where?.perch, b.next?.perch]) if (p && p.by === b) p.by = null;
      this.list = this.list.filter((b) => !b.gone);
      for (const f of this.flocks) { f.birds = f.birds.filter((b) => !b.gone); if (!f.birds.includes(f.leader)) f.leader = f.birds[0] || null; }
      this.flocks = this.flocks.filter((f) => f.birds.length);
    }
    this.#flocks(dt);
    if (posed) this.#draw();
  }

  /** The flocks: when the leader has sat long enough, they move on together (the others follow a moment later). */
  #flocks(dt) {
    for (const f of this.flocks) {
      if (f.leaving || !f.leader) continue;
      const L = f.leader, S = SPECIES[f.species];
      if (S.flight === 'soar' || S.flight === 'hawk' || S.flight === 'owl') continue;
      if ((L.state === 'perch' || L.state === 'ground') && L.t > L.stayT && !f.moving) this.#moveFlock(f, null);
      if (f.moving && f.birds.every((b) => b.state === 'perch' || b.state === 'ground')) f.moving = false;
    }
  }
  /** The whole flock to a new site (fleeing from `from`, the player, or just moving on). */
  #moveFlock(f, from) {
    const site = this.#pickSite(f, from, from ? 'flee' : null);
    if (!site) { for (const b of f.birds) b.stayT += 10; return; }
    f.site = site.site || null; f.moving = true;
    let near = site.p || null;
    f.birds.forEach((b, i) => {
      const where = this.#placeFor(b, site, near);
      if (where && !near) near = where.perch ? where.perch.p : where.p;
      if (!where) { b.stayT += 5; return; }
      // one after the other, a few tenths of a second apart (all at once when fleeing)
      b.goAt = this.clock + (from ? rand(0, 0.25) : i === 0 ? 0 : rand(0.15, 1.2) + i * 0.1);
      b.next = where;
      if (where.perch) where.perch.by = b;
    });
  }
  #due(b) {
    if (!b.next || this.clock < b.goAt) return false;
    const where = b.next; b.next = null;
    if (where.perch && where.perch.by !== b) return false;
    this.#flyTo(b, where);
    return true;
  }

  // ---------------------------------------------------------------- perched ---------------------------------------
  #perched(b, dt, outside, pl) {
    // a swallow resting on the wire goes back to its hunt
    if (b.S.flight === 'hawk') {
      const near = outside && !b.tame && Math.hypot(b.pos.x - pl.x, b.pos.z - pl.z) < b.S.flee * 1.5;
      if (b.t > b.stayT || near) { if (b.perch) b.perch.by = null; b.perch = null; this.#startHawk(b, false); b.vel.set(Math.sin(b.yaw) * 2, 1.5, Math.cos(b.yaw) * 2); b.wing.k = 1.2; return; }
    }
    if (this.#due(b)) return;
    if (this.#scared(b, outside, pl)) return;
    const p = b.perch; if (!p) { b.state = 'ground'; return; }
    // the bird sits where the perch is now (it sways with the tree); a hop along the branch moves it along
    this.#idle(b, dt, true);
    if (b.hop) {
      b.hop.t += dt / b.hop.dur;
      const k = Math.min(1, b.hop.t);
      p.u = lerp(b.hop.u0, b.hop.u1, k);
      if (k >= 1) b.hop = null;
    }
    this.places.perchPoint(p, b.pos);
    if (b.hop) b.pos.y += Math.sin(Math.min(1, b.hop.t) * Math.PI) * 0.025 * b.span / 0.25;
    // alone (not in a flock): moves on when it has sat long enough
    if (!b.flock || b.flock.birds.length === 1) { if (b.t > b.stayT && !b.next) this.#soloMove(b); }
  }
  #onGround(b, dt, outside, pl) {
    if (this.#due(b)) return;
    if (this.#scared(b, outside, pl)) return;
    this.#idle(b, dt, false);
    const H = this.places.height;
    if (b.hop) {
      // a hop (sparrow, tit, blackbird) or a step (crow): along the ground, a small arc
      b.hop.t += dt / b.hop.dur;
      const k = Math.min(1, b.hop.t);
      b.pos.x = lerp(b.hop.x0, b.hop.x1, k); b.pos.z = lerp(b.hop.z0, b.hop.z1, k);
      b.pos.y = H(b.pos.x, b.pos.z) + (b.S.walk ? Math.abs(Math.sin(k * Math.PI)) * 0.006 : Math.sin(k * Math.PI) * b.hop.h);
      if (k >= 1) { b.hop = null; b.pos.y = H(b.pos.x, b.pos.z); this.world.tracks?.bird(b.pos.x, b.pos.z, b.yaw, b.span, !!b.S.walk, b.pos.y); }   // its feet in the snow (tracks.js)
    } else {
      b.pos.y = H(b.pos.x, b.pos.z);
      b.hopT -= dt;
      if (b.hopT <= 0 && b.peck <= 0) this.#nextHop(b);
    }
    if (!b.flock || b.flock.birds.length === 1) { if (b.t > b.stayT && !b.next) this.#soloMove(b); }
  }
  /** A hop, a run of hops or a few steps over the ground near the spot it came down on. */
  #nextHop(b) {
    const S = b.S, spot = b.spot?.p || b.pos;
    let turn = rand(-1.2, 1.2), dist;
    // back towards the middle of its patch when it strays
    const off = Math.hypot(b.pos.x - spot.x, b.pos.z - spot.z);
    if (off > 2.2) turn = wrap(Math.atan2(spot.x - b.pos.x, spot.z - b.pos.z) - b.yaw) * 0.8;
    if (S.run) { dist = rand(0.15, 0.24); b.runLeft = (b.runLeft || 0) > 0 ? b.runLeft - 1 : Math.floor(rand(0, 6)); if (b.runLeft > 0) turn *= 0.15; }
    else if (S.walk) { dist = rand(0.12, 0.2); b.runLeft = (b.runLeft || 0) > 0 ? b.runLeft - 1 : Math.floor(rand(2, 8)); if (b.runLeft > 0) turn *= 0.2; }
    else dist = rand(0.05, 0.17);
    const yaw = b.yaw + turn, x = b.pos.x + Math.sin(yaw) * dist, z = b.pos.z + Math.cos(yaw) * dist;
    const area = b.spot?.ground;
    const ok = !inHouse(x, 0.5, z, 0.1) && (!area || Math.hypot(x - spot.x, z - spot.z) < 3.2) && Math.abs(this.places.height(x, z) - b.pos.y) < 0.12;
    b.yaw = yaw;
    if (ok) b.hop = { x0: b.pos.x, z0: b.pos.z, x1: x, z1: z, t: 0, dur: S.walk ? dist / 0.45 : S.run ? 0.11 : rand(0.11, 0.15), h: S.run ? 0.02 : 0.03 * b.span / 0.23 };
    // between hops: a pause, often a peck or two (the blackbird stands upright first and listens)
    const pause = (b.runLeft || 0) > 0 ? rand(0.02, 0.08) : S.run ? rand(0.6, 2.2) : S.walk ? rand(0.3, 1.6) : rand(0.15, 1.1);
    b.hopT = pause;
    if ((b.runLeft || 0) <= 0 && Math.random() < (S.run ? 0.6 : 0.55)) { b.pecks = 1 + Math.floor(rand(0, S.run ? 2 : 3)); b.peck = 0; b.peckDelay = S.run ? rand(0.4, 1.2) : rand(0.05, 0.3); }
  }
  /** Looking round, preening, pecking, the tail: the small life of a bird that sits or stands. */
  #idle(b, dt, perched) {
    const H = b.head, S = b.S, small = b.span < 0.45;
    // the head jerks from one direction to the next and holds (an owl turns it slowly)
    H.timer -= dt;
    if (H.timer <= 0 && b.preen <= 0) {
      H.timer = small ? rand(0.25, 1.4) : rand(0.8, 3);
      H.ty = rand(-1.25, 1.25) * (Math.random() < 0.3 ? 0.2 : 1); H.tp = rand(-0.4, 0.3);
    }
    const rate = small ? 16 : 5;
    H.yaw += clamp(H.ty - H.yaw, -rate * dt, rate * dt); H.pitch += clamp(H.tp - H.pitch, -rate * dt, rate * dt);
    // preening: the head turned back into the feathers of a wing, small quick movements
    b.preenT -= dt;
    if (b.preenT <= 0 && perched && b.preen <= 0 && !b.hop) { b.preen = rand(1.5, 4); b.preenSide = Math.random() < 0.5 ? 1 : -1; b.preenT = rand(20, 60); }
    if (b.preen > 0) {
      b.preen -= dt;
      H.ty = b.preenSide * 2.35; H.tp = 0.75 + Math.sin(this.clock * 23) * 0.12;
      H.yaw += clamp(H.ty + Math.sin(this.clock * 17) * 0.1 - H.yaw, -9 * dt, 9 * dt);
      if (b.preen <= 0) { H.ty = 0; H.tp = 0; }
    }
    // pecking on the ground: the body tips forward and the beak goes down, quickly, once or a few times
    if (b.pecks > 0) {
      b.peckDelay -= dt;
      if (b.peckDelay <= 0) { b.peck += dt / 0.16; if (b.peck >= 1) { b.peck = 0; b.pecks--; b.peckDelay = rand(0.08, 0.35); } }
    }
    // hops along the branch now and then (the small ones)
    if (perched && small && !b.hop && b.preen <= 0 && b.perch && b.perch.a.distanceToSquared(b.perch.b) > 0.04) {
      b.hopT -= dt;
      if (b.hopT <= 0) {
        b.hopT = rand(2, 9);
        const len = b.perch.a.distanceTo(b.perch.b), du = rand(0.06, 0.16) / len * (Math.random() < 0.5 ? -1 : 1);
        const u1 = clamp(b.perch.u + du, 0.12, 0.88);
        if (Math.abs(u1 - b.perch.u) > 0.02) { b.hop = { u0: b.perch.u, u1, t: 0, dur: 0.13 }; if (Math.random() < 0.25) b.yaw = wrap(b.yaw + Math.PI); }
      }
    }
    // a flick of the tail (the blackbird lifts it after landing and now and then)
    b.tail.flick = Math.max(0, b.tail.flick - dt * 3);
    if (Math.random() < dt * (S.run ? 0.25 : 0.08)) b.tail.flick = 1;
  }
  /** The player outside comes too close: the bird (and its flock) flies off, away from him. */
  #scared(b, outside, pl) {
    if (!outside || !b.S.flee || b.tame) return false;
    const d = Math.hypot(b.pos.x - pl.x, b.pos.z - pl.z), dy = Math.max(0, b.pos.y - (pl.y - 1.62) - 2.5);
    const near = Math.hypot(d, dy);
    if (near > b.S.flee || (this.playerMove < 0.3 && near > b.S.flee * 0.55)) return false;
    if (b.next) return false;
    const f = b.flock;
    if (f && f.birds.length > 1) { this.#moveFlock(f, pl); f.birds.forEach((x) => { x.lastFlee = this.clock; }); return this.#due(b); }
    this.#soloMove(b, pl);
    return this.#due(b);
  }
  /** A bird on its own moves on (or flees from `from`). */
  #soloMove(b, from = null) {
    const flock = b.flock || { species: b.species, birds: [b], leader: b };
    const site = this.#pickSite(flock, from, from ? 'flee' : null);
    if (!site) { b.stayT += 8; return; }
    const where = this.#placeFor(b, site, site.p);
    if (!where) { b.stayT += 6; return; }
    if (where.perch) where.perch.by = b;
    b.next = where; b.goAt = this.clock;
    if (b.flock) b.flock.site = site.site || null;
  }

  // ---------------------------------------------------------------- flying ----------------------------------------
  #fly(b, dt) {
    const S = b.S, P = this.places;
    if (b.state === 'takeoff' && b.t > (b.span > 0.5 ? 0.7 : 0.45)) b.state = 'fly';
    // where to: the next point of the way, then the perch
    const goal = b.path && b.path[b.pathI];
    const tgt = this._v;
    if (goal) {
      tgt.copy(goal);
      const d = b.pos.distanceTo(goal);
      if (d < Math.max(0.8, S.land * 0.8) && b.pathI < b.path.length - 1) b.pathI++;
    } else tgt.copy(b.target);
    // the target sways with its tree: follow it
    if (b.where?.perch) P.perchPoint(b.where.perch, b.target);
    const final = !b.path || b.pathI >= b.path.length - 1;
    const toEnd = b.pos.distanceTo(b.target);
    // a branch is reached from outside the crown (not past the trunk)
    const per = b.where?.perch, side = !per || (per.kind !== 'branch' && per.kind !== 'shrub') || this._c.copy(b.pos).sub(b.target).setY(0).dot(per.out) > -0.1;
    if (b.where && final && side && (toEnd < S.land * (b.span > 0.5 ? 1.25 : 1) * 1.3 || (b.path && b.pos.distanceTo(b.path[b.path.length - 1]) < 0.5))) { this.#startLanding(b); return; }
    if (!b.where && final && b.pos.distanceTo(tgt) < 3) { b.gone = true; return; }
    // steer: seek the point at cruising speed, slower on the last stretch
    const desired = this._w.copy(tgt).sub(b.pos);
    const dist = desired.length() || 1;
    let speed = S.cruise * (b.state === 'takeoff' ? 0.75 : 1);
    if (final && b.where) speed = Math.min(speed, Math.max(2.2, dist * 1.6));
    desired.multiplyScalar(speed / dist);
    const acc = b.acc.copy(desired).sub(b.vel).multiplyScalar(2.6);
    // the flock keeps together: away from the nearest, along with the others, towards their middle
    if (b.flock && b.flock.birds.length > 1) this.#boids(b, acc);
    // keep out of the house and the trunks ahead, and off the ground
    const ahead = this._s.copy(b.vel).multiplyScalar(0.55).add(b.pos);
    if (inHouse(ahead.x, ahead.y, ahead.z, 0.4)) acc.y += 18;
    const tr = P.trunkAt(ahead.x, ahead.y, ahead.z, 0.35);
    if (tr) { const sx = ahead.x - tr.x, sz = ahead.z - tr.z, l = Math.hypot(sx, sz) || 1; acc.x += sx / l * 14; acc.z += sz / l * 14; }
    const gy = terrainHeight(b.pos.x, b.pos.z);
    if (b.pos.y < gy + 0.6 && b.state !== 'takeoff') acc.y += (gy + 0.6 - b.pos.y) * 25;
    // the beat of the wings lifts, a shut wing falls (the bounding flight undulates)
    const w = b.wing;
    const lift = w.mode === 'bound' ? -G * 0.55 : w.mode === 'flap' ? 2.2 * (b.state === 'takeoff' ? 2.5 : 1) : -0.6;
    const max = S.acc * (b.state === 'takeoff' ? 1.4 : 1);
    const l = acc.length(); if (l > max) acc.multiplyScalar(max / l);
    acc.y += lift;
    b.vel.addScaledVector(acc, dt);
    const v = b.vel.length(), vmax = S.cruise * 1.35, vmin = b.state === 'takeoff' ? 0 : S.cruise * 0.45;
    if (v > vmax) b.vel.multiplyScalar(vmax / v); else if (v < vmin && v > 1e-3) b.vel.multiplyScalar(vmin / v);
    b.pos.addScaledVector(b.vel, dt);
    this.#keepOut(b);
    // (pushed back up over a roof it loses the speed of its fall: it flies on at its pace)
    const v2 = b.vel.length(); if (v2 < vmin && v2 > 1e-3) b.vel.multiplyScalar(vmin / v2);
    this.#orient(b, acc, dt);
    this.#flapPlan(b, dt, dist);
    // legs tucked, the tail a little open when turning
    b.legs = lerp(b.legs, -1.85, 1 - Math.exp(-8 * dt));
    b.tail.spread = lerp(b.tail.spread, 0.12 + Math.min(0.5, Math.abs(b.bank) * 0.5), 1 - Math.exp(-6 * dt));
    b.tail.tilt = lerp(b.tail.tilt, 0, 1 - Math.exp(-6 * dt));
    b.head.yaw = lerp(b.head.yaw, clamp(b.bank * 0.4, -0.5, 0.5), 1 - Math.exp(-6 * dt)); b.head.pitch = lerp(b.head.pitch, b.pitch * 0.6, 1 - Math.exp(-6 * dt));
  }
  /** Never into the house or a trunk: a bird that would be inside is put back out the nearest way (up over the roof,
   *  out of a wall, round the trunk). The steering keeps them clear; this only catches what it misses. */
  #keepOut(b) {
    const p = b.pos;
    for (const h of HOUSE_BOXES) {
      if (p.x <= h.x0 || p.x >= h.x1 || p.z <= h.z0 || p.z >= h.z1 || p.y >= h.y1) continue;
      const up = h.y1 - p.y, m = Math.min(up, p.x - h.x0, h.x1 - p.x, p.z - h.z0, h.z1 - p.z);
      if (m === up) { p.y = h.y1; if (b.vel.y < 0) b.vel.y = 0; }
      else if (m === p.x - h.x0) p.x = h.x0; else if (m === h.x1 - p.x) p.x = h.x1; else if (m === p.z - h.z0) p.z = h.z0; else p.z = h.z1;
    }
    const t = this.places.trunkAt(p.x, p.y, p.z, -0.1);
    if (t) { const dx = p.x - t.x, dz = p.z - t.z, l = Math.hypot(dx, dz) || 1, r = t.r - 0.09; p.x = t.x + dx / l * r; p.z = t.z + dz / l * r; }
  }
  /** Heading along the way, the nose with the climb, banked into the turn. */
  #orient(b, acc, dt) {
    const v = b.vel, hs = Math.hypot(v.x, v.z);
    if (hs > 0.2) {
      const yaw = Math.atan2(v.x, v.z);
      b.yaw += wrap(yaw - b.yaw) * (1 - Math.exp(-10 * dt));
    }
    const climb = Math.atan2(v.y, Math.max(hs, 0.5));
    const want = clamp(climb * 0.7 + 0.06 + (b.state === 'takeoff' ? 0.18 : 0), -0.6, 0.8);
    b.pitch += (want - b.pitch) * (1 - Math.exp(-8 * dt));
    // the sideways pull of the turn: left (+x of the bird) banks the left wing down
    const lx = Math.cos(b.yaw), lz = -Math.sin(b.yaw);
    const lat = acc.x * lx + acc.z * lz;
    const bank = clamp(Math.atan2(lat, G), -1.15, 1.15);
    b.bank += (bank - b.bank) * (1 - Math.exp(-6 * dt));
  }
  /** Separation, alignment and cohesion with the other flying birds of the flock. */
  #boids(b, acc) {
    let n = 0; const al = this._a || (this._a = new THREE.Vector3()), co = this._b || (this._b = new THREE.Vector3());
    al.set(0, 0, 0); co.set(0, 0, 0);
    const sepR = Math.max(0.5, b.span * 2.2);
    for (const o of b.flock.birds) {
      if (o === b || !(o.state === 'fly' || o.state === 'takeoff')) continue;
      const dx = b.pos.x - o.pos.x, dy = b.pos.y - o.pos.y, dz = b.pos.z - o.pos.z, d = Math.hypot(dx, dy, dz);
      if (d < sepR && d > 1e-4) { const k = (sepR - d) / sepR * 22 / d; acc.x += dx * k; acc.y += dy * k * 0.5; acc.z += dz * k; }
      if (d < 7) { al.add(o.vel); co.add(o.pos); n++; }
    }
    if (n) {
      al.divideScalar(n).sub(b.vel).multiplyScalar(0.9); acc.add(al);
      co.divideScalar(n).sub(b.pos).multiplyScalar(0.7); acc.add(co);
    }
  }
  /** When to beat, when to glide or shut the wings: by the flight style of the species. */
  #flapPlan(b, dt, dist) {
    const w = b.wing, S = b.S;
    if (b.state === 'takeoff') { if (w.mode !== 'flap') { w.mode = 'flap'; w.beats = 0; } w.k = 1.25; return; }
    w.k = lerp(w.k, 1, 1 - Math.exp(-3 * dt));
    w.hold -= dt;
    const climbing = b.vel.y < -0.2 || (b.path && b.path[b.pathI] && b.path[b.pathI].y > b.pos.y + 0.5);
    switch (S.flight) {
      case 'bound':
        // a burst of 3 to 6 beats, then the wings shut for a moment
        if (w.mode === 'flap' && w.beats >= w.plan && !climbing) { w.mode = 'bound'; w.hold = rand(0.1, 0.22); }
        else if (w.mode !== 'flap' && w.hold <= 0) { w.mode = 'flap'; w.beats = 0; w.plan = Math.floor(rand(3, 7)); w.phase = 0; }
        break;
      case 'flapglide':
        if (w.mode === 'flap' && w.beats >= w.plan && !climbing) { w.mode = 'glide'; w.hold = rand(0.25, 0.7); }
        else if (w.mode !== 'flap' && w.hold <= 0) { w.mode = 'flap'; w.beats = 0; w.plan = Math.floor(rand(4, 9)); w.phase = 0; }
        break;
      case 'flap':
        if (w.mode === 'flap' && w.beats >= w.plan && !climbing && Math.random() < 0.3) { w.mode = 'glide'; w.hold = rand(0.4, 1.0); w.beats = 0; }
        else if (w.mode !== 'flap' && w.hold <= 0) { w.mode = 'flap'; w.beats = 0; w.plan = Math.floor(rand(5, 12)); w.phase = 0; }
        else if (w.mode === 'flap' && w.beats >= w.plan) { w.beats = 0; w.plan = Math.floor(rand(5, 12)); }
        break;
      default:
        if (w.mode !== 'flap' && w.mode !== 'glide') w.mode = 'flap';
    }
  }

  // ---------------------------------------------------------------- landing ---------------------------------------
  #startLanding(b) {
    const S = b.S, p1 = b.target;
    const d = b.pos.distanceTo(p1), v = Math.max(1.5, b.vel.length());
    b.land = { p0: b.pos.clone(), v0: b.vel.clone(), T: clamp(1.7 * d / v, 0.38, b.span > 0.5 ? 1.6 : 1.1), s: 0, pitch0: b.pitch };
    b.state = 'land'; b.t = 0;
    b.wing.mode = 'glide';
  }
  #landing(b, dt) {
    const L = b.land, P = this.places;
    if (b.where?.perch) P.perchPoint(b.where.perch, b.target);
    L.s = Math.min(1, L.s + dt / L.T);
    const s = L.s, s2 = s * s, s3 = s2 * s, T = L.T;
    // a Hermite curve from where the landing began to the perch, arriving slowly and from slightly above
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    const v1 = this._w.copy(b.target).sub(L.p0).setY(0); const l1 = v1.length() || 1; v1.multiplyScalar(0.25 / l1); v1.y = -0.15;
    const x = L.p0.x * h00 + L.v0.x * T * h10 + b.target.x * h01 + v1.x * T * h11;
    const y = L.p0.y * h00 + L.v0.y * T * h10 + b.target.y * h01 + v1.y * T * h11;
    const z = L.p0.z * h00 + L.v0.z * T * h10 + b.target.z * h01 + v1.z * T * h11;
    b.vel.set(x - b.pos.x, y - b.pos.y, z - b.pos.z).divideScalar(Math.max(dt, 1e-4));
    b.pos.set(x, y, z);
    this.#keepOut(b);
    // the flare: the body comes up, the wings beat forward, the legs reach out, the tail fans
    const flare = smoothstep(0.38, 0.8, s);
    const hs = Math.hypot(b.vel.x, b.vel.z);
    if (hs > 0.15 && s < 0.9) b.yaw += wrap(Math.atan2(b.vel.x, b.vel.z) - b.yaw) * (1 - Math.exp(-10 * dt));
    b.pitch = lerp(L.pitch0, b.span > 0.5 ? 0.85 : 1.05, flare);
    b.bank *= Math.exp(-6 * dt);
    b.wing.mode = flare > 0.05 ? 'flare' : 'glide';
    b.legs = lerp(-1.85, 0.75, smoothstep(0.45, 0.85, s));
    b.tail.spread = lerp(0.2, 0.75, flare); b.tail.tilt = -0.45 * flare;
    b.head.pitch = lerp(b.head.pitch, b.pitch * 0.85, 1 - Math.exp(-10 * dt)); b.head.yaw *= Math.exp(-8 * dt);
    if (s >= 1) {
      const where = b.where;
      b.land = null; b.path = null; b.where = null;
      if (where?.perch && where.perch.by !== b && where.perch.by) { this.#flyTo(b, this.#placeFor(b, { site: where.perch.site }, b.pos) || { p: b.pos.clone() }); return; }
      this.#touchDown(b, where);
    }
  }
  /** On the perch or the ground: the wings fold, the body settles upright, the tail flicks. */
  #touchDown(b, where) {
    const pitch = b.pitch;
    if (where?.perch) { where.perch.by = b; b.perch = where.perch; b.spot = null; b.state = 'perch'; b.yaw = wrap(b.yaw * 0.5 + this.#perchYaw(b, where.perch) * 0.5); }
    else { b.perch = null; b.spot = where || { p: b.pos.clone() }; b.state = 'ground'; this.world.tracks?.bird(b.pos.x, b.pos.z, b.yaw, b.span, false, b.pos.y); }
    b.t = 0; b.stayT = rand(...(b.S.stay || [10, 30])) * (this.owner.wet() ? 2.2 : 1);
    b.vel.set(0, 0, 0); b.pitch = pitch; b.uprightNow = pitch;
    b.wing.mode = 'closed'; b.tail.flick = 1; b.hop = null; b.hopT = rand(0.6, 2.5); b.head.timer = rand(0.1, 0.4);
  }

  // ---------------------------------------------------------------- the buzzard -------------------------------------
  /** Circling on a thermal, climbing; then a long glide to the next one. */
  #startSoar(b, instant) {
    const cx = rand(-30, 40), cz = rand(30, 90);
    b.soar = { cx, cz, r: rand(20, 32), a: rand(0, TAU), dir: Math.random() < 0.5 ? 1 : -1, y: terrainHeight(cx, cz) + rand(30, 55), top: rand(70, 95), glide: null };
    b.state = 'soar'; b.t = 0; b.wing.mode = 'glide';
    const s = b.soar;
    // one coming in (not there at the start) circles higher up first
    if (!instant) s.y += 20;
    b.pos.set(cx + Math.cos(s.a) * s.r, s.y, cz + Math.sin(s.a) * s.r);
    s.head = b.yaw = -s.a + (s.dir < 0 ? Math.PI : 0);   // along the circle
  }
  #soar(b, dt) {
    const s = b.soar, v = b.S.cruise;
    s.head ??= b.yaw;
    let want, climb = 0.55;
    if (s.glide) {
      // the glide to the next thermal: straight on, slowly sinking
      const g = s.glide, dx = g.x - b.pos.x, dz = g.z - b.pos.z;
      want = Math.atan2(dx, dz); climb = -0.9;
      if (Math.hypot(dx, dz) < g.r + 2) { s.cx = g.x; s.cz = g.z; s.r = g.r; s.glide = null; }
    }
    if (!s.glide) {
      // round the thermal, rising (its centre drifts with the wind): along the circle, turning in when outside it and
      // out when inside, so it comes in from any side without a jerk
      s.cx += 0.25 * dt; s.cz += 0.08 * dt;
      const dx = b.pos.x - s.cx, dz = b.pos.z - s.cz;
      want = -Math.atan2(dz, dx) + (s.dir < 0 ? Math.PI : 0) - s.dir * clamp((Math.hypot(dx, dz) - s.r) / 8, -1.2, 1.2);
      if (b.pos.y > s.top || b.t > rand(60, 400) && Math.random() < dt * 0.02) {
        // off to the next thermal, within sight of the house and not too near
        let gx = 0, gz = 0;
        for (let i = 0; i < 8; i++) { gx = clamp(b.pos.x + rand(-120, 120), -60, 80); gz = clamp(b.pos.z + rand(-80, 80), 25, 140); if (Math.hypot(gx - b.pos.x, gz - b.pos.z) > 60) break; }
        s.glide = { x: gx, z: gz, r: rand(16, 30) }; s.top = rand(70, 95); b.t = 0;
      }
    }
    // the heading turns at a buzzard's pace (a circle of 9 m at the tightest), the bank follows the turn
    const rate = clamp(wrap(want - s.head) * 1.5, -v / 9, v / 9);
    s.head = wrap(s.head + rate * dt);
    b.vel.set(Math.sin(s.head) * v + (s.glide ? 0 : 0.25), climb, Math.cos(s.head) * v + (s.glide ? 0 : 0.08));
    b.pos.addScaledVector(b.vel, dt);
    b.yaw = s.head; b.pitch = s.glide ? 0.02 : 0.04;
    b.bank += (clamp(Math.atan(v * rate / G), -0.9, 0.9) - b.bank) * (1 - Math.exp(-2 * dt));
    // now and then a few slow beats
    const w = b.wing;
    w.hold -= dt;
    if (w.mode === 'glide' && w.hold <= 0 && Math.random() < dt * 0.05) { w.mode = 'flap'; w.beats = 0; w.plan = Math.floor(rand(3, 6)); w.phase = 0; }
    if (w.mode === 'flap' && w.beats >= w.plan) { w.mode = 'glide'; w.hold = rand(8, 25); }
    b.tail.spread = s.glide ? 0.05 : 0.38; b.legs = -1.85; b.head.yaw = Math.sin(this.clock * 0.3 + b.scale * 9) * 0.5; b.head.pitch = 0.35;
  }

  // ---------------------------------------------------------------- the swallows ------------------------------------
  /** Hunting low over the meadow and the lake in wide loops, now and then down to the water to drink, now and then a
   *  rest on the wires over the terrace. */
  #startHawk(b, instant) {
    b.state = 'hawk'; b.t = 0; b.hawk = { goal: this.#hawkGoal(b), rest: rand(40, 150) }; b.legs = -1.85; b.hop = null;
    if (instant || !b.pos.lengthSq()) { const g = this.#hawkGoal(b); b.pos.copy(g); b.vel.set(rand(-1, 1), 0, rand(-1, 1)).setLength(b.S.cruise); }
    b.wing.mode = 'flap';
  }
  #hawkGoal(b) {
    for (let i = 0; i < 20; i++) {
      const lake = Math.random() < 0.45;
      const x = lake ? LAKE.x + rand(-0.8, 0.8) * LAKE.rx : rand(-12, 24), z = lake ? LAKE.z + rand(-0.8, 0.8) * LAKE.rz : rand(13, 52);
      if (lake && lakeDist(x, z) > 0.85) continue;
      if (!lake && !(inZone('meadow', x, z) || (Math.abs(x) < 10 && z > 11 && z < 24))) continue;
      const base = lake ? WATER_Y : terrainHeight(x, z);
      return new THREE.Vector3(x, base + (lake ? rand(0.5, 2.6) : rand(0.9, 5.5)), z);
    }
    return new THREE.Vector3(0, 3, 22);
  }
  #hawk(b, dt, outside, pl) {
    const h = b.hawk, S = b.S;
    if (b.next) { if (this.#due(b)) return; }
    h.rest -= dt;
    if (h.rest <= 0 && !b.next) {
      // a rest on the wires
      h.rest = rand(60, 200);
      const site = this.places.sites.find((s) => s.kind === 'terrace');
      const wires = site ? site.perches.filter((p) => p.kind === 'wire' && !p.by) : [];
      if (wires.length && !(outside && Math.hypot(pl.x, pl.z - 8) < 6)) { const p = pick(wires); p.by = b; b.next = { perch: p }; b.goAt = this.clock; b.state = 'fly'; this.#flyTo(b, b.next); b.next = null; return; }
    }
    if (b.pos.distanceTo(h.goal) < 4 || b.t > 7) { h.goal = this.#hawkGoal(b); b.t = 0; if (Math.random() < 0.25 && lakeDist(h.goal.x, h.goal.z) < 0.8) h.goal.y = WATER_Y + 0.05; }
    const desired = this._w.copy(h.goal).sub(b.pos).setLength(S.cruise * rand(0.95, 1.15));
    const acc = b.acc.copy(desired).sub(b.vel).multiplyScalar(2.2);
    // the player is in the way: round him; trees and the house: away
    if (outside) { const dx = b.pos.x - pl.x, dz = b.pos.z - pl.z, d = Math.hypot(dx, dz); if (d < 3) { acc.x += dx / d * 25; acc.z += dz / d * 25; } }
    const ahead = this._s.copy(b.vel).multiplyScalar(0.5).add(b.pos);
    if (inHouse(ahead.x, ahead.y, ahead.z, 0.6)) acc.y += 25;
    const tr = this.places.trunkAt(ahead.x, ahead.y, ahead.z, 0.4);
    if (tr) { const sx = ahead.x - tr.x, sz = ahead.z - tr.z, l = Math.hypot(sx, sz) || 1; acc.x += sx / l * 20; acc.z += sz / l * 20; }
    const lake = lakeDist(b.pos.x, b.pos.z) < 1, floor = lake ? WATER_Y + 0.06 : terrainHeight(b.pos.x, b.pos.z) + 0.6;
    if (b.pos.y < floor + 0.25) acc.y += (floor + 0.25 - b.pos.y) * 30;
    const l = acc.length(); if (l > S.acc) acc.multiplyScalar(S.acc / l);
    b.vel.addScaledVector(acc, dt);
    const v = b.vel.length(); if (v > S.cruise * 1.3) b.vel.multiplyScalar(S.cruise * 1.3 / v); if (v < S.cruise * 0.6) b.vel.multiplyScalar(S.cruise * 0.6 / Math.max(v, 1e-3));
    b.pos.addScaledVector(b.vel, dt);
    if (b.pos.y < floor) b.pos.y = floor;
    this.#keepOut(b);
    // a touch of the water: a ring spreads where it drank
    if (lake && b.pos.y < WATER_Y + 0.1 && this.clock - (b.drank || -9) > 2) { b.drank = this.clock; this.owner.splash?.(b.pos.x, b.pos.z, 0.5, true); }
    this.#orient(b, acc, dt);
    const w = b.wing; w.hold -= dt;
    if (w.mode === 'flap' && w.beats >= (w.plan || 4)) { w.mode = 'glide'; w.hold = rand(0.3, 0.9); }
    else if (w.mode !== 'flap' && w.hold <= 0) { w.mode = 'flap'; w.beats = 0; w.plan = Math.floor(rand(3, 7)); w.phase = 0; }
    b.legs = -1.85; b.tail.spread = 0.1 + Math.min(0.5, Math.abs(b.bank) * 0.6); b.head.pitch = b.pitch * 0.6;
  }

  // ---------------------------------------------------------------- the owl ------------------------------------------
  /** A barn owl along the meadow at dusk: out of the wood, low over the grass in a few turns, back into the wood. */
  #startOwl(b) {
    // a way in a few loose turns over the meadow and the lawn, 3 to 5 m over the grass (or the water), round the trees
    let curve = null;
    for (let tries = 0; tries < 12 && !curve; tries++) {
      const side = Math.random() < 0.5 ? 1 : -1;
      const pts = [[side * 32, rand(28, 50)], [side * 14, rand(30, 46)], [rand(-4, 8), rand(22, 36)], [-side * 6, rand(30, 44)], [-side * 22, rand(40, 58)], [-side * 40, rand(46, 64)]];
      const c = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, Math.max(terrainHeight(x, z), WATER_Y) + rand(2.8, 5), z)));
      const n = 80, sp = c.getSpacedPoints(n);
      let free = true;
      for (let i = 1; i < n && free; i++) if (this.places.blocked(sp[i - 1], sp[i], 0.3) || sp[i].y < Math.max(terrainHeight(sp[i].x, sp[i].z), WATER_Y) + 1.5) free = false;
      if (free || tries === 11) curve = c;
    }
    b.owl = { curve, len: curve.getLength(), s: 0 };
    b.state = 'glide'; b.t = 0; b.wing.mode = 'glide';
    curve.getPointAt(0, b.pos);
  }
  #owlFly(b, dt) {
    const o = b.owl, v = b.S.cruise;
    o.s += v * dt / o.len;
    if (o.s >= 1) { b.gone = true; return; }
    const p = o.curve.getPointAt(o.s, this._s), t = o.curve.getTangentAt(o.s, this._w);
    const acc = this._v.copy(t).multiplyScalar(v).sub(b.vel).divideScalar(Math.max(dt, 1e-3));
    b.vel.copy(t).multiplyScalar(v); b.pos.copy(p); this.#keepOut(b);
    this.#orient(b, acc.multiplyScalar(0.2), dt);
    const w = b.wing; w.hold -= dt;
    if (w.mode === 'flap' && w.beats >= w.plan) { w.mode = 'glide'; w.hold = rand(0.8, 2.2); }
    else if (w.mode !== 'flap' && w.hold <= 0) { w.mode = 'flap'; w.beats = 0; w.plan = Math.floor(rand(2, 5)); w.phase = 0; }
    b.legs = -1.5; b.tail.spread = 0.2; b.head.pitch = 0.45; b.head.yaw = Math.sin(this.clock * 0.7) * 0.4;
  }

  // ---------------------------------------------------------------- the wing beat -----------------------------------
  /**
   * The wings by what they do. A beat: the arm goes from the top (+) to the bottom (-) in the downstroke and back in the
   * upstroke; the hand lags behind the arm (the tip bends up in the downstroke and trails in the upstroke); in the
   * upstroke arm and hand fold back (the small birds almost shut them), in the downstroke the wing is spread wide and
   * reaches forward a little; the wing twists with the beat. Gliding: spread at the species' dihedral; shut: closed
   * against the body; the flare: deep beats, the wings forward.
   */
  #wings(b, dt) {
    const w = b.wing, S = b.S;
    let e, bb, sw, roll, hs, closed = 0, rate = 18;
    if (w.mode === 'flap' || w.mode === 'flare') {
      const flare = w.mode === 'flare', f = w.freq * (flare ? 1.3 : 1) * (w.k > 1.05 ? 1.2 : 1);
      w.phase += f * dt;
      if (w.phase >= 1) { w.phase -= Math.floor(w.phase); w.beats++; }
      const down = 0.52;
      const ph = w.phase, th = ph < down ? Math.PI * ph / down : Math.PI + Math.PI * (ph - down) / (1 - down);
      const c = Math.cos(th), s = Math.sin(th), up = Math.max(0, -s);
      const top = flare ? S.top * 1.15 : S.top, bottom = flare ? -0.25 : S.bottom, k = flare ? 1 : w.k;
      const mid = (top + bottom) / 2, amp = (top - bottom) / 2 * k;
      e = mid + amp * c;
      bb = S.lag * s;
      sw = S.foldArm * up * up - 0.1 * Math.max(0, s) - (flare ? 0.35 : 0);
      hs = S.foldHand * up;
      roll = S.twist * s - (flare ? 0.25 : 0);
      rate = 40;
    } else if (w.mode === 'glide') {
      [e, bb, sw, hs] = S.glide; roll = 0;
      // a buzzard's fingers bend up as the wing carries; a gentle rocking in the air
      e += Math.sin(this.clock * 1.7 + b.scale * 13) * 0.03;
    } else if (w.mode === 'bound') {
      ({ e, b: bb, sw, roll, hs } = CLOSED); closed = 0.96; rate = 30;
    } else {
      ({ e, b: bb, sw, roll, hs } = CLOSED); closed = 1;
      // preening lifts the wing a little
      if (b.preen > 0) { e += 0.12; closed = 0.8; }
      if (b.state === 'perch' || b.state === 'ground') rate = 9;
    }
    const k = 1 - Math.exp(-rate * dt);
    w.e += (e - w.e) * k; w.b += (bb - w.b) * k; w.sw += (sw - w.sw) * k; w.roll += (roll - w.roll) * k; w.hs += (hs - w.hs) * k; w.closed += (closed - w.closed) * k;
    // on the perch or the ground: upright, legs straight down (a peck tips it forward)
    if (b.state === 'perch' || b.state === 'ground') {
      const peck = b.peck > 0 ? Math.sin(b.peck * Math.PI) : 0;
      const want = b.upright * (b.state === 'ground' ? 0.55 : 1) - peck * (b.S.walk ? 0.55 : 0.75);
      b.uprightNow += (want - b.uprightNow) * (1 - Math.exp(-14 * dt));
      b.pitch = b.uprightNow; b.bank *= Math.exp(-10 * dt);
      b.legs = -b.pitch;
      b.head.pitch = lerp(b.head.pitch, b.head.tp + peck * 0.6 - b.pitch * 0.5, 1 - Math.exp(-20 * dt));
      b.tail.spread = lerp(b.tail.spread, 0, 1 - Math.exp(-6 * dt));
      b.tail.tilt = lerp(b.tail.tilt, (b.S.run ? 0.5 : 0.25) * b.tail.flick - 0.12 + b.pitch * 0.25, 1 - Math.exp(-12 * dt));
    }
  }

  // ---------------------------------------------------------------- drawing ------------------------------------------
  #draw() {
    const cam = this.world.camera; cam.updateMatrixWorld();
    this._f.setFromProjectionMatrix(this._pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    for (const ms of this.meshSets) for (const m of ms) m.userData.n = 0;
    // which birds are seen, and for each mesh whether one of them is near: then all of them are drawn with the near
    // mesh (a draw call less; the far ones cost the graphics card little more)
    const near = this._near ||= new Set();
    near.clear();
    for (const b of this.list) {
      b.seen = false;
      const L = LOD(b.span);
      if (b.dist > L.far) continue;
      if (!this._f.intersectsSphere(this._sph.set(b.pos, b.span * 0.6 * b.scale))) continue;
      b.seen = true;
      if (b.dist < L.near) near.add(this.meshes.get(b.kind));
    }
    for (const b of this.list) {
      if (!b.seen) continue;
      const ms = this.meshes.get(b.kind), m = ms[near.has(ms) ? 0 : 1];
      if (m.userData.n >= m.instanceMatrix.count) continue;
      const i = m.userData.n++;
      this.#pose(b, m, i);
    }
    for (const ms of this.meshSets) for (const m of ms) {
      const n = m.userData.n;
      m.count = n; m.visible = n > 0;
      if (!n) continue;
      m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, n * 16); m.instanceMatrix.needsUpdate = true;
      const buf = m.userData.at.aWing.data; buf.clearUpdateRanges(); buf.addUpdateRange(0, n * 12); buf.needsUpdate = true;
    }
  }
  /** One bird into its mesh: the matrix (where perched: so that its feet are on the perch) and the pose. */
  #pose(b, m, i) {
    const q = this._q.setFromEuler(this._e.set(-b.pitch, b.yaw, -b.bank, 'YXZ'));
    const s = b.scale, pos = this._s.copy(b.pos);
    if (b.state === 'perch' || b.state === 'ground' || b.state === 'land' || b.state === 'takeoff') {
      // the point between the feet in the body (the legs turn at the hip) onto the point it stands on
      const J = b.J, a = -b.legs, ca = Math.cos(a), sa = Math.sin(a);
      const fy = J.foot[1] - J.hip[1], fz = J.foot[2] - J.hip[2];
      const tuck = clamp(b.legs * -1 - 1.1, 0, 1), sh = 1 - 0.6 * tuck;
      const lx = 0, ly = J.hip[1] + (fy * ca - fz * sa) * sh, lz = J.hip[2] + (fy * sa + fz * ca) * sh;
      const foot = this._v.set(lx, ly, lz).multiplyScalar(s).applyQuaternion(q);
      const k = b.state === 'perch' || b.state === 'ground' ? 1 : b.state === 'land' ? smoothstep(0.7, 1, b.land?.s || 0) : 1 - smoothstep(0, 0.12, b.t);
      pos.addScaledVector(foot, -k);
    }
    this._m.compose(pos, q, this._v.set(s, s, s));
    m.setMatrixAt(i, this._m);
    const at = m.userData.at, w = b.wing;
    at.aWing.setXYZW(i, w.e, w.b, w.sw, w.roll);
    at.aPose.setXYZW(i, b.head.yaw, b.head.pitch, b.tail.spread, b.legs);
    at.aPose2.setXYZW(i, w.hs, b.tail.tilt, this.alt.has(b.kind) ? 1 : 0, w.closed);
  }

  // ---------------------------------------------------------------- tests and pictures --------------------------------
  /** Remove every bird (setting switched off, tests). */
  clear() { for (const b of this.list) if (b.perch) b.perch.by = null; for (const p of this.places?.perches || []) p.by = null; this.list = []; this.flocks = []; this.condKey = undefined; this.ready = false; for (const ms of this.meshSets) for (const m of ms) { m.count = 0; m.visible = false; } }
  /**
   * Tests and pictures: one bird of `kind` held still or doing one thing. opts: { at: Vector3 | perch, yaw, mode:
   * 'perch' | 'flap' | 'glide' | 'bound' | 'flare' | 'closed', path: [Vector3] (it flies along), speed, phase, hold }.
   * Returns the bird.
   */
  spawn(kind, opts = {}) {
    const species = Object.keys(SPECIES).find((k) => SPECIES[k].kinds.includes(kind));
    const b = new Bird(this, species, kind, null);
    b.test = opts;
    if (opts.perch) { this.#settle(b, { perch: opts.perch }); if (opts.yaw != null) b.yaw = opts.yaw; }
    else if (opts.ground) { this.#settle(b, { p: opts.ground.clone(), ground: null }); if (opts.yaw != null) b.yaw = opts.yaw; }
    else {
      b.pos.copy(opts.at || new THREE.Vector3(0, 3, 20)); b.yaw = opts.yaw ?? 0;
      b.state = opts.state || 'hold'; b.pitch = opts.pitch ?? 0.05; b.bank = opts.bank ?? 0; b.legs = -1.85;
      b.wing.mode = opts.mode || 'flap'; b.wing.closed = 0; if (opts.phase != null) b.wing.phase = opts.phase;
    }
    b.stayT = opts.stay ?? 1e9; b.tame = opts.tame ?? true;
    this.list.push(b);
    return b;
  }
  /** Fly a test bird to a perch or a ground point (it takes off from where it is). */
  send(b, where) { b.stayT = 1e9; this.#flyTo(b, where); }
  /** The birds as they are now. */
  info() {
    return {
      ready: !!this.ready, places: this.places ? { perches: this.places.perches.length, sites: this.places.sites.length, kinds: [...new Set(this.places.perches.map((p) => p.kind))], ms: Math.round(this.places.ms), slowest: Math.round(this.places.slowest), parts: this.places.parts } : null,
      flocks: this.flocks.map((f) => ({ species: f.species, n: f.birds.length, leaving: f.leaving })),
      birds: this.list.map((b) => ({ kind: b.kind, species: b.species, state: b.state, x: +b.pos.x.toFixed(2), y: +b.pos.y.toFixed(2), z: +b.pos.z.toFixed(2), speed: +b.vel.length().toFixed(2), phase: +b.wing.phase.toFixed(3), mode: b.wing.mode, perch: b.perch?.kind || null, seen: b.seen })),
    };
  }
  /** Test hook: a bird's wings at a phase of the beat (or in another mode), held there until `frozen` is cleared. */
  poseAt(b, phase, mode = b.wing.mode) {
    b.wing.mode = mode; b.wing.phase = phase; b.wing.k = 1;
    const f = b.wing.freq; b.wing.freq = 0; this.#wings(b, 1); b.wing.freq = f;
    b.frozen = true;
  }
}
