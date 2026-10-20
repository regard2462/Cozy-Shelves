// Rain, its splashes and snow: particles in a box that travels with the camera, moved on the graphics card. Every drop
// falls slanted with the wind and ends where it meets something: the garden's ground (a height field from garden.js),
// the deck, the jetty, the lake's surface or the roofs of the house, so no drop ever reaches the rooms or sinks into
// the ground. Where a drop lands, a small splash jumps up, on the water a ring spreads. The streaks are thin ribbons
// facing the eye, of varied length, speed and brightness.
import * as THREE from 'three';
import { seeded } from './geo.js';
import { HALL, PASSAGE, ROOM } from './layout.js';
import { HOUSE, JETTY, WATER_Y } from './outdoor.js';
import { NATURE } from './nature.js';
import { twoSided } from './two-sided.js';

/** What a drop lands on (GLSL): the roofs, the deck, the jetty, else the ground and at least the water's surface. The
 *  same rules in JS: surfaceHeight() below (the checks compare both). */
const SURFACE_GLSL = `
uniform sampler2D uField; uniform vec4 uFieldBox;
uniform vec4 uRoofHall; uniform vec4 uRoofPass; uniform vec4 uRoofRoom; uniform vec3 uRoofY;
uniform vec4 uDeck; uniform vec4 uJettyA; uniform vec4 uJettyB; uniform float uJettyY; uniform float uWaterY;
bool inRect(vec2 p, vec4 b) { return p.x > b.x && p.x < b.y && p.y > b.z && p.y < b.w; }
// y of what a drop at p lands on; water = 1 on the lake, 0.5 on boards and roofs (they splash), 0 on the soft ground
float surfaceAt(vec2 p, out float water) {
  water = 0.5;
  // (where two roofs overlap, the higher one: the hall's and the book room's reach over the passage's)
  if (inRect(p, uRoofHall)) return uRoofY.x;
  if (inRect(p, uRoofRoom)) return uRoofY.z;
  if (inRect(p, uRoofPass)) return uRoofY.y;
  if (inRect(p, uDeck)) return 0.0;
  vec2 r = p - uJettyA.xy;
  float along = dot(r, uJettyA.zw), across = abs(dot(r, vec2(uJettyA.w, -uJettyA.z)));
  if (along > 0.0 && along < uJettyB.x && across < (along > uJettyB.x - uJettyB.z ? uJettyB.w : uJettyB.y)) return uJettyY;
  water = 0.0;
  float h = texture2D(uField, (p - uFieldBox.xy) / uFieldBox.zw).r;
  if (h < uWaterY) { water = 1.0; return uWaterY; }
  return h;
}
`;
const BOX_GLSL = `
uniform float uTime; uniform vec3 uCam; uniform float uGround; uniform vec3 uBox; uniform vec2 uWindV; uniform float uFall;
attribute vec3 aSeed; attribute vec2 aRand;
// the lower end of drop aSeed now: it falls with uFall (± its own speed) and drifts with the wind, the box wraps round the eye
vec3 dropPos(float speed) {
  vec3 p = aSeed * uBox + vec3(uWindV.x, -uFall * speed, uWindV.y) * uTime;
  vec3 o = vec3(uCam.x - uBox.x * 0.5, uGround - 6.0, uCam.z - uBox.z * 0.5);
  return o + mod(p - o, uBox);
}
`;

const rainVert = `${SURFACE_GLSL}${BOX_GLSL}
uniform float uScale; uniform vec3 uSkyLight; uniform vec3 uGlow; uniform vec3 uGlowPos; uniform float uLen;
varying vec2 vUv; varying float vA; varying vec3 vLight;
void main() {
  float speed = 0.85 + 0.3 * aRand.y;
  vec3 head = dropPos(speed);
  vec3 vel = vec3(uWindV.x, -uFall * speed, uWindV.y);
  // the streak a drop draws while the eye looks (longer for faster drops, a little different for each)
  vec3 tail = head - normalize(vel) * uLen * (0.6 + 0.8 * aRand.x) * speed;
  float water;
  float s = surfaceAt(head.xz, water);
  vA = 1.0;
  if (tail.y <= s) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }   // landed: the splash takes over
  if (head.y < s) head = tail + (head - tail) * ((tail.y - s) / (tail.y - head.y));   // it ends on the surface
  vec4 a = viewMatrix * vec4(tail, 1.0), b = viewMatrix * vec4(head, 1.0);
  vec3 dir = b.xyz - a.xyz; float len = length(dir); dir /= max(len, 1e-5);
  vec3 mid = (a.xyz + b.xyz) * 0.5;
  vec3 side = cross(dir, mid); side /= max(length(side), 1e-6);
  float d = max(-mid.z, 0.05);
  // a thin ribbon: 3 mm, but never under 1.3 pixels wide (then fainter instead, so far drops do not shimmer)
  float w = max(0.003, 1.3 * d / uScale);
  vA = min(1.0, 0.0045 / w);
  vec4 v = mix(a, b, position.y);
  v.xyz += side * position.x * w * 0.5;
  gl_Position = projectionMatrix * v;
  vUv = vec2(position.x, position.y);
  vA *= smoothstep(0.35, 1.4, d) * (1.0 - smoothstep(13.0, 19.0, d)) * (0.35 + 0.65 * fract(aRand.x * 7.13 + aRand.y * 3.7));
  // a drop shows the bright sky: lighter than everything round it, most against the dark wood
  vLight = uSkyLight * 2.1 + 0.03 + uGlow * exp(-distance(head, uGlowPos) * 0.16);
}`;
const rainFrag = `
uniform float uOpacity; varying vec2 vUv; varying float vA; varying vec3 vLight;
void main() {
  // (clamped: with multisampling a fragment may lie a little outside its ribbon, and pow() of a negative is not a number)
  float u = clamp(vUv.x, -1.0, 1.0), v = clamp(vUv.y, 0.0, 1.0);
  float a = (1.0 - u * u) * (0.2 + 0.8 * pow(v, 1.6)) * uOpacity * vA;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vLight, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// a splash where a drop has just landed: a little crown of droplets on the ground, a ring on the water
const splashVert = `${SURFACE_GLSL}${BOX_GLSL}
uniform vec3 uSkyLight; uniform vec3 uGlow; uniform vec3 uGlowPos;
varying vec2 vUv; varying float vAge; varying float vWater; varying vec3 vLight; varying float vA;
void main() {
  float speed = 0.85 + 0.3 * aRand.y;
  vec3 head = dropPos(speed);
  float water;
  // when it landed and where (it has drifted on with the wind since)
  float s0 = surfaceAt(head.xz, water);
  float age = (s0 - head.y) / (uFall * speed);
  vec2 at = head.xz - uWindV * age;
  float s = surfaceAt(at, water);
  float life = water > 0.75 ? 0.6 : 0.16;
  vAge = age / life; vWater = water; vUv = position.xy;
  float dist = distance(vec3(at.x, s, at.y), cameraPosition);
  vA = (1.0 - smoothstep(7.0, 12.0, dist)) * step(0.0, age) * step(age, life) * step(s, uCam.y + 1.0);
  if (vA <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 c = vec3(at.x, s + 0.004, at.y);
  vec3 p;
  if (water > 0.75) {
    // a ring lying on the water, spreading
    float r = 0.03 + 0.17 * vAge * (0.7 + 0.6 * aRand.x);
    p = c + vec3(position.x * r, 0.0, position.y * r);
  } else {
    // a crown of droplets standing up, facing the eye
    vec3 toCam = normalize(cameraPosition - c); vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
    float sz = 0.035 + 0.045 * aRand.x;
    p = c + right * position.x * sz + vec3(0.0, (position.y * 0.5 + 0.5) * sz * 1.2, 0.0);
  }
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vLight = uSkyLight * 1.4 + 0.015 + uGlow * exp(-distance(c, uGlowPos) * 0.16);
}`;
const splashFrag = `
uniform float uOpacity; varying vec2 vUv; varying float vAge; varying float vWater; varying vec3 vLight; varying float vA;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float a;
  if (vWater > 0.75) {
    float r = length(vUv);
    a = smoothstep(0.08, 0.0, abs(r - 0.9)) * (1.0 - vAge) * (1.0 - vAge) * 0.45;
  } else {
    // droplets thrown up and out: dots on a widening arc
    vec2 q = vec2(vUv.x, vUv.y * 0.5 + 0.5);
    a = 0.0;
    for (int i = 0; i < 6; i++) {
      float fi = float(i), ang = -1.2 + fi * 0.48 + hash(fi + 3.1) * 0.2;
      vec2 c = vec2(sin(ang) * (0.25 + 0.6 * vAge), (cos(ang) * 0.9) * (1.0 - vAge) * (0.4 + 0.6 * vAge) + 0.05);
      a += smoothstep(0.13, 0.03, length(q - vec2(c.x, c.y)));
    }
    a = min(a, 1.0) * (1.0 - vAge * vAge) * (vWater > 0.25 ? 1.0 : 0.35);   // the grass swallows most of it
  }
  a *= uOpacity * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vLight, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const snowVert = `${SURFACE_GLSL}${BOX_GLSL}
uniform float uScale; uniform float uSize; uniform vec3 uGlowPos; uniform vec3 uSkyLight; uniform vec3 uGlow;
varying float vA; varying vec3 vLight;
void main() {
  float speed = 0.7 + 0.6 * aRand.x;
  vec3 w = dropPos(speed);
  w.x += sin(uTime * 0.6 + aRand.y * 31.0) * (0.35 + 0.4 * aRand.x);
  w.z += cos(uTime * 0.5 + aRand.y * 17.0) * (0.35 + 0.4 * aRand.x);
  float water;
  // a flake that reached the ground, the water or a roof has settled
  if (w.y < surfaceAt(w.xz, water)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; return; }
  vec4 mv = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  gl_PointSize = uSize * (0.7 + 0.6 * aRand.y) * uScale / max(d, 0.1);
  vA = smoothstep(0.35, 1.2, d) * (1.0 - smoothstep(16.0, 22.0, d));
  // lit by the sky and, near the house, by the string lights and the lamps behind the glass
  vLight = uSkyLight * 1.1 + uGlow * exp(-distance(w, uGlowPos) * 0.16);
}`;
const snowFrag = `
uniform float uOpacity; varying float vA; varying vec3 vLight;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.12, r) * uOpacity * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vLight, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// the roofs over the hall, the passage and the book room (garden.js builds them: 25 / 60 cm beyond the walls) and the deck
const ROOFS = {
  hall: [-(HALL.x1 + HALL.wall + 0.25), HALL.x1 + HALL.wall + 0.25, HALL.z0 - HALL.wall - 0.25, HOUSE.front + 0.25, HALL.h + 0.04 + 0.34],
  pass: [PASSAGE.x - PASSAGE.w / 2 - 0.6, PASSAGE.x + PASSAGE.w / 2 + 0.6, PASSAGE.z0, PASSAGE.z1, PASSAGE.h + 0.04 + 0.3],
  room: [ROOM.x0 - 0.6, ROOM.x1 + 0.6, ROOM.z0 - 0.6, ROOM.z1 + 0.6, ROOM.h + 0.04 + 0.34],
};
const DECK_RECT = [HOUSE.deck.x0, HOUSE.deck.x1, HOUSE.deck.z0 - 0.45, HOUSE.deck.z1];

/**
 * What a drop lands on at (x, z), the same rules as the shaders (SURFACE_GLSL): { y, water, roof }. `field` is
 * garden.heightField with a `sample(x, z)` (the checks use it to compare the shader's data with the ground).
 */
export function surfaceHeight(x, z, field) {
  const inR = (b) => x > b[0] && x < b[1] && z > b[2] && z < b[3];
  for (const k of ['hall', 'room', 'pass']) if (inR(ROOFS[k])) return { y: ROOFS[k][4], water: false, roof: true };
  if (inR(DECK_RECT)) return { y: 0, water: false, roof: false };
  const J = JETTY, rx = x - J.root[0], rz = z - J.root[1], along = rx * J.dir[0] + rz * J.dir[1], across = Math.abs(rx * J.dir[1] - rz * J.dir[0]);
  if (along > 0 && along < J.len && across < (along > J.len - J.platLen ? J.platWidth : J.width) / 2) return { y: J.top, water: false, roof: false };
  const h = field.sample(x, z);
  return h < WATER_Y ? { y: WATER_Y, water: true, roof: false } : { y: h, water: false, roof: false };
}

/** Rain, splashes and snow for environment.js: { rain, splash, snow (objects to add), uniforms, set(weather), update(…) }. */
export function makeWeather(heightField) {
  const rnd = seeded(4);
  const V4 = (a) => new THREE.Vector4(a[0], a[1], a[2], a[3]);
  const shared = {
    uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uGround: { value: 0 }, uScale: { value: 500 },
    uWindV: { value: new THREE.Vector2(1.2, 0.35) },
    uField: { value: heightField.texture }, uFieldBox: { value: new THREE.Vector4(heightField.x0, heightField.z0, heightField.w, heightField.d) },
    uRoofHall: { value: V4(ROOFS.hall) }, uRoofPass: { value: V4(ROOFS.pass) }, uRoofRoom: { value: V4(ROOFS.room) },
    uRoofY: { value: new THREE.Vector3(ROOFS.hall[4], ROOFS.pass[4], ROOFS.room[4]) },
    uDeck: { value: V4(DECK_RECT) },
    uJettyA: { value: new THREE.Vector4(JETTY.root[0], JETTY.root[1], JETTY.dir[0], JETTY.dir[1]) },
    uJettyB: { value: new THREE.Vector4(JETTY.len, JETTY.width / 2, JETTY.platLen, JETTY.platWidth / 2) },
    uJettyY: { value: JETTY.top }, uWaterY: { value: WATER_Y },
    uGlow: { value: new THREE.Color() }, uGlowPos: { value: new THREE.Vector3(0, 2.2, 7.6) }, uSkyLight: NATURE.uSkyLight,
  };
  // one set of drops for the rain and its splashes (the splash of a drop is drawn by the same instance)
  const N = 13000;
  const seeds = new Float32Array(N * 3), rands = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) { seeds.set([rnd(), rnd(), rnd()], i * 3); rands.set([rnd(), rnd()], i * 2); }
  const aSeed = new THREE.InstancedBufferAttribute(seeds, 3), aRand = new THREE.InstancedBufferAttribute(rands, 2);
  const quad = (name) => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(name === 'rain' ? [-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0] : [-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
    g.setIndex([0, 1, 2, 1, 3, 2]);
    g.setAttribute('aSeed', aSeed); g.setAttribute('aRand', aRand);
    g.instanceCount = N;
    return g;
  };
  const rainU = { ...shared, uBox: { value: new THREE.Vector3(40, 24, 40) }, uFall: { value: 9.5 }, uLen: { value: 0.38 }, uOpacity: { value: 0.3 } };
  const splashU = { ...shared, uBox: rainU.uBox, uFall: rainU.uFall, uOpacity: { value: 0.5 } };
  const mk = (geo, vert, frag, uniforms, order) => {
    // (both sides: which way round a ribbon faces depends on the drop)
    // (as its back faces and a child with its front faces, two-sided.js)
    const m = twoSided(new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide })));
    m.frustumCulled = false; m.visible = false; m.renderOrder = order;
    return m;
  };
  // snow: its own flakes in a 44 × 24 × 44 m box
  const SN = 9000, sSeeds = new Float32Array(SN * 3), sRands = new Float32Array(SN * 2);
  for (let i = 0; i < SN; i++) { sSeeds.set([rnd(), rnd(), rnd()], i * 3); sRands.set([rnd(), rnd()], i * 2); }
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SN * 3), 3));
  snowGeo.setAttribute('aSeed', new THREE.BufferAttribute(sSeeds, 3)); snowGeo.setAttribute('aRand', new THREE.BufferAttribute(sRands, 2));
  const snowU = { ...shared, uBox: { value: new THREE.Vector3(44, 24, 44) }, uFall: { value: 0.85 }, uSize: { value: 0.06 }, uOpacity: { value: 0.9 }, uWindV: { value: new THREE.Vector2(0.25, 0.08) } };
  const snow = new THREE.Points(snowGeo, new THREE.ShaderMaterial({ vertexShader: snowVert, fragmentShader: snowFrag, uniforms: snowU, transparent: true, depthWrite: false, fog: false }));
  snow.frustumCulled = false; snow.visible = false; snow.renderOrder = 5;
  const api = {
    rain: null, splash: null, snow, shared,
    /** What a drop lands on at (x, z), as the shaders see it (surfaceHeight). */
    surface: (x, z) => surfaceHeight(x, z, heightField),
    set(weather) { api.setMix({ rain: weather === 'storm' ? 1 : weather === 'rain' ? 0.6 : 0, thunder: weather === 'storm' ? 1 : 0, snow: weather === 'snow' ? 1 : 0, wind: weather === 'storm' ? 1 : 0.6 }); },
    /**
     * The weather's mix (sky-state.js): rain 0.3 a drizzle (fewer, shorter, slower drops), 0.6 rain, 1 a storm's
     * downpour; snow 0 … 1 how many flakes; the wind slants the drops and drives the flakes.
     */
    setMix(m) {
      const r = m.rain || 0, s = m.snow || 0, w = m.wind || 0;
      const storm = Math.min(1, Math.max(0, (r - 0.6) / 0.4));
      api.rain.visible = api.splash.visible = r > 0.02;
      snow.visible = s > 0.02;
      // drops: 55 % of them in rain, all in a storm, fewer in a drizzle
      api.rain.geometry.instanceCount = api.splash.geometry.instanceCount = Math.round(N * (r >= 0.6 ? 0.55 + 0.45 * storm : 0.55 * Math.max(0, r) / 0.6));
      rainU.uFall.value = r >= 0.6 ? 9.0 + 2.5 * storm : 7.2 + 1.8 * r / 0.6;
      rainU.uLen.value = r >= 0.6 ? 0.36 + 0.14 * storm : 0.2 + 0.16 * r / 0.6;
      rainU.uOpacity.value = r >= 0.6 ? 0.4 + 0.1 * storm : 0.3 + 0.1 * r / 0.6;
      splashU.uOpacity.value = r >= 0.6 ? 0.32 + 0.08 * storm : 0.22 + 0.1 * r / 0.6;
      // the wind: 1.1 m/s sideways in rain, 3.6 in a storm (the wind part 0.6 … 1)
      const k = Math.min(1, Math.max(0, (w - 0.6) / 0.4));
      shared.uWindV.value.set(1.1 + 2.5 * k, 0.3 + 0.8 * k);
      // flakes: all of them in a full snowfall, drifting more in the wind (blowing snow)
      snow.geometry.setDrawRange(0, Math.round(SN * Math.min(1, s)));
      snowU.uWindV.value.set(0.25 + 2.2 * Math.max(0, w - 0.32), 0.08 + 0.7 * Math.max(0, w - 0.32));
    },
    /** Every frame while it rains or snows: the time, the eye, the ground under it, the size of a pixel. */
    update(time, camera, ground, renderer) {
      shared.uTime.value = time % 600;   // (a jump every ten minutes nobody sees in the rain; far larger times lose precision)
      shared.uCam.value.copy(camera.position);
      shared.uGround.value = ground;
      const v = renderer.getDrawingBufferSize(api._dbs || (api._dbs = new THREE.Vector2()));
      shared.uScale.value = v.y * 0.5 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    },
  };
  api.rain = mk(quad('rain'), rainVert, rainFrag, rainU, 5);
  api.splash = mk(quad('splash'), splashVert, splashFrag, splashU, 6);
  return api;
}
