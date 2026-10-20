// Tries several AO strengths on the same view (buffer and final picture).
module.exports = async ({ page, shot, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  await sleep(6000);
  const view = (process.env.AO_VIEW || '6.8,-14.5,-1.92,-0.08').split(',').map(Number);
  await page.evaluate((v) => { const w = window.__app.world; w.stop(); w.player.transition = null; w.player.setPose(v[0], v[1], v[2], v[3]); }, view);
  const sets = [
    ['full-b', { radius: 0.8, distanceExponent: 1.0, thickness: 2.0, scale: 2.0, samples: 16 }, true],
  ];
  await page.evaluate(() => {
    const ao = window.__app.world.ao;
    // full resolution + stronger denoise for this probe
    ao.setSize = Object.getPrototypeOf(Object.getPrototypeOf(ao)).setSize.bind(ao);
    const cv = window.__app.world.renderer.domElement;
    ao.setSize(cv.width, cv.height);
    ao.updatePdMaterial({ radius: 8, samples: 16, rings: 3, lumaPhi: 10, depthPhi: 2, normalPhi: 3 });
  });
  for (const [name, p] of sets) {
    await page.evaluate((p) => { const ao = window.__app.world.ao; ao.updateGtaoMaterial(p); ao.blendIntensity = 1; }, p);
    for (const [suffix, out] of [['buf', 5], ['img', 0]]) {
      await page.evaluate((o) => { window.__app.world.ao.output = o; }, out);
      for (let i = 0; i < 5; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(150); }
      await shot(`tune-${name}-${suffix}`);
    }
  }
};
