// Graphics review: fixed camera positions in the hall and the book room (SHOT_TAG prefixes the names).
// COZYSHELVES_QUERY=hour=22 etc. picks the time of day.
module.exports = async ({ page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || 'look';
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { document.querySelector('.menu-btn.primary').click(); });
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2500);
  }
  await sleep(3000);
  await page.evaluate(() => window.__app.world.stop());
  const only = (process.env.LOOK_VIEWS || '').split(',').filter(Boolean);
  const views = [
    ['hall-west', 6.4, 0.4, Math.PI / 2, -0.02],
    ['hall-north', 0.5, -4.4, Math.PI, 0.02],
    ['hall-east', -6.0, -0.3, -Math.PI / 2, -0.03],
    ['hall-south', 0.2, 4.4, 0, 0.0],
    ['room-entry', 0, -10.2, 0, -0.02],
    ['room-back', 0.4, -22.6, Math.PI, 0.0],
    ['room-shelves', 6.8, -14.5, -Math.PI / 2 - 0.35, -0.08],
    ['passage', 0, 2.0, 0, 0.0],
  ].filter((v) => !only.length || only.includes(v[0]));
  for (const [name, x, z, yaw, pitch] of views) {
    await page.evaluate(([x, z, yaw, pitch]) => {
      const w = window.__app.world; const p = w.player;
      if (w.actions.seatedId) w.actions.leaveSeat?.();
      p.transition = null; p.setPose(x, z, yaw, pitch);
    }, [x, z, yaw, pitch]);
    // one frame per evaluate: software GL queues the GL work, so rendering 40 frames in a row
    // makes the following screenshot wait for all of them
    for (let i = 0; i < 8; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(process.env.LOOK_SLOW ? 900 : 120); }
    await sleep(300);
    await shot(`${tag}-${name}`);
  }
  if (!only.length || only.includes('sofa')) {
    await page.evaluate(() => { const w = window.__app.world; const s = w.seats.get('sofa'); w.player.transition = null; w.player.setPose(s.standPos.x, s.standPos.z, s.standYaw, 0); w.actions.sit('sofa'); });
    for (let i = 0; i < 16; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(150); }
    await sleep(300);
    await shot(`${tag}-sofa`);
  }
  const stats = await page.evaluate(() => { const w = window.__app.world; const i = w.renderer.info; return { calls: i.render.calls, tris: i.render.triangles, geos: i.memory.geometries, tex: i.memory.textures, lamps: w.lamps?.length }; });
  console.log('STATS ' + JSON.stringify(stats));
};
