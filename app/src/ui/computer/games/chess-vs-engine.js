// Schach gegen Stockfish – uses the shared chess board (2D, legal moves) and the engine wrapper.
import { h, clear } from '../../../core/dom.js';
import { Chess } from 'chess.js';
import { btn, keyList, T, notice } from '../terminal.js';

export const LEVELS = [
  { skill: 0, elo: 1320, depth: 1, label: { de: 'Anfänger', en: 'Beginner' } },
  { skill: 3, elo: 1500, depth: 4, label: { de: 'Leicht', en: 'Easy' } },
  { skill: 8, elo: 1800, movetime: 300, label: { de: 'Mittel', en: 'Medium' } },
  { skill: 14, elo: 2200, movetime: 800, label: { de: 'Stark', en: 'Strong' } },
  { skill: 20, elo: null, movetime: 2000, label: { de: 'Meister', en: 'Master' } },
];

export async function loadChess() {
  try {
    const [b, e] = await Promise.all([import('../../chess/chess-board.js'), import('../../chess/engine.js')]);
    return { createChessBoard: b.createChessBoard, engine: e };
  } catch (e) { console.warn('[computer] chess module missing', e); return null; }
}

/** Applies a level to the engine. Waits for the running search first – UCI ignores setoption while searching. */
export async function applyLevel(eng, lv) {
  if (!eng) return;
  const opts = { 'Skill Level': lv.skill };
  if (lv.elo) { opts.UCI_LimitStrength = 'true'; opts.UCI_Elo = lv.elo; }
  else opts.UCI_LimitStrength = 'false';
  try { await eng.configure(opts); } catch (e) { console.warn('[chess] configure', e); }
}

export async function mount(root, g) {
  const { sfx, tr } = g;
  const mods = await loadChess();
  if (!mods) { root.appendChild(notice(T('Schachmodul lädt noch … bitte später erneut versuchen.', 'Chess module still loading … please try again later.'))); return {}; }
  const { createChessBoard, engine } = mods;

  let color = g.params?.color || 'white', level = g.params?.level ?? 2, showEval = true;
  let board = null, eng = null, acquired = false, over = false, token = 0, moveToken = 0, suppress = false, unsubChange = null, resultText = '';
  let view = null; // { onKey, unmount }

  // ---------------------------------------------------------------- setup
  function showSetup() {
    disposeGame();
    clear(root);
    const rows = [];
    const rowEl = (label, valueFn, cycle) => {
      const v = h('span.term-bright');
      const r = h('div.term-setup-row', h('span.term-k', label), h('span', '‹ ', v, ' ›'));
      r._paint = () => { v.textContent = valueFn(); }; r._cycle = cycle; r._paint(); rows.push(r); return r;
    };
    rowEl(T('Farbe', 'Colour'), () => ({ white: T('Weiß', 'White'), black: T('Schwarz', 'Black'), random: T('Zufall', 'Random') }[color]),
      (d) => { const opts = ['white', 'black', 'random']; color = opts[(opts.indexOf(color) + d + 3) % 3]; });
    rowEl(T('Stärke', 'Strength'), () => `${tr(LEVELS[level].label)} · ${LEVELS[level].elo ? '≈' + LEVELS[level].elo + ' Elo' : T('volle Stärke', 'full strength')}`,
      (d) => { level = (level + d + LEVELS.length) % LEVELS.length; });
    rowEl(T('Bewertung', 'Evaluation'), () => (showEval ? T('anzeigen', 'show') : T('verbergen', 'hide')), () => { showEval = !showEval; });
    const startRow = h('div.term-setup-row.start', h('span.term-k', ''), btn(T('Partie starten', 'Start game'), () => startGame(), 'primary'));
    rows.push(startRow);
    root.appendChild(h('div.term-setup',
      h('h3.term-h', '♞ ', T('Schach gegen Stockfish', 'Chess against Stockfish')),
      rows,
      h('div.term-dim.term-line', T('←→ oder Leertaste ändern · ↑↓ Zeile wechseln · ⏎ starten', '←→ or Space to change · ↑↓ row · ⏎ start'))));
    const list = keyList(rows, { wrap: true, onEnter: (r) => { if (r === startRow) startGame(); else { r._cycle(1); r._paint(); sfx.click(); } } });
    list.set(0, false);
    g.setHints([['←→', T('ändern', 'change')], ['⏎', T('starten', 'start')], ['Esc', T('Spiele', 'games')]]);
    view = { onKey(e) {
      const r = list.current;
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === ' ') && r?._cycle) { r._cycle(e.key === 'ArrowLeft' ? -1 : 1); r._paint(); sfx.click(); return true; }
      if (e.key === 'Enter') { startGame(); return true; }
      if (list.onKey(e)) { e.preventDefault(); return true; }
      return false;
    } };
  }

  // ---------------------------------------------------------------- game
  async function startGame() {
    sfx.click();
    const my = color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : color;
    const engineColor = my === 'white' ? 'black' : 'white';
    clear(root); over = false; resultText = ''; const myToken = ++token;
    const boardHost = h('div.term-chess-board');
    // locked until the engine is up: moves made in the meantime would never reach the engine
    const lock = h('div.term-chess-lock.on');
    const evalWrap = h('div.term-chess-eval');
    const evalBar = h('span.term-evalbar', h('i', { style: { width: '50%' } }));
    const evalText = h('span', '—');
    if (showEval) evalWrap.append(evalBar, evalText);
    const movesEl = h('div.term-chess-moves');
    const statusEl = h('div.term-chess-status');
    const side = h('div.term-chess-side',
      h('div.term-line', h('span.term-bright', my === 'white' ? T('Du spielst Weiß', 'You play White') : T('Du spielst Schwarz', 'You play Black')),
        h('span.term-dim', ' · Stockfish: ' + tr(LEVELS[level].label))),
      evalWrap, statusEl, movesEl,
      h('div.term-actions',
        btn(T('Neu (N)', 'New (N)'), () => showSetup()),
        btn(T('Zug zurück (U)', 'Undo (U)'), () => undo()),
        btn(T('Aufgeben (R)', 'Resign (R)'), () => resign(), 'danger'),
        btn(T('Drehen (F)', 'Flip (F)'), () => board?.flip())));
    root.appendChild(h('div.term-chess', h('div.term-chess-boardwrap', boardHost, lock), side));
    statusEl.textContent = T('Engine startet …', 'Starting engine …');
    try { board = createChessBoard(boardHost, { mode: '2d', orientation: my, free: false }); }
    catch (e) { statusEl.textContent = T('Brett konnte nicht erstellt werden: ', 'Could not create board: ') + e.message; return; }

    const setLock = (v) => { lock.classList.toggle('on', v); };
    const paintMoves = (moves) => {
      clear(movesEl);
      const parts = [];
      moves.forEach((m, i) => { if (i % 2 === 0) parts.push(h('span.term-dim', `${i / 2 + 1}. `)); parts.push(h('span', m.san + ' ')); });
      movesEl.append(...parts); movesEl.scrollTop = movesEl.scrollHeight;
    };
    const checkResult = (fen) => {
      const c = new Chess(fen);
      if (c.isCheckmate()) resultText = c.turn() === 'w' ? T('Schachmatt. Schwarz gewinnt', 'Checkmate – Black wins') : T('Schachmatt. Weiß gewinnt', 'Checkmate – White wins');
      else if (c.isStalemate()) resultText = T('Patt, Remis', 'Stalemate – draw');
      else if (c.isInsufficientMaterial()) resultText = T('Remis wegen zu wenig Material', 'Draw – insufficient material');
      else if (c.isThreefoldRepetition()) resultText = T('Remis durch dreifache Stellungswiederholung', 'Draw – threefold repetition');
      else if (c.isDraw()) resultText = T('Remis', 'Draw');
      else return false;
      over = true; setLock(true); statusEl.textContent = '★ ' + resultText; eng?.stop(); clear(evalWrap); sfx.click();
      const mateWinner = c.isCheckmate() ? (c.turn() === 'w' ? 'black' : 'white') : null;
      if (mateWinner === my) { const wins = (g.best.get('wins') || 0) + 1; g.best.set(wins, 'wins'); g.best.set(level + 1, 'level'); }
      return true;
    };
    const analyse = (fen) => {
      if (!eng || !showEval || over) return;
      try {
        eng.analyse(fen, { depth: 12 }, (info) => {
          if (myToken !== token || !info?.score) return;
          evalBar.firstChild.style.width = Math.round(engine.scoreToBar(info.score) * 100) + '%';
          evalText.textContent = engine.formatScore(info.score) + (info.depth ? `  d${info.depth}` : '');
        }).catch(() => {});
      } catch { /* ignore */ }
    };
    const engineMove = async (fen) => {
      if (!eng || over) { if (!eng) statusEl.textContent = T('Keine Engine geladen, spiele beide Seiten.', 'No engine – play both sides.'); return; }
      setLock(true); statusEl.textContent = T('Stockfish denkt …', 'Stockfish is thinking …');
      const lv = LEVELS[level]; const mt = ++moveToken;
      try {
        await applyLevel(eng, lv);                       // waits for the running search first
        if (myToken !== token || mt !== moveToken || over) return;
        const uci = await eng.bestMove(fen, lv.movetime ? { movetime: lv.movetime } : { depth: lv.depth });
        if (myToken !== token || mt !== moveToken || over) return;
        if (!uci) { statusEl.textContent = T('Stockfish findet keinen Zug.', 'Stockfish finds no move.'); setLock(false); return; }
        const c = new Chess(fen); const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
        await board.playSan(m.san);
      } catch (e) {
        console.warn('[chess-vs-engine]', e);
        statusEl.textContent = T('Engine-Fehler: ', 'Engine error: ') + (e?.message || e);
        setLock(false);
      }
    };
    // registered BEFORE awaiting the engine, so no move can slip past unnoticed
    unsubChange = board.onChange((fen, d) => {
      if (myToken !== token || suppress) return;
      if (d.type === 'move') sfx.move();
      paintMoves(d.moves || []);
      if (d.type !== 'move' && d.type !== 'undo' && d.type !== 'set') return;
      if (checkResult(fen)) return;
      over = false;
      if (d.turn === engineColor) engineMove(fen);
      else { setLock(false); statusEl.textContent = d.check ? T('Schach! Du bist am Zug.', 'Check! Your move.') : T('Du bist am Zug.', 'Your move.'); analyse(fen); }
    });

    // the game's keys from here on, before the engine is awaited: with the setup's keys still in force meanwhile, a
    // second Enter started a second game over this one, and the first board (its listeners on the document) and the
    // first claim on the engine were never given back
    g.setHints([['N', T('neu', 'new')], ['U', T('zurück', 'undo')], ['R', T('aufgeben', 'resign')], ['F', T('drehen', 'flip')], ['Esc', T('Spiele', 'games')]]);
    view = {
      onKey(e) {
        const k = e.key.toLowerCase();
        if (k === 'n') { showSetup(); return true; }
        if (k === 'u') { undo(); return true; }
        if (k === 'r') { resign(); return true; }
        if (k === 'f') { board?.flip(); return true; }
        return false;
      },
    };

    let got = null;
    try { got = await engine.acquireEngine(); }
    catch (e) { if (myToken === token) statusEl.textContent = T('Stockfish nicht verfügbar: ', 'Stockfish unavailable: ') + (e?.message || e); }
    // the player left or started anew while the engine came up: disposeGame() ran without this claim, give it back here
    if (myToken !== token) { if (got) { try { engine.releaseEngine(); } catch { /* ignore */ } } return; }
    eng = got; acquired = !!got;
    statusEl.textContent = my === 'white' ? T('Du bist am Zug.', 'Your move.') : T('Stockfish beginnt …', 'Stockfish opens …');
    if (my === 'black') engineMove(board.getFen());
    else { setLock(false); analyse(board.getFen()); }

    function undo() {
      if (!board || !board.getPly()) return;
      moveToken++; eng?.stop(); suppress = true;
      board.undo(); if (board.turn() === engineColor && board.getPly()) board.undo();
      suppress = false; over = false; resultText = ''; sfx.click();
      const fen = board.getFen(); paintMoves(board.history());
      if (board.turn() === engineColor) engineMove(fen);
      else { setLock(false); statusEl.textContent = T('Du bist am Zug.', 'Your move.'); analyse(fen); }
    }
    function resign() { if (over) return; over = true; resultText = T('Aufgegeben. Stockfish gewinnt', 'Resigned – Stockfish wins'); eng?.stop(); setLock(true); statusEl.textContent = '★ ' + resultText; sfx.error(); }
  }

  function disposeGame() {
    token++; moveToken++;
    unsubChange?.(); unsubChange = null;
    try { eng?.stop(); } catch { /* ignore */ }
    try { board?.destroy(); } catch { /* ignore */ }
    board = null;
    if (acquired) { acquired = false; eng = null; try { engine.releaseEngine(); } catch { /* ignore */ } }
  }

  if (g.params?.autostart) startGame(); else showSetup();
  return {
    unmount() { disposeGame(); },
    onKey(e) { return view?.onKey?.(e) === true; },
  };
}
