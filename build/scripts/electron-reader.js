module.exports = async ({ win, shot, sleep }) => {
  const page = win;
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 180000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  await sleep(500);
  const ids = await page.evaluate(() => window.__app.state.library.books.map((b) => [b.id, b.format, b.title]));
  console.log(JSON.stringify(ids));
  const epub = ids.find((b) => b[1] === 'epub'), pdf = ids.find((b) => b[1] === 'pdf'), txt = ids.find((b) => b[1] === 'txt');
  for (const [name, b] of [['epub', epub], ['pdf', pdf], ['txt', txt]]) {
    if (!b) continue;
    const t0 = Date.now();
    await page.evaluate((id) => window.__app.openPanel('reader', { id }), b[0]);
    try { await page.waitForFunction(() => !document.querySelector('.rd-loading'), null, { timeout: 60000 }); } catch (e) { console.log(name, 'still loading after 60s'); }
    console.log(name, 'opened in', Date.now() - t0, 'ms');
    await sleep(1500); await shot('el-reader-' + name);
    await page.keyboard.press('ArrowRight'); await sleep(1200); await shot('el-reader-' + name + '-2');
    await page.keyboard.press('KeyT'); await sleep(800); await shot('el-reader-' + name + '-sidebar');
    await page.evaluate(() => window.__app.closeAllPanels()); await sleep(500);
  }
};
