// Winter in the garden (0.7.1): tracks in the snow, the frozen lake to walk on, the snow on the path and the terrace.
//   prints   the player's prints: on snow at his steps (spacing, left and right in turn, along his way, on the ground),
//            longer and further apart when running, a scuffed mark where a jump lands; none indoors and none without
//            snow; they fade and are gone within their life, sooner while it snows, at once when the snow goes; a full
//            budget gives way from the oldest; faint on the ice; drawn as a shaded hollow (darker and brighter than the
//            snow round it, never black), by day, at dusk and by moonlight
//   animals  a deer and a fox leave hoof and paw prints where their front feet come down, on the ground; a blackbird
//            hopping on the lawn pairs of three-toed prints side by side, a crow walking single ones in turn
//   ice      the lake carries you in winter and not in summer: from the shore and off the end of the jetty; from the ice
//            the jetty is a wall that a jump climbs; the reeds stand in the way; slippery (the stopping distance and the
//            drift in a turn measured against the snow); the ice drawn and the water hidden; steps of ice; no ducks; the
//            animals stay off it
//   snow     the path, the deck and the jetty under snow are no flat white any more (spread of the pixels in views of
//            them, against 0.7's even cover) and keep their place in the shade and at night
//   programs no shader program compiled after the start (the seasons, prints, the ice, birds and animals)
//   perf     the tracks' CPU time with every budget full, the GPU time of a view full of prints with them and without
//            (timer queries, 2560 × 1440, judged only on a graphics card of its own)
//   shots    pictures from the terrace, the path, the knoll, the jetty and the ice, by day, at dusk, at night and in
//            snowfall
// WT_PARTS=prints,animals,ice,snow,programs,perf,shots picks parts (default: all but shots; WT_SHOTS=1 adds them).
// Library: a small test library (testbooks2). Prints PASS/FAIL lines and one summary line. Muted and hidden.
//   node build/screenshot.js winter-check
module.exports = async ({ app, page, shot, sleep }) => {
  const only = (process.env.WT_PARTS || '').split(',').filter(Boolean);
  const want = (part) => (!only.length && part !== 'shots') || only.includes(part) || (part === 'shots' && process.env.WT_SHOTS);
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
  // the shelves follow the scan some seconds later: their programs are not the garden's
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
  const busyNow = () => { try { return parseFloat(require('child_process').execSync('nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits', { timeout: 5000 }).toString()); } catch { return NaN; } };
  const busy = async () => { const v = []; for (let i = 0; i < 7; i++) { const b = busyNow(); if (!Number.isNaN(b)) v.push(b); await sleep(250); } v.sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; };

  // ---- helpers in the page -----------------------------------------------------------------------------------------
  await page.evaluate(() => {
    const w = window.__app.world, g = w.env.garden, p = w.player;
    const W = window.__wc = { w, g, p, T: w.tracks, I: w.winter.ice };
    W.set = (patch) => {
      w.applySettings({ ...w.settings, timeMode: 'fixed', graphics: { ...w.settings.graphics, quality: 'high', bloom: true, shadows: true, ssao: true, resolutionScale: 1, fov: 72 }, ...patch });
      if (patch.fixedHour != null) w.env.set({ hour: patch.fixedHour });
      g.seasons.settle(); g.lilies.settle(); w.fireBowl.settle();
      w.winter.update(0); w.winter.settle(); w.tracks.update(0);
    };
    W.pose = (x, z, yaw = 0, pitch = 0) => { if (w.actions.seatedId) w.actions.leaveSeat(); p.transition = null; p.keys.clear(); p.setPose(x, z, yaw, pitch); };
    // walking without drawing: the keys held for `seconds`, the world's winter running along (60 steps a second)
    W.walk = (keys, seconds, dt = 1 / 60) => { p.keys.clear(); for (const k of keys) p.keys.add(k); for (let t = 0; t < seconds; t += dt) { p.update(dt); w.winter.update(dt); } p.keys.clear(); };
    W.until = (fn, max = 12, dt = 1 / 60) => { let t = 0; for (; t < max && !fn(); t += dt) { p.update(dt); w.winter.update(dt); } return t; };
    W.speed = () => Math.hypot(p.velocity.x, p.velocity.z);
    // forward in the world for a yaw of the player (player.js)
    W.yawTo = (dx, dz) => Math.atan2(-dx, -dz);
    W.draw = () => { if (w.bloom.enabled || w.ao.enabled || w.godrays.wanted) w.composer.render(0); else w.renderer.render(w.scene, w.camera); };
    // the scene alone into a float target of its own (no bloom, AO or rays; garden-check), read back as 0 … 255 of the
    // square root of the linear value
    const RT = w.composer.renderTarget1.constructor, FLOAT = 1015;
    W.raw = () => {
      const r = w.renderer, Wd = Math.round(r.domElement.width / 2), Hd = Math.round(r.domElement.height / 2);
      if (!W.rt || W.rt.width !== Wd || W.rt.height !== Hd) { W.rt?.dispose(); W.rt = new RT(Wd, Hd, { type: FLOAT, depthBuffer: true }); }
      const prev = r.getRenderTarget();
      r.setRenderTarget(W.rt); r.clear(); r.render(w.scene, w.camera); r.setRenderTarget(prev);
      const Wt = W.rt.width, Ht = W.rt.height, f = new Float32Array(Wt * Ht * 4), px = new Float32Array(Wt * Ht);
      r.readRenderTargetPixels(W.rt, 0, 0, Wt, Ht, f);
      for (let i = 0; i < px.length; i++) px[i] = Math.sqrt(Math.max(0, 0.2126 * f[i * 4] + 0.7152 * f[i * 4 + 1] + 0.0722 * f[i * 4 + 2])) * 255;
      return { px, W: Wt, H: Ht };
    };
    W.look = (from, at) => { w.camera.position.set(...from); w.camera.up.set(0, 1, 0); w.camera.lookAt(...at); w.camera.updateMatrixWorld(); w.camera.updateProjectionMatrix(); };
    // where a world point lands in the raw picture
    W.screen = (x, y, z, img) => { const v = w.camera.position.clone().set(x, y, z).project(w.camera); return [Math.round((v.x * 0.5 + 0.5) * img.W), Math.round((v.y * 0.5 + 0.5) * img.H)]; };
    W.programs = () => w.renderer.info.programs.length;
    // the tracks' time uniform (x clock, y life, z fade, w on), the same object in every snowy material
    W.trk = () => w.renderer.properties.get(g.group.getObjectByName('ground').material).uniforms.uTrkTime.value;
    // a few frames for the shadow maps and the uploads (the loop is stopped)
    W.settle = (n = 6) => { for (let i = 0; i < n; i++) w.frame(); };
  });
  const programs0 = await page.evaluate(() => { const W = window.__wc; W.set({ season: 'summer', weather: 'clear', fixedHour: 14 }); W.settle(8); W.known = new Set(W.w.renderer.info.programs); return W.programs(); });

  // ================================================================ 1. the player's prints ===========================================
  if (want('prints')) {
    const r = await page.evaluate(() => {
      const W = window.__wc, { w, p, T } = W, out = {};
      W.set({ season: 'winter', weather: 'clear', fixedHour: 14 });
      T.clear(); T.oldLaid = true;
      // walking north over the lawn for 6 s
      W.pose(5, 16, Math.PI, 0); const steps0 = T.steps;
      W.walk(['KeyW'], 6);
      const walk = T.list().filter((q) => q.kind === 'boot');
      out.walk = walk.length; out.steps = T.steps - steps0;
      const d = []; for (let i = 1; i < walk.length; i++) d.push(Math.hypot(walk[i].x - walk[i - 1].x, walk[i].z - walk[i - 1].z));
      const mid = d.slice(2).sort((a, b) => a - b)[Math.floor((d.length - 2) / 2)] || 0;
      out.spacing = +mid.toFixed(3);
      out.alternate = walk.every((q, i) => i === 0 || q.side === -walk[i - 1].side);
      // the right foot right of the way (east of the line when walking north: larger x), the left one left
      const xs = walk.slice(2).map((q) => q.x - 5);
      out.lateral = walk.slice(2).every((q, i) => (q.side > 0 ? xs[i] > 0.04 : xs[i] < -0.04));
      out.angle = +Math.max(...walk.slice(2).map((q) => Math.abs(Math.atan2(Math.sin(q.angle - Math.PI / 2), Math.cos(q.angle - Math.PI / 2))))).toFixed(3);
      out.ground = +Math.max(...walk.map((q) => Math.abs(q.y - W.g.outdoor.terrainHeight(q.x, q.z)))).toFixed(4);
      out.mesh = +Math.max(...walk.map((q) => Math.abs(q.y - W.g.heightField.meshAt(q.x, q.z)))).toFixed(4);
      // running
      T.clear(); T.oldLaid = true;
      W.pose(5, 16, Math.PI, 0); W.walk(['KeyW', 'ShiftLeft'], 6);
      const run = T.list();
      out.runKinds = [...new Set(run.map((q) => q.kind))];
      const dr = []; for (let i = 1; i < run.length; i++) dr.push(Math.hypot(run[i].x - run[i - 1].x, run[i].z - run[i - 1].z));
      out.runSpacing = +(dr.slice(2).sort((a, b) => a - b)[Math.floor((dr.length - 2) / 2)] || 0).toFixed(3);
      // a jump: a scuffed mark where it lands
      T.clear(); T.oldLaid = true;
      W.pose(5, 16, Math.PI, 0); p.jump(); W.until(() => !p.air, 3);
      const land = T.list().filter((q) => q.kind === 'land');
      out.land = land.length ? { n: land.length, d: +Math.hypot(land[0].x - p.position.x, land[0].z - p.position.z).toFixed(3) } : null;
      // indoors: none; on the deck under the eaves: none (too little snow there); without snow: none
      T.clear(); T.oldLaid = true;
      W.pose(2, -1, Math.PI, 0); W.walk(['KeyW'], 2.5); out.indoors = T.list().length;
      W.pose(-3, 6.05, Math.PI / 2, 0); W.walk(['KeyW'], 2); out.eaves = T.list().length;
      W.set({ season: 'summer', weather: 'clear', fixedHour: 14 });
      W.pose(5, 16, Math.PI, 0); W.walk(['KeyW'], 3); out.summer = T.list().length;
      // the snow goes: the prints with it, at once
      W.set({ season: 'winter', weather: 'clear', fixedHour: 14 }); T.clear(); T.oldLaid = true;
      W.pose(5, 16, Math.PI, 0); W.walk(['KeyW'], 3); const before = T.list().length;
      W.set({ season: 'spring', weather: 'clear', fixedHour: 14 }); w.winter.update(0.016);
      out.gone = { before, after: T.list().length, on: T.info().count };
      // the old prints of earlier walkers: down the path, over the deck, on the jetty, up the trail; none in summer
      W.set({ season: 'winter', weather: 'clear', fixedHour: 14 }); T.clear(); T.update(0.016);
      const old = T.info().by.old || 0, onPath = T.prints.filter((q) => q && q.old && W.g.outdoor.pathDist(q.x, q.z) < 0.5).length;
      W.set({ season: 'summer', weather: 'clear', fixedHour: 14 }); T.update(0.016);
      out.old = { winter: old, onPath, summer: T.info().by.old || 0 };
      W.set({ season: 'winter', weather: 'clear', fixedHour: 14 });
      return out;
    });
    console.log('PRINTS ' + JSON.stringify(r));
    const stepLen = 2.4 / (1 + 0.38 * 2.4);
    check('walking on snow leaves a print at every step', r.walk >= 8 && r.walk === r.steps, { prints: r.walk, steps: r.steps });
    check('the prints lie a step apart, left and right in turn, each foot on its side of the way', Math.abs(r.spacing - Math.hypot(stepLen, 0.18)) < 0.12 && r.alternate && r.lateral, { spacing: r.spacing, step: +stepLen.toFixed(3), alternate: r.alternate, lateral: r.lateral });
    check('the prints point along the way (toes turned out a little)', r.angle < 0.2, r.angle);
    check('the prints lie on the ground: at the terrain\'s height, within a few millimetres of the drawn ground', r.ground < 0.001 && r.mesh < 0.01, { terrain: r.ground, mesh: r.mesh });
    check('running: the long print with the toes dug in, further apart', r.runKinds.length === 1 && r.runKinds[0] === 'run' && r.runSpacing > r.spacing * 1.15, { kinds: r.runKinds, run: r.runSpacing, walk: r.spacing });
    check('a jump leaves a scuffed mark where it lands', r.land && r.land.n === 1 && r.land.d < 0.05, r.land);
    check('no prints indoors, none under the eaves of the deck, none without snow', r.indoors === 0 && r.eaves === 0 && r.summer === 0, { indoors: r.indoors, eaves: r.eaves, summer: r.summer });
    check('when the snow goes the prints go with it at once', r.gone.before > 3 && r.gone.after === 0 && r.gone.on === 0, r.gone);
    check('the old prints of earlier walkers lie down the path and on the deck and jetty in winter, none in summer', r.old.winter > 120 && r.old.onPath > 60 && r.old.summer === 0, r.old);

    // fading: the wear clock; within the life they are there, after it gone; snowfall wears them four times faster
    const f = await page.evaluate(() => {
      const W = window.__wc, { T } = W, out = {}, life = T.info().life;
      W.set({ season: 'winter', weather: 'clear', fixedHour: 14 }); T.clear(); T.oldLaid = true;
      W.pose(5, 16, Math.PI, 0); W.walk(['KeyW'], 2);
      const n0 = T.list().length, wear = (s, dt = 0.25) => { for (let t = 0; t < s; t += dt) T.update(dt); };
      wear(life * 0.95); out.before = T.list().length;
      wear(life * 0.1); wear(6, 0.05); out.after = T.list().length;
      out.n0 = n0; out.life = life;
      // in snowfall
      W.set({ season: 'winter', weather: 'snow', fixedHour: 14 }); T.clear(); T.oldLaid = true;
      W.pose(5, 16, Math.PI, 0); W.walk(['KeyW'], 2);
      const t0 = T.clock; let real = 0;
      while (T.list().length && real < life) { T.update(0.25); real += 0.25; }
      out.snowReal = real; out.snowWear = +(T.clock - t0).toFixed(1);
      return out;
    });
    check(`the prints wear away within their life (${f.life} s, 8 minutes in dry weather) and are gone after it`, f.n0 > 2 && f.before === f.n0 && f.after === 0, f);
    check('falling snow covers them sooner (a quarter of the time)', f.snowReal > 0 && f.snowReal <= f.life * 0.27, { seconds: f.snowReal, life: f.life });

    // the budget: the oldest gives way; prints on the ice are faint
    const b = await page.evaluate(() => {
      const W = window.__wc, { T } = W, out = {};
      W.set({ season: 'winter', weather: 'clear', fixedHour: 14 }); T.clear(); T.oldLaid = true;
      const first = T.stamp('boot', 0.123, 20.456, 0); let last = -1;
      for (let i = 0; i < 700; i++) last = T.stamp('boot', -6 + (i % 30) * 0.4, 16 + Math.floor(i / 30) * 0.5, 0);
      out.n = T.list('boot').length; out.reused = T.list('boot').every((q) => !(q.x === 0.123 && q.z === 20.456)); out.first = first; out.last = last; out.pool = T.info().pools.player;
      // on the ice (the middle of the lake): faint
      const ice = T.stamp('boot', -36, 47, 0, { strength: 0.5 }), lawn = T.list('boot').find((q) => q.i === last);
      out.ice = ice >= 0 ? T.list('boot').find((q) => q.i === ice)?.strength : null; out.lawn = lawn?.strength;
      return out;
    });
    check('a full budget takes the oldest print first (the player has 512)', b.n === b.pool && b.reused && b.first >= 0, b);
    check('on the frozen lake the prints are faint (thin snow on the ice)', b.ice != null && b.ice <= 0.5 && b.lawn >= 0.95, { ice: b.ice, lawn: b.lawn });

    // drawn: a shaded hollow (darker and lighter than the snow), not a black stamp, by day, at dusk and by moonlight
    const look = await page.evaluate(() => {
      const W = window.__wc, { w, T } = W, out = {};
      for (const [name, hour] of [['day', 15.5], ['dusk', 19.6], ['night', 23]]) {
        W.set({ season: 'winter', weather: 'clear', fixedHour: hour }); T.clear(); T.oldLaid = true;
        const x = 4, z = 18, y = W.g.outdoor.terrainHeight(x, z);
        T.stamp('boot', x, z, 0.4, { side: 1, y });
        W.pose(x, z - 3, 0, 0); W.settle(4);
        W.look([x - 0.2, y + 1.25, z - 1.05], [x, y, z]);
        const a = W.raw(), on = T.info().count;
        // the same picture with the prints off (the uniform every snowy surface shares)
        const u = W.trk(); u.w = 0;
        const c = W.raw(); u.w = 1;
        // in the print (a box round it on the screen) and round it
        const [sx, sy] = W.screen(x, y, z, a), R = Math.round(a.H * 0.09);
        let dark = 0, light = 0, n = 0, sumA = 0, sumC = 0, outside = 0;
        for (let j = -R * 2; j <= R * 2; j++) for (let i = -R * 2; i <= R * 2; i++) {
          const X = sx + i, Y = sy + j; if (X < 0 || Y < 0 || X >= a.W || Y >= a.H) continue;
          const k = Y * a.W + X, d = a.px[k] - c.px[k];
          if (Math.abs(i) <= R && Math.abs(j) <= R) { n++; sumA += a.px[k]; sumC += c.px[k]; dark = Math.max(dark, -d); light = Math.max(light, d); }
          else if (Math.abs(d) > 6) outside++;
        }
        out[name] = { dark: +dark.toFixed(1), light: +light.toFixed(1), ratio: +(sumA / Math.max(1, sumC)).toFixed(3), snow: +(sumC / Math.max(1, n)).toFixed(1), outside, on };
      }
      return out;
    });
    console.log('LOOK ' + JSON.stringify(look));
    check('a print is a shaded hollow by day: parts darker and parts lighter than the snow round it, never a black stamp', look.day.dark > 8 && look.day.light > 3 && look.day.ratio > 0.7 && look.day.ratio < 1.05, look.day);
    check('the prints show at dusk and by moonlight as well, and nothing beside them changes (no floating, no fighting)', look.dusk.dark > 4 && look.night.dark > 2 && look.dusk.ratio > 0.6 && look.night.ratio > 0.6 && look.day.outside + look.dusk.outside + look.night.outside < 40, { dusk: look.dusk, night: look.night });
  }

  // ================================================================ 2. the animals' tracks ===========================================
  if (want('animals')) {
    const r = await page.evaluate(() => {
      const W = window.__wc, { w, T } = W, A = w.wildlife, out = {};
      W.set({ season: 'winter', weather: 'snow', fixedHour: 13 }); T.clear(); T.oldLaid = true;
      W.pose(0, -2, Math.PI, 0);
      A.clear();
      // a roe deer walks over the lawn, then a fox
      const deer = A.spawn('roe', { x: -6, z: 22, yaw: 0.5 })[0];
      deer.setState('walk'); deer.go(A.field.path(deer.pos, { x: -2, z: 29 }), deer.walk);
      for (let i = 0; i < 160; i++) A.update(0.05);
      const hoof = T.list('hoof');
      out.hoof = hoof.length; out.hoofGround = hoof.length ? +Math.max(...hoof.map((q) => Math.abs(q.y - W.g.outdoor.terrainHeight(q.x, q.z)))).toFixed(4) : null;
      A.clear();
      const fox = A.spawn('fox', { x: 6, z: 24, yaw: 0.2 })[0];
      fox.setState('walk'); fox.go(A.field.path(fox.pos, { x: 9, z: 32 }), fox.walk);
      for (let i = 0; i < 160; i++) A.update(0.05);
      out.paw = T.list('paw').length;
      out.oldTracks = A.prints.reduce((s, m) => s + m.count, 0);
      A.clear();
      // birds on the lawn: a blackbird hops (pairs side by side), a crow walks (one foot after the other)
      const F = w.fauna, B = F.birds; F.prepareAll(); B.clear(); B.manual = true;
      const V = w.camera.position.constructor, P = B.places;
      const bb = B.spawn('blackbirdM', { ground: new V(3, P.height(3, 14), 14), tame: true, stay: 1e9 });
      for (let i = 0; i < 400 && T.list('bird').length < 8; i++) F.update(0.05);
      const pairs = T.list('bird');
      out.bird = pairs.length;
      // pairs: two prints stamped together lie side by side (across the way), a hand's breadth apart at most
      const pr = []; for (let i = 0; i + 1 < pairs.length; i += 2) pr.push(+Math.hypot(pairs[i].x - pairs[i + 1].x, pairs[i].z - pairs[i + 1].z).toFixed(3));
      out.pair = pr;
      B.clear(); T.clear(); T.oldLaid = true;
      const crow = B.spawn('crow', { ground: new V(6, P.height(6, 24), 24), tame: true, stay: 1e9 });
      for (let i = 0; i < 600 && T.list('bird').length < 6; i++) F.update(0.05);
      const cr = T.list('bird');
      out.crow = cr.length; out.crowAlt = cr.every((q, i) => i === 0 || Math.abs(Math.atan2(Math.sin(q.angle - cr[i - 1].angle), Math.cos(q.angle - cr[i - 1].angle))) < 2);
      out.crowSize = cr[0]?.size; out.bbSize = pairs[0]?.size;
      B.clear(); B.manual = false;
      return out;
    });
    console.log('ANIMALS ' + JSON.stringify(r));
    check('a deer walking in the snow leaves hoof prints on the ground (its front feet)', r.hoof >= 6 && r.hoofGround < 0.001, { hoof: r.hoof, ground: r.hoofGround });
    check('a fox leaves paw prints; the old black stamps of 0.7 are not drawn any more', r.paw >= 6 && r.oldTracks === 0, { paw: r.paw, old: r.oldTracks });
    check('a blackbird hopping on the lawn: pairs of small three-toed prints side by side', r.bird >= 4 && r.pair.length > 0 && r.pair.every((d) => d > 0.005 && d < 0.06), { prints: r.bird, pairs: r.pair });
    check('a crow walking: one foot after the other, larger prints than the blackbird\'s', r.crow >= 3 && r.crowSize > r.bbSize, { prints: r.crow, crow: r.crowSize, blackbird: r.bbSize });
  }

  // ================================================================ 3. the frozen lake ===============================================
  if (want('ice')) {
    const r = await page.evaluate(() => {
      const W = window.__wc, { w, p, I, g } = W, O = g.outdoor, J = O.jetty, out = {};
      // a way from the east shore out onto the lake with no reed in it (the gap nearest to due west)
      const clump = g.reeds.clumps;
      let from = null, yaw = 0;
      for (let k = 0; k < 90 && !from; k++) for (const s of [1, -1]) {
        const a = s * k * Math.PI / 180, [sx, sz] = O.lake ? [O.lake.x + Math.cos(a) * O.lake.rx * 1.12, O.lake.z + Math.sin(a) * O.lake.rz * 1.12] : [0, 0];
        if (!O.inRegion(sx, sz, 0.4) || O.obstaclesNear(sx, sz, 0.5).length) continue;
        const dx = O.lake.x - sx, dz = O.lake.z - sz, l = Math.hypot(dx, dz);
        const ok = clump.every((c) => { const t = ((c.x - sx) * dx + (c.z - sz) * dz) / l; if (t < 0 || t > 9) return true; const q = Math.abs((c.x - sx) * dz - (c.z - sz) * dx) / l; return q > 1.2; }) && O.stones.every((st) => Math.hypot(st.x - sx, st.z - sz) > 9 || Math.abs((st.x - sx) * dz - (st.z - sz) * dx) / l > 1.2);
        if (ok) { from = [sx, sz]; yaw = W.yawTo(dx / l, dz / l); break; }
      }
      out.from = from && from.map((v) => +v.toFixed(2));
      const onto = (season) => {
        W.set({ season, weather: 'clear', fixedHour: 14 });
        W.pose(from[0], from[1], yaw, 0); W.walk(['KeyW'], 5);
        return { x: +p.position.x.toFixed(2), z: +p.position.z.toFixed(2), ground: +p.ground.toFixed(3), over: O.isWater(p.position.x, p.position.z), lake: +O.lakeDist(p.position.x, p.position.z).toFixed(3) };
      };
      out.summer = onto('summer'); out.winter = onto('winter');
      // off the end of the jetty
      const end = (season) => {
        W.set({ season, weather: 'clear', fixedHour: 14 });
        const [x, z] = J.at(J.len - 0.6, -1.1); W.pose(x, z, W.yawTo(J.dir[0], J.dir[1]), 0); W.walk(['KeyW'], 3);
        W.until(() => !p.air, 3);
        const rx = p.position.x - J.root[0], rz = p.position.z - J.root[1];
        return { along: +(rx * J.dir[0] + rz * J.dir[1]).toFixed(2), ground: +p.ground.toFixed(3) };
      };
      out.endSummer = end('summer'); out.endWinter = end('winter');
      // from the ice the jetty is a wall; a jump with W held climbs it
      W.set({ season: 'winter', weather: 'clear', fixedHour: 14 });
      const [bx, bz] = J.at(6, 1.9); W.pose(bx, bz, W.yawTo(-J.side[0], -J.side[1]), 0); W.walk(['KeyW'], 2);
      const across = () => { const rx = p.position.x - J.root[0], rz = p.position.z - J.root[1]; return +(rx * J.side[0] + rz * J.side[1]).toFixed(3); };
      out.wall = { across: across(), ground: +p.ground.toFixed(3), half: J.width / 2 };
      // (W held until the feet are on the boards: held longer you walk on and off the other side)
      p.keys.add('KeyW'); p.jump(); W.until(() => !p.air, 3); p.keys.clear(); W.walk([], 0.5);
      out.climb = { across: across(), ground: +p.ground.toFixed(3), top: +J.top.toFixed(3) };
      // a reed frozen in the ice stands in the way
      const reed = clump.find((c) => O.terrainHeight(c.x, c.z) < O.waterY - 0.25 && I.free(c.x + 1.2, c.z, 0.33, O.waterY));
      if (reed) {
        W.pose(reed.x + 1.2, reed.z, W.yawTo(-1, 0), 0); W.walk(['KeyW'], 2);
        out.reed = +(Math.hypot(p.position.x - reed.x, p.position.z - reed.z)).toFixed(3);
      }
      // slippery: the distance to a stop and the drift in a turn, on the snow of the lawn and on the ice
      const glide = (x, z) => {
        W.pose(x, z, W.yawTo(-1, 0), 0); W.walk(['KeyW'], 3);
        const v0 = W.speed(), x0 = p.position.x, z0 = p.position.z;
        const t = W.until(() => W.speed() < 0.02, 8);
        const stop = Math.hypot(p.position.x - x0, p.position.z - z0);
        // the turn: walking west at full speed, then the view turned to the north
        W.pose(x, z, W.yawTo(-1, 0), 0); W.walk(['KeyW'], 3);
        p.yaw = W.yawTo(0, 1); W.walk(['KeyW'], 0.35);
        const drift = Math.abs(Math.atan2(p.velocity.x, p.velocity.z));   // the angle between the way and north
        return { v0: +v0.toFixed(2), stop: +stop.toFixed(3), t: +t.toFixed(2), drift: +drift.toFixed(3), grip: +p.gripAt(x, z, p.ground).toFixed(2) };
      };
      out.snow = glide(9, 30); out.ice = glide(-30, 47.5);
      // no jumping through the ice: a jump out on the lake comes down on it
      W.set({ season: 'winter', weather: 'clear', fixedHour: 14 });
      W.pose(-30, 47.5, 0, 0); const j0 = p.jump(); let top = 0;
      W.until(() => { top = Math.max(top, p.air ? p.air.y : 0); return !p.air; }, 3);
      out.jump = { jumped: j0, top: +top.toFixed(3), ground: +p.ground.toFixed(3), eye: +(p.position.y - p.ground).toFixed(3) };
      // the winter ends while you stand on the ice: back on the shore, not in the water
      W.pose(-30, 47.5, 0, 0); W.set({ season: 'spring', weather: 'clear', fixedHour: 14 }); w.winter.update(0.016);
      out.ashore = { inside: O.inRegion(p.position.x, p.position.z), ground: +p.ground.toFixed(3), water: O.isWater(p.position.x, p.position.z) };
      // the ice drawn, the water hidden; in summer the other way round; the koi deep, no frogs; animals stay off
      W.set({ season: 'winter', weather: 'clear', fixedHour: 14 }); w.winter.update(0.016);
      out.shownW = { ice: I.mesh.visible, water: g.water.mesh.visible, walkable: I.walkable, lilies: +g.lilies.group.position.y.toFixed(3) };
      out.animals = w.wildlife.obstacleAt(-36, 47) && w.wildlife.obstacleAt(-25, 50);
      W.set({ season: 'summer', weather: 'clear', fixedHour: 14 }); w.winter.update(0.016);
      out.shownS = { ice: I.mesh.visible, water: g.water.mesh.visible, walkable: I.walkable };
      // a snowfall in another season freezes the lake thinly: not to walk on
      W.set({ season: 'autumn', weather: 'snow', fixedHour: 14 }); w.winter.update(0.016);
      out.autumnSnow = { walkable: I.walkable, frozen: g.water.uniforms.uFrozen.value };
      return out;
    });
    console.log('ICE ' + JSON.stringify(r));
    check('in winter you walk from the shore out onto the lake, at the height of its ice', r.winter.over && r.winter.lake < 0.95 && Math.abs(r.winter.ground - (-0.6)) < 0.005, { from: r.from, winter: r.winter });
    check('in summer the shore holds you as before', !r.summer.over && r.summer.lake > 0.97, r.summer);
    check('in winter you step off the end of the jetty down onto the ice; in summer its end holds you', r.endWinter.along > 10.6 && Math.abs(r.endWinter.ground + 0.6) < 0.005 && r.endSummer.along <= 10.55 && r.endSummer.ground > -0.3, { winter: r.endWinter, summer: r.endSummer });
    check('from the ice the jetty is a wall, and a jump climbs onto its boards', r.wall.across > r.wall.half + 0.25 && Math.abs(r.wall.ground + 0.6) < 0.005 && Math.abs(r.climb.ground - r.climb.top) < 0.005 && Math.abs(r.climb.across) < r.wall.half, { wall: r.wall, climb: r.climb });
    check('the reeds frozen in the ice stand in the way', r.reed == null || r.reed > 0.5, r.reed);
    check('on the ice you slide: a longer way to a stop and more drift in a turn than on the snow', r.ice.stop > r.snow.stop * 2.5 && r.ice.drift > r.snow.drift * 1.6 && r.ice.grip < 0.6 && r.snow.grip === 1, { snow: r.snow, ice: r.ice });
    check('the ice is drawn in winter and the water hidden under it (the lily pads frozen in below); in summer the water again', r.shownW.ice && !r.shownW.water && r.shownW.walkable && r.shownW.lilies < -0.05 && !r.shownS.ice && r.shownS.water && !r.shownS.walkable, { winter: r.shownW, summer: r.shownS });
    check('the animals keep off the ice; a snowfall in autumn freezes it thinly, not to walk on', r.animals && !r.autumnSnow.walkable, { animals: r.animals, autumn: r.autumnSnow });
    check('no jumping through the ice: a jump on the lake lands on it again', r.jump.jumped && r.jump.top > 0.5 && Math.abs(r.jump.ground + 0.6) < 0.005, r.jump);
    check('when the winter ends while you stand on the lake you are put back on firm ground (the shore or the jetty)', r.ashore.inside && r.ashore.ground > -0.59, r.ashore);

    // the steps sound of ice; no ducks on it
    const s = await page.evaluate(async () => {
      const W = window.__wc, { w, p } = W, audio = window.__app.ctx.audio, sc = audio.scape, out = {};
      W.set({ season: 'winter', weather: 'clear', fixedHour: 9 });
      W.pose(-30, 47.5, 0, 0); p.update(0.001);
      out.surface = sc.stepInfo().surface;
      W.pose(5, 20, 0, 0); p.update(0.001); out.lawn = sc.stepInfo().surface;
      sc.update(); out.ducks = (sc.state.rates.ducks || 0) + (sc.state.rates.moorhens || 0); out.frozen = sc.state.conditions.frozen;
      const metr = (d, sr) => {
        let tot = 0, peak = 0, nan = 0; for (const x of d) { if (!Number.isFinite(x)) { nan++; continue; } tot += x * x; peak = Math.max(peak, Math.abs(x)); }
        let c = 0, t05 = null, t95 = null; for (let i = 0; i < d.length; i++) { c += d[i] * d[i]; if (t05 == null && c >= tot * 0.05) t05 = i; if (t95 == null && c >= tot * 0.95) { t95 = i; break; } }
        // the share of the energy above 2 kHz (a crisp sound) from a first difference (a rough high pass)
        let hi = 0; for (let i = 1; i < d.length; i++) hi += (d[i] - d[i - 1]) ** 2;
        return { nan, peak: +peak.toFixed(3), span: Math.round((t95 - t05) / sr * 1000), bright: +(hi / (tot || 1)).toFixed(3) };
      };
      for (const surface of ['ice', 'snow', 'grass']) {
        const d = await audio.renderOffline('sfx', 'footstep', 0.7, { sampleRate: 48000, params: { surface, speed: 2.4, seed: 11, dry: true } });
        out[surface] = metr(d, 48000);
      }
      return out;
    });
    console.log('ICE-SOUND ' + JSON.stringify(s));
    check('on the ice the steps are steps on ice (crisper than on snow), on the lawn steps in snow', s.surface === 'ice' && s.lawn === 'snow' && !s.ice.nan && s.ice.peak < 0.9 && s.ice.span >= 75 && s.ice.span <= 230 && s.ice.bright > s.snow.bright * 0.8, s);
    check('no ducks or moorhens on the frozen lake', s.frozen && s.ducks === 0, { frozen: s.frozen, ducks: s.ducks });
  }

  // ================================================================ 4. snow on the path, the deck and the jetty =======================
  if (want('snow')) {
    const r = await page.evaluate(() => {
      const W = window.__wc, { w, g } = W, out = {}, J = g.outdoor.jetty;
      // (the jetty from where it leaves the shore, along its boards)
      const [j0x, j0z] = J.at(0.6, 0), [j1x, j1z] = J.at(7, 0);
      const views = { path: [[0.2, 1.4, 11.2], [-1.2, -0.1, 16.5]], deck: [[1.6, 1.5, 6.4], [1.0, 0.0, 8.6]], jetty: [[j0x, J.top + 1.66, j0z], [j1x, J.top, j1z]] };
      const byStyle = (v) => { let m = null; g.group.traverse((o) => { if (!m && o.isMesh && o.material?.userData?.snowStyle?.value === v) m = o.material; }); return m; };
      const mats = { path: byStyle(1), deck: byStyle(2), jetty: byStyle(3) }, lawn = g.group.getObjectByName('ground').material;
      // a picture of one material alone; its detail: the mean difference of a pixel from the mean of its 5 × 5 neighbours
      // (the light over the whole surface does not count, the snow's own texture does)
      const alone = (m) => { const hidden = []; w.scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine) && o.visible && o.material !== m) { o.visible = false; hidden.push(o); } }); const img = W.raw(); for (const o of hidden) o.visible = true; return img; };
      const detail = (img) => {
        const { px, W: Wd, H } = img; let s = 0, n = 0;
        for (let y = 3; y < H - 3; y += 2) for (let x = 3; x < Wd - 3; x += 2) {
          const k = y * Wd + x; if (px[k] < 15) continue;
          let m = 0, c = 0; for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { const v = px[k + j * Wd + i]; if (v >= 15) { m += v; c++; } }
          if (c < 20) continue; s += Math.abs(px[k] - m / c); n++;
        }
        return n ? +(s / n).toFixed(2) : null;
      };
      const mean = (img) => { let s = 0, n = 0; for (const v of img.px) if (v >= 15) { s += v; n++; } return n ? s / n : 0; };
      for (const [hour, tag] of [[14, 'day'], [23, 'night']]) {
        W.set({ season: 'winter', weather: 'clear', fixedHour: hour }); W.settle(4);
        for (const [name, [from, at]] of Object.entries(views)) {
          const m = mats[name]; if (!m) { out[name + '-' + tag] = null; continue; }
          W.look(from, at);
          const now = alone(m), st = m.userData.snowStyle, was = st.value; st.value = 0;
          const old = alone(m); st.value = was;
          out[name + '-' + tag] = { now: detail(now), old: detail(old), mean: +mean(now).toFixed(1) };
          // the jetty by day: the snow on the ends of its boards against the middle (the median of each, board by board)
          if (name === 'jetty' && tag === 'day') {
            const ratio = (img) => {
              const ends = [], mids = [];
              for (let a = 0.08 + 0.152 * 7; a < 6.4; a += 0.152) for (const [c, list] of [[0, mids], [0.835, ends], [-0.835, ends]]) {
                const [x, z] = J.at(a, c), [sx, sy] = W.screen(x, J.top, z, img);
                if (sx >= 0 && sy >= 0 && sx < img.W && sy < img.H) list.push(img.px[sy * img.W + sx]);
              }
              const med = (v) => v.sort((p, q) => p - q)[v.length >> 1] || 0;
              return +(med(ends) / Math.max(1, med(mids))).toFixed(3);
            };
            out.jettyEnds = { now: ratio(now), old: ratio(old) };
          }
          // the path and the lawn beside it in the same picture: they belong together
          if (name === 'path') out['lawn-' + tag] = +mean(alone(lawn)).toFixed(1);
        }
      }
      return out;
    });
    console.log('SNOW ' + JSON.stringify(r));
    for (const name of ['path', 'deck']) {
      const d = r[name + '-day'], n = r[name + '-night'];
      check(`the snow on the ${name} is no flat white any more: it has a texture of its own by day and at night (against 0.7's even cover)`, d && n && d.now > d.old * 1.4 && n.now > n.old * 1.2, { day: d, night: n });
    }
    check('on the jetty the boards show at their ends and edges, the snow lies on their middle (0.7: one even white)', r.jettyEnds && r.jettyEnds.now < 0.9 && r.jettyEnds.old > 0.95, r.jettyEnds);
    const k = (t) => r['path-' + t].mean / r['lawn-' + t];
    check('the snow on the path belongs with that on the lawn: about as bright, a little greyer where it is trodden, by day and at night', k('day') > 0.75 && k('day') < 1.08 && k('night') > 0.7 && k('night') < 1.1, { day: +k('day').toFixed(3), night: +k('night').toFixed(3) });
  }

  // ================================================================ 5. no new programs ===============================================
  if (want('programs')) {
    const r = await page.evaluate(() => {
      const W = window.__wc, { w, T, p } = W;
      for (const season of ['winter', 'summer', 'winter']) {
        W.set({ season, weather: season === 'winter' ? 'snow' : 'clear', fixedHour: 14 });
        W.pose(-1, 12, Math.PI, -0.3); T.stamp('boot', -1, 13, 1.6); T.stamp('hoof', -1.4, 13.2, 1.6); T.stamp('bird', -0.6, 13.1, 1.6, { size: 0.03 });
        W.settle(6);
        W.pose(-24.5, 39.2, -2.3, -0.1); W.settle(6);
      }
      const fresh = w.renderer.info.programs.filter((q) => !W.known.has(q)), owners = [];
      w.scene.traverse((o) => { const m = o.material; const pr = m && !Array.isArray(m) && w.renderer.properties.get(m)?.currentProgram; if (pr && fresh.includes(pr)) owners.push(`${o.name || o.type}:${m.type}`); });
      return { n: W.programs(), owners: [...new Set(owners)] };
    });
    check('no shader program compiled after the start (prints, the ice, the seasons)', r.n === programs0, { before: programs0, after: r.n, owners: r.owners });
  }

  // ================================================================ 6. cost ===========================================================
  if (want('perf')) {
    const cpu = await page.evaluate(() => {
      const W = window.__wc, { T } = W;
      W.set({ season: 'winter', weather: 'clear', fixedHour: 14 }); T.clear(); T.update(0.016);
      // every budget full (the player, the animals, the birds; the old prints of earlier walkers lie as well)
      const t0 = performance.now();
      for (let i = 0; i < 512; i++) T.stamp('boot', -8 + (i % 32) * 0.55, 12 + Math.floor(i / 32) * 0.9, 1.57);
      for (let i = 0; i < 256; i++) T.stamp('hoof', -7 + (i % 32) * 0.5, 13 + Math.floor(i / 32) * 1.6, 1.57);
      for (let i = 0; i < 256; i++) T.stamp('bird', -7.5 + (i % 32) * 0.45, 12.5 + Math.floor(i / 32) * 1.2, 1.57, { size: 0.025 });
      const stampMs = (performance.now() - t0) / 1024;
      const n = 2000, t1 = performance.now();
      for (let i = 0; i < n; i++) T.update(1 / 60);
      return { perUpdate: +((performance.now() - t1) / n).toFixed(4), perStamp: +stampMs.toFixed(4), count: T.info().count };
    });
    check('the tracks cost little CPU with every budget full: under 0.2 ms a frame', cpu.perUpdate < 0.2 && cpu.count >= 1024, cpu);
    const others = await busy();
    const gpu = await page.evaluate(async () => {
      const W = window.__wc, { w } = W, gl = w.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      // the drawing buffer at 2560 × 1440 whatever the screen allows (godrays-check; the composer keeps its own ratio)
      const pr = 2560 / innerWidth; w.renderer.setPixelRatio(pr); w.renderer.setSize(innerWidth, innerHeight, false); w.composer.setPixelRatio(pr); w.composer.setSize(innerWidth, innerHeight);
      W.pose(-0.5, 9.8, Math.PI, -0.22); W.settle(10);
      const U = w.renderer.properties.get(W.g.group.getObjectByName('ground').material).uniforms.uTrkTime.value;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const time = async () => {
        if (!ext) { const px = new Uint8Array(4), a = performance.now(); w.frame(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return performance.now() - a; }
        const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); w.frame(); gl.endQuery(ext.TIME_ELAPSED_EXT);
        let tries = 0; while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && tries++ < 300) await wait(2);
        const v = gl.getParameter(ext.GPU_DISJOINT_EXT) ? null : gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(q); return v;
      };
      const on = [], off = [];
      for (let i = 0; i < 160; i++) {
        const show = i % 2 === 0; U.w = show ? 1 : 0;
        const t = await time(); if (t != null && i >= 10) (show ? on : off).push(t);
      }
      U.w = 1;
      const med = (a) => { a.sort((x, y) => x - y); return +a[Math.floor(a.length / 2)].toFixed(3); };
      return { on: med(on), off: med(off), timer: !!ext, size: [gl.drawingBufferWidth, gl.drawingBufferHeight] };
    });
    console.log('PERF ' + JSON.stringify({ cpu, gpu, others }));
    const budget = 'a view full of prints costs the graphics card little (median frame with the prints within 0.5 ms of the same frame without)';
    if (others !== null && others <= 15) check(budget, gpu.on - gpu.off < 0.5, gpu);
    else skip(budget, others === null ? 'no reading of the graphics card' : `the graphics card was ${others} % busy with other programs`, gpu);
    await page.evaluate(() => window.__wc.w.resize());
  }

  // ================================================================ 7. pictures =======================================================
  if (want('shots')) {
    // a walk that leaves prints where the views look: over the lawn to the path, down it, out on the jetty, off its end
    // onto the ice; birds and a deer on the lawn
    await page.evaluate(() => {
      const W = window.__wc, { w, T, p } = W;
      W.set({ season: 'winter', weather: 'clear', fixedHour: 14 }); T.clear(); T.update(0.016);
      const go = (x, z) => { const dx = x - p.position.x, dz = z - p.position.z; p.yaw = W.yawTo(dx, dz); const d = Math.hypot(dx, dz); W.walk(['KeyW'], d / 2.4); };
      W.pose(1.5, 8.2, Math.PI, 0);
      for (const [x, z] of [[2.5, 12.5], [0.6, 15.5], [-2.0, 19.5], [-5.5, 23.5], [-9.6, 28.2], [-13.4, 31.2], [-17.2, 34.2]]) go(x, z);
      const J = W.g.outdoor.jetty;
      for (const a of [4, 8, 10.2]) { const [x, z] = J.at(a, 0.2); go(x, z); }
      p.yaw = W.yawTo(J.dir[0], J.dir[1]); W.walk(['KeyW'], 1.2); W.until(() => !p.air, 3);
      go(-30, 42); go(-31, 47); go(-27, 50.5);
      // a deer's track over the lawn, a blackbird on the path
      const A = w.wildlife; A.clear();
      const deer = A.spawn('roe', { x: 7, z: 21, yaw: -0.4 })[0]; deer.setState('walk'); deer.go(A.field.path(deer.pos, { x: 2.0, z: 27.5 }), deer.walk);
      for (let i = 0; i < 200; i++) A.update(0.05);
      A.clear();
      const F = w.fauna, B = F.birds; F.prepareAll(); B.manual = true;
      const V = w.camera.position.constructor, P = B.places;
      B.spawn('blackbirdM', { ground: new V(1.2, P.height(1.2, 13.4), 13.4), tame: true, stay: 1e9 });
      B.spawn('sparrowM', { ground: new V(-0.4, P.height(-0.4, 13.0), 13.0), tame: true, stay: 1e9 });
      for (let i = 0; i < 300; i++) F.update(0.05);
      document.querySelector('#hud')?.style.setProperty('opacity', '0');
    });
    const views = [
      ['terrace', 0.6, 8.4, 2.6, -0.12], ['deck', 1.6, 6.5, 3.05, -0.5], ['deck-house', 2.2, 9.3, 0.15, -0.38], ['path', 0.5, 11.4, 2.75, -0.42],
      ['path-down', -0.6, 15.6, 2.8, -0.95], ['path-far', -3.8, 21.6, 2.4, -0.25],
      ['lawn-prints', 3.6, 11.4, 2.9, -0.55], ['knoll', 14.0, 41.5, 1.65, -0.08], ['jetty', -16.6, 33.2, 2.16, -0.18],
      ['ice', -26.5, 40.5, 1.0, -0.3], ['ice-out', -29.5, 44, 2.2, -0.12], ['shore', -9.5, 45.0, 1.571, -0.12],
    ];
    const conds = [['day', 'clear', 14], ['dusk', 'clear', 19.7], ['night', 'clear', 23], ['snowfall', 'snow', 12]];
    for (const [tag, weather, hour] of conds) {
      for (const [name, x, z, yaw, pitch] of views) {
        await page.evaluate(([x, z, yaw, pitch, weather, hour]) => {
          const W = window.__wc; W.set({ season: 'winter', weather, fixedHour: hour }); W.pose(x, z, yaw, pitch);
          for (let i = 0; i < 40; i++) W.w.updateDoor(0.05);
        }, [x, z, yaw, pitch, weather, hour]);
        for (let i = 0; i < 12; i++) { await page.evaluate(() => window.__wc.w.frame()); await sleep(30); }
        await shot(`wc-${tag}-${name}`);
      }
    }
    await page.evaluate(() => { window.__wc.w.fauna.birds.clear(); window.__wc.w.fauna.birds.manual = false; document.querySelector('#hud')?.style.setProperty('opacity', '1'); });
  }

  check('no renderer error', errors.length === 0, errors.slice(0, 5));
  console.log(`WINTER-SUMMARY ${passes} passed, ${failures} failed, ${skipped} skipped`);
};
