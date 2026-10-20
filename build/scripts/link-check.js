// The headline request: a hyperlink inside a book must NOT open the system browser.
module.exports = async ({ page, shot, sleep }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2500);
  }
  // spy on openExternal: nothing may reach it
  await page.evaluate(() => {
    window.__ext = [];
    const orig = window.api.app.openExternal;
    window.api.app.openExternal = (u) => { window.__ext.push(u); return orig ? orig(u) : undefined; };
  });
  const id = await page.evaluate(() => (window.__app.state.library.books.find((b) => b.format === 'epub') || {}).id);
  console.log('EPUB ' + id);
  await page.evaluate((i) => window.__app.ctx.openPanel('reader', { id: i }), id);
  await sleep(9000);
  await shot('lk-book');

  // Playwright sees every frame, including those inside shadow roots
  const frames = page.frames();
  console.log('FRAMES ' + frames.length + ' ' + JSON.stringify(frames.map((f) => (f.url() || '').slice(0, 50))));
  let clicked = null;
  for (const f of frames) {
    try {
      const a = await f.$('a[href^="http"]');
      if (!a) continue;
      clicked = await a.getAttribute('href');
      await a.click({ force: true });
      break;
    } catch (e) { /* detached frame */ }
  }
  console.log('CLICK ' + JSON.stringify(clicked));
  await sleep(10000);
  await shot('lk-after');
  const after = await page.evaluate(() => ({
    external: window.__ext,
    crumbs: [...document.querySelectorAll('.rd-crumbs, .rd-crumb, .rd-breadcrumbs')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()).slice(0, 3),
    body: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 260),
  }));
  console.log('AFTER ' + JSON.stringify(after));
  await page.keyboard.press('Alt+ArrowLeft'); await sleep(4000);
  await shot('lk-back');
  const back = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 160));
  console.log('BACK ' + JSON.stringify(back));
  console.log('ERRORS ' + JSON.stringify(errors.slice(0, 6)));
};
