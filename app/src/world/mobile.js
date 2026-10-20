// The quality 'mobile' (world.js): what it saves beyond the pixels, for a phone's processor and its graphics process.
//   • Only what can be seen through the openings. The world is four zones: the garden (outside), the hall, the
//     passage and the book room. Each is seen from the others only through its openings: the glass front (hall and
//     garden), the windows of the book room (book room and garden), the two arches of the passage. Before each frame
//     the openings are projected; a zone behind no opening in view is left out of the frame altogether, the others are
//     drawn only where they fall into the rectangle of the screen their openings cover (a frustum through it, the
//     openings in a row intersected: the book room from the hall through both arches). Left out are the furniture
//     (every placement and every batch of world.js #batchStatic by the zones its bounds touch), the garden's parts,
//     its trees, its birds and wildlife. Left out for the frame only: the visibility is given back right after it,
//     so that nothing else (raycasts, the garden's own switches) sees a change. The walls are not asked: an opening
//     seen through a wall counts as seen (the picture is never missing anything).
//   • The trees are culled here, not by three's BatchedMesh (per tree, against their zone's frustum, unsorted):
//     BatchedMesh rebuilds its lists only when a tree changes its visibility.
//   • MOBILE_LIGHTS real point lights for all lamps: the lamps' own lights stay out of the frame (their layers) and a
//     pool of lights takes the lamps that matter most where the eye is (the same zone first), fading over a quarter
//     of a second when one lamp hands over to another. The shaders loop over MOBILE_LIGHTS lights instead of ten
//     (programs of their own, compiled with the world's warm-up).
//   • The opaque things sorted by their program first (fewer program switches, each of which uploads every light).
//   • The furniture merged into the batches is hidden and stands still: its matrices are no longer updated.
import * as THREE from 'three';
import { HOUSE } from './outdoor.js';
import { HALL, ROOM, PASSAGE } from './layout.js';

export const MOBILE_LIGHTS = 4;
const FADE = 4;                    // per second: a lamp's share in the pool fades in and out in a quarter of a second
const OUT = 0, HALLZ = 1, PASS = 2, ROOMZ = 3;
/** The zone of a point by its depth: the garden in front of the facade (and round the house: the garden's own parts
 *  are always outside), the hall, the passage, the book room. */
const zoneAt = (z) => (z > HOUSE.front ? OUT : z > HALL.z0 ? HALLZ : z > ROOM.z1 ? PASS : ROOMZ);
const v = new THREE.Vector3(), sphere = new THREE.Sphere(), m4 = new THREE.Matrix4();
const cam4 = [0, 1, 2, 3].map(() => new THREE.Vector3()), clipped = Array.from({ length: 8 }, () => new THREE.Vector3());
const FULL = [-1, -1, 1, 1];
const meet = (a, b) => { if (!a || !b) return null; const r = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]; return r[0] < r[2] && r[1] < r[3] ? r : null; };
const join = (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
const quadOf = (x0, x1, y0, y1, z) => [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]].map((p) => new THREE.Vector3(...p));

export class MobileTier {
  constructor(world) {
    this.world = world;
    this.on = false;
    this.frustums = [0, 1, 2, 3].map(() => new THREE.Frustum());
    this.rects = [null, null, null, null];
    this.viewProj = new THREE.Matrix4();
    this.hidden = [];                        // objects left out of this frame: [object, visible]
    this.stats = { zones: '', garden: true, trees: 0, treesShown: 0, objects: 0, hiddenObjects: 0 };
    this.frozen = [];                        // the furniture merged into the batches: their matrices stand still
    this.cull = true;                        // (false: every zone in full view; the checks compare the pictures)
  }

  /** After a build (and when the quality changes): on or off, with the lights, trees and openings of this build. */
  setup(on) {
    const w = this.world, r = w.renderer;
    this.off();
    this.on = !!on;
    if (!this.on) return;
    // the lights: every point light of the scene leaves the frame (layers), the pool stands in for them
    this.candidates = [];
    w.scene.traverse((o) => { if (o.isPointLight && !o.userData.pad && !o.userData.mobilePool) this.candidates.push({ light: o, mask: o.layers.mask, zone: null }); });
    for (const c of this.candidates) c.light.layers.disableAll();
    this.pool = new THREE.Group(); this.pool.name = 'mobile-lights';
    this.slots = [];
    for (let i = 0; i < MOBILE_LIGHTS; i++) {
      const l = new THREE.PointLight(0x000000, 0, 1, 2); l.userData.mobilePool = true; l.position.set(0, -60, 0);
      this.pool.add(l); this.slots.push({ light: l, cand: null, w: 0 });
    }
    w.scene.add(this.pool);
    // the openings, as rectangles a little larger than the glass or the arch: to the garden (layout.openings) and the
    // two ends of the passage
    const glass = [], windows = [];
    for (const o of w.layout?.openings || []) {
      if (o.kind !== 'window' && o.kind !== 'glassfront') continue;
      const dir = Array.isArray(o.dir) ? o.dir : [0, 0, 1];
      const ax = dir[2], az = -dir[0], hw = o.w / 2 + 0.3, y0 = (o.y0 || 0) - 0.3, y1 = (o.y0 || 0) + o.h + 0.3;
      const quad = [[o.x - ax * hw, y0, o.z - az * hw], [o.x + ax * hw, y0, o.z + az * hw], [o.x + ax * hw, y1, o.z + az * hw], [o.x - ax * hw, y1, o.z - az * hw]].map((p) => new THREE.Vector3(...p));
      (zoneAt(o.z - 0.5) === HALLZ ? glass : windows).push(quad);
    }
    const aw = PASSAGE.w / 2 + 0.25, ah = PASSAGE.h + 0.25;
    this.portals = { glass, windows, archH: [quadOf(PASSAGE.x - aw, PASSAGE.x + aw, -0.25, ah, HALL.z0)], archR: [quadOf(PASSAGE.x - aw, PASSAGE.x + aw, -0.25, ah, ROOM.z1)] };
    // the things to leave out, each with its bounds and the zones they touch: the garden's parts (outside), the
    // furniture's placements, the batches and the shelves' parts (by where they stand)
    this.items = [];
    const add = (obj, garden = false) => {
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj, true);
      if (box.isEmpty()) return;
      const s = box.getBoundingSphere(new THREE.Sphere()); s.radius += 0.2;
      let zones = 0;
      if (garden) zones = 1 << OUT;
      else for (const z of [box.min.z - 0.2, s.center.z, box.max.z + 0.2]) zones |= 1 << zoneAt(z);
      if (!garden && (box.max.z > HOUSE.front)) zones |= 1 << OUT;
      this.items.push({ obj, sphere: s, zones });
    };
    const garden = w.env?.scenery;
    if (garden) for (const c of garden.children) if (!c.isBatchedMesh) add(c, true);
    for (const c of w.static.children) {
      if (c.userData.batch || c === w.shelfGroup) { for (const k of c.children) add(k); continue; }
      add(c);
    }
    // the trees: one sphere per tree (its near template's bounds in the tree's matrix), culled here
    this.trees = [];
    this.batches = new Set();
    for (const e of w.env?.garden?.lod?.trees || []) {
      const [bm, id, gid] = e.parts[0];
      bm.getMatrixAt(id, m4);
      bm.getBoundingSphereAt(gid[0], sphere);
      const s = sphere.clone().applyMatrix4(m4);
      for (const [b, , g] of e.parts) { const t = new THREE.Sphere(); b.getBoundingSphereAt(g[0], t); t.applyMatrix4(m4); if (t.radius > s.radius) s.copy(t); }
      this.trees.push({ parts: e.parts, sphere: s, shown: true });
      for (const [b] of e.parts) this.batches.add(b);
    }
    for (const b of this.batches) { b.userData.mobileCull = [b.perObjectFrustumCulled, b.sortObjects]; b.perObjectFrustumCulled = false; b.sortObjects = false; }
    // the furniture drawn by the batches (world.js #batchStatic) is hidden and never moves: three need not bring its
    // matrices up to date every frame (some four hundred of them); they stay as the batches were made
    w.static.updateMatrixWorld(true);
    w.static.traverse((o) => { if (o.userData.batched && o.matrixAutoUpdate) { o.matrixAutoUpdate = false; o.matrixWorldAutoUpdate = false; this.frozen.push(o); } });
    // fewer program switches: the opaque things by program, then as three sorts them
    const props = r.properties;
    const prog = (item) => props.get(item.material)?.currentProgram?.id ?? 0;
    r.setOpaqueSort((a, b) => (a.groupOrder - b.groupOrder) || (a.renderOrder - b.renderOrder) || (prog(a) - prog(b)) || (a.material.id - b.material.id) || (a.z - b.z) || (a.id - b.id));
    this.sorting = true;
  }

  /** Everything back as 'low' has it. */
  off() {
    const w = this.world;
    if (this.candidates) for (const c of this.candidates) c.light.layers.mask = c.mask;
    this.candidates = null;
    if (this.pool) { this.pool.removeFromParent(); for (const l of this.pool.children) l.dispose?.(); }
    this.pool = null; this.slots = null;
    for (const t of this.trees || []) if (!t.shown) for (const [b, id] of t.parts) b.setVisibleAt(id, true);
    for (const b of this.batches || []) { const k = b.userData.mobileCull; if (k) { b.perObjectFrustumCulled = k[0]; b.sortObjects = k[1]; delete b.userData.mobileCull; } }
    this.trees = null; this.batches = null; this.items = null; this.portals = null;
    for (const o of this.frozen) { o.matrixAutoUpdate = true; o.matrixWorldAutoUpdate = true; }
    this.frozen = [];
    if (this.sorting) { w.renderer.setOpaqueSort(null); this.sorting = false; }
    this.on = false;
  }

  /** Are the animals of the garden to be posed this frame (the garden was in view in the last one)? Out of view they
   *  live on without their poses (fauna.js, wildlife.js `posed`). */
  get posed() { return !this.on || this.stats.garden; }

  /** The number of point lights the shaders are built for, or null when the tier is off. */
  get lightCount() { return this.on ? MOBILE_LIGHTS : null; }

  /** The rectangle (normalised device coordinates) the openings of a list cover on the screen, null: none in view. */
  #cover(quads, cam) {
    let rect = null;
    const near = -(cam.near + 0.01);
    for (const quad of quads) {
      // the opening in the eye's space, cut at the near plane (the part behind the eye goes), then projected
      for (let i = 0; i < 4; i++) cam4[i].copy(quad[i]).applyMatrix4(cam.matrixWorldInverse);
      let n = 0;
      for (let i = 0; i < 4; i++) {
        const a = cam4[i], b = cam4[(i + 1) % 4], ina = a.z <= near, inb = b.z <= near;
        if (ina) clipped[n++].copy(a);
        if (ina !== inb) clipped[n++].lerpVectors(a, b, (near - a.z) / (b.z - a.z));
      }
      if (!n) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < n; i++) {
        v.copy(clipped[i]).applyMatrix4(cam.projectionMatrix);
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
      rect = join(rect, meet([x0, y0, x1, y1], FULL));
    }
    return rect;
  }

  /** Which part of the screen each zone can show from where the eye is (rects[zone], null: nothing). Near an
   *  opening's plane the eye counts as standing on both sides of it. */
  #zones(cam) {
    const P = this.portals, p = cam.position;
    const G = this.#cover(P.glass, cam), W = this.#cover(P.windows, cam), H = this.#cover(P.archH, cam), R = this.#cover(P.archR, cam);
    const from = (zone) => {
      const r = [null, null, null, null];
      if (zone === HALLZ) { r[HALLZ] = FULL; r[PASS] = H; r[ROOMZ] = meet(H, R); r[OUT] = join(G, meet(meet(H, R), W)); }
      else if (zone === PASS) { r[PASS] = FULL; r[HALLZ] = H; r[ROOMZ] = R; r[OUT] = join(meet(H, G), meet(R, W)); }
      else if (zone === ROOMZ) { r[ROOMZ] = FULL; r[PASS] = R; r[HALLZ] = meet(R, H); r[OUT] = join(W, meet(meet(R, H), G)); }
      else { r[OUT] = FULL; r[HALLZ] = G; r[PASS] = meet(G, H); r[ROOMZ] = join(W, meet(meet(G, H), R)); }
      return r;
    };
    const zones = new Set([zoneAt(p.z)]);
    const nearArch = Math.abs(p.x - PASSAGE.x) < PASSAGE.w / 2 + 1;
    if (Math.abs(p.z - HOUSE.front) < 0.8) { zones.add(OUT); zones.add(HALLZ); }
    if (nearArch && Math.abs(p.z - HALL.z0) < 0.8) { zones.add(HALLZ); zones.add(PASS); }
    if (nearArch && Math.abs(p.z - ROOM.z1) < 0.8) { zones.add(PASS); zones.add(ROOMZ); }
    // (outside the house's sides the windows of the book room look out: the garden is the zone there)
    if (p.x < ROOM.x0 - 0.5 || p.x > ROOM.x1 + 0.5) { zones.clear(); zones.add(OUT); }
    let rects = null;
    for (const z of zones) { const r = from(z); rects = rects ? rects.map((a, i) => join(a, r[i])) : r; }
    return rects;
  }

  /** Right before the frame is drawn: the lights of the pool, what each zone can show, the trees. */
  beforeRender(dt) {
    if (!this.on) return;
    const w = this.world, cam = w.camera;
    cam.updateMatrixWorld();
    this.viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.#lights(dt, cam.position);
    const rects = this.rects = this.cull ? this.#zones(cam) : [FULL, FULL, FULL, FULL];
    // a frustum per zone through its rectangle: the projection squeezed so that the rectangle fills the view
    for (let z = 0; z < 4; z++) {
      const rect = rects[z];
      if (!rect) continue;
      const sx = 2 / (rect[2] - rect[0]), sy = 2 / (rect[3] - rect[1]), tx = -(rect[0] + rect[2]) / (rect[2] - rect[0]), ty = -(rect[1] + rect[3]) / (rect[3] - rect[1]);
      m4.set(sx, 0, 0, tx, 0, sy, 0, ty, 0, 0, 1, 0, 0, 0, 0, 1).multiply(this.viewProj);
      this.frustums[z].setFromProjectionMatrix(m4, w.renderer.coordinateSystem);
    }
    this.stats.zones = rects.map((r) => (r ? (r === FULL || (r[0] === -1 && r[2] === 1 && r[1] === -1 && r[3] === 1) ? 'F' : 'P') : '-')).join('');
    const garden = !!rects[OUT];
    this.stats.garden = garden;
    if (!garden) for (const g of [w.env?.scenery, w.fauna?.group, w.wildlife?.group]) if (g && g.visible) { this.hidden.push([g, true]); g.visible = false; }
    // the things: shown when a zone they touch can show them there
    let hid = 0;
    for (const it of this.items) {
      const o = it.obj;
      if (!o.visible) continue;
      let show = false;
      for (let z = 0; z < 4 && !show; z++) if ((it.zones & (1 << z)) && rects[z] && this.frustums[z].intersectsSphere(it.sphere)) show = true;
      if (!show) { this.hidden.push([o, true]); o.visible = false; hid++; }
    }
    this.stats.hiddenObjects = hid; this.stats.objects = this.items.length;
    // the trees: in the garden's frustum or not (changed instances only: BatchedMesh rebuilds its lists then)
    let n = 0;
    if (garden) {
      const f = this.frustums[OUT];
      for (const t of this.trees) {
        const show = f.intersectsSphere(t.sphere);
        if (show) n++;
        if (show !== t.shown) { t.shown = show; for (const [b, id] of t.parts) b.setVisibleAt(id, show); }
      }
    }
    this.stats.treesShown = n;
    this.stats.trees = this.trees.length;
  }

  /** Right after the frame: what was left out comes back. */
  afterRender() {
    for (const [o, vis] of this.hidden) o.visible = vis;
    this.hidden.length = 0;
  }

  /** The pool: the MOBILE_LIGHTS lamps that matter most here (their light where the eye is, the same zone first),
   *  each fading in and out when it takes or leaves a place. */
  #lights(dt, eye) {
    const here = zoneAt(eye.z);
    for (const c of this.candidates) {
      c.light.getWorldPosition(c.pos ||= new THREE.Vector3());
      c.zone ??= zoneAt(c.pos.z);
      let on = c.light.visible; for (let p = c.light.parent; on && p; p = p.parent) if (!p.visible) on = false;
      const range = c.light.distance || 30, d = c.pos.distanceTo(eye);
      const reach = Math.max(0, 1 - d / (range + 3));
      c.score = on && c.light.intensity > 0 ? c.light.intensity * reach * reach * (c.zone === here ? 4 : 1) : 0;
    }
    const want = this.candidates.filter((c) => c.score > 0).sort((a, b) => b.score - a.score).slice(0, MOBILE_LIGHTS);
    const step = Math.min(1, (dt || 0.016) * FADE);
    for (const s of this.slots) {
      if (s.cand && !want.includes(s.cand)) { s.w -= step; if (s.w <= 0) { s.w = 0; s.cand = null; } }
      else if (s.cand) s.w = Math.min(1, s.w + step);
    }
    for (const c of want) {
      if (this.slots.some((s) => s.cand === c)) continue;
      const free = this.slots.find((s) => !s.cand);
      if (free) { free.cand = c; free.w = 0; }
    }
    for (const s of this.slots) {
      const l = s.light, c = s.cand;
      if (!c) { l.intensity = 0; continue; }
      l.position.copy(c.pos); l.color.copy(c.light.color); l.distance = c.light.distance; l.decay = c.light.decay;
      l.intensity = c.light.intensity * s.w;
    }
  }
}
