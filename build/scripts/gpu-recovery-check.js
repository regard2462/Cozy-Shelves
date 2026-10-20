// After the graphics process ends (a driver hiccup, a crash), Chromium starts a new one and gives the world its WebGL
// context back, but the world used to stay black. main.js builds the window again and puts the player back: at once
// when no panel is open, after the last panel closes otherwise, never twice within a minute. The check ends the GPU
// process of the test app itself (its own child process) twice: once while walking, once with a panel open.
//   COZYSHELVES_BOOKS=<test library>|structured COZYSHELVES_USERDATA=<dir> node build/screenshot.js gpu-recovery-check
module.exports = async ({ app, page, sleep }) => {
  const results = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  const check = (name, cond, detail) => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' ' + JSON.stringify(detail) : ''}`); };
  const pose = () => page.evaluate(() => { const p = window.__app.world.player; return [+p.position.x.toFixed(2), +p.position.z.toFixed(2), +p.yaw.toFixed(2)]; });
  // the mean brightness of the world's picture (a black world is near 0)
  const brightness = () => page.evaluate(() => {
    const w = window.__app.world, c = w.still(64);
    if (!c) return 0;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return Math.round(s / (d.length / 4));
  });
  const gpuPid = () => app.evaluate(({ app: a }) => (a.getAppMetrics().find((m) => m.type === 'GPU') || {}).pid);
  const waitReload = async (t0) => {
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      try {
        const s = await page.evaluate((t) => ({ reloaded: performance.timeOrigin !== t, entered: !!window.__app?.state?.entered && !!window.__app?.world, toast: document.querySelector('#toasts')?.textContent || '' }), t0);
        if (s.reloaded && s.entered) return s;
      } catch { /* the page is being replaced */ }
    }
    return null;
  };

  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  await sleep(3000);
  await page.evaluate(() => { const w = window.__app.world; w.player.transition = null; w.player.setPose(-3.5, -1.2, 2.4, 0.05); });
  await sleep(1500);
  const before = await pose();
  const light0 = await brightness();

  // 1. while walking: the window is built again at once
  let t0 = await page.evaluate(() => performance.timeOrigin);
  process.kill(await gpuPid());
  const r1 = await waitReload(t0);
  await page.waitForFunction(() => window.__app?.world?.renderer, null, { timeout: 60000 });
  await sleep(2500);
  check('after the graphics process ended the window is built again and the library entered', !!r1, r1);
  check('a short note says what happened', /Grafik war kurz unterbrochen|graphics were interrupted/.test(r1?.toast || ''), { toast: r1?.toast });
  const after1 = await pose();
  check('the player stands where they stood', after1.every((v, i) => Math.abs(v - before[i]) < 0.05), { before, after: after1 });
  const light1 = await brightness();
  check('the world is drawn again (not black)', light1 > 20 && light1 > light0 * 0.6, { before: light0, after: light1 });

  // 2. with a panel open: nothing happens until it closes (a book or a film is not cut short); not within a minute of
  // the last new start either, so the check waits that minute first
  await sleep(61000);
  await page.evaluate(() => window.__app.openPanel('settings', {}));
  await sleep(1200);
  t0 = await page.evaluate(() => performance.timeOrigin);
  process.kill(await gpuPid());
  await sleep(5000);
  const held = await page.evaluate((t) => ({ same: performance.timeOrigin === t, panel: !!document.querySelector('.panel-layer.open') }), t0);
  check('while a panel is open the window waits', held.same && held.panel, held);
  await page.evaluate(() => window.__app.closeAllPanels());
  const r2 = await waitReload(t0);
  await page.waitForFunction(() => window.__app?.world?.renderer, null, { timeout: 60000 });
  await sleep(2500);
  check('when the panel closes the window is built again', !!r2, r2);
  const light2 = await brightness();
  check('the world is drawn again after the second time', light2 > 20, { after: light2 });
  // the main process notes every end of the graphics process in <userData>/logs/gpu.log (time, reason, version)
  let notes = [];
  try { notes = require('fs').readFileSync(require('path').join(process.env.COZYSHELVES_USERDATA || '', 'logs', 'gpu.log'), 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l)); } catch { /* none */ }
  check('both ends of the graphics process are noted in logs/gpu.log', notes.length >= 2 && notes.every((n) => n.t && n.reason && n.version), { notes: notes.slice(-2) });
  check('no errors on the page', errors.length === 0, { errors });
  console.log(`GPU-RECOVERY-CHECK ${results.filter(Boolean).length}/${results.length} passed`);
};
