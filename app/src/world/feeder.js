// The feeding station on the meadow (outdoor.js FEEDER holds where it stands and what is in the way): a hay rack of
// round bars in a V on four posts, a trough under it that catches what falls through, a gable roof of wooden shingles,
// hay in the rack, in the trough and some on the ground; beside it a salt lick, a salt block on a post that the licking
// has stained dark. Some 16 m away a small hide, an open-fronted shelter of weathered boards with a bench, from which
// you watch the deer at the rack (layout.js places both, world.js builds them; the deer come in wildlife.js).
// Everything is merged per material and uses the garden's materials and programs (nature.js 'plain'): no new shader.
import * as THREE from 'three';
import { Parts, boxGeo, boxGeoUV, cylGeo, rboxGeo, seeded } from './geo.js';
import { natureMaterial, weatheredWood } from './nature.js';
import { plankTexture } from './textures.js';
import { FEEDER } from './outdoor.js';

// ---------------------------------------------------------------- materials (built once, never disposed) -------------
let mats = null;
function materials() {
  if (mats) return mats;
  const planks = plankTexture({ tone: 'oak' });
  const shingles = shingleTexture();
  mats = {
    wood: weatheredWood(),
    // the bars of the rack and the upper post of the salt lick: darker, stained by the deer and by the salt
    dark: natureMaterial('plain', { map: planks.map, normalMap: planks.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), color: 0x6e665b, roughness: 0.86, fog: false }, { puddles: 0.4 }),
    roof: natureMaterial('plain', { map: shingles.map, normalMap: shingles.normalMap, normalScale: new THREE.Vector2(1, 1), color: 0xffffff, roughness: 0.92, fog: false }, { puddles: 0.2 }),
    hay: natureMaterial('plain', { map: hayTexture(), color: 0xffffff, roughness: 0.95, fog: false }),
    salt: natureMaterial('plain', { color: 0xe3d9d3, roughness: 0.55, metalness: 0, fog: false }),
  };
  for (const m of Object.values(mats)) m.userData.feeder = true;
  return mats;
}

/** Straw: thin strands in many yellows and browns, mostly along v, on a darker ground. Tileable. */
function hayTexture() {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), rnd = seeded(303);
  g.fillStyle = '#7c6a3e'; g.fillRect(0, 0, N, N);
  const cols = ['#d8c27c', '#c9b066', '#e6d496', '#b39652', '#a88c4c', '#efe0a8', '#94793f'];
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * N, y = rnd() * N, l = 10 + rnd() * 34, a = Math.PI / 2 + (rnd() - 0.5) * 1.1;
    g.strokeStyle = cols[Math.floor(rnd() * cols.length)]; g.globalAlpha = 0.55 + rnd() * 0.45; g.lineWidth = 0.8 + rnd() * 1.6;
    const dx = Math.cos(a) * l, dy = Math.sin(a) * l;
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + dx, y + oy + dy); g.stroke(); }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

/** Wooden shingles in staggered rows (1 m of roof per tile), weathered grey-brown, and their relief. */
function shingleTexture() {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), rnd = seeded(77);
  const hgt = new Float32Array(N * N);
  const rows = 8, rh = N / rows;
  const img = g.createImageData(N, N), d = img.data;
  for (let r = 0; r < rows; r++) {
    // each row: shingles of uneven width, their lower edge lies over the row below
    let x = r % 2 ? -rnd() * 20 : 0;
    while (x < N) {
      const w = 18 + rnd() * 22, tone = 0.72 + rnd() * 0.36, warm = rnd() * 0.12;
      for (let yy = 0; yy < rh; yy++) for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(N, Math.floor(x + w)); xx++) {
        const y = r * rh + yy, i = y * N + xx, edge = Math.min(xx - x, x + w - xx);
        const grain = 0.88 + 0.12 * Math.sin(xx * 0.9 + rnd() * 0.6 + r * 7) * Math.sin(yy * 0.13 + xx * 0.05);
        // darker towards the lower edge of each shingle (its shadow on the row below) and at the gaps between them
        const shade = (0.62 + 0.38 * (yy / rh)) * (edge < 1.2 ? 0.55 : 1);
        const v = tone * grain * shade;
        d[i * 4] = 104 * v * (1 + warm); d[i * 4 + 1] = 96 * v; d[i * 4 + 2] = 86 * v * (1 - warm); d[i * 4 + 3] = 255;
        hgt[i] = (yy / rh) * 0.8 + (edge < 1.2 ? -0.4 : 0) + grain * 0.1;
      }
      x += w + 1;
    }
  }
  g.putImageData(img, 0, 0);
  // the relief: from the height (the rows read as overlapping boards)
  const nc = document.createElement('canvas'); nc.width = nc.height = N;
  const ng = nc.getContext('2d'), ni = ng.createImageData(N, N), nd = ni.data;
  const H = (x, y) => hgt[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * 2.2, dy = (H(x, y + 1) - H(x, y - 1)) * 2.2;
    const l = Math.hypot(dx, dy, 1), i = (y * N + x) * 4;
    nd[i] = (-dx / l * 0.5 + 0.5) * 255; nd[i + 1] = (dy / l * 0.5 + 0.5) * 255; nd[i + 2] = (1 / l * 0.5 + 0.5) * 255; nd[i + 3] = 255;
  }
  ng.putImageData(ni, 0, 0);
  const map = new THREE.CanvasTexture(c), normalMap = new THREE.CanvasTexture(nc);
  map.colorSpace = THREE.SRGBColorSpace; normalMap.colorSpace = THREE.NoColorSpace;
  for (const t of [map, normalMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  return { map, normalMap };
}

// ---------------------------------------------------------------- helpers ---------------------------------------
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
/** A round bar from a to b. */
function bar(p, mat, a, b, r, seg = 7) {
  const d = b.clone().sub(a), len = d.length();
  p.addMatrix(cylGeo(r, r, len, seg), mat, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), V(1, 1, 1)));
}
/** A board (box with metre UVs, 1.45 m per texture tile: the plank texture's boards) at `pos`, turned by `rot`. */
function board(p, mat, w, h, d, pos, rot = [0, 0, 0]) { p.add(boxGeoUV(w, h, d, 1.45), mat, pos, rot); }
/** A slanted panel from edge a to edge b (both lines along x, `w` long), `t` thick, lying on the line a–b: a roof's
 *  plane, a fascia. */
function slab(p, mat, w, t, a, b) {
  const d = b.clone().sub(a), len = d.length(), mid = a.clone().add(b).multiplyScalar(0.5);
  // local z along a → b, x along the span, y their normal: upwards (or outwards) without mirroring the box
  const zA = d.clone().normalize(), xA = V(1, 0, 0);
  let yA = V().crossVectors(zA, xA);
  if (yA.y < -1e-6) { xA.set(-1, 0, 0); yA = V().crossVectors(zA, xA); }
  const m = new THREE.Matrix4().makeBasis(xA, yA, zA).setPosition(mid.addScaledVector(yA, t / 2));
  p.addMatrix(boxGeoUV(w, t, len, 1.0), mat, m);
}
/** The hay in the rack: a prism along x filling the V up to a mounded top, a little uneven. */
function hayBody(len, bottom, top, half, rnd) {
  const n = 14, pos = [], uv = [], idx = [];
  // the cross-section (z, y) from the V's floor round the top: a mound over the upper rails
  const section = (bump) => [[0, bottom], [half * 0.5, (bottom + top) / 2 - 0.02], [half, top - 0.03], [half * 0.66, top + 0.05 + bump], [half * 0.22, top + 0.09 + bump * 1.4], [-half * 0.25, top + 0.08 + bump * 1.2], [-half * 0.68, top + 0.04 + bump], [-half, top - 0.03], [-half * 0.5, (bottom + top) / 2 - 0.02]];
  const S = section(0).length;
  for (let i = 0; i <= n; i++) {
    const x = -len / 2 + (i / n) * len, bump = (rnd() - 0.4) * 0.06 * (i % n ? 1 : 0.3);
    const sec = section(bump);
    let acc = 0;
    for (let k = 0; k <= S; k++) {
      const [z, y] = sec[k % S];
      if (k) { const [pz, py] = sec[k - 1]; acc += Math.hypot(z - pz, y - py); }
      pos.push(x, y, z); uv.push(acc * 2.2, x * 2.2);
    }
  }
  const row = S + 1;
  for (let i = 0; i < n; i++) for (let k = 0; k < S; k++) { const a = i * row + k, b = a + 1, c = a + row, d = c + 1; idx.push(a, c, b, b, c, d); }
  // the ends: a fan round the middle of the section
  for (const [i, flip] of [[0, true], [n, false]]) {
    const x = -len / 2 + (i / n) * len, c = pos.length / 3;
    pos.push(x, (bottom + top) / 2 + 0.05, 0); uv.push(0.5, 0.5);
    for (let k = 0; k < S; k++) { const a = i * row + k, b = i * row + k + 1; if (flip) idx.push(c, a, b); else idx.push(c, b, a); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** Loose stalks: thin sticks of straw, `n` of them in the box round `c` (±s), pointing roughly along `dir`. */
function stalks(p, mat, n, c, s, dir, rnd, len = [0.1, 0.24]) {
  const unit = boxGeo(0.007, 1, 0.004);
  for (let i = 0; i < n; i++) {
    const a = V(c.x + (rnd() - 0.5) * 2 * s.x, c.y + (rnd() - 0.5) * 2 * s.y, c.z + (rnd() - 0.5) * 2 * s.z);
    const d = dir.clone().add(V(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.9)).normalize();
    const l = len[0] + rnd() * (len[1] - len[0]);
    p.addMatrix(unit, mat, new THREE.Matrix4().compose(a.clone().addScaledVector(d, l / 2), new THREE.Quaternion().setFromUnitVectors(UP, d), V(1, l, 1)));
  }
}

// ---------------------------------------------------------------- the feeding station -------------------------------
/** The hay rack with its roof and trough, and the salt lick (in FEEDER's frame: the rack along x, the ground at y 0). */
export function buildFeeder() {
  const M = materials(), p = new Parts(), rnd = seeded(5150);
  const R = FEEDER.rack, L = R.len, hx = L / 2 + 0.06, hz = R.half + 0.01, [hayLo, hayHi] = R.hay;
  // four posts, a frame round their tops and two rails low down
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) board(p, M.wood, 0.09, 2.08, 0.09, [sx * hx, 0.89, sz * hz], [0, (rnd() - 0.5) * 0.06, 0]);
  for (const sz of [-1, 1]) { board(p, M.wood, L + 0.3, 0.09, 0.07, [0, 1.88, sz * hz]); board(p, M.wood, L + 0.04, 0.07, 0.05, [0, 0.16, sz * (hz + 0.06)]); }
  for (const sx of [-1, 1]) board(p, M.wood, 0.07, 0.09, 2 * hz + 0.2, [sx * hx, 1.88, 0]);
  // the trough: a floor and four sides between the posts, its rim at R.trough
  const tw = hz + 0.05, tb = R.trough - 0.15;
  board(p, M.wood, L + 0.02, 0.035, 2 * tw, [0, tb, 0]);
  for (const sz of [-1, 1]) board(p, M.wood, L + 0.06, 0.15, 0.03, [0, tb + 0.075, sz * tw], [sz * 0.08, 0, 0]);
  for (const sx of [-1, 1]) board(p, M.wood, 0.03, 0.15, 2 * tw, [sx * (L / 2 + 0.02), tb + 0.075, 0]);
  // the V of the rack: a beam along its floor, a rail along each top edge, round bars between them
  board(p, M.wood, L + 0.04, 0.07, 0.08, [0, hayLo - 0.03, 0]);
  for (const sz of [-1, 1]) board(p, M.wood, L + 0.04, 0.065, 0.06, [0, hayHi + 0.03, sz * (R.half - 0.02)]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) board(p, M.wood, 0.05, 0.06, R.half, [sx * (L / 2 - 0.02), (hayLo + hayHi) / 2 + 0.02, sz * R.half / 2], [-sz * Math.atan2(hayHi - hayLo, R.half), 0, 0]);
  for (let x = -L / 2 + 0.07; x < L / 2 - 0.05; x += 0.095) {
    for (const sz of [-1, 1]) bar(p, M.dark, V(x, hayLo + 0.01, sz * 0.02), V(x + (rnd() - 0.5) * 0.008, hayHi + 0.03, sz * (R.half - 0.02)), 0.0135);
  }
  // the roof: rafters at both ends, two planes of shingles, a ridge board; the gables closed with boards
  const ridge = 2.3, eave = 1.9, over = 0.24, rw = L + 0.5;
  for (const sz of [-1, 1]) {
    slab(p, M.roof, rw, 0.035, V(0, eave - 0.06, sz * (hz + over)), V(0, ridge, 0));
    slab(p, M.wood, rw + 0.02, 0.02, V(0, eave - 0.1, sz * (hz + over + 0.005)), V(0, eave - 0.06, sz * (hz + over + 0.005)));   // fascia
    for (const sx of [-1, 1]) bar(p, M.wood, V(sx * (L / 2 + 0.06), eave, sz * (hz + over - 0.06)), V(sx * (L / 2 + 0.06), ridge - 0.04, 0), 0.03, 6);
  }
  board(p, M.wood, rw + 0.04, 0.06, 0.11, [0, ridge + 0.04, 0]);
  for (const sx of [-1, 1]) {
    // the gable: three boards stepped up into the triangle
    for (let k = 0; k < 3; k++) { const y = eave + 0.06 + k * 0.12, w = 2 * (hz + over) * (1 - (k * 0.12 + 0.12) / (ridge - eave)) - 0.1; if (w > 0.12) board(p, M.wood, 0.025, 0.115, w, [sx * (L / 2 + 0.1), y, 0]); }
  }
  // hay: in the rack, in the trough, stalks through the bars and over the rails, a little on the ground
  const hay = hayBody(L - 0.08, hayLo + 0.02, hayHi - 0.02, R.half - 0.06, rnd);
  p.add(hay, M.hay); hay.dispose();
  board(p, M.hay, L - 0.06, 0.05, 2 * tw - 0.07, [0, tb + 0.04, 0]);
  for (const sz of [-1, 1]) {
    stalks(p, M.hay, 26, V(0, (hayLo + hayHi) / 2 + 0.05, sz * R.half * 0.55), V(L / 2 - 0.1, 0.22, 0.06), V(0, -0.35, sz), rnd);
    stalks(p, M.hay, 14, V(0, hayHi + 0.07, sz * (R.half - 0.05)), V(L / 2 - 0.08, 0.02, 0.03), V(0, -1, sz * 0.6), rnd, [0.12, 0.28]);
    stalks(p, M.hay, 10, V(0, tb + 0.09, sz * (tw - 0.02)), V(L / 2 - 0.05, 0.01, 0.02), V(0, -0.6, sz), rnd, [0.08, 0.2]);
  }
  stalks(p, M.hay, 18, V(0, hayHi + 0.12, 0), V(L / 2 - 0.15, 0.03, R.half - 0.15), V(0, 1, 0), rnd, [0.06, 0.16]);
  // what the deer pulled out and dropped: loose stalks in the grass under the rack
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2, r = 0.5 + rnd() * 0.55;
    stalks(p, M.hay, 9, V(Math.cos(a) * r * 1.35, 0.012, Math.sin(a) * r), V(0.1, 0.004, 0.1), V(rnd() - 0.5, 0.05, rnd() - 0.5), rnd, [0.12, 0.26]);
  }
  // the salt lick: a round post, its upper part stained, the block on top (a little worn at its edges)
  const S = FEEDER.salt, [sx, sz] = S.at;
  p.add(cylGeo(0.07, 0.085, S.h - 0.27 + 0.12, 10), M.wood, [sx, (S.h - 0.27 - 0.12) / 2, sz]);
  p.add(cylGeo(0.068, 0.07, 0.27, 10), M.dark, [sx, S.h - 0.135, sz]);
  p.add(rboxGeo(0.15, S.block, 0.15, 0.022, 2), M.salt, [sx, S.h + S.block / 2 - 0.005, sz], [0, 0.4, 0]);
  const g = p.build({ name: 'feeder' });
  g.traverse((o) => { if (o.isMesh) { o.userData.noAO = true; o.renderOrder = 12; } });
  // no box round it (it stands at an angle in the meadow): outdoor.js holds it as circles
  g.userData.footprint = null;
  return g;
}

// ---------------------------------------------------------------- the hide -------------------------------------------
/** An open-fronted shelter of horizontal boards on a low platform, a pent roof, a bench along the back wall. It looks
 *  along its local +z (outdoor.js FEEDER.hide). */
export function buildHide() {
  const M = materials(), p = new Parts(), rnd = seeded(808);
  const H = FEEDER.hide, hw = H.w / 2, hd = H.d / 2, floor = 0.14, front = 2.34, back = 2.04;
  const topAt = (z) => back + (front - back) * (z + hd) / H.d;
  // the platform: two sleepers and the floor boards across them
  for (const sz of [-1, 1]) board(p, M.wood, H.w, 0.09, 0.09, [0, 0.03, sz * (hd - 0.12)]);
  for (let z = -hd + 0.07; z < hd - 0.03; z += 0.145) board(p, M.wood, H.w - 0.02, 0.035, 0.135, [0, floor - 0.018, z], [0, 0, (rnd() - 0.5) * 0.01]);
  // corner posts up to the roof
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const top = topAt(sz * (hd - 0.05)) - 0.06; board(p, M.wood, 0.1, top + 0.1, 0.1, [sx * (hw - 0.05), (top - 0.1) / 2, sz * (hd - 0.05)]); }
  // the back wall and the side walls: horizontal boards, each overlapping the one below (the side walls stop at the
  // height of the parapet in front, full height behind)
  const bh = 0.155;
  for (let y = floor, k = 0; y < back - 0.05; y += bh - 0.012, k++) {
    board(p, M.wood, H.w - 0.06, bh, 0.024, [0, y + bh / 2, -hd + 0.02], [-0.06, 0, 0]);
    for (const sx of [-1, 1]) {
      const full = y + bh < 0.8;
      const len = full ? H.d - 0.06 : H.d * 0.48, cz = full ? 0 : -hd + len / 2 + 0.03;
      if (y + bh / 2 < topAt(cz + len / 2) - 0.08) board(p, M.wood, 0.024, bh, len, [sx * (hw - 0.02), y + bh / 2, cz], [0, 0, sx * 0.06]);
    }
  }
  // the parapet in front and a sill board on it to lean on (low: sitting, you look over it)
  for (let y = floor; y < 0.62; y += bh - 0.012) board(p, M.wood, H.w - 0.06, bh, 0.024, [0, y + bh / 2, hd - 0.02], [0.06, 0, 0]);
  board(p, M.wood, H.w - 0.02, 0.035, 0.16, [0, 0.76, hd - 0.05]);
  // the pent roof: shingles on boards, sloping down to the back, with a fascia in front
  const ov = 0.26, a = V(0, back - 0.02, -hd - ov * 0.6), b = V(0, front + 0.03, hd + ov);
  const lineY = (z) => a.y + (b.y - a.y) * (z - a.z) / (b.z - a.z), slope = Math.atan2(b.y - a.y, b.z - a.z);
  slab(p, M.roof, H.w + 0.32, 0.04, a, b);
  slab(p, M.wood, H.w + 0.34, 0.022, V(0, front - 0.1, hd + ov + 0.01), V(0, front + 0.03, hd + ov + 0.01));
  // three rafters under it, their tops along the roof's underside
  const rl = b.z - a.z - 0.06, rz = (a.z + b.z) / 2;
  for (const sx of [-1, 0, 1]) board(p, M.wood, 0.06, 0.1, rl, [sx * (hw - 0.06), lineY(rz) - 0.05 / Math.cos(slope), rz], [-slope, 0, 0]);
  // the bench along the back wall: a seat board on three supports
  const seatY = floor + 0.45, seatZ = -hd + 0.27;
  board(p, M.wood, H.w - 0.36, 0.04, 0.34, [0, seatY - 0.02, seatZ]);
  for (const sx of [-0.8, 0, 0.8]) board(p, M.wood, 0.05, 0.45, 0.3, [sx, floor + 0.225, seatZ]);
  const g = p.build({ name: 'feeder-hide' });
  g.traverse((o) => { if (o.isMesh) { o.userData.noAO = true; o.renderOrder = 12; } });
  g.userData.footprint = null;
  // sitting on the bench: the eye 0.72 m above the seat, looking out over the sill at the rack
  g.userData.seat = { eye: [0, seatY + 0.72, seatZ + 0.06], look: [0, seatY + 0.6, 6], kind: 'bench', pitch: -0.02 };
  return g;
}
