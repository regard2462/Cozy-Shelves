// The test window must be invisible to the user (off-screen, no taskbar button, not focused) and
// still render normally, so screenshots keep working.
module.exports = async ({ app, page, shot, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  const info = await app.evaluate(({ BrowserWindow, screen }) => {
    const displays = screen.getAllDisplays().map((d) => d.bounds);
    return { displays, windows: BrowserWindow.getAllWindows().map((w) => ({ title: w.getTitle(), bounds: w.getBounds(), visible: w.isVisible(), focused: w.isFocused() })) };
  });
  console.log('WINDOWS ' + JSON.stringify(info));
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  await sleep(4000);
  const vis = await page.evaluate(() => ({ state: document.visibilityState, raf: new Promise((r) => requestAnimationFrame(() => r(true))) }));
  console.log('PAGE ' + JSON.stringify({ visibility: vis.state }));
  await shot('hidden');
};
