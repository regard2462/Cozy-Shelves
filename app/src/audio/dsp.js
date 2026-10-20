// Shared Web Audio helpers: cached noise buffers & impulse responses (generated once per context),
// small envelope / node helpers and a seedable PRNG. Everything works with AudioContext *and* OfflineAudioContext.

const store = new WeakMap(); // BaseAudioContext -> { noise: {}, ir: {} }
function cacheFor(ctx) { let s = store.get(ctx); if (!s) { s = { noise: {}, ir: {} }; store.set(ctx, s); } return s; }

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const lerp = (a, b, x) => a + (b - a) * x;

/** mulberry32 – deterministic PRNG, returns () => [0,1) */
export function rng(seed = Date.now()) {
  let a = seed >>> 0;
  return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const rand = (r, lo = 0, hi = 1) => lo + r() * (hi - lo);
export const randInt = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
export const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
/** weighted pick from [[value, weight], …] */
export function weighted(r, table) {
  let sum = 0; for (const [, w] of table) sum += w;
  let x = r() * sum;
  for (const [v, w] of table) { x -= w; if (x <= 0) return v; }
  return table[table.length - 1][0];
}

/** Looping noise buffer (mono). kind: 'white' | 'pink' | 'brown'. Generated once per context and kind. */
export function noiseBuffer(ctx, kind = 'white', seconds = 4) {
  const c = cacheFor(ctx); const key = kind + ':' + seconds;
  if (c.noise[key]) return c.noise[key];
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  if (kind === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856; b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
  } else if (kind === 'brown') {
    let last = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
  } else {
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  // normalise to peak 0.95 and fade the loop seam
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  const k = peak ? 0.95 / peak : 1; for (let i = 0; i < n; i++) d[i] *= k;
  const seam = Math.min(2048, n >> 2);
  for (let i = 0; i < seam; i++) { const x = i / seam; d[i] *= x; d[n - 1 - i] *= x; }
  c.noise[key] = buf; return buf;
}

/** Exponentially decaying noise impulse response (stereo, warm), normalised to unit energy per channel. `length` (s,
 *  at most `seconds`): only the first part of the response, faded out over its last quarter (the same tone and decay;
 *  a phone's convolution reverb costs about half at half the length: engine.js, soundscape.js). */
export function impulseResponse(ctx, { seconds = 3, decay = 2.5, tone = 0.3, early = true, length = seconds } = {}) {
  const c = cacheFor(ctx); const key = [seconds, decay, tone, early, length].join(':');
  if (c.ir[key]) return c.ir[key];
  const cut = Math.min(length, seconds) < seconds;
  const sr = ctx.sampleRate, n = Math.floor(sr * Math.min(length, seconds));
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.exp(-decay * t) * Math.min(1, t / 0.004);
      const x = (Math.random() * 2 - 1) * env;
      const coef = tone * (1 - 0.7 * t / seconds); // darker over time
      y += coef * (x - y);
      d[i] = y;
    }
    if (early) { // a few discrete early reflections
      for (let k = 0; k < 6; k++) { const at = Math.floor(sr * (0.008 + Math.random() * 0.05)); if (at < n) d[at] += (Math.random() * 0.6 + 0.2) * (Math.random() < 0.5 ? -1 : 1) * 0.5; }
    }
    if (cut) { const f = Math.floor(n / 4); for (let i = 0; i < f; i++) d[n - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / f); }
    let e = 0; for (let i = 0; i < n; i++) e += d[i] * d[i];
    const k = e ? 1 / Math.sqrt(e) : 1; for (let i = 0; i < n; i++) d[i] *= k;
  }
  c.ir[key] = buf; return buf;
}

/** BufferSource over a cached noise buffer. Returns the node (already started). */
export function noiseSource(ctx, kind, t, { dur = 0, loop = false, rate = 1 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, kind);
  src.loop = loop;
  src.playbackRate.value = rate;
  const offset = Math.random() * Math.max(0, src.buffer.duration - (dur || 0) - 0.05);
  src.start(t, offset);
  if (!loop && dur) src.stop(t + dur);
  return src;
}

export function gainNode(ctx, value = 1) { const g = ctx.createGain(); g.gain.value = value; return g; }
export function filterNode(ctx, type, freq, Q = 1, gain = 0) { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = Q; if (gain) f.gain.value = gain; return f; }
export function osc(ctx, type, freq, t, detune = 0) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; if (detune) o.detune.value = detune; o.start(t); return o; }
/** LFO: oscillator → gain(depth) → param. Returns {osc, gain}. */
export function lfo(ctx, param, rate, depth, t, type = 'sine') { const o = osc(ctx, type, rate, t); const g = gainNode(ctx, depth); o.connect(g); g.connect(param); return { osc: o, gain: g }; }
export function chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }

/** Percussive envelope: linear attack to peak, exponential-ish decay with time constant tau (setTargetAtTime). */
export function percEnv(param, t, peak, attack, tau) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.setTargetAtTime(0, t + attack, tau);
}
/** Sustained envelope: attack → (decay to sustain) → hold until t+dur → release (tau). Returns stop time. */
export function adsrEnv(param, t, { peak = 1, a = 0.01, d = 0, s = 1, dur = 1, rTau = 0.2 }) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  if (d > 0 && s < 1) param.setTargetAtTime(peak * s, t + a, d / 3);
  const off = Math.max(t + a + 0.005, t + dur);
  param.setTargetAtTime(0, off, rTau);
  return off + rTau * 5;
}
/** Smooth ramp of a param to a value (setTargetAtTime), robust against overlapping automation. */
export function rampTo(param, value, t, seconds = 0.5) {
  try { param.cancelScheduledValues(t); } catch (e) { /* ignore */ }
  param.setTargetAtTime(value, t, Math.max(0.005, seconds / 4));
}
/** Linear fade with explicit start value (for crossfades). */
export function fadeTo(param, value, t, seconds = 2) {
  try { param.cancelScheduledValues(t); } catch (e) { /* ignore */ }
  param.setValueAtTime(param.value, t);
  param.linearRampToValueAtTime(value, t + seconds);
}
