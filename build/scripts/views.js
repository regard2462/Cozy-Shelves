// Screenshots from free camera positions: VIEWS='[["name", x, z, yaw, pitch, y?], …]' (y = eye height,
// default 1.62). SHOT_TAG prefixes the file names; COZYSHELVES_QUERY=hour=… picks the time of day.
module.exports = async ({ page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || 'view';
  const views = JSON.parse(process.env.VIEWS || '[]');
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(2500);
  await page.evaluate((hud) => { window.__app.world.stop(); document.querySelector('#hud')?.style.setProperty('opacity', hud ? '1' : '0'); }, !!process.env.HUD);
  for (const [name, x, z, yaw, pitch, y] of views) {
    await page.evaluate(([x, z, yaw, pitch, y]) => {
      const w = window.__app.world; const p = w.player;
      if (w.actions.seatedId) w.actions.leaveSeat?.();
      p.transition = null; p.setPose(x, z, yaw, pitch);
      if (y) p.position.y = y;
    }, [x, z, yaw, pitch || 0, y || 0]);
    for (let i = 0; i < 10; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(60); }
    await shot(`${tag}-${name}`);
  }
};
