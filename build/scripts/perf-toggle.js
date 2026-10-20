// A/B inside one run (the performance strand of 0.9): two states of the world set by two snippets of JavaScript (PT_A and
// PT_B, evaluated in the page with `w` = the World, run before every block of frames), measured in alternating blocks of
// PT_N frames (A B A B …, PT_ROUNDS rounds) with timer queries, the frames back to back, no shadow map redrawn
// meanwhile. Prints per view the median GPU time of A and of B and of each round, so a difference stands out against
// the spread. For changes that can be switched in the running world (a flag of a render target, a uniform).
//   node build/screenshot.js perf-toggle   PT_A="w.composer.renderTarget1.resolveDepthBuffer = true"
//   PT_B="w.composer.renderTarget1.resolveDepthBuffer = false"   PT_VIEWS=hall,shelves   PT_COND=night   PERF_EMU=2560x1440
//   PT_TIER=high   PT_N=40   PT_ROUNDS=4   PT_EVERY="..." (run before every frame of both, after the state's snippet)
//   PT_CPU=1 measures the CPU time of World#frame instead (each frame finished on the card before the next)
module.exports = async ({ app, page, sleep }) => {
  const W = +process.env.PERF_W || 1600, H = +process.env.PERF_H || 900;
  await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setContentSize(w, h); }, [W, H]);
  const emu = process.env.PERF_EMU ? process.env.PERF_EMU.split('x').map(Number) : null;
  const N = +process.env.PT_N || 40, rounds = +process.env.PT_ROUNDS || 4;
  const A = process.env.PT_A || '', B = process.env.PT_B || '', every = process.env.PT_EVERY || '';
  const conds = { day: { hour: 11, weather: 'clear' }, night: { hour: 23, weather: 'clear' }, rain: { hour: 14, weather: 'rain' }, golden: { golden: true, weather: 'clear' } };
  const cond = conds[process.env.PT_COND || 'day'];
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
  await page.evaluate(([emu, tier, cond]) => {
    const w = window.__app.world, gl = w.renderer.getContext();
    const px = new Uint8Array(4), wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const P = window.__pt = { w, gl, ext: gl.getExtension('EXT_disjoint_timer_query_webgl2'), wait };
    P.sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t = cond.golden ? { timeMode: 'golden' } : { timeMode: 'fixed', fixedHour: cond.hour };
    w.applySettings({ ...w.settings, weather: cond.weather, ...t, graphics: { ...w.settings.graphics, quality: tier, bloom: true, shadows: true, ssao: true, resolutionScale: 1, fov: 72, godrays: true } });
    if (emu) { const pr = emu[0] / innerWidth; w.renderer.setPixelRatio(pr); w.renderer.setSize(innerWidth, innerHeight, false); w.composer.setPixelRatio(pr); w.composer.setSize(innerWidth, innerHeight); }
    P.view = async (x, z, yaw, pitch) => { const p = w.player; if (w.actions.seatedId) w.actions.leaveSeat?.(); p.transition = null; p.setPose(x, z, yaw, pitch); for (let i = 0; i < 40; i++) w.updateDoor(0.05); for (let i = 0; i < 24; i++) { w.frame(); P.sync(); if (i === 2) w.godrays.settle(); await wait(3); } };
    P.med = (a) => { const s = a.filter((v) => v != null).sort((x, y) => x - y); return s.length ? +s[s.length >> 1].toFixed(3) : null; };
  }, [emu, process.env.PT_TIER || 'high', cond]);
  const VIEWS = { hall: [0, 0, Math.PI / 2, 0], shelves: null, room: [0, -12, 0, 0], terrace: [0.6, 8.7, Math.PI + 0.15, 0.05], jetty: [-22, 37, 2.15, 0.02], glass: [0, -2.2, Math.PI, 0.05] };
  VIEWS.shelves = await page.evaluate(() => { const w = window.__app.world; const count = (bc) => bc.rows.reduce((a, r) => a + r.items.length, 0); const bc = [...w.layout.bookcases].sort((a, b) => count(b) - count(a))[0]; const fx = Math.sin(bc.rot), fz = Math.cos(bc.rot); return [bc.x + fx * 1.5, bc.z + fz * 1.5, Math.atan2(fx, fz), -0.05]; });
  // (the snippets become functions through the DevTools protocol: the page's content security policy forbids eval)
  await page.evaluate(`window.__pt.setA = (w) => { ${A} }; window.__pt.setB = (w) => { ${B} }; window.__pt.each = (w) => { ${every} }; window.__ptCpu = ${process.env.PT_CPU === '1'};`);
  for (const view of (process.env.PT_VIEWS || 'hall,shelves').split(',')) {
    const r = await page.evaluate(async ([pose, N, rounds]) => {
      const P = window.__pt, w = P.w, gl = P.gl, ext = P.ext;
      if (!ext) return null;
      await P.view(...pose);
      const env = w.env, g = w.godrays, orig = g.beforeRender;
      g.beforeRender = function (dt) { orig.call(this, dt); env.sun.shadow.needsUpdate = false; if (w.fire) w.fire.light.shadow.needsUpdate = false; };
      const setA = P.setA, setB = P.setB, each = P.each;
      // PT_CPU=1: the CPU time of World#frame instead (each frame finished on the card before the next)
      const cpuBlock = async (set) => {
        set(w);
        for (let i = 0; i < 10; i++) { each(w); w.frame(); P.sync(); }
        const out = [];
        for (let i = 0; i < N; i++) { each(w); const t = performance.now(); w.frame(); out.push(performance.now() - t); P.sync(); if (i % 20 === 19) await P.wait(1); }
        return out;
      };
      const gpuBlock = async (set) => {
        set(w);
        for (let i = 0; i < 10; i++) { each(w); w.frame(); }
        const qs = [];
        for (let i = 0; i < N; i++) { each(w); const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); w.frame(); gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); }
        for (let k = 0; k < 2000 && !gl.getQueryParameter(qs[qs.length - 1], gl.QUERY_RESULT_AVAILABLE); k++) await P.wait(2);
        const dis = gl.getParameter(ext.GPU_DISJOINT_EXT);
        const out = qs.map((q) => (!dis && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) ? gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 : null));
        for (const q of qs) gl.deleteQuery(q);
        return out;
      };
      const block = window.__ptCpu ? cpuBlock : gpuBlock;
      const all = { A: [], B: [] }, per = [];
      try {
        for (let k = 0; k < rounds; k++) {
          const a = await block(setA), b = await block(setB);
          all.A.push(...a); all.B.push(...b); per.push([P.med(a), P.med(b)]);
        }
      } finally { setA(w); g.beforeRender = orig; }
      return { A: P.med(all.A), B: P.med(all.B), rounds: per, buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight] };
    }, [VIEWS[view], N, rounds]);
    if (!r) { console.log('TOGGLE no timer queries'); break; }
    console.log(`TOGGLE${process.env.PT_CPU === '1' ? '-CPU' : ''} ${view} buf=${r.buffer.join('x')} A=${r.A} B=${r.B} diff=${(r.B - r.A).toFixed(3)} rounds=${JSON.stringify(r.rounds)}`);
  }
};
