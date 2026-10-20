// Book info card: shown by the 3D world when the player looks at a book. mount(container, ctx, { id })
import { h, clear, formatDate, formatDuration } from '../core/dom.js';
import { tr } from '../core/i18n.js';
import { coverSrc } from '../core/cover-art.js';
import { isGeneratedCover } from '../world/book-art.js';
import { readButton, readLine, copiesBlock } from './shelf-info.js';
import { markRead } from './shelves.js';
import { createCoverPicker } from './cover-picker.js';
import { has } from '../core/platform.js';

const FORMAT_LABEL = { pdf: 'PDF', epub: 'EPUB', mobi: 'MOBI', azw3: 'AZW3', fb2: 'FB2', cbz: 'CBZ', txt: 'TXT', md: 'Markdown', html: 'HTML', docx: 'Word', rtf: 'RTF' };
const LANG_LABEL = { de: { de: 'Deutsch', en: 'German' }, en: { de: 'Englisch', en: 'English' }, fr: { de: 'Französisch', en: 'French' }, es: { de: 'Spanisch', en: 'Spanish' }, it: { de: 'Italienisch', en: 'Italian' } };

export async function mount(container, ctx, params = {}) {
  const { api, bus } = ctx;
  const T = (de, en, vars) => tr({ de, en }, vars);
  const lang = () => ctx.i18n?.lang || 'de';
  const id = params.id;
  let book = null;
  try { book = await api.library.book(id); } catch (e) { console.warn(e); }
  if (!book) book = ctx.state?.library?.books?.find((b) => b.id === id) || null;

  const panel = h('div.panel.paper.rd-bi');
  container.appendChild(panel);
  if (!book) {
    panel.append(h('div.panel-header', T('Buch', 'Book'), h('span.spacer'), h('button.btn.small', { onclick: ctx.close }, '✕')), h('div.panel-body', T('Buch nicht gefunden.', 'Book not found.')));
    return {};
  }

  const departments = () => ctx.state?.library?.departments || [];
  let deptOpen = false;
  // the cover: where it comes from and "Anderes Cover" (cover-picker.js); the browser version has no cover search
  const webCovers = has('webCovers');
  const picker = webCovers ? createCoverPicker({ ctx, getBook: () => book, render: () => render() }) : { tools: () => null, panel: () => null, onKey: () => false, open: false };
  // a book without a cover of its own is the next one the search in the background looks at
  if (webCovers && isGeneratedCover(book) && ctx.state?.settings?.webCovers !== false) api.invoke?.('covers:prioritize', book.id)?.catch?.(() => {});

  function render() {
    clear(panel);
    const coverUrl = coverSrc(book, api);
    const cover = coverUrl ? h('img', { src: coverUrl, alt: '', onerror: (e) => e.target.replaceWith(coverFallback()) }) : coverFallback();
    const facts = [];
    if (book.pageCount) facts.push(T('{n} Seiten', '{n} pages', { n: book.pageCount }));
    facts.push(FORMAT_LABEL[book.format] || (book.format || '').toUpperCase());
    if (book.language) facts.push(LANG_LABEL[book.language.slice(0, 2)]?.[lang()] || book.language);
    if (book.year) facts.push(String(book.year));
    // publisher and series, also those the book catalogues filled in (web-covers.js)
    if (book.publisher) facts.push(String(book.publisher).slice(0, 48));
    if (book.series) facts.push(book.seriesIndex ? T('{s}, Band {n}', '{s}, volume {n}', { s: book.series, n: book.seriesIndex }) : book.series);
    if (book.readingSeconds) facts.push(T('gelesen: {t}', 'read: {t}', { t: formatDuration(book.readingSeconds) }));
    const progress = Math.round((book.progress || 0) * 100);
    const desc = h('div.rd-bi-desc', book.description || '');
    const main = h('div.rd-bi-main',
      h('div.rd-bi-title', book.title || T('Ohne Titel', 'Untitled')),
      book.author ? h('div.rd-bi-author', book.author) : null,
      h('div.rd-bi-place', '📚 ', [book.department, book.shelf].filter(Boolean).join(' › ') || T('Nicht einsortiert', 'Not shelved'), book.borrowed ? h('span.muted', ' · ' + T('im Korb', 'in the basket')) : null),
      h('div.rd-bi-facts', facts.map((f) => h('span.rd-bi-fact', f))),
      book.description ? [desc, moreToggle(desc)] : null,
      h('div.rd-bi-progress', h('div.progress-bar', h('i', { style: { width: progress + '%' } })), h('span', progress + ' %')),
      book.lastRead ? h('div.rd-bi-last', T('Zuletzt gelesen: {d}', 'Last read: {d}', { d: formatDate(book.lastRead, lang()) }), book.timesOpened ? ' · ' + T('{n}× geöffnet', 'opened {n}×', { n: book.timesOpened }) : null) : h('div.rd-bi-last', T('Noch nicht gelesen', 'Not read yet')),
      book.finished ? h('div.rd-bi-done', '✓ ' + readLine(book, lang())) : null,
      h('div.rd-bi-actions',
        h('button.btn.primary', { onclick: () => { bus.emit('book:open', { id: book.id }); ctx.close(); } }, '📖 ' + (progress > 0 && progress < 100 ? T('Weiterlesen', 'Continue reading') : T('Lesen', 'Read'))),
        book.borrowed
          ? h('button.btn', { onclick: () => { bus.emit('book:return', { id: book.id }); book.borrowed = false; ctx.toast?.(T('Zurück ins Regal gestellt', 'Returned to the shelf')); render(); } }, '↩ ' + T('Zurück ins Regal', 'Return to shelf'))
          : h('button.btn', { onclick: () => { bus.emit('book:borrow', { id: book.id }); book.borrowed = true; ctx.toast?.(T('In den Korb gelegt', 'Added to the basket')); render(); } }, '🧺 ' + T('In den Korb', 'Add to basket')),
        h('button.btn.ghost', { onclick: () => { deptOpen = !deptOpen; render(); } }, '🏷 ' + T('Abteilung ändern', 'Change department')),
        // read or not: the case "Gelesen" (ui/shelves.js)
        readButton(book, async (read) => { const updated = await markRead(book, read); if (updated) Object.assign(book, updated); render(); })),
      deptOpen ? renderDept() : null,
      // the other copies of the same book (another folder, another format): shown in the Explorer, never deleted
      copiesBlock(book, ctx, { onInfo: (b) => ctx.openPanel?.('bookinfo', { id: b.id }) }),
    );
    panel.append(
      h('div.panel-header', T('Buch', 'Book'), h('span.spacer'), h('button.btn.small.icon', { onclick: ctx.close, title: T('Schließen', 'Close'), 'aria-label': T('Schließen', 'Close') }, '✕')),
      h('div.panel-body', h('div.rd-bi-cover', cover, picker.tools()), main),
      picker.panel(),
    );
  }

  /** “mehr / weniger” for a long description – a real button so the keyboard reaches it */
  function moreToggle(desc) {
    const b = h('button.rd-bi-more.linkish', { type: 'button', 'aria-expanded': 'false' }, T('mehr', 'more'));
    b.onclick = () => {
      const open = desc.classList.toggle('expanded');
      b.textContent = open ? T('weniger', 'less') : T('mehr', 'more');
      b.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    return b;
  }
  function coverFallback() { const c = book.coverColor || '#3d6f6b'; return h('div.rd-bi-cover-fallback', { style: { background: `linear-gradient(160deg, ${c}, color-mix(in oklab, ${c} 62%, #000))` } }, h('div', book.title), h('div.small', { style: { opacity: .85, marginTop: '8px' } }, book.author || '')); }
  /**
   * Move the book by hand: the departments by their id (a folder department and one of the fixed set may carry the
   * same name), the shelf by name. The department's own name as shelf means "no shelf of its own" (the books that lie
   * directly in its folder). The choice stays, also when the scanner passes the file's folder again.
   */
  function renderDept() {
    const deps = departments();
    const key = (d) => d.id || d.name;
    const current = book.departmentId || book.department;
    const depSel = h('select.input', deps.map((d) => h('option', { value: key(d), selected: key(d) === current || (!book.departmentId && d.name === book.department) }, d.name)));
    if (!deps.some((d) => key(d) === current || d.name === book.department) && book.department) depSel.prepend(h('option', { value: current, selected: true }, book.department));
    const shelfSel = h('select.input');
    const depOf = () => deps.find((x) => key(x) === depSel.value);
    const fillShelves = () => {
      clear(shelfSel);
      const d = depOf();
      const shelves = d?.shelves?.map((s) => s.name) || [];
      if (!shelves.length) shelves.push(book.shelf || d?.name || book.department || '');
      const mine = book.shelf || book.department;
      for (const s of shelves) shelfSel.append(h('option', { value: s, selected: s === mine }, s));
    };
    fillShelves();
    depSel.addEventListener('change', fillShelves);
    return h('div.rd-bi-dept', depSel, shelfSel,
      h('button.btn.small.primary', { onclick: async () => {
        const depName = depOf()?.name || depSel.selectedOptions[0]?.textContent || depSel.value;
        try { const updated = await api.library.setDepartment(book.id, depSel.value, shelfSel.value); Object.assign(book, updated || { department: depName, shelf: shelfSel.value, departmentSource: 'manual' }); ctx.toast?.(T('Einsortiert in {d} › {s}', 'Shelved in {d} › {s}', { d: depName, s: shelfSel.value })); }
        catch (e) { ctx.toast?.(T('Fehler beim Umsortieren', 'Could not move the book')); }
        deptOpen = false; render();
      } }, T('Übernehmen', 'Apply')),
      h('button.btn.small.ghost', { onclick: () => { deptOpen = false; render(); } }, T('Abbrechen', 'Cancel')));
  }
  render();
  const offBook = api.library.onBook?.((b) => { if (b && b.id === book.id) { Object.assign(book, b); render(); } });
  // Deutsch/English while the card is open
  const offLang = bus.on?.('i18n:change', () => render());
  return {
    unmount() { offBook?.(); offLang?.(); },
    onKey(e) {
      if (picker.onKey(e)) return true;
      if (e.key === 'Enter' && !deptOpen && !picker.open) { bus.emit('book:open', { id: book.id }); ctx.close(); return true; }
      return false;
    },
  };
}
