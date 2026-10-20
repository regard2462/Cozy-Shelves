module.exports = async ({ page, shot, sleep }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 180000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  await sleep(800);
  await page.evaluate(() => { const w = window.__app.world; w.player.setPose(-7.0, 0.6, Math.PI / 2 + 0.15, -0.05); w.env.update(0.5, w.camera); w.frame(); w.frame(); });
  await sleep(400); await shot('night-fireside');
  await page.evaluate(() => { const w = window.__app.world; w.player.setPose(0.5, 2.5, Math.PI - 0.3, 0.12); for (let i = 0; i < 3; i++) { w.env.update(0.3, w.camera); } w.frame(); w.frame(); });
  await sleep(400); await shot('night-windows');
  const cat = await page.evaluate(() => { const w = window.__app.world; return w.cat ? { pos: w.cat.group.position.toArray().map((v) => +v.toFixed(2)), visible: w.cat.group.visible, spots: w.cat.spots.length } : null; });
  console.log('cat', JSON.stringify(cat));
  await page.evaluate(() => { const w = window.__app.world; const c = w.cat.group.position; w.player.setPose(c.x + 1.3, c.z + 0.9, Math.atan2(-(c.x - (c.x + 1.3)), -(c.z - (c.z + 0.9))), -0.35); w.frame(); w.frame(); });
  await sleep(400); await shot('night-cat');
};
