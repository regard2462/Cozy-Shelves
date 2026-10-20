// How long the panels take to open and close (the performance strand of 0.9): for every panel the time from the call
// of openPanel until its mount has finished and two animation frames have been drawn (layout and paint of the overlay
// included), the long tasks on the way, the time until two frames after closePanel, and the CPU time of World#frame
// while it is open (the world runs dimmed behind it). Each panel is opened PP_ROUNDS times (default 3); the median is
// reported (PANEL lines) and everything goes as JSON into SHOT_DIR/perf-panels-<PP_TAG>.json.
//   node build/screenshot.js perf-panels     PP_TAG=base   PP_PANELS=menu,settings,basket,bookinfo,...   PP_ROUNDS=3
const fs = require('fs');
const path = require('path');

module.exports = async ({ app, page, sleep }) => {
  const W = +process.env.PERF_W || 1600, H = +process.env.PERF_H || 900;
  await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setContentSize(w, h); }, [W, H]);
  // the world map's tiles never reach OpenStreetMap from a check: they come from the check (osm-tiles.js); the route
  // turns the page's HTTP cache off, which the app's own files (app://) do not use
  await require('./osm-tiles.js').serveTiles({ page, app });
  const tag = process.env.PP_TAG || 'run', rounds = +process.env.PP_ROUNDS || 3;
  const outDir = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  // (news, podcasts, wiki, mediathek and browser need the network or a web view: left out by default)
  const names = (process.env.PP_PANELS || 'menu,settings,basket,bookinfo,records,computer,catalog,search,worldmap,chess,watercolor,audiobooks,gallery').split(',');
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  let last = -1, quiet = 0;
  for (let i = 0; i < 300; i++) {
    const st = await page.evaluate(() => { const b = window.__app.state.library.books; return { n: b.length, idx: b.filter((x) => x.indexed).length, active: !!window.__app.state.library.scan?.active }; });
    if (st.n > 0 && st.idx === st.n && !st.active) { quiet = st.n === last ? quiet + 1 : 0; if (quiet >= 2) break; }
    last = st.n;
    await sleep(1500);
  }
  await sleep(10500);
  const results = [];
  for (const name of names) {
    const runs = [];
    for (let r = 0; r < rounds; r++) {
      const out = await page.evaluate(async ([name]) => {
        const app = window.__app, w = app.world;
        const frames = (n) => new Promise((res) => { const f = () => (--n <= 0 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
        app.closeAllPanels(); await frames(3);
        const params = name === 'bookinfo' ? { id: [...w.books.entries.keys()][0] } : name === 'gallery' ? { slot: 0 } : name === 'settings' ? { section: 'graphics' } : {};
        const long = [];
        let obs = null;
        try { obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push(Math.round(e.duration)); }); obs.observe({ type: 'longtask' }); } catch {}
        // the world's frames while the panel is open: hooked before, read after
        const cpu = [];
        const orig = w.frame;
        w.frame = function () { const a = performance.now(); const res = orig.call(this); cpu.push(performance.now() - a); return res; };
        const t0 = performance.now();
        let error = null;
        try { await app.openPanel(name, params); } catch (e) { error = String(e?.message || e); }
        const mounted = performance.now() - t0;
        await frames(2);
        const shown = performance.now() - t0;
        await new Promise((res) => setTimeout(res, 700));
        const t1 = performance.now();
        app.closeAllPanels();
        await frames(2);
        const closed = performance.now() - t1;
        w.frame = orig;
        await new Promise((res) => setTimeout(res, 50));
        obs?.disconnect();
        const s = cpu.sort((a, b) => a - b);
        return { mounted: +mounted.toFixed(1), shown: +shown.toFixed(1), closed: +closed.toFixed(1), long, worldFrames: s.length, worldCpuP50: s.length ? +s[s.length >> 1].toFixed(2) : null, error, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null };
      }, [name]);
      runs.push(out);
    }
    const med = (k) => { const s = runs.map((x) => x[k]).filter((v) => v != null).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
    const line = { name, mounted: med('mounted'), shown: med('shown'), closed: med('closed'), first: runs[0].shown, longTasks: runs.map((x) => x.long), worldCpuP50: med('worldCpuP50'), error: runs.find((x) => x.error)?.error || null, heapMB: runs[runs.length - 1].heapMB };
    results.push(line);
    console.log('PANEL ' + JSON.stringify(line));
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `perf-panels-${tag}.json`), JSON.stringify({ tag, results }, null, 1));
};
