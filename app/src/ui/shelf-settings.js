// Einstellungen → Bücherordner → Regale (0.7): the order of the books inside a shelf, the case "Gelesen", the reading goal
// and the duplicate books (settings.shelves, electron/settings.js). The world rearranges its shelves on its own when one
// of them changes (ui/shelves.js). Built with the primitives of the settings panel (toggle, groupTitle, note).
import { h } from '../core/dom.js';
import { tr } from '../core/i18n.js';
import { shelfOptions, SORT_MODES } from '../world/shelf-arrange.js';
import { duplicateGroups } from './duplicates.js';

const SORT_LABELS = {
  title: { de: 'Titel', en: 'Title' },
  author: { de: 'Autor (Nachname)', en: 'Author (surname)' },
  year: { de: 'Erscheinungsjahr', en: 'Year published' },
  publisher: { de: 'Verlag', en: 'Publisher' },
  series: { de: 'Reihe', en: 'Series' },
  added: { de: 'Zuletzt hinzugefügt', en: 'Recently added' },
  read: { de: 'Zuletzt gelesen', en: 'Recently read' },
};
export const sortLabel = (mode) => tr(SORT_LABELS[mode] || SORT_LABELS.title);

/**
 * The rows of the group "Regale".
 * @param cur     () → the settings as they are now
 * @param set     (patch) → Promise of the new settings
 * @param toggle, groupTitle, note: the settings panel's own primitives
 * @param debounced  the panel's debounce (its timers end with the panel)
 */
export function shelfSettingsRows({ cur, set, toggle, groupTitle, note, debounced, ctx }) {
  const opts = () => shelfOptions(cur().shelves);
  const sortSel = h('select.input.shelf-sort', { 'aria-label': tr({ de: 'Bücher im Regal sortieren nach', en: 'Sort books on the shelves by' }),
    onchange: () => set({ shelves: { sort: sortSel.value } }) },
  SORT_MODES.map((m) => h('option', { value: m }, sortLabel(m))));
  sortSel.value = opts().sort;
  const goal = h('input.input.shelf-goal', { type: 'number', min: 0, max: 999, step: 1, value: String(opts().readingGoal), 'aria-label': tr({ de: 'Leseziel pro Jahr', en: 'Reading goal per year' }),
    oninput: debounced((e) => { const v = Math.max(0, Math.min(999, Math.round(Number(goal.value) || 0))); set({ shelves: { readingGoal: v } }); }, 500) });
  const groups = duplicateGroups(ctx.state?.library?.books);
  const dupCount = groups.length
    ? tr({ de: '{g} Bücher liegen mehrfach vor ({n} Dateien)', en: '{g} books exist more than once ({n} files)' }, { g: groups.length, n: groups.reduce((a, g) => a + g.books.length, 0) })
    : tr({ de: 'Keine doppelten Bücher gefunden', en: 'No duplicate books found' });
  return [
    groupTitle(tr({ de: 'Regale', en: 'Shelves' })),
    h('div.setting', h('label', tr({ de: 'Bücher im Regal sortieren nach', en: 'Sort books on the shelves by' }),
      h('span.setting-hint', tr({ de: 'innerhalb jedes Regals, die Abteilungen bleiben, wo sie sind', en: 'inside every shelf, the departments stay where they are' }))), h('div.ctl', sortSel)),
    toggle(tr({ de: 'Gelesene Bücher ins Regal ‚Gelesen‘ stellen', en: 'Put finished books on the ‘Read’ shelf' }), () => opts().finishedShelf, (v) => set({ shelves: { finishedShelf: v } }),
      { hint: tr({ de: 'im Bücherzimmer links vom Durchgang, das zuletzt gelesene zuerst', en: 'in the book room left of the passage, the latest first' }) }),
    h('div.setting', h('label', tr({ de: 'Leseziel pro Jahr', en: 'Reading goal per year' }), h('span.setting-hint', tr({ de: 'Bücher, 0 = kein Ziel', en: 'books, 0 = no goal' }))), h('div.ctl', goal)),
    toggle(tr({ de: 'Doppelte Bücher nur einmal ins Regal stellen', en: 'Put duplicate books on the shelves only once' }), () => opts().dedupe, (v) => set({ shelves: { dedupe: v } }),
      { hint: tr({ de: 'die Ausgabe, in der du liest, sonst EPUB vor PDF', en: 'the copy you are reading, else EPUB before PDF' }) }),
    h('div.setting', h('label', tr({ de: 'Doppelte Bücher', en: 'Duplicate books' }), h('span.setting-hint', dupCount)),
      h('button.btn.small', { type: 'button', onclick: () => ctx.openPanel('duplicates', {}) }, tr({ de: 'Anzeigen', en: 'Show' }))),
    note(tr({
      de: 'Ein Buch gilt als gelesen, wenn du es bis 97 % gelesen oder in der Buchinfo oder mit C als gelesen markiert hast. Die Lesesträhne zählt die Tage in Folge mit mindestens 5 Minuten Lesezeit. Leseziel und Lesesträhne stehen in der Statistik am Computer.',
      en: 'A book counts as read when you have read 97 % of it or marked it as read in the book info or with C. The reading streak counts the days in a row with at least 5 minutes of reading. The reading goal and the streak are shown in the statistics on the computer.',
    })),
  ];
}
