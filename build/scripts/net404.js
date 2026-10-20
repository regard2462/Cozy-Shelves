// Which requests fail with 404 during start-up?
module.exports = async ({ page, sleep }) => {
  const bad = [];
  page.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(0, 140)); });
  page.on('requestfailed', (r) => bad.push('FAILED ' + r.url().slice(0, 140) + ' ' + (r.failure()?.errorText || '')));
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  await sleep(8000);
  console.log('BAD ' + JSON.stringify(bad, null, 0));
};
