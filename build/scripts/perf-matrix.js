// The cost of a frame, measured the same way before and after a change (the performance strand of 0.9): GPU time with
// timer queries (EXT_disjoint_timer_query_webgl2) and the CPU time of World#frame at fixed views and conditions (the
// hall with the fire, the book room at the shelves, the terrace, the jetty; day, night, rain, snow, the golden hour),
// for the quality tiers high, medium and low, at the window's size and with the drawing buffer at an emulated size
// (PERF_EMU, default 2560x1440; the window stays 1600 × 900). Reported per cell: the median and the 10th and 90th
// percentile of the GPU time, the median and the 90th percentile of the CPU time, draw calls and triangles. Then, for the
// high tier: where the CPU time of a frame goes (the steps of World#frame), the GPU time of every pass of the composer
// and of the two shadow maps, and the memory (JS heap, textures, geometries, programs, an estimate of the GPU bytes).
// Everything also goes as JSON into SHOT_DIR/perf-matrix-<PM_TAG>.json (build/scripts/perf-diff.js compares two).
//   node build/screenshot.js perf-matrix     PM_PARTS=matrix,cpu,passes,memory   PM_TIERS=high,medium,low
//   PM_SIZES=native,emu   PM_VIEWS=hall,room,shelves,terrace,jetty,glass   PM_CONDS=day,night,rain,snow,golden
//   PM_N=40 (frames per cell)   PM_TAG=base   PERF_EMU=2560x1440   COZYSHELVES_QUERY sets nothing here (the conditions do)
//   PM_HOLD=1 (no shadow map redrawn in the measured frames of the matrix)   PM_WARM=15 (frames before each cell's measured ones)
const fs = require('fs');
const path = require('path');

module.exports = async ({ app, page, sleep }) => {
  const W = +process.env.PERF_W || 1600, H = +process.env.PERF_H || 900;
  await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setContentSize(w, h); }, [W, H]);
  const parts = new Set((process.env.PM_PARTS || 'matrix,cpu,passes,memory').split(','));
  const tiers = (process.env.PM_TIERS || 'high,medium,low').split(',');
  const sizes = (process.env.PM_SIZES || 'native,emu').split(',');
  const emu = (process.env.PERF_EMU || '2560x1440').split('x').map(Number);
  const N = +process.env.PM_N || 40;
  const tag = process.env.PM_TAG || 'run';
  const outDir = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  const t0 = Date.now();
  const log = (s) => console.log(s);

  // how busy other programs keep the graphics card (nvidia-smi; NaN without it)
  const busyNow = () => { try { return parseFloat(require('child_process').execSync('nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits', { timeout: 5000 }).toString()); } catch { return NaN; } };
  const busy = async () => { const v = []; for (let i = 0; i < 5; i++) { const b = busyNow(); if (!Number.isNaN(b)) v.push(b); await sleep(200); } v.sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; };

  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  // indexing finished and the debounced rebuild after the last library update has run
  let last = -1, quiet = 0;
  for (let i = 0; i < 300; i++) {
    const st = await page.evaluate(() => { const b = window.__app.state.library.books; return { n: b.length, idx: b.filter((x) => x.indexed).length, active: !!window.__app.state.library.scan?.active }; });
    if (st.n > 0 && st.idx === st.n && !st.active) { quiet = st.n === last ? quiet + 1 : 0; if (quiet >= 2) break; }
    last = st.n;
    await sleep(1500);
  }
  await sleep(10500);
  await page.evaluate(() => { window.__app.world.stop(); window.__app.closeAllPanels(); document.querySelector('#hud')?.style.setProperty('opacity', '0'); });
  const othersBefore = await busy();

  const info = await page.evaluate(() => {
    const w = window.__app.world, r = w.renderer, gl = r.getContext();
    let gpu = '';
    try { gpu = gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL); } catch {}
    return { gpu, size: [innerWidth, innerHeight], dpr: devicePixelRatio, books: w.books.entries.size, cases: w.layout.bookcases.length, programs: r.info.programs?.length, textures: r.info.memory.textures, timer: !!gl.getExtension('EXT_disjoint_timer_query_webgl2') };
  });
  log('INFO ' + JSON.stringify({ ...info, othersBusy: othersBefore, tag }));
  const result = { tag, info, othersBefore, matrix: [], cpu: [], passes: [], memory: null };

  // --- the helpers in the page -------------------------------------------------------------------------------------------
  await page.evaluate(([emu, hold, warm]) => {
    const w = window.__app.world, gl = w.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const px = new Uint8Array(4);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const P = window.__pm = { w, gl, ext, wait, emu: null };
    P.sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    /** The drawing buffer at a size, whatever the window allows (again after every applySettings, which resizes). */
    P.size = (which) => {
      if (which === 'emu') {
        P.emu = emu;
        const pr = emu[0] / innerWidth;
        w.renderer.setPixelRatio(pr); w.renderer.setSize(innerWidth, innerHeight, false); w.composer.setPixelRatio(pr); w.composer.setSize(innerWidth, innerHeight);
      } else { P.emu = null; w.resize(); }
    };
    /** The quality tier, with the graphics settings of a fresh profile at that tier (nothing turned down). */
    P.tier = (q) => {
      w.applySettings({ ...w.settings, graphics: { ...w.settings.graphics, quality: q, bloom: true, shadows: true, ssao: true, resolutionScale: 1, fov: 72, godrays: true } });
      if (P.emu) P.size('emu');
    };
    /** A condition: an hour and a weather, or the golden hour. */
    P.cond = (c) => {
      const t = c.golden ? { timeMode: 'golden' } : { timeMode: 'fixed', fixedHour: c.hour };
      w.applySettings({ ...w.settings, weather: c.weather, ...t });
      if (P.emu) P.size('emu');
    };
    /** Stand at a view and let the frames settle (doors, the rays, the trees' map, the shadow maps). */
    P.view = async (x, z, yaw, pitch, frames = 24) => {
      const p = w.player;
      if (w.actions.seatedId) w.actions.leaveSeat?.();
      p.transition = null; p.setPose(x, z, yaw, pitch);
      for (let i = 0; i < 40; i++) w.updateDoor(0.05);
      for (let i = 0; i < frames; i++) { w.frame(); P.sync(); if (i === 2) w.godrays.settle(); await wait(3); }
    };
    /** One frame with a timer query round it: { gpu (ms or null), cpu (ms) }. */
    P.timed = async (fn = () => w.frame()) => {
      if (!ext) { const a = performance.now(); fn(); P.sync(); return { gpu: performance.now() - a, cpu: null }; }
      const q = gl.createQuery();
      const a = performance.now();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q); fn(); gl.endQuery(ext.TIME_ELAPSED_EXT);
      const cpu = performance.now() - a;
      for (let k = 0; k < 400 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await wait(2);
      const ok = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(ext.GPU_DISJOINT_EXT);
      const v = ok ? gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 : null;
      gl.deleteQuery(q);
      return { gpu: v, cpu };
    };
    P.stats = (a) => { const s = a.filter((v) => v != null).sort((x, y) => x - y); if (!s.length) return null; const q = (f) => +s[Math.min(s.length - 1, Math.floor(f * s.length))].toFixed(3); return { p10: q(0.1), p50: q(0.5), p90: q(0.9), max: q(1), n: s.length }; };
    /** N frames back to back, each with a timer query of its own, the results read afterwards: the card stays busy as it
     *  does in the running app (a frame waited for one at a time let its clocks drop between frames, and the times
     *  spread by half). */
    P.gpuFrames = async (N, warm = P.warm) => {
      if (!ext) { const a = []; for (let i = 0; i < N; i++) { const t = performance.now(); w.frame(); P.sync(); a.push(performance.now() - t); } return a; }
      // (the clocks of the card climb over the first frames after a pause: those are not counted)
      for (let i = 0; i < warm; i++) w.frame();
      const qs = [];
      for (let i = 0; i < N; i++) { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); w.frame(); gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); }
      const lastQ = qs[qs.length - 1];
      for (let k = 0; k < 2000 && !gl.getQueryParameter(lastQ, gl.QUERY_RESULT_AVAILABLE); k++) await wait(2);
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const out = qs.map((q) => (!disjoint && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) ? gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 : null));
      for (const q of qs) gl.deleteQuery(q);
      return out;
    };
    /** N frames at the current view: the GPU time (back to back), the CPU time of World#frame (each frame finished on the
     *  card before the next, so that no frame waits for the card inside its own time), draw calls and triangles. */
    P.measure = async (N) => {
      // (PM_HOLD=1: no shadow map redrawn during the measured frames. Their redraws, once a second or when the sun has
      // moved on, fall on a few of the frames by chance and spread the medians of the short frames; the passes part
      // measures what a redraw costs)
      const g = w.godrays, orig = g.beforeRender;
      if (P.hold) g.beforeRender = function (dt) { orig.call(this, dt); w.env.sun.shadow.needsUpdate = false; if (w.fire) w.fire.light.shadow.needsUpdate = false; };
      try {
        const gpu = await P.gpuFrames(N);
        const cpu = [];
        for (let i = 0; i < Math.max(10, N >> 1); i++) { const a = performance.now(); w.frame(); cpu.push(performance.now() - a); P.sync(); }
        const info = w.renderer.info; info.autoReset = false; info.reset(); w.frame(); P.sync();
        const calls = info.render.calls, tris = info.render.triangles; info.autoReset = true;
        return { gpu: P.stats(gpu), cpu: P.stats(cpu), calls, tris, buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], programs: w.renderer.info.programs?.length };
      } finally { g.beforeRender = orig; }
    };
    P.hold = hold;
    // (frames of a millisecond or two leave the card idle between the measurements: its clocks need some hundred frames
    // back to back to climb, PM_WARM)
    P.warm = warm;
  }, [emu, process.env.PM_HOLD === '1', +process.env.PM_WARM || 15]);

  const VIEWS = {
    hall: [0, 0, Math.PI / 2, 0],              // the middle of the hall, towards the fire
    room: [0, -12, 0, 0],                       // the book room from its middle
    shelves: null,                              // 1.5 m in front of the fullest case (decided in the page)
    terrace: [0.6, 8.7, Math.PI + 0.15, 0.05],  // on the deck, towards the lake
    jetty: [-22, 37, 2.15, 0.02],               // at the jetty, over the water towards the sun
    glass: [0, -2.2, Math.PI, 0.05],            // the garden through the glass front
  };
  const CONDS = {
    day: { hour: 11, weather: 'clear' }, night: { hour: 23, weather: 'clear' }, rain: { hour: 14, weather: 'rain' },
    snow: { hour: 14, weather: 'snow' }, golden: { golden: true, weather: 'clear' },
  };
  // which conditions matter where (indoors the weather shows little)
  const PLAN = { hall: ['day', 'night', 'golden'], room: ['day', 'night'], shelves: ['day'], terrace: ['day', 'night', 'rain', 'snow'], jetty: ['day', 'night', 'rain', 'snow', 'golden'], glass: ['day'] };
  const views = (process.env.PM_VIEWS || Object.keys(VIEWS).join(',')).split(',');
  const conds = process.env.PM_CONDS ? process.env.PM_CONDS.split(',') : null;
  const shelfPose = await page.evaluate(() => {
    const w = window.__app.world;
    const count = (bc) => bc.rows.reduce((a, r) => a + r.items.length, 0);
    const bc = [...w.layout.bookcases].sort((a, b) => count(b) - count(a))[0];
    if (!bc) return null;
    const fx = Math.sin(bc.rot), fz = Math.cos(bc.rot);
    return [bc.x + fx * 1.5, bc.z + fz * 1.5, Math.atan2(fx, fz), -0.05];
  });
  VIEWS.shelves = shelfPose;

  // --- the matrix: tier × size × view × condition --------------------------------------------------------------------------
  if (parts.has('matrix')) {
    for (const tier of tiers) {
      for (const size of sizes) {
        await page.evaluate(([tier, size]) => { const P = window.__pm; P.tier(tier); P.size(size); }, [tier, size]);
        await sleep(600);   // compileAsync of a rebuild (another lamp tier) and the shadow warm-up
        for (const view of views) {
          const pose = VIEWS[view]; if (!pose) continue;
          for (const cond of (conds || PLAN[view])) {
            const c = CONDS[cond]; if (!c) continue;
            const r = await page.evaluate(async ([c, pose, N]) => {
              const P = window.__pm;
              P.cond(c);
              await P.view(...pose);
              return P.measure(N);
            }, [c, pose, N]);
            const cell = { tier, size, view, cond, ...r };
            result.matrix.push(cell);
            log(`CELL ${tier} ${size} ${view} ${cond} gpu=${JSON.stringify(r.gpu)} cpu=${JSON.stringify(r.cpu)} calls=${r.calls} tris=${r.tris} buf=${r.buffer.join('x')} prog=${r.programs}`);
          }
        }
      }
    }
  }

  // --- where the CPU time of a frame goes (high tier, native size) -----------------------------------------------------------
  if (parts.has('cpu')) {
    await page.evaluate(() => { const P = window.__pm; P.tier('high'); P.size('native'); });
    await sleep(500);
    for (const [view, cond] of [['hall', 'day'], ['shelves', 'day'], ['terrace', 'day'], ['jetty', 'day'], ['jetty', 'snow']]) {
      const pose = VIEWS[view]; if (!pose) continue;
      const r = await page.evaluate(async ([c, pose, N]) => {
        const P = window.__pm, w = P.w;
        P.cond(c); await P.view(...pose);
        const sums = {}, wraps = [];
        const wrap = (obj, key, name) => {
          if (!obj || typeof obj[key] !== 'function') return;
          const f = obj[key];
          obj[key] = function (...a) { const t = performance.now(); const res = f.apply(this, a); sums[name] = (sums[name] || 0) + performance.now() - t; return res; };
          wraps.push(() => { obj[key] = f; });
        };
        wrap(w, 'updateDoor', 'door'); wrap(w.player, 'update', 'player'); wrap(w.sky, 'frame', 'sky'); wrap(w.env, 'update', 'env'); wrap(w.reflections, 'frame', 'reflections');
        wrap(w.wildlife, 'update', 'wildlife'); wrap(w.fauna, 'update', 'fauna'); wrap(w.winter, 'update', 'winter'); wrap(w.books, 'update', 'books'); wrap(w.audiobooks, 'update', 'audiobooks');
        wrap(w.cat, 'update', 'cat'); wrap(w.cinema, 'update', 'cinema'); wrap(w.actions, 'update', 'actions'); wrap(w.godrays, 'beforeRender', 'godrays'); wrap(w.composer, 'render', 'render');
        wrap(w.walls, 'update', 'walls'); wrap(w.floors, 'update', 'floors'); wrap(w.signs, 'pump', 'signs'); wrap(w.lampSwitch, 'update', 'lampSwitch');
        // inside the render: the scene (shadow maps included), then every other pass
        const passes = w.composer.passes;
        for (const p of passes) wrap(p, 'render', 'pass:' + (p.constructor.name || 'pass'));
        const totals = [];
        for (let i = 0; i < N; i++) { const t = performance.now(); w.frame(); totals.push(performance.now() - t); P.sync(); await P.wait(2); }
        for (const un of wraps) un();
        const avg = Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, +(v / N).toFixed(3)]));
        return { total: P.stats(totals), avg };
      }, [CONDS[cond], pose, N]);
      result.cpu.push({ view, cond, ...r });
      log(`CPU ${view} ${cond} total=${JSON.stringify(r.total)} ${JSON.stringify(r.avg)}`);
    }
  }

  // --- the GPU time of every pass and of the shadow maps (high tier, both sizes) ----------------------------------------------
  if (parts.has('passes')) {
    for (const size of sizes) {
      await page.evaluate(([size]) => { const P = window.__pm; P.tier('high'); P.size(size); }, [size]);
      await sleep(500);
      for (const [view, cond] of [['hall', 'day'], ['shelves', 'day'], ['jetty', 'golden'], ['terrace', 'day']]) {
        const pose = VIEWS[view]; if (!pose) continue;
        const r = await page.evaluate(async ([c, pose, N]) => {
          const P = window.__pm, w = P.w, gl = P.gl, ext = P.ext;
          if (!ext) return null;
          P.cond(c); await P.view(...pose);
          const env = w.env;
          // the shadow maps drawn on no frame, on every frame (the sun's), on every frame (the fire's): the differences
          const g = w.godrays, orig = g.beforeRender;
          let mode = 'none';
          g.beforeRender = function (dt) { orig.call(this, dt); env.sun.shadow.needsUpdate = mode === 'sun'; if (w.fire) w.fire.light.shadow.needsUpdate = mode === 'fire'; };
          const whole = {};
          for (const m of ['none', 'sun', 'fire', 'none']) {
            mode = m;
            for (let i = 0; i < 4; i++) { w.frame(); P.sync(); }
            (whole[m] ||= []).push(...(await P.gpuFrames(N)));
          }
          mode = 'none';
          // every pass of the composer with a query of its own (one after the other; a query may not nest), the frames
          // back to back as above and every result read at the end
          const per = {};
          const passes = w.composer.passes.filter((p) => p.enabled);
          const wraps = [];
          const queries = [];
          let on = false;
          for (const p of passes) {
            const f = p.render, name = p.constructor.name || 'pass';
            p.render = function (...a) { if (!on) return f.apply(this, a); const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); const res = f.apply(this, a); gl.endQuery(ext.TIME_ELAPSED_EXT); queries.push([name, q]); return res; };
            wraps.push(() => { p.render = f; });
          }
          for (let i = 0; i < 15; i++) w.frame();
          on = true;
          for (let i = 0; i < N; i++) w.frame();
          on = false;
          const lastQ = queries[queries.length - 1]?.[1];
          for (let k = 0; lastQ && k < 2000 && !gl.getQueryParameter(lastQ, gl.QUERY_RESULT_AVAILABLE); k++) await P.wait(2);
          const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
          for (const [name, q] of queries) {
            if (!disjoint && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) (per[name] ||= []).push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
            gl.deleteQuery(q);
          }
          for (const un of wraps) un();
          g.beforeRender = orig;
          const med = (a) => P.stats(a)?.p50 ?? null;
          return { frame: { none: med(whole.none), sun: med(whole.sun), fire: med(whole.fire) }, passes: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, med(v)])), buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight] };
        }, [CONDS[cond], pose, N]);
        if (!r) { log('PASSES no timer queries'); break; }
        result.passes.push({ size, view, cond, ...r });
        log(`PASSES ${size} ${view} ${cond} buf=${r.buffer.join('x')} frame=${JSON.stringify(r.frame)} ${JSON.stringify(r.passes)}`);
      }
    }
  }

  // --- memory --------------------------------------------------------------------------------------------------------------
  if (parts.has('memory')) {
    await page.evaluate(() => { const P = window.__pm; P.tier('high'); P.size('native'); });
    await sleep(300);
    const r = await page.evaluate(async () => {
      const P = window.__pm, w = P.w, r = w.renderer, gl = P.gl;
      await P.view(0, 0, Math.PI / 2, 0, 6);
      // an estimate of the texture bytes on the graphics card: every texture of every material of the scene (with its mip
      // levels), the render targets of the composer, the rays, the shadow maps and the atlases
      const seen = new Set(); let texBytes = 0, texCount = 0;
      const bytesOf = (t) => {
        if (!t || seen.has(t)) return 0; seen.add(t);
        const img = t.image, w0 = img?.width || t.source?.data?.width || 0, h0 = img?.height || t.source?.data?.height || 0;
        if (!w0 || !h0) return 0;
        texCount++;
        const bpp = t.type === 1016 || t.type === 1015 ? 8 : t.type === 1015 ? 16 : t.isDepthTexture ? 4 : 4;   // HalfFloat 8, Float 16, else 4
        const mips = t.generateMipmaps || (t.minFilter !== 1006 && t.minFilter !== 1003) ? 4 / 3 : 1;
        return w0 * h0 * bpp * mips * (t.isCubeTexture ? 6 : 1);
      };
      w.scene.traverse((o) => { for (const m of (o.material ? [o.material].flat() : [])) { for (const k in m) if (m[k]?.isTexture) texBytes += bytesOf(m[k]); if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u?.value?.isTexture) texBytes += bytesOf(u.value); } });
      let rtBytes = 0; const rts = [];
      const rt = (name, t) => { if (!t) return; const s = (t.samples > 1 ? 1 + t.samples : 1); const b = t.width * t.height * (t.texture?.type === 1016 ? 8 : 4) * s + (t.depthBuffer ? t.width * t.height * 4 * s : 0); rtBytes += b; rts.push([name, t.width, t.height, t.samples || 0, Math.round(b / 1048576 * 10) / 10]); };
      rt('composer.rt1', w.composer.renderTarget1); rt('composer.rt2', w.composer.renderTarget2);
      rt('rays.A', w.godrays.pass.rtA); rt('rays.B', w.godrays.pass.rtB); rt('rays.hist0', w.godrays.pass.hist[0]); rt('rays.hist1', w.godrays.pass.hist[1]); rt('trees', w.godrays.trees.target);
      rt('sunShadow', w.env?.sun?.shadow?.map); if (w.fire) rt('fireShadow(x6)', w.fire.light.shadow.map);
      for (const [k, v] of Object.entries(w.bloom)) if (v?.isWebGLRenderTarget) rt('bloom.' + k, v); if (w.bloom.renderTargetsHorizontal) for (const t of w.bloom.renderTargetsHorizontal) rt('bloom.h', t); if (w.bloom.renderTargetsVertical) for (const t of w.bloom.renderTargetsVertical) rt('bloom.v', t);
      for (const k of ['gtaoRenderTarget', 'pdRenderTarget', 'normalRenderTarget', 'depthRenderTarget']) rt('ao.' + k, w.ao[k]);
      const sides = w.books.sideCovers?.atlas; if (sides) rt('sideAtlas', { width: sides.image?.width || 4096, height: sides.image?.height || 0, texture: { type: 1009 } });
      let geoBytes = 0; const geos = new Set();
      w.scene.traverse((o) => { const g = o.geometry; if (!g || geos.has(g)) return; geos.add(g); for (const a of Object.values(g.attributes)) geoBytes += a.array?.byteLength || 0; if (g.index) geoBytes += g.index.array.byteLength; if (o.isInstancedMesh) geoBytes += (o.instanceMatrix?.array.byteLength || 0) + (o.instanceColor?.array.byteLength || 0); });
      const mem = performance.memory ? { usedJSHeapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), totalJSHeapMB: +(performance.memory.totalJSHeapSize / 1048576).toFixed(1) } : {};
      return { ...mem, info: { ...r.info.memory, programs: r.info.programs?.length }, textureMB: +(texBytes / 1048576).toFixed(1), texturesCounted: texCount, renderTargetMB: +(rtBytes / 1048576).toFixed(1), renderTargets: rts, geometryMB: +(geoBytes / 1048576).toFixed(1), geometries: geos.size, buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight] };
    });
    result.memory = r;
    log('MEMORY ' + JSON.stringify(r));
  }
  await page.evaluate(() => { window.__pm.size('native'); });
  const othersAfter = await busy();
  result.othersAfter = othersAfter;
  result.seconds = Math.round((Date.now() - t0) / 1000);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `perf-matrix-${tag}.json`), JSON.stringify(result, null, 1));
  log(`DONE ${tag} others=${othersBefore ?? '?'}%/${othersAfter ?? '?'}% in ${result.seconds} s`);
};
