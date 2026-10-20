// Footsteps without a window or a sound card: renders steps.js in Node for every surface and gait and measures what
// makes a step sound hard or squeaky. Run: node build/steps-check.js [--json] [--wav <folder>]
//   peak, rms          level of the footfall (rms over its loud part)
//   crest              peak / rms: a sharp click has a high crest
//   rise_ms            from the first strike to 90 % of the loudest moment of the envelope (1 ms smoothing): a hard step
//                      rises in a few milliseconds
//   above3k            share of the energy above 3 kHz
//   centroid           spectral centre of gravity (Hz)
//   tonal              how far the loudest narrow band between 1 and 8 kHz stands out of its neighbourhood, the worst
//                      short frame of the step (1024 samples): grains made of sine pings ring as tones (a squeak or a
//                      chirp), noise grains do not
// The criteria below are what a soft step must keep (0.9: "the path squeaks, every step sounds hard"; since then a
// footfall is one soft tread of low noise with a quiet rustle outdoors).
'use strict';
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const SR = 48000;

function load() {
  // steps.js is an ES module; its sound worker (offthread.js) is only started when a step is made ahead, which this
  // check never asks for: stepSamples makes every step on the spot
  const out = esbuild.buildSync({
    entryPoints: [path.join(root, 'app', 'src', 'audio', 'steps.js')], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

// ---- a small FFT (radix 2, in place)
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
function power(frame) {
  const n = frame.length, re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = frame[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
  fft(re, im);
  const p = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
  return p;
}

function measure(x) {
  let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v));
  // envelope: |x| smoothed over 1 ms
  const a = Math.exp(-1 / (0.001 * SR)); let e = 0; const env = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) { e = Math.max(Math.abs(x[i]), e * a); env[i] = e; }
  let emax = 0, imax = 0; for (let i = 0; i < env.length; i++) if (env[i] > emax) { emax = env[i]; imax = i; }
  const start = env.findIndex((v) => v > emax * 0.05);
  const rise = env.findIndex((v, i) => i >= start && v >= emax * 0.9);
  let s2 = 0; const loud = Math.min(x.length, Math.round(SR * 0.22)); for (let i = 0; i < loud; i++) s2 += x[i] * x[i];
  const rmsv = Math.sqrt(s2 / loud);
  // the whole step's spectrum (zero padded to 32768) and the worst short frame for tonality
  const N = 32768, buf = new Float32Array(N); buf.set(x.subarray(0, Math.min(N, x.length)));
  const P = power(buf), hz = SR / N;
  let tot = 0, hi = 0, cen = 0, mid = 0, geo = 0, ar = 0, nb = 0;
  for (let k = 1; k < P.length; k++) {
    const f = k * hz; tot += P[k]; cen += P[k] * f; if (f > 3000) hi += P[k]; if (f >= 1000 && f <= 4000) mid += P[k];
    // flatness as build/scripts/sound-check.js measures it (60 Hz to 6 kHz)
    if (f > 60 && f < 6000) { geo += Math.log(P[k] + 1e-24); ar += P[k]; nb++; }
  }
  let tonal = 0;
  const F = 1024, lo = Math.round(1000 / (SR / F)), up = Math.round(8000 / (SR / F));
  for (let s = 0; s + F <= x.length; s += 256) {
    const fr = x.subarray(s, s + F); let fe = 0; for (const v of fr) fe += v * v;
    if (fe < s2 * F / loud * 0.25) continue;                // only the loud frames
    const p = power(fr);
    for (let k = lo + 4; k < up - 4; k++) {
      let nb = 0; for (let d = 3; d <= 8; d++) nb += p[k - d] + p[k + d - 0];
      nb /= 12;
      const band = p[k] + 0.5 * (p[k - 1] + p[k + 1]);
      if (nb > 0) tonal = Math.max(tonal, band / nb);
    }
  }
  return { peak: +peak.toFixed(4), rms: +rmsv.toFixed(5), crest: +(peak / rmsv).toFixed(1), rise_ms: +((rise - start) / SR * 1000).toFixed(1), above3k: +(hi / tot).toFixed(3), mid: +(mid / tot).toFixed(3), centroid: Math.round(cen / tot), flat: +(Math.exp(geo / nb) / (ar / nb)).toFixed(3), tonal: +tonal.toFixed(1) };
}

const median = (a) => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };

function run() {
  const S = load();
  const gaits = { walk: { speed: 2.4 }, run: { run: true, speed: 4.2 }, land: { landing: true, impact: 3 } };
  const res = {};
  for (const surface of S.SURFACE_NAMES) {
    for (const [g, o] of Object.entries(gaits)) {
      const ms = [];
      for (let seed = 1; seed <= 8; seed++) ms.push(measure(S.stepSamples(SR, { surface, seed, ...o })));
      const r = {}; for (const k of Object.keys(ms[0])) r[k] = median(ms.map((m) => m[k]));
      r.tonalMax = Math.max(...ms.map((m) => m.tonal));
      res[surface + ':' + g] = r;
    }
  }
  return { S, res };
}

function writeWav(file, x) {
  const n = x.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * 32767 * 8))), 44 + i * 2);
  fs.writeFileSync(file, b);
}

if (require.main === module) {
  const { S, res } = run();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(res, null, 1)); process.exit(0); }
  const wi = process.argv.indexOf('--wav');
  if (wi > 0) {
    const dir = process.argv[wi + 1]; fs.mkdirSync(dir, { recursive: true });
    for (const s of S.SURFACE_NAMES) {
      // four walking steps in a row, 0.5 s apart (gain 8×, the same for every surface and version, so they compare)
      const seq = new Float32Array(SR * 2.4);
      for (let k = 0; k < 4; k++) seq.set(S.stepSamples(SR, { surface: s, seed: 30 + k, speed: 2.4 }).subarray(0, SR * 0.42), Math.round(k * 0.5 * SR));
      writeWav(path.join(dir, `steps-${s}.wav`), seq);
    }
    console.log('wav files in', dir);
  }
  console.log('surface:gait'.padEnd(16), 'peak    rms      crest rise_ms above3k mid1-4k centroid flat  tonal(max)');
  for (const [k, r] of Object.entries(res)) console.log(k.padEnd(16), String(r.peak).padEnd(7), String(r.rms).padEnd(8), String(r.crest).padEnd(5), String(r.rise_ms).padEnd(7), String(r.above3k).padEnd(7), String(r.mid).padEnd(7), String(r.centroid).padEnd(8), String(r.flat).padEnd(5), `${r.tonal} (${r.tonalMax.toFixed(1)})`);
  const crit = [];
  const ok = (name, cond, info) => { crit.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(info)}`); };
  const walk = (s) => res[s + ':walk'];
  const grainy = ['gravel', 'pebbles', 'earth', 'snow', 'ice'];
  // noise alone reaches 30 to 47 here (wood, grass: the largest of many random bands); the sine grains of 0.8 reached
  // 240 on the gravel path and 2657 on the beach
  ok('no squeak: the grains of gravel, pebbles, trails, snow and ice ring as no tone (tonal < 60)', grainy.every((s) => walk(s).tonalMax < 60), Object.fromEntries(grainy.map((s) => [s, walk(s).tonalMax])));
  ok('soft: no step rises in under 4 ms', S.SURFACE_NAMES.every((s) => walk(s).rise_ms >= 4), Object.fromEntries(S.SURFACE_NAMES.map((s) => [s, walk(s).rise_ms])));
  ok('soft: little energy above 3 kHz (under 12 % on every surface)', S.SURFACE_NAMES.every((s) => walk(s).above3k < 0.12), Object.fromEntries(S.SURFACE_NAMES.map((s) => [s, walk(s).above3k])));
  ok('no click: crest factor under 9 on every surface', S.SURFACE_NAMES.every((s) => walk(s).crest < 9), Object.fromEntries(S.SURFACE_NAMES.map((s) => [s, walk(s).crest])));
  ok('the ground still differs: the gravel path rustles (brighter than the wooden floor), the jetty lower than wood, carpet quieter than wood', walk('gravel').centroid > walk('wood').centroid && walk('jetty').centroid < walk('wood').centroid && walk('carpet').peak < walk('wood').peak * 0.45, { gravel: walk('gravel').centroid, jetty: walk('jetty').centroid, wood: walk('wood').centroid, carpet: walk('carpet').peak, woodPeak: walk('wood').peak });
  const n = crit.filter(Boolean).length;
  console.log(`STEPS-CHECK ${n}/${crit.length} passed`);
  process.exit(n === crit.length ? 0 : 1);
}

module.exports = { run, measure };
