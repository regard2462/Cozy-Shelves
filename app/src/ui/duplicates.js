// "Doppelte Bücher": the books that exist more than once (in several folders or formats), group by group, every copy with
// its format, size and folder, a button that shows the file in the Explorer and one for its book info. The library
// finds the groups (electron/library/duplicates.js: the same file, the same ISBN, or the same title and author); with
// "Doppelte Bücher nur einmal ins Regal stellen" the shelves show one copy of each (the one being read, else EPUB before
// PDF). Nothing is ever deleted. Opened from Einstellungen → Bücherordner and from the computer (System).
import { h, clear } from '../core/dom.js';
import { tr } from '../core/i18n.js';
import { coverThumb } from '../core/cover-art.js';
import { copiesOf, copyRow, reasonLabel } from './shelf-info.js';
import { shelfOptions } from '../world/shelf-arrange.js';

/** The groups of copies in the library state: [{ id, books, reasons }], the largest and then by title. */
export function duplicateGroups(books) {
  const byGroup = new Map();
  for (const b of books || []) if (b.dupGroup) { const g = byGroup.get(b.dupGroup); if (g) g.push(b); else byGroup.set(b.dupGroup, [b]); }
  const collator = new Intl.Collator('de', { numeric: true });
  return [...byGroup.entries()].filter(([, list]) => list.length > 1)
    .map(([id, list]) => ({ id, books: list, reasons: list[0].dupReasons || [] }))
    .sort((a, b) => collator.compare(a.books[0].title || '', b.books[0].title || ''));
}

export async function mount(container, ctx) {
  const panel = h('div.panel.paper.dup-panel', { role: 'dialog', 'aria-label': tr({ de: 'Doppelte Bücher', en: 'Duplicate books' }) });
  container.appendChild(panel);
  const body = h('div.panel-body.dup-body');
  let timer = null;

  const render = () => {
    const keepScroll = body.scrollTop;
    clear(panel); clear(body);
    panel.setAttribute('aria-label', tr({ de: 'Doppelte Bücher', en: 'Duplicate books' }));
    const groups = duplicateGroups(ctx.state?.library?.books);
    const dedupe = shelfOptions(ctx.state?.settings?.shelves).dedupe;
    const copies = groups.reduce((a, g) => a + g.books.length, 0);
    body.appendChild(h('p.dup-intro', groups.length
      ? tr({ de: '{g} Bücher liegen mehrfach vor, zusammen {n} Dateien.', en: '{g} books exist more than once, {n} files in all.' }, { g: groups.length, n: copies })
      : tr({ de: 'Keine doppelten Bücher gefunden.', en: 'No duplicate books found.' })));
    body.appendChild(h('p.dup-note.small.muted', dedupe
      ? tr({ de: 'Von jedem Buch steht eine Ausgabe im Regal. Das ist die Ausgabe, in der du liest, sonst EPUB vor PDF. Die anderen Dateien bleiben, wo sie sind, und lassen sich hier und in der Buchinfo öffnen. Gelöscht wird nichts.', en: 'One copy of each book stands on the shelf. It is the copy you are reading, else EPUB before PDF. The other files stay where they are and can be opened here and from the book info. Nothing is deleted.' })
      : tr({ de: 'Alle Ausgaben stehen im Regal. Unter Einstellungen → Bücherordner lässt sich jedes Buch nur einmal ins Regal stellen. Gelöscht wird nichts.', en: 'Every copy stands on the shelves. In Settings → Book folders each book can be put on the shelves only once. Nothing is deleted.' })));
    for (const g of groups) {
      const { shown } = copiesOf(g.books[0], g.books);
      const first = shown || g.books[0];
      // the copy on the shelf first, then by format and folder
      g.books.sort((a, b) => (b === first) - (a === first) || String(a.format).localeCompare(String(b.format)) || String(a.relPath || '').localeCompare(String(b.relPath || '')));
      body.appendChild(h('section.dup-group', { dataset: { group: g.id } },
        h('div.dup-group-head',
          coverThumb(first, ctx.api, 'dup-cover'),
          h('div.dup-group-title',
            h('div.dup-title', first.title || '?'),
            first.author ? h('div.dup-author', first.author) : null,
            h('div.dup-reasons', g.reasons.map((r) => h('span.dup-chip.muted', reasonLabel(r)))))),
        h('div.dup-copies', g.books.map((b) => copyRow(b, ctx, { shown: dedupe && shown?.id === b.id, onInfo: (x) => ctx.openPanel?.('bookinfo', { id: x.id }) })))));
    }
    panel.append(
      h('div.panel-header', tr({ de: 'Doppelte Bücher', en: 'Duplicate books' }), h('span.spacer'),
        h('button.btn.icon', { type: 'button', title: tr({ de: 'Schließen', en: 'Close' }), 'aria-label': tr({ de: 'Schließen', en: 'Close' }), onclick: ctx.close }, '✕')),
      body);
    body.scrollTop = keepScroll;
  };
  render();
  // the list follows the library (a new copy, a book read, the setting switched)
  const later = () => { clearTimeout(timer); timer = setTimeout(render, 400); };
  const offUpdate = ctx.api.library.onUpdate?.(later);
  const offBook = ctx.api.library.onBook?.(later);
  const offSettings = ctx.api.settings.onChange?.(later);
  const offLang = ctx.bus.on('i18n:change', render);
  return {
    unmount() { clearTimeout(timer); offUpdate?.(); offBook?.(); offSettings?.(); offLang?.(); },
    onKey(e) {
      if (e.target?.tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return false;
      if (e.key === 'ArrowDown' || e.key === 'PageDown') { body.scrollBy({ top: e.key === 'PageDown' ? 400 : 80 }); return true; }
      if (e.key === 'ArrowUp' || e.key === 'PageUp') { body.scrollBy({ top: e.key === 'PageUp' ? -400 : -80 }); return true; }
      return false;
    },
  };
}
