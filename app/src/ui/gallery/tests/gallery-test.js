// Gallery interaction test: stubs saved paintings with generated pictures, switches modes, opens the delete confirm.
const fs = require('fs'); const path = require('path');
module.exports = async ({ page, shot }) => {
  const files = ['mountain-lake', 'sunset-sea', 'lily-pond', 'meadow', 'sailboat'].map((n) => path.join('shots', `dev-wc-gen-${n}.png`)).filter((f) => fs.existsSync(f));
  const urls = files.map((f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64'));
  await page.evaluate(async (urls) => {
    const api = window.__ctx.api;
    let items = urls.map((url, i) => ({ path: '/mock/paintings/bild-' + i + '.png', name: ['Berge_am_See', 'Abend_am_Meer', 'Seerosen', 'Wiese', 'Segelboot'][i] + '-2026-09-15-10-0' + i + '.png', url, mtime: Date.now() - i * 864e5 }));
    api.files.paintings = async () => items;
    api.files.deletePainting = async (p) => { items = items.filter((x) => x.path !== p); return true; };
    api.files.pickFolder = async () => 'C:/Bilder/Aquarelle';
    window.__hung = []; window.__ctx.bus.on('gallery:hang', (p) => window.__hung.push(p));
    await window.__openPanel('gallery', {});
  }, urls);
  await page.waitForTimeout(600);
  await shot('dev-gallery-grid');
  await page.click('.gal-mode[data-mode="own"]'); await page.waitForTimeout(300);
  const settings = await page.evaluate(async () => (await window.__ctx.api.settings.get()).paintings);
  console.log('settings.paintings', JSON.stringify(settings));
  await page.click('.gal-card .btn.primary'); await page.waitForTimeout(200);
  console.log('hung', await page.evaluate(() => window.__hung.map((h) => h.title)));
  await page.click('.gal-card .btn.ghost'); await page.waitForTimeout(300);
  await shot('dev-gallery-confirm');
  await page.click('.gal-confirm .btn.primary'); await page.waitForTimeout(300);
  console.log('cards after delete', await page.evaluate(() => document.querySelectorAll('.gal-card').length));
};
