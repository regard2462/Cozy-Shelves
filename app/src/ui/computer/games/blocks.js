// Blöcke – a falling-pieces game (keyboard), canvas rendered.
import { h } from '../../../core/dom.js';
import { btn, T } from '../terminal.js';

const SHAPES = [
  [[1, 1, 1, 1]],
  [[1, 1], [1, 1]],
  [[0, 1, 0], [1, 1, 1]],
  [[1, 0, 0], [1, 1, 1]],
  [[0, 0, 1], [1, 1, 1]],
  [[1, 1, 0], [0, 1, 1]],
  [[0, 1, 1], [1, 1, 0]],
];

export async function mount(root, g) {
  const W = 10, H = 20, CELL = 24;
  const canvas = h('canvas.term-canvas', { width: W * CELL, height: H * CELL });
  const next = h('canvas.term-canvas.small', { width: 4 * CELL, height: 4 * CELL });
  const cx = canvas.getContext('2d'), nx = next.getContext('2d');
  const scoreEl = h('span.term-bright', '0'), linesEl = h('span', '0'), levelEl = h('span', '1'), bestEl = h('span', String(g.best.get() || 0));
  const msg = h('div.term-game-msg');
  root.appendChild(h('div.term-game-center',
    h('div.term-blocks', canvas,
      h('div.term-blocks-side',
        h('div.term-kv', h('span.term-k', T('PUNKTE', 'SCORE')), scoreEl), h('div.term-kv', h('span.term-k', T('REIHEN', 'LINES')), linesEl), h('div.term-kv', h('span.term-k', 'LEVEL'), levelEl), h('div.term-kv', h('span.term-k', 'BEST'), bestEl),
        h('div.term-kv', h('span.term-k', T('NÄCHSTER', 'NEXT'))), next, msg,
        btn(T('Neu', 'New'), () => start()), btn(T('Pause', 'Pause'), () => togglePause()))),
    h('div.term-game-bar.term-dim', T('←→ bewegen · ↑ drehen · ↓ schneller · Leertaste fallen · P Pause', '←→ move · ↑ rotate · ↓ soft drop · Space hard drop · P pause'))));

  let grid, piece, nextPiece, score, lines, level, alive, paused, timer = null;
  const rnd = (n) => Math.floor(Math.random() * n);
  const newPiece = () => ({ s: SHAPES[rnd(SHAPES.length)].map((r) => r.slice()), x: 3, y: 0 });
  function start() { grid = Array.from({ length: H }, () => Array(W).fill(0)); score = 0; lines = 0; level = 1; alive = true; paused = false; nextPiece = newPiece(); spawn(); updateSide(); msg.textContent = ''; loop(); draw(); }
  function spawn() { piece = nextPiece; piece.x = Math.floor((W - piece.s[0].length) / 2); piece.y = 0; nextPiece = newPiece(); if (collides(piece.s, piece.x, piece.y)) { alive = false; g.sfx.error(); msg.textContent = T('Vorbei. N startet ein neues Spiel', 'Game over – N for a new game'); } drawNext(); }
  function collides(s, px, py) { for (let y = 0; y < s.length; y++) for (let x = 0; x < s[y].length; x++) if (s[y][x]) { const gx = px + x, gy = py + y; if (gx < 0 || gx >= W || gy >= H || (gy >= 0 && grid[gy][gx])) return true; } return false; }
  function rotate(s) { return s[0].map((_, i) => s.map((r) => r[i]).reverse()); }
  function lock() {
    for (let y = 0; y < piece.s.length; y++) for (let x = 0; x < piece.s[y].length; x++) if (piece.s[y][x] && piece.y + y >= 0) grid[piece.y + y][piece.x + x] = 1;
    let cleared = 0;
    for (let y = H - 1; y >= 0; y--) if (grid[y].every(Boolean)) { grid.splice(y, 1); grid.unshift(Array(W).fill(0)); cleared++; y++; }
    if (cleared) {
      lines += cleared; score += [0, 100, 300, 500, 800][cleared] * level;
      const nl = 1 + Math.floor(lines / 10);
      g.sfx.click(); if (g.best.set(score)) bestEl.textContent = String(score);
      // only a real level change may restart the gravity interval (a hard drop must not buy time)
      if (nl !== level) { level = nl; loop(); }
    } else g.sfx.type();
    updateSide(); spawn();
  }
  function step() { if (!alive || paused) return; if (!collides(piece.s, piece.x, piece.y + 1)) piece.y++; else lock(); draw(); }
  function loop() { clearInterval(timer); timer = setInterval(() => { step(); if (!alive) clearInterval(timer); }, Math.max(80, 600 - (level - 1) * 50)); }
  function move(dx) { if (!alive || paused) return; if (!collides(piece.s, piece.x + dx, piece.y)) { piece.x += dx; draw(); } }
  function turn() { if (!alive || paused) return; const r = rotate(piece.s); for (const k of [0, -1, 1, -2, 2]) if (!collides(r, piece.x + k, piece.y)) { piece.s = r; piece.x += k; draw(); return; } }
  function hardDrop() { if (!alive || paused) return; while (!collides(piece.s, piece.x, piece.y + 1)) { piece.y++; score += 1; } lock(); draw(); }
  function togglePause() { if (!alive) return; paused = !paused; msg.textContent = paused ? T('PAUSE', 'PAUSED') : ''; draw(); }
  function updateSide() { scoreEl.textContent = String(score); linesEl.textContent = String(lines); levelEl.textContent = String(level); }
  function cell(ctx, x, y, fg) { ctx.fillStyle = fg; ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2); ctx.fillStyle = 'rgba(255,248,232,.35)'; ctx.fillRect(x * CELL + 4, y * CELL + 4, CELL - 8, CELL - 8); }
  function draw() {
    const fg = g.phosphor(), dimc = g.phosphorDim(), bg = g.phosphorBg();
    cx.fillStyle = bg; cx.fillRect(0, 0, canvas.width, canvas.height);
    cx.globalAlpha = 0.18; cx.strokeStyle = dimc; for (let x = 1; x < W; x++) { cx.beginPath(); cx.moveTo(x * CELL, 0); cx.lineTo(x * CELL, canvas.height); cx.stroke(); } cx.globalAlpha = 1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grid[y][x]) cell(cx, x, y, dimc);
    if (alive) {
      // ghost
      let gy = piece.y; while (!collides(piece.s, piece.x, gy + 1)) gy++;
      cx.globalAlpha = 0.25; for (let y = 0; y < piece.s.length; y++) for (let x = 0; x < piece.s[y].length; x++) if (piece.s[y][x]) cell(cx, piece.x + x, gy + y, fg); cx.globalAlpha = 1;
      const acc = g.accent ? g.accent() : fg;
      for (let y = 0; y < piece.s.length; y++) for (let x = 0; x < piece.s[y].length; x++) if (piece.s[y][x] && piece.y + y >= 0) cell(cx, piece.x + x, piece.y + y, acc);
    }
    if (!alive || paused) { cx.fillStyle = bg; cx.globalAlpha = 0.6; cx.fillRect(0, 0, canvas.width, canvas.height); cx.globalAlpha = 1; }
  }
  function drawNext() { nx.fillStyle = g.phosphorBg(); nx.fillRect(0, 0, next.width, next.height); const s = nextPiece.s; const ox = Math.floor((4 - s[0].length) / 2), oy = Math.floor((4 - s.length) / 2); for (let y = 0; y < s.length; y++) for (let x = 0; x < s[y].length; x++) if (s[y][x]) cell(nx, ox + x, oy + y, g.accent ? g.accent() : g.phosphor()); }

  start();
  g.setHints([['←→', T('bewegen', 'move')], ['↑', T('drehen', 'rotate')], ['␣', T('fallen', 'drop')], ['P', 'Pause'], ['Esc', T('Pause / Spiele', 'pause / games')]]);
  return {
    unmount() { clearInterval(timer); },
    onKey(e) {
      const k = e.key;
      if (k === 'ArrowLeft') { move(-1); e.preventDefault(); return true; }
      if (k === 'ArrowRight') { move(1); e.preventDefault(); return true; }
      if (k === 'ArrowUp' || k === 'x' || k === 'X') { turn(); e.preventDefault(); return true; }
      if (k === 'ArrowDown') { step(); e.preventDefault(); return true; }
      if (k === ' ') { hardDrop(); e.preventDefault(); return true; }
      if (k === 'p' || k === 'P') { togglePause(); return true; }
      if (k === 'n' || k === 'N') { start(); g.sfx.click(); return true; }
      if (k === 'Escape' && alive && !paused) { togglePause(); return true; }
      return false;
    },
  };
}
