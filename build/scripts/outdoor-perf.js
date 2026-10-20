// Frame times while moving through the garden: the eye glides at walking pace along a fixed route (the terrace, the
// path to the lake, the shore, the edge of the wood, the knoll, the meadow) and every frame is drawn as in the app.
// Reports the CPU time of World#frame and the intervals between frames (median, 95 %, 99 %, maximum, frames over
// 25 ms), every frame over 25 ms with where it happened, and every shader compiled on the way. It glides (setPose), so
// it also runs on versions where the garden cannot be walked. PERF_WEATHER (default fog), PERF_HOUR (15), PERF_W/H.
//   node build/screenshot.js outdoor-perf
module.exports = async ({ app, page, sleep }) => {
  const W = +process.env.PERF_W || 1600, H = +process.env.PERF_H || 900;
  await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setContentSize(w, h); }, [W, H]);
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(2000);
  const weathers = (process.env.PERF_WEATHER || 'fog').split(',');
  for (const weather of weathers) {
    const r = await page.evaluate(async ([weather, hour]) => {
      const w = window.__app.world, p = w.player;
      w.stop(); window.__app.closeAllPanels();
      w.applySettings({ ...w.settings, weather, timeMode: 'fixed', fixedHour: hour, graphics: { ...w.settings.graphics, quality: 'high', bloom: true, shadows: true, ssao: true, resolutionScale: 1.4, fov: 72 } });
      const route = [[0.3, 7.2], [0.2, 12.5], [-1.4, 17], [-4.4, 22.5], [-8.6, 27.5], [-12.6, 30.6], [-18.6, 35.0], [-24.0, 38.6], [-18.6, 35.0], [-13.2, 37.6], [-10.6, 42.5], [-9.6, 48], [-3.5, 54], [3.4, 52.4], [8.6, 49], [11, 44.4], [10, 33], [3, 22], [0.3, 9]];
      const ground = (x, z) => (p.groundAt ? p.groundAt(x, z) : 0);   // (versions before 0.6: no ground to follow)
      const pose = (x, z, yaw) => { p.transition = null; p.setPose(x, z, yaw, -0.03); };
      pose(...route[0], Math.PI);
      for (let i = 0; i < 30; i++) w.frame();
      await new Promise((res) => setTimeout(res, 500));
      const known = new Set(w.renderer.info.programs);
      const cpu = [], gaps = [], slow = [];
      let leg = 1, x = route[0][0], z = route[0][1], last = performance.now(), yaw = Math.PI;
      await new Promise((done) => {
        const tick = (t) => {
          const dt = Math.min(0.1, (t - last) / 1000); gaps.push(t - last); last = t;
          // glide at 2.4 m/s towards the next point of the route, turning smoothly
          const [tx, tz] = route[leg], dx = tx - x, dz = tz - z, d = Math.hypot(dx, dz), step = 2.4 * dt;
          if (d <= step) { x = tx; z = tz; leg++; } else { x += dx / d * step; z += dz / d * step; }
          const want = Math.atan2(-dx, -dz); let dy = want - yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI; yaw += dy * Math.min(1, dt * 3);
          pose(x, z, yaw); p.position.y = 1.62 + ground(x, z);
          const np = w.renderer.info.programs.length, a = performance.now();
          w.frame();
          const c = performance.now() - a; cpu.push(c);
          if (c > 25 && slow.length < 20) slow.push({ i: cpu.length, ms: +c.toFixed(1), at: [+x.toFixed(1), +z.toFixed(1)], newProg: w.renderer.info.programs.length - np });
          if (leg < route.length) requestAnimationFrame(tick); else done();
        };
        requestAnimationFrame((t) => { last = t; requestAnimationFrame(tick); });
      });
      const added = w.renderer.info.programs.filter((q) => !known.has(q)).map((q) => (q.name || '?') + ' | ' + String(q.cacheKey));
      const st = (a) => { const s = [...a].sort((u, v) => u - v), q = (f) => +(s[Math.min(s.length - 1, Math.floor(f * s.length))] || 0).toFixed(2); return { n: s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1), over25: s.filter((v) => v > 25).length }; };
      return { weather, cpu: st(cpu), frames: st(gaps.slice(1)), slow, added };
    }, [weather, +process.env.PERF_HOUR || 15]);
    console.log(`OPERF ${r.weather} cpu=${JSON.stringify(r.cpu)} frames=${JSON.stringify(r.frames)} newPrograms=${r.added.length}`);
    for (const s of r.slow) console.log(`OPERF-SLOW ${r.weather} ${JSON.stringify(s)}`);
    for (const a of r.added) console.log(`OPERF-PROGRAM ${r.weather} ${a.slice(0, 900)}`);
  }
};
