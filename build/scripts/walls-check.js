// Check: the wall finish (Einstellungen → Allgemein → Wandgestaltung). Run twice with the same COZYSHELVES_USERDATA:
//   node build/screenshot.js walls-check                         every option applies live through the settings panel
//                                                                 (no world rebuild), frame times while switching, the
//                                                                 mural (time, GPU memory, "Neu sprühen"), views of every
//                                                                 option; it ends on graffiti, variant 2
//   WALLS_PHASE=restart node build/screenshot.js walls-check      after a restart: variant 2 is on the walls again
// WALLS_FLAT=1 also writes the flat mural textures (flat-<seed>-<wall>.png). WALLS_VIEWS=0 skips the views.
const fs = require('fs');
const path = require('path');

const VIEWS = [
  ['hall-south', 0, 3.6, 0, 0.12], ['hall-west', 3.2, 0.4, Math.PI / 2, 0.1], ['hall-east', -2.5, -0.4, -Math.PI / 2, 0.1],
  ['hall-near', -4.8, -3.6, 0.35, 0.18], ['passage', 0, -4.6, 0, 0.05], ['passage-near', 0.9, -7.2, Math.PI / 2, 0.05],
  ['room-back', 0, -11.5, 0, 0.18], ['room-front', 0, -21.5, Math.PI, 0.18], ['room-up', -9.4, -13.2, 1.9, 0.55],
];

module.exports = async ({ page, shot, sleep }) => {
  const outDir = process.env.SHOT_DIR || '.';
  const restart = process.env.WALLS_PHASE === 'restart';
  let fails = 0, passes = 0;
  const check = (name, ok, info = '') => { if (ok) passes++; else fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' ' + info : ''}`); };
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  const stored = await page.evaluate(async () => (await window.api.settings.get()).walls);
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(1500);
  const info = () => page.evaluate(() => window.__app.world.walls.info());
  /** Waits (real frames) until the walls show `style` (and for graffiti the variant `seed`). */
  const until = async (style, seed, ms = 15000) => {
    const t0 = Date.now();
    for (;;) {
      const i = await info();
      if (i.shown === style && (style !== 'graffiti' || i.muralSeed === seed)) return { ...i, waited: Date.now() - t0 };
      if (Date.now() - t0 > ms) return { ...i, waited: -1 };
      await sleep(40);
    }
  };

  if (restart) {
    // --- after a restart: the stored mural comes back by itself -----------------------------------------------------
    check('restart-stored', stored?.style === 'graffiti' && stored?.seed === 2, JSON.stringify(stored));
    const i = await until('graffiti', 2, 20000);
    check('restart-shown', i.waited >= 0 && i.visible, `shown=${i.shown} seed=${i.muralSeed} after=${i.waited}ms paint=${i.paintMs}ms mb=${i.mb}`);
    await page.evaluate(() => { document.querySelector('#hud')?.style.setProperty('opacity', '0'); const p = window.__app.world.player; p.transition = null; p.setPose(0, 3.6, 0, 0.12); });
    await sleep(600);
    await shot('walls-restart-hall');
    console.log(`SUMMARY walls-check restart: ${passes} passed, ${fails} failed`);
    return;
  }

  check('default-white', (await info()).shown === 'white' && !(await info()).visible, JSON.stringify(stored));
  const builds0 = await page.evaluate(() => {
    // who rebuilds the world (a library update, the quality …): the walls never should
    const w = window.__app.world, ob = w.build.bind(w);
    window.__builds = [];
    w.build = (...a) => { const st = new Error().stack; if (!/updateLibrary|setRecent|setDepartment/.test(st)) window.__builds.push(st.split(String.fromCharCode(10)).slice(2, 7).map((l) => l.trim().replace(/\(.*\/dist\//, '(')).join(' < ')); return ob(...a); };
    return w.buildTimes.length;
  });

  // frame intervals (requestAnimationFrame) while `fn` runs and `ms` after it
  const frames = async (fn, ms) => {
    await page.evaluate(() => { const P = window.__wf = { t: [], on: true, last: 0 }; const tick = (t) => { if (P.last) P.t.push(t - P.last); P.last = t; if (P.on) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    await fn();
    await sleep(ms);
    const t = await page.evaluate(() => { window.__wf.on = false; return window.__wf.t; });
    const s = [...t].sort((a, b) => a - b);
    return { n: t.length, max: +(s[s.length - 1] || 0).toFixed(1), p95: +(s[Math.floor(s.length * 0.95)] || 0).toFixed(1), over25: t.filter((x) => x > 25).length };
  };
  // the first settings change of a session draws the paintings anew (main.js): not part of the walls, so it happens
  // before the measurements; the library settles for a few seconds after entering (covers, shelves) as well
  await page.evaluate(() => window.api.settings.set({ hints: true }));
  await sleep(2500);
  // a fresh library is still being indexed for a while and rebuilds the shelves: wait until it has been quiet for 6 s
  for (let i = 0, last = -1, since = Date.now(); i < 60; i++) {
    const n = await page.evaluate(() => window.__app.world.buildTimes.length + ':' + (window.__app.state.library.books || []).filter((b) => b.indexed !== false).length);
    if (n !== last) { last = n; since = Date.now(); } else if (Date.now() - since > 6000) break;
    await sleep(1000);
  }
  let baseline = null;
  for (let i = 0; i < 8; i++) { baseline = await frames(async () => {}, 1500); if (baseline.over25 === 0) break; }
  console.log('BASELINE ' + JSON.stringify(baseline));

  // --- every option through the settings panel ------------------------------------------------------------------------
  const openSettings = async () => { await page.evaluate(() => { window.__app.closeAllPanels?.(); window.__app.openPanel('settings', { section: 'general' }); }); await page.waitForSelector('.wall-opt', { timeout: 10000 }); };
  const pickInPanel = (style) => page.evaluate((k) => document.querySelector(`.wall-opt[data-wall="${k}"]`).click(), style);
  await openSettings();
  const options = await page.evaluate(() => [...document.querySelectorAll('.wall-opt')].map((b) => b.dataset.wall));
  check('panel-options', options.join(',') === 'white,cream,sage,dove,terracotta,graffiti', options.join(','));
  check('panel-no-spray-button', !(await page.$('.wall-spray')));

  // the mural first (its one-time painting is allowed to cost something), then switching back and forth is free
  let gen = null, gi = null, busySeen = null;
  const genFrames = await frames(async () => {
    await pickInPanel('graffiti'); gen = Date.now();
    await sleep(150);
    busySeen = await page.evaluate(() => { const b = document.querySelector('.wall-spray'); return b ? { disabled: b.disabled, text: b.textContent } : null; });
    await shot('walls-settings-painting');
    gi = await until('graffiti', 1); gen = Date.now() - gen;
  }, 300);
  check('graffiti-live', gi.waited >= 0 && gi.visible, `after=${gen}ms paint=${gi.paintMs}ms walls=${gi.walls} uploads=${JSON.stringify(gi.uploadMs)}`);
  console.log('GENERATION ' + JSON.stringify(genFrames));
  // the one-time painting is allowed to cost a frame now and then (it runs in a worker, one wall per frame onto the card)
  check('graffiti-generation-frames', genFrames.max < 250, `max=${genFrames.max}ms over25=${genFrames.over25} of ${genFrames.n} (baseline max=${baseline.max} over25=${baseline.over25})`);
  check('graffiti-memory', gi.mb > 10 && gi.mb < 100, `${gi.mb} MB on the graphics card (${gi.walls} walls)`);
  check('panel-spray-button', !!(await page.$('.wall-spray')));
  const busyAfter = await page.evaluate(() => { const b = document.querySelector('.wall-spray'); return { disabled: b.disabled, text: b.textContent }; });
  check('panel-spray-busy', busySeen?.disabled === true && busyAfter.disabled === false, `while painting ${JSON.stringify(busySeen)}, then ${JSON.stringify(busyAfter)}`);
  check('panel-radio', await page.evaluate(() => document.querySelector('.wall-opt.on')?.dataset.wall === 'graffiti'));
  await shot('walls-settings');

  for (const style of ['cream', 'sage', 'dove', 'terracotta', 'white', 'graffiti', 'cream', 'graffiti', 'white']) {
    let r = null;
    let fr = await frames(async () => { await pickInPanel(style); r = await until(style, 1, 4000); }, 400);
    // a frame over 25 ms during a switch could be another program's load: measure once more before calling it a fail
    if (fr.over25 > baseline.over25) {
      await pickInPanel(style === 'white' ? 'cream' : 'white'); await sleep(500);
      fr = await frames(async () => { await pickInPanel(style); r = await until(style, 1, 4000); }, 400);
    }
    check(`switch-${style}`, r.waited >= 0 && r.waited < 1500 && fr.over25 <= baseline.over25, `after=${r.waited}ms frames max=${fr.max}ms p95=${fr.p95} over25=${fr.over25}`);
  }
  // rebuilds by the library (new books indexed) do not count: they are not the walls' doing
  const builds1 = await page.evaluate(() => window.__builds);
  check('no-world-rebuild', builds1.length === 0, `${builds1.length} rebuilds ${JSON.stringify(builds1)}`);

  // --- "Neu sprühen" paints another variant ---------------------------------------------------------------------------
  // a fingerprint of the picture: pixels of the canvas right after a frame was drawn
  const fingerprint = () => page.evaluate(() => {
    const w = window.__app.world, p = w.player;
    p.transition = null; p.setPose(0, 3.6, 0, 0.12);
    w.frame();
    const gl = w.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(4), out = [];
    for (let y = 0.15; y < 0.6; y += 0.05) for (let x = 0.05; x < 0.95; x += 0.05) { gl.readPixels(Math.floor(x * W), Math.floor((1 - y) * H), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); out.push(px[0], px[1], px[2]); }
    return out;
  });
  await pickInPanel('graffiti'); await until('graffiti', 1);
  await page.evaluate(() => window.__app.closeAllPanels?.()); await sleep(400);
  const fp1 = await fingerprint();
  const plan1 = (await info()).plan;
  await openSettings();
  await page.evaluate(() => document.querySelector('.wall-spray').click());
  const g2 = await until('graffiti', 2);
  await page.evaluate(() => window.__app.closeAllPanels?.()); await sleep(400);
  const fp2 = await fingerprint();
  const diff = fp1.reduce((a, v, i) => a + Math.abs(v - fp2[i]), 0) / fp1.length;
  const stored2 = await page.evaluate(async () => (await window.api.settings.get()).walls);
  check('spray-again', g2.waited >= 0 && stored2.seed === 2 && diff > 12, `seed ${stored2.seed}, ${JSON.stringify(plan1?.words?.slice(0, 3))} → ${JSON.stringify(g2.plan?.words?.slice(0, 3))}, picture differs by ${diff.toFixed(1)}/255`);

  // --- the flat murals (optional) and views of every option -------------------------------------------------------------
  if (process.env.WALLS_FLAT) {
    for (const seed of [1, 2]) {
      const flats = await page.evaluate(async ([seed]) => {
        const walls = window.__app.world.walls.specs.map(({ id, room, len, y0, y1, top, s0, loop, parts, blocks, pieceMin, density }) => ({ id, room, len, y0, y1, top, s0, loop, parts, blocks, pieceMin, density }));
        const worker = new Worker(new URL('dist/wall-art-worker.js', document.baseURI), { type: 'module' });
        const out = [], pending = [];
        const toPng = async (m) => {
          const c = new OffscreenCanvas(m.w, m.h); c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(m.data.buffer), m.w, m.h), 0, 0);
          const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
          let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          out.push({ id: m.wall, png: btoa(s) });
        };
        await new Promise((resolve, reject) => {
          worker.onmessage = (e) => { const m = e.data; if (m.type === 'wall') pending.push(toPng(m)); else if (m.type === 'done') Promise.all(pending).then(resolve); else if (m.type === 'error') reject(new Error(m.message)); };
          worker.postMessage({ type: 'paint', id: 1, seed, density: 160, walls });
        });
        worker.terminate();
        return out;
      }, [seed]);
      for (const f of flats) fs.writeFileSync(path.join(outDir, `flat-${seed}-${f.id.replace(':', '-')}.png`), Buffer.from(f.png, 'base64'));
    }
  }
  if (process.env.WALLS_VIEWS !== '0') {
    await page.evaluate(() => { window.__app.world.stop(); document.querySelector('#hud')?.style.setProperty('opacity', '0'); });
    for (const [style, seed] of [['white', 1], ['cream', 1], ['sage', 1], ['dove', 1], ['terracotta', 1], ['graffiti', 1], ['graffiti', 2]]) {
      await page.evaluate(([style, seed]) => window.api.settings.set({ walls: { style, seed } }), [style, seed]);
      for (let i = 0; i < 300; i++) {
        const st = await page.evaluate(() => { const w = window.__app.world; w.frame(); return w.walls.info(); });
        if (st.shown === style && (style !== 'graffiti' || st.muralSeed === seed)) break;
        await sleep(20);
      }
      for (const [name, x, z, yaw, pitch] of VIEWS) {
        await page.evaluate(([x, z, yaw, pitch]) => { const w = window.__app.world, p = w.player; if (w.actions.seatedId) w.actions.leaveSeat?.(); p.transition = null; p.setPose(x, z, yaw, pitch); }, [x, z, yaw, pitch]);
        for (let i = 0; i < 6; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(40); }
        await shot(`walls-${style}${style === 'graffiti' ? seed : ''}-${name}`);
      }
    }
    await page.evaluate(() => { document.querySelector('#hud')?.style.setProperty('opacity', '1'); window.__app.world.start(); });
  }

  // --- leave variant 2 stored for the restart phase ---------------------------------------------------------------------
  await page.evaluate(() => window.api.settings.set({ walls: { style: 'graffiti', seed: 2 } }));
  await sleep(3200);   // the store writes at the latest 2.5 s after a change
  console.log(`SUMMARY walls-check: ${passes} passed, ${fails} failed`);
};
