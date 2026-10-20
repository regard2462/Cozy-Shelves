// SAN helpers: tokenise move text from chess books (German + English notation) and pretty-print moves.

const GERMAN = { K: 'K', D: 'Q', T: 'R', L: 'B', S: 'N' };
const FIGURINE = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
const FIGURINE_BLACK = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞' };
const GERMAN_LETTER = { K: 'K', Q: 'D', R: 'T', B: 'L', N: 'S' };

/** Strip comments {…}, variations (…), NAGs and result markers. */
function stripAnnotations(text) {
  let out = '', depthBrace = 0, depthParen = 0;
  for (const ch of text) {
    if (ch === '{') { depthBrace++; continue; }
    if (ch === '}') { depthBrace = Math.max(0, depthBrace - 1); out += ' '; continue; }
    if (depthBrace) continue;
    if (ch === '(') { depthParen++; continue; }
    if (ch === ')') { depthParen = Math.max(0, depthParen - 1); out += ' '; continue; }
    if (depthParen) continue;
    out += ch;
  }
  return out.replace(/;[^\n]*/g, ' ').replace(/\$\d+/g, ' ');
}

/**
 * Normalise a single move token to English SAN understood by chess.js.
 * Accepts German piece letters (S, L, T, D), "0-0", captures with x / : / ×, e.p., check marks and glyphs.
 * Returns null when the token is not a move (move numbers, results, dots…).
 */
export function normalizeSan(token) {
  let t = String(token || '').trim();
  if (!t) return null;
  t = t.replace(/^\d+\s*\.{1,3}\s*/, '').replace(/^\.+/, '');            // "12." / "12..." prefixes
  t = t.replace(/^…/, '');
  if (!t) return null;
  if (/^(1-0|0-1|1\/2-1\/2|½-½|\*)$/.test(t)) return null;
  t = t.replace(/[!?]+$/g, '').replace(/[+#‡†]+$/g, '').replace(/\s*e\.?\s*p\.?$/i, '');
  t = t.replace(/[:×]/g, 'x').replace(/–|—/g, '-');
  if (/^[0O](-[0O]){1,2}$/i.test(t)) return t.length > 3 ? 'O-O-O' : 'O-O';
  // German piece letters → English (S=Springer, L=Läufer, T=Turm, D=Dame); K is identical
  if (/^[SLTD]/.test(t)) t = GERMAN[t[0]] + t.slice(1);
  // promotion: e8D / e8=D / e8(D) / e8/D
  t = t.replace(/[=\/(]?([QRBNDTLS])\)?$/i, (m, p) => {
    const up = p.toUpperCase();
    return '=' + (GERMAN[up] && up !== 'K' && up !== 'B' ? GERMAN[up] : up);
  });
  // "e8=B" could be a German "Bauer"? never used for promotion – treat as bishop (English)
  t = t.replace(/^P/, '');
  if (!/[a-h][1-8]|O-O/.test(t)) return null;
  return t;
}

/**
 * Parse free move text ("1.e4 e5 2.Sf3 Sc6 3.Lb5") into a list of normalised SAN tokens.
 * Returns [{ san, raw }].
 */
export function parseMoveText(text) {
  const clean = stripAnnotations(String(text || '').replace(/([a-h][18])\(([QRBNDTLS])\)/gi, '$1=$2'));
  // separate move numbers glued to moves: "1.e4" → "1. e4", "2...Sc6" → "2... Sc6"
  const spaced = clean.replace(/(\d+)\.(\.\.|…)?\s*/g, '$1.$2 ');
  const tokens = spaced.split(/\s+/).filter(Boolean);
  const out = [];
  for (const raw of tokens) {
    if (/^\d+\.(\.\.|…)?$/.test(raw)) continue;
    if (/^(\.\.\.|…)$/.test(raw)) continue;
    const san = normalizeSan(raw);
    if (san) out.push({ san, raw });
  }
  return out;
}

/** Pretty SAN with figurines ("Nf3+" → "♘f3+"). */
export function figurine(san, color = 'w') {
  if (!san) return '';
  const map = color === 'b' ? FIGURINE_BLACK : FIGURINE;
  return san.replace(/^([KQRBN])/, (m) => map[m]).replace(/=([QRBN])/, (m, p) => '=' + map[p]);
}

/** SAN in German letters ("Nf3" → "Sf3"). */
export function germanSan(san) {
  if (!san) return '';
  return san.replace(/^([KQRBN])/, (m) => GERMAN_LETTER[m]).replace(/=([QRBN])/, (m, p) => '=' + GERMAN_LETTER[p]);
}

/** Format a move list as "1. e4 e5 2. Nf3 …" starting from a given full-move number and colour. */
export function formatMoves(sans, { startMove = 1, startColor = 'w', german = false } = {}) {
  const parts = [];
  let num = startMove, color = startColor;
  sans.forEach((san, i) => {
    const s = german ? germanSan(san) : san;
    if (color === 'w') parts.push(`${num}. ${s}`);
    else parts.push(i === 0 ? `${num}... ${s}` : s);
    if (color === 'b') num++;
    color = color === 'w' ? 'b' : 'w';
  });
  return parts.join(' ');
}
