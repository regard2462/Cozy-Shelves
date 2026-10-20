// Final acceptance pass: the in-app browser, the German voices, the settings sections,
// the games list and the chess trainer.
module.exports = async ({ page, shot, sleep }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  await sleep(1500);
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }

  // --- the in-app browser is a real panel now -------------------------------------------
  await page.evaluate(() => window.__app.openPanel('browser', { url: 'https://example.org/' }));
  await sleep(6000);
  await shot('x-browser');
  const br = await page.evaluate(() => ({
    mounted: !!document.querySelector('#panels webview, #panels .br-root, #panels .browser-root, #panels [class*=browser]'),
    text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 220),
  }));
  console.log('BROWSER ' + JSON.stringify(br));
  await page.evaluate(() => window.__app.closeAllPanels()); await sleep(800);

  // --- TTS: the German voice list must be Piper/Thorsten, not Kartoffelbox ----------------
  const tts = await page.evaluate(async () => {
    try {
      const m = await import('./ui/reader/tts-client.js');
      const c = m.ttsClient;
      const de = await c.voices('de');
      const en = await c.voices('en');
      const st = await c.status();
      return { de: (de || []).slice(0, 12).map((v) => v.id + (v.engine ? ':' + v.engine : '')), enCount: (en || []).length, status: st };
    } catch (e) { return { err: String(e).slice(0, 200) }; }
  });
  console.log('TTS ' + JSON.stringify(tts));

  // --- settings sections ------------------------------------------------------------------
  for (const section of ['graphics', 'light', 'audio', 'tts', 'folders']) {
    await page.evaluate((s) => window.__app.openPanel('settings', { section: s }), section);
    await sleep(1600);
    await shot('x-settings-' + section);
    await page.evaluate(() => window.__app.closeAllPanels()); await sleep(400);
  }

  // --- the computer's games section --------------------------------------------------------
  await page.evaluate(() => window.__app.openPanel('computer', { section: 'games' }));
  await sleep(2500); await shot('x-games');
  const games = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 420));
  console.log('GAMES ' + JSON.stringify(games));
  await page.evaluate(() => window.__app.closeAllPanels()); await sleep(600);

  // --- chess: play + puzzles ----------------------------------------------------------------
  for (const mode of ['play', 'puzzles']) {
    await page.evaluate((m) => window.__app.openPanel('chess', { mode: m }), mode);
    await sleep(4000); await shot('x-chess-' + mode);
    const txt = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 260));
    console.log('CHESS ' + mode + ' ' + JSON.stringify(txt));
    await page.evaluate(() => window.__app.closeAllPanels()); await sleep(600);
  }

  // --- one game actually plays ----------------------------------------------------------------
  await page.evaluate(() => window.__app.openPanel('computer', { section: 'games', game: 'go' }));
  await sleep(3500); await shot('x-go');
  await page.evaluate(() => window.__app.closeAllPanels()); await sleep(500);

  console.log('ERRORS ' + JSON.stringify(errors.slice(0, 12)));
};
