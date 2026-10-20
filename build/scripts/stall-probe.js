// Developer probe: walks the gpu-perf route and reports every long frame with what happened in it (new shader
// programs, texture uploads, CPU and render time), to find the cause of a hitch. Prints numbers only.
module.exports = async ({ app, page, sleep }) => {
  const W = +process.env.PERF_W || 1920, H = +process.env.PERF_H || 1080;
  await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setContentSize(w, h); }, [W, H]);
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(2500);
  await page.evaluate(() => {
    const w = window.__app.world, r = w.renderer;
    const P = window.__stall = { rows: [], view: '', seen: new Set(r.info.programs.map((p) => p.cacheKey)), on: true };
    const comp = w.composer, origRender = comp.render.bind(comp);
    let renderMs = 0;
    comp.render = (dt) => { const a = performance.now(); origRender(dt); renderMs = performance.now() - a; };
    const origFrame = w.frame.bind(w);
    let last = 0;
    w.frame = () => {
      const t = performance.now();
      const up0 = w.pendingUploads?.length || 0, tex0 = r.info.memory.textures;
      renderMs = 0;
      origFrame();
      const cpu = performance.now() - t;
      const fresh = r.info.programs.filter((p) => !P.seen.has(p.cacheKey));
      for (const p of fresh) P.seen.add(p.cacheKey);
      P.rows.push({ wall: Date.now(), view: P.view, dt: last ? t - last : 0, cpu, render: renderMs, programs: fresh.map((p) => p.name + ':' + String(p.cacheKey).slice(0, 60)), uploads: up0 - (w.pendingUploads?.length || 0), texNew: r.info.memory.textures - tex0 });
      last = t;
    };
  });
  const route = [
    ['hall', 5.4, 0.4, -Math.PI / 2, 0],
    ['hall-fire', 0, 0, Math.PI / 2, 0],
    ['passage', 0, -4.0, 0, 0],
    ['room', 0, -12, 0, 0],
    ['room-walk', 7.5, -12, 0, 0],
  ];
  for (const [name, x, z, yaw, pitch] of route) {
    await page.evaluate(([name, x, z, yaw, pitch]) => { const p = window.__app.world.player; p.transition = null; p.setPose(x, z, yaw, pitch); window.__stall.view = name; }, [name, x, z, yaw, pitch]);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true })));
    const t0 = Date.now();
    while (Date.now() - t0 < 4000) { await page.evaluate(() => { window.__app.world.player.yaw += 0.02; }); await sleep(50); }
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true })));
  }
  const out = await page.evaluate(() => {
    const P = window.__stall; P.on = false;
    const rows = P.rows;
    const slow = rows.map((r, i) => ({ i, ...r })).filter((r) => r.dt > 30 || r.cpu > 20 || r.programs.length);
    return { frames: rows.length, slow: slow.map((r) => ({ i: r.i, wall: new Date(r.wall).toISOString().slice(11, 23), view: r.view, dt: +r.dt.toFixed(1), cpu: +r.cpu.toFixed(1), render: +r.render.toFixed(1), programs: r.programs, uploads: r.uploads, texNew: r.texNew })) };
  });
  console.log('STALL ' + JSON.stringify({ frames: out.frames, slow: out.slow.length }));
  for (const s of out.slow) console.log('SLOW ' + JSON.stringify(s));
};
