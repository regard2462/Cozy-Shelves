// KATALOG – search the collection (title and author, or the full text), filter by status, department and format,
// sort by any column, and a book's detail view with its actions. Every step is an entry of the computer's
// history: s.nav.push for filters, sorting and a detail view, s.nav.replace while a search is typed.
import { h, clear } from '../../../core/dom.js';
import { keyList, fmtDate, fmtTime, isEditable, btn, input, select, T, Tn, notice, icon, cover, progress } from '../terminal.js';
import { has } from '../../../core/platform.js';

const FORMATS = ['pdf', 'epub', 'mobi', 'azw3', 'fb2', 'cbz', 'txt', 'md', 'html', 'docx'];
const DEFAULTS = { q: '', mode: 'meta', dept: 'all', fmt: 'all', status: 'all', sort: 'title', dir: 'asc' };
/** the natural direction of each sort key (a second click on the column reverses it) */
const NATURAL = { title: 'asc', author: 'asc', dept: 'asc', format: 'asc', pages: 'desc', progress: 'desc', lastRead: 'desc', added: 'desc' };
const STATUS = ['all', 'unread', 'reading', 'finished', 'borrowed'];

export async function mount(root, s, params = {}) {
  const { ctx, sfx } = s;
  const lang = () => ctx.i18n?.lang || 'de';
  const st = { ...DEFAULTS };
  const applyParams = (p) => {
    for (const k of Object.keys(DEFAULTS)) st[k] = p[k] ?? DEFAULTS[k];
    if (!['meta', 'text'].includes(st.mode)) st.mode = 'meta';
    if (!STATUS.includes(st.status)) st.status = 'all';
    if (!NATURAL[st.sort]) st.sort = 'title';
    if (st.dir !== 'asc' && st.dir !== 'desc') st.dir = NATURAL[st.sort];
  };
  applyParams(params);
  /** the list state for the history: only what differs from the defaults */
  const listState = () => Object.fromEntries(Object.entries(st).filter(([k, v]) => v !== DEFAULTS[k] && !(k === 'dir' && v === NATURAL[st.sort])));
  let results = [];
  let searchSeq = 0, debounce = null, lastSearch = null;
  let list = null;
  let detail = null; // { el, id, onKey, unmount }
  let disposed = false;

  const listView = h('div.term-catalog');
  root.appendChild(listView);
  const books = () => ctx.state?.library?.books || [];
  const deps = () => (ctx.state?.library?.departments || []);
  const inBasket = (b) => !!(ctx.state?.basket?.includes(b.id) || b.borrowed);
  const statusOf = (b) => ((b.progress || 0) >= 0.985 || b.finished ? 'finished' : (b.progress || 0) > 0 || b.lastRead ? 'reading' : 'unread');

  // ---- search bar -----------------------------------------------------------------------------------------------
  const q = input({ value: st.q, type: 'search', placeholder: T('Titel, Autor, Abteilung, Regal, ISBN …', 'title, author, department, shelf, ISBN …'),
    oninput: (e) => { st.q = e.target.value; schedule(); },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(true); } } });
  const modeSeg = h('div.term-seg', { role: 'radiogroup', 'aria-label': T('Suchart', 'Search mode') });
  const paintMode = () => {
    clear(modeSeg);
    for (const [v, l] of [['meta', T('Titel & Autor', 'Title & author')], ['text', T('Volltext', 'Full text')]]) {
      modeSeg.appendChild(h('button.term-seg-btn', { type: 'button', tabindex: -1, role: 'radio', 'aria-checked': st.mode === v ? 'true' : 'false', class: st.mode === v ? 'on' : '',
        onclick: () => { if (st.mode === v) return; st.mode = v; sfx.click(); paintMode(); s.nav.push(listState()); runSearch(true); } }, l));
    }
  };
  paintMode();
  const countEl = h('span.term-count');

  // ---- filters --------------------------------------------------------------------------------------------------
  const statusLabel = { all: T('Alle', 'All'), unread: T('Ungelesen', 'Unread'), reading: T('Angefangen', 'In progress'), finished: T('Beendet', 'Finished'), borrowed: T('Im Korb', 'In basket') };
  const statusSeg = h('div.term-seg.term-status-seg', { role: 'radiogroup', 'aria-label': T('Status', 'Status') });
  const paintStatus = () => {
    clear(statusSeg);
    for (const v of STATUS) statusSeg.appendChild(h('button.term-seg-btn', { type: 'button', tabindex: -1, role: 'radio', 'aria-checked': st.status === v ? 'true' : 'false', class: st.status === v ? 'on' : '', dataset: { status: v },
      onclick: () => setFilter('status', v) }, statusLabel[v]));
  };
  paintStatus();
  const deptSel = select([['all', T('Alle Abteilungen', 'All departments')], ...deps().map((d) => [d.name, `${d.name} (${d.count ?? d.shelves?.reduce((a, x) => a + x.bookIds.length, 0) ?? ''})`])], st.dept, (v) => setFilter('dept', v));
  const fmtSel = select([['all', T('Alle Formate', 'All formats')], ...FORMATS.map((f) => [f, f.toUpperCase()])], st.fmt, (v) => setFilter('fmt', v));
  const SORTS = [['title', T('Titel', 'Title')], ['author', T('Autor', 'Author')], ['dept', T('Abteilung', 'Department')], ['format', T('Format', 'Format')], ['pages', T('Seiten', 'Pages')],
    ['progress', T('Fortschritt', 'Progress')], ['lastRead', T('Zuletzt gelesen', 'Last read')], ['added', T('Neu hinzugefügt', 'Recently added')]];
  const sortSel = select(SORTS, st.sort, (v) => setSort(v, NATURAL[v]));
  deptSel.setAttribute('aria-label', T('Abteilung', 'Department'));
  fmtSel.setAttribute('aria-label', T('Format', 'Format'));
  sortSel.setAttribute('aria-label', T('Sortierung', 'Sort'));

  // ---- table head: every column sorts ---------------------------------------------------------------------------
  const head = h('div.term-grid.term-thead.term-ctable-head');
  const sortBtn = (key, label, cls = '') => h('button.term-sort' + (cls ? '.' + cls : ''), { type: 'button', tabindex: -1, dataset: { sort: key }, title: T('Nach {c} sortieren', 'Sort by {c}', { c: label }),
    onclick: () => { sfx.click(); setSort(key, st.sort === key ? (st.dir === 'asc' ? 'desc' : 'asc') : NATURAL[key]); } }, label, h('span.term-sort-arrow'));
  head.append(h('span'), h('span.term-thead-pair', sortBtn('title', T('Titel', 'Title')), h('span.term-thead-sep', '·'), sortBtn('author', T('Autor', 'Author'))),
    sortBtn('dept', T('Abteilung', 'Department')), sortBtn('format', T('Format', 'Format')), sortBtn('pages', T('Seiten', 'Pages'), 'r'), sortBtn('progress', T('Fortschritt', 'Progress')));
  const paintHead = () => {
    for (const b of head.querySelectorAll('.term-sort')) {
      const on = b.dataset.sort === st.sort;
      b.classList.toggle('on', on);
      b.setAttribute('aria-sort', on ? (st.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      b.querySelector('.term-sort-arrow').textContent = on ? (st.dir === 'asc' ? '↑' : '↓') : '';
    }
  };
  paintHead();
  const rowsEl = h('div.term-table.term-ctable');

  listView.append(
    h('div.term-toolbar', h('label.term-search', icon('search'), q), modeSeg, countEl),
    h('div.term-filters', statusSeg, h('span.spacer'), deptSel, fmtSel, h('span.term-filter-sort', { title: T('Sortierung', 'Sort') }, icon('sort'), sortSel)),
    head, rowsEl);

  function setFilter(key, v) {
    if (st[key] === v) return;
    st[key] = v; sfx.click();
    paintStatus(); deptSel.value = st.dept; fmtSel.value = st.fmt;
    s.nav.push(listState());
    renderRows(); list?.set(0, false);
  }
  function setSort(key, dir) {
    if (st.sort === key && st.dir === dir) return;
    st.sort = key; st.dir = dir || NATURAL[key];
    sortSel.value = st.sort; paintHead();
    s.nav.push(listState());
    renderRows(); list?.set(0, false);
  }

  function schedule() { clearTimeout(debounce); debounce = setTimeout(() => { s.nav.replace(listState()); runSearch(); }, 180); }
  async function runSearch(now) {
    const seq = ++searchSeq; const text = st.q.trim();
    const key = st.mode + '|' + text;
    let res = [];
    try {
      if (st.mode === 'text') res = text ? ((await ctx.api.library.searchText(text)) || []) : [];
      else if (text) res = ((await ctx.api.library.search(text)) || []).map((b) => ({ book: b }));
      else res = books().map((b) => ({ book: b }));
    } catch (e) { console.warn('[catalog] search failed', e); }
    if (seq !== searchSeq || disposed) return;
    lastSearch = key;
    results = res.filter((r) => r && r.book);
    renderRows();
    if (now) { q.blur(); s.focusScreen(); if (list && list.rows.length) list.set(0); }
  }

  function filtered() {
    let r = results;
    if (st.dept !== 'all') r = r.filter((x) => x.book.department === st.dept);
    if (st.fmt !== 'all') r = r.filter((x) => x.book.format === st.fmt);
    if (st.status === 'borrowed') r = r.filter((x) => inBasket(x.book));
    else if (st.status !== 'all') r = r.filter((x) => statusOf(x.book) === st.status);
    const L = lang();
    const cmp = {
      title: (a, b) => (a.title || '').localeCompare(b.title || '', L),
      author: (a, b) => (a.author || '').localeCompare(b.author || '', L) || (a.title || '').localeCompare(b.title || '', L),
      dept: (a, b) => (a.department || '').localeCompare(b.department || '', L) || (a.shelf || '').localeCompare(b.shelf || '', undefined, { numeric: true }) || (a.title || '').localeCompare(b.title || '', L),
      format: (a, b) => (a.format || '').localeCompare(b.format || '') || (a.title || '').localeCompare(b.title || '', L),
      progress: (a, b) => (a.progress || 0) - (b.progress || 0),
      lastRead: (a, b) => (a.lastRead || 0) - (b.lastRead || 0),
      added: (a, b) => (a.addedAt || 0) - (b.addedAt || 0),
      pages: (a, b) => (a.pageCount || 0) - (b.pageCount || 0),
    }[st.sort];
    // the full-text search comes ranked: it keeps that order unless another column is chosen
    if (st.mode !== 'text' || st.sort !== 'title' || st.dir !== 'asc') {
      const sign = st.dir === 'desc' ? -1 : 1;
      r = [...r].sort((a, b) => sign * cmp(a.book, b.book) || (a.book.title || '').localeCompare(b.book.title || '', L));
    }
    return r;
  }

  function renderRows() {
    clear(rowsEl);
    const r = filtered();
    countEl.textContent = r.length === 1 ? T('1 Buch', '1 book') : T('{n} Bücher', '{n} books', { n: r.length });
    if (!r.length) {
      rowsEl.appendChild(notice(st.mode === 'text' && !st.q.trim()
        ? T('Suchbegriff eingeben. Die Volltextsuche durchsucht den Inhalt der Bücher.', 'Type a query. The full-text search looks inside the books.')
        : T('Keine Treffer. Filter oder Suchbegriff ändern.', 'No results. Change the filters or the query.')));
      list = null; return;
    }
    const shown = r.slice(0, 400);
    const rows = shown.map(({ book: b, excerpt }) => {
      const row = h('div.term-grid.term-crow', { dataset: { id: b.id }, role: 'button' },
        h('span.term-cell.term-cell-cover', cover(b, ctx.api, 'term-cov-s')),
        h('span.term-cell.term-cell-title', h('span.term-ctitle', b.title || '?'), b.author ? h('span.term-cauthor', b.author) : null),
        h('span.term-cell.term-cell-dept', b.department || '—', b.shelf ? h('span.term-cshelf', ' › ' + b.shelf) : null),
        h('span.term-cell', b.format ? h('span.term-badge', b.format.toUpperCase()) : ''),
        h('span.term-cell.r', b.pageCount || '—'),
        h('span.term-cell', inBasket(b) ? h('span.term-inbasket', { title: T('Im Korb', 'In the basket') }, icon('basket')) : null, (b.progress || 0) > 0 ? progress(b.progress) : h('span.term-dim', '·')));
      if (excerpt) row.appendChild(h('span.term-excerpt', '… ' + excerpt + ' …'));
      return row;
    });
    rowsEl.append(...rows);
    if (shown.length < r.length) rowsEl.appendChild(h('div.term-dim.term-line', T('… {n} weitere (Suche eingrenzen)', '… {n} more (narrow the search)', { n: r.length - shown.length })));
    list = keyList(rows, { onEnter: (row) => { sfx.click(); openDetail(row.dataset.id); } });
  }

  // ---- detail -----------------------------------------------------------------------------------------------------
  /** record=false: the step comes from the history (back/forward) and is already an entry */
  async function openDetail(id, { record = true } = {}) {
    let book = books().find((b) => b.id === id) || results.find((r) => r.book.id === id)?.book;
    try { book = (await ctx.api.library.book(id)) || book; } catch { /* keep */ }
    if (!book || disposed) return;
    if (record) s.nav.push({ ...listState(), book: id });
    listView.hidden = true;
    detail?.unmount?.(); detail?.el?.remove(); detail = null;
    const el = h('div.term-detail');
    root.appendChild(el);
    root.scrollTop = 0;
    detail = renderDetail(el, book);
    s.setCrumbs({ label: T('Katalog', 'Catalogue'), go: () => closeDetail() }, book.title || '?');
    s.setHints([['←→', T('Aktion', 'action')], ['⏎', 'OK'], ['1-5', T('direkt', 'direct')], ['Esc', T('zur Liste', 'to the list')], ['Alt ←', T('zurück', 'back')]]);
    s.focusScreen();
  }
  /** Esc and the crumb: back when the list is the step before, else a new step to the list. */
  function closeDetail({ record = true } = {}) {
    if (!detail) return;
    if (record) {
      const prev = s.nav.peek(-1);
      if (prev && prev.id === 'catalog' && s.nav.same(prev.params, listState())) { s.nav.back(); return; }
      s.nav.push(listState());
    }
    detail?.unmount?.(); detail?.el?.remove(); detail = null;
    listView.hidden = false;
    s.setCrumbs(T('Katalog', 'Catalogue'));
    setListHints();
    s.focusScreen();
    // the row of the book just seen stays selected
    list?.current?.scrollIntoView?.({ block: 'nearest' });
  }

  function renderDetail(el, b) {
    const L = lang();
    const fact = (k, v) => (v == null || v === '' ? null : h('div.term-fact', h('dt', k), h('dd', v)));
    const borrowed = inBasket(b);
    const actions = [
      { label: T('Lesen', 'Read'), icon: 'read', primary: true, run: () => s.readBook(b.id) },
      borrowed
        ? { label: T('Zurückgeben', 'Return'), icon: 'basket', run: () => { ctx.bus.emit('book:return', { id: b.id }); s.toast(T('Zurückgegeben: ', 'Returned: ') + (b.title || '')); b.borrowed = false; rerender(); } }
        : { label: T('In den Korb', 'Add to basket'), icon: 'basket', run: () => { ctx.bus.emit('book:borrow', { id: b.id }); s.toast(T('In den Korb gelegt: ', 'Added to basket: ') + (b.title || '')); setTimeout(rerender, 60); } },
      { label: T('Im Regal zeigen', 'Show on shelf'), icon: 'shelf', run: () => { ctx.bus.emit('world:goto-book', { id: b.id }); ctx.close(); } },
      { label: T('Abteilung ändern', 'Change department'), icon: 'folder', run: () => showDeptForm() },
      { label: T('Datei zeigen', 'Show file'), icon: 'file', run: () => { if (!has('revealFile')) return; ctx.api.library.revealFile?.(b.id); s.toast(T('Datei wird im Explorer gezeigt …', 'Showing the file in the Explorer …')); } },
    ];
    // the first four are buttons, "Datei zeigen" (5) sits next to the file name in the facts
    const actionEls = actions.slice(0, 4).map((a, i) => h('button.term-btn.term-action' + (a.primary ? '.primary' : ''), { type: 'button', tabindex: -1, dataset: { i } },
      icon(a.icon), a.label, h('kbd.term-key', String(i + 1))));
    const actionBar = h('div.term-actions', actionEls);
    const actionList = keyList(actionEls, { horizontal: true, wrap: true, onEnter: (row) => { sfx.click(); actions[+row.dataset.i].run(); } });
    actionList.set(0, false);
    const formSlot = h('div');

    const lastRead = b.lastRead ? fmtDate(b.lastRead, L) : null;
    const progLine = [
      (b.progress || 0) > 0 ? T('{p} % gelesen', '{p} % read', { p: Math.round((b.progress || 0) * 100) }) : T('noch nicht begonnen', 'not started yet'),
      b.readingSeconds ? T('{t} Lesezeit', '{t} reading time', { t: fmtTime(b.readingSeconds) }) : null,
      lastRead ? T('zuletzt am {d}', 'last read {d}', { d: lastRead }) : null,
    ].filter(Boolean).join(' · ');

    const chips = [b.format ? b.format.toUpperCase() : null, b.pageCount ? T('{n} Seiten', '{n} pages', { n: b.pageCount }) : null, b.language ? b.language.toUpperCase() : null, b.year || null, borrowed ? T('im Korb', 'in the basket') : null].filter(Boolean);
    const info = h('div.term-detail-info',
      h('div.term-detail-kicker', icon('shelf'), `${b.department || '—'}${b.shelf ? ' › ' + b.shelf : ''}`),
      h('h2.term-detail-title', b.title || '?'),
      b.author ? h('div.term-detail-author', b.author) : null,
      h('div.term-chips', chips.map((c, i) => h('span.term-chip' + (borrowed && i === chips.length - 1 ? '.accent' : ''), String(c)))),
      h('div.term-detail-progress', progress(b.progress || 0, { label: false, cls: 'wide' }), h('span.term-dim', progLine)),
      actionBar);

    // left: description and the reader's traces; right: the facts
    const main = h('div.term-detail-main');
    if (b.description) main.append(h('h3.term-h', T('Beschreibung', 'Description')), h('div.term-desc', String(b.description).replace(/<[^>]+>/g, '').trim()));
    const bms = b.bookmarks || [];
    if (bms.length) main.append(h('h3.term-h', T('Lesezeichen', 'Bookmarks'), h('span.term-h-count', String(bms.length))),
      h('div.term-sublist', bms.map((bm) => h('button.term-subrow', { type: 'button', tabindex: -1, onclick: () => s.readBook(b.id, bm.location) },
        icon('bookmark'), h('span.term-subrow-main', bm.label || bm.location || '?'), bm.page ? h('span.term-dim', T('S. {p}', 'p. {p}', { p: bm.page })) : null, h('span.term-dim', fmtDate(bm.createdAt, L))))));
    const pos = b.positions || [];
    if (pos.length) main.append(h('h3.term-h', T('Schachstellungen', 'Chess positions'), h('span.term-h-count', String(pos.length))),
      h('div.term-sublist', pos.map((p) => h('button.term-subrow', { type: 'button', tabindex: -1, onclick: () => ctx.openPanel?.('chess', { fen: p.fen, bookId: b.id }) },
        h('span.term-subrow-glyph', '♞'), h('span.term-subrow-main', p.label || p.fen), h('span.term-dim', fmtDate(p.createdAt, L))))));
    const ann = b.annotations || [];
    main.append(h('p.term-dim.term-detail-note', ann.length
      ? h('button.term-linkbtn', { type: 'button', tabindex: -1, onclick: () => { sfx.click(); s.goSection('diary'); } }, Tn(ann.length, ['1 Anmerkung im Lesetagebuch', '1 annotation in the reading diary'], ['{n} Anmerkungen im Lesetagebuch', '{n} annotations in the reading diary']), icon('arrow'))
      : T('Noch keine Anmerkungen in diesem Buch.', 'No annotations in this book yet.')));
    const facts = h('dl.term-facts',
      fact('ISBN', b.isbn), fact(T('Verlag', 'Publisher'), b.publisher), fact(T('Jahr', 'Year'), b.year),
      fact(T('Hinzugefügt', 'Added'), b.addedAt ? fmtDate(b.addedAt, L) : null),
      fact(T('Zuletzt gelesen', 'Last read'), lastRead),
      fact(T('Geöffnet', 'Opened'), b.timesOpened ? T('{n}-mal', '{n} times', { n: b.timesOpened }) : null),
      fact(T('Einordnung', 'Shelving'), b.departmentSource === 'manual' ? T('manuell', 'manual') : b.departmentSource === 'auto' ? T('automatisch', 'automatic') : T('nach Ordnern', 'by folders')),
      fact(T('Datei', 'File'), h('span.term-file', h('span.term-path', { title: b.path || '' }, b.relPath || b.path || ''),
        // the browser version cannot open the Explorer (core/platform.js)
        has('revealFile') ? h('button.term-linkbtn', { type: 'button', tabindex: -1, onclick: () => { sfx.click(); actions[4].run(); } }, icon('file'), T('Im Explorer zeigen', 'Show in Explorer'), h('kbd.term-key', '5')) : null)));

    el.append(h('div.term-detail-top', cover(b, ctx.api, 'term-cov-xl'), info), formSlot, h('div.term-detail-cols', main, facts));

    function rerender() {
      if (!detail || detail.el !== el) return;
      const fresh = books().find((x) => x.id === b.id) || b;
      clear(el); Object.assign(detail, renderDetail(el, fresh));
    }

    let form = null;
    function showDeptForm() {
      if (form) return;
      const depList = deps();
      let depName = b.department || (depList[0]?.name || ''); let shelfName = b.shelf || '';
      const NEW = '__new__';
      const depInput = input({ placeholder: T('Neue Abteilung', 'New department'), hidden: true });
      const shelfInput = input({ placeholder: T('Neues Regal', 'New shelf'), hidden: true });
      const shelfSel = select([], shelfName, (v) => { shelfInput.hidden = v !== NEW; if (v !== NEW) shelfName = v; else shelfInput.focus(); });
      const fillShelves = () => { clear(shelfSel); const d = depList.find((x) => x.name === depName); const opts = [['', T('(kein Regal)', '(no shelf)')], ...((d?.shelves || []).map((sh) => [sh.name, sh.name])), [NEW, T('Neues Regal …', 'New shelf …')]]; for (const [v, l] of opts) shelfSel.appendChild(h('option', { value: v, selected: v === shelfName }, l)); };
      const depSel = select([...depList.map((d) => [d.name, d.name]), [NEW, T('Neue Abteilung …', 'New department …')]], depName, (v) => { depInput.hidden = v !== NEW; depName = v === NEW ? '' : v; shelfName = ''; fillShelves(); if (v === NEW) depInput.focus(); });
      fillShelves();
      const ok = async () => {
        const d = (depSel.value === NEW ? depInput.value : depSel.value).trim();
        const sh = (shelfSel.value === NEW ? shelfInput.value : shelfSel.value).trim();
        if (!d) { sfx.error(); return; }
        try {
          const nb = await ctx.api.library.setDepartment(b.id, d, sh || null);
          Object.assign(b, nb || { department: d, shelf: sh || null, departmentSource: 'manual' });
          const sb = books().find((x) => x.id === b.id); if (sb) Object.assign(sb, { department: b.department, shelf: b.shelf, departmentSource: 'manual' });
          s.toast(T('Abteilung geändert: ', 'Department changed: ') + `${d}${sh ? ' › ' + sh : ''}`);
          sfx.click(); closeForm(); rerender();
        } catch (e) { sfx.error(); s.toast(T('Fehler: ', 'Error: ') + (e?.message || e)); }
      };
      form = h('div.term-form',
        h('h3.term-h', T('Abteilung ändern', 'Change department')),
        h('div.term-form-row', h('span.term-k', T('Abteilung', 'Department')), depSel, depInput),
        h('div.term-form-row', h('span.term-k', T('Regal', 'Shelf')), shelfSel, shelfInput),
        h('div.term-form-row', h('span.term-k', ''), btn(T('Übernehmen', 'Apply'), ok, 'primary'), btn(T('Abbrechen', 'Cancel'), () => { sfx.click(); closeForm(); })));
      formSlot.appendChild(form);
      actionBar.hidden = true;
      setTimeout(() => depSel.focus(), 0);
      form.onKeyEnter = ok;
    }
    function closeForm() { form?.remove(); form = null; actionBar.hidden = false; s.focusScreen(); }

    return {
      el, id: b.id,
      unmount() {},
      onKey(e) {
        if (form) {
          if (e.key === 'Escape') { closeForm(); return true; }
          if (e.key === 'Enter' && e.target?.tagName !== 'SELECT') { form.onKeyEnter(); return true; }
          return isEditable(e.target);
        }
        if (isEditable(e.target)) return false;
        if (/^[1-5]$/.test(e.key)) { if (+e.key <= actionEls.length) actionList.set(+e.key - 1, false); sfx.click(); actions[+e.key - 1].run(); return true; }
        if (actionList.onKey(e)) { e.preventDefault(); return true; }
        if (e.key === 'ArrowDown') { root.scrollBy?.({ top: 80 }); return true; }
        if (e.key === 'ArrowUp') { root.scrollBy?.({ top: -80 }); return true; }
        return false;
      },
    };
  }

  function setListHints() { s.setHints([['↑↓', T('wählen', 'select')], ['⏎', T('Details', 'details')], ['/', T('suchen', 'search')], ['Tab', T('Filter', 'filters')], ['Esc', T('zurück', 'back')]]); }
  setListHints();
  await runSearch();
  if (params.book) await openDetail(params.book, { record: false });
  else if (!st.q) setTimeout(() => { if (!disposed && !detail) q.focus(); }, 0);

  return {
    unmount() { disposed = true; clearTimeout(debounce); detail?.unmount?.(); },
    /** a history step inside the catalogue: filters, sorting, search, detail view */
    navigate(p) {
      const before = st.mode + '|' + st.q.trim();
      applyParams(p);
      q.value = st.q; paintMode(); paintStatus(); deptSel.value = st.dept; fmtSel.value = st.fmt; sortSel.value = st.sort; paintHead();
      const again = before !== st.mode + '|' + st.q.trim() || lastSearch !== st.mode + '|' + st.q.trim();
      const show = () => {
        if (p.book) { if (!detail || detail.id !== p.book) openDetail(p.book, { record: false }); }
        else closeDetail({ record: false });
      };
      if (again) runSearch().then(show); else { renderRows(); show(); }
      return true;
    },
    onKey(e) {
      if (detail) {
        if (detail.onKey(e)) return true;
        if (e.key === 'Escape') { if (isEditable(e.target)) return false; sfx.click(); closeDetail(); return true; }
        return false;
      }
      const editing = isEditable(e.target);
      if (editing) {
        if (e.target === q && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && list?.rows.length) { e.preventDefault(); q.blur(); s.focusScreen(); list.set(e.key === 'ArrowDown' ? 0 : list.rows.length - 1); return true; }
        if (e.key === 'Escape') return false; // the panel blurs the field
        return true; // let the field handle typing
      }
      if (e.key === '/') { e.preventDefault(); q.focus(); q.select(); return true; }
      if (e.key === 'Tab') { e.preventDefault(); const seq = [deptSel, fmtSel, sortSel]; const i = seq.indexOf(document.activeElement); seq[(i + 1) % seq.length].focus(); return true; }
      if (list && list.onKey(e)) { e.preventDefault(); return true; }
      // type-to-search: focus the field but do NOT consume the key, otherwise main.js preventDefault()s
      // the keydown and the very first character never reaches the input.
      if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) { q.focus(); return false; }
      return false;
    },
  };
}
