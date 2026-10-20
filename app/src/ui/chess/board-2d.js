// 2D renderer: chessground (lichess board) inside a square element.
import { Chessground } from 'chessground';
import { h } from '../../core/dom.js';
import { piecesToPlacement } from './position.js';

/**
 * create2dBoard(host, handlers, opts) – handlers: { move(orig, dest), drop(piece, key), remove(key), select(key) }
 * Renderer contract shared with the 3D board (see chess-board.js).
 */
export function create2dBoard(host, handlers, opts = {}) {
  const el = h('div.chess-board-2d');
  host.appendChild(el);
  let free = !!opts.free;
  let syncing = false;
  let moveFlag = false;

  const cg = Chessground(el, {
    fen: '8/8/8/8/8/8/8/8',
    orientation: opts.orientation || 'white',
    coordinates: true,
    animation: { enabled: true, duration: 220 },
    disableContextMenu: true,
    addPieceZIndex: true,
    highlight: { lastMove: true, check: true },
    movable: { free, color: 'both', showDests: !free, rookCastle: false, events: { after: onAfter } },
    premovable: { enabled: false },
    predroppable: { enabled: false },
    draggable: { enabled: true, showGhost: true, deleteOnDropOff: free, autoDistance: false, distance: 3 },
    selectable: { enabled: true },
    drawable: { enabled: true, eraseOnClick: true },
    events: { move: () => { moveFlag = true; }, dropNewPiece: onDropNew, change: onChange, select: (key) => handlers.select?.(key) },
  });

  function onAfter(orig, dest) {
    moveFlag = false;
    if (syncing) return;
    handlers.move?.(orig, dest);
  }
  function onDropNew(piece, key) {
    if (syncing) return;
    // chessground has already placed the piece; the facade validates and syncs afterwards
    queueMicrotask(() => handlers.drop?.({ color: piece.color, role: piece.role }, key));
  }
  let known = new Map();   // last position received from the facade
  function onChange() {
    // chessground fires this asynchronously (setTimeout) – draggable.current is already gone
    if (syncing) return;
    if (moveFlag) { moveFlag = false; return; }
    if (!free) return;
    // deleteOnDropOff: a known piece vanished without a move → removed from the board
    if (cg.state.pieces.size < known.size) {
      for (const key of known.keys()) if (!cg.state.pieces.has(key)) { handlers.remove?.(key); return; }
    }
  }

  function setPosition(map, o = {}) {
    known = new Map(map);
    syncing = true;
    const turn = o.turn || 'white';
    cg.set({
      fen: piecesToPlacement(map),
      lastMove: o.lastMove && o.lastMove.length ? o.lastMove : undefined,
      turnColor: turn,
      check: o.check ? turn : false,
      movable: { free, color: free ? 'both' : turn, dests: free ? undefined : (o.dests || new Map()), showDests: !free },
      draggable: { deleteOnDropOff: free },
      animation: { enabled: o.animate !== false },
      selected: undefined,
    });
    if (!o.lastMove || !o.lastMove.length) cg.set({ lastMove: undefined });
    cg.state.selected = undefined;
    syncing = false;
  }

  return {
    el,
    kind: '2d',
    setPosition,
    setOrientation(color) { if (cg.state.orientation !== color) cg.toggleOrientation(); },
    setFree(v) { free = !!v; cg.set({ movable: { free, showDests: !free }, draggable: { deleteOnDropOff: free } }); },
    dragSpare(piece, event) { cg.dragNewPiece({ color: piece.color, role: piece.role }, event, true); },
    setShapes(shapes) { cg.setAutoShapes(shapes || []); },
    resize() { cg.redrawAll(); },
    show(v) { el.classList.toggle('hidden', !v); if (v) requestAnimationFrame(() => cg.redrawAll()); },
    destroy() { cg.destroy(); el.remove(); },
    api: cg,
  };
}
