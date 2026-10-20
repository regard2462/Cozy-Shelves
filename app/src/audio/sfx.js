// Procedural UI / world sound effects. Each entry: (ctx, dest, t, opts) → optional handle { stop(t) } for loops.
// The doors swing without a sound (0.7: the creak and the latch did not match the glass doors gliding open).
import { osc, gainNode, filterNode, noiseSource, percEnv, lfo } from './dsp.js';
import { playStep } from './steps.js';

const R = (lo, hi) => lo + Math.random() * (hi - lo);

/** Short filtered noise burst. */
function burst(ctx, dest, t, { dur = 0.1, kind = 'white', type = 'bandpass', freq = 2000, freqEnd, Q = 1, gain = 0.1, attack = 0.003, tau, hp } = {}) {
  const n = noiseSource(ctx, kind, t, { dur: dur + 0.15 });
  const f = filterNode(ctx, type, freq, Q);
  if (freqEnd) { f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur); }
  const g = ctx.createGain();
  if (tau) percEnv(g.gain, t, gain, attack, tau);
  else { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.linearRampToValueAtTime(0, t + dur); }
  n.connect(f);
  if (hp) { const h = filterNode(ctx, 'highpass', hp, 0.5); f.connect(h); h.connect(g); } else f.connect(g);
  g.connect(dest);
  return g;
}
/** Simple decaying tone, optional pitch drop. */
function tone(ctx, dest, t, { type = 'sine', freq = 440, freqEnd, dur = 0.2, gain = 0.1, attack = 0.002, tau, lp } = {}) {
  const o = osc(ctx, type, freq, t);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  const g = ctx.createGain();
  percEnv(g.gain, t, gain, attack, tau ?? dur / 4);
  if (lp) { const f = filterNode(ctx, 'lowpass', lp, 0.7); o.connect(f); f.connect(g); } else o.connect(g);
  g.connect(dest);
  o.stop(t + dur + (tau ?? dur / 4) * 5);
  return o;
}
function thud(ctx, dest, t, { freq = 95, gain = 0.2, dur = 0.12 } = {}) {
  tone(ctx, dest, t, { freq, freqEnd: freq * 0.55, dur, gain, tau: dur / 3 });
  burst(ctx, dest, t, { dur: 0.05, kind: 'pink', type: 'lowpass', freq: 380, gain: gain * 0.6, tau: 0.015 });
}
/**
 * A purring voice: brown noise in the chest register, chopped into ~25 pulses a second, breathing in and out.
 * With `dur` it swells in, holds and fades out by itself; without it runs until stop().
 */
function purrVoice(ctx, dest, t, { gain = 0.05, attack = 1.2, rate = 25, dur = 0, release = 1 } = {}) {
  const n = noiseSource(ctx, 'brown', t, { loop: true });
  const bp = filterNode(ctx, 'bandpass', 380, 1.2);
  const lp = filterNode(ctx, 'lowpass', 900, 0.5);
  const pulse = gainNode(ctx, 0.5);                 // purr pulses
  const pl = lfo(ctx, pulse.gain, rate, 0.5, t, 'sine');
  const breath = gainNode(ctx, 0.65);               // in / out breathing
  const bl = lfo(ctx, breath.gain, 0.42, 0.35, t, 'sine');
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack);
  n.connect(bp); bp.connect(lp); lp.connect(pulse); pulse.connect(breath); breath.connect(g); g.connect(dest);
  const end = (at) => { for (const node of [n, pl.osc, bl.osc]) node.stop(at); };
  if (dur) { g.gain.setValueAtTime(gain, t + Math.max(attack, dur - release)); g.gain.linearRampToValueAtTime(0, t + dur); end(t + dur + 0.1); }
  return {
    stop(at) { g.gain.cancelScheduledValues(at); g.gain.setValueAtTime(g.gain.value, at); g.gain.linearRampToValueAtTime(0, at + 0.8); end(at + 1); },
  };
}

export const SFX = {
  click(ctx, dest, t) {
    tone(ctx, dest, t, { freq: R(1500, 1900), dur: 0.05, gain: 0.07, tau: 0.01 });
    burst(ctx, dest, t, { dur: 0.02, type: 'highpass', freq: 3000, gain: 0.05, tau: 0.004 });
  },
  page(ctx, dest, t) {
    burst(ctx, dest, t, { dur: 0.22, kind: 'pink', type: 'bandpass', freq: 1100, freqEnd: 3200, Q: 0.7, gain: 0.16, attack: 0.05 });
    burst(ctx, dest, t + 0.17, { dur: 0.09, kind: 'white', type: 'bandpass', freq: 2600, freqEnd: 900, Q: 1, gain: 0.1, attack: 0.01 });
    burst(ctx, dest, t + 0.25, { dur: 0.03, type: 'highpass', freq: 2500, gain: 0.04, tau: 0.008 });
  },
  'book-pull'(ctx, dest, t) {
    burst(ctx, dest, t, { dur: 0.32, kind: 'pink', type: 'lowpass', freq: 1400, freqEnd: 500, Q: 0.8, gain: 0.14, attack: 0.03 });
    burst(ctx, dest, t + 0.02, { dur: 0.25, kind: 'white', type: 'bandpass', freq: 3200, Q: 1.5, gain: 0.03, attack: 0.05 });
    thud(ctx, dest, t + 0.3, { freq: 110, gain: 0.12, dur: 0.1 });
  },
  'book-place'(ctx, dest, t) {
    burst(ctx, dest, t, { dur: 0.07, kind: 'pink', type: 'bandpass', freq: 1800, Q: 0.8, gain: 0.06, attack: 0.01 });
    thud(ctx, dest, t + 0.05, { freq: 90, gain: 0.2, dur: 0.13 });
    burst(ctx, dest, t + 0.06, { dur: 0.06, type: 'bandpass', freq: 900, Q: 2, gain: 0.05, tau: 0.015 });
  },
  basket(ctx, dest, t) {
    for (let i = 0; i < 3; i++) burst(ctx, dest, t + i * R(0.03, 0.06), { dur: 0.03, type: 'bandpass', freq: R(2200, 3400), Q: 3, gain: 0.05, tau: 0.006 });
    tone(ctx, dest, t + 0.05, { freq: 420, freqEnd: 300, dur: 0.06, gain: 0.05, tau: 0.02 });
  },
  sit(ctx, dest, t) {
    for (let i = 0; i < 3; i++) burst(ctx, dest, t + i * 0.13, { dur: 0.22, kind: 'pink', type: 'bandpass', freq: R(700, 2400), Q: 0.8, gain: 0.05 + i * 0.01, attack: 0.06 });
    thud(ctx, dest, t + 0.3, { freq: 70, gain: 0.1, dur: 0.16 });
    tone(ctx, dest, t + 0.32, { type: 'triangle', freq: 180, freqEnd: 150, dur: 0.25, gain: 0.012, lp: 600, tau: 0.08 });
  },
  stand(ctx, dest, t) {
    burst(ctx, dest, t, { dur: 0.25, kind: 'pink', type: 'bandpass', freq: 1500, freqEnd: 800, Q: 0.8, gain: 0.06, attack: 0.04 });
    burst(ctx, dest, t + 0.15, { dur: 0.15, kind: 'pink', type: 'bandpass', freq: 900, Q: 0.8, gain: 0.04, attack: 0.03 });
    thud(ctx, dest, t + 0.2, { freq: 80, gain: 0.06, dur: 0.1 });
  },
  // a footfall on the surface under the feet (steps.js); o: { surface, run, speed, landing, impact, wet, gain }
  footstep(ctx, dest, t, o = {}) { return playStep(ctx, dest, t, o); },
  type(ctx, dest, t) {
    const p = R(0.9, 1.1);
    burst(ctx, dest, t, { dur: 0.025, type: 'bandpass', freq: 3200 * p, Q: 2, gain: 0.08, tau: 0.005 });
    tone(ctx, dest, t, { freq: 1500 * p, dur: 0.02, gain: 0.03, tau: 0.004 });
    tone(ctx, dest, t + 0.004, { type: 'triangle', freq: 300 * p, dur: 0.04, gain: 0.04, tau: 0.012, lp: 1200 });
    if (Math.random() < 0.5) burst(ctx, dest, t + R(0.06, 0.09), { dur: 0.02, type: 'bandpass', freq: 2400, Q: 2, gain: 0.03, tau: 0.004 }); // key return
  },
  'chess-move'(ctx, dest, t) {
    const knock = (at, g) => {
      tone(ctx, dest, at, { freq: R(560, 680), dur: 0.05, gain: 0.12 * g, tau: 0.02 });
      tone(ctx, dest, at, { freq: R(1000, 1300), dur: 0.03, gain: 0.04 * g, tau: 0.008 });
      burst(ctx, dest, at, { dur: 0.03, kind: 'pink', type: 'lowpass', freq: 1600, gain: 0.1 * g, tau: 0.008 });
    };
    knock(t, 1);
    if (Math.random() < 0.6) knock(t + R(0.07, 0.12), 0.45);
  },
  error(ctx, dest, t) {
    const o = osc(ctx, 'sawtooth', 92, t);
    const o2 = osc(ctx, 'triangle', 138, t);
    const f = filterNode(ctx, 'lowpass', 360, 1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.02); g.gain.setValueAtTime(0.06, t + 0.22); g.gain.linearRampToValueAtTime(0, t + 0.3);
    const trem = gainNode(ctx, 1); lfo(ctx, trem.gain, 24, 0.5, t).osc.stop(t + 0.35);
    o.connect(f); o2.connect(f); f.connect(trem); trem.connect(g); g.connect(dest);
    o.stop(t + 0.35); o2.stop(t + 0.35);
  },
  open(ctx, dest, t) {
    burst(ctx, dest, t, { dur: 0.25, kind: 'pink', type: 'bandpass', freq: 500, freqEnd: 2400, Q: 1, gain: 0.07, attack: 0.08 });
    tone(ctx, dest, t + 0.08, { freq: 880, dur: 0.5, gain: 0.03, tau: 0.12 });
    tone(ctx, dest, t + 0.16, { freq: 1320, dur: 0.5, gain: 0.02, tau: 0.14 });
  },
  bell(ctx, dest, t) {
    const f = 1760;
    [[1, 1, 1.8], [2.02, 0.4, 1.0], [2.74, 0.25, 0.7], [3.76, 0.12, 0.4]].forEach(([r, g, tau]) => tone(ctx, dest, t, { freq: f * r, dur: tau * 2, gain: 0.07 * g, tau }));
    burst(ctx, dest, t, { dur: 0.02, type: 'highpass', freq: 4000, gain: 0.04, tau: 0.004 });
  },
  'record-needle'(ctx, dest, t) {
    burst(ctx, dest, t, { dur: 0.06, kind: 'pink', type: 'lowpass', freq: 700, gain: 0.12, tau: 0.02 }); // needle drop
    const bed = burst(ctx, dest, t + 0.05, { dur: 2.4, kind: 'pink', type: 'lowpass', freq: 3500, gain: 0.03, attack: 0.1 });
    let at = t + 0.1;
    while (at < t + 2.2) { // crackle thinning out
      burst(ctx, dest, at, { dur: 0.02, type: 'bandpass', freq: R(2000, 6000), Q: 5, gain: R(0.03, 0.1) * (1 - (at - t) / 2.6), tau: R(0.002, 0.006) });
      at += R(0.02, 0.12) * (1 + (at - t) * 0.6);
    }
    return { end: t + 2.6, bed };
  },
  purr(ctx, dest, t, o = {}) {
    const v = purrVoice(ctx, dest, t, { gain: o.volume ?? 0.05, attack: 1.2 });
    return { loop: true, stop: (at) => v.stop(at) };
  },
  // the cat is being petted: a few seconds of louder purring on top of the loop
  'purr-pet'(ctx, dest, t, o = {}) {
    purrVoice(ctx, dest, t, { gain: (o.volume ?? 1) * 0.16, attack: 0.5, rate: 27, dur: o.dur ?? 4.6, release: 1.1 });
  },
  // a short trilled "mrrp", the cat's greeting when it is stroked
  mrrp(ctx, dest, t, o = {}) {
    const p = o.pitch ?? R(0.92, 1.08), dur = 0.34, v = (o.volume ?? 1) * 0.1;
    const src = osc(ctx, 'sawtooth', 430 * p, t);
    src.frequency.setValueAtTime(430 * p, t);
    src.frequency.linearRampToValueAtTime(650 * p, t + 0.13);
    src.frequency.linearRampToValueAtTime(520 * p, t + dur);
    const trill = gainNode(ctx, 1);                   // the rolled "rr" at the start
    const tr = lfo(ctx, trill.gain, 30, 0.5, t);
    tr.gain.gain.setValueAtTime(0.5, t); tr.gain.gain.linearRampToValueAtTime(0, t + 0.17);
    const mouth = filterNode(ctx, 'lowpass', 520, 0.8); // closed "m", opening to the vowel
    mouth.frequency.setValueAtTime(520, t); mouth.frequency.exponentialRampToValueAtTime(2800, t + 0.12); mouth.frequency.exponentialRampToValueAtTime(1500, t + dur);
    const f1 = filterNode(ctx, 'bandpass', 950, 3.5), f2 = filterNode(ctx, 'bandpass', 2200, 5), dry = gainNode(ctx, 0.3);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(v, t + 0.035); env.gain.setValueAtTime(v, t + dur - 0.08); env.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(trill); trill.connect(mouth); mouth.connect(f1); mouth.connect(f2); mouth.connect(dry);
    f1.connect(env); f2.connect(env); dry.connect(env); env.connect(dest);
    src.stop(t + dur + 0.05); tr.osc.stop(t + dur + 0.05);
  },
};

export const SFX_NAMES = Object.keys(SFX);

