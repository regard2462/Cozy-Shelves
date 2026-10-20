// The welcome card: shown over the start menu whenever no books folder is set (the first start, or every folder
// removed again). It explains the library in two sentences and asks for a folder with books, either sorted by its
// sub folders ("Unterordner sind Abteilungen", mode 'structured') or sorted automatically (mode 'auto'). "Später"
// leaves the library empty; the card comes back on the next start, and the start menu offers it again.
// Keys: 1 and 2 (or the arrow keys) pick the way of sorting, Enter chooses the folder, Esc is "Später".
import { h, clear } from '../core/dom.js';
import { tr } from '../core/i18n.js';
import { isWeb, isAndroid } from '../core/platform.js';

const MODES = [
  { id: 'structured', key: '1',
    name: { de: 'Unterordner sind Abteilungen', en: 'Sub folders are departments' },
    hint: { de: 'Jeder Ordner darin wird eine Abteilung, seine Unterordner werden Regale.', en: 'Every folder inside becomes a department, its sub folders become shelves.' } },
  { id: 'auto', key: '2',
    name: { de: 'Automatisch einsortieren', en: 'Sort automatically' },
    hint: { de: 'Cozy Shelves ordnet jedes Buch nach Titel, Schlagwörtern und ISBN einer Abteilung zu, etwa Romane oder Geschichte.', en: 'Cozy Shelves puts every book into a department such as Novels or History, by its title, keywords and ISBN.' } },
];

export const WELCOME_TEXT = {
  title: { de: 'Willkommen in Cozy Shelves', en: 'Welcome to Cozy Shelves' },
  lead: {
    de: 'Cozy Shelves stellt die Bücher auf deinem Rechner in Regale, an denen du entlanggehen kannst. Wähle dafür einen Ordner mit Büchern, etwa mit PDF- und EPUB-Dateien. Die Dateien bleiben, wo sie sind.',
    en: 'Cozy Shelves puts the books on your computer on shelves you can walk along. Choose a folder with books for it, for example with PDF and EPUB files. The files stay where they are.',
  },
  modes: { de: 'So wird einsortiert', en: 'How the books are shelved' },
  choose: { de: 'Ordner mit Büchern wählen', en: 'Choose a folder with books' },
  choosing: { de: 'Ordner wird gewählt …', en: 'Choosing a folder …' },
  later: { de: 'Später', en: 'Later' },
  note: { de: 'Weitere Ordner fügst du jederzeit unter Esc → Einstellungen → Bücherordner hinzu.', en: 'You can add more folders at any time under Esc → Settings → Book folders.' },
  // the browser version: the books never leave the computer; what the two kinds of browser remember
  web: { de: 'Im Browser bleiben die Bücher auf deinem Rechner, die Seite liest sie nur. Lesezeichen und Leseposition merkt sich dieser Browser.', en: 'In the browser the books stay on your computer, the page only reads them. Bookmarks and reading positions are kept by this browser.' },
  // the Android app: the folder comes from the system's picker, the app keeps the permission
  android: { de: 'Die Bücher bleiben auf deinem Gerät, die App liest sie nur. Den gewählten Ordner behält die App über jeden Neustart.', en: 'The books stay on your device, the app only reads them. The app keeps the chosen folder across every restart.' },
  webNoPicker: { de: 'Dieser Browser merkt sich den Ordner nicht: Nach einem Neustart wählst du ihn erneut. Edge und Chrome merken ihn sich.', en: 'This browser does not remember the folder: choose it again after a restart. Edge and Chrome remember it.' },
  added: { de: 'Die Bücher werden eingelesen. Die Regale füllen sich nach und nach.', en: 'The books are being read in. The shelves fill up as they go.' },
  failed: { de: 'Der Ordner konnte nicht hinzugefügt werden.', en: 'The folder could not be added.' },
};

export async function mount(container, ctx) {
  let mode = 'structured';
  let busy = false;
  container.classList.add('welcome-layer');
  const card = h('div.panel.welcome-card', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'welcome-title' });
  container.appendChild(card);
  let chooseBtn = null;

  const setMode = (m) => { if (m !== mode && MODES.some((x) => x.id === m)) { mode = m; ctx.audio?.sfx?.('click'); render(); } };
  const later = () => { if (busy) return; ctx.audio?.sfx?.('click'); ctx.close(); };
  const choose = async () => {
    if (busy) return;
    busy = true; render();
    let folders = null;
    try { folders = await ctx.api.library.addFolder(mode); }
    catch (e) { console.warn('[welcome] addFolder', e); ctx.toast?.(tr(WELCOME_TEXT.failed)); }
    busy = false;
    if (!card.isConnected) return;
    // cancelled in the dialog: the card stays as it was
    if (!folders || !folders.length) { render(); chooseBtn?.focus({ preventScroll: true }); return; }
    // the main process keeps the folders itself (library:addFolder); the renderer's copy follows
    if (ctx.state?.settings) ctx.state.settings.folders = folders;
    ctx.audio?.sfx?.('open');
    ctx.toast?.(tr(WELCOME_TEXT.added), 5200);
    ctx.bus.emit('welcome:folder', folders);
    ctx.close();
  };

  function render() {
    clear(card);
    const radios = MODES.map((m) => h('button.wel-mode', {
      type: 'button', role: 'radio', 'aria-checked': m.id === mode ? 'true' : 'false', class: m.id === mode ? 'on' : '', dataset: { mode: m.id },
      tabindex: m.id === mode ? '0' : '-1', disabled: busy, onclick: () => setMode(m.id),
    }, h('kbd', m.key), h('span.wel-mode-text', h('span.wel-mode-name', tr(m.name)), h('span.wel-mode-hint', tr(m.hint)))));
    chooseBtn = h('button.btn.primary.wel-choose', { type: 'button', disabled: busy, onclick: choose }, busy ? tr(WELCOME_TEXT.choosing) : [tr(WELCOME_TEXT.choose), h('kbd', 'Enter')]);
    const lang = ctx.i18n?.lang || 'de';
    card.append(
      h('div.wel-ornament', { 'aria-hidden': 'true' }, '❧'),
      h('h2.wel-title#welcome-title', tr(WELCOME_TEXT.title)),
      h('p.wel-lead', tr(WELCOME_TEXT.lead)),
      h('div.wel-label', { id: 'welcome-modes' }, tr(WELCOME_TEXT.modes)),
      h('div.wel-modes', { role: 'radiogroup', 'aria-labelledby': 'welcome-modes' }, radios),
      h('div.wel-actions',
        chooseBtn,
        h('button.btn.wel-later', { type: 'button', disabled: busy, onclick: later }, tr(WELCOME_TEXT.later), h('kbd', 'Esc'))),
      h('p.wel-note', tr(WELCOME_TEXT.note)),
      isAndroid ? h('p.wel-note.wel-web', tr(WELCOME_TEXT.android))
        : isWeb ? h('p.wel-note.wel-web', tr(WELCOME_TEXT.web), ' ', typeof window.showDirectoryPicker === 'function' ? '' : tr(WELCOME_TEXT.webNoPicker)) : null,
      h('div.wel-lang', { role: 'group', 'aria-label': tr({ de: 'Sprache', en: 'Language' }) },
        ...[['de', 'Deutsch'], ['en', 'English']].map(([k, label]) => h('button.btn.small', { type: 'button', class: lang === k ? 'primary' : 'ghost', 'aria-pressed': lang === k ? 'true' : 'false', lang: k, dataset: { lang: k },
          onclick: () => { if ((ctx.i18n?.lang || 'de') !== k) ctx.api.settings.set({ language: k }).catch(() => {}); } }, label))),
    );
  }
  render();
  requestAnimationFrame(() => { if (card.isConnected && !card.contains(document.activeElement)) chooseBtn?.focus({ preventScroll: true }); });

  // the language switch (here or anywhere else) redraws the card at once; keep the focus on the same kind of button
  const offLang = ctx.bus.on('i18n:change', () => {
    const was = document.activeElement?.closest?.('.welcome-card') ? (document.activeElement.dataset.lang ? `[data-lang="${document.activeElement.dataset.lang}"]` : document.activeElement.classList.contains('wel-later') ? '.wel-later' : '.wel-choose') : null;
    render();
    if (was) card.querySelector(was)?.focus({ preventScroll: true });
  });
  // entering the library some other way (a script, the menu behind) takes the card along
  const offEnter = ctx.bus.on('world:enter', () => ctx.close());

  return {
    unmount() { offLang(); offEnter(); container.classList.remove('welcome-layer'); },
    onKey(e) {
      if (e.key === 'Escape') { later(); return true; }
      if (busy) return true;
      // Tab stays on the card (the start menu behind it is not reachable while it is open)
      if (e.key === 'Tab') {
        const list = [...card.querySelectorAll('button')].filter((b) => !b.disabled && b.tabIndex >= 0);
        const i = list.indexOf(document.activeElement);
        if (i < 0 || (e.shiftKey && i === 0) || (!e.shiftKey && i === list.length - 1)) { list[i < 0 || !e.shiftKey ? 0 : list.length - 1]?.focus({ preventScroll: true }); return true; }
        return false;
      }
      if (e.key === '1' || e.key === '2') { setMode(MODES[+e.key - 1].id); card.querySelector('.wel-mode.on')?.focus({ preventScroll: true }); return true; }
      const inModes = document.activeElement?.classList?.contains('wel-mode');
      if (inModes && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const i = MODES.findIndex((m) => m.id === mode), next = MODES[(i + (e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? MODES.length - 1 : 1)) % MODES.length];
        setMode(next.id); card.querySelector('.wel-mode.on')?.focus({ preventScroll: true });
        return true;
      }
      // Enter on a focused button presses that button (the browser does it); anywhere else it chooses the folder
      if (e.key === 'Enter' && !(document.activeElement && card.contains(document.activeElement) && document.activeElement.tagName === 'BUTTON')) { choose(); return true; }
      return false;
    },
  };
}
