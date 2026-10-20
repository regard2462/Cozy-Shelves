// Pictures of the book room from the places a visitor stands: the entrance, the back wall, the passage, the board in the
// passage, the world map, the two side walls. No checks, only pictures (and one line with the room's facts).
//   COZYSHELVES_BOOKS="<library>|structured" COZYSHELVES_USERDATA=<dir> SHOT_DIR=<dir> COZYSHELVES_QUERY="hour=21" node build/screenshot.js room-views
//   SHOT_TAG prefixes the names (default rv); RV_SIZE=1920x1080 sets the window.
module.exports = async ({ app, page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || 'rv';
  const [SW, SH] = (process.env.RV_SIZE || '1920x1080').split('x').map(Number);
  await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setContentSize(w, h); }, [SW, SH]);
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
  // the pictures on the sides of the books have arrived (or a minute has passed)
  for (let i = 0; i < 240; i++) {
    const s = await page.evaluate(() => window.__app.world.books.sideCovers?.info() || null);
    if (!s || (!s.loading && !s.queued && s.openReady >= Math.min(s.open, s.capacity))) break;
    await sleep(250);
  }
  const info = await page.evaluate(() => { const w = window.__app.world, L = w.layout; return { hour: w.currentHour?.(), all: L.allDepartments, department: L.department, cases: L.bookcases.length, books: w.books.entries.size, ceiling: L.ceilings.find((c) => c.z < -9)?.y }; });
  console.log('ROOM ' + JSON.stringify(info));
  // the HUD away, the look ray at rest: no book comes out where the camera looks
  await page.evaluate(() => { const w = window.__app.world; document.querySelector('#hud')?.style.setProperty('opacity', '0'); w.actions.rayTimer = 1e9; w.books.setHover?.(null); });
  const views = await page.evaluate(() => {
    const w = window.__app.world, L = w.layout, out = [];
    out.push(['entrance', 0, -10.2, 0, 0.02]);
    out.push(['entrance-left', 1.2, -10.4, 0.42, 0.04]);
    out.push(['back-wall', 0, -21.4, Math.PI, 0.04]);
    out.push(['passage', 0, -7.4, 0, 0.02]);
    const d = L.directory;
    if (d) out.push(['board', d.x + Math.sin(d.rot) * 1.6, d.z + Math.cos(d.rot) * 1.6, d.rot, -0.05]);
    const m = L.places.find((p) => p.id === 'worldmap');
    if (m) out.push(['worldmap', m.x, m.z + 0.6, m.yaw, 0.08]);
    out.push(['left-wall', 8.4, -10.6, Math.PI / 4 + 0.12, 0.06]);
    out.push(['right-wall', -8.4, -10.6, -Math.PI / 4 - 0.12, 0.06]);
    out.push(['reading-table', 0, -18.6, Math.PI, 0.02]);
    return out;
  });
  for (const [name, x, z, yaw, pitch] of views) {
    await page.evaluate(([x, z, yaw, pitch]) => { const w = window.__app.world; if (w.actions.seatedId) w.actions.leaveSeat(); w.player.transition = null; w.player.setPose(x, z, yaw, pitch); }, [x, z, yaw, pitch]);
    for (let i = 0; i < 12; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(40); }
    await shot(`${tag}-${name}`);
  }
  await page.evaluate(() => { document.querySelector('#hud')?.style.setProperty('opacity', '1'); window.__app.world.actions.rayTimer = 0; });
  console.log('ROOM-VIEWS done');
};
