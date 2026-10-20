// Where do the long frames come from? (GPU=1) Logs every frame over 30 ms together with the number of
// shader programs and textures before and after, while turning on the spot in the hall and the book room.
module.exports = async ({ app, page, sleep }) => {
  const W = +process.env.PERF_W || 1920, H = +process.env.PERF_H || 1080;
  await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setContentSize(w, h); }, [W, H]);
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  const bootPrograms = await page.evaluate(() => window.__app.world.renderer.info.programs?.length || 0);
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(1500);
  await page.evaluate(() => {
    const w = window.__app.world;
    const L = window.__spikes = [];
    const orig = w.frame.bind(w);
    w.frame = () => {
      const i = w.renderer.info;
      const p0 = i.programs?.length || 0, t0 = i.memory.textures, g0 = i.memory.geometries;
      const a = performance.now(); orig(); const d = performance.now() - a;
      if (d > 30) L.push({ ms: +d.toFixed(1), programs: [p0, i.programs?.length || 0], textures: [t0, i.memory.textures], geos: [g0, i.memory.geometries], pos: [+w.player.position.x.toFixed(1), +w.player.position.z.toFixed(1), +w.player.yaw.toFixed(2)] });
    };
  });
  const spin = async (x, z) => {
    await page.evaluate(([x, z]) => { const p = window.__app.world.player; p.transition = null; p.setPose(x, z, 0, 0); }, [x, z]);
    for (let k = 0; k < 40; k++) { await page.evaluate(() => { window.__app.world.player.yaw += Math.PI / 20; }); await sleep(60); }
  };
  console.log('PROGRAMS at menu', bootPrograms);
  for (const [x, z] of [[5.4, 0.4], [-5, 0], [0, 3.5], [0, -7], [0, -12], [8, -15], [-8, -20], [0, -21]]) await spin(x, z);
  const res = await page.evaluate(() => ({ spikes: window.__spikes, programs: window.__app.world.renderer.info.programs?.length, textures: window.__app.world.renderer.info.memory.textures }));
  for (const s of res.spikes) console.log('SPIKE ' + JSON.stringify(s));
  console.log('END programs=' + res.programs + ' textures=' + res.textures);
};
