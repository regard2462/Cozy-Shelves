// Overlays of the reading browser. Every sheet is built fresh when it opens (B.openSheet(name, opts)) and
// returns { el, kind } – kind decides the placement: 'menu' (top right), 'pop' (above the status bar),
// 'side' (right edge, full height) or 'dialog' (centred, over a scrim).
import { h, clear } from '../../core/dom.js';
import { icon } from './icons.js';
import { THEMES, FONTS, MEASURES } from './prefs.js';
import { hostOf, monogram, relTime, SEARCH_ENGINES, formatBytes, decimal, shelfFormat, isWeb } from './util.js';

// ---- small building blocks ----------------------------------------------------------------------------------------
const ib = (name, label, onclick, extra = {}) => h('button.br-ibtn', { type: 'button', title: label, 'aria-label': label, onclick, html: icon(name), ...extra });

function switchRow(label, value, onChange, { sub, disabled, ico } = {}) {
  const sw = h('button.br-switch', { type: 'button', role: 'switch', 'aria-checked': value ? 'true' : 'false', disabled: !!disabled, 'aria-label': label });
  sw.classList.toggle('on', !!value);
  const row = h('label.br-srow' + (disabled ? '.disabled' : ''), ico ? h('span.br-srow-ico', { html: icon(ico) }) : null,
    h('span.br-srow-text', h('span.br-srow-label', label), sub ? h('span.br-srow-sub', sub) : null), sw);
  sw.addEventListener('click', (e) => { e.preventDefault(); if (disabled) return; const v = !sw.classList.contains('on'); sw.classList.toggle('on', v); sw.setAttribute('aria-checked', v ? 'true' : 'false'); onChange(v); });
  return row;
}
function seg(options, value, onChange, { label } = {}) {
  const wrap = h('div.br-seg', { role: 'radiogroup', 'aria-label': label || '' });
  for (const [v, text] of options) {
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(v) === String(value) ? 'true' : 'false', onclick: () => { for (const x of wrap.children) { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); } b.classList.add('on'); b.setAttribute('aria-checked', 'true'); onChange(v); } }, text);
    if (String(v) === String(value)) b.classList.add('on');
    wrap.appendChild(b);
  }
  return wrap;
}
function stepper(text, onMinus, onPlus, labels) {
  const val = h('span.br-step-val', text);
  return { el: h('div.br-step', ib('minus', labels[0], onMinus), val, ib('plus', labels[1], onPlus)), set: (t) => { val.textContent = t; } };
}
const field = (label, control, hint) => h('div.br-field', h('div.br-field-label', label), control, hint ? h('div.br-field-hint', hint) : null);
function dialogHead(B, title, extra = []) {
  return h('header.br-dlg-head', h('h2', title), h('span.spacer'), ...extra, ib('close', B.T('Schließen', 'Close'), () => B.closeSheet()));
}

// ---- menu ---------------------------------------------------------------------------------------------------------
function menuSheet(B) {
  const T = B.T;
  const tab = B.activeTab();
  const web = !!(tab && isWeb(tab.url));
  const inList = web && !!B.store.laterOf(tab.url);
  const item = (ico, label, fn, { key, disabled, check } = {}) => h('button.br-mitem', { type: 'button', disabled: !!disabled, onclick: () => { B.closeSheet(); fn(); } },
    h('span.br-mitem-ico', { html: icon(ico) }), h('span.br-mitem-label', label), check ? h('span.br-mitem-check', { html: icon('check') }) : null, key ? h('span.br-mitem-key', key) : null);
  const sep = () => h('div.br-msep');
  const el = h('div.br-menu', { role: 'menu' },
    item('plus', T('Neuer Tab', 'New tab'), () => B.newTab(), { key: T('Strg+T', 'Ctrl+T') }),
    item('tabs', T('Tabs', 'Tabs'), () => B.openSheet('tabs'), { key: String(B.tabs.length) }),
    item('bookmark', T('Lesezeichen', 'Bookmarks'), () => B.openSheet('library', { tab: 'bookmarks' })),
    item('later', T('Leseliste', 'Reading list'), () => B.openSheet('library', { tab: 'later' })),
    item('clock', T('Verlauf', 'History'), () => B.openSheet('library', { tab: 'history' }), { key: T('Strg+H', 'Ctrl+H') }),
    sep(),
    item('later', inList ? T('In der Leseliste', 'On the reading list') : T('Später lesen', 'Read later'), () => B.toggleLater(), { disabled: !web, check: inList }),
    item('search', T('Auf der Seite suchen', 'Find on page'), () => B.openFind(), { disabled: !web, key: T('Strg+F', 'Ctrl+F') }),
    item('translate', tab?.translatedFrom ? T('Original anzeigen', 'Show the original') : T('Übersetzen', 'Translate'), () => B.translate(), { disabled: !web }),
    item('speak', T('Vorlesen', 'Read aloud'), () => B.tts.toggle(), { disabled: !web, key: 'V' }),
    sep(),
    item('book', T('Als Buch speichern', 'Save as book'), () => B.openSheet('save', { mode: 'book' }), { disabled: !web, key: T('Strg+S', 'Ctrl+S') }),
    item('stack', T('An Sammelband anhängen', 'Add to a collection'), () => B.openSheet('save', { mode: 'collection' }), { disabled: !web }),
    item('pdf', T('Als PDF speichern', 'Save as PDF'), () => B.openSheet('save', { mode: 'pdf' }), { disabled: !web, key: T('Strg+P', 'Ctrl+P') }),
    sep(),
    item('type', T('Darstellung', 'Appearance'), () => B.openSheet('look')),
    item('shield', T('Schutz und Schalter', 'Protection and switches'), () => B.openSheet('toggles')),
    sep(),
    item('link', T('Adresse kopieren', 'Copy address'), () => B.copyUrl(), { disabled: !web }),
    item('external', T('Im Systembrowser öffnen', 'Open in the system browser'), () => B.openExternal(), { disabled: !web }));
  return { el, kind: 'menu' };
}

// ---- switches -----------------------------------------------------------------------------------------------------
function togglesSheet(B) {
  const T = B.T, P = B.prefs;
  const tab = B.activeTab();
  const site = tab && isWeb(tab.url) ? hostOf(tab.url) : '';
  const siteRule = (site && P.sites[site]) || {};
  const blocked = tab?.blocked || 0;
  const el = h('div.br-toggles',
    h('h3', T('Schutz und Schalter', 'Protection and switches')),
    switchRow(T('Werbung und Tracker blocken', 'Block ads and trackers'), P.adblock, (v) => B.setPrefs({ adblock: v }, { reload: true }),
      { ico: 'shield', sub: P.adblock && site ? T('{n} Anfragen auf dieser Seite blockiert', '{n} requests blocked on this page', { n: blocked }) : T('Auch Tracking-Parameter in Adressen werden entfernt', 'Tracking parameters are removed from addresses too') }),
    site && P.adblock ? switchRow(T('Auf {s} nicht blocken', 'Do not block on {s}', { s: site }), siteRule.adblock === false, (v) => B.setSiteRule(site, { adblock: v ? false : undefined }), { sub: T('Ausnahme für diese Website', 'Exception for this site') }) : null,
    switchRow(T('Cookie-Hinweise ausblenden', 'Hide cookie notices'), P.cookies, (v) => B.setPrefs({ cookies: v }), { ico: 'cookie', sub: T('Die Hinweise werden versteckt, nichts wird zugestimmt', 'The notices are hidden, nothing is accepted') }),
    switchRow(T('JavaScript', 'JavaScript'), P.js, (v) => B.setPrefs({ js: v }, { reload: true }), { ico: 'code', sub: P.js ? T('Seiten dürfen Skripte ausführen', 'Pages may run scripts') : T('Seiten laufen ohne Skripte', 'Pages run without scripts') }),
    site ? switchRow(P.js ? T('Auf {s} sperren', 'Block on {s}', { s: site }) : T('Auf {s} erlauben', 'Allow on {s}', { s: site }), typeof siteRule.js === 'boolean', (v) => B.setSiteRule(site, { js: v ? !P.js : undefined }), { sub: T('Ausnahme für diese Website', 'Exception for this site') }) : null,
    switchRow(T('Bilder laden', 'Load images'), P.images, (v) => B.setPrefs({ images: v }, { reload: true }), { ico: 'image' }),
    switchRow(T('Nur Text', 'Text only'), P.textOnly, (v) => B.setPrefs({ textOnly: v }, { reload: true }), { ico: 'text', sub: T('Ohne Bilder, Farben und Gestaltung der Seite', 'Without the page’s images, colours and design') }),
    switchRow(T('Mobilansicht', 'Mobile view'), P.mobile, (v) => B.setPrefs({ mobile: v }, { reload: true }), { ico: 'mobile', sub: T('Seiten sehen einen Telefon-Browser', 'Pages see a phone browser') }));
  return { el, kind: 'pop' };
}

// ---- appearance ---------------------------------------------------------------------------------------------------
function lookSheet(B) {
  const T = B.T, P = B.prefs;
  const tab = B.activeTab();
  const site = tab && isWeb(tab.url) ? hostOf(tab.url) : '';
  const themes = h('div.br-themes', Object.entries(THEMES).map(([id, t]) => {
    const b = h('button.br-theme-sw', { type: 'button', dataset: { theme: id }, 'aria-pressed': (B.pageTheme ? B.pageTheme() : P.theme) === id ? 'true' : 'false', onclick: () => { B.setPrefs({ theme: id, themeChosen: true }); for (const x of themes.children) x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); } }, h('span.br-theme-chip', 'Aa'), h('span', B.lang === 'en' ? t.en : t.de));
    return b;
  }));
  const fonts = h('div.br-fonts', Object.entries(FONTS).map(([id, f]) => {
    const b = h('button.br-font', { type: 'button', 'aria-pressed': P.font === id ? 'true' : 'false', style: { fontFamily: f.css }, onclick: () => { B.setPrefs({ font: id }); for (const x of fonts.children) x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); } }, h('span.br-font-sample', 'Ag'), h('span.br-font-name', B.lang === 'en' && f.en ? f.en : f.label));
    return b;
  }));
  const size = stepper(P.fontSize + ' px', () => { B.setPrefs({ fontSize: B.prefs.fontSize - 1 }); size.set(B.prefs.fontSize + ' px'); }, () => { B.setPrefs({ fontSize: B.prefs.fontSize + 1 }); size.set(B.prefs.fontSize + ' px'); }, [T('Schrift kleiner', 'Smaller type'), T('Schrift größer', 'Larger type')]);
  const fmtLh = (v) => v.toFixed(2).replace('.', decimal(B.lang));
  const lh = stepper(fmtLh(P.lineHeight), () => { B.setPrefs({ lineHeight: B.prefs.lineHeight - 0.05 }); lh.set(fmtLh(B.prefs.lineHeight)); }, () => { B.setPrefs({ lineHeight: B.prefs.lineHeight + 0.05 }); lh.set(fmtLh(B.prefs.lineHeight)); }, [T('Weniger Zeilenabstand', 'Less line spacing'), T('Mehr Zeilenabstand', 'More line spacing')]);
  const lines = (n) => T(n === 1 ? '{n} Zeile' : '{n} Zeilen', n === 1 ? '{n} line' : '{n} lines', { n });
  const ov = stepper(lines(P.overlap), () => { B.setPrefs({ overlap: B.prefs.overlap - 1 }); ov.set(lines(B.prefs.overlap)); }, () => { B.setPrefs({ overlap: B.prefs.overlap + 1 }); ov.set(lines(B.prefs.overlap)); }, [T('Weniger Überlappung', 'Less overlap'), T('Mehr Überlappung', 'More overlap')]);
  const zoomText = () => Math.round((tab?.zoom || 1) * 100) + ' %';
  const zoom = stepper(zoomText(), () => { B.zoom(-1); zoom.set(zoomText()); }, () => { B.zoom(1); zoom.set(zoomText()); }, [T('Verkleinern', 'Zoom out'), T('Vergrößern', 'Zoom in')]);
  const measureLabels = { 26: T('Schmal', 'Narrow'), 32: T('Mittel', 'Medium'), 38: T('Breit', 'Wide'), 46: T('Sehr breit', 'Very wide'), 0: T('Voll', 'Full') };
  const el = h('div.br-look',
    dialogHead(B, T('Darstellung', 'Appearance')),
    h('div.br-look-body',
      field(T('Farbschema', 'Theme'), themes),
      field(T('Schrift im Lesemodus', 'Reader font'), fonts),
      h('div.br-field-pair', field(T('Schriftgröße', 'Font size'), size.el), field(T('Zeilenabstand', 'Line spacing'), lh.el)),
      field(T('Textbreite', 'Text width'), seg(MEASURES.map((m) => [m, measureLabels[m]]), P.measure, (v) => B.setPrefs({ measure: Number(v) }))),
      field(T('Seitenränder', 'Margins'), seg([['narrow', T('Schmal', 'Narrow')], ['normal', T('Normal', 'Normal')], ['wide', T('Weit', 'Wide')]], P.margin, (v) => B.setPrefs({ margin: v }))),
      field(T('Spalten', 'Columns'), seg([['auto', T('Automatisch', 'Automatic')], ['1', T('Eine', 'One')], ['2', T('Zwei', 'Two')]], P.columns, (v) => B.setPrefs({ columns: v })), T('Zwei Spalten gibt es in breiten Fenstern.', 'Two columns need a wide window.')),
      field(T('Im Lesemodus', 'In reader mode'), seg([['pages', T('Blättern', 'Pages')], ['scroll', T('Rollen', 'Scroll')]], P.paging, (v) => B.setPrefs({ paging: v }))),
      field(T('Ausrichtung', 'Alignment'), seg([['justify', T('Blocksatz', 'Justified')], ['left', T('Linksbündig', 'Left')]], P.align, (v) => B.setPrefs({ align: v }))),
      h('div.br-switches',
        switchRow(T('Silbentrennung', 'Hyphenation'), P.hyphens, (v) => B.setPrefs({ hyphens: v })),
        switchRow(T('Fette Schrift', 'Bold text'), P.bold, (v) => B.setPrefs({ bold: v }), { sub: T('Kräftiger auf blassen Bildschirmen', 'Stronger on pale screens') }),
        switchRow(T('Tiefschwarz', 'Pure black'), P.black, (v) => B.setPrefs({ black: v }), { sub: T('Aller Text in reinem Schwarz', 'All text in pure black') }),
        switchRow(T('Bilder im Lesemodus', 'Images in reader mode'), P.readerImages, (v) => B.setPrefs({ readerImages: v }))),
      h('h3.br-look-sub', T('Webseiten', 'Web pages')),
      h('div.br-field-pair', field(site ? T('Zoom auf {s}', 'Zoom on {s}', { s: site }) : T('Seitenzoom', 'Page zoom'), zoom.el), field(T('Überlappung beim Blättern', 'Overlap when turning'), ov.el)),
      h('div.br-switches',
        switchRow(T('Farbschema auch auf Webseiten', 'Theme on web pages too'), P.webStyle, (v) => B.setPrefs({ webStyle: v }), { sub: T('Nacht dunkelt Seiten ab, E-Ink schaltet Animationen ab. Fett und Tiefschwarz gelten mit.', 'Night darkens pages, E-Ink stops animations. Bold and pure black apply too.') }),
        switchRow(T('Lesemodus-Schrift auch auf Webseiten', 'Reader font on web pages too'), P.webFont, (v) => B.setPrefs({ webFont: v })),
        switchRow(T('Blätterleisten an den Rändern', 'Page-turn strips at the edges'), P.zones, (v) => B.setPrefs({ zones: v })),
        switchRow(T('Linie nach dem Blättern', 'Line after a page turn'), P.line, (v) => B.setPrefs({ line: v }), { sub: T('Markiert, wo die vorige Seite endete', 'Marks where the previous page ended') }),
        switchRow(T('Tabs beim nächsten Öffnen wiederherstellen', 'Restore tabs next time'), P.restoreSession, (v) => B.setPrefs({ restoreSession: v }))),
      field(T('Suchmaschine', 'Search engine'), h('select.br-select', { onchange: (e) => B.setPrefs({ searchEngine: e.target.value }) }, Object.entries(SEARCH_ENGINES).map(([id, s]) => h('option', { value: id, selected: P.searchEngine === id }, s.name))))));
  return { el, kind: 'side' };
}

// ---- tabs overview ----------------------------------------------------------------------------------------------------
function tabsSheet(B) {
  const T = B.T;
  const grid = h('div.br-tabgrid');
  for (const t of B.tabs) {
    const active = t === B.activeTab();
    const title = t.mode === 'start' ? T('Startseite', 'Start page') : (t.title || hostOf(t.url));
    const card = h('div.br-tabcard' + (active ? '.active' : ''), { role: 'button', tabindex: '0', 'aria-label': title, onclick: () => { B.closeSheet(); B.activate(t); }, onkeydown: (e) => { if (e.key === 'Enter') { B.closeSheet(); B.activate(t); } } },
      h('div.br-tabthumb', t.thumb ? h('img', { src: t.thumb, alt: '' }) : h('span.br-mono.big', t.mode === 'start' ? '＋' : monogram(t.title, t.url))),
      h('div.br-tabinfo', h('span.br-tab-title', title), h('span.br-tab-host', [t.mode === 'reader' ? T('Lesemodus', 'Reader') : null, hostOf(t.url)].filter(Boolean).join(' · '))),
      ib('close', T('Tab schließen', 'Close tab'), (e) => { e.stopPropagation(); B.closeTab(t); B.openSheet('tabs'); }, { class: 'br-tabclose' }));
    grid.appendChild(card);
  }
  grid.appendChild(h('button.br-tabcard.new', { type: 'button', onclick: () => { B.closeSheet(); B.newTab(); } }, h('span', { html: icon('plus') }), T('Neuer Tab', 'New tab')));
  const closed = B.store.data.closed.slice(0, 8);
  const el = h('div.br-dialog.br-tabs',
    dialogHead(B, T('Tabs ({n})', 'Tabs ({n})', { n: B.tabs.length })),
    h('div.br-dlg-body', grid,
      closed.length ? h('div.br-closed', h('h3', T('Zuletzt geschlossen', 'Recently closed')),
        closed.map((c) => h('button.br-lrow', { type: 'button', onclick: () => { B.closeSheet(); B.restoreClosed(c.url); } },
          h('span.br-mono.small', monogram(c.title, c.url)), h('span.br-lrow-title', c.title || hostOf(c.url)), h('span.br-lrow-meta', hostOf(c.url) + ' · ' + relTime(c.at, B.lang)), h('span.br-lrow-act', { html: icon('restore') })))) : null));
  return { el, kind: 'dialog' };
}

// ---- collection: bookmarks, reading list, history ------------------------------------------------------------------------
function librarySheet(B, opts = {}) {
  const T = B.T;
  let tab = opts.tab || 'bookmarks';
  let query = '';
  let editing = null, confirmClear = false, showRead = false;
  const list = h('div.br-llist');
  const search = h('input.br-input', { type: 'text', enterkeyhint: 'search', placeholder: T('Durchsuchen …', 'Search …'), 'aria-label': T('Durchsuchen', 'Search'), oninput: (e) => { query = e.target.value.trim().toLowerCase(); render(); } });
  const tabsEl = h('div.br-ltabs', { role: 'tablist' });
  const tools = h('div.br-ltools');
  const open = (url, e, extra) => { B.closeSheet(); B.navigate(url, { newTab: !!(e?.ctrlKey || e?.metaKey), ...extra }); };
  const match = (x) => !query || (x.title || '').toLowerCase().includes(query) || (x.url || '').toLowerCase().includes(query) || (x.folder || '').toLowerCase().includes(query);
  const row = (x, meta, actions, extra, onOpen) => h('div.br-lrow', { role: 'button', tabindex: '0', onclick: (e) => { if (e.target.closest('button, input, select')) return; (onOpen || ((ev) => open(x.url, ev, extra)))(e); }, onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) open(x.url, e, extra); } },
    h('span.br-mono.small', monogram(x.title, x.url)),
    h('span.br-lrow-main', h('span.br-lrow-title', x.title || hostOf(x.url)), h('span.br-lrow-meta', meta)),
    h('span.br-lrow-acts', actions));
  function render() {
    clear(tabsEl);
    for (const [id, label] of [['bookmarks', T('Lesezeichen', 'Bookmarks')], ['later', T('Leseliste', 'Reading list')], ['history', T('Verlauf', 'History')]]) {
      tabsEl.appendChild(h('button.br-ltab' + (tab === id ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': tab === id ? 'true' : 'false', onclick: () => { tab = id; editing = null; confirmClear = false; render(); } }, label));
    }
    clear(tools); clear(list);
    const d = B.store.data;
    if (tab === 'bookmarks') {
      const items = d.bookmarks.filter(match);
      const groups = new Map();
      for (const b of items) { const f = b.folder || ''; if (!groups.has(f)) groups.set(f, []); groups.get(f).push(b); }
      const keys = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'de')));
      if (!items.length) list.appendChild(h('p.br-empty', query ? T('Keine Treffer.', 'No matches.') : T('Noch keine Lesezeichen. Mit dem Stern in der Leiste oder Strg+D setzt du eines.', 'No bookmarks yet. Add one with the star in the toolbar or Ctrl+D.')));
      const folders = B.store.folders();
      for (const f of keys) {
        if (keys.length > 1 || f) list.appendChild(h('h3.br-lgroup', h('span', { html: icon('folder') }), f || T('Ohne Ordner', 'No folder')));
        for (const b of groups.get(f)) {
          if (editing === b.id) {
            const t = h('input.br-input', { value: b.title, 'aria-label': T('Titel', 'Title') });
            const fo = h('input.br-input', { value: b.folder || '', list: 'br-folders', placeholder: T('Ordner (leer lassen für keinen)', 'Folder (leave empty for none)'), 'aria-label': T('Ordner', 'Folder') });
            list.appendChild(h('div.br-ledit', t, fo, h('datalist#br-folders', folders.map((x) => h('option', { value: x }))),
              h('button.br-btn.primary.small', { type: 'button', onclick: () => { B.store.updateBookmark(b.id, { title: t.value, folder: fo.value }); editing = null; render(); B.refresh(); } }, T('Speichern', 'Save')),
              h('button.br-btn.small', { type: 'button', onclick: () => { editing = null; render(); } }, T('Abbrechen', 'Cancel'))));
            setTimeout(() => t.focus(), 0);
            continue;
          }
          list.appendChild(row(b, hostOf(b.url) + ' · ' + relTime(b.at, B.lang), [
            ib('edit', T('Bearbeiten', 'Edit'), () => { editing = b.id; render(); }),
            ib('trash', T('Entfernen', 'Remove'), () => { B.store.removeBookmark(b.id); render(); B.refresh(); }),
          ]));
        }
      }
    } else if (tab === 'later') {
      tools.appendChild(switchRow(T('Gelesene zeigen', 'Show read ones'), showRead, (v) => { showRead = v; render(); }));
      const items = d.readingList.filter((x) => (showRead || !x.read) && match(x));
      const allRead = !showRead && d.readingList.length > 0 && d.readingList.every((x) => x.read);
      if (!items.length) list.appendChild(h('p.br-empty', query ? T('Keine Treffer.', 'No matches.')
        : allRead ? T('Alles gelesen. Mit „Gelesene zeigen“ erscheinen die Einträge wieder.', 'Everything is read. “Show read ones” brings the entries back.')
          : T('Die Leseliste ist leer. Über das Menü nimmst du eine Seite mit „Später lesen“ auf.', 'The reading list is empty. Add a page with “Read later” in the menu.')));
      for (const x of items) {
        const r = row(x, [hostOf(x.url), x.mode === 'reader' ? T('Lesemodus', 'Reader') : null, x.read ? T('gelesen', 'read') : Math.round((x.progress || 0) * 100) + ' %', relTime(x.addedAt, B.lang)].filter(Boolean).join(' · '), [
          ib('check', x.read ? T('Als ungelesen markieren', 'Mark as unread') : T('Als gelesen markieren', 'Mark as read'), () => { B.store.setRead(x.url, !x.read); render(); }, { class: x.read ? 'on' : '' }),
          ib('trash', T('Entfernen', 'Remove'), () => { B.store.removeLater(x.url); render(); B.refresh(); }),
        ], { mode: x.mode, progress: x.progress });
        r.appendChild(h('span.br-bar-track.inrow', h('i', { style: { width: Math.round((x.progress || 0) * 100) + '%' } })));
        if (x.read) r.classList.add('read');
        list.appendChild(r);
      }
    } else {
      tools.appendChild(confirmClear
        ? h('div.br-confirm', h('span', T('Den ganzen Verlauf löschen', 'Delete the whole history')),
          h('button.br-btn.small.danger', { type: 'button', onclick: () => { B.store.clearHistory(); confirmClear = false; render(); } }, T('Löschen', 'Delete')),
          h('button.br-btn.small', { type: 'button', onclick: () => { confirmClear = false; render(); } }, T('Abbrechen', 'Cancel')))
        : h('div.br-confirm',
          h('button.br-btn.small', { type: 'button', onclick: () => { B.store.clearHistory(3600000); render(); } }, T('Letzte Stunde löschen', 'Delete the last hour')),
          h('button.br-btn.small', { type: 'button', onclick: () => { confirmClear = true; render(); } }, T('Alles löschen', 'Delete all'))));
      const items = d.history.filter(match).slice(0, 300);
      if (!items.length) list.appendChild(h('p.br-empty', query ? T('Keine Treffer.', 'No matches.') : T('Der Verlauf ist leer.', 'The history is empty.')));
      let day = '';
      for (const x of items) {
        const dd = new Date(x.at).toDateString();
        if (dd !== day) { day = dd; list.appendChild(h('h3.br-lgroup', dayLabel(x.at, B))); }
        list.appendChild(row(x, hostOf(x.url) + ' · ' + new Date(x.at).toLocaleTimeString(B.lang === 'en' ? 'en-GB' : 'de-DE', { hour: '2-digit', minute: '2-digit' }), [
          ib('trash', T('Aus dem Verlauf entfernen', 'Remove from history'), () => { B.store.forget(x.url); render(); }),
        ]));
      }
    }
  }
  render();
  const el = h('div.br-dialog.br-library', dialogHead(B, T('Sammlung', 'Collection')), tabsEl, h('div.br-lsearch', h('span', { html: icon('search') }), search), tools, h('div.br-dlg-body', list));
  return { el, kind: 'dialog', focus: search };
}
function dayLabel(ts, B) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return B.T('Heute', 'Today');
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return B.T('Gestern', 'Yesterday');
  return d.toLocaleDateString(B.lang === 'en' ? 'en-GB' : 'de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ---- save: book, Sammelband, PDF -------------------------------------------------------------------------------------------
function saveSheet(B, opts = {}) {
  const T = B.T;
  const tab = B.activeTab();
  let mode = opts.mode || 'book';
  let busy = false, result = null, err = null, collections = null, target = '';
  const art = tab?.article || null;
  const title = h('input.br-input', { value: (art?.title || tab?.title || hostOf(tab?.url)).slice(0, 180), 'aria-label': T('Titel', 'Title') });
  const collName = h('input.br-input', { value: '', placeholder: T('Name des neuen Sammelbands', 'Name of the new collection'), 'aria-label': T('Name des Sammelbands', 'Collection name') });
  let images = B.prefs.images && B.prefs.readerImages;
  let follow = false;
  const body = h('div.br-dlg-body');
  const modes = seg([['book', T('Neues Buch', 'New book')], ['collection', T('Sammelband', 'Collection')], ['pdf', T('PDF', 'PDF')]], mode, (v) => { mode = v; result = null; err = null; render(); }, { label: T('Art', 'Kind') });
  async function loadCollections() {
    try { collections = (await B.rpc('browser:collections')) || []; } catch { collections = []; }
    if (!target) target = collections.find((c) => c.kind === 'collection')?.path || '';
    render();
  }
  function render() {
    clear(body);
    body.appendChild(field(T('Art', 'Kind'), modes));
    if (mode === 'book') {
      body.append(
        field(T('Titel', 'Title'), title),
        h('p.br-field-hint', T('Der Text des Lesemodus wird als EPUB in den Ordner „Webseite als Buch“ gelegt und erscheint im Regal.', 'The reader text is stored as an EPUB in the folder “Webseite als Buch” and appears on the shelf.')),
        h('div.br-switches', switchRow(T('Bilder mitnehmen', 'Include images'), images, (v) => { images = v; }),
          art?.next ? switchRow(T('Folgeseiten mitnehmen', 'Include the following pages'), follow, (v) => { follow = v; }, { sub: T('Für Texte, die über mehrere Seiten gehen', 'For texts spread over several pages') }) : null));
    } else if (mode === 'collection') {
      if (!collections) { body.appendChild(h('p.br-field-hint', h('span.br-spinner.small'), ' ', T('Sammelbände werden gesucht …', 'Looking for collections …'))); loadCollections(); }
      else {
        const sel = h('select.br-select', { 'aria-label': T('Sammelband', 'Collection'), onchange: (e) => { target = e.target.value; render(); } },
          h('option', { value: '', selected: !target }, T('Neuer Sammelband …', 'New collection …')),
          collections.filter((c) => c.kind === 'collection').length ? h('optgroup', { label: T('Sammelbände', 'Collections') }, collections.filter((c) => c.kind === 'collection').map((c) => h('option', { value: c.path, selected: target === c.path }, `${c.title} (${T('{n} Kapitel', '{n} chapters', { n: c.chapters })})`))) : null,
          collections.filter((c) => c.kind === 'web').length ? h('optgroup', { label: T('Gespeicherte Webseiten', 'Saved web pages') }, collections.filter((c) => c.kind === 'web').map((c) => h('option', { value: c.path, selected: target === c.path }, `${c.title} (${T('{n} Kapitel', '{n} chapters', { n: c.chapters })})`))) : null);
        body.append(field(T('Sammelband', 'Collection'), sel));
        if (!target) body.append(field(T('Name', 'Name'), collName));
        body.append(
          field(T('Kapiteltitel', 'Chapter title'), title),
          h('p.br-field-hint', T('Der Artikel wird als neues Kapitel hinten angefügt. So entsteht aus mehreren Seiten ein Buch.', 'The article is added as a new chapter at the end. Several pages become one book.')),
          h('div.br-switches', switchRow(T('Bilder mitnehmen', 'Include images'), images, (v) => { images = v; })));
      }
    } else {
      body.append(
        field(T('Titel', 'Title'), title),
        h('p.br-field-hint', tab?.mode === 'reader' ? T('Die PDF-Datei enthält den Artikel aus dem Lesemodus in Buchschrift, ohne Seitenleisten.', 'The PDF contains the article from reader mode in book type, without side bars.') : T('Gedruckt wird die Seite, wie sie zu sehen ist. Im Lesemodus wird nur der Artikel gedruckt.', 'The page is printed as shown. In reader mode only the article is printed.')));
    }
    if (err) body.appendChild(h('p.br-msg.err', err));
    if (result) body.appendChild(h('div.br-msg.ok', h('span', { html: icon('check') }), h('span', result.text), result.bookId ? B.readButton(result.bookId) : null));
    body.appendChild(h('div.br-dlg-actions',
      h('button.br-btn', { type: 'button', onclick: () => B.closeSheet() }, result ? T('Schließen', 'Close') : T('Abbrechen', 'Cancel')),
      h('button.br-btn.primary', { type: 'button', disabled: busy, onclick: go }, busy ? h('span.br-spinner.small') : null, busy ? T('Wird gespeichert …', 'Saving …') : mode === 'collection' ? T('Anhängen', 'Add') : T('Speichern', 'Save'))));
  }
  async function go() {
    if (busy) return;
    busy = true; err = null; result = null; render();
    try {
      if (mode === 'pdf') result = await B.savePdf({ title: title.value });
      else if (mode === 'book') result = await B.saveBook({ title: title.value, images, follow });
      else {
        if (!target && !collName.value.trim()) throw new Error(T('Bitte einen Namen für den neuen Sammelband eingeben.', 'Please enter a name for the new collection.'));
        result = await B.appendToCollection({ path: target || null, name: collName.value.trim(), title: title.value, images });
        collections = null; target = result.path || target;
      }
    } catch (e) { err = String(e?.message || e); }
    busy = false;
    render();
  }
  render();
  const el = h('div.br-dialog.br-save', dialogHead(B, T('Seite behalten', 'Keep this page')), body);
  return { el, kind: 'dialog' };
}

// ---- a file the page offers for download ------------------------------------------------------------------------------------
function downloadSheet(B, opts = {}) {
  const T = B.T;
  const d = opts.download || {};
  const fmt = shelfFormat(d.filename || d.url, d.mime);
  const body = h('div.br-dlg-body');
  let state = 'offer', msg = '', bookId = null, progress = null;
  function render() {
    clear(body);
    body.append(...[
      h('div.br-dl', h('span.br-dl-ico', { html: icon(fmt === 'pdf' ? 'pdf' : 'book') }),
        h('div', h('div.br-dl-name', d.filename || hostOf(d.url)), h('div.br-dl-meta', [d.mime, formatBytes(d.size, B.lang), hostOf(d.url)].filter(Boolean).join(' · ')))),
      fmt ? h('p.br-field-hint', T('Die Datei kommt in den Ordner „Online-Katalog“ und steht danach im Regal.', 'The file goes into the “Online-Katalog” folder and then stands on the shelf.'))
        : h('p.br-field-hint', T('Dateien dieser Art nimmt Cozy Shelves nicht auf. Downloads aus Webseiten sind sonst gesperrt.', 'Cozy Shelves does not take files of this kind. Downloads from web pages are blocked otherwise.')),
      progress != null && state === 'busy' ? h('span.br-bar-track.wide', h('i', { style: { width: Math.round(progress * 100) + '%' } })) : null,
      msg ? h('p.br-msg' + (state === 'error' ? '.err' : '.ok'), msg, bookId ? B.readButton(bookId) : null) : null,
      h('div.br-dlg-actions',
        h('button.br-btn', { type: 'button', onclick: () => B.closeSheet() }, state === 'done' ? T('Schließen', 'Close') : T('Abbrechen', 'Cancel')),
        fmt && state !== 'done' ? h('button.br-btn.primary', { type: 'button', disabled: state === 'busy', onclick: go }, state === 'busy' ? T('Wird geladen …', 'Downloading …') : T('Ins Regal legen', 'Put on the shelf')) : null)].filter(Boolean));
  }
  async function go() {
    state = 'busy'; msg = ''; progress = 0; render();
    try {
      const r = await B.shelveDownload(d, fmt, (p) => { progress = p; render(); });
      bookId = r?.bookId || null;
      state = 'done';
      msg = r?.existed ? T('Die Datei stand schon im Regal.', 'The file was already on the shelf.') : T('Steht jetzt im Regal.', 'Now on the shelf.');
    } catch (e) { state = 'error'; msg = String(e?.message || e); }
    render();
  }
  render();
  return { el: h('div.br-dialog.br-download', dialogHead(B, T('Datei angeboten', 'File offered')), body), kind: 'dialog' };
}

export function buildSheet(B, name, opts) {
  switch (name) {
    case 'menu': return menuSheet(B, opts);
    case 'toggles': return togglesSheet(B, opts);
    case 'look': return lookSheet(B, opts);
    case 'tabs': return tabsSheet(B, opts);
    case 'library': return librarySheet(B, opts);
    case 'save': return saveSheet(B, opts);
    case 'download': return downloadSheet(B, opts);
    default: return null;
  }
}
