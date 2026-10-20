// A library change that moves the bookcases rebuilds the whole world (world.js updateLibrary → #rebuildInPlace), one
// that keeps them swaps only the shelves (refreshShelves). Either must not freeze the picture: the rebuild used to be
// followed by one frame of about two seconds, because the old materials were disposed before the new ones took over
// their shader programs, and three.js threw the programs away and compiled them all again.
//   COZYSHELVES_BOOKS=<library>|structured COZYSHELVES_USERDATA=<dir> node build/screenshot.js rebuild-stall-check
module.exports = async ({ page, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 120; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(12000);   // the delayed shelf rebuild after the scan and the first compiles are over
  const results = [];
  const check = (name, ok, info) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(info)}`); };

  /** Frame intervals for `ms` after a library change in the page (requestAnimationFrame timestamps).
   *  kind 'grow': 60 more books in the first filled shelf, so more cases and a full rebuild; 'swap': the same books
   *  in another order, so only the shelves are swapped. */
  const framesAround = (kind, ms) => page.evaluate(async ([kind, ms]) => {
    const w = window.__app.world, r = w.renderer;
    const lights = () => { const c = {}; w.scene.traverse((o) => { if (o.isLight) { const k = o.type + (o.castShadow ? '*' : ''); c[k] = (c[k] || 0) + 1; } }); return c; };
    const ids0 = new Set(r.info.programs.map((pr) => pr.id)), keys0 = new Set(r.info.programs.map((pr) => pr.cacheKey));
    const before = { programs: r.info.programs.length, lights: lights(), cases: w.layout.bookcases.length };
    const times = [];
    let last = performance.now(), on = true;
    const tick = (t) => { times.push(t - last); last = t; if (on) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    await new Promise((res) => setTimeout(res, 300));
    let next;
    if (kind === 'grow') {
      const lib = w.library, dep = lib.departments.find((d) => d.shelves.some((s) => s.bookIds.length)) || lib.departments[0];
      const shelf = dep.shelves.find((s) => s.bookIds.length) || dep.shelves[0];
      const src = lib.books.filter((b) => shelf.bookIds.includes(b.id));
      const extra = [];
      for (let i = 0; i < 60; i++) { const b = src[i % src.length]; extra.push({ ...b, id: b.id + '-x' + i, title: b.title + ' ' + i }); }
      next = { ...lib, books: [...lib.books, ...extra], departments: lib.departments.map((d) => d !== dep ? d : { ...d, shelves: d.shelves.map((s) => s !== shelf ? s : { ...s, bookIds: [...s.bookIds, ...extra.map((b) => b.id)] }) }) };
    } else if (kind === 'shrink') {
      // two thirds of every shelf leave: fewer cases, more free wall (reading corners, so other lamps)
      const lib = w.library; w.__full = lib;
      const keep = new Set();
      const departments = lib.departments.map((d) => ({ ...d, shelves: d.shelves.map((s) => { const ids = s.bookIds.slice(0, Math.ceil(s.bookIds.length / 3)); ids.forEach((id) => keep.add(id)); return { ...s, bookIds: ids }; }) }));
      next = { ...lib, books: lib.books.filter((b) => keep.has(b.id)), departments };
    } else if (kind === 'restore') {
      next = w.__full;
    } else {
      const lib = w.library;
      next = { ...lib, books: lib.books.map((b) => ({ ...b })), departments: lib.departments.map((d) => ({ ...d, shelves: d.shelves.map((s) => ({ ...s, bookIds: [...s.bookIds].reverse() })) })) };
    }
    const t0 = performance.now();
    w.updateLibrary(next);
    const call = performance.now() - t0;
    await new Promise((res) => setTimeout(res, ms));
    on = false;
    const fresh = r.info.programs.filter((pr) => !ids0.has(pr.id));
    // who uses the programs compiled anew: the nearest named ancestor of each object
    const users = new Map();
    w.scene.traverse((o) => { for (const m of (o.material ? [o.material].flat() : [])) { const pr = r.properties.get(m)?.currentProgram; if (!pr || ids0.has(pr.id)) continue; let n = o, path = []; while (n && path.length < 3) { if (n.name) path.push(n.name); n = n.parent; } const k = pr.id; if (!users.has(k)) users.set(k, new Set()); users.get(k).add((path.join('<') || o.type) + (m.name ? '[' + m.name + ']' : '')); } });
    const usedBy = [...users.values()].map((set) => [...set].slice(0, 3).join(' | '));
    const after = { programs: r.info.programs.length, compiled: fresh.length, usedBy, which: fresh.map((pr) => (keys0.has(pr.cacheKey) ? 'SAMEKEY ' : 'NEWKEY ') + String(pr.cacheKey).replace(/\s+/g, ' ').slice(-160)), lights: lights(), cases: w.layout.bookcases.length };
    const sorted = [...times].sort((a, b) => b - a);
    return { call: Math.round(call), longest: sorted.slice(0, 4).map((x) => Math.round(x)), over100: times.filter((x) => x > 100).length, before, after };
  }, [kind, ms]);

  const full = await framesAround('grow', 4000);
  console.log('FULL', JSON.stringify(full));
  const moved = full.after.cases !== full.before.cases;
  check(`the change moves the cases (${full.before.cases} → ${full.after.cases}), so the whole world is rebuilt`, moved, {});
  check('the rebuild compiles no shader program anew', full.after.compiled === 0, { compiled: full.after.compiled, usedBy: full.after.usedBy, which: full.after.which, before: full.before.programs, after: full.after.programs, lightsBefore: full.before.lights, lightsAfter: full.after.lights });
  check('… and no frame after it takes longer than 250 ms', full.longest[0] < 250 + full.call, { call: full.call, longest: full.longest });

  await sleep(3000);
  const shelves = await framesAround('swap', 3000);
  console.log('SHELVES', JSON.stringify(shelves));
  check('a shelf swap compiles no shader program anew', shelves.after.compiled === 0, { compiled: shelves.after.compiled, which: shelves.after.which, before: shelves.before.programs, after: shelves.after.programs });
  check('… and no frame after it takes longer than 150 ms', shelves.longest[0] < 150 + shelves.call, { call: shelves.call, longest: shelves.longest });

  // lamps that come and go with the free wall: the number of lights stays (world.js #padLights), so a library that
  // shrinks and grows again compiles nothing anew on the way back
  await sleep(3000);
  const shrink = await framesAround('shrink', 3000);
  console.log('SHRINK', JSON.stringify({ cases: [shrink.before.cases, shrink.after.cases], lights: [shrink.before.lights, shrink.after.lights], compiled: shrink.after.compiled, longest: shrink.longest }));
  await sleep(3000);
  const back = await framesAround('restore', 3000);
  console.log('RESTORE', JSON.stringify({ cases: [back.before.cases, back.after.cases], lights: [back.before.lights, back.after.lights], compiled: back.after.compiled, longest: back.longest }));
  check('shrinking and growing back changes the cases', shrink.after.cases !== shrink.before.cases && back.after.cases === shrink.before.cases, { shrink: [shrink.before.cases, shrink.after.cases], back: [back.before.cases, back.after.cases] });
  check('growing back compiles no shader program anew (the lights keep their number)', back.after.compiled === 0, { compiled: back.after.compiled, usedBy: back.after.usedBy, lightsShrunk: shrink.after.lights, lightsBack: back.after.lights });

  const failed = results.filter((r) => !r.ok);
  console.log(`REBUILD-STALL-CHECK ${results.length - failed.length}/${results.length} passed` + (failed.length ? ' · failed: ' + failed.map((f) => f.name).join(' | ') : ''));
};
