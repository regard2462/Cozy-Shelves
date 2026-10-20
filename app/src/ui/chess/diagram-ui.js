// The chess pane's side of the diagram snip: recognition of a captured diagram (templates of this computer plus
// the corrections remembered for the book), the position on the board, and a card to finish it: side to move,
// "seen from Black" for a turned diagram, the confidence, and corrections by clicking a square. Every correction
// is remembered for the book and immediately re-reads the other squares, so that the same glyph elsewhere in the
// diagram (and in the next diagrams of the book) comes out right.
import { h, clear } from '../../core/dom.js';
import { tr } from '../../core/i18n.js';
import { bus } from '../../core/bus.js';
import { fromRGBA } from './diagram/image.js';
import { recognize, reclassify, toPlacement } from './diagram/recognize.js';
import { loadTemplates } from './diagram/templates.js';
import { loadBookTemplates, addBookTemplates } from './diagram/book-memory.js';
import { askWorker } from './diagram/find-boards.js';
import { placementToPieces, composeFen, LETTER_ROLE } from './position.js';

// tests (build/scripts/chess-snip-check.js) read the template boards of this computer for the benchmark and
// compare a snip read with and without the corrections remembered for its book
if (typeof window !== 'undefined') {
  window.__chessTemplates = () => loadTemplates();
  window.__recognizeShot = (shot, opts) => recognizeShot(shot, opts);
}

const ROLE_NAME = { k: { de: 'König', en: 'king' }, q: { de: 'Dame', en: 'queen' }, r: { de: 'Turm', en: 'rook' }, b: { de: 'Läufer', en: 'bishop' }, n: { de: 'Springer', en: 'knight' }, p: { de: 'Bauer', en: 'pawn' } };

/** recognition of a captured snip (reader-snip.js): { res, tsetBase, book } or an Error('no-board'). It runs in the
 *  diagram worker (the reader stays responsive); without a worker it runs here. */
export async function recognizeShot(shot, { bookId, onProgress, inPage = false } = {}) {
  const t = await loadTemplates(onProgress);
  const book = await loadBookTemplates(bookId);
  const t0 = performance.now();
  let res = inPage ? null : await recognizeInWorker(shot, t, book);
  const via = res ? 'worker' : 'page';
  if (!res) res = recognize(fromRGBA(shot.data, shot.width, shot.height), { templates: t.tset.plus(book), hints: shot.hints });
  if (typeof window !== 'undefined') window.__lastRecognition = { via, ms: Math.round(performance.now() - t0) };   // tests
  if (!res.ok) throw new Error('no-board');
  return { res, tsetBase: t.tset, book };
}

let workerKey = null;   // the templates the worker holds
async function recognizeInWorker(shot, t, book) {
  if (typeof Worker === 'undefined') return null;
  const msg = { type: 'recognize', data: shot.data.slice(), width: shot.width, height: shot.height, hints: shot.hints || {}, key: t.key, book };
  let out = await askWorker(workerKey === t.key ? msg : { ...msg, templates: { key: t.key, items: t.items } });
  if (out.need === 'templates') out = await askWorker({ ...msg, data: shot.data.slice(), templates: { key: t.key, items: t.items } });
  if (out.error || !out.res) { console.warn('[chess] diagram worker', out.error || out.need); return null; }
  workerKey = t.key;
  return out.res;
}

/**
 * The card in the chess pane. createRecognition(host, board, { bookId, onClose, toast, click }) →
 * { show(recognition, shot), close(), isOpen(), onKey(e), state() }
 */
export function createRecognition(host, board, opts = {}) {
  const T = (de, en, vars) => tr({ de, en }, vars);
  let rec = null;            // { res, tsetBase, book, shot }
  let fixed = new Map();     // image square → character set by hand
  let learned = [];          // corrections of this diagram (also in the book memory)
  let orientation = 'white', toMove = 'white';
  let fixing = false;
  const card = h('section.chess-section.chess-rec.hidden');
  host.prepend(card);
  const overlay = h('div.chess-fix.hidden');
  board.el.querySelector('.chess-view')?.append(overlay);
  let picker = null;
  // the card speaks the language of the app, also when it is switched while the card is open
  const offLang = bus.on('i18n:change', () => { if (!rec) return; closePicker(); render(); });

  function close() {
    rec = null; fixed = new Map(); learned = []; fixing = false;
    card.classList.add('hidden'); clear(card);
    overlay.classList.add('hidden'); clear(overlay);
    closePicker();
    opts.onClose?.();
  }

  /** the position on the board: placement from the (corrected) recognition, side to move, castling inferred */
  function apply() {
    const res = rec.res;
    const placement = toPlacement(res.grid, orientation);
    const fen = composeFen(placementToPieces(placement), toMove);
    try { if (!board.isFree()) board.setFree(true); } catch { /* already free */ }
    board.setFen(fen, { animate: false });
    let legal = true;
    try { board.setFree(false); } catch { legal = false; }
    if (board.orientation !== orientation) board.setOrientation(orientation);
    rec.legal = legal;
    render();
  }

  function render() {
    clear(card);
    if (!rec) return;
    const res = rec.res;
    const pct = Math.round(res.confidence * 100);
    const unsure = res.uncertain.length;
    const status = unsure === 1
      ? T('1 Feld unsicher, gelb markiert', '1 square uncertain, marked in yellow')
      : unsure
        ? T('{n} Felder unsicher, gelb markiert', '{n} squares uncertain, marked in yellow', { n: unsure })
        : T('Alle Felder sicher erkannt', 'All squares read with confidence');
    const seg = (items, value, set) => h('div.chess-seg', items.map(([v, label]) => h('button.chess-seg-btn', { type: 'button', class: v === value ? 'active' : '', onclick: () => { opts.click?.(); set(v); } }, label)));
    card.append(
      h('div.chess-section-head', h('h3', T('Diagramm aus dem Buch', 'Diagram from the book')), h('span.spacer'),
        h('button.btn.small.icon.ghost', { type: 'button', title: T('Schließen', 'Close'), onclick: () => { opts.click?.(); close(); } }, '✕')),
      h('div.chess-rec-status', h('span.chess-rec-pct', { class: pct >= 90 ? 'good' : pct >= 70 ? 'mid' : 'low', title: T('Wahrscheinlichkeit, dass alle 64 Felder stimmen', 'Probability that all 64 squares are right') }, T('{p} % sicher', '{p} % sure', { p: pct })), h('span', ' · ' + status)),
      h('div.row.chess-row',
        seg([['white', T('Weiß am Zug', 'White to move')], ['black', T('Schwarz am Zug', 'Black to move')]], toMove, (v) => { toMove = v; apply(); }),
        h('label.chess-rec-flip', { title: T('Das Diagramm zeigt das Brett von Schwarz aus', 'The diagram shows the board from Black\'s side') },
          h('input', { type: 'checkbox', checked: orientation === 'black', onchange: (e) => { opts.click?.(); orientation = e.target.checked ? 'black' : 'white'; apply(); } }),
          h('span', T('Von Schwarz aus', 'From Black\'s side')))),
      h('div.row.chess-row',
        h('button.btn.small', { type: 'button', class: fixing ? 'primary' : '', onclick: () => { opts.click?.(); setFixing(!fixing); } }, fixing ? T('Korrektur beenden', 'Done correcting') : T('Felder korrigieren', 'Correct squares')),
        h('span.small.muted', fixing ? T('Feld anklicken und die richtige Figur wählen.', 'Click a square and pick the right piece.') : rec.legal ? '' : T('Keine regelgerechte Stellung: freier Modus.', 'Not a legal position: free mode.'))),
    );
    renderOverlay();
  }

  function setFixing(on) { fixing = on; closePicker(); render(); }

  /** board view cell (row, col from the top left of the view) → image square of the diagram */
  function viewToImage(row, col) {
    const v = board.orientation;
    const file = v === 'white' ? col : 7 - col, rank = v === 'white' ? 7 - row : row;   // 0-based
    return orientation === 'white' ? (7 - rank) * 8 + file : rank * 8 + (7 - file);
  }

  function renderOverlay() {
    clear(overlay);
    overlay.classList.toggle('hidden', !rec || !fixing);
    if (!rec || !fixing) return;
    const unsure = new Set(rec.res.uncertain);
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      const i = viewToImage(row, col);
      overlay.append(h('button.chess-fix-cell', {
        type: 'button', class: (fixed.has(i) ? 'fixed ' : '') + (unsure.has(i) ? 'unsure' : ''),
        style: { left: col * 12.5 + '%', top: row * 12.5 + '%' },
        title: T('Feld ändern', 'Change square'),
        onclick: (e) => { e.stopPropagation(); opts.click?.(); openPicker(i, row, col); },
      }));
    }
  }

  function closePicker() { picker?.remove(); picker = null; }
  function openPicker(i, row, col) {
    closePicker();
    const cur = rec.res.grid[i >> 3][i & 7];
    const choice = (ch) => {
      const color = ch === ch.toUpperCase() ? 'white' : 'black';
      return h('button.chess-fix-piece.cg-wrap', { type: 'button', class: ch === cur ? 'current' : '', title: tr(ROLE_NAME[ch.toLowerCase()]), onclick: (e) => { e.stopPropagation(); opts.click?.(); correct(i, ch); } }, h('piece', { class: `${LETTER_ROLE[ch.toLowerCase()]} ${color}` }));
    };
    picker = h('div.chess-fix-picker', { onclick: (e) => e.stopPropagation() },
      h('div.chess-fix-row', [...'KQRBNP'].map(choice)),
      h('div.chess-fix-row', [...'kqrbnp'].map(choice)),
      h('button.btn.small.chess-fix-empty', { type: 'button', class: cur === '.' ? 'primary' : '', onclick: (e) => { e.stopPropagation(); opts.click?.(); correct(i, '.'); } }, T('Leeres Feld', 'Empty square')));
    // next to the square, inside the board
    Object.assign(picker.style, { left: Math.min(62, Math.max(0, col * 12.5 - 12)) + '%', top: (row < 4 ? (row + 1) * 12.5 : Math.max(0, row * 12.5 - 30)) + '%' });
    overlay.append(picker);
  }

  /** a square set by hand: fixed, remembered for the book, and the others read again */
  async function correct(i, ch) {
    closePicker();
    const entry = rec.res.state.entries[i];
    fixed.set(i, ch);
    if (entry.feat) {
      const black = ch !== '.' && ch === ch.toLowerCase();
      const item = ch === '.' ? { role: '.', black: entry.black, light: entry.light, feat: entry.feat }
        : { role: ch.toLowerCase(), black, light: entry.light, feat: black === entry.black ? entry.feat : entry.featOther };
      learned.push(item);
      if (opts.bookId) addBookTemplates(opts.bookId, [item]).catch((e) => console.warn('[chess] remembering a correction failed', e));
    }
    rec.res = reclassify(rec.res.state, rec.tsetBase.plus([...rec.book, ...learned]), fixed);
    apply();
  }

  return {
    el: card,
    destroy() { offLang?.(); closePicker(); },
    show(recognition, shot) {
      rec = { ...recognition, shot };
      fixed = new Map(); learned = [];
      orientation = recognition.res.orientation || 'white';
      toMove = shot?.hints?.toMove || 'white';
      fixing = true;
      card.classList.remove('hidden');
      apply();
      card.scrollIntoView?.({ block: 'nearest' });
    },
    close,
    isOpen: () => !!rec,
    onKey(e) {
      if (!rec) return false;
      if (e.key === 'Escape') { if (picker) { closePicker(); return true; } if (fixing) { setFixing(false); return true; } }
      return false;
    },
    state: () => (rec ? { grid: rec.res.grid, orientation, toMove, fen: board.getFen(), fixing, uncertain: rec.res.uncertain, confidence: rec.res.confidence, fixed: [...fixed.entries()], learned: learned.length } : null),
    /** the image square shown at a board square ('e4'), for tests */
    imageIndexOf(square) {
      const file = square.charCodeAt(0) - 97, rank = +square[1] - 1;
      return orientation === 'white' ? (7 - rank) * 8 + file : rank * 8 + (7 - file);
    },
    correct,
  };
}
