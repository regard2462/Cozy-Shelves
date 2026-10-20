#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * generate-puzzles.js – erzeugt den mitgelieferten Taktik-Datensatz `puzzle-data.js`.
 *
 *   node app/src/ui/chess/generate-puzzles.js --target 180 --games 400
 *
 * Wie es funktioniert
 * -------------------
 * 1. SELBSTSPIEL: Zwei Stockfish-Instanzen (dieselbe WASM-Engine, die auch die App benutzt) spielen
 *    Partien gegeneinander. Die Eröffnung wird zufällig aus einer Liste gewählt, und in 14 % der Züge
 *    spielt die Engine absichtlich einen zufälligen legalen Zug. Genau diese Patzer erzeugen die
 *    taktischen Stellungen, die ein Rätsel ausmachen.
 * 2. VORFILTER: Jede entstandene Stellung wird kurz (MultiPV 2, feste Knotenzahl) untersucht.
 *    Interessant ist sie nur, wenn der beste Zug deutlich besser ist als der zweitbeste.
 * 3. VERIFIKATION: Die Überlebenden werden mit Tiefe `--depth` (Standard 20, MultiPV 2) nachgerechnet.
 *    Nur wenn der beste Zug dort bestätigt wird UND der Abstand zum zweitbesten Zug groß bleibt,
 *    landet die Stellung im Datensatz. Die gespeicherte Lösung ist die Hauptvariante der Verifikation.
 * 4. Doppelte Stellungen (gleiche FEN) werden verworfen, Thema und Wertung werden aus dem Zug,
 *    dem Materialeinsatz und der Länge der Lösung abgeleitet.
 *
 * Die Zwischenergebnisse werden fortlaufend nach `puzzles.jsonl` geschrieben, der Lauf ist also
 * jederzeit abbrechbar und wiederholbar (`--resume`).
 */
const fs = require('fs');
const path = require('path');
const { Chess } = require('chess.js');
const { spawn } = require('child_process');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..', '..', '..', '..');
const ENGINE_JS = path.join(ROOT, 'node_modules', 'stockfish', 'bin', 'stockfish-18-lite-single.js');

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt; };
const flag = (name) => argv.includes('--' + name);
const TARGET = +arg('target', 180);
const GAMES = +arg('games', 400);
const DEPTH = +arg('depth', 20);
const SCAN_NODES = +arg('nodes', 90000);
const OUT = path.join(HERE, arg('out', 'puzzle-data.js'));
const JSONL = path.join(HERE, 'puzzles.jsonl');
const SEED = +arg('seed', 20260919);
const WORKERS = Math.max(1, +arg('workers', Math.min(5, Math.max(1, require('os').cpus().length - 3))));
const PLAYERS = Math.max(1, +arg('players', 2));
const MAX_PER_GAME = Math.max(1, +arg('per-game', 3));
const MATES_ONLY = flag('mates');   // second pass: only keep forced mates, for a better theme mix

// deterministic RNG so a re-run reproduces the same games
let seed = SEED >>> 0;
function rnd() { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; }
const pick = (a) => a[(rnd() * a.length) | 0];
function shuffleInPlace(a) { for (let i = a.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }

const OPENINGS = [
  'e4 e5', 'e4 c5', 'e4 e6', 'e4 c6', 'e4 d5', 'e4 d6', 'e4 Nf6', 'e4 g6',
  'd4 d5', 'd4 Nf6', 'd4 f5', 'd4 e6', 'd4 d6', 'd4 g6',
  'c4 e5', 'c4 c5', 'c4 Nf6', 'c4 e6', 'Nf3 d5', 'Nf3 Nf6', 'g3 d5', 'b3 e5', 'f4 d5', 'Nc3 d5',
];

// ---------------------------------------------------------------- engine wrapper
// Every engine runs as its own node child process (stockfish-18-lite-single.js has a UCI CLI mode),
// so the player and the judge cannot disturb each other's options.
function createEngine(label) {
  const child = spawn(process.execPath, [ENGINE_JS], { stdio: ['pipe', 'pipe', 'inherit'] });
  const listeners = new Set();
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) for (const fn of [...listeners]) fn(line);
    }
  });
  const onLine = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const send = (cmd) => { try { child.stdin.write(cmd + '\n'); } catch { /* ignore */ } };
  const waitFor = (test, timeout = 180000) => new Promise((res, rej) => {
    const t = setTimeout(() => { off(); rej(new Error(`engine timeout (${label})`)); }, timeout);
    const off = onLine((l) => { if (test(l)) { clearTimeout(t); off(); res(l); } });
  });
  return {
    label, send, onLine,
    async init(opts = {}) {
      send('uci'); await waitFor((l) => l === 'uciok');
      for (const [k, v] of Object.entries(opts)) send(`setoption name ${k} value ${v}`);
      send('isready'); await waitFor((l) => l === 'readyok');
    },
    /** go with the given limit; returns { best, lines: { 1: info, 2: info } } */
    async go(fen, limit) {
      const lines = {};
      const off = onLine((l) => {
        if (!l.startsWith('info ')) return;
        const info = parseInfo(l);
        if (info && info.pv.length) lines[info.multipv] = info;
      });
      send('position fen ' + fen);
      send('go ' + limit);
      const bm = await waitFor((l) => l.startsWith('bestmove'));
      off();
      return { best: bm.split(/\s+/)[1], lines };
    },
    async newGame() { send('ucinewgame'); send('isready'); await waitFor((l) => l === 'readyok'); },
    quit() { try { send('quit'); } catch { /* ignore */ } setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, 200); },
  };
}
function parseInfo(line) {
  const t = line.split(/\s+/);
  const info = { depth: 0, multipv: 1, pv: [], score: null };
  for (let i = 1; i < t.length; i++) {
    const k = t[i];
    if (k === 'depth') info.depth = +t[++i];
    else if (k === 'multipv') info.multipv = +t[++i];
    else if (k === 'score') { const type = t[++i]; const v = +t[++i]; info.score = { type, value: v }; }
    else if (k === 'pv') { info.pv = t.slice(i + 1); break; }
    else if (k === 'string') return null;
  }
  return info.score ? info : null;
}
/** centipawn-ish number from the side-to-move's point of view (mate = very large) */
const cp = (score) => {
  if (!score) return 0;
  if (score.type === 'mate') return score.value > 0 ? 100000 - score.value * 100 : -100000 - score.value * 100;
  return score.value;
};

// ---------------------------------------------------------------- self play
async function playGame(eng) {
  await eng.newGame();
  const c = new Chess();
  const open = pick(OPENINGS).split(' ');
  for (const san of open) { try { c.move(san); } catch { /* ignore */ } }
  const positions = [];
  const maxPly = 70 + ((rnd() * 60) | 0);
  while (!c.isGameOver() && c.history().length < maxPly) {
    const fen = c.fen();
    let mv = null;
    if (rnd() < 0.14) {
      const ms = c.moves({ verbose: true });
      mv = ms[(rnd() * ms.length) | 0];
      c.move(mv);
    } else {
      const { best } = await eng.go(fen, 'depth 6');
      if (!best || best === '(none)') break;
      try { mv = c.move({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: best[4] || undefined }); }
      catch { break; }
    }
    // the position AFTER the move is the candidate: the opponent may now have a tactic
    const after = c.fen();
    if (countPieces(after) >= 6 && c.history().length >= 10) positions.push(after);
    void mv;
  }
  return positions;
}
function countPieces(fen) { return (fen.split(' ')[0].match(/[a-zA-Z]/g) || []).length; }
/** material balance in pawns from the side-to-move's point of view */
function balance(fen) {
  const [place, turn] = fen.split(' ');
  const V = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  let w = 0, b = 0;
  for (const ch of place) { const v = V[ch.toLowerCase()]; if (!v) continue; if (ch === ch.toUpperCase()) w += v; else b += v; }
  return turn === 'w' ? w - b : b - w;
}

// ---------------------------------------------------------------- puzzle analysis
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const key = (fen) => fen.split(' ').slice(0, 4).join(' ');

function classify(fen, solution, best2Gap, mateIn) {
  const c = new Chess(fen);
  const first = c.move({ from: solution[0].slice(0, 2), to: solution[0].slice(2, 4), promotion: solution[0][4] || undefined });
  const themes = [];
  if (mateIn) themes.push(mateIn === 1 ? 'mate1' : mateIn === 2 ? 'mate2' : 'mate');
  // fork: the moved piece now attacks two or more valuable enemy pieces.
  // After the move it is the opponent's turn, so we look at a copy with the turn flipped back.
  const to = first.to;
  const attacked = [];
  const mine = withTurn(c.fen(), first.color);
  if (mine) {
    for (const m of mine.moves({ square: to, verbose: true })) {
      if (m.captured) attacked.push(VAL[m.captured]);
    }
  }
  attacked.sort((a, b) => b - a);
  if (attacked.length >= 2 && attacked[1] >= 3) themes.push('fork');
  if (first.captured && VAL[first.captured] > VAL[first.piece]) themes.push('win-material');
  if (!first.captured && !c.isCheck() && !mateIn && solution.length >= 3) themes.push('quiet');
  if (first.promotion) themes.push('promotion');
  // sacrifice: we give material away with the key move and still win
  const sacrifice = !first.captured && isHanging(c, to);
  if (sacrifice) themes.push('sacrifice');
  if (!themes.length) themes.push(best2Gap > 600 ? 'win-material' : 'tactic');
  return { themes, rating: difficulty(fen, first, solution, mateIn, themes, best2Gap) };
}
/**
 * Difficulty estimate. What really makes a tactic hard is how many moves you have to see ahead and
 * whether the key move is a quiet one or a sacrifice; a plain capture that wins a piece is easy.
 * This is a heuristic, not an Elo rating – it only drives the leicht/mittel/schwer filter.
 */
function difficulty(fen, first, solution, mateIn, themes, gap) {
  const userMoves = Math.ceil(solution.length / 2);
  const quiet = !first.captured && !/\+|#/.test(first.san || '');
  let r = mateIn ? 880 + 200 * (mateIn - 1) : 900 + 235 * (userMoves - 1);
  if (quiet) r += 190;
  if (themes.includes('sacrifice')) r += 210;
  if (first.captured) r -= 70;
  if (themes.includes('fork')) r -= 40;
  if (!mateIn && gap > 900) r -= 60;             // a whole piece hanging is hard to miss
  const n = countPieces(fen);
  if (n <= 10) r -= 70; else if (n >= 26) r += 60;
  return Math.max(800, Math.min(2400, Math.round(r / 10) * 10));
}
/** same position but with `colour` to move (null when that is not a legal FEN) */
function withTurn(fen, colour) {
  const parts = fen.split(' ');
  parts[1] = colour; parts[3] = '-';
  try { return new Chess(parts.join(' ')); } catch { return null; }
}
/** can the opponent take the piece on `sq` with something cheaper or equal? (static, no SEE) */
function isHanging(chess, sq) {
  const p = chess.get(sq);
  if (!p) return false;
  return chess.moves({ verbose: true }).some((m) => m.to === sq && VAL[m.piece] <= VAL[p.type]);
}

async function verify(eng, fen) {
  const { lines } = await eng.go(fen, 'depth ' + DEPTH);
  const l1 = lines[1], l2 = lines[2];
  if (!l1 || !l1.pv.length) return null;
  const e1 = cp(l1.score);
  const e2 = l2 ? cp(l2.score) : -100000;
  return {
    e1, e2, pv: l1.pv,
    mate: l1.score.type === 'mate' ? l1.score.value : 0,
    secondMate: l2 && l2.score.type === 'mate' ? l2.score.value : 0,
    second: l2 ? l2.pv[0] : null,
  };
}

/** Accepts a verified position as a puzzle or returns null. */
function accept(fen, v) {
  if (!v) return null;
  const gap = v.e1 - v.e2;
  if (MATES_ONLY && v.mate <= 0) return null;
  // a puzzle is only interesting when the solver is not already completely winning
  if (balance(fen) > 3) return null;
  if (v.e2 > 250) return null;                        // second best already winning → no real point
  if (v.mate > 0) {
    if (v.mate > 5) return null;
    if (v.secondMate > 0) return null;                // several mates → the "solution" is arbitrary
  } else {
    if (v.e1 < 150) return null;
    if (v.e2 > 120) return null;
    if (gap < 300) return null;
  }
  const c = new Chess(fen);
  if (c.moves().length < 2) return null;              // only move = no puzzle
  // solution line: cap at 5 plies (3 user moves) and never end on the opponent's move
  let maxPly = v.mate > 0 ? Math.min(v.mate * 2 - 1, 7) : 3;
  const line = [];
  const probe = new Chess(fen);
  for (const u of v.pv) {
    if (line.length >= maxPly) break;
    try { probe.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined }); }
    catch { break; }
    line.push(u);
    if (probe.isCheckmate()) break;
  }
  if (line.length % 2 === 0) line.pop();               // must end with the solver's move
  if (!line.length) return null;
  const { themes, rating } = classify(fen, line, gap, v.mate > 0 ? v.mate : 0);
  return { f: fen, s: line, t: themes, r: rating, e: v.mate > 0 ? 'M' + v.mate : Math.round(v.e1) };
}

// ---------------------------------------------------------------- reclassify
// `node generate-puzzles.js --reclassify` recomputes themes and ratings for the puzzles already in
// puzzles.jsonl and rewrites puzzle-data.js. The verified FENs and solutions stay untouched.
if (flag('reclassify')) {
  // prefer the raw log of the last run; fall back to the committed data file
  const lines = fs.existsSync(JSONL)
    ? fs.readFileSync(JSONL, 'utf8').split('\n').filter((l) => l.trim())
    : JSON.parse(fs.readFileSync(OUT, 'utf8').match(/export default (\[[\s\S]*\]);/)[1]).map((x) => JSON.stringify(x));
  const seen = new Set();
  const out = [];
  for (const l of lines) {
    const p = JSON.parse(l);
    if (seen.has(key(p.f))) continue;
    seen.add(key(p.f));
    const mateIn = typeof p.e === 'string' && p.e[0] === 'M' ? +p.e.slice(1) : 0;
    const gap = mateIn ? 0 : Math.abs(+p.e || 0);
    const { themes, rating } = classify(p.f, p.s, gap, mateIn);
    out.push({ ...p, t: themes, r: rating });
  }
  out.sort((a, b) => a.r - b.r);
  write(out);
  const rs = out.map((p) => p.r);
  console.log(`reclassified ${out.length} puzzles → ${OUT}`);
  console.log(`ratings ${Math.min(...rs)}–${Math.max(...rs)}, median ${rs[rs.length >> 1]}`);
  process.exit(0);
}

// ---------------------------------------------------------------- main
// The scan is the expensive part, so several judge processes work through the queue in parallel.
(async () => {
  console.log('Engine:', ENGINE_JS);
  console.log(`target ${TARGET}, depth ${DEPTH}, scan nodes ${SCAN_NODES}, ${WORKERS} judges`);
  const players = [];
  for (let i = 0; i < PLAYERS; i++) { const e = createEngine('player' + i); await e.init({ 'Skill Level': 6, Threads: 1, Hash: 32 }); players.push(e); }
  const judges = [];
  for (let i = 0; i < WORKERS; i++) { const e = createEngine('judge' + i); await e.init({ MultiPV: 2, Threads: 1, Hash: 96, UCI_AnalyseMode: 'true' }); judges.push(e); }

  const found = [];
  const seen = new Set();
  if (flag('resume') && fs.existsSync(JSONL)) {
    for (const l of fs.readFileSync(JSONL, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try { const p = JSON.parse(l); if (!seen.has(key(p.f))) { seen.add(key(p.f)); found.push(p); } } catch { /* ignore */ }
    }
    console.log('resumed with', found.length, 'puzzles');
  } else if (fs.existsSync(JSONL)) fs.unlinkSync(JSONL);

  const t0 = Date.now();
  let scanned = 0, preHits = 0, gamesPlayed = 0;

  /** one judge: stage-1 scan, then deep verification */
  async function examine(eng, fen) {
    scanned++;
    const quick = await eng.go(fen, 'nodes ' + SCAN_NODES);
    const q1 = quick.lines[1], q2 = quick.lines[2];
    if (!q1 || !q2) return null;
    const g1 = cp(q1.score), g2 = cp(q2.score);
    const quickMate = q1.score.type === 'mate' && q1.score.value > 0 && q1.score.value <= 5;
    if (MATES_ONLY ? !quickMate : (!quickMate && (g1 - g2 < 320 || g1 < 150 || g2 > 120))) return null;
    preHits++;
    const v = await verify(eng, fen);
    return accept(fen, v);
  }

  while (found.length < TARGET && gamesPlayed < GAMES) {
    // produce a batch of positions with all player engines in parallel
    const batchGames = Math.min(PLAYERS * 2, GAMES - gamesPlayed);
    const batches = [];
    for (let i = 0; i < batchGames; i++) batches.push(players[i % players.length]);
    const lists = [];
    for (let i = 0; i < batches.length; i += players.length) {
      const slice = batches.slice(i, i + players.length);
      const res = await Promise.all(slice.map((e) => playGame(e)));
      lists.push(...res);
      gamesPlayed += slice.length;
    }
    const queue = [];
    lists.forEach((list, li) => {
      for (const fen of list) {
        const k = key(fen);
        if (seen.has(k)) continue;
        seen.add(k);
        // cheap rejects before the engine is asked at all
        if (balance(fen) > 3) continue;
        queue.push({ fen, gi: gamesPlayed - lists.length + li });
      }
    });
    shuffleInPlace(queue);
    // consume the queue with the judge pool; at most MAX_PER_GAME puzzles come from one game so the
    // set does not fill up with twenty positions out of the same lost endgame
    const perGame = new Map();
    let qi = 0;
    await Promise.all(judges.map(async (eng) => {
      while (found.length < TARGET) {
        const idx = qi++;
        if (idx >= queue.length) break;
        const item = queue[idx];
        if ((perGame.get(item.gi) || 0) >= MAX_PER_GAME) continue;
        let p = null;
        try { p = await examine(eng, item.fen); } catch (e) { console.warn('judge failed:', e.message); break; }
        if (!p) continue;
        if ((perGame.get(item.gi) || 0) >= MAX_PER_GAME) continue;
        perGame.set(item.gi, (perGame.get(item.gi) || 0) + 1);
        found.push(p);
        fs.appendFileSync(JSONL, JSON.stringify(p) + '\n');
        const secs = ((Date.now() - t0) / 1000).toFixed(0);
        console.log(`[${found.length}/${TARGET}] ${secs}s  r${p.r}  ${p.t.join(',')}  ${p.s.join(' ')}  ${p.f}`);
      }
    }));
    console.log(`… ${gamesPlayed} games, ${scanned} positions scanned, ${found.length} puzzles, ${((Date.now() - t0) / 1000) | 0}s`);
  }
  for (const e of players) e.quit();
  for (const e of judges) e.quit();

  found.sort((a, b) => a.r - b.r);
  write(found);
  console.log(`\nscanned ${scanned} positions, ${preHits} passed the pre-filter, ${found.length} puzzles written to ${OUT}`);
  console.log(`total ${((Date.now() - t0) / 1000) | 0}s`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

function write(list) {
  const head = `// AUTO-GENERATED – nicht von Hand bearbeiten.
// Erzeugt von app/src/ui/chess/generate-puzzles.js mit der mitgelieferten Stockfish-WASM-Engine.
// Jede Stellung wurde mit MultiPV 2 bis Tiefe ${DEPTH} nachgerechnet; die gespeicherte Lösung ist
// die dort bestätigte Hauptvariante und deutlich besser als der zweitbeste Zug.
//   f = FEN, s = Lösung (UCI, ungerade Länge: du beginnst), t = Themen, r = Wertung, e = Bewertung
export const meta = ${JSON.stringify({ generated: new Date().toISOString().slice(0, 10), engine: 'Stockfish 18 lite (WASM)', depth: DEPTH, multipv: 2, count: list.length }, null, 2)};

export default [
`;
  const body = list.map((p) => '  ' + JSON.stringify(p)).join(',\n');
  fs.writeFileSync(OUT, head + body + '\n];\n', 'utf8');
}
