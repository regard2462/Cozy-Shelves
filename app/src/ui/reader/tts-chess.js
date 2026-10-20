// Chess notation spoken in words. A voice reads "1. e4 e5 2. Sf3" as "eins Punkt e vier e fünf zwei Punkt es eff drei"
// and ends a sentence after every move number; "0-0" becomes "null null" and "#" "Nummer". Here the moves become what a
// person says: "1. e4" → "1, e vier", "Sf6" → "Springer f sechs", "Lxe5+" → "Läufer schlägt e fünf, Schach",
// "0-0" → "kurze Rochade", "e8=D" → "e acht, wird Dame". Figurines (♘f3) and the English letters of figurine fonts
// (Nf3) are understood as well. Move numbers stay digits ("12, Springer f sechs"): the German text normalizer and the
// English voice say them. Pure functions, also used by the Node tests (electron/tts/test-reading.js).

const FIGURINE = { '♔': 'K', '♕': 'Q', '♖': 'R', '♗': 'B', '♘': 'N', '♙': 'P', '♚': 'K', '♛': 'Q', '♜': 'R', '♝': 'B', '♞': 'N', '♟': 'P' };
const PIECE_WORD = {
  de: { K: 'König', Q: 'Dame', D: 'Dame', R: 'Turm', T: 'Turm', B: 'Läufer', L: 'Läufer', N: 'Springer', S: 'Springer', P: 'Bauer' },
  en: { K: 'king', Q: 'queen', D: 'queen', R: 'rook', T: 'rook', B: 'bishop', L: 'bishop', N: 'knight', S: 'knight', P: 'pawn' },
};
const RANK = {
  de: ['', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht'],
  en: ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'],
};
const WORDS = {
  de: { takes: 'schlägt', check: 'Schach', mate: 'matt', promotes: 'wird', ep: 'en passant', short: 'kurze Rochade', long: 'lange Rochade', to: '' },
  en: { takes: 'takes', check: 'check', mate: 'mate', promotes: 'promotes to', ep: 'en passant', short: 'castles kingside', long: 'castles queenside', to: '' },
};
const RESULT = {
  de: { '1-0': 'Weiß gewinnt', '0-1': 'Schwarz gewinnt', '½-½': 'Remis', '1/2-1/2': 'Remis' },
  en: { '1-0': 'White wins', '0-1': 'Black wins', '½-½': 'draw', '1/2-1/2': 'draw' },
};
// evaluation signs of chess books (Informator style)
const EVAL = {
  de: { '+-': 'Weiß steht auf Gewinn', '-+': 'Schwarz steht auf Gewinn', '±': 'Weiß steht besser', '∓': 'Schwarz steht besser', '⩲': 'Weiß steht etwas besser', '⩱': 'Schwarz steht etwas besser', '+=': 'Weiß steht etwas besser', '=+': 'Schwarz steht etwas besser', '∞': 'unklar', '=': 'ausgeglichen' },
  en: { '+-': 'White is winning', '-+': 'Black is winning', '±': 'White is better', '∓': 'Black is better', '⩲': 'White is slightly better', '⩱': 'Black is slightly better', '+=': 'White is slightly better', '=+': 'Black is slightly better', '∞': 'unclear', '=': 'equal' },
};

const P = '[KQRBNDTLS♔♕♖♗♘♙♚♛♜♝♞♟]';
const PROMO = '[QRBNDTLS♕♖♗♘♛♜♝♞]';
const SQ = '[a-h][1-8]';
// one move: piece move, pawn capture, pawn move or long notation; promotion, en passant, check or mate, annotation
const MOVE_SRC = `(?:(${P})?(${SQ})([-x:×])(${SQ})|(${P})([a-h]?[1-8]?)([x:×]?)(${SQ})|([a-h])([x:×])(${SQ})|(${SQ}))` +
  `(?:(=|\\/)?(${PROMO}))?((?:\\s?e\\.\\s?p\\.)?)((?:\\+\\+|[+†#‡]))?([!?]{1,2})?`;
const CASTLE_SRC = '(0-0-0|O-O-O|0-0|O-O)((?:\\+\\+|[+†#‡]))?([!?]{1,2})?';
const BOUND_L = '(?<![\\p{L}\\d])';
const BOUND_R = '(?![\\p{L}\\d=])';
const MOVE_RE = new RegExp(`${BOUND_L}(?:${CASTLE_SRC}|${MOVE_SRC})${BOUND_R}`, 'gu');
const NUMBER_RE = new RegExp(`${BOUND_L}(\\d{1,3})\\s?\\.(\\.\\.|…|\\s?\\.\\.\\.)?\\s?(?=(?:${CASTLE_SRC}|${MOVE_SRC})${BOUND_R})`, 'gu');
const TOKEN_RE = new RegExp(`^(?:\\d{1,3}\\.(?:\\.\\.|…)?)?(?:${CASTLE_SRC}|${MOVE_SRC})$`, 'u');
const PIECE_MOVE_RE = new RegExp(`${BOUND_L}${P}[a-h]?[1-8]?[x:×]?${SQ}(?![\\p{L}\\d])`, 'u');
const NUMBERED_RE = new RegExp(`${BOUND_L}\\d{1,3}\\s?\\.(?:\\.\\.|…)?\\s?(?:${SQ}|${P}[a-h]?[x:×]?${SQ}|0-0|O-O)`, 'u');
const EVAL_TOKENS = ['+-', '-+', '±', '∓', '⩲', '⩱', '+=', '=+', '∞'];
const RESULT_RE = /(?<![\p{L}\d])(1-0|0-1|½-½|1\/2-1\/2)(?![\p{L}\d])/gu;

/** One token (punctuation at the ends allowed) of chess notation: "Sf3", "exd5", "1.e4", "12...Sf6", "0-0", "♘f3", "±". */
export function isChessToken(token) {
  const t = String(token || '').replace(/^[(\[„"“']+/, '').replace(/[)\],;:"”']+$/, '');
  if (!t) return false;
  if (EVAL_TOKENS.includes(t) || /^(1-0|0-1|½-½)$/.test(t)) return true;
  if (/[♔♕♖♗♘♙♚♛♜♝♞♟]/u.test(t)) return true;
  return TOKEN_RE.test(t) || TOKEN_RE.test(t.replace(/\.$/, ''));
}

const STARTS_RE = new RegExp(`^\\s*(?:\\d{1,3}\\s?\\.(?:\\.\\.|…)?\\s?)?(?:${CASTLE_SRC}|${MOVE_SRC})${BOUND_R}`, 'u');
/** Does the text begin with a move ("Sf3 …", "13. Lxf7+ …", "0-0 …")? For the sentence splitter. */
export const startsWithMove = (text) => STARTS_RE.test(String(text || ''));

/**
 * Does the text contain chess notation? Figurines, a move number before a move ("1. e4", "12...Sf6"), a piece move
 * ("Sf3", "Lxe5") or castling next to another move. In a chess book (`chessBook`) one pawn move ("e4") is enough.
 */
export function hasChessNotation(text, { chessBook = false } = {}) {
  const s = String(text || '');
  if (/[♔♕♖♗♘♙♚♛♜♝♞♟]/u.test(s)) return true;
  if (NUMBERED_RE.test(s)) return true;
  const moves = s.match(MOVE_RE) || [];
  if (PIECE_MOVE_RE.test(s) && moves.length >= 1 && /[KQRBNDTLS][a-h]?[1-8]?[x:×]?[a-h][1-8]/.test(moves.join(' '))) {
    // a single "Le3" in prose could be anything; two moves or a capture are chess
    if (moves.length >= 2 || /[x:×]/.test(moves.join(' '))) return true;
  }
  if (chessBook && moves.length >= 1) return true;
  return false;
}

/**
 * Writes chess notation out in words for the voice of `lang` ('de' or 'en'). Text without chess notation comes back
 * unchanged (see hasChessNotation; `chessBook` lowers the bar).
 */
export function speakChess(text, lang = 'de', { chessBook = false } = {}) {
  let s = String(text || '');
  if (!hasChessNotation(s, { chessBook })) return s;
  const L = lang === 'en' ? 'en' : 'de';
  const W = WORDS[L];
  const piece = (c) => PIECE_WORD[L][FIGURINE[c] || c] || c;
  // English letters are spoken as letter names ("A" is "ay"; a small "a" would be the article)
  const file = (f) => (L === 'en' ? f.toUpperCase() : f);
  const square = (sq) => `${file(sq[0])} ${RANK[L][+sq[1]]}`;
  const tail = (promo, ep, check) => {
    const out = [];
    if (promo) out.push(`${W.promotes} ${piece(promo)}`);
    if (ep && ep.trim()) out.push(W.ep);
    if (check) out.push(/^[#‡]$/.test(check) ? W.mate : W.check);
    return out.length ? ', ' + out.join(', ') : '';
  };
  const spell = (m, castle, cCheck, cNote, lPiece, lFrom, lSep, lTo, pPiece, pDis, pCap, pTo, fFile, fCap, fTo, sq, promoSep, promo, ep, check) => {
    if (castle) return (castle.length > 3 ? W.long : W.short) + tail(null, null, cCheck);
    if (lFrom) {   // long notation: Sg1-f3, e2-e4, Lb5xc6
      const head = lPiece ? piece(lPiece) + ' ' : '';
      const cap = /[x:×]/.test(lSep) ? ` ${W.takes}` : '';
      return `${head}${square(lFrom)}${cap} ${square(lTo)}${tail(promo, ep, check)}`;
    }
    if (pTo) {     // piece move: Sf3, Sbd7, Lxe5
      const dis = pDis ? ' ' + pDis.split('').map((c) => (/\d/.test(c) ? RANK[L][+c] : file(c))).join(' ') : '';
      return `${piece(pPiece)}${dis}${pCap ? ' ' + W.takes : ''} ${square(pTo)}${tail(promo, ep, check)}`;
    }
    if (fTo) return `${file(fFile)} ${W.takes} ${square(fTo)}${tail(promo, ep, check)}`;   // exd5
    return `${square(sq)}${tail(promo, ep, check)}`;                                           // e4
  };
  // move numbers first: "12...Sf6" → "12, Sf6", "1.e4" → "1, e4"
  s = s.replace(NUMBER_RE, (m, num) => `${num}, `);
  // every move ends with a marker; a comma there gives a short pause before the next move or word ("e vier, e fünf,
  // 2, Springer f drei"), but not before punctuation
  s = s.replace(MOVE_RE, (...args) => spell(...args) + MOVE_END);
  s = s.replace(MOVE_PAUSE_RE, (m, space, at, all) => (/^(?:[.,;:!?)\]]|$)/.test(all.slice(at + m.length)) ? '' : ', '));
  // results and evaluation signs standing on their own
  s = s.replace(RESULT_RE, (m) => RESULT[L][m] || m);
  s = s.replace(EVAL_RE, (m, pre, sign) => `${pre}${EVAL[L][sign]}`);
  return s.replace(/,\s*,/g, ',').replace(/\s+,/g, ',').replace(/,(?=[.;:!?])/g, '').replace(/\s{2,}/g, ' ').trim();
}
const MOVE_END = '\u0001';
// the end of a spelled move and the white space after it
const MOVE_PAUSE_RE = /\u0001(\s*)/g;
const EVAL_RE = /(^|\s)(\+-|-\+|±|∓|⩲|⩱|\+=|=\+|∞|=)(?=\s|[.,;]|$)/gu;
