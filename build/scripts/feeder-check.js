// The feeding station on the meadow (outdoor.js FEEDER, feeder.js, wildlife.js): the hay rack with its trough and roof,
// the salt lick and the hide stand where they should and survive a rebuild; you cannot walk into them, the animals keep
// out of them as well; the place "Futterstelle" in the Orte menu stands in front of the hide and looks at the rack, the
// bench in the hide seats you with the rack ahead; the rack is in sight from the terrace and the glass front; deer come
// to it often, eat hay from the rack, from the trough (the fawn) and lick the salt, with their muzzle at the food, and
// go back into the wood; no new shader program when it comes into view. Pictures from the hide, the terrace, the glass
// front and close by, by day and at dusk (SHOT_TAG prefixes them, FD_SHOTS=name,… or none).
module.exports = async ({ page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || 'fd';
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
  await sleep(4000);
  let failures = 0;
  const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); if (!ok) failures++; };
  const setTime = (hour) => page.evaluate((hour) => { const w = window.__app.world; w.settings.timeMode = 'fixed'; w.settings.fixedHour = hour; w.settings.weather = 'clear'; w.applySettings(w.settings); }, hour);
  await setTime(13);

  // ---------------------------------------------------------------- the station and the hide --------------------------
  const built = await page.evaluate(() => {
    const w = window.__app.world, F = w.env.garden.outdoor.feeder;
    const kinds = w.static.children.map((o) => o.userData.placement?.kind).filter((k) => k === 'feeder' || k === 'feederhide');
    const rack = w.static.children.find((o) => o.userData.placement?.kind === 'feeder');
    let tris = 0; rack?.traverse((m) => { if (m.isMesh) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; });
    const near = (x, z, r) => w.env.garden.outdoor.obstaclesNear(x, z, r).map((o) => o.what);
    return {
      kinds, tris: Math.round(tris), at: rack && [+rack.position.x.toFixed(2), +rack.position.z.toFixed(2)], feeder: [F.x, F.z],
      inMeadow: F.x > 18 && w.env.garden.outdoor.inRegion(F.x, F.z), ground: rack && +(rack.position.y - w.env.garden.outdoor.terrainHeight(F.x, F.z)).toFixed(3),
      obstacles: { rack: near(F.x, F.z, 0.1), salt: near(...F.at(...F.salt.at), 0.05), hide: near(F.hide.x, F.hide.z, 0.1) },
    };
  });
  check('the feeding station (rack with roof and trough, salt lick) and the hide stand on the meadow east of the lawn, on the ground', built.kinds.includes('feeder') && built.kinds.includes('feederhide') && built.inMeadow && built.tris > 2000 && Math.abs(built.ground) < 0.01, built);
  check('the rack, the salt lick and the hide are obstacles of the garden (outdoor.js)', built.obstacles.rack.includes('feeder') && built.obstacles.salt.includes('feeder') && built.obstacles.hide.includes('hide'), built.obstacles);

  // ---------------------------------------------------------------- you cannot walk into them -------------------------
  const walls = await page.evaluate(() => {
    const w = window.__app.world, F = w.env.garden.outdoor.feeder, p = w.player, W = w.wildlife, out = {};
    W.prepareAll();
    for (const [name, x, z] of [['rack', F.x, F.z], ['rackEnd', ...F.at(0.8, 0)], ['salt', ...F.at(...F.salt.at)], ['hide', F.hide.x, F.hide.z]]) {
      const q = { x, z }; w.env.garden.outdoor.keepInside(q, 0.3);
      out[name] = { free: p.bounds.free(x, z, 0.3), pushed: +Math.hypot(q.x - x, q.z - z).toFixed(2), animals: W.obstacleAt(x, z) };
    }
    // walk the player along a line through the rack: he stops in front of it
    p.transition = null; p.setPose(F.x - 4, F.z, -Math.PI / 2, 0);
    let x = F.x - 4;
    for (let i = 0; i < 80; i++) { const q = { x: x + 0.1, z: F.z }; w.env.garden.outdoor.keepInside(q, 0.3); x = q.x; }
    out.walk = +(F.x - x).toFixed(2);
    return out;
  });
  check('neither the player nor an animal can stand in the rack, at the salt lick or in the hide; walking at the rack stops in front of it', Object.values(walls).filter((v) => typeof v === 'object').every((v) => !v.free && v.pushed > 0.2 && v.animals) && walls.walk > 0.5, walls);

  // ---------------------------------------------------------------- the place and the seat ----------------------------
  const place = await page.evaluate(() => {
    const w = window.__app.world, F = w.env.garden.outdoor.feeder, p = w.player;
    const pl = w.places.find((x) => x.id === 'feeder');
    w.actions.teleport('feeder'); p.update(0);
    const dir = w.camera.getWorldDirection(w.camera.position.clone()), to = { x: F.x - p.position.x, z: F.z - p.position.z }, d = Math.hypot(to.x, to.z);
    const err = Math.acos(Math.max(-1, Math.min(1, (dir.x * to.x + dir.z * to.z) / (Math.hypot(dir.x, dir.z) * d))));
    // the bench in the hide
    const seat = w.seats.get('feederhide');
    p.transition = null; p.setPose(seat.standPos.x, seat.standPos.z, seat.standYaw, 0);
    w.actions.sit('feederhide');
    for (let i = 0; i < 60; i++) { p.update(0.05); }
    const sdir = w.camera.getWorldDirection(w.camera.position.clone()), sto = { x: F.x - w.camera.position.x, z: F.z - w.camera.position.z }, sd = Math.hypot(sto.x, sto.z);
    const serr = Math.acos(Math.max(-1, Math.min(1, (sdir.x * sto.x + sdir.z * sto.z) / (Math.hypot(sdir.x, sdir.z) * sd))));
    const seated = { id: w.actions.seatedId, eyeY: +(w.camera.position.y - w.env.garden.outdoor.terrainHeight(w.camera.position.x, w.camera.position.z)).toFixed(2), err: +serr.toFixed(3), dist: +sd.toFixed(1) };
    // stand up again: in front of the hide, outside its walls
    w.actions.leaveSeat(); p.transition = null; p.setPose(seat.standPos.x, seat.standPos.z, seat.standYaw, 0);
    const standFree = p.bounds.free(seat.standPos.x, seat.standPos.z, 0.3);
    return { label: pl && pl.label, group: pl?.group, dist: +d.toFixed(1), err: +err.toFixed(3), seated, seatLabel: seat?.label, standFree };
  });
  check('the place "Futterstelle" / "Feeding station" in the Orte menu (Garten) stands 15 to 25 m from the rack and looks at it', place.label?.de === 'Futterstelle' && place.label?.en === 'Feeding station' && place.group === 'garden' && place.dist >= 14 && place.dist <= 25 && place.err < 0.12, place);
  check('the bench in the hide seats you, eye at a sitting height, the rack ahead; standing up you are in front of the hide', place.seated.id === 'feederhide' && place.seated.eyeY > 1.1 && place.seated.eyeY < 1.5 && place.seated.err < 0.2 && place.seated.dist >= 14 && place.seated.dist <= 25 && place.standFree, { seated: place.seated, label: place.seatLabel, standFree: place.standFree });

  // ---------------------------------------------------------------- in sight from the house ---------------------------
  const sight = await page.evaluate(() => {
    const w = window.__app.world, F = w.env.garden.outdoor.feeder, W = w.wildlife;
    const Ray = w.actions.raycaster.constructor, V = w.camera.position.constructor, blockers = [];
    for (const o of w.occluders) o.traverse((m) => { if (m.isMesh && !(m.material?.transparent && m.material.opacity < 0.6)) blockers.push(m); });
    w.env.garden.group.traverse((m) => { if (m.isBatchedMesh && (/-bark$/.test(m.name) || /^(spruce|bush)-leaves$/.test(m.name))) blockers.push(m); });
    const ray = new Ray(), target = new V(F.x, F.y + 1.0, F.z);
    const free = (x, y, z) => { const o = new V(x, y, z), d = target.clone().sub(o), L = d.length(); ray.set(o, d.normalize()); ray.far = L - 1.2; ray.near = 0.05; return ray.intersectObjects(blockers, false).length === 0; };
    return {
      terrace: free(0.6, 1.62, 8.7), terraceEast: free(5, 1.62, 8.6), glassEast: free(5.5, 1.62, 4.6), glassMiddle: free(2.5, 1.62, 4.6),
      views: { terrace: W.views.count('terrace', F.x, F.z, 0.9), north: W.views.count('north', F.x, F.z, 0.9) },
    };
  });
  check('the rack is in sight from the terrace and through the east part of the glass front (rays against the house and the trees)', sight.terrace && sight.glassEast && sight.views.terrace > 0 && sight.views.north > 0, sight);

  // ---------------------------------------------------------------- the deer at the rack ------------------------------
  const visit = await page.evaluate(() => {
    const w = window.__app.world, W = w.wildlife, F = w.env.garden.outdoor.feeder, p = w.player;
    p.transition = null; p.setPose(0.6, -1.5, Math.PI, 0); p.update(0); w.camera.updateMatrixWorld();   // in the hall: no bother
    W.clear(); W.stageWait = {}; W.wait = 1e6; W.modeOverride = 'often';
    const ok = W.start('fawn', 'feeder');
    const out = { ok, kinds: W.beasts.map((b) => b.kind), foods: {}, states: new Set(), inObstacle: [], muzzle: [], secs: 0, end: null };
    const c = Math.cos(F.rot), s = Math.sin(F.rot), [sx, sz] = F.at(...F.salt.at);
    for (let i = 0; i < 12000 && W.beasts.length; i++) {   // up to 20 minutes: a meal may run long (0.7.1: interrupted meals are finished)
      W.update(0.1, i % 10 === 0); out.secs = +(i / 10).toFixed(1);
      for (const b of W.beasts) {
        out.states.add(b.kind + ':' + b.state);
        if (b.state === 'feed' && b.food) out.foods[b.kind + ':' + b.food] = (out.foods[b.kind + ':' + b.food] || 0) + 1;
        if (W.obstacleAt(b.pos.x, b.pos.z) && out.inObstacle.length < 6) out.inObstacle.push(`${b.kind}:${b.state}@${b.pos.x.toFixed(2)},${b.pos.z.toFixed(2)}`);
        // with the pose drawn: where the muzzle is while it eats (in the rack's frame; the salt lick's block)
        if (i % 10 === 0 && b.state === 'feed' && b.stateT > 4 && out.muzzle.length < 60) {
          b.mesh.updateMatrixWorld(true);
          const m = b.A.bones.head.localToWorld(b.A.nose.clone()), dx = m.x - F.x, dz = m.z - F.z;
          const lx = dx * c - dz * s, lz = dx * s + dz * c, y = m.y - F.y;
          out.muzzle.push({ kind: b.kind, food: b.food, lx: +lx.toFixed(2), lz: +lz.toFixed(2), y: +y.toFixed(2), salt: +Math.hypot(m.x - sx, m.z - sz).toFixed(2), saltY: +(y - F.salt.h).toFixed(2) });
        }
      }
    }
    out.end = W.beasts.length ? 'still out' : 'gone'; out.states = [...out.states];
    W.modeOverride = null; W.clear();
    return out;
  });
  console.log('VISIT ' + JSON.stringify({ ...visit, muzzle: visit.muzzle.slice(0, 12) }));
  const R = { half: 0.45, len: 1.7 };
  // (the salt block lies on the post's top: the muzzle within 15 cm of the post's middle, at the block's height)
  const atFood = visit.muzzle.filter((m) => (m.food === 'salt' ? m.salt < 0.15 && m.saltY > -0.08 && m.saltY < 0.2 : Math.abs(m.lx) < R.len / 2 && Math.abs(m.lz) < R.half + 0.15 && m.y > 0.25 && m.y < 1.25));
  check('a doe and her fawn come to the feeding station: hay from the rack, the trough (the fawn), the salt lick; then back into the wood', visit.ok && visit.kinds.join() === 'roe,fawn' && Object.keys(visit.foods).some((k) => k.startsWith('roe:')) && visit.foods['fawn:trough'] > 0 && visit.end === 'gone', { foods: visit.foods, secs: visit.secs, states: visit.states });
  check('while they eat, the muzzle is at the food (in the rack or the trough, at the salt block)', visit.muzzle.length >= 5 && atFood.length / visit.muzzle.length >= 0.9, { n: visit.muzzle.length, atFood: atFood.length, sample: visit.muzzle.slice(0, 6) });
  check('they never step into the rack, the salt lick or the hide', visit.inObstacle.length === 0, visit.inObstacle);
  const often = await page.evaluate(() => { const W = window.__app.world.wildlife; const s = W.simulate(7200, { mode: 'often', hour: 12, weather: 'clear' }); return { visits: s.visits.length, feeder: s.visits.filter((v) => v.stage === 'feeder').length, bad: s.bad }; });
  check('with "Oft" deer come to the feeding station several times an hour', often.feeder / 2 >= 2 && often.bad === 0, often);

  // ---------------------------------------------------------------- no new program, a rebuild ---------------------------
  const programs = await page.evaluate(async () => {
    const w = window.__app.world, F = w.env.garden.outdoor.feeder;
    w.player.transition = null; w.player.setPose(0.6, -2, Math.PI, 0);
    for (let i = 0; i < 20; i++) { w.frame(); await new Promise((r) => setTimeout(r, 30)); }
    const before = w.renderer.info.programs.length;
    w.actions.teleport('feeder');
    for (let i = 0; i < 20; i++) { w.frame(); await new Promise((r) => setTimeout(r, 30)); }
    const after = w.renderer.info.programs.length;
    // a rebuild of the world (new books): the station and the seat are there again
    w.build(w.library, {});
    for (let i = 0; i < 10; i++) w.frame();
    const kinds = w.static.children.map((o) => o.userData.placement?.kind).filter((k) => k === 'feeder' || k === 'feederhide');
    return { before, after, rebuilt: kinds, seat: !!w.seats.get('feederhide'), place: !!w.places.find((p) => p.id === 'feeder'), afterRebuild: w.renderer.info.programs.length };
  });
  check('no new shader program when the feeding station comes into view (the garden\'s materials), and it is there again after a rebuild', programs.after === programs.before && programs.rebuilt.length === 2 && programs.seat && programs.place && programs.afterRebuild === programs.after, programs);

  // ---------------------------------------------------------------- pictures ------------------------------------------
  const only = process.env.FD_SHOTS ? process.env.FD_SHOTS.split(',') : null;
  const pics = [
    ['hide-day', 13, 'seat'], ['terrace-day', 13, [0.6, 8.7]], ['glass-day', 13, [5.4, 4.6]], ['close-day', 13, 'close'],
    ['hide-dusk', 20.2, 'seat'], ['terrace-dusk', 20.2, [0.6, 8.7]],
  ];
  for (const [name, hour, where] of pics) {
    if (only && !only.includes(name)) continue;
    await setTime(hour);
    await page.evaluate((where) => {
      const w = window.__app.world, W = w.wildlife, F = w.env.garden.outdoor.feeder, p = w.player;
      document.querySelector('#hud')?.style.setProperty('opacity', '0');
      W.clear(); W.wait = 1e6;
      W.spawn('roe', { station: 'rackW0', hold: true, pose: 'rack' });
      W.spawn('fawn', { station: 'rackW1', hold: true, pose: 'trough' });
      W.spawn('roe', { station: 'rackE1', hold: true, pose: 'rack' });
      W.spawn('roe', { station: 'salt', hold: true, pose: 'salt' });
      for (let i = 0; i < 40; i++) W.update(0.05);
      if (w.actions.seatedId) w.actions.leaveSeat();
      if (where === 'seat') { const s = w.seats.get('feederhide'); p.transition = null; p.setPose(s.standPos.x, s.standPos.z, s.standYaw, 0); w.actions.sit('feederhide'); for (let i = 0; i < 60; i++) p.update(0.05); return; }
      const [px, pz] = where === 'close' ? [F.x - 6.5, F.z - 4.5] : where;
      p.transition = null; p.setPose(px, pz, Math.atan2(-(F.x - px), -(F.z - pz)), Math.atan2(0.9 - 1.62, Math.hypot(F.x - px, F.z - pz)));
    }, where);
    for (let i = 0; i < 16; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(30); }
    await shot(`${tag}-${name}`);
  }
  await page.evaluate(() => { const w = window.__app.world; if (w.actions.seatedId) w.actions.leaveSeat(); w.wildlife.clear(); });
  check('no errors on the page', errors.length === 0, errors.slice(0, 5));
  console.log(`FEEDER ${failures ? 'FAILED ' + failures : 'OK'}`);
};
