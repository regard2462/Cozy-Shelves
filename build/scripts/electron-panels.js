module.exports = async ({ win, shot, sleep }) => {
  const page = win;
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 180000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  await sleep(500);
  const firstId = await page.evaluate(() => window.__app.state.library.books[0].id);
  const panels = [['news', {}], ['wiki', {}], ['podcasts', {}], ['catalog', {}], ['chess', { bookId: firstId }], ['watercolor', {}], ['gallery', {}], ['records', {}], ['bookinfo', { id: firstId }], ['basket', {}], ['settings', {}], ['menu', { tab: 'places' }], ['menu', { tab: 'recent' }], ['computer', { section: 'games' }]];
  for (const [name, params] of panels) {
    const errs = [];
    const h = (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); };
    page.on('console', h);
    await page.evaluate(([n, p]) => window.__app.openPanel(n, p), [name, params]);
    await sleep(name === 'watercolor' ? 8000 : 3500);
    await shot('elp-' + name + (params.tab ? '-' + params.tab : '') + (params.section ? '-' + params.section : ''));
    page.off('console', h);
    const hasError = await page.evaluate(() => !!document.querySelector('.panel-error'));
    console.log(name, hasError ? 'PANEL ERROR' : 'ok', errs.length ? '| console errors: ' + errs.join(' || ') : '');
    await page.evaluate(() => window.__app.closeAllPanels()); await sleep(400);
  }
};
