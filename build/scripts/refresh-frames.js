// How long the frames are while the shelves are rebuilt (world.refreshShelves, as after every book read: the case
// "Zuletzt gelesen" changes). Uses only what 0.6 has as well, so the same run on an older build gives the baseline
// for the shelves of 0.7 (shelves-perf.js measures a new sort order the same way). Prints REFRESH lines and a summary.
//   COZYSHELVES_BOOKS="<library>|structured" COZYSHELVES_USERDATA=<indexed copy> node build/screenshot.js refresh-frames
module.exports = async ({ page, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 900; i++) {
    const st = await page.evaluate(() => { const b = window.__app.state.library.books; return { n: b.length, idx: b.filter((x) => x.indexed).length, active: !!window.__app.state.library.scan?.active }; });
    if (st.n > 0 && st.idx === st.n && !st.active) break;
    await sleep(2000);
  }
  await sleep(12000);
  const out = await page.evaluate(async () => {
    const w = window.__app.world;
    w.player.transition = null; w.player.setPose(0, -14.5, Math.PI, 0.12);
    const frames = []; let last = performance.now(), on = true;
    const tick = (t) => { frames.push(t - last); last = t; if (on) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    await pause(2000);
    const quiet = Math.max(...frames.slice(1)); frames.length = 0;
    const ids = [...w.books.entries.keys()];
    const runs = [];
    for (let i = 0; i < 6; i++) {
      frames.length = 0;
      const t = performance.now();
      const ok = w.refreshShelves({ recent: ids.slice(i * 3, i * 3 + 5) });
      const call = performance.now() - t;
      await pause(1500);
      const f = frames.slice(1).sort((a, b) => b - a);
      runs.push({ ok, call: +call.toFixed(1), max: +f[0].toFixed(1), second: +(f[1] || 0).toFixed(1) });
    }
    w.refreshShelves({ recent: [] });
    on = false;
    return { quiet: +quiet.toFixed(1), runs };
  });
  const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  console.log('REFRESH ' + JSON.stringify(out));
  console.log('REFRESH-SUMMARY ' + JSON.stringify({ quietMax: out.quiet, callMedian: med(out.runs.map((r) => r.call)), maxFrameMedian: med(out.runs.map((r) => r.max)), maxFrameMax: Math.max(...out.runs.map((r) => r.max)) }));
};
