// Acceptance of the packaged exe: start, world, Mediathek (real film on the screen), reading browser.
module.exports = async ({ app, page, shot, sleep }) => {
  const errors = [];
  page.on('pageerror', (e) => { if (!/pointer lock/i.test(e.message)) errors.push(e.message); });
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  const ver = await app.evaluate(({ app: a }) => ({ version: a.getVersion(), packaged: a.isPackaged, mute: a.commandLine.hasSwitch('mute-audio') }));
  console.log('APP ' + JSON.stringify(ver));
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  await sleep(6000);
  await page.evaluate(() => window.__app.world.stop());
  const world = await page.evaluate(() => { const w = window.__app.world; return { cases: w.layout.bookcases.length, seats: w.seats.size, cinema: !!w.cinema?.screen, ereader: w.interactables.some((o) => o.userData.interact?.kind === 'browser'), projector: w.interactables.some((o) => o.userData.interact?.kind === 'mediathek') }; });
  console.log('WORLD ' + JSON.stringify(world));
  // Mediathek: open the panel, then a real film onto the screen
  await page.evaluate(() => window.__app.ctx.openPanel('mediathek', {}));
  await page.waitForSelector('.mt-panel', { timeout: 30000 });
  await sleep(4000);
  await shot('pkg-mediathek');
  const item = await page.evaluate(async () => { const r = await window.api.invoke('mediathek:query', { text: 'tagesschau in 100 Sekunden', size: 5 }); return (r.items || [])[0] || null; });
  await page.evaluate(async (it) => { await window.__app.ctx.media.play(it, { mode: 'screen', quality: 'low' }); window.__app.ctx.bus.emit('cinema:watch'); }, item);
  let t = 0; for (let i = 0; i < 30; i++) { t = await page.evaluate(() => window.__app.ctx.media.video.currentTime); if (t > 2) break; await sleep(1000); }
  for (let i = 0; i < 50; i++) await page.evaluate(() => window.__app.world.cinema.update(0.1));
  await page.evaluate(() => { const c = window.__app.world.cinema; for (let i = 0; i < 3; i++) { c.sampleTimer = 0; c.update(0.05); } });
  for (let i = 0; i < 8; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(150); }
  const cin = await page.evaluate(() => { const c = window.__app.world.cinema; return { title: window.__app.ctx.media.current?.title, t: +window.__app.ctx.media.video.currentTime.toFixed(1), drop: c.drop, picture: c.picture, tainted: c.tainted }; });
  console.log('CINEMA ' + JSON.stringify(cin));
  await shot('pkg-cinema');
  await page.evaluate(() => window.__app.ctx.media.stop());
  // reading browser
  await page.evaluate(() => window.__app.ctx.openPanel('browser', { url: 'https://de.wikipedia.org/wiki/Lesesaal' }));
  await page.waitForSelector('.br-panel', { timeout: 30000 });
  await sleep(8000);
  const br = await page.evaluate(() => ({ title: document.querySelector('.br-panel .br-status, .br-panel')?.innerText?.replace(/\s+/g, ' ').slice(0, 120) }));
  console.log('BROWSER ' + JSON.stringify(br));
  await shot('pkg-browser');
  console.log('ERRORS ' + JSON.stringify(errors.slice(0, 6)));
};
