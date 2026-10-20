// Writes app/src/world/bluenoise.js: a tileable 64 × 64 blue-noise pattern (void-and-cluster, Ulichney 1993) with the
// values 0 … 255 each exactly once per 16 texels, embedded as base64. Run again only to change the size or the seed.
//   node build/bluenoise.js [size=64] [sigma=1.9]
const fs = require('fs');
const path = require('path');
const N = +process.argv[2] || 64, SIGMA = +process.argv[3] || 1.9;
const n = N * N;
// the energy of a point spreads as a Gaussian, wrapped round the torus (the pattern tiles)
const K = new Float32Array(n);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const dx = Math.min(x, N - x), dy = Math.min(y, N - y);
  K[y * N + x] = Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA));
}
const energy = new Float64Array(n);
const add = (i, sign) => { const px = i % N, py = (i / N) | 0; for (let y = 0; y < N; y++) { const ky = ((y - py) + N) % N; for (let x = 0; x < N; x++) energy[y * N + x] += sign * K[ky * N + ((x - px) + N) % N]; } };
const bin = new Uint8Array(n);
const argExt = (want, max) => { let best = -1, bv = max ? -Infinity : Infinity; for (let i = 0; i < n; i++) { if (bin[i] !== want) continue; const e = energy[i]; if (max ? e > bv : e < bv) { bv = e; best = i; } } return best; };
// a random start with a tenth of the points, relaxed: the tightest cluster moves into the largest void until it would
// move back where it came from
let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
let ones = 0;
while (ones < n / 10) { const i = (rnd() * n) | 0; if (!bin[i]) { bin[i] = 1; add(i, 1); ones++; } }
for (let it = 0; it < 10000; it++) {
  const c = argExt(1, true); bin[c] = 0; add(c, -1);
  const v = argExt(0, false);
  if (v === c) { bin[c] = 1; add(c, 1); break; }
  bin[v] = 1; add(v, 1);
}
const rank = new Int32Array(n).fill(-1);
// phase 1: the prototype's points removed one by one, the tightest cluster first, ranked downwards
const proto = bin.slice();
let r = ones;
while (r > 0) { const c = argExt(1, true); bin[c] = 0; add(c, -1); r--; rank[c] = r; }
// phase 2: from the prototype upwards, the largest void filled first
bin.set(proto); energy.fill(0); for (let i = 0; i < n; i++) if (bin[i]) add(i, 1);
r = ones;
while (r < n / 2) { const v = argExt(0, false); bin[v] = 1; add(v, 1); rank[v] = r++; }
// phase 3: the rest, the tightest cluster of the inverse pattern first
for (let i = 0; i < n; i++) bin[i] = 1 - bin[i];
energy.fill(0); for (let i = 0; i < n; i++) if (bin[i]) add(i, 1);
while (r < n) { const c = argExt(1, true); bin[c] = 0; add(c, -1); rank[c] = r++; }
const out = new Uint8Array(n);
for (let i = 0; i < n; i++) out[i] = Math.round(rank[i] * 255 / (n - 1));
const b64 = Buffer.from(out).toString('base64');
const src = `// A tileable blue-noise pattern, ${N} × ${N} values 0 … 255 (void-and-cluster, written by build/bluenoise.js), for dithering
// where a hashed pattern shows its own lines: the jitter of the god rays' steps and the dithered edge of the trees'
// half-shadow (godrays.js). Blue noise has next to no low frequencies, so a blur takes it out whole, and shifted by the
// golden ratio from frame to frame it averages away under a temporal blend.
import * as THREE from 'three';

export const BLUE_SIZE = ${N};
const DATA = '${b64}';
let tex = null;
/** The pattern as a one-channel texture, repeating, unfiltered (read with texelFetch at gl_FragCoord mod ${N}). */
export function blueNoiseTexture() {
  if (tex) return tex;
  const bin = atob(DATA), data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  tex = new THREE.DataTexture(data, BLUE_SIZE, BLUE_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
`;
const file = path.join(__dirname, '..', 'app', 'src', 'world', 'bluenoise.js');
fs.writeFileSync(file, src);
const hist = new Array(8).fill(0); for (const v of out) hist[v >> 5]++;
console.log(`wrote ${file}: ${N} × ${N}, histogram ${hist.join(' ')}`);
