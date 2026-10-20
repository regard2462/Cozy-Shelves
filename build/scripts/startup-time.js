// How long the start takes: milliseconds from the page's start until the world is built (layout, garden, lamps) and
// until the first frames are drawn, and how long a garden takes to build on its own (trees, ground, textures cached).
module.exports = async ({ page, sleep }) => {
  await page.waitForFunction(() => window.__app?.world?.layout && window.__app.world.env, null, { timeout: 240000, polling: 20 });
  const built = await page.evaluate(() => performance.now());
  await page.waitForFunction(() => document.querySelector('.menu-btn.primary'), null, { timeout: 240000, polling: 20 });
  const menu = await page.evaluate(() => performance.now());
  await sleep(1500);
  const extra = await page.evaluate(async () => {
    const env = window.__app.world.env;
    return { trees: env.garden.trees?.length ?? null, skyAndGardenMs: env.buildMs != null ? Math.round(env.buildMs) : null, gardenSteps: env.garden.steps || null };
  });
  console.log('STARTUP ' + JSON.stringify({ worldBuiltMs: Math.round(built), menuMs: Math.round(menu), ...extra }));
};
