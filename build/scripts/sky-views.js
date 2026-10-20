// Screenshots of the sky, the garden and the windows under chosen conditions (for looking at the night sky, the
// weather and the window glass by eye). SV_COND='[{"name":"clear23","weather":"clear","hour":23}, …]' (any other keys
// are settings, e.g. "sky": {...}; "moon": 0.5 sets the moon's phase, "date": "2026-12-20" the night's sky, "oldGlass":
// true the glass of before), SV_VIEWS='[["name", x, z, yaw,
// pitch], …]' or a place id instead of the coordinates (["jetty"]). SV_SIZE=1600x900 (window), SV_SCALE (resolution
// scale, default 1), SHOT_TAG prefixes the file names (<tag>-<cond>-<view>.png).
//   node build/screenshot.js sky-views
module.exports = async ({ app, page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || 'sv';
  const [W, H] = (process.env.SV_SIZE || '1600x900').split('x').map(Number);
  await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setContentSize(w, h); }, [W, H]);
  const views = process.env.SV_VIEWS ? JSON.parse(process.env.SV_VIEWS) : [['terrace', 0.4, 8.6, Math.PI + 0.35, 0.3], ['jetty'], ['hall', 0.3, 2.2, Math.PI, 0.12]];
  const conds = process.env.SV_COND ? JSON.parse(process.env.SV_COND) : [{ name: 'clear23', weather: 'clear', hour: 23 }];
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(2000);
  await page.evaluate(() => { window.__app.world.stop(); window.__app.closeAllPanels(); document.querySelector('#hud')?.style.setProperty('opacity', '0'); });
  const scale = +process.env.SV_SCALE || 1;
  for (const c of conds) {
    await page.evaluate(([c, scale]) => {
      const w = window.__app.world;
      const { name, hour, moon, frames, date, milky, oldGlass, ...rest } = c;
      const time = hour == null ? {} : { timeMode: 'fixed', fixedHour: hour };
      w.applySettings({ ...w.settings, ...time, ...rest, graphics: { ...w.settings.graphics, quality: 'high', bloom: true, shadows: true, ssao: true, resolutionScale: scale, fov: 72, ...(rest.graphics || {}) } });
      // date: 'YYYY-MM-DD' for the sky of that night (the stars); milky: a factor on the Milky Way's brightness
      if (date) { const d = new Date(date + 'T00:00:00'); w.sky.day0 = d.getTime(); }
      if (milky != null) { const U = w.env.uniforms.SKY; w.env.apply = ((orig) => function () { orig.call(this); U.uMilky.value *= milky; })(Object.getPrototypeOf(w.env).apply); }
      else delete w.env.apply;
      w.sky.moonOverride = moon ?? null; w.sky.push();
      // oldGlass: the glass of before (sharp lamp highlights, no room in it) for comparisons
      let lamps = null; w.scene.traverse((o) => { if (!lamps && o.material?.userData?.lamps) lamps = o.material.userData.lamps; });
      if (lamps) {
        lamps.__keep ??= [lamps.glint.value, lamps.rough.value];
        if (oldGlass) { lamps.glint.value = 1; lamps.rough.value = 0; w.reflections.frame = () => { lamps.room.uRoomRefl.value = 0; }; }
        else { [lamps.glint.value, lamps.rough.value] = lamps.__keep; delete w.reflections.frame; }
      }
    }, [c, scale]);
    for (const v of views) {
      await page.evaluate((v) => {
        const w = window.__app.world, p = w.player;
        let [, x, z, yaw, pitch] = v;
        if (x == null) { const pl = w.places.find((q) => q.id === v[0]); x = pl.x; z = pl.z; yaw = pl.yaw; pitch = v[4] ?? 0.08; }
        if (w.actions.seatedId) w.actions.leaveSeat?.();
        p.transition = null; p.setPose(x, z, yaw, pitch || 0);
        for (let i = 0; i < 40; i++) w.updateDoor(0.05);
      }, v);
      for (let i = 0; i < (c.frames || 14); i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(40); }
      // mean brightness (0 … 255) of the top fifth (sky), the middle and the bottom quarter (ground) of the picture
      const lum = await page.evaluate(() => {
        const w = window.__app.world, gl = w.renderer.getContext(); w.frame();
        const cw = gl.drawingBufferWidth, ch = gl.drawingBufferHeight, buf = new Uint8Array(cw * ch * 4);
        gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        const band = (y0, y1) => { let s = 0, n = 0; for (let y = Math.floor(y0 * ch); y < Math.floor(y1 * ch); y += 2) for (let x = 0; x < cw; x += 2) { const i = ((ch - 1 - y) * cw + x) * 4; s += 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]; n++; } return +(s / n).toFixed(1); };
        return { top: band(0, 0.2), mid: band(0.4, 0.6), bottom: band(0.75, 1), exp: +w.renderer.toneMappingExposure.toFixed(2) };
      });
      console.log(`LUM ${c.name}-${v[0]} ${JSON.stringify(lum)}`);
      await shot(`${tag}-${c.name}-${v[0]}`);
    }
  }
};
