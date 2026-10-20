// Snow on the hard surfaces outside, as it lies in a garden that people walk in: on the gravel path a trodden lane of
// compacted snow down the middle with soft banks of loose snow along its edges and the gravel peeping through where the
// snow is thin; on the deck an even layer in which the joints of the boards show as fine lines, thin under the eaves
// and against the house where the boards come through; on the jetty a rounded cushion on every board, thinner at the
// boards' edges and ends. The same sparkle as on the lawn. nature.js calls snowBefore() (how much snow lies, the shape
// of its surface) before it mixes the snow's colour in and snowAfter() (its tone, gloss and glitter) right after;
// a material picks its look with `snowStyle` (nature.js: 'path', 'deck', 'jetty'; anything else keeps the even cover).
// The code is part of every 'plain' program and chosen by a uniform: no program of its own.
import * as THREE from 'three';
import { JETTY } from './outdoor.js';

/** The looks a 'plain' material can ask for (natureMaterial extra.snowStyle). */
export const SNOW_STYLES = { path: 1, deck: 2, jetty: 3 };

/** Uniforms shared by every snowy 'plain' material (nature.js adds them): the jetty's frame for its boards. */
export const SNOW_COVER = {
  // root (x, z), the direction out over the water (x, z)
  uSnowJetty: { value: new THREE.Vector4(JETTY.root[0], JETTY.root[1], JETTY.dir[0], JETTY.dir[1]) },
  // its length, half the width of the walk, the platform's length and half its width
  uSnowJetty2: { value: new THREE.Vector4(JETTY.len, JETTY.width / 2, JETTY.platLen, JETTY.platWidth / 2) },
};

export const SNOW_COVER_GLSL = `
uniform float uSnowStyle; uniform vec4 uSnowJetty; uniform vec4 uSnowJetty2;
// the slope (dh/dx, dh/dz) of a smooth field h over the surface, from its change between neighbouring pixels
vec2 snowGrad(float h) {
  vec2 px = dFdx(vNatWorld.xz), py = dFdy(vNatWorld.xz);
  float det = px.x * py.y - px.y * py.x;
  if (abs(det) < 1e-12) return vec2(0.0);
  float hx = dFdx(h), hy = dFdy(h);
  return vec2(py.y * hx - px.y * hy, px.x * hy - py.x * hx) / det;
}
// how much snow lies here (cover, 0 … 1), the shape of its surface (the world normal nW) and what shows of the surface
// under it (base: wet and darker); 'tone' (rgb) and 'gloss' (the roughness of the snow, a) go to snowAfter()
void snowBefore(inout float cover, inout vec3 nW, inout vec3 base, out vec4 tone) {
  tone = vec4(1.0, 1.0, 1.0, 0.0);
  #ifdef USE_MAP
  // (only these uniform tests may end it early: the slope below needs the neighbouring pixels)
  if (uSnowStyle < 0.5 || uSnow <= 0.0) return;
  vec2 wp = vNatWorld.xz;
  vec4 n1 = texture2D(uNatNoise, wp * 0.13), n2 = texture2D(uNatNoise, wp * 0.47 + 0.31), n3 = texture2D(uNatNoise, wp * 1.9 + 0.7);
  float h = 0.0, depth = 1.0;
  if (uSnowStyle < 1.5) {
    // the path: people walk down its middle (the lane wanders a little), the snow there is trodden flat and packed, in
    // worn patches thin enough for the gravel to come through; along the edges it lies loose and higher
    float e = abs(vMapUv.x * 2.0 - 1.0);
    float lane = 1.0 - smoothstep(0.3, 0.8, e + (n1.g - 0.5) * 0.4);
    float worn = smoothstep(0.58, 0.82, texture2D(uNatNoise, wp * 0.55 + 0.17).r + (n3.g - 0.5) * 0.25) * lane;
    depth = mix(1.1, 0.88, lane) - worn * 0.4 + (n1.r - 0.5) * 0.3 + (n2.g - 0.5) * 0.18;
    // the pebbles stand out of thin snow (the bright stones of the gravel are the high ones), wet and dark
    float stone = dot(texture2D(map, vMapUv).rgb, vec3(0.299, 0.587, 0.114));
    cover *= 1.0 - smoothstep(-0.04, 0.06, stone * 0.9 + 0.05 - depth);
    base *= vec3(0.66, 0.66, 0.68);
    // a soft step from the banks down into the lane, lumps of trodden snow in it
    h = smoothstep(0.4, 0.95, e) * 0.03 * (0.7 + 0.6 * n2.r) + (n3.b - 0.5) * 0.007 * lane;
    vec3 packed = vec3(0.89, 0.905, 0.93) * (0.95 + 0.1 * n3.r);
    tone = vec4(mix(mix(vec3(1.0), packed, lane), vec3(0.86, 0.86, 0.87), worn * 0.3), 0.5 + 0.12 * (1.0 - lane));
  } else if (uSnowStyle < 2.5) {
    // the deck: the boards run along the house (rows of the texture), each with a little more or less snow; under the
    // eaves and close to the wall only a dusting; where the snow is thin the joints show (here and there bridged by
    // it), under a thicker layer only as a faint sag
    float row = vMapUv.y * 10.0, fr = fract(row), rw = fwidth(row);
    // (a joint narrower than a pixel further off: wider and fainter, the same in sum, so it does not break into dashes)
    float joint = (1.0 - smoothstep(0.0, 0.07 + rw, min(fr, 1.0 - fr))) * 0.07 / (0.07 + rw);
    float board = fract(sin(floor(row) * 12.9898 + 4.1) * 43758.5453);
    // (the strip under the eaves runs along the boards: each board's snow begins a little nearer or further off the wall)
    float eave = smoothstep(5.95, 7.3, wp.y + (board - 0.5) * 0.3 + (n1.r - 0.5) * 0.25);
    depth = mix(0.15, 1.0, eave) + (n1.g - 0.5) * 0.5 * eave + (n2.r - 0.5) * 0.25 + (board - 0.5) * 0.14;
    float thin = 1.0 - smoothstep(0.55, 1.05, depth);
    // (a joint lies open for some decimetres, then the snow bridges it again: each joint its own stretches)
    float jv = joint * thin * smoothstep(0.42, 0.62, texture2D(uNatNoise, vec2(wp.x * 0.11, wp.y * 0.9) + 0.41).r);
    cover *= smoothstep(0.08, 0.4, depth - jv * 0.35);
    // the boards under the snow wet and darker, dry under the eaves
    base *= mix(0.97, 0.8, eave);
    h = -joint * (0.0012 + 0.003 * jv) + (n2.g - 0.5) * 0.012 + (n1.b - 0.5) * 0.018;
    tone = vec4(mix(vec3(0.93, 0.945, 0.965), vec3(1.0), smoothstep(0.35, 0.95, depth)), 0.6);
  } else {
    // the jetty: a cushion of snow on every board (one every 15.2 cm from 8 cm on, 13.8 cm deep: garden.js), rounded
    // off towards its edges and thinner at the boards' ends; people walk out along the middle
    vec2 r = wp - uSnowJetty.xy;
    float along = dot(r, uSnowJetty.zw), across = abs(dot(r, vec2(uSnowJetty.w, -uSnowJetty.z)));
    float hw = along > uSnowJetty2.x - uSnowJetty2.z ? uSnowJetty2.w : uSnowJetty2.y;
    float bf = abs(fract((along - 0.08) / 0.152 + 0.5) - 0.5) * 0.152;
    float edgeB = smoothstep(0.04, 0.069, bf) * (0.55 + 0.45 * n3.b), edgeS = smoothstep(hw - 0.24, hw - 0.02, across);
    float lane = (1.0 - smoothstep(0.18, 0.5, across)) * step(along, uSnowJetty2.x - uSnowJetty2.z + 0.6);
    depth = 0.95 + (n1.r - 0.5) * 0.8 + (n2.g - 0.5) * 0.4 - edgeB * 0.45 - edgeS * 0.8 - lane * 0.2;
    cover *= smoothstep(0.15, 0.5, depth);
    base *= 0.85;
    h = (1.0 - edgeB) * 0.006 + (n2.r - 0.5) * 0.008;
    tone = vec4(mix(vec3(1.0), vec3(0.92, 0.93, 0.95), lane), 0.58);
  }
  vec2 g = snowGrad(h);
  nW = normalize(nW - vec3(g.x, 0.0, g.y) * min(1.0, cover * 1.5));
  #endif
}
// after the snow's colour: its tone and gloss, and the glitter of the sun on it, as on the lawn (glint: nature.js adds
// it with the sun's direct light)
void snowAfter(inout vec3 col, inout float rough, inout float glint, float cover, vec4 tone) {
  if (uSnowStyle < 0.5 || cover <= 0.0) return;
  col *= mix(vec3(1.0), tone.rgb, cover);
  rough = mix(rough, tone.a, cover);
  glint = step(0.93, texture2D(uNatNoise, vNatWorld.xz * 3.7 + cameraPosition.xz * 0.03).a) * cover;
}
`;
