// Go (Baduk / Weiqi) – 9×9, 13×13 and 19×19 with captures, ko, pass, area scoring
// and a heuristic computer opponent. The rules engine below is pure and is exported for tests.
import { h, clear } from '../../../core/dom.js';
import { btn, segmented, T } from '../terminal.js';

export const EMPTY = 0, BLACK = 1, WHITE = 2;
const other = (c) => (c === BLACK ? WHITE : BLACK);

/**
 * Pure Go rules engine.
 *   const g = createGoGame(9);
 *   g.play(idx)            → { ok, captured } | { ok: false, reason }
 *   g.pass(); g.undo(); g.score() → { black, white, winner, diff }
 * Rules: no suicide, positional ko (the position after the move must differ from the previous one),
 * Chinese area scoring, two passes end the game.
 */
export function createGoGame(size = 9, komi = 6.5) {
  const N = size, L = N * N;
  let board = new Int8Array(L);
  let turn = BLACK;
  let captures = { [BLACK]: 0, [WHITE]: 0 };
  let passes = 0, finished = false, lastMove = -1, koPoint = -1;
  let prevHash = '';
  const stack = [];   // history snapshots for undo

  const xy = (i) => [i % N, (i / N) | 0];
  const at = (x, y) => (x < 0 || y < 0 || x >= N || y >= N ? -1 : y * N + x);
  function neighbours(i) {
    const x = i % N, y = (i / N) | 0; const out = [];
    if (x > 0) out.push(i - 1);
    if (x < N - 1) out.push(i + 1);
    if (y > 0) out.push(i - N);
    if (y < N - 1) out.push(i + N);
    return out;
  }
  /** Flood fill of the group at i on `b`; returns { stones:[], liberties:Set }. */
  function group(b, i) {
    const col = b[i]; const stones = []; const libs = new Set();
    if (!col) return { stones, liberties: libs };
    const seen = new Uint8Array(L); const q = [i]; seen[i] = 1;
    while (q.length) {
      const c = q.pop(); stones.push(c);
      for (const n of neighbours(c)) {
        if (b[n] === EMPTY) libs.add(n);
        else if (b[n] === col && !seen[n]) { seen[n] = 1; q.push(n); }
      }
    }
    return { stones, liberties: libs };
  }
  const hash = (b, t) => b.join('') + '|' + t;

  /** Would playing `col` at `i` be legal? Returns the resulting board or null. */
  function tryPlay(b, i, col, ko) {
    if (i < 0 || i >= L || b[i] !== EMPTY) return null;
    if (i === ko) return null;
    const nb = Int8Array.from(b);
    nb[i] = col;
    let captured = 0;
    const dead = [];
    for (const n of neighbours(i)) {
      if (nb[n] === other(col)) {
        const gr = group(nb, n);
        if (gr.liberties.size === 0) { for (const s of gr.stones) dead.push(s); }
      }
    }
    for (const s of dead) { if (nb[s]) { nb[s] = EMPTY; captured++; } }
    if (!captured) {
      const own = group(nb, i);
      if (own.liberties.size === 0) return null;   // suicide
    }
    return { board: nb, captured };
  }

  const api = {
    size: N, komi,
    get board() { return board; },
    get turn() { return turn; },
    get finished() { return finished; },
    get lastMove() { return lastMove; },
    get koPoint() { return koPoint; },
    get captures() { return { ...captures }; },
    get moveCount() { return stack.length; },
    at, xy, neighbours,
    group: (i) => group(board, i),
    /** true when `col` may play at `i` right now */
    legal(i, col = turn) {
      if (finished) return false;
      const r = tryPlay(board, i, col, koPoint);
      if (!r) return false;
      return hash(r.board, other(col)) !== prevHash;    // positional ko
    },
    legalMoves(col = turn) {
      const out = [];
      for (let i = 0; i < L; i++) if (board[i] === EMPTY && api.legal(i, col)) out.push(i);
      return out;
    },
    /** A point is a simple eye of `col` when it is empty, all orthogonal neighbours are `col`
     *  and at most one diagonal (none on the edge) belongs to the opponent. */
    isEye(i, col) {
      if (board[i] !== EMPTY) return false;
      for (const n of neighbours(i)) if (board[n] !== col) return false;
      const x = i % N, y = (i / N) | 0;
      let enemy = 0, offBoard = 0;
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const d = at(x + dx, y + dy);
        if (d < 0) offBoard++;
        else if (board[d] === other(col)) enemy++;
      }
      return offBoard ? enemy === 0 : enemy <= 1;
    },
    play(i, col = turn) {
      if (finished) return { ok: false, reason: 'finished' };
      if (col !== turn) return { ok: false, reason: 'turn' };
      if (i === koPoint && board[i] === EMPTY) return { ok: false, reason: 'ko' };
      const r = tryPlay(board, i, col, koPoint);
      if (!r) return { ok: false, reason: board[i] ? 'occupied' : 'illegal' };
      if (hash(r.board, other(col)) === prevHash) return { ok: false, reason: 'ko' };
      stack.push({ board: Int8Array.from(board), turn, captures: { ...captures }, passes, lastMove, koPoint, prevHash, finished });
      prevHash = hash(board, turn);
      board = r.board;
      captures[col] += r.captured;
      // simple ko point: exactly one stone captured and the new stone stands alone in atari
      koPoint = -1;
      if (r.captured === 1) {
        const own = group(board, i);
        if (own.stones.length === 1 && own.liberties.size === 1) koPoint = [...own.liberties][0];
      }
      passes = 0; lastMove = i; turn = other(col);
      return { ok: true, captured: r.captured };
    },
    pass(col = turn) {
      if (finished || col !== turn) return { ok: false };
      stack.push({ board: Int8Array.from(board), turn, captures: { ...captures }, passes, lastMove, koPoint, prevHash, finished });
      prevHash = hash(board, turn);
      passes++; lastMove = -1; koPoint = -1; turn = other(col);
      if (passes >= 2) finished = true;
      return { ok: true, finished };
    },
    resign(col) { finished = true; api.resigned = col; return { ok: true }; },
    undo() {
      const s = stack.pop(); if (!s) return false;
      board = s.board; turn = s.turn; captures = s.captures; passes = s.passes;
      lastMove = s.lastMove; koPoint = s.koPoint; prevHash = s.prevHash; finished = s.finished;
      api.resigned = null;
      return true;
    },
    /** Chinese area scoring: stones on the board + surrounded empty points. */
    score() {
      const seen = new Uint8Array(L);
      let bArea = 0, wArea = 0;
      for (let i = 0; i < L; i++) {
        if (board[i] === BLACK) { bArea++; continue; }
        if (board[i] === WHITE) { wArea++; continue; }
        if (seen[i]) continue;
        const q = [i]; seen[i] = 1; const region = []; const touch = new Set();
        while (q.length) {
          const c = q.pop(); region.push(c);
          for (const n of neighbours(c)) {
            if (board[n] === EMPTY) { if (!seen[n]) { seen[n] = 1; q.push(n); } }
            else touch.add(board[n]);
          }
        }
        if (touch.size === 1) { if (touch.has(BLACK)) bArea += region.length; else wArea += region.length; }
      }
      const black = bArea, white = wArea + komi;
      return { black, white, winner: black > white ? BLACK : WHITE, diff: Math.abs(black - white) };
    },
    /** Serialise for tests/debugging */
    toString() { let s = ''; for (let y = 0; y < N; y++) { for (let x = 0; x < N; x++) s += '.XO'[board[y * N + x]]; s += '\n'; } return s; },
  };
  return api;
}

/**
 * Heuristic opponent: legal, sensible and beatable. It scores every legal non-eye move by
 * captures, atari threats, own safety, liberties and proximity to the last move, then plays the
 * best one with a little randomness. It passes when nothing is worth playing.
 */
export function goBotMove(game, col, strength = 1) {
  const moves = game.legalMoves(col);
  if (!moves.length) return -1;
  const opp = col === BLACK ? WHITE : BLACK;
  const N = game.size;
  const centre = (N - 1) / 2;
  const last = game.lastMove;
  const b = game.board;
  let best = -1, bestScore = -Infinity;
  for (const i of moves) {
    if (game.isEye(i, col)) continue;                       // never fill our own eye
    let sc = 0;
    // 1. captures + atari
    let captures = 0, atariEnemy = 0, savesOwn = 0;
    for (const n of game.neighbours(i)) {
      if (b[n] === opp) {
        const gr = game.group(n);
        if (gr.liberties.size === 1) captures += gr.stones.length;
        else if (gr.liberties.size === 2) atariEnemy += gr.stones.length;
      } else if (b[n] === col) {
        const gr = game.group(n);
        if (gr.liberties.size === 1) savesOwn += gr.stones.length;
      }
    }
    sc += captures * 14 + atariEnemy * 3 + savesOwn * 9;
    // 2. safety of the resulting own group
    const after = Int8Array.from(b); after[i] = col;
    const libs = countLiberties(after, i, game);
    if (libs === 1 && !captures) sc -= 18;               // never play into self-atari for nothing
    sc += Math.min(libs, 5) * 1.6;
    // 3. shape / position
    const x = i % N, y = (i / N) | 0;
    const edge = Math.min(x, y, N - 1 - x, N - 1 - y);
    sc += edge === 0 ? -3 : edge === 1 ? 0.5 : edge === 2 ? 2.5 : 1.5;
    sc -= (Math.abs(x - centre) + Math.abs(y - centre)) * 0.08;
    // 4. stay local
    if (last >= 0) {
      const lx = last % N, ly = (last / N) | 0;
      const d = Math.max(Math.abs(x - lx), Math.abs(y - ly));
      if (d === 1) sc += 4; else if (d === 2) sc += 2.2; else if (d <= 4) sc += 0.6;
    }
    // 5. contact with own stones (connection) and with enemy stones (attack)
    let ownAdj = 0, oppAdj = 0;
    for (const n of game.neighbours(i)) { if (b[n] === col) ownAdj++; else if (b[n] === opp) oppAdj++; }
    sc += ownAdj * 0.9 + oppAdj * 1.4;
    sc += Math.random() * (4 / strength);
    if (sc > bestScore) { bestScore = sc; best = i; }
  }
  // nothing sensible left → pass
  if (best < 0 || bestScore < -6) return -1;
  return best;
}
function countLiberties(board, i, game) {
  const col = board[i]; const seen = new Set([i]); const libs = new Set(); const q = [i];
  while (q.length) {
    const c = q.pop();
    for (const n of game.neighbours(c)) {
      if (board[n] === EMPTY) libs.add(n);
      else if (board[n] === col && !seen.has(n)) { seen.add(n); q.push(n); }
    }
  }
  return libs.size;
}

// ---------------------------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------------------------
const SIZES = [9, 13, 19];

export async function mount(root, g) {
  let size = SIZES.includes(+g.params?.size) ? +g.params.size : 9;
  let myColor = BLACK, botOn = true, strength = 1.2;
  let game = createGoGame(size);
  let cur = Math.floor((size * size) / 2);
  let botTimer = 0, dead = false, thinking = false;

  const canvas = h('canvas.term-go-canvas');
  const boardEl = h('div.term-go-board', canvas);
  const statusEl = h('div.term-chess-status');
  const capEl = h('div.term-go-cap');
  const scoreEl = h('div.term-line.term-dim');
  const msg = h('div.term-game-msg');
  const sizeSeg = segmented(SIZES.map((s) => [s, `${s}×${s}`]), size, (v) => { size = +v; newGame(); });
  const colorSeg = segmented([[BLACK, T('Schwarz', 'Black')], [WHITE, T('Weiß', 'White')]], myColor, (v) => { myColor = +v; newGame(); });
  const botSeg = segmented([[1, T('gegen Computer', 'vs computer')], [0, T('zu zweit', 'two players')]], 1, (v) => { botOn = !!+v; newGame(); });

  const side = h('div.term-go-side',
    h('div.term-line', h('span.term-k', T('Brett', 'Board')), sizeSeg.el),
    h('div.term-line', h('span.term-k', T('Deine Farbe', 'Your colour')), colorSeg.el),
    h('div.term-line', h('span.term-k', T('Modus', 'Mode')), botSeg.el),
    capEl, statusEl, scoreEl,
    h('div.term-actions',
      btn(T('Passen (P)', 'Pass (P)'), () => doPass()),
      btn(T('Zurück (U)', 'Undo (U)'), () => undo()),
      btn(T('Neu (N)', 'New (N)'), () => newGame()),
      btn(T('Auszählen', 'Count'), () => showScore(true))),
    h('div.term-line.term-dim', T('Pfeiltasten bewegen · ⏎ setzen · P passen · U zurück · N neu · Maus: klicken',
      'arrows move · ⏎ place · P pass · U undo · N new · mouse: click')));
  root.appendChild(h('div.term-go-wrap', boardEl, side));
  root.appendChild(msg);

  // ---- rendering ----
  function cellSize() {
    const avail = Math.min(520, Math.max(280, Math.floor((window.innerHeight || 900) - 380)));
    return Math.max(14, Math.floor(avail / (size + 1)));
  }
  let CELL = cellSize(), PAD = CELL;
  function layout() {
    CELL = cellSize(); PAD = CELL;
    const px = CELL * (size - 1) + PAD * 2;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(px * dpr); canvas.height = Math.round(px * dpr);
    canvas.style.width = px + 'px'; canvas.style.height = px + 'px';
    const cx = canvas.getContext('2d'); cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  const HOSHI = {
    9: [[2, 2], [6, 2], [2, 6], [6, 6], [4, 4]],
    13: [[3, 3], [9, 3], [3, 9], [9, 9], [6, 6]],
    19: [[3, 3], [9, 3], [15, 3], [3, 9], [9, 9], [15, 9], [3, 15], [9, 15], [15, 15]],
  };
  const hoshi = (n) => HOSHI[n] || [];
  function draw() {
    const cx = canvas.getContext('2d');
    const px = CELL * (size - 1) + PAD * 2;
    cx.clearRect(0, 0, px, px);
    // grid
    cx.strokeStyle = 'rgba(60,40,18,.75)'; cx.lineWidth = 1;
    cx.beginPath();
    for (let i = 0; i < size; i++) {
      cx.moveTo(PAD, PAD + i * CELL + 0.5); cx.lineTo(PAD + (size - 1) * CELL, PAD + i * CELL + 0.5);
      cx.moveTo(PAD + i * CELL + 0.5, PAD); cx.lineTo(PAD + i * CELL + 0.5, PAD + (size - 1) * CELL);
    }
    cx.stroke();
    // star points
    cx.fillStyle = 'rgba(50,32,12,.85)';
    for (const [a, b] of hoshi(size)) { cx.beginPath(); cx.arc(PAD + a * CELL, PAD + b * CELL, Math.max(2, CELL * 0.09), 0, Math.PI * 2); cx.fill(); }
    // stones
    const r = CELL * 0.46;
    for (let i = 0; i < size * size; i++) {
      const v = game.board[i]; if (!v) continue;
      const x = PAD + (i % size) * CELL, y = PAD + ((i / size) | 0) * CELL;
      const grad = cx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
      if (v === BLACK) { grad.addColorStop(0, '#5a5148'); grad.addColorStop(1, '#161210'); }
      else { grad.addColorStop(0, '#fffdf6'); grad.addColorStop(1, '#ddd0b4'); }
      cx.fillStyle = grad;
      cx.beginPath(); cx.arc(x, y, r, 0, Math.PI * 2); cx.fill();
      cx.strokeStyle = v === BLACK ? 'rgba(0,0,0,.6)' : 'rgba(90,70,40,.45)'; cx.lineWidth = 1; cx.stroke();
    }
    // last move
    if (game.lastMove >= 0) {
      const x = PAD + (game.lastMove % size) * CELL, y = PAD + ((game.lastMove / size) | 0) * CELL;
      cx.strokeStyle = game.board[game.lastMove] === BLACK ? '#e8d6ad' : '#7a4a1e'; cx.lineWidth = 2;
      cx.beginPath(); cx.arc(x, y, r * 0.42, 0, Math.PI * 2); cx.stroke();
    }
    // ko marker
    if (game.koPoint >= 0) {
      const x = PAD + (game.koPoint % size) * CELL, y = PAD + ((game.koPoint / size) | 0) * CELL;
      cx.strokeStyle = 'rgba(168,71,47,.85)'; cx.lineWidth = 2;
      cx.strokeRect(x - r * 0.45, y - r * 0.45, r * 0.9, r * 0.9);
    }
    // cursor
    const cxp = PAD + (cur % size) * CELL, cyp = PAD + ((cur / size) | 0) * CELL;
    cx.strokeStyle = 'rgba(169,112,44,.95)'; cx.lineWidth = 2;
    cx.beginPath();
    cx.moveTo(cxp - CELL * 0.45, cyp); cx.lineTo(cxp + CELL * 0.45, cyp);
    cx.moveTo(cxp, cyp - CELL * 0.45); cx.lineTo(cxp, cyp + CELL * 0.45);
    cx.stroke();
  }

  function paintInfo() {
    const c = game.captures;
    clear(capEl);
    capEl.append(
      h('span', h('i.term-go-dot.b'), `${c[BLACK]} ${T('gefangen', 'captured')}`),
      h('span', h('i.term-go-dot.w'), `${c[WHITE]} ${T('gefangen', 'captured')}`));
    if (game.finished) return;
    const t = game.turn === BLACK ? T('Schwarz', 'Black') : T('Weiß', 'White');
    statusEl.textContent = thinking ? T('Der Computer überlegt …', 'The computer is thinking …') : T('{c} am Zug', '{c} to move', { c: t });
  }
  function showScore(explicit) {
    const s = game.score();
    scoreEl.textContent = T('Gebietsstand: Schwarz {b} · Weiß {w} (Komi {k})', 'Area score: Black {b} · White {w} (komi {k})',
      { b: s.black, w: s.white.toFixed(1), k: game.komi });
    if (explicit) g.sfx.click();
    return s;
  }
  function endGame() {
    const s = showScore(false);
    const win = s.winner === BLACK ? T('Schwarz', 'Black') : T('Weiß', 'White');
    msg.textContent = T('Spielende. {w} gewinnt mit {d} Punkten.', 'Game over – {w} wins by {d} points.', { w: win, d: s.diff.toFixed(1) });
    statusEl.textContent = T('Partie beendet', 'Game finished');
    if (botOn && s.winner === myColor) { const k = String(size); g.best.set((g.best.get(k) || 0) + 1, k); }
    g.sfx.open();
  }

  function newGame() {
    clearTimeout(botTimer);
    game = createGoGame(size);
    cur = Math.floor((size * size) / 2);
    msg.textContent = ''; scoreEl.textContent = '';
    sizeSeg.set(size); colorSeg.set(myColor); botSeg.set(botOn ? 1 : 0);
    thinking = false;
    layout(); paintInfo();
    if (botOn && myColor === WHITE) scheduleBot();
  }
  function place(i) {
    if (game.finished) { g.sfx.error(); return; }
    if (botOn && game.turn !== myColor) { g.sfx.error(); return; }
    const r = game.play(i);
    if (!r.ok) {
      g.sfx.error();
      msg.textContent = r.reason === 'ko' ? T('Ko. Dieser Zug würde die Stellung wiederholen.', 'Ko – that move would repeat the position.')
        : r.reason === 'occupied' ? T('Dort liegt schon ein Stein.', 'There is already a stone there.')
          : T('Selbstmord ist nicht erlaubt.', 'Suicide is not allowed.');
      return;
    }
    msg.textContent = r.captured ? T('{n} Steine gefangen.', '{n} stones captured.', { n: r.captured }) : '';
    g.sfx.move(); draw(); paintInfo();
    if (botOn) scheduleBot();
  }
  function doPass() {
    if (game.finished) return;
    if (botOn && game.turn !== myColor) return;
    game.pass(); g.sfx.click(); draw(); paintInfo();
    msg.textContent = T('Du hast gepasst.', 'You passed.');
    if (game.finished) { endGame(); return; }
    if (botOn) scheduleBot();
  }
  function scheduleBot() {
    if (!botOn || game.finished || dead) return;
    const botColor = myColor === BLACK ? WHITE : BLACK;
    if (game.turn !== botColor) return;
    thinking = true; paintInfo();
    clearTimeout(botTimer);
    botTimer = setTimeout(() => {
      botTimer = 0;
      if (dead || game.finished) { thinking = false; return; }
      const mv = goBotMove(game, botColor, strength);
      if (mv < 0) { game.pass(botColor); msg.textContent = T('Der Computer passt.', 'The computer passes.'); }
      else { const r = game.play(mv, botColor); if (r.ok && r.captured) msg.textContent = T('Der Computer fängt {n} Steine.', 'The computer captures {n} stones.', { n: r.captured }); }
      thinking = false;
      draw(); paintInfo();
      if (game.finished) endGame();
    }, 220 + Math.random() * 260);
  }
  function undo() {
    clearTimeout(botTimer); thinking = false;
    if (!game.undo()) { g.sfx.error(); return; }
    if (botOn && game.turn !== myColor) game.undo();   // take back the bot's reply too
    msg.textContent = ''; g.sfx.click(); draw(); paintInfo();
  }

  // ---- mouse ----
  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left - PAD) / CELL);
    const y = Math.round((e.clientY - rect.top - PAD) / CELL);
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    cur = y * size + x; draw(); place(cur);
  });
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left - PAD) / CELL);
    const y = Math.round((e.clientY - rect.top - PAD) / CELL);
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = y * size + x;
    if (i !== cur) { cur = i; draw(); }
  });
  const onResize = () => layout();
  window.addEventListener('resize', onResize);

  newGame();
  g.setHints([['←↑→↓', T('Cursor', 'cursor')], ['⏎', T('setzen', 'place')], ['P', T('passen', 'pass')], ['U', T('zurück', 'undo')], ['N', T('neu', 'new')], ['Esc', T('Spiele', 'games')]]);

  return {
    unmount() { dead = true; clearTimeout(botTimer); window.removeEventListener('resize', onResize); },
    onKey(e) {
      const k = e.key;
      const move = (dx, dy) => { const x = Math.max(0, Math.min(size - 1, (cur % size) + dx)); const y = Math.max(0, Math.min(size - 1, ((cur / size) | 0) + dy)); cur = y * size + x; draw(); };
      if (k === 'ArrowLeft') { move(-1, 0); e.preventDefault(); return true; }
      if (k === 'ArrowRight') { move(1, 0); e.preventDefault(); return true; }
      if (k === 'ArrowUp') { move(0, -1); e.preventDefault(); return true; }
      if (k === 'ArrowDown') { move(0, 1); e.preventDefault(); return true; }
      if (k === 'Enter' || k === ' ') { place(cur); e.preventDefault(); return true; }
      const l = k.toLowerCase();
      if (l === 'p') { doPass(); return true; }
      if (l === 'u') { undo(); return true; }
      if (l === 'n') { newGame(); g.sfx.click(); return true; }
      if (l === 'c') { showScore(true); return true; }
      return false;
    },
  };
}
