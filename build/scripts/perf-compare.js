// Compares perf-matrix runs (the performance strand of 0.9): node build/scripts/perf-compare.js <A.json> <B.json> [...]
// prints every cell (tier, size, view, condition) with the median GPU and CPU time of each side and the change of the GPU
// time in %, then the passes, CPU and memory parts. A side may be several runs joined with + (A1.json+A2.json): the
// median of their cells.
const fs = require('fs');
const load = (arg) => arg.split('+').map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
const files = process.argv.slice(2).map(load);
const key = (c) => `${c.tier} ${c.size} ${c.view} ${c.cond}`;
const med = (a) => { const s = a.filter((v) => v != null).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const cells = new Map();
files.forEach((runs, i) => {
  for (const run of runs) for (const c of run.matrix || []) {
    const k = key(c); if (!cells.has(k)) cells.set(k, files.map(() => ({ gpu: [], cpu: [] })));
    cells.get(k)[i].gpu.push(c.gpu?.p50); cells.get(k)[i].cpu.push(c.cpu?.p50);
  }
});
const fmt = (v) => (v == null ? '   -  ' : v.toFixed(2).padStart(6));
console.log('cell'.padEnd(34) + files.map((_, i) => `  gpu${i}  cpu${i}`).join('') + '   gpu Δ%');
const sums = files.map(() => ({ g: 0, n: 0 }));
for (const [k, v] of cells) {
  const g = v.map((x) => med(x.gpu)), c = v.map((x) => med(x.cpu));
  const d = g[0] && g[g.length - 1] ? ((g[g.length - 1] / g[0] - 1) * 100).toFixed(1) : '';
  console.log(k.padEnd(34) + v.map((_, i) => `${fmt(g[i])}${fmt(c[i])}`).join('') + '   ' + d);
}
files.forEach((runs, i) => {
  for (const run of runs) {
    for (const p of run.passes || []) console.log(`PASSES[${i}] ${p.size} ${p.view} ${p.cond} frame=${JSON.stringify(p.frame)} ${JSON.stringify(p.passes)}`);
    for (const c of run.cpu || []) console.log(`CPU[${i}] ${c.view} ${c.cond} total=${c.total?.p50} ${JSON.stringify(c.avg)}`);
    if (run.memory) console.log(`MEM[${i}] heap=${run.memory.usedJSHeapMB} tex=${run.memory.textureMB} rt=${run.memory.renderTargetMB} geo=${run.memory.geometryMB} info=${JSON.stringify(run.memory.info)}`);
  }
});
