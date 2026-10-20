// Runs a check script against the browser version: serves dist/web with a tiny static server on a free port and drives
// the page with Playwright in the INSTALLED Microsoft Edge (channel 'msedge', no browser download), headless and
// muted, with a profile folder of its own. Usage:
//   node build/web-shot.js [web-check] [--keep]
// Env: WEB_DIST (the folder to serve, default dist/web), SHOT_DIR (screenshots, default shots/), WEB_PROFILE (the
// browser profile, default a fresh folder under the system temp), WEB_BOOKS (a test library for the check),
// WEB_URL (an already running server instead of the built-in one), VERBOSE=1 (every console line), WEB_DEVICE=phone
// or tablet (a touch device emulated: the CSS size, the pixel ratio, touch and the mobile viewport of a mid-range
// phone in landscape, 914 × 411 at 2.625, or of a 10" tablet, 1280 × 800 at 2), WEB_ARGS (more browser switches,
// separated by spaces).
// The window is never shown and nothing is heard (headless, --mute-audio); the user's folders are never touched.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.resolve(process.env.WEB_DIST || path.join(root, 'dist', 'web'));   // (resolved: a folder given with forward slashes must match the joined paths of the server)
const outDir = process.env.SHOT_DIR || path.join(root, 'shots');
const scriptName = (process.argv.slice(2).find((a) => !a.startsWith('--'))) || 'web-check';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream' };

/** A static server for `dir` on a free port of 127.0.0.1 (a secure context for the File System Access API). */
function serve(dir) {
  const server = http.createServer((req, res) => {
    let p;
    try { p = path.join(dir, decodeURIComponent(req.url.split('?')[0])); } catch { res.writeHead(400); return res.end(); }
    if (p.endsWith(path.sep) || p === dir) p = path.join(p, 'index.html');
    if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

/** The installed Edge: Playwright's 'msedge' channel, else the newest msedge.exe under EdgeCore (an installation without Edge\Application). */
function edgeExecutable() {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const found = [];
  for (const r of roots) {
    for (const sub of ['Microsoft/Edge/Application/msedge.exe']) { const p = path.join(r, sub); if (fs.existsSync(p)) found.push({ p, v: '0' }); }
    const core = path.join(r, 'Microsoft', 'EdgeCore');
    if (fs.existsSync(core)) for (const v of fs.readdirSync(core)) { const p = path.join(core, v, 'msedge.exe'); if (fs.existsSync(p)) found.push({ p, v }); }
  }
  found.sort((a, b) => b.v.localeCompare(a.v, undefined, { numeric: true }));
  return found[0]?.p || null;
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  if (!process.env.WEB_URL && !fs.existsSync(path.join(dist, 'index.html'))) throw new Error('no web build in ' + dist + ' (run `npm run build:web` first)');
  const served = process.env.WEB_URL ? null : await serve(dist);
  const baseUrl = process.env.WEB_URL || served.url;
  const profile = process.env.WEB_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(), 'cozy-shelves-web-profile-'));
  fs.mkdirSync(profile, { recursive: true });
  // headless and muted; WebGL on the real graphics card where headless Edge allows it, else SwiftShader in software
  const args = ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-gpu-watchdog', '--no-first-run', '--disable-extensions', '--disable-sync', '--disable-background-networking', '--disable-component-update', '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion'];
  if (process.env.WEB_ARGS) args.push(...process.env.WEB_ARGS.split(/\s+/).filter(Boolean));
  // a touch device: the page sees a coarse pointer, touch points, the mobile viewport (its meta viewport is honoured,
  // main-web.js fitPhoneViewport) and the pixel ratio of the device
  const DEVICES = {
    phone: { viewport: { width: 914, height: 411 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
    tablet: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  };
  const device = DEVICES[process.env.WEB_DEVICE] || null;
  const opts = { headless: true, args, viewport: { width: 1440, height: 900 }, ...(device || {}) };
  let context;
  try { context = await chromium.launchPersistentContext(profile, { ...opts, channel: 'msedge' }); }
  catch (e) {
    const exe = edgeExecutable();
    if (!exe) throw new Error('Microsoft Edge not found (' + e.message + ')');
    console.log('[web-shot] channel msedge not found by Playwright, using', exe);
    context = await chromium.launchPersistentContext(profile, { ...opts, executablePath: exe });
  }
  const page = context.pages()[0] || await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    const t = m.type(); const text = m.text();
    if (t === 'error') errors.push(text.slice(0, 500));
    if (t === 'error' || t === 'warning' || process.env.VERBOSE) console.log(`[page:${t}]`, text.slice(0, 500));
  });
  page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); console.log('[pageerror]', e.message); });
  page.on('requestfailed', (r) => { const u = r.url(); if (u.startsWith(baseUrl)) { errors.push('request failed: ' + u); console.log('[requestfailed]', u, r.failure()?.errorText); } });
  page.on('response', (r) => { const u = r.url(); if (u.startsWith(baseUrl) && r.status() >= 400) { errors.push(`HTTP ${r.status()} ${u}`); console.log('[http]', r.status(), u); } });
  const shot = async (name) => { await page.screenshot({ path: path.join(outDir, `${name}.png`) }); console.log('shot', name); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const script = require(path.join(root, 'build', 'scripts', scriptName + '.js'));
  let failed = false;
  try { await script({ page, context, shot, sleep, baseUrl, errors, outDir, profile }); }
  catch (e) { console.error('script failed', e); failed = true; try { await shot('web-error'); } catch {} }
  if (!process.argv.includes('--keep')) { await context.close(); served?.server.close(); }
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
