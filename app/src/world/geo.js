// Small geometry helpers: boxes, rounded boxes, merging static parts per material.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { seeded, hashStr, clamp } from '../core/hash.js';

export { seeded, hashStr, clamp };

const geoCache = new Map();
/** Anything from the cache is SHARED: world.js must never dispose it on a rebuild. */
function cached(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); g.userData.shared = true; geoCache.set(key, g); }
  return g;
}
export function boxGeo(w, h, d) { return cached(`b:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d)); }
export function rboxGeo(w, h, d, r = 0.02, seg = 3) { return cached(`rb:${w}:${h}:${d}:${r}:${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, r)); }
export function cylGeo(rt, rb, h, seg = 16) { return cached(`c:${rt}:${rb}:${h}:${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)); }
export function sphereGeo(r, seg = 16) { return cached(`s:${r}:${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(8, seg / 2))); }
export function planeGeo(w, h) { return cached(`p:${w}:${h}`, () => new THREE.PlaneGeometry(w, h)); }
export function torusGeo(r, tube, rs, ts, arc) { return cached(`t:${r}:${tube}:${rs}:${ts}:${arc}`, () => new THREE.TorusGeometry(r, tube, rs, ts, arc)); }
export function coneGeo(r, h, seg) { return cached(`co:${r}:${h}:${seg}`, () => new THREE.ConeGeometry(r, h, seg)); }

/**
 * A box whose UVs are measured in metres instead of 0..1 per face. Without this, a long thin
 * beam tiles its texture just as often across its 0.26 m side as across its 17 m length, which
 * produces the shimmering moiré you get on grazing angles. `tile` = metres per texture repeat.
 */
export function boxGeoUV(w, h, d, tile = 0.5) {
  const k = `bu:${w}:${h}:${d}:${tile}`;
  if (geoCache.has(k)) return geoCache.get(k);
  const g = new THREE.BoxGeometry(w, h, d);
  g.userData.shared = true;
  const uv = g.attributes.uv;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 vertices each, uv 0..1)
  const spans = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = spans[f];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * (su / tile), uv.getY(i) * (sv / tile));
    }
  }
  uv.needsUpdate = true;
  geoCache.set(k, g);
  return g;
}

/** A plane with metre-based UVs (floors, ceilings). */
export function planeGeoUV(w, h, tile = 1) {
  const k = `pu:${w}:${h}:${tile}`;
  if (geoCache.has(k)) return geoCache.get(k);
  const g = new THREE.PlaneGeometry(w, h);
  g.userData.shared = true;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / tile), uv.getY(i) * (h / tile));
  uv.needsUpdate = true;
  geoCache.set(k, g);
  return g;
}

/** A "part collector": add(geometry, material, matrix) then build() → Group of merged meshes (one per material). */
export class Parts {
  constructor() { this.byMat = new Map(); this.extra = []; }
  add(geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale));
    let g = geometry.clone().applyMatrix4(m);
    if (g.index) g = g.toNonIndexed();
    // drop attributes that differ between geometries to keep merge happy
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!this.byMat.has(material)) this.byMat.set(material, []);
    this.byMat.get(material).push(g);
    return this;
  }
  /** Same as add(), but with an explicit world matrix (used for nested local frames). */
  addMatrix(geometry, material, matrix) {
    let g = geometry.clone().applyMatrix4(matrix);
    if (g.index) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!this.byMat.has(material)) this.byMat.set(material, []);
    this.byMat.get(material).push(g);
    return this;
  }
  box(w, h, d, material, position, rotation, rounded) { return this.add(rounded ? rboxGeo(w, h, d, rounded) : boxGeo(w, h, d), material, position, rotation); }
  cyl(rt, rb, h, material, position, rotation, seg) { return this.add(cylGeo(rt, rb, h, seg), material, position, rotation); }
  mesh(mesh) { this.extra.push(mesh); return this; }
  build({ castShadow = true, receiveShadow = true, name = '' } = {}) {
    const group = new THREE.Group(); group.name = name;
    for (const [mat, geos] of this.byMat) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      merged.userData.disposable = true;   // per-build clone – safe (and necessary) to dispose on rebuild
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = castShadow; mesh.receiveShadow = receiveShadow;
      group.add(mesh);
    }
    for (const m of this.extra) group.add(m);
    return group;
  }
}

/** axis aligned collider box in world space */
export function aabb(cx, cy, cz, w, h, d) { return { min: [cx - w / 2, cy - h / 2, cz - d / 2], max: [cx + w / 2, cy + h / 2, cz + d / 2] }; }

export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
