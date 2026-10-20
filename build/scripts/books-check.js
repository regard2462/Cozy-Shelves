// Books in the book room. All departments stand along the walls at once (a library too big for the walls shows one
// department at a time): the layout rules (every department on consecutive cases in reading order, starting on a case of
// its own, every shelf on a new row, no empty case, the world-map wall free, a sign above every run), rebuild timing,
// close-ups (rows, a whole case, the signs, the directory in the passage, the recently-read case, the display table),
// the hover (the book comes out and turns its cover towards the viewer, from the front and from the side; since 0.7.2
// the turn stops short so that the spine stays in view, the book takes the proportions of its cover picture and shows
// it whole, the page block is paper; stable targets while sweeping along a row) and the recommendations (face-out
// copies and the display table: only real covers, must-read books first).
// the wheel walks to a department and stays legible with a dozen and more.
// "Abteilung ändern" in the book card moves a book into another folder department.
// BOOKS_PARTS=layout,perf,shots,hover,wheel,manual,picks (default: all); SHOT_TAG prefixes the screenshot names.
module.exports = async ({ page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || 'bk';
  const parts = (process.env.BOOKS_PARTS || 'layout,perf,shots,hover,wheel,manual,picks').split(',');
  const log = (k, v) => console.log(k + ' ' + JSON.stringify(v));
  const errors = [];
  let failures = 0;
  const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); if (!ok) failures++; };
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });

  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  // indexing finished and the debounced rebuild after the last library update has run
  let last = -1, quiet = 0;
  for (let i = 0; i < 400; i++) {
    const st = await page.evaluate(() => { const b = window.__app.state.library.books; return { n: b.length, idx: b.filter((x) => x.indexed).length }; });
    if (st.n > 0 && st.idx === st.n) { quiet = st.n === last ? quiet + 1 : 0; if (quiet >= 4) break; }
    last = st.n;
    await sleep(2500);
  }
  await sleep(10500);
  // the indexer's stand-in title cards (core/cover-art.js) do not count as covers: since 0.4 the record says so,
  // older records are told by the grounds of the gilt cards from before (the same rule as world/book-art.js)
  const GENERATED = ['#5b2a2a', '#1f3a4d', '#2f4a2e', '#4a3b6b', '#6b3d1f', '#2a2a2a', '#7a2f3f', '#245c5a', '#8a5a1e', '#3b3b5c', '#5c4a2b', '#1c4d3a'];
  await page.evaluate((g) => {
    const standIn = (b) => b.coverGenerated === true || (b.coverGenerated === undefined && g.includes(String(b.coverColor || '').toLowerCase()));
    window.__realCover = (b) => !!b && b.hasCover !== false && !standIn(b);
  }, GENERATED);
  const info = await page.evaluate(() => {
    const w = window.__app.world;
    const books = window.__app.state.library.books;
    return {
      books: books.length, realCover: books.filter(window.__realCover).length, mustRead: books.filter((b) => b.mustRead).length,
      all: w.layout.allDepartments, placed: w.books.entries.size, cases: w.layout.bookcases.length, signs: (w.layout.signs || []).length,
      deps: (w.layout.departments || []).map((d) => d.name + ':' + d.count),
    };
  });
  log('LIB', info);
  // (a library too large for the walls shows one department at a time: fallback-check tests that room; this check
  // expects a library whose departments all fit)
  if (!info.all) console.log('NOTE the library does not fit the walls: the room shows one department at a time, run this check with a smaller library');

  const settle = async (n = 8) => { for (let i = 0; i < n; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(40); } };
  const pose = async (x, z, yaw, pitch) => page.evaluate(([x, z, yaw, pitch]) => { const w = window.__app.world; if (w.actions.seatedId) w.actions.leaveSeat(); w.player.transition = null; w.player.setPose(x, z, yaw, pitch); w.frame(); }, [x, z, yaw, pitch]);

  // ------------------------------------------------------------------ layout rules ----
  if (parts.includes('layout')) {
    const L = await page.evaluate(() => {
      const w = window.__app.world, L = w.layout;
      const deps = (L.departments || []).filter((d) => d.count > 0);
      const cases = L.bookcases.filter((b) => !b.recent && !b.read);   // (the cases "Zuletzt gelesen" and "Gelesen" have no department)
      const books = new Set(), dup = [];
      for (const bc of L.bookcases) for (const r of bc.rows) for (const it of r.items) { if (books.has(it.id)) dup.push(it.id); books.add(it.id); }
      const runs = L.departmentRuns || [];
      // a department's cases one after the other in the order of the room, nobody else's case in between
      const pos = new Map(cases.map((c, i) => [c.id, i]));
      const mixed = runs.filter((r) => r.cases.some((id, i) => i && pos.get(id) !== pos.get(r.cases[i - 1]) + 1)).map((r) => r.name);
      // every shelf starts on a new row: a row holds books of one shelf only
      const shelfOf = {}; for (const d of deps) for (const s of d.shelves) for (const id of s.bookIds) shelfOf[id] = d.id + '/' + (s.neutral ? '' : s.name);
      const rowsMixed = [];
      for (const bc of cases) for (const r of bc.rows) { const s = new Set(r.items.map((it) => shelfOf[it.id])); if (s.size > 1) rowsMixed.push(bc.id + ':' + r.level); }
      const empty = cases.filter((b) => b.rows.every((r) => !r.items.length)).map((b) => b.id);
      const mapZone = cases.filter((b) => b.wall === 'back' && b.x + 0.63 > -8.6 && b.x - 0.63 < -3.6).map((b) => b.id);
      const rc = L.bookcases.find((b) => b.recent);
      const signsOk = runs.every((r) => (L.signs || []).filter((s) => s.dep === r.id).length === r.parts.length);
      const decor = [];
      // the decoration books had the spine material of shelf-decor.js ('decor-spine'): none may be left
      w.shelfGroup?.traverse((o) => { if (o.userData?.decor) for (const m of [o.material].flat()) { const k = m.customProgramCacheKey?.(); if (/decor-spine/.test(k || '')) decor.push(k); } });
      const worldmap = L.placements.filter((p) => p.kind === 'worldmap').map((p) => [p.x, +p.z.toFixed(2), p.opts, p.meta.y, p.meta.standAt]);
      // the wall behind the map's frame (layout.js MAP_FRAME): no sign, no picture, no panelling; the skirting runs on
      const back = (z) => z < -23.0, onMap = (a, b) => b > -7.95 && a < -4.25;
      const mapWall = {
        signs: (L.signs || []).filter((sg) => back(sg.z) && onMap(sg.x - sg.maxW / 2, sg.x + sg.maxW / 2)).length,
        paintings: L.placements.filter((p) => p.kind === 'painting' && back(p.z) && onMap(p.x - p.opts.w / 2, p.x + p.opts.w / 2)).length,
        panelling: L.trim.filter((t) => t.axis === 'x' && back(t.at) && !t.corniceOnly && !t.skirtOnly && onMap(t.mid - t.len / 2, t.mid + t.len / 2)).length,
        skirting: L.trim.filter((t) => t.axis === 'x' && back(t.at) && t.skirtOnly && onMap(t.mid - t.len / 2, t.mid + t.len / 2)).length,
      };
      return {
        all: L.allDepartments, deps: deps.length, runs: runs.length, order: runs.map((r) => r.name), depOrder: deps.map((d) => d.name),
        placed: books.size, total: deps.reduce((a, d) => a + d.count, 0), recent: rc?.rows.reduce((a, r) => a + r.items.length, 0),
        dup: dup.length, mixed, rowsMixed, empty, emptyRows: cases.reduce((a, b) => a + b.rows.filter((r) => !r.items.length).length, 0), hidden: L.hidden?.size || 0,
        mapZone, mapWall, recentCase: rc && [+rc.x.toFixed(2), +rc.z.toFixed(2)], signsOk, decor, worldmap,
        runsAt: runs.map((r) => r.name + ':' + r.cases.map((c) => c.replace('room:', '')).join(',')),
        uncased: cases.filter((b) => !b.dep).length,
        lamps: L.placements.filter((p) => p.kind === 'floorlamp' && p.z < -9.2).length, globes: L.placements.filter((p) => p.kind === 'globe').length,
        rugs: L.placements.filter((p) => p.kind === 'rug' && p.z < -9.2).map((p) => [p.x, p.z, p.opts.w, p.opts.d]),
        paintings: L.placements.filter((p) => p.kind === 'painting' && p.z < -9.2).length,
      };
    });
    log('LAYOUT', L);
    check('all departments stand in the room', L.all && L.runs === L.deps, { all: L.all, runs: L.runs, deps: L.deps });
    check('the departments follow the library order', JSON.stringify(L.order) === JSON.stringify(L.depOrder), L.order);
    // a book that exists twice stands once (0.7: "Doppelte Bücher nur einmal ins Regal stellen", layout.js hidden)
    check('every book stands once (the recently-read ones on their own case)', L.dup === 0 && L.placed + L.hidden === L.total, { dup: L.dup, placed: L.placed, hidden: L.hidden, total: L.total, recent: L.recent });
    check('a department on consecutive cases, never mixed with another', !L.mixed.length && !L.uncased, L.mixed);
    check('a row holds one shelf only (every shelf starts on a new row)', !L.rowsMixed.length, L.rowsMixed.slice(0, 5));
    check('no empty case', !L.empty.length, L.empty);
    check('the world-map wall is free of cases, the placement is there', !L.mapZone.length && L.worldmap.length === 1, { cases: L.mapZone, worldmap: L.worldmap });
    check('behind the map: no sign, picture or panelling, the skirting runs on', !L.mapWall.signs && !L.mapWall.paintings && !L.mapWall.panelling && L.mapWall.skirting === 1, L.mapWall);
    check('a sign above every part of every run', L.signsOk);
    check('no decoration books: only plants, vases and photos', !L.decor.length, L.decor);
    check('no floor lamps and no globe in the book room', !L.lamps && !L.globes, { lamps: L.lamps, globes: L.globes });
    check('rugs do not overlap', L.rugs.every((a, i) => L.rugs.every((b, j) => i >= j || Math.abs(a[0] - b[0]) * 2 >= a[2] + b[2] || Math.abs(a[1] - b[1]) * 2 >= a[3] + b[3])), L.rugs);
  }

  // ------------------------------------------------------------------ rebuild timing ----
  if (parts.includes('perf')) {
    const perf = await page.evaluate(async () => {
      const w = window.__app.world;
      const T = { build: [], books: [], shelves: [] };
      let tb = 0;
      const orig = w.books.build;
      w.books.build = function (...a) { const t = performance.now(); const r = orig.apply(this, a); tb = performance.now() - t; return r; };
      const pause = () => new Promise((r) => setTimeout(r, 120));
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        w.build(w.library, {});
        T.build.push(+(performance.now() - t0).toFixed(1)); T.books.push(+tb.toFixed(1));
        await pause();
      }
      // the recently-read case changes after reading: only the shelves are rebuilt
      const ids = [...w.books.entries.keys()];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        const ok = w.refreshShelves({ recent: ids.slice(i * 3, i * 3 + 4) });
        T.shelves.push([ok, +(performance.now() - t0).toFixed(1)]);
        await pause();
      }
      w.refreshShelves({ recent: [] });
      delete w.books.build;
      const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
      return { ...T, median: { build: med(T.build), books: med(T.books), shelves: med(T.shelves.map((x) => x[1])) } };
    });
    log('PERF', perf);
    check('reading a book only rebuilds the shelves (the cases stay where they are)', perf.shelves.every((x) => x[0]), perf.shelves);
  }

  // ------------------------------------------------------------------ screenshots ----
  if (parts.includes('shots')) {
    await page.evaluate(() => {
      const w = window.__app.world;
      const books = window.__app.state.library.books;
      w.setRecent([...books.filter(window.__realCover).slice(0, 3), ...books.filter((b) => !window.__realCover(b)).slice(0, 9)].map((b) => b.id));
    });
    const views = await page.evaluate(() => {
      const w = window.__app.world, L = w.layout;
      const out = [];
      const EYE = 1.62;
      const cases = L.bookcases.filter((b) => !b.recent && b.rows.some((r) => r.items.length));
      const front = (e, dist, dx = 0) => {
        const right = { x: e.forward.z, z: -e.forward.x };
        return { x: e.pos.x + e.forward.x * dist + right.x * dx, z: e.pos.z + e.forward.z * dist + right.z * dx, yaw: Math.atan2(e.forward.x, e.forward.z) };
      };
      for (const [ci, bc] of [cases[2], cases[Math.floor(cases.length / 2)]].filter(Boolean).entries()) {
        for (const row of bc.rows) {
          if (!row.items.length) continue;
          const mid = row.items[Math.floor(row.items.length / 2)];
          const e = w.books.entry(mid.id); if (!e) continue;
          const p = front(e, 0.85);
          out.push([`shelf${ci}-r${row.level}`, p.x, p.z, p.yaw, Math.atan2(e.pos.y - EYE, 0.85)]);
        }
      }
      const bc0 = cases[2] || cases[0];
      if (bc0) {
        const fx = Math.sin(bc0.rot), fz = Math.cos(bc0.rot);
        out.push(['case', bc0.x + fx * 1.35, bc0.z + fz * 1.35, Math.atan2(fx, fz), 0.02]);
        out.push(['wall', bc0.x + fx * 3.6 + fz * 0.8, bc0.z + fz * 3.6 - fx * 0.8, Math.atan2(fx, fz) - 0.2, 0.12]);
        out.push(['sign', bc0.x + fx * 2.2, bc0.z + fz * 2.2, Math.atan2(fx, fz), 0.42]);
      }
      const d = L.directory;
      if (d) out.push(['directory', d.x + Math.sin(d.rot) * 1.6, d.z + Math.cos(d.rot) * 1.6, d.rot, -0.05]);
      const p = w.places.find((x) => x.id === 'recent');
      if (p) out.push(['recent', p.x, p.z + 0.35, p.yaw, -0.08]);
      const t = w.displayTable?.obj;
      if (t) out.push(['table', t.position.x, t.position.z + 1.25, 0, -0.62]);
      out.push(['room', 0, -10.2, 0, 0.02]);
      out.push(['room-back', 0, -21.2, Math.PI, 0.04]);
      return out;
    });
    for (const [name, x, z, yaw, pitch] of views) {
      await pose(x, z, yaw, pitch);
      await settle(10);
      await shot(`${tag}-${name}`);
    }
    // hover: a book with a real cover and one without (hasCover === false); from the front, from the side and, as a
    // visitor looking along a shelf (the user's picture of 0.7.1), from well to the side and close ('hover-along')
    // ('hover-low': a book of a lower row seen from standing height, the head of its page block in view)
    for (const [name, noCover, side, dist, low] of [['hover', false, 0, 1.0], ['hover-side', false, 0.7, 1.0], ['hover-along', false, 1.0, 0.85], ['hover-low', false, 0.3, 0.9, true], ['hover-nocover', true, 0.25, 1.0]]) {
      const r = await page.evaluate(([noCover, side, dist, low]) => {
        const w = window.__app.world;
        const list = [...w.books.entries.values()].filter((x) => !x.hidden && !x.bookcase.y && (low ? x.pos.y > 0.5 && x.pos.y < 1.15 : x.pos.y > 1.3 && x.pos.y < 1.9) && (noCover || window.__realCover(x.book)));
        const e = list[noCover ? Math.floor(list.length / 2) : Math.floor(list.length / 3)] || [...w.books.entries.values()][0];
        if (!e) return null;
        if (noCover) { e.book.hasCover = false; if (w.booksById[e.book.id]) w.booksById[e.book.id].hasCover = false; }
        const right = { x: e.forward.z, z: -e.forward.x };
        const p = e.pos.clone().addScaledVector(e.forward, dist); p.x -= right.x * side; p.z -= right.z * side;
        w.player.transition = null; w.player.setPose(p.x, p.z, 0, 0);
        w.player.update(0.016); w.camera.updateMatrixWorld();
        const spine = e.pos.clone().addScaledVector(e.forward, e.d / 2 - 0.004);
        const dir = spine.sub(w.camera.position).normalize();
        w.player.yaw = Math.atan2(-dir.x, -dir.z); w.player.pitch = Math.asin(dir.y);
        w.frame(); w.actions.rayTimer = 0; w.actions.update(0.01);
        window.__hovered = e;
        return { id: e.book.id, title: e.book.title, y: +e.pos.y.toFixed(2), target: w.actions.target?.book?.id === e.book.id };
      }, [noCover, side, dist, low]);
      // (the book is out after 0.37 s; the cover arrives meanwhile and the width follows it within a few more frames)
      for (let i = 0; i < 24; i++) { await page.evaluate(() => { const w = window.__app.world; w.books.update(0.05, w.camera); w.frame(); }); await sleep(50); }
      const facing = await page.evaluate(() => {
        // the book that is out (from the side the ray may meet the neighbour first: then that one comes out)
        const w = window.__app.world, e = w.books.hoverEntry, m = w.books.hoverMesh;
        if (!m || !e) return { mesh: false };
        const V = m.position.constructor;
        const front = new V(1, 0, 0).applyQuaternion(m.quaternion), spine = new V(0, 0, 1).applyQuaternion(m.quaternion);
        const toCam = w.camera.position.clone().sub(m.position).normalize();
        const out = m.position.clone().sub(e.pos).dot(e.forward);
        const map = m.material[0].map;
        return { mesh: true, same: e === window.__hovered, cos: +front.dot(toCam).toFixed(3), deg: +(Math.acos(Math.min(1, front.dot(toCam))) * 180 / Math.PI).toFixed(1), spineCos: +spine.dot(toCam).toFixed(3), pulled: +out.toFixed(3), clear: out > e.d / 2 + 0.03, typo: !!m.userData.typoCover, frontMap: !!map?.image && (map.image.width || 0) > 1, width: +m.scale.z.toFixed(4), shelfWidth: +e.d.toFixed(4) };
      });
      log('HOVERSHOT', { name, ...r, ...facing });
      // (0.7.2) the front turns towards the camera and stops some 18° short of facing it (TURN_SHORT), the spine in view
      check(`hover ${name}: the book is out of the shelf, its front turned towards the camera, 14 to 23° short of facing it, the spine in view`, facing.mesh && facing.deg >= 14 && facing.deg <= 23 && facing.spineCos > 0.05 && facing.clear && facing.frontMap && (facing.same || side > 0), facing);
      await shot(`${tag}-${name}`);
    }
  }

  // ------------------------------------------------------------------ hover stability ----
  if (parts.includes('hover')) {
    await page.evaluate(() => {
      const w = window.__app.world;
      const n = (b) => b.rows.reduce((a, r) => a + r.items.length, 0);
      window.__hoverCase = [...w.layout.bookcases].filter((b) => !b.recent).sort((a, b) => n(b) - n(a))[0];
      window.__hoverRows = window.__hoverCase.rows.filter((r) => r.items.length >= 4);
    });
    const aims = await page.evaluate(() => window.__hoverRows.map((r) => r.items[Math.floor(r.items.length / 3)].id));
    const stability = [];
    for (const [id, side] of [...aims.map((id) => [id, 0]), ...aims.map((id) => [id, 0.45])]) {
      // straight in front, and from the side (there the crosshair may rest on the neighbour: it has to stay there)
      const want = await page.evaluate(([id, side]) => {
        const w = window.__app.world; const e = w.books.entry(id);
        const right = { x: e.forward.z, z: -e.forward.x };
        const p = e.pos.clone().addScaledVector(e.forward, 0.8); p.x -= right.x * side; p.z -= right.z * side;
        w.player.transition = null; w.player.setPose(p.x, p.z, 0, 0); w.player.update(0.016); w.camera.updateMatrixWorld();
        const dir = e.pos.clone().addScaledVector(e.forward, e.d / 2 - 0.004).sub(w.camera.position).normalize();
        w.player.yaw = Math.atan2(-dir.x, -dir.z); w.player.pitch = Math.asin(dir.y);
        w.frame(); w.actions.rayTimer = 0; w.actions.update(0);
        return w.actions.target?.book?.id || null;
      }, [id, side]);
      const seq = [];
      for (let i = 0; i < 70; i++) {
        seq.push(await page.evaluate(() => { const w = window.__app.world; w.frame(); return w.actions.target?.book?.id || null; }));
        await sleep(25);
      }
      const changes = seq.filter((x, i) => i > 0 && x !== seq[i - 1]).length;
      stability.push({ id, side, first: side ? !!want : seq[0] === id, allSame: seq.every((x) => x === seq[0]), changes, distinct: [...new Set(seq)].length });
    }
    log('HOVER-STABLE', stability);
    check('aiming at a book keeps it (no flicker while it comes out and turns)', stability.every((s) => s.first && s.allSame), stability);

    // slow sweeps across a row: the target may only move on along the shelf, never back
    const sweeps = [];
    for (const [rowPick, dist] of [[0, 0.8], [1, 0.8], [1, 1.4]]) {
      const setup = await page.evaluate(([rowPick, dist]) => {
        const w = window.__app.world;
        const rows = window.__hoverRows;
        const row = rows[Math.min(rowPick, rows.length - 1)];
        const a = w.books.entry(row.items[0].id), b = w.books.entry(row.items[row.items.length - 1].id);
        const mid = a.pos.clone().lerp(b.pos, 0.5);
        const p = mid.clone().addScaledVector(a.forward, dist);
        const yaw0 = Math.atan2(a.forward.x, a.forward.z);
        const half = Math.atan2(a.pos.distanceTo(b.pos) / 2, dist) * 0.9;
        const order = Object.fromEntries(row.items.map((it, i) => [it.id, i]));
        return { x: p.x, z: p.z, yaw0, half, pitch: Math.atan2(mid.y - 1.62, dist), order };
      }, [rowPick, dist]);
      const seq = [];
      const N = 90;
      for (let i = 0; i <= N; i++) {
        const yaw = setup.yaw0 + setup.half - (2 * setup.half * i) / N;
        seq.push(await page.evaluate(([x, z, yaw, pitch]) => { const w = window.__app.world; w.player.transition = null; w.player.setPose(x, z, yaw, pitch); w.frame(); w.actions.rayTimer = 0; w.actions.update(0); return w.actions.target?.book?.id || null; }, [setup.x, setup.z, yaw, setup.pitch]));
        await sleep(20);
      }
      const runs = seq.filter((x, i) => x && x !== seq[i - 1]);
      const idx = runs.map((id) => setup.order[id] ?? -1);
      let back = 0; for (let i = 1; i < idx.length; i++) if (idx[i] < idx[i - 1]) back++;
      const revisit = runs.length - new Set(runs).size;
      sweeps.push({ row: rowPick, dist, steps: N + 1, books: runs.length, backwards: back, revisits: revisit, foreign: idx.filter((v) => v < 0).length });
    }
    log('HOVER-SWEEP', sweeps);
    check('sweeping along a row: the target only moves on', sweeps.every((s) => s.books > 3 && s.backwards === 0 && s.revisits === 0), sweeps);

    // face-out copies and the display table: aim at them and stay
    const other = await page.evaluate(async () => {
      const w = window.__app.world;
      const res = [];
      const probe = (mesh, from) => {
        w.player.transition = null;
        w.player.setPose(from.x, from.z, 0, 0);
        w.player.update(0.016); w.camera.updateMatrixWorld();
        const c = mesh.getWorldPosition(mesh.position.clone());
        const dir = c.clone().sub(w.camera.position).normalize();
        w.player.yaw = Math.atan2(-dir.x, -dir.z); w.player.pitch = Math.asin(dir.y);
        const ids = [];
        for (let i = 0; i < 40; i++) { w.player.update(0.016); w.camera.updateMatrixWorld(); w.actions.rayTimer = 0; w.actions.update(0.02); w.books.update(0.02, w.camera); ids.push(w.actions.target?.book?.id || null); }
        return { want: mesh.userData.displayBook, hit: ids[0] === mesh.userData.displayBook, stable: ids.every((x) => x === ids[0]) };
      };
      const d = w.books.displayMeshes[0];
      if (d) { const c = d.getWorldPosition(d.position.clone()); const n = w.books.entry(d.userData.displayBook)?.forward || { x: 0, z: 1 }; res.push(['display', probe(d, { x: c.x + n.x * 1.0, z: c.z + n.z * 1.0 })]); }
      const t = (w.books.tableDisplay || [])[1];
      if (t) { const c = t.getWorldPosition(t.position.clone()); res.push(['table', probe(t, { x: c.x, z: c.z + 0.9 })]); }
      return res;
    });
    log('HOVER-OTHER', other);
    check('face-out copies and table books can be aimed at', other.every(([, r]) => r.hit && r.stable), other);

    // (0.7.2) the pulled-out book as a solid book: the whole cover on a face of the picture's proportions (the width
    // coming with the turn, after the fore edge is clear of the case, back on the way in), the turn stopping short of
    // the camera with the spine in view, the page block of paper on the spine's shader program. Stepped by hand with a
    // fixed dt (the world loop rests in this check), waiting for the cover and the slot, never for a fixed time.
    const solid = await page.evaluate(async () => {
      const w = window.__app.world, r = w.renderer, V = w.camera.position.constructor;
      const list = [...w.books.entries.values()].filter((e) => !e.hidden && e.pos.y > 1.2 && e.pos.y < 1.9 && !e.bookcase.y && window.__realCover(e.book));
      const e = list[Math.floor(list.length / 4)]; if (!e) return null;
      const right = new V(e.forward.z, 0, -e.forward.x);
      const p = e.pos.clone().addScaledVector(e.forward, 1.0).addScaledVector(right, -0.3);   // 1 m in front, a little to the side
      w.player.transition = null; w.player.setPose(p.x, p.z, 0, 0); w.player.update(0.016); w.camera.updateMatrixWorld();
      const dir = e.pos.clone().addScaledVector(e.forward, e.d / 2).sub(w.camera.position).normalize();
      w.player.yaw = Math.atan2(-dir.x, -dir.z); w.player.pitch = Math.asin(dir.y); w.player.update(0.016); w.camera.updateMatrixWorld();
      w.actions.rayTimer = 1e9; w.books.setHover(null);
      for (let i = 0; i < 200 && w.books.slots.some((s) => s.entry); i++) w.books.update(1 / 30, w.camera);
      w.frame();
      const programs0 = r.info.programs.length;
      const dt = 1 / 60, tick = () => new Promise((res) => setTimeout(res, 0));
      const slotOf = () => w.books.slots.find((s) => s.entry === e);
      const corners = (m) => { m.updateMatrixWorld(true); const out = []; for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) { const c = new V(sx, sy, sz).applyMatrix4(m.matrixWorld).sub(e.pos); out.push({ depth: c.dot(e.forward), x: c.dot(right) }); } return out; };
      // every step: a corner inside the row (not past the spine plane at d/2) stays within the book's own slot, and the
      // width differs from the shelf's only once the whole book is clear of the case
      let intoNeighbour = 0, widenedInside = 0, maxInsideX = 0, steps = 0, coverAt = null, outAt = null;
      const trace = (m) => { const cs = corners(m); const minDepth = Math.min(...cs.map((c) => c.depth)); for (const c of cs) if (c.depth < e.d / 2 + 0.001) { maxInsideX = Math.max(maxInsideX, Math.abs(c.x) - e.w / 2); if (Math.abs(c.x) > e.w / 2 + 0.003) intoNeighbour++; } if (Math.abs(m.scale.z - e.d) > 1e-4 && minDepth < e.d / 2 + 0.01) widenedInside++; };
      w.books.setHover(e);
      let fin = null;
      for (steps = 0; steps < 900 && !fin; steps++) {
        w.books.update(dt, w.camera);
        const s = slotOf(); if (!s || !s.mesh.visible) { await tick(); continue; }
        trace(s.mesh);
        if (coverAt == null && s.kind === 'cover') coverAt = steps;
        if (outAt == null && s.t >= 1) outAt = steps;
        // out, the cover on, the width settled, and 40 more steps for the turn to settle
        if (s.t >= 1 && s.kind === 'cover' && s.dAsp === s.coverD && outAt != null && steps - Math.max(outAt, coverAt) > 40) {
          const m = s.mesh, front = new V(1, 0, 0).applyQuaternion(m.quaternion), spineN = new V(0, 0, 1).applyQuaternion(m.quaternion);
          const toCam = w.camera.position.clone().sub(m.position), hor = toCam.clone().setY(0).normalize(), frontH = front.clone().setY(0).normalize();
          const pb = m.material[2];
          fin = {
            rect: s.front.userData.uAtlas.value.toArray().map((v) => +v.toFixed(4)), img: [s.front.map.image.width, s.front.map.image.height],
            scale: m.scale.toArray().map((v) => +v.toFixed(4)), shelf: [+e.w.toFixed(4), +e.h.toFixed(4), +e.d.toFixed(4)], aspect: +s.aspect.toFixed(4),
            turnDeg: +(Math.acos(Math.min(1, frontH.dot(hor))) * 180 / Math.PI).toFixed(1), spineCos: +spineN.dot(toCam.normalize()).toFixed(3),
            sameFrontBack: m.material[0] === m.material[1],
            pageBlock: !!pb.userData.pageBlock && (pb.map?.image?.width || 0) > 1 && pb.customProgramCacheKey() === m.material[3].customProgramCacheKey(),
          };
        }
        if (steps % 4 === 0) await tick();
      }
      // back in: the width returns to the shelf's before the book disappears, nothing cuts into the neighbours
      w.books.setHover(null);
      let lastWidth = null, inSteps = 0;
      for (; inSteps < 300; inSteps++) {
        w.books.update(dt, w.camera);
        const s = slotOf(); if (!s) break;
        if (s.mesh.visible) { trace(s.mesh); lastWidth = +s.mesh.scale.z.toFixed(4); }
      }
      w.frame();
      return { id: e.book.id, steps, coverAt, outAt, fin, intoNeighbour, widenedInside, maxInsideX: +maxInsideX.toFixed(4), back: { lastWidth, shelf: +e.d.toFixed(4), steps: inSteps, released: !slotOf() }, programs: [programs0, r.info.programs.length] };
    });
    log('HOVER-SOLID', solid);
    if (!solid) check('a book with a cover image downstairs for the pulled-out book', false);
    else {
      const f = solid.fin, want = f ? Math.min(0.9, Math.max(0.55, f.img[0] / f.img[1])) : null;
      check('the pulled-out book shows the whole cover (texture rect 0 … 1 on both axes), the same on front and back', !!f && f.sameFrontBack && [0, 0, 1, 1].every((v, i) => Math.abs(v - f.rect[i]) < 0.002), f && { rect: f.rect });
      check('its width is height × cover aspect (0.55 … 0.9), height and thickness stay the book\'s', !!f && Math.abs(f.scale[2] - want * f.scale[1]) < 0.001 && Math.abs(f.scale[1] - f.shelf[1]) < 1e-4 && Math.abs(f.scale[0] - f.shelf[0]) < 1e-4, f && { scale: f.scale, shelf: f.shelf, want: +(want * f.scale[1]).toFixed(4) });
      check('the turn stops 15 to 22° short of facing the viewer, the spine stays in view', !!f && f.turnDeg >= 14 && f.turnDeg <= 23 && f.spineCos > 0.1, f && { turnDeg: f.turnDeg, spineCos: f.spineCos });
      check('the page block is paper with its own texture on the spine\'s shader program', !!f && f.pageBlock, f && { pageBlock: f.pageBlock });
      check('the width comes with the turn, after the book is clear of the case: it never cuts into the neighbours', solid.intoNeighbour === 0 && solid.widenedInside === 0, { intoNeighbour: solid.intoNeighbour, widenedInside: solid.widenedInside, maxInsideX: solid.maxInsideX });
      check('on the way in the width goes back to the shelf\'s before the book disappears', solid.back.released && solid.back.lastWidth != null && Math.abs(solid.back.lastWidth - solid.back.shelf) < 0.002, solid.back);
      check('the hover compiles no shader program', solid.programs[0] === solid.programs[1], solid.programs);
    }
  }

  // ------------------------------------------------------------------ the wheel walks to a department ----
  if (parts.includes('wheel')) {
    const walk = async (from, name) => {
      await page.evaluate(([x, z, yaw]) => { const w = window.__app.world; w.player.transition = null; w.player.setPose(x, z, yaw, 0); w.frame(); }, from);
      await page.evaluate((n) => window.__app.ctx.world.setDepartment(n), name);
      for (let i = 0; i < 40; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(60); }
      return page.evaluate((n) => {
        const w = window.__app.world, run = w.layout.departmentRuns.find((r) => r.name === n);
        const want = w.departmentPose(run), p = w.player.position;
        const fx = Math.sin(run.first.rot), fz = Math.cos(run.first.rot);
        const dist = (p.x - run.first.x) * fx + (p.z - run.first.z) * fz;
        const chip = document.querySelector('#hud .hud-chip.dep')?.textContent || '';
        return { name: n, at: [+p.x.toFixed(2), +p.z.toFixed(2)], want: [+want.x.toFixed(2), +want.z.toFixed(2)], off: +Math.hypot(p.x - want.x, p.z - want.z).toFixed(3), dist: +dist.toFixed(2), facing: +(-Math.sin(w.player.yaw) * -fx + -Math.cos(w.player.yaw) * -fz).toFixed(3), transition: !!w.player.transition, chip, free: w.player.isFree(p.x, p.z, 0), ground: +w.player.ground.toFixed(3) };
      }, name);
    };
    const deps = await page.evaluate(() => window.__app.world.layout.departmentRuns.map((r) => r.name));
    const inRoom = await walk([0, -16.0, 0], deps[deps.length - 2]);
    const fromHall = await walk([3.0, 1.0, Math.PI], deps[2]);
    const again = await walk([-8, -13, 0], deps[0]);
    log('WALK', [inRoom, fromHall, again]);
    for (const r of [inRoom, fromHall, again]) check(`wheel → ${r.name}: 1.8 m in front of its first case, on the floor, facing it, the chip names it`, r.off < 0.05 && r.dist > 1.3 && r.dist < 2.4 && Math.abs(r.ground) < 0.01 && r.facing > 0.98 && !r.transition && r.free && r.chip.includes(r.name), r);
    await shot(`${tag}-walk`);
    // the wheel with every department: the labels fit their sectors
    await page.evaluate(() => window.__app.ctx.openWheel());
    await sleep(400);
    const wheel = await page.evaluate(() => {
      const el = document.querySelector('#wheel');
      const labels = [...el.querySelectorAll('.wheel-label')];
      // 0.7.2: a crowded ring (13 sectors and more) sets its labels further out with less margin (wheel.js DENSE)
      const n = labels.length, dense = n >= 13, rr = 96 + (230 - 96) * (dense ? 0.6 : 0.5), maxW = 2 * rr * Math.sin(Math.PI / n) - (dense ? 10 : 16);
      const widths = labels.map((l) => Math.max(...[...l.querySelectorAll('tspan')].map((t) => t.getComputedTextLength())));
      return { n, maxW: +maxW.toFixed(1), widest: +Math.max(...widths).toFixed(1), sizes: labels.map((l) => l.style.fontSize), lines: labels.map((l) => [...l.querySelectorAll('tspan')].map((t) => t.textContent).join('|')) };
    });
    log('WHEEL', wheel);
    const readShelf = await page.evaluate(() => !!window.__app.ctx.world.readShelf?.());   // 0.7: the case "Gelesen" as well
    check('the wheel shows every department plus "recently read", every label inside its sector', wheel.n === deps.length + 1 + (readShelf ? 1 : 0) && wheel.widest <= wheel.maxW + 1, wheel);
    await shot(`${tag}-wheel`);
    await page.evaluate(() => { const w = document.querySelector('#wheel'); w.classList.add('hidden'); });
    await page.keyboard.press('Escape').catch(() => {});
  }

  // ------------------------------------------------------------------ "Abteilung ändern" in the book card ----
  if (parts.includes('manual')) {
    const pick = await page.evaluate(() => {
      const w = window.__app.world, deps = w.layout.departments.filter((d) => d.count > 0);
      const from = deps[0], to = deps.find((d) => d.shelves.length > 2) || deps[1];
      const id = from.shelves[0].bookIds[0];
      return { id, from: from.name, to: to.name, toId: to.id, shelf: to.shelves[1].name };
    });
    await page.evaluate((id) => window.__app.ctx.openPanel('bookinfo', { id }), pick.id);
    await sleep(1500);
    const form = await page.evaluate(([toId, shelf]) => {
      const btn = [...document.querySelectorAll('.rd-bi button')].find((b) => /Abteilung ändern|Change department/.test(b.textContent));
      if (!btn) return { err: 'no button' };
      btn.click();
      const [dep, sh] = document.querySelectorAll('.rd-bi-dept select');
      if (!dep) return { err: 'no form' };
      const options = [...dep.options].map((o) => o.value);
      dep.value = toId; dep.dispatchEvent(new Event('change'));
      sh.value = shelf;
      const shelves = [...sh.options].map((o) => o.value);
      document.querySelector('.rd-bi-dept .btn.primary').click();
      return { options: options.length, idsOnly: options.every((v) => /^folder:|^[a-z]+$/.test(v)), shelves };
    }, [pick.toId, pick.shelf]);
    await sleep(3500);
    await page.evaluate(() => window.__app.closeAllPanels());
    for (let i = 0; i < 6; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(200); }
    const after = await page.evaluate((p) => {
      const w = window.__app.world, b = window.__app.state.library.books.find((x) => x.id === p.id);
      const run = w.layout.departmentRuns.find((r) => r.name === p.to);
      const inRun = run?.cases.some((cid) => w.layout.bookcases.find((c) => c.id === cid)?.rows.some((r) => r.items.some((it) => it.id === p.id)));
      return { department: b?.department, shelf: b?.shelf, source: b?.departmentSource, inRun: !!inRun };
    }, pick);
    log('MANUAL', { pick, form, after });
    check('"Abteilung ändern": the book moves to the chosen folder department and shelf, in the room as well', !form.err && form.idsOnly && after.department === pick.to && after.shelf === pick.shelf && after.source === 'manual' && after.inRun, { form, after });
  }

  // ------------------------------------------------------------------ recommendations ----
  if (parts.includes('picks')) {
    const picks = await page.evaluate(() => {
      const w = window.__app.world;
      const real = window.__realCover;
      const check = () => {
        const byId = w.booksById;
        const disp = w.layout.bookcases.flatMap((bc) => bc.display.map((id) => ({ bc: bc.id, id })));
        const table = (w.books.tableDisplay || []).map((m) => m.userData.displayBook);
        const withStock = w.layout.bookcases.filter((bc) => bc.rows.some((r) => r.items.length));
        // cases whose own stock holds a must-read book with a cover: one of those must lie on the board
        const mustCases = withStock.filter((bc) => bc.rows.some((r) => r.items.some((it) => byId[it.id]?.mustRead && real(byId[it.id]))));
        return {
          display: disp.length, displayNoCover: disp.filter((x) => !real(byId[x.id])).length,
          casesWithStock: withStock.length, casesWithDisplay: w.layout.bookcases.filter((bc) => bc.display.length).length,
          mustCases: mustCases.length, mustShown: mustCases.filter((bc) => bc.display.some((id) => byId[id]?.mustRead)).length,
          table: table.length, tableNoCover: table.filter((id) => !real(byId[id])).length, tableMust: table.filter((id) => byId[id]?.mustRead).length,
          typoFronts: [...w.books.displayMeshes, ...(w.books.tableDisplay || [])].filter((m) => m.userData.typoCover).length,
        };
      };
      const before = check();
      const hash = (s) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
      const saved = w.library.books.map((b) => [b, b.hasCover]);
      for (const b of w.library.books) if (hash(b.id) % 2) b.hasCover = false;
      w.build(w.library, {});
      const half = check();
      for (const b of w.library.books) b.hasCover = false;
      w.build(w.library, {});
      const none = check();
      for (const [b, v] of saved) b.hasCover = v;
      w.setRecent([]);
      w.build(w.library, {});
      return { before, half, none };
    });
    log('PICKS', picks);
    check('recommendations only with a real cover', [picks.before, picks.half, picks.none].every((p) => !p.displayNoCover && !p.tableNoCover && !p.typoFronts) && !picks.none.display && !picks.none.table, picks);
    check('must-read books first: on the board of their case and on the display table', picks.before.mustShown === picks.before.mustCases && (picks.before.mustCases === 0 || picks.before.tableMust > 0), picks.before);
  }
  log('ERRORS', errors.slice(0, 20));
  console.log(`BOOKS-CHECK ${failures ? 'FAILED: ' + failures : 'ALL PASSED'}`);
};
