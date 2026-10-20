// Launches the app with Playwright's Electron driver (under Xvfb on Linux) and runs a
// scripted session that takes screenshots. Usage:
//   xvfb-run -s "-screen 0 1600x900x24" node build/screenshot.js [scriptName] [--keep]
// Env: COZYSHELVES_BOOKS=<folder> to point at a test library; COZYSHELVES_USERDATA=<dir>; HARNESS_NO_USERDATA=1 starts
// without --user-data-dir (only where appData is a test folder, as with XDG_CONFIG_HOME in build/scripts/datadir-check.js)
const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const outDir = process.env.SHOT_DIR || path.join(root, 'shots');
fs.mkdirSync(outDir, { recursive: true });
const scriptName = process.argv[2] || 'default';
const userData = process.env.COZYSHELVES_USERDATA || path.join(require('os').tmpdir(), 'lesesaal-userdata');

(async () => {
  // COZYSHELVES_EXE points at a packaged build (dist/CozyShelves-win64/CozyShelves.exe) instead of the source tree
  const exe = process.env.COZYSHELVES_EXE;
  // The real graphics card by default (the window stays off-screen and muted). SWIFTSHADER=1 renders in
  // software instead: since 0.4 the rooms have about twenty permanent lights, far too slow for that.
  const gpu = !process.env.SWIFTSHADER;
  // in software one frame of the house can take longer than Chromium's GPU watchdog allows: it would end the
  // graphics process again and again (exit code 512, "hung"), so it is off for these runs
  const glArgs = gpu ? ['--ignore-gpu-blocklist'] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'];
  const app = await electron.launch({
    executablePath: exe || undefined,
    args: [...(exe ? [] : [process.env.APP_DIR || root]), ...(process.env.HARNESS_NO_USERDATA ? [] : [`--user-data-dir=${userData}`]), ...(process.env.HARNESS_SANDBOX ? [] : ['--no-sandbox']), '--mute-audio', '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-dev-shm-usage', ...glArgs],
    env: { ...process.env, COZYSHELVES_SOFTWARE_GL: gpu ? '' : '1', COZYSHELVES_TEST: '1', COZYSHELVES_MUTE: '1', COZYSHELVES_HIDDEN: process.env.SHOW_WINDOW ? '' : '1' },  // test runs never make a sound
    timeout: 180000,
  });
  console.log('[harness] mute-audio', await app.evaluate(({ app: a }) => a.commandLine.hasSwitch('mute-audio')));
  app.process().stdout?.on('data', (d) => process.stdout.write('[main] ' + d));
  app.process().stderr?.on('data', (d) => process.stdout.write('[main:err] ' + d));
  let win = null;
  for (let i = 0; i < 120 && !win; i++) {
    win = app.windows().find((w) => /index\.html/.test(w.url()));
    if (!win) await new Promise((r) => setTimeout(r, 500));
  }
  if (!win) throw new Error('main window not found');
  // software rendering draws a frame of the house in seconds: screenshots and waits without a timeout of their own get
  // three minutes instead of Playwright's 30 s
  if (!gpu) win.setDefaultTimeout(180000);
  win.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning' || process.env.VERBOSE) console.log(`[renderer:${t}]`, m.text().slice(0, 500)); });
  win.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  // HARNESS_LOAD_TIMEOUT: a profile with a large library takes longer to start
  await win.waitForLoadState('domcontentloaded', { timeout: +(process.env.HARNESS_LOAD_TIMEOUT || 30000) });
  const shot = async (name) => { await win.screenshot({ path: path.join(outDir, `${name}.png`) }); console.log('shot', name); };
  const script = require(path.join(root, 'build', 'scripts', scriptName + '.js'));
  // `page` is an alias for `win` – scripts use either name
  try { await script({ app, win, page: win, shot, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }); }
  catch (e) { console.error('script failed', e); await shot('error'); }
  if (!process.argv.includes('--keep')) await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
