// The lake's surface: one transparent mesh over the hollow of the lake (outdoor.js), its rings close together at the
// shore, and every vertex knows how deep the water below it is. The shader draws ripples drifting with the wind (three
// scales of one tileable wave texture: a mirror in fog, choppy in a storm), the sky, its clouds and the trees of the
// far shore mirrored with a Fresnel weight, the lake bed showing through shallow water and fading into a green-brown
// depth, the glint of the sun, rings where the rain falls, in winter a darker lake with a thin rim of ice along the
// shore (seasons.js) and, when it snows, ice under a cover of snow. The lake bed itself is the garden's ground
// (garden.js), seen through the blended water; the water lilies float on it (lilies.js).
import * as THREE from 'three';
import { NATURE, RAIN_RINGS_GLSL, waterNormalTexture, noiseTexture } from './nature.js';
import { SKY, SKY_GLSL } from './sky.js';
import { LAKE, WATER_Y, terrainHeight, shoreScale, TREES, JETTY } from './outdoor.js';

const vert = `
attribute float aDepth;
varying vec3 vWorld; varying float vDepth;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz; vDepth = aDepth;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const frag = `
${SKY_GLSL}
uniform vec3 uSkyLight; uniform float uFrozen; uniform float uSnow; uniform float uWind; uniform float uRain; uniform float uWinterW;
uniform float uNightGrade; uniform vec3 uNightTint;
uniform sampler2D uWaves; uniform sampler2D uSkyline; uniform vec3 uTreeLine; uniform vec2 uLakeC;
uniform vec4 uJettyA; uniform vec4 uJettyB; uniform float uJettyY; uniform vec4 uJettyPosts[8];
varying vec3 vWorld; varying float vDepth;
${RAIN_RINGS_GLSL}
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
// the slope of the ripples: three drifting layers of one tile, the finest only near the eye
vec2 waveSlope(vec2 p, float dist) {
  vec2 drift = vec2(1.0, 0.28) * uTime;
  vec2 s = (texture2D(uWaves, p * 0.043 + drift * 0.005).xy - 0.5)
         + (texture2D(uWaves, p * 0.12 + vec2(drift.y, -drift.x) * 0.012 + 0.31).xy - 0.5) * 0.75
         + (texture2D(uWaves, p * 0.36 + drift * 0.03 + 0.67).xy - 0.5) * 0.55 * (1.0 - smoothstep(20.0, 55.0, dist));
  return s;
}
// the jetty in the water: where the mirrored ray meets its boards (their underside, dark) or one of its posts
float jettyMirror(vec3 p, vec3 R) {
  vec2 r0 = p.xz - uJettyA.xy;
  if (dot(r0, uJettyA.zw) < -6.0 || dot(r0, uJettyA.zw) > uJettyB.x + 8.0 || abs(dot(r0, vec2(uJettyA.w, -uJettyA.z))) > 9.0) return 0.0;
  float hit = 0.0;
  // the boards: the plane 8 cm under their top
  float t = (uJettyY - 0.08 - p.y) / max(R.y, 1e-3);
  vec2 q = p.xz + R.xz * t - uJettyA.xy;
  float along = dot(q, uJettyA.zw), across = abs(dot(q, vec2(uJettyA.w, -uJettyA.z)));
  if (along > 0.0 && along < uJettyB.x && across < (along > uJettyB.x - uJettyB.z ? uJettyB.w : uJettyB.y)) hit = 1.0;
  // the posts: thin vertical lines from the water up to the boards
  for (int i = 0; i < 8; i++) {
    vec4 pp = uJettyPosts[i];
    vec2 d = pp.xy - p.xz;
    float s = dot(d, R.xz) / max(dot(R.xz, R.xz), 1e-6);   // where the ray passes the post
    vec2 c = p.xz + R.xz * s - pp.xy;
    float h = p.y + R.y * s;
    if (s > 0.0 && dot(c, c) < pp.z * pp.z && h < uJettyY) hit = 1.0;
  }
  return hit;
}
// the stars mirrored: a cell of the turning sky holds one now and then (the points of sky.js do not reach the water)
vec3 lakeStars(vec3 R) {
  vec3 e = transpose(uSkyRot) * R;
  vec3 g = e * 70.0, c = floor(g);
  float h = hash21(c.xy + c.z * 17.17);
  if (h < 0.975) return vec3(0.0);
  float d = length(fract(g) - 0.5);
  return vec3(0.9, 0.93, 1.0) * (0.2 + 0.8 * pow(fract(h * 71.3), 3.0)) * smoothstep(0.32, 0.04, d) * uStars * 0.9 * smoothstep(0.01, 0.12, R.y);
}
void main() {
  float depth = vDepth;
  if (depth <= 0.0) discard;
  vec3 toFrag = vWorld - cameraPosition;
  float dist = length(toFrag);
  vec3 V = toFrag / dist;
  vec2 p = vWorld.xz;
  // the surface: ripples by the wind (a mirror in calm air, flatter far off where they blur into a sheen)
  vec2 slope = waveSlope(p, dist) * (0.02 + 0.2 * uWind) / (1.0 + dist * 0.015);
  if (uRain > 0.0 && dist < 32.0) slope += (natRainRings(p, 0.8 + 0.9 * uRain) + natRainRings(p * 1.37 + 3.1, 0.7 + 0.8 * uRain) * 0.7) * 0.32 * uRain * (1.0 - dist / 32.0);
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec3 R = reflect(V, n); R.y = abs(R.y) + 0.002;
  // what it mirrors: the sky with its clouds, and the trees of the far shore as a dark, hazy band
  vec3 refl = skyColor(R, false);
  // at night the Milky Way and the stars in it, broken up by the ripples
  if (uStars > 0.0) refl += (milkyWay(R) * smoothstep(0.0, 0.25, R.y) + lakeStars(R)) * step(uFrozen, 0.5);
  vec4 cl = skyClouds(R); refl = mix(refl, cl.rgb, cl.a);
  vec2 rd = normalize(R.xz + vec2(1e-5));
  float az = atan(rd.y, rd.x) / 6.2832 + 0.5;
  vec4 sk = texture2D(uSkyline, vec2(az, 0.5));
  float line = sk.r * 0.6 + (texture2D(uNoise, vec2(az * 9.0, 0.37)).r - 0.5) * 0.025 * sk.r;
  float trees = smoothstep(line + 0.02, line - 0.02, R.y) * step(0.001, sk.r);
  vec3 wood = uTreeLine * (uSkyLight * 2.2 + uSunLight * 0.3) * (0.55 + 0.6 * sk.g) * (1.0 + 0.3 * (texture2D(uNoise, vec2(az * 31.0, R.y * 3.0)).g - 0.5));
  // (the air between the eye, the water and the trees over there)
  refl = mix(refl, mix(wood, natHazeColor(vec3(rd.x, 0.0, rd.y)), natHazeAmount(dist + sk.b * 250.0, 0.0)), trees);
  // the jetty mirrored, dark wood in the shadow under the boards
  if (uFrozen < 0.5) refl = mix(refl, vec3(0.05, 0.04, 0.03) * (uSkyLight * 1.3 + 0.01), jettyMirror(vec3(p.x, vWorld.y, p.y), R) * 0.92);
  float cosT = max(dot(-V, n), 0.0);
  float fres = (0.02 + 0.98 * pow(1.0 - cosT, 5.0)) * smoothstep(0.0, 0.04, depth);
  // into the water: the bed shows through shallow water, deeper it fades into a dim green-brown
  float path = depth / max(-V.y, 0.12);
  float t = exp(-path * 1.5);
  vec3 body = vec3(0.034, 0.048, 0.04) * (uSkyLight * 1.8 + uSunLight * max(uSunDirW.y, 0.0) * 0.12);
  vec3 col = body * (1.0 - t) * (1.0 - fres) + refl * fres;
  // the sun's glint, wider in wind; none where the mirrored trees of the far shore hide the sun
  float sp = max(dot(R, uSunDirW), 0.0);
  col += uSunLight * (pow(sp, 900.0 - 700.0 * uWind) * 3.5 + pow(sp, 60.0) * 0.04) * (1.0 - trees) * (1.0 - uFrozen) * smoothstep(0.0, 0.1, depth);
  float a = 1.0 - t * (1.0 - fres);
  // winter: the water darker and stiller looking, a thin rim of ice along the shore, ragged at its edge, with a little
  // snow on it where it is thick enough
  if (uWinterW > 0.0 && uFrozen < 0.5) {
    col *= 1.0 - 0.32 * uWinterW * (1.0 - fres);
    float nr = texture2D(uNoise, p * 0.27).r, nr2 = texture2D(uNoise, p * 1.3 + 0.4).g;
    float rim = (1.0 - smoothstep(0.1, 0.22, depth + (nr - 0.5) * 0.16 + (nr2 - 0.5) * 0.04)) * uWinterW;
    if (rim > 0.0) {
      vec3 light = uSkyLight * 1.1 + uSunLight * max(uSunDirW.y, 0.0) * 0.55;
      vec3 ice = vec3(0.17, 0.21, 0.25) * light + refl * 0.22;
      ice = mix(ice, vec3(0.88, 0.9, 0.94) * light, smoothstep(0.45, 0.75, nr2) * uSnow * (1.0 - smoothstep(0.05, 0.16, depth)));
      col = mix(col, ice, rim);
      a = mix(a, 1.0, rim);
    }
  }
  // ice: dark clear ice with a few cracks under drifts of snow; a snowfall in another season than winter freezes it
  // thinly: dark young ice with a little snow on it (in winter the ice sheet of ice.js lies over all of it)
  if (uFrozen > 0.0) {
    float n1 = texture2D(uNoise, p * 0.045).r, n2 = texture2D(uNoise, p * 0.23 + 0.2).g;
    float cover = smoothstep(0.42, 0.7, n1 + 0.3 * (n2 - 0.5)) * uSnow * 0.7 + 0.06;
    float crack = smoothstep(0.012, 0.0, abs(texture2D(uNoise, p * 0.11 + 0.6).b - 0.5)) * (1.0 - cover);
    vec3 light = uSkyLight * 1.1 + uSunLight * max(uSunDirW.y, 0.0) * 0.55;
    vec3 ice = vec3(0.16, 0.2, 0.24) * light + refl * 0.18 + vec3(0.5) * crack * light;
    vec3 snow = vec3(0.88, 0.9, 0.94) * light;
    col = mix(col, mix(ice, snow, clamp(cover, 0.0, 1.0)), uFrozen);
    a = mix(a, 1.0, uFrozen);
  }
  // the night's dim colours fade towards a cool grey, as in the garden round it (nature.js)
  float nLum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(nLum) * uNightTint, uNightGrade * (1.0 - smoothstep(0.03, 0.16, nLum)));
  // the air between the eye and the water
  float hz = natHazeAmount(dist, vWorld.y);
  col = mix(col, natHazeColor(V) * a, hz);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** The skyline round the lake as seen from its middle: R = how high the trees of the far shore rise (sin of the
 *  angle, ×1/0.6), G = how dark they are (firs), B = how far away (/250). 512 directions. */
function skylineTexture() {
  const N = 512, el = new Float32Array(N), dark = new Float32Array(N).fill(0.5), far = new Float32Array(N).fill(0.6);
  const H = { beech: 17, oak: 15, birch: 14, spruce: 20, pine: 18, bush: 2.2, fruit: 5.5 }, W = { beech: 6, oak: 6.5, birch: 3, spruce: 4, pine: 4.5, bush: 1.4, fruit: 4.6 };
  // the far wooded ridges first, then every tree in reach
  for (let i = 0; i < N; i++) { const s = Math.sin(i * 0.07) * 0.4 + Math.sin(i * 0.023 + 1) * 0.6; el[i] = Math.sin(0.11 + 0.035 * s); dark[i] = 0.6; far[i] = 0.8; }
  for (const t of TREES) {
    const dx = t.x - LAKE.x, dz = t.z - LAKE.z, d = Math.hypot(dx, dz);
    if (d < 8 || d > 160) continue;
    const top = terrainHeight(t.x, t.z) + H[t.sp] * t.scale - WATER_Y, e = Math.sin(Math.atan2(top, d));
    const az = Math.atan2(dz, dx), half = Math.atan2(W[t.sp] * t.scale * 0.5, d);
    const i0 = Math.floor(((az - half) / (2 * Math.PI) + 0.5) * N), i1 = Math.ceil(((az + half) / (2 * Math.PI) + 0.5) * N);
    for (let i = i0; i <= i1; i++) {
      const k = ((i % N) + N) % N, w = 1 - Math.abs((i - (i0 + i1) / 2) / ((i1 - i0) / 2 + 1)) * 0.35;   // a round top
      if (e * w > el[k]) { el[k] = e * w; dark[k] = t.sp === 'spruce' || t.sp === 'pine' ? 0.2 : 0.75; far[k] = d / 250; }
    }
  }
  // gaps of up to four directions between neighbouring crowns closed (a closing: the highest within two directions,
  // then the lowest of those), each direction with the darkness and distance of the crown that fills it: in a gap the
  // far ridges with their haze drew a thin bright line down the water
  const close = (r) => {
    const e1 = new Float32Array(N), d1 = new Float32Array(N), f1 = new Float32Array(N);
    for (let i = 0; i < N; i++) { let b = i; for (let k = -r; k <= r; k++) { const j = (i + k + N) % N; if (el[j] > el[b]) b = j; } e1[i] = el[b]; d1[i] = dark[b]; f1[i] = far[b]; }
    for (let i = 0; i < N; i++) { let b = i; for (let k = -r; k <= r; k++) { const j = (i + k + N) % N; if (e1[j] < e1[b]) b = j; } el[i] = e1[b]; dark[i] = d1[b]; far[i] = f1[b]; }
  };
  close(2);
  // softened round the ring: the band of trees has no hard steps between one direction and the next
  const soften = (a) => { for (let pass = 0; pass < 2; pass++) { const c = a.slice(); for (let i = 0; i < N; i++) a[i] = (c[(i + N - 2) % N] + 2 * c[(i + N - 1) % N] + 3 * c[i] + 2 * c[(i + 1) % N] + c[(i + 2) % N]) / 9; } };
  soften(el); soften(dark); soften(far);
  const data = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) { data[i * 4] = Math.min(255, Math.round(el[i] / 0.6 * 255)); data[i * 4 + 1] = Math.round(dark[i] * 255); data[i * 4 + 2] = Math.round(Math.min(1, far[i]) * 255); data[i * 4 + 3] = 255; }
  const tex = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  return tex;
}

/** The jetty's posts in the water for its reflection (garden.js puts them there): up to eight, (x, z, radius, 0). */
function jettyPosts() {
  const J = JETTY, out = [], walk = J.len - J.platLen;
  const add = (along, across, r) => { const [x, z] = J.at(along, across); if (terrainHeight(x, z) < WATER_Y && out.length < 8) out.push(new THREE.Vector4(x, z, r, 0)); };
  for (const along of [J.len - 0.16, J.len - 0.15, walk + 0.15]) for (const c of [-1, 1]) add(along, c * (along > walk ? J.platWidth / 2 - 0.14 : J.width / 2 - 0.16), along > J.len - 0.2 ? 0.11 : 0.085);
  for (let s = walk - 1.0; s > 0 && out.length < 8; s -= 2.0) for (const c of [-1, 1]) add(s, c * (J.width / 2 - 0.16), 0.075);
  while (out.length < 8) out.push(new THREE.Vector4(0, 0, 0, 0));
  return out;
}

/**
 * The lake's surface. Returns { mesh, uniforms, apply({ weather }), setTreeLine(color), setWinter(w) }; the shared time, sun, sky and
 * haze come from NATURE and SKY.
 */
export function makeWater() {
  const SEG = 288;
  const rings = [0, 0.3, 0.5, 0.64, 0.74, 0.81, 0.86, 0.895, 0.92, 0.94, 0.955, 0.967, 0.977, 0.986, 0.994, 1.0, 1.006, 1.013, 1.021, 1.03, 1.042, 1.056, 1.075, 1.1, 1.13];
  const nR = rings.length, pos = new Float32Array(SEG * nR * 3), depth = new Float32Array(SEG * nR), idx = [];
  for (let s = 0; s < SEG; s++) {
    const a = (s / SEG) * Math.PI * 2, sc = shoreScale(a), cu = Math.cos(a), cv = Math.sin(a);
    rings.forEach((m, r) => {
      const k = s * nR + r, x = LAKE.x + cu * m * sc * LAKE.rx, z = LAKE.z + cv * m * sc * LAKE.rz;
      pos.set([x, WATER_Y, z], k * 3);
      depth[k] = WATER_Y - terrainHeight(x, z);
      if (r < nR - 1) { const s2 = (s + 1) % SEG, a0 = k, b0 = k + 1, c0 = s2 * nR + r, d0 = c0 + 1; idx.push(a0, c0, b0, b0, c0, d0); }
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  SKY.uNoise.value = noiseTexture();
  const uniforms = {
    ...SKY, uTime: NATURE.uTime, uSunDirW: NATURE.uSunDirW, uSunLight: NATURE.uSunLight, uHazeColor: NATURE.uHazeColor, uHazeSun: NATURE.uHazeSun,
    uHazeDensity: NATURE.uHazeDensity, uHazeMax: NATURE.uHazeMax, uHazeStart: NATURE.uHazeStart, uSkyLight: NATURE.uSkyLight, uWind: NATURE.uWind, uSnow: NATURE.uSnow,
    uNightGrade: NATURE.uNightGrade, uNightTint: NATURE.uNightTint,
    uFrozen: { value: 0 }, uRain: { value: 0 }, uWinterW: { value: 0 }, uTreeLine: { value: new THREE.Color() }, uWaves: { value: waterNormalTexture() }, uSkyline: { value: skylineTexture() },
    uLakeC: { value: new THREE.Vector2(LAKE.x, LAKE.z) },
    uJettyA: { value: new THREE.Vector4(JETTY.root[0], JETTY.root[1], JETTY.dir[0], JETTY.dir[1]) },
    uJettyB: { value: new THREE.Vector4(JETTY.len, JETTY.width / 2, JETTY.platLen, JETTY.platWidth / 2) },
    uJettyY: { value: JETTY.top },
    // the posts that stand in the water (x, z, radius): in pairs along the walk and at the corners of the platform
    uJettyPosts: { value: jettyPosts() },
  };
  // premultiplied: the colour is what the water adds, alpha how much of the lake bed behind it is hidden
  const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, transparent: true, depthWrite: false, fog: false, premultipliedAlpha: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'lake'; mesh.renderOrder = 4; mesh.userData.noAO = true;
  return {
    mesh, uniforms,
    /** Ice under snow, rain rings on the water. */
    apply({ weather, mix = null }) {
      // (mix: the weather's continuous parts, sky-state.js: the ice comes and goes slowly, the rain's rings with the rain)
      uniforms.uFrozen.value = mix ? mix.frozen : weather === 'snow' ? 1 : 0;
      uniforms.uRain.value = mix ? mix.rain : weather === 'storm' ? 1 : weather === 'rain' ? 0.6 : 0;
    },
    setTreeLine(c) { uniforms.uTreeLine.value.copy(c); },
    /** Winter (0 … 1, seasons.js): darker water, a thin rim of ice along the shore (none needed while it is frozen). */
    setWinter(w) { uniforms.uWinterW.value = w; },
  };
}
