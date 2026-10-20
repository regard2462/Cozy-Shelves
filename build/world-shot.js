// Screenshot the full app (index.html, mock backend) in headless Chromium. Usage: node build/world-shot.js [--interact=script.js] [--w=1600 --h=900]
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..', 'app');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.epub': 'application/epub+zip', '.pdf': 'application/pdf' };
(async () => {
  const server = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    fs.createReadStream(p).pipe(res);
  }).listen(0);
  const port = server.address().port;
  const args = process.argv.slice(2);
  const interact = (args.find((a) => a.startsWith('--interact=')) || '').slice(11);
  const W = parseInt((args.find((a) => a.startsWith('--w=')) || '--w=1600').slice(4)), H = parseInt((args.find((a) => a.startsWith('--h=')) || '--h=900').slice(4));
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) || process.env.VERBOSE) console.log('[console:' + m.type() + ']', m.text().slice(0, 500)); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message, e.stack?.split('\n').slice(0, 3).join(' | ')));
  const q = (args.find((a) => a.startsWith('--q=')) || '').slice(4);
  await page.goto(`http://127.0.0.1:${port}/index.html${q ? '?' + q : ''}`);
  const out = path.join(__dirname, '..', 'shots'); fs.mkdirSync(out, { recursive: true });
  const shot = (n) => page.screenshot({ path: path.join(out, n + '.png') }).then(() => console.log('shot', n));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (interact) await require(path.resolve(interact))({ page, shot, sleep });
  else { await sleep(6000); await shot('world-menu'); }
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
