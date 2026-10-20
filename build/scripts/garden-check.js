// The garden of 0.7: water lilies, reeds, seasons and the fire bowl.
//   lilies   the pads float just above the water (stacked where they overlap), every pad is drawn whole (with the lake
//            drawn over the scene nothing of a pad is covered or cut, from above and from the low angle of the jetty),
//            pink blossoms and buds, open by day and closed at night
//   reeds    clumps of reed and cattail of varied height along the shore, none on the jetty, the path or the beach; they
//            stand still without wind and sway with it
//   seasons  every season builds without a renderer error, without a new shader program and without a frame over 50 ms
//            when it is switched; autumn colours the broadleaf trees, winter makes them bare and lays snow, spring
//            puts the fruit trees in blossom
//   fire     E on the bowl lights the fire and puts it out (the label says which), it burns by itself at night, its
//            light reaches the ground round it, the stumps are seats facing it, the bowl keeps the player out, the place
//            "Feuerschale" leads there; world.fireBowl gives the sounds what they need
//   settings the row "Jahreszeit" in Licht & Wetter: a click sets the season of the world, the language switch turns
//            the row into English at once
// GC_PARTS=lilies,reeds,seasons,fire,settings,shots picks parts; GC_SHOTS=1 (or the part 'shots') saves the pictures. Prints
// PASS/FAIL lines and one summary line. Muted and hidden like every harness script.
//   node build/screenshot.js garden-check
module.exports = async ({ app, page, shot, sleep }) => {
  const only = (process.env.GC_PARTS || '').split(',').filter(Boolean);
  const want = (part) => (!only.length && part !== 'shots') || only.includes(part) || (part === 'shots' && process.env.GC_SHOTS);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1600, 900); });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 300)));
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  // the shelves follow the scan some seconds later (main.js onLibraryUpdate): their programs are not the garden's
  for (let i = 0; i < 60; i++) {
    const done = await page.evaluate(() => {
      const a = window.__app, key = (l) => (l ? l.departments.map((d) => d.name + ':' + d.shelves.map((s) => s.name + '=' + s.bookIds.length).join(',')).join('|') : '');
      return a.world.library === a.state.library || key(a.world.library) === key(a.state.library);
    });
    if (done) break;
    await sleep(500);
  }
  await sleep(1500);
  await page.evaluate(() => { window.__app.world.stop(); window.__app.closeAllPanels(); });
  await sleep(300);
  let failures = 0, passes = 0, skipped = 0;
  const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); if (ok) passes++; else failures++; };
  const skip = (name, why, info) => { console.log(`SKIP ${name} (${why})${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); skipped++; };
  // how busy other programs keep the graphics card (frame times are judged only on a card of its own)
  const busyNow = () => { try { return parseFloat(require('child_process').execSync('nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits', { timeout: 5000 }).toString()); } catch { return NaN; } };
  const busy = async () => { const v = []; for (let i = 0; i < 7; i++) { const b = busyNow(); if (!Number.isNaN(b)) v.push(b); await sleep(250); } v.sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; };

  // ---- helpers in the page -----------------------------------------------------------------------------------------
  await page.evaluate(() => {
    const w = window.__app.world, g = w.env.garden, p = w.player;
    const G = window.__gc = { w, g };
    G.set = (patch) => {
      w.applySettings({ ...w.settings, timeMode: 'fixed', graphics: { ...w.settings.graphics, quality: 'high', bloom: true, shadows: true, ssao: true, resolutionScale: 1, fov: 72 }, ...patch });
      if (patch.fixedHour != null) w.env.set({ hour: patch.fixedHour });
      g.seasons.settle(); g.lilies.settle(); w.fireBowl.settle();
    };
    G.pose = (x, z, yaw = 0, pitch = 0) => { if (w.actions.seatedId) w.actions.leaveSeat(); p.transition = null; p.keys.clear(); p.setPose(x, z, yaw, pitch); };
    G.draw = () => { if (w.bloom.enabled || w.ao.enabled || w.godrays.wanted) w.composer.render(0); else w.renderer.render(w.scene, w.camera); };
    // Pictures for comparisons: the scene alone, without bloom, AO and rays (their glow and shade spread over a whole
    // picture) and without multisampling (no mixed pixels at edges), linear, into a float target of its own (the same
    // shader programs as the composer's targets: nothing compiles for the check). G.raw() draws, G.read() reads it back.
    const RT = w.composer.renderTarget1.constructor, FLOAT = 1015;
    G.raw = () => {
      const r = w.renderer, W = Math.round(r.domElement.width / 2), H = Math.round(r.domElement.height / 2);
      if (!G.rt || G.rt.width !== W || G.rt.height !== H) { G.rt?.dispose(); G.rt = new RT(W, H, { type: FLOAT, depthBuffer: true }); }
      const prev = r.getRenderTarget();
      r.setRenderTarget(G.rt); r.clear(); r.render(w.scene, w.camera); r.setRenderTarget(prev);
      G.rawDrawn = true;
    };
    // (the float picture as 0 … 255 per channel of its square root: dark linear values keep their differences)
    const readRaw = () => {
      const W = G.rt.width, H = G.rt.height, f = new Float32Array(W * H * 4), px = new Uint8Array(W * H * 4);
      w.renderer.readRenderTargetPixels(G.rt, 0, 0, W, H, f);
      for (let i = 0; i < f.length; i++) px[i] = Math.min(255, Math.round(Math.sqrt(Math.max(0, f[i])) * 255));
      return { px, W, H };
    };
    G.read = () => { if (G.rawDrawn) { G.rawDrawn = false; return readRaw(); } const gl = w.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return { px, W, H }; };
    // a mask shrunk by one pixel (the pixels whose four neighbours are in it as well)
    G.erode = (mask, W, H) => { const out = new Uint8Array(W * H); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; out[i] = mask[i] && mask[i - 1] && mask[i + 1] && mask[i - W] && mask[i + W] ? 1 : 0; } return out; };
    // draw only some objects (the rest of the scene hidden for the picture)
    G.only = (keep, fn) => {
      const hidden = [];
      w.scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine) && o.visible && !keep.some((k) => k === o || k.getObjectById?.(o.id))) { o.visible = false; hidden.push(o); } });
      try { return fn(); } finally { for (const o of hidden) o.visible = true; }
    };
    G.look = (from, at) => { w.camera.position.set(...from); w.camera.up.set(0, 1, 0); if (Math.abs(from[0] - at[0]) + Math.abs(from[2] - at[2]) < 1e-3) w.camera.up.set(0, 0, -1); w.camera.lookAt(...at); w.camera.updateMatrixWorld(); };
    G.diff = (a, b, k, t = 30) => Math.abs(a.px[k] - b.px[k]) + Math.abs(a.px[k + 1] - b.px[k + 1]) + Math.abs(a.px[k + 2] - b.px[k + 2]) > t;
    G.programs = () => w.renderer.info.programs.length;
  });
  const programs0 = await page.evaluate(() => { const G = window.__gc; G.set({ weather: 'clear', fixedHour: 14, season: 'summer' }); for (let i = 0; i < 8; i++) G.w.frame(); G.known = new Set(G.w.renderer.info.programs); return G.programs(); });

  // ---- 1. water lilies ---------------------------------------------------------------------------------------------
  if (want('lilies')) {
    const r = await page.evaluate(() => {
      const G = window.__gc, { w, g } = G, O = g.outdoor, L = g.lilies, WY = O.waterY;
      const pads = L.pads, shown = pads.filter((q) => q.shown);
      // where they lie
      const out = { pads: pads.length, shown: shown.length, flowers: L.meshes[1].count, buds: L.flowers.filter((f) => f.open === 0).length };
      out.lowest = Math.min(...pads.map((q) => q.y - WY)); out.highest = Math.max(...pads.map((q) => q.y - WY));
      out.shallow = pads.filter((q) => WY - O.terrainHeight(q.x, q.z) < 0.25).length;
      let clash = 0, overlaps = 0;
      for (let i = 0; i < pads.length; i++) for (let j = i + 1; j < pads.length; j++) {
        const a = pads[i], b = pads[j];
        if (Math.hypot(a.x - b.x, a.z - b.z) < a.r + b.r) { overlaps++; if (Math.abs(a.y - b.y) < 0.004) clash++; }
      }
      out.overlaps = overlaps; out.clash = clash;
      out.exported = typeof G.w.env.garden.lilies === 'object' && Array.isArray(window.__app.world.env.garden.lilies.pads);
      // drawn whole: each pad alone, then with the lake drawn over it; from above and from the low angle of the jetty
      const padMesh = L.meshes[0], water = g.water.mesh;
      const sample = [...shown].sort((a, b) => b.level - a.level || b.r - a.r).slice(0, 4).concat(shown.filter((q) => q.level === 0).slice(0, 3));
      const res = [];
      for (const q of sample) for (const view of ['above', 'low']) {
        const from = view === 'above' ? [q.x, q.y + q.r * 4.5, q.z + 0.001] : [q.x + 6.5 * Math.cos(1), q.y + 1.6, q.z + 6.5 * Math.sin(1)];
        G.look(from, [q.x, q.y, q.z]);
        const a = G.only([padMesh], () => { G.raw(); return G.read(); });
        const b = G.only([padMesh, water], () => { G.raw(); return G.read(); });
        // the pad's pixels: where it differs from the empty picture
        const c = G.only([], () => { G.raw(); return G.read(); });
        const mask = new Uint8Array(a.W * a.H);
        for (let k = 0, i = 0; k < a.px.length; k += 4, i++) mask[i] = G.diff(a, c, k, 6) ? 1 : 0;
        const inner = G.erode(mask, a.W, a.H);
        let pad = 0, covered = 0;
        for (let i = 0; i < inner.length; i++) if (inner[i]) { pad++; if (G.diff(a, b, i * 4, 6)) covered++; }
        res.push({ view, level: q.level, r: +q.r.toFixed(2), pad, covered, share: pad ? +(covered / pad).toFixed(4) : null });
      }
      out.drawn = res;
      // the area seen from straight above against the disc it should be (minus the notch): the pad is whole
      const q0 = sample[0];
      G.look([q0.x, q0.y + 1.2, q0.z + 0.001], [q0.x, q0.y, q0.z]);
      const one = G.only([padMesh], () => {
        // only this pad: the others out of the way for the moment
        const keep = padMesh.count; const m = new padMesh.matrixWorld.constructor(); const idx = shown.indexOf(q0);
        const tmp = []; for (let i = 0; i < keep; i++) { padMesh.getMatrixAt(i, m); tmp.push(m.clone()); }
        const zero = new padMesh.matrixWorld.constructor().makeScale(0, 0, 0);
        for (let i = 0; i < keep; i++) if (i !== idx) padMesh.setMatrixAt(i, zero);
        padMesh.instanceMatrix.needsUpdate = true;
        G.raw(); const img = G.read();
        tmp.forEach((mm, i) => padMesh.setMatrixAt(i, mm)); padMesh.instanceMatrix.needsUpdate = true;
        return img;
      });
      const empty = G.only([], () => { G.raw(); return G.read(); });
      let px = 0; for (let k = 0; k < one.px.length; k += 4) if (G.diff(one, empty, k, 6)) px++;
      // the pad's radius in pixels: the camera's vertical field of view over 1.2 m
      const fov = w.camera.fov * Math.PI / 180, H = one.H, rpx = q0.r * (H / 2) / Math.tan(fov / 2) / 1.2;
      out.area = { px, expected: Math.round(Math.PI * rpx * rpx * (1 - 0.22 / (2 * Math.PI))), ratio: +(px / (Math.PI * rpx * rpx * (1 - 0.22 / (2 * Math.PI)))).toFixed(3) };
      return { out };
    });
    // the blossoms: open by day, closed at night (the same light for both pictures: only how far they open)
    const blossoms = await page.evaluate(() => {
      const G = window.__gc, { g } = G, L = g.lilies, fl = L.meshes[1];
      const f = L.flowers.find((x) => x.open > 0.85);
      const uOpen = () => L.uniforms.uLilyOpen;
      // by day (14:00) and at night (23:00), the lilies settled
      G.set({ fixedHour: 23 }); const night = uOpen().value;
      G.set({ fixedHour: 14 }); const day = uOpen().value;
      // the pictures in the same light: only how far the blossom opens differs
      G.look([f.x, f.y + 0.6, f.z + 0.001], [f.x, f.y, f.z]);
      const empty = G.only([], () => { G.raw(); return G.read(); });
      const shotOf = (open) => { uOpen().value = open; return G.only([fl], () => { G.raw(); return G.read(); }); };
      const a = shotOf(day), b = shotOf(night);
      let open = 0, closed = 0;
      for (let k = 0; k < a.px.length; k += 4) { if (G.diff(a, empty, k, 20)) open++; if (G.diff(b, empty, k, 20)) closed++; }
      g.lilies.settle();
      return { day, night, open, closed };
    });
    const o = r.out;
    check('water lilies: pads in clusters and pink blossoms with buds on the lake', o.pads >= 80 && o.shown === o.pads && o.flowers >= 18 && o.buds >= 3 && o.exported, { pads: o.pads, flowers: o.flowers, buds: o.buds });
    check('every pad floats on water at least 25 cm deep, 4 mm to 3 cm above its surface', o.shallow === 0 && o.lowest >= 0.004 && o.highest <= 0.03, { lowest: +o.lowest.toFixed(4), highest: +o.highest.toFixed(4), shallow: o.shallow });
    check('overlapping pads lie on each other (at least 4 mm apart in height): nothing fights', o.overlaps > 5 && o.clash === 0, { overlaps: o.overlaps, clash: o.clash });
    const worst = Math.max(...o.drawn.map((d) => d.share ?? 1));
    check('every pad is drawn whole: the lake covers nothing of it, from above and from the low angle of the jetty', worst <= 0.002 && o.drawn.every((d) => d.pad > 200), { worst, drawn: o.drawn });
    check('a pad seen from straight above is the full disc with its notch (no straight cut)', o.area.ratio > 0.9 && o.area.ratio < 1.12, o.area);
    check('the blossoms open by day and close at night', blossoms.day > 0.95 && blossoms.night < 0.05 && blossoms.open > blossoms.closed * 1.6, blossoms);
    // the pads for the frogs (garden.lilyPads): one entry per pad as it is drawn (its instance), following the season
    const spots = await page.evaluate(() => {
      const G = window.__gc, { g } = G, mesh = g.lilies.meshes[0], list = g.lilyPads;
      const m = new mesh.matrixWorld.constructor(), p = new G.w.camera.position.constructor(), q = new G.w.camera.quaternion.constructor(), s = new G.w.camera.position.constructor();
      const match = () => {
        let worst = 0;
        list.forEach((e, i) => { mesh.getMatrixAt(i, m); m.decompose(p, q, s); worst = Math.max(worst, Math.hypot(p.x - e.x, p.z - e.z), Math.abs(p.y - e.y), Math.abs(s.x - e.r)); });
        return { n: list.length, drawn: mesh.count, worst: +worst.toFixed(5), meanR: +(list.reduce((a, e) => a + e.r, 0) / Math.max(1, list.length)).toFixed(3) };
      };
      const summer = match();
      G.set({ season: 'winter', weather: 'clear', fixedHour: 14 }); const winter = match();
      G.set({ season: 'summer', weather: 'clear', fixedHour: 14 }); const back = { ...match(), same: list === g.lilyPads };
      return { summer, winter, back };
    });
    check('garden.lilyPads for the frogs: one entry { x, z, r } per pad as it is drawn, fewer in winter, all again in summer', spots.summer.n === spots.summer.drawn && spots.summer.n > 80 && spots.summer.worst < 1e-4 && spots.winter.n === spots.winter.drawn && spots.winter.n < spots.summer.n && spots.winter.worst < 1e-4 && spots.back.n === spots.summer.n && spots.back.same, spots);
  }

  // ---- 2. reeds and cattails ---------------------------------------------------------------------------------------
  if (want('reeds')) {
    const r = await page.evaluate(() => {
      const G = window.__gc, { w, g } = G, O = g.outdoor, R = g.reeds;
      const reeds = R.clumps.filter((c) => c.kind === 'reed'), cats = R.clumps.filter((c) => c.kind === 'cattail');
      const hs = reeds.map((c) => c.h), mean = hs.reduce((a, b) => a + b, 0) / hs.length, sd = Math.sqrt(hs.reduce((a, b) => a + (b - mean) ** 2, 0) / hs.length);
      const bad = R.clumps.filter((c) => O.pathDist(c.x, c.z) < 1.3 || O.trailDist(c.x, c.z) < 1.0 || g.outdoor.jetty && Math.hypot(c.x - O.jetty.root[0], c.z - O.jetty.root[1]) < 2).length;
      const onLand = R.clumps.filter((c) => O.terrainHeight(c.x, c.z) - O.waterY > 0.12).length;
      // sway: a clump close up, the reeds alone; two moments half a second apart, without wind and with a storm
      const c = reeds.find((x) => Math.hypot(x.x - (-13.5), x.z - 38.5) < 12) || reeds[0];
      const meshes = R.meshes.map((e) => e.mesh);
      G.look([c.x + 2.6, c.y + 1.5, c.z + 2.6], [c.x, c.y + 1.4, c.z]);
      const U = w.renderer.properties.get(meshes[0].material).uniforms;
      const t0 = U.uTime.value, wind0 = U.uWind.value;
      const pic = (wind, t) => { U.uWind.value = wind; U.uTime.value = t; return G.only(meshes, () => { G.raw(); return G.read(); }); };
      const count = (a, b) => { let n = 0; for (let k = 0; k < a.px.length; k += 4) if (G.diff(a, b, k, 30)) n++; return n; };
      const calm = count(pic(0, 100), pic(0, 100.5)), storm = count(pic(1, 100), pic(1, 100.5)), breeze = count(pic(0.3, 100), pic(0.3, 100.5));
      U.uTime.value = t0; U.uWind.value = wind0;
      return { reeds: reeds.length, cattails: cats.length, mean: +mean.toFixed(2), sd: +sd.toFixed(2), min: +Math.min(...hs).toFixed(2), max: +Math.max(...hs).toFixed(2), bad, onLand, calm, breeze, storm };
    });
    check('reeds and cattails along the shore, of varied height', r.reeds >= 150 && r.cattails >= 20 && r.sd > 0.2 && r.max - r.min > 1, r);
    check('no clump on the path, the trails or the jetty, and almost all of them at the water', r.bad === 0 && r.onLand <= r.reeds * 0.15, { bad: r.bad, onLand: r.onLand });
    check('the reeds stand still without wind and sway with it, more in a storm than in a breeze', r.calm === 0 && r.breeze > 100 && r.storm > r.breeze, { calm: r.calm, breeze: r.breeze, storm: r.storm });
  }

  // ---- 3. the seasons ----------------------------------------------------------------------------------------------
  if (want('seasons')) {
    const others = await busy();
    const r = await page.evaluate(async () => {
      const G = window.__gc, { w, g } = G, p = w.player;
      const N = w.env.garden.seasons;
      G.set({ weather: 'clear', fixedHour: 14, season: 'summer' });
      // (on the lawn beyond the deck)
      G.pose(0.4, 10.6, 2.455, 0.05);
      for (let i = 0; i < 10; i++) w.frame();
      const res = [];
      for (const season of ['spring', 'autumn', 'winter', 'summer', 'winter', 'spring']) {
        const np = G.programs(), known = new Set(w.renderer.info.programs);
        // the switch as a person makes it in the settings: applySettings, then the frames that follow
        const t0 = performance.now();
        w.applySettings({ ...w.settings, season });
        const tApply = performance.now() - t0;
        const frames = [], parts = [];
        const envUp = w.env.update.bind(w.env), comp = w.composer, origRender = comp.render.bind(comp);
        let te = 0, tr = 0;
        w.env.update = (dt, cam) => { const a = performance.now(); envUp(dt, cam); te = performance.now() - a; };
        comp.render = (dt) => { const a = performance.now(); origRender(dt); tr = performance.now() - a; };
        for (let i = 0; i < 40; i++) { const a = performance.now(); w.frame(); const t = performance.now() - a; frames.push(t); if (t > 30) parts.push({ i, t: +t.toFixed(1), env: +te.toFixed(1), render: +tr.toFixed(1) }); await new Promise((r) => setTimeout(r, 4)); }
        w.env.update = envUp; comp.render = origRender;
        N.settle();
        const leafMat = w.scene.getObjectByName('fruit-leaves')?.material;
        // which material a new program belongs to (the objects in the scene that use it)
        const fresh = w.renderer.info.programs.filter((q) => !known.has(q)), owners = [];
        if (fresh.length) w.scene.traverse((o) => { for (const m of [o.material, o.customDepthMaterial, o.customDistanceMaterial].flat()) { const pr = m && w.renderer.properties.get(m)?.currentProgram; if (pr && fresh.includes(pr)) owners.push(`${o.name || o.type}:${m.type}${m.name ? '/' + m.name : ''}`); } });
        const added = fresh.map((q) => q.name + ' ' + String(q.cacheKey).slice(0, 400)).concat(owners.length ? ['owners: ' + [...new Set(owners)].join(', ')] : []);
        res.push({ season, name: N.name, apply: +tApply.toFixed(1), worst: +Math.max(...frames).toFixed(1), slow: parts, newPrograms: G.programs() - np, added, blossom: leafMat ? leafMat.map === N.fruitTex.blossom : null });
      }
      return res;
    });
    check('switching the season builds nothing: no new shader program', r.every((s) => s.newPrograms === 0), r.map((s) => ({ season: s.season, newPrograms: s.newPrograms, added: s.added })));
    const budget = 'switching the season: no frame over 50 ms (the settings call included)', frames = r.map((s) => ({ season: s.season, apply: s.apply, worst: s.worst, slow: s.slow }));
    if (others !== null && others <= 15) check(budget, r.every((s) => s.worst + s.apply < 50), frames);
    else skip(budget, others === null ? 'no reading of the graphics card' : `the graphics card was ${others} % busy with other programs`, frames);
    check('the fruit trees blossom in spring only', r.every((s) => s.blossom === (s.season === 'spring')), r.map((s) => [s.season, s.blossom]));
    // autumn: now and then a leaf drifts down from the broadleaf trees round the eye and lands; none falls in summer
    const fall = await page.evaluate(async () => {
      const G = window.__gc, { w, g } = G, L = g.seasons.leaves;
      const watch = async (season) => {
        G.set({ season, weather: 'clear', fixedHour: 14 });
        G.pose(5.5, 27.5, -2.498, 0.1); w.frame();
        // twenty seconds of the season's own clock (no pictures needed); a leaf starts falling when it is new or begins
        // its life again (those still on their way from the season before do not count)
        let most = 0, landed = 0, started = 0;
        const was = L.leaves.map((l) => ({ on: l.on, life: l.life }));
        for (let i = 0; i < 400; i++) {
          g.seasons.update(0.05, 100 + i * 0.05, w.camera);
          most = Math.max(most, L.mesh.count); landed = Math.max(landed, L.leaves.filter((l) => l.on && l.lie).length);
          L.leaves.forEach((l, k) => { if (l.on && (!was[k].on || l.life < was[k].life)) started++; was[k].on = l.on; was[k].life = l.life; });
        }
        for (let i = 0; i < 3; i++) { w.frame(); await new Promise((r) => setTimeout(r, 4)); }
        return { most, landed, started, near: L.near.length };
      };
      return { autumn: await watch('autumn'), summer: await watch('summer') };
    });
    check('autumn: leaves drift down from the broadleaf trees round the eye and land; none starts falling in summer', fall.autumn.most >= 3 && fall.autumn.started >= 3 && fall.autumn.landed >= 1 && fall.summer.started === 0, fall);
    const look = await page.evaluate(() => {
      const G = window.__gc, { w, g } = G, N = g.seasons, out = {};
      // one beech crown seen from the garden, alone (the other trees hidden): its average colour per season
      const tree = g.trees.find((t) => t.sp === 'beech' && Math.hypot(t.x, t.z - 30) > 25 && Math.hypot(t.x, t.z - 30) < 60) || g.trees.find((t) => t.sp === 'beech');
      const leaves = w.scene.getObjectByName('beech-leaves'), idx = g.trees.filter((t) => t.sp === 'beech').indexOf(tree);
      const crown = (season) => {
        G.set({ season, weather: 'clear', fixedHour: 14 });
        const dx = 0 - tree.x, dz = 30 - tree.z, l = Math.hypot(dx, dz), top = g.outdoor.terrainHeight(tree.x, tree.z) + 9 * tree.scale;
        G.look([tree.x + dx / l * 30, top - 2, tree.z + dz / l * 30], [tree.x, top, tree.z]);
        const others = [];
        for (let i = 0; i < leaves.instanceCount; i++) if (i !== idx && leaves.getVisibleAt(i)) { leaves.setVisibleAt(i, false); others.push(i); }
        const img = G.only([leaves], () => { G.raw(); return G.read(); });
        leaves.setVisibleAt(idx, false);
        const empty = G.only([leaves], () => { G.raw(); return G.read(); });
        leaves.setVisibleAt(idx, true); for (const i of others) leaves.setVisibleAt(i, true);
        let r = 0, gg = 0, b = 0, n = 0;
        for (let k = 0; k < img.px.length; k += 4) if (G.diff(img, empty, k, 20)) { r += img.px[k]; gg += img.px[k + 1]; b += img.px[k + 2]; n++; }
        return { n, r: Math.round(r / n), g: Math.round(gg / n), b: Math.round(b / n) };
      };
      out.summer = crown('summer'); out.autumn = crown('autumn'); out.winter = crown('winter');
      // winter: bare, snow on the ground, the lake dark with a rim of ice, the lilies withered
      G.set({ season: 'winter', weather: 'clear', fixedHour: 14 });
      const beech = w.scene.getObjectByName('beech-leaves');
      out.winterState = { bare: w.renderer.properties.get(beech.material).uniforms?.uWinter?.value ?? null, snow: g.water.uniforms.uSnow.value, ice: g.water.uniforms.uWinterW.value, pads: g.lilies.meshes[0].count, flowers: g.lilies.meshes[1].count };
      // the weather's snow (environment.js) in any season: snow and bare trees while it snows, gone when it clears
      const state = () => ({ snow: g.water.uniforms.uSnow.value, bare: w.renderer.properties.get(beech.material).uniforms?.uWinter?.value ?? null });
      G.set({ season: 'summer', weather: 'snow', fixedHour: 14 }); out.summerSnow = state();
      G.set({ season: 'summer', weather: 'clear', fixedHour: 14 }); out.summerClear = state();
      return out;
    });
    check('autumn turns the broadleaf crowns warm (red over green), summer keeps them green', look.summer.g > look.summer.r && look.autumn.r > look.autumn.g * 1.05 && look.autumn.n > 500, { summer: look.summer, autumn: look.autumn });
    check('winter: the broadleaf trees bare (far fewer leaf pixels), snow lies, the lake has its rim of ice, a few withered pads, no blossom', look.winter.n < look.summer.n * 0.6 && look.winterState.bare === 1 && look.winterState.snow > 0.95 && look.winterState.ice > 0.95 && look.winterState.flowers === 0 && look.winterState.pads > 0 && look.winterState.pads < 40, { winter: look.winter, state: look.winterState });
    check('snowfall in summer: snow lies and the trees are bare while it snows, both gone when it clears', look.summerSnow.snow > 0.95 && look.summerSnow.bare === 1 && look.summerClear.snow < 0.05 && look.summerClear.bare === 0, { snowing: look.summerSnow, clear: look.summerClear });
  }

  // ---- 4. the fire bowl -------------------------------------------------------------------------------------------
  if (want('fire')) {
    const r = await page.evaluate(() => {
      const G = window.__gc, { w, g } = G, p = w.player, F = g.outdoor.firebowl, out = {};
      const fb = w.fireBowl;
      out.hook = !!fb && fb.position?.isVector3 === true && typeof fb.isBurning === 'function' && Math.hypot(fb.position.x - F.x, fb.position.z - F.z) < 0.01;
      // by the clock: out by day, burning at night
      G.set({ weather: 'clear', fixedHour: 14, season: 'summer' }); out.day = fb.isBurning();
      G.set({ fixedHour: 22.5 }); out.night = fb.isBurning();
      for (let i = 0; i < 4; i++) w.frame();
      const light = () => { const c = w.renderer.properties.get(w.scene.getObjectByName('ground').material).uniforms?.uFireLight?.value; return c ? +(c.r + c.g + c.b).toFixed(3) : null; };
      out.lightNight = light();
      // E on the bowl, from the place "Feuerschale": the label, then E, then E again
      w.actions.teleport('firebowl');
      p.update(0.01);
      out.place = { at: [+p.position.x.toFixed(2), +p.position.z.toFixed(2)], dist: +Math.hypot(p.position.x - F.x, p.position.z - F.z).toFixed(2), facing: Math.abs(Math.atan2(Math.sin(p.yaw - Math.atan2(-(F.x - p.position.x), -(F.z - p.position.z))), Math.cos(p.yaw - Math.atan2(-(F.x - p.position.x), -(F.z - p.position.z))))) };
      // walk up to 2.2 m and look at the bowl
      const dx = F.x - p.position.x, dz = F.z - p.position.z, d = Math.hypot(dx, dz);
      G.pose(F.x - dx / d * 2.0, F.z - dz / d * 2.0, Math.atan2(-dx, -dz), 0);
      p.pitch = Math.atan2(F.y + 0.45 - (F.y + 1.62), 2.0); p.update(0.01); w.camera.updateMatrixWorld();
      w.actions.rayTimer = 0; w.actions.update(0.01);
      out.aimed = w.actions.target?.kind || w.actions.target?.type || null;
      const label = () => document.querySelector('#look-label')?.textContent || '';
      out.label1 = label();
      const was = fb.isBurning();
      w.actions.act('E'); out.after1 = fb.isBurning(); out.label2 = label();
      w.actions.act('E'); out.after2 = fb.isBurning(); out.label3 = label();
      out.was = was;
      // put out: the light goes once the embers are cold
      fb.setBurning(false); fb.settle(); fb.update(0.016, 1); out.lightOut = light();
      fb.setBurning(null); fb.settle();
      // the stumps: E sits down facing the fire, Space stands up
      const seats = [];
      for (const s of F.seats) {
        const seat = w.seats.get(s.id);
        if (!seat) { seats.push({ id: s.id, missing: true }); continue; }
        G.pose(seat.standPos.x, seat.standPos.z, 0, 0);
        const c = new p.position.constructor().setFromMatrixPosition(seat.obj.matrixWorld); c.y += 0.3;
        const ddx = c.x - p.position.x, ddz = c.z - p.position.z;
        p.yaw = Math.atan2(-ddx, -ddz); p.pitch = Math.atan2(c.y - p.position.y, Math.hypot(ddx, ddz));
        p.update(0.01); w.camera.updateMatrixWorld(); w.actions.rayTimer = 0; w.actions.update(0.01);
        const aimed = w.actions.target?.seat?.id || null;
        const label = document.querySelector('#look-label')?.textContent || '';
        w.actions.act('E');
        for (let i = 0; i < 40; i++) p.update(0.05);
        const seated = w.actions.seatedId;
        const toFire = Math.atan2(-(F.x - p.position.x), -(F.z - p.position.z)), off = Math.abs(Math.atan2(Math.sin(p.yaw - toFire), Math.cos(p.yaw - toFire)));
        const eye = +(p.position.y - s.y).toFixed(2);
        w.actions.act('Space');
        for (let i = 0; i < 40; i++) p.update(0.05);
        seats.push({ id: s.id, aimed, label, seated, facing: +off.toFixed(2), eye, standing: !w.actions.seatedId, free: p.isFree(p.position.x, p.position.z, 0) });
      }
      out.seats = seats;
      // the bowl keeps the player out: straight walks at it from eight directions
      let inside = 0, closest = 9;
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2 + 0.2, sx = F.x + Math.cos(a) * 4, sz = F.z + Math.sin(a) * 4;
        G.pose(sx, sz, Math.atan2(-(F.x - sx), -(F.z - sz)), 0);
        p.keys.add('KeyW');
        for (let i = 0; i < 160; i++) { w.updateDoor(0.05); p.update(0.05); const dd = Math.hypot(p.position.x - F.x, p.position.z - F.z); closest = Math.min(closest, dd); if (dd < F.r + 0.2) inside++; }
        p.keys.clear();
      }
      out.walls = { inside, closest: +closest.toFixed(2), r: F.r };
      return out;
    });
    check('world.fireBowl for the sounds: position (THREE.Vector3) at the bowl and isBurning()', r.hook, { hook: r.hook });
    check('the fire burns by itself at night and is out by day', r.day === false && r.night === true, { day: r.day, night: r.night });
    check('its light reaches the ground round it while it burns, none when it is out', r.lightNight > 0.5 && r.lightOut === 0, { burning: r.lightNight, out: r.lightOut });
    check('the place "Feuerschale" leads there, facing the bowl', r.place.dist > 2.5 && r.place.dist < 4.5 && r.place.facing < 0.15, r.place);
    check('E on the bowl puts the fire out and lights it again, the label says which', r.aimed === 'firebowl' && r.after1 === !r.was && r.after2 === r.was && /Feuerschale|Fire bowl/.test(r.label1) && /(löschen|out)/.test(r.was ? r.label1 : r.label2) && /(anzünden|Light)/.test(r.was ? r.label2 : r.label1), { aimed: r.aimed, was: r.was, after: [r.after1, r.after2], labels: [r.label1, r.label2, r.label3] });
    check('the four stumps: E sits down facing the fire, Space stands up on a free spot', r.seats.length === 4 && r.seats.every((s) => s.aimed === s.id && s.seated === s.id && s.facing < 0.35 && s.eye > 0.9 && s.eye < 1.4 && s.standing && s.free), r.seats);
    check('a stump is labelled as one ("Baumstumpf · E Hinsetzen")', r.seats.every((s) => /Baumstumpf/.test(s.label) && /Hinsetzen/.test(s.label)), r.seats.map((s) => s.label));
    check('nobody walks into the bowl (straight walks from eight directions)', r.walls.inside === 0 && r.walls.closest >= r.walls.r + 0.25, r.walls);
  }

  // ---- 5. the setting --------------------------------------------------------------------------------------------------
  if (want('settings')) {
    const r = await page.evaluate(async () => {
      const app = window.__app, out = {}, wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const row = (re) => [...document.querySelectorAll('.settings-panel .setting')].find((el) => re.test(el.querySelector('label')?.textContent || ''));
      await app.ctx.api.settings.set({ language: 'de', season: 'auto' });
      app.openPanel('settings', { section: 'light' });
      await wait(500);
      const de = row(/^Jahreszeit/);
      out.label = de?.querySelector('label')?.textContent || null;
      out.options = [...(de?.querySelectorAll('button') || [])].map((b) => b.textContent);
      out.calendar = app.world.env.garden.seasons.name;
      const autumn = [...(de?.querySelectorAll('button') || [])].find((b) => b.textContent === 'Herbst');
      autumn?.focus(); out.focusable = document.activeElement === autumn;
      autumn?.click();
      await wait(700);
      out.saved = app.state.settings.season; out.world = app.world.env.garden.seasons.name;
      await app.ctx.api.settings.set({ language: 'en' });
      await wait(700);
      const en = row(/^Season/);
      out.labelEn = en?.querySelector('label')?.textContent || null;
      out.optionsEn = [...(en?.querySelectorAll('button') || [])].map((b) => b.textContent);
      await app.ctx.api.settings.set({ language: 'de', season: 'auto' });
      await wait(500);
      app.closeAllPanels();
      out.back = app.world.env.garden.seasons.name;
      return out;
    });
    check('Licht & Wetter has the row "Jahreszeit: Nach Kalender / Frühling / Sommer / Herbst / Winter"', r.label === 'Jahreszeit' && r.options.join('|') === 'Nach Kalender|Frühling|Sommer|Herbst|Winter' && r.focusable, r);
    check('a click on "Herbst" saves the season and the world turns to autumn; "Nach Kalender" follows the calendar again', r.saved === 'autumn' && r.world === 'autumn' && r.back === r.calendar, { saved: r.saved, world: r.world, calendar: r.calendar, back: r.back });
    check('in English at once: "Season: By calendar / Spring / Summer / Autumn / Winter"', r.labelEn === 'Season' && r.optionsEn.join('|') === 'By calendar|Spring|Summer|Autumn|Winter', { label: r.labelEn, options: r.optionsEn });
  }

  // ---- 6. pictures --------------------------------------------------------------------------------------------------
  if (want('shots')) {
    const views = [
      ['lilies-jetty', -24.0, 38.9, -2.25, -0.16, 'summer', 'clear', 14], ['lilies-jetty-dusk', -24.0, 38.9, -2.25, -0.16, 'summer', 'clear', 19.8],
      ['lilies-close', -14.5, 44.5, -2.0, -0.55, 'summer', 'clear', 14], ['reeds-shore', -13.5, 38.5, 2.2, -0.15, 'summer', 'clear', 15],
    ];
    for (const season of ['spring', 'summer', 'autumn', 'winter']) {
      views.push([`${season}-terrace`, 0.4, 8.6, 2.455, 0.0, season, 'clear', 14]);
      views.push([`${season}-jetty`, -24.5, 39.2, -2.3, -0.1, season, 'clear', 14]);
    }
    views.push(['firebowl-night', -13.0, 19.45, 1.615, -0.2, 'summer', 'clear', 22.5]);
    for (const [name, x, z, yaw, pitch, season, weather, hour] of views) {
      await page.evaluate(([x, z, yaw, pitch, season, weather, hour]) => {
        const G = window.__gc; G.set({ season, weather, fixedHour: hour }); G.pose(x, z, yaw, pitch);
        document.querySelector('#hud')?.style.setProperty('opacity', '0');
      }, [x, z, yaw, pitch, season, weather, hour]);
      for (let i = 0; i < 12; i++) { await page.evaluate(() => window.__gc.w.frame()); await sleep(40); }
      await shot(`gc-${name}`);
    }
    // seated on the stump south of the fire at night
    await page.evaluate(() => { const G = window.__gc; G.set({ season: 'summer', weather: 'clear', fixedHour: 22.5 }); G.pose(0, 10, 0, 0); G.w.actions.sit('firestump1'); for (let i = 0; i < 40; i++) G.w.player.update(0.05); });
    for (let i = 0; i < 12; i++) { await page.evaluate(() => window.__gc.w.frame()); await sleep(40); }
    await shot('gc-firebowl-seated');
    await page.evaluate(() => { window.__gc.w.actions.leaveSeat(); document.querySelector('#hud')?.style.setProperty('opacity', '1'); });
  }

  const late = await page.evaluate(() => {
    const G = window.__gc, w = G.w, fresh = w.renderer.info.programs.filter((q) => !G.known.has(q)), owners = [];
    w.scene.traverse((o) => { for (const [slot, m] of [['material', o.material], ['depth', o.customDepthMaterial], ['distance', o.customDistanceMaterial]]) { const pr = m && !Array.isArray(m) && w.renderer.properties.get(m)?.currentProgram; if (pr && fresh.includes(pr)) owners.push(`${o.name || o.type}.${slot}:${m.type}`); } });
    return { n: G.programs(), owners: [...new Set(owners)], keys: fresh.map((q) => String(q.cacheKey).slice(0, 60)) };
  });
  // (godrays.js's stamp, the trees pressed into the sun's shadow map, used to compile once more when a season or the
  // snow first redrew that map: its warm-up compiled it one-sided, the shadow pass draws it from both sides)
  check('no shader program compiled after the start (lilies, reeds, seasons, fire and the trees in the sun\'s map were all warmed up)', late.n === programs0, { before: programs0, after: late.n, owners: late.owners, keys: late.keys });
  check('no renderer error', errors.length === 0, errors.slice(0, 5));
  console.log(`GARDEN-SUMMARY ${passes} passed, ${failures} failed, ${skipped} skipped`);
};
