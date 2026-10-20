module.exports = async ({ page, shot, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 180000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  await sleep(500);
  const r = await page.evaluate(async () => {
    const w = window.__app.world; w.stop();
    await new Promise((r) => setTimeout(r, 300));
    const p = w.player; p.transition = null; p.setPose(9.5, 0.4, -Math.PI / 2 + 0.2, 0);
    w.renderer.info.autoReset = false; w.renderer.info.reset();
    const t0 = performance.now(); w.frame(); const t1 = performance.now();
    const info = { calls: w.renderer.info.render.calls, tris: w.renderer.info.render.triangles };
    w.renderer.info.reset(); w.frame(); const t2 = performance.now();
    return { first: t1 - t0, second: t2 - t1, ...info, books: w.books.entries.size, lights: w.lights.length };
  });
  console.log(JSON.stringify(r));
  const t = Date.now(); await shot('perf-low'); console.log('shot ms', Date.now() - t);
};
