// Screenshot a panel in plain Chromium (mock backend). Usage: node build/dev-shot.js <panel> [key=value…] [--interact=script.js]
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..', 'app');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff' };
(async () => {
  const server = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    fs.createReadStream(p).pipe(res);
  }).listen(0);
  const port = server.address().port;
  const [panel, ...rest] = process.argv.slice(2);
  const qs = rest.filter((a) => !a.startsWith('--')).join('&');
  const interact = (rest.find((a) => a.startsWith('--interact=')) || '').slice(11);
  // headless and muted: a dev run never shows a window and never makes a sound
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('[console:' + m.type() + ']', m.text().slice(0, 400)); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${port}/dev.html?panel=${panel}${qs ? '&' + qs : ''}`);
  await page.waitForTimeout(2500);
  const out = path.join(__dirname, '..', 'shots'); fs.mkdirSync(out, { recursive: true });
  if (interact) { await require(path.resolve(interact))({ page, shot: (n) => page.screenshot({ path: path.join(out, n + '.png') }) }); }
  await page.screenshot({ path: path.join(out, `dev-${panel}.png`) });
  console.log('saved shots/dev-' + panel + '.png');
  await browser.close(); server.close();
})();
