// Audit: easel and gallery. A few strokes with the mouse, a title with umlauts, save, the gallery shows the picture
// with that title, "Aufhängen" sends gallery:hang, delete asks first and removes the file, the wall picture mode
// is stored in the settings. Also the layout of both panels at two window sizes.
const kit = require('./audit-lib');

module.exports = async (env) => {
  const k = kit(env);
  const { page, shot, sleep, log } = k;
  await k.boot();
  const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()).slice(-3));
  const paintings = () => page.evaluate(async () => (await window.api.files.paintings()).map((p) => p.name));
  await page.evaluate(() => { window.__hung = []; window.__app.ctx.bus.on('gallery:hang', (p) => window.__hung.push({ title: p.title, url: String(p.url).slice(0, 12), slot: p.slot })); });

  // ---- easel -------------------------------------------------------------------------------------------------------
  await k.open('watercolor', {}, 4000);
  const box = await page.evaluate(() => { const c = document.querySelector('.wc-canvas')?.getBoundingClientRect(); return c ? { x: c.x, y: c.y, w: c.width, h: c.height } : null; });
  log('EASEL canvas=' + JSON.stringify(box) + ' brushes=' + await k.count('.wc-brush') + ' swatches=' + await k.count('.wc-swatch'));
  if (box) {
    await page.evaluate(() => document.querySelector('.wc-swatch[data-idx="5"]')?.click());
    const at = (fx, fy) => [box.x + box.w * fx, box.y + box.h * fy];
    await page.mouse.move(...at(0.2, 0.3)); await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(...at(0.2 + i * 0.06, 0.3 + (i % 2) * 0.1), { steps: 6 });
    await page.mouse.up();
    await sleep(1500);
  }
  const inked = await page.evaluate(() => { const c = document.querySelector('.wc-canvas'); if (!c) return null; const d = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data; if (!d) return 'no 2d context'; let n = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] < 200 || d[i + 2] < 200) n++; return n; });
  log('PAINTED non-paper samples=' + inked);
  await page.evaluate(() => { const t = document.querySelector('.wc-title'); t.value = 'Blühende Wiese am Fluss'; t.dispatchEvent(new Event('input')); });
  const before = (await paintings()).length;
  await k.clickText('.wc-panel .btn', 'Speichern', 1500);
  const names = await paintings();
  log(`SAVED toasts=${JSON.stringify(await toasts())} count ${before} → ${names.length} newest=${names[0]}`);
  await shot('paint-easel');
  await k.closeAll();

  // ---- gallery -------------------------------------------------------------------------------------------------------
  await k.open('gallery', {}, 2000);
  log('GALLERY cards=' + await k.count('.gal-card') + ' titles=' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.gal-title')].map((t) => t.textContent).slice(0, 4))));
  await shot('paint-gallery');
  await k.clickText('.gal-card .btn', 'Aufhängen', 800);
  log('HANG events=' + JSON.stringify(await page.evaluate(() => window.__hung)) + ' toasts=' + JSON.stringify(await toasts()));
  // wall pictures: "Keine Bilder" is stored, then back to the generated ones
  await page.evaluate(() => document.querySelector('.gal-mode[data-mode="off"]')?.click()); await sleep(600);
  const modeOff = await page.evaluate(async () => (await window.api.settings.get()).paintings?.mode);
  await page.evaluate(() => document.querySelector('.gal-mode[data-mode="impressionist"]')?.click()); await sleep(600);
  const modeBack = await page.evaluate(async () => (await window.api.settings.get()).paintings?.mode);
  log(`MODE off=${modeOff} back=${modeBack}`);
  // delete: the confirmation first, Escape keeps the picture, then delete for real
  await page.evaluate(() => document.querySelector('.gal-card .btn.ghost')?.click()); await sleep(400);
  log('CONFIRM shown=' + await k.exists('.gal-confirm'));
  await page.keyboard.press('Escape'); await sleep(300);
  log('ESC confirm=' + await k.exists('.gal-confirm') + ' panel=' + await k.exists('.gal-panel') + ' cards=' + await k.count('.gal-card'));
  await page.evaluate(() => document.querySelector('.gal-card .btn.ghost')?.click()); await sleep(300);
  await page.evaluate(() => document.querySelector('.gal-confirm .btn.primary')?.click()); await sleep(800);
  log(`DELETED cards=${await k.count('.gal-card')} files=${(await paintings()).length} toasts=${JSON.stringify(await toasts())}`);
  await k.closeAll();

  for (const [w, hh] of [[1024, 640], [2560, 1440]]) {
    await k.setSize(w, hh);
    for (const name of ['watercolor', 'gallery']) {
      await k.open(name, {}, 3000);
      await shot(`paint-${w}-${name}`);
      log(`SIZE ${w}x${hh} ${name} overflow=${JSON.stringify(await k.overflow())}`);
      await k.closeAll();
    }
  }
  log('ERRORS ' + JSON.stringify(k.errors.slice(0, 20), null, 1));
};
