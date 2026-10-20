// Audio clean-up for read-aloud: pure functions on Float32Array samples (no DOM, testable in Node).
//
// Every engine starts and ends a sentence with its own amount of silence (Piper 40 to 300 ms, Kokoro about 300 ms)
// and speaks at its own level (Pavoque peaks at 0.15, Martin at 0.9). The client trims each piece to the speech,
// fades the edges (no click at a join), levels the loudness smoothly from piece to piece and then puts pauses of a
// fixed length between pieces and sentences, so that every voice reads with the same rhythm and volume.

export const TRIM_KEEP_LEAD = 0.03;    // seconds of silence kept before the first sound
export const TRIM_KEEP_TAIL = 0.07;    // and after the last one (consonants and breath fade out slowly)
export const FADE_IN = 0.004;
export const FADE_OUT = 0.012;
export const TARGET_LEVEL = 0.075;     // RMS of the voiced part (about -22.5 dBFS)
export const MAX_PEAK = 0.95;

/**
 * RMS per 10 ms frame and the threshold that separates speech from silence (relative to the loudest frame,
 * with an absolute floor for pieces that are silent altogether).
 */
function frames(samples, sampleRate) {
  const size = Math.max(1, Math.round(sampleRate * 0.01));
  const rms = new Float32Array(Math.ceil(samples.length / size));
  let loudest = 0;
  for (let f = 0; f < rms.length; f++) {
    let s = 0;
    const a = f * size, b = Math.min(samples.length, a + size);
    for (let i = a; i < b; i++) s += samples[i] * samples[i];
    rms[f] = Math.sqrt(s / Math.max(1, b - a));
    if (rms[f] > loudest) loudest = rms[f];
  }
  return { size, rms, threshold: Math.max(0.004, loudest * 0.04) };
}

/**
 * Trims leading and trailing silence (keeping a little of it), fades the edges and measures the piece.
 * @returns {{ samples: Float32Array, level: number, peak: number, lead: number, tail: number }}
 *   level = RMS of the voiced frames, lead/tail = seconds of silence that were removed
 */
export function cleanPiece(samples, sampleRate) {
  const n = samples?.length || 0;
  if (!n) return { samples: new Float32Array(0), level: 0, peak: 0, lead: 0, tail: 0 };
  const { size, rms, threshold } = frames(samples, sampleRate);
  let first = -1, last = -1;
  for (let f = 0; f < rms.length; f++) if (rms[f] > threshold) { if (first < 0) first = f; last = f; }
  if (first < 0) return { samples: new Float32Array(0), level: 0, peak: 0, lead: n / sampleRate, tail: 0 };
  const a = Math.max(0, first * size - Math.round(TRIM_KEEP_LEAD * sampleRate));
  const b = Math.min(n, (last + 1) * size + Math.round(TRIM_KEEP_TAIL * sampleRate));
  const out = samples.slice(a, b);
  const fi = Math.min(out.length >> 1, Math.round(FADE_IN * sampleRate));
  const fo = Math.min(out.length >> 1, Math.round(FADE_OUT * sampleRate));
  for (let i = 0; i < fi; i++) out[i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / fi);
  for (let i = 0; i < fo; i++) out[out.length - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / fo);
  let sum = 0, count = 0, peak = 0;
  for (let f = first; f <= last; f++) if (rms[f] > threshold) { sum += rms[f] * rms[f]; count++; }
  for (let i = 0; i < out.length; i++) { const v = Math.abs(out[i]); if (v > peak) peak = v; }
  return { samples: out, level: Math.sqrt(sum / Math.max(1, count)), peak, lead: a / sampleRate, tail: (n - b) / sampleRate };
}

/**
 * The gain for the next piece: towards TARGET_LEVEL, but only part of the way from the previous gain (no jumps
 * within a reading), never more than 4x or less than 0.4x, and never so loud that the piece clips.
 * @param {number|null} previous  gain of the piece before (null for the first piece of a reading)
 */
export function nextGain(previous, level, peak) {
  if (!(level > 0)) return previous ?? 1;
  const wanted = Math.min(4, Math.max(0.4, TARGET_LEVEL / level));
  let g = previous == null ? wanted : previous * 0.6 + wanted * 0.4;
  if (peak > 0 && g * peak > MAX_PEAK) g = MAX_PEAK / peak;
  return g;
}

/** Multiplies in place and returns the samples. */
export function applyGain(samples, gain) {
  if (gain !== 1) for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return samples;
}

/** Linear resampling (render() mixes the pieces into one buffer; the AudioContext resamples on its own). */
export function resample(samples, from, to) {
  if (from === to || !samples.length) return samples;
  const n = Math.max(1, Math.round(samples.length * to / from));
  const out = new Float32Array(n);
  const step = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * step, k = Math.floor(x), f = x - k;
    out[i] = (samples[k] ?? 0) * (1 - f) + (samples[k + 1] ?? samples[k] ?? 0) * f;
  }
  return out;
}

/**
 * Silences between and inside the sentences of a rendered reading.
 * @param {Float32Array} samples  @param {number} sampleRate
 * @param {{ start: number, end: number }[]} marks  seconds of every sentence in the mix
 * @returns {{ gaps: number[], longestInside: number, clipped: number, peak: number }}
 *   gaps = silence between consecutive sentences (seconds), longestInside = the longest silence inside one sentence
 */
export function analyseReading(samples, sampleRate, marks) {
  const { size, rms } = frames(samples, sampleRate);
  const silent = (f) => rms[f] < 0.004;
  const gaps = [];
  for (let k = 1; k < marks.length; k++) gaps.push(+(marks[k].start - marks[k - 1].end).toFixed(3));
  let longestInside = 0;
  for (const m of marks) {
    let run = 0;
    const a = Math.floor(m.start * sampleRate / size), b = Math.ceil(m.end * sampleRate / size);
    for (let f = a; f < b && f < rms.length; f++) { if (silent(f)) { run++; longestInside = Math.max(longestInside, run * size / sampleRate); } else run = 0; }
  }
  let clipped = 0, peak = 0;
  for (let i = 0; i < samples.length; i++) { const v = Math.abs(samples[i]); if (v >= 0.999) clipped++; if (v > peak) peak = v; }
  return { gaps, longestInside: +longestInside.toFixed(3), clipped, peak: +peak.toFixed(3) };
}
