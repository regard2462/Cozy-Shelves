// The garden you can walk in (0.6). On foot from the hall to the lake: along the path to the jetty and its bench (E sits
// down, Space stands up), to the water's edge, round the east bay and up to the bench on the knoll, the eye following
// the ground. The walkable area holds: straight walks in every direction from many places and a long random walk never
// leave it, never step into the water or a trunk, and nowhere do you get stuck. The glass doors swing away from you in
// both directions, never into the furniture or into you, and their colliders follow the leaves. The rain ends on the
// ground, the water, the deck, the jetty and the roofs, never below the ground and never in the rooms. Frame times
// while walking outside (fog and rain), and no shader compiled on the way; the frame-time budget is judged only when
// no other program keeps the graphics card busy (a SKIP line otherwise). Prints PASS/FAIL/SKIP lines and one summary
// line; OD2_PARTS=walk,bounds,doors,rain,perf,shots picks parts. Muted and hidden like every harness script.
//   node build/screenshot.js outdoor2-check
module.exports = async ({ app, page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || 'od2';
  const only = (process.env.OD2_PARTS || '').split(',').filter(Boolean);
  const want = (part) => !only.length || only.includes(part);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1600, 900); });
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(1500);
  await page.evaluate(() => { window.__app.world.stop(); window.__app.closeAllPanels(); });
  // (the garden of the seasons without ice: in winter the frozen lake carries you, winter-check.js; by the calendar that
  // is December to February)
  await page.evaluate(() => { const w = window.__app.world; if (w.env?.garden?.seasons?.name === 'winter') w.applySettings({ ...w.settings, season: 'autumn' }); });
  await sleep(400);
  let failures = 0, passes = 0, skipped = 0;
  const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); if (ok) passes++; else failures++; };
  const skip = (name, why, info) => { console.log(`SKIP ${name} (${why})${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); skipped++; };

  // ---- helpers in the page ---------------------------------------------------------------------------------------
  await page.evaluate(() => {
    const w = window.__app.world, p = w.player, O = w.env.garden.outdoor, EYE = 1.62;
    const r2 = (v) => +v.toFixed(2);
    const H = window.__od2 = { O };
    H.at = () => [r2(p.position.x), r2(p.position.z)];
    H.pose = (x, z, yaw = 0, pitch = 0) => { if (w.actions.seatedId) w.actions.leaveSeat(); p.transition = null; p.keys.clear(); p.setPose(x, z, yaw, pitch); };
    H.step = (dt = 0.05) => { w.updateDoor(dt); p.update(dt); };
    // walk towards (tx, tz) the way a person does: W held down, the view turned towards the goal
    H.walk = (tx, tz, { run = false, steps = 1400, near = 0.45 } = {}) => {
      let stuck = 0, dy = 0, air = 0, jerk = 0, camY = w.camera.position.y;
      p.keys.clear(); p.keys.add('KeyW'); if (run) p.keys.add('ShiftLeft');
      try {
        for (let i = 0; i < steps; i++) {
          const dx = tx - p.position.x, dz = tz - p.position.z, d = Math.hypot(dx, dz);
          if (d < near) return { ok: true, pos: H.at(), dy: r2(dy), air, jerk: r2(jerk) };
          p.yaw = Math.atan2(-dx, -dz);
          const before = p.position.clone();
          H.step();
          // the eye stands EYE above what is under the feet, the camera follows without a jump and never falls on the way
          if (i > 3) {
            dy = Math.max(dy, Math.abs(p.position.y - EYE - p.groundAt(p.position.x, p.position.z)));
            jerk = Math.max(jerk, Math.abs(w.camera.position.y - camY));
            if (p.air) air++;
          }
          camY = w.camera.position.y;
          if (p.position.distanceTo(before) < 0.003) stuck++; else stuck = 0;
          if (stuck > 40) return { ok: false, stuck: true, pos: H.at() };
        }
        return { ok: false, pos: H.at() };
      } finally { p.keys.clear(); for (let i = 0; i < 12; i++) H.step(); }
    };
    H.via = (pts, opts) => { let r = null, dy = 0, air = 0, jerk = 0; for (let i = 0; i < pts.length; i++) { r = H.walk(pts[i][0], pts[i][1], opts); if (!r.ok) return { ...r, leg: i }; dy = Math.max(dy, r.dy); air += r.air; jerk = Math.max(jerk, r.jerk); } return { ...r, dy, air, jerk }; };
    // sit down the way the keys do it: look at the seat from where you stand, E
    H.sitByKey = (id) => {
      const seat = w.seats.get(id); if (!seat) return { err: 'no seat ' + id };
      H.pose(seat.standPos.x, seat.standPos.z, 0, 0);
      const c = new p.position.constructor().setFromMatrixPosition(seat.obj.matrixWorld); c.y += 0.5;
      const dx = c.x - p.position.x, dz = c.z - p.position.z;
      p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(c.y - p.position.y, Math.hypot(dx, dz));
      p.update(0.01); w.camera.updateMatrixWorld(); w.actions.rayTimer = 0; w.actions.update(0.01);
      const aimed = w.actions.target?.seat?.id || w.actions.target?.type || null;
      const acted = w.actions.act('E');
      for (let i = 0; i < 40; i++) p.update(0.05);
      return { aimed, acted, seated: w.actions.seatedId, eye: [r2(w.camera.position.x), r2(w.camera.position.y), r2(w.camera.position.z)] };
    };
    H.standByKey = () => {
      w.actions.act('Space');
      for (let i = 0; i < 40; i++) p.update(0.05);
      const { x, z } = p.position;
      return { seated: w.actions.seatedId, pos: H.at(), free: p.isFree(x, z, 0), y: r2(p.position.y - p.groundAt(x, z)) };
    };
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
    H.inCollider = inCollider;
    const inHouse = (x, z) => (Math.abs(x) < 8.5 && z > -5.5 && z < 5.5) || (Math.abs(x) < 1.7 && z <= -5.5 && z > -9.2) || (Math.abs(x) < 11 && z <= -9.2 && z > -23.6);
    // a spot nobody may be: outside the walkable area (when outside the house), in the water, in a trunk, beside the house
    H.bad = (x, z) => {
      if (O.inRegion(x, z, 0.3 - 0.02)) { if (O.obstaclesNear(x, z, 0).some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 0.3 - 0.03)) return 'trunk'; if (p.groundAt(x, z) < O.waterY - 0.01) return 'water'; return null; }
      if (z > 5.45) return O.inRegion(x, z) ? 'edge' : 'out';
      return inHouse(x, z) ? null : 'house';
    };
  });

  // ---- 1. on foot to the lake --------------------------------------------------------------------------------------
  if (want('walk')) {
    const walk = await page.evaluate(() => {
      const H = window.__od2, w = window.__app.world, O = H.O, J = O.jetty;
      H.pose(-3, -1, Math.PI);
      const route = [[0, 3.2], [0.2, 7.6], [0.2, 12.5], [-1.4, 17], [-4.4, 22.5], [-8.6, 27.5], [-12.6, 30.6], J.root, J.at(J.len - J.platLen - 0.6, 0), J.at(J.len - J.platLen + 0.4, 1.25), J.at(J.len - 0.45, 0.6)];
      const toJetty = H.via(route);
      const onBoards = O.groundHeight(window.__app.world.player.position.x, window.__app.world.player.position.z);
      const sit = H.sitByKey('jettybench');
      const stand = H.standByKey();
      // to the water's edge beside the jetty, straight towards the middle of the lake
      const side = J.at(2.0, 3.2);
      H.pose(side[0], side[1], 0);
      const edge = H.walk(O.lake.x, O.lake.z, { steps: 500 });
      const p = w.player.position, edgeGround = O.terrainHeight(p.x, p.z);
      // round the east bay along the trail and up to the knoll
      H.pose(J.root[0] + 1.2, J.root[1] - 0.6, 0);
      const bay = H.via([[-13.2, 37.6], [-10.6, 42.5], [-9.6, 48.0], [-9.0, 53.2], [-3.5, 54.0], [3.4, 52.4], [8.6, 49.0], [11.0, 44.4]]);
      const knollSeat = H.sitByKey('knollbench');
      const knollStand = H.standByKey();
      return { toJetty, onBoards: +onBoards.toFixed(3), top: +J.top.toFixed(3), sit, stand, edge, edgeAbove: +(edgeGround - O.waterY).toFixed(3), bay, knollSeat, knollStand, knollY: +O.knoll.h.toFixed(2) };
    });
    check('walk from the hall through the doors along the path onto the jetty', walk.toJetty.ok && Math.abs(walk.onBoards - walk.top) < 0.001, walk.toJetty);
    check('the eye follows the ground on the way (deck, lawn, path, jetty): no jump of the camera, no fall', walk.toJetty.dy < 0.12 && walk.toJetty.air === 0 && walk.toJetty.jerk < 0.08 && walk.bay.air === 0 && walk.bay.jerk < 0.08, { dy: walk.toJetty.dy, air: walk.toJetty.air, jerk: walk.toJetty.jerk, bay: { air: walk.bay.air, jerk: walk.bay.jerk } });
    check('E on the bench at the end of the jetty sits you down', walk.sit.aimed === 'jettybench' && walk.sit.seated === 'jettybench' && walk.sit.eye[1] < walk.top + 1.4, walk.sit);
    check('Space stands up on a free spot on the jetty', !walk.stand.seated && walk.stand.free && Math.abs(walk.stand.y - 1.62) < 0.05, walk.stand);
    check('you can walk right up to the water and no further', walk.edge.ok === false && walk.edgeAbove >= -0.01 && walk.edgeAbove < 0.3, { pos: walk.edge.pos, above: walk.edgeAbove });
    check('along the east shore and the edge of the wood up to the knoll', walk.bay.ok, walk.bay);
    check('the bench on the knoll: E sits down, Space stands up', walk.knollSeat.seated === 'knollbench' && !walk.knollStand.seated && walk.knollStand.free, { sit: walk.knollSeat, stand: walk.knollStand });
  }

  // ---- 2. the walkable area holds ----------------------------------------------------------------------------------
  if (want('bounds')) {
    const b = await page.evaluate(() => {
      const H = window.__od2, w = window.__app.world, p = w.player, O = H.O, J = O.jetty;
      const starts = [[0.5, 8], [0, 18], [15, 25], [13, 40], [5, 52], [-10, 45], J.root, J.at(J.len - 0.8, -1.1), [-27, 30.5], [-20, 15], [22, 10], [-6, 56.8]];
      const escapes = [];
      let steps = 0;
      for (const [sx, sz] of starts) {
        for (let k = 0; k < 16; k++) {
          const a = k / 16 * Math.PI * 2;
          H.pose(sx, sz, a);
          p.keys.add('KeyW'); p.keys.add('ShiftLeft');
          for (let i = 0; i < 240; i++) {
            H.step(); steps++;
            const why = H.bad(p.position.x, p.position.z);
            if (why) { escapes.push([+sx.toFixed(1), +sz.toFixed(1), k, why, ...H.at()]); break; }
          }
          p.keys.clear();
        }
      }
      // a long random walk, running
      let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      H.pose(0, 14, 0);
      let bad = 0; const box = [99, -99, 99, -99], samples = [], why = {};
      p.keys.add('KeyW'); p.keys.add('ShiftLeft');
      for (let i = 0; i < 9000; i++) {
        if (i % 45 === 0) p.yaw = rnd() * Math.PI * 2;
        H.step();
        const { x, z } = p.position;
        box[0] = Math.min(box[0], x); box[1] = Math.max(box[1], x); box[2] = Math.min(box[2], z); box[3] = Math.max(box[3], z);
        // (as the player tests them: plain colliders keep its radius off, low furniture with walkable tops only its legs)
        const wy = H.bad(x, z) || (H.inCollider(x, z) ? 'collider' : null);
        if (wy) { bad++; why[wy] = (why[wy] || 0) + 1; if (!why.at) why.at = [...H.at(), w.colliders.filter((c) => { const cx = Math.max(c.min[0], Math.min(x, c.max[0])), cz = Math.max(c.min[2], Math.min(z, c.max[2])); return Math.hypot(cx - x, cz - z) < 0.28 && c.max[1] > 0.25; }).map((c) => c.min.concat(c.max).map((v) => +v.toFixed(2)))]; }
        if (i % 75 === 0) samples.push([x, z]);
      }
      p.keys.clear();
      // nowhere stuck: from spots of the random walk and from tight places, a metre in at least one of 8 directions
      const tight = [J.at(J.len - 0.35, J.platWidth / 2 - 0.35), J.at(J.len - 0.35, -J.platWidth / 2 + 0.35), J.at(J.len - J.platLen + 0.35, 1.3), J.at(0.4, 0), [26.6, 30], [-7.4, 58.0], [9.1, 6.5], [-9.1, 6.5]];
      const stuck = [];
      for (const [x, z] of [...samples, ...tight]) {
        let best = 0;
        for (let k = 0; k < 8 && best < 0.9; k++) {
          H.pose(x, z, k / 8 * Math.PI * 2);
          const s = p.position.clone();
          p.keys.add('KeyW');
          for (let i = 0; i < 30; i++) H.step();
          p.keys.clear();
          best = Math.max(best, p.position.distanceTo(s));
        }
        if (best < 0.5) stuck.push([+x.toFixed(2), +z.toFixed(2), +best.toFixed(2)]);
      }
      return { steps, escapes: escapes.slice(0, 12), nEscapes: escapes.length, bad, why, box: box.map((v) => +v.toFixed(1)), tested: samples.length + tight.length, stuck };
    });
    check('straight walks in every direction from 12 places stay on the walkable area (no water, no trunk, not round the house)', b.nEscapes === 0, { n: b.nEscapes, first: b.escapes });
    check('a long random walk stays on the walkable area and out of every collider', b.bad === 0, { bad: b.bad, why: b.why, box: b.box });
    check('the random walk covers the new area (from the facade to the shore, the meadow and the edge of the wood)', b.box[0] < -12 && b.box[1] > 15 && b.box[3] > 40, b.box);
    check('nowhere stuck: from every tested spot you can walk on', b.stuck.length === 0, { tested: b.tested, stuck: b.stuck });
  }

  // ---- 3. the glass doors -----------------------------------------------------------------------------------------
  if (want('doors')) {
    const d = await page.evaluate(() => {
      const H = window.__od2, w = window.__app.world, p = w.player, D = w.door;
      const V = p.position.constructor;
      // furniture near the doors (seats, tables, plants): their colliders
      const furniture = w.colliders.filter((c) => !c.door && !c.doorLeaf && c.max[1] > 0.3 && c.min[1] < 2.4 && c.min[0] < D.x + 4 && c.max[0] > D.x - 4 && c.min[2] < D.z + 3 && c.max[2] > D.z - 3 && (c.max[0] - c.min[0]) < 3 && (c.max[2] - c.min[2]) < 3);
      const leafBoxes = () => D.rows.flat().filter((c) => c.max[1] > 0);
      const overlap = (a, b) => a.min[0] < b.max[0] - 0.005 && a.max[0] > b.min[0] + 0.005 && a.min[2] < b.max[2] - 0.005 && a.max[2] > b.min[2] + 0.005;
      const hitsPlayer = () => leafBoxes().some((c) => { const x = Math.max(c.min[0], Math.min(p.position.x, c.max[0])), z = Math.max(c.min[2], Math.min(p.position.z, c.max[2])); return Math.hypot(x - p.position.x, z - p.position.z) < 0.3; });
      const leafFarZ = () => D.leaves.map((pv) => new V(...pv.userData.far).applyMatrix4(pv.children[0].matrixWorld).z);
      let furnitureHits = 0, playerHits = 0, followMiss = 0;
      const watch = () => {
        if (leafBoxes().some((c) => furniture.some((f) => overlap(c, f)))) furnitureHits++;
        if (hitsPlayer()) playerHits++;
        // the boxes follow the leaves: the free edge of each leaf lies in its row
        D.leaves.forEach((pv, i) => {
          if (D.t === 0) return;
          const e = new V(...pv.userData.far).applyMatrix4(pv.children[0].matrixWorld);
          if (!D.rows[i].some((c) => e.x >= c.min[0] - 0.01 && e.x <= c.max[0] + 0.01 && e.z >= c.min[2] - 0.01 && e.z <= c.max[2] + 0.01)) followMiss++;
        });
      };
      const walkWatch = (tx, tz, steps = 200) => { p.keys.clear(); p.keys.add('KeyW'); for (let i = 0; i < steps; i++) { const dx = tx - p.position.x, dz = tz - p.position.z; if (Math.hypot(dx, dz) < 0.3) break; p.yaw = Math.atan2(-dx, -dz); H.step(); watch(); } p.keys.clear(); for (let i = 0; i < 30; i++) { H.step(); watch(); } };
      const settle = (n = 60) => { for (let i = 0; i < n; i++) { H.step(); watch(); } };
      // from the hall: out
      H.pose(0.2, 1.5, Math.PI); settle(60);
      const shut0 = { t: D.t, shutOn: D.shut.max[1] > 0 };
      walkWatch(0.2, 4.6, 120);
      const out = { t: D.t, swing: D.swing, far: leafFarZ().map((z) => +(z - D.z).toFixed(2)) };
      walkWatch(0.3, 8.2); walkWatch(1.0, 11.5); settle(60);
      const closedOut = { t: D.t, shutOn: D.shut.max[1] > 0 };
      // from the garden: in
      walkWatch(0.3, 7.0, 200);
      const inn = { t: D.t, swing: D.swing, far: leafFarZ().map((z) => +(z - D.z).toFixed(2)) };
      walkWatch(0.1, 4.2); walkWatch(0.0, 2.2);
      // turning back at once while the doors close towards you: they shut first, then open outwards
      let closedFirst = false; p.keys.clear(); p.keys.add('KeyW');
      for (let i = 0; i < 160; i++) { const dx = 0 - p.position.x, dz = 4.5 - p.position.z; p.yaw = Math.atan2(-dx, -dz); H.step(); watch(); if (D.t === 0) closedFirst = true; if (Math.hypot(dx, dz) < 0.3) break; }
      p.keys.clear(); settle(40);
      const back = { t: D.t, swing: D.swing, closedFirst };
      walkWatch(0.0, 0.5); settle(60);
      return { shut0, out, closedOut, inn, back, furniture: furniture.length, furnitureHits, playerHits, followMiss };
    });
    check('the doors are shut when nobody is near', d.shut0.t === 0 && d.shut0.shutOn, d.shut0);
    check('leaving the hall they swing outwards onto the deck', d.out.t === 1 && d.out.swing === 1 && d.out.far.every((z) => z > 0.9), d.out);
    check('and close behind you', d.closedOut.t === 0 && d.closedOut.shutOn, d.closedOut);
    check('coming in from the garden they swing inwards into the hall', d.inn.t === 1 && d.inn.swing === -1 && d.inn.far.every((z) => z < -0.9), d.inn);
    check('turning back while they close towards you: they shut first, then open away from you', d.back.closedFirst && d.back.t === 1 && d.back.swing === 1, d.back);
    check('the leaves never swing into the furniture or into you', d.furnitureHits === 0 && d.playerHits === 0, { furniture: d.furniture, furnitureHits: d.furnitureHits, playerHits: d.playerHits });
    check('the colliders follow the leaves while they turn', d.followMiss === 0, { miss: d.followMiss });
  }

  // ---- 4. the rain ------------------------------------------------------------------------------------------------
  if (want('rain')) {
    const r = await page.evaluate(() => {
      const H = window.__od2, w = window.__app.world, O = H.O, env = w.env, wx = env.weather, U = wx.shared;
      const field = env.garden.heightField;
      // the data the shaders get: the roofs cover the rooms (with a margin), the height field is the ground
      let seed = 5; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      // every spot of the house (its walls and 20 cm beyond them) lies under a roof the drops end on, above the ceiling
      const parts = [[-8.85, 8.85, -5.85, 5.85, 5.4], [-2.05, 2.05, -9.2, -5.5, 3.1], [-11.35, 11.35, -23.95, -8.85, 5.0]];
      let roofMiss = 0;
      for (const [x0, x1, z0, z1, ceil] of parts) for (let i = 0; i < 3000; i++) {
        const x = x0 - 0.2 + rnd() * (x1 - x0 + 0.4), z = z0 - 0.2 + rnd() * (z1 - z0 + 0.4);
        if (z > 5.85 + 0.2) continue;
        const s = wx.surface(x, z);
        if (!s.roof || s.y < ceil) roofMiss++;
      }
      const roofs = roofMiss === 0 && U.uRoofY.value.x > 5.4 && U.uRoofY.value.y > 3.1 && U.uRoofY.value.z > 5.0;
      let fieldErr = 0, meshErr = 0, below = 0, n = 0;
      const box = [field.x0 + 0.5, field.x0 + field.w - 0.5, field.z0 + 0.5, field.z0 + field.d - 0.5];
      for (let i = 0; i < 20000; i++) {
        const x = box[0] + rnd() * (box[1] - box[0]), z = box[2] + rnd() * (box[3] - box[2]);
        const t = O.terrainHeight(x, z), f = field.sample(x, z), s = wx.surface(x, z);
        fieldErr = Math.max(fieldErr, Math.abs(f - t)); meshErr = Math.max(meshErr, Math.abs(f - field.meshAt(x, z)));
        if (s.y < Math.max(t, O.waterY) - 0.06 || (!s.roof && s.y < O.groundHeight(x, z) - 0.06)) below++;
        n++;
      }
      // the drops themselves (the shader's arithmetic in JS): where each one ends, for eyes on the deck, on the lawn,
      // on the jetty, in the hall and in the book room
      const fract = (v) => v - Math.floor(v), mod = (a, b) => a - b * Math.floor(a / b);
      const eyes = [[0.3, 7.5], [-2, 20], [...O.jetty.at(8, 0)], [0, 1], [0, -15]];
      let drops = 0, endBelow = 0, inside = 0, minAbove = 99;
      // the ceiling over a spot inside (null outside the rooms)
      const ceiling = (x, z) => (Math.abs(x) < 8.5 && z > -5.5 && z < 5.5 ? 5.4 : Math.abs(x) < 1.7 && z <= -5.5 && z > -9.2 ? 3.1 : Math.abs(x) < 11 && z <= -9.2 && z > -23.6 ? 5.0 : null);
      for (const [ex, ez] of eyes) {
        const ground = O.outside(ex, ez) ? O.groundHeight(ex, ez) : 0, B = [40, 24, 40], fall = 11.5, wind = [3.6, 1.1];
        for (let i = 0; i < 6000; i++) {
          const sd = [rnd(), rnd(), rnd()], ra = [rnd(), rnd()], time = rnd() * 600, speed = 0.85 + 0.3 * ra[1];
          const pp = [sd[0] * B[0] + wind[0] * time, sd[1] * B[1] - fall * speed * time, sd[2] * B[2] + wind[1] * time];
          const o = [ex - B[0] / 2, ground - 6, ez - B[2] / 2];
          const head = pp.map((v, k) => o[k] + mod(v - o[k], B[k]));
          const vel = [wind[0], -fall * speed, wind[1]], vl = Math.hypot(...vel), len = 0.5 * (0.6 + 0.8 * ra[0]) * speed;
          const tail = head.map((v, k) => v - vel[k] / vl * len);
          const s = wx.surface(head[0], head[2]).y;
          if (tail[1] <= s) continue;                       // landed: hidden, its splash shows
          let end = head;
          if (head[1] < s) { const f = (tail[1] - s) / (tail[1] - head[1]); end = tail.map((v, k) => v + (head[k] - v) * f); }
          drops++;
          const tg = Math.max(O.terrainHeight(end[0], end[2]), O.waterY);
          minAbove = Math.min(minAbove, end[1] - tg);
          if (end[1] < tg - 0.06) endBelow++;
          // a streak never reaches into the rooms: both of its ends stay above the roof over them
          for (const q of [end, tail]) { const c = ceiling(q[0], q[2]); if (c !== null && q[1] < c) inside++; }
        }
      }
      return { roofs, roofMiss, n, fieldErr: +fieldErr.toFixed(3), meshErr: +meshErr.toFixed(3), below, drops, endBelow, inside, minAbove: +minAbove.toFixed(3) };
    });
    check('the roofs the rain ends on cover the hall, the passage and the book room', r.roofs, { miss: r.roofMiss });
    check('the height field the drops end on is the ground as drawn (within 4 cm; 8 cm of the exact terrain)', r.meshErr < 0.04 && r.fieldErr < 0.08, { mesh: r.meshErr, terrain: r.fieldErr, samples: r.n });
    check('what a drop lands on is never below the ground, the water, the deck or the jetty', r.below === 0, { below: r.below });
    check('rain drops never end below the ground', r.endBelow === 0, { drops: r.drops, endBelow: r.endBelow, lowest: r.minAbove });
    check('no rain in the rooms (every streak ends on the roof above them)', r.inside === 0, { inside: r.inside });
  }

  // ---- 5. frame times outside -------------------------------------------------------------------------------------
  if (want('perf')) {
    // Other programs on the graphics card make single frames late (their work comes in between, and the browser waits
    // for the card inside the draw calls). How busy the card is with them is measured while this world stands still;
    // the frame-time budget is judged only on a card of its own. The work besides drawing and the median CPU time of
    // a frame with the card idle at its start are judged always.
    const busyNow = () => { try { return parseFloat(require('child_process').execSync('nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits', { timeout: 5000 }).toString()); } catch { return NaN; } };
    const busy = async () => { const v = []; for (let i = 0; i < 7; i++) { const b = busyNow(); if (!Number.isNaN(b)) v.push(b); await sleep(250); } v.sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; };
    for (const weather of ['fog', 'rain']) {
      await page.evaluate(() => window.__app.world.stop());
      await sleep(600);
      const others = await busy();
      const res = await page.evaluate(async (weather) => {
        const w = window.__app.world, p = w.player, H = window.__od2, J = H.O.jetty;
        w.applySettings({ ...w.settings, weather, timeMode: 'fixed', fixedHour: 15, graphics: { ...w.settings.graphics, quality: 'high', bloom: true, shadows: true, ssao: true, resolutionScale: 1, fov: 72 } });
        H.pose(0.3, 7.2, Math.PI);
        const programs0 = w.renderer.info.programs.length, known = new Set(w.renderer.info.programs);
        const cpu = [], work = [], gaps = [], slow = [];
        let stalls = 0;   // frames over 25 ms in which a program was compiled
        const orig = w.frame.bind(w), comp = w.composer, origRender = comp.render.bind(comp), envUp = w.env.update.bind(w.env);
        let tr = 0, te = 0;
        comp.render = (dt) => { const a = performance.now(); origRender(dt); tr = performance.now() - a; };
        w.env.update = (dt, cam) => { const a = performance.now(); envUp(dt, cam); te = performance.now() - a; };
        w.frame = () => {
          const a = performance.now(), np = w.renderer.info.programs.length; orig(); const t = performance.now() - a; cpu.push(t); work.push(t - tr);
          if (t > 25 && w.renderer.info.programs.length > np) stalls++;
          if (t > 25 && slow.length < 12) slow.push({ i: cpu.length, t: +t.toFixed(1), render: +tr.toFixed(1), env: +te.toFixed(1), at: [+p.position.x.toFixed(1), +p.position.z.toFixed(1)], newProg: w.renderer.info.programs.length - np });
        };
        w.start();
        await new Promise((r) => setTimeout(r, 1200));     // the first frames after the settings change
        cpu.length = 0; work.length = 0;
        let last = 0, on = true;
        const tick = (t) => { if (last) gaps.push(t - last); last = t; if (on) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        const route = [[0.2, 12.5], [-1.4, 17], [-4.4, 22.5], [-8.6, 27.5], [-12.6, 30.6], J.root, J.at(J.len - J.platLen - 0.5, 0), J.root, [-13.2, 37.6], [-10.6, 42.5], [-9.6, 48], [-3.5, 54], [8.6, 49], [11, 44.4], [10, 33], [3, 22]];
        p.keys.clear(); p.keys.add('KeyW');
        let leg = 0; const t0 = performance.now();
        while (leg < route.length && performance.now() - t0 < 60000) {
          const [tx, tz] = route[leg], dx = tx - p.position.x, dz = tz - p.position.z;
          if (Math.hypot(dx, dz) < 0.8) { leg++; continue; }
          p.yaw = Math.atan2(-dx, -dz);
          await new Promise((r) => setTimeout(r, 30));
        }
        p.keys.clear(); on = false;
        w.stop(); w.frame = orig; comp.render = origRender; w.env.update = envUp;
        // eight places on the way once more, standing, every frame started on an idle card: its CPU time alone
        const gl = w.renderer.getContext(), px = new Uint8Array(4), idle = [];
        const views = [[0.4, 8.6, 2.455], [-2, 16, 2.6], [-12, 30.5, 2.3], [...J.at(J.len - 1.2, 0), J.yaw + Math.PI], [-20, 36, 2.2], [-8.6, 44, 1.75], [14.9, 44.6, 1.571], [6, 30, 0.6]];
        for (const [x, z, yaw] of views) {
          H.pose(x, z, yaw, -0.03);
          for (let i = 0; i < 8; i++) w.frame();
          for (let i = 0; i < 30; i++) {
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            const a = performance.now(); w.frame(); idle.push(performance.now() - a);
            p.yaw += 0.01;
            await new Promise((r) => setTimeout(r, 2));
          }
        }
        const added = w.renderer.info.programs.filter((q) => !known.has(q)).map((q) => q.name + ' ' + String(q.cacheKey));
        const st = (a) => { const s = [...a].sort((x, y) => x - y), q = (f) => +(s[Math.min(s.length - 1, Math.floor(f * s.length))] || 0).toFixed(2); return { n: s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1), over25: s.filter((x) => x > 25).length }; };
        return { weather, legs: leg, of: route.length, cpu: st(cpu), work: st(work), idle: st(idle), frames: st(gaps), programs: w.renderer.info.programs.length - programs0, added, slow, stalls };
      }, weather);
      console.log(`PERF ${res.weather} others=${others ?? '?'}% legs=${res.legs}/${res.of} cpu=${JSON.stringify(res.cpu)} work=${JSON.stringify(res.work)} idle=${JSON.stringify(res.idle)} frames=${JSON.stringify(res.frames)} newPrograms=${res.programs}`);
      if (res.slow.length || res.added.length) console.log(`PERF-SLOW ${res.weather} ${JSON.stringify(res.slow)} added=${JSON.stringify(res.added)}`);
      // a program compiled on the way counts when a frame waited for it (a small depth shader of a caster that first
      // enters the sun's map compiles within an ordinary frame)
      const stalled = res.stalls;
      check(`walking outside in ${weather}: the whole route, no frame waits for a shader`, res.legs === res.of && (res.programs === 0 || stalled === 0), { legs: res.legs, programs: res.programs, stalled });
      check(`walking outside in ${weather}: the work besides drawing (player, doors, weather, the garden's detail) median ≤ 1 ms, p95 ≤ 3 ms`, res.work.p50 <= 1 && res.work.p95 <= 3, res.work);
      check(`outside in ${weather}, 8 places: CPU time per frame with the graphics card idle at its start, median ≤ 6 ms`, res.idle.p50 <= 6, res.idle);
      const budget = `outside in ${weather}: CPU time per frame p95 ≤ 8 ms walking and standing, hardly a frame over 25 ms (walking at most one in 200, standing none)`;
      if (others !== null && others <= 15) check(budget, res.cpu.p95 <= 8 && res.cpu.over25 <= res.cpu.n / 200 && res.idle.p95 <= 8 && res.idle.over25 === 0, { walking: res.cpu, standing: res.idle });
      else skip(budget, others === null ? 'no reading of the graphics card' : `the graphics card was ${others} % busy with other programs`, { walking: res.cpu, standing: res.idle });
    }
  }

  // ---- 6. pictures ----------------------------------------------------------------------------------------------------
  if (want('shots')) {
    const views = [
      ['deck', 0.4, 8.6, 2.455, 0.0, 'fog'], ['jetty', -17.5, 34.0, 2.16, -0.08, 'fog'], ['bay', -8.6, 44.0, 1.75, -0.22, 'clear'],
      ['knoll', 14.9, 44.6, 1.571, -0.05, 'clear'], ['platform', -25.6, 39.6, 2.3, -0.12, 'clear'], ['rain-hall', 0.3, 2.2, Math.PI, 0.05, 'rain'], ['rain-jetty', -17.5, 34.0, 2.16, -0.1, 'rain'], ['snow-lake', -12.4, 30.8, 2.3, -0.1, 'snow'],
    ];
    for (const [name, x, z, yaw, pitch, weather] of views) {
      await page.evaluate(([x, z, yaw, pitch, weather]) => {
        const w = window.__app.world;
        w.applySettings({ ...w.settings, weather, timeMode: 'fixed', fixedHour: 15 });
        window.__od2.pose(x, z, yaw, pitch);
        for (let i = 0; i < 30; i++) w.updateDoor(0.05);
      }, [x, z, yaw, pitch, weather]);
      for (let i = 0; i < 12; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(50); }
      await shot(`${tag}-${name}`);
    }
  }
  console.log(`OD2 ${failures ? 'FAILED ' + failures : 'OK'} (${passes} passed${skipped ? ', ' + skipped + ' skipped' : ''})`);
};
