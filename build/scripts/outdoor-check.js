// The terrace: the glass doors open when you walk up to them and close behind you, you can walk out onto the deck
// and the lawn and back in, the edge of the walkable garden holds (straight walks towards the scenery and a long random
// walk never leave it or slip round the corner of the house), the loungers are seats with a free spot to stand up to,
// and every tree on the walkable area has a collider. Prints PASS/FAIL lines; screenshots with SHOT_TAG prefix.
// (The garden itself, the lake and the doors in both directions: outdoor2-check.)
module.exports = async ({ page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || 'od';
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(1500);
  // (the garden of the seasons without ice: in winter the frozen lake carries you, winter-check.js; by the calendar that
  // is December to February)
  await page.evaluate(() => { const w = window.__app.world; if (w.env?.garden?.seasons?.name === 'winter') w.applySettings({ ...w.settings, season: 'autumn' }); });
  let failures = 0;
  const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); if (!ok) failures++; };

  const layout = await page.evaluate(() => {
    const w = window.__app.world, L = w.layout;
    const O = w.env.garden.outdoor;
    return {
      door: !!w.door, shut: !!L.colliders.find((c) => c.door), walkable: O.zones.walkable.length, bounds: !!w.player.bounds && !!w.player.floorAt,
      place: !!L.places.find((p) => p.id === 'terrace'), seats: ['lounger1', 'lounger2'].map((id) => !!w.seats.get(id)),
    };
  });
  check('door, the walkable garden, the terrace place and the loungers exist', layout.door && layout.shut && layout.walkable > 20 && layout.bounds && layout.place && layout.seats.every(Boolean), layout);

  // --- the doors -------------------------------------------------------------------------------------------------
  const door = await page.evaluate(() => {
    const w = window.__app.world, p = w.player, d = w.door;
    const step = (s) => { for (let i = 0; i < Math.round(s / 0.05); i++) w.updateDoor(0.05); };
    const state = () => ({ t: +d.t.toFixed(2), shutOn: d.shut.max[1] > 0, leavesOn: d.open.every((c) => c.max[1] > 0) });
    p.transition = null; p.setPose(0, -1, Math.PI, 0); step(2);
    const far = state();
    p.setPose(0.3, 3.9, Math.PI, 0); step(1.2);
    const near = state();
    p.setPose(0.3, 7.6, 0, 0); step(1.2);
    const outside = state();
    p.setPose(1.0, 10.5, 0, 0); step(2);
    const lawn = state();
    return { far, near, outside, lawn };
  });
  check('the doors are shut when you are away (collider across the doorway)', door.far.t === 0 && door.far.shutOn && !door.far.leavesOn, door.far);
  check('they open when you walk up to them from inside', door.near.t === 1 && !door.near.shutOn && door.near.leavesOn, door.near);
  check('they stay open while you stand in front of them outside', door.outside.t === 1 && !door.outside.shutOn, door.outside);
  check('they close behind you out on the lawn', door.lawn.t === 0 && door.lawn.shutOn, door.lawn);

  // --- walking out and back in, and the invisible walls ------------------------------------------------------------
  const walk = await page.evaluate(() => {
    const w = window.__app.world, p = w.player, O = w.env.garden.outdoor;
    const run = (fromX, fromZ, toX, toZ, steps = 700) => {
      if (fromX != null) { p.transition = null; p.setPose(fromX, fromZ, 0, 0); }
      let stuck = 0;
      for (let i = 0; i < steps; i++) {
        const dx = toX - p.position.x, dz = toZ - p.position.z, d = Math.hypot(dx, dz);
        if (d < 0.4) return { ok: true, pos: [+p.position.x.toFixed(2), +p.position.z.toFixed(2)] };
        p.yaw = Math.atan2(-dx, -dz);
        const before = p.position.clone();
        p.velocity.set(dx / d * 2.4, 0, dz / d * 2.4);
        w.updateDoor(0.05); p.update(0.05);
        if (p.position.distanceTo(before) < 0.004) stuck++; else stuck = 0;
        if (stuck > 60) return { ok: false, pos: [+p.position.x.toFixed(2), +p.position.z.toFixed(2)] };
      }
      return { ok: false, pos: [+p.position.x.toFixed(2), +p.position.z.toFixed(2)] };
    };
    const via = (pts) => { let r = null; for (let i = 0; i < pts.length - 1; i++) { r = run(i === 0 ? pts[0][0] : null, pts[0][1], pts[i + 1][0], pts[i + 1][1]); if (!r.ok) return { ...r, leg: i }; } return r; };
    const out = via([[-3, -1], [0, 3.2], [0.2, 7.2], [2.5, 12.8]]);
    const back = via([[2.5, 12.8], [0.3, 7.4], [0, 3.0], [-4, -1.5]]);
    // outside and inside: never in a wall, never beyond the edge of the walkable garden, never round the corner of the house
    const bad = (x, z) => (z > 5.9 && !O.inRegion(x, z, 0.25)) || (z < 5.84 && z > -6 && Math.abs(x) > 8.55);
    const escapes = [];
    for (const [tx, tz] of [[0, 90], [-90, 12], [90, 12], [-30, 6.2], [30, 6.2], [-14, -4], [14, -4], [-9.6, 4], [9.6, 4], [-90, 90], [90, 90]]) {
      p.transition = null; p.setPose(0.4, 8.8, 0, 0);
      for (let i = 0; i < 900; i++) {
        const dx = tx - p.position.x, dz = tz - p.position.z, d = Math.hypot(dx, dz) || 1;
        p.velocity.set(dx / d * 4.2, 0, dz / d * 4.2); w.updateDoor(0.05); p.update(0.05);
        if (bad(p.position.x, p.position.z)) { escapes.push([tx, tz, +p.position.x.toFixed(2), +p.position.z.toFixed(2)]); break; }
      }
    }
    // how deep the player at (x, z) stands in a collider, the way player.js tests them (its radius against plain boxes,
    // its legs against the parts of low furniture with walkable tops, nothing it may step onto), with 2 cm to spare
    const inCollider = (x, z, feet = p.feet) => {
      const RADIUS = 0.32, LEG = 0.15, STEP_UP = 0.2, MAX_TOP = 0.9, EYE = 1.62, SPARE = 0.02, base = p.groundAt(x, z);
      for (const c of w.colliders) {
        if (c.parts) {
          for (const q of c.parts) {
            if (q.y0 > feet + EYE || (q.walk && q.top <= MAX_TOP && q.top <= feet + STEP_UP)) continue;
            const dx = x - q.x, dz = z - q.z, lx = dx * q.c - dz * q.s, lz = dx * q.s + dz * q.c;
            const ex = Math.max(Math.abs(lx) - q.hx, 0), ez = Math.max(Math.abs(lz) - q.hz, 0);
            if (ex * ex + ez * ez < (LEG - SPARE) ** 2) return true;
          }
          continue;
        }
        if (c.max[1] < base + 0.25 || c.min[1] > feet + EYE) continue;
        const rr = (c.prop ? LEG : RADIUS) - SPARE, cx = Math.max(c.min[0], Math.min(x, c.max[0])), cz = Math.max(c.min[2], Math.min(z, c.max[2]));
        if ((x - cx) ** 2 + (z - cz) ** 2 < rr * rr) return true;
      }
      return false;
    };
    // a long random walk outside
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    p.transition = null; p.setPose(0, 11, 0, 0);
    let ang = 0, randomBad = 0, minX = 99, maxX = -99, maxZ = -99; const badAt = [];
    for (let i = 0; i < 9000; i++) {
      if (i % 40 === 0) ang = rnd() * Math.PI * 2;
      p.velocity.set(Math.sin(ang) * 4.2, 0, Math.cos(ang) * 4.2); w.updateDoor(0.05); p.update(0.05);
      const { x, z } = p.position; minX = Math.min(minX, x); maxX = Math.max(maxX, x); if (z > 5.9) maxZ = Math.max(maxZ, z);
      // (as the player tests them: low furniture with walkable tops keeps only its legs off)
      const why = bad(x, z) ? 'edge' : inCollider(x, z) ? 'collider' : null;
      if (why) { randomBad++; if (badAt.length < 4) badAt.push([why, +x.toFixed(2), +z.toFixed(2)]); }
    }
    // every tree on (or right beside) the walkable area stands in the way as a collider: no trunk you could walk through
    const trees = w.env.garden.trees.filter((t) => O.inRegion(t.x, t.z, -1) || O.inRegion(t.x + 1, t.z) || O.inRegion(t.x - 1, t.z) || O.inRegion(t.x, t.z + 1) || O.inRegion(t.x, t.z - 1))
      .filter((t) => !O.obstacles.some((o) => Math.hypot(o.x - t.x, o.z - t.z) < 0.01)).map((t) => [t.sp, +t.x.toFixed(1), +t.z.toFixed(1)]);
    return { out, back, escapes, randomBad, badAt, range: [+minX.toFixed(2), +maxX.toFixed(2), +maxZ.toFixed(2)], trees };
  });
  check('walk from the hall through the doors onto the lawn', walk.out.ok, walk.out);
  check('and back into the hall', walk.back.ok, walk.back);
  check('straight walks towards the scenery stop at the edge of the walkable garden', walk.escapes.length === 0, walk.escapes);
  check('a long random walk stays in the walkable garden and never in a wall', walk.randomBad === 0, { bad: walk.randomBad, at: walk.badAt, range: walk.range });
  check('every tree on the walkable area has a collider', walk.trees.length === 0, walk.trees);

  // --- the loungers ----------------------------------------------------------------------------------------------
  const seats = await page.evaluate(() => {
    const w = window.__app.world, out = [];
    for (const id of ['lounger1', 'lounger2']) {
      const seat = w.seats.get(id);
      w.player.transition = null; w.player.setPose(seat.standPos.x, seat.standPos.z, seat.standYaw, 0);
      w.actions.sit(id); for (let i = 0; i < 40; i++) w.player.update(0.05);
      const eye = w.camera.position.clone();
      w.actions.stand(); for (let i = 0; i < 40; i++) w.player.update(0.05);
      const p = w.player.position;
      out.push({ id, eye: [+eye.x.toFixed(2), +eye.y.toFixed(2), +eye.z.toFixed(2)], stand: [+p.x.toFixed(2), +p.z.toFixed(2)], free: w.player.isFree(p.x, p.z, 0), outside: p.z > 5.9 });
    }
    return out;
  });
  check('the loungers: lie down and stand up on a free spot outside', seats.every((s) => s.free && s.outside && s.eye[1] < 1.2), seats);

  // --- pictures ------------------------------------------------------------------------------------------------------
  const views = [['door-open', 0.6, 3.4, Math.PI, 0.05], ['on-deck', -1.2, 7.4, Math.PI + 0.6, 0.02], ['back', 1.0, 12.8, 0, 0.12]];
  for (const [name, x, z, yaw, pitch] of views) {
    await page.evaluate(([x, z, yaw, pitch]) => { const w = window.__app.world; if (w.actions.seatedId) w.actions.leaveSeat(); w.player.transition = null; w.player.setPose(x, z, yaw, pitch); for (let i = 0; i < 30; i++) w.updateDoor(0.05); }, [x, z, yaw, pitch]);
    for (let i = 0; i < 10; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(50); }
    await shot(`${tag}-${name}`);
  }
  console.log(`OUTDOOR ${failures ? 'FAILED ' + failures : 'OK'}`);
};
