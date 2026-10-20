// Koi in the lake: orange, gold, white, red-and-white, black-and-gold and blue-grey carp of different sizes, swimming
// slowly just below the surface with their bodies undulating and their tails beating, gathering beside the jetty when
// somebody stands on it (koi expect to be fed), darting off when something splashes into the water. In winter they stay
// down in the deep water and are hardly seen; under ice not at all.
//   They are drawn after the water (renderOrder above the lake's) with a shader of their own: the water between the eye
// and a fish tints and dims it by its depth (the same absorption as the water shader uses), the sky's reflection on the
// surface hides them at a glancing angle, and the sun throws a net of caustics on their backs. The body bends in the
// vertex shader (a wave running to the tail, a curve in turns), so all of them are one instanced draw.
import * as THREE from 'three';
import { NATURE, HAZE_GLSL, waterNormalTexture } from './nature.js';
import { seeded } from './geo.js';
import { WATER_Y, LAKE, lakeDist, onJetty, JETTY } from './outdoor.js';
import { depthAt, lilyWeight } from './pond.js';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

/** The patterns (rows of the atlas): how often they come, how metallic their scales shine. */
const PATTERNS = [
  { name: 'kohaku', w: 3 }, { name: 'sanke', w: 2 }, { name: 'showa', w: 1.5 }, { name: 'ogon', w: 2, metal: 1 },
  { name: 'orenji', w: 2.5, metal: 0.8 }, { name: 'platinum', w: 1.5, metal: 1 }, { name: 'kumonryu', w: 1.2, metal: 0.3 }, { name: 'asagi', w: 1 },
];
const ROWS = PATTERNS.length;

let atlas = null;
/** The skins: one row per pattern, u along the body (0 tail … 1 snout), v round it (0 back … 0.5 belly … 1 back). */
function patternAtlas() {
  if (atlas) return atlas;
  const W = 256, H = 64 * ROWS, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), rnd = seeded(808);
  // a patch on the back (v near 0 and 1 are both the back: drawn at both and wrapped)
  const blob = (row, u, v, r, col, stretch = 1.6) => {
    for (const ov of [-1, 0, 1]) { g.fillStyle = col; g.beginPath(); g.ellipse(u * W, row * 64 + (v + ov) * 64, r * W * stretch, r * 64 * 2.2, 0, 0, TAU); g.fill(); }
  };
  PATTERNS.forEach((P, row) => {
    const y0 = row * 64;
    g.save(); g.beginPath(); g.rect(0, y0, W, 64); g.clip();
    const base = { kohaku: '#f4f1ea', sanke: '#f4f1ea', showa: '#141313', ogon: '#e8b43a', orenji: '#ef7a1e', platinum: '#e9e9e4', kumonryu: '#121212', asagi: '#7f92a3' }[P.name];
    g.fillStyle = base; g.fillRect(0, y0, W, 64);
    // the belly: paler (on the asagi red-orange)
    const belly = g.createLinearGradient(0, y0, 0, y0 + 64);
    const bc = P.name === 'asagi' ? 'rgba(214,108,58,0.9)' : P.name === 'showa' || P.name === 'kumonryu' ? 'rgba(236,232,222,0.85)' : 'rgba(255,250,240,0.35)';
    belly.addColorStop(0, 'rgba(0,0,0,0)'); belly.addColorStop(0.32, 'rgba(0,0,0,0)'); belly.addColorStop(0.5, bc); belly.addColorStop(0.68, 'rgba(0,0,0,0)'); belly.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = belly; g.fillRect(0, y0, W, 64);
    if (P.name === 'kohaku' || P.name === 'sanke' || P.name === 'showa') {
      for (let k = 0; k < 5; k++) blob(row, 0.2 + rnd() * 0.7, rnd() < 0.5 ? 0 : 1, 0.06 + rnd() * 0.06, '#d4381c');   // the red patches
      if (rnd() < 0.8) blob(row, 0.86 + rnd() * 0.06, 0, 0.05, '#d4381c', 1.2);                                     // a red head
    }
    if (P.name === 'sanke') for (let k = 0; k < 7; k++) blob(row, 0.2 + rnd() * 0.65, rnd() < 0.5 ? 0.06 : 0.94, 0.018 + rnd() * 0.02, '#111111', 1.1);
    if (P.name === 'showa') for (let k = 0; k < 6; k++) blob(row, 0.15 + rnd() * 0.75, 0.2 + rnd() * 0.6, 0.04 + rnd() * 0.03, '#f2efe8');
    if (P.name === 'kumonryu') for (let k = 0; k < 7; k++) blob(row, 0.1 + rnd() * 0.85, rnd(), 0.04 + rnd() * 0.04, k % 2 ? '#d9a330' : '#e9e6dd');
    if (P.name === 'asagi') {
      // a net of pale scale edges on the blue back
      g.strokeStyle = 'rgba(222,232,240,0.55)'; g.lineWidth = 1;
      for (let x = 0; x < W; x += 6) for (let y = 0; y < 64; y += 5) { g.beginPath(); g.arc(x + ((y / 5) % 2) * 3, y0 + y, 3, 0, Math.PI); g.stroke(); }
    }
    // the scales: a fine pattern of darker edges over everything, a slightly darker back
    g.strokeStyle = 'rgba(0,0,0,0.1)'; g.lineWidth = 0.8;
    for (let x = 0; x < W; x += 5) for (let y = 0; y < 64; y += 4) { g.beginPath(); g.arc(x + ((y / 4) % 2) * 2.5, y0 + y, 2.6, 0.2, Math.PI - 0.2); g.stroke(); }
    const back = g.createLinearGradient(0, y0, 0, y0 + 64);
    back.addColorStop(0, 'rgba(0,0,0,0.12)'); back.addColorStop(0.2, 'rgba(0,0,0,0)'); back.addColorStop(0.8, 'rgba(0,0,0,0)'); back.addColorStop(1, 'rgba(0,0,0,0.12)');
    g.fillStyle = back; g.fillRect(0, y0, W, 64);
    g.restore();
  });
  atlas = new THREE.CanvasTexture(c);
  atlas.colorSpace = THREE.SRGBColorSpace; atlas.wrapS = THREE.RepeatWrapping; atlas.wrapT = THREE.ClampToEdgeWrapping; atlas.anisotropy = 4;
  return atlas;
}

/**
 * The koi's body, 1 m from the tip of the tail fin to the snout (+z), scaled per fish: a lofted body thick in front and
 * slender at the tail, a forked tail fin, a long dorsal fin, pectoral, pelvic and anal fins, two barbels at the mouth,
 * dark eyes. aFin: 0 body, 1 tail fin, 2 dorsal, 3 pectoral, 4 pelvic and anal, 5 eye; aSide: ±1.
 */
function koiGeometry() {
  const P = [], U = [], F = [], S = [], I = [];
  const vert = (x, y, z, u, v, fin, side = 0) => { P.push(x, y, z); U.push(u, v); F.push(fin); S.push(side); return P.length / 3 - 1; };
  const seg = 16;
  // the body: z from the peduncle (-0.31) to the snout (0.5): half width, half height, height of the centre
  const prof = [[-0.31, 0.018, 0.035, 0.0], [-0.22, 0.032, 0.058, 0.002], [-0.1, 0.06, 0.098, 0.006], [0.02, 0.085, 0.128, 0.01], [0.14, 0.095, 0.134, 0.012], [0.26, 0.09, 0.118, 0.006], [0.36, 0.075, 0.092, -0.004], [0.43, 0.056, 0.064, -0.012], [0.48, 0.032, 0.036, -0.018], [0.5, 0.004, 0.004, -0.02]];
  const first = 0;
  prof.forEach(([z, w, h, y]) => { for (let k = 0; k <= seg; k++) { const a = (k / seg) * TAU; vert(Math.sin(a) * w, y + Math.cos(a) * h, z, (z + 0.31) / 0.81, k / seg, 0); } });
  for (let i = 0; i < prof.length - 1; i++) for (let k = 0; k < seg; k++) { const a = first + i * (seg + 1) + k, b = a + 1, c = a + seg + 1, d = c + 1; I.push(a, b, c, b, d, c); }
  // a fin: rows of points from its base outwards, both faces
  const fin = (pts, finId, side, u0) => {
    const n = pts.length, m = pts[0].length, f0 = P.length / 3;
    for (let face = 0; face < 2; face++) {
      for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { const [x, y, z] = pts[i][j]; vert(x, y, z, u0 + 0.05 * i / (n - 1), 0.25 + 0.1 * j / (m - 1), finId, side); }
      const o = f0 + face * n * m;
      for (let i = 0; i < n - 1; i++) for (let j = 0; j < m - 1; j++) { const a = o + i * m + j, b = a + 1, c = a + m, d = c + 1; if (face) I.push(a, c, b, b, c, d); else I.push(a, b, c, b, d, c); }
    }
  };
  // tail fin: broad and forked, from the peduncle back
  { const pts = []; for (let i = 0; i <= 4; i++) { const t = i / 4, row = []; for (let j = 0; j <= 6; j++) { const s = j / 6 * 2 - 1, fork = 0.05 * Math.pow(1 - Math.abs(s), 1.3); row.push([0, s * (0.025 + 0.12 * t), -0.3 - (0.04 + 0.16 * t) + fork * t]); } pts.push(row); } fin(pts, 1, 0, 0.02); }
  // dorsal fin: a long low sail along the back
  { const pts = []; for (let i = 0; i <= 2; i++) { const t = i / 2, row = []; for (let j = 0; j <= 6; j++) { const z = 0.16 - 0.4 * (j / 6), back = 0.128 * Math.max(0, 1 - Math.abs(z - 0.08) / 0.5) + 0.01; row.push([0, back + t * (0.045 + 0.03 * Math.sin(Math.PI * j / 6)), z - t * 0.04]); } pts.push(row); } fin(pts, 2, 0, 0.55); }
  // pectoral fins: low on the sides behind the head, broad fans
  for (const s of [1, -1]) { const pts = []; for (let i = 0; i <= 2; i++) { const t = i / 2, row = []; for (let j = 0; j <= 4; j++) { const a = 0.3 + 0.9 * (j / 4); row.push([s * (0.07 + t * 0.1 * Math.cos(a)), -0.06 - t * 0.035, 0.3 - t * 0.11 * Math.sin(a)]); } pts.push(row); } fin(pts, 3, s, 0.8); }
  // pelvic and anal fins
  for (const [z0, s] of [[0.0, 1], [0.0, -1], [-0.17, 1], [-0.17, -1]]) { const pts = []; for (let i = 0; i <= 1; i++) { const row = []; for (let j = 0; j <= 3; j++) row.push([s * (0.03 + i * 0.03), -0.1 - i * 0.045 + (z0 < -0.1 ? 0.03 : 0), z0 + 0.04 - j * 0.03 - i * 0.03]); pts.push(row); } fin(pts, 4, s, 0.4); }
  // barbels and eyes
  for (const s of [1, -1]) {
    const b0 = P.length / 3;
    for (let i = 0; i <= 3; i++) { const t = i / 3; vert(s * (0.018 + t * 0.03), -0.035 - t * 0.02, 0.47 - t * 0.02, 0.98, 0.5, 0, s); vert(s * (0.018 + t * 0.03), -0.03 - t * 0.02, 0.47 - t * 0.02, 0.98, 0.5, 0, s); }
    for (let i = 0; i < 3; i++) { const a = b0 + i * 2; I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3, a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const e0 = P.length / 3, cx = s * 0.057, cy = 0.02, cz = 0.4, r = 0.013;
    vert(cx * 1.05, cy, cz, 0.9, 0.5, 5, s);
    for (let k = 0; k <= 8; k++) { const a = k / 8 * TAU; vert(cx, cy + Math.cos(a) * r, cz + Math.sin(a) * r, 0.9, 0.5, 5, s); }
    for (let k = 0; k < 8; k++) I.push(e0, e0 + 1 + k, e0 + 2 + k, e0, e0 + 2 + k, e0 + 1 + k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('aFin', new THREE.Float32BufferAttribute(F, 1));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(S, 1));
  g.setIndex(I);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

const vert = `
attribute float aFin; attribute float aSide; attribute vec4 aSwim; attribute vec4 aKoi;
uniform float uTime; uniform sampler2D uWaves; uniform float uWaterY; uniform float uWind;
varying vec3 vWorld; varying vec3 vNormal; varying vec2 vUv; varying float vFin; varying vec4 vKoi;
void main() {
  vec3 p = position, n = normal;
  // the wave that runs down the body to the tail, stronger towards it; the bend of a turn
  float z = p.z, env = 0.12 + 0.88 * smoothstep(0.3, -0.5, z), ph = aSwim.x;
  float wave = sin(z * 6.0 - ph) * aSwim.y * env;
  float slope = cos(z * 6.0 - ph) * 6.0 * aSwim.y * env + aSwim.z * 3.2 * (z - 0.1);
  p.x += wave + aSwim.z * (z - 0.1) * (z - 0.1) * 1.6;
  n = normalize(vec3(n.x - n.z * slope * 0.6, n.y, n.z));
  // the pectoral fins paddle, the tail fin flutters
  if (aFin > 2.5 && aFin < 3.5) {
    float a = (sin(aKoi.x) * 0.45 + 0.15) * aSide;
    vec3 o = vec3(aSide * 0.07, -0.06, 0.3), q = p - o;
    p = o + vec3(q.x * cos(a) - q.y * sin(a), q.x * sin(a) + q.y * cos(a), q.z);
  }
  if (aFin > 0.5 && aFin < 1.5) p.x += sin(uTime * 7.0 + p.y * 30.0 + ph) * 0.004 * clamp((-z - 0.3) * 6.0, 0.0, 1.5);
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  // seen through the moving surface the fish waver (the slope of the lake's ripples, by the depth)
  vec2 drift = vec2(1.0, 0.28) * uTime;
  vec2 ws = texture2D(uWaves, w.xz * 0.12 + vec2(drift.y, -drift.x) * 0.012 + 0.31).xy - 0.5;
  w.xz += ws * (0.04 + 0.12 * uWind) * clamp(uWaterY - w.y, 0.0, 1.0) * 1.5;
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
  vUv = vec2(uv.x, (uv.y + aSwim.w) / ${ROWS.toFixed(1)});
  vFin = aFin; vKoi = aKoi;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const frag = `
uniform sampler2D uAtlas; uniform sampler2D uWaves; uniform float uTime; uniform float uWaterY; uniform float uFrozen;
uniform vec3 uSkyLight; uniform vec3 uSunLight; uniform vec3 uSunDirW;
uniform vec3 uHazeColor; uniform vec3 uHazeSun; uniform float uHazeDensity; uniform float uHazeMax; uniform float uHazeStart;
${HAZE_GLSL}
varying vec3 vWorld; varying vec3 vNormal; varying vec2 vUv; varying float vFin; varying vec4 vKoi;
void main() {
  vec3 V = vWorld - cameraPosition; float dist = length(V); V /= dist;
  vec3 N = normalize(vNormal); if (dot(N, V) > 0.0) N = -N;
  float fin = step(0.5, vFin) * (1.0 - step(4.5, vFin));
  vec3 skin = texture2D(uAtlas, vUv).rgb;
  // fins: the body's colour, pale and half clear; eyes dark
  if (fin > 0.5) skin = mix(skin, vec3(0.95, 0.93, 0.88), 0.35);
  if (vFin > 4.5) skin = vec3(0.02);
  // light from above through the water: the sun in a net of caustics, the sky; metallic scales glint
  float depth = max(uWaterY - vWorld.y, 0.0);
  vec2 cp = vWorld.xz * 0.9 + uSunDirW.xz * depth;
  float c1 = texture2D(uWaves, cp * 0.6 + vec2(uTime * 0.03, uTime * 0.02)).b, c2 = texture2D(uWaves, cp * 0.83 - vec2(uTime * 0.025, -uTime * 0.017) + 0.37).b;
  float caustic = pow(clamp(1.0 - abs(c1 - c2) * 3.2, 0.0, 1.0), 6.0) * 1.6 + 0.45;
  float sun = max(dot(N, uSunDirW), 0.0) * max(uSunDirW.y, 0.0);
  vec3 lit = skin * (uSkyLight * (0.55 + 0.45 * max(N.y, 0.0)) + uSunLight * sun * caustic * 0.75);
  vec3 H = normalize(uSunDirW - V);
  float spec = pow(max(dot(N, H), 0.0), 40.0) * (0.15 + 0.85 * vKoi.z) * (1.0 - fin);
  lit += uSunLight * spec * 0.6 * max(uSunDirW.y, 0.0) + skin * uSkyLight * vKoi.z * 0.35;
  // the water in front of it: the lake's absorption, towards its dim green-brown body
  float path = depth / max(-V.y, 0.12);
  vec3 body = vec3(0.034, 0.048, 0.04) * (uSkyLight * 1.8 + uSunLight * max(uSunDirW.y, 0.0) * 0.12);
  vec3 col = mix(body, lit, exp(-path * 2.1));
  // the surface mirrors the sky at a glancing angle: there the fish fade
  float fres = 0.02 + 0.98 * pow(1.0 - clamp(-V.y, 0.0, 1.0), 5.0);
  float a = (1.0 - fres) * vKoi.y * (1.0 - uFrozen) * (fin > 0.5 ? 0.75 : 1.0);
  col = mix(col, natHazeColor(V), natHazeAmount(dist, vWorld.y));
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------------------------------------------------------------- the fish ------------------------------------------
class Fish {
  constructor(i) {
    const r = seeded(4400 + i * 17);
    this.len = 0.32 + Math.pow(r(), 0.8) * 0.38;
    let w = 0; for (const P of PATTERNS) w += P.w;
    let k = r() * w; this.pattern = 0;
    for (let j = 0; j < ROWS; j++) { k -= PATTERNS[j].w; if (k <= 0) { this.pattern = j; break; } }
    if (i < ROWS) this.pattern = i;   // every pattern at least once
    this.metal = PATTERNS[this.pattern].metal || 0;
    this.pos = new THREE.Vector3(); this.yaw = r() * TAU; this.speed = 0.2; this.depth = 0.25; this.goal = null; this.goalT = 0;
    this.phase = r() * TAU; this.finPhase = r() * TAU; this.bend = 0; this.pitch = 0; this.vis = 1; this.scare = 0; this.turn = 0;
  }
}

export class Koi {
  constructor(owner) {
    this.owner = owner; this.world = owner.world;
    this.group = new THREE.Group(); this.group.name = 'koi';
    this.N = 10;
    this.uniforms = {
      uTime: NATURE.uTime, uSkyLight: NATURE.uSkyLight, uSunLight: NATURE.uSunLight, uSunDirW: NATURE.uSunDirW,
      uHazeColor: NATURE.uHazeColor, uHazeSun: NATURE.uHazeSun, uHazeDensity: NATURE.uHazeDensity, uHazeMax: NATURE.uHazeMax, uHazeStart: NATURE.uHazeStart,
      uAtlas: { value: patternAtlas() }, uWaves: { value: waterNormalTexture() }, uWaterY: { value: WATER_Y }, uFrozen: { value: 0 }, uWind: NATURE.uWind,
    };
    this.material = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms, transparent: true, depthWrite: true, fog: false });
    this.material.name = 'koi';
    const g = koiGeometry();
    this.attrs = {};
    // (one instance more than there are fish: the warm-up fish of #draw, which never had a free instance while every
    // fish of the pond is made at once)
    for (const name of ['aSwim', 'aKoi']) { const a = new THREE.InstancedBufferAttribute(new Float32Array((this.N + 1) * 4), 4); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); this.attrs[name] = a; }
    this.mesh = new THREE.InstancedMesh(g, this.material, this.N + 1);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // after the lake's surface (renderOrder 4), before the rain (5)
    this.mesh.renderOrder = 4.5; this.mesh.frustumCulled = false; this.mesh.userData.noAO = true; this.mesh.name = 'koi';
    this.mesh.count = 0;
    this.group.add(this.mesh);
    this.fish = [];
    this.clock = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this.prewarmAgain();
  }
  /** Drawn once far below in the first frames (and after a change of the render path): the program and its vertex
   *  layout are built then, not when the first fish comes into sight. */
  prewarmAgain() { this.prewarmFrames = 4; }
  prepare() {
    if (this.fish.length) return;
    for (let i = 0; i < this.N; i++) {
      const f = new Fish(i), p = this.#goal(f);
      f.pos.set(p.x, WATER_Y - 0.3, p.z); f.goal = this.#goal(f);
      this.fish.push(f);
    }
  }
  clear() { this.mesh.count = 0; }
  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }
  /** Something splashed into the lake at (x, z): the fish nearby dart away from it. */
  scare(x, z, size = 1) { for (const f of this.fish) { if (Math.hypot(f.pos.x - x, f.pos.z - z) < 3 + size * 1.5) { f.scare = 1.6; f.from = [x, z]; } } }

  /** How deep they keep: near the surface in summer, lower in spring and autumn, down in the deep water in winter. */
  #band() {
    const s = this.owner.seasonNow();
    if (s === 'winter' || this.owner.weatherNow() === 'snow') return [0.9, 1.6];
    if (s === 'summer') return [0.12, 0.38];
    return [0.22, 0.6];
  }
  /** A place to swim to: open water deep enough, away from the lilies; most often in the half of the lake towards the
   *  jetty and the shore path, where people look into it. */
  #goal() {
    const [d0] = this.#band();
    for (let i = 0; i < 60; i++) {
      const a = rand(-Math.PI, Math.PI), r = Math.sqrt(Math.random()) * 0.85;
      const x = LAKE.x + Math.cos(a) * LAKE.rx * r, z = LAKE.z + Math.sin(a) * LAKE.rz * r;
      if (lakeDist(x, z) > 0.88 || depthAt(x, z) < d0 + 0.35 || lilyWeight(x, z) > 0.005 || onJetty(x, z)) continue;
      if (i < 45 && Math.random() < 0.7 && Math.hypot(x - JETTY.end[0], z - JETTY.end[1]) > 16) continue;
      return { x, z };
    }
    const p = JETTY.at(JETTY.len + 3, 0);
    return { x: p[0], z: p[1] };
  }

  update(dt, posed = true) {
    if (!this.fish.length) return;
    this.clock += dt;
    this.uniforms.uFrozen.value = this.world.env?.garden?.water?.uniforms?.uFrozen?.value ?? 0;
    const [d0, d1] = this.#band(), winter = d0 > 0.8;
    // the season changed: every fish heads for its new depth at once
    if (this.bandWas !== d0) { this.bandWas = d0; for (const f of this.fish) { f.depthGoal = rand(d0, d1); f.goalT = 0; } }
    // somebody on the jetty: the koi come to him and gather beside it near the surface, where he looks
    const pl = this.world.player.position, J = JETTY;
    let feed = null;
    if (!winter && this.owner.playerOutside() && onJetty(pl.x, pl.z)) {
      this.world.camera.getWorldDirection(this._p);
      const s = this._p.x * J.side[0] + this._p.z * J.side[1] >= 0 ? 1 : -1;
      const rx = pl.x - J.root[0], rz = pl.z - J.root[1], along = clamp(rx * J.dir[0] + rz * J.dir[1] + 0.8, 1.5, J.len + 0.8);
      const halfW = along > J.len - J.platLen ? J.platWidth / 2 : J.width / 2;
      const outward = along > J.len - 0.3 && this._p.x * J.dir[0] + this._p.z * J.dir[1] > 0.7;
      const p = outward ? J.at(J.len + 1.1, 0) : J.at(along, s * (halfW + 1.0));
      if (depthAt(p[0], p[1]) > 0.5) feed = { x: p[0], z: p[1] };
    }
    this.feeding = !!feed;
    this.tick = (this.tick || 0) + 1;
    for (let k = 0; k < this.fish.length; k++) {
      const f = this.fish[k];
      f.goalT -= dt;
      let gx, gz, speed = 0.16 + f.len * 0.25, depth;
      if (f.scare > 0) {
        // away from the splash, fast and a little deeper
        f.scare -= dt;
        const dx = f.pos.x - f.from[0], dz = f.pos.z - f.from[1], l = Math.hypot(dx, dz) || 1;
        gx = f.pos.x + dx / l * 4; gz = f.pos.z + dz / l * 4; speed = 1.1; depth = Math.min(d1, f.depth + 0.25);
      } else if (feed && Math.hypot(f.pos.x - feed.x, f.pos.z - feed.z) < 26) {
        // milling round in front of him, the mouths up at the surface
        const a = this.clock * 0.35 + k * 1.9;
        gx = feed.x + Math.cos(a) * (0.5 + 0.35 * Math.sin(k * 2.3)); gz = feed.z + Math.sin(a * 1.3) * (0.45 + 0.3 * Math.cos(k));
        speed = Math.hypot(f.pos.x - gx, f.pos.z - gz) > 2 ? 0.45 : 0.16; depth = 0.07 + 0.05 * Math.sin(k * 1.7 + this.clock * 0.5);
      } else {
        if (!f.goal || f.goalT <= 0 || Math.hypot(f.goal.x - f.pos.x, f.goal.z - f.pos.z) < 0.8) { f.goal = this.#goal(f); f.goalT = rand(15, 40); f.depthGoal = rand(d0, d1); }
        gx = f.goal.x; gz = f.goal.z; depth = f.depthGoal ?? (d0 + d1) / 2;
        if (winter) speed *= 0.35;
      }
      // apart from each other, off the shore and the lilies
      let ax = gx - f.pos.x, az = gz - f.pos.z;
      const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
      for (const o of this.fish) { if (o === f) continue; const dx = f.pos.x - o.pos.x, dz = f.pos.z - o.pos.z, d = Math.hypot(dx, dz), min = (f.len + o.len) * 0.6; if (d < min && d > 1e-4) { ax += dx / d * (min - d) * 6; az += dz / d * (min - d) * 6; } }
      // (the shore, the shallows and the lilies looked up every fourth frame, the fish in turn: they move a few
      // centimetres meanwhile)
      if ((this.tick + k) % 4 === 0 || f.away === undefined) f.away = lakeDist(f.pos.x, f.pos.z) > 0.85 || depthAt(f.pos.x, f.pos.z) < depth + 0.2 || lilyWeight(f.pos.x, f.pos.z) > 0.01;
      if (f.away) { const dx = LAKE.x - f.pos.x, dz = LAKE.z - f.pos.z, l = Math.hypot(dx, dz) || 1; ax += dx / l * 1.5; az += dz / l * 1.5; }
      // the heading turns slowly towards the way (a fish does not spin on the spot)
      const rate = (f.scare > 0 ? 2.6 : 0.9) * dt, turn = clamp(wrap(Math.atan2(ax, az) - f.yaw), -rate, rate);
      f.yaw = wrap(f.yaw + turn);
      f.turn += (turn / Math.max(dt, 1e-3) - f.turn) * (1 - Math.exp(-4 * dt));
      f.speed += (speed - f.speed) * (1 - Math.exp(-1.5 * dt));
      const nx = f.pos.x + Math.sin(f.yaw) * f.speed * dt, nz = f.pos.z + Math.cos(f.yaw) * f.speed * dt;
      // never out of the water: it turns before the shore
      const dn = depthAt(nx, nz);
      if (dn > 0.25 && lakeDist(nx, nz) < 0.93) { f.pos.x = f.fx = nx; f.pos.z = f.fz = nz; f.floor = dn; } else f.yaw = wrap(f.yaw + rate * 2);
      // below the surface, above the bed (the depth under it: from the step just taken, or looked up when it was put
      // somewhere else)
      if (f.floor == null || Math.abs(f.pos.x - f.fx) + Math.abs(f.pos.z - f.fz) > 0.1) { f.floor = depthAt(f.pos.x, f.pos.z); f.fx = f.pos.x; f.fz = f.pos.z; }
      const floor = f.floor;
      f.depth += (clamp(depth, 0.06, Math.max(0.08, floor - 0.12)) - f.depth) * (1 - Math.exp(-(winter ? 1.5 : 0.8) * dt));
      f.depth = clamp(f.depth, 0.05, Math.max(0.06, floor - 0.06));
      f.pos.y = WATER_Y - f.depth;
      f.pitch += ((feed && !(f.scare > 0) ? 0.18 : 0) - f.pitch) * (1 - Math.exp(-2 * dt));
      // tail beat and fins by speed, a curve in turns
      f.phase += dt * (3.2 + f.speed * 9); f.finPhase += dt * (2 + f.speed * 3);
      f.bend += (clamp(-f.turn * 0.12, -0.12, 0.12) - f.bend) * (1 - Math.exp(-3 * dt));
      // now and then one gathering at the surface breaks it: a small ring
      if (feed && f.depth < 0.1 && Math.random() < dt * 0.08) this.owner.splash?.(f.pos.x + Math.sin(f.yaw) * f.len * 0.45, f.pos.z + Math.cos(f.yaw) * f.len * 0.45, 0.25, true);
      f.vis = winter ? 0.55 : 1;
    }
    if (posed) this.#draw();
  }
  #draw() {
    const n = this.fish.length, at = this.attrs;
    for (let i = 0; i < n; i++) {
      const f = this.fish[i];
      this._q.setFromEuler(this._e.set(-f.pitch, f.yaw, 0, 'YXZ'));
      this._m.compose(f.pos, this._q, this._s.setScalar(f.len));
      this.mesh.setMatrixAt(i, this._m);
      at.aSwim.setXYZW(i, f.phase, 0.035 + 0.02 * Math.min(1, f.speed * 2), f.bend, f.pattern);
      at.aKoi.setXYZW(i, f.finPhase, f.vis, f.metal, 0);
    }
    let count = n;
    if (this.prewarmFrames > 0 && n <= this.N) {
      // one more fish far below the ground in the first frames
      this.prewarmFrames--;
      this._m.makeTranslation(0, -80, 0); this.mesh.setMatrixAt(n, this._m); count = n + 1;
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true; at.aSwim.needsUpdate = true; at.aKoi.needsUpdate = true;
  }
  info() { return { n: this.fish.length, feeding: !!this.feeding, fish: this.fish.map((f) => ({ x: +f.pos.x.toFixed(2), y: +f.pos.y.toFixed(3), z: +f.pos.z.toFixed(2), depth: +f.depth.toFixed(2), len: +f.len.toFixed(2), pattern: PATTERNS[f.pattern].name, speed: +f.speed.toFixed(2) })) }; }
}
