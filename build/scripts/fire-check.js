module.exports = async ({ page, shot, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  await sleep(2000);
  const info = await page.evaluate(() => {
    const w = window.__app.world;
    const f = w.fire;
    return {
      hasFire: !!f, anchor: w.fireAnchor ? w.fireAnchor.toArray().map(n => +n.toFixed(2)) : null,
      groupPos: f ? f.group.position.toArray().map(n => +n.toFixed(2)) : null,
      visible: f ? f.group.visible : null,
      inScene: f ? !!f.group.parent : null,
      intensity: f ? f.intensity : null,
      lightI: f ? +f.light.intensity.toFixed(2) : null,
      planes: f ? f.planes.length : null,
      envFires: w.env ? w.env.fires.length : null,
    };
  });
  console.log('FIRE ' + JSON.stringify(info));
  for (const [n, x, z, yaw, pitch] of [['fire-a', -6.0, 0, Math.PI / 2, -0.10], ['fire-b', -7.0, 0.6, Math.PI / 2 + 0.2, -0.16], ['fire-c', -6.6, 0, Math.PI / 2, -0.24]]) {
    await page.evaluate(([x, z, yaw, pitch]) => { const w = window.__app.world; w.player.transition = null; w.player.setPose(x, z, yaw, pitch); }, [x, z, yaw, pitch]);
    for (let i = 0; i < 12; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(45); }
    await shot(n);
  }
};
