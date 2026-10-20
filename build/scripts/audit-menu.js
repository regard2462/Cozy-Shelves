// Audit: start menu (guide, new Mediathek/Lesebrowser buttons, places), computer desktop programmes and the
// link routing of news / wiki into the reading browser. Checks the panel stack after every step.
const kit = require('./audit-lib');

module.exports = async (env) => {
  const k = kit(env);
  const { page, shot, sleep, log } = k;
  const stack = () => page.evaluate(() => [...document.querySelectorAll('#panels .panel-layer:not(.closing)')].map((l) => l.dataset.panel));
  const press = async (key, wait = 500) => { await page.keyboard.press(key); await sleep(wait); };

  // --- start screen (not entered) ---------------------------------------------------------------------
  await k.boot({ enter: false });
  log('START-BUTTONS ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.menu-btn')].map((b) => b.textContent.trim()))));
  await k.clickText('.menu-btn', 'Mediathek', 1800);
  log('STACK after Mediathek from start: ' + JSON.stringify(await stack()));
  await press('Escape', 900);
  log('STACK after Esc: ' + JSON.stringify(await stack()) + ' entered=' + await page.evaluate(() => window.__app.state.entered));
  await k.clickText('.menu-btn', 'Lesebrowser', 2500);
  log('STACK after Lesebrowser from start: ' + JSON.stringify(await stack()));
  await shot('m-start-browser');
  await press('Escape', 900);
  log('STACK after Esc: ' + JSON.stringify(await stack()));

  for (const [w, hh] of [[1600, 900], [1024, 640]]) {
    await k.setSize(w, hh);
    await k.clickText('.menu-btn', 'Anleitung', 600);
    await shot(`m-${w}-guide`);
    const fits = await page.evaluate(() => { const l = document.querySelector('.menu-left'); return { scroll: l.scrollHeight, client: l.clientHeight }; });
    log(`MENU-LEFT ${w}x${hh} ` + JSON.stringify(fits));
    await k.clickText('.menu-btn', 'Orte', 500);
    await shot(`m-${w}-places`);
  }
  await k.setSize(1600, 900);
  await page.evaluate(() => window.__app.ctx.api.settings.set({ language: 'en' }));
  await sleep(800);
  await k.clickText('.menu-btn', 'Guide', 600);
  await shot('m-1600-guide-en');
  await page.evaluate(() => window.__app.ctx.api.settings.set({ language: 'de' }));
  await sleep(800);

  // --- enter, then the menu gives way ----------------------------------------------------------------------
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  await sleep(900);
  await page.evaluate(() => window.__app.world.stop());
  await k.open('menu', {}, 800);
  await k.clickText('.menu-btn', 'Mediathek', 1500);
  log('STACK after Mediathek when entered: ' + JSON.stringify(await stack()));
  await k.closeAll();

  // --- computer desktop -------------------------------------------------------------------------------------
  await k.open('computer', {}, 1500);
  await shot('m-computer-desktop');
  log('COMPUTER-CARDS ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.term-ov .term-ov-title, .term-app .term-app-title')].map((e) => e.textContent))));
  log('COMPUTER-HINTS ' + await k.text('.term-status-hints'));
  await press('7', 2500);
  log('STACK after 7: ' + JSON.stringify(await stack()));
  await press('Escape', 800);
  await k.clickText('.term-nav-item', 'Mediathek', 1500);
  log('STACK after sidebar Mediathek: ' + JSON.stringify(await stack()));
  await press('Escape', 800);
  log('STACK after Esc: ' + JSON.stringify(await stack()));
  await k.setSize(1024, 640);
  await sleep(400);
  await shot('m-computer-desktop-1024');
  await k.setSize(1600, 900);
  await k.closeAll();

  // --- news: a link inside an article opens the reading browser ---------------------------------------------
  await k.open('news', {}, 6000);
  await page.evaluate(() => document.querySelector('.news-item')?.click());
  await sleep(6000);
  const newsLink = await page.evaluate(() => { const a = document.querySelector('.news-art-body a[href^="http"]'); if (!a) return null; const href = a.href; a.click(); return href; });
  await sleep(2500);
  log('NEWS link=' + newsLink + ' stack=' + JSON.stringify(await stack()) + ' browserUrl=' + await page.evaluate(() => document.querySelector('.br-address')?.value || null));
  await shot('m-news-link');
  await k.closeAll();

  // --- wiki: external reference → browser, same-language wikipedia URL stays in the lexicon ----------------
  await k.open('wiki', { title: 'Johann Wolfgang von Goethe' }, 8000);
  const wikiExt = await page.evaluate(() => { const a = document.querySelector('.wiki-content a[data-ext]'); if (!a) return null; const href = a.getAttribute('href'); a.click(); return href; });
  await sleep(2500);
  log('WIKI ext=' + wikiExt + ' stack=' + JSON.stringify(await stack()));
  await k.closeAll();
  log('ERRORS ' + JSON.stringify(k.errors.slice(0, 20), null, 1));
};
