// Sky, sun/moon, the landscape outside the windows, weather (rain/snow/fog/storm), light shafts and the fireplace
// fire. The sky (sky.js), the garden (garden.js) and every plant (nature.js) share the uniforms set in apply():
// sun and moon, the colours of the sky and the haze, the sky's light on the garden, snow, rain and wind.
// The weather comes as a mix of continuous parts (sky-state.js: cloud, overcast, rain, snow, thunder, fog, wind, wet,
// cover, frozen), so one weather blends into the next; the night sky has the moon of the date and stars that turn with
// the sky time (celestial.js).
import * as THREE from 'three';
import { lerp, clamp, smoothstep } from './geo.js';
import { makeGarden } from './garden.js';
import { makeSky, makeStars, SKY } from './sky.js';
import { NATURE } from './nature.js';
import { makeWeather } from './weather.js';
import { outside, groundHeight, HOUSE } from './outdoor.js';
import { goldenSun, applyGolden } from './godrays.js';
import { sunPosition, moonEquatorial, moonPhase, moonLit, moonBrightness, siderealAngle, skyRotation, galacticRotation, clockTime } from './celestial.js';
import { mixOf, phaseOf, fixedWeatherOf, nameOfMix, blendWeather } from './sky-state.js';
import { twoSided, sidesOf } from './two-sided.js';

export { sunPosition };

const C = (hex) => new THREE.Color(hex);
const L = (r, g, b) => new THREE.Color().setRGB(r, g, b);
// the night's colours (linear): the sky without a moon and under a full one, the light it gives the garden
// (the tone mapping swallows everything below about 0.003: a night that should stay readable needs more than nature)
const NIGHT = {
  zenith: L(0.0046, 0.0066, 0.0138), horizon: L(0.0118, 0.015, 0.0235),             // starlight, a faint glow low down
  zenithMoon: L(0.0075, 0.014, 0.036), horizonMoon: L(0.021, 0.03, 0.052),            // a deep blue under the moon
  light: L(0.13, 0.156, 0.24), lightMoon: L(0.16, 0.196, 0.29),                        // sky light on the garden
  overcast: L(0.25, 0.256, 0.28),                                                      // clouds lit from below by far towns
  moon: C(0x9db0d8),                                                                   // moonlight: blue-silver
};
const HOUSE_FRONT = HOUSE.front;
// the fixed colours of apply() (it runs every frame while the time moves: nothing in it may make garbage)
const P = {
  zenDay: C(0x2b66b8), zenDusk: C(0x31407a), horDay: C(0xb7cde3), horDusk: C(0xc9a9a4), grey: C(0x8f969e),
  glow: C(0xfff2dc), glowDusk: C(0xff8a3c), white: C(0xffffff), litDusk: C(0xffb58a),
  shade: C(0x9aa3b0), shadeDark: C(0x5f6570), shadeSnow: C(0xa3a9b1), sunLow: C(0xffd7a8), sunHigh: C(0xfff3e0),
  skyClear: L(0.4, 0.47, 0.6), skyGrey: L(0.6, 0.62, 0.66), skyDusk: L(0.4, 0.304, 0.288), snowNight: L(0.04, 0.044, 0.06),
  ground: L(0.09, 0.11, 0.055), groundSnow: L(0.5, 0.52, 0.56), neutral: C(0xdbe4f0), warm: C(0xffd9a6), hemiNight: C(0x4a3a2c),
  treeLine: C(0x3a5230),
};
const UP = new THREE.Vector3(0, 1, 0), HIGH = new THREE.Vector3(0.12, 1, 0.22).normalize();
const HAZE = { clear: [55, 235, 0.88, 0.5], overcast: [40, 195, 0.9, 0.35], rain: [22, 140, 0.92, 0.25], storm: [15, 112, 0.93, 0.2], snow: [20, 128, 0.93, 0.15], fog: [3, 52, 1, 0] };

export class Environment {
  constructor(scene, renderer, layout) {
    this.scene = scene; this.renderer = renderer; this.layout = layout;
    this.state = { hour: 20, weather: 'clear', mix: null, brightness: 1, warmth: 0.65, shadows: true };
    this.time = 0;
    const t0 = performance.now();
    this.sky = makeSky(); scene.add(this.sky);
    // the stars (sky.js): points behind everything, turning with the sky
    this.stars = makeStars(); scene.add(this.stars.points);

    // the garden, the lake and the wood outside the windows (garden.js)
    this.garden = makeGarden(); this.scenery = this.garden.group; scene.add(this.scenery);
    this.buildMs = performance.now() - t0;   // (build/scripts/startup-time.js)

    this.sun = new THREE.DirectionalLight(0xffffff, 1); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.near = 1; sc.far = 110; sc.left = -20; sc.right = 20; sc.top = 20; sc.bottom = -20; sc.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.035; this.sun.shadow.radius = 2;
    this.sunTarget = new THREE.Object3D(); scene.add(this.sunTarget); this.sun.target = this.sunTarget; scene.add(this.sun);
    // The scene is almost entirely static: the sun's shadow map is drawn again only when its frustum moved (the player
    // walked on to the next step, the sun went on by a fraction of a texel's worth) and once a second for the cat.
    this.sun.shadow.autoUpdate = false; this.sun.shadow.needsUpdate = true;
    this.sunShadowTimer = 0; this.shadowAt = { r: NaN, u: NaN, dir: new THREE.Vector3(), frames: 0, pending: false };
    this.shadowRedraws = 0;   // (the checks)
    this.treesDue = false;    // the trees' map should follow the sun (godrays.js)

    this.hemi = new THREE.HemisphereLight(0xcfd8e6, 0x4a3a2a, 0.35); scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffe0b8, 0.12); scene.add(this.ambient);
    this.baseHemi = 0.35; this.baseAmbient = 0.12;

    // rain, its splashes and snow (weather.js): they end on the garden's ground, the deck, the jetty, the water and the roofs
    this.weather = makeWeather(this.garden.heightField);
    this.rain = this.weather.rain; this.snow = this.weather.snow;
    scene.add(this.weather.rain, this.weather.splash, this.weather.snow);
    this.shafts = new THREE.Group(); scene.add(this.shafts);
    this.#makeShaftMaterial();
    this.setLayout(layout);
    this.lightning = 0; this.nextLightning = 8;
    scene.fog = new THREE.FogExp2(0x1a120c, 0.0);
    this.fires = [];
    this._sun = new THREE.Vector3(); this._moon = new THREE.Vector3(); this._night = new THREE.Vector3(); this._v = new THREE.Vector3();
    this.uniforms = { SKY, NATURE };   // (the checks)
  }

  setLayout(layout) {
    this.layout = layout;
    // the book room's windows: their light falls onto the garden at night (nature.js natWindowSpill)
    const wins = (layout.openings || []).filter((o) => o.kind === 'window').slice(0, 4);
    NATURE.uWindows.value.forEach((v, i) => {
      const o = wins[i], dir = NATURE.uWindowDirs.value[i];
      if (!o) { v.set(0, -100, 0, 0); return; }
      dir.set(...(o.dir || [0, 0, 1])).normalize();
      v.set(o.x + dir.x * 0.25, o.y0 + o.h / 2, o.z + dir.z * 0.25, o.w * o.h);
    });
    for (const m of [...this.shafts.children]) { this.shafts.remove(m); m.geometry.dispose(); }
    for (const o of (layout.openings || []).filter((o) => o.kind === 'window')) {
      const geo = new THREE.PlaneGeometry(o.w, 9);
      const m = new THREE.Mesh(geo, this.shaftMat);
      m.userData.opening = o;
      m.frustumCulled = false;
      this.shafts.add(twoSided(m));
    }
  }
  /** Graphics quality: how much grass the garden draws. */
  setQuality(q, opts) { this.garden.setQuality?.(q, opts); }

  #makeShaftMaterial() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 256; const cx = c.getContext('2d');
    const gr = cx.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = gr; cx.fillRect(0, 0, 64, 256);
    const gx = cx.createLinearGradient(0, 0, 64, 0); gx.addColorStop(0, 'rgba(0,0,0,1)'); gx.addColorStop(0.18, 'rgba(0,0,0,0)'); gx.addColorStop(0.82, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,1)');
    cx.globalCompositeOperation = 'destination-out'; cx.fillStyle = gx; cx.fillRect(0, 0, 64, 256);
    const tex = new THREE.CanvasTexture(c);
    this.shaftMat = new THREE.MeshBasicMaterial({ color: 0xffe6b8, map: tex, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  }

  addFire(position) { const f = new Fire(); f.group.position.copy(position); this.scene.add(f.group); this.fires.push(f); return f; }

  /** { hour, skyHour, skyTime, sun, moonPhase, mix, weather, brightness, warmth, shadows, golden }. A weather word alone
   *  (the old way; the checks) brings its mix. */
  set(patch) {
    if (patch.weather !== undefined && patch.mix === undefined) patch = { ...patch, mix: mixOf(phaseOf(fixedWeatherOf({ weather: patch.weather }))) };
    Object.assign(this.state, patch); this.apply();
  }
  apply() {
    const st = this.state, { hour, brightness, warmth } = st;
    const mix = st.mix || (st.mix = mixOf(phaseOf(fixedWeatherOf({ weather: st.weather }))));
    const weather = nameOfMix(mix);
    // the golden hour (godrays.js) has a sun of its own, low in the north-west over the lake; the day mode's twilight one
    // that goes along under the northern horizon (sky-state.js)
    const sunDir = st.golden ? goldenSun(this._sun) : st.sun ? this._sun.copy(st.sun) : sunPosition(hour, this._sun);
    const day = smoothstep(-0.08, 0.18, sunDir.y);
    const dusk = 1 - smoothstep(0.05, 0.4, Math.abs(sunDir.y));
    const overcast = mix.overcast, fog = mix.fog;
    const night = 1 - day;
    this.daylight = day * (1 - overcast * 0.5);      // 0 at night … 1 on a clear day (cinema, reflections)
    // fog hides the sky: dense fog all of it, a morning mist only low down
    const fogSky = smoothstep(0.45, 0.95, fog);

    // --- the night sky: the stars and the moon of the date turn with the sky time (celestial.js) ----------------------
    const phase = st.moonPhase ?? moonPhase();
    const skyHour = st.skyHour ?? hour;
    const skyMs = st.skyTime ?? clockTime(skyHour);
    skyRotation(siderealAngle(skyMs), SKY.uSkyRot.value); galacticRotation(SKY.uSkyRot.value, SKY.uGalRot.value);
    const moonDir = moonEquatorial(skyMs, phase, this._moon).applyMatrix3(SKY.uSkyRot.value).normalize();
    const moonUp = smoothstep(-0.015, 0.09, moonDir.y);
    const lit = moonLit(phase);
    // how much of the sky is open overhead (the clouds hide the moon and the stars in the shader, this is the rest)
    const open = (1 - overcast * 0.96) * (1 - fogSky);
    const moonLight = moonBrightness(phase) * moonUp * open;   // 0 … 1: how much the moon lights the garden
    const starsUp = smoothstep(0.03, -0.13, sunDir.y);         // from sunset to deep dusk the stars come out
    this.moonLight = moonLight;

    // --- the sky: blue by day, warm at the horizon towards a low sun, deep blue at night, grey under cloud ---------------
    const warmDusk = dusk * day;
    const lum = 0.35 + 1.05 * day;                   // brighter by day than the colours alone say
    // (the night's colours are given as they show: divided by the night's lum, which scales them back)
    const T = this._t ||= Array.from({ length: 12 }, () => new THREE.Color());
    const zen = T[0].copy(NIGHT.zenith).lerp(NIGHT.zenithMoon, moonLight).multiplyScalar(1 / 0.35).lerp(P.zenDay, day).lerp(P.zenDusk, warmDusk * 0.55);
    const hor = T[1].copy(NIGHT.horizon).lerp(NIGHT.horizonMoon, moonLight).multiplyScalar(1 / 0.35).lerp(P.horDay, day).lerp(P.horDusk, warmDusk * 0.7);
    const grey = T[2].copy(P.grey).multiplyScalar(0.12 + 0.88 * day);
    zen.lerp(grey, overcast * 0.85); hor.lerp(grey.multiplyScalar(1.08), overcast * 0.78);
    const lum3 = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    if (fogSky > 0) {
      // fog hides the sky: one even grey-white, a shade brighter overhead (no blue in it)
      const g = lum3(hor) * 1.12, fg = T[3].setRGB(g, g, g * 1.015);
      hor.lerp(fg, fogSky); zen.lerp(fg, fogSky);
    }
    SKY.uZenith.value.copy(zen).multiplyScalar(lum);
    SKY.uHorizon.value.copy(hor).multiplyScalar(lum);
    const glowCol = T[4].copy(P.glow).lerp(P.glowDusk, warmDusk);
    SKY.uSunGlow.value.copy(glowCol).multiplyScalar((0.35 + 1.2 * warmDusk) * day * (1 - overcast * 0.8));
    SKY.uSunDisc.value.copy(glowCol).multiplyScalar(sunDir.y > -0.02 ? 22 * (1 - overcast) : 0);
    this.#moonDisc(moonDir, sunDir, lit, phase, { day, starsUp, fogSky, open });
    // the stars and the Milky Way: with the dark, behind the clouds (the shader); the moon outshines the faint ones
    SKY.uStars.value = starsUp * (1 - overcast * 0.9) * (1 - fogSky) * (1 - 0.35 * moonLight);
    SKY.uMilky.value = 0.034 * starsUp * smoothstep(0.85, 0.3, overcast) * (1 - fogSky) * (1 - 0.7 * moonLight);
    SKY.uCloudCover.value = mix.cloud;
    SKY.uCloudSpeed.value = 0.7 + 1.6 * mix.wind;
    const litCol = T[5].copy(P.white).lerp(P.litDusk, warmDusk);
    // clouds by night: lit by the moon, silver; without it a little lighter than the sky (the glow of far towns)
    SKY.uCloudLit.value.copy(litCol).multiplyScalar(((0.04 + 0.13 * moonLight) * night + 1.3 * day) * (1 - overcast * 0.42) * lum * 0.8);
    // snow clouds are pale; rain and storm clouds dark
    const shade = T[6].copy(P.shade).lerp(P.shadeDark, overcast).lerp(P.shadeSnow, mix.snow);
    SKY.uCloudShade.value.copy(shade).multiplyScalar(((0.03 + 0.06 * moonLight) * night + 0.9 * day) * (1 - 0.45 * mix.thunder) * lum * 0.8);
    SKY.uOvercast.value = overcast;
    if (fogSky > 0) {
      // in fog the clouds are only a faint structure in the grey
      SKY.uCloudLit.value.lerp(T[7].copy(hor).multiplyScalar(lum * 1.04), fogSky);
      SKY.uCloudShade.value.lerp(T[7].copy(hor).multiplyScalar(lum * 0.93), fogSky);
    }
    // the air: the horizon's colour, but paler (the far hills fade into a light veil, not into blue) and a little
    // brighter towards the sun. It starts only beyond the wood round the garden; fog is grey-white and close.
    const [start, reach, most, sat] = blendWeather(mix, HAZE, this._haze ||= [0, 0, 0, 0]);
    const hl = lum3(SKY.uHorizon.value);
    NATURE.uHazeColor.value.setRGB(hl, hl, hl * 1.01).lerp(SKY.uHorizon.value, sat);
    NATURE.uHazeSun.value.copy(glowCol).multiplyScalar((0.25 + 0.9 * warmDusk) * day * (1 - overcast * 0.85));
    NATURE.uHazeStart.value = start;
    NATURE.uHazeDensity.value = 1 / reach;
    NATURE.uHazeMax.value = most;

    // --- the light from the sky: the sun by day, the moon (or the sky's own glow from high up) by night ------------------
    // The two change over while both are faint: no jump in the light or the shadows at dusk.
    const sunCol = T[8].lerpColors(P.sunLow, P.sunHigh, smoothstep(0.1, 0.6, sunDir.y));
    const isDay = sunDir.y > 0.02;
    // a low sun is dimmer as well as warmer, so morning and evening actually differ from noon; by night the moon gives
    // a blue-silver light bright enough to find the way down to the lake (strongest at full moon, high up)
    const nightOn = smoothstep(0.02, -0.06, sunDir.y);
    const moonI = (0.1 + 0.55 * moonBrightness(phase) * moonUp) * (1 - overcast * 0.9) * (1 - fogSky * 0.6) * nightOn;
    this.sun.color.copy(isDay ? sunCol : NIGHT.moon);
    this.sun.intensity = (isDay ? 2.4 * smoothstep(0.0, 0.5, sunDir.y) * (1 - overcast * 0.85) : moonI) * brightness;
    // the night's light comes from the moon when it is up, else from high in the sky
    const nightDir = this._night.copy(HIGH).lerp(moonDir.y > 0.02 ? moonDir : HIGH, moonUp).normalize();
    // (a vector of its own: the others copy it)
    (this.sunDir ||= new THREE.Vector3()).copy(isDay ? sunDir : nightDir);

    // --- the garden's light: the sky from above, the ground (snow: bright) from below ---------------------------------
    const snow = mix.cover;
    // (linear values: the sky gives about a fifth of what the sun gives on a clear day, all of it under cloud)
    const skyAmb = T[9].copy(P.skyClear).lerp(P.skyGrey, overcast).multiplyScalar(0.03 + 0.97 * day).lerp(P.skyDusk, warmDusk * 0.35);
    // the night: starlight and the glow of the air, the moon's sky, the clouds lit from below; a snowy night is brighter
    const nightAmb = T[10].copy(NIGHT.light).lerp(NIGHT.lightMoon, moonBrightness(phase) * moonUp * (1 - fogSky)).lerp(NIGHT.overcast, overcast).multiplyScalar((1 - fogSky * 0.25) * night);
    skyAmb.add(nightAmb).add(T[11].copy(P.snowNight).multiplyScalar(snow * night));
    NATURE.uSkyLight.value.copy(skyAmb).multiplyScalar(brightness);
    NATURE.uGroundLight.value.copy(P.ground).lerp(P.groundSnow, snow).multiplyScalar((0.04 + 0.96 * day + 0.6 * night * (0.5 + moonLight)) * brightness);
    NATURE.uSunDirW.value.copy(this.sunDir);
    NATURE.uSunLight.value.copy(this.sun.color).multiplyScalar(this.sun.intensity);
    NATURE.uSnow.value = snow;
    NATURE.uWinter.value = snow > 0.5 ? 1 : 0;
    NATURE.uWet.value = mix.wet;
    NATURE.uWind.value = mix.wind;
    // the eye at night: dim colours fade (a little less in fog and snow, which are grey anyway)
    NATURE.uNightGrade.value = 0.62 * smoothstep(0.55, 0.0, day);
    // the lit rooms shine out of the book room's windows into the dark wood
    NATURE.uWindowLight.value.setRGB(1.0, 0.74, 0.46).multiplyScalar(12 * smoothstep(0.5, 0.05, day) * brightness);

    const warm = T[2].lerpColors(P.neutral, P.warm, warmth);
    // Indoors the hemisphere light is the light bouncing round the rooms: grey-blue daylight from the windows by
    // day, the warm light of the lamps once the daylight fades. (With the dusk sky's grey in it the rooms looked
    // grey all evening.) The garden takes the sky light above instead (nature.js).
    const indoorDay = smoothstep(0.2, 0.85, this.daylight);
    this.hemi.color.lerpColors(P.hemiNight, hor, indoorDay).lerp(warm, 0.3);
    this.hemi.groundColor.set(0x4a3626);
    this.baseHemi = (0.26 + 0.44 * day * (1 - overcast * 0.5)) * brightness;
    this.hemi.intensity = this.baseHemi;
    this.ambient.color.copy(warm);
    this.baseAmbient = (0.36 + 0.16 * (1 - day)) * brightness;
    this.ambient.intensity = this.baseAmbient;

    // the lights in the garden go on softly once the sun is low (the golden hour), fully when night falls
    this.garden.apply({ night, weather, mix, treeLine: T[3].copy(P.treeLine).multiplyScalar(0.1 + 0.9 * day + 0.12 * night * (0.4 + moonLight)), lamps: 0.3 * (1 - smoothstep(0.2, 0.4, sunDir.y)) });

    this.weather.setMix(mix);
    // drops and flakes near the house catch the warm light of the string lights and the rooms at night
    this.weather.shared.uGlow.value.set(1.0, 0.72, 0.42).multiplyScalar(0.55 * clamp((night - 0.25) / 0.6, 0, 1));
    // indoor fog only in fog weather (the garden has its own haze), as grey as the fog outside
    this.scene.fog.density = 0.012 * Math.pow(fogSky, 1.5);
    this.scene.fog.color.copy(NATURE.uHazeColor.value).multiplyScalar(0.9);

    this.shaftTarget = isDay ? 0.055 * smoothstep(0.05, 0.3, sunDir.y) * (1 - overcast) * brightness : 0;
    for (const m of this.shafts.children) {
      const o = m.userData.opening;
      const dir = this._v.set(...(o.dir || [0, 0, 1]));
      // a shaft only exists where the sun actually shines into the window
      m.visible = isDay && sunDir.dot(dir) > 0.12;
      const tilt = clamp(sunDir.y, 0.05, 1);
      const angle = Math.atan2(1, tilt);
      const yaw = Math.atan2(dir.x, dir.z);
      m.rotation.set(0, 0, 0);
      m.rotateY(yaw);
      m.rotateX(-(Math.PI / 2 - angle));
      const drop = Math.sin(angle) * 2.3, push = Math.cos(angle) * 2.3;
      m.position.set(o.x - dir.x * push, o.y0 + o.h / 2 - drop, o.z - dir.z * push);
    }
    this.day = day;
    // the warm light of every low sun, and how strong the god rays are (godrays.js)
    applyGolden(this, sunDir, { weather, mix, overcast, brightness, day });
  }

  /** Where the rain glows warm at night: outside the lit opening nearest to the eye. */
  #glowAt(p) {
    const at = this.weather.shared.uGlowPos.value;
    let best = (p.x - 0) ** 2 + (p.z - 7.6) ** 2;
    at.set(0, 2.2, 7.6);
    for (const v of NATURE.uWindows.value) {
      if (v.w <= 0) continue;
      const d = (p.x - v.x) ** 2 + (p.z - v.z) ** 2;
      if (d < best) { best = d; const i = NATURE.uWindows.value.indexOf(v), dir = NATURE.uWindowDirs.value[i]; at.set(v.x + dir.x * 1.6, v.y, v.z + dir.z * 1.6); }
    }
  }
  /** How much the eye opens up outside at night (world.js multiplies the exposure): up to 1.75 on the terrace and in the
   *  garden in the dark, nothing indoors (the warm rooms keep their look) and by day. */
  nightEye(p) {
    const out = clamp((p.z - HOUSE_FRONT - 0.2) / 3, 0, 1);
    return 1 + 0.75 * out * (1 - smoothstep(0.0, 0.5, this.day ?? 1));
  }
  /** The moon's disc: where it stands, which side the sun lights (its phase), its face upright, how bright. */
  #moonDisc(m, sunDir, lit, phase, { day, starsUp, fogSky, open }) {
    const U = SKY.uMoonU.value, V = SKY.uMoonV.value, X = SKY.uMoonX.value, Y = SKY.uMoonY.value;
    SKY.uMoonDir.value.copy(m);
    // towards the sun on the disc (the lit limb faces it); when the sun stands right behind, any direction will do
    U.copy(sunDir).addScaledVector(m, -sunDir.dot(m));
    if (U.lengthSq() < 1e-6) U.copy(UP).addScaledVector(m, -m.y);
    U.normalize(); V.crossVectors(m, U).normalize();
    Y.copy(UP).addScaledVector(m, -m.y);
    if (Y.lengthSq() < 1e-6) Y.set(0, 0, 1);
    Y.normalize(); X.crossVectors(m, Y).normalize();
    const psi = Math.acos(clamp(2 * lit - 1, -1, 1));       // the angle sun, moon, earth: 0 at full moon
    SKY.uMoonL.value.set(Math.sin(psi), 0, Math.cos(psi));
    const up = smoothstep(-0.02, 0.02, m.y) * (1 - fogSky);
    // pale by day, bright at night; the clouds cover it in the shader; none at new moon
    SKY.uMoon.value = (0.28 + 1.9 * starsUp) * up * (lit > 0.004 ? 1 : 0);
    SKY.uMoonGlow.value = moonBrightness(phase) * up * starsUp * (0.6 + 0.4 * open);
  }

  update(dt, camera) {
    this.time += dt;
    NATURE.uTime.value = this.time;
    this.sky.position.copy(camera.position);
    this.scenery.position.set(0, 0, 0);
    // the stars keep their size on the screen (drawing buffer pixels per 1080 lines)
    const dbs = this.renderer.getDrawingBufferSize(this._dbs || (this._dbs = new THREE.Vector2()));
    this.stars.uniforms.uPx.value = clamp(dbs.y / 1080, 1, 2.4);

    if (this.sunDir) this.#shadowFrame(dt, camera);

    if (this.rain.visible || this.snow.visible) {
      const p = camera.position;
      // the drops and flakes catch the light of the lit window nearest to the eye (the terrace, the book room's windows)
      this.#glowAt(p);
      this.weather.update(this.time, camera, outside(p.x, p.z) ? groundHeight(p.x, p.z) : 0, this.renderer);
    }

    // storm lightning – computed fresh every frame instead of accumulating onto the lights
    const thunder = this.state.mix?.thunder ?? 0;
    if (thunder > 0.5) {
      this.nextLightning -= dt * (thunder - 0.4) / 0.6;
      if (this.nextLightning <= 0) { this.lightning = 1; this.nextLightning = 6 + Math.random() * 18; }
    } else this.lightning = 0;
    if (this.lightning > 0) this.lightning = Math.max(0, this.lightning - dt * 3);
    const flash = this.lightning * this.lightning;
    SKY.uFlash.value = flash * 0.8;
    this.hemi.intensity = this.baseHemi + flash * 0.6;
    this.ambient.intensity = this.baseAmbient + flash * 0.25;

    this.shaftMat.opacity = lerp(this.shaftMat.opacity, this.shaftTarget || 0, dt * 2);
    // (the shafts draw with its back-side and front-side copies, two-sided.js)
    { const s = sidesOf(this.shaftMat); s.back.opacity = s.front.opacity = this.shaftMat.opacity; }
    this.garden.update(dt, this.time, camera);
    for (const f of this.fires) f.update(dt);
  }

  /**
   * The sun's shadow map. Its frustum stays round the player in steps of about 1.5 m that are a whole number of its texels
   * along the light's own axes (so the shadows do not swim when it moves on). It is drawn again when the sun has gone on
   * by a third of a texel at the tip of the shadow of a crown 8 m up (the sun's direction changes every frame now: the
   * shadows move smoothly instead of jumping every few seconds). Then the trees' map (godrays.js) is drawn on that frame
   * and the sun's map on the next, so no frame pays for both (at most 30 times a second each).
   */
  #shadowFrame(dt, camera) {
    const sun = this.sun, d = this.sunDir, at = this.shadowAt, sc = sun.shadow.camera;
    const fwd = this._v.copy(d).negate();
    const right = (this._r ||= new THREE.Vector3()).crossVectors(fwd, Math.abs(fwd.y) > 0.999 ? (this._z ||= new THREE.Vector3(0, 0, 1)) : UP).normalize();
    const upL = (this._u ||= new THREE.Vector3()).crossVectors(right, fwd).normalize();
    const texel = (sc.right - sc.left) / sun.shadow.mapSize.x;
    const step = Math.max(texel, Math.round(1.5 / texel) * texel);
    const p = camera.position, py = 1.2;
    const pr = p.x * right.x + py * right.y + p.z * right.z, pu = p.x * upL.x + py * upL.y + p.z * upL.z, pf = p.x * fwd.x + py * fwd.y + p.z * fwd.z;
    const sr = Math.round(pr / step) * step, su = Math.round(pu / step) * step;
    this.sunTarget.position.set(right.x * sr + upL.x * su + fwd.x * pf, right.y * sr + upL.y * su + fwd.y * pf, right.z * sr + upL.z * su + fwd.z * pf);
    sun.position.copy(this.sunTarget.position).addScaledVector(d, 48);
    this.sunShadowTimer -= dt;
    at.frames++;
    if (at.pending) { at.pending = false; this.#redraw(); return; }
    const allowed = clamp((texel / 3) * Math.max(0.12, d.y) ** 2 / 8, 0.00004, 0.002);
    const moved = at.dir.angleTo(d) > allowed;
    // the cat is the only thing that moves: once a second is enough, and by moonlight not at all
    const periodic = this.sunShadowTimer <= 0 && this.daylight > 0.05;
    if (sr !== at.r || su !== at.u) { at.r = sr; at.u = su; this.#redraw(); }
    else if (moved && at.frames >= 1) { at.dir.copy(d); at.frames = 0; this.treesDue = true; at.pending = true; }
    else if (periodic) this.#redraw();
  }
  #redraw() { this.sun.shadow.needsUpdate = true; this.shadowRedraws++; this.shadowAt.dir.copy(this.sunDir); this.shadowAt.frames = 0; this.sunShadowTimer = 1.0; }
}

// --- fireplace fire ------------------------------------------------------------------------
const fireVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const fireFrag = `
uniform float uTime; uniform float uIntensity; varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.1; a*=0.5;} return v; }
void main(){
  vec2 uv = vUv;
  float t = uTime;
  vec2 q = vec2(uv.x*3.0, uv.y*2.0 - t*1.6);
  float n = fbm(q + fbm(q*1.7 + t*0.4));
  float shape = 1.0 - smoothstep(0.0, 1.0, uv.y);
  float side = 1.0 - pow(abs(uv.x-0.5)*2.0, 2.2);
  float flame = clamp((n*1.4 + 0.15) * shape * side - uv.y*0.55, 0.0, 1.0);
  float f = smoothstep(0.08, 0.6, flame) * uIntensity;
  vec3 col = mix(vec3(1.0,0.25,0.02), vec3(1.0,0.75,0.2), pow(f,1.5));
  col = mix(col, vec3(1.0,0.95,0.7), pow(f,4.0));
  gl_FragColor = vec4(col * f * 1.35, f);
}`;
export class Fire {
  constructor() {
    this.group = new THREE.Group();
    this.uniforms = { uTime: { value: 0 }, uIntensity: { value: 1 } };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: fireVert, fragmentShader: fireFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.planes = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.8), this.mat);
      m.rotation.y = i * Math.PI / 3; m.position.y = 0.4; this.group.add(twoSided(m)); this.planes.push(m);
    }
    const n = 60; const pos = new Float32Array(n * 3); this.emberVel = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos.set([(Math.random() - 0.5) * 0.4, Math.random() * 0.6, (Math.random() - 0.5) * 0.3], i * 3); this.emberVel[i] = 0.3 + Math.random() * 0.5; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.emberMat = new THREE.PointsMaterial({ color: 0xff9a3c, size: 0.02, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.embers = new THREE.Points(geo, this.emberMat);
    this.group.add(this.embers);
    this.light = new THREE.PointLight(0xff8a3a, 0, 11, 1.35); this.light.position.set(0, 0.5, 0.25); this.light.castShadow = true; this.light.shadow.mapSize.set(512, 512); this.light.shadow.bias = -0.003;
    // flames are a broad light: soft shadow edges. The firebox throws its shadow across the hall onto the far walls,
    // where a texel of the cube map is some 3 cm: with the default radius its edge was a staircase of light beside
    // the wall light on the south wall (only a uniform, no extra cost)
    this.light.shadow.radius = 6;
    // a cube shadow renders the room six times: the furniture does not move, so twice a second is plenty
    this.light.shadow.autoUpdate = false; this.light.shadow.needsUpdate = true; this.shadowTimer = 0;
    this.group.add(this.light);
    this.glow = new THREE.PointLight(0xff5a1a, 0, 3.5, 1.35); this.glow.position.set(0, 0.2, 0.1); this.group.add(this.glow);
    this.intensity = 1; this.t = 0;
  }
  update(dt) {
    this.t += dt; this.uniforms.uTime.value = this.t; this.uniforms.uIntensity.value = this.intensity;
    // the cube shadow renders the room six times: only while someone is near the fire to see it
    this.shadowTimer -= dt;
    if (this.shadowTimer <= 0 && this.near !== false) { this.light.shadow.needsUpdate = true; this.shadowTimer = 1.0; }
    const flicker = 0.85 + Math.sin(this.t * 9.3) * 0.06 + Math.sin(this.t * 23.7) * 0.05 + Math.sin(this.t * 3.1) * 0.05;
    this.light.intensity = 6.5 * flicker * this.intensity; this.glow.intensity = 2.4 * flicker * this.intensity;
    const pos = this.embers.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { let y = pos.getY(i) + this.emberVel[i] * dt; let x = pos.getX(i) + Math.sin(this.t * 3 + i) * 0.05 * dt; if (y > 0.9) { y = 0.05; x = (Math.random() - 0.5) * 0.4; } pos.setY(i, y); pos.setX(i, x); }
    pos.needsUpdate = true;
  }
  dispose() {
    for (const m of this.planes) m.geometry.dispose();
    this.mat.dispose(); this.embers.geometry.dispose(); this.emberMat.dispose();
    this.light.dispose?.(); this.glow.dispose?.();
  }
}
