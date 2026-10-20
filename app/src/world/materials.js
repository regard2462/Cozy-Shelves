// Material factory (cached) built on the procedural textures.
import * as THREE from 'three';
import './light-loop.js';   // (first: the lamps' loop in three's lighting chunk, before anything copies it)
import { woodTexture, parquetTexture, paintTexture, plasterTexture, brickTexture, fabricTexture, leatherTexture, rugTexture, marbleTexture, paperTexture, wallpaperTexture, cofferTexture } from './textures.js';
import { withLampSwitch } from './lamp-switch.js';
import { floorMaterial } from './floors.js';

const cache = new Map();
function memo(key, fn) { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); }

/** Emissive profile of a lit fabric shade. CylinderGeometry: v = 0 at the lower rim … 1 at the upper one. The light
 *  spills out below (bright band), a little above, and shines softly through the fabric in between. */
let shadeTex = null;
export function shadeGlowTexture() {
  if (shadeTex) return shadeTex;
  const H = 128, c = document.createElement('canvas'); c.width = 4; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(4, H);
  for (let y = 0; y < H; y++) {
    const v = 1 - (y + 0.5) / H;   // canvas row 0 is the top of the texture (v = 1)
    const e = Math.min(1, 0.58 + 0.42 * Math.exp(-v / 0.09) + 0.2 * Math.exp(-(1 - v) / 0.06));
    const b = Math.round(e * 255);
    for (let x = 0; x < 4; x++) img.data.set([b, b, b, 255], (y * 4 + x) * 4);
  }
  g.putImageData(img, 0, 0);
  shadeTex = new THREE.CanvasTexture(c);
  shadeTex.colorSpace = THREE.NoColorSpace;
  return shadeTex;
}

/** The point lights on the glass: three's lighting chunk with their highlight widened (roughness at least `rough`) and
 *  turned down to `glint` (only theirs: the sun's stays as it is). (rough 0 and glint 1 give the old glass: the checks) */
export const GLASS_LAMPS = {
  glint: { value: 0.35 },
  rough: { value: 0.24 },
  // the room mirrored in the glass (glass-reflect.js): a cube of each room seen from its middle, box-projected onto the
  // room's walls; `refl` 0 by day (the bright garden outshines it), up to 1 at night
  room: {
    uRoomA: { value: null }, uRoomB: { value: null }, uRoomRefl: { value: 0 }, uRoomSplitZ: { value: -6 },
    uBoxAMin: { value: new THREE.Vector3() }, uBoxAMax: { value: new THREE.Vector3() }, uBoxACentre: { value: new THREE.Vector3() },
    uBoxBMin: { value: new THREE.Vector3() }, uBoxBMax: { value: new THREE.Vector3() }, uBoxBCentre: { value: new THREE.Vector3() },
  },
  pars: 'uniform samplerCube uRoomA; uniform samplerCube uRoomB; uniform float uRoomRefl; uniform float uRoomSplitZ; uniform vec3 uBoxAMin; uniform vec3 uBoxAMax; uniform vec3 uBoxACentre; uniform vec3 uBoxBMin; uniform vec3 uBoxBMax; uniform vec3 uBoxBCentre;',
  mirror: `
  if (uRoomRefl > 0.001) {
    // the room behind the eye, faintly: where the mirrored ray meets the room's walls, as the room's cube saw it there
    mat3 iv = transpose(mat3(viewMatrix));
    vec3 wp = cameraPosition + iv * (-vViewPosition), vd = normalize(wp - cameraPosition), nG = normalize(iv * normal);
    bool inB = wp.z < uRoomSplitZ;
    vec3 bmin = inB ? uBoxBMin : uBoxAMin, bmax = inB ? uBoxBMax : uBoxAMax, cen = inB ? uBoxBCentre : uBoxACentre;
    if (all(greaterThan(cameraPosition, bmin - 0.3)) && all(lessThan(cameraPosition, bmax + 0.3))) {
      if (dot(nG, vd) > 0.0) nG = -nG;
      vec3 R = reflect(vd, nG);
      R += sign(R) * 1e-4 + vec3(equal(R, vec3(0.0))) * 1e-4;
      vec3 tf = max((bmax - wp) / R, (bmin - wp) / R);
      vec3 dir = wp + R * max(min(min(tf.x, tf.y), tf.z), 0.0) - cen;
      // (a little soft, and the lamps in it no brighter than a lit wall: a faint picture, no glare)
      vec3 room = min(inB ? textureLod(uRoomB, dir, 1.3).rgb : textureLod(uRoomA, dir, 1.3).rgb, vec3(0.9));
      float F = 0.04 + 0.96 * pow(1.0 - max(dot(-vd, nG), 0.0), 5.0);
      outgoingLight += room * F * uRoomRefl / max(diffuseColor.a, 0.05);
    }
  }`,
  chunk: (() => {
    const src = THREE.ShaderChunk.lights_fragment_begin;
    const a = src.indexOf('#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )'), b = src.indexOf('#if ( NUM_SPOT_LIGHTS > 0 )');
    if (a < 0 || b < a) return src;
    return src.slice(0, a) + 'vec3 glassSpec = reflectedLight.directSpecular; float glassRough = material.roughness; material.roughness = max(material.roughness, uLampRough);\n'
      + src.slice(a, b) + 'reflectedLight.directSpecular = glassSpec + (reflectedLight.directSpecular - glassSpec) * uLampGlint; material.roughness = glassRough;\n' + src.slice(b);
  })(),
};

export const M = {
  wood(tone = 'walnut', opts = {}) {
    return memo(`wood:${tone}:${JSON.stringify(opts)}`, () => {
      // a calm grain by default (like the floor): full contrast read as busy, wavy and old on large fronts
      const t = woodTexture({ tone, seed: opts.seed || 1, repeat: opts.repeat || [1, 1], planks: opts.planks || 1, along: opts.along || 'x', grainScale: opts.grainScale || 1, contrast: opts.contrast ?? 0.6 });
      for (const tex of [t.map, t.normalMap, t.roughnessMap]) if (tex) tex.anisotropy = 16;
      // a gentle normal – a strong one turns into moiré at grazing angles
      return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.28, 0.28), roughnessMap: t.roughnessMap, roughness: 0.62, metalness: 0.02, color: opts.tint || 0xffffff });
    });
  },
  /** The floor of the rooms: ONE material for every floor surface of the house, whose look follows the setting
   *  `floor` (floors.js: wide oiled oak boards by default, parquet, stone, tiles, terrazzo, carpet). It maps itself in
   *  world space (x, z), so any horizontal mesh can use it without uvs of its own. */
  floor() { return floorMaterial(); },
  parquet(tone = 'oak') {
    return memo(`parquet:${tone}`, () => {
      const t = parquetTexture({ tone, repeat: [1, 1] });
      for (const tex of [t.map, t.normalMap, t.roughnessMap]) if (tex) tex.anisotropy = 16;
      return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.35, 0.35), roughnessMap: t.roughnessMap, roughness: 0.5, metalness: 0.05 });
    });
  },
  /** Painted wood (panelling, window bench): matt eggshell. */
  paint(color = '#a9b49e') {
    return memo(`paint:${color}`, () => {
      const t = paintTexture({ color });
      return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.25, 0.25), roughness: 0.72, metalness: 0 });
    });
  },
  wall(color = '#e2d3b8') {
    return memo(`wall:${color}`, () => {
      const t = plasterTexture({ color, repeat: [1, 1], strength: 0.55 });
      for (const tex of [t.map, t.normalMap, t.roughnessMap]) if (tex) tex.anisotropy = 16;
      return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.22, 0.22), roughnessMap: t.roughnessMap, roughness: 0.92 });
    });
  },
  wallpaper(color = '#e3d5b8') {
    return memo(`wallpaper:${color}`, () => {
      const t = wallpaperTexture({ color });
      for (const tex of [t.map, t.normalMap, t.roughnessMap]) if (tex) tex.anisotropy = 16;
      return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.18, 0.18), roughnessMap: t.roughnessMap, roughness: 0.9 });
    });
  },
  coffered() {
    return memo('coffered', () => {
      const t = cofferTexture({ color: '#f1ede5' });
      for (const tex of [t.map, t.normalMap]) tex.anisotropy = 16;
      return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.93 });
    });
  },
  ceiling() { return memo('ceiling', () => { const t = plasterTexture({ color: '#d9cdb5', repeat: [1, 1], strength: 0.6 }); t.map.anisotropy = 16; return new THREE.MeshStandardMaterial({ map: t.map, roughness: 0.95 }); }); },
  brick(tone = 'red') { return memo(`brick:${tone}`, () => { const t = brickTexture({ tone, repeat: [1.5, 1.5] }); return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughnessMap: t.roughnessMap, roughness: 0.9 }); }); },
  fabric(color = '#7a3b2e', seed = 6) { return memo(`fabric:${color}:${seed}`, () => { const t = fabricTexture({ color, seed, repeat: [3, 3] }); return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.95, metalness: 0 }); }); },
  leather(color = '#5a2f1f') { return memo(`leather:${color}`, () => { const t = leatherTexture({ color, repeat: [2, 2] }); return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.45, 0.45), roughnessMap: t.roughnessMap, roughness: 0.78, metalness: 0 }); }); },   // matt: glossy leather read as plastic
  rug(seed = 10, palette, style, ratio = 0.66) {
    const r = Math.max(0.12, Math.min(1.6, ratio || 0.66));
    return memo(`rug:${seed}:${palette ? palette.join() : ''}:${style}:${r.toFixed(2)}`, () => {
      const t = rugTexture({ seed, palette, style, ratio: r });
      return new THREE.MeshStandardMaterial({ map: t.map, roughness: 1, metalness: 0 });
    });
  },
  marble(base, vein) { return memo(`marble:${base}:${vein}`, () => { const t = marbleTexture({ base, vein }); return new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.roughnessMap, roughness: 0.3, metalness: 0.05 }); }); },
  paper() { return memo('paper', () => { const t = paperTexture(); return new THREE.MeshStandardMaterial({ map: t.map, roughness: 0.9 }); }); },
  brass() { return memo('brass', () => new THREE.MeshStandardMaterial({ color: 0xb8903f, metalness: 0.9, roughness: 0.35 })); },
  iron() { return memo('iron', () => new THREE.MeshStandardMaterial({ color: 0x2a2724, metalness: 0.7, roughness: 0.55 })); },
  darkMetal() { return memo('darkmetal', () => new THREE.MeshStandardMaterial({ color: 0x3a3532, metalness: 0.6, roughness: 0.5 })); },
  // Glass reflects, it hardly scatters: a light diffuse colour here turned every window into a grey veil once
  // the lamps lit it (fog outside at night, haze at noon). A dark tint keeps only the reflections.
  // The lamps of the rooms show in it only as faint, soft reflections (GLASS_LAMPS): their sharp highlights glared out of
  // every window at night as bright spots. The sun keeps its sharp glint.
  glass() {
    return memo('glass', () => {
      const m = new THREE.MeshPhysicalMaterial({ color: 0x151a1d, transparent: true, opacity: 0.1, roughness: 0.06, metalness: 0, transmission: 0, reflectivity: 0.7, side: THREE.DoubleSide, depthWrite: false });
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uLampGlint = GLASS_LAMPS.glint; shader.uniforms.uLampRough = GLASS_LAMPS.rough;
        Object.assign(shader.uniforms, GLASS_LAMPS.room);
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uLampGlint; uniform float uLampRough;\n' + GLASS_LAMPS.pars).replace('#include <lights_fragment_begin>', GLASS_LAMPS.chunk)
          .replace('#include <opaque_fragment>', GLASS_LAMPS.mirror + '\n#include <opaque_fragment>');
      };
      m.customProgramCacheKey = () => 'glass-lamps';
      m.userData.lamps = GLASS_LAMPS;   // (the checks)
      return m;
    });
  },
  // A lit linen shade: it glows warm through the fabric, brightest at its lower rim where the light spills out
  // (shadeGlowTexture). world.js sets its colour and strength every frame from the lamp colour and the brightness
  // setting (userData.lampGlow = strength): a shade at 0.34 read as a switched-off white drum.
  lampShade(color = 0xf3d9a4, glow = 1) {
    return memo(`shade:${color}:${glow}`, () => {
      const m = new THREE.MeshStandardMaterial({ color: 0xe9e0d0, emissive: new THREE.Color(color), emissiveMap: shadeGlowTexture(), emissiveIntensity: glow, roughness: 0.92, side: THREE.DoubleSide });
      m.userData.lampGlow = glow;
      return withLampSwitch(m);   // each lamp's glow follows its own switch (lamp-switch.js)
    });
  },
  /** The bright part of a lamp: diffuser discs, bulbs, the inside of a shade (also driven by world.js). */
  lampLight(color = 0xffdcab, glow = 1.2) {
    return memo(`lamplight:${color}:${glow}`, () => {
      const m = new THREE.MeshStandardMaterial({ color: 0xfff3df, emissive: new THREE.Color(color), emissiveIntensity: glow, roughness: 0.8, side: THREE.DoubleSide });
      m.userData.lampGlow = glow;
      return withLampSwitch(m);
    });
  },
  /** Powder-coated black steel (lamps, the glass front of the hall). */
  blackMetal() { return memo('blackmetal', () => new THREE.MeshStandardMaterial({ color: 0x262626, metalness: 0.55, roughness: 0.42 })); },
  /** Glazed ceramic (lamp bases, vases). */
  ceramic(color = 0xe9e4da) { return memo(`ceramic:${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0 })); },
  plain(color, opts = {}) { return memo(`plain:${color}:${JSON.stringify(opts)}`, () => new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.8, metalness: opts.metalness ?? 0, emissive: opts.emissive || 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 1, side: opts.side || THREE.FrontSide, transparent: !!opts.transparent, opacity: opts.opacity ?? 1 })); },
  leaf(color = 0x3f6b32) { return memo(`leaf:${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.7, side: THREE.DoubleSide })); },
};

export function disposeMaterials() { for (const m of cache.values()) m.dispose(); cache.clear(); }
