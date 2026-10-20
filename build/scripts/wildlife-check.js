// Wildlife in the garden (wildlife.js, wildlife-models.js, wildlife-views.js): the models are built in small steps, no new
// shader program and no stall when the first animals show up, the frame times with three groups in view, every species
// stands on the ground, a visit only walks open ground (never in a tree, the lake, the house, the feeding station or on
// the terrace) and ends in the wood, the animals look up when the player comes close outside, a deer and a fox trot off
// briskly (never a gallop), and both stop a little way off and watch him (the wolf watches first and walks off, nobody
// reacts to the player behind the glass; flee-check.js follows the flight and the rest of the visit), and how often they
// come
// over simulated hours: 'Oft' (the default) an animal in sight of the house most of the day and at dusk, a new group
// soon after one has gone, several groups at once but each at a place of its own, fewer at night and in bad weather;
// 'Normal' in between; 'Selten' the rare visits of 0.6 (one group at a time, a pause between visits, more at dusk than
// by day or at night, few in a storm). Visits start while the player is in the book room, at its windows. The setting
// switches them off, and no errors. Screenshots of every species near and far, by day and at dusk, through the glass
// front and out of the book room. SHOT_TAG prefixes them (WL_SHOTS=name,… or none); WL_HOURS scales the simulated
// hours of 'Selten' (default 8).
module.exports = async ({ page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || 'wl';
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  // the first library update rebuilds the world or its shelves once more (some ten seconds after entering): wait until
  // nothing has been rebuilt for five seconds
  for (let i = 0, quiet = 0; i < 40 && quiet < 4; i++) {
    const changed = await page.evaluate(() => {
      const w = window.__app.world, key = (w.buildTimes || []).length + ':' + !!w.shelfSteps;
      const same = window.__wlBuild === key && window.__wlShelves === w.shelfSteps;
      window.__wlBuild = key; window.__wlShelves = w.shelfSteps;
      return !same;
    });
    quiet = changed ? 0 : quiet + 1;
    await sleep(1300);
  }
  let failures = 0;
  const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); if (!ok) failures++; };
  const KINDS = ['roe', 'fawn', 'stag', 'fox', 'wolf'];
  const setTime = (hour, weather = 'clear') => page.evaluate(([hour, weather]) => { const w = window.__app.world; w.settings.timeMode = 'fixed'; w.settings.fixedHour = hour; w.settings.weather = weather; w.applySettings(w.settings); }, [hour, weather]);

  // ---------------------------------------------------------------- start-up -----------------------------------------
  await setTime(10);
  const s0 = await page.evaluate(() => {
    const w = window.__app.world, W = w.wildlife;
    w.player.transition = null; w.player.setPose(0.6, 13.5, Math.PI, -0.02);   // on the lawn, looking out over the meadow
    for (let i = 0; i < 8; i++) w.frame();
    return { exists: !!W, prewarm: !!W?.group.getObjectByName('wildlife-prewarm'), animals: W?.beasts.length, wait: Math.round(W?.wait), mode: W?.info().mode, setting: w.settings.wildlifeRate ?? null, programs: w.renderer.info.programs.length };
  });
  check('the wildlife is part of the world, "Oft" by default; nobody is out at the start and the first group waits a few seconds', s0.exists && s0.prewarm && s0.animals === 0 && s0.wait > 3 && s0.mode === 'often', s0);

  // ---------------------------------------------------------------- first appearance, frame times ---------------------
  const stats = (a) => { const s = [...a].sort((x, y) => x - y), q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))] || 0; return { n: s.length, avg: +(s.reduce((x, y) => x + y, 0) / Math.max(1, s.length)).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +q(1).toFixed(2) }; };
  await page.evaluate(() => {
    const w = window.__app.world, W = w.wildlife, P = window.__wlPerf = { frames: [], cpu: [], wl: [], on: true };
    const orig = w.frame.bind(w); w.frame = () => { const a = performance.now(); orig(); P.cpu.push(performance.now() - a); };
    const up = W.update.bind(W); W.update = (dt, posed) => { const a = performance.now(); up(dt, posed); P.wl.push(performance.now() - a); };
    let last = 0; const tick = (t) => { if (last) P.frames.push(t - last); last = t; if (P.on) requestAnimationFrame(tick); };
    requestAnimationFrame(tick); w.start();
  });
  const measure = async (ms) => { await page.evaluate(() => { const P = window.__wlPerf; P.frames.length = 0; P.cpu.length = 0; P.wl.length = 0; }); await sleep(ms); return page.evaluate(() => ({ frames: window.__wlPerf.frames.slice(), cpu: window.__wlPerf.cpu.slice(), wl: window.__wlPerf.wl.slice() })); };
  // the models, the path grid and the places are built while a panel lies over the world (the main menu after the
  // start), out of sight; otherwise bit by bit before the first visit
  await page.evaluate(() => { window.__app.world.wildlife.wait = 1e6; window.__app.openPanel('menu'); });
  let prepFrames = 0, prepSecs = 0;
  for (let i = 0; i < 80; i++) {
    await sleep(250); prepSecs += 0.25;
    const r = await page.evaluate(() => { const W = window.__app.world.wildlife, P = window.__wlPerf, n = P.wl.length; P.wl.length = 0; return { n, ready: W.prepInfo().ready && !W.upload }; });
    prepFrames += r.n;
    if (r.ready) break;
  }
  const prep = await page.evaluate(() => { window.__app.closeAllPanels(); return { ...window.__app.world.wildlife.prepInfo(), background: window.__app.world.background }; });
  check('the path grid, the places and the models are built behind the menu, out of sight, within a few seconds', prep.ready && prep.steps >= 6 && prepSecs < 15, { ...prep, frames: prepFrames, secs: prepSecs });
  // three groups in view of the lawn: a doe with her fawn, a stag, a fox
  const group = (on) => page.evaluate((on) => { const W = window.__app.world.wildlife; W.clear(); if (on) { W.spawn('fawn', { x: 2.5, z: 23.5, yaw: -1.2, hold: true, pose: 'graze' }); W.spawn('stag', { x: -3, z: 30, yaw: 1.4, hold: true, pose: 'walk' }); W.spawn('fox', { x: 7.5, z: 27, yaw: -2.2, hold: true, pose: 'trot' }); } }, on);
  await sleep(1500);
  const before = await measure(3000);
  // the very first animals: right in view (the scheduler lets them come out of the wood)
  const programsBefore = await page.evaluate(() => window.__app.world.renderer.info.programs.length);
  await group(true);
  const first = await measure(1200);
  const programsAfter = await page.evaluate(() => window.__app.world.renderer.info.programs.length);
  const pairs = [];
  for (let i = 0; i < 7; i++) {
    await group(false); await sleep(300); const wo = await measure(2500);
    await group(true); await sleep(300); const wi = await measure(2500);
    pairs.push({ without: stats(wo.frames).avg, with: stats(wi.frames).avg, cpuWithout: stats(wo.cpu).avg, cpuWith: stats(wi.cpu).avg, update: stats(wi.wl).avg, idle: stats(wo.wl).avg });
  }
  const med = (k) => { const v = pairs.map((p) => (typeof k === 'function' ? k(p) : p[k])).sort((x, y) => x - y); return +v[Math.floor(v.length / 2)].toFixed(3); };
  const fa = stats(first.frames), fb = stats(before.frames);
  console.log('PERF ' + JSON.stringify(pairs));
  const s1 = await page.evaluate(() => { const w = window.__app.world; window.__wlPerf.on = false; w.stop(); return { programs: w.renderer.info.programs.length }; });
  check('no new shader program when the first animals appear (prewarmed with the rest of the world)', programsAfter === programsBefore, { before: programsBefore, after: programsAfter, atTheEnd: s1.programs });
  // (other programs on the graphics card cause long frames of their own: the three seconds before are the yardstick)
  check('no stall when they appear (no frame over 34 ms in the first second, or none much longer than in the seconds before)', fa.max < Math.max(34, fb.max * 1.5), { first: fa, before: fb });
  check('the wildlife costs next to nothing while nobody is out and some 0.1 ms per animal in view (four animals)', med('idle') < 0.03 && med('update') < 0.8, { idle: med('idle'), update4: med('update') });
  const dFrame = med((p) => p.with - p.without), dCpu = med((p) => p.cpuWith - p.cpuWithout), base = med('cpuWithout');
  // (four animals: the 0.6 check allowed 1 ms for three)
  check('frame and CPU times with three groups (four animals) in view stay close to those without (median of seven pairs)', dFrame < 1.5 && dCpu < Math.max(1.4, 0.2 * base), { frame: [med('without'), med('with')], cpu: [base, med('cpuWith')], dFrame, dCpu });

  // ---------------------------------------------------------------- the species ---------------------------------------
  const species = await page.evaluate((KINDS) => {
    const w = window.__app.world, W = w.wildlife, out = [], V3 = w.camera.position.constructor;
    for (const kind of KINDS) {
      for (const pose of ['stand', 'graze']) {
        W.clear();
        const a = W.spawn(kind, { x: 6, z: 27, yaw: 0.7, hold: true, pose, mother: false })[0];
        for (let i = 0; i < 40; i++) W.update(0.05);
        const m = a.mesh; m.updateMatrixWorld(true);
        const pos = m.geometry.attributes.position, p = new V3();
        let minY = Infinity;
        for (let i = 0; i < pos.count; i++) { m.getVertexPosition(i, p); p.applyMatrix4(m.matrixWorld); if (p.y < minY) minY = p.y; }
        // the muzzle when grazing: the lowest point in front of the shoulders
        let muzzle = Infinity; const f = new V3(Math.sin(a.yaw), 0, Math.cos(a.yaw));
        for (let i = 0; i < pos.count; i += 3) { m.getVertexPosition(i, p); p.applyMatrix4(m.matrixWorld); const ahead = (p.x - a.pos.x) * f.x + (p.z - a.pos.z) * f.z; if (ahead > a.A.legLen[0] * 0.55 && p.y < muzzle) muzzle = p.y; }
        const ground = W.G.height(a.pos.x, a.pos.z);
        out.push({ kind, pose, verts: pos.count, bones: m.skeleton.bones.length, ground: +ground.toFixed(3), feet: +(minY - ground).toFixed(3), muzzle: +(muzzle - ground).toFixed(3), y: +(m.position.y - ground).toFixed(3) });
      }
    }
    W.clear();
    return out;
  }, KINDS);
  console.log('SPECIES ' + JSON.stringify(species));
  const stand = species.filter((s) => s.pose === 'stand');
  check('every species is built (one skinned mesh each, about 26 bones) and stands with its feet on the ground', stand.length === 5 && stand.every((s) => s.verts > 2000 && s.bones >= 24 && Math.abs(s.feet) < 0.03 && Math.abs(s.y) < 0.002), stand.map((s) => `${s.kind}:${s.feet}`));
  const deerGraze = species.filter((s) => s.pose === 'graze' && ['roe', 'fawn', 'stag'].includes(s.kind));
  check('grazing deer reach the grass with their muzzle (within 0.25 m of the ground)', deerGraze.every((s) => s.muzzle < 0.25 && s.feet > -0.05), deerGraze.map((s) => `${s.kind}:${s.muzzle}`));

  // ---------------------------------------------------------------- a visit -------------------------------------------
  const visit = await page.evaluate(() => {
    const w = window.__app.world, W = w.wildlife;
    W.clear(); W.stageWait = {};
    w.player.transition = null; w.player.setPose(0, -2, Math.PI, 0.05);   // in the hall, looking out through the glass
    w.player.update(0); w.camera.updateMatrixWorld();
    const cam = w.camera;
    const ok = W.start('fawn', 'meadow');
    const v = W.visits[0], hide = v?.entry?.hide;
    const out = { ok, kinds: W.beasts.map((b) => b.kind), start: hide && [+hide.x.toFixed(1), +hide.z.toFixed(1)], startDist: hide && +Math.hypot(hide.x - cam.position.x, hide.z - cam.position.z).toFixed(1), steps: 0, inObstacle: [], offGround: 0, states: new Set(), seen: false, end: null, maxSpeed: 0 };
    // was the start in view of the house? (the module's own windows)
    if (hide) out.startSeen = W.views.seen(hide.x, hide.z, 1.0);
    for (let i = 0; i < 9000 && W.beasts.length; i++) {
      W.update(0.1); out.steps++;
      for (const b of W.beasts) {
        out.states.add(b.kind + ':' + b.state);
        out.maxSpeed = Math.max(out.maxSpeed, b.speed);
        // the body stands on the ground under its feet (on a slope that is a few millimetres off the height at its middle)
        const off = Math.abs(b.pos.y - W.G.height(b.pos.x, b.pos.z)); out.maxOff = Math.max(out.maxOff || 0, off); if (off > 0.05) out.offGround++;
        if (W.obstacleAt(b.pos.x, b.pos.z) && out.inObstacle.length < 8) out.inObstacle.push(`${b.kind}:${b.state}@${b.pos.x.toFixed(1)},${b.pos.z.toFixed(1)}`);
        if (b.state === 'graze' && W.G.meadow(b.pos.x, b.pos.z)) out.seen = true;
      }
      if (out.waitAfter == null && W.stageWait.meadow > 0) out.waitAfter = +W.stageWait.meadow.toFixed(1);
    }
    out.end = W.beasts.length ? 'still out' : 'gone'; out.secs = out.steps / 10;
    out.states = [...out.states]; out.maxSpeed = +out.maxSpeed.toFixed(2);
    return out;
  });
  console.log('VISIT ' + JSON.stringify(visit));
  check('a visit starts out of sight in the wood (no window and no spot on the terrace sees where it starts)', visit.ok && visit.startSeen === 0, { start: visit.start, dist: visit.startDist, seen: visit.startSeen });
  check('a doe and her fawn come out onto the meadow, graze and go back into the wood', visit.kinds.join() === 'roe,fawn' && visit.seen && visit.states.some((s) => s.endsWith(':graze')) && visit.end === 'gone' && visit.secs > 40 && visit.secs < 760, { secs: visit.secs, states: visit.states });
  check('on the way they stay on the ground and never step into a tree, the lake, the house or onto the terrace', visit.offGround === 0 && visit.inObstacle.length === 0, { offGround: visit.offGround, maxOff: +(visit.maxOff || 0).toFixed(3), inObstacle: visit.inObstacle });
  check('once they turn to go, their place rests a while before the next group comes there', visit.waitAfter >= 8, visit.waitAfter);

  // ---------------------------------------------------------------- shy, but calm ------------------------------------
  const approach = async (kind, z0, opts = {}) => page.evaluate(([kind, z0, opts]) => {
    const w = window.__app.world, W = w.wildlife, p = w.player;
    W.clear();
    const a = W.spawn(kind, { x: 4, z: z0, yaw: Math.PI, mother: false })[0];
    p.transition = null; p.setPose(opts.px ?? 4, opts.pz0 ?? 9, Math.PI, 0);
    const out = { states: [], first: {}, maxSpeed: 0, d0: null, d: null, flee: null };
    for (let i = 0; i < (opts.steps ?? 300); i++) {
      // the player walks up to the edge of the lawn in two seconds and stands there
      if (i < 40) p.position.z = (opts.pz0 ?? 9) + i * ((opts.pz1 ?? 13.8) - (opts.pz0 ?? 9)) / 40;
      if (opts.px1 != null && i < 40) p.position.x = (opts.px ?? 4) + i * (opts.px1 - (opts.px ?? 4)) / 40;
      W.update(0.05);
      const b = W.beasts.find((x) => x.kind === kind); if (!b) break;
      const d = Math.hypot(b.pos.x - p.position.x, b.pos.z - p.position.z);
      if (out.d0 == null) out.d0 = +d.toFixed(1);
      if (!(b.state in out.first)) { out.first[b.state] = +(i * 0.05).toFixed(2); out.states.push(b.state); }
      // where the head points (the body's heading plus the turn of neck and head) against the way to the player, while it
      // stands and stares (not while it takes a few steps away or turns round to him)
      if ((b.state === 'alert' || b.state === 'watch') && b.stateT > 1.2 && b.speed < 0.05 && Math.abs(b.turnRate) < 0.05 && b.P.move < 0.1) { const e = Math.atan2(p.position.x - b.pos.x, p.position.z - b.pos.z) - b.yaw - b.P.yaw; out.stares = (out.stares || 0) + 1; if (out.stares > 20) out.lookErr = Math.max(out.lookErr || 0, Math.abs(Math.atan2(Math.sin(e), Math.cos(e)))); }
      if (b.speed > out.maxSpeed) out.maxGait = b.P.gallop > 0.5 ? 'gallop' : b.P.trot > 0.5 ? 'trot' : 'walk';
      out.maxSpeed = Math.max(out.maxSpeed, b.speed); out.d = +d.toFixed(1);
    }
    out.maxSpeed = +out.maxSpeed.toFixed(2);
    const b = W.beasts.find((x) => x.kind === kind);
    out.walk = b?.walk ?? W.beasts[0]?.walk; out.trot = b?.trotSpeed;
    W.clear();
    return out;
  }, [kind, z0, opts]);
  await page.evaluate(() => { const W = window.__app.world.wildlife; W.wait = 1e6; });
  const roe = await approach('roe', 24, { steps: 400 });
  console.log('ROE ' + JSON.stringify(roe));
  check('a roe deer looks up when the player walks out, then trots off briskly (no gallop, 3.0 to 4.2 m/s), stops a little way off and watches him', roe.states.includes('alert') && roe.states.includes('flee') && roe.states.includes('wary') && roe.maxGait === 'trot' && roe.maxSpeed >= 3 && roe.maxSpeed <= 4.2 && roe.d > 14, roe);
  const stare = await approach('stag', 30, { pz1: 12.5 });
  console.log('STAG ' + JSON.stringify(stare));
  check('an alert stag turns its head (and, when he is behind it, its body) towards the player', stare.states.includes('alert') && stare.lookErr != null && stare.lookErr < 0.35, { lookErr: stare.lookErr && +stare.lookErr.toFixed(2), stares: stare.stares, states: stare.states });
  const fox = await approach('fox', 21, { steps: 400 });
  console.log('FOX ' + JSON.stringify(fox));
  check('a fox that the player comes close to trots off quickly (no gallop), stops a little way off and watches him', fox.states.includes('flee') && fox.states.includes('wary') && fox.maxGait === 'trot' && fox.maxSpeed > fox.trot * 1.2 && fox.d > 10, fox);
  const wolf = await approach('wolf', 34);
  console.log('WOLF ' + JSON.stringify(wolf));
  check('the wolf watches the player first (looking at him), then walks off (at walking pace)', wolf.states[0] === 'watch' && wolf.lookErr < 0.35 && wolf.first.leave > 2.5 && wolf.maxSpeed <= wolf.walk * 1.15 && wolf.d > wolf.d0 + 3, wolf);
  const indoor = await approach('roe', 19, { px: 2, pz0: -3, pz1: 4.5, px1: 3 });
  console.log('INDOOR ' + JSON.stringify(indoor));
  check('behind the glass the player is no bother to them', !indoor.states.includes('alert') && !indoor.states.includes('flee'), indoor.states);

  // ---------------------------------------------------------------- tracks in the snow ------------------------------
  const tracks = await page.evaluate(() => {
    const w = window.__app.world, W = w.wildlife, p = w.player;
    w.settings.weather = 'snow'; w.applySettings(w.settings);
    W.clear(); p.transition = null; p.setPose(0, -2, Math.PI, 0);
    const a = W.spawn('roe', { x: -6, z: 22, yaw: 0.5 })[0];
    a.setState('walk'); a.go(W.field.path(a.pos, { x: -2, z: 29 }), a.walk);
    // (the prints lie in the snow of the ground since 0.7.1: world.tracks, tracks.js)
    const T = w.tracks, count = () => (T ? T.list('hoof').length : W.prints[0].count);
    for (let i = 0; i < 160; i++) W.update(0.05);
    const prints = count(), coat = a.mesh.geometry !== W.spawn('roe', { x: 10, z: 40, winter: false, hold: true })[0].mesh.geometry;
    w.settings.weather = 'clear'; w.applySettings(w.settings);
    for (let i = 0; i < 120; i++) { W.update(0.05); T?.update(0.05); }
    const after = count();
    W.clear();
    return { prints, after, winterCoat: coat };
  });
  check('in the snow the deer wear their grey winter coat and leave tracks, which fade when the snow is gone', tracks.prints >= 8 && tracks.after === 0 && tracks.winterCoat, tracks);

  // ---------------------------------------------------------------- how often ----------------------------------------
  // 'Oft': simulated hours with the player in the hall (the places in front of the glass front) and in the book room
  const sim = (mode, hour, weather, side, hours = 1) => page.evaluate(([mode, hour, weather, side, hours]) => {
    const W = window.__app.world.wildlife, t = performance.now();
    const s = W.simulate(3600 * hours, { mode, hour, weather, side });
    const kinds = {}, stages = {}; for (const v of s.visits) { kinds[v.kind] = (kinds[v.kind] || 0) + 1; stages[v.stage] = (stages[v.stage] || 0) + 1; }
    const durs = s.visits.filter((v) => v.duration).map((v) => v.duration);
    return { ms: Math.round(performance.now() - t), perHour: +s.perHour.toFixed(2), visits: s.visits.length, seen: s.seen, bySide: s.bySide, maxDark: s.maxDark, first: s.first == null ? null : Math.round(s.first), maxGroups: s.maxGroups, maxSettled: s.maxSettled, maxAnimals: s.maxBeasts, darkAt: s.darkAt, unstuck: s.unstuck, shared: s.shared, crowd: s.crowdSeen, crowdAt: s.crowdSeenAt, close: s.close, minGap: s.minGap == null ? null : Math.round(s.minGap), inObstacle: s.bad, badList: s.badList, lingering: s.lingering, kinds, stages, avgVisit: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : null };
  }, [mode, hour, weather, side, hours]);
  const often = {};
  for (const [name, hour, weather, side, hours] of [['day', 12, 'clear', null, 2], ['dusk', 20.3, 'clear', null, 1], ['dawn', 6.6, 'clear', null, 1], ['night', 1, 'clear', null, 2], ['rain', 12, 'rain', null, 1], ['storm', 12, 'storm', null, 1], ['fog', 12, 'fog', null, 1], ['room', 12, 'clear', 'south', 1]]) often[name] = await sim('often', hour, weather, side, hours);
  console.log('OFTEN ' + JSON.stringify(often));
  check('"Oft", by day: an animal in sight of the house at least 70 % of the time, the first within a minute and a half, never more than about 90 s without one', often.day.seen >= 0.7 && often.day.first <= 90 && often.day.maxDark <= 95, { seen: often.day.seen, first: often.day.first, maxDark: often.day.maxDark, perHour: often.day.perHour });
  check('"Oft", at dusk and dawn as well (at least 70 %)', often.dusk.seen >= 0.7 && often.dawn.seen >= 0.7, { dusk: often.dusk.seen, dawn: often.dawn.seen });
  check('"Oft", at night fewer but still regular: foxes and deer, a group every few minutes', often.night.perHour >= 3 && often.night.perHour < often.day.perHour * 0.6 && often.night.seen >= 0.3, { perHour: often.night.perHour, seen: often.night.seen, kinds: often.night.kinds });
  check('weather lowers the rate a little, not to nothing (rain, fog; a storm more)', often.rain.perHour < often.day.perHour && often.rain.seen >= 0.5 && often.fog.seen >= 0.6 && often.storm.perHour < often.rain.perHour * 1.05 && often.storm.seen > 0.15, { day: [often.day.perHour, often.day.seen], rain: [often.rain.perHour, often.rain.seen], fog: [often.fog.perHour, often.fog.seen], storm: [often.storm.perHour, often.storm.seen] });
  const allOften = Object.values(often);
  // (groups on their way home out of sight do not hold up the next one: at most six groups and twelve animals in all)
  check('several groups at once, but never more than three settled ones and each at a place of its own', allOften.every((s) => s.maxSettled <= 3 && s.maxGroups <= 6 && s.maxAnimals <= 12 && s.shared === 0) && often.day.maxSettled >= 2, allOften.map((s) => `${s.maxSettled}/${s.maxGroups}/${s.maxAnimals}/${s.shared}`));
  // (two groups pass each other now and then, as deer do where their ways meet; they never walk into each other)
  check('never a crowd: where they can be seen, two groups are within 4 m of each other in at most 3 % of the time, and pass at least 0.8 m apart (they give way, step aside or go round)', allOften.every((s) => (s.crowd == null || s.crowd >= 0.8) && s.close <= 0.03), allOften.map((s) => [s.crowd, s.close, s.crowdAt]));
  check('in the book room, visits start and come to its windows (an animal in sight of one of them most of the time)', often.room.visits > 3 && often.room.seen >= 0.7 && ['south', 'east', 'west'].some((k) => often.room.bySide[k] >= 0.5), { visits: often.room.visits, seen: often.room.seen, bySide: often.room.bySide });
  // 'Normal': in between
  const normal = await sim('normal', 12, 'clear', null, 2);
  console.log('NORMAL ' + JSON.stringify(normal));
  check('"Normal" lies between "Selten" and "Oft"', normal.perHour < often.day.perHour && normal.seen < often.day.seen && normal.seen > 0.25, { normal: [normal.perHour, normal.seen], often: [often.day.perHour, often.day.seen] });
  // 'Selten': the rare visits of 0.6
  const H = +(process.env.WL_HOURS || 8);
  const rare = {};
  for (const [name, hour, weather] of [['day', 12, 'clear'], ['dusk', 20.3, 'clear'], ['dawn', 6.6, 'clear'], ['night', 1, 'clear'], ['storm', 20.3, 'storm']]) rare[name] = await sim('rare', hour, weather, null, H);
  console.log('RARE ' + JSON.stringify(rare));
  const allRare = Object.values(rare);
  check('"Selten" as in 0.6: never more than one group (at most two animals) at a time', allRare.every((s) => s.maxGroups <= 1 && s.maxAnimals <= 2), allRare.map((s) => s.maxGroups + '/' + s.maxAnimals));
  check('"Selten": at least three minutes between one visit and the next', allRare.every((s) => s.minGap == null || s.minGap >= 175), allRare.map((s) => s.minGap));
  check('"Selten": more visits at dusk and dawn than by day, fewer at night, few in a storm', rare.dusk.perHour > rare.day.perHour * 1.25 && rare.dawn.perHour > rare.day.perHour && rare.day.perHour > rare.night.perHour && rare.storm.perHour < rare.dusk.perHour * 0.4, { day: rare.day.perHour, dusk: rare.dusk.perHour, dawn: rare.dawn.perHour, night: rare.night.perHour, storm: rare.storm.perHour });
  const kinds = {}; for (const s of [...allRare, ...allOften]) for (const [k, n] of Object.entries(s.kinds)) kinds[k] = (kinds[k] || 0) + n;
  const total = Object.values(kinds).reduce((a, b) => a + b, 0);
  check('all five kinds of visit come, the wolf rarely', Object.keys(kinds).length === 5 && kinds.wolf / total < 0.12, kinds);
  check('in all those hours nobody stepped into a tree, the lake, the house, the feeding station or onto the terrace', [...allRare, ...allOften, normal].every((s) => s.inObstacle === 0), [...allRare, ...allOften].map((s) => s.badList).filter((l) => l.length));
  check('nobody stays for good: no visit lasts longer than half an hour (a long one is a group at the feeding station)', [...allRare, ...allOften, normal].every((s) => s.lingering.every((l) => l.t2 == null)), [...allRare, ...allOften, normal].flatMap((s) => s.lingering).filter((l) => l.t2 != null));

  // ---------------------------------------------------------------- the book room: a visit starts --------------------
  const room = await page.evaluate(() => {
    const w = window.__app.world, W = w.wildlife, p = w.player;
    W.clear(); W.stageWait = {}; W.wait = 2; W.focusOverride = null;
    p.transition = null; p.setPose(0, -16, Math.PI / 2, 0); p.update(0); w.camera.updateMatrixWorld();   // in the book room, looking west
    let started = null;
    for (let t = 0; t < 60 && !started; t += 0.1) { W.update(0.1, false); if (W.visits.length) started = { t: +t.toFixed(1), stage: W.visits[0].stage }; }
    W.clear();
    return started;
  });
  check('with the player in the book room a group sets off at once, to a place in sight of its windows', room && room.t < 10 && ['south', 'east', 'west'].includes(room.stage), room);

  // ---------------------------------------------------------------- the setting ---------------------------------------
  const setting = await page.evaluate(() => {
    const w = window.__app.world, W = w.wildlife;
    W.spawn('roe', { x: 4, z: 26 });
    const before = W.beasts.length;
    w.applySettings({ ...w.settings, wildlife: false });
    const wait = W.wait; for (let i = 0; i < 20; i++) W.update(1);
    const off = { animals: W.beasts.length, enabled: W.enabled, waitStill: W.wait === wait };
    w.applySettings({ ...w.settings, wildlife: true });
    W.wait = 30;
    for (let i = 0; i < 5; i++) W.update(1);
    // the frequency is read when it is needed
    w.applySettings({ ...w.settings, wildlifeRate: 'rare' }); const rare = W.info().mode;
    w.applySettings({ ...w.settings, wildlifeRate: 'often' }); const oft = W.info().mode;
    return { before, off, onAgain: W.enabled, waitRuns: W.wait < 30, rare, oft };
  });
  check('switched off in the settings: the animals are gone and nothing runs; on again: the visits come back; the frequency follows the setting', setting.before === 1 && setting.off.animals === 0 && !setting.off.enabled && setting.off.waitStill && setting.onAgain && setting.waitRuns && setting.rare === 'rare' && setting.oft === 'often', setting);

  // ---------------------------------------------------------------- low quality -----------------------------------------
  // drawn straight onto the screen (no composer): the animals' shader for that path is warmed up as well
  await setTime(10);
  const low = await page.evaluate(() => {
    const w = window.__app.world, W = w.wildlife, g = w.settings.graphics || {};
    w.applySettings({ ...w.settings, graphics: { ...g, quality: 'low' } });
    W.clear(); W.wait = 1e6; W.spawn('fox', { x: -4.5, z: 21, yaw: 0.3, hold: true, pose: 'walk' });
    w.player.transition = null; w.player.setPose(0.6, 13.8, Math.atan2(4.5 + 0.6, -(21 - 13.8)), -0.12);
    for (let i = 0; i < 8; i++) w.frame();
    const programs = w.renderer.info.programs.length, composer = w.bloom.enabled || w.ao.enabled;
    for (let i = 0; i < 8; i++) w.frame();
    return { composer, programs, programsLater: w.renderer.info.programs.length, quality: w.quality, animals: W.beasts.length };
  });
  await shot(`${tag}-fox-low`);
  await page.evaluate(() => { const w = window.__app.world; w.applySettings({ ...w.settings, graphics: { ...(w.settings.graphics || {}), quality: 'high' } }); w.wildlife.clear(); });
  check('on low quality (drawn straight to the screen) the animals appear as well, without new programs once warmed up', low.quality === 'low' && !low.composer && low.animals === 1 && low.programsLater === low.programs, low);

  // ---------------------------------------------------------------- pictures --------------------------------------------
  await page.evaluate(() => { document.querySelector('#hud')?.style.setProperty('opacity', '0'); window.__app.world.wildlife.clear(); });
  // in sight from the terrace, through the glass and out of the book room's windows
  const views = [
    // [name, hour, kind, animal x, z, yaw, pose, the player's x, z]: the player looks at the animal
    ['roe-near', 10, 'roe', -5.5, 21.5, -0.4, 'graze', 0.6, 13.8],
    ['fawn-near', 10, 'fawn', -3.0, 23.5, 0.9, 'stand', -5, 13.8],
    ['stag-near', 10, 'stag', 5.5, 24.0, -2.6, 'stand', 5, 13.8],
    ['fox-near', 10, 'fox', -4.5, 21.0, 0.3, 'stand', 0.6, 13.8],
    ['wolf-near', 10, 'wolf', -2.5, 23.5, 1.2, 'alert', -5, 13.8],
    ['roe-far', 10, 'roe', 2.0, 37.0, 1.6, 'walk', -5, 13.8],
    ['stag-far', 10, 'stag', 7.0, 40.0, -1.4, 'graze', 5, 13.8],
    ['fox-far', 10, 'fox', -13.0, 31.0, 1.0, 'trot', 0.6, 13.8],
    ['wolf-far', 10, 'wolf', 4.0, 39.0, -1.8, 'walk', -5, 13.8],
    ['fawn-dusk', 20.0, 'fawn', -5.0, 22.0, -0.6, 'graze', 0.6, 13.8],
    ['stag-dusk', 20.0, 'stag', -2.5, 24.0, 1.8, 'alert', -5, 13.8],
    ['fox-dusk', 20.0, 'fox', -4.5, 21.0, 0.6, 'stand', 0.6, 13.8],
    ['roe-twilight', 20.45, 'roe', -5.5, 21.5, 0.3, 'alert', 0.6, 13.8],
    ['glass-day', 10, 'fawn', -4.5, 23.0, -0.9, 'graze', 0, -2.2],
    ['glass-dusk', 20.0, 'stag', -5.5, 27.0, 1.2, 'stand', 0, -2.2],
    ['south-day', 12, 'fawn', 2.0, -35.0, 2.6, 'graze', 0, -22.4],
    ['east-day', 15, 'roe', 21.0, -22.0, -1.3, 'graze', 10.1, -20.0],
    ['west-dusk', 20.2, 'stag', -24.0, -22.5, 1.9, 'stand', -10.1, -20.0],
    ['wolf-snow', 15, 'wolf', -5.5, 22.0, 0.45, 'walk', -1.5, 15.0, 'snow'],
    ['roe-snow', 11, 'roe', -5.0, 22.5, 0.9, 'graze', 0.6, 13.8, 'snow'],
  ];
  const only = process.env.WL_SHOTS ? process.env.WL_SHOTS.split(',') : null;
  for (const [name, hour, kind, x, z, yaw, pose, px, pz, weather] of views) {
    if (only && !only.includes(name)) continue;
    await setTime(hour, weather);
    await page.evaluate(([kind, x, z, yaw, pose, px, pz]) => {
      const w = window.__app.world, W = w.wildlife; W.clear(); W.wait = 1e6;
      const a = W.spawn(kind, { x, z, yaw, hold: true, pose })[0];
      const ty = a.pos.y + a.mesh.boundingSphere.center.y * 0.8, eye = 1.62;
      w.player.transition = null; w.player.setPose(px, pz, Math.atan2(-(x - px), -(z - pz)), Math.atan2(ty - eye, Math.hypot(x - px, z - pz)));
      for (let i = 0; i < 30; i++) w.updateDoor(0.05);
      for (let i = 0; i < 30; i++) W.update(0.05);
    }, [kind, x, z, yaw, pose, px, pz]);
    for (let i = 0; i < 12; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(40); }
    await shot(`${tag}-${name}`);
  }
  await page.evaluate(() => window.__app.world.wildlife.clear());
  check('no errors on the page', errors.length === 0, errors.slice(0, 5));
  console.log(`WILDLIFE ${failures ? 'FAILED ' + failures : 'OK'}`);
};
