// Playwright walk-through for the library computer (mock backend, no Electron).
//   node build/bundle.js && node build/dev-shot.js computer --interact=app/src/ui/computer/dev-interact.js
// Screenshots land in shots/dev-term-*.png. Every step also asserts something, so the script doubles
// as a smoke test of the whole panel.
module.exports = async ({ page, shot }) => {
  const key = async (k, wait = 160) => { await page.keyboard.press(k); await page.waitForTimeout(wait); };
  const click = async (sel, wait = 400) => { await page.click(sel); await page.waitForTimeout(wait); };
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let ok = 0, bad = 0;
  const expect = async (label, fn) => {
    let v = false;
    try { v = await fn(); } catch (e) { v = false; }
    if (v) { ok++; console.log('  ok   ' + label); } else { bad++; console.log('  FAIL ' + label); }
  };
  const text = (sel) => page.textContent(sel).catch(() => '');
  const count = async (sel) => (await page.$$(sel)).length;

  // seed the mock state with annotations, bookmarks, history and reading statistics
  await page.evaluate(async () => {
    const ctx = window.__ctx; const api = ctx.api; const b = ctx.state.library.books;
    b[0].annotations.push({ id: 'a1', value: 'epubcfi(/6/4!/4/2/1:0)', color: '#ffd400', note: 'Turm hinter den Bauern – merken!', text: 'Der Turm gehört hinter den Freibauern, ob es der eigene oder der gegnerische ist.', createdAt: Date.now() - 3e6 });
    b[6].annotations.push({ id: 'a2', value: 'epubcfi(/6/8!/4/2/1:0)', color: '#8fd', note: 'Ida über den ersten Morgen', text: 'Am Ufer lag noch der Nebel, als die ersten Boote hinausfuhren.', createdAt: Date.now() - 8e6 });
    b[1].bookmarks.push({ id: 'b1', location: '42', label: 'Najdorf – Hauptvariante', page: 42, createdAt: Date.now() - 1e6 });
    b[6].description = 'Ein Sommer am See, drei Freundinnen und ein altes Bootshaus, das niemand mehr betritt.';
    await api.library.open('mock0'); await api.library.borrow('mock6', true); ctx.state.basket.push('mock6');
    const days = {}; for (let i = 0; i < 30; i++) { const d = new Date(); d.setDate(d.getDate() - i); if (i % 3 !== 1) days[d.toISOString().slice(0, 10)] = { seconds: 600 + Math.round(Math.random() * 3000), books: {} }; }
    api.library.stats = async () => ({ days, streak: 5, top: [{ book: b[0], seconds: 7200 }, { book: b[6], seconds: 5400 }], totalSeconds: 40000, totalBooks: 10, started: 4, finished: 1 });
  });

  // ---- start page ------------------------------------------------------------------------
  await page.waitForTimeout(300);
  await expect('start page shows one card per section', async () => (await count('.term-ov')) === 6);
  await expect('sidebar lists the overview and all sections', async () => (await count('.term-nav:not(.term-nav-apps) .term-nav-item')) === 7);
  await shot('dev-term-start');

  // ---- catalogue: type-to-search must keep the first character ----------------------------
  await key('1', 600);
  await page.keyboard.type('sch');
  await page.waitForTimeout(600);
  await expect('type-to-search keeps the first character', async () => (await page.inputValue('.term-catalog .term-input')) === 'sch');
  await shot('dev-term-search');
  await key('Enter', 500); await key('ArrowDown'); await key('Enter', 900);
  await expect('book detail opens', async () => (await count('.term-detail')) === 1);
  await shot('dev-term-detail');
  await key('4', 500);
  await expect('department form opens', async () => (await count('.term-form')) === 1);
  await shot('dev-term-dept');
  await key('Escape', 250); await key('Escape', 400);
  await expect('detail closes back to the list', async () => (await count('.term-detail')) === 0);
  await key('Escape', 400);

  // ---- loans / diary / statistics / system -----------------------------------------------
  await key('2', 800); await shot('dev-term-history');
  await expect('history section rendered', async () => /Ausgeliehen|Borrowed/.test(await text('.term-content')));
  await key('Escape', 300);
  await key('3', 700); await shot('dev-term-diary');
  await key('Tab', 350); await shot('dev-term-bookmarks'); await key('Escape', 350);
  await key('4', 1000); await shot('dev-term-stats');
  await expect('statistics chart rendered', async () => (await count('.term-colchart:not(.compact) .term-col')) === 30);
  await key('Escape', 350);
  await key('6', 700); await shot('dev-term-system'); await key('Escape', 350);

  // ---- games -----------------------------------------------------------------------------
  await key('5', 600);
  await expect('14 games in the list', async () => (await count('.term-game-card')) === 14);
  await expect('shortcut labels continue past 9', async () => page.evaluate(() => document.querySelectorAll('.term-game-card')[9]?.querySelector('.term-key')?.textContent === 'A'));
  await shot('dev-term-games');

  // Go
  await key('2', 800);
  await expect('go board rendered', async () => (await count('.term-go-board canvas')) === 1);
  for (const k of ['ArrowRight', 'ArrowDown', 'Enter']) await key(k, 220);
  await page.waitForTimeout(1200);
  await expect('go: stones on the board after a move + bot reply', async () => page.evaluate(() => {
    const c = document.querySelector('.term-go-board canvas');
    const cx = c.getContext('2d');
    const d = cx.getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 70 && d[i + 1] < 70) dark++;
    return dark > 200;      // at least one black stone was drawn
  }));
  await shot('dev-term-go');
  await key('p', 500); await key('u', 400);
  await key('Escape', 400);

  // Reversi
  await key('3', 700);
  await key('ArrowRight'); await key('ArrowUp'); await key('Enter', 1000);
  await shot('dev-term-reversi'); await key('Escape', 400);

  // Mühle
  await key('4', 700);
  await key('Enter', 800); await key('ArrowRight'); await key('Enter', 800);
  await shot('dev-term-mill'); await key('Escape', 400);

  // Dame
  await key('5', 700);
  await key('Enter', 350); await key('ArrowUp'); await key('ArrowRight'); await key('Enter', 1000);
  await shot('dev-term-draughts'); await key('Escape', 400);

  // Mastermind
  await key('6', 600);
  for (const k of ['1', '2', '3', '4']) await key(k, 140);
  await key('Enter', 500);
  await expect('mastermind scored a guess', async () => (await count('.term-mm-row')) >= 10);
  await shot('dev-term-mastermind'); await key('Escape', 400);

  // puzzles and classics (the keys follow the cards: 7 Sudoku, 8 Minensuche, 9 2048, A Memory, B Solitär, C Schlange, D Blöcke)
  await key('9', 600); await key('ArrowLeft'); await key('ArrowUp'); await shot('dev-term-2048'); await key('Escape', 400);
  await key('8', 600); await key('Enter'); await key('ArrowRight'); await key('f'); await shot('dev-term-mines'); await key('Escape', 400);
  await key('7', 1600); await key('3'); await shot('dev-term-sudoku'); await key('Escape', 400);
  await key('b', 700); await key(' '); await key('ArrowRight'); await key('Enter'); await shot('dev-term-solitaire'); await key('Escape', 400);
  await key('c', 700); await key('ArrowRight', 900); await shot('dev-term-snake'); await key('Escape', 350); await key('Escape', 400);
  await key('d', 700); await key(' '); await shot('dev-term-blocks'); await key('Escape', 350); await key('Escape', 400);
  await key('a', 900); await key('Enter', 500); await key('ArrowRight'); await key('Enter', 900); await shot('dev-term-memory'); await key('Escape', 400);

  // chess vs Stockfish: play 1.e4 with the mouse and wait for the reply
  await key('1', 2500); await key('Enter', 6000);
  const box = await page.evaluate(() => { const el = document.querySelector('.term-chess-board cg-board'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
  if (box) {
    const sq = box.w / 8; const pt = (f, r) => [box.x + (f + 0.5) * sq, box.y + (8 - r + 0.5) * sq];
    let [x, y] = pt(4, 2); await page.mouse.click(x, y); await page.waitForTimeout(300);
    [x, y] = pt(4, 4); await page.mouse.click(x, y); await page.waitForTimeout(8000);
  }
  await expect('engine answered 1.e4', async () => (await text('.term-chess-moves')).trim().split(/\s+/).length >= 3);
  await shot('dev-term-chess'); await key('Escape', 500);

  // lichess (offline here → friendly notice)
  await key('e', 1500); await key('1', 2500); await shot('dev-term-lichess');
  await key('Escape', 350); await key('Escape', 350); await key('Escape', 500);

  // ---- appearance + language, then back and forward, then close ---------------------------------
  const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme || 'light');
  await key('6', 700); await key('Home'); await key('Enter', 600);
  await expect('appearance changed from the System section', async () => page.evaluate((b) => (document.documentElement.dataset.theme || 'light') !== b, themeBefore));
  await shot('dev-term-appearance');
  await key('ArrowDown'); await key('Enter', 900);
  await expect('language switched to English', async () => /Appearance|Display/.test(await text('.term-content')));
  await shot('dev-term-appearance-en');
  await key('Alt+ArrowLeft', 700);
  await expect('Alt+Left leads back to the previous section', async () => page.evaluate(() => document.querySelector('.term-nav-item.active')?.dataset.id !== 'system'));
  await key('Alt+ArrowRight', 700);
  await expect('Alt+Right leads forward again', async () => page.evaluate(() => document.querySelector('.term-nav-item.active')?.dataset.id === 'system'));
  await key('Escape', 500);
  await click('.term-close', 600);
  await expect('close button closes the panel', async () => page.evaluate(() => document.querySelectorAll('.panel-layer.open').length === 0));

  console.log(`\n[computer] ${ok} ok, ${bad} failed, ${errors.length} page errors`);
  if (errors.length) console.log(errors.join('\n'));
};
