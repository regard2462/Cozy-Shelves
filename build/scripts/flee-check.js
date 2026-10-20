// The flight of the wild animals (wildlife.js, wildlife-models.js): the player walks up to them in the garden with the
// normal controls (W held, the view on the animal; Shift to run). A doe with her fawn grazing on the meadow looks up,
// then trots off briskly (quicker than her ordinary trot, never a gallop: 3.0 to 4.2 m/s, the gallop pose stays below
// 0.5), the fawn with her, over open ground and never into a tree, the lake, the house, the feeding station or a fence;
// she slows to a walk and stops 16 to 24 m from him, where he still sees her, watches him and calms down (grazing or
// walking again). Her visit goes on at a new place away from him and from where he startled her, and it ends only when
// its planned time is over: the grazing the flight broke off is finished at the new place. A stag trots off briskly
// whether he walks up to it or runs at it (never a gallop) and stops 18 to 26 m from him; a fox trots off quickly,
// stops 12 to 18 m from him, calms down sooner and may sit to watch; a doe at the feeding station runs as well and does
// not go back to the rack while he stands by it. Walked up to but not too close, a doe looks up, takes a few steps away
// and grazes again once he stands still. Driven to the edge of the wood, or made to run a third time within five
// minutes, a group leaves for the wood; one on its way home hurries off when he comes close. Nobody runs from the
// player sitting in the hide. The flight costs no new shader program and no long frame. Pictures of the flight (a doe
// with her fawn from behind and from the side), the calm afterwards, a stag at the trot and the fox sitting
// (FL_SHOTS=name,… or none; SHOT_TAG prefixes them). FL_PARTS picks parts: doe, alert, stag, fox, feeder, chase,
// home, hide, programs, shots.
// Library: a copy of testbooks2 (as for wildlife-check), a fresh COZYSHELVES_USERDATA.
module.exports = async ({ page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || 'fl';
  const parts = process.env.FL_PARTS ? process.env.FL_PARTS.split(',') : null;
  const want = (p) => !parts || parts.includes(p);
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
  // the first library update rebuilds the world once more: wait until nothing has been rebuilt for five seconds
  for (let i = 0, quiet = 0; i < 40 && quiet < 4; i++) {
    const changed = await page.evaluate(() => {
      const w = window.__app.world, key = (w.buildTimes || []).length + ':' + !!w.shelfSteps;
      const same = window.__flBuild === key; window.__flBuild = key;
      return !same;
    });
    quiet = changed ? 0 : quiet + 1;
    await sleep(1300);
  }
  let failures = 0;
  const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); if (!ok) failures++; };
  const setTime = (hour, weather = 'clear') => page.evaluate(([hour, weather]) => { const w = window.__app.world; w.settings.timeMode = 'fixed'; w.settings.fixedHour = hour; w.settings.weather = weather; w.applySettings(w.settings); }, [hour, weather]);
  await setTime(11);

  // A scenario, stepped at 20 steps a second (the player's own movement and the animals; nothing waits for real time):
  // the player starts at `from`, walks (o.run: runs) towards the group's leader with the view on her, stops when she
  // runs (o.chase: keeps after her; o.stopAt: stops that far from her; o.herd: after each flight he turns up again
  // beyond her, away from the middle of the meadow, and walks up to her once more), and the steps go on until the group
  // has gone (or `maxT` seconds; o.until 'calm' or 'graze'). o.home: the group is sent on its way home first. Everything
  // that happens to the leader and her follower is recorded.
  await page.evaluate(() => {
    const w = window.__app.world, W = w.wildlife, p = w.player;
    W.prepareAll();
    const yawTo = (q) => Math.atan2(-(q.x - p.position.x), -(q.z - p.position.z));
    const gaitOf = (b) => (b.P.sit > 0.5 ? 'sit' : b.P.gallop > 0.5 ? 'gallop' : b.P.trot > 0.5 ? 'trot' : b.P.move > 0.5 ? 'walk' : 'stand');
    const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    // can the player see the animal: a ray from his eye to its body or its head, against the house, the trees (trunks,
    // the foliage of shrubs and spruces) and the ground
    const Ray = w.actions.raycaster.constructor, V = w.camera.position.constructor, blockers = [], ray = new Ray(), dir = new V();
    w.scene.updateMatrixWorld(true);
    for (const o of w.occluders) o.traverse((m) => { if (m.isMesh && !(m.material?.transparent && m.material.opacity < 0.6)) blockers.push(m); });
    w.env.garden.group.traverse((m) => { if (m.name === 'ground' || (m.isBatchedMesh && (/-bark$/.test(m.name) || /^(spruce|bush)-leaves$/.test(m.name)))) blockers.push(m); });
    const sees = (eye, b) => {
      const h = b.A.legLen[0] * b.scale, f = Math.sin(b.yaw), g = Math.cos(b.yaw);
      for (const q of [new V(b.pos.x, b.pos.y + h * 0.9, b.pos.z), new V(b.pos.x + f * h * 0.75, b.pos.y + h * 1.25, b.pos.z + g * h * 0.75)]) {
        const d = dir.copy(q).sub(eye), L = d.length(); ray.set(eye, d.normalize()); ray.far = L - 0.2; ray.near = 0.05;
        if (!ray.intersectObjects(blockers, false).length) return true;
      }
      return false;
    };
    // the player put somewhere (not walked there): the animals do not take the jump for a run
    const put = (x, z, yaw) => { p.transition = null; p.setPose(x, z, yaw, 0); W.playerPrev.copy(p.position); W.playerMove = 0; };
    window.__flRun = (o) => {
      const dt = 0.05, SHY = { roe: [24, 14], stag: [28, 17], fox: [18, 10] };
      W.enabled = true; W.clear(); W.wait = 1e6; W.stageWait = {}; W.focusOverride = null; W.sitOverride = o.sit ?? null;
      if (w.actions.seatedId) w.actions.leaveSeat();
      let group;
      if (o.stage || o.home) { put(0, -2, Math.PI); p.update(0); }
      if (o.stage) { W.start(o.kind, o.stage); group = [...W.beasts]; }
      else group = W.spawn(o.kind, { x: o.at[0], z: o.at[1], yaw: o.yaw ?? 2.5 });
      const lead = group.find((b) => !b.lead), follow = group.find((b) => b.lead === lead), v = lead.visit, [alertD, fleeD] = SHY[lead.kind];
      if (!o.stage && !o.home) put(o.from[0], o.from[1], yawTo(lead.pos));
      W.planMs = 0;
      const r = { kind: lead.kind, states: [], first: {}, gaits: [], maxSpeed: 0, gaitAtMax: null, gallopMax: 0, fawnMax: 0, fawnSpeed: 0, fawnGallopMax: 0, inObstacle: [], flights: 0, sitMax: 0, fleeMs: 0, updateMax: 0, stepAway: 0, herded: 0 };
      // (on its way home: the player waits in the hall until the doe has set off, then he is out on the meadow)
      if (o.home) { v.spots = 1; lead.grazeFor = 0; for (let i = 0; i < 5; i++) W.update(dt, false); r.homeState = lead.state; put(o.from[0], o.from[1], yawTo(lead.pos)); }
      let alertAt = null, herdT = -1;
      const ready = () => !o.stage || (lead.station && lead.state === 'feed' && (!follow || follow.station) && lead.stateT > 5);
      let t = 0, started = !o.stage, fleeT = null, prevState = null, afterRelax = false, goal0 = null;
      for (let i = 0; i < (o.maxT || 900) / dt; i++, t += dt) {
        if (!started && ready()) {
          started = true; t = 0;
          put(o.from[0], o.from[1], yawTo(lead.pos));
        }
        if (started) {
          // the player: up to the animal with the view on it; he stops when it runs, unless he chases it
          if (o.walk !== false && !r.first.flee && r.stoppedAt == null && !p.keys.size) { p.keys.add('KeyW'); if (o.run) p.keys.add('ShiftLeft'); }
          if (r.first.flee != null && !o.chase && !o.herd && p.keys.size) p.keys.clear();
          if (o.chase && !v.leaving) { p.keys.add('KeyW'); p.keys.add('ShiftLeft'); } else if (o.chase && p.keys.size) p.keys.clear();
          if (o.stopAt && r.stoppedAt == null && flat(lead.pos, p.position) < o.stopAt) { p.keys.clear(); r.stoppedAt = +t.toFixed(1); }
          if (o.herd && lead.state === 'wary' && lead.stateT > 1 && !v.leaving && t - herdT > 3) {
            // he turns up again 16 m from her, as far round to the side away from the middle of the meadow as he can stand
            // with a free walk up to her, and walks up to her
            herdT = t; r.herded++;
            const c = { x: 6, z: 32 }, a0 = Math.atan2(lead.pos.x - c.x, lead.pos.z - c.z);
            const walkable = (x, z) => { for (let k = 0; k <= 12; k++) { const f = k / 16; if (!p.bounds.free(x + (lead.pos.x - x) * f, z + (lead.pos.z - z) * f, 0.45)) return false; } return z > 7; };
            for (const da of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2, -2, 2.4, -2.4]) {
              const x = lead.pos.x + Math.sin(a0 + da) * 16, z = lead.pos.z + Math.cos(a0 + da) * 16;
              if (walkable(x, z)) { put(x, z, Math.atan2(-(lead.pos.x - x), -(lead.pos.z - z))); r.herdAt = (r.herdAt || []).concat([[+x.toFixed(1), +z.toFixed(1)]]); break; }
            }
            p.keys.clear(); p.keys.add('KeyW');
          }
          if (o.herd && lead.state === 'flee' && p.keys.size) p.keys.clear();
          if (p.keys.size) p.yaw = yawTo(lead.pos);
          p.update(dt);
        }
        const a0 = performance.now();
        W.update(dt, false);
        const ms = performance.now() - a0;
        r.updateMax = Math.max(r.updateMax, ms);
        if (!started) { if (!W.beasts.length) break; continue; }
        const d = flat(lead.pos, p.position), s = lead.state;
        if (o.track && i % 20 === 0 && (r.track ||= []).length < 40) r.track.push(`${t.toFixed(0)}:${p.position.x.toFixed(1)},${p.position.z.toFixed(1)}/${s}/${d.toFixed(1)}`);
        if (s === 'alert') { alertAt ||= lead.pos.clone(); r.stepAway = Math.max(r.stepAway, +flat(lead.pos, alertAt).toFixed(1)); }
        if (s !== prevState) {
          if (r.first[s] == null) r.first[s] = +t.toFixed(2);
          if (r.states.length < 60) r.states.push(s);
          if (s === 'flee' && fleeT == null) { fleeT = t; r.fleeMs = +ms.toFixed(2); r.fleeAt = { d: +d.toFixed(1), player: [+p.position.x.toFixed(1), +p.position.z.toFixed(1)] }; r.resume = lead.resume == null ? null : +lead.resume.toFixed(1); }
          if (s === 'wary' && !r.stop) r.stop = { t: +t.toFixed(2), d: +d.toFixed(1), at: [+lead.pos.x.toFixed(1), +lead.pos.z.toFixed(1)], scare: v.scare ? +flat(lead.pos, v.scare).toFixed(1) : null, fawn: follow && !follow.gone ? +flat(follow.pos, lead.pos).toFixed(1) : null, seen: sees(p.position, lead) };
          if (prevState === 'wary' && !r.relaxed) { r.relaxed = { t: +t.toFixed(2), state: s, after: +(t - r.stop.t).toFixed(1) }; afterRelax = true; goal0 = lead.goalSpot; }
          prevState = s;
        }
        // the next place it chooses once calm again (a new grazing place, or on grazing where it stands): away from the
        // player and from where he startled it; there it finishes the grazing the flight broke off
        if (afterRelax && !r.goal && lead.goalSpot && lead.goalSpot !== goal0 && v.scare) r.goal = { dPlayer: +flat(lead.goalSpot, p.position).toFixed(1), dScare: +flat(lead.goalSpot, v.scare).toFixed(1), at: [+lead.goalSpot.x.toFixed(1), +lead.goalSpot.z.toFixed(1)], t: +t.toFixed(1), state: s };
        if (afterRelax && r.resume != null && r.grazeNew == null && lead.resume == null && (s === 'graze' || s === 'feed')) { r.grazeNew = +(s === 'feed' ? lead.feedFor : lead.grazeFor).toFixed(1); r.grazeAt = +t.toFixed(1); }
        if (s === 'flee' && r.stop == null) {
          const g = gaitOf(lead);
          if (r.gaits[r.gaits.length - 1] !== g) r.gaits.push(g);
          if (lead.speed > r.maxSpeed) { r.maxSpeed = +lead.speed.toFixed(2); r.gaitAtMax = g; }
          r.gallopMax = Math.max(r.gallopMax, +lead.P.gallop.toFixed(2));   // (the gallop pose: it must stay below 0.5)
          if (follow && !follow.gone) { const fd = flat(follow.pos, lead.pos); if (fd > r.fawnMax) r.fawnMax = +fd.toFixed(1); r.fawnSpeed = Math.max(r.fawnSpeed, +follow.speed.toFixed(2)); r.fawnGallopMax = Math.max(r.fawnGallopMax, +follow.P.gallop.toFixed(2)); }
          r.dMax = Math.max(r.dMax || 0, +d.toFixed(1));
        }
        r.sitMax = Math.max(r.sitMax, +lead.P.sit.toFixed(2));
        if (s === 'wary') r.waryLen = +(t - r.stop.t).toFixed(1);
        r.flights = Math.max(r.flights, v.flights?.length || 0);
        if (fleeT != null && t - fleeT >= 60 && r.outAt60 == null) r.outAt60 = { animals: W.beasts.length, leaving: !!v.leaving };
        if (v.leaving && !r.left) r.left = { t: +t.toFixed(1), leftFor: v.leftFor || null, spots: v.spots, d: +d.toFixed(1), sinceFlee: fleeT == null ? null : +(t - fleeT).toFixed(1) };
        for (const b of W.beasts) if (W.obstacleAt(b.pos.x, b.pos.z) && r.inObstacle.length < 8) r.inObstacle.push(`${b.kind}:${b.state}@${b.pos.x.toFixed(1)},${b.pos.z.toFixed(1)}`);
        if (!W.beasts.length) { r.gone = +t.toFixed(1); break; }
        if (o.until === 'calm' && r.relaxed && t > r.relaxed.t + 1) break;
        if (o.until === 'graze' && r.first.alert != null && s === 'graze' && t > r.first.alert + 1) { r.grazedAgain = +t.toFixed(1); break; }
      }
      r.alertD = alertD; r.fleeD = fleeD; r.walk = lead.walk; r.trot = lead.trotSpeed; r.gallop = lead.gallopSpeed; r.secs = +t.toFixed(1); r.planMs = +(W.planMs || 0).toFixed(2); r.updateMax = +r.updateMax.toFixed(2);
      p.keys.clear(); W.sitOverride = null;
      return r;
    };
  });
  const runs = [];
  const run = async (o) => { const r = await page.evaluate((o) => window.__flRun(o), o); runs.push(r); return r; };

  // ---------------------------------------------------------------- a doe with her fawn ------------------------------
  if (want('doe')) {
    const doe = await run({ kind: 'fawn', at: [6, 32], from: [0.6, 12], maxT: 900 });
    console.log('DOE ' + JSON.stringify(doe));
    check('a grazing doe looks up when the player walks out towards her, then runs off', doe.first.alert != null && doe.first.flee != null && doe.first.alert < doe.first.flee && doe.fleeAt.d < 15, { alert: doe.first.alert, flee: doe.first.flee, at: doe.fleeAt });
    check('she trots off briskly: quicker than her ordinary trot, never a gallop (3.0 to 4.2 m/s, the gallop pose below 0.5, the fawn too)', doe.gaitAtMax === 'trot' && !doe.gaits.includes('gallop') && doe.maxSpeed >= 3.0 && doe.maxSpeed <= 4.2 && doe.gallopMax < 0.5 && doe.fawnGallopMax < 0.5, { maxSpeed: doe.maxSpeed, gait: doe.gaitAtMax, gaits: doe.gaits, walk: doe.walk, trot: doe.trot, gallopPose: doe.gallopMax, fawn: { speed: doe.fawnSpeed, gallopPose: doe.fawnGallopMax } });
    check('then she slows to a walk and stops 16 to 24 m from him, a few seconds after she set off', doe.stop && doe.stop.d >= 15 && doe.stop.d <= 26 && doe.gaits.join(',').includes('trot,walk') && doe.stop.t - doe.first.flee >= 2.5 && doe.stop.t - doe.first.flee <= 12, { stop: doe.stop, gaits: doe.gaits, flightSecs: doe.stop && +(doe.stop.t - doe.first.flee).toFixed(1) });
    check('she stops where the player can still see her (a ray from his eye to her body or head is clear of the ground, the trees and the house)', doe.stop?.seen === true, doe.stop);
    check('the fawn runs with her mother and stays close (within 6 m on the run, beside her when she stops)', doe.fawnMax > 0 && doe.fawnMax <= 6 && doe.stop?.fawn != null && doe.stop.fawn <= 5, { onTheRun: doe.fawnMax, atTheStop: doe.stop?.fawn });
    check('she watches him a while and calms down: grazing or walking again within half a minute', doe.relaxed && ['graze', 'walk', 'look'].includes(doe.relaxed.state) && doe.relaxed.after >= 4 && doe.relaxed.after <= 30, doe.relaxed);
    check('her visit goes on: a minute after the flight she is still in the garden, not on her way home', doe.outAt60 && doe.outAt60.animals === 2 && !doe.outAt60.leaving, doe.outAt60);
    // (the new grazing place lies at least her alert distance from him, since she stopped inside it, and no nearer to
    // where he startled her than her stop, 12 m at least: she does not go back there)
    check('she takes another route: her next place lies away from the player and from where he startled her', doe.goal && doe.goal.dPlayer >= doe.alertD && doe.goal.dScare >= 12 && doe.goal.dScare >= doe.stop.scare - 2, { goal: doe.goal, stop: doe.stop });
    check('there she finishes the grazing the flight broke off, and she leaves only when her visit is over (all its places grazed)', doe.resume > 0 && doe.grazeNew != null && Math.abs(doe.grazeNew - doe.resume) < 0.2 && doe.left?.leftFor === 'done' && doe.left.spots === 0 && doe.gone != null, { resume: doe.resume, grazeNew: doe.grazeNew, left: doe.left, gone: doe.gone });
    check('nobody passes through an obstacle (trees, the lake, the house, the feeding station, the fence)', doe.inObstacle.length === 0, doe.inObstacle);
    check('the flight and the new place are planned without a long frame (each plan under 6 ms, no step of the animals over 10 ms)', doe.planMs < 6 && doe.updateMax < 10, { plan: doe.planMs, bolt: doe.fleeMs, worstStep: doe.updateMax });
  }

  // ---------------------------------------------------------------- not too close ---------------------------------------
  if (want('alert')) {
    const al = await run({ kind: 'fawn', at: [6, 36], from: [1, 8], stopAt: 18, until: 'graze', maxT: 90, track: true });
    console.log('ALERT ' + JSON.stringify(al));
    check('walked up to but not too close, a doe looks up, takes a few steps away (no flight), and grazes again once he stands still', al.first.alert != null && !al.states.includes('flee') && al.stepAway >= 2 && al.stepAway <= 7 && al.grazedAgain != null && al.grazedAgain - (al.stoppedAt ?? 0) < 25, { states: al.states, stepAway: al.stepAway, stopped: al.stoppedAt, grazedAgain: al.grazedAgain });
  }

  // ---------------------------------------------------------------- a stag ---------------------------------------------
  if (want('stag')) {
    const walked = await run({ kind: 'stag', at: [8, 36], from: [2, 13], until: 'calm', maxT: 120 });
    console.log('STAG-WALK ' + JSON.stringify(walked));
    const ran = await run({ kind: 'stag', at: [8, 36], from: [2, 13], run: true, until: 'calm', maxT: 120 });
    console.log('STAG-RUN ' + JSON.stringify(ran));
    check('a stag trots off briskly whether the player walks up to it or runs at it: 3.3 to 4.2 m/s, never a gallop', [walked, ran].every((s) => s.first.flee != null && s.gaitAtMax === 'trot' && !s.gaits.includes('gallop') && s.gallopMax < 0.5 && s.maxSpeed >= 3.3 && s.maxSpeed <= 4.2), { walked: [walked.maxSpeed, walked.gaits, walked.gallopMax], ran: [ran.maxSpeed, ran.gaits, ran.gallopMax] });
    check('both stop 18 to 26 m from him and calm down', [walked, ran].every((s) => s.stop && s.stop.d >= 17 && s.stop.d <= 28 && s.relaxed && s.inObstacle.length === 0), [walked.stop, ran.stop, walked.relaxed, ran.relaxed]);
  }

  // ---------------------------------------------------------------- a fox -----------------------------------------------
  if (want('fox')) {
    const fox = await run({ kind: 'fox', at: [-2, 30], from: [0, 12], sit: 1, until: 'calm', maxT: 120 });
    console.log('FOX ' + JSON.stringify(fox));
    check('a fox trots off quickly (faster than its usual trot, never a gallop) and stops 12 to 18 m from him', fox.gaitAtMax === 'trot' && !fox.gaits.includes('gallop') && fox.maxSpeed > fox.trot * 1.2 && fox.maxSpeed <= 3.5 && fox.stop && fox.stop.d >= 11 && fox.stop.d <= 20, { maxSpeed: fox.maxSpeed, trot: fox.trot, gaits: fox.gaits, stop: fox.stop });
    check('it calms down sooner than a deer and may sit down to watch the player', fox.sitMax > 0.9 && fox.waryLen <= 8 && fox.relaxed != null, { sit: fox.sitMax, watched: fox.waryLen, relaxed: fox.relaxed });
  }

  // ---------------------------------------------------------------- the feeding station --------------------------------
  if (want('feeder')) {
    const fd = await run({ kind: 'fawn', stage: 'feeder', from: [12, 15], maxT: 900 });
    console.log('FEEDER ' + JSON.stringify(fd));
    check('a doe eating at the rack trots off as well when the player walks up (no gallop), the fawn with her, and stops 16 to 24 m from him', fd.first.flee != null && fd.gaitAtMax === 'trot' && fd.gallopMax < 0.5 && fd.fawnGallopMax < 0.5 && fd.maxSpeed <= 4.2 && fd.stop && fd.stop.d >= 15 && fd.stop.d <= 26 && fd.fawnMax <= 6 && fd.inObstacle.length === 0, { flee: fd.first.flee, at: fd.fleeAt, maxSpeed: fd.maxSpeed, gallopPose: [fd.gallopMax, fd.fawnGallopMax], stop: fd.stop, fawn: fd.fawnMax, obstacles: fd.inObstacle });
    check('while he stands by the rack she grazes elsewhere instead of going back to it, and her visit goes on', fd.goal && fd.goal.dScare >= 12 && fd.goal.dPlayer >= fd.alertD && fd.outAt60 && !fd.outAt60.leaving, { goal: fd.goal, outAt60: fd.outAt60, left: fd.left });
  }

  // ---------------------------------------------------------------- chased -----------------------------------------------
  if (want('chase')) {
    const ch = await run({ kind: 'fawn', at: [6, 34], from: [2, 14], chase: true, maxT: 400 });
    console.log('CHASE ' + JSON.stringify(ch));
    const herd = await run({ kind: 'fawn', at: [8, 34], from: [3, 16], herd: true, maxT: 300, track: true });
    console.log('HERD ' + JSON.stringify(herd));
    check('made to run a third time within five minutes, the group gives up its visit and leaves for the wood at a run (and is gone)', herd.flights >= 3 && herd.left?.leftFor === 'chased' && herd.left.sinceFlee < 300 && herd.gone != null && herd.inObstacle.length === 0, { flights: herd.flights, herded: herd.herded, left: herd.left, gone: herd.gone, states: herd.states.slice(0, 16) });
    check('driven to the edge of the wood, the group runs a few times and then leaves early for the wood (and is gone)', ch.flights >= 2 && ['chased', 'cornered'].includes(ch.left?.leftFor) && (ch.left.leftFor === 'cornered' || ch.flights >= 3) && ch.gone != null && ch.left.sinceFlee < 300 && ch.inObstacle.length === 0, { flights: ch.flights, left: ch.left, gone: ch.gone, states: ch.states.slice(0, 20) });
  }

  // ---------------------------------------------------------------- on its way home ---------------------------------------
  if (want('home')) {
    const home = await run({ kind: 'roe', at: [10, 40], from: [6, 20], home: true, maxT: 120 });
    console.log('HOME ' + JSON.stringify(home));
    check('a doe on her way home that the player comes close to hurries off into the wood (at a run) and is gone', home.homeState === 'leave' && home.first.flee != null && home.maxSpeed > home.trot && home.gone != null && home.inObstacle.length === 0, { home: home.homeState, states: home.states, maxSpeed: home.maxSpeed, gone: home.gone });
  }

  // ---------------------------------------------------------------- the hide ---------------------------------------------
  if (want('hide')) {
    const hide = await page.evaluate(() => {
      const w = window.__app.world, W = w.wildlife, p = w.player, F = w.env.garden.outdoor.feeder, seat = w.seats.get('feederhide');
      W.enabled = true; W.clear(); W.wait = 1e6;
      p.transition = null; p.setPose(seat.standPos.x, seat.standPos.z, seat.standYaw, 0); w.actions.sit('feederhide');
      for (let i = 0; i < 60; i++) p.update(0.05);
      // a doe grazes past the hide, a few metres in front of it
      const a = W.spawn('roe', { x: F.hide.x - 4, z: F.hide.z + 7, yaw: 2 })[0];
      const states = new Set(); let near = Infinity;
      for (let i = 0; i < 600; i++) { p.update(0.05); W.update(0.05, false); states.add(a.state); near = Math.min(near, Math.hypot(a.pos.x - p.position.x, a.pos.z - p.position.z)); }
      w.actions.leaveSeat(); W.clear();
      return { seated: true, states: [...states], near: +near.toFixed(1) };
    });
    check('sitting still in the hide the player bothers nobody: a doe grazing a few metres away neither looks up nor runs', !hide.states.includes('alert') && !hide.states.includes('flee') && hide.near < 14, hide);
  }

  // ---------------------------------------------------------------- shader programs --------------------------------------
  if (want('programs')) {
    const prog = await page.evaluate(async () => {
      const w = window.__app.world, W = w.wildlife, p = w.player;
      W.enabled = true; W.clear(); W.wait = 1e6;
      p.transition = null; p.setPose(0.6, 13.8, Math.PI, -0.04);
      W.spawn('roe', { x: -2, z: 24, yaw: 0.6, hold: true, pose: 'stand', mother: false });
      for (let i = 0; i < 20; i++) { W.update(0.05); w.frame(); await new Promise((r) => setTimeout(r, 20)); }
      const before = w.renderer.info.programs.length;
      W.clear();
      W.spawn('roe', { x: -2, z: 24, yaw: 0.6, hold: true, pose: 'gallop', mother: false });
      W.spawn('stag', { x: 4, z: 28, yaw: -0.6, hold: true, pose: 'gallop' });
      W.spawn('fox', { x: 1, z: 21, yaw: 2.6, hold: true, pose: 'sit' });
      for (let i = 0; i < 40; i++) { W.update(0.05); w.frame(); await new Promise((r) => setTimeout(r, 20)); }
      const after = w.renderer.info.programs.length, sit = +W.beasts.find((b) => b.kind === 'fox').P.sit.toFixed(2);
      W.clear();
      return { before, after, sit };
    });
    check('no new shader program for the gallop and the sitting fox (the same material, only the bones move)', prog.after === prog.before && prog.sit > 0.9, prog);
  }

  // ---------------------------------------------------------------- pictures --------------------------------------------
  if (want('shots') && process.env.FL_SHOTS !== 'none') {
    const only = process.env.FL_SHOTS ? process.env.FL_SHOTS.split(',') : null;
    await page.evaluate(() => document.querySelector('#hud')?.style.setProperty('opacity', '0'));
    // a scene: the player walks up to `kind` at `at` from `from` (posed every step) until `moment` holds for the leader;
    // then everything stands still and the picture is taken from the player's eye, or from `view` [x, z] (a second
    // visitor's place) looking at the leader
    const scene = async (name, hour, o) => {
      if (only && !only.includes(name)) return;
      await setTime(hour);
      const info = await page.evaluate(async ([o]) => {
        const w = window.__app.world, W = w.wildlife, p = w.player;
        W.enabled = true; W.clear(); W.wait = 1e6; W.sitOverride = o.sit ?? null;
        const group = W.spawn(o.kind, { x: o.at[0], z: o.at[1], yaw: o.yaw ?? 2.5 });
        const lead = group.find((b) => !b.lead);
        const yawTo = (q) => Math.atan2(-(q.x - p.position.x), -(q.z - p.position.z));
        p.transition = null; p.setPose(o.from[0], o.from[1], yawTo(lead.pos), 0); p.keys.clear(); p.keys.add('KeyW'); if (o.run) p.keys.add('ShiftLeft');
        const test = new Function('b', 'd', 'return ' + o.moment);
        let ok = false;
        for (let i = 0; i < 20 * 120; i++) {
          if (lead.state === 'flee' && !o.keep) p.keys.clear();
          if (p.keys.size) p.yaw = yawTo(lead.pos);
          p.update(0.05); W.update(0.05, true);
          if (test(lead, Math.hypot(lead.pos.x - p.position.x, lead.pos.z - p.position.z))) { ok = true; break; }
        }
        p.keys.clear();
        // the view: from the player's eye, or from another place a visitor stands
        const eye = o.view ? { x: o.view[0], z: o.view[1] } : p.position;
        if (o.view) { p.transition = null; p.setPose(o.view[0], o.view[1], 0, 0); }
        const ty = lead.pos.y + lead.A.legLen[0] * lead.scale * 0.9, dist = Math.hypot(lead.pos.x - eye.x, lead.pos.z - eye.z);
        p.yaw = Math.atan2(-(lead.pos.x - eye.x), -(lead.pos.z - eye.z)) + (o.yawOff || 0);
        p.pitch = Math.atan2(ty - (w.player.position.y), dist) + (o.pitchOff || 0);
        W.enabled = false;   // everything holds still for the picture
        // (zoomed in as with the controller's trigger: the window of the checks is smaller than a screen)
        p.zoom = o.zoom || 1; w.camera.fov = p.fov / p.zoom; w.camera.updateProjectionMatrix();
        p.update(0);
        return { ok, state: lead.state, speed: +lead.speed.toFixed(2), gait: lead.P.gallop > 0.5 ? 'gallop' : lead.P.trot > 0.5 ? 'trot' : 'walk/stand', phase: +lead.P.phase.toFixed(2), dist: +dist.toFixed(1), at: [+lead.pos.x.toFixed(1), +lead.pos.z.toFixed(1)] };
      }, [o]);
      for (let i = 0; i < 14; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(30); }
      await shot(`${tag}-${name}`);
      await page.evaluate(() => { const w = window.__app.world, W = w.wildlife; W.enabled = true; W.sitOverride = null; W.clear(); w.player.zoom = 1; w.camera.fov = w.player.fov; w.camera.updateProjectionMatrix(); });
      console.log('SHOT ' + name + ' ' + JSON.stringify(info));
    };
    // the brisk trot (the legs of a diagonal pair at full reach), from the player who startled her, and from the path
    // as she crosses the meadow with her fawn
    await scene('trot-behind', 11, { kind: 'fawn', at: [6, 30], from: [1, 12], zoom: 3.5, moment: "b.state === 'flee' && b.P.trot > 0.9 && b.speed > 3 && d > 15 && b.P.phase > 0.7 && b.P.phase < 0.8" });
    await scene('trot-side', 11, { kind: 'fawn', at: [13, 28], yaw: 1, from: [6, 15], view: [-3.5, 26], zoom: 3, moment: "b.state === 'flee' && b.P.trot > 0.9 && b.speed > 3 && b.P.phase > 0.7 && b.P.phase < 0.8 && b.pos.z > 29" });
    // the calm: she stands half turned and looks back at the player, later she grazes again
    await scene('calm-watch', 11, { kind: 'fawn', at: [6, 32], from: [0.6, 12], zoom: 4, moment: "b.state === 'wary' && b.stateT > 3" });
    await scene('calm-graze', 11, { kind: 'fawn', at: [6, 32], from: [0.6, 12], zoom: 4, moment: "b.state === 'graze' && b.extra && b.stateT > 3" });
    await scene('stag-trot', 16, { kind: 'stag', at: [8, 34], from: [2, 13], run: true, zoom: 2.5, moment: "b.state === 'flee' && b.P.trot > 0.9 && b.speed > 3.3 && b.P.phase > 0.7 && b.P.phase < 0.8" });
    await scene('fox-sit', 18.5, { kind: 'fox', at: [-2, 30], from: [0, 12], sit: 1, zoom: 4, moment: "b.state === 'wary' && b.P.sit > 0.95" });
  }
  if (runs.length) check('in every scene the flights and new places are planned in under 6 ms, and no step of the animals takes over 10 ms', runs.every((r) => r.planMs < 6 && r.updateMax < 10), runs.map((r) => `${r.kind}:${r.planMs}/${r.updateMax}`));
  check('no errors on the page', errors.length === 0, errors.slice(0, 5));
  console.log(`FLEE-CHECK ${failures ? 'FAILED ' + failures : 'OK'}`);
};
