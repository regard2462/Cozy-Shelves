// Minimal smoke test: the app starts, the library loads, the world builds, one panel opens.
module.exports = async ({ page, shot, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  await sleep(2500);
  const info = await page.evaluate(() => {
    const w = window.__app.world;
    return { books: window.__app.state.library.books.length, dep: w.department, cases: w.layout.bookcases.length, seats: w.seats.size, places: w.places.length };
  });
  console.log('SMOKE ' + JSON.stringify(info));
  await shot('smoke-world');
  await page.evaluate(() => window.__app.openPanel('computer', {}));
  await sleep(2500);
  await shot('smoke-computer');
  console.log('SMOKE-OK');
};
