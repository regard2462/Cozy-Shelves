// Where the time of a hover goes (developer probe, prints numbers only): the look ray, the hover switch, the HUD
// callback, the first frames after a switch; plus the cost of the single steps behind it (title card drawing, cover
// decoding and upload, the title card for the info card).
module.exports = async ({ page, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 200; i++) {
    const st = await page.evaluate(() => { const b = window.__app.state.library.books; return { n: b.length, idx: b.filter((x) => x.indexed).length, active: !!window.__app.state.library.scan?.active }; });
    if (st.n > 0 && st.idx === st.n && !st.active) break;
    await sleep(2000);
  }
  await sleep(10500);
  const r = await page.evaluate(async () => {
    const w = window.__app.world;
    w.stop();
    const out = { look: [], setHover: [], target: [], frameAfter: [], frames: [] };
    const entries = [...w.books.entries.values()].filter((e) => !e.hidden);
    const real = (b) => b.hasCover !== false && !b.coverGenerated;
    const pick = [...entries.filter((e) => real(e.book)).slice(40, 52), ...entries.filter((e) => !real(e.book)).slice(0, 12)];
    const time = (fn) => { const a = performance.now(); fn(); return performance.now() - a; };
    for (const e of pick) {
      const p = e.pos.clone().addScaledVector(e.forward, 1.5);
      w.player.transition = null; w.player.setPose(p.x, p.z, Math.atan2(e.forward.x, e.forward.z), Math.atan2(e.pos.y - 1.62, 1.5));
      w.player.update(0.016); w.camera.updateMatrixWorld();
      w.actions.target = null; w.books.setHover(null);
      await new Promise((res) => setTimeout(res, 30));
      w.actions.rayTimer = 0;
      out.look.push(time(() => w.actions.update(0)));
      w.books.setHover(null); w.actions.target = null;
      out.setHover.push([real(e.book) ? 'cover' : 'typo', +time(() => w.books.setHover(e)).toFixed(2)]);
      const t = { type: 'book', entry: e, book: e.book, distance: 1.5 };
      out.target.push(+time(() => { t.coverUrl = w.books.coverUrlFor(e.book); w.opts.onTarget?.(t); }).toFixed(2));
      out.frameAfter.push(+time(() => w.frame()).toFixed(2));
      for (let i = 0; i < 6; i++) { await new Promise((res) => setTimeout(res, 20)); out.frames.push(+time(() => w.frame()).toFixed(2)); }
    }
    w.start();
    return out;
  });
  const s = (a) => { const v = a.map((x) => (Array.isArray(x) ? x[1] : x)).sort((x, y) => x - y); return v.length ? { n: v.length, p50: +v[Math.floor(v.length / 2)].toFixed(2), max: +v[v.length - 1].toFixed(2) } : null; };
  console.log('PROBE look ' + JSON.stringify(s(r.look)));
  console.log('PROBE setHover cover ' + JSON.stringify(s(r.setHover.filter((x) => x[0] === 'cover'))) + ' typo ' + JSON.stringify(s(r.setHover.filter((x) => x[0] === 'typo'))));
  console.log('PROBE target(hud) ' + JSON.stringify(s(r.target)) + ' ' + JSON.stringify(r.target));
  console.log('PROBE frameAfter ' + JSON.stringify(s(r.frameAfter)) + ' ' + JSON.stringify(r.frameAfter));
  console.log('PROBE frames ' + JSON.stringify(s(r.frames)) + ' top ' + JSON.stringify([...r.frames].sort((a, b) => b - a).slice(0, 8)));
};
