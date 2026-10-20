// Taktikaufgaben – Datenzugriff auf den mitgelieferten Rätselsatz (app/src/ui/chess/puzzle-data.js)
// und der Trainer, der am Schachtisch benutzt wird. Alles offline, kein Netz.
import { Chess } from 'chess.js';
import { h, clear } from '../../core/dom.js';
import { tr } from '../../core/i18n.js';
import { createChessBoard } from './chess-board.js';

export const THEMES = {
  mate1: { de: 'Matt in 1', en: 'Mate in 1' },
  mate2: { de: 'Matt in 2', en: 'Mate in 2' },
  mate: { de: 'Mattangriff', en: 'Mating attack' },
  fork: { de: 'Gabel', en: 'Fork' },
  'win-material': { de: 'Materialgewinn', en: 'Win material' },
  sacrifice: { de: 'Opfer', en: 'Sacrifice' },
  quiet: { de: 'Stiller Zug', en: 'Quiet move' },
  promotion: { de: 'Umwandlung', en: 'Promotion' },
  tactic: { de: 'Taktik', en: 'Tactic' },
};
export const LEVELS = [
  { id: 'all', label: { de: 'Alle', en: 'All' } },
  { id: 'easy', label: { de: 'Leicht', en: 'Easy' } },
  { id: 'medium', label: { de: 'Mittel', en: 'Medium' } },
  { id: 'hard', label: { de: 'Schwer', en: 'Hard' } },
];

/**
 * The three buckets are the terciles of the set, not fixed numbers – the bundled ratings are a
 * difficulty estimate, so hard-coded thresholds would leave one bucket empty.
 */
export function levelBounds(list) {
  const rs = list.map((p) => p.r).sort((a, b) => a - b);
  if (rs.length < 3) return { easy: Infinity, medium: Infinity };
  const q = (f) => rs[Math.min(rs.length - 1, Math.floor(rs.length * f))];
  return { easy: q(1 / 3), medium: q(2 / 3) };
}

let cache = null;
/** Lazily loads the bundled puzzle set. Returns { list, meta }. */
export async function loadPuzzles() {
  if (cache) return cache;
  try {
    const mod = await import('./puzzle-data.js');
    const list = (mod.default || []).filter(valid);
    cache = { list, meta: mod.meta || { count: list.length } };
  } catch (e) {
    console.warn('[chess] puzzle data missing', e);
    cache = { list: [], meta: { count: 0, error: String(e?.message || e) } };
  }
  return cache;
}
function valid(p) { return p && typeof p.f === 'string' && Array.isArray(p.s) && p.s.length % 2 === 1; }

export const puzzleId = (p) => p.f.split(' ').slice(0, 2).join(' ');
export const puzzleTurn = (p) => (p.f.split(' ')[1] === 'b' ? 'black' : 'white');

/** All puzzles matching the filter. */
export function filterPuzzles(list, { level = 'all', theme = 'all' } = {}, bounds) {
  const b = bounds || levelBounds(list);
  const inLevel = (r) => (level === 'easy' ? r <= b.easy : level === 'medium' ? r > b.easy && r <= b.medium : level === 'hard' ? r > b.medium : true);
  return list.filter((p) => inLevel(p.r) && (theme === 'all' || (p.t || []).includes(theme)));
}
/** Themes that actually occur in the set, most common first. */
export function themesOf(list) {
  const n = new Map();
  for (const p of list) for (const t of p.t || []) n.set(t, (n.get(t) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, count, label: THEMES[id] || { de: id, en: id } }));
}

// ---- progress (localStorage) -----------------------------------------------------------------
const KEY = 'lesesaal.chess.puzzles';
export function loadProgress() {
  try { return { solved: [], streak: 0, best: 0, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; }
  catch { return { solved: [], streak: 0, best: 0 }; }
}
export function saveProgress(p) { try { localStorage.setItem(KEY, JSON.stringify({ ...p, solved: (p.solved || []).slice(-800) })); } catch { /* ignore */ } }

/** Picks a puzzle, preferring ones the player has not solved yet. */
export function pickPuzzle(pool, progress, avoid) {
  if (!pool.length) return null;
  const done = new Set(progress.solved || []);
  const fresh = pool.filter((p) => !done.has(puzzleId(p)) && puzzleId(p) !== avoid);
  const from = fresh.length ? fresh : pool.filter((p) => puzzleId(p) !== avoid);
  const src = from.length ? from : pool;
  return src[(Math.random() * src.length) | 0];
}

// ---------------------------------------------------------------------------------------------
/**
 * Puzzle trainer UI.
 *   const t = createPuzzleTrainer(container, ctx);   →  { destroy(), onKey(e) }
 * The player makes the solving side's moves; the opponent's replies come from the stored line.
 */
export function createPuzzleTrainer(container, ctx) {
  const sfx = (n) => { try { ctx.audio?.sfx?.(n); } catch { /* ignore */ } };
  const boardHost = h('div.chess-puzzle-board');
  const lock = h('div.chess-puzzle-lock');
  const metaEl = h('div.chess-puzzle-meta');
  const statusEl = h('div.chess-puzzle-status');
  const scoreEl = h('div.chess-puzzle-score');
  const lineEl = h('div.chess-puzzle-line');
  const levelHost = h('div.chess-seg');
  const themeSel = h('select.input.chess-puzzle-theme');
  const actions = h('div.row.chess-row');
  const side = h('div.chess-puzzle-side',
    h('div.row.chess-row', h('span.small.muted', tr({ de: 'Schwierigkeit', en: 'Difficulty' })), levelHost),
    h('div.row.chess-row', h('span.small.muted', tr({ de: 'Thema', en: 'Theme' })), themeSel),
    metaEl, statusEl, lineEl, scoreEl, actions);
  const root = h('div.chess-puzzle',
    h('div.chess-puzzle-boardwrap', boardHost, lock), side);
  container.appendChild(root);

  let board = null, all = [], pool = [], progress = loadProgress();
  let puzzle = null, k = 0, solved = false, failed = false, suppress = false, revealed = false;
  let level = 'all', theme = 'all', unsub = null, destroyed = false;
  const timers = [];
  const later = (fn, ms) => { const t = setTimeout(() => { if (!destroyed) fn(); }, ms); timers.push(t); return t; };

  const btn = (label, onclick, cls = 'btn.small') => h('button.' + cls, { type: 'button', onclick: () => { sfx('click'); onclick(); } }, tr(label));
  const nextBtn = btn({ de: 'Nächste Aufgabe (N)', en: 'Next puzzle (N)' }, () => next(), 'btn.primary.small');
  const hintBtn = btn({ de: 'Tipp (H)', en: 'Hint (H)' }, () => hint());
  const retryBtn = btn({ de: 'Nochmal (R)', en: 'Retry (R)' }, () => retry());
  const solveBtn = btn({ de: 'Lösung zeigen', en: 'Show solution' }, () => reveal());
  actions.append(nextBtn, hintBtn, retryBtn, solveBtn);

  LEVELS.forEach((l) => {
    const b = h('button.chess-seg-btn', { type: 'button', dataset: { lv: l.id }, onclick: () => { level = l.id; sfx('click'); refilter(); next(); } }, tr(l.label));
    if (l.id === level) b.classList.add('active');
    levelHost.appendChild(b);
  });
  themeSel.addEventListener('change', () => { theme = themeSel.value; refilter(); next(); });

  function paintLevel() { levelHost.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.lv === level)); }
  let bounds = null;
  function refilter() {
    paintLevel();
    bounds = bounds || levelBounds(all);
    pool = filterPuzzles(all, { level, theme }, bounds);
    if (!pool.length) { pool = filterPuzzles(all, { level, theme: 'all' }, bounds); theme = 'all'; themeSel.value = 'all'; }
  }
  function paintScore() {
    clear(scoreEl);
    scoreEl.append(
      h('span.chess-puzzle-stat', h('b', String((progress.solved || []).length)), ' ', tr({ de: 'gelöst', en: 'solved' })),
      h('span.chess-puzzle-stat', h('b', String(progress.streak || 0)), ' ', tr({ de: 'in Folge', en: 'streak' })),
      h('span.chess-puzzle-stat.muted', tr({ de: 'Bestserie', en: 'best' }) + ': ' + (progress.best || 0)),
      h('span.chess-puzzle-stat.muted', `${pool.length} / ${all.length}`));
  }
  function paintMeta() {
    clear(metaEl);
    if (!puzzle) return;
    const th = (puzzle.t || []).map((t) => tr(THEMES[t] || { de: t, en: t })).join(' · ');
    metaEl.append(
      h('span.chess-puzzle-rating', String(puzzle.r)),
      h('span.chess-puzzle-themes', th),
      h('span.chess-puzzle-side-to-move', puzzleTurn(puzzle) === 'white' ? tr({ de: 'Weiß am Zug', en: 'White to move' }) : tr({ de: 'Schwarz am Zug', en: 'Black to move' })));
  }
  function paintLine() {
    clear(lineEl);
    if (!puzzle) return;
    if (!revealed && !solved) { lineEl.textContent = ''; return; }
    const c = new Chess(puzzle.f);
    const sans = [];
    for (const u of puzzle.s) {
      try { sans.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined }).san); }
      catch { break; }
    }
    lineEl.textContent = tr({ de: 'Lösung: ', en: 'Solution: ' }) + sans.join(' ');
  }

  function setLock(on) { lock.classList.toggle('on', !!on); }

  function show(p) {
    puzzle = p; k = 0; solved = false; failed = false; revealed = false;
    clear(boardHost);
    unsub?.(); board?.destroy();
    board = createChessBoard(boardHost, { mode: '2d', orientation: puzzleTurn(p), free: false, fen: p.f });
    unsub = board.onChange(onChange);
    root._puzzle = p; root._board = board;   // debug hook for build/dev-shot.js (see chess-board.js)
    setLock(false);
    statusEl.className = 'chess-puzzle-status';
    statusEl.textContent = tr({ de: 'Finde den besten Zug.', en: 'Find the best move.' });
    paintMeta(); paintLine(); paintScore();
  }
  function onChange(fen, d) {
    if (d.type !== 'move' || suppress || solved || revealed) return;
    const m = d.move;
    const uci = m.from + m.to + (m.promotion || '');
    sfx('chess-move');
    if (uci === puzzle.s[k]) {
      k++;
      if (k >= puzzle.s.length) { win(); return; }
      statusEl.className = 'chess-puzzle-status good';
      statusEl.textContent = '✓ ' + tr({ de: 'Richtig, weiter!', en: 'Correct – keep going!' });
      setLock(true);
      later(playReply, 420);
      return;
    }
    // a different mate is also a win
    const c = new Chess(fen);
    if (c.isCheckmate()) { win(true); return; }
    failed = true;
    sfx('error');
    statusEl.className = 'chess-puzzle-status bad';
    statusEl.textContent = '✗ ' + tr({ de: 'Nicht der beste Zug. Noch einmal.', en: 'Not the best move – try again.' });
    setLock(true);
    later(() => { suppress = true; board.undo(); suppress = false; setLock(false); }, 480);
  }
  function playReply() {
    const uci = puzzle.s[k];
    if (!uci) { setLock(false); return; }
    let san = null;
    try {
      const c = new Chess(board.getFen());
      san = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined }).san;
    } catch { setLock(false); return; }
    k++;
    suppress = true;
    board.playSan(san).then(() => {
      suppress = false;
      if (destroyed) return;
      setLock(false);
      statusEl.className = 'chess-puzzle-status';
      statusEl.textContent = tr({ de: 'Dein Zug …', en: 'Your move …' });
    }).catch(() => { suppress = false; setLock(false); });
  }
  function win(alternative) {
    solved = true; setLock(true);
    statusEl.className = 'chess-puzzle-status good';
    statusEl.textContent = '★ ' + (alternative ? tr({ de: 'Matt, auch gut!', en: 'Mate – that works too!' })
      : tr({ de: 'Gelöst!', en: 'Solved!' }) + (failed || revealed ? '' : tr({ de: ' Ohne Fehler.', en: ' Flawless.' })));
    sfx('open');
    const id = puzzleId(puzzle);
    if (!revealed) {
      const done = new Set(progress.solved || []);
      if (!done.has(id)) { progress.solved = [...(progress.solved || []), id]; }
      progress.streak = failed ? 0 : (progress.streak || 0) + 1;
      progress.best = Math.max(progress.best || 0, progress.streak);
      saveProgress(progress);
    }
    paintScore(); paintLine();
  }
  function hint() {
    if (!puzzle || solved) return;
    const uci = puzzle.s[k];
    if (!uci) return;
    try { board.setShapes([{ orig: uci.slice(0, 2), brush: 'green' }]); } catch { /* ignore */ }
    statusEl.className = 'chess-puzzle-status';
    statusEl.textContent = tr({ de: 'Tipp: Die Figur auf {sq} macht den Zug.', en: 'Hint: the piece on {sq} makes the move.' }, { sq: uci.slice(0, 2) });
  }
  function retry() {
    if (!puzzle) return;
    timers.splice(0).forEach(clearTimeout);
    show(puzzle);
  }
  function reveal() {
    if (!puzzle || solved) return;
    revealed = true; setLock(true);
    timers.splice(0).forEach(clearTimeout);
    suppress = true;
    board.setFen(puzzle.f);
    const c = new Chess(puzzle.f);
    const sans = [];
    for (const u of puzzle.s) {
      try { sans.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined }).san); } catch { break; }
    }
    board.playSan(sans.join(' ')).catch(() => {}).then(() => { suppress = false; });
    progress.streak = 0; saveProgress(progress);
    statusEl.className = 'chess-puzzle-status';
    statusEl.textContent = tr({ de: 'Lösung wird gezeigt.', en: 'Showing the solution.' });
    paintLine(); paintScore();
  }
  function next() {
    timers.splice(0).forEach(clearTimeout);
    const p = pickPuzzle(pool, progress, puzzle ? puzzleId(puzzle) : null);
    if (!p) {
      clear(boardHost);
      statusEl.textContent = tr({ de: 'Keine Aufgabe für diese Auswahl.', en: 'No puzzle matches this selection.' });
      return;
    }
    show(p);
  }

  (async () => {
    statusEl.textContent = tr({ de: 'Lade Aufgaben …', en: 'Loading puzzles …' });
    const { list, meta } = await loadPuzzles();
    if (destroyed) return;
    all = list;
    if (!all.length) {
      statusEl.textContent = tr({ de: 'Keine Aufgabendatei gefunden. Erzeuge sie mit „node app/src/ui/chess/generate-puzzles.js“.',
        en: 'No puzzle file found. Generate it with “node app/src/ui/chess/generate-puzzles.js”.' });
      return;
    }
    clear(themeSel);
    themeSel.appendChild(h('option', { value: 'all' }, tr({ de: 'Alle Themen', en: 'All themes' })));
    for (const t of themesOf(all)) themeSel.appendChild(h('option', { value: t.id }, `${tr(t.label)} (${t.count})`));
    refilter();
    side.appendChild(h('div.small.muted.chess-puzzle-note',
      tr({ de: '{n} Stellungen, mit Stockfish bis Tiefe {d} geprüft.', en: '{n} positions, verified with Stockfish to depth {d}.' },
        { n: all.length, d: meta.depth || '?' })));
    next();
  })();

  return {
    el: root,
    destroy() {
      destroyed = true;
      timers.splice(0).forEach(clearTimeout);
      unsub?.(); unsub = null;
      board?.destroy(); board = null;
      root.remove();
    },
    onKey(e) {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return false;
      const l = e.key.toLowerCase();
      if (l === 'n') { next(); return true; }
      if (l === 'h') { hint(); return true; }
      if (l === 'r') { retry(); return true; }
      if (l === 's') { reveal(); return true; }
      return false;
    },
  };
}
