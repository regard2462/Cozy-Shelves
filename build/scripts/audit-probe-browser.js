// Probe: does a <webview> render inside a .panel-layer (backdrop-filter) and outside of one?
const kit = require('./audit-lib');

module.exports = async (env) => {
  const k = kit(env);
  const { page, shot, sleep, log } = k;
  await k.boot();
  // 1) as a panel (openPanel) – the way the I key, the menu and every link open it
  await k.open('browser', { url: 'https://example.org/' }, 7000);
  await shot('p-panel');
  await page.evaluate(() => { const l = document.querySelector('.panel-layer[data-panel="browser"]'); if (l) { l.style.backdropFilter = 'none'; l.style.webkitBackdropFilter = 'none'; } });
  await sleep(1500);
  await shot('p-panel-nofilter');
  await k.closeAll();
  // 2) the old catalogue way: a layer next to the panel layers
  await page.evaluate(async () => {
    const layer = document.createElement('div'); layer.className = 'br-layer'; document.getElementById('panels').appendChild(layer);
    const mod = await import('./ui/browser/browser-panel.js');
    window.__probe = mod.createBrowser(layer, window.__app.ctx, { url: 'https://example.org/', onClose: () => layer.remove() });
  }).catch((e) => log('probe import failed ' + e.message));
  await sleep(7000);
  await shot('p-layer');
  log('ERRORS ' + JSON.stringify(k.errors.slice(0, 10)));
};
