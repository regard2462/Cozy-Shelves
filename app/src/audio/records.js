// Procedural "records": small rule-based composers. Each generator schedules ahead of time in bars:
//   gen.start(t) · gen.scheduleUntil(t) · gen.stop(t) · gen.dispose()
// The same generators run in a live AudioContext (fed by the engine's lookahead ticker) and in an
// OfflineAudioContext (scheduleUntil(seconds) once, then render).
import { rng, randInt, pick, weighted, gainNode, fadeTo, filterNode, noiseSource, lfo } from './dsp.js';
import { Harmony, Melodist, MODES, PENTATONIC, scaleNotes, voiceLead, pcInRange, pcNear, swing } from './theory.js';
import * as I from './instruments.js';

const FADE = 2; // seconds, crossfade between records

export const RECORD_DEFS = [
  { id: 'nocturne', title: 'Nocturne', artist: { de: 'Filzklavier', en: 'Felt piano' }, hue: 32, mood: 'warm' },
  { id: 'regentag', title: 'Regentag', artist: { de: 'Pads & Glocken', en: 'Pads & bells' }, hue: 205, mood: 'cool' },
  { id: 'kaminjazz', title: 'Kaminjazz', artist: { de: 'Trio am Kamin', en: 'Fireside trio' }, hue: 12, mood: 'ember' },
  { id: 'winterlicht', title: 'Winterlicht', artist: { de: 'Spieluhr & Bordun', en: 'Music box & drone' }, hue: 220, mood: 'pale' },
  { id: 'meeresstille', title: 'Meeresstille', artist: { de: 'Bordun & Brandung', en: 'Drone & surf' }, hue: 185, mood: 'sea' },
  { id: 'stille', title: 'Stille', artist: { de: 'Nur die Geräusche ringsum', en: 'Only the sounds around you' }, hue: 40, mood: 'none', silent: true },
];

class RecordGen {
  constructor(ctx, dest, { bpm = 60, beats = 4, seed } = {}) {
    this.ctx = ctx;
    this.r = rng(seed ?? Math.floor(Math.random() * 1e9));
    this.bpm = bpm; this.beats = beats;
    this.beat = 60 / bpm; this.bar = this.beat * beats;
    this.out = gainNode(ctx, 0); this.out.connect(dest);
    this.nextTime = 0; this.started = false; this.stopped = false; this.barNo = 0;
  }
  start(t) { this.started = true; this.nextTime = t + 0.05; fadeTo(this.out.gain, 1, t, FADE); this.onStart?.(t); }
  scheduleUntil(t) {
    if (!this.started || this.stopped) return;
    let guard = 0;
    while (this.nextTime < t && guard++ < 400) { const next = this.genBar(this.nextTime, this.barNo++); this.nextTime = next ?? (this.nextTime + this.bar); }
  }
  stop(t, fade = FADE) { this.stopped = true; fadeTo(this.out.gain, 0, t, fade); this.onStop?.(t + fade); return t + fade; }
  dispose() { try { this.out.disconnect(); } catch (e) { /* */ } }
  bt(t, beat) { return t + beat * this.beat; } // beat offset → absolute time
}

// ---------------------------------------------------------------- Nocturne
class Nocturne extends RecordGen {
  constructor(ctx, dest, opts) {
    super(ctx, dest, { bpm: 56, ...opts });
    const r = this.r;
    const major = r() < 0.75;
    const rootPc = pick(r, major ? [1, 3, 5, 8, 10] : [9, 2, 4, 7]);   // Db Eb F Ab Bb  |  a d e g
    this.mode = major ? 'major' : 'minor';
    this.harmony = new Harmony(r, { rootPc, mode: this.mode, seventh: 0.45, ninth: 0.15, allowDom7: false });
    this.rootPc = rootPc;
    const dia = scaleNotes(rootPc, MODES[this.mode], 65, 86);
    const penta = scaleNotes(rootPc, PENTATONIC[major ? 'major' : 'minor'], 65, 86);
    this.scales = { dia, penta };
    this.melody = new Melodist(r, { notes: penta, rhythm: [[1, 4], [2, 3], [1.5, 2], [0.5, 1.2], [3, 1]], rest: 0.14, phrase: [2, 4], gap: [1, 2], velocity: [0.4, 0.68], legato: 0.92 });
    this.chord = null; this.chordBarsLeft = 0; this.voicing = null; this.lastBass = null;
  }
  genBar(t, n) {
    const r = this.r, b = this.beats;
    if (this.chordBarsLeft <= 0) {
      this.chord = this.harmony.next();
      this.chordBarsLeft = r() < 0.6 ? 2 : 1;
      this.voicing = voiceLead(this.voicing, this.chord.pcs, 50, 66);
      this.melody.setNotes(r() < 0.6 ? this.scales.penta : this.scales.dia);
      this.pattern = weighted(r, [['block', 3], ['arp', 3], ['sparse', 2]]);
      this.chordStart = true;
    } else this.chordStart = false;
    const c = this.chord, v = this.voicing;
    const chordDur = this.bar * this.chordBarsLeft;
    // pedal bass
    if (this.chordStart) {
      const bm = this.lastBass == null ? pcInRange(c.rootPc, 36, 47) : pcNear(c.rootPc, this.lastBass);
      this.lastBass = Math.min(47, Math.max(34, bm));
      I.feltPiano(this.ctx, this.out, { t, midi: this.lastBass, dur: chordDur * 0.95, vel: 0.5 + r() * 0.1 });
      if (r() < 0.35) I.feltPiano(this.ctx, this.out, { t: this.bt(t, 2 + (r() < 0.5 ? 0 : 0.5)), midi: this.lastBass + 7, dur: chordDur * 0.5, vel: 0.35 });
    }
    // left hand accompaniment
    const acc = (beat, notes, vel, dur) => notes.forEach((m, i) => I.feltPiano(this.ctx, this.out, { t: this.bt(t, beat) + i * 0.02, midi: m, dur, vel }));
    if (this.pattern === 'block') {
      if (this.chordStart) acc(0, v, 0.32 + r() * 0.1, this.bar * 0.9);
      else if (r() < 0.5) acc(0, v, 0.25, this.bar * 0.8);
      if (r() < 0.4) acc(2 + (r() < 0.5 ? 0.5 : 0), v.slice(0, 2), 0.22, this.bar * 0.4);
    } else if (this.pattern === 'arp') {
      const order = r() < 0.7 ? v : [...v].reverse();
      const beatsAt = pick(r, [[0, 1, 2, 3], [0, 1.5, 2, 3.5], [0, 0.5, 1, 2, 3], [0, 1, 2.5, 3]]);
      beatsAt.forEach((bt, i) => { if (r() < 0.9) I.feltPiano(this.ctx, this.out, { t: this.bt(t, bt), midi: order[i % order.length], dur: this.beat * 1.6, vel: 0.24 + r() * 0.12 }); });
    } else {
      if (this.chordStart || r() < 0.5) acc(0, [v[0], v[v.length - 1]], 0.3, this.bar * 0.9);
      if (r() < 0.7) acc(2.5, v.slice(1, 3), 0.22, this.beat * 1.5);
    }
    // melody
    for (const e of this.melody.bar(b, c.pcs)) I.feltPiano(this.ctx, this.out, { t: this.bt(t, e.beat), midi: e.midi, dur: e.dur * this.beat, vel: e.vel });
    this.chordBarsLeft--;
    return t + this.bar;
  }
}

// ---------------------------------------------------------------- Regentag
class Regentag extends RecordGen {
  constructor(ctx, dest, opts) {
    super(ctx, dest, { bpm: 52, ...opts });
    const r = this.r;
    const rootPc = pick(r, [2, 4, 7, 9, 0]);
    this.harmony = new Harmony(r, { rootPc, mode: 'dorian', seventh: 0.6, ninth: 0.3 });
    const notes = scaleNotes(rootPc, PENTATONIC.minor, 74, 93);
    this.melody = new Melodist(r, { notes, rhythm: [[2, 3], [3, 2], [4, 2], [1, 1], [1.5, 1]], rest: 0.35, phrase: [1, 2], gap: [2, 4], velocity: [0.3, 0.55], motif: 0.4 });
    this.chordBarsLeft = 0; this.voicing = null; this.chord = null;
  }
  genBar(t, n) {
    const r = this.r;
    if (this.chordBarsLeft <= 0) {
      this.chord = this.harmony.next();
      this.chordBarsLeft = 2;
      this.voicing = voiceLead(this.voicing, this.chord.pcs, 48, 67);
      const dur = this.bar * 2;
      this.voicing.forEach((m, i) => I.pad(this.ctx, this.out, { t: t + i * 0.15, midi: m, dur, vel: 0.55 + r() * 0.15, attack: 3.5 + r(), release: 4.5 }));
      I.sub(this.ctx, this.out, { t, midi: pcInRange(this.chord.rootPc, 36, 47), dur, vel: 0.6, attack: 2.5, release: 3.5, gain: 0.09 });
    }
    for (const e of this.melody.bar(this.beats, this.chord.pcs)) I.bell(this.ctx, this.out, { t: this.bt(t, e.beat), midi: e.midi, vel: e.vel, decay: 3 + r() * 1.5, ratio: r() < 0.5 ? 3.5 : 2, index: 0.7, gain: 0.07 });
    if (r() < 0.25) I.bell(this.ctx, this.out, { t: this.bt(t, randInt(r, 0, 3) + 0.5), midi: pick(r, this.voicing) + 12, vel: 0.3, decay: 4, ratio: 2, index: 0.5, gain: 0.04 });
    this.chordBarsLeft--;
    return t + this.bar;
  }
}

// ---------------------------------------------------------------- Kaminjazz
class Kaminjazz extends RecordGen {
  constructor(ctx, dest, opts) {
    super(ctx, dest, { bpm: 64, ...opts });
    const r = this.r;
    const rootPc = pick(r, [5, 10, 3, 8, 0]);
    this.harmony = new Harmony(r, { rootPc, mode: 'major', chain: 'jazz', seventh: 1, ninth: 0.6, allowDom7: true });
    this.upcoming = this.harmony.next();
    const notes = scaleNotes(rootPc, MODES.major, 70, 89);
    this.melody = new Melodist(r, { notes, rhythm: [[1, 3], [0.5, 3], [2, 2], [1.5, 1], [3, 1]], rest: 0.25, phrase: [2, 4], gap: [2, 5], velocity: [0.3, 0.5], legato: 0.85 });
    this.voicing = null; this.lastBass = null;
    // gentle tremolo on the e-piano bus
    this.epiano = gainNode(ctx, 0.55); this.epiano.connect(this.out);
    this.trem = lfo(ctx, this.epiano.gain, 0.9, 0.12, ctx.currentTime);
    this.brushes = gainNode(ctx, 1); this.brushes.connect(this.out);
  }
  onStop(t) { this.trem.osc.stop(t + 0.5); }
  genBar(t, n) {
    const r = this.r, sw = (b) => this.bt(t, swing(b, 0.62));
    const split = r() < 0.15;
    const segs = split ? [{ at: 0, len: 2 }, { at: 2, len: 2 }] : [{ at: 0, len: 4 }];
    let barChord = this.upcoming;
    for (const seg of segs) {
      const chord = this.upcoming; this.upcoming = this.harmony.next();
      barChord = chord;
      const nextRoot = this.upcoming.rootPc;
      this.voicing = voiceLead(this.voicing, chord.pcs.slice(chord.pcs.length > 4 ? 1 : 0), 55, 76); // rootless when 9th present
      const v = this.voicing;
      // comping
      const hits = [];
      if (r() < 0.92) hits.push({ b: seg.at, vel: 0.36 + r() * 0.1 });
      if (seg.len === 4) {
        if (r() < 0.45) hits.push({ b: seg.at + 1.5, vel: 0.28 + r() * 0.1 });
        if (r() < 0.35) hits.push({ b: seg.at + 3, vel: 0.25 + r() * 0.1 });
        if (r() < 0.2) hits.push({ b: seg.at + 2.5, vel: 0.22 });
      }
      hits.sort((a, b) => a.b - b.b);
      hits.forEach((h, i) => {
        const end = i + 1 < hits.length ? hits[i + 1].b : seg.at + seg.len;
        const dur = Math.max(0.3, (end - h.b) * this.beat - 0.08);
        v.forEach((m, k) => I.rhodes(this.ctx, this.epiano, { t: sw(h.b) + k * 0.012 * (r() < 0.5 ? 1 : 0), midi: m, dur, vel: h.vel * (0.9 + r() * 0.2) }));
      });
      // bass: 1 root, 3 fifth/third, walking on 2 & 4 sometimes
      const rootM = this.lastBass == null ? pcInRange(chord.rootPc, 36, 47) : Math.min(48, Math.max(33, pcNear(chord.rootPc, this.lastBass)));
      this.lastBass = rootM;
      const third = rootM + chord.semis[1], fifth = rootM + 7;
      const bn = (b, m, vel, len = 1) => I.bass(this.ctx, this.out, { t: sw(b), midi: m, dur: this.beat * len * 0.9, vel, gain: 0.14 });
      bn(seg.at, rootM, 0.6 + r() * 0.1, r() < 0.5 ? 2 : 1);
      if (seg.len === 4) {
        if (r() < 0.5) bn(seg.at + 1, r() < 0.5 ? third : rootM + 2, 0.4);
        bn(seg.at + 2, r() < 0.6 ? fifth : third, 0.5 + r() * 0.1, r() < 0.5 ? 2 : 1);
        if (r() < 0.6) { const target = pcNear(nextRoot, rootM); bn(seg.at + 3, r() < 0.5 ? target - 1 : target + (r() < 0.5 ? 1 : 7), 0.42); }
      } else if (r() < 0.6) bn(seg.at + 1, fifth, 0.42);
    }
    // brushes: quiet swish on 2 & 4, ticks on the beat
    for (let b = 0; b < 4; b++) {
      if (r() < 0.85) I.brush(this.ctx, this.brushes, { t: sw(b), dur: 0.12, vel: 0.35 + r() * 0.2, kind: 'tick', gain: 0.012 });
      if (b % 2 === 1 && r() < 0.9) I.brush(this.ctx, this.brushes, { t: sw(b) - 0.05, dur: this.beat * 0.9, vel: 0.5 + r() * 0.3, kind: 'swish', gain: 0.016 });
      if (r() < 0.3) I.brush(this.ctx, this.brushes, { t: sw(b + 0.5), dur: 0.08, vel: 0.3, kind: 'tick', gain: 0.008 });
    }
    // sparse e-piano line on top
    for (const e of this.melody.bar(this.beats, barChord.pcs)) I.rhodes(this.ctx, this.epiano, { t: sw(e.beat), midi: e.midi, dur: e.dur * this.beat, vel: e.vel, gain: 0.1 });
    return t + this.bar;
  }
}

// ---------------------------------------------------------------- Winterlicht
class Winterlicht extends RecordGen {
  constructor(ctx, dest, opts) {
    super(ctx, dest, { bpm: 58, ...opts });
    const r = this.r;
    const rootPc = pick(r, [9, 2, 4, 7, 11]);
    this.rootPc = rootPc;
    this.harmony = new Harmony(r, { rootPc, mode: 'minor', seventh: 0.3 });
    this.scales = { dia: scaleNotes(rootPc, MODES.minor, 79, 96), penta: scaleNotes(rootPc, PENTATONIC.minor, 79, 96) };
    this.melody = new Melodist(r, { notes: this.scales.penta, rhythm: [[1, 3], [2, 3], [0.5, 1], [3, 1], [1.5, 1]], rest: 0.2, phrase: [2, 4], gap: [1, 3], velocity: [0.3, 0.55], legato: 1 });
    this.chordBarsLeft = 0; this.voicing = null; this.chord = null; this.droneUntil = 0;
  }
  genBar(t, n) {
    const r = this.r;
    if (t + this.bar * 2 > this.droneUntil) { // renew the tonic drone in overlapping 24-bar chunks
      const dur = this.bar * 12;
      const root = pcInRange(this.rootPc, 43, 54);
      I.drone(this.ctx, this.out, { t, midi: root, dur, vel: 0.7, attack: this.droneUntil ? 6 : 3, release: 6, gain: 0.07 });
      I.drone(this.ctx, this.out, { t: t + 1, midi: root + 7, dur: dur - 1, vel: 0.45, attack: 8, release: 6, gain: 0.05 });
      this.droneUntil = t + dur - 6;
    }
    if (this.chordBarsLeft <= 0) {
      this.chord = this.harmony.next();
      this.chordBarsLeft = 2;
      this.voicing = voiceLead(this.voicing, this.chord.pcs, 72, 86);
      this.arpPattern = weighted(r, [['up', 3], ['updown', 2], ['random', 2], ['none', 1]]);
      this.melody.setNotes(r() < 0.6 ? this.scales.penta : this.scales.dia);
      this.density = 0.4 + r() * 0.25;
    }
    const v = this.voicing, seq = this.arpPattern === 'updown' ? [...v, ...v.slice(1, -1).reverse()] : v;
    if (this.arpPattern !== 'none') {
      for (let s = 0; s < 8; s++) {
        if (r() > this.density) continue;
        const m = this.arpPattern === 'random' ? pick(r, v) : seq[(n * 8 + s) % seq.length];
        I.musicBox(this.ctx, this.out, { t: this.bt(t, s * 0.5), midi: m, vel: 0.25 + r() * 0.15, gain: 0.07 });
      }
    }
    for (const e of this.melody.bar(this.beats, this.chord.pcs)) I.musicBox(this.ctx, this.out, { t: this.bt(t, e.beat), midi: e.midi, vel: e.vel, gain: 0.09 });
    this.chordBarsLeft--;
    return t + this.bar;
  }
}

// ---------------------------------------------------------------- Meeresstille
class Meeresstille extends RecordGen {
  constructor(ctx, dest, opts) {
    super(ctx, dest, { bpm: 60, ...opts }); // "bar" = 4 s scheduling chunk
    const r = this.r;
    const rootPc = pick(r, [3, 5, 10, 0, 8]);
    this.harmony = new Harmony(r, { rootPc, mode: 'lydian', seventh: 0.5 });
    this.nextChord = 0; this.voicing = null; this.chord = null; this.nextSwell = 0;
  }
  onStart(t) {
    // distant surf: brown noise, slowly breathing lowpass + gain
    const n = noiseSource(this.ctx, 'brown', t, { loop: true });
    const lp = filterNode(this.ctx, 'lowpass', 520, 0.5);
    const g = gainNode(this.ctx, 0.22);
    n.connect(lp); lp.connect(g); g.connect(this.out);
    // (the two oscillators of the breathing are stopped with the record: started and never stopped, every record change
    // left them running in the context for good)
    const lfos = [lfo(this.ctx, lp.frequency, 0.045, 300, t), lfo(this.ctx, g.gain, 0.06, 0.09, t + 3)];
    this.surf = { n, lp, g, lfos };
  }
  onStop(t) { try { this.surf.n.stop(t + 0.5); for (const l of this.surf.lfos) l.osc.stop(t + 0.5); } catch (e) { /* */ } }
  genBar(t, n) {
    const r = this.r;
    if (t >= this.nextChord) {
      this.chord = this.harmony.next();
      const hold = 16 + r() * 14;
      this.voicing = voiceLead(this.voicing, this.chord.pcs, 45, 64);
      this.voicing.forEach((m, i) => I.seaDrone(this.ctx, this.out, { t: t + i * 0.8, midi: m, dur: hold, vel: 0.55, attack: 8, release: 10, gain: 0.05 }));
      I.sub(this.ctx, this.out, { t, midi: pcInRange(this.chord.rootPc, 33, 44), dur: hold, vel: 0.6, attack: 7, release: 8, gain: 0.08 });
      this.nextChord = t + hold - 4;
    }
    if (r() < 0.3 && this.voicing) { // high shimmering harmonic
      const m = pick(r, this.voicing) + 24 + (r() < 0.5 ? 0 : 12);
      I.sub(this.ctx, this.out, { t: t + r() * 3, midi: Math.min(96, m), dur: 5 + r() * 4, vel: 0.5, attack: 3, release: 4, gain: 0.03 });
    }
    if (t >= this.nextSwell) { // a wave washing in
      const dur = 5 + r() * 4;
      const ns = noiseSource(this.ctx, 'pink', t, { dur: dur + 1 });
      const lp = filterNode(this.ctx, 'lowpass', 900 + r() * 700, 0.4);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.045 + r() * 0.03, t + dur * 0.45); g.gain.linearRampToValueAtTime(0, t + dur);
      lp.frequency.setValueAtTime(lp.frequency.value, t); lp.frequency.linearRampToValueAtTime(lp.frequency.value * 1.8, t + dur * 0.4); lp.frequency.linearRampToValueAtTime(400, t + dur);
      ns.connect(lp); lp.connect(g); g.connect(this.out);
      this.nextSwell = t + dur + 3 + r() * 8;
    }
    return t + this.bar;
  }
}

const CLASSES = { nocturne: Nocturne, regentag: Regentag, kaminjazz: Kaminjazz, winterlicht: Winterlicht, meeresstille: Meeresstille };

export function createRecordGen(id, ctx, dest, opts) {
  const C = CLASSES[id];
  return C ? new C(ctx, dest, opts) : null;
}
export const isProceduralRecord = (id) => !!CLASSES[id];
