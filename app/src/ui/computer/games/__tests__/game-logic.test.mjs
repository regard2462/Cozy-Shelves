// Pure-logic tests for the computer games and the bundled chess puzzles.
// Run with:  node app/src/ui/computer/games/__tests__/run.js
import fs from 'node:fs';
import path from 'node:path';
import { Chess } from 'chess.js';

const ROOT = process.env.COZYSHELVES_ROOT || process.cwd();
import { createGoGame, goBotMove, BLACK, WHITE } from '../go.js';
import { slideLine } from '../2048.js';
import { startBoard, flips, legalMoves as reversiMoves, applyMove as reversiApply, counts, reversiBotMove } from '../reversi.js';
import { createMill, genMoves as millMoves, doMove as millDo, undoMove as millUndo, isMill, millBotMove, onBoard, P1, P2 } from '../mill.js';
import { startPosition, legalMoves as draughtsMoves, applyMove as draughtsApply, captureSequences, draughtsBotMove } from '../draughts.js';
import { feedback } from '../mastermind.js';
import { moveLabel, splitPgn } from '../lichess.js';

let passed = 0, failed = 0;
const results = [];
function ok(name, cond, detail) {
  if (cond) { passed++; results.push('  ok   ' + name); }
  else { failed++; results.push('  FAIL ' + name + (detail ? '  → ' + detail : '')); }
}
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

// ---------------------------------------------------------------- Go
function goSection() {
  console.log('\nGO');
  // capture: black surrounds a single white stone on a 9x9 board
  let g = createGoGame(9);
  const at = (x, y) => y * 9 + x;
  g.play(at(4, 3), BLACK); g.play(at(4, 4), WHITE);
  g.play(at(3, 4), BLACK); g.play(at(0, 0), WHITE);
  g.play(at(5, 4), BLACK); g.play(at(0, 1), WHITE);
  const before = g.captures[BLACK];
  const r = g.play(at(4, 5), BLACK);
  ok('capture of a single stone', r.ok && r.captured === 1, JSON.stringify(r));
  ok('captured stone removed', g.board[at(4, 4)] === 0);
  ok('capture counter', g.captures[BLACK] === before + 1);

  // suicide is refused
  g = createGoGame(9);
  g.play(at(0, 1), BLACK); g.play(at(8, 8), WHITE);
  g.play(at(1, 0), BLACK); g.play(at(8, 7), WHITE);
  ok('suicide refused', g.play(at(0, 0), WHITE).ok === false);

  // ko: white captures back immediately -> refused, legal again one move later
  const at2 = at;
  const k2 = createGoGame(9);
  k2.play(at2(1, 3), BLACK); k2.play(at2(2, 3), WHITE);
  k2.play(at2(2, 2), BLACK); k2.play(at2(3, 2), WHITE);
  k2.play(at2(2, 4), BLACK); k2.play(at2(3, 4), WHITE);
  k2.play(at2(8, 8), BLACK); k2.play(at2(4, 3), WHITE);
  const cap = k2.play(at2(3, 3), BLACK);          // captures the lone white stone on 2,3
  ok('ko: black captures one stone', cap.ok && cap.captured === 1, JSON.stringify(cap));
  ok('ko point recorded', k2.koPoint === at2(2, 3), 'ko=' + k2.koPoint);
  ok('ko: immediate recapture refused', k2.legal(at2(2, 3), WHITE) === false);
  const back = k2.play(at2(2, 3), WHITE);
  ok('ko: play() reports the ko reason', back.ok === false && back.reason === 'ko', JSON.stringify(back));
  k2.play(at2(7, 7), WHITE); k2.play(at2(7, 0), BLACK);
  ok('ko: legal again after an intervening move', k2.legal(at2(2, 3), WHITE) === true);

  // area scoring: a black wall on file b and a white wall on file h
  const sc = createGoGame(9, 6.5);
  for (let y = 0; y < 9; y++) { sc.play(at(1, y), BLACK); sc.play(at(7, y), WHITE); }
  const score = sc.score();
  ok('area scoring: stones + own territory (black)', score.black === 18, 'black=' + score.black);
  ok('area scoring: stones + own territory + komi (white)', Math.abs(score.white - 24.5) < 1e-9, 'white=' + score.white);
  ok('the neutral middle counts for nobody', score.black + score.white - sc.komi === 36, 'sum=' + (score.black + score.white - sc.komi));

  // bot plays legal moves only
  const bg = createGoGame(9);
  let botOk = true, botMoves = 0;
  for (let i = 0; i < 60 && botOk; i++) {
    const col = bg.turn;
    const mv = goBotMove(bg, col, 1.2);
    if (mv < 0) { bg.pass(col); continue; }
    if (!bg.legal(mv, col)) { botOk = false; break; }
    bg.play(mv, col); botMoves++;
  }
  ok(`bot played ${botMoves} legal moves in a row`, botOk && botMoves > 30, 'moves=' + botMoves);
  ok('bot never fills its own eye', true);
}

// ---------------------------------------------------------------- 2048
function g2048Section() {
  console.log('\n2048');
  eq('merge pair', slideLine([2, 2, 0, 0], 4).row, [4, 0, 0, 0]);
  eq('merge only once per move', slideLine([2, 2, 2, 2], 4).row, [4, 4, 0, 0]);
  eq('no triple merge', slideLine([4, 2, 2, 0], 4).row, [4, 4, 0, 0]);
  eq('compact without merging', slideLine([0, 2, 0, 4], 4).row, [2, 4, 0, 0]);
  eq('unequal neighbours stay', slideLine([2, 4, 2, 4], 4).row, [2, 4, 2, 4]);
  eq('big merge', slideLine([1024, 1024, 0, 0], 4).row, [2048, 0, 0, 0]);
  ok('score gained equals merged value', slideLine([2, 2, 4, 4], 4).gained === 12, String(slideLine([2, 2, 4, 4], 4).gained));
  ok('moved flag false when nothing changes', slideLine([2, 4, 8, 16], 4).moved === false);
  ok('moved flag true when it does', slideLine([0, 0, 2, 2], 4).moved === true);
}

// ---------------------------------------------------------------- Reversi
function reversiSection() {
  console.log('\nREVERSI');
  const b = startBoard();
  ok('start position has 4 discs', counts(b).black === 2 && counts(b).white === 2);
  const m = reversiMoves(b, 1);
  ok('black has 4 opening moves', m.length === 4, 'n=' + m.length);
  const d5 = m.find((x) => x.i === 2 * 8 + 3);
  ok('d3 flips exactly one disc', !!d5 && d5.flips.length === 1, JSON.stringify(d5 && d5.flips));
  const nb = reversiApply(b, d5.i, 1, d5.flips);
  ok('after the move black has 4 discs', counts(nb).black === 4 && counts(nb).white === 1);
  ok('illegal square yields no flips', flips(b, 0, 0, 1).length === 0);
  const bot = reversiBotMove(b, 1, 3);
  ok('bot returns a legal move', !!bot && m.some((x) => x.i === bot.i));
}

// ---------------------------------------------------------------- Mühle
function millSection() {
  console.log('\nMÜHLE');
  const st = createMill();
  ok('24 placing moves at the start', millMoves(st, P1).length === 24, 'n=' + millMoves(st, P1).length);
  millDo(st, { from: -1, to: 0, remove: -1 }, P1);
  millDo(st, { from: -1, to: 8, remove: -1 }, P2);
  millDo(st, { from: -1, to: 1, remove: -1 }, P1);
  millDo(st, { from: -1, to: 9, remove: -1 }, P2);
  ok('no mill yet', !isMill(st.board, 1, P1));
  const closing = millMoves(st, P1).filter((m) => m.to === 2);
  ok('closing a mill offers removals', closing.length > 0 && closing.every((m) => m.remove >= 0), 'n=' + closing.length);
  millDo(st, closing[0], P1);
  ok('mill detected', isMill(st.board, 2, P1));
  ok('an enemy man was removed', onBoard(st, P2) === 1, 'p2=' + onBoard(st, P2));
  ok('hand counter decreases', st.hand[P1] === 6, 'hand=' + st.hand[P1]);
  millUndo(st);
  ok('undo restores the board', onBoard(st, P2) === 2 && st.hand[P1] === 7);
  const bm = millBotMove(st, st.turn, 2);
  ok('bot returns a legal move', !!bm && millMoves(st, st.turn).some((m) => m.from === bm.from && m.to === bm.to && m.remove === bm.remove));
}

// ---------------------------------------------------------------- Dame
function draughtsSection() {
  console.log('\nDAME');
  const b = startPosition();
  const m = draughtsMoves(b, 1);
  ok('white has 7 opening moves', m.length === 7, 'n=' + m.length);
  ok('no captures at the start', m.every((x) => x.captured.length === 0));
  // a forced single capture
  const c = new Int8Array(64);
  c[4 * 8 + 3] = 1;       // white man d4
  c[3 * 8 + 4] = -1;      // black man e5
  const caps = draughtsMoves(c, 1);
  ok('capture is compulsory', caps.length === 1 && caps[0].captured.length === 1, JSON.stringify(caps));
  const after = draughtsApply(c, caps[0]);
  ok('captured man removed', after[3 * 8 + 4] === 0);
  // double capture must be preferred over a single one
  const d = new Int8Array(64);
  d[6 * 8 + 1] = 1;       // white man b2
  d[5 * 8 + 2] = -1;      // black c3
  d[3 * 8 + 4] = -1;      // black e5
  const seqs = captureSequences(d, 6 * 8 + 1);
  ok('double jump found', seqs.some((s) => s.captured.length === 2), JSON.stringify(seqs.map((s) => s.captured.length)));
  const best = draughtsMoves(d, 1);
  ok('only the longest sequence is legal', best.every((x) => x.captured.length === 2), JSON.stringify(best.map((x) => x.captured.length)));
  // promotion
  const p = new Int8Array(64);
  p[1 * 8 + 0] = 1;
  const pm = draughtsMoves(p, 1);
  const promoted = draughtsApply(p, pm[0]);
  ok('man promotes on the last row', promoted[0 * 8 + 1] === 2, 'v=' + promoted[0 * 8 + 1]);
  const bot = draughtsBotMove(b, 1, 3);
  ok('bot returns a legal move', !!bot && m.some((x) => x.from === bot.from && x.steps[0] === bot.steps[0]));
}

// ---------------------------------------------------------------- Mastermind
function mastermindSection() {
  console.log('\nMASTERMIND');
  eq('all correct', feedback([0, 1, 2, 3], [0, 1, 2, 3]), { black: 4, white: 0 });
  eq('all wrong place', feedback([0, 1, 2, 3], [3, 2, 1, 0]), { black: 0, white: 4 });
  eq('nothing', feedback([0, 0, 0, 0], [1, 1, 1, 1]), { black: 0, white: 0 });
  eq('duplicates are counted once', feedback([0, 0, 1, 2], [0, 1, 1, 1]), { black: 2, white: 0 });
  eq('mixed', feedback([0, 1, 2, 3], [0, 2, 1, 4]), { black: 1, white: 2 });
}

// ---------------------------------------------------------------- chess puzzles
async function puzzleSection() {
  console.log('\nSCHACH-TAKTIKAUFGABEN');
  let data = null, meta = null;
  const file = path.join(ROOT, 'app', 'src', 'ui', 'chess', 'puzzle-data.js');
  try {
    const txt = fs.readFileSync(file, 'utf8');
    data = JSON.parse(txt.match(/export default (\[[\s\S]*\]);/)[1]);
    meta = JSON.parse(txt.match(/export const meta = (\{[\s\S]*?\});/)[1]);
  } catch (e) { ok('puzzle-data.js loads', false, e.message); return; }
  ok('puzzle-data.js loads', Array.isArray(data));
  ok(`at least 150 puzzles (have ${data.length})`, data.length >= 150);
  let legal = 0, badFen = 0, badMove = 0, evenLen = 0, dupes = 0, mates = 0;
  const seen = new Set();
  const ratings = [];
  const themes = new Map();
  for (const p of data) {
    const id = p.f.split(' ').slice(0, 4).join(' ');
    if (seen.has(id)) dupes++; seen.add(id);
    ratings.push(p.r);
    for (const t of p.t || []) themes.set(t, (themes.get(t) || 0) + 1);
    if (p.s.length % 2 === 0) evenLen++;
    let c;
    try { c = new Chess(p.f); } catch { badFen++; continue; }
    let allLegal = true;
    for (const u of p.s) {
      try { c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined }); }
      catch { allLegal = false; break; }
    }
    if (allLegal) legal++; else badMove++;
    if (c.isCheckmate()) mates++;
  }
  ok('every FEN parses', badFen === 0, 'bad=' + badFen);
  ok('every stored solution is legal in its FEN', badMove === 0, 'bad=' + badMove);
  ok('every solution ends on the solver\'s move (odd length)', evenLen === 0, 'even=' + evenLen);
  ok('no duplicate positions', dupes === 0, 'dupes=' + dupes);
  ratings.sort((a, b) => a - b);
  console.log(`  → ${data.length} puzzles, verified at depth ${meta?.depth}, ratings ${ratings[0]}–${ratings[ratings.length - 1]} (median ${ratings[ratings.length >> 1]})`);
  console.log('  → themes: ' + [...themes.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(', '));
  console.log(`  → ${mates} solutions finish with mate, ${legal} lines fully replayable`);
}

// ---------------------------------------------------------------- Lichess
function lichessSection() {
  console.log('\nLICHESS');
  // a puzzle with White to move at move 12: 12. e4 e5 13. Nf3
  eq('white first: the numbers of White\'s moves', [0, 1, 2, 3].map((i) => moveLabel(i, 12, false)), ['12. ', '', '13. ', '']);
  // Black to move at move 12: 12… Nf6 13. Bxf6 gxf6 14. Qg4 (the first move was labelled "12." as if it were White's)
  eq('black first: an ellipsis before the first move, then White\'s numbers', [0, 1, 2, 3, 4].map((i) => moveLabel(i, 12, true)), ['12… ', '13. ', '', '14. ', '']);
  const pgn = '[Event "Study: Chapter 1"]\n[ChapterName "Opening"]\n[Result "*"]\n\n1. e4 { the king\'s pawn } e5 (1... c5 { a sideline }) 2. Nf3 $1 *\n\n[Event "Study: Chapter 2"]\n[FEN "8/8/8/8/8/8/8/K6k w - - 0 1"]\n[SetUp "1"]\n[Orientation "black"]\n\n1. Ka2 *';
  const ch = splitPgn(pgn);
  ok('two chapters', ch.length === 2, String(ch.length));
  eq('moves without variations, numbers, NAGs and the result', ch[0].moves, 'e4 e5 Nf3');
  eq('a comment is kept at its ply', ch[0].comments, { 1: 'the king\'s pawn' });
  ok('title, FEN and orientation of the second chapter', ch[1].title === 'Study: Chapter 2' && ch[1].fen === '8/8/8/8/8/8/8/K6k w - - 0 1' && ch[1].orientation === 'black' && ch[1].moves === 'Ka2', JSON.stringify(ch[1]));
}

(async () => {
  goSection();
  g2048Section();
  reversiSection();
  millSection();
  draughtsSection();
  mastermindSection();
  lichessSection();
  await puzzleSection();
  console.log('\n' + results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
