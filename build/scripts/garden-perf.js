// GPU time per frame in the garden by configuration, measured with timer queries at the user's size (the drawing buffer
// at PERF_EMU, default 2560x1440, whatever the screen allows). For each view the configurations take turns over several
// rounds (other programs on the graphics card disturb all of them alike); per configuration the 10th percentile and the
// median of all its frames. Configurations (GP_CONF, comma-separated; those an older build lacks are left out):
//   base          as it is
//   nolilies      without the water lilies          noreeds   without the reeds and cattails
//   lod40         the trees' near level only up to 40 m, blended into the far one by 62 m (instead of 45 … 70 m)
//   lod35         … up to 35 m, blended by 55 m      autumn    in autumn (the fallen leaves, the colours)
//   nofire        the fire bowl out                  fire      the fire bowl burning
// VIEWS='[["name", x, z, yaw, pitch], …]' (default: terrace, path, jetty, bay, hall); GP_N frames per turn (40),
// GP_ROUNDS (3). COZYSHELVES_QUERY sets the hour.
//   node build/screenshot.js garden-perf
module.exports = async ({ app, page, sleep }) => {
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1600, 900); });
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(2500);
  await page.evaluate(() => { window.__app.world.stop(); window.__app.closeAllPanels(); });
  const emu = (process.env.PERF_EMU || '2560x1440').split('x').map(Number);
  const views = JSON.parse(process.env.VIEWS || JSON.stringify([
    ['terrace', 0.4, 8.6, 2.455, 0], ['path', -4.4, 22.5, 2.6, -0.02], ['jetty', -26.79, 40.29, 2.16, -0.05], ['bay', -24.5, 39.2, -2.3, -0.1], ['hall', 0, -2.2, Math.PI, 0.05],
  ]));
  const confs = (process.env.GP_CONF || 'base').split(',');
  const N = +process.env.GP_N || 40, ROUNDS = +process.env.GP_ROUNDS || 3;
  const info = await page.evaluate((emu) => {
    const w = window.__app.world, gl = w.renderer.getContext();
    w.applySettings({ ...w.settings, graphics: { ...w.settings.graphics, quality: 'high', bloom: true, shadows: true, ssao: true, resolutionScale: 1, fov: 72, godrays: true } });
    const pr = emu[0] / innerWidth;
    w.renderer.setPixelRatio(pr); w.renderer.setSize(innerWidth, innerHeight, false); w.composer.setPixelRatio(pr); w.composer.setSize(innerWidth, innerHeight);
    // the drawing buffer at the size to measure (again after every applySettings: it sets the size from the window)
    const emuNow = () => { const pr = emu[0] / innerWidth; w.renderer.setPixelRatio(pr); w.renderer.setSize(innerWidth, innerHeight, false); w.composer.setPixelRatio(pr); w.composer.setSize(innerWidth, innerHeight); };
    const g = w.env.garden, N = (name) => { let u = null; w.scene.traverse((o) => { if (!u && o.isMesh && o.material?.userData?.nature) u = w.renderer.properties.get(o.material).uniforms?.[name] || null; }); return u; };
    const P = window.__gp = { w, g, conf: {}, uni: N, emu: emuNow };
    const hide = (names) => { const list = []; w.scene.traverse((o) => { if (names.includes(o.name) && o.visible) list.push(o); }); return { on() { for (const o of list) o.visible = false; }, off() { for (const o of list) o.visible = true; } }; };
    const lod = (near, far) => { const a = N('uLodNear'), b = N('uLodFar'); if (!a) return null; const keep = [a.value, b.value]; return { on() { a.value = near; b.value = far; g.lod.update(w.camera.position.x, w.camera.position.z); }, off() { a.value = keep[0]; b.value = keep[1]; g.lod.update(w.camera.position.x, w.camera.position.z); } }; };
    P.conf.base = { on() {}, off() {} };
    if (g.lilies) P.conf.nolilies = hide(['lily-pads', 'lily-flowers']);
    if (g.reeds) P.conf.noreeds = { on() { for (const e of g.reeds.meshes) { e.keep = e.mesh.count; e.mesh.count = 0; } }, off() { for (const e of g.reeds.meshes) e.mesh.count = e.keep; } };
    P.conf.lod40 = lod(40, 62); P.conf.lod35 = lod(35, 55);
    if (g.seasons) P.conf.autumn = { on() { w.applySettings({ ...w.settings, season: 'autumn' }); g.seasons.settle(); emuNow(); }, off() { w.applySettings({ ...w.settings, season: 'summer' }); g.seasons.settle(); emuNow(); } };
    if (w.fireBowl) { P.conf.fire = { on() { w.fireBowl.setBurning(true); w.fireBowl.settle(); }, off() { w.fireBowl.setBurning(null); w.fireBowl.settle(); } }; P.conf.nofire = { on() { w.fireBowl.setBurning(false); w.fireBowl.settle(); }, off() { w.fireBowl.setBurning(null); w.fireBowl.settle(); } }; }
    if (g.seasons) { w.applySettings({ ...w.settings, season: 'summer' }); g.seasons.settle(); }
    emuNow();
    return { size: [gl.drawingBufferWidth, gl.drawingBufferHeight], timer: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'), have: Object.keys(P.conf).filter((k) => P.conf[k]) };
  }, emu);
  console.log('INFO ' + JSON.stringify(info));
  const run = confs.filter((c) => info.have.includes(c));
  for (const [name, x, z, yaw, pitch] of views) {
    const all = Object.fromEntries(run.map((c) => [c, []]));
    let tris = {};
    for (let round = 0; round < ROUNDS; round++) for (const c of run) {
      const r = await page.evaluate(async ([c, x, z, yaw, pitch, N]) => {
        const P = window.__gp, { w } = P, gl = w.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'), p = w.player;
        p.transition = null; p.setPose(x, z, yaw, pitch);
        P.conf[c].on();
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const px = new Uint8Array(4);
        const frame = () => w.frame();
        for (let i = 0; i < 12; i++) { frame(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); await wait(3); }
        const t = [];
        for (let i = 0; i < N; i++) {
          const q = gl.createQuery();
          gl.beginQuery(ext.TIME_ELAPSED_EXT, q); frame(); gl.endQuery(ext.TIME_ELAPSED_EXT);
          let tries = 0; while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && tries++ < 300) await wait(2);
          if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) t.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(q);
        }
        const info = w.renderer.info; info.autoReset = false; info.reset(); frame(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const tris = info.render.triangles; info.autoReset = true;
        P.conf[c].off();
        return { t, tris };
      }, [c, x, z, yaw, pitch, N]);
      all[c].push(...r.t); tris[c] = r.tris;
    }
    const st = (a) => { const s = [...a].sort((x, y) => x - y), q = (f) => +(s[Math.min(s.length - 1, Math.floor(f * s.length))] || 0).toFixed(2); return { p10: q(0.1), p50: q(0.5), n: s.length }; };
    const line = run.map((c) => `${c}=${JSON.stringify({ ...st(all[c]), tris: tris[c] })}`).join(' ');
    console.log(`GPERF ${name} ${line}`);
  }
};
