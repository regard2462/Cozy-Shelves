// Procedural instruments. Every voice is a small, self-terminating node graph:
//   play(ctx, dest, { t, midi, dur, vel }) → nodes stop themselves and get garbage collected.
import { mtof, clamp, osc, gainNode, filterNode, noiseSource, percEnv, adsrEnv, lfo } from './dsp.js';

/** Felt piano: soft attack, muffled partials, sympathetic detune, pitch dependent decay. */
export function feltPiano(ctx, dest, { t, midi, dur = 1, vel = 0.6 }) {
  const f = mtof(midi);
  const out = gainNode(ctx, 1);
  const lp = filterNode(ctx, 'lowpass', clamp(f * 2.6 + 200 + vel * 1200, 400, 4200), 0.4);
  out.connect(lp); lp.connect(dest);
  const amp = 0.11 * (0.35 + 0.65 * vel);
  const bodyTau = clamp(5.5 - (midi - 40) / 12 * 1.1, 1.2, 5.5);
  const attack = 0.012 + (1 - vel) * 0.025;
  const release = 0.35;
  const stopAt = t + dur + release * 5;
  const partial = (ratio, gain, tau, detune = 0) => {
    const o = osc(ctx, 'sine', f * ratio, t, detune);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain * amp, t + attack);
    g.gain.setTargetAtTime(0, t + attack, tau);
    g.gain.setTargetAtTime(0, t + dur, release / 3);
    o.connect(g); g.connect(out);
    o.stop(stopAt);
  };
  partial(1, 1, bodyTau);
  partial(1, 0.35, bodyTau * 1.1, 4);        // sympathetic string, slightly detuned
  partial(2.001, 0.28, Math.min(1.1, bodyTau * 0.35));
  partial(3.004, vel > 0.45 ? 0.08 : 0.03, 0.3);
  // felt hammer thump
  const n = noiseSource(ctx, 'pink', t, { dur: 0.06 });
  const nf = filterNode(ctx, 'lowpass', 500, 0.7);
  const ng = ctx.createGain(); percEnv(ng.gain, t, 0.04 * vel, 0.004, 0.012);
  n.connect(nf); nf.connect(ng); ng.connect(dest);
  return stopAt;
}

/** Warm pad: detuned saws + sine body through a slowly wandering lowpass. Slow attack / release. */
export function pad(ctx, dest, { t, midi, dur = 8, vel = 0.5, attack = 3, release = 4 }) {
  const f = mtof(midi);
  const lp = filterNode(ctx, 'lowpass', clamp(f * 2.2, 260, 1800), 0.8);
  const g = ctx.createGain();
  const stopAt = adsrEnv(g.gain, t, { peak: 0.055 * vel, a: attack, dur, rTau: release / 4 });
  lp.connect(g); g.connect(dest);
  const mod = lfo(ctx, lp.frequency, 0.05 + Math.random() * 0.05, lp.frequency.value * 0.35, t);
  const parts = [osc(ctx, 'sawtooth', f, t, -7), osc(ctx, 'sawtooth', f, t, 7), osc(ctx, 'sine', f, t), osc(ctx, 'triangle', f * 0.5, t)];
  const gains = [0.5, 0.5, 0.8, 0.35];
  parts.forEach((o, i) => { const pg = gainNode(ctx, gains[i]); o.connect(pg); pg.connect(lp); o.stop(stopAt); });
  mod.osc.stop(stopAt);
  return stopAt;
}

/** FM bell / glass tone. */
export function bell(ctx, dest, { t, midi, vel = 0.5, decay = 2.5, ratio = 3.5, index = 0.9, gain = 0.09 }) {
  const f = mtof(midi);
  const car = osc(ctx, 'sine', f, t);
  const mod = osc(ctx, 'sine', f * ratio, t);
  const mg = ctx.createGain();
  mg.gain.setValueAtTime(index * f, t);
  mg.gain.setTargetAtTime(index * f * 0.1, t, decay * 0.25);
  mod.connect(mg); mg.connect(car.frequency);
  const g = ctx.createGain();
  percEnv(g.gain, t, gain * (0.4 + 0.6 * vel), 0.004, decay / 3);
  car.connect(g); g.connect(dest);
  const stopAt = t + decay * 1.6;
  car.stop(stopAt); mod.stop(stopAt);
  return stopAt;
}

/** Music box / celesta tine: bright inharmonic partial with fast decay over a ringing fundamental. */
export function musicBox(ctx, dest, { t, midi, vel = 0.5, gain = 0.1 }) {
  const f = mtof(midi);
  const amp = gain * (0.4 + 0.6 * vel);
  const tau = clamp(1.6 - (midi - 72) / 24 * 0.6, 0.5, 1.8);
  const out = gainNode(ctx, 1); out.connect(dest);
  const stopAt = t + tau * 4;
  const part = (ratio, g, tauP) => { const o = osc(ctx, 'sine', f * ratio, t); const pg = ctx.createGain(); percEnv(pg.gain, t, amp * g, 0.002, tauP); o.connect(pg); pg.connect(out); o.stop(stopAt); };
  part(1, 1, tau);
  part(2.0, 0.14, tau * 0.35);
  part(6.27, 0.12 * vel, 0.09);
  return stopAt;
}

/** Rhodes-like FM electric piano. */
export function rhodes(ctx, dest, { t, midi, dur = 1, vel = 0.5, gain = 0.12 }) {
  const f = mtof(midi);
  const car = osc(ctx, 'sine', f, t);
  const mod = osc(ctx, 'sine', f, t);
  const mg = ctx.createGain();
  const index = (0.9 + vel * 1.4) * f;
  mg.gain.setValueAtTime(index, t);
  mg.gain.setTargetAtTime(index * 0.12, t, 0.35);
  mod.connect(mg); mg.connect(car.frequency);
  // tine transient: quiet high partial
  const tine = osc(ctx, 'sine', f * 4, t);
  const tg = ctx.createGain(); percEnv(tg.gain, t, gain * 0.12 * vel, 0.002, 0.05);
  tine.connect(tg);
  const lp = filterNode(ctx, 'lowpass', clamp(f * 3 + 400, 500, 3000), 0.5);
  const g = ctx.createGain();
  const stopAt = adsrEnv(g.gain, t, { peak: gain * (0.35 + 0.65 * vel), a: 0.008, d: 2.2, s: 0.35, dur, rTau: 0.12 });
  car.connect(lp); tg.connect(lp); lp.connect(g); g.connect(dest);
  car.stop(stopAt); mod.stop(stopAt); tine.stop(stopAt);
  return stopAt;
}

/** Soft upright-ish bass: sine + triangle, lowpassed. */
export function bass(ctx, dest, { t, midi, dur = 1, vel = 0.6, gain = 0.22 }) {
  const f = mtof(midi);
  const s = osc(ctx, 'sine', f, t);
  const tri = osc(ctx, 'triangle', f, t);
  const tg = gainNode(ctx, 0.35);
  const lp = filterNode(ctx, 'lowpass', 420, 0.6);
  const g = ctx.createGain();
  const stopAt = adsrEnv(g.gain, t, { peak: gain * (0.5 + 0.5 * vel), a: 0.015, d: 1.4, s: 0.4, dur, rTau: 0.06 });
  s.connect(lp); tri.connect(tg); tg.connect(lp); lp.connect(g); g.connect(dest);
  // finger noise
  const n = noiseSource(ctx, 'white', t, { dur: 0.03 });
  const nf = filterNode(ctx, 'bandpass', 1800, 2); const ng = ctx.createGain(); percEnv(ng.gain, t, 0.012 * vel, 0.002, 0.008);
  n.connect(nf); nf.connect(ng); ng.connect(dest);
  s.stop(stopAt); tri.stop(stopAt);
  return stopAt;
}

/** Brushed snare / hat texture: filtered noise. kind 'swish' (long, soft) or 'tick' (short). */
export function brush(ctx, dest, { t, dur = 0.4, vel = 0.5, kind = 'swish', gain = 0.018 }) {
  const n = noiseSource(ctx, 'white', t, { dur: dur + 0.1 });
  const bp = filterNode(ctx, 'bandpass', kind === 'tick' ? 6500 : 4200 + Math.random() * 1500, kind === 'tick' ? 1.2 : 0.7);
  const hp = filterNode(ctx, 'highpass', 2500, 0.5);
  const g = ctx.createGain();
  if (kind === 'tick') percEnv(g.gain, t, gain * vel * 1.3, 0.003, 0.02);
  else { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain * vel, t + dur * 0.55); g.gain.linearRampToValueAtTime(0, t + dur); }
  n.connect(bp); bp.connect(hp); hp.connect(g); g.connect(dest);
  return t + dur + 0.1;
}

/** Simple drone tone: sine + triangle through a slow lowpass. */
export function drone(ctx, dest, { t, midi, dur = 30, vel = 0.5, attack = 4, release = 5, gain = 0.06 }) {
  const f = mtof(midi);
  const lp = filterNode(ctx, 'lowpass', clamp(f * 3, 200, 900), 0.7);
  const g = ctx.createGain();
  const stopAt = adsrEnv(g.gain, t, { peak: gain * vel, a: attack, dur, rTau: release / 4 });
  lp.connect(g); g.connect(dest);
  const a = osc(ctx, 'sine', f, t), b = osc(ctx, 'triangle', f, t, 5), c = osc(ctx, 'sine', f * 2, t, -4);
  const bg = gainNode(ctx, 0.25), cg = gainNode(ctx, 0.12);
  a.connect(lp); b.connect(bg); bg.connect(lp); c.connect(cg); cg.connect(lp);
  lfo(ctx, lp.frequency, 0.03 + Math.random() * 0.03, lp.frequency.value * 0.4, t).osc.stop(stopAt);
  a.stop(stopAt); b.stop(stopAt); c.stop(stopAt);
  return stopAt;
}

/** Sea drone: harmonic partials whose levels drift independently (shifting overtones). */
export function seaDrone(ctx, dest, { t, midi, dur = 24, vel = 0.5, attack = 8, release = 10, gain = 0.05 }) {
  const f = mtof(midi);
  const g = ctx.createGain();
  const stopAt = adsrEnv(g.gain, t, { peak: gain * vel, a: attack, dur, rTau: release / 4 });
  g.connect(dest);
  const base = [0.6, 0.28, 0.14, 0.09, 0.05];
  base.forEach((b, i) => {
    const o = osc(ctx, 'sine', f * (i + 1), t, (Math.random() - 0.5) * 6);
    const pg = gainNode(ctx, b * 0.7);
    o.connect(pg); pg.connect(g);
    lfo(ctx, pg.gain, 0.02 + Math.random() * 0.07, b * 0.55, t + Math.random()).osc.stop(stopAt);
    o.stop(stopAt);
  });
  return stopAt;
}

/** Plain sine sub tone (bass foundation for pads / drones). */
export function sub(ctx, dest, { t, midi, dur = 8, vel = 0.5, attack = 2, release = 3, gain = 0.1 }) {
  const o = osc(ctx, 'sine', mtof(midi), t);
  const g = ctx.createGain();
  const stopAt = adsrEnv(g.gain, t, { peak: gain * vel, a: attack, dur, rTau: release / 4 });
  o.connect(g); g.connect(dest); o.stop(stopAt);
  return stopAt;
}
