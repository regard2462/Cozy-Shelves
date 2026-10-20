// The world outside the windows. The hall's glass doors open onto a wooden deck with string lights, planters and two
// loungers (layout.js places the furniture); beyond it the garden you can walk through (outdoor.js: the ground, the
// lake, the paths and where you may walk): a lawn, a gravel path down to a jetty on the lake, a meadow with a trodden
// trail up to a bench on a knoll, and a mixed wood (beech, oak, birch, spruce, pine: trees.js) round the clearing and
// on gentle hills that fade into the haze. The lake (water.js) has a shore of wet earth, a pebble beach, stones, reeds
// and cattails (reeds.js) and water lilies (lilies.js); fruit trees and a fire bowl (firebowl.js) stand on the lawn west
// of the path. The sky light, wind, snow and rain reach every plant through the shared uniforms in nature.js, the
// season through seasons.js. At night the string lights and lanterns glow, the fire burns and in summer fireflies
// drift over the lawn. Everything repeated is instanced or merged.
import * as THREE from 'three';
import { Parts, clamp, seeded } from './geo.js';
import { plankTexture } from './textures.js';
import { NATURE, HAZE_GLSL, natureMaterial, noiseTexture, lawnTexture, gravelTexture, pebbleTexture, rockTexture, grassClumpGeometry, weatheredWood, outdoorSteel } from './nature.js';
import { buildTree, barkMaterial, leafMaterial } from './trees.js';
import { makeWater } from './water.js';
import { reedBed, makeReeds } from './reeds.js';
import { makeLilies } from './lilies.js';
import { FireBowl } from './firebowl.js';
import { Seasons } from './seasons.js';
import { TERRACE, FACADE_Z, HALL, ROOM, PASSAGE } from './layout.js';
import {
  OUTDOOR, LAKE, WATER_Y, terrainHeight, lakeDist, keepDist, pathDist, trailDist, beachWeight, PATH, TRAILS, JETTY, TREES, STONES,
  FENCE_LINE, inRegion, inPolygon, onJetty, obstaclesNear, addObstacle, REGION, HOUSE, FIREBOWL,
} from './outdoor.js';

// The garden's data lives in outdoor.js; these stay importable from here as before. OUTDOOR is the interface for
// other modules (the animals): terrain, walkable area, zones, obstacles.
export { GROUND_Y, terrainHeight, OUTDOOR } from './outdoor.js';

const DECK = TERRACE.deck;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- the ground -------------------------------
// One grid: 0.5 m steps over the garden you walk in and everything you see close by (FINE), steps growing outwards
// from there up to the horizon. The fine part doubles as the height field the rain ends on (environment.js).
const FINE = { x0: -50, x1: 46, z0: -6, z1: 76, step: 0.5 };
function axis(a, b, lo, hi, n, step) {
  const fine = [];
  for (let v = a; v <= b + 1e-6; v += step) fine.push(+v.toFixed(4));
  // n steps from the fine part out to the limit, each q times the one before
  const grow = (from, to) => {
    const L = Math.abs(to - from); let q0 = 1.0001, q1 = 3;
    for (let i = 0; i < 60; i++) { const q = (q0 + q1) / 2; if (step * q * (Math.pow(q, n) - 1) / (q - 1) > L) q1 = q; else q0 = q; }
    const q = (q0 + q1) / 2, out = [];
    let v = from, st = step;
    for (let i = 0; i < n; i++) { st *= q; v += Math.sign(to - from) * st; out.push(v); }
    out[n - 1] = to;
    return out;
  };
  return { values: [...grow(a, lo).reverse(), ...fine, ...grow(b, hi)], first: n, count: fine.length };
}
/** The trodden ring round the fire bowl (1 beside it, 0 from 3 m): bare earth where people sit and stand. */
const fireRing = (x, z) => 1 - smooth(1.2, 2.7, Math.hypot(x - FIREBOWL.x, z - FIREBOWL.z) * (1 + 0.12 * Math.sin(Math.atan2(z - FIREBOWL.z, x - FIREBOWL.x) * 3 + 1)));

function groundGeometry(trees) {
  const R = 232;
  const ax = axis(FINE.x0, FINE.x1, -R, R, 30, FINE.step), az = axis(FINE.z0, FINE.z1, 6 - R, 6 + R, 30, FINE.step);
  const NX = ax.values.length, NZ = az.values.length;
  const pos = new Float32Array(NX * NZ * 3), mask = new Float32Array(NX * NZ * 4), mask2 = new Float32Array(NX * NZ * 2), idx = new Uint32Array((NX - 1) * (NZ - 1) * 6);
  // the trees in 16 m cells: each vertex only looks at the trees of its own and the neighbouring cells
  const CELL = 16, cells = new Map(), cellKey = (ci, cj) => (ci + 512) * 1024 + cj + 512;
  for (const t of trees) { const key = cellKey(Math.floor(t.x / CELL), Math.floor(t.z / CELL)); if (!cells.has(key)) cells.set(key, []); cells.get(key).push(t); }
  const field = new Float32Array(ax.count * az.count);
  let k = 0, q = 0;
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++, k++) {
    const x = ax.values[i], z = az.values[j];
    const y = terrainHeight(x, z);
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    const fi = i - ax.first, fj = j - az.first;
    if (fi >= 0 && fi < ax.count && fj >= 0 && fj < az.count) field[fj * ax.count + fi] = y;
    let shade = 0;
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const list = cells.get(cellKey(ci + a, cj + b)); if (!list) continue;
      for (const t of list) { const d2 = (t.x - x) ** 2 + (t.z - z) ** 2, r2 = t.shade * t.shade; if (d2 < r2 * 4) shade += 0.55 * Math.exp(-d2 / r2); }
    }
    const near = y < WATER_Y + 1.2;
    mask[k * 4] = smooth(3, 26, keepDist(x, z));
    mask[k * 4 + 1] = near ? beachWeight(x, z) : 0;
    mask[k * 4 + 2] = Math.min(1, shade);
    mask[k * 4 + 3] = 1 - smooth(0.6, 1.6, pathDist(x, z));
    mask2[k * 2] = Math.max(1 - smooth(0.22, 0.75, trailDist(x, z)), fireRing(x, z) * 0.7);
    mask2[k * 2 + 1] = near ? reedBed(x, z) : 0;
    if (i < NX - 1 && j < NZ - 1) { const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1; idx[q] = a; idx[q + 1] = c; idx[q + 2] = b; idx[q + 3] = b; idx[q + 4] = c; idx[q + 5] = d; q += 6; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aMask', new THREE.BufferAttribute(mask, 4));
  g.setAttribute('aMask2', new THREE.BufferAttribute(mask2, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  // the height field for the rain: half floats, filtered (the terrain is smooth; the deck, the jetty, the roofs and the
  // water's surface are added in the shader)
  const half = new Uint16Array(field.length);
  for (let n = 0; n < field.length; n++) half[n] = THREE.DataUtils.toHalfFloat(field[n]);
  const tex = new THREE.DataTexture(half, ax.count, az.count, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
  // the texture's texel centres lie on the grid's vertices: x0, z0 and the size are those of the texels' outer edges
  const nx = ax.count, nz = az.count, st = FINE.step;
  /** The height field as the shader reads it (bilinear between the vertices, clamped at the edges). */
  const sample = (x, z) => {
    const fx = clamp((x - FINE.x0) / st, 0, nx - 1), fz = clamp((z - FINE.z0) / st, 0, nz - 1);
    const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(nz - 2, Math.floor(fz)), tx = fx - i, tz = fz - j;
    const a = field[j * nx + i], b = field[j * nx + i + 1], c = field[(j + 1) * nx + i], d = field[(j + 1) * nx + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };
  /** The ground as drawn: the two triangles of each cell of the grid (for the checks). */
  const meshAt = (x, z) => {
    const fx = clamp((x - FINE.x0) / st, 0, nx - 1), fz = clamp((z - FINE.z0) / st, 0, nz - 1);
    const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(nz - 2, Math.floor(fz)), tx = fx - i, tz = fz - j;
    const a = field[j * nx + i], b = field[j * nx + i + 1], c = field[(j + 1) * nx + i], d = field[(j + 1) * nx + i + 1];
    return tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  };
  return { geometry: g, heightField: { texture: tex, x0: FINE.x0 - st / 2, z0: FINE.z0 - st / 2, w: nx * st, d: nz * st, sample, meshAt } };
}
const SPILL = { value: new THREE.Color(0, 0, 0) };   // the rooms' light falling out through the glass at night
function groundMaterial() {
  const lawn = lawnTexture(), noise = noiseTexture();
  return natureMaterial('ground', { color: 0xffffff, roughness: 0.96, fog: false }, {
    key: ':terrain',
    uniforms: { uLawnTex: { value: lawn }, uNoiseTex: { value: noise }, uPebbleTex: { value: pebbleTexture() }, uSpill: SPILL, uWaterY: { value: WATER_Y } },
    // the lamps do not light the garden (nature.js): the glow of the lit glass front and of the string lights along the
    // deck's edge on the lawn is added here
    irradianceFragment: `irradiance += uSpill * (exp(-max(vNatWorld.z - ${FACADE_Z.toFixed(2)}, 0.0) * 0.28) + 0.9 * exp(-max(vNatWorld.z - ${DECK.z1.toFixed(2)}, 0.0) * 0.4)) * smoothstep(10.5, 7.5, abs(vNatWorld.x)) * step(${(FACADE_Z - 0.4).toFixed(2)}, vNatWorld.z);`,
    puddleMask: 'max(smoothstep(0.3, 0.8, vMask2.x), vMask.w * 0.6)',
    vertexPars: 'attribute vec4 aMask; attribute vec2 aMask2; varying vec4 vMask; varying vec2 vMask2;',
    vertexBody: 'vMask = aMask; vMask2 = aMask2;',
    fragmentPars: 'uniform sampler2D uLawnTex; uniform sampler2D uNoiseTex; uniform sampler2D uPebbleTex; uniform vec3 uSpill; uniform float uWaterY; varying vec4 vMask; varying vec2 vMask2;',
    groundFragment: `
  vec2 wuv = vNatWorld.xz;
  // two scales of the same lawn against visible tiling, big patches of lusher and drier grass
  vec3 l1 = texture2D(uLawnTex, wuv * 0.47).rgb, l2 = texture2D(uLawnTex, wuv * 0.13 + vec2(0.37, 0.61)).rgb;
  vec4 nz = texture2D(uNoiseTex, wuv * 0.021), nz2 = texture2D(uNoiseTex, wuv * 0.083 + 0.5);
  vec3 grass = mix(l1, l2, 0.45) * (0.8 + 0.42 * nz.r);
  grass = mix(grass, grass * vec3(1.25, 1.12, 0.62), smoothstep(0.52, 0.82, nz.g) * 0.55);
  // the meadow further out: yellower, with flecks of flowers
  vec3 meadow = grass * vec3(1.16, 1.07, 0.7) * (0.9 + 0.2 * nz2.b);
  float fleck = step(0.83, texture2D(uNoiseTex, wuv * 1.9).a) * 0.5;
  meadow = mix(meadow, vec3(0.62, 0.6, 0.55), fleck * 0.35);
  grass = mix(grass, meadow, vMask.x);
  // mown stripes on the lawn by the house
  grass *= 1.0 + 0.045 * sin(vNatWorld.x * 1.35) * (1.0 - vMask.x);
  // trodden earth beside the path and on the trails, shade under the trees
  grass = mix(grass, grass * vec3(0.95, 0.85, 0.7), vMask.w * 0.5);
  vec3 earth = vec3(0.33, 0.27, 0.19) * (0.82 + 0.36 * nz2.g);
  float bare = smoothstep(0.35, 0.85, vMask2.x + (texture2D(uNoiseTex, wuv * 0.7).b - 0.5) * 0.7);
  grass = mix(grass, mix(grass * vec3(1.02, 0.93, 0.7), earth, bare), vMask2.x * 0.92);
  grass *= 1.0 - 0.5 * vMask.z;
  // the season (seasons.js): fresher in spring, yellowed in autumn, the trodden earth stays as it is
  grass *= mix(vec3(1.0), uGrassTint, 1.0 - bare * vMask2.x);
  // the shore: dark wet earth just above the water, pebbles on the beach by the jetty; below the water the lake bed,
  // sand near the shore, mud further out, dark mud under the reeds
  float above = vNatWorld.y - uWaterY;
  vec3 pebbles = mix(vec3(0.42, 0.37, 0.29), texture2D(uPebbleTex, wuv * 1.25).rgb, 0.7) * (0.92 + 0.2 * nz2.r);
  vec3 mud = vec3(0.12, 0.1, 0.075) * (0.8 + 0.4 * nz2.r);
  float wet = 1.0 - smoothstep(0.0, 0.2, above + (nz.a - 0.5) * 0.12);
  grass = mix(grass, mix(mud * 1.5, grass * 0.6, smoothstep(0.02, 0.12, above)), wet * (1.0 - vMask.y));
  grass = mix(grass, pebbles * mix(1.0, 0.6, wet), vMask.y);
  vec3 bed = mix(vec3(0.34, 0.29, 0.2) * (0.8 + 0.3 * nz2.g), mud, smoothstep(0.1, 1.1, -above));
  bed = mix(bed, pebbles * 0.68, vMask.y * (1.0 - smoothstep(0.25, 0.9, -above)));
  bed = mix(bed, mud * 0.75, vMask2.y);
  grass = mix(grass, bed, smoothstep(0.03, -0.05, above));
  // fallen leaves in autumn: in drifts, thickest under the trees and on the trails, none in the water
  if (uLitter > 0.0) {
    vec4 lt = texture2D(uLitterTex, wuv * 0.42);
    float dens = uLitter * (0.4 + 0.6 * smoothstep(0.05, 0.45, vMask.z) + 0.3 * vMask2.x);
    float lm = lt.a * smoothstep(1.05 - dens, 1.25 - dens, texture2D(uNoiseTex, wuv * 0.06 + 0.21).r + 0.3) * smoothstep(0.02, 0.12, above);
    grass = mix(grass, lt.rgb * 0.8, lm);
  }
  diffuseColor.rgb *= grass;`,
    snowFragment: `
  float drift = texture2D(uNoiseTex, vNatWorld.xz * 0.05).r;
  cover = uSnow * clamp(0.93 + 0.12 * drift - 0.35 * vMask.z - 0.06 * vMask.w - 0.15 * vMask2.x, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.7, uSnow * vMask.z);
  // wet earth and pebbles at the water shine
  roughnessFactor *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.28, vNatWorld.y - uWaterY));
  // the low sun glitters on the snow (nature.js adds it with the sun's direct light: not in a shadow)
  nGlint = step(0.93, texture2D(uNoiseTex, vNatWorld.xz * 3.7 + cameraPosition.xz * 0.03).a) * cover;`,
  });
}

// ---------------------------------------------------------------- far ridges ---------------------------------
/** Tree tops against the sky: dark crowns (firs and round ones) along the upper edge, opaque below. */
function treelineTexture() {
  const W = 1024, H = 128, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), rnd = seeded(404);
  g.fillStyle = '#fff'; g.fillRect(0, H * 0.66, W, H);
  // every shape is drawn three times (x − W, x, x + W): the strip tiles round the ring without a seam
  const thrice = (draw) => { for (const o of [-W, 0, W]) { g.save(); g.translate(o, 0); draw(); g.restore(); } };
  for (let x = 0; x < W;) {
    const top = H * (0.1 + rnd() * 0.38);
    if (rnd() < 0.5) {
      // a fir: a narrow spire with ragged tiers
      const w = 7 + rnd() * 7, base = H * 0.7, tiers = 7, pts = [];
      for (let k = 1; k <= tiers; k++) { const t = k / tiers, y = top + (base - top) * t; pts.push([w * t * (0.85 + rnd() * 0.3), y], [w * t * 0.55, y + 2.5]); }
      thrice(() => { g.beginPath(); g.moveTo(x, top); for (const [dx, y] of pts) g.lineTo(x + dx, y); for (let k = pts.length - 1; k >= 0; k--) g.lineTo(x - pts[k][0], pts[k][1]); g.closePath(); g.fill(); });
      x += w * (0.8 + rnd() * 0.9);
    } else {
      // a round crown of overlapping bumps
      const r = 9 + rnd() * 13, bumps = Array.from({ length: 8 }, () => [(rnd() - 0.5) * r * 1.5, (rnd() - 0.3) * r * 0.7, r * (0.4 + rnd() * 0.35)]);
      thrice(() => { for (const [dx, dy, rr] of bumps) { g.beginPath(); g.arc(x + dx, top + r * 0.7 + dy, rr, 0, Math.PI * 2); g.fill(); } g.fillRect(x - r * 0.75, top + r * 0.9, r * 1.5, H); });
      x += r * (1.0 + rnd() * 0.8);
    }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4;
  return t;
}
const ridgeVert = `
varying vec3 vWorld; varying vec2 vUv;
void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const ridgeFrag = `
uniform vec3 uSunDirW; uniform vec3 uSunLight; uniform vec3 uHazeColor; uniform vec3 uHazeSun; uniform float uHazeDensity; uniform float uHazeMax; uniform float uHazeStart;
${HAZE_GLSL}
uniform sampler2D uLine; uniform vec3 uSkyLight; uniform vec3 uColor; uniform float uSnow; uniform float uReps; uniform vec4 uSeason;
varying vec3 vWorld; varying vec2 vUv;
void main() {
  float a = texture2D(uLine, vec2(vUv.x * uReps, vUv.y)).r;
  if (a < 0.5) discard;
  vec3 V = normalize(vWorld - cameraPosition);
  // the season on the far woods (seasons.js): here and there a broadleaf tree among the firs, fresh in spring, copper
  // and gold in autumn, bare and grey in winter
  float pn = fract(sin(floor(vUv.x * uReps * 7.0) * 12.9898 + 4.1) * 43758.5);
  float broad = step(0.42, pn);
  vec3 base = uColor;
  base = mix(base, base * vec3(1.12, 1.32, 0.85), uSeason.x * broad);
  base = mix(base, mix(vec3(0.12, 0.05, 0.014), vec3(0.15, 0.1, 0.02), fract(pn * 7.0)), uSeason.z * broad * 0.8);
  base = mix(base, vec3(0.05, 0.043, 0.036), uSeason.w * broad);
  vec3 col = mix(base, vec3(0.85, 0.88, 0.92), uSnow * 0.55) * (uSkyLight * 0.9 + uSunLight * max(uSunDirW.y, 0.0) * 0.25) * (0.75 + 0.25 * vUv.y);
  float dist = length(vWorld - cameraPosition);
  col = mix(col, natHazeColor(V), natHazeAmount(dist, 0.0));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------------------------------------------------------------- helpers ---------------------------------
let dotTex = null;
function dotTexture() {
  if (dotTex) return dotTex;
  const N = 64, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
  const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, N, N);
  dotTex = new THREE.CanvasTexture(c); return dotTex;
}
function catenary(a, b, sag, n) {
  const pts = [];
  for (let i = 0; i < n; i++) { const t = i / (n - 1); const p = a.clone().lerp(b, t); p.y -= sag * 4 * t * (1 - t); pts.push(p); }
  return pts;
}
const mtx = new THREE.Matrix4(), quat = new THREE.Quaternion(), UPV = new THREE.Vector3(0, 1, 0), tmpC = new THREE.Color();
/** A stone: a knobbly, flattened icosahedron with its UVs in one quarter of the rock texture. */
function stoneGeometry(s, seed, detail) {
  const rnd = seeded(seed * 7 + 13);
  let g = new THREE.IcosahedronGeometry(0.5, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeClose(g);
  const p = g.attributes.position, flat = 0.55 + rnd() * 0.3, stretch = 0.85 + rnd() * 0.4;
  const bumps = Array.from({ length: 5 }, () => [new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), (rnd() - 0.4) * 0.22]);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let r = 0.5;
    for (const [d, a] of bumps) r += a * Math.max(0, v.dot(d)) ** 2 * 0.5;
    p.setXYZ(i, v.x * r * stretch * s, v.y * r * flat * s, v.z * r * s);
  }
  // box-projected UVs in one quarter of the texture (the quarter gives the stone its tone)
  const uv = new Float32Array(p.count * 2), ou = Math.floor(rnd() * 2) * 0.5, ov = Math.floor(rnd() * 2) * 0.5;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) / s, y = p.getY(i) / s, z = p.getZ(i) / s; uv[i * 2] = ou + (0.5 + x * 0.45 + z * 0.2) * 0.5; uv[i * 2 + 1] = ov + (0.5 + y * 0.45 - z * 0.2) * 0.5; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
/** Weld the vertices an IcosahedronGeometry repeats per face (to bend the stone as one surface). */
function mergeClose(g) {
  const p = g.attributes.position, map = new Map(), verts = [], idx = [];
  for (let i = 0; i < p.count; i++) {
    const key = `${Math.round(p.getX(i) * 1e4)}:${Math.round(p.getY(i) * 1e4)}:${Math.round(p.getZ(i) * 1e4)}`;
    let k = map.get(key);
    if (k === undefined) { k = verts.length / 3; map.set(key, k); verts.push(p.getX(i), p.getY(i), p.getZ(i)); }
    idx.push(k);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  out.setIndex(idx);
  g.dispose();
  return out;
}

export function makeGarden() {
  const group = new THREE.Group(); group.name = 'garden';
  // how long each part took to build (startup-time prints them)
  const steps = {}; let tl = performance.now();
  const lap = (name) => { const t = performance.now(); steps[name] = Math.round(t - tl); tl = t; };
  const rnd = seeded(2032);
  const outdoor = (o, order = 10) => { o.renderOrder = order; return o; };   // after the rooms: their depth hides most of it

  // --- trees ---------------------------------------------------------------------------------------------
  const trees = TREES;
  const templates = new Map();
  const tmpl = (sp, variant, lod) => {
    const key = sp + variant + lod;
    if (!templates.has(key)) templates.set(key, buildTree(sp, 11 + variant * 17 + sp.length, lod));
    return templates.get(key);
  };
  // One BatchedMesh per species and material: a single multi-draw call each for all its templates, every tree outside
  // the view left out on its own (per-instance culling), nearer ones drawn first. Each tree wears its near template up
  // to the end of the band in which the shader turns it into the far one (NATURE.uLodNear … uLodFar, 45 … 70 m; trees.js)
  // and the far template beyond (fewer, larger cards: the same picture), switched as you walk (update()). Nothing pops:
  // where the templates are swapped they look alike.
  const bySpecies = new Map();
  for (const t of trees) {
    const tp = tmpl(t.sp, t.variant, 0);
    t.shade = Math.max(2, (tp.crown.rw || 3) * t.scale * 0.9);
    t.matrix = new THREE.Matrix4().compose(new THREE.Vector3(t.x, terrainHeight(t.x, t.z) - 0.08, t.z), quat.setFromAxisAngle(UPV, t.rot), new THREE.Vector3(t.scale, t.scale * (0.92 + rnd() * 0.16), t.scale));
    const v = 0.86 + rnd() * 0.24;
    t.leafTint = new THREE.Color().setRGB(v * (0.94 + rnd() * 0.12), v, v * (0.85 + rnd() * 0.15));
    t.barkTint = new THREE.Color().setScalar(0.85 + rnd() * 0.25);
    if (!bySpecies.has(t.sp)) bySpecies.set(t.sp, { list: [], variants: new Set() });
    const e = bySpecies.get(t.sp); e.list.push(t); e.variants.add(t.variant);
  }
  const leafMats = new Set(), lodTrees = [];
  for (const [sp, e] of bySpecies) {
    const parts = {};
    for (const part of ['bark', 'leaves']) {
      let verts = 0, idx = 0;
      for (const v of e.variants) for (const lod of [0, 1]) { const g = tmpl(sp, v, lod)[part]; verts += g.attributes.position.count; idx += g.index.count; }
      const mat = part === 'bark' ? barkMaterial(sp) : leafMaterial(sp);
      if (part === 'leaves') leafMats.add(mat);
      const bm = new THREE.BatchedMesh(e.list.length, verts, idx, mat);
      const ids = new Map();
      for (const v of e.variants) ids.set(v, [0, 1].map((lod) => bm.addGeometry(tmpl(sp, v, lod)[part])));
      bm.castShadow = false; bm.receiveShadow = false;   // the sun's shadow map covers only the near garden
      bm.userData.noAO = true; bm.name = sp + '-' + part;
      group.add(outdoor(bm));
      parts[part] = { bm, ids };
    }
    for (const t of e.list) {
      const entry = { x: t.x, z: t.z, lod: 1, parts: [] };
      for (const part of ['bark', 'leaves']) {
        const { bm, ids } = parts[part], gid = ids.get(t.variant), id = bm.addInstance(gid[1]);
        bm.setMatrixAt(id, t.matrix);
        bm.setColorAt(id, part === 'bark' ? t.barkTint : t.leafTint);
        entry.parts.push([bm, id, gid]);
      }
      lodTrees.push(entry);
    }
  }
  let lodTimer = 0, lodNear = 0;
  const lodStats = { switches: 0, last: 0, at: [] };   // (for the checks: swaps so far, in the last update, at which distances)
  /** Near trees on the near template, far ones on the far template; swapped just beyond the band where the shader has
   *  made them alike (with a margin, so a tree at the limit does not flicker). */
  const updateLod = (cx, cz) => {
    lodNear = 0; lodStats.last = 0;
    const far = NATURE.uLodFar.value;
    for (const e of lodTrees) {
      const d = Math.hypot(e.x - cx, e.z - cz), lod = d < far + (e.lod ? 0.5 : 2) ? 0 : 1;
      if (!lod) lodNear++;
      if (lod === e.lod) continue;
      e.lod = lod; lodStats.switches++; lodStats.last++;
      if (lodStats.at.length < 64) lodStats.at.push(+d.toFixed(1));
      for (const [bm, id, gid] of e.parts) bm.setGeometryIdAt(id, gid[lod]);
    }
  };

  lap('trees');
  // --- the ground -----------------------------------------------------------------------------------------
  const { geometry: groundGeo, heightField } = groundGeometry(trees);
  const ground = new THREE.Mesh(groundGeo, groundMaterial());
  // (not in the AO pass: the trees are not in it either, so the darkening at the far hills' edge against the sky lay
  // across the trees in front of them as a grey band, plainly in fog)
  ground.receiveShadow = true; ground.name = 'ground'; ground.userData.noAO = true;
  group.add(outdoor(ground, 11));
  // where things stand on the ground: exactly on its triangles inside the fine part of the grid (and quicker to ask)
  const hf = heightField, onGround = (x, z) => (x > hf.x0 && x < hf.x0 + hf.w && z > hf.z0 && z < hf.z0 + hf.d ? hf.meshAt(x, z) : terrainHeight(x, z));

  lap('ground');
  // --- grass on the lawn, the meadow and round the walkable area --------------------------------------------
  // Clumps in chunks of 12 m: every chunk is culled on its own and left out altogether once it lies further from the
  // camera than the grass fades out (uFadeFar), so the rooms do not pay for the lawn.
  const lawnU = (near, far, snow) => ({ uSnowDepth: { value: snow }, uFadeNear: { value: near }, uFadeFar: { value: far } });
  const grassMaterial = (uniforms) => natureMaterial('grass', { color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide, fog: false }, {
    key: ':lawn', uniforms,
    vertexPars: 'uniform float uFadeNear; uniform float uFadeFar;',
    vertexBody: 'transformed *= smoothstep(uFadeFar, uFadeNear, distance(nBase.xz, cameraPosition.xz));',
  });
  const grassU = lawnU(15, 30, 0.24), grassMat = grassMaterial(grassU);
  const RB = (() => { const b = [Infinity, -Infinity, Infinity, -Infinity]; for (const [x, z] of REGION) { b[0] = Math.min(b[0], x); b[1] = Math.max(b[1], x); b[2] = Math.min(b[2], z); b[3] = Math.max(b[3], z); } return b; })();
  const clumps = [];
  for (let i = 0; i < 120000 && clumps.length < 26000; i++) {
    const x = RB[0] - 14 + rnd() * (RB[1] - RB[0] + 28), z = -24 + rnd() * (RB[3] + 14 + 24);
    if (z < 9.85 && x > DECK.x0 - 0.15 && x < DECK.x1 + 0.15 && z > FACADE_Z - 0.5) continue;              // the deck
    if (Math.abs(x) < HALL.x1 + HALL.wall + 0.1 && z < FACADE_Z + 0.05 && z > HALL.z0 - 0.5) continue;      // the house
    if (Math.abs(x) < ROOM.x1 + 0.5 && z < ROOM.z1 + 0.6 && z > ROOM.z0 - 0.5) continue;
    if (Math.abs(x) < PASSAGE.w / 2 + 0.6 && z < HALL.z0 && z > ROOM.z1) continue;
    const inside = inRegion(x, z);
    // the walkable area full, a band of 14 m round it and the lawn beside the house thinner
    const dens = inside ? 1 : z < FACADE_Z ? (Math.abs(x) < 34 ? 0.45 : 0) : 0.55;
    if (rnd() > dens) continue;
    if (!inside && z >= FACADE_Z && !nearRegion(x, z)) continue;
    if (pathDist(x, z) < 0.95 || onJetty(x, z)) continue;
    // (down to the water's edge: the grass meets the water, only the beach is bare)
    const above = onGround(x, z) - WATER_Y;
    if (above < 0.035 || (above < 0.6 && beachWeight(x, z) > 0.3)) continue;
    const tr = trailDist(x, z);
    if (tr < 0.55 && rnd() < 0.85) continue;
    if (obstaclesNear(x, z, 0.05).length) continue;
    // (round the fire bowl the grass is trodden away, a few tufts are left)
    if (fireRing(x, z) > 0.55 && ((x * 7.31 + z * 3.17) % 1 + 1) % 1 < 0.88) continue;
    const meadow = smooth(3, 26, keepDist(x, z));
    clumps.push([x, z, meadow, tr < 1.0 ? 0.5 : 1]);
  }
  function nearRegion(x, z) { const b = 14; if (x < RB[0] - b || x > RB[1] + b || z > RB[3] + b) return false; for (let k = 0, j = REGION.length - 1; k < REGION.length; j = k++) { const [ax, az] = REGION[j], [cx, cz] = REGION[k]; const ex = cx - ax, ez = cz - az, l2 = ex * ex + ez * ez || 1e-9, t = clamp(((x - ax) * ex + (z - az) * ez) / l2, 0, 1); if ((ax + ex * t - x) ** 2 + (az + ez * t - z) ** 2 < b * b) return true; } return false; }
  const grassGeo = grassClumpGeometry({ blades: 6, h: 0.2, spread: 0.085, width: 0.013, bend: 0.45, seed: 5, segs: 2 });
  const chunked = (list, CH, make) => {
    const map = new Map();
    for (const c of list) { const k = Math.floor(c[0] / CH) + ':' + Math.floor(c[1] / CH); if (!map.has(k)) map.set(k, []); map.get(k).push(c); }
    return [...map.values()].map(make);
  };
  const grassChunks = chunked(clumps, 12, (list) => {
    const m = new THREE.InstancedMesh(grassGeo, grassMat, list.length);
    list.forEach(([x, z, meadow, trod], i) => {
      const hS = ((0.55 + rnd() * 0.3) * (1 - meadow) + (1.3 + rnd() * 1.0) * meadow) * trod;
      mtx.compose(new THREE.Vector3(x, onGround(x, z), z), quat.setFromAxisAngle(UPV, rnd() * 6.28), new THREE.Vector3(1, hS, 1));
      m.setMatrixAt(i, mtx);
      const dry = rnd() < 0.06 + meadow * 0.22 ? 1 : 0, v = 0.85 + rnd() * 0.3;
      m.setColorAt(i, dry ? tmpC.setRGB(0.3 * v, 0.3 * v, 0.12 * v) : tmpC.setRGB(0.12 * v, 0.24 * v, 0.05 * v));
    });
    m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
    m.castShadow = false; m.receiveShadow = true; m.userData.noAO = true; m.userData.full = list.length;
    m.computeBoundingSphere();
    group.add(outdoor(m, 12));
    return m;
  });
  let grassShare = 1;

  lap('grass');
  // --- water lilies on the lake, reeds and cattails along its shore (lilies.js, reeds.js) ----------------------------
  const lilies = makeLilies();
  group.add(lilies.group);
  const reeds = makeReeds(lilies.pads);
  group.add(reeds.group);

  lap('reeds');
  // --- the lake (water.js) -------------------------------------------------------------------------------------
  const water = makeWater();
  group.add(water.mesh);

  lap('water');
  // --- stones on the shore, the meadow and the knoll: one merged mesh (the deck's shader) -----------------------
  const rock = rockTexture();
  const stoneMat = natureMaterial('plain', { map: rock.map, normalMap: rock.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), color: 0xffffff, roughness: 0.92, fog: false });
  {
    const parts = new Parts();
    for (const s of STONES) {
      const g = stoneGeometry(s.s, s.seed, s.pebble ? 0 : 1);
      const y = onGround(s.x, s.z) - s.sink;
      parts.addMatrix(g, stoneMat, new THREE.Matrix4().compose(new THREE.Vector3(s.x, y + s.s * 0.18, s.z), quat.setFromAxisAngle(UPV, s.seed * 2.39), new THREE.Vector3(1, 1, 1)));
      g.dispose();
    }
    const stones = parts.build({ name: 'stones' });
    stones.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; outdoor(o, 12); } });
    group.add(stones);
  }

  lap('stones');
  // --- the jetty: boards across two beams on posts in the water, a platform at its end ------------------------------
  {
    const J = JETTY, wood = weatheredWood('jetty'), steel = outdoorSteel();
    const parts = new Parts(), jr = seeded(77);
    const at = (along, across, y) => { const [x, z] = J.at(along, across); return new THREE.Vector3(x, y, z); };
    const rotY = new THREE.Quaternion().setFromAxisAngle(UPV, J.yaw);
    const put = (geo, along, across, y, extra = null) => {
      const q = extra ? rotY.clone().multiply(extra) : rotY;
      parts.addMatrix(geo, wood, new THREE.Matrix4().compose(at(along, across, y), q, new THREE.Vector3(1, 1, 1)));
    };
    const boardT = 0.036, top = J.top, walk = J.len - J.platLen;
    // the boards, each a little different (its own piece of the texture, slightly warped)
    for (let s = 0.08; s < J.len - 0.05; s += 0.152) {
      const w = s > walk ? J.platWidth : J.width;
      const g = new THREE.BoxGeometry(w, boardT, 0.138), uv = g.attributes.uv, ou = jr(), ov = jr();
      for (let i = 0; i < uv.count; i++) uv.setXY(i, ou + uv.getX(i) * w / 1.45, ov + uv.getY(i) * 0.095);
      put(g, s, (jr() - 0.5) * 0.02, top - boardT / 2 - jr() * 0.006, new THREE.Quaternion().setFromEuler(new THREE.Euler((jr() - 0.5) * 0.012, (jr() - 0.5) * 0.01, (jr() - 0.5) * 0.02)));
      g.dispose();
    }
    // two beams under the walk, a frame under the platform
    const beam = (len, along, across) => { const g = new THREE.BoxGeometry(0.09, 0.14, len); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.2, uv.getY(i) * len / 1.45); put(g, along, across, top - boardT - 0.07); g.dispose(); };
    for (const s of [-1, 1]) beam(walk + 0.2, walk / 2, s * (J.width / 2 - 0.16));
    for (const s of [-1, 1]) beam(J.platLen, walk + J.platLen / 2, s * (J.platWidth / 2 - 0.12));
    {
      const g = new THREE.BoxGeometry(J.platWidth, 0.14, 0.09);
      for (const along of [walk + 0.05, J.len - 0.05]) put(g, along, 0, top - boardT - 0.07);
      g.dispose();
    }
    // posts: in pairs along the walk, at the corners of the platform, down into the lake bed
    const post = (along, across, r, above = 0) => {
      const p = at(along, across, 0), bed = terrainHeight(p.x, p.z) - 0.35, y1 = top - boardT + above, h = y1 - bed;
      const g = new THREE.CylinderGeometry(r * 0.92, r, h, 9);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.4, uv.getY(i) * h / 1.45);
      parts.addMatrix(g, wood, new THREE.Matrix4().compose(new THREE.Vector3(p.x, bed + h / 2, p.z), quat.identity(), new THREE.Vector3(1, 1, 1)));
      g.dispose();
      return p;
    };
    for (let s = 1.0; s < walk; s += 2.0) for (const c of [-1, 1]) post(s, c * (J.width / 2 - 0.16), 0.075);
    for (const along of [walk + 0.15, J.len - 0.15]) for (const c of [-1, 1]) post(along, c * (J.platWidth / 2 - 0.12), 0.085);
    // mooring posts standing up at the outer corners, a ladder down into the water at the end
    for (const c of [-1, 1]) { const p = post(J.len - 0.16, c * (J.platWidth / 2 - 0.16), 0.11, 0.62); addObstacle(p.x, p.z, 0.13, 'post'); }
    const ladder = new Parts();
    const lp = (along, across, y) => at(along, across, y);
    for (const c of [-0.24, 0.24]) {
      const a = lp(J.len - 0.05, c, top + 0.55), b = lp(J.len + 0.12, c, top + 0.62), d = lp(J.len + 0.16, c, WATER_Y - 0.9);
      for (const [p0, p1] of [[a, b], [b, d]]) {
        const len = p0.distanceTo(p1), g = new THREE.CylinderGeometry(0.018, 0.018, len, 8);
        ladder.addMatrix(g, steel, new THREE.Matrix4().compose(p0.clone().add(p1).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UPV, p1.clone().sub(p0).normalize()), new THREE.Vector3(1, 1, 1)));
        g.dispose();
      }
      const foot = lp(J.len - 0.05, c, top - 0.02), g = new THREE.CylinderGeometry(0.022, 0.022, 0.57, 8);
      ladder.addMatrix(g, steel, new THREE.Matrix4().compose(foot.clone().setY(top + 0.265), quat.identity(), new THREE.Vector3(1, 1, 1))); g.dispose();
    }
    for (let k = 0; k < 4; k++) {
      const y = top - 0.25 - k * 0.3, a = lp(J.len + 0.15, -0.24, y), b = lp(J.len + 0.15, 0.24, y), g = new THREE.CylinderGeometry(0.014, 0.014, 0.48, 8);
      ladder.addMatrix(g, steel, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UPV, b.clone().sub(a).normalize()), new THREE.Vector3(1, 1, 1))); g.dispose();
    }
    const jetty = parts.build({ name: 'jetty' }), lad = ladder.build({ name: 'jetty-ladder' });
    for (const o of [jetty, lad]) o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.userData.noAO = true; outdoor(m, 12); } });
    group.add(jetty, lad);
  }

  lap('jetty');
  // --- the fence along the meadow in the east: posts and two split rails following the ground -----------------------
  {
    const parts = new Parts(), wood = weatheredWood(), fr = seeded(31);
    const pts = [];
    for (let k = 0; k < FENCE_LINE.length - 1; k++) {
      const [ax, az] = FENCE_LINE[k], [bx, bz] = FENCE_LINE[k + 1], len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 2.4));
      for (let i = 0; i < n; i++) pts.push([ax + (bx - ax) * i / n, az + (bz - az) * i / n]);
    }
    pts.push(FENCE_LINE[FENCE_LINE.length - 1]);
    const tops = pts.map(([x, z]) => new THREE.Vector3(x, onGround(x, z), z));
    tops.forEach((p, i) => {
      const h = 1.12 + (fr() - 0.5) * 0.08, g = new THREE.BoxGeometry(0.11, h + 0.25, 0.11), uv = g.attributes.uv;
      for (let n = 0; n < uv.count; n++) uv.setXY(n, fr() * 0.3 + uv.getX(n) * 0.08, uv.getY(n) * (h + 0.25) / 1.45);
      parts.addMatrix(g, wood, new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y + h / 2 - 0.12, p.z), quat.setFromAxisAngle(UPV, (fr() - 0.5) * 0.3), new THREE.Vector3(1, 1, 1)));
      g.dispose();
      if (i === 0) return;
      const q = tops[i - 1];
      for (const y of [0.42, 0.86]) {
        const a = q.clone().setY(q.y + y + (fr() - 0.5) * 0.04), b = p.clone().setY(p.y + y + (fr() - 0.5) * 0.04), len = a.distanceTo(b) + 0.16;
        const rail = new THREE.BoxGeometry(0.075, 0.1, len), ruv = rail.attributes.uv;
        for (let n = 0; n < ruv.count; n++) ruv.setXY(n, fr() * 0.3 + ruv.getX(n) * 0.1, ruv.getY(n) * len / 1.45);
        const dir = b.clone().sub(a).normalize(), rq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (fr() - 0.5) * 0.5));
        parts.addMatrix(rail, wood, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), rq, new THREE.Vector3(1, 1, 1)));
        rail.dispose();
      }
    });
    const fence = parts.build({ name: 'fence' });
    fence.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.userData.noAO = true; outdoor(m, 12); } });
    group.add(fence);
  }

  lap('fence');
  // --- the far ridges: bands of wood that fade into the haze ------------------------------------------------------
  const lineTex = treelineTexture();
  const ridges = [];
  for (const [radius, height, color] of [[158, 30, 0x2c3b2a], [196, 40, 0x34422f], [228, 46, 0x3d4a3c]]) {
    const reps = Math.round((2 * Math.PI * radius * 128) / (1024 * height));   // the texture's proportions: trees as wide as they are tall
    const geo = new THREE.CylinderGeometry(radius, radius, height, 160, 1, true);
    const p = geo.attributes.position, prof = seeded(radius);
    const heights = Array.from({ length: 161 }, () => 0.45 + prof() * 0.55);
    for (let i = 0; i < 12; i++) for (let k = 0; k < 161; k++) heights[k] = (heights[k] + heights[(k + 1) % 161] + heights[(k + 160) % 161]) / 3;   // smooth hills
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0) {
        const ang = Math.atan2(p.getZ(i), p.getX(i)), k = Math.round(((ang + Math.PI) / (Math.PI * 2)) * 160) % 161;
        p.setY(i, height * (heights[k] - 0.5));
      } else p.setY(i, -height * 0.5);
    }
    const u = { uLine: { value: lineTex }, uSkyLight: NATURE.uSkyLight, uColor: { value: new THREE.Color(color) }, uSnow: NATURE.uSnow, uReps: { value: reps }, uSeason: NATURE.uSeason, uSunDirW: NATURE.uSunDirW, uSunLight: NATURE.uSunLight, uHazeColor: NATURE.uHazeColor, uHazeSun: NATURE.uHazeSun, uHazeDensity: NATURE.uHazeDensity, uHazeMax: NATURE.uHazeMax, uHazeStart: NATURE.uHazeStart };
    const mat = new THREE.ShaderMaterial({ vertexShader: ridgeVert, fragmentShader: ridgeFrag, uniforms: u, side: THREE.BackSide, fog: false });
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(0, height * 0.5 + 2, 6);
    mesh.userData.noAO = true; ridges.push(mesh); group.add(outdoor(mesh, 20));
  }

  // --- the deck, the house's plinth and roof edge ------------------------------------------------------------------
  const boards = plankTexture({ tone: 'oak' });   // the floor's boards, greyed by the weather
  const deckMat = natureMaterial('plain', { map: boards.map, normalMap: boards.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), color: 0xb3aa9c, roughness: 0.88, fog: false }, { puddles: 0.4, litter: 0.3, snowStyle: 'deck' });
  const dw = DECK.x1 - DECK.x0, dd = DECK.z1 - DECK.z0;
  const deckGeo = new THREE.BoxGeometry(dw, 0.16, dd);
  { const uv = deckGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * dw / 1.45, uv.getY(i) * dd / 1.45); }
  const deck = new THREE.Mesh(deckGeo, deckMat); deck.position.set((DECK.x0 + DECK.x1) / 2, -0.08, (DECK.z0 + DECK.z1) / 2); deck.receiveShadow = true; deck.castShadow = true;
  group.add(deck);
  const shell = natureMaterial('plain', { color: 0x9c968c, roughness: 0.9, fog: false });
  const hx = HALL.x1 + HALL.wall, hz0 = HALL.z0 - HALL.wall;
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(hx * 2 + 0.1, 0.5, FACADE_Z - hz0 + 0.1), shell); plinth.position.set(0, -0.255, (FACADE_Z + hz0) / 2);
  const roofMat = natureMaterial('plain', { color: 0x3a3a3a, roughness: 0.6, metalness: 0.3, fog: false });
  // the roofs lie 4 cm above the ceilings: flush, their undersides fought with the ceilings and blacked them out
  const roof = new THREE.Mesh(new THREE.BoxGeometry(hx * 2 + 0.5, 0.34, FACADE_Z - hz0 + 0.5), roofMat); roof.position.set(0, HALL.h + 0.04 + 0.17, (FACADE_Z + hz0) / 2);
  const roofRoom = new THREE.Mesh(new THREE.BoxGeometry(ROOM.x1 - ROOM.x0 + 1.2, 0.34, ROOM.z1 - ROOM.z0 + 1.2), roofMat); roofRoom.position.set(0, ROOM.h + 0.04 + 0.17, (ROOM.z0 + ROOM.z1) / 2);
  // the passage roof spans only the gap between the hall and the book room and reaches 5 cm into both walls: as long as
  // the whole passage, its dark ends lay in the inner faces of the walls and z-fought with the plaster beside the casing
  // tops (black, dithered patches at their upper corners, in the hall and in the book room)
  const roofPass = new THREE.Mesh(new THREE.BoxGeometry(PASSAGE.w + 1.2, 0.3, PASSAGE.z1 - PASSAGE.z0 - 2 * HALL.wall + 0.1), roofMat); roofPass.position.set(PASSAGE.x, PASSAGE.h + 0.04 + 0.15, (PASSAGE.z0 + PASSAGE.z1) / 2);
  // the roofs keep the low sun out of the rooms (the ceilings cast no shadow: over the walls it shone through them)
  for (const m of [plinth, roof, roofRoom, roofPass]) { m.receiveShadow = true; m.castShadow = true; m.userData.noAO = true; group.add(m); }

  // --- the path --------------------------------------------------------------------------------------------------
  {
    const pv = [], pu = [], pi = [], N = 110, half = 0.72;
    for (let i = 0; i <= N; i++) {
      const t = i / N, p = PATH.getPoint(t), tan = PATH.getTangent(t), side = new THREE.Vector3(tan.z, 0, -tan.x).normalize();
      for (const s of [-1, 1]) { const x = p.x + side.x * half * s, z = p.z + side.z * half * s; pv.push(x, onGround(x, z) + 0.025, z); pu.push(s * 0.5 + 0.5, t * 46); }
      if (i < N) { const a = i * 2; pi.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(pv, 3)); pg.setAttribute('uv', new THREE.Float32BufferAttribute(pu, 2)); pg.setIndex(pi); pg.computeVertexNormals();
    const pm = natureMaterial('plain', { map: gravelTexture(), color: 0xd8d0c2, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, fog: false }, { puddles: 1, litter: 0.9, snowStyle: 'path' });
    const path = new THREE.Mesh(pg, pm); path.receiveShadow = true; path.name = 'path'; group.add(outdoor(path, 12));
  }

  // --- string lights: from the glass front out to the posts, a warm bulb every 30 cm, and along the deck's edge -------
  const black = outdoorSteel();
  const bulbs = [], cablePts = [];
  const postTop = 2.72, anchorY = 3.4;
  const posts = new Parts();
  for (const x of TERRACE.posts) {
    posts.add(new THREE.CylinderGeometry(0.035, 0.045, 2.8, 10), black, [x, 1.4, TERRACE.postZ]);
    const a = new THREE.Vector3(x * 0.72, anchorY, FACADE_Z + 0.03), b = new THREE.Vector3(x, postTop, TERRACE.postZ);
    const pts = catenary(a, b, 0.3, 14);
    for (let i = 0; i < pts.length - 1; i++) cablePts.push(pts[i], pts[i + 1]);
    for (let i = 1; i < pts.length - 1; i++) bulbs.push(pts[i].clone().add(new THREE.Vector3(0, -0.05, 0)));
  }
  group.add(posts.build({ name: 'posts' }));
  const edge = TERRACE.posts;
  for (let k = 0; k < edge.length - 1; k++) {
    const a = new THREE.Vector3(edge[k], postTop, TERRACE.postZ), b = new THREE.Vector3(edge[k + 1], postTop, TERRACE.postZ);
    const pts = catenary(a, b, Math.abs(edge[k + 1] - edge[k]) * 0.06, Math.round(Math.abs(edge[k + 1] - edge[k]) / 0.32));
    for (let i = 0; i < pts.length - 1; i++) cablePts.push(pts[i], pts[i + 1]);
    for (let i = 1; i < pts.length - 1; i++) bulbs.push(pts[i].clone().add(new THREE.Vector3(0, -0.05, 0)));
  }
  const cable = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(cablePts), new THREE.LineBasicMaterial({ color: 0x1a1a1a }));
  group.add(cable);
  // clear glass with a warm filament: pale by day, glowing at night
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xd6d3cc, emissive: 0xffc877, emissiveIntensity: 1, roughness: 0.12, metalness: 0.2, fog: false });
  const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.022, 10, 8), bulbMat, bulbs.length);
  bulbs.forEach((p, i) => bulbMesh.setMatrixAt(i, mtx.makeTranslation(p.x, p.y, p.z)));
  bulbMesh.instanceMatrix.needsUpdate = true; bulbMesh.castShadow = false; bulbMesh.computeBoundingSphere(); bulbMesh.userData.noAO = true;
  group.add(bulbMesh);
  // their halo in the evening air
  const haloGeo = new THREE.BufferGeometry().setFromPoints(bulbs);
  const haloMat = new THREE.PointsMaterial({ size: 0.34, map: dotTexture(), color: 0xffc27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const halos = new THREE.Points(haloGeo, haloMat); halos.frustumCulled = false; group.add(halos);

  // lanterns on the deck: a black frame, glowing glass and a pool of light around them at night (all four in three
  // meshes: frames, glass, pools)
  const lanternGlass = new THREE.MeshStandardMaterial({ color: 0xfff3dc, emissive: 0xffc071, emissiveIntensity: 1, roughness: 0.4, transparent: true, opacity: 0.85, fog: false });
  const poolMat = new THREE.MeshBasicMaterial({ map: dotTexture(), color: 0xffb866, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const lp = new Parts(), lg = new Parts(), lpool = new Parts();
  for (const [x, z] of TERRACE.lanterns) {
    for (const y of [0.012, 0.37]) lp.add(new THREE.BoxGeometry(0.22, 0.024, 0.22), black, [x, y, z]);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) lp.add(new THREE.BoxGeometry(0.016, 0.36, 0.016), black, [x + sx * 0.1, 0.19, z + sz * 0.1]);
    lp.add(new THREE.ConeGeometry(0.16, 0.1, 4), black, [x, 0.43, z], [0, Math.PI / 4, 0]);
    lg.add(new THREE.BoxGeometry(0.19, 0.33, 0.19), lanternGlass, [x, 0.19, z]);
    lpool.add(new THREE.PlaneGeometry(1.6, 1.6), poolMat, [x, 0.006, z], [-Math.PI / 2, 0, 0]);
  }
  const lanterns = new THREE.Group(); lanterns.name = 'lanterns';
  lanterns.add(lp.build({ name: 'lantern-frames' }), lg.build({ name: 'lantern-glass', castShadow: false }), lpool.build({ name: 'lantern-pools', castShadow: false, receiveShadow: false }));
  lanterns.traverse((o) => { if (o.isMesh) { o.userData.noAO = true; if (o.material === poolMat) o.renderOrder = 2; } });
  group.add(lanterns);
  // a real light for the deck at night (constant count: always there, dark by day)
  const deckLight = new THREE.PointLight(0xffc27a, 0, 10, 1.4); deckLight.position.set(0, 2.5, 8.0); group.add(deckLight);

  lap('house');
  // --- meadow flowers: drifts of one kind each, as on a real meadow (seasons.js colours them by the season) -------------
  const fl = [], fc = [], patch = [], flowerCols = [0xffffff, 0xf4d35e, 0xe58fb1, 0xa98bd8, 0xf2a65a, 0xffffff].map((c) => new THREE.Color(c));
  const noFlower = (x, z, y) => keepDist(x, z) < 6 || y < WATER_Y + 0.25 || pathDist(x, z) < 1.2 || trailDist(x, z) < 0.8 || onJetty(x, z) || (y < WATER_Y + 0.6 && beachWeight(x, z) > 0.1) || fireRing(x, z) > 0.2;
  for (let k = 0, made = 0; k < 4000 && made < 560; k++) {
    const cx = (rnd() - 0.5) * 120, cz = -10 + rnd() * 92;
    if (noFlower(cx, cz, onGround(cx, cz))) continue;
    const n = 6 + Math.floor(rnd() * 18), spread = 0.5 + rnd() * 1.3, c = flowerCols[Math.floor(rnd() * flowerCols.length)];
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.283, r = Math.sqrt(rnd()) * spread, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, y = onGround(x, z);
      if (noFlower(x, z, y)) continue;
      // (on the meadow above its taller grass, where they are seen)
      fl.push(x, y + 0.16 + rnd() * 0.12 + smooth(3, 26, keepDist(x, z)) * 0.14, z); fc.push(c.r, c.g, c.b); patch.push(made);
    }
    made++;
  }
  const flowerGeo = new THREE.BufferGeometry(); flowerGeo.setAttribute('position', new THREE.Float32BufferAttribute(fl, 3)); flowerGeo.setAttribute('color', new THREE.Float32BufferAttribute(fc, 3));
  flowerGeo.userData.patch = Uint16Array.from(patch);   // the drift each flower belongs to (seasons.js)
  const flowerMat = new THREE.PointsMaterial({ size: 0.12, vertexColors: true, sizeAttenuation: true, map: dotTexture(), alphaTest: 0.35, transparent: false, fog: false });
  const flowers = new THREE.Points(flowerGeo, flowerMat); flowers.frustumCulled = false; group.add(outdoor(flowers, 13));

  // --- fireflies over the lawn and the meadow at night ------------------------------------------------------------------
  const FF = 110, ffPos = new Float32Array(FF * 3), ffSeed = [];
  for (let i = 0; i < FF; i++) { const x = (rnd() - 0.5) * 40, z = 12 + rnd() * 30; ffSeed.push([x, z, 0.25 + rnd() * 1.4, rnd() * 10, onGround(x, z)]); }
  const ffGeo = new THREE.BufferGeometry(); ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
  const ffMat = new THREE.PointsMaterial({ size: 0.16, color: 0xe9ff9a, map: dotTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const fireflies = new THREE.Points(ffGeo, ffMat); fireflies.frustumCulled = false; group.add(fireflies);

  // --- the fire bowl's fire (firebowl.js; the bowl and the stumps are placements of layout.js) --------------------------
  const fire = new FireBowl();
  group.add(fire.group);

  // --- the seasons: blossom, autumn colours, fallen and falling leaves, snow, the lilies, the meadow (seasons.js) ------
  const seasons = new Seasons({ lilies, water, flowers: { geo: flowerGeo, points: flowers }, fruitMaterial: leafMaterial('fruit') });
  group.add(seasons.group);
  seasons.set('auto', { instant: true });

  lap('rest');
  return {
    group, steps,
    trees,          // [{ x, z, sp, … }]: where the trees stand (outdoor.js TREES; the checks walk round them)
    lilies, reeds, seasons,
    lilyPads: lilies.lilyPads,   // the lily pads as drawn, [{ x, z, y, r }], kept up to date with the season: the frogs sit on them
    fireBowl: fire, // the fire in the bowl west of the lawn (firebowl.js; world.fireBowl)
    /** The trees' levels of detail (for the checks): the morph band, the swaps so far, the entries. */
    lod: { get near() { return NATURE.uLodNear.value; }, get far() { return NATURE.uLodFar.value; }, stats: lodStats, trees: lodTrees, update: (x, z) => updateLod(x, z) },
    /** The season setting ('auto' | 'spring' | 'summer' | 'autumn' | 'winter'); returns the season it means. */
    setSeason(setting, opts) { return seasons.set(setting, opts); },
    heightField,    // the ground's heights over the fine part of the grid: the rain and the snow end on it
    water,
    outdoor: OUTDOOR,   // the walkable area, the zones, the obstacles (outdoor.js; for the checks)
    get nearTrees() { return lodNear; },   // trees drawn with their detailed template now
    template: (sp, variant, lod = 0) => tmpl(sp, variant, lod),   // the template a tree is drawn with (birds.js: perches)
    /** Night glow, snow, rain; the sky and its light are set by environment.js through NATURE / SKY. */
    apply({ night, weather, treeLine, lamps = 0, mix = null }) {
      // (mix: the weather's continuous parts, sky-state.js; without it the old word decides)
      const snow = mix ? mix.cover > 0.5 : weather === 'snow';
      water.apply({ weather, mix });
      water.setTreeLine(treeLine);
      // (the season decides on the meadow's flowers, the snow, the bare trees, the lilies: seasons.js)
      seasons.apply({ night, weather });
      fire.apply({ night, weather, wind: NATURE.uWind.value });
      // the flowers are dots of colour without a shader of their own: as light as the day (at night they were glowing)
      flowerMat.color.setScalar(0.08 + 0.92 * clamp(1 - night, 0, 1));
      // in fog the far wooded ridges are gone
      for (const r of ridges) r.visible = mix ? mix.fog < 0.9 : weather !== 'fog';
      // (lamps: on softly while the sun is low, the golden hour: environment.js)
      const glow = Math.max(clamp((night - 0.25) / 0.6, 0, 1), lamps);
      bulbMat.emissiveIntensity = 0.06 + 2.6 * glow;
      haloMat.opacity = 0.55 * glow;
      lanternGlass.emissiveIntensity = 0.3 + 1.7 * glow;
      poolMat.opacity = 0.32 * glow;
      deckLight.intensity = 2.2 * glow;
      SPILL.value.setRGB(1.0, 0.72, 0.45).multiplyScalar(0.55 * glow);
      const wet = mix ? mix.rain > 0.05 || mix.snow > 0.05 : weather === 'rain' || weather === 'storm';
      // (the fireflies of summer nights: fewer in late spring, none in autumn and winter)
      const flies = seasons.target.y + 0.5 * seasons.target.x;
      ffMat.userData.target = snow || wet ? 0 : 0.85 * clamp((night - 0.55) / 0.35, 0, 1) * flies;
    },
    /** q: 'high' | 'medium' | 'low'; opts.mobile (the quality 'mobile', drawn as 'low'): the trees' far level from
     *  25 m on (the shader's band 25 … 40 m instead of 45 … 70 m, updateLod follows uLodFar). The far level is the
     *  same tree with fewer, larger cards. */
    setQuality(q, opts = {}) {
      const [near, far] = opts.mobile ? [25, 40] : [45, 70];
      if (NATURE.uLodNear.value !== near || NATURE.uLodFar.value !== far) { NATURE.uLodNear.value = near; NATURE.uLodFar.value = far; lodTimer = 0; }
      grassShare = { high: 1, medium: 0.5, low: 0 }[q] ?? 1;
      for (const m of grassChunks) m.count = Math.round(m.userData.full * grassShare);
      reeds.setQuality(q);
      // 'low' draws straight onto the canvas: soft foliage edges would leave its alpha below 1 there (see world.js)
      for (const m of leafMats) { const a2c = q !== 'low'; if (m.alphaToCoverage !== a2c) { m.alphaToCoverage = a2c; m.needsUpdate = true; } }
    },
    update(dt, time, camera) {
      if (camera) {
        const cx = camera.position.x, cz = camera.position.z;
        lodTimer -= dt;
        if (lodTimer <= 0) { lodTimer = 0.25; updateLod(cx, cz); }
        const cull = (list, far, on) => { for (const m of list) { const b = m.boundingSphere; m.visible = on && Math.hypot(b.center.x - cx, b.center.z - cz) - b.radius < far; } };
        cull(grassChunks, grassU.uFadeFar.value, grassShare > 0);
        reeds.update(camera);
      }
      lilies.update(dt);
      fire.update(dt, time);
      seasons.update(dt, time, camera);
      ffMat.opacity += ((ffMat.userData.target || 0) - ffMat.opacity) * Math.min(1, dt * 0.8);
      fireflies.visible = ffMat.opacity > 0.01;
      if (!fireflies.visible) return;
      for (let i = 0; i < FF; i++) {
        const [x, z, y, ph, g] = ffSeed[i], t = time * 0.35 + ph;
        ffPos[i * 3] = x + Math.sin(t * 0.9) * 1.6 + Math.sin(t * 2.3) * 0.3;
        ffPos[i * 3 + 1] = g + y + Math.sin(t * 1.7) * 0.25;
        ffPos[i * 3 + 2] = z + Math.cos(t * 0.7) * 1.4;
      }
      ffGeo.attributes.position.needsUpdate = true;
      ffMat.size = 0.15 + Math.sin(time * 3.1) * 0.03;
    },
  };
}
