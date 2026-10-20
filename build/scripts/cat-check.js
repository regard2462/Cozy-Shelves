// The library cat: its routes never cross furniture or leave the building, every seat is reached (or the cat
// stays put when it cannot be), also with random furniture added, a standing player is walked round, petting works
// (crosshair ring, E, reaction, purring), also from a seat, not with the cat switched off, and again after a rebuild, and the
// cat costs at most 8 draw calls and 14 000 triangles. The model: the eyes close in its sleep and blink now and then
// while it is awake, the belly sags when it sits, the tail is one unbroken chain in every pose, the fur atlas has a
// dark back, a light underside and the white spot. CATPERF: the median frame time with and without the cat.
// Screenshots: walking, jumping, sitting, sleeping, petted (on a seat, on the floor, from the sofa), face close-up.
// SHOT_TAG prefixes the names. GPU=1 is much faster than SwiftShader here.
module.exports = async ({ page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || '';
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  await sleep(1200);
  // wait (up to 90 s) until the library is indexed and shelved: a rebuild in the middle replaces the cat (the new one
  // carries on where the old one was, but the timing of the screenshots below would be off)
  let quiet = 0, lastCat = null;
  for (let i = 0; i < 45 && quiet < 3; i++) {
    const st = await page.evaluate(() => {
      const w = window.__app.world; if (w.cat && !w.cat.__probe) w.cat.__probe = Math.random();
      return { n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active, hud: document.querySelector('#scan-status')?.textContent || '', cat: w.cat?.__probe };
    });
    quiet = !st.active && !st.hud && st.n > 0 && st.cat === lastCat ? quiet + 1 : 0;
    lastCat = st.cat;
    await sleep(2000);
  }
  let failures = 0;
  const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); if (!ok) failures++; };
  const frames = async (n = 8) => { for (let i = 0; i < n; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(40); } };

  // helpers inside the page: aim the (standing) player at a point, run the look ray, record sounds and purring
  await page.evaluate(() => {
    const w = window.__app.world;
    window.__cat = {
      log: { sfx: [], purr: [] },
      aim(x, z, tx, ty, tz, eyeY) {
        const p = w.player; p.transition = null;
        p.setPose(x, z, Math.atan2(-(tx - x), -(tz - z)), Math.atan2(ty - (eyeY ?? 1.62), Math.hypot(tx - x, tz - z)));
        if (eyeY != null) p.position.y = eyeY;
        w.frame(); w.frame();
        w.actions.rayTimer = 0; w.actions.update(0.001);
        return w.actions.target;
      },
      pickCenter() { const v = w.cat.pick.position.clone(); w.cat.group.updateMatrixWorld(true); return w.cat.group.localToWorld(v); },
      // a spot on the floor n metres from the cat, away from its seat (along seat → landing)
      standOff(n) { const c = w.cat, s = c.spots[c.spot]; const d = s.landing.clone().sub(s.position).setY(0).normalize(); return c.group.position.clone().addScaledVector(d, n); },
    };
    const oS = w.opts.onSfx, oP = w.opts.onPurr;
    w.opts.onSfx = (n) => { window.__cat.log.sfx.push(n); oS?.(n); };
    w.opts.onPurr = (on) => { window.__cat.log.purr.push(on); oP?.(on); };
  });

  // ---------------------------------------------------------------- the grid and the landing places ----
  const nav = await page.evaluate(() => {
    const c = window.__app.world.cat, n = c.nav;
    let free = 0; for (const b of n.blocked) if (!b) free++;
    return {
      grid: [n.w, n.h], cell: n.cell, radius: n.radius, obstacles: n.obstacles.length, free, regions: n.regions,
      spots: c.spots.map((s) => ({ id: s.id, landing: s.landing && [+s.landing.x.toFixed(2), +s.landing.z.toFixed(2)], hop: s.landing ? +Math.hypot(s.landing.x - s.position.x, s.landing.z - s.position.z).toFixed(2) : null })),
    };
  });
  console.log('NAV ' + JSON.stringify(nav));
  check('every cat spot has a landing place', nav.spots.length > 1 && nav.spots.every((s) => s.landing), nav.spots.map((s) => s.id + ':' + s.hop));

  // ---------------------------------------------------------------- walks between every pair of seats ----
  const walks = await page.evaluate(() => {
    const w = window.__app.world, cat = w.cat, nav = cat.nav;
    const floors = w.layout.floors.map((f) => [f.x - f.w / 2, f.z - f.d / 2, f.x + f.w / 2, f.z + f.d / 2]);
    const onFloor = (x, z) => floors.some((f) => x >= f[0] - 1e-6 && x <= f[2] + 1e-6 && z >= f[1] - 1e-6 && z <= f[3] + 1e-6);
    const R = 0.2, EPS = 1e-6;
    const obst = w.colliders.filter((c) => c.max[1] > 0.04 && c.min[1] < 0.42);   // everything standing on the floor
    const dist = (c, x, z) => Math.hypot(Math.max(c.min[0] - x, 0, x - c.max[0]), Math.max(c.min[2] - z, 0, z - c.max[2]));
    const far = cat.group.position.clone().set(100, 1.62, 100);
    const FLOOR = new Set(['walk', 'wait', 'linger', 'prep']);
    const AT_SEAT = new Set(['sleep', 'sit', 'rise', 'settle', 'hopdown', 'hopup', 'pet']);
    const out = { results: [], steps: 0, overlaps: 0, outside: 0, blockedCells: 0, headRump: 0, maxPen: 0, samples: [], states: {} };
    for (let a = 0; a < cat.spots.length; a++) for (let b = 0; b < cat.spots.length; b++) {
      if (a === b) continue;
      cat.goTo(a, true); cat.nextMove = 1e9;   // only the forced trips, no wandering of its own
      const ok = cat.goTo(b);
      const res = { a, b, ok, arrived: false };
      if (!ok) { out.results.push(res); continue; }
      res.routeFree = nav.polylineFree(cat.route); res.pts = cat.route.length;
      const sa = cat.spots[a].position, sb = cat.spots[b].position;
      // the colliders the resting cat already touches on either seat (its own seat)
      const own = obst.filter((c) => dist(c, sa.x, sa.z) < R || dist(c, sb.x, sb.z) < R);
      const last = cat.group.position.clone(); let len = 0, maxY = 0;
      for (let i = 0; i < 6000; i++) {
        cat.update(0.05, far, false); out.steps++;
        const p = cat.group.position, st = cat.state;
        out.states[st] = (out.states[st] || 0) + 1;
        len += Math.hypot(p.x - last.x, p.z - last.z); last.copy(p); maxY = Math.max(maxY, p.y);
        // inside the building: the centre and the whole body circle on the floor
        let inside = onFloor(p.x, p.z);
        for (let k = 0; k < 8 && inside; k++) { const an = k * Math.PI / 4; inside = onFloor(p.x + Math.cos(an) * R, p.z + Math.sin(an) * R); }
        if (!inside) { out.outside++; if (out.samples.length < 10) out.samples.push(['outside', a, b, st, +p.x.toFixed(2), +p.z.toFixed(2)]); }
        // the body circle against every collider on the floor
        for (const c of obst) {
          const d = dist(c, p.x, p.z);
          if (d >= R - EPS) continue;
          if (AT_SEAT.has(st) && own.includes(c)) continue;   // on its own seat, or jumping off / onto it
          if (p.y >= c.max[1]) continue;                       // above it
          out.overlaps++; out.maxPen = Math.max(out.maxPen, R - d);
          if (out.samples.length < 10) out.samples.push(['overlap', a, b, st, +p.x.toFixed(2), +p.z.toFixed(2), +p.y.toFixed(2), c.min.map((v) => +v.toFixed(2)), c.max.map((v) => +v.toFixed(2))]);
        }
        if (FLOOR.has(st) && !nav.freeAt(p.x, p.z)) out.blockedCells++;   // on the floor it only ever stands in free cells
        if (st === 'walk' || st === 'wait') {
          // head and rump (secondary): no other collider within 4 cm of them either
          const fx = Math.cos(cat.yaw), fz = -Math.sin(cat.yaw);
          for (const [ox, oz] of [[fx * 0.33, fz * 0.33], [-fx * 0.26, -fz * 0.26]]) if (obst.some((c) => !own.includes(c) && dist(c, p.x + ox, p.z + oz) < 0.04)) out.headRump++;
        }
        if (st === 'sleep' && cat.onSpot && cat.spot === b) { res.arrived = true; res.t = +(i * 0.05).toFixed(1); break; }
      }
      res.end = +cat.group.position.distanceTo(sb).toFixed(3); res.len = +len.toFixed(1); res.maxY = +maxY.toFixed(2);
      out.results.push(res);
    }
    out.maxPen = +out.maxPen.toFixed(3);
    return out;
  });
  console.log('WALKS ' + JSON.stringify({ steps: walks.steps, overlaps: walks.overlaps, outside: walks.outside, blockedCells: walks.blockedCells, headRump: walks.headRump, maxPen: walks.maxPen, states: walks.states }));
  for (const r of walks.results) console.log('  ' + JSON.stringify(r));
  if (walks.samples.length) console.log('SAMPLES ' + JSON.stringify(walks.samples));
  check('all trips start, follow free cells and arrive on the seat', walks.results.every((r) => r.ok && r.routeFree && r.arrived && r.end < 0.01), walks.results.length);
  check('the body circle never overlaps a floor-standing collider', walks.overlaps === 0, { overlaps: walks.overlaps, maxPen: walks.maxPen });
  check('the cat never leaves the building', walks.outside === 0, walks.outside);
  check('on the floor it only stands in free grid cells', walks.blockedCells === 0, walks.blockedCells);
  check('head and rump keep clear of colliders on the floor', walks.headRump === 0, walks.headRump);

  // ---------------------------------------------------------------- an unreachable seat: stay put ----
  const unreach = await page.evaluate(() => {
    const w = window.__app.world, cat0 = w.cat;
    const s = cat0.spots[1], own = s.own[0];
    // a low fence 0.5 m round that seat's collider
    const m = 0.5, lo = [own.min[0] - m, own.min[2] - m], hi = [own.max[0] + m, own.max[2] + m];
    const wall = (x0, z0, x1, z1) => ({ min: [x0, 0, z0], max: [x1, 1.2, z1] });
    const ring = [wall(lo[0] - 0.1, lo[1] - 0.1, hi[0] + 0.1, lo[1]), wall(lo[0] - 0.1, hi[1], hi[0] + 0.1, hi[1] + 0.1), wall(lo[0] - 0.1, lo[1], lo[0], hi[1]), wall(hi[0], lo[1], hi[0] + 0.1, hi[1])];
    const spots = cat0.spots.map((x) => ({ id: x.id, position: x.position.clone(), yaw: x.yaw }));
    const t0 = performance.now();
    const c2 = new cat0.constructor(spots, null, { colliders: [...w.colliders, ...ring], floors: w.layout.floors, props: w.static.children });
    const buildMs = +(performance.now() - t0).toFixed(1);
    const far = c2.group.position.clone().set(100, 1.62, 100);
    const out = { buildMs, landings: c2.spots.map((x) => !!x.landing) };
    c2.goTo(0, true);
    out.toFenced = c2.goTo(1);
    const p0 = c2.group.position.clone();
    for (let i = 0; i < 200; i++) c2.update(0.05, far);
    out.stayed = c2.group.position.distanceTo(p0) < 1e-9 && c2.onSpot && c2.spot === 0;
    c2.goTo(1, true);
    out.fromFenced = c2.goTo(0);
    const p1 = c2.group.position.clone();
    c2.nextMove = 0;                      // it wants to wander, but there is no way out
    for (let i = 0; i < 200; i++) c2.update(0.05, far);
    out.stayed2 = c2.group.position.distanceTo(p1) < 1e-9 && c2.state === 'sleep';
    c2.dispose();
    return out;
  });
  console.log('UNREACHABLE ' + JSON.stringify(unreach));
  check('a fenced-in seat is never set out for and the cat stays put', !unreach.toFenced && unreach.stayed && !unreach.fromFenced && unreach.stayed2);

  // ---------------------------------------------------------------- other layouts: random furniture ----
  // The layout keeps changing, so the same trips run with 30 random boxes on the floors (seeded), and once
  // without the floor rectangles (walls only). Every trip either arrives cleanly or is refused and the cat stays.
  const fuzz = await page.evaluate(() => {
    const w = window.__app.world, cat0 = w.cat;
    const R = 0.2, EPS = 1e-6;
    const dist = (c, x, z) => Math.hypot(Math.max(c.min[0] - x, 0, x - c.max[0]), Math.max(c.min[2] - z, 0, z - c.max[2]));
    const floorsL = w.layout.floors;
    const floors = floorsL.map((f) => [f.x - f.w / 2, f.z - f.d / 2, f.x + f.w / 2, f.z + f.d / 2]);
    const onFloor = (x, z) => floors.some((f) => x >= f[0] - 1e-6 && x <= f[2] + 1e-6 && z >= f[1] - 1e-6 && z <= f[3] + 1e-6);
    const AT_SEAT = new Set(['sleep', 'sit', 'rise', 'settle', 'hopdown', 'hopup', 'pet']);
    const runs = [];
    for (let seed = 1; seed <= 8; seed++) {
      let a = seed * 9973; const rnd = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
      const extra = [];
      const noFloors = seed === 7;
      if (seed === 8) {   // a wall right across the smallest floor (the passage): the building falls apart in two
        const f = [...floorsL].sort((p, q) => p.w * p.d - q.w * q.d)[0];
        extra.push(f.w < f.d ? { min: [f.x - f.w / 2 - 0.5, 0, f.z - 0.15], max: [f.x + f.w / 2 + 0.5, 2, f.z + 0.15] } : { min: [f.x - 0.15, 0, f.z - f.d / 2 - 0.5], max: [f.x + 0.15, 2, f.z + f.d / 2 + 0.5] });
      }
      const total = floorsL.reduce((sum, f) => sum + f.w * f.d, 0);
      if (!noFloors && seed < 8) for (let k = 0; k < 30; k++) {
        let pick = rnd() * total, f = floorsL[0];
        for (const g of floorsL) { f = g; pick -= g.w * g.d; if (pick <= 0) break; }   // evenly over the floor area
        const x = f.x - f.w / 2 + rnd() * f.w, z = f.z - f.d / 2 + rnd() * f.d, bw = 0.3 + rnd() * 0.9, bd = 0.3 + rnd() * 0.9, h = 0.3 + rnd() * 1.2;
        extra.push({ min: [x - bw / 2, 0, z - bd / 2], max: [x + bw / 2, h, z + bd / 2] });
      }
      const colliders = [...w.colliders, ...extra];
      const obst = colliders.filter((c) => c.max[1] > 0.04 && c.min[1] < 0.42);
      const spots = cat0.spots.map((s) => ({ id: s.id, position: s.position.clone(), yaw: s.yaw }));
      const cat = new cat0.constructor(spots, null, { colliders, floors: noFloors ? null : floorsL });
      const far = cat.group.position.clone().set(100, 1.62, 100);
      const run = { seed, noFloors, landings: cat.spots.filter((s) => s.landing).length, trips: 0, refused: 0, arrived: 0, stuck: 0, stayedBad: 0, overlaps: 0, outside: 0, blocked: 0 };
      for (let i = 0; i < spots.length; i++) for (let j = 0; j < spots.length; j++) {
        if (i === j) continue;
        cat.goTo(i, true); cat.nextMove = 1e9;
        const p0 = cat.group.position.clone();
        if (!cat.goTo(j)) {
          run.refused++;
          for (let k = 0; k < 60; k++) cat.update(0.05, far);
          if (cat.group.position.distanceTo(p0) > 1e-9) run.stayedBad++;
          continue;
        }
        run.trips++;
        const si = spots[i].position, sj = spots[j].position;
        const own = obst.filter((c) => dist(c, si.x, si.z) < R || dist(c, sj.x, sj.z) < R);
        let done = false;
        for (let k = 0; k < 8000 && !done; k++) {
          cat.update(0.05, far);
          const p = cat.group.position, st = cat.state;
          if (!noFloors && !onFloor(p.x, p.z)) run.outside++;
          for (const c of obst) {
            if (dist(c, p.x, p.z) >= R - EPS || (AT_SEAT.has(st) && own.includes(c)) || p.y >= c.max[1]) continue;
            run.overlaps++;
          }
          if ((st === 'walk' || st === 'prep') && !cat.nav.freeAt(p.x, p.z)) run.blocked++;
          done = st === 'sleep' && cat.onSpot && cat.spot === j;
        }
        if (done && cat.group.position.distanceTo(sj) < 0.01) run.arrived++; else run.stuck++;
      }
      cat.dispose();
      runs.push(run);
    }
    return runs;
  });
  for (const r of fuzz) console.log('FUZZ ' + JSON.stringify(r));
  const split = fuzz.find((r) => r.seed === 8);
  check('random furniture: every trip arrives or is refused (cat stays), never overlapping, never outside', fuzz.every((r) => r.stuck === 0 && r.stayedBad === 0 && r.overlaps === 0 && r.outside === 0 && r.blocked === 0) && fuzz.some((r) => r.trips > 0) && split.trips > 0 && split.refused > 0,
    fuzz.map((r) => `${r.seed}:${r.arrived}/${r.trips}+${r.refused}`));

  // ---------------------------------------------------------------- a standing player in the way ----
  const avoid = await page.evaluate(() => {
    const w = window.__app.world, cat = w.cat;
    let from = 0, to = 1, best = 0;   // the longest trip
    for (let a = 0; a < cat.spots.length; a++) for (let b = 0; b < cat.spots.length; b++) { const d = cat.spots[a].position.distanceTo(cat.spots[b].position); if (d > best) { best = d; from = a; to = b; } }
    cat.goTo(from, true); cat.nextMove = 1e9; cat.goTo(to);
    const r = cat.route; let seg = 0, pt = null;
    for (let k = 1; k < r.length; k++) { const L = r[k].distanceTo(r[k - 1]); if (L > seg) { seg = L; pt = r[k - 1].clone().lerp(r[k], 0.5); } }
    const player = pt.clone().setY(1.62);
    let minD = 99, waited = 0, arrived = false, t = 0;
    for (let i = 0; i < 9000; i++) {
      cat.update(0.05, player, false);
      const p = cat.group.position;
      if (!cat.onSpot) minD = Math.min(minD, Math.hypot(p.x - player.x, p.z - player.z));
      if (cat.state === 'wait') waited++;
      if (cat.state === 'sleep' && cat.onSpot && cat.spot === to) { arrived = true; t = +(i * 0.05).toFixed(1); break; }
    }
    return { from, to, player: [+player.x.toFixed(2), +player.z.toFixed(2)], minD: +minD.toFixed(3), waited: +(waited * 0.05).toFixed(1), arrived, t };
  });
  console.log('AVOID ' + JSON.stringify(avoid));
  check('the cat waits for or walks round a standing player and still arrives', avoid.arrived && avoid.minD >= 0.53, avoid);

  // ---------------------------------------------------------------- screenshots: walking, jumping, sitting ----
  const walkShot = await page.evaluate(() => {
    const w = window.__app.world, cat = w.cat;
    cat.goTo(0, true); cat.nextMove = 1e9;
    const ok = cat.goTo(2);
    const far = cat.group.position.clone().set(100, 1.62, 100);
    for (let i = 0; i < 400 && !(cat.state === 'walk' && cat.stateT > 1.5); i++) cat.update(0.05, far);
    cat.blinkIn = 1e9;   // no blink in the pictures
    return { ok, state: cat.state, pos: cat.group.position.toArray().map((v) => +v.toFixed(2)), yaw: cat.yaw };
  });
  // camera 1.5 m to the cat's left, eye lowered to 1.1 m for a better view
  await page.evaluate(({ yaw }) => { const w = window.__app.world, c = w.cat, p = c.group.position; const lx = -Math.sin(yaw), lz = -Math.cos(yaw); const pc = window.__cat.pickCenter(); window.__cat.aim(p.x + lx * 1.5, p.z + lz * 1.5, pc.x, pc.y, pc.z, 1.1); }, walkShot);
  await frames(4); await shot(tag + 'cat-walk');
  walkShot.after = await page.evaluate(() => window.__app.world.cat.state);
  walkShot.tail = await page.evaluate(() => { const cat = window.__app.world.cat; let worst = 0; for (let i = 0; i < 11; i++) worst = Math.max(worst, cat.tailP[i].distanceTo(cat.tailP[i + 1]) / (cat.tailR[i] + cat.tailR[i + 1])); return +worst.toFixed(2); });
  console.log('WALKSHOT ' + JSON.stringify(walkShot));
  check('walking, the tail is one unbroken chain', walkShot.tail < 1, walkShot.tail);
  // the same trip again, stopped in mid-air on the way up
  const hopShot = await page.evaluate(() => {
    const w = window.__app.world, cat = w.cat;
    cat.goTo(0, true); cat.goTo(2);
    const far = cat.group.position.clone().set(100, 1.62, 100);
    for (let i = 0; i < 2000 && cat.state !== 'hopup'; i++) cat.update(0.05, far);
    cat.update(0.05, far);
    const c = cat, s = c.spots[c.spot]; const d = s.landing.clone().sub(s.position).setY(0).normalize(); const side = { x: -d.z, z: d.x }; const pc = window.__cat.pickCenter();
    window.__cat.aim(pc.x + side.x * 1.6 + d.x * 0.6, pc.z + side.z * 1.6 + d.z * 0.6, pc.x, pc.y, pc.z, 1.2);
    return { state: cat.state, y: +cat.group.position.y.toFixed(2) };
  });
  await shot(tag + 'cat-hop');
  console.log('HOPSHOT ' + JSON.stringify(hopShot));
  // up on the seat it sits a moment: held there for the picture and the petting below
  const sitShot = await page.evaluate(() => {
    const w = window.__app.world, cat = w.cat;
    const far = cat.group.position.clone().set(100, 1.62, 100);
    for (let i = 0; i < 400 && !(cat.state === 'sit' && cat.stateT > 1.0); i++) cat.update(0.05, far);
    cat.sitFor = 1e9; cat.blinkIn = 1e9;
    return { state: cat.state, sit: +cat.pose.sit.toFixed(2) };
  });
  await page.evaluate(() => { const pc = window.__cat.pickCenter(); const o = window.__cat.standOff(1.5); window.__cat.aim(o.x, o.z, pc.x, pc.y, pc.z, 1.3); });
  await frames(4); await shot(tag + 'cat-sit');
  console.log('SITSHOT ' + JSON.stringify(sitShot));
  // an awake cat that sits on its seat stays upright while it is petted, then lies down
  const sitPet = await page.evaluate(() => {
    const w = window.__app.world, cat = w.cat, pp = w.player.position;
    const ok = cat.pet(w.camera.position);
    for (let i = 0; i < 30; i++) cat.update(0.05, pp);
    const during = { state: cat.state, sit: +cat.pose.sit.toFixed(2), lie: +cat.pose.lie.toFixed(2), eyes: +cat.pose.eyes.toFixed(2), rub: +cat.pose.rub.toFixed(2) };
    return { ok, during };
  });
  await frames(2); await shot(tag + 'cat-pet-sit');
  const sitAfter = await page.evaluate(() => {
    const w = window.__app.world, cat = w.cat, far = cat.group.position.clone().set(100, 1.62, 100);
    const seen = new Set();
    for (let i = 0; i < 400 && cat.state !== 'sleep'; i++) { cat.update(0.05, far); seen.add(cat.state); }
    return { seen: [...seen], state: cat.state };
  });
  console.log('SITPET ' + JSON.stringify({ sitPet, sitAfter }));
  check('a sitting cat stays upright while petted and lies down afterwards', sitPet.ok && sitPet.during.state === 'pet' && sitPet.during.sit > 0.9 && sitPet.during.eyes < 0.2 && sitPet.during.rub > 0.8 && sitAfter.state === 'sleep', { sitPet, sitAfter });

  // ---------------------------------------------------------------- petting a sleeping cat on its seat ----
  const aimSpot = await page.evaluate(() => {
    const w = window.__app.world, cat = w.cat;
    cat.goTo(0, true); w.frame();
    const pc = window.__cat.pickCenter(), o = window.__cat.standOff(1.1);
    const t = window.__cat.aim(o.x, o.z, pc.x, pc.y, pc.z);
    // no text pops up any more: the crosshair opens into a ring
    return { target: t && t.type + ':' + t.kind, dist: t && +t.distance.toFixed(2), hintEl: !!document.querySelector('#hint'), ring: document.querySelector('#crosshair').classList.contains('active') };
  });
  console.log('AIM ' + JSON.stringify(aimSpot));
  check('looking at the sleeping cat targets it: the crosshair ring, no hint text', aimSpot.target === 'interact:cat' && aimSpot.ring && !aimSpot.hintEl, aimSpot);
  await shot(tag + 'cat-sleep');
  // draw calls of the cat alone (main pass, the camera is on it): everything else hidden for one render
  const draw = await page.evaluate(() => {
    const w = window.__app.world, cat = w.cat, r = w.renderer;
    let meshes = 0; cat.group.traverseVisible((o) => { if (o.isMesh) meshes++; });
    const hidden = [];
    for (const o of w.scene.children) if (o !== cat.group && o.visible && !o.isLight) { o.visible = false; hidden.push(o); }
    const shadows = r.shadowMap.enabled; r.shadowMap.enabled = false;
    r.info.autoReset = false; r.info.reset(); r.render(w.scene, w.camera);
    const calls = r.info.render.calls, tris = r.info.render.triangles;
    r.info.autoReset = true; r.shadowMap.enabled = shadows;
    for (const o of hidden) o.visible = true;
    return { meshes, calls, tris, state: cat.state };
  });
  console.log('DRAWCALLS ' + JSON.stringify(draw));
  check('the cat costs at most 8 draw calls and 14 000 triangles', draw.calls > 0 && draw.calls <= 8 && draw.tris <= 14000, draw);
  // the median frame time (CPU + GPU, gl.finish) with the cat in view and with it hidden: information for the lead
  const perf = await page.evaluate(() => {
    const w = window.__app.world, gl = w.renderer.getContext();
    const run = () => { const ts = []; for (let i = 0; i < 80; i++) { const t0 = performance.now(); w.frame(); gl.finish(); ts.push(performance.now() - t0); } ts.sort((a, b) => a - b); return +ts[40].toFixed(2); };
    // three interleaved rounds, the best of each: the GPU is shared, single medians swing by milliseconds
    const withCat = [], without = [];
    for (let k = 0; k < 3; k++) {
      w.cat.group.visible = true; run(); withCat.push(run());
      w.cat.group.visible = false; run(); without.push(run());
    }
    w.cat.group.visible = true; w.frame();
    return { withCat, without, ms: +(Math.min(...withCat) - Math.min(...without)).toFixed(2) };
  });
  console.log('CATPERF ' + JSON.stringify(perf));

  // ---------------------------------------------------------------- the model: eyes, blink, belly, tail, fur ----
  const model = await page.evaluate(() => {
    const w = window.__app.world, cat = w.cat, far = cat.group.position.clone().set(100, 1.62, 100);
    // the tail: every segment overlaps the next (the chain is never broken), in the pose the cat is in now
    const tail = () => { let worst = 0; for (let i = 0; i < 11; i++) worst = Math.max(worst, cat.tailP[i].distanceTo(cat.tailP[i + 1]) / (cat.tailR[i] + cat.tailR[i + 1])); return +worst.toFixed(2); };
    const belly = () => ({ y: +cat.belly.position.y.toFixed(3), sy: +cat.belly.scale.y.toFixed(2), sz: +cat.belly.scale.z.toFixed(2) });
    // asleep on its seat: the eyes are closed (the lids show, the eyes are hidden)
    cat.goTo(0, true); cat.nextMove = 1e9;
    for (let i = 0; i < 60; i++) cat.update(0.05, far);
    const asleep = { eyes: cat.eyes.visible, lids: cat.lids.visible, open: +cat.pose.eyes.toFixed(2), tail: tail(), belly: belly() };
    // awake and sitting: open eyes that blink now and then (the pose itself stays open)
    cat.state = 'sit'; cat.stateT = 0; cat.sitFor = 1e9; cat.blinkIn = 0.5;
    let minScale = 1, blinks = 0, openFrames = 0, poseMin = 1, wasShut = false;
    for (let i = 0; i < 640; i++) {   // 2 s to wake up, then 30 s
      cat.update(0.05, far);
      if (i < 40) continue;
      const sc = cat.eyes.scale.y; minScale = Math.min(minScale, sc); poseMin = Math.min(poseMin, cat.pose.eyes);
      if (sc > 0.9) openFrames++;
      const shut = sc < 0.5; if (shut && !wasShut) blinks++; wasShut = shut;
    }
    cat.blinkIn = 1e9; for (let i = 0; i < 20; i++) cat.update(0.05, far);
    const sitting = { minScale: +minScale.toFixed(2), blinks, openShare: +(openFrames / 600).toFixed(2), poseMin: +poseMin.toFixed(2), eyes: cat.eyes.visible, lids: cat.lids.visible, tail: tail(), belly: belly() };
    // the fur atlas: a dark back and a light belly on the body patch, the white spot for the plain parts
    const img = cat.map.image, c2 = img.getContext('2d');
    const lum = (x, y) => { const d = c2.getImageData(x - 2, y - 2, 5, 5).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3; return +(s / (d.length / 4)).toFixed(0); };
    // the body patch runs round the barrel: the spine at its left edge, the belly in its middle (u = 0.21)
    const fur = { size: [img.width, img.height], back: lum(6, img.height >> 1), belly: lum(Math.round(img.width * 0.21), img.height >> 1), plain: lum(Math.round(img.width * 0.975), img.height >> 1) };
    cat.goTo(0, true);
    return { asleep, sitting, fur };
  });
  console.log('MODEL ' + JSON.stringify(model));
  await page.evaluate(() => { const w = window.__app.world; w.cat.goTo(0, true); w.frame(); const pc = window.__cat.pickCenter(), o = window.__cat.standOff(1.1); window.__cat.aim(o.x, o.z, pc.x, pc.y, pc.z); });
  check('asleep the eyes are closed, awake they are open and blink now and then', !model.asleep.eyes && model.asleep.lids && model.asleep.open < 0.1 && model.sitting.eyes && !model.sitting.lids && model.sitting.poseMin > 0.95 && model.sitting.minScale < 0.4 && model.sitting.blinks >= 3 && model.sitting.openShare > 0.8, { asleep: model.asleep, sitting: model.sitting });
  check('the belly sags when it sits and tucks up when it lies', model.sitting.belly.sz > 1.06 && model.sitting.belly.sy < 0.97 && model.asleep.belly.sy < 0.85 && model.asleep.belly.y > model.sitting.belly.y, { sit: model.sitting.belly, lie: model.asleep.belly });
  check('the tail is one unbroken chain, curled in its sleep and wrapped round the paws when it sits', model.asleep.tail < 1 && model.sitting.tail < 1, { asleep: model.asleep.tail, sitting: model.sitting.tail });
  check('the fur atlas: a dark back, a light belly, the white spot', model.fur.size[0] >= 512 && model.fur.back < model.fur.belly - 60 && model.fur.plain > 250, model.fur);
  // switching the language redraws the HUD: the ring stays, still no text
  const lang = await page.evaluate(async () => {
    const { i18n } = window.__app.ctx; const before = i18n.lang;
    const ring = () => document.querySelector('#crosshair').classList.contains('active');
    i18n.setLanguage('en');
    await new Promise((r) => setTimeout(r, 100));
    const en = { ring: ring(), hintEl: !!document.querySelector('#hint') };
    i18n.setLanguage(before);
    await new Promise((r) => setTimeout(r, 100));
    return { en, de: { ring: ring(), hintEl: !!document.querySelector('#hint') } };
  });
  check('in both languages: the ring, no hint text', lang.en.ring && lang.de.ring && !lang.en.hintEl && !lang.de.hintEl, lang);

  const logStart = await page.evaluate(() => ({ sfx: window.__cat.log.sfx.length, purr: window.__cat.log.purr.length }));
  await page.keyboard.press('KeyE');
  await sleep(100);
  const afterE = await page.evaluate(() => { const c = window.__app.world.cat; return { state: c.state, pets: c.pets }; });
  if (afterE.state !== 'pet') { console.log('keyboard E did not reach the page, calling act(E)'); await page.evaluate(() => window.__app.world.actions.act('E')); }
  const petting = await page.evaluate((start) => {
    const w = window.__app.world, cat = w.cat, pp = w.player.position;
    const P = cat.pose, rec = [];
    const at = [0.2, 1.5, 3.0, 4.3, 5.0, 6.5];
    let t = 0;
    for (const until of at) {
      while (t < until - 1e-6) { cat.update(0.05, pp); t += 0.05; }
      rec.push({ t: until, state: cat.state, eyes: +P.eyes.toFixed(2), rub: +P.rub.toFixed(2), knead: +P.knead.toFixed(2), headUp: +P.headUp.toFixed(2), paws: +P.paws.toFixed(2), lie: +P.lie.toFixed(2), purring: cat.purring });
    }
    return { rec, nextMove: +cat.nextMove.toFixed(1), sfx: window.__cat.log.sfx.slice(start.sfx), purr: window.__cat.log.purr.slice(start.purr) };
  }, logStart);
  console.log('PET ' + JSON.stringify(petting));
  const r15 = petting.rec[1], r30 = petting.rec[2], r65 = petting.rec[5];
  check('E starts the reaction: mrrp, louder purr, purring', petting.sfx.includes('mrrp') && petting.sfx.includes('purr-pet') && petting.rec[0].state === 'pet' && petting.rec[0].purring, { sfx: petting.sfx, purr: petting.purr });
  check('petted on its seat: eyes closed, head up rubbing, paws kneading', r15.eyes < 0.2 && r15.rub > 0.8 && r15.headUp > 0.8 && r30.knead > 0.8 && r30.paws > 0.8, [r15, r30]);
  check('it settles back to sleep and does not wander off right away', r65.state === 'sleep' && r65.lie > 0.9 && r65.eyes < 0.2 && petting.nextMove >= 40, { r65, nextMove: petting.nextMove });

  // screenshots of the reaction on the seat (from the front, eye lowered)
  await page.evaluate(() => { const w = window.__app.world; w.cat.pet(w.camera.position); const far = w.player.position; for (let i = 0; i < 30; i++) w.cat.update(0.05, far); const pc = window.__cat.pickCenter(); const o = window.__cat.standOff(1.0); window.__cat.aim(o.x, o.z, pc.x, pc.y, pc.z, 1.25); });
  await frames(3); await shot(tag + 'cat-pet-seat');
  // close-up of the face while it is stroked: closed eyes, head raised
  await page.evaluate(() => {
    const w = window.__app.world, c = w.cat; c.pet(w.camera.position);
    for (let i = 0; i < 24; i++) c.update(0.05, w.player.position);
    c.group.updateMatrixWorld(true);
    const head = c.head.getWorldPosition(c.group.position.clone());
    const fwd = { x: Math.cos(c.yaw), z: -Math.sin(c.yaw) };
    window.__cat.aim(head.x + fwd.x * 0.75, head.z + fwd.z * 0.75, head.x, head.y, head.z, head.y + 0.18);
  });
  await frames(2); await shot(tag + 'cat-face');

  // ---------------------------------------------------------------- petting a cat on the floor ----
  const floorPet = await page.evaluate(() => {
    const w = window.__app.world, cat = w.cat;
    const dest = cat.spots.length - 1;           // a long walk, stopped half way in the open
    cat.goTo(0, true); cat.goTo(dest);
    const far = cat.group.position.clone().set(100, 1.62, 100);
    for (let i = 0; i < 2000 && !(cat.state === 'walk' && cat.stateT > 7); i++) cat.update(0.05, far);
    const p = cat.group.position.clone();
    // a free place 1.1 to 1.5 m behind it (not in its way) with a clear view of it
    const pc = window.__cat.pickCenter();
    const back = Math.atan2(Math.sin(cat.yaw), -Math.cos(cat.yaw));   // floor angle of its backward direction
    let target = null, where = null;
    for (const d of [1.2, 1.5, 1.1]) {
      for (const off of [0.9, -0.9, 0.5, -0.5, 1.3, -1.3, 0]) {
        if (target === 'interact:cat') break;
        const a = back + off, x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        if (!w.player.isFree(x, z, 0.05)) continue;
        const t = window.__cat.aim(x, z, pc.x, pc.y, pc.z);
        target = t ? t.type + ':' + t.kind : null; where = [+x.toFixed(2), +z.toFixed(2)];
      }
      if (target === 'interact:cat') break;
    }
    const before = cat.state;
    const ok = w.actions.act('E');
    const rec = [];
    let tt = 0;
    for (const until of [1.5, 4.9, 5.6, 9.0]) {
      while (tt < until - 1e-6) { cat.update(0.05, w.player.position); tt += 0.05; }
      rec.push({ t: until, state: cat.state, tailUp: +cat.pose.tailUp.toFixed(2), rub: +cat.pose.rub.toFixed(2), knead: +cat.pose.knead.toFixed(2), stretch: +cat.pose.stretch.toFixed(2), sit: +cat.pose.sit.toFixed(2) });
    }
    return { target, where, before, pose: cat.petPose, dest, ok, rec };
  });
  floorPet.tail = await page.evaluate(() => { const cat = window.__app.world.cat; let worst = 0; for (let i = 0; i < 11; i++) worst = Math.max(worst, cat.tailP[i].distanceTo(cat.tailP[i + 1]) / (cat.tailR[i] + cat.tailR[i + 1])); return +worst.toFixed(2); });
  console.log('FLOORPET ' + JSON.stringify(floorPet));
  const [f15, f49, , f90] = floorPet.rec;
  check('with the tail raised it is one unbroken chain too', floorPet.tail < 1, floorPet.tail);
  check('a walking cat can be petted: tail up, then it stretches and sits a while', floorPet.target === 'interact:cat' && floorPet.ok && f15.state === 'pet' && f15.tailUp > 0.7 && f15.rub > 0.8 && f49.state === 'linger' && f49.stretch > 0.5 && f90.state === 'linger' && f90.sit > 0.9, floorPet.rec);
  await page.evaluate(() => { const w = window.__app.world, cat = w.cat; cat.pet(w.camera.position); for (let i = 0; i < 30; i++) cat.update(0.05, w.player.position); const pc = window.__cat.pickCenter(); const p = w.player.position; const dx = p.x - pc.x, dz = p.z - pc.z, d = Math.hypot(dx, dz); window.__cat.aim(pc.x + dx / d * 1.1, pc.z + dz / d * 1.1, pc.x, pc.y, pc.z, 0.95); });
  await frames(3); await shot(tag + 'cat-pet-floor');
  await page.evaluate(() => { const w = window.__app.world, cat = w.cat; for (let i = 0; i < 400 && !(cat.state === 'linger' && cat.stateT > 0.5); i++) cat.update(0.05, w.player.position); });
  await frames(1); await shot(tag + 'cat-stretch');
  const resume = await page.evaluate(() => {
    const w = window.__app.world, cat = w.cat;
    const far = cat.group.position.clone().set(100, 1.62, 100);
    const seen = new Set();
    for (let i = 0; i < 3000; i++) { cat.update(0.05, far); seen.add(cat.state); if (cat.state === 'sleep' && cat.onSpot) break; }
    return { seen: [...seen], state: cat.state, spot: cat.spot };
  });
  check('after the petting it walks on to its seat', resume.seen.includes('linger') && resume.seen.includes('walk') && resume.state === 'sleep' && resume.spot === floorPet.dest, resume);

  // ---------------------------------------------------------------- petting from the sofa ----
  const seated = await page.evaluate(() => {
    const w = window.__app.world, cat = w.cat;
    const sofaSpot = cat.spots.findIndex((s) => s.id === 'sofa');
    if (sofaSpot < 0) return { skipped: true };
    cat.goTo(sofaSpot, true);
    const seat = w.seats.get('sofa');
    w.player.transition = null; w.player.setPose(seat.standPos.x, seat.standPos.z, seat.standYaw, 0);
    w.actions.sit('sofa');
    for (let i = 0; i < 40; i++) w.player.update(0.05);
    const pc = window.__cat.pickCenter(), e = w.player.position;
    w.player.yaw = Math.atan2(-(pc.x - e.x), -(pc.z - e.z)); w.player.pitch = Math.atan2(pc.y - e.y, Math.hypot(pc.x - e.x, pc.z - e.z));
    w.frame(); w.frame();
    w.actions.rayTimer = 0; w.actions.update(0.001);
    const t = w.actions.target;
    const ok = w.actions.act('E');
    for (let i = 0; i < 30; i++) cat.update(0.05, w.player.position, true);
    return { seated: !!w.player.seated, target: t && t.type + ':' + t.kind, dist: t && +t.distance.toFixed(2), ok, state: cat.state, rub: +cat.pose.rub.toFixed(2) };
  });
  console.log('SEATED ' + JSON.stringify(seated));
  await frames(3); await shot(tag + 'cat-pet-sofa');
  check('from the sofa the cat next to you can be petted', seated.skipped || (seated.seated && seated.target === 'interact:cat' && seated.ok && seated.state === 'pet'), seated);
  await page.evaluate(() => { const w = window.__app.world; w.actions.leaveSeat(); for (let i = 0; i < 120; i++) w.cat.update(0.05, null); });

  // ---------------------------------------------------------------- books behind the cat stay targetable ----
  const behind = await page.evaluate(() => {
    const w = window.__app.world, cat = w.cat, nav = cat.nav;
    // a book on the lowest shelf; the cat sits on the floor in front of that case
    const e = [...w.books.entries.values()].find((x) => !x.hidden && x.pos.y < 1.2 && nav.freeAt(x.pos.x + x.forward.x * 0.75, x.pos.z + x.forward.z * 0.75));
    if (!e) return { skipped: true };
    const cx = e.pos.x + e.forward.x * 0.75, cz = e.pos.z + e.forward.z * 0.75;
    cat.onSpot = false; cat.route = null; cat.state = 'linger'; cat.stateT = 0; cat.lingerFor = 1e9;
    cat.group.position.set(cx, 0, cz); cat.yaw = Math.atan2(-e.forward.x, e.forward.z);   // sideways to the case
    for (let i = 0; i < 40; i++) cat.update(0.05, null);
    const px = e.pos.x + e.forward.x * 1.95, pz = e.pos.z + e.forward.z * 1.95;
    const pc = window.__cat.pickCenter();
    const tCat = window.__cat.aim(px, pz, pc.x, pc.y, pc.z);
    const tBook = window.__cat.aim(px, pz, e.pos.x, e.pos.y + 0.02, e.pos.z);
    // out of reach: the ray passes the cat and still finds what is behind it
    const qx = e.pos.x + e.forward.x * 3.0, qz = e.pos.z + e.forward.z * 3.0;
    const tFar = window.__cat.aim(qx, qz, pc.x, pc.y, pc.z);
    return { cat: tCat && tCat.type + ':' + tCat.kind, book: tBook && tBook.type, sameBook: tBook?.book?.id === e.book.id, far: tFar ? tFar.type + (tFar.kind ? ':' + tFar.kind : '') : null };
  });
  console.log('BEHIND ' + JSON.stringify(behind));
  check('the cat is targetable in front of a shelf, the book above/behind it too, and beyond reach it is not', behind.skipped || (behind.cat === 'interact:cat' && behind.book === 'book' && behind.sameBook && behind.far !== 'interact:cat'), behind);
  await shot(tag + 'cat-shelf');

  // ---------------------------------------------------------------- cat switched off ----
  const off = await page.evaluate(() => {
    const w = window.__app.world, cat = w.cat;
    cat.goTo(0, true);
    const pc = window.__cat.pickCenter(), o = window.__cat.standOff(1.1);
    window.__cat.aim(o.x, o.z, pc.x, pc.y, pc.z); w.frame();
    const purrBefore = cat.purring;
    const n = window.__cat.log.purr.length;
    w.applySettings({ ...w.settings, cat: false });
    const t = window.__cat.aim(o.x, o.z, pc.x, pc.y, pc.z);
    const res = { purrBefore, purrAfter: cat.purring, purrLog: window.__cat.log.purr.slice(n), visible: cat.group.visible, target: t ? t.type + (t.kind ? ':' + t.kind : '') : null, pet: cat.pet(w.camera.position) };
    w.applySettings({ ...w.settings, cat: true });
    const t2 = window.__cat.aim(o.x, o.z, pc.x, pc.y, pc.z);
    res.backOn = t2 ? t2.type + ':' + t2.kind : null;
    return res;
  });
  console.log('OFF ' + JSON.stringify(off));
  check('switched off: hidden, not targetable, no purring; back on it works again', off.purrBefore && !off.purrAfter && off.purrLog.at(-1) === false && !off.visible && off.target !== 'interact:cat' && !off.pet && off.backOn === 'interact:cat', off);

  // ---------------------------------------------------------------- rebuild (department switch) ----
  const rebuild = await page.evaluate(() => {
    const w = window.__app.world;
    const old = w.cat;
    const spotIdx = old.spots.findIndex((s) => s.id === 'sofa') >= 0 ? old.spots.findIndex((s) => s.id === 'sofa') : 1;
    old.goTo(spotIdx, true);
    const id = old.spots[spotIdx].id;
    const pc = window.__cat.pickCenter(), o = window.__cat.standOff(1.1);
    window.__cat.aim(o.x, o.z, pc.x, pc.y, pc.z); w.frame();
    const n = window.__cat.log.purr.length;
    const deps = (w.layout.departments || []).filter((d) => d.count > 0).map((d) => d.name);
    const next = deps.find((d) => d !== w.department);
    const switched = next ? w.setDepartment(next) : (w.build(w.library, {}), true);
    const cat = w.cat;
    const t = window.__cat.aim(o.x, o.z, pc.x, pc.y, pc.z);
    const target = t ? t.type + ':' + t.kind : null;
    const ok = w.actions.act('E');
    return { switched, fresh: cat !== old, sameSpot: cat.spots[cat.spot].id === id, id, purrLog: window.__cat.log.purr.slice(n), target, ok, state: cat.state, landings: cat.spots.every((s) => s.landing) };
  });
  console.log('REBUILD ' + JSON.stringify(rebuild));
  // a department switch only swaps the shelves (world.refreshShelves): the cat may be the same object or a new one
  check('after a department switch the cat stays on its seat and can be petted', rebuild.switched && rebuild.sameSpot && rebuild.target === 'interact:cat' && rebuild.ok && rebuild.state === 'pet' && rebuild.landings, rebuild);
  // a rebuild while it walks through the hall: it walks on from the same place
  const rebuildWalk = await page.evaluate(() => {
    const w = window.__app.world;
    let cat = w.cat;
    cat.goTo(0, true); cat.nextMove = 1e9; cat.goTo(2);
    const far = cat.group.position.clone().set(100, 1.62, 100);
    for (let i = 0; i < 400 && !(cat.state === 'walk' && cat.stateT > 1.5); i++) cat.update(0.05, far);
    const before = cat.group.position.clone();
    const deps = (w.layout.departments || []).filter((d) => d.count > 0).map((d) => d.name);
    const next = deps.find((d) => d !== w.department);
    if (next) w.setDepartment(next); else w.build(w.library, {});
    cat = w.cat;
    const res = { moved: +cat.group.position.distanceTo(before).toFixed(4), state: cat.state, spot: cat.spots[cat.spot].id, onSpot: cat.onSpot };
    let arrived = false;
    for (let i = 0; i < 2000 && !arrived; i++) { cat.update(0.05, far); arrived = cat.state === 'sleep' && cat.onSpot && cat.spot === 2; }
    res.arrived = arrived;
    return res;
  });
  console.log('REBUILD-WALK ' + JSON.stringify(rebuildWalk));
  check('a rebuild while it walks: the new cat walks on from the same place and arrives', rebuildWalk.moved < 0.01 && rebuildWalk.state === 'walk' && !rebuildWalk.onSpot && rebuildWalk.arrived, rebuildWalk);

  // ---------------------------------------------------------------- the two new sounds render cleanly ----
  const sounds = await page.evaluate(async () => {
    const a = window.__app.ctx.audio;
    return [await a.renderStats('sfx', 'mrrp', 1.5), await a.renderStats('sfx', 'purr-pet', 6), await a.renderStats('sfx', 'purr', 4)];
  });
  console.log('SOUNDS ' + JSON.stringify(sounds));
  check('mrrp and purr-pet render: not silent, no clipping, no NaN', sounds.every((s) => !s.silent && s.peak < 0.9 && !s.nan), sounds);

  console.log(`CAT-CHECK ${failures ? 'FAILED: ' + failures : 'ALL PASSED'}`);
};
