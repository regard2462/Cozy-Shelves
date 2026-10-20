// A full rebuild while the player sits (new books change the number of cases, the quality tier changes …) must keep
// them seated at the seat's eye height, and a sit-down glide that is still running must go on. The rebuild used to
// put the eye back at standing height (setPose) and cancel the glide.
module.exports = async ({ page, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  for (let i = 0; i < 90; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(1500);
  const results = [];
  const check = (name, ok, info) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(info)}`); };
  const settle = (n = 40) => page.evaluate((n) => { const w = window.__app.world; for (let i = 0; i < n; i++) { w.player.update(0.05); w.actions.update(0.05); } }, n);
  const pose = () => page.evaluate(() => { const p = window.__app.world.player; return { seated: !!p.seated, id: window.__app.world.actions.seatedId, y: +p.position.y.toFixed(3), pitch: +p.pitch.toFixed(3), transition: !!p.transition }; });
  // the private rebuild is reached through a change of the quality tier (world.applySettings)
  const rebuild = (quality) => page.evaluate(async (q) => { const s = window.__app.state.settings; await window.api.settings.set({ graphics: { ...(s.graphics || {}), quality: q } }); }, quality);

  // 1. seated at the reading table, the sit-down finished
  await page.evaluate(() => { const w = window.__app.world, s = w.seats.get('table1a'); w.player.transition = null; w.player.setPose(s.standPos.x, s.standPos.z, s.standYaw, 0); w.actions.sit('table1a'); });
  await settle();
  const before = await pose();
  await rebuild('medium'); await sleep(2500); await settle(4);
  const after = await pose();
  check('seated: a rebuild keeps the player on the chair at the same eye height', before.seated && after.seated && after.id === 'table1a' && Math.abs(after.y - before.y) < 0.01 && Math.abs(after.pitch - before.pitch) < 0.01, { before, after });

  // 2. a sit-down glide still running when the rebuild comes: it goes on to the seat
  await page.evaluate(() => { const w = window.__app.world; w.actions.stand(); });
  await settle();
  await page.evaluate(() => { const w = window.__app.world, s = w.seats.get('sofa'); w.player.transition = null; w.player.setPose(s.standPos.x, s.standPos.z, s.standYaw, 0); w.actions.sit('sofa'); w.player.update(0.05); });
  const mid = await pose();
  await rebuild('high'); await sleep(2500);
  const during = await pose();
  await settle();
  const end = await pose();
  const eye = await page.evaluate(() => +window.__app.world.seats.get('sofa').eye.y.toFixed(3));
  check('a sit-down glide survives the rebuild and ends on the seat', mid.transition && end.seated && !end.transition && Math.abs(end.y - eye) < 0.02, { mid, during, end, eye });

  // 3. standing: the rebuild keeps the player where they are, at standing height
  await page.evaluate(() => { const w = window.__app.world; w.actions.stand(); });
  await settle();
  await page.evaluate(() => { const w = window.__app.world; w.player.transition = null; w.player.setPose(1.0, 1.5, 0.3, 0.1); });
  const standBefore = await pose();
  await rebuild('medium'); await sleep(2500);
  const standAfter = await pose();
  await rebuild('high'); await sleep(2500);
  check('standing: a rebuild keeps position and height', !standAfter.seated && Math.abs(standAfter.y - standBefore.y) < 0.01, { standBefore, standAfter });

  const failed = results.filter((r) => !r.ok);
  console.log(`REBUILD-SEATED-CHECK ${results.length - failed.length}/${results.length} passed` + (failed.length ? ' · failed: ' + failed.map((f) => f.name).join(' | ') : ''));
};
