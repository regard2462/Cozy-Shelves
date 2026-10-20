// Where the CPU time of a frame goes, function by function (the performance strand of 0.9). The world's loop is stopped,
// the player stands at a view, and PC_N frames are drawn one after the other (each finished on the card before the next)
// while the V8 sampling profiler runs through the Chrome DevTools protocol. Printed per view: the CPU time of World#frame
// (median, p90), the functions with the most self time and the functions with the most total time (their callees
// included) inside the frames. The profiles go to SHOT_DIR/cpu-<PC_TAG>-<view>.cpuprofile.
//   node build/screenshot.js perf-cpu     PC_TIER=high   PC_VIEWS=hall,shelves,terrace,jetty   PC_N=300   PC_TOP=40
//   PC_PROFILE=0: only the counts of one frame (draws, program and material switches, materials updated in the frame)
//   PC_SHADOWS=1: that frame draws the sun's and the fire's shadow maps as well (their draws counted as 'shadows')
const fs = require('fs');
const path = require('path');

module.exports = async ({ app, page, sleep }) => {
  const W = +process.env.PERF_W || 1600, H = +process.env.PERF_H || 900;
  await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setContentSize(w, h); }, [W, H]);
  const tier = process.env.PC_TIER || 'high', N = +process.env.PC_N || 300, top = +process.env.PC_TOP || 40;
  const tag = process.env.PC_TAG || 'run';
  const outDir = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  fs.mkdirSync(outDir, { recursive: true });
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
  await page.evaluate(([tier]) => {
    const w = window.__app.world;
    w.stop(); window.__app.closeAllPanels(); document.querySelector('#hud')?.style.setProperty('opacity', '0');
    w.applySettings({ ...w.settings, graphics: { ...w.settings.graphics, quality: tier, bloom: true, shadows: true, ssao: true, resolutionScale: 1, fov: 72, godrays: true } });
  }, [tier]);
  await sleep(800);
  const VIEWS = { hall: [0, 0, Math.PI / 2, 0], room: [0, -12, 0, 0], shelves: null, terrace: [0.6, 8.7, Math.PI + 0.15, 0.05], jetty: [-22, 37, 2.15, 0.02], glass: [0, -2.2, Math.PI, 0.05] };
  VIEWS.shelves = await page.evaluate(() => { const w = window.__app.world; const count = (bc) => bc.rows.reduce((a, r) => a + r.items.length, 0); const bc = [...w.layout.bookcases].sort((a, b) => count(b) - count(a))[0]; const fx = Math.sin(bc.rot), fz = Math.cos(bc.rot); return [bc.x + fx * 1.5, bc.z + fz * 1.5, Math.atan2(fx, fz), -0.05]; });
  const views = (process.env.PC_VIEWS || 'hall,shelves,terrace,jetty').split(',');
  const cdp = await app.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  const result = { tag, tier, views: {} };
  for (const view of views) {
    const pose = VIEWS[view]; if (!pose) continue;
    await page.evaluate(async ([pose]) => {
      const w = window.__app.world, gl = w.renderer.getContext(), px = new Uint8Array(4);
      w.applySettings({ ...w.settings, weather: 'clear', timeMode: 'fixed', fixedHour: 11 });
      const p = w.player; if (w.actions.seatedId) w.actions.leaveSeat?.();
      p.transition = null; p.setPose(...pose);
      for (let i = 0; i < 40; i++) w.updateDoor(0.05);
      for (let i = 0; i < 60; i++) { w.frame(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); await new Promise((r) => setTimeout(r, 2)); }
    }, [pose]);
    // one frame counted: draws, program switches (useProgram), material switches, and the materials drawn with objects of
    // different kinds in the same frame (three.js looks the program up again, getParameters, at every such change)
    const counts = await page.evaluate((shadows) => {
      const w = window.__app.world, rr = w.renderer, gl = rr.getContext();
      let draws = 0, uses = 0, matSwitch = 0, lastMat = null, phase = 'scene';
      const seen = new Map(), flips = new Map();
      const ou = gl.useProgram;
      gl.useProgram = function (p) { uses++; return ou.call(this, p); };
      const ob = rr.renderBufferDirect;
      rr.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
        draws++;
        if (material !== lastMat) { matSwitch++; lastMat = material; }
        const rt = rr.getRenderTarget();
        // (what setProgram compares before it looks the program up again)
        const k = [!!object.isInstancedMesh, !!object.instanceColor, !!object.isBatchedMesh, !!object.isSkinnedMesh, rt ? 'rt' : 'canvas', !!(material.vertexColors && geometry.attributes.color), !!geometry.attributes.tangent, Object.keys(geometry.morphAttributes || {}).length].join(',');
        const prev = seen.get(material);
        if (prev !== undefined && prev !== k) { const key = `${phase}|${material.name || material.type}#${material.id} (${object.name || object.parent?.name || object.type}: ${k} after ${prev})`; flips.set(key, (flips.get(key) || 0) + 1); }
        seen.set(material, k);
        return ob.call(this, camera, scene, geometry, material, object, group);
      };
      const wraps = [];
      for (const p of w.composer.passes) { const f = p.render, name = p.constructor.name; p.render = function (...a) { phase = name; return f.apply(this, a); }; wraps.push(() => { p.render = f; }); }
      // materials whose version moves during a frame (needsUpdate: three.js computes their program parameters again; a
      // transparent double-sided one is drawn in two passes, back and front, each with needsUpdate)
      const versions = new Map();
      w.scene.traverse((o) => { for (const m of (o.material ? [o.material].flat() : [])) if (m) versions.set(m, { v: m.version, o }); });
      // the lights' state version of every lit material before and after: a change means three looked its program up again
      const lv = new Map();
      for (const m of versions.keys()) { const p = rr.properties.get(m); if (p?.lightsStateVersion !== undefined) lv.set(m, p.lightsStateVersion); }
      // (PC_SHADOWS=1: the sun's and the fire's maps drawn in this frame as well, their draws counted as 'shadows')
      const sm = rr.shadowMap, osm = sm.render;
      if (shadows) {
        sm.render = function (...a) { const k = phase; phase = 'shadows'; try { return osm.apply(this, a); } finally { phase = k; } };
        const g = w.godrays, ob2 = g.beforeRender;
        g.beforeRender = function (dt) { ob2.call(this, dt); w.env.sun.shadow.needsUpdate = true; if (w.fire) w.fire.light.shadow.needsUpdate = true; g.beforeRender = ob2; };
      }
      try { w.frame(); } finally { gl.useProgram = ou; rr.renderBufferDirect = ob; sm.render = osm; for (const un of wraps) un(); }
      let lightsMoved = 0; const lightsVersions = new Set();
      for (const [m, v] of lv) { const now = rr.properties.get(m).lightsStateVersion; lightsVersions.add(now); if (now !== v) lightsMoved++; }
      const bumped = [];
      for (const [m, { v, o }] of versions) if (m.version !== v) bumped.push([`${m.name || m.type}#${m.id} on ${o.name || o.parent?.name || o.type}`, m.version - v, m.transparent, m.side, m.blending, m.depthWrite, o.geometry?.type, o.geometry?.index ? o.geometry.index.count / 3 : (o.geometry?.attributes?.position?.count || 0) / 3]);
      bumped.sort((a, b) => b[1] - a[1]);
      return { draws, useProgram: uses, materialSwitches: matSwitch, litMaterials: lv.size, lightsMoved, lightsVersions: [...lightsVersions], flips: [...flips.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20), bumped: bumped.slice(0, 30) };
    }, process.env.PC_SHADOWS === '1');
    console.log(`COUNTS ${view} ${JSON.stringify(counts)}`);
    if (view === views[0]) {
      // the scene graph: where its objects are, and how many bring their matrices up to date every frame
      const graph = await page.evaluate(() => {
        const w = window.__app.world, out = {};
        const count = (root) => { let n = 0, auto = 0, hidden = 0; root?.traverse((o) => { n++; if (o.matrixAutoUpdate) auto++; if (!o.visible) hidden++; }); return { n, auto, hidden }; };
        out.scene = count(w.scene);
        out.static = count(w.static);
        out.dynamic = count(w.dynamic);
        out.garden = count(w.env?.scenery);
        // static roots whose meshes are all merged into the batch (nothing of theirs is drawn)
        let merged = 0, mergedObjs = 0;
        for (const r of w.static.children) {
          if (r.userData.batch) continue;
          let drawn = false, n = 0;
          r.traverse((o) => { n++; if ((o.isMesh || o.isLight || o.isPoints || o.isLine || o.isSprite) && o.visible) { let v = true; for (let p = o; p && p !== r.parent; p = p.parent) if (!p.visible) v = false; if (v) drawn = true; } });
          if (!drawn) { merged++; mergedObjs += n; }
        }
        out.staticRoots = w.static.children.length; out.mergedRoots = merged; out.mergedObjects = mergedObjs;
        out.topLevel = w.scene.children.map((c) => `${c.name || c.type}:${count(c).n}`).join(' ');
        // the materials three draws in two passes (transparent, double-sided): by material, the meshes and how many are shown
        const twice = new Map();
        w.scene.traverse((o) => { const m = o.material; if (o.isMesh && m && !Array.isArray(m) && m.transparent && m.side === 2 && !m.forceSinglePass) { const k = `${m.type}#${m.id} ${m.name || ''} ${o.name || o.parent?.name || ''}`; const e = twice.get(k) || [0, 0]; e[0]++; let v = true; for (let p = o; p; p = p.parent) if (!p.visible) v = false; if (v) e[1]++; twice.set(k, e); } });
        out.drawnTwice = [...twice.entries()].map(([k, [n, shown]]) => `${k}: ${shown}/${n}`);
        return out;
      });
      console.log(`GRAPH ${JSON.stringify(graph)}`);
    }
    if (process.env.PC_PROFILE === '0') continue;
    await cdp.send('Profiler.start');
    const times = await page.evaluate(async ([N]) => {
      const w = window.__app.world, gl = w.renderer.getContext(), px = new Uint8Array(4), t = [];
      for (let i = 0; i < N; i++) {
        // (the frame alone between two marks; the wait for the card outside it)
        const a = performance.now(); w.frame(); t.push(performance.now() - a);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        if (i % 20 === 19) await new Promise((r) => setTimeout(r, 1));
      }
      return t;
    }, [N]);
    const { profile } = await cdp.send('Profiler.stop');
    fs.writeFileSync(path.join(outDir, `cpu-${tag}-${view}.cpuprofile`), JSON.stringify(profile));
    const s = [...times].sort((a, b) => a - b), q = (f) => +s[Math.min(s.length - 1, Math.floor(f * s.length))].toFixed(2);
    const frame = { p10: q(0.1), p50: q(0.5), p90: q(0.9), avg: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2), n: times.length };
    // self and total time per function, counted only inside World#frame
    const byId = new Map(profile.nodes.map((n) => [n.id, n])), parent = new Map();
    for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
    const name = (n) => { const cf = n.callFrame, url = (cf.url || '').replace(/^.*\/dist\//, '').replace(/^.*\/app\//, ''); return `${cf.functionName || '(anonymous)'} ${url}:${cf.lineNumber}`; };
    const self = new Map(), total = new Map();
    let inFrame = 0;
    const isFrame = (n) => n.callFrame.functionName === 'frame' && /app\.js|chunk/.test(n.callFrame.url || '');
    for (let i = 0; i < profile.samples.length; i++) {
      const d = (profile.timeDeltas[i] || 0) / 1000;
      let id = profile.samples[i], n = byId.get(id);
      const full = [];
      while (n) { full.push(n); id = parent.get(id); n = id != null ? byId.get(id) : null; }
      // (cut at the outermost `frame`: the world's own, which calls the sky's and the reflections' `frame`)
      let outer = -1;
      for (let j = 0; j < full.length; j++) if (isFrame(full[j])) outer = j;
      if (outer < 0) continue;
      const stack = full.slice(0, outer + 1);
      inFrame += d;
      const k0 = name(stack[0]); self.set(k0, (self.get(k0) || 0) + d);
      const seen = new Set();
      for (const x of stack) { const k = name(x); if (seen.has(k)) continue; seen.add(k); total.set(k, (total.get(k) || 0) + d); }
    }
    const per = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => [+(v / N).toFixed(3), k]);
    const r = { frame, inFrameMsPerFrame: +(inFrame / N).toFixed(3), self: per(self), total: per(total) };
    result.views[view] = r;
    console.log(`FRAME ${view} ${tier} ${JSON.stringify(frame)} profiled=${r.inFrameMsPerFrame} ms/frame`);
    for (const [ms, k] of r.self) console.log(`SELF ${view} ${ms.toFixed(3).padStart(7)} ${k}`);
    for (const [ms, k] of r.total) console.log(`TOTAL ${view} ${ms.toFixed(3).padStart(7)} ${k}`);
  }
  fs.writeFileSync(path.join(outDir, `perf-cpu-${tag}.json`), JSON.stringify(result, null, 1));
  console.log('DONE perf-cpu');
};
