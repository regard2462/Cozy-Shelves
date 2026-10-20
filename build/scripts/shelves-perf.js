// Timings of the shelves of 0.7 on a large library (books2\lib-master): how long the arrangement takes (what stands
// where: books read, one copy of a book, the order), how long a new sort order takes to rearrange the shelves and the
// longest frame meanwhile, and the room with the case "Gelesen" on and off (draw calls, frame times). Prints PERF lines
// and PASS/FAIL for "only the shelves are rebuilt", "the spine atlases stay" and "no long frame".
// COZYSHELVES_BOOKS="<lib-master>|structured"; SHP_READ=<books marked as read, default 60>
module.exports = async ({ page, sleep }) => {
  const log = (k, v) => console.log(k + ' ' + JSON.stringify(v));
  let failures = 0, passes = 0;
  const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); if (ok) passes++; else failures++; };
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 900; i++) {
    const st = await page.evaluate(() => { const b = window.__app.state.library.books; return { n: b.length, idx: b.filter((x) => x.indexed).length, active: !!window.__app.state.library.scan?.active }; });
    if (st.n > 0 && st.idx === st.n && !st.active) break;
    await sleep(2000);
  }
  await sleep(11000);
  const nRead = +(process.env.SHP_READ || 60);
  await page.evaluate(async (n) => {
    const A = window.__app, books = A.state.library.books.filter((b) => b.indexed);
    for (let i = 0; i < n && i < books.length; i++) await A.ctx.api.invoke('library:markRead', books[(i * 13) % books.length].id, true);
    await A.ctx.api.settings.set({ shelves: { readingGoal: 24 } });
  }, nRead);
  await sleep(4000);
  const base = await page.evaluate(() => {
    const w = window.__app.world, rd = w.layout.bookcases.find((b) => b.read);
    // the arrangement on its own (shelf-arrange.js through layout.js arrangeFor), ten times
    const t = [];
    for (let i = 0; i < 10; i++) { const a = performance.now(); window.__app.shelves.arrange(); t.push(+(performance.now() - a).toFixed(2)); }
    t.sort((a, b) => a - b);
    return { books: window.__app.state.library.books.length, cases: w.layout.bookcases.length, all: w.layout.allDepartments, read: rd ? rd.rows.reduce((a, r) => a + r.items.length, 0) : null, hidden: w.layout.hidden?.size || 0, arrangeMs: { median: t[5], max: t[9] } };
  });
  log('LIB', base);
  // a new order with the loop running: the rebuild and the frames meanwhile
  await page.evaluate(() => {
    const w = window.__app.world;
    window.__frames = []; let last = performance.now();
    const tick = (t) => { window.__frames.push(t - last); last = t; window.__req = requestAnimationFrame(tick); };
    window.__req = requestAnimationFrame(tick);
    window.__rearr = [];
    const orig = w.rearrangeShelves.bind(w);
    w.rearrangeShelves = () => { const c0 = w.layout.bookcases.map((b) => b.id).join(); const t = performance.now(); const r = orig(); window.__rearr.push({ ms: +(performance.now() - t).toFixed(1), same: c0 === w.layout.bookcases.map((b) => b.id).join() }); return r; };
  });
  // the longest frame while nothing changes (other programs on the same graphics card show here)
  await sleep(2500);
  const quiet = await page.evaluate(() => { const f = window.__frames.slice(2); return +Math.max(0, ...f).toFixed(1); });
  const rows = [];
  for (const mode of ['author', 'year', 'publisher', 'series', 'added', 'read', 'title']) {
    await page.evaluate(() => { window.__frames.length = 0; window.__rearr.length = 0; window.__atlas = window.__app.world.books.atlas; });
    await page.evaluate((m) => window.__app.ctx.api.settings.set({ shelves: { sort: m } }), mode);
    await sleep(2500);
    rows.push({ mode, ...(await page.evaluate(() => {
      const f = window.__frames.slice(2).sort((a, b) => a - b);
      // the spine atlases stay: books that only move are not drawn and put on the graphics card again
      const kept = !!window.__atlas && window.__app.world.books.atlas === window.__atlas;
      return { rearr: [...window.__rearr], kept, max: +(f[f.length - 1] || 0).toFixed(1), p95: +(f[Math.floor(f.length * 0.95)] || 0).toFixed(1), frames: f.length };
    })) });
  }
  // the same rebuild the recently-read case causes after every book read (in 0.6 as well): refreshShelves alone
  const refresh = await page.evaluate(async () => {
    const w = window.__app.world, t = [];
    for (let i = 0; i < 6; i++) { const a = performance.now(); w.refreshShelves(); t.push(+(performance.now() - a).toFixed(1)); await new Promise((r) => setTimeout(r, 150)); }
    return t;
  });
  await page.evaluate(() => cancelAnimationFrame(window.__req));
  log('SORT', rows);
  log('REFRESH', refresh);
  const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const maxFrames = rows.map((r) => r.max);
  log('MEDIAN', { rearrange: med(rows.flatMap((r) => r.rearr.map((x) => x.ms))), refresh: med(refresh), quiet, maxFrameMedian: med(maxFrames), maxFrame: Math.max(...maxFrames) });
  check('a new order on a large library rebuilds only the shelves (the cases stay)', rows.every((r) => r.rearr.length >= 1 && r.rearr.every((x) => x.same)), rows.map((r) => [r.mode, r.rearr]));
  check('the spine atlases stay on every new order (nothing drawn or uploaded again)', rows.every((r) => r.kept), rows.map((r) => [r.mode, r.kept]));
  // the median over the orders: a single long frame of another program on the same graphics card does not count
  check('no long frame: the longest frame of a new order stays under 250 ms (median over the orders)', med(maxFrames) < 250, { quiet, maxFrames });
  // the room facing the entrance wall: the case "Gelesen" on and off
  const room = async () => page.evaluate(async () => {
    const w = window.__app.world;
    w.player.transition = null; w.player.setPose(0, -14.5, Math.PI, 0.12);
    for (let i = 0; i < 20; i++) w.frame();
    // the draw calls of one whole frame (every pass of the composer, the shadow maps included): three.js counts per
    // render call unless autoReset is off
    const r = w.renderer, auto = r.info.autoReset;
    r.info.autoReset = false; r.info.reset();
    w.frame();
    const calls = r.info.render.calls, tris = r.info.render.triangles;
    r.info.autoReset = auto;
    const f = [];
    let last = performance.now();
    await new Promise((res) => { let n = 0; const tick = (t) => { f.push(t - last); last = t; if (++n < 180) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
    f.sort((a, b) => a - b);
    return { calls, tris, median: +f[Math.floor(f.length / 2)].toFixed(2), p95: +f[Math.floor(f.length * 0.95)].toFixed(2), max: +f[f.length - 1].toFixed(1) };
  });
  const on = await room();
  await page.evaluate(() => window.__app.ctx.api.settings.set({ shelves: { finishedShelf: false } }));
  await sleep(3500);
  const off = await room();
  await page.evaluate(() => window.__app.ctx.api.settings.set({ shelves: { finishedShelf: true } }));
  await sleep(3500);
  const on2 = await room();
  log('ROOM', { on, off, on2 });
  check('no renderer errors', !errors.length, errors.slice(0, 3));
  console.log(`SHELVES-PERF ${failures ? 'FAILED' : 'OK'} passed=${passes} failed=${failures}`);
};
