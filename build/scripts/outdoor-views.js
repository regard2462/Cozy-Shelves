// Screenshots of the garden under several weathers and times of day: OV_VIEWS='[["name", x, z, yaw, pitch], …]'
// and OV_COND='[["fog", 15], ["clear", 20.5], …]' (weather, fixed hour) replace the defaults. The graphics are those of
// a typical high setting (quality high, bloom, shadows, SSAO, resolution 1.4, field of view 72); OV_SCALE changes the
// resolution scale. SHOT_TAG prefixes the file names (<tag>-<weather><hour>-<view>.png).
//   node build/screenshot.js outdoor-views
module.exports = async ({ app, page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || 'ov';
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1600, 900); });
  const views = process.env.OV_VIEWS ? JSON.parse(process.env.OV_VIEWS) : [
    ['deck', 0.4, 8.6, Math.PI + 0.35, 0.02],
    ['lake', -12.5, 27.5, Math.PI + 0.75, -0.04],
    ['hall', 0.3, 2.2, Math.PI, 0.05],
  ];
  const conds = process.env.OV_COND ? JSON.parse(process.env.OV_COND) : [['fog', 15], ['clear', 15], ['overcast', 11], ['rain', 15], ['storm', 17], ['snow', 13], ['clear', 20.5], ['clear', 23]];
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(2000);
  await page.evaluate(() => { window.__app.world.stop(); window.__app.closeAllPanels(); document.querySelector('#hud')?.style.setProperty('opacity', '0'); });
  const scale = +process.env.OV_SCALE || 1.4;
  for (const [weather, hour] of conds) {
    await page.evaluate(([weather, hour, scale]) => {
      const w = window.__app.world;
      w.applySettings({ ...w.settings, weather, timeMode: 'fixed', fixedHour: hour, graphics: { ...w.settings.graphics, quality: 'high', bloom: true, shadows: true, ssao: true, resolutionScale: scale, fov: 72 } });
    }, [weather, hour, scale]);
    for (const [name, x, z, yaw, pitch] of views) {
      await page.evaluate(([x, z, yaw, pitch]) => {
        const w = window.__app.world, p = w.player;
        if (w.actions.seatedId) w.actions.leaveSeat?.();
        p.transition = null; p.setPose(x, z, yaw, pitch || 0);
        for (let i = 0; i < 40; i++) w.updateDoor(0.05);
      }, [x, z, yaw, pitch]);
      for (let i = 0; i < 12; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(50); }
      await shot(`${tag}-${weather}${hour}-${name}`);
    }
  }
};
