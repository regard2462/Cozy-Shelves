// UI review: the HUD states and every panel, for a look at the 2D interface at one time of day.
// COZYSHELVES_QUERY=hour=12 or hour=22 picks the time, SHOT_TAG prefixes the file names, UI_PARTS limits the run
// (comma list of: loading, start, hud, media, wheel, menu, settings, reader, computer, panels, net, deep).
// UI_THEME=light|sepia|dark picks the appearance (Hell, Sepia, Dunkel) through the settings, as a user would;
// COZYSHELVES_QUERY=theme=dark does the same from the very first paint (for the loading screen).
// After each shot a rough contrast check lists text whose colour is too close to the colour behind it
// (walks up to the first painted background, so gradients and pictures are skipped).
module.exports = async ({ page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || 'ui';
  const theme = process.env.UI_THEME;
  if (theme) {
    await page.waitForFunction(() => window.api && window.api.settings, null, { timeout: 60000 }).catch(() => {});
    await page.evaluate((t) => window.api.settings.set({ ui: { theme: t } }), theme);
  }
  const only = (process.env.UI_PARTS || '').split(',').filter(Boolean);
  const want = (p) => !only.length || only.includes(p);
  const errors = [];
  const ignore = [/root document of this element is not valid for pointer lock/i, /THREE\.Clock/];
  page.on('pageerror', (e) => { if (!ignore.some((r) => r.test(e.message))) errors.push('pageerror: ' + e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !ignore.some((r) => r.test(m.text()))) errors.push('console: ' + m.text().slice(0, 240)); });
  const snap = async (name) => {
    await shot(`${tag}-${name}`);
    const low = await page.evaluate(contrastAudit);
    if (low.length) console.log(`CONTRAST ${name}: ` + low.join(' | '));
  };
  const frames = async (count = 6, gap = 140) => { for (let i = 0; i < count; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(gap); } };
  const pose = (x, z, yaw, pitch) => page.evaluate(([x, z, yaw, pitch]) => { const w = window.__app.world; if (w.actions.seatedId) w.actions.stand(); w.player.transition = null; w.player.setPose(x, z, yaw, pitch); }, [x, z, yaw, pitch]);
  const open = async (name, params = {}, wait = 2500) => { await page.evaluate(([n, p]) => window.__app.openPanel(n, p), [name, params]); await sleep(wait); };
  const closeAll = async () => { await page.evaluate(() => window.__app.closeAllPanels()); await sleep(450); };
  const click = (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (el) el.click(); return !!el; }, sel);
  const clickNth = (sel, i) => page.evaluate(([s, i]) => { const el = document.querySelectorAll(s)[i]; if (el) el.click(); return !!el; }, [sel, i]);

  if (want('loading')) {
    await page.waitForFunction(() => { const l = document.querySelector('#loading'); return l && l.textContent.trim(); }, null, { timeout: 60000 }).catch(() => {});
    await snap('loading');
  }
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await sleep(1200);
  // ---- start screen (the world renders behind the menu) ----
  if (want('start')) {
    await page.evaluate(() => window.__app.world.stop());
    await pose(6.4, 0.4, Math.PI / 2, -0.02);
    await frames(8);
    await snap('menu-start');
    await clickNth('.menu-btn', 1); await sleep(500);
    await snap('menu-guide');
  }
  // ---- enter ----
  await page.evaluate(() => { const b = document.querySelector('.menu-btn.primary'); if (b) b.click(); });
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(1500);
  await page.evaluate(() => window.__app.world.stop());
  await closeAll();
  const ids = await page.evaluate(() => window.__app.state.library.books.map((b) => b.id));

  if (want('hud')) {
    await pose(6.4, 0.4, Math.PI / 2, -0.02);
    await frames(8);
    await snap('hud-hall');
    // a book under the crosshair: the crosshair ring and the cover card on the right (no text line any more)
    await page.evaluate(() => {
      const w = window.__app.world;
      const e = [...w.books.entries.values()].find((x) => !x.hidden && x.pos.y > 1.2 && x.pos.y < 1.8);
      const p = e.pos.clone().addScaledVector(e.forward, 0.75);
      w.player.transition = null; w.player.setPose(p.x, p.z, Math.atan2(e.forward.x, e.forward.z), Math.atan2(e.pos.y - 1.62, 0.75));
      w.player.update(0.016); w.camera.updateMatrixWorld();
      w.actions.rayTimer = 0; w.actions.update(0.01);
    });
    await frames(6);
    await snap('hud-peek');
    // basket strip + toast
    await page.evaluate((list) => { for (const id of list) window.__app.world.actions.takeBook(id); }, ids.slice(3, 8));
    await sleep(500);
    await pose(0.5, -4.4, Math.PI, 0.02);
    await frames(6);
    await snap('hud-basket-toast');
    // seated: the "stand up" chip bottom left
    await page.evaluate(() => { const w = window.__app.world; const s = w.seats.get('sofa'); w.player.transition = null; w.player.setPose(s.standPos.x, s.standPos.z, s.standYaw, 0); w.actions.sit('sofa'); });
    await frames(10);
    await page.evaluate(() => window.__app.ctx.toast('Probe: ein Hinweis unten in der Mitte'));
    // software GL may hold back the next frames: wait until the toast has faded in
    await page.waitForFunction(() => { const t = document.querySelector('.toast'); return t && getComputedStyle(t).opacity === '1'; }, null, { timeout: 20000 }).catch(() => console.log('toast not faded in'));
    await snap('hud-seated');
    await page.evaluate(() => window.__app.world.actions.stand());
  }
  if (want('wheel')) {
    await pose(0, -10.2, 0, -0.02);
    await frames(6);
    await page.evaluate(() => window.__app.ctx.openWheel());
    await sleep(500);
    await snap('hud-wheel');
    await page.keyboard.press('Escape');
    await sleep(300);
  }
  if (want('media')) {
    await pose(6.4, 0.4, Math.PI / 2, -0.02);
    await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 640; c.height = 360;
      const g = c.getContext('2d');
      const draw = () => { g.fillStyle = '#3a6ea5'; g.fillRect(0, 0, 640, 360); g.fillStyle = '#f0f0f0'; g.font = 'bold 44px Georgia'; g.fillText('Testbild', 220, 190); };
      draw(); window.__testTimer = setInterval(draw, 200);
      await window.__app.ctx.media.play({ id: 'test', title: 'Ein Testfilm mit einem recht langen Titel', channel: 'ARD', stream: c.captureStream(10) }, { mode: 'audio' });
    });
    await sleep(1500);
    await frames(6);
    await snap('hud-media');
    await page.evaluate(() => { window.__app.ctx.media.stop(); clearInterval(window.__testTimer); });
    await sleep(400);
  }
  // a calm backdrop for the panels: the hall
  await pose(6.4, 0.4, Math.PI / 2, -0.02);
  await frames(8);

  if (want('menu')) {
    for (const tab of ['start', 'guide', 'places', 'recent']) { await open('menu', { tab }, 1500); await snap('menu-' + tab); await closeAll(); }
  }
  if (want('settings')) {
    await open('settings', {}, 1500);
    const count = await page.evaluate(() => document.querySelectorAll('.settings-nav button').length);
    for (let i = 0; i < count; i++) { await clickNth('.settings-nav button', i); await sleep(500); await snap('settings-' + i); }
    await closeAll();
    await open('basket', {}, 1500); await snap('basket'); await closeAll();
    await open('bookinfo', { id: ids[4] }, 1500); await snap('bookinfo'); await closeAll();
  }
  if (want('reader')) {
    await page.evaluate((id) => window.__app.openPanel('reader', { id }), ids[4]);
    try { await page.waitForFunction(() => document.querySelector('.rd-root') && !document.querySelector('.rd-loading'), null, { timeout: 60000 }); } catch { console.log('reader still loading'); }
    await sleep(2500);
    await page.mouse.move(800, 420); await page.mouse.move(820, 430); await sleep(400);   // shows the toolbars
    await snap('reader');
    await page.keyboard.press('KeyT'); await sleep(900); await snap('reader-sidebar');
    await page.keyboard.press('KeyT'); await sleep(600);
    await page.keyboard.press('KeyS'); await sleep(700); await snap('reader-settings');
    await page.evaluate(() => { const b = document.querySelector('.rd-swatch-night'); if (b) b.click(); });
    await sleep(1500); await snap('reader-night');
    await page.keyboard.press('Escape'); await sleep(400);
    await page.keyboard.press('KeyT'); await sleep(900); await snap('reader-night-sidebar');
    await page.keyboard.press('KeyT'); await sleep(500);
    await page.evaluate(() => { const b = document.querySelector('.rd-swatch-paper'); if (b) b.click(); });
    await sleep(800);
    await closeAll();
  }
  if (want('computer')) {
    // a few read books, loans and notes, so the overview, the history and the diary have something to show
    await page.evaluate(async (list) => {
      const api = window.api; const now = Date.now();
      const picks = list.slice(2, 9); const progress = [0.34, 0.72, 0.12, 0.55, 1, 0.08, 0.9];
      for (let i = 0; i < picks.length; i++) {
        await api.library.open(picks[i]);
        await api.library.addReadingTime(picks[i], 240 + i * 50);
        await api.library.update(picks[i], { progress: progress[i], lastRead: now - i * 7 * 3600e3,
          annotations: i < 2 ? [{ id: 'n' + i, value: 'epubcfi(/6/4!/4/2/1:0)', color: i ? 'green' : 'yellow', text: i ? 'Die Bibliothek ist ein Ort der Ruhe.' : 'Es war einmal ein Leser, der las bis tief in die Nacht.', note: i ? '' : 'Schöner Anfang', createdAt: now - i * 5e6 }] : [],
          bookmarks: i === 1 ? [{ id: 'b1', location: '12', label: 'Kapitel 2', page: 12, createdAt: now - 4e6 }] : [] });
      }
    }, ids);
    await sleep(800);
    await open('computer', {}, 2500); await snap('computer-start');
    for (const section of ['catalog', 'history', 'diary', 'stats', 'games', 'system']) { await open('computer', { section }, 2200); await snap('computer-' + section); }
    await open('computer', { section: 'catalog', book: ids[3] }, 2500); await snap('computer-book');
    await open('computer', { section: 'games', game: '2048' }, 2500); await snap('computer-2048');
    await closeAll();
  }
  if (want('panels')) {
    for (const [name, params, wait] of [['records', {}, 2500], ['chess', {}, 5000], ['watercolor', {}, 8000], ['gallery', {}, 3000]]) {
      await open(name, params, wait); await snap(name); await closeAll();
    }
  }
  if (want('net')) {
    for (const [name, params, wait] of [['news', {}, 9000], ['wiki', {}, 8000], ['podcasts', {}, 6000], ['catalog', {}, 8000], ['mediathek', {}, 9000], ['browser', {}, 4000]]) {
      await open(name, params, wait); await snap(name); await closeAll();
    }
  }
  if (want('deep')) {
    // one level deeper: a chosen show, a film page, an article, a Wikipedia page, the evening tint, the look sheet
    await open('podcasts', {}, 5000); await click('.pod-show'); await sleep(6000); await snap('podcasts-show'); await closeAll();
    await open('mediathek', {}, 8000); await click('.mt-card'); await sleep(3500); await snap('mediathek-detail'); await closeAll();
    await open('news', {}, 9000); await click('.news-item'); await sleep(6000); await snap('news-article'); await closeAll();
    await open('wiki', { title: 'Bibliothek' }, 8000); await snap('wiki-article'); await closeAll();
    await open('catalog', {}, 8000); await page.evaluate(() => { const b = [...document.querySelectorAll('.cat-card .btn')].find((x) => /lesen|read/i.test(x.textContent) && !/browser/i.test(x.textContent)); if (b) b.click(); }); await sleep(7000); await snap('catalog-reading'); await closeAll();
    await open('computer', { section: 'games', game: 'mines' }, 2500); await snap('computer-mines');
    await open('computer', { section: 'games', game: 'sudoku' }, 2500); await snap('computer-sudoku');
    await closeAll();
    await open('browser', {}, 4000); await page.evaluate(() => { const b = document.querySelector('.br-status .br-ibtn'); if (b) b.click(); }); await sleep(1200); await snap('browser-look'); await closeAll();
    await open('chess', {}, 4000); await clickNth('.chess-mode', 1); await sleep(4000); await snap('chess-puzzles'); await closeAll();
  }
  console.log('THEME ' + await page.evaluate(() => document.documentElement.dataset.theme));
  console.log('ERRORS ' + JSON.stringify(errors.slice(0, 12)));
};

/** In the page: visible text whose contrast against the first painted background behind it is too low. */
function contrastAudit() {
  // rgb()/rgba(), and what color-mix() computes to: color(srgb r g b / a) and oklab(L a b / alpha)
  const gamma = (v) => 255 * Math.max(0, Math.min(1, v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  const parse = (s) => {
    s = s || '';
    let m = /rgba?\(([^)]+)\)/.exec(s);
    if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { c: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; }
    m = /color\(srgb ([^)]+)\)/.exec(s);
    if (m) { const [rgb, al] = m[1].split('/'); const p = rgb.trim().split(/\s+/).map(Number); return { c: p.map((v) => v * 255), a: al ? parseFloat(al) : 1 }; }
    m = /oklab\(([^)]+)\)/.exec(s);
    if (m) {
      const [lab, al] = m[1].split('/');
      let [L, A, B] = lab.trim().split(/\s+/).map((v) => (v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v)));
      const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, mm = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, ss = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
      return { c: [gamma(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * ss), gamma(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * ss), gamma(-0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * ss)], a: al ? parseFloat(al) : 1 };
    }
    return null;
  };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const mix = (a, b, t) => a.map((v, i) => v * t + b[i] * (1 - t));
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('#panels *, #hud *, #toasts *')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden') continue;
    // disabled controls are exempt (WCAG 1.4.3); board coordinates sit on the board picture, not on the panel
    if (el.closest('[disabled], [aria-disabled="true"], coords')) continue;
    // a panel under another one (the reader over the Fernleihe) is not seen
    const layer = el.closest('.panel-layer');
    if (layer) {
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const topLayer = top?.closest?.('.panel-layer');
      if (topLayer && topLayer !== layer) continue;
    }
    const fg = parse(cs.color); if (!fg) continue;
    // background: the first ancestor that paints one; opacity is collected on the way
    let alpha = fg.a, node = el, bg = null, unknown = false;
    const layers = [];
    while (node && node.nodeType === 1) {
      const s = getComputedStyle(node);
      if (s.display === 'none') { alpha = 0; break; }
      alpha *= parseFloat(s.opacity);
      if (s.backgroundImage && s.backgroundImage !== 'none') { unknown = true; break; }   // gradient or picture
      const b = parse(s.backgroundColor);
      if (b && b.a > 0) { layers.push(b); if (b.a >= 0.9) break; }
      node = node.parentElement;
    }
    if (unknown || alpha < 0.05 || !layers.length) continue;
    let base = layers[layers.length - 1].a >= 0.9 ? layers[layers.length - 1].c : null;
    if (!base) continue;   // translucent all the way down: the 3D world is behind it
    for (let i = layers.length - 2; i >= 0; i--) base = mix(layers[i].c, base, layers[i].a);
    const col = mix(fg.c, base, Math.min(1, alpha));
    const l1 = lum(col), l2 = lum(base);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 600;
    const need = size >= 24 || (bold && size >= 18.6) ? 3 : 4.5;
    if (ratio < need) {
      const key = (el.className && typeof el.className === 'string' ? el.tagName.toLowerCase() + '.' + el.className.split(' ').join('.') : el.tagName.toLowerCase());
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(`${key} "${el.textContent.trim().slice(0, 24)}" ${ratio.toFixed(2)}`);
      if (out.length > 14) break;
    }
  }
  return out;
}
