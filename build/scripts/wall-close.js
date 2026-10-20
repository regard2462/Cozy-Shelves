// Close-up of the hall wallpaper and the coffered ceiling.
module.exports = async ({ page, shot, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  await sleep(6000);
  await page.evaluate(() => window.__app.world.stop());
  for (const [name, x, z, yaw, pitch] of [['wall', -2.8, 3.2, Math.PI, 0.25], ['ceiling', 0, 1.5, Math.PI, 0.9]]) {
    await page.evaluate(([x, z, yaw, pitch]) => { const w = window.__app.world; w.player.transition = null; w.player.setPose(x, z, yaw, pitch); }, [x, z, yaw, pitch]);
    for (let i = 0; i < 8; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(120); }
    await shot('close-' + name);
  }
};
