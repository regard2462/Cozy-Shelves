// The wild animals of the garden (wildlife.js): a roe deer doe, her fawn, a red deer stag, a red fox and a wolf, all
// modelled from code. Every species is one skinned mesh. The trunk and the neck are a single lofted tube (no seam at the
// shoulders), the head, the legs, the ears, the tail and the antlers are further tubes; smooth normals, the coat painted
// into vertex colours. About 26 bones bend it: the spine, the neck, the head, the ears, the tail and four per leg.
// All species share one material and with it one shader program (the garden's 'plain' kind, nature.js): a fur detail
// texture, the fawn's spots from a second small texture and a gloss value per vertex for eyes, noses and hooves.
import * as THREE from 'three';
import { seeded } from './geo.js';
import { natureMaterial } from './nature.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** sRGB hex → linear rgb (vertex colours are linear) */
const C = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const cr = (p0, p1, p2, p3, t) => { const t2 = t * t, t3 = t2 * t; return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); };
const FUR_TILE = 0.12;   // metres per repeat of the fur detail texture

// ---------------------------------------------------------------- textures and the material -------------------------
let furTex = null, spotTex = null, material = null;
/** Fine hairs, grey around 0.9: multiplied into the coat colour. Tileable. */
function furTexture() {
  if (furTex) return furTex;
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), rnd = seeded(91);
  g.fillStyle = '#e2e2e2'; g.fillRect(0, 0, N, N);
  // short hairs along v (along the tube); each is drawn at its wrapped positions too, so the tile repeats without a seam
  for (let i = 0; i < 1500; i++) {
    const x = rnd() * N, y = rnd() * N, l = 3 + rnd() * 9, dx = (rnd() - 0.5) * 1.6, v = Math.round(165 + rnd() * 90);
    g.strokeStyle = `rgba(${v},${v},${v},${(0.3 + rnd() * 0.45).toFixed(2)})`; g.lineWidth = 0.7 + rnd() * 1.0;
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + dx, y + oy + l); g.stroke(); }
  }
  furTex = new THREE.CanvasTexture(c);
  furTex.wrapS = furTex.wrapT = THREE.RepeatWrapping; furTex.colorSpace = THREE.NoColorSpace; furTex.anisotropy = 4;
  return furTex;
}
/** The fawn's spots: u runs over the back from flank to flank (0.5 = the spine), v along the trunk from the rump to
 *  the shoulders. White in the red channel. */
function spotTexture() {
  if (spotTex) return spotTex;
  const W = 256, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), rnd = seeded(17);
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  // rows of spots along both sides of the spine, sparser and more scattered down the flanks
  const rows = [[0.075, 0.06, 0], [0.155, 0.062, 0.1], [0.24, 0.07, 0.25], [0.33, 0.085, 0.45], [0.41, 0.1, 0.6]];
  for (const side of [-1, 1]) for (const [off, step, skip] of rows) {
    for (let v = 0.06 + rnd() * step; v < 0.95; v += step * (0.85 + rnd() * 0.3)) {
      if (rnd() < skip) continue;
      const u = 0.5 + side * (off + (rnd() - 0.5) * 0.025), r = 1 - off * 0.9;
      const gr = g.createRadialGradient(u * W, v * H, 0, u * W, v * H, 9 * r);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.62, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.save(); g.translate(u * W, v * H); g.scale(1, 0.72 + rnd() * 0.2); g.translate(-u * W, -v * H);
      g.beginPath(); g.arc(u * W, v * H, 9 * r, 0, Math.PI * 2); g.fill(); g.restore();
    }
  }
  spotTex = new THREE.CanvasTexture(c);
  spotTex.colorSpace = THREE.NoColorSpace; spotTex.anisotropy = 4;
  return spotTex;
}

// Dusk and night (setNightLook, every frame while animals are out): how far the light has gone (0 by day, 1 at night)
// and the colour the eyes throw back.
const NIGHT = { uNight: { value: 0 }, uEyeShine: { value: new THREE.Color(0, 0, 0) } };
/** Dusk and night from the sun's height (wildlife.js #light: { sun }): the eyes begin to shine, the coat's edges catch
 *  the sky. */
export function setNightLook({ sun }) {
  const k = sstep(0.06, -0.1, sun);
  NIGHT.uNight.value = k;
  NIGHT.uEyeShine.value.setRGB(0.62, 0.86, 0.66).multiplyScalar(k * 2.6);
}

/**
 * The one material of all animals: a garden material (sky light from above, ground light from below, haze, rain makes
 * the coat darker) of the kind without the rooms' lamps, as the lawn and the trees have it: the lamps do not reach the
 * meadow, and every fragment would still have gone through all of them. Vertex colours and the fur detail; aFur carries
 * the marking uv (xy), how much of the marking shows (z) and the gloss (w: eyes, the wet nose, hooves). Snow only dusts
 * the back. In the dark the eyes catch the light (the reflecting layer behind the retina that deer and foxes have) when
 * they look your way, and the fur's edges hold the sky's light: an animal stays an animal, not a black hole.
 */
export function animalMaterial() {
  if (material) return material;
  material = natureMaterial('ground', { map: furTexture(), color: 0xffffff, vertexColors: true, roughness: 0.92, metalness: 0, fog: false }, {
    key: ':wildlife',
    uniforms: { uMarks: { value: spotTexture() }, ...NIGHT },
    vertexPars: 'attribute vec4 aFur; varying vec4 vFur;',
    vertexBody: 'vFur = aFur;',
    fragmentPars: 'uniform sampler2D uMarks; uniform float uNight; uniform vec3 uEyeShine; varying vec4 vFur;',
    snowFragment: `
  cover = uSnow * 0.3 * smoothstep(0.05, 0.5, nW.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.74, 0.64), texture2D(uMarks, vFur.xy).r * vFur.z);
  roughnessFactor = mix(roughnessFactor, 0.12, vFur.w);
  totalEmissiveRadiance += uEyeShine * step(0.95, vFur.w) * pow(max(dot(normal, normalize(vViewPosition)), 0.0), 3.0);`,
    // fur scatters the sky light at grazing angles: the silhouette is a little brighter and softer, and at dusk the bright
    // horizon behind an animal outlines it against the dark meadow; at night the pale sky and the moon rim it
    irradianceFragment: `{
    float rim = pow(1.0 - clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0), 2.5) * (1.0 - vFur.w);
    irradiance = irradiance * (1.0 + 0.6 * rim + 0.9 * uNight * rim) + uHazeColor * rim * 0.34 + uSkyLight * rim * 2.2 * uNight;
  }`,
  });
  material.name = 'wildlife';
  return material;
}

// ---------------------------------------------------------------- geometry ------------------------------------------
/** Collects the vertices of one species: position, uv (metres / FUR_TILE), colour, aFur and the skinning. */
class Build {
  constructor(boneIndex) { this.boneIndex = boneIndex; this.pos = []; this.uv = []; this.col = []; this.fur = []; this.si = []; this.sw = []; this.idx = []; this.seams = []; this.noise = seeded(5); }
  get n() { return this.pos.length / 3; }
  /** { bone: weight } → the four heaviest, normalised */
  skin(spec) {
    const idx = [0, 0, 0, 0], wt = [0, 0, 0, 0];
    for (const name in spec) {
      const w = spec[name]; if (!(w > 1e-4)) continue;
      let k = 3; if (w <= wt[k]) continue;
      while (k > 0 && w > wt[k - 1]) { wt[k] = wt[k - 1]; idx[k] = idx[k - 1]; k--; }
      const b = this.boneIndex[name]; if (b === undefined) throw new Error('wildlife: no bone ' + name);
      wt[k] = w; idx[k] = b;
    }
    const sum = wt[0] + wt[1] + wt[2] + wt[3] || 1;
    for (let i = 0; i < 4; i++) wt[i] /= sum;
    return [idx, wt];
  }
  vert(p, u, v, paint, skin) {
    const j = 1 + (this.noise() - 0.5) * 0.06;   // a little unevenness in the coat
    const c = paint.c, g = paint.g || 0, k = g > 0.5 ? 1 : j, m = paint.m, si = skin[0], sw = skin[1];
    this.pos.push(p.x, p.y, p.z); this.uv.push(u / FUR_TILE, v / FUR_TILE); this.col.push(c[0] * k, c[1] * k, c[2] * k);
    if (m) this.fur.push(m[0], m[1], m[2], g); else this.fur.push(0, 0, 0, g);
    this.si.push(si[0], si[1], si[2], si[3]); this.sw.push(sw[0], sw[1], sw[2], sw[3]);
    return this.n - 1;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aFur', new THREE.Float32BufferAttribute(this.fur, 4));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeVertexNormals();
    // the duplicated seam vertices of every ring share one normal
    const nr = g.attributes.normal, t = V();
    for (const [a, b] of this.seams) {
      t.set(nr.getX(a) + nr.getX(b), nr.getY(a) + nr.getY(b), nr.getZ(a) + nr.getZ(b)).normalize();
      nr.setXYZ(a, t.x, t.y, t.z); nr.setXYZ(b, t.x, t.y, t.z);
    }
    g.computeBoundingSphere();
    return g;
  }
}

const lerpSkin = (a, b, t) => { const out = {}; for (const k in a) out[k] = (out[k] || 0) + a[k] * (1 - t); for (const k in b) out[k] = (out[k] || 0) + b[k] * t; return out; };
/**
 * A closed tube through stations { c: centre, up, dn, w, wt?, e?, bones: { name: weight }, q?: [values for paint] }.
 * The rings lie across the centre line: `side` (kept square to it) is their x axis, y = tangent × x: on the trunk
 * that is up, on a leg the front. `up`/`dn` reach along +y/−y, `w` along ±x, `wt` narrows the upper half, `e` > 2
 * makes the section boxier. The centre line and every value follow Catmull-Rom curves; the seam runs along −y (the
 * belly, the back of a leg). paint({ s, a, sa, ca, p, q, x, cap }) → { c: rgb, m?: marking [u, v, weight], g?: gloss }.
 * shape(a, ring, x, y) may move a ring point (the cup of an ear, the cleft of a hoof). caps: how far the pole of each
 * end stands out, relative to that ring's size (null: open).
 */
function loft(B, st, { seg = 16, spacing = 0.015, side = V(1, 0, 0), paint, caps = [0.6, 0.6], shape = null, fixed = null, skinAt = null }) {
  const n = st.length;
  const curve = new THREE.CatmullRomCurve3(st.map((s) => s.c), false, 'centripetal');
  const rings = [];
  for (let i = 0; i < n - 1; i++) {
    const steps = Math.max(1, Math.ceil(st[i].c.distanceTo(st[i + 1].c) / spacing));
    const s0 = st[Math.max(0, i - 1)], s1 = st[i], s2 = st[i + 1], s3 = st[Math.min(n - 1, i + 2)];
    for (let k = 0; k < steps + (i === n - 2 ? 1 : 0); k++) {
      const f = k / steps, t = (i + f) / (n - 1);
      const ip = (key, def) => cr(s0[key] ?? def, s1[key] ?? def, s2[key] ?? def, s3[key] ?? def, f);
      const q = s1.q ? s1.q.map((v, j) => cr(s0.q[j], v, s2.q[j], s3.q[j], f)) : null;
      rings.push({ c: curve.getPoint(t), T: curve.getTangent(t), up: Math.max(4e-4, ip('up')), dn: Math.max(4e-4, ip('dn')), w: Math.max(4e-4, ip('w')), wt: ip('wt', 1), e: ip('e', 2), skin: lerpSkin(s1.bones, s2.bones, f), q });
    }
  }
  const R = rings.length, row = seg + 1, first = B.n;
  const along = [0]; for (let i = 1; i < R; i++) along.push(along[i - 1] + rings[i].c.distanceTo(rings[i - 1].c));
  const total = along[R - 1] || 1;
  const X = V(), Y = V(), p = V();
  rings.forEach((r, i) => {
    const T = fixed || r.T;
    X.copy(side).addScaledVector(T, -side.dot(T)).normalize(); Y.crossVectors(T, X);
    const skin = B.skin(r.skin), mid = (r.up + r.dn) / 2;
    const per = Math.PI * (3 * (r.w + mid) - Math.sqrt((3 * r.w + mid) * (r.w + 3 * mid))) / 2;   // half the ellipse (Ramanujan)
    for (let k = 0; k <= seg; k++) {
      const a = -Math.PI / 2 + (k / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), pe = 2 / r.e;
      let x = Math.sign(ca) * Math.pow(Math.abs(ca), pe) * r.w * (1 - (1 - r.wt) * Math.max(0, sa) ** 2);
      let y = Math.sign(sa) * Math.pow(Math.abs(sa), pe) * (sa >= 0 ? r.up : r.dn);
      if (shape) [x, y] = shape(a, r, x, y, along[i] / total);
      p.copy(r.c).addScaledVector(X, x).addScaledVector(Y, y);
      B.vert(p, (k / seg) * per * 2, along[i], paint({ s: along[i] / total, a, sa, ca, p, q: r.q, x }), skinAt ? B.skin(skinAt(p)) : skin);
    }
    B.seams.push([B.n - row, B.n - 1]);
  });
  for (let i = 0; i < R - 1; i++) for (let k = 0; k < seg; k++) {
    const a = first + i * row + k, b = a + 1, c = a + row, d = c + 1;
    B.idx.push(a, b, c, b, d, c);
  }
  const cap = (ri, dir, off) => {
    const r = rings[ri];
    const pole = r.c.clone().addScaledVector(fixed || r.T, dir * off * Math.min(r.w, (r.up + r.dn) / 2));
    const pi = B.vert(pole, 0, along[ri] + dir * 0.01, paint({ s: ri ? 1 : 0, a: Math.PI / 2, sa: 0, ca: 0, p: pole, q: r.q, x: 0, cap: true }), B.skin(skinAt ? skinAt(pole) : r.skin));
    const base = first + ri * row;
    for (let k = 0; k < seg; k++) { if (dir < 0) B.idx.push(pi, base + k + 1, base + k); else B.idx.push(pi, base + k, base + k + 1); }
  };
  if (caps[0] != null) cap(0, -1, caps[0]);
  if (caps[1] != null) cap(R - 1, 1, caps[1]);
  return rings;
}
/** An ellipsoid with its poles on ±Z (eyes, noses, paws, tufts). */
function ellipsoid(B, c, X, Z, r, paint, bones, segU = 10, segV = 6) {
  const x = X.clone().addScaledVector(Z, -X.dot(Z)).normalize(), z = Z.clone().normalize(), y = V().crossVectors(z, x);
  const first = B.n, sk = B.skin(bones), p = V();
  for (let j = 0; j <= segV; j++) {
    const th = (j / segV) * Math.PI, cz = -Math.cos(th), rr = Math.sin(th);
    for (let i = 0; i <= segU; i++) {
      const a = -Math.PI / 2 + (i / segU) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      p.copy(c).addScaledVector(x, ca * rr * r[0]).addScaledVector(y, sa * rr * r[1]).addScaledVector(z, cz * r[2]);
      B.vert(p, (i / segU) * r[0] * 6, (j / segV) * r[2] * 2, paint({ a, sa, ca, cz, p }), sk);
    }
    B.seams.push([B.n - segU - 1, B.n - 1]);
  }
  for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) {
    const a = first + j * (segU + 1) + i, b = a + 1, cc = a + segU + 1, d = cc + 1;
    B.idx.push(a, b, cc, b, d, cc);
  }
}

// ---------------------------------------------------------------- the species --------------------------------------
// Positions in metres, +z forward, +y up, +x the animal's left; the origin lies on the ground under the middle of the
// trunk. Rows: [z, top, bottom, half width, width of the upper half] (trunk and neck, upright slices), [s, dy, up, dn,
// half width] (head: along its axis from the poll), [x, y, z, front, back, half width, bones] (legs, the left one; the
// right one is mirrored).

/** Roe deer, withers 0.70 m: the doe as she is; the fawn and the stag are built from these proportions (morph()). */
const ROE = {
  bones: { body: [0, 0.56, -0.05], pelvis: [0, 0.60, -0.30], chest: [0, 0.56, 0.16], neck1: [0, 0.60, 0.31], neck2: [0, 0.72, 0.43], head: [0, 0.882, 0.535], tail: [0, 0.65, -0.53] },
  // the trunk and the neck in upright slices from the rump to the poll: [z, top, bottom, half width, width of the upper half]
  trunk: [
    [-0.556, 0.616, 0.586, 0.016, 1], [-0.548, 0.660, 0.540, 0.050, 1], [-0.525, 0.698, 0.494, 0.084, 0.95], [-0.475, 0.722, 0.458, 0.108, 0.9],
    [-0.390, 0.731, 0.446, 0.121, 0.86], [-0.285, 0.723, 0.452, 0.119, 0.86], [-0.180, 0.712, 0.428, 0.128, 0.86], [-0.060, 0.700, 0.394, 0.138, 0.85],
    [0.060, 0.695, 0.376, 0.140, 0.84], [0.180, 0.705, 0.372, 0.128, 0.8], [0.270, 0.702, 0.392, 0.110, 0.78],
    [0.325, 0.716, 0.418, 0.094, 0.8], [0.370, 0.742, 0.448, 0.082, 0.82], [0.405, 0.775, 0.488, 0.071, 0.85], [0.435, 0.808, 0.540, 0.063, 0.88],
    [0.462, 0.838, 0.602, 0.057, 0.9], [0.488, 0.865, 0.675, 0.053, 0.92], [0.510, 0.889, 0.750, 0.050, 0.94], [0.527, 0.906, 0.815, 0.048, 0.96], [0.537, 0.912, 0.860, 0.030, 1],
  ],
  neckFrom: 11,                    // the first slice of the neck
  head: {
    pitch: 0.78,                   // the face points this far below the horizontal (radians)
    st: [[-0.040, -0.012, 0.013, 0.013, 0.015], [-0.024, -0.015, 0.040, 0.046, 0.040], [0.008, -0.020, 0.050, 0.062, 0.052], [0.048, -0.018, 0.050, 0.056, 0.056], [0.088, -0.016, 0.041, 0.045, 0.046], [0.128, -0.016, 0.033, 0.035, 0.035], [0.160, -0.016, 0.028, 0.029, 0.030], [0.186, -0.014, 0.025, 0.025, 0.027], [0.202, -0.012, 0.015, 0.015, 0.017]],
    eye: { s: 0.048, dy: 0.016, r: 0.0135 },                 // where along the head and how high; it sits in the surface
    ear: { at: [0.032, 0.026, -0.012], dir: [0.75, 0.62, -0.42], open: [1, 0.25, 0.8], len: 0.138, w: [0.016, 0.026, 0.034, 0.036, 0.032, 0.024, 0.013, 0.004], th: 0.006, cup: 0.012 },
  },
  // the foreleg from inside the chest to the hoof: [x, y, z, front, back, half width, bones] (the left one)
  front: [
    [0.068, 0.500, 0.200, 0.040, 0.044, 0.034, { chest: 0.5, fL0: 0.5 }],
    [0.068, 0.440, 0.172, 0.040, 0.048, 0.034, { fL0: 1 }],
    [0.067, 0.400, 0.166, 0.036, 0.046, 0.031, { fL0: 0.55, fL1: 0.45 }],
    [0.066, 0.350, 0.168, 0.031, 0.030, 0.026, { fL1: 1 }],
    [0.065, 0.280, 0.172, 0.022, 0.021, 0.020, { fL1: 1 }],
    [0.065, 0.232, 0.174, 0.019, 0.019, 0.0195, { fL1: 0.75, fL2: 0.25 }],
    [0.065, 0.212, 0.175, 0.020, 0.020, 0.021, { fL1: 0.5, fL2: 0.5 }],
    [0.064, 0.150, 0.177, 0.0135, 0.0155, 0.013, { fL2: 1 }],
    [0.063, 0.090, 0.178, 0.014, 0.017, 0.014, { fL2: 0.85, fL3: 0.15 }],
    [0.063, 0.068, 0.180, 0.016, 0.020, 0.016, { fL2: 0.5, fL3: 0.5 }],
    [0.063, 0.048, 0.190, 0.013, 0.014, 0.0145, { fL3: 1 }],
    [0.063, 0.034, 0.198, 0.013, 0.012, 0.014, { fL3: 1 }],
  ],
  frontJoints: [[0.068, 0.560, 0.200], [0.067, 0.400, 0.166], [0.065, 0.212, 0.175], [0.063, 0.068, 0.180]],
  // the hind leg: thigh and gaskin as one broad wedge down to the hock (its front edge is the stifle, its back the
  // line from the buttock to the hock), then the slim lower leg
  hindUp: [
    [0.066, 0.640, -0.390, 0.090, 0.110, 0.050, { pelvis: 0.85, hL0: 0.15 }],
    [0.074, 0.565, -0.392, 0.120, 0.120, 0.056, { pelvis: 0.45, hL0: 0.55 }],
    [0.078, 0.495, -0.398, 0.125, 0.110, 0.054, { hL0: 1 }],
    [0.077, 0.445, -0.405, 0.105, 0.092, 0.046, { hL0: 0.65, hL1: 0.35 }],
    [0.072, 0.395, -0.412, 0.068, 0.072, 0.036, { hL0: 0.2, hL1: 0.8 }],
    [0.067, 0.345, -0.420, 0.040, 0.050, 0.027, { hL1: 1 }],
    [0.065, 0.305, -0.428, 0.024, 0.032, 0.021, { hL1: 0.6, hL2: 0.4 }],
    [0.064, 0.290, -0.430, 0.012, 0.016, 0.012, { hL1: 0.5, hL2: 0.5 }],
  ],
  hind: [
    [0.064, 0.330, -0.432, 0.020, 0.026, 0.020, { hL1: 0.6, hL2: 0.4 }],
    [0.064, 0.290, -0.432, 0.018, 0.025, 0.020, { hL1: 0.5, hL2: 0.5 }],
    [0.063, 0.220, -0.420, 0.0135, 0.016, 0.013, { hL2: 1 }],
    [0.063, 0.120, -0.405, 0.0135, 0.016, 0.013, { hL2: 1 }],
    [0.063, 0.090, -0.400, 0.014, 0.017, 0.014, { hL2: 0.85, hL3: 0.15 }],
    [0.063, 0.068, -0.396, 0.016, 0.020, 0.016, { hL2: 0.5, hL3: 0.5 }],
    [0.063, 0.048, -0.386, 0.013, 0.014, 0.0145, { hL3: 1 }],
    [0.063, 0.034, -0.378, 0.013, 0.012, 0.014, { hL3: 1 }],
  ],
  hindJoints: [[0.066, 0.620, -0.380], [0.078, 0.445, -0.300], [0.064, 0.290, -0.432], [0.063, 0.068, -0.396]],
};

/** Red fox, withers 0.38 m; the wolf is built from these proportions (morph()). */
const FOX = {
  bones: { body: [0, 0.30, -0.04], pelvis: [0, 0.32, -0.20], chest: [0, 0.30, 0.08], neck1: [0, 0.32, 0.17], neck2: [0, 0.385, 0.24], head: [0, 0.455, 0.305], tail1: [0, 0.34, -0.31], tail2: [0, 0.300, -0.42], tail3: [0, 0.250, -0.55] },
  trunk: [
    [-0.335, 0.336, 0.318, 0.010, 1], [-0.326, 0.352, 0.292, 0.032, 1], [-0.305, 0.366, 0.262, 0.047, 0.95], [-0.265, 0.374, 0.244, 0.055, 0.9],
    [-0.200, 0.374, 0.238, 0.056, 0.88], [-0.120, 0.369, 0.228, 0.057, 0.88], [-0.030, 0.368, 0.212, 0.061, 0.86], [0.060, 0.374, 0.196, 0.063, 0.84],
    [0.130, 0.380, 0.198, 0.059, 0.8], [0.175, 0.388, 0.222, 0.053, 0.8],
    [0.210, 0.400, 0.272, 0.047, 0.84], [0.240, 0.420, 0.310, 0.043, 0.88], [0.268, 0.443, 0.352, 0.040, 0.9], [0.292, 0.465, 0.392, 0.037, 0.92], [0.308, 0.478, 0.420, 0.034, 0.95], [0.318, 0.480, 0.440, 0.022, 1],
  ],
  neckFrom: 10,
  head: {
    pitch: 0.30,
    st: [[-0.032, -0.004, 0.012, 0.012, 0.014], [-0.018, -0.004, 0.032, 0.034, 0.036], [0.006, -0.004, 0.040, 0.038, 0.046], [0.030, -0.006, 0.036, 0.032, 0.043], [0.050, -0.012, 0.024, 0.024, 0.028], [0.072, -0.016, 0.0175, 0.019, 0.0175], [0.096, -0.017, 0.0145, 0.0155, 0.013], [0.116, -0.016, 0.0115, 0.012, 0.0105], [0.128, -0.015, 0.0085, 0.0095, 0.008], [0.134, -0.014, 0.004, 0.004, 0.004]],
    eye: { s: 0.030, dy: 0.012, r: 0.0085, out: [1, 0.25, 0.6] },
    ear: { at: [0.022, 0.022, -0.006], dir: [0.28, 0.9, -0.3], open: [0.45, 0.25, 1], len: 0.085, w: [0.020, 0.025, 0.024, 0.020, 0.015, 0.010, 0.005, 0.0015], th: 0.005, cup: 0.009 },
    nose: { s: 0.130, dy: -0.012, r: [0.0085, 0.007, 0.006] },
  },
  front: [
    [0.038, 0.270, 0.120, 0.026, 0.028, 0.022, { chest: 0.5, fL0: 0.5 }],
    [0.038, 0.225, 0.108, 0.026, 0.030, 0.021, { fL0: 1 }],
    [0.038, 0.200, 0.106, 0.022, 0.028, 0.019, { fL0: 0.55, fL1: 0.45 }],
    [0.037, 0.150, 0.110, 0.017, 0.016, 0.014, { fL1: 1 }],
    [0.035, 0.095, 0.116, 0.011, 0.011, 0.0105, { fL1: 1 }],
    [0.034, 0.068, 0.119, 0.0115, 0.0125, 0.011, { fL1: 0.5, fL2: 0.5 }],
    [0.034, 0.045, 0.126, 0.010, 0.0105, 0.0105, { fL2: 1 }],
    [0.034, 0.026, 0.136, 0.0115, 0.0115, 0.012, { fL2: 0.5, fL3: 0.5 }],
  ],
  frontJoints: [[0.038, 0.30, 0.12], [0.038, 0.20, 0.106], [0.034, 0.068, 0.119], [0.034, 0.026, 0.136]],
  hindUp: [
    [0.044, 0.340, -0.235, 0.050, 0.060, 0.032, { pelvis: 0.85, hL0: 0.15 }],
    [0.048, 0.295, -0.238, 0.065, 0.065, 0.036, { pelvis: 0.45, hL0: 0.55 }],
    [0.050, 0.255, -0.242, 0.068, 0.060, 0.034, { hL0: 1 }],
    [0.049, 0.225, -0.248, 0.055, 0.050, 0.029, { hL0: 0.6, hL1: 0.4 }],
    [0.046, 0.195, -0.256, 0.034, 0.038, 0.022, { hL0: 0.2, hL1: 0.8 }],
    [0.043, 0.160, -0.266, 0.020, 0.026, 0.016, { hL1: 1 }],
    [0.041, 0.130, -0.274, 0.013, 0.018, 0.012, { hL1: 0.6, hL2: 0.4 }],
    [0.041, 0.118, -0.277, 0.007, 0.009, 0.007, { hL1: 0.5, hL2: 0.5 }],
  ],
  hind: [
    [0.041, 0.140, -0.276, 0.012, 0.016, 0.011, { hL1: 0.6, hL2: 0.4 }],
    [0.041, 0.118, -0.277, 0.011, 0.016, 0.011, { hL1: 0.5, hL2: 0.5 }],
    [0.041, 0.070, -0.267, 0.010, 0.0105, 0.0095, { hL2: 1 }],
    [0.041, 0.026, -0.256, 0.0115, 0.0115, 0.012, { hL2: 0.5, hL3: 0.5 }],
  ],
  hindJoints: [[0.044, 0.32, -0.23], [0.05, 0.225, -0.19], [0.041, 0.118, -0.277], [0.041, 0.026, -0.256]],
  paw: [0.0135, 0.0125, 0.021],
  tail: [[-0.300, 0.336, 0.016, { pelvis: 0.6, tail1: 0.4 }], [-0.326, 0.332, 0.028, { tail1: 1 }], [-0.385, 0.316, 0.046, { tail1: 0.7, tail2: 0.3 }], [-0.455, 0.292, 0.056, { tail2: 1 }], [-0.535, 0.262, 0.058, { tail2: 0.5, tail3: 0.5 }], [-0.615, 0.232, 0.050, { tail3: 1 }], [-0.675, 0.212, 0.034, { tail3: 1 }], [-0.708, 0.204, 0.014, { tail3: 1 }]],
};

/** The wolf's head (in the fox table's units): a high, broad skull, a clear stop and a long, blunt muzzle. */
const WOLF_HEAD = {
  pitch: 0.2,
  st: [[-0.030, -0.002, 0.012, 0.012, 0.014], [-0.016, -0.002, 0.032, 0.036, 0.041], [0.006, -0.002, 0.038, 0.040, 0.052], [0.026, -0.004, 0.036, 0.034, 0.047], [0.044, -0.012, 0.026, 0.026, 0.030], [0.062, -0.017, 0.020, 0.022, 0.022], [0.084, -0.019, 0.0175, 0.019, 0.019], [0.104, -0.019, 0.016, 0.017, 0.017], [0.118, -0.018, 0.0145, 0.015, 0.015], [0.126, -0.017, 0.009, 0.009, 0.009]],
  eye: { s: 0.028, dy: 0.014, r: 0.0075, out: [1, 0.25, 0.55] },
  ear: { at: [0.026, 0.03, -0.004], dir: [0.3, 0.92, -0.22], open: [0.4, 0.25, 1], len: 0.085, w: [0.022, 0.028, 0.027, 0.023, 0.018, 0.012, 0.006, 0.002], th: 0.005, cup: 0.009 },
  nose: { s: 0.124, dy: -0.015, r: [0.0105, 0.0085, 0.007] },
};

/**
 * Proportions from a base table: k scales everything; legK stretches the legs (the body rises with them), lenK the
 * trunk, girth its width and depth, neckK/neckW the neck's length and thickness, headK/headS/headW the head (size,
 * length, width), earK the ears, legW the legs' thickness, tailK/tailW the tail, pawK the paws.
 */
function morph(base, o) {
  const k = o.k, legK = o.legK ?? 1, lenK = o.lenK ?? 1, girth = o.girth ?? 1, neckK = o.neckK ?? 1, neckW = o.neckW ?? 1;
  const headK = (o.headK ?? 1) * k, headS = o.headS ?? 1, headW = o.headW ?? 1, earK = (o.earK ?? 1) * k, legW = o.legW ?? 1, belly = o.belly;
  const Y = (y) => k * (y >= belly ? y + (legK - 1) * belly : y * legK);
  const Zt = (z) => k * z * lenK;
  const nb = base.trunk[base.neckFrom - 1], nbz = nb[0], nby = nb[2] + 0.45 * (nb[1] - nb[2]);
  const neck = (z, y) => [Zt(nbz) + (z - nbz) * k * neckK, Y(nby) + (y - nby) * k * neckK];
  const out = { neckFrom: base.neckFrom, bones: {}, gait: o.gait, k, headScale: headK };
  out.trunk = base.trunk.map(([z, top, bot, w, wt], i) => {
    // the widest line of a slice lies a little below its middle (the barrel of the ribs)
    const n = i >= base.neckFrom, yc = bot + 0.45 * (top - bot), [zz, yy] = n ? neck(z, yc) : [Zt(z), Y(yc)], g = k * (n ? neckW : girth);
    return { c: V(0, yy, zz), up: (top - yc) * g, dn: (yc - bot) * g, w: w * g, wt, bones: {}, q: [z, yc] };
  });
  for (const [name, [x, y, z]] of Object.entries(base.bones)) {
    if (name === 'neck1' || name === 'neck2' || name === 'head') { const [zz, yy] = neck(z, y); out.bones[name] = [0, yy, zz]; }
    else out.bones[name] = [x, Y(y), Zt(z)];
  }
  const h = o.head || base.head;
  out.head = {
    pitch: h.pitch + (o.headPitch ?? 0),
    st: h.st.map(([s, dy, up, dn, w]) => { const m = 1 + ((o.muzzleK ?? 1) - 1) * sstep(0.035, 0.09, s); return { s: s * headK * headS, dy: dy * headK, up: up * headK * m, dn: dn * headK * m, w: w * headK * headW * m, sb: s }; }),
    eye: { s: h.eye.s * headK * headS, dy: h.eye.dy * headK, r: h.eye.r * headK * (o.eyeK ?? 1), out: h.eye.out || [1, 0.15, 0.35] },
    ear: { ...h.ear, at: [h.ear.at[0] * headK * headW, h.ear.at[1] * headK, h.ear.at[2] * headK * headS], len: h.ear.len * earK, w: h.ear.w.map((v) => v * earK * (o.earW ?? 1)), th: h.ear.th * Math.sqrt(earK * k), cup: h.ear.cup * earK, dir: o.earDir || h.ear.dir },
    nose: h.nose && { s: h.nose.s * headK * headS, dy: h.nose.dy * headK, r: h.nose.r.map((v) => v * headK * (o.noseK ?? 1)) },
  };
  const leg = (rows, dz) => rows.map(([x, y, z, f, b, w, bones]) => {
    const t = Math.min(1, Math.max(0, (y - belly * 0.85) / (belly * 0.3))), sc = k * (legW + (girth - legW) * t);
    return { c: V(x * k * girth, Y(y), k * (z + dz * (lenK - 1))), up: f * sc, dn: b * sc, w: w * sc, bones, q: [y] };
  });
  const joints = (rows, dz) => rows.map(([x, y, z]) => [x * k * girth, Y(y), k * (z + dz * (lenK - 1))]);
  out.front = leg(base.front, o.frontZ); out.hind = leg(base.hind, o.hindZ); out.hindUp = leg(base.hindUp, o.hindZ);
  out.frontJoints = joints(base.frontJoints, o.frontZ); out.hindJoints = joints(base.hindJoints, o.hindZ);
  if (base.paw) out.paw = base.paw.map((v) => v * k * (o.pawK ?? 1));
  if (base.tail) {
    const [rz, ry] = base.tail[0], tk = k * (o.tailK ?? 1), root = [Zt(rz), Y(ry)];
    out.tail = base.tail.map(([z, y, r, bones]) => ({ c: V(0, root[1] + (y - ry) * tk * (o.tailDrop ?? 1), root[0] + (z - rz) * tk), r: r * k * (o.tailW ?? 1), bones }));
    for (const n of ['tail1', 'tail2', 'tail3']) { const [, y, z] = base.bones[n]; out.bones[n] = [0, root[1] + (y - ry) * tk * (o.tailDrop ?? 1), root[0] + (z - rz) * tk]; }
  }
  return out;
}

// ---------------------------------------------------------------- coats ----------------------------------------------
// One colour set per coat; the winter coats (snow) of the deer are greyer and their rump patch is white.
const COATS = {
  roe: { back: '#6e4330', flank: '#9a5d3b', belly: '#c4a68b', throat: '#a8876d', rump: '#ece4d5', forehead: '#5b4334', face: '#7a5a44', eyeRing: '#c6ae92', muzzle: '#33271f', nose: '#121010', lip: '#ebe5da', earBack: '#6d5948', earIn: '#d8cfc2', earRim: '#251e1a', leg: '#9c6440', legLow: '#7e5f4d', hoof: '#1a1715', eye: '#0c0806' },
  roeWinter: { back: '#5c4d42', flank: '#74655a', belly: '#a99b8d', throat: '#8e8074', rump: '#f4f2ee', forehead: '#4c4038', face: '#665649', eyeRing: '#b9ab9b', muzzle: '#2c241f', nose: '#121010', lip: '#ebe7e0', earBack: '#615347', earIn: '#d3ccc2', earRim: '#221c18', leg: '#6c5d51', legLow: '#635449', hoof: '#1a1715', eye: '#0c0806' },
  fawn: { back: '#8f5434', flank: '#a96a45', belly: '#dcbc97', throat: '#c79e76', rump: '#d9c3a5', forehead: '#7d4f33', face: '#9a6644', eyeRing: '#d0b798', muzzle: '#3a2a20', nose: '#121010', lip: '#ece4d6', earBack: '#8a6a52', earIn: '#ddd2c3', earRim: '#2a201b', leg: '#a8693f', legLow: '#8e6a52', hoof: '#221d1a', eye: '#0b0705' },
  stag: { back: '#664432', flank: '#845a42', belly: '#574233', throat: '#523e30', rump: '#d7c08e', border: '#3b2b21', mane: '#4f3a2c', forehead: '#5a4535', face: '#73594a', eyeRing: '#9a8270', muzzle: '#2d241f', nose: '#141210', lip: '#c9bba6', earBack: '#6a5646', earIn: '#cfc4b4', earRim: '#3a2f27', leg: '#674d3a', legLow: '#523f33', hoof: '#1a1715', eye: '#0c0806', antler: '#5b4632', antlerMid: '#7d6851', antlerTip: '#ece5d4' },
  stagWinter: { back: '#5b4d42', flank: '#6f6155', belly: '#463a32', throat: '#43372e', rump: '#e0d0a8', border: '#352a22', mane: '#3f342c', forehead: '#504339', face: '#665649', eyeRing: '#8d7d70', muzzle: '#2a231f', nose: '#141210', lip: '#c5b9a8', earBack: '#5e5147', earIn: '#ccc3b7', earRim: '#352c25', leg: '#52463c', legLow: '#463b33', hoof: '#1a1715', eye: '#0c0806', antler: '#5b4632', antlerMid: '#7d6851', antlerTip: '#ece5d4' },
  fox: { back: '#b2592a', flank: '#c86a2f', belly: '#d9d2c7', chest: '#f1ece4', forehead: '#b05a2b', face: '#c46a33', cheek: '#f2eee6', earBack: '#1d1815', earIn: '#ece2d2', earRim: '#1d1815', leg: '#b7612e', legLow: '#1e1916', paw: '#1a1613', tail: '#be6a35', tailDark: '#5a3824', tailTip: '#f1eee8', iris: '#d5952c', eye: '#0a0705', nose: '#0f0d0c' },
  wolf: { back: '#4c4741', saddle: '#2a2724', flank: '#87827a', belly: '#d6cdbb', chest: '#d8cfbe', forehead: '#5b544b', face: '#827a6e', cheek: '#dcd3c3', earBack: '#6a5743', earIn: '#d6ccbb', earRim: '#2a2520', leg: '#a38e70', legLow: '#ae9c80', paw: '#a59379', tail: '#7d776e', tailDark: '#3e3a35', tailTip: '#211e1b', iris: '#cfa23a', eye: '#0a0705', nose: '#0f0d0c' },
};
const linCoat = (c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, C(v)]));

/** Paint functions of a deer: trunk, head, ear, leg, hoof, eye, tail, antler. */
function deerPaint(K, { spots = false, patch = 1, stag = false } = {}) {
  return {
    trunk({ sa, a, q, cap, s }) {
      const zb = cap ? (s > 0.5 ? 0.5 : -0.6) : q[0];
      let c = mix(K.flank, K.back, sstep(0.5, 0.95, sa));
      c = mix(c, K.belly, sstep(-0.35, -0.85, sa));
      c = mix(c, K.throat, sstep(0.3, 0.42, zb) * sstep(-0.1, -0.7, sa));
      if (K.mane) c = mix(c, K.mane, sstep(0.27, 0.4, zb) * (0.55 + 0.45 * sstep(-0.2, -0.8, sa)));
      // the light patch round the tail; the stag's is framed by darker hair
      if (K.border) c = mix(c, K.border, Math.exp(-(((zb + 0.455) / 0.03) ** 2)) * (1 - sstep(0.75, 0.95, sa)));
      const rump = sstep(-0.47, -0.53, zb) * (1 - 0.7 * sstep(0.6, 0.95, sa)) * patch;
      c = mix(c, K.rump, rump);
      const m = spots ? [a / Math.PI, (zb + 0.48) / 0.74, sstep(-0.12, 0.3, sa) * sstep(-0.5, -0.41, zb) * (1 - sstep(0.2, 0.3, zb))] : null;
      return { c, m };
    },
    head({ sa, ca, q, cap, s }) {
      const f = cap ? (s > 0.5 ? 1 : 0) : (q[0] + 0.04) / 0.242;   // 0 at the back of the head … 1 at the nose
      let c = mix(K.face, K.forehead, sstep(0.3, 0.8, sa) * (1 - sstep(0.42, 0.62, f)));
      const eye = Math.exp(-(((f - 0.365) / 0.1) ** 2) - (((sa - 0.3) / 0.35) ** 2)) * sstep(0.5, 0.9, Math.abs(ca));
      c = mix(c, K.eyeRing, eye * 0.65);
      c = mix(c, K.throat, sstep(-0.6, -0.95, sa) * (1 - sstep(0.4, 0.6, f)));
      c = mix(c, K.muzzle, sstep(0.62, 0.78, f) * sstep(-0.25, 0.3, sa));
      c = mix(c, K.lip, sstep(0.66, 0.78, f) * sstep(-0.3, -0.65, sa));
      if (!stag) c = mix(c, K.lip, sstep(0.74, 0.79, f) * (1 - sstep(0.84, 0.88, f)) * sstep(-0.55, -0.25, sa) * (1 - sstep(0.05, 0.3, sa)) * 0.9);
      const nose = sstep(0.85, 0.89, f) * sstep(-0.4, -0.05, sa);
      c = mix(c, K.nose, nose);
      return { c, g: nose * 0.6 };
    },
    ear({ s, sa, ca }) {
      const rim = Math.abs(ca);
      const c = mix(K.earBack, K.earIn, sstep(-0.1, 0.45, sa) * (1 - sstep(0.7, 0.92, rim)));
      return { c: mix(c, K.earRim, Math.max(sstep(0.86, 0.98, rim) * sstep(0.2, 0.5, s), sstep(0.84, 0.96, s)) * 0.85) };
    },
    leg({ sa, ca, q }, front, side) {
      const yb = q ? q[0] : 0.6;
      let c = mix(K.legLow, K.leg, sstep(0.16, 0.38, yb));
      c = mix(c, K.belly, sstep(0.25, 0.8, -ca * side) * sstep(0.22, 0.4, yb) * 0.55);
      c = mix(c, K.flank, sstep(0.42, 0.55, yb));
      if (!front) c = mix(c, K.rump, sstep(0.4, 0.5, yb) * sstep(-0.35, -0.85, sa) * (1 - sstep(0.62, 0.66, yb)) * 0.85 * patch);
      if (!front && K.border) c = mix(c, K.border, sstep(0.4, 0.5, yb) * sstep(-0.1, -0.4, sa) * (1 - sstep(-0.4, -0.8, sa)) * 0.6);
      return { c };
    },
    hoof: () => ({ c: K.hoof, g: 0.32 }),
    eye: () => ({ c: K.eye, g: 1 }),
    tail: ({ sa, s }) => ({ c: mix(mix(K.rump, K.border || K.back, sstep(-0.2, 0.5, sa)), K.border || K.back, sstep(0.7, 1, s) * 0.5) }),
    antler: ({ s }) => ({ c: mix(mix(K.antler, K.antlerMid, sstep(0.0, 0.5, s)), K.antlerTip, sstep(0.78, 0.97, s)), g: sstep(0.85, 1, s) * 0.25 }),
    tuft: () => ({ c: K.rump }),
  };
}

/** Paint functions of a fox or a wolf. */
function canidPaint(K) {
  return {
    trunk({ sa, q, cap, s }) {
      const zb = cap ? (s > 0.5 ? 0.3 : -0.33) : q[0];
      let c = mix(K.flank, K.back, sstep(0.45, 0.95, sa));
      c = mix(c, K.belly, sstep(-0.3, -0.8, sa));
      c = mix(c, K.chest, sstep(0.1, 0.18, zb) * sstep(-0.05, -0.55, sa));
      if (K.saddle) c = mix(c, K.saddle, sstep(0.2, 0.75, sa) * sstep(-0.34, -0.22, zb) * (1 - sstep(0.18, 0.28, zb)) * 0.85);
      return { c };
    },
    head({ sa, q, cap, s }) {
      const sb = cap ? (s > 0.5 ? 0.135 : -0.035) : q[0];
      let c = mix(K.face, K.forehead, sstep(0.4, 0.9, sa));
      // white cheeks, lips and chin: up to the side line along the muzzle, only the throat further back
      const lim = -0.65 + 0.62 * sstep(-0.01, 0.06, sb);
      c = mix(c, K.cheek, sstep(lim + 0.18, lim - 0.12, sa));
      if (K.saddle) c = mix(c, K.cheek, Math.exp(-(((sb - 0.03) / 0.02) ** 2) - (((sa - 0.45) / 0.3) ** 2)) * 0.6);   // the wolf's pale brows
      return { c };
    },
    ear({ s, sa, ca }) {
      const rim = Math.abs(ca);
      const c = mix(K.earBack, K.earIn, sstep(-0.1, 0.45, sa) * (1 - sstep(0.75, 0.95, rim)) * (1 - sstep(0.8, 0.95, s)));
      return { c: mix(c, K.earRim, sstep(0.85, 0.98, rim) * 0.7) };
    },
    leg({ sa, ca, q }, front, side) {
      const yb = q ? q[0] : 0.3;
      // fox: black stockings, higher up at the front of the foreleg
      const lo = front ? 0.13 + 0.06 * sstep(0, 0.6, sa) : 0.10, hi = lo + 0.06;
      let c = mix(K.legLow, K.leg, sstep(lo, hi, yb));
      c = mix(c, K.belly, sstep(0.3, 0.85, -ca * side) * sstep(0.12, 0.22, yb) * 0.5);
      return { c: mix(c, K.flank, sstep(0.24, 0.3, yb)) };
    },
    paw: ({ sa }) => ({ c: mix(K.paw, C('#191513'), sstep(-0.55, -0.85, sa)) }),
    eye: ({ cz }) => ({ c: cz > 0.6 ? K.eye : cz < 0.15 ? C('#140e0a') : K.iris, g: 1 }),
    nose: () => ({ c: K.nose, g: 0.7 }),
    tail({ sa, s }) {
      let c = mix(K.tail, K.tailDark, sstep(0.3, 0.95, sa) * 0.45 + sstep(0.74, 0.84, s) * 0.55);
      c = mix(c, K.belly, sstep(-0.4, -0.9, sa) * (1 - sstep(0.6, 0.8, s)) * 0.5);
      return { c: mix(c, K.tailTip, sstep(0.84, 0.88, s)) };
    },
  };
}

// ---------------------------------------------------------------- the species --------------------------------------------
// gait: walk and trot [speed m/s, stride m per cycle, stance share of the cycle], the deer's gallop as well (a test
// pose; since 0.7.2 their flight is a brisk trot, wildlife.js FLIGHT);
// graze and alert: neck1, neck2 and head pitch (radians, + is down) relative to the bind pose
const GAIT = {
  roe:  { walk: [1.0, 0.82, 0.62], trot: [2.7, 1.45, 0.42], gallop: [7.5, 2.8, 0.26], graze: [1.2, 0.82, -1.3], alert: [-0.22, -0.1, -0.08] },
  fawn: { walk: [1.0, 0.62, 0.6], trot: [2.7, 1.12, 0.42], gallop: [7.5, 2.1, 0.26], graze: [1.15, 0.78, -1.2], alert: [-0.2, -0.08, -0.12] },
  stag: { walk: [1.25, 1.4, 0.63], trot: [3.1, 2.3, 0.42], gallop: [8.0, 4.0, 0.26], graze: [1.2, 0.84, -1.3], alert: [-0.15, -0.08, -0.05] },
  fox:  { walk: [0.9, 0.52, 0.6], trot: [2.4, 0.95, 0.4], graze: [0.7, 0.5, -0.45], alert: [-0.12, -0.08, -0.1] },
  wolf: { walk: [1.2, 1.0, 0.6], trot: [3.0, 1.75, 0.4], graze: [0.6, 0.45, -0.4], alert: [-0.08, -0.06, -0.05] },
};
const SPECS = {
  roe: () => ({ ...morph(ROE, { k: 1, lenK: 0.93, neckW: 1.1, belly: 0.40, frontZ: 0.24, hindZ: -0.36, gait: GAIT.roe }), paint: deerPaint, coat: 'roe', deer: true, tuft: true }),
  fawn: () => ({ ...morph(ROE, { k: 0.6, legK: 1.13, lenK: 0.9, girth: 0.92, neckK: 0.88, neckW: 0.98, headK: 1.26, headS: 0.9, earK: 1.36, legW: 1.08, eyeK: 1.12, belly: 0.40, frontZ: 0.24, hindZ: -0.36, gait: GAIT.fawn }), paint: deerPaint, coat: 'fawn', deer: true, spots: true }),
  stag: () => ({ ...morph(ROE, { k: 1.72, lenK: 1.06, girth: 1.12, neckK: 1.02, neckW: 1.42, headK: 1.1, headS: 1.18, headW: 0.95, earK: 0.78, legW: 1.06, eyeK: 0.9, headPitch: -0.12, belly: 0.40, frontZ: 0.24, hindZ: -0.36, gait: GAIT.stag }), paint: deerPaint, coat: 'stag', deer: true, antlers: true, deerTail: true }),
  fox: () => ({ ...morph(FOX, { k: 1, legK: 0.88, lenK: 0.92, girth: 1.12, neckK: 0.8, neckW: 1.55, headK: 1.3, earK: 1.02, belly: 0.22, frontZ: 0.16, hindZ: -0.22, gait: GAIT.fox }), paint: canidPaint, coat: 'fox' }),
  wolf: () => ({ ...morph(FOX, { k: 2.05, head: WOLF_HEAD, legK: 1.1, lenK: 0.92, girth: 1.16, neckK: 0.84, neckW: 1.85, headK: 1.2, headS: 0.88, headW: 1.05, earK: 0.78, earW: 1.1, tailK: 0.6, tailW: 0.7, tailDrop: 3.2, pawK: 0.85, legW: 1.15, eyeK: 0.85, noseK: 1.1, belly: 0.22, frontZ: 0.16, hindZ: -0.22, gait: GAIT.wolf }), paint: canidPaint, coat: 'wolf' }),
};

// ---------------------------------------------------------------- assembly ------------------------------------------
const LEGS = ['fL', 'fR', 'hL', 'hR'];
const PARENT = { body: 'root', pelvis: 'body', chest: 'body', neck1: 'chest', neck2: 'neck1', head: 'neck2', earL: 'head', earR: 'head', tail: 'pelvis', tail1: 'pelvis', tail2: 'tail1', tail3: 'tail2' };
/** A point of the head (x across, dy up the face, s along it from the poll) in the bind pose. */
function headPoint(S, x, dy, s) {
  const [, hy, hz] = S.bones.head, a = S.head.pitch, c = Math.cos(a), sn = Math.sin(a);
  return V(x, hy + dy * c - s * sn, hz + dy * sn + s * c);
}
/** How far out the head's surface lies at (s, dy): the eyes sit in it. */
function headSurface(S, s, dy) {
  const st = S.head.st; let i = 0;
  while (i < st.length - 2 && st[i + 1].s < s) i++;
  const a = st[i], b = st[i + 1], t = Math.min(1, Math.max(0, (s - a.s) / (b.s - a.s))), L = (k) => a[k] + (b[k] - a[k]) * t;
  const c = L('dy'), ext = dy > c ? L('up') : L('dn');
  return L('w') * Math.sqrt(Math.max(0, 1 - ((dy - c) / ext) ** 2));
}
function headDir(S, x, y, z) { const a = S.head.pitch, c = Math.cos(a), sn = Math.sin(a); return V(x, y * c - z * sn, y * sn + z * c).normalize(); }
/** Skin weights of the trunk and neck slices, per vertex: along the back from the pelvis to the chest, and by how far
 *  up the neck's axis (from its base to the poll) a vertex lies; the brisket stays with the chest. */
function trunkSkin(S) {
  const b = S.bones, pz = b.pelvis[2], cz = b.chest[2], n1 = V(...b.neck1), D = V(...b.head).sub(n1), L = D.length();
  D.divideScalar(L);
  return (p) => {
    const u = ((p.y - n1.y) * D.y + (p.z - n1.z) * D.z) / L;
    const wn = sstep(0, 0.3, u), a = sstep(0.3, 0.65, u), h = sstep(0.82, 1, u), c = sstep(pz, cz, p.z) * (1 - wn);
    return { pelvis: 1 - wn - c, chest: c, neck1: wn * (1 - a), neck2: wn * a * (1 - h), head: wn * h };
  };
}
const legBones = (spec, leg) => Object.fromEntries(Object.entries(spec).map(([n, w]) => [n.replace(/^([fh])L/, (m, f) => f + leg[1]), w]));

/** The stag's antlers (the left one, in metres from its pedicle): main beam, brow, bez and trez tines, a crown of two. */
const ANTLER = [
  [[0, -0.012, 0, 0.031], [0.004, 0.016, -0.004, 0.036], [0.022, 0.06, -0.016, 0.028], [0.07, 0.17, -0.06, 0.025], [0.13, 0.31, -0.12, 0.022], [0.2, 0.46, -0.17, 0.0195], [0.255, 0.61, -0.18, 0.017], [0.275, 0.75, -0.14, 0.0145], [0.265, 0.86, -0.07, 0.011], [0.25, 0.925, -0.01, 0.007], [0.245, 0.945, 0.012, 0.002]],
  [[0.014, 0.05, -0.01, 0.018], [0.05, 0.08, 0.07, 0.0145], [0.08, 0.115, 0.17, 0.01], [0.093, 0.17, 0.26, 0.0055], [0.095, 0.19, 0.285, 0.0015]],
  [[0.04, 0.12, -0.036, 0.0145], [0.075, 0.145, 0.05, 0.0115], [0.1, 0.185, 0.14, 0.007], [0.106, 0.215, 0.19, 0.0015]],
  [[0.2, 0.46, -0.17, 0.0145], [0.245, 0.49, -0.07, 0.0115], [0.275, 0.535, 0.035, 0.007], [0.282, 0.565, 0.08, 0.0015]],
  [[0.275, 0.74, -0.15, 0.0125], [0.33, 0.83, -0.21, 0.0085], [0.355, 0.9, -0.245, 0.004], [0.36, 0.92, -0.255, 0.0015]],
  [[0.265, 0.70, -0.165, 0.0125], [0.2, 0.8, -0.235, 0.0085], [0.165, 0.865, -0.26, 0.004], [0.158, 0.885, -0.265, 0.0015]],
];
const ANTLER_FROM = [0, 0.18, 0.3, 0.5, 0.75, 0.72];   // where along the beam each tine starts (its colour carries on from there)

const cache = new Map(), specs = new Map();
/** Does this kind have a winter coat of its own (the deer: greyer)? */
const hasWinter = (kind) => !!COATS[kind + 'Winter'];
const coatKey = (kind, winter) => kind + (winter && hasWinter(kind) ? ':w' : '');
/** The geometry (with the bones and spec) of a species and coat, built once. */
function species(kind, winter = false) {
  const key = coatKey(kind, winter);
  if (cache.has(key)) return cache.get(key);
  const it = build(kind, key.endsWith(':w'), key);
  for (let r = it.next(); ; r = it.next()) if (r.done) return r.value;
}
/** The build, a part per step (a step takes a few milliseconds; prepareSpecies() runs one per frame). */
function* build(kind, winter, key) {
  if (!specs.has(kind)) specs.set(kind, SPECS[kind]());
  const S = specs.get(kind), k = S.k;
  const coat = linCoat(COATS[winter ? S.coat + 'Winter' : S.coat]);
  const P = S.paint(coat, { spots: S.spots && !winter, stag: !!S.antlers });
  // --- the skeleton in the bind pose (positions only, no rotations) -------------------------------------------------
  const pos = { root: [0, 0, 0], ...S.bones };
  const E = S.head.ear;
  for (const [n, sd] of [['earL', 1], ['earR', -1]]) pos[n] = headPoint(S, sd * E.at[0], E.at[1], E.at[2]).toArray();
  for (const leg of LEGS) {
    const sd = leg[1] === 'L' ? 1 : -1, joints = leg[0] === 'f' ? S.frontJoints : S.hindJoints;
    joints.forEach(([x, y, z], i) => { pos[leg + i] = [x * sd, y, z]; PARENT[leg + i] = i ? leg + (i - 1) : leg[0] === 'f' ? 'chest' : 'pelvis'; });
  }
  const names = Object.keys(pos), index = Object.fromEntries(names.map((n, i) => [n, i]));
  const defs = names.map((n) => {
    const p = V(...pos[n]), parent = n === 'root' ? -1 : index[PARENT[n]];
    return { name: n, parent, bind: p, local: parent < 0 ? p.clone() : p.clone().sub(V(...pos[names[parent]])) };
  });
  const B = new Build(index);
  // --- trunk and neck, head, eyes, nose, ears ----------------------------------------------------------------------
  loft(B, S.trunk, { seg: 22, spacing: 0.018 * k, paint: P.trunk, caps: [0.75, 0.5], fixed: V(0, 0, 1), skinAt: trunkSkin(S) });
  yield 'trunk';
  const hs = S.head.st.map((r) => ({ c: headPoint(S, 0, r.dy, r.s), up: r.up, dn: r.dn, w: r.w, bones: { head: 1 }, q: [r.sb] }));
  loft(B, hs, { seg: 18, spacing: 0.011 * k, paint: P.head, caps: [0.6, 0.65] });
  const eye = S.head.eye, fwd = headDir(S, 0, 0, 1);
  // the eyes sit in the head: an almond-shaped lens bulges out of it (a whole ball on the side looked like a bead)
  const fwdK = eye.out[2] / Math.hypot(...eye.out), ex = headSurface(S, eye.s, eye.dy) - eye.r * (0.32 - 0.5 * fwdK);   // eyes looking forward sit further out
  for (const sd of [1, -1]) ellipsoid(B, headPoint(S, sd * ex, eye.dy, eye.s), fwd, headDir(S, sd * eye.out[0], eye.out[1], eye.out[2]), [eye.r * 1.25, eye.r * 0.82, eye.r * 0.62], P.eye, { head: 1 }, 12, 6);
  if (S.head.nose) { const n = S.head.nose; ellipsoid(B, headPoint(S, 0, n.dy, n.s), V(1, 0, 0), fwd, n.r, P.nose, { head: 1 }, 10, 6); }
  for (const sd of [1, -1]) {
    const base = headPoint(S, sd * E.at[0], E.at[1], E.at[2]), dir = headDir(S, sd * E.dir[0], E.dir[1], E.dir[2]);
    const f0 = headDir(S, sd * E.open[0], E.open[1], E.open[2]), front = f0.addScaledVector(dir, -f0.dot(dir)).normalize();
    const side = V().crossVectors(front, dir), bone = { [sd > 0 ? 'earL' : 'earR']: 1 }, n = E.w.length;
    const st = E.w.map((w, i) => { const t = i / (n - 1), th = E.th * (1 - 0.45 * t + 1.6 * Math.max(0, 0.2 - t) / 0.2); return { c: base.clone().addScaledVector(dir, (t - 0.06) * E.len), up: th, dn: th, w, bones: bone }; });
    loft(B, st, { seg: 12, spacing: E.len / 12, side, paint: P.ear, caps: [0.3, 0.3], shape: (a, r, x, y, s) => [x, y - E.cup * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.08)), 0.7) * Math.max(0, 1 - (x / r.w) ** 2)] });
  }
  // --- legs with hooves or paws ---------------------------------------------------------------------------------------
  for (const leg of LEGS) {
    yield 'leg';
    const front = leg[0] === 'f', sd = leg[1] === 'L' ? 1 : -1;
    const mirror = (rows) => rows.map((r) => ({ ...r, c: V(r.c.x * sd, r.c.y, r.c.z), bones: legBones(r.bones, leg) }));
    if (!front) loft(B, mirror(S.hindUp), { seg: 16, spacing: 0.018 * k, paint: (i) => P.leg(i, front, sd), caps: [0.6, 0.6] });
    const st = mirror(front ? S.front : S.hind);
    loft(B, st, { seg: 12, spacing: 0.016 * k, paint: (i) => P.leg(i, front, sd), caps: [0.6, 0.4] });
    const last = st[st.length - 1].c, toe = { [leg + 3]: 1 };
    if (S.deer) {
      // a cloven hoof: upright, flat sole, the toe in front with a notch between the two claws
      const hk = k * (S.coat === 'fawn' ? 1.05 : 1);
      const hoof = [[0.034, 0, 0.0135, 0.012, 0.0145], [0.019, 0.002, 0.019, 0.0115, 0.0163], [0.003, 0.004, 0.024, 0.011, 0.017]]
        .map(([y, dz, f, b, w]) => ({ c: V(last.x, y * hk, last.z + dz * hk), up: f * hk, dn: b * hk, w: w * hk, bones: toe }));
      loft(B, hoof, { seg: 14, spacing: 0.008 * hk, paint: P.hoof, caps: [0.3, 0], shape: (a, r, x, y) => [x, y > 0 ? y * (1 - 0.3 * Math.exp(-(((a - Math.PI / 2) / 0.3) ** 2))) : y] });
    } else {
      const R = S.paw;
      ellipsoid(B, V(last.x, R[1] * 0.92, last.z + R[2] * 0.5), V(1, 0, 0), V(0, 0, 1), R, P.paw, toe, 10, 6);
    }
  }
  // --- tail ------------------------------------------------------------------------------------------------------------
  yield 'legs';
  if (S.tail) {
    // a bushy tail: slightly ragged
    const st = S.tail.map((t) => ({ c: t.c, up: t.r, dn: t.r, w: t.r * 0.92, bones: t.bones }));
    loft(B, st, { seg: 14, spacing: 0.02 * k, paint: P.tail, caps: [0.5, 0.9], shape: (a, r, x, y, s) => { const f = 1 + 0.07 * Math.sin(a * 7 + s * 23) * Math.sin(s * Math.PI); return [x * f, y * f]; } });
  } else if (S.deerTail) {
    const [, ty, tz] = S.bones.tail;
    const st = [[0, 0.004, 0.012], [-0.05, -0.012, 0.022], [-0.11, -0.022, 0.02], [-0.155, -0.026, 0.01]].map(([dy, dz, r]) => ({ c: V(0, ty + dy * k / 1.72, tz + dz * k / 1.72), up: r, dn: r * 0.8, w: r * 1.1, bones: { tail: 1 } }));
    loft(B, st, { seg: 10, spacing: 0.02, side: V(1, 0, 0), paint: P.tail, caps: [0.4, 0.8] });
  }
  if (S.tuft) ellipsoid(B, V(0, 0.515 * k, -0.53 * k), V(1, 0, 0), V(0, -1, -0.45), [0.015 * k, 0.011 * k, 0.03 * k], P.tuft, { pelvis: 1 }, 8, 5);
  // --- antlers ---------------------------------------------------------------------------------------------------------
  if (S.antlers) {
    for (const sd of [1, -1]) {
      yield 'antler';
      const ped = headPoint(S, sd * 0.034 * S.headScale, 0.026 * S.headScale, 0.012 * S.headScale);
      ANTLER.forEach((tine, ti) => {
        const pts = tine.map(([x, y, z, r]) => ({ c: ped.clone().add(V(x * sd, y, z)), up: r, dn: r, w: r, bones: { head: 1 } }));
        const T = pts[pts.length - 1].c.clone().sub(pts[0].c).normalize();
        const side = Math.abs(T.y) > 0.9 ? V(1, 0, 0) : V().crossVectors(T, V(0, 1, 0)).normalize();
        const s0 = ANTLER_FROM[ti];
        loft(B, pts, { seg: ti ? 7 : 9, spacing: 0.03, side, paint: (i) => P.antler({ ...i, s: s0 + (1 - s0) * i.s }), caps: [0.3, 0.5],
          shape: ti ? null : (a, r, x, y, s) => { const f = 1 + 0.14 * Math.max(0, 1 - s * 4) * Math.sin(a * 9) * Math.sin(s * 70); return [x * f, y * f]; } });
      });
    }
  }
  yield 'parts';
  const geometry = B.geometry();
  const bs = geometry.boundingSphere;
  // room for every pose: the head down in the grass, the legs swinging out
  const sphere = new THREE.Sphere(bs.center.clone(), bs.radius * 1.12 + 0.08 * k);
  const inverses = defs.map((d) => new THREE.Matrix4().makeTranslation(-d.bind.x, -d.bind.y, -d.bind.z));
  const data = { kind, geometry, defs, inverses, sphere, spec: S, verts: B.n, tris: B.idx.length / 3 };
  cache.set(key, data);
  return data;
}
/** Build the geometry of a species a step at a time: returns a function that does one step and says whether it is done. */
export function prepareSpecies(kind, winter = false) {
  const key = coatKey(kind, winter);
  if (cache.has(key)) return () => true;
  const it = build(kind, key.endsWith(':w'), key);
  const step = () => { if (cache.has(key)) return true; const r = it.next(); step.last = r.done ? 'geometry' : r.value; return !!r.done; };
  return step;
}
/** Every species and coat there is: [kind, winter]. */
export const COAT_LIST = Object.keys(SPECS).flatMap((k) => (hasWinter(k) ? [[k, false], [k, true]] : [[k, false]]));

/**
 * A new animal: a skinned mesh with its own bones on the shared geometry and material.
 * Returns { kind, mesh, bones (by name), legs: [fL, fR, hL, hR] → [bone 0…3], spec }.
 */
export function createAnimal(kind, winter = false) {
  const D = species(kind, winter);
  const bones = D.defs.map((d) => { const b = new THREE.Bone(); b.name = d.name; b.position.copy(d.local); return b; });
  D.defs.forEach((d, i) => { if (d.parent >= 0) bones[d.parent].add(bones[i]); });
  const mesh = new THREE.SkinnedMesh(D.geometry, animalMaterial());
  mesh.add(bones[0]);
  mesh.bind(new THREE.Skeleton(bones, D.inverses), new THREE.Matrix4());
  mesh.boundingSphere = D.sphere.clone();
  mesh.castShadow = false; mesh.receiveShadow = true;
  mesh.userData.noAO = true; mesh.renderOrder = 10; mesh.name = 'wildlife-' + kind;
  const by = Object.fromEntries(bones.map((b) => [b.name, b]));
  for (const b of bones) b.rotation.order = 'YXZ';
  const high = (n) => D.defs.find((d) => d.name === n).bind.y;   // shoulder and hip above the ground
  // the tip of the muzzle in the head bone's frame (the bones carry no rotation in the bind pose)
  const S = D.spec, tip = S.head.st[S.head.st.length - 1], nose = headPoint(S, 0, tip.dy, tip.s).sub(V(...S.bones.head));
  return { kind, mesh, bones: by, legs: LEGS.map((l) => [0, 1, 2, 3].map((i) => by[l + i])), spec: D.spec, bodyY: by.body.position.y, legLen: [high('fL0'), high('hL0')], nose };
}

/** The muzzle's tip in world space as the animal is posed now (after applyPose and an update of its matrices). */
export function muzzlePoint(A, out = new THREE.Vector3()) { return A.bones.head.localToWorld(out.copy(A.nose)); }

// Feeding above the grass (wildlife.js: the hay rack, the trough, the salt lick): a pose between a raised head and the
// grazing one, r from −1.6 (the neck stretched up, alert) through 0 (as it stands) to 1 (the muzzle in the grass)
const reachCache = new Map();
let reachProbe = null;
/** Where the muzzle is in feeding pose r: { y, f }: its height and how far ahead of the animal's middle (unscaled). */
export function muzzleAt(kind, r) {
  const key = kind + ':' + r.toFixed(3);
  if (reachCache.has(key)) return reachCache.get(key);
  if (reachProbe?.kind !== kind) { if (reachProbe) reachProbe.mesh.skeleton.dispose(); reachProbe = createAnimal(kind); }
  const A = reachProbe;
  applyPose(A, { phase: 0, move: 0, trot: 0, stride: 1, graze: Math.max(0, r), alert: Math.max(0, -r), yaw: 0, pitch: 0, tilt: 0, bend: 0, earL: [0, 0, 0], earR: [0, 0, 0], tail: [0, 0], lean: 0, roll: 0, shift: 0 });
  A.mesh.updateMatrixWorld(true);
  const p = muzzlePoint(A), out = { y: p.y, f: p.z };
  reachCache.set(key, out);
  return out;
}
/** The feeding pose that brings the muzzle to height y: { r, f } (f: its reach ahead), or null when it cannot get
 *  there. The muzzle comes lower the further r goes. */
export function reachFor(kind, y) {
  let lo = -1.6, hi = 1;
  if (muzzleAt(kind, lo).y < y - 0.01 || muzzleAt(kind, hi).y > y + 0.01) return null;
  for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (muzzleAt(kind, m).y > y) lo = m; else hi = m; }
  const r = (lo + hi) / 2;
  return { r, f: muzzleAt(kind, r).f };
}

/** A skinned triangle with the shared material and the animals' vertex layout: in the scene from the start, so the
 *  program is compiled with the others (world.js #warmUp), and drawn (it has no area) in the first frames: Direct3D
 *  builds the shader for a vertex layout only when something is drawn with it, which cost the first animal 40 ms. */
export function prewarmMesh() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, -50, 0, 0, -50, 0, 0, -50, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
  g.setAttribute('aFur', new THREE.Float32BufferAttribute(new Array(12).fill(0), 4));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(12).fill(0), 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const bone = new THREE.Bone(), mesh = new THREE.SkinnedMesh(g, animalMaterial());
  mesh.add(bone); mesh.bind(new THREE.Skeleton([bone]), new THREE.Matrix4());
  mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.userData.noAO = true; mesh.name = 'wildlife-prewarm';
  mesh.userData.frames = 0;
  mesh.onAfterRender = () => { if (++mesh.userData.frames >= 4) mesh.visible = false; };
  return mesh;
}

// ---------------------------------------------------------------- posing ---------------------------------------------
// The bounding gallop of a deer (the test pose 'gallop'; the flight of 0.7.2 is a trot and does not reach it): the hind
// feet come down close together and push off into a short stretched leap, the forefeet land one after the other and
// throw the body into the long gathered leap, all four legs tucked under it. Where in the cycle each leg is (fL, fR, hL,
// hR), and over the cycle (keys [phase, value]): how the body rises (in leg lengths), pitches (radians, + nose down:
// down as a pair of feet lands, up as it pushes off, so that the straight legs reach the ground) and how the back bends
// in the air (+1 gathered: the hind legs reach far under the belly, −1 stretched).
const GALLOP_OFFS = [0.58, 0.52, 0, -0.05], GALLOP_SWEEP = 0.6;
const GALLOP_RISE = [[0, -0.19], [0.05, -0.12], [0.12, -0.03], [0.2, -0.012], [0.27, -0.025], [0.36, 0], [0.44, -0.04], [0.5, -0.04], [0.58, -0.018], [0.66, -0.075], [0.73, -0.12], [0.86, 0.04]];
const GALLOP_PITCH = [[0, 0.1], [0.15, 0], [0.3, -0.1], [0.36, -0.04], [0.42, 0.1], [0.56, 0], [0.72, -0.1], [0.86, 0]];
const GALLOP_FLEX = [[0, 0], [0.26, 0], [0.37, -1], [0.42, 0], [0.74, 0], [0.87, 1]];
/** A value over a cycle through keys [[phase, value], …] (the first at phase 0), eased from key to key. */
function cycle(keys, phi) {
  phi -= Math.floor(phi);
  let i = keys.length - 1;
  while (i > 0 && keys[i][0] > phi) i--;
  const [p0, v0] = keys[i], [p1, v1] = keys[i + 1] || [1 + keys[0][0], keys[0][1]];
  return v0 + (v1 - v0) * (0.5 - 0.5 * Math.cos(Math.PI * (phi - p0) / (p1 - p0)));
}
/** Where in the gait cycle each leg is (fL, fR, hL, hR): a lateral walk, at the trot the diagonal pairs together, at
 *  the gallop the hind pair and then the fore pair. */
export const legOffsets = (trot, gallop = 0) => {
  const o = [0.25, 0.75, -0.25 * trot, 0.5 - 0.25 * trot];
  return gallop ? o.map((v, i) => v + (GALLOP_OFFS[i] - v) * gallop) : o;
};
/** Leg cycle at phase φ (0: the foot touches down): [forward −1…1, lift 0…1]. In the stance the foot moves back at a
 *  steady pace, in the swing it comes forward again, folded (`fold` below 0.7 folds it early in the swing, above late). */
function legCycle(phi, duty, fold = 0.7) {
  phi -= Math.floor(phi);
  if (phi < duty) return [1 - 2 * phi / duty, 0];
  const u = (phi - duty) / (1 - duty);
  return [-Math.cos(Math.PI * u), Math.sin(Math.PI * Math.pow(u, fold))];
}
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Pose an animal from its state P: { phase, move (0 standing … 1 moving), trot (0 walk … 1 trot), gallop (0 … 1, a
 * deer in flight), stride (1 = the gait's stride), graze, alert, yaw, pitch (where it looks), bend (the spine,
 * turning), earL, earR ([x, y, z]), tail ([lift, swish]), lean (pitch of the body), roll, shift (weight shift while
 * standing), t (time) }.
 */
export function applyPose(A, P) {
  const S = A.spec, G = S.gait, b = A.bones, deer = !!S.deer;
  const trot = P.trot, gal = G.gallop ? (P.gallop || 0) : 0, gm = gal * P.move;
  const duty = lerp(lerp(G.walk[2], G.trot[2], trot), G.gallop?.[2] ?? 0, gal), stride = lerp(lerp(G.walk[1], G.trot[1], trot), G.gallop?.[1] ?? 0, gal) * (P.stride ?? 1);
  // the legs: the stance sweeps them back by as much as the body moves on; the lower joints fold in the swing (at the
  // gallop the forelegs tuck up early, the hind legs stay stretched back a while after the push)
  const offs = legOffsets(trot, gal);
  let bob = 0;
  for (let i = 0; i < 4; i++) {
    const front = i < 2, L = A.legs[i], hip = A.legLen[front ? 0 : 1];
    // (at the gallop the stance sweeps no further than GALLOP_SWEEP: beyond that a straight leg would leave the ground)
    const sweep = Math.asin(Math.min(0.85, (stride * duty * 0.5) / Math.max(0.1, hip * 0.92)));
    const amp = lerp(sweep, Math.min(sweep, GALLOP_SWEEP), gal) * P.move;
    const [q, lift0] = legCycle(P.phase + offs[i], duty, lerp(0.7, front ? 0.55 : 1.4, gal)), lift = lift0 * P.move * (0.8 + 0.4 * trot + 0.25 * gal);
    const stand = (P.shift || 0) * (i % 2 ? -1 : 1) * 0.06;   // a little weight shift when it stands
    if (front) {
      L[0].rotation.x = -amp * q + stand;
      L[1].rotation.x = -(deer ? 0.32 : 0.45) * lift;
      L[2].rotation.x = (deer ? 1.25 : 1.05) * lift + 0.04 * P.move * Math.max(0, -q);
      L[3].rotation.x = (deer ? 0.65 : 0.5) * lift - 0.1 * P.move * (1 - Math.abs(q)) * (lift0 ? 0 : 1);
    } else {
      L[0].rotation.x = -amp * q - stand;
      L[1].rotation.x = (deer ? 0.45 : 0.45) * lift;
      L[2].rotation.x = -(deer ? 0.75 : 0.7) * lift;
      L[3].rotation.x = (deer ? 0.65 : 0.5) * lift - 0.08 * P.move * (1 - Math.abs(q)) * (lift0 ? 0 : 1);
    }
    bob += lift0 ? 0 : Math.cos(amp * q * 1.6);
  }
  // the body: a gentle rise and fall with the steps, lower when it grazes; at the gallop it flies in a long arc, pitches
  // with the push of the hind legs and the landing on the forelegs, and the back gathers and stretches
  const legLen = A.legLen[0];
  const step = Math.sin((P.phase + 0.12) * Math.PI * 4);
  const pitchG = gm ? gm * cycle(GALLOP_PITCH, P.phase) : 0, flex = gm ? gm * cycle(GALLOP_FLEX, P.phase) : 0;
  b.body.position.y = A.bodyY + P.move * legLen * (0.012 + 0.03 * trot) * step * (1 - gal) + (gm ? gm * legLen * cycle(GALLOP_RISE, P.phase) : 0) + (P.dip || 0);
  b.body.rotation.x = (P.lean || 0) + P.move * 0.012 * Math.sin((P.phase + 0.3) * Math.PI * 4) * (1 - gal) + pitchG;
  b.body.rotation.z = (P.roll || 0) + P.move * (1 - trot) * 0.018 * Math.sin(P.phase * Math.PI * 2);
  b.pelvis.rotation.y = -(P.bend || 0) * 0.5; b.chest.rotation.y = (P.bend || 0) * 0.5;
  b.pelvis.rotation.z = P.move * 0.025 * Math.sin((P.phase + 0.25) * Math.PI * 2);
  b.pelvis.rotation.x = -0.16 * flex; b.chest.rotation.x = 0.1 * flex;
  // neck and head: grazing, alert, looking round; the head nods with the steps of a walk; at the gallop the neck
  // reaches forward and keeps the head steadier than the body
  const g = P.graze || 0, al = P.alert || 0, yaw = P.yaw || 0, nod = P.move * (1 - trot) * 0.045 * Math.sin((P.phase + 0.1) * Math.PI * 4);
  const reach = gm * 0.22 - pitchG * 0.7 - 0.1 * flex;
  b.neck1.rotation.set(g * G.graze[0] + al * G.alert[0] + nod + reach, yaw * 0.32 + (P.bend || 0) * 0.35, 0);
  b.neck2.rotation.set(g * G.graze[1] + al * G.alert[1] - nod * 0.5 - gm * 0.1, yaw * 0.3, 0);
  b.head.rotation.set(g * G.graze[2] + al * G.alert[2] + (P.pitch || 0) - nod * 0.4 - gm * 0.08, yaw * 0.38, P.tilt || 0);
  // ears: forward when alert, flicks, back a little at the trot, more at the gallop
  const eL = P.earL || [0, 0, 0], eR = P.earR || [0, 0, 0], back = trot * P.move * 0.25 + gm * 0.2;
  b.earL.rotation.set(eL[0] + back, eL[1] - al * 0.15, eL[2]);
  b.earR.rotation.set(eR[0] + back, -eR[1] + al * 0.15, -eR[2]);
  // tail
  const [lift, swish] = P.tail || [0, 0];
  if (b.tail1) {
    const sway = P.move * 0.1 * Math.sin(P.phase * Math.PI * 2) + swish;
    b.tail1.rotation.set(lift * 0.6 + 0.1 * trot * P.move, sway * 0.4, 0);
    b.tail2.rotation.set(lift * 0.3, sway * 0.35, 0);
    b.tail3.rotation.set(lift * 0.15, sway * 0.3, 0);
  } else if (b.tail) b.tail.rotation.set(-lift, swish, 0);
  if (P.sit > 0.001) sitPose(A, P.sit);
  return bob;
}
/** Sitting (a fox that watches you, P.sit 0…1): the body tilts up onto the haunches, the forelegs stand straight, the
 *  hind legs fold under it with the hocks on the ground, the tail lies along the ground; the neck keeps the head level. */
const SIT = { pitch: 0.8, drop: 0.36, hind: [-0.11, 1.57, -1.97, 1.32], tail: 1.1, neck: [0.45, 0.25, 0.3] };
function sitPose(A, s) {
  const b = A.bones;
  b.body.rotation.x -= SIT.pitch * s;
  b.body.position.y -= SIT.drop * A.legLen[0] * s;
  for (let i = 0; i < 2; i++) A.legs[i][0].rotation.x += SIT.pitch * s;
  for (let i = 2; i < 4; i++) SIT.hind.forEach((r, j) => { A.legs[i][j].rotation.x += r * s; });
  if (b.tail1) b.tail1.rotation.x += SIT.tail * s;
  b.neck1.rotation.x += SIT.pitch * SIT.neck[0] * s; b.neck2.rotation.x += SIT.pitch * SIT.neck[1] * s; b.head.rotation.x += SIT.pitch * SIT.neck[2] * s;
}
export { LEGS };
