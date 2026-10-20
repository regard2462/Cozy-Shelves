// The app ends when the harness closes it while the full-text index reads books in its hidden window (0.7: a job on
// its way used to open a new reading window during the quit, and the process stayed, invisible, with the
// single-instance lock). Run with COZYSHELVES_FULLTEXT_DELAY=0 and a library with text; the caller checks that the
// process is gone after the harness's app.close().
module.exports = async ({ app, page, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  let windows = 0;
  for (let i = 0; i < 120 && windows < 3; i++) { windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length); if (windows < 3) await sleep(500); }
  await sleep(1500);
  console.log(`QUIT-CLOSE windows while the index reads: ${windows}`);
};
