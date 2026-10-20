// Music theory helpers for the generative records: scales, functional-harmony Markov chains,
// diatonic chord building, voice leading and a small rule-based melody generator.
import { clamp, weighted, randInt, pick } from './dsp.js';

export const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};
export const PENTATONIC = { major: [0, 2, 4, 7, 9], minor: [0, 3, 5, 7, 10] };

// Markov chains over 0-based scale degrees: degree -> [[nextDegree, weight], …]. Only consonant
// (non-diminished) chords are reachable, so the harmony can never turn sour.
export const CHAINS = {
  major: { 0: [[3, 3], [5, 3], [1, 2], [4, 2], [2, 1]], 1: [[4, 4], [3, 1], [2, 1]], 2: [[5, 3], [3, 2], [1, 1]], 3: [[0, 3], [4, 2], [1, 2], [5, 1]], 4: [[0, 4], [5, 2], [3, 1]], 5: [[3, 3], [1, 2], [4, 2], [2, 1]] },
  jazz: { 0: [[5, 3], [1, 3], [3, 2], [2, 1]], 1: [[4, 5], [2, 1]], 2: [[5, 3], [3, 1], [1, 1]], 3: [[1, 3], [4, 1], [2, 1], [0, 1]], 4: [[0, 5], [5, 2], [2, 1]], 5: [[1, 4], [3, 2], [4, 1]] },
  minor: { 0: [[5, 3], [3, 3], [2, 2], [6, 2], [4, 1]], 2: [[5, 2], [3, 2], [6, 2], [0, 1]], 3: [[0, 3], [4, 1], [5, 2], [6, 1]], 4: [[0, 3], [5, 2]], 5: [[3, 2], [6, 2], [2, 2], [0, 2]], 6: [[0, 3], [2, 1], [5, 1]] },
  dorian: { 0: [[3, 3], [6, 2], [1, 2], [2, 1], [4, 1]], 1: [[0, 2], [3, 2], [4, 1]], 2: [[3, 2], [6, 1], [0, 1]], 3: [[0, 3], [6, 1], [1, 1]], 4: [[0, 2], [3, 1]], 6: [[0, 3], [3, 1], [1, 1]] },
  lydian: { 0: [[1, 3], [5, 2], [2, 2], [4, 1]], 1: [[0, 3], [5, 1], [4, 1]], 2: [[0, 2], [5, 2], [1, 1]], 4: [[0, 3], [5, 1]], 5: [[1, 2], [0, 2], [2, 1], [4, 1]] },
};

/** All midi notes of a scale between lo and hi (inclusive), ascending. */
export function scaleNotes(rootPc, intervals, lo, hi) {
  const out = [];
  for (let m = lo; m <= hi; m++) if (intervals.includes(((m - rootPc) % 12 + 12) % 12)) out.push(m);
  return out;
}

/**
 * Harmony: walks a Markov chain of scale degrees and builds diatonic chords.
 *   opts: { rootPc, mode: 'major'|'minor'|'dorian'|'lydian', chain?, seventh: prob, ninth: prob, allowDom7: bool }
 *   next() -> { degree, rootPc, pcs: [pitch classes], semis: [semitones above chord root] }
 */
export class Harmony {
  constructor(rnd, opts) {
    this.r = rnd; this.o = opts;
    this.scale = MODES[opts.mode] || MODES.major;
    this.chain = CHAINS[opts.chain || opts.mode] || CHAINS.major;
    this.degree = 0;
    this.count = 0;
  }
  chord(degree) {
    const s = this.scale;
    const semis = [0];
    const at = (k) => { const idx = degree + 2 * k; return s[idx % 7] + 12 * Math.floor(idx / 7) - s[degree]; };
    const third = at(1), fifth = at(2), seventh = at(3), ninth = at(4);
    semis.push(third, fifth);
    const o = this.o;
    let has7 = false;
    if (o.seventh && this.r() < o.seventh) {
      const dominant = third === 4 && seventh === 10;
      if (!dominant || o.allowDom7) { semis.push(seventh); has7 = true; }
    }
    if (has7 && o.ninth && this.r() < o.ninth && ninth % 12 === 2) semis.push(ninth);
    const rootPc = (this.o.rootPc + s[degree]) % 12;
    return { degree, rootPc, semis, pcs: semis.map((x) => (rootPc + x) % 12) };
  }
  next() {
    // occasional return to the tonic so the harmony keeps a centre
    const opts = this.chain[this.degree] || this.chain[0];
    this.degree = this.count > 0 && this.count % 8 === 7 && this.r() < 0.5 ? 0 : weighted(this.r, opts);
    this.count++;
    return this.chord(this.degree);
  }
}

/** Lowest midi note with pitch class pc in [lo, hi]. */
export function pcInRange(pc, lo, hi) { for (let m = lo; m <= hi; m++) if (((m % 12) + 12) % 12 === pc) return m; return lo; }
/** Midi note with pitch class pc closest to ref. */
export function pcNear(pc, ref) { let best = ref, bd = 99; for (let m = ref - 11; m <= ref + 11; m++) if (((m % 12) + 12) % 12 === pc && Math.abs(m - ref) < bd) { bd = Math.abs(m - ref); best = m; } return best; }

/**
 * Voice leading: choose one octave for every pitch class so the voicing lies inside [lo, hi],
 * moves as little as possible from `prev` and avoids muddy close intervals in the low register.
 */
export function voiceLead(prev, pcs, lo, hi) {
  const cands = pcs.map((pc) => { const arr = []; for (let m = lo; m <= hi; m++) if (m % 12 === pc) arr.push(m); return arr.length ? arr : [pcInRange(pc, lo - 12, hi + 12)]; });
  const centre = (lo + hi) / 2;
  let best = null, bestCost = Infinity;
  const combo = new Array(pcs.length);
  const walk = (i) => {
    if (i === pcs.length) {
      const v = [...combo].sort((a, b) => a - b);
      let cost = 0;
      for (let k = 1; k < v.length; k++) { const iv = v[k] - v[k - 1]; if (iv === 0) cost += 50; else if (iv === 1) cost += 8; else if (iv === 2 && v[k] < 60) cost += 4; else if (iv <= 4 && v[k] < 52) cost += 3; }
      if (v[v.length - 1] - v[0] > 19) cost += 4;
      if (prev && prev.length) {
        for (const n of v) { let d = 99; for (const p of prev) d = Math.min(d, Math.abs(n - p)); cost += d; }
        for (const p of prev) { let d = 99; for (const n of v) d = Math.min(d, Math.abs(n - p)); cost += d * 0.5; }
      } else cost += Math.abs(v.reduce((a, b) => a + b, 0) / v.length - centre) * 0.5;
      if (cost < bestCost) { bestCost = cost; best = v; }
      return;
    }
    for (const m of cands[i]) { combo[i] = m; walk(i + 1); }
  };
  walk(0);
  return best || [];
}

/**
 * Rule-based melody generator working on an ordered list of scale notes.
 *   opts: { notes: [midi…], rhythm: [[beats, weight]…], rest: prob, phrase: [minBars, maxBars], gap: [minBars, maxBars],
 *           legato: 0..1, velocity: [lo, hi], strongSnap: prob, motif: prob }
 * bar(beats, chordPcs) -> [{ beat, dur, midi, vel }]  (beat offsets inside the bar)
 */
export class Melodist {
  constructor(rnd, opts) {
    this.r = rnd; this.o = { rest: 0.15, phrase: [2, 4], gap: [1, 2], legato: 0.95, velocity: [0.4, 0.7], strongSnap: 0.75, motif: 0.35, ...opts };
    this.notes = this.o.notes;
    this.idx = Math.floor(this.notes.length * 0.45);
    this.phraseLeft = 0; this.gapLeft = randInt(rnd, 0, 1); this.barInPhrase = 0;
    this.motif = null; this.rec = []; this.replay = null; this.phraseStartIdx = this.idx;
  }
  setNotes(notes) { const m = this.notes[this.idx]; this.notes = notes; this.idx = clamp(nearestIndex(notes, m), 0, notes.length - 1); }
  isChordTone(i, pcs) { return pcs.includes(((this.notes[i] % 12) + 12) % 12); }
  nearestChordIdx(i, pcs, dir = 0) {
    for (let k = 0; k <= 4; k++) {
      const order = dir >= 0 ? [i + k, i - k] : [i - k, i + k];
      for (const j of order) if (j >= 0 && j < this.notes.length && this.isChordTone(j, pcs)) return j;
    }
    return i;
  }
  bar(beats, chordPcs, opts = {}) {
    const r = this.r, o = this.o, n = this.notes.length;
    if (this.gapLeft > 0) { this.gapLeft--; return []; }
    if (this.phraseLeft === 0) {
      this.replay = this.motif && r() < o.motif ? this.motif : null;
      this.phraseLeft = this.replay ? this.replay.bars : randInt(r, o.phrase[0], o.phrase[1]);
      this.barInPhrase = 0; this.rec = [];
      if (this.replay) this.idx = clamp(this.replay.startIdx + randInt(r, -3, 3), 2, n - 3);
      this.phraseStartIdx = this.idx;
    }
    const events = [];
    const lastBar = this.phraseLeft === 1;
    if (this.replay) {
      for (const e of this.replay.events) if (e.bar === this.barInPhrase) {
        let i = clamp(this.phraseStartIdx + e.off, 0, n - 1);
        if (e.beat % 2 === 0 && !this.isChordTone(i, chordPcs) && r() < o.strongSnap) i = this.nearestChordIdx(i, chordPcs);
        this.idx = i;
        events.push({ beat: e.beat, dur: e.dur, midi: this.notes[i], vel: e.vel * (0.9 + r() * 0.2) });
      }
    } else {
      let pos = this.barInPhrase === 0 && r() < 0.35 ? (r() < 0.5 ? 1 : 0.5) : 0;
      let lastIdx = this.idx;
      while (pos < beats - 0.01) {
        let dur = weighted(r, o.rhythm);
        if (pos + dur > beats) dur = beats - pos;
        if (r() < o.rest && !(pos === 0 && this.barInPhrase === 0)) { pos += dur; continue; }
        const strong = pos % 2 === 0;
        const gravity = clamp(0.5 + ((n - 1) / 2 - this.idx) / n, 0.15, 0.85); // pull towards the centre of the range
        const x = r();
        let i = this.idx;
        if (x < 0.55) i += r() < gravity ? 1 : -1;
        else if (x < 0.75) i += (r() < gravity ? 1 : -1) * randInt(r, 2, 3);
        else if (x < 0.85) i = this.idx;
        else i = this.nearestChordIdx(i + (r() < gravity ? 2 : -2), chordPcs);
        i = clamp(i, 0, n - 1);
        if (strong && !this.isChordTone(i, chordPcs) && r() < o.strongSnap) i = this.nearestChordIdx(i, chordPcs, i - lastIdx);
        if (i === lastIdx && r() < 0.5) i = clamp(i + (r() < gravity ? 1 : -1), 0, n - 1);
        lastIdx = i; this.idx = i;
        const vel = o.velocity[0] + r() * (o.velocity[1] - o.velocity[0]) + (strong ? 0.08 : 0);
        const ev = { beat: pos, dur, midi: this.notes[i], vel };
        events.push(ev);
        this.rec.push({ bar: this.barInPhrase, beat: pos, dur, off: i - this.phraseStartIdx, vel });
        pos += dur;
      }
      if (lastBar && events.length) { // let the phrase breathe: the final note rings on
        const last = events[events.length - 1];
        last.dur = beats - last.beat + (r() < 0.5 ? 2 : 0);
        this.rec[this.rec.length - 1].dur = last.dur;
      }
    }
    for (const e of events) e.dur *= o.legato;
    this.barInPhrase++; this.phraseLeft--;
    if (this.phraseLeft === 0) {
      if (!this.replay && this.rec.length >= 3) this.motif = { bars: this.barInPhrase, startIdx: this.phraseStartIdx, events: this.rec };
      this.gapLeft = randInt(r, o.gap[0], o.gap[1]);
    }
    return events;
  }
}
function nearestIndex(arr, m) { let bi = 0, bd = 999; arr.forEach((v, i) => { const d = Math.abs(v - m); if (d < bd) { bd = d; bi = i; } }); return bi; }

/** Swing: shift off-beat eighths (x.5) later. amount 0.5 = straight, 0.66 = triplet feel. */
export function swing(beat, amount = 0.62) { const frac = beat - Math.floor(beat); return Math.abs(frac - 0.5) < 0.01 ? Math.floor(beat) + amount : beat; }

export { pick, randInt };
