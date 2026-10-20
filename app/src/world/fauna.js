// The small animals of the garden: the birds (birds.js), the koi in the lake (koi.js) and the frogs at its shore
// (frogs.js). One switch in the settings ("Vögel und Tiere am See", settings.fauna) turns them all off. This module
// reads what they all need (the season, the height of the sun, the weather, where the player is), builds their
// meshes once, warms their shader programs up with the rest of the world and hands each frame to them.
import * as THREE from 'three';
import { Birds } from './birds.js';
import { Koi } from './koi.js';
import { Frogs } from './frogs.js';
import { creaturePrewarm } from './bird-models.js';
import { inHouse } from './bird-places.js';
import { depthAt } from './pond.js';
import { lakeDist } from './outdoor.js';
import { NATURE } from './nature.js';
import { sunPosition } from './environment.js';
import { seasonOf } from './season.js';
import { FACADE_Z } from './layout.js';

export class Fauna {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group(); this.group.name = 'fauna';
    world.scene.add(this.group);
    // the creatures' program and vertex layout are drawn in the first frames (Direct3D builds them on the first draw)
    this.prewarm = creaturePrewarm(); this.group.add(this.prewarm);
    this.birds = new Birds(this); this.group.add(this.birds.group);
    this.koi = new Koi(this); this.group.add(this.koi.group);
    this.frogs = new Frogs(this); this.group.add(this.frogs.group);
    this.enabled = true;
    this.hourOverride = null; this.weatherOverride = null; this.seasonOverride = null;
    this.jumped = false; this.lastKey = '';
    this.times = { birds: 0, koi: 0, frogs: 0 };
    this.ready = false; this.pond = false;
  }

  setEnabled(on) {
    on = !!on;
    if (on === this.enabled) return;
    this.enabled = on;
    this.group.visible = on;
    if (!on) { this.birds.clear(); this.koi.clear(); this.frogs.clear(); }
  }
  dispose() { this.birds.dispose(); this.koi.dispose(); this.frogs.dispose(); this.world.scene.remove(this.group); }

  // ---------------------------------------------------------------- what the animals need to know -------------------
  /** The season now (settings.season, 'auto' = the calendar; tests override it). */
  seasonNow() { return this.seasonOverride || seasonOf(this.world.settings?.season); }
  /** The height of the sun (sine of its elevation; below 0 at night) at the hour the world shows. */
  sunHeight() { return sunPosition(this.hourOverride ?? this.world.currentHour?.() ?? 12).y; }
  /** The weather: 'clear', 'overcast', 'rain', 'storm', 'snow' or 'fog' (a combined weather of a later version is read
   *  through world.weatherState() when it exists). */
  weatherNow() {
    if (this.weatherOverride) return this.weatherOverride;
    const ws = this.world.weatherState?.();
    // (the thunder part eases out over minutes after a storm: only a storm that is still one counts, as nameOfMix)
    if (ws) return ws.thunder > 0.5 ? 'storm' : ws.base === 'rain' && ws.rain > 0.8 ? 'storm' : ws.base || 'clear';
    return this.world.settings?.weather || 'clear';
  }
  /** Rain or a storm. */
  wet() { const w = this.weatherNow(); return w === 'rain' || w === 'storm'; }
  /** The player is out in the garden (behind the glass the animals take no notice of him). */
  playerOutside() { return this.world.player.position.z > FACADE_Z - 0.05; }
  /** Something splashed into the lake at (x, z): a ring on the water, and (unless it was only a small one, a koi at the
   *  surface or a swallow drinking) the koi nearby dart off. */
  splash(x, z, size = 1, small = false) { this.frogs.ring(x, z, size, small); if (!small) this.koi.scare(x, z, size); }

  // ---------------------------------------------------------------- every frame -------------------------------------
  update(dt, posed = true) {
    if (!this.enabled) return;
    // another render path (the graphics quality draws without the composer on 'low'): draw the warm-up again
    const path = !!(this.world.bloom?.enabled || this.world.ao?.enabled);
    if (path !== this.renderPath) { this.renderPath = path; this.prewarm.userData.frames = 0; this.prewarm.visible = true; this.koi.prewarmAgain?.(); }
    if (!this.world.env?.garden) return;
    // made once the garden stands, a part a frame (all at once behind the menu)
    if (!this.ready && !this.#prepare(this.world.background === 'dim')) return;
    // the time, the weather or the season changed in the settings: the animals go and come at once
    const key = `${this.world.settings?.timeMode}|${this.world.settings?.fixedHour}|${this.weatherNow()}|${this.seasonNow()}`;
    this.jumped = key !== this.lastKey && this.lastKey !== '';
    this.lastKey = key;
    dt = Math.min(dt, 0.1);
    let t = performance.now();
    this.birds.update(dt, posed);
    const t1 = performance.now();
    this.koi.update(dt, posed);
    const t2 = performance.now();
    this.frogs.update(dt, posed);
    const t3 = performance.now();
    // the CPU time of each (a running average, for the checks)
    const k = 0.05;
    this.times.birds += ((t1 - t) - this.times.birds) * k; this.times.koi += ((t2 - t1) - this.times.koi) * k; this.times.frogs += ((t3 - t2) - this.times.frogs) * k;
    this.jumped = false;
  }

  /** The catalogue of perches (a part a call), the twigs in the crowns, then the lily pads and the shore spots (each in
   *  a call of its own), or all at once (`all`). True when all is there. */
  #prepare(all) {
    if (!this.birds.prepare(all)) return false;
    if (!this.pond) { this.pond = true; this.frogs.prepare(); this.koi.prepare(); if (!all) return false; }
    return (this.ready = true);
  }
  /** Everything built at once (tests). */
  prepareAll() {
    const t = performance.now();
    this.#prepare(true);
    this.update(0.016, false);
    return { ms: Math.round(performance.now() - t), birds: this.birds.info().places, frogs: this.frogs.info().spots, koi: this.koi.info().n };
  }
  /** For the checks: the house as the birds avoid it, and the garden's shared light and wind uniforms. */
  inHouse(x, y, z, m = 0) { return inHouse(x, y, z, m); }
  get nature() { return NATURE; }
  get lake() { return { depthAt, lakeDist }; }
  info() {
    return { enabled: this.enabled, season: this.seasonNow(), sunY: +this.sunHeight().toFixed(3), weather: this.weatherNow(), times: { birds: +this.times.birds.toFixed(3), koi: +this.times.koi.toFixed(3), frogs: +this.times.frogs.toFixed(3) }, birds: this.birds.info(), koi: this.koi.info(), frogs: this.frogs.info() };
  }
}
