// Lamps you switch on and off one by one: E or a click on the lamp (world-actions.js), remembered in settings.lampsOff.
// Every lamp made by a lamp builder of furniture.js (userData.lamp) is registered by world.js when it is placed, with an
// id from its place in the layout (lampIdOf): it keeps its state through a rebuild of the world and a restart. A module
// that builds and places a lamp itself registers it the same way: world.lampSwitch.register(obj, id, world).
//
// A switch never adds, removes or hides a light (three.js compiles the number of lights into every shader). The lamp's
// light, its decals (the pools and fans of light) and the glow of its shade follow the lamp's level, 0 … 1, which fades
// within a fifth of a second. Shades and diffusers share their materials and are batched with the other lamps of their
// room (world.js #batchStatic): each of their meshes carries the number of its lamp in the vertex attribute `lampIndex`,
// and their shader reads the lamp's level from a small texture, one texel per lamp. So a switch costs no draw call and
// no shader program, only a texel.
import * as THREE from 'three';

const MAX_LAMPS = 256;          // texel 0 belongs to no lamp and stays at full level
const FADE = 0.18;              // seconds from on to off and back
/** Lamps answer the look ray from further away than the 3.2 m of other things: a pendant hangs high above you. */
export const LAMP_REACH = 4.5;

const levels = new Uint8Array(MAX_LAMPS * 4).fill(255);
const levelTexture = new THREE.DataTexture(levels, MAX_LAMPS, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
levelTexture.minFilter = levelTexture.magFilter = THREE.NearestFilter;
levelTexture.generateMipmaps = false;
levelTexture.needsUpdate = true;
const levelUniform = { value: levelTexture };

/** The shader of a lamp's glowing parts: their emission times the level of their lamp. */
function lampSwitchShader(shader) {
  shader.uniforms.uLampLevels = levelUniform;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float lampIndex;\nuniform sampler2D uLampLevels;\nvarying float vLampLevel;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvLampLevel = texelFetch( uLampLevels, ivec2( int( lampIndex + 0.5 ), 0 ), 0 ).r;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vLampLevel;')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vLampLevel;');
}
function lampSwitchKey() { return 'lamp-switch-1'; }

/** Makes a lamp material switchable (materials.js lampShade and lampLight; world.js copies them for the hall). Every
 *  mesh drawn with it needs the attribute `lampIndex` (setLampIndex, LampSwitch.prepare). */
export function withLampSwitch(material) {
  if (material && material.onBeforeCompile !== lampSwitchShader) {
    material.onBeforeCompile = lampSwitchShader;
    material.customProgramCacheKey = lampSwitchKey;
    material.needsUpdate = true;
  }
  return material;
}
const switchable = (m) => !!m && !Array.isArray(m) && m.onBeforeCompile === lampSwitchShader;

/** The attribute `lampIndex` on a mesh (a shared geometry of geo.js gets a copy of its own first). */
function setLampIndex(mesh, index) {
  let g = mesh.geometry;
  if (g.userData.shared) { g = g.clone(); g.userData = {}; mesh.geometry = g; }
  const n = g.attributes.position.count, a = g.attributes.lampIndex;
  if (a && a.count === n) { a.array.fill(index); a.needsUpdate = true; }
  else g.setAttribute('lampIndex', new THREE.Float32BufferAttribute(new Float32Array(n).fill(index), 1));
}

/** The id of a lamp placed by the layout: its kind and where it stands, to the centimetre. */
export function lampIdOf(pl) {
  return `${pl.kind}@${pl.x.toFixed(2)},${(pl.meta?.y || 0).toFixed(2)},${pl.z.toFixed(2)}`;
}

const smooth = (t) => t * t * (3 - 2 * t);
const _box = new THREE.Box3();

export class LampSwitch {
  constructor() {
    this.off = new Set();       // ids of the lamps switched off (also those not in the room right now)
    this.entries = [];          // the lamps of this build: { id, kind, obj, index, on, level, k, lights, glows, flames, parts }
    this.byId = new Map();
    this.sent = [];             // lists handed to the settings a moment ago ({ key, t }): their echo changes nothing
    this.offMats = new Map();   // a glowing material → its copy without glow (lampParts)
    this.dirty = false;
  }

  /** A new build of the world: its lamps register again (world.js #clearStatic). */
  reset() {
    this.entries = []; this.byId.clear();
    levels.fill(255); this.dirty = true;
  }

  /**
   * A placed lamp (furniture.js userData.lamp) becomes switchable: its lights and decals (world.lamps, world.glows),
   * its glowing parts, the look ray (world.interactables, a box round its solid parts, a longer reach).
   */
  register(obj, id, world) {
    if (this.byId.has(id)) id += '#' + this.entries.length;     // two lamps in one spot stay apart
    const index = Math.min(MAX_LAMPS - 1, this.entries.length + 1);
    const on = !this.off.has(id);
    const e = { id, kind: obj.userData.lamp || 'lamp', obj, index, on, level: on ? 1 : 0, k: on ? 1 : 0, lights: [], glows: [], flames: [], parts: [] };
    const lights = new Set((obj.userData.lights || []).map((l) => l.light));
    for (const l of world.lamps) if (lights.has(l.light)) e.lights.push(l);
    const decals = new Set((obj.userData.glows || []).map((m) => m.material));
    for (const g of world.glows) if (decals.has(g.mat)) e.glows.push(g);
    if (obj.userData.flames) e.flames.push(obj.userData.flames);
    for (const mesh of obj.userData.lampParts || []) e.parts.push({ mesh, mat: mesh.material });
    const interact = { kind: 'lamp', lamp: id, lampKind: e.kind };
    obj.userData.interact = interact;
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3();
    obj.traverse((o) => {
      if (!o.isMesh || o.userData.glow) return;     // a decal is light on a wall or a table, not the lamp
      o.userData.interact = interact; o.userData.root = obj;
      if (o.material?.userData?.lampGlow != null) withLampSwitch(o.material);
      if (switchable(o.material)) setLampIndex(o, index);
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.union(_box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
    });
    obj.userData.pickBox = box.isEmpty() ? null : box.expandByScalar(0.03);
    obj.userData.reach = LAMP_REACH;
    world.interactables.push(obj);
    this.entries.push(e); this.byId.set(id, e);
    this.#write(e);
    return id;
  }

  /** Before the static parts are batched: a glowing lamp part that no lamp registered gets the attribute as well (its
   *  level stays at 1), so that every mesh of a batch has the same attributes. */
  prepare(root) {
    root.traverse((o) => { if (o.isMesh && switchable(o.material) && !o.geometry.attributes.lampIndex) setLampIndex(o, 0); });
  }

  /** settings.lampsOff: the lamps of the world fade to it. The echo of a list this switch has just handed to the
   *  settings changes nothing (a second switch in the meantime would be undone by it). */
  apply(list) {
    const ids = Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
    const key = ids.join('|');
    const now = performance.now();
    this.sent = this.sent.filter((s) => now - s.t < 4000);
    if (this.sent.some((s) => s.key === key)) return;
    if (key === [...this.off].join('|')) return;
    this.off = new Set(ids);
    for (const e of this.entries) e.on = !this.off.has(e.id);
  }

  /** E or a click on a lamp: switches it and returns whether it is on now. */
  toggle(id) {
    const e = this.byId.get(id);
    const on = e ? !e.on : this.off.has(id);
    this.set(id, on);
    return on;
  }
  set(id, on) {
    this.off.delete(id);
    if (!on) this.off.add(id);
    const e = this.byId.get(id); if (e) e.on = on;
  }
  isOn(id) { const e = this.byId.get(id); return e ? e.on : !this.off.has(id); }
  /** The ids of the lamps switched off, for the settings (the newest 300). */
  offList() {
    const list = [...this.off].slice(-300);
    this.sent.push({ key: list.join('|'), t: performance.now() });
    return list;
  }

  /** Every frame, after world.js has set the lights and decals of all lamps: the switched-off ones and those on their
   *  way follow their level. */
  update(dt) {
    for (const e of this.entries) {
      const target = e.on ? 1 : 0;
      if (e.level !== target) {
        e.level = target > e.level ? Math.min(1, e.level + dt / FADE) : Math.max(0, e.level - dt / FADE);
        this.#write(e);
      }
      if (e.k < 1) {
        for (const l of e.lights) l.light.intensity *= e.k;
        for (const g of e.glows) g.mat.opacity *= e.k;
      }
    }
    if (this.dirty) { levelTexture.needsUpdate = true; this.dirty = false; }
  }
  #write(e) {
    e.k = smooth(e.level);
    const v = Math.round(e.k * 255);
    if (levels[e.index * 4] !== v) { levels[e.index * 4] = v; this.dirty = true; }
    // candles and other glowing parts without the switch shader: the flames go out, the parts lose their glow
    for (const f of e.flames) f.visible = e.level > 0.5;
    for (const p of e.parts) p.mesh.material = e.level > 0.5 ? p.mat : this.#offMat(p.mat);
  }
  #offMat(m) {
    let c = this.offMats.get(m);
    if (!c) { c = m.clone(); c.emissiveIntensity = 0; this.offMats.set(m, c); }
    return c;
  }

  /** For the checks: every lamp with its state, the level its shader reads and its lights and decals right now. */
  info() {
    return {
      off: [...this.off],
      lamps: this.entries.map((e) => ({
        id: e.id, kind: e.kind, index: e.index, on: e.on, level: +e.level.toFixed(3), texel: levels[e.index * 4],
        lights: e.lights.map((l) => +l.light.intensity.toFixed(4)), glows: e.glows.map((g) => +g.mat.opacity.toFixed(4)),
      })),
    };
  }
}
