// After every typical flow the player must be able to look around again: the controls are enabled, no panel
// or wheel is open, and a click into the middle of the screen reaches the 3D canvas (nothing lies on top).
module.exports = async ({ page, sleep }) => {
  const errors = [];
  page.on('pageerror', (e) => { if (!/pointer lock/i.test(e.message)) errors.push(e.message); });
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  await sleep(5000);
  const state = (label) => page.evaluate((label) => {
    const w = window.__app.world;
    const x = innerWidth / 2, y = innerHeight / 2;
    const hit = document.elementFromPoint(x, y);
    const hits = document.elementsFromPoint(x, y).slice(0, 4).map((e) => e.id || e.className?.toString().slice(0, 30) || e.tagName);
    return { label, enabled: w.player.enabled, seated: !!w.player.seated, transition: !!w.player.transition, air: !!w.player.air, canvas: hit === w.renderer.domElement, top: hits, layers: [...document.querySelectorAll('.panel-layer')].map((l) => l.dataset.panel + (l.classList.contains('closing') ? '(c)' : '')) };
  }, label);
  // "stand up" reports must find the player standing; nobody may be left in mid-air
  const report = async (label) => { await sleep(900); const s = await state(label); console.log((s.enabled && s.canvas && !s.transition && !s.air && !(/stand up/.test(label) && s.seated) ? 'OK   ' : 'BAD  ') + JSON.stringify(s)); };
  const key = async (code, key) => { await page.evaluate(([code, key]) => document.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true })), [code, key]); await sleep(150); await page.evaluate(([code, key]) => document.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true })), [code, key]); };

  await report('after entering');
  for (const [name, params] of [['computer', {}], ['catalog', {}], ['news', {}], ['wiki', {}], ['podcasts', {}], ['records', {}], ['basket', {}], ['settings', {}], ['chess', {}], ['watercolor', {}], ['mediathek', {}], ['browser', {}]]) {
    await page.evaluate(([n, p]) => window.__app.ctx.openPanel(n, p), [name, params]);
    await sleep(name === 'browser' || name === 'mediathek' ? 4000 : 1800);
    await key('Escape', 'Escape');
    if (await page.evaluate(() => document.querySelectorAll('.panel-layer:not(.closing)').length)) await key('Escape', 'Escape');
    await report('after ' + name + ' + Esc');
  }
  // the radial wheel: tap Tab (stays open), Escape closes it
  await key('Tab', 'Tab'); await sleep(400); await key('Escape', 'Escape');
  await report('after wheel tap + Esc');
  // hold Tab and release
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab', key: 'Tab', bubbles: true })));
  await sleep(700);
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Tab', key: 'Tab', bubbles: true })));
  await report('after wheel hold + release');
  // "Im Regal zeigen"
  const id = await page.evaluate(() => [...window.__app.world.books.entries.keys()][3]);
  await page.evaluate((id) => window.__app.ctx.bus.emit('world:goto-book', { id }), id);
  await sleep(2000);
  await report('after goto-book');
  // sit and stand
  await page.evaluate(() => { const w = window.__app.world; const s = w.seats.get('table1a'); w.player.transition = null; w.player.setPose(s.standPos.x, s.standPos.z, s.standYaw, 0); w.actions.sit('table1a'); });
  await sleep(2500);
  const seated = await state('seated');
  console.log('SEATED ' + JSON.stringify(seated));
  // Q no longer stands up, Space does
  await key('KeyQ', 'q');
  await sleep(600);
  const stillSeated = await state('after Q');
  console.log((stillSeated.seated ? 'OK   ' : 'BAD  ') + JSON.stringify({ label: 'Q keeps you seated', seated: stillSeated.seated }));
  await key('Space', ' ');
  await sleep(1500);
  await report('after stand up (Space)');
  // W stands up as well, once the sit-down has finished
  await page.evaluate(() => { const w = window.__app.world; const s = w.seats.get('table1a'); w.player.transition = null; w.player.setPose(s.standPos.x, s.standPos.z, s.standYaw, 0); w.actions.sit('table1a'); });
  await sleep(2500);
  await key('KeyW', 'w');
  await sleep(1500);
  await report('after stand up (W)');
  // a jump: the view comes down again and nothing else changes
  await key('Space', ' ');
  await sleep(1500);
  await report('after a jump (Space)');
  // department switch through the wheel API
  const dep = await page.evaluate(() => window.__app.ctx.world.departments().map((d) => d.name).find((n) => n !== window.__app.state.department));
  if (dep) { await page.evaluate((d) => window.__app.ctx.world.setDepartment(d), dep); await sleep(2500); await report('after department switch'); }
  console.log('ERRORS ' + JSON.stringify(errors.slice(0, 6)));
};
