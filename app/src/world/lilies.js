// Water lilies (Nymphaea) on the lake: round pads with their narrow notch in loose clusters, some overlapping, some with
// a curled, red-brown rim, a few young reddish ones; between them pink blossoms with several rings of pointed, cupped
// petals round a yellow heart, some wide open, some half open, some still buds. They float on the water (a few
// millimetres above it, stacked where they overlap, so nothing fights with the surface), open in the morning and close
// at dusk (FLORA.uLilyOpen), and follow the season: young pads and buds in spring, full bloom in summer, yellowing pads
// and the last flowers in autumn, a few withered pads in winter and nothing under the ice. Two meshes (pads, blossoms)
// in the flora material (flora.js).
//
// Up to 0.6 the lilies were painted by the water's shader where a weight interpolated across the lake's triangles
// exceeded each cell's random number: a pad that straddled a line where that weight crossed its number was cut off
// along it (the straight edge of a pad by the reeds).
import * as THREE from 'three';
import { seeded } from './geo.js';
import { WATER_Y, terrainHeight, onJetty, JETTY } from './outdoor.js';
import { floraGeometry, floraMesh, FLORA } from './flora.js';

/** Where lilies grow: the bay by the east shore's trail, the calm north corner and a corner south of the jetty
 *  (ellipses: centre, radii, how many clusters). */
const BEDS = [
  { x: -13.8, z: 46.2, rx: 2.9, rz: 5.6, n: 17 },
  { x: -41.5, z: 59.4, rx: 6.2, rz: 2.1, n: 13 },
  { x: -31.4, z: 37.2, rx: 3.6, rz: 1.6, n: 8 },
];
const NOTCH = 0.11;                 // half the angle of the pad's notch (radians)

/** The pads: [{ x, z, y (the top), r, rot, level, curl, young, rank, flowerAt? }] and the blossoms. Deterministic. */
function layout() {
  const rnd = seeded(5150), pads = [], flowers = [];
  const depth = (x, z) => WATER_Y - terrainHeight(x, z);
  const nearJetty = (x, z, d) => { const J = JETTY; for (let s = 0; s <= J.len; s += 0.5) { const [jx, jz] = J.at(s, 0); if (Math.hypot(jx - x, jz - z) < d + (s > J.len - J.platLen ? J.platWidth / 2 : J.width / 2)) return true; } return false; };
  for (const bed of BEDS) {
    const centres = [];
    for (let i = 0; i < 400 && centres.length < bed.n; i++) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd());
      const x = bed.x + Math.cos(a) * bed.rx * rr, z = bed.z + Math.sin(a) * bed.rz * rr;
      if (depth(x, z) < 0.32 || onJetty(x, z) || nearJetty(x, z, 1.6)) continue;
      if (centres.some((c) => Math.hypot(c[0] - x, c[1] - z) < 1.15)) continue;
      centres.push([x, z]);
    }
    for (const [cx, cz] of centres) {
      const n = 4 + Math.floor(rnd() * 6), cluster = [];
      for (let k = 0, tries = 0; k < n && tries < 40; tries++) {
        const a = rnd() * Math.PI * 2, d = k === 0 ? 0 : 0.18 + rnd() * 0.5;
        const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, r = 0.12 + Math.pow(rnd(), 1.4) * 0.17;
        if (depth(x, z) < 0.25 || nearJetty(x, z, r + 0.4)) continue;
        // loosely together: a pad may lie over a third of its neighbour, no more
        if (pads.some((p) => Math.hypot(p.x - x, p.z - z) < 0.66 * (p.r + r))) continue;
        // it floats over the pads it overlaps (a level of 4.5 mm each)
        let level = 0;
        for (const p of pads) if (Math.hypot(p.x - x, p.z - z) < p.r + r) level = Math.max(level, p.level + 1);
        const young = rnd() < 0.16 && r < 0.17 ? 0.55 + rnd() * 0.45 : 0;
        const pad = { x, z, r, rot: rnd() * Math.PI * 2, level, y: WATER_Y + 0.006 + level * 0.0045, curl: rnd() < 0.28 ? 0.05 + rnd() * 0.11 : rnd() * 0.02, young, seed: rnd(), rank: rnd() };
        pads.push(pad); cluster.push(pad); k++;
      }
      // a blossom beside one of the pads that stay all season (rank < 0.5), about one for every four pads
      for (const pad of cluster) {
        if (pad.rank > 0.5 || rnd() > 0.6) continue;
        const a = rnd() * Math.PI * 2, d = pad.r * (0.55 + rnd() * 0.5);
        const x = pad.x + Math.cos(a) * d, z = pad.z + Math.sin(a) * d;
        if (depth(x, z) < 0.2) continue;
        const kind = rnd(), open = kind < 0.22 ? 0 : kind < 0.45 ? 0.5 + rnd() * 0.25 : 0.88 + rnd() * 0.12;
        flowers.push({ x, z, y: pad.y + 0.004, rot: rnd() * Math.PI * 2, open, hue: rnd(), scale: 1.25 + rnd() * 0.45, seed: rnd(), rank: rnd(), pad });
      }
    }
  }
  return { pads, flowers };
}

/** A pad: radius 1, the notch along +x, the top at y 0 (the shader waves and curls the rim). */
function padGeometry(count) {
  const pos = [], nor = [], uv = [], part = [], idx = [];
  const rings = [0.2, 0.42, 0.63, 0.81, 0.93, 1.0], NA = 28;
  const vert = (r, a) => { pos.push(r * Math.cos(a), 0, r * Math.sin(a)); nor.push(0, 1, 0); uv.push(r, a / (Math.PI * 2)); part.push(0, a, r, 0); return pos.length / 3 - 1; };
  const centre = vert(0, Math.PI);
  const grid = rings.map((r) => Array.from({ length: NA + 1 }, (_, i) => vert(r, NOTCH + (i / NA) * (Math.PI * 2 - 2 * NOTCH))));
  for (let i = 0; i < NA; i++) idx.push(centre, grid[0][i + 1], grid[0][i]);
  for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < NA; i++) {
    const a = grid[k][i], b = grid[k][i + 1], c = grid[k + 1][i], d = grid[k + 1][i + 1];
    idx.push(a, b, c, b, d, c);
  }
  return floraGeometry({ pos, nor, uv, part, idx }, count);
}

/** A blossom: four sepals and three rings of eight petals (the shader opens and closes them), thirty stamens and the
 *  yellow disc in the middle. */
function flowerGeometry(count) {
  const pos = [], nor = [], uv = [], part = [], idx = [], rnd = seeded(77);
  const T = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
  const petal = (kind, ring, phi) => {
    const r = rnd(), base = pos.length / 3, S = kind === 2 ? [-1, 1] : [-1, 0, 1], TT = kind === 2 ? [0, 0.5, 1] : T;
    for (const t of TT) for (const s of S) { pos.push(Math.cos(phi) * t * 0.06, t * 0.03, Math.sin(phi) * t * 0.06); nor.push(0, 1, 0); uv.push(t, s); part.push(kind, phi, ring, r); }
    const w = S.length;
    for (let i = 0; i < TT.length - 1; i++) for (let j = 0; j < w - 1; j++) {
      const a = base + i * w + j, b = a + 1, c = a + w, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  };
  for (let k = 0; k < 4; k++) petal(1, 0, k * Math.PI / 2 + 0.79);
  for (const [ring, off] of [[1, 0.2], [2, 0.6], [3, 0.0]]) for (let k = 0; k < 8; k++) petal(1, ring, k * Math.PI / 4 + off + (rnd() - 0.5) * 0.12);
  for (let k = 0; k < 30; k++) petal(2, 0, rnd() * Math.PI * 2);
  // the disc: uv (angle fraction, radius)
  const c0 = pos.length / 3; pos.push(0, 0.014, 0); nor.push(0, 1, 0); uv.push(0, 0); part.push(3, 0, 0, 0);
  for (let i = 0; i <= 12; i++) { const f = i / 12; pos.push(Math.cos(f * 6.283) * 0.009, 0.014, Math.sin(f * 6.283) * 0.009); nor.push(0, 1, 0); uv.push(f, 1); part.push(3, 0, 0, 0); }
  for (let i = 0; i < 12; i++) idx.push(c0, c0 + 2 + i, c0 + 1 + i);
  const g = floraGeometry({ pos, nor, uv, part, idx }, count);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.03, 0), 0.11);
  return g;
}

/** What each season shows: the share of the pads, their size, the blossoms, buds only, the young red pads. */
const LOOK = {
  spring: { pads: 0.6, size: 0.72, flowers: 0.35, buds: true, young: 0.85, autumn: 0 },
  summer: { pads: 1, size: 1, flowers: 1, buds: false, young: 0, autumn: 0 },
  autumn: { pads: 0.85, size: 1, flowers: 0.3, buds: false, young: 0, autumn: 0.75 },
  winter: { pads: 0.16, size: 0.82, flowers: 0, buds: false, young: 0, autumn: 1 },
};

/** The lilies: { group, pads, flowers, lilyPads, setSeason(name, frozen), update(dt), settle(), setOpen(target) }.
 *  `lilyPads`: the pads as they are drawn now, [{ x, z, y (the top), r (the radius in m) }] in world coordinates, for
 *  the frogs that sit on them (garden.lilyPads); one array, refilled when the season changes, each pad's entry the same
 *  object all along. */
export function makeLilies() {
  const { pads, flowers } = layout();
  pads.sort((a, b) => a.rank - b.rank); flowers.sort((a, b) => a.rank - b.rank);
  const padMesh = floraMesh(padGeometry(pads.length), pads.length, 'lily-pads');
  const flowerMesh = floraMesh(flowerGeometry(flowers.length), flowers.length, 'lily-flowers');
  const group = new THREE.Group(); group.name = 'lilies';
  group.add(padMesh, flowerMesh);
  // after the ground and the stones, before the water (renderOrder 4 is transparent: drawn after them anyway)
  padMesh.renderOrder = flowerMesh.renderOrder = 12;
  const lilyPads = [];
  for (const p of pads) p.spot = { x: p.x, z: p.z, y: p.y, r: p.r };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  let look = null, target = 1;
  /** Write the instances for a season ('frozen': the lake under ice, nothing shows). */
  const setSeason = (season, frozen = false) => {
    look = LOOK[season] || LOOK.summer;
    const nPads = frozen ? 0 : Math.round(pads.length * look.pads), padI = padMesh.geometry.attributes.aInst;
    pads.forEach((p, i) => {
      p.shown = i < nPads;
      const s = p.r * look.size * (p.young && look.young ? 0.85 : 1);
      p.spot.r = s;
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromAxisAngle(UP, p.rot), new THREE.Vector3(s, s, s));
      padMesh.setMatrixAt(i, m);
      padI.setXYZW(i, p.curl * (season === 'winter' ? 1.6 : 1), Math.max(p.young ? p.young * look.young : 0, season === 'spring' ? 0.25 : 0), p.seed, 0);
      padMesh.setColorAt(i, c.setScalar(0.88 + p.seed * 0.24));
    });
    padMesh.count = nPads;
    lilyPads.length = 0;
    for (let i = 0; i < nPads; i++) lilyPads.push(pads[i].spot);
    // the blossoms on the pads that show (every blossom belongs to one with rank < 0.5)
    const nFlowers = frozen ? 0 : Math.round(flowers.length * look.flowers), flI = flowerMesh.geometry.attributes.aInst;
    flowers.forEach((f, i) => {
      const s = f.scale * (look.buds ? 0.8 : 1);
      m.compose(new THREE.Vector3(f.x, f.y, f.z), q.setFromAxisAngle(UP, f.rot), new THREE.Vector3(s, s, s));
      flowerMesh.setMatrixAt(i, m);
      flI.setXYZW(i, look.buds ? 0 : f.open, f.hue, f.seed, 0);
      flowerMesh.setColorAt(i, c.setScalar(1));
    });
    flowerMesh.count = nFlowers;
    FLORA.uPadAutumn.value = look.autumn;
    for (const mesh of [padMesh, flowerMesh]) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; mesh.geometry.attributes.aInst.needsUpdate = true; mesh.computeBoundingSphere(); }
  };
  setSeason('summer');
  return {
    group, pads, flowers, lilyPads, meshes: [padMesh, flowerMesh],
    uniforms: FLORA,   // (the checks: uLilyOpen, uPadAutumn)
    setSeason,
    /** How far the blossoms open: 1 by day, 0 at night (they follow over some seconds). */
    setOpen(t) { target = t; },
    settle() { FLORA.uLilyOpen.value = target; },
    update(dt) { const u = FLORA.uLilyOpen; u.value += Math.sign(target - u.value) * Math.min(Math.abs(target - u.value), dt * 0.25); },
  };
}
