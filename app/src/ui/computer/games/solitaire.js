// Solitär (Klondike) – click-to-move, drag & drop, keyboard cursor, undo.
import { h, clear } from '../../../core/dom.js';
import { btn, T } from '../terminal.js';

const SUITS = ['♠', '♡', '♣', '♢']; // hollow glyphs = red suits on a monochrome tube
const RED = (s) => s === 1 || s === 3;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export async function mount(root, g) {
  let st, undo = [], sel = null, cur = { pile: 0, depth: 1 }, moves = 0, won = false, t0, timer = null;
  const movesEl = h('span.term-bright', '0'), timeEl = h('span', '0:00'), bestEl = h('span', g.best.get() != null ? String(g.best.get()) : '—');
  const msg = h('div.term-game-msg');
  const top = h('div.term-sol-row.top'), bottom = h('div.term-sol-row');
  const table = h('div.term-sol', top, bottom);
  root.appendChild(h('div.term-game-center',
    h('div.term-game-bar', h('span.term-prompt', T('Züge', 'Moves')), movesEl, h('span.term-prompt', T('Zeit', 'Time')), timeEl, h('span.term-prompt', 'Best'), bestEl, h('span.spacer'), btn(T('Rückgängig (U)', 'Undo (U)'), () => doUndo()), btn(T('Neu (N)', 'New (N)'), () => start())),
    table, msg,
    h('div.term-game-bar.term-dim', T('Klicken: Karte wählen, dann Ziel · Doppelklick: auf Ablage · Ziehen möglich · ←→ Stapel, ↑↓ Karten, ⏎ wählen/legen', 'click card then target · double-click: to foundation · drag & drop · ←→ piles, ↑↓ cards, ⏎ pick/place'))));

  // piles: 0 stock, 1 waste, 2-5 foundations, 6-12 tableau
  const P = (i) => (i === 0 ? st.stock : i === 1 ? st.waste : i < 6 ? st.found[i - 2] : st.tab[i - 6]);
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  function start() {
    const deck = []; for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) deck.push({ r, s, up: false });
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    st = { stock: [], waste: [], found: [[], [], [], []], tab: [[], [], [], [], [], [], []] };
    for (let i = 0; i < 7; i++) for (let j = 0; j <= i; j++) { const c = deck.pop(); c.up = j === i; st.tab[i].push(c); }
    st.stock = deck; undo = []; sel = null; moves = 0; won = false; cur = { pile: 0, depth: 1 }; movesEl.textContent = '0'; msg.textContent = '';
    clearInterval(timer); t0 = Date.now(); timer = setInterval(() => { if (!won) timeEl.textContent = fmt(Math.floor((Date.now() - t0) / 1000)); }, 1000); timeEl.textContent = '0:00';
    render();
  }
  const snapshot = () => JSON.stringify(st);
  function push() { undo.push(snapshot()); if (undo.length > 200) undo.shift(); }
  // undoing must not be punished twice: the move it takes back already counted.
  function doUndo() { const s = undo.pop(); if (!s) return; st = JSON.parse(s); moves = Math.max(0, moves - 1); movesEl.textContent = String(moves); sel = null; g.sfx.click(); render(); }
  function canDropTab(cards, pile) { const c = cards[0]; if (!pile.length) return c.r === 12; const t = pile[pile.length - 1]; return t.up && t.r === c.r + 1 && RED(t.s) !== RED(c.s); }
  function canDropFound(cards, pile) { if (cards.length !== 1) return false; const c = cards[0]; if (!pile.length) return c.r === 0; const t = pile[pile.length - 1]; return t.s === c.s && t.r === c.r - 1; }
  function draw() {
    push();
    if (st.stock.length) { const c = st.stock.pop(); c.up = true; st.waste.push(c); }
    else if (st.waste.length) { st.stock = st.waste.reverse().map((c) => ({ ...c, up: false })); st.waste = []; }
    else { undo.pop(); return; }
    moves++; movesEl.textContent = String(moves); g.sfx.page(); render();
  }
  function takeable(pi, depth = 1) { // cards that would be lifted from pile pi
    if (pi === 0) return null;
    const p = P(pi); if (!p.length) return null;
    if (pi < 6) return [p[p.length - 1]];
    const n = Math.min(depth, p.length); const cards = p.slice(p.length - n);
    return cards.every((c) => c.up) ? cards : null;
  }
  function tryMove(from, depth, to) {
    if (from === to) return false;
    const cards = takeable(from, depth); if (!cards) return false;
    const dest = P(to); let ok = false;
    if (to >= 6) ok = canDropTab(cards, dest); else if (to >= 2) ok = canDropFound(cards, dest);
    if (!ok) return false;
    push();
    const src = P(from); src.splice(src.length - cards.length, cards.length); dest.push(...cards);
    if (from >= 6 && src.length && !src[src.length - 1].up) src[src.length - 1].up = true;
    moves++; movesEl.textContent = String(moves); g.sfx.click();
    if (st.found.every((f) => f.length === 13)) { won = true; clearInterval(timer); msg.textContent = T('Gewonnen in {n} Zügen!', 'Won in {n} moves!', { n: moves }); if (g.best.set(moves, '', false)) { bestEl.textContent = String(moves); msg.textContent += T(' Neuer Rekord!', ' New record!'); } }
    return true;
  }
  function autoFound(pi) { for (let f = 2; f < 6; f++) if (tryMove(pi, 1, f)) return true; return false; }
  function autoMove(pi, depth) { // Enter/click without target: foundation first, then any tableau
    if (autoFound(pi) && depth === 1) return true;
    for (let t = 6; t < 13; t++) if (tryMove(pi, depth, t)) return true;
    return false;
  }

  // ---- rendering
  function cardEl(c, pi, ci) {
    const el = h('div.term-sol-card', { class: (c.up ? 'up' : 'down') + (c.up && RED(c.s) ? ' red' : ''), dataset: { pile: pi, idx: ci } });
    if (c.up) el.append(h('span.term-sol-rank', RANKS[c.r] + SUITS[c.s]), h('span.term-sol-suit', SUITS[c.s]));
    else el.textContent = '';
    return el;
  }
  function render() {
    clear(top); clear(bottom);
    for (let pi = 0; pi < 13; pi++) {
      const p = P(pi);
      const pile = h('div.term-sol-pile', { class: (pi === 0 ? 'stock' : pi === 1 ? 'waste' : pi < 6 ? 'found' : 'tab') + (cur.pile === pi ? ' cur' : ''), dataset: { pile: pi } });
      if (!p.length) pile.appendChild(h('div.term-sol-empty', pi === 0 ? '↻' : pi < 6 && pi > 1 ? 'A' : ''));
      let y = 0;
      p.forEach((c, ci) => {
        const el = cardEl(c, pi, ci);
        if (pi >= 6) { el.style.top = y + 'px'; y += c.up ? 24 : 9; }
        else if (pi === 1 || pi === 0) { el.style.top = '0'; }
        const selected = sel && sel.pile === pi && ci >= p.length - sel.depth;
        if (selected) el.classList.add('sel');
        if (pi >= 6 && cur.pile === pi && c.up && ci >= p.length - cur.depth) el.classList.add('cursor');
        pile.appendChild(el);
      });
      if (pi >= 6) pile.style.minHeight = (y + 86) + 'px';
      (pi < 6 ? top : bottom).appendChild(pile);
      if (pi === 1) top.appendChild(h('div.term-sol-gap'));
    }
  }

  // ---- mouse: click-to-move + drag
  let drag = null;
  function pileAt(x, y) { const el = document.elementFromPoint(x, y)?.closest?.('.term-sol-pile'); return el ? +el.dataset.pile : null; }
  table.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; e.preventDefault();
    const cardEl_ = e.target.closest('.term-sol-card'); const pileEl = e.target.closest('.term-sol-pile');
    if (!pileEl) return;
    const pi = +pileEl.dataset.pile;
    if (pi === 0) { sel = null; draw(); return; }
    if (!cardEl_) { // empty pile clicked = target
      if (sel) { if (!tryMove(sel.pile, sel.depth, pi)) g.sfx.error(); sel = null; render(); }
      return;
    }
    const ci = +cardEl_.dataset.idx; const p = P(pi); const depth = p.length - ci;
    if (!p[ci].up) return;
    if (sel && sel.pile !== pi) { // second click: target
      if (tryMove(sel.pile, sel.depth, pi)) { sel = null; render(); return; }
      sel = null;
    }
    if (sel && sel.pile === pi) { sel = null; render(); return; }
    sel = { pile: pi, depth }; cur = { pile: pi, depth }; render();
    drag = { pile: pi, depth, x: e.clientX, y: e.clientY, moved: false, el: null };
  });
  const onMove = (e) => {
    if (!drag) return;
    if (!drag.moved) { if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return; drag.moved = true;
      const cards = takeable(drag.pile, drag.depth); if (!cards) { drag = null; return; }
      drag.el = h('div.term-sol-drag', cards.map((c, i) => { const el = cardEl(c, -1, i); el.style.top = (i * 24) + 'px'; return el; })); document.body.appendChild(drag.el);
      table.querySelectorAll('.term-sol-card.sel').forEach((c) => c.classList.add('ghost'));
    }
    drag.el.style.left = (e.clientX - 30) + 'px'; drag.el.style.top = (e.clientY - 20) + 'px';
  };
  const onUp = (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved) return; // plain click → selection stays for click-to-move
    d.el?.remove();
    const to = pileAt(e.clientX, e.clientY);
    if (to != null && to !== d.pile) tryMove(d.pile, d.depth, to);
    sel = null;
    render();
  };
  table.addEventListener('dblclick', (e) => { const c = e.target.closest('.term-sol-card'); if (!c) return; const pi = +c.dataset.pile; if (pi < 1) return; const p = P(pi); if (+c.dataset.idx !== p.length - 1) return; sel = null; if (!autoFound(pi)) g.sfx.error(); render(); });
  window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);

  start();
  g.setHints([['←→', T('Stapel', 'pile')], ['↑↓', T('Karten', 'cards')], ['⏎', T('wählen / legen', 'pick / place')], ['␣', T('Talon', 'draw')], ['U', T('rückgängig', 'undo')], ['Esc', T('Spiele', 'games')]]);
  return {
    unmount() { clearInterval(timer); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); drag?.el?.remove(); },
    onKey(e) {
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight') { cur.pile = (cur.pile + (k === 'ArrowLeft' ? 12 : 1)) % 13; cur.depth = 1; render(); return true; }
      if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); if (cur.pile >= 6) { const p = P(cur.pile); const maxD = p.filter((c) => c.up).length; cur.depth = Math.max(1, Math.min(maxD, cur.depth + (k === 'ArrowUp' ? 1 : -1))); } else cur.pile = k === 'ArrowDown' ? Math.min(12, cur.pile + 6) : Math.max(0, cur.pile - 6); render(); return true; }
      if (k === ' ') { e.preventDefault(); sel = null; draw(); return true; }
      if (k === 'Enter') {
        if (cur.pile === 0) { sel = null; draw(); return true; }
        if (sel) { if (sel.pile === cur.pile) { if (!autoMove(sel.pile, sel.depth)) g.sfx.error(); sel = null; } else { if (!tryMove(sel.pile, sel.depth, cur.pile)) g.sfx.error(); sel = null; } render(); return true; }
        if (takeable(cur.pile, cur.depth)) { sel = { pile: cur.pile, depth: cur.depth }; g.sfx.type(); } else g.sfx.error();
        render(); return true;
      }
      if (k === 'u' || k === 'U') { doUndo(); return true; }
      if (k === 'n' || k === 'N') { start(); return true; }
      if (k === 'a' || k === 'A') { let any = false; for (let pi = 1; pi < 13; pi++) if (pi !== 2 && pi !== 3 && pi !== 4 && pi !== 5) while (autoFound(pi)) any = true; if (!any) g.sfx.error(); render(); return true; }
      return false;
    },
  };
}
