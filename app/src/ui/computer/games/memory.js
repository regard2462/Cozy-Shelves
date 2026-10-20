// Memory – find pairs, cards show the covers of your own books.
import { h, clear } from '../../../core/dom.js';
import { coverSrc } from '../../../core/cover-art.js';
import { btn, T } from '../terminal.js';

export async function mount(root, g) {
  const { ctx } = g;
  const books = (ctx.state?.library?.books || []).filter((b) => b.title);
  const board = h('div.term-memory');
  const movesEl = h('span.term-bright', '0'), pairsEl = h('span', '0'), bestEl = h('span', String(g.best.get() ?? '—'));
  const msg = h('div.term-game-msg');
  root.appendChild(h('div.term-game-center',
    h('div.term-game-bar', h('span.term-prompt', T('Züge', 'Moves')), movesEl, h('span.term-prompt', T('Paare', 'Pairs')), pairsEl, h('span.term-prompt', 'Best'), bestEl, h('span.spacer'), btn(T('Neu', 'New'), () => start())),
    board, msg,
    h('div.term-game-bar.term-dim', T('Pfeile bewegen · ⏎ aufdecken · Maus klicken', 'arrows move · ⏎ flip · click with the mouse'))));

  let cards, open = [], moves, pairs, lock = false, cur = 0, cols = 6;
  let cmpTimer = 0, cardEls = [];
  function start() {
    const pool = [...books].sort(() => Math.random() - 0.5);
    const nPairs = pool.length >= 8 ? 8 : Math.max(2, pool.length);
    cols = Math.min(8, nPairs); // two rows
    const picks = pool.slice(0, nPairs);
    cards = [...picks, ...picks].map((b, i) => ({ b, key: b.id, i, up: false, done: false })).sort(() => Math.random() - 0.5);
    open = []; moves = 0; pairs = 0; lock = false; cur = 0; movesEl.textContent = '0'; pairsEl.textContent = `0/${nPairs}`; msg.textContent = '';
    board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    clearTimeout(cmpTimer); cmpTimer = 0;
    build();
  }
  // build the cards ONCE – re-creating the <img> elements on every keypress re-decoded the covers
  // and restarted the flip transition.
  function build() {
    clear(board); cardEls = [];
    cards.forEach((c, i) => {
      const url = coverSrc(c.b, ctx.api);
      const face = h('div.term-memory-face', url ? h('img', { src: url, alt: '', loading: 'lazy' }) : null, h('div.term-memory-title', c.b.title.slice(0, 36)));
      const back = h('div.term-memory-back', '?');
      const el = h('div.term-memory-card', { onclick: () => { setCur(i); flip(i); } }, h('div.term-memory-inner', back, face));
      cardEls.push(el); board.appendChild(el);
    });
    paint();
  }
  function paint() {
    cards.forEach((c, i) => {
      const el = cardEls[i]; if (!el) return;
      el.classList.toggle('up', !!(c.up || c.done));
      el.classList.toggle('done', !!c.done);
      el.classList.toggle('cur', i === cur);
    });
  }
  function setCur(v) { const n = cards.length; const old = cardEls[cur]; cur = ((v % n) + n) % n; old?.classList.remove('cur'); cardEls[cur]?.classList.add('cur'); }
  function flip(i) {
    const c = cards[i]; if (lock || c.up || c.done) return;
    c.up = true; open.push(i); g.sfx.type(); paint();
    if (open.length === 2) {
      moves++; movesEl.textContent = String(moves); lock = true;
      const [a, b] = open.map((k) => cards[k]);
      cmpTimer = setTimeout(() => {
        cmpTimer = 0;
        if (a.key === b.key) { a.done = b.done = true; pairs++; pairsEl.textContent = `${pairs}/${cards.length / 2}`; g.sfx.click(); }
        else { a.up = b.up = false; }
        open = []; lock = false; paint();
        if (pairs === cards.length / 2) { msg.textContent = T('Alle Paare in {n} Zügen!', 'All pairs in {n} moves!', { n: moves }); if (g.best.set(moves, '', false)) { bestEl.textContent = String(moves); msg.textContent += T(' Neuer Rekord!', ' New record!'); } }
      }, a.key === b.key ? 350 : 800);
    }
  }
  if (books.length < 2) { root.appendChild(h('div.term-notice', T('Zu wenige Bücher für Memory (mindestens 2).', 'Not enough books for memory (at least 2).'))); return {}; }
  start();
  g.setHints([['←↑→↓', T('Cursor', 'cursor')], ['⏎', T('aufdecken', 'flip')], ['N', T('neu', 'new')], ['Esc', T('Spiele', 'games')]]);
  return {
    unmount() { clearTimeout(cmpTimer); },
    onKey(e) {
      if (e.key === 'ArrowLeft') { setCur(cur - 1); return true; }
      if (e.key === 'ArrowRight') { setCur(cur + 1); return true; }
      if (e.key === 'ArrowUp') { setCur(cur - cols); e.preventDefault(); return true; }
      if (e.key === 'ArrowDown') { setCur(cur + cols); e.preventDefault(); return true; }
      if (e.key === 'Enter' || e.key === ' ') { flip(cur); e.preventDefault(); return true; }
      if (e.key === 'n' || e.key === 'N') { start(); return true; }
      return false;
    },
  };
}
