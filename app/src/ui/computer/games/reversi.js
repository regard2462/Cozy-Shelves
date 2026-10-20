// Reversi (Othello) – 8×8, legal-move highlighting, pass handling and an alpha-beta opponent.
import { h, clear } from '../../../core/dom.js';
import { btn, segmented, T } from '../terminal.js';

const N = 8, EMPTY = 0, BLACK = 1, WHITE = 2;
const DIRS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const other = (c) => (c === BLACK ? WHITE : BLACK);

export function startBoard() {
  const b = new Int8Array(N * N);
  b[3 * N + 3] = WHITE; b[4 * N + 4] = WHITE; b[3 * N + 4] = BLACK; b[4 * N + 3] = BLACK;
  return b;
}
/** All discs that would be flipped by playing `col` at (x,y). Empty array = illegal move. */
export function flips(b, x, y, col) {
  if (b[y * N + x] !== EMPTY) return [];
  const out = [];
  for (const [dx, dy] of DIRS) {
    const line = [];
    let cx = x + dx, cy = y + dy;
    while (cx >= 0 && cy >= 0 && cx < N && cy < N && b[cy * N + cx] === other(col)) { line.push(cy * N + cx); cx += dx; cy += dy; }
    if (line.length && cx >= 0 && cy >= 0 && cx < N && cy < N && b[cy * N + cx] === col) out.push(...line);
  }
  return out;
}
export function legalMoves(b, col) {
  const out = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const f = flips(b, x, y, col); if (f.length) out.push({ i: y * N + x, flips: f }); }
  return out;
}
export function applyMove(b, i, col, f) {
  const nb = Int8Array.from(b); nb[i] = col; for (const k of f) nb[k] = col; return nb;
}
export function counts(b) {
  let black = 0, white = 0;
  for (const v of b) { if (v === BLACK) black++; else if (v === WHITE) white++; }
  return { black, white };
}

const WEIGHTS = [
  120, -20, 20, 5, 5, 20, -20, 120,
  -20, -40, -5, -5, -5, -5, -40, -20,
  20, -5, 15, 3, 3, 15, -5, 20,
  5, -5, 3, 3, 3, 3, -5, 5,
  5, -5, 3, 3, 3, 3, -5, 5,
  20, -5, 15, 3, 3, 15, -5, 20,
  -20, -40, -5, -5, -5, -5, -40, -20,
  120, -20, 20, 5, 5, 20, -20, 120,
];
function evaluate(b, me) {
  const opp = other(me);
  let pos = 0, mine = 0, his = 0;
  for (let i = 0; i < N * N; i++) { if (b[i] === me) { pos += WEIGHTS[i]; mine++; } else if (b[i] === opp) { pos -= WEIGHTS[i]; his++; } }
  const empties = N * N - mine - his;
  const mob = legalMoves(b, me).length - legalMoves(b, opp).length;
  if (empties <= 10) return (mine - his) * 20 + pos * 0.5 + mob * 4;    // endgame: discs count
  return pos + mob * 12;
}
/** Alpha-beta search. depth 4 is instant on 8×8 and plays a decent, beatable game. */
export function reversiBotMove(b, col, depth = 4) {
  const moves = legalMoves(b, col);
  if (!moves.length) return null;
  let best = moves[0], bestV = -Infinity;
  for (const m of moves) {
    const v = -negamax(applyMove(b, m.i, col, m.flips), other(col), depth - 1, -Infinity, Infinity, col);
    if (v > bestV) { bestV = v; best = m; }
  }
  return best;
}
function negamax(b, col, depth, alpha, beta, me) {
  if (depth <= 0) return (col === me ? 1 : -1) * evaluate(b, me);
  const moves = legalMoves(b, col);
  if (!moves.length) {
    if (!legalMoves(b, other(col)).length) return (col === me ? 1 : -1) * evaluate(b, me);
    return -negamax(b, other(col), depth - 1, -beta, -alpha, me);
  }
  let v = -Infinity;
  for (const m of moves) {
    v = Math.max(v, -negamax(applyMove(b, m.i, col, m.flips), other(col), depth - 1, -beta, -alpha, me));
    alpha = Math.max(alpha, v);
    if (alpha >= beta) break;
  }
  return v;
}

// ---------------------------------------------------------------------------------------------
export async function mount(root, g) {
  let board = startBoard(), turn = BLACK, myColor = BLACK, botOn = true, depth = 4;
  let cur = 2 * N + 3, over = false, thinking = false, dead = false, botTimer = 0;
  const hist = [];

  const canvas = h('canvas.term-bg-canvas');
  const statusEl = h('div.term-chess-status');
  const scoreEl = h('div.term-go-cap');
  const msg = h('div.term-game-msg');
  const colorSeg = segmented([[BLACK, T('Schwarz', 'Black')], [WHITE, T('Weiß', 'White')]], myColor, (v) => { myColor = +v; newGame(); });
  const botSeg = segmented([[1, T('gegen Computer', 'vs computer')], [0, T('zu zweit', 'two players')]], 1, (v) => { botOn = !!+v; newGame(); });
  const lvlSeg = segmented([[2, T('leicht', 'easy')], [4, T('mittel', 'medium')], [6, T('stark', 'strong')]], 4, (v) => { depth = +v; });

  const side = h('div.term-boardgame-side',
    h('div.term-line', h('span.term-k', T('Deine Farbe', 'Your colour')), colorSeg.el),
    h('div.term-line', h('span.term-k', T('Modus', 'Mode')), botSeg.el),
    h('div.term-line', h('span.term-k', T('Stärke', 'Strength')), lvlSeg.el),
    scoreEl, statusEl,
    h('div.term-actions', btn(T('Zurück (U)', 'Undo (U)'), () => undo()), btn(T('Neu (N)', 'New (N)'), () => newGame())),
    h('div.term-line.term-dim', T('Pfeiltasten bewegen · ⏎ setzen · Maus: klicken. Mögliche Züge sind markiert.',
      'arrows move · ⏎ place · mouse: click. Legal moves are marked.')));
  root.appendChild(h('div.term-boardgame', h('div', canvas), side));
  root.appendChild(msg);

  const CELL = 58, PAD = 10;
  function layout() {
    const px = CELL * N + PAD * 2;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(px * dpr); canvas.height = Math.round(px * dpr);
    canvas.style.width = px + 'px'; canvas.style.height = px + 'px';
    canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  function draw() {
    const cx = canvas.getContext('2d');
    const px = CELL * N + PAD * 2;
    cx.clearRect(0, 0, px, px);
    cx.fillStyle = '#6f7f5c'; cx.fillRect(0, 0, px, px);
    cx.fillStyle = '#7d8e68'; cx.fillRect(PAD, PAD, CELL * N, CELL * N);
    cx.strokeStyle = 'rgba(30,36,20,.45)'; cx.lineWidth = 1;
    cx.beginPath();
    for (let i = 0; i <= N; i++) {
      cx.moveTo(PAD + i * CELL + 0.5, PAD); cx.lineTo(PAD + i * CELL + 0.5, PAD + N * CELL);
      cx.moveTo(PAD, PAD + i * CELL + 0.5); cx.lineTo(PAD + N * CELL, PAD + i * CELL + 0.5);
    }
    cx.stroke();
    const moves = over ? [] : legalMoves(board, turn);
    const canPlay = !botOn || turn === myColor;
    for (const m of moves) {
      if (!canPlay) break;
      const x = PAD + (m.i % N) * CELL + CELL / 2, y = PAD + ((m.i / N) | 0) * CELL + CELL / 2;
      cx.fillStyle = 'rgba(255,248,230,.32)';
      cx.beginPath(); cx.arc(x, y, CELL * 0.14, 0, Math.PI * 2); cx.fill();
    }
    for (let i = 0; i < N * N; i++) {
      const v = board[i]; if (!v) continue;
      const x = PAD + (i % N) * CELL + CELL / 2, y = PAD + ((i / N) | 0) * CELL + CELL / 2, r = CELL * 0.41;
      const grad = cx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
      if (v === BLACK) { grad.addColorStop(0, '#54493f'); grad.addColorStop(1, '#141210'); }
      else { grad.addColorStop(0, '#fffdf6'); grad.addColorStop(1, '#ded0b3'); }
      cx.fillStyle = grad; cx.beginPath(); cx.arc(x, y, r, 0, Math.PI * 2); cx.fill();
    }
    const cxp = PAD + (cur % N) * CELL, cyp = PAD + ((cur / N) | 0) * CELL;
    cx.strokeStyle = '#e8c88a'; cx.lineWidth = 3; cx.strokeRect(cxp + 2, cyp + 2, CELL - 4, CELL - 4);
  }
  function paintInfo() {
    const c = counts(board);
    clear(scoreEl);
    scoreEl.append(h('span', h('i.term-go-dot.b'), String(c.black)), h('span', h('i.term-go-dot.w'), String(c.white)));
    if (over) return;
    statusEl.textContent = thinking ? T('Der Computer überlegt …', 'The computer is thinking …')
      : (turn === BLACK ? T('Schwarz am Zug', 'Black to move') : T('Weiß am Zug', 'White to move'));
  }
  function finish() {
    over = true;
    const c = counts(board);
    msg.textContent = c.black === c.white ? T('Unentschieden, {b} : {w}', 'Draw – {b} : {w}', { b: c.black, w: c.white })
      : c.black > c.white ? T('Schwarz gewinnt {b} : {w}', 'Black wins {b} : {w}', { b: c.black, w: c.white })
        : T('Weiß gewinnt {w} : {b}', 'White wins {w} : {b}', { b: c.black, w: c.white });
    statusEl.textContent = T('Partie beendet', 'Game finished');
    const winner = c.black === c.white ? 0 : (c.black > c.white ? BLACK : WHITE);
    if (botOn && winner === myColor) g.best.set((g.best.get('wins') || 0) + 1, 'wins');
    g.sfx.open();
  }
  function afterMove() {
    draw();
    // skip players without a legal move; end when neither can move
    let guard = 0;
    while (guard++ < 2) {
      if (legalMoves(board, turn).length) break;
      if (!legalMoves(board, other(turn)).length) { paintInfo(); finish(); return; }
      msg.textContent = (turn === BLACK ? T('Schwarz', 'Black') : T('Weiß', 'White')) + ' ' + T('muss passen.', 'has to pass.');
      turn = other(turn);
    }
    paintInfo();
    if (botOn && turn !== myColor) scheduleBot();
  }
  function place(i) {
    if (over || (botOn && turn !== myColor)) { g.sfx.error(); return; }
    const f = flips(board, i % N, (i / N) | 0, turn);
    if (!f.length) { g.sfx.error(); msg.textContent = T('Dort ist kein Zug möglich.', 'No legal move there.'); return; }
    hist.push({ board: Int8Array.from(board), turn });
    board = applyMove(board, i, turn, f); turn = other(turn); msg.textContent = '';
    g.sfx.move(); afterMove();
  }
  function scheduleBot() {
    if (dead || over) return;
    thinking = true; paintInfo();
    clearTimeout(botTimer);
    botTimer = setTimeout(() => {
      botTimer = 0;
      if (dead || over) { thinking = false; return; }
      const m = reversiBotMove(board, turn, depth);
      thinking = false;
      if (!m) { afterMove(); return; }
      hist.push({ board: Int8Array.from(board), turn });
      board = applyMove(board, m.i, turn, m.flips); turn = other(turn);
      g.sfx.move(); afterMove();
    }, 160);
  }
  function undo() {
    clearTimeout(botTimer); thinking = false;
    let s = hist.pop(); if (!s) { g.sfx.error(); return; }
    if (botOn && s.turn !== myColor) { const s2 = hist.pop(); if (s2) s = s2; }
    board = s.board; turn = s.turn; over = false; msg.textContent = '';
    g.sfx.click(); draw(); paintInfo();
  }
  function newGame() {
    clearTimeout(botTimer); thinking = false;
    board = startBoard(); turn = BLACK; over = false; hist.length = 0; msg.textContent = '';
    colorSeg.set(myColor); botSeg.set(botOn ? 1 : 0);
    draw(); paintInfo();
    if (botOn && turn !== myColor) scheduleBot();
  }

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left - PAD) / CELL), y = Math.floor((e.clientY - rect.top - PAD) / CELL);
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    cur = y * N + x; draw(); place(cur);
  });

  layout(); newGame();
  g.setHints([['←↑→↓', T('Cursor', 'cursor')], ['⏎', T('setzen', 'place')], ['U', T('zurück', 'undo')], ['N', T('neu', 'new')], ['Esc', T('Spiele', 'games')]]);
  return {
    unmount() { dead = true; clearTimeout(botTimer); },
    onKey(e) {
      const move = (dx, dy) => { const x = Math.max(0, Math.min(N - 1, (cur % N) + dx)), y = Math.max(0, Math.min(N - 1, ((cur / N) | 0) + dy)); cur = y * N + x; draw(); };
      if (e.key === 'ArrowLeft') { move(-1, 0); e.preventDefault(); return true; }
      if (e.key === 'ArrowRight') { move(1, 0); e.preventDefault(); return true; }
      if (e.key === 'ArrowUp') { move(0, -1); e.preventDefault(); return true; }
      if (e.key === 'ArrowDown') { move(0, 1); e.preventDefault(); return true; }
      if (e.key === 'Enter' || e.key === ' ') { place(cur); e.preventDefault(); return true; }
      const l = e.key.toLowerCase();
      if (l === 'u') { undo(); return true; }
      if (l === 'n') { newGame(); g.sfx.click(); return true; }
      return false;
    },
  };
}
