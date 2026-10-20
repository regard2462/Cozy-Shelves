// A library indexed before page 1 was judged (Cozy Shelves 0.5: no coverCheck in its records) gets every cached cover
// looked at once, in the background: how long that takes, what it finds, and the frame times in the book room while
// it runs compared with afterwards. The records are set back to the state of 0.5 in the main process (web-covers.js
// instance), so the script needs no prepared data folder. No network (test runs stay offline).
//   COZYSHELVES_BOOKS="<folder>\lib|structured" COZYSHELVES_USERDATA=<fresh folder> node build/screenshot.js covers-upgrade-check
// (<folder>\lib: the large test library of build/testlib/gen_lib.py and make_lnk.ps1)
const path = require('path');
// the main process module (the same instance main.js loaded: modules are cached by their file)
const WEB_COVERS = path.join(__dirname, '..', '..', 'electron', 'library', 'web-covers.js');

module.exports = async ({ app, page, sleep, shot }) => {
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 600; i++) {
    const st = await page.evaluate(() => { const b = window.__app.state.library.books; return { n: b.length, idx: b.filter((x) => x.indexed).length, active: !!window.__app.state.library.scan?.active }; });
    if (st.n > 0 && st.idx === st.n && !st.active) break;
    await sleep(2000);
  }
  await sleep(3000);
  const books = await page.evaluate(() => window.__app.state.library.books.length);

  // back to 0.5: no judgement of page 1 in any record
  const reset = await app.evaluate((_, file) => {
    const wc = process.mainModule.require(file).instance;
    if (!wc) return null;
    let n = 0;
    for (const b of Object.values(wc.library.books)) { if (b.coverCheck) n++; delete b.coverCheck; delete b.coverWeak; }
    return { n, enabled: wc.enabled() };
  }, WEB_COVERS);
  check('the records are set back to 0.5 (no network in a test run)', reset && reset.n > 0 && reset.enabled === false, reset);

  // frame times in the book room: while every cover is looked at, then afterwards
  await page.evaluate(() => {
    const w = window.__app.world;
    const P = window.__perf = { frames: [], on: true };
    let last = 0;
    const tick = (t) => { if (last) P.frames.push(t - last); last = t; if (P.on) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    w.player.transition = null; w.player.setPose(0, -12, 0, 0);
  });
  const stats = (a) => { const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))] || 0; return { n: s.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1), max: +q(1).toFixed(1), over40: s.filter((x) => x > 40).length }; };
  const walk = async (ms) => {
    await page.evaluate(() => { window.__perf.frames.length = 0; document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true })); });
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { await page.evaluate(() => { const p = window.__app.world.player; p.yaw += 0.025; if (Math.hypot(p.position.x, p.position.z + 12) > 4) p.setPose(0, -12, p.yaw, 0); }); await sleep(50); }
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true })));
    return page.evaluate(() => window.__perf.frames.slice());
  };
  const before = await walk(8000);                // nothing runs yet (the loop is idle until kicked)
  const t0 = Date.now();
  await app.evaluate((_, file) => process.mainModule.require(file).instance.kick(0), WEB_COVERS);
  const during = await walk(8000);
  let st = null;
  for (let i = 0; i < 300; i++) {
    st = await page.evaluate(() => window.__app.ctx.api.invoke('covers:status'));
    if (!st.checking) break;
    await sleep(1000);
  }
  const secs = Math.round((Date.now() - t0) / 100) / 10;
  const kinds = await page.evaluate(() => { const k = {}; for (const b of window.__app.state.library.books) { const x = b.coverWeak || (b.coverGenerated ? 'card' : 'cover'); k[x] = (k[x] || 0) + 1; } return k; });
  console.log('UPGRADE ' + JSON.stringify({ books, seconds: secs, perBookMs: Math.round((secs * 1000) / Math.max(1, reset?.n || 1)), kinds }));
  check('every cover is looked at once, in the background', st && st.checking === 0 && secs < books * 0.25, { seconds: secs, left: st?.checking });
  const after = await walk(8000);
  await page.evaluate(() => { window.__perf.on = false; });
  console.log('FRAMES before ' + JSON.stringify(stats(before)) + ' while checking ' + JSON.stringify(stats(during)) + ' afterwards ' + JSON.stringify(stats(after)));
  const calm = Math.max(stats(before).p95, stats(after).p95);
  check('the room keeps its pace while the covers are looked at (95 % of the frames within 1.5 × of before and after + 4 ms)', stats(during).p95 <= calm * 1.5 + 4, { before: stats(before), during: stats(during), after: stats(after) });
  await shot('covers-upgrade-room');
  const failed = results.filter((r) => !r.ok);
  console.log(`COVERS-UPGRADE-CHECK ${results.length - failed.length}/${results.length} passed` + (failed.length ? ' · failed: ' + failed.map((f) => f.name).join(' | ') : ''));
};
