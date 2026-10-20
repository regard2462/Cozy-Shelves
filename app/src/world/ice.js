// The lake frozen over in winter: a sheet of ice to walk on, from the shore and from the end of the jetty, with snow
// lying on it in drifts that the wind laid across the lake and heaped along the banks, milky white ice and dark clear ice
// where it swept the snow away, long cracks, air bubbles frozen in at different depths, and in the bare ice the sky and
// the trees of the far shore as a soft, blurred sheen (a rougher mirror than water). The ice is a mesh of its own over
// the lake's surface (water.js's rings), a 'ground' material of nature.js: lit, shadowed (the jetty, the trees) and
// faded into the haze like the snow round it, and the prints of whoever walks on it (tracks.js) show faintly in its
// thin snow. It fades in with the winter (seasons.js NATURE.uSeason) and hides the water while it lies.
//   Walking: only in winter (the season, not a snowfall in another season: that ice is thin). The walkable area then
// takes in the lake up to its far shore; the reeds frozen in it, the stones and the jetty's ladder stand in the way, the
// jetty itself is a wall from the ice wherever its boards are more than a step above it (a jump gets you up). On the ice
// the feet find little grip (gripAt: player.js starts and stops slowly, a turn drifts), a little more on its snow.
import * as THREE from 'three';
import { natureMaterial, noiseTexture } from './nature.js';
import { SKY } from './sky.js';
import {
  WATER_Y, terrainHeight, shorePoint, lakeAngle, JETTY, onJetty, HOUSE, inPolygon, obstaclesNear, STONES, EAST_EDGE,
  NORTH_EDGE, WEST_EDGE, outside, REGION, keepInside,
} from './outdoor.js';

/** The top of the ice: the lake's surface. */
export const ICE_Y = WATER_Y;
const STEP_UP = 0.2;           // player.js: what you step onto without a jump
const deg = Math.PI / 180;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Where you can walk in winter, one polygon (counter-clockwise, [x, z]): the garden's area (outdoor.js REGION) up to the
 * water's edge of the far shore instead of the near one, the lake and the jetty inside it.
 */
export const ICE_REGION = (() => {
  const pts = [[-8.8, 4.0], [8.8, 4.0], ...EAST_EDGE, ...NORTH_EDGE.slice(1)];
  // (from where the edge of the wood meets the water, as REGION, the other way round the lake)
  const a0 = lakeAngle(...NORTH_EDGE[NORTH_EDGE.length - 1]) - 3 * deg, a1 = lakeAngle(...WEST_EDGE[0]) + 2 * Math.PI;
  for (let a = a0; a < a1; a += 2 * deg) pts.push(shorePoint(a, 0.0));
  pts.push(...WEST_EDGE);
  return pts;
})();
/** The nearest point on a polygon's outline: [x, z, distance]. */
function nearestOnOutline(poly, x, z) {
  let best = Infinity, bx = 0, bz = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j][0], az = poly[j][1], ex = poly[i][0] - ax, ez = poly[i][1] - az, l2 = ex * ex + ez * ez || 1e-9;
    const t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / l2)), px = ax + ex * t, pz = az + ez * t, d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < best) { best = d; bx = px; bz = pz; }
  }
  return [bx, bz, Math.sqrt(best)];
}
/** Over the lake (not on the jetty): where the ice is under the feet. */
export const overIce = (x, z) => !onJetty(x, z) && terrainHeight(x, z) < ICE_Y - 0.01;

// the jetty seen from the ice: from where its boards stand more than a step above the floor under them it is a wall
const J = JETTY, walkEnd = J.len - J.platLen;
const BLOCK = (() => {
  for (let a = 0; a <= J.len; a += 0.05) { const [x, z] = J.at(a, 0); if (J.top - Math.max(terrainHeight(x, z), ICE_Y) > STEP_UP) return a; }
  return J.len;
})();

// ---------------------------------------------------------------- the snow on the ice (also in its shader) ------------
let noise = null;   // the same tileable noise the shaders read (nature.js), once it is made
/** The noise texture's channel `ch` at (u, v) (texture coordinates, repeating), bilinear, 0 … 1. */
function noiseAt(u, v, ch) {
  const img = (noise ||= noiseTexture().image), N = img.width, d = img.data;
  const fx = u * N - 0.5, fy = v * N - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const at = (x, y) => d[((((y % N) + N) % N) * N + (((x % N) + N) % N)) * 4 + ch] / 255;
  return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
}
/** How much snow lies on the ice at (x, z), 0 … 1: the broad shape of the drifts of the ice's shader (iceDrift). */
export function iceSnow(x, z) {
  const depth = ICE_Y - terrainHeight(x, z);
  const a = noiseAt(x * 0.021 + 0.13, z * 0.06 + 0.71, 0), b = noiseAt(x * 0.09 + 0.37, z * 0.09 + 0.37, 1);
  return smooth(0.5, 0.6, a + 0.35 * (b - 0.5) + 0.32 * (1 - smooth(0.08, 0.7, depth)));
}

// ---------------------------------------------------------------- the look of the ice -----------------------------------
const ICE_PARS = `
varying float vIceDepth;
uniform vec3 uIceZenith; uniform vec3 uIceHorizon; uniform vec3 uIceSunGlow; uniform float uIceCloud; uniform float uIceOvercast;
uniform vec3 uIceCloudLit; uniform vec3 uIceCloudShade; uniform sampler2D uIceSkyline; uniform vec3 uIceTrees; uniform float uIceFresh;
float iceHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 iceHash2(vec2 p) { return vec2(iceHash(p), iceHash(p + 17.31)); }
// the distance (in cells) to the nearest border of a pattern of cells: the long, straight cracks of the ice
float iceCells(vec2 p) {
  vec2 i = floor(p), f = fract(p), mr = vec2(0.0), mg = vec2(0.0);
  float md = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), r = g + iceHash2(i + g) - f;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  }
  md = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = mg + vec2(float(x), float(y)), r = g + iceHash2(i + g) - f;
    if (dot(mr - r, mr - r) > 1e-5) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  return md;
}
// the sky as the ice mirrors it: soft, its clouds an even veil, the trees of the far shore a dark band low down
vec3 iceSky(vec3 R) {
  float h = max(R.y, 0.0);
  vec3 sky = mix(uIceHorizon, uIceZenith, pow(h, 0.5));
  sky += uIceSunGlow * pow(max(dot(R, uSunDirW), 0.0), 6.0) * 0.35;
  sky = mix(sky, mix(uIceCloudShade, uIceCloudLit, 0.55), clamp(uIceCloud * 0.55 + uIceOvercast * 0.4, 0.0, 0.95) * smoothstep(0.02, 0.3, h));
  vec2 rd = normalize(R.xz + vec2(1e-5));
  vec4 sk = texture2D(uIceSkyline, vec2(atan(rd.y, rd.x) / 6.2832 + 0.5, 0.5));
  float trees = smoothstep(sk.r * 0.6 + 0.04, sk.r * 0.6 - 0.04, R.y) * step(0.001, sk.r);
  vec3 wood = uIceTrees * (uSkyLight * 2.2 + uSunLight * 0.3) * (0.55 + 0.6 * sk.g);
  return mix(sky, mix(vec3(dot(wood, vec3(0.333))), wood, 0.45), trees);
}`;
// (replaces map_fragment: the ice's own colour; these names stay visible to the snow below)
const ICE_COLOUR = `
  if (vIceDepth <= 0.0) discard;
  vec2 iceP = vNatWorld.xz;
  vec3 iceV = normalize(vNatWorld - cameraPosition);
  float icePx = max(length(fwidth(iceP)), 1e-4);
  float iceA = texture2D(uNatNoise, vec2(iceP.x * 0.021, iceP.y * 0.06) + vec2(0.13, 0.71)).r;
  float iceB = texture2D(uNatNoise, iceP * 0.09 + 0.37).g;
  float iceC = texture2D(uNatNoise, iceP * 0.33 + 0.11).b;
  float iceE = texture2D(uNatNoise, vec2(iceP.x * 0.15, iceP.y * 0.6) + 0.29).g;
  float iceShore = 1.0 - smoothstep(0.08, 0.7, vIceDepth);
  // the drifts: long streaks across the lake (the wind from the west) and snow heaped along the banks, with sharp ragged
  // edges (iceSnow in ice.js follows their broad shape); thicker in their middle
  float iceF = iceA + 0.35 * (iceB - 0.5) + 0.32 * iceShore;
  // (the edge at least as soft as a pixel is wide: further off, where a pixel spans centimetres of the ice, a sharp edge
  // of that fine raggedness broke up into a comb of single pixels)
  float iceE0 = iceF + 0.14 * (iceC - 0.5), iceAw = fwidth(iceE0);
  float iceDrift = smoothstep(0.515 - iceAw, 0.575 + iceAw, iceE0);
  float iceThick = smoothstep(0.52, 0.75, iceF);
  // where the wind swept it bare: frosted milky ice, here and there dark clear ice (less of it near the banks)
  float iceClear = smoothstep(0.55, 0.68, texture2D(uNatNoise, iceP * 0.045 + 0.5).g + 0.3 * (iceB - 0.5)) * (1.0 - 0.7 * iceShore);
  // (the frosted ice in faint streaks along the wind)
  vec3 iceCol = mix(vec3(0.44, 0.5, 0.55) * (0.9 + 0.16 * iceC) * (0.85 + 0.3 * iceE), vec3(0.025, 0.035, 0.045), iceClear);
  // cracks: long, slightly crooked lines (cells of some 5 m), not every border cracked; whitish in the clear ice
  float iceCr = iceCells(iceP * 0.2 + vec2(iceB, iceC) * 0.35 + 3.7) / 0.2;
  float iceCrack = (1.0 - smoothstep(0.0012, 0.0012 + icePx, iceCr)) * smoothstep(0.5, 0.62, texture2D(uNatNoise, iceP * 0.05 + 0.83).a);
  iceCol = mix(iceCol, mix(vec3(0.36, 0.4, 0.44), vec3(0.5, 0.56, 0.6), iceClear), iceCrack * mix(0.35, 0.6, iceClear));
  // air bubbles frozen in the clear ice in clusters, at two depths, small; seen through the ice they shift with the eye
  vec3 iceIn = refract(iceV, vec3(0.0, 1.0, 0.0), 0.76);
  float iceZone = smoothstep(0.55, 0.7, texture2D(uNatNoise, iceP * 0.17 + 0.21).r), iceBub = 0.0;
  for (int k = 0; k < 2; k++) {
    float dep = 0.02 + 0.045 * float(k);
    vec2 q = (iceP + iceIn.xz / max(-iceIn.y, 0.25) * dep) / 0.05 + float(k) * 17.3, c = floor(q), f = fract(q);
    float h = iceHash(c);
    vec2 at = vec2(fract(h * 7.13), fract(h * 13.37)) * 0.6 + 0.2;
    float r = (0.06 + 0.16 * pow(fract(h * 3.71), 3.0)) * step(0.8, h);
    iceBub = max(iceBub, (1.0 - smoothstep(r * 0.5, r, length(f - at))) * (1.0 - 0.4 * float(k)));
  }
  iceCol = mix(iceCol, vec3(0.55, 0.62, 0.68), iceBub * iceClear * iceZone * 0.75 * smoothstep(0.008, 0.003, icePx));
  diffuseColor.rgb *= iceCol;`;
// (in the snow's block of nature.js, where 'cover' is the snow lying there and nW the surface's world normal)
const ICE_SNOW = `
  // snow in the drifts, a thin frost on the milky ice, the clear ice bare; while it snows more of it
  cover = clamp(iceDrift * (0.6 + 0.4 * uSnow) + 0.06 * uSnow * (1.0 - iceClear) * (1.0 - iceCrack), 0.0, 1.0);
  // fresh snow while it snows (and a while after): an even layer that thickens, a little thinner in streaks along the
  // wind (the dark ice shows through them grey; bare spots of it in the fresh snow looked like dirt)
  cover = max(cover, uIceFresh * mix(0.7, 1.0, smoothstep(0.25, 0.55, iceE * 0.7 + iceB * 0.3)));
  roughnessFactor = mix(0.32, 0.06, iceClear);
  // the drifts stand a few centimetres high: their edges catch the light (near by: further off the slope taken from a
  // block of four pixels is too coarse for an edge a pixel or two wide and only drew a ragged seam)
  {
    vec2 px = dFdx(iceP), py = dFdy(iceP);
    float det = px.x * py.y - px.y * py.x, hd = iceDrift * 0.03 * (0.7 + 0.6 * iceThick), hx = dFdx(hd), hy = dFdy(hd);
    vec2 sl = abs(det) > 1e-12 ? vec2(py.y * hx - px.y * hy, px.x * hy - py.x * hx) / det : vec2(0.0);
    sl *= (1.0 - smoothstep(0.012, 0.04, icePx)) / max(1.0, length(sl));
    nW = normalize(nW - vec3(sl.x, 0.0, sl.y));
  }
  // the sky in the bare ice, blurred by its uneven face
  vec3 iceN = normalize(vec3((iceB - 0.5) * 0.07, 1.0, (iceC - 0.5) * 0.07));
  vec3 iceR = reflect(iceV, iceN); iceR.y = abs(iceR.y) + 0.002;
  float iceFr = 0.02 + 0.98 * pow(1.0 - max(dot(-iceV, iceN), 0.0), 5.0);
  totalEmissiveRadiance += iceSky(iceR) * iceFr * (1.0 - cover) * mix(0.3, 0.85, iceClear);
  // the sun glitters on the snow, as on the lawn (nature.js: with the sun's direct light)
  nGlint = step(0.93, texture2D(uNatNoise, iceP * 3.7 + cameraPosition.xz * 0.03).a) * cover;`;

/** How much fresh snow lies on the bare ice (0 … 1): it settles while it snows and is blown away slowly after. */
const ICE_FRESH = { value: 0 };
/** The ice's material: one program, made at the start with the rest of the garden. */
function iceMaterial(water) {
  const wu = water.uniforms;
  return natureMaterial('ground', { color: 0xffffff, roughness: 0.3, transparent: true, opacity: 1, depthWrite: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4, fog: false }, {
    key: ':ice',
    uniforms: {
      uIceZenith: SKY.uZenith, uIceHorizon: SKY.uHorizon, uIceSunGlow: SKY.uSunGlow, uIceCloud: SKY.uCloudCover, uIceOvercast: SKY.uOvercast,
      uIceCloudLit: SKY.uCloudLit, uIceCloudShade: SKY.uCloudShade, uIceSkyline: wu.uSkyline, uIceTrees: wu.uTreeLine,
      uIceFresh: ICE_FRESH,
    },
    vertexPars: 'attribute float aDepth; varying float vIceDepth;',
    vertexBody: 'vIceDepth = aDepth;',
    fragmentPars: ICE_PARS,
    groundFragment: ICE_COLOUR,
    snowFragment: ICE_SNOW,
    // meltwater on the ice when it rains in winter, round the drifts
    puddleMask: '(1.0 - iceDrift) * 0.75',
  });
}

// ---------------------------------------------------------------- the frozen lake -------------------------------------
export class FrozenLake {
  constructor(world) {
    this.world = world;
    const garden = world.env.garden, water = garden.water;
    this.water = water;
    // the ice over the lake's surface: the water's rings (positions, depth below them, triangles shared), facing up
    const wg = water.mesh.geometry, g = new THREE.BufferGeometry();
    g.setAttribute('position', wg.attributes.position); g.setAttribute('aDepth', wg.attributes.aDepth); g.setIndex(wg.index);
    const nrm = new Float32Array(wg.attributes.position.count * 3); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.boundingSphere = wg.boundingSphere.clone();
    this.material = iceMaterial(water);
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'ice'; this.mesh.renderOrder = 4; this.mesh.receiveShadow = true; this.mesh.castShadow = false; this.mesh.userData.noAO = true;
    this.mesh.visible = false;
    garden.group.add(this.mesh);
    // Direct3D builds a program for its vertex layout on its first draw: a hidden triangle draws it in the first frames
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute([0, -60, 0, 0, -60, 0, 0, -60, 0], 3));
    pg.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    pg.setAttribute('aDepth', new THREE.Float32BufferAttribute([1, 1, 1], 1));
    this.prewarm = new THREE.Mesh(pg, this.material);
    this.prewarm.frustumCulled = false; this.prewarm.receiveShadow = true; this.prewarm.userData.noAO = true; this.prewarm.name = 'ice-prewarm'; this.prewarm.userData.frames = 0;
    this.prewarm.onAfterRender = () => { if (++this.prewarm.userData.frames >= 4) this.prewarm.visible = false; };
    garden.group.add(this.prewarm);
    // what stands in the ice: the reeds frozen in it, the stones in the water, the jetty's ladder (8 m cells)
    this.cells = new Map();
    const add = (x, z, r, what) => {
      const o = { x, z, r, what };
      for (let i = Math.floor((x - r) / 8); i <= Math.floor((x + r) / 8); i++) for (let j = Math.floor((z - r) / 8); j <= Math.floor((z + r) / 8); j++) {
        const k = i * 4096 + j; if (!this.cells.has(k)) this.cells.set(k, []); this.cells.get(k).push(o);
      }
    };
    for (const c of garden.reeds?.clumps || []) if (terrainHeight(c.x, c.z) < ICE_Y + 0.05) add(c.x, c.z, c.kind === 'reed' ? 0.26 : 0.2, 'reed');
    for (const s of STONES) if (!s.pebble && s.s > 0.25 && terrainHeight(s.x, s.z) < ICE_Y + 0.15) add(s.x, s.z, s.s * 0.45, 'stone');
    { const [x, z] = J.at(J.len + 0.14, 0); add(x, z, 0.3, 'ladder'); }
    this.obstacleCount = [...new Set([...this.cells.values()].flat())].length;
    this.wasWalkable = false;
  }

  /** In winter the lake carries you (the season decides, not a snowfall in another one). */
  get walkable() { return this.world.env?.garden?.seasons?.name === 'winter'; }
  /** How much of the ice shows: the winter's weight while the season changes (0 … 1). */
  get shown() { return this.water.uniforms.uWinterW.value; }

  /** What you stand on in winter (player.js floorAt outside): the deck, the jetty's boards (only when you come from no
   *  lower than a step below them, `ref`), else the ground or the ice. */
  floorAt(x, z, ref = Infinity) {
    const D = HOUSE.deck;
    if (x >= D.x0 && x <= D.x1 && z >= D.z0 - 0.45 && z <= D.z1) return 0;
    if (onJetty(x, z) && J.top <= ref + 1e-6) return J.top;
    return Math.max(terrainHeight(x, z), ICE_Y);
  }
  /** The grip of the feet at (x, z) (1 everywhere but on the ice): bare ice 0.2, on its snow up to 0.4. */
  gripAt(x, z, feet = ICE_Y) {
    if (!this.walkable || feet > ICE_Y + 0.05 || !overIce(x, z)) return 1;
    return 0.2 + 0.2 * iceSnow(x, z);
  }
  /** The obstacles of the ice within r of (x, z). */
  #near(x, z, r) {
    const out = [];
    for (let i = Math.floor((x - r) / 8); i <= Math.floor((x + r) / 8); i++) for (let j = Math.floor((z - r) / 8); j <= Math.floor((z + r) / 8); j++) {
      for (const o of this.cells.get(i * 4096 + j) || []) if (!out.includes(o) && (o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + r) ** 2) out.push(o);
    }
    return out;
  }
  /** Push a walker (p, r) out of the jetty where it is a wall (its feet below the boards); true when it moved. */
  #offJetty(p, r) {
    const rx = p.x - J.root[0], rz = p.z - J.root[1];
    let al = rx * J.dir[0] + rz * J.dir[1], ac = rx * J.side[0] + rz * J.side[1];
    if (al < BLOCK - r || al > J.len + r) return false;
    let moved = false;
    for (const [a0, a1, hw] of [[BLOCK, walkEnd, J.width / 2], [Math.max(BLOCK, walkEnd), J.len, J.platWidth / 2]]) {
      if (a1 <= a0) continue;
      const qa = Math.min(a1, Math.max(a0, al)), qc = Math.min(hw, Math.max(-hw, ac)), da = al - qa, dc = ac - qc, d2 = da * da + dc * dc;
      if (d2 >= r * r) continue;
      if (d2 < 1e-10) {
        // inside: out across its nearer side, or past its end (never back along it towards the shore)
        const side = hw - Math.abs(ac), end = a1 === J.len ? J.len - al : Infinity;
        if (end < side) al = J.len + r; else ac = (ac >= 0 ? 1 : -1) * (hw + r);
      } else { const d = Math.sqrt(d2), k = (r - d) / d; al += da * k; ac += dc * k; }
      moved = true;
    }
    if (moved) { p.x = J.root[0] + J.dir[0] * al + J.side[0] * ac; p.z = J.root[1] + J.dir[1] * al + J.side[1] * ac; }
    return moved;
  }
  /** Keep a walker of radius r (feet at `feet`) on the winter's walkable area and out of everything in the way (as
   *  outdoor.js keepInside, with the lake). Returns true when it had to move it. */
  keep(p, r, feet = 0) {
    if (!outside(p.x, p.z)) return false;
    let moved = false;
    const low = feet < J.top - 0.01;
    for (let iter = 0; iter < 10; iter++) {
      let again = false;
      for (const o of [...obstaclesNear(p.x, p.z, r), ...this.#near(p.x, p.z, r)]) {
        const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), min = o.r + r;
        if (d >= min) continue;
        if (d < 1e-6) { p.x += min; continue; }
        p.x = o.x + dx / d * min; p.z = o.z + dz / d * min; again = true;
      }
      if (low && this.#offJetty(p, r)) again = true;
      const inside = inPolygon(ICE_REGION, p.x, p.z), [cx, cz, d] = nearestOnOutline(ICE_REGION, p.x, p.z);
      if (inside && d >= r - 1e-6) { if (!again) break; moved = true; continue; }
      let nx = inside ? p.x - cx : cx - p.x, nz = inside ? p.z - cz : cz - p.z;
      const nl = Math.hypot(nx, nz);
      if (nl < 1e-9) { nx = 2 - p.x; nz = 30 - p.z; const m = Math.hypot(nx, nz) || 1; nx /= m; nz /= m; } else { nx /= nl; nz /= nl; }
      p.x = cx + nx * r; p.z = cz + nz * r; moved = true;
    }
    return moved;
  }
  /** True when a walker of radius r with its feet at `feet` fits at (x, z) in winter. */
  free(x, z, r, feet = 0) {
    if (!outside(x, z)) return true;
    if (!inPolygon(ICE_REGION, x, z) || nearestOnOutline(ICE_REGION, x, z)[2] < r) return false;
    if (obstaclesNear(x, z, r).length || this.#near(x, z, r).length) return false;
    if (feet < J.top - 0.01) { const p = { x, z }; if (this.#offJetty(p, r)) return false; }
    return true;
  }

  /** Every frame: the ice fades in and out with the winter; the water hides under it; fresh snow settles on it while
   *  it snows. A player left on the lake when the winter ends is put back on the shore. */
  update(dt = 0) {
    const goal = this.#snowing() ? 1 : 0, f = ICE_FRESH.value;
    ICE_FRESH.value = f + (goal - f) * Math.min(1, dt / (goal > f ? 90 : 600));
    const w = this.shown;
    this.mesh.visible = w > 0.002;
    this.material.opacity = Math.min(1, w);
    this.water.mesh.visible = w < 0.998;
    // the few withered lily pads of winter frozen in under the ice
    const lilies = this.world.env.garden.lilies;
    if (lilies) lilies.group.position.y = -0.07 * Math.min(1, w);
    const walk = this.walkable;
    if (this.wasWalkable && !walk) this.#ashore();
    this.wasWalkable = walk;
  }
  #snowing() { return (this.world.weatherState?.()?.snow ?? 0) > 0.3; }
  /** Jump to the end of the fresh snow's change (the checks, pictures, a start in snowfall). */
  settle() { ICE_FRESH.value = this.#snowing() ? 1 : 0; }
  #ashore() {
    const P = this.world.player; if (!P) return;
    const p = P.position;
    if (!outside(p.x, p.z) || inPolygon(REGION, p.x, p.z)) return;
    // the nearest place on the garden's walkable area, half a metre inside its edge
    const q = { x: p.x, z: p.z }; keepInside(q, 0.5);
    P.transition = null; P.setPose(q.x, q.z, P.yaw, P.pitch);
  }
  info() { return { walkable: this.walkable, shown: +this.shown.toFixed(3), visible: this.mesh.visible, fresh: +ICE_FRESH.value.toFixed(3), obstacles: this.obstacleCount, block: +BLOCK.toFixed(2), region: ICE_REGION.length }; }
}
