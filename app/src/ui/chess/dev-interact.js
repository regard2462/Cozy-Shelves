// Playwright interaction script for the chess panel (used with build/dev-shot.js, NOT bundled):
//   node build/bundle.js
//   node build/dev-shot.js chess bookId=mock0 --interact=app/src/ui/chess/dev-interact.js
// Exercises: SAN playback (German notation), keyboard navigation, illegal-move reporting, free mode + palette
// (2D & 3D), saving a position to a book, Stockfish analysis, promotion dialog, 3D drag & drop / click-click,
// undo, board flip and the language switch. Screenshots land in shots/dev-chess-*.png.
module.exports = async ({ page, shot }) => {
  const log = (...a) => console.log('[chess-test]', ...a);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const fen = () => page.inputValue('.chess-fen');
  const expect = (label, cond) => log((cond ? 'ok   ' : 'FAIL ') + label);

  // ---- 0. the three modes of the chess table
  await page.waitForTimeout(800);
  expect('three modes offered', (await page.$$('.chess-mode')).length === 3);
  expect('a bookId selects the book mode', await page.isVisible('.chess-move-input'));
  await page.click('.chess-mode[data-mode="puzzles"]');
  await page.waitForTimeout(2500);
  expect('tactics trainer loads a puzzle', await page.isVisible('.chess-puzzle-board .chess-board'));
  expect('puzzle shows a rating', /\d{3,4}/.test(await page.textContent('.chess-puzzle-rating').catch(() => '')));
  await shot('dev-chess-puzzles');
  const puzzleCount = await page.evaluate(() => (document.querySelector('.chess-puzzle-note') || {}).textContent || '');
  log('puzzle set:', puzzleCount.trim());
  await page.click('button:has-text("Lösung zeigen")');
  await page.waitForTimeout(2500);
  expect('solution can be revealed', /Lösung:/.test(await page.textContent('.chess-puzzle-line').catch(() => '')));
  await shot('dev-chess-puzzle-solution');
  // solve one puzzle for real: the first move of the stored solution must be accepted
  await page.click('button:has-text("Nächste Aufgabe")');
  await page.waitForTimeout(1400);
  const pz = await page.evaluate(() => {
    const root = document.querySelector('.chess-puzzle');
    const p = root && root._puzzle;
    if (!p) return null;
    return { uci: p.s[0], solution: p.s.join(' '), rating: p.r, themes: (p.t || []).join(','), black: p.f.split(' ')[1] === 'b' };
  });
  if (pz) {
    log('puzzle under test:', pz.rating, pz.themes, pz.solution);
    const pb = await (await page.$('.chess-puzzle-board .chess-board-2d')).boundingBox();
    const sqp = (name) => {
      const f = 'abcdefgh'.indexOf(name[0]), r = Number(name[1]) - 1;
      const fx = pz.black ? 7 - f : f, ry = pz.black ? r : 7 - r;
      return { x: pb.x + (fx + 0.5) * pb.width / 8, y: pb.y + (ry + 0.5) * pb.height / 8 };
    };
    const a = sqp(pz.uci.slice(0, 2)), b2 = sqp(pz.uci.slice(2, 4));
    await page.mouse.click(a.x, a.y); await page.waitForTimeout(300);
    await page.mouse.click(b2.x, b2.y); await page.waitForTimeout(330);
    if (pz.uci.length > 4 && await page.isVisible('.chess-promotion-box')) {
      const role = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[pz.uci[4]];
      await page.click('.chess-promotion-piece piece.' + role);
      await page.waitForTimeout(400);
    }
    const first = (await page.textContent('.chess-puzzle-status').catch(() => '')).trim();
    expect('the stored solution is accepted by the trainer', /✓|★/.test(first));
    await page.waitForTimeout(1500);
    const st = (await page.textContent('.chess-puzzle-status').catch(() => '')).trim();
    log('trainer status after the solution move:', st);
    await shot('dev-chess-puzzle-solved');
  } else log('no puzzle data → skipping the solving test');

  // play mode: 1.e4 against Stockfish
  await page.click('.chess-mode[data-mode="play"]');
  await page.waitForTimeout(7000);
  const pbox = await page.evaluate(() => { const el = document.querySelector('.chess-play-board cg-board'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
  if (pbox) {
    const s2 = pbox.w / 8, pt = (f, r) => [pbox.x + (f + 0.5) * s2, pbox.y + (8 - r + 0.5) * s2];
    let [x, y] = pt(4, 2); await page.mouse.click(x, y); await page.waitForTimeout(300);
    [x, y] = pt(4, 4); await page.mouse.click(x, y); await page.waitForTimeout(9000);
  }
  const pm = (await page.textContent('.chess-play .chess-moves').catch(() => '')).trim();
  expect('Stockfish answered 1.e4 at the table', (await page.$$('.chess-play .chess-move')).length >= 2);
  log('moves after the engine reply:', pm);
  await shot('dev-chess-play');

  await page.click('.chess-mode[data-mode="book"]');
  await page.waitForTimeout(700);
  expect('book mode shows the move entry', await page.isVisible('.chess-move-input'));

  // ---- 1. SAN playback (German) + move list + keyboard navigation
  await page.fill('.chess-move-input', '1.e4 e5 2.Sf3 Sc6 3.Lb5 a6 4.La4 Sf6 5.0-0 Le7 6.Te1 b5 7.Lb3 d6 8.c3 0-0');
  await page.click('button:has-text("Nachspielen")');
  await page.waitForTimeout(9000);
  const ruy = await fen();
  expect('Ruy Lopez position reached', ruy.startsWith('r1bq1rk1/2p1bppp/p1np1n2/1p2p3/4P3/1BP2N2/PP1P1PPP/RNBQR1K1 w'));
  if (!ruy.startsWith('r1bq1rk1')) log('  fen was:', ruy);
  expect('16 moves in list', (await page.$$('.chess-move')).length === 17);
  await shot('dev-chess-moves');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(400);
  expect('ArrowLeft twice → d6 current', (await page.textContent('.chess-move.current')) === 'd6');
  await page.keyboard.press('End'); await page.waitForTimeout(300);

  // ---- 2. illegal move reporting
  await page.fill('.chess-move-input', '1.e4 e5 2.Ke2 Ke7 3.Qh5');
  await page.click('button:has-text("Nachspielen")');
  await page.waitForTimeout(2500);
  expect('illegal move reported', /Qh5/.test(await page.textContent('.chess-error')));

  // ---- 3. free mode: palette drop + drag off the board (2D)
  await page.click('.chess-seg-btn:has-text("Frei")');
  await page.waitForTimeout(400);
  const spare = await page.$('.chess-spare[data-color="white"][data-role="queen"]');
  const bb = await (await page.$('.chess-board-2d')).boundingBox();
  const sb = await spare.boundingBox();
  const sq = (file, rank) => ({ x: bb.x + (file + 0.5) * bb.width / 8, y: bb.y + (8 - rank + 0.5) * bb.height / 8 });
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await page.mouse.down();
  const d4 = sq(3, 4);
  await page.mouse.move(d4.x - 40, d4.y - 40, { steps: 6 }); await page.mouse.move(d4.x, d4.y, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(400);
  expect('spare queen dropped on d4', /\/3QP3\//.test(await fen()));
  const e4 = sq(4, 4);
  await page.mouse.move(e4.x, e4.y); await page.mouse.down();
  await page.mouse.move(bb.x + bb.width + 120, e4.y, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(400);
  expect('pawn e4 removed by dragging off', /\/3Q4\//.test(await fen()));
  await shot('dev-chess-free');

  // ---- 4. rules mode + save position to the book
  await page.click('.chess-seg-btn:has-text("Regeln")');
  await page.waitForTimeout(300);
  const saveBtn = await page.$('button:has-text("Stellung zum Buch speichern")');
  if (saveBtn) {
    await saveBtn.click(); await page.waitForTimeout(200);
    await page.fill('.chess-label-input', 'Diagramm 7');
    await page.click('.chess-save-row .btn.primary');
    await page.waitForTimeout(400);
    expect('position saved to book', (await page.$$('.chess-pos')).length === 1);
  } else log('no bookId → skipping save test');

  // ---- 5. engine
  await page.click('.chess-section .toggle');
  await page.waitForTimeout(12000);
  const evalText = await page.textContent('.chess-eval-text');
  log('eval:', evalText, '|', (await page.textContent('.chess-eval-line')).slice(0, 80));
  expect('engine produced a mate score', /#/.test(evalText));
  await shot('dev-chess-engine');
  await page.click('.chess-section .toggle');

  // ---- 6. promotion dialog (2D)
  await page.fill('.chess-fen', 'k7/4P3/8/8/8/8/8/4K3 w - - 0 1');
  await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  const bb2 = await (await page.$('.chess-board-2d')).boundingBox();
  const sq2 = (file, rank) => ({ x: bb2.x + (file + 0.5) * bb2.width / 8, y: bb2.y + (8 - rank + 0.5) * bb2.height / 8 });
  const e7 = sq2(4, 7), e8 = sq2(4, 8);
  await page.mouse.move(e7.x, e7.y); await page.mouse.down(); await page.mouse.move(e8.x, e8.y, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(400);
  expect('promotion dialog shown', await page.isVisible('.chess-promotion-box'));
  await shot('dev-chess-promotion');
  await page.click('.chess-promotion-piece piece.knight');
  await page.waitForTimeout(400);
  expect('promoted to knight', (await fen()).startsWith('k3N3/'));

  // ---- 7. 3D: drag & drop, click-click, flip, free mode
  await page.click('button:has-text("Start")');
  await page.click('.chess-seg-btn:has-text("3D")');
  await page.waitForTimeout(3000);
  await shot('dev-chess-3d');
  const cb = await (await page.$('.chess-board-3d canvas')).boundingBox();
  const proj = (key) => page.evaluate((key) => {
    const d = document.querySelector('.chess-board')._api._renderers['3d']._debug;
    const f = 'abcdefgh'.indexOf(key[0]), r = Number(key[1]) - 1;
    const v = d.camera.position.clone().set(f - 3.5, 0.25, 3.5 - r).project(d.camera);
    const rect = d.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (v.x + 1) / 2 * rect.width, y: rect.top + (1 - v.y) / 2 * rect.height };
  }, key);
  const drag3d = async (from, to) => {
    const a = await proj(from), b = await proj(to);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2 - 20, { steps: 8 }); await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.waitForTimeout(150); await page.mouse.up(); await page.waitForTimeout(600);
  };
  await drag3d('e2', 'e4');
  expect('3D drag e2-e4', (await fen()).startsWith('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b'));
  await drag3d('e7', 'e5');
  await drag3d('e4', 'e6');
  expect('3D illegal drag snaps back', (await fen()).startsWith('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w'));
  const g1 = await proj('g1'), f3 = await proj('f3');
  await page.mouse.click(g1.x, g1.y); await page.waitForTimeout(400);
  await shot('dev-chess-3d-selected');
  await page.mouse.click(f3.x, f3.y); await page.waitForTimeout(700);
  expect('3D click-click Nf3', /5N2\/PPPP1PPP\/RNBQKB1R b/.test(await fen()));
  await page.click('button:has-text("Zurück")'); await page.waitForTimeout(500);
  expect('undo in 3D', (await fen()).startsWith('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w'));
  await page.fill('.chess-move-input', '1.e4 d5 2.exd5 Qxd5 3.Nc3 Qa5 4.d4 Nf6 5.Nf3 Bf5 6.Bd2 e6 7.Bc4 c6 8.Qe2 Bb4 9.O-O-O');
  await page.click('button:has-text("Nachspielen")');
  await page.waitForTimeout(9000);
  expect('3D SAN game incl. castling', (await fen()).startsWith('rn2k2r/pp3ppp/2p1pn2/q4b2/1bBP4/2N2N2/PPPBQPPP/2KR3R b'));
  await shot('dev-chess-3d-game');
  await page.keyboard.press('f'); await page.waitForTimeout(1300);
  await shot('dev-chess-3d-flipped');
  await page.keyboard.press('f'); await page.waitForTimeout(1300);
  await page.click('.chess-seg-btn:has-text("Frei")'); await page.waitForTimeout(300);
  const spare3 = await page.$('.chess-spare[data-color="black"][data-role="queen"]');
  const sb3 = await spare3.boundingBox();
  await page.mouse.move(sb3.x + sb3.width / 2, sb3.y + sb3.height / 2); await page.mouse.down();
  const e3 = await proj('e3');
  await page.mouse.move(e3.x, e3.y - 30, { steps: 10 }); await page.waitForTimeout(300);
  await shot('dev-chess-3d-drag');
  await page.mouse.up(); await page.waitForTimeout(600);
  expect('3D palette drop (black queen somewhere on the board)', /q/.test((await fen()).split(' ')[0].replace(/^[^/]*\//, '')));
  const h2 = await proj('h2');
  await page.mouse.move(h2.x, h2.y); await page.mouse.down();
  await page.mouse.move(cb.x + cb.width - 10, cb.y + cb.height - 10, { steps: 8 });
  await page.mouse.move(cb.x + cb.width + 40, cb.y + cb.height + 20, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(600);
  expect('3D free: piece removed by dragging off', /PP1\s/.test((await fen()).split(' ')[0].split('/')[6] + ' '));
  await shot('dev-chess-3d-free');
  await page.click('.chess-seg-btn:has-text("2D")'); await page.waitForTimeout(500);

  // ---- 8. language switch
  await page.evaluate(() => window.__ctx.i18n.setLanguage('en'));
  await page.waitForTimeout(300);
  expect('english labels', /Chess table/.test(await page.textContent('.chess-title')));
  await page.evaluate(() => window.__ctx.i18n.setLanguage('de'));
  await page.click('button:has-text("Start")');
  await page.waitForTimeout(500);
  log('page errors:', errors.length ? errors : 'none');
};
