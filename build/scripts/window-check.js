// Animals seen from the windows (wildlife.js, wildlife-views.js): for every side of the house with windows (the hall's
// glass front, the book room's back window and its two side windows) and for the terrace, the player stands at the
// window and looks out like a visitor while the visits run on their own (WC_MINUTES simulated minutes each, setting
// 'Oft'). Once a second every animal is tested: inside the view and not hidden, with a ray from the eye to its body and
// its head against the building (walls, floors, frames; not the glass) and the trees (the trunks and branches of every
// tree, the foliage of the shrubs and spruces), and it must be within 40 m. Reported per window: the share of the time
// an animal was in sight, when the first one came into sight, how many groups came. Every window side must show an
// animal at least half the time.
// A picture from each window with an animal in sight. SHOT_TAG prefixes the pictures; WC_SIDES picks the windows.
module.exports = async ({ page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || 'wc';
  const minutes = +(process.env.WC_MINUTES || 20);
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
  await sleep(3000);
  let failures = 0;
  const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); if (!ok) failures++; };

  await page.evaluate(() => {
    const w = window.__app.world;
    w.settings.timeMode = 'fixed'; w.settings.fixedHour = 12; w.settings.weather = 'clear'; w.settings.wildlifeRate = 'often'; w.applySettings(w.settings);
    document.querySelector('#hud')?.style.setProperty('opacity', '0');
    for (let i = 0; i < 6; i++) w.frame();
    w.wildlife.prepareAll();
    // the test's tools: a ray caster and a vector of the page's three.js, what blocks the view
    const Ray = w.actions.raycaster.constructor, V = w.camera.position.constructor;
    const garden = w.env.garden.group, blockers = [];
    w.scene.updateMatrixWorld(true);
    for (const o of w.occluders) o.traverse((m) => { if (m.isMesh && !(m.material?.transparent && m.material.opacity < 0.6)) blockers.push(m); });
    garden.traverse((m) => { if (m.isBatchedMesh && (/-bark$/.test(m.name) || /^(spruce|bush)-leaves$/.test(m.name))) blockers.push(m); });
    const ray = new Ray(), dir = new V(), m4 = w.camera.projectionMatrix.clone();
    /** Is the point p (world) in the camera's view and nothing between? */
    window.__wcSees = (p) => {
      const cam = w.camera, q = p.clone().applyMatrix4(cam.matrixWorldInverse);
      if (q.z > -0.5) return false;
      q.applyMatrix4(m4.copy(cam.projectionMatrix));
      if (Math.abs(q.x) > 0.98 || Math.abs(q.y) > 0.98) return false;
      const d = dir.copy(p).sub(cam.position), dist = d.length();
      ray.set(cam.position, d.normalize()); ray.far = dist - 0.25; ray.near = 0.05;
      return ray.intersectObjects(blockers, false).length === 0;
    };
    /** An animal in sight: within 40 m, its body or its head in the view and nothing between. */
    window.__wcSeen = (b, far = 40) => b.pos.distanceTo(w.camera.position) < far && window.__wcPoints(b).some((q) => window.__wcSees(q));
    window.__wcPoints = (b) => {
      const h = b.A.legLen[0] * b.scale, f = Math.sin(b.yaw), g = Math.cos(b.yaw), L = b.A.legLen[0] * 0.75 * b.scale;
      return [new V(b.pos.x, b.pos.y + h * 0.9, b.pos.z), new V(b.pos.x + f * L, b.pos.y + h * 1.25, b.pos.z + g * L)];
    };
    return blockers.length;
  });

  // the windows: where a visitor stands, looking out (yaw 0 looks along −z)
  const SIDES = [
    ['north', "the hall's glass front", 0.0, 4.4, Math.PI, -0.06],
    ['terrace', 'the terrace', 0.6, 8.7, Math.PI, -0.06],
    ['south', "the book room's back window (south)", 0.0, -22.6, 0, -0.04],
    ['east', "the book room's east window", 10.1, -20.0, -Math.PI / 2, -0.04],
    ['west', "the book room's west window", -10.1, -20.0, Math.PI / 2, -0.04],
  ];
  const only = process.env.WC_SIDES ? process.env.WC_SIDES.split(',') : null;
  const results = {};
  for (const [id, , x, z, yaw, pitch] of SIDES) {
    if (only && !only.includes(id)) continue;
    const r = await page.evaluate(([x, z, yaw, pitch, minutes]) => {
      const w = window.__app.world, W = w.wildlife, p = w.player;
      W.clear(); W.stageWait = {}; W.wait = 2; W.focusOverride = null;
      p.transition = null; p.setPose(x, z, yaw, pitch); p.update(0); w.camera.updateMatrixWorld(true);
      let seen = 0, samples = 0, first = null, best = null;
      const groups = new Set();
      for (let t = 0, next = 0; t < minutes * 60; t += 0.1) {
        W.update(0.1, false);
        for (const v of W.visits) groups.add(v);
        if (t < next) continue;
        next += 1; samples++;
        let n = 0;
        for (const b of W.beasts) if (window.__wcSeen(b)) n++;
        if (n) { seen++; first ??= Math.round(t); }
      }
      return { seen: +(seen / samples).toFixed(3), first, groups: groups.size, samples };
    }, [x, z, yaw, pitch, minutes]);
    results[id] = r;
    // a picture: on until an animal is in sight within 25 m (at most three more minutes)
    await page.evaluate(() => {
      const w = window.__app.world, W = w.wildlife;
      for (let t = 0; t < 180; t += 0.1) { W.update(0.1, false); if (W.beasts.some((b) => window.__wcSeen(b, 25))) break; }
      for (let i = 0; i < 8; i++) W.update(0.03, true);
    });
    for (let i = 0; i < 12; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(30); }
    await shot(`${tag}-${id}`);
  }
  console.log('WINDOWS ' + JSON.stringify(results));
  for (const [id, label] of SIDES) {
    const r = results[id]; if (!r) continue;
    check(`${label}: an animal in sight at least half the time (${minutes} simulated minutes)`, r.seen >= 0.5, r);
  }
  const firsts = Object.values(results).map((r) => r.first);
  check('the first animal comes into sight within about a minute and a half at every window', firsts.every((f) => f != null && f <= 100), firsts);
  await page.evaluate(() => { const W = window.__app.world.wildlife; W.clear(); });
  check('no errors on the page', errors.length === 0, errors.slice(0, 5));
  console.log(`WINDOW-CHECK ${failures ? 'FAILED ' + failures : 'OK'}`);
};
