// Small pieces of the shelves (0.7) for the book card in the room, the book info and the list of duplicate books: the H
// key, the "Gelesen" ribbon, "Als gelesen markieren" and the other copies of a book ("Auch vorhanden als: PDF, 2 MB,
// Ordner …") with a button that shows the file in the Explorer. Nothing here deletes a file.
import { h, escapeHtml, formatDate } from '../core/dom.js';
import { tr } from '../core/i18n.js';
import { preferredCopy } from '../../../electron/library/duplicates.js';
import { shelfOptions } from '../world/shelf-arrange.js';
import { has } from '../core/platform.js';

export const FORMAT_LABEL = { pdf: 'PDF', epub: 'EPUB', mobi: 'MOBI', azw3: 'AZW3', fb2: 'FB2', cbz: 'CBZ', txt: 'TXT', md: 'Markdown', html: 'HTML', docx: 'Word', rtf: 'RTF' };
const formatOf = (b) => FORMAT_LABEL[b?.format] || String(b?.format || '').toUpperCase();

/** The key on the book card (HTML, like peek.keys): H marks the book as read or as unread. */
export function readKeyHint(book) {
  const what = book?.finished ? tr({ de: 'Als ungelesen markieren', en: 'Mark as unread' }) : tr({ de: 'Als gelesen markieren', en: 'Mark as read' });
  return `<span><kbd>C</kbd> ${escapeHtml(what)}</span>`;
}
/** A small ribbon on the cover of a book that is read (the book card, CSS .peek-read). */
export function readBadge(book) {
  return book?.finished ? h('div.peek-read', { 'aria-label': tr({ de: 'Gelesen', en: 'Read' }) }, '✓ ' + tr({ de: 'Gelesen', en: 'Read' })) : null;
}
/** "Gelesen am 3. Okt. 2026" for a book that is read, else null. */
export function readLine(book, lang) {
  if (!book?.finished) return null;
  return book.finishedAt ? tr({ de: 'Gelesen am {d}', en: 'Read on {d}' }, { d: formatDate(book.finishedAt, lang) }) : tr({ de: 'Gelesen', en: 'Read' });
}

/** "2,1 MB", "640 KB" */
export function sizeLabel(bytes, lang = 'de') {
  const n = Number(bytes) || 0;
  const loc = lang === 'en' ? 'en-GB' : 'de-DE';
  if (n >= 104858) return (n / 1048576).toLocaleString(loc, { maximumFractionDigits: n >= 10485760 ? 0 : 1 }) + ' MB';
  return Math.max(1, Math.round(n / 1024)).toLocaleString(loc) + ' KB';
}
/** The folder a copy lies in, as the user knows it: the books folder's name and the sub folders ("Bücher › Romane"). */
export function folderLabel(book) {
  const root = String(book?.folder || '').split(/[\\/]/).filter(Boolean).pop() || '';
  const dirs = String(book?.relPath || '').split(/[\\/]/).filter(Boolean).slice(0, -1);
  return [root, ...dirs].filter(Boolean).join(' › ') || root;
}
/** The reasons a group was found, as the list says them. */
export function reasonLabel(r) {
  return { file: tr({ de: 'gleiche Datei', en: 'same file' }), isbn: tr({ de: 'gleiche ISBN', en: 'same ISBN' }), title: tr({ de: 'gleicher Titel und Autor', en: 'same title and author' }) }[r] || r;
}

/** The copies of a book (itself included), and the one that stands on the shelf. */
export function copiesOf(book, books) {
  if (!book?.dupGroup) return { list: [book].filter(Boolean), shown: book };
  const list = (books || []).filter((b) => b.dupGroup === book.dupGroup);
  if (!list.some((b) => b.id === book.id)) list.push(book);
  return { list, shown: preferredCopy(list) };
}

/**
 * One copy: format, size and folder, whether it stands on the shelf, and its buttons (Explorer, info). The Explorer is
 * opened by the main process (library:revealFile); ctx.revealFile replaces it in the checks, which never open a window.
 */
export function copyRow(b, ctx, { shown = false, current = false, onInfo = null } = {}) {
  const lang = ctx.i18n?.lang || 'de';
  const reveal = () => { if (typeof ctx.revealFile === 'function') ctx.revealFile(b.id); else ctx.api.library.revealFile(b.id); };
  const facts = [formatOf(b), b.size ? sizeLabel(b.size, lang) : null, b.progress > 0.005 ? tr({ de: '{p} % gelesen', en: '{p} % read' }, { p: Math.round(b.progress * 100) }) : null].filter(Boolean).join(' · ');
  return h('div.dup-copy', { class: [shown ? 'shown' : '', current ? 'current' : ''].filter(Boolean).join(' '), dataset: { id: b.id } },
    h('div.dup-copy-text',
      h('div.dup-copy-facts', facts, shown ? h('span.dup-chip', tr({ de: 'steht im Regal', en: 'on the shelf' })) : null, current ? h('span.dup-chip.muted', tr({ de: 'diese Ausgabe', en: 'this copy' })) : null),
      h('div.dup-copy-folder', { title: b.path || '' }, '📁 ' + folderLabel(b))),
    h('div.dup-copy-actions',
      // the browser version cannot open the Explorer (core/platform.js)
      has('revealFile') ? h('button.btn.small', { type: 'button', onclick: reveal, title: b.path || '', dataset: { act: 'reveal' } }, tr({ de: 'Im Explorer zeigen', en: 'Show in Explorer' })) : null,
      onInfo && !current ? h('button.btn.small.ghost', { type: 'button', onclick: () => onInfo(b), dataset: { act: 'info' } }, tr({ de: 'Info', en: 'Info' })) : null));
}

/** "Auch vorhanden als:" in the book info: the other copies of the book, or null. */
export function copiesBlock(book, ctx, { onInfo } = {}) {
  const { list, shown } = copiesOf(book, ctx.state?.library?.books);
  const others = list.filter((b) => b.id !== book.id);
  if (!others.length) return null;
  const dedupe = shelfOptions(ctx.state?.settings?.shelves).dedupe;
  return h('div.rd-bi-copies',
    h('div.rd-bi-copies-head', tr({ de: 'Auch vorhanden als:', en: 'Also available as:' })),
    others.map((b) => copyRow(b, ctx, { shown: dedupe && shown?.id === b.id, onInfo })),
    dedupe && shown?.id === book.id ? h('div.rd-bi-copies-note', tr({ de: 'Diese Ausgabe steht im Regal.', en: 'This copy stands on the shelf.' })) : null);
}

/** The button of the book info: "Als gelesen markieren" / "Als ungelesen markieren". */
export function readButton(book, onToggle) {
  return h('button.btn.ghost.rd-bi-read', { type: 'button', onclick: () => onToggle(!book.finished), dataset: { read: book.finished ? '1' : '0' } },
    book.finished ? '↺ ' + tr({ de: 'Als ungelesen markieren', en: 'Mark as unread' }) : '✓ ' + tr({ de: 'Als gelesen markieren', en: 'Mark as read' }));
}
