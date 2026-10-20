// Frame times on the real graphics card (run with GPU=1): walks a fixed route through the hall, the book room and the
// garden (the terrace, the path at the lake) and reports frame-time percentiles, long frames and where the CPU time of
// a frame goes.
// PERF_W / PERF_H set the window size (default 1920×1080).
module.exports = async ({ app, page, sleep, shot }) => {
  const W = +process.env.PERF_W || 1920, H = +process.env.PERF_H || 1080;
  await app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(w, h); }, [W, H]);
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(2500);
  const info = await page.evaluate(() => {
    const w = window.__app.world, r = w.renderer, gl = r.getContext();
    let gpu = '';
    try { const ext = gl.getExtension('WEBGL_debug_renderer_info'); gpu = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL); } catch {}
    return { gpu, size: [innerWidth, innerHeight], dpr: devicePixelRatio, quality: w.quality, ao: w.ao.enabled, bloom: w.bloom.enabled, msaa: w.msaa, lamps: w.lamps.length, glows: w.glows.length, books: w.books.entries.size };
  });
  console.log('INFO ' + JSON.stringify(info));

  // instrument World#frame: total CPU time per call and the render part
  await page.evaluate(() => {
    const w = window.__app.world;
    const P = window.__perf = { frames: [], cpu: [], render: [], shadowSun: 0, shadowFire: 0, t0: 0 };
    const origFrame = w.frame.bind(w);
    const comp = w.composer, origRender = comp.render.bind(comp), rr = w.renderer, origR = rr.render.bind(rr);
    comp.render = (dt) => { const a = performance.now(); origRender(dt); P.render.push(performance.now() - a); };
    rr.render = (s, c) => { if (!w.bloom.enabled && !w.ao.enabled && s === w.scene) { const a = performance.now(); origR(s, c); P.render.push(performance.now() - a); } else origR(s, c); };
    w.frame = () => { const a = performance.now(); if (w.env?.sun?.shadow?.needsUpdate) P.shadowSun++; if (w.fire?.light?.shadow?.needsUpdate) P.shadowFire++; origFrame(); P.cpu.push(performance.now() - a); };
    let last = 0;
    const tick = (t) => { if (last) P.frames.push(t - last); last = t; if (P.on) requestAnimationFrame(tick); };
    P.on = true; requestAnimationFrame(tick);
  });

  // PERF_ROUTE='[["name", x, z, yaw, pitch], …]' replaces the route
  const route = process.env.PERF_ROUTE ? JSON.parse(process.env.PERF_ROUTE) : [
    ['hall', 5.4, 0.4, -Math.PI / 2, 0],
    ['hall-fire', 0, 0, Math.PI / 2, 0],
    ['passage', 0, -4.0, 0, 0],
    ['room', 0, -12, 0, 0],
    ['room-walk', 7.5, -12, 0, 0],
    ['garden', -2.5, -1.0, Math.PI - 0.8, 0],   // the glass front and the garden behind it
    ['terrace', 0.4, 8.0, Math.PI + 0.45, 0],    // out on the deck, towards the lake
    ['lake', -16.6, 33.4, 2.3, -0.05],           // on the path at the jetty, over the water
  ];
  const stats = (a) => { const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))] || 0; return { n: s.length, avg: +(s.reduce((x, y) => x + y, 0) / Math.max(1, s.length)).toFixed(2), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +q(1).toFixed(2), over25: s.filter((x) => x > 25).length, over40: s.filter((x) => x > 40).length }; };
  for (const [name, x, z, yaw, pitch] of route) {
    await page.evaluate(([x, z, yaw, pitch]) => { const p = window.__app.world.player; p.transition = null; p.setPose(x, z, yaw, pitch); const P = window.__perf; P.frames.length = 0; P.cpu.length = 0; P.render.length = 0; P.shadowSun = 0; P.shadowFire = 0; }, [x, z, yaw, pitch]);
    // walk forward and turn a little (key events on the document, like the real keyboard)
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true })));
    const t0 = Date.now();
    while (Date.now() - t0 < 4000) { await page.evaluate(() => { window.__app.world.player.yaw += 0.02; }); await sleep(50); }
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true })));
    const r = await page.evaluate(() => ({ frames: window.__perf.frames.slice(), cpu: window.__perf.cpu.slice(), render: window.__perf.render.slice(), sun: window.__perf.shadowSun, fire: window.__perf.shadowFire, calls: window.__app.world.renderer.info.render.calls, tris: window.__app.world.renderer.info.render.triangles }));
    console.log(`VIEW ${name} frame=${JSON.stringify(stats(r.frames))} cpu=${JSON.stringify(stats(r.cpu))} render=${JSON.stringify(stats(r.render))} sunShadow=${r.sun} fireShadow=${r.fire} calls=${r.calls} tris=${r.tris}`);
    if (process.env.PERF_SHOT) await shot('perf-' + name);
  }
  await page.evaluate(() => { window.__perf.on = false; });
};
