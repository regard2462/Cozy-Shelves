// Developer probe: how long the world builds took since start-up (the first one draws every spine), then five more.
module.exports = async ({ page, sleep }) => {
  await page.waitForFunction(() => window.__app && window.__app.world?.buildTimes?.length, null, { timeout: 240000 });
  const first = await page.evaluate(() => ({ times: [...window.__app.world.buildTimes], steps: window.__app.world.buildSteps, shelf: window.__app.world.shelfSteps }));
  await page.evaluate(() => document.querySelector('.menu-btn.primary')?.click());
  await sleep(4000);
  const more = await page.evaluate(async () => { const w = window.__app.world; const out = []; for (let i = 0; i < 5; i++) { const t = performance.now(); w.build(w.library, {}); out.push(Math.round(performance.now() - t)); await new Promise((r) => setTimeout(r, 100)); } return out; });
  const atlas = await page.evaluate(() => window.__app.world.books.meshes.map((m) => [m.material.map.image.width, m.material.map.image.height, m.count]));
  console.log('BUILD ' + JSON.stringify({ startup: first, again: more, atlas }));
};
