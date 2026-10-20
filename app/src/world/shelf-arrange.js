// What the bookcases show, before layout.js puts it on the walls: finished books leave their department for the case
// "Gelesen" (newest first), a book that exists twice stands once (the copy being read, else EPUB before PDF), and the
// books inside every shelf follow the chosen order (title, author, year, publisher, series, added, read). The departments
// and their shelves stay where they are. The rules are the library's own (electron/library/reading-log.js,
// duplicates.js, shelf-order.js: pure modules, bundled here as well).
import { isFinished, readingGoal } from '../../../electron/library/reading-log.js';
import { preferredCopy } from '../../../electron/library/duplicates.js';
import { sortIds, SORT_MODES } from '../../../electron/library/shelf-order.js';

/** settings.shelves as the world uses it (electron/settings.js DEFAULTS: a missing key means the default). */
export function shelfOptions(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    finishedShelf: s.finishedShelf !== false,
    dedupe: s.dedupe !== false,
    sort: SORT_MODES.includes(s.sort) ? s.sort : 'title',
    readingGoal: readingGoal(s.readingGoal),
  };
}
export { SORT_MODES };

const byTitle = new Intl.Collator('de', { numeric: true });

/**
 * @param departments  library.departments (every shelf's bookIds in title order)
 * @param booksById    the books the room may show (id → record)
 * @param raw          settings.shelves
 * @param fit          (ids, newest first) → how many of them fit on the "Gelesen" case; the rest stay in their departments
 * @returns {
 *   departments: the same departments, every shelf with `bookIds` (what it shows, in the chosen order) and `canonical`
 *                (the same books in title order: layout.js counts the rows with it, so another order keeps the cases),
 *   finished:    the ids on the "Gelesen" case, newest first,
 *   hidden:      Set of the copies that are not shown (another copy of the same book stands),
 *   shownAs:     Map hidden id → the id of the copy that stands,
 *   noPicks:     Set of the books the display table should not recommend (read ones and hidden copies),
 *   key:         a string that changes whenever any of this changes (shelves.js compares it with the world's) }
 */
export function arrangeShelves(departments, booksById, raw, fit = (ids) => ids.length) {
  const o = shelfOptions(raw);
  // only the books of the departments: a record that arrived on its own (a new file, before the library state that
  // shelves it) may neither stand nor push another copy off the shelf
  const ids = new Set();
  for (const d of departments || []) for (const s of d.shelves || []) for (const id of s.bookIds || []) ids.add(id);
  const books = [...ids].map((id) => booksById?.[id]).filter(Boolean);
  // a book that exists twice: one copy stands
  const hidden = new Set(), shownAs = new Map();
  if (o.dedupe) {
    const groups = new Map();
    for (const b of books) if (b.dupGroup) { const g = groups.get(b.dupGroup); if (g) g.push(b); else groups.set(b.dupGroup, [b]); }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const keep = preferredCopy(list);
      for (const b of list) if (b !== keep) { hidden.add(b.id); shownAs.set(b.id, keep.id); }
    }
  }
  // the books read: newest first on the "Gelesen" case, as many as it holds
  const read = books.filter((b) => !hidden.has(b.id) && isFinished(b));
  const noPicks = new Set([...hidden, ...read.map((b) => b.id)]);
  let finished = [];
  if (o.finishedShelf) {
    read.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0) || byTitle.compare(a.title || '', b.title || '') || (a.id < b.id ? -1 : 1));
    const ids = read.map((b) => b.id);
    finished = ids.slice(0, Math.max(0, fit(ids)));
  }
  const away = new Set([...hidden, ...finished]);
  const deps = (departments || []).map((d) => ({
    ...d,
    shelves: (d.shelves || []).map((s) => {
      const canonical = (s.bookIds || []).filter((id) => booksById?.[id] && !away.has(id));
      return { ...s, canonical, bookIds: sortIds(canonical, booksById, o.sort) };
    }),
  }));
  const key = [o.sort, o.finishedShelf ? 1 : 0, o.dedupe ? 1 : 0, finished.join(','), [...hidden].sort().join(','),
    deps.map((d) => d.shelves.map((s) => s.bookIds.join(',')).join(';')).join('|')].join('#');
  return { departments: deps, finished, hidden, shownAs, noPicks, key, options: o };
}
