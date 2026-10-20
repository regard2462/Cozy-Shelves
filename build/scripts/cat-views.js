// Pictures of the library cat from the places a visitor looks at it: sitting, asleep, walking and petted, from the
// front, the side, behind, close up and from a few metres, by day and in the evening. No checks, only shots
// (<tag>-<hour>-<pose>-<view>.png). CV_HOURS="11,20" (fixed hours), SHOT_TAG prefixes the names. Muted and hidden
// like every harness script.
module.exports = async ({ page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG ? process.env.SHOT_TAG + '-' : '';
  const hours = (process.env.CV_HOURS || '11,20').split(',').map(Number);
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  await sleep(1200);
  // wait until the library is indexed and shelved: a rebuild in the middle would replace the cat
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
  await page.evaluate(() => {
    const w = window.__app.world;
    window.__app.closeAllPanels(); document.querySelector('#hud')?.style.setProperty('opacity', '0');
    const far = new window.__app.world.camera.position.constructor(100, 1.62, 100);
    window.__cv = {
      far,
      // the camera at (x, z, eye height) looking at the point (tx, ty, tz); the cat looks back when it is awake
      aim(x, z, tx, ty, tz, eyeY) {
        const p = w.player; p.transition = null;
        p.setPose(x, z, Math.atan2(-(tx - x), -(tz - z)), Math.atan2(ty - eyeY, Math.hypot(tx - x, tz - z)));
        p.position.y = eyeY;
        w.frame(); w.frame();
      },
      // forward and left of the cat on the floor
      frame() { const c = w.cat, y = c.yaw; return { f: [Math.cos(y), -Math.sin(y)], l: [-Math.sin(y), -Math.cos(y)], p: c.group.position, head: c.head.getWorldPosition(c.group.position.clone()) }; },
      // a pose, settled over a few seconds (the player far away or at the camera)
      settle(n, at) { const c = w.cat; for (let i = 0; i < n; i++) c.update(0.05, at || far); },
      freeze() { const c = w.cat; if (!c.__upd) { c.__upd = c.update; c.update = () => {}; } },
      thaw() { const c = w.cat; if (c.__upd) { c.update = c.__upd; delete c.__upd; } },
    };
  });
  const frames = async (n = 4) => { for (let i = 0; i < n; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(40); } };
  // views: [name, forward (m), left (m), eye height, look at 'head' | 'body', look height offset]
  const VIEWS = {
    sit: [['face', 0.55, 0.05, 'headY+0.12', 'head'], ['front', 1.0, 0.1, 1.15, 'body'], ['quarter', 1.1, 1.0, 1.25, 'body'], ['side', 0.1, 1.5, 1.05, 'body'], ['back', -1.2, 0.9, 1.75, 'body'], ['far', 3.0, 0.3, 1.62, 'body']],
    sleep: [['front', 1.0, 0.15, 1.35, 'body'], ['side', 0.1, 1.4, 1.1, 'body'], ['above', 0.8, 0.7, 1.75, 'body'], ['face', 0.6, 0.1, 'headY+0.1', 'head']],
    walk: [['side', 0.1, 1.5, 1.1, 'body'], ['front', 1.2, 0.6, 0.95, 'head'], ['back', -1.3, 0.5, 1.1, 'body']],
    pet: [['back', -1.0, 0.8, 1.0, 'body'], ['front', 1.0, 0.3, 1.0, 'head']],
    stretch: [['side', 0.2, 1.4, 1.0, 'body']],
  };
  const viewsOf = async (hour, pose) => {
    for (const [name, fwd, left, eye, at] of VIEWS[pose]) {
      await page.evaluate(([fwd, left, eye, at]) => {
        const V = window.__cv, F = V.frame(), w = window.__app.world;
        const t = at === 'head' ? F.head : w.cat.group.localToWorld(w.cat.pick.position.clone());
        // the nominal place or, for a view from further off, the nearest free one at the same distance (the seats
        // stand close to other furniture); a close-up may stand inside the seat's own collider
        const d = Math.hypot(fwd, left), a0 = Math.atan2(left, fwd);
        let x = F.p.x + F.f[0] * fwd + F.l[0] * left, z = F.p.z + F.f[1] * fwd + F.l[1] * left;
        for (let k = 1; k < 24 && d >= 1.3 && !w.player.isFree(x, z, 0.3); k++) {
          const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.26, cf = Math.cos(a) * d, cl = Math.sin(a) * d;
          x = F.p.x + F.f[0] * cf + F.l[0] * cl; z = F.p.z + F.f[1] * cf + F.l[1] * cl;
        }
        const eyeY = typeof eye === 'string' ? F.head.y + +eye.slice(6) : eye;
        const cam = w.camera.position.clone().set(x, eyeY, z);
        if (!w.cat.__upd) V.settle(50, cam);   // it turns its head towards the camera (awake poses)
        V.aim(x, z, t.x, t.y, t.z, eyeY);
      }, [fwd, left, eye, at]);
      await frames(3);
      await shot(`${tag}${hour}-${pose}-${name}`);
    }
  };
  for (const hour of hours) {
    await page.evaluate((hour) => {
      const w = window.__app.world;
      w.applySettings({ ...w.settings, timeMode: 'fixed', fixedHour: hour });
      w.env.set({ hour });
      w.godrays?.settle?.();
    }, hour);
    // sitting on its first seat, awake
    await page.evaluate(() => { const w = window.__app.world, c = w.cat; window.__cv.thaw(); c.goTo(0, true); c.nextMove = 1e9; c.state = 'sit'; c.stateT = 0; c.sitFor = 1e9; c.blinkIn = 1e9; window.__cv.settle(60); });
    await viewsOf(hour, 'sit');
    // asleep
    await page.evaluate(() => { const w = window.__app.world, c = w.cat; c.goTo(0, true); c.nextMove = 1e9; window.__cv.settle(60); });
    await viewsOf(hour, 'sleep');
    // walking (frozen in mid-stride, so every view shows the same moment)
    await page.evaluate(() => {
      const w = window.__app.world, c = w.cat; c.goTo(0, true); c.nextMove = 1e9; c.goTo(2);
      for (let i = 0; i < 400 && !(c.state === 'walk' && c.stateT > 1.6); i++) c.update(0.05, window.__cv.far);
      c.blinkIn = 1e9; window.__cv.freeze();
    });
    await viewsOf(hour, 'walk');
    // petted on the floor: tail up like a question mark, then the stretch
    await page.evaluate(() => {
      const w = window.__app.world, c = w.cat; window.__cv.thaw();
      for (let i = 0; i < 200 && !(c.state === 'walk' && c.stateT > 4); i++) c.update(0.05, window.__cv.far);
      const F = window.__cv.frame(); const cam = w.camera.position.clone().set(F.p.x - F.f[0] * 1.0 + F.l[0] * 0.8, 1.0, F.p.z - F.f[1] * 1.0 + F.l[1] * 0.8);
      c.pet(cam); for (let i = 0; i < 30; i++) c.update(0.05, cam);
      window.__cv.freeze();
    });
    await viewsOf(hour, 'pet');
    await page.evaluate(() => { const w = window.__app.world, c = w.cat; window.__cv.thaw(); for (let i = 0; i < 400 && !(c.state === 'linger' && c.stateT > 0.45); i++) c.update(0.05, window.__cv.far); window.__cv.freeze(); });
    await viewsOf(hour, 'stretch');
    await page.evaluate(() => { window.__cv.thaw(); const c = window.__app.world.cat; c.goTo(0, true); });
  }
  console.log('CAT-VIEWS done');
};
