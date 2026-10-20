// Looping sound textures, made once per audio context in plain JavaScript (synth.js) and played by looping buffer
// sources: rain is thousands of single drops (each a tiny damped ring), which sounds like rain in a way that filtered
// noise never does; drops on water ring upwards (the bubble they leave); drops on glass tick sharply and set the pane
// ringing a little; leaves are noise roughened by countless small contacts; a field cricket chirps in pulses of a pure
// high tone. Every texture wraps round its end, so the loop has no seam. Seeded: the same texture on every start.
// They are made in the sound worker (offthread.js) when the audio starts; a layer that needs one before it is there
// starts it as soon as it arrives.
import { Biquad, addBlip, dcBlock, rms, toBuffer, rng, TAU } from './synth.js';
import { offthread } from './offthread.js';

const logUniform = (r, lo, hi) => Math.exp(Math.log(lo) + r() * (Math.log(hi) - Math.log(lo)));
const scaleRms = (d, target) => { const v = rms(d); if (v > 0) { const k = target / v; for (let i = 0; i < d.length; i++) d[i] *= k; } return d; };

/** Rain falling on the ground and on leaves: `perSecond` drops, most of them tiny, a few big ones with a low thud. */
function patter(sr, { seconds = 3, perSecond = 2600, seed = 11 } = {}) {
  const r = rng(seed), out = new Float32Array(Math.round(sr * seconds));
  const n = Math.round(seconds * perSecond);
  for (let i = 0; i < n; i++) {
    const at = r() * out.length, f = logUniform(r, 700, 9000);
    // high drops ring shorter
    const tau = (0.0005 + r() * 0.0018) * Math.sqrt(2500 / f);
    addBlip(out, sr, at, { f, fEnd: f * (0.97 + r() * 0.06), tau, amp: Math.pow(r(), 2.4), phase: r() * TAU, wrap: true, rise: 0.00015 });
    if (r() < 0.05) addBlip(out, sr, at, { f: 140 + r() * 260, tau: 0.004 + r() * 0.005, amp: 0.5 * Math.pow(r(), 1.5), wrap: true, rise: 0.0006 });
  }
  dcBlock(out, sr, 60);
  return scaleRms(out, 0.2);
}
/** Rain on open water: little rings that rise in pitch as they fade. */
function bubbles(sr, { seconds = 3, perSecond = 260, seed = 23 } = {}) {
  const r = rng(seed), out = new Float32Array(Math.round(sr * seconds));
  for (let i = 0, n = Math.round(seconds * perSecond); i < n; i++) {
    const f = logUniform(r, 1100, 4200);
    addBlip(out, sr, r() * out.length, { f, fEnd: f * (1.25 + r() * 0.35), tau: 0.003 + r() * 0.006, amp: Math.pow(r(), 1.8), phase: r() * TAU, wrap: true, rise: 0.0005 });
  }
  // the hiss of the drops hitting the surface
  const hp = new Biquad(sr, 'highpass', 2500, 0.7);
  for (let i = 0; i < out.length; i++) out[i] += 0.05 * hp.process(r() * 2 - 1);
  dcBlock(out, sr, 80);
  return scaleRms(out, 0.2);
}
/** Drops on a window pane: sharp ticks, the glass ringing softly under them, now and then a little run of drops. */
function pane(sr, { seconds = 4, perSecond = 140, seed = 37 } = {}) {
  const r = rng(seed), out = new Float32Array(Math.round(sr * seconds));
  const n = Math.round(seconds * perSecond);
  for (let i = 0; i < n; i++) {
    const at = r() * out.length, a = Math.pow(r(), 2);
    const f = logUniform(r, 2400, 7500);
    addBlip(out, sr, at, { f, tau: 0.0006 + r() * 0.0009, amp: a, phase: r() * TAU, wrap: true, rise: 0.0001 });
    addBlip(out, sr, at, { f: 500 + r() * 900, tau: 0.003 + r() * 0.004, amp: a * 0.25, phase: r() * TAU, wrap: true, rise: 0.0004 });
    if (r() < 0.02) {   // a run of drops down the glass
      let t = at; for (let k = 0, m = 3 + Math.floor(r() * 6); k < m; k++) { t += sr * (0.02 + r() * 0.05); addBlip(out, sr, t, { f: logUniform(r, 2800, 6000), tau: 0.0005, amp: a * 0.4, wrap: true, rise: 0.0001 }); }
    }
  }
  dcBlock(out, sr, 120);
  return scaleRms(out, 0.2);
}
/** Leaves in the wind: noise above 1 kHz whose loudness jumps with countless small contacts of leaf on leaf. */
function leaves(sr, { seconds = 4, perSecond = 320, seed = 51 } = {}) {
  const r = rng(seed), len = Math.round(sr * seconds), out = new Float32Array(len);
  // the contacts: an envelope of overlapping decays
  const env = new Float32Array(len);
  for (let i = 0, n = Math.round(seconds * perSecond); i < n; i++) {
    const at = Math.floor(r() * len), a = Math.pow(r(), 2.2), k = Math.exp(-1 / ((0.002 + r() * 0.007) * sr));
    let v = a; for (let j = 0; j < sr * 0.06 && v > 1e-4; j++) { env[(at + j) % len] += v; v *= k; }
  }
  const hp = new Biquad(sr, 'highpass', 1300, 0.6), lp = new Biquad(sr, 'lowpass', 9500, 0.6);
  // run the filters over the loop twice so that their state at the seam is the steady one
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < len; i++) out[i] = lp.process(hp.process(r() * 2 - 1)) * (0.05 + env[i]);
  return scaleRms(out, 0.2);
}
/** A field cricket: chirps of three to five pulses of a pure tone near 4.5 kHz, `rate` chirps a second. */
function cricket(sr, { carrier = 4600, rate = 2.9, seed = 61 } = {}) {
  const r = rng(seed), chirps = Math.max(4, Math.round(rate * 2.4)), seconds = chirps / rate;
  const out = new Float32Array(Math.round(sr * seconds));
  for (let c = 0; c < chirps; c++) {
    const t0 = (c + (r() - 0.5) * 0.06) / rate * sr, pulses = 3 + Math.floor(r() * 3);
    for (let p = 0; p < pulses; p++) {
      const at = t0 + p * (0.028 + r() * 0.004) * sr, n = Math.round((0.016 + r() * 0.004) * sr), f = carrier * (1 + (r() - 0.5) * 0.01);
      const a = (p === 0 ? 0.6 : 1) * (0.85 + r() * 0.15);
      for (let i = 0; i < n; i++) {
        const u = i / n, e = Math.sin(Math.PI * Math.min(1, u * 1.6)) * (u > 0.62 ? 1 - (u - 0.62) / 0.38 : 1);
        const j = Math.round(at + i) % out.length;
        out[j] += a * e * (Math.sin(TAU * f * i / sr) + 0.08 * Math.sin(TAU * 2 * f * i / sr));
      }
    }
  }
  return scaleRms(out, 0.15);   // a pure tone in short pulses: its peaks are high
}

// the textures by name
const MAKERS = {
  'patter-light': (sr) => patter(sr, { perSecond: 520, seed: 12 }),
  'patter-heavy': (sr) => patter(sr, { perSecond: 2800, seed: 13 }),
  bubbles: (sr) => bubbles(sr),
  pane: (sr) => pane(sr),
  leaves: (sr) => leaves(sr),
  'cricket-a': (sr) => cricket(sr, { carrier: 4350, rate: 2.5, seed: 61 }),
  'cricket-b': (sr) => cricket(sr, { carrier: 4700, rate: 3.0, seed: 62 }),
  'cricket-c': (sr) => cricket(sr, { carrier: 5050, rate: 3.4, seed: 63 }),
};
export const TEXTURES = Object.keys(MAKERS);
/** The samples of a texture (the worker calls it). */
export function makeTexture(name, sr) { return MAKERS[name] ? MAKERS[name](sr) : null; }

const made = new WeakMap();   // context → Map(name → AudioBuffer | Promise)
const store = (ctx) => { let m = made.get(ctx); if (!m) made.set(ctx, m = new Map()); return m; };
const offline = (ctx) => typeof ctx.startRendering === 'function';
/** Make the textures for this context in the worker (the soundscape asks when the audio starts, for the sounds that
 *  are switched on). */
export function prepareTextures(ctx, names = TEXTURES) { for (const name of names) if (MAKERS[name]) whenReady(ctx, name); }
/** The texture as an AudioBuffer, a Promise of it while the worker makes it. */
function whenReady(ctx, name) {
  const m = store(ctx);
  if (!m.has(name)) {
    if (offline(ctx)) m.set(name, toBuffer(ctx, makeTexture(name, ctx.sampleRate)));
    else {
      const p = offthread({ type: 'texture', name, sr: ctx.sampleRate }).then((r) => {
        // no worker: made here after all, in an idle moment
        const data = r?.data || makeTexture(name, ctx.sampleRate);
        const buf = toBuffer(ctx, data); m.set(name, buf); return buf;
      });
      m.set(name, p);
    }
  }
  return m.get(name);
}
/** The texture now, made on the spot if it is not there yet (the checks; offline contexts). */
export function texture(ctx, name) {
  const b = whenReady(ctx, name);
  if (b && !(b instanceof Promise)) return b;
  const buf = toBuffer(ctx, makeTexture(name, ctx.sampleRate)); store(ctx).set(name, buf); return buf;
}
/**
 * A looping source of a texture, started at a random point of the loop: { connect, disconnect, stop }. While the worker
 * still makes the texture the source is silent and starts when it arrives.
 */
export function textureSource(ctx, name, t, { rate = 1 } = {}) {
  const out = ctx.createGain();
  let src = null, stopped = false;
  const begin = (buf) => {
    if (stopped || !buf) return;
    src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = rate;
    src.connect(out); src.start(Math.max(t, ctx.currentTime), Math.random() * buf.duration);
  };
  const b = whenReady(ctx, name);
  if (b instanceof Promise) b.then(begin); else begin(b);
  return {
    connect: (dest) => out.connect(dest),
    disconnect: () => { try { out.disconnect(); } catch (e) { /* */ } },
    stop: (at) => { stopped = true; try { src?.stop(at); } catch (e) { /* */ } },
  };
}
