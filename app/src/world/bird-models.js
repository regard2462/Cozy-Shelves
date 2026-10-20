// The birds of the garden (birds.js) and the frogs at the lake (frogs.js), modelled from code. Every species is one
// geometry (two levels of detail) drawn as instances: a few numbers per instance (wings, head, tail, legs) pose it in a
// vertex shader, so dozens of birds cost a handful of draw calls and no skeleton.
//   The wing is a two-part surface. The arm turns at the shoulder: up and down (the beat), back (folding), round its
//   long axis (the twist, and the roll that lays the folded wing against the flank). The hand turns at the wrist: it
//   lags behind the arm (the tip bends up in the downstroke and trails in the upstroke) and folds back over the arm.
//   The head turns at the neck, the tail fans out and tilts at its base, the legs swing at the hip (tucked back in
//   flight, forward for the landing). Frogs use the same rig: their throat swells, their hind legs fold and stretch.
// All creatures share one material and with it one shader program: the garden's kind without the rooms' lamps
// (nature.js), the plumage painted into vertex colours, a fine feather texture, a gloss value per vertex (eyes, beaks,
// the sheen of a crow).
import * as THREE from 'three';
import { seeded } from './geo.js';
import { natureMaterial } from './nature.js';

const TAU = Math.PI * 2;
/** sRGB hex → linear rgb (vertex colours are linear) */
const C = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// ---------------------------------------------------------------- the rig ------------------------------------------
/** Part ids in aRig.x (the shader poses each part on its own). */
export const PART = { body: 0, head: 1, tail: 2, wing: 3, leg: 4, throat: 5, hind: 6 };

/**
 * The pose in the vertex shader. Per vertex: aRig (part, weight, side, gloss), aPivA (xyz the joint: shoulder, neck, tail
 * base, hip), aPivB (the wrist; on a frog's hind leg where the vertex lies when the leg is stretched). Per instance:
 *   aWing  x elevation of the arm (rad, + up), y bend of the hand at the wrist (+ tip up), z sweep of the arm (rad,
 *          + back), w roll of the arm round its long axis (rad, + trailing edge up)
 *   aPose  x head yaw (+ left), y head pitch (+ beak down), z tail spread (rad at the outer feathers), w legs (rad,
 *          + feet forward)
 *   aPose2 x sweep of the hand at the wrist (+ back), y tail tilt (+ up), z the frog's throat (m it swells) or a
 *          bird's other plumage (1: the colour packed into aPivA.w, the hen of a kind drawn in one mesh with the cock),
 *          w how closed the wings
 *          are (0 … 1: blends the posed wing into the folded one, aFold / aFoldN per vertex) or how far a frog's hind
 *          legs are stretched
 * The functions build rotation matrices column by column (GLSL mat3 is column-major).
 */
const RIG_GLSL = `
attribute vec4 aRig; attribute vec4 aPivA; attribute vec3 aPivB; attribute vec3 aFold; attribute vec3 aFoldN;
attribute vec4 aWing; attribute vec4 aPose; attribute vec4 aPose2;
varying float vGloss; varying float vFill;
vec3 rigP; vec3 rigN;
mat3 rigRotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rigRotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rigRotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
// the other plumage of the vertex (aPivA.w: 7 bits a channel, gamma-encoded)
vec3 rigColor2() {
  float c = aPivA.w;
  return pow(vec3(floor(c / 16384.0), mod(floor(c / 128.0), 128.0), mod(c, 128.0)) / 127.0, vec3(2.2));
}
void rigPose(vec3 p, vec3 n) {
  float part = aRig.x, w = aRig.y, side = aRig.z;
  vec3 pivA = aPivA.xyz;
  vGloss = part > 2.5 && part < 3.5 ? 0.0 : aRig.w;
  vFill = part > 1.5 && part < 3.5 ? 1.0 : 0.0;   // wings and tail let some light through
  if (part > 2.5 && part < 3.5) {
    // the wing: first the hand about the wrist (in the plane of the spread wing), then all of it about the shoulder
    mat3 Rh = rigRotZ(side * aWing.y) * rigRotY(side * aPose2.x);
    vec3 ph = aPivB + Rh * (p - aPivB);
    p = mix(p, ph, w); n = normalize(mix(n, Rh * n, w));
    mat3 Ra = rigRotZ(side * aWing.x) * rigRotY(side * aWing.z) * rigRotX(aWing.w);
    p = pivA + Ra * (p - pivA); n = Ra * n;
    // closed: the wing as it lies folded on the flank (aFold, aFoldN: built with the geometry)
    p = mix(p, aFold, aPose2.w); n = normalize(mix(n, aFoldN, aPose2.w));
  } else if (part > 0.5 && part < 1.5) {
    mat3 R = rigRotY(aPose.x) * rigRotX(aPose.y);
    p = pivA + R * (p - pivA); n = R * n;
  } else if (part > 1.5 && part < 2.5) {
    mat3 R = rigRotX(aPose2.y) * rigRotY(-w * aPose.z);
    p = pivA + R * (p - pivA); n = R * n;
  } else if (part > 3.5 && part < 4.5) {
    // tucked legs (swung back) are drawn up into the belly feathers
    mat3 R = rigRotX(-aPose.w);
    float tuck = clamp(-aPose.w - 1.1, 0.0, 1.0);
    p = pivA + R * (p - pivA) * (1.0 - 0.6 * tuck); n = R * n;
  } else if (part > 4.5 && part < 5.5) {
    // the frog's throat swells along its normal
    p += n * aPose2.z * w;
  } else if (part > 5.5 && part < 6.5) {
    // the frog's hind leg: folded at its side, stretched back in a jump (aPivB holds where the vertex lies then, aPose2.w
    // how far); the whole leg swings at the hip (aPose.w)
    p = mix(p, aPivB, aPose2.w);
    mat3 Rt = rigRotX(-aPose.w);
    p = pivA + Rt * (p - pivA); n = Rt * n;
  }
  rigP = p; rigN = n;
}
`;

let featherTex = null, material = null;
/** Rows of small rounded feathers, grey around 0.9: multiplied into the plumage colour. Tileable. */
function featherTexture() {
  if (featherTex) return featherTex;
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), rnd = seeded(117);
  g.fillStyle = '#e4e4e4'; g.fillRect(0, 0, N, N);
  // scallops: each feather a soft disc, darker at its lower rim; drawn at the wrapped positions too
  for (let row = 0; row < 8; row++) for (let k = 0; k < 8; k++) {
    const x = (k + (row % 2) * 0.5) * 16 + (rnd() - 0.5) * 3, y = row * 16 + (rnd() - 0.5) * 3, v = 200 + Math.round(rnd() * 40);
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
      const gr = g.createRadialGradient(x + ox, y + oy - 4, 2, x + ox, y + oy, 11);
      gr.addColorStop(0, `rgba(${v},${v},${v},0.9)`); gr.addColorStop(0.75, `rgba(${v - 25},${v - 25},${v - 25},0.6)`); gr.addColorStop(1, 'rgba(150,150,150,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x + ox, y + oy, 11, 0, TAU); g.fill();
    }
  }
  // fine barbs along v
  for (let i = 0; i < 700; i++) {
    const x = rnd() * N, y = rnd() * N, l = 2 + rnd() * 5, v = Math.round(175 + rnd() * 70);
    g.strokeStyle = `rgba(${v},${v},${v},0.35)`; g.lineWidth = 0.6;
    for (const ox of [-N, 0, N]) { g.beginPath(); g.moveTo(x + ox, y); g.lineTo(x + ox + (rnd() - 0.5), y + l); g.stroke(); }
  }
  featherTex = new THREE.CanvasTexture(c);
  featherTex.wrapS = featherTex.wrapT = THREE.RepeatWrapping; featherTex.colorSpace = THREE.NoColorSpace; featherTex.anisotropy = 4;
  return featherTex;
}

/**
 * The one material of every bird and frog: a garden material without the rooms' lamps (the sky lights from above,
 * the ground from below, the sun, the haze), vertex colours and the feather texture, posed by RIG_GLSL. Snow does not
 * settle on them; eyes, beaks and wet skin shine (vGloss).
 */
export function creatureMaterial() {
  if (material) return material;
  material = natureMaterial('ground', { map: featherTexture(), color: 0xffffff, vertexColors: true, roughness: 0.82, metalness: 0, fog: false }, {
    key: ':creatures',
    vertexPars: RIG_GLSL,
    vertexBody: 'transformed = rigP;',
    fragmentPars: 'varying float vGloss; varying float vFill;',
    snowFragment: `
  cover = 0.0;
  roughnessFactor = mix(roughnessFactor, 0.22, vGloss);
  // thin feathers let the light of the sky and the sun through: a wing seen from below against the sky is not black
  totalEmissiveRadiance += diffuseColor.rgb * (uSkyLight * 0.22 + uSunLight * 0.05) * vFill;`,
    // under the open sky a bird is lit from all round (the light of the sky reaches its belly as well)
    irradianceFragment: 'irradiance = max(irradiance, uSkyLight * 0.42);',
  });
  // the normals must turn with the parts: posed before three transforms them (beginnormal comes before begin_vertex)
  const nature = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    nature(shader, renderer);
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
  rigPose(position, objectNormal);
  objectNormal = rigN;`).replace('#include <color_vertex>', `#include <color_vertex>
  vColor.rgb = mix(vColor.rgb, rigColor2(), step(0.5, aPose2.z));`);
  };
  material.name = 'creatures';
  return material;
}

/** The instanced pose attributes of a creature mesh (aWing, aPose, aPose2), `n` instances: one buffer for the three
 *  (one upload a frame; aWing.data is that buffer). */
export function poseAttributes(geometry, n) {
  const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(n * 12), 12, 1);
  buf.setUsage(THREE.DynamicDrawUsage);
  const out = {};
  ['aWing', 'aPose', 'aPose2'].forEach((name, i) => { const a = new THREE.InterleavedBufferAttribute(buf, 4, i * 4); geometry.setAttribute(name, a); out[name] = a; });
  return out;
}

/** A triangle with the creatures' material and vertex layout, drawn (it has no area) far below the ground for the
 *  first frames after a change of the render path: Direct3D builds the shader for a vertex layout only on the first
 *  draw (wildlife-models.js does the same for the animals). */
export function creaturePrewarm() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, -60, 0, 0, -60, 0, 0, -60, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(9).fill(1), 3));
  g.setAttribute('aRig', new THREE.Float32BufferAttribute(new Array(12).fill(0), 4));
  g.setAttribute('aPivA', new THREE.Float32BufferAttribute(new Array(12).fill(0), 4));
  g.setAttribute('aPivB', new THREE.Float32BufferAttribute(new Array(9).fill(0), 3));
  g.setAttribute('aFold', new THREE.Float32BufferAttribute(new Array(9).fill(0), 3));
  g.setAttribute('aFoldN', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  const mesh = new THREE.InstancedMesh(g, creatureMaterial(), 1);
  poseAttributes(g, 1);
  mesh.setMatrixAt(0, new THREE.Matrix4());
  mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.userData.noAO = true; mesh.name = 'creatures-prewarm';
  mesh.userData.frames = 0;
  mesh.onAfterRender = () => { if (++mesh.userData.frames >= 4) mesh.visible = false; };
  return mesh;
}

// ---------------------------------------------------------------- building ---------------------------------------
/** Collects the vertices of one creature: position, uv, colour and the rig (part, weight, side, gloss; two joints). */
export class Build {
  constructor() { this.pos = []; this.uv = []; this.col = []; this.rig = []; this.pa = []; this.pb = []; this.fp = []; this.fn = []; this.idx = []; this.seams = []; }
  get n() { return this.pos.length / 3; }
  vert(p, u, v, col, rig, pa = ZERO, pb = ZERO, fp = ZERO, fn = UP) {
    this.pos.push(p[0], p[1], p[2]); this.uv.push(u, v); this.col.push(col[0], col[1], col[2]);
    this.rig.push(rig[0], rig[1], rig[2], rig[3]); this.pa.push(pa[0], pa[1], pa[2]); this.pb.push(pb[0], pb[1], pb[2]);
    this.fp.push(fp[0], fp[1], fp[2]); this.fn.push(fn[0], fn[1], fn[2]);
    return this.n - 1;
  }
  quad(a, b, c, d) { this.idx.push(a, b, d, a, d, c); }
  /**
   * A closed tube through `rings` ({ z, y, x, w, h }: the centre, the half width and half height; along +z), `segs`
   * round, the seam under the belly. paint(t, th, p) → { col, rig, pa, pb }: t along (0 … 1), th round from the top
   * (0 … 2π, π/2 is +x). `tile`: metres per repeat of the feather texture.
   */
  loft(rings, segs, paint, tile = 0.03, flip = false) {
    const first = this.n, n = rings.length;
    let along = 0;
    for (let i = 0; i < n; i++) {
      const r = rings[i];
      if (i) along += Math.hypot(r.z - rings[i - 1].z, r.y - rings[i - 1].y);
      for (let k = 0; k <= segs; k++) {
        const th = (k / segs) * TAU + Math.PI;   // the seam at the bottom
        const x = (r.x || 0) + Math.sin(th) * r.w, y = r.y + Math.cos(th) * r.h;
        const p = [x, y, r.z], q = paint(i / (n - 1), th % TAU, p);
        this.vert(p, (k / segs) * TAU * Math.max(r.w, 1e-4) / tile, along / tile, q.col, q.rig, q.pa, q.pb);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < segs; k++) {
      const a = first + i * (segs + 1) + k, b = a + 1, c = a + segs + 1, d = c + 1;
      if (flip) this.quad(a, b, c, d); else this.quad(a, c, b, d);
    }
    for (let i = 0; i < n; i++) this.seams.push([first + i * (segs + 1), first + i * (segs + 1) + segs]);
  }
  /** A grid surface: point(i, j) → [p, u, v, col, rig, pa, pb]; `flip` turns the faces round. */
  grid(ni, nj, point, flip = false) {
    const first = this.n;
    for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) { const q = point(i, j); this.vert(q[0], q[1], q[2], q[3], q[4], q[5], q[6], q[7], q[8]); }
    for (let i = 0; i < ni - 1; i++) for (let j = 0; j < nj - 1; j++) {
      const a = first + i * nj + j, b = a + 1, c = a + nj, d = c + 1;
      if (flip) this.quad(a, c, b, d); else this.quad(a, b, c, d);
    }
    return first;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aRig', new THREE.Float32BufferAttribute(this.rig, 4));
    const pa = new Float32Array(this.pa.length / 3 * 4);   // w: the other plumage (buildBird)
    for (let i = 0, j = 0; i < this.pa.length; i += 3, j += 4) { pa[j] = this.pa[i]; pa[j + 1] = this.pa[i + 1]; pa[j + 2] = this.pa[i + 2]; }
    g.setAttribute('aPivA', new THREE.BufferAttribute(pa, 4));
    g.setAttribute('aPivB', new THREE.Float32BufferAttribute(this.pb, 3));
    g.setAttribute('aFold', new THREE.Float32BufferAttribute(this.fp, 3));
    g.setAttribute('aFoldN', new THREE.Float32BufferAttribute(this.fn, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeVertexNormals();
    // the seam of every loft: both copies get the same normal
    const nr = g.attributes.normal;
    for (const [a, b] of this.seams) {
      const x = nr.getX(a) + nr.getX(b), y = nr.getY(a) + nr.getY(b), z = nr.getZ(a) + nr.getZ(b), l = Math.hypot(x, y, z) || 1;
      nr.setXYZ(a, x / l, y / l, z / l); nr.setXYZ(b, x / l, y / l, z / l);
    }
    g.computeBoundingSphere();
    return g;
  }
}
const ZERO = [0, 0, 0], UP = [0, 1, 0];

// ---------------------------------------------------------------- the species ------------------------------------
/**
 * The shapes (metres): body half length / half width / half height, head radius, beak (length, base radius, hook),
 * wing (span, chord, share of the arm, shape: round, pointed, fingered with `fingers`), tail (length, half width at the
 * tip, shape: square, round, forked with streamers), legs (tarsus length, toe length). `look` names the plumage.
 */
export const SHAPES = {
  sparrow:   { body: [0.043, 0.0215, 0.0255], head: 0.0165, beak: [0.011, 0.0058, 0], wing: { span: 0.23, chord: 0.05, arm: 0.4, shape: 'round', reach: 1.1 }, tail: { len: 0.056, w: 0.017, shape: 'square' }, leg: [0.02, 0.013], upright: 0.42 },
  chaffinch: { body: [0.043, 0.0205, 0.0245], head: 0.016, beak: [0.011, 0.005, 0], wing: { span: 0.26, chord: 0.052, arm: 0.38, shape: 'round', reach: 1.15 }, tail: { len: 0.066, w: 0.018, shape: 'notch' }, leg: [0.019, 0.013], upright: 0.4 },
  greattit:  { body: [0.04, 0.0205, 0.025], head: 0.0165, beak: [0.009, 0.0042, 0], wing: { span: 0.235, chord: 0.05, arm: 0.4, shape: 'round', reach: 1.05 }, tail: { len: 0.062, w: 0.016, shape: 'square' }, leg: [0.019, 0.012], upright: 0.45 },
  bluetit:   { body: [0.033, 0.019, 0.022], head: 0.0148, beak: [0.0066, 0.0036, 0], wing: { span: 0.19, chord: 0.043, arm: 0.4, shape: 'round', reach: 1.05 }, tail: { len: 0.05, w: 0.014, shape: 'square' }, leg: [0.016, 0.011], upright: 0.45 },
  blackbird: { body: [0.066, 0.029, 0.034], head: 0.022, beak: [0.022, 0.0048, 0], wing: { span: 0.37, chord: 0.076, arm: 0.4, shape: 'round', reach: 1.15 }, tail: { len: 0.105, w: 0.026, shape: 'round' }, leg: [0.034, 0.02], upright: 0.5 },
  crow:      { body: [0.11, 0.053, 0.063], head: 0.042, beak: [0.056, 0.012, 0.15], wing: { span: 0.95, chord: 0.2, arm: 0.44, shape: 'fingered', fingers: 5, reach: 1.55 }, tail: { len: 0.18, w: 0.055, shape: 'round' }, leg: [0.062, 0.04], upright: 0.3 },
  jackdaw:   { body: [0.08, 0.04, 0.045], head: 0.031, beak: [0.026, 0.0085, 0.1], wing: { span: 0.7, chord: 0.15, arm: 0.43, shape: 'fingered', fingers: 4, reach: 1.45 }, tail: { len: 0.125, w: 0.04, shape: 'square' }, leg: [0.046, 0.03], upright: 0.32 },
  buzzard:   { body: [0.125, 0.066, 0.075], head: 0.046, beak: [0.032, 0.011, 0.6], wing: { span: 1.2, chord: 0.3, arm: 0.45, shape: 'fingered', fingers: 6, reach: 1.6 }, tail: { len: 0.21, w: 0.09, shape: 'round' }, leg: [0.075, 0.045], upright: 0.75 },
  swallow:   { body: [0.045, 0.018, 0.02], head: 0.015, beak: [0.0058, 0.0042, 0], wing: { span: 0.33, chord: 0.04, arm: 0.3, shape: 'pointed', reach: 1.95 }, tail: { len: 0.04, w: 0.017, shape: 'forked', streamer: 0.055 }, leg: [0.009, 0.008], upright: 0.3 },
  owl:       { body: [0.085, 0.058, 0.068], head: 0.056, beak: [0.02, 0.006, 0.8], wing: { span: 0.9, chord: 0.24, arm: 0.45, shape: 'fingered', fingers: 4, soft: true, reach: 1.7 }, tail: { len: 0.11, w: 0.045, shape: 'round' }, leg: [0.065, 0.032], upright: 0.85, owl: true },
  frog:      { frog: true },
};

/**
 * Plumage: colours of the regions and how they meet. Every look is a function (region, q) → [r, g, b]; q holds where
 * on the part the vertex is (t along, th round, side, u/v on wing and tail, x/y/z) and a noise value.
 */
const LOOKS = {
  // house sparrow, male: grey crown, chestnut from the eye round the nape, pale cheeks, black bib; chestnut back with
  // black streaks, white wing bar
  sparrowM: (r, q) => {
    if (r === 'beak') return C(0x2a2522);
    if (r === 'leg') return C(0xa38270);
    if (r === 'head') {
      const { hx, hy, hz } = q;
      if (hy < -0.3 && hz > -0.05) return C(0x1d1a17);                             // chin and bib
      if (hz > 0.42 && hy > -0.18 && hy < 0.3) return C(0x231f1b);                  // lores, between beak and eye
      if (hy > 0.42 || (hy > 0.2 && hz > 0.3)) return mix(C(0x6f7275), C(0x7f8285), q.n);   // grey crown
      if (hz < 0.25 && hy > -0.3 && hx > 0.3) return mix(C(0x8a552b), C(0x9a6236), q.n);    // chestnut behind the eye
      return mix(C(0xc8c5bc), C(0xbab6ac), q.n);                                     // pale cheek
    }
    if (r === 'body') {
      const top = Math.cos(q.th), side = Math.abs(Math.sin(q.th));
      if (q.t > 0.86 && top < -0.25 && side < 0.6) return C(0x1d1a17);              // the bib on the breast
      if (top > 0.3) {
        if (q.t < 0.25) return C(0x86796a);                                          // grey-brown rump
        return Math.sin(q.th * 11 + q.t * 5 + q.n * 2.5) > 0.5 ? C(0x2c2017) : mix(C(0x8d5c35), C(0xa06c40), q.n);
      }
      return mix(C(0xb3afa6), C(0xd0cbc1), sstep(0.1, -0.85, top));
    }
    if (r === 'wingTop') {
      if (q.primary) return mix(C(0x3e2e22), C(0x5a4330), q.n);
      if (q.u < 0.42 && q.v > 0.24 && q.v < 0.38) return C(0xebe5d6);              // the white wing bar
      if (q.u < 0.42 && q.v <= 0.24) return mix(C(0x8a5530), C(0x9a6036), q.n);    // chestnut coverts
      return mix(C(0x4a3627), C(0x8e6a46), sstep(0.55, 1, q.v) * 0.7);             // dark secondaries, buff edges
    }
    if (r === 'wingBottom') return mix(C(0xa29a8f), C(0x8a8177), q.u);
    if (r === 'tailTop') return C(0x4f3e2f);
    if (r === 'tailBottom') return C(0x7d7266);
    return C(0x8b7d6a);
  },
  // house sparrow, female: plain grey-brown head with a pale buff stripe behind the eye, streaked back, buff below
  sparrowF: (r, q) => {
    if (r === 'beak') return C(0xa39380);
    if (r === 'leg') return C(0xa38270);
    if (r === 'head') {
      const { hx, hy, hz } = q;
      if (hy > 0.12 && hy < 0.4 && hz < 0.25 && hz > -0.55 && hx > 0.35) return C(0xcdbb96);   // the pale eyebrow
      if (hy < -0.3 && hz > 0) return C(0xcbbfa8);
      return hy > 0.35 ? C(0x7f6f5c) : C(0x9a8a74);
    }
    if (r === 'body') {
      const top = Math.cos(q.th);
      if (top > 0.3) return Math.sin(q.th * 11 + q.t * 5 + q.n * 2.5) > 0.5 ? C(0x3a2a1c) : mix(C(0x96764f), C(0xa7875f), q.n);
      return mix(C(0xbcae96), C(0xd2c8b4), sstep(0.1, -0.85, top));
    }
    if (r === 'wingTop') {
      if (q.primary) return mix(C(0x4a3828), C(0x5f4a36), q.n);
      if (q.u < 0.42 && q.v > 0.24 && q.v < 0.36) return C(0xd8ceb8);
      return mix(C(0x5a4532), C(0x8e7051), sstep(0.5, 1, q.v) * 0.7);
    }
    if (r === 'wingBottom') return C(0xa39889);
    if (r === 'tailTop') return C(0x5c4a37);
    if (r === 'tailBottom') return C(0x8a7d6c);
    return C(0x9a8a74);
  },
  // chaffinch, male: blue-grey cap and nape, a black band over the beak, rosy face and breast, chestnut back, green
  // rump, black wings with a white shoulder and a white bar, white outer tail feathers
  chaffinchM: (r, q) => {
    if (r === 'beak') return C(0x8693a0);
    if (r === 'leg') return C(0x8f7a70);
    if (r === 'head') {
      const { hy, hz } = q;
      if (hz > 0.52 && hy > 0.05 && hy < 0.45) return C(0x1c1c1e);                  // black forehead band
      if (hy > 0.32 || hz < -0.35) return mix(C(0x5d6d84), C(0x6b7b90), q.n);        // blue-grey cap and nape
      return mix(C(0xa9654e), C(0xb7765c), q.n);                                     // rosy face
    }
    if (r === 'body') {
      const top = Math.cos(q.th);
      if (top > 0.35) return q.t < 0.22 ? C(0x7c8a47) : q.t > 0.85 ? C(0x63728a) : mix(C(0x77553d), C(0x845f45), q.n);
      return mix(C(0xb06e57), C(0xdcc8bc), sstep(0.55, 0.1, q.t) * sstep(0.0, -0.8, top) + sstep(0.35, 0.0, q.t) * 0.5);
    }
    if (r === 'wingTop') {
      if (q.primary) return q.v > 0.85 ? C(0xc9b65a) : C(0x221f1d);                 // black, yellowish edges
      if (q.u < 0.42 && q.v < 0.2) return C(0xeeeae0);                              // the white shoulder
      if (q.u < 0.42 && q.v > 0.3 && q.v < 0.44) return C(0xf0ece2);                // the wing bar
      return C(0x221f1d);
    }
    if (r === 'wingBottom') return C(0x9c9690);
    if (r === 'tailTop') return Math.abs(q.w) > 0.75 ? C(0xeeeae2) : C(0x2b2724);
    if (r === 'tailBottom') return Math.abs(q.w) > 0.7 ? C(0xf0ede6) : C(0x5a5450);
    return C(0x8e8a72);
  },
  // chaffinch, female: olive-grey above, paler below, the same white bars
  chaffinchF: (r, q) => {
    if (r === 'beak') return C(0x98a0a6);
    if (r === 'leg') return C(0x8f7a70);
    if (r === 'head') return q.hy > 0.3 || q.hz < -0.3 ? C(0x7e7c66) : C(0xa49c84);
    if (r === 'body') { const top = Math.cos(q.th); return top > 0.35 ? (q.t < 0.22 ? C(0x86904f) : C(0x847e64)) : mix(C(0xb3aa92), C(0xd2ccba), sstep(0.0, -0.8, top)); }
    if (r === 'wingTop') {
      if (q.primary) return C(0x3a3630);
      if (q.u < 0.42 && q.v < 0.2) return C(0xe2ddd0);
      if (q.u < 0.42 && q.v > 0.3 && q.v < 0.44) return C(0xe6e1d4);
      return C(0x3a3630);
    }
    if (r === 'wingBottom') return C(0xa29c94);
    if (r === 'tailTop') return Math.abs(q.w) > 0.75 ? C(0xe8e4dc) : C(0x3d3934);
    if (r === 'tailBottom') return C(0x77716a);
    return C(0x8e8a72);
  },
  // great tit: glossy black head with white cheeks and a white spot on the nape, yellow underparts with a black stripe,
  // green back, blue-grey wings with a white bar
  greattit: (r, q) => {
    if (r === 'beak') return C(0x161616);
    if (r === 'leg') return C(0x6a7480);
    if (r === 'head') {
      const { hx, hy, hz } = q;
      if (hx > 0.42 && hy < 0.2 && hy > -0.52 && hz > -0.4 && hz < 0.58) return C(0xf2f0e8);   // white cheek
      if (hz < -0.55 && hy > 0.1 && hx < 0.35) return C(0xe8e6de);                  // the white spot on the nape
      return mix(C(0x121313), C(0x1d1f22), q.n);
    }
    if (r === 'body') {
      const top = Math.cos(q.th), side = Math.abs(Math.sin(q.th));
      if (top < -0.15 && side < 0.3 && q.t > 0.12) return C(0x161616);             // the black stripe down the belly
      if (q.t > 0.85 && top < 0.2) return C(0x161616);                              // the bib
      if (top > 0.42) return q.t < 0.2 ? C(0x6c7d93) : mix(C(0x6f8346), C(0x7b8f4f), q.n);
      return mix(C(0xe2c541), C(0xd9bc3c), q.n);
    }
    if (r === 'wingTop') {
      if (q.primary) return q.v > 0.85 ? C(0xcfd3d6) : C(0x4f5e72);
      if (q.u < 0.42 && q.v > 0.24 && q.v < 0.36) return C(0xf0eee6);
      if (q.v > 0.75) return C(0xd6d8cc);
      return C(0x5c6b80);
    }
    if (r === 'wingBottom') return C(0x9aa0a6);
    if (r === 'tailTop') return Math.abs(q.w) > 0.8 ? C(0xe6e6e0) : C(0x55667c);
    if (r === 'tailBottom') return Math.abs(q.w) > 0.7 ? C(0xeeeeea) : C(0x707a86);
    return C(0x6f8346);
  },
  // blue tit: blue cap, white face with a dark line through the eye and a dark collar, yellow below, green back, blue
  // wings and tail
  bluetit: (r, q) => {
    if (r === 'beak') return C(0x1c1c1c);
    if (r === 'leg') return C(0x6e7a8c);
    if (r === 'head') {
      const { hx, hy, hz } = q;
      if (hy > 0.48 && hz < 0.5) return C(0x3f7fc6);                                // the blue cap
      if (hx > 0.3 && Math.abs(hy - 0.18 + hz * 0.1) < 0.11) return C(0x1d2742);     // the dark line through the eye
      if (hy < -0.5 || (hy < -0.3 && hz > 0.3)) return C(0x1d2742);                 // collar and chin
      if (hz < -0.45) return C(0x2c4f86);                                            // blue nape
      return C(0xf4f3ee);                                                            // white face
    }
    if (r === 'body') {
      const top = Math.cos(q.th);
      if (top > 0.45) return q.t > 0.82 ? C(0x2e4a7a) : mix(C(0x86984c), C(0x92a256), q.n);
      if (q.t > 0.88 && top < -0.3) return C(0x1d2742);
      return mix(C(0xdcc94e), C(0xe6d45f), q.n);
    }
    if (r === 'wingTop') {
      if (q.primary) return C(0x3d64a0);
      if (q.u < 0.42 && q.v > 0.24 && q.v < 0.34) return C(0xf0f0ea);
      return q.u < 0.42 && q.v < 0.24 ? C(0x4a86cc) : C(0x4472b4);
    }
    if (r === 'wingBottom') return C(0xa2a8b0);
    if (r === 'tailTop') return C(0x4673b5);
    if (r === 'tailBottom') return C(0x7a8698);
    return C(0x86984c);
  },
  // blackbird, male: black all over, an orange-yellow beak and eye ring
  blackbirdM: (r, q) => {
    if (r === 'beak') return C(0xf0a21e);
    if (r === 'leg') return C(0x3a2e26);
    return mix(C(0x2c2926), C(0x37332f), q.n);
  },
  // blackbird, female: dark brown, the throat paler and the breast mottled
  blackbirdF: (r, q) => {
    if (r === 'beak') return C(0x9a7c45);
    if (r === 'leg') return C(0x4a3a2e);
    if (r === 'head') return q.hy < -0.3 && q.hz > 0 ? C(0x7a6552) : C(0x4c3a2b);
    if (r === 'body') { const top = Math.cos(q.th); if (top < -0.1 && q.t > 0.55) return Math.sin(q.th * 7 + q.t * 9) > 0.4 ? C(0x6f5a46) : C(0x4f3d2e); return mix(C(0x48382a), C(0x553f2f), q.n); }
    if (r === 'wingBottom' || r === 'tailBottom') return C(0x56463a);
    return mix(C(0x43342a), C(0x4c3b2e), q.n);
  },
  crow: (r, q) => {
    if (r === 'leg' || r === 'beak') return C(0x161616);
    return mix(C(0x26262b), C(0x303036), q.n);
  },
  // jackdaw: black cap and face, silver-grey nape and sides of the neck, dark grey body, a pale eye
  jackdaw: (r, q) => {
    if (r === 'leg' || r === 'beak') return C(0x141414);
    if (r === 'head') { const { hy, hz } = q; return (hy > 0.38 && hz > -0.25) || hz > 0.5 || (hy < -0.35 && hz > 0.1) ? C(0x1f1f22) : mix(C(0x8b9095), C(0x9da2a7), q.n); }
    if (r === 'body') return q.t > 0.8 && Math.cos(q.th) > -0.2 ? C(0x767a80) : mix(C(0x303136), C(0x3a3b40), q.n);
    if (r === 'wingBottom') return C(0x34353a);
    return mix(C(0x232327), C(0x2d2d32), q.n);
  },
  // common buzzard: dark brown above; below a dark breast, a pale band, barred brown belly; pale underwings with dark
  // wrist patches, dark tips and trailing edge; a barred tail; yellow feet
  buzzard: (r, q) => {
    if (r === 'leg') return C(0xd9b53c);
    if (r === 'beak') return q.t < 0.25 ? C(0xd9b53c) : C(0x2c2a28);
    if (r === 'head') return q.hy > -0.2 ? C(0x4e3a29) : mix(C(0x5c4532), C(0xb59e80), q.n * 0.8);
    if (r === 'body') {
      const top = Math.cos(q.th);
      if (top > 0.2) return mix(C(0x4f3a28), C(0x5f4631), q.n);
      if (q.t > 0.55 && q.t < 0.68) return C(0xdccbb0);
      return q.t > 0.68 ? mix(C(0x6a4e36), C(0x8a6c4f), q.n) : Math.sin(q.t * 40 + q.n * 3) > 0.3 ? C(0x7a5c40) : C(0xc4b090);
    }
    if (r === 'wingTop') return mix(C(0x4a3626), C(0x5c4532), q.n).map((c) => c * (q.u > 0.8 ? 0.72 : 1));
    if (r === 'wingBottom') {
      if (q.u > 0.42 && q.u < 0.55 && q.v < 0.5 && !q.primary) return C(0x3a281c);   // dark carpal patch
      if ((q.primary && q.v > 0.88) || (!q.primary && q.v > 0.9)) return C(0x2e2620);  // dark tips and trailing edge
      return Math.sin(q.u * 60) > 0.6 && q.v > 0.45 ? C(0x9a8c7a) : mix(C(0xe2d8c8), C(0xcbbba2), q.n);
    }
    if (r === 'tailTop') return Math.sin(q.l * 26) > 0.55 ? C(0x3e3024) : C(0x7a6a58);
    if (r === 'tailBottom') return Math.sin(q.l * 26) > 0.55 ? C(0x6a5c4c) : C(0xcfc3b2);
    return C(0x5c4532);
  },
  // barn swallow: glossy steel-blue above, a brick-red forehead and throat, a dark breast band, cream below
  swallow: (r, q) => {
    if (r === 'leg' || r === 'beak') return C(0x1a1a1c);
    if (r === 'head') { const { hy, hz } = q; if (hz > 0.55 && hy > -0.1 && hy < 0.35) return C(0x9c3a26); if (hy < -0.25 && hz > -0.1) return C(0x9c3a26); return mix(C(0x1b2647), C(0x23305a), q.n); }
    if (r === 'body') {
      const top = Math.cos(q.th);
      if (top > 0.1) return mix(C(0x1a2443), C(0x24315c), q.n);
      if (q.t > 0.8) return C(0x1e2846);
      return mix(C(0xebe0cb), C(0xf2ead9), q.n);
    }
    if (r === 'wingTop') return mix(C(0x151c33), C(0x1b2440), q.n);
    if (r === 'wingBottom') return q.u < 0.35 && !q.primary ? C(0xd9cfbe) : C(0x3b4050);
    if (r === 'tailTop') return C(0x161d35);
    if (r === 'tailBottom') return Math.abs(q.w) < 0.75 && q.l > 0.55 && q.l < 0.75 ? C(0xe8e2d6) : C(0x2a3044);
    return C(0x1b2647);
  },
  // barn owl: golden buff above with grey veils and fine spots, white below and under the wings, a white heart-shaped
  // face with a buff rim, black eyes
  owl: (r, q) => {
    if (r === 'leg') return C(0xe8e2d6);
    if (r === 'beak') return C(0xd6c4a8);
    if (r === 'head') {
      if (q.face > 0.25) return q.face < 0.42 ? C(0xc89a62) : mix(C(0xf4f0e8), C(0xe8dccb), q.n * 0.5);
      return mix(C(0xc69a62), C(0xa59a8c), Math.sin(q.th * 6 + q.t * 7 + q.n * 3) > 0.5 ? 0.6 : 0);
    }
    if (r === 'body') { const top = Math.cos(q.th); return top > 0.25 ? mix(C(0xc89f68), C(0x9f978c), Math.sin(q.th * 8 + q.t * 10 + q.n * 3) > 0.45 ? 0.7 : 0) : mix(C(0xf4f1ea), C(0xefe6d6), q.n); }
    if (r === 'wingTop') return mix(C(0xc89c62), C(0x9e958a), Math.sin(q.u * 30 + q.v * 6) > 0.4 ? 0.7 : 0.1);
    if (r === 'wingBottom') return mix(C(0xf6f3ec), C(0xe7dfd0), q.n);
    if (r === 'tailTop') return Math.sin(q.l * 18) > 0.6 ? C(0x8e8272) : C(0xc59a64);
    if (r === 'tailBottom') return C(0xf1ece2);
    return C(0xc89f68);
  },
};

/** How a beak tapers (the power of 1 - t): the seed-eaters' cones and the crows' beaks stay thick to near the tip. */
const BEAK_TAPER = { sparrow: 0.55, chaffinch: 0.62, greattit: 0.75, bluetit: 0.7, blackbird: 0.85, crow: 0.58, jackdaw: 0.6, buzzard: 0.6, swallow: 0.9, owl: 0.65 };
/** A sheen on the plumage (0 … 1): black birds shine a little, a swallow's back is glossy steel blue. */
const SHEEN = { blackbirdM: 0.45, blackbirdF: 0.12, crow: 0.55, jackdaw: 0.35, swallow: 0.45, greattit: 0.1 };
/** Eyes that are not dark, and a coloured ring round the eye. */
const EYE_COL = { jackdaw: 0xdfe4e6, owl: 0x0b0a0a };
const RING_COL = { blackbirdM: 0xf0b030 };

/** The kinds of bird there are: a shape and a plumage. */
export const KINDS = {
  sparrowM: 'sparrow', sparrowF: 'sparrow', chaffinchM: 'chaffinch', chaffinchF: 'chaffinch', greattit: 'greattit', bluetit: 'bluetit',
  blackbirdM: 'blackbird', blackbirdF: 'blackbird', crow: 'crow', jackdaw: 'jackdaw', buzzard: 'buzzard', swallow: 'swallow', owl: 'owl',
};

/**
 * The joints of a shape in its own frame (+z forward, +y up, +x left; the origin in the middle of the body): the
 * shoulder (left side), the wrist, the neck, the tail base, the hip (left), the foot below it, and the point the bird
 * stands on (between the feet). The pose code (birds.js) and the geometry use the same numbers.
 */
export function joints(shapeName) {
  const S = SHAPES[shapeName];
  if (S.frog) return frogJoints();
  const [bl, bw, bh] = S.body, W = S.wing, R = S.head;
  const shoulder = [bw * 0.62, bh * 0.38, bl * 0.28];
  const half = W.span / 2 - shoulder[0];
  const wrist = [shoulder[0] + half * W.arm, shoulder[1], shoulder[2] + W.chord * 0.12];
  const neck = S.owl ? [0, bh * 0.6, bl * 0.42] : [0, bh * 0.45, bl * 0.72];
  const head = S.owl ? [0, neck[1] + R * 0.6, neck[2] + R * 0.18] : [0, bh * 0.45 + R * 0.62, bl * 0.72 + R * 0.62];
  const tail = [0, bh * 0.22, -bl * 0.9];
  const hip = [bw * 0.32, -bh * 0.45, -bl * 0.08];
  const foot = [hip[0], -bh * 0.62 - S.leg[0], hip[2] + S.leg[1] * 0.15];
  return { shoulder, wrist, half, neck, head, tail, hip, foot, stand: [0, foot[1], foot[2]] };
}

/**
 * The geometry of one bird kind at a level of detail (0 near, 1 far): the body, the head with beak and eyes, both
 * wings, the tail and the legs, painted with the kind's plumage.
 */
export function buildBird(kind, lod = 0, alt = null) {
  const shapeName = KINDS[kind], S = SHAPES[shapeName], look = LOOKS[kind];
  const J = joints(shapeName), [bl, bw, bh] = S.body, R = S.head;
  const b = new Build(), rnd = seeded(kind.length * 977 + lod), noise = () => rnd();
  const tile = Math.max(0.012, bw * 0.55);
  const seg = lod ? 8 : 14;
  const sheen = SHEEN[kind] || 0, BODY = [PART.body, 0, 0, sheen];
  // --- body: tail base … breast … neck, fuller in front
  const prof = [[-1.0, 0.18, 0.2, 0.2], [-0.86, 0.5, 0.48, 0.12], [-0.6, 0.82, 0.8, 0.04], [-0.3, 0.97, 0.96, 0.0], [0.0, 1.0, 1.0, 0.0], [0.3, 0.97, 0.98, 0.04], [0.55, 0.86, 0.9, 0.1], [0.75, 0.66, 0.7, 0.2], [0.9, 0.42, 0.46, 0.32], [1.0, 0.1, 0.12, 0.4]];
  const bodyRings = (lod ? prof.filter((_, i) => i % 2 === 0 || i === prof.length - 1) : prof).map(([z, w, h, y]) => ({ z: z * bl, w: w * bw, h: h * bh, y: y * bh }));
  b.loft(bodyRings, seg, (t, th) => ({ col: look('body', { t, th, n: noise() * 0.5 }), rig: BODY }), tile);
  const bodyAt = ringsOf(prof.map(([z, w, h, y]) => ({ z: z * bl, w: w * bw, h: h * bh, y: y * bh })));
  // --- head: a rounded loft from the back of the head to the face, the beak, eyes (part head: turns at the neck)
  const HC = J.head, HR = [PART.head, 1, 0, sheen];
  const owl = !!S.owl;
  const hprof = owl
    ? [[-1.0, 0.05], [-0.8, 0.7], [-0.45, 0.97], [-0.05, 1.0], [0.3, 0.9], [0.5, 0.72], [0.56, 0.4], [0.575, 0.0]]
    : [[-1.0, 0.05], [-0.78, 0.66], [-0.42, 0.95], [0.0, 1.0], [0.38, 0.86], [0.66, 0.6], [0.8, 0.36], [0.86, 0.0]];
  const headRings = (lod ? hprof.filter((_, i) => i !== 2) : hprof).map(([z, r]) => ({ z: HC[2] + z * R, y: HC[1] + (owl ? 0 : -0.06 * R * Math.max(0, z)), w: r * R * (owl ? 1.04 : 0.94), h: r * R * (owl ? 0.98 : 1.0) }));
  const eyeY = HC[1] + R * (owl ? 0.05 : 0.2), eyeZ = HC[2] + R * (owl ? 0.5 : 0.32);
  b.loft(headRings, seg, (t, th, p) => {
    const below = Math.max(0, -Math.cos(th));
    // distance to the band through the eye (0 on it)
    const eyeBand = Math.abs(p[1] - eyeY) / R;
    const face = owl ? Math.max(0, (p[2] - HC[2]) / R) * (1 - 0.5 * Math.abs(Math.sin(th)) * Math.max(0, Math.cos(th))) * 1.6 : 0;
    // where on the head, in head radii from its centre: hx to the side, hy up, hz forward
    const hx = Math.abs(p[0]) / R, hy = (p[1] - HC[1]) / R, hz = (p[2] - HC[2]) / R;
    return { col: look('head', { t, th, below, eyeBand, face, hx, hy, hz, n: noise() * 0.5 }), rig: HR, pa: J.neck };
  }, tile);
  // the beak: from inside the face to its tip, a hook bends the tip down
  {
    const [len, r0, hook] = S.beak;
    const z0 = HC[2] + R * (owl ? 0.4 : 0.6), y0 = HC[1] - R * (owl ? 0.18 : 0.12);
    const n = lod ? 3 : 5, rings = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, r = r0 * Math.pow(1 - t, BEAK_TAPER[shapeName] || 0.8) + 1e-4;
      rings.push({ z: z0 + len * t * (1 - hook * 0.25 * t), y: y0 - hook * len * 0.45 * t * t, w: r * (owl ? 0.7 : 0.82), h: r });
    }
    b.loft(rings, lod ? 5 : 8, (t) => ({ col: look('beak', { t }), rig: [PART.head, 1, 0, 0.6], pa: J.neck }), 0.01);
  }
  // eyes: small glossy domes on the sides of the head (an owl's look forward from the face)
  if (!lod || R > 0.03) {
    for (const s of [1, -1]) {
      const er = R * (owl ? 0.17 : 0.2), dir = owl ? [s * 0.25, 0, 1] : [s, 0.05, 0.25];
      const dl = Math.hypot(...dir), d = dir.map((x) => x / dl);
      const ez = owl ? HC[2] + R * 0.5 : eyeZ, ex = s * R * (owl ? 0.36 : 0.8);
      const ring = RING_COL[kind] ? C(RING_COL[kind]) : null, eyeColor = C(EYE_COL[kind] || 0x0c0a09);
      // a pale eye (the jackdaw's) has a dark pupil in its middle
      const pupil = Math.max(...eyeColor) > 0.3 ? C(0x0c0a09) : null;
      const sd = lod ? 5 : 7;
      b.grid(sd, sd + 1, (i, j) => {
        const lat = (i / (sd - 1)) * Math.PI * 0.55, lon = (j / sd) * TAU;
        // a dome around d
        const up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
        const ax = [d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]], al = Math.hypot(...ax);
        const a1 = ax.map((x) => x / al), a2 = [d[1] * a1[2] - d[2] * a1[1], d[2] * a1[0] - d[0] * a1[2], d[0] * a1[1] - d[1] * a1[0]];
        const cs = Math.cos(lat), sn = Math.sin(lat);
        const v = [0, 1, 2].map((k) => d[k] * cs + (a1[k] * Math.cos(lon) + a2[k] * Math.sin(lon)) * sn);
        const p = [ex + v[0] * er * 0.9 - d[0] * er * 0.45, eyeY + v[1] * er, ez + v[2] * er - d[2] * er * 0.45];
        const col = ring && i === sd - 1 ? ring : pupil && i <= 1 ? pupil : eyeColor;
        return [p, j / sd, i / sd, col, [PART.head, 1, 0, 1], J.neck, ZERO];
      }, true);
    }
  }
  // --- wings
  for (const s of [1, -1]) wing(b, S, J, look, s, lod, noise, bodyAt);
  // --- tail
  tail(b, S, J, look, lod, noise, sheen);
  // --- legs: a tarsus and four toes each (only near: far away they are hidden by the body)
  if (!lod) for (const s of [1, -1]) legs(b, S, J, look, s);
  const g = b.geometry();
  g.userData.kind = kind; g.userData.lod = lod;
  // a second kind of the same shape (the hen): its plumage packed into aPivA.w and the sheen between the two, so one
  // mesh draws both (paired: the shapes came out the same, vertex for vertex)
  if (alt) {
    const o = buildBird(alt, lod), pa = g.attributes.position.array, pb = o.attributes.position.array;
    if (pa.length === pb.length && pa.every((v, i) => Math.abs(v - pb[i]) < 1e-6)) {
      const cb = o.attributes.color.array, piv = g.attributes.aPivA.array;
      const enc = (x) => Math.round(127 * Math.pow(Math.min(1, Math.max(0, x)), 1 / 2.2));
      for (let i = 0; i < cb.length / 3; i++) piv[i * 4 + 3] = enc(cb[i * 3]) * 16384 + enc(cb[i * 3 + 1]) * 128 + enc(cb[i * 3 + 2]);
      const ra = g.attributes.aRig.array, rb = o.attributes.aRig.array;
      for (let i = 3; i < ra.length; i += 4) ra[i] = (ra[i] + rb[i]) / 2;
      g.userData.paired = alt;
    }
    o.dispose();
  }
  return g;
}

/** The body's cross-section at z: { w, h, y } between the rings of its loft (the end rings beyond them). */
function ringsOf(rings) {
  return (z) => {
    if (z <= rings[0].z) return rings[0];
    for (let i = 1; i < rings.length; i++) {
      const a = rings[i - 1], c = rings[i];
      if (z <= c.z) { const t = (z - a.z) / (c.z - a.z); return { w: a.w + (c.w - a.w) * t, h: a.h + (c.h - a.h) * t, y: a.y + (c.y - a.y) * t }; }
    }
    return rings[rings.length - 1];
  };
}
/**
 * Where a feather lies when the wing is closed: on the flank of the body (side s), F from the bend of the wing in front
 * (0) back to the tips of the primaries over the rump (1), H from the back line (0) down to the lower edge (1), `layer`
 * how far out (the coverts outside, the primaries under the secondaries). Returns [position, normal].
 */
function folder(S, J, bodyAt, s) {
  const [bl, bw] = S.body, zF = J.shoulder[2] + bl * 0.34, zB = -bl * (S.wing.reach || 1.1), zEnd = -bl * 0.84;
  return (F, H, layer, top) => {
    F = clamp01(F); H = clamp01(H);
    const z = zF + (zB - zF) * F, r = bodyAt(Math.max(z, zEnd));
    // past the end of the body the tips lie over the rump and the base of the tail, closing in on the midline
    const past = clamp01((zEnd - z) / (bl * 0.7));
    const w = r.w * (1 - 0.5 * past), h = r.h * (1 - 0.35 * past);
    const thTop = 0.5 - 0.3 * past, thBot = 1.5 + (0.62 - 1.5) * Math.pow(F, 1.25);
    const th = thTop + (thBot - thTop) * H, sn = Math.sin(th), cs = Math.cos(th);
    let nx = sn / w, ny = cs / h; const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
    const off = bw * (0.05 + 0.04 * layer);
    return [[s * (w * sn + nx * off), r.y + h * cs + ny * off, z], top ? [s * nx, ny, 0] : [-s * nx, -ny, 0]];
  };
}

/**
 * One wing (side s: +1 left, -1 right) in two shapes. Spread (the rest of the rig, flat along +x): the arm, a surface
 * from the body to the wrist whose trailing edge the secondaries scallop, the coverts of the hand, and the primaries
 * as single feathers fanned out from the hand (the big birds spread their outer ones like fingers). Closed (aFold):
 * the same feathers lying on the flank, the coverts in front and on top, the secondaries behind them, the tips of the
 * primaries reaching back over the rump. The hand's weight is 1, the arm's grows towards the wrist.
 */
function wing(b, S, J, look, s, lod, noise, bodyAt) {
  const W = S.wing, sh = J.shoulder, half = J.half, armLen = half * W.arm, handLen = half - armLen;
  const c0 = W.chord, x0 = sh[0], pointed = W.shape === 'pointed', fingered = W.shape === 'fingered';
  const pa = [s * sh[0], sh[1], sh[2]], pb = [s * J.wrist[0], J.wrist[1], J.wrist[2]];
  const fold = folder(S, J, bodyAt, s);
  const zLE = (u) => sh[2] + c0 * (0.06 + 0.12 * Math.sin(Math.min(1, u) * Math.PI / 2));
  const xW = x0 + armLen, zW = zLE(1);
  const flip = (top) => (s > 0) === top;
  // --- the arm: coverts in front, the secondaries behind (their tips scallop the trailing edge)
  const ni = lod ? 4 : 10, nj = lod ? 3 : 8, nSec = Math.max(5, Math.round(armLen / (c0 * 0.17)));
  for (const top of [true, false]) {
    b.grid(ni, nj, (i, j) => {
      const u = i / (ni - 1), v = j / (nj - 1);
      const scallop = j === nj - 1 && !lod ? 0.08 * (0.5 - 0.5 * Math.cos(TAU * nSec * u)) : 0;
      const c = c0 * (1 - 0.06 * u) * (1 - scallop);
      const x = x0 + armLen * u, z = zLE(u) - c * v;
      const y = sh[1] + c0 * (top ? 0.075 : 0.032) * Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + v)), 0.7) * (1.2 - 0.5 * u);
      const [fp, fn] = fold(0.3 - 0.2 * u + 0.4 * v, 0.1 + 0.62 * u - 0.28 * v, top ? 3 : 2.6, top);
      const col = look(top ? 'wingTop' : 'wingBottom', { u: u * W.arm, v, n: noise() * 0.5 });
      return [[s * x, y, z], u * armLen / 0.03, v * c / 0.03, col, [PART.wing, sstep(0.72, 1, u), s, 0], pa, pb, fp, fn];
    }, flip(top));
  }
  // --- the primaries: from the hand's bone (the wrist out to some 40 % of the hand) to their tips on the outline
  const n = lod ? (fingered ? W.fingers + 1 : 4) : fingered ? W.fingers + 5 : pointed ? 9 : 8;
  const bone = [xW + handLen * (pointed ? 0.5 : 0.42), zW - c0 * (pointed ? 0.2 : 0.1)];
  const baseOf = (t) => [xW + (bone[0] - xW) * Math.pow(t, 0.9), zW - c0 * 0.16 + (bone[1] - zW) * t];
  const tips = [];
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    // the outline of the tips: from the trailing edge behind the wrist round to the tip of the wing
    let xs, zs;
    if (pointed) { xs = 0.1 + 0.9 * Math.pow(t, 0.8); zs = 0.92 + 0.95 * Math.pow(t, 1.6); }
    else if (fingered) { xs = 0.12 + 0.88 * Math.pow(Math.sin(t * Math.PI / 2), 0.75); zs = 0.92 - 0.62 * Math.pow(t, 1.1) - (t > 0.6 ? 0.08 * (t - 0.6) : 0); }
    else { xs = 0.1 + 0.9 * Math.sin(t * Math.PI / 2); zs = 0.93 - 0.58 * Math.pow(t, 1.45); }
    tips.push([xW + handLen * xs, zW - c0 * zs]);
  }
  const lens = tips.map((tp, k) => { const bs = baseOf(k / (n - 1)); return Math.hypot(tp[0] - bs[0], tp[1] - bs[1]); });
  const Lmax = Math.max(...lens);
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const base = baseOf(t), tip = tips[k];
    const dx = tip[0] - base[0], dz = tip[1] - base[1], L = Math.hypot(dx, dz), dir = [dx / L, dz / L], perp = [-dir[1], dir[0]];
    const outer = fingered && t > 1 - W.fingers / n;
    const wid = c0 * (outer ? 0.14 + 0.06 * (1 - t) : pointed ? 0.2 : 0.27);
    const ni2 = lod ? 3 : 5, nj2 = 3, layerY = c0 * 0.009 * k;
    const reach = 0.6 + 0.4 * L / Lmax;
    for (const top of [true, false]) {
      b.grid(ni2, nj2, (i, j) => {
        const q = i / (ni2 - 1), v = j / (nj2 - 1) - 0.5;
        const w = wid * (q > 0.75 ? 0.35 + 0.65 * Math.sqrt(Math.max(0, 1 - (q - 0.75) / 0.25 * 0.9)) : 1 - 0.15 * q);
        const x = base[0] + dir[0] * L * q + perp[0] * w * v, z = base[1] + dir[1] * L * q + perp[1] * w * v;
        const y = sh[1] + layerY + c0 * 0.03 * Math.sin(Math.PI * q) * (fingered ? 1.6 : 1) + (top ? c0 * 0.006 : 0);
        const u = W.arm + (1 - W.arm) * ((x - xW) / handLen);
        const [fp, fn] = fold(0.1 + 0.05 * t + (reach - 0.1) * q, 0.6 + 0.25 * t + v * 0.18 * (1 - 0.6 * q), 1 + 0.12 * k, top);
        return [[s * x, y, z], q * L / 0.03, (v + 0.5) * w / 0.03, look(top ? 'wingTop' : 'wingBottom', { u: Math.min(1, u), v: 0.6 + 0.4 * q, n: noise() * 0.5, primary: true }), [PART.wing, 1, s, 0], pa, pb, fp, fn];
      }, !flip(top));
    }
  }
  // --- the coverts of the hand: over the bases of the primaries
  {
    const nc = lod ? 2 : 4, cc = c0 * 0.46;
    for (const top of [true, false]) {
      b.grid(nc, 3, (i, j) => {
        const q = i / (nc - 1), v = j / 2;
        const x = xW + (bone[0] - xW) * q, z = zW + (bone[1] - zW) * q - cc * (1 - 0.4 * q) * v;
        const y = sh[1] + c0 * (top ? 0.075 : 0.03) * (1 - 0.6 * q) * Math.sin(Math.PI * Math.min(1, 0.1 + v)) + c0 * 0.009 * n * 0.6;
        const [fp, fn] = fold(0.08 + 0.18 * q + 0.12 * v, 0.72 + 0.12 * q - 0.22 * v, 3.4, top);
        return [[s * x, y, z], q * handLen / 0.03, v * cc / 0.03, look(top ? 'wingTop' : 'wingBottom', { u: W.arm + 0.1 * q, v: v * 0.3, n: noise() * 0.5 }), [PART.wing, 1, s, 0], pa, pb, fp, fn];
      }, flip(top));
    }
  }
}

/** The tail: a fan from its base, top and bottom; w across (-1 … 1, it spreads by w), l along. */
function tail(b, S, J, look, lod, noise, sheen = 0) {
  const T = S.tail, base = J.tail, bw = S.body[1];
  const ni = lod ? 3 : 5, nj = lod ? 5 : 9;
  const length = (w) => {
    const a = Math.abs(w);
    if (T.shape === 'round') return T.len * (0.86 + 0.14 * (1 - a * a));
    if (T.shape === 'notch') return T.len * (0.9 + 0.1 * a);
    if (T.shape === 'forked') return T.len * (0.62 + 0.38 * Math.pow(a, 1.5)) + (T.streamer || 0) * sstep(0.72, 1, a);
    return T.len;
  };
  const halfW = (l, w) => {
    const forked = T.shape === 'forked' && Math.abs(w) > 0.72;
    const wTip = forked ? T.w * (1 - 0.6 * sstep(0.4, 1, l)) : T.w;
    return bw * 0.22 + (wTip - bw * 0.22) * Math.pow(l, 0.7);
  };
  for (const top of [true, false]) {
    b.grid(ni, nj, (i, j) => {
      const l = i / (ni - 1), w = (j / (nj - 1)) * 2 - 1, L = length(w) * l;
      const x = w * halfW(l, w), z = base[2] - L, y = base[1] - L * 0.12 + (top ? T.w * 0.14 * (1 - 0.6 * l) * (1 - 0.5 * w * w) : -T.w * 0.07 * (1 - l));
      return [[x, y, z], (w + 1) * T.w / 0.03, L / 0.03, look(top ? 'tailTop' : 'tailBottom', { l, w, n: noise() * 0.5 }), [PART.tail, w, 0, sheen], base, ZERO];
    }, !top);
  }
}

/** A leg: the tarsus from the belly down to the foot, three toes forward and one back. Turns at the hip. */
function legs(b, S, J, look, s) {
  const [len, toe] = S.leg, hip = [s * J.hip[0], J.hip[1], J.hip[2]], foot = [s * J.foot[0], J.foot[1], J.foot[2]];
  const r = Math.max(0.0012, len * 0.07), col = look('leg', {}), rig = [PART.leg, 1, s, 0.15];
  const stick = (a, c, rad, seg = 5) => {
    const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2], L = Math.hypot(dx, dy, dz);
    const d = [dx / L, dy / L, dz / L], up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    let p1 = [d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]]; const l1 = Math.hypot(...p1); p1 = p1.map((x) => x / l1);
    const p2 = [d[1] * p1[2] - d[2] * p1[1], d[2] * p1[0] - d[0] * p1[2], d[0] * p1[1] - d[1] * p1[0]];
    b.grid(2, seg + 1, (i, j) => {
      const th = (j / seg) * TAU, rr = rad * (i ? 0.7 : 1), cc = i ? c : a;
      return [[cc[0] + (p1[0] * Math.cos(th) + p2[0] * Math.sin(th)) * rr, cc[1] + (p1[1] * Math.cos(th) + p2[1] * Math.sin(th)) * rr, cc[2] + (p1[2] * Math.cos(th) + p2[2] * Math.sin(th)) * rr], j / seg, i, col, rig, hip, ZERO];
    });
  };
  // from inside the belly feathers down to the ankle
  stick([hip[0], hip[1] + len * 0.25, hip[2]], foot, r);
  for (const a of [-0.38, 0, 0.38]) stick(foot, [foot[0] + Math.sin(a) * toe, foot[1], foot[2] + Math.cos(a) * toe], r * 0.6, 4);
  stick(foot, [foot[0], foot[1], foot[2] - toe * 0.6], r * 0.6, 4);
}

// ---------------------------------------------------------------- the frog --------------------------------------------
/** The frog's joints: the hip of the hind legs and the point it sits on. */
function frogJoints() {
  return { hip: [0.012, 0.012, -0.024], stand: [0, 0, 0] };
}
/**
 * A green frog (Pelophylax, the pond frog), about 9 cm long, sitting: a squat body, the head with bulging golden eyes
 * on top, a pale throat that swells as it breathes, short front legs and long hind legs folded at its sides.
 */
export function buildFrog(lod = 0) {
  const b = new Build(), rnd = seeded(31 + lod), J = frogJoints();
  const green = C(0x5f8f3a), green2 = C(0x7aa548), dark = C(0x2c3f1c), belly = C(0xe2dcc0), bronze = C(0x8a7a3e);
  const paint = (t, th, p) => {
    const top = Math.cos(th), side = Math.abs(Math.sin(th));
    let col = top > 0.1 ? mix(green, green2, rnd() * 0.6) : top > -0.35 ? mix(bronze, green, 0.4) : belly;
    if (top > 0.2 && rnd() < 0.18) col = dark;                                     // dark spots
    if (top > 0.9 && side < 0.12 && t > 0.15 && t < 0.85) col = C(0xa9c46a);        // the pale line down the back
    return { col, rig: [PART.body, 0, 0, 0.35] };
  };
  const seg = lod ? 8 : 14;
  // the body: rump (back, low) … shoulders … head (front), sitting up at the front
  const prof = [[-0.045, 0.004, 0.006, 0.006], [-0.038, 0.016, 0.017, 0.014], [-0.022, 0.024, 0.021, 0.019], [-0.004, 0.026, 0.021, 0.022], [0.012, 0.024, 0.018, 0.022], [0.026, 0.021, 0.014, 0.02], [0.038, 0.015, 0.01, 0.017], [0.046, 0.006, 0.005, 0.014]];
  b.loft(prof.filter((_, i) => !lod || i % 2 === 0 || i === prof.length - 1).map(([z, w, h, y]) => ({ z, w, h, y })), seg, paint, 0.012);
  // the throat: a pale pouch under the chin
  b.loft([[0.006, 0.0005, 0.0005, 0.009], [0.014, 0.013, 0.0055, 0.0085], [0.026, 0.014, 0.0055, 0.0095], [0.036, 0.008, 0.004, 0.011], [0.04, 0.0005, 0.0005, 0.012]].map(([z, w, h, y]) => ({ z, w, h, y })), lod ? 6 : 10,
    (t, th) => ({ col: Math.cos(th) < 0 ? C(0xeee6c8) : C(0xd9d2b4), rig: [PART.throat, Math.max(0, -Math.cos(th)) * Math.sin(Math.PI * t), 0, 0.4] }), 0.01);
  // eyes: golden domes with a black pupil, high on the head
  for (const s of [1, -1]) {
    const c = [s * 0.0105, 0.033, 0.026], r = 0.0062, sd = lod ? 5 : 8;
    b.grid(sd, sd + 1, (i, j) => {
      const lat = (i / (sd - 1)) * Math.PI * 0.6, lon = (j / sd) * TAU, d = [s * 0.55, 0.65, 0.5], dl = Math.hypot(...d), n = d.map((x) => x / dl);
      const a1 = [n[1], -n[0], 0].map((x) => x / Math.hypot(n[1], n[0])), a2 = [n[1] * a1[2] - n[2] * a1[1], n[2] * a1[0] - n[0] * a1[2], n[0] * a1[1] - n[1] * a1[0]];
      const v = [0, 1, 2].map((k) => n[k] * Math.cos(lat) + (a1[k] * Math.cos(lon) + a2[k] * Math.sin(lon)) * Math.sin(lat));
      const pupil = i < 2 ? C(0x080808) : C(0xc89a3a);
      return [[c[0] + v[0] * r - n[0] * r * 0.4, c[1] + v[1] * r - n[1] * r * 0.4, c[2] + v[2] * r - n[2] * r * 0.4], j / sd, i / sd, pupil, [PART.body, 0, 0, 1], ZERO, ZERO];
    }, true);
  }
  // legs as tapering tubes through a few points; `stretched` (the hind legs): the same points in a jump, kept in aPivB
  const frame = (a, c) => {
    const d = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], L = Math.hypot(...d), dd = d.map((x) => x / L);
    const up = Math.abs(dd[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    let p1 = [dd[1] * up[2] - dd[2] * up[1], dd[2] * up[0] - dd[0] * up[2], dd[0] * up[1] - dd[1] * up[0]]; const l1 = Math.hypot(...p1); p1 = p1.map((x) => x / l1);
    return [p1, [dd[1] * p1[2] - dd[2] * p1[1], dd[2] * p1[0] - dd[0] * p1[2], dd[0] * p1[1] - dd[1] * p1[0]]];
  };
  const ring = (cc, [p1, p2], rr, th) => [cc[0] + (p1[0] * Math.cos(th) + p2[0] * Math.sin(th)) * rr, cc[1] + (p1[1] * Math.cos(th) + p2[1] * Math.sin(th)) * rr, cc[2] + (p1[2] * Math.cos(th) + p2[2] * Math.sin(th)) * rr];
  const limb = (pts, rads, side, stretched = null) => {
    const n = pts.length, sides = lod ? 4 : 6;
    for (let i = 0; i < n - 1; i++) {
      const a = pts[i], c = pts[i + 1], f = frame(a, c), fs = stretched && frame(stretched[i], stretched[i + 1]);
      b.grid(2, sides + 1, (k, j) => {
        const th = (j / sides) * TAU, rr = k ? rads[i + 1] : rads[i];
        const pt = ring(k ? c : a, f, rr, th);
        const top = Math.cos(th) * f[0][1] + Math.sin(th) * f[1][1];
        const col = top > 0 ? (rnd() < 0.25 ? dark : green) : C(0xc9c49a);
        if (!stretched) return [pt, j / sides, k, col, [PART.body, 0, side, 0.3], ZERO, ZERO];
        return [pt, j / sides, k, col, [PART.hind, 1, side, 0.3], [side * J.hip[0], J.hip[1], J.hip[2]], ring(k ? stretched[i + 1] : stretched[i], fs, rr, th)];
      });
    }
  };
  for (const s of [1, -1]) {
    // hind leg folded at the side: hip → knee (forward and out) → ankle (back) → toes (forward); in a jump all of it
    // stretched back
    const folded = [[0.012, 0.012, -0.024], [0.034, 0.008, -0.002], [0.026, 0.004, -0.036], [0.04, 0.002, -0.004], [0.05, 0.001, 0.012]];
    const straight = [[0.012, 0.012, -0.024], [0.02, 0.006, -0.051], [0.026, 0.002, -0.085], [0.031, 0.0, -0.118], [0.034, -0.001, -0.136]];
    limb(folded.map(([x, y, z]) => [s * x, y, z]), [0.0075, 0.0055, 0.004, 0.0028, 0.0018], s, straight.map(([x, y, z]) => [s * x, y, z]));
    // front leg: shoulder → elbow → hand on the ground
    limb([[s * 0.014, 0.012, 0.024], [s * 0.02, 0.006, 0.03], [s * 0.022, 0.0012, 0.034], [s * 0.026, 0.0008, 0.042]], [0.004, 0.0032, 0.0025, 0.0016], s);
  }
  const g = b.geometry();
  g.userData.kind = 'frog'; g.userData.lod = lod;
  return g;
}
