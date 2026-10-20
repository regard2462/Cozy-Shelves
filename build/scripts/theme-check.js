// Check: the appearance (Hell, Sepia, Dunkel) of the last session is there from the first paint on.
// Run twice with the same COZYSHELVES_USERDATA:
//   THEME_SET=dark node build/screenshot.js theme-check   stores the appearance through the settings, as a user would
//   node build/screenshot.js theme-check                  a new start: the theme on <html> at DOMContentLoaded, the
//                                                         colours of the loading screen and the window background
// Without COZYSHELVES_QUERY=theme=… (that would override the stored value).
module.exports = async ({ app, page, shot, sleep }) => {
  const set = process.env.THEME_SET;
  // as early as the harness gets the page: the loading screen is still up
  const early = await page.evaluate(() => {
    const cs = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el) : null; };
    return {
      theme: document.documentElement.dataset.theme || null,
      readyState: document.readyState,
      loading: !!document.querySelector('#loading:not(.hidden)'),
      htmlBg: cs('html')?.backgroundColor, fadeBg: cs('#fade')?.backgroundColor, loadingColor: cs('#loading')?.color,
      mirror: (() => { try { return localStorage.getItem('lesesaal.theme'); } catch { return null; } })(),
    };
  });
  const windowBg = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getBackgroundColor()).join(','));
  console.log('EARLY ' + JSON.stringify(early) + ' window=' + windowBg);
  await shot('theme-early');
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  const stored = await page.evaluate(async () => (await window.api.settings.get()).ui?.theme);
  console.log('STORED ' + stored + ' html=' + await page.evaluate(() => document.documentElement.dataset.theme));
  await shot('theme-menu');
  if (set) {
    await page.evaluate((t) => window.api.settings.set({ ui: { theme: t } }), set);
    await sleep(3200);   // the store writes at the latest 2.5 s after a change
    console.log('SET ' + set + ' html=' + await page.evaluate(() => document.documentElement.dataset.theme));
  }
};
