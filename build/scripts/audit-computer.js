// Audit: the library computer. Every section, the catalogue search (title and full text), and every game is
// opened, played a little with keys or clicks, and closed again. Page errors are collected per step.
// Then the history (header arrows, Alt+arrows, the mouse's side buttons through a synthetic mouseup with button
// 3 or 4) and the appearance (Hell, Sepia, Dunkel from the System section) are walked through.
const kit = require('./audit-lib');

module.exports = async (env) => {
  const k = kit(env);
  const { page, shot, sleep, log } = k;
  await k.boot();
  const press = async (key, n = 1, wait = 120) => { for (let i = 0; i < n; i++) { await page.keyboard.press(key); await sleep(wait); } };
  const text = (sel) => page.evaluate((s) => (document.querySelector(s)?.innerText || '').replace(/\s+/g, ' ').slice(0, 260), sel);

  // ---- sections ------------------------------------------------------------------------------------------------
  for (const sec of ['catalog', 'history', 'diary', 'stats', 'system']) {
    k.newErrors();
    await k.open('computer', { section: sec }, 2200);
    if (sec === 'catalog') {
      await page.keyboard.type('Antike'); await sleep(900);
      log('CATALOG-SEARCH ' + await text('.term-content'));
      await press('ArrowDown'); await press('Enter', 1, 1500);
      log('CATALOG-DETAIL ' + await text('.term-content'));
      await shot('pc-catalog-detail');
    }
    if (sec === 'stats') await shot('pc-stats');
    if (sec === 'history') await shot('pc-history');
    log(`SECTION ${sec} errors=${JSON.stringify(k.newErrors())} text=${(await text('.term-content')).slice(0, 160)}`);
    await k.closeAll();
  }

  // ---- games ---------------------------------------------------------------------------------------------------
  const games = [
    ['chess', async () => { await sleep(4000); }],
    ['go', async () => { const c = await page.$('.term-game-body canvas'); const b = c && await c.boundingBox(); if (b) { await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(2500); } }],
    ['reversi', async () => { await page.evaluate(() => { const c = document.querySelector('.term-game-body canvas'); if (!c) return; const r = c.getBoundingClientRect(); const cell = r.width / 8; c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + cell * 3.5, clientY: r.top + cell * 2.5 })); }); await sleep(2500); }],
    ['mill', async () => { await sleep(800); }],
    ['draughts', async () => { await sleep(800); }],
    ['mastermind', async () => { await press('1'); await press('2'); await press('3'); await press('4'); await press('Enter', 1, 800); }],
    ['2048', async () => { await press('ArrowLeft'); await press('ArrowUp'); await press('ArrowRight'); await press('ArrowDown', 1, 500); }],
    ['mines', async () => { await press('Enter', 1, 800); }],
    ['sudoku', async () => { await press('ArrowRight'); await press('5', 1, 500); }],
    ['solitaire', async () => { await sleep(800); }],
    ['snake', async () => { await press('ArrowUp', 1, 1200); }],
    ['blocks', async () => { await press('ArrowLeft'); await press('ArrowUp', 1, 1200); }],
    ['memory', async () => { await press('Enter', 1, 800); }],
    ['lichess', async () => { await sleep(6000); }],
  ];
  for (const [id, play] of games) {
    k.newErrors();
    await k.open('computer', { section: 'games', game: id }, 3000);
    const before = await text('.term-game-body');
    try { await play(); } catch (e) { log('PLAY-ERR ' + id + ' ' + e.message); }
    const after = await text('.term-game-body');
    const side = await text('.term-game-side');
    await shot('pc-game-' + id);
    log(`GAME ${id} errors=${JSON.stringify(k.newErrors().slice(0, 3))} side="${side}" changed=${before !== after} text="${after.slice(0, 150)}"`);
    await press('Escape', 1, 500);
    // a running action game (snake, blocks) pauses on the first Escape and leaves on the second
    if (!await page.evaluate(() => !!document.querySelector('.term-game-grid'))) await press('Escape', 1, 500);
    log(`GAME ${id} back-to-menu=${await page.evaluate(() => !!document.querySelector('.term-game-grid'))}`);
    await k.closeAll();
  }
  // ---- history: every step can be walked back and forward -------------------------------------------------
  const nav = () => page.evaluate(() => {
    const b = document.querySelector('.term-header .nav-back'), f = document.querySelector('.term-header .nav-forward');
    return {
      back: !!b && !b.disabled, fwd: !!f && !f.disabled,
      section: document.querySelector('.term-nav-item.active')?.dataset.id || null,
      crumbs: (document.querySelector('.term-crumbs')?.innerText || '').replace(/\s+/g, ' ').trim(),
      detail: !!document.querySelector('.term-detail'),
      sort: document.querySelector('.term-sort.on')?.dataset.sort || null,
      status: document.querySelector('.term-status-seg .term-seg-btn.on')?.dataset.status || null,
      game: document.querySelector('.term-game-title')?.textContent || null,
      range: document.querySelector('.term-chart-card .term-seg-btn.on')?.textContent || null,
    };
  });
  const altArrow = async (dir, wait = 900) => { await page.keyboard.press(dir < 0 ? 'Alt+ArrowLeft' : 'Alt+ArrowRight'); await sleep(wait); };
  const sideButton = async (button, wait = 900) => { await page.evaluate((b) => document.querySelector('.term-stage').dispatchEvent(new MouseEvent('mouseup', { button: b, bubbles: true })), button); await sleep(wait); };
  k.newErrors();
  await k.open('computer', {}, 2000);
  log('NAV start ' + JSON.stringify(await nav()));
  await press('1', 1, 1600);
  log('NAV catalog ' + JSON.stringify(await nav()));
  await k.click('.term-sort[data-sort="pages"]', 700);
  await k.click('.term-status-seg .term-seg-btn[data-status="unread"]', 700);
  await page.evaluate(() => { document.activeElement?.blur?.(); document.querySelector('.term-stage')?.focus(); });
  await press('ArrowDown'); await press('Enter', 1, 1600);
  log('NAV detail ' + JSON.stringify(await nav()));
  await shot('pc-nav-detail');
  await altArrow(-1); log('NAV back1 ' + JSON.stringify(await nav()));
  await altArrow(-1); log('NAV back2 ' + JSON.stringify(await nav()));
  await altArrow(-1); log('NAV back3 ' + JSON.stringify(await nav()));
  await altArrow(-1); log('NAV back4 ' + JSON.stringify(await nav()));
  await k.click('.term-header .nav-forward', 1400); log('NAV fwd-button ' + JSON.stringify(await nav()));
  await sideButton(4, 1000); log('NAV mouse5 ' + JSON.stringify(await nav()));
  await sideButton(4, 1000); log('NAV mouse5b ' + JSON.stringify(await nav()));
  await sideButton(3, 1000); log('NAV mouse4 ' + JSON.stringify(await nav()));
  // a detail view closed with Escape is one step back: forward opens it again
  await altArrow(1, 1000); log('NAV fwd-list ' + JSON.stringify(await nav()));
  await altArrow(1, 1400); log('NAV fwd-detail ' + JSON.stringify(await nav()));
  await press('Escape', 1, 900); log('NAV esc-detail ' + JSON.stringify(await nav()));
  await altArrow(1, 1400); log('NAV fwd-again ' + JSON.stringify(await nav()));
  // games: open one, Escape to the cards, forward starts it again
  await page.keyboard.press('Alt+5'); await sleep(1400);
  await press('7', 1, 2500); log('NAV game ' + JSON.stringify(await nav()));
  await press('Escape', 1, 900); log('NAV game-esc ' + JSON.stringify(await nav()));
  await altArrow(1, 2500); log('NAV game-fwd ' + JSON.stringify(await nav()));
  // statistics: the time range is a step
  await page.keyboard.press('Alt+4'); await sleep(2000);
  await press('ArrowRight', 1, 900); log('NAV stats-range ' + JSON.stringify(await nav()));
  await altArrow(-1, 900); log('NAV stats-back ' + JSON.stringify(await nav()));
  log('NAV errors=' + JSON.stringify(k.newErrors()));
  await k.closeAll();

  // ---- appearance from the System section -------------------------------------------------------------------
  await k.open('computer', { section: 'system' }, 2000);
  for (const t of ['dark', 'light', 'sepia']) {
    await page.evaluate((th) => document.querySelector(`.term-system .theme-opt[data-theme="${th}"]`)?.click(), t);
    await sleep(1100);
    const r = await page.evaluate(async () => ({
      html: document.documentElement.dataset.theme,
      panel: getComputedStyle(document.querySelector('.panel.computer')).backgroundColor,
      text: getComputedStyle(document.querySelector('.term-sys-label')).color,
      picked: document.querySelector('.term-system .theme-opt.on')?.dataset.theme,
      stored: (await window.api.settings.get()).ui?.theme,
      mirror: localStorage.getItem('lesesaal.theme'),
    }));
    r.window = await env.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getBackgroundColor()).join(','));
    log(`THEME ${t} ${JSON.stringify(r)}`);
    await shot('pc-theme-' + t);
  }
  // keyboard: ←/→ on the appearance row (Home selects the first row, the appearance)
  await page.evaluate(() => document.querySelector('.term-stage')?.focus());
  await press('Home', 1, 300);
  log('THEME row ' + await page.evaluate(() => document.querySelector('.term-sys-row.term-sel .term-sys-label')?.textContent));
  await press('ArrowRight', 1, 1100);
  log('THEME key→ ' + await page.evaluate(() => document.documentElement.dataset.theme));
  await press('ArrowLeft', 1, 1100);
  log('THEME key← ' + await page.evaluate(() => document.documentElement.dataset.theme));
  await k.closeAll();
  log('ALL-ERRORS ' + JSON.stringify(k.errors.slice(0, 20), null, 1));
};
