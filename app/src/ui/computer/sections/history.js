// AUSLEIHE & VERLAUF – the borrowed books as cards with their covers, and the reading history by day.
import { h, clear } from '../../../core/dom.js';
import { keyList, T, notice, isEditable, btn, icon, cover, progress } from '../terminal.js';

export async function mount(root, s) {
  const { ctx, sfx } = s;
  const lang = () => ctx.i18n?.lang || 'de';
  let list = null, disposed = false, seq = 0;
  const el = h('div.term-history');
  root.appendChild(el);

  const books = () => ctx.state?.library?.books || [];
  const bookById = (id) => books().find((b) => b.id === id);
  const borrowedIds = () => { const set = new Set(ctx.state?.basket || []); for (const b of books()) if (b.borrowed) set.add(b.id); return [...set]; };
  const dayLabel = (ts) => {
    const d = new Date(ts); const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
    const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(d, today)) return T('Heute', 'Today');
    if (same(d, y)) return T('Gestern', 'Yesterday');
    return d.toLocaleDateString(lang() === 'de' ? 'de-DE' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  };
  const timeOf = (ts) => new Date(ts).toLocaleTimeString(lang() === 'de' ? 'de-DE' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  // a page number means something to the reader, an EPUB CFI ("epubcfi(/6/8!/4,…)") does not
  const shortLoc = (loc) => { if (loc == null || loc === '') return ''; loc = String(loc); return /^\d+$/.test(loc) ? T('S. {p}', 'p. {p}', { p: loc }) : ''; };

  // render() is async (it awaits the history API). A sequence token makes sure that only the newest invocation
  // touches the DOM ('Alle zurückgeben' fires one basket change per book).
  async function render() {
    if (disposed) return;
    const my = ++seq;
    const keepIdx = list?.index ?? 0;
    let hist = [];
    try { hist = (await ctx.api.library.history(80)) || []; } catch (e) { console.warn(e); }
    if (disposed || my !== seq) return;
    clear(el);
    const rows = [];

    // ---- borrowed ----
    const ids = borrowedIds().filter((id) => bookById(id));
    el.appendChild(h('div.term-block-head', h('h3.term-h', T('Ausgeliehen', 'Borrowed'), h('span.term-h-count', String(ids.length))), h('span.spacer'),
      ids.length ? btn(T('Alle zurückgeben', 'Return all'), () => { sfx.click(); for (const id of ids) ctx.bus.emit('book:return', { id }); s.toast(T('Alle Bücher zurückgegeben.', 'All books returned.')); }, 'small') : null));
    if (!ids.length) el.appendChild(notice(T('Nichts ausgeliehen. Im Katalog legt „In den Korb“ ein Buch in deinen Korb, im Raum die Taste E.', 'Nothing borrowed. In the catalogue “Add to basket” puts a book into your basket, in the room the E key does.')));
    else {
      const grid = h('div.term-loans');
      for (const id of ids) {
        const b = bookById(id);
        const card = h('div.term-loan', { dataset: { id, act: 'read' }, role: 'button', title: T('Lesen: {t}', 'Read: {t}', { t: b.title || '' }) },
          cover(b, ctx.api, 'term-cont-cover'),
          h('div.term-cont-body',
            h('div.term-cont-title', b.title || '?'),
            b.author ? h('div.term-cont-author', b.author) : null,
            progress(b.progress || 0),
            h('div.term-cont-actions',
              h('span.term-cont-go', icon('read'), T('Lesen', 'Read')),
              h('button.term-linkbtn', { type: 'button', tabindex: -1, onclick: (e) => { e.stopPropagation(); giveBack(id); } }, T('Zurückgeben', 'Return')))));
        rows.push(card); grid.appendChild(card);
      }
      el.appendChild(grid);
    }

    // ---- history by day ----
    el.appendChild(h('div.term-block-head', h('h3.term-h', T('Verlauf', 'History'))));
    const entries = hist.map((e) => ({ e, b: e.book || bookById(e.id) })).filter((x) => x.b);
    if (!entries.length) el.appendChild(notice(T('Noch kein Verlauf. Geöffnete und ausgeliehene Bücher erscheinen hier.', 'No history yet. Opened and borrowed books will appear here.')));
    let lastDay = null, group = null;
    for (const { e, b } of entries) {
      const day = dayLabel(e.at);
      if (day !== lastDay) { lastDay = day; group = h('div.term-timeline'); el.append(h('div.term-day', day), group); }
      const type = { open: T('geöffnet', 'opened'), borrow: T('ausgeliehen', 'borrowed'), return: T('zurückgegeben', 'returned') }[e.type] || e.type;
      const prog = e.progress ?? b.progress ?? 0;
      const loc = e.location || b.lastLocation;
      const row = h('div.term-event', { dataset: { id: b.id, act: 'read', loc: loc || '' }, role: 'button' },
        h('span.term-event-time', timeOf(e.at)),
        h('span.term-event-type', { class: 'is-' + (e.type || 'open') }, type),
        cover(b, ctx.api, 'term-cov-xs'),
        h('span.term-event-book', h('span.term-ctitle', b.title || '?'), b.author ? h('span.term-cauthor', b.author) : null),
        h('span.term-event-pos', `${Math.round(prog * 100)} %`, shortLoc(loc) ? h('span.term-dim', ' · ' + shortLoc(loc)) : null),
        h('span.term-event-go', icon('read'), T('Weiterlesen', 'Continue')));
      rows.push(row); group.appendChild(row);
    }
    list = keyList(rows, { onEnter: (row) => { sfx.click(); readOn(row.dataset.id, row.dataset.loc || null); } });
    if (rows.length) list.set(Math.min(keepIdx, rows.length - 1), false);
  }
  function giveBack(id) { sfx.click(); ctx.bus.emit('book:return', { id }); const b = bookById(id); s.toast(T('Zurückgegeben: ', 'Returned: ') + (b?.title || '')); }
  function readOn(id, loc) { s.readBook(id, loc); }

  // 'book:return' triggers 'basket:change', which re-renders
  const offBasket = ctx.bus?.on?.('basket:change', () => { render(); });
  s.setHints([['↑↓', T('wählen', 'select')], ['⏎', T('lesen', 'read')], ['Entf', T('zurückgeben', 'return')], ['Esc', T('zurück', 'back')]]);
  await render();
  return {
    unmount() { disposed = true; offBasket?.(); },
    onKey(e) {
      if (isEditable(e.target)) return false;
      if (e.key === 'Delete' && list?.current?.classList.contains('term-loan')) { giveBack(list.current.dataset.id); return true; }
      if (list && list.onKey(e)) { e.preventDefault(); return true; }
      return false;
    },
  };
}
