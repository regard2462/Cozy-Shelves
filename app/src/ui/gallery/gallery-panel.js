// Gallery panel: saved paintings (hang / delete / export) and the settings for the pictures on the library walls.
import { h, clear, formatDate } from '../../core/dom.js';
import { tr, i18n } from '../../core/i18n.js';

/** the panel used to persist 'none' while every consumer checks for 'off' – normalise both ways */
const normalizeMode = (m) => (m === 'none' ? 'off' : (m || 'impressionist'));

export async function mount(container, ctx, params = {}) {
  const T = (de, en, v) => tr({ de, en }, v);
  const sfx = (n) => { try { ctx.audio?.sfx?.(n); } catch { /* optional */ } };
  const toast = (m) => ctx.toast?.(m);
  const settings = ctx.state?.settings || (await ctx.api.settings.get()) || {};
  const st = {
    mode: normalizeMode(settings.paintings?.mode),
    folder: settings.paintings?.folder || null,
    items: [],
    // the frame the player pressed E on – 'Aufhängen' must target that one, not the nearest wall
    slot: Number.isFinite(+params.slot) ? +params.slot : null,
  };

  const panel = h('div.panel.paper.gal-panel');
  container.appendChild(panel);

  // keyboard support for rows/cards that are not <button>s
  const activate = (fn) => ({ role: 'button', tabindex: '0', onclick: fn, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e); } } });

  let grid, empty, folderLabel, modeBtns;

  // ---------------------------------------------------------------- settings (wall pictures)
  function renderMode() {
    for (const [id, el] of Object.entries(modeBtns)) {
      const on = id === st.mode;
      el.classList.toggle('active', on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    const own = st.mode === 'own';
    panel.querySelector('.gal-folder-row')?.classList.toggle('hidden', !own);
    folderLabel.textContent = st.folder || T('(noch kein Ordner gewählt)', '(no folder chosen yet)');
    folderLabel.title = st.folder || '';
  }
  async function setMode(mode) {
    st.mode = normalizeMode(mode); renderMode(); sfx('click');
    if (st.mode === 'own' && !st.folder) { await pickFolder(); if (!st.folder) return; }
    await ctx.api.settings.set({ paintings: { mode: st.mode, folder: st.folder } });
  }
  async function pickFolder() {
    let folder = null;
    try { folder = await ctx.api.files.pickFolder(T('Bilderordner wählen', 'Choose picture folder')); }
    catch (e) { console.warn('[gallery] pickFolder', e); }
    if (!folder) return;
    st.folder = folder; st.mode = 'own'; renderMode();
    await ctx.api.settings.set({ paintings: { mode: 'own', folder } });
    toast(T('Bilderordner gesetzt', 'Picture folder set'));
  }

  // ---------------------------------------------------------------- saved paintings
  async function load() {
    try { st.items = (await ctx.api.files.paintings()) || []; } catch (e) { console.warn('[gallery] paintings', e); st.items = []; }
    renderGrid();
  }
  function renderGrid() {
    clear(grid);
    empty.textContent = st.items.length ? '' : T('Noch keine gespeicherten Bilder. Male eines an der Staffelei!', 'No saved paintings yet. Paint one at the easel!');
    for (const it of st.items) {
      const title = (it.name || '').replace(/\.png$/i, '').replace(/-\d{4}-\d{2}-\d{2}.*$/, '').replace(/_/g, ' ');
      const card = h('div.gal-card', { 'aria-label': title || T('Ohne Titel', 'Untitled') },
        h('div.gal-frame', { ...activate(() => hang(it, title)), title: T('Aufhängen', 'Hang'), 'aria-label': T('Aufhängen', 'Hang') }, h('img', { src: it.url, alt: title, loading: 'lazy' })),
        h('div.gal-caption', h('span.gal-title.hand', { title }, title || T('Ohne Titel', 'Untitled')), h('span.small.muted', it.mtime ? formatDate(it.mtime, i18n.lang) : '')),
        h('div.gal-actions',
          h('button.btn.small.primary', { onclick: () => hang(it, title) }, T('Aufhängen', 'Hang')),
          h('button.btn.small', { onclick: () => exportItem(it, title) }, T('Exportieren', 'Export')),
          h('button.btn.small.ghost', { onclick: () => confirmDelete(it), title: T('Löschen', 'Delete'), 'aria-label': T('Löschen', 'Delete') }, '🗑'),
        ),
      );
      grid.appendChild(card);
    }
  }
  function hang(it, title) {
    // the world confirms with its own message ("Das Bild hängt jetzt an der Wand.")
    ctx.bus.emit('gallery:hang', { url: it.url, title, path: it.path, slot: st.slot });
    sfx('book-place');
  }
  async function exportItem(it, title) {
    try {
      const dataUrl = await toDataUrl(it.url);
      const p = await ctx.api.files.exportImage(dataUrl, (title || 'aquarell') + '.png');
      if (p) toast(T('Exportiert', 'Exported'));
    } catch (e) { console.warn('[gallery] export', e); toast(T('Export fehlgeschlagen', 'Export failed')); }
  }
  async function toDataUrl(url) {
    if (url.startsWith('data:')) return url;
    const r = await fetch(url); if (!r.ok) throw new Error('fetch ' + r.status);
    const blob = await r.blob();
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error('read')); fr.readAsDataURL(blob); });
  }

  let confirmDlg = null;
  function closeConfirm() { confirmDlg?.remove(); confirmDlg = null; }
  function confirmDelete(it) {
    closeConfirm();
    const del = async () => {
      try { await ctx.api.files.deletePainting(it.path); st.items = st.items.filter((x) => x !== it); renderGrid(); toast(T('Gelöscht', 'Deleted')); }
      catch (e) { console.warn('[gallery] delete', e); toast(T('Löschen fehlgeschlagen', 'Delete failed')); }
      closeConfirm();
    };
    confirmDlg = h('div.gal-confirm', { role: 'dialog', 'aria-modal': 'true' },
      h('p', T('Bild wirklich löschen?', 'Really delete this painting?')),
      h('div.row',
        h('button.btn.small.primary', { onclick: del }, T('Löschen', 'Delete')),
        h('button.btn.small', { onclick: closeConfirm }, T('Abbrechen', 'Cancel'))));
    panel.appendChild(confirmDlg);
    confirmDlg.querySelector('.btn')?.focus();
  }

  // ---------------------------------------------------------------- panel chrome (rebuilt on a language change)
  function render() {
    closeConfirm();
    clear(panel);
    grid = h('div.gal-grid');
    empty = h('div.gal-empty.muted');
    folderLabel = h('span.gal-folder.small.muted');
    modeBtns = {};
    const modes = [
      ['impressionist', T('Impressionistisch generiert', 'Impressionist (generated)'), '🖼'],
      ['own', T('Eigener Ordner', 'Own folder'), '📁'],
      ['off', T('Keine Bilder', 'No pictures'), '∅'],
    ];
    const modeRow = h('div.gal-modes', { role: 'group' }, modes.map(([id, label, icon]) =>
      (modeBtns[id] = h('button.gal-mode', { type: 'button', dataset: { mode: id }, 'aria-pressed': 'false', onclick: () => setMode(id) }, h('span.gal-mode-icon', icon), h('span', label)))));
    const header = h('div.panel-header',
      h('span', '🖼'), h('span', T('Galerie', 'Gallery')),
      st.slot != null ? h('span.gal-slot.small.muted', T('Rahmen {n}', 'Frame {n}', { n: st.slot + 1 })) : null,
      h('span.spacer'),
      h('button.btn.small.ghost', { onclick: () => load(), title: T('Aktualisieren', 'Refresh'), 'aria-label': T('Aktualisieren', 'Refresh') }, '↻'),
      h('button.btn.small.primary', { onclick: () => ctx.openPanel?.('watercolor', st.slot != null ? { slot: st.slot } : {}) }, T('Zur Staffelei', 'To the easel')),
      h('button.btn.small.icon', { onclick: () => ctx.close(), title: T('Schließen', 'Close'), 'aria-label': T('Schließen', 'Close') }, '✕'));
    const body = h('div.panel-body.gal-body',
      h('section.gal-section',
        h('h4', T('Bilder an den Wänden', 'Pictures on the walls')),
        modeRow,
        h('div.row.gal-folder-row',
          h('button.btn.small', { onclick: () => pickFolder() }, T('Bilderordner wählen…', 'Choose picture folder…')),
          folderLabel)),
      h('section.gal-section',
        h('h4', T('Gespeicherte Aquarelle', 'Saved watercolors')),
        grid, empty));
    panel.append(header, body);
    renderMode();
    renderGrid();
  }

  // ---------------------------------------------------------------- init
  render();
  await load();
  const offSaved = ctx.bus.on('painting:saved', () => load());
  const offLang = ctx.bus.on('i18n:change', () => render());
  return {
    unmount() { offSaved(); offLang(); },
    onKey(e) {
      if (e.key === 'Escape' && confirmDlg) { closeConfirm(); return true; }
      if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) { load(); return true; }
      return false;
    },
  };
}
