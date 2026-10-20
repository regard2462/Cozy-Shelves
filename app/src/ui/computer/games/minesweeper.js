// Minensuche – three sizes, keyboard cursor + mouse, flags, timer, best time per size.
import { h, clear } from '../../../core/dom.js';
import { btn, T } from '../terminal.js';

const SIZES = { klein: [9, 9, 10], mittel: [16, 16, 40], gross: [30, 16, 99] };

export async function mount(root, g) {
  let size = g.params?.size in SIZES ? g.params.size : 'klein';
  let W, H, M, grid, revealed, flags, alive, won, started, t0, timer = null, cur = [0, 0], left = 0;
  const board = h('div.term-mines');
  const timeEl = h('span.term-bright', '0'), minesEl = h('span.term-bright', '0'), bestEl = h('span');
  const msg = h('div.term-game-msg');
  const sizeBtns = Object.keys(SIZES).map((k) => btn({ klein: T('Klein', 'Small'), mittel: T('Mittel', 'Medium'), gross: T('Groß', 'Large') }[k], () => { size = k; start(); }, 'size'));
  root.appendChild(h('div.term-game-center',
    h('div.term-game-bar', h('span.term-prompt', T('Minen', 'Mines')), minesEl, h('span.term-prompt', T('Zeit', 'Time')), timeEl, h('span.term-prompt', 'Best'), bestEl, h('span.spacer'), sizeBtns, btn(T('Neu', 'New'), () => start())),
    board, msg,
    h('div.term-game-bar.term-dim', T('Pfeile bewegen · ⏎/Leertaste aufdecken · F Flagge · Maus: links aufdecken, rechts Flagge', 'arrows move · ⏎/Space reveal · F flag · mouse: left reveal, right flag'))));

  const idx = (x, y) => y * W + x;
  const nb = (x, y) => { const out = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) out.push([nx, ny]); } return out; };
  function start() {
    [W, H, M] = SIZES[size]; grid = new Int8Array(W * H); revealed = new Uint8Array(W * H); flags = new Uint8Array(W * H); alive = true; won = false; started = false; left = W * H - M; cur = [Math.floor(W / 2), Math.floor(H / 2)];
    clearInterval(timer); timeEl.textContent = '0'; minesEl.textContent = String(M); msg.textContent = '';
    const b = g.best.get(size); bestEl.textContent = b != null ? b + ' s' : '—';
    sizeBtns.forEach((bt, i) => bt.classList.toggle('on', Object.keys(SIZES)[i] === size));
    board.style.gridTemplateColumns = `repeat(${W}, 1fr)`; board.dataset.size = size;
    build();
  }
  function place(fx, fy) { // first click safe
    let n = 0; while (n < M) { const x = Math.floor(Math.random() * W), y = Math.floor(Math.random() * H); if (grid[idx(x, y)] === -1 || (Math.abs(x - fx) <= 1 && Math.abs(y - fy) <= 1)) continue; grid[idx(x, y)] = -1; n++; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grid[idx(x, y)] !== -1) grid[idx(x, y)] = nb(x, y).filter(([a, b]) => grid[idx(a, b)] === -1).length;
    started = true; t0 = Date.now(); timer = setInterval(() => { timeEl.textContent = String(Math.floor((Date.now() - t0) / 1000)); }, 500);
  }
  function reveal(x, y) {
    if (!alive || won) return;
    const i = idx(x, y); if (revealed[i] || flags[i]) return;
    if (!started) place(x, y);
    if (grid[i] === -1) { alive = false; clearInterval(timer); for (let k = 0; k < grid.length; k++) if (grid[k] === -1) revealed[k] = 1; g.sfx.error(); msg.textContent = T('Bumm! N startet ein neues Spiel', 'Boom! – N for a new game'); render(); return; }
    const stack = [[x, y]];
    while (stack.length) { const [a, b] = stack.pop(); const j = idx(a, b); if (revealed[j] || flags[j]) continue; revealed[j] = 1; left--; if (grid[j] === 0) for (const p of nb(a, b)) if (!revealed[idx(p[0], p[1])]) stack.push(p); }
    g.sfx.type();
    if (left === 0) { won = true; clearInterval(timer); const secs = Math.floor((Date.now() - t0) / 1000); g.sfx.click(); msg.textContent = T('Geschafft in {s} s!', 'Cleared in {s} s!', { s: secs }); if (g.best.set(secs, size, false)) { bestEl.textContent = secs + ' s'; msg.textContent += T(' Neue Bestzeit!', ' New best time!'); } }
    render();
  }
  function chord(x, y) { // reveal neighbours when flags match number
    const i = idx(x, y); if (!revealed[i] || grid[i] <= 0) return;
    const ns = nb(x, y); if (ns.filter(([a, b]) => flags[idx(a, b)]).length !== grid[i]) return;
    for (const [a, b] of ns) if (!flags[idx(a, b)] && !revealed[idx(a, b)]) reveal(a, b);
  }
  // ---- rendering: the cells are created once, later renders only touch text + class
  let cellEls = [];
  function build() {
    clear(board); cellEls = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const c = h('div.term-mine-cell', {
        onmousedown: (e) => { e.preventDefault(); moveCur(x - cur[0], y - cur[1]); if (e.button === 2) flag(x, y); else if (e.button === 0) { if (revealed[i]) chord(x, y); else reveal(x, y); } },
        oncontextmenu: (e) => e.preventDefault(),
      });
      cellEls.push(c); board.appendChild(c);
    }
    render();
  }
  function flag(x, y) { if (!alive || won) return; const i = idx(x, y); if (revealed[i]) return; flags[i] = flags[i] ? 0 : 1; minesEl.textContent = String(M - flags.reduce((a, b) => a + b, 0)); g.sfx.click(); render(); }
  function render() {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = idx(x, y); const el = cellEls[i]; if (!el) continue;
      let txt = '', cls = 'term-mine-cell';
      if (revealed[i]) { cls += ' open'; if (grid[i] === -1) { txt = '✹'; cls += ' mine'; } else if (grid[i] > 0) { txt = String(grid[i]); cls += ' n' + grid[i]; } }
      else if (flags[i]) { txt = '⚑'; cls += ' flag'; }
      if (cur[0] === x && cur[1] === y) cls += ' cur';
      if (el.textContent !== txt) el.textContent = txt;
      if (el.className !== cls) el.className = cls;
    }
  }
  function moveCur(dx, dy) { cellEls[idx(cur[0], cur[1])]?.classList.remove('cur'); cur = [Math.max(0, Math.min(W - 1, cur[0] + dx)), Math.max(0, Math.min(H - 1, cur[1] + dy))]; cellEls[idx(cur[0], cur[1])]?.classList.add('cur'); }
  start();
  g.setHints([['←↑→↓', T('Cursor', 'cursor')], ['⏎', T('aufdecken', 'reveal')], ['F', T('Flagge', 'flag')], ['1-3', T('Größe', 'size')], ['Esc', T('Spiele', 'games')]]);
  return {
    unmount() { clearInterval(timer); },
    onKey(e) {
      const k = e.key;
      if (k === 'ArrowLeft') { moveCur(-1, 0); e.preventDefault(); return true; }
      if (k === 'ArrowRight') { moveCur(1, 0); e.preventDefault(); return true; }
      if (k === 'ArrowUp') { moveCur(0, -1); e.preventDefault(); return true; }
      if (k === 'ArrowDown') { moveCur(0, 1); e.preventDefault(); return true; }
      if (k === 'Enter' || k === ' ') { e.preventDefault(); if (revealed[idx(cur[0], cur[1])]) chord(cur[0], cur[1]); else reveal(cur[0], cur[1]); return true; }
      if (k === 'f' || k === 'F') { flag(cur[0], cur[1]); return true; }
      if (k === 'n' || k === 'N') { start(); return true; }
      if (k === '1' || k === '2' || k === '3') { size = Object.keys(SIZES)[+k - 1]; start(); return true; }
      return false;
    },
  };
}
