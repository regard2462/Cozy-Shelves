// Birds, koi and frogs (fauna.js, birds.js, bird-models.js, bird-places.js, koi.js, frogs.js, pond.js): the birds are
// about by day and really fly (positions and wing beats change, speeds as their kind flies), perched birds sit on real
// branches, twigs and built things (a ray from just above their feet hits the geometry), in simulated minutes no bird
// passes through the house or a trunk, a bird the player walks up to outside flies off, the koi stay in the lake below
// its surface and gather beside the jetty when the player stands on it, the frogs sit on lily pads or at the water's
// edge and jump into the water when the player comes close, nobody is about at the wrong time or season (night, winter,
// storm), the owl comes at dusk, the setting switches everything off and on, no new shader program appears when they
// first come into sight (on 'low' quality either), their own work costs under 0.5 ms of CPU a frame and the whole frame
// with them stays close to the one without (on the graphics card judged only when other programs leave it mostly free:
// a SKIP line otherwise).
// Pictures: take-offs and landings close (a sparrow, a blackbird), a whole flight, a crow's beat against the sky, the
// buzzard, swallows on the wires, birds on the roof, on twigs and a tree top, a flock, the owl at dusk, the koi from the
// jetty, frogs on the lily pads. FA_PARTS=a,b runs only some parts (birds,perches,house,flee,koi,frogs,seasons,setting,
// programs,perf,shots); FA_SHOTS=none skips the pictures. SHOT_TAG prefixes them.
module.exports = async ({ page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || 'fa';
  const parts = process.env.FA_PARTS ? process.env.FA_PARTS.split(',') : null;
  const want = (p) => !parts || parts.includes(p);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  // the first library update rebuilds the shelves once more: wait until nothing has been rebuilt for a few seconds
  for (let i = 0, quiet = 0; i < 40 && quiet < 4; i++) {
    const changed = await page.evaluate(() => {
      const w = window.__app.world, key = (w.buildTimes || []).length + ':' + !!w.shelfSteps;
      const same = window.__faBuild === key && window.__faShelves === w.shelfSteps;
      window.__faBuild = key; window.__faShelves = w.shelfSteps;
      return !same;
    });
    quiet = changed ? 0 : quiet + 1;
    await sleep(1300);
  }
  let failures = 0, skipped = 0;
  const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); if (!ok) failures++; };
  const skip = (name, why, info) => { console.log(`SKIP ${name} (${why})${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); skipped++; };
  // the conditions the animals read: time, weather, season
  const setState = (hour, weather = 'clear', season = 'summer') => page.evaluate(([hour, weather, season]) => {
    const w = window.__app.world; w.settings.timeMode = 'fixed'; w.settings.fixedHour = hour; w.settings.weather = weather; w.settings.season = season; w.applySettings(w.settings);
  }, [hour, weather, season]);
  const pose = (x, z, yaw, pitch = 0) => page.evaluate(([x, z, yaw, pitch]) => { const w = window.__app.world; w.player.transition = null; w.player.setPose(x, z, yaw, pitch); }, [x, z, yaw, pitch]);
  await page.evaluate(() => { const w = window.__app.world; w.clock.getDelta = () => 1 / 60; document.querySelector('#hud')?.style.setProperty('opacity', '0'); });
  await setState(11);
  await pose(0.6, 8.7, Math.PI + 0.15, 0.1);

  // ---------------------------------------------------------------- start-up -----------------------------------------
  const s0 = await page.evaluate(() => {
    const w = window.__app.world, F = w.fauna;
    // made a part a frame while the player walks about (as after the start without the menu): the slowest part
    const B = F.birds; B.places = null; B.building = null; B.clear(); F.ready = false; F.pond = false;
    const frames = []; let n = 0;
    // the parts, then the first frame with the birds about (they are placed in it)
    while (!F.ready && n < 400) { const t = performance.now(); F.update(1 / 60, false); frames.push(performance.now() - t); n++; }
    { const t = performance.now(); F.update(1 / 60, false); frames.push(performance.now() - t); }
    const slowFrame = +Math.max(...frames).toFixed(1), slowFrames = frames.map((f) => +f.toFixed(1));
    const r = F.prepareAll(); r.steps = n; r.slowFrame = slowFrame; r.frames = slowFrames;
    for (let i = 0; i < 10; i++) w.frame();
    const I = F.info();
    return { exists: !!F, r, birds: I.birds.birds.length, species: [...new Set(I.birds.birds.map((b) => b.species))], koi: I.koi.n, frogs: I.frogs.frogs.length, pads: I.frogs.pads, shore: I.frogs.shore, twigs: (F.birds.twigMeshes || []).length, perchKinds: I.birds.places.kinds };
  });
  check('the birds, the koi and the frogs are part of the world; perches on branches, twigs and built things are found over some frames, a small part each (no frame over 50 ms)', s0.exists && s0.r.birds.perches > 500 && s0.r.birds.sites > 50 && s0.twigs > 0 && ['branch', 'twig', 'top', 'roof', 'post', 'rail', 'wire'].every((k) => s0.perchKinds.includes(k)) && s0.r.birds.ms < 400 && s0.r.slowFrame < 50 && s0.r.birds.slowest < s0.r.birds.ms * 0.4, { perches: s0.r.birds.perches, sites: s0.r.birds.sites, ms: s0.r.birds.ms, slowest: s0.r.birds.slowest, slowFrame: s0.r.slowFrame, frames: s0.r.frames, kinds: s0.perchKinds, twigs: s0.twigs });
  check('a summer day: more than twenty birds of eight kinds, ten koi, a few frogs on pads and at the shore', s0.birds >= 20 && ['sparrow', 'chaffinch', 'tit', 'blackbird', 'crow', 'jackdaw', 'buzzard', 'swallow'].every((k) => s0.species.includes(k)) && s0.koi === 10 && s0.frogs >= 3 && s0.pads >= 8 && s0.shore >= 10, s0);

  // ---------------------------------------------------------------- they fly ------------------------------------------
  if (want('birds')) {
    const fly = await page.evaluate(() => {
      const w = window.__app.world, F = w.fauna, B = F.birds, out = { moved: 0, phases: 0, speeds: {}, takeoffs: 0, landings: 0, flaps: 0, bounds: 0, glides: 0, flares: 0 };
      const start = new Map(B.list.map((b) => [b, b.pos.clone()])), phase0 = new Map(B.list.map((b) => [b, b.wing.phase]));
      const was = new Map(B.list.map((b) => [b, b.state]));
      for (let i = 0; i < 60 * 90; i++) {
        F.update(1 / 60, false);
        for (const b of B.list) {
          if ((b.state === 'fly' && b.t > 0.3) || b.state === 'soar' || b.state === 'hawk' || b.state === 'glide') { const v = b.vel.length(); const s = out.speeds[b.species] ||= [99, 0]; s[0] = Math.min(s[0], v); s[1] = Math.max(s[1], v); }
          if (b.flying) { const m = b.wing.mode; if (m === 'flap') out.flaps++; else if (m === 'bound') out.bounds++; else if (m === 'glide') out.glides++; else if (m === 'flare') out.flares++; }
          const p = was.get(b);
          if (p !== b.state) { if (b.state === 'takeoff') out.takeoffs++; if (p === 'land' && (b.state === 'perch' || b.state === 'ground')) out.landings++; was.set(b, b.state); }
        }
      }
      for (const b of B.list) { if (start.has(b) && start.get(b).distanceTo(b.pos) > 0.5) out.moved++; if (phase0.has(b) && Math.abs(phase0.get(b) - b.wing.phase) > 1e-3) out.phases++; }
      for (const k in out.speeds) out.speeds[k] = out.speeds[k].map((x) => +x.toFixed(1));
      out.n = B.list.length;
      return out;
    });
    console.log('FLY ' + JSON.stringify(fly));
    check('in ninety seconds the birds move about: they take off, fly with beating wings, glide, close their wings in the bounding flight, flare and land', fly.moved >= 8 && fly.takeoffs >= 8 && fly.landings >= 6 && fly.phases >= 8 && fly.flaps > 0 && fly.bounds > 0 && fly.glides > 0 && fly.flares > 0, fly);
    const natural = { sparrow: [2, 9], chaffinch: [2, 10], tit: [2, 8], blackbird: [2, 10], crow: [3, 13], jackdaw: [3, 13], buzzard: [6, 14], swallow: [5, 13], owl: [4, 9] };
    const bad = Object.entries(fly.speeds).filter(([k, [lo, hi]]) => natural[k] && (lo < natural[k][0] * 0.5 || hi > natural[k][1]));
    check('flying speeds as their kinds fly: songbirds up to 9 to 10 m/s, crows 13, swallows 5 to 13, the buzzard soaring at about 10', bad.length === 0 && Object.keys(fly.speeds).length >= 5, fly.speeds);
  }

  // ---------------------------------------------------------------- on real perches -----------------------------------
  if (want('perches')) {
    // in the middle of the garden: the trees round it are drawn with their detailed geometry (the far ones simpler)
    await pose(2, 26, Math.PI, 0);
    await page.evaluate(() => { const w = window.__app.world; for (let i = 0; i < 30; i++) w.frame(); });
    const r = await page.evaluate(() => {
      const w = window.__app.world, F = w.fauna, B = F.birds, P = B.places, V = w.camera.position.constructor, cam = w.camera.position;
      // what a ray may hit: the garden's bark (batched, without the leaves), its built things, the twigs, the benches
      const targets = [];
      w.env.scenery.traverse((o) => { if ((o.isMesh || o.isBatchedMesh) && !o.isInstancedMesh && !['ground', 'lake', 'path'].includes(o.name) && !/-leaves$/.test(o.name)) targets.push(o); });
      for (const m of B.twigMeshes || []) targets.push(m);
      for (const c of w.static.children) if (['parkbench', 'planter'].includes(c.userData.placement?.kind)) c.traverse((o) => { if (o.isMesh) targets.push(o); });
      const ray = new (P.rays.constructor)(), down = new V(0, -1, 0), results = {}, misses = [];
      const kinds = {}, treeKind = { branch: 1, shrub: 1, twig: 1, top: 1 };
      for (const p of P.perches) if (!treeKind[p.kind] || Math.hypot(p.tree.x - cam.x, p.tree.z - cam.z) < 34) (kinds[p.kind] ||= []).push(p);
      // the wires of the string lights are lines: there the distance to the nearest one counts
      const wires = [];
      w.env.scenery.traverse((o) => { if (o.isLineSegments) { const a = o.geometry.attributes.position; for (let i = 0; i + 1 < a.count; i += 2) wires.push([new V().fromBufferAttribute(a, i), new V().fromBufferAttribute(a, i + 1)]); } });
      const toWire = (q) => Math.min(...wires.map(([a, c]) => { const ab = c.clone().sub(a), t = Math.max(0, Math.min(1, q.clone().sub(a).dot(ab) / ab.lengthSq())); return a.clone().addScaledVector(ab, t).distanceTo(q); }));
      B.clear(); B.manual = true;
      for (const [kind, list] of Object.entries(kinds)) {
        const sample = list.filter((_, i) => i % Math.max(1, Math.floor(list.length / 25)) === 0).slice(0, 25);
        let ok = 0, placed = 0;
        for (const p of sample) {
          const b = B.spawn(p.size >= 0.5 ? 'crow' : p.size >= 0.3 ? 'jackdaw' : 'sparrowM', { perch: p });
          // the point between its feet on the perch, in still air (the bark sways in its shader only)
          const pt = p.a.clone().lerp(p.b, p.u);
          let d = null;
          if (kind === 'wire') d = toWire(pt) < 0.012 ? 0 : toWire(pt);
          else { ray.set(pt.clone().add(new V(0, 0.08, 0)), down); ray.far = 0.16; const hits = ray.intersectObjects(targets, false); d = hits.length ? hits[0].distance - 0.08 : null; }
          if (d != null && Math.abs(d) < 0.035) ok++; else if (misses.length < 10) misses.push(`${kind}@${pt.x.toFixed(1)},${pt.y.toFixed(2)},${pt.z.toFixed(1)}:${d == null ? 'none' : d.toFixed(3)}`);
          if (b.pos.distanceTo(P.perchPoint(p, new V())) < 0.001) placed++;
        }
        results[kind] = [ok, placed, sample.length];
      }
      B.clear(); B.manual = false;
      return { results, misses };
    });
    await pose(0.6, 8.7, Math.PI + 0.15, 0.1);
    console.log('PERCH ' + JSON.stringify(r));
    const all = Object.values(r.results);
    check('perched birds sit on real geometry: a ray from just above the point between their feet hits the branch, the twig or the built thing within 3.5 cm', all.every(([ok, , n]) => ok >= n * 0.9) && all.every(([, placed, n]) => placed === n), r);
  }

  // ---------------------------------------------------------------- never through the house or a trunk --------------
  if (want('house')) {
    const h = await page.evaluate(() => {
      const w = window.__app.world, F = w.fauna, B = F.birds, P = B.places;
      B.clear();
      let flying = 0, house = 0, trunk = 0, flights = 0;
      const list = [], was = new Map();
      for (let i = 0; i < 60 * 300; i++) {
        F.update(1 / 60, false);
        for (const b of B.list) {
          if (was.get(b) !== b.state) { if (b.state === 'takeoff') flights++; was.set(b, b.state); }
          if (b.state === 'perch' || b.state === 'ground') continue;
          flying++;
          const x = b.pos.x, y = b.pos.y, z = b.pos.z;
          if (F.inHouse(x, y, z, -0.05)) { house++; if (list.length < 8) list.push(`house ${b.kind}:${b.state}@${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`); }
          if (P.trunkAt(x, y, z, -0.12)) { trunk++; if (list.length < 8) list.push(`trunk ${b.kind}:${b.state}@${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`); }
        }
      }
      return { flying, flights, house, trunk, list };
    });
    check('in five simulated minutes (hundreds of flights) no flying bird is inside the house or a trunk', h.house === 0 && h.trunk === 0 && h.flights > 50, h);
  }

  // ---------------------------------------------------------------- off when the player comes close -----------------
  if (want('flee')) {
    const fl = await page.evaluate(() => {
      const w = window.__app.world, F = w.fauna, B = F.birds, P = B.places, p = w.player, V = w.camera.position.constructor;
      B.clear(); B.manual = true;
      // a sparrow on the east post of the string lights, the player on the lawn walking up to it
      const post = P.perches.filter((q) => q.kind === 'post' && q.site.kind === 'terrace').sort((a, b) => b.p.x - a.p.x)[0];
      const bird = B.spawn('sparrowM', { perch: post, tame: false });
      p.transition = null; p.setPose(post.p.x + 0.5, post.p.z + 9, Math.PI, 0);
      const out = { states: [], start: null, end: null, dTake: null };
      for (let i = 0; i < 400; i++) {
        if (i < 160) p.position.z = post.p.z + 9 - i * (7.2 / 160);
        F.update(1 / 60, false);
        if (!out.states.includes(bird.state)) { out.states.push(bird.state); if (bird.state === 'takeoff') out.dTake = +Math.hypot(bird.pos.x - p.position.x, bird.pos.z - p.position.z).toFixed(1); }
      }
      out.end = +Math.hypot(bird.pos.x - p.position.x, bird.pos.z - p.position.z).toFixed(1);
      // behind the glass: a sparrow on the deck right outside does not mind him
      B.clear(); B.manual = true;
      const deck = new V(1.5, 0, 6.6);
      const b2 = B.spawn('sparrowF', { ground: deck, tame: false });
      p.setPose(1.5, 4.5, Math.PI, -0.2);
      for (let i = 0; i < 200; i++) F.update(1 / 60, false);
      out.indoor = b2.state;
      B.clear(); B.manual = false;
      return out;
    });
    console.log('FLEE ' + JSON.stringify(fl));
    check('a sparrow on a post flies off when the player walks up to it outside (at about 4 m), and away from him', fl.states.includes('takeoff') && fl.dTake != null && fl.dTake < 5.5 && fl.dTake > 2 && fl.end > fl.dTake, fl);
    check('behind the glass the player does not scare a bird on the deck', fl.indoor === 'ground', fl.indoor);
  }

  // ---------------------------------------------------------------- the koi ---------------------------------------------
  if (want('koi')) {
    const k = await page.evaluate(() => {
      const w = window.__app.world, F = w.fauna, K = F.koi, p = w.player;
      p.transition = null; p.setPose(0.6, 8.7, Math.PI, 0);
      const out = { outside: 0, above: 0, inBed: 0, samples: 0, minDepth: 9, maxDepth: 0 };
      const { depthAt, lakeDist } = F.lake;
      for (let i = 0; i < 60 * 120; i++) {
        F.update(1 / 60, false);
        if (i % 6) continue;
        for (const f of K.fish) {
          out.samples++;
          const depth = -0.6 - f.pos.y;
          out.minDepth = Math.min(out.minDepth, depth); out.maxDepth = Math.max(out.maxDepth, depth);
          if (depth < 0.03) out.above++;
          if (depthAt(f.pos.x, f.pos.z) < depth + 0.02) out.inBed++;
          if (lakeDist(f.pos.x, f.pos.z) > 1) out.outside++;
        }
      }
      // the player on the jetty, looking at the water beside it: they come
      const J = w.env.garden.outdoor.jetty;
      const at = J.at(J.len - 2.2, 0);
      p.setPose(at[0], at[1], Math.atan2(-J.side[0], -J.side[1]), -0.5);
      const before = K.fish.map((f) => Math.hypot(f.pos.x - at[0], f.pos.z - at[1]));
      for (let i = 0; i < 60 * 70; i++) F.update(1 / 60, false);
      const after = K.fish.map((f) => Math.hypot(f.pos.x - at[0], f.pos.z - at[1]));
      out.near = [before.filter((d) => d < 4).length, after.filter((d) => d < 4).length];
      out.feeding = K.info().feeding;
      out.shallow = K.fish.filter((f) => Math.hypot(f.pos.x - at[0], f.pos.z - at[1]) < 4).map((f) => +f.depth.toFixed(2));
      p.setPose(0.6, 8.7, Math.PI, 0);
      out.minDepth = +out.minDepth.toFixed(2); out.maxDepth = +out.maxDepth.toFixed(2);
      return out;
    });
    console.log('KOI ' + JSON.stringify(k));
    check('in two simulated minutes every koi stays in the lake, below its surface and above its bed (5 cm and deeper in summer, near the top where they are seen)', k.outside === 0 && k.above === 0 && k.inBed === 0 && k.minDepth >= 0.045 && k.maxDepth < 1.2, k);
    check('when the player stands on the jetty the koi gather beside it, just under the surface', k.feeding && k.near[1] >= 5 && k.near[1] > k.near[0] && k.shallow.every((d) => d < 0.25), { near: k.near, depths: k.shallow });
  }

  // ---------------------------------------------------------------- the frogs -------------------------------------------
  if (want('frogs')) {
    await setState(20.6);   // dusk
    const fr = await page.evaluate(() => {
      const w = window.__app.world, F = w.fauna, R = F.frogs, p = w.player;
      p.transition = null; p.setPose(0.6, 8.7, Math.PI, 0);
      for (let i = 0; i < 60 * 8; i++) F.update(1 / 60, false);
      const I = R.info(), sitting = R.frogs.filter((f) => f.state === 'sit');
      // where they sit: on the pads (inside the pad's disc, at the water's level) or at the water's edge
      const onPad = sitting.filter((f) => f.home?.kind === 'pad' && Math.hypot(f.pos.x - f.home.x, f.pos.z - f.home.z) <= f.home.r && Math.abs(f.pos.y - f.home.y) < 0.01).length;
      const onShore = sitting.filter((f) => f.home?.kind === 'shore' && Math.hypot(f.pos.x - f.home.x, f.pos.z - f.home.z) < 0.05 && f.pos.y > -0.62 && f.pos.y < -0.45).length;
      const out = { n: R.frogs.length, sitting: sitting.length, onPad, onShore, states: I.frogs.map((f) => f.state) };
      // the player walks up to one on the shore or a pad: it jumps into the water, rings spread, the koi near it dart off
      const f = sitting[0];
      if (f) {
        const a = Math.atan2(f.pos.x + 36, f.pos.z - 47);
        p.setPose(f.pos.x + Math.sin(a) * 6, f.pos.z + Math.cos(a) * 6, 0, -0.3);
        const states = [];
        for (let i = 0; i < 240; i++) {
          if (i < 120) { p.position.x = f.pos.x + Math.sin(a) * (6 - i * 0.035); p.position.z = f.pos.z + Math.cos(a) * (6 - i * 0.035); }
          F.update(1 / 60, false);
          if (!states.includes(f.state)) states.push(f.state);
          if (f.state === 'under' && out.rings == null) out.rings = R.ringList.length;
        }
        out.jumped = states;
      }
      p.setPose(0.6, 8.7, Math.PI, 0);
      return out;
    });
    console.log('FROGS ' + JSON.stringify(fr));
    check('at dusk in summer six or more frogs are about, each sitting on a lily pad (within its disc, at the water) or at the water\'s edge', fr.n >= 6 && fr.sitting >= 4 && fr.onPad + fr.onShore === fr.sitting && fr.onPad >= 2, fr);
    check('a frog the player walks up to jumps into the water with a ring of ripples', fr.jumped && fr.jumped.includes('jump') && fr.jumped.includes('under') && fr.rings > 0, { states: fr.jumped, rings: fr.rings });
  }

  // ---------------------------------------------------------------- the right time and season ---------------------------
  if (want('seasons')) {
    const census = async (hour, weather, season, secs = 30) => { await setState(hour, weather, season); return page.evaluate((secs) => {
      const w = window.__app.world, F = w.fauna;
      F.birds.clear(); F.frogs.clear();
      for (let i = 0; i < 60 * secs; i++) F.update(1 / 60, false);
      const B = F.birds.list, sp = {}; for (const b of B) sp[b.species] = (sp[b.species] || 0) + 1;
      return { birds: B.length, species: sp, frogs: F.frogs.frogs.length, koiDepth: +Math.min(...F.koi.fish.map((f) => f.depth)).toFixed(2) };
    }, secs); };
    const day = await census(11, 'clear', 'summer');
    const night = await census(1, 'clear', 'summer');
    const winter = await census(11, 'clear', 'winter', 120);
    const storm = await census(11, 'storm', 'summer');
    const autumn = await census(11, 'clear', 'autumn');
    console.log('SEASONS ' + JSON.stringify({ day, night, winter, storm, autumn }));
    const songbirds = (c) => ['sparrow', 'chaffinch', 'tit', 'blackbird'].reduce((a, k) => a + (c.species[k] || 0), 0);
    check('at night no songbird is about (only an owl now and then)', songbirds(night) === 0 && Object.keys(night.species).every((k) => k === 'owl'), night.species);
    check('in winter fewer birds, no swallows, no frogs, the koi gone down into the deep water (after two minutes)', winter.birds < day.birds && !winter.species.swallow && winter.frogs === 0 && winter.koiDepth >= 0.7, { winter, day: day.birds });
    check('no swallows in autumn either; in a storm the birds shelter (at most one blackbird about)', !autumn.species.swallow && storm.birds <= 1, { autumn: autumn.species, storm: storm.species });
    // the owl: at dusk within some minutes
    await setState(20.9, 'clear', 'summer');
    const owl = await page.evaluate(() => {
      const w = window.__app.world, F = w.fauna; F.birds.clear();
      let seen = 0, t = 0;
      for (let i = 0; i < 60 * 600 && !seen; i++) { F.update(1 / 60, false); t += 1 / 60; if (F.birds.list.some((b) => b.species === 'owl')) seen = Math.round(t); }
      const o = F.birds.list.find((b) => b.species === 'owl');
      return { seen, y: o ? +(o.pos.y - 0).toFixed(1) : null, state: o?.state };
    });
    check('at dusk a barn owl glides by along the meadow within ten minutes', owl.seen > 0, owl);
    await setState(11);
  }

  // ---------------------------------------------------------------- the setting -----------------------------------------
  if (want('setting')) {
    const st = await page.evaluate(() => {
      const w = window.__app.world, F = w.fauna;
      for (let i = 0; i < 30; i++) F.update(1 / 60, true);
      const before = { birds: F.birds.list.length, koi: F.koi.mesh.count, frogs: F.frogs.frogs.length };
      w.applySettings({ ...w.settings, fauna: false });
      for (let i = 0; i < 30; i++) w.frame();
      let drawn = 0; F.group.traverse((o) => { if ((o.isInstancedMesh || o.isBatchedMesh) && o.visible && o.count > 0) drawn++; });
      const off = { enabled: F.enabled, visible: F.group.visible, birds: F.birds.list.length, frogs: F.frogs.frogs.length, drawnWhileHidden: drawn };
      w.applySettings({ ...w.settings, fauna: true });
      for (let i = 0; i < 120; i++) w.frame();
      const on = { enabled: F.enabled, visible: F.group.visible, birds: F.birds.list.length, koi: F.koi.mesh.count };
      return { before, off, on };
    });
    check('the setting "Vögel und Tiere am See" switches them all off (nothing left, nothing runs) and on again', st.before.birds > 10 && !st.off.enabled && !st.off.visible && st.off.birds === 0 && st.off.frogs === 0 && st.on.enabled && st.on.visible && st.on.birds > 10 && st.on.koi >= 10, st);
  }

  // ---------------------------------------------------------------- no new programs, no hitch ---------------------------
  if (want('programs')) {
    await setState(11);
    const pr = await page.evaluate(() => {
      const w = window.__app.world, F = w.fauna, B = F.birds, V = w.camera.position.constructor;
      const p = w.player; p.transition = null;
      // looking out over the lake from its shore: koi, frogs (tame) and birds in view
      p.setPose(-14.6, 45.7, Math.atan2(15.8 - 14.6, 46.2 - 45.7) + Math.PI, -0.35);
      F.frogs.tame = true; F.frogs.placeNear(-15.8, 46.2);
      for (let i = 0; i < 6; i++) w.frame();
      const before = w.renderer.info.programs.length;
      const times = [];
      B.clear(); B.manual = true;
      for (const [k, x, y, z] of [['sparrowM', -15.2, 2, 47.5], ['crow', -16, 3, 49], ['swallow', -15, 1.5, 48.2], ['owl', -17, 3, 50], ['buzzard', -17.5, 6, 52], ['bluetit', -15.6, 1.9, 47]]) B.spawn(k, { at: new V(x, y, z), yaw: 1, mode: 'flap' });
      for (let i = 0; i < 30; i++) { const t = performance.now(); w.frame(); times.push(performance.now() - t); }
      const after = w.renderer.info.programs.length;
      F.frogs.tame = false; B.clear(); B.manual = false;
      // on 'low' (drawn straight to the screen) the warm-up runs again for that path
      const g = w.settings.graphics || {};
      w.applySettings({ ...w.settings, graphics: { ...g, quality: 'low' } });
      for (let i = 0; i < 12; i++) w.frame();
      const low1 = w.renderer.info.programs.length;
      for (let i = 0; i < 30; i++) w.frame();
      const low2 = w.renderer.info.programs.length;
      w.applySettings({ ...w.settings, graphics: { ...g, quality: 'high' } });
      for (let i = 0; i < 10; i++) w.frame();
      return { before, after, low1, low2, max: +Math.max(...times).toFixed(1), median: +times.sort((a, b) => a - b)[15].toFixed(1) };
    });
    check('no new shader program when birds, koi and frogs first come into sight (warmed up with the world), on \'low\' quality either', pr.after === pr.before && pr.low2 === pr.low1, pr);
    check('no stall when they first come into sight (no frame over 50 ms)', pr.max < 50, pr);
  }

  // ---------------------------------------------------------------- frame and CPU times ---------------------------------
  if (want('perf')) {
    await setState(11);
    // How busy the graphics card is with other programs, measured while this world stands still: a timer query counts
    // their work as well, so the time on the card is judged only when it is mostly free (a SKIP line otherwise).
    const busyNow = () => { try { return parseFloat(require('child_process').execSync('nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits', { timeout: 5000 }).toString()); } catch { return NaN; } };
    const loads = [];
    for (let i = 0; i < 7; i++) { const b = busyNow(); if (!Number.isNaN(b)) loads.push(b); await sleep(250); }
    loads.sort((a, b) => a - b);
    const others = loads.length ? loads[loads.length >> 1] : null;
    // at three places, the animals shown and hidden every other frame: the CPU time of their own work (their update,
    // a running average) and what they add to the whole frame on the processor and on the graphics card (timer
    // queries), as the median of the differences of neighbouring frames (a load that changes slowly cancels out)
    const views = [['terrace', 0.6, 8.7, Math.PI + 0.15, 0.08], ['jetty', null, null, null, -0.25], ['path', -6.2, 24.5, 2.6, 0.02]];
    const res = {};
    for (const [name, x, z, yaw, pitch] of views) {
      res[name] = await page.evaluate(async ([name, x, z, yaw, pitch]) => {
        const w = window.__app.world, F = w.fauna, p = w.player; p.transition = null;
        if (name === 'jetty') { const J = w.env.garden.outdoor.jetty, at = J.at(J.len - 2.2, 0); p.setPose(at[0], at[1], Math.atan2(-J.dir[0], -J.dir[1]), pitch); }
        else p.setPose(x, z, yaw, pitch);
        const gl = w.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'), px = new Uint8Array(4);
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const show = (on) => { F.enabled = on; F.group.visible = on; };
        const time = async () => {
          // (two frames without a query first: waiting for every query left the card idle between the measured frames, and
          // after the 0.9 drawing got lighter its clocks often dropped so far that a 2 ms frame of the terrace took
          // 12 ms on it, the animals' 0.05 ms with it stretched to over 1; with frames in its queue it keeps its pace)
          if (ext) { w.frame(); w.frame(); }
          const q = ext ? gl.createQuery() : null;
          if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
          const a = performance.now(); w.frame(); const cpu = performance.now() - a;
          if (!q) { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return { cpu, gpu: null }; }
          gl.endQuery(ext.TIME_ELAPSED_EXT);
          for (let k = 0; k < 300 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await wait(2);
          const gpu = gl.getParameter(ext.GPU_DISJOINT_EXT) ? null : gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
          gl.deleteQuery(q);
          return { cpu, gpu };
        };
        const upd = [], update = F.update;
        F.update = function (...a) { const t = performance.now(); update.apply(this, a); if (this.enabled) upd.push(performance.now() - t); };
        for (let i = 0; i < 30; i++) { show(i % 2 === 0); await time(); }
        const s = { cpuOn: [], cpuOff: [], cpuD: [], gpuOn: [], gpuOff: [], gpuD: [] };
        for (let i = 0; i < 90; i++) {
          show(true); const a = await time();
          show(false); const b = await time();
          s.cpuOn.push(a.cpu); s.cpuOff.push(b.cpu); s.cpuD.push(a.cpu - b.cpu);
          if (a.gpu != null && b.gpu != null) { s.gpuOn.push(a.gpu); s.gpuOff.push(b.gpu); s.gpuD.push(a.gpu - b.gpu); }
        }
        show(true);
        delete F.update;
        // their own draws: one of them at a time, a timer query round each of its draws (in every pass that draws it) and
        // the processor's time from setting it up to its draw call; per object the median on the graphics card (the least
        // of a few samples when it was seldom in view) and the mean on the processor (its clock counts in steps of 0.1 ms
        // here; the longest tenth left out), summed. Short spans, so other programs come in between seldom.
        const trimmed = (a) => { const v = [...a].sort((x, y) => x - y).slice(0, Math.max(1, Math.ceil(a.length * 0.9))); return v.reduce((x, y) => x + y, 0) / v.length; };
        let own = null, ownCpu = 0;
        {
          const objs = [], per = new Map();
          F.group.traverse((o) => { if (o.isMesh || o.isInstancedMesh || o.isBatchedMesh) objs.push(o); });
          // (in turn: a frame with the timer queries, then one without them for the processor's time)
          for (let round = 0; round < 30; round++) for (const o of objs) {
            const gpuRound = ext && round % 2 === 0;
            const ob = o.onBeforeRender, oa = o.onAfterRender, qs = [];
            let open = null, t0 = 0, cpu = 0, drawn = 0;
            o.onBeforeRender = function (...a) { t0 = performance.now(); ob.apply(this, a); drawn++; if (gpuRound && !open) { open = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, open); } };
            o.onAfterRender = function (...a) { if (open) { gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(open); open = null; } oa.apply(this, a); cpu += performance.now() - t0; };
            w.frame();
            o.onBeforeRender = ob; o.onAfterRender = oa;
            if (!drawn) continue;
            if (!per.has(o)) per.set(o, { gpu: [], cpu: [] });
            if (!gpuRound) { per.get(o).cpu.push(cpu); continue; }
            let sum = 0, ok = true;
            for (const q of qs) {
              for (let k = 0; k < 300 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await wait(2);
              if (gl.getParameter(ext.GPU_DISJOINT_EXT)) ok = false; else sum += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
              gl.deleteQuery(q);
            }
            if (ok) per.get(o).gpu.push(sum);
          }
          const typical = (a) => { const v = [...a].sort((x, y) => x - y); return v.length >= 3 ? v[v.length >> 1] : v[0]; };
          if (ext) own = 0;
          for (const [, r] of per) { if (r.cpu.length) ownCpu += trimmed(r.cpu); if (ext && r.gpu.length) own += typical(r.gpu); }
        }
        const med = (a) => { if (!a.length) return null; const v = [...a].sort((x, y) => x - y); return +v[v.length >> 1].toFixed(3); };
        const info = w.renderer.info; info.autoReset = false; info.reset(); w.frame(); const calls = info.render.calls; info.autoReset = true;
        return { cpu: { on: med(s.cpuOn), off: med(s.cpuOff), more: med(s.cpuD), draws: +ownCpu.toFixed(3) }, gpu: { on: med(s.gpuOn), off: med(s.gpuOff), more: med(s.gpuD), own: own == null ? null : +own.toFixed(3) }, fauna: +trimmed(upd).toFixed(3), birds: +F.times.birds.toFixed(3), koi: +F.times.koi.toFixed(3), frogs: +F.times.frogs.toFixed(3), calls };
      }, [name, x, z, yaw, pitch]);
    }
    console.log(`PERF others=${others ?? '?'}% ` + JSON.stringify(res));
    const free = others !== null && others <= 50, why = others === null ? 'no reading of the graphics card' : `the graphics card was ${others} % busy with other programs`;
    check('the birds, koi and frogs cost under 0.5 ms of CPU a frame (their update and setting up their draws)', Object.values(res).every((r) => r.fauna + r.cpu.draws < 0.5), Object.fromEntries(Object.entries(res).map(([k, r]) => [k, { all: +(r.fauna + r.cpu.draws).toFixed(3), update: r.fauna, draws: r.cpu.draws, birds: r.birds, koi: r.koi, frogs: r.frogs }])));
    const gInfo = Object.fromEntries(Object.entries(res).map(([k, r]) => [k, r.gpu]));
    if (Object.values(res).some((r) => r.gpu.own == null)) skip('their own draws take under 0.5 ms on the graphics card', 'no timer queries', gInfo);
    // the timer queries measure the card's time, which another program's load stretches (0.05 ms alone, 0.6 ms with the
    // card half busy): judged when other programs leave it mostly free
    else if (free) check('their own draws take under 0.5 ms on the graphics card (timer queries round each of them, one at a time)', Object.values(res).every((r) => r.gpu.own < 0.5), gInfo);
    else skip('their own draws take under 0.5 ms on the graphics card', why, gInfo);
    // the whole frame (it waits for the graphics card now and then: judged when other programs leave it mostly free)
    const cName = 'with them the whole frame takes under 1 ms more on the processor (median of neighbouring frames)', cInfo = Object.fromEntries(Object.entries(res).map(([k, r]) => [k, r.cpu]));
    if (free) check(cName, Object.values(res).every((r) => r.cpu.more < 1), cInfo); else skip(cName, why, cInfo);
    const gName = 'with them the whole frame takes under 1 ms more on the graphics card (median of neighbouring frames)';
    if (Object.values(res).some((r) => r.gpu.more == null)) skip(gName, 'no timer queries', gInfo);
    else if (free) check(gName, Object.values(res).every((r) => r.gpu.more < 1), gInfo);
    else skip(gName, why, gInfo);
  }

  // ---------------------------------------------------------------- pictures --------------------------------------------
  if (want('shots') && process.env.FA_SHOTS !== 'none') {
    await setState(11);
    const scene = async (name, fn, arg, frames = 10) => { await page.evaluate(([fn, arg, frames]) => { const w = window.__app.world; (0, eval)(fn)(w, arg); for (let i = 0; i < frames; i++) w.frame(); }, [fn.toString(), arg, frames]); await shot(`${tag}-${name}`); };
    const look = (w, eye, at, fov = 50) => { const p = w.player; p.transition = null; p.setPose(eye[0], eye[2], Math.atan2(-(at[0] - eye[0]), -(at[2] - eye[2])), Math.atan2(at[1] - eye[1], Math.hypot(at[0] - eye[0], at[2] - eye[2]))); p.position.y = eye[1]; p.fov = fov; w.camera.fov = fov; w.camera.updateProjectionMatrix(); };
    await page.evaluate((look) => { window.__faLook = (0, eval)(look); }, look.toString());
    // a take-off and a landing seen from the side and a little from the front, the camera going along with the bird
    // `D` m away (every frame of the take-off, every second one of the landing) from the side of the house, the sun at
    // its back: a sparrow from one string-light post to the next, a blackbird from the lawn up onto a post
    const flight = async (name, kind, setup, D) => {
      const r = await page.evaluate(([kind, setup, D]) => {
        const w = window.__app.world, B = w.fauna.birds, P = B.places, V = w.camera.position.constructor;
        B.clear(); B.manual = true;
        const { from, to, face } = (0, eval)(setup)(P, V);
        const b = from.perch ? B.spawn(kind, { perch: from.perch }) : B.spawn(kind, { ground: from.ground });
        const S = b.pos.clone(), T = to.perch ? to.perch.p.clone() : to.p.clone(), dir = new V(T.x - S.x, 0, T.z - S.z).normalize();
        // the camera on the side towards the house (looking out into the garden) or away from it
        const side = new V(-dir.z, 0, dir.x); if ((side.dot(new V(-S.x, 0, 6 - S.z)) < 0) !== (face === 'house')) side.negate();
        Object.assign(window, { __faB: b, __faSide: side, __faFwd: dir, __faLandSide: null, __faLandFwd: null, __faT: T, __faD: D });
        window.__faTrack = () => {
          const b = window.__faB, land = !!window.__faLandSide, p = b.pos.clone().addScaledVector(b.vel, 1 / 60);
          const s = window.__faLandSide || window.__faSide, f = window.__faLandFwd || window.__faFwd, D = window.__faD;
          const eye = p.clone().addScaledVector(s, D * Math.cos(0.6)).addScaledVector(f, D * Math.sin(0.6));
          eye.y = land ? p.y + 0.15 * D : Math.max(p.y - 0.1 * D, B.places.height(eye.x, eye.z) + 0.55);
          window.__faLook(w, eye.toArray(), p.toArray(), 30);
        };
        window.__faTrack();
        for (let i = 0; i < 6; i++) w.frame();
        B.send(b, to);
        return { from: S.toArray().map((x) => +x.toFixed(2)), to: T.toArray().map((x) => +x.toFixed(2)), d: +S.distanceTo(T).toFixed(1) };
      }, [kind, setup.toString(), D]);
      let up = 0, down = -1, after = 0;
      const states = [];
      for (let f = 0; f < 600 && after < 10; f++) {
        const st = await page.evaluate(() => {
          const w = window.__app.world, b = window.__faB, V = w.camera.position.constructor;
          let framed = false;
          if (b.state === 'land' && !window.__faLandSide) {
            // the landing: from the side of the way in
            const dir = new V(window.__faT.x - b.pos.x, 0, window.__faT.z - b.pos.z); if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0); dir.normalize();
            const side = new V(-dir.z, 0, dir.x); if (side.dot(window.__faSide) < 0) side.negate();
            window.__faLandSide = side; window.__faLandFwd = dir; framed = true;
          }
          window.__faTrack();
          w.frame();
          return { state: b.state, mode: b.wing.mode, framed };
        });
        if (st.framed) down = 0;
        if (down < 0 && f < 16) await shot(`${tag}-takeoff-${name}-${String(up++).padStart(2, '0')}`);
        if (down >= 0 && f % 2 === 0) await shot(`${tag}-landing-${name}-${String(down++).padStart(2, '0')}`);
        if (states[states.length - 1] !== st.state + ':' + st.mode) states.push(st.state + ':' + st.mode);
        if (st.state === 'perch' || st.state === 'ground') { if (f > 10) after++; }
      }
      console.log(`FLIGHT ${name} ${JSON.stringify({ ...r, states })}`);
    };
    await flight('sparrow', 'sparrowM', (P) => {
      const posts = P.perches.filter((q) => q.kind === 'post' && q.site.kind === 'terrace').sort((a, b) => a.p.x - b.p.x);
      return { from: { perch: posts[posts.length - 2] }, to: { perch: posts[1] } };
    }, 1.4);
    await flight('blackbird', 'blackbirdM', (P, V) => {
      const posts = P.perches.filter((q) => q.kind === 'post' && q.site.kind === 'terrace').sort((a, b) => a.p.x - b.p.x);
      return { from: { ground: new V(2.4, P.height(2.4, 13.8), 13.8) }, to: { perch: posts[posts.length - 2] } };
    }, 2.0);
    // the whole flight from post to post, from the lawn: every fourth frame
    await page.evaluate(() => {
      const w = window.__app.world, B = w.fauna.birds, P = B.places; B.clear(); B.manual = true;
      const posts = P.perches.filter((q) => q.kind === 'post' && q.site.kind === 'terrace').sort((a, b) => a.p.x - b.p.x);
      window.__faB = B.spawn('sparrowM', { perch: posts[posts.length - 2] });
      window.__faLook(w, [0.2, 2.2, 15.4], [0.2, 3.4, 9.8], 52);
      for (let i = 0; i < 8; i++) w.frame();
      B.send(window.__faB, { perch: posts[1] });
    });
    for (let f = 0, after = 0; f < 300 && after < 6; f++) {
      const st = await page.evaluate(() => { const w = window.__app.world; w.frame(); return window.__faB.state; });
      if (f % 4 === 0) await shot(`${tag}-flight-${String(f).padStart(3, '0')}`);
      if (st === 'perch' && f > 10) after++;
    }
    // a crow beating past against the sky, close: one beat in several frames
    await page.evaluate(() => {
      const w = window.__app.world, B = w.fauna.birds, V = w.camera.position.constructor; B.clear(); B.manual = true;
      window.__faCrow = B.spawn('crow', { at: new V(0, 5.2, 13), yaw: Math.PI / 2, mode: 'flap', pitch: 0.04 });
      window.__faLook(w, [0, 1.62, 9.2], [0, 5.2, 13], 32);
    });
    for (let f = 0; f < 8; f++) { await page.evaluate((f) => { const w = window.__app.world; w.fauna.birds.poseAt(window.__faCrow, f / 8, 'flap'); w.frame(); }, f); await shot(`${tag}-crow-beat-${f}`); }
    // a buzzard circling high up, birds on the twigs out of a crown and on a tree top, a flock against the sky
    await scene('buzzard', (w) => { const B = w.fauna.birds, V = w.camera.position.constructor; B.clear(); B.manual = true; B.spawn('buzzard', { at: new V(-1.5, 9.5, 21), yaw: Math.PI / 2 + 0.3, mode: 'glide', bank: -0.35, pitch: 0.04 }); window.__faLook(w, [0, 1.62, 15], [-1.5, 9.5, 21], 30); });
    const inCrown = (P, p) => P.sites.some((s) => (s.kind === 'tree' || s.kind === 'shrub') && Math.hypot(p.x - s.x, p.z - s.z) < s.r + 0.6 && Math.abs(p.y - s.y) < s.r * 1.3 + 1);
    await page.evaluate((f) => { window.__faInCrown = (0, eval)(f); }, inCrown.toString());
    await scene('twigs', (w) => {
      const B = w.fauna.birds, P = B.places, V = w.camera.position.constructor; B.clear(); B.manual = true;
      const trees = P.sites.filter((s) => s.kind === 'tree').sort((a, b) => Math.hypot(a.x, a.z - 16) - Math.hypot(b.x, b.z - 16));
      for (const site of trees) {
        const o = new V(-site.x, 0, 8 - site.z).normalize();
        const twigs = site.perches.filter((q) => q.kind === 'twig' && q.out.dot(o) > 0.3).sort((a, b) => b.p.y - a.p.y);
        if (!twigs.length) continue;
        const q = twigs[0], eye = q.p.clone().addScaledVector(q.out, 0.95).addScaledVector(o, 0.55); eye.y -= 0.35;
        if (window.__faInCrown(P, eye)) continue;
        B.spawn('chaffinchM', { perch: q });
        const q2 = twigs.find((t) => t !== q && t.p.distanceTo(q.p) < 2.5);
        if (q2) B.spawn('greattit', { perch: q2 });
        window.__faLook(w, eye.toArray(), [q.p.x, q.p.y + 0.06, q.p.z], 30);
        return;
      }
    });
    await scene('treetop', (w) => {
      const B = w.fauna.birds, P = B.places, V = w.camera.position.constructor; B.clear(); B.manual = true;
      const tops = P.perches.filter((q) => q.kind === 'top' && q.site.z > 8).sort((a, b) => Math.hypot(a.p.x, a.p.z - 18) - Math.hypot(b.p.x, b.p.z - 18));
      for (const q of tops) {
        const o = new V(-q.p.x, 0, 8 - q.p.z).normalize(), eye = q.p.clone().addScaledVector(o, q.site.r + 2.6); eye.y -= 1.4;
        if (window.__faInCrown(P, eye)) continue;
        B.spawn('blackbirdM', { perch: q, yaw: Math.atan2(o.x, o.z) + 0.6 });
        window.__faLook(w, eye.toArray(), [q.p.x, q.p.y + 0.1, q.p.z], 13);
        return;
      }
    });
    await scene('flock', (w) => {
      const B = w.fauna.birds, V = w.camera.position.constructor; B.clear(); B.manual = true;
      for (let i = 0; i < 8; i++) {
        const b = B.spawn(['sparrowF', 'sparrowM', 'chaffinchM'][i % 3], { at: new V(-1.3 + i * 0.36 + Math.sin(i * 2.3) * 0.25, 4.1 + Math.sin(i * 1.7) * 0.45, 14 + Math.cos(i * 1.3) * 0.5), yaw: Math.PI / 2 + 0.15 * Math.sin(i), mode: 'flap', bank: 0.15 * Math.cos(i * 1.1) });
        B.poseAt(b, (i * 0.37) % 1, i % 4 === 3 ? 'bound' : 'flap');
      }
      window.__faLook(w, [0.2, 1.62, 10.9], [0, 4.0, 14], 34);
    });
    // in the light of the late afternoon, which falls on the front of the house: swallows on the wires, birds on the
    // edge of the roof
    await setState(17.5);
    await scene('wires', (w) => {
      const B = w.fauna.birds, P = B.places, V = w.camera.position.constructor; B.clear(); B.manual = true;
      const wires = P.perches.filter((q) => q.kind === 'wire'), m = new V(-2, 2.9, 9.4);
      const q0 = wires.slice().sort((a, b) => a.p.distanceTo(m) - b.p.distanceTo(m))[0];
      const pick = [];
      for (const q of wires.filter((q) => q.p.distanceTo(q0.p) < 2.4).sort((a, b) => a.p.distanceTo(q0.p) - b.p.distanceTo(q0.p))) if (pick.length < 6 && pick.every((o) => o.p.distanceTo(q.p) > 0.32)) pick.push(q);
      pick.forEach((q) => B.spawn('swallow', { perch: q }));
      const c = new V(); pick.forEach((q) => c.add(q.p)); c.multiplyScalar(1 / pick.length);
      // from the lawn side and below: their white fronts against the sky
      window.__faLook(w, [c.x + 0.35, c.y - 0.75, c.z + 1.2], c.toArray(), 40);
    });
    await scene('roof', (w) => {
      const B = w.fauna.birds, P = B.places; B.clear(); B.manual = true;
      const roof = P.perches.filter((q) => q.kind === 'roof').sort((a, b) => Math.abs(a.p.x - 1.5) - Math.abs(b.p.x - 1.5)).slice(0, 7).sort((a, b) => a.p.x - b.p.x).filter((_, i) => i % 2 === 0);
      ['jackdaw', 'sparrowM', 'blackbirdM', 'jackdaw'].forEach((k, i) => { if (roof[i]) B.spawn(k, { perch: roof[i], yaw: (i - 1.5) * 0.4 }); });
      const c = roof[1].p.clone().lerp(roof[2].p, 0.5);
      window.__faLook(w, [c.x + 0.5, c.y - 0.9, c.z + 2.6], [c.x, c.y + 0.12, c.z], 38);
    });
    // the barn owl at dusk
    await setState(20.4);
    await scene('owl', (w) => { const B = w.fauna.birds, V = w.camera.position.constructor; B.clear(); B.manual = true; B.spawn('owl', { at: new V(-0.8, 3.6, 15.2), yaw: Math.PI / 2, mode: 'glide', bank: 0.1, pitch: 0.02 }); window.__faLook(w, [0.2, 1.4, 12.6], [-0.8, 3.6, 15.2], 34); }, null, 30);
    await setState(11);
    await page.evaluate(() => { const B = window.__app.world.fauna.birds; B.clear(); B.manual = false; });
    // the koi beside the jetty, a frog on a lily pad
    await scene('koi', (w) => {
      const F = w.fauna, J = w.env.garden.outdoor.jetty, at = J.at(J.len - 1.4, 0), side = J.at(J.len - 1.6, J.platWidth / 2 + 1.0);
      F.koi.fish.forEach((f, i) => { f.pos.x = side[0] + Math.cos(i * 2.4) * (0.4 + i * 0.12); f.pos.z = side[1] + Math.sin(i * 2.4) * (0.4 + i * 0.12); });
      window.__faLook(w, [at[0], J.top + 1.62, at[1]], [side[0], -0.75, side[1]], 50);
    }, null, 120);
    await scene('frogs', (w) => { const F = w.fauna; F.frogs.tame = true; const f = F.frogs.placeNear(-15.8, 46.2); window.__faLook(w, [f.pos.x + 0.9, 0.25, f.pos.z - 0.6], [f.pos.x, f.pos.y + 0.03, f.pos.z], 30); }, null, 20);
    await page.evaluate(() => { const w = window.__app.world; w.fauna.frogs.tame = false; w.player.fov = w.settings.graphics?.fov || 72; });
  }

  check('no errors on the page', errors.length === 0, errors.slice(0, 5));
  console.log(`FAUNA ${failures ? 'FAILED ' + failures : 'OK'}${skipped ? ` (${skipped} skipped)` : ''}`);
};
