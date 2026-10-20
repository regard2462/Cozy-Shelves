// Sample-level synthesis in plain JavaScript, for sounds that are easier to build sample by sample than out of Web Audio
// nodes: footsteps (steps.js) and the looping textures (textures.js: rain, leaves, crickets). Small and dependency
// free: an RBJ biquad, a two-pole resonator, damped sine "blips", envelopes, a seedable random source and the step from
// a Float32Array to an AudioBuffer. It runs in the sound worker as well (workers/sound-worker.js).
import { rng } from './dsp.js';

export { rng };
export const TAU = Math.PI * 2;

/** RBJ cookbook biquad on single samples. type: 'lowpass' | 'highpass' | 'bandpass' (0 dB peak) | 'peaking'. */
export class Biquad {
  constructor(sr, type, freq, Q = 0.707, gainDb = 0) { this.sr = sr; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(type, freq, Q, gainDb); }
  set(type, freq, Q = 0.707, gainDb = 0) {
    const w = TAU * Math.min(freq, this.sr * 0.45) / this.sr, cs = Math.cos(w), sn = Math.sin(w), a = sn / (2 * Math.max(Q, 1e-3));
    let b0, b1, b2, a0, a1, a2;
    if (type === 'highpass') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + a; a1 = -2 * cs; a2 = 1 - a; }
    else if (type === 'bandpass') { b0 = a; b1 = 0; b2 = -a; a0 = 1 + a; a1 = -2 * cs; a2 = 1 - a; }
    else if (type === 'peaking') { const A = Math.pow(10, gainDb / 40); b0 = 1 + a * A; b1 = -2 * cs; b2 = 1 - a * A; a0 = 1 + a / A; a1 = -2 * cs; a2 = 1 - a / A; }
    else { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + a; a1 = -2 * cs; a2 = 1 - a; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/** A decaying mode (two-pole resonator): rings at `freq` with time constant `tau` seconds when driven. Unit peak gain. */
export class Resonator {
  constructor(sr, freq, tau) {
    const r = Math.exp(-1 / (tau * sr)), w = TAU * freq / sr;
    this.c1 = 2 * r * Math.cos(w); this.c2 = -r * r; this.g = (1 - r) * 2 * Math.sin(w); this.y1 = this.y2 = 0;
  }
  process(x) { const y = this.g * x + this.c1 * this.y1 + this.c2 * this.y2; this.y2 = this.y1; this.y1 = y; return y; }
}

// a sine table: the textures add up thousands of blips, Math.sin and Math.exp per sample were far too slow
const SIN_N = 8192, SIN = new Float32Array(SIN_N);
for (let i = 0; i < SIN_N; i++) SIN[i] = Math.sin(i / SIN_N * TAU);

/** Add a damped sine (a drop, a grain of gravel, a pulse) into `out` at sample `at`: amp · sin · exp(-t/tau), with an
 *  optional glide of the frequency (fEnd) and a soft start of `rise` seconds so that it never clicks. Wraps round the
 *  end of the buffer when `wrap` (for seamless loops). */
export function addBlip(out, sr, at, { f, fEnd = f, tau, amp, rise = 0.0004, phase = 0, wrap = false }) {
  const n = Math.min(Math.ceil(tau * 6 * sr), out.length), len = out.length;
  const decay = Math.exp(-1 / (tau * sr)), rs = Math.max(1, rise * sr);
  let ph = (((phase / TAU) % 1) + 1) % 1, df = f / sr;
  const ddf = (fEnd - f) / sr / n;
  let env = amp, j = Math.round(at);
  for (let i = 0; i < n; i++, j++) {
    if (j >= len) { if (!wrap) break; j -= len; }
    if (j >= 0) out[j] += env * (i < rs ? i / rs : 1) * SIN[(ph * SIN_N) | 0];
    ph += df; if (ph >= 1) ph -= 1;
    df += ddf; env *= decay;
  }
}

/** A burst of filtered noise: env(t) = (1 - e^(-t/attack)) · e^(-t/decay), through `filters` (Biquads, in series). */
export function addNoiseBurst(out, sr, at, { attack = 0.004, decay = 0.03, amp = 1, filters = [], rnd = Math.random, length }) {
  const i0 = Math.round(at), n = Math.min(Math.ceil((length ?? (attack + decay * 5.5)) * sr), out.length - Math.max(0, i0));
  // both exponentials step by step (Math.exp per sample made a footstep cost milliseconds)
  const ra = Math.exp(-1 / Math.max(1, attack * sr)), rd = Math.exp(-1 / Math.max(1, decay * sr));
  const nf = filters.length, f0 = filters[0], f1 = filters[1], f2 = filters[2];
  let ea = 1, ed = amp;
  for (let i = 0; i < n; i++) {
    let x = (rnd() * 2 - 1) * (1 - ea) * ed;
    if (nf > 0) { x = f0.process(x); if (nf > 1) { x = f1.process(x); if (nf > 2) x = f2.process(x); } }
    if (i0 + i >= 0) out[i0 + i] += x;
    ea *= ra; ed *= rd;
  }
}

/** Root mean square of a range. */
export function rms(data, from = 0, to = data.length) {
  let s = 0; for (let i = from; i < to; i++) s += data[i] * data[i];
  return Math.sqrt(s / Math.max(1, to - from));
}
/** Scale in place so that the peak is `peak` (no-op for silence). */
export function normalizePeak(data, peak = 0.9) {
  let m = 0; for (let i = 0; i < data.length; i++) m = Math.max(m, Math.abs(data[i]));
  if (m > 0) { const k = peak / m; for (let i = 0; i < data.length; i++) data[i] *= k; }
  return data;
}
/** A one-pole high pass in place (removes the DC a sum of blips may leave). */
export function dcBlock(data, sr, cutoff = 30) {
  const a = Math.exp(-TAU * cutoff / sr); let x1 = 0, y1 = 0;
  for (let i = 0; i < data.length; i++) { const y = data[i] - x1 + a * y1; x1 = data[i]; y1 = y; data[i] = y; }
  return data;
}

/** A mono AudioBuffer from samples. */
export function toBuffer(ctx, data) {
  const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buf.getChannelData(0).set(data);
  return buf;
}
