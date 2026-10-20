// The golden hour and god rays.
//
// The golden hour is a time of day of its own (settings: timeMode 'golden'): a low, warm evening sun north-west of the
// hall, over the lake, sending long beams diagonally through the glass front. Every low sun of the real time and the
// day cycle gets the same look (goldenAmount): a warm orange-pink sky at the horizon under a soft blue-violet one,
// warm haze, gold light, subtle lamps and a little more bloom (applyGolden, called at the end of Environment#apply).
//
// God rays make the sunlight visible in the air. A pass in the post chain marches along every view ray (at half or a
// quarter of the resolution) up to the depth of the scene, asks the sun's shadow map at each step whether the air there
// is lit, scatters the light towards the eye (Henyey-Greenstein, mostly forwards) and blurs the result with respect to
// depth; the vignette's pass adds it to the picture at full resolution. Inside it is dust (in streaks along the light),
// outside haze and fog, thicker near the ground. Dust motes drift through the rooms and only show where the sun reaches.
//
// Smoothness (0.8): every low pixel stands for a block of full pixels and keeps the light up to the nearest and up to
// the farthest surface in its block, so a leaf and the gap beside it each get their own light when the picture is put
// together at full resolution (nothing bleeds over an edge, nothing flickers when a reed sways through a block). The
// steps are jittered with blue noise instead of a hashed pattern (whose lines the blur let through), the jitter moves on
// by the golden ratio each frame, and the blurred result is blended with the last frame's where the same surfaces stood
// (reprojected by depth), so the noise averages away and a change of the light fades in over a few frames.
//
// The trees cast into the sun's shadow map: a coarse depth map of the trees, seen from the sun over the whole garden
// (TreeShadow), is pressed into the sun's map every time three.js draws it (a full-screen triangle with a depth
// material of its own). The map of the trees is drawn again when the sun has gone on by a fraction of a texel's worth
// (environment.js decides, for both maps) or the player has walked on; its centre moves in whole texels of its own.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { smoothstep, seeded } from './geo.js';
import { SKY } from './sky.js';
import { NATURE } from './nature.js';
import { HALL, PASSAGE, ROOM } from './layout.js';
import { WATER_Y } from './outdoor.js';
import { blendWeather } from './sky-state.js';
import { blueNoiseTexture, BLUE_SIZE } from './bluenoise.js';

/** The sun of the golden hour: azimuth (x = cos, z = sin, as in sunPosition), elevation in radians, and the hour the
 *  clock shows meanwhile. North-west of the hall towards the lake, 8° high: where the wood leaves a gap, so it shines
 *  through the glass front deep into the hall. */
export const GOLDEN = { az: 2.04, elev: 0.14, hour: 19.9 };
export function goldenSun(out = new THREE.Vector3()) {
  const c = Math.cos(GOLDEN.elev);
  return out.set(Math.cos(GOLDEN.az) * c, Math.sin(GOLDEN.elev), Math.sin(GOLDEN.az) * c).normalize();
}
/** How golden the light of a sun at height y (the sine of its elevation) is: 1 from about 2° to 11°, 0 by day and night. */
export function goldenAmount(y) { return smoothstep(-0.035, 0.03, y) * (1 - smoothstep(0.2, 0.4, y)); }

// how much of the golden look and of the rays each weather leaves
const CLEAR = { clear: 1, overcast: 0.3, rain: 0.08, storm: 0, snow: 0.35, fog: 0.9 };
const RAYS = { clear: 1, overcast: 0.3, rain: 0, storm: 0, snow: 0.25, fog: 1 };
// air: scattering per metre inside (dust) and outside at the ground (haze), the outside thinning with height
const AIR = { clear: [0.024, 0.0016], overcast: [0.01, 0.0025], rain: [0.01, 0.006], storm: [0.01, 0.008], snow: [0.012, 0.006], fog: [0.016, 0.02] };

const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b);
const G = {
  zenith: lin(0.16, 0.17, 0.42), horizon: lin(1.0, 0.56, 0.38), glow: lin(1.0, 0.42, 0.12), disc: lin(1.0, 0.66, 0.34),
  cloudLit: lin(1.0, 0.52, 0.36), cloudShade: lin(0.3, 0.24, 0.36), haze: lin(0.6, 0.47, 0.47), hazeSun: lin(1.0, 0.5, 0.17),
  sun: lin(1.0, 0.6, 0.3), sky: lin(0.3, 0.25, 0.29), fogHaze: lin(0.33, 0.32, 0.38), fogSun: lin(1.0, 0.6, 0.28),
};
const _c = new THREE.Color();

/**
 * The golden look on top of what Environment#apply has set: sky, haze, sun, the garden's sky light and the light in
 * the rooms, by how low the sun is and how clear the weather. Sets env.golden (0 … 1: lamps, bloom) and env.rays (how
 * strong the god rays are, 0 … 1).
 */
export function applyGolden(env, sunDir, { weather, mix, overcast, brightness, day }) {
  const g = goldenAmount(sunDir.y);
  // (a mix of the weathers, sky-state.js: the old values at the old weathers, blended in between)
  const k = g * (mix ? blendWeather(mix, CLEAR) : CLEAR[weather] ?? 1);
  env.golden = k;
  (env.sunTrue ||= new THREE.Vector3()).copy(sunDir);   // the sun itself (env.sunDir is the moon at night)
  env.rays = (mix ? blendWeather(mix, RAYS) : RAYS[weather] ?? 0) * smoothstep(-0.02, 0.03, sunDir.y) * (0.45 + 0.55 * g);
  env.air = mix ? blendWeather(mix, AIR, env._air ||= [0, 0]) : AIR[weather] || AIR.clear;
  if (k <= 0.001) return;
  const fog = mix ? smoothstep(0.45, 0.95, mix.fog) > 0.5 : weather === 'fog';
  const lum = 0.35 + 1.05 * day;
  if (fog) {
    // golden fog: the mist itself (the light of the sky in it) a dim, cool grey; the sun's light in it is gold and comes
    // with the god rays, bright where the sun reaches and dim in the shadows of the trees, so the shafts stand out
    const h = _c.copy(G.fogHaze).multiplyScalar(lum * 0.8);
    SKY.uHorizon.value.lerp(h, k); SKY.uZenith.value.lerp(h, k);
    SKY.uCloudLit.value.lerp(_c.copy(G.fogHaze).multiplyScalar(lum * 0.84), k); SKY.uCloudShade.value.lerp(_c.copy(G.fogHaze).multiplyScalar(lum * 0.76), k);
    NATURE.uHazeColor.value.lerp(_c.copy(G.fogHaze).multiplyScalar(lum * 0.72), k);
    NATURE.uHazeSun.value.lerp(_c.copy(G.fogSun).multiplyScalar(0.35), k);
    SKY.uSunGlow.value.lerp(_c.copy(G.glow).multiplyScalar(0.6), k);
    SKY.uSunDisc.value.lerp(_c.copy(G.disc).multiplyScalar(4), k);
  } else {
    SKY.uZenith.value.lerp(_c.copy(G.zenith).multiplyScalar(lum), k * 0.85);
    SKY.uHorizon.value.lerp(_c.copy(G.horizon).multiplyScalar(lum), k * 0.85);
    SKY.uCloudLit.value.lerp(_c.copy(G.cloudLit).multiplyScalar(lum * 0.95), k);
    SKY.uCloudShade.value.lerp(_c.copy(G.cloudShade).multiplyScalar(lum * 0.8), k);
    NATURE.uHazeColor.value.lerp(_c.copy(G.haze).multiplyScalar(lum), k);
    NATURE.uHazeSun.value.lerp(_c.copy(G.hazeSun).multiplyScalar(1.3), k);
    SKY.uSunGlow.value.lerp(_c.copy(G.glow).multiplyScalar(1.5), k);
    SKY.uSunDisc.value.lerp(_c.copy(G.disc).multiplyScalar(18), k);
  }
  // a gold sun, a little stronger than the plain low sun (in fog it breaks through the mist)
  if (sunDir.y > 0.02) {
    env.sun.color.lerp(G.sun, k);
    const strong = (fog ? 1.25 : 1.9) * (1 - overcast * (fog ? 0.35 : 0.85)) * brightness;
    env.sun.intensity += (strong - env.sun.intensity) * k;
    NATURE.uSunLight.value.copy(env.sun.color).multiplyScalar(env.sun.intensity);
  }
  // less light from the sky: the sunlit parts stand out
  NATURE.uSkyLight.value.lerp(_c.copy(G.sky).multiplyScalar(brightness), k * 0.7);
  env.hemi.color.lerp(_c.setRGB(1.0, 0.72, 0.5), k * 0.5);
  env.baseHemi *= 1 - 0.7 * k; env.hemi.intensity = env.baseHemi;
  env.baseAmbient *= 1 - 0.6 * k; env.ambient.intensity = env.baseAmbient;
  env.scene.fog?.color.copy(NATURE.uHazeColor.value).multiplyScalar(0.9);
}

// ---------------------------------------------------------------- the trees in the sun's shadow map -------------------
export const TREE_LAYER = 7;
const treeDepthVert = `
#include <common>
#include <batching_pars_vertex>
varying vec2 vUv;
void main() {
  #include <batching_vertex>
  vUv = uv;
  vec3 transformed = vec3(position);
  #include <project_vertex>
}`;
const treeDepthFrag = `
uniform sampler2D map; uniform float uLeaf; uniform float uWinter;
varying vec2 vUv;
void main() {
  // the leaves' texture holds the summer crown on its left half, the bare winter twigs on its right (nature.js)
  if (uLeaf > 0.5 && texture2D(map, vec2(vUv.x * 0.5 + 0.5 * step(0.5, uWinter), vUv.y)).a < 0.5) discard;
  gl_FragColor = vec4(1.0);
}`;
// presses the trees' depth into the sun's shadow map: a full-screen triangle drawn with the shadow camera
const stampVert = `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const stampFrag = `
uniform sampler2D uTreeDepth; uniform sampler2D uTreeCover; uniform mat4 uTreeMatrix; uniform mat4 uInvVP; uniform vec2 uMapSize;
uniform vec2 uDepthMap; uniform vec4 uSoft; uniform float uPorous; uniform sampler2D uBlue;
void main() {
  vec4 w = uInvVP * vec4(gl_FragCoord.xy / uMapSize * 2.0 - 1.0, -1.0, 1.0);
  vec3 tc = (uTreeMatrix * vec4(w.xyz / w.w, 1.0)).xyz;
  if (tc.x <= 0.0 || tc.x >= 1.0 || tc.y <= 0.0 || tc.y >= 1.0) discard;
  float d = texture2D(uTreeDepth, tc.xy).r;
  if (d >= 0.99999) discard;
  // from the depth along the sun in the trees' map to the depth in the sun's map (both look along the sun)
  float dm = d * uDepthMap.x + uDepthMap.y;
  if (dm >= 1.0) discard;
  // The further a crown stands from where its shadow falls (round the player), the more broken that shadow: the sun is a
  // disc, not a point, and thin foliage vanishes in the half-shadow. The trees' coverage averaged over the half-shadow
  // (a mip level of the map) decides: near trees cast as they are, further off only the dense hearts of the crowns, and
  // the wood some 80 m away no longer at all, so the low sun reaches the house through the gaps (shadows far from the
  // eye that nobody sees are not drawn). A fine blue-noise dither softens the edge between the two (a hashed pattern
  // drew its own lines across the half-shadow).
  float D = max(uSoft.x - dm * uSoft.y, 0.0);
  float r = uSoft.w * D / uSoft.z;
  float far = smoothstep(30.0, 85.0, D) * uPorous;
  float c = smoothstep(far, far + 0.12, textureLod(uTreeCover, tc.xy, log2(max(2.0 * r, 1.0))).r);
  if (texelFetch(uBlue, ivec2(mod(gl_FragCoord.xy, ${BLUE_SIZE}.0)), 0).r >= c) discard;
  gl_FragDepth = max(dm, 0.0);
  gl_FragColor = vec4(1.0);
}`;
// draws nothing (the stamp's material in the picture and in the fire's cube shadow)
const noneVert = 'void main() { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); }';
const noneFrag = 'void main() { gl_FragColor = vec4(0.0); }';

/**
 * A depth map of all trees as the sun sees them, ±64 m round the player and some 200 m towards the sun, drawn when the
 * sun or the player has moved on (or the trees lost their leaves), and pressed into the sun's own shadow map.
 */
class TreeShadow {
  constructor() {
    this.size = 0;
    this.target = null;
    this.camera = new THREE.OrthographicCamera(-64, 64, 64, -64, 0, 340);
    this.camera.layers.set(TREE_LAYER);
    this.matrix = new THREE.Matrix4();
    this.dir = new THREE.Vector3(0, 1, 0);
    this.meshes = [];                     // [{ mesh, depth }]
    this.key = '';
    this.valid = false;
    this.renders = 0;                     // (for the checks)
    this.stampU = {
      uTreeDepth: { value: null }, uTreeCover: { value: null }, uTreeMatrix: { value: this.matrix }, uInvVP: { value: new THREE.Matrix4() },
      uMapSize: { value: new THREE.Vector2(1, 1) }, uDepthMap: { value: new THREE.Vector2(1, 0) },
      // x: from the sun's camera to the player, minus its near plane (m); y: its depth range (m); z: metres per texel of
      // the trees' map; w: radius of the half-shadow per metre between crown and ground (the sun's disc, a little more)
      uSoft: { value: new THREE.Vector4(47, 109, 0.0625, 0.006) },
      uPorous: { value: 1 },   // how far the crowns far off are thinned to their hearts (0: not at all)
      uBlue: { value: blueNoiseTexture() },
    };
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const none = () => new THREE.ShaderMaterial({ vertexShader: noneVert, fragmentShader: noneFrag, depthWrite: false, depthTest: false, colorWrite: false });
    const own = none();
    // (the shadow pass draws the depth material with the side of the object's material: both sides)
    own.shadowSide = THREE.DoubleSide;
    this.stamp = new THREE.Mesh(tri, own);
    this.stamp.name = 'tree-shadow-stamp';
    this.stamp.frustumCulled = false; this.stamp.castShadow = false; this.stamp.receiveShadow = false;
    this.stamp.userData.noAO = true;
    // (both sides from the start, as the shadow pass sets it: warmUp then compiles the very program that pass uses)
    this.stamp.customDepthMaterial = new THREE.ShaderMaterial({ vertexShader: stampVert, fragmentShader: stampFrag, uniforms: this.stampU, side: THREE.DoubleSide });
    this.stamp.customDistanceMaterial = none();
    const tmp = new THREE.Vector3(), camPos = new THREE.Vector3();
    this.stamp.onBeforeShadow = (renderer, object, camera, shadowCamera) => {
      // (only the sun's camera is orthographic; the fire's cube faces draw nothing)
      if (!shadowCamera.isOrthographicCamera) return;
      const u = this.stampU, rt = renderer.getRenderTarget();
      u.uInvVP.value.multiplyMatrices(shadowCamera.matrixWorld, shadowCamera.projectionMatrixInverse);
      u.uMapSize.value.set(rt?.width || 1, rt?.height || 1);
      // both cameras look along -dir: a depth in the trees' map is a distance from their camera
      camPos.setFromMatrixPosition(shadowCamera.matrixWorld);
      const along = tmp.copy(this.camera.position).sub(camPos).dot(this.dir) * -1;
      const span = shadowCamera.far - shadowCamera.near;
      u.uDepthMap.value.set((this.camera.far - this.camera.near) / span, (this.camera.near + along - shadowCamera.near) / span);
      const toTarget = this.sun ? this.sun.position.distanceTo(this.sun.target.position) : 48;
      u.uSoft.value.set(toTarget - shadowCamera.near, span, 128 / (this.size || 2048), u.uSoft.value.w);
    };
  }
  /** The trees of the garden (one BatchedMesh per species and part): seen by the camera of this map only. */
  setGarden(group) {
    this.garden = group;
    for (const m of this.meshes) m.depth.dispose();
    this.meshes = [];
    group.traverse((o) => {
      if (!o.isBatchedMesh || !/-(bark|leaves)$/.test(o.name)) return;
      o.layers.enable(TREE_LAYER);
      const leaf = o.name.endsWith('-leaves');
      const depth = new THREE.ShaderMaterial({ vertexShader: treeDepthVert, fragmentShader: treeDepthFrag, side: THREE.DoubleSide,
        uniforms: { map: { value: leaf ? o.material.map : null }, uLeaf: { value: leaf ? 1 : 0 }, uWinter: NATURE.uWinter } });
      this.meshes.push({ mesh: o, depth });
    });
    this.valid = false; this.key = '';
  }
  #ensureTarget(size) {
    if (this.size === size && this.target) return;
    this.target?.dispose();
    const depthTexture = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
    // the colour is the trees' coverage (1 where a crown or a trunk is), its mip levels that coverage averaged
    this.target = new THREE.WebGLRenderTarget(size, size, { format: THREE.RedFormat, type: THREE.UnsignedByteType, depthTexture, depthBuffer: true,
      generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    this.size = size; this.valid = false; this.key = '';
    this.stampU.uTreeDepth.value = depthTexture; this.stampU.uTreeCover.value = this.target.texture;
  }
  /**
   * Draw the map again when environment.js says the sun has gone on (`due`), the player has walked some 16 m on or the
   * season changed. The centre moves in steps that are whole texels along the light's own axes, so the shadows of the
   * trees stay where they are when it does. Returns 'moved' (the player, the season: the sun's map must follow now),
   * 'sun' (drawn for the sun) or false.
   */
  update(renderer, sunDir, center, size, due = false) {
    if (!this.meshes.length) return false;
    this.#ensureTarget(size);
    const fwd = this._f || (this._f = new THREE.Vector3()), right = this._r || (this._r = new THREE.Vector3()), up = this._u || (this._u = new THREE.Vector3());
    fwd.copy(sunDir).negate();
    right.crossVectors(fwd, Math.abs(fwd.y) > 0.98 ? (this._z ||= new THREE.Vector3(0, 0, 1)) : (this._y ||= new THREE.Vector3(0, 1, 0))).normalize();
    up.crossVectors(right, fwd).normalize();
    const texel = 128 / size, step = Math.round(16 / texel) * texel;
    const cr = Math.round((center.x * right.x + 6 * right.y + center.z * right.z) / step) * step;
    const cu = Math.round((center.x * up.x + 6 * up.y + center.z * up.z) / step) * step;
    const key = `${Math.round(cr / step)}:${Math.round(cu / step)}:${NATURE.uWinter.value}:${size}`;
    const fresh = key !== this.key || !this.valid;
    if (!fresh && !due) return false;
    this.key = key;
    this.dir.copy(sunDir);
    // the centre: the snapped position across the light, along it where the player is (6 m up)
    const cf = center.x * fwd.x + 6 * fwd.y + center.z * fwd.z;
    const c = this._c || (this._c = new THREE.Vector3());
    c.copy(right).multiplyScalar(cr).addScaledVector(up, cu).addScaledVector(fwd, cf);
    const cam = this.camera;
    cam.position.copy(c).addScaledVector(sunDir, 210);
    cam.up.set(0, 1, 0);
    if (Math.abs(sunDir.y) > 0.98) cam.up.set(0, 0, 1);
    cam.lookAt(c);
    cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    this.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    this.#draw(renderer);
    this.valid = true; this.renders++;
    return fresh ? 'moved' : 'sun';
  }
  #swap(on) { for (const m of this.meshes) { if (on) { m.orig = m.mesh.material; m.mesh.material = m.depth; } else m.mesh.material = m.orig; } }
  #draw(renderer) {
    const prev = renderer.getRenderTarget(), auto = renderer.autoClear;
    const clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
    this.#swap(true);
    try {
      renderer.autoClear = true; renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(this.target);
      renderer.render(this.garden, this.camera);
    } finally { this.#swap(false); renderer.autoClear = auto; renderer.setClearColor(clear, alpha); renderer.setRenderTarget(prev); }
  }
  /** Compile the trees' depth program without drawing: on a tiny BatchedMesh with colours like the trees' (compiling the
   *  whole garden for this camera would build every garden material once more for a scene without lights). */
  warmUp(renderer) {
    if (!this.meshes.length) return;
    this.#ensureTarget(this.size || 1024);
    if (!this.probe) {
      const tri = new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0], 3));
      tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
      tri.setIndex([0, 1, 2]);
      this.probe = new THREE.BatchedMesh(1, 3, 3, this.meshes[0].depth);
      this.probe.setColorAt(this.probe.addInstance(this.probe.addGeometry(tri)), new THREE.Color(1, 1, 1));
      this.probe.layers.set(TREE_LAYER);
    }
    const prev = renderer.getRenderTarget();
    try { renderer.setRenderTarget(this.target); renderer.compile(this.probe, this.camera); }
    catch {} finally { renderer.setRenderTarget(prev); }
  }
  dispose() { this.target?.dispose(); for (const m of this.meshes) m.depth.dispose(); this.stamp.geometry.dispose(); }
}

// ---------------------------------------------------------------- the rays ------------------------------------------
const fsVert = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const marchFrag = `
uniform sampler2D tDepth; uniform mat4 uInvProj; uniform mat4 uCamWorld; uniform vec3 uCamPos;
uniform sampler2DShadow uSunShadow; uniform mat4 uSunMatrix; uniform float uSunOn;
uniform sampler2D uTreeDepth; uniform mat4 uTreeMatrix; uniform float uTreeOn;
uniform vec3 uSunDir; uniform int uSteps; uniform float uMaxDist;
uniform float uDensIn; uniform float uDensOut; uniform float uFalloff; uniform float uG; uniform float uMix;
uniform vec4 uHall; uniform vec4 uPass; uniform vec4 uRoom; uniform vec3 uRoofs; uniform float uWaterY; uniform float uTime;
uniform sampler2D uNoise; uniform vec3 uLightU; uniform vec3 uLightV;
uniform sampler2D uBlue; uniform float uJitter; uniform int uBlock; uniform vec2 uFull; uniform vec2 uLow;
varying vec2 vUv;
bool inBox(vec3 p, vec4 b, float top) { return p.x > b.x && p.x < b.y && p.z > b.z && p.z < b.w && p.y < top; }
bool indoors(vec3 p) { return inBox(p, uHall, uRoofs.x) || inBox(p, uPass, uRoofs.y) || inBox(p, uRoom, uRoofs.z); }
void main() {
  // the nearest and the farthest surface among the full pixels this one stands for (its block): the light is kept up
  // to both, and the composite picks for every full pixel by its own depth (a reed and the gap beside it, a leaf and
  // the sky behind it, each get their own)
  ivec2 base = ivec2(floor(floor(gl_FragCoord.xy) * uFull / uLow)), last = ivec2(uFull) - 1;
  float dMin = 1.0, dMax = 0.0;
  for (int a = 0; a < 4; a++) {
    if (a >= uBlock) break;
    for (int b = 0; b < 4; b++) {
      if (b >= uBlock) break;
      float d = texelFetch(tDepth, min(base + ivec2(a, b), last), 0).x;
      dMin = min(dMin, d); dMax = max(dMax, d);
    }
  }
  vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, dMax * 2.0 - 1.0, 1.0);
  vec3 vp = v.xyz / v.w;
  float dist = length(vp);
  vec4 vn = uInvProj * vec4(vUv * 2.0 - 1.0, dMin * 2.0 - 1.0, 1.0);
  float distN = min(length(vn.xyz / vn.w), dist);
  vec3 rd = normalize((uCamWorld * vec4(vp, 0.0)).xyz);
  float len = min(dist, uMaxDist);
  // nothing under the lake's surface
  if (rd.y < -1e-4) len = min(len, max(0.0, (uWaterY - uCamPos.y) / rd.y));
  float lenN = min(distN, len);
  // the shadow maps are affine along the ray: their coordinates at t are c0 + cd * t
  vec3 s0 = (uSunMatrix * vec4(uCamPos, 1.0)).xyz, sd = (uSunMatrix * vec4(rd, 0.0)).xyz;
  vec3 t0 = (uTreeMatrix * vec4(uCamPos, 1.0)).xyz, td = (uTreeMatrix * vec4(rd, 0.0)).xyz;
  // blue noise, moved on by the golden ratio each frame: where along its step each pixel samples (blurred and
  // averaged over the frames afterwards)
  float jit = fract(texelFetch(uBlue, ivec2(mod(gl_FragCoord.xy, ${BLUE_SIZE}.0)), 0).r + uJitter);
  // long rays outside take their steps closer together near the eye
  float pw = 1.0 + 0.8 * smoothstep(15.0, 80.0, len);
  float acc = 0.0, accN = 0.0, od = 0.0, prev = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= uSteps) break;
    float u1 = float(i + 1) / float(uSteps);
    float tEnd = len * pow(u1, pw), dt = tEnd - prev;
    float t = prev + dt * jit;
    // how much of this step lies before the nearest surface
    float fN = clamp((lenN - prev) / max(dt, 1e-5), 0.0, 1.0);
    prev = tEnd;
    vec3 p = uCamPos + rd * t;
    bool inside = indoors(p);
    float sigma;
    if (inside) {
      // dust: thicker and thinner along the light (streaks across the beam, the same all the way along it, so the sunlit
      // air breaks up into shafts) and in slow, faint clouds that drift through the rooms
      float ck = texture2D(uNoise, vec2(dot(p, uLightU), dot(p, uLightV)) * 0.075 + vec2(uTime * 0.002, uTime * 0.0007)).g;
      float n = sin(p.x * 0.9 + p.y * 0.6 + uTime * 0.05) + sin(p.z * 1.1 - p.y * 0.8 - uTime * 0.04);
      sigma = uDensIn * (0.06 + 1.9 * smoothstep(0.42, 0.64, ck)) * (0.8 + 0.1 * n);
    } else sigma = uDensOut * exp(-max(p.y, 0.0) * uFalloff);
    vec3 sc = s0 + sd * t;
    float vis;
    if (uSunOn > 0.5 && sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) vis = texture(uSunShadow, vec3(sc.xy, sc.z - 0.0002));
    else if (inside) vis = 0.0;
    else {
      vec3 tc = t0 + td * t;
      vis = (uTreeOn > 0.5 && tc.x > 0.0 && tc.x < 1.0 && tc.y > 0.0 && tc.y < 1.0) ? step(tc.z - 0.0005, texture2D(uTreeDepth, tc.xy).r) : 1.0;
    }
    od += sigma * dt;
    float add = vis * sigma * exp(-od) * dt;
    acc += add; accN += add * fN;
  }
  // Henyey-Greenstein (×4π, so that 1 is the isotropic part), mixed with an even share for the side and back
  float c = dot(rd, uSunDir), g2 = uG * uG;
  float hg = (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * uG * c, 1e-4), 1.5);
  float ph = mix(1.0, hg, uMix);
  // the light up to the farthest surface and its distance, the same up to the nearest
  gl_FragColor = vec4(acc * ph, dist, accN * ph, distN);
}`;
// A blur along x or y that keeps to its depth (no light bleeds over an edge in front of it), for both layers. On the
// second axis the result is blended with the last frame's where this pixel's surfaces stood then (reprojected by depth,
// taken only where that frame saw the same depths), so the jitter averages away over a handful of frames and a
// redrawn shadow map fades in instead of popping.
const blurFrag = `
uniform sampler2D tIn; uniform vec2 uStep; uniform int uRadius;
uniform sampler2D tHist; uniform float uHistOn; uniform float uBlend; uniform mat4 uInvProj; uniform mat4 uCamWorld; uniform mat4 uPrevVP; uniform vec3 uPrevCamPos;
varying vec2 vUv;
// the history's light at the surface dist away along this pixel's ray, or -1.0 where there is none to trust
float grHistory(vec3 dir, float dist, bool near) {
  vec3 pw = (uCamWorld * vec4(dir * dist, 1.0)).xyz;
  vec4 pc = uPrevVP * vec4(pw, 1.0);
  if (pc.w <= 0.0) return -1.0;
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  if (puv.x <= 0.0 || puv.x >= 1.0 || puv.y <= 0.0 || puv.y >= 1.0) return -1.0;
  vec4 h = texture2D(tHist, puv);
  float was = length(pw - uPrevCamPos), hd = near ? h.a : h.g;
  // (the history's depths are a bilinear mix: tolerant at the far distances, strict near by)
  return abs(hd - was) < 0.08 * was + 0.15 ? (near ? h.b : h.r) : -1.0;
}
void main() {
  vec4 c = texture2D(tIn, vUv);
  float d0 = c.g, n0 = c.a, sum = c.r, sumN = c.b, wsum = 1.0, wsumN = 1.0, tol = 0.06 * d0 + 0.12, tolN = 0.06 * n0 + 0.12;
  float k = 1.0 / (0.45 * float(uRadius * uRadius) + 0.5);
  for (int i = 1; i <= 8; i++) {
    if (i > uRadius) break;
    float gw = exp(-float(i * i) * k);
    vec4 a = texture2D(tIn, vUv + uStep * float(i)), b = texture2D(tIn, vUv - uStep * float(i));
    float wa = gw * max(0.0, 1.0 - abs(a.g - d0) / tol), wb = gw * max(0.0, 1.0 - abs(b.g - d0) / tol);
    float na = gw * max(0.0, 1.0 - abs(a.a - n0) / tolN), nb = gw * max(0.0, 1.0 - abs(b.a - n0) / tolN);
    sum += a.r * wa + b.r * wb; wsum += wa + wb;
    sumN += a.b * na + b.b * nb; wsumN += na + nb;
  }
  float far = sum / wsum, near = sumN / wsumN;
  if (uHistOn > 0.5) {
    vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec3 dir = normalize(v.xyz / v.w);
    float hf = grHistory(dir, d0, false);
    if (hf >= 0.0) far = mix(far, hf, uBlend);
    // (one surface in the block: the same history serves both layers)
    float hn = abs(n0 - d0) < tol ? hf : grHistory(dir, n0, true);
    if (hn >= 0.0) near = mix(near, hn, uBlend);
  }
  gl_FragColor = vec4(far, d0, near, n0);
}`;
// Up to the full resolution: the low picture filtered where its block holds one surface and the pixel lies at it, else
// each pixel from the four low ones round it, each read at the pixel's own depth between the light up to its nearest
// and up to its farthest surface (so a leaf gets the light up to the leaf, the gap beside it the light up to the sky,
// and nothing bleeds over an edge). It goes into the vignette's pass of world.js (a pass of its own over the
// multisampled picture cost more than all the rest of the rays together).
const COMP_GLSL = `
uniform sampler2D tGrRays; uniform sampler2D tGrDepth; uniform mat4 uGrInvProj; uniform vec2 uGrLow; uniform vec3 uGrColor;
uniform float uGrKnee; uniform float uGrOn;
// the light up to dist from a low pixel that knows it up to its nearest (q.b at q.a) and its farthest surface (q.r at q.g)
float grLayer(vec4 q, float dist) {
  if (dist < q.a) return q.b * dist / max(q.a, 0.01);   // nearer than anything in the block: about in proportion
  return mix(q.b, q.r, clamp((dist - q.a) / max(q.g - q.a, 1e-3), 0.0, 1.0));
}
vec3 grRays(vec2 uv) {
  if (uGrOn < 0.5) return vec3(0.0);
  float d = texture2D(tGrDepth, uv).x;
  vec4 v = uGrInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  float dist = length(v.xyz / v.w), tol = 0.04 * dist + 0.08;
  vec4 lin = texture2D(tGrRays, uv);
  float s = lin.r;
  if (abs(lin.g - lin.a) > tol * 0.5 || abs(lin.g - dist) > tol * 0.5) {
    vec2 f = uv * uGrLow - 0.5, i0 = floor(f), fr = f - i0;
    float sum = 0.0, wsum = 0.0;
    for (int k = 0; k < 4; k++) {
      vec2 o = vec2(float(k - (k / 2) * 2), float(k / 2));
      vec4 q = texture2D(tGrRays, (i0 + o + 0.5) / uGrLow);
      float wb = mix(1.0 - fr.x, fr.x, o.x) * mix(1.0 - fr.y, fr.y, o.y);
      // how far the pixel's depth lies outside what this low pixel spans
      float off = max(q.a - dist, 0.0) + max(dist - q.g, 0.0);
      float w = wb / (0.05 + off / tol) + 1e-5;
      sum += grLayer(q, dist) * w; wsum += w;
    }
    s = sum / wsum;
  }
  // a soft knee: thin beams add as they are, the glow straight towards the sun never burns out to white
  return uGrColor * (s / (1.0 + s * uGrKnee));
}`;
// (on its own, added on top of the picture, when there is no vignette pass to go into)
const compFrag = `${COMP_GLSL}
varying vec2 vUv;
void main() { gl_FragColor = vec4(grRays(vUv), 1.0); }`;

/** Remembers which of the composer's buffers holds the scene and its depth (right after the RenderPass). */
class TapPass extends Pass {
  constructor() { super(); this.needsSwap = false; this.target = null; }
  render(renderer, writeBuffer, readBuffer) { this.target = readBuffer; }
}

class RaysPass extends Pass {
  constructor(owner) {
    super();
    this.needsSwap = false;
    this.owner = owner;
    this.scale = 0.5;
    const rt = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    // the march, the first blur, and two for the blurred result of this frame and the last (the history)
    this.rtA = rt(); this.rtB = rt(); this.hist = [rt(), rt()]; this.flip = 0;
    this.histValid = false;   // the history holds the last frame of the same view and size
    this.frame = 0;
    this.vp = new THREE.Matrix4();
    this.full = new THREE.Vector2(1, 1);
    const B = (b) => new THREE.Vector4(b.x0, b.x1, b.z0, b.z1);
    this.marchU = {
      tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
      uSunShadow: { value: null }, uSunMatrix: { value: new THREE.Matrix4() }, uSunOn: { value: 0 },
      uTreeDepth: { value: null }, uTreeMatrix: { value: new THREE.Matrix4() }, uTreeOn: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSteps: { value: 24 }, uMaxDist: { value: 70 },
      uDensIn: { value: 0.011 }, uDensOut: { value: 0.0016 }, uFalloff: { value: 1 / 30 }, uG: { value: 0.4 }, uMix: { value: 0.62 },
      uHall: { value: B(HALL) }, uPass: { value: new THREE.Vector4(PASSAGE.x - PASSAGE.w / 2, PASSAGE.x + PASSAGE.w / 2, PASSAGE.z0, PASSAGE.z1) }, uRoom: { value: B(ROOM) },
      uRoofs: { value: new THREE.Vector3(HALL.h, PASSAGE.h, ROOM.h) }, uWaterY: { value: WATER_Y }, uTime: { value: 0 },
      uNoise: SKY.uNoise, uLightU: { value: new THREE.Vector3(1, 0, 0) }, uLightV: { value: new THREE.Vector3(0, 0, 1) },
      uBlue: { value: blueNoiseTexture() }, uJitter: { value: 0 }, uBlock: { value: 2 }, uFull: { value: new THREE.Vector2(1, 1) }, uLow: { value: new THREE.Vector2(1, 1) },
    };
    this.blurU = { tIn: { value: null }, uStep: { value: new THREE.Vector2() }, uRadius: { value: 4 },
      // (0.9: the jitter's residue is a tenth of a frame's, a redrawn shadow map fades in over a sixth of a second;
      // the tier sets it, TIERS)
      tHist: { value: null }, uHistOn: { value: 0 }, uBlend: { value: 0.9 }, uInvProj: this.marchU.uInvProj, uCamWorld: this.marchU.uCamWorld,
      uPrevVP: { value: new THREE.Matrix4() }, uPrevCamPos: { value: new THREE.Vector3() } };
    this.compU = { tGrRays: { value: null }, tGrDepth: { value: null }, uGrInvProj: this.marchU.uInvProj, uGrLow: { value: this.marchU.uLow.value }, uGrColor: { value: new THREE.Color() }, uGrKnee: { value: 0.8 }, uGrOn: { value: 0 } };
    this.merged = false;
    const mat = (fragmentShader, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: fsVert, fragmentShader, uniforms, depthTest: false, depthWrite: false, ...extra });
    this.march = new FullScreenQuad(mat(marchFrag, this.marchU));
    this.blur = new FullScreenQuad(mat(blurFrag, this.blurU));
    // added on top of the scene; its alpha stays as it was
    this.comp = new FullScreenQuad(mat(compFrag, this.compU, { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor }));
  }
  setScale(s) { if (s !== this.scale) { this.scale = s; this.setSize(this.full.x, this.full.y); } }
  setSize(w, h) {
    this.full.set(w, h);
    const lw = Math.max(1, Math.round(w * this.scale)), lh = Math.max(1, Math.round(h * this.scale));
    for (const t of [this.rtA, this.rtB, ...this.hist]) t.setSize(lw, lh);
    this.marchU.uLow.value.set(lw, lh); this.marchU.uFull.value.set(w, h);
    this.marchU.uBlock.value = Math.min(4, Math.max(1, Math.round(w / lw)));
    this.histValid = false;
  }
  /** Forget the last frame (a jump to another view, the rays switched on again). */
  invalidate() { this.histValid = false; }
  /** Add the rays inside a full-screen pass that runs anyway (world.js: the output pass, right after it reads the
   *  picture and before its vignette and tone mapping; until 0.8 the vignette's own pass). False when its shader is
   *  not one of the expected ones: then the rays are added by a pass of their own. */
  mergeInto(pass) {
    const m = pass?.material, fs = m?.fragmentShader || '';
    const hooks = { 'vec4 c = texture2D(tDiffuse, vUv);': 'c.rgb', 'gl_FragColor = texture2D( tDiffuse, vUv );': 'gl_FragColor.rgb' };
    const hook = Object.keys(hooks).find((h) => fs.includes(h));
    if (!hook || !fs.includes('void main(')) return false;
    m.fragmentShader = fs.replace('void main(', `${COMP_GLSL}\nvoid main(`).replace(hook, `${hook} ${hooks[hook]} += grRays(vUv);`);
    Object.assign(m.uniforms, this.compU);
    m.needsUpdate = true;
    return (this.merged = true);
  }
  render(renderer, writeBuffer, readBuffer) {
    const scene = this.owner.tap.target;
    this.compU.uGrOn.value = 0;
    if (!scene?.depthTexture) return;
    const auto = renderer.autoClear; renderer.autoClear = false;
    this.marchU.tDepth.value = scene.depthTexture; this.compU.tGrDepth.value = scene.depthTexture;
    // the jitter moves on by the golden ratio: over a handful of frames every pixel has sampled all along its steps
    this.marchU.uJitter.value = (++this.frame % 64) * 0.618034 % 1;
    renderer.setRenderTarget(this.rtA); this.march.render(renderer);
    const w = this.rtA.width, h = this.rtA.height;
    this.blurU.tIn.value = this.rtA.texture; this.blurU.uStep.value.set(1 / w, 0); this.blurU.uHistOn.value = 0;
    renderer.setRenderTarget(this.rtB); this.blur.render(renderer);
    const cur = this.hist[this.flip], old = this.hist[1 - this.flip];
    this.blurU.tIn.value = this.rtB.texture; this.blurU.uStep.value.set(0, 1 / h);
    this.blurU.tHist.value = old.texture; this.blurU.uHistOn.value = this.histValid ? 1 : 0;
    renderer.setRenderTarget(cur); this.blur.render(renderer);
    this.compU.tGrRays.value = cur.texture; this.compU.uGrOn.value = 1;
    this.histValid = true; this.flip = 1 - this.flip;
    // this frame's camera: where the next frame looks for its history
    this.blurU.uPrevVP.value.copy(this.vp); this.blurU.uPrevCamPos.value.copy(this.marchU.uCamPos.value);
    if (!this.merged) { renderer.setRenderTarget(this.renderToScreen ? null : readBuffer); this.comp.render(renderer); }
    renderer.autoClear = auto;
  }
  /** Compile the three programs (for any render target: the same programs as in the chain). */
  warmUp(renderer, camera) {
    const prev = renderer.getRenderTarget();
    try { renderer.setRenderTarget(this.rtA); for (const q of [this.march, this.blur, ...(this.merged ? [] : [this.comp])]) renderer.compile(q._mesh, camera); }
    catch {} finally { renderer.setRenderTarget(prev); }
  }
  dispose() { for (const t of [this.rtA, this.rtB, ...this.hist]) t.dispose(); for (const q of [this.march, this.blur, this.comp]) q.material.dispose(); }
}

// ---------------------------------------------------------------- dust motes ------------------------------------------
const moteVert = `
uniform float uTime; uniform sampler2DShadow uSunShadow; uniform mat4 uSunMatrix; uniform float uOn; uniform float uSize;
attribute vec4 aSeed;
varying float vA;
void main() {
  // a lazy wander round where it was born
  float t = uTime * (0.55 + 0.45 * aSeed.x);
  vec3 p = position + vec3(sin(t * 0.13 + aSeed.y * 6.28) * 0.4 + sin(t * 0.31 + aSeed.w * 9.0) * 0.08,
                           sin(t * 0.09 + aSeed.z * 6.28) * 0.22,
                           cos(t * 0.11 + aSeed.w * 6.28) * 0.4 + cos(t * 0.27 + aSeed.y * 7.0) * 0.08);
  vec4 sc = uSunMatrix * vec4(p, 1.0);
  float lit = 0.0;
  if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) lit = texture(uSunShadow, vec3(sc.xy, sc.z - 0.0003));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  // now and then a mote turns and catches the sun
  float glint = pow(max(0.0, sin(uTime * (0.5 + 1.2 * aSeed.y) + aSeed.z * 40.0)), 60.0);
  vA = lit * uOn * (0.07 + 1.2 * glint) * smoothstep(0.4, 1.4, d) * (1.0 - smoothstep(4.0, 10.0, d));
  gl_PointSize = uSize * (0.75 + 0.5 * aSeed.w) * (1.0 + 0.4 * glint);
  if (vA < 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; }
}`;
const moteFrag = `
uniform vec3 uColor; varying float vA;
void main() {
  float r = length(gl_PointCoord - 0.5);
  gl_FragColor = vec4(uColor * vA * smoothstep(0.5, 0.05, r), 1.0);
}`;
class DustMotes {
  constructor() {
    const rnd = seeded(808), pos = [], seed = [];
    const fill = (x0, x1, y0, y1, z0, z1, n) => { for (let i = 0; i < n; i++) { pos.push(x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0), z0 + rnd() * (z1 - z0)); seed.push(rnd(), rnd(), rnd(), rnd()); } };
    fill(HALL.x0 + 0.3, HALL.x1 - 0.3, 0.15, HALL.h - 0.3, HALL.z0 + 0.3, HALL.z1 - 0.3, 1600);
    fill(ROOM.x0 + 0.3, ROOM.x1 - 0.3, 0.15, ROOM.h - 0.3, ROOM.z0 + 0.3, ROOM.z1 - 0.3, 1200);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4));
    this.u = { uTime: { value: 0 }, uSunShadow: { value: null }, uSunMatrix: { value: new THREE.Matrix4() }, uOn: { value: 0 }, uSize: { value: 2 }, uColor: { value: new THREE.Color() } };
    const mat = new THREE.ShaderMaterial({ vertexShader: moteVert, fragmentShader: moteFrag, uniforms: this.u, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
    this.points = new THREE.Points(geo, mat);
    this.points.name = 'dust-motes'; this.points.frustumCulled = false; this.points.renderOrder = 6; this.points.visible = false;
  }
  dispose() { this.points.geometry.dispose(); this.points.material.dispose(); }
}

// ---------------------------------------------------------------- the whole --------------------------------------------
const TIERS = {
  // resolution of the rays, steps along a ray, blur radius (low-resolution pixels), size of the trees' map, and how
  // much of the last frame stays in the blend (the coarser march of medium leaves more jitter per frame to average)
  high: { scale: 0.5, steps: 24, radius: 4, trees: 2048, blend: 0.9 },
  medium: { scale: 0.25, steps: 16, radius: 3, trees: 1024, blend: 0.92 },
};
/**
 * God rays for World: the passes in the composer (attach), the trees in the sun's shadow map and the dust motes
 * (setEnv), the settings (apply) and the work before each frame (beforeRender).
 */
export class GodRays {
  constructor(world) {
    this.world = world;
    this.tap = new TapPass(); this.tap.enabled = false;
    this.pass = new RaysPass(this); this.pass.enabled = false;
    this.trees = new TreeShadow();
    this.motes = new DustMotes();
    this.golden = GOLDEN;              // (the checks move the golden sun)
    this.tier = 'high';
    this.enabled = true;
    this.strength = 0;
    this.active = false;
    this.gain = 1;
    // a lost and restored context leaves the trees' map empty: draw it again, and the sun's map with it
    world.renderer?.domElement?.addEventListener?.('webglcontextrestored', () => { this.trees.valid = false; if (this.env) this.env.sun.shadow.needsUpdate = true; });
  }
  /** Into the composer: the tap right after the scene, the rays before bloom, added to the picture in the full-screen
   *  pass `into` (the output pass); the scene's buffer (the first one, world.js #renderComposed) keeps its depth. */
  attach(composer, renderPass, before, into) {
    const t = composer.renderTarget1;
    if (!t.depthTexture) t.depthTexture = new THREE.DepthTexture(Math.max(1, t.width), Math.max(1, t.height));
    composer.insertPass(this.tap, composer.passes.indexOf(renderPass) + 1);
    composer.insertPass(this.pass, composer.passes.indexOf(before));
    this.pass.mergeInto(into);
  }
  setEnv(env) {
    if (this.env === env) return;
    this.env = env;
    this.trees.sun = env.sun;
    env.scene.add(this.trees.stamp, this.motes.points);
    this.trees.setGarden(env.scenery);
  }
  /** Skip the fade and forget the last frame (the checks, after a jump to another view). */
  settle() { this.strength = this.target ?? this.strength; this.pass.invalidate(); }
  /** The setting is on and the quality allows rays (then the picture goes through the composer). */
  get wanted() { return this.enabled && this.tier !== 'off'; }
  /** quality 'high' | 'medium' | 'low', the switch in the settings (graphics.godrays). */
  apply(quality, on) {
    this.tier = quality === 'low' ? 'off' : quality === 'medium' ? 'medium' : 'high';
    this.enabled = on !== false;
    if (this.tier !== 'off') { const T = TIERS[this.tier]; this.pass.setScale(T.scale); this.pass.marchU.uSteps.value = T.steps; this.pass.blurU.uRadius.value = T.radius; this.pass.blurU.uBlend.value = T.blend; }
  }
  /** Before the frame is drawn: the trees' map, the strength and every uniform of the rays and the motes. */
  beforeRender(dt) {
    const w = this.world, env = this.env, r = w.renderer;
    if (!env) return;
    const sunMap = env.sun.shadow.map?.depthTexture || null;
    const shadows = r.shadowMap.enabled && env.sun.castShadow;
    const tier = TIERS[this.tier];
    // the trees in the sun's (or the moon's) map whenever there are sun shadows: they are part of the light, not only of
    // the rays
    const trees = shadows && !!tier && !!env.sunDir;
    // (drawn for the sun: environment.js draws the sun's map on the next frame; moved with the player: on this one)
    if (trees && this.trees.update(r, env.sunDir, w.camera.position, tier.trees, env.treesDue) === 'moved') env.sun.shadow.needsUpdate = true;
    env.treesDue = false;
    const stamp = trees && this.trees.valid;
    if (this.trees.stamp.castShadow !== stamp) { this.trees.stamp.castShadow = stamp; env.sun.shadow.needsUpdate = true; }

    const target = this.target = this.enabled && tier && shadows && sunMap ? (env.rays || 0) : 0;
    // (a fade of a second or so: switched on, off, by the weather or the setting sun)
    this.strength += (target - this.strength) * Math.min(1, dt * 2.5);
    if (target === 0 && this.strength < 0.004) this.strength = 0;
    const on = this.strength > 0.003 && !!sunMap;
    this.active = on;
    this.tap.enabled = this.pass.enabled = on;
    env.shafts.visible = !on;
    const motes = this.motes.u;
    this.motes.points.visible = on;
    if (!on) { this.pass.compU.uGrOn.value = 0; this.pass.invalidate(); return; }

    const cam = w.camera, m = this.pass.marchU;
    // (the player has moved the camera this frame; the renderer brings its matrix up to date only when it draws, so
    // without this the rays were marched from where the eye stood a frame ago and swam against the picture)
    cam.updateMatrixWorld();
    m.uInvProj.value.copy(cam.projectionMatrixInverse);
    m.uCamWorld.value.copy(cam.matrixWorld);
    m.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    this.pass.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    m.uSunShadow.value = sunMap; m.uSunOn.value = 1;
    m.uSunMatrix.value.copy(env.sun.shadow.matrix);
    m.uTreeDepth.value = this.trees.target?.depthTexture || null; m.uTreeOn.value = this.trees.valid ? 1 : 0;
    m.uTreeMatrix.value.copy(this.trees.matrix);
    m.uSunDir.value.copy(env.sunDir);
    // two directions across the sunlight (world space: the dust's streaks stay where they are when the player moves)
    m.uLightU.value.set(0, 1, 0).cross(env.sunDir);
    if (m.uLightU.value.lengthSq() < 1e-4) m.uLightU.value.set(1, 0, 0);
    m.uLightU.value.normalize(); m.uLightV.value.crossVectors(env.sunDir, m.uLightU.value).normalize();
    m.uTime.value = env.time;
    const [dIn, dOut] = env.air || AIR.clear;
    // a golden evening is a little hazier than noon
    m.uDensIn.value = dIn; m.uDensOut.value = dOut * (1 + 0.6 * (env.golden || 0));
    const col = this.pass.compU.uGrColor.value.copy(env.sun.color).multiplyScalar(env.sun.intensity * this.strength * this.gain);
    if (this.debugGain) col.setScalar(this.debugGain);   // (debugging: the rays white)
    motes.uTime.value = env.time;
    motes.uSunShadow.value = sunMap; motes.uSunMatrix.value.copy(env.sun.shadow.matrix);
    motes.uOn.value = Math.min(1, this.strength * 1.5);
    motes.uColor.value.copy(col).multiplyScalar(1.6);
    motes.uSize.value = Math.max(1.5, 2.2 * r.getDrawingBufferSize(this._dbs || (this._dbs = new THREE.Vector2())).y / 1080);
  }
  /** Compile every program now (rays, trees' depth, the stamp), so nothing stalls when the rays first appear. */
  warmUp(target) {
    const r = this.world.renderer, cam = this.world.camera;
    this.pass.warmUp(r, cam);
    this.trees.warmUp(r);
    const prev = r.getRenderTarget();
    try {
      r.setRenderTarget(target || this.pass.rtA);
      const probe = this._probe || (this._probe = new THREE.Mesh(this.trees.stamp.geometry, this.trees.stamp.customDepthMaterial));
      if (this.env) r.compile(probe, cam, this.env.scene);
    } catch {} finally { r.setRenderTarget(prev); }
    // the stamp casts in the shadow maps drawn by world.js right after this (#warmShadows): its programs for the sun's
    // and the fire's maps are compiled now, not the first time the trees' map is ready (beforeRender sets it again)
    if (this.trees.meshes.length) this.trees.stamp.castShadow = true;
  }
  dispose() { this.pass.dispose(); this.trees.dispose(); this.motes.dispose(); }
}
