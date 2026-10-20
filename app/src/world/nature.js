// Everything that grows outside: the shared weather and light uniforms of the garden, the shader patches that make
// plants sway in the wind, hold snow and take their ambient light from the sky, the procedural textures (foliage,
// bark, grass, ground) and the small plants in the terrace planters. The trees themselves are built in trees.js,
// the garden in garden.js.
//
// All garden materials are MeshStandardMaterials patched in onBeforeCompile. Materials of one kind share a single
// shader program (customProgramCacheKey), whatever texture they carry: one compile per kind, not per species.
import * as THREE from 'three';
import './light-loop.js';   // (first: the lamps' loop in three's lighting chunk, before anything copies it)
import { seeded } from './geo.js';
import { plankTexture } from './textures.js';
import { TRACKS, TRACKS_GLSL } from './tracks.js';
import { SNOW_COVER, SNOW_COVER_GLSL, SNOW_STYLES } from './snow-cover.js';

/** Set by garden.js every frame / when the weather or the hour changes. */
export const NATURE = {
  uTime: { value: 0 },
  uWind: { value: 0.35 },                          // 0 calm … 1 storm
  uSnow: { value: 0 },                             // snow cover 0 … 1
  uWinter: { value: 0 },                           // 1: deciduous trees are bare (the second half of their texture)
  uWet: { value: 0 },                              // rain: darker, glossier surfaces
  uSkyLight: { value: new THREE.Color(0.5, 0.55, 0.6) },     // ambient light from above …
  uGroundLight: { value: new THREE.Color(0.18, 0.17, 0.14) }, // … and from below
  uSunDirW: { value: new THREE.Vector3(0, 1, 0) },
  uSunLight: { value: new THREE.Color(1, 1, 1) },  // colour × intensity of the sun (or the moon)
  uHazeColor: { value: new THREE.Color(0.7, 0.75, 0.8) },    // the air towards the horizon …
  uHazeSun: { value: new THREE.Color(0, 0, 0) },             // … brighter towards the sun
  uHazeDensity: { value: 1 / 260 },
  uHazeMax: { value: 0.9 },
  uHazeStart: { value: 40 },                       // the air is clear up to this distance (m)
  uNatNoise: { value: null },                      // noiseTexture() (puddles), set with the first material
  // the night (environment.js): colours fade towards a cool grey as the eye sees them in the dark (0 … 1), and the warm
  // light of the lit rooms falls out of the book room's windows onto the leaves, trunks and ground just outside
  uNightGrade: { value: 0 },
  uNightTint: { value: new THREE.Color(0.8, 0.88, 1.08) },
  uWindowLight: { value: new THREE.Color(0, 0, 0) },
  uWindows: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, -100, 0, 0)) },      // centre, area (m²)
  uWindowDirs: { value: [0, 1, 2, 3].map(() => new THREE.Vector3(0, 0, 1)) },         // which way each one faces
  // the trees' near level turns into the far one between these distances from the eye (m; trees.js, garden.js)
  uLodNear: { value: 45 },
  uLodFar: { value: 70 },
  // the season (seasons.js): weights of spring, summer, autumn and winter, blended while it changes
  uSeason: { value: new THREE.Vector4(0, 1, 0, 0) },
  uGrassTint: { value: new THREE.Color(1, 1, 1) },  // the blades of the lawn: fresh in spring, yellowed in autumn
  uLitter: { value: 0 },                            // fallen leaves on the lawn, the paths and the boards (autumn)
  uLitterTex: { value: null },                      // litterTexture(), set with the first material
  // the fire bowl (firebowl.js): its flickering light on everything round it (colour × strength; none: black)
  uFireLight: { value: new THREE.Color(0, 0, 0) },
  uFirePos: { value: new THREE.Vector3(0, -100, 0) },
};

// ---------------------------------------------------------------- GLSL ----------------------------------
const NATURE_UNIFORMS = `
uniform float uTime; uniform float uWind; uniform float uSnow; uniform float uWinter; uniform float uWet;
uniform vec3 uSkyLight; uniform vec3 uGroundLight; uniform vec3 uSunDirW; uniform vec3 uSunLight;
uniform vec3 uHazeColor; uniform vec3 uHazeSun; uniform float uHazeDensity; uniform float uHazeMax; uniform float uHazeStart;
uniform sampler2D uNatNoise;
uniform float uNightGrade; uniform vec3 uNightTint; uniform vec3 uWindowLight; uniform vec4 uWindows[4]; uniform vec3 uWindowDirs[4];
uniform vec4 uSeason; uniform vec3 uGrassTint; uniform float uLitter; uniform sampler2D uLitterTex;
uniform vec3 uFireLight; uniform vec3 uFirePos;
// the light from the lit windows at p (normal n): each window a small area light, brightest straight out of it
vec3 natWindowSpill(vec3 p, vec3 n) {
  if (uWindowLight.r <= 0.0) return vec3(0.0);
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    vec3 d = p - uWindows[i].xyz;
    float d2 = dot(d, d);
    if (uWindows[i].w <= 0.0 || d2 > 400.0) continue;
    vec3 l = d * inversesqrt(d2 + 1e-4);
    s += uWindows[i].w * max(dot(l, uWindowDirs[i]), 0.0) * (0.35 + 0.65 * max(dot(n, -l), 0.0)) / (d2 + 1.5);
  }
  return uWindowLight * s;
}
`;
/** The fire bowl's light at a point with world normal n: a warm glow that falls off within some 9 m (firebowl.js). */
const FIRE_GLSL = `
vec3 natFire(vec3 p, vec3 n) {
  vec3 d = uFirePos - p; float l = length(d);
  float wrap = clamp(dot(n, d / max(l, 1e-3)) * 0.7 + 0.3, 0.0, 1.0);
  return uFireLight * wrap / (1.0 + 0.55 * l * l) * (1.0 - smoothstep(6.0, 10.0, l));
}
`;
/** Rain on water: in every cell of 40 cm a ring spreads out now and then; returns the slope of the surface (needs uTime). */
export const RAIN_RINGS_GLSL = `
float natHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 natRainRings(vec2 p, float rate) {
  vec2 g = vec2(0.0), c = floor(p / 0.4);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 id = c + vec2(float(i), float(j));
    float h = natHash(id);
    vec2 center = (id + 0.5 + (vec2(h, fract(h * 13.7)) - 0.5) * 0.8) * 0.4;
    float t = fract(uTime * rate * (0.8 + 0.4 * fract(h * 7.3)) + h * 5.0);
    vec2 d = p - center; float r = length(d);
    float w = r - t * 0.3;
    float amp = (1.0 - t) * (1.0 - t) * smoothstep(0.05, 0.0, abs(w));
    g += d / max(r, 1e-3) * sin(w * 110.0) * amp;
  }
  return g;
}
`;
/** The air: distance haze towards the horizon colour (the sky shader uses the same colours at its horizon). */
export const HAZE_GLSL = `
vec3 natHazeColor(vec3 dir) {
  float s = max(dot(dir, uSunDirW), 0.0);
  return uHazeColor + uHazeSun * (s * s * s * s * s * s * s * s);
}
float natHazeAmount(float dist, float height) {
  // squared and only from uHazeStart on: the garden and the wood round it stay clear, the hills far off fade
  float k = max(dist - uHazeStart, 0.0) * uHazeDensity * exp(-max(height, 0.0) / 90.0);
  return (1.0 - exp(-k * k)) * uHazeMax;
}
`;
/** Wind: gusts that travel across the garden, mostly along +x. */
const WIND_GLSL = `
vec3 natWind(vec3 p) {
  float gust = 0.62 + 0.38 * sin(uTime * 0.41 + p.x * 0.031 - p.z * 0.017) * sin(uTime * 0.23 + p.z * 0.026 + 1.3);
  float ph = dot(p.xz, vec2(0.11, 0.07));
  return vec3(0.75 + 0.35 * sin(uTime * 1.07 + ph), 0.0, 0.3 * sin(uTime * 1.61 + ph * 1.7 + 0.7)) * gust * uWind;
}
`;

const noFlip = (kind) => kind === 'leaf' || kind === 'grass';
/** three's lights_fragment_begin without the point lights (three writes the light counts into the shader text,
 *  so they cannot be switched off with a #define). */
const LIGHTS_WITHOUT_POINTS = (() => {
  const src = THREE.ShaderChunk.lights_fragment_begin;
  const a = src.indexOf('#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )'), b = src.indexOf('#if ( NUM_SPOT_LIGHTS > 0 )');
  return a >= 0 && b > a ? src.slice(0, a) + src.slice(b) : src;
})();

/**
 * Patch a MeshStandardMaterial into a garden material of `kind`:
 *   'leaf'   alpha-tested foliage cards (sway + flutter, light through the leaves, bare in winter, snow on top)
 *   'bark'   trunks and branches (sway, snow on the upper side)
 *   'grass'  blades (sway, buried under the snow up to uSnowDepth, darker at the roots)
 *   'ground' the terrain (world-space textures, snow, wet)
 *   'plain'  anything else outside (the deck, the path: snow, wet, sky light)
 * Every kind takes its ambient light from the sky (NATURE.uSkyLight / uGroundLight) instead of the rooms'
 * hemisphere light, and fades into the haze with distance. The fire bowl lights every kind round it (natFire).
 * The snow on 'ground' and 'plain' takes the prints of whoever walks on it (tracks.js); a 'plain' material may ask for the
 * look of snow on a path, a deck or a jetty (extra.snowStyle 'path' | 'deck' | 'jetty': snow-cover.js).
 * extra: uniforms, key (a program of its own), puddles, litter (fallen leaves in autumn on 'plain'), lod (the trees:
 * the near level turns into the far one, trees.js), vertexPars, beginNormal (after three's beginnormal_vertex),
 * vertexBody, fragmentPars, normalFragment, colorFragment (after three's color_fragment), snowFragment,
 * irradianceFragment, noLamps (no point lights), groundFragment and puddleMask ('ground').
 */
export function natureMaterial(kind, params = {}, extra = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...params });
  mat.userData.nature = kind;
  const extraUniforms = extra.uniforms || {};
  NATURE.uNatNoise.value ||= noiseTexture();
  NATURE.uLitterTex.value ||= litterTexture();
  // puddles in the rain ('plain' surfaces that ask for them: the deck, the path, the jetty; the ground on its trails)
  const puddles = { value: +(extra.puddles || 0) };
  // fallen leaves in autumn ('plain' surfaces that ask for them: the path, the deck, the jetty)
  const litter = { value: +(extra.litter || 0) };
  mat.userData.litter = litter;
  // snow as it lies on a path, a deck or a jetty (snow-cover.js; every 'plain' material carries the uniform)
  const snowStyle = { value: SNOW_STYLES[extra.snowStyle] || 0 };
  mat.userData.snowStyle = snowStyle;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, NATURE, extraUniforms);
    shader.uniforms.uPuddles = puddles;
    shader.uniforms.uLitterW = litter;
    // the prints in the snow (tracks.js) on the ground and every 'plain' surface
    if (kind === 'ground' || kind === 'plain') Object.assign(shader.uniforms, TRACKS);
    if (kind === 'plain') { Object.assign(shader.uniforms, SNOW_COVER); shader.uniforms.uSnowStyle = snowStyle; }
    const occ = kind === 'leaf' || kind === 'bark' || kind === 'grass';
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    vs = vs.replace('#include <common>', `#include <common>
${NATURE_UNIFORMS}
${WIND_GLSL}
varying vec3 vNatWorld;
${occ ? 'attribute float aOcc; varying float vOcc;' : ''}
${kind === 'grass' ? 'attribute float aTipH; uniform float uSnowDepth; varying float vGrassH;' : ''}
${extra.lod ? 'attribute vec3 aPivot; attribute float aMorph; uniform float uLodNear; uniform float uLodFar;' : ''}
${kind === 'leaf' ? 'varying float vNatTree;' : ''}
${extra.vertexPars || ''}`);
    if (extra.beginNormal) vs = vs.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
${extra.beginNormal}`);
    vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>
{
  #if defined(USE_INSTANCING)
    vec3 nBase = instanceMatrix[3].xyz;
    float nS2 = dot(instanceMatrix[0].xyz, instanceMatrix[0].xyz);
    mat3 nToLocal = transpose(mat3(instanceMatrix)) / nS2;
  #elif defined(USE_BATCHING)
    vec3 nBase = batchingMatrix[3].xyz;
    float nS2 = dot(batchingMatrix[0].xyz, batchingMatrix[0].xyz);
    mat3 nToLocal = transpose(mat3(batchingMatrix)) / nS2;
  #else
    vec3 nBase = modelMatrix[3].xyz;
    float nS2 = dot(modelMatrix[0].xyz, modelMatrix[0].xyz);
    mat3 nToLocal = transpose(mat3(modelMatrix)) / nS2;
  #endif
  float nS = sqrt(nS2);
  ${occ ? 'vOcc = aOcc;' : ''}
  ${extra.lod ? `
    // the near level becomes the far one over the band uLodNear … uLodFar (trees.js): the cards that stay grow by
    // 1.38 about where they hang, the others and the twigs shrink into their branch (the leaf area stays the same)
    if (aMorph > -0.5) {
      float lodK = smoothstep(uLodNear, uLodFar, distance(nBase.xz, cameraPosition.xz));
      float lodS = aMorph > 0.5 ? sqrt(1.0 + 0.9044 * lodK) : sqrt(max(1.0 - lodK, 0.0));
      transformed = aPivot + (transformed - aPivot) * lodS;
    }` : ''}
  ${kind === 'leaf' ? 'vNatTree = fract(sin(dot(nBase.xz, vec2(12.9898, 78.233))) * 43758.5453);' : ''}
  ${kind === 'grass' ? `
    // snow buries the grass: a blade shorter than the snow is gone, a taller one looks out of it
    float depth = uSnow * uSnowDepth / nS;
    float keep = step(depth + 0.004, aTipH);
    transformed.y = max(transformed.y - depth, 0.0);
    transformed *= keep;
    vGrassH = clamp(transformed.y / max(aTipH - depth, 0.01), 0.0, 1.0);
    float h = transformed.y * nS;
    transformed += nToLocal * (natWind(nBase + vec3(transformed.x, 0.0, transformed.z) * nS) * (h * h) * 0.9);` : ''}
  ${kind === 'leaf' || kind === 'bark' ? `
    // the whole tree bends with the wind, more the higher up
    float h = max(transformed.y, 0.0) * nS;
    vec3 w = natWind(nBase) * (h * h) * 0.0011;
    ${kind === 'leaf' ? `
    // and the leaves flutter
    float ph = dot(transformed, vec3(1.7, 2.3, 1.9)) + nBase.x * 0.37;
    w += vec3(sin(uTime * 6.3 + ph), sin(uTime * 5.1 + ph * 1.3) * 0.6, cos(uTime * 7.2 + ph)) * (0.02 + 0.04 * uWind) * min(1.0, h * 0.2);` : ''}
    transformed += nToLocal * w;` : ''}
  ${extra.vertexBody || ''}
}`);
    vs = vs.replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 nWP = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
    nWP = batchingMatrix * nWP;
  #endif
  #ifdef USE_INSTANCING
    nWP = instanceMatrix * nWP;
  #endif
  vNatWorld = (modelMatrix * nWP).xyz;
}`);

    fs = fs.replace('#include <common>', `#include <common>
${NATURE_UNIFORMS}
${HAZE_GLSL}
${FIRE_GLSL}
${kind === 'plain' || kind === 'ground' ? RAIN_RINGS_GLSL + 'uniform float uPuddles;' : ''}
${kind === 'plain' ? 'uniform float uLitterW;' : ''}
varying vec3 vNatWorld;
${occ ? 'varying float vOcc;' : ''}
${kind === 'grass' ? 'varying float vGrassH;' : ''}
${kind === 'leaf' ? 'varying float vNatTree; uniform vec3 uLeafSpring; uniform vec3 uAutumnA; uniform vec3 uAutumnB; uniform float uAutumnAmt; uniform float uBlossomPink;' : ''}
${extra.fragmentPars || ''}`);
    if (kind === 'leaf') fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
{
  // the season (seasons.js): a fresh light green in spring, in autumn the species' two colours (trees.js
  // LEAF_SEASONS), one tree nearer the one, the next nearer the other, and patches that turn earlier or later
  vec3 c = diffuseColor.rgb;
  float leafy = smoothstep(0.0, 0.03, c.g - max(c.r, c.b));      // green leaves (not the twigs, not the fruit)
  float patchy = fract(sin(dot(floor(vNatWorld * 1.3), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  vec3 hue = mix(uAutumnA, uAutumnB, smoothstep(0.2, 0.8, clamp(vNatTree + (patchy - 0.5) * 0.45, 0.0, 1.0)));
  // as bright as the green it replaces (an average summer leaf: linear luminance about 0.2)
  vec3 autumn = hue * (dot(c, vec3(0.2126, 0.7152, 0.0722)) / 0.2);
  autumn = mix(autumn, c, smoothstep(0.86, 0.98, patchy * 0.7 + (1.0 - vNatTree) * 0.3));   // a few still green
  // and some trees turn late: still green with a first yellow
  float late = step(0.84, fract(vNatTree * 7.13));
  autumn = mix(autumn, mix(c, c * vec3(1.35, 1.12, 0.55), 0.6), late * 0.8);
  vec3 seasonal = c * uLeafSpring * uSeason.x + c * (uSeason.y + uSeason.w) + mix(c, autumn, uAutumnAmt) * uSeason.z;
  diffuseColor.rgb = mix(c, seasonal, leafy);
  // the fruit trees' blossom (white in their spring texture): pink on about half of the trees, white on the others
  float bloom = smoothstep(0.3, 0.55, min(c.r, c.b)) * uBlossomPink * step(0.5, vNatTree);
  diffuseColor.rgb *= mix(vec3(1.0), vec3(1.0, 0.6, 0.72), bloom);
}`);
    if (extra.colorFragment) fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
${extra.colorFragment}`);
    if (kind === 'leaf') {
      // winter: the right half of the texture (bare twigs); alpha thins out in the smaller mip levels, so it is
      // raised with the level to keep distant crowns dense
      fs = fs.replace('#include <map_fragment>', `
  vec2 nUv = vec2(vMapUv.x * 0.5 + 0.5 * step(0.5, uWinter), vMapUv.y);
  vec4 sampledDiffuseColor = texture2D(map, nUv);
  diffuseColor *= sampledDiffuseColor;
  vec2 ndx = dFdx(vMapUv * 256.0), ndy = dFdy(vMapUv * 256.0);
  diffuseColor.a *= 1.0 + max(0.0, 0.5 * log2(max(dot(ndx, ndx), dot(ndy, ndy)))) * 0.3;`);
    }
    if (kind === 'leaf') fs = fs.replace('#include <alphatest_fragment>', `
  // alpha to coverage with a sharpened edge (a transition one pixel wide): three's default spread the coverage over
  // the whole card whenever the mip level blurred its alpha, and the crowns turned into a dithered speckle
  #ifdef ALPHA_TO_COVERAGE
    diffuseColor.a = clamp((diffuseColor.a - alphaTest) / max(fwidth(diffuseColor.a), 0.0001) + 0.5, 0.0, 1.0);
    if (diffuseColor.a < 0.02) discard;
  #else
    if (diffuseColor.a < alphaTest) discard;
  #endif`);
    if (kind === 'ground' && extra.groundFragment) fs = fs.replace('#include <map_fragment>', extra.groundFragment);
    if (noFlip(kind)) fs = fs.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
  normal = normalize(vNormal);   // foliage normals point out of the crown on both sides of a card`);
    if (extra.normalFragment) fs = fs.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
${extra.normalFragment}`);
    // the prints in the snow keep the light from their floors (tracks.js); the glitter of the snow (set in the snow's
    // block) comes with the sun's direct light: none in a shadow
    if (kind === 'ground' || kind === 'plain') fs = fs.replace('#include <emissivemap_fragment>', `float nGlint = 0.0, nTrkSun = 1.0, nTrkSky = 1.0;
#include <emissivemap_fragment>`).replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  reflectedLight.directDiffuse *= nTrkSun; reflectedLight.directSpecular *= nTrkSun; reflectedLight.indirectDiffuse *= nTrkSky;
  {
    float nDir = dot(reflectedLight.directDiffuse, vec3(0.333)), nInd = dot(reflectedLight.indirectDiffuse, vec3(0.333));
    totalEmissiveRadiance += nGlint * reflectedLight.directDiffuse * 1.5 * smoothstep(0.35, 0.7, nDir / max(nDir + nInd, 1e-5));
  }`);
    // snow, wetness and light through the leaves
    fs = fs.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 nW = inverseTransformDirection(normal, viewMatrix);
  ${kind === 'grass' ? `
    diffuseColor.rgb *= (0.42 + 0.58 * vGrassH) * uGrassTint;
    // what looks out of the snow is dry, pale straw
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.4, 0.36, 0.25) * (0.7 + 0.3 * vGrassH), uSnow * 0.85);
    float cover = 0.0;` : kind === 'ground' ? `
    float cover = uSnow;` : `
    float cover = uSnow * smoothstep(${kind === 'leaf' ? '-0.15, 0.55' : '0.05, 0.5'}, nW.y + 0.25 * (fract(sin(dot(floor(vNatWorld * 3.0), vec3(12.9, 78.2, 37.7))) * 43758.5) - 0.5));`}
  ${kind === 'plain' ? `
  // fallen leaves in autumn on the boards and the gravel (litterTexture), in drifts, only on what faces up
  float lw = uLitterW * uLitter;
  if (lw > 0.0) {
    vec4 lt = texture2D(uLitterTex, vNatWorld.xz * 0.42);
    float drift = texture2D(uNatNoise, vNatWorld.xz * 0.06 + 0.21).r;
    diffuseColor.rgb = mix(diffuseColor.rgb, lt.rgb, lt.a * smoothstep(1.05 - lw, 1.25 - lw, drift + 0.3) * smoothstep(0.7, 0.9, nW.y));
  }` : ''}
  ${extra.snowFragment || ''}
  ${kind === 'plain' ? 'vec4 nSnowTone; vec3 nSnowBase = diffuseColor.rgb; snowBefore(cover, nW, nSnowBase, nSnowTone); diffuseColor.rgb = nSnowBase;' : ''}
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.97), cover);
  roughnessFactor = mix(roughnessFactor, 0.62, cover);
  ${kind === 'plain' ? 'vec3 nSnowCol = diffuseColor.rgb; snowAfter(nSnowCol, roughnessFactor, nGlint, cover, nSnowTone); diffuseColor.rgb = nSnowCol;' : ''}
  ${kind === 'plain' || kind === 'ground' ? `
  // the prints in the snow (tracks.js), then the normal they and the snow's surface give
  vec3 nTrkCol = diffuseColor.rgb; trkApply(nW, nTrkCol, roughnessFactor, nTrkSun, nTrkSky, cover, vNatWorld, length(fwidth(vNatWorld.xz))); diffuseColor.rgb = nTrkCol;
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);` : ''}
  diffuseColor.rgb *= 1.0 - 0.28 * uWet * (1.0 - cover);
  // wet: glossier (the lawn and the plants only a little: wet blades and a glossy lawn caught the low sun as white glare)
  roughnessFactor = mix(roughnessFactor, roughnessFactor * ${kind === 'grass' || kind === 'ground' ? '0.85' : kind === 'leaf' || kind === 'bark' ? '0.75' : '0.5'}, uWet * (1.0 - cover));
  ${kind === 'leaf' ? `
    // backlit leaves glow
    vec3 sunV = normalize(mat3(viewMatrix) * uSunDirW);
    float back = pow(max(dot(-normalize(vViewPosition), sunV), 0.0), 4.0);
    totalEmissiveRadiance += diffuseColor.rgb * uSunLight * back * 0.32 * (1.0 - cover);
    // light that passes through the leaves keeps the shaded side of a crown from going black
    totalEmissiveRadiance += diffuseColor.rgb * (uSunLight * 0.05 + uSkyLight * 0.08) * (1.0 - cover);` : ''}
  ${kind === 'plain' || kind === 'ground' ? `
  // puddles in the rain: dark glossy patches in the hollows, the grey sky in them, rings where the drops fall
  float pMask = ${kind === 'ground' ? (extra.puddleMask || '0.0') : 'uPuddles'};
  if (uWet > 0.0 && pMask > 0.0) {
    // (on boards, pMask < 1: a few small ones; on gravel and earth bigger ones in the hollows)
    float pScale = mix(0.55, 0.19, clamp(pMask, 0.0, 1.0));
    float pn = texture2D(uNatNoise, vNatWorld.xz * pScale).g * 0.7 + texture2D(uNatNoise, vNatWorld.xz * pScale * 4.3 + 0.37).b * 0.3;
    float puddle = smoothstep(mix(0.68, 0.58, clamp(pMask, 0.0, 1.0)), mix(0.71, 0.62, clamp(pMask, 0.0, 1.0)), pn) * uWet * smoothstep(0.85, 0.97, nW.y) * (1.0 - cover);
    if (puddle > 0.0) {
      vec2 rg = natRainRings(vNatWorld.xz, 1.4) * 0.45;
      vec3 rn = normalize((viewMatrix * vec4(normalize(vec3(-rg.x, 1.0, -rg.y)), 0.0)).xyz);
      normal = normalize(mix(normal, rn, puddle));
      diffuseColor.rgb *= 1.0 - 0.35 * puddle;
      roughnessFactor = mix(roughnessFactor, 0.05, puddle);
      float fr = 0.03 + 0.97 * pow(1.0 - max(dot(normal, normalize(vViewPosition)), 0.0), 5.0);
      totalEmissiveRadiance += puddle * fr * uHazeColor * 0.3;
    }
  }` : ''}
}`);
    // The rooms' lamps do not reach the trees and the lawn (their range ends at the glass or soon after), but every
    // fragment would still work through all of them: only the sun (or moon) lights the garden directly. The deck, the
    // path and the planters ('plain', and the planters' 'grass' without a key) keep the lamps and the deck light.
    const noLamps = kind === 'leaf' || kind === 'bark' || kind === 'ground' || (kind === 'grass' && extra.key) || !!extra.noLamps;
    fs = fs.replace('#include <lights_fragment_begin>', `vec3 nSpill = vec3(0.0);
${noLamps ? LIGHTS_WITHOUT_POINTS : '#include <lights_fragment_begin>'}
{
  // outside there is no room to bounce the lamps' light: the sky lights from above, the ground from below
  vec3 nW = inverseTransformDirection(geometryNormal, viewMatrix);
  irradiance = mix(uGroundLight, uSkyLight, 0.5 + 0.5 * nW.y);
  nSpill = natWindowSpill(vNatWorld, nW);
  irradiance += nSpill;
  // the fire bowl's glow (none while it is out: black)
  irradiance += natFire(vNatWorld, nW);
  ${extra.irradianceFragment || ''}
}`);
    if (occ) fs = fs.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  reflectedLight.indirectDiffuse *= vOcc;
  reflectedLight.directDiffuse *= mix(1.0, vOcc, 0.55);`);
    fs = fs.replace('#include <opaque_fragment>', `
{
  vec3 toFrag = vNatWorld - cameraPosition;
  float dist = length(toFrag);
  // the night's dim colours fade towards a cool grey, as the eye sees them in the dark (what a lamp lights keeps its
  // colour; the haze is the sky's colour already)
  float nLum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
  outgoingLight = mix(outgoingLight, vec3(nLum) * uNightTint, uNightGrade * (1.0 - smoothstep(0.03, 0.16, nLum)) * (1.0 - smoothstep(0.02, 0.25, nSpill.r)));
  outgoingLight = mix(outgoingLight, natHazeColor(toFrag / max(dist, 0.001)), natHazeAmount(dist, vNatWorld.y));
}
#include <opaque_fragment>`);
    // the snow's prints and its look on hard surfaces (tracks.js, snow-cover.js), after three's declarations (map, vMapUv)
    if (kind === 'ground' || kind === 'plain') fs = fs.replace('void main() {', `${TRACKS_GLSL}${kind === 'plain' ? SNOW_COVER_GLSL : ''}
void main() {`);
    shader.vertexShader = vs; shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => 'nature:' + kind + (extra.key || '');
  return mat;
}

// ---------------------------------------------------------------- textures ------------------------------
const texCache = new Map();
function cached(key, make) { if (!texCache.has(key)) texCache.set(key, make()); return texCache.get(key); }
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function canvasTexture(c, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
/** Tileable value noise with `oct` octaves (period `size`). The cell and the eased fraction of every column (and row:
 *  the field is square) are worked out once per octave instead of per pixel: the same expressions, so the same numbers
 *  to the bit, four times faster (the garden's noise and bark took 60 ms of every start). */
function tileNoise(size, seed, oct = 5, base = 4) {
  const rnd = seeded(seed);
  const layers = [];
  for (let o = 0; o < oct; o++) {
    const n = base << o, g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    const i0 = new Int32Array(size), i1 = new Int32Array(size), s = new Float64Array(size);
    for (let x = 0; x < size; x++) { const f = x / size * n, f0 = Math.floor(f), t = f - f0; i0[x] = f0; i1[x] = (f0 + 1) % n; s[x] = t * t * (3 - 2 * t); }
    layers.push({ n, g, i0, i1, s, amp: Math.pow(0.5, o) });
  }
  const out = new Float32Array(size * size);
  let norm = 0; for (let o = 0; o < oct; o++) norm += Math.pow(0.5, o);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0;
    for (let o = 0; o < oct; o++) {
      const L = layers[o], n = L.n, g = L.g, sx = L.s[x], sy = L.s[y];
      const r0 = L.i0[y] * n, r1 = L.i1[y] * n, x0 = L.i0[x], x1 = L.i1[x];
      const a = g[r0 + x0], b = g[r0 + x1], c = g[r1 + x0], d = g[r1 + x1];
      v += ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy) * L.amp;
    }
    out[y * size + x] = v / norm;
  }
  return out;
}
/** RGBA noise texture: four independent tileable fbm fields (sky clouds, water ripples, ground variation). */
export function noiseTexture() {
  return cached('noise', () => {
    const N = 256, ch = [tileNoise(N, 11, 6, 4), tileNoise(N, 23, 5, 8), tileNoise(N, 37, 4, 16), tileNoise(N, 51, 3, 32)];
    const data = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) for (let k = 0; k < 4; k++) data[i * 4 + k] = Math.max(0, Math.min(255, Math.round((ch[k][i] - 0.5) * 1.9 * 255 + 128)));
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  });
}

const rgb = (r, g, b, a = 1) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
/** One leaf: a pointed oval with a midrib, rotated by `a`, `len` long. */
function drawLeaf(g, x, y, a, len, wid, col, rnd, { lobes = 0 } = {}) {
  g.save(); g.translate(x, y); g.rotate(a);
  // little contrast from leaf to leaf: seen from afar a crown is one soft mass, not a speckled one
  const shade = 0.9 + rnd() * 0.18;
  const grd = g.createLinearGradient(0, 0, len, 0);
  grd.addColorStop(0, rgb(col[0] * shade * 0.86, col[1] * shade * 0.86, col[2] * shade * 0.86));
  grd.addColorStop(1, rgb(col[0] * shade * 1.06, col[1] * shade * 1.06, col[2] * shade * 1.04));
  g.fillStyle = grd;
  g.beginPath(); g.moveTo(0, 0);
  if (lobes) {
    // an oak leaf: wavy rim
    const n = lobes * 2;
    for (let i = 1; i <= n; i++) { const t = i / (n + 1), r = wid * Math.sin(Math.PI * t) * (i % 2 ? 1 : 0.62); g.lineTo(len * t, -r); }
    g.lineTo(len, 0);
    for (let i = n; i >= 1; i--) { const t = i / (n + 1), r = wid * Math.sin(Math.PI * t) * (i % 2 ? 1 : 0.62); g.lineTo(len * t, r); }
  } else {
    g.quadraticCurveTo(len * 0.35, -wid, len, 0);
    g.quadraticCurveTo(len * 0.35, wid, 0, 0);
  }
  g.fill();
  g.strokeStyle = rgb(col[0] * 0.55, col[1] * 0.6, col[2] * 0.5, 0.5); g.lineWidth = Math.max(0.6, wid * 0.08);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(len * 0.9, 0); g.stroke();
  g.restore();
}
/** One fruit blossom: five round petals, white with a hint of pink at their base, and a yellow-green eye. */
function drawBlossom(g, x, y, size, rnd) {
  const a0 = rnd() * Math.PI * 2, shade = 0.92 + rnd() * 0.08;
  for (let i = 0; i < 5; i++) {
    const a = a0 + i * Math.PI * 0.4, px = x + Math.cos(a) * size * 0.5, py = y + Math.sin(a) * size * 0.5;
    const gr = g.createRadialGradient(x, y, 0, px, py, size * 0.62);
    gr.addColorStop(0, rgb(236 * shade, 196 * shade, 204 * shade)); gr.addColorStop(0.55, rgb(252 * shade, 246 * shade, 244 * shade)); gr.addColorStop(1, rgb(244 * shade, 240 * shade, 238 * shade));
    g.fillStyle = gr; g.beginPath(); g.ellipse(px, py, size * 0.56, size * 0.42, a, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = rgb(196, 190, 92); g.beginPath(); g.arc(x, y, Math.max(0.8, size * 0.18), 0, Math.PI * 2); g.fill();
}
/**
 * Fallen leaves for the ground, the path and the boards in autumn: 512² (a tile of about 2.4 m), tileable, beech,
 * oak and birch leaves in yellow, orange, rust and brown on nothing (alpha); the shaders lay it in drifts.
 */
export function litterTexture() {
  return cached('litter', () => {
    const N = 512, c = canvas(N, N), g = c.getContext('2d', { willReadFrequently: true }), rnd = seeded(907);
    const cols = [[214, 160, 40], [200, 104, 34], [168, 74, 30], [128, 82, 44], [190, 140, 62], [150, 46, 28], [112, 96, 50]];
    for (let k = 0; k < 330; k++) {
      const x = rnd() * N, y = rnd() * N, a = rnd() * Math.PI * 2, kind = rnd(), len = kind < 0.3 ? 9 + rnd() * 4 : 12 + rnd() * 7;
      const col = cols[Math.floor(rnd() * cols.length)], dark = 0.75 + rnd() * 0.35;
      for (const ox of [0, -N, N]) for (const oy of [0, -N, N]) {
        if (x + ox < -30 || x + ox > N + 30 || y + oy < -30 || y + oy > N + 30) continue;
        drawLeaf(g, x + ox - Math.cos(a) * len / 2, y + oy - Math.sin(a) * len / 2, a, len, len * (kind < 0.3 ? 0.42 : 0.36), col.map((v) => v * dark), rnd, { lobes: kind > 0.75 ? 3 : 0 });
      }
    }
    // transparent texels take the mean colour of the leaves (the smaller mip levels keep their colour)
    const img = g.getImageData(0, 0, N, N), d = img.data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 160) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
    for (let i = 0; i < d.length; i += 4) {
      const keep = Math.min(1, d[i + 3] / 255 * 3);
      d[i] = d[i] * keep + (r / n) * (1 - keep); d[i + 1] = d[i + 1] * keep + (gg / n) * (1 - keep); d[i + 2] = d[i + 2] * keep + (b / n) * (1 - keep);
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.premultiplyAlpha = false;
    return t;
  });
}
/** A twig: a slightly bent line with side shoots; calls leaf(x, y, angle, t) along it. */
function drawTwig(g, x, y, a, len, width, rnd, col, leaf, depth = 0) {
  for (const s of twigSegments(x, y, a, len, width, rnd, depth)) {
    g.strokeStyle = col; g.lineCap = 'round'; g.lineWidth = s.w;
    g.beginPath(); g.moveTo(s.x0, s.y0); g.lineTo(s.x1, s.y1); g.stroke();
    if (leaf) leaf(s.x1, s.y1, s.a, s.t);
  }
}
/** The segments of a twig with its side shoots: [{x0, y0, x1, y1, w, a, t}]. */
function twigSegments(x, y, a, len, width, rnd, depth = 0, out = []) {
  const steps = 7; let px = x, py = y, ang = a;
  for (let i = 0; i < steps; i++) {
    const t = (i + 1) / steps, nx = px + Math.cos(ang) * len / steps, ny = py + Math.sin(ang) * len / steps;
    out.push({ x0: px, y0: py, x1: nx, y1: ny, w: Math.max(0.6, width * (1 - t * 0.7)), a: ang, t });
    if (depth < 2 && rnd() < 0.55 && i > 0 && i < steps - 1) twigSegments(nx, ny, ang + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.5), len * (0.35 + rnd() * 0.2), width * 0.6, rnd, depth + 1, out);
    px = nx; py = ny; ang += (rnd() - 0.5) * 0.35;
  }
  return out;
}

/**
 * Foliage texture of a species: 512 × 256, left half summer (a cluster of leaves / a needle spray), right half
 * winter (the same twigs bare; conifers keep their needles). The cluster fills a card that stands with its
 * base (the branch end) at the bottom centre. Transparent texels carry the mean foliage colour, so the smaller
 * mip levels do not darken the rims.
 */
export function foliageTexture(species) {
  return cached('foliage:' + species, () => {
    // willReadFrequently: a CPU canvas, reading its pixels back (bleedTexture) does not stall on the graphics card
    const S = 256, c = canvas(S * 2, S), g = c.getContext('2d', { willReadFrequently: true });
    const bark = species === 'birch' ? 'rgba(70,62,55,0.95)' : 'rgba(78,62,48,0.95)';
    for (const winter of [false, true]) {
      g.save(); g.translate(winter ? S : 0, 0);
      g.beginPath(); g.rect(0, 0, S, S); g.clip();
      const r2 = seeded(species.length * 31 + 7);   // the same twigs in both halves
      if (species === 'spruce' || species === 'fir') {
        // drooping sprays: a solid dark body (so a fir reads as a dense mass from afar) with needles along its rims
        const segs = [];
        for (let b = 0; b < 3; b++) twigSegments(S / 2 + (b - 1) * 30, S - 6, -Math.PI / 2 + (b - 1) * 0.45 + (r2() - 0.5) * 0.2, S * (0.75 + r2() * 0.18), 3.2, r2, 0, segs);
        g.lineCap = 'round';
        for (const sg of segs) { g.strokeStyle = rgb(48, 80, 52); g.lineWidth = 22 * (1 - sg.t * 0.5); g.beginPath(); g.moveTo(sg.x0, sg.y0); g.lineTo(sg.x1, sg.y1); g.stroke(); }
        for (const sg of segs) { g.strokeStyle = 'rgba(70,52,38,1)'; g.lineWidth = sg.w; g.beginPath(); g.moveTo(sg.x0, sg.y0); g.lineTo(sg.x1, sg.y1); g.stroke(); }
        for (const sg of segs) {
          for (let k = 0; k < 10; k++) {
            const na = sg.a + (k % 2 ? 1 : -1) * (0.6 + r2() * 0.6), nl = 10 + r2() * 9, sh = 0.85 + r2() * 0.3;
            g.strokeStyle = rgb(62 * sh, 102 * sh, 64 * sh); g.lineWidth = 2.1;
            g.beginPath(); g.moveTo(sg.x1, sg.y1); g.lineTo(sg.x1 + Math.cos(na) * nl, sg.y1 + Math.sin(na) * nl); g.stroke();
          }
        }
      } else if (species === 'pine') {
        // tufts of long needles at the ends of short shoots, each with a solid core
        const segs = [];
        for (let b = 0; b < 5; b++) twigSegments(S / 2 + (b - 2) * 18, S - 6, -Math.PI / 2 + (b - 2) * 0.38, S * (0.4 + r2() * 0.25), 3.4, r2, 0, segs);
        g.lineCap = 'round';
        for (const sg of segs) { g.strokeStyle = 'rgba(96,66,44,1)'; g.lineWidth = sg.w; g.beginPath(); g.moveTo(sg.x0, sg.y0); g.lineTo(sg.x1, sg.y1); g.stroke(); }
        for (const sg of segs) {
          if (sg.t < 0.55 || r2() > 0.5) continue;
          g.fillStyle = rgb(52, 84, 50); g.beginPath(); g.ellipse(sg.x1, sg.y1 - 12, 15, 17, 0, 0, Math.PI * 2); g.fill();
          for (let k = 0; k < 30; k++) {
            const na = -Math.PI / 2 + (r2() - 0.5) * 2.8, nl = 20 + r2() * 20, sh = 0.8 + r2() * 0.4;
            g.strokeStyle = rgb(66 * sh, 106 * sh, 62 * sh); g.lineWidth = 1.7;
            g.beginPath(); g.moveTo(sg.x1, sg.y1); g.quadraticCurveTo(sg.x1 + Math.cos(na) * nl * 0.5, sg.y1 + Math.sin(na) * nl * 0.5 - 3, sg.x1 + Math.cos(na) * nl, sg.y1 + Math.sin(na) * nl); g.stroke();
          }
        }
      } else {
        // (fruit: an apple or cherry tree with small leaves and fruit; fruit-blossom: the same tree in spring, white
        // blossom with a few young leaves, its texture swapped in by seasons.js)
        const birch = species === 'birch', oak = species === 'oak', fruit = species.startsWith('fruit'), blossom = species === 'fruit-blossom';
        const col = birch ? [128, 160, 78] : oak ? [96, 122, 58] : blossom ? [134, 168, 82] : fruit ? [100, 136, 60] : [108, 138, 64];
        const leafLen = birch ? 15 : oak ? 22 : fruit ? 15 : 20, leafW = birch ? 7.5 : oak ? 8.5 : fruit ? 7.5 : 9;
        const leaf = (x, y, a) => {
          if (winter) { if (r2() < 0.1) { g.fillStyle = 'rgba(96,74,50,1)'; g.beginPath(); g.arc(x, y, 1.4, 0, Math.PI * 2); g.fill(); } return; }   // buds
          if (blossom) { drawBlossom(g, x, y, 4.5 + r2() * 2, r2); return; }
          for (let k = 0; k < 2; k++) drawLeaf(g, x, y, a + (k ? 1 : -1) * (0.6 + r2() * 0.7) + (birch ? 0.5 : 0), leafLen * (0.7 + r2() * 0.5), leafW * (0.8 + r2() * 0.4), col, r2, { lobes: oak ? 3 : 0 });
        };
        const n = birch ? 6 : 5;
        for (let b = 0; b < n; b++) {
          const a0 = birch ? -Math.PI / 2 + (b - (n - 1) / 2) * 0.5 : -Math.PI / 2 + (b - (n - 1) / 2) * 0.55;
          drawTwig(g, S / 2 + (b - (n - 1) / 2) * 10, S - 4, a0 + (r2() - 0.5) * 0.3, S * (0.62 + r2() * 0.3), 3.6, r2, bark, leaf);
        }
        if (!winter) {
          // a dense cushion of leaves pointing outwards: an opaque middle and a leafy rim
          for (let k = 0; k < (birch ? 120 : blossom ? 190 : 130); k++) {
            const rr = Math.pow(r2(), 0.65) * S * 0.39, aa = r2() * Math.PI * 2;
            const lx = S / 2 + Math.cos(aa) * rr, ly = S * 0.47 + Math.sin(aa) * rr * 0.86;
            // the blossom: clusters of three or four flowers, now and then a young leaf between them
            if (blossom && k % 5) { for (let f = 0; f < 3 + (k % 2); f++) drawBlossom(g, lx + (r2() - 0.5) * 12, ly + (r2() - 0.5) * 12, 4.2 + r2() * 2.2, r2); continue; }
            drawLeaf(g, lx, ly, aa + (r2() - 0.5) * 1.3, leafLen * (0.8 + r2() * 0.4), leafW * (0.85 + r2() * 0.3), col.map((v) => v * (0.92 + r2() * 0.14)), r2, { lobes: oak ? 3 : 0 });
          }
          // the fruit: a few small apples among the leaves, yellow-green with a red cheek
          if (fruit && !blossom) for (let k = 0; k < 7; k++) {
            const rr = Math.pow(r2(), 0.8) * S * 0.34, aa = r2() * Math.PI * 2, x = S / 2 + Math.cos(aa) * rr, y = S * 0.47 + Math.sin(aa) * rr * 0.86, r = 3.6 + r2() * 1.8;
            const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
            gr.addColorStop(0, rgb(236, 220, 140)); gr.addColorStop(0.45, rgb(198, 150, 52)); gr.addColorStop(1, rgb(150, 54, 30));
            g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
          }
        }
      }
      g.restore();
    }
    return bleedTexture(c);
  });
}
/** A texture from a canvas whose transparent texels take the mean colour of the opaque ones (per half). */
function bleedTexture(c) {
  const W = c.width, H = c.height, src = c.getContext('2d').getImageData(0, 0, W, H).data;
  const out = new Uint8Array(W * H * 4);
  for (const [x0, x1] of [[0, W / 2], [W / 2, W]]) {
    let r = 0, gg = 0, b = 0, n = 0;
    for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; if (src[i + 3] > 160) { r += src[i]; gg += src[i + 1]; b += src[i + 2]; n++; } }
    const m = n ? [r / n, gg / n, b / n] : [60, 80, 40];
    for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4, o = ((H - 1 - y) * W + x) * 4, a = src[i + 3];   // rows flipped: texture v = 1 at the top
      const keep = a > 0 ? Math.min(1, (a / 255) * 3) : 0;
      out[o] = src[i] * keep + m[0] * (1 - keep); out[o + 1] = src[i + 1] * keep + m[1] * (1 - keep); out[o + 2] = src[i + 2] * keep + m[2] * (1 - keep); out[o + 3] = a;
    }
  }
  const t = new THREE.DataTexture(out, W, H, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Bark: 128 × 256 (around × along the trunk), with a normal map. */
export function barkTexture(species) {
  return cached('bark:' + species, () => {
    const W = 128, H = 256;
    const n1 = tileNoise(128, species.length * 13 + 5, 5, 4);
    const at = (x, y) => n1[((y % 128 + 128) % 128) * 128 + ((x % 128 + 128) % 128)];
    const col = canvas(W, H), cg = col.getContext('2d'), img = cg.createImageData(W, H), d = img.data;
    const hgt = new Float32Array(W * H);
    const pal = { beech: [[112, 108, 100], [150, 146, 136]], oak: [[70, 62, 52], [118, 106, 90]], birch: [[222, 218, 208], [240, 236, 228]], spruce: [[84, 60, 44], [120, 90, 66]], pine: [[92, 62, 44], [150, 104, 70]], fruit: [[78, 70, 62], [124, 112, 98]] }[species] || [[90, 80, 70], [130, 118, 104]];
    const rnd = seeded(species.length * 7 + 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let h;
      if (species === 'birch') {
        h = 0.6 + (at(x, y >> 3) - 0.5) * 0.3;
      } else if (species === 'beech') {
        h = 0.5 + (at(x, y >> 1) - 0.5) * 0.45;                  // smooth grey bark
      } else if (species === 'oak') {
        const fur = Math.abs(Math.sin((x / W) * Math.PI * 9 + at(x >> 2, y >> 3) * 5));   // deep vertical furrows
        h = 0.25 + 0.75 * Math.pow(fur, 0.6) * (0.6 + 0.4 * at(x, y));
      } else {
        const plate = at(x >> 1, y >> 2);                         // scaly plates
        h = 0.3 + 0.7 * Math.pow(plate, 1.4);
      }
      hgt[y * W + x] = h;
      const t = Math.min(1, Math.max(0, h));
      const c0 = pal[0], c1 = pal[1];
      const i = (y * W + x) * 4;
      d[i] = c0[0] + (c1[0] - c0[0]) * t; d[i + 1] = c0[1] + (c1[1] - c0[1]) * t; d[i + 2] = c0[2] + (c1[2] - c0[2]) * t; d[i + 3] = 255;
    }
    cg.putImageData(img, 0, 0);
    if (species === 'birch') {
      // dark lenticels and black patches
      for (let k = 0; k < 110; k++) {
        const y = rnd() * H, w = 4 + rnd() * 25, x = rnd() * W;
        cg.fillStyle = `rgba(40,36,34,${0.45 + rnd() * 0.5})`; cg.fillRect(x - w / 2, y, w, 0.8 + rnd() * 1.6);
        if (x - w / 2 < 0) cg.fillRect(x - w / 2 + W, y, w, 1.2);
      }
      for (let k = 0; k < 12; k++) { cg.fillStyle = 'rgba(30,28,26,0.85)'; cg.beginPath(); cg.ellipse(rnd() * W, rnd() * H, 3 + rnd() * 7, 2 + rnd() * 5, 0, 0, Math.PI * 2); cg.fill(); }
    }
    // normal map from the height
    const nc = canvas(W, H), ng = nc.getContext('2d'), nimg = ng.createImageData(W, H), nd = nimg.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const l = hgt[y * W + ((x - 1 + W) % W)], r = hgt[y * W + ((x + 1) % W)], u = hgt[((y - 1 + H) % H) * W + x], dn = hgt[((y + 1) % H) * W + x];
      const nx = (l - r) * 3, ny = (u - dn) * 3, len = Math.hypot(nx, ny, 1), i = (y * W + x) * 4;
      nd[i] = (nx / len * 0.5 + 0.5) * 255; nd[i + 1] = (ny / len * 0.5 + 0.5) * 255; nd[i + 2] = (1 / len * 0.5 + 0.5) * 255; nd[i + 3] = 255;
    }
    ng.putImageData(nimg, 0, 0);
    return { map: canvasTexture(col), normalMap: canvasTexture(nc, { srgb: false }) };
  });
}

/** Lawn: 512², tileable. Many small blades over a mottled green; the ground shader mixes two scales of it. */
export function lawnTexture() {
  return cached('lawn', () => {
    const N = 512, c = canvas(N, N), g = c.getContext('2d');
    // the mottled ground: noise at half the resolution is enough under the blades
    const base = tileNoise(N / 2, 71, 5, 8), img = g.createImageData(N, N), d = img.data;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x, v = 0.72 + base[(y >> 1) * (N / 2) + (x >> 1)] * 0.5;
      d[i * 4] = 78 * v; d[i * 4 + 1] = 112 * v; d[i * 4 + 2] = 48 * v; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // blades: dark, light and a few straw-coloured strokes, each class in one path (thousands of single strokes
    // took most of the garden's start-up time)
    const rnd = seeded(72);
    const classes = [['rgba(40,62,26,0.48)', 7000], ['rgba(122,158,74,0.42)', 7000], ['rgba(170,168,96,0.42)', 1600]];
    for (const [style, n] of classes) for (const lw of [0.9, 1.4]) {
      g.strokeStyle = style; g.lineWidth = lw; g.beginPath();
      for (let k = 0; k < n / 2; k++) {
        const x = rnd() * N, y = rnd() * N, l = 3 + rnd() * 7, a = -Math.PI / 2 + (rnd() - 0.5) * 1.1, dx = Math.cos(a) * l, dy = Math.sin(a) * l;
        for (const ox of [0, -N, N]) for (const oy of [0, -N, N]) {
          if (x + ox < -10 || x + ox > N + 10 || y + oy < -10 || y + oy > N + 10) continue;
          g.moveTo(x + ox, y + oy); g.lineTo(x + ox + dx, y + oy + dy);
        }
      }
      g.stroke();
    }
    return canvasTexture(c);
  });
}
/** Gravel / earth for the path: 256², tileable. */
export function gravelTexture() {
  return cached('gravel', () => {
    const N = 256, c = canvas(N, N), g = c.getContext('2d');
    const n = tileNoise(N, 81, 5, 8), img = g.createImageData(N, N), d = img.data;
    for (let i = 0; i < N * N; i++) { const v = 0.78 + n[i] * 0.35; d[i * 4] = 176 * v; d[i * 4 + 1] = 164 * v; d[i * 4 + 2] = 146 * v; d[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    const rnd = seeded(82);
    for (let k = 0; k < 2600; k++) {
      const x = rnd() * N, y = rnd() * N, r = 0.8 + rnd() * 2.2, v = 0.55 + rnd() * 0.6;
      g.fillStyle = rgb(190 * v, 180 * v, 164 * v); g.beginPath(); g.ellipse(x, y, r, r * (0.6 + rnd() * 0.4), rnd() * 3, 0, Math.PI * 2); g.fill();
    }
    return canvasTexture(c);
  });
}

/** Pebbles for the beach by the jetty and the lake bed: 256², tileable, rounded stones in greys and browns. */
export function pebbleTexture() {
  return cached('pebbles', () => {
    const N = 256, c = canvas(N, N), g = c.getContext('2d');
    g.fillStyle = 'rgb(92,84,72)'; g.fillRect(0, 0, N, N);
    const rnd = seeded(83);
    for (let k = 0; k < 900; k++) {
      const x = rnd() * N, y = rnd() * N, r = 2.2 + Math.pow(rnd(), 2) * 7, v = 0.6 + rnd() * 0.55, warm = rnd();
      const col = [150 + warm * 30, 146 + warm * 14, 138 - warm * 10].map((q) => q * v);
      for (const ox of [0, -N, N]) for (const oy of [0, -N, N]) {
        const cx = x + ox, cy = y + oy;
        if (cx < -12 || cx > N + 12 || cy < -12 || cy > N + 12) continue;
        const gr = g.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
        gr.addColorStop(0, rgb(col[0] * 1.18, col[1] * 1.18, col[2] * 1.18)); gr.addColorStop(0.75, rgb(...col)); gr.addColorStop(1, rgb(col[0] * 0.62, col[1] * 0.62, col[2] * 0.62));
        g.fillStyle = gr; g.beginPath(); g.ellipse(cx, cy, r, r * (0.65 + rnd() * 0.3), rnd() * 3, 0, Math.PI * 2); g.fill();
      }
    }
    return canvasTexture(c);
  });
}
/** Rock for the stones on the shore: 256², four tones in its quarters (a stone takes one of them), with a normal map. */
export function rockTexture() {
  return cached('rock', () => {
    const N = 256, n1 = tileNoise(N, 61, 6, 4), n2 = tileNoise(N, 62, 4, 16);
    const col = canvas(N, N), cg = col.getContext('2d'), img = cg.createImageData(N, N), d = img.data;
    const tones = [[128, 126, 120], [138, 128, 112], [112, 116, 108], [150, 146, 138]];
    const hgt = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x, t = tones[(y < N / 2 ? 0 : 2) + (x < N / 2 ? 0 : 1)];
      const h = n1[i] * 0.75 + n2[i] * 0.25; hgt[i] = h;
      let v = 0.72 + h * 0.5;
      const lichen = Math.max(0, n2[(i * 7) % (N * N)] - 0.62) * 2.2;            // pale and greenish spots
      d[i * 4] = Math.min(255, t[0] * v + lichen * 40); d[i * 4 + 1] = Math.min(255, t[1] * v + lichen * 52); d[i * 4 + 2] = Math.min(255, t[2] * v + lichen * 18); d[i * 4 + 3] = 255;
    }
    cg.putImageData(img, 0, 0);
    const nc = canvas(N, N), ng = nc.getContext('2d'), nimg = ng.createImageData(N, N), nd = nimg.data;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const l = hgt[y * N + ((x - 1 + N) % N)], r = hgt[y * N + ((x + 1) % N)], u = hgt[((y - 1 + N) % N) * N + x], dn = hgt[((y + 1) % N) * N + x];
      const nx = (l - r) * 4, ny = (u - dn) * 4, len = Math.hypot(nx, ny, 1), i = (y * N + x) * 4;
      nd[i] = (nx / len * 0.5 + 0.5) * 255; nd[i + 1] = (ny / len * 0.5 + 0.5) * 255; nd[i + 2] = (1 / len * 0.5 + 0.5) * 255; nd[i + 3] = 255;
    }
    ng.putImageData(nimg, 0, 0);
    return { map: canvasTexture(col), normalMap: canvasTexture(nc, { srgb: false }) };
  });
}
/**
 * Ripples for the water: a tileable height field of a few dozen waves (whole periods across the tile, so it repeats
 * without a seam), stored as its slope: RG = the normal's x and z (0.5 = flat), B = the height. Several layers of it,
 * drifting with the wind at different scales, make the surface (water.js).
 */
export function waterNormalTexture() {
  return cached('water', () => {
    const N = 256, rnd = seeded(97), waves = [];
    for (let k = 0; k < 44; k++) {
      const f = 2 + Math.floor(Math.pow(rnd(), 1.6) * 22), a = rnd() * Math.PI * 2;
      const kx = Math.round(Math.cos(a) * f), ky = Math.round(Math.sin(a) * f);
      if (!kx && !ky) continue;
      waves.push([kx, ky, 1 / Math.pow(Math.hypot(kx, ky), 1.35), rnd() * Math.PI * 2]);
    }
    const h = new Float32Array(N * N), gx = new Float32Array(N * N), gy = new Float32Array(N * N);
    let max = 1e-6;
    // sin and cos of each wave's phase along x and along y once (the sum of the two angles is put together per texel)
    const W = waves.length, sx = new Float32Array(W * N), cx = new Float32Array(W * N), sy = new Float32Array(W * N), cy = new Float32Array(W * N);
    waves.forEach(([kx, ky, , ph], w) => { for (let i = 0; i < N; i++) { const ax = 2 * Math.PI * kx * i / N + ph, ay = 2 * Math.PI * ky * i / N; sx[w * N + i] = Math.sin(ax); cx[w * N + i] = Math.cos(ax); sy[w * N + i] = Math.sin(ay); cy[w * N + i] = Math.cos(ay); } });
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let v = 0, dx = 0, dy = 0;
      for (let w = 0; w < W; w++) {
        const [kx, ky, amp] = waves[w], a = w * N + x, b = w * N + y;
        // a sharper crest than a sine: water waves are narrow on top and wide in the trough
        const s = sx[a] * cy[b] + cx[a] * sy[b], c = cx[a] * cy[b] - sx[a] * sy[b], crest = 1 + 0.35 * s;
        v += amp * s * crest; dx += amp * c * (1 + 0.7 * s) * kx; dy += amp * c * (1 + 0.7 * s) * ky;
      }
      const i = y * N + x; h[i] = v; gx[i] = dx; gy[i] = dy; max = Math.max(max, Math.abs(dx), Math.abs(dy));
    }
    let hmin = Infinity, hmax = -Infinity; for (const v of h) { hmin = Math.min(hmin, v); hmax = Math.max(hmax, v); }
    const data = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) {
      data[i * 4] = Math.round(128 + 127 * gx[i] / max); data[i * 4 + 1] = Math.round(128 + 127 * gy[i] / max);
      data[i * 4 + 2] = Math.round(255 * (h[i] - hmin) / (hmax - hmin)); data[i * 4 + 3] = 255;
    }
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  });
}

// ---------------------------------------------------------------- small plants --------------------------
/**
 * Blades of grass as geometry: `blades` curved, tapering strips from the origin, `h` high, with the attributes the
 * 'grass' material needs (aOcc: darker at the root, aTipH: the blade's height for the snow). A clump for the
 * lawn or a fountain of ornamental grass.
 */
export function grassClumpGeometry({ blades = 7, h = 0.3, spread = 0.08, width = 0.012, bend = 0.35, seed = 1, segs = 3 } = {}) {
  const rnd = seeded(seed);
  const pos = [], nor = [], occ = [], tip = [], idx = [];
  for (let b = 0; b < blades; b++) {
    const a = rnd() * Math.PI * 2, r = rnd() * spread, bh = h * (0.6 + rnd() * 0.5), lean = bend * (0.5 + rnd());
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r, dx = Math.cos(a), dz = Math.sin(a);
    const face = a + Math.PI / 2 + (rnd() - 0.5) * 0.8, fx = Math.cos(face), fz = Math.sin(face);
    const base = pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs, y = bh * t, out = lean * bh * t * t, w = width * (1 - t * 0.85) * (0.8 + rnd() * 0.4);
      const cx = ox + dx * out, cz = oz + dz * out;
      if (s < segs) { pos.push(cx - fx * w, y, cz - fz * w, cx + fx * w, y, cz + fz * w); }
      else pos.push(cx, y, cz, cx, y, cz);
      // normals mostly up: a clump reads as part of the lawn, not as a bunch of lit cards
      for (let k = 0; k < 2; k++) { nor.push(dx * 0.35, 0.9, dz * 0.35); occ.push(0.55 + 0.45 * t); tip.push(bh); }
      if (s < segs) { const i0 = base + s * 2; idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aOcc', new THREE.Float32BufferAttribute(occ, 1));
  g.setAttribute('aTipH', new THREE.Float32BufferAttribute(tip, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

let steelMat = null;
const woodMats = {};
/** Weathered grey boards for the jetty, the benches and the fence outside: the deck's texture, so the same shader.
 *  `snowStyle` 'jetty': the jetty's own copy, with snow lying on its boards as on a jetty (snow-cover.js). */
export function weatheredWood(snowStyle = '') {
  if (!woodMats[snowStyle]) { const b = plankTexture({ tone: 'oak' }); woodMats[snowStyle] = natureMaterial('plain', { map: b.map, normalMap: b.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), color: 0x9d968a, roughness: 0.9, fog: false }, { puddles: 0.4, litter: 0.3, snowStyle }); }
  return woodMats[snowStyle];
}
/** Black powder-coated steel outside (the posts of the string lights, the frames of the benches). */
export function outdoorSteel() {
  steelMat ||= natureMaterial('plain', { color: 0x262626, roughness: 0.5, metalness: 0.5, fog: false });
  return steelMat;
}

let plantMat = null;
/** The terrace plants' material (the 'grass' program, colours per vertex). */
export function plantMaterial() {
  plantMat ||= natureMaterial('grass', { color: 0xffffff, vertexColors: true, roughness: 0.82, side: THREE.DoubleSide }, { uniforms: { uSnowDepth: { value: 0.12 } } });
  return plantMat;
}
/** Colour a geometry (linear rgb) for the vertex-coloured plant material. */
function tint(geo, r, g, b) {
  const n = geo.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([r, g, b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}
/** The planting of a terrace planter: ornamental grasses and lavender, `w` × `d`, on soil at height `y` (one mesh). */
export function plantingFor(w, d, y, seed = 1) {
  const rnd = seeded(seed * 7 + 3);
  const list = [];
  const n = Math.max(2, Math.round(w / 0.42));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (i + 0.5) * (w / n) + (rnd() - 0.5) * 0.06, z = (rnd() - 0.5) * d * 0.3;
    if (i % 2 === 0) {
      // a fountain of ornamental grass
      const geo = grassClumpGeometry({ blades: 34, h: 0.62 + rnd() * 0.2, spread: 0.08, width: 0.009, bend: 0.32, seed: seed * 31 + i });
      list.push(tint(geo.translate(x, y, z), 0.26, 0.32, 0.12));
    } else {
      // lavender: a grey-green cushion with purple spikes
      const leaves = grassClumpGeometry({ blades: 40, h: 0.26, spread: 0.13, width: 0.006, bend: 0.3, seed: seed * 37 + i });
      list.push(tint(leaves.translate(x, y, z), 0.26, 0.31, 0.24));
      const spikes = grassClumpGeometry({ blades: 18, h: 0.52, spread: 0.12, width: 0.011, bend: 0.12, seed: seed * 41 + i, segs: 2 });
      list.push(tint(spikes.translate(x, y, z), 0.26, 0.16, 0.52));
    }
  }
  const m = new THREE.Mesh(mergeAll(list), plantMaterial()); m.castShadow = true; m.receiveShadow = true; m.name = 'planting';
  m.userData.dynamic = true;   // its own shader (wind, custom attributes): never merged into the static batch
  return m;
}
function mergeAll(list) {
  // plain merge of indexed geometries with the same attributes
  let vCount = 0, iCount = 0;
  for (const g of list) { vCount += g.attributes.position.count; iCount += g.index.count; }
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(list[0].attributes)) {
    const size = list[0].attributes[name].itemSize, arr = new Float32Array(vCount * size);
    let o = 0; for (const g of list) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const idx = new Uint32Array(iCount); let io = 0, vo = 0;
  for (const g of list) { const src = g.index.array; for (let i = 0; i < src.length; i++) idx[io + i] = src[i] + vo; io += src.length; vo += g.attributes.position.count; g.dispose(); }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}
export { mergeAll as mergeIndexed };
