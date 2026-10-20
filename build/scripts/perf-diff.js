// Compares the pictures of two perf-shots runs pixel by pixel (the performance strand of 0.9): for every PNG with the
// same name in both folders the mean absolute difference (per channel, 0 … 255), how many pixels differ by more than
// 1, 4 and 16 steps, the largest difference and where it lies, and a picture of the differences (× 8) in
// <B>/diff/. A change that leaves the picture alone shows a few pixels of 1 or 2 steps (the rounding of half floats,
// the dither) and nothing above 4.
//   node build/scripts/perf-diff.js <folder A> <folder B> [--amp 8] [--limit 4]
const fs = require('fs');
const path = require('path');
const png = require('./png-lite.js');

function compare(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { error: `sizes differ: ${a.width}x${a.height} vs ${b.width}x${b.height}` };
  const n = a.width * a.height;
  let sum = 0, over1 = 0, over4 = 0, over16 = 0, max = 0, maxAt = [0, 0];
  const diff = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const dr = Math.abs(a.data[o] - b.data[o]), dg = Math.abs(a.data[o + 1] - b.data[o + 1]), db = Math.abs(a.data[o + 2] - b.data[o + 2]);
    const d = Math.max(dr, dg, db);
    sum += (dr + dg + db) / 3;
    if (d > 1) over1++;
    if (d > 4) over4++;
    if (d > 16) over16++;
    if (d > max) { max = d; maxAt = [i % a.width, Math.floor(i / a.width)]; }
    diff[o] = Math.min(255, dr * 8); diff[o + 1] = Math.min(255, dg * 8); diff[o + 2] = Math.min(255, db * 8); diff[o + 3] = 255;
  }
  return { mean: +(sum / n).toFixed(4), over1, over4, over16, max, maxAt, pct4: +(over4 / n * 100).toFixed(4), diff: { width: a.width, height: a.height, data: diff } };
}

if (require.main === module) {
  const [A, B] = process.argv.slice(2).filter((x) => !x.startsWith('--'));
  if (!A || !B) { console.log('usage: node build/scripts/perf-diff.js <folder A> <folder B>'); process.exit(1); }
  const limitArg = process.argv.indexOf('--limit'), limit = limitArg > 0 ? +process.argv[limitArg + 1] : 4;
  const names = fs.readdirSync(A).filter((f) => f.endsWith('.png') && fs.existsSync(path.join(B, f)));
  fs.mkdirSync(path.join(B, 'diff'), { recursive: true });
  let worst = 0, bad = 0;
  for (const name of names.sort()) {
    const a = png.decode(fs.readFileSync(path.join(A, name))), b = png.decode(fs.readFileSync(path.join(B, name)));
    const r = compare(a, b);
    if (r.error) { console.log(`DIFF ${name} ${r.error}`); bad++; continue; }
    if (r.over1) fs.writeFileSync(path.join(B, 'diff', name.replace(/\.png$/, '-diff.png')), png.encode(r.diff));
    const ok = r.over4 === 0 || r.pct4 < 0.01;
    if (!ok) bad++;
    worst = Math.max(worst, r.max);
    console.log(`${ok ? 'SAME' : 'DIFF'} ${name} mean=${r.mean} >1:${r.over1} >4:${r.over4} (${r.pct4}%) >16:${r.over16} max=${r.max}@${r.maxAt.join(',')}`);
  }
  console.log(`SUMMARY ${names.length} pictures, ${bad} with differences above ${limit} steps in more than 0.01 % of the pixels, largest step ${worst}`);
}
module.exports = { compare };
