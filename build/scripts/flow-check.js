// End-to-end flow in the real app: take a book, sit, read, close, stand, hand it back at the
// counter, and check that it ends up on the "recently read" shelf. Also opens every panel.
module.exports = async ({ page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || '';
  const log = (...a) => console.log(...a);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });

  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  await sleep(1200);
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  const settle = async (n = 8) => { for (let i = 0; i < n; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(45); } };

  // --- take a book from the shelf ---------------------------------------------------------
  const taken = await page.evaluate(() => {
    const w = window.__app.world;
    const e = [...w.books.entries.values()].find((x) => !x.hidden);
    if (!e) return { err: 'no book' };
    w.actions.goToBook(e.book.id);
    w.frame(); w.actions.rayTimer = 0; w.actions.update(0.01);
    const before = w.actions.target?.book?.id;
    w.actions.act('E');
    for (let i = 0; i < 60; i++) w.actions.update(0.05);
    return { id: e.book.id, title: e.book.title, targeted: before === e.book.id, basket: [...w.actions.basket] };
  });
  log('TAKE ' + JSON.stringify(taken));
  await settle(6); await shot(tag + 'f-took');

  // --- sit at the reading table ------------------------------------------------------------
  await page.evaluate(() => {
    const w = window.__app.world;
    const seat = w.seats.get('table1a');
    w.player.transition = null; w.player.setPose(seat.standPos.x, seat.standPos.z, seat.standYaw, 0);
    w.actions.sit('table1a');
    for (let i = 0; i < 40; i++) { w.player.update(0.05); w.actions.update(0.05); }
  });
  await sleep(700);
  await page.evaluate(() => { const w = window.__app.world; for (let i = 0; i < 40; i++) w.actions.update(0.05); });
  await settle(6); await shot(tag + 'f-seated');
  const tableBooks = await page.evaluate(() => [...window.__app.world.actions.tableBooks.keys()]);
  log('TABLEBOOKS ' + JSON.stringify(tableBooks));

  // --- read it -------------------------------------------------------------------------------
  if (taken.id) {
    await page.evaluate((id) => window.__app.world.opts.onInteract('read', { id }), taken.id);
    await sleep(7000);
    await shot(tag + 'f-reader');
    const readerInfo = await page.evaluate(() => {
      const el = document.querySelector('.rd-view, .panel');
      return { panel: !!document.querySelector('.panel'), text: (document.body.innerText || '').slice(0, 160).replace(/\s+/g, ' ') };
    });
    log('READER ' + JSON.stringify(readerInfo));
    await page.keyboard.press('ArrowRight'); await sleep(1200);
    await shot(tag + 'f-reader2');
    await page.keyboard.press('Escape'); await sleep(1500);
  }

  // --- stand up and hand everything back ------------------------------------------------------
  await page.evaluate(() => {
    const w = window.__app.world;
    w.actions.stand();
    for (let i = 0; i < 40; i++) { w.player.update(0.05); w.actions.update(0.05); }
  });
  await settle(4);
  await page.evaluate(() => window.__app.world.opts.onInteract('return', {}));
  await sleep(2500);
  const recent = await page.evaluate(() => {
    const w = window.__app.world;
    const rc = w.layout.bookcases.find((b) => b.recent);
    return {
      stateRecent: window.__app.state.recent.slice(0, 5),
      onRecentShelf: rc ? rc.rows.flatMap((r) => r.items.map((i) => i.id)) : null,
      basket: [...w.actions.basket],
    };
  });
  log('RECENT ' + JSON.stringify(recent));
  await page.evaluate(() => { const w = window.__app.world; const p = w.places.find((x) => x.id === 'recent'); if (p) { w.player.transition = null; w.player.setPose(p.x, p.z, p.yaw, 0.02); } });
  await settle(10); await shot(tag + 'f-recent-shelf');

  // --- every panel opens and closes without throwing --------------------------------------------
  for (const name of ['computer', 'news', 'records', 'basket', 'settings', 'catalog', 'wiki', 'podcasts', 'chess', 'watercolor', 'gallery', 'audiobooks', 'menu']) {
    const before = errors.length;
    await page.evaluate((n) => window.__app.openPanel(n, {}), name);
    await sleep(3200);
    await shot(tag + 'p-' + name);
    const ok = await page.evaluate(() => !!document.querySelector('#panels .panel, #panels .panel-layer'));
    log('PANEL ' + name + ' mounted=' + ok + ' newErrors=' + (errors.length - before));
    await page.evaluate(() => window.__app.closeAllPanels());
    await sleep(600);
  }

  log('ERRORS ' + JSON.stringify(errors.slice(0, 25), null, 1));
};
