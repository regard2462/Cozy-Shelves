// Which objects cost the draw calls? (GPU=1) Counts, per placement kind / group name, the draw calls of all
// visible meshes inside the camera frustum from one view (a multi-material mesh costs one call per group).
module.exports = async ({ page, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(2000);
  const views = JSON.parse(process.env.VIEWS || '[["roomBack",0.4,-22.6,3.1416,0],["hallFire",0,0,1.5708,0]]');
  await page.evaluate(() => window.__app.world.stop());
  for (const [name, x, z, yaw, pitch] of views) {
    const res = await page.evaluate(([x, z, yaw, pitch]) => {
      const w = window.__app.world;
      const r = w.renderer; r.info.autoReset = false;
      w.player.transition = null; w.player.setPose(x, z, yaw, pitch); w.player.update(0.016); w.camera.updateMatrixWorld();
      // count by rendering each top-level child of the scene alone
      const counts = {};
      const tops = [];
      for (const c of w.scene.children) {
        if (c === w.static) { for (const s of c.children) tops.push([s.userData.placement?.kind || s.name || s.type, s]); }
        else tops.push([c.name || c.type, c]);
      }
      const vis = new Map();
      for (const [, o] of tops) vis.set(o, o.visible);
      for (const [, o] of tops) o.visible = false;
      for (const [label, o] of tops) {
        o.visible = vis.get(o);
        if (!o.visible) continue;
        r.info.reset(); r.render(w.scene, w.camera);
        counts[label] = (counts[label] || 0) + r.info.render.calls;
        o.visible = false;
      }
      for (const [, o] of tops) o.visible = vis.get(o);
      r.info.autoReset = true;
      return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 25);
    }, [x, z, yaw, pitch]);
    console.log('BREAKDOWN ' + name + ' ' + JSON.stringify(res));
  }
};
