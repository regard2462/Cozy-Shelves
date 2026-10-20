// The GPU time of every draw call of the scene (the performance strand of 0.9): at a few views and a tier, every
// renderBufferDirect of the RenderPass (and of the AO's normal pass) gets a timer query of its own over PD_N frames drawn
// back to back (no shadow map redrawn meanwhile); the times are summed per object (its name or its parent's, with the
// material's type) and the biggest are printed with their share of the pass. A query per draw adds a little to every
// draw, so the sums say where the time goes, not what the frame costs (perf-matrix says that).
//   node build/screenshot.js perf-draws     PD_VIEWS=hall,shelves,terrace,jetty   PD_N=20   PD_TOP=30   PD_TIER=high
//   PERF_EMU=2560x1440 for the big drawing buffer
module.exports = async ({ app, page, sleep }) => {
  const W = +process.env.PERF_W || 1600, H = +process.env.PERF_H || 900;
  await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setContentSize(w, h); }, [W, H]);
  const emu = process.env.PERF_EMU ? process.env.PERF_EMU.split('x').map(Number) : null;
  const N = +process.env.PD_N || 20, top = +process.env.PD_TOP || 30;
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  let last = -1, quiet = 0;
  for (let i = 0; i < 300; i++) {
    const st = await page.evaluate(() => { const b = window.__app.state.library.books; return { n: b.length, idx: b.filter((x) => x.indexed).length, active: !!window.__app.state.library.scan?.active }; });
    if (st.n > 0 && st.idx === st.n && !st.active) { quiet = st.n === last ? quiet + 1 : 0; if (quiet >= 2) break; }
    last = st.n;
    await sleep(1500);
  }
  await sleep(10500);
  await page.evaluate(() => { window.__app.world.stop(); window.__app.closeAllPanels(); document.querySelector('#hud')?.style.setProperty('opacity', '0'); });
  await page.evaluate(([emu, tier]) => {
    const w = window.__app.world, gl = w.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const px = new Uint8Array(4), wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const P = window.__pd = { w, gl, ext, wait };
    P.sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    P.emu = () => { if (!emu) return; const pr = emu[0] / innerWidth; w.renderer.setPixelRatio(pr); w.renderer.setSize(innerWidth, innerHeight, false); w.composer.setPixelRatio(pr); w.composer.setSize(innerWidth, innerHeight); };
    w.applySettings({ ...w.settings, weather: 'clear', timeMode: 'fixed', fixedHour: 11, graphics: { ...w.settings.graphics, quality: tier, bloom: true, shadows: true, ssao: true, resolutionScale: 1, fov: 72, godrays: true } });
    P.emu();
    P.view = async (x, z, yaw, pitch) => { const p = w.player; if (w.actions.seatedId) w.actions.leaveSeat?.(); p.transition = null; p.setPose(x, z, yaw, pitch); for (let i = 0; i < 40; i++) w.updateDoor(0.05); for (let i = 0; i < 24; i++) { w.frame(); P.sync(); if (i === 2) w.godrays.settle(); await wait(3); } };
  }, [emu, process.env.PD_TIER || 'high']);
  const VIEWS = { hall: [0, 0, Math.PI / 2, 0], shelves: null, room: [0, -12, 0, 0], terrace: [0.6, 8.7, Math.PI + 0.15, 0.05], jetty: [-22, 37, 2.15, 0.02], glass: [0, -2.2, Math.PI, 0.05] };
  VIEWS.shelves = await page.evaluate(() => { const w = window.__app.world; const count = (bc) => bc.rows.reduce((a, r) => a + r.items.length, 0); const bc = [...w.layout.bookcases].sort((a, b) => count(b) - count(a))[0]; const fx = Math.sin(bc.rot), fz = Math.cos(bc.rot); return [bc.x + fx * 1.5, bc.z + fz * 1.5, Math.atan2(fx, fz), -0.05]; });
  const views = (process.env.PD_VIEWS || 'hall,shelves,terrace,jetty').split(',');
  for (const view of views) {
    const r = await page.evaluate(async ([pose, N]) => {
      const P = window.__pd, w = P.w, gl = P.gl, ext = P.ext, rr = w.renderer;
      if (!ext) return null;
      await P.view(...pose);
      const env = w.env, g = w.godrays, orig = g.beforeRender;
      g.beforeRender = function (dt) { orig.call(this, dt); env.sun.shadow.needsUpdate = false; if (w.fire) w.fire.light.shadow.needsUpdate = false; };
      let phase = null, on = false;
      const queries = [];
      const label = (object, material) => {
        let o = object, n = '';
        while (o && !n) { n = o.name; o = o.parent; }
        return `${n || '?'} [${material.name || material.type}${object.isInstancedMesh ? ' ×' + object.count : ''}]`;
      };
      const ob = rr.renderBufferDirect;
      rr.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
        if (!on || !phase) return ob.call(this, camera, scene, geometry, material, object, group);
        const q = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        const res = ob.call(this, camera, scene, geometry, material, object, group);
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        queries.push([phase, label(object, material), q]);
        return res;
      };
      // (the scene's own draws: the shadow maps are drawn inside the RenderPass too, but none is redrawn here)
      const wraps = [];
      for (const p of w.composer.passes) {
        const name = p.constructor.name;
        if (name !== 'RenderPass' && name !== 'SoftAO') continue;
        const f = p.render;
        p.render = function (...a) { phase = name; try { return f.apply(this, a); } finally { phase = null; } };
        wraps.push(() => { p.render = f; });
      }
      // the AO's full-screen passes are not draws of objects: only its normal pass is counted (renderer.render inside)
      const sum = {}, count = {};
      try {
        for (let i = 0; i < 10; i++) w.frame();
        on = true; for (let i = 0; i < N; i++) w.frame(); on = false;
        const lastQ = queries[queries.length - 1]?.[2];
        for (let k = 0; lastQ && k < 4000 && !gl.getQueryParameter(lastQ, gl.QUERY_RESULT_AVAILABLE); k++) await P.wait(2);
        const dis = gl.getParameter(ext.GPU_DISJOINT_EXT);
        for (const [ph, lb, q] of queries) {
          if (!dis && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) { const k = ph + '|' + lb; sum[k] = (sum[k] || 0) + gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; count[k] = (count[k] || 0) + 1; }
          gl.deleteQuery(q);
        }
      } finally { rr.renderBufferDirect = ob; for (const un of wraps) un(); g.beforeRender = orig; }
      const byPhase = {};
      for (const [k, v] of Object.entries(sum)) { const ph = k.split('|')[0]; byPhase[ph] = (byPhase[ph] || 0) + v / N; }
      const list = Object.entries(sum).map(([k, v]) => [k, +(v / N).toFixed(3), Math.round(count[k] / N)]).sort((a, b) => b[1] - a[1]);
      return { byPhase: Object.fromEntries(Object.entries(byPhase).map(([k, v]) => [k, +v.toFixed(3)])), list, buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight] };
    }, [VIEWS[view], N]);
    if (!r) { console.log('DRAWS no timer queries'); break; }
    console.log(`DRAWS ${view} buf=${r.buffer.join('x')} ${JSON.stringify(r.byPhase)}`);
    for (const [k, ms, n] of r.list.slice(0, top)) console.log(`DRAW ${view} ${ms.toFixed(3).padStart(7)} ms ${String(n).padStart(3)} calls  ${k}`);
  }
};
