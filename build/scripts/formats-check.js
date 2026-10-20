// Real book formats: covers must be extracted, PDFs and EPUBs must open in the reader.
module.exports = async ({ page, shot, sleep }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => { const b = window.__app.state.library.books; return { n: b.length, covers: b.filter((x) => x.hasCover).length, active: !!window.__app.state.library.scan?.active }; });
    if (!st.active && st.n >= 28 && st.covers >= 20) break;
    await sleep(2500);
  }
  const lib = await page.evaluate(() => {
    const b = window.__app.state.library.books;
    const byFmt = {};
    for (const x of b) byFmt[x.format] = (byFmt[x.format] || 0) + 1;
    return {
      total: b.length, byFmt,
      withCover: b.filter((x) => x.hasCover).length,
      withPages: b.filter((x) => x.pageCount > 0).length,
      withTitle: b.filter((x) => x.title && !/^\d\d /.test(x.title)).length,
      sample: b.slice(0, 3).map((x) => ({ t: x.title, a: x.author, f: x.format, p: x.pageCount, c: !!x.hasCover, d: x.department })),
    };
  });
  console.log('LIB ' + JSON.stringify(lib));

  for (const fmt of ['pdf', 'epub']) {
    const id = await page.evaluate((f) => (window.__app.state.library.books.find((b) => b.format === f) || {}).id, fmt);
    if (!id) { console.log('NO ' + fmt); continue; }
    await page.evaluate((i) => window.__app.ctx.openPanel('reader', { id: i }), id);
    await sleep(9000);
    await shot('fmt-' + fmt);
    const info = await page.evaluate(() => {
      const v = document.querySelector('.rd-view');
      return { view: !!v, text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 150) };
    });
    console.log('READER-' + fmt + ' ' + JSON.stringify(info));
    await page.keyboard.press('ArrowRight'); await sleep(1800); await shot('fmt-' + fmt + '-2');
    await page.keyboard.press('Escape'); await sleep(1500);
  }
  await page.evaluate(() => { const w = window.__app.world; w.player.transition = null; const e = [...w.books.entries.values()][0]; if (e) { const p = e.pos.clone().addScaledVector(e.forward, 0.8); w.player.setPose(p.x, p.z, Math.atan2(e.forward.x, e.forward.z), Math.atan2(e.pos.y - 1.62, 0.8)); } });
  for (let i = 0; i < 14; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(45); }
  await shot('fmt-shelf');
  console.log('ERRORS ' + JSON.stringify(errors.slice(0, 10)));
};
