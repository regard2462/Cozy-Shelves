// Controls: the jump (Space while standing), standing up with W A S D, the click on things, no text while looking
// at a book (its cover card only) and a small label below the crosshair for everything else (since 0.6, hud-check
// covers the labels in detail). The world loop rests; the script steps the player itself (player.update) and sends the key and mouse
// events main.js listens to. Pointer lock cannot be taken in the hidden test window: where a click needs the caught
// mouse, the script sets player.locked, and the click that would catch the mouse runs as a real (trusted) click.
// Runs muted and hidden like every harness script.
//   node build/screenshot.js controls-check
module.exports = async ({ page, shot, sleep }) => {
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
  const errors = [];
  page.on('pageerror', (e) => { if (!/pointer lock/i.test(e.message)) errors.push(e.message); });

  // ---- boot -------------------------------------------------------------------------------------------------------
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 45; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active, hud: document.querySelector('#scan-status')?.textContent || '' }));
    if (!st.active && !st.hud && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(2500);
  await page.evaluate(() => { window.__app.world.stop(); window.__app.closeAllPanels(); });
  // a book a former run with the same COZYSHELVES_USERDATA left in the basket goes back first (the return desk below
  // opens the basket only while it is empty)
  await page.evaluate(() => { const a = window.__app.world.actions; if (a.basket.length) { a.returnAll(); for (let i = 0; i < 40; i++) a.update(0.05); } });
  await sleep(600);

  // ---- helpers inside the page ---------------------------------------------------------------------------------------
  await page.evaluate(() => {
    const w = window.__app.world, p = w.player;
    const V3 = p.position.constructor;
    const sfx = [];
    const audio = window.__app.ctx.audio, origSfx = audio.sfx.bind(audio);
    audio.sfx = (name, o) => { sfx.push({ name, volume: o?.volume ?? null, t: performance.now() }); return origSfx(name, o); };
    window.__cc = {
      V3, sfx,
      EYE: 1.62,
      /** stand at (x, z) looking at (tx, ty, tz) and run the look ray */
      aim(x, z, tx, ty, tz) {
        if (w.actions.seatedId || p.seated) w.actions.leaveSeat();
        p.transition = null;
        p.setPose(x, z, Math.atan2(-(tx - x), -(tz - z)), Math.atan2(ty - 1.62, Math.hypot(tx - x, tz - z)));
        return this.look();
      },
      // (the world loop rests: moved meshes such as the books on the table get their matrices only here)
      look() { p.update(0.001); w.scene.updateMatrixWorld(); w.camera.updateMatrixWorld(); w.actions.rayTimer = 0; w.actions.update(0.001); return this.target(); },
      target() { const t = w.actions.target; return t ? { type: t.type, kind: t.kind || null, seat: t.seat?.id || null, book: t.book?.id || t.id || null, near: t.near ?? null, distance: t.distance != null ? +t.distance.toFixed(2) : null } : null; },
      key(code, key, type = 'keydown', extra = {}) { document.dispatchEvent(new KeyboardEvent(type, { code, key, bubbles: true, cancelable: true, ...extra })); },
      press(code, key, extra = {}) { this.key(code, key, 'keydown', extra); this.key(code, key, 'keyup'); },
      mouse(button = 0, type = 'mousedown') { w.renderer.domElement.dispatchEvent(new MouseEvent(type, { button, bubbles: true, cancelable: true })); },
      step(n, dt) { for (let i = 0; i < n; i++) p.update(dt); },
      /** fly one jump: camera height over the eye per step until standing still again */
      fly(dt = 1 / 120, maxT = 2) {
        const rec = []; let t = 0, landed = null, airMax = 0;
        while (t < maxT) {
          p.update(dt); t += dt;
          const y = w.camera.position.y - p.position.y;
          rec.push(y); airMax = Math.max(airMax, p.air ? p.air.y : 0);
          if (landed == null && !p.air) landed = t;
          if (landed != null && t - landed > 0.6) break;
        }
        const apex = Math.max(...rec), low = Math.min(...rec);
        const settleAt = (() => { for (let i = rec.length - 1; i >= 0; i--) if (Math.abs(rec[i]) > 0.001) return (i + 1) * dt; return 0; })();
        return { apex: +apex.toFixed(3), airtime: landed != null ? +landed.toFixed(3) : null, dip: +(-low).toFixed(3), settled: +settleAt.toFixed(3), airMax: +airMax.toFixed(3) };
      },
      /** in front of the picture in the passage (slot 6), 1.8 m away: nothing stands between */
      painting() { const pt = w.paintings.find((x) => x.slot === 6) || w.paintings.find((x) => x.obj.visible); const o = pt.obj.position, r = pt.placement.rot; return this.aim(o.x + Math.sin(r) * 1.8, o.z + Math.cos(r) * 1.8, o.x, o.y, o.z); },
      panels() { return [...document.querySelectorAll('.panel-layer:not(.closing)')].map((l) => l.dataset.panel); },
      hud() {
        const cross = document.querySelector('#crosshair'), peek = document.querySelector('#book-peek');
        const peekShown = peek.classList.contains('show');
        const card = peek.querySelector('.peek-card');
        const outside = card ? [...card.childNodes].filter((n) => !(n.classList && n.classList.contains('peek-cover'))) : [];
        // every visible text in the HUD within 260 px of the screen centre (what pops up while looking at something)
        const cx = innerWidth / 2, cy = innerHeight / 2, near = [];
        for (const el of document.querySelectorAll('#hud *')) {
          if (el.closest('#book-peek')) continue;
          const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
          if (!text) continue;
          const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
          if (!r.width || cs.visibility === 'hidden' || +cs.opacity === 0 || el.closest('.hidden')) continue;
          let o = el, op = 1; while (o && o !== document.body) { op *= +getComputedStyle(o).opacity; o = o.parentElement; }
          if (op < 0.05) continue;
          if (Math.abs(r.left + r.width / 2 - cx) < 260 && Math.abs(r.top + r.height / 2 - cy) < 260) near.push(text.slice(0, 60));
        }
        return {
          hintEl: !!document.querySelector('#hint'), ring: cross.classList.contains('active'), peek: peekShown,
          peekTitle: !!peek.querySelector('.peek-title, .peek-author, .peek-meta, .peek-chip'),
          peekOutside: outside.map((n) => (n.className || '') + ':' + (n.textContent || '').trim()),
          // the cover image, the title card (drawn on a canvas since 0.6) or the stand-in of a book without a cover yet
          peekCover: !!peek.querySelector('.peek-cover img, .peek-cover canvas, .peek-cover .peek-fallback'),
          nearText: near,
        };
      },
    };
  });
  const cc = (fn, arg) => page.evaluate(fn, arg);

  // ================================================================= 1. the jump ==================================================
  // an open spot in the hall between the reading table and the fireplace sofa
  const J = { x: -0.8, z: 1.4 };
  const base = await cc((J) => { const c = window.__cc, w = window.__app.world, p = w.player; c.aim(J.x, J.z, J.x, 1.62, J.z - 3); return { free: p.isFree(J.x, J.z, 0.05), room: p.headroom(J.x, J.z), overhead: p.overhead.length, y: w.camera.position.y }; }, J);
  console.log('JUMP SPOT ' + JSON.stringify(base));
  const arc = await cc(() => {
    const c = window.__cc, p = window.__app.world.player;
    const x0 = p.position.x, z0 = p.position.z, n0 = c.sfx.length;
    c.press('Space', ' ');
    const started = !!p.air;
    const r = c.fly(1 / 120);
    return { started, ...r, moved: +Math.hypot(p.position.x - x0, p.position.z - z0).toFixed(4), sounds: c.sfx.slice(n0).map((s) => s.name + '@' + s.volume) };
  });
  check('Space while standing starts a jump', arc.started, arc);
  // (0.6 m since 0.6: with the ledge assist high enough for a table of 0.76 m, interior-check)
  check('jump apex 0.57 to 0.63 m above the eye', arc.apex >= 0.57 && arc.apex <= 0.63, arc.apex);
  check('about 0.63 s in the air (0.58 to 0.68 s)', arc.airtime >= 0.58 && arc.airtime <= 0.68, arc.airtime);
  check('landing: the camera dips 3 to 8 cm and is back at eye height within 0.45 s', arc.dip >= 0.03 && arc.dip <= 0.08 && arc.settled - arc.airtime <= 0.45, { dip: arc.dip, settled: arc.settled, airtime: arc.airtime });
  check('a jump on the spot does not move the player', arc.moved < 1e-4, arc.moved);
  check('the landing sounds like a firm step (footstep sfx)', arc.sounds.some((s) => s.startsWith('footstep')), arc.sounds);
  // the same arc at 30 frames a second (the vertical motion is exact for constant gravity)
  const arc30 = await cc(() => { const c = window.__cc; c.press('Space', ' '); return c.fly(1 / 30); });
  check('the arc does not depend on the frame rate (30 vs 120 fps)', Math.abs(arc30.airMax - arc.airMax) < 0.005 && Math.abs(arc30.airtime - arc.airtime) < 0.04, { fps30: arc30, fps120: { airMax: arc.airMax, airtime: arc.airtime } });

  // held key and a second press in the air: one jump only
  const held = await cc(() => {
    const c = window.__cc, p = window.__app.world.player;
    c.key('Space', ' ');                                   // down
    const first = !!p.air;
    c.step(12, 1 / 60);
    c.key('Space', ' ', 'keydown', { repeat: true });      // auto repeat of the held key
    c.key('Space', ' ', 'keyup');
    c.press('Space', ' ');                                 // a new press while still in the air
    const vBefore = p.air ? +p.air.v.toFixed(3) : null;
    c.step(1, 1 / 60);
    const r = c.fly(1 / 60);
    c.key('Space', ' ', 'keydown', { repeat: true });      // repeat after the landing: no new jump
    const again = !!p.air;
    return { first, vBefore, airtimeRest: r.airtime, again };
  });
  check('no second jump in the air, a held (repeating) Space does not jump again', held.first && held.vBefore < 3 && held.airtimeRest < 0.5 && !held.again, held);

  // jumping while walking keeps the momentum; no footsteps in the air
  const walkJump = await cc(() => {
    const c = window.__cc, w = window.__app.world, p = w.player;
    c.aim(-0.8, 3.2, -0.8, 1.62, -3);                     // look along -z towards the fireplace side of the hall
    c.key('KeyW', 'w');
    c.step(60, 1 / 60);                                    // up to walking speed
    const z0 = p.position.z, n0 = c.sfx.length;
    c.press('Space', ' ');
    let t = 0, camMax = 0, inAir = 0, landing = [];
    while (p.air && t < 1) {
      const before = c.sfx.length;
      p.update(1 / 60); t += 1 / 60;
      if (p.air) inAir += c.sfx.length - before;      // the update that lands plays the landing step
      else landing = c.sfx.slice(before).map((s) => s.name);
      camMax = Math.max(camMax, w.camera.position.y - p.position.y);
    }
    const travelled = z0 - p.position.z;
    c.step(20, 1 / 60);
    c.key('KeyW', 'w', 'keyup');
    return { travelled: +travelled.toFixed(2), airtime: +t.toFixed(2), camMax: +camMax.toFixed(2), soundsInAir: inAir, landing };
  });
  check('jumping while walking: carried forward 1.2 to 1.8 m in the air', walkJump.travelled > 1.2 && walkJump.travelled < 1.8 && walkJump.camMax > 0.5, walkJump);
  check('no footsteps while in the air, one step on landing', walkJump.soundsInAir === 0 && walkJump.landing.join() === 'footstep', walkJump);

  // walking into the reading table stops at its edge (the legs keep 15 cm from low furniture); a jump there lands on top
  // of it (since 0.6, interior-check)
  const table = await cc(() => {
    const c = window.__cc, w = window.__app.world, p = w.player;
    const run = (jump) => {
      c.aim(1.6, -0.2, 1.6, 1.62, -6);                    // south of the reading table (1.6, -2.4), walking north into it
      c.key('KeyW', 'w');
      let minZ = Infinity, stuckIn = false;
      for (let i = 0; i < 150; i++) {
        if (jump && i % 40 === 20) c.press('Space', ' ');
        p.update(1 / 60); minZ = Math.min(minZ, p.position.z);
        if (!jump && !p.isFree(p.position.x, p.position.z, -0.18)) stuckIn = true;
      }
      c.key('KeyW', 'w', 'keyup');
      return { z: +p.position.z.toFixed(3), minZ: +minZ.toFixed(3), stuckIn, ground: +p.ground.toFixed(3) };
    };
    return { walk: run(false), jump: run(true) };
  });
  check('walking into the table stops at its edge, a jump there lands on top of it (0.76 m)', !table.walk.stuckIn && table.walk.minZ > -1.9 && table.walk.ground === 0 && table.jump.ground === 0.76, table);

  // --------------------------------------------------------------- headroom: lamps, sconces, lintels, ceilings ----
  const sweep = await cc(() => {
    const w = window.__app.world, p = w.player, c = window.__cc, V3 = c.V3;
    const Ray = w.actions.raycaster.constructor;
    // every mesh of the building and its furniture (the merged batches duplicate them, the books stand in the cases).
    // The big ones (walls with their lintels, floors, ceilings) are tested straight up only: the colliders keep the
    // eye 0.32 m from every wall, and a jump does not change that distance.
    const small = [], big = [];
    const walk = (o) => {
      if (o.userData?.batch) return;
      if (o.isMesh && !o.isInstancedMesh && o.geometry) {
        o.geometry.boundingBox || o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
        if (bb.max.x - bb.min.x > 6 || bb.max.z - bb.min.z > 6) big.push(o); else small.push({ o, bb });
      }
      for (const ch of o.children) walk(ch);
    };
    w.static.updateMatrixWorld(true); walk(w.static); walk(w.dynamic);
    const rc = new Ray(); rc.far = 1.2;
    const UPWARD = new V3(0, 1, 0);
    const dirs = [UPWARD];
    for (const el of [10, 45, 75]) for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, e = el * Math.PI / 180; dirs.push(new V3(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a))); }
    const label = (o) => o.userData?.root?.userData?.placement?.kind || o.parent?.userData?.placement?.kind || o.name || o.parent?.name || '?';
    const nearest = (x, y, z) => {
      const cand = small.filter((m) => m.bb.max.x > x - 1.3 && m.bb.min.x < x + 1.3 && m.bb.max.z > z - 1.3 && m.bb.min.z < z + 1.3 && m.bb.max.y > y - 0.3 && m.bb.min.y < y + 1.3).map((m) => m.o);
      let best = Infinity, what = null;
      const origin = new V3(x, y, z);
      for (const d of dirs) { rc.set(origin, d); const h = rc.intersectObjects(cand, false)[0]; if (h && h.distance < best) { best = h.distance; what = label(h.object); } }
      rc.set(origin, UPWARD); const hb = rc.intersectObjects(big, false)[0]; if (hb && hb.distance < best) { best = hb.distance; what = label(hb.object) + ' (building)'; }
      return { d: best, what };
    };
    const zones = {
      hall: (x, z) => x > -8.2 && x < 8.2 && z > -5.2 && z < 5.2,
      passage: (x, z) => Math.abs(x) < 1.5 && z > -9.0 && z < -5.7,
      room: (x, z) => x > -10.7 && x < 10.7 && z > -23.3 && z < -9.5,
    };
    const out = {}, bad = [], lowSpots = [];
    for (const [name, inZone] of Object.entries(zones)) {
      let n = 0, minApex = Infinity, minClear = Infinity, minWhat = null, limited = 0;
      for (let x = -10.5; x <= 10.5; x += 0.5) for (let z = -23; z <= 5; z += 0.5) {
        if (!inZone(x, z) || !p.isFree(x, z, 0)) continue;
        p.transition = null; p.setPose(x, z, 0, 0);
        n++;
        if (!p.jump()) { bad.push({ x, z, why: 'no jump' }); continue; }
        let apex = 0; for (let i = 0; i < 90 && p.air; i++) { p.update(1 / 120); apex = Math.max(apex, p.air ? p.air.y : 0); }
        p.update(0.5);
        minApex = Math.min(minApex, apex);
        if (apex < 0.58) { limited++; if (lowSpots.length < 6) lowSpots.push({ x, z, apex: +apex.toFixed(2) }); }
        const top = nearest(x, 1.62 + apex, z);
        if (top.d < minClear) { minClear = top.d; minWhat = top.what + ' at ' + x + ',' + z; }
        if (top.d < 0.12) {
          // only what the jump brings closer counts (something already that near at eye height is not the jump's doing)
          const ground = nearest(x, 1.62, z);
          if (top.d < ground.d - 0.01) bad.push({ x, z, apex: +apex.toFixed(2), clear: +top.d.toFixed(3), ground: +ground.d.toFixed(3), what: top.what });
        }
      }
      out[name] = { spots: n, minApex: +minApex.toFixed(3), lowerJumps: limited, minClearAtApex: +minClear.toFixed(3), nearest: minWhat };
    }
    // straight up at the apex of a real jump in the middle of the passage (ceiling 3.1 m, its pendant lamp)
    p.setPose(0, -7.35, 0, 0); p.jump();
    let passApex = 0; for (let i = 0; i < 90 && p.air; i++) { p.update(1 / 120); passApex = Math.max(passApex, p.air ? p.air.y : 0); }
    p.update(0.5);
    const passageUp = nearest(0, 1.62 + passApex, -7.35);
    p.setPose(0, 0, 0, 0);
    return { zones: out, bad: bad.slice(0, 8), badCount: bad.length, lowSpots, passageUp: +passageUp.d.toFixed(2), passageWhat: passageUp.what, overhead: p.overhead.map((o) => o.what + '@' + o.y.toFixed(2) + '[' + [o.x0, o.x1, o.z0, o.z1].map((v) => v.toFixed(1)).join(',') + ']') };
  });
  console.log('HEADROOM ' + JSON.stringify(sweep));
  check('every free spot allows a jump and nothing overhead comes within 12 cm of the eye at the apex', sweep.badCount === 0 && Object.values(sweep.zones).every((z) => z.spots > 20), { bad: sweep.bad, zones: sweep.zones });
  // (right under the passage's pendant the 0.6 m jump ends at the head clearance of player.js, 0.18 m below the shade)
  check('in the passage (ceiling 3.1 m, pendant lamp) the apex stays clear', sweep.passageUp >= 0.17, { up: sweep.passageUp, what: sweep.passageWhat });

  // a low lamp right above the head: the jump only rises as far as the room allows; in the air you cannot move under it
  const low = await cc(() => {
    const c = window.__cc, w = window.__app.world, p = w.player;
    const lamp = { x0: -1.3, x1: -0.3, z0: 0.9, z1: 1.9, y: 2.0 };
    p.overhead.push(lamp);
    try {
      c.aim(-0.8, 1.4, -0.8, 1.62, -3);
      c.press('Space', ' ');
      const under = c.fly(1 / 120);
      // from the side: walk towards the lamp and jump just before it
      c.aim(-0.8, 3.0, -0.8, 1.62, -3);
      c.key('KeyW', 'w');
      c.step(20, 1 / 60);
      c.press('Space', ' ');
      const room = 2.0 - 1.62 - 0.18;                   // right under it: 0.18 m below the underside
      let over = -Infinity, stopped = false, zStop = null;
      for (let i = 0; i < 90; i++) {
        const z0 = p.position.z;
        p.update(1 / 60);
        // the eye never rises above what the room at its spot allows (headroom: less the nearer the lamp)
        if (p.air) over = Math.max(over, p.air.y - p.headroom(p.position.x, p.position.z));
        if (p.air && Math.abs(p.position.z - z0) < 1e-6 && !stopped) { stopped = true; zStop = +p.position.z.toFixed(3); }
      }
      c.key('KeyW', 'w', 'keyup');
      return { apexUnder: under.airMax, room: +room.toFixed(2), overshoot: +over.toFixed(4), stoppedInAir: stopped, zStop, lampEdge: lamp.z1, passedUnder: p.position.z < 1.4 };
    } finally { p.overhead.splice(p.overhead.indexOf(lamp), 1); }
  });
  check('under a low lamp the jump rises only as far as the room above the head', Math.abs(low.apexUnder - low.room) < 0.01, low);
  check('in the air the head stops short of the low lamp and never rises above the room, walking on under it afterwards works', low.overshoot <= 0.001 && low.stoppedInAir && low.zStop > low.lampEdge && low.passedUnder, low);

  // ---------------------------------------------------------------- no jump while seated, in a panel, in a move ----
  const seatedSpace = await cc(() => {
    const c = window.__cc, w = window.__app.world, p = w.player, s = w.seats.get('table1a');
    p.transition = null; p.setPose(s.standPos.x, s.standPos.z, s.standYaw, 0);
    w.actions.sit('table1a'); c.step(30, 0.05);
    const seated = !!p.seated;
    c.press('Space', ' ');
    const r = { seated, afterSpace: { seated: !!p.seated, standing: !!p.transition, air: !!p.air } };
    c.press('Space', ' ');                              // during the stand-up move
    r.duringStand = { air: !!p.air, jumped: p.jump() };
    c.step(30, 0.05);
    r.after = { transition: !!p.transition, jump: (() => { c.press('Space', ' '); return !!p.air; })() };
    c.fly(1 / 60);
    return r;
  });
  check('seated: Space stands up and does not jump', seatedSpace.seated && !seatedSpace.afterSpace.seated && seatedSpace.afterSpace.standing && !seatedSpace.afterSpace.air, seatedSpace);
  check('no jump during the stand-up move, a jump once standing', !seatedSpace.duringStand.air && !seatedSpace.duringStand.jumped && !seatedSpace.after.transition && seatedSpace.after.jump, seatedSpace);

  const moveJump = await cc(() => {
    const c = window.__cc, w = window.__app.world, p = w.player;
    c.aim(3.3, -2.8, 3.3, 1.0, -4.7);
    w.actions.standAt([3.3, -3.4, 0]);                  // a walk-to (easel)
    c.press('Space', ' ');
    const r = { inMove: !!p.transition, air: !!p.air };
    c.step(30, 0.05);
    return r;
  });
  check('no jump during a walk-to move', moveJump.inMove && !moveJump.air, moveJump);

  await cc(() => window.__cc.aim(-0.8, 1.4, -0.8, 1.62, -3));
  await cc(() => window.__app.ctx.openPanel('basket', {}));
  await sleep(1200);
  const panelSpace = await cc(() => { const c = window.__cc, p = window.__app.world.player; c.press('Space', ' '); const r = { panels: c.panels(), air: !!p.air, enabled: p.enabled, direct: p.jump() }; return r; });
  await cc(() => window.__app.closeAllPanels()); await sleep(700);
  check('with a panel open Space does not jump', panelSpace.panels.includes('basket') && !panelSpace.air && !panelSpace.enabled && !panelSpace.direct, panelSpace);

  const wheelSpace = await cc(() => { const c = window.__cc, p = window.__app.world.player; window.__app.ctx.openWheel(); const r = { open: !!document.querySelector('#wheel:not(.hidden), .wheel.open'), enabled: p.enabled, direct: p.jump() }; c.press('Escape', 'Escape'); return r; });
  await sleep(500);
  check('with the department wheel open no jump', !wheelSpace.enabled && !wheelSpace.direct, wheelSpace);

  const typing = await cc(() => {
    const c = window.__cc, p = window.__app.world.player;
    const inp = document.createElement('input'); document.body.appendChild(inp); inp.focus();
    inp.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }));
    const r = { air: !!p.air };
    inp.remove();
    return r;
  });
  check('typing a space in a text field does not jump', !typing.air, typing);

  // a jump that ends in sitting down: the view glides on from where the eye is (no jump of the picture)
  const midAir = await cc(() => {
    const c = window.__cc, w = window.__app.world, p = w.player, s = w.seats.get('table1a');
    p.transition = null; p.setPose(s.standPos.x, s.standPos.z, s.standYaw, 0);
    c.press('Space', ' ');
    c.step(16, 1 / 60);
    const y0 = w.camera.position.y;
    w.actions.sit('table1a');
    p.update(1 / 60);
    const y1 = w.camera.position.y;
    c.step(40, 0.05);
    const seated = !!p.seated && p.seatedReady;
    w.actions.leaveSeat();
    return { y0: +y0.toFixed(3), y1: +y1.toFixed(3), step: +Math.abs(y1 - y0).toFixed(3), seated };
  });
  check('sitting down in mid-air glides on from the raised eye (no jump in the picture)', midAir.step < 0.05 && midAir.y0 > 1.8 && midAir.seated, midAir);

  // ================================================================= 2. W A S D stand up ==========================================
  const wasd = await cc(() => {
    const c = window.__cc, w = window.__app.world, p = w.player, s = w.seats.get('table1a');
    const r = {};
    // W is held while walking to the chair and sitting down
    p.transition = null; p.setPose(s.standPos.x, s.standPos.z, s.standYaw, 0);
    c.key('KeyW', 'w');
    w.actions.sit('table1a');
    p.update(0.05);
    c.key('KeyW', 'w', 'keydown', { repeat: true });   // the held key repeats during the sit-down
    c.key('KeyD', 'd');                                 // a fresh press during the sit-down counts neither
    c.key('KeyD', 'd', 'keyup');
    c.step(30, 0.05);
    r.ready = { seated: !!p.seated, ready: !!p.seatedReady, transition: !!p.transition };
    c.key('KeyW', 'w', 'keydown', { repeat: true });   // still held after the sit-down: no stand-up
    r.heldAfter = { seated: !!p.seated, transition: !!p.transition };
    c.key('KeyW', 'w', 'keyup');
    c.key('KeyW', 'w');                                 // a fresh press: stands up
    r.fresh = { seated: !!p.seated, transition: !!p.transition, seatedId: w.actions.seatedId };
    c.key('KeyW', 'w', 'keyup');
    c.step(30, 0.05);
    r.after = { free: p.isFree(p.position.x, p.position.z, 0), x: +p.position.x.toFixed(2), z: +p.position.z.toFixed(2), chip: document.querySelector('#hud-bottom .hud-chip:not(.hidden)')?.textContent || null };
    // every other key of the set, one at a time
    r.keys = {};
    for (const [code, key] of [['KeyA', 'a'], ['KeyS', 's'], ['KeyD', 'd'], ['ArrowUp', 'ArrowUp'], ['ArrowDown', 'ArrowDown'], ['ArrowLeft', 'ArrowLeft'], ['ArrowRight', 'ArrowRight']]) {
      p.transition = null; p.setPose(s.standPos.x, s.standPos.z, s.standYaw, 0);
      w.actions.sit('table1a'); c.step(30, 0.05);
      c.press(code, key);
      r.keys[code] = !p.seated && !!p.transition;
      c.step(30, 0.05);
    }
    return r;
  });
  check('W held while sitting down, a fresh D during the sit-down: still seated, ready once the move is done', wasd.ready.seated && wasd.ready.ready && !wasd.ready.transition, wasd.ready);
  check('the held W (auto repeat) does not stand you up', wasd.heldAfter.seated && !wasd.heldAfter.transition, wasd.heldAfter);
  check('a fresh W stands you up at a free spot', !wasd.fresh.seated && wasd.fresh.transition && wasd.fresh.seatedId === null && wasd.after.free && wasd.after.chip === null, { fresh: wasd.fresh, after: wasd.after });
  check('A, S, D and the arrow keys stand up as well', Object.values(wasd.keys).every(Boolean), wasd.keys);

  const chip = await cc(() => { const c = window.__cc, w = window.__app.world, p = w.player, s = w.seats.get('table1a'); p.transition = null; p.setPose(s.standPos.x, s.standPos.z, s.standYaw, 0); w.actions.sit('table1a'); c.step(30, 0.05); const el = [...document.querySelectorAll('#hud-bottom .hud-chip')].find((x) => !x.classList.contains('hidden')); return el ? el.innerHTML : null; });
  check('seated: the chip says "Leertaste oder WASD Aufstehen"', chip === '<kbd>Leertaste</kbd> oder <kbd>WASD</kbd> Aufstehen', chip);
  await cc(() => window.__app.ctx.openPanel('basket', {}));
  await sleep(1200);
  const wPanel = await cc(() => { const c = window.__cc, p = window.__app.world.player; c.press('KeyW', 'w'); return { panels: c.panels(), seated: !!p.seated }; });
  await cc(() => window.__app.closeAllPanels()); await sleep(700);
  check('seated with a panel open: W does not stand up', wPanel.panels.includes('basket') && wPanel.seated, wPanel);
  const wStand = await cc(() => { const c = window.__cc, p = window.__app.world.player; c.press('KeyS', 's'); const r = !p.seated; c.step(30, 0.05); return r; });
  check('after the panel closes, S stands up', wStand, wStand);

  // ================================================================= 3. clicks =====================================================
  await cc(() => { window.__app.world.player.locked = false; });
  // the chair 'table1a' stands at (0.85, -1.55); from the south the view falls on it
  const seatFar = await cc(() => {
    const c = window.__cc, w = window.__app.world, s = w.seats.get('table1a'), o = s.obj.position;
    // step back until the chair is still aimed at (look ray 3.2 m) but further than 2.5 m away
    let t = null, dist = 0, back = 0;
    for (back = 3.0; back > 2.2; back -= 0.05) {
      t = c.aim(o.x, o.z + back, o.x, 0.55, o.z); dist = w.actions.seatDistance(s);
      if (t?.type === 'seat' && dist > 2.6 && dist < 3.15) break;
    }
    return { t, hud: c.hud(), dist: +dist.toFixed(2), back: +back.toFixed(2) };
  });
  check('a chair 2.5 to 3.2 m away is aimed at but out of reach: no ring, no label', seatFar.t?.type === 'seat' && seatFar.t.seat === 'table1a' && seatFar.dist > 2.5 && seatFar.t.near === false && !seatFar.hud.ring && seatFar.hud.nearText.length === 0, seatFar);
  const clickFar = await cc(() => { const c = window.__cc, w = window.__app.world, p = w.player; p.locked = true; c.mouse(0); const r = { seated: !!p.seated, transition: !!p.transition }; p.locked = false; return r; });
  check('a click on the chair out of reach does nothing', !clickFar.seated && !clickFar.transition, clickFar);
  const eFar = await cc(() => { const c = window.__cc, p = window.__app.world.player; c.press('KeyE', 'e'); return { seated: !!p.seated }; });
  check('E on the chair out of reach does nothing either', !eFar.seated, eFar);
  // step closer while the crosshair stays on the chair: the target stays the same, the reach is measured again
  const seatNear = await cc(async () => {
    const c = window.__cc, w = window.__app.world, p = w.player, s = w.seats.get('table1a'), o = s.obj.position;
    p.setPose(o.x, o.z + 1.6, 0, Math.atan2(0.55 - 1.62, 1.6));
    const t = c.look();
    await new Promise((r) => setTimeout(r, 250));     // the label fades in (hud.css)
    return { t, hud: c.hud(), dist: +w.actions.seatDistance(s).toFixed(2) };
  });
  // since 0.6 everything but a book has a small label below the crosshair (hud.js): the name and the key
  check('closer than 2.5 m: the ring and the label "Stuhl · E Hinsetzen" show', seatNear.t?.type === 'seat' && seatNear.t.near === true && seatNear.hud.ring && !seatNear.hud.hintEl && seatNear.hud.nearText.includes('Stuhl') && seatNear.hud.nearText.includes('Hinsetzen'), seatNear);
  const clickNear = await cc(() => {
    const c = window.__cc, w = window.__app.world, p = w.player, n0 = c.sfx.length;
    p.locked = true; c.mouse(0);
    const r = { seated: !!p.seated, seatedId: w.actions.seatedId, transition: !!p.transition };
    // a second quick click (the look ray still rests on the chair) must not start the sit-down again
    const tr = p.transition; p.update(0.05); c.mouse(0);
    r.sameMove = p.transition === tr; r.sitSounds = c.sfx.slice(n0).filter((s) => s.name === 'sit').length;
    p.locked = false; c.step(30, 0.05); r.ready = !!p.seatedReady;
    return r;
  });
  check('a click on the chair within reach sits you down', clickNear.seated && clickNear.seatedId === 'table1a' && clickNear.transition && clickNear.ready, clickNear);
  check('a second quick click does not start the sit-down again', clickNear.sameMove && clickNear.sitSounds === 1, clickNear);
  await cc(() => { const c = window.__cc; c.press('KeyW', 'w'); c.step(30, 0.05); });

  // the click that catches the mouse must not act: synthetic first, then a real (trusted) click on the view
  const captureSynthetic = await cc(() => {
    const c = window.__cc, w = window.__app.world, p = w.player, s = w.seats.get('table1a'), o = s.obj.position;
    p.locked = false;
    const t = c.aim(o.x, o.z + 1.6, o.x, 0.55, o.z);
    c.mouse(0); c.mouse(0, 'mouseup');
    w.renderer.domElement.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true }));
    return { t, seated: !!p.seated, transition: !!p.transition };
  });
  check('pointer not caught: a click on the chair only catches the mouse (synthetic events)', captureSynthetic.t?.type === 'seat' && !captureSynthetic.seated && !captureSynthetic.transition, captureSynthetic);
  const vp = page.viewportSize() || await cc(() => ({ width: innerWidth, height: innerHeight }));
  await page.mouse.move(vp.width / 2, vp.height / 2);
  await page.mouse.click(vp.width / 2, vp.height / 2);
  await sleep(700);
  const captureReal = await cc(() => { const w = window.__app.world, p = w.player; return { seated: !!p.seated, transition: !!p.transition, locked: p.locked, lockEl: document.pointerLockElement === w.renderer.domElement, panels: window.__cc.panels() }; });
  check('pointer not caught: a real click on the chair does not sit you down', !captureReal.seated && !captureReal.transition && captureReal.panels.length === 0, captureReal);
  // the next real click with the mouse caught acts (in the hidden test window the lock is simulated when it was refused)
  const simulated = await cc(() => { const w = window.__app.world, p = w.player; const sim = !p.locked; if (sim) p.locked = true; return sim; });
  await page.mouse.click(vp.width / 2, vp.height / 2);
  await sleep(300);
  const actReal = await cc((sim) => { const w = window.__app.world, p = w.player; const r = { seated: !!p.seated, seatedId: w.actions.seatedId }; if (sim) p.locked = false; else document.exitPointerLock?.(); return r; }, simulated);
  check('with the mouse caught a real click sits you down', actReal.seated && actReal.seatedId === 'table1a', { ...actReal, lockSimulated: simulated });
  await cc(() => { const c = window.__cc; c.step(30, 0.05); c.press('KeyW', 'w'); c.step(30, 0.05); window.__app.world.player.locked = false; });

  // right button: nothing; with a panel or the wheel open: nothing
  const rightBtn = await cc(() => {
    const c = window.__cc, w = window.__app.world, p = w.player, s = w.seats.get('table1a'), o = s.obj.position;
    c.aim(o.x, o.z + 1.6, o.x, 0.55, o.z);
    p.locked = true; c.mouse(2); c.mouse(1);
    const r = { seated: !!p.seated, panels: c.panels() };
    p.locked = false; return r;
  });
  check('the right and middle buttons do nothing', !rightBtn.seated && rightBtn.panels.length === 0, rightBtn);

  // a book on the shelf: the click opens its info card (E would take it into the basket)
  const bookClick = await cc(async () => {
    const c = window.__cc, w = window.__app.world, p = w.player;
    const e = [...w.books.entries.values()].find((x) => !x.hidden && x.pos.y > 1.0 && x.pos.y < 1.8 && x.book.hasCover !== false) || [...w.books.entries.values()].find((x) => !x.hidden);
    w.actions.goToBook(e.book.id);
    const t = c.look();
    await new Promise((r) => setTimeout(r, 300));     // the card shows once its cover is decoded (hud.js)
    const hud = c.hud();
    const basket = window.__app.state.basket.length;
    p.locked = true; c.mouse(0); p.locked = false;
    return { id: e.book.id, title: e.book.title, author: e.book.author || '', t, hud, basketBefore: basket };
  });
  await sleep(1500);
  const bookAfter = await cc(() => ({ panels: window.__cc.panels(), basket: window.__app.state.basket.length, info: document.querySelector('.panel-layer[data-panel="bookinfo"]')?.innerText?.slice(0, 200) || '' }));
  check('a click on a shelf book opens its info card and leaves the basket alone', bookClick.t?.type === 'book' && bookAfter.panels.includes('bookinfo') && bookAfter.basket === bookClick.basketBefore, { t: bookClick.t, panels: bookAfter.panels, basket: [bookClick.basketBefore, bookAfter.basket] });
  await cc(() => window.__app.closeAllPanels()); await sleep(700);

  // ================================================================= 4. no text while looking ======================================
  check('no #hint element any more', !bookClick.hud.hintEl, bookClick.hud);
  check('a book under the crosshair: ring, cover card, nothing written near the centre', bookClick.hud.ring && bookClick.hud.peek && bookClick.hud.peekCover && bookClick.hud.nearText.length === 0, bookClick.hud);
  const outsideText = bookClick.hud.peekOutside.join(' ');
  const titleShown = (bookClick.title && outsideText.includes(bookClick.title)) || (bookClick.author && bookClick.author.length > 2 && outsideText.includes(bookClick.author));
  check('the cover card has no title, author or tags under the cover, only the small key row', !bookClick.hud.peekTitle && !titleShown && bookClick.hud.peekOutside.length === 1 && /peek-keys/.test(bookClick.hud.peekOutside[0]), bookClick.hud.peekOutside);
  await cc(() => window.__app.world.frame());
  await shot('controls-1-book');
  // "Hinweise einblenden" off: the cover alone, the ring stays
  await cc(() => window.__app.ctx.api.settings.set({ hints: false }));
  await sleep(600);
  const noHints = await cc(async () => { const c = window.__cc; c.look(); await new Promise((r) => setTimeout(r, 300)); return c.hud(); });
  await cc(() => window.__app.ctx.api.settings.set({ hints: true }));
  await sleep(600);
  check('hints off: the cover card without the key row, the ring stays', noHints.peek && noHints.peekCover && noHints.peekOutside.length === 0 && noHints.ring, noHints);

  // every other kind of target: the ring and, since 0.6, its label below the crosshair (name and key), no cover card
  const kinds = await cc(async () => {
    const c = window.__cc, w = window.__app.world, out = {};
    const pl = (kind) => w.layout.placements.find((x) => x.kind === kind);
    const probe = async (name, fn) => { const t = fn(); await new Promise((r) => setTimeout(r, 250)); out[name] = { t, hud: c.hud() }; };
    await probe('seat', () => { const o = w.seats.get('table1a').obj.position; return c.aim(o.x, o.z + 1.6, o.x, 0.55, o.z); });
    await probe('painting', () => c.painting());
    await probe('computer', () => { const q = pl('computer'); return c.aim(q.meta.standAt[0], q.meta.standAt[1], q.x, 1.0, q.z); });
    await probe('records', () => { const q = pl('recordplayer'); return c.aim(q.meta.standAt[0], q.meta.standAt[1], q.x, 0.85, q.z); });
    await probe('radio', () => { const q = pl('radio'); return c.aim(q.meta.standAt[0], q.meta.standAt[1], q.x, 0.7, q.z); });
    await probe('return', () => { const q = pl('returncounter'); return c.aim(q.meta.standAt[0], q.meta.standAt[1], q.x, 1.0, q.z); });
    await probe('nothing', () => c.aim(-0.8, 1.4, -0.8, 5.0, 1.3));
    return out;
  });
  const LABEL = { seat: 'Stuhl', painting: 'Bild', computer: 'Computer', records: 'Plattenspieler', radio: 'Radio', return: 'Rückgabe' };
  for (const [name, r] of Object.entries(kinds)) {
    if (name === 'nothing') { check('looking at nothing: the plain dot, no label', !r.t && !r.hud.ring && !r.hud.peek && r.hud.nearText.length === 0, r); continue; }
    check(`${name}: targeted with the ring and the label "${LABEL[name]}", no cover card`, r.t && r.hud.ring && !r.hud.peek && r.hud.nearText.includes(LABEL[name]) && r.hud.nearText.includes('E') && !r.hud.hintEl, r);
  }
  await cc(() => { const w = window.__app.world, o = w.seats.get('table1a').obj.position; window.__cc.aim(o.x, o.z + 1.6, o.x, 0.55, o.z); w.frame(); });
  await shot('controls-2-seat-ring');

  // clicks on the other things: the painting opens the gallery, the computer its panel, the return desk the basket
  const clicks = {};
  for (const [name, panel] of [['painting', 'gallery'], ['computer', 'computer'], ['records', 'records'], ['return', 'basket']]) {
    await cc((name) => {
      const c = window.__cc, w = window.__app.world, p = w.player;
      const pl = (kind) => w.layout.placements.find((x) => x.kind === kind);
      if (name === 'painting') c.painting();
      if (name === 'computer') { const q = pl('computer'); c.aim(q.meta.standAt[0], q.meta.standAt[1], q.x, 1.0, q.z); }
      if (name === 'records') { const q = pl('recordplayer'); c.aim(q.meta.standAt[0], q.meta.standAt[1], q.x, 0.85, q.z); }
      if (name === 'return') { const q = pl('returncounter'); c.aim(q.meta.standAt[0], q.meta.standAt[1], q.x, 1.0, q.z); }
      p.locked = true; c.mouse(0); p.locked = false;
    }, name);
    await sleep(name === 'computer' ? 2500 : 1500);
    clicks[name] = await cc(() => window.__cc.panels());
    await cc(() => window.__app.closeAllPanels()); await sleep(800);
    check(`a click on the ${name} opens ${panel}`, clicks[name].includes(panel), clicks[name]);
  }

  // the cat: a click pets it like E (only when it sleeps on a seat within reach)
  const catClick = await cc(async () => {
    const c = window.__cc, w = window.__app.world, cat = w.cat; if (!cat || !cat.group.visible) return { skipped: true };
    // asleep on its first seat; stand 1.1 m away on the floor, away from the seat (as cat-check does)
    cat.goTo(0, true); cat.nextMove = 1e9; w.frame();
    cat.group.updateMatrixWorld(true);
    const pc = cat.group.localToWorld(cat.pick.position.clone());
    const s = cat.spots[cat.spot], d = s.landing.clone().sub(s.position).setY(0).normalize();
    const o = cat.group.position.clone().addScaledVector(d, 1.1);
    const t = c.aim(o.x, o.z, pc.x, pc.y, pc.z);
    await new Promise((r) => setTimeout(r, 250));     // the label fades in
    const hud = c.hud();
    w.player.locked = true; c.mouse(0); w.player.locked = false;
    return { t, hud, state: cat.state };
  });
  if (catClick.skipped) console.log('CAT skipped ' + JSON.stringify(catClick));
  else check('a click on the sleeping cat pets it (ring, the label "Katze · E Streicheln")', catClick.t?.kind === 'cat' && catClick.hud.ring && catClick.hud.nearText.includes('Katze') && catClick.hud.nearText.includes('Streicheln') && catClick.state === 'pet', catClick);

  // a book on the table (seated): the click opens it. Since 0.6 only the book opened last lies there, and only with the
  // setting "Zuletzt geöffnetes Buch am Sitzplatz bereitlegen" (interior-check): this one counts as opened last
  await cc(() => window.__app.ctx.api.settings.set({ lastBookAtSeat: true }));
  await sleep(600);
  const tableBook = await cc(async () => {
    const c = window.__cc, w = window.__app.world, p = w.player;
    const e = [...w.books.entries.values()].find((x) => !x.hidden && !w.actions.basket.includes(x.book.id));
    await w.actions.takeBook(e.book.id, { silent: true });
    w.actions.lastOpenedId = e.book.id;
    for (let i = 0; i < 60; i++) w.actions.update(0.05);
    const s = w.seats.get('table1a');
    p.transition = null; p.setPose(s.standPos.x, s.standPos.z, s.standYaw, 0);
    w.actions.sit('table1a');
    for (let i = 0; i < 30; i++) { p.update(0.05); w.actions.update(0.05); }
    await new Promise((r) => setTimeout(r, 450));      // the books are laid out 0.3 s after sitting down
    for (let i = 0; i < 40; i++) w.actions.update(0.05);
    const tb = w.actions.tableBooks.get(e.book.id);
    if (!tb) return { err: 'no table book', basket: [...w.actions.basket] };
    const m = tb.mesh.position, eye = w.camera.position;
    p.yaw = Math.atan2(-(m.x - eye.x), -(m.z - eye.z)); p.pitch = Math.atan2(m.y - eye.y, Math.hypot(m.x - eye.x, m.z - eye.z));
    const t = c.look();
    await new Promise((r) => setTimeout(r, 300));     // the card shows once its cover is decoded (hud.js)
    const hud = c.hud();
    p.locked = true; c.mouse(0); p.locked = false;
    return { id: e.book.id, t, hud };
  });
  await sleep(2500);
  const readerOpen = await cc(() => window.__cc.panels());
  check('seated: a book on the table shows its cover with the table keys', tableBook.t?.type === 'tablebook' && tableBook.hud.ring && tableBook.hud.peek && tableBook.hud.nearText.length === 0, tableBook);
  check('a click on a book on the table opens it in the reader', readerOpen.includes('reader'), readerOpen);
  await cc(() => window.__app.closeAllPanels()); await sleep(1500);
  const afterReader = await cc(() => { const c = window.__cc, w = window.__app.world, p = w.player; c.press('KeyW', 'w'); const r = { seated: !!p.seated }; c.step(30, 0.05); return r; });
  check('after closing the book, W stands up from the table', !afterReader.seated, afterReader);
  await cc(() => window.__app.ctx.api.settings.set({ lastBookAtSeat: false }));

  // ================================================================= 5. cost ======================================================
  const cost = await cc(() => {
    const w = window.__app.world, p = w.player, c = window.__cc;
    c.aim(-0.8, 1.4, -0.8, 1.62, -3);
    let t0 = performance.now();
    for (let i = 0; i < 2000; i++) p.update(1 / 120);
    const idle = (performance.now() - t0) / 2000;
    t0 = performance.now();
    let n = 0;
    for (let k = 0; k < 40; k++) { p.jump(); for (let i = 0; i < 80; i++) { p.update(1 / 120); n++; } }
    const air = (performance.now() - t0) / n;
    t0 = performance.now();
    for (let i = 0; i < 500; i++) { w.actions.rayTimer = 0; w.actions.update(0.001); }
    const look = (performance.now() - t0) / 500;
    return { idleMs: +idle.toFixed(4), airMs: +air.toFixed(4), lookMs: +look.toFixed(3), overhead: p.overhead.length };
  });
  console.log('COST ' + JSON.stringify(cost));
  check('player update costs well under a tenth of a millisecond, also in the air', cost.idleMs < 0.1 && cost.airMs < 0.1, cost);

  // ================================================================= 6. in the running loop ========================================
  // the real thing: the world draws again, the keys come from the keyboard (trusted events), the camera is sampled
  // every animation frame while it jumps, and the frame gaps show whether anything stalls
  await cc(() => { const c = window.__cc, w = window.__app.world; c.aim(-0.8, 1.4, -0.8, 1.62, -3); w.start(); });
  await sleep(1500);
  await cc(() => {
    const w = window.__app.world, p = w.player;
    window.__live = { ys: [], gaps: [], air: 0, t0: 0 };
    let last = performance.now();
    const tick = (now) => {
      const L = window.__live;
      L.gaps.push(now - last); last = now;
      L.ys.push(w.camera.position.y - p.position.y);
      if (p.air) { if (!L.t0) L.t0 = now; L.air = now - L.t0; }
      if (L.ys.length < 150) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await sleep(200);
  await page.keyboard.press('Space');
  await sleep(2200);
  const live = await cc(() => {
    const L = window.__live, gaps = L.gaps.slice(2);
    return { frames: L.ys.length, apex: +Math.max(...L.ys).toFixed(3), dip: +(-Math.min(...L.ys)).toFixed(3), airMs: Math.round(L.air), maxGapMs: +Math.max(...gaps).toFixed(1), meanGapMs: +(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1), landed: !window.__app.world.player.air };
  });
  check('in the running loop: a real Space jumps 0.57 to 0.63 m for about 0.63 s and lands', live.apex >= 0.57 && live.apex <= 0.63 && live.airMs > 530 && live.airMs < 730 && live.landed, live);
  // (other programs share the graphics card during test runs: a stall of a shader compile or a rebuild is 250 ms and more)
  check('no frame stalls while jumping (longest gap under 100 ms)', live.maxGapMs < 100, live);
  // a real W on the keyboard stands up from a seat once the sit-down has finished
  await cc(() => { const w = window.__app.world, s = w.seats.get('table1a'); w.player.transition = null; w.player.setPose(s.standPos.x, s.standPos.z, s.standYaw, 0); w.actions.sit('table1a'); });
  await sleep(1600);
  const liveSeated = await cc(() => ({ seated: !!window.__app.world.player.seated, ready: !!window.__app.world.player.seatedReady }));
  await page.keyboard.press('w');
  await sleep(1200);
  const liveStood = await cc(() => ({ seated: !!window.__app.world.player.seated, transition: !!window.__app.world.player.transition }));
  check('in the running loop: a real W stands up from the chair', liveSeated.seated && liveSeated.ready && !liveStood.seated && !liveStood.transition, { liveSeated, liveStood });
  await cc(() => window.__app.world.stop());

  // ================================================================= 7. Space keeps its other jobs =================================
  // the reader turns the page with it; the computer, chess and the reading browser keep it to themselves
  const readBook = await cc(() => { const bs = window.__app.state.library.books; const b = bs.find((x) => /Sammelband/.test(x.title || '') && /epub/i.test(x.format || '')) || bs.find((x) => /epub/i.test(x.format || '')); return b ? { id: b.id, title: b.title } : null; });
  await cc((id) => { window.__cc.aim(-0.8, 1.4, -0.8, 1.62, -3); window.__app.ctx.bus.emit('book:open', { id }); }, readBook?.id);
  await sleep(6000);
  const readerPos = () => cc(() => { const l = document.querySelector('.panel-layer[data-panel="reader"]'); return l ? { slider: +(l.querySelector('.rd-slider')?.value || 0), percent: l.querySelector('.rd-percent')?.textContent || '', label: l.querySelector('.rd-bottom')?.firstElementChild?.textContent || '' } : null; });
  const rp0 = await readerPos();
  await page.keyboard.press('Space'); await sleep(1200);
  const rp1 = await readerPos();
  await page.keyboard.press('Space'); await sleep(1200);
  const rp2 = await readerPos();
  const readerState = await cc(() => ({ air: !!window.__app.world.player.air, panels: window.__cc.panels() }));
  const turned = rp0 && rp1 && rp2 && (rp1.slider > rp0.slider || rp2.slider > rp1.slider || rp1.label !== rp0.label || rp2.label !== rp1.label);
  // a test library without an EPUB (testbooks2) has nothing to open: then the reader part is skipped, not failed
  if (readBook) check('reader: Space turns the page, the reader stays open, nobody jumps', turned && readerState.panels.includes('reader') && !readerState.air, { book: readBook, rp0, rp1, rp2, readerState });
  else console.log('SKIP reader: no EPUB in this test library');
  await cc(() => window.__app.closeAllPanels()); await sleep(1500);
  for (const name of ['computer', 'chess', 'browser']) {
    // stand on the floor first: a jump left over from above (the loop is stopped here) must not count as one in the panel
    await cc(() => { const p = window.__app.world.player; p.setPose(p.position.x, p.position.z, p.yaw, p.pitch); });
    await cc((n) => window.__app.ctx.openPanel(n, {}), name);
    await sleep(name === 'browser' ? 4000 : 2500);
    await page.keyboard.press('Space'); await sleep(500);
    const st = await cc(() => ({ air: !!window.__app.world.player.air, enabled: window.__app.world.player.enabled, panels: window.__cc.panels() }));
    check(`${name}: Space stays in the panel (no jump, the panel stays open)`, st.panels.includes(name) && !st.air && !st.enabled, st);
    await cc(() => window.__app.closeAllPanels()); await sleep(900);
  }

  check('no uncaught errors in the renderer', errors.length === 0, errors.slice(0, 5));
  const failed = results.filter((r) => !r.ok);
  console.log(`CONTROLS-CHECK ${results.length - failed.length}/${results.length} passed` + (failed.length ? ' · failed: ' + failed.map((f) => f.name).join(' | ') : ''));
};
