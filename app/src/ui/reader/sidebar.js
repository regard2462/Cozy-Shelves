// Reader sidebar: table of contents, bookmarks, notes/highlights, full-text search, chess positions.
import { h, clear, formatDate } from '../../core/dom.js';
import { colorHex } from './annotations.js';

const str = (x) => (x == null ? '' : typeof x === 'string' ? x : Array.isArray(x) ? x.map(str).join(', ') : typeof x === 'object' ? str(Object.values(x)[0]) : String(x));

export function createSidebar(R) {
  const { T } = R;
  const TABS = [
    ['toc', T('Inhalt', 'Contents')], ['bookmarks', T('Lesezeichen', 'Bookmarks')], ['notes', T('Notizen', 'Notes')], ['search', T('Suche', 'Search')], ['positions', T('Stellungen', 'Positions')],
  ];
  const el = h('div.rd-sidebar');
  const tabs = h('div.rd-sb-tabs');
  const body = h('div.rd-sb-body');
  const head = h('div.rd-sb-head', h('span.rd-sb-title', T('Buch', 'Book')), h('span.spacer'), h('button.rd-btn.small', { onclick: () => close() }, '✕'));
  el.append(head, tabs, body);
  let active = 'toc';
  let currentHref = null;
  const tocMap = new Map();
  let searchState = { query: '', results: [], running: false, done: false };

  for (const [key, label] of TABS) tabs.append(h('button.rd-sb-tab', { dataset: { tab: key }, onclick: () => show(key) }, label));

  const isOpen = () => el.classList.contains('open');
  function open(tab) { if (tab) active = tab; el.classList.add('open'); R.annotations.hideAll(); R.toggleSettings?.(false); render(); R.showChrome?.(); if (active === 'search') setTimeout(() => el.querySelector('.rd-sb-search input')?.focus(), 60); }
  function close() {
    // the search box keeps DOM focus otherwise; app/src/main.js then swallows every reader
    // shortcut because the key event's target is an <input> (finding 3)
    if (el.contains(document.activeElement)) document.activeElement.blur?.();
    el.classList.remove('open');
    R.els?.root?.focus?.();
  }
  function toggle() { isOpen() ? close() : open(); }
  function show(tab) { active = tab; render(); if (tab === 'search') setTimeout(() => el.querySelector('.rd-sb-search input')?.focus(), 30); }
  function refresh(tab) { if (!tab || tab === active) render(); }

  function render() {
    for (const b of tabs.children) b.classList.toggle('active', b.dataset.tab === active);
    clear(body);
    const fn = { toc: renderToc, bookmarks: renderBookmarks, notes: renderNotes, search: renderSearch, positions: renderPositions }[active];
    fn?.();
  }
  const empty = (msg) => h('div.rd-sb-empty', msg);
  const go = (target) => { R.goTo(target); if (window.innerWidth < 1100) close(); };
  /** online texts (catalogue "read now", pages opened from a link) have no library record */
  const sessionOnly = () => (R.canPersist ? !R.canPersist() : false);
  const sessionHint = () => (sessionOnly()
    ? h('div.rd-sb-hint', T('Dieser Text stammt aus dem Netz. Lesezeichen und Notizen gelten nur für diese Sitzung.', 'This text comes from the web – bookmarks and notes last for this session only.'))
    : null);

  /* ---------- table of contents ---------- */
  function renderToc() {
    tocMap.clear();
    const toc = R.view?.book?.toc || [];
    if (!toc.length) {
      // the pages of a PDF (in the text view as well: its sections are runs of pages)
      const n = R.tvs?.active ? R.tvs.view?.numPages || 0 : R.view?.book?.sections?.length || 0;
      const cur = R.loc?.pdf ? R.loc.pdf.page : (R.loc?.section?.current ?? -1);
      if ((R.isFixed || R.tvs?.active) && n) {
        body.append(h('div.rd-sb-count', T('Kein Inhaltsverzeichnis. Seiten:', 'No table of contents – pages:')));
        body.append(h('div.rd-sb-pages', Array.from({ length: n }, (_, i) => h('button.rd-sb-pagebtn', { class: cur === i ? 'current' : '', onclick: () => go(i) }, String(i + 1)))));
        return;
      }
      body.append(empty(T('Kein Inhaltsverzeichnis.', 'No table of contents.'))); return;
    }
    const tree = h('ul.rd-toc');
    const make = (items, depth) => items.map((item) => {
      const hasSub = item.subitems?.length > 0;
      const li = h('li.rd-toc-item', { class: hasSub ? 'has-sub' : '' });
      const row = h('div.rd-toc-row', { style: { paddingLeft: 10 + depth * 16 + 'px' } },
        hasSub ? h('button.rd-toc-exp', { onclick: (e) => { e.stopPropagation(); li.classList.toggle('expanded'); } }, '▸') : h('span.rd-toc-exp.rd-toc-dot'),
        h('span.rd-toc-label', str(item.label) || '…'));
      if (item.href) { row.dataset.href = item.href; tocMap.set(item.href, li); row.addEventListener('click', () => go(item.href)); }
      li.append(row);
      if (hasSub) li.append(h('ul', make(item.subitems, depth + 1)));
      if (depth < 1) li.classList.add('expanded');
      return li;
    });
    tree.append(...make(toc, 0));
    body.append(tree);
    setCurrentHref(currentHref);
  }
  function setCurrentHref(href) {
    currentHref = href;
    if (active !== 'toc' || !isOpen()) return;
    for (const li of tocMap.values()) li.classList.remove('current');
    const li = href != null ? tocMap.get(href) : null;
    if (li) {
      li.classList.add('current');
      for (let p = li.parentElement; p && p !== body; p = p.parentElement) if (p.classList.contains('rd-toc-item')) p.classList.add('expanded');
      li.querySelector('.rd-toc-row')?.scrollIntoView({ block: 'nearest' });
    }
  }

  /* ---------- bookmarks ---------- */
  function renderBookmarks() {
    const list = (R.record?.bookmarks || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    body.append(h('div.rd-sb-actions', h('button.btn.small', { onclick: () => R.toggleBookmark() }, R.currentPageBookmark?.() ? T('Lesezeichen entfernen', 'Remove bookmark') : T('Lesezeichen hier setzen', 'Bookmark this page'))));
    const hint = sessionHint(); if (hint) body.append(hint);
    if (!list.length) { body.append(empty(T('Noch keine Lesezeichen. Taste B setzt eines.', 'No bookmarks yet. Press B to add one.'))); return; }
    body.append(h('div.list', list.map((bm) => h('div.list-item.rd-sb-item', { onclick: () => go(bm.location) },
      h('span.rd-sb-ribbon'),
      h('div.rd-sb-item-main', h('div.rd-sb-item-title', bm.label || T('Lesezeichen', 'Bookmark')), bm.excerpt ? h('div.rd-sb-item-excerpt', bm.excerpt) : null, h('div.rd-sb-item-meta', formatDate(bm.createdAt, R.uiLang))),
      h('button.rd-btn.small.rd-sb-del', { title: T('Löschen', 'Delete'), onclick: (e) => { e.stopPropagation(); R.removeBookmark(bm); } }, '🗑')))));
  }

  /* ---------- notes / highlights ---------- */
  function renderNotes() {
    const list = R.annotations.list().slice();
    try { list.sort((a, b) => R.CFI.compare(a.value, b.value)); } catch {}
    const hint = sessionHint(); if (hint) body.append(hint);
    if (!list.length) { body.append(empty(T('Markiere Text im Buch, um Notizen und Markierungen anzulegen.', 'Select text in the book to create highlights and notes.'))); return; }
    body.append(h('div.rd-sb-count', T('{n} Markierungen', '{n} highlights', { n: list.length })));
    body.append(h('div.list', list.map((a) => h('div.list-item.rd-sb-item.rd-sb-note', { onclick: () => { R.annotations.showAnnotation(a); if (window.innerWidth < 1100) close(); } },
      h('span.rd-sb-color', { style: { background: a.color === 'none' ? 'transparent' : colorHex(a.color) } }),
      h('div.rd-sb-item-main', h('div.rd-sb-item-excerpt.rd-sb-quote', a.text), a.note ? h('div.rd-sb-item-note', a.note) : null, h('div.rd-sb-item-meta', [a.label, formatDate(a.createdAt, R.uiLang)].filter(Boolean).join(' · '))),
      h('button.rd-btn.small.rd-sb-del', { title: T('Löschen', 'Delete'), onclick: (e) => { e.stopPropagation(); R.annotations.removeAnnotation(a); } }, '🗑')))));
  }

  /* ---------- search ---------- */
  function renderSearch() {
    const input = h('input.input', { type: 'search', placeholder: T('Im Buch suchen …', 'Search in book …'), value: searchState.query });
    const resultsEl = h('div.rd-sb-results');
    const status = h('div.rd-sb-status');
    const run = () => runSearch(input.value.trim(), resultsEl, status);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    body.append(h('div.rd-sb-search', input, h('button.btn.small', { onclick: run }, T('Suchen', 'Search')), h('button.btn.small.ghost', { title: T('Löschen', 'Clear'), onclick: () => { input.value = ''; clearSearch(); clear(resultsEl); status.textContent = ''; } }, '✕')), status, resultsEl);
    if (searchState.results.length) paintResults(resultsEl, status);
    // the same words in all books: the full-text search (Strg+F)
    if (R.hit) body.querySelector('.rd-sb-search')?.after(h('button.linkish.rd-sb-fts', { type: 'button', onclick: () => R.hit.openPanel(input.value.trim()) }, T('In allen Büchern suchen', 'Search all books')));
  }
  function clearSearch() { searchState = { query: '', results: [], running: false, done: false }; try { R.view?.clearSearch(); } catch {} }
  function paintResults(resultsEl, status) {
    clear(resultsEl);
    let n = 0;
    for (const group of searchState.results) {
      resultsEl.append(h('div.rd-sb-group', group.label || ''));
      for (const r of group.subitems) {
        n++;
        const ex = r.excerpt || {};
        resultsEl.append(h('div.list-item.rd-sb-item.rd-sb-result', { onclick: () => go(r.cfi) }, h('div.rd-sb-item-excerpt', ex.pre, h('mark', ex.match), ex.post)));
      }
    }
    status.textContent = searchState.running ? T('Suche … ({n})', 'Searching … ({n})', { n }) : n ? T('{n} Treffer', '{n} results', { n }) : searchState.done ? T('Keine Treffer.', 'No results.') : '';
  }

  /* ---------- full-text search in fixed-layout books (PDF) ----------
   * foliate's View#searchBook skips every section without createDocument, and pdf.js sections have
   * none – so the built-in search always returned nothing for PDFs (finding 11). We read the page
   * text through pdf.js (already loaded and configured by vendor/foliate-js/pdf.js) ourselves. */
  let pdfPages = null;
  async function pdfPageTexts(onProgress) {
    if (pdfPages) return pdfPages;
    const lib = globalThis.pdfjsLib;
    if (!lib?.getDocument || !R.bookUrl) return null;
    const base = R.VENDOR + 'vendor/pdfjs/';
    const task = lib.getDocument({ url: R.bookUrl, cMapUrl: base + 'cmaps/', cMapPacked: true, standardFontDataUrl: base + 'standard_fonts/', isEvalSupported: false });
    const pdf = await task.promise;
    const pages = [];
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        pages.push((tc.items || []).map((it) => (it.str || '') + (it.hasEOL ? '\n' : '')).join('').replace(/[ \t]+/g, ' '));
        page.cleanup();
        if (onProgress && (i % 5 === 0 || i === pdf.numPages)) { onProgress(i / pdf.numPages); await new Promise((r) => setTimeout(r, 0)); }
        if (onProgress && onProgress.cancelled) return null;
      }
    } finally { try { await pdf.destroy(); } catch {} }
    pdfPages = pages;
    return pages;
  }
  const fold = (s) => s.toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '');
  async function runPdfSearch(query, resultsEl, status, mine) {
    const onProgress = (p) => { if (searchState === mine) status.textContent = T('Text wird gelesen … {p} %', 'Reading text … {p} %', { p: Math.round(p * 100) }); };
    Object.defineProperty(onProgress, 'cancelled', { get: () => searchState !== mine });
    let pages;
    try { pages = await pdfPageTexts(onProgress); }
    catch (e) { console.warn('[reader] pdf text failed', e); pages = null; }
    if (searchState !== mine) return;
    if (!pages) {
      mine.running = false; mine.done = true;
      status.textContent = T('Die Textebene dieses PDFs konnte nicht gelesen werden (gescanntes Dokument?).', 'The text layer of this PDF could not be read (a scanned document?).');
      return;
    }
    const needle = fold(query);
    let total = 0;
    pages.forEach((text, index) => {
      if (!text) return;
      const hay = fold(text);
      const subitems = [];
      let at = 0;
      while (subitems.length < 40 && total < 800) {
        const hit = hay.indexOf(needle, at);
        if (hit < 0) break;
        at = hit + Math.max(1, needle.length);
        total++;
        subitems.push({ cfi: index, excerpt: { pre: text.slice(Math.max(0, hit - 45), hit), match: text.slice(hit, hit + query.length), post: text.slice(hit + query.length, hit + query.length + 60) } });
      }
      if (subitems.length) mine.results.push({ label: T('Seite {p}', 'Page {p}', { p: index + 1 }), subitems });
    });
    mine.running = false; mine.done = true;
    paintResults(resultsEl, status);
  }

  async function runSearch(query, resultsEl, status) {
    clearSearch();
    if (!query || !R.view) { clear(resultsEl); status.textContent = ''; return; }
    searchState = { query, results: [], running: true, done: false };
    const mine = searchState;
    paintResults(resultsEl, status);
    // PDFs are searched page by page through pdf.js, also in the text view (the hits lead to their page)
    if (R.isFixed || R.tvs?.active) { await runPdfSearch(query, resultsEl, status, mine); return; }
    try {
      for await (const r of R.view.search({ query, matchCase: false, matchDiacritics: false, matchWholeWords: false, draw: R.Overlayer.outline, drawOptions: { color: '#d9743f', width: 2, radius: 4 } })) {
        if (searchState !== mine) return;
        if (r === 'done') { mine.done = true; mine.running = false; }
        else if (r.subitems) mine.results.push(r);
        else if (r.progress != null) { status.textContent = T('Suche … {p} %', 'Searching … {p} %', { p: Math.round(r.progress * 100) }); continue; }
        paintResults(resultsEl, status);
      }
    } catch (e) { console.warn('[reader] search failed', e); mine.running = false; status.textContent = T('Suche fehlgeschlagen.', 'Search failed.'); }
    mine.running = false; mine.done = true; paintResults(resultsEl, status);
  }

  /* ---------- chess positions ---------- */
  function renderPositions() {
    const list = (R.record?.positions || []).slice();
    body.append(h('div.rd-sb-actions', h('button.btn.small', { onclick: () => R.toggleChess() }, '♞ ' + T('Schachbrett', 'Chess board'))));
    if (!list.length) { body.append(empty(T('Keine gespeicherten Stellungen. Stellungen werden am Schachbrett zu diesem Buch gespeichert.', 'No saved positions. Positions are saved at the chess board for this book.'))); return; }
    body.append(h('div.list', list.map((p) => h('div.list-item.rd-sb-item', { onclick: () => { if (p.location) go(p.location); if (R.chess?.setFen) { try { R.chess.setFen(p.fen); } catch {} } else if (!R.chess) { R.toggleChess(true).then(() => { try { R.chess?.setFen?.(p.fen); } catch {} }); } } },
      h('span.rd-sb-piece', '♞'),
      h('div.rd-sb-item-main', h('div.rd-sb-item-title', p.label || T('Stellung', 'Position')), h('div.rd-sb-item-meta.mono', (p.fen || '').split(' ')[0]), h('div.rd-sb-item-meta', formatDate(p.createdAt, R.uiLang)))))));
  }

  return { el, open, close, toggle, isOpen, refresh, setCurrentHref, show };
}
