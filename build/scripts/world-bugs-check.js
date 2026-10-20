// Regression checks for defects of the 3D world found in the bug hunt of 0.8.1 (docs/strands/bugs-world.md):
//   basket   "Alles zurückgeben" decides once whether the books fly back (a full basket let its last five fly)
//   weather  the soundscape and the garden's animals read a trace of thunder or snow left over from the last weather
//            as a storm or snowfall (the garden fell silent for minutes after a storm had passed)
//   cat      a cat taken down by a rebuild frees the instance buffers of its legs and its tail on the graphics card
//   library  a library update that leaves the shelves as they are hands the world the new library state as well
// The world loop rests; the script drives the player and the actions itself. Prints PASS/FAIL lines and one summary
// line. Muted and hidden like every harness script.
//   COZYSHELVES_BOOKS="<test library>|structured" COZYSHELVES_USERDATA=<fresh dir> node build/screenshot.js world-bugs-check
module.exports = async ({ page, sleep }) => {
  let passed = 0, failed = 0;
  const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); if (ok) passed++; else failed++; };
  const errors = [];
  page.on('pageerror', (e) => { if (!/pointer lock/i.test(e.message)) errors.push(e.message); });

  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  // "Bücherei betreten": the audio starts with the visit (the soundscape needs its context)
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 90; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(2500);
  await page.evaluate(() => { window.__app.closeAllPanels(); window.__app.world.stop(); });
  await sleep(300);

  // ---- 1. the basket: "Alles zurückgeben" ----------------------------------------------------------------------------
  const basket = await page.evaluate(() => {
    const w = window.__app.world, a = w.actions;
    const ids = [...w.books.entries.keys()];
    const run = (n) => {
      a.returnAll(); for (let i = 0; i < 60; i++) a.update(0.1);
      // far from the camera: taking a book makes no animation of its own
      w.player.transition = null; w.player.setPose(0, 0, Math.PI, 0);
      for (const id of ids.slice(0, n)) a.takeBook(id);
      const inBasket = a.basket.length;
      a.returnAll();
      const anims = a.anims.length;
      for (let i = 0; i < 60; i++) a.update(0.1);
      return { inBasket, anims, left: a.basket.length };
    };
    return { eight: run(8), five: run(5), books: ids.length };
  });
  check('eight books in the basket: none of them flies back (one decision for the whole basket)', basket.eight.inBasket === 8 && basket.eight.anims === 0 && basket.eight.left === 0, basket.eight);
  check('five books in the basket: all five fly back', basket.five.inBasket === 5 && basket.five.anims === 5 && basket.five.left === 0, basket.five);

  // ---- 2. a trace of the last weather is no weather -------------------------------------------------------------------
  const weather = await page.evaluate(() => {
    const w = window.__app.world, sc = window.__app.ctx.audio.scape, sky = w.sky;
    if (!sc.ctx) return { noAudio: true };
    const keep = { ...sky.mix };
    w.applySettings({ ...w.settings, timeMode: 'fixed', fixedHour: 12, weather: 'clear', season: 'spring' });
    // what the mix looks like a few minutes after a storm or a snowfall has given way to a clear sky
    Object.assign(sky.mix, { thunder: 0.01, snow: 0.02, rain: 0, cloud: 0.4, overcast: 0 });
    sky.version++;
    sc.update();
    const st = sc.state.weather, fauna = w.fauna.weatherNow(), name = w.weatherState().name;
    Object.assign(sky.mix, keep); sky.version++; sc.update();
    return { thunder: st.thunder, snowing: st.snowing, base: st.base, fauna, name, rates: { song: sc.state.rates.song, frogs: sc.state.rates.frogs } };
  });
  if (weather.noAudio) console.log('NOTE no audio context: the weather part is skipped');
  else {
    check('the soundscape: a trace of thunder is no storm, a trace of snow no snowfall', weather.thunder === false && weather.snowing === false && weather.name === 'clear', weather);
    check('the garden\'s animals see the clear weather, not a storm', weather.fauna === 'clear', weather.fauna);
    check('the songbirds sing at noon in that weather', weather.rates.song > 0, weather.rates);
  }

  // ---- 3. the cat lets its instance buffers go ------------------------------------------------------------------------
  const cat = await page.evaluate(() => {
    const w = window.__app.world, r = w.renderer, gl = r.getContext();
    if (!w.cat) return { noCat: true };
    const Cat = w.cat.constructor, V3 = w.player.position.constructor;
    const cam = w.camera.position;
    const c = new Cat([{ id: 'test', position: new V3(cam.x, 0.5, cam.z - 1.5), yaw: 0 }], () => {}, { colliders: w.colliders, floors: w.layout.floors, props: [] });
    c.group.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    w.scene.add(c.group);
    c.update(0.016, w.player.position, false);
    r.render(w.scene, w.camera);   // its buffers go onto the graphics card
    let deleted = 0;
    const orig = gl.deleteBuffer;
    gl.deleteBuffer = function (b) { deleted++; return orig.call(this, b); };
    // first the geometries by hand (every buffer of theirs), so that what dispose() frees besides is the instance buffers
    const seen = new Set();
    c.group.traverse((o) => { if (o.isMesh && o.geometry && !o.geometry.userData.shared && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); } });
    const geometryBuffers = deleted; deleted = 0;
    const instanced = []; c.group.traverse((o) => { if (o.isInstancedMesh) instanced.push(o.name || 'instanced'); });
    w.scene.remove(c.group); c.dispose();
    gl.deleteBuffer = orig;
    return { geometryBuffers, instanced: instanced.length, freedByDispose: deleted };
  });
  if (cat.noCat) console.log('NOTE no cat in this world: the cat part is skipped');
  else {
    check('the cat drew its geometry (buffers on the graphics card)', cat.geometryBuffers > 0, cat.geometryBuffers);
    check('its dispose frees the instance buffer of every instanced mesh (legs, tail fur, tail rings)', cat.instanced === 3 && cat.freedByDispose === cat.instanced, cat);
  }

  // ---- 4. a library update that leaves the shelves as they are --------------------------------------------------------
  const before = await page.evaluate(() => ({ same: window.__app.world.library === window.__app.state.library, key: window.__app.world.layout.bookcases.map((c) => c.id).join('|') }));
  await page.evaluate(() => window.api.invoke('library:rescan'));
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ active: !!window.__app.state.library.scan?.active }));
    if (!st.active) break;
    await sleep(1000);
  }
  await sleep(2500);
  const after = await page.evaluate(() => {
    const A = window.__app, w = A.world;
    return { same: w.library === A.state.library, records: w.booksById === w.library && false, ids: Object.keys(w.booksById).length === w.library.books.length, key: w.layout.bookcases.map((c) => c.id).join('|') };
  });
  check('the world held the library state of its build', before.same, before.same);
  check('after a rescan that changed no shelf the world holds the new library state and its records', after.same && after.ids && after.key === before.key, after);

  // ---- 5. every place and every stand-by spot of a seat is free ground (nothing pushes the player out of it) -------------
  const spots = await page.evaluate(() => {
    const w = window.__app.world, p = w.player, a = w.actions;
    const out = [];
    const probe = (what, go) => {
      if (a.seatedId) a.leaveSeat();
      p.transition = null; p.keys.clear();
      go();
      const x0 = p.position.x, z0 = p.position.z, y0 = p.position.y;
      for (let i = 0; i < 12; i++) { w.updateDoor(0.05); p.update(0.05); }
      const moved = Math.hypot(p.position.x - x0, p.position.z - z0), dropped = y0 - p.position.y;
      if (moved > 0.03 || Math.abs(dropped) > 0.25 || p.air) out.push({ what, moved: +moved.toFixed(3), dy: +dropped.toFixed(3), air: !!p.air, x: +x0.toFixed(2), z: +z0.toFixed(2) });
    };
    for (const pl of w.places) probe('place ' + pl.id, () => a.teleport(pl.id));
    for (const id of w.seats.keys()) probe('stand by ' + id, () => a.standBy(id));
    a.leaveSeat(); p.transition = null; p.setPose(0, 0, Math.PI, 0);
    return { places: w.places.length, seats: w.seats.size, bad: out };
  });
  check(`every place (${spots.places}) and the stand-by spot of every seat (${spots.seats}) is free ground: the player stays where they land`, spots.bad.length === 0, spots.bad);

  check('no errors in the page', !errors.length, errors.slice(0, 5));
  console.log(`WORLD-BUGS-CHECK ${failed ? 'FAILED' : 'OK'} passed=${passed} failed=${failed}`);
};
