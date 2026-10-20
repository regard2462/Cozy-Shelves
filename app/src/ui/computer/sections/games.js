// SPIELE – the games as cards in four groups, and the host that runs one. Each game lives in ../games/<name>.js and
// exports mount(el, g) → { unmount, onKey }. Opening and leaving a game are steps of the computer's history.
import { h, clear } from '../../../core/dom.js';
import { keyList, makeBest, store, T, notice, isEditable, shortcutLabel, shortcutIndex, shortcutRange, icon } from '../terminal.js';

/** In the order of the cards (the keys 1–9, A–E follow it). */
export const GAMES = [
  { id: 'chess', group: 'board', glyph: '♞', name: { de: 'Schach gegen Stockfish', en: 'Chess vs Stockfish' }, desc: { de: 'Farbe und Stärke wählen, Partie spielen', en: 'pick colour and strength, play a game' }, load: () => import('../games/chess-vs-engine.js') },
  { id: 'go', group: 'board', glyph: '●', name: { de: 'Go (Baduk)', en: 'Go (Baduk)' }, desc: { de: '9×9 bis 19×19, Ko-Regel, Computergegner', en: '9×9 to 19×19, ko rule, computer opponent' }, load: () => import('../games/go.js') },
  { id: 'reversi', group: 'board', glyph: '◐', name: { de: 'Reversi (Othello)', en: 'Reversi (Othello)' }, desc: { de: 'Steine wenden, Ecken sichern', en: 'flip discs, take the corners' }, load: () => import('../games/reversi.js') },
  { id: 'mill', group: 'board', glyph: '▣', name: { de: 'Mühle', en: "Nine Men's Morris" }, desc: { de: 'Setzen, ziehen, springen, Mühlen schließen', en: 'place, move, fly, close your mills' }, load: () => import('../games/mill.js') },
  { id: 'draughts', group: 'board', glyph: '⛂', name: { de: 'Dame', en: 'Draughts' }, desc: { de: '8×8, Schlagzwang, Damen', en: '8×8, forced captures, kings' }, load: () => import('../games/draughts.js') },
  { id: 'mastermind', group: 'puzzle', glyph: '◉', name: { de: 'Mastermind', en: 'Mastermind' }, desc: { de: 'Farbcode in zehn Versuchen knacken', en: 'crack the colour code in ten tries' }, load: () => import('../games/mastermind.js') },
  { id: 'sudoku', group: 'puzzle', glyph: '▦', name: { de: 'Sudoku', en: 'Sudoku' }, desc: { de: 'Drei Schwierigkeiten, Notizen, Prüfung', en: 'three difficulties, notes, check' }, load: () => import('../games/sudoku.js') },
  { id: 'mines', group: 'puzzle', glyph: '✹', name: { de: 'Minensuche', en: 'Minesweeper' }, desc: { de: 'Drei Größen, Flaggen setzen', en: 'three sizes, plant flags' }, load: () => import('../games/minesweeper.js') },
  { id: '2048', group: 'puzzle', glyph: '2048', name: { de: '2048', en: '2048' }, desc: { de: 'Kacheln schieben, Zahlen verdoppeln', en: 'slide tiles, double numbers' }, load: () => import('../games/2048.js') },
  { id: 'memory', group: 'puzzle', glyph: '❐', name: { de: 'Memory', en: 'Memory' }, desc: { de: 'Paare finden mit deinen Buchcovern', en: 'find pairs with your book covers' }, load: () => import('../games/memory.js') },
  { id: 'solitaire', group: 'classic', glyph: '♠', name: { de: 'Solitär (Klondike)', en: 'Solitaire (Klondike)' }, desc: { de: 'Klicken oder ziehen, Rückgängig', en: 'click or drag, undo' }, load: () => import('../games/solitaire.js') },
  { id: 'snake', group: 'classic', glyph: '∿', name: { de: 'Schlange', en: 'Snake' }, desc: { de: 'Pfeiltasten, immer schneller', en: 'arrow keys, ever faster' }, load: () => import('../games/snake.js') },
  { id: 'blocks', group: 'classic', glyph: '▚', name: { de: 'Blöcke', en: 'Blocks' }, desc: { de: 'Fallende Steine, Reihen räumen', en: 'falling pieces, clear lines' }, load: () => import('../games/blocks.js') },
  { id: 'lichess', group: 'online', glyph: '♛', online: true, name: { de: 'Lichess: Rätsel, TV, Studien', en: 'Lichess: puzzles, TV, studies' }, desc: { de: 'Tagesrätsel, Zufallsrätsel, live zuschauen', en: 'daily puzzle, random puzzle, watch live' }, load: () => import('../games/lichess.js') },
];
const GROUPS = [
  ['board', { de: 'Brettspiele', en: 'Board games' }],
  ['puzzle', { de: 'Denkspiele', en: 'Puzzles' }],
  ['classic', { de: 'Klassiker', en: 'Classics' }],
  ['online', { de: 'Online', en: 'Online' }],
];

export async function mount(root, s, params = {}) {
  const { ctx, sfx } = s;
  const el = h('div.term-games');
  root.appendChild(el);
  let list = null, game = null, disposed = false;

  const VARIANT = {
    klein: { de: 'klein', en: 'small' }, mittel: { de: 'mittel', en: 'medium' }, gross: { de: 'groß', en: 'large' },
    leicht: { de: 'leicht', en: 'easy' }, schwer: { de: 'schwer', en: 'hard' },
    9: { de: '9×9', en: '9×9' }, 13: { de: '13×13', en: '13×13' }, 19: { de: '19×19', en: '19×19' },
  };
  const mmss = (v) => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
  const FMT = {
    mines: (v, k) => `${ctx.i18n.tr(VARIANT[k] || { de: k })} ${v} s`,
    sudoku: (v, k) => `${ctx.i18n.tr(VARIANT[k] || { de: k })} ${mmss(v)}`,
    memory: (v) => `${v} ${T('Züge', 'moves')}`,
    solitaire: (v) => `${v} ${T('Züge', 'moves')}`,
    chess: (v, k) => (k === 'wins' ? `${v} ${T('Siege', 'wins')}` : null),
    go: (v, k) => (/^\d+$/.test(k) ? `${ctx.i18n.tr(VARIANT[k] || { de: k })}: ${v} ${T('Siege', 'wins')}` : null),
    reversi: (v, k) => (k === 'wins' ? `${v} ${T('Siege', 'wins')}` : null),
    mill: (v, k) => (k === 'wins' ? `${v} ${T('Siege', 'wins')}` : null),
    draughts: (v, k) => (k === 'wins' ? `${v} ${T('Siege', 'wins')}` : null),
    mastermind: (v) => `${v} ${T('Versuche', 'guesses')}`,
    lichess: (v, k) => (k === 'puzzles' ? `${v} ${T('Rätsel gelöst', 'puzzles solved')}` : null),
  };
  function bestSummary(id) {
    const fmt = FMT[id] || ((v) => String(v));
    const direct = store('best.' + id);
    if (direct != null) return fmt(direct, '') || '';
    try {
      const pre = 'lesesaal.term.best.' + id + '.';
      const parts = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(pre)) { const t = fmt(JSON.parse(localStorage.getItem(k)), k.slice(pre.length)); if (t) parts.push(t); } }
      return parts.slice(0, 2).join(' · ');
    } catch { return ''; }
  }

  function showMenu() {
    clear(el); game = null;
    delete params.game;                 // keeps a language switch on the menu (see computer-panel.js)
    s.setCrumbs(T('Spiele', 'Games'));
    const cards = [];
    for (const [gid, glabel] of GROUPS) {
      const inGroup = GAMES.map((g, i) => ({ g, i })).filter(({ g }) => g.group === gid);
      if (!inGroup.length) continue;
      const grid = h('div.term-game-grid');
      for (const { g, i } of inGroup) {
        const best = bestSummary(g.id);
        const card = h('div.term-game-card', { dataset: { id: g.id }, role: 'button', title: ctx.i18n.tr(g.desc) },
          h('span.term-game-glyph', { class: g.glyph.length > 2 ? 'text' : '' }, g.glyph),
          h('span.term-game-body',
            h('span.term-game-name', ctx.i18n.tr(g.name)),
            h('span.term-game-desc', ctx.i18n.tr(g.desc)),
            best ? h('span.term-game-best', icon('check'), best) : g.online ? h('span.term-game-online', icon('browser'), T('braucht Internet', 'needs internet')) : null),
          h('kbd.term-key', shortcutLabel(i)));
        cards[i] = card;
        grid.appendChild(card);
      }
      el.append(h('h3.term-h', ctx.i18n.tr(glabel)), grid);
    }
    el.appendChild(h('p.term-dim.term-games-note', T('Alle Spiele sind selbst geschrieben, ohne fremde Grafiken oder Klänge.', 'All games are home-made, without outside graphics or sounds.')));
    list = keyList(cards, { spatial: true, onEnter: (row) => { sfx.click(); openGame(row.dataset.id); } });
    list.set(0, false);
    s.setHints([['↑↓←→', T('wählen', 'select')], ['⏎', T('spielen', 'play')], [shortcutRange(GAMES.length), T('direkt', 'direct')], ['Esc', T('zurück', 'back')]]);
    s.focusScreen();
  }

  /** record=false: the step comes from the history (back/forward) */
  async function openGame(id, gparams = {}, { record = true } = {}) {
    const def = GAMES.find((g) => g.id === id); if (!def) return;
    if (record) s.nav.push({ game: id });
    clear(el); list = null;
    const head = h('div.term-game-head', h('span.term-game-glyph.small', { class: def.glyph.length > 2 ? 'text' : '' }, def.glyph), h('span.term-game-title', ctx.i18n.tr(def.name)), h('span.spacer'), h('span.term-game-side'));
    const body = h('div.term-game-body');
    el.append(head, body);
    body.appendChild(notice(T('Wird geladen …', 'Loading …')));
    s.setCrumbs({ label: T('Spiele', 'Games'), go: () => closeGame() }, ctx.i18n.tr(def.name));
    game = { id, inst: null };
    params.game = id;                   // so an i18n re-render re-opens the same game
    const g = {
      ctx, sfx, T, tr: ctx.i18n.tr, best: makeBest(id), toast: (m) => ctx.toast?.(m),
      setHints: s.setHints, setSide: (t) => { head.querySelector('.term-game-side').textContent = t || ''; },
      back: () => { sfx.click(); closeGame(); }, focus: s.focusScreen, params: gparams,
      // colour accessors for the canvas games: the panel's tokens (they follow the appearance)
      phosphor: () => getComputedStyle(s.panel).getPropertyValue('--t-fg').trim() || '#2a2724',
      phosphorDim: () => getComputedStyle(s.panel).getPropertyValue('--t-dim').trim() || '#6b655e',
      phosphorBg: () => getComputedStyle(s.panel).getPropertyValue('--t-bg2').trim() || '#f4f2ee',
      accent: () => getComputedStyle(s.panel).getPropertyValue('--t-accent').trim() || '#1f6f6b',
    };
    try {
      const mod = await def.load();
      if (disposed || game?.id !== id) return;
      clear(body);
      const inst = await mod.mount(body, g);
      if (game?.id === id) game.inst = inst || {}; else inst?.unmount?.();
    } catch (e) {
      console.error('[games] failed', id, e);
      clear(body);
      body.appendChild(notice(T('Spiel konnte nicht geladen werden: ', 'Could not load game: ') + (e?.message || e)));
    }
    s.focusScreen();
  }
  /** Esc, the crumb and "Zurück" in a game: back when the menu is the step before, else a new step to the menu. */
  function closeGame({ record = true } = {}) {
    if (record) {
      const prev = s.nav.peek(-1);
      if (prev && prev.id === 'games' && !prev.params?.game) { try { game?.inst?.unmount?.(); } catch (e) { console.error(e); } game = null; s.nav.back(); return; }
      s.nav.push({});
    }
    try { game?.inst?.unmount?.(); } catch (e) { console.error(e); }
    showMenu();
  }

  if (params.game) openGame(params.game, params, { record: false }); else showMenu();

  return {
    unmount() { disposed = true; try { game?.inst?.unmount?.(); } catch (e) { console.error(e); } },
    navigate(p) {
      if (p.game) { if (game?.id !== p.game) { try { game?.inst?.unmount?.(); } catch (e) { console.error(e); } openGame(p.game, {}, { record: false }); } }
      else if (game) closeGame({ record: false });
      else if (!list) showMenu();
      return true;
    },
    onKey(e) {
      if (game) {
        if (game.inst?.onKey) { try { if (game.inst.onKey(e) === true) return true; } catch (err) { console.error(err); } }
        if (e.key === 'Escape') { if (isEditable(e.target)) { e.target.blur(); s.focusScreen(); return true; } sfx.click(); closeGame(); return true; }
        return true; // inside a game no key reaches the terminal menus
      }
      if (isEditable(e.target)) return false;
      const i = shortcutIndex(e);
      if (i >= 0 && GAMES[i]) { sfx.click(); openGame(GAMES[i].id); return true; }
      if (list && list.onKey(e)) { e.preventDefault(); return true; }
      return false;
    },
  };
}
