// Libraries at the edges, built into the running world one after the other: no books at all, a single book, departments
// without shelves or with shelves of books that do not exist, books without a cover with very long or empty titles and
// odd page counts, a recent list with an unknown id, and the real library again at the end. After every
// build the layout, the seats and the scene must hold no NaN, a few frames and player steps must run without an error,
// and the reader must stand on finite ground. Prints PASS/FAIL lines and one summary line. Muted and hidden like every
// harness script.
//   COZYSHELVES_BOOKS="<small test library>|structured" COZYSHELVES_USERDATA=<fresh dir> node build/screenshot.js world-edge-check
module.exports = async ({ page, sleep }) => {
  let passed = 0, failed = 0;
  const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); if (ok) passed++; else failed++; };
  const errors = [];
  page.on('pageerror', (e) => { if (!/pointer lock/i.test(e.message)) errors.push(e.message); });

  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 90; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(2500);
  await page.evaluate(() => { window.__app.closeAllPanels(); window.__app.world.stop(); window.__real = window.__app.world.library; });
  await sleep(300);

  /** Build `lib` (made in the page from the real one by `make`), run frames and player steps, scan for NaN. */
  const probe = (name, make, opts = {}) => page.evaluate(([make, opts]) => {
    const A = window.__app, w = A.world, real = window.__real, p = w.player;
    const lib = new Function('real', 'return (' + make + ')(real)')(real);
    const out = { name: undefined, built: false, error: null, bad: [] };
    const fin = (o, path) => { for (const [k, v] of Object.entries(o)) if (typeof v === 'number' && !Number.isFinite(v)) out.bad.push(path + '.' + k); };
    try {
      w.build(lib, opts);
      out.built = true;
      for (let i = 0; i < 3; i++) w.frame();
      const L = w.layout;
      L.bookcases.forEach((b, i) => { fin(b, 'case' + i); b.rows.forEach((r, j) => { fin(r, `case${i}.row${j}`); r.items.forEach((it, k) => fin(it, `case${i}.row${j}.item${k}`)); }); });
      L.placements.forEach((pl, i) => fin(pl, 'placement' + i));
      L.signs.forEach((s, i) => fin(s, 'sign' + i));
      L.places.forEach((pl, i) => fin(pl, 'place' + i));
      for (const [id, s] of w.seats) if (![s.eye.x, s.eye.y, s.eye.z, s.standPos.x, s.standPos.z].every(Number.isFinite)) out.bad.push('seat ' + id);
      w.scene.traverse((o) => { if (!Number.isFinite(o.position.x + o.position.y + o.position.z + o.scale.x + o.scale.y + o.scale.z)) out.bad.push('object ' + (o.name || o.type)); });
      // the reader at the door of the book room, a few steps, then the entrance of the hall
      p.transition = null; p.setPose(0, -10.2, 0, 0.05);
      for (let i = 0; i < 12; i++) { p.update(0.05); w.actions.update(0.05); }
      if (![p.position.x, p.position.y, p.position.z].every(Number.isFinite)) out.bad.push('player ' + JSON.stringify(p.position));
      p.setPose(0, 2, Math.PI, 0);
      for (let i = 0; i < 6; i++) { p.update(0.05); w.frame(); }
      if (![p.position.x, p.position.y, p.position.z].every(Number.isFinite)) out.bad.push('player2 ' + JSON.stringify(p.position));
      Object.assign(out, {
        cases: L.bookcases.length, books: L.bookcases.reduce((a, b) => a + b.rows.reduce((x, r) => x + r.items.length, 0), 0),
        all: L.allDepartments, dep: L.department, empty: !!L.emptyLibrary, runs: L.departmentRuns.map((r) => r.name), seats: w.seats.size,
        directory: L.directory ? L.directory.entries.length : null, entries: w.books?.entries?.size,
      });
    } catch (e) { out.error = String(e && e.stack || e); }
    return out;
  }, [make.toString(), opts]);

  /** A library from parts of the real one. */
  const probes = [
    ['no books at all', (real) => ({ ...real, books: [], departments: [] }), {},
      (r) => r.empty && r.cases > 0 && r.books === 0 && r.runs.length === 1],
    ['a single book', (real) => { const b = real.books[0], d = real.departments.find((x) => x.shelves.some((s) => s.bookIds.includes(b.id))) || real.departments[0]; return { ...real, books: [b], departments: [{ ...d, count: 1, shelves: [{ ...d.shelves[0], bookIds: [b.id] }] }] }; }, {},
      (r) => r.all && r.books === 1 && r.runs.length === 1 && !r.empty],
    ['departments without shelves, a count without shelves, a shelf of unknown books', (real) => {
      const [d0, d1] = real.departments;
      const keep = d1 || d0;
      return { ...real, departments: [{ ...d0, id: 'x:none', name: 'Leer', count: 0, shelves: [] }, { ...d0, id: 'x:count', name: 'Zahl', count: 3, shelves: [] }, { ...d0, id: 'x:ghost', name: 'Geister', count: 2, shelves: [{ name: 'G', key: 'g', bookIds: ['ghost-1', 'ghost-2'] }] }, keep] };
    }, {}, (r) => r.all && r.runs.length === 1 && !r.empty && r.books > 0],
    ['no covers, a title of 400 letters, an empty title, odd page counts', (real) => {
      const books = real.books.map((b, i) => ({ ...b, hasCover: false, author: i % 3 ? b.author : '', title: i === 0 ? '' : i === 1 ? 'Wörterbuchartikel '.repeat(22).trim() : b.title, pageCount: i === 2 ? -5 : i === 3 ? NaN : i === 4 ? 0 : i === 5 ? 1e9 : b.pageCount }));
      return { ...real, books };
    }, {}, (r) => r.all && r.books === r.entries && r.books > 0],
    ['a recent list with an unknown id', (real) => real, {}, (r) => r.all && r.books > 0],
    ['the real library again', (real) => real, {}, (r) => r.all && r.books > 0 && !r.empty],
  ];
  // the ids the recent probe needs (read once from the page)
  const ids = await page.evaluate(() => window.__real.books.slice(0, 2).map((b) => b.id));
  probes[4][2] = { recent: ['nope', ids[0], ids[1] || ids[0]] };

  for (const [name, make, opts, ok] of probes) {
    const before = errors.length;
    const r = await probe(name, make, opts);
    // the idle work of a build (title cards, side covers) runs for a moment with frames
    for (let i = 0; i < 6; i++) { await page.evaluate(() => { for (let k = 0; k < 5; k++) window.__app.world.frame(); }).catch((e) => errors.push('frame: ' + e.message)); await sleep(150); }
    const pageErrors = errors.slice(before);
    console.log('PROBE ' + JSON.stringify({ name, ...r }));
    check(`${name}: built, no NaN, no error, one shelf entry per book, ${ok.toString().replace(/^\(r\) => /, '')}`, r.built && !r.error && !r.bad.length && !pageErrors.length && r.books === r.entries && ok(r), { error: r.error && r.error.slice(0, 300), bad: r.bad.slice(0, 8), pageErrors: pageErrors.slice(0, 3), cases: r.cases, books: r.books, all: r.all, dep: r.dep, empty: r.empty, runs: r.runs, entries: r.entries });
  }
  // the recent case holds the known ids of the list (main.js hands the world a list without repeats: loadRecent, noteRecent)
  const recentRows = await page.evaluate(() => { const rc = window.__app.world.layout.bookcases.find((b) => b.recent); return rc ? rc.rows.flatMap((r) => r.items.map((it) => it.id)) : []; });
  const want = [...new Set([ids[0], ids[1] || ids[0]])];
  check('the recent case stands with the known ids of the list, the unknown one left out', recentRows.length === want.length && want.every((id) => recentRows.includes(id)), { recentRows, want });

  check('no errors in the page', !errors.length, errors.slice(0, 5));
  console.log(`WORLD-EDGE-CHECK ${failed ? 'FAILED' : 'OK'} passed=${passed} failed=${failed}`);
};
