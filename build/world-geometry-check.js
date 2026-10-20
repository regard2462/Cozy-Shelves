// The builders of the garden's geometry and the mural planner in Node, without Electron or a graphics card: every tree
// (each species, several seeds, both levels), every bird (each kind, both levels, the hens paired into the cocks' mesh),
// the frog, every wild animal (each coat, posed walking, galloping and sitting, its muzzle coming down as it grazes),
// the water lilies in every season, the reeds from several camera spots, the planters' grass and the lake must come out
// with finite positions, normals, uvs and instance matrices, indices inside the vertex count, real bounds and normalised
// skin weights. Every mural (each palette seed, both languages) keeps its pieces and characters on the wall and off its
// doors and windows, without overlaps, with letters that have glyphs.
//   node build/world-geometry-check.js        exit code 1 when something fails
'use strict';
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
// the pieces of the browser the builders touch: the canvas (textures, never read back here), Path2D (the letters)
(() => {
  const noop = () => {};
  const grad = () => ({ addColorStop: noop });
  const ctxFor = (c) => new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return c;
      if (k === 'getImageData' || k === 'createImageData') return (x, y, w, h) => { if (typeof x === 'object') { w = x.width; h = x.height; } if (h === undefined) { w = x; h = y; } return { width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h) * 4) }; };
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient' || k === 'createPattern') return grad;
      if (k === 'measureText') return (s) => ({ width: (s || '').length * 10, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 3 });
      if (typeof k === 'symbol') return undefined;
      return k in t ? t[k] : noop;
    },
    set(t, k, v) { t[k] = v; return true; },
    has() { return true; },
  });
  const canvasOf = (w = 1, h = 1) => { const c = { width: w, height: h, style: {} }; c.getContext = () => ctxFor(c); c.toDataURL = () => 'data:,'; return c; };
  globalThis.document = { documentElement: { lang: 'de', style: {} }, createElement: (tag) => (tag === 'canvas' ? canvasOf() : { style: {}, setAttribute: noop, appendChild: noop, addEventListener: noop }), addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [], body: { appendChild: noop } };
  globalThis.window = { addEventListener: noop, removeEventListener: noop, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720, location: { href: 'file:///check', search: '' }, navigator: { language: 'de' }, requestAnimationFrame: () => 0 };
  if (!('navigator' in globalThis)) globalThis.navigator = { language: 'de', hardwareConcurrency: 4, userAgent: 'node' };   // (Node 21+ has one of its own, read-only)
  globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
  globalThis.Path2D = class Path2D { constructor() { return new Proxy(this, { get: (t, k) => (k in t ? t[k] : noop) }); } };
  globalThis.OffscreenCanvas = class OffscreenCanvas { constructor(w, h) { return canvasOf(w, h); } };
  globalThis.Worker = class Worker { postMessage() {} terminate() {} addEventListener() {} };
})();

/** The app's modules bundled for Node (as the games tests do), one module object with every export asked for. */
function load(entries) {
  const contents = entries.map(([rel, names], i) => `import { ${names.join(', ')} } from './${rel}'; export { ${names.join(', ')} };`).join('\n');
  const out = esbuild.buildSync({ stdin: { contents: `import * as THREE from 'three'; export { THREE };\n${contents}`, resolveDir: root, loader: 'js' }, bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'error' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const W = load([
  ['app/src/world/trees.js', ['SPECIES', 'buildTree']],
  ['app/src/world/bird-models.js', ['KINDS', 'buildBird', 'buildFrog', 'joints']],
  ['app/src/world/wildlife-models.js', ['COAT_LIST', 'createAnimal', 'prepareSpecies', 'applyPose', 'muzzleAt', 'reachFor']],
  ['app/src/world/lilies.js', ['makeLilies']],
  ['app/src/world/reeds.js', ['makeReeds']],
  ['app/src/world/nature.js', ['grassClumpGeometry', 'plantingFor']],
  ['app/src/world/water.js', ['makeWater']],
  ['app/src/world/layout.js', ['buildLayout']],
  ['app/src/world/walls.js', ['wallSpecs']],
  ['app/src/world/wall-art.js', ['planMural', 'MURAL_WORDS', 'PALETTES']],
]);
const { THREE } = W;

let passed = 0, failed = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); if (ok) passed++; else failed++; return ok; };
const badCount = (arr) => { let n = 0; for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) n++; return n; };
/** What is wrong with a geometry (nothing: []). */
function problems(g, { bones = 0, instanced = null } = {}) {
  const out = [], pos = g.attributes.position;
  if (!pos || !pos.count) return ['no positions'];
  for (const [name, a] of Object.entries(g.attributes)) {
    const bad = badCount(a.array);
    if (bad) out.push(`${name}: ${bad} non-finite of ${a.array.length}`);
    if (a.count !== pos.count && !a.isInstancedBufferAttribute && !a.isInterleavedBufferAttribute) out.push(`${name}: ${a.count} items for ${pos.count} vertices`);
  }
  if (g.index) {
    let max = -1, min = Infinity;
    for (const v of g.index.array) { if (v > max) max = v; if (v < min) min = v; }
    if (max >= pos.count || min < 0) out.push(`index ${min} … ${max} for ${pos.count} vertices`);
    if (g.index.array.length % 3) out.push(`index length ${g.index.array.length} not a multiple of 3`);
  }
  if (!g.boundingSphere) g.computeBoundingSphere();
  const bs = g.boundingSphere;
  if (!bs || !Number.isFinite(bs.radius + bs.center.x + bs.center.y + bs.center.z)) out.push('bounding sphere not finite');
  else if (!(bs.radius > 0)) out.push('bounding sphere radius ' + bs.radius);
  if (bones) {
    const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    let badIdx = 0, badSum = 0;
    for (let v = 0; v < pos.count; v++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) { const b = si.array[v * 4 + k]; if (b < 0 || b >= bones) badIdx++; sum += sw.array[v * 4 + k]; }
      if (Math.abs(sum - 1) > 1e-3) badSum++;
    }
    if (badIdx) out.push(`${badIdx} skin indices outside 0 … ${bones - 1}`);
    if (badSum) out.push(`${badSum} vertices whose skin weights do not sum to 1`);
  }
  if (instanced) {
    const n = instanced.count;
    if (n > instanced.instanceMatrix.count) out.push(`count ${n} above the capacity ${instanced.instanceMatrix.count}`);
    const bad = badCount(instanced.instanceMatrix.array.subarray(0, n * 16));
    if (bad) out.push(`instance matrices: ${bad} non-finite`);
    if (instanced.instanceColor) { const bc = badCount(instanced.instanceColor.array.subarray(0, n * 3)); if (bc) out.push(`instance colours: ${bc} non-finite`); }
  }
  return out;
}

// --- trees ---------------------------------------------------------------------------------------------------------------
for (const species of Object.keys(W.SPECIES)) {
  const probs = [];
  let verts = 0;
  for (const seed of [1, 2, 3, 7]) for (const lod of [0, 1]) {
    const t = W.buildTree(species, seed, lod), tag = `seed ${seed} lod ${lod}: `;
    probs.push(...problems(t.bark).map((p) => tag + 'bark ' + p), ...problems(t.leaves).map((p) => tag + 'leaves ' + p));
    if (!(t.height > 0) || !Number.isFinite(t.height)) probs.push(tag + 'height ' + t.height);
    for (const path of t.paths) { if (path.pts.some((p) => !Number.isFinite(p.x + p.y + p.z))) { probs.push(tag + 'a path point not finite'); break; } if (path.rad.some((r) => !(r > 0))) { probs.push(tag + 'a path radius not positive'); break; } }
    verts += t.bark.attributes.position.count + t.leaves.attributes.position.count;
  }
  check(`tree ${species}: four seeds, both levels`, !probs.length, probs.length ? probs.slice(0, 4) : { verts });
}
// --- birds and the frog --------------------------------------------------------------------------------------------------
const HEN = { sparrowM: 'sparrowF', chaffinchM: 'chaffinchF', blackbirdM: 'blackbirdF' };
for (const kind of Object.keys(W.KINDS)) {
  const probs = [], J = W.joints(W.KINDS[kind]);
  const jBad = Object.entries(J).filter(([, v]) => (Array.isArray(v) ? !v.every(Number.isFinite) : !Number.isFinite(v))).map(([k]) => k);
  if (jBad.length) probs.push('joints not finite: ' + jBad.join(','));
  let v = 0;
  for (const lod of [0, 1]) {
    const g = W.buildBird(kind, lod, HEN[kind] || null);
    probs.push(...problems(g).map((p) => `lod ${lod}: ${p}`));
    if (HEN[kind] && g.userData.paired !== HEN[kind]) probs.push(`lod ${lod}: the hen ${HEN[kind]} did not pair (the two shapes differ vertex for vertex)`);
    const rig = g.attributes.aRig.array;
    let rigBad = 0;
    for (let i = 0; i < rig.length; i += 4) if (rig[i] < 0 || rig[i] > 6 || rig[i + 1] < -1.001 || rig[i + 1] > 1.001 || Math.abs(rig[i + 2]) > 1) rigBad++;
    if (rigBad) probs.push(`lod ${lod}: ${rigBad} rig entries out of range`);
    v += g.attributes.position.count;
  }
  check(`bird ${kind}${HEN[kind] ? ' with the hen ' + HEN[kind] : ''}: both levels`, !probs.length, probs.length ? probs.slice(0, 4) : { verts: v });
}
for (const lod of [0, 1]) { const g = W.buildFrog(lod), probs = problems(g); check(`frog lod ${lod}`, !probs.length, probs.length ? probs : { verts: g.attributes.position.count }); }
// --- the wild animals ----------------------------------------------------------------------------------------------------
const POSES = [
  { phase: 0.3, move: 1, trot: 0, stride: 1, graze: 0, alert: 0, yaw: 0.2, pitch: 0, tilt: 0, bend: 0.1, earL: [0, 0, 0], earR: [0, 0, 0], tail: [0, 0], lean: 0, roll: 0, shift: 0 },
  { phase: 0.7, move: 1, trot: 1, gallop: 1, stride: 1, graze: 0, alert: 0, yaw: 0, pitch: 0, tilt: 0, bend: 0, earL: [0, 0, 0], earR: [0, 0, 0], tail: [0, 0], lean: 0, roll: 0, shift: 0 },
  { phase: 0, move: 0, trot: 0, stride: 1, graze: 1, alert: 0, yaw: 0, pitch: 0, tilt: 0, bend: 0, earL: [0, 0, 0], earR: [0, 0, 0], tail: [0, 0], lean: 0, roll: 0, shift: 1, sit: 1 },
];
const finiteBones = (A) => { A.mesh.updateMatrixWorld(true); return A.mesh.skeleton.bones.every((b) => Number.isFinite(b.matrixWorld.elements.reduce((a, x) => a + x, 0))); };
for (const [kind, winter] of W.COAT_LIST) {
  const step = W.prepareSpecies(kind, winter);
  let steps = 0; while (!step()) steps++;
  const A = W.createAnimal(kind, winter), g = A.mesh.geometry, bones = A.mesh.skeleton.bones.length;
  const probs = problems(g, { bones });
  if (!finiteBones(A)) probs.push('a bone of the bind pose not finite');
  for (const P of POSES) { W.applyPose(A, P); if (!finiteBones(A)) { probs.push('a posed bone not finite'); break; } }
  const m0 = W.muzzleAt(kind, 0), m1 = W.muzzleAt(kind, 1), up = W.muzzleAt(kind, -1.6);
  if (!Number.isFinite(m0.y + m1.y + up.y)) probs.push('muzzle heights not finite');
  else if (!(m1.y < m0.y && m0.y < up.y)) probs.push(`the muzzle does not come down with r: up ${up.y.toFixed(2)}, standing ${m0.y.toFixed(2)}, grazing ${m1.y.toFixed(2)}`);
  const reach = W.reachFor(kind, (m0.y + m1.y) / 2);
  if (!reach || !Number.isFinite(reach.r + reach.f)) probs.push('no feeding pose for a height between standing and grazing');
  check(`animal ${kind}${winter ? ' in the winter coat' : ''}: geometry, bones, poses, the muzzle`, !probs.length, probs.length ? probs.slice(0, 4) : { verts: g.attributes.position.count, bones, steps });
}
// --- lilies, reeds, grass, the lake ----------------------------------------------------------------------------------------
{
  const L = W.makeLilies(), probs = [];
  for (const season of ['spring', 'summer', 'autumn', 'winter']) for (const frozen of [false, true]) {
    L.setSeason(season, frozen);
    for (const m of L.meshes) probs.push(...problems(m.geometry, { instanced: m }).map((p) => `${season}${frozen ? ' frozen' : ''} ${m.name}: ${p}`));
    if (frozen && L.lilyPads.length) probs.push(`${season} frozen: ${L.lilyPads.length} pads for the frogs under the ice`);
    if (L.lilyPads.some((p) => !Number.isFinite(p.x + p.z + p.y + p.r) || !(p.r > 0))) probs.push(`${season}: a pad spot not finite`);
  }
  L.setSeason('summer');
  check('the water lilies in every season, frozen and open', !probs.length, probs.length ? probs.slice(0, 4) : { pads: L.pads.length, flowers: L.flowers.length });
  const R = W.makeReeds(L.lilyPads), rp = [], cam = new THREE.PerspectiveCamera();
  for (const [x, z] of [[0, 0], [-20, 45], [-41, 59], [100, 100]]) { cam.position.set(x, 1.6, z); R.update(cam); for (const { mesh } of R.meshes) rp.push(...problems(mesh.geometry, { instanced: mesh }).map((p) => `camera ${x},${z} ${mesh.name}: ${p}`)); }
  R.setQuality('low'); cam.position.set(-20, 1.6, 45); R.update(cam);
  for (const { mesh } of R.meshes) rp.push(...problems(mesh.geometry, { instanced: mesh }).map((p) => `low ${mesh.name}: ${p}`));
  check('the reeds from several camera spots, near and far meshes, the low quality', !rp.length && R.clumps.length > 0, rp.length ? rp.slice(0, 4) : { clumps: R.clumps.length, meshes: R.meshes.length });
  const gc = W.grassClumpGeometry({ blades: 9, seed: 3 }), gp = problems(gc);
  const pl = W.plantingFor(1.6, 0.5, 0.6, 2), pp = problems(pl.geometry);
  check('a grass clump and the planting of a terrace planter', !gp.length && !pp.length, [...gp, ...pp].length ? [...gp, ...pp] : { clump: gc.attributes.position.count, planting: pl.geometry.attributes.position.count });
  const Wt = W.makeWater(), wp = problems(Wt.mesh.geometry), posts = Wt.uniforms.uJettyPosts.value;
  if (posts.length !== 8 || posts.some((p) => !Number.isFinite(p.x + p.y + p.z + p.w))) wp.push('jetty posts: ' + posts.length);
  const sk = Wt.uniforms.uSkyline.value.image.data;
  let skBad = 0; for (let i = 0; i < sk.length; i += 4) if (sk[i + 3] !== 255) skBad++;
  if (skBad) wp.push(skBad + ' skyline texels without alpha');
  Wt.apply({ weather: 'snow' }); Wt.apply({ weather: 'clear', mix: { frozen: 0.2, rain: 0.1 } }); Wt.setWinter(0.5);
  check('the lake: geometry, the skyline texture, the jetty posts', !wp.length, wp.length ? wp : { verts: Wt.mesh.geometry.attributes.position.count });
}
// --- the murals ------------------------------------------------------------------------------------------------------------
{
  const L = W.buildLayout([], {}, {}), walls = W.wallSpecs(L, []);
  check('the wall specs of the layout', walls.length > 0 && walls.every((w) => Number.isFinite(w.len + w.y0 + w.y1) && w.len > 0), { walls: walls.length });
  const GLYPHS = new Set('ABCDEFGHIJKLMNOPRSTUVWXYZÄÖÜ!?-');
  const missing = [];
  for (const lang of ['de', 'en']) for (const list of Object.values(W.MURAL_WORDS[lang])) for (const word of list) for (const ch of word) if (!GLYPHS.has(ch)) missing.push(lang + ' ' + word + ' ' + ch);
  check('every letter of the mural words has a glyph', !missing.length, missing);
  for (let seed = 1; seed <= W.PALETTES.length + 1; seed++) for (const lang of ['de', 'en']) {
    const plan = W.planMural(walls, seed, lang), probs = [];
    let pieces = 0;
    for (const w of walls) {
      const wp = plan.walls[w.id];
      if (!wp) { probs.push(`no plan for ${w.id}`); continue; }
      const bigs = [];
      for (const it of wp.items) {
        if (it.type === 'decor') {
          if (!Number.isFinite(it.u + it.y + it.size)) probs.push(`${w.id} ${it.kind}: not finite`);
          else if (it.kind !== 'crown' && (it.u < -0.01 || it.u > w.len + 0.01 || it.y < w.y0 - 0.01 || it.y > w.y1 + 0.01)) probs.push(`${w.id} ${it.kind} off the wall`);
          continue;
        }
        if (it.type === 'piece') pieces++;
        if (!Number.isFinite(it.u + it.y + it.w + it.h) || !(it.w > 0 && it.h > 0)) { probs.push(`${w.id} ${it.type}: not finite`); continue; }
        const top = w.top ?? w.y1;
        if (it.u < -0.01 || it.u + it.w > w.len + 0.01 || it.y < w.y0 - 0.01 || it.y + it.h > top + 0.01) probs.push(`${w.id} ${it.type} ${it.word || it.kind} off the wall`);
        for (const o of bigs) if (it.u < o.u + o.w && o.u < it.u + it.w && it.y < o.y + o.h && o.y < it.y + it.h) probs.push(`${w.id}: ${it.type} ${it.word || it.kind} overlaps ${o.type} ${o.word || o.kind}`);
        // at every column of a piece or a character some part of the wall holds its whole height (above a door the
        // wall goes on, a piece may hang there; a door or a window itself is no place for one)
        if (w.parts && it.type !== 'throw') {
          let off = 0;
          for (let u = it.u + 0.02; u < it.u + it.w; u += 0.05) if (!w.parts.some((p) => u >= p.u0 - 0.01 && u <= p.u1 + 0.01 && it.y >= p.y0 - 0.01 && it.y + it.h <= p.y1 + 0.01)) off++;
          if (off) probs.push(`${w.id}: ${it.type} ${it.word || it.kind} hangs over a gap of the wall at ${off} columns`);
        }
        bigs.push(it);
      }
    }
    const words = plan.stats.words, dup = words.filter((x, i) => words.indexOf(x) !== i);
    if (dup.length) probs.push('a word painted twice: ' + dup.join(','));
    check(`mural seed ${seed} ${lang}: on the wall, no overlaps, each word once`, !probs.length && pieces > 0, probs.length ? probs.slice(0, 4) : { pieces, words: words.slice(0, 3) });
  }
}
console.log(`WORLD-GEOMETRY-CHECK ${failed ? 'FAILED' : 'OK'} passed=${passed} failed=${failed}`);
process.exitCode = failed ? 1 : 0;
