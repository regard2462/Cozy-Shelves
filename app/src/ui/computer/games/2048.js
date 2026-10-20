// 2048 – slide tiles, merge equal numbers.
import { h } from '../../../core/dom.js';
import { btn, T } from '../terminal.js';

/** Pure slide + merge of one line towards index 0. Exported so the tests can check it. */
export function slideLine(row, n = row.length) {
  const a = row.filter(Boolean); const out = []; let gained = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] === a[i + 1]) { out.push(a[i] * 2); gained += a[i] * 2; i++; } else out.push(a[i]); }
  while (out.length < n) out.push(0);
  return { row: out, gained, moved: out.some((v, i) => v !== row[i]) };
}

export async function mount(root, g) {
  const N = 4;
  let grid, score, over, won, justWon = false, undoState = null;
  const board = h('div.term-2048');
  const scoreEl = h('span.term-bright');
  const bestEl = h('span', String(g.best.get() || 0));
  const msg = h('div.term-game-msg');
  const wrap = h('div.term-game-center',
    h('div.term-game-bar', h('span.term-prompt', T('Punkte', 'Score')), scoreEl, h('span.term-prompt', 'Best'), bestEl, h('span.spacer'),
      btn(T('Neu', 'New'), () => start(), ''), ' ', btn(T('Rückgängig', 'Undo'), () => undo())),
    board, msg,
    h('div.term-game-bar.term-dim', T('Pfeiltasten schieben · N neu · U rückgängig', 'arrows slide · N new · U undo')));
  root.appendChild(wrap);

  const rnd = (n) => Math.floor(Math.random() * n);
  function start() { grid = Array.from({ length: N }, () => Array(N).fill(0)); score = 0; over = false; won = false; justWon = false; undoState = null; addTile(); addTile(); render(); msg.textContent = ''; }
  function addTile() { const empty = []; for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!grid[r][c]) empty.push([r, c]); if (!empty.length) return; const [r, c] = empty[rnd(empty.length)]; grid[r][c] = Math.random() < 0.9 ? 2 : 4; }
  const slideRow = (row) => slideLine(row, N);
  function move(dir) { // 0 left, 1 right, 2 up, 3 down
    if (over) return false;
    const before = JSON.stringify(grid); const prevScore = score;
    let moved = false, gained = 0;
    const lines = [];
    for (let i = 0; i < N; i++) {
      let line = dir < 2 ? grid[i].slice() : grid.map((r) => r[i]);
      if (dir === 1 || dir === 3) line.reverse();
      const res = slideRow(line); gained += res.gained; if (res.moved) moved = true;
      let out = res.row; if (dir === 1 || dir === 3) out.reverse();
      lines.push(out);
    }
    if (!moved) return false;
    if (dir < 2) grid = lines; else for (let i = 0; i < N; i++) for (let r = 0; r < N; r++) grid[r][i] = lines[i][r];
    undoState = { grid: JSON.parse(before), score: prevScore };
    score += gained; addTile(); render();
    if (gained) g.sfx.click(); else g.sfx.type();
    if (!won && grid.flat().includes(2048)) { won = true; justWon = true; msg.textContent = T('2048 geschafft! Weiter geht’s …', '2048 reached! Keep going …'); g.sfx.open(); }
    if (!canMove()) {
      over = true; g.sfx.error();
      const end = T('Keine Züge mehr. N startet ein neues Spiel', 'No more moves – N for a new game');
      // never swallow the 2048 message when the board fills up on the very same move
      msg.textContent = justWon ? msg.textContent + '  ·  ' + end : end;
    }
    justWon = false;
    if (g.best.set(score)) bestEl.textContent = String(score);
    return true;
  }
  function canMove() { for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { if (!grid[r][c]) return true; if (c < N - 1 && grid[r][c] === grid[r][c + 1]) return true; if (r < N - 1 && grid[r][c] === grid[r + 1][c]) return true; } return false; }
  function undo() { if (!undoState) return; grid = undoState.grid; score = undoState.score; undoState = null; over = false; msg.textContent = ''; render(); g.sfx.click(); }
  // tiles are kept across renders (keyed by position) so the CSS transition can animate a change
  const tiles = [];
  for (let i = 0; i < N * N; i++) { const t = h('div.term-2048-tile.empty'); tiles.push(t); board.appendChild(t); }
  function render() {
    scoreEl.textContent = String(score);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const v = grid[r][c], t = tiles[r * N + c];
      const cls = 'term-2048-tile ' + (v ? 'l' + Math.min(11, Math.round(Math.log2(v))) : 'empty');
      const txt = v ? String(v) : '';
      if (t.textContent !== txt) { t.textContent = txt; if (v) { t.classList.add('pop'); setTimeout(() => t.classList.remove('pop'), 130); } }
      if (t.className.replace(' pop', '') !== cls) t.className = cls + (t.classList.contains('pop') ? ' pop' : '');
    }
  }
  // swipe with mouse
  let drag = null;
  board.addEventListener('mousedown', (e) => { drag = [e.clientX, e.clientY]; });
  window.addEventListener('mouseup', onUp);
  function onUp(e) { if (!drag) return; const dx = e.clientX - drag[0], dy = e.clientY - drag[1]; drag = null; if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return; if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : 0); else move(dy > 0 ? 3 : 2); }

  start();
  g.setHints([['←↑→↓', T('schieben', 'slide')], ['U', T('rückgängig', 'undo')], ['N', T('neu', 'new')], ['Esc', T('Spiele', 'games')]]);
  return {
    unmount() { window.removeEventListener('mouseup', onUp); },
    onKey(e) {
      const map = { ArrowLeft: 0, ArrowRight: 1, ArrowUp: 2, ArrowDown: 3 };
      if (e.key in map) { e.preventDefault(); move(map[e.key]); return true; }
      if (e.key === 'n' || e.key === 'N') { start(); g.sfx.click(); return true; }
      if (e.key === 'u' || e.key === 'U') { undo(); return true; }
      return false;
    },
  };
}
