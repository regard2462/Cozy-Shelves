// Chess panel: recreate positions from chess books – board (2D/3D), move entry, FEN, Stockfish, saved positions.
//   openPanel('chess', { bookId?, location?, fen?, embedded? })
//   createChessSidebar(container, ctx, { bookId, location }) → { destroy, setLocation, onKey, board }
import { Chess } from 'chess.js';
import { h, clear, formatDate } from '../../core/dom.js';
import { tr, i18n } from '../../core/i18n.js';
import { bus } from '../../core/bus.js';
import { createChessBoard } from './chess-board.js';
import { acquireEngine, releaseEngine, formatScore, scoreToBar } from './engine.js';
import { figurine, formatMoves } from './san.js';
import { createEnginePlay } from './play-engine.js';
import { createPuzzleTrainer } from './puzzles.js';
import { createRecognition } from './diagram-ui.js';

const MODES = [
  { id: 'play', icon: '♟', label: { de: 'Gegen Stockfish spielen', en: 'Play Stockfish' }, hint: { de: 'N neue Partie · U zurück · H Tipp · F drehen', en: 'N new game · U undo · H hint · F flip' } },
  { id: 'puzzles', icon: '✦', label: { de: 'Taktikaufgaben', en: 'Tactics' }, hint: { de: 'N nächste · H Tipp · R nochmal · S Lösung', en: 'N next · H hint · R retry · S solution' } },
  { id: 'book', icon: '❧', label: { de: 'Stellungen aus dem Buch', en: 'Positions from the book' }, hint: { de: '←→ Züge · F drehen', en: '←→ moves · F flip' } },
];

export async function mount(container, ctx, params = {}) {
  if (params.embedded) {
    const sb = createChessSidebar(container, ctx, params);
    return { unmount: () => sb.destroy(), onKey: (e) => sb.onKey(e) };
  }
  const header = h('div.panel-header.chess-header');
  const stage = h('div.panel-body.chess-stage');
  const footer = h('div.chess-footer');
  const panel = h('div.panel.paper.chess-panel.chess-panel-tabs', header, stage, footer);
  container.appendChild(panel);

  const tabsEl = h('div.chess-modes', { role: 'tablist' });
  const relabel = [];
  header.append(h('span.chess-title', '♞ ', (() => { const el = h('span', tr({ de: 'Schachtisch', en: 'Chess table' })); relabel.push(() => { el.textContent = tr({ de: 'Schachtisch', en: 'Chess table' }); }); return el; })()),
    tabsEl, h('span.spacer'),
    h('button.btn.small.icon.chess-close', { type: 'button', title: tr({ de: 'Schließen (Esc)', en: 'Close (Esc)' }), onclick: () => { ctx.audio?.sfx?.('click'); ctx.close?.(); } }, '✕'));

  let mode = MODES.some((m) => m.id === params.mode) ? params.mode : (params.fen || params.bookId ? 'book' : 'play');
  let current = null;   // { destroy(), onKey(e) }
  const tabBtns = MODES.map((m) => {
    const label = h('span', tr(m.label));
    relabel.push(() => { label.textContent = tr(m.label); });
    const b = h('button.chess-mode', { type: 'button', role: 'tab', dataset: { mode: m.id }, onclick: () => { ctx.audio?.sfx?.('click'); setMode(m.id); } }, h('span.chess-mode-icon', m.icon), label);
    tabsEl.appendChild(b);
    return b;
  });
  const footHint = h('span.small.muted');
  footer.append(footHint);

  function paintTabs() {
    tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    const m = MODES.find((x) => x.id === mode);
    footHint.textContent = m ? tr(m.hint) + ' · ' + tr({ de: 'Esc schließt', en: 'Esc closes' }) : '';
  }
  function setMode(id) {
    if (current && mode === id) return;
    mode = id;
    try { current?.destroy?.(); } catch (e) { console.error(e); }
    current = null;
    clear(stage);
    stage.classList.toggle('book', id === 'book');
    paintTabs();
    if (id === 'play') current = createEnginePlay(stage, ctx);
    else if (id === 'puzzles') current = createPuzzleTrainer(stage, ctx);
    else {
      const toolbar = h('div.chess-toolbar');
      const host = h('div.chess-body');
      stage.append(toolbar, host);
      const ui = buildChessUI({ toolbarHost: toolbar, host, ctx, params, compact: false, title: false });
      current = { destroy: () => ui.destroy(), onKey: (e) => ui.onKey(e) };
    }
  }
  const offLang = bus.on('i18n:change', () => { relabel.forEach((f) => f()); paintTabs(); });
  setMode(mode);

  return {
    unmount() { offLang?.(); try { current?.destroy?.(); } catch (e) { console.error(e); } },
    onKey(e) {
      if (current?.onKey?.(e) === true) return true;
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return false;
      if (/^[1-3]$/.test(e.key)) { setMode(MODES[+e.key - 1].id); return true; }
      return false;
    },
  };
}

export function createChessSidebar(container, ctx, params = {}) {
  const root = h('div.chess-sidebar');
  container.appendChild(root);
  const toolbar = h('div.chess-toolbar.compact');
  const host = h('div.chess-body.compact');
  root.append(toolbar, host);
  const ui = buildChessUI({ toolbarHost: toolbar, host, ctx, params, compact: true, title: false });
  return { destroy() { ui.destroy(); root.remove(); }, setLocation: ui.setLocation, onKey: ui.onKey, board: ui.board, el: root, recognition: ui.recognition };
}

// ---------------------------------------------------------------------------------------------
function buildChessUI({ toolbarHost, host, ctx, params, compact, title }) {
  const audio = ctx.audio;
  const click = () => audio?.sfx?.('click');
  const toast = (m) => ctx.toast?.(m);
  const relabel = [];
  const L = (obj, tag = 'span') => { const el = h(tag, tr(obj)); relabel.push(() => { el.textContent = tr(obj); }); return el; };
  const unsubI18n = bus.on('i18n:change', () => { relabel.forEach((f) => f()); renderMoves(); renderStatus(); renderPositions(); if (engineOn) analyse(); });
  let location = params.location || null;
  let bookId = params.bookId || null;
  let book = null;

  // ---- toolbar ----
  const btn = (label, onclick, cls = 'btn.small', titleObj) => {
    const b = h('button.' + cls, { type: 'button', title: titleObj ? tr(titleObj) : undefined, onclick: (e) => { click(); onclick(e); } }, typeof label === 'string' ? label : L(label));
    if (titleObj) relabel.push(() => { b.title = tr(titleObj); });
    return b;
  };
  const modeSeg = h('div.chess-seg',
    h('button.chess-seg-btn.active', { type: 'button', dataset: { mode: '2d' }, onclick: () => setMode('2d') }, '2D'),
    h('button.chess-seg-btn', { type: 'button', dataset: { mode: '3d' }, onclick: () => setMode('3d') }, '3D'));
  const freeSeg = h('div.chess-seg',
    h('button.chess-seg-btn.active', { type: 'button', dataset: { free: '0' }, onclick: () => setFree(false) }, L({ de: 'Regeln', en: 'Rules' })),
    h('button.chess-seg-btn', { type: 'button', dataset: { free: '1' }, onclick: () => setFree(true) }, L({ de: 'Frei', en: 'Free' })));
  const flipBtn = btn('⟲', () => board.flip(), 'btn.small.icon.chess-tb-icon', { de: 'Brett drehen (F)', en: 'Flip board (F)' });
  const startBtn = btn({ de: 'Start', en: 'Start' }, () => { board.reset(); try { board.setFree(false); } catch (e) { toast(e.message); } syncFreeUI(); }, 'btn.small', { de: 'Grundstellung', en: 'Starting position' });
  const clearBtn = btn({ de: 'Leeren', en: 'Clear' }, () => board.clear(), 'btn.small', { de: 'Leeres Brett (freier Modus)', en: 'Empty board (free mode)' });
  const undoBtn = btn({ de: 'Zurück', en: 'Undo' }, () => { if (!board.undo()) toast(tr({ de: 'Nichts rückgängig zu machen', en: 'Nothing to undo' })); }, 'btn.small', { de: 'Letzten Zug / letzte Änderung zurücknehmen', en: 'Undo last move / edit' });

  if (title) {
    toolbarHost.append(h('span.chess-title', '♞ ', L({ de: 'Schachbrett', en: 'Chessboard' })));
  }
  // in the reader: cut a diagram out of the book page (reader-snip.js), like the Windows Snipping Tool
  const snipBtn = params.onSnip ? btn('', () => params.onSnip(), 'btn.small.chess-snip-btn', { de: 'Diagramm aus dem Buch ausschneiden und erkennen (D)', en: 'Cut a diagram out of the book and read it (D)' }) : null;
  if (snipBtn) snipBtn.append(h('span.chess-snip-icon', { 'aria-hidden': 'true' }), L({ de: 'Diagramm', en: 'Diagram' }));
  toolbarHost.append(modeSeg, flipBtn, freeSeg, ...(snipBtn ? [snipBtn] : []), h('span.spacer'), startBtn, clearBtn, undoBtn);
  if (title) toolbarHost.append(h('button.btn.small.icon.chess-close', { type: 'button', title: tr({ de: 'Schließen (Esc)', en: 'Close (Esc)' }), onclick: () => { click(); ctx.close?.(); } }, '✕'));

  // ---- body: board + side column ----
  const boardCol = h('div.chess-board-col');
  const side = h('div.chess-side');
  host.append(boardCol, side);

  const board = createChessBoard(boardCol, { mode: '2d', orientation: 'white', free: false, fen: params.fen || undefined });

  // ---- side: move entry ----
  // the example in the field uses the letters of the app's language (S, L, T, D in German; N, B, R, Q in English)
  const MOVES_EXAMPLE = { de: '1.e4 e5 2.Sf3 Sc6 3.Lb5 a6 …', en: '1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 …' };
  const moveInput = h('textarea.input.chess-move-input', { rows: compact ? 2 : 3, placeholder: tr(MOVES_EXAMPLE), spellcheck: false });
  relabel.push(() => { moveInput.placeholder = tr(MOVES_EXAMPLE); });
  const moveError = h('div.chess-error.hidden');
  const playBtn = btn({ de: 'Nachspielen', en: 'Play moves' }, () => playMoves(), 'btn.primary.small');
  const appendBtn = btn({ de: 'Anhängen', en: 'Append' }, () => playMoves(true), 'btn.small', { de: 'Züge an die aktuelle Stellung anhängen', en: 'Append moves to the current position' });
  moveInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); playMoves(); } });
  const entrySection = section({ de: 'Züge aus dem Buch eingeben', en: 'Enter moves from the book' },
    moveInput,
    h('div.row.chess-row', playBtn, appendBtn, h('span.small.muted.chess-hint', L({ de: 'Deutsch (S, L, T, D) oder Englisch, 0-0, Strg+Enter', en: 'German (S, L, T, D) or English, 0-0, Ctrl+Enter' }))),
    moveError);

  // ---- side: move list ----
  const status = h('div.chess-status');
  const TURN_TITLE = { de: 'Seite am Zug wechseln', en: 'Switch side to move' };
  const turnChip = h('button.chess-turn', { type: 'button', title: tr(TURN_TITLE), onclick: () => { click(); try { board.setTurn(board.turn() === 'white' ? 'black' : 'white'); } catch (e) { toast(e.message); } } });
  relabel.push(() => { turnChip.title = tr(TURN_TITLE); });
  const movesEl = h('div.chess-moves');
  const nav = h('div.chess-nav',
    btn('⏮', () => board.goTo(0), 'btn.small.icon', { de: 'Anfang', en: 'Start' }),
    btn('◀', () => board.back(), 'btn.small.icon', { de: 'Zug zurück (←)', en: 'Previous move (←)' }),
    btn('▶', () => board.forward(), 'btn.small.icon', { de: 'Zug vor (→)', en: 'Next move (→)' }),
    btn('⏭', () => board.goTo(board.history().length), 'btn.small.icon', { de: 'Ende', en: 'End' }));
  const movesSection = section({ de: 'Züge', en: 'Moves' }, h('div.row.chess-row', turnChip, status, h('span.spacer'), nav), movesEl);

  // ---- side: FEN ----
  const fenInput = h('input.input.chess-fen', { type: 'text', spellcheck: false, value: board.getFen() });
  fenInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyFen(); });
  const fenSection = section({ de: 'FEN', en: 'FEN' },
    fenInput,
    h('div.row.chess-row',
      btn({ de: 'Übernehmen', en: 'Apply' }, () => applyFen(), 'btn.small'),
      btn({ de: 'Kopieren', en: 'Copy' }, () => copyText(board.getFen(), { de: 'FEN kopiert', en: 'FEN copied' }), 'btn.small'),
      btn({ de: 'Züge kopieren', en: 'Copy moves' }, () => copyText(movesAsText(), { de: 'Züge kopiert', en: 'Moves copied' }), 'btn.small')));

  // ---- side: engine ----
  const engineToggle = h('div.toggle', { onclick: () => { click(); setEngine(!engineOn); } });
  const evalBar = h('div.chess-evalbar', h('div.chess-evalbar-white'));
  const evalText = h('div.chess-eval-text', '');
  const evalLine = h('div.chess-eval-line', '');
  const engineBody = h('div.chess-engine-body.hidden', h('div.row.chess-row', evalBar, evalText), evalLine);
  const engineSection = section({ de: 'Stockfish-Analyse', en: 'Stockfish analysis' }, engineBody, { toggle: engineToggle });

  // ---- side: book positions ----
  const posList = h('div.list.chess-positions');
  const saveBtn = btn({ de: 'Stellung zum Buch speichern', en: 'Save position to book' }, () => startSave(), 'btn.primary.small');
  const saveRow = h('div.chess-save-row.hidden');
  const bookTitle = h('div.small.muted.chess-book-title');
  const bookSection = section({ de: 'Stellungen zum Buch', en: 'Positions for this book' }, bookTitle, h('div.row.chess-row', saveBtn), saveRow, posList);
  bookSection.classList.toggle('hidden', !bookId);

  side.append(entrySection, movesSection, fenSection, engineSection, bookSection);
  // the card of a recognised diagram, at the top of the side column (only with the snip)
  const recognition = params.onSnip ? createRecognition(side, board, { bookId, click, onClose: () => {} }) : null;

  function section(labelObj, ...children) {
    let opts = {};
    if (children.length && children[children.length - 1] && !(children[children.length - 1] instanceof Node) && typeof children[children.length - 1] === 'object') opts = children.pop();
    const head = h('div.chess-section-head', L(labelObj, 'h3'), h('span.spacer'), opts.toggle || null);
    return h('section.chess-section', head, ...children);
  }

  // ---- actions ----
  function setMode(mode) {
    click();
    modeSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    board.setMode(mode).catch((e) => { console.error(e); toast(tr({ de: '3D-Ansicht nicht verfügbar', en: '3D view not available' }) + ': ' + e.message); setModeUI('2d'); });
  }
  function setModeUI(mode) { modeSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode)); }
  function setFree(flag) {
    click();
    try { board.setFree(flag); }
    catch (e) { toast(e.message); }
    syncFreeUI();
  }
  function syncFreeUI() {
    const free = board.isFree();
    freeSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', (b.dataset.free === '1') === free));
    entrySection.classList.toggle('chess-dim', free);
  }
  async function playMoves(append = false) {
    const text = moveInput.value.trim();
    moveError.classList.add('hidden');
    if (!text) return;
    if (!append) {
      // restart from the position the user set up (root of the current line) – i.e. from the current
      // board if no moves were played yet, otherwise from the beginning of the move list
      if (board.history().length) board.goTo(0);
    }
    try {
      const n = await board.playSan(text);
      toast(tr({ de: '{n} Züge nachgespielt', en: '{n} moves played' }, { n }));
    } catch (e) {
      moveError.textContent = e.message + (e.applied != null ? ' · ' + tr({ de: '{n} Züge gespielt', en: '{n} moves played' }, { n: e.applied }) : '');
      moveError.classList.remove('hidden');
      audio?.sfx?.('error');
    }
    syncFreeUI();
  }
  function applyFen() {
    click();
    try { board.setFen(fenInput.value); fenInput.classList.remove('invalid'); }
    catch (e) { fenInput.classList.add('invalid'); toast(e.message); }
  }
  async function copyText(text, msgObj) {
    click();
    try { await navigator.clipboard.writeText(text); toast(tr(msgObj)); }
    catch (e) { fenInput.value = text; fenInput.select(); }
  }
  function movesAsText() {
    const hist = board.history();
    if (!hist.length) return '';
    const start = new Chess(hist[0].fen); // fen after the first move → derive number of the first move
    const firstMoveNo = Math.max(1, hist[0].color === 'w' ? start.moveNumber() : start.moveNumber() - 1);
    return formatMoves(hist.map((m) => m.san), { startMove: firstMoveNo, startColor: hist[0].color });
  }

  // ---- move list rendering ----
  function renderMoves() {
    clear(movesEl);
    const hist = board.history();
    const ply = board.getPly();
    if (board.isFree()) { movesEl.appendChild(h('div.small.muted', L({ de: 'Freier Modus: Figuren beliebig setzen, dann „Regeln“ für Züge.', en: 'Free mode: place pieces anywhere, then switch to “Rules” to play moves.' }))); return; }
    if (!hist.length) { movesEl.appendChild(h('div.small.muted', L({ de: 'Noch keine Züge. Ziehe eine Figur oder gib Züge ein.', en: 'No moves yet – drag a piece or enter moves.' }))); return; }
    let moveNo = null;
    try { const c = new Chess(hist[0].fen); moveNo = hist[0].color === 'w' ? c.moveNumber() : c.moveNumber() - 1; } catch (e) { moveNo = 1; }
    const startEl = h('span.chess-move.chess-move-start', { class: ply === 0 ? 'current' : '', onclick: () => { click(); board.goTo(0); } }, '⌂');
    movesEl.appendChild(startEl);
    hist.forEach((m, i) => {
      if (m.color === 'w' || i === 0) movesEl.appendChild(h('span.chess-move-no', moveNo + (m.color === 'w' ? '.' : '…')));
      const el = h('span.chess-move', { class: m.ply === ply ? 'current' : '', onclick: () => { click(); board.goTo(m.ply); } }, figurine(m.san, m.color));
      movesEl.appendChild(el);
      if (m.color === 'b') moveNo++;
    });
    const cur = movesEl.querySelector('.chess-move.current');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
  function renderStatus() {
    const t = board.turn();
    turnChip.className = 'chess-turn ' + t;
    turnChip.textContent = t === 'white' ? tr({ de: 'Weiß am Zug', en: 'White to move' }) : tr({ de: 'Schwarz am Zug', en: 'Black to move' });
    let s = '';
    if (board.isCheckmate()) s = tr({ de: 'Schachmatt', en: 'Checkmate' });
    else if (board.inCheck()) s = tr({ de: 'Schach!', en: 'Check!' });
    status.textContent = s;
    status.classList.toggle('hidden', !s);
  }
  function renderFen() { if (document.activeElement !== fenInput) { fenInput.value = board.getFen(); fenInput.classList.remove('invalid'); } }

  // ---- engine ----
  let engineOn = false, engine = null, engineTimer = null, engineSeq = 0, engineAcquired = false;
  function setEngine(on) {
    engineOn = on;
    engineToggle.classList.toggle('on', on);
    engineBody.classList.toggle('hidden', !on);
    if (on) analyse(); else { engine?.stop(); }
  }
  const msg = (text) => { evalText.textContent = text; evalText.classList.add('msg'); evalLine.textContent = ''; };
  function analyse() {
    if (!engineOn) return;
    clearTimeout(engineTimer);
    engineTimer = setTimeout(async () => {
      const seq = ++engineSeq;
      const fen = board.getFen();
      if (board.isFree()) { msg(tr({ de: 'Freier Modus. Für die Analyse zu „Regeln“ wechseln.', en: 'Free mode – switch to “Rules” to analyse.' })); return; }
      // Stockfish refuses positions with more than 16 pieces per side
      const placement = fen.split(' ')[0];
      const white = (placement.match(/[PNBRQK]/g) || []).length, black = (placement.match(/[pnbrqk]/g) || []).length;
      if (white > 16 || black > 16) { msg(tr({ de: 'Mehr als 16 Figuren pro Seite. Stockfish kann diese Stellung nicht bewerten.', en: 'More than 16 pieces per side – Stockfish cannot evaluate this position.' })); return; }
      try {
        if (!engine) { msg(tr({ de: 'Stockfish wird geladen …', en: 'Loading Stockfish …' })); engine = await acquireEngine(); engineAcquired = true; }
        if (seq !== engineSeq || !engineOn) return;
        if (board.isCheckmate()) { msg(tr({ de: 'Schachmatt', en: 'Checkmate' })); setBar(board.turn() === 'white' ? 0 : 1); return; }
        const res = await engine.analyse(fen, { depth: 14 }, (info) => { if (seq === engineSeq) showInfo(fen, info); });
        if (seq !== engineSeq) return;
        if (res?.info) showInfo(fen, res.info, true);
        else if (res && !res.cancelled && !res.bestMove) msg(tr({ de: 'Keine Bewertung möglich (Stellung ungültig oder Patt).', en: 'No evaluation possible (illegal position or stalemate).' }));
      } catch (e) {
        console.error('[chess] engine', e);
        msg(tr({ de: 'Engine nicht verfügbar', en: 'Engine unavailable' }) + ': ' + e.message);
      }
    }, 350);
  }
  function setBar(share) { evalBar.firstChild.style.width = Math.round(share * 100) + '%'; }
  function showInfo(fen, info, done) {
    if (!info) return;
    setBar(scoreToBar(info.score));
    evalText.classList.remove('msg');
    evalText.textContent = `${formatScore(info.score)}  ·  ${tr({ de: 'Tiefe', en: 'depth' })} ${info.depth}${done ? '' : ' …'}`;
    // principal variation → SAN
    try {
      const c = new Chess(fen);
      const sans = [];
      for (const u of info.pv.slice(0, 10)) { const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); sans.push(m.san); }
      const c0 = new Chess(fen);
      evalLine.textContent = formatMoves(sans, { startMove: c0.moveNumber(), startColor: c0.turn() }).replace(/([KQRBN])(?=[a-h])/g, (m) => figurine(m));
    } catch (e) { evalLine.textContent = info.pv.join(' '); }
  }

  // ---- book positions ----
  async function loadBook() {
    if (!bookId) return;
    try { book = await ctx.api.library.book(bookId); } catch (e) { book = null; }
    bookTitle.textContent = book ? `${book.title || ''}${book.author ? ' · ' + book.author : ''}` : tr({ de: 'Buch nicht gefunden', en: 'Book not found' });
    renderPositions();
  }
  function renderPositions() {
    clear(posList);
    const positions = (book && book.positions) || [];
    if (!bookId) return;
    if (!positions.length) { posList.appendChild(h('div.small.muted', L({ de: 'Noch keine gespeicherten Stellungen.', en: 'No saved positions yet.' }))); return; }
    for (const p of [...positions].reverse()) {
      const item = h('div.list-item.chess-pos', { onclick: () => { click(); loadPosition(p); } },
        h('div.chess-pos-mini', { html: miniBoardSvg(p.fen) }),
        h('div.chess-pos-text', h('div.chess-pos-label', p.label || tr({ de: 'Stellung', en: 'Position' })), h('div.small.muted', formatDate(p.createdAt, i18n.lang) + (p.location ? ' · ' + tr({ de: 'Lesezeichen', en: 'bookmark' }) : ''))),
        h('button.btn.small.icon.ghost.chess-pos-del', { type: 'button', title: tr({ de: 'Löschen', en: 'Delete' }), onclick: (e) => { e.stopPropagation(); click(); deletePosition(p.id); } }, '✕'));
      posList.appendChild(item);
    }
  }
  function loadPosition(p) {
    try { board.setFree(false); board.setFen(p.fen); }
    catch (e) { board.setFree(true); board.setFen(p.fen); }
    syncFreeUI();
    moveError.classList.add('hidden');
  }
  function defaultLabel() {
    const hist = board.history();
    const n = ((book && book.positions) || []).length + 1;
    const last = hist[board.getPly() - 1];
    if (last) {
      try {
        const c = new Chess(last.fen);
        const no = last.color === 'w' ? c.moveNumber() : c.moveNumber() - 1;
        return tr({ de: 'Nach {m}', en: 'After {m}' }, { m: last.color === 'w' ? `${no}. ${last.san}` : `${no}… ${last.san}` });
      } catch (e) { /* fall through */ }
    }
    return tr({ de: 'Stellung {n}', en: 'Position {n}' }, { n });
  }
  function startSave() {
    clear(saveRow);
    const input = h('input.input.chess-label-input', { type: 'text', value: defaultLabel(), placeholder: tr({ de: 'Bezeichnung (z. B. Diagramm 12, S. 87)', en: 'Label (e.g. diagram 12, p. 87)' }) });
    const ok = btn({ de: 'Speichern', en: 'Save' }, () => savePosition(input.value.trim() || defaultLabel()), 'btn.primary.small');
    const cancel = btn({ de: 'Abbrechen', en: 'Cancel' }, () => saveRow.classList.add('hidden'), 'btn.small');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); if (e.key === 'Escape') { e.stopPropagation(); saveRow.classList.add('hidden'); } });
    saveRow.append(input, h('div.row.chess-row', ok, cancel));
    saveRow.classList.remove('hidden');
    input.focus(); input.select();
  }
  async function savePosition(label) {
    if (!bookId) return;
    const pos = { id: 'pos_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), fen: board.getFen(), label, location: location || null, createdAt: Date.now() };
    try {
      const fresh = await ctx.api.library.book(bookId);
      const positions = [...((fresh && fresh.positions) || []), pos];
      await ctx.api.library.update(bookId, { positions });
      book = { ...(fresh || book || {}), positions };
      saveRow.classList.add('hidden');
      renderPositions();
      toast(tr({ de: 'Stellung gespeichert', en: 'Position saved' }));
    } catch (e) { console.error(e); toast(tr({ de: 'Speichern fehlgeschlagen', en: 'Saving failed' }) + ': ' + e.message); }
  }
  async function deletePosition(id) {
    try {
      const fresh = await ctx.api.library.book(bookId);
      const positions = ((fresh && fresh.positions) || []).filter((p) => p.id !== id);
      await ctx.api.library.update(bookId, { positions });
      book = { ...(fresh || book || {}), positions };
      renderPositions();
    } catch (e) { console.error(e); }
  }

  // ---- wiring ----
  const offChange = board.onChange((fen, d) => {
    if (d.type === 'move') audio?.sfx?.('chess-move');
    else if (d.type === 'edit' && (d.to || d.removed)) audio?.sfx?.('chess-move');
    renderMoves(); renderStatus(); renderFen(); syncFreeUI();
    if (d.type !== 'orientation' && d.type !== 'view') analyse();
  });
  renderMoves(); renderStatus(); renderFen(); syncFreeUI();
  loadBook();

  function onKey(e) {
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return false;
    if (recognition?.onKey(e)) return true;
    if (e.key === 'ArrowLeft') { board.back(); return true; }
    if (e.key === 'ArrowRight') { board.forward(); return true; }
    if (e.key === 'Home') { board.goTo(0); return true; }
    if (e.key === 'End') { board.goTo(board.history().length); return true; }
    if (e.key === 'f' || e.key === 'F') { board.flip(); return true; }
    return false;
  }

  return {
    board,
    onKey,
    recognition,
    setLocation(loc) { location = loc || null; },
    async setBook(id) { bookId = id || null; bookSection.classList.toggle('hidden', !bookId); await loadBook(); },
    destroy() {
      offChange(); unsubI18n?.(); recognition?.destroy?.();
      clearTimeout(engineTimer); engineSeq++;
      try { engine?.stop(); } catch (e) { /* ignore */ }
      if (engineAcquired) { engineAcquired = false; engine = null; try { releaseEngine(); } catch (e) { /* ignore */ } }
      board.destroy();
    },
  };
}

// ---- tiny SVG board preview for the saved-position list ----
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
function miniBoardSvg(fen) {
  const rows = String(fen || '').split(' ')[0].split('/');
  let out = '<svg viewBox="0 0 8 8" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) out += `<rect x="${x}" y="${y}" width="1" height="1" fill="${(x + y) % 2 ? '#b58863' : '#f0d9b5'}"/>`;
  for (let y = 0; y < 8 && y < rows.length; y++) {
    let x = 0;
    for (const ch of rows[y]) {
      if (/\d/.test(ch)) { x += +ch; continue; }
      const g = GLYPH[ch.toLowerCase()];
      if (g) out += `<text x="${x + 0.5}" y="${y + 0.86}" font-size="0.95" text-anchor="middle" fill="${ch === ch.toUpperCase() ? '#fff' : '#111'}" stroke="${ch === ch.toUpperCase() ? '#222' : 'none'}" stroke-width="0.04">${g}</text>`;
      x++;
    }
  }
  return out + '</svg>';
}
