// Sudoku – generator with unique solution, solver, notes, check, 3 difficulties.
import { h, clear } from '../../../core/dom.js';
import { btn, T } from '../terminal.js';

const CLUES = { leicht: 40, mittel: 32, schwer: 26 };

// ---- solver / generator ----------------------------------------------------
function solve(cells, limit = 1) {
  // cells: Int8Array(81); returns number of solutions found (≤ limit); fills first solution into `out`
  const rows = new Uint16Array(9), cols = new Uint16Array(9), boxes = new Uint16Array(9);
  const box = (i) => (Math.floor(i / 27) * 3 + Math.floor((i % 9) / 3));
  for (let i = 0; i < 81; i++) if (cells[i]) { const b = 1 << cells[i]; rows[Math.floor(i / 9)] |= b; cols[i % 9] |= b; boxes[box(i)] |= b; }
  let count = 0; let first = null;
  function rec() {
    let best = -1, bestMask = 0, bestN = 10;
    for (let i = 0; i < 81; i++) if (!cells[i]) {
      const used = rows[Math.floor(i / 9)] | cols[i % 9] | boxes[box(i)];
      let n = 0; for (let d = 1; d <= 9; d++) if (!(used & (1 << d))) n++;
      if (n < bestN) { bestN = n; best = i; bestMask = used; if (n <= 1) break; }
    }
    if (best < 0) { count++; if (!first) first = Int8Array.from(cells); return count >= limit; }
    if (bestN === 0) return false;
    const r = Math.floor(best / 9), c = best % 9, b = box(best);
    const ds = []; for (let d = 1; d <= 9; d++) if (!(bestMask & (1 << d))) ds.push(d);
    for (let k = ds.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [ds[k], ds[j]] = [ds[j], ds[k]]; }
    for (const d of ds) {
      const bit = 1 << d; cells[best] = d; rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
      const stop = rec();
      cells[best] = 0; rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit;
      if (stop) return true;
    }
    return false;
  }
  rec();
  return { count, solution: first };
}
function generate(clues) {
  const full = solve(new Int8Array(81), 1).solution;
  const puzzle = Int8Array.from(full);
  const order = [...Array(81).keys()].sort(() => Math.random() - 0.5);
  let remaining = 81;
  const t0 = performance.now();
  for (const i of order) {
    if (remaining <= clues) break;
    if (performance.now() - t0 > 1500) break; // keep the terminal responsive
    const keep = puzzle[i]; puzzle[i] = 0;
    if (solve(Int8Array.from(puzzle), 2).count !== 1) puzzle[i] = keep; else remaining--;
  }
  return { puzzle, solution: full };
}

// ---- game ------------------------------------------------------------------
export async function mount(root, g) {
  let diff = g.params?.difficulty in CLUES ? g.params.difficulty : 'leicht';
  let puzzle, solution, cells, notes, cur = 40, noteMode = false, t0, timer = null, done = false, wrong = new Set();
  let boot = 0, dead = false;
  const board = h('div.term-sudoku');
  const timeEl = h('span.term-bright', '0:00'), bestEl = h('span'), modeEl = h('span');
  const msg = h('div.term-game-msg');
  const diffBtns = Object.keys(CLUES).map((k) => btn({ leicht: T('Leicht', 'Easy'), mittel: T('Mittel', 'Medium'), schwer: T('Schwer', 'Hard') }[k], () => { diff = k; start(); }, 'size'));
  root.appendChild(h('div.term-game-center',
    h('div.term-game-bar', h('span.term-prompt', T('Zeit', 'Time')), timeEl, h('span.term-prompt', 'Best'), bestEl, modeEl, h('span.spacer'), diffBtns, btn(T('Neu', 'New'), () => start())),
    h('div.term-sudoku-wrap', board,
      h('div.term-sudoku-side',
        btn(T('Prüfen (C)', 'Check (C)'), () => check()), btn(T('Notizen (N)', 'Notes (N)'), () => toggleNotes()), btn(T('Tipp (H)', 'Hint (H)'), () => hint()), btn(T('Lösen', 'Solve'), () => reveal()),
        h('div.term-dim.small', T('Ziffern eintragen · 0/⌫ löschen · Pfeile bewegen', 'type digits · 0/⌫ clear · arrows move')))),
    msg));

  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  function start() {
    msg.textContent = T('Erzeuge Rätsel …', 'Generating puzzle …');
    diffBtns.forEach((bt, i) => bt.classList.toggle('on', Object.keys(CLUES)[i] === diff));
    const b = g.best.get(diff); bestEl.textContent = b != null ? fmt(b) : '—';
    clearTimeout(boot);
    boot = setTimeout(() => {
      boot = 0;
      if (dead) return;                      // the player already left – do not install a new interval
      ({ puzzle, solution } = generate(CLUES[diff]));
      cells = Int8Array.from(puzzle); notes = Array.from({ length: 81 }, () => new Set()); done = false; wrong = new Set(); noteMode = false;
      cur = [...cells].findIndex((v) => !v); if (cur < 0) cur = 0;
      clearInterval(timer); t0 = Date.now(); timer = setInterval(() => { timeEl.textContent = fmt(Math.floor((Date.now() - t0) / 1000)); }, 1000); timeEl.textContent = '0:00';
      msg.textContent = ''; paintMode(); render();
    }, 20);
  }
  function paintMode() { modeEl.textContent = noteMode ? T('NOTIZEN', 'NOTES') : ''; }
  function toggleNotes() { noteMode = !noteMode; paintMode(); g.sfx.click(); }
  function render() {
    clear(board);
    const cv = cells[cur];
    for (let i = 0; i < 81; i++) {
      const r = Math.floor(i / 9), c = i % 9;
      const given = !!puzzle[i]; const v = cells[i];
      const cls = ['term-sudoku-cell', given ? 'given' : '', i === cur ? 'cur' : '', wrong.has(i) ? 'wrong' : '', cv && v === cv && i !== cur ? 'same' : '',
        (r === Math.floor(cur / 9) || c === cur % 9 || (Math.floor(r / 3) === Math.floor(Math.floor(cur / 9) / 3) && Math.floor(c / 3) === Math.floor((cur % 9) / 3))) ? 'peer' : '',
        c % 3 === 2 && c < 8 ? 'br' : '', r % 3 === 2 && r < 8 ? 'bb' : ''].filter(Boolean).join(' ');
      const content = v ? String(v) : notes[i].size ? h('div.term-sudoku-notes', [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => h('span', notes[i].has(d) ? String(d) : ''))) : '';
      board.appendChild(h('div', { class: cls, onmousedown: (e) => { e.preventDefault(); cur = i; render(); } }, content));
    }
  }
  function setDigit(d) {
    if (done || puzzle[cur]) { g.sfx.error(); return; }
    if (noteMode && d) { if (notes[cur].has(d)) notes[cur].delete(d); else notes[cur].add(d); cells[cur] = 0; }
    else { cells[cur] = d; wrong.delete(cur); if (d) { notes[cur].clear(); const r = Math.floor(cur / 9), c = cur % 9; for (let i = 0; i < 81; i++) if (Math.floor(i / 9) === r || i % 9 === c || (Math.floor(Math.floor(i / 9) / 3) === Math.floor(r / 3) && Math.floor((i % 9) / 3) === Math.floor(c / 3))) notes[i].delete(d); } }
    g.sfx.type(); render();
    if (!noteMode && cells.every((v, i) => v === solution[i])) finish();
  }
  function finish() { done = true; clearInterval(timer); const secs = Math.floor((Date.now() - t0) / 1000); g.sfx.click(); msg.textContent = T('Gelöst in {t}!', 'Solved in {t}!', { t: fmt(secs) }); if (g.best.set(secs, diff, false)) { bestEl.textContent = fmt(secs); msg.textContent += T(' Neue Bestzeit!', ' New best time!'); } }
  function check() { wrong = new Set(); for (let i = 0; i < 81; i++) if (cells[i] && cells[i] !== solution[i]) wrong.add(i); msg.textContent = wrong.size ? T('{n} Fehler markiert', '{n} errors marked', { n: wrong.size }) : T('Bisher alles richtig!', 'All correct so far!'); g.sfx.click(); render(); }
  function hint() { if (done) return; if (puzzle[cur] || cells[cur] === solution[cur]) { const i = [...cells].findIndex((v, k) => v !== solution[k]); if (i < 0) return; cur = i; } cells[cur] = solution[cur]; notes[cur].clear(); wrong.delete(cur); g.sfx.click(); render(); if (cells.every((v, i) => v === solution[i])) finish(); }
  function reveal() { cells = Int8Array.from(solution); done = true; clearInterval(timer); msg.textContent = T('Lösung angezeigt.', 'Solution shown.'); render(); }
  start();
  g.setHints([['1-9', T('Ziffer', 'digit')], ['N', T('Notizen', 'notes')], ['C', T('prüfen', 'check')], ['H', T('Tipp', 'hint')], ['Esc', T('Spiele', 'games')]]);
  return {
    unmount() { dead = true; clearTimeout(boot); clearInterval(timer); },
    onKey(e) {
      // while the puzzle is being generated swallow everything EXCEPT Escape, so the player can leave
      if (!cells) return e.key !== 'Escape';
      const k = e.key;
      if (k === 'ArrowLeft') { cur = (cur + 80) % 81; render(); return true; }
      if (k === 'ArrowRight') { cur = (cur + 1) % 81; render(); return true; }
      if (k === 'ArrowUp') { cur = (cur + 72) % 81; render(); e.preventDefault(); return true; }
      if (k === 'ArrowDown') { cur = (cur + 9) % 81; render(); e.preventDefault(); return true; }
      if (/^[1-9]$/.test(k)) { setDigit(+k); return true; }
      if (k === '0' || k === 'Backspace' || k === 'Delete') { if (!done && !puzzle[cur]) { cells[cur] = 0; notes[cur].clear(); wrong.delete(cur); render(); } else g.sfx.error(); return true; }
      if (k === 'n' || k === 'N') { toggleNotes(); return true; }
      if (k === 'c' || k === 'C') { check(); return true; }
      if (k === 'h' || k === 'H') { hint(); return true; }
      if (k === 'r' || k === 'R') { start(); return true; }
      return false;
    },
  };
}
