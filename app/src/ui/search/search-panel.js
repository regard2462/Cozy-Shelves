// Panel "Volltextsuche" (full-text search over all books): a search field (all words on one page, "phrase", Wort*),
// filters for department and language, the state of the index with a progress bar, and the results grouped by book
// (cover, title, author, number of hits), every hit with its page and an excerpt with the words marked. A hit opens
// the reader there with the words marked (reader-hit.js). Query, filters, results and the scroll position are kept for
// the session: the panel opens again as it was left (it also lies under the reader opened from it).
// Backend: electron/search/fulltext.js through api.invoke('fulltext:…').
import { h, clear } from '../../core/dom.js';
import { tr } from '../../core/i18n.js';
import { coverThumb } from '../../core/cover-art.js';

const T = (de, en, vars) => tr({ de, en }, vars);
const BOOKS_PAGE = 30, HITS_SHOWN = 3, HITS_MORE = 20;
const DEBOUNCE = 260;
const GLASS = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>';

// what the panel showed last (the session's "back")
const memory = { q: '', dept: '', lang: '', result: null, extra: new Map(), scroll: 0 };

/** 182 MB, 4,6 MB, 310 KB */
export const fmtSize = (bytes) => {
  const mb = (bytes || 0) / 1048576;
  return mb >= 100 ? `${Math.round(mb)} MB` : mb >= 1 ? `${mb.toFixed(1).replace('.', T(',', '.'))} MB` : `${Math.max(0, Math.round((bytes || 0) / 1024))} KB`;
};

/** "312 von 850 Büchern durchsucht, 14 ohne Text" and why the index waits, if it does */
export function statusText(st) {
  if (!st) return '';
  if (!st.enabled) return T('Die Volltextsuche ist ausgeschaltet.', 'The full-text search is switched off.');
  if (!st.total) return T('Noch keine Bücher in der Bücherei.', 'No books in the library yet.');
  const parts = [T('{d} von {n} Büchern durchsucht', '{d} of {n} books searched', { d: st.done, n: st.total })];
  if (st.notext) parts[0] += T(', {k} ohne Text', ', {k} without text', { k: st.notext });
  if (st.errors) parts[0] += T(', {k} nicht lesbar', ', {k} unreadable', { k: st.errors });
  if (st.done < st.total) {
    const why = {
      reading: T('pausiert, solange du liest', 'paused while you read'),
      tts: T('pausiert, solange vorgelesen wird', 'paused while reading aloud'),
      film: T('pausiert, solange ein Film läuft', 'paused while a film is playing'),
      busy: T('pausiert, die Welt braucht die Rechenzeit', 'paused, the world needs the processor'),
      library: T('wartet, bis neue Bücher einsortiert sind', 'waiting until new books are shelved'),
    }[st.paused];
    if (why) parts.push(why);
    else if (!st.started) parts.push(T('beginnt gleich', 'starts shortly'));
    else if (st.running && st.current) parts.push(T('liest „{t}“', 'reading “{t}”', { t: st.current.title }));
  }
  return parts.join(' · ');
}

export async function mount(container, ctx, params = {}) {
  const { api, bus } = ctx;
  const books = () => ctx.state?.library?.books || [];
  const bookOf = (id) => books().find((b) => b.id === id) || null;
  if (params.q != null && params.q !== memory.q) { memory.q = String(params.q); memory.result = null; memory.extra.clear(); memory.scroll = 0; }
  const fromReader = params.from === 'reader' ? params.bookId || null : null;

  /* ---------- DOM ---------- */
  const input = h('input.input.fts-input', { type: 'search', value: memory.q, spellcheck: false, autocomplete: 'off' });
  const deptSel = h('select.input.fts-select');
  const langSel = h('select.input.fts-select');
  const fillLangs = () => {
    clear(langSel);
    for (const [v, de, en] of [['', 'Alle Sprachen', 'All languages'], ['de', 'Deutsch', 'German'], ['en', 'Englisch', 'English'], ['other', 'Andere', 'Other']]) langSel.append(h('option', { value: v }, T(de, en)));
    langSel.value = memory.lang;
  };
  const fillDepts = () => {
    clear(deptSel);
    deptSel.append(h('option', { value: '' }, T('Alle Abteilungen', 'All departments')));
    for (const d of ctx.state?.library?.departments || []) if (d.count > 0) deptSel.append(h('option', { value: d.name }, `${d.name} (${d.count})`));
    deptSel.value = memory.dept;
    if (deptSel.value !== memory.dept) { memory.dept = ''; deptSel.value = ''; }
  };
  const help = h('div.fts-help');
  const bar = h('i');
  const statusLine = h('div.fts-status-text');
  const statusEl = h('div.fts-status', h('div.progress-bar.fts-progress', bar), statusLine);
  const summary = h('div.fts-summary', { 'aria-live': 'polite' });
  const list = h('div.fts-results', { role: 'list' });
  const scroller = h('div.fts-scroll', summary, list);
  const heading = h('span.fts-heading');
  const closeBtn = h('button.btn.icon', { onclick: () => ctx.close() }, '✕');
  const panel = h('div.panel.fts-panel',
    h('div.panel-header', heading, h('span.spacer'), closeBtn),
    h('div.fts-top',
      h('div.fts-search-row', h('label.fts-field', h('span.fts-glass', { 'aria-hidden': 'true', html: GLASS }), input), deptSel, langSel),
      help, statusEl),
    scroller);
  container.appendChild(panel);
  /** the texts that do not come from a search: set again when the language changes */
  const relabel = () => {
    heading.textContent = T('Volltextsuche', 'Full-text search');
    closeBtn.title = T('Schließen', 'Close'); closeBtn.setAttribute('aria-label', closeBtn.title);
    input.placeholder = T('In allen Büchern suchen …', 'Search all books …');
    input.setAttribute('aria-label', T('Suchbegriffe', 'Search terms'));
    deptSel.setAttribute('aria-label', T('Abteilung', 'Department'));
    langSel.setAttribute('aria-label', T('Sprache', 'Language'));
    help.textContent = T('Alle Wörter müssen auf derselben Seite stehen. "In Anführungszeichen" sucht die genaue Wortfolge, Wort* findet Wortanfänge.', 'All words must stand on the same page. "In quotes" finds the exact phrase, word* finds word beginnings.');
    fillDepts(); fillLangs();
  };
  relabel();

  /* ---------- index state ---------- */
  let status = null;
  const paintStatus = (st) => {
    if (!st) return;
    status = st;
    statusLine.textContent = statusText(st);
    const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
    bar.style.width = pct + '%';
    statusEl.classList.toggle('complete', st.enabled && st.total > 0 && st.done >= st.total);
    statusEl.classList.toggle('off', !st.enabled);
  };
  const offStatus = api.on?.('fulltext:status', paintStatus);
  api.invoke('fulltext:status').then(paintStatus).catch(() => {});

  /* ---------- searching ---------- */
  let seq = 0, timer = null, disposed = false;
  function schedule(now = false) {
    clearTimeout(timer);
    timer = setTimeout(() => run(), now ? 0 : DEBOUNCE);
  }
  async function run({ offset = 0, keepScroll = false } = {}) {
    const q = input.value.trim();
    memory.q = input.value; memory.dept = deptSel.value; memory.lang = langSel.value;
    const mine = ++seq;
    if (!q) { memory.result = null; memory.extra.clear(); paint(); return; }
    panel.classList.add('busy');
    let r;
    try { r = await api.invoke('fulltext:search', { q, department: memory.dept || null, language: memory.lang || null, offset, limit: BOOKS_PAGE, hits: HITS_SHOWN }); }
    catch (e) { r = { ok: false, error: e.message, books: [] }; }
    if (mine !== seq || disposed) return;
    panel.classList.remove('busy');
    if (r?.status) paintStatus(r.status);
    if (offset > 0 && memory.result && r?.ok) {
      memory.result = { ...r, books: [...memory.result.books, ...r.books] };
    } else { memory.result = r; memory.extra.clear(); if (!keepScroll) scroller.scrollTop = 0; }
    paint();
  }

  /* ---------- results ---------- */
  const hitLabel = (b, x) => {
    if (b.kind === 'pdf' || x.page) return T('S. {p}', 'p. {p}', { p: x.page });
    if (x.pos) return T('Pos. {p}', 'loc. {p}', { p: x.pos });
    return '';
  };
  const excerpt = (snip) => {
    const el = h('span.fts-snippet');
    if (!snip) return el;
    const t = snip.text || '';
    let at = 0;
    if (snip.pre) el.append('… ');
    for (const [a, b] of snip.marks || []) { if (a > at) el.append(t.slice(at, a)); el.append(h('mark', t.slice(a, b))); at = b; }
    el.append(t.slice(at));
    if (snip.post) el.append(' …');
    return el;
  };
  /** an example query of the tips: a click searches for it */
  const example = (q) => h('button.fts-example', { type: 'button', title: T('Danach suchen', 'Search for it'), onclick: () => { input.value = q; schedule(true); input.focus(); } }, q);
  const hitButton = (b, x) => h('button.fts-hit', { type: 'button', dataset: { id: b.id, u: x.u }, title: T('Im Buch öffnen', 'Open in the book'), onclick: () => openHit(b, x) },
    h('span.fts-page', hitLabel(b, x)),
    h('span.fts-hit-body', x.chapter ? h('span.fts-chapter', x.chapter) : null, excerpt(x.snippet)));

  function paint() {
    clear(list); clear(summary);
    const r = memory.result;
    const q = input.value.trim();
    if (!q) {
      summary.append(h('div.fts-empty',
        h('div.fts-empty-title', T('Suche im Text aller Bücher', 'Search the text of all books')),
        h('ul.fts-tips',
          h('li', example(T('Garten Rosen', 'garden roses')), ' ', T('findet Seiten mit beiden Wörtern, auch „Gärten“ und „Rose“', 'finds pages with both words, also “gardens” and “rose”')),
          h('li', example(T('"der alte Mann"', '"the old man"')), ' ', T('findet genau diese Wortfolge', 'finds exactly this phrase')),
          h('li', example(T('Schach*', 'chess*')), ' ', T('findet Wörter, die so beginnen', 'finds words that begin like this')),
          h('li', T('Groß- und Kleinschreibung zählt nicht, Müller findet auch Mueller.', 'Case does not matter, Müller also finds Mueller.')))));
      return;
    }
    if (!r) return;
    if (r.off) { summary.append(offNotice()); return; }
    if (!r.ok) { summary.append(h('div.fts-note.bad', T('Die Suche ist gerade nicht möglich.', 'Searching is not possible right now.'), r.error ? h('span.fts-err', ' ' + r.error) : null)); return; }
    if (r.common) { summary.append(h('div.fts-note', T('Diese Wörter stehen in fast jedem Buch. Ein weiteres, selteneres Wort grenzt die Suche ein.', 'These words are in nearly every book. Another, rarer word narrows the search.'))); return; }
    if (!r.books.length) {
      const partial = status && status.done < status.total;
      summary.append(h('div.fts-note', T('Keine Treffer.', 'No results.'), partial ? ' ' + T('Noch sind nicht alle Bücher durchsucht.', 'Not all books have been searched yet.') : ''));
      return;
    }
    const took = r.ms >= 1000 ? `${(r.ms / 1000).toFixed(1).replace('.', T(',', '.'))} s` : `${Math.max(1, r.ms)} ms`;
    summary.append(h('div.fts-count',
      r.totalHits === 1 ? T('1 Treffer', '1 hit') : T('{n} Treffer', '{n} hits', { n: r.totalHits.toLocaleString(T('de-DE', 'en-GB')) }), ' ',
      r.totalBooks === 1 ? T('in 1 Buch', 'in 1 book') : T('in {n} Büchern', 'in {n} books', { n: r.totalBooks.toLocaleString(T('de-DE', 'en-GB')) }),
      h('span.fts-ms', ` · ${took}`),
      r.capped ? h('span.fts-ms', ' · ' + T('nicht alle Seiten geprüft', 'not all pages checked')) : null));
    for (const b of r.books) list.append(bookGroup(b));
    if (r.books.length < r.totalBooks) {
      list.append(h('button.btn.fts-more-books', { type: 'button', onclick: () => run({ offset: r.books.length, keepScroll: true }) },
        T('Weitere Bücher ({n})', 'More books ({n})', { n: r.totalBooks - r.books.length })));
    }
  }

  function bookGroup(b) {
    const book = bookOf(b.id) || { id: b.id, title: '?' };
    const extra = memory.extra.get(b.id) || [];
    const items = [...b.items, ...extra];
    const hits = h('div.fts-hits', items.map((x) => hitButton(b, x)));
    const group = h('section.fts-book', { role: 'listitem', dataset: { id: b.id } },
      h('button.fts-book-head', { type: 'button', title: T('Beim ersten Treffer öffnen', 'Open at the first hit'), onclick: () => items[0] && openHit(b, items[0]) },
        coverThumb(book, api, 'cover-thumb fts-cover'),
        h('span.fts-book-meta',
          h('span.fts-book-title', book.title || '?'),
          book.author ? h('span.fts-book-author', book.author) : null,
          h('span.fts-book-dept', [book.department, book.shelf].filter(Boolean).join(' › ') + (book.format ? ` · ${String(book.format).toUpperCase()}` : ''))),
        h('span.fts-book-hits', b.hits === 1 ? T('1 Treffer', '1 hit') : T('{n} Treffer', '{n} hits', { n: b.hits }))),
      hits);
    if (items.length < b.hits) {
      const more = h('button.linkish.fts-more', { type: 'button' }, T('Weitere Treffer zeigen ({n})', 'Show more hits ({n})', { n: b.hits - items.length }));
      more.onclick = async () => {
        more.disabled = true;
        let r = null;
        try { r = await api.invoke('fulltext:more', { q: memory.result?.q || input.value, id: b.id, offset: items.length, count: HITS_MORE }); } catch {}
        if (disposed || !r?.items?.length) { more.disabled = false; return; }
        memory.extra.set(b.id, [...(memory.extra.get(b.id) || []), ...r.items]);
        const fresh = bookGroup(b);
        group.replaceWith(fresh);
        fresh.querySelectorAll('.fts-hit')[items.length]?.focus();
      };
      group.append(more);
    }
    return group;
  }

  /* ---------- opening a hit ---------- */
  function openHit(b, x) {
    memory.scroll = scroller.scrollTop;
    // the reader opens on top: keys must reach it, not this panel's field below it
    document.activeElement?.blur?.();
    const hit = { q: memory.result?.q || input.value.trim(), u: x.u, kind: b.kind, loc: x.loc, page: x.page || null, pos: x.pos || null };
    ctx.audio?.sfx?.('click');
    // the panel came from the reader of this very book: the reader goes there itself
    if (fromReader && fromReader === b.id) { bus.emit('reader:goto-hit', { id: b.id, hit }); ctx.close(); return; }
    if (!ctx.state?.entered) bus.emit('world:enter');
    bus.emit('book:open-hit', { id: b.id, hit });
  }

  function offNotice() {
    return h('div.fts-note',
      T('Die Volltextsuche ist ausgeschaltet.', 'The full-text search is switched off.'), ' ',
      h('button.btn.small', { type: 'button', onclick: async () => { await api.settings.set({ fulltext: { enabled: true } }); schedule(true); } }, T('Einschalten', 'Switch on')));
  }

  /* ---------- keys ---------- */
  input.addEventListener('input', () => schedule());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); schedule(true); }
    else if (e.key === 'ArrowDown') { const first = list.querySelector('.fts-hit, .fts-book-head'); if (first) { e.preventDefault(); first.focus(); } }
  });
  deptSel.addEventListener('change', () => run());
  langSel.addEventListener('change', () => run());
  /** ↑ ↓ walk through the hits (and the buttons between them), ↑ on the first goes back to the field */
  function moveFocus(dir) {
    const all = [...list.querySelectorAll('.fts-book-head, .fts-hit, .fts-more, .fts-more-books')].filter((x) => !x.disabled);
    const i = all.indexOf(document.activeElement);
    if (i < 0) return false;
    const next = all[i + dir];
    if (next) next.focus(); else if (dir < 0) input.focus();
    return true;
  }

  // restore the last state: query, results, scroll position
  if (memory.result && memory.result.q === memory.q.trim()) { paint(); requestAnimationFrame(() => { scroller.scrollTop = memory.scroll; }); }
  else if (memory.q.trim()) run();
  else paint();
  const offLang = bus.on('i18n:change', () => { relabel(); paint(); paintStatus(status); });
  requestAnimationFrame(() => { if (!disposed && (!memory.scroll || !memory.result)) { input.focus(); input.select(); } });

  return {
    unmount() {
      disposed = true;
      memory.scroll = scroller.scrollTop;
      clearTimeout(timer);
      offStatus?.(); offLang();
    },
    onKey(e) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) { input.focus(); input.select(); return true; }
      if (e.target === input || e.target?.tagName === 'SELECT') return false;
      if (e.key === 'ArrowDown') return moveFocus(1);
      if (e.key === 'ArrowUp') return moveFocus(-1);
      // typing anywhere in the panel goes into the field
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') { input.focus(); return false; }
      return false;
    },
  };
}
