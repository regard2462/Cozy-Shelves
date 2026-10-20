// SYSTEM – the appearance of the app (Hell, Sepia, Dunkel), the language, rescan and reindex, the book folders
// and what the app is. The appearance is the same setting as in Einstellungen → Allgemein.
import { h, clear } from '../../../core/dom.js';
import { keyList, T, notice, isEditable, icon } from '../terminal.js';
import { THEMES, THEME_LABELS, onTheme, currentTheme, applyTheme } from '../../../core/theme.js';
import { duplicateGroups } from '../../duplicates.js';

/** "3 Bücher liegen mehrfach vor" for the row that opens the list of duplicate books. */
const dupSummary = (books) => { const g = duplicateGroups(books).length; return g ? T('{n} Bücher liegen mehrfach vor', '{n} books exist more than once', { n: g }) : T('Keine doppelten Bücher gefunden', 'No duplicate books found'); };

export async function mount(root, s) {
  const { ctx, sfx } = s;
  let list = null, disposed = false, keep = 0;
  const el = h('div.term-system');
  root.appendChild(el);
  let info = null;
  try { info = await ctx.api.app.info?.(); } catch { /* ignore */ }

  const setTheme = async (t) => {
    if (!THEMES.includes(t) || t === currentTheme()) return;
    sfx.click();
    applyTheme(t);   // at once; main.js applies the stored value again when the settings report back
    try { await ctx.api.settings.set({ ui: { theme: t } }); } catch (e) { console.warn(e); }
    s.toast(T('Erscheinungsbild: {t}', 'Appearance: {t}', { t: s.tr(THEME_LABELS[t]) }));
  };
  const cycleTheme = (d = 1) => setTheme(THEMES[(THEMES.indexOf(currentTheme()) + d + THEMES.length) % THEMES.length]);

  async function render() {
    if (disposed) return;
    clear(el);
    const lang = ctx.i18n?.lang || ctx.state?.settings?.language || 'de';
    const theme = currentTheme();
    const lib = ctx.state?.library || {};
    const folders = ctx.state?.settings?.folders || lib.folders || [];
    const scan = lib.scan || {};
    const rows = [];
    const row = (ic, label, value, fn, opts = {}) => {
      const r = h('div.term-sys-row', { class: opts.cls || '', role: 'button' }, h('span.term-sys-icon', icon(ic)), h('span.term-sys-text', h('span.term-sys-label', label), value ? h('span.term-sys-value', value) : null), opts.end || null);
      r._fn = fn; r._key = opts.onKey || null; rows.push(r); return r;
    };

    // appearance: three previews, as in the settings
    const pick = h('div.theme-pick', { role: 'radiogroup', 'aria-label': T('Erscheinungsbild', 'Appearance') }, THEMES.map((k) => h('button.theme-opt', {
      type: 'button', tabindex: -1, role: 'radio', 'aria-checked': k === theme ? 'true' : 'false', class: k === theme ? 'on' : '', dataset: { theme: k },
      onclick: (e) => { e.stopPropagation(); setTheme(k); } },
    h('span.theme-swatch', { 'aria-hidden': 'true' }, h('i.ts-bar'), h('i.ts-line'), h('i.ts-line.short'), h('i.ts-dot')), h('span.theme-name', s.tr(THEME_LABELS[k])))));
    el.appendChild(h('section.term-card',
      h('div.term-card-head', h('h3.term-card-h', T('Darstellung', 'Display'))),
      row('palette', T('Erscheinungsbild', 'Appearance'), T('Hell, Sepia oder Dunkel für alle Tafeln und Menüs', 'Light, sepia or dark for all panels and menus'), () => cycleTheme(1),
        { cls: 'term-sys-theme', end: pick, onKey: (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { cycleTheme(e.key === 'ArrowRight' ? 1 : -1); return true; } return false; } }),
      row('language', T('Sprache', 'Language'), null, async () => {
        const next = lang === 'de' ? 'en' : 'de';
        try { await ctx.api.settings.set({ language: next }); } catch (e) { console.warn(e); }
        if (ctx.state?.settings) ctx.state.settings.language = next;
        ctx.i18n?.setLanguage?.(next);
        s.toast(next === 'de' ? 'Sprache: Deutsch' : 'Language: English');
      }, { end: h('span.term-seg', ['DE', 'EN'].map((l, i) => h('span.term-seg-btn', { class: (lang === 'en' ? 1 : 0) === i ? 'on' : '' }, l))) })));

    el.appendChild(h('section.term-card',
      h('div.term-card-head', h('h3.term-card-h', T('Bestand', 'Collection')), h('span.spacer'),
        h('span.term-card-note', T('{n} Bücher · {d} Abteilungen · Scan: {p}', '{n} books · {d} departments · scan: {p}', { n: (lib.books || []).length, d: (lib.departments || []).length, p: scan.active ? `${scan.phase || ''} ${scan.done ?? ''}/${scan.total ?? ''}` : T('ruht', 'idle') }))),
      row('refresh', T('Bestand neu einlesen', 'Rescan library'), T('Die Ordner nach neuen Büchern durchsuchen', 'Look for new books in the folders'), async () => { await ctx.api.library.rescan(); s.toast(T('Bestand wird neu eingelesen …', 'Rescanning library …')); }),
      row('catalog', T('Neu indizieren', 'Reindex'), T('Metadaten und Cover aller Bücher erneuern', 'Refresh the metadata and covers of all books'), async () => { await ctx.api.library.reindexAll(); s.toast(T('Neuindizierung gestartet …', 'Reindexing started …')); }),
      // the books that exist more than once (ui/duplicates.js): a panel on top of the computer, Esc leads back here
      row('shelf', T('Doppelte Bücher', 'Duplicate books'), dupSummary(lib.books), () => { sfx.open(); ctx.openPanel?.('duplicates', {}); })));

    const folderCard = h('section.term-card', h('div.term-card-head', h('h3.term-card-h', T('Bücherordner', 'Book folders'))));
    if (!folders.length) folderCard.appendChild(notice(T('Noch kein Bücherordner eingetragen.', 'No book folder configured yet.')));
    for (const f of folders) folderCard.appendChild(h('div.term-folder', icon('folder'), h('span.term-path', { title: f.path }, f.path), h('span.term-chip', f.mode === 'structured' ? T('vorsortiert', 'structured') : T('automatisch', 'auto'))));
    folderCard.append(
      row('folder', T('Ordner hinzufügen (vorsortiert)', 'Add folder (structured)'), T('Unterordner werden zu Abteilungen und Regalen', 'Sub-folders become departments and shelves'), async () => { const r = await ctx.api.library.addFolder('structured'); if (r) { s.toast(T('Ordner hinzugefügt.', 'Folder added.')); render(); } }),
      row('folder', T('Ordner hinzufügen (automatisch)', 'Add folder (auto)'), T('Einordnung nach Metadaten, ISBN und Schlagwörtern', 'Shelved by metadata, ISBN and keywords'), async () => { const r = await ctx.api.library.addFolder('auto'); if (r) { s.toast(T('Ordner hinzugefügt.', 'Folder added.')); render(); } }));
    el.appendChild(folderCard);

    const inf = info || {};
    el.appendChild(h('section.term-card',
      h('div.term-card-head', h('h3.term-card-h', T('Über dieses Terminal', 'About this terminal'))),
      h('p.term-about', `Cozy Shelves ${inf.version || ''}`, h('span.term-dim', ` · ${inf.platform || navigator.platform || '?'}${inf.electron ? ' · Electron ' + inf.electron : ''}${inf.arch ? ' · ' + inf.arch : ''}`)),
      inf.userData || inf.dataDir ? h('p.term-about.term-path', inf.userData || inf.dataDir) : null,
      row('power', T('Terminal ausschalten', 'Switch off the terminal'), T('Zurück in Cozy Shelves (Esc)', 'Back to the reading room (Esc)'), () => ctx.close())));

    list = keyList(rows, { onEnter: (r) => { sfx.click(); r._fn?.(); } });
    list.set(Math.min(keep, rows.length - 1), false);
  }
  await render();
  const offTheme = onTheme(() => { keep = list?.index ?? 0; render(); });
  s.setHints([['↑↓', T('wählen', 'select')], ['⏎', T('umschalten / ausführen', 'toggle / run')], ['←→', T('Erscheinungsbild', 'appearance')], ['Esc', T('zurück', 'back')]]);
  return {
    unmount() { disposed = true; offTheme(); },
    onKey(e) {
      if (isEditable(e.target)) return false;
      const cur = list?.current;
      if (cur?._key && cur._key(e)) return true;
      if (list && list.onKey(e)) { e.preventDefault(); return true; }
      return false;
    },
  };
}
