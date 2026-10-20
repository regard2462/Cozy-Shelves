// A library too big for the walls: the book room shows one department at a time, as before the gallery (0.6.2). The
// wheel (Tab) switches it, the board in the passage lists every department and names the walls of the one in the room,
// the choice is kept over a restart.
//   COZYSHELVES_BOOKS="<books3\lib-generic>|structured" COZYSHELVES_USERDATA=<fresh dir> SHOT_DIR=<dir> node build/screenshot.js fallback-check
//   FB_PHASE=restart … (the same COZYSHELVES_USERDATA and SHOT_DIR): the department chosen in the first run stands in the room
// A library that fits the walls is inflated first (every shelf six times over) so that it no longer fits; at the end the
// real one is built again and must fill the walls. FB_STATE names the file that carries the choice to the restart
// (default: fb-state.json in SHOT_DIR); SHOT_TAG prefixes the screenshots.
const fs = require('fs');
const path = require('path');

module.exports = async ({ page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || 'fb';
  const phase = process.env.FB_PHASE || 'first';
  const stateFile = process.env.FB_STATE || path.join(process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots'), 'fb-state.json');
  let passed = 0, failed = 0;
  const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); if (ok) passed++; else failed++; };
  const log = (k, v) => console.log(k + ' ' + JSON.stringify(v));
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });

  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  // indexing finished (a large library takes many minutes), and the shelves have stood still for a while (the delayed
  // rebuild after the last library update)
  let last = '', quietSince = 0;
  for (let i = 0; i < 2400; i++) {
    const st = await page.evaluate(() => { const A = window.__app, b = A.state.library.books; return { n: b.length, idx: b.filter((x) => x.indexed).length, active: !!A.state.library.scan?.active, key: A.world.layout?.department + '#' + A.world.layout?.bookcases.map((c) => c.id + ':' + c.rows.map((r) => r.items.length).join('.')).join('|') }; });
    const done = st.n > 0 && st.idx === st.n && !st.active;
    if (!done || st.key !== last) quietSince = Date.now();
    last = st.key;
    if (done && Date.now() - quietSince > 12000) break;
    await sleep(1000);
  }

  /** The room as the layout describes it. */
  const room = () => page.evaluate(() => {
    const w = window.__app.world, L = w.layout;
    const deps = (L.departments || []).filter((d) => d.count > 0);
    const runs = L.departmentRuns || [];
    const depCases = L.bookcases.filter((b) => b.dep);
    const signs = (L.signs || []).filter((s) => s.kind === 'department');
    const roomWalls = L.walls.filter((wl) => wl.z < -9.0);
    return {
      all: L.allDepartments, department: L.department, deps: deps.map((d) => d.name), runs: runs.map((r) => ({ name: r.name, cases: r.cases.length, parts: r.parts.length, walls: r.walls })),
      cases: depCases.length, books: depCases.reduce((a, b) => a + b.rows.reduce((x, r) => x + r.items.length, 0), 0),
      signs: signs.map((s) => ({ dep: s.dep, y: +s.y.toFixed(2) })),
      directory: L.directory ? { all: L.directory.all, entries: L.directory.entries.map((e) => ({ n: e.n, id: e.id, name: e.name.de, walls: e.walls })) } : null,
      runIds: runs.map((r) => r.id),
      // one storey: the room is 5 m high, nothing stands or hangs on a floor above the ground floor, no place up there
      ceiling: L.ceilings.find((c) => c.z < -9.0)?.y, wallTop: +Math.max(...roomWalls.map((wl) => wl.y + wl.h / 2)).toFixed(2),
      raised: L.placements.filter((p) => p.z < -9.0 && (p.meta?.floor || 0) > 0).length, highCases: L.bookcases.filter((b) => b.y).length,
      places: L.places.map((p) => p.id), chip: document.querySelector('#hud .hud-chip.dep')?.textContent || '',
      stored: localStorage.getItem('lesesaal.department'),
    };
  });
  const standAt = (x, z, yaw, pitch) => page.evaluate(([x, z, yaw, pitch]) => { const w = window.__app.world; w.player.transition = null; w.player.setPose(x, z, yaw, pitch); for (let i = 0; i < 8; i++) w.frame(); }, [x, z, yaw, pitch]);

  // ================================================================= restart: the chosen department is back ==========
  if (phase === 'restart') {
    const want = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const r = await room();
    log('RESTART', { want: want.department, inflated: want.inflated, ...r, places: undefined });
    if (want.inflated) {
      // the first run inflated a library that fits: after the restart the real one fills the walls again, and the
      // department chosen is the current one (main.js hands the stored choice to the layout)
      check('after the restart the real library fills the walls again, the stored choice is the current department', r.all === true && r.department === want.department, { want: want.department, all: r.all, department: r.department });
    } else {
      check('after the restart the room shows the department chosen before, one department at a time', r.all === false && r.department === want.department && r.runs.length === 1 && r.runs[0].name === want.department, { want: want.department, department: r.department, runs: r.runs });
      check('the HUD chip names it', r.chip.includes(want.department), r.chip);
    }
    await standAt(0, -10.2, 0, 0.05);
    await shot(`${tag}-restart`);
    check('no errors in the page', !errors.length, errors.slice(0, 5));
    console.log(`FALLBACK-CHECK ${failed ? 'FAILED' : 'OK'} passed=${passed} failed=${failed}`);
    return;
  }

  // ================================================================= first start =====================================
  let r = await room();
  log('LIB', { all: r.all, deps: r.deps.length, cases: r.cases, department: r.department });
  let inflated = false;
  if (r.all) {
    // a library that fits: six copies of every book (new ids), every shelf six times as long. The copies show title
    // cards: the main process does not know their ids (main.js idFromUrl), so a cover request for one is answered with
    // 400, an error in the page's console that the count at the end would see
    inflated = true;
    const b = await page.evaluate(() => {
      const w = window.__app.world, real = w.library;
      const books = [], deps = [];
      for (const d of real.departments) {
        const shelves = d.shelves.map((s) => ({ ...s, bookIds: [] }));
        d.shelves.forEach((s, i) => { for (let k = 0; k < 6; k++) for (const id of s.bookIds) { const b = real.books.find((x) => x.id === id); const c = { ...b, id: id + '~' + k, hasCover: false }; books.push(c); shelves[i].bookIds.push(c.id); } });
        deps.push({ ...d, count: d.count * 6, shelves });
      }
      window.__real = real;
      const t0 = performance.now();
      w.build({ ...real, books, departments: deps }, {});
      for (let i = 0; i < 3; i++) w.frame();
      return Math.round(performance.now() - t0);
    });
    log('INFLATED', { buildMs: b });
    r = await room();
  }
  log('ROOM', { ...r, places: undefined });
  check('the library does not fit the walls: one department stands in the room, with cases and books', r.all === false && r.runs.length === 1 && r.runs[0].name === r.department && r.cases > 0 && r.books > 0, { all: r.all, runs: r.runs, cases: r.cases, books: r.books });
  check('its sign hangs above every part of its run, at the height of the ground floor', r.signs.length === r.runs[0]?.parts && r.signs.every((s) => s.y < 3), { signs: r.signs, parts: r.runs[0]?.parts });
  const shown = r.directory?.entries.filter((e) => e.walls.length) || [];
  check('the board lists every department and names the walls of the one in the room only', r.directory && r.directory.all === false && r.directory.entries.length === r.deps.length && shown.length === 1 && shown[0].name === r.department && shown[0].walls.every((w) => ['left', 'back', 'right', 'front'].includes(w)), r.directory);
  check('the entry of the department in the room carries its id, so the plan shows its list number', shown.length === 1 && shown[0].id === r.runIds[0] && shown[0].n === r.deps.indexOf(r.department) + 1, { shown, runIds: r.runIds });
  check('one storey: the room is 5 m high, nothing stands above the floor, no place "Galerie"', r.ceiling === 5 && r.wallTop <= 5.01 && r.raised === 0 && r.highCases === 0 && !r.places.includes('gallery'), { ceiling: r.ceiling, wallTop: r.wallTop, raised: r.raised, highCases: r.highCases });

  // the wheel lists every department (plus "Zuletzt gelesen" and, when it stands, the case "Gelesen")
  await page.evaluate(() => window.__app.ctx.openWheel());
  await page.waitForFunction(() => { const el = document.querySelector('#wheel'); return el && !el.classList.contains('hidden') && el.querySelectorAll('.wheel-label').length > 0; }, null, { timeout: 5000 }).catch(() => {});
  const wheel = await page.evaluate(() => {
    const el = document.querySelector('#wheel');
    return { open: !!el && !el.classList.contains('hidden'), labels: [...el?.querySelectorAll('.wheel-label') || []].map((l) => l.textContent.replace(/\s+/g, ' ').trim()), readShelf: !!window.__app.ctx.world.readShelf?.() };
  });
  await page.evaluate(() => { const el = document.querySelector('#wheel'); el?.classList.add('hidden'); });
  await page.keyboard.press('Escape').catch(() => {});
  log('WHEEL', wheel);
  check('the wheel offers every department and "Zuletzt gelesen"', wheel.open && wheel.labels.length === r.deps.length + 1 + (wheel.readShelf ? 1 : 0), { labels: wheel.labels.length, deps: r.deps.length, readShelf: wheel.readShelf });

  // pictures: the room from the entrance and the board in the passage
  await standAt(0, -10.2, 0, 0.05);
  await shot(`${tag}-room`);
  const dir = await page.evaluate(() => { const d = window.__app.world.layout.directory; return d ? [d.x + Math.sin(d.rot) * 1.6, d.z + Math.cos(d.rot) * 1.6, d.rot] : null; });
  if (dir) { await standAt(dir[0], dir[1], dir[2], -0.05); await shot(`${tag}-board`); }

  // the wheel's choice (main.js setDepartment: a fade, the room is rebuilt with the other department, the choice is stored)
  const other = r.deps.find((n) => n !== r.department);
  await page.evaluate((n) => window.__app.ctx.world.setDepartment(n), other);
  const switched = await page.waitForFunction((n) => window.__app.world.layout.department === n && !document.querySelector('#fade:not(.hidden)'), other, { timeout: 15000 }).then(() => true).catch(() => false);
  await standAt(0, -10.2, 0, 0.05);
  const r2 = await room();
  log('SWITCHED', { other, switched, department: r2.department, runs: r2.runs, chip: r2.chip, stored: r2.stored });
  check('Tab (the wheel) switches the room to another department: its cases, its sign, the HUD chip, the board', switched && r2.all === false && r2.runs.length === 1 && r2.runs[0].name === other && r2.cases > 0 && r2.chip.includes(other) && r2.directory.entries.find((e) => e.walls.length)?.name === other, { other, runs: r2.runs, chip: r2.chip });
  check('the choice is stored for the next start', r2.stored === other, r2.stored);
  await shot(`${tag}-room-switched`);

  // seated through a switch: the sofa of the hall stands in every layout, so the reader stays seated at its eye height
  // (no glide back into the seat, no sound of sitting down); a reading nook of the book room moves with the cases, and a
  // reader whose seat is gone stands up where it stood
  const seatedSwitch = await page.evaluate(async (n) => {
    const A = window.__app, w = A.world, p = w.player, a = w.actions, audio = A.ctx.audio;
    const sfx = []; const orig = audio.sfx.bind(audio); audio.sfx = (name, o) => { sfx.push(name); return orig(name, o); };
    const settle = (k) => { for (let i = 0; i < k; i++) { p.update(0.05); a.update(0.05); } };
    const sitOn = (id) => { if (a.seatedId) a.leaveSeat(); const s = w.seats.get(id); p.transition = null; p.setPose(s.standPos.x, s.standPos.z, s.standYaw, 0); a.sit(id); settle(40); };
    const sw = (dep) => new Promise((resolve) => { A.ctx.world.setDepartment(dep); const t0 = performance.now(); const look = () => { if ((w.layout.department === dep && !document.querySelector('#fade:not(.hidden)')) || performance.now() - t0 > 15000) resolve(); else setTimeout(look, 100); }; look(); });
    sitOn('sofa');
    const y0 = p.position.y, sfxAt = sfx.length;
    await sw(n.first);
    settle(4);
    const sofa = { seated: !!p.seated, id: a.seatedId, dy: +Math.abs(p.position.y - y0).toFixed(3), transition: !!p.transition, sitSfx: sfx.slice(sfxAt).filter((s) => s === 'sit').length, department: w.layout.department };
    // a nook of the book room, when the layout has one
    const nook = [...w.seats.keys()].find((id) => id.startsWith('nook'));
    let nookResult = null;
    if (nook) {
      sitOn(nook);
      const eye0 = w.seats.get(nook).eye.clone();
      await sw(n.other);
      settle(4);
      const again = w.seats.get(nook);
      nookResult = { nook, samePlace: !!again && again.eye.distanceTo(eye0) < 0.05, seated: !!p.seated, id: a.seatedId, y: +p.position.y.toFixed(3), department: w.layout.department };
    }
    audio.sfx = orig;
    a.leaveSeat(); p.transition = null; p.setPose(0, -10.2, 0, 0.05);
    return { sofa, nook: nookResult };
  }, { first: r.department, other });
  log('SEATED-SWITCH', seatedSwitch);
  check('seated on the sofa, a switch of the department keeps the reader seated at the seat\'s eye height, without a glide or a sitting sound', seatedSwitch.sofa.seated && seatedSwitch.sofa.id === 'sofa' && seatedSwitch.sofa.dy < 0.01 && !seatedSwitch.sofa.transition && seatedSwitch.sofa.sitSfx === 0 && seatedSwitch.sofa.department === r.department, seatedSwitch.sofa);
  if (seatedSwitch.nook) {
    const nk = seatedSwitch.nook;
    check(nk.samePlace ? 'the nook stands in the other room as well: the reader stays seated' : 'the nook is gone or elsewhere with the switch: the reader stands up where it stood (no seat to sit in)', nk.samePlace ? nk.seated && nk.id === nk.nook : !nk.seated && !nk.id && Math.abs(nk.y - 1.62) < 0.01, nk);
  }
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ department: other, deps: r.deps, inflated }));

  if (inflated) {
    const back = await page.evaluate(() => { const w = window.__app.world; w.build(window.__real, {}); w.frame(); return { all: w.layout.allDepartments, cases: w.layout.bookcases.length }; });
    check('the real library fills the walls again', back.all === true, back);
  }
  check('no errors in the page', !errors.length, errors.slice(0, 5));
  console.log(`FALLBACK-CHECK ${failed ? 'FAILED' : 'OK'} passed=${passed} failed=${failed}`);
};
