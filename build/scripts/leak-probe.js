// Which geometries stay on the GPU after a department switch although they left the scene?
module.exports = async ({ page, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  await sleep(6000);
  const r = await page.evaluate(async () => {
    const w = window.__app.world; w.stop();
    const THREEGeo = Object.getPrototypeOf(w.scene.children.find((o) => o.geometry)?.geometry || {}).constructor;
    const disposed = new Set();
    const proto = Object.getPrototypeOf(Object.getPrototypeOf(w.camera)).constructor; // not used
    const seen = (root) => { const m = new Map(); root.traverse((o) => { if (o.geometry) m.set(o.geometry.uuid, { name: o.name || o.parent?.name || o.type, type: o.geometry.type, shared: !!o.geometry.userData.shared, inst: !!o.isInstancedMesh }); }); return m; };
    const BG = w.scene.children.find((o) => o.geometry)?.geometry.constructor;
    const origDispose = Object.getPrototypeOf(BG.prototype) && BG.prototype.dispose;
    const bgProto = (function find(p) { while (p && !Object.prototype.hasOwnProperty.call(p, 'dispose')) p = Object.getPrototypeOf(p); return p; })(BG.prototype);
    const od = bgProto.dispose;
    bgProto.dispose = function () { disposed.add(this.uuid); return od.call(this); };
    const deps = window.__app.state.library.departments.filter((d) => d.count > 0).map((d) => d.name);
    w.frame();
    const g0 = w.renderer.info.memory.geometries;
    const A = seen(w.scene);
    w.setDepartment(deps.find((d) => d !== w.department));
    w.frame();
    const g1 = w.renderer.info.memory.geometries;
    const B = seen(w.scene);
    const leaked = [];
    for (const [id, info] of A) if (!B.has(id) && !disposed.has(id) && !info.shared) leaked.push(info);
    const byName = {};
    for (const l of leaked) { const k = l.name + '|' + l.type + (l.inst ? '|inst' : ''); byName[k] = (byName[k] || 0) + 1; }
    return { g0, g1, sceneA: A.size, sceneB: B.size, leaked: leaked.length, byName };
  });
  console.log('LEAKPROBE ' + JSON.stringify(r));
};
