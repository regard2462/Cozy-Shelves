// The sky, the time and the weather (0.7; app/src/world/sky-state.js, celestial.js, sky.js, environment.js):
//   settings  the time options (real, day and night in turn, day only, night only, fixed, golden hour) with the length of
//             a day, the weather (clear, overcast, rain, thunderstorm, snow, changing, like outside) with fog and wind
//             where they fit (greyed out with a reason where not), what the changing weather may bring (snow only in
//             winter), every text in German and English at once
//   migrate   an old settings file ({ weather: 'fog', timeMode: 'cycle' }, seeded by the caller as settings.json in
//             COZYSHELVES_USERDATA) loads: the grey fog of before, the cycle with its default length (SKIP without it)
//   time      each time mode gives the right hours: day only never reaches night, night only never reaches noon, the
//             twilight between two days stays a blue hour without a jump of the sun, the length of a day works, the sky
//             time (stars, moon) never jumps
//   weather   combinations (rain and fog, snow and fog, a mist on a clear day, drizzle in fog), incompatible ones rejected,
//             the old words for old code, the changing weather follows the allowed list (snow only in winter), phases
//             of 10 to 30 minutes, blends without jumps, the real weather's codes
//   sky       night: stars in a clear sky (bright points counted), hidden when overcast, also through the glass front;
//             the Milky Way; the moon's phase of the date and its lit part; the garden readable at night
//   glass     the lamps in the glass are faint (the old glass emulated for the comparison)
//   shadows   the shadow of the trees on the lawn while the sun moves (day cycle of 10 minutes, 60 simulated seconds at
//             60 frames a second): the change per frame small and steady, no jumps (works on an older build as well:
//             APP_DIR=<copy of the old source> for the numbers before)
//   live      (only with SK_NET=1: it asks Open-Meteo) like outside: a place found by name in the settings, its weather
//             fetched and shown, and without a connection the last weather stays
//   perf      GPU time at the size of PERF_EMU (2560x1440) with the sun moving against a still sun, the longest frame
//   programs  no shader compiled after the warm-up (night, stars, weathers, time modes)
//   shots     night sky from the terrace and the jetty (new and full moon), the Milky Way, rain and fog, snow and fog, a
//             thunderstorm by day, the window of the book room at night in the rain, deer and fox at night, the settings
//             (SK_SHOTS=terrace,settings takes only the shots whose names begin so)
// SK_PARTS=settings,migrate,time,weather,sky,glass,shadows,live,perf,programs,shots (default: all). Prints PASS/FAIL/SKIP
// lines and one summary line. Muted and hidden like every harness script.
//   node build/screenshot.js sky-check
const fs = require('fs');
const path = require('path');

module.exports = async ({ app, page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || 'sky';
  const only = (process.env.SK_PARTS || '').split(',').filter(Boolean);
  const want = (part) => !only.length || only.includes(part);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1600, 900); });
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  // the settings as they came from the file, before anything changes them (and the file itself)
  const initial = await page.evaluate(() => JSON.parse(JSON.stringify(window.__app.state.settings)));
  let initialDisk = null;
  try { await sleep(3000); initialDisk = JSON.parse(fs.readFileSync(path.join(process.env.COZYSHELVES_USERDATA || '', 'settings.json'), 'utf8')); } catch {}
  const initialWorld = await page.evaluate(() => { const w = window.__app.world; return { state: w.weatherState?.() || null, hour: w.currentHour(), mode: w.settings.timeMode }; });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(1500);
  await page.evaluate(() => { window.__app.world.stop(); window.__app.closeAllPanels(); document.querySelector('#hud')?.style.setProperty('opacity', '0'); });
  let failures = 0, passes = 0, skipped = 0;
  const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); if (ok) passes++; else failures++; };
  const skip = (name, why, info) => { console.log(`SKIP ${name} (${why})${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); skipped++; };
  const newBuild = await page.evaluate(() => !!window.__app.world.sky);

  // ---- helpers in the page ---------------------------------------------------------------------------------------
  await page.evaluate(() => {
    const w = window.__app.world;
    const H = window.__sk = {};
    H.set = (patch) => w.applySettings({ ...w.settings, ...patch, sky: { ...(w.settings.sky || {}), ...(patch.sky || {}) }, graphics: { ...w.settings.graphics, quality: 'high', bloom: true, shadows: true, ssao: true, godrays: true, resolutionScale: 1, fov: 72, ...(patch.graphics || {}) } });
    H.pose = (x, z, yaw, pitch = 0) => { const p = w.player; if (w.actions.seatedId) w.actions.leaveSeat?.(); p.transition = null; p.setPose(x, z, yaw, pitch); for (let i = 0; i < 40; i++) w.updateDoor(0.05); };
    H.frames = async (n = 12) => { for (let i = 0; i < n; i++) { w.frame(); await new Promise((r) => setTimeout(r, 16)); } };
    // the picture right after a frame: mean brightness (0 … 255) of a region (fractions of the canvas), the number of pixels
    // brighter than `bright` and than the region's mean by `over`, the brightest one
    H.region = (rect, { bright = 200, over = 40 } = {}) => {
      const gl = w.renderer.getContext(); w.frame();
      const cw = gl.drawingBufferWidth, ch = gl.drawingBufferHeight;
      const x = Math.round(rect[0] * cw), y = Math.round((1 - rect[1] - rect[3]) * ch), rw = Math.round(rect[2] * cw), rh = Math.round(rect[3] * ch);
      const buf = new Uint8Array(rw * rh * 4); gl.readPixels(x, y, rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let s = 0, max = 0; const lum = new Float32Array(rw * rh);
      for (let i = 0, k = 0; i < buf.length; i += 4, k++) { const l = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]; lum[k] = l; s += l; if (l > max) max = l; }
      const mean = s / lum.length;
      let n = 0, pts = 0;
      for (let k = 0; k < lum.length; k++) if (lum[k] > bright) n++;
      // points: a pixel brighter than its eight neighbours and by `over` than the ring two pixels away (a star, not a
      // cloud's edge or the bright sky)
      for (let yy = 2; yy < rh - 2; yy++) for (let xx = 2; xx < rw - 2; xx++) {
        const k = yy * rw + xx, l = lum[k];
        if (l < 20) continue;
        let peak = true;
        for (let dy = -1; dy <= 1 && peak; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && lum[k + dy * rw + dx] > l) { peak = false; break; }
        if (!peak) continue;
        let ring = 0; for (let d = -2; d <= 2; d++) ring += lum[k - 2 * rw + d] + lum[k + 2 * rw + d] + lum[k + d * rw - 2] + lum[k + d * rw + 2];
        if (l - ring / 20 > over + 0.25 * ring / 20) pts++;
      }
      return { mean: +mean.toFixed(2), bright: n, points: pts, max: Math.round(max), px: lum.length };
    };
  });
  const H = (fn, arg) => page.evaluate(fn, arg);

  // ================================================================= settings =================================================
  if (want('settings') && newBuild) {
    const ui = await H(async () => {
      const app = window.__app, w = app.world, wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const rows = () => [...document.querySelectorAll('.settings-content .setting')];
      const row = (label) => rows().find((r) => (r.querySelector('label')?.childNodes[0]?.textContent || '').trim() === label);
      const segBtns = (label) => [...(row(label)?.querySelectorAll('.seg button') || [])];
      const click = async (label, text) => { const b = segBtns(label).find((x) => x.textContent.trim() === text); b?.click(); await wait(450); return !!b; };
      const out = {};
      await app.ctx.api.settings.set({ language: 'de', timeMode: 'real', weather: 'clear', sky: { mode: 'fixed', base: 'clear', fog: false, wind: false } });
      await wait(400);
      app.openPanel('settings', { section: 'light' }); await wait(600);
      out.time = segBtns('Tageszeit').map((b) => b.textContent.trim());
      out.weather = segBtns('Wetter').map((b) => b.textContent.trim());
      // the day modes show the length of a day
      out.lengths = {};
      for (const [mode, label] of [['Tag-Nacht-Wechsel', 'Dauer eines Tages'], ['Nur Tag', 'Dauer eines Tages'], ['Nur Nacht', 'Dauer einer Nacht']]) {
        await click('Tageszeit', mode);
        out.lengths[mode] = segBtns(label).map((b) => b.textContent.trim());
      }
      await click('Dauer einer Nacht', '10 Min.');
      out.nightStored = { timeMode: app.state.settings.timeMode, minutes: app.state.settings.sky?.dayMinutes };
      out.nightWorld = { hour: +w.currentHour().toFixed(2) };
      await click('Tageszeit', 'Feste Uhrzeit');
      out.fixedSlider = !!row('Uhrzeit')?.querySelector('input.range');
      await click('Tageszeit', 'Echte Uhrzeit');
      // the base weathers with fog and wind
      const toggle = (label) => row(label)?.querySelector('.toggle');
      const state = () => ({ ws: w.weatherState(), weather: app.state.settings.weather, sky: { ...app.state.settings.sky } });
      await click('Wetter', 'Regen');
      toggle('Nebel')?.click(); await wait(500);
      out.rainFog = state();
      out.windWithFog = { disabled: row('Wind')?.classList.contains('setting-off'), hint: row('Wind')?.querySelector('.setting-hint')?.textContent };
      await click('Wetter', 'Gewitter');
      out.storm = { ...state(), fogOff: row('Nebel')?.classList.contains('setting-off'), fogHint: row('Nebel')?.querySelector('.setting-hint')?.textContent, windOff: row('Wind')?.classList.contains('setting-off') };
      // a disabled switch does nothing, also with the keyboard
      const tf = toggle('Nebel'); tf?.click(); tf?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(400);
      out.stormAfterClick = state();
      await click('Wetter', 'Klar');
      toggle('Nebel')?.click(); await wait(500);
      out.mist = state();
      toggle('Nebel')?.click(); await wait(400);
      toggle('Wind')?.click(); await wait(500);
      out.windy = state();
      toggle('Wind')?.click(); await wait(300);
      await click('Wetter', 'Bewölkt');
      toggle('Nebel')?.click(); await wait(500);
      out.greyFog = state();
      // the changing weather: what it may bring; snow only in winter
      await app.ctx.api.settings.set({ season: 'summer' }); await wait(300);
      await click('Wetter', 'Wechselnd');
      out.changing = { mode: app.state.settings.sky?.mode, rows: rows().map((r) => (r.querySelector('label')?.childNodes[0]?.textContent || '').trim()), snowOff: row('Schnee')?.classList.contains('setting-off'), snowHint: row('Schnee')?.querySelector('.setting-hint')?.textContent };
      // (waits until the change arrived: a busy machine may take longer than a fixed pause)
      const until = async (fn, ms = 4000) => { for (let t = 0; t < ms && !fn(); t += 100) await wait(100); };
      toggle('Gewitter')?.click(); await until(() => app.state.settings.sky?.allow?.storm === false);
      out.allow = { ...app.state.settings.sky?.allow };
      toggle('Gewitter')?.click(); await until(() => app.state.settings.sky?.allow?.storm === true);
      await app.ctx.api.settings.set({ season: 'winter' }); await until(() => app.state.settings.season === 'winter');
      app.closeAllPanels(); app.openPanel('settings', { section: 'light' });
      await until(() => row('Schnee') && !row('Schnee').classList.contains('setting-off'));
      out.winterSnowOff = row('Schnee')?.classList.contains('setting-off');
      // like outside: a place, nothing fetched without one
      await click('Wetter', 'Wie draußen');
      out.live = { mode: app.state.settings.sky?.mode, place: !!row('Ort'), input: !!document.querySelector('.sky-place-input'), status: document.querySelector('.sky-live-status')?.textContent || '' };
      // English at once
      await app.ctx.api.settings.set({ language: 'en' }); await wait(700);
      out.en = { time: segBtns('Time of day').map((b) => b.textContent.trim()), weather: segBtns('Weather').map((b) => b.textContent.trim()), live: document.querySelector('.sky-live-status')?.textContent || '' };
      await app.ctx.api.settings.set({ language: 'de', season: 'auto', weather: 'clear', sky: { mode: 'fixed', base: 'clear', fog: false, wind: false } }); await wait(400);
      app.closeAllPanels();
      return out;
    });
    check('the time of day offers the six choices', JSON.stringify(ui.time) === JSON.stringify(['Echte Uhrzeit', 'Tag-Nacht-Wechsel', 'Nur Tag', 'Nur Nacht', 'Feste Uhrzeit', 'Goldene Stunde']), ui.time);
    const L = ['10 Min.', '20 Min.', '30 Min.', '1 Std.', '2 Std.'];
    check('the day modes show the length of a day (10, 20, 30 minutes, 1 and 2 hours), the fixed time its hour', Object.values(ui.lengths).every((l) => JSON.stringify(l) === JSON.stringify(L)) && ui.fixedSlider, ui.lengths);
    check('a chosen length is stored and applies at once', ui.nightStored.timeMode === 'night' && ui.nightStored.minutes === 10 && (ui.nightWorld.hour >= 20.5 || ui.nightWorld.hour <= 6.5), { ...ui.nightStored, ...ui.nightWorld });
    check('the weather offers clear, overcast, rain, thunderstorm, snow, changing and like outside', JSON.stringify(ui.weather) === JSON.stringify(['Klar', 'Bewölkt', 'Regen', 'Gewitter', 'Schnee', 'Wechselnd', 'Wie draußen']), ui.weather);
    check('rain with fog: drizzle in fog, wind greyed out with its reason', ui.rainFog.ws.rain > 0.2 && ui.rainFog.ws.rain < 0.5 && ui.rainFog.ws.fog > 0.6 && ui.rainFog.weather === 'rain' && ui.windWithFog.disabled && /Nebel/.test(ui.windWithFog.hint || ''), { rainFog: ui.rainFog, wind: ui.windWithFog });
    check('thunderstorm: fog and wind greyed out with a reason, a click does nothing', ui.storm.fogOff && ui.storm.windOff && /Gewitter/.test(ui.storm.fogHint || '') && ui.storm.ws.fog === 0 && ui.storm.sky.fog === false && ui.stormAfterClick.sky.fog === false && ui.stormAfterClick.ws.fog === 0, { storm: ui.storm, after: ui.stormAfterClick.sky });
    check('clear with fog is a morning mist (the old word "fog"), wind makes a windy clear day', ui.mist.ws.fog > 0.4 && ui.mist.ws.fog < 0.8 && ui.mist.ws.overcast < 0.3 && ui.mist.weather === 'fog' && ui.windy.ws.wind > 0.6 && ui.windy.weather === 'clear', { mist: ui.mist, windy: ui.windy.ws });
    check('overcast with fog is the grey fog of before', ui.greyFog.ws.fog > 0.95 && ui.greyFog.ws.overcast > 0.8 && ui.greyFog.weather === 'fog', ui.greyFog);
    check('the changing weather lists what it may bring; snow greyed out outside winter, offered in winter', ui.changing.mode === 'changing' && ['Regen', 'Gewitter', 'Nebel', 'Schnee'].every((k) => ui.changing.rows.includes(k)) && ui.changing.snowOff && ui.winterSnowOff === false && ui.allow.storm === false, { ...ui.changing, allow: ui.allow, winterSnowOff: ui.winterSnowOff });
    check('like outside asks for a place and fetches nothing without one', ui.live.mode === 'live' && ui.live.place && ui.live.input && /kein Ort/i.test(ui.live.status), ui.live);
    check('the texts switch to English at once', JSON.stringify(ui.en.time) === JSON.stringify(['Real time', 'Day–night cycle', 'Day only', 'Night only', 'Fixed time', 'Golden hour']) && ui.en.weather.includes('Changing') && ui.en.weather.includes('Like outside') && /No place/.test(ui.en.live), ui.en);
  }

  // ================================================================= migrate ==================================================
  if (want('migrate')) {
    const file = path.join(process.env.COZYSHELVES_USERDATA || '', 'settings.json');
    if (initial.sky?.schema && initial.weather === 'fog' && initial.timeMode === 'cycle') {
      check('an old settings file with weather "fog" and the day cycle loads: the grey fog of before, overcast with dense fog', initial.sky.base === 'overcast' && initial.sky.fog === true && initialWorld.state && initialWorld.state.fog > 0.95 && initialWorld.state.overcast > 0.8 && initialWorld.state.name === 'fog', { sky: initial.sky, world: initialWorld.state });
      check('… and the day cycle runs with the default length of 30 minutes', initialWorld.mode === 'cycle' && initial.sky.dayMinutes === 30, { mode: initialWorld.mode, minutes: initial.sky.dayMinutes });
      const disk = initialDisk;
      check('… and the file keeps the old word for old code (written back with the new parts)', disk?.weather === 'fog' && disk?.sky?.base === 'overcast' && disk?.sky?.fog === true && disk?.sky?.schema === 1, { weather: disk?.weather, sky: disk?.sky, file });
    } else skip('an old settings file loads', 'no old settings.json was seeded (weather "fog", timeMode "cycle")', { weather: initial.weather, timeMode: initial.timeMode });
  }

  // ================================================================= time =====================================================
  if (want('time') && newBuild) {
    const t = await H(() => {
      const w = window.__app.world, S = w.sky, Hs = S.constructor.helpers;
      const save = JSON.parse(JSON.stringify(w.settings));
      const run = (patch, seconds, step = 0.5) => {
        w.settings = { ...save, ...patch, sky: { ...(save.sky || {}), ...(patch.sky || {}) } };
        S.clockKey = null; S.tick(0);
        const out = [];
        for (let t = 0; t <= seconds; t += step) {
          if (t > 0) S.tick(step);
          const sun = S.sun ? S.sun.clone() : Hs.sunPosition(S.hour);
          out.push({ t, hour: S.hour, sky: S.skyHour, y: sun.y, sun });
        }
        return out;
      };
      const elev = (y) => Math.asin(y) * 180 / Math.PI;
      const dayF = (y) => { const x = Math.min(1, Math.max(0, (y + 0.08) / 0.26)); return x * x * (3 - 2 * x); };
      const res = {};
      // day only, 10 minutes: two loops
      let r = run({ timeMode: 'day', sky: { dayMinutes: 10 } }, 1250);
      // the sun's step per half second: while it is up (it moves as on any day) and under the horizon (the twilight)
      let maxStep = 0, maxLow = 0;
      for (let i = 1; i < r.length; i++) { const a = r[i].sun.angleTo(r[i - 1].sun) * 180 / Math.PI; if (r[i].y > 0.01 && r[i - 1].y > 0.01) maxStep = Math.max(maxStep, a); else maxLow = Math.max(maxLow, a); }
      const noon = r.filter((p, i) => i && r[i - 1].hour < 13 && p.hour >= 13).map((p) => p.t);
      res.day = { minElev: +Math.min(...r.map((p) => elev(p.y))).toFixed(2), minDay: +Math.min(...r.map((p) => dayF(p.y))).toFixed(3), maxElev: +Math.max(...r.map((p) => elev(p.y))).toFixed(1), maxStepDeg: +maxStep.toFixed(3), maxTwilightStepDeg: +maxLow.toFixed(3), noons: noon, nightHours: r.filter((p) => p.hour > 21.5 || p.hour < 5.5).length };
      // night only, 10 minutes: two loops
      r = run({ timeMode: 'night', sky: { dayMinutes: 10 } }, 1250);
      let skyJump = 0; for (let i = 1; i < r.length; i++) skyJump = Math.max(skyJump, Math.abs(r[i].sky - r[i - 1].sky));
      res.night = { maxElev: +Math.max(...r.map((p) => elev(p.y))).toFixed(2), maxDay: +Math.max(...r.map((p) => dayF(p.y))).toFixed(3), noonHours: r.filter((p) => p.hour > 9 && p.hour < 18).length, maxSkyStep: +skyJump.toFixed(3), skyRange: +(r[r.length - 1].sky - r[0].sky).toFixed(2), midnights: r.filter((p, i) => i && Math.abs(p.hour - r[i - 1].hour) > 12 && r[i - 1].hour > 23).length };
      // day and night in turn: one day in 10 minutes, and in 2 hours
      r = run({ timeMode: 'cycle', sky: { dayMinutes: 10 } }, 600);
      let hourStep = 0; for (let i = 1; i < r.length; i++) hourStep = Math.max(hourStep, Math.abs(r[i].sky - r[i - 1].sky));
      res.cycle10 = { advanced: +(r[r.length - 1].sky - r[0].sky).toFixed(3), maxStep: +hourStep.toFixed(4) };
      r = run({ timeMode: 'cycle', sky: { dayMinutes: 120 } }, 600);
      res.cycle120 = { advanced: +(r[r.length - 1].sky - r[0].sky).toFixed(3) };
      // a new length on the way: no jump
      w.settings = { ...save, timeMode: 'cycle', sky: { ...(save.sky || {}), dayMinutes: 30 } }; S.tick(1); const h0 = S.hour;
      w.settings = { ...save, timeMode: 'cycle', sky: { ...(save.sky || {}), dayMinutes: 10 } }; S.tick(0.5); const h1 = S.hour;
      res.switch = { before: +h0.toFixed(3), after: +h1.toFixed(3) };
      // real and fixed
      w.settings = { ...save, timeMode: 'real' }; S.tick(0.1);
      const d = new Date(); res.real = { world: +S.hour.toFixed(3), clock: +(d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600).toFixed(3) };
      w.settings = { ...save, timeMode: 'fixed', fixedHour: 15.5 }; S.tick(100); res.fixed = S.hour;
      w.settings = { ...save, timeMode: 'golden' }; S.tick(100); res.golden = S.hour;
      w.settings = save; S.clockKey = null; S.tick(0);
      return res;
    });
    check('day only: the sun goes from morning to evening, never into the night (the twilight between two days stays above -3°)', t.day.minElev > -3 && t.day.minDay > 0.03 && t.day.nightHours < 10 && t.day.maxElev > 50, t.day);
    check('day only: one day takes the chosen length (10 minutes), the sun never jumps (up: as on any day; the twilight under the horizon: no jump either)', t.day.noons.length >= 2 && Math.abs(t.day.noons[1] - t.day.noons[0] - 600) < 2 && t.day.maxStepDeg < 0.4 && t.day.maxTwilightStepDeg < 3, t.day);
    check('night only: never noon, the sun stays below the horizon, from dusk to dawn', t.night.maxElev < -1.5 && t.night.noonHours === 0 && t.night.maxDay < 0.12, t.night);
    check('night only: the stars and the moon turn on without a jump also from one night to the next', t.night.maxSkyStep < 0.06 && t.night.skyRange > 15, t.night);
    check('day and night in turn: a day of 10 minutes passes in 10 minutes, one of 2 hours in 2 hours, smoothly', Math.abs(t.cycle10.advanced - 24) < 0.05 && Math.abs(t.cycle120.advanced - 2) < 0.02 && t.cycle10.maxStep < 0.03, { c10: t.cycle10, c120: t.cycle120 });
    check('a new length of the day goes on from the hour shown', Math.abs(t.switch.after - t.switch.before) < 0.05, t.switch);
    check('the real time follows the clock, the fixed hour and the golden hour stand still', Math.abs(t.real.world - t.real.clock) < 0.02 && t.fixed === 15.5 && Math.abs(t.golden - 19.9) < 0.01, { real: t.real, fixed: t.fixed, golden: t.golden });
  }

  // ================================================================= weather ==================================================
  if (want('weather') && newBuild) {
    const r = await H(async () => {
      const w = window.__app.world, S = w.sky, Hs = S.constructor.helpers, sk = window.__sk;
      const out = {};
      const st = () => { const s = w.weatherState(); return { name: s.name, base: s.base, fog: +s.fog.toFixed(2), rain: +s.rain.toFixed(2), snow: +s.snow.toFixed(2), thunder: +s.thunder.toFixed(2), wind: +s.wind.toFixed(2), overcast: +s.overcast.toFixed(2) }; };
      const fixed = (base, fog = false, wind = false) => { sk.set({ weather: Hs.legacyWeather(base, fog), sky: { mode: 'fixed', base, fog, wind } }); return st(); };
      out.combos = { rainFog: fixed('rain', true), snowFog: fixed('snow', true), overcastFog: fixed('overcast', true), mist: fixed('clear', true), rain: fixed('rain'), snowWind: fixed('snow', false, true) };
      // what does not fit is not taken (also when a settings file says so)
      sk.set({ weather: 'storm', sky: { mode: 'fixed', base: 'storm', fog: true, wind: false } }); out.stormFog = st();
      sk.set({ weather: 'fog', sky: { mode: 'fixed', base: 'overcast', fog: true, wind: true } }); out.fogWind = st();
      out.fits = { storm: Hs.fits('storm'), overcastFog: Hs.fits('overcast', { fog: true }), clear: Hs.fits('clear') };
      // the old words: a settings file with only `weather` (and the tests) still work
      out.legacy = {};
      for (const word of ['clear', 'overcast', 'rain', 'storm', 'snow', 'fog']) { w.applySettings({ ...w.settings, weather: word, sky: { mode: 'fixed' } }); out.legacy[word] = st(); }
      // the changing weather: 4 days with each allowed list
      const phases = (allow, winter) => S.simulate(96 * 3600, { allow, winter, seed: 11 });
      const all = { rain: true, storm: true, fog: true, snow: true };
      const runs = { all: phases(all, false), winter: phases(all, true), dry: phases({ rain: false, storm: false, fog: false, snow: false }, true), noRain: phases({ rain: false, storm: true, fog: false, snow: false }, false) };
      out.runs = {};
      for (const [k, list] of Object.entries(runs)) {
        const durs = list.slice(1).map((p, i) => p.t - list[i].t);
        const kinds = {}; for (const p of list) kinds[p.phase] = (kinds[p.phase] || 0) + 1;
        out.runs[k] = { n: list.length, kinds, minDur: Math.min(...durs), maxDur: Math.max(...durs) };
      }
      // the phases follow on each other as weather does: no storm straight out of a clear sky, no snow after rain in summer
      const pairs = new Set(); for (let i = 1; i < runs.all.length; i++) pairs.add(runs.all[i - 1].phase + '>' + runs.all[i].phase);
      out.pairs = [...pairs];
      // a phase blends in: the parts move a little every frame (60 frames a second), never jump
      sk.set({ weather: 'clear', sky: { mode: 'changing', allow: all } });
      S.force('clear'); for (let i = 0; i < 600; i++) S.frame(1 / 60);
      S.force('storm');
      let maxStep = 0, maxLight = 0, prev = { ...S.mix }, prevI = w.env.sun.intensity;
      const trace = [];
      for (let i = 0; i < 60 * 240; i++) {
        S.frame(1 / 60);
        for (const k of ['cloud', 'overcast', 'rain', 'thunder', 'wind', 'fog']) maxStep = Math.max(maxStep, Math.abs(S.mix[k] - prev[k]));
        maxLight = Math.max(maxLight, Math.abs(w.env.sun.intensity - prevI));
        prev = { ...S.mix }; prevI = w.env.sun.intensity;
        if (i % 1800 === 0) trace.push({ s: i / 60, cloud: +S.mix.cloud.toFixed(2), rain: +S.mix.rain.toFixed(2), thunder: +S.mix.thunder.toFixed(2) });
      }
      out.blend = { maxStep: +maxStep.toFixed(4), maxLight: +maxLight.toFixed(4), end: st(), trace };
      // the weather tells others when it changes (main.js: the rain's sound)
      let told = 0; const off = S.onChange(() => told++);
      S.force('clear'); for (let i = 0; i < 60 * 300; i++) S.frame(1 / 60);
      off();
      out.told = told;
      // the real weather's codes (Open-Meteo, WMO)
      out.codes = Object.fromEntries([[0, 5], [2, 5], [3, 10], [45, 5], [53, 5], [63, 10], [63, 45], [75, 5], [95, 40]].map(([c, wind]) => [c + '/' + wind, Hs.phaseOfCode(c, wind, 60)]));
      sk.set({ weather: 'clear', sky: { mode: 'fixed', base: 'clear', fog: false, wind: false } });
      return out;
    });
    const c = r.combos;
    check('rain and fog: drizzle in fog', c.rainFog.rain > 0.2 && c.rainFog.rain < 0.5 && c.rainFog.fog > 0.6 && c.rainFog.name === 'rain', c.rainFog);
    check('snow and fog, overcast and fog, a mist on a clear day, snow with wind', c.snowFog.snow > 0.5 && c.snowFog.fog > 0.5 && c.overcastFog.fog > 0.95 && c.mist.fog > 0.4 && c.mist.fog < 0.7 && c.mist.overcast < 0.3 && c.snowWind.wind > 0.7 && c.snowWind.snow > 0.9, c);
    check('incompatible ones are rejected: no fog in a thunderstorm, no wind with fog', r.stormFog.fog === 0 && r.stormFog.thunder === 1 && r.fogWind.wind < 0.2 && r.fogWind.fog > 0.95 && r.fits.storm.fog !== true && r.fits.overcastFog.wind !== true && r.fits.clear.fog === true, { stormFog: r.stormFog, fogWind: r.fogWind, fits: r.fits });
    const lg = r.legacy;
    check('the old single words still give the old weathers (and the word back for old code)', Object.entries(lg).every(([k, v]) => v.name === k) && lg.fog.fog > 0.95 && lg.storm.thunder === 1 && lg.snow.snow === 1, lg);
    const ru = r.runs, bad = (k, kinds) => kinds.some((x) => ru[k].kinds[x]);
    check('the changing weather brings only what is allowed: rain, storm and fog when allowed, snow only in winter', ru.all.kinds.rain && ru.all.kinds.storm && (ru.all.kinds.fog || ru.all.kinds.mist) && !ru.all.kinds.snow && ru.winter.kinds.snow > 0 && !bad('dry', ['rain', 'drizzle', 'storm', 'mist', 'fog', 'snow', 'snowfog']) && !bad('noRain', ['rain', 'drizzle', 'mist', 'fog', 'snow', 'snowfog']) && ru.noRain.kinds.storm > 0, ru);
    check('each weather lasts 10 to 30 minutes', Object.values(ru).every((x) => x.minDur >= 600 && x.maxDur <= 1800 + 5), Object.fromEntries(Object.entries(ru).map(([k, v]) => [k, [v.minDur, v.maxDur]])));
    check('a natural sequence: no thunderstorm out of a clear sky, no fog straight into a storm', !r.pairs.includes('clear>storm') && !r.pairs.includes('fog>storm') && !r.pairs.includes('mist>storm') && r.pairs.includes('rain>clearing'), r.pairs);
    check('a new weather blends in without jumps (clouds first, then the rain), within a few minutes', r.blend.maxStep < 0.02 && r.blend.maxLight < 0.05 && r.blend.end.thunder > 0.9 && r.blend.end.rain > 0.9, r.blend);
    check('others are told when the weather changes (the rain\'s sound)', r.told >= 1, { told: r.told });
    const cd = r.codes;
    check('the real weather: Open-Meteo codes to weathers (clear, clouds, fog, drizzle, rain, snow, thunderstorm, wind)', cd['0/5'].phase === 'fair' && cd['3/10'].phase === 'overcast' && cd['45/5'].phase === 'fog' && cd['53/5'].phase === 'drizzle' && cd['63/10'].phase === 'rain' && cd['63/45'].wind && cd['75/5'].phase === 'snow' && cd['95/40'].phase === 'storm' && !cd['95/40'].wind, cd);
  }

  // ================================================================= sky ======================================================
  if (want('sky') && newBuild) {
    // the night sky looking up from the terrace (new moon, clear, 23:00)
    const look = (cond, pose, rect, moon = 0) => H(async ([cond, pose, rect, moon]) => {
      const w = window.__app.world, sk = window.__sk;
      sk.set(cond); w.sky.moonOverride = moon; w.sky.push();
      sk.pose(...pose); await sk.frames(16);
      return sk.region(rect, { bright: 120, over: 22 });
    }, [cond, pose, rect, moon]);
    const clear23 = { weather: 'clear', timeMode: 'fixed', fixedHour: 23, sky: { mode: 'fixed', base: 'clear', fog: false, wind: false } };
    const up = [0.4, 9.2, Math.PI, 1.25], skyRect = [0.05, 0.05, 0.9, 0.45];
    const clear = await look(clear23, up, skyRect);
    const cloudy = await look({ ...clear23, weather: 'overcast', sky: { mode: 'fixed', base: 'overcast', fog: false } }, up, skyRect);
    const foggy = await look({ ...clear23, weather: 'fog', sky: { mode: 'fixed', base: 'overcast', fog: true } }, up, skyRect);
    const noon = await H(async () => { const w = window.__app.world, U = w.env.uniforms.SKY; window.__sk.set({ weather: 'clear', timeMode: 'fixed', fixedHour: 13 }); w.sky.push(); return { stars: U.uStars.value, milky: U.uMilky.value }; });
    check('stars at night in a clear sky: many bright points', clear.points > 150, clear);
    check('none when it is overcast or foggy, none by day', cloudy.points < clear.points * 0.08 && foggy.points < clear.points * 0.03 && noon.stars === 0 && noon.milky === 0, { cloudy, foggy, noon });
    // through the glass front: from the hall up into the night
    const inside = await look(clear23, [0.3, 3.4, Math.PI, 0.55], [0.15, 0.03, 0.7, 0.3]);
    check('the stars show through the glass front', inside.points > 40, inside);
    // the Milky Way: the sky with and without it (the band crosses the zenith on a summer night: 23:00 in August)
    const mw = await H(async () => {
      const w = window.__app.world, sk = window.__sk, U = w.env.uniforms.SKY;
      sk.set({ weather: 'clear', timeMode: 'fixed', fixedHour: 23.5, sky: { mode: 'fixed', base: 'clear', fog: false } });
      w.sky.moonOverride = 0; const day0 = w.sky.day0;
      // a night in August: Cygnus overhead
      w.sky.day0 = new Date(new Date().getFullYear(), 7, 10).getTime(); w.sky.push();
      sk.pose(0.4, 9.2, Math.PI, 1.45); await sk.frames(10);
      const on = sk.region([0, 0, 1, 1]);
      const keep = U.uMilky.value; w.env.apply = ((orig) => function () { orig.call(this); U.uMilky.value = 0; })(w.env.apply);
      w.sky.push(); await sk.frames(4);
      const off = sk.region([0, 0, 1, 1]);
      delete w.env.apply; w.sky.day0 = day0; w.sky.push();
      return { on: on.mean, off: off.mean, milky: +keep.toFixed(4) };
    });
    check('the Milky Way: a soft band across the night sky', mw.on > mw.off + 1.5 && mw.milky > 0.01, mw);
    // the moon's phase: the date's (new moon 8 April 2024 18:21 UT, full moon 23 April 2024 23:49 UT), and its lit part
    const moon = await H(async () => {
      const w = window.__app.world, Hs = w.sky.constructor.helpers, sk = window.__sk;
      w.sky.moonOverride = null;
      const out = { newMoon: +Hs.moonPhase(Date.UTC(2024, 3, 8, 18, 21)).toFixed(3), fullMoon: +Hs.moonPhase(Date.UTC(2024, 3, 23, 23, 49)).toFixed(3), today: +w.sky.moonPhase().toFixed(3), date: +Hs.moonPhase(Date.now()).toFixed(3) };
      // the disc close up: at full moon all of it is lit, at the first quarter half of it
      const disc = async (phase, date) => {
        w.sky.moonOverride = phase;
        const day0 = w.sky.day0; w.sky.day0 = new Date(date + 'T00:00:00').getTime();
        // the night hour with the moon highest (it stands where the date and its phase put it)
        let best = null;
        for (let h = 0; h < 24; h += 0.5) {
          sk.set({ weather: 'clear', timeMode: 'fixed', fixedHour: h, sky: { mode: 'fixed', base: 'clear', fog: false } }); w.sky.push();
          const m = w.env.uniforms.SKY.uMoonDir.value;
          if (w.env.sunTrue.y < -0.1 && (!best || m.y > best.y)) best = { h, y: m.y };
        }
        sk.set({ fixedHour: best.h }); w.sky.push();
        const m = w.env.uniforms.SKY.uMoonDir.value.clone();
        // from the lawn, away from the house
        const p = w.player; p.transition = null; p.setPose(0, 22, Math.atan2(-m.x, -m.z), Math.asin(m.y));
        // without bloom: only the disc itself counts
        sk.set({ graphics: { bloom: false } });
        const fov = p.fov; p.fov = 9; w.camera.fov = 9; w.camera.updateProjectionMatrix(); await sk.frames(6);
        const r = sk.region([0.35, 0.3, 0.3, 0.4], { bright: 140 });
        p.fov = fov; w.camera.fov = fov; w.camera.updateProjectionMatrix();
        sk.set({ graphics: { bloom: true } }); w.sky.day0 = day0;
        return { ...r, moonY: +m.y.toFixed(2), hour: best.h };
      };
      // (a winter full moon and a spring first quarter stand high at night)
      out.full = await disc(0.5, '2026-12-20');
      out.quarter = await disc(0.25, '2026-03-25');
      w.sky.moonOverride = null;
      return out;
    });
    check('the moon\'s phase is the date\'s (new moon and full moon of April 2024 to within a day)', Math.min(moon.newMoon, 1 - moon.newMoon) < 0.035 && Math.abs(moon.fullMoon - 0.5) < 0.035 && Math.abs(moon.today - moon.date) < 0.001, moon);
    check('the moon\'s disc shows its phase: half of it lit at the first quarter', moon.full.bright > 2000 && moon.quarter.bright > moon.full.bright * 0.35 && moon.quarter.bright < moon.full.bright * 0.65 && moon.full.moonY > 0.5 && moon.quarter.moonY > 0.5, { full: moon.full, quarter: moon.quarter });
    // the garden at night: the lawn below the terrace and the lake from the jetty, new moon and full moon
    // The sky's clock counts from today's midnight, so the moon's height at a fixed hour changes from day to day: the
    // full moon at 1:00 lit the lawn by 3.2 for 0.7.1, by 2.8 for 0.7.2 and by 1.6 a week later. Both nights are
    // measured on the night of a real full moon (24 December 2026, the moon high in the winter sky), at the same
    // hour, the one with the moon highest: the lamps of the house light the lawn alike, only the moon differs.
    const ground = async (moonPhase, hour) => {
      const cond = { ...clear23, fixedHour: hour };
      const lawn = await look(cond, [0.4, 8.8, Math.PI + 0.3, -0.32], [0, 0.55, 1, 0.45], moonPhase);
      return lawn.mean;
    };
    const night = await H(async () => {
      const w = window.__app.world, sk = window.__sk;
      w.sky.__groundDay0 = w.sky.day0; w.sky.day0 = new Date('2026-12-24T00:00:00').getTime(); w.sky.moonOverride = 0.5;
      let best = null;
      for (let h = 0; h < 24; h += 0.5) {
        sk.set({ weather: 'clear', timeMode: 'fixed', fixedHour: h, sky: { mode: 'fixed', base: 'clear', fog: false } }); w.sky.push();
        const m = w.env.uniforms.SKY.uMoonDir.value;
        if (w.env.sunTrue.y < -0.1 && (!best || m.y > best.y)) best = { h, y: +m.y.toFixed(2) };
      }
      return best;
    });
    const gNew = await ground(0, night.h), gFull = await ground(0.5, night.h);
    await H(() => { const s = window.__app.world.sky; s.day0 = s.__groundDay0; delete s.__groundDay0; s.push(); });
    // the full moon high in the sky lights the lawn by about 17 units of brightness (37.7 → 54.9): eight must show
    check('the garden is readable at night: the lawn below the terrace never black (new moon), lighter under a full moon', night.y > 0.3 && gNew > 9 && gFull > gNew + 8, { newMoon: gNew, fullMoon: gFull, moon: night });
  }

  // ================================================================= glass ====================================================
  if (want('glass') && newBuild) {
    const g = await H(async () => {
      const w = window.__app.world, sk = window.__sk;
      sk.set({ weather: 'rain', timeMode: 'fixed', fixedHour: 23, sky: { mode: 'fixed', base: 'rain', fog: false } });
      // the window in the book room's side wall, from inside (the user's picture)
      sk.pose(9.2, -20, -Math.PI / 2, 0.02); await sk.frames(12);
      let lamps = null; w.scene.traverse((o) => { if (!lamps && o.material?.userData?.lamps) lamps = o.material.userData.lamps; });
      const rect = [0.34, 0.0, 0.32, 0.68];
      const now = sk.region(rect, { bright: 170 });
      const keep = [lamps.glint.value, lamps.rough.value];
      lamps.glint.value = 1; lamps.rough.value = 0;   // the glass of before
      const before = sk.region(rect, { bright: 170 });
      [lamps.glint.value, lamps.rough.value] = keep;
      return { now, before };
    });
    // no pixel of the glass reaches the glare level (170, the `bright` count); the sconces of the single-storey room
    // (0.7.2) stand nearer to the side windows than the gallery's lights did, the brightest point rose from 127 to 158
    check('the lamps in the window glass are faint now (no glaring spots; the old glass for comparison)', g.now.max < 170 && g.now.bright === 0 && g.before.bright > 20, g);
  }

  // ================================================================= shadows ==================================================
  if (want('shadows')) {
    const shadowDay = +process.env.SK_SHADOW_DAY || 10;
    const sh = await H(async ([newBuild, minutes]) => {
      const w = window.__app.world, sk = window.__sk, env = w.env;
      const gl = w.renderer.getContext();
      // the afternoon sun moving fast: a day in 10 minutes (the old build: its 24-minute cycle)
      if (newBuild) {
        sk.set({ weather: 'clear', timeMode: 'fixed', fixedHour: 16.2, sky: { mode: 'fixed', base: 'clear', fog: false, wind: false, dayMinutes: minutes } });
        await sk.frames(2);
        sk.set({ timeMode: 'cycle', sky: { dayMinutes: minutes } });
      } else {
        w.applySettings({ ...w.settings, weather: 'clear', timeMode: 'cycle', graphics: { ...w.settings.graphics, quality: 'high', shadows: true, godrays: true } });
        w.time = 16.2 * 60;
      }
      // on the terrace, looking down at the lawn in the trees' shadows
      w.player.transition = null; w.player.setPose(-1.5, 9.4, Math.PI + 0.45, -0.38);
      // a still world: the same frame time, the wind's sway and the clouds stopped (only the sun moves)
      const getDelta = w.clock.getDelta; w.clock.getDelta = () => 1 / 60;
      const T = env.time;
      const stillWind = () => { env.time = T; if (w.sky) { w.sky.mix.wind = 0; w.sky.target.wind = 0; } };
      for (let i = 0; i < 30; i++) { stillWind(); w.frame(); }
      const cw = gl.drawingBufferWidth, ch = gl.drawingBufferHeight;
      const rw = Math.round(cw * 0.6), rh = Math.round(ch * 0.4), x0 = Math.round(cw * 0.2), y0 = Math.round(ch * 0.05);
      const a = new Uint8Array(rw * rh * 4), b = new Uint8Array(rw * rh * 4);
      let prev = null; const diffs = [];
      const r0 = env.shadowRedraws ?? 0, t0 = w.godrays?.trees?.renders ?? 0;
      const sun0 = (env.sunTrue || env.sunDir).clone();
      for (let i = 0; i < 3600; i++) {
        stillWind();
        w.frame();
        const cur = i % 2 ? a : b;
        gl.readPixels(x0, y0, rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, cur);
        if (prev) { let s = 0; for (let k = 0; k < cur.length; k += 16) s += Math.abs(cur[k + 1] - prev[k + 1]); diffs.push(s / (cur.length / 16)); }
        prev = cur;
      }
      w.clock.getDelta = getDelta;
      const sun1 = (env.sunTrue || env.sunDir).clone();
      const sorted = [...diffs].sort((p, q) => p - q), q = (f) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
      // how often the picture changes (the shadows move on), and the largest single step against the change of a whole
      // second: a steady motion moves a little each time (a small share), a jump carries the motion of seconds at once
      const moving = diffs.filter((d) => d > 0.02).length;
      const perSec = diffs.reduce((p, v) => p + v, 0) / 60, maxStep = sorted[sorted.length - 1];
      return { dayMinutes: newBuild ? minutes : 24, frames: diffs.length, updatesPerSec: +(moving / 60).toFixed(1), maxStep: +maxStep.toFixed(3), p99Step: +q(0.99).toFixed(3), changePerSec: +perSec.toFixed(3), stepShare: +(maxStep / Math.max(perSec, 1e-6)).toFixed(3), sunDeg: +(sun0.angleTo(sun1) * 180 / Math.PI).toFixed(2), sunRedraws: (env.shadowRedraws ?? 0) - r0, treeRedraws: (w.godrays?.trees?.renders ?? 0) - t0, size: [cw, ch] };
    }, [newBuild, shadowDay]);
    console.log('SHADOWS ' + JSON.stringify(sh));
    if (newBuild) check(`the trees' shadows move smoothly while the sun goes on (a day of ${sh.dayMinutes} minutes, 60 s at 60 frames): at least 8 small steps a second, none larger than half a second's motion (no jumps)`, sh.updatesPerSec >= 8 && sh.stepShare <= 0.5 && sh.sunDeg > 3, sh);
  }

  // ================================================================= live =====================================================
  if (want('live') && newBuild) {
    if (process.env.SK_NET !== '1') skip('like outside: the real weather of a place', 'SK_NET=1 asks Open-Meteo');
    else {
      const lv = await H(async () => {
        const app = window.__app, w = app.world, wait = (ms) => new Promise((r) => setTimeout(r, ms));
        app.openPanel('settings', { section: 'light' }); await wait(600);
        const row = (label) => [...document.querySelectorAll('.settings-content .setting')].find((r) => (r.querySelector('label')?.childNodes[0]?.textContent || '').trim() === label);
        [...row('Wetter').querySelectorAll('.seg button')].find((b) => b.textContent.trim() === 'Wie draußen')?.click(); await wait(700);
        const input = document.querySelector('.sky-place-input');
        input.value = 'Hamburg'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        let places = [];
        for (let i = 0; i < 40 && !places.length; i++) { await wait(250); places = [...document.querySelectorAll('.sky-place')]; }
        const found = places.map((b) => b.textContent);
        places[0]?.click();
        let st = null;
        for (let i = 0; i < 60; i++) { await wait(250); st = w.weatherState(); if (st.live?.status === 'ok') break; }
        await wait(3500);
        const status = document.querySelector('.sky-live-status')?.textContent || '';
        const { mixOf, nameOfMix } = w.sky.constructor.helpers;
        const ok = { place: app.state.settings.sky?.place, live: st?.live && { status: st.live.status, phase: st.live.phase, temp: st.live.temp }, name: st?.name, expected: st?.live?.phase ? nameOfMix(mixOf(st.live.phase, { wind: !!st.live.wind })) : null, status };
        // offline: the next fetch fails, the weather stays as it was
        const keepFetch = w.sky.fetch;
        w.sky.fetch = () => Promise.resolve({ ok: false, status: 0, error: 'offline' });
        w.sky.live.at = 0; w.sky.live.tried = 0;
        for (let i = 0; i < 20; i++) { w.frame(); await wait(100); }
        const off = w.weatherState();
        w.sky.fetch = keepFetch;
        app.closeAllPanels();
        await app.ctx.api.settings.set({ weather: 'clear', sky: { mode: 'fixed', base: 'clear', fog: false, place: null } });
        return { found, ok, offline: { status: off.live?.status, phase: off.live?.phase, name: off.name } };
      });
      check('like outside: a place found by name, its weather fetched and shown in the settings (and in the world at once)', lv.found.length > 0 && lv.ok.place?.lat > 53 && lv.ok.place?.lat < 54 && lv.ok.live?.status === 'ok' && !!lv.ok.live.phase && lv.ok.name === lv.ok.expected && /Stand/.test(lv.ok.status), lv);
      check('… and without a connection the last weather stays', lv.offline.status === 'stale' && lv.offline.phase === lv.ok.live?.phase, lv.offline);
    }
  }

  // ================================================================= perf =====================================================
  if (want('perf') && newBuild) {
    const busyNow = () => { try { return parseFloat(require('child_process').execSync('nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits', { timeout: 5000 }).toString()); } catch { return NaN; } };
    const loads = []; for (let i = 0; i < 5; i++) { const b = busyNow(); if (!Number.isNaN(b)) loads.push(b); await sleep(250); }
    loads.sort((a, b) => a - b);
    const others = loads.length ? loads[loads.length >> 1] : null;
    const r = await H(async (emu) => {
      const w = window.__app.world, sk = window.__sk, gl = w.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      if (emu) { const pr = emu[0] / innerWidth; w.renderer.setPixelRatio(pr); w.renderer.setSize(innerWidth, innerHeight, false); w.composer.setPixelRatio(pr); }
      // the work of a frame also counted (draw calls and triangles of every pass, the shadow maps included): unlike the
      // GPU time it does not depend on what else the graphics card is doing
      const info = w.renderer.info, autoReset = info.autoReset;
      const time = async () => {
        info.autoReset = false; info.reset();
        const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); const c0 = performance.now(); w.frame(); const cpu = performance.now() - c0; gl.endQuery(ext.TIME_ELAPSED_EXT);
        const calls = info.render.calls, tris = info.render.triangles; info.autoReset = autoReset;
        for (let k = 0; k < 300 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await wait(2);
        const bad = gl.getParameter(ext.GPU_DISJOINT_EXT), v = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(q);
        return { gpu: bad ? null : v, cpu, calls, tris };
      };
      const mean = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
      const stat = (a) => { const s = a.filter((v) => v != null).sort((x, y) => x - y); return { med: +s[Math.floor(s.length / 2)].toFixed(3), p95: +s[Math.floor(s.length * 0.95)].toFixed(3), max: +s[s.length - 1].toFixed(3), over33: s.filter((v) => v > 33).length }; };
      const getDelta = w.clock.getDelta; w.clock.getDelta = () => 1 / 60;
      const out = { size: [gl.drawingBufferWidth, gl.drawingBufferHeight], views: {} };
      for (const [name, x, z, yaw, pitch] of [['terrace', 0.6, 8.7, Math.PI + 0.15, 0.0], ['hall', 0.3, 2.2, Math.PI, 0.05], ['lawn', -2, 20, Math.PI + 0.6, 0.0]]) {
        const res = {};
        for (const mode of ['still', 'moving']) {
          sk.set({ weather: 'clear', timeMode: 'fixed', fixedHour: 16, sky: { mode: 'fixed', base: 'clear', fog: false, dayMinutes: 10 } });
          if (mode === 'moving') sk.set({ timeMode: 'cycle', sky: { dayMinutes: 10 } });
          w.player.transition = null; w.player.setPose(x, z, yaw, pitch);
          for (let i = 0; i < 30; i++) w.frame();
          const r0 = w.env.shadowRedraws, gpu = [], cpu = [], calls = [], tris = [];
          for (let i = 0; i < 120; i++) { const t = await time(); gpu.push(t.gpu); cpu.push(t.cpu); calls.push(t.calls); tris.push(t.tris); }
          res[mode] = { gpu: stat(gpu), cpu: stat(cpu), redrawsPerSec: +((w.env.shadowRedraws - r0) / 2).toFixed(1), calls: mean(calls), tris: mean(tris) };
        }
        out.views[name] = res;
      }
      w.clock.getDelta = getDelta;
      if (emu) w.resize();
      return out;
    }, process.env.PERF_EMU ? process.env.PERF_EMU.split('x').map(Number) : null);
    console.log(`PERF others=${others ?? '?'}% ` + JSON.stringify(r));
    // the extra work of the moving sun per frame (the shadow maps drawn again), on average
    console.log('PERF-WORK ' + JSON.stringify(Object.fromEntries(Object.entries(r.views).map(([k, v]) => [k, { calls: [v.still.calls, v.moving.calls], tris: [v.still.tris, v.moving.tris] }]))));
    const cost = Object.values(r.views).map((v) => v.moving.gpu.med - v.still.gpu.med);
    // long frames (over 33 ms, GPU or CPU) with the sun moving against a still sun, at the same places
    const long = Object.fromEntries(Object.entries(r.views).map(([k, v]) => [k, { still: Math.max(v.still.gpu.over33, v.still.cpu.over33), moving: Math.max(v.moving.gpu.over33, v.moving.cpu.over33) }]));
    const busy = others === null ? 'no reading of the graphics card' : others > 50 ? `the graphics card was ${others} % busy with other programs` : null;
    const name = 'the moving sun costs at most 1.5 ms of GPU time per frame (median, the maps drawn again on alternate frames)';
    if (!busy) check(name, Math.max(...cost) <= 1.5, { cost: cost.map((c) => +c.toFixed(3)), size: r.size });
    else skip(name, busy, { cost: cost.map((c) => +c.toFixed(3)) });
    const name2 = 'no hitch while the sun moves: no more long frames (over 33 ms) than with a still sun';
    if (!busy) check(name2, Object.values(long).every((v) => v.moving <= v.still + 2), long);
    else skip(name2, busy, long);
  }

  // ================================================================= programs =================================================
  if (want('programs') && newBuild) {
    const r = await H(async () => {
      const w = window.__app.world, sk = window.__sk, known = new Set(w.renderer.info.programs.map((p) => p.cacheKey)), wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const added = [];
      const note = (where) => { for (const p of w.renderer.info.programs) if (!known.has(p.cacheKey)) { known.add(p.cacheKey); added.push(`${where}: ${p.type || '?'} ${p.name || ''} ${p.cacheKey.slice(0, 160)}`); } };
      const frames = async (n, where) => { for (let i = 0; i < n; i++) { w.frame(); await wait(8); } note(where); };
      for (const [x, z, yaw, pitch] of [[0.4, 9.2, Math.PI, 0.6], [0.3, 2.2, Math.PI, 0.1], [9.2, -20, -Math.PI / 2, 0.02], [-22, 37, 2.15, 0.1]]) {
        sk.pose(x, z, yaw, pitch);
        for (const [cond, where] of [[{ weather: 'clear', timeMode: 'fixed', fixedHour: 23, sky: { mode: 'fixed', base: 'clear', fog: false } }, 'night'], [{ weather: 'rain', sky: { mode: 'fixed', base: 'rain', fog: true } }, 'drizzle in fog'], [{ weather: 'snow', sky: { mode: 'fixed', base: 'snow', fog: true } }, 'snow in fog'], [{ weather: 'storm', timeMode: 'fixed', fixedHour: 13, sky: { mode: 'fixed', base: 'storm', fog: false } }, 'storm by day'], [{ timeMode: 'night', sky: { mode: 'changing' } }, 'night only, changing'], [{ timeMode: 'day', weather: 'clear', sky: { mode: 'fixed', base: 'clear', fog: true } }, 'day only, mist']]) {
          sk.set(cond); await frames(8, `${where} at ${x},${z}`);
        }
      }
      sk.set({ weather: 'clear', timeMode: 'fixed', fixedHour: 15, sky: { mode: 'fixed', base: 'clear', fog: false, wind: false } });
      return { added, total: w.renderer.info.programs.length };
    });
    check('no shader compiled after the warm-up (night sky, weathers, time modes, inside and out)', r.added.length === 0, r);
  }

  // ================================================================= shots ====================================================
  if (want('shots') && newBuild) {
    const views = [
      // name, settings, moon, pose
      ['terrace-newmoon', { weather: 'clear', timeMode: 'fixed', fixedHour: 23, sky: { mode: 'fixed', base: 'clear', fog: false } }, 0, [0.4, 8.6, Math.PI + 0.35, 0.3]],
      ['terrace-fullmoon', { weather: 'clear', timeMode: 'fixed', fixedHour: 21.6, sky: { mode: 'fixed', base: 'clear', fog: false }, date: '2026-12-20' }, 0.55, [0.4, 8.6, 1.79, 0.18]],
      ['jetty-newmoon', { weather: 'clear', timeMode: 'fixed', fixedHour: 23, sky: { mode: 'fixed', base: 'clear', fog: false } }, 0, 'jetty'],
      // a winter night: the moon rising over the lake (seen from the jetty)
      ['jetty-moon', { weather: 'clear', timeMode: 'fixed', fixedHour: 21.3, sky: { mode: 'fixed', base: 'clear', fog: false }, date: '2026-12-20' }, 0.58, [-19.3, 34.9, 1.885, 0.16]],
      ['milkyway', { weather: 'clear', timeMode: 'fixed', fixedHour: 23, sky: { mode: 'fixed', base: 'clear', fog: false } }, 0, [0.4, 9.2, Math.PI, 1.2]],
      ['hall-night', { weather: 'clear', timeMode: 'fixed', fixedHour: 23, sky: { mode: 'fixed', base: 'clear', fog: false } }, 0.35, [0.3, 2.2, Math.PI, 0.12]],
      ['rain-fog', { weather: 'rain', timeMode: 'fixed', fixedHour: 11, sky: { mode: 'fixed', base: 'rain', fog: true } }, null, [0.4, 8.6, Math.PI + 0.35, 0.05]],
      ['snow-fog', { weather: 'snow', timeMode: 'fixed', fixedHour: 14, sky: { mode: 'fixed', base: 'snow', fog: true } }, null, [0.4, 8.6, Math.PI + 0.35, 0.05]],
      ['mist-morning', { weather: 'fog', timeMode: 'fixed', fixedHour: 7.4, sky: { mode: 'fixed', base: 'clear', fog: true } }, null, 'jetty'],
      ['storm-day', { weather: 'storm', timeMode: 'fixed', fixedHour: 14, sky: { mode: 'fixed', base: 'storm', fog: false } }, null, [0.4, 8.6, Math.PI + 0.35, 0.12]],
      ['window-rain-night', { weather: 'rain', timeMode: 'fixed', fixedHour: 23, sky: { mode: 'fixed', base: 'rain', fog: false } }, null, [9.2, -20, -Math.PI / 2, 0.02]],
      // animals at night (the deer and the fox of the garden, held still on the lawn): from the terrace and through the glass
      ['animals-newmoon', { weather: 'clear', timeMode: 'fixed', fixedHour: 23, sky: { mode: 'fixed', base: 'clear', fog: false }, animals: true }, 0, [0.4, 8.8, Math.PI + 0.25, -0.05]],
      ['animals-fullmoon', { weather: 'clear', timeMode: 'fixed', fixedHour: 0.5, sky: { mode: 'fixed', base: 'clear', fog: false }, animals: true, date: '2026-12-20' }, 0.5, [0.4, 8.8, Math.PI + 0.25, -0.05]],
      ['animals-glass', { weather: 'clear', timeMode: 'fixed', fixedHour: 23, sky: { mode: 'fixed', base: 'clear', fog: false }, animals: true }, 0.3, [0.6, 3.6, Math.PI + 0.2, -0.02]],
    ];
    const shotsOnly = (process.env.SK_SHOTS || '').split(',').filter(Boolean);
    const pick = (name) => !shotsOnly.length || shotsOnly.some((o) => name.startsWith(o));
    for (const [name, cond, moon, pose] of views) {
      if (!pick(name)) continue;
      await H(async ([cond, moon, pose, flash]) => {
        const w = window.__app.world, sk = window.__sk;
        const { date, animals, ...settings } = cond;
        if (animals && w.wildlife && !w.wildlife.beasts.length) {
          w.wildlife.spawn('roe', { x: 3.5, z: 19, yaw: 2.2, hold: true, pose: 'graze' });
          w.wildlife.spawn('fox', { x: -2.5, z: 16, yaw: 1.2, hold: true, pose: 'stand' });
        } else if (!animals) w.wildlife?.clear();
        // date: the sky of that night
        const day0 = w.sky.__day0 ??= w.sky.day0;
        w.sky.day0 = date ? new Date(date + 'T00:00:00').getTime() : day0;
        sk.set(settings); w.sky.moonOverride = moon; w.sky.push();
        if (typeof pose === 'string') { const pl = w.places.find((q) => q.id === pose); sk.pose(pl.x, pl.z, pl.yaw, 0.12); } else sk.pose(...pose);
        await sk.frames(60);
        if (flash) { w.env.lightning = 0.9; w.frame(); }
      }, [cond, moon, pose, name === 'storm-day']);
      await shot(`${tag}-${name}`);
    }
    await H(() => { const s = window.__app.world.sky; s.moonOverride = null; if (s.__day0) s.day0 = s.__day0; window.__app.world.wildlife?.clear(); });
    // the settings: Licht & Wetter with a fixed weather (rain and fog), the changing weather, like outside, in English, and
    // the panel as narrow as in a window of about 950 pixels (the long choices wrap; the hidden test window keeps its size)
    const panels = [
      ['fixed', { language: 'de', timeMode: 'cycle', weather: 'rain', sky: { mode: 'fixed', base: 'rain', fog: true, wind: false, dayMinutes: 30 } }],
      ['changing', { timeMode: 'day', sky: { mode: 'changing' } }],
      ['live', { timeMode: 'real', sky: { mode: 'live' } }],
      ['en', { language: 'en', timeMode: 'night', weather: 'clear', sky: { mode: 'fixed', base: 'clear', fog: false } }],
      ['narrow', { language: 'de', timeMode: 'cycle', sky: { mode: 'changing' } }, 890],
    ];
    for (const [name, patch, width] of panels) {
      if (!pick(`settings-${name}`)) continue;
      await H(async ([patch, width]) => {
        const app = window.__app; app.closeAllPanels();
        await app.ctx.api.settings.set(patch); await new Promise((r) => setTimeout(r, 400));
        app.openPanel('settings', { section: 'light' }); await new Promise((r) => setTimeout(r, 300));
        const panel = document.querySelector('.settings-panel');
        if (panel) panel.style.width = width ? `${width}px` : '';
        await new Promise((r) => setTimeout(r, 400));
      }, [patch, width ?? 0]);
      await shot(`${tag}-settings-${name}`);
    }
    await H(() => { const panel = document.querySelector('.settings-panel'); if (panel) panel.style.width = ''; });
    await H(async () => { const app = window.__app; app.closeAllPanels(); await app.ctx.api.settings.set({ language: 'de', timeMode: 'real', weather: 'clear', sky: { mode: 'fixed', base: 'clear', fog: false } }); });
  }

  console.log(`SUMMARY sky-check ${passes} passed, ${failures} failed${skipped ? `, ${skipped} skipped` : ''}`);
};
