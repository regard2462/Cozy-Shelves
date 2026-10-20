// The floor of every room ("Fußboden", settings.floor): ONE material for all floor surfaces of the house. M.floor()
// (materials.js) hands it to world.js and to anything else that lays a floor: it maps itself in
// world space, so any horizontal mesh can use it, whatever its uvs. Its look follows the setting: the default oak
// boards come from textures.js at once, every other style (floor-styles.js) is painted by a worker (floor-art.js in
// floor-worker.js) and put onto the graphics card a strip per frame (texture-stream.js) before the material switches
// to it. A change never stalls a frame and never compiles a shader: only the textures and a few uniforms change.
//
// Against repetition: x and z in metres divided by the style's tile give the texture coordinates; every row of tiles
// (along x) is shifted by a random multiple of the style's period, so the same boards or slabs never line up across
// the room. The derivatives come from the unshifted coordinates (textureGrad), so the shift leaves no seam. A soft
// variation of the tone over the room and a little brightness of its own for every tile do the rest.
import * as THREE from 'three';
import { plankTexture } from './textures.js';
import { FLOOR_SPECS, floorStyleOf, floorPainting } from './floor-styles.js';
import { TextureStream } from './texture-stream.js';
import { bus } from '../core/bus.js';

/** The uniforms of the floor shader, shared by the floor and its warm-up copy. */
const U = {
  uFloorTile: { value: 2.4 }, uFloorShift: { value: 48 }, uFloorCell: { value: 0 }, uFloorCellVar: { value: 0 }, uFloorVary: { value: 0.04 },
};
const HELPERS = /* glsl */`
uniform float uFloorTile, uFloorShift, uFloorCell, uFloorCellVar, uFloorVary;
varying vec3 vFloorPos;
vec2 floorUv, floorUvC, floorDx, floorDy;
float floorHash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
float floorNoise( vec2 p ) {
	vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( floorHash( i ), floorHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( floorHash( i + vec2( 0.0, 1.0 ) ), floorHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}`;
// the texture coordinates of this point of the floor, the tone of the room and of the tile, then the colour
const MAP = /* glsl */`
	floorUvC = vFloorPos.xz / uFloorTile;
	floorDx = dFdx( floorUvC ); floorDy = dFdy( floorUvC );
	floorUv = floorUvC;
	floorUv.x += floor( floorHash( vec2( floor( floorUvC.y ), 3.7 ) ) * uFloorShift ) / max( uFloorShift, 1.0 );
	float floorTone = floorNoise( vFloorPos.xz * 0.45 ) * 0.65 + floorNoise( vFloorPos.xz * 1.3 + 17.0 ) * 0.35;
	float floorK = 1.0 + uFloorVary * ( floorTone - 0.5 ) * 2.0;
	if ( uFloorCell > 0.0 ) floorK *= 1.0 + uFloorCellVar * ( floorHash( floor( vFloorPos.xz / uFloorCell + 0.0001 ) + 11.0 ) - 0.5 ) * 2.0;
#ifdef USE_MAP
	diffuseColor *= textureGrad( map, floorUv, floorDx, floorDy );
#endif
	diffuseColor.rgb *= floorK;`;

function floorShader(shader) {
  Object.assign(shader.uniforms, U);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vFloorPos;')
    .replace('#include <project_vertex>', '#include <project_vertex>\n\tvec4 floorWorld = vec4( transformed, 1.0 );\n#ifdef USE_INSTANCING\n\tfloorWorld = instanceMatrix * floorWorld;\n#endif\n\tvFloorPos = ( modelMatrix * floorWorld ).xyz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + HELPERS)
    .replace('#include <map_fragment>', MAP)
    .replace('#include <roughnessmap_fragment>', THREE.ShaderChunk.roughnessmap_fragment.replace('texture2D( roughnessMap, vRoughnessMapUv )', 'textureGrad( roughnessMap, floorUv, floorDx, floorDy )') + '\n\troughnessFactor *= 1.0 + ( floorTone - 0.5 ) * uFloorVary * 1.5;')
    .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('vNormalMapUv', 'floorUvC'))
    .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('texture2D( normalMap, vNormalMapUv )', 'textureGrad( normalMap, floorUv, floorDx, floorDy )'));
}
function floorKey() { return 'floor-1'; }
function withFloorShader(m) { m.onBeforeCompile = floorShader; m.customProgramCacheKey = floorKey; return m; }

let finish = null;
/** The one floor material of the house (materials.js M.floor). */
export function floorMaterial() { return (finish ||= new FloorFinish()).material; }
/** The floor for a world: its renderer uploads the textures, its frames swap them (world.js). */
export function attachFloors(world) { (finish ||= new FloorFinish()).attach(world); return finish; }

class FloorFinish {
  constructor() {
    // the oak boards of 0.5 and 0.6, painted on the spot (they are the floor of the first frame)
    const oak = plankTexture({ tone: 'oak' });
    for (const t of [oak.map, oak.normalMap, oak.roughnessMap]) t.anisotropy = 16;
    this.sets = new Map([['oak', { map: oak.map, normalMap: oak.normalMap, roughnessMap: oak.roughnessMap, bytes: 0, builtin: true }]]);
    this.material = withFloorShader(new THREE.MeshStandardMaterial({ map: oak.map, normalMap: oak.normalMap, normalScale: new THREE.Vector2(0.2, 0.2), roughnessMap: oak.roughnessMap, roughness: 0.62, metalness: 0 }));
    this.material.name = 'floor';
    this.want = 'oak'; this.shown = 'oak'; this.previous = null;
    this.job = null; this.jobId = 0;
    this.stats = { paintMs: 0, uploadSteps: 0, uploadMaxMs: 0, totalMs: 0, swaps: 0, paints: 0 };
    this.#uniforms('oak');
  }

  attach(world) {
    if (this.world === world) return;
    this.world = world;
    this.aniso = Math.min(16, world.renderer.capabilities.getMaxAnisotropy());
    this.stream = new TextureStream(world.renderer);
    // A centimetre of floor inside the hall's south wall (above the passage), drawn every frame and never seen: every
    // texture of a new floor is drawn once here before the floor switches to it (Direct3D finishes an upload on its
    // first draw), with the floor's own shader program.
    const oak = this.sets.get('oak');
    this.warmMat = withFloorShader(new THREE.MeshStandardMaterial({ map: oak.map, normalMap: oak.normalMap, roughnessMap: oak.roughnessMap, roughness: 0.62, metalness: 0 }));
    this.warm = new THREE.Mesh(new THREE.PlaneGeometry(0.01, 0.01), this.warmMat);
    this.warm.rotation.x = -Math.PI / 2;
    this.warm.position.set(-3, 4.6, -5.675);
    this.warm.frustumCulled = false; this.warm.receiveShadow = true; this.warm.name = 'floor-warm';
    world.scene.add(this.warm);
  }

  /** settings.floor → the floors: at once when its textures are there, else as soon as the worker has painted them. */
  apply(style) {
    const want = floorStyleOf({ floor: style });
    if (want === this.want) return;
    this.want = want;
    if (this.sets.has(want)) { this.#cancel(); this.#show(want); return; }
    this.#paint(want);
  }

  #uniforms(style) {
    const sp = FLOOR_SPECS[style];
    U.uFloorTile.value = sp.tile; U.uFloorShift.value = sp.shift; U.uFloorCell.value = sp.cell; U.uFloorCellVar.value = sp.cellVar; U.uFloorVary.value = sp.vary;
  }
  #show(style) {
    const set = this.sets.get(style), sp = FLOOR_SPECS[style], m = this.material;
    m.map = set.map; m.normalMap = set.normalMap; m.roughnessMap = set.roughnessMap;
    m.roughness = sp.roughness; m.normalScale.set(sp.normal, sp.normal);
    this.#uniforms(style);
    if (style !== this.shown) { this.previous = this.shown; this.shown = style; this.stats.swaps++; }
    // the painted floors kept on the graphics card: this one and the one before (switching back is instant); another
    // one is let go over the next frames (texture-stream.js retire), not in the frame of the swap
    for (const [k, s] of this.sets) if (!s.builtin && k !== this.shown && k !== this.previous) { for (const t of [s.map, s.normalMap, s.roughnessMap]) { if (this.stream) this.stream.retire(t); else t.dispose(); } this.sets.delete(k); }
  }

  #worker() {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('./floor-worker.js', import.meta.url), { type: 'module', name: 'floor' });
    this.worker.onmessage = (e) => this.#onMessage(e.data);
    // a worker that cannot start leaves the floor as it is
    this.worker.onerror = (e) => { console.warn('[floors] worker', e.message || e); this.job = null; this.#busy(false); };
    return this.worker;
  }
  #paint(style) {
    if (this.job?.style === style) return;
    this.#cancel();
    const id = ++this.jobId;
    this.job = { id, style, t0: performance.now(), textures: null, drawn: false };
    this.stats.uploadSteps = 0; this.stats.uploadMaxMs = 0; this.stats.paints++;
    this.#busy(true);
    this.#worker().postMessage({ type: 'paint', id, style, size: FLOOR_SPECS[style].size });
  }
  #cancel() {
    if (!this.job) return;
    this.stream?.clear();
    for (const t of this.job.textures || []) t.dispose();
    this.job = null;
    this.#warmBack();
    this.#busy(false);
  }
  /** Uploaded bytes go back to the worker (texture-stream.js: the main thread's garbage collector never sees them). */
  #giveBack(data) { try { this.worker?.postMessage({ type: 'recycle' }, [data.buffer]); } catch {} }
  /** The settings panel lets the chosen picture pulse while its floor is painted. */
  #busy(on) { if (floorPainting.busy !== on) { floorPainting.busy = on; bus.emit('floors:painting', on); } }
  #onMessage(m) {
    const job = this.job;
    if (!job || m.id !== job.id) return;
    if (m.type === 'error' || !this.stream) { console.warn('[floors] paint', m.message); this.job = null; this.#busy(false); return; }
    job.paintMs = m.ms;
    // the three textures get their storage now and their data over the next frames; each is drawn once by the warm-up
    // floor as soon as it is complete
    const opts = (slot, srgb) => ({ srgb, wrap: THREE.RepeatWrapping, anisotropy: this.aniso || 16, done: (t) => { t.userData.slot = slot; if (this.warmMat) this.warmMat[slot] = t; }, release: (d) => this.#giveBack(d) });
    job.textures = [
      this.stream.add(m.color, m.w, m.h, opts('map', true)),
      this.stream.add(m.normal, m.w, m.h, opts('normalMap', false)),
      this.stream.add(m.rough, m.rw, m.rh, opts('roughnessMap', false)),
    ];
    job.textures[0].userData.slot = 'map'; job.textures[1].userData.slot = 'normalMap'; job.textures[2].userData.slot = 'roughnessMap';
  }

  /** Every frame: a strip of the new floor onto the graphics card; once all three textures are there (and were drawn
   *  once), the floor takes them. */
  update() {
    this.stream?.tidy();
    const job = this.job;
    if (!job?.textures) return;
    if (this.stream.busy) {
      const t0 = performance.now();
      this.stream.step();
      const ms = performance.now() - t0;
      this.stats.uploadSteps++; if (ms > this.stats.uploadMaxMs) this.stats.uploadMaxMs = +ms.toFixed(2);
      return;
    }
    if (!job.drawn) { job.drawn = true; return; }
    const set = { bytes: 0 };
    for (const t of job.textures) { set[t.userData.slot] = t; set.bytes += t.userData.bytes; }
    this.sets.set(job.style, set);
    this.stats.paintMs = job.paintMs; this.stats.totalMs = Math.round(performance.now() - job.t0);
    this.job = null;
    this.#warmBack();
    if (this.want === job.style) this.#show(job.style);
    this.#busy(false);
  }
  /** The warm-up floor goes back to the oak textures (they stay on the card for good). */
  #warmBack() {
    if (!this.warmMat) return;
    const oak = this.sets.get('oak');
    this.warmMat.map = oak.map; this.warmMat.normalMap = oak.normalMap; this.warmMat.roughnessMap = oak.roughnessMap;
  }

  /** For the checks: what the floor shows, what is being painted, what it costs. */
  info() {
    const mb = [...this.sets.values()].reduce((a, s) => a + (s.bytes || 0), 0) / 1048576;
    return { want: this.want, shown: this.shown, painting: !!this.job, cached: [...this.sets.keys()], ...this.stats, mb: +mb.toFixed(1) };
  }

  dispose() {
    this.worker?.terminate(); this.worker = null;
    this.#cancel();
    this.stream?.dispose();
    this.warm?.removeFromParent(); this.warm?.geometry.dispose(); this.warmMat?.dispose();
    this.world = null;
  }
}
