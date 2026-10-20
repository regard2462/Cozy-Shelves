// Snake – canvas rendered in phosphor colours.
import { h } from '../../../core/dom.js';
import { btn, T } from '../terminal.js';

export async function mount(root, g) {
  const W = 30, H = 20, CELL = 20;
  const canvas = h('canvas.term-canvas', { width: W * CELL, height: H * CELL });
  const cx = canvas.getContext('2d');
  const scoreEl = h('span.term-bright', '0');
  const bestEl = h('span', String(g.best.get() || 0));
  const msg = h('div.term-game-msg');
  root.appendChild(h('div.term-game-center',
    h('div.term-game-bar', h('span.term-prompt', T('Punkte', 'Score')), scoreEl, h('span.term-prompt', 'Best'), bestEl, h('span.spacer'), btn(T('Neu', 'New'), () => start()), ' ', btn(T('Pause', 'Pause'), () => togglePause())),
    canvas, msg,
    h('div.term-game-bar.term-dim', T('Pfeiltasten / WASD steuern · P Pause · N neu', 'arrows / WASD steer · P pause · N new'))));

  let snake, dir, nextDir, food, score, alive, paused, timer = null, speed, started;
  const rnd = (n) => Math.floor(Math.random() * n);
  function start() {
    snake = [[15, 10], [14, 10], [13, 10]]; dir = [1, 0]; nextDir = dir; score = 0; alive = true; paused = false; speed = 150; started = false;
    placeFood(); scoreEl.textContent = '0'; msg.textContent = T('Pfeiltaste drücken zum Start', 'press an arrow key to start'); schedule(); draw();
  }
  function placeFood() { do { food = [rnd(W), rnd(H)]; } while (snake.some(([x, y]) => x === food[0] && y === food[1])); }
  function schedule() { clearTimeout(timer); timer = setTimeout(tick, speed); }
  function tick() {
    if (!alive || paused || !started) { schedule(); return; }
    dir = nextDir;
    const head = [snake[0][0] + dir[0], snake[0][1] + dir[1]];
    if (head[0] < 0 || head[1] < 0 || head[0] >= W || head[1] >= H || snake.some(([x, y]) => x === head[0] && y === head[1])) { die(); return; }
    snake.unshift(head);
    if (head[0] === food[0] && head[1] === food[1]) { score += 10; scoreEl.textContent = String(score); placeFood(); speed = Math.max(60, speed - 3); g.sfx.click(); if (g.best.set(score)) bestEl.textContent = String(score); }
    else snake.pop();
    draw(); schedule();
  }
  function die() { alive = false; g.sfx.error(); msg.textContent = T('Vorbei. N startet ein neues Spiel', 'Game over – N for a new game'); draw(); }
  function togglePause() { if (!alive) return; paused = !paused; msg.textContent = paused ? T('Pause · P weiter · Esc Spiele', 'Paused – P resume · Esc games') : ''; draw(); }
  function draw() {
    const fg = g.phosphor(), dimc = g.phosphorDim(), bg = g.phosphorBg(), acc = g.accent ? g.accent() : fg;
    cx.fillStyle = bg; cx.fillRect(0, 0, canvas.width, canvas.height);
    // soft paper grid
    cx.strokeStyle = dimc; cx.globalAlpha = 0.12; cx.beginPath();
    for (let x = 1; x < W; x++) { cx.moveTo(x * CELL + 0.5, 0); cx.lineTo(x * CELL + 0.5, canvas.height); }
    for (let y = 1; y < H; y++) { cx.moveTo(0, y * CELL + 0.5); cx.lineTo(canvas.width, y * CELL + 0.5); }
    cx.stroke(); cx.globalAlpha = 1;
    snake.forEach(([x, y], i) => {
      cx.fillStyle = i === 0 ? fg : dimc;
      cx.globalAlpha = i === 0 ? 1 : Math.max(0.5, 1 - i * 0.012);
      roundRect(cx, x * CELL + 2, y * CELL + 2, CELL - 4, CELL - 4, 5); cx.fill();
    });
    cx.globalAlpha = 1;
    cx.fillStyle = acc;
    cx.beginPath(); cx.arc(food[0] * CELL + CELL / 2, food[1] * CELL + CELL / 2, CELL / 2 - 4, 0, Math.PI * 2); cx.fill();
    if (!alive || paused) { cx.fillStyle = bg; cx.globalAlpha = 0.6; cx.fillRect(0, 0, canvas.width, canvas.height); cx.globalAlpha = 1; }
  }
  function roundRect(c, x, y, w, hh, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + hh, r); c.arcTo(x + w, y + hh, x, y + hh, r); c.arcTo(x, y + hh, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  start();
  g.setHints([['←↑→↓', T('steuern', 'steer')], ['P', 'Pause'], ['N', T('neu', 'new')], ['Esc', T('Pause / Spiele', 'pause / games')]]);
  return {
    unmount() { clearTimeout(timer); },
    onKey(e) {
      const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1] };
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k in dirs) {
        e.preventDefault(); const d = dirs[k];
        // validate against the PENDING direction, not the one from the last tick – otherwise two
        // fast key presses within one tick can commit a 180° turn and kill the snake.
        const ref = nextDir || dir;
        if (d[0] === -ref[0] && d[1] === -ref[1] && snake.length > 1) return true;
        if (d[0] === ref[0] && d[1] === ref[1]) { if (!started) { started = true; msg.textContent = ''; } return true; }
        nextDir = d; if (!started) { started = true; msg.textContent = ''; } if (paused) togglePause();
        return true;
      }
      if (k === 'p') { togglePause(); return true; }
      if (k === 'n') { start(); g.sfx.click(); return true; }
      if (e.key === 'Escape' && alive && started && !paused) { togglePause(); return true; }
      return false;
    },
  };
}
