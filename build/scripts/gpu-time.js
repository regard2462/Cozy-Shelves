// GPU time per frame from fixed views (GPU=1), measured with timer queries (EXT_disjoint_timer_query_webgl2): the rAF
// interval of gpu-perf is capped by the display's refresh rate and hides everything below one vsync. Without the
// extension every frame is followed by a 1-pixel readPixels, which waits for the graphics card (less exact).
// Prints per view the 10th percentile (the least disturbed frames when other programs share the graphics card), the
// median, the 90th percentile and the draw calls of the whole frame (all passes).
// VIEWS='[["name", x, z, yaw, pitch], …]' (default: hall, garden through the glass, terrace, passage, book room).
// TIME_N frames per view (default 120). TIME_HIDE='leaf,bark,grass,garden,sky' leaves those out (a garden material
// kind or an object name) to see their share. PERF_W / PERF_H set the window size (default 1920×1080).
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
  await sleep(3000);
  await page.evaluate(() => window.__app.world.stop());
  const views = JSON.parse(process.env.VIEWS || JSON.stringify([
    ['hall', 5.4, 0.4, -Math.PI / 2, 0],
    ['garden', 0, -2.2, Math.PI, 0.05],
    ['garden-side', -2.5, -1.0, Math.PI - 0.8, 0],
    ['terrace', 0, 8.2, Math.PI, 0.02],
    ['passage', 0, -4.0, 0, 0],
    ['room', 0, -12, 0, 0],
  ]));
  const N = +process.env.TIME_N || 120;
  if (process.env.TIME_HIDE) await page.evaluate((list) => {
    const hide = new Set(list.split(','));
    window.__app.world.scene.traverse((o) => { if (hide.has(o.name) || hide.has(o.material?.userData?.nature)) { o.visible = false; if (o.isInstancedMesh) o.count = 0; } });
  }, process.env.TIME_HIDE);
  const info = await page.evaluate(() => { const w = window.__app.world, gl = w.renderer.getContext(); return { size: [innerWidth, innerHeight], quality: w.quality, lamps: w.lamps.length, glows: w.glows.length, timer: !!gl.getExtension('EXT_disjoint_timer_query_webgl2') }; });
  console.log('INFO ' + JSON.stringify(info));
  for (const [name, x, z, yaw, pitch] of views) {
    const r = await page.evaluate(async ([x, z, yaw, pitch, N]) => {
      const w = window.__app.world, gl = w.renderer.getContext(), px = new Uint8Array(4);
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      const p = w.player; if (w.actions.seatedId) w.actions.leaveSeat?.();
      p.transition = null; p.setPose(x, z, yaw, pitch);
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let i = 0; i < 30; i++) { w.frame(); sync(); await wait(4); }
      const t = [];
      for (let i = 0; i < N; i++) {
        if (ext) {
          const q = gl.createQuery();
          gl.beginQuery(ext.TIME_ELAPSED_EXT, q); w.frame(); gl.endQuery(ext.TIME_ELAPSED_EXT);
          let tries = 0;
          while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && tries++ < 200) await wait(2);
          const bad = gl.getParameter(ext.GPU_DISJOINT_EXT);
          if (!bad) t.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(q);
        } else {
          const a = performance.now(); w.frame(); sync(); t.push(performance.now() - a);
          await wait(2);
        }
      }
      t.sort((a, b) => a - b);
      const q = (f) => +t[Math.min(t.length - 1, Math.floor(f * t.length))].toFixed(2);
      // draw calls of the whole frame (all passes, shadow maps included)
      const info = w.renderer.info; info.autoReset = false; info.reset(); w.frame(); sync();
      const calls = info.render.calls, tris = info.render.triangles; info.autoReset = true;
      return { p10: q(0.1), p50: q(0.5), p90: q(0.9), min: q(0), calls, tris };
    }, [x, z, yaw, pitch, N]);
    console.log(`TIME ${name} ${JSON.stringify(r)}`);
  }
};
