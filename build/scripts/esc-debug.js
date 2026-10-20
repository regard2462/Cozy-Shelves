// Why does Esc not close the reading browser that was opened from the Fernleihe?
module.exports = async ({ app, page, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  await sleep(3000);
  await page.evaluate(() => window.__app.ctx.openPanel('catalog', {}));
  await page.waitForSelector('.cat-panel', { timeout: 30000 });
  await sleep(1500);
  await page.evaluate(() => [...document.querySelectorAll('.cat-header .btn')].find((b) => /browser/i.test(b.textContent))?.click());
  await page.waitForSelector('.panel-layer[data-panel="browser"] .br-panel', { timeout: 20000 });
  await page.evaluate(() => document.querySelector('.br-panel').__br.navigate('https://example.org/'));
  await sleep(6000);
  const snap = (label) => page.evaluate((label) => ({
    label,
    active: (document.activeElement?.tagName || '') + '.' + (document.activeElement?.className || '').toString().slice(0, 40),
    layers: [...document.querySelectorAll('.panel-layer')].map((l) => l.dataset.panel + (l.classList.contains('closing') ? '(closing)' : '')),
    hint: document.querySelector('.br-hint, .br-toast, [class*="hint"]')?.innerText?.slice(0, 80) || null,
  }), label);
  console.log('S0 ' + JSON.stringify(await snap('before')));
  // native input into the focused guest, the way a real keyboard reaches it
  const esc = () => app.evaluate(({ webContents }) => {
    const g = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && !w.isDestroyed() && w.isFocused?.());
    const any = g || webContents.getAllWebContents().find((w) => w.getType() === 'webview' && !w.isDestroyed());
    if (!any) return 'no guest';
    any.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); any.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    return (g ? 'focused ' : 'first ') + any.getURL();
  });
  console.log('E1 ' + await esc()); await sleep(700);
  console.log('S1 ' + JSON.stringify(await snap('after 1st native Esc')));
  console.log('E2 ' + await esc()); await sleep(1200);
  console.log('S2 ' + JSON.stringify(await snap('after 2nd native Esc')));
};
