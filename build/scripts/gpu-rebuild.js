// Cost of a world rebuild (recently-read shelf, department switch) and of hovering books (GPU=1).
module.exports = async ({ app, page, sleep }) => {
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1920, 1080); });
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(2000);
  // 1) setRecent → full build
  const r1 = await page.evaluate(async () => {
    const w = window.__app.world;
    const ids = [...w.books.entries.keys()];
    const t0 = performance.now();
    w.setRecent([ids[5], ids[40], ids[80]]);
    const t1 = performance.now();
    w.frame();
    const t2 = performance.now();
    w.frame();
    const t3 = performance.now();
    return { build: +(t1 - t0).toFixed(1), firstFrame: +(t2 - t1).toFixed(1), secondFrame: +(t3 - t2).toFixed(1) };
  });
  console.log('REBUILD setRecent ' + JSON.stringify(r1));
  // break down build()
  const r2 = await page.evaluate(async () => {
    const w = window.__app.world;
    const T = {};
    const wrap = (obj, name, label) => { const o = obj[name].bind(obj); obj[name] = (...a) => { const t = performance.now(); const r = o(...a); T[label] = (T[label] || 0) + performance.now() - t; return r; }; return () => { obj[name] = o; }; };
    const un = [wrap(w.books, 'build', 'books.build'), wrap(w.cinema, 'onBuilt', 'cinema'), wrap(w.actions, 'onBuilt', 'actions.onBuilt'), wrap(w, 'applySettings', 'applySettings')];
    const t0 = performance.now();
    w.build(w.library, { recent: [] });
    T.total = performance.now() - t0;
    un.forEach((f) => f());
    for (const k of Object.keys(T)) T[k] = +T[k].toFixed(1);
    return T;
  });
  console.log('BUILD parts ' + JSON.stringify(r2));
  // 2) hover: time of the frames right after hovering 12 different books (cover load + hover mesh)
  const r3 = await page.evaluate(async () => {
    const w = window.__app.world;
    const list = [...w.books.entries.values()].slice(100, 112);
    const out = [];
    for (const e of list) {
      const t0 = performance.now(); w.books.setHover(e); const t1 = performance.now();
      let worst = 0;
      for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 16)); const a = performance.now(); w.frame(); worst = Math.max(worst, performance.now() - a); }
      out.push({ setHover: +(t1 - t0).toFixed(1), worstFrame: +worst.toFixed(1) });
    }
    return out;
  });
  console.log('HOVER ' + JSON.stringify(r3));
};
