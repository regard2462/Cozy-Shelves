// Robustness sweep: can the player reach everything, does anything get stuck, what does it cost,
// and close-ups of the places the bug report complained about (arches, beams, corners).
module.exports = async ({ page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || '';
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  await sleep(1200);
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  const settle = async (n = 10) => { for (let i = 0; i < n; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(45); } };

  // --- reachability: walk from the hall through the passage into the room and back ------------
  const walk = await page.evaluate(() => {
    const w = window.__app.world;
    const p = w.player;
    const run = (fromX, fromZ, toX, toZ, steps = 900) => {
      p.transition = null; p.setPose(fromX, fromZ, 0, 0);
      let stuck = 0;
      for (let i = 0; i < steps; i++) {
        const dx = toX - p.position.x, dz = toZ - p.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.5) return { ok: true, steps: i, pos: [+p.position.x.toFixed(1), +p.position.z.toFixed(1)] };
        p.yaw = Math.atan2(-dx, -dz);
        const before = p.position.clone();
        p.velocity.set(dx / d * 2.4, 0, dz / d * 2.4);
        const next = p.position.clone().addScaledVector(p.velocity, 0.05);
        p.position.copy(next);
        w.updateDoor?.(0.05);   // the glass doors to the terrace open when you walk up to them
        p.update(0.05);
        if (p.position.distanceTo(before) < 0.005) stuck++; else stuck = 0;
        if (stuck > 40) return { ok: false, steps: i, pos: [+p.position.x.toFixed(1), +p.position.z.toFixed(1)] };
      }
      return { ok: false, steps, pos: [+p.position.x.toFixed(1), +p.position.z.toFixed(1)] };
    };
    // through waypoints: a straight line from the east of the hall ran into the south wall and got stuck at the
    // easel standing in front of it, which says nothing about the passage
    const via = (pts) => { let r = null; for (let i = 0; i < pts.length - 1; i++) { r = run(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]); if (!r.ok) return r; } return r; };
    return {
      hallToRoom: via([[5.0, 0.0], [4.0, -4.0], [0.4, -4.2], [0.0, -8.0], [3.2, -13.4]]),
      roomToHall: run(-4.0, -20, 5.0, 3.0),
      roomCornerNW: run(0, -12, -9.8, -22.0),
      roomCornerNE: run(0, -12, 9.8, -22.0),
      hallCornerSW: run(0, 0, -7.6, -3.0),
      recentShelf: run(0, -12, 3.0, -10.6),
      // through the glass doors onto the terrace and the lawn, and back in
      toTerrace: via([[4.0, 0.0], [0.3, 3.4], [0.2, 7.4], [-2.5, 12.6]]),
      fromTerrace: via([[-2.5, 12.6], [0.2, 7.6], [0.3, 3.0], [4.0, -1.0]]),
    };
  });
  console.log('WALK ' + JSON.stringify(walk));

  // --- no collider may enclose a reachable standing spot --------------------------------------
  const grid = await page.evaluate(() => {
    const w = window.__app.world;
    let free = 0, blocked = 0;
    const bad = [];
    for (let x = -10.5; x <= 10.5; x += 0.5) {
      for (let z = -23; z <= 5; z += 0.5) {
        const inHall = x > -8.2 && x < 8.2 && z > -5.2 && z < 5.2;
        const inRoom = x > -10.7 && x < 10.7 && z > -23.3 && z < -9.5;
        const inPass = Math.abs(x) < 1.5 && z > -9.0 && z < -5.7;
        if (!(inHall || inRoom || inPass)) continue;
        if (w.player.isFree(x, z, 0)) free++; else blocked++;
      }
    }
    return { free, blocked, ratio: +(free / (free + blocked)).toFixed(2), bad };
  });
  console.log('GRID ' + JSON.stringify(grid));

  // --- performance --------------------------------------------------------------------------
  await page.evaluate(() => { const w = window.__app.world; w.player.setPose(0, -12.5, 0, 0); w.renderer.info.reset?.(); });
  await settle(30);
  const perf = await page.evaluate(() => {
    const w = window.__app.world;
    const t0 = performance.now();
    for (let i = 0; i < 40; i++) w.frame();
    const ms = (performance.now() - t0) / 40;
    let meshes = 0, tris = 0, lights = 0;
    w.scene.traverse((o) => {
      if (o.isLight) lights++;
      if (!o.isMesh && !o.isInstancedMesh) return;
      meshes++;
      const g = o.geometry; if (!g) return;
      const n = (g.index ? g.index.count : g.attributes.position?.count || 0) / 3;
      tris += n * (o.isInstancedMesh ? o.count : 1);
    });
    // real per-frame draw calls (frustum culling included)
    w.renderer.info.reset(); w.renderer.render(w.scene, w.camera);
    const calls = w.renderer.info.render.calls, drawnTris = w.renderer.info.render.triangles;
    return { msPerFrame: +ms.toFixed(1), calls, drawnTris, meshes, tris: Math.round(tris), lights, geometries: w.renderer.info.memory.geometries, textures: w.renderer.info.memory.textures, programs: w.renderer.info.programs?.length };
  });
  console.log('PERF ' + JSON.stringify(perf));

  // --- leak check: switch department 8x and watch the counters ---------------------------------
  const leak = await page.evaluate(() => {
    const w = window.__app.world;
    const deps = (w.layout.departments || []).filter((d) => d.count > 0).map((d) => d.name);
    const before = { geo: w.renderer.info.memory.geometries, tex: w.renderer.info.memory.textures };
    for (let i = 0; i < 8; i++) { w.setDepartment(deps[i % deps.length]); w.frame(); }
    return { before, after: { geo: w.renderer.info.memory.geometries, tex: w.renderer.info.memory.textures }, deps: deps.length };
  });
  console.log('LEAK ' + JSON.stringify(leak));

  // --- close-ups of the spots the bug report called out -----------------------------------------
  const views = [
    ['arch-hall-side', 0, -3.6, 0, 0.12],
    ['arch-room-side', 0, -11.0, Math.PI, 0.12],
    ['arch-edge', 1.4, -5.0, 0.6, 0.05],
    ['beams', 0, 0, Math.PI, 0.6],
    ['beams-room', 0, -16, 0, 0.6],
    ['corner-hall', -7.8, 4.7, -0.8, 0.0],
    ['corner-room', -10.2, -22.6, -0.8, 0.0],
    ['floor-join', 0, -6.2, 0, -0.9],
    ['window-reveal', 5.6, 3.9, Math.PI, 0.1],
    ['fire-close', -6.3, 0, Math.PI / 2, -0.12],
  ];
  for (const [name, x, z, yaw, pitch] of views) {
    await page.evaluate(([x, z, yaw, pitch]) => { const w = window.__app.world; w.player.transition = null; w.player.setPose(x, z, yaw, pitch); w.frame(); }, [x, z, yaw, pitch]);
    await settle(10);
    await shot(tag + 's-' + name);
  }
};
