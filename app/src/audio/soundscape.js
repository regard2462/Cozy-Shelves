// The soundscape: every sound of the world follows what you see and where you stand. It reads the world a few times a
// second (the engine's ticker): the weather (world.weatherState() when it exists, else settings.weather), the wind in
// the plants, the snow on the ground, the hour and the season, the fire, the clock, the terrace door and the listener
// (camera and view direction). From that it sets the layers of ambient.js (rain, wind and leaves, the fireplace, the
// fire bowl, the clock, crickets), lets thunder follow a lightning strike after the time its sound needs from the strike
// to you, and schedules the voices of the garden (voices.js): songbirds by day and the dawn chorus, the owl at night,
// frogs at dusk and in warm nights, ducks and a moorhen on the lake, water lapping at the shore. acoustics.js says how
// each of them reaches the listener through the house. No switches: the volume sliders (Umgebung, Effekte) are all.
//
// The fire bowl of the garden (another module): when world.fireBowl?.position (a THREE.Vector3) exists and
// world.fireBowl.isBurning?.() is true, its crackle plays there.
//
// Single sounds can be switched off by hand (settings.audio.sounds, all on by default; setSwitches): a sound switched
// off fades at once, its layer stops right after and nothing is made for it any more; switched on again it plays as
// soon as the world calls for it.
import { gainNode, filterNode, clamp, impulseResponse, rng } from './dsp.js';
import { Acoustics, airLp } from './acoustics.js';
import { RainSound, WindSound, FireSound, ClockSound, CricketSound, thunder } from './ambient.js';
import { birdPhrase, owlCall, frogBout, treeFrog, duckCall, moorhenCall, waterLap } from './voices.js';
import { warmSteps } from './steps.js';
import { prepareTextures } from './textures.js';
import { offthreadStats } from './offthread.js';
import { TREES, LAKE, WATER_Y, lakeDist, shorePoint, lakeAngle, terrainHeight, onJetty } from '../world/outdoor.js';
import { seasonOf } from '../world/season.js';
import { NATURE } from '../world/nature.js';

const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const SOUND_SPEED = 343;
const HORIZON = 0.4;          // garden events are planned this far ahead (s), so they are placed where you stand then
const OFF_AFTER = 4;          // a layer that stays silent this long stops its sources
const QUIET_AFTER = 0.8;      // … and one switched off by hand right after its fade

/** The single sounds the user can switch off (settings.audio.sounds: { rain: true, … }, a missing key means on). The
 *  leaves belong to the wind; the drops on the pane, the gutter and the drumming on the roof to the rain; the owl, the
 *  ducks and the moorhen to the birds. */
export const SOUND_SWITCHES = ['rain', 'wind', 'thunder', 'fire', 'firebowl', 'clock', 'birds', 'frogs', 'crickets', 'water', 'steps'];
// the switch of each voice of the garden
const SWITCH_OF = { song: 'birds', owl: 'birds', duck: 'birds', moorhen: 'birds', frog: 'frogs', treefrog: 'frogs', lap: 'water', thunder: 'thunder' };

/** The sun's height (sine of the elevation) at an hour, along the arc of environment.js (sunrise 6:30, sunset 20:30). */
export function sunHeight(hour) {
  const t = (hour - 6.5) / 14;
  const e = t < 0 ? Math.max(-0.35, t * Math.PI * 0.95) : t > 1 ? Math.max(-0.35, (1 - t) * Math.PI * 0.95) : Math.sin(t * Math.PI) * 0.95;
  return Math.sin(Math.max(e, -0.3));
}

// how lively the birds are through the year (the calendar month, northern hemisphere) and per chosen season
const BIRD_MONTH = [0.15, 0.25, 0.6, 1, 1, 0.85, 0.6, 0.4, 0.35, 0.3, 0.2, 0.15];
const BIRD_SEASON = { spring: 1, summer: 0.75, autumn: 0.32, winter: 0.18 };
const FROG_MONTH = [0, 0, 0.05, 0.6, 1, 0.95, 0.85, 0.55, 0.2, 0.03, 0, 0];
const FROG_SEASON = { spring: 0.9, summer: 0.85, autumn: 0.12, winter: 0 };
const CRICKET_MONTH = [0, 0, 0, 0.05, 0.4, 0.8, 1, 1, 0.6, 0.15, 0, 0];
const CRICKET_SEASON = { spring: 0.25, summer: 1, autumn: 0.35, winter: 0 };
// who sings, per season (weights)
const MIX = {
  spring: { blackbird: 3, robin: 2, greattit: 2, chaffinch: 2.5, chiffchaff: 1.5, wren: 1.5, pigeon: 1, sparrow: 1, crow: 0.5, cuckoo: 0.6 },
  summer: { blackbird: 2.5, robin: 1.5, greattit: 1, chaffinch: 1.5, chiffchaff: 1.2, wren: 1.2, pigeon: 1.5, sparrow: 1.2, crow: 0.8, cuckoo: 0.15 },
  autumn: { robin: 3, greattit: 1.2, wren: 1.5, pigeon: 0.8, sparrow: 1, crow: 1.5, blackbird: 0.4, chiffchaff: 0.3 },
  winter: { robin: 2.5, greattit: 1.5, wren: 1.2, crow: 2, sparrow: 0.6, pigeon: 0.3 },
};
// the dawn chorus and the evening favour the great singers
const CHORUS = { blackbird: 2.5, robin: 2, wren: 1.8, chaffinch: 1.5 }, EVENING = { blackbird: 3, robin: 2, wren: 1.2 };
// how far away each kind sings (m) and how loud it is at 1 m (ref: the distance of full loudness)
const REACH = { blackbird: [8, 45, 5], robin: [6, 35, 4], greattit: [6, 35, 4], chaffinch: [8, 45, 4.5], chiffchaff: [10, 45, 4], wren: [6, 40, 5], pigeon: [15, 60, 5], sparrow: [6, 25, 3], crow: [25, 80, 9], cuckoo: [50, 110, 10] };
// about how long a phrase lasts (s): a bird does not start a new one while it still sings
const PHRASE = { blackbird: 2.6, robin: 2.2, greattit: 2, chaffinch: 2.6, chiffchaff: 3.5, wren: 4.5, pigeon: 5, sparrow: 2.5, crow: 2, cuckoo: 9 };

/**
 * How often things happen in the garden, from the hour, the season and the weather (events a minute; crickets 0 … 1).
 * c: { hour, season, month (0 … 11 or null when a season is chosen), rain (0 … 1), wind (0 … 1), fog, snowing, frozen }
 */
export function gardenRates(c) {
  const e = sunHeight(c.hour), morning = c.hour < 13;
  const bird = c.month != null ? BIRD_MONTH[c.month] : BIRD_SEASON[c.season] ?? 0.5;
  const frogY = c.month != null ? FROG_MONTH[c.month] : FROG_SEASON[c.season] ?? 0;
  const crickY = c.month != null ? CRICKET_MONTH[c.month] : CRICKET_SEASON[c.season] ?? 0;
  const rain = c.rain || 0, storm = rain > 0.85 || !!c.thunder;
  // weather: rain quiets the birds (a drizzle less), a storm silences them, falling snow and strong wind as well
  const wetBirds = storm ? 0 : (1 - 0.8 * Math.min(1, rain / 0.6)) * (c.fog ? 0.6 : 1) * (c.snowing ? 0.35 : 1) * (c.wind > 0.75 ? 0.5 : 1);
  // songbirds: none in the dark; the dawn chorus around sunrise; lively mornings, a lull at midday, evening song
  const chorus = morning ? Math.exp(-(((e - 0.03) / 0.11) ** 2)) : 0;
  const day = smooth(-0.1, 0.12, e) * (morning ? 1 : c.hour < 16 ? 0.65 : 0.85);
  const evening = !morning ? Math.exp(-(((e - 0.06) / 0.1) ** 2)) * 0.6 : 0;
  const dark = e < -0.16;
  const song = dark ? 0 : (9 * Math.max(day, evening) + 26 * chorus) * bird * wetBirds;
  // the night: the owl; dusk and night: frogs in the warm months, crickets in summer
  const night = smooth(-0.02, -0.14, e), dusk = !morning ? Math.exp(-(((e + 0.05) / 0.12) ** 2)) : 0;
  const owl = 0.45 * Math.max(night, dusk * 0.5) * (c.season === 'autumn' ? 1.4 : c.season === 'winter' ? 1.2 : c.season === 'summer' ? 0.7 : 1) * (storm ? 0 : rain > 0 ? 0.4 : 1) * (c.wind > 0.75 ? 0.5 : 1);
  const frogTime = Math.max(dusk, night * (c.season === 'summer' ? 0.8 : c.season === 'spring' ? 0.45 : 0.1), morning ? 0.25 * smooth(-0.1, 0.05, e) * (1 - smooth(0.1, 0.3, e)) : 0, 0.12 * smooth(0, 0.2, e));
  const frogs = c.frozen || c.snowing ? 0 : 14 * frogY * frogTime * (storm ? 0.25 : rain > 0 ? 1.15 : 1);
  const treefrogs = c.frozen || c.snowing || storm ? 0 : 3 * (c.month != null ? (c.month === 3 || c.month === 4 ? 1 : c.month === 5 ? 0.4 : 0) : c.season === 'spring' ? 1 : 0) * Math.max(dusk, night);
  const crickets = c.snowing || storm ? 0 : crickY * Math.max(night, dusk, 0.6 * smooth(0.25, 0.05, e) * (morning ? 0 : 1), 0.2) * (rain > 0 ? 0.3 : 1) * (c.wind > 0.7 ? 0.6 : 1) * (c.fog ? 0.8 : 1);
  // the lake: a mallard or a moorhen now and then, by day and in the evening, not on ice and not in a storm
  const waterBirds = c.frozen || storm ? 0 : (c.season === 'spring' ? 1.2 : c.season === 'winter' ? 0.6 : 1) * (dark ? 0.15 : 1) * (rain > 0 ? 0.6 : 1);
  return { song, chorus: chorus * bird * wetBirds, evening: evening * bird * wetBirds, owl, frogs, treefrogs, crickets: clamp(crickets, 0, 1), ducks: 0.5 * waterBirds, moorhens: 0.3 * waterBirds };
}

/** The weather as the soundscape needs it: { base, rain 0 … 1, wind 0 … 1, thunder, snowing, fog }. Reads the combined
 *  weather of world.weatherState() when the world offers it (a later weather module), else settings.weather; the rain
 *  is only heard while drops are drawn, the wind follows the plants' sway (NATURE.uWind). */
export function weatherOf(world) {
  const s = world?.settings || {};
  let ws = null; try { ws = world?.weatherState?.() || null; } catch (e) { ws = null; }
  const base = ws?.base || s.weather || 'clear';
  let rain = typeof ws?.rain === 'number' ? ws.rain : base === 'storm' ? 1 : base === 'rain' ? 0.6 : 0;
  if (world?.env?.rain && world.env.rain.visible === false) rain = 0;
  // (the parts of the mix are continuous and ease out over minutes: a trace of thunder or snow left over from the last
  // weather is none; the same thresholds as sky-state.js nameOfMix)
  const thunder = ws ? (typeof ws.thunder === 'number' ? ws.thunder > 0.5 : !!(ws.thunder ?? base === 'storm')) : base === 'storm';
  const snowing = base === 'snow' || (typeof ws?.snow === 'number' ? ws.snow > 0.15 : !!ws?.snow);
  const fog = typeof ws?.fog === 'number' ? ws.fog > 0.25 : !!ws?.fog || base === 'fog';
  let wind = NATURE.uWind.value;
  if (typeof ws?.wind === 'number') wind = Math.max(wind, ws.wind); else if (ws?.wind === true) wind = Math.max(wind, 0.75);
  return { base, rain: clamp(rain, 0, 1), wind: clamp(wind, 0, 1), thunder, snowing, fog };
}

/** What the floor style of the rooms is made of (a floor setting, if the world has one): 'wood', 'stone' or 'carpet'. */
export function floorSurface(world) {
  let style = null;
  try { style = world?.floorStyle?.() ?? world?.settings?.floor?.style ?? world?.settings?.floors?.style ?? world?.settings?.floor ?? null; } catch (e) { style = null; }
  const s = String(style || '').toLowerCase();
  if (/carpet|teppich/.test(s)) return 'carpet';
  if (/marb|marm|stone|stein|terrazz|tile|flies|terrac|slate|schiefer|schach|chess|granit|concrete|beton|cement|zement/.test(s)) return 'stone';
  return 'wood';
}

/** A short positional chain for one sound: in → low pass → gain → pan → out, with sends to the garden's or the
 *  room's reverberation. */
class Voice {
  constructor(ctx, out, verbs, { gain = 0, lp = 16000, pan = 0, garden = 0, room = 0 } = {}) {
    this.in = gainNode(ctx, 1); this.lp = filterNode(ctx, 'lowpass', clamp(lp, 200, 16000), 0.6);
    this.g = gainNode(ctx, gain); this.pan = ctx.createStereoPanner(); this.pan.pan.value = clamp(pan, -1, 1);
    this.in.connect(this.lp); this.lp.connect(this.g); this.g.connect(this.pan); this.pan.connect(out);
    this.sg = gainNode(ctx, garden); this.sr = gainNode(ctx, room);
    this.pan.connect(this.sg); this.sg.connect(verbs.garden); this.pan.connect(this.sr); this.sr.connect(verbs.room);
  }
  release(ms) { setTimeout(() => { for (const n of [this.in, this.lp, this.g, this.pan, this.sg, this.sr]) { try { n.disconnect(); } catch (e) { /* */ } } }, ms); }
}

export class Soundscape {
  constructor() {
    this.ctx = null; this.world = null; this.acoustics = null; this.layoutRef = null;
    this.layers = {}; this.silentSince = {}; this.applied = {};
    this.next = {}; this.individuals = {}; this.pending = []; this.strikes = [];
    this.log = []; this.levels = {}; this.listener = null; this.rates = null; this.weather = null;
    this.lastLightning = 0; this.lastStrikeAt = -10; this.foliage = 0.5; this.foliageAt = null; this.cricketSpots = null;
    this.rnd = Math.random; this.quietThunderAt = 0;
    this.switches = Object.fromEntries(SOUND_SWITCHES.map((k) => [k, true]));
    this.playing = new Set();   // the voices of the garden and the thunder that sound now: { kind (its switch), v, until }
    this.prepared = new Set();  // the textures asked of the worker
  }
  /** The switches of settings.audio.sounds (the engine passes them on at the start and on every change). What was
   *  switched off falls silent at once. */
  setSwitches(sw) {
    const before = this.switches;
    this.switches = Object.fromEntries(SOUND_SWITCHES.map((k) => [k, sw?.[k] !== false]));
    const off = SOUND_SWITCHES.filter((k) => before[k] && !this.switches[k]);
    if (!this.ctx) return;
    if (off.length) this.#silence(off);
    this.#prepare();
    if (off.length) this.update();
  }
  /** True while sound `name` (one of SOUND_SWITCHES) is switched on. */
  on(name) { return this.switches[name] !== false; }
  /** Fade what plays now of the switched-off sounds (a phrase, a croak, a roll of thunder) at once. */
  #silence(off) {
    const t = this.ctx.currentTime;
    for (const p of [...this.playing]) {
      if (!off.includes(p.kind)) continue;
      try { p.v.g.gain.cancelScheduledValues(t); p.v.g.gain.setTargetAtTime(0, t, 0.05); } catch (e) { /* */ }
      this.playing.delete(p);
    }
    if (off.includes('thunder')) for (const p of this.pending) p.done = true;
  }
  /** The textures of the sounds that are on, made in the sound worker ahead of need (once each). */
  #prepare() {
    const names = [...(this.on('rain') ? ['patter-light', 'patter-heavy', 'pane', 'bubbles'] : []), ...(this.on('wind') ? ['leaves'] : []), ...(this.on('crickets') ? ['cricket-a', 'cricket-b', 'cricket-c'] : [])].filter((n) => !this.prepared.has(n));
    for (const n of names) this.prepared.add(n);
    if (names.length) prepareTextures(this.ctx, names);
  }
  /** Build the buses on a context (the engine calls it once): out → the ambient bus. `short`: a phone or a tablet, where
   *  the garden and the rooms share one short reverb (one convolution instead of two of 1.7 and 1.1 s). */
  start(ctx, dest, { short = false } = {}) {
    this.ctx = ctx;
    this.#prepare();   // rain, leaves, crickets (as far as they are on): made in the sound worker while you look round
    this.out = gainNode(ctx, 1); this.out.connect(dest);
    // the garden's air (sparse, long) and the rooms (denser, shorter): distant sounds carry more of them
    this.verbs = { garden: gainNode(ctx, 1), room: gainNode(ctx, 1) };
    if (short) {
      // (the garden's air between the two: 1.3 s of response, faded out after 0.9)
      const shared = ctx.createConvolver(); shared.buffer = impulseResponse(ctx, { seconds: 1.3, decay: 3.6, tone: 0.36, length: 0.9 });
      const sOut = gainNode(ctx, 0.48);
      this.verbs.garden.connect(shared); this.verbs.room.connect(shared); shared.connect(sOut); sOut.connect(this.out);
      return this;
    }
    const garden = ctx.createConvolver(); garden.buffer = impulseResponse(ctx, { seconds: 1.7, decay: 2.8, tone: 0.32 });
    const room = ctx.createConvolver(); room.buffer = impulseResponse(ctx, { seconds: 1.1, decay: 4.6, tone: 0.42 });
    const gOut = gainNode(ctx, 0.5), rOut = gainNode(ctx, 0.45);
    this.verbs.garden.connect(garden); garden.connect(gOut); gOut.connect(this.out);
    this.verbs.room.connect(room); room.connect(rOut); rOut.connect(this.out);
    return this;
  }
  /** The world to follow (main.js). */
  attach(world) {
    this.world = world; this.acoustics = null; this.layoutRef = null;
    // no world, no sound of it
    if (!world) { for (const l of Object.values(this.layers)) l.stop(); this.layers = {}; this.silentSince = {}; this.applied = {}; }
  }

  // ------------------------------------------------------------------------------------------------ reading the world
  #ac() {
    const L = this.world?.layout;
    if (!this.acoustics || this.layoutRef !== L) { this.acoustics = new Acoustics(L || {}); this.layoutRef = L; }
    return this.acoustics;
  }
  /** The listener: { x, y, z, yaw } (the camera), or null before the world is built. */
  #listenerPos() {
    const w = this.world; if (!w?.camera) return null;
    const p = w.camera.position;
    return { x: p.x, y: p.y, z: p.z, yaw: w.player?.yaw ?? 0 };
  }
  #season() {
    const s = this.world?.settings?.season;
    const season = seasonOf(s);
    return { season, month: ['spring', 'summer', 'autumn', 'winter'].includes(s) ? null : new Date().getMonth() };
  }
  #frozen() {
    const u = this.world?.env?.garden?.water?.uniforms?.uFrozen;
    // (in winter the lake is frozen over whatever the weather: world/winter.js)
    return (u ? u.value > 0.5 : this.weather?.snowing) || !!this.world?.winter?.frozenLake;
  }
  /** True while the world is drawn (a lightning flash can be seen): not behind the full-screen reader, not stopped. */
  #worldVisible() { const w = this.world; return !!w && w.running !== false && w.background !== 'paused'; }

  // ------------------------------------------------------------------------------------------------ the update
  /** Called by the engine's ticker (every 120 ms) and by the checks. */
  update() {
    const ctx = this.ctx; if (!ctx || !this.world) return;
    const t = ctx.currentTime, L = this.#listenerPos(); if (!L) return;
    const ac = this.#ac(), door = this.world.door;
    const W = this.weather = weatherOf(this.world);
    const listen = this.listener = { ...ac.listen(L, door, L.yaw), x: L.x, y: L.y, z: L.z, yaw: L.yaw };
    const { season, month } = this.#season();
    const hour = this.world.currentHour?.() ?? 12;
    const frozen = this.#frozen();
    this.rates = gardenRates({ hour, season, month, rain: W.rain, wind: W.wind, fog: W.fog, snowing: W.snowing, frozen, thunder: W.thunder });
    this.conditions = { hour, season, month, frozen, snowCover: NATURE.uSnow.value, wet: NATURE.uWet.value };
    const lv = this.levels;

    // ---- rain
    const nearWater = listen.inside || frozen ? 0 : clamp(1 - (this.#shoreDistance(L.x, L.z) - 1) / 12, 0, 1);
    const surf = ac.surfaceAt(L.x, L.z, { ground: this.world.player?.ground || 0 });
    lv.rain = W.rain; lv.rainField = W.rain > 0 ? listen.outdoor : 0; lv.rainLp = listen.lp;
    lv.pane = W.rain * listen.glass * (listen.inside ? 1 : 0); lv.roof = listen.inside ? W.rain : 0; lv.rainWater = W.rain * nearWater;
    const sw = this.switches;
    this.#layer('rain', () => new RainSound(ctx, this.out), sw.rain && W.rain > 0.01, (layer) => layer.set({ level: W.rain, outdoor: listen.outdoor, lp: listen.lp, pan: listen.inside ? listen.glassPan : 0, glass: listen.inside ? listen.glass : 0, glassPan: listen.glassPan, roof: listen.inside ? 1 : 0, water: nearWater, boards: !listen.inside && (surf.surface === 'deck' || surf.surface === 'jetty') ? 1 : 0, glassRoof: listen.glassRoof }, t), null, !sw.rain);

    // ---- wind and the leaves
    if (!this.foliageAt || Math.hypot(L.x - this.foliageAt[0], L.z - this.foliageAt[1]) > 2) { this.foliage = this.#foliageAt(L.x, L.z); this.foliageAt = [L.x, L.z]; }
    const wind = W.wind;
    lv.wind = wind; lv.foliage = this.foliage;
    // (indoors behind closed glass the leaves are not heard and a breeze not either: only a strong wind)
    const windOn = wind > 0.08 && (!listen.inside || listen.door > 0.05 || wind > 0.55);
    this.#layer('wind', () => new WindSound(ctx, this.out), sw.wind && windOn, (layer) => layer.set({ wind, outdoor: listen.outdoor, lp: listen.lp, foliage: this.foliage, inside: listen.inside ? 1 : 0, glass: listen.glass, glassPan: listen.glassPan }, t), null, !sw.wind);

    // ---- the fireplace: positional, only while it burns
    const fire = this.world.fire;
    const fireOn = sw.fire && !!fire && (fire.intensity ?? 1) > 0.05 && !!fire.group;
    if (fireOn) {
      const fp = fire.group.position, zone = ac.zoneAt(fp.x, fp.z);
      const h = ac.fromInside({ x: fp.x, y: fp.y + 0.3, z: fp.z }, zone, L, door, L.yaw, 1.6);
      lv.fire = h.gain * 0.9;
      this.#layer('fire', () => new FireSound(ctx, this.out), lv.fire > 0.01, (layer) => layer.set({ gain: lv.fire, lp: h.lp, pan: h.pan, intensity: (fire.intensity ?? 1) * 0.7 }, t), { room: 0.25 });
    } else { lv.fire = 0; this.#layer('fire', null, false, null, null, !sw.fire); }

    // ---- the fire bowl in the garden (a module of its own; see the header)
    const bowl = this.world.fireBowl;
    let bowlOn = false;
    try { bowlOn = sw.firebowl && !!bowl?.position && !!bowl.isBurning?.(); } catch (e) { bowlOn = false; }
    if (bowlOn) {
      const bp = bowl.position, h = ac.fromOutside({ x: bp.x, y: (bp.y ?? 0) + 0.5, z: bp.z }, L, door, L.yaw, 1.8);
      lv.fireBowl = h.gain * 0.85;
      this.#layer('fireBowl', () => new FireSound(ctx, this.out, { open: true }), lv.fireBowl > 0.01, (layer) => layer.set({ gain: lv.fireBowl, lp: Math.min(h.lp, airLp(Math.hypot(bp.x - L.x, bp.z - L.z))), pan: h.pan, intensity: 0.6 }, t));
    } else { lv.fireBowl = 0; this.#layer('fireBowl', null, false, null, null, !sw.firebowl); }

    // ---- the clock: a soft tick close to it
    const clock = this.world.wallClock;
    if (clock && sw.clock) {
      const cp = clock.getWorldPosition ? clock.getWorldPosition(this._v || (this._v = clock.position.clone())) : clock.position;
      const zone = ac.zoneAt(cp.x, cp.z);
      const h = ac.fromInside({ x: cp.x, y: cp.y, z: cp.z }, zone, L, door, L.yaw, 0.8);
      lv.clock = Math.pow(h.gain, 1.5) * 0.8;
      this.#layer('clock', () => new ClockSound(ctx, this.out), lv.clock > 0.01, (layer) => layer.set({ gain: lv.clock, lp: h.lp, pan: h.pan }, t));
    } else { lv.clock = 0; this.#layer('clock', null, false, null, null, !sw.clock); }

    // ---- footsteps on the ground you stand on: a few made ahead in idle time (steps.js)
    if (sw.steps) {
      const step = this.stepInfo();
      warmSteps(ctx.sampleRate, step); warmSteps(ctx.sampleRate, { ...step, run: true });
      // and the grounds you may step onto next (the rooms' floors and rugs; outside the deck, the path, the lawn, the trails)
      for (const surface of step.outdoor ? (step.surface === 'snow' || step.surface === 'ice' ? (this.world.winter?.frozenLake ? ['snow', 'ice'] : []) : ['deck', 'gravel', 'grass', 'earth']) : ['wood', 'carpet']) warmSteps(ctx.sampleRate, { ...step, surface });
    }
    // (the voices that have ended leave the list of what plays)
    for (const p of this.playing) if (p.until < t) this.playing.delete(p);

    // ---- crickets in the meadow and the lawn
    this.#crickets(L, listen, door, t);

    // ---- thunder after lightning
    this.#thunder(t, W, listen);

    // ---- the garden's voices
    this.#garden(t, L, listen, door);
  }

  /** Start, update or stop a layer: on while `want`, stopped after OFF_AFTER s of silence (`quick`: switched off by
   *  hand, stopped right after its fade). */
  #layer(name, make, want, apply, sends, quick = false) {
    let layer = this.layers[name];
    const t = this.ctx.currentTime;
    if (want && !layer && make) {
      layer = this.layers[name] = make();
      layer.start(t);
      if (sends && layer.pan) { for (const [k, v] of Object.entries(sends)) { const s = gainNode(this.ctx, v); layer.pan.connect(s); s.connect(this.verbs[k === 'room' ? 'room' : 'garden']); layer.keep?.(s); } }
    }
    if (!layer) { this.applied[name] = null; return; }
    if (want) { this.silentSince[name] = null; this.applied[name] = apply?.(layer) || null; return; }
    this.applied[name] = null;
    // fade out, then stop
    if (layer.set) layer.set(name === 'rain' ? { level: 0, outdoor: 0 } : name === 'wind' ? { wind: 0, outdoor: 0, foliage: 0 } : { gain: 0 }, t);
    if (this.silentSince[name] == null) this.silentSince[name] = t;
    else if (t - this.silentSince[name] > (quick ? QUIET_AFTER : OFF_AFTER)) { layer.stop(t); delete this.layers[name]; this.silentSince[name] = null; }
  }
  scheduleUntil(t) { for (const l of Object.values(this.layers)) l.scheduleUntil?.(t); }

  /** How many leafy trees stand around (x, z): 0 … 1 (bare trees in winter rustle little, conifers a bit). */
  #foliageAt(x, z) {
    const bare = NATURE.uWinter.value > 0.5;
    let s = 0;
    for (const t of TREES) {
      const d = Math.hypot(t.x - x, t.z - z); if (d > 30) continue;
      const leafy = t.sp === 'spruce' || t.sp === 'pine' ? 0.6 : bare ? 0.25 : 1;
      s += Math.exp(-d / 8) * leafy * (t.sp === 'bush' ? 0.5 : t.scale || 1);
    }
    return 1 - Math.exp(-s / 1.5);
  }
  /** Distance from (x, z) to the open water (0 on the jetty). */
  #shoreDistance(x, z) {
    if (onJetty(x, z)) return 0;
    const [sx, sz] = shorePoint(lakeAngle(x, z), 0);
    return lakeDist(x, z) < 1 ? 0 : Math.hypot(x - sx, z - sz);
  }

  // ------------------------------------------------------------------------------------------------ crickets
  #crickets(L, listen, door, t) {
    const level = this.switches.crickets ? this.rates?.crickets || 0 : 0;
    this.levels.crickets = level;
    // their places: the meadow, the edge of the lawn and the knoll
    this.cricketSpots ||= [[12, 20, 'cricket-a'], [20, 28, 'cricket-b'], [6.5, 34, 'cricket-c'], [-8, 18, 'cricket-b'], [16, 40, 'cricket-a'], [-13, 27, 'cricket-c'], [3, 46, 'cricket-a'], [22, 14, 'cricket-c']];
    const heard = this.cricketSpots.map(([x, z]) => {
      const S = { x, y: terrainHeight(x, z) + 0.1, z };
      const h = level > 0.01 ? this.#acOutside(S, L, door, 2.5) : { gain: 0 };
      return { h, g: level * h.gain * 0.6 };
    });
    // the four nearest sing for all of them (the others would only be a faint carpet behind)
    const loudest = heard.map((c) => c.g).sort((a, b) => b - a)[Math.min(3, heard.length - 1)] || 0;
    heard.forEach(({ h, g }, i) => {
      const on = g > 0.004 && g >= loudest;
      this.levels['cricket' + i] = on ? g : 0;
      this.#layer('cricket' + i, () => new CricketSound(this.ctx, this.out, this.cricketSpots[i][2]), on, (layer) => layer.set({ gain: g, lp: h.lp, pan: h.pan }, t), { garden: 0.2 }, !this.switches.crickets);
    });
  }
  /** fromOutside with the air's absorption over distance. */
  #acOutside(S, L, door, ref) {
    const h = this.#ac().fromOutside(S, L, door, L.yaw, ref);
    const d = Math.hypot(S.x - L.x, S.z - L.z);
    return { ...h, lp: Math.min(h.lp, airLp(d)) * (h.behind ? 0.6 : 1), d };
  }

  // ------------------------------------------------------------------------------------------------ thunder
  #thunder(t, W, listen) {
    const env = this.world.env, lightning = env?.lightning || 0;
    // a strike: the flash jumps up (rising edge; one strike may flicker); with the thunder switched off none is planned
    if (this.switches.thunder && lightning > this.lastLightning + 0.3 && t - this.lastStrikeAt > 1.2) {
      const ago = Math.max(0, (1 - lightning) / 3);          // the flash fades by 3 a second (environment.js)
      this.strike(t - ago);
    }
    this.lastLightning = lightning;
    // while the world is not drawn (the full-screen reader) no flash is seen: now and then a distant rumble only
    if (this.switches.thunder && W.thunder && !this.#worldVisible() && t > this.quietThunderAt) {
      if (this.quietThunderAt) this.strike(t, { distance: 3500 + this.rnd() * 4500, unseen: true });
      this.quietThunderAt = t + 20 + this.rnd() * 30;
    }
    if (!W.thunder && !lightning) this.quietThunderAt = 0;
    // play what is due
    for (const p of this.pending) {
      if (p.done || p.at > t + HORIZON) continue;
      p.done = true;
      const g = listen.inside ? clamp(0.35 + listen.outdoor * 1.3, 0, 1) : 1;
      const lp = listen.inside ? clamp(listen.lp * 0.45, 250, 900) : 16000;
      const v = new Voice(this.ctx, this.out, this.verbs, { gain: g, lp, garden: listen.inside ? 0 : 0.35, room: listen.inside ? 0.3 : 0 });
      const dur = thunder(this.ctx, v.in, Math.max(p.at, t), { distance: p.distance, gain: 0.9 });
      v.release((Math.max(p.at, t) - t + dur + 3) * 1000);
      this.playing.add({ kind: 'thunder', v, until: Math.max(p.at, t) + dur });
      p.gain = g; this.#note({ type: 'thunder', at: p.at, distance: p.distance, gain: +g.toFixed(3) });
    }
    this.pending = this.pending.filter((p) => !p.done || p.at > t - 30);
  }
  /**
   * A lightning strike at context time `at`: its thunder comes after distance / 343 s. Distance: random, most strikes
   * one to five kilometres away, now and then a near one. Returns the planned thunder { at, distance, delay }.
   */
  strike(at = this.ctx?.currentTime ?? 0, { distance, unseen = false } = {}) {
    const d = distance ?? 400 + 5600 * Math.pow(this.rnd(), 1.6);
    const delay = d / SOUND_SPEED;
    const p = { strikeAt: at, distance: Math.round(d), delay: +delay.toFixed(3), at: at + delay, unseen, done: false };
    this.lastStrikeAt = at; this.pending.push(p); this.strikes.push(p);
    if (this.strikes.length > 50) this.strikes.shift();
    return p;
  }

  // ------------------------------------------------------------------------------------------------ the garden
  #garden(t, L, listen, door) {
    const R = this.rates, until = t + (typeof document !== 'undefined' && document.hidden ? 8 : HORIZON);
    const kinds = { song: R.song, owl: R.owl, frog: R.frogs, treefrog: R.treefrogs, duck: R.ducks, moorhen: R.moorhens, lap: this.#lapRate(L, listen) };
    for (const [kind, rate] of Object.entries(kinds)) {
      if (!(rate > 0.001) || !this.switches[SWITCH_OF[kind]]) { this.next[kind] = null; continue; }
      // (new, missed while nothing updated, or planned at a much lower rate: from now on)
      if (this.next[kind] == null || this.next[kind] < t - 1 || this.next[kind] - t > 3 * 60 / rate) this.next[kind] = t + this.#wait(rate) * 0.5;
      let guard = 0;
      while (this.next[kind] < until && guard++ < 20) {
        const at = Math.max(this.next[kind], t);
        this.#event(kind, at, L, listen, door);
        this.next[kind] += this.#wait(rate);
        if (kind === 'owl') this.next[kind] = Math.max(this.next[kind], at + 25);
      }
    }
  }
  /** Seconds to the next event at `rate` events a minute (random, like rain drops). */
  #wait(rate) { return -Math.log(1 - this.rnd()) * 60 / rate; }
  #lapRate(L, listen) {
    if (listen.inside || this.conditions?.frozen) return 0;
    const d = this.#shoreDistance(L.x, L.z);
    return d > 22 ? 0 : (20 + 50 * (this.weather?.wind || 0)) * (1 - d / 22);
  }
  /** Where an outdoor voice is heard from: you outside, else just outside the glass or window nearest to you. */
  #refPoint(L, listen) {
    if (!listen.inside) return [L.x, L.z];
    const ac = this.#ac();
    let best = null;
    for (const g of ac.glass) {
      const d = Math.hypot(g.x - L.x, g.z - L.z) + (g.zone === listen.zone ? 0 : 15);
      if (!best || d < best.d) best = { d, x: g.x + g.nx * 6, z: g.z + g.nz * 6 };
    }
    return best ? [best.x, best.z] : [0, 12];
  }
  /** A tree between `near` and `far` metres from (x, z) (a bush for the small birds now and then): { x, y, z }. */
  #perch(x, z, near, far, { bush = false } = {}) {
    for (let i = 0; i < 40; i++) {
      const tr = TREES[Math.floor(this.rnd() * TREES.length)];
      const d = Math.hypot(tr.x - x, tr.z - z);
      if (d < near || d > far || (tr.sp === 'bush') !== (bush && this.rnd() < 0.7)) continue;
      const top = tr.sp === 'bush' ? 1.2 + this.rnd() : 3 + this.rnd() * 6 * (tr.scale || 1);
      return { x: tr.x, y: terrainHeight(tr.x, tr.z) + top, z: tr.z };
    }
    const a = this.rnd() * Math.PI * 2, d = near + this.rnd() * (far - near);
    return { x: x + Math.cos(a) * d, y: 5, z: z + Math.sin(a) * d };
  }
  /** A point on the lake (the water birds) or at its shore (the frogs, the lapping). */
  #onWater(shore = false) {
    const a = this.rnd() * Math.PI * 2;
    if (shore) { const [x, z] = shorePoint(a, 0.05); return { x, y: WATER_Y + 0.05, z }; }
    const u = 0.25 + this.rnd() * 0.55;
    return { x: LAKE.x + Math.cos(a) * LAKE.rx * u, y: WATER_Y + 0.1, z: LAKE.z + Math.sin(a) * LAKE.rz * u };
  }
  #pickSpecies() {
    const R = this.rates, mix = { ...(MIX[this.conditions.season] || MIX.spring) };
    const m = this.conditions.month;
    if (m != null) { if (m < 3 || m > 8) delete mix.chiffchaff; if (m < 3 || m > 5) delete mix.cuckoo; }
    else if (this.conditions.season !== 'spring' && this.conditions.season !== 'summer') delete mix.cuckoo;
    const boost = R.song > 0 ? (R.chorus * 26) / R.song : 0, eve = R.song > 0 ? (R.evening * 9) / R.song : 0;
    let sum = 0; const list = Object.entries(mix).map(([k, w]) => { const v = w * (1 + boost * ((CHORUS[k] || 0.6) - 1)) * (1 + eve * ((EVENING[k] || 0.6) - 1)); sum += Math.max(0, v); return [k, Math.max(0, v)]; });
    let x = this.rnd() * sum;
    for (const [k, v] of list) { x -= v; if (x <= 0) return k; }
    return list[0][0];
  }
  /** An individual of a species near the reference point (up to four of each): it keeps its perch for a while and
   *  never starts a phrase while it still sings the last one. */
  #individual(species, ref, at) {
    const list = this.individuals[species] ||= [];
    const free = list.filter((b) => !(b.busyUntil > at));
    let ind = free.length && (list.length >= 4 || this.rnd() < 0.75) ? free[Math.floor(this.rnd() * free.length)] : null;
    const [near, far] = REACH[species] || [8, 45];
    const chorusFar = this.rates?.chorus > 0.3 ? 1.5 : 1;
    if (!ind && list.length >= 4) return null;   // all of them are singing
    if (!ind || Math.hypot(ind.pos.x - ref[0], ind.pos.z - ref[1]) > far * chorusFar * 1.3 || this.rnd() < 0.15) {
      const pos = this.#perch(ref[0], ref[1], near, far * chorusFar, { bush: species === 'sparrow' || species === 'wren' || species === 'robin' });
      if (!ind) { ind = { seed: 1 + Math.floor(this.rnd() * 1e6), pos, busyUntil: 0 }; list.push(ind); }
      else ind.pos = pos;
    }
    ind.busyUntil = at + (PHRASE[species] || 2.5) * (0.8 + this.rnd() * 0.4) + 0.6;
    return ind;
  }
  /** The frogs of the lake: a dozen of them at their places along the shore, each with its own voice. One near you
   *  calls more often than one across the water; a frog does not start a bout during its last one. */
  #frog(L, at, tree = false) {
    const key = tree ? 'treefrogs' : 'frogs';
    if (!this[key]) {
      const r = rng(tree ? 91 : 77), n = tree ? 5 : 12;
      this[key] = Array.from({ length: n }, (_, i) => {
        const [x, z] = shorePoint((i + r() * 0.8) / n * Math.PI * 2, tree ? 0.4 : 0.03);
        return { x, z, seed: 3 + Math.floor(r() * 1000), busyUntil: 0 };
      });
    }
    let sum = 0;
    const w = this[key].map((f) => { const v = f.busyUntil > at ? 0 : 1 / (1 + Math.hypot(f.x - L.x, f.z - L.z) / 15); sum += v; return v; });
    if (!(sum > 0)) return null;
    let x = this.rnd() * sum;
    for (let i = 0; i < w.length; i++) { x -= w[i]; if (x <= 0) { this[key][i].busyUntil = at + (tree ? 4 : 3.2); return this[key][i]; } }
    return null;
  }
  #event(kind, at, L, listen, door) {
    const ctx = this.ctx, ref = this.#refPoint(L, listen);
    let pos, ref0 = 3, play, species = null, garden = 0.25;
    if (kind === 'song') {
      species = this.#pickSpecies();
      const ind = this.#individual(species, ref, at);
      if (!ind) return;
      pos = ind.pos; ref0 = (REACH[species] || [])[2] || 4;
      play = (dest) => birdPhrase(ctx, dest, at, { species, seed: ind.seed, rnd: this.rnd });
    } else if (kind === 'owl') {
      pos = this.#perch(ref[0], ref[1], 25, 80); ref0 = 8; garden = 0.4;
      play = (dest) => owlCall(ctx, dest, at, { rnd: this.rnd, female: this.rnd() < 0.25, seed: 7 });
    } else if (kind === 'frog' || kind === 'treefrog') {
      const frog = this.#frog(L, at, kind === 'treefrog');
      if (!frog) return;
      pos = { x: frog.x, y: WATER_Y + 0.05, z: frog.z }; ref0 = kind === 'frog' ? 3 : 2.5; garden = 0.3;
      play = (dest) => (kind === 'frog' ? frogBout : treeFrog)(ctx, dest, at, { rnd: this.rnd, seed: frog.seed });
    } else if (kind === 'duck' || kind === 'moorhen') {
      pos = this.#onWater(false); ref0 = kind === 'duck' ? 4 : 5; garden = 0.35;
      play = (dest) => (kind === 'duck' ? duckCall : moorhenCall)(ctx, dest, at, { rnd: this.rnd, seed: 9 });
    } else if (kind === 'lap') {
      const onBoards = onJetty(L.x, L.z);
      if (onBoards) pos = { x: L.x + (this.rnd() - 0.5) * 2, y: WATER_Y, z: L.z + (this.rnd() - 0.5) * 2 };
      else { const [sx, sz] = shorePoint(lakeAngle(L.x, L.z) + (this.rnd() - 0.5) * 0.25, 0); pos = { x: sx, y: WATER_Y, z: sz }; }
      ref0 = 1.5; garden = 0.1;
      play = (dest) => waterLap(ctx, dest, at, { rnd: this.rnd, hollow: onBoards, gain: 0.8 + 0.7 * (this.weather?.wind || 0) });
    } else return;
    const h = this.#acOutside(pos, L, door, ref0);
    const gain = h.gain;
    const entry = { type: kind, species, at: +at.toFixed(2), x: +pos.x.toFixed(1), z: +pos.z.toFixed(1), d: +h.d.toFixed(1), gain: +gain.toFixed(4), lp: Math.round(h.lp), muted: gain < 0.003 };
    this.#note(entry);
    if (entry.muted || this.dry) return;
    // far voices carry more of the garden's air; heard inside, the room's
    const send = clamp(0.06 + h.d / 70, 0.06, 0.55) * (garden / 0.25);
    const v = new Voice(ctx, this.out, this.verbs, { gain, lp: h.lp, pan: h.pan, garden: listen.inside ? 0 : send, room: listen.inside ? 0.2 : 0 });
    const dur = play(v.in);
    v.release((at - ctx.currentTime + dur + 3) * 1000);
    this.playing.add({ kind: SWITCH_OF[kind], v, until: at + dur });
  }
  #note(e) { this.log.push(e); if (this.log.length > 300) this.log.shift(); }

  // ------------------------------------------------------------------------------------------------ footsteps
  /** The ground under the feet now: { surface, outdoor, wet }. */
  stepInfo() {
    const w = this.world; if (!w?.player) return { surface: 'wood', outdoor: false, wet: 0 };
    const p = w.player.position;
    const snow = NATURE.uSnow.value > 0.35;
    const floorY = w.player.groundAt?.(p.x, p.z) || 0;
    const s = this.#ac().surfaceAt(p.x, p.z, { ground: w.player.ground || 0, floorY, snow, floor: floorSurface(w) });
    const wet = s.outdoor && !snow ? clamp(NATURE.uWet.value, 0, 1) * (weatherOf(w).rain > 0 ? 1 : 0.6) : 0;
    return { ...s, wet };
  }

  // ------------------------------------------------------------------------------------------------ for the checks
  /** Everything the soundscape decided last: listener, weather, rates, levels, recent events and strikes. */
  get state() {
    const r3 = (v) => (typeof v === 'number' ? +v.toFixed(4) : v);
    return {
      listener: this.listener ? Object.fromEntries(Object.entries(this.listener).map(([k, v]) => [k, r3(v)])) : null,
      weather: this.weather, conditions: this.conditions,
      rates: this.rates ? Object.fromEntries(Object.entries(this.rates).map(([k, v]) => [k, r3(v)])) : null,
      levels: Object.fromEntries(Object.entries(this.levels).map(([k, v]) => [k, r3(v)])),
      layers: Object.keys(this.layers),
      applied: JSON.parse(JSON.stringify(this.applied)),
      events: this.log.slice(-60), strikes: this.strikes.slice(-10).map((s) => ({ ...s })),
      worker: { ...offthreadStats }, switches: { ...this.switches }, playing: [...this.playing].map((p) => p.kind),
    };
  }
  /** Count the garden's events over `seconds` of simulated time at the current listener and conditions, without
   *  sound: { song, owl, frog, … , species: { blackbird: n, … }, gain: { song: mean gain heard, … } }. */
  simulate(seconds = 600, step = 0.25) {
    if (!this.ctx || !this.world) return null;
    const keepLog = this.log, keepNext = this.next, keepDry = this.dry;
    // the singers keep their places, but what they sang in the simulated minutes must not keep them busy now
    const keepVoices = JSON.stringify({ i: this.individuals, f: this.frogs || null, t: this.treefrogs || null });
    this.log = []; this.next = {}; this.dry = true;
    const counts = {}, species = {}, gains = {};
    try {
      const L = this.#listenerPos(), door = this.world.door, listen = this.listener || this.#ac().listen(L, door, L.yaw);
      const t0 = this.ctx.currentTime;
      for (let s = 0; s < seconds; s += step) {
        const before = this.log.length;
        const R = this.rates, until = t0 + s + step;
        const kinds = { song: R.song, owl: R.owl, frog: R.frogs, treefrog: R.treefrogs, duck: R.ducks, moorhen: R.moorhens, lap: this.#lapRate(L, listen) };
        for (const [kind, rate] of Object.entries(kinds)) {
          if (!(rate > 0.001) || !this.switches[SWITCH_OF[kind]]) { this.next[kind] = null; continue; }
          if (this.next[kind] == null) this.next[kind] = t0 + s + this.#wait(rate) * 0.5;
          while (this.next[kind] < until) { const at = this.next[kind]; this.#event(kind, at, L, listen, door); this.next[kind] += this.#wait(rate); if (kind === 'owl') this.next[kind] = Math.max(this.next[kind], at + 25); }
        }
        for (const e of this.log.slice(before)) { counts[e.type] = (counts[e.type] || 0) + 1; gains[e.type] = (gains[e.type] || 0) + e.gain; if (e.species) species[e.species] = (species[e.species] || 0) + 1; }
        if (this.log.length > 1000) this.log = [];
      }
    } finally {
      this.log = keepLog; this.next = keepNext; this.dry = keepDry;
      const v = JSON.parse(keepVoices); this.individuals = v.i; this.frogs = v.f; this.treefrogs = v.t;
    }
    for (const k of Object.keys(gains)) gains[k] = +(gains[k] / counts[k]).toFixed(4);
    return { ...counts, species, gain: gains };
  }
  /** A seeded random source for reproducible checks (null: Math.random again). */
  seed(n) { this.rnd = n == null ? Math.random : rng(n); }
}
