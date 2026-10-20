// The check of the browser version (node build/web-shot.js web-check): the page loads from the static server, the
// backend of the page is the web one, the world builds, a test library is "picked" through the test hook (the native
// folder picker cannot be driven: the books are copied into the Origin Private File System and its directory handle is
// handed to the library, which is the same code path as a picked folder), the shelves fill, covers come out of the
// books, the world map shows its tiles (answered by the check, never fetched from OpenStreetMap) and a click opens a
// card, a book opens in the reader and a page is turned, the settings and the reading position survive a reload, the
// desktop-only entries are hidden, and the console stays free of errors.
// Env: WEB_BOOKS (the test library, default the folder "testbooks4" next to the scratch folder of the check, or
// build/testlib), WEB_INPUT=1 (the fallback picker: the files go in through <input webkitdirectory> instead of the OPFS).
const fs = require('fs');
const path = require('path');
const { decode } = require('./png-lite.js');
const { serveTiles } = require('./osm-tiles.js');

const SCAN_TIMEOUT = +(process.env.WEB_SCAN_TIMEOUT || 420000);

function listFiles(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, base, out);
    else if (e.isFile()) out.push({ abs: p, rel: path.relative(base, p).split(path.sep).join('/') });
  }
  return out;
}

/** Copies the test library into the OPFS of the page: <root>/<name>/<relative path>. */
async function fillOpfs(page, dir, name) {
  const files = listFiles(dir);
  await page.evaluate(async (n) => { const root = await navigator.storage.getDirectory(); try { await root.removeEntry(n, { recursive: true }); } catch {} await root.getDirectoryHandle(n, { create: true }); }, name);
  let bytes = 0;
  for (const f of files) {
    const buf = fs.readFileSync(f.abs);
    bytes += buf.length;
    // in pieces of 4 MB: one evaluate per piece keeps the CDP messages small
    const parts = []; for (let i = 0; i < buf.length; i += 4194304) parts.push(buf.subarray(i, i + 4194304).toString('base64'));
    if (!parts.length) parts.push('');
    await page.evaluate(async ({ n, rel, parts }) => {
      const root = await navigator.storage.getDirectory();
      let dir = await root.getDirectoryHandle(n, { create: true });
      const segs = rel.split('/');
      for (const s of segs.slice(0, -1)) dir = await dir.getDirectoryHandle(s, { create: true });
      const fh = await dir.getFileHandle(segs[segs.length - 1], { create: true });
      const w = await fh.createWritable();
      for (const b64 of parts) { const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); await w.write(u8); }
      await w.close();
    }, { n: name, rel: f.rel, parts });
  }
  return { files: files.length, bytes };
}

/** How varied a screenshot is: the share of 32 × 32 cells whose mean differs from the overall mean. */
function variety(pngBuffer) {
  const { width, height, data } = decode(pngBuffer);
  const cells = [];
  for (let cy = 0; cy < 8; cy++) for (let cx = 0; cx < 8; cx++) {
    let s = 0, n = 0;
    for (let y = Math.floor(cy * height / 8); y < Math.floor((cy + 1) * height / 8); y += 4) for (let x = Math.floor(cx * width / 8); x < Math.floor((cx + 1) * width / 8); x += 4) { const i = (y * width + x) * 4; s += data[i] + data[i + 1] + data[i + 2]; n += 3; }
    cells.push(s / n);
  }
  const mean = cells.reduce((a, b) => a + b, 0) / cells.length;
  return { mean: Math.round(mean), varied: cells.filter((c) => Math.abs(c - mean) > 12).length / cells.length };
}

module.exports = async ({ page, context, shot, sleep, baseUrl, errors, outDir }) => {
  const results = [];
  const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ' · ' + detail : ''}`); };
  const scratch = path.resolve(__dirname, '..', '..', '..');
  const books = process.env.WEB_BOOKS || [path.join(process.env.SCRATCHW || '', 'testbooks4'), path.join(__dirname, '..', 'testlib', 'books')].find((p) => p && fs.existsSync(p));
  if (!books || !fs.existsSync(books)) throw new Error('no test library: set WEB_BOOKS');
  const libName = path.basename(books).replace(/[^\p{L}\p{N}._-]+/gu, '_');
  void scratch;

  // ---- 1. the page loads, the backend is the web one ---------------------------------------------------------------
  await page.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  // the welcome card mounts after the menu (a dynamic import)
  try { await page.waitForFunction(() => document.querySelector('.welcome-card'), null, { timeout: 15000 }); } catch {}
  const boot = await page.evaluate(async () => ({
    platform: window.api?.platform, web: !!window.__cozyshelvesWeb, version: window.api?.version,
    welcome: !!document.querySelector('.welcome-card'), secure: window.isSecureContext,
    gl: (() => { try { const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl'); const d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch { return null; } })(),
    folders: (await window.api.settings.get()).folders.length,
  }));
  console.log('BOOT ' + JSON.stringify(boot));
  check('page loads with the web backend', boot.platform === 'web' && boot.web, `version ${boot.version}, renderer ${boot.gl}`);
  check('secure context (folder picker possible)', boot.secure);
  check('welcome card asks for a folder', boot.welcome && boot.folders === 0);
  await shot('web-start');

  // ---- 2. the test library is "picked" through the hook -----------------------------------------------------------
  const t0 = Date.now();
  let folders;
  if (process.env.WEB_INPUT === '1') {
    // the fallback of Firefox and Safari: the files of <input webkitdirectory>
    await page.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.webkitdirectory = true; i.multiple = true; i.id = 'wc-input'; i.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(i); });
    await page.setInputFiles('#wc-input', books);
    folders = await page.evaluate(() => window.__cozyshelvesWeb.useFiles(document.getElementById('wc-input').files, 'structured'));
  } else {
    const copied = await fillOpfs(page, books, libName);
    console.log(`OPFS ${copied.files} files, ${(copied.bytes / 1048576).toFixed(1)} MB in ${Date.now() - t0} ms`);
    folders = await page.evaluate(async (n) => { const root = await navigator.storage.getDirectory(); const h = await root.getDirectoryHandle(n); return window.__cozyshelvesWeb.useHandle(h, 'structured'); }, libName);
  }
  check('folder accepted', Array.isArray(folders) && folders.length === 1 && folders[0].path === libName, JSON.stringify(folders));
  await page.evaluate((f) => { window.__app.ctx.bus.emit('welcome:folder', f); }, folders);
  await page.keyboard.press('Escape');   // "Später" closes the welcome card; the folder is set already
  await sleep(300);

  // ---- 3. the scan and the index run through ---------------------------------------------------------------------
  // the library itself knows (the state of the page follows it with a delay)
  let st = null;
  for (const start = Date.now(); Date.now() - start < SCAN_TIMEOUT;) {
    st = await page.evaluate(() => { const l = window.__cozyshelvesWeb.library; const books = Object.values(l.books).filter((b) => !b.missing); return { n: books.length, active: !!l.scanState.active, phase: l.scanState.phase, done: l.scanState.done, total: l.scanState.total, indexed: books.filter((b) => b.indexed).length, queue: l.queue.length, scanning: !!l._scanning }; });
    if (st.n > 0 && !st.active && !st.scanning && st.indexed === st.n && !st.queue) break;
    await sleep(1500);
  }
  // the page's own state follows within 1.5 s (library:update)
  await page.waitForFunction((n) => window.__app.state.library.books.length === n, st.n, { timeout: 15000 }).catch(() => {});
  console.log('SCAN ' + JSON.stringify(st) + ' in ' + (Date.now() - t0) + ' ms');
  const expected = listFiles(books).filter((f) => /\.(pdf|epub|mobi|azw3|fb2|cbz|txt|md|html?)$/i.test(f.rel)).length;
  check('all books scanned and indexed', st && st.n === expected && st.indexed === st.n && !st.active, `${st?.n} of ${expected} files, ${st?.indexed} indexed`);

  // ---- 4. the world: shelves, departments, covers -------------------------------------------------------------------
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  // the shelves are rebuilt a moment after the library changed (main.js onLibraryUpdate: 0.8 s, 9 s while a scan runs)
  try { await page.waitForFunction(() => (window.__app.world.books?.entries?.size || 0) > 0, null, { timeout: 30000 }); } catch {}
  await sleep(2500);
  const world = await page.evaluate(async () => {
    const w = window.__app.world, s = window.__app.state.library;
    const withCover = s.books.filter((b) => b.hasCover);
    const real = withCover.filter((b) => !b.coverGenerated);
    const url = real[0] ? window.api.library.coverUrl(real[0].id) : '';
    const loaded = url ? await new Promise((r) => { const i = new Image(); i.onload = () => r(i.naturalWidth); i.onerror = () => r(0); i.src = url; }) : 0;
    return { entered: window.__app.state.entered, running: w.running, cases: w.layout?.bookcases?.length || 0, entries: w.books?.entries?.size || 0, deps: s.departments.map((d) => d.name + ':' + d.count + ':' + d.shelves.length), covers: withCover.length, real: real.length, coverUrl: url.slice(0, 5), coverWidth: loaded, firstTitle: real[0]?.title, pdf: s.books.filter((b) => b.format === 'pdf').length, epub: s.books.filter((b) => b.format === 'epub').length };
  });
  console.log('WORLD ' + JSON.stringify(world));
  check('library entered, world running', world.entered && world.running);
  check('shelves filled with the books', world.cases > 0 && world.entries > 0, `${world.cases} cases, ${world.entries} books on them`);
  check('departments follow the folders', world.deps.length >= 3, world.deps.join(' | '));
  check('covers come out of the books', world.covers === st.n && world.real > 0 && world.coverUrl === 'blob:' && world.coverWidth > 0, `${world.real} real covers of ${world.covers}, first "${world.firstTitle}" ${world.coverWidth} px wide`);
  const png = await page.screenshot({ path: path.join(outDir, 'web-world.png') });
  const v = variety(png);
  check('the world draws a picture', v.varied > 0.25 && v.mean > 8, `mean ${v.mean}, varied ${(v.varied * 100).toFixed(0)} %`);

  // ---- 4b. the panels of the web build: T is the computer's catalogue, the settings open, read-aloud answers --------
  await page.keyboard.press('KeyT');
  await sleep(1500);
  const tPanel = await page.evaluate(() => ({ panel: document.querySelector('.panel-layer:last-of-type')?.dataset?.panel || null, error: !!document.querySelector('.panel-error'), catalog: !!document.querySelector('.term-seg-btn') }));
  check('T opens the catalogue of the computer in place of the full-text search', tPanel.panel === 'computer' && !tPanel.error && tPanel.catalog, JSON.stringify(tPanel));
  await page.keyboard.press('Escape'); await sleep(600);
  await page.evaluate(() => window.__app.openPanel('settings', { section: 'library' }));
  await sleep(1500);
  const sPanel = await page.evaluate(() => ({ error: !!document.querySelector('.panel-error'), tabs: [...document.querySelectorAll('.settings-nav button')].map((b) => b.textContent.trim()), folders: document.querySelectorAll('.folder-row').length, webNote: !!document.querySelector('.settings-content .note, .settings-content p') }));
  check('settings open without the desktop-only sections', !sPanel.error && sPanel.folders === 1 && !sPanel.tabs.some((t) => /mediathek|hörbücher|audiobooks/i.test(t)), sPanel.tabs.join(', '));
  await page.keyboard.press('Escape'); await sleep(600);
  const tts = await page.evaluate(async () => { try { const c = window.__ttsClient; const s = await c.status(); const v = await c.voices('de'); return { web: !!c.web, german: s.german, english: s.english, voices: v.length }; } catch (e) { return { error: e.message }; } });
  check('read-aloud client of the browser answers', !tts.error && tts.web && ['ready', 'unavailable'].includes(tts.german), JSON.stringify(tts));

  // ---- 4c. the world map: Leaflet with its stylesheet (build/web.js copies it) and OpenStreetMap's tiles, which the
  // check answers itself (build/scripts/osm-tiles.js: never from tile.openstreetmap.org); in the overview the atlas of
  // the app's own data lies over the tiles (countries, names, the switch of the views); a click opens a card ------------
  const tiles = await serveTiles({ context });
  await page.evaluate(() => window.__app.openPanel('worldmap', {}));
  try { await page.waitForFunction(() => document.querySelector('.wm-panel')?.__wm?.stats().loaded > 0, null, { timeout: 30000 }); } catch {}
  try { await page.waitForFunction(() => document.querySelectorAll('.wm-osm .leaflet-wm-fill-pane path').length > 200, null, { timeout: 15000 }); } catch {}
  await sleep(800);
  const atlas = await page.evaluate(() => {
    const w = document.querySelector('.wm-panel')?.__wm, pane = document.querySelector('.wm-osm .leaflet-wm-fill-pane');
    if (!w || !pane) return { error: 'no atlas' };
    const text = (el) => [...el.childNodes].map((n) => (n.nodeName === 'BR' ? ' ' : n.textContent)).join('').trim();
    return { opacity: getComputedStyle(pane).opacity, paths: pane.querySelectorAll('path').length, sea: !!pane.querySelector('path.wm-sea'), names: w.stats().labels, countries: [...document.querySelectorAll('.wm-labels .wm-l-country')].map(text), modes: [...document.querySelectorAll('.wm-legend .wm-mode')].map((b) => b.textContent), lang: window.__app.ctx?.i18n?.lang || document.documentElement.lang };
  });
  await shot('web-worldmap-atlas');
  const wmap = await page.evaluate(() => {
    const w = document.querySelector('.wm-panel')?.__wm;
    if (!w) return { error: document.querySelector('.panel-error')?.textContent?.slice(0, 200) || 'no world map' };
    const img = document.querySelector('.wm-osm img.leaflet-tile-loaded'), pane = document.querySelector('.wm-osm .leaflet-tile-pane');
    const out = { ...w.stats(), css: pane && getComputedStyle(pane).position, img: img && [img.naturalWidth, getComputedStyle(img).position] };
    // France in the middle at zoom 5: the page point of its label (no city answers there)
    const c = w.data.byId.get('FRA'), m = w.view.map, r = w.view.el.getBoundingClientRect();
    m.setView([c.lbl[1], c.lbl[0]], 5, { animate: false });
    const q = m.latLngToContainerPoint([c.lbl[1], c.lbl[0]]);
    return { ...out, at: [r.left + q.x, r.top + q.y] };
  });
  check('the world map opens with its tiles in place (the stylesheet of Leaflet is there)', !wmap.error && wmap.loaded > 0 && wmap.failed === 0 && wmap.css === 'absolute' && wmap.img?.[0] === 256 && wmap.img[1] === 'absolute', JSON.stringify(wmap));
  if (wmap.at) {
    await sleep(600);
    await page.mouse.click(wmap.at[0], wmap.at[1]);
    await sleep(600);
  }
  const wsel = await page.evaluate(() => { const w = document.querySelector('.wm-panel')?.__wm; return w ? { sel: w.state().sel, card: w.state().card.replace(/\s+/g, ' ').slice(0, 80) } : null; });
  check('a click on France opens its card', wsel?.sel?.country === 'FRA' && /Paris/.test(wsel.card), JSON.stringify(wsel));
  // the names in the language of the interface (the card says which: "Hauptstadt" or "Capital")
  const german = /Hauptstadt/.test(wsel?.card || '');
  check('the atlas covers the tiles in the overview: the countries, the sea, their names in the language of the interface, the four views', !atlas.error && atlas.opacity === '1' && atlas.paths > 200 && atlas.sea && atlas.names > 20 && atlas.modes.length === 4 && atlas.countries.includes(german ? 'Vereinigte Staaten' : 'United States') && !atlas.countries.includes(german ? 'United States' : 'Vereinigte Staaten'),
    JSON.stringify({ ...atlas, countries: atlas.countries?.slice(0, 8), german }));
  await shot('web-worldmap');
  for (let i = 0; i < 2; i++) { await page.keyboard.press('Escape'); await sleep(500); }
  check('the tiles came from the check (none from OpenStreetMap, every address a real tile), Esc closes the card and the map', tiles.served > 0 && !tiles.unrouted().length && !tiles.bad.length && !(await page.evaluate(() => !!document.querySelector('.panel-layer.open .wm-panel'))), JSON.stringify({ served: tiles.served, unrouted: tiles.unrouted().slice(0, 3), bad: tiles.bad.slice(0, 3) }));
  await tiles.stop();   // (a route turns the page's cache off)

  // ---- 5. a book opens in the reader, a page is turned --------------------------------------------------------------
  const pick = await page.evaluate(() => { const s = window.__app.state.library; const b = s.books.find((x) => x.format === 'epub') || s.books.find((x) => x.format === 'pdf') || s.books[0]; return { id: b.id, title: b.title, format: b.format }; });
  await page.evaluate((id) => { window.__app.world.stop(); window.__app.openPanel('reader', { id }); }, pick.id);
  try { await page.waitForFunction(() => document.querySelector('.panel-layer[data-panel="reader"] foliate-view') && !document.querySelector('.rd-loading'), null, { timeout: 90000 }); } catch { console.log('reader still loading after 90 s'); }
  await sleep(1500);
  // foliate-view keeps its pages in iframes inside shadow roots: Playwright sees every frame of the page
  const before = await page.evaluate(async (id) => {
    const layer = document.querySelector('.panel-layer[data-panel="reader"]');
    return { loading: !!document.querySelector('.rd-loading'), error: document.querySelector('.panel-error')?.textContent?.slice(0, 200) || null, title: layer?.querySelector('.rd-title')?.textContent || '', book: await window.api.library.book(id) };
  }, pick.id);
  let pageText = 0;
  for (const f of page.frames()) { if (f === page.mainFrame()) continue; try { pageText += await f.evaluate(() => (document.body?.innerText || '').trim().length); } catch {} }
  await shot('web-reader');
  check(`reader opens "${pick.title}" (${pick.format})`, !before.loading && !before.error && pageText > 20, before.error || `${page.frames().length - 1} frame(s) with ${pageText} characters, title "${before.title}"`);
  for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowRight'); await sleep(700); }
  await sleep(1500);
  await page.keyboard.press('Escape');
  await sleep(1200);
  const after = await page.evaluate(async (id) => { const b = await window.api.library.book(id); return { progress: b.progress, loc: b.lastLocation, opened: b.timesOpened, borrowed: b.borrowed }; }, pick.id);
  console.log('READ ' + JSON.stringify({ before: { progress: before.book.progress, loc: before.book.lastLocation }, after }));
  check('reading position is saved', !!after.loc && (after.progress || 0) >= (before.book.progress || 0), `progress ${(after.progress * 100).toFixed(1)} %`);

  // ---- 6. settings and the reading position survive a reload ---------------------------------------------------------
  await page.evaluate(async () => { await window.api.settings.set({ language: 'en', reader: { fontSize: 23 } }); await window.__cozyshelvesWeb.flush(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await sleep(1500);
  const again = await page.evaluate(async (id) => {
    const s = await window.api.settings.get();
    const lib = window.__app.state.library;
    const b = await window.api.library.book(id);
    return { lang: s.language, fontSize: s.reader?.fontSize, folders: s.folders.length, books: lib.books.length, indexed: lib.books.filter((x) => x.indexed).length, unavailable: lib.scan?.unavailable || [], attention: lib.web?.attention || [], loc: b?.lastLocation, progress: b?.progress, welcome: !!document.querySelector('.welcome-card'), menuText: document.querySelector('.menu-btn.primary')?.textContent, covers: lib.books.filter((x) => x.hasCover && window.api.library.coverUrl(x.id)).length };
  }, pick.id);
  console.log('RELOAD ' + JSON.stringify(again));
  check('settings survive a reload', again.lang === 'en' && again.fontSize === 23 && /enter|continue/i.test(again.menuText || ''), again.menuText);
  if (process.env.WEB_INPUT === '1') {
    // the fallback picker keeps no handle: the books and covers are there, the folder asks to be picked again, and the
    // same folder picked again (the hook stands in for the picker) joins the records without a new index run
    check('library survives a reload, the folder asks to be picked again', again.folders === 1 && again.books === st.n && again.indexed === st.n && !again.welcome && again.attention.length === 1 && again.attention[0].reason === 'repick', `${again.books} books, ${again.covers} covers, attention ${JSON.stringify(again.attention)}`);
    await page.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.webkitdirectory = true; i.multiple = true; i.id = 'wc-input2'; i.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(i); });
    await page.setInputFiles('#wc-input2', books);
    const re = await page.evaluate(() => window.__cozyshelvesWeb.useFiles(document.getElementById('wc-input2').files, 'structured'));
    await sleep(4000);
    const joined = await page.evaluate(() => { const l = window.__cozyshelvesWeb.library; const books = Object.values(l.books).filter((b) => !b.missing); return { folders: window.__app.state.settings.folders.length, attention: l.attention().length, books: books.length, indexed: books.filter((b) => b.indexed).length, reindexed: l.scanState.done, scanning: !!l._scanning || !!l.scanState.active }; });
    check('the folder picked again joins the records', re.length === 1 && joined.folders === 1 && joined.attention === 0 && joined.books === st.n && joined.indexed === st.n && joined.reindexed === 0, JSON.stringify(joined));
  } else {
    check('library survives a reload without a new pick', again.folders === 1 && again.books === st.n && again.indexed === st.n && !again.welcome && !again.attention.length, `${again.books} books, ${again.covers} covers, unavailable ${JSON.stringify(again.unavailable)}`);
  }
  check('reading position survives a reload', !!again.loc && again.loc === after.loc);

  // ---- 7. the desktop-only entries are hidden ---------------------------------------------------------------------------
  const ui = await page.evaluate(() => {
    const texts = [...document.querySelectorAll('.menu-root button')].map((b) => b.textContent.trim());
    return { texts, quit: texts.some((t) => /beenden|quit/i.test(t)), apps: texts.filter((t) => /mediathek|media library|browser|hörbücher|audiobooks|volltext|full-text|fernleihe|interlibrary/i.test(t)) };
  });
  check('menu without desktop-only programmes', !ui.quit && ui.apps.length === 0, ui.apps.join(', ') || 'none shown');
  await shot('web-menu-en');

  // ---- 8. console --------------------------------------------------------------------------------------------------------
  const noise = errors.filter((e) => !/favicon/.test(e));
  check('no console errors', noise.length === 0, noise.slice(0, 5).join(' || '));

  const failed = results.filter((r) => !r.ok);
  console.log(`WEB-CHECK ${failed.length ? 'FAILED ' + failed.length + ' of ' + results.length : 'OK ' + results.length + ' checks'}`);
  if (failed.length) throw new Error('web-check failed: ' + failed.map((f) => f.name).join('; '));
};
