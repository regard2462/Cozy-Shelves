// Close-ups: banker lamp on the reading table, projector, e-reader, a decorated shelf.
module.exports = async ({ page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || 'lamp';
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  await sleep(6000);
  await page.evaluate(() => window.__app.world.stop());
  const views = [
    ['banker', 1.6, -0.9, 0, -0.45],
    ['banker-side', 3.2, -2.4, Math.PI / 2 * 1.0 + 0.0, -0.4],
    ['projector', -0.6, -1.0, Math.PI / 2 - 0.35, -0.2],
    ['ereader', -5.0, -3.6, -0.15, -0.42],
    ['shelf', 9.4, -14.0, -Math.PI / 2, -0.05],
    ['recent', 2.6, -10.9, Math.PI, -0.12],
  ];
  for (const [name, x, z, yaw, pitch] of views) {
    await page.evaluate(([x, z, yaw, pitch]) => { const w = window.__app.world; w.player.transition = null; w.player.setPose(x, z, yaw, pitch); }, [x, z, yaw, pitch]);
    for (let i = 0; i < 8; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(120); }
    await shot(`${tag}-${name}`);
  }
};
