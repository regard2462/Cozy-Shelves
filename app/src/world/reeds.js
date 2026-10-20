// Reeds and cattails along parts of the lake's shore, mostly standing in the shallow water: clumps of common reed
// (Phragmites) whose round stems carry long narrow leaves, one side and then the other, that rise and bend over, and a
// feathery brownish plume at the top; between them patches of cattail (Typha) with long strap leaves and brown cobs on
// their stalks. Every clump is an instance (flora.js material) of one of two reed and two cattail clumps, turned,
// scaled and tinted. They bend with the wind of the weather in the shader, their leaves and plumes flutter. Near the eye
// a clump has all its leaves; between 15 and 24 m they draw back into the stem (aPivot), and from 25 m on it is drawn
// from the far reed without leaves and with fewer plume branches: the same picture with a third of the triangles. Six
// instanced meshes in all, whatever the eye sees (few draw calls). The colours follow the season (seasons.js: FLORA).
import * as THREE from 'three';
import { seeded, clamp } from './geo.js';
import { WATER_Y, LAKE, terrainHeight, shorePoint, beachWeight, onJetty, pathDist, trailDist, JETTY } from './outdoor.js';
import { floraMaterial } from './flora.js';

const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** Where the reeds grow along the shore (0 … 1 by the direction from the lake's middle): in clumps, never on the beach. */
export function reedBand(a) {
  const n = 0.5 + 0.28 * Math.sin(3 * a + 1.3) + 0.2 * Math.sin(7 * a + 0.4) + 0.14 * Math.sin(13 * a + 2.2) + 0.08 * Math.sin(29 * a + 5.1);
  return smooth(0.58, 0.8, n);
}
/** How much reed bed a point of the shore is (the ground shows dark mud there; garden.js). */
export function reedBed(x, z) {
  const above = terrainHeight(x, z) - WATER_Y;
  if (above > 0.5 || above < -0.7) return 0;
  const a = Math.atan2((z - LAKE.z) / LAKE.rz, (x - LAKE.x) / LAKE.rx);
  return reedBand(a) * (1 - smooth(0.15, 0.5, above)) * (1 - smooth(0.4, 0.7, -above)) * (1 - beachWeight(x, z));
}

// ---------------------------------------------------------------- geometry ------------------------------------------
/** Collects flora vertices (flora.js) with aPivot, the point a part draws back to beyond the near band. */
class Collect {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.part = []; this.piv = []; this.idx = []; }
  get n() { return this.pos.length / 3; }
  v(p, nrm, u, v, part, pivot) { this.pos.push(p.x, p.y, p.z); this.nor.push(nrm.x, nrm.y, nrm.z); this.uv.push(u, v); this.part.push(...part); this.piv.push(pivot.x, pivot.y, pivot.z); return this.n - 1; }
  /** A strip along `pts` (centre line) with half widths `w`, facing `side` across: rows of two vertices. */
  strip(pts, w, side, kind, H, flutter, rnd, pivot, uvAlong = true) {
    const base = this.n;
    pts.forEach((p, i) => {
      const t = i / (pts.length - 1), dir = pts[Math.min(pts.length - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize();
      const nrm = new THREE.Vector3().crossVectors(side, dir).normalize();
      // (normals tipped up a little: thin leaves read lit from above, like the lawn's blades)
      nrm.y = Math.abs(nrm.y) * 0.6 + 0.4; nrm.normalize();
      for (const s of [-1, 1]) this.v(p.clone().addScaledVector(side, s * w[i]), nrm, uvAlong ? t : 0.5, s * 0.5 + 0.5, [kind, clamp(p.y / H, 0, 1), flutter, rnd], pivot);
    });
    for (let i = 0; i < pts.length - 1; i++) { const a = base + i * 2; this.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  /** A thin round stem: a three-sided tube along `pts` with radii `r`. */
  tube(pts, r, kind, H, rnd, sides = 3) {
    const base = this.n;
    pts.forEach((p, i) => {
      const dir = pts[Math.min(pts.length - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize();
      const a1 = new THREE.Vector3(1, 0, 0).addScaledVector(dir, -dir.x).normalize(), a2 = new THREE.Vector3().crossVectors(dir, a1);
      for (let k = 0; k < sides; k++) {
        const ang = (k / sides) * Math.PI * 2, nrm = a1.clone().multiplyScalar(Math.cos(ang)).addScaledVector(a2, Math.sin(ang));
        this.v(p.clone().addScaledVector(nrm, r[i]), nrm, i / (pts.length - 1), k / sides, [kind, clamp(p.y / H, 0, 1), 0, rnd], p);
      }
    });
    for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < sides; k++) {
      const a = base + i * sides + k, b = base + i * sides + (k + 1) % sides, c = a + sides, d = b + sides;
      this.idx.push(a, c, b, b, c, d);
    }
  }
  geometry(radius, height) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 4));
    g.setAttribute('aPivot', new THREE.Float32BufferAttribute(this.piv, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    // the bounds with the sway of the tops in a storm (flora.js: 0.55 m per unit of wind)
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height / 2, 0), Math.hypot(radius + 0.75, height / 2) + 0.2);
    return g;
  }
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
/** A curve from `p` in direction `d` (unit), `n` steps of `len / n`, the direction bending by `bend` per step. */
function curve(p, d, len, n, bend) { const pts = [p.clone()], dir = d.clone(); for (let i = 0; i < n; i++) { dir.add(bend).normalize(); pts.push(pts[i].clone().addScaledVector(dir, len / n)); } return pts; }

/** The heights the clumps are built at (m); an instance scales them evenly (the shader's sway needs an even scale). */
const REED_H = 2.3, CATTAIL_H = 1.6;
/**
 * A clump of common reed: 10 to 15 stems (1.65 to 2.6 m before the instance's scale), each with leaves on alternating
 * sides and a drooping plume. near: every leaf and seven plume branches; far: no leaves, three branches.
 */
function reedClump(seed, far) {
  const rnd = seeded(seed), c = new Collect(), H = REED_H;
  const n = 14 + Math.floor(rnd() * 6);
  for (let k = 0; k < n; k++) {
    const sr = rnd(), a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 0.36, h = H * (0.68 + rnd() * 0.46);
    const base = V(Math.cos(a) * d, 0, Math.sin(a) * d);
    const lean = V((rnd() - 0.5) * 0.14 + Math.cos(a) * 0.05, 1, (rnd() - 0.5) * 0.14 + Math.sin(a) * 0.05).normalize();
    const stem = curve(base, lean, h, 4, V((rnd() - 0.5) * 0.03, 0, (rnd() - 0.5) * 0.03));
    c.tube(stem, stem.map((_, i) => 0.0042 * (1 - i / 7)), 4, H, sr);
    const top = stem[stem.length - 1];
    // leaves: on alternating sides from a quarter of the height up, rising and bending over, the upper ones shorter
    const nl = 5 + Math.floor(rnd() * 2); let side = rnd() * Math.PI * 2;
    if (!far) for (let l = 0; l < nl; l++) {
      const f = 0.22 + (l / nl) * 0.62, at = stem[Math.round(f * (stem.length - 1))].clone();
      side += Math.PI + (rnd() - 0.5) * 0.6;
      const out = V(Math.cos(side), 0, Math.sin(side)), len = h * (0.24 + rnd() * 0.16) * (1.1 - f * 0.5);
      const pts = curve(at, out.clone().multiplyScalar(0.62).add(V(0, 0.78, 0)).normalize(), len, 4, V(0, -0.25 - rnd() * 0.15, 0).addScaledVector(out, 0.075));
      const across = V(-out.z, 0, out.x).normalize();
      c.strip(pts, pts.map((_, i) => 0.0085 * Math.sin(Math.PI * Math.min(1, (i + 0.6) / pts.length)) * (1 - i / (pts.length + 1))), across, 5, H, 0.9 + 2, sr, at);
    }
    // the plume: drooping branches from the top of the stem (purplish brown in summer, silvery in autumn)
    // (they all lean a little the same way, as the wind has set them)
    for (let b = 0; b < 7; b++) {
      const keep = b < 3;
      if (far && !keep) continue;
      const ba = (b / 7) * Math.PI * 2 + sr * 6, out = V(Math.cos(ba) + 0.5, 0, Math.sin(ba) + 0.2).normalize();
      const pts = curve(top.clone().add(V(0, -0.03 * b, 0)), out.clone().multiplyScalar(0.4).add(V(0, 0.9, 0)).normalize(), 0.16 + rnd() * 0.1, 2, V(0, -0.45, 0).addScaledVector(out, 0.14));
      c.strip(pts, pts.map((_, i) => 0.0075 * (1 - i / pts.length * 0.4)), V(-out.z, 0, out.x), 6, H, (keep ? 0.7 : 0.7 + 2), sr, top);
    }
  }
  return c.geometry(0.32, H * 1.2);
}
/** A clump of cattail: ten or so strap leaves from the foot, slightly twisted, and two or three stalks with a cob. */
function cattailClump(seed) {
  const rnd = seeded(seed), c = new Collect(), H = CATTAIL_H;
  const n = 20 + Math.floor(rnd() * 8);
  for (let k = 0; k < n; k++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 0.22, h = H * (0.55 + rnd() * 0.45), sr = rnd();
    const base = V(Math.cos(a) * d, 0, Math.sin(a) * d), out = V(Math.cos(a), 0, Math.sin(a));
    const pts = curve(base, out.clone().multiplyScalar(0.12).add(V(0, 1, 0)).normalize(), h, 6, V(0, -0.035, 0).addScaledVector(out, 0.025));
    // a strap leaf, turning a little round its length
    const tw = (rnd() - 0.5) * 1.2;
    const across = (i) => { const ang = a + Math.PI / 2 + tw * i / 6; return V(Math.cos(ang), 0, Math.sin(ang)); };
    const base0 = c.n;
    c.strip(pts, pts.map((_, i) => 0.013 * (1 - Math.pow(i / pts.length, 2.2))), across(0), 7, H, 0.35, sr, base);
    // (the twist: turn each row's two vertices round the centre line)
    for (let i = 0; i < pts.length; i++) for (const s of [0, 1]) {
      const vi = base0 + i * 2 + s, dir = across(i), w = 0.013 * (1 - Math.pow(i / pts.length, 2.2)) * (s ? 1 : -1);
      c.pos[vi * 3] = pts[i].x + dir.x * w; c.pos[vi * 3 + 2] = pts[i].z + dir.z * w;
    }
  }
  const stalks = 3 + Math.floor(rnd() * 3);
  for (let k = 0; k < stalks; k++) {
    const a = rnd() * Math.PI * 2, d = rnd() * 0.08, h = H * (0.85 + rnd() * 0.2), sr = rnd();
    const base = V(Math.cos(a) * d, 0, Math.sin(a) * d), lean = V((rnd() - 0.5) * 0.08, 1, (rnd() - 0.5) * 0.08).normalize();
    const stem = curve(base, lean, h, 5, V(0, 0, 0));
    c.tube(stem, stem.map(() => 0.0045), 4, H, sr);
    // the cob: a brown cylinder round the upper stalk, the thin spike above it
    const top = stem[stem.length - 1], cobFrom = top.clone().addScaledVector(lean, -0.2), cobTo = top.clone().addScaledVector(lean, -0.03);
    c.tube([cobFrom, cobFrom.clone().lerp(cobTo, 0.15), cobFrom.clone().lerp(cobTo, 0.85), cobTo], [0.007, 0.0145, 0.0145, 0.008], 8, H, sr, 6);
    c.tube([cobTo, top.clone().addScaledVector(lean, 0.13)], [0.0035, 0.0012], 9, H, sr, 3);
  }
  return c.geometry(0.2, H * 1.15);
}

// ---------------------------------------------------------------- placement -------------------------------------------
/** The clumps: [{ x, z, kind: 'reed' | 'cattail', variant, h (height in m), rot, tint }]. Deterministic. Lily pads
 *  (lilies.js) keep the reeds off. */
function placeClumps(pads) {
  const rnd = seeded(733), out = [], grid = new Map(), key = (x, z) => Math.floor(x / 0.6) + ':' + Math.floor(z / 0.6);
  const crowded = (x, z, r) => { const i = Math.floor(x / 0.6), j = Math.floor(z / 0.6); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const c of grid.get((i + a) + ':' + (j + b)) || []) if (Math.hypot(c.x - x, c.z - z) < r) return true; return false; };
  for (let a = -Math.PI; a < Math.PI; a += 0.0045) {
    const w = reedBand(a);
    if (w < 0.05 || rnd() > w * 0.9) continue;
    const [sx, sz] = shorePoint(a, 0), dx = sx - LAKE.x, dz = sz - LAKE.z, l = Math.hypot(dx, dz);
    // cattails in calmer patches of the band
    const cat = Math.sin(a * 5.3 + 1.1) * Math.sin(a * 2.1 + 0.4) > 0.42;
    for (let k = 0, n = 1 + Math.floor(rnd() * 3); k < n; k++) {
      const off = -2.0 + rnd() * 2.4, x = sx + dx / l * off + (rnd() - 0.5) * 0.4, z = sz + dz / l * off + (rnd() - 0.5) * 0.4;
      const depth = WATER_Y - terrainHeight(x, z);
      if (depth < -0.1 || depth > (cat ? 0.42 : 0.6) || beachWeight(x, z) > 0.05 || onJetty(x, z) || trailDist(x, z) < 1.1 || pathDist(x, z) < 1.4) continue;
      if (Math.hypot(x - JETTY.root[0] - JETTY.dir[0] * 4, z - JETTY.root[1] - JETTY.dir[1] * 4) < 5) continue;
      if (pads.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 0.45)) continue;
      if (crowded(x, z, cat ? 0.42 : 0.36)) continue;
      // taller where it stands in the water, the reed belt lower towards the land
      const h = cat ? 1.25 + rnd() * 0.55 + Math.max(0, depth) * 0.5 : 1.9 + rnd() * 0.9 + Math.max(0, depth) * 1.2 - Math.max(0, -depth) * 3;
      const c = { x, z, y: terrainHeight(x, z), kind: cat ? 'cattail' : 'reed', variant: Math.floor(rnd() * 2), h, rot: rnd() * Math.PI * 2, tint: 0.86 + rnd() * 0.28 };
      out.push(c);
      const kk = key(x, z); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(c);
    }
  }
  return out;
}

/**
 * The reeds: { group, clumps, meshes ({ mesh } each), update(camera), setQuality(q) }. `pads`: the lily pads (they keep
 * the reeds off). One instanced mesh per kind and variant and one more for each reed variant's far clumps: update()
 * hands every clump to its near or its far mesh by the distance (from 25 m on, where the shader has drawn every leaf
 * back, both look the same) and leaves out those beyond 95 m.
 */
export function makeReeds(pads = []) {
  const clumps = placeClumps(pads);
  const mat = floraMaterial();
  const geos = { reed: [0, 1].map((v) => ({ near: reedClump(91 + v * 7, false), far: reedClump(91 + v * 7, true) })), cattail: [0, 1].map((v) => { const g = cattailClump(301 + v * 13); return { near: g, far: g }; }) };
  // every clump the same per-instance data (aInst: none needed): one zero buffer shared by every geometry
  const most = 512, zero = new THREE.InstancedBufferAttribute(new Float32Array(most * 4), 4);
  for (const list of Object.values(geos)) for (const g of list) for (const x of [g.near, g.far]) x.setAttribute('aInst', zero);
  const group = new THREE.Group(); group.name = 'reeds';
  const meshes = [];
  const make = (geo, n) => {
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0; mesh.visible = false;
    mesh.castShadow = false; mesh.receiveShadow = true; mesh.userData.noAO = true; mesh.name = 'reeds'; mesh.renderOrder = 12;
    group.add(mesh); meshes.push({ mesh });
    return mesh;
  };
  // per kind and variant: its clumps, their matrices and tints, and how each is drawn now (0 not, 1 near, 2 far)
  const sets = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), at = new THREE.Vector3(), size = new THREE.Vector3();
  for (const kind of ['reed', 'cattail']) for (const variant of [0, 1]) {
    const list = clumps.filter((c) => c.kind === kind && c.variant === variant).slice(0, most);
    if (!list.length) continue;
    const geo = geos[kind][variant], s = { list, mats: new Float32Array(list.length * 16), tints: new Float32Array(list.length * 3), state: new Int8Array(list.length).fill(-1) };
    list.forEach((c, i) => {
      m.compose(at.set(c.x, c.y - 0.04, c.z), q.setFromAxisAngle(UP, c.rot), size.setScalar(c.h / (kind === 'reed' ? REED_H : CATTAIL_H))).toArray(s.mats, i * 16);
      s.tints.fill(c.tint, i * 3, i * 3 + 3);
    });
    s.near = make(geo.near, list.length); s.far = geo.far !== geo.near ? make(geo.far, list.length) : null;
    sets.push(s);
  }
  const fill = (mesh, s, which) => {
    const M = mesh.instanceMatrix.array, C = mesh.instanceColor.array;
    let n = 0;
    for (let i = 0; i < s.list.length; i++) if (s.state[i] === which) { M.set(s.mats.subarray(i * 16, i * 16 + 16), n * 16); C.set(s.tints.subarray(i * 3, i * 3 + 3), n * 3); n++; }
    mesh.count = n; mesh.visible = n > 0;
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    if (n) mesh.computeBoundingSphere();
  };
  let share = 1;
  return {
    group, clumps, meshes,
    update(camera) {
      const cx = camera.position.x, cz = camera.position.z;
      for (const s of sets) {
        let changed = false;
        for (let i = 0; i < s.list.length; i++) {
          const c = s.list[i], d = Math.hypot(c.x - cx, c.z - cz), was = s.state[i];
          // (half a metre between the two ways, so that a clump does not swap back and forth)
          const now = (share < 1 && i % 2) || d > 95 ? 0 : s.far && d > (was === 1 ? 25.5 : 25) ? 2 : 1;
          if (now !== was) { s.state[i] = now; changed = true; }
        }
        if (!changed) continue;
        fill(s.near, s, 1);
        if (s.far) fill(s.far, s, 2);
      }
    },
    /** 'low': every second clump. */
    setQuality(q) { share = q === 'low' ? 0.5 : 1; },
  };
}
