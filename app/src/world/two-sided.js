// Transparent things seen from both sides, drawn the way three draws them, without its cost every frame. three draws a
// transparent double-sided material in two passes, its back faces and then its front faces, and marks the material
// needsUpdate before each (WebGLRenderer renderObject): every frame, for every such thing in view, it works out the
// program's parameters and key twice, builds the list of uniforms anew and uploads all of them (some 40 µs a pass on a
// desktop processor, several times that on a phone: the glass of the windows and the hall's front, the rain, the fire).
// twoSided(mesh) gives the mesh a back-side copy of its material and a child drawn right after it with a front-side
// copy: the same two programs (three's key for a pass is the key of a material with that side), the same order (the
// child stands where its parent stands, at the same distance from the eye, with a later id: three's order of transparent
// things puts it next), the same uniforms (a shader material's copies share its uniform objects), and no needsUpdate.
import * as THREE from 'three';

const copies = new WeakMap();

/** A copy of `m` drawn from one side only. Its uniforms (a shader material's) and its userData are the original's own
 *  objects; three's clone would copy them (and its textures). The shadow keeps the original's side. */
function copyFor(m, side) {
  const uniforms = m.uniforms, userData = m.userData;
  m.userData = {};
  if (m.isShaderMaterial) m.uniforms = {};
  let c;
  try { c = m.clone(); } finally { m.userData = userData; if (m.isShaderMaterial) m.uniforms = uniforms; }
  if (m.isShaderMaterial) c.uniforms = uniforms;
  c.userData = userData;
  c.side = side;
  c.shadowSide = m.shadowSide ?? THREE.DoubleSide;
  // (the same patch of the shader and the same key: the same program as the pass three would have drawn)
  c.onBeforeCompile = m.onBeforeCompile;
  c.customProgramCacheKey = m.customProgramCacheKey;
  return c;
}

/** The back-side and the front-side copy of a material (made once; disposed with it). */
export function sidesOf(m) {
  let s = copies.get(m);
  if (!s) {
    s = { back: copyFor(m, THREE.BackSide), front: copyFor(m, THREE.FrontSide) };
    copies.set(m, s);
    m.addEventListener('dispose', () => { s.back.dispose(); s.front.dispose(); copies.delete(m); });
  }
  return s;
}

/** True for a material three would draw in two passes. */
export const drawnTwice = (m) => !!m && !Array.isArray(m) && m.transparent === true && m.side === THREE.DoubleSide && m.forceSinglePass === false;

/** The mesh draws its back faces, a child drawn right after it its front faces. Returns the mesh. */
export function twoSided(mesh) {
  // (a plain mesh only: an instanced or batched one would need its instances twice)
  if (!mesh?.isMesh || mesh.isInstancedMesh || mesh.isBatchedMesh || mesh.isSkinnedMesh || !drawnTwice(mesh.material) || mesh.userData.twoSided) return mesh;
  const { back, front } = sidesOf(mesh.material);
  mesh.material = back;
  const twin = new THREE.Mesh(mesh.geometry, front);
  twin.name = mesh.name;
  twin.renderOrder = mesh.renderOrder;
  twin.frustumCulled = mesh.frustumCulled;
  twin.layers.mask = mesh.layers.mask;
  twin.castShadow = false;   // (the mesh itself casts as before: its copy keeps the original's shadow side)
  twin.receiveShadow = mesh.receiveShadow;
  if (mesh.userData.noAO) twin.userData.noAO = true;
  // (flags, no references: three's clone copies userData through JSON)
  twin.userData.front = true;
  twin.raycast = () => {};   // (the mesh is what a ray finds, as before)
  mesh.userData.twoSided = true;
  mesh.add(twin);
  return mesh;
}

/** twoSided for every mesh under `root` (the meshes of a built piece of furniture). Returns root. */
export function twoSidedAll(root) {
  const list = [];
  root?.traverse((o) => { if (o.isMesh && drawnTwice(o.material) && !o.userData.front) list.push(o); });
  for (const o of list) twoSided(o);
  return root;
}
