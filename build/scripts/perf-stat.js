// Draw calls and triangles per view (one plain render of the scene, no post-processing).
module.exports = async ({ page, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  await sleep(6000);
  const out = await page.evaluate(() => {
    const w = window.__app.world; w.stop();
    const r = w.renderer; r.info.autoReset = false;
    const views = { hallWest: [6.4, 0.4, Math.PI / 2], roomEntry: [0, -10.2, 0], roomBack: [0.4, -22.6, Math.PI], shelves: [6.8, -14.5, -Math.PI / 2] };
    const res = {};
    for (const [k, [x, z, yaw]] of Object.entries(views)) {
      w.player.transition = null; w.player.setPose(x, z, yaw, 0); w.player.update(0.016); w.camera.updateMatrixWorld();
      r.info.reset(); r.render(w.scene, w.camera);
      res[k] = { calls: r.info.render.calls, tris: r.info.render.triangles };
    }
    r.info.autoReset = true;
    let meshes = 0, inst = 0; w.scene.traverse((o) => { if (o.isInstancedMesh) inst++; else if (o.isMesh) meshes++; });
    return { res, meshes, inst, geos: r.info.memory.geometries, tex: r.info.memory.textures, programs: r.info.programs?.length };
  });
  console.log('PERF ' + JSON.stringify(out));
};
