// Where the time of a frame goes (the performance strand of 0.9): at a few views and the high tier, the GPU time of the
// frame with parts of the world left out in turn (the garden, the books, the sky, every material replaced by a plain
// one: the raster cost alone), the steps of the AO pass one by one (the normal pass, the AO, the denoise, the output),
// and the draw calls of one frame listed by pass (the sun's map, the fire's cube map, the scene, the AO's normal pass)
// and by object. Prints GRAPH, PROBE, AOSTEPS and CALLS lines; PERF_EMU=2560x1440 for the big drawing buffer, PB_VIEWS,
// PB_N, PB_TIER (high unless given).
//   node build/screenshot.js perf-probe
module.exports = async ({ app, page, sleep }) => {
  const W = +process.env.PERF_W || 1600, H = +process.env.PERF_H || 900;
  await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setContentSize(w, h); }, [W, H]);
  const emu = process.env.PERF_EMU ? process.env.PERF_EMU.split('x').map(Number) : null;
  const N = +process.env.PB_N || 40;
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
    const P = window.__pb = { w, gl, ext, wait };
    P.sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    P.emu = () => { if (!emu) return; const pr = emu[0] / innerWidth; w.renderer.setPixelRatio(pr); w.renderer.setSize(innerWidth, innerHeight, false); w.composer.setPixelRatio(pr); w.composer.setSize(innerWidth, innerHeight); };
    w.applySettings({ ...w.settings, weather: 'clear', timeMode: 'fixed', fixedHour: 11, graphics: { ...w.settings.graphics, quality: tier, bloom: true, shadows: true, ssao: true, resolutionScale: 1, fov: 72, godrays: true } });
    P.emu();
    P.view = async (x, z, yaw, pitch) => { const p = w.player; if (w.actions.seatedId) w.actions.leaveSeat?.(); p.transition = null; p.setPose(x, z, yaw, pitch); for (let i = 0; i < 40; i++) w.updateDoor(0.05); for (let i = 0; i < 24; i++) { w.frame(); P.sync(); if (i === 2) w.godrays.settle(); await wait(3); } };
    P.med = (a) => { const s = a.filter((v) => v != null).sort((x, y) => x - y); return s.length ? +s[s.length >> 1].toFixed(3) : null; };
    // the frames back to back, no shadow map redrawn meanwhile (the cadence would add noise), the median
    P.gpu = async (N, fn = () => w.frame()) => {
      const env = w.env, g = w.godrays, orig = g.beforeRender;
      g.beforeRender = function (dt) { orig.call(this, dt); env.sun.shadow.needsUpdate = false; if (w.fire) w.fire.light.shadow.needsUpdate = false; };
      try {
        for (let i = 0; i < 15; i++) fn();
        const qs = [];
        for (let i = 0; i < N; i++) { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); fn(); gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); }
        for (let k = 0; k < 2000 && !gl.getQueryParameter(qs[qs.length - 1], gl.QUERY_RESULT_AVAILABLE); k++) await wait(2);
        const dis = gl.getParameter(ext.GPU_DISJOINT_EXT);
        const out = qs.map((q) => (!dis && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) ? gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 : null));
        for (const q of qs) gl.deleteQuery(q);
        return P.med(out);
      } finally { g.beforeRender = orig; }
    };
    P.tris = () => { const info = w.renderer.info; info.autoReset = false; info.reset(); w.frame(); P.sync(); const r = { calls: info.render.calls, tris: info.render.triangles }; info.autoReset = true; return r; };
  }, [emu, process.env.PB_TIER || 'high']);

  const VIEWS = { hall: [0, 0, Math.PI / 2, 0], shelves: null, room: [0, -12, 0, 0], terrace: [0.6, 8.7, Math.PI + 0.15, 0.05], jetty: [-22, 37, 2.15, 0.02], glass: [0, -2.2, Math.PI, 0.05] };
  VIEWS.shelves = await page.evaluate(() => { const w = window.__app.world; const count = (bc) => bc.rows.reduce((a, r) => a + r.items.length, 0); const bc = [...w.layout.bookcases].sort((a, b) => count(b) - count(a))[0]; const fx = Math.sin(bc.rot), fz = Math.cos(bc.rot); return [bc.x + fx * 1.5, bc.z + fz * 1.5, Math.atan2(fx, fz), -0.05]; });
  const views = (process.env.PB_VIEWS || 'hall,shelves,jetty').split(',');
  // the scene graph: how many objects, how many bring their matrices up to date every frame, what that costs
  const graph = await page.evaluate(() => {
    const w = window.__app.world;
    let total = 0, visible = 0, auto = 0, meshes = 0, invisibleMeshes = 0;
    w.scene.traverse((o) => { total++; if (o.visible) visible++; if (o.matrixAutoUpdate) auto++; if (o.isMesh) { meshes++; if (!o.visible) invisibleMeshes++; } });
    const t = [];
    for (let i = 0; i < 30; i++) { const a = performance.now(); w.scene.updateMatrixWorld(); t.push(performance.now() - a); }
    t.sort((a, b) => a - b);
    return { total, visible, auto, meshes, invisibleMeshes, updateMatrixWorldMs: +t[t.length >> 1].toFixed(3) };
  });
  console.log('GRAPH ' + JSON.stringify(graph));
  for (const view of views) {
    const r = await page.evaluate(async ([pose, N]) => {
      const P = window.__pb, w = P.w, THREE_Basic = w.scene.overrideMaterial;
      await P.view(...pose);
      const out = { base: await P.gpu(N), ...P.tris() };
      // parts left out in turn
      const env = w.env;
      const toggles = {
        noGarden: () => { env.scenery.visible = false; return () => { env.scenery.visible = true; }; },
        noSky: () => { env.sky.visible = false; env.stars.points.visible = false; return () => { env.sky.visible = true; env.stars.points.visible = true; }; },
        noBooks: () => { const list = w.books.meshes.filter((m) => m.visible); for (const m of list) m.visible = false; return () => { for (const m of list) m.visible = true; }; },
        noStatic: () => { w.static.visible = false; return () => { w.static.visible = true; }; },
        noAO: () => { const k = w.ao.enabled; w.ao.enabled = false; return () => { w.ao.enabled = k; }; },
        noBloom: () => { const k = w.bloom.enabled; w.bloom.enabled = false; return () => { w.bloom.enabled = k; }; },
        noRays: () => { const g = w.godrays, k = g.enabled, s = g.strength; g.enabled = false; g.strength = 0; return () => { g.enabled = k; g.strength = s; }; },
        noMotes: () => { const m = w.godrays.motes.points, k = m.visible; const o = w.godrays.beforeRender; w.godrays.beforeRender = function (dt) { o.call(this, dt); m.visible = false; }; return () => { w.godrays.beforeRender = o; m.visible = k; }; },
        noDynamic: () => { const list = []; w.scene.traverse((o) => { if (o.userData.dynamic && o.visible) { list.push(o); o.visible = false; } }); return () => { for (const o of list) o.visible = true; }; },
        noFauna: () => { const k = w.fauna?.enabled; const g = w.fauna?.group; const vis = g?.visible; if (g) g.visible = false; return () => { if (g) g.visible = vis; }; },
        noWildlife: () => { const g = w.wildlife?.group; const vis = g?.visible; if (g) g.visible = false; return () => { if (g) g.visible = vis; }; },
        noCat: () => { const g = w.cat?.group; const vis = g?.visible; if (g) g.visible = false; return () => { if (g) g.visible = vis; }; },
        // the opaque things nearest first whatever their material (three sorts by material first, then by depth)
        frontToBack: () => { w.renderer.setOpaqueSort((a, b) => a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder || a.z - b.z || a.id - b.id); return () => { w.renderer.setOpaqueSort(null); }; },
      };
      for (const [name, on] of Object.entries(toggles)) {
        const off = on();
        try { for (let i = 0; i < 3; i++) w.frame(); out[name] = await P.gpu(N); out[name + 'Tris'] = P.tris().tris; } finally { off(); }
      }
      // the raster cost alone: every material a plain one (the AO's own pass keeps its normal material)
      {
        const basic = new (w.scene.children[0].constructor === Object ? null : Object.getPrototypeOf(w.ao.normalMaterial).constructor)();   // MeshNormalMaterial: cheap, no lights
        w.scene.overrideMaterial = basic;
        try { for (let i = 0; i < 3; i++) w.frame(); out.overrideNormal = await P.gpu(N); } finally { w.scene.overrideMaterial = THREE_Basic; }
      }
      return out;
    }, [VIEWS[view], N]);
    console.log(`PROBE ${view} ${JSON.stringify(r)}`);
  }
  // the AO pass step by step: a query round every render inside it (the frames back to back, results read at the end)
  for (const view of views) {
    const r = await page.evaluate(async ([pose, N]) => {
      const P = window.__pb, w = P.w, gl = P.gl, ext = P.ext, ao = w.ao;
      await P.view(...pose);
      const env = w.env, g = w.godrays, orig = g.beforeRender;
      g.beforeRender = function (dt) { orig.call(this, dt); env.sun.shadow.needsUpdate = false; if (w.fire) w.fire.light.shadow.needsUpdate = false; };
      const per = {}, queries = [];
      let on = false, step = 0;
      const names = ['normals', 'gtao', 'denoise', 'copy', 'blend'];
      const rr = w.renderer, origRender = rr.render.bind(rr), quad = ao._fsQuad, origQuad = quad.render;
      let inAO = false;
      const aoRender = ao.render;
      ao.render = function (...a) { inAO = true; step = 0; try { return aoRender.apply(this, a); } finally { inAO = false; } };
      const timed = (fn, label) => { if (!on || !inAO) return fn(); const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); const res = fn(); gl.endQuery(ext.TIME_ELAPSED_EXT); queries.push([label, q]); return res; };
      rr.render = (s, c) => timed(() => origRender(s, c), 'normals');
      quad.render = function (renderer) { const label = names[Math.min(step + 1, names.length - 1)]; step++; return timed(() => origQuad.call(this, renderer), label); };
      try {
        for (let i = 0; i < 15; i++) w.frame();
        on = true; for (let i = 0; i < N; i++) w.frame(); on = false;
        const lastQ = queries[queries.length - 1]?.[1];
        for (let k = 0; lastQ && k < 2000 && !gl.getQueryParameter(lastQ, gl.QUERY_RESULT_AVAILABLE); k++) await P.wait(2);
        const dis = gl.getParameter(ext.GPU_DISJOINT_EXT);
        for (const [label, q] of queries) { if (!dis && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) (per[label] ||= []).push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); }
      } finally { rr.render = origRender; quad.render = origQuad; ao.render = aoRender; g.beforeRender = orig; }
      return Object.fromEntries(Object.entries(per).map(([k, v]) => [k, P.med(v)]));
    }, [VIEWS[view], N]);
    console.log(`AOSTEPS ${view} ${JSON.stringify(r)}`);
  }
  // the draw calls of one frame by pass and by object (with the shadow maps forced on for this frame)
  for (const view of views) {
    const r = await page.evaluate(async ([pose]) => {
      const P = window.__pb, w = P.w, rr = w.renderer;
      await P.view(...pose);
      const calls = {}, tris = {};
      let phase = 'scene';
      const ob = rr.renderBufferDirect;
      rr.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
        const n = object.name || object.parent?.name || material.name || material.type;
        const key = phase + '|' + n;
        calls[key] = (calls[key] || 0) + 1;
        const idx = geometry.index, cnt = (group ? group.count : idx ? idx.count : geometry.attributes.position.count) / 3;
        tris[key] = (tris[key] || 0) + Math.round(cnt * (object.isInstancedMesh ? object.count : 1));
        return ob.call(this, camera, scene, geometry, material, object, group);
      };
      const passes = w.composer.passes;
      const wraps = [];
      for (const p of passes) { const f = p.render, name = p.constructor.name; p.render = function (...a) { phase = name; return f.apply(this, a); }; wraps.push(() => { p.render = f; }); }
      // the shadow maps: three.js draws them inside the RenderPass; told apart by the camera
      const sm = rr.shadowMap, osm = sm.render;
      sm.render = function (...a) { const k = phase; phase = 'shadows'; try { return osm.apply(this, a); } finally { phase = k; } };
      const env = w.env, g = w.godrays, orig = g.beforeRender;
      g.beforeRender = function (dt) { orig.call(this, dt); env.sun.shadow.needsUpdate = true; if (w.fire) w.fire.light.shadow.needsUpdate = true; };
      try { w.frame(); P.sync(); } finally { rr.renderBufferDirect = ob; for (const un of wraps) un(); sm.render = osm; g.beforeRender = orig; }
      const byPhase = {};
      for (const [k, v] of Object.entries(calls)) { const ph = k.split('|')[0]; byPhase[ph] = (byPhase[ph] || 0) + v; }
      const top = Object.entries(calls).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => [k, v, tris[k]]);
      return { byPhase, top, programs: rr.info.programs.length };
    }, [VIEWS[view]]);
    console.log(`CALLS ${view} ${JSON.stringify(r.byPhase)} programs=${r.programs}`);
    for (const [k, v, t] of r.top) console.log(`CALLS ${view}   ${String(v).padStart(4)} ${String(t).padStart(8)}  ${k}`);
  }
};
