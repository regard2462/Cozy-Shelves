// Stockfish wrapper around app/src/workers/stockfish-worker.js (bundled to dist/chess-worker.js).
//   const eng = await createEngine();
//   eng.analyse(fen, { depth: 14 }, ({ score, pv, depth }) => {});   // score from White's point of view
//   const uci = await eng.bestMove(fen, { movetime: 800 });
//   eng.stop(); eng.destroy();

const WORKER_URL = new URL('./chess-worker.js', import.meta.url);
const WASM_URL = new URL('../vendor/stockfish/stockfish-18-lite-single.wasm', import.meta.url);

let sharedP = null;      // cached PROMISE (not the resolved value) – avoids the double-worker race
let sharedInst = null;   // the resolved instance, so destroy() can clear the cache
let sharedRefs = 0;      // refcount from acquireEngine()/releaseEngine()
// tests (build/scripts/bugs-ui-check.js) read the claims on the shared engine: none may stay behind after a game
if (typeof window !== 'undefined') window.__chessEngineRefs = () => sharedRefs;

export async function createEngine(opts = {}) {
  const worker = new Worker(WORKER_URL.href + '#' + encodeURIComponent(WASM_URL.href));
  const lineListeners = new Set();
  let ready = false, destroyed = false;
  let search = null;      // { resolve, reject, onInfo, fen, turn, id }
  let pending = null;     // next search waiting for the running one to stop
  let stopping = false;
  const waiters = [];     // [{ test(line), resolve }]

  const send = (cmd) => { if (!destroyed) worker.postMessage(cmd); };
  const waitFor = (test, timeout = 15000) => new Promise((resolve, reject) => {
    const w = { test, resolve, timer: setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); reject(new Error('engine timeout')); }, timeout) };
    waiters.push(w);
  });

  worker.onmessage = (e) => {
    const d = e.data;
    if (d && typeof d === 'object') {
      if (d.type === 'error') { console.error('[stockfish]', d.error); failAll(new Error(d.error)); }
      return;
    }
    if (typeof d !== 'string') return;
    handleLine(d);
  };
  worker.onerror = (e) => { console.error('[stockfish worker]', e.message || e); failAll(new Error(e.message || 'worker error')); };

  function failAll(err) {
    for (const w of waiters.splice(0)) { clearTimeout(w.timer); w.resolve(null); }
    if (search) { const s = search; search = null; stopping = false; s.reject(err); s.doneResolve?.(); }
    if (pending) { const p = pending; pending = null; p.reject(err); p.doneResolve?.(); }
  }

  function handleLine(line) {
    for (const fn of lineListeners) { try { fn(line); } catch (e) { console.error(e); } }
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].test(line)) { const w = waiters.splice(i, 1)[0]; clearTimeout(w.timer); w.resolve(line); }
    if (line.startsWith('info ') && search && !stopping) {
      const info = parseInfo(line, search.turn);
      if (info && search.onInfo) { search.lastInfo = info; try { search.onInfo(info); } catch (e) { console.error(e); } }
    } else if (line.startsWith('bestmove')) {
      const parts = line.split(/\s+/);
      const best = parts[1] && parts[1] !== '(none)' ? parts[1] : null;
      const s = search; search = null; stopping = false;
      if (s) { s.resolve({ bestMove: best, ponder: parts[3] || null, info: s.lastInfo || null }); s.doneResolve?.(); }
      if (pending) { const p = pending; pending = null; startSearch(p); }
    }
  }

  function startSearch(s) {
    search = s; s.lastInfo = null;
    s.done = new Promise((res) => { s.doneResolve = res; });
    send('position fen ' + s.fen);
    const o = s.opts || {};
    let go = 'go';
    if (o.movetime) go += ' movetime ' + Math.max(50, o.movetime | 0);
    if (o.depth) go += ' depth ' + Math.max(1, Math.min(40, o.depth | 0));
    if (o.nodes) go += ' nodes ' + (o.nodes | 0);
    if (!o.movetime && !o.depth && !o.nodes) go += ' depth 14';
    send(go);
  }

  function request(fen, opts, onInfo) {
    return new Promise((resolve, reject) => {
      if (destroyed) return reject(new Error('engine destroyed'));
      const s = { fen, turn: (fen.split(' ')[1] || 'w') === 'b' ? 'black' : 'white', opts, onInfo, resolve, reject };
      if (search) {
        if (pending) pending.resolve({ bestMove: null, info: pending.lastInfo || null, cancelled: true });
        pending = s;
        if (!stopping) { stopping = true; send('stop'); }
      } else startSearch(s);
    });
  }

  const api = {
    get ready() { return ready; },
    /** Start (or restart) analysis; onInfo gets { depth, score: {type:'cp'|'mate', value}, cp, mate, pv: [uci…], nodes, nps, multipv } – score from White's view. */
    analyse(fen, opts = {}, onInfo) {
      return request(fen, { depth: opts.depth || 14, movetime: opts.movetime, nodes: opts.nodes }, onInfo);
    },
    /** Returns the best move in UCI notation ('e2e4', 'e7e8q') or null. */
    async bestMove(fen, opts = {}) {
      const r = await request(fen, { movetime: opts.movetime || (opts.depth ? undefined : 800), depth: opts.depth }, opts.onInfo);
      return r.bestMove;
    },
    /** Stops the running search. Returns a promise that resolves once the engine is idle again
     *  (UCI forbids `setoption` while a search is in flight – await this before configuring). */
    stop() {
      if (pending) { pending.resolve({ bestMove: null, cancelled: true }); pending.doneResolve?.(); pending = null; }
      const s = search;
      if (!s) return Promise.resolve();
      if (!stopping) { stopping = true; send('stop'); }
      return s.done || Promise.resolve();
    },
    /** True while a search is running. */
    get busy() { return !!search; },
    send,
    onLine(fn) { lineListeners.add(fn); return () => lineListeners.delete(fn); },
    setOption(name, value) { send(`setoption name ${name} value ${value}`); },
    /** Stops any running search, then applies the options – the safe way to change Skill Level/Elo. */
    async configure(options = {}) {
      await api.stop();
      for (const [k, v] of Object.entries(options)) { if (v !== undefined && v !== null) send(`setoption name ${k} value ${v}`); }
      send('isready');
      await waitFor((l) => l === 'readyok', 10000);
    },
    async newGame() { await api.stop(); send('ucinewgame'); send('isready'); await waitFor((l) => l === 'readyok'); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      try { worker.postMessage('quit'); } catch (e) { /* ignore */ }
      setTimeout(() => { try { worker.terminate(); } catch (e) { /* ignore */ } }, 50);
      failAll(new Error('engine destroyed'));
      if (sharedInst === api) { sharedInst = null; sharedP = null; sharedRefs = 0; }
    },
  };

  // handshake
  const uciok = waitFor((l) => l === 'uciok', opts.timeout || 60000);
  send('uci');
  if (!(await uciok)) throw new Error('Stockfish did not answer');
  send('setoption name UCI_AnalyseMode value true');
  if (opts.hash) send('setoption name Hash value ' + opts.hash);
  send('isready');
  await waitFor((l) => l === 'readyok', 60000);
  ready = true;
  return api;
}

/**
 * Shared engine instance (lazy). The PROMISE is cached, not its result – two concurrent callers
 * therefore share one Stockfish worker instead of each spawning (and orphaning) their own.
 */
export function getSharedEngine() {
  if (!sharedP) {
    sharedP = createEngine().then((e) => { sharedInst = e; return e; }, (e) => { sharedP = null; throw e; });
  }
  return sharedP;
}

/** Refcounted access: every acquire() must be matched by exactly one release(). */
export async function acquireEngine() {
  sharedRefs++;
  try { return await getSharedEngine(); }
  catch (e) { sharedRefs = Math.max(0, sharedRefs - 1); throw e; }
}

/** Drops one reference; the worker is terminated when the last consumer releases it. */
export function releaseEngine() {
  sharedRefs = Math.max(0, sharedRefs - 1);
  if (sharedRefs > 0) return;
  const p = sharedP;
  sharedP = null; sharedInst = null;
  if (p) p.then((e) => { try { e.destroy(); } catch { /* ignore */ } }, () => {});
}

/** Parse a UCI "info" line. Score is normalised to White's point of view. */
export function parseInfo(line, turn = 'white') {
  const t = line.split(/\s+/);
  const info = { depth: 0, seldepth: 0, multipv: 1, nodes: 0, nps: 0, time: 0, pv: [], score: null, cp: null, mate: null };
  let sawScore = false;
  for (let i = 1; i < t.length; i++) {
    const k = t[i];
    if (k === 'depth') info.depth = +t[++i];
    else if (k === 'seldepth') info.seldepth = +t[++i];
    else if (k === 'multipv') info.multipv = +t[++i];
    else if (k === 'nodes') info.nodes = +t[++i];
    else if (k === 'nps') info.nps = +t[++i];
    else if (k === 'time') info.time = +t[++i];
    else if (k === 'score') {
      const type = t[++i]; let v = +t[++i];
      if (turn === 'black') v = -v;
      info.score = { type, value: v };
      if (type === 'cp') info.cp = v; else if (type === 'mate') info.mate = v;
      sawScore = true;
      if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') { info.bound = t[i + 1]; i++; }
    } else if (k === 'pv') { info.pv = t.slice(i + 1); break; }
    else if (k === 'string') return null;
  }
  if (!sawScore && !info.pv.length) return null;
  if (!info.depth && !info.pv.length) return null;   // 'info depth 0 score cp 0' = no legal moves / refused position
  return info;
}

/** Human readable evaluation ("+0.35", "−1.20", "#3", "#−2"). */
export function formatScore(score) {
  if (!score) return '';
  if (score.type === 'mate') return (score.value < 0 ? '#−' : '#') + Math.abs(score.value);
  const v = score.value / 100;
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
}

/** 0..1 share of the eval bar for White. */
export function scoreToBar(score) {
  if (!score) return 0.5;
  if (score.type === 'mate') return score.value > 0 ? 0.98 : 0.02;
  const cp = Math.max(-1000, Math.min(1000, score.value));
  return 0.5 + 0.5 * (2 / (1 + Math.exp(-0.004 * cp)) - 1);
}
