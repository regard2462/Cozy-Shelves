// Shelf labels sit on the front edge of the board and are readable; the back corner has no ladder any more.
module.exports = async ({ page, shot, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  await sleep(6000);
  await page.evaluate(() => window.__app.world.stop());
  // stand in front of the first case that has a section label
  const target = await page.evaluate(() => {
    const w = window.__app.world;
    for (const bc of w.layout.bookcases) for (const row of bc.rows) if (row.section && row.items.length && bc.x > 5) {
      const obj = w.bookcaseObjects.get(bc.id); const e = w.books.entry(row.items[0].id);
      return { x: e.pos.x + e.forward.x * 0.9, z: e.pos.z + e.forward.z * 0.9, yaw: Math.atan2(e.forward.x, e.forward.z), y: row.y, section: row.section };
    }
    return null;
  });
  console.log('LABEL ' + JSON.stringify(target));
  if (target) {
    await page.evaluate((t) => { const w = window.__app.world; w.player.transition = null; w.player.setPose(t.x, t.z, t.yaw, Math.atan2(t.y - 1.62, 0.9)); }, target);
    for (let i = 0; i < 8; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(150); }
    await shot('label-close');
  }
  const ladder = await page.evaluate(() => window.__app.world.layout.placements.filter((p) => p.kind === 'ladder').length);
  console.log('LADDERS ' + ladder);
  await page.evaluate(() => { const w = window.__app.world; w.player.transition = null; w.player.setPose(7.6, -20.4, -Math.PI * 0.8, -0.05); });
  for (let i = 0; i < 8; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(150); }
  await shot('corner-no-ladder');
};
