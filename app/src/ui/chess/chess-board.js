// Chess board component: one shared position (chess.js in legal mode, a plain pieces map in free mode)
// rendered either by chessground (2D) or by a Three.js scene (3D). See docs/CONTRACTS.md.
import { Chess } from 'chess.js';
import { h, clear, sleep } from '../../core/dom.js';
import { tr } from '../../core/i18n.js';
import { create2dBoard } from './board-2d.js';
import { parseMoveText } from './san.js';
import { ROLES, START_FEN, EMPTY_FEN, placementToPieces, composeFen, fenTurn, chessToPieces, chessDests, findKing, cloneMap, ROLE_LETTER } from './position.js';

const opposite = (c) => (c === 'white' ? 'black' : 'white');
const roleLetter = (r) => ROLE_LETTER[r];

/**
 * createChessBoard(container, { mode: '2d'|'3d', orientation: 'white'|'black', free: bool, fen })
 */
export function createChessBoard(container, opts = {}) {
  const st = {
    free: !!opts.free,
    mode: opts.mode === '3d' ? '3d' : '2d',
    orientation: opts.orientation === 'black' ? 'black' : 'white',
    game: null,                  // chess.js instance at the current ply (legal mode)
    rootFen: START_FEN,
    moves: [],                   // verbose chess.js moves played from rootFen
    ply: 0,
    pieces: new Map(),           // free-mode board
    turn: 'white',               // free-mode side to move
    undoStack: [],               // free-mode snapshots
    lastMove: null,
    destroyed: false,
  };
  const listeners = new Set();
  let playToken = 0;

  // ---- DOM ----
  const root = h('div.chess-board', { dataset: { mode: st.mode } });
  const viewHost = h('div.chess-view-host');
  const view = h('div.chess-view');
  const promo = h('div.chess-promotion.hidden');
  const palette = h('div.chess-palette');
  viewHost.appendChild(view);
  view.appendChild(promo);
  root.append(viewHost, palette);
  container.appendChild(root);

  // ---- renderers ----
  const handlers = {
    move: (orig, dest) => userMove(orig, dest),
    drop: (piece, key) => userDrop(piece, key),
    remove: (key) => userRemove(key),
    promotionNeeded: (orig, dest) => needsPromotion(orig, dest),
  };
  const renderers = { '2d': null, '3d': null };
  renderers['2d'] = create2dBoard(view, handlers, { free: st.free, orientation: st.orientation });
  let active = renderers['2d'];
  let loading3d = null;

  async function ensure3d() {
    if (renderers['3d']) return renderers['3d'];
    if (!loading3d) loading3d = import('./board-3d.js').then((m) => {
      if (st.destroyed) return null;
      const r = m.create3dBoard(view, handlers, { free: st.free, orientation: st.orientation });
      r.show(false);
      renderers['3d'] = r;
      return r;
    });
    return loading3d;
  }

  // ---- palette ----
  function buildPalette() {
    clear(palette);
    const mk = (color) => ROLES.map((role) => {
      const p = h('div.chess-spare.cg-wrap', { dataset: { color, role }, title: tr({ de: 'Ziehe die Figur auf das Brett', en: 'Drag the piece onto the board' }) }, h('piece', { class: `${role} ${color}` }));
      const start = (e) => { if (e.button !== undefined && e.button !== 0) return; e.preventDefault(); active.dragSpare({ color, role }, e); };
      p.addEventListener('mousedown', start);
      p.addEventListener('touchstart', start, { passive: false });
      return p;
    });
    const trash = h('div.chess-trash', { title: tr({ de: 'Figur vom Brett ziehen = entfernen', en: 'Drag a piece off the board to remove it' }) }, h('span', '🗑'));
    palette.append(h('div.chess-spare-group.white', mk('white')), trash, h('div.chess-spare-group.black', mk('black')));
    palette.classList.toggle('hidden', !st.free);
  }
  buildPalette();

  // ---- sizing ----
  const ro = new ResizeObserver(() => fit());
  ro.observe(viewHost);
  let refitTimer = 0;
  function fit() {
    // panels open with a scale transition; chessground measures via getBoundingClientRect, so re-fit once it settled
    clearTimeout(refitTimer);
    refitTimer = setTimeout(() => { if (!st.destroyed) for (const r of Object.values(renderers)) r?.resize?.(); }, 450);
    const w = viewHost.clientWidth, hh = viewHost.clientHeight;
    let size = Math.max(0, Math.floor(Math.min(w || 0, hh || w || 0)));
    const dpr = window.devicePixelRatio || 1;
    size = Math.floor((size * dpr) / 8) * 8 / dpr;   // chessground snaps its container to 8 device pixels
    if (!size) return;
    view.style.width = size + 'px'; view.style.height = size + 'px';
    for (const r of Object.values(renderers)) r?.resize?.();
  }

  // ---- state helpers ----
  const legal = () => !st.free && st.game;
  function currentPieces() { return legal() ? chessToPieces(st.game) : st.pieces; }
  function getFen() { return legal() ? st.game.fen() : composeFen(st.pieces, st.turn); }
  function turn() { return legal() ? (st.game.turn() === 'w' ? 'white' : 'black') : st.turn; }
  function emit(type, extra = {}) {
    const detail = { type, fen: getFen(), free: st.free, ply: st.ply, moves: history(), turn: turn(), check: legal() ? st.game.inCheck() : false, checkmate: legal() ? st.game.isCheckmate() : false, ...extra };
    for (const fn of listeners) { try { fn(detail.fen, detail); } catch (e) { console.error('[chess] onChange', e); } }
  }
  function render(o = {}) {
    const pieces = currentPieces();
    const t = turn();
    const check = legal() && st.game.inCheck() ? findKing(pieces, t) : null;
    const dests = legal() ? chessDests(st.game) : new Map();
    const args = { lastMove: st.lastMove, check, turn: t, dests, free: st.free, animate: o.animate !== false };
    for (const r of Object.values(renderers)) r?.setPosition(pieces, args);
  }
  function loadGame(fen) {
    const g = new Chess(fen);   // throws on invalid FEN
    st.game = g; st.rootFen = g.fen(); st.moves = []; st.ply = 0; st.lastMove = null;
  }
  function syncGameToPly() {
    const fen = st.ply ? st.moves[st.ply - 1].after : st.rootFen;
    st.game.load(fen);
    st.lastMove = st.ply ? [st.moves[st.ply - 1].from, st.moves[st.ply - 1].to] : null;
  }
  function history() { return st.moves.map((m, i) => ({ san: m.san, ply: i + 1, color: m.color, fen: m.after, from: m.from, to: m.to })); }
  function invalid(e) {
    const err = new Error(tr({ de: 'Ungültige Stellung', en: 'Invalid position' }) + ': ' + fenProblem(String(e && e.message || e).replace(/^Invalid FEN: /, '')));
    err.cause = e; return err;
  }

  // ---- moves ----
  function movesFor(orig, dest) { return st.game.moves({ square: orig, verbose: true }).filter((m) => m.to === dest); }
  function needsPromotion(orig, dest) { return !!(legal() && movesFor(orig, dest).some((m) => m.promotion)); }
  function doMove(move, o = {}) {
    if (st.ply < st.moves.length) st.moves = st.moves.slice(0, st.ply);
    const m = st.game.move(move);
    st.moves.push(m); st.ply = st.moves.length; st.lastMove = [m.from, m.to];
    render({ animate: o.animate !== false });
    emit('move', { san: m.san, move: m, capture: !!m.captured });
    return m;
  }
  function userMove(orig, dest) {
    if (st.free) {
      const p = st.pieces.get(orig);
      if (!p || orig === dest) { render(); return false; }
      pushUndo();
      st.pieces.delete(orig); st.pieces.set(dest, p); st.lastMove = [orig, dest];
      render(); emit('edit', { san: null, from: orig, to: dest });
      return true;
    }
    if (!st.game) { render(); return false; }
    const cands = movesFor(orig, dest);
    if (!cands.length) { render(); return false; }
    if (cands[0].promotion) {
      showPromotion(cands[0].color === 'w' ? 'white' : 'black', (role) => {
        if (!role) { render(); return; }
        doMove({ from: orig, to: dest, promotion: roleLetter(role) });
      });
      return 'promotion';
    }
    doMove({ from: orig, to: dest });
    return true;
  }
  function userDrop(piece, key) {
    if (!st.free) { render(); return false; }
    pushUndo();
    st.pieces.set(key, { color: piece.color, role: piece.role }); st.lastMove = [key];
    render(); emit('edit', { drop: piece, to: key });
    return true;
  }
  function userRemove(key) {
    if (!st.free || !st.pieces.has(key)) { render(); return false; }
    pushUndo();
    st.pieces.delete(key); st.lastMove = null;
    render(); emit('edit', { removed: key });
    return true;
  }
  function pushUndo() { st.undoStack.push({ pieces: cloneMap(st.pieces), turn: st.turn }); if (st.undoStack.length > 200) st.undoStack.shift(); }

  // ---- promotion dialog ----
  let promoResolve = null;
  function showPromotion(color, cb) {
    promoResolve?.(null);
    promoResolve = (role) => { promoResolve = null; promo.classList.add('hidden'); clear(promo); cb(role); };
    clear(promo);
    const box = h('div.chess-promotion-box', h('div.chess-promotion-title', tr({ de: 'Umwandlung', en: 'Promotion' })));
    for (const role of ['queen', 'rook', 'bishop', 'knight']) {
      box.appendChild(h('button.chess-promotion-piece.cg-wrap', { type: 'button', onclick: (e) => { e.stopPropagation(); promoResolve?.(role); } }, h('piece', { class: `${role} ${color}` })));
    }
    promo.appendChild(box);
    promo.onclick = () => promoResolve?.(null);
    promo.classList.remove('hidden');
  }

  // ---- public API ----
  const api = {
    el: root,
    get mode() { return st.mode; },
    get orientation() { return st.orientation; },
    getFen,
    turn,
    isFree: () => st.free,
    history,
    getPly: () => st.ply,
    inCheck: () => (legal() ? st.game.inCheck() : false),
    isCheckmate: () => (legal() ? st.game.isCheckmate() : false),
    setFen(fen, o = {}) {
      fen = String(fen || '').trim();
      if (!fen) fen = START_FEN;
      if (fen.split(' ').length < 2) fen += ' w - - 0 1';
      else if (fen.split(' ').length < 6) { const p = fen.split(' '); fen = [p[0], p[1] || 'w', p[2] || '-', p[3] || '-', p[4] || '0', p[5] || '1'].join(' '); }
      promoResolve?.(null);
      if (st.free) {
        pushUndo();
        st.pieces = placementToPieces(fen); st.turn = fenTurn(fen); st.lastMove = null;
      } else {
        try { loadGame(fen); } catch (e) { throw invalid(e); }
      }
      render({ animate: o.animate !== false });
      emit('set');
      return getFen();
    },
    setFree(flag) {
      flag = !!flag;
      if (flag === st.free) return true;
      promoResolve?.(null);
      if (flag) {
        st.pieces = cloneMap(currentPieces()); st.turn = turn(); st.undoStack = []; st.lastMove = null;
        st.free = true; st.game = null; st.moves = []; st.ply = 0;
      } else {
        const fen = composeFen(st.pieces, st.turn);
        try { loadGame(fen); } catch (e) { throw invalid(e); }
        st.free = false; st.undoStack = [];
      }
      for (const r of Object.values(renderers)) r?.setFree(st.free);
      palette.classList.toggle('hidden', !st.free);
      root.dataset.free = st.free ? '1' : '';
      render({ animate: false });
      emit('mode');
      return true;
    },
    setTurn(color) {
      color = color === 'black' ? 'black' : 'white';
      if (st.free) { st.turn = color; render({ animate: false }); emit('edit'); return true; }
      const parts = st.game.fen().split(' '); parts[1] = color[0]; parts[3] = '-';
      api.setFen(parts.join(' '), { animate: false });
      return true;
    },
    reset() { api.setFen(START_FEN); emit('reset'); },
    clear() {
      promoResolve?.(null);
      if (!st.free) api.setFree(true);
      pushUndo();
      st.pieces = new Map(); st.turn = 'white'; st.lastMove = null;
      render(); emit('clear');
    },
    undo() {
      promoResolve?.(null);
      if (st.free) {
        const snap = st.undoStack.pop();
        if (!snap) return false;
        st.pieces = snap.pieces; st.turn = snap.turn; st.lastMove = null;
        render(); emit('undo');
        return true;
      }
      if (!st.ply) return false;
      st.moves = st.moves.slice(0, st.ply - 1); st.ply = st.moves.length;
      syncGameToPly(); render(); emit('undo');
      return true;
    },
    goTo(ply) {
      if (st.free || !st.game) return false;
      ply = Math.max(0, Math.min(st.moves.length, ply | 0));
      if (ply === st.ply) return true;
      promoResolve?.(null);
      st.ply = ply; syncGameToPly(); render(); emit('nav');
      return true;
    },
    forward() { return api.goTo(st.ply + 1); },
    back() { return api.goTo(st.ply - 1); },
    async playSan(text, o = {}) {
      if (st.free) api.setFree(false);   // throws when the position is not a legal one
      const tokens = parseMoveText(text);
      const probe = new Chess(st.game.fen());
      const list = []; let error = null;
      for (let i = 0; i < tokens.length; i++) {
        try { list.push(probe.move(tokens[i].san)); }
        catch (e) { error = { index: i, token: tokens[i].raw, san: tokens[i].san, applied: list.length }; break; }
      }
      const token = ++playToken;
      const delay = o.animate === false ? 0 : (list.length > 24 ? 90 : 300);
      for (const m of list) {
        if (token !== playToken || st.destroyed || st.free) break;
        doMove({ from: m.from, to: m.to, promotion: m.promotion }, { animate: delay > 0 });
        if (delay) await sleep(delay);
      }
      if (error) {
        const err = new Error(tr({ de: 'Ungültiger Zug: {t} (Zug Nr. {n})', en: 'Illegal move: {t} (move no. {n})' }, { t: error.token, n: Math.floor(error.index / 2) + 1 }));
        Object.assign(err, error);
        throw err;
      }
      return list.length;
    },
    flip() { return api.setOrientation(opposite(st.orientation)); },
    setOrientation(color) {
      st.orientation = color === 'black' ? 'black' : 'white';
      for (const r of Object.values(renderers)) r?.setOrientation(st.orientation);
      root.dataset.orientation = st.orientation;
      emit('orientation');
      return st.orientation;
    },
    async setMode(mode) {
      mode = mode === '3d' ? '3d' : '2d';
      if (mode === st.mode && renderers[mode]) return mode;
      st.mode = mode; root.dataset.mode = mode;
      if (mode === '3d') {
        const r = await ensure3d();
        if (!r || st.destroyed || st.mode !== '3d') return st.mode;
        r.setOrientation(st.orientation); r.setFree(st.free);
      }
      for (const [k, r] of Object.entries(renderers)) r?.show(k === mode);
      active = renderers[mode];
      render({ animate: false });
      fit();
      emit('view');
      return mode;
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setShapes(shapes) { for (const r of Object.values(renderers)) r?.setShapes?.(shapes); },
    resize: fit,
    destroy() {
      st.destroyed = true; playToken++;
      ro.disconnect();
      for (const r of Object.values(renderers)) { try { r?.destroy(); } catch (e) { console.error(e); } }
      listeners.clear();
      root.remove();
    },
  };

  // ---- init ----
  api._renderers = renderers;   // for tests / debugging
  root._api = api;
  root.dataset.free = st.free ? '1' : '';
  root.dataset.orientation = st.orientation;
  if (st.free) { st.pieces = placementToPieces(opts.fen || START_FEN); st.turn = fenTurn(opts.fen || START_FEN); }
  else {
    try { loadGame(opts.fen || START_FEN); }
    catch (e) { console.warn('[chess] invalid start fen, using start position', e); loadGame(START_FEN); }
  }
  render({ animate: false });
  if (st.mode === '3d') { st.mode = '2d'; api.setMode('3d'); }
  requestAnimationFrame(fit);
  return api;
}

export { START_FEN, EMPTY_FEN };

/** the reasons chess.js gives for a position it does not accept, in the app's language */
function fenProblem(msg) {
  const king = /^(missing|too many) (white|black) kings?$/.exec(msg);
  if (king) {
    const white = king[2] === 'white';
    return king[1] === 'missing'
      ? tr(white ? { de: 'der weiße König fehlt', en: 'the white king is missing' } : { de: 'der schwarze König fehlt', en: 'the black king is missing' })
      : tr(white ? { de: 'mehr als ein weißer König', en: 'more than one white king' } : { de: 'mehr als ein schwarzer König', en: 'more than one black king' });
  }
  const known = {
    'some pawns are on the edge rows': { de: 'Bauern auf der ersten oder letzten Reihe', en: 'pawns on the first or last rank' },
    'castling availability is invalid': { de: 'ungültige Rochaderechte', en: 'invalid castling rights' },
    'en-passant square is invalid': { de: 'ungültiges En-passant-Feld', en: 'invalid en passant square' },
    'illegal en-passant square': { de: 'ungültiges En-passant-Feld', en: 'invalid en passant square' },
    'side-to-move is invalid': { de: 'ungültige Seite am Zug', en: 'invalid side to move' },
  };
  return known[msg] ? tr(known[msg]) : msg;
}
