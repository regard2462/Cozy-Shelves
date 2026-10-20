// The sky dome: a gradient from the horizon (exactly the colour of the haze the garden fades into, nature.js) up
// to the zenith, the glow round the sun, the sun and the moon with its phase, two layers of clouds lit from the sun's
// side, the Milky Way at night and the lightning of a storm. The stars are points of their own (makeStars), drawn after
// the dome where the sky is visible. The same functions give the lake its reflection (garden.js).
// It is drawn after everything opaque, so only the pixels where the sky is really visible are shaded.
import * as THREE from 'three';
import { NATURE, HAZE_GLSL, noiseTexture } from './nature.js';
import { starCatalog } from './celestial.js';

export const SKY = {
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uSunGlow: { value: new THREE.Color() },
  uSunDisc: { value: new THREE.Color() },
  uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
  uMoon: { value: 0 },                                   // radiance of the moon's lit face (0: not drawn)
  uMoonGlow: { value: 0 },                               // the light round the moon in the air
  uMoonU: { value: new THREE.Vector3(1, 0, 0) },         // on the disc: towards the sun …
  uMoonV: { value: new THREE.Vector3(0, 0, 1) },         // … and across
  uMoonX: { value: new THREE.Vector3(1, 0, 0) },         // the face's own right …
  uMoonY: { value: new THREE.Vector3(0, 1, 0) },         // … and up (its seas stay where they are)
  uMoonL: { value: new THREE.Vector3(0, 0, 1) },         // the sunlight on the moon in (U, V, towards the eye)
  uStars: { value: 0 },                                  // how much of the starry sky shows (dusk, clouds, fog)
  uMilky: { value: 0 },                                  // the Milky Way's brightness
  uSkyRot: { value: new THREE.Matrix3() },               // equatorial → world (celestial.js skyRotation)
  uGalRot: { value: new THREE.Matrix3() },               // world → galactic
  uCloudCover: { value: 0.3 },
  uCloudLit: { value: new THREE.Color() },
  uCloudShade: { value: new THREE.Color() },
  uCloudSpeed: { value: 1 },
  uOvercast: { value: 0 },
  uFlash: { value: 0 },
  uNoise: { value: null },
};
/** The moon's radius on the sky (radians; about three times the real one, which looked like a dot on the screen). */
export const MOON_R = 0.0175;

/** Uniform declarations and functions: skyColor(dir) (gradient, glow, discs), skyClouds(dir) → rgb + cover,
 *  milkyWay(dir). */
export const SKY_GLSL = `
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunGlow; uniform vec3 uSunDisc;
uniform vec3 uMoonDir; uniform float uMoon; uniform float uMoonGlow; uniform vec3 uMoonU; uniform vec3 uMoonV; uniform vec3 uMoonX; uniform vec3 uMoonY; uniform vec3 uMoonL;
uniform float uStars; uniform float uMilky; uniform mat3 uSkyRot; uniform mat3 uGalRot; uniform float uCloudCover; uniform float uCloudSpeed;
uniform vec3 uCloudLit; uniform vec3 uCloudShade; uniform float uOvercast; uniform float uFlash; uniform sampler2D uNoise;
uniform float uTime; uniform vec3 uSunDirW; uniform vec3 uSunLight;
uniform vec3 uHazeColor; uniform vec3 uHazeSun; uniform float uHazeDensity; uniform float uHazeMax; uniform float uHazeStart;
${HAZE_GLSL}
// the moon's face: the dark seas (the "man in the moon" as seen from the north), fine detail, Tycho's bright rays
float moonFace(vec2 f) {
  float sea = 0.0;
  sea += exp(-dot(f - vec2(-0.3, 0.36), f - vec2(-0.3, 0.36)) / 0.055);        // Imbrium
  sea += exp(-dot(f - vec2(-0.56, 0.02), f - vec2(-0.56, 0.02)) / 0.07) * 0.9; // Procellarum
  sea += exp(-dot(f - vec2(0.13, 0.34), f - vec2(0.13, 0.34)) / 0.022);        // Serenitatis
  sea += exp(-dot(f - vec2(0.27, 0.08), f - vec2(0.27, 0.08)) / 0.03);         // Tranquillitatis
  sea += exp(-dot(f - vec2(0.62, 0.26), f - vec2(0.62, 0.26)) / 0.009);        // Crisium
  sea += exp(-dot(f - vec2(0.5, -0.12), f - vec2(0.5, -0.12)) / 0.012) * 0.8;  // Fecunditatis
  sea += exp(-dot(f - vec2(0.33, -0.24), f - vec2(0.33, -0.24)) / 0.006) * 0.8; // Nectaris
  sea += exp(-dot(f - vec2(-0.2, -0.34), f - vec2(-0.2, -0.34)) / 0.025) * 0.8; // Nubium
  sea += exp(-pow((f.y - 0.64) / 0.06, 2.0)) * smoothstep(0.45, 0.1, abs(f.x + 0.05)) * 0.7;   // Frigoris
  float n = textureLod(uNoise, f * 0.45 + 0.21, 0.0).g * 0.6 + textureLod(uNoise, f * 1.7 + 0.53, 0.0).b * 0.4;
  float a = 1.0 - 0.36 * smoothstep(0.25, 0.9, sea + (n - 0.5) * 0.5);
  vec2 ty = f - vec2(-0.12, -0.63);
  a += 0.25 * exp(-dot(ty, ty) / 0.0012);                                        // Tycho
  a += 0.05 * smoothstep(0.03, 0.0, abs(fract(atan(ty.y, ty.x) * 2.4) - 0.5) - 0.42) * exp(-length(ty) * 3.5);   // its rays
  return a * (0.9 + 0.2 * n);
}
vec3 skyColor(vec3 d, bool discs) {
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.5));
  // down at the horizon the sky has the colour of the haze: the far hills melt into it
  col = mix(natHazeColor(d), col, smoothstep(-0.03, 0.3, h));
  float s = max(dot(d, uSunDirW), 0.0);
  col += uSunGlow * (pow(s, 48.0) * 0.9 + pow(s, 7.0) * 0.28);
  float m = dot(d, uMoonDir);
  // the air round the moon glows a little (more in a thin haze)
  col += vec3(0.55, 0.62, 0.78) * uMoonGlow * (pow(max(m, 0.0), 900.0) * 0.18 + pow(max(m, 0.0), 40.0) * 0.012);
  if (discs) {
    col += uSunDisc * smoothstep(0.99975, 0.99988, s);
    if (uMoon > 0.0 && m > ${Math.cos(MOON_R * 1.08).toFixed(7)}) {
      // the moon: a sphere lit from the sun's side, the dark part only by the earth
      vec3 q = d - uMoonDir * m;
      vec2 p = vec2(dot(q, uMoonU), dot(q, uMoonV)) / ${MOON_R.toFixed(5)};
      float r = length(p);
      vec3 n = vec3(p, sqrt(max(1.0 - r * r, 0.0)));
      float lit = smoothstep(-0.035, 0.06, dot(n, uMoonL));
      float face = moonFace(vec2(dot(q, uMoonX), dot(q, uMoonY)) / ${MOON_R.toFixed(5)});
      // darker towards the rim a little (the limb), earthshine on the night side
      float limb = 0.82 + 0.18 * n.z;
      col += vec3(0.97, 0.95, 0.9) * face * limb * uMoon * (lit + 0.018 * (1.0 - lit)) * smoothstep(1.0, 0.93, r);
    }
  }
  return col;
}
// two drifting layers on a plane high above; lit where they thin out towards the sun
float cloudDensity(vec2 p) {
  return texture2D(uNoise, p * 0.23).r * 0.5 + texture2D(uNoise, p * 0.61 + 0.37).g * 0.32 + texture2D(uNoise, p * 1.7 + 0.71).b * 0.18;
}
vec4 skyClouds(vec3 d) {
  if (d.y < 0.01) return vec4(0.0);
  vec2 p = d.xz / (d.y + 0.07) * 0.55 + vec2(uTime * 0.0045, uTime * 0.0017) * uCloudSpeed;
  float n = cloudDensity(p);
  float lo = 1.0 - uCloudCover;
  float dens = smoothstep(lo - 0.1, lo + 0.22, n);
  vec2 toSun = normalize(uSunDirW.xz + vec2(1e-4)) * 0.09;
  float n2 = cloudDensity(p + toSun);
  float lit = clamp(0.55 + (n - n2) * 5.0, 0.0, 1.0);
  // an overcast sky is one closed, evenly lit layer with soft structure (patchy dark clouds looked like a storm)
  dens = mix(dens, 1.0, uOvercast * 0.9);
  lit = mix(lit, 0.45 + 0.3 * n, uOvercast * 0.8);
  vec3 c = mix(uCloudShade, uCloudLit, lit);
  float s = max(dot(d, uSunDirW), 0.0);
  c += uSunGlow * pow(s, 10.0) * 0.5 * (1.0 - dens * 0.6);   // silver lining
  return vec4(c, dens * smoothstep(0.01, 0.2, d.y));
}
// The Milky Way: a band along the galactic plane, broad and bright towards Sagittarius and Scutum, thin and faint towards
// Auriga, with the star clouds of Cygnus, Scutum and Sagittarius and the dark lanes of dust (the Great Rift from Cygnus to
// Sagittarius, a little north of the middle). Longitudes in turns: the noise tiles round the sky.
vec3 milkyWay(vec3 d) {
  vec3 g = uGalRot * d;
  float b = asin(clamp(g.z, -1.0, 1.0));
  float l = atan(g.y, g.x), lu = l / 6.28318 + 0.5;
  float c = 0.5 + 0.5 * cos(l);                       // 1 towards the centre (Sagittarius), 0 towards Auriga
  float width = 0.15 + 0.12 * c;
  // clouds of stars at three scales, a little longer along the band (whole numbers of the noise's tile round the sky)
  float big = texture2D(uNoise, vec2(lu * 6.0, b * 1.4 + 0.31)).r;
  float mid = texture2D(uNoise, vec2(lu * 12.0, b * 2.6 + 0.57)).g;
  float fine = texture2D(uNoise, vec2(lu * 22.0, b * 4.6 + 0.13)).b;
  float band = exp(-pow(b / width, 2.0)), core = exp(-pow((b + 0.01) / (width * 0.45), 2.0));
  float mottle = clamp(0.2 + 0.6 * big + 0.35 * mid + 0.15 * fine, 0.0, 1.6);
  float glow = (0.3 + 0.7 * pow(c, 1.4)) * (band * 0.55 + core * 0.6 * (0.4 + 0.6 * c)) * mottle * mottle;
  // a faint wide glow round it: the band has no edge
  glow += 0.16 * (0.4 + 0.6 * c) * exp(-pow(b / (width * 2.2), 2.0));
  // the bright star clouds of Cygnus, Scutum and Sagittarius
  glow += 0.4 * exp(-pow((l - 1.31) / 0.22, 2.0) - pow((b - 0.01) / 0.08, 2.0)) * (0.4 + 0.9 * mid);
  glow += 0.5 * exp(-pow((l - 0.47) / 0.1, 2.0) - pow((b + 0.03) / 0.06, 2.0)) * (0.4 + 0.9 * big);
  glow += 0.9 * exp(-pow((l - 0.06) / 0.17, 2.0) - pow((b + 0.05) / 0.09, 2.0)) * (0.4 + 0.9 * mid);
  // the dust: dark blotches and threads along the middle, the Great Rift from Cygnus to Sagittarius
  float dn = texture2D(uNoise, vec2(lu * 14.0, b * 3.4 + 0.83)).a * 0.55 + mid * 0.45;
  float dust = smoothstep(0.52, 0.74, dn) * exp(-pow((b - 0.02) / (width * 0.45), 2.0));
  float rift = smoothstep(0.44, 0.64, big * 0.55 + dn * 0.45) * exp(-pow((b - 0.03) / 0.045, 2.0)) * smoothstep(1.85, 1.35, l) * smoothstep(-0.7, -0.2, l);
  glow *= (1.0 - 0.42 * dust) * (1.0 - 0.62 * rift);
  glow *= 0.85 + 0.3 * fine;
  vec3 col = mix(vec3(0.76, 0.82, 1.0), vec3(1.0, 0.9, 0.77), clamp(c * core * 1.3, 0.0, 1.0));
  return col * glow * uMilky;
}
`;

const vert = `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p;
}`;
const frag = `
${SKY_GLSL}
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyColor(d, true);
  vec4 cl = skyClouds(d);
  // the Milky Way, dimmer towards the horizon (the air), hidden by the clouds
  if (uMilky > 0.0 && d.y > -0.02) col += milkyWay(d) * smoothstep(-0.02, 0.25, d.y);
  col = mix(col, cl.rgb, cl.a);
  col += uFlash * vec3(0.75, 0.78, 0.9);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function makeSky() {
  SKY.uNoise.value = noiseTexture();
  const uniforms = { ...SKY, uTime: NATURE.uTime, uSunDirW: NATURE.uSunDirW, uSunLight: NATURE.uSunLight, uHazeColor: NATURE.uHazeColor, uHazeSun: NATURE.uHazeSun, uHazeDensity: NATURE.uHazeDensity, uHazeMax: NATURE.uHazeMax, uHazeStart: NATURE.uHazeStart };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, side: THREE.BackSide, depthWrite: false, fog: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(240, 48, 24), mat);
  sky.frustumCulled = false;
  sky.renderOrder = 1000;       // after everything opaque: only the visible sky is shaded
  sky.name = 'sky';
  return sky;
}

// ---------------------------------------------------------------- the stars ----------------------------------------------
// Every star a soft point at the far end of the depth range: it shows only where nothing stands in front (the house, the
// trees, the hills), through the glass as well. Brightness from the magnitude (compressed: the faint ones are what makes
// a starry sky), dimmer, redder and twinkling towards the horizon, hidden by the clouds and by the moon's disc.
const starVert = `
${SKY_GLSL}
attribute vec3 aEq; attribute vec2 aMag; attribute vec3 aColor;
uniform float uPx;
varying vec3 vCol; varying float vR;
void main() {
  vec3 d = uSkyRot * aEq;
  float alt = d.y;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vCol = vec3(0.0); vR = 1.0;
  if (uStars < 0.002 || alt < -0.005) return;
  float flux = pow(10.0, -0.4 * aMag.x);
  float b = pow(flux, 0.55) * 2.4;
  float air = 1.0 / max(alt + 0.03, 0.03);
  b *= exp(-0.11 * (air - 1.0)) * smoothstep(-0.005, 0.07, alt);
  float low = 1.0 - smoothstep(0.08, 0.55, alt);
  b *= 1.0 + low * 0.55 * sin(uTime * (5.0 + 7.0 * aMag.y) + aMag.y * 50.0) * sin(uTime * (1.7 + 2.9 * aMag.y) + aMag.y * 23.0);
  b *= (1.0 - skyClouds(d).a) * uStars * step(dot(d, uMoonDir), ${Math.cos(MOON_R).toFixed(7)});
  if (b < 0.0015) return;
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * d * 100.0, 1.0);
  clip.z = clip.w * 0.999995;
  gl_Position = clip;
  float size = clamp(2.1 + 1.3 * log2(1.0 + flux * 2.5), 2.1, 6.0) * uPx;
  gl_PointSize = size + 2.0;
  vR = size;
  vCol = aColor * b * mix(vec3(1.0), vec3(1.0, 0.86, 0.72), low * 0.6);
}`;
const starFrag = `
varying vec3 vCol; varying float vR;
void main() {
  vec2 p = (gl_PointCoord - 0.5) * (vR + 2.0);
  float s = 0.42 + 0.16 * vR;
  float a = exp(-dot(p, p) / (2.0 * s * s));
  if (a < 0.015) discard;
  gl_FragColor = vec4(vCol * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
/** The starry sky: { points, uniforms } (uPx: the drawing buffer's pixels per 1080 lines, set by environment.js). */
export function makeStars() {
  const cat = starCatalog();
  const geo = new THREE.BufferGeometry();
  // (the position is not used: the shader turns aEq; three wants one to count the points)
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cat.count * 3), 3));
  geo.setAttribute('aEq', new THREE.BufferAttribute(cat.eq, 3));
  geo.setAttribute('aMag', new THREE.BufferAttribute(cat.mag, 2));
  geo.setAttribute('aColor', new THREE.BufferAttribute(cat.color, 3));
  const uniforms = { ...SKY, uTime: NATURE.uTime, uSunDirW: NATURE.uSunDirW, uSunLight: NATURE.uSunLight, uHazeColor: NATURE.uHazeColor, uHazeSun: NATURE.uHazeSun, uHazeDensity: NATURE.uHazeDensity, uHazeMax: NATURE.uHazeMax, uHazeStart: NATURE.uHazeStart, uPx: { value: 1 } };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: starVert, fragmentShader: starFrag, transparent: true, depthWrite: false, depthTest: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, fog: false });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = -5;          // the first of the transparent things: the glass, the water and the rain go over it
  points.name = 'stars';
  points.userData.noAO = true;
  return { points, uniforms, count: cat.count };
}
