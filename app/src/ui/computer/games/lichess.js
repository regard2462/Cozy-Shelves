// Lichess – daily/random puzzles, Lichess TV (ndjson stream) and studies. Everything degrades gracefully offline.
import { h, clear } from '../../../core/dom.js';
import { Chess } from 'chess.js';
import { btn, keyList, T, notice, input, dim, isEditable } from '../terminal.js';
import { loadChess } from './chess-vs-engine.js';

const API = 'https://lichess.org/api';

/** The number in front of the i-th move of a puzzle's list: "12. " before White's move, "12… " before Black's when the
 *  puzzle starts with Black to move (its first move was labelled as White's), nothing before the other moves of Black. */
export function moveLabel(i, moveNumber, blackFirst) {
  const ply = i + (blackFirst ? 1 : 0);
  const n = moveNumber + Math.floor(ply / 2);
  if (ply % 2 === 0) return `${n}. `;
  return i === 0 ? `${n}… ` : '';
}

export async function mount(root, g) {
  const { ctx, sfx } = g;
  const mods = await loadChess();
  if (!mods) { root.appendChild(notice(T('Schachmodul lädt noch … bitte später erneut versuchen.', 'Chess module still loading … please try again later.'))); return {}; }
  const { createChessBoard } = mods;
  let view = null; // current sub view { onKey, unmount }
  let disposed = false;

  async function getJson(url) {
    try {
      const r = await ctx.api.app.fetch(url, { headers: { Accept: 'application/json' } });
      if (!r || !r.ok) return { error: r?.status ? `HTTP ${r.status}` : (r?.error || T('offline', 'offline')) };
      return { data: JSON.parse(r.text) };
    } catch (e) { return { error: e?.message || String(e) }; }
  }
  const offline = (err) => notice(T('Lichess ist nicht erreichbar ({e}). Ohne Internet bleibt der Bildschirm hier dunkel, die anderen Spiele funktionieren offline.', 'Lichess cannot be reached ({e}). Without internet this screen stays dark – the other games work offline.', { e: err }));

  // ---------------------------------------------------------------- menu
  const ITEMS = [
    { id: 'daily', label: { de: 'Tagesrätsel', en: 'Daily puzzle' }, desc: { de: 'das Lichess-Rätsel des Tages lösen', en: 'solve the Lichess puzzle of the day' } },
    { id: 'random', label: { de: 'Zufallsrätsel', en: 'Random puzzle' }, desc: { de: 'ein zufälliges Rätsel', en: 'a random puzzle' } },
    { id: 'tv', label: { de: 'Lichess TV', en: 'Lichess TV' }, desc: { de: 'der besten laufenden Partie zuschauen', en: 'watch the best game in progress' } },
    { id: 'study', label: { de: 'Studie laden', en: 'Load study' }, desc: { de: 'Lichess-Studie per ID nachspielen', en: 'replay a Lichess study by id' } },
  ];
  function showMenu() {
    closeView(); clear(root);
    const rows = ITEMS.map((it, i) => h('div.term-menu-item', { dataset: { id: it.id } }, h('span.term-menu-num', String(i + 1)), h('span.term-menu-label', ctx.i18n.tr(it.label)), h('span.term-menu-desc', ctx.i18n.tr(it.desc))));
    root.appendChild(h('div.term-menu-list', rows));
    const list = keyList(rows, { wrap: true, onEnter: (r) => open(r.dataset.id) });
    list.set(0, false);
    g.setHints([['↑↓', T('wählen', 'select')], ['⏎', T('öffnen', 'open')], ['Esc', T('Spiele', 'games')]]);
    view = { menu: true, onKey(e) { if (/^[1-4]$/.test(e.key)) { open(ITEMS[+e.key - 1].id); return true; } if (list.onKey(e)) { e.preventDefault(); return true; } return false; } };
  }
  function open(id) { sfx.click(); closeView(); clear(root); if (id === 'daily') puzzle(`${API}/puzzle/daily`); else if (id === 'random') puzzle(`${API}/puzzle/next`); else if (id === 'tv') tv(); else study(); }
  function closeView() { try { view?.unmount?.(); } catch (e) { console.error(e); } view = null; }

  // ---------------------------------------------------------------- puzzles
  async function puzzle(url) {
    const info = h('div.term-chess-side'); const boardHost = h('div.term-chess-board'); const lock = h('div.term-chess-lock.on');
    root.appendChild(h('div.term-chess', h('div.term-chess-boardwrap', boardHost, lock), info));
    info.appendChild(notice(T('Lade Rätsel …', 'Loading puzzle …')));
    let board = null, unsub = null, live = true;
    const timers = [];
    const later = (fn, ms) => { const t = setTimeout(() => { if (live && !disposed) fn(); }, ms); timers.push(t); return t; };
    const closePuzzle = () => { live = false; timers.splice(0).forEach(clearTimeout); unsub?.(); unsub = null; board?.destroy(); board = null; };
    view = { unmount: closePuzzle, onKey: (e) => { if (e.key === 'Escape') { showMenu(); return true; } return false; } };
    const { data, error } = await getJson(url);
    if (disposed || !live || view?.menu) { closePuzzle(); return; }
    clear(info);
    if (error || !data?.game?.pgn || !data?.puzzle?.solution) { info.appendChild(offline(error || 'format')); info.appendChild(h('div.term-actions', btn(T('Zurück', 'Back'), showMenu))); return; }
    const sans = data.game.pgn.trim().split(/\s+/).filter((t) => !/^\d+\.|^\*$/.test(t));
    const setup = new Chess();
    const upto = Math.min(sans.length, (data.puzzle.initialPly ?? sans.length - 1) + 1);
    try { for (let i = 0; i < upto; i++) setup.move(sans[i]); } catch (e) { info.appendChild(notice(T('Rätsel konnte nicht aufgebaut werden.', 'Could not set up the puzzle.'))); return; }
    const startFen = setup.fen();
    const me = setup.turn() === 'w' ? 'white' : 'black';
    const solution = data.puzzle.solution.slice();
    let k = 0, solved = false, fails = 0;
    board = createChessBoard(boardHost, { mode: '2d', orientation: me, free: false, fen: startFen });
    const statusEl = h('div.term-chess-status'); const movesEl = h('div.term-chess-moves');
    const players = data.game.players ? (Array.isArray(data.game.players) ? data.game.players.map((p) => p.name || p.user?.name).join(T(' gegen ', ' vs ')) : '') : '';
    info.append(...[
      h('div.term-line', h('span.term-bright', T('Rätsel ', 'Puzzle ') + (data.puzzle.id || '')), dim(`  Rating ${data.puzzle.rating || '?'}`)),
      h('div.term-line.term-dim', (data.puzzle.themes || []).slice(0, 6).join(' · ')), players ? h('div.term-line.term-dim', players) : null,
      h('div.term-line', me === 'white' ? T('Weiß am Zug. Finde den besten Zug.', 'White to move – find the best move.') : T('Schwarz am Zug. Finde den besten Zug.', 'Black to move – find the best move.')),
      statusEl, movesEl,
      h('div.term-actions', btn(T('Tipp (H)', 'Hint (H)'), hint), btn(T('Nochmal (R)', 'Retry (R)'), retry), btn(T('Neues Rätsel (N)', 'New puzzle (N)'), () => open('random')), btn(T('Zurück', 'Back'), showMenu))].filter(Boolean));
    let suppress = false;
    const blackFirst = me === 'black', moveNo = setup.moveNumber();
    const paint = () => { clear(movesEl); movesEl.append(...board.history().map((m, i) => h('span', moveLabel(i, moveNo, blackFirst) + m.san + ' '))); };
    const playReply = () => { const uci = solution[k]; if (!uci) return; const c = new Chess(board.getFen()); const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined }); k++; suppress = true; board.playSan(m.san).then(() => { suppress = false; paint(); statusEl.textContent = T('Dein Zug …', 'Your move …'); }); };
    unsub = board.onChange((fen, d) => {
      if (d.type !== 'move' || suppress || solved) return;
      const m = d.move; const uci = m.from + m.to + (m.promotion || '');
      sfx.move(); paint();
      if (uci === solution[k]) {
        k++; statusEl.textContent = '✓ ' + T('Richtig!', 'Correct!');
        if (k >= solution.length) { solved = true; lock.classList.add('on'); statusEl.textContent = '★ ' + T('Rätsel gelöst!', 'Puzzle solved!') + (fails ? '' : T(' Ohne Fehler.', ' Flawless.')); const n = (g.best.get('puzzles') || 0) + 1; g.best.set(n, 'puzzles'); sfx.click(); }
        else later(playReply, 450);
      } else {
        const c = new Chess(fen);
        if (c.isCheckmate()) { solved = true; lock.classList.add('on'); statusEl.textContent = '★ ' + T('Matt, auch gut!', 'Mate – also fine!'); return; }
        fails++; sfx.error(); statusEl.textContent = '✗ ' + T('Das ist nicht der beste Zug. Nochmal!', 'Not the best move. Try again!');
        later(() => { suppress = true; board.undo(); suppress = false; }, 500);
      }
    });
    function hint() { const uci = solution[k]; if (!uci || solved) return; try { board.setShapes([{ orig: uci.slice(0, 2), brush: 'green' }]); } catch { /* ignore */ } statusEl.textContent = T('Tipp: Figur auf ', 'Hint: piece on ') + uci.slice(0, 2); }
    function retry() { k = 0; solved = false; suppress = true; board.setFen(startFen); suppress = false; lock.classList.remove('on'); statusEl.textContent = ''; paint(); }
    lock.classList.remove('on'); paint();
    g.setHints([['H', T('Tipp', 'hint')], ['R', T('nochmal', 'retry')], ['N', T('neues Rätsel', 'new puzzle')], ['Esc', T('zurück', 'back')]]);
    view = { unmount: closePuzzle, onKey(e) { const kk = e.key.toLowerCase(); if (kk === 'h') { hint(); return true; } if (kk === 'r') { retry(); return true; } if (kk === 'n') { open('random'); return true; } if (e.key === 'Escape') { showMenu(); return true; } return false; } };
  }

  // ---------------------------------------------------------------- TV
  async function tv() {
    const info = h('div.term-chess-side'); const boardHost = h('div.term-chess-board'); const lock = h('div.term-chess-lock.on');
    root.appendChild(h('div.term-chess', h('div.term-chess-boardwrap', boardHost, lock), info));
    const title = h('div.term-line'); const players = h('div.term-line'); const clocks = h('div.term-line.term-bright'); const statusEl = h('div.term-chess-status'); const lastEl = h('div.term-line.term-dim');
    const channelSel = h('select.term-select', ['best', 'blitz', 'rapid', 'classical', 'bullet', 'topRated'].map((c) => h('option', { value: c }, c)));
    info.append(h('div.term-line', h('span.term-bright', 'LICHESS TV'), '  ', channelSel), title, players, clocks, lastEl, statusEl, h('div.term-actions', btn(T('Drehen (F)', 'Flip (F)'), () => board?.flip()), btn(T('Zurück', 'Back'), showMenu)));
    statusEl.textContent = T('Suche laufende Partie …', 'Looking for a game …');
    let board = null, gameId = null, streamId = null, buf = '', pollTimer = null, offStream = null, alive = true, clockTimer = null, wc = null, bc = null, turn = 'white', lastTick = 0;
    let polling = false, streamGen = 0;
    board = createChessBoard(boardHost, { mode: '2d', orientation: 'white', free: true });
    const closeTv = () => {
      alive = false; streamGen++;
      clearInterval(pollTimer); pollTimer = null;
      clearInterval(clockTimer); clockTimer = null;
      stopStream();
      board?.destroy(); board = null;
    };
    // registered before the first await: leaving during the initial poll must still clean up
    view = {
      unmount: closeTv,
      onKey(e) { if (isEditable(e.target)) return false; if (e.key === 'f' || e.key === 'F') { board?.flip(); return true; } if (e.key === 'Escape') { showMenu(); return true; } return false; },
    };
    const fmtClock = (s) => (s == null ? '–' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
    const paintClocks = () => { clocks.textContent = `♔ ${fmtClock(wc)}   ♚ ${fmtClock(bc)}`; };
    clockTimer = setInterval(() => { if (!alive) { clearInterval(clockTimer); return; } if (wc == null) return; const now = Date.now(); const dt = (now - lastTick) / 1000; lastTick = now; if (turn === 'white') wc = Math.max(0, wc - dt); else bc = Math.max(0, bc - dt); paintClocks(); }, 1000);
    const handleLine = (line) => {
      let d; try { d = JSON.parse(line); } catch { return; }
      if (d.players || d.id) { // first line: game description
        const P = d.players || {}; const w = Array.isArray(P) ? P[0] : P.white, b = Array.isArray(P) ? P[1] : P.black;
        const name = (p) => (p ? `${p.user?.name || p.name || (p.aiLevel ? 'Stockfish ' + p.aiLevel : '?')}${p.rating ? ' (' + p.rating + ')' : ''}` : '?');
        players.textContent = `♔ ${name(w)}  ·  ♚ ${name(b)}`;
        title.textContent = `${d.speed || ''} ${d.rated ? T('gewertet', 'rated') : ''} · ${d.id || gameId}`;
        if (d.fen) { try { board.setFen(d.fen); } catch { /* ignore */ } }
        if (d.orientation) board.setOrientation(d.orientation);
        statusEl.textContent = T('Live …', 'Live …');
      }
      if (d.fen && !d.players) { try { board.setFen(d.fen); } catch { /* ignore */ } sfx.move(); }
      if (d.lm) lastEl.textContent = T('Letzter Zug: ', 'Last move: ') + d.lm;
      if (d.wc != null) { wc = d.wc; bc = d.bc; lastTick = Date.now(); }
      if (d.fen) turn = d.fen.split(' ')[1] === 'b' ? 'black' : 'white';
      if (d.status && d.status.name && d.status.name !== 'started') statusEl.textContent = T('Partie beendet: ', 'Game over: ') + d.status.name;
      paintClocks();
    };
    const stopStream = async () => { streamGen++; if (streamId != null) { const sid = streamId; streamId = null; try { await ctx.api.app.streamStop(sid); } catch { /* ignore */ } } offStream?.(); offStream = null; buf = ''; };
    const startStream = async (id) => {
      await stopStream(); if (!alive) return;
      const myGen = streamGen;
      buf = '';
      offStream = ctx.api.app.onStream?.((p) => {
        if (!p || p.id !== streamId) return;
        if (p.type === 'data') { buf += p.chunk || ''; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) handleLine(line); } }
        else if (p.type === 'end') { statusEl.textContent = T('Übertragung beendet, die nächste Partie wird gesucht …', 'Stream ended – looking for the next game …'); }
        else if (p.type === 'error') { statusEl.textContent = T('Stream-Fehler: ', 'Stream error: ') + (p.error || ''); }
      });
      let newId = null;
      try { newId = await ctx.api.app.streamStart(`${API}/stream/game/${id}`, { headers: { Accept: 'application/x-ndjson' } }); } catch (e) { newId = null; }
      // a later startStream (or the unmount) may have overtaken us – that stream would be an orphan
      if (!alive || myGen !== streamGen) { if (newId != null) { try { await ctx.api.app.streamStop(newId); } catch { /* ignore */ } } return; }
      streamId = newId;
      if (streamId == null) { statusEl.textContent = T('Stream nicht verfügbar (nur in der Desktop-App).', 'Stream unavailable (desktop app only).'); }
    };
    const poll = async () => {
      if (!alive || polling) return;          // two interleaved polls would fight over streamId
      polling = true;
      try {
        const { data, error } = await getJson(`${API}/tv/channels`);
        if (!alive) return;
        if (error) { clear(statusEl); statusEl.appendChild(offline(error)); return; }
        const ch = data?.[channelSel.value] || data?.best;
        if (ch?.gameId && ch.gameId !== gameId) {
          gameId = ch.gameId;
          players.textContent = `${ch.user?.name || ''} (${ch.rating || '?'}) ${T('spielt', 'plays')} ${ch.color || ''}`;
          title.textContent = `${channelSel.value} · ${gameId}`; wc = bc = null;
          await startStream(gameId);
        }
      } finally { polling = false; }
    };
    channelSel.onchange = () => { gameId = null; poll(); };
    g.setHints([['F', T('drehen', 'flip')], ['Esc', T('zurück', 'back')]]);
    await poll();
    if (!alive || disposed) { closeTv(); return; }
    pollTimer = setInterval(poll, 4000);
  }

  // ---------------------------------------------------------------- study
  async function study() {
    const idInput = input({ placeholder: T('Studien-ID (z. B. aus lichess.org/study/XXXXXXXX)', 'study id (e.g. from lichess.org/study/XXXXXXXX)'), value: g.params?.study || '' });
    const out = h('div');
    root.appendChild(h('div.term-study', h('div.term-line', h('span.term-prompt', T('Studie', 'Study')), idInput, ' ', btn(T('Laden', 'Load'), load)), out));
    setTimeout(() => idInput.focus(), 0);
    let board = null, chapters = [], chIdx = 0, moves = [], ply = 0, unsubKeys = null;
    async function load() {
      const id = idInput.value.trim().replace(/^.*\/study\//, '').split(/[/?#]/)[0];
      if (!id) { sfx.error(); return; }
      idInput.blur(); g.focus(); clear(out); out.appendChild(notice(T('Lade Studie …', 'Loading study …')));
      let r; try { r = await ctx.api.app.fetch(`${API}/study/${id}.pgn`, { headers: { Accept: 'application/x-chess-pgn' } }); } catch (e) { r = { ok: false, error: e.message }; }
      if (disposed || view?.menu) return;
      clear(out);
      if (!r?.ok) { out.appendChild(offline(r?.status ? `HTTP ${r.status}` : (r?.error || 'offline'))); return; }
      chapters = splitPgn(r.text);
      if (!chapters.length) { out.appendChild(notice(T('Keine Kapitel gefunden.', 'No chapters found.'))); return; }
      renderStudy();
    }
    function renderStudy() {
      clear(out); board?.destroy(); board = null;
      const boardHost = h('div.term-chess-board'); const side = h('div.term-chess-side'); const lock = h('div.term-chess-lock.on');
      out.appendChild(h('div.term-chess', h('div.term-chess-boardwrap', boardHost, lock), side));
      const chapSel = h('select.term-select', chapters.map((c, i) => h('option', { value: i, selected: i === chIdx }, `${i + 1}. ${c.title}`)));
      chapSel.onchange = () => { chIdx = +chapSel.value; loadChapter(); };
      const movesEl = h('div.term-chess-moves'); const comment = h('div.term-study-comment');
      side.append(h('div.term-line', h('span.term-bright', T('Kapitel', 'Chapter')), ' ', chapSel), movesEl, comment,
        h('div.term-actions', btn('|◀', () => go(0)), btn('◀ (←)', () => go(ply - 1)), btn('(→) ▶', () => go(ply + 1)), btn('▶|', () => go(moves.length)), btn(T('Drehen', 'Flip'), () => board?.flip())));
      const loadChapter = () => {
        const ch = chapters[chIdx]; let c;
        try { c = new Chess(ch.fen || undefined); } catch { c = new Chess(); }
        for (const san of ch.moves.split(' ')) { if (!san) continue; try { c.move(san); } catch { break; } } // keep the valid prefix
        moves = c.history({ verbose: true }); ply = 0;
        board?.destroy(); board = createChessBoard(boardHost, { mode: '2d', orientation: ch.orientation || 'white', free: false, fen: ch.fen || undefined });
        board.playSan(moves.map((m) => m.san).join(' '), { animate: false }).catch(() => {}).then(() => go(0));
      };
      const paint = () => { clear(movesEl); movesEl.append(...moves.map((m, i) => h('span', { class: i < ply ? 'played' : '', onclick: () => go(i + 1) }, (i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : '') + m.san + ' '))); comment.textContent = chapters[chIdx].comments?.[ply] || ''; };
      function go(p) { if (!board) return; ply = Math.max(0, Math.min(moves.length, p)); board.goTo(ply); paint(); sfx.type(); }
      loadChapter();
      unsubKeys = (e) => { if (e.key === 'ArrowLeft') { go(ply - 1); return true; } if (e.key === 'ArrowRight') { go(ply + 1); return true; } if (e.key === 'Home') { go(0); return true; } if (e.key === 'End') { go(moves.length); return true; } return false; };
    }
    g.setHints([['⏎', T('laden', 'load')], ['←→', T('Züge', 'moves')], ['Esc', T('zurück', 'back')]]);
    view = {
      unmount() { board?.destroy(); },
      onKey(e) { if (isEditable(e.target)) { if (e.key === 'Enter') { load(); return true; } return e.key !== 'Escape'; } if (unsubKeys?.(e)) { e.preventDefault(); return true; } if (e.key === 'Escape') { showMenu(); return true; } return false; },
    };
  }

  showMenu();
  return {
    unmount() { disposed = true; closeView(); },
    onKey(e) { if (view?.onKey?.(e) === true) return true; if (e.key === 'Escape' && view && !view.menu) { showMenu(); return true; } return false; },
  };
}

/** Split a multi-game PGN (study export) into chapters with title, FEN, headers, cleaned movetext and per-ply comments. */
export function splitPgn(text) {
  const games = String(text || '').split(/\n(?=\[Event )/).map((s) => s.trim()).filter(Boolean);
  return games.map((gtxt) => {
    const headers = {}; const lines = gtxt.split('\n'); let i = 0;
    for (; i < lines.length; i++) { const m = /^\[(\w+)\s+"(.*)"\]$/.exec(lines[i].trim()); if (m) headers[m[1]] = m[2]; else if (lines[i].trim()) break; }
    let mv = lines.slice(i).join(' ');
    // collect comments per ply, strip variations / NAGs / results
    const comments = [];
    mv = mv.replace(/\{([^}]*)\}/g, (_, c) => { comments.push(c.trim()); return ` __C${comments.length - 1}__ `; });
    let depth = 0, outp = '';
    for (const ch of mv) { if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1); else if (!depth) outp += ch; }
    const tokens = outp.replace(/\$\d+/g, '').split(/\s+/).filter((t) => t && !['1-0', '0-1', '1/2-1/2', '*'].includes(t));
    const sans = []; const perPly = {};
    for (const t of tokens) {
      const cm = /^__C(\d+)__$/.exec(t);
      if (cm) { perPly[sans.length] = (perPly[sans.length] ? perPly[sans.length] + ' ' : '') + comments[+cm[1]]; continue; }
      if (/^\d+\.+$/.test(t)) continue;
      sans.push(t.replace(/^\d+\.+/, ''));
    }
    const headerText = Object.entries(headers).filter(([k]) => ['FEN', 'SetUp'].includes(k)).map(([k, v]) => `[${k} "${v}"]`).join('\n');
    return { title: headers.ChapterName || headers.Event || '?', fen: headers.FEN || null, orientation: headers.Orientation === 'black' ? 'black' : 'white', headers: headerText, moves: sans.join(' '), comments: perPly };
  });
}
