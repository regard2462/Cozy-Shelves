module.exports = async ({ page, shot, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 180000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  await sleep(800);
  const rooms = await page.evaluate(() => { const w = window.__app.world; w.stop(); return w.layout.rooms.map((r) => ({ id: r.id, name: r.name, cx: (r.x0 + r.x1) / 2, w: r.x1 - r.x0, z1: r.z1, type: r.type, n: r.bookcases.length })); });
  console.log(JSON.stringify(rooms));
  const rows = await page.evaluate(() => window.__app.world.layout.bookcases.slice(0, 4).map((b) => b.rows.map((r) => r.items.length + (r.section ? '(' + r.section + ')' : ''))));
  console.log('rows', JSON.stringify(rows), 'books', await page.evaluate(() => window.__app.state.library.books.length));
  const r = rooms[0];
  await page.evaluate(([x, z]) => { const w = window.__app.world; w.player.setPose(x, z, 0, -0.02); w.frame(); w.frame(); }, [r.cx, r.z1 - 1.0]);
  await sleep(400); await shot('room-shelves');
  // close-up on a shelf
  await page.evaluate(() => { const w = window.__app.world; const e = [...w.books.entries.values()][3]; if (e) { const p = e.pos.clone().addScaledVector(e.forward, 1.2); w.player.setPose(p.x, p.z, Math.atan2(e.forward.x, e.forward.z), -0.08); } w.frame(); w.actions.update(0.2); w.frame(); });
  await sleep(400); await shot('room-closeup');
  const t = await page.evaluate(() => JSON.stringify(window.__app.world.actions.target ? { type: window.__app.world.actions.target.type, title: window.__app.world.actions.target.book?.title } : null));
  console.log('target', t);
  await page.evaluate(() => { const w = window.__app.world; const r = w.layout.rooms[1]; w.player.setPose((r.x0 + r.x1) / 2, r.z1 - 1.2, 0.5, -0.05); w.frame(); w.frame(); });
  await sleep(400); await shot('room-2');
  await page.evaluate(() => { const w = window.__app.world; w.player.setPose(-3.2, -10.3, -Math.PI / 2, 0); w.frame(); w.frame(); });
  await sleep(400); await shot('corridor');
};
