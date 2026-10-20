module.exports = async ({ page, shot, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  await sleep(2000);
  await page.evaluate(() => window.__app.openPanel('settings', { section: 'tts' }));
  await sleep(4000);
  const v = await page.evaluate(() => {
    const sels = [...document.querySelectorAll('select.input')];
    return sels.map((s) => ({ label: s.getAttribute('aria-label'), options: [...s.options].map((o) => o.value + ' = ' + o.textContent) }));
  });
  console.log('VOICES ' + JSON.stringify(v, null, 1));
  await shot('voices');
};
