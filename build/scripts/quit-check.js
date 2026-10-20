// Closing the main window ends the app (0.6.1). The hidden indexer window used to keep the process alive, invisible and
// holding the single-instance lock, so every later start of the exe ended at once ("es passiert nichts").
//   COZYSHELVES_BOOKS=<library>|structured COZYSHELVES_USERDATA=<dir> node build/screenshot.js quit-check
// (the harness's own app.close() at the end then finds the app gone: a "Target closed" message after the summary is fine)
module.exports = async ({ app, page, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  // QUIT_WAIT: wait longer first, so that the background windows (indexer, full-text reading) are busy when the window closes
  await sleep(+(process.env.QUIT_WAIT || 1500));
  const proc = app.process();
  let exited = null;
  proc.once('exit', (code) => { exited = code ?? 0; });
  const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((w) => /index\.html/.test(w.webContents.getURL()))?.close(); }).catch(() => {});
  // QUIT_EXIT_WAIT: how long the process may take to end (ms, 15000; software rendering needs longer while a shader
  // compiles, the window closes after it)
  for (let i = 0, n = +(process.env.QUIT_EXIT_WAIT || 15000) / 250; i < n && exited === null; i++) await sleep(250);
  // still running: what holds it (the windows left, whether quitting began); a main process that does not answer is
  // blocked
  if (exited === null) {
    const left = await Promise.race([
      app.evaluate(({ app: a, BrowserWindow }) => ({ quitting: !!a.isQuitting, windows: BrowserWindow.getAllWindows().map((w) => ({ url: w.webContents.getURL().replace(/^.*\//, ''), visible: w.isVisible(), destroyed: w.isDestroyed() })) })).catch((e) => ({ error: e.message })),
      sleep(5000).then(() => ({ error: 'the main process does not answer' })),
    ]);
    console.log('QUIT-LEFT ' + JSON.stringify(left));
  }
  const ok = windows >= 2 && exited !== null;
  console.log(`${ok ? 'PASS' : 'FAIL'} closing the main window ends the app, the hidden indexer window included ${JSON.stringify({ windowsBefore: windows, exit: exited })}`);
  console.log(`QUIT-CHECK ${ok ? 1 : 0}/1 passed`);
};
