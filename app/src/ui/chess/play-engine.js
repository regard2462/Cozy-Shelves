// Gegen Stockfish spielen – am Schachtisch. Farbe und Spielstärke wählen, volle Regelprüfung,
// Bewertungsbalken, Tipp, Zug zurück, aufgeben.
import { Chess } from 'chess.js';
import { h, clear } from '../../core/dom.js';
import { tr } from '../../core/i18n.js';
import { createChessBoard } from './chess-board.js';
import { acquireEngine, releaseEngine, formatScore, scoreToBar } from './engine.js';
import { figurine } from './san.js';

/** Spielstärken. UCI_Elo begrenzt Stockfish wirklich, Skill Level allein reicht bei SF 18 nicht. */
export const STRENGTHS = [
  { elo: 1350, skill: 0, movetime: 200, label: { de: 'Anfänger (≈1350)', en: 'Beginner (≈1350)' } },
  { elo: 1600, skill: 3, movetime: 300, label: { de: 'Vereinsspieler (≈1600)', en: 'Club player (≈1600)' } },
  { elo: 1900, skill: 8, movetime: 500, label: { de: 'Fortgeschritten (≈1900)', en: 'Advanced (≈1900)' } },
  { elo: 2200, skill: 13, movetime: 900, label: { de: 'Stark (≈2200)', en: 'Strong (≈2200)' } },
  { elo: 2500, skill: 17, movetime: 1400, label: { de: 'Meister (≈2500)', en: 'Master (≈2500)' } },
  { elo: null, skill: 20, movetime: 2500, label: { de: 'Volle Stärke', en: 'Full strength' } },
];

export function createEnginePlay(container, ctx) {
  const sfx = (n) => { try { ctx.audio?.sfx?.(n); } catch { /* ignore */ } };
  const toast = (m) => ctx.toast?.(m);

  const boardHost = h('div.chess-play-board');
  const lock = h('div.chess-play-lock.on');
  const setupEl = h('div.chess-play-setup');
  const statusEl = h('div.chess-play-status');
  const evalBar = h('div.chess-evalbar', h('div.chess-evalbar-white'));
  const evalText = h('div.chess-eval-text', '—');
  const evalRow = h('div.row.chess-row', evalBar, evalText);
  const movesEl = h('div.chess-moves');
  const actions = h('div.row.chess-row');
  const side = h('div.chess-play-side', setupEl, statusEl, evalRow, movesEl, actions);
  const root = h('div.chess-play', h('div.chess-play-boardwrap', boardHost, lock), side);
  container.appendChild(root);

  let board = null, eng = null, acquired = false, unsub = null;
  let my = 'white', strength = 2, showEval = true;
  let token = 0, moveToken = 0, over = false, suppress = false, destroyed = false, engineReady = false;

  const btn = (label, onclick, cls = 'btn.small') =>
    h('button.' + cls, { type: 'button', onclick: () => { sfx('click'); onclick(); } }, typeof label === 'string' ? label : tr(label));

  // ---- setup row -----------------------------------------------------------
  const colourSeg = h('div.chess-seg');
  for (const [v, lab] of [['white', { de: 'Weiß', en: 'White' }], ['black', { de: 'Schwarz', en: 'Black' }], ['random', { de: 'Zufall', en: 'Random' }]]) {
    colourSeg.appendChild(h('button.chess-seg-btn', { type: 'button', dataset: { v }, onclick: () => { my = v; paintSetup(); } }, tr(lab)));
  }
  const strengthSel = h('select.input.chess-play-strength', STRENGTHS.map((s, i) => h('option', { value: i }, tr(s.label))));
  strengthSel.value = String(strength);
  // the new strength counts from the next engine move on, not only after "Neue Partie" (Elo and think time together)
  strengthSel.addEventListener('change', () => { strength = +strengthSel.value; applyStrength(); });
  const evalToggle = h('div.toggle.on', { onclick: () => { showEval = !showEval; evalToggle.classList.toggle('on', showEval); evalRow.classList.toggle('hidden', !showEval); if (showEval) analyse(); } });
  setupEl.append(
    h('div.row.chess-row', h('span.small.muted', tr({ de: 'Deine Farbe', en: 'Your colour' })), colourSeg),
    h('div.row.chess-row', h('span.small.muted', tr({ de: 'Spielstärke', en: 'Strength' })), strengthSel),
    h('div.row.chess-row', h('span.small.muted', tr({ de: 'Bewertung anzeigen', en: 'Show evaluation' })), evalToggle),
    h('div.row.chess-row', btn({ de: 'Neue Partie', en: 'New game' }, () => start(), 'btn.primary.small')));
  function paintSetup() { colourSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === my)); }
  paintSetup();

  actions.append(
    btn({ de: 'Zug zurück', en: 'Undo' }, () => undo()),
    btn({ de: 'Tipp', en: 'Hint' }, () => hint()),
    btn({ de: 'Aufgeben', en: 'Resign' }, () => resign()),
    btn({ de: 'Brett drehen', en: 'Flip board' }, () => board?.flip()));

  // ---- engine --------------------------------------------------------------
  async function ensureEngine() {
    if (eng || destroyed) return eng;
    statusEl.textContent = tr({ de: 'Stockfish wird geladen …', en: 'Loading Stockfish …' });
    try { eng = await acquireEngine(); acquired = true; engineReady = true; }
    catch (e) { eng = null; statusEl.textContent = tr({ de: 'Stockfish nicht verfügbar: ', en: 'Stockfish unavailable: ' }) + (e?.message || e); }
    return eng;
  }
  async function applyStrength() {
    const s = STRENGTHS[strength];
    if (!eng) return;
    const opts = { 'Skill Level': s.skill };
    if (s.elo) { opts.UCI_LimitStrength = 'true'; opts.UCI_Elo = s.elo; } else opts.UCI_LimitStrength = 'false';
    try { await eng.configure(opts); } catch (e) { console.warn('[chess] configure', e); }
  }

  let engineColour = 'black';
  async function start() {
    token++; moveToken++; over = false;
    const colour = my === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : my;
    engineColour = colour === 'white' ? 'black' : 'white';
    const myToken = token;
    unsub?.(); board?.destroy();
    clear(boardHost); clear(movesEl);
    board = createChessBoard(boardHost, { mode: '2d', orientation: colour, free: false });
    setLock(true);
    unsub = board.onChange(onChange);       // registered before the await – no move can slip past
    setBar(0.5); evalText.textContent = '—';
    statusEl.textContent = tr({ de: 'Engine startet …', en: 'Starting engine …' });
    await ensureEngine();
    if (destroyed || myToken !== token) return;
    await applyStrength();
    if (destroyed || myToken !== token) return;
    try { await eng?.newGame(); } catch { /* ignore */ }
    if (destroyed || myToken !== token) return;
    if (colour === 'black') { statusEl.textContent = tr({ de: 'Stockfish beginnt …', en: 'Stockfish opens …' }); engineMove(board.getFen()); }
    else { setLock(false); statusEl.textContent = tr({ de: 'Du bist am Zug.', en: 'Your move.' }); analyse(); }
  }

  function setLock(on) { lock.classList.toggle('on', !!on); }
  function setBar(share) { evalBar.firstChild.style.width = Math.round(share * 100) + '%'; }

  function renderMoves() {
    clear(movesEl);
    const hist = board?.history() || [];
    let no = 1;
    hist.forEach((m, i) => {
      if (m.color === 'w' || i === 0) movesEl.appendChild(h('span.chess-move-no', no + (m.color === 'w' ? '.' : '…')));
      movesEl.appendChild(h('span.chess-move', figurine(m.san, m.color)));
      if (m.color === 'b') no++;
    });
    movesEl.scrollTop = movesEl.scrollHeight;
  }

  function checkResult(fen) {
    const c = new Chess(fen);
    let text = null;
    if (c.isCheckmate()) text = c.turn() === 'w' ? tr({ de: 'Schachmatt. Schwarz gewinnt', en: 'Checkmate – Black wins' }) : tr({ de: 'Schachmatt. Weiß gewinnt', en: 'Checkmate – White wins' });
    else if (c.isStalemate()) text = tr({ de: 'Patt, Remis', en: 'Stalemate – draw' });
    else if (c.isInsufficientMaterial()) text = tr({ de: 'Remis wegen zu wenig Material', en: 'Draw – insufficient material' });
    else if (c.isThreefoldRepetition()) text = tr({ de: 'Remis durch Stellungswiederholung', en: 'Draw – threefold repetition' });
    else if (c.isDraw()) text = tr({ de: 'Remis', en: 'Draw' });
    if (!text) return false;
    over = true; setLock(true); eng?.stop();
    statusEl.textContent = '★ ' + text;
    sfx('click');
    return true;
  }
  function onChange(fen, d) {
    if (suppress || !board) return;
    if (d.type === 'move') sfx('chess-move');
    renderMoves();
    if (d.type !== 'move' && d.type !== 'undo' && d.type !== 'set') return;
    if (checkResult(fen)) return;
    over = false;
    if (d.turn === engineColour) engineMove(fen);
    else { setLock(false); statusEl.textContent = d.check ? tr({ de: 'Schach! Du bist am Zug.', en: 'Check! Your move.' }) : tr({ de: 'Du bist am Zug.', en: 'Your move.' }); analyse(); }
  }
  async function engineMove(fen) {
    if (!eng) { statusEl.textContent = tr({ de: 'Keine Engine geladen, du spielst beide Seiten.', en: 'No engine – you play both sides.' }); setLock(false); return; }
    if (over || destroyed) return;
    const myToken = token, mt = ++moveToken;
    setLock(true);
    statusEl.textContent = tr({ de: 'Stockfish denkt …', en: 'Stockfish is thinking …' });
    try {
      const s = STRENGTHS[strength];
      const uci = await eng.bestMove(fen, { movetime: s.movetime });
      if (destroyed || myToken !== token || mt !== moveToken || over) return;
      if (!uci) { statusEl.textContent = tr({ de: 'Stockfish findet keinen Zug.', en: 'Stockfish finds no move.' }); setLock(false); return; }
      const c = new Chess(fen);
      const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
      await board.playSan(m.san);
    } catch (e) {
      console.warn('[chess] engine move', e);
      statusEl.textContent = tr({ de: 'Engine-Fehler: ', en: 'Engine error: ' }) + (e?.message || e);
      setLock(false);
    }
  }
  let analyseSeq = 0;
  function analyse() {
    if (!eng || !showEval || over || destroyed) return;
    const seq = ++analyseSeq;
    const fen = board.getFen();
    eng.analyse(fen, { depth: 14 }, (info) => {
      if (seq !== analyseSeq || destroyed || !info?.score) return;
      setBar(scoreToBar(info.score));
      evalText.textContent = `${formatScore(info.score)} · ${tr({ de: 'Tiefe', en: 'depth' })} ${info.depth}`;
    }).catch(() => {});
  }
  function undo() {
    if (!board || !board.getPly()) { toast(tr({ de: 'Nichts zurückzunehmen', en: 'Nothing to undo' })); return; }
    moveToken++; eng?.stop();
    suppress = true;
    board.undo();
    if (board.turn() === engineColour && board.getPly()) board.undo();
    suppress = false;
    over = false;
    renderMoves();
    const fen = board.getFen();
    if (board.turn() === engineColour) engineMove(fen);
    else { setLock(false); statusEl.textContent = tr({ de: 'Du bist am Zug.', en: 'Your move.' }); analyse(); }
  }
  async function hint() {
    if (!eng || over || !board) return;
    if (board.turn() === engineColour) return;
    statusEl.textContent = tr({ de: 'Suche einen guten Zug für dich …', en: 'Looking for a good move for you …' });
    try {
      const uci = await eng.bestMove(board.getFen(), { movetime: 600 });
      if (destroyed || !uci) return;
      board.setShapes([{ orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush: 'green' }]);
      statusEl.textContent = tr({ de: 'Tipp: {a} nach {b}', en: 'Hint: {a} – {b}' }, { a: uci.slice(0, 2), b: uci.slice(2, 4) });
    } catch { /* ignore */ }
  }
  function resign() {
    if (over || !board) return;
    over = true; setLock(true); eng?.stop();
    statusEl.textContent = '★ ' + tr({ de: 'Aufgegeben. Stockfish gewinnt.', en: 'Resigned – Stockfish wins.' });
    sfx('error');
  }

  statusEl.textContent = tr({ de: 'Wähle Farbe und Stärke und starte eine Partie.', en: 'Pick a colour and a strength, then start a game.' });
  setLock(true);
  // sitting down at the table should put a board in front of you straight away
  start();

  return {
    el: root,
    start,
    destroy() {
      destroyed = true; token++; moveToken++;
      try { eng?.stop(); } catch { /* ignore */ }
      unsub?.(); unsub = null;
      board?.destroy(); board = null;
      if (acquired) { acquired = false; eng = null; try { releaseEngine(); } catch { /* ignore */ } }
      root.remove();
    },
    onKey(e) {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return false;
      const l = e.key.toLowerCase();
      if (l === 'u') { undo(); return true; }
      if (l === 'h') { hint(); return true; }
      if (l === 'f') { board?.flip(); return true; }
      if (l === 'n') { start(); return true; }
      return false;
    },
    get ready() { return engineReady; },
  };
}
