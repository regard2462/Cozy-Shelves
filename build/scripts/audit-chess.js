// Audit: chess table. A game against Stockfish (a real move with the mouse, the engine's reply, hint, undo,
// resign, new game as black), the puzzle trainer (a wrong move, the right line, next), the book positions tab,
// and the layout at three window sizes.
const kit = require('./audit-lib');

module.exports = async (env) => {
  const k = kit(env);
  const { page, shot, sleep, log } = k;
  await k.boot();
  const status = () => page.evaluate(() => document.querySelector('.chess-play-status, .chess-puzzle-status')?.textContent || '');
  const moves = () => page.evaluate(() => [...document.querySelectorAll('.chess-play .chess-move')].map((m) => m.textContent).join(' '));
  /** drag a piece on the 2D board from square a to square b (board orientation from the cg-wrap class) */
  const drag = async (from, to, root = '.chess-play') => {
    const box = await page.evaluate((r) => { const b = document.querySelector(r + ' cg-board'); if (!b) return null; const x = b.getBoundingClientRect(); const white = !document.querySelector(r + ' .cg-wrap.orientation-black'); return { x: x.left, y: x.top, s: x.width / 8, white }; }, root);
    if (!box) return false;
    const pt = (sq) => { const f = sq.charCodeAt(0) - 97, r = +sq[1] - 1; const col = box.white ? f : 7 - f, row = box.white ? 7 - r : r; return [box.x + (col + 0.5) * box.s, box.y + (row + 0.5) * box.s]; };
    const [x1, y1] = pt(from), [x2, y2] = pt(to);
    await page.mouse.move(x1, y1); await page.mouse.down(); await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 }); await page.mouse.move(x2, y2, { steps: 4 }); await page.mouse.up();
    return true;
  };
  const waitFor = async (fn, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(500); } return false; };

  // AUDIT_PART=book skips the Stockfish game and the puzzles
  const part = process.env.AUDIT_PART || 'all';
  if (part === 'all') {
  await k.open('chess', { mode: 'play' }, 6000);
  await waitFor(async () => /Du bist am Zug|Your move/.test(await status()));
  log('PLAY-START ' + await status() + ' board=' + await page.evaluate(() => Math.round(document.querySelector('.chess-play-boardwrap')?.getBoundingClientRect().width || 0)));
  await shot('ch-play-start');
  await drag('e2', 'e4');
  // the list holds the plies only (e4 e5): two entries mean Stockfish has answered
  const replied = await waitFor(async () => (await moves()).split(' ').filter(Boolean).length >= 2 && /Du bist am Zug|Your move|Schach/.test(await status()), 40000);
  log(`PLAY-MOVE replied=${replied} moves="${await moves()}" status="${await status()}"`);
  await page.keyboard.press('h');
  await waitFor(async () => /Tipp|Hint/.test(await status()), 15000);
  log('PLAY-HINT ' + await status() + ' arrows=' + await page.evaluate(() => document.querySelectorAll('.chess-play svg.cg-shapes line, .chess-play svg.cg-shapes path, .chess-play cg-auto-shapes svg g').length));
  await shot('ch-play-hint');
  await page.keyboard.press('u'); await sleep(1500);
  log(`PLAY-UNDO moves="${await moves()}" status="${await status()}"`);
  await k.clickText('.chess-play .btn', 'Aufgeben', 800);
  log('PLAY-RESIGN ' + await status());
  // new game with black: Stockfish opens
  await k.clickText('.chess-play .chess-seg-btn', 'Schwarz', 200);
  await k.clickText('.chess-play .btn', 'Neue Partie', 500);
  const opened = await waitFor(async () => (await moves()).length > 0, 30000);
  log(`PLAY-BLACK opened=${opened} moves="${await moves()}" orientation=${await page.evaluate(() => document.querySelector('.chess-play .cg-wrap')?.className)}`);
  await shot('ch-play-black');
  // the strength menu applies right away
  await page.evaluate(() => { const s = document.querySelector('.chess-play-strength'); s.value = '0'; s.dispatchEvent(new Event('change')); });
  await sleep(500);

  // ---- puzzles ------------------------------------------------------------------------------------------------
  await page.keyboard.press('2'); await sleep(2500);
  const pz = await page.evaluate(() => { const r = document.querySelector('.chess-puzzle'); return r?._puzzle ? { fen: r._puzzle.f, sol: r._puzzle.s } : null; });
  log('PUZZLE ' + JSON.stringify(pz) + ' status=' + await status());
  await shot('ch-puzzle');
  if (pz) {
    // a wrong move first: any legal move that is not the solution
    const wrong = await page.evaluate(({ fen, sol }) => { const b = document.querySelector('.chess-puzzle')._board; const legal = b.legalMoves ? b.legalMoves() : null; return legal ? legal.find((m) => m !== sol[0]) : null; }, pz);
    log('WRONG-CANDIDATE ' + wrong);
    // the solution: the solver's moves by mouse, the replies come from the trainer
    for (let i = 0; i < pz.sol.length; i += 2) {
      const u = pz.sol[i];
      await drag(u.slice(0, 2), u.slice(2, 4), '.chess-puzzle');
      await sleep(1600);
      const promo = await page.evaluate(() => !!document.querySelector('.chess-promotion'));
      if (promo) { await page.evaluate((p) => { const b = [...document.querySelectorAll('.chess-promotion-piece')][{ q: 0, r: 1, b: 2, n: 3 }[p] ?? 0]; b?.click(); }, u[4] || 'q'); await sleep(1200); }
    }
    log('PUZZLE-AFTER ' + await status() + ' | ' + await page.evaluate(() => document.querySelector('.chess-puzzle-line')?.textContent || ''));
    await shot('ch-puzzle-solved');
    await page.keyboard.press('n'); await sleep(1500);
    log('PUZZLE-NEXT ' + await status());
  }
  } else await k.open('chess', { mode: 'play' }, 3000);

  // ---- book positions tab ---------------------------------------------------------------------------------------
  await page.keyboard.press('3'); await sleep(2500);
  await page.evaluate(() => { const t = document.querySelector('.chess-move-input'); t.value = '1.e4 e5 2.Sf3 Sc6 3.Lb5 a6'; });
  await k.clickText('.chess-panel .btn', 'Nachspielen', 300);
  // the moves are animated one by one (300 ms each); the first entry of the list is the start position (⌂)
  const bookMoves = () => page.evaluate(() => document.querySelectorAll('.chess-moves .chess-move').length);
  await waitFor(async () => (await bookMoves()) >= 7, 6000);
  log('BOOK-MOVES ' + await page.evaluate(() => [...document.querySelectorAll('.chess-moves .chess-move')].map((m) => m.textContent).join(' ')) + ' fen=' + await page.evaluate(() => document.querySelector('.chess-fen')?.value));
  await shot('ch-book');
  await k.closeAll();

  for (const [w, hh] of [[1024, 640], [2560, 1440]]) {
    await k.setSize(w, hh);
    for (const mode of ['play', 'puzzles']) {
      await k.open('chess', { mode }, 4000);
      await shot(`ch-${w}-${mode}`);
      log(`SIZE ${w}x${hh} ${mode} board=${await page.evaluate(() => Math.round(document.querySelector('.chess-play-boardwrap, .chess-puzzle-boardwrap')?.getBoundingClientRect().width || 0))} overflow=${JSON.stringify(await k.overflow())}`);
      await k.closeAll();
    }
  }
  log('ALL-ERRORS ' + JSON.stringify(k.errors.slice(0, 20), null, 1));
};
