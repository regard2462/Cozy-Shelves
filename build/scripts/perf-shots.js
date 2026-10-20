// Pictures of the world as it is drawn, made the same way every time (the performance strand of 0.9): the picture must
// stay the same when the drawing gets cheaper. Time stands still (dt 0, the world's clocks set to one moment, the wall
// clock at one time), the animals and the cat are off (their walks differ from run to run), the rays' jitter starts at
// the same frame, and the drawing buffer is read right after the frame. Per tier (high, medium, low), view and
// condition one PNG: SHOT_DIR/ps-<tier>-<view>-<cond>.png. build/scripts/perf-diff.js compares two folders.
//   node build/screenshot.js perf-shots     PS_TIERS=high,medium,low   PS_VIEWS=hall,room,shelves,terrace,jetty,glass
//   PS_CONDS=day,night,golden,rain,snow   (COZYSHELVES_QUERY=nopaint=1 keeps the paintings out: they are made by chance)
const fs = require('fs');
const path = require('path');
const png = require('./png-lite.js');

module.exports = async ({ app, page, sleep }) => {
  const W = +process.env.PERF_W || 1600, H = +process.env.PERF_H || 900;
  await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setContentSize(w, h); }, [W, H]);
  const outDir = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  fs.mkdirSync(outDir, { recursive: true });
  const tiers = (process.env.PS_TIERS || 'high,medium,low').split(',');
  const views = (process.env.PS_VIEWS || 'hall,room,shelves,terrace,jetty,glass').split(',');
  const conds = (process.env.PS_CONDS || 'day,night,golden,rain,snow').split(',');
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  let last = -1, quiet = 0;
  for (let i = 0; i < 300; i++) {
    const st = await page.evaluate(() => { const b = window.__app.state.library.books; return { n: b.length, idx: b.filter((x) => x.indexed).length, active: !!window.__app.state.library.scan?.active }; });
    if (st.n > 0 && st.idx === st.n && !st.active) { quiet = st.n === last ? quiet + 1 : 0; if (quiet >= 2) break; }
    last = st.n;
    await sleep(1500);
  }
  await sleep(12000);
  await page.evaluate(() => {
    const w = window.__app.world;
    w.stop(); window.__app.closeAllPanels(); document.querySelector('#hud')?.style.setProperty('opacity', '0');
    // time stands still: the clocks of the world at one moment, the wall clock at one time of day
    w.clock.getDelta = () => 0;
    const D = Date;
    window.Date = class extends D { constructor(...a) { super(...(a.length ? a : [1700000000000])); } static now() { return D.now(); } };
    w.fauna?.setEnabled(false); w.wildlife?.setEnabled(false); w.cat?.setEnabled(false);
    const P = window.__ps = { w };
    // (the fire's embers drift with the real time before this: hidden, as the animals are)
    if (w.fire) w.fire.embers.visible = false;
    P.still = () => {
      w.time = 100; w.exposureNow = null;
      if (w.env) { w.env.time = 100; for (const f of w.env.fires) f.t = 100; }
      if (w.fire) w.fire.t = 100;
      // the covers on the sides of the books: every fade finished (their clock far ahead of every start of a fade)
      if (w.books.sides) w.books.sides.time = 1e4;
    };
    /** The side covers at rest: nothing loading, waiting or ready for the card. */
    P.sidesIdle = () => { const s = w.books.sides; if (!s) return true; const i = s.info(); return !i.loading && !i.waiting && !s.done.length && !s.jobs.size && !s.queue.length; };
    P.size = () => ({ w: w.renderer.getContext().drawingBufferWidth, h: w.renderer.getContext().drawingBufferHeight });
  });
  const VIEWS = { hall: [0, 0, Math.PI / 2, 0], room: [0, -12, 0, 0], shelves: null, terrace: [0.6, 8.7, Math.PI + 0.15, 0.05], jetty: [-22, 37, 2.15, 0.02], glass: [0, -2.2, Math.PI, 0.05] };
  VIEWS.shelves = await page.evaluate(() => { const w = window.__app.world; const count = (bc) => bc.rows.reduce((a, r) => a + r.items.length, 0); const bc = [...w.layout.bookcases].sort((a, b) => count(b) - count(a))[0]; const fx = Math.sin(bc.rot), fz = Math.cos(bc.rot); return [bc.x + fx * 1.5, bc.z + fz * 1.5, Math.atan2(fx, fz), -0.05]; });
  const CONDS = { day: { hour: 11, weather: 'clear' }, night: { hour: 23, weather: 'clear' }, rain: { hour: 14, weather: 'rain' }, snow: { hour: 14, weather: 'snow' }, golden: { golden: true, weather: 'clear' } };
  const PLAN = { hall: ['day', 'night', 'golden'], room: ['day', 'night'], shelves: ['day'], terrace: ['day', 'night', 'rain', 'snow'], jetty: ['day', 'night', 'rain', 'snow', 'golden'], glass: ['day', 'golden'] };
  let count = 0;
  for (const tier of tiers) {
    await page.evaluate(([tier]) => { const w = window.__app.world; w.applySettings({ ...w.settings, graphics: { ...w.settings.graphics, quality: tier, bloom: true, shadows: true, ssao: true, resolutionScale: 1, fov: 72, godrays: true } }); }, [tier]);
    await sleep(800);
    for (const view of views) {
      for (const cond of PLAN[view].filter((c) => conds.includes(c))) {
        const c = CONDS[cond];
        const r = await page.evaluate(async ([c, pose]) => {
          const P = window.__ps, w = P.w, gl = w.renderer.getContext();
          const t = c.golden ? { timeMode: 'golden' } : { timeMode: 'fixed', fixedHour: c.hour };
          w.applySettings({ ...w.settings, weather: c.weather, ...t });
          // (a rebuild of the world since the start made a new cat: off again before every picture)
          w.fauna?.setEnabled(false); w.wildlife?.setEnabled(false); w.cat?.setEnabled(false);
          const p = w.player; if (w.actions.seatedId) w.actions.leaveSeat?.();
          p.transition = null; p.setPose(...pose);
          for (let i = 0; i < 40; i++) w.updateDoor(1);
          // the pictures and texts of the world finished and uploaded, the rays' history forgotten and begun again
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          for (let i = 0; i < 20; i++) { P.still(); w.frame(); await wait(16); }
          for (let k = 0; k < 200 && (w.pendingUploads?.length || w.books.coverStats.queued); k++) { P.still(); w.frame(); await wait(16); }
          for (let k = 0, idle = 0; k < 400 && idle < 6; k++) { idle = P.sidesIdle() ? idle + 1 : 0; P.still(); w.frame(); await wait(16); }
          w.godrays.settle(); w.godrays.pass.frame = 0; w.godrays.pass.invalidate();
          for (let i = 0; i < 4; i++) { P.still(); w.frame(); }
          const { w: W, h: H } = P.size();
          const buf = new Uint8Array(W * H * 4);
          gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          // (the rows bottom-up, as readPixels gives them: turned round here, alpha made opaque)
          const out = new Uint8Array(W * H * 4);
          for (let y = 0; y < H; y++) { const src = (H - 1 - y) * W * 4; out.set(buf.subarray(src, src + W * 4), y * W * 4); }
          for (let i = 3; i < out.length; i += 4) out[i] = 255;
          let bin = ''; const CH = 0x8000;
          for (let i = 0; i < out.length; i += CH) bin += String.fromCharCode.apply(null, out.subarray(i, Math.min(i + CH, out.length)));
          return { W, H, b64: btoa(bin), covers: w.books.coverStats.uploads, rays: w.godrays.active, programs: w.renderer.info.programs.length };
        }, [c, VIEWS[view]]);
        const data = Buffer.from(r.b64, 'base64');
        const file = path.join(outDir, `ps-${tier}-${view}-${cond}.png`);
        fs.writeFileSync(file, png.encode({ width: r.W, height: r.H, data }));
        count++;
        console.log(`SHOT ${tier} ${view} ${cond} ${r.W}x${r.H} covers=${r.covers} rays=${r.rays} programs=${r.programs}`);
      }
    }
  }
  console.log(`DONE ${count} pictures in ${outDir}`);
};
