// Footsteps, one footfall per step, built sample by sample (synth.js) for the surface under the feet. Since 0.9 a
// footfall is a single soft tread, as of soft soles: a muffled low thump (noise through a low pass) that rises over a
// moment and fades, and outdoors a quiet, dark rustle of the ground (gravel and snow give it a gentle, grainy flutter).
// No ringing boards, no grains as clicks, no pings, nothing bright: the earlier steps (a sine thump in 0.6, a strike
// with ringing modes and sine grains until 0.8) sounded hard and squeaked on the garden path.
//   surface: 'wood' (parquet and every wooden floor) | 'carpet' (rugs) | 'cushion' (seats, walked on) |
//            'stone' (stone and tiled floors) | 'deck' (the terrace) | 'jetty' | 'gravel' (the path) | 'pebbles' (the
//            beach) | 'grass' | 'earth' (the trodden trails) | 'snow' | 'ice' (the frozen lake)
import { Biquad, rms, dcBlock, toBuffer, rng } from './synth.js';
import { offthread } from './offthread.js';

// thump: the tread [low pass Hz, attack s, decay s]; rustle: the ground under the sole [centre Hz, Q, amp, decay s,
// grain: how much a slow random flutter roughens it (0 smooth … 1 grainy)]; level: loudness relative to wood
export const SURFACES = {
  wood: { thump: [340, 0.02, 0.07], level: 1.0 },
  carpet: { thump: [210, 0.026, 0.065], level: 0.3 },
  cushion: { thump: [190, 0.03, 0.07], level: 0.24 },
  stone: { thump: [380, 0.018, 0.06], level: 0.8 },
  deck: { thump: [300, 0.02, 0.08], level: 0.9 },
  jetty: { thump: [230, 0.022, 0.1], level: 0.95 },
  gravel: { thump: [280, 0.022, 0.07], rustle: [950, 0.7, 0.32, 0.09, 0.8], level: 0.7 },
  pebbles: { thump: [300, 0.022, 0.07], rustle: [800, 0.7, 0.26, 0.08, 0.6], level: 0.7 },
  grass: { thump: [230, 0.026, 0.075], rustle: [850, 0.6, 0.24, 0.1, 0.25], level: 0.45 },
  earth: { thump: [260, 0.024, 0.07], rustle: [650, 0.6, 0.12, 0.08, 0.3], level: 0.5 },
  snow: { thump: [220, 0.03, 0.12], rustle: [800, 0.6, 0.3, 0.12, 0.7], level: 0.6 },
  ice: { thump: [360, 0.02, 0.065], rustle: [1100, 0.7, 0.1, 0.06, 0.3], level: 0.7 },
};
export const SURFACE_NAMES = Object.keys(SURFACES);
// where puddles stand in the rain (the others only get wet)
const HARD = new Set(['deck', 'jetty', 'gravel', 'pebbles', 'earth', 'stone', 'ice']);
const REF_RMS = 0.0085;  // a walking step on wood, over its loud part (quiet in the mix)
const SOFT_LP = 1800;    // the low pass over every footfall (Hz): nothing of a step is sharp above it

/** Noise shaped by a soft envelope (a raised-cosine rise, an exponential fade), through `filters` (Biquads in series);
 *  `flutter` (0 … 1) roughens it with a slow random amplitude, a grainy but smooth texture. */
function addTread(out, sr, at, { attack, decay, amp, filters, rnd, flutter = 0 }) {
  const i0 = Math.max(0, Math.round(at)), na = Math.max(1, Math.round(attack * sr));
  const n = Math.min(out.length - i0, na + Math.ceil(decay * 6 * sr));
  const rd = Math.exp(-1 / (decay * sr));
  const fl = flutter > 0 ? new Biquad(sr, 'lowpass', 55, 0.7) : null;
  let ed = 1;
  for (let i = 0; i < n; i++) {
    const rise = i < na ? 0.5 - 0.5 * Math.cos(Math.PI * i / na) : 1;
    if (i >= na) ed *= rd;
    let x = rnd() * 2 - 1;
    for (const f of filters) x = f.process(x);
    const g = fl ? 1 - flutter + flutter * Math.min(2.5, 3 * Math.abs(fl.process(rnd() * 2 - 1))) : 1;
    out[i0 + i] += amp * rise * ed * g * x;
  }
}

/**
 * The samples of one footfall.
 * @param o { surface, run, speed (m/s), landing (a jump ends), impact (m/s at the landing), wet (0 … 1: rain on the
 *          ground), seed (for a reproducible step; random otherwise) }
 */
export function stepSamples(sr, o = {}) {
  const S = SURFACES[o.surface] || SURFACES.wood;
  const rnd = o.seed != null ? rng(o.seed) : Math.random;
  const R = (a, b) => a + rnd() * (b - a);
  const out = new Float32Array(Math.ceil(sr * 0.45));
  const speed = Math.max(0.3, o.speed || (o.run ? 4.2 : 2.4));
  const landing = !!o.landing, run = !landing && (o.run || speed > 3.4);
  // a run treads quicker and shorter, a landing a little heavier and longer
  const tempo = landing ? 1.25 : run ? 0.75 : 1;
  const force = landing ? 1.2 + Math.min(0.35, (o.impact || 0) * 0.06) : run ? 1 : Math.min(0.95, 0.6 + 0.1 * speed);
  const t0 = 0.004;

  const [lp, attack, decay] = S.thump;
  addTread(out, sr, t0 * sr, { attack: attack * R(0.85, 1.2) * (run ? 0.8 : 1), decay: decay * R(0.85, 1.15) * tempo, amp: 1, rnd,
    filters: [new Biquad(sr, 'lowpass', lp * R(0.85, 1.15), 0.6), new Biquad(sr, 'lowpass', lp * 1.6, 0.6), new Biquad(sr, 'highpass', 45, 0.7)] });
  if (S.rustle) {
    const [f, Q, a, d, grain] = S.rustle;
    addTread(out, sr, (t0 + R(0.004, 0.012)) * sr, { attack: attack * 1.4, decay: d * R(0.85, 1.2) * tempo, amp: a, rnd, flutter: grain,
      filters: [new Biquad(sr, 'bandpass', f * R(0.85, 1.15), Q), new Biquad(sr, 'lowpass', f * 2, 0.6)] });
  }
  // rain: a soft, dark splash on hard ground, a damp squelch in the grass and the snow
  const wet = Math.max(0, Math.min(1, o.wet || 0));
  if (wet > 0) {
    const hard = HARD.has(o.surface);
    addTread(out, sr, (t0 + 0.006) * sr, { attack: 0.012, decay: hard ? 0.08 : 0.06, amp: wet * (hard ? 0.22 : 0.16), rnd, flutter: 0.5,
      filters: [new Biquad(sr, 'bandpass', hard ? R(800, 1100) : R(450, 650), 0.8), new Biquad(sr, 'lowpass', 1600, 0.6)] });
  }
  dcBlock(out, sr, 40);
  { const soft = new Biquad(sr, 'lowpass', SOFT_LP, 0.5); for (let i = 0; i < out.length; i++) out[i] = soft.process(out[i]); }
  // the loudness of the step: a walking step on wood is the reference, the others follow their level and the force
  const loud = rms(out, 0, Math.min(out.length, Math.round(sr * 0.22)));
  if (loud > 0) { const g = REF_RMS * S.level * force / loud; for (let i = 0; i < out.length; i++) out[i] *= g; }
  // never a click at the very start or a cut at the end
  const fade = Math.round(sr * 0.05);
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  return out;
}

// ---- a few steps made ahead, in the sound worker
// A footfall takes a millisecond or two to make: while walking that would land in the middle of a frame. So every kind
// of step (surface, gait, wet or dry) keeps a few made ahead in the sound worker (offthread.js; without a worker in idle
// time); each one is played once and replaced by a new one, so no two steps are the same. Only a step of a kind that
// was never asked for before is made on the spot.
const POOL = 3;
const pools = new Map();   // key → { o, list: Float32Array[], filling }
const gaitOf = (o) => (o.landing ? 'land' : o.run || (o.speed || 2.4) > 3.4 ? 'run' : (o.speed || 2.4) < 1.6 ? 'slow' : 'walk');
const GAIT = { land: { landing: true, impact: 3 }, run: { run: true, speed: 4.2 }, walk: { speed: 2.4 }, slow: { speed: 1.3 } };
const idle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 400 }) : setTimeout(fn, 30));
function poolFor(sr, o) {
  const gait = gaitOf(o), wet = o.wet > 0.05 ? 1 : 0, surface = SURFACES[o.surface] ? o.surface : 'wood';
  const key = sr + ':' + surface + ':' + gait + ':' + wet;
  let p = pools.get(key);
  if (!p) pools.set(key, p = { o: { surface, wet, ...GAIT[gait] }, list: [], filling: false, sr });
  return p;
}
function refill(p) {
  if (p.filling || p.list.length >= POOL) return;
  p.filling = true;
  offthread({ type: 'steps', sr: p.sr, o: p.o, n: POOL - p.list.length }).then((r) => {
    if (r?.list) { p.filling = false; p.list.push(...r.list.slice(0, POOL - p.list.length)); return; }
    idle(() => { p.filling = false; if (p.list.length < POOL) { p.list.push(stepSamples(p.sr, p.o)); refill(p); } });
  });
}
/** Make a few steps of this kind ahead (the soundscape calls it for the ground you stand on). */
export function warmSteps(sr, o) { refill(poolFor(sr, o)); }

/** Play a footfall at `t` into `dest` (Web Audio; offline contexts too: made on the spot, reproducible with o.seed). */
export function playStep(ctx, dest, t, o = {}) {
  let data;
  const pooled = typeof ctx.startRendering !== 'function' && o.seed == null;
  if (!pooled) data = stepSamples(ctx.sampleRate, o);
  else { const p = poolFor(ctx.sampleRate, o); data = p.list.shift() || stepSamples(ctx.sampleRate, p.o); refill(p); }
  const src = ctx.createBufferSource();
  src.buffer = toBuffer(ctx, data);
  // the force of the step follows the pace, a landing the speed of the fall (the pool's steps are made for their gait)
  const gait = gaitOf(o);
  const pace = !pooled ? 1 : gait === 'walk' || gait === 'slow' ? Math.min(1.2, Math.max(0.8, (0.6 + 0.1 * (o.speed || 2.4)) / (0.6 + 0.1 * GAIT[gait].speed)))
    : gait === 'land' ? (1.2 + Math.min(0.35, (o.impact || 0) * 0.06)) / (1.2 + 3 * 0.06) : 1;
  const g = ctx.createGain(); g.gain.value = Math.max(0, Math.min(2, (o.gain ?? 1) * pace));
  src.playbackRate.value = 0.98 + Math.random() * 0.04;
  src.connect(g); g.connect(dest);
  src.start(t);
  return { end: t + src.buffer.duration };
}
