// Dame / Draughts – 8×8 nach internationalen Regeln: Schlagzwang mit Mehrheitsregel,
// Steine schlagen vorwärts und rückwärts, Damen ziehen und schlagen über die ganze Diagonale.
// The rules engine is pure and exported for tests.
import { h, clear } from '../../../core/dom.js';
import { btn, segmented, T } from '../terminal.js';

const N = 8;
export const W_MAN = 1, W_KING = 2, B_MAN = -1, B_KING = -2;
const DIRS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
const inb = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
const isKing = (v) => Math.abs(v) === 2;
const side = (v) => Math.sign(v);

export function startPosition() {
  const b = new Int8Array(N * N);
  for (let y = 0; y < 3; y++) for (let x = 0; x < N; x++) if ((x + y) % 2 === 1) b[y * N + x] = B_MAN;
  for (let y = 5; y < N; y++) for (let x = 0; x < N; x++) if ((x + y) % 2 === 1) b[y * N + x] = W_MAN;
  return b;
}

/** All maximal capture sequences starting at `from`: [{ steps:[sq…], captured:[sq…] }]. */
export function captureSequences(board, from) {
  const v = board[from];
  if (!v) return [];
  const b = Int8Array.from(board); b[from] = 0;   // the moving piece has left its square
  const res = [];
  const rec = (sq, steps, captured) => {
    let extended = false;
    const x0 = sq % N, y0 = (sq / N) | 0;
    for (const [dx, dy] of DIRS) {
      if (isKing(v)) {
        let x = x0 + dx, y = y0 + dy;
        while (inb(x, y) && b[y * N + x] === 0) { x += dx; y += dy; }
        if (!inb(x, y)) continue;
        const mid = y * N + x;
        if (side(b[mid]) === side(v) || captured.includes(mid)) continue;   // own piece / already taken blocks
        let lx = x + dx, ly = y + dy;
        while (inb(lx, ly) && b[ly * N + lx] === 0) {
          extended = true;
          rec(ly * N + lx, [...steps, ly * N + lx], [...captured, mid]);
          lx += dx; ly += dy;
        }
      } else {
        const mx = x0 + dx, my = y0 + dy, lx = x0 + 2 * dx, ly = y0 + 2 * dy;
        if (!inb(lx, ly)) continue;
        const mid = my * N + mx, land = ly * N + lx;
        if (b[mid] === 0 || side(b[mid]) === side(v) || captured.includes(mid)) continue;
        if (b[land] !== 0) continue;
        extended = true;
        rec(land, [...steps, land], [...captured, mid]);
      }
    }
    if (!extended && steps.length) res.push({ steps, captured });
  };
  rec(from, [], []);
  return res;
}

/** Quiet (non-capturing) moves of the piece on `from`. */
export function quietMoves(board, from) {
  const v = board[from]; if (!v) return [];
  const out = []; const x0 = from % N, y0 = (from / N) | 0;
  if (isKing(v)) {
    for (const [dx, dy] of DIRS) {
      let x = x0 + dx, y = y0 + dy;
      while (inb(x, y) && board[y * N + x] === 0) { out.push({ steps: [y * N + x], captured: [] }); x += dx; y += dy; }
    }
  } else {
    const dy = v > 0 ? -1 : 1;                         // white moves up the board
    for (const dx of [-1, 1]) {
      const x = x0 + dx, y = y0 + dy;
      if (inb(x, y) && board[y * N + x] === 0) out.push({ steps: [y * N + x], captured: [] });
    }
  }
  return out;
}

/** Every legal move for `col` (1 = white, -1 = black) honouring the majority capture rule. */
export function legalMoves(board, col) {
  const caps = [];
  for (let i = 0; i < N * N; i++) if (board[i] && side(board[i]) === col) for (const s of captureSequences(board, i)) caps.push({ from: i, ...s });
  if (caps.length) {
    const max = Math.max(...caps.map((c) => c.captured.length));
    return caps.filter((c) => c.captured.length === max);
  }
  const out = [];
  for (let i = 0; i < N * N; i++) if (board[i] && side(board[i]) === col) for (const s of quietMoves(board, i)) out.push({ from: i, ...s });
  return out;
}

export function applyMove(board, mv) {
  const b = Int8Array.from(board);
  let v = b[mv.from];
  b[mv.from] = 0;
  for (const c of mv.captured) b[c] = 0;
  const to = mv.steps[mv.steps.length - 1];
  const row = (to / N) | 0;
  if (!isKing(v) && ((v > 0 && row === 0) || (v < 0 && row === N - 1))) v = v > 0 ? W_KING : B_KING;
  b[to] = v;
  return b;
}
export function material(board) {
  let w = 0, bl = 0;
  for (const v of board) { if (v === W_MAN) w += 10; else if (v === W_KING) w += 32; else if (v === B_MAN) bl += 10; else if (v === B_KING) bl += 32; }
  return { w, b: bl };
}
function evaluate(board, me) {
  const m = material(board);
  let adv = 0;
  for (let i = 0; i < N * N; i++) {
    const v = board[i]; if (!v || isKing(v)) continue;
    const row = (i / N) | 0;
    adv += v > 0 ? (N - 1 - row) * 0.6 : -row * 0.6;
    const x = i % N;
    if (x === 0 || x === N - 1) adv += v > 0 ? 0.8 : -0.8;   // edges are safe
  }
  const raw = (m.w - m.b) + adv;
  return me > 0 ? raw : -raw;
}
/** Alpha-beta opponent. */
export function draughtsBotMove(board, col, depth = 5) {
  const moves = legalMoves(board, col);
  if (!moves.length) return null;
  let best = moves[0], bestV = -Infinity;
  for (const m of shuffle(moves)) {
    const v = -search(applyMove(board, m), -col, depth - 1, -Infinity, Infinity, col);
    if (v > bestV) { bestV = v; best = m; }
  }
  return best;
}
function search(board, col, depth, alpha, beta, me) {
  const moves = legalMoves(board, col);
  if (!moves.length) return (col === me ? -1 : 1) * 9000;
  if (depth <= 0) return (col === me ? 1 : -1) * evaluate(board, me);
  moves.sort((a, b) => b.captured.length - a.captured.length);
  let v = -Infinity;
  for (const m of moves) {
    v = Math.max(v, -search(applyMove(board, m), -col, depth - 1, -beta, -alpha, me));
    alpha = Math.max(alpha, v);
    if (alpha >= beta) break;
  }
  return v;
}
function shuffle(a) { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [r[i], r[j]] = [r[j], r[i]]; } return r; }

// ---------------------------------------------------------------------------------------------
export async function mount(root, g) {
  let board = startPosition(), turn = 1, myColor = 1, botOn = true, depth = 5;
  let sel = -1, partial = [], cur = 5 * N + 2, over = false, thinking = false, dead = false, botTimer = 0;
  const hist = [];

  const canvas = h('canvas.term-bg-canvas');
  const statusEl = h('div.term-chess-status');
  const matEl = h('div.term-go-cap');
  const msg = h('div.term-game-msg');
  const colorSeg = segmented([[1, T('Weiß (beginnt)', 'White (starts)')], [-1, T('Schwarz', 'Black')]], myColor, (v) => { myColor = +v; newGame(); });
  const botSeg = segmented([[1, T('gegen Computer', 'vs computer')], [0, T('zu zweit', 'two players')]], 1, (v) => { botOn = !!+v; newGame(); });
  const lvlSeg = segmented([[3, T('leicht', 'easy')], [5, T('mittel', 'medium')], [7, T('stark', 'strong')]], 5, (v) => { depth = +v; });

  root.appendChild(h('div.term-boardgame', h('div', canvas),
    h('div.term-boardgame-side',
      h('div.term-line', h('span.term-k', T('Deine Farbe', 'Your colour')), colorSeg.el),
      h('div.term-line', h('span.term-k', T('Modus', 'Mode')), botSeg.el),
      h('div.term-line', h('span.term-k', T('Stärke', 'Strength')), lvlSeg.el),
      matEl, statusEl,
      h('div.term-actions', btn(T('Zurück (U)', 'Undo (U)'), () => undo()), btn(T('Neu (N)', 'New (N)'), () => newGame())),
      h('div.term-line.term-dim', T('Schlagzwang: Es muss geschlagen werden, und zwar die Folge mit den meisten Steinen. Mehrfachsprünge klickst du Schritt für Schritt.',
        'Captures are compulsory and you must take the longest sequence. Multi-jumps are clicked step by step.')))));
  root.appendChild(msg);

  const CELL = 58, PAD = 8;
  const px = CELL * N + PAD * 2;
  function layout() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(px * dpr); canvas.height = Math.round(px * dpr);
    canvas.style.width = px + 'px'; canvas.style.height = px + 'px';
    canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  function candidates() {
    if (over || (botOn && turn !== myColor)) return [];
    let ms = legalMoves(board, turn);
    if (sel >= 0) ms = ms.filter((m) => m.from === sel);
    for (let k = 0; k < partial.length; k++) ms = ms.filter((m) => m.steps[k] === partial[k]);
    return ms;
  }
  function draw() {
    const cx = canvas.getContext('2d');
    cx.clearRect(0, 0, px, px);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      cx.fillStyle = (x + y) % 2 ? '#a9825a' : '#ecd9b4';
      cx.fillRect(PAD + x * CELL, PAD + y * CELL, CELL, CELL);
    }
    const cands = candidates();
    if (sel < 0) {
      const froms = new Set(cands.map((m) => m.from));
      for (const f of froms) { cx.fillStyle = 'rgba(95,122,73,.45)'; cx.fillRect(PAD + (f % N) * CELL, PAD + ((f / N) | 0) * CELL, CELL, CELL); }
    } else {
      const next = new Set(cands.map((m) => m.steps[partial.length]).filter((s) => s != null));
      for (const t of next) {
        cx.fillStyle = 'rgba(95,122,73,.55)';
        cx.beginPath(); cx.arc(PAD + (t % N) * CELL + CELL / 2, PAD + ((t / N) | 0) * CELL + CELL / 2, CELL * 0.18, 0, Math.PI * 2); cx.fill();
      }
      cx.strokeStyle = '#a9702c'; cx.lineWidth = 3;
      cx.strokeRect(PAD + (sel % N) * CELL + 2, PAD + ((sel / N) | 0) * CELL + 2, CELL - 4, CELL - 4);
    }
    // pieces (the ones already captured in the running sequence are drawn faded)
    const pending = new Set();
    if (partial.length) { const m = cands[0]; if (m) m.captured.slice(0, partial.length).forEach((c) => pending.add(c)); }
    const ghostFrom = partial.length ? sel : -1;
    for (let i = 0; i < N * N; i++) {
      let v = board[i];
      if (i === ghostFrom) v = 0;
      if (!v) continue;
      drawPiece(cx, i, v, pending.has(i) ? 0.3 : 1);
    }
    if (partial.length) drawPiece(cx, partial[partial.length - 1], board[sel], 0.85);
    cx.strokeStyle = '#3c2a16'; cx.lineWidth = 2;
    cx.strokeRect(PAD + (cur % N) * CELL + 1, PAD + ((cur / N) | 0) * CELL + 1, CELL - 2, CELL - 2);
  }
  function drawPiece(cx, i, v, alpha) {
    const x = PAD + (i % N) * CELL + CELL / 2, y = PAD + ((i / N) | 0) * CELL + CELL / 2, r = CELL * 0.37;
    cx.globalAlpha = alpha;
    const grad = cx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    if (v > 0) { grad.addColorStop(0, '#fffdf6'); grad.addColorStop(1, '#dccdad'); }
    else { grad.addColorStop(0, '#54493f'); grad.addColorStop(1, '#141210'); }
    cx.fillStyle = grad; cx.beginPath(); cx.arc(x, y, r, 0, Math.PI * 2); cx.fill();
    cx.strokeStyle = 'rgba(40,26,10,.6)'; cx.lineWidth = 1; cx.stroke();
    if (isKing(v)) {
      cx.fillStyle = v > 0 ? '#a9702c' : '#e8c88a';
      cx.font = `${Math.round(r)}px serif`; cx.textAlign = 'center'; cx.textBaseline = 'middle';
      cx.fillText('♛', x, y + 1);
    }
    cx.globalAlpha = 1;
  }
  function paintInfo() {
    clear(matEl);
    matEl.append(h('span', h('i.term-go-dot.w'), String(count(1))), h('span', h('i.term-go-dot.b'), String(count(-1))));
    if (over) return;
    statusEl.textContent = thinking ? T('Der Computer überlegt …', 'The computer is thinking …')
      : (turn > 0 ? T('Weiß am Zug', 'White to move') : T('Schwarz am Zug', 'Black to move'))
        + (legalMoves(board, turn).some((x) => x.captured.length) ? ' · ' + T('Schlagzwang', 'must capture') : '');
  }
  const count = (col) => { let n = 0; for (const v of board) if (v && side(v) === col) n++; return n; };
  function checkEnd() {
    if (legalMoves(board, turn).length) return false;
    over = true;
    const win = turn > 0 ? T('Schwarz', 'Black') : T('Weiß', 'White');
    msg.textContent = T('{w} gewinnt, der Gegner kann nicht mehr ziehen.', '{w} wins – the opponent cannot move.', { w: win });
    statusEl.textContent = T('Partie beendet', 'Game finished');
    if (botOn && (turn > 0 ? -1 : 1) === myColor) g.best.set((g.best.get('wins') || 0) + 1, 'wins');
    g.sfx.open();
    return true;
  }
  function commit(mv) {
    hist.push({ board: Int8Array.from(board), turn });
    board = applyMove(board, mv); turn = -turn;
    sel = -1; partial = []; msg.textContent = '';
    g.sfx.move(); draw(); paintInfo();
    if (checkEnd()) return;
    if (botOn && turn !== myColor) scheduleBot();
  }
  function click(i) {
    if (over) return;
    if (botOn && turn !== myColor) { g.sfx.error(); return; }
    if (sel < 0) {
      const froms = new Set(legalMoves(board, turn).map((m) => m.from));
      if (!froms.has(i)) { g.sfx.error(); msg.textContent = board[i] && side(board[i]) === turn ? T('Mit diesem Stein ist kein Zug möglich (Schlagzwang).', 'This piece has no legal move (captures are compulsory).') : ''; return; }
      sel = i; partial = []; g.sfx.type(); draw(); return;
    }
    if (i === sel && !partial.length) { sel = -1; draw(); return; }
    const cands = candidates();
    const next = cands.filter((m) => m.steps[partial.length] === i);
    if (!next.length) {
      if (board[i] && side(board[i]) === turn && !partial.length) { sel = i; draw(); return; }
      g.sfx.error(); return;
    }
    partial = [...partial, i];
    const done = next.find((m) => m.steps.length === partial.length);
    if (done && next.every((m) => m.steps.length === partial.length)) { commit(done); return; }
    g.sfx.type(); draw();
  }
  function scheduleBot() {
    if (dead || over) return;
    thinking = true; paintInfo();
    clearTimeout(botTimer);
    botTimer = setTimeout(() => {
      botTimer = 0;
      if (dead || over) { thinking = false; return; }
      const m = draughtsBotMove(board, turn, depth);
      thinking = false;
      if (!m) { checkEnd(); return; }
      hist.push({ board: Int8Array.from(board), turn });
      board = applyMove(board, m); turn = -turn;
      g.sfx.move(); draw(); paintInfo(); checkEnd();
    }, 150);
  }
  function undo() {
    clearTimeout(botTimer); thinking = false; sel = -1; partial = [];
    let s = hist.pop(); if (!s) { g.sfx.error(); return; }
    if (botOn && s.turn !== myColor) { const s2 = hist.pop(); if (s2) s = s2; }
    board = s.board; turn = s.turn; over = false; msg.textContent = '';
    g.sfx.click(); draw(); paintInfo();
  }
  function newGame() {
    clearTimeout(botTimer); thinking = false;
    board = startPosition(); turn = 1; over = false; sel = -1; partial = []; hist.length = 0; msg.textContent = '';
    colorSeg.set(myColor); botSeg.set(botOn ? 1 : 0);
    draw(); paintInfo();
    if (botOn && turn !== myColor) scheduleBot();
  }

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left - PAD) / CELL), y = Math.floor((e.clientY - rect.top - PAD) / CELL);
    if (!inb(x, y)) return;
    cur = y * N + x; draw(); click(cur);
  });

  layout(); newGame();
  g.setHints([['←↑→↓', T('Cursor', 'cursor')], ['⏎', T('wählen / ziehen', 'pick / move')], ['U', T('zurück', 'undo')], ['N', T('neu', 'new')], ['Esc', T('Spiele', 'games')]]);
  return {
    unmount() { dead = true; clearTimeout(botTimer); },
    onKey(e) {
      const move = (dx, dy) => { const x = Math.max(0, Math.min(N - 1, (cur % N) + dx)), y = Math.max(0, Math.min(N - 1, ((cur / N) | 0) + dy)); cur = y * N + x; draw(); };
      if (e.key === 'ArrowLeft') { move(-1, 0); e.preventDefault(); return true; }
      if (e.key === 'ArrowRight') { move(1, 0); e.preventDefault(); return true; }
      if (e.key === 'ArrowUp') { move(0, -1); e.preventDefault(); return true; }
      if (e.key === 'ArrowDown') { move(0, 1); e.preventDefault(); return true; }
      if (e.key === 'Enter' || e.key === ' ') { click(cur); e.preventDefault(); return true; }
      if (e.key === 'Escape' && sel >= 0) { sel = -1; partial = []; draw(); return true; }
      const l = e.key.toLowerCase();
      if (l === 'u') { undo(); return true; }
      if (l === 'n') { newGame(); g.sfx.click(); return true; }
      return false;
    },
  };
}
