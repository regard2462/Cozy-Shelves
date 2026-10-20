// The 3D library world: renderer, scene construction from the layout, lights, environment, loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { seeded } from '../core/hash.js';

const fsVert = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
/** What a program of an override material depends on besides the material: the kind of object (SoftAO's normal pass). */
const kindOf = (o) => (o.isBatchedMesh ? 8 : 0) + (o.isSkinnedMesh ? 4 : 0) + (o.isInstancedMesh ? (o.instanceColor ? 2 : 1) : 0);
/** three's order of the opaque things (painterSortStable) with the kind of object before the material. */
function byKind(a, b) {
  return (a.groupOrder - b.groupOrder) || (a.renderOrder - b.renderOrder) || (kindOf(a.object) - kindOf(b.object))
    || (a.material.id - b.material.id) || ((a.materialVariant || 0) - (b.materialVariant || 0)) || (a.z - b.z) || (a.id - b.id);
}
/** Ambient occlusion. Transparent things (glass, the projector beam, fire, contact shadows, the film
 *  picture) are left out of its depth/normal pass, so they neither cast AO nor block it. Full resolution:
 *  at half resolution the noise of the sampling pattern showed as grain on the plaster.
 *  The AO is one number per pixel: its buffer and the denoised one hold one channel (half float, the same values the
 *  four-channel buffers held; the denoise reads 25 of them per pixel), and the picture is darkened by one pass that
 *  reads the scene and the AO and writes the product (three's own output copied the scene into the write buffer and
 *  multiplied the AO onto it in a second pass; both wrote into a multisampled buffer, see #setupPost). */
class SoftAO extends GTAOPass {
  constructor(...args) {
    super(...args);
    const one = (t) => { const n = new THREE.WebGLRenderTarget(t.width, t.height, { type: THREE.HalfFloatType, format: THREE.RedFormat, depthBuffer: false }); t.dispose(); return n; };
    this.gtaoRenderTarget = one(this.gtaoRenderTarget); this.pdRenderTarget = one(this.pdRenderTarget);
    this.pdMaterial.uniforms.tDiffuse.value = this.gtaoRenderTarget.texture;
    // (a red texture reads as (ao, 0, 0): the denoise must weigh the AO itself, not the luminance of that)
    this.pdMaterial.defines.SAMPLE_LUMINANCE = 'a.r';
    this.pdMaterial.needsUpdate = true;
    // the denoise turns its sample pattern by a noise picture that three seeds from Math.random: the AO's fine
    // speckle differed from start to start. Seeded, the picture is the same at every start (the checks compare them).
    this.pdNoiseTexture.dispose();
    this.pdNoiseTexture = this.#seededNoise(64);
    this.pdMaterial.uniforms.tNoise.value = this.pdNoiseTexture;
    this.output = GTAOPass.OUTPUT.Off;   // the parent draws nothing into the buffers; `combine` does (a debug output of the checks still shows)
    this.combine = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, tAO: { value: null }, uIntensity: { value: 1 } },
      vertexShader: fsVert,
      fragmentShader: 'uniform sampler2D tScene; uniform sampler2D tAO; uniform float uIntensity; varying vec2 vUv;\n'
        + 'void main() { vec4 c = texture2D(tScene, vUv); gl_FragColor = vec4(c.rgb * mix(1.0, texture2D(tAO, vUv).r, uIntensity), c.a); }',
      blending: THREE.NoBlending, depthTest: false, depthWrite: false,
    }));
  }
  _overrideVisibility() {
    const cache = this._visibilityCache;
    this.scene.traverse((o) => {
      if (!o.visible) return;
      const m = o.material;
      const transparent = !!m && (Array.isArray(m) ? m.every((x) => x.transparent) : m.transparent);
      if (o.isPoints || o.isLine || o.isLine2 || o.isSprite || transparent || o.userData.noAO) { o.visible = false; cache.push(o); }
    });
  }
  /** three's _generateNoise with a seeded source (GTAOPass.js). */
  #seededNoise(size) {
    const simplex = new SimplexNoise({ random: seeded(0x5eed) });
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) {
      const o = (i * size + j) * 4;
      data[o] = (simplex.noise(i, j) * 0.5 + 0.5) * 255; data[o + 1] = (simplex.noise(i + size, j) * 0.5 + 0.5) * 255;
      data[o + 2] = (simplex.noise(i, j + size) * 0.5 + 0.5) * 255; data[o + 3] = (simplex.noise(i + size, j + size) * 0.5 + 0.5) * 255;
    }
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true;
    return t;
  }
  /** The normal pass draws every opaque thing with one material, whose program three looks up again (its parameters
   *  and key computed anew) whenever the kind of object changes: plain, instanced, instanced with colours, batched. In
   *  three's order (by the things' own materials) the kinds alternate some thirty times a frame; grouped by kind first
   *  they change three or four times. The depth test decides what is seen, so the order leaves the normals and the depth
   *  as they were. */
  _renderOverride(renderer, ...args) {
    renderer.setOpaqueSort(byKind);
    try { super._renderOverride(renderer, ...args); } finally { renderer.setOpaqueSort(null); }
  }
  render(renderer, writeBuffer, readBuffer, ...rest) {
    super.render(renderer, writeBuffer, readBuffer, ...rest);
    if (this.output !== GTAOPass.OUTPUT.Off) return;
    const u = this.combine.material.uniforms;
    u.tScene.value = readBuffer.texture; u.tAO.value = this.pdRenderTarget.texture; u.uIntensity.value = this.blendIntensity;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.combine.render(renderer);
  }
  dispose() { super.dispose(); this.combine.dispose(); }
}

/** three's bloom without its last pass: the bright, blurred mips are composited into `texture`, and the output pass
 *  adds that to the picture (mergeBloom) instead of a full-screen additive blend onto the scene's buffer (on medium
 *  the multisampled one, which then had to be resolved once more). The arithmetic is the same addition. */
class SoftBloom extends UnrealBloomPass {
  get texture() { return this.renderTargetsHorizontal[0].texture; }
  render(renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */) {
    renderer.getClearColor(this._oldClearColor);
    this._oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);
    // 1. the bright areas
    this.highPassUniforms.tDiffuse.value = readBuffer.texture;
    this.highPassUniforms.luminosityThreshold.value = this.threshold;
    this._fsQuad.material = this.materialHighPassFilter;
    renderer.setRenderTarget(this.renderTargetBright);
    renderer.clear();
    this._fsQuad.render(renderer);
    // 2. the mips blurred one after the other
    let input = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const m = this.separableBlurMaterials[i];
      this._fsQuad.material = m;
      m.uniforms.colorTexture.value = input.texture; m.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]); renderer.clear(); this._fsQuad.render(renderer);
      m.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture; m.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
      renderer.setRenderTarget(this.renderTargetsVertical[i]); renderer.clear(); this._fsQuad.render(renderer);
      input = this.renderTargetsVertical[i];
    }
    // 3. the mips composited: `texture`, which the output pass adds
    this._fsQuad.material = this.compositeMaterial;
    this.compositeMaterial.uniforms.bloomStrength.value = this.strength;
    this.compositeMaterial.uniforms.bloomRadius.value = this.radius;
    this.compositeMaterial.uniforms.bloomTintColors.value = this.bloomTintColors;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    renderer.clear();
    this._fsQuad.render(renderer);
    renderer.setClearColor(this._oldClearColor, this._oldClearAlpha);
    renderer.autoClear = oldAutoClear;
  }
}
import { M } from './materials.js';
import * as F from './furniture.js';
import { Parts, boxGeo, boxGeoUV, planeGeo, planeGeoUV, aabb, clamp, lerp } from './geo.js';
import { buildLayout, HALL, PASSAGE, ROOM, ROOM_H, CASING_W, CASING_D } from './layout.js';
import { BookShelves } from './books.js';
import { Environment } from './environment.js';
import { Player, EYE, overheadBoxes } from './player.js';
import { Cat } from './cat.js';
import { Actions } from './world-actions.js';
import { Cinema } from './cinema.js';
import { buildShelfDecor } from './shelf-decor.js';
import { SHELF_GLOW, withShelfGlow } from './shelf-light.js';
import { drawLabel } from './textures.js';
import { signs, SIGN_DENSITY } from './signs.js';
import { worldMapProp } from './worldmap-prop.js';
import { WallFinish } from './walls.js';
import { Wildlife } from './wildlife.js';
import { buildFeeder, buildHide } from './feeder.js';
import { GodRays } from './godrays.js';
import { blueNoiseTexture, BLUE_SIZE } from './bluenoise.js';
import { SkyState } from './sky-state.js';
import { RoomReflections } from './glass-reflect.js';
import { Fauna } from './fauna.js';
import { fireBowlProp, logStump } from './firebowl.js';
import { outside, groundHeight, keepInside, freeOutside } from './outdoor.js';
import { AudiobookShelf } from './audiobook-shelf.js';
import { tr } from '../core/i18n.js';
import { waitingCard, ADD_BOOKS_HINT } from './empty-library.js';
import { LampSwitch, lampIdOf } from './lamp-switch.js';
import { attachFloors } from './floors.js';
import { Winter } from './winter.js';
import { MobileTier } from './mobile.js';

const BOOKEND = () => M.plain(0xe6dfd2, { roughness: 0.5, metalness: 0.05 });

// The output pass's shader (three's OutputShader) is patched before its program is built: the picture leaves it opaque
// (alpha 1: the canvas has an alpha channel, three always asks for one, and the soft edges of the foliage, alpha to
// coverage, let the page's light background shine through as white fringes), its rounding to 8 bits is dithered, and
// the vignette darkens it before the tone mapping (0.9: a pass of its own until then, which read the picture and wrote
// it again into a multisampled buffer; the same arithmetic here, in one pass).
const OUTPUT_HOOK = 'gl_FragColor = texture2D( tDiffuse, vUv );';
/** The vignette (and the warmth of the lamps' tint over the whole picture) in the output pass, before its tone mapping. */
function mergeVignette(pass, uniforms) {
  const m = pass.material, fs = m.fragmentShader;
  if (!fs.includes(OUTPUT_HOOK) || !fs.includes('uniform sampler2D tDiffuse;')) return false;
  m.fragmentShader = fs
    .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse; uniform float uStrength; uniform float uWarm;')
    .replace(OUTPUT_HOOK, `${OUTPUT_HOOK}\n\t\t\t{ float vd = distance(vUv, vec2(0.5)); float vv = smoothstep(0.38, 0.98, vd) * uStrength; gl_FragColor.rgb *= 1.0 - vv; gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(1.03, 0.98, 0.92), uWarm); gl_FragColor.a = 1.0; }`);
  Object.assign(m.uniforms, uniforms);
  m.needsUpdate = true;
  return true;
}
/** The bloom's composite added to the picture in the output pass, right after it reads the picture (SoftBloom). */
function mergeBloom(pass) {
  const m = pass.material, fs = m.fragmentShader;
  if (!fs.includes(OUTPUT_HOOK) || !fs.includes('uniform sampler2D tDiffuse;')) return false;
  m.fragmentShader = fs
    .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse; uniform sampler2D tBloom; uniform float uBloomOn;')
    .replace(OUTPUT_HOOK, `${OUTPUT_HOOK} gl_FragColor.rgb += uBloomOn * texture2D(tBloom, vUv).rgb;`);
  m.uniforms.tBloom = { value: null }; m.uniforms.uBloomOn = { value: 0 };
  m.needsUpdate = true;
  return true;
}

/** The output pass writes 8 bits per channel: a smooth gradient (the dusk sky, the haze along a shaft of light, a lit
 *  wall) steps every few pixels. Half a step of blue noise before the rounding turns the steps into a grain too fine
 *  to see (the pattern of bluenoise.js, so it has no lines of its own). Patched into three's shader once, before its
 *  program is built: no second program. (A raw shader in GLSL 1.00: texture2D, the pattern repeating.) */
function ditherOutput(pass) {
  const m = pass.material;
  if (!m.fragmentShader.includes('uniform sampler2D tDiffuse;')) return;
  const fs = m.fragmentShader.replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse; uniform sampler2D uDither;'), at = fs.lastIndexOf('}');
  if (at < 0) return;
  m.fragmentShader = fs.slice(0, at) + `  gl_FragColor.rgb += (texture2D(uDither, gl_FragCoord.xy / ${BLUE_SIZE}.0).r - 0.5) / 255.0;\n}`;
  m.uniforms.uDither = { value: blueNoiseTexture() };
  m.needsUpdate = true;
}

// lamp colour between a neutral warm white and a candle-like warmth (settings: light.warmth)
const LAMP_NEUTRAL = new THREE.Color(0xfff6ec), LAMP_WARM = new THREE.Color(0xffcf98);
// what a linen shade or a plastered wall makes of that light: a little warmer still
const LINEN = new THREE.Color(1, 0.93, 0.82);
// a sun high enough to light the whole garden while the shadow programs are warmed at night (#warmShadows)
const _warmSun = new THREE.Vector3(0.3, 0.9, 0.3).normalize();
/** Free what a build created: geometries not from the shared cache, per-build materials, instance buffers. */
function disposeTree(root) {
  root.traverse((o) => {
    if (o.isMesh || o.isInstancedMesh || o.isPoints) {
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of new Set(mats)) if (m?.userData?.disposable) { if (!m.userData.keepMap) m.map?.dispose(); m.dispose(); }
      if (o.isInstancedMesh) o.dispose();
    }
    if (o.isLight) o.dispose?.();
  });
}
/** The tops of a placed piece of furniture (furniture.js `tops`) as parts of its collider for the player: rectangles on
 *  the floor plane turned with it, { x, z, c, s, hx, hz, y0, top, walk } (player.js). */
function topParts(tops, pl) {
  const c = Math.cos(pl.rot), s = Math.sin(pl.rot), y0 = pl.meta?.y || 0;
  return tops.map((t) => {
    const lx = (t.x0 + t.x1) / 2, lz = (t.z0 + t.z1) / 2;
    return { x: pl.x + lx * c + lz * s, z: pl.z - lx * s + lz * c, c, s, hx: (t.x1 - t.x0) / 2, hz: (t.z1 - t.z0) / 2, y0, top: y0 + t.y, walk: t.walk !== false };
  });
}
/** Placements that stand on a table, a desk or the sideboard: they get a collider of their own (props, player.js). */
const ON_FURNITURE = new Set(['candle', 'tablelamp', 'bankerlamp', 'recordplayer', 'records', 'computer', 'chessboardprop', 'radio', 'bust']);
/** The box round the solid meshes of an object (without the flat pools of light under a lamp); null when empty. */
function solidBounds(obj) {
  const box = new THREE.Box3(), b = new THREE.Box3();
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    if (!o.isMesh || o.userData.glow || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.union(b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
  });
  return box.isEmpty() ? null : box;
}
/** From which tier on lamps get a real light (furniture.js): mobile and low 1, medium 2, high 3. */
const lampTierFor = (quality) => ({ mobile: 1, low: 1, medium: 2, high: 3 }[quality] || 3);
/** The quality 'mobile' (phones and tablets, the default of a touch screen: core/api-web.js) is 'low' with less work for
 *  a small graphics chip: at most MOBILE_PIXELS × resolutionScale² pixels in the drawing buffer (a phone 0.6 million, a
 *  screen with a short side of 600 dp and more 0.9 million), anisotropic filtering up to 4 samples, the trees' far
 *  level from 25 m on (garden.js) and the birds' twigs only near (birds.js). */
const MOBILE_PIXELS = { phone: 0.6e6, tablet: 0.9e6 };
const MOBILE_ANISO = 4;
function mobilePixels() {
  const short = Math.min(screen?.width || 0, screen?.height || 0) || Math.min(window.innerWidth, window.innerHeight);
  return short >= 600 ? MOBILE_PIXELS.tablet : MOBILE_PIXELS.phone;
}
/** The hall's copies of the shared lamp shade materials (world.js #registerLampGlow). */
const hallGlowMats = new Map();

/** Soft rounded-rectangle shadow (black, alpha falls off towards the edges). */
let contactTex = null;
function contactShadowTexture() {
  if (contactTex) return contactTex;
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    // signed distance to a rounded rectangle that fills ~70 % of the square
    const u = Math.abs((x + 0.5) / N - 0.5) * 2, v = Math.abs((y + 0.5) / N - 0.5) * 2;
    const qx = Math.max(u - 0.55, 0), qy = Math.max(v - 0.55, 0);
    const d = Math.hypot(qx, qy) - 0.12;
    const a = 1 - Math.min(1, Math.max(0, (d + 0.1) / 0.42));
    img.data.set([0, 0, 0, Math.round(255 * a * a)], (y * N + x) * 4);
  }
  g.putImageData(img, 0, 0);
  contactTex = new THREE.CanvasTexture(c);
  return contactTex;
}

/** The directory board (World#buildDirectory) in layout units: W × H, the spec with its texts and the runs of cases. */
function drawDirectory(g, W, H, spec) {
  const serif = (w, s) => `${w} ${s}px "Cormorant Garamond", "EB Garamond", Georgia, serif`;
  const sans = (w, s) => `${w} ${s}px "Segoe UI", Arial, sans-serif`;
  const TEAL = '#1f5b58', INK = '#23211e', HINT = '#4f4a42', RUST = '#8a4b37', GOLD = READ_SIGN;
  g.fillStyle = '#f7f3ea'; g.fillRect(0, 0, W, H);
  g.fillStyle = TEAL; g.fillRect(0, 0, W, 112);
  g.fillStyle = '#f8f3ea'; g.textBaseline = 'middle'; g.textAlign = 'left';
  g.font = serif(600, 66); g.fillText(spec.title, 48, 58);
  g.font = sans(600, 28); g.textAlign = 'right';
  g.fillText(spec.deps, W - 48, 60);
  // the list: number, name, the wall it stands on
  const entries = spec.entries;
  const listX = 48, listW = W * 0.5, top = 140, bottom = H - 66;
  const lh = Math.min(58, (bottom - top) / Math.max(1, entries.length + 1 + (spec.read ? 1 : 0)));
  const size = Math.round(Math.min(40, lh * 0.72));
  const row = (y, num, numColor, name, hint) => {
    g.textAlign = 'left'; g.fillStyle = numColor; g.font = sans(700, Math.round(size * 0.78)); g.fillText(num, listX, y);
    g.fillStyle = INK; g.font = serif(600, size);
    let n = name;
    while (g.measureText(n).width > listW - 190 && n.length > 4) n = n.slice(0, -2).trimEnd() + '…';
    g.fillText(n, listX + 50, y);
    if (hint) { g.textAlign = 'right'; g.fillStyle = HINT; g.font = sans(500, Math.round(size * 0.62)); g.fillText(hint, listX + listW, y); }
  };
  entries.forEach(([n, name, walls], i) => row(top + lh * (i + 0.5), n, TEAL, name, walls));
  row(top + lh * (entries.length + 0.5), '•', RUST, spec.recent[0], spec.recent[1]);
  if (spec.read) row(top + lh * (entries.length + 1.5), '•', GOLD, spec.read[0], spec.read[1]);   // the case "Gelesen"
  g.textAlign = 'left'; g.fillStyle = HINT; g.font = sans(500, 24);
  g.fillText(spec.hint, listX, H - 38);
  // the plan: the back wall at the top, the entrance at the bottom
  const px0 = W * 0.585, px1 = W - 44, pw = px1 - px0, ph = pw * (ROOM.z1 - ROOM.z0) / (ROOM.x1 - ROOM.x0);
  const py0 = Math.max(160, top + (bottom - top - ph) / 2), py1 = py0 + ph;
  const P = (x, z) => [px0 + (x - ROOM.x0) / (ROOM.x1 - ROOM.x0) * pw, py0 + (z - ROOM.z0) / (ROOM.z1 - ROOM.z0) * ph];
  g.fillStyle = '#ebe3d3'; g.fillRect(px0, py0, pw, ph);
  g.strokeStyle = '#3b3833'; g.lineWidth = 5; g.strokeRect(px0, py0, pw, ph);
  const [ex0] = P(-PASSAGE.w / 2, 0), [ex1] = P(PASSAGE.w / 2, 0);
  g.fillStyle = '#f7f3ea'; g.fillRect(ex0, py1 - 5, ex1 - ex0, 10);
  g.fillStyle = '#8fb8c7';
  { const [a] = P(-2.2, 0), [b] = P(2.2, 0); g.fillRect(a, py0 - 4, b - a, 8); }
  for (const sx of [ROOM.x0, ROOM.x1]) { const [x] = P(sx, 0), [, a] = P(0, -20.8), [, b] = P(0, -19.2); g.fillRect(x - 4, a, 8, b - a); }
  g.font = sans(600, 22); g.fillStyle = HINT; g.textAlign = 'center'; g.textBaseline = 'top';
  g.fillText(spec.entrance, (ex0 + ex1) / 2, py1 + 10);
  g.textBaseline = 'middle';
  const labels = [];
  spec.runs.forEach((parts, i) => {
    // the run's number is its number in the list (with one department in the room that is not the first)
    const num = spec.nums?.[i] ?? i + 1;
    for (const [ax, az, rot, bx, bz] of parts) {
      const fx = Math.sin(rot), fz = Math.cos(rot);
      let dx = bx - ax, dz = bz - az; const len = Math.hypot(dx, dz);
      if (len < 1e-6) { dx = fz; dz = -fx; } else { dx /= len; dz /= len; }
      const half = F.BOOKCASE.w / 2 - 0.06;
      const p0 = P(ax - dx * half - fx * 0.1, az - dz * half - fz * 0.1), p1 = P(bx + dx * half - fx * 0.1, bz + dz * half - fz * 0.1);
      g.strokeStyle = num % 2 ? TEAL : '#3f8f89'; g.lineWidth = 14; g.lineCap = 'butt';
      g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.stroke();
      // the number just inside the room; moved further in when it would touch another one
      for (const inset of [1.3, 2.3, 3.3]) {
        const m = P((ax + bx) / 2 + fx * inset, (az + bz) / 2 + fz * inset);
        if (labels.every((l) => Math.hypot(l[0] - m[0], l[1] - m[1]) > 34)) {
          labels.push(m);
          g.fillStyle = TEAL; g.font = sans(700, 22); g.textAlign = 'center';
          g.fillText(String(num), m[0], m[1]);
          break;
        }
      }
    }
  });
  if (spec.recentAt) { const [x, y] = P(spec.recentAt[0], spec.recentAt[1] + 0.1); g.fillStyle = RUST; g.fillRect(x - 15, y - 10, 30, 12); }
  if (spec.readAt) { const [x, y] = P(spec.readAt[0], spec.readAt[1] + 0.1); g.fillStyle = GOLD; g.fillRect(x - 15, y - 10, 30, 12); }
}
/** The sign above the case "Gelesen": warm ochre (the departments are teal, "Zuletzt gelesen" is rust). */
const READ_SIGN = '#7a5a20';

export class World {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts; // { onHint, onInteract, onSeat, onStep, onLand, coverUrl, onPurr, onDepartment }
    // (opts.antialias false: the canvas without multisampling, main.js for the quality 'mobile' at the start; the
    // context keeps it until the next start)
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: opts.antialias !== false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene(); this.scene.background = null;
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 300);
    this.clock = new THREE.Clock();
    this.static = new THREE.Group(); this.scene.add(this.static);
    this.retired = [];   // parts taken out by a rebuild, disposed after it compiled (#disposeRetired)
    this.dynamic = new THREE.Group(); this.scene.add(this.dynamic);
    this.colliders = [];
    this.lights = [];       // legacy
    // Every lamp keeps its own light for good. (A small pool of real lights used to be handed to the lamps
    // nearest to the camera, so every lamp further away went dark: the light "switched off" when you walked
    // away.) Lamps below the quality's tier only glow; small lamps glow through decals (this.glows).
    this.lamps = [];        // { light, base, flicker, phase, hall }
    this.glows = [];        // { mat, base, gain, hall }: light decals on walls, their opacity follows the brightness
    this.lampMats = new Map();   // glowing lamp materials → { base, hall } (#registerLampGlow)
    this.flames = [];
    this.interactables = [];
    this.occluders = [];      // the building itself – nothing may be targeted through a wall
    this.seats = new Map();
    this.surfaces = new Map();
    this.paintings = [];
    this.places = [];
    this.bookcaseObjects = new Map();
    this.books = new BookShelves(this.scene, { coverUrl: (id) => opts.coverUrl?.(id), renderer: this.renderer, camera: this.camera });
    signs.setRenderer(this.renderer);
    this.signs = signs;
    this.player = new Player(this.camera, canvas, this.colliders);
    this.player.onStep = (run, speed) => opts.onStep?.(run, speed);
    this.player.onLand = (impact) => (opts.onLand ? opts.onLand(impact) : opts.onStep?.(true));   // landing after a jump: a firm step
    // outside: walk on the deck, the jetty and the ground of the garden, and stay on the walkable area (outdoor.js)
    this.player.floorAt = (x, z) => (outside(x, z) ? groundHeight(x, z) : 0);
    this.player.bounds = { keep: keepInside, free: freeOutside };
    this.quality = 'high';
    this.lampTier = null;
    this.lampColor = new THREE.Color(); this.glowColor = new THREE.Color();
    this.settings = {};
    this.time = 0;
    this.department = null;
    this.recent = [];
    this.actions = new Actions(this);
    this.cinema = new Cinema(this);
    this.walls = new WallFinish(this);   // white, a colour or graffiti on the plaster (walls.js)
    this.audiobooks = new AudiobookShelf(this);   // the audiobook cabinet in the hall, with audiobook folders (audiobook-shelf.js)
    this.sky = new SkyState(this);       // the clock and the weather: time modes, combined and changing weather (sky-state.js)
    this.lampSwitch = new LampSwitch();  // every lamp switched on and off by itself (lamp-switch.js)
    this.floors = attachFloors(this);    // the floor of every room, in the style of the settings (floors.js)
    this.mobileTier = new MobileTier(this);   // the savings of the quality 'mobile' (mobile.js)
    this.#setupPost();
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  #setupPost() {
    const r = this.renderer;
    // The composer renders into its own target, where the canvas' `antialias` does not apply: without a
    // multisampled target every edge in the room was jagged whenever bloom was on (the default).
    // Only the scene is drawn into that multisampled buffer (renderTarget1, resolved once). Nothing writes into it
    // afterwards: the AO darkens the resolved picture into the plain second buffer, the bloom composites its glow in
    // buffers of its own, and the output pass reads the picture and adds the glow and the rays. Until 0.8 both buffers
    // were multisampled, and every full-screen pass wrote all four samples of every pixel and had them resolved again
    // (a quarter of the frame's GPU time at 2560 × 1440 for the same picture).
    this.msaa = 4;
    this.composer = new EffectComposer(r, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.msaa }));
    const plain = this.composer.renderTarget2;
    plain.samples = 0; plain.depthBuffer = false;
    this.renderPass = new RenderPass(this.scene, this.camera); this.composer.addPass(this.renderPass);
    // contact darkening in corners, under shelves and between books ('high' quality only)
    this.ao = new SoftAO(this.scene, this.camera, 2, 2, undefined,
      // a small radius: corners and gaps darken, walls no longer get dark clouds from furniture a metre away
      { radius: 0.35, distanceExponent: 1.0, thickness: 1.5, scale: 1.4, samples: 12, distanceFallOff: 1.0, screenSpaceRadius: false },
      { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 8, rings: 2, samples: 12 });
    // Software rendering (SwiftShader, llvmpipe) cannot afford it; ?ao=1 forces it for screenshots.
    let gl = '';
    try { const c = r.getContext(); const ext = c.getExtension('WEBGL_debug_renderer_info'); gl = ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER); } catch {}
    this.softwareGL = /swiftshader|llvmpipe|software/i.test(String(gl));
    this.forceAO = new URLSearchParams(location.search).get('ao') === '1';
    this.ao.blendIntensity = 0.8;
    this.composer.addPass(this.ao);
    // Only genuine highlights (flames, bulbs, sunlit glass) may bloom – a low threshold used to
    // turn every lit wall into a white flash whenever the camera turned. (Its glow is added in the output pass.)
    this.bloom = new SoftBloom(new THREE.Vector2(1, 1), 0.16, 0.5, 0.96); this.composer.addPass(this.bloom);
    // the output pass reads the scene's buffer (medium: resolved by three) or the AO's plain one (high)
    this.output = new OutputPass(); this.output.needsSwap = false; this.composer.addPass(this.output);
    // the vignette lives in the output pass (mergeVignette); its uniforms stay where the checks look for them
    this.vignette = { uniforms: { uStrength: { value: 0.32 }, uWarm: { value: 0.0 } } };
    mergeVignette(this.output, this.vignette.uniforms);
    ditherOutput(this.output);
    // god rays (godrays.js): the light of the sun in the air, marched before bloom and added in the output pass
    this.godrays = new GodRays(this);
    this.godrays.attach(this.composer, this.renderPass, this.bloom, this.output);
    mergeBloom(this.output);
  }
  /** The frame through the composer: the scene into the multisampled buffer, everything after it on the plain one. */
  #renderComposed(dt) {
    const c = this.composer;
    // (the passes swap the buffers as they go; every frame starts the same way)
    c.readBuffer = c.renderTarget1; c.writeBuffer = c.renderTarget2;
    // the scene's depth is resolved out of the multisampled buffer only for the rays, its one reader (godrays.js): at
    // night, in rain or with the rays off that copy (a shader pass under ANGLE, 0.17 ms at 2560 × 1440) is left out
    c.renderTarget1.resolveDepthBuffer = this.godrays.active;
    const u = this.output.uniforms;
    u.tBloom.value = this.bloom.enabled ? this.bloom.texture : null; u.uBloomOn.value = this.bloom.enabled ? 1 : 0;
    c.render(dt);
  }
  /** The program of the AO's combine pass: compiled with the rest. */
  #warmPost() {
    const r = this.renderer, prev = r.getRenderTarget();
    try { r.setRenderTarget(this.composer.renderTarget2); const q = this.ao.combine; if (q?._mesh) r.compile(q._mesh, this.camera); }
    catch {} finally { r.setRenderTarget(prev); }
  }
  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    const scale = clamp(this.settings.graphics?.resolutionScale || 1, 0.5, 1.5);
    const dpr = Math.min(window.devicePixelRatio, 2);
    // 'mobile': a budget of pixels instead of a share of the display's (the resolution scales the budget), never more
    // than the display has
    this.renderer.setPixelRatio(this.mobile ? Math.min(dpr, Math.sqrt(mobilePixels() * scale * scale / Math.max(1, w * h))) : dpr * scale);
    this.renderer.setSize(w, h, false);
    // the composer keeps the pixel ratio it was made with: without this, bloom, AO and the rays rendered at one pixel
    // per CSS pixel whatever the display or the resolution setting
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ building ----
  /** @param opts { department?: string, recent?: string[] } */
  build(library, opts = {}) {
    const t0 = performance.now();
    // for the tests: how long the steps of a build took (world.buildSteps, world.buildTimes)
    const steps = this.buildSteps = {};
    let tl = t0;
    const lap = (name) => { const t = performance.now(); steps[name] = Math.round(t - tl); tl = t; };
    // built again from the same library state (a rebuild in place, another department): the records the world got since
    // (main.js onBook: a book read, a new cover) are newer than the ones in that state
    const fresh = library === this.library ? this.booksById : null;
    const booksById = Object.fromEntries(library.books.map((b) => [b.id, fresh?.[b.id] || b]));
    this.booksById = booksById;
    this.library = library;
    if (opts.department !== undefined) this.department = opts.department;
    if (opts.recent) this.recent = opts.recent;
    this.layout = buildLayout(library.departments, booksById, { department: this.department, recent: this.recent, shelves: this.settings?.shelves });
    this.department = this.layout.department;
    // which lamps get a real light depends on the graphics quality (furniture.js: tier)
    this.lampTier = lampTierFor(this.settings.graphics?.quality || this.quality);
    // (and whether this build is one of 'mobile': its batches, lights and programs; set before the build's own
    // applySettings, which would else build again and again)
    this.builtMobile = this.settings.graphics?.quality === 'mobile';
    lap('layout');
    this.#clearStatic(); lap('clear');
    this.#buildStructure(); lap('structure');
    this.#buildPlacements(); lap('placements');
    this.cinema.onBuilt();
    this.walls.build(this.layout);   // once: the walls never move
    this.#buildShelves(); lap('shelves');
    if (!this.env) this.env = new Environment(this.scene, this.renderer, this.layout);
    else this.env.setLayout(this.layout);
    this.godrays.setEnv(this.env);   // the dust motes and the trees in the sun's shadow map
    (this.reflections ||= new RoomReflections(this)).invalidate();   // the rooms in their windows at night (glass-reflect.js)
    this.wildlife ||= new Wildlife(this);   // deer, fox and wolf now and then in the garden (wildlife.js)
    this.fauna ||= new Fauna(this);         // birds, koi and frogs (fauna.js)
    this.winter ||= new Winter(this);       // tracks in the snow, the frozen lake to walk on (winter.js)
    lap('environment');
    this.player.colliders = this.colliders;
    this.player.setOverhead(overheadBoxes(this.static.children.filter((o) => o.userData.placement), this.colliders));   // how high a jump may go
    this.places = this.layout.places;
    this.actions.onBuilt(); lap('actions');
    this.applySettings(this.settings); lap('settings');
    this.lampSwitch.prepare(this.static);   // every glowing lamp part carries its lamp's number into the batches
    this.#batchStatic(); lap('batch');
    // the quality 'mobile' (mobile.js): its pool of lights, the trees and the openings of this build
    this.mobileTier.setup(this.builtMobile);
    this.#padLights();
    this.#warmUp(); lap('warmup');
    this.#disposeRetired();   // after the new materials took over the shader programs (#clearStatic)
    this.focusDepartment = undefined; this.focusT = 0;
    if (!this.layout.allDepartments) this.opts.onDepartment?.(this.department, this.layout.departments);
    (this.buildTimes = this.buildTimes || []).push(Math.round(performance.now() - t0));
  }

  /** Books, their decoration, the shelf plates and the name plates: everything that depends on which books
   *  stand where, in one group. A new department, the recently-read shelf or new books swap only this group:
   *  a full build took half a second and froze the picture after every book you put back. */
  #buildShelves() {
    const g = new THREE.Group(); g.name = 'shelves';
    this.shelfGroup = g; this.static.add(g);
    signs.begin('shelves');
    const t = performance.now();
    this.books.build(this.layout, this.booksById, this.bookcaseObjects);
    this.shelfSteps = { books: Math.round(performance.now() - t) };
    const decor = buildShelfDecor(this.layout, this.bookcaseObjects);
    g.add(decor);
    // the shelf strips light the books and the decoration as well (shelf-light.js)
    for (const m of this.books.meshes) withShelfGlow(m.material, 0.55);
    decor.traverse((o) => { if (o.isMesh) for (const m of [o.material].flat()) withShelfGlow(m, 0.55); });   // the decoration's own materials
    this.#buildShelfLabels(g);
    this.#buildNamePlates(g);
    this.#buildSigns(g);
    this.#buildDirectory(g);
    signs.end('shelves');
    // the texts are drawn over the next frames (signs.js); before the loop runs (the start, tests) at once
    if (!this.running) signs.flush();
  }
  /** Swap the shelves for another department / recently-read list / library state. false when the bookcases
   *  themselves would change (then a full build is needed). */
  refreshShelves(opts = {}) {
    if (!this.library || !this.layout || !this.shelfGroup) return false;
    const department = opts.department !== undefined ? opts.department : this.department;
    const recent = opts.recent || this.recent;
    const next = buildLayout(this.library.departments, this.booksById, { department, recent, shelves: this.settings?.shelves });
    const prev = this.layout.bookcases;
    // the same cases in the same places (the free wall, its pictures and the panelling stay as they are)
    const same = next.bookcases.length === prev.length && next.bookcases.every((bc, i) => bc.id === prev[i].id && bc.x === prev[i].x && bc.z === prev[i].z) && next.allDepartments === this.layout.allDepartments;
    if (!same) return false;
    this.static.remove(this.shelfGroup); this.retired.push(this.shelfGroup); this.shelfGroup = null;
    this.layout = next; this.department = next.department; this.recent = recent;
    this.#buildShelves();
    this.reflections?.invalidate();
    this.actions.setBasket([...this.actions.basket]);
    this.actions.refreshDisplayTable();
    this.#warmUp();
    this.#disposeRetired();
    if (!this.layout.allDepartments) this.opts.onDepartment?.(this.department, this.layout.departments);
    else { this.focusDepartment = undefined; this.focusT = 0; }
    return true;
  }
  /** Another language: the signs, the plates and the directory are drawn again in it, on the shelves as they stand.
   *  (refreshShelves computes the layout anew and gives up when books indexed since the last build changed the cases;
   *  the signs then stayed in the old language.) */
  relabel() {
    if (!this.layout || !this.shelfGroup) return false;
    this.static.remove(this.shelfGroup); this.retired.push(this.shelfGroup); this.shelfGroup = null;
    this.#buildShelves();
    this.actions.setBasket([...this.actions.basket]);
    this.actions.refreshDisplayTable();
    this.#warmUp();
    this.#disposeRetired();
    this.focusDepartment = undefined; this.focusT = 0;   // the chip names the department or case in the new language
    return true;
  }
  /** New library state (books added, moved, metadata): only the shelves when possible. */
  updateLibrary(library) {
    this.library = library;
    this.booksById = Object.fromEntries(library.books.map((b) => [b.id, b]));
    if (this.refreshShelves()) return;
    this.#rebuildInPlace();
  }
  /** The books changed places inside the cases (a book read, another copy shown, the sort order, the case "Gelesen"
   *  switched on or off: app/src/ui/shelves.js): only the shelves when the cases stay, else a build in place. */
  rearrangeShelves() {
    if (!this.library || !this.layout) return false;
    if (!this.refreshShelves()) this.#rebuildInPlace();
    return true;
  }

  /** Static batching: every unmoving furniture part is drawn as part of one merged mesh per material and room
   *  (hall, passage, book room) instead of one draw call per part. The book room alone had ~1400 draw calls
   *  per frame. The original meshes stay in place for picking and occlusion, only invisible (raycasts ignore
   *  visibility). Moving parts (clock hands, the turntable, flames: userData.dynamic), per-object materials
   *  (pictures, screens, plates, light decals) and the shelves (rebuilt on their own) keep their meshes. */
  #batchStatic() {
    const SKIP = new Set(['painting', 'easel', 'screen', 'projector']);
    const zone = (z) => (z > HALL.z0 - 0.2 ? 'hall' : z > ROOM.z1 + 0.2 ? 'passage' : 'room');
    const groups = new Map();
    const wp = new THREE.Vector3();
    for (const root of this.static.children) {
      if (root === this.shelfGroup || root.userData.batch || SKIP.has(root.userData.placement?.kind)) continue;
      root.updateMatrixWorld(true);
      const walk = (o) => {
        if (o.userData.dynamic) return;
        if (o.isMesh && !o.isInstancedMesh && o.visible && !Array.isArray(o.material)) {
          const m = o.material;
          if (!m.userData.disposable && !m.vertexColors && m.blending !== THREE.AdditiveBlending) {
            o.getWorldPosition(wp);
            // ('mobile' has no shadows: things that cast and receive them or not go into one batch, fewer draws)
            const key = m.uuid + (this.mobile ? '' : (o.castShadow ? 'c' : '') + (o.receiveShadow ? 'r' : '')) + zone(wp.z);
            let e = groups.get(key); if (!e) groups.set(key, e = { mat: m, cast: o.castShadow, receive: o.receiveShadow, meshes: [] });
            e.meshes.push(o);
          }
        }
        for (const c of o.children) walk(c);
      };
      walk(root);
    }
    const g = new THREE.Group(); g.name = 'static-batched'; g.userData.batch = true;
    for (const { mat, cast, receive, meshes } of groups.values()) {
      if (meshes.length < 2) continue;
      const geos = meshes.map((m) => {
        let geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
        if (geo.index) geo = geo.toNonIndexed();
        for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'lampIndex'].includes(k)) geo.deleteAttribute(k);
        if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
        if (!geo.attributes.normal) geo.computeVertexNormals();
        return geo;
      });
      const merged = mergeGeometries(geos, false); geos.forEach((x) => x.dispose());
      if (!merged) continue;
      merged.userData.disposable = true;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = cast; mesh.receiveShadow = receive;
      if (meshes.some((x) => x.userData.noAO)) mesh.userData.noAO = true;
      g.add(mesh);
      for (const m of meshes) { m.visible = false; m.userData.batched = true; }
    }
    this.static.add(g);
  }

  /** Compile every shader now and upload the textures over the next frames, so nothing stalls the first time
   *  you look into a corner (on D3D11 a single shader took up to half a second). */
  #warmUp() {
    const textures = new Set();
    this.scene.traverse((o) => {
      for (const m of (o.material ? [o.material].flat() : [])) for (const k of ['map', 'normalMap', 'roughnessMap', 'emissiveMap', 'alphaMap', 'metalnessMap']) if (m?.[k]?.isTexture && !m[k].isVideoTexture) textures.add(m[k]);
    });
    this.pendingUploads = [...textures];
    // compile for the target the scene is really drawn into: through the composer that is its buffer (linear, no
    // tone mapping). Programs compiled for the canvas were built a second time on first sight, a quarter of a
    // second each on Direct3D.
    const r = this.renderer, prev = r.getRenderTarget();
    try {
      r.setRenderTarget(this.#composed() ? this.composer.renderTarget1 : null);
      r.compileAsync?.(this.scene, this.camera)?.catch?.(() => {});
      this.godrays.warmUp(this.composer.renderTarget1);
      this.#warmPost();
      // the AO pass draws everything again with its own material, one program for plain, instanced and instanced coloured
      // meshes: those now as well (the books seen through the glass from the garden compiled one on the way back)
      if (this.ao.enabled) r.compileAsync?.(this.#aoWarmUp(), this.camera, this.scene)?.catch?.(() => {});
    } catch {} finally { r.setRenderTarget(prev); }
    this.#warmShadows();
  }
  /** Draw the shadow maps once over the whole garden, so that every shadow caster gets its depth program now. The sun's
   *  map follows the player (±20 m), and compileAsync knows nothing of shadow maps: a caster far out (the bench on the
   *  jetty, the reeds) compiled its depth program only when you walked up to it. */
  #warmShadows() {
    const sun = this.env?.sun, r = this.renderer;
    if (!sun?.castShadow || !r.shadowMap.enabled) return;
    // once per render path, and once more when the first books arrive (a first start builds the rooms before the
    // library is read, and the books are the only instanced casters with a picture): a later rebuild brings no new kind
    const key = `${this.quality}|${this.lampTier}|${r.shadowMap.type}|${this.books?.meshes?.length ? 'books' : 'empty'}`;
    if (this.shadowWarmKey === key) return;
    this.shadowWarmKey = key;
    // what is hidden now by distance (grass and reed chunks, the near trees) casts shadows later: shown for this draw
    const hidden = [];
    this.scene.traverse((o) => {
      if (o.visible || o.isLight) return;
      let casts = false; o.traverse((c) => { if (c.castShadow) casts = true; });
      if (casts) { hidden.push(o); o.visible = true; }
    });
    const cam = sun.shadow.camera, keep = [cam.left, cam.right, cam.top, cam.bottom, cam.near, cam.far];
    const pos = sun.position.clone(), tgt = sun.target.position.clone();
    const rt = this.shadowWarmTarget || (this.shadowWarmTarget = new THREE.WebGLRenderTarget(4, 4));
    const prev = r.getRenderTarget();
    try {
      Object.assign(cam, { left: -170, right: 170, top: 170, bottom: -170, near: 1, far: 800 }); cam.updateProjectionMatrix();
      const dir = this.env.sunDir?.y > 0.05 ? this.env.sunDir : _warmSun;
      sun.target.position.set(0, 0, 40); sun.target.updateMatrixWorld();
      sun.position.set(0, 0, 40).addScaledVector(dir, 350); sun.updateMatrixWorld();
      sun.shadow.needsUpdate = true;
      for (const f of this.env.fires || []) if (f.light?.shadow) f.light.shadow.needsUpdate = true;
      r.setRenderTarget(rt); r.render(this.scene, this.camera);
    } catch {} finally {
      r.setRenderTarget(prev);
      for (const o of hidden) o.visible = false;
      [cam.left, cam.right, cam.top, cam.bottom, cam.near, cam.far] = keep; cam.updateProjectionMatrix();
      sun.position.copy(pos); sun.target.position.copy(tgt); sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
      sun.shadow.needsUpdate = true;
    }
  }
  #aoWarmUp() {
    if (this._aoWarm) return this._aoWarm;
    const g = new THREE.Group(), geo = new THREE.BoxGeometry(0.01, 0.01, 0.01), m = this.ao.normalMaterial;
    const plain = new THREE.InstancedMesh(geo, m, 1), coloured = new THREE.InstancedMesh(geo, m, 1);
    coloured.setColorAt(0, new THREE.Color());
    g.add(new THREE.Mesh(geo, m), plain, coloured);
    return (this._aoWarm = g);
  }

  /** Switch the book room to another department: only when the room shows one department at a time (a library too
   *  big for its walls). With all departments on the walls it only rebuilds the shelves (showDepartment walks there). */
  setDepartment(name) {
    if (!this.library || (name === this.department && !this.layout?.allDepartments)) return false;
    if (this.refreshShelves({ department: name })) return true;
    // (a seated reader stays seated through the build, as with new books: setPose and sit() again put the eye at
    // standing height and glided it back down into the seat, with the sound of sitting down, after every switch)
    this.#rebuildInPlace({ department: name });
    return true;
  }
  /**
   * The wheel's choice when all departments stand in the room: walk (a short glide) to about 1.8 m in front of the
   * department's first case and face it; from outside the book room through `fade` (a fade to black and back).
   * @returns false when the room shows one department at a time (then setDepartment switches it).
   */
  showDepartment(name, fade) {
    const L = this.layout;
    if (!L?.allDepartments) return false;
    const run = (L.departmentRuns || []).find((r) => r.name === name || r.id === name);
    if (!run) return false;
    const pose = this.departmentPose(run);
    this.actions.leaveSeat();
    const p = this.player.position;
    const inRoom = p.x > ROOM.x0 && p.x < ROOM.x1 && p.z > ROOM.z0 && p.z < ROOM.z1 - 0.2;
    const jump = () => { this.player.transition = null; this.player.setPose(pose.x, pose.z, pose.yaw, pose.pitch); };
    if (inRoom) {
      const dist = Math.hypot(pose.x - p.x, pose.z - p.z);
      this.player.moveTo(new THREE.Vector3(pose.x, EYE, pose.z), pose.yaw, pose.pitch, clamp(0.5 + dist / 10, 0.6, 1.6));
    } else if (fade) fade(jump);
    else jump();
    this.#setFocus(run.name);
    return true;
  }
  /** Where to stand for a department: about 1.8 m in front of its first case, facing it, on a free spot. */
  departmentPose(run) {
    const { x, z, rot } = run.first;
    const fx = Math.sin(rot), fz = Math.cos(rot), yaw = Math.atan2(fx, fz);
    for (const dist of [1.8, 1.6, 2.0, 1.45, 2.3]) {
      for (const side of [0, 0.35, -0.35, 0.7, -0.7]) {
        const px = x + fx * dist + fz * side, pz = z + fz * dist - fx * side;
        if (this.player.isFree(px, pz, 0.06)) return { x: px, z: pz, yaw, pitch: 0.06 };
      }
    }
    return { x: x + fx * 1.8, z: z + fz * 1.8, yaw, pitch: 0.06 };
  }
  /** The department in front of the player (HUD chip, wheel): the case of the book under the crosshair, else the
   *  nearest case in view, a few times a second. */
  #trackDepartment(dt) {
    if (!this.layout?.allDepartments) return;
    this.focusT = (this.focusT || 0) - dt;
    if (this.focusT > 0) return;
    this.focusT = 0.25;
    const p = this.camera.position;
    // a book under the crosshair decides (between two cases the nearest one may belong to the neighbour)
    const aimed = this.books.hover?.bookcase;
    let best = aimed && (aimed.dep || aimed.recent || aimed.read) ? aimed : null;
    if (!best && p.x > ROOM.x0 && p.x < ROOM.x1 && p.z > ROOM.z0 && p.z < ROOM.z1) {
      const fx = -Math.sin(this.player.yaw), fz = -Math.cos(this.player.yaw);
      let bestScore = 9;
      for (const bc of this.layout.bookcases) {
        if (!bc.dep && !bc.recent && !bc.read) continue;
        const dx = bc.x - p.x, dz = bc.z - p.z, dist = Math.hypot(dx, dz) || 1e-3;
        const cos = (dx * fx + dz * fz) / dist;
        const score = dist * (cos > 0.6 ? 1 : cos > 0.2 ? 1.8 : 3.5);
        if (score < bestScore) { bestScore = score; best = bc; }
      }
    }
    // the recently-read case has no department: the chip names the case
    this.#setFocus(best?.dep?.name || null, best?.recent ? tr({ de: 'Zuletzt gelesen', en: 'Recently read' }) : best?.read ? tr({ de: 'Gelesen', en: 'Read' }) : null);
  }
  #setFocus(name, label = null) {
    const shown = name || label;
    if (shown === this.focusDepartment) return;
    this.focusDepartment = shown;
    if (name) this.department = name;
    this.opts.onDepartment?.(shown, this.layout?.departments || []);
  }
  /**
   * Build again with the same books and department, keeping the player exactly where they are. A glide to or from a
   * seat goes on, and a seated player keeps the eye height of the seat: setPose puts the eye back at standing height,
   * which lifted a seated reader out of the chair whenever new books changed the number of cases.
   */
  #rebuildInPlace(opts = {}) {
    const p = this.player;
    const pos = p.position.clone(), yaw = p.yaw, pitch = p.pitch, tr = p.transition, ground = p.ground;
    const basket = [...this.actions.basket], seated = this.actions.seatedId, eye = seated ? this.seats.get(seated)?.eye.clone() : null;
    this.build(this.library, opts);
    this.actions.setBasket(basket);
    // a seat the new room no longer has, or not in this place (a reading nook of the book room moves with the cases of
    // another department, its number stays): the reader stands up where it stood, else they would sit in the air
    const again = seated ? this.seats.get(seated) : null, gone = !!seated && !(again && eye && again.eye.distanceTo(eye) < 0.05);
    if (gone) this.actions.leaveSeat();
    if (!gone && (p.seated || tr)) { p.transition = tr; p.position.copy(pos); p.yaw = yaw; p.pitch = pitch; p.velocity.set(0, 0, 0); }
    else { p.transition = null; p.setPose(pos.x, pos.z, yaw, pitch, gone ? undefined : ground); }   // (on a table: still on it)
  }
  /** The "recently read" shelf – ids newest first. */
  setRecent(ids) {
    const next = (ids || []).slice(0, 27);
    if (next.join('|') === (this.recent || []).join('|')) return;
    if (!this.library) { this.recent = next; return; }
    if (this.refreshShelves({ recent: next })) return;
    this.recent = next;
    this.#rebuildInPlace();
  }

  #clearStatic() {
    // the old parts leave the scene now but are disposed only after the new build has compiled (#disposeRetired):
    // disposing a material first let three.js delete every shader program that only it used, and the new build, made of
    // the same materials, compiled them all again (one frame of 0.5 to 2 s after a library change)
    for (const c of [...this.static.children]) { this.static.remove(c); this.retired.push(c); }
    this.shelfGroup = null;
    this.colliders.length = 0; this.lights.length = 0; this.lamps.length = 0; this.glows.length = 0; this.lampMats.clear(); this.flames.length = 0; this.interactables.length = 0; this.occluders.length = 0;
    this.seats.clear(); this.surfaces.clear(); this.paintings.length = 0; this.bookcaseObjects.clear();
    this.fireAnchor = null; this.recordPlayer = null; this.easel = null; this.wallClock = null; this.displayTable = null; this.door = null;
    this.lampSwitch.reset();   // the lamps of the new build register again, their states stay (lamp-switch.js)
    if (this.env) { for (const f of this.env.fires) { this.scene.remove(f.group); this.retired.push(() => f.dispose?.()); } this.env.fires.length = 0; this.fire = null; }
    if (this.cat) { const cat = this.cat; this.catMemo = cat.memo(); this.scene.remove(cat.group); this.retired.push(() => cat.dispose?.()); this.cat = null; }   // the new cat carries on where this one was
  }

  /** Keep the number of point lights the same from build to build at a lamp tier: three.js compiles the number of
   *  lights into every lit shader, so one lamp less after a library change (a reading corner gave way to a bookcase)
   *  compiled every program again. Missing lights are made up with dark ones far below the floor. */
  #padLights() {
    let n = 0;
    // (a light on no layer is not drawn: the lamps of 'mobile' stand behind its pool, mobile.js)
    this.scene.traverseVisible((o) => { if (o.isPointLight && !o.userData.pad && o.layers.mask !== 0) n++; });
    const marks = this.lightMarks || (this.lightMarks = {});
    const mark = this.lampTier + (this.mobileTier.on ? 'm' : '');
    const want = Math.max(marks[mark] || 0, n);
    marks[mark] = want;
    let pads = this.lightPads;
    if (!pads) { pads = this.lightPads = new THREE.Group(); pads.name = 'light-pads'; this.scene.add(pads); }
    while (pads.children.length > want - n) pads.remove(pads.children[pads.children.length - 1]);
    while (pads.children.length < want - n) { const l = new THREE.PointLight(0x000000, 0, 0.01, 2); l.position.set(0, -60, 0); l.userData.pad = true; pads.add(l); }
  }

  /** Dispose what the last #clearStatic or shelf swap took out of the scene, once the new parts hold their shader
   *  programs (compile in #warmUp acquires them at once, compileAsync only waits for the driver). */
  #disposeRetired() {
    const old = this.retired; this.retired = [];
    for (const c of old) { if (typeof c === 'function') c(); else disposeTree(c); }   // parts, or the dispose of the cat and the fires
    this.books.disposeRetired();
  }

  #buildStructure() {
    const L = this.layout;
    // warm white plaster, light oak boards, a white coffered ceiling (the striped wallpaper, walnut and
    // yellowed plaster made both rooms look brown and old)
    const mats = { wall: M.wall('#f7f3ec'), wall2: M.wall('#f3eee6'), wallpaper: M.wall('#f7f2ea'), floor: M.floor('oak'), floor2: M.floor('oak'), ceiling: M.coffered() };
    const p = new Parts();
    // one texture tile = 2.4 m: ten 24 cm boards, each up to 2.4 m long
    for (const f of L.floors) { const m = new THREE.Mesh(planeGeoUV(f.w, f.d, 2.4), mats[f.mat] || mats.floor); m.rotation.x = -Math.PI / 2; m.position.set(f.x, 0, f.z); m.receiveShadow = true; m.userData.occluder = true; this.static.add(m); this.occluders.push(m); }
    for (const c of L.ceilings) { const m = new THREE.Mesh(planeGeoUV(c.w, c.d, 2.2), mats.ceiling); m.rotation.x = Math.PI / 2; m.position.set(c.x, c.y, c.z); m.receiveShadow = true; m.userData.occluder = true; this.static.add(m); this.occluders.push(m); }
    for (const w of L.walls) p.add(boxGeoUV(w.w, w.h, w.d, 1.2), mats[w.mat] || mats.wall, [w.x, w.y, w.z]);
    for (const c of L.colliders) this.colliders.push(c);

    // --- wainscoting & cornice (already split around doorways by the layout) ---------------------
    // painted sage panelling with a white crown moulding
    const wain = M.paint('#a9b6a0'), crown = M.paint('#f3efe7');
    const TH = 0.11;
    for (const tm of L.trim) {
      const { axis, at, dir, mid, len, ceilingH, corniceOnly, railOnly } = tm;
      const put = (y, h2, thick, mat = wain) => {
        const o2 = dir * thick / 2;
        if (axis === 'x') p.add(boxGeoUV(len, h2, thick, 0.5), mat, [mid, y, at + o2]);
        else p.add(boxGeoUV(thick, h2, len, 0.5), mat, [at + o2, y, mid]);
      };
      if (corniceOnly) { put(ceilingH - 0.12, 0.24, TH + 0.05, crown); continue; }
      if (tm.skirtOnly) { put(0.07, 0.14, TH + 0.035); continue; }   // under something hung low (the world map)
      if (!railOnly) {
        put(0.5, 0.86, TH);            // panelled field
        put(0.07, 0.14, TH + 0.035);   // skirting
      }
      if (!tm.noRail) put(0.97, 0.06, TH + 0.035);   // chair rail
    }

    // --- timber casing of the passage openings --------------------------------------------------------
    // The passage walls line the openings themselves; the casing stands in front of the wall face (dir says
    // on which side) and covers the passage walls' ends. Nothing of it reaches into the wall or the passage.
    const casing = M.wood('oak');
    for (const o of L.openings) {
      if (o.kind !== 'arch') continue;
      // posts up to the opening's top, the header across the full width above them (they must not overlap:
      // two coplanar front faces z-fight)
      const dir = o.dir || 1, zc = o.z + dir * CASING_D / 2, cw = CASING_W;
      for (const s of [-1, 1]) p.add(boxGeoUV(cw, o.h, CASING_D, 0.5), casing, [o.x + s * (o.w / 2 + cw / 2), o.h / 2, zc]);
      p.add(boxGeoUV(o.w + 2 * cw, 0.22, CASING_D, 0.5), casing, [o.x, o.h + 0.11, zc]);
      p.add(boxGeoUV(o.w + 2 * cw + 0.06, 0.04, CASING_D + 0.03, 0.5), casing, [o.x, o.h + 0.24, o.z + dir * (CASING_D + 0.03) / 2]);   // cap
    }

    const structure = p.build({ name: 'structure' });
    structure.traverse((o) => { if (o.isMesh) o.userData.occluder = true; });
    this.static.add(structure); this.occluders.push(structure);
  }

  /** Name plates of the layout (department above the passage, "recently read"): part of the shelves group. */
  #buildNamePlates(group) {
    this.labelObjects = new Map();
    for (const lb of this.layout.labels) {
      const text = typeof lb.text === 'string' ? lb.text : tr(lb.text);
      const width = lb.width || 1.5, height = width * 128 / 768;
      // laid out 768 × 128 units, drawn at the close-up density (signs.js)
      const W = Math.round(width * SIGN_DENSITY.close), k = W / 768, H = Math.round(128 * k);
      const opts = { width: 768, height: 128, bg: F.PLATE.bg, fg: F.PLATE.fg, border: F.PLATE.border, font: '600 58px "Cormorant Garamond", Georgia, serif' };
      const sign = signs.get(`nameplate|${W}x${H}|${text}`, { kind: 'nameplate', w: W, h: H, metres: [width, height], bg: F.PLATE.bg, draw: (g) => { g.scale(k, k); drawLabel(g, text, opts); } });
      const mat = signs.use(sign, new THREE.MeshStandardMaterial({ roughness: 0.55 }));
      mat.userData.disposable = true;
      const nx = Math.sin(lb.rot), nz = Math.cos(lb.rot);
      const plate = new THREE.Mesh(planeGeo(width, height), mat);
      plate.position.set(lb.x + nx * 0.04, lb.y, lb.z + nz * 0.04); plate.rotation.y = lb.rot;
      group.add(plate);
      const back = new THREE.Mesh(boxGeo(width + 0.1, height + 0.07, 0.04), M.wood('oak'));
      back.position.set(lb.x + nx * 0.015, lb.y, lb.z + nz * 0.015); back.rotation.y = lb.rot;
      group.add(back);
      if (lb.id) this.labelObjects.set(lb.id, plate);
    }
  }

  #buildPlacements() {
    const L = this.layout;
    signs.begin('furniture');   // the plates on the furniture (furniture.js plateMaterial)
    for (const pl of L.placements) {
      if (pl.meta?.skipIf) continue;
      let obj = null;
      switch (pl.kind) {
        case 'armchair': obj = F.armchair(pl.opts); break;
        case 'sofa': obj = F.sofa(pl.opts); break;
        case 'chair': obj = F.chair(pl.opts); break;
        case 'windowseat': obj = F.windowSeat(pl.opts); break;
        case 'table': obj = F.table(pl.opts); break;
        case 'displaytable': obj = F.displayTable(pl.opts); break;
        case 'sidetable': obj = F.sideTable(pl.opts); break;
        case 'desk': obj = F.desk(pl.opts); break;
        case 'bankerlamp': obj = F.deskLamp(); break;
        case 'floorlamp': obj = F.floorLamp(pl.opts); break;
        case 'tablelamp': obj = F.tableLamp(pl.opts); break;
        case 'chandelier': obj = F.chandelier(pl.opts); break;
        case 'pendant': obj = F.pendant(pl.opts); break;
        case 'sconce': obj = F.wallSconce(pl.opts); break;
        case 'glazing': obj = F.glazing(pl.opts); this.occluders.push(obj); break;
        case 'glassdoor': obj = F.glassDoor(pl.opts); this.occluders.push(obj); break;
        case 'lounger': obj = F.lounger(pl.opts); break;
        case 'parkbench': obj = F.parkBench(pl.opts); break;
        case 'firebowl': obj = fireBowlProp(); break;
        case 'stump': obj = logStump(pl.opts); break;
        case 'planter': obj = F.planter(pl.opts); break;
        case 'windowbench': obj = F.windowBench(pl.opts); break;
        case 'sideboard': obj = F.sideboard(pl.opts); break;
        case 'records': obj = F.recordCrate(); break;
        case 'bookcase': obj = F.bookcase({ wood: pl.opts.wood }); this.bookcaseObjects.set(pl.meta.bookcase, obj); break; // also an occluder (see below); its signs belong to the shelves
        case 'window': obj = F.windowFrame({ ...pl.opts, reveal: HALL.wall }); break;
        case 'door': obj = F.doubleDoor(pl.opts); break;
        case 'fireplace': obj = F.fireplace(pl.opts); break;
        case 'rug': obj = F.rug(pl.opts); break;
        case 'plant': obj = F.plant(pl.opts); break;
        case 'ladder': obj = F.ladder(pl.opts); break;
        case 'painting': obj = F.paintingFrame(pl.opts); break;
        case 'beam': obj = F.ceilingBeam(pl.opts); break;
        case 'computer': obj = F.computerTerminal({ screenTexture: this.actions.screenTexture() }); break;
        case 'recordplayer': obj = F.recordPlayer(); this.recordPlayer = obj; break;
        case 'radio': obj = F.radio(); break;
        case 'easel': obj = F.easel({ canvasTexture: this.actions.easelTexture() }); this.easel = obj; break;
        case 'lectern': obj = F.lectern(); break;
        case 'newsrack': obj = F.newspaperRack({}); break;   // the papers of the interface language (furniture.js)
        case 'returncounter': obj = F.returnCounter(); break;
        case 'clock': obj = F.clock(); this.wallClock = obj; break;
        case 'bust': obj = F.bust(); break;
        case 'candle': obj = F.candle(); break;
        case 'cardcatalog': obj = F.cardCatalog(); break;
        case 'chessboardprop': obj = this.actions.chessBoardProp(); break;
        case 'screen': obj = this.cinema.buildScreen(); break;
        case 'projector': obj = this.cinema.buildProjector(); break;
        case 'ereader': obj = F.ereaderStand(); break;
        case 'worldmap': obj = worldMapProp({ ...pl.opts, quality: this.quality, anisotropy: this.maxAnisotropy ?? this.renderer.capabilities.getMaxAnisotropy() }); break;
        case 'audiobooks': obj = this.audiobooks.buildCase(); break;
        case 'feeder': obj = buildFeeder(); break;        // the feeding station on the meadow and the hide facing it (feeder.js)
        case 'feederhide': obj = buildHide(); break;
        default: continue;
      }
      obj.position.set(pl.x, pl.meta?.y || 0, pl.z); obj.rotation.y = pl.rot;
      obj.userData.placement = pl;
      this.static.add(obj);
      obj.updateMatrixWorld(true);
      const fp = obj.userData.footprint;
      if (fp) {
        const c = Math.abs(Math.cos(pl.rot)), s = Math.abs(Math.sin(pl.rot));
        const w = fp.w * c + fp.d * s, d = fp.w * s + fp.d * c;
        const shrink = pl.kind === 'chair' ? 0.1 : 0;
        const col = aabb(pl.x, (pl.meta?.y || 0) + (fp.h || 1) / 2, pl.z, w - shrink, fp.h || 1, d - shrink);
        // low furniture can be stood on: the player tests its tops instead of the whole box (player.js)
        if (obj.userData.tops) col.parts = topParts(obj.userData.tops, pl);
        this.colliders.push(col);
      } else if (ON_FURNITURE.has(pl.kind) && (pl.meta?.y || 0) > 0.3) {
        // what stands on a table, a desk or the sideboard (lamps, a candle, the record player, the computers) is in the
        // way of someone walking up there
        const b = solidBounds(obj);
        if (b) this.colliders.push({ min: b.min.toArray(), max: b.max.toArray(), prop: true });
      }
      // below its tier a lamp has no real light: its decals then show on their own that it is on (glow.noLight)
      let dark = false;
      if (obj.userData.lights) for (const l of obj.userData.lights) {
        const wp = new THREE.Vector3(); l.light.getWorldPosition(wp);
        if ((l.tier || 3) > this.lampTier) { l.light.parent?.remove(l.light); l.light.dispose?.(); dark = true; continue; }
        l.light.intensity = 0; l.light.castShadow = false;
        // hall lamps are turned down while a film runs on the screen (cinema.hallDim)
        this.lamps.push({ light: l.light, base: l.intensity, flicker: l.flicker || 0, phase: this.lamps.length * 1.7, hall: wp.z > HALL.z0 - 0.3 });
      }
      if (obj.userData.glows) for (const m of obj.userData.glows) {
        const wp = new THREE.Vector3(); m.getWorldPosition(wp);
        const gl = m.userData.glow || {};
        this.glows.push({ mat: m.material, base: (dark && gl.noLight != null ? gl.noLight : gl.base) ?? m.material.opacity, gain: gl.gain || 1, hall: wp.z > HALL.z0 - 0.3 });
      }
      if (obj.userData.lights || obj.userData.glows) this.#registerLampGlow(obj);
      if (obj.userData.flames) { this.flames.push(obj.userData.flames); obj.userData.flames.userData.dynamic = true; }
      // every lamp of the furniture builders: E or a click switches it, by an id from its place (lamp-switch.js)
      if (obj.userData.lamp) this.lampSwitch.register(obj, lampIdOf(pl), this);
      if (obj.userData.seat && pl.meta?.seat) {
        const sd = obj.userData.seat;
        const eye = new THREE.Vector3(...sd.eye).applyMatrix4(obj.matrixWorld);
        const look = new THREE.Vector3(...sd.look).applyMatrix4(obj.matrixWorld);
        const yaw = Math.atan2(-(look.x - eye.x), -(look.z - eye.z));
        const standDir = new THREE.Vector3(look.x - eye.x, 0, look.z - eye.z).normalize();
        const standPos = new THREE.Vector3(pl.x, EYE, pl.z).addScaledVector(standDir, (obj.userData.footprint?.d || 0.9) / 2 + 0.55);
        this.seats.set(pl.meta.seat, {
          id: pl.meta.seat, obj, meta: pl.meta, eye, yaw, pitch: sd.pitch ?? (sd.kind === 'chair' ? -0.25 : -0.12),
          standPos, standYaw: yaw, table: pl.meta.table || null, kind: sd.kind,
          catSpot: sd.catSpot ? new THREE.Vector3(...sd.catSpot).applyMatrix4(obj.matrixWorld) : null, label: pl.meta.label,
        });
        obj.userData.interact = { kind: 'seat', seat: pl.meta.seat };
        obj.traverse((o) => { if (o.isMesh) { o.userData.interact = obj.userData.interact; o.userData.root = obj; } });
        this.interactables.push(obj);
      }
      if (obj.userData.surface && pl.meta?.surface) {
        const id = pl.meta.id || `surf:${pl.x.toFixed(1)}:${pl.z.toFixed(1)}`;
        this.surfaces.set(id, { obj, surface: obj.userData.surface, placement: pl });
      }
      if (obj.userData.display && pl.meta?.id === 'displaytable') this.displayTable = { obj, spec: obj.userData.display };
      if (pl.meta?.interact) {
        const standAt = pl.meta.standAt ? [...pl.meta.standAt] : null;
        if (standAt) standAt[2] = Math.atan2(-(pl.x - standAt[0]), -(pl.z - standAt[1])); // face the object
        obj.userData.interact = { kind: pl.meta.interact, label: pl.meta.label, standAt };
        obj.traverse((o) => { if (o.isMesh) { o.userData.interact = obj.userData.interact; o.userData.root = obj; } });
        this.interactables.push(obj);
      }
      if (pl.kind === 'painting') { obj.userData.interact = { kind: 'painting', slot: pl.meta.slot }; obj.traverse((o) => { if (o.isMesh) { o.userData.interact = obj.userData.interact; o.userData.root = obj; } }); this.interactables.push(obj); this.paintings.push({ obj, slot: pl.meta.slot, placement: pl }); }
      if (pl.kind === 'fireplace') this.fireAnchor = new THREE.Vector3(...obj.userData.fireAnchor).applyMatrix4(obj.matrixWorld);
      if (pl.kind === 'glassdoor') this.#setupDoor(obj);
      if (pl.kind === 'bookcase') { obj.traverse((o) => { if (o.isMesh) { o.userData.bookcaseId = pl.meta.bookcase; o.userData.occluder = true; } }); this.occluders.push(obj); }
    }
    signs.end('furniture');
    this.static.add(this.#contactShadows());
    if (this.fireAnchor) { if (!this.env) this.env = new Environment(this.scene, this.renderer, this.layout); this.fire = this.env.addFire(this.fireAnchor); }
    // The cat routes around every collider on the floor and never leaves the floors of the building (cat.js).
    const catSpots = [...this.seats.values()].filter((s) => s.meta.cat && s.catSpot).map((s) => ({ id: s.id, position: s.catSpot, yaw: s.yaw + Math.PI / 2 }));
    if (catSpots.length) {
      this.cat = new Cat(catSpots, (on) => this.opts.onPurr?.(on), { colliders: this.colliders, floors: L.floors, props: this.static.children, sfx: (n) => this.opts.onSfx?.(n), memo: this.catMemo });
      this.scene.add(this.cat.group);
    }
  }

  /** Shades, diffusers and bulbs (materials with userData.lampGlow) glow in the lamp colour and follow the
   *  brightness setting like the lights do. The materials are shared between lamps: the hall's lamps get their own
   *  copies, because only those are turned down while a film runs. */
  #registerLampGlow(obj) {
    const wp = new THREE.Vector3(); obj.getWorldPosition(wp);
    const hall = wp.z > HALL.z0 - 0.3;
    obj.traverse((o) => {
      if (!o.isMesh || o.material?.userData?.lampGlow == null || Array.isArray(o.material)) return;
      let m = o.material;
      if (hall) {
        let h = hallGlowMats.get(m);
        if (!h) { h = m.clone(); hallGlowMats.set(m, h); }
        m = o.material = h;
      }
      if (!this.lampMats.has(m)) this.lampMats.set(m, { base: m.userData.lampGlow, hall });
    });
  }

  /** Contact shadows: a soft dark patch under everything that stands on the floor, so furniture no longer
   *  seems to float over the parquet when no sun shadow falls on it (evenings, the book room). */
  #contactShadows() {
    const skip = new Set(['fireplace', 'window', 'glazing', 'door', 'rug', 'painting', 'screen', 'beam', 'ladder', 'pendant', 'records']);
    const list = [];
    for (const obj of this.static.children) {
      const pl = obj.userData.placement; const fp = obj.userData.shadowFootprint || obj.userData.footprint;
      if (!pl || !fp || skip.has(pl.kind) || (pl.meta?.y || 0) > 0.01) continue;
      const strong = pl.kind === 'bookcase' || pl.kind === 'sofa' || pl.kind === 'armchair' || pl.kind === 'returncounter' || pl.kind === 'cardcatalog';
      list.push({ x: pl.x, z: pl.z, rot: pl.rot, w: fp.w * 1.25 + 0.2, d: fp.d * 1.25 + 0.2, strong });
    }
    const mat = new THREE.MeshBasicMaterial({ map: contactShadowTexture(), color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    mat.userData.disposable = true; mat.userData.keepMap = true;
    const mesh = new THREE.InstancedMesh(planeGeo(1, 1), mat, Math.max(1, list.length));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    list.forEach((c, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.rot).multiply(flat);
      m.compose(new THREE.Vector3(c.x, 0.021, c.z), q, new THREE.Vector3(c.w, c.d * (c.strong ? 1 : 0.95), 1));
      mesh.setMatrixAt(i, m);
    });
    mesh.count = list.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.renderOrder = 1; mesh.frustumCulled = false; mesh.name = 'contactshadows';
    return mesh;
  }

  /** The glazed doors to the terrace (furniture.js glassDoor): their hinges, the collider across the shut doorway
   *  (layout.js, `door: true`) and a row of small boxes along each leaf that follows it while it turns. */
  #setupDoor(obj) {
    const d = obj.userData.door;
    const shut = this.colliders.find((c) => c.door);
    const open = [];
    const rows = d.leaves.map(() => Array.from({ length: 7 }, () => { const c = { min: [0, 0, 0], max: [0, -1, 0], doorLeaf: true, on: d.h }; open.push(c); this.colliders.push(c); return c; }));
    const wp = new THREE.Vector3(); obj.getWorldPosition(wp);
    this.door = { obj, leaves: d.leaves, angle: d.angle, shut, shutH: shut?.max[1] ?? d.h, open, rows, t: 0, target: 0, swing: 1, x: wp.x, z: wp.z, w: d.w, h: d.h };
  }
  /**
   * The doors open by themselves when you walk up to them and close behind you (every frame; public for the checks
   * that walk the player without rendering). They always swing away from you: outwards onto the deck when you leave
   * the hall, inwards when you come in from the garden. A door still open the other way closes first. Their colliders
   * follow the leaves.
   */
  updateDoor(dt) {
    const d = this.door; if (!d) return;
    const p = this.player.position;
    const near = !this.player.seated && Math.abs(p.x - d.x) < d.w / 2 + 0.7 && p.z > d.z - 2.4 && p.z < d.z + 2.9;
    const side = p.z < d.z + 0.17 ? 1 : -1;      // 1: you are in the hall, the leaves go out; -1: you come in, they go in
    if (near && d.t === 0 && d.swing !== side) this.#hingeDoor(side);
    let target = near ? 1 : 0;
    // back at a door that is closing towards you: it shuts first, then opens the other way (open, it stays open)
    if (near && d.t > 0 && d.target === 0 && d.swing !== side) target = 0;
    if (target !== d.target) d.target = target;   // (silently: no creak, no latch)
    if (d.t === d.target) return;
    d.t = d.target > d.t ? Math.min(1, d.t + dt / 0.75) : Math.max(0, d.t - dt / 1.1);
    const k = d.t * d.t * (3 - 2 * d.t);
    for (const pivot of d.leaves) pivot.rotation.y = pivot.userData.sign * d.swing * d.angle * k;
    // shut: the collider across the doorway; moving or open: the boxes along the leaves
    if (d.shut) d.shut.max[1] = d.t > 0 ? -1 : d.shutH;
    d.obj.updateMatrixWorld(true);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    d.leaves.forEach((pivot, i) => {
      const leaf = pivot.children[0], far = pivot.userData.far;
      a.set(0, 0, far[2]).applyMatrix4(leaf.matrixWorld); b.set(...far).applyMatrix4(leaf.matrixWorld);
      const row = d.rows[i], n = row.length, pad = 0.04;
      row.forEach((c, j) => {
        const x0 = a.x + (b.x - a.x) * j / n, z0 = a.z + (b.z - a.z) * j / n, x1 = a.x + (b.x - a.x) * (j + 1) / n, z1 = a.z + (b.z - a.z) * (j + 1) / n;
        c.min[0] = Math.min(x0, x1) - pad; c.max[0] = Math.max(x0, x1) + pad; c.min[2] = Math.min(z0, z1) - pad; c.max[2] = Math.max(z0, z1) + pad;
        c.min[1] = 0; c.max[1] = d.t > 0 ? d.h : -1;
      });
    });
  }
  /** Put the hinges on the face the leaves will swing to (only while the doors are shut: the leaves stay where they are). */
  #hingeDoor(swing) {
    const d = this.door;
    d.swing = swing;
    for (const pivot of d.leaves) {
      const [pz, lz] = pivot.userData.hinge[swing > 0 ? 'out' : 'in'];
      pivot.position.z = pz; pivot.children[0].position.z = lz;
    }
  }

  /** Card on the middle shelf of the empty "recently read" case. (The case "Gelesen" has no card: empty, it shows its
   *  sign and its bare shelves.) */
  #recentCard(caseObj) {
    // laid out 512 × 300 units, drawn at the density of the shelf labels (signs.js)
    const LW = 512, LH = 300, metres = [0.34, 0.2], W = Math.round(metres[0] * SIGN_DENSITY.shelf), k = W / LW, H = Math.round(LH * k);
    const lines = tr({ de: ['Hier stehen die Bücher,', 'die du zuletzt gelesen', 'oder zurückgegeben hast.'], en: ['The books you read', 'or returned last', 'stand here.'] });
    const list = Array.isArray(lines) ? lines : [String(lines)];
    const sign = signs.get(`card|${W}x${H}|${list.join('|')}`, { kind: 'card', w: W, h: H, metres, bg: '#faf8f3', draw: (g) => {
      g.scale(k, k);
      g.strokeStyle = '#d6cdbd'; g.lineWidth = 3; g.strokeRect(12, 12, LW - 24, LH - 24);
      g.fillStyle = '#2c2a27'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '600 40px "EB Garamond", Georgia, serif';
      list.forEach((line, i) => g.fillText(line, LW / 2, 90 + i * 60));
    } });
    const mat = signs.use(sign, new THREE.MeshStandardMaterial({ roughness: 0.85 })); mat.userData.disposable = true;
    const card = new THREE.Mesh(planeGeo(metres[0], metres[1]), mat);
    const local = new THREE.Vector3(0, F.SHELF_LEVELS[1] + 0.105, 0.03);
    card.position.copy(local.applyMatrix4(caseObj.matrixWorld));
    card.quaternion.setFromRotationMatrix(caseObj.matrixWorld).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.18));
    return card;
  }

  #buildShelfLabels(parent) {
    const group = new THREE.Group(); group.name = 'shelflabels'; parent.add(group);
    const plates = [], ends = new Parts();
    // the shelf labels: dark type on warm white, readable from about 1.5 m; as wide as their text (up to 0.62 m)
    const PH = 0.05, PX = 64 / PH;                                            // plate height, pixels per metre
    const font = '600 40px "EB Garamond", Georgia, serif';
    const measure = document.createElement('canvas').getContext('2d'); measure.font = font;
    for (const bc of this.layout.bookcases) {
      const obj = this.bookcaseObjects.get(bc.id); if (!obj) continue;
      // an empty "recently read" case explains itself with a small standing card
      if (bc.recent && bc.rows.every((r) => !r.items.length)) group.add(this.#recentCard(obj));
      // a library without books: the first waiting case says how books get in (empty-library.js)
      if (bc.waiting && bc.card) group.add(waitingCard(obj));
      for (const row of bc.rows) {
        if (!row.items.length) continue;
        if (row.section) {
          const text = row.section;
          const pw = Math.min(0.62, Math.max(0.2, (measure.measureText(text).width + 34) / PX));
          // on the front edge of the shelf board the books stand on, reaching a little over their feet; on the lowest
          // shelf it sits higher, where the edge of the sloped display board in front does not hide it
          const boardFront = 0.01 + (F.BOOKCASE.d - 0.04) / 2;
          const y = row.level === 0 ? row.y + 0.012 : row.y - 0.008;
          const local = new THREE.Vector3(-F.BOOKCASE.innerW / 2 + 0.03 + pw / 2, y, boardFront + 0.0025);
          plates.push({ text, w: pw, matrix: obj.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(local.x, local.y, local.z)) });
        }
        const last = row.items[row.items.length - 1];
        const endX = -F.BOOKCASE.innerW / 2 + 0.03 + last.x + last.w + 0.006;
        if (endX < F.BOOKCASE.innerW / 2 - 0.12) {
          const at = obj.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(endX, row.y, F.BOOKCASE.d / 2 - 0.02 - 0.1));
          // the foot lies under the last books, as with a real bookend. Warm white and lower and shallower than the
          // books: a black one flush against the last book, seen at an angle, looked like a black front cover.
          ends.addMatrix(boxGeo(0.09, 0.004, 0.11), BOOKEND(), at.clone().multiply(new THREE.Matrix4().makeTranslation(0.004 - 0.045, 0.002, 0)));
          ends.addMatrix(boxGeo(0.005, 0.13, 0.11), BOOKEND(), at.clone().multiply(new THREE.Matrix4().makeTranslation(0.0025, 0.065, 0)));
        }
      }
    }
    // all shelf labels share one texture (rows of cells, each label as wide as it is) and one mesh; the book ends one
    // mesh. The cells are laid out 64 units high (40 unit type) and drawn at the shelf-label density of signs.js.
    if (plates.length) {
      const D = SIGN_DENSITY.shelf, k = D / PX, CH = Math.round(PH * D), W = 2048;
      let x = 0, y = 0;
      for (const pl of plates) { const cw = Math.ceil(pl.w * D); if (x + cw > W) { x = 0; y += CH; } pl.cell = [x, y, cw]; x += cw; }
      const H = y + CH;
      const cells = plates.map((pl) => [pl.text, ...pl.cell]);
      const sign = signs.get(`plates|${W}x${H}|${JSON.stringify(cells)}`, { kind: 'plates', w: W, h: H, metres: [W / D, H / D], bg: '#faf8f3', draw: (g) => {
        g.textAlign = 'center'; g.textBaseline = 'middle';
        for (const [text, cx, cy, cw] of cells) {
          const lw = cw / k;                                                     // the cell in layout units
          g.setTransform(k, 0, 0, k, cx, cy);
          g.strokeStyle = '#cfc4b0'; g.lineWidth = 2; g.strokeRect(3, 3, lw - 6, 64 - 6);
          g.fillStyle = '#23211e';
          let size = 40; g.font = font;
          while (g.measureText(text).width > lw - 22 && size > 20) { size -= 2; g.font = font.replace('40px', size + 'px'); }
          g.fillText(text, lw / 2, 64 / 2 + 2);
        }
      } });
      const mat = signs.use(sign, new THREE.MeshStandardMaterial({ roughness: 0.7 })); mat.userData.disposable = true;
      const pp = new Parts();
      for (const pl of plates) {
        const [cx, cy, cw] = pl.cell;
        const geo = new THREE.PlaneGeometry(pl.w, PH), uv = geo.attributes.uv;
        for (let n = 0; n < uv.count; n++) uv.setXY(n, (cx + uv.getX(n) * cw) / W, 1 - (cy + (1 - uv.getY(n)) * CH) / H);
        pp.addMatrix(geo, mat, pl.matrix); geo.dispose();
      }
      group.add(pp.build({ name: 'section-plates', castShadow: false }));
    }
    group.add(ends.build({ name: 'bookends' }));
  }

  /** Department signs on the wall above each run of cases (and above the recently-read case): warm white capitals on
   *  deep teal in an oak frame, readable across the room. One texture, one mesh for all plates, one for the frames. */
  #buildSigns(parent) {
    const list = this.layout.signs || [];
    if (!list.length) return;
    const CH0 = 128, PX = CH0 / 0.3;                                           // layout units: cell height, units per metre (0.3 m plates)
    const font = (size) => `600 ${size}px "Cormorant Garamond", "EB Garamond", Georgia, serif`;
    const g0 = document.createElement('canvas').getContext('2d');
    const items = list.map((s) => {
      const text = typeof s.text === 'string' ? s.text : tr(s.text);
      let size = 84; g0.font = font(size);
      if ('letterSpacing' in g0) g0.letterSpacing = '2px';
      let tw = g0.measureText(text).width;
      const maxPx = (s.maxW - 0.2) * PX;
      while (tw > maxPx && size > 40) { size -= 4; g0.font = font(size); tw = g0.measureText(text).width; }
      const w = Math.min(s.maxW, Math.max(0.9, tw / PX + 0.34));
      return { s, text, size, w };
    });
    // the texture: the density for signs seen from afar (signs.js), in an atlas as wide as the widest sign needs
    const D = Math.min(SIGN_DENSITY.high, 8192 / Math.max(...items.map((it) => it.w))), k = D / PX, CH = Math.round(0.3 * D);
    const W = Math.min(8192, Math.max(2048, ...items.map((it) => Math.ceil(it.w * D))));
    let x = 0, y = 0;
    for (const it of items) { it.cw = Math.ceil(it.w * D); if (x + it.cw > W) { x = 0; y += CH; } it.cell = [x, y]; x += it.cw; }
    const H = y + CH;
    const cells = items.map((it) => [it.text, it.size, it.s.kind === 'recent' ? '#8a4b37' : it.s.kind === 'read' ? READ_SIGN : '#1f5b58', it.cell[0], it.cell[1], it.cw]);
    const sign = signs.get(`signs|${W}x${H}|${JSON.stringify(cells)}`, { kind: 'signs', w: W, h: H, metres: [W / D, H / D], bg: '#1f5b58', draw: (g) => {
      g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const [text, size, colour, cx, cy, cw] of cells) {
        const lw = cw / k;                                                       // the cell in layout units
        g.setTransform(k, 0, 0, k, cx, cy);
        g.fillStyle = colour; g.fillRect(0, 0, lw, CH0);
        g.strokeStyle = 'rgba(247, 238, 220, 0.55)'; g.lineWidth = 3; g.strokeRect(9, 9, lw - 18, CH0 - 18);
        g.fillStyle = '#f8f3ea'; g.font = font(size);
        if ('letterSpacing' in g) g.letterSpacing = '2px';
        g.fillText(text, lw / 2, CH0 / 2 + 4);
      }
      if ('letterSpacing' in g) g.letterSpacing = '0px';
    } });
    // a touch of self-light, like the pictures: the plates hang above the reach of the shelf lights
    const mat = signs.use(sign, new THREE.MeshStandardMaterial({ roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.1 }), ['map', 'emissiveMap']);
    mat.userData.disposable = true;
    const plates = new Parts(), frames = new Parts();
    const oak = M.wood('oak');
    for (const it of items) {
      const { s } = it; const [cx, cy] = it.cell;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y, s.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rot), new THREE.Vector3(1, 1, 1));
      const geo = new THREE.PlaneGeometry(it.w, s.h), uv = geo.attributes.uv;
      for (let n = 0; n < uv.count; n++) uv.setXY(n, (cx + uv.getX(n) * it.cw) / W, 1 - (cy + (1 - uv.getY(n)) * CH) / H);
      plates.addMatrix(geo, mat, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.031))); geo.dispose();
      frames.addMatrix(boxGeo(it.w + 0.06, s.h + 0.06, 0.03), oak, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.015)));
    }
    const gp = plates.build({ name: 'department-signs', castShadow: false });
    const gf = frames.build({ name: 'department-sign-frames', castShadow: false });
    parent.add(gp, gf);
  }

  /** The directory in the passage: the departments in reading order with the wall they stand on, and a small plan of
   *  the room with their numbers. Laid out 1280 units wide (the pixels of the 0.5 board) and drawn at the close-up
   *  density of signs.js: you can walk up to it. */
  #buildDirectory(parent) {
    const dir = this.layout.directory; if (!dir) return;
    const W0 = 1280, H0 = Math.round(W0 * dir.h / dir.w), W = Math.round(dir.w * SIGN_DENSITY.close), k = W / W0, H = Math.round(H0 * k);
    const wallName = { left: { de: 'links', en: 'left' }, back: { de: 'hinten', en: 'back' }, right: { de: 'rechts', en: 'right' }, front: { de: 'vorn', en: 'front' } };
    const rc = this.layout.bookcases.find((b) => b.recent);
    // everything the drawing needs, with the texts in the current language (it is drawn on a later frame)
    const spec = {
      title: tr({ de: 'Bücherzimmer', en: 'Book room' }), deps: tr({ de: 'Abteilungen', en: 'Departments' }),
      entries: dir.entries.map((e) => [String(e.n), tr(e.name), e.walls.map((w) => tr(wallName[w])).join(' · ')]),
      recent: [tr({ de: 'Zuletzt gelesen', en: 'Recently read' }), tr({ de: 'am Eingang', en: 'by the entrance' })],
      hint: this.layout.emptyLibrary ? tr(ADD_BOOKS_HINT) : dir.all ? tr({ de: 'Tab: zu einer Abteilung gehen', en: 'Tab: walk to a department' }) : tr({ de: 'Tab: Abteilung wählen', en: 'Tab: choose a department' }),
      entrance: tr({ de: 'Eingang', en: 'Entrance' }),
      runs: (this.layout.departmentRuns || []).map((r) => r.parts.map((pt) => { const a = pt.slots[0], b = pt.slots[pt.slots.length - 1]; return [a.x, a.z, a.rot, b.x, b.z]; })),
      // the runs' numbers in the list (one department in the room keeps its number there)
      nums: (this.layout.departmentRuns || []).map((r, i) => dir.entries.find((e) => e.id === r.id)?.n ?? i + 1),
      recentAt: rc ? [rc.x, rc.z] : null,
    };
    const rd = this.layout.bookcases.find((b) => b.read);   // the case "Gelesen" on the other side of the passage
    if (rd) { spec.read = [tr({ de: 'Gelesen', en: 'Read' }), tr({ de: 'am Eingang', en: 'by the entrance' })]; spec.readAt = [rd.x, rd.z]; }
    const sign = signs.get(`directory|${W}x${H}|${JSON.stringify(spec)}`, { kind: 'directory', w: W, h: H, metres: [dir.w, dir.h], bg: '#f7f3ea', draw: (g) => { g.scale(k, k); drawDirectory(g, W0, H0, spec); } });
    const mat = signs.use(sign, new THREE.MeshStandardMaterial({ roughness: 0.75, emissive: 0xffffff, emissiveIntensity: 0.08 }), ['map', 'emissiveMap']); mat.userData.disposable = true;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dir.rot);
    const nx = Math.sin(dir.rot), nz = Math.cos(dir.rot);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(dir.w, dir.h), mat);
    board.position.set(dir.x + nx * 0.032, dir.y, dir.z + nz * 0.032); board.quaternion.copy(q);
    const frame = new THREE.Mesh(boxGeo(dir.w + 0.07, dir.h + 0.07, 0.03), M.wood('oak'));
    frame.position.set(dir.x + nx * 0.015, dir.y, dir.z + nz * 0.015); frame.quaternion.copy(q);
    board.name = 'directory'; frame.name = 'directory-frame';
    parent.add(board, frame);
  }

  /** The fire bowl in the garden (firebowl.js): position, isBurning(), level, toggle(); null before the garden exists. */
  get fireBowl() { return this.env?.garden?.fireBowl || null; }

  // ------------------------------------------------------------------ settings ----
  applySettings(s) {
    this.settings = s || this.settings;
    const g = this.settings.graphics || {};
    // 'mobile' draws as 'low' does (the same programs, lamps and passes) with the savings of #applyMobile on top
    this.mobile = g.quality === 'mobile';
    this.quality = this.mobile ? 'low' : g.quality || 'high';
    this.#applyMobile();
    this.player.sensitivity = g.mouseSensitivity || 1; this.player.fov = g.fov || 72;
    // 0 = the display's rate; phones start at 30 (api-web.js freshProfileOverrides)
    this.frameCap = Math.max(0, +g.frameCap || 0);

    const wantShadows = g.shadows !== false && this.quality !== 'low';
    if (this.renderer.shadowMap.enabled !== wantShadows) {
      this.renderer.shadowMap.enabled = wantShadows;
      // Three.js bakes shadow sampling into the compiled program. Without this recompile the
      // scene stays fully shadowed – i.e. pitch black – after switching shadows off.
      this.scene.traverse((o) => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) if (m) m.needsUpdate = true; } });
    }
    this.bloom.enabled = g.bloom !== false && this.quality !== 'low';
    this.ao.enabled = this.quality === 'high' && g.ssao !== false && (!this.softwareGL || this.forceAO);
    this.godrays.apply(this.quality, g.godrays);   // Lichtstrahlen: half resolution on 'high', a quarter on 'medium', off on 'low'
    const samples = this.quality === 'low' ? 0 : this.quality === 'medium' ? 2 : 4;
    if (samples !== this.msaa) {
      this.msaa = samples;
      const t = this.composer.renderTarget1;   // (the scene's buffer; the second one is never multisampled, #setupPost)
      t.samples = samples; t.dispose();
    }
    const brightness = clamp(this.settings.light?.brightness ?? 1, 0.4, 1.6);
    if (this.env) {
      const size = this.quality === 'high' ? 2048 : this.quality === 'medium' ? 1536 : 1024;
      if (this.env.sun.shadow.mapSize.x !== size) {
        this.env.sun.shadow.mapSize.set(size, size);
        if (this.env.sun.shadow.map) { this.env.sun.shadow.map.dispose(); this.env.sun.shadow.map = null; }
      }
      this.env.sun.shadow.needsUpdate = true;
      this.env.sun.castShadow = wantShadows;
      this.env.garden.setSeason?.(this.settings.season);   // (before env.set: the season's snow and light go with it)
      this.env.set({ brightness, warmth: this.settings.light?.warmth ?? 0.65, shadows: wantShadows, golden: this.settings.timeMode === 'golden' });
      this.sky.applySettings(); this.sky.push();   // the weather and the clock of the settings (sky-state.js)
      this.env.setQuality(this.quality, { mobile: this.mobile });
    }
    if (this.fire) { this.fire.light.castShadow = wantShadows && this.quality === 'high'; this.fire.light.shadow.needsUpdate = true; }
    // another quality means another set of real lamp lights: rebuild once (build() calls applySettings again,
    // with the tier already matching)
    // ('mobile' and back: other batches, lights and programs, built and compiled again as well)
    if (this.library && this.lampTier != null && (lampTierFor(this.quality) !== this.lampTier || (this.builtMobile !== undefined && this.builtMobile !== this.mobile))) { this.#rebuildInPlace(); return; }
    // the audiobook cabinet always stands: its boxes come with the first audiobook folder and go with the last one
    this.audiobooks.applySettings(this.settings);
    // A narrow exposure window: the picture must never wash out just because the view turned.
    this.baseExposure = 0.78 + brightness * 0.16;
    // only a hint of warmth over the whole picture: at 0.6 it tinted every wall and book brown (the output pass)
    this.vignette.uniforms.uWarm.value = (this.settings.light?.warmth ?? 0.65) * 0.2;
    if (this.cat) this.cat.setEnabled(this.settings.cat !== false);   // hidden: no purring, not targetable
    this.wildlife?.setEnabled(this.settings.wildlife !== false);
    this.fauna?.setEnabled(this.settings.fauna !== false);
    this.resize();
    this.actions.applySettings(this.settings);
    this.walls.apply(this.settings.walls);
    this.lampSwitch.apply(this.settings.lampsOff);   // the lamps switched off by hand (lamp-switch.js)
    this.floors.apply(this.settings.floor);          // the floor of the rooms (floors.js)
  }
  /** The anisotropic filtering of 'mobile' (MOBILE_ANISO samples at most; the other qualities the card's maximum).
   *  three takes the limit from capabilities.getMaxAnisotropy() when it uploads a texture, so the limit goes there;
   *  the textures already on the card get it on their sampler (three sets the parameter only at an upload). A texture
   *  made while 'mobile' was on keeps the 4 it asked for until the next start (walls, signs and the world map ask
   *  the capabilities). */
  #applyMobile() {
    const caps = this.renderer.capabilities;
    this.maxAnisotropy ??= caps.getMaxAnisotropy();
    const cap = this.mobile ? Math.min(MOBILE_ANISO, this.maxAnisotropy) : this.maxAnisotropy;
    if (this.anisotropyCap === cap) return;
    this.anisotropyCap = cap;
    caps.getMaxAnisotropy = () => cap;
    const gl = this.renderer.getContext(), ext = gl.getExtension('EXT_texture_filter_anisotropic');
    if (!ext) return;
    const props = this.renderer.properties, state = this.renderer.state, seen = new Set();
    this.scene.traverse((o) => {
      for (const m of (o.material ? [o.material].flat() : [])) {
        if (!m) continue;
        for (const k in m) {
          const t = m[k];
          if (!t?.isTexture || seen.has(t) || !(t.anisotropy > 1) || t.isCubeTexture || t.isData3DTexture || t.isDataArrayTexture) continue;
          seen.add(t);
          // (only where three sets the parameter at an upload: mipmapped, not nearest; WebGLTextures)
          if (t.magFilter === THREE.NearestFilter || (t.minFilter !== THREE.NearestMipmapLinearFilter && t.minFilter !== THREE.LinearMipmapLinearFilter) || t.type === THREE.FloatType) continue;
          const p = props.get(t);
          if (!p?.__webglTexture || p.__currentAnisotropy === undefined) continue;
          state.bindTexture(gl.TEXTURE_2D, p.__webglTexture);
          gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(t.anisotropy, cap));
        }
      }
    });
    state.unbindTexture();
  }
  /** The wall clock by the fire shows the real local time, whatever hour the world shows (fixed, day cycle): the
   *  hour hand moves on with the minutes, the minute hand with the seconds, the second hand ticks once a second. */
  #setClock(d) {
    const hands = this.wallClock.userData.hands, TAU = Math.PI * 2;
    const s = d.getSeconds(), m = d.getMinutes() + s / 60, h = (d.getHours() % 12) + m / 60;
    hands.hour.rotation.z = -h / 12 * TAU; hands.min.rotation.z = -m / 60 * TAU;
    if (hands.sec) hands.sec.rotation.z = -s / 60 * TAU;
  }
  /** The hour the world shows (sky-state.js: the real time, the cycles, a fixed hour, the golden hour's). */
  currentHour() { this.sky.tick(0); return this.sky.hour; }
  /** The weather now, for any code: { name (clear, overcast, rain, storm, snow, fog), base, fog, wind, thunder, rain, snow,
   *  cloud, … } with the parts 0 … 1 (sky-state.js); world.sky.onChange(fn) tells when it changes. */
  weatherState() { return this.sky.state(); }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this.#clearStatic();
    this.books.clear();
    this.#disposeRetired();
    this.cinema?.dispose();
    this.walls.dispose();
    this.floors.dispose();
    this.wildlife?.dispose();
    this.fauna?.dispose();
    this.composer?.dispose?.();
    this.renderer.dispose();
  }

  // ------------------------------------------------------------------ loop ----
  start() {
    if (this.running) return;
    this.running = true; this.clock.start();
    let last = 0;
    const loop = (t) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      // behind an open panel the world is blurred: 15 frames a second are plenty there, and behind the
      // full-screen reader none at all (the panels scroll and animate more smoothly without the 3D load)
      if (this.background === 'paused') return;
      if (this.background === 'dim' && t - last < 1000 / 15) return;
      // a frame cap (settings graphics.frameCap, phones: 30): a frame is skipped while the last one is younger than
      // the interval, less a slice so that a 60 Hz display at a cap of 30 draws every second frame and never a third
      if (!this.background && this.frameCap > 0 && t - last < 1000 / this.frameCap - 4) return;
      const timed = !this.background && last;
      if (timed) this.noteFrameTime(t - last);
      last = t;
      const a = timed ? performance.now() : 0;
      this.frame();
      if (timed) this.noteFrameWork(performance.now() - a);
    };
    requestAnimationFrame(loop);
  }
  /** The time between two drawn frames of the open world, kept for the last 120 frames (main.js lowers the resolution
   *  on a phone when the median stays slow). */
  noteFrameTime(ms) {
    const r = this.frameTimes || (this.frameTimes = { buf: new Float32Array(120), work: new Float32Array(120), n: 0, i: 0 });
    r.buf[r.i] = ms; r.i = (r.i + 1) % r.buf.length; if (r.n < r.buf.length) r.n++;
  }
  /** The main thread's time for that frame (World#frame): when it fills the interval, fewer pixels do not help. */
  noteFrameWork(ms) {
    const r = this.frameTimes;
    if (r) r.work[(r.i + r.buf.length - 1) % r.buf.length] = ms;
  }
  /** The median frame time (ms) of the last frames, the median time of World#frame in them (work), and how many were
   *  measured; null before the first. */
  frameStats() {
    const r = this.frameTimes;
    if (!r || !r.n) return null;
    const med = (a) => { const s = Array.from(a.subarray(0, r.n)).sort((x, y) => x - y); return s[s.length >> 1]; };
    return { median: med(r.buf), work: med(r.work), n: r.n, cap: this.frameCap || 0 };
  }
  /** Forgets the measured frames (after a change of the resolution). */
  resetFrameStats() { this.frameTimes = null; }
  /** null (normal), 'dim' (a panel lies over the world) or 'paused' (a full-screen panel hides it). */
  setBackground(mode) { this.background = mode || null; if (!mode) this.clock.getDelta(); }
  stop() { this.running = false; }
  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.time += dt;
    this.updateDoor(dt);
    this.player.update(dt);
    if (this.env) {
      // the clock and the weather every frame: the sun moves on smoothly, a changing weather blends (sky-state.js)
      this.sky.frame(dt);
      this.env.update(dt, this.camera);
      this.reflections?.frame(dt);
    }
    // ('mobile': out of view behind the walls the animals live on without being posed, mobile.js)
    const posed = this.mobileTier.posed;
    this.wildlife?.update(dt, posed);
    this.fauna?.update(dt, posed);
    this.winter?.update(dt);
    const b = clamp(this.settings.light?.brightness ?? 1, 0.4, 1.6);
    const warmth = this.settings.light?.warmth ?? 0.65;
    const lampColor = this.lampColor.lerpColors(LAMP_NEUTRAL, LAMP_WARM, warmth);
    const hallDim = this.cinema.hallDim;
    // in the golden hour the hall's lamps stay on, but quieter: the low sun sets the scene
    const goldDim = 1 - 0.6 * (this.env?.golden || 0);
    for (const l of this.lamps) {
      const fl = l.flicker ? 1 + (Math.sin(this.time * 11 + l.phase) * 0.5 + Math.sin(this.time * 27.1 + l.phase) * 0.5) * l.flicker : 1;
      l.light.intensity = l.base * b * fl * (l.hall ? (1 - hallDim) * goldDim : 1);
      l.light.color.copy(lampColor);
    }
    // light on walls, shades and diffusers: the lamp colour seen through warm linen
    const glowColor = this.glowColor.copy(lampColor).multiply(LINEN);
    for (const g of this.glows) { g.mat.opacity = Math.min(1, g.base * b * (g.hall ? (1 - hallDim) * goldDim : 1)); g.mat.color.copy(glowColor).multiplyScalar(g.gain); }
    for (const [m, e] of this.lampMats) { m.emissive.copy(glowColor); m.emissiveIntensity = e.base * b * (e.hall ? (1 - hallDim * 0.85) * goldDim : 1); }
    // lamps switched off by hand: their lights and decals fade with them, the shades in their shader (lamp-switch.js)
    this.lampSwitch.update(dt);
    // the shelf strips: a warm white that follows the warmth setting a little, never switched off
    SHELF_GLOW.value.lerpColors(LAMP_NEUTRAL, lampColor, 0.5).multiplyScalar(b);
    if (this.fire) this.fire.near = this.camera.position.z > HALL.z0 - 1 && this.camera.position.distanceTo(this.fire.group.position) < 12;
    for (const fl of this.flames) { const s = 1 + Math.sin(this.time * 13) * 0.1; if (fl.children?.length) fl.children.forEach((c, i) => c.scale.set(1, 1.6 + Math.sin(this.time * 9 + i) * 0.25, 1)); else fl.scale.y = 1.7 * s; }
    this.books.update(dt, this.camera);
    this.audiobooks.update(dt);
    this.#trackDepartment(dt);
    if (this.cat && this.cat.group.visible) this.cat.update(dt, this.player.position, !!this.player.seated);
    // the cat up on a seat is in the way of a player who walks on the seats (player.js)
    const cp = this.cat?.group.visible && this.cat.group.position.y > 0.25 ? this.cat.group.position : null;
    this.player.catBlock = cp ? Object.assign(this._catBlock ||= { r: 0.22 }, { x: cp.x, z: cp.z }) : null;
    if (this.recordPlayer && this.actions.musicPlaying) { this.recordPlayer.userData.disc.rotation.y -= dt * 3.5; this.recordPlayer.userData.label.rotation.y -= dt * 3.5; }
    if (this.wallClock) this.#setClock(new Date());
    // the warm-up: a few textures per frame onto the GPU; a sign drawn or uploaded (one a frame, signs.js)
    for (let i = 0; i < 6 && this.pendingUploads?.length; i++) this.renderer.initTexture(this.pendingUploads.pop());
    this.walls.update();   // a freshly painted mural: one wall per frame
    this.floors.update();  // a new floor: one texture per frame onto the graphics card, then the swap (floors.js)
    signs.pump();
    // a picture glows with its own image (furniture.js paintingFrame): follow the image when it is swapped
    for (const p of this.paintings) { const m = p.obj.userData.canvas?.material; if (m && m.emissiveMap !== m.map) { m.emissiveMap = m.map; m.needsUpdate = true; } }
    // like the eye: a little less exposure in daylight, most of all in the hall with its glass front
    const inHall = clamp((this.camera.position.z - HALL.z0 + 3) / 4, 0, 1);
    // dusk counts for little: by then the lamps set the scene (a linear curve dimmed the lit rooms all evening)
    // (and outside at night the eye opens up: environment.js nightEye)
    const adapt = (1 - Math.pow(this.env?.daylight ?? 0, 1.6) * (0.18 + 0.2 * inHall)) * (this.env?.nightEye?.(this.camera.position) ?? 1);
    this.exposureNow = lerp(this.exposureNow ?? adapt, adapt, Math.min(1, dt * 1.5));
    this.renderer.toneMappingExposure = (this.baseExposure ?? 0.94) * this.exposureNow;
    this.cinema.update(dt);
    this.actions.update(dt);
    // a little more bloom in the golden hour; the trees' shadow map, the rays and the motes (godrays.js)
    this.bloom.strength = 0.16 * (1 + 0.6 * (this.env?.golden || 0));
    this.godrays.beforeRender(dt);
    this.mobileTier.beforeRender(dt);
    try { if (this.#composed()) this.#renderComposed(dt); else this.renderer.render(this.scene, this.camera); }
    finally { this.mobileTier.afterRender(); }
  }
  /** A small still of the world as it stands (main.js: the background of a panel that pauses the world). The scene is
   *  drawn once more and copied at once, before the canvas lets go of the picture (no preserveDrawingBuffer). */
  still(width = 200) {
    const c = this.renderer.domElement;
    if (!c.width || !c.height) return null;
    if (this.#composed()) this.#renderComposed(0); else this.renderer.render(this.scene, this.camera);
    const out = document.createElement('canvas');
    out.width = width; out.height = Math.max(1, Math.round(width * c.height / c.width));
    out.getContext('2d').drawImage(c, 0, 0, out.width, out.height);
    return out;
  }
  /** Drawn through the composer (bloom, AO or the god rays), or straight onto the canvas. */
  #composed() { return this.bloom.enabled || this.ao.enabled || this.godrays.wanted; }
}

export { HALL, PASSAGE, ROOM, ROOM_H };
