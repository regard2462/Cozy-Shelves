// LESETAGEBUCH – all annotations across the books, and the bookmarks, grouped by book. The choice between the
// two lists is a step of the computer's history.
import { h, clear } from '../../../core/dom.js';
import { keyList, fmtDate, input, T, notice, isEditable, icon, cover } from '../terminal.js';
import { colorHex } from '../../reader/annotations.js';

export async function mount(root, s, params = {}) {
  const { ctx, sfx } = s;
  const lang = () => ctx.i18n?.lang || 'de';
  let tab = params.tab === 'bookmarks' ? 'bookmarks' : 'notes';
  let query = '';
  let list = null;
  const el = h('div.term-diary');
  root.appendChild(el);
  const books = () => ctx.state?.library?.books || [];
  const count = (key) => books().reduce((a, b) => a + (b[key]?.length || 0), 0);

  const q = input({ type: 'search', placeholder: T('Notizen, Zitate, Titel durchsuchen …', 'Search notes, quotes, titles …'), oninput: (e) => { query = e.target.value; renderList(); } });
  const tabs = h('div.term-seg', { role: 'tablist', 'aria-label': T('Liste', 'List') });
  const paintTabs = () => {
    clear(tabs);
    for (const [v, label, n] of [['notes', T('Anmerkungen', 'Annotations'), count('annotations')], ['bookmarks', T('Lesezeichen', 'Bookmarks'), count('bookmarks')]]) {
      tabs.appendChild(h('button.term-seg-btn', { type: 'button', tabindex: -1, role: 'tab', 'aria-selected': tab === v ? 'true' : 'false', class: tab === v ? 'on' : '', dataset: { tab: v },
        onclick: () => setTab(v) }, label, h('span.term-seg-count', String(n))));
    }
  };
  const body = h('div.term-diary-list');
  el.append(h('div.term-toolbar', tabs, h('span.spacer'), h('label.term-search.term-search-narrow', icon('search'), q)), body);

  function setTab(t, { record = true } = {}) {
    if (t === tab) return;
    tab = t; sfx.click();
    if (record) s.nav.push(t === 'bookmarks' ? { tab: t } : {});
    paintTabs(); renderList();
  }
  function entries() {
    const out = [];
    for (const b of books()) {
      if (tab === 'notes') for (const a of b.annotations || []) out.push({ book: b, a });
      else for (const bm of b.bookmarks || []) out.push({ book: b, bm });
    }
    out.sort((x, y) => ((y.a || y.bm).createdAt || 0) - ((x.a || x.bm).createdAt || 0));
    const t = query.trim().toLowerCase();
    if (!t) return out;
    return out.filter((e) => `${e.book.title} ${e.book.author} ${e.a?.note || ''} ${e.a?.text || ''} ${e.bm?.label || ''}`.toLowerCase().includes(t));
  }
  function renderList() {
    clear(body);
    const es = entries();
    if (!es.length) {
      body.appendChild(notice(query.trim() ? T('Nichts gefunden.', 'Nothing found.') : tab === 'notes'
        ? T('Noch keine Anmerkungen. Markiere im Lesegerät einen Text und schreibe eine Notiz dazu.', 'No annotations yet. Highlight text in the reader and add a note.')
        : T('Noch keine Lesezeichen. Im Lesegerät setzt die Taste B eines.', 'No bookmarks yet. In the reader the B key sets one.')));
      list = null; return;
    }
    const rows = [];
    let lastBook = null, group = null;
    for (const e of es) {
      const b = e.book;
      if (b !== lastBook) {
        lastBook = b;
        group = h('div.term-diary-group');
        body.append(h('div.term-diary-book', cover(b, ctx.api, 'term-cov-xs'), h('span.term-ctitle', b.title || '?'), b.author ? h('span.term-cauthor', b.author) : null), group);
      }
      if (tab === 'notes') {
        const a = e.a;
        // the same colours as the highlights in the reader (a.color is 'yellow', 'green' … or 'none' = underline)
        const swatch = a.color && a.color !== 'none' ? colorHex(a.color) : 'transparent';
        const row = h('div.term-note', { dataset: { id: b.id, loc: a.value || '' }, role: 'button' },
          h('div.term-note-head', h('span.term-note-color', { style: { background: swatch } }), h('span.term-dim', fmtDate(a.createdAt, lang()))),
          a.text ? h('div.term-note-quote', '“' + String(a.text).slice(0, 260) + (a.text.length > 260 ? '…' : '') + '”') : null,
          a.note ? h('div.term-note-text', a.note) : null);
        rows.push(row); group.appendChild(row);
      } else {
        const bm = e.bm;
        const row = h('div.term-note.term-bm', { dataset: { id: b.id, loc: bm.location || '' }, role: 'button' },
          icon('bookmark'), h('span.term-bm-label', bm.label || bm.location || '?'), bm.page ? h('span.term-dim', T('S. {p}', 'p. {p}', { p: bm.page })) : null, h('span.term-dim', fmtDate(bm.createdAt, lang())));
        rows.push(row); group.appendChild(row);
      }
    }
    list = keyList(rows, { onEnter: (row) => s.readBook(row.dataset.id, row.dataset.loc || null) });
    list.set(0, false);
  }
  paintTabs();
  renderList();
  s.setHints([['↑↓', T('wählen', 'select')], ['⏎', T('Stelle öffnen', 'open passage')], ['Tab', T('Anmerkungen / Lesezeichen', 'annotations / bookmarks')], ['/', T('suchen', 'search')], ['Esc', T('zurück', 'back')]]);

  return {
    navigate(p) { setTab(p.tab === 'bookmarks' ? 'bookmarks' : 'notes', { record: false }); return true; },
    onKey(e) {
      if (e.key === 'Tab') { e.preventDefault(); setTab(tab === 'notes' ? 'bookmarks' : 'notes'); return true; }
      if (isEditable(e.target)) {
        if (e.target === q && e.key === 'ArrowDown' && list) { e.preventDefault(); q.blur(); s.focusScreen(); list.set(0); return true; }
        return e.key !== 'Escape';
      }
      if (e.key === '/') { e.preventDefault(); q.focus(); return true; }
      if (list && list.onKey(e)) { e.preventDefault(); return true; }
      // focus the search field but let the character through (see catalog.js)
      if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) { q.focus(); return false; }
      return false;
    },
  };
}
