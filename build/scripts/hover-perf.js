// Hovering books must never stutter. The world runs on real animation frames while the view sweeps across whole
// bookcases at about 1.5 m, row by row and back again, so the crosshair passes over a new book every few frames.
// Reports the frame intervals (requestAnimationFrame) and the CPU time of World#frame (p50/p95/p99/max, frames
// over 25 and 40 ms), the time the HUD needs for a new target (hud: the book card, the label), the two frames after every new card (cardFrames), long tasks, how many books were hovered, and whether shader programs or textures piled up.
// Two passes over the same cases: the first meets every cover for the first time, the second finds them cached.
// Run it twice with the same COZYSHELVES_USERDATA: the first run starts with an empty GPU cache (cold), the second
// is what a user sees from the second start on (warm).
// HP_CASES (default 6) cases, HP_SECONDS (default 4.5) seconds per case, HP_DIST (default 1.5 m); PERF_W / PERF_H.
module.exports = async ({ app, page, sleep, shot }) => {
  const W = +process.env.PERF_W || 1920, H = +process.env.PERF_H || 1080;
  const nCases = +process.env.HP_CASES || 6, secs = +process.env.HP_SECONDS || 4.5, dist = +process.env.HP_DIST || 1.5;
  await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setContentSize(w, h); }, [W, H]);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  // indexing finished and the debounced rebuild after the last library update has run
  let last = -1, quiet = 0;
  for (let i = 0; i < 400; i++) {
    const st = await page.evaluate(() => { const b = window.__app.state.library.books; return { n: b.length, idx: b.filter((x) => x.indexed).length, active: !!window.__app.state.library.scan?.active }; });
    if (st.n > 0 && st.idx === st.n && !st.active) { quiet = st.n === last ? quiet + 1 : 0; if (quiet >= 3) break; }
    last = st.n;
    await sleep(2000);
  }
  await sleep(10500);
  const info = await page.evaluate(() => {
    const w = window.__app.world, r = w.renderer, gl = r.getContext();
    let gpu = '';
    try { gpu = gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL); } catch {}
    return { gpu, size: [innerWidth, innerHeight], quality: w.quality, books: w.books.entries.size, cases: w.layout.bookcases.length, programs: r.info.programs?.length, textures: r.info.memory.textures };
  });
  console.log('INFO ' + JSON.stringify(info));

  // the cases with the most books, spread over the room
  const plan = await page.evaluate(([n, dist]) => {
    const w = window.__app.world;
    const count = (bc) => bc.rows.reduce((a, r) => a + r.items.length, 0);
    const cases = w.layout.bookcases.filter((bc) => count(bc) >= 12).sort((a, b) => count(b) - count(a));
    const picked = [];
    for (const bc of cases) { if (picked.length >= n) break; if (picked.every((p) => Math.hypot(p.x - bc.x, p.z - bc.z) > 2.4)) picked.push(bc); }
    for (const bc of cases) { if (picked.length >= n) break; if (!picked.includes(bc)) picked.push(bc); }
    return picked.map((bc) => {
      const fx = Math.sin(bc.rot), fz = Math.cos(bc.rot);                     // the case's front normal
      return { id: bc.id, books: count(bc), x: bc.x + fx * dist, z: bc.z + fz * dist, cx: bc.x, cz: bc.z, fx, fz, rows: bc.rows.filter((r) => r.items.length).map((r) => r.y) };
    });
  }, [nCases, dist]);
  console.log('PLAN ' + JSON.stringify(plan.map((p) => [p.id, p.books, +p.x.toFixed(2), +p.z.toFixed(2)])));

  const stats = (a) => { const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))] || 0; return { n: s.length, p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +q(1).toFixed(2), over25: s.filter((x) => x > 25).length, over40: s.filter((x) => x > 40).length }; };
  // HP_NOHUD=1: no book card on the right (tells the 3D costs from those of the HUD)
  if (process.env.HP_NOHUD) await page.evaluate(() => { window.__app.world.opts.onTarget = () => {}; });
  const passes = [];
  for (const pass of ['first', 'second']) {
    const r = await page.evaluate(async ([plan, secs]) => {
      const w = window.__app.world;
      const EYE = 1.62;
      const P = { frames: [], frameAt: [], frameIdx: [], cpu: [], parts: [], long: [], rebuilds: 0, targets: 0, distinct: new Set(), programs0: w.renderer.info.programs?.length || 0, textures0: w.renderer.info.memory.textures };
      // where the CPU time of a frame goes: the steps of World#frame, measured one by one
      let cur = null;
      const wraps = [];
      const wrap = (obj, key, name) => { if (!obj || typeof obj[key] !== 'function') return; const f = obj[key]; obj[key] = function (...a) { const t = performance.now(); const res = f.apply(this, a); if (cur) cur[name] = (cur[name] || 0) + performance.now() - t; return res; }; wraps.push(() => { obj[key] = f; }); };
      wrap(w.player, 'update', 'player'); wrap(w.env, 'update', 'env'); wrap(w.books, 'update', 'books'); wrap(w.actions, 'update', 'actions');
      wrap(w.cat, 'update', 'cat'); wrap(w.cinema, 'update', 'cinema'); wrap(w.composer, 'render', 'render'); wrap(w.opts, 'onTarget', 'hud');
      const orig = w.frame;
      w.frame = function () { cur = {}; const a = performance.now(); const res = orig.call(this); const d = performance.now() - a; P.cpu.push(d); cur.total = d; P.parts.push(cur); cur = null; return res; };
      // rebuilds during the sweep (a library update) would show up as long frames that have nothing to do with hovering
      const ob = w.build, orf = w.refreshShelves;
      w.build = function (...a) { P.rebuilds++; return ob.apply(this, a); };
      w.refreshShelves = function (...a) { P.rebuilds++; return orf.apply(this, a); };
      P.t0 = performance.now();
      // the moments a book card goes in (hud.js swaps the card once its cover is decoded): the frames right after
      // them are the ones that show a new card
      P.cards = [];
      const cardObs = new MutationObserver(() => P.cards.push(performance.now()));
      const peekEl = document.querySelector('#book-peek');
      if (peekEl) cardObs.observe(peekEl, { childList: true });
      let obs = null;
      try { obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) P.long.push([Math.round(e.startTime - P.t0), Math.round(e.duration)]); }); obs.observe({ type: 'longtask', buffered: false }); } catch {}
      if (w.actions.seatedId) w.actions.leaveSeat();
      for (const c of plan) {
        w.player.transition = null;
        w.player.setPose(c.x, c.z, Math.atan2(c.fx, c.fz), 0);
        const rows = c.rows.length ? c.rows : [1.34];
        const right = { x: c.fz, z: -c.fx };     // along the case, seen from the front: to the right
        await new Promise((resolve) => {
          let t0 = null, lastT = null, lastId;
          const step = (t) => {
            if (t0 == null) { t0 = t; lastT = t; }
            else { P.frames.push(t - lastT); P.frameAt.push(t); P.frameIdx.push(P.parts.length - 1); lastT = t; }
            const e = (t - t0) / 1000;
            if (e >= secs) { resolve(); return; }
            // row by row, left to right and back (a zigzag), then a fast diagonal pass over the whole case
            const slice = secs / (rows.length + 1);
            const k = Math.floor(e / slice), u = (e % slice) / slice;
            let along, y;
            if (k < rows.length) { along = (k % 2 ? 0.5 - u : u - 0.5) * 1.08; y = rows[k] + 0.12; }
            else { along = (Math.sin(u * Math.PI * 4) * 0.5) * 1.08; y = rows[0] + 0.12 + (rows[rows.length - 1] - rows[0]) * u; }
            const px = c.cx + right.x * along + c.fx * 0.2, pz = c.cz + right.z * along + c.fz * 0.2;
            const dx = px - w.player.position.x, dz = pz - w.player.position.z, dy = y - EYE;
            w.player.yaw = Math.atan2(-dx, -dz); w.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
            const id = w.actions.target?.book?.id || null;
            if (id !== lastId) { if (id) { P.targets++; P.distinct.add(id); } lastId = id; }
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });
      }
      w.frame = orig; delete w.build; delete w.refreshShelves;
      for (const un of wraps) un();
      obs?.disconnect(); cardObs.disconnect();
      const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v.toFixed(1)]));
      const slowCpu = P.parts.map((x, i) => [i, x]).sort((a, b) => b[1].total - a[1].total).slice(0, 4).map(([, x]) => round(x));
      // the slowest frame intervals: when, how long, and what World#frame did in that frame
      // the two frame intervals after each new card
      const cardFrames = [];
      for (const t of P.cards) { const i = P.frameAt.findIndex((x) => x > t); if (i >= 0) { cardFrames.push(P.frames[i]); if (i + 1 < P.frames.length) cardFrames.push(P.frames[i + 1]); } }
      const slow = P.frameAt.map((t, i) => [Math.round(t - P.t0), +P.frames[i].toFixed(1), P.parts[P.frameIdx[i]] ? round(P.parts[P.frameIdx[i]]) : null]).sort((a, b) => b[1] - a[1]).slice(0, 4);
      return { covers: w.books.coverStats, frames: P.frames, cpu: P.cpu, hud: P.parts.map((x) => x.hud).filter((v) => v != null), cardFrames, cards: P.cards.length, long: P.long, slow, slowCpu, rebuilds: P.rebuilds, targets: P.targets, distinct: P.distinct.size, programs: [P.programs0, w.renderer.info.programs?.length || 0], textures: [P.textures0, w.renderer.info.memory.textures] };
    }, [plan, secs]);
    const cs = r.covers || {};
    const line = { pass, covers: { uploads: cs.uploads, uploadAvg: +(cs.ms / Math.max(1, cs.uploads)).toFixed(2), uploadMax: +(cs.max || 0).toFixed(2), typo: cs.typo, typoAvg: +(cs.typoMs / Math.max(1, cs.typo)).toFixed(2), typoMax: +(cs.typoMax || 0).toFixed(2) }, frame: stats(r.frames), cpu: stats(r.cpu), hud: stats(r.hud), cards: r.cards, cardFrames: stats(r.cardFrames), longTasks: r.long.length, long: r.long.slice(0, 6), slowest: r.slow, slowCpu: r.slowCpu, rebuilds: r.rebuilds, hovers: r.targets, distinctBooks: r.distinct, programs: r.programs, textures: r.textures };
    passes.push(line);
    console.log('HOVERPERF ' + JSON.stringify(line));
    if (process.env.HP_SHOT) await shot('hover-perf-' + pass);
  }
  console.log('ERRORS ' + JSON.stringify(errors.slice(0, 10)));
};
