// Full flow in Electron: menu → enter → walk to a shelf → take a book → sit → read → close → stand.
module.exports = async ({ win, shot, sleep }) => {
  const page = win;
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 180000 });
  await page.evaluate(() => window.__app.world.stop());
  await sleep(1500);
  await shot('el-menu');
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  await sleep(1000);
  const st = await page.evaluate(() => ({ books: window.__app.state.library.books.length, rooms: window.__app.world.layout.rooms.map((r) => r.name), entries: window.__app.world.books.entries.size }));
  console.log(JSON.stringify(st));
  // go to the first book
  await page.evaluate(() => { const w = window.__app.world; const e = [...w.books.entries.values()][0]; w.actions.goToBook(e.book.id); w.frame(); w.actions.rayTimer = 0; w.actions.update(0.1); w.frame(); });
  await sleep(500); await shot('el-shelf');
  const target = await page.evaluate(() => { const t = window.__app.world.actions.target; return t ? { type: t.type, title: t.book?.title } : null; });
  console.log('target', JSON.stringify(target));
  // take the book (E) and animate a few frames
  await page.evaluate(async () => { const w = window.__app.world; w.actions.act('E'); for (let i = 0; i < 6; i++) { w.actions.update(0.2); } w.frame(); });
  await sleep(500); await shot('el-take');
  await page.evaluate(async () => { const w = window.__app.world; for (let i = 0; i < 20; i++) { w.actions.update(0.1); } w.frame(); });
  console.log('basket', await page.evaluate(() => JSON.stringify(window.__app.state.basket)));
  // teleport to a table seat and sit
  await page.evaluate(() => { const w = window.__app.world; const seat = w.seats.get('table1a'); w.player.setPose(seat.standPos.x, seat.standPos.z, seat.standYaw, 0); w.actions.sit('table1a'); });
  await sleep(600);
  await page.evaluate(async () => { const w = window.__app.world; for (let i = 0; i < 30; i++) { w.player.update(0.08); w.actions.update(0.08); } w.frame(); });
  await sleep(500); await shot('el-seated');
  // read the first table book via the actions API
  const tb = await page.evaluate(() => [...window.__app.world.actions.tableBooks.keys()][0]);
  console.log('tablebook', tb);
  if (tb) {
    await page.evaluate((id) => window.__app.world.opts.onInteract('read', { id }), tb);
    await sleep(6000); await shot('el-reader');
    await page.keyboard.press('ArrowRight'); await sleep(1500); await shot('el-reader-2');
    await page.keyboard.press('Escape'); await sleep(1500);
    await page.evaluate(async () => { const w = window.__app.world; for (let i = 0; i < 5; i++) { w.actions.update(0.08); } w.frame(); });
    await sleep(500); await shot('el-after-read');
  }
  await page.evaluate(() => window.__app.world.actions.stand());
  await page.evaluate(async () => { const w = window.__app.world; for (let i = 0; i < 25; i++) { w.player.update(0.08); w.actions.update(0.08); } w.frame(); });
  await sleep(300); await shot('el-stood');
  // open the computer, the newspaper and the records panel
  for (const p of ['computer', 'news', 'records', 'basket', 'settings']) { await page.evaluate((n) => window.__app.openPanel(n, {}), p); await sleep(3000); await shot('el-panel-' + p); await page.evaluate(() => window.__app.closeAllPanels()); await sleep(400); }
};
