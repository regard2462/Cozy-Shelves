// Probe: stack trace of the page error that opening a Markdown / HTML book raises.
const kit = require('./audit-lib');

module.exports = async (env) => {
  const k = kit(env);
  const { page, sleep, log } = k;
  await k.boot();
  await page.evaluate(() => {
    window.__errs = [];
    window.addEventListener('error', (e) => window.__errs.push(String(e.error?.stack || e.message)));
  });
  for (const fmt of ['md', 'html', 'docx']) {
    const id = await page.evaluate((f) => window.__app.state.library.books.find((b) => b.format === f)?.id, fmt);
    k.newErrors();
    await page.evaluate((i) => window.api.library.update(i, { lastLocation: null, progress: 0 }), id);
    await k.open('reader', { id }, 6000);
    log(fmt + ' open ' + JSON.stringify(k.newErrors()) + ' ' + JSON.stringify(await page.evaluate(() => window.__errs.splice(0))));
    await page.keyboard.press('ArrowRight'); await sleep(1600);
    log(fmt + ' turn ' + JSON.stringify(k.newErrors()) + ' ' + JSON.stringify(await page.evaluate(() => window.__errs.splice(0))));
    await page.keyboard.press('t'); await sleep(700);
    log(fmt + ' toc ' + JSON.stringify(k.newErrors()) + ' ' + JSON.stringify(await page.evaluate(() => window.__errs.splice(0))));
    await page.keyboard.press('Escape'); await sleep(400);
    await page.keyboard.press('Escape'); await sleep(900);
    log(fmt + ' close ' + JSON.stringify(k.newErrors()) + ' ' + JSON.stringify(await page.evaluate(() => window.__errs.splice(0))));
  }
};
