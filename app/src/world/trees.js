// Procedural trees: a few templates per species (beech, oak, birch, spruce, pine, fruit trees, shrubs) built once from a
// trunk, main branches and side branches (tapered tubes) and a few hundred foliage cards (nature.js foliageTexture),
// then drawn as instances. Each template has two levels of detail made from one and the same structure: the far level
// is the near one with every second foliage card, those 1.38 times as large about the point where they hang (the same
// leaf area), a coarser trunk and no twigs. The near level carries per vertex where each part hangs (aPivot) and what
// becomes of it (aMorph), so that the shader turns it into the far level step by step over a band of distance
// (nature.js, uLodNear … uLodFar, 45 … 70 m): the cards that stay grow, the others shrink into their branch, the twigs thin out.
// When garden.js swaps the geometries beyond that band, both look the same and nothing pops. The foliage takes its
// normals from the crown's centre, so a crown is shaded like one soft volume, and an occlusion value per vertex darkens
// its inside.
import * as THREE from 'three';
import { seeded } from './geo.js';
import { natureMaterial, foliageTexture, barkTexture } from './nature.js';

export const SPECIES = {
  //          height     trunk r  crown width/height  branches  cards   card size
  beech:  { h: [15, 20], r: 0.24, cw: 0.34, ch: 0.46, cy: 0.6, start: 0.3, main: 8, cards: 330, card: 1.9, form: 'broad', leaf: 'beech', bark: 'beech' },
  oak:    { h: [13, 18], r: 0.3, cw: 0.42, ch: 0.42, cy: 0.58, start: 0.26, main: 7, cards: 340, card: 2.0, form: 'broad', crooked: 0.6, leaf: 'oak', bark: 'oak' },
  birch:  { h: [12, 17], r: 0.14, cw: 0.2, ch: 0.42, cy: 0.62, start: 0.34, main: 10, cards: 250, card: 1.35, form: 'birch', leaf: 'birch', bark: 'birch' },
  spruce: { h: [16, 24], r: 0.24, cw: 0.21, ch: 0.5, cy: 0.5, start: 0.06, cards: 330, card: 1.9, form: 'conifer', leaf: 'spruce', bark: 'spruce' },
  pine:   { h: [15, 21], r: 0.22, cw: 0.26, ch: 0.2, cy: 0.83, start: 0.58, main: 7, cards: 190, card: 1.9, form: 'pine', leaf: 'pine', bark: 'pine' },
  // a shrub (hazel, dogwood): a short stem that branches low, a dense rounded crown
  bush:   { h: [1.8, 2.8], r: 0.035, cw: 0.62, ch: 0.46, cy: 0.52, start: 0.08, main: 7, cards: 70, card: 0.95, form: 'broad', leaf: 'beech', bark: 'beech' },
  // a fruit tree (apple, cherry) on the lawn: a short crooked trunk, a wide round crown; blossom in spring (seasons.js)
  fruit:  { h: [3.7, 4.8], r: 0.11, cw: 0.5, ch: 0.36, cy: 0.6, start: 0.3, main: 6, cards: 150, card: 1.0, form: 'broad', crooked: 0.8, leaf: 'fruit', bark: 'fruit' },
};
/** The far level's cards are this much larger than the near ones (twice the area: half of them carry the crown). */
export const FAR_CARD = 1.38;

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

/** Collects triangles with position, normal, uv, aOcc and what the shader needs to morph the near level into the far
 *  one: aPivot (where the part hangs) and aMorph (1 a card that stays and grows, 0 a part that shrinks into its pivot,
 *  -1 nothing changes). */
class Builder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.occ = []; this.piv = []; this.mor = []; this.idx = []; }
  get count() { return this.pos.length / 3; }
  vert(p, n, u, v, o, pivot = p, morph = -1) {
    this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uv.push(u, v); this.occ.push(o);
    this.piv.push(pivot.x, pivot.y, pivot.z); this.mor.push(morph);
    return this.count - 1;
  }
  /** Two vertices on a degenerate triangle that widen the bounds (BatchedMesh culls every tree by the bounds of its
   *  geometry: the far level's larger cards and the sway in the wind reach beyond the near level's own). */
  pad(center, radius) {
    const a = this.vert(center.clone().add(V(radius, 0, 0)), UP, 0, 0, 1), b = this.vert(center.clone().add(V(-radius, 0, 0)), UP, 0, 0, 1);
    this.idx.push(a, a, b);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aOcc', new THREE.Float32BufferAttribute(this.occ, 1));
    g.setAttribute('aPivot', new THREE.Float32BufferAttribute(this.piv, 3));
    g.setAttribute('aMorph', new THREE.Float32BufferAttribute(this.mor, 1));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** A tapered tube along `pts` with radii `rad` (one per point), `sides` round. v runs along in texture heights.
 *  `morph` 0: the near level's twig that the shader thins out to its centre line (aPivot = the ring's centre). */
function tube(b, pts, rad, sides, occ, vScale, morph = -1) {
  b.paths?.push({ pts, rad });   // the centre lines of trunk and branches (the birds perch on them: birds.js)
  const rings = [];
  let along = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = i === 0 ? pts[1].clone().sub(pts[0]) : i === pts.length - 1 ? pts[i].clone().sub(pts[i - 1]) : pts[i + 1].clone().sub(pts[i - 1]);
    t.normalize();
    const side = Math.abs(t.y) < 0.95 ? V().crossVectors(t, UP).normalize() : V(1, 0, 0);
    const up2 = V().crossVectors(side, t).normalize();
    if (i > 0) along += pts[i].distanceTo(pts[i - 1]);
    const ring = [];
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const n = side.clone().multiplyScalar(Math.cos(a)).addScaledVector(up2, Math.sin(a));
      ring.push(b.vert(pts[i].clone().addScaledVector(n, rad[i]), n, s / sides, along * vScale, occ(pts[i], i / (pts.length - 1)), pts[i], morph));
    }
    rings.push(ring);
  }
  for (let i = 0; i < rings.length - 1; i++) for (let s = 0; s < sides; s++) {
    const a = rings[i][s], c = rings[i][s + 1], d = rings[i + 1][s], e = rings[i + 1][s + 1];
    b.idx.push(a, d, c, c, d, e);
  }
}
/** Every second point of a polyline, the first and the last always (the far level's coarser branches). */
function coarse(pts, rad) {
  const keep = pts.map((_, i) => i % 2 === 0 || i === pts.length - 1);
  return [pts.filter((_, i) => keep[i]), rad.filter((_, i) => keep[i])];
}
/** A curved branch from `start` along `dir`: `n` points, bending by `bend` (a vector added per step) and wiggle. */
function branchPath(start, dir, len, n, bend, wiggle, rnd) {
  const pts = [start.clone()];
  const d = dir.clone().normalize();
  const step = len / (n - 1);
  for (let i = 1; i < n; i++) {
    d.addScaledVector(bend, 1 / (n - 1)).add(V((rnd() - 0.5) * wiggle, (rnd() - 0.5) * wiggle * 0.5, (rnd() - 0.5) * wiggle)).normalize();
    pts.push(pts[i - 1].clone().addScaledVector(d, step));
  }
  return pts;
}
/** A point on a polyline at t (0…1). */
function along(pts, t) {
  const f = t * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f));
  return pts[i].clone().lerp(pts[i + 1], f - i);
}
function dirAt(pts, t) {
  const f = t * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f));
  return pts[i + 1].clone().sub(pts[i]).normalize();
}
/** A random unit vector. */
function randDir(rnd) { const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u); return V(Math.cos(a) * s, u, Math.sin(a) * s); }

/**
 * One foliage card: its base at `p`, reaching out along `out` (length ~size), facing roughly `face`. The normals
 * of its corners point away from the crown's centre `c` (soft, volume-like shading). Returns its four corners with
 * their normals and occlusion, for both levels.
 */
function cardCorners(p, out, face, size, c, crownR, occBase, rnd, { hang = 0 } = {}) {
  const n = face.clone().normalize();
  // the card's "up": the outward direction, bent down for hanging foliage, kept in the card's plane; a card that
  // faces straight out stands upright instead
  const upv = out.clone().addScaledVector(UP, -hang);
  upv.addScaledVector(n, -upv.dot(n));
  if (upv.lengthSq() < 0.05) { upv.copy(UP).addScaledVector(n, -n.y); if (upv.lengthSq() < 1e-4) upv.set(1, 0, 0); }
  upv.normalize();
  const right = V().crossVectors(upv, n).normalize();
  const w = size * (0.85 + rnd() * 0.3), h = size * (0.85 + rnd() * 0.3);
  const base = p.clone().addScaledVector(upv, -h * 0.12);
  const corners = [
    base.clone().addScaledVector(right, -w / 2), base.clone().addScaledVector(right, w / 2),
    base.clone().addScaledVector(right, -w / 2).addScaledVector(upv, h), base.clone().addScaledVector(right, w / 2).addScaledVector(upv, h),
  ];
  return corners.map((q) => {
    const radial = q.clone().sub(c);
    const d = radial.length() / crownR;
    radial.normalize();
    const nn = radial.multiplyScalar(0.8).addScaledVector(n, 0.2).normalize();
    // inside and underneath the crown gets less light
    const o = Math.min(1, occBase * (0.5 + 0.5 * Math.min(1, d)) * (0.78 + 0.22 * Math.max(-1, Math.min(1, (q.y - c.y) / crownR))));
    return { q, nn, o };
  });
}
const CARD_UV = [[0, 0], [1, 0], [0, 1], [1, 1]];
/** A card into a builder: `scale` about its pivot (the far level), `morph` for the near level's vertices. */
function putCard(b, card, scale, morph) {
  const i0 = b.count;
  card.corners.forEach(({ q, nn, o }, k) => {
    const pos = scale === 1 ? q : card.p.clone().addScaledVector(q.clone().sub(card.p), scale);
    b.vert(pos, nn, CARD_UV[k][0], CARD_UV[k][1], o, card.p, morph);
  });
  b.idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
}

/** Both levels of a template, built once per species and seed. */
const levels = new Map();
/** One template: { bark, leaves, height, crown, paths } (geometries in metres, the base at the origin; paths: the
 *  centre line and radii of every tube of the near level's bark, the trunk first). lod 0 is the near level (with the
 *  morph towards the far one), 1 the far level. */
export function buildTree(species, seed, lod = 0) {
  const key = species + ':' + seed;
  if (!levels.has(key)) levels.set(key, buildLevels(species, seed));
  return levels.get(key)[lod ? 1 : 0];
}

function buildLevels(species, seed) {
  const S = SPECIES[species], rnd = seeded(seed * 7919 + species.length * 131);
  const H = S.h[0] + rnd() * (S.h[1] - S.h[0]);
  const sides = 7, bSides = 5, segs = 8;
  const vScale = 1 / (2 * Math.PI * S.r * 2);
  const crownC = V(0, H * S.cy, 0), crownRw = H * S.cw, crownRh = H * S.ch;
  const crownR = Math.max(crownRw, crownRh);
  const inCrown = (p) => { const dx = p.x - crownC.x, dy = (p.y - crownC.y) * crownRw / crownRh, dz = p.z - crownC.z; return Math.hypot(dx, dy, dz) / crownRw; };
  const barkOcc = (p) => Math.max(0.45, Math.min(1, 1.15 - 0.55 * (1 - Math.min(1, inCrown(p)))));
  // the structure: tubes (with what the far level keeps of them) and cards
  const tubes = [];   // { pts, rad, sides, occ, far: null (twig: dropped) | sides }
  const cards = [];   // [p, out, face, size, occ, hang]

  // --- trunk -------------------------------------------------------------------------------------------
  const lean = V((rnd() - 0.5) * 0.12, 1, (rnd() - 0.5) * 0.12).normalize();
  const trunkTop = S.form === 'broad' ? 0.78 : S.form === 'birch' ? 0.93 : 1.0;
  const trunk = branchPath(V(0, -0.15, 0), lean, H * trunkTop + 0.15, segs + 2, V((rnd() - 0.5) * 0.1, 0, (rnd() - 0.5) * 0.1), S.crooked ? 0.07 : S.form === 'birch' ? 0.05 : 0.02, rnd);
  const trunkR = trunk.map((p, i) => { const t = i / (trunk.length - 1); return S.r * (1 - t * 0.82) * (1 + 0.45 * Math.max(0, 1 - p.y / 0.9)); });
  tubes.push({ pts: trunk, rad: trunkR, sides, occ: barkOcc, far: 5 });

  if (S.form === 'conifer') {
    // whorls of drooping branches, shorter towards the top: a cone
    const step = 0.58;
    for (let y = H * S.start; y < H * 0.97; y += step * (0.85 + rnd() * 0.3)) {
      const t = y / H, per = 5 + Math.floor(rnd() * 2), a0 = rnd() * Math.PI * 2;
      const len = (H * S.cw * 1.25) * Math.pow(1 - t, 0.92) + 0.35;
      for (let j = 0; j < per; j++) {
        const a = a0 + (j / per) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
        const d = V(Math.cos(a), -0.25 - rnd() * 0.2 + t * 0.35, Math.sin(a));
        const start = along(trunk, Math.min(1, y / (H * trunkTop)));
        const pts = branchPath(start, d, len, 4, V(0, 0.35, 0), 0.08, rnd);
        // (the far level keeps the low, long branches: higher up the needles hide them)
        tubes.push({ pts, rad: pts.map((_, i) => 0.05 * (1 - t * 0.6) * (1 - i / 4)), sides: bSides, occ: () => 0.55 + 0.45 * t, far: t < 0.3 ? 3 : null });
        // needle sprays along the branch, lying flat-ish and facing up and out
        const nCards = Math.max(1, Math.round(len / 0.75));
        for (let c = 0; c < nCards; c++) {
          const tt = 0.25 + (c / nCards) * 0.75, p = along(pts, tt), out = dirAt(pts, tt);
          // tilted up and out: seen from the side (from the house) a flat spray would vanish edge-on
          const face = V(0, 0.65, 0).addScaledVector(out, 0.75).add(randDir(rnd).multiplyScalar(0.35));
          cards.push([p, out, face, S.card * (0.55 + 0.45 * (1 - t)) * (0.85 + rnd() * 0.3), 0.75 + 0.25 * t, 0.15]);
        }
      }
    }
    // the leader
    const top = trunk[trunk.length - 1];
    cards.push([top.clone().add(V(0, -0.6, 0)), V(0, 1, 0), V(rnd() - 0.5, 0.2, rnd() - 0.5), S.card * 0.55, 1, 0]);
  } else {
    // main branches from the trunk into the crown, spiralling round it (golden angle)
    const nMain = S.main + Math.floor(rnd() * 3);
    const a0 = rnd() * Math.PI * 2;
    for (let m = 0; m < nMain; m++) {
      const f = (m + 0.5) / nMain;
      const y = H * (S.start + (trunkTop - S.start) * (S.form === 'pine' ? 0.1 + f * 0.85 : Math.pow(f, 0.85)));
      const a = a0 + m * 2.39996 + (rnd() - 0.5) * 0.3;
      const up = S.form === 'birch' ? 0.9 + rnd() * 0.5 : S.form === 'pine' ? 0.35 + rnd() * 0.5 : 0.45 + f * 0.7 + rnd() * 0.3;
      const d = V(Math.cos(a), up, Math.sin(a)).normalize();
      const start = along(trunk, Math.min(1, (y + 0.15) / (H * trunkTop + 0.15)));
      // as long as the crown allows in that direction
      let len = 0; const probe = start.clone();
      while (len < H && inCrown(probe) < 0.97) { probe.addScaledVector(d, 0.25); len += 0.25; }
      len = Math.max(1.2, len * (0.82 + rnd() * 0.14));
      const bend = S.form === 'birch' ? V(0, -0.9, 0) : S.form === 'pine' ? V(0, 0.25, 0) : V(0, 0.2, 0);
      const pts = branchPath(start, d, len, 6, bend, S.crooked ? 0.3 : 0.16, rnd);
      const r0 = S.r * (S.form === 'birch' ? 0.35 : 0.5) * (1 - f * 0.45);
      tubes.push({ pts, rad: pts.map((_, i) => r0 * (1 - (i / (pts.length - 1)) * 0.88)), sides: bSides, occ: barkOcc, far: 3 });
      // side branches
      const nSide = S.form === 'pine' ? 3 : S.form === 'birch' ? 4 : 5;
      for (let s = 0; s < nSide; s++) {
        const tt = 0.3 + (s / nSide) * 0.62 + rnd() * 0.06;
        const p0 = along(pts, tt), pd = dirAt(pts, tt);
        const sd = pd.clone().add(randDir(rnd).multiplyScalar(0.9));
        if (S.form !== 'birch') sd.y = Math.abs(sd.y) * 0.6 + 0.15;
        sd.normalize();
        let sl = len * (0.32 + rnd() * 0.22);
        const q = p0.clone().addScaledVector(sd, sl);
        if (inCrown(q) > 1.05) sl *= 0.7;
        const spts = branchPath(p0, sd, sl, 3, S.form === 'birch' ? V(0, -1.2, 0) : V(0, 0.1, 0), 0.2, rnd);
        // (a twig: the far level has none, the foliage hides them)
        tubes.push({ pts: spts, rad: spts.map((_, i) => r0 * (1 - tt * 0.6) * 0.42 * (1 - i / (spts.length - 1) * 0.85)), sides: 3, occ: barkOcc, far: null });
        // foliage along the side branch and at its end
        const nc = S.form === 'pine' ? 2 : 3;
        for (let c = 0; c < nc; c++) {
          const ct = 0.45 + (c / nc) * 0.55, cp = along(spts, ct);
          const out = cp.clone().sub(crownC); out.y *= 0.6; out.normalize().add(dirAt(spts, ct).multiplyScalar(0.5)).normalize();
          const face = out.clone().add(randDir(rnd).multiplyScalar(0.55));
          cards.push([cp, out, face, S.card * (0.8 + rnd() * 0.35), 1, S.form === 'birch' ? 0.9 : 0.1]);
        }
      }
      // a card at the tip of the main branch
      const tip = pts[pts.length - 1], tdir = dirAt(pts, 1);
      cards.push([tip, tdir, tdir.clone().add(randDir(rnd).multiplyScalar(0.4)), S.card, 1, S.form === 'birch' ? 0.8 : 0.05]);
    }
    // fill the crown so it reads as one mass (cards on points inside the envelope, facing out)
    const fill = Math.max(0, S.cards - cards.length);
    for (let i = 0; i < fill; i++) {
      const d = randDir(rnd); if (S.form !== 'pine' && d.y < -0.55) d.y *= 0.4;
      const rr = Math.pow(rnd(), 0.45) * 0.93;
      const p = crownC.clone().add(V(d.x * crownRw * rr, d.y * crownRh * rr, d.z * crownRw * rr));
      if (S.form === 'pine' && p.y < crownC.y - crownRh * 0.4) continue;
      const out = d.clone(); out.y *= 0.7; out.normalize();
      cards.push([p, out, out.clone().add(randDir(rnd).multiplyScalar(0.6)), S.card * (0.75 + rnd() * 0.4), 0.55 + 0.45 * rr, S.form === 'birch' ? 0.85 : 0.1]);
    }
  }
  const leafCards = cards.map(([p, out, face, size, occ, hang]) => ({ p, corners: cardCorners(p, out, face, size, crownC, crownR, occ, rnd, { hang }) }));

  // --- the two levels -----------------------------------------------------------------------------------------
  const near = { bark: new Builder(), leaves: new Builder() }, far = { bark: new Builder(), leaves: new Builder() };
  near.bark.paths = [];   // the centre lines of trunk and branches (the birds perch on them: birds.js)
  for (const tb of tubes) {
    tube(near.bark, tb.pts, tb.rad, tb.sides, tb.occ, vScale, tb.far ? -1 : 0);
    if (tb.far) { const [pts, rad] = coarse(tb.pts, tb.rad); tube(far.bark, pts, rad, tb.far, tb.occ, vScale); }
  }
  // the far level keeps every second card (spread evenly over the crown: the cards come in no spatial order)
  leafCards.forEach((card, i) => {
    const keep = i % 2 === 0;
    putCard(near.leaves, card, 1, keep ? 1 : 0);
    if (keep) putCard(far.leaves, card, FAR_CARD, -1);
  });
  // one bound for both levels: what either of them reaches, and the sway of the crown in a storm (nature.js natWind)
  const box = new THREE.Box3();
  for (const b of [near.bark, near.leaves, far.bark, far.leaves]) for (let i = 0; i < b.pos.length; i += 3) box.expandByPoint(V(b.pos[i], b.pos[i + 1], b.pos[i + 2]));
  const center = box.getCenter(V());
  let r2 = 0;
  for (const b of [near.bark, near.leaves, far.bark, far.leaves]) for (let i = 0; i < b.pos.length; i += 3) r2 = Math.max(r2, center.distanceToSquared(V(b.pos[i], b.pos[i + 1], b.pos[i + 2])));
  const sway = 0.0011 * 1.15 * H * H + 0.1;
  for (const b of [near.bark, near.leaves, far.bark, far.leaves]) b.pad(center, Math.sqrt(r2) + sway);
  const crown = { y: crownC.y, rw: crownRw, rh: crownRh };
  return [near, far].map((l) => ({ bark: l.bark.geometry(), leaves: l.leaves.geometry(), height: H, crown, paths: near.bark.paths }));
}

// ---------------------------------------------------------------- materials -----------------------------
/** How each kind of foliage changes over the year (seasons.js blends between them; nature.js 'leaf'): the tint of the
 *  fresh green in spring, and the two colours between which its trees turn in autumn (linear rgb, at the brightness of
 *  an average summer leaf). Conifers keep their colour. */
export const LEAF_SEASONS = {
  beech: { spring: [1.16, 1.26, 0.7], autumn: [[0.9, 0.34, 0.05], [0.64, 0.25, 0.06]] },
  oak: { spring: [1.12, 1.2, 0.74], autumn: [[0.66, 0.44, 0.09], [0.48, 0.26, 0.07]] },
  birch: { spring: [1.2, 1.28, 0.7], autumn: [[1.0, 0.74, 0.1], [0.9, 0.56, 0.06]] },
  fruit: { spring: [1.14, 1.22, 0.74], autumn: [[0.95, 0.6, 0.08], [0.82, 0.26, 0.05]] },
  // the shrubs (beech leaves on a shrub): hazel yellow, dogwood red
  bush: { spring: [1.18, 1.26, 0.72], autumn: [[0.95, 0.66, 0.08], [0.72, 0.1, 0.04]] },
  spruce: { spring: [1.06, 1.1, 0.94], autumn: null },
  pine: { spring: [1.05, 1.08, 0.95], autumn: null },
};
const mats = new Map();
export function barkMaterial(species) {
  const key = 'bark:' + species;
  if (!mats.has(key)) {
    const t = barkTexture(SPECIES[species].bark);
    mats.set(key, natureMaterial('bark', { map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.95, color: 0xffffff, fog: false }, { lod: true }));
  }
  return mats.get(key);
}
export function leafMaterial(species) {
  const key = 'leaf:' + species;
  if (!mats.has(key)) {
    const ls = LEAF_SEASONS[species] || LEAF_SEASONS.beech;
    const [a, b] = ls.autumn || [[0, 0, 0], [0, 0, 0]];
    const uniforms = {
      uLeafSpring: { value: new THREE.Vector3(...ls.spring) },
      uAutumnA: { value: new THREE.Color().setRGB(...a) }, uAutumnB: { value: new THREE.Color().setRGB(...b) },
      uAutumnAmt: { value: ls.autumn ? 1 : 0 },
      uBlossomPink: { value: species === 'fruit' ? 1 : 0 },   // (seasons.js swaps the fruit trees' texture in spring)
    };
    const m = natureMaterial('leaf', { map: foliageTexture(SPECIES[species].leaf), alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.78, color: 0xffffff, fog: false }, { lod: true, uniforms });
    m.userData.leafSeason = uniforms;
    mats.set(key, m);
  }
  return mats.get(key);
}
