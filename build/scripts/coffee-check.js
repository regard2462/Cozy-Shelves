// Check: the "Buy me a coffee" link at the end of Einstellungen → Allgemein. It is shown in both languages, and a
// click opens the address outside the app. Nothing is really opened:
//   node build/screenshot.js coffee-check   the desktop app: shell.openExternal is replaced in the main process, the
//                                            click must arrive there through app:openExternal
//   node build/web-shot.js coffee-check     the browser version: window.open is replaced in the page, the click must
//                                            ask it for a new tab
const URL = 'https://buymeacoffee.com/regard2462';

module.exports = async ({ app, page, shot, sleep, baseUrl }) => {
  const web = !app;
  let failed = 0, total = 0;
  const check = (name, ok, info) => { total++; if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); };

  if (web) await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  else await app.evaluate(({ shell }) => { globalThis.__opened = []; shell.openExternal = async (u) => { globalThis.__opened.push(String(u)); }; });
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  // window.open: in the desktop app it must not be called, in the browser version it is the way out
  await page.evaluate(() => { globalThis.__winOpen = []; window.open = (...a) => { globalThis.__winOpen.push(a.map(String)); return null; }; });
  const opened = async () => {
    for (let i = 0; i < 20; i++) {
      await sleep(150);
      const got = web ? await page.evaluate(() => globalThis.__winOpen.splice(0)) : await app.evaluate(() => globalThis.__opened.splice(0));
      if (got.length) return got;
    }
    return [];
  };

  for (const lang of ['de', 'en']) {
    await page.evaluate((l) => window.__app.ctx.api.settings.set({ language: l }), lang);
    await page.waitForFunction((l) => window.__app.ctx.i18n?.lang === l, lang, { timeout: 20000 });
    await page.evaluate(() => window.__app.openPanel('settings', { section: 'general' }));
    await page.waitForSelector('.settings-panel .coffee-link', { timeout: 20000 });
    await page.waitForFunction(() => /\d/.test(document.querySelector('.settings-version')?.textContent || ''), null, { timeout: 10000 }).catch(() => {});
    const info = await page.evaluate(() => {
      const b = document.querySelector('.settings-panel .coffee-link');
      b.scrollIntoView({ block: 'center' });
      const badge = getComputedStyle(b.querySelector('.coffee-badge'));
      return { text: b.innerText.replace(/\s+/g, ' ').trim(), title: b.title, badge: badge.backgroundColor, radius: badge.borderRadius,
        group: [...document.querySelectorAll('.settings-panel .settings-group')].map((g) => g.textContent).pop(), version: document.querySelector('.settings-version')?.textContent };
    });
    console.log('INFO ' + lang + ' ' + JSON.stringify(info));
    const sub = lang === 'de' ? 'Die App unterstützen, wenn sie dir gefällt' : 'Support the app if you like it';
    check(`${lang}: title and subtitle`, info.text.includes('Buy me a coffee') && info.text.includes(sub), info.text);
    check(`${lang}: yellow round badge`, info.badge === 'rgb(255, 221, 0)' && info.radius === '50%', [info.badge, info.radius]);
    check(`${lang}: under About`, /Cozy Shelves/.test(info.group || ''), info.group);
    check(`${lang}: version line`, /Cozy Shelves \d+\.\d+\.\d+/.test(info.version || ''), info.version);
    await sleep(400);
    await shot(`coffee-settings-${lang}`);

    await page.click('.settings-panel .coffee-link');
    const got = await opened();
    if (web) check(`${lang}: click opens ${URL} in a new tab`, got.length === 1 && got[0][0] === URL && got[0][1] === '_blank', got);
    else {
      check(`${lang}: click opens ${URL} through shell.openExternal`, got.length === 1 && got[0] === URL, got);
      check(`${lang}: no window.open in the app`, (await page.evaluate(() => globalThis.__winOpen.length)) === 0);
    }
    check(`${lang}: the settings stay open`, await page.evaluate(() => !!document.querySelector('.settings-panel')));
    await page.evaluate(() => window.__app.closeAllPanels?.());
    await sleep(300);
  }
  await page.evaluate(() => window.__app.ctx.api.settings.set({ language: 'de' }));
  console.log(`COFFEE-CHECK ${total - failed}/${total} passed`);
};
