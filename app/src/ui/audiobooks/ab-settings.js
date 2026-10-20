// Settings → Hörbücher: the audiobook folders (add, remove, read again) and what the scan found.
import { h, clear } from '../../core/dom.js';
import { tr } from '../../core/i18n.js';
import { abStore } from './ab-store.js';

/** The rows of the section; `keep(off)` ties a subscription to the section (ui/settings.js). */
export function audiobookSettings({ ctx, note, groupTitle, keep }) {
  abStore.start();
  const list = h('div.ab-set-folders');
  const status = h('p.settings-note.small.muted.ab-set-status', { 'aria-live': 'polite' });
  const draw = () => {
    if (!list.isConnected && list.dataset.drawn) return;
    list.dataset.drawn = '1';
    clear(list);
    const folders = abStore.folders;
    if (!folders.length) list.appendChild(note(tr({ de: 'Noch kein Hörbuchordner. Füge den Ordner hinzu, in dem deine Hörbücher liegen.', en: 'No audiobook folder yet. Add the folder that holds your audiobooks.' })));
    for (const f of folders) {
      list.appendChild(h('div.folder-row',
        h('span.path', { title: f.path }, f.path),
        h('button.btn.small.ghost', { onclick: async () => { await abStore.removeFolder(f.path).catch(() => null); await abStore.refresh(); } }, tr({ de: 'Entfernen', en: 'Remove' }))));
    }
    const sc = abStore.scan, n = abStore.books.length;
    const parts = [];
    if (sc?.active) parts.push(sc.phase === 'tags' && sc.total ? tr({ de: 'Wird eingelesen: {d} von {t} Dateien', en: 'Reading: {d} of {t} files' }, { d: sc.done, t: sc.total }) : tr({ de: 'Die Ordner werden durchsucht …', en: 'Looking through the folders …' }));
    else if (folders.length) parts.push(n === 1 ? tr({ de: '1 Hörbuch', en: '1 audiobook' }) : tr({ de: '{n} Hörbücher', en: '{n} audiobooks' }, { n }), sc?.files ? tr({ de: '{n} Dateien', en: '{n} files' }, { n: sc.files }) : null);
    if (sc?.unavailable?.length) parts.push(tr({ de: 'nicht erreichbar: {p}', en: 'not reachable: {p}' }, { p: sc.unavailable.join(', ') }));
    status.textContent = parts.filter(Boolean).join(' · ');
  };
  draw();
  keep(abStore.onChange(draw));
  abStore.refresh().then(draw);
  return [
    groupTitle(tr({ de: 'Hörbuchordner', en: 'Audiobook folders' })),
    list,
    h('div.row', { style: { marginTop: '14px' } },
      h('button.btn', { onclick: async () => { const f = await abStore.addFolder().catch(() => null); if (f) { await abStore.refresh(); draw(); } } }, '＋ ' + tr({ de: 'Hörbuchordner hinzufügen', en: 'Add audiobook folder' })),
      h('button.btn.ghost', { onclick: () => abStore.rescan() }, '↻ ' + tr({ de: 'Neu einlesen', en: 'Scan again' })),
      h('button.btn.ghost', { onclick: () => ctx.openPanel('audiobooks', {}) }, '🎧 ' + tr({ de: 'Hörbücher öffnen', en: 'Open audiobooks' }))),
    status,
    note(tr({
      de: 'Jeder Ordner mit Audiodateien wird ein Hörbuch, seine Dateien in natürlicher Reihenfolge (Teil 2 vor Teil 10). Unterordner wie CD1 und CD2 gehören dazu. Eine M4B-Datei oder eine Datei mit eigenen Kapiteln ist ein Hörbuch für sich. Nummerierte Unterordner („01 Band eins“) werden zu einer Reihe. Titel, Autor, Sprecher, Kapitel und Cover kommen aus den Tags, sonst aus den Ordner- und Dateinamen und aus Bildern wie cover.jpg. Formate: MP3, M4A, M4B, AAC, OGG, OPUS, FLAC, WAV. Neue Dateien erkennt Cozy Shelves von selbst.',
      en: 'Every folder with audio files becomes an audiobook, its files in natural order (part 2 before part 10). Sub folders such as CD1 and CD2 belong to it. An M4B file, or a file with chapters of its own, is an audiobook by itself. Numbered sub folders (“01 Book one”) become a series. Title, author, narrator, chapters and cover come from the tags, otherwise from the folder and file names and from pictures such as cover.jpg. Formats: MP3, M4A, M4B, AAC, OGG, OPUS, FLAC, WAV. New files are picked up by themselves.',
    })),
  ];
}
