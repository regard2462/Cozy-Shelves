// Draw calls per frame with everything on, and the CPU cost of the shadow passes (GPU=1).
module.exports = async ({ app, page, sleep }) => {
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1920, 1080); });
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(3000);
  const out = await page.evaluate(async () => {
    const w = window.__app.world; w.stop();
    const r = w.renderer; r.info.autoReset = false;
    const res = {};
    const views = { hall: [5.4, 0.4, -Math.PI / 2], hallFire: [0, 0, Math.PI / 2], room: [0, -12, 0], roomBack: [0, -21, Math.PI] };
    for (const [k, [x, z, yaw]] of Object.entries(views)) {
      w.player.transition = null; w.player.setPose(x, z, yaw, 0);
      for (let i = 0; i < 3; i++) w.frame();
      // frame with no shadow updates
      w.env.sun.shadow.needsUpdate = false; if (w.fire) w.fire.light.shadow.needsUpdate = false;
      w.env.sunShadowTimer = 99; w.env.sunShadowKey = 'x'; if (w.fire) w.fire.shadowTimer = 99;
      const origU = w.env.update.bind(w.env); w.env.update = (dt, cam) => { origU(dt, cam); w.env.sun.shadow.needsUpdate = false; };
      r.info.reset(); let a = performance.now(); w.frame(); const plain = performance.now() - a; const callsPlain = r.info.render.calls;
      w.env.update = origU;
      // frame with the sun shadow map redrawn
      w.env.update = (dt, cam) => { origU(dt, cam); w.env.sun.shadow.needsUpdate = true; };
      r.info.reset(); a = performance.now(); w.frame(); const sun = performance.now() - a; const callsSun = r.info.render.calls;
      w.env.update = origU;
      // frame with the fire's cube shadow redrawn
      let fire = 0, callsFire = 0;
      if (w.fire) { w.env.update = (dt, cam) => { origU(dt, cam); w.env.sun.shadow.needsUpdate = false; w.fire.light.shadow.needsUpdate = true; }; r.info.reset(); a = performance.now(); w.frame(); fire = performance.now() - a; callsFire = r.info.render.calls; w.env.update = origU; }
      res[k] = { plain: +plain.toFixed(1), callsPlain, sun: +sun.toFixed(1), callsSun, fire: +fire.toFixed(1), callsFire };
    }
    let meshes = 0, inst = 0, lights = 0; w.scene.traverse((o) => { if (o.isInstancedMesh) inst++; else if (o.isMesh) meshes++; if (o.isLight) lights++; });
    r.info.autoReset = true;
    return { res, meshes, inst, lights, programs: r.info.programs?.length, fireCast: w.fire?.light.castShadow };
  });
  console.log('CALLS ' + JSON.stringify(out));
};
