// The small plants of the garden that are made of geometry, not of foliage cards: the water lilies on the lake (their
// pads and pink blossoms, lilies.js), the reeds and cattails along the shore (reeds.js) and the leaves that fall in
// autumn (seasons.js). They all share one material and so one shader program (a garden material of nature.js, lit by
// the sky and the sun, in the haze, under snow, in the fire's glow): each vertex says which part it belongs to (aPart.x)
// and the shader shapes and colours it accordingly.
//
// Every flora geometry carries the same attributes: position, normal, uv, aPart (vec4: kind and what that kind needs,
// below) and per instance aInst (vec4) and an instance colour (a tint).
//   kind 0  lily pad      uv (radius 0…1, angle), aPart.y the angle from the notch; aInst (curl of the rim, young (red),
//                         seed, 0). The rim waves and curls up, the top shines, fine veins run out from the middle.
//   kind 1  petal         uv (t along, s across), aPart (1, azimuth, ring 0 sepal … 3 inner, random); aInst (how far the
//                         flower opens: 0 a bud, how deep its pink, seed, 0). Opened by day, closed at night (uLilyOpen).
//   kind 2  stamen        like a petal, the yellow threads in the middle
//   kind 3  centre        the yellow disc in the middle
//   kind 4 … 9            reeds: 4 stem, 5 leaf, 6 plume, 7 cattail leaf, 8 cattail cob, 9 its spike; aPart (kind, height
//                         0…1 up the plant, how much it flutters, the stem's random number: a stem below uReedOld is
//                         last year's, dry); aInst (seed, 0, 0, 0).
//                         They bend with the wind of the weather (natWind), the leaves and plumes flutter.
//   kind 10 fallen leaf   a leaf drifting down in autumn (moved on the CPU)
import * as THREE from 'three';
import { natureMaterial } from './nature.js';

/** What changes with the time of day and the season (seasons.js sets them). Colours are linear rgb. */
export const FLORA = {
  uLilyOpen: { value: 1 },                                  // the blossoms: 1 open by day … 0 closed at night
  uPadAutumn: { value: 0 },                                 // the pads yellow and brown in autumn, wither in winter
  uReedStem: { value: new THREE.Color(0.15, 0.21, 0.07) },
  uReedLeaf: { value: new THREE.Color(0.12, 0.19, 0.06) },
  uReedPlume: { value: new THREE.Color(0.3, 0.2, 0.19) },
  uReedDry: { value: new THREE.Color(0.42, 0.36, 0.22) },   // last year's dry stems (in spring between the new ones)
  uReedOld: { value: 0.0 },                                  // how many of the stems are last year's (0 … 1)
  uCattail: { value: new THREE.Color(0.12, 0.2, 0.06) },
  uCob: { value: new THREE.Color(0.12, 0.065, 0.03) },
};

const vertexPars = `
attribute vec4 aPart; attribute vec4 aInst; attribute vec3 aPivot;
uniform float uLilyOpen;
varying vec4 vFPart; varying vec4 vFInst; varying vec2 vFUv;
// a lily petal (kinds 1 … 3) at (t along, s across) of ring \`ring\`, azimuth phi, opened by \`open\`: position and normal
void floraPetal(float kind, float ring, float phi, float rnd, float open, inout vec3 p, inout vec3 n) {
  float t = uv.x, s = uv.y;
  // per ring: length, width, distance of the base from the middle, the angle from the vertical closed and open, height
  float L = ring < 0.5 ? 0.058 : ring < 1.5 ? 0.064 : ring < 2.5 ? 0.056 : 0.046;
  float W = ring < 0.5 ? 0.027 : ring < 1.5 ? 0.025 : ring < 2.5 ? 0.022 : 0.018;
  float r0 = ring < 0.5 ? 0.013 : ring < 1.5 ? 0.011 : ring < 2.5 ? 0.009 : 0.007;
  float closed = ring < 0.5 ? 0.16 : ring < 1.5 ? 0.11 : ring < 2.5 ? 0.07 : 0.04;
  float wide = ring < 0.5 ? 1.5 : ring < 1.5 ? 1.32 : ring < 2.5 ? 1.02 : 0.66;
  float h0 = ring < 0.5 ? 0.004 : ring < 1.5 ? 0.007 : ring < 2.5 ? 0.010 : 0.013;
  if (kind > 1.5) { L = 0.018; W = 0.0016; r0 = kind > 2.5 ? 0.0 : 0.006 + 0.005 * rnd; closed = 0.06; wide = 0.62; h0 = 0.012; }
  float th = mix(closed, wide, open) + (rnd - 0.5) * 0.16 * open;
  vec3 o = vec3(cos(phi), 0.0, sin(phi)), tg = vec3(-sin(phi), 0.0, cos(phi)), up = vec3(0.0, 1.0, 0.0);
  vec3 ax = cos(th) * up + sin(th) * o, nin = -cos(th) * o + sin(th) * up;
  // the outline: narrow at the base, widest a third of the way, pointed at the tip
  float w = W * pow(sin(3.14159 * pow(t, 0.72)), 0.85);
  // cupped across, the tip bent outwards when open and inwards when closed (a pointed bud)
  float cup = 0.4 * W * s * s + L * t * t * (0.06 * (1.0 - open) - 0.12 * open);
  if (kind > 2.5) { p = vec3(uv.y * 0.009 * cos(uv.x * 6.2832), 0.014, uv.y * 0.009 * sin(uv.x * 6.2832)); n = up; return; }
  p = o * r0 + up * h0 + ax * (t * L) + tg * (s * w) + nin * cup;
  n = normalize(nin - tg * (0.8 * s));
}
`;
// before three transforms the normal: shape the part (the position goes on in begin_vertex)
const beginNormal = `
vec3 floraPos = position;
{
  float kind = aPart.x;
  if (kind > 0.5 && kind < 3.5) {
    // a bud (aInst.x 0) stays closed; open blossoms close at dusk and open in the morning
    floraPetal(kind, aPart.z, aPart.y, aPart.w, clamp(aInst.x * uLilyOpen, 0.0, 1.0), floraPos, objectNormal);
  } else if (kind < 0.5) {
    // a lily pad: the rim waves a little and curls up on some pads
    float r = uv.x, a = aPart.y, sd = aInst.z * 40.0;
    float curl = aInst.x;
    float hgt = curl * r * r * r * (0.65 + 0.35 * sin(5.0 * a + sd)) + 0.012 * r * r * sin(7.0 * a + sd * 1.7);
    float dr = 3.0 * curl * r * r * (0.65 + 0.35 * sin(5.0 * a + sd)) + 0.024 * r * sin(7.0 * a + sd * 1.7);
    float da = curl * r * r * r * 1.75 * cos(5.0 * a + sd) + 0.084 * r * r * cos(7.0 * a + sd * 1.7);
    floraPos.y += hgt;
    floraPos.xz *= 1.0 + 0.03 * r * sin(6.0 * a + sd * 2.3);
    vec2 rd = normalize(floraPos.xz + vec2(1e-5)), td = vec2(-rd.y, rd.x);
    vec2 g = rd * dr + td * da / max(r, 0.05);
    objectNormal = normalize(vec3(-g.x, 1.0, -g.y));
  }
}
`;
const vertexBody = `
  transformed = floraPos;
  vFPart = aPart; vFInst = aInst; vFUv = uv;
  if (aPart.x > 3.5 && aPart.x < 9.5) {
    // reeds and cattails: the leaves (aPart.z ≥ 2) draw back into the stem between 15 and 24 m (beyond, reeds.js
    // shows clumps without them); everything bends with the wind, more the higher up, leaves and plumes flutter
    float collapse = step(1.5, aPart.z), flutter = aPart.z - 2.0 * collapse;
    if (collapse > 0.5) transformed = mix(transformed, aPivot, smoothstep(15.0, 24.0, distance(nBase.xz, cameraPosition.xz)));
    float t = aPart.y;
    vec3 wv = natWind(nBase) * (0.55 * t * t);
    float ph = uTime * (5.2 + 2.0 * aPart.w) + aPart.w * 40.0 + nBase.x * 0.7;
    wv += vec3(sin(ph), 0.0, cos(ph * 0.83)) * flutter * 0.055 * uWind * t;
    transformed += nToLocal * wv;
  }
`;
const fragmentPars = `
uniform float uPadAutumn; uniform vec3 uReedStem; uniform vec3 uReedLeaf; uniform vec3 uReedPlume; uniform vec3 uReedDry;
uniform float uReedOld; uniform vec3 uCattail; uniform vec3 uCob;
varying vec4 vFPart; varying vec4 vFInst; varying vec2 vFUv;
float floraHash(float n) { return fract(sin(n) * 43758.5453); }
`;
// thin parts are lit like grass (the same light on both sides); pads and petals have two real sides
const normalFragment = `
  if (vFPart.x > 3.5) normal = normalize(vNormal);
`;
const colorFragment = `
{
  float kind = vFPart.x;
  vec3 col = vec3(1.0);
  if (kind < 0.5) {
    // the pad: dark green, lighter towards the middle, fine radial veins, a darker rim; young pads reddish; the
    // underside red-brown (it shows where the rim curls up); in autumn yellow and brown from the rim inwards
    float r = vFUv.x, a = vFPart.y, sd = vFInst.z;
    float vein = pow(abs(cos(a * 11.0 + sin(r * 7.0 + sd * 9.0) * 0.12)), 60.0) * smoothstep(0.08, 0.3, r) * (1.0 - smoothstep(0.8, 0.95, r));
    float mid = pow(abs(cos((a - 3.14159) * 0.5)), 400.0) * (1.0 - smoothstep(0.75, 0.97, r));
    vec3 top = mix(vec3(0.065, 0.13, 0.032), vec3(0.04, 0.088, 0.022), smoothstep(0.15, 0.9, r));
    top *= 0.9 + 0.2 * floraHash(floor(a * 7.0) + sd * 31.0);
    top = mix(top, vec3(0.07, 0.13, 0.035), (vein * 0.28 + mid * 0.5));
    top = mix(top, vec3(0.025, 0.045, 0.015), smoothstep(0.9, 1.0, r) * 0.6);
    top = mix(top, vec3(0.14, 0.05, 0.03) * (0.9 + 0.2 * vein), vFInst.y);
    float yel = smoothstep(0.25, 0.85, uPadAutumn * (0.55 + 0.6 * r) + (floraHash(sd * 91.0) - 0.5) * 0.5);
    top = mix(top, mix(vec3(0.3, 0.22, 0.04), vec3(0.16, 0.08, 0.025), smoothstep(0.7, 1.0, r + floraHash(sd * 13.0) * 0.3)), yel);
    // withered in winter: dark brown, half sunk
    top = mix(top, vec3(0.07, 0.045, 0.02) * (0.8 + 0.4 * floraHash(sd * 7.0)), smoothstep(0.9, 1.0, uPadAutumn));
    vec3 under = mix(vec3(0.16, 0.035, 0.05), vec3(0.09, 0.05, 0.03), uPadAutumn);
    col = gl_FrontFacing ? top : under;
  } else if (kind < 3.5) {
    float ring = vFPart.z, t = vFUv.x, hue = vFInst.y;
    if (kind > 2.5) col = vec3(0.86, 0.6, 0.06);                                   // the disc in the middle
    else if (kind > 1.5) col = mix(vec3(0.85, 0.5, 0.05), vec3(1.0, 0.78, 0.18), smoothstep(0.55, 0.9, t));   // stamens, anthers
    else {
      // petals: white at their base, pink towards the tip, from a pale pink to a deep one; the inner ones paler
      vec3 pink = mix(vec3(0.96, 0.4, 0.58), vec3(0.8, 0.07, 0.3), hue);
      float k = smoothstep(0.0, 0.7, t) * (1.0 - 0.22 * smoothstep(1.5, 3.0, ring));
      col = mix(vec3(0.95, 0.84, 0.88), pink, k);
      // the sepals are olive green outside
      if (ring < 0.5 && !gl_FrontFacing) col = mix(vec3(0.09, 0.12, 0.04), vec3(0.4, 0.14, 0.2), smoothstep(0.6, 1.0, t) * 0.6);
    }
  } else if (kind < 9.5) {
    // reeds: green in summer with purple-brown plumes, golden in autumn, pale straw in winter (seasons.js); some of
    // the stems are last year's, dry among the new ones in spring
    float dry = step(vFPart.w, uReedOld);   // (aPart.w: the stem's own random number)
    if (kind < 4.5) col = uReedStem;
    else if (kind < 5.5) col = uReedLeaf;
    else if (kind < 6.5) col = uReedPlume * (0.75 + 0.6 * vFUv.x);
    else if (kind < 7.5) col = uCattail;
    else if (kind < 8.5) col = uCob;
    else col = uReedDry * 0.8;
    if (kind < 7.5) col = mix(col, kind > 5.5 ? vec3(0.4, 0.37, 0.33) : uReedDry, dry);
    // darker at the foot, in the water and the shade of the clump
    col *= 0.55 + 0.45 * smoothstep(0.0, 0.35, vFPart.y);
  } else col = vec3(1.0);                                                         // a falling leaf: its instance colour
  diffuseColor.rgb *= col;
}
`;
const snowFragment = `
  {
    float kind = vFPart.x;
    // glossy pads, silky petals, matt reeds
    roughnessFactor = kind < 0.5 ? (gl_FrontFacing ? 0.46 : 0.75) : kind < 3.5 ? 0.55 : 0.8;
    // the waxy top of a pad mirrors the sky at a low angle
    if (kind < 0.5 && gl_FrontFacing) {
      float fr = pow(1.0 - max(dot(normal, normalize(vViewPosition)), 0.0), 5.0);
      totalEmissiveRadiance += fr * uHazeColor * 0.13 * (1.0 - cover);
    }
    // thin petals and leaves glow when the sun shines through them
    if (kind > 0.5 && kind < 3.5 || kind > 4.5 && kind < 7.5 || kind > 9.5) {
      vec3 sunV = normalize(mat3(viewMatrix) * uSunDirW);
      float back = pow(max(dot(-normalize(vViewPosition), sunV), 0.0), 3.0);
      totalEmissiveRadiance += diffuseColor.rgb * uSunLight * back * (kind < 3.5 ? 0.45 : 0.25) * (1.0 - cover);
    }
    // nothing of the pads and the blossoms lies under snow (they are gone in winter); reeds catch a little
    if (kind < 3.5) cover = 0.0; else if (kind < 9.5) cover *= 0.6;
  }
`;

let mat = null;
/** The one flora material (created once; every flora mesh uses it). */
export function floraMaterial() {
  if (mat) return mat;
  mat = natureMaterial('plain', { color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide, fog: false }, {
    key: ':flora', noLamps: true, uniforms: FLORA,
    vertexPars, beginNormal, vertexBody, fragmentPars, normalFragment, colorFragment, snowFragment,
  });
  mat.userData.flora = true;
  return mat;
}

/**
 * A flora geometry from plain arrays: pos, nor, uv (2), part (4) per vertex, idx; `count` instances with aInst
 * (4 per instance, filled later by the caller).
 */
export function floraGeometry({ pos, nor, uv, part, idx }, count) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 4));
  g.setAttribute('aPivot', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
  g.setAttribute('aInst', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, count) * 4), 4));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

/** An instanced flora mesh: shadows received (the trees' and the jetty's), cast by none, outside the AO pass. */
export function floraMesh(geo, count, name) {
  const m = new THREE.InstancedMesh(geo, floraMaterial(), Math.max(1, count));
  m.count = count;
  m.castShadow = false; m.receiveShadow = true; m.userData.noAO = true; m.name = name;
  // (every flora mesh has instance colours: the same program for all of them)
  m.setColorAt(0, new THREE.Color(1, 1, 1));
  return m;
}
