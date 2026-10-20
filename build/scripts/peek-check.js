// The cover card on the right must appear while a book is under the crosshair: the cover only (no title, author or
// tags below it) and, with "Hinweise einblenden" on, a small row of keys.
module.exports = async ({ page, shot, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  await sleep(6000);
  const r = await page.evaluate(() => {
    const w = window.__app.world; w.stop();
    const e = [...w.books.entries.values()].find((x) => !x.hidden && x.pos.y > 1.2 && x.pos.y < 1.8);
    const p = e.pos.clone().addScaledVector(e.forward, 0.75);
    const yaw = Math.atan2(e.forward.x, e.forward.z);
    w.player.transition = null; w.player.setPose(p.x, p.z, yaw, Math.atan2(e.pos.y - 1.62, 0.75));
    w.player.update(0.016); w.camera.updateMatrixWorld();
    w.actions.rayTimer = 0; w.actions.update(0.01);
    const t = w.actions.target;
    return { target: t?.type, title: t?.book?.title, panelOpen: document.querySelector('#hud').classList.contains('panel-open'), hints: window.__app.state.settings.hints };
  });
  for (let i = 0; i < 6; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(150); }
  const card = await page.evaluate(() => { const el = document.querySelector('#book-peek'); return { cls: el.className, text: el.innerText.replace(/\s+/g, ' ').slice(0, 120), op: getComputedStyle(el).opacity }; });
  console.log('PEEK ' + JSON.stringify({ r, card }));
  await shot('peek');
};
