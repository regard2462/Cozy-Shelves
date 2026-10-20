// The full-text search in the settings (section "Bücherordner"): on/off, how far the index has come and its size on
// disk, "Index neu aufbauen", and "Index löschen" when the search is off. The rows follow the index live.
import { h } from '../../core/dom.js';
import { tr } from '../../core/i18n.js';
import { statusText, fmtSize } from './search-panel.js';

const T = (de, en, vars) => tr({ de, en }, vars);

/**
 * @param ui { api, s: () => settings, set(patch), toggle(label, get, apply, opts), note(text), groupTitle(text), keep(off), render() }
 *   the primitives of app/src/ui/settings.js
 */
export function fulltextRows({ api, s, set, toggle, note, groupTitle, keep, render }) {
  const bar = h('i');
  const line = h('span');
  const size = h('span.fts-set-size');
  const statusRow = h('div.setting.fts-set-status', h('div.fts-set-line', line, size), h('div.progress-bar.fts-progress', bar));
  const rebuild = h('button.btn.small', { type: 'button' });
  let confirmTimer = null;
  const idle = () => { rebuild.dataset.confirm = ''; rebuild.textContent = T('Index neu aufbauen', 'Rebuild the index'); };
  idle();
  rebuild.onclick = async () => {
    // a second click within a few seconds: the whole index is read again, which takes a while
    if (!rebuild.dataset.confirm) { rebuild.dataset.confirm = '1'; rebuild.textContent = T('Zum Neuaufbau noch einmal klicken', 'Click again to rebuild'); clearTimeout(confirmTimer); confirmTimer = setTimeout(idle, 4000); return; }
    clearTimeout(confirmTimer); idle();
    rebuild.disabled = true;
    try { show(await api.invoke('fulltext:rebuild')); } catch {}
    rebuild.disabled = false;
  };
  keep(() => clearTimeout(confirmTimer));
  const remove = h('button.btn.small.ghost', { type: 'button', onclick: async () => { try { show(await api.invoke('fulltext:delete')); } catch {} } }, T('Index löschen', 'Delete the index'));
  const show = (st) => {
    if (!st) return;
    line.textContent = statusText(st);
    size.textContent = st.bytes ? ' · ' + T('Index {s}', 'index {s}', { s: fmtSize(st.bytes) }) : '';
    bar.style.width = (st.total ? Math.round((st.done / st.total) * 100) : 0) + '%';
    statusRow.classList.toggle('complete', !st.enabled || (st.total > 0 && st.done >= st.total));
    remove.classList.toggle('hidden', st.enabled || !st.bytes);
    rebuild.classList.toggle('hidden', !st.enabled);
  };
  keep(api.on?.('fulltext:status', show));
  api.invoke('fulltext:status').then(show).catch(() => {});
  return [
    groupTitle(T('Volltextsuche', 'Full-text search')),
    toggle(T('Volltextsuche', 'Full-text search'), () => s().fulltext?.enabled !== false, (v) => set({ fulltext: { enabled: v } }).then(() => render()),
      { hint: T('Taste T oder Strg+F, auch im Buch', 'Key T or Ctrl+F, also in a book') }),
    statusRow,
    h('div.row.fts-set-actions', rebuild, remove),
    note(T(
      'Cozy Shelves liest den Text aller Bücher im Hintergrund, ein Buch nach dem anderen, und merkt sich jede Seite. Das dauert beim ersten Mal eine Weile und pausiert, solange du liest, vorlesen lässt oder einen Film schaust. Neue und geänderte Bücher kommen von selbst dazu. Gescannte Bücher ohne Textebene lassen sich nicht durchsuchen.',
      'Cozy Shelves reads the text of all books in the background, one book after another, and keeps every page. The first time this takes a while, and it pauses while you read, listen to read-aloud or watch a film. New and changed books are added by themselves. Scanned books without a text layer cannot be searched.')),
  ];
}
