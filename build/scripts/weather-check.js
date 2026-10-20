// Every weather mode and several hours: the picture must never blow out or go black.
module.exports = async ({ page, shot, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  await sleep(1500);
  const settle = async (n = 10) => { for (let i = 0; i < n; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(40); } };
  const rows = [];
  for (const weather of ['clear', 'overcast', 'rain', 'storm', 'snow', 'fog']) {
    for (const hour of [8, 13, 19, 23]) {
      await page.evaluate(([w, h]) => {
        const wo = window.__app.world;
        wo.applySettings({ ...wo.settings, weather: w, timeMode: 'fixed', fixedHour: h });
        wo.player.transition = null; wo.player.setPose(0, -2.2, Math.PI, 0.08);
      }, [weather, hour]);
      await settle(14);
      // storms flash: run a few more frames with the lightning forced on
      if (weather === 'storm') {
        await page.evaluate(() => { window.__app.world.env.lightning = 1; });
        await settle(4);
      }
      const m = await page.evaluate(() => {
        const w = window.__app.world;
        return { hemi: +w.env.hemi.intensity.toFixed(2), amb: +w.env.ambient.intensity.toFixed(2), sun: +w.env.sun.intensity.toFixed(2), exp: +w.renderer.toneMappingExposure.toFixed(2) };
      });
      rows.push([weather, hour, m.sun, m.hemi, m.amb].join(' '));
      if (hour === 13) await shot('we-' + weather);
    }
  }
  console.log('WEATHER\n' + rows.join('\n'));
  // the storm must not ratchet the ambient light upwards over time
  const drift = await page.evaluate(async () => {
    const w = window.__app.world;
    w.applySettings({ ...w.settings, weather: 'storm', timeMode: 'fixed', fixedHour: 21 });
    const base = { hemi: w.env.hemi.intensity, amb: w.env.ambient.intensity };
    for (let i = 0; i < 4000; i++) { w.env.lightning = Math.max(w.env.lightning, i % 300 === 0 ? 1 : 0); w.env.update(0.016, w.camera); }
    return { base: [+base.hemi.toFixed(3), +base.amb.toFixed(3)], after: [+w.env.hemi.intensity.toFixed(3), +w.env.ambient.intensity.toFixed(3)] };
  });
  console.log('STORM-DRIFT ' + JSON.stringify(drift));
};
