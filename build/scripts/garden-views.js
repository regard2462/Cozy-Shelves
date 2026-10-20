// Pictures of the garden by season, weather and hour from places a visitor stands (the terrace, the jetty, the shore,
// the fire bowl): GV_VIEWS='[["name", x, z, yaw, pitch, y?], …]' (y: eye height, default standing),
// GV_COND='[["summer", "clear", 15], …]' (season, weather, fixed hour), GV_FIRE=on|off (the fire bowl; default by the
// clock), GV_SCALE (resolution scale, default 1), GV_SIZE=WxH (window, default 1600x900). SHOT_TAG prefixes the
// files (<tag>-<season>-<weather><hour>-<view>.png). Muted and hidden like every harness script.
//   node build/screenshot.js garden-views
module.exports = async ({ app, page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || 'gv';
  const [W, H] = (process.env.GV_SIZE || '1600x900').split('x').map(Number);
  await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setContentSize(w, h); }, [W, H]);
  const views = process.env.GV_VIEWS ? JSON.parse(process.env.GV_VIEWS) : [
    ['terrace', 0.4, 8.6, 2.455, 0.0],
    ['jetty', -24.5, 39.2, -2.3, -0.12],
    ['firebowl', -13.0, 19.45, 1.615, -0.18],
  ];
  const conds = process.env.GV_COND ? JSON.parse(process.env.GV_COND) : [['summer', 'clear', 15]];
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(2000);
  await page.evaluate(() => { window.__app.world.stop(); window.__app.closeAllPanels(); document.querySelector('#hud')?.style.setProperty('opacity', '0'); });
  const scale = +process.env.GV_SCALE || 1;
  for (const [season, weather, hour] of conds) {
    await page.evaluate(([season, weather, hour, scale, fire]) => {
      const w = window.__app.world;
      w.applySettings({ ...w.settings, season, weather, timeMode: 'fixed', fixedHour: hour, graphics: { ...w.settings.graphics, quality: 'high', bloom: true, shadows: true, ssao: true, resolutionScale: scale, fov: 72 } });
      w.env.set({ hour });
      const g = w.env.garden;
      g.seasons.settle(); g.lilies.settle();
      if (fire === 'on' || fire === 'off') w.fireBowl.setBurning(fire === 'on');
      w.fireBowl.settle();
      w.godrays?.settle?.();
    }, [season, weather, hour, scale, process.env.GV_FIRE || '']);
    for (const [name, x, z, yaw, pitch, y] of views) {
      await page.evaluate(([x, z, yaw, pitch, y]) => {
        const w = window.__app.world, p = w.player;
        if (w.actions.seatedId) w.actions.leaveSeat?.();
        p.transition = null; p.setPose(x, z, yaw, pitch || 0);
        if (y) p.position.y = y;
        for (let i = 0; i < 40; i++) w.updateDoor(0.05);
      }, [x, z, yaw, pitch, y || 0]);
      for (let i = 0; i < 14; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(40); }
      await shot(`${tag}-${season}-${weather}${hour}-${name}`);
    }
  }
};
