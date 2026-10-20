// Position helpers shared by the facade and the renderers.
// Pieces are stored as Map<key, { color: 'white'|'black', role: 'pawn'|'knight'|'bishop'|'rook'|'queen'|'king' }>.

export const FILES = 'abcdefgh';
export const ROLES = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];
export const ROLE_LETTER = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };
export const LETTER_ROLE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1';

export const ALL_KEYS = [];
for (let r = 1; r <= 8; r++) for (const f of FILES) ALL_KEYS.push(f + r);

export function key2pos(key) { return [FILES.indexOf(key[0]), Number(key[1]) - 1]; }
export function pos2key(x, y) { return FILES[x] + (y + 1); }

/** FEN placement field → pieces map. */
export function placementToPieces(placement) {
  const map = new Map();
  const rows = String(placement || '').split(' ')[0].split('/');
  for (let i = 0; i < 8 && i < rows.length; i++) {
    const rank = 8 - i;
    let file = 0;
    for (const ch of rows[i]) {
      if (/\d/.test(ch)) { file += Number(ch); continue; }
      const role = LETTER_ROLE[ch.toLowerCase()];
      if (role && file < 8) map.set(FILES[file] + rank, { color: ch === ch.toUpperCase() ? 'white' : 'black', role });
      file++;
    }
  }
  return map;
}

/** pieces map → FEN placement field. */
export function piecesToPlacement(map) {
  const rows = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = '', empty = 0;
    for (const f of FILES) {
      const p = map.get(f + rank);
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      const l = ROLE_LETTER[p.role];
      row += p.color === 'white' ? l.toUpperCase() : l;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join('/');
}

/** Castling rights that are still physically possible (king + rook on their start squares). */
export function inferCastling(map) {
  let s = '';
  const is = (key, color, role) => { const p = map.get(key); return p && p.color === color && p.role === role; };
  if (is('e1', 'white', 'king')) { if (is('h1', 'white', 'rook')) s += 'K'; if (is('a1', 'white', 'rook')) s += 'Q'; }
  if (is('e8', 'black', 'king')) { if (is('h8', 'black', 'rook')) s += 'k'; if (is('a8', 'black', 'rook')) s += 'q'; }
  return s || '-';
}

/** Compose a full FEN from a pieces map (free mode). Castling rights are inferred, en passant cleared. */
export function composeFen(map, turn = 'white', castling) {
  const rights = castling == null ? inferCastling(map) : (castling || '-');
  return `${piecesToPlacement(map)} ${turn === 'black' ? 'b' : 'w'} ${rights} - 0 1`;
}

export function fenTurn(fen) { return (String(fen).split(' ')[1] || 'w') === 'b' ? 'black' : 'white'; }

/** chess.js board() → pieces map. */
export function chessToPieces(chess) {
  const map = new Map();
  const board = chess.board();
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const sq = board[r][f];
    if (sq) map.set(sq.square, { color: sq.color === 'w' ? 'white' : 'black', role: LETTER_ROLE[sq.type] });
  }
  return map;
}

/** Legal destinations map (chessground format) from chess.js. */
export function chessDests(chess) {
  const dests = new Map();
  for (const m of chess.moves({ verbose: true })) {
    const arr = dests.get(m.from) || [];
    if (!arr.includes(m.to)) arr.push(m.to);
    dests.set(m.from, arr);
  }
  return dests;
}

export function findKing(map, color) {
  for (const [k, p] of map) if (p.color === color && p.role === 'king') return k;
  return null;
}

export const cloneMap = (m) => new Map([...m].map(([k, v]) => [k, { ...v }]));
