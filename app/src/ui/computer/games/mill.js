// Mühle / Nine Men's Morris – setzen, ziehen, springen; Mühle schließen = Stein entfernen.
// Rules engine is pure and exported for tests; the opponent is a small alpha-beta search.
import { h, clear } from '../../../core/dom.js';
import { btn, segmented, T } from '../terminal.js';

export const EMPTY = 0, P1 = 1, P2 = 2;     // P1 = white (starts), P2 = black
const other = (c) => (c === P1 ? P2 : P1);

// 24 points: 0-7 outer ring, 8-15 middle, 16-23 inner (clockwise from the top-left corner)
export const MILLS = (() => {
  const out = [];
  for (let r = 0; r < 3; r++) {
    const b = r * 8;
    out.push([b + 0, b + 1, b + 2], [b + 2, b + 3, b + 4], [b + 4, b + 5, b + 6], [b + 6, b + 7, b + 0]);
  }
  for (const k of [1, 3, 5, 7]) out.push([k, k + 8, k + 16]);
  return out;
})();
export const ADJ = (() => {
  const a = Array.from({ length: 24 }, () => []);
  for (let r = 0; r < 3; r++) {
    const b = r * 8;
    for (let i = 0; i < 8; i++) { a[b + i].push(b + ((i + 1) % 8)); a[b + i].push(b + ((i + 7) % 8)); }
  }
  for (const k of [1, 3, 5, 7]) { a[k].push(k + 8); a[k + 8].push(k, k + 16); a[k + 16].push(k + 8); }
  return a.map((l) => [...new Set(l)]);
})();

export function createMill() {
  const st = { board: new Int8Array(24), hand: { [P1]: 9, [P2]: 9 }, turn: P1, winner: 0, history: [] };
  return st;
}
export const onBoard = (st, c) => { let n = 0; for (const v of st.board) if (v === c) n++; return n; };
export const phase = (st, c) => (st.hand[c] > 0 ? 'place' : (onBoard(st, c) <= 3 ? 'fly' : 'move'));
export function isMill(board, i, c) { return MILLS.some((m) => m.includes(i) && m.every((k) => board[k] === c)); }
export function removable(st, victim) {
  const all = [];
  for (let i = 0; i < 24; i++) if (st.board[i] === victim) all.push(i);
  const free = all.filter((i) => !isMill(st.board, i, victim));
  return free.length ? free : all;     // only mills left → they may be taken
}
/** Every legal move for `c` as { from, to, remove } (from = -1 while placing). */
export function genMoves(st, c) {
  const out = [];
  const push = (from, to) => {
    const b = st.board;
    const prev = b[to]; b[to] = c; if (from >= 0) b[from] = EMPTY;
    const mill = isMill(b, to, c);
    if (from >= 0) b[from] = c; b[to] = prev;
    if (!mill) { out.push({ from, to, remove: -1 }); return; }
    const after = Int8Array.from(st.board); after[to] = c; if (from >= 0) after[from] = EMPTY;
    const victims = [];
    for (let i = 0; i < 24; i++) if (after[i] === other(c)) victims.push(i);
    const free = victims.filter((i) => !isMill(after, i, other(c)));
    const list = free.length ? free : victims;
    if (!list.length) out.push({ from, to, remove: -1 });
    else for (const r of list) out.push({ from, to, remove: r });
  };
  if (st.hand[c] > 0) {
    for (let i = 0; i < 24; i++) if (st.board[i] === EMPTY) push(-1, i);
  } else if (onBoard(st, c) <= 3) {
    for (let f = 0; f < 24; f++) if (st.board[f] === c) for (let t = 0; t < 24; t++) if (st.board[t] === EMPTY) push(f, t);
  } else {
    for (let f = 0; f < 24; f++) if (st.board[f] === c) for (const t of ADJ[f]) if (st.board[t] === EMPTY) push(f, t);
  }
  return out;
}
export function doMove(st, m, c = st.turn) {
  st.history.push({ board: Int8Array.from(st.board), hand: { ...st.hand }, turn: st.turn, winner: st.winner });
  if (m.from >= 0) st.board[m.from] = EMPTY; else st.hand[c]--;
  st.board[m.to] = c;
  if (m.remove >= 0) st.board[m.remove] = EMPTY;
  st.turn = other(c);
  updateWinner(st);
  return st;
}
export function undoMove(st) {
  const h2 = st.history.pop(); if (!h2) return false;
  st.board = h2.board; st.hand = h2.hand; st.turn = h2.turn; st.winner = h2.winner;
  return true;
}
export function updateWinner(st) {
  const t = st.turn;
  if (st.hand[t] === 0 && onBoard(st, t) < 3) { st.winner = other(t); return; }
  if (!genMoves(st, t).length) { st.winner = other(t); return; }
  st.winner = 0;
}
function evaluate(st, me) {
  const opp = other(me);
  const mine = onBoard(st, me) + st.hand[me], his = onBoard(st, opp) + st.hand[opp];
  let mills = 0, twos = 0;
  for (const m of MILLS) {
    const a = m.map((i) => st.board[i]);
    const nm = a.filter((v) => v === me).length, no = a.filter((v) => v === opp).length;
    if (nm === 3) mills += 1; else if (no === 3) mills -= 1;
    if (nm === 2 && no === 0) twos += 1; else if (no === 2 && nm === 0) twos -= 1;
  }
  const mob = genMoves(st, me).length - genMoves(st, opp).length;
  return (mine - his) * 22 + mills * 14 + twos * 5 + mob * 0.6;
}
/** Alpha-beta opponent. depth 3 is instant, depth 4 still comfortable. */
export function millBotMove(st, c, depth = 3) {
  const moves = genMoves(st, c);
  if (!moves.length) return null;
  let best = moves[0], bestV = -Infinity;
  for (const m of shuffle(moves)) {
    doMove(st, m, c);
    const v = -search(st, other(c), depth - 1, -Infinity, Infinity, c);
    undoMove(st);
    if (v > bestV) { bestV = v; best = m; }
  }
  return best;
}
function search(st, c, depth, alpha, beta, me) {
  if (st.winner) return (st.winner === me ? 1 : -1) * 10000;
  if (depth <= 0) return (c === me ? 1 : -1) * evaluate(st, me);
  const moves = genMoves(st, c);
  if (!moves.length) return (c === me ? -1 : 1) * 10000;
  let v = -Infinity;
  for (const m of moves) {
    doMove(st, m, c);
    v = Math.max(v, -search(st, other(c), depth - 1, -beta, -alpha, me));
    undoMove(st);
    alpha = Math.max(alpha, v);
    if (alpha >= beta) break;
  }
  return v;
}
function shuffle(a) { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [r[i], r[j]] = [r[j], r[i]]; } return r; }

// ---------------------------------------------------------------------------------------------
// geometry (grid units 0..6)
const POS = (() => {
  const out = [];
  for (let r = 0; r < 3; r++) {
    const lo = r, hi = 6 - r, mid = 3;
    out.push([lo, lo], [mid, lo], [hi, lo], [hi, mid], [hi, hi], [mid, hi], [lo, hi], [lo, mid]);
  }
  return out;
})();

export async function mount(root, g) {
  let st = createMill();
  let myColor = P1, botOn = true, depth = 3;
  let sel = -1, cur = 0, pendingRemove = false, dead = false, thinking = false, botTimer = 0;

  const canvas = h('canvas.term-bg-canvas');
  const statusEl = h('div.term-chess-status');
  const handEl = h('div.term-go-cap');
  const msg = h('div.term-game-msg');
  const colorSeg = segmented([[P1, T('Weiß (beginnt)', 'White (starts)')], [P2, T('Schwarz', 'Black')]], myColor, (v) => { myColor = +v; newGame(); });
  const botSeg = segmented([[1, T('gegen Computer', 'vs computer')], [0, T('zu zweit', 'two players')]], 1, (v) => { botOn = !!+v; newGame(); });
  const lvlSeg = segmented([[2, T('leicht', 'easy')], [3, T('mittel', 'medium')], [4, T('stark', 'strong')]], 3, (v) => { depth = +v; });

  root.appendChild(h('div.term-boardgame', h('div', canvas),
    h('div.term-boardgame-side',
      h('div.term-line', h('span.term-k', T('Deine Farbe', 'Your colour')), colorSeg.el),
      h('div.term-line', h('span.term-k', T('Modus', 'Mode')), botSeg.el),
      h('div.term-line', h('span.term-k', T('Stärke', 'Strength')), lvlSeg.el),
      handEl, statusEl,
      h('div.term-actions', btn(T('Zurück (U)', 'Undo (U)'), () => undo()), btn(T('Neu (N)', 'New (N)'), () => newGame())),
      h('div.term-line.term-dim', T('Erst setzen, dann auf Nachbarpunkte ziehen. Mit drei Steinen darfst du springen. Schließt du eine Mühle, nimmst du einen gegnerischen Stein.',
        'First place, then move to adjacent points. With three men you may fly. Closing a mill lets you take an enemy man.')))));
  root.appendChild(msg);

  const CELL = 62, PAD = 34;
  const px = CELL * 6 + PAD * 2;
  function layout() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(px * dpr); canvas.height = Math.round(px * dpr);
    canvas.style.width = px + 'px'; canvas.style.height = px + 'px';
    canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  const sx = (i) => PAD + POS[i][0] * CELL, sy = (i) => PAD + POS[i][1] * CELL;
  function draw() {
    const cx = canvas.getContext('2d');
    cx.clearRect(0, 0, px, px);
    cx.fillStyle = '#e4d0a8'; cx.fillRect(0, 0, px, px);
    cx.strokeStyle = '#5a3f1e'; cx.lineWidth = 2;
    for (let r = 0; r < 3; r++) {
      const lo = PAD + r * CELL, hi = PAD + (6 - r) * CELL;
      cx.strokeRect(lo, lo, hi - lo, hi - lo);
    }
    cx.beginPath();
    for (const k of [1, 3, 5, 7]) { cx.moveTo(sx(k), sy(k)); cx.lineTo(sx(k + 16), sy(k + 16)); }
    cx.stroke();
    for (let i = 0; i < 24; i++) {
      cx.fillStyle = '#5a3f1e';
      cx.beginPath(); cx.arc(sx(i), sy(i), 5, 0, Math.PI * 2); cx.fill();
    }
    const legal = legalTargets();
    for (const t of legal) {
      cx.fillStyle = 'rgba(169,112,44,.30)';
      cx.beginPath(); cx.arc(sx(t), sy(t), 13, 0, Math.PI * 2); cx.fill();
    }
    for (let i = 0; i < 24; i++) {
      const v = st.board[i]; if (!v) continue;
      const r = 20, x = sx(i), y = sy(i);
      const grad = cx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
      if (v === P2) { grad.addColorStop(0, '#564a3f'); grad.addColorStop(1, '#151210'); }
      else { grad.addColorStop(0, '#fffdf6'); grad.addColorStop(1, '#dfd0b0'); }
      cx.fillStyle = grad; cx.beginPath(); cx.arc(x, y, r, 0, Math.PI * 2); cx.fill();
      cx.strokeStyle = 'rgba(60,40,18,.6)'; cx.lineWidth = 1; cx.stroke();
      if (i === sel) { cx.strokeStyle = '#a9702c'; cx.lineWidth = 3; cx.beginPath(); cx.arc(x, y, r + 4, 0, Math.PI * 2); cx.stroke(); }
    }
    // preview of the man that closes a mill (not yet committed to the board)
    if (pendingRemove && stage) {
      const x = sx(stage.to), y = sy(stage.to);
      cx.globalAlpha = 0.65;
      cx.fillStyle = st.turn === P1 ? '#fffdf6' : '#151210';
      cx.beginPath(); cx.arc(x, y, 20, 0, Math.PI * 2); cx.fill();
      cx.globalAlpha = 1;
      cx.strokeStyle = '#a9702c'; cx.lineWidth = 2; cx.beginPath(); cx.arc(x, y, 22, 0, Math.PI * 2); cx.stroke();
      if (stage.from >= 0) { cx.globalAlpha = 0.3; cx.fillStyle = '#e4d0a8'; cx.beginPath(); cx.arc(sx(stage.from), sy(stage.from), 21, 0, Math.PI * 2); cx.fill(); cx.globalAlpha = 1; }
    }
    cx.strokeStyle = '#a9702c'; cx.lineWidth = 2;
    cx.strokeRect(sx(cur) - 24, sy(cur) - 24, 48, 48);
  }
  function legalTargets() {
    if (st.winner) return [];
    if (botOn && st.turn !== myColor) return [];
    if (pendingRemove) return removable(st, other(st.turn));
    if (st.hand[st.turn] > 0) { const o = []; for (let i = 0; i < 24; i++) if (!st.board[i]) o.push(i); return o; }
    if (sel < 0) return [];
    if (onBoard(st, st.turn) <= 3) { const o = []; for (let i = 0; i < 24; i++) if (!st.board[i]) o.push(i); return o; }
    return ADJ[sel].filter((i) => !st.board[i]);
  }
  function paintInfo() {
    clear(handEl);
    handEl.append(
      h('span', h('i.term-go-dot.w'), `${st.hand[P1]} ${T('in der Hand', 'in hand')} · ${onBoard(st, P1)} ${T('am Brett', 'on board')}`),
      h('span', h('i.term-go-dot.b'), `${st.hand[P2]} · ${onBoard(st, P2)}`));
    if (st.winner) { statusEl.textContent = T('Partie beendet', 'Game finished'); return; }
    const who = st.turn === P1 ? T('Weiß', 'White') : T('Schwarz', 'Black');
    const ph = { place: T('setzen', 'placing'), move: T('ziehen', 'moving'), fly: T('springen', 'flying') }[phase(st, st.turn)];
    statusEl.textContent = thinking ? T('Der Computer überlegt …', 'The computer is thinking …')
      : pendingRemove ? T('Mühle! Nimm einen gegnerischen Stein.', 'Mill! Take an enemy man.')
        : T('{w} am Zug ({p})', '{w} to move ({p})', { w: who, p: ph });
  }
  function checkEnd() {
    if (!st.winner) return false;
    const w = st.winner === P1 ? T('Weiß', 'White') : T('Schwarz', 'Black');
    msg.textContent = T('{w} gewinnt!', '{w} wins!', { w });
    if (botOn && st.winner === myColor) g.best.set((g.best.get('wins') || 0) + 1, 'wins');
    g.sfx.open(); paintInfo(); draw();
    return true;
  }
  // two-step interaction: a mill lets the player pick the stone to remove
  let stage = null;   // { from, to }
  function click(i) {
    if (st.winner) return;
    if (botOn && st.turn !== myColor) { g.sfx.error(); return; }
    if (pendingRemove) {
      if (!removable(st, other(st.turn)).includes(i)) { g.sfx.error(); msg.textContent = T('Dieser Stein steht in einer Mühle.', 'That man is part of a mill.'); return; }
      pendingRemove = false;
      doMove(st, { from: stage.from, to: stage.to, remove: i }, st.turn);
      stage = null; sel = -1; msg.textContent = '';
      g.sfx.click(); draw(); paintInfo();
      if (checkEnd()) return;
      if (botOn) scheduleBot();
      return;
    }
    const c = st.turn;
    if (st.hand[c] > 0) {
      if (st.board[i]) { g.sfx.error(); return; }
      tryApply(-1, i);
      return;
    }
    if (st.board[i] === c) { sel = sel === i ? -1 : i; g.sfx.type(); draw(); return; }
    if (sel < 0) { g.sfx.error(); return; }
    if (!legalTargets().includes(i)) { g.sfx.error(); msg.textContent = T('Dorthin ist kein Zug möglich.', 'You cannot move there.'); return; }
    tryApply(sel, i);
  }
  function tryApply(from, to) {
    const c = st.turn;
    const cands = genMoves(st, c).filter((m) => m.from === from && m.to === to);
    if (!cands.length) { g.sfx.error(); return; }
    if (cands.length === 1 && cands[0].remove < 0) {
      doMove(st, cands[0], c); sel = -1; msg.textContent = '';
      g.sfx.move(); draw(); paintInfo();
      if (checkEnd()) return;
      if (botOn) scheduleBot();
      return;
    }
    // mill closed → the board stays untouched until the player picked the victim; `ghost` previews it
    stage = { from, to }; pendingRemove = true; sel = -1;
    g.sfx.move(); msg.textContent = T('Mühle! Welchen Stein nimmst du?', 'Mill! Which man do you take?');
    draw(); paintInfo();
  }
  function scheduleBot() {
    if (dead || st.winner || !botOn) return;
    if (st.turn === myColor) return;
    thinking = true; paintInfo();
    clearTimeout(botTimer);
    botTimer = setTimeout(() => {
      botTimer = 0;
      if (dead || st.winner) { thinking = false; return; }
      const m = millBotMove(st, st.turn, depth);
      thinking = false;
      if (!m) { st.winner = myColor; checkEnd(); return; }
      doMove(st, m, st.turn);
      g.sfx.move(); draw(); paintInfo();
      checkEnd();
    }, 180);
  }
  function undo() {
    clearTimeout(botTimer); thinking = false; pendingRemove = false; stage = null; sel = -1;
    if (!undoMove(st)) { g.sfx.error(); return; }
    if (botOn && st.turn !== myColor) undoMove(st);
    msg.textContent = ''; g.sfx.click(); draw(); paintInfo();
  }
  function newGame() {
    clearTimeout(botTimer); thinking = false; pendingRemove = false; stage = null; sel = -1; cur = 0;
    st = createMill(); msg.textContent = '';
    colorSeg.set(myColor); botSeg.set(botOn ? 1 : 0);
    draw(); paintInfo();
    if (botOn && st.turn !== myColor) scheduleBot();
  }

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let best = -1, bd = 1e9;
    for (let i = 0; i < 24; i++) { const d = Math.hypot(mx - sx(i), my - sy(i)); if (d < bd) { bd = d; best = i; } }
    if (bd > 30) return;
    cur = best; draw(); click(best);
  });

  layout(); newGame();
  g.setHints([['←↑→↓', T('Punkt wählen', 'choose point')], ['⏎', T('setzen / ziehen', 'place / move')], ['U', T('zurück', 'undo')], ['N', T('neu', 'new')], ['Esc', T('Spiele', 'games')]]);
  return {
    unmount() { dead = true; clearTimeout(botTimer); },
    onKey(e) {
      const step = (d) => { cur = (cur + d + 24) % 24; draw(); };
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { step(1); e.preventDefault(); return true; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { step(-1); e.preventDefault(); return true; }
      if (e.key === 'Enter' || e.key === ' ') { click(cur); e.preventDefault(); return true; }
      const l = e.key.toLowerCase();
      if (l === 'u') { undo(); return true; }
      if (l === 'n') { newGame(); g.sfx.click(); return true; }
      return false;
    },
  };
}
