// The trees' levels of detail: does a crown change when a tree swaps its template, and how often does that happen on
// a walk? Runs against this build and against an older one (APP_DIR) alike: it only uses what both have (the trees'
// BatchedMeshes, whose geometries come in pairs, near and far).
//   1. pop: for a sample of trees, the eye stands where the swap happens (this build: just beyond the band in which
//      the shader turns the near template into the far one, NATURE.uLodFar; older builds: 43 m), looks at the tree, and
//      the picture is taken with the near and with the far template. The share of the tree's pixels that change is the
//      size of the pop (0: nothing to see).
//   2. walk: along the garden path to the jetty and round the east shore, frame by frame: how many trees swapped their
//      template in a frame, and the frame times (CPU per frame, the interval between frames).
// Prints PASS/FAIL lines (this build) or INFO lines (LOD_INFO=1, for an older build) and one summary line.
//   node build/screenshot.js lod-check          (LOD_SHOTS=1 saves the near/far pictures of the first trees)
module.exports = async ({ app, page, shot, sleep }) => {
  const W = +process.env.PERF_W || 1600, H = +process.env.PERF_H || 900;
  await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setContentSize(w, h); }, [W, H]);
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(1500);
  await page.evaluate(() => { window.__app.world.stop(); window.__app.closeAllPanels(); document.querySelector('#hud')?.style.setProperty('opacity', '0'); });
  const info = !!process.env.LOD_INFO;
  let failures = 0, passes = 0;
  const check = (name, ok, data) => { if (info) { console.log(`INFO ${name} ${JSON.stringify(data)}`); return; } console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${data !== undefined ? ' ' + JSON.stringify(data) : ''}`); if (ok) passes++; else failures++; };

  await page.evaluate(() => {
    const w = window.__app.world;
    w.applySettings({ ...w.settings, weather: 'clear', timeMode: 'fixed', fixedHour: 14, season: 'summer', graphics: { ...w.settings.graphics, quality: 'high', bloom: true, shadows: true, ssao: true, resolutionScale: 1, fov: 72 } });
    w.env.set({ hour: 14 });
    // the trees' meshes: per species bark and leaves, instance i = the i-th tree of that species
    const g = w.env.garden, meshes = [];
    w.scene.traverse((o) => { if (o.isBatchedMesh && /-(bark|leaves)$/.test(o.name)) meshes.push(o); });
    const bySp = new Map();
    for (const t of g.trees) { if (!bySp.has(t.sp)) bySp.set(t.sp, []); bySp.get(t.sp).push(t); }
    const L = window.__lod = { meshes, bySp, g };
    L.instances = (t) => { const i = bySp.get(t.sp).indexOf(t); return meshes.filter((m) => m.name.startsWith(t.sp + '-')).map((m) => [m, i]); };
    L.switchAt = g.lod ? g.lod.far + 1.2 : 43;
    L.read = () => {
      const gl = w.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { px, W, H };
    };
    // draw exactly what is set (no time passes: no sway, no flutter between two pictures)
    L.draw = () => { if (w.bloom.enabled || w.ao.enabled || w.godrays.wanted) w.composer.render(0); else w.renderer.render(w.scene, w.camera); };
  });

  // ---- 1. the pop at the swap ------------------------------------------------------------------------------------
  const pop = await page.evaluate(async (shots) => {
    const w = window.__app.world, L = window.__lod, p = w.player, out = [];
    // trees of every broadleaf and conifer kind round the garden, each seen from the garden's side
    const centre = [0, 30], sample = [];
    for (const sp of ['beech', 'oak', 'birch', 'spruce', 'pine']) {
      const list = (L.bySp.get(sp) || []).filter((t) => { const d = Math.hypot(t.x - centre[0], t.z - centre[1]); return d > 30 && d < 75; });
      for (let k = 0; k < Math.min(3, list.length); k++) sample.push(list[Math.floor((k + 0.5) * list.length / 3)]);
    }
    for (const t of sample) {
      const dx = centre[0] - t.x, dz = centre[1] - t.z, l = Math.hypot(dx, dz), D = L.switchAt;
      const x = t.x + dx / l * D, z = t.z + dz / l * D;
      const ground = w.env.garden.outdoor.terrainHeight(t.x, t.z), eyeY = w.env.garden.outdoor.terrainHeight(x, z) + 1.62;
      p.transition = null; p.setPose(x, z, Math.atan2(t.x - x, t.z - z) + Math.PI, 0);
      for (let i = 0; i < 6; i++) w.frame();
      // the eye exactly there (the player may have been kept on the walkable area), looking at the crown; from here on
      // nothing moves
      w.camera.position.set(x, eyeY, z); w.camera.lookAt(t.x, ground + 7 * t.scale, t.z); w.camera.updateMatrixWorld();
      const inst = L.instances(t);
      const set = (far) => { for (const [m, i] of inst) { const gid = m.getGeometryIdAt(i); m.setGeometryIdAt(i, far ? gid | 1 : gid & ~1); } };
      const before = inst.map(([m, i]) => m.getGeometryIdAt(i));
      // only this tree: the others of the wood would hide it at this distance
      const hidden = [];
      for (const m of L.meshes) for (let i = 0; i < m.instanceCount; i++) { if (inst.some(([mm, ii]) => mm === m && ii === i)) continue; if (m.getVisibleAt(i)) { m.setVisibleAt(i, false); hidden.push([m, i]); } }
      set(false); L.draw(); const a = L.read();
      set(true); L.draw(); const b = L.read();
      inst.forEach(([m, i], k) => m.setGeometryIdAt(i, before[k]));
      // the tree's pixels: where either picture differs from the picture without it
      for (const [m, i] of inst) m.setVisibleAt(i, false);
      L.draw(); const c = L.read();
      for (const [m, i] of inst) m.setVisibleAt(i, true);
      for (const [m, i] of hidden) m.setVisibleAt(i, true);
      let tree = 0, changed = 0;
      for (let k = 0; k < a.px.length; k += 4) {
        const da = Math.abs(a.px[k] - c.px[k]) + Math.abs(a.px[k + 1] - c.px[k + 1]) + Math.abs(a.px[k + 2] - c.px[k + 2]);
        const db = Math.abs(b.px[k] - c.px[k]) + Math.abs(b.px[k + 1] - c.px[k + 1]) + Math.abs(b.px[k + 2] - c.px[k + 2]);
        if (da > 30 || db > 30) { tree++; const dab = Math.abs(a.px[k] - b.px[k]) + Math.abs(a.px[k + 1] - b.px[k + 1]) + Math.abs(a.px[k + 2] - b.px[k + 2]); if (dab > 30) changed++; }
      }
      out.push({ sp: t.sp, d: +D.toFixed(1), tree, changed, share: tree ? +(changed / tree).toFixed(3) : null });
      if (shots && out.length <= 3) { window.__lodShot = out.length; }
    }
    return out;
  }, !!process.env.LOD_SHOTS);
  const seen = pop.filter((r) => r.tree > 150);
  const worst = Math.max(0, ...seen.map((r) => r.share));
  const mean = seen.length ? seen.reduce((a, r) => a + r.share, 0) / seen.length : null;
  console.log(`POP switchAt=${pop[0]?.d} ${JSON.stringify(pop)}`);
  check('a tree that swaps its template looks the same before and after (share of its pixels that change: mean ≤ 3 %, none over 8 %)', seen.length >= 8 && mean <= 0.03 && worst <= 0.08, { trees: seen.length, mean: mean && +mean.toFixed(3), worst });

  // ---- 2. a walk along the path ---------------------------------------------------------------------------------
  const busyNow = () => { try { return parseFloat(require('child_process').execSync('nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits', { timeout: 5000 }).toString()); } catch { return NaN; } };
  const others = busyNow();
  const walk = await page.evaluate(async () => {
    const w = window.__app.world, L = window.__lod, p = w.player, O = w.env.garden.outdoor, J = O.jetty;
    p.transition = null; p.setPose(0.3, 7.2, Math.PI, 0);
    const gids = () => L.meshes.map((m) => { const a = new Int32Array(m.instanceCount ?? m._instanceInfo.length); for (let i = 0; i < a.length; i++) a[i] = m.getGeometryIdAt(i); return a; });
    let prev = gids();
    const perFrame = [], cpu = [], gaps = [], slow = [];
    const orig = w.frame.bind(w);
    w.frame = () => {
      const np = w.renderer.info.programs.length;
      const a = performance.now(); orig(); const t = performance.now() - a; cpu.push(t);
      if (t > 25 && slow.length < 12) slow.push({ i: cpu.length, t: +t.toFixed(1), at: [+p.position.x.toFixed(1), +p.position.z.toFixed(1)], newProg: w.renderer.info.programs.length - np });
      const now = gids(); let n = 0;
      // (bark and leaves swap together: count the trees, not the meshes)
      now.forEach((arr, k) => { if (!/-leaves$/.test(L.meshes[k].name)) return; for (let i = 0; i < arr.length; i++) if (arr[i] !== prev[k][i]) n++; });
      perFrame.push(n); prev = now;
    };
    w.start();
    await new Promise((r) => setTimeout(r, 1500));
    perFrame.length = 0; cpu.length = 0; slow.length = 0;
    let last = 0, on = true;
    const tick = (t) => { if (last) gaps.push(t - last); last = t; if (on) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const route = [[0.2, 12.5], [-1.4, 17], [-4.4, 22.5], [-8.6, 27.5], [-12.6, 30.6], J.root, J.at(J.len - J.platLen - 0.5, 0), J.root, [-13.2, 37.6], [-10.6, 42.5], [-9.6, 48], [-3.5, 54], [8.6, 49], [11, 44.4], [10, 33], [3, 22]];
    // (the swaps from here on: those that happen while walking, not when the world was first laid out)
    if (w.env.garden.lod) w.env.garden.lod.stats.at.length = 0;
    const programs0 = w.renderer.info.programs.length, known = new Set(w.renderer.info.programs);
    p.keys.clear(); p.keys.add('KeyW');
    let leg = 0; const t0 = performance.now();
    while (leg < route.length && performance.now() - t0 < 70000) {
      const [tx, tz] = route[leg], dx = tx - p.position.x, dz = tz - p.position.z;
      if (Math.hypot(dx, dz) < 0.8) { leg++; continue; }
      p.yaw = Math.atan2(-dx, -dz);
      await new Promise((r) => setTimeout(r, 30));
    }
    p.keys.clear(); on = false; w.stop(); w.frame = orig;
    const st = (a) => { const s = [...a].sort((x, y) => x - y), q = (f) => +(s[Math.min(s.length - 1, Math.floor(f * s.length))] || 0).toFixed(2); return { n: s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1), over25: s.filter((x) => x > 25).length }; };
    const swaps = perFrame.reduce((a, b) => a + b, 0);
    const added = w.renderer.info.programs.filter((q) => !known.has(q)).map((q) => q.name + ' ' + String(q.cacheKey).slice(0, 80));
    return { slow, added, programs: w.renderer.info.programs.length - programs0, legs: leg, of: route.length, frames: perFrame.length, swaps, framesWithSwaps: perFrame.filter((n) => n > 0).length, maxPerFrame: Math.max(0, ...perFrame), cpu: st(cpu), gaps: st(gaps), stats: w.env.garden.lod ? { near: w.env.garden.lod.near, far: w.env.garden.lod.far, at: w.env.garden.lod.stats.at.slice(0, 20) } : null };
  });
  console.log(`WALK others=${others}% ${JSON.stringify(walk)}`);
  check('the walk along the path reaches the jetty and comes back round the east shore', walk.legs === walk.of, { legs: walk.legs, of: walk.of });
  // (the levels are chosen four times a second: a walker may be a few decimetres inside the limit by then, where the
  // shader's blend is complete all the same)
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  if (walk.stats) check('every swap happens where the shader has made both templates alike (its blend ≥ 99.9 % complete)', walk.stats.at.every((d) => sm(walk.stats.near, walk.stats.far, d) >= 0.999), walk.stats);
  console.log(`LOD-SUMMARY ${info ? 'info' : `${passes} passed, ${failures} failed`} pop(mean=${mean && mean.toFixed(3)}, worst=${worst}) swaps=${walk.swaps} framesWithSwaps=${walk.framesWithSwaps}/${walk.frames} maxPerFrame=${walk.maxPerFrame} cpu=${JSON.stringify(walk.cpu)} gaps=${JSON.stringify(walk.gaps)}`);
};
