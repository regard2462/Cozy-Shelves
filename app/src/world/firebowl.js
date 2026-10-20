// The fire bowl on the lawn west of the path (outdoor.js FIREBOWL): a forged iron bowl on three curved legs with split
// logs in it, and four log stumps round it to sit on (layout.js places both; world.js builds them with fireBowlProp and
// logStump). The fire itself is drawn by FireBowl (garden.js owns it): flames that turn towards the eye, a bed of
// glowing embers, sparks that rise and wink out, and in calm weather a little smoke, all in two instanced meshes that
// share one small shader program. Its light reaches the ground, the stumps, the trees and everything else of the garden
// round it through the garden materials (nature.js NATURE.uFireLight, natFire): the point lights stay as many as before.
// It is lit from dusk to dawn; E on the bowl lights it or puts it out (world-actions.js), and that choice holds until
// the next dusk or dawn.
//
// For the sounds (the crackle): world.fireBowl is this FireBowl: `position` (THREE.Vector3, the middle of the fire),
// `isBurning()`, `level` (0 … 1, how strongly it burns now) and the bus event 'firebowl:change' ({ burning }).
import * as THREE from 'three';
import { Parts, seeded } from './geo.js';
import { NATURE, natureMaterial, barkTexture } from './nature.js';
import { FIREBOWL } from './outdoor.js';
import { bus } from '../core/bus.js';

/** Burning right now (the HUD's label below the crosshair asks: "Feuer anzünden" or "Feuer löschen"). */
let litNow = false;
export const fireBowlLit = () => litNow;

// ---------------------------------------------------------------- materials ---------------------------------------
const texCache = new Map();
const cached = (k, make) => { if (!texCache.has(k)) texCache.set(k, make()); return texCache.get(k); };
/** Forged iron that has stood outside: dark, with rust in patches (128², tileable). */
function rustTexture() {
  return cached('rust', () => {
    const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), img = g.createImageData(N, N), d = img.data, rnd = seeded(61);
    const grid = Array.from({ length: 16 * 16 }, () => rnd());
    const at = (x, y) => { const fx = x / 8, fy = y / 8, i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, s = (a, b) => grid[((b + 16) % 16) * 16 + ((a + 16) % 16)]; const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty); return (s(i, j) * (1 - sx) + s(i + 1, j) * sx) * (1 - sy) + (s(i, j + 1) * (1 - sx) + s(i + 1, j + 1) * sx) * sy; };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const n = at(x, y) * 0.7 + at(x * 2.3, y * 2.3) * 0.3, rust = Math.max(0, n - 0.45) * 2.2, k = (y * N + x) * 4, sp = 0.85 + rnd() * 0.3;
      d[k] = (44 + rust * 90) * sp; d[k + 1] = (40 + rust * 38) * sp; d[k + 2] = (38 + rust * 12) * sp; d[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  });
}
/** The sawn top of a stump: annual rings round a darker heart, a few cracks, grey from the weather at the rim. */
function ringsTexture() {
  return cached('rings', () => {
    const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), rnd = seeded(29);
    g.fillStyle = 'rgb(120,98,72)'; g.fillRect(0, 0, N, N);
    for (let r = N * 0.48; r > 2; r -= 2.2 + rnd() * 2.6) {
      const v = 0.82 + rnd() * 0.3, heart = r < N * 0.18 ? 0.86 : 1;
      g.strokeStyle = `rgb(${Math.round(150 * v * heart)},${Math.round(122 * v * heart)},${Math.round(90 * v * heart)})`; g.lineWidth = 1.3 + rnd();
      g.beginPath(); g.ellipse(N / 2 + (rnd() - 0.5) * 2, N / 2 + (rnd() - 0.5) * 2, r, r * (0.96 + rnd() * 0.04), 0, 0, Math.PI * 2); g.stroke();
    }
    // cracks from the heart outwards, the weathered grey rim
    g.strokeStyle = 'rgba(40,30,22,0.8)'; g.lineWidth = 1.6;
    for (let k = 0; k < 5; k++) { const a = rnd() * Math.PI * 2, l = N * (0.12 + rnd() * 0.3); g.beginPath(); g.moveTo(N / 2, N / 2); g.lineTo(N / 2 + Math.cos(a) * l, N / 2 + Math.sin(a) * l); g.stroke(); }
    const gr = g.createRadialGradient(N / 2, N / 2, N * 0.3, N / 2, N / 2, N * 0.5);
    gr.addColorStop(0, 'rgba(140,136,128,0)'); gr.addColorStop(1, 'rgba(110,104,96,0.75)');
    g.fillStyle = gr; g.fillRect(0, 0, N, N);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  });
}
let mats = null;
/** The bowl's iron, the logs in it (they glow while the fire burns), the stumps' bark and their sawn tops: garden
 *  materials of the kinds the garden has already (no program of their own). */
function materials() {
  if (mats) return mats;
  const bark = barkTexture('oak');
  mats = {
    iron: natureMaterial('plain', { map: rustTexture(), color: 0xffffff, roughness: 0.78, metalness: 0.45, fog: false }),
    logs: natureMaterial('plain', { map: bark.map, normalMap: bark.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), color: 0x6a5a4e, roughness: 0.95, emissive: 0xff5a14, emissiveIntensity: 0, fog: false }),
    bark: natureMaterial('plain', { map: bark.map, normalMap: bark.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), color: 0xc8beb2, roughness: 0.93, fog: false }),
    top: natureMaterial('plain', { map: ringsTexture(), color: 0xffffff, roughness: 0.9, fog: false }, { litter: 0.5 }),
  };
  return mats;
}

// ---------------------------------------------------------------- the bowl and the stumps ---------------------------
/** The bowl: rim 0.82 m across at 0.52 m, 0.2 m deep, on three curved legs, four split logs in it. Faces any way. */
export function fireBowlProp() {
  const M = materials(), p = new Parts();
  // the bowl: a lathe through its inner face, the rolled rim and its outer face
  const prof = [[0, 0.335], [0.12, 0.338], [0.22, 0.352], [0.31, 0.383], [0.37, 0.43], [0.402, 0.495], [0.416, 0.522], [0.43, 0.523], [0.433, 0.51], [0.42, 0.49], [0.385, 0.425], [0.325, 0.37], [0.23, 0.33], [0.12, 0.312], [0, 0.308]];
  const bowl = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 36);
  { const uv = bowl.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 1.6); }
  p.add(bowl, M.iron); bowl.dispose();
  // three legs: flat bars bent outwards from under the bowl to the ground
  for (let k = 0; k < 3; k++) {
    const a = k * Math.PI * 2 / 3 + 0.4, pts = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push(new THREE.Vector3(Math.cos(a) * (0.18 + 0.27 * Math.sin(t * Math.PI * 0.5)), 0.33 * (1 - t) + 0.015, Math.sin(a) * (0.18 + 0.27 * Math.sin(t * Math.PI * 0.5)))); }
    for (let i = 0; i < pts.length - 1; i++) {
      const a0 = pts[i], a1 = pts[i + 1], len = a0.distanceTo(a1) + 0.012, g = new THREE.BoxGeometry(0.05, len, 0.014);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), a1.clone().sub(a0).normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a));
      p.addMatrix(g, M.iron, new THREE.Matrix4().compose(a0.clone().add(a1).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1))); g.dispose();
    }
    // a small foot
    const foot = new THREE.BoxGeometry(0.07, 0.012, 0.05);
    p.addMatrix(foot, M.iron, new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * 0.45, 0.006, Math.sin(a) * 0.45), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a), new THREE.Vector3(1, 1, 1))); foot.dispose();
  }
  // the logs: two pairs across each other, a fifth leaning against them
  const logs = [[0, 0.385, 0.06, 0.44, 0.052, 0.1, 0], [0, 0.385, -0.07, 0.42, 0.048, -0.05, 0], [0.05, 0.45, 0, 0.4, 0.045, 1.62, 0.04], [-0.07, 0.45, 0.01, 0.38, 0.042, 1.5, -0.05], [0.02, 0.5, 0.04, 0.34, 0.036, 0.8, 0.5]];
  for (const [x, y, z, len, r, yaw, tilt] of logs) {
    const g = new THREE.CylinderGeometry(r * 0.92, r, len, 7, 1);
    { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i) * 0.25); }
    // laid along x, one end raised by `tilt`, turned by `yaw`
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, Math.PI / 2 + tilt, 'YXZ'));
    p.addMatrix(g, M.logs, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1))); g.dispose();
  }
  const obj = p.build({ name: 'firebowl' });
  // no box collider: outdoor.js holds the bowl as a circle (the player and the animals keep out of it)
  obj.userData.footprint = null;
  return obj;
}

/** A log stump to sit on, facing local +z (the bowl): bark round it, the sawn top with its rings. */
export function logStump({ seed = 1 } = {}) {
  const M = materials(), rnd = seeded(seed), p = new Parts();
  const h = 0.44 + rnd() * 0.05, r = 0.21 + rnd() * 0.04;
  const g = new THREE.CylinderGeometry(r, r * 1.16, h, 14, 3, true);
  // a little uneven, the foot flared where the roots went
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), a = Math.atan2(z, x), k = 1 + 0.05 * Math.sin(a * 3 + seed) + 0.03 * Math.sin(a * 7 + seed * 2) + (y < -h / 2 + 0.01 ? 0.08 * Math.max(0, Math.sin(a * 4 + seed)) : 0);
    pos.setXYZ(i, x * k, y, z * k);
  }
  g.computeVertexNormals();
  { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.4, uv.getY(i) * 0.16); }
  p.add(g, M.bark, [0, h / 2, 0]); g.dispose();
  const top = new THREE.CircleGeometry(r * 1.02, 18);
  p.add(top, M.top, [0, h + 0.002, 0], [-Math.PI / 2, 0, rnd() * 6]); top.dispose();
  const obj = p.build({ name: 'stump' });
  obj.userData.footprint = null;
  // seated on it, the eye looks at the fire (the bowl is about 1.85 m away)
  obj.userData.seat = { eye: [0, h + 0.68, -0.03], look: [0, h + 0.2, 1.85], kind: 'stump', pitch: -0.2 };
  return obj;
}

// ---------------------------------------------------------------- the fire ---------------------------------------------
const fireVert = `
attribute vec4 aFire;   // seed, what (0 flame, 1 embers, 2 smoke, 3 spark), width, height
uniform float uTime; uniform float uLevel; uniform float uEmbers; uniform float uSmoke; uniform vec3 uDrift;
varying vec2 vUv; varying float vWhat; varying float vSeed; varying float vFade; varying float vLife;
void main() {
  vUv = uv; vWhat = aFire.y; vSeed = aFire.x; vLife = 0.0;
  vec3 base = instanceMatrix[3].xyz;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 p;
  if (aFire.y < 0.5) {
    // a flame: a sheet turned about the upright towards the eye, its height breathing, its tip leaning with the wind
    vec3 r = normalize(vec3(right.x, 0.0, right.z) + vec3(1e-4, 0.0, 0.0));
    float h = aFire.w * (0.25 + 0.75 * uLevel) * (0.82 + 0.18 * sin(uTime * (2.3 + aFire.x) + aFire.x * 17.0));
    float k = position.y + 0.5;
    p = base + r * position.x * aFire.z * (0.4 + 0.6 * uLevel) + vec3(0.0, k * h, 0.0) + uDrift * (k * k * h * 0.35);
    vFade = uLevel;
  } else if (aFire.y < 1.5) {
    // the bed of embers under the logs
    p = base + vec3(position.x, 0.0, -position.y) * aFire.z;
    vFade = max(uLevel, uEmbers);
  } else if (aFire.y < 2.5) {
    // a puff of smoke: rises, grows and fades, drifting with the wind and wandering a little
    float life = fract(uTime * 0.075 + aFire.x);
    float size = aFire.z * (0.35 + 2.0 * life);
    vec3 wander = vec3(sin(life * 7.0 + aFire.x * 30.0), 0.0, cos(life * 5.0 + aFire.x * 20.0)) * 0.35 * life;
    p = base + vec3(0.0, life * 4.0, 0.0) + uDrift * (life * life * 5.0) + wander + (right * position.x + up * position.y) * size;
    vFade = uSmoke * smoothstep(0.0, 0.12, life) * (1.0 - life);
    vLife = life;
  } else {
    // a spark: thrown up out of the fire, slowing, drifting, winking out
    float life = fract(uTime * (0.45 + 0.35 * fract(aFire.x * 7.3)) + aFire.x);
    float a = aFire.x * 61.0 + floor(uTime * (0.45 + 0.35 * fract(aFire.x * 7.3)) + aFire.x) * 2.39;
    vec3 off = vec3(cos(a), 0.0, sin(a)) * (0.06 + 0.35 * life * fract(aFire.x * 3.1));
    off += vec3(sin(uTime * 3.0 + aFire.x * 20.0), 0.0, cos(uTime * 2.6 + aFire.x * 30.0)) * 0.06 * life;
    p = base + off + vec3(0.0, (1.0 - (1.0 - life) * (1.0 - life)) * (1.2 + 1.8 * fract(aFire.x * 13.7)), 0.0) + uDrift * life * 1.2 + (right * position.x + up * position.y) * aFire.z;
    vFade = uLevel * (1.0 - smoothstep(0.55, 1.0, life)) * step(0.15, fract(aFire.x * 5.7 + floor(uTime * 0.5)));
    vLife = life;
  }
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const fireFrag = `
uniform float uTime; uniform vec3 uSmokeCol; uniform vec3 uSmokeFire;
varying vec2 vUv; varying float vWhat; varying float vSeed; varying float vFade; varying float vLife;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; } return v; }
void main() {
  if (vFade < 0.003) discard;
  if (vWhat < 0.5) {
    // tongues of flame licking up through noise: yellow-white low in the heart, orange, a deep red at the tips
    float side = 1.0 - pow(abs(vUv.x - 0.5) * 2.0, 1.3 + vUv.y * 2.2);
    // (the noise stays below 0.94: where even the most of it could not light this pixel, the noise is not worked out)
    if (1.62 * (1.0 - smoothstep(0.05, 1.0, vUv.y)) * side - vUv.y * 0.42 < 0.12) discard;
    float t = uTime * 1.2 + vSeed * 10.0;
    vec2 q = vec2(vUv.x * 2.6 + vSeed * 5.0, vUv.y * 1.6 - t * 2.1);
    float n = fbm(q + fbm(q * 1.9 + t * 0.45) * 1.1);
    float flame = clamp((n * 1.7 - 0.08) * (1.0 - smoothstep(0.05, 1.0, vUv.y)) * side - vUv.y * 0.42, 0.0, 1.0);
    float f = smoothstep(0.12, 0.5, flame) * vFade;
    float heat = f * (1.0 - 0.6 * vUv.y);
    vec3 col = mix(vec3(0.95, 0.16, 0.02), vec3(1.0, 0.5, 0.08), smoothstep(0.1, 0.6, heat));
    col = mix(col, vec3(1.0, 0.86, 0.5), smoothstep(0.55, 0.95, heat));
    gl_FragColor = vec4(col * f * 1.05, f);
  } else if (vWhat < 1.5) {
    // embers: glowing cells between dark cracks, breathing slowly
    float r = length(vUv - 0.5) * 2.0;
    if (r > 1.0) discard;
    float n = fbm(vUv * 7.0 + vec2(uTime * 0.04, -uTime * 0.03));
    float cell = smoothstep(0.42, 0.68, n) * (0.7 + 0.3 * sin(uTime * 1.7 + n * 12.0));
    float e = cell * (1.0 - smoothstep(0.55, 1.0, r)) * vFade;
    gl_FragColor = vec4(mix(vec3(0.9, 0.12, 0.02), vec3(1.0, 0.45, 0.08), cell) * e * 1.5, e);
  } else if (vWhat < 2.5) {
    // smoke: a soft grey puff, lit by the sky (and the fire from below at night: uSmokeCol)
    float r = length(vUv - 0.5) * 2.0;
    if (r >= 1.0) discard;   // (the corners of the quad: nothing of the puff there)
    float n = fbm(vUv * 2.6 + vSeed * 7.0 + vec2(0.0, -uTime * 0.05));
    float n2 = fbm(vUv * 5.3 - vSeed * 3.0 + vec2(uTime * 0.03, -uTime * 0.07));
    float a = (1.0 - smoothstep(0.1, 1.0, r)) * smoothstep(0.35, 0.8, n * 0.7 + n2 * 0.5 + 0.2 * (1.0 - r)) * vFade * 0.16;
    // the fire lights it from below: warm just above the flames, grey higher up
    float low = (1.0 - vLife) * (1.0 - vLife); low *= low * low;
    gl_FragColor = vec4(uSmokeCol * (0.85 + 0.3 * n) + uSmokeFire * low, a);
  } else {
    float r = length(vUv - 0.5) * 2.0;
    float s = (1.0 - smoothstep(0.0, 1.0, r)) * vFade;
    gl_FragColor = vec4(mix(vec3(1.0, 0.85, 0.45), vec3(1.0, 0.35, 0.06), vLife) * s * 2.2, s);
  }
}`;

/**
 * The fire in the bowl. update(dt, time) every frame, apply({ night, weather, wind }) when the light or the weather
 * changes. `position`, `isBurning()`, `level`, `toggle()`, `setBurning(on)` (true, false, or null: by the clock again).
 */
export class FireBowl {
  constructor() {
    const F = FIREBOWL;
    this.position = new THREE.Vector3(F.x, F.y + 0.55, F.z);
    this.level = 0; this.embers = 0;
    this.auto = false; this.manual = null; this.wind = 0.3; this.calm = 1;
    this.group = new THREE.Group(); this.group.name = 'firebowl-fire';
    this.u = { uTime: { value: 0 }, uLevel: { value: 0 }, uEmbers: { value: 0 }, uSmoke: { value: 0 }, uDrift: { value: new THREE.Vector3(0.3, 0, 0.1) }, uSmokeCol: { value: new THREE.Color(0.5, 0.5, 0.5) }, uSmokeFire: { value: new THREE.Color(0, 0, 0) } };
    // one program for both: the flames, embers and sparks add their light, the smoke covers what is behind it
    const glow = new THREE.ShaderMaterial({ vertexShader: fireVert, fragmentShader: fireFrag, uniforms: this.u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const smoke = new THREE.ShaderMaterial({ vertexShader: fireVert, fragmentShader: fireFrag, uniforms: this.u, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.mats = [glow, smoke];
    const quad = new THREE.PlaneGeometry(1, 1);
    const rnd = seeded(808), y = F.y;
    const fire = [];   // [x, y, z, seed, what, w, h]
    for (let k = 0; k < 8; k++) { const a = rnd() * Math.PI * 2, d = rnd() * 0.12; fire.push([Math.cos(a) * d, y + 0.37, Math.sin(a) * d, rnd(), 0, 0.24 + rnd() * 0.16, 0.55 + rnd() * 0.42]); }
    fire.push([0, y + 0.352, 0, 0.5, 1, 0.56, 0]);
    for (let k = 0; k < 34; k++) fire.push([(rnd() - 0.5) * 0.12, y + 0.45, (rnd() - 0.5) * 0.12, rnd(), 3, 0.012 + rnd() * 0.01, 0]);
    const puffs = [];
    for (let k = 0; k < 18; k++) puffs.push([(rnd() - 0.5) * 0.16, y + 0.8, (rnd() - 0.5) * 0.16, rnd(), 2, 0.45 + rnd() * 0.35, 0]);
    const make = (list, mat, name, rise, reach) => {
      const geo = quad.clone();
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 4), 4);
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      const m = new THREE.Matrix4();
      list.forEach(([x, yy, z, seed, what, w, h], i) => { mesh.setMatrixAt(i, m.makeTranslation(F.x + x, yy, F.z + z)); attr.setXYZW(i, seed, what, w, h); });
      geo.setAttribute('aFire', attr);
      mesh.instanceMatrix.needsUpdate = true;
      // (the shader moves everything: the sparks rise up to 3 m above the bowl, the smoke 5 m and drifts with the wind;
      // the bounds hold all of it, so that the fire is not drawn when it is out of sight)
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(F.x, y + rise, F.z), reach);
      mesh.castShadow = false; mesh.receiveShadow = false; mesh.userData.noAO = true; mesh.name = name;
      return mesh;
    };
    this.fire = make(fire, glow, 'firebowl-flames', 1.9, 3.5); this.fire.renderOrder = 7;
    this.smokeMesh = make(puffs, smoke, 'firebowl-smoke', 2.8, 10); this.smokeMesh.renderOrder = 6;
    quad.dispose();
    this.group.add(this.smokeMesh, this.fire);
    this.tmp = new THREE.Color();
  }
  isBurning() { return this.manual ?? this.auto; }
  /** E on the bowl: light it or put it out (until the next dusk or dawn). */
  toggle() { this.setBurning(!this.isBurning()); return this.isBurning(); }
  setBurning(on) {
    const before = this.isBurning();
    this.manual = on == null ? null : !!on;
    if (this.isBurning() !== before) bus.emit?.('firebowl:change', { burning: this.isBurning() });
    litNow = this.isBurning();
  }
  /** Dusk to dawn it burns by itself; a choice made with E holds until the clock turns that again. */
  apply({ night = 0, weather = 'clear', wind = 0.3 } = {}) {
    const before = this.isBurning();
    const auto = night > 0.55;
    if (auto !== this.auto) { this.auto = auto; this.manual = null; }
    this.wind = wind;
    // smoke stands up in calm air; wind tears it away, rain and fog hide it
    this.calm = { clear: 1, overcast: 0.8, fog: 0.35, rain: 0.25, storm: 0, snow: 0.55 }[weather] ?? 0.8;
    if (this.isBurning() !== before) bus.emit?.('firebowl:change', { burning: this.isBurning() });
    litNow = this.isBurning();
  }
  /** Skip the lighting up or the dying down (the checks, screenshots). */
  settle() { this.level = this.isBurning() ? 1 : 0; this.embers = this.level; }
  update(dt, time) {
    const on = this.isBurning();
    // it takes a few seconds to catch, and longer to die down; the embers glow on for a while
    this.level = on ? Math.min(1, this.level + dt / 3) : Math.max(0, this.level - dt / 4.5);
    this.embers = on ? Math.max(this.embers, this.level) : Math.max(0, this.embers - dt / 25);
    const flicker = 0.82 + 0.1 * Math.sin(time * 9.7) + 0.06 * Math.sin(time * 23.3 + 1.3) + 0.05 * Math.sin(time * 3.7);
    const u = this.u;
    u.uTime.value = time; u.uLevel.value = this.level; u.uEmbers.value = this.embers;
    u.uSmoke.value = Math.min(1, this.level * 0.7 + (on ? 0 : this.embers * 0.6)) * this.calm * Math.max(0, 1 - this.wind * 1.1);
    u.uDrift.value.set(0.9, 0, 0.3).multiplyScalar(0.25 + this.wind * 1.4);
    // the smoke: grey in the sky's light, warmer from below at night where the fire lights it
    u.uSmokeCol.value.copy(NATURE.uSkyLight.value).multiplyScalar(1.2).add(this.tmp.setRGB(0.012, 0.012, 0.014));
    u.uSmokeFire.value.setRGB(1, 0.42, 0.14).multiplyScalar(0.3 * this.level);
    // the light on everything round it (nature.js natFire), and the logs glowing under the flames
    const light = this.level * flicker + this.embers * 0.12;
    NATURE.uFireLight.value.setRGB(1.0, 0.46, 0.16).multiplyScalar(light * 2.6);
    NATURE.uFirePos.value.copy(this.position);
    materials().logs.emissiveIntensity = 0.06 * this.embers + 0.22 * this.level * flicker;
    this.fire.visible = this.level > 0.002 || this.embers > 0.002;
    this.smokeMesh.visible = u.uSmoke.value > 0.004;
  }
  dispose() { for (const m of [this.fire, this.smokeMesh]) m.geometry.dispose(); for (const m of this.mats) m.dispose(); }
}
