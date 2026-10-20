// How long the start takes, with a CPU profile of it (the performance strand of 0.9). Milliseconds from the page's
// start until window.__app exists, the world is built (layout, garden, lamps), the first frame is drawn, the start menu
// shows its button, and after the click on "Bücherei betreten" until the fade is gone and the next frame is drawn; then
// until the library is indexed and the shelves stood still (the debounced rebuild). Meanwhile the V8 sampling profiler
// runs through the Chrome DevTools protocol; the profile goes to SHOT_DIR/startup-<PS_TAG>.cpuprofile and the functions
// with the most self time are printed (PROFILE lines). Everything also as JSON into SHOT_DIR/perf-startup-<PS_TAG>.json.
//   node build/screenshot.js perf-startup     PS_TAG=base   PS_TOP=30
const fs = require('fs');
const path = require('path');

module.exports = async ({ app, page, sleep }) => {
  const tag = process.env.PS_TAG || 'run', top = +process.env.PS_TOP || 30;
  const outDir = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  let cdp = null;
  try { cdp = await app.context().newCDPSession(page); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 }); await cdp.send('Profiler.start'); }
  catch (e) { console.log('[perf-startup] no profiler: ' + (e?.message || e)); cdp = null; }
  // the marks, polled in the page every 4 ms (the first frame: the renderer's frame counter)
  const marks = await page.evaluate(() => new Promise((res) => {
    const m = {};
    const tick = () => {
      const now = performance.now(), a = window.__app;
      if (a && !m.app) m.app = now;
      if (a?.world?.layout && !m.built) m.built = now;
      if (a?.world?.renderer?.info?.render?.frame > 0 && !m.firstFrame) m.firstFrame = now;
      if (document.querySelector('.menu-btn.primary') && !m.menu) m.menu = now;
      if (m.menu && m.firstFrame && m.built) res(m); else setTimeout(tick, 4);
    };
    tick();
  }));
  const steps = await page.evaluate(() => { const w = window.__app.world; return { build: w.buildSteps, buildTimes: w.buildTimes, shelf: w.shelfSteps, garden: w.env?.garden?.steps || null, skyAndGardenMs: w.env?.buildMs != null ? Math.round(w.env.buildMs) : null, trees: w.env?.garden?.trees?.length ?? null, programs: w.renderer.info.programs?.length }; });
  // "Bücherei betreten": the click, the fade and the next drawn frame
  const enter = await page.evaluate(() => new Promise((res) => {
    const w = window.__app.world, f0 = w.renderer.info.render.frame, t0 = performance.now();
    document.querySelector('.menu-btn.primary').click();
    const m = { click: t0 };
    const tick = () => {
      const now = performance.now();
      if (!m.menuGone && !document.querySelector('.panel-layer[data-panel="menu"]')) m.menuGone = now;
      if (!m.fadeGone && document.querySelector('#fade')?.classList.contains('hidden')) m.fadeGone = now;
      if (!m.frame && w.renderer.info.render.frame > f0 && m.menuGone) m.frame = now;
      if (m.menuGone && m.fadeGone && m.frame) res(m); else if (now - t0 > 15000) res(m); else setTimeout(tick, 4);
    };
    setTimeout(tick, 0);
  }));
  // the library indexed and the shelves at rest (main.js: the rebuild after the last update, 800 ms or 9 s later)
  let lib = null;
  for (let i = 0; i < 300; i++) {
    const st = await page.evaluate(() => { const b = window.__app.state.library.books, w = window.__app.world; return { n: b.length, idx: b.filter((x) => x.indexed).length, active: !!window.__app.state.library.scan?.active, builds: w.buildTimes.length, now: performance.now() }; });
    if (st.n > 0 && st.idx === st.n && !st.active) { lib = st; break; }
    await sleep(500);
  }
  await sleep(10000);
  const after = await page.evaluate(() => { const w = window.__app.world; return { builds: w.buildTimes, steps: w.buildSteps, programs: w.renderer.info.programs?.length, textures: w.renderer.info.memory.textures, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null, textureStore: window.__app.textures?.info?.() || null }; });
  let profile = null;
  if (cdp) {
    try {
      const { profile: p } = await cdp.send('Profiler.stop');
      profile = p;
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, `startup-${tag}.cpuprofile`), JSON.stringify(p));
    } catch (e) { console.log('[perf-startup] profile failed: ' + (e?.message || e)); }
  }
  const out = { tag, marks: Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, Math.round(v)])), steps, enter: Object.fromEntries(Object.entries(enter).map(([k, v]) => [k, Math.round(v - enter.click)])), libraryIndexedAt: lib ? Math.round(lib.now) : null, after };
  console.log('STARTUP ' + JSON.stringify(out));
  // the textures painted on the main thread at this start, by the time they took (world/texture-store.js STANDARD)
  const ts = after.textureStore;
  if (ts) console.log('TEXTURES ' + JSON.stringify({ restored: ts.restored, painted: ts.painted, took: ts.took, kept: ts.kept, startMs: ts.startMs, mainThreadMs: Object.values(ts.stats).reduce((a, b) => a + b, 0), keys: Object.entries(ts.stats).sort((a, b) => b[1] - a[1]) }));
  if (profile) {
    // self time per function (its node's samples), top N, and the same by file
    const dt = profile.timeDeltas, samples = profile.samples, byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const self = new Map(), byUrl = new Map();
    let total = 0;
    for (let i = 0; i < samples.length; i++) {
      const n = byId.get(samples[i]); if (!n) continue;
      const d = (dt[i] || 0) / 1000; total += d;
      const cf = n.callFrame, url = (cf.url || '').replace(/^.*\/dist\//, '').replace(/^.*\/app\//, ''), key = `${cf.functionName || '(anonymous)'} ${url}:${cf.lineNumber}`;
      self.set(key, (self.get(key) || 0) + d);
      byUrl.set(url || '(native)', (byUrl.get(url || '(native)') || 0) + d);
    }
    const list = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => [Math.round(v), k]);
    console.log(`PROFILE total=${Math.round(total)}ms samples=${samples.length}`);
    for (const [ms, k] of list) console.log(`PROFILE ${String(ms).padStart(6)} ${k}`);
    const files = [...byUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [Math.round(v), k]);
    for (const [ms, k] of files) console.log(`PROFILE-FILE ${String(ms).padStart(6)} ${k}`);
    out.profileTop = list; out.profileFiles = files; out.profileTotal = Math.round(total);
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `perf-startup-${tag}.json`), JSON.stringify(out, null, 1));
};
