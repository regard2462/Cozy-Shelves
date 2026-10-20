// An update keeps its data: without --user-data-dir the program takes the folder of a former name that holds data,
// <appData>/Cozystacks (0.8.0 to 0.9.2) before <appData>/Lesesaal (up to 0.7.2), while the folder under the new name
// (<appData>/Cozy Shelves, Electron's name of the program) holds none (electron/data-folder.js). On Linux Electron's
// appData is $XDG_CONFIG_HOME, so the check runs there without touching anyone's data:
//   mkdir -p /tmp/cfg/Lesesaal && echo '{"language":"en"}' > /tmp/cfg/Lesesaal/settings.json
//   XDG_CONFIG_HOME=/tmp/cfg HARNESS_NO_USERDATA=1 EXPECT_USERDATA=/tmp/cfg/Lesesaal xvfb-run node build/screenshot.js datadir-check
// The settings file of the expected folder sets English, so the interface shows that it was read (build/ci/linux-test.sh
// runs it for both former names).
const path = require('path');
const fs = require('fs');

module.exports = async ({ app, page }) => {
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  const r = await app.evaluate(({ app: a }) => ({ userData: a.getPath('userData'), appData: a.getPath('appData'), name: a.getName() }));
  const lang = await page.evaluate(() => document.documentElement.lang || null);
  const want = process.env.EXPECT_USERDATA;
  const results = [
    ['the former data folder is in use', !!want && path.resolve(r.userData) === path.resolve(want), r],
    ['its settings were read (English interface)', lang === 'en', { lang }],
    // Electron itself makes an empty folder under the new name before the main script runs; the program's own files
    // must not land there
    ['nothing of the program lands in the folder under the new name', r.name === 'Cozy Shelves' && !['settings.json', 'library.json'].some((f) => fs.existsSync(path.join(r.appData, r.name, f))), { appData: r.appData, name: r.name }],
  ];
  for (const [name, ok, info] of results) console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(info)}`);
  console.log(`DATADIR-CHECK ${results.filter((x) => x[1]).length}/${results.length} passed`);
};
