// The golden hour and the god rays (app/src/world/godrays.js): the time option "Goldene Stunde" and the switch
// "Lichtstrahlen" in the settings (shown, applied at once, stored), the rays inside the hall and outside towards the sun
// (brighter along a beam than with the pass off), none at night and in the rain, golden light in fog, every quality tier
// (half resolution on high, a quarter on medium, off on low with the old window shafts), the GPU time of the pass
// (timer queries: the whole frame with the rays on and off in turn, judged only while other programs keep the graphics
// card at most half busy, a SKIP line otherwise; the march and the blur alone, judged always), no shader compiled after
// the warm-up, and screenshots (clear and fog): the hall seated on the window bench, the hall from the south towards the
// glass front, its east side, the terrace, the jetty towards the sun over the lake, the meadow towards the sun through
// the trees and the book room. Prints PASS/FAIL/SKIP lines and one summary line.
//   node build/screenshot.js godrays-check      GR_PARTS=settings,rays,weather,tiers,programs,perf,shots   PERF_W/PERF_H,
//   PERF_EMU=2560x1440 (the drawing buffer at that size whatever the screen allows)
const fs = require('fs');
const path = require('path');

module.exports = async ({ app, page, shot, sleep }) => {
  const W = +process.env.PERF_W || 1600, H = +process.env.PERF_H || 900;
  await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setContentSize(w, h); }, [W, H]);
  const parts = new Set((process.env.GR_PARTS || 'settings,rays,weather,tiers,programs,perf,shots').split(','));
  const tag = process.env.SHOT_TAG || 'gr';
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(2000);
  await page.evaluate(() => { window.__app.world.stop(); window.__app.closeAllPanels(); document.querySelector('#hud')?.style.setProperty('opacity', '0'); });
  let failures = 0, passes = 0, skipped = 0;
  const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); if (ok) passes++; else failures++; };
  const skip = (name, why, info) => { console.log(`SKIP ${name} (${why})${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); skipped++; };

  // a weather and a time (golden or an hour), graphics high unless given; returns nothing
  const setup = (weather, time, graphics = {}) => page.evaluate(([weather, time, graphics]) => {
    const w = window.__app.world;
    const t = time === 'golden' ? { timeMode: 'golden' } : { timeMode: 'fixed', fixedHour: time };
    w.applySettings({ ...w.settings, weather, ...t, graphics: { ...w.settings.graphics, quality: 'high', bloom: true, shadows: true, ssao: true, resolutionScale: 1, fov: 72, godrays: true, ...graphics } });
  }, [weather, time, graphics]);
  // stand at a view and let the frames settle (the rays fade in over a few frames, the tree map is drawn on the way)
  const view = (x, z, yaw, pitch = 0) => page.evaluate(async ([x, z, yaw, pitch]) => {
    const w = window.__app.world, p = w.player;
    if (w.actions.seatedId) w.actions.leaveSeat?.();
    p.transition = null; p.setPose(x, z, yaw, pitch);
    for (let i = 0; i < 40; i++) w.updateDoor(0.05);
    for (let i = 0; i < 24; i++) { w.frame(); if (i === 2) w.godrays.settle(); await new Promise((r) => setTimeout(r, 16)); }
  }, [x, z, yaw, pitch]);
  // the mean brightness (0 … 255) of a region of the picture (fractions of the canvas), read right after a frame
  const brightness = (rect, rays) => page.evaluate(([rect, rays]) => {
    const w = window.__app.world, g = w.godrays, gl = w.renderer.getContext();
    g.enabled = rays; if (!rays) g.strength = 0;
    for (let i = 0; i < 4; i++) w.frame();
    if (rays) { g.strength = Math.max(g.strength, w.env.rays || 0); w.frame(); }
    const cw = gl.drawingBufferWidth, ch = gl.drawingBufferHeight;
    const x = Math.round(rect[0] * cw), y = Math.round((1 - rect[1] - rect[3]) * ch), rw = Math.round(rect[2] * cw), rh = Math.round(rect[3] * ch);
    const buf = new Uint8Array(rw * rh * 4); gl.readPixels(x, y, rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let s = 0; for (let i = 0; i < buf.length; i += 4) s += 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
    g.enabled = w.settings.graphics?.godrays !== false;
    return +(s / (rw * rh)).toFixed(2);
  }, [rect, rays]);
  const state = () => page.evaluate(() => {
    const w = window.__app.world, g = w.godrays, e = w.env;
    return { active: g.active, strength: +g.strength.toFixed(3), rays: +(e.rays || 0).toFixed(3), golden: +(e.golden || 0).toFixed(3), sunY: +e.sunTrue.y.toFixed(3), sunI: +e.sun.intensity.toFixed(2),
      shafts: e.shafts.visible, motes: g.motes.points.visible, tier: g.tier, scale: g.pass.scale, steps: g.pass.marchU.uSteps.value, trees: g.trees.valid, stamp: g.trees.stamp.castShadow, treeRenders: g.trees.renders };
  });

  // --- the settings: the time option and the switch, live and stored --------------------------------------------------
  if (parts.has('settings')) {
    // how the two settings look (Licht with the four times of day, Grafik with the switch)
    await page.evaluate(async () => { window.__app.openPanel('settings', { section: 'light' }); await new Promise((r) => setTimeout(r, 500)); });
    await shot(`${tag}-settings-light`);
    await page.evaluate(async () => { [...document.querySelectorAll('.settings-nav button')].find((b) => /Grafik|Graphics/i.test(b.textContent))?.click(); await new Promise((r) => setTimeout(r, 400)); });
    await shot(`${tag}-settings-graphics`);
    await page.evaluate(() => window.__app.closeAllPanels());
    const ui = await page.evaluate(async () => {
      const app = window.__app; app.openPanel('settings', { section: 'light' });
      await new Promise((r) => setTimeout(r, 400));
      const btns = [...document.querySelectorAll('.settings-panel .seg button')];
      const golden = btns.find((b) => /Goldene Stunde|golden hour/i.test(b.textContent));
      const out = { golden: !!golden, options: btns.map((b) => b.textContent).filter((t) => /Uhrzeit|Zyklus|Wechsel|Nur |Stunde|time|cycle|only|hour/i.test(t)) };
      golden?.click();
      await new Promise((r) => setTimeout(r, 500));
      const w = app.world; w.frame();
      out.applied = { mode: app.state.settings.timeMode, golden: w.env.state.golden, hour: +w.currentHour().toFixed(2), sunElev: +(Math.asin(w.env.sunDir.y) * 57.3).toFixed(1), az: +(Math.atan2(w.env.sunDir.z, w.env.sunDir.x) * 57.3).toFixed(0), on: golden?.getAttribute('aria-checked') };
      // the switch in Grafik, next to bloom and shadows
      const nav = [...document.querySelectorAll('.settings-nav button')].find((b) => /Grafik|Graphics/i.test(b.textContent)); nav?.click();
      await new Promise((r) => setTimeout(r, 300));
      const rows = [...document.querySelectorAll('.settings-panel .setting')];
      const labels = rows.map((r) => r.querySelector('label')?.childNodes[0]?.textContent || '');
      const iRays = labels.findIndex((t) => /^Lichtstrahlen|^Light rays/.test(t)), iBloom = labels.findIndex((t) => /Bloom|bloom/.test(t)), iShadow = labels.findIndex((t) => /^Schatten|^Shadows/.test(t));
      out.toggle = { found: iRays >= 0, afterBloom: iRays === iBloom + 1, nearShadows: Math.abs(iRays - iShadow) <= 2, onByDefault: rows[iRays]?.querySelector('.toggle')?.classList.contains('on') };
      rows[iRays]?.querySelector('.toggle')?.click();
      await new Promise((r) => setTimeout(r, 500));
      out.off = { setting: app.state.settings.graphics?.godrays, world: w.godrays.enabled };
      // the rays fade out within two seconds or so (the fade runs on time, not on frames: wait for it, at most 4 s)
      const t0 = performance.now();
      while (w.godrays.active && performance.now() - t0 < 4000) { w.frame(); await new Promise((r) => setTimeout(r, 30)); }
      out.off.active = w.godrays.active; out.off.fadeMs = Math.round(performance.now() - t0);
      rows[iRays]?.querySelector('.toggle')?.click();
      await new Promise((r) => setTimeout(r, 500));
      out.back = { setting: app.state.settings.graphics?.godrays, world: w.godrays.enabled };
      rows[iRays]?.querySelector('.toggle')?.click();   // off again: stored like that, then on through the api
      await new Promise((r) => setTimeout(r, 300));
      app.closeAllPanels();
      return out;
    });
    check('Tageszeit offers "Goldene Stunde" as a fourth choice', ui.golden && ui.options.length >= 4, ui.options);
    check('choosing it applies at once: a still sun 5 to 10 degrees high in the north-west', ui.applied.mode === 'golden' && ui.applied.golden === true && ui.applied.sunElev >= 5 && ui.applied.sunElev <= 10 && ui.applied.az > 90 && ui.applied.az < 180, ui.applied);
    check('the switch "Lichtstrahlen" sits after bloom, next to the shadows, on by default', ui.toggle.found && ui.toggle.afterBloom && ui.toggle.nearShadows && ui.toggle.onByDefault, ui.toggle);
    check('switching it off and on applies at once', ui.off.setting === false && ui.off.world === false && ui.off.active === false && ui.back.setting === true && ui.back.world === true, { off: ui.off, back: ui.back });
    await sleep(1500);   // the settings file is written after 0.4 s
    const file = path.join(process.env.COZYSHELVES_USERDATA || '', 'settings.json');
    let disk = null; try { disk = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    check('both are stored in settings.json', disk?.timeMode === 'golden' && disk?.graphics?.godrays === false, { timeMode: disk?.timeMode, godrays: disk?.graphics?.godrays });
    await page.evaluate(() => window.__app.ctx.api.settings.set({ graphics: { godrays: true } }));
    await sleep(600);
  }

  // --- the rays: inside along a beam, outside towards the sun ----------------------------------------------------------
  if (parts.has('rays')) {
    await setup('clear', 'golden');
    await view(7, -3, 1.75, 0.1);   // the hall from the east, the beams cross towards the south wall
    const st = await state();
    check('golden hour, clear: the rays are on, the trees are in the sun\'s shadow map, the old shafts and the motes swap', st.active && st.strength > 0.5 && st.trees && st.stamp && !st.shafts && st.motes, st);
    const beam = [0.3, 0.32, 0.28, 0.2];   // the sunlit air between the glass front and the south wall
    const on = await brightness(beam, true), off = await brightness(beam, false);
    check('inside: brighter along a beam with the rays than without', on > off * 1.06 + 2, { on, off, gain: +(on / Math.max(off, 1)).toFixed(3) });
    await view(-22, 37, 2.15, 0.02);   // from the jetty towards the low sun behind the trees
    const sky = [0.08, 0.2, 0.3, 0.35];
    const on2 = await brightness(sky, true), off2 = await brightness(sky, false);
    check('outside: shafts through the crowns towards the sun', on2 > off2 * 1.06 + 2, { on: on2, off: off2, gain: +(on2 / Math.max(off2, 1)).toFixed(3) });
    const sp = await page.evaluate(() => { const w = window.__app.world; return { sunMap: !!w.env.sun.shadow.map, treeMap: w.godrays.trees.size, treesInMap: w.godrays.trees.meshes.length }; });
    check('the trees have their own map from the sun (one entry per species and part)', sp.treesInMap >= 8 && sp.treeMap >= 1024, sp);
  }

  // --- weather and time: none at night or in the rain, golden in fog, golden round sunset in the other time modes -------
  if (parts.has('weather')) {
    const pick = [0.3, 0.32, 0.28, 0.2];
    for (const [weather, time, want] of [['clear', 23, false], ['rain', 'golden', false], ['storm', 'golden', false], ['clear', 13, true], ['overcast', 'golden', true]]) {
      await setup(weather, time);
      await view(7, -3, 1.75, 0.1);
      const st = await state();
      const on = await brightness(pick, true), off = await brightness(pick, false);
      const hidden = !st.active && st.strength === 0 && Math.abs(on - off) < 1.5;
      check(`${weather} at ${time}: ${want ? 'rays on' : 'no rays'}`, want ? st.active && st.rays > 0 : hidden, { ...st, on, off });
    }
    await setup('overcast', 'golden'); await view(7, -3, 1.75, 0.1);
    const oc = await state();
    await setup('clear', 'golden'); await view(7, -3, 1.75, 0.1);
    const cl = await state();
    check('overcast weakens the rays', oc.rays < cl.rays * 0.5 && oc.rays > 0, { overcast: oc.rays, clear: cl.rays });
    await setup('fog', 'golden');
    await view(10, 25, 2.9, 0.06);   // the meadow towards the sun in the mist
    const fg = await state();
    const on = await brightness([0.5, 0.45, 0.3, 0.3], true), off = await brightness([0.5, 0.45, 0.3, 0.3], false);
    check('fog and golden hour: gold light, strong rays, shafts in the mist', fg.active && fg.rays > 0.9 && fg.golden > 0.5 && on > off + 3, { ...fg, on, off });
    // the real time and the cycle look golden round sunset and sunrise with the same code
    const modes = await page.evaluate(() => {
      const w = window.__app.world, out = {};
      for (const h of [20.0, 7.0, 13, 22]) { w.applySettings({ ...w.settings, weather: 'clear', timeMode: 'fixed', fixedHour: h }); w.frame(); out[h] = +(w.env.golden || 0).toFixed(2); }
      // the day cycle goes on without a jump at sunset (the sun used to drop 17° below the horizon at once)
      w.applySettings({ ...w.settings, timeMode: 'cycle' });
      const ys = []; for (const h of [20.3, 20.45, 20.55, 20.7]) { w.env.set({ hour: h }); ys.push(+w.env.sunTrue.y.toFixed(3)); }
      out.dusk = ys;
      return out;
    });
    const steps = modes.dusk.slice(1).map((y, i) => Math.abs(y - modes.dusk[i]));
    check('low sun of the real time and the cycle is golden too (sunset, sunrise), noon and night are not', modes[20] > 0.8 && modes[7] > 0.5 && modes[13] === 0 && modes[22] === 0, modes);
    check('the sun sinks under the horizon without a jump', Math.max(...steps) < 0.06, modes.dusk);
  }

  // --- quality tiers ------------------------------------------------------------------------------------------------------
  if (parts.has('tiers')) {
    for (const [q, want] of [['high', { active: true, scale: 0.5, steps: 24 }], ['medium', { active: true, scale: 0.25, steps: 16 }], ['low', { active: false }]]) {
      await setup('clear', 'golden', { quality: q, bloom: q !== 'low', shadows: q !== 'low' });
      await view(7, -3, 1.75, 0.1);
      const st = await state();
      const ok = want.active ? st.active && st.scale === want.scale && st.steps === want.steps && st.tier === q : !st.active && st.tier === 'off' && st.shafts;
      check(`quality ${q}: ${want.active ? `rays at ${want.scale} resolution, ${want.steps} steps` : 'no rays, the old window shafts'}`, ok, st);
    }
    await setup('clear', 'golden');
  }

  // --- no shader compiled after the warm-up (switching the setting, the time mode, the weather, looking around) ----------
  if (parts.has('programs')) {
    const r = await page.evaluate(async () => {
      const w = window.__app.world, known = new Set(w.renderer.info.programs.map((p) => p.cacheKey)), wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const added = [];
      const note = (where) => { for (const p of w.renderer.info.programs) if (!known.has(p.cacheKey)) { known.add(p.cacheKey); added.push(where + ': ' + (p.name || '?')); } };
      const frames = async (n, where) => { for (let i = 0; i < n; i++) { w.frame(); await wait(8); } note(where); };
      const set = (patch) => w.applySettings({ ...w.settings, ...patch, graphics: { ...w.settings.graphics, ...(patch.graphics || {}) } });
      const pose = (x, z, yaw) => { w.player.transition = null; w.player.setPose(x, z, yaw, 0.05); };
      set({ weather: 'clear', timeMode: 'fixed', fixedHour: 13, graphics: { godrays: false } }); pose(0, 2, Math.PI); await frames(20, 'noon, rays off');
      set({ graphics: { godrays: true } }); await frames(20, 'rays on');
      set({ timeMode: 'golden' }); await frames(20, 'golden');
      for (const [x, z, yaw] of [[7, -3, 1.75], [0, -4.6, Math.PI], [0.6, 8.7, Math.PI + 0.15], [-22, 37, 2.15], [0, -12, 0]]) { pose(x, z, yaw); await frames(16, `view ${x},${z}`); }
      set({ weather: 'fog' }); await frames(16, 'fog'); set({ weather: 'rain' }); await frames(16, 'rain'); set({ weather: 'clear', timeMode: 'cycle' }); await frames(16, 'cycle');
      set({ timeMode: 'golden' }); await frames(8, 'back');
      return { added, total: w.renderer.info.programs.length };
    });
    check('no shader compiled after the warm-up (rays on and off, golden hour, fog, rain, views inside and out)', r.added.length === 0, r);
  }

  // --- GPU time of the pass: the same views with the rays on and off in turn (timer queries) -----------------------------
  if (parts.has('perf')) {
    // How busy the card is with other programs, measured while this world stands still: they share its time with the
    // pass, and a timer query then counts their work as well (a card busy with others makes the pass look slower).
    const busyNow = () => { try { return parseFloat(require('child_process').execSync('nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits', { timeout: 5000 }).toString()); } catch { return NaN; } };
    await page.evaluate(() => window.__app.world.stop());
    const loads = [];
    for (let i = 0; i < 7; i++) { const b = busyNow(); if (!Number.isNaN(b)) loads.push(b); await sleep(250); }
    loads.sort((a, b) => a - b);
    const others = loads.length ? loads[loads.length >> 1] : null;
    const r = await page.evaluate(async (emu) => {
      const w = window.__app.world, g = w.godrays, gl = w.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      const wait = (ms) => new Promise((res) => setTimeout(res, ms)), px = new Uint8Array(4);
      w.applySettings({ ...w.settings, weather: 'clear', timeMode: 'golden', graphics: { ...w.settings.graphics, quality: 'high', godrays: true } });
      // a window larger than the screen is cut to it: the drawing buffer is scaled up to the size asked for instead
      // (PERF_EMU=2560x1440; the composer keeps the pixel ratio it was made with, so it is told as well)
      if (emu) {
        const pr = emu[0] / innerWidth;
        w.renderer.setPixelRatio(pr); w.renderer.setSize(innerWidth, innerHeight, false); w.composer.setPixelRatio(pr);
      }
      const time = async () => {
        if (!ext) { const a = performance.now(); w.frame(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return performance.now() - a; }
        const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); w.frame(); gl.endQuery(ext.TIME_ELAPSED_EXT);
        for (let k = 0; k < 300 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await wait(2);
        const bad = gl.getParameter(ext.GPU_DISJOINT_EXT), v = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(q);
        return bad ? null : v;
      };
      const med = (a) => { const s = a.filter((v) => v != null).sort((x, y) => x - y); return s.length ? +s[Math.floor(s.length / 2)].toFixed(3) : null; };
      const out = { size: [gl.drawingBufferWidth, gl.drawingBufferHeight], timer: !!ext, views: {} };
      for (const [name, x, z, yaw] of [['hall', 7, -3, 1.75], ['south', 0, -4.6, Math.PI], ['terrace', 0.6, 8.7, Math.PI + 0.15], ['jetty', -22, 37, 2.15]]) {
        w.player.transition = null; w.player.setPose(x, z, yaw, 0.05);
        for (let i = 0; i < 20; i++) { w.frame(); await wait(4); }
        // on and off in turn, the pass's cost as the median of the differences of neighbouring frames (other programs on
        // the graphics card change its speed slowly: neighbours see the same load)
        const on = [], off = [], diff = [];
        for (let i = 0; i < 60; i++) {
          g.enabled = true; g.strength = 1; w.frame(); const a = await time();
          g.enabled = false; g.strength = 0; w.frame(); const b = await time();
          on.push(a); off.push(b); if (a != null && b != null) diff.push(a - b);
        }
        g.enabled = true;
        // the pass alone (a timer query round the march and the blur): a short span, so other programs on the card come
        // in between less often than in a whole frame (the composite in the vignette and the motes are left out)
        const own = [];
        if (ext) {
          const orig = g.pass.render;
          let q = null;
          g.pass.render = function (...a) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); orig.apply(this, a); gl.endQuery(ext.TIME_ELAPSED_EXT); };
          for (let i = 0; i < 40; i++) {
            g.strength = 1; w.frame();
            if (!q) continue;
            for (let k = 0; k < 300 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await wait(2);
            if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) own.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
            gl.deleteQuery(q); q = null;
          }
          delete g.pass.render;   // (back to the method of its class)
        }
        out.views[name] = { on: med(on), off: med(off), pass: med(diff), alone: med(own) };
      }
      if (emu) w.resize();
      return out;
    }, process.env.PERF_EMU ? process.env.PERF_EMU.split('x').map(Number) : null);
    const worst = Math.max(...Object.values(r.views).map((v) => v.pass));
    console.log(`PERF others=${others ?? '?'}% ` + JSON.stringify(r));
    // the budget is 1.5 ms at 2560 × 1440; scaled to the window measured here (the pass grows with the pixels; at least
    // half of it for its fixed part)
    const budget = 1.5 * Math.max(0.5, (r.size[0] * r.size[1]) / (2560 * 1440));
    const name = `the pass costs at most ${budget.toFixed(2)} ms of GPU time (on minus off, median)`, info = { worst, budget: +budget.toFixed(2), size: r.size };
    if (others !== null && others <= 50) check(name, worst <= budget, info);
    else skip(name, others === null ? 'no reading of the graphics card' : `the graphics card was ${others} % busy with other programs`, info);
    // judged always: the pass alone, with a fifth of the budget left for the composite and the motes
    const alone = Object.values(r.views).map((v) => v.alone).filter((v) => v != null);
    if (alone.length) check(`the march and the blur alone cost at most ${(budget * 0.8).toFixed(2)} ms (median per view)`, Math.max(...alone) <= budget * 0.8, { worst: Math.max(...alone), others });
  }

  // --- screenshots ---------------------------------------------------------------------------------------------------------
  if (parts.has('shots')) {
    for (const weather of ['clear', 'fog']) {
      await setup(weather, 'golden');
      // seated on the window bench (east), looking into the hall
      await page.evaluate(async () => {
        const w = window.__app.world; w.actions.sit('windowseat2');
        for (let i = 0; i < 90; i++) { w.frame(); await new Promise((r) => setTimeout(r, 20)); }
        w.player.pitch = -0.02; w.godrays.settle(); for (let i = 0; i < 6; i++) w.frame();
      });
      await shot(`${tag}-${weather}-bench`);
      await page.evaluate(() => window.__app.world.actions.leaveSeat());
      for (const [name, x, z, yaw, pitch] of [['south', 0, -4.6, Math.PI, 0.1], ['east', 7, -3, 1.75, 0.1], ['terrace', 0.6, 8.7, Math.PI + 0.15, 0.05], ['jetty', -22, 37, 2.15, 0.02], ['meadow', 10, 25, 2.9, 0.06], ['room', 0, -12, 0, 0.02]]) {
        await view(x, z, yaw, pitch);
        await shot(`${tag}-${weather}-${name}`);
      }
    }
  }
  console.log(`SUMMARY godrays-check ${passes} passed, ${failures} failed${skipped ? `, ${skipped} skipped` : ''}`);
};
