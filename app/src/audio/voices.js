// The voices of the garden, synthesised with Web Audio nodes (they work in offline contexts too): songbirds (blackbird,
// robin, great tit, chaffinch, chiffchaff, wren, wood pigeon, house sparrow, carrion crow, cuckoo), the tawny owl at
// night, water frogs and tree frogs at the lake, a mallard and a moorhen on the water, and the lapping of the water at
// the shore and the jetty. A bird sings with one oscillator whose pitch and loudness follow the syllables of its phrase
// (with a few overtones and a vibrato for trills); the frogs and the water birds are pulsed buzzes shaped by formant
// filters. Each call: (ctx, dest, t, opts) → duration in seconds. `opts.rnd`: the random source (Math.random), `opts.seed`
// picks one individual's song (its motifs come back from phrase to phrase, as with a real bird).
import { gainNode, filterNode, noiseSource, rng } from './dsp.js';

const shapers = new WeakMap();
/** A fixed wave shaper that adds a 2nd and 3rd harmonic to a sine (Chebyshev polynomials), cached per context. */
function overtones(ctx, h2, h3 = 0) {
  let m = shapers.get(ctx); if (!m) shapers.set(ctx, m = new Map());
  const key = h2.toFixed(2) + ':' + h3.toFixed(2);
  if (!m.has(key)) {
    const n = 1025, curve = new Float32Array(n), norm = 1 + h2 + h3;
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = (x + h2 * (2 * x * x - 1) + h3 * (4 * x * x * x - 3 * x)) / norm; }
    const ws = { curve }; m.set(key, ws);
  }
  const sh = ctx.createWaveShaper(); sh.curve = m.get(key).curve; sh.oversample = 'none';
  return sh;
}

/**
 * Sing a phrase: syllables [{ t (s from the start), d (duration), f: [Hz, …] (the pitch contour, evenly spread over the
 * syllable), a (0 … 1), att (attack, s), vib: [rate Hz, depth Hz] }]. One oscillator, its pitch and loudness automated;
 * breath: a share of band-passed noise in the same envelope (pigeons, crows, owls); lp: a low pass over the voice.
 * Returns the end time.
 */
export function sing(ctx, dest, t, sylls, { harm = 0.06, harm3 = 0, wave = 'sine', breath = 0, breathF = 800, formants = null, lp = 0, gain = 1 } = {}) {
  const o = ctx.createOscillator(); o.type = wave;
  const pre = gainNode(ctx, 1), env = gainNode(ctx, 0), out = gainNode(ctx, gain);
  let src = o;
  if (wave === 'sine' && (harm > 0 || harm3 > 0)) { const sh = overtones(ctx, harm, harm3); o.connect(sh); src = sh; }
  if (formants) {
    // a harsh voice through the resonances of the throat (crow, duck, frog)
    for (const [f, q, g] of formants) { const bp = filterNode(ctx, 'bandpass', f, q), fg = gainNode(ctx, g); src.connect(bp); bp.connect(fg); fg.connect(pre); }
  } else src.connect(pre);
  let end = t, nz = null;
  if (breath > 0) {
    const last = sylls.reduce((m, s) => Math.max(m, s.t + s.d), 0);
    nz = noiseSource(ctx, 'pink', t, { dur: last + 0.1 });
    const bp = filterNode(ctx, 'bandpass', breathF, 1.1), bg = gainNode(ctx, breath);
    nz.connect(bp); bp.connect(bg); bg.connect(pre);
  }
  if (lp) { const f = filterNode(ctx, 'lowpass', lp, 0.7); pre.connect(f); f.connect(env); } else pre.connect(env);
  env.connect(out); out.connect(dest);
  const vib = ctx.createOscillator(), vg = gainNode(ctx, 0); vib.connect(vg); vg.connect(o.frequency);
  const fq = o.frequency, eg = env.gain;
  fq.setValueAtTime(sylls[0]?.f[0] || 1000, t);
  for (const s of sylls) {
    const a = t + s.t, d = Math.max(0.012, s.d), att = Math.min(d * 0.4, s.att ?? Math.min(0.012, d * 0.25)), rel = Math.min(d * 0.4, s.rel ?? Math.min(0.025, d * 0.3));
    const f = s.f;
    fq.setValueAtTime(f[0], a);
    for (let k = 1; k < f.length; k++) fq.linearRampToValueAtTime(f[k], a + d * k / (f.length - 1));
    // (ramps only: a jump of the loudness in the middle of a note is a click)
    eg.setValueAtTime(0, a);
    eg.linearRampToValueAtTime(s.a, a + att);
    eg.linearRampToValueAtTime(s.a * (s.sustain ?? 0.85), a + d - rel);
    eg.linearRampToValueAtTime(0, a + d);
    if (s.vib) { vib.frequency.setValueAtTime(s.vib[0], a); vg.gain.setValueAtTime(s.vib[1], a); vg.gain.setValueAtTime(0, a + d); }
    end = Math.max(end, a + d);
  }
  o.start(t); o.stop(end + 0.05); vib.start(t); vib.stop(end + 0.05);
  if (nz) { try { nz.stop(end + 0.05); } catch (e) { /* already set */ } }
  return end;
}

/**
 * A pulsed call (frog, moorhen): the voice is gated into pulses `rate` per second; returns the end time.
 * calls: [{ t, d, a, f0, f1 (pitch at the end), rate }]
 */
function pulsed(ctx, dest, t, calls, { wave = 'sawtooth', formants, lp = 3500, duty = 0.55, gain = 1 }) {
  const o = ctx.createOscillator(); o.type = wave;
  const pre = gainNode(ctx, 1), env = gainNode(ctx, 0), lpf = filterNode(ctx, 'lowpass', lp, 0.7), out = gainNode(ctx, gain);
  for (const [f, q, g] of formants) { const bp = filterNode(ctx, 'bandpass', f, q), fg = gainNode(ctx, g); o.connect(bp); bp.connect(fg); fg.connect(pre); }
  pre.connect(lpf); lpf.connect(env); env.connect(out); out.connect(dest);
  let end = t;
  o.frequency.setValueAtTime(calls[0]?.f0 || 200, t);
  for (const c of calls) {
    const a = t + c.t, n = Math.max(1, Math.round(c.d * c.rate)), per = c.d / n;
    o.frequency.setValueAtTime(c.f0, a); o.frequency.linearRampToValueAtTime(c.f1 ?? c.f0, a + c.d);
    for (let k = 0; k < n; k++) {
      // the call swells in and fades out, every pulse opens fast and closes a little slower
      const u = (k + 0.5) / n, shape = Math.min(1, u / 0.25, (1 - u) / 0.2 + 0.25), p = a + k * per;
      env.gain.setValueAtTime(0, p);
      env.gain.linearRampToValueAtTime(c.a * shape, p + per * 0.18);
      env.gain.linearRampToValueAtTime(0, p + per * duty);
    }
    end = Math.max(end, a + c.d);
  }
  o.start(t); o.stop(end + 0.05);
  return end;
}

// ---------------------------------------------------------------------------------------------------- songbirds ------
const between = (r, a, b) => a + r() * (b - a);
const pick = (r, list) => list[Math.floor(r() * list.length)];

/** Each species: (individual random, phrase random) → { sylls, opts }. The individual's random (seeded) fixes its
 *  pitch and motifs; the phrase random varies a phrase a little. */
const SPECIES = {
  // fluting, low, unhurried phrases of slurred notes, mostly ending in a quieter, squeaky twitter
  blackbird(ind, r) {
    const base = between(ind, 1550, 2050), motif = rng(Math.floor(ind() * 1e9) + Math.floor(r() * 4));
    const s = []; let t = 0;
    for (let i = 0, n = 4 + Math.floor(motif() * 4); i < n; i++) {
      const d = between(motif, 0.12, 0.32), f0 = base * between(motif, 0.8, 1.38), kind = Math.floor(motif() * 5);
      // a slur up or down, an arch, a dip, or a held note that turns at its end
      const up = between(motif, 1.12, 1.4), dn = between(motif, 0.72, 0.9);
      const f = kind === 0 ? [f0, f0 * (1 + (up - 1) * 0.7), f0 * up] : kind === 1 ? [f0 * up, f0 * (1 + (up - 1) * 0.4), f0] : kind === 2 ? [f0, f0 * up, f0 * up * 0.98, f0 * 0.94] : kind === 3 ? [f0, f0 * dn, f0 * 1.04] : [f0, f0 * 1.01, f0 * 1.01, f0 * up];
      s.push({ t, d: d * between(r, 0.93, 1.07), f: f.map((x) => x * between(r, 0.985, 1.015)), a: between(r, 0.65, 1), vib: motif() < 0.35 ? [between(motif, 14, 24), f0 * between(motif, 0.015, 0.03)] : null, att: 0.025, rel: 0.04 });
      t += d + between(motif, 0.035, 0.1);
    }
    if (r() < 0.75) {
      t += between(r, 0.02, 0.07);
      for (let j = 0, n = 4 + Math.floor(r() * 6); j < n; j++) { const f0 = between(r, 4200, 7000); s.push({ t, d: between(r, 0.02, 0.045), f: [f0, f0 * between(r, 0.78, 1.18)], a: between(r, 0.18, 0.38), att: 0.005, rel: 0.008 }); t += between(r, 0.035, 0.06); }
    }
    return { sylls: s, opts: { harm: 0.05, gain: 0.85 } };
  },
  // thin, high, wistful: a long note or two, then quick notes jumping up and down
  robin(ind, r) {
    const s = []; let t = 0, hi = between(ind, 0.92, 1.08);
    for (let i = 0, n = 1 + Math.floor(r() * 2); i < n; i++) { const f0 = between(r, 6000, 7800) * hi; s.push({ t, d: between(r, 0.08, 0.16), f: [f0, f0 * between(r, 0.9, 0.98)], a: between(r, 0.5, 0.8), att: 0.015 }); t += between(r, 0.1, 0.18); }
    for (let i = 0, n = 6 + Math.floor(r() * 11); i < n; i++) {
      const f0 = between(r, 2600, 8000) * hi, d = between(r, 0.02, 0.11), trill = r() < 0.2;
      s.push({ t, d, f: [f0, f0 * between(r, 0.75, 1.3), f0 * between(r, 0.85, 1.15)], a: between(r, 0.45, 1), vib: trill ? [between(r, 40, 60), between(r, 250, 500)] : null, att: 0.005, rel: 0.008 });
      t += d + between(r, 0.008, 0.05);
    }
    return { sylls: s, opts: { harm: 0.02, gain: 0.7 } };
  },
  // "ti-ta ti-ta ti-ta": a high and a lower note, again and again
  greattit(ind, r) {
    const hi = between(ind, 5400, 6300), lo = between(ind, 3100, 3600), three = ind() < 0.3;
    const s = []; let t = 0;
    for (let i = 0, n = 3 + Math.floor(r() * 5); i < n; i++) {
      s.push({ t, d: 0.07, f: [hi * 1.03, hi * 0.95], a: 0.85, att: 0.006, rel: 0.012 }); t += 0.07 + between(r, 0.03, 0.045);
      if (three) { s.push({ t, d: 0.06, f: [hi * 1.02, hi * 0.95], a: 0.75, att: 0.006, rel: 0.012 }); t += 0.06 + 0.035; }
      s.push({ t, d: 0.1, f: [lo * 1.02, lo * 0.97], a: 0.95, att: 0.008, rel: 0.015 }); t += 0.1 + between(r, 0.06, 0.09);
    }
    return { sylls: s, opts: { harm: 0.05, gain: 0.75 } };
  },
  // a falling, quickening trill in three runs and a flourish at the end
  chaffinch(ind, r) {
    const s = []; let t = 0;
    const runs = [[between(ind, 4800, 5500), 0.09, 4 + Math.floor(r() * 3)], [between(ind, 3700, 4200), 0.072, 4 + Math.floor(r() * 3)], [between(ind, 2900, 3300), 0.06, 3 + Math.floor(r() * 2)]];
    for (const [f0, step, n] of runs) for (let i = 0; i < n; i++) { const f = f0 * (1 - i * 0.012); s.push({ t, d: step * 0.55, f: [f * 1.12, f * 0.86], a: between(r, 0.7, 0.95), att: 0.004, rel: 0.008 }); t += step; }
    t += 0.02;
    const e = between(ind, 2400, 2800);
    s.push({ t, d: between(r, 0.28, 0.36), f: [e, e * 1.75, e * 1.4, e * 0.85], a: 1, att: 0.02 });
    return { sylls: s, opts: { harm: 0.04, gain: 0.75 } };
  },
  // "zilp zalp zilp zilp zalp"
  chiffchaff(ind, r) {
    const hi = between(ind, 5400, 6300), lo = between(ind, 4300, 4800), s = []; let t = 0;
    for (let i = 0, n = 6 + Math.floor(r() * 9); i < n; i++) {
      const up = r() < 0.55;
      s.push({ t, d: between(r, 0.09, 0.12), f: up ? [hi * 1.08, hi * 0.78] : [lo * 1.05, lo * 0.82], a: between(r, 0.75, 0.95), att: 0.006, rel: 0.02 });
      t += between(r, 0.3, 0.38);
    }
    return { sylls: s, opts: { harm: 0.03, gain: 0.7 } };
  },
  // a long, loud, fast rattle of notes with a trill in the middle
  wren(ind, r) {
    const s = []; let t = 0, hi = between(ind, 0.94, 1.06);
    const notes = (n, rate, lo, hi2, a) => { for (let i = 0; i < n; i++) { const f0 = between(r, lo, hi2) * hi; s.push({ t, d: 0.75 / rate, f: [f0 * 1.1, f0 * 0.9], a: a * between(r, 0.8, 1), att: 0.003, rel: 0.006 }); t += 1 / rate; } };
    notes(6 + Math.floor(r() * 6), between(r, 11, 14), 3800, 7600, 0.75);
    const ta = between(r, 4200, 5200), tb = ta * between(r, 1.2, 1.4);
    for (let i = 0, n = 14 + Math.floor(r() * 12); i < n; i++) { s.push({ t, d: 0.026, f: [i % 2 ? tb : ta, i % 2 ? tb * 0.95 : ta * 1.05], a: 0.85, att: 0.002, rel: 0.005 }); t += 0.038; }
    notes(5 + Math.floor(r() * 6), between(r, 10, 13), 3500, 7800, 0.7);
    return { sylls: s, opts: { harm: 0.02, gain: 0.8 } };
  },
  // "hoo-HOOO-hoo, hoo-hoo", soft and breathy, two or three times
  pigeon(ind, r) {
    const f0 = between(ind, 420, 520), s = []; let t = 0;
    for (let k = 0, n = 2 + Math.floor(r() * 2); k < n; k++) {
      for (const [d, a, rise, gap] of [[0.2, 0.55, 1.03, 0.08], [0.48, 1, 1.07, 0.12], [0.22, 0.7, 1.02, 0.1], [0.2, 0.6, 1.02, 0.07], [0.24, 0.65, 0.98, 0.0]]) {
        s.push({ t, d, f: [f0 * 0.96, f0 * rise, f0 * 0.95], a, att: 0.05, rel: 0.07 }); t += d + gap;
      }
      t += between(r, 0.5, 0.8);
    }
    return { sylls: s, opts: { harm: 0.2, breath: 0.12, breathF: f0 * 1.6, lp: 1600, gain: 0.6 } };
  },
  // "tschilp": quick chirps, a few birds in the hedge by the house
  sparrow(ind, r) {
    const s = []; let t = 0, k = between(ind, 0.9, 1.1);
    for (let i = 0, n = 4 + Math.floor(r() * 7); i < n; i++) {
      const f0 = between(r, 3300, 4300) * k;
      s.push({ t, d: between(r, 0.05, 0.09), f: [f0 * 0.9, f0 * 1.3, f0 * 0.85], a: between(r, 0.6, 1), att: 0.004, rel: 0.012 });
      t += between(r, 0.12, 0.45);
    }
    return { sylls: s, opts: { harm: 0.25, harm3: 0.1, gain: 0.55 } };
  },
  // "krah, krah, krah": hoarse and loud, from far off
  crow(ind, r) {
    const f0 = between(ind, 380, 470), s = []; let t = 0;
    for (let i = 0, n = 2 + Math.floor(r() * 3); i < n; i++) { const d = between(r, 0.26, 0.38); s.push({ t, d, f: [f0 * 1.05, f0 * 1.1, f0 * 0.92], a: between(r, 0.8, 1), att: 0.03, rel: 0.08, vib: [70, 35] }); t += d + between(r, 0.35, 0.55); }
    return { sylls: s, opts: { wave: 'sawtooth', formants: [[1150, 3, 1], [2300, 4, 0.6]], breath: 0.35, breathF: 1400, lp: 3800, gain: 0.55 } };
  },
  // "cu-ckoo" from the edge of the wood, again and again (spring)
  cuckoo(ind, r) {
    const a0 = between(ind, 640, 720), s = []; let t = 0;
    for (let i = 0, n = 5 + Math.floor(r() * 8); i < n; i++) {
      s.push({ t, d: 0.17, f: [a0 * 1.02, a0 * 0.97], a: 0.95, att: 0.035, rel: 0.05 });
      s.push({ t: t + 0.27, d: 0.29, f: [a0 * 0.81, a0 * 0.78], a: 0.85, att: 0.04, rel: 0.09 });
      t += between(r, 0.92, 1.08);
    }
    return { sylls: s, opts: { harm: 0.08, gain: 0.55 } };
  },
};
export const BIRDS = Object.keys(SPECIES);

/** One phrase of a songbird into dest at t. opts: { species, seed (the individual), rnd, gain }. Returns the duration. */
export function birdPhrase(ctx, dest, t, { species = 'blackbird', seed = 1, rnd = Math.random, gain = 1 } = {}) {
  const make = SPECIES[species] || SPECIES.blackbird;
  const { sylls, opts } = make(rng(seed), rnd);
  return sing(ctx, dest, t, sylls, { ...opts, gain: (opts.gain ?? 1) * gain }) - t;
}

// ---------------------------------------------------------------------------------------------------- the night -----
/** The tawny owl: the male's "huuu … hu, hu-hu-hu-huuuuu", now and then the female's "ke-wick". */
export function owlCall(ctx, dest, t, { rnd = Math.random, gain = 1, female = false, seed = 7 } = {}) {
  const ind = rng(seed), f0 = between(ind, 560, 640);
  if (female) {
    const s = [{ t: 0, d: 0.08, f: [1350, 1700], a: 0.8, att: 0.01 }, { t: 0.13, d: 0.26, f: [1950, 2050, 1500], a: 1, att: 0.015, rel: 0.06 }];
    return sing(ctx, dest, t, s, { harm: 0.35, harm3: 0.15, breath: 0.1, breathF: 1800, lp: 5000, gain: 0.55 * gain }) - t;
  }
  const s = [{ t: 0, d: 0.6, f: [f0 * 0.93, f0 * 1.02, f0 * 0.95], a: 0.85, att: 0.06, rel: 0.12 }];
  let t2 = 0.6 + between(rnd, 2.2, 3.6);
  s.push({ t: t2, d: 0.14, f: [f0, f0 * 0.98], a: 0.6, att: 0.02, rel: 0.04 }); t2 += 0.36;
  for (let i = 0; i < 3; i++) { s.push({ t: t2, d: 0.08, f: [f0 * 1.01, f0 * 0.99], a: 0.65, att: 0.015, rel: 0.03 }); t2 += 0.15; }
  s.push({ t: t2, d: between(rnd, 0.9, 1.15), f: [f0 * 1.02, f0, f0 * 0.94], a: 0.95, att: 0.04, rel: 0.2, vib: [between(rnd, 8, 11), f0 * 0.035] });
  return sing(ctx, dest, t, s, { harm: 0.1, breath: 0.07, breathF: f0 * 1.5, lp: 1800, gain: 0.7 * gain }) - t;
}

/** A water frog's bout: a few croaking "quarr"s, each a buzz chopped into pulses. */
export function frogBout(ctx, dest, t, { rnd = Math.random, gain = 1, seed = 3 } = {}) {
  const ind = rng(seed), f0 = between(ind, 150, 230), rate = between(ind, 34, 52), f1 = between(ind, 720, 950), f2 = between(ind, 1450, 1800);
  const calls = []; let at = 0;
  for (let i = 0, n = 2 + Math.floor(rnd() * 6); i < n; i++) {
    const long = rnd() < 0.4, d = long ? between(rnd, 0.5, 0.8) : between(rnd, 0.18, 0.34);
    calls.push({ t: at, d, a: between(rnd, 0.7, 1), f0: f0 * between(rnd, 0.97, 1.03), f1: f0 * between(rnd, 0.92, 1.0), rate: rate * between(rnd, 0.92, 1.08) });
    at += d + between(rnd, 0.12, 0.4);
  }
  return pulsed(ctx, dest, t, calls, { wave: 'sawtooth', formants: [[f1, 4, 1], [f2, 5, 0.55], [f0 * 2, 2, 0.35]], lp: 3200, duty: 0.6, gain: 0.9 * gain }) - t;
}
/** A tree frog in spring: a quick, loud "äpp-äpp-äpp" for a couple of seconds. */
export function treeFrog(ctx, dest, t, { rnd = Math.random, gain = 1, seed = 5 } = {}) {
  const ind = rng(seed), f0 = between(ind, 950, 1150), calls = []; let at = 0;
  for (let i = 0, n = 8 + Math.floor(rnd() * 10); i < n; i++) { calls.push({ t: at, d: 0.09, a: between(rnd, 0.75, 1), f0, f1: f0 * 0.97, rate: 105 }); at += between(rnd, 0.17, 0.21); }
  // the second harmonic carries it, near 2 kHz
  return pulsed(ctx, dest, t, calls, { wave: 'sawtooth', formants: [[f0 * 2, 4, 1], [f0 * 3, 4, 0.3]], lp: 4500, duty: 0.5, gain: 1.4 * gain }) - t;
}

// ---------------------------------------------------------------------------------------------------- the lake ------
/** A mallard: the female's falling "QUACK-quack-quack-quack", or the drake's quiet raspy "raeb". */
export function duckCall(ctx, dest, t, { rnd = Math.random, gain = 1, seed = 9 } = {}) {
  const ind = rng(seed), drake = rnd() < 0.3, s = []; let at = 0;
  if (drake) {
    const f0 = between(ind, 200, 240);
    for (let i = 0, n = 1 + Math.floor(rnd() * 3); i < n; i++) { s.push({ t: at, d: between(rnd, 0.18, 0.26), f: [f0 * 1.04, f0 * 0.92], a: 0.8, att: 0.02, rel: 0.05 }); at += between(rnd, 0.35, 0.6); }
    return sing(ctx, dest, t, s, { wave: 'sawtooth', formants: [[900, 3, 1], [2000, 4, 0.4]], breath: 0.9, breathF: 1300, lp: 3500, gain: 0.9 * gain }) - t;
  }
  const f0 = between(ind, 290, 340);
  for (let i = 0, n = 4 + Math.floor(rnd() * 5); i < n; i++) {
    const k = Math.pow(0.86, i), d = (i === 0 ? 0.22 : 0.15) * Math.max(0.65, k);
    s.push({ t: at, d, f: [f0 * Math.pow(0.97, i) * 1.06, f0 * Math.pow(0.97, i) * 0.88], a: k, att: 0.012, rel: 0.05 });
    at += d + between(rnd, 0.07, 0.12);
  }
  return sing(ctx, dest, t, s, { wave: 'sawtooth', formants: [[1150, 3, 1], [2450, 4, 0.6], [600, 2, 0.3]], breath: 0.35, breathF: 1600, lp: 4000, gain: 1.1 * gain }) - t;
}
/** A moorhen: a sudden gurgling "krrruk", or a run of "kik-kik-kik". */
export function moorhenCall(ctx, dest, t, { rnd = Math.random, gain = 1 } = {}) {
  if (rnd() < 0.6) {
    const f0 = between(rnd, 780, 950);
    return pulsed(ctx, dest, t, [{ t: 0, d: between(rnd, 0.18, 0.26), a: 1, f0, f1: f0 * 0.78, rate: between(rnd, 38, 48) }], { wave: 'sawtooth', formants: [[1300, 2, 1], [2600, 3, 0.4]], lp: 3800, duty: 0.7, gain: 0.5 * gain }) - t;
  }
  const s = []; let at = 0;
  for (let i = 0, n = 3 + Math.floor(rnd() * 4); i < n; i++) { const f = between(rnd, 1500, 1750); s.push({ t: at, d: 0.045, f: [f, f * 0.88], a: 0.9, att: 0.004, rel: 0.012 }); at += between(rnd, 0.11, 0.15); }
  return sing(ctx, dest, t, s, { harm: 0.35, harm3: 0.2, gain: 0.45 * gain }) - t;
}
/** Water lapping at the shore (and against the posts of the jetty: `hollow`). */
export function waterLap(ctx, dest, t, { rnd = Math.random, gain = 1, hollow = false } = {}) {
  const d = between(rnd, 0.3, 0.55), n = noiseSource(ctx, 'pink', t, { dur: d + 0.2 });
  const bp = filterNode(ctx, 'bandpass', 260, 1.1), lp = filterNode(ctx, 'lowpass', 1500, 0.7), g = ctx.createGain();
  bp.frequency.setValueAtTime(between(rnd, 220, 300), t); bp.frequency.linearRampToValueAtTime(between(rnd, 420, 620), t + d * 0.45); bp.frequency.linearRampToValueAtTime(260, t + d);
  const a = between(rnd, 0.5, 1) * gain, at = between(rnd, 0.06, 0.14);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + at); g.gain.setTargetAtTime(0, t + at, d * 0.35);
  n.connect(bp); bp.connect(lp); lp.connect(g); g.connect(dest);
  if (hollow && rnd() < 0.6) {
    // the wave knocks softly under the boards
    const c = noiseSource(ctx, 'pink', t + at, { dur: 0.12 }), cb = filterNode(ctx, 'bandpass', between(rnd, 160, 240), 2.5), cg = ctx.createGain();
    cg.gain.setValueAtTime(0, t + at); cg.gain.linearRampToValueAtTime(a * 0.8, t + at + 0.01); cg.gain.setTargetAtTime(0, t + at + 0.01, 0.03);
    c.connect(cb); cb.connect(cg); cg.connect(dest);
  }
  if (rnd() < 0.35) {
    // a small gulp of water
    const o = ctx.createOscillator(), og = ctx.createGain(), s0 = t + at * 0.8;
    o.frequency.setValueAtTime(between(rnd, 170, 230), s0); o.frequency.exponentialRampToValueAtTime(between(rnd, 320, 420), s0 + 0.05);
    og.gain.setValueAtTime(0, s0); og.gain.linearRampToValueAtTime(a * 0.12, s0 + 0.008); og.gain.setTargetAtTime(0, s0 + 0.01, 0.015);
    o.connect(og); og.connect(dest); o.start(s0); o.stop(s0 + 0.12);
  }
  return d + 0.2;
}
