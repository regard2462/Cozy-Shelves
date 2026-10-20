// Developer probe: follows one hover frame by frame (slot state, facing) to debug the turn-out animation.
module.exports = async ({ page, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  for (let i = 0; i < 200; i++) {
    const st = await page.evaluate(() => { const b = window.__app.state.library.books; return { n: b.length, idx: b.filter((x) => x.indexed).length, active: !!window.__app.state.library.scan?.active }; });
    if (st.n > 0 && st.idx === st.n && !st.active) break;
    await sleep(2000);
  }
  await sleep(10500);
  const setup = await page.evaluate(() => {
    const w = window.__app.world;
    const list = [...w.books.entries.values()].filter((x) => !x.hidden && x.pos.y > 1.3 && x.pos.y < 1.9);
    const e = list[Math.floor(list.length / 3)];
    const p = e.pos.clone().addScaledVector(e.forward, 1.0);
    w.player.transition = null; w.player.setPose(p.x, p.z, 0, 0);
    w.player.update(0.016); w.camera.updateMatrixWorld();
    const dir = e.pos.clone().addScaledVector(e.forward, e.d / 2 - 0.004).sub(w.camera.position).normalize();
    w.player.yaw = Math.atan2(-dir.x, -dir.z); w.player.pitch = Math.asin(dir.y);
    w.frame(); w.actions.rayTimer = 0; w.actions.update(0.01);
    window.__e = e;
    return { title: e.book.title, target: w.actions.target?.book?.title };
  });
  console.log('SETUP ' + JSON.stringify(setup));
  for (let i = 0; i < 20; i++) {
    const st = await page.evaluate(() => {
      const w = window.__app.world; w.books.update(0.05, w.camera); w.frame();
      const s = w.books.slots.map((x) => x.entry ? [x.entry.book.title.slice(0, 12), +x.t.toFixed(2), x.target] : null);
      const m = w.books.hoverMesh;
      let cos = null;
      if (m) { const V = m.position.constructor; cos = +new V(1, 0, 0).applyQuaternion(m.quaternion).dot(w.camera.position.clone().sub(m.position).normalize()).toFixed(3); }
      return { target: w.actions.target?.book?.title?.slice(0, 12) || null, hover: w.books.hover?.book.title.slice(0, 12) || null, pending: !!w.books.pending, slots: s, cos, clock: +w.clock.getDelta().toFixed(3) };
    });
    console.log('STEP ' + i + ' ' + JSON.stringify(st));
    await sleep(50);
  }
};
