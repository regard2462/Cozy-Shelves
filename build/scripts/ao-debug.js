// Shows the ambient-occlusion buffer itself (denoised), to judge its strength.
module.exports = async ({ page, shot, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  await sleep(6000);
  await page.evaluate(() => { const w = window.__app.world; w.stop(); w.player.transition = null; w.player.setPose(6.8, -14.5, -Math.PI / 2 - 0.35, -0.08); });
  for (const [name, out] of [['ao-buffer', 5], ['ao-final', 0]]) {
    await page.evaluate((o) => { window.__app.world.ao.output = o; }, out);
    for (let i = 0; i < 6; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(150); }
    await shot(name);
  }
  console.log('AO ' + JSON.stringify(await page.evaluate(() => ({ enabled: window.__app.world.ao.enabled, w: window.__app.world.ao.width, h: window.__app.world.ao.height }))));
};
