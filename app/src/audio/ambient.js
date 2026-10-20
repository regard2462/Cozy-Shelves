// The continuous sounds of the world as layers: rain, wind (with the leaves), the fire (the fireplace, the fire bowl in
// the garden), the clock, crickets, and the thunder after a lightning strike. A layer knows nothing of the world: the
// soundscape (soundscape.js) tells it how loud, how muffled and from which side it is heard where the listener stands
// (set(params, t)), and starts and stops it. Event layers (crackles, ticks, gusts) schedule ahead in scheduleUntil(t),
// driven by the engine's ticker. Everything works in an OfflineAudioContext too (the checks render them).
import { gainNode, filterNode, noiseSource, lfo, percEnv, rampTo, clamp, osc } from './dsp.js';
import { textureSource } from './textures.js';

const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** Follow a target smoothly (seconds: about the time to get there). */
const glide = (param, v, t, seconds) => { if (Number.isFinite(v)) rampTo(param, v, t, seconds); };

class Layer {
  constructor(ctx, dest) { this.ctx = ctx; this.dest = dest; this.on = false; this.nextEvent = 0; this.nodes = []; this.sources = []; }
  start(t) { if (this.on) return; this.on = true; this.nextEvent = Math.max(this.nextEvent, t); this.build(t); }
  /** Stop the sources after a fade (the soundscape fades the gains first). */
  stop(t = this.ctx.currentTime) {
    if (!this.on) return; this.on = false;
    for (const s of this.sources) { try { s.stop(t + 0.1); } catch (e) { /* */ } }
    const nodes = this.nodes; this.sources = []; this.nodes = [];
    setTimeout(() => { for (const n of nodes) { try { n.disconnect(); } catch (e) { /* */ } } }, 600);
  }
  scheduleUntil(t) { if (!this.on || !this.event) return; let guard = 0; while (this.nextEvent < t && guard++ < 2000) this.nextEvent = this.event(this.nextEvent); }
  keep(...nodes) { this.nodes.push(...nodes); return nodes[0]; }
  src(s) { this.sources.push(s); this.nodes.push(s); return s; }
  /** A slow modulation of a parameter (stopped with the layer). */
  mod(param, rate, depth, t) { const m = lfo(this.ctx, param, rate, depth, t); this.src(m.osc); this.keep(m.gain); return m; }
  /**
   * A part of the layer that is only built while it is heard (the drops on a pane near a window, the rings on the lake)
   * and taken down after a few silent seconds: no sound graph runs for what nobody hears. build(part, t) makes its
   * nodes with part.keep / part.src. Returns the part or null.
   */
  part(name, want, build, t) {
    const P = (this.parts ||= {});
    let part = P[name];
    if (want && !part) {
      part = P[name] = { quietSince: null, nodes: [], sources: [] };
      part.keep = (n) => { part.nodes.push(n); this.nodes.push(n); return n; };
      part.src = (s) => { part.sources.push(s); part.keep(s); this.sources.push(s); return s; };
      build(part, t);
    }
    if (!part) return null;
    if (want) part.quietSince = null;
    else if (part.quietSince == null) part.quietSince = t;
    else if (t - part.quietSince > 4) {
      for (const s of part.sources) { try { s.stop(t + 0.1); } catch (e) { /* */ } }
      setTimeout(() => { for (const n of part.nodes) { try { n.disconnect(); } catch (e) { /* */ } } }, 600);
      delete P[name];
      return null;
    }
    return part;
  }
}

// ---------------------------------------------------------------- rain ---------------------------------------------
/**
 * Rain as you hear it where you stand: the patter of countless drops on the ground and the leaves (a light and a heavy
 * texture, crossfaded with the strength), the wash of the far rain, all of it muffled indoors; drops ticking on the
 * pane near a window, a gutter trickling; the drumming on the roof above the rooms; rings on the water near the lake;
 * pattering on a glass roof.
 * set({ level 0 … 1 (0.3 drizzle, 0.6 rain, 1 storm), outdoor (amplitude of the outdoor field), lp (Hz), pan,
 *       glass (0 … 1 close to a pane), glassPan, roof (0 | 1 under a roof), water (0 … 1 near open water),
 *       boards (0 | 1 on the deck or the jetty), glassRoof (0 | 1) }, t)
 */
export class RainSound extends Layer {
  build(t) {
    const ctx = this.ctx;
    const k = (n) => this.keep(n);
    // slow swells of the rain over everything
    this.swell = k(gainNode(ctx, 1)); this.swell.connect(this.dest);
    this.mod(this.swell.gain, 0.07, 0.12, t); this.mod(this.swell.gain, 0.23, 0.05, t + 1);
    this.out = k(gainNode(ctx, 1)); this.out.connect(this.swell);
    // the field: the far wash and the patter
    const roar = this.src(noiseSource(ctx, 'pink', t, { loop: true }));
    const rhp = k(filterNode(ctx, 'highpass', 320, 0.6)), rlp = k(filterNode(ctx, 'lowpass', 7000, 0.5));
    this.roarG = k(gainNode(ctx, 0)); roar.connect(rhp); rhp.connect(rlp); rlp.connect(this.roarG);
    const light = this.src(textureSource(ctx, 'patter-light', t)), heavy = this.src(textureSource(ctx, 'patter-heavy', t));
    this.lightG = k(gainNode(ctx, 0)); this.heavyG = k(gainNode(ctx, 0)); light.connect(this.lightG); heavy.connect(this.heavyG);
    this.mix = k(gainNode(ctx, 1)); this.roarG.connect(this.mix); this.lightG.connect(this.mix); this.heavyG.connect(this.mix);
    this.muffle = k(filterNode(ctx, 'lowpass', 12000, 0.6));
    this.boards = k(filterNode(ctx, 'peaking', 2600, 1.1)); this.boards.gain.value = 0;
    this.fieldG = k(gainNode(ctx, 0)); this.pan = k(ctx.createStereoPanner());
    this.mix.connect(this.muffle); this.muffle.connect(this.boards); this.boards.connect(this.fieldG); this.fieldG.connect(this.pan); this.pan.connect(this.out);
    // the roof over the rooms: the heavy patter, deep and dull
    const roofLp = k(filterNode(ctx, 'lowpass', 420, 0.7)); this.roofG = k(gainNode(ctx, 0));
    heavy.connect(roofLp); roofLp.connect(this.roofG); this.roofG.connect(this.out);
  }
  /** Drops on the window pane and the gutter beside you, pattering on a glass roof overhead: only near glass. */
  #pane(part, t) {
    const ctx = this.ctx, k = part.keep;
    // (the tap of the drop on the glass stays in: only the lowest part is cut, and the sharpest highs are softened)
    const pane = part.src(textureSource(ctx, 'pane', t)), php = k(filterNode(ctx, 'highpass', 600, 0.6)), plp = k(filterNode(ctx, 'lowpass', 6500, 0.6));
    part.paneG = k(gainNode(ctx, 0)); part.glassRoofG = k(gainNode(ctx, 0)); part.pan = k(ctx.createStereoPanner());
    pane.connect(php); php.connect(plp); plp.connect(part.paneG); part.paneG.connect(part.pan); part.pan.connect(this.out);
    plp.connect(part.glassRoofG); part.glassRoofG.connect(this.out);
    const trickle = part.src(noiseSource(ctx, 'white', t, { loop: true })), tbp = k(filterNode(ctx, 'bandpass', 3200, 3));
    part.trickleG = k(gainNode(ctx, 0)); trickle.connect(tbp); tbp.connect(part.trickleG); part.trickleG.connect(part.pan);
    const m = lfo(ctx, tbp.frequency, 1.3, 600, t); part.src(m.osc); k(m.gain);
  }
  /** Rings on the water: only near the lake. */
  #water(part, t) {
    const bub = part.src(textureSource(this.ctx, 'bubbles', t));
    part.g = part.keep(gainNode(this.ctx, 0)); bub.connect(part.g); part.g.connect(this.out);
  }
  set(p, t = this.ctx.currentTime, seconds = 0.4) {
    if (!this.on) return;
    const r = clamp(p.level || 0, 0, 1), heavyMix = smooth(0.3, 0.9, r), patter = 0.6 * Math.pow(r, 0.7);
    glide(this.roarG.gain, (0.04 + 0.35 * r * r) * (r > 0 ? 1 : 0), t, 2);
    glide(this.lightG.gain, patter * (1 - heavyMix), t, 2);
    glide(this.heavyG.gain, patter * heavyMix, t, 2);
    glide(this.fieldG.gain, p.outdoor ?? 1, t, seconds);
    glide(this.muffle.frequency, clamp(p.lp ?? 12000, 200, 16000), t, seconds);
    glide(this.boards.gain, p.boards ? 4 : 0, t, seconds);
    glide(this.pan.pan, clamp(p.pan || 0, -1, 1) * 0.35, t, seconds);
    glide(this.roofG.gain, (p.roof ? 0.12 : 0) * r, t, seconds);
    const glass = clamp(p.glass || 0, 0, 1), glassRoof = p.glassRoof ? 1 : 0, water = clamp(p.water || 0, 0, 1);
    const pane = this.part('pane', r * (glass + glassRoof) > 0.002, (q, at) => this.#pane(q, at), t);
    if (pane) {
      glide(pane.paneG.gain, 0.3 * r * glass, t, seconds);
      glide(pane.trickleG.gain, 0.03 * r * glass, t, seconds);
      glide(pane.pan.pan, clamp(p.glassPan || 0, -1, 1), t, seconds);
      glide(pane.glassRoofG.gain, 0.6 * r * glassRoof, t, seconds);
    }
    const lake = this.part('water', r * water > 0.002, (q, at) => this.#water(q, at), t);
    if (lake) glide(lake.g.gain, 0.55 * r * water, t, seconds);
    // what plays now (the checks read it): the field heard here, the panes, the roof, the water
    return { field: r > 0 ? (p.outdoor ?? 1) * (0.25 + 0.75 * r) : 0, lp: p.lp ?? 12000, pane: 0.3 * r * clamp(p.glass || 0, 0, 1), roof: (p.roof ? 0.12 : 0) * r, glassRoof: 0.6 * r * (p.glassRoof ? 1 : 0), water: 0.55 * r * clamp(p.water || 0, 0, 1) };
  }
}

// ---------------------------------------------------------------- wind ---------------------------------------------
/**
 * Wind: the moving air (a band of noise that wanders, in gusts), the leaves of the trees around you rustling with the
 * same gusts, and in a storm the whistle at the windows indoors.
 * set({ wind 0 … 1 (the plants' sway: 0.3 a breeze, 1 a storm), outdoor, lp, foliage (0 … 1 trees around you),
 *       inside (0 | 1), glass, glassPan }, t)
 */
export class WindSound extends Layer {
  build(t) {
    const ctx = this.ctx, k = (n) => this.keep(n);
    this.out = k(gainNode(ctx, 1)); this.out.connect(this.dest);
    const n = this.src(noiseSource(ctx, 'pink', t, { loop: true }));
    const bp = k(filterNode(ctx, 'bandpass', 430, 0.9)), lp = k(filterNode(ctx, 'lowpass', 1500, 0.5));
    this.mod(bp.frequency, 0.045, 160, t); this.mod(bp.frequency, 0.11, 70, t + 3);
    this.gust = k(gainNode(ctx, 0.8)); this.muffle = k(filterNode(ctx, 'lowpass', 12000, 0.6)); this.bedG = k(gainNode(ctx, 0));
    n.connect(bp); bp.connect(lp); lp.connect(this.gust); this.gust.connect(this.muffle); this.muffle.connect(this.bedG); this.bedG.connect(this.out);
    this.wind = 0; this.gustLevel = 0.8;
  }
  /** The leaves of the trees round you (only while they can be heard: outdoors, or through the open door). */
  #leaves(part, t) {
    const ctx = this.ctx, k = part.keep, leaves = part.src(textureSource(ctx, 'leaves', t, { rate: 1 }));
    part.gust = k(gainNode(ctx, Math.pow(this.gustLevel, 1.2))); part.muffle = k(filterNode(ctx, 'lowpass', 12000, 0.6)); part.g = k(gainNode(ctx, 0));
    leaves.connect(part.gust); part.gust.connect(part.muffle); part.muffle.connect(part.g); part.g.connect(this.out);
  }
  /** The whistle in the frames of the windows (a storm, indoors near the glass). */
  #whistle(part, t) {
    const ctx = this.ctx, k = part.keep;
    const w = part.src(noiseSource(ctx, 'white', t, { loop: true })), wbp = k(filterNode(ctx, 'bandpass', 1150, 13));
    const m = lfo(ctx, wbp.frequency, 0.08, 300, t); part.src(m.osc); k(m.gain);
    part.g = k(gainNode(ctx, 0)); part.pan = k(ctx.createStereoPanner());
    w.connect(wbp); wbp.connect(part.g); part.g.connect(part.pan); part.pan.connect(this.out);
  }
  set(p, t = this.ctx.currentTime, seconds = 0.4) {
    if (!this.on) return;
    const w = this.wind = clamp(p.wind || 0, 0, 1);
    // the moving air itself only from a fresh breeze on; a storm gets through the walls as a low roar
    // (levels with headroom: a full storm with its gusts peaks well below full scale)
    const bed = 0.2 * Math.pow(smooth(0.3, 1, w), 1.3), indoorRoar = p.inside ? 0.35 * smooth(0.6, 1, w) : 0;
    glide(this.bedG.gain, bed * Math.max(p.outdoor ?? 1, indoorRoar), t, seconds);
    glide(this.muffle.frequency, clamp(p.inside ? Math.min(p.lp ?? 900, 700) : 12000, 200, 16000), t, seconds);
    // the leaves: a light breeze rustles them a little, a storm loudly (behind glass their highs are gone)
    const leaf = 0.3 * smooth(0.08, 0.95, w) * clamp(p.foliage ?? 0.5, 0, 1), lp = clamp(p.lp ?? 12000, 200, 16000);
    const leaves = this.part('leaves', leaf * (p.outdoor ?? 1) > 0.002 && lp > 1500, (q, at) => this.#leaves(q, at), t);
    if (leaves) { glide(leaves.g.gain, leaf * (p.outdoor ?? 1), t, seconds); glide(leaves.muffle.frequency, lp, t, seconds); }
    const whistle = p.inside ? 0.05 * smooth(0.62, 1, w) * clamp(p.glass || 0, 0, 1) : 0;
    const wh = this.part('whistle', whistle > 0.001, (q, at) => this.#whistle(q, at), t);
    if (wh) { glide(wh.g.gain, whistle, t, seconds); glide(wh.pan.pan, clamp(p.glassPan || 0, -1, 1), t, seconds); }
    return { air: bed * Math.max(p.outdoor ?? 1, indoorRoar), leaves: leaves ? leaf * (p.outdoor ?? 1) : 0, whistle };
  }
  /** Gusts: the air and the leaves swell together, faster and wider in a storm. */
  event(t) {
    const w = this.wind || 0.3, span = 0.3 + 0.7 * w;
    const target = clamp(1 - span * 0.45 + Math.random() * span * 0.9, 0.3, 1.35);
    const tau = 1.6 - 0.9 * w + Math.random();
    this.gust.gain.setTargetAtTime(target, t, tau); this.gustLevel = target;
    this.parts?.leaves?.gust.gain.setTargetAtTime(Math.pow(target, 1.2), t, tau * 0.8);
    return t + (6 - 3.5 * w) * (0.5 + Math.random());
  }
}

// ---------------------------------------------------------------- fire ---------------------------------------------
/** A wood fire: the low rumble of the flames, the airy hiss of the draught and its cracks and crackles. `open`: a fire
 *  under the sky (the fire bowl: less rumble, the crackle carries). set({ gain, lp, pan, intensity }). */
export class FireSound extends Layer {
  constructor(ctx, dest, { open = false } = {}) { super(ctx, dest); this.open = open; this.intensity = 0.7; }
  build(t) {
    const ctx = this.ctx, k = (n) => this.keep(n);
    this.g = k(gainNode(ctx, 0)); this.lp = k(filterNode(ctx, 'lowpass', 16000, 0.6)); this.pan = k(ctx.createStereoPanner());
    this.mix = k(gainNode(ctx, 1)); this.mix.connect(this.lp); this.lp.connect(this.g); this.g.connect(this.pan); this.pan.connect(this.dest);
    const rumble = this.src(noiseSource(ctx, 'brown', t, { loop: true })), rlp = k(filterNode(ctx, 'lowpass', 260, 0.6));
    this.rumbleGain = k(gainNode(ctx, 0.3));
    rumble.connect(rlp); rlp.connect(this.rumbleGain); this.rumbleGain.connect(this.mix);
    this.mod(this.rumbleGain.gain, 0.17, 0.12, t); this.mod(rlp.frequency, 0.09, 90, t + 1);
    const hiss = this.src(noiseSource(ctx, 'pink', t, { loop: true })), hbp = k(filterNode(ctx, 'bandpass', 1800, 0.5));
    this.hissGain = k(gainNode(ctx, 0.05));
    hiss.connect(hbp); hbp.connect(this.hissGain); this.hissGain.connect(this.mix);
    this.mod(this.hissGain.gain, 0.23, 0.02, t); this.mod(hbp.frequency, 0.13, 500, t + 2);
    this.#levels(t);
  }
  #levels(t) {
    if (!this.on) return;
    const i = this.intensity;
    rampTo(this.rumbleGain.gain, (this.open ? 0.08 : 0.16) + i * (this.open ? 0.1 : 0.2), t, 1.5);
    rampTo(this.hissGain.gain, 0.03 + i * 0.05, t, 1.5);
  }
  set(p, t = this.ctx.currentTime, seconds = 0.3) {
    if (!this.on) return;
    if (p.intensity != null && Math.abs(p.intensity - this.intensity) > 0.02) { this.intensity = clamp(p.intensity, 0, 1); this.#levels(t); }
    glide(this.g.gain, p.gain ?? 0, t, seconds);
    glide(this.lp.frequency, clamp(p.lp ?? 16000, 200, 16000), t, seconds);
    glide(this.pan.pan, clamp(p.pan || 0, -1, 1), t, seconds);
    return { gain: p.gain ?? 0, lp: p.lp ?? 16000, pan: p.pan || 0 };
  }
  event(t) {
    const ctx = this.ctx, r = Math.random(), out = this.mix;
    if (r < 0.12) { // crack: a resonant low-mid knock of splitting wood
      const n = noiseSource(ctx, 'white', t, { dur: 0.09 });
      const bp = filterNode(ctx, 'bandpass', 400 + Math.random() * 900, 4);
      const g = ctx.createGain(); percEnv(g.gain, t, 0.18 + Math.random() * 0.27, 0.002, 0.018);
      n.connect(bp); bp.connect(g); g.connect(out);
    } else { // pop / crackle: a short bright burst, sometimes a little cluster
      const count = Math.random() < 0.3 ? 2 + Math.floor(Math.random() * 3) : 1;
      for (let i = 0; i < count; i++) {
        const at = t + i * (0.02 + Math.random() * 0.05);
        const n = noiseSource(ctx, 'white', at, { dur: 0.05 });
        const bp = filterNode(ctx, 'bandpass', 2200 + Math.random() * 4000, 6 + Math.random() * 6);
        const g = ctx.createGain(); percEnv(g.gain, at, (0.06 + Math.random() * 0.16) * (this.open ? 1.2 : 1), 0.001, 0.004 + Math.random() * 0.012);
        n.connect(bp); bp.connect(g); g.connect(out);
      }
    }
    const rate = 2 + this.intensity * 7; // events per second
    return t + -Math.log(1 - Math.random()) / rate;
  }
}

// ---------------------------------------------------------------- clock --------------------------------------------
/** The wall clock: a soft tick at every second of the real time, when its second hand jumps (the world shows the
 *  computer's time, world.js #setClock). set({ gain, lp, pan }). */
export class ClockSound extends Layer {
  build(t) {
    const ctx = this.ctx;
    this.g = this.keep(gainNode(ctx, 0)); this.lp = this.keep(filterNode(ctx, 'lowpass', 16000, 0.6)); this.pan = this.keep(ctx.createStereoPanner());
    this.mix = this.keep(gainNode(ctx, 1)); this.mix.connect(this.lp); this.lp.connect(this.g); this.g.connect(this.pan); this.pan.connect(this.dest);
    this.tock = false;
    this.nextEvent = this.#nextSecond(t);
  }
  /** The context time of the next full second of the clock on the wall (minus the output latency, so that the tick is
   *  heard when the hand moves). Offline contexts tick on whole seconds of their own time. */
  #nextSecond(t) {
    if (typeof this.ctx.startRendering === 'function' || typeof Date === 'undefined') return Math.ceil(t);
    const lat = (this.ctx.outputLatency || this.ctx.baseLatency || 0);
    const ms = Date.now() + (t - this.ctx.currentTime) * 1000;
    // a latency longer than the rest of the second would put the tick before t (before 0 right after the start,
    // which the audio nodes refuse): then it is the tick of the second after
    const next = t + (1000 - (ms % 1000)) / 1000 - lat;
    return next < t ? next + 1 : next;
  }
  set(p, t = this.ctx.currentTime, seconds = 0.2) {
    if (!this.on) return;
    glide(this.g.gain, p.gain ?? 0, t, seconds);
    glide(this.lp.frequency, clamp(p.lp ?? 16000, 200, 16000), t, seconds);
    glide(this.pan.pan, clamp(p.pan || 0, -1, 1), t, seconds);
    return { gain: p.gain ?? 0, lp: p.lp ?? 16000, pan: p.pan || 0 };
  }
  event(t) {
    const ctx = this.ctx, tock = this.tock = !this.tock, out = this.mix;
    const n = noiseSource(ctx, 'white', t, { dur: 0.02 });
    const bp = filterNode(ctx, 'bandpass', tock ? 2100 : 2700, 5);
    const g = ctx.createGain(); percEnv(g.gain, t, 0.3, 0.001, 0.006);
    n.connect(bp); bp.connect(g); g.connect(out);
    const o = osc(ctx, 'sine', tock ? 1350 : 1750, t);
    const og = ctx.createGain(); percEnv(og.gain, t, 0.08, 0.001, 0.012);
    o.connect(og); og.connect(out); o.stop(t + 0.1);
    const w = osc(ctx, 'triangle', tock ? 320 : 410, t); // the case resonating
    const wg = ctx.createGain(); percEnv(wg.gain, t, 0.07, 0.001, 0.02);
    w.connect(wg); wg.connect(out); w.stop(t + 0.15);
    // stay on the clock's seconds (a timer that drifted, a context that slept)
    const next = t + 1, sync = this.#nextSecond(t + 0.5);
    return Math.abs(sync - next) < 0.25 ? sync : next;
  }
}

// ---------------------------------------------------------------- crickets -----------------------------------------
/** One field cricket in the grass, chirping on its own loop. set({ gain, lp, pan }). */
export class CricketSound extends Layer {
  constructor(ctx, dest, voice = 'cricket-a') { super(ctx, dest); this.voice = voice; }
  build(t) {
    const ctx = this.ctx;
    this.g = this.keep(gainNode(ctx, 0)); this.lp = this.keep(filterNode(ctx, 'lowpass', 16000, 0.6)); this.pan = this.keep(ctx.createStereoPanner());
    const s = this.src(textureSource(ctx, this.voice, t, { rate: 0.97 + Math.random() * 0.06 }));
    s.connect(this.lp); this.lp.connect(this.g); this.g.connect(this.pan); this.pan.connect(this.dest);
  }
  set(p, t = this.ctx.currentTime, seconds = 0.4) {
    if (!this.on) return;
    glide(this.g.gain, p.gain ?? 0, t, seconds);
    glide(this.lp.frequency, clamp(p.lp ?? 16000, 200, 16000), t, seconds);
    glide(this.pan.pan, clamp(p.pan || 0, -1, 1), t, seconds);
    return { gain: p.gain ?? 0, lp: p.lp ?? 16000, pan: p.pan || 0 };
  }
}

// ---------------------------------------------------------------- thunder ------------------------------------------
/**
 * The thunder of one strike, `distance` metres away: near, a sharp tearing crack and then the roll; far, only a low,
 * long rumble that swells in slowly. Into dest at t; returns its duration.
 */
export function thunder(ctx, dest, t, { distance = 2500, gain = 1 } = {}) {
  const km = clamp(distance / 1000, 0.2, 12);
  const near = smooth(1.6, 0.4, km);                         // 1 for a strike close by
  const dur = 5 + Math.min(9, km * 1.6) + Math.random() * 3;
  const peak = gain * clamp(0.75 / Math.sqrt(km), 0.15, 0.95);
  // the roll: deep noise with a few swells, the highs fading as it rolls away
  const n = noiseSource(ctx, 'brown', t, { dur: dur + 1 });
  const lp = filterNode(ctx, 'lowpass', 110 + 900 * near * near + 60 / km, 0.7);
  const g = ctx.createGain();
  const rise = 0.15 + (1 - near) * (0.6 + Math.random() * 1.2);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + rise);
  let at = t + rise + 0.4;
  while (at < t + dur - 1.5) { g.gain.linearRampToValueAtTime(peak * (0.25 + Math.random() * 0.75), at); at += 0.4 + Math.random() * 0.9; }
  g.gain.linearRampToValueAtTime(0, t + dur);
  lp.frequency.setValueAtTime(lp.frequency.value, t); lp.frequency.linearRampToValueAtTime(70, t + dur);
  n.connect(lp); lp.connect(g); g.connect(dest);
  if (near > 0.05) {
    // the crack in front of a near strike: bright, tearing, a few hundred milliseconds
    const c = noiseSource(ctx, 'white', t, { dur: 0.7 }), cl = filterNode(ctx, 'lowpass', 2400 * near + 600, 0.7), cg = ctx.createGain();
    cg.gain.setValueAtTime(0, t); cg.gain.linearRampToValueAtTime(peak * 0.9 * near, t + 0.012);
    for (let k = 1; k < 6; k++) cg.gain.linearRampToValueAtTime(peak * near * (0.3 + Math.random() * 0.6) * (1 - k / 6), t + 0.012 + k * 0.07);
    cg.gain.linearRampToValueAtTime(0, t + 0.6);
    c.connect(cl); cl.connect(cg); cg.connect(dest);
  }
  return dur;
}
