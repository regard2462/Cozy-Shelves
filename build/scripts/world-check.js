// Visual sweep of the hall + book room, the radial wheel, the hover card and the display books.
// yaw: 0 = looking -Z, PI = looking +Z, PI/2 = -X, -PI/2 = +X
module.exports = async ({ page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || '';
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  await sleep(1500);

  // wait for the scan to settle so all departments exist
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(1500);

  const stats = await page.evaluate(() => {
    const w = window.__app.world;
    return {
      dep: w.department,
      deps: (w.layout.departments || []).map((d) => d.name + ':' + d.count),
      books: w.books.entries.size, cases: w.layout.bookcases.length, colliders: w.colliders.length,
      display: w.books.displayMeshes.length, table: (w.books.tableDisplay || []).length,
      lamps: w.lamps.length, exposure: +w.renderer.toneMappingExposure.toFixed(2),
      sun: +w.env.sun.intensity.toFixed(2), hemi: +w.env.hemi.intensity.toFixed(2),
      tris: w.renderer.info.render.triangles, calls: w.renderer.info.render.calls,
    };
  });
  console.log('STATS ' + JSON.stringify(stats));

  const views = [
    ['hall-windows', 0, -2.2, Math.PI, 0.08],
    ['hall-fire', 0.5, 0.0, Math.PI / 2, -0.02],
    ['hall-entrance', 2.0, 0.0, -Math.PI / 2, -0.02],
    ['hall-south', 0, 2.5, 0, 0.05],
    ['hall-plant', -6.6, 3.2, Math.PI / 2 + 0.6, -0.15],
    ['hall-news', 5.5, 3.6, -Math.PI / 2 - 0.4, -0.05],
    ['hall-easel', 3.3, -3.4, 0.0, -0.18],
    ['hall-lectern', -3.1, -3.4, 0.0, -0.18],
    ['hall-fire-close', -5.2, 0.0, Math.PI / 2, -0.06],
    ['hall-chess', 0, 2.2, Math.PI, -0.22],
    ['hall-computers', 5.6, -2.0, -Math.PI / 2, -0.12],
    ['room-entry', 0, -10.2, 0, 0.02],
    ['room-mid', 0, -15.0, 0, 0.0],
    ['room-back', 0, -21.0, 0, 0.1],
    ['room-shelves-r', 8.6, -13.0, -Math.PI / 2, 0.0],
    ['room-shelves-l', -8.6, -16.0, Math.PI / 2, 0.0],
    ['room-display', 0, -13.6, 0, -0.35],
    ['lamp-close', 0, -15.3, 0, -0.30],
    ['lamp-close2', 0.9, -15.9, -0.6, -0.42],
    ['room-recent', 3.0, -11.2, Math.PI, 0.05],
  ];
  // the lamp pool fades in, so let a few real frames pass before every shot
  const settle = async (n = 10) => { for (let i = 0; i < n; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(45); } };
  for (const [name, x, z, yaw, pitch] of views) {
    await page.evaluate(([x, z, yaw, pitch]) => { const w = window.__app.world; const p = w.player; p.transition = null; p.setPose(x, z, yaw, pitch); w.frame(); }, [x, z, yaw, pitch]);
    await settle(12);
    await shot(tag + 'w-' + name);
  }

  // --- hover a spine: aim straight at it -------------------------------------------------
  const probe = await page.evaluate(() => {
    const w = window.__app.world;
    const e = [...w.books.entries.values()].find((x) => !x.hidden);
    if (!e) return { err: 'no entries' };
    const p = e.pos.clone().addScaledVector(e.forward, 0.75);
    const yaw = Math.atan2(e.forward.x, e.forward.z);
    const EYE = 1.62;
    const pitch = Math.atan2(e.pos.y - EYE, 0.75);
    w.player.transition = null; w.player.setPose(p.x, p.z, yaw, pitch);
    w.frame(); w.actions.rayTimer = 0; w.actions.update(0.01);
    const t = w.actions.target;
    return { target: t ? t.type : null, title: t?.book?.title, cover: !!t?.coverUrl };
  });
  console.log('HOVER ' + JSON.stringify(probe));
  await page.evaluate(() => { const w = window.__app.world; for (let i = 0; i < 30; i++) w.books.update(0.04); });
  await settle(12); await shot(tag + 'w-hover');

  // --- the radial wheel -------------------------------------------------------------------
  await page.evaluate(() => { window.__app.ctx.openWheel(); });
  await sleep(500); await shot(tag + 'w-wheel');
  const wheelInfo = await page.evaluate(() => {
    const el = document.querySelector('#wheel');
    return { visible: !!el && !el.classList.contains('hidden'), sectors: el ? el.querySelectorAll('.wheel-sector').length : 0 };
  });
  console.log('WHEEL ' + JSON.stringify(wheelInfo));

  // pick another department and check the room actually changes
  const switched = await page.evaluate(() => {
    const w = window.__app.world;
    const deps = (w.layout.departments || []).filter((d) => d.count > 0).map((d) => d.name);
    const target = deps.find((d) => d !== w.department) || deps[0];
    const before = w.department;
    w.setDepartment(target);
    return { before, after: w.department, books: w.books.entries.size, cases: w.layout.bookcases.length };
  });
  console.log('SWITCH ' + JSON.stringify(switched));
  await page.evaluate(() => { const w = window.__app.world; w.player.transition = null; w.player.setPose(0, -12.5, 0, 0); w.frame(); w.frame(); });
  await settle(12); await shot(tag + 'w-switched');

  // --- sit down and stand up again (the glitch-through-the-wall bug) ------------------------
  const seatTest = await page.evaluate(() => {
    const w = window.__app.world;
    const out = [];
    for (const id of ['windowseat', 'windowseat2', 'sofa', 'fireplace', 'chess1', 'table1a', 'rooma', 'roomchair1']) {
      const seat = w.seats.get(id); if (!seat) { out.push([id, 'missing']); continue; }
      w.player.transition = null;
      w.player.setPose(seat.standPos.x, seat.standPos.z, seat.standYaw, 0);
      w.actions.sit(id);
      for (let i = 0; i < 40; i++) w.player.update(0.05);
      w.actions.stand();
      for (let i = 0; i < 40; i++) w.player.update(0.05);
      const pos = w.player.position;
      const free = w.player.isFree(pos.x, pos.z, 0);
      const inHall = pos.x > -8.6 && pos.x < 8.6 && pos.z > -5.6 && pos.z < 5.6;
      const inRoom = pos.x > -11.1 && pos.x < 11.1 && pos.z > -23.7 && pos.z < -9.1;
      const inPass = Math.abs(pos.x) < 1.8 && pos.z > -9.3 && pos.z < -5.4;
      out.push([id, +pos.x.toFixed(2), +pos.z.toFixed(2), free ? 'free' : 'STUCK', (inHall || inRoom || inPass) ? 'inside' : 'OUTSIDE']);
    }
    return out;
  });
  console.log('SEATS ' + JSON.stringify(seatTest));

  await page.evaluate(() => { const el = document.querySelector('#wheel'); if (el) el.classList.add('hidden'); });
  // --- shadows off must not black out the room ---------------------------------------------
  await page.evaluate(() => { const w = window.__app.world; w.applySettings({ ...w.settings, graphics: { ...w.settings.graphics, shadows: false } }); w.player.setPose(0, -2.2, Math.PI, 0.08); w.frame(); w.frame(); });
  await settle(12); await shot(tag + 'w-noshadow');
  await page.evaluate(() => { const w = window.__app.world; w.applySettings({ ...w.settings, graphics: { ...w.settings.graphics, shadows: true } }); w.frame(); });

  // --- the cat must stay inside ---------------------------------------------------------------
  const cat = await page.evaluate(() => {
    const w = window.__app.world; if (!w.cat) return null;
    const out = [];
    for (let k = 0; k < 4; k++) {
      w.cat.nextMove = 0;
      for (let i = 0; i < 1400; i++) {
        w.cat.update(0.05, w.player.position);
        const p = w.cat.group.position;
        const inHall = p.x > -8.7 && p.x < 8.7 && p.z > -5.7 && p.z < 5.7;
        const inRoom = p.x > -11.2 && p.x < 11.2 && p.z > -23.8 && p.z < -9.0;
        const inPass = Math.abs(p.x) < 1.9 && p.z > -9.4 && p.z < -5.3;
        if (!(inHall || inRoom || inPass)) out.push([+p.x.toFixed(1), +p.z.toFixed(1)]);
      }
    }
    return { escapes: out.length, sample: out.slice(0, 5), spots: w.cat.spots.length };
  });
  console.log('CAT ' + JSON.stringify(cat));
};
