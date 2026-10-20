// The sounds of the world (0.7, app/src/audio/soundscape.js): no switches any more, everything follows what you see and
// where you stand. Reads the soundscape's state per situation (it never listens to a loudspeaker: the harness is muted):
//   rain   only while it rains, louder outside than inside, inside muffled, louder at the glass than in the room
//   wind   with a storm strong outside and a low roar inside; in fair weather only the leaves outside, nothing inside
//   thunder only after a lightning strike, after distance / 343 s
//   fire   the crackle only near the burning fireplace, quiet through the glass, gone when it does not burn; the fire bowl
//          hook (world.fireBowl) plays where the bowl is while it burns
//   clock  the tick only close to the clock
//   garden songbirds by day outside (the dawn chorus, fewer in winter, none at night or in a storm), the owl at night, frogs
//          at dusk at the lake and none in winter, crickets on summer nights, ducks not on ice
//   door   no sound when the terrace door swings, none on a trip through the places menu
//   steps  the surface under the feet (parquet, rugs, deck, gravel path, lawn, trail, beach, jetty, snow, puddles), the
//          rate following the pace, the step at the lowest point of the head's bob, outdoors without the room's echo
// and renders sounds offline (footsteps, birds, frogs, rain, wind, thunder …): a footstep is no click (its energy spread
// over 80 to 220 ms, little above 4 kHz on wood, no tone), nothing clips or is silent. The renders are saved as WAV files
// (SOUND_DIR, else SHOT_DIR/sounds) for listening. The single switches (settings.audio.sounds) silence exactly their
// sound. Prints PASS/FAIL lines and one summary line; SND_PARTS=rain,wind,
// thunder,fire,clock,garden,door,steps,renders,perf picks parts. Muted and hidden like every harness script.
//   node build/screenshot.js sound-check
const fs = require('fs');
const path = require('path');

module.exports = async ({ app, page, shot, sleep }) => {
  const only = (process.env.SND_PARTS || '').split(',').filter(Boolean);
  const want = (part) => !only.length || only.includes(part);
  const soundDir = process.env.SOUND_DIR || path.join(process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots'), 'sounds');
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1600, 900); });
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  // "Bücherei betreten": the audio starts with the visit (main.js enterLibrary)
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(1500);
  await page.evaluate(() => { window.__app.closeAllPanels(); window.__app.world.stop(); });
  await sleep(300);
  let failures = 0, passes = 0;
  const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); if (ok) passes++; else failures++; };

  // ---- helpers in the page ---------------------------------------------------------------------------------------
  await page.evaluate(() => {
    const w = window.__app.world, p = w.player, audio = window.__app.ctx.audio, sc = audio.scape;
    const H = window.__snd = { sfx: [] };
    const orig = audio.sfx.bind(audio);
    audio.sfx = (name, o) => { H.sfx.push({ name, surface: o?.surface || null, wet: o?.wet ?? null, dry: o?.dry ?? null, bob: +p.bob.toFixed(4), t: performance.now() }); return orig(name, o); };
    H.base = { ...w.settings };
    H.set = (patch) => { w.applySettings({ ...w.settings, ...patch }); w.env?.set({ hour: w.currentHour() }); };
    H.reset = () => { w.applySettings({ ...H.base, timeMode: 'fixed', fixedHour: 12, weather: 'clear', season: 'spring' }); w.env?.set({ hour: 12 }); };
    H.pose = (x, z, yaw = 0) => {
      if (w.actions.seatedId) w.actions.leaveSeat();
      p.transition = null; p.keys.clear(); p.setPose(x, z, yaw, 0); p.update(0.001);
      for (let i = 0; i < 12; i++) w.updateDoor(0.2);   // the door opens or closes for the new place
      w.camera.updateMatrixWorld();
    };
    H.state = () => { sc.update(); return sc.state; };
    H.lv = () => H.state().levels;
    H.audio = audio; H.sc = sc;
  });
  const cc = (fn, arg) => page.evaluate(fn, arg);
  await cc(() => window.__snd.reset());
  const info0 = await cc(() => ({ ctx: window.__snd.audio.ctx?.state, sr: window.__snd.audio.ctx?.sampleRate, attached: !!window.__snd.sc.world, sfx: window.__snd.audio.sfxNames() }));
  check('the audio runs (muted) and the soundscape follows the world', info0.ctx === 'running' && info0.attached, info0);

  // places: outside on the lawn, on the terrace, in the hall (middle, at the glass), in the book room, near the fire, the clock
  const P = { lawn: [6, 16], terrace: [-3.5, 8.6], hall: [0, -1.5], glass: [3.2, 4.7], room: [0, -14], roomWin: [0, -22.8], fire: [-6.9, -0.7], clockNear: [-7.3, 0.4], hallEast: [6.5, -1], jetty: null };
  P.jetty = await cc(() => { const J = window.__app.world.env.garden.outdoor.jetty; return J.at(J.len - J.platLen - 0.8, 0); });

  // ================================================================= rain =========================================================
  if (want('rain')) {
    const r = await cc((P) => {
      const H = window.__snd, out = {};
      H.set({ weather: 'clear' });
      for (const k of ['lawn', 'hall']) { H.pose(...P[k]); const s = H.state(); out['clear_' + k] = { rain: s.levels.rain, field: s.applied.rain?.field ?? 0, layer: s.layers.includes('rain') }; }
      H.set({ weather: 'rain' });
      for (const k of ['lawn', 'terrace', 'hall', 'glass', 'room', 'roomWin']) { H.pose(...P[k], k === 'glass' ? Math.PI / 2 : 0); const s = H.state(); out[k] = { field: s.applied.rain?.field ?? 0, lp: Math.round(s.applied.rain?.lp ?? 0), pane: s.applied.rain?.pane ?? 0, roof: s.applied.rain?.roof ?? 0, zone: s.listener.name, glass: s.listener.glass }; }
      H.set({ weather: 'storm' }); H.pose(...P.lawn); out.storm = H.state().applied.rain;
      H.set({ weather: 'snow' }); H.pose(...P.lawn); { const s = H.state(); out.snow = { rain: s.levels.rain, field: s.applied.rain?.field ?? 0 }; }
      H.set({ weather: 'fog' }); H.pose(...P.lawn); { const s = H.state(); out.fog = { rain: s.levels.rain, field: s.applied.rain?.field ?? 0 }; }
      // the door open: the rain comes in
      H.set({ weather: 'rain' }); H.pose(0, 4.6, 0); out.door = { open: +window.__app.world.door.t.toFixed(2), field: H.state().applied.rain?.field ?? 0 };
      return out;
    }, P);
    check('no rain sound in clear weather (outside and inside)', r.clear_lawn.rain === 0 && r.clear_lawn.field === 0 && r.clear_hall.field === 0, { lawn: r.clear_lawn, hall: r.clear_hall });
    check('rain outside: the full sound', r.lawn.field > 0.6 && r.lawn.lp > 8000 && r.terrace.field > 0.6, { lawn: r.lawn, terrace: r.terrace });
    check('rain inside: softer and muffled', r.hall.field > 0.04 && r.hall.field < r.lawn.field * 0.35 && r.hall.lp < 2000 && r.room.field < r.hall.field, { hall: r.hall, room: r.room });
    check('rain inside: louder at the glass front and at the windows (drops on the pane)', r.glass.pane > 0.08 && r.hall.pane < 0.02 && r.glass.field > r.hall.field && r.roomWin.pane > 0.08 && r.roomWin.field > r.room.field, { glass: r.glass, roomWin: r.roomWin });
    check('rain on the roof indoors', r.hall.roof > 0 && r.lawn.roof === 0, { hall: r.hall.roof, lawn: r.lawn.roof });
    check('a storm rains harder than rain', r.storm && r.storm.field > r.lawn.field, { storm: r.storm?.field, rain: r.lawn.field });
    check('snow and fog: no rain sound', r.snow.rain === 0 && r.snow.field === 0 && r.fog.field === 0, { snow: r.snow, fog: r.fog });
    check('the open terrace door lets the rain in', r.door.open > 0.9 && r.door.field > r.hall.field * 2, r.door);
  }

  // ================================================================= wind =========================================================
  if (want('wind')) {
    const r = await cc((P) => {
      const H = window.__snd, out = {};
      for (const weather of ['clear', 'fog', 'snow', 'storm']) {
        H.set({ weather });
        H.pose(...P.lawn); const a = H.state(); H.pose(...P.hall); const b = H.state(); H.pose(...P.glass, Math.PI / 2); const c = H.state();
        out[weather] = { wind: +a.levels.wind.toFixed(2), outAir: a.applied.wind?.air ?? 0, outLeaves: a.applied.wind?.leaves ?? 0, inAir: b.applied.wind?.air ?? 0, inLeaves: b.applied.wind?.leaves ?? 0, whistle: c.applied.wind?.whistle ?? 0 };
      }
      return out;
    }, P);
    check('a storm: strong wind outside, a low roar inside, the whistle at the glass', r.storm.outAir > 0.18 && r.storm.inAir > 0.03 && r.storm.inAir < r.storm.outAir && r.storm.whistle > 0.01, r.storm);
    check('fair weather: only a light breeze in the trees outside, no wind indoors', r.clear.outAir < 0.01 && r.clear.outLeaves > 0.01 && r.clear.outLeaves < r.storm.outLeaves * 0.4 && r.clear.inAir < 0.005 && r.clear.whistle === 0, r.clear);
    check('fog: calm; snow: almost silent, a soft wind at most', r.fog.outAir < 0.005 && r.fog.outLeaves < r.clear.outLeaves && r.snow.outAir < 0.03, { fog: r.fog, snow: r.snow });
  }

  // ================================================================= thunder ======================================================
  if (want('thunder')) {
    const r = await cc(async () => {
      const H = window.__snd, w = window.__app.world, sc = H.sc, sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      H.set({ weather: 'storm' }); H.pose(0, 12, 0);
      w.running = true;                                   // the world counts as drawn: a flash can be seen
      const n0 = sc.strikes.length;
      // a lightning flash (environment.js sets lightning to 1 and lets it fade)
      w.env.lightning = 1; sc.update();
      const s = sc.strikes[sc.strikes.length - 1];
      const planned = { strikes: sc.strikes.length - n0, distance: s?.distance, delay: s?.delay, expect: s ? +(s.distance / 343).toFixed(3) : null, at: s ? +(s.at - s.strikeAt).toFixed(3) : null };
      w.env.lightning = 0.4; sc.update(); w.env.lightning = 0; sc.update();
      // a near strike: its thunder after 700 / 343 s, then heard
      const t0 = H.audio.ctx.currentTime, near = sc.strike(t0, { distance: 700 });
      let heard = null;
      for (let i = 0; i < 40 && !heard; i++) { await sleep(100); sc.update(); heard = sc.log.find((e) => e.type === 'thunder' && Math.abs(e.at - near.at) < 0.01); }
      // rain without a storm: flashes do not happen, and no thunder comes in a minute of simulated waiting
      H.set({ weather: 'rain' }); w.env.lightning = 0;
      const before = sc.strikes.length; for (let i = 0; i < 20; i++) sc.update();
      const rainStrikes = sc.strikes.length - before;
      // the world not drawn (the full-screen reader): no flash is seen, now and then a distant rumble only
      H.set({ weather: 'storm' }); w.running = false; sc.quietThunderAt = 0; sc.update(); sc.quietThunderAt = H.audio.ctx.currentTime - 1; sc.update();
      const unseen = sc.strikes[sc.strikes.length - 1];
      w.running = false;
      return { planned, near: { delay: near.delay, heardAt: heard ? +(heard.at - t0).toFixed(3) : null, gain: heard?.gain }, rainStrikes, unseen: unseen?.unseen ? unseen.distance : null };
    });
    check('a lightning flash plans its thunder', r.planned.strikes === 1 && r.planned.distance >= 400 && r.planned.distance <= 6000, r.planned);
    check('the thunder comes distance / 343 s after the flash', Math.abs(r.planned.delay - r.planned.expect) < 0.01 && Math.abs(r.planned.at - r.planned.expect) < 0.02, r.planned);
    check('a strike 700 m away is heard after 2.04 s', r.near.heardAt != null && Math.abs(r.near.heardAt - 700 / 343) < 0.01 && r.near.gain > 0.5, r.near);
    check('no thunder without lightning (rain)', r.rainStrikes === 0, r.rainStrikes);
    check('behind the full-screen reader a distant rumble only (no flash to see)', r.unseen != null && r.unseen >= 3500, r.unseen);
  }

  // ================================================================= the fire =====================================================
  if (want('fire')) {
    const r = await cc((P) => {
      const H = window.__snd, w = window.__app.world, out = {};
      H.set({ weather: 'clear' });
      for (const k of ['fire', 'hall', 'hallEast', 'room', 'terrace']) { H.pose(...P[k]); const s = H.state(); out[k] = { gain: s.applied.fire?.gain ?? 0, pan: s.applied.fire?.pan ?? 0 }; }
      // looking towards the passage (yaw 0): the fireplace is on the left
      H.pose(...P.fire, 0); out.facingNorth = H.state().applied.fire?.pan;
      // the fire out: no crackle
      const keep = w.fire.intensity; w.fire.intensity = 0; H.pose(...P.fire); for (let i = 0; i < 3; i++) H.sc.update(); out.out = { level: H.sc.levels.fire, applied: H.state().applied.fire };
      w.fire.intensity = keep;
      // the fire bowl of the garden (firebowl.js): world.fireBowl { position, isBurning(), setBurning() }, lit and put
      // out by hand here (null gives it back to the time of day)
      const bowl = w.fireBowl, bp = bowl.position;
      bowl.setBurning(true);
      H.pose(bp.x + 1.4, bp.z + 1.4); out.bowlNear = H.state().applied.fireBowl?.gain ?? 0;
      H.pose(6, 16); out.bowlFar = H.state().applied.fireBowl?.gain ?? 0;
      H.pose(0, -1); out.bowlInside = H.state().applied.fireBowl?.gain ?? 0;
      bowl.setBurning(false); H.pose(bp.x + 1.4, bp.z + 1.4); out.bowlOut = H.state().levels.fireBowl;
      bowl.setBurning(null); H.sc.update();
      return out;
    }, P);
    check('the fireplace crackles near the fire', r.fire.gain > 0.3, r.fire);
    check('the crackle falls off with distance and is gone in the book room', r.hall.gain < r.fire.gain && r.hallEast.gain < r.hall.gain && r.room.gain < 0.02, { hall: r.hall.gain, east: r.hallEast.gain, room: r.room.gain });
    check('outside only faintly through the glass', r.terrace.gain < 0.06, r.terrace.gain);
    check('the fire is heard from its side (left when it is on the left)', r.facingNorth < -0.5, r.facingNorth);
    check('no crackle when the fire does not burn', r.out.level === 0 && !r.out.applied, r.out);
    check('the fire bowl hook: its crackle near the burning bowl, softer further off, none when it is out', r.bowlNear > 0.3 && r.bowlFar < r.bowlNear * 0.3 && r.bowlInside < r.bowlFar + 0.02 && r.bowlOut === 0, { near: r.bowlNear, far: r.bowlFar, inside: r.bowlInside, out: r.bowlOut });
  }

  // ================================================================= the clock ====================================================
  if (want('clock')) {
    const r = await cc((P) => {
      const H = window.__snd, out = {};
      for (const k of ['clockNear', 'fire', 'hall', 'room', 'lawn']) { H.pose(...P[k]); out[k] = H.state().applied.clock?.gain ?? 0; }
      return out;
    }, P);
    check('the clock ticks softly close to it and not across the hall', r.clockNear > 0.08 && r.hall < r.clockNear * 0.25 && r.room === 0 && r.lawn === 0, r);
  }

  // ================================================================= the garden ===================================================
  if (want('garden')) {
    const r = await cc((P) => {
      const H = window.__snd, sc = H.sc, out = {};
      sc.seed(4242);
      const run = (patch, where, seconds = 600) => { H.set({ timeMode: 'fixed', ...patch }); H.pose(...where); const s = H.state(); return { rates: s.rates, sim: sc.simulate(seconds) }; };
      out.springMorning = run({ fixedHour: 9, season: 'spring', weather: 'clear' }, P.lawn);
      out.dawn = run({ fixedHour: 6.6, season: 'spring', weather: 'clear' }, P.lawn);
      out.winterMorning = run({ fixedHour: 10, season: 'winter', weather: 'clear' }, P.lawn);
      out.summerNoon = run({ fixedHour: 13, season: 'summer', weather: 'clear' }, P.lawn);
      out.night = run({ fixedHour: 1, season: 'spring', weather: 'clear' }, P.lawn);
      out.rain = run({ fixedHour: 9, season: 'spring', weather: 'rain' }, P.lawn);
      out.storm = run({ fixedHour: 9, season: 'spring', weather: 'storm' }, P.lawn);
      out.inside = run({ fixedHour: 9, season: 'spring', weather: 'clear' }, P.hall);
      out.duskJetty = run({ fixedHour: 21, season: 'summer', weather: 'clear' }, P.jetty);
      out.noonJetty = run({ fixedHour: 12, season: 'summer', weather: 'clear' }, P.jetty);
      out.winterDusk = run({ fixedHour: 17.2, season: 'winter', weather: 'clear' }, P.jetty);
      out.summerNight = run({ fixedHour: 23, season: 'summer', weather: 'clear' }, P.lawn);
      out.winterNight = run({ fixedHour: 23, season: 'winter', weather: 'clear' }, P.lawn);
      out.snowDay = run({ fixedHour: 11, season: 'winter', weather: 'snow' }, P.jetty);
      // a real phrase is placed in a tree and heard: the gain of the last songs outside and inside
      H.set({ fixedHour: 9, season: 'spring', weather: 'clear' }); H.pose(...P.lawn); sc.update();
      out.songsOutside = sc.log.filter((e) => e.type === 'song').slice(-8).map((e) => e.gain);
      sc.seed(null);
      // crickets at night in summer: the level heard on the lawn
      H.set({ fixedHour: 23, season: 'summer', weather: 'clear' }); H.pose(...P.lawn); { const s = H.state(); out.crickets = { rate: s.rates.crickets, near: Math.max(...Object.entries(s.applied).filter(([k]) => /^cricket\d/.test(k)).map(([, v]) => v?.gain || 0), 0) }; }
      H.set({ fixedHour: 23, season: 'winter', weather: 'clear' }); { const s = H.state(); out.cricketsWinter = s.rates.crickets; }
      H.set({ fixedHour: 9, season: 'spring', weather: 'clear' }); { const s = H.state(); out.cricketsSpringDay = s.rates.crickets; }
      H.reset();
      return out;
    }, P);
    const sp = (x) => Object.keys(x.sim.species || {}).length;
    check('songbirds by day outside: phrases from several species', r.springMorning.sim.song > 30 && sp(r.springMorning) >= 5, { rate: r.springMorning.rates.song, sim: r.springMorning.sim });
    check('the dawn chorus: far more song around sunrise', r.dawn.rates.chorus > 0.5 && r.dawn.sim.song > r.springMorning.sim.song * 1.5, { dawn: r.dawn.sim.song, morning: r.springMorning.sim.song, chorus: r.dawn.rates.chorus });
    check('fewer birds in winter, more in spring', r.winterMorning.sim.song < r.springMorning.sim.song * 0.35 && r.summerNoon.sim.song < r.springMorning.sim.song, { winter: r.winterMorning.sim.song, spring: r.springMorning.sim.song, summerNoon: r.summerNoon.sim.song });
    check('no songbirds at night, the owl instead', (r.night.sim.song || 0) === 0 && r.night.sim.owl >= 1, r.night.sim);   // (the owl calls now and then: once is enough)
    check('rain quiets the birds, a storm silences them', r.rain.sim.song < r.springMorning.sim.song * 0.4 && (r.storm.sim.song || 0) === 0, { rain: r.rain.sim.song, storm: r.storm.sim.song || 0 });
    check('birds are heard outside, faintly through the glass inside', r.springMorning.sim.gain.song > r.inside.sim.gain.song * 3 && r.inside.sim.gain.song > 0.002, { outside: r.springMorning.sim.gain.song, inside: r.inside.sim.gain.song });
    check('frogs at dusk at the lake (summer)', r.duskJetty.rates.frogs > 3 && r.duskJetty.sim.frog > 20, { rate: r.duskJetty.rates.frogs, sim: r.duskJetty.sim.frog });
    check('frogs: few at noon, none in winter, none on ice', r.noonJetty.rates.frogs < r.duskJetty.rates.frogs * 0.3 && (r.winterDusk.sim.frog || 0) === 0 && (r.snowDay.sim.frog || 0) === 0, { noon: r.noonJetty.rates.frogs, winter: r.winterDusk.sim.frog || 0, ice: r.snowDay.sim.frog || 0 });
    check('crickets on summer nights, none in winter, little by day', r.crickets.rate > 0.8 && r.crickets.near > 0.01 && r.cricketsWinter === 0 && r.cricketsSpringDay < 0.15, { summerNight: r.crickets, winter: r.cricketsWinter, springDay: r.cricketsSpringDay });
    check('ducks and moorhens on open water, not on ice', (r.springMorning.sim.duck || 0) + (r.springMorning.sim.moorhen || 0) > 2 && !(r.snowDay.sim.duck || r.snowDay.sim.moorhen), { day: [r.springMorning.sim.duck, r.springMorning.sim.moorhen], ice: [r.snowDay.sim.duck || 0, r.snowDay.sim.moorhen || 0] });
    check('water laps at the jetty, not on the lawn', (r.duskJetty.sim.lap || 0) > 50 && !r.springMorning.sim.lap, { jetty: r.duskJetty.sim.lap, lawn: r.springMorning.sim.lap || 0 });
    check('the cuckoo only in spring and early summer, the chiffchaff not in winter', !r.winterMorning.sim.species?.cuckoo && !r.winterMorning.sim.species?.chiffchaff, r.winterMorning.sim.species);
  }

  // ================================================================= the door =====================================================
  if (want('door')) {
    const r = await cc(async () => {
      const H = window.__snd, w = window.__app.world, p = w.player, n0 = H.sfx.length;
      H.pose(0, 2.5, Math.PI);   // in the hall, facing the terrace door
      p.keys.add('KeyW');
      let opened = 0;
      for (let i = 0; i < 220; i++) { w.updateDoor(1 / 60); p.update(1 / 60); opened = Math.max(opened, w.door.t); }
      p.keys.clear();
      for (let i = 0; i < 150; i++) { w.updateDoor(1 / 60); p.update(1 / 60); }
      // back in through the door, then a trip through the places menu (G)
      p.yaw = 0; p.keys.add('KeyW');
      for (let i = 0; i < 260; i++) { w.updateDoor(1 / 60); p.update(1 / 60); }
      p.keys.clear(); for (let i = 0; i < 80; i++) w.updateDoor(1 / 60);
      window.__app.openPanel('menu', { tab: 'places' });
      await new Promise((r) => setTimeout(r, 600));
      const btn = document.querySelector('.place-grid .place'); btn?.click();
      await new Promise((r) => setTimeout(r, 1300));
      window.__app.closeAllPanels();
      const names = H.sfx.slice(n0).map((s) => s.name);
      return { opened: +opened.toFixed(2), outside: +p.position.z.toFixed(1), names: [...new Set(names)], door: names.filter((n) => n === 'door').length, defined: H.audio.sfxNames().includes('door'), placeClicked: !!btn };
    });
    check('the terrace door swings without a sound (no creak, no latch)', r.opened > 0.9 && r.door === 0 && !r.defined, r);
    check('a trip through the places menu makes no door sound', r.placeClicked && r.door === 0, r.names);
  }

  // ================================================================= footsteps ====================================================
  if (want('steps')) {
    const spots = await cc(() => {
      const H = window.__snd, w = window.__app.world, O = w.env.garden.outdoor, J = O.jetty, out = {};
      H.reset();
      const at = (name, x, z) => { H.pose(x, z); out[name] = H.sc.stepInfo(); };
      at('parquet', 5, -12); at('hall floor', 0.5, 1.5); at('fireplace rug', -5.6, 0); at('reading table rug', 1.6, -3.2); at('passage rug', 0, -7.3); at('book room rug', 2, -16.4);
      at('deck', -3, 7.6); at('gravel path', 0.2, 12.5); at('lawn', 6, 14); at('trail', 2.4, 20.5); at('pebble beach', J.shore[0] - J.side[0] * 2.2 - J.dir[0] * 0.4, J.shore[1] - J.side[1] * 2.2 - J.dir[1] * 0.4); const jp = J.at(4, 0); at('jetty', jp[0], jp[1]);
      H.set({ weather: 'snow' }); at('snowy lawn', 6, 14); at('snowy hall', 0.5, 1.5);
      H.set({ weather: 'rain' }); at('wet path', 0.2, 12.5); at('dry hall in the rain', 0.5, 1.5);
      H.reset();
      // on furniture: the seat of a chair, the reading table
      const p = w.player; H.pose(1.6, -2.4); p.ground = 0.76; out['on the table'] = H.sc.stepInfo(); p.ground = 0.45; out['on a seat'] = H.sc.stepInfo(); p.ground = 0; H.pose(0, 0);
      return out;
    });
    const expect = { parquet: 'wood', 'hall floor': 'wood', 'fireplace rug': 'carpet', 'reading table rug': 'carpet', 'passage rug': 'carpet', 'book room rug': 'carpet', deck: 'deck', 'gravel path': 'gravel', lawn: 'grass', trail: 'earth', 'pebble beach': 'pebbles', jetty: 'jetty', 'snowy lawn': 'snow', 'snowy hall': 'wood', 'wet path': 'gravel', 'dry hall in the rain': 'wood', 'on the table': 'wood', 'on a seat': 'cushion' };
    const wrong = Object.entries(expect).filter(([k, v]) => spots[k]?.surface !== v).map(([k, v]) => `${k}: ${spots[k]?.surface} (want ${v})`);
    check('footsteps choose the surface under the feet', !wrong.length, wrong.length ? wrong : Object.fromEntries(Object.entries(spots).map(([k, v]) => [k, v.surface])));
    check('outside the steps have no room echo, inside they do', spots.lawn.outdoor && spots.jetty.outdoor && !spots.parquet.outdoor, { lawn: spots.lawn.outdoor, parquet: spots.parquet.outdoor });
    check('rain wets the ground outside (puddles), not the floors inside', spots['wet path'].wet > 0.5 && spots['dry hall in the rain'].wet === 0 && spots.lawn.wet === 0, { path: spots['wet path'].wet, hall: spots['dry hall in the rain'].wet });

    // walking for real: W held down from the hall over the rug, out through the door, across the deck to the path
    const walk = await cc(() => {
      const H = window.__snd, w = window.__app.world, p = w.player;
      H.reset(); H.pose(3.5, -3.6, Math.PI);   // beside the reading table, on its rug, facing the glass front
      const n0 = H.sfx.length;
      let t = 0, dist = 0, last = p.position.clone();
      // W held down, the view turned towards the next point, as a person walks: over the rug, across the parquet, out
      // through the door, over the deck onto the gravel path
      for (const [tx, tz] of [[3.5, -0.4], [0.6, 1.4], [0, 4.2], [0, 7.6], [0.2, 12.5], [-1.4, 17]]) {
        p.keys.add('KeyW');
        for (let i = 0; i < 60 * 8 && Math.hypot(tx - p.position.x, tz - p.position.z) > 0.45; i++) {
          p.yaw = Math.atan2(-(tx - p.position.x), -(tz - p.position.z));
          w.updateDoor(1 / 60); p.update(1 / 60); t += 1 / 60;
          dist += Math.hypot(p.position.x - last.x, p.position.z - last.z); last.copy(p.position);
        }
      }
      p.keys.clear(); for (let i = 0; i < 30; i++) p.update(1 / 60);
      const steps = H.sfx.slice(n0).filter((s) => s.name === 'footstep');
      // the surfaces in their order, without repeats
      const seq = []; for (const s of steps) if (seq[seq.length - 1] !== s.surface) seq.push(s.surface);
      // the pace on the straight: steps per second while walking on the lawn and path
      return { seq, steps: steps.length, seconds: +t.toFixed(1), dist: +dist.toFixed(1), rate: +(steps.length / t).toFixed(2), bobs: steps.map((s) => s.bob), dry: steps.filter((s) => s.dry).map((s) => s.surface), end: [+p.position.x.toFixed(1), +p.position.z.toFixed(1)] };
    });
    const order = ['carpet', 'wood', 'deck', 'gravel'];
    let k = 0; for (const s of walk.seq) if (s === order[k]) k++;
    check('a walk from the hall over the rug, through the door and across the deck onto the path', k === order.length, { seq: walk.seq, end: walk.end });
    check('the steps follow the walk (about one step per 1.25 m)', walk.steps > walk.dist / 1.45 && walk.steps < walk.dist / 1.05, { steps: walk.steps, dist: walk.dist, seconds: walk.seconds });
    check('every step lands at the lowest point of the head bob', walk.bobs.length > 5 && walk.bobs.slice(2).every((b) => b < -0.008), walk.bobs.slice(0, 12));
    check('steps outside are dry (no room echo), inside not', walk.dry.length > 0 && walk.dry.every((s) => ['deck', 'gravel', 'grass', 'earth'].includes(s)), [...new Set(walk.dry)]);

    const pace = await cc(() => {
      const H = window.__snd, w = window.__app.world, p = w.player, out = {};
      // along the gravel path towards the jetty: steps per second once up to speed
      const route = [[0.2, 12.5], [-1.4, 17], [-4.4, 22.5], [-8.6, 27.5], [-12.6, 30.6], [-17, 34]];
      const go = (run) => {
        H.pose(0, 10.5, Math.PI); p.keys.add('KeyW'); if (run) p.keys.add('ShiftLeft');
        let n1 = null, t = 0, k = 0;
        for (let i = 0; i < 60 * 7 && k < route.length; i++) {
          const [tx, tz] = route[k];
          if (Math.hypot(tx - p.position.x, tz - p.position.z) < 0.6) { k++; continue; }
          p.yaw = Math.atan2(-(tx - p.position.x), -(tz - p.position.z)); p.update(1 / 60);
          if (i === 60) n1 = H.sfx.length; if (i >= 60) t += 1 / 60;   // the first second brings it up to speed
        }
        const steps = H.sfx.slice(n1).filter((s) => s.name === 'footstep').length;
        p.keys.clear(); for (let i = 0; i < 30; i++) p.update(1 / 60);
        return { rate: +(steps / t).toFixed(2), steps, seconds: +t.toFixed(1) };
      };
      out.walk = go(false); out.run = go(true);
      // walking into the closed front door of the hall (east wall) makes no steps once you stand at it
      H.pose(7.0, 0.2, -Math.PI / 2); p.keys.add('KeyW');
      for (let i = 0; i < 90; i++) p.update(1 / 60);
      const n0 = H.sfx.length;
      for (let i = 0; i < 180; i++) p.update(1 / 60);
      p.keys.clear(); out.wallSteps = H.sfx.slice(n0).filter((s) => s.name === 'footstep').length; out.wallX = +p.position.x.toFixed(2);
      return out;
    });
    check('along the path: about 1.9 steps a second walking, 2.6 running', pace.walk.rate > 1.7 && pace.walk.rate < 2.1 && pace.run.rate > 2.35 && pace.run.rate < 2.85, pace);
    check('pressing against a wall makes no steps', pace.wallSteps <= 1, pace);
  }

  // ================================================================= offline renders ==============================================
  if (want('renders')) {
    fs.mkdirSync(soundDir, { recursive: true });
    // in the page: render, measure (envelope, spectrum) and encode as WAV
    await cc(() => {
      const fft = (re, im) => {
        const n = re.length;
        for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
        for (let len = 2; len <= n; len <<= 1) {
          const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
          for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < len / 2; j++) { const a = i + j, b = a + len / 2; const br = re[b] * cr - im[b] * ci, bi = re[b] * ci + im[b] * cr; re[b] = re[a] - br; im[b] = im[a] - bi; re[a] += br; im[a] += bi; const tt = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = tt; } }
        }
      };
      const metrics = (d, sr) => {
        let tot = 0, peak = 0, nan = 0; for (let i = 0; i < d.length; i++) { const x = d[i]; if (!Number.isFinite(x)) { nan++; continue; } tot += x * x; peak = Math.max(peak, Math.abs(x)); }
        let c = 0, t05 = null, t95 = null; for (let i = 0; i < d.length; i++) { c += d[i] * d[i]; if (t05 == null && c >= tot * 0.05) t05 = i; if (t95 == null && c >= tot * 0.95) { t95 = i; break; } }
        let on = 0; while (on < d.length && Math.abs(d[on]) < peak * 0.1) on++;
        let e4 = 0; for (let i = on; i < Math.min(d.length, on + sr * 0.004); i++) e4 += d[i] * d[i];
        const N = 1 << Math.min(17, Math.ceil(Math.log2(Math.max(2048, Math.min(d.length, sr * 3))))), re = new Float64Array(N), im = new Float64Array(N);
        for (let i = 0; i < Math.min(N, d.length); i++) re[i] = d[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / Math.min(N, d.length)));
        fft(re, im);
        let all = 0, hi = 0, cen = 0, geo = 0, ar = 0, nb = 0, best = 0, bestF = 0;
        for (let k = 1; k < N / 2; k++) { const f = k * sr / N, pw = re[k] * re[k] + im[k] * im[k]; all += pw; if (f > 4000) hi += pw; cen += f * pw; if (f > 60 && f < 6000) { geo += Math.log(pw + 1e-24); ar += pw; nb++; } if (f > 150 && pw > best) { best = pw; bestF = f; } }
        return { rms: +Math.sqrt(tot / d.length).toFixed(5), peak: +peak.toFixed(3), nan, span_ms: t05 != null && t95 != null ? Math.round((t95 - t05) / sr * 1000) : 0, above4k: +(hi / (all || 1)).toFixed(3), centroid: Math.round(cen / (all || 1)), first4ms: +(e4 / (tot || 1)).toFixed(3), flatness: +(Math.exp(geo / nb) / (ar / nb || 1)).toFixed(3), peakHz: Math.round(bestF) };
      };
      const wav = (d, sr) => {
        const n = d.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
        const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
        str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
        v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
        for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-32767, Math.min(32767, Math.round((Number.isFinite(d[i]) ? d[i] : 0) * 32767))), true);
        let s = ''; const bytes = new Uint8Array(buf); for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(s);
      };
      // the footstep of 0.6, for comparison: a sine thump with a pitch drop and a wooden knock
      const oldStep = async (sr) => {
        const off = new OfflineAudioContext(1, sr, sr), t = 0.05, v = 0.8;
        const n = off.createBufferSource(), nb = off.createBuffer(1, sr * 0.3, sr), nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1; n.buffer = nb;
        const f = off.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; const g = off.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.14 * v, t + 0.003); g.gain.setTargetAtTime(0, t + 0.003, 0.02);
        n.connect(f); f.connect(g); g.connect(off.destination); n.start(t); n.stop(t + 0.24);
        const o = off.createOscillator(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.07); const og = off.createGain(); og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.12 * v, t + 0.002); og.gain.setTargetAtTime(0, t + 0.002, 0.025);
        o.connect(og); og.connect(off.destination); o.start(t); o.stop(t + 0.3);
        const k = off.createOscillator(); k.type = 'triangle'; k.frequency.value = 220; const kg = off.createGain(); kg.gain.setValueAtTime(0, t + 0.005); kg.gain.linearRampToValueAtTime(0.02 * v, t + 0.007); kg.gain.setTargetAtTime(0, t + 0.007, 0.012);
        k.connect(kg); kg.connect(off.destination); k.start(t + 0.005); k.stop(t + 0.2);
        return (await off.startRendering()).getChannelData(0);
      };
      window.__snd.render = async (kind, id, seconds, params) => {
        const sr = 48000;
        const d = id === 'old-0.6' ? await oldStep(sr) : await window.__snd.audio.renderOffline(kind, id, seconds, { sampleRate: sr, params });
        return { m: metrics(d, sr), wav: wav(d, sr) };
      };
    });
    const save = (name, b64) => fs.writeFileSync(path.join(soundDir, name + '.wav'), Buffer.from(b64, 'base64'));
    const render = async (file, kind, id, seconds, params) => { const r = await cc(({ kind, id, seconds, params }) => window.__snd.render(kind, id, seconds, params), { kind, id, seconds, params }); save(file, r.wav); return r.m; };

    // footsteps: one step per surface (dry: without the room) and a walking sequence for listening
    const surfaces = ['wood', 'carpet', 'stone', 'deck', 'jetty', 'gravel', 'pebbles', 'grass', 'earth', 'snow'];
    const steps = {};
    for (const s of surfaces) {
      const ms = [];
      for (let k = 0; k < 4; k++) ms.push(await render(k === 0 ? `step-${s}` : `_tmp`, 'sfx', 'footstep', 0.7, { surface: s, speed: 2.4, seed: 11 + k, dry: true }));
      steps[s] = { span: [Math.min(...ms.map((m) => m.span_ms)), Math.max(...ms.map((m) => m.span_ms))], above4k: Math.max(...ms.map((m) => m.above4k)), first4ms: Math.max(...ms.map((m) => m.first4ms)), flatness: Math.min(...ms.map((m) => m.flatness)), centroid: Math.round(ms.reduce((a, m) => a + m.centroid, 0) / ms.length), peak: Math.max(...ms.map((m) => m.peak)), nan: ms.reduce((a, m) => a + m.nan, 0) };
    }
    try { fs.unlinkSync(path.join(soundDir, '_tmp.wav')); } catch {}
    steps.old = await render('step-old-0.6', 'sfx', 'old-0.6', 1, {});
    for (const s of ['wood', 'grass', 'gravel', 'jetty', 'snow']) await render(`step-${s}-wet`, 'sfx', 'footstep', 0.7, { surface: s, speed: 2.4, seed: 21, wet: 1, dry: true });
    await render('step-wood-run', 'sfx', 'footstep', 0.7, { surface: 'wood', run: true, speed: 4.2, seed: 5, dry: true });
    await render('step-wood-landing', 'sfx', 'footstep', 0.7, { surface: 'wood', landing: true, impact: 3.5, seed: 6, dry: true });
    console.log('STEPS ' + JSON.stringify(steps));
    const bad = surfaces.filter((s) => steps[s].nan || steps[s].peak >= 0.9 || steps[s].span[0] < 75 || steps[s].span[1] > 230);
    check('a footstep is no click: its energy is spread over 80 to 220 ms on every surface', !bad.length, Object.fromEntries(surfaces.map((s) => [s, steps[s].span])));
    // since 0.9 a step is one soft tread of low noise: the flatness between 60 Hz and 6 kHz says little about such a dark
    // spectrum, so the tone is measured by build/steps-check.js (in npm test); here the onset and the spread count
    check('wood: little energy above 4 kHz, a soft onset (0.6: a short tonal knock)', steps.wood.above4k < 0.06 && steps.wood.first4ms < 0.12 && steps.wood.span[0] > steps.old.span_ms * 1.5 && steps.old.flatness < 0.02 && steps.old.span_ms < 50, { wood: steps.wood, old: steps.old });
    check('carpet is much quieter than the parquet', steps.carpet.peak < steps.wood.peak * 0.45, { carpet: steps.carpet.peak, wood: steps.wood.peak });
    // since 0.9 the gravel path and the snow rustle softly (the bright sine grains of 0.8 squeaked on the garden path):
    // brighter than the wooden floor, the snow drawn out, the jetty low
    check('gravel and snow rustle (brighter than wood, the snow drawn out), the jetty sounds low', steps.gravel.centroid > steps.wood.centroid && steps.snow.span[1] > 150 && steps.jetty.centroid < steps.wood.centroid, { gravel: steps.gravel, snow: steps.snow, jetty: steps.jetty.centroid, wood: steps.wood.centroid });

    // the voices of the garden: within their range of pitch, not silent, not clipping
    const voices = { blackbird: [1100, 7500], robin: [2400, 8500], greattit: [2900, 6800], chaffinch: [2200, 6500], chiffchaff: [3300, 7000], wren: [3200, 8800], pigeon: [350, 1300], sparrow: [2800, 7000], crow: [300, 3000], cuckoo: [480, 800], owl: [450, 1400], 'owl-female': [1200, 2600], frog: [120, 2200], treefrog: [1500, 3200], duck: [250, 3000], moorhen: [600, 3500], lap: [120, 1600] };
    const vm = {};
    for (const [id, [lo, hi]] of Object.entries(voices)) vm[id] = { ...(await render(`voice-${id}`, 'voice', id, id === 'owl' ? 8 : id === 'wren' || id === 'cuckoo' ? 9 : 5, { seed: 3 })), lo, hi };
    console.log('VOICES ' + JSON.stringify(Object.fromEntries(Object.entries(vm).map(([k, v]) => [k, { peakHz: v.peakHz, rms: v.rms, peak: v.peak }]))));
    const vbad = Object.entries(vm).filter(([, v]) => v.nan || v.rms < 2e-4 || v.peak >= 0.9 || v.peakHz < v.lo || v.peakHz > v.hi).map(([k, v]) => `${k}: ${v.peakHz} Hz rms ${v.rms} peak ${v.peak}`);
    check('every voice of the garden sings in its own range (birds, owl, frogs, ducks, water)', !vbad.length, vbad.length ? vbad : Object.keys(vm).length);

    // the layers: rain outside and inside, wind, thunder near and far, the fire, the clock, a cricket
    const lm = {};
    lm.rainOutside = await render('rain-outside', 'ambient', 'rain', 8, { level: 0.6, outdoor: 1 });
    lm.rainStorm = await render('rain-storm', 'ambient', 'rain', 8, { level: 1, outdoor: 1 });
    lm.rainDrizzle = await render('rain-drizzle', 'ambient', 'rain', 8, { level: 0.3, outdoor: 1 });
    lm.rainInside = await render('rain-inside-hall', 'ambient', 'rain', 8, { level: 0.6, outdoor: 0.21, lp: 1000, roof: 1 });
    lm.rainWindow = await render('rain-inside-at-the-window', 'ambient', 'rain', 8, { level: 0.6, outdoor: 0.23, lp: 1000, roof: 1, glass: 0.7 });
    lm.rainJetty = await render('rain-on-the-jetty', 'ambient', 'rain', 8, { level: 0.6, outdoor: 1, boards: 1, water: 1 });
    lm.breeze = await render('wind-breeze-in-the-trees', 'ambient', 'wind', 10, { wind: 0.3, foliage: 0.9 });
    lm.storm = await render('wind-storm', 'ambient', 'wind', 12, { wind: 1, foliage: 0.9 });
    lm.stormInside = await render('wind-storm-inside', 'ambient', 'wind', 12, { wind: 1, outdoor: 0.21, lp: 1000, inside: 1, glass: 0.6 });
    lm.thunderNear = await render('thunder-near-600m', 'ambient', 'thunder', 14, { distance: 600 });
    lm.thunderFar = await render('thunder-far-4km', 'ambient', 'thunder', 18, { distance: 4000 });
    lm.fire = await render('fire', 'ambient', 'fire', 8, { gain: 1 });
    lm.firebowl = await render('fire-bowl', 'ambient', 'firebowl', 8, { gain: 1 });
    lm.clock = await render('clock', 'ambient', 'clock', 6, { gain: 1 });
    lm.cricket = await render('cricket', 'ambient', 'cricket', 6, { gain: 1, voice: 'cricket-b' });
    console.log('LAYERS ' + JSON.stringify(Object.fromEntries(Object.entries(lm).map(([k, v]) => [k, { rms: v.rms, peak: v.peak, centroid: v.centroid, peakHz: v.peakHz }]))));
    const lbad = Object.entries(lm).filter(([, v]) => v.nan || v.rms < 2e-4 || v.peak >= 0.95).map(([k, v]) => `${k}: rms ${v.rms} peak ${v.peak} nan ${v.nan}`);
    check('every layer renders (no silence, no clipping, no NaN)', !lbad.length, lbad.length ? lbad : Object.keys(lm).length);
    check('rain inside is quieter and darker than outside, louder at the window', lm.rainInside.rms < lm.rainOutside.rms * 0.5 && lm.rainInside.centroid < lm.rainOutside.centroid * 0.6 && lm.rainWindow.rms > lm.rainInside.rms, { outside: lm.rainOutside, inside: lm.rainInside, window: lm.rainWindow });
    check('drizzle < rain < storm', lm.rainDrizzle.rms < lm.rainOutside.rms && lm.rainOutside.rms < lm.rainStorm.rms, [lm.rainDrizzle.rms, lm.rainOutside.rms, lm.rainStorm.rms]);
    check('a storm is far louder than a breeze; far thunder deeper than near thunder', lm.storm.rms > lm.breeze.rms * 3 && lm.thunderFar.centroid < lm.thunderNear.centroid, { breeze: lm.breeze.rms, storm: lm.storm.rms, near: lm.thunderNear.centroid, far: lm.thunderFar.centroid });
    check('the cricket chirps near 4.5 kHz', lm.cricket.peakHz > 4000 && lm.cricket.peakHz < 5600, lm.cricket.peakHz);
    console.log('WAV files in ' + soundDir);
  }

  // ================================================================= the single switches ==========================================
  // settings.audio.sounds: each switch silences its sound and nothing else, all on by default, the old switches of 0.6
  // (audio.fire, rain, clock, wind: false in many settings files) are not read, a sound switched off fades at once and
  // its layer stops, and the switches in Settings → Klang work with the keyboard and in both languages
  if (want('switches')) {
    const r = await cc(async (P) => {
      const H = window.__snd, w = window.__app.world, sc = H.sc, audio = H.audio, api = window.__app.ctx.api, p = w.player;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const until = async (fn, ms = 3000) => { const end = performance.now() + ms; while (performance.now() < end) { if (fn()) return true; await sleep(40); } return !!fn(); };
      const J = w.env.garden.outdoor.jetty, jp = J.at(J.len - J.platLen - 0.8, 0), bowl = w.fireBowl, bp = bowl?.position;
      const out = {};
      // the defaults, and the old keys of 0.6 set to false: nothing is switched off by them
      out.defaults = { ...(await api.settings.get()).audio?.sounds };
      await api.settings.set({ audio: { fire: false, rain: false, clock: false, wind: false } });
      await sleep(400);
      out.afterOldKeys = { ...sc.switches };
      // one probe per sound, each in its own place and weather: true while that sound plays (or is planned)
      const cond = (patch) => { H.set({ timeMode: 'fixed', ...patch }); };
      const applied = (name) => { sc.update(); return sc.state.applied[name]; };
      const probes = {
        rain: () => { cond({ weather: 'rain', fixedHour: 12, season: 'spring' }); H.pose(...P.lawn); return (applied('rain')?.field || 0) > 0; },
        wind: () => { cond({ weather: 'storm', fixedHour: 12, season: 'spring' }); H.pose(...P.lawn); return (applied('wind')?.air || 0) > 0; },
        thunder: () => {
          cond({ weather: 'storm', fixedHour: 12, season: 'spring' }); H.pose(...P.lawn);
          const n = sc.strikes.length; w.running = true; sc.lastStrikeAt = -10;
          w.env.lightning = 0; sc.update(); w.env.lightning = 1; sc.update(); w.env.lightning = 0; sc.update(); w.running = false;
          for (const q of sc.pending) q.done = true;   // (not heard: the probe only asks whether it is planned)
          return sc.strikes.length > n;
        },
        fire: () => { cond({ weather: 'clear', fixedHour: 12, season: 'spring' }); H.pose(...P.fire); return (applied('fire')?.gain || 0) > 0; },
        firebowl: () => { cond({ weather: 'clear', fixedHour: 22, season: 'summer' }); bowl.setBurning(true); H.pose(bp.x + 1.4, bp.z + 1.4); const on = (applied('fireBowl')?.gain || 0) > 0; bowl.setBurning(null); return on; },
        clock: () => { cond({ weather: 'clear', fixedHour: 12, season: 'spring' }); H.pose(...P.clockNear); return (applied('clock')?.gain || 0) > 0; },
        birds: () => { cond({ weather: 'clear', fixedHour: 9, season: 'spring' }); H.pose(...P.lawn); sc.update(); const s = sc.simulate(120); return (s.song || 0) + (s.owl || 0) + (s.duck || 0) + (s.moorhen || 0) > 0; },
        frogs: () => { cond({ weather: 'clear', fixedHour: 21, season: 'summer' }); H.pose(...jp); sc.update(); const s = sc.simulate(120); return (s.frog || 0) + (s.treefrog || 0) > 0; },
        crickets: () => { cond({ weather: 'clear', fixedHour: 23, season: 'summer' }); H.pose(...P.lawn); sc.update(); return Object.entries(sc.state.applied).some(([k, v]) => /^cricket\d/.test(k) && v?.gain > 0); },
        water: () => { cond({ weather: 'clear', fixedHour: 12, season: 'spring' }); H.pose(...jp); sc.update(); return (sc.simulate(60).lap || 0) > 0; },
        // (the engine drops a second sound of the same name within 25 ms: the probes come quicker than steps)
        steps: () => { cond({ weather: 'clear', fixedHour: 12, season: 'spring' }); H.pose(...P.lawn); audio.lastSfx.footstep = 0; const n0 = H.sfx.length; const h = audio.footstep({ speed: 2.4 }); return !!h && H.sfx.slice(n0).some((e) => e.name === 'footstep'); },
      };
      const names = Object.keys(probes);
      const all = (sw) => Object.fromEntries(names.map((k) => [k, (sc.setSwitches(sw), probes[k]())]));
      out.allOn = all({});
      out.matrix = {};
      for (const k of names) {
        const res = all({ [k]: false });
        out.matrix[k] = { own: res[k], others: names.filter((o) => o !== k && !res[o]) };
      }
      sc.setSwitches({});
      out.backOn = all({});
      // switched off while it plays: the rain fades at once and its layer stops (no work for a muted sound)
      cond({ weather: 'rain', fixedHour: 12, season: 'spring' }); H.pose(...P.lawn); sc.update();
      await sleep(300); sc.update();
      const rainBefore = sc.state.layers.includes('rain');
      sc.setSwitches({ rain: false });
      let stoppedAfter = null; const t0 = performance.now();
      for (let i = 0; i < 40 && stoppedAfter == null; i++) { await sleep(100); sc.update(); if (!sc.state.layers.includes('rain')) stoppedAfter = Math.round(performance.now() - t0); }
      sc.setSwitches({}); sc.update();
      const rainBack = await until(() => { sc.update(); return sc.state.layers.includes('rain'); });
      out.rainLive = { before: rainBefore, stoppedAfterMs: stoppedAfter, back: rainBack };
      // a bird phrase that sounds when the birds are switched off: it fades at once
      cond({ weather: 'clear', fixedHour: 6.6, season: 'spring' }); H.pose(...P.lawn); sc.seed(77);
      const singing = await until(() => { sc.update(); return sc.state.playing.includes('birds'); }, 8000);
      sc.setSwitches({ birds: false });
      out.birdLive = { singing, afterSwitch: sc.state.playing.includes('birds') };
      sc.setSwitches({}); sc.seed(null);
      // footsteps off: none while walking
      sc.setSwitches({ steps: false });
      H.pose(0, 10.5, Math.PI); const n0 = H.sfx.length; p.keys.add('KeyW'); for (let i = 0; i < 120; i++) p.update(1 / 60); p.keys.clear();
      out.walkSilent = H.sfx.slice(n0).filter((e) => e.name === 'footstep').length;
      sc.setSwitches({});
      // the panel: Settings → Klang, the group of switches, by keyboard, in both languages, stored in audio.sounds
      window.__app.openPanel('settings', { section: 'audio' });
      await until(() => document.querySelectorAll('.settings-panel [data-sound]').length > 0);
      const rows = () => [...document.querySelectorAll('.settings-panel [data-sound]')];
      out.ui = { rows: rows().map((r) => r.dataset.sound), allOn: rows().every((r) => r.toggleEl ? r.toggleEl.classList.contains('on') : r.querySelector('.toggle')?.classList.contains('on')), title: [...document.querySelectorAll('.settings-panel .settings-group')].map((e) => e.textContent) };
      // the switch of the frogs: Tab reaches it (it is focusable), Enter switches it off, Space on again
      const frogToggle = () => rows().find((r) => r.dataset.sound === 'frogs')?.querySelector('.toggle');
      const tg = frogToggle();
      out.ui.focusable = tg?.tabIndex === 0;
      tg?.focus();
      tg?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      out.ui.stored = false;
      for (let i = 0; i < 60 && !out.ui.stored; i++) { out.ui.stored = (await api.settings.get()).audio?.sounds?.frogs === false; if (!out.ui.stored) await sleep(50); }
      out.ui.engine = await until(() => sc.switches.frogs === false);
      out.ui.shownOff = await until(() => frogToggle()?.getAttribute('aria-checked') === 'false');
      frogToggle()?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      out.ui.backOn = await until(() => sc.switches.frogs === true);
      window.__app.ctx.i18n.setLanguage('en');
      await sleep(400);
      out.ui.en = { title: [...document.querySelectorAll('.settings-panel .settings-group')].map((e) => e.textContent), labels: rows().map((r) => r.querySelector('label')?.childNodes[0]?.textContent) };
      window.__app.ctx.i18n.setLanguage('de');
      await sleep(300);
      out.ui.de = rows().map((r) => r.querySelector('label')?.childNodes[0]?.textContent);
      return out;
    }, P);
    await shot('settings-klang-switches');
    await cc(() => window.__app.closeAllPanels());
    const allTrue = (o) => !!o && Object.values(o).every((v) => v === true);
    check('the single sounds are all on by default (settings.audio.sounds)', allTrue(r.defaults) && Object.keys(r.defaults).length === 11, r.defaults);
    check('the old switches of 0.6 (audio.fire, rain, clock, wind false) switch nothing off', allTrue(r.afterOldKeys) && allTrue(r.allOn), { switches: r.afterOldKeys, sounds: r.allOn });
    const wrong = Object.entries(r.matrix).filter(([, m]) => m.own || m.others.length).map(([k, m]) => `${k}: own ${m.own}, also off: ${m.others.join(',') || 'none'}`);
    check('each switch silences exactly its own sound and nothing else', !wrong.length, wrong.length ? wrong : Object.keys(r.matrix));
    check('switched on again, every sound plays again when the world calls for it', allTrue(r.backOn), r.backOn);
    check('rain switched off while it rains: it fades at once and its layer stops within a second, and comes back', r.rainLive.before && r.rainLive.stoppedAfterMs != null && r.rainLive.stoppedAfterMs < 1600 && r.rainLive.back, r.rainLive);
    check('a bird that sings when the birds are switched off falls silent at once', r.birdLive.singing && !r.birdLive.afterSwitch, r.birdLive);
    check('footsteps switched off: walking makes no step', r.walkSilent === 0, r.walkSilent);
    check('Settings → Klang: eleven switches under "Einzelne Geräusche", all on', r.ui.rows.length === 11 && r.ui.allOn && r.ui.title.includes('Einzelne Geräusche'), { rows: r.ui.rows, titles: r.ui.title });
    check('a switch works with the keyboard and is stored in audio.sounds', r.ui.focusable && r.ui.stored && r.ui.engine && r.ui.shownOff && r.ui.backOn, { focusable: r.ui.focusable, stored: r.ui.stored, engine: r.ui.engine, shownOff: r.ui.shownOff, backOn: r.ui.backOn });
    check('the switches speak both languages', r.ui.en.title.includes('Single sounds') && r.ui.en.labels.includes('Frogs') && r.ui.de.includes('Frösche'), { en: r.ui.en, de: r.ui.de });
  }

  // ================================================================= performance ==================================================
  if (want('perf')) {
    const r = await cc(async () => {
      const H = window.__snd, sc = H.sc;
      const time = (n, fn) => { const ts = []; for (let i = 0; i < n; i++) { const t = performance.now(); fn(); ts.push(performance.now() - t); } ts.sort((a, b) => a - b); return { mean: +(ts.reduce((a, b) => a + b, 0) / n).toFixed(3), p95: +ts[Math.floor(n * 0.95)].toFixed(3), max: +ts[n - 1].toFixed(3) }; };
      H.set({ weather: 'rain', fixedHour: 9, season: 'spring' }); H.pose(6, 16); sc.update();
      const outside = time(150, () => sc.update());
      H.pose(0, -1); sc.update();
      const inside = time(150, () => sc.update());
      // a footstep while walking: taken from the steps made ahead (warm), or made on the spot (the first of its kind)
      H.pose(6, 16); for (let i = 0; i < 6; i++) { sc.update(); await new Promise((res) => setTimeout(res, 150)); }
      // steps half a second apart, as when walking: the steps made ahead are replaced in the idle time between them
      const ws = [];
      for (let i = 0; i < 16; i++) { const t = performance.now(); H.audio.footstep({ speed: 2.4 }); ws.push(performance.now() - t); await new Promise((res) => setTimeout(res, 450)); }
      ws.sort((a, b) => a - b);
      const warm = { median: +ws[Math.floor(ws.length / 2)].toFixed(3), mean: +(ws.reduce((a, b) => a + b, 0) / ws.length).toFixed(3), p95: +ws[Math.floor(ws.length * 0.95)].toFixed(3), max: +ws[ws.length - 1].toFixed(3) };
      const cold = time(20, () => H.audio.footstep({ speed: 2.4, seed: Math.random() }));
      H.reset();
      return { updateOutside: outside, updateInside: inside, stepWarm: warm, stepCold: cold, layers: sc.state.layers, worker: sc.state.worker };
    });
    console.log('PERF ' + JSON.stringify(r));
    check('the soundscape update stays light (main thread, every 120 ms)', r.updateOutside.p95 < 1.5 && r.updateInside.p95 < 1.5, { outside: r.updateOutside, inside: r.updateInside });
    // (the median: on a busy machine a single garbage collection can land in any one step)
    check('a footstep while walking costs little (made ahead in the sound worker)', r.stepWarm.median < 1.0, { warm: r.stepWarm, madeOnTheSpot: r.stepCold });
    check('the textures and the steps are made in the sound worker', r.worker && r.worker.done >= 8 && !r.worker.failed, r.worker);
    // a busy evening on the jetty: rain on the water, wind, frogs, crickets, the lapping; the world drawn. Frame times with
    // the soundscape and without it, in turns (on a busy machine the numbers are rough); long tasks
    const load = await cc(async () => {
      const H = window.__snd, w = window.__app.world, sc = H.sc, audio = H.audio, p = w.player;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      H.set({ weather: 'rain', fixedHour: 21.2, season: 'summer' });
      const J = w.env.garden.outdoor.jetty, jp = J.at(J.len - J.platLen - 0.8, 0);
      H.pose(jp[0], jp[1], Math.atan2(J.dir[0], J.dir[1]) + Math.PI);
      const long = []; let obs = null;
      try { obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push(Math.round(e.duration)); }); obs.observe({ entryTypes: ['longtask'] }); } catch (e) { /* */ }
      const stats0 = audio.ctx.playoutStats ? { ...audio.ctx.playoutStats.toJSON?.() } : null;
      const n0 = sc.log.length;
      w.start();
      const frames = async (ms) => { const ts = []; let last = performance.now(); const end = last + ms; while (performance.now() < end) { await new Promise((res) => requestAnimationFrame(res)); const now = performance.now(); ts.push(now - last); last = now; } ts.sort((a, b) => a - b); return { n: ts.length, mean: +(ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(2), p95: +ts[Math.floor(ts.length * 0.95)].toFixed(2), max: +ts[ts.length - 1].toFixed(2) }; };
      // the soundscape on and off in turns, the rest of the audio (the music) running in both; a warm-up first
      const on = [], off = [];
      await frames(2500);
      for (let round = 0; round < 2; round++) {
        sc.attach(null); await sleep(300); off.push(await frames(5000));
        sc.attach(w); sc.update(); await sleep(300); on.push(await frames(5000));
      }
      w.stop(); obs?.disconnect();
      const stats1 = audio.ctx.playoutStats ? { ...audio.ctx.playoutStats.toJSON?.() } : null;
      const events = sc.log.slice(n0).reduce((m, e) => { m[e.type] = (m[e.type] || 0) + 1; return m; }, {});
      H.reset();
      return { on, off, longTasks: long, events, layers: sc.state.layers, playout: stats1 ? { before: stats0, after: stats1 } : 'n/a' };
    });
    console.log('LOAD ' + JSON.stringify(load));
    const m = (a, k) => +(a.reduce((x, y) => x + y[k], 0) / a.length).toFixed(2);
    check('a busy evening on the jetty: frame times with the soundscape as without it (within noise)', m(load.on, 'mean') < m(load.off, 'mean') * 1.1 + 0.5, { withSoundscape: { mean: m(load.on, 'mean'), p95: m(load.on, 'p95') }, without: { mean: m(load.off, 'mean'), p95: m(load.off, 'p95') }, longTasks: load.longTasks.length, layers: load.layers });
  }

  await cc(() => window.__snd.reset());
  console.log(`sound-check: ${passes} passed, ${failures} failed`);
  if (failures) process.exitCode = 1;
};
