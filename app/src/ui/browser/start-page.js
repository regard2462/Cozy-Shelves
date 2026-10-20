// Start page of a new tab: search field, reading list with progress, bookmarks, recently visited and closed pages.
// Rendered in the app's own document (no web page, nothing loaded until a link is chosen).
import { h, clear } from '../../core/dom.js';
import { icon } from './icons.js';
import { SEARCH_ENGINES, SUGGESTIONS, hostOf, monogram, relTime } from './util.js';

export function renderStart(B, el) {
  const T = B.T;
  const d = B.store.data;
  clear(el);
  const open = (url, e, extra = {}) => B.navigate(url, { newTab: !!(e && (e.ctrlKey || e.metaKey || e.button === 1)), background: !!(e && (e.ctrlKey || e.metaKey || e.button === 1)), ...extra });
  const linkProps = (url, extra) => ({ href: url, onclick: (e) => { e.preventDefault(); open(url, e, extra); }, onauxclick: (e) => { if (e.button === 1) { e.preventDefault(); open(url, e, extra); } } });

  const input = h('input.br-start-input', {
    type: 'text', enterkeyhint: 'go', spellcheck: false, autocomplete: 'off', 'aria-label': T('Suchen oder Adresse eingeben', 'Search or enter an address'),
    placeholder: T('Suchen oder Adresse eingeben', 'Search or enter an address'),
    onkeydown: (e) => { if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); B.navigate(input.value); } },
  });
  const engine = h('select.br-select.br-start-engine', { title: T('Suchmaschine', 'Search engine'), 'aria-label': T('Suchmaschine', 'Search engine'), onchange: (e) => B.setPrefs({ searchEngine: e.target.value }) },
    Object.entries(SEARCH_ENGINES).map(([id, s]) => h('option', { value: id, selected: B.prefs.searchEngine === id }, s.name)));

  const tile = (item, extra) => h('a.br-tile', linkProps(item.url, extra),
    h('span.br-mono', monogram(item.title, item.url)),
    h('span.br-tile-title', item.title || hostOf(item.url)),
    h('span.br-tile-host', hostOf(item.url)));

  const unread = d.readingList.filter((r) => !r.read).slice(0, 6);
  const sections = [];
  if (unread.length) {
    sections.push(h('section.br-start-sec',
      h('h2', h('span', { html: icon('later') }), T('Weiterlesen', 'Continue reading')),
      h('div.br-later-list', unread.map((r) => h('a.br-later', linkProps(r.url, { mode: r.mode, progress: r.progress }),
        h('span.br-later-title', r.title || hostOf(r.url)),
        h('span.br-later-meta', [hostOf(r.url), r.mode === 'reader' ? T('Lesemodus', 'Reader') : null, relTime(r.addedAt, B.lang)].filter(Boolean).join(' · ')),
        h('span.br-bar-track', h('i', { style: { width: Math.round((r.progress || 0) * 100) + '%' } })))))));
  }
  const marks = d.bookmarks.slice(0, 12);
  sections.push(h('section.br-start-sec',
    h('h2', h('span', { html: icon(marks.length ? 'bookmark' : 'star') }), marks.length ? T('Lesezeichen', 'Bookmarks') : T('Vorschläge', 'Suggestions'),
      marks.length ? h('button.br-linkbtn', { type: 'button', onclick: () => B.openSheet('library', { tab: 'bookmarks' }) }, T('Alle anzeigen', 'Show all')) : null),
    h('div.br-tiles', (marks.length ? marks : SUGGESTIONS).map((b) => tile(b)))));
  const recent = d.history.slice(0, 8);
  if (recent.length) {
    sections.push(h('section.br-start-sec',
      h('h2', h('span', { html: icon('clock') }), T('Zuletzt besucht', 'Recently visited'),
        h('button.br-linkbtn', { type: 'button', onclick: () => B.openSheet('library', { tab: 'history' }) }, T('Verlauf', 'History'))),
      h('div.br-rows', recent.map((e) => h('a.br-row', linkProps(e.url),
        h('span.br-mono.small', monogram(e.title, e.url)),
        h('span.br-row-title', e.title || hostOf(e.url)),
        h('span.br-row-meta', hostOf(e.url) + ' · ' + relTime(e.at, B.lang)))))));
  }
  const closed = d.closed.slice(0, 5);
  if (closed.length) {
    sections.push(h('section.br-start-sec',
      h('h2', h('span', { html: icon('restore') }), T('Zuletzt geschlossen', 'Recently closed')),
      h('div.br-rows', closed.map((c) => h('a.br-row', { href: c.url, onclick: (e) => { e.preventDefault(); B.restoreClosed(c.url, { here: true }); } },
        h('span.br-mono.small', monogram(c.title, c.url)),
        h('span.br-row-title', c.title || hostOf(c.url)),
        h('span.br-row-meta', hostOf(c.url) + ' · ' + relTime(c.at, B.lang)))))));
  }
  el.append(h('div.br-start-inner',
    h('header.br-start-head',
      h('h1', T('Lesebrowser', 'Reading browser')),
      h('p', T('Seiten werden geblättert, der Lesemodus zeigt nur den Text, und gespeicherte Seiten stehen als Buch im Regal.', 'Pages turn like book pages, reader mode shows just the text, and saved pages stand on the shelf as books.'))),
    h('div.br-start-search', h('span.br-start-ico', { html: icon('search') }), input, engine),
    ...sections,
    h('p.br-start-keys', T('Tasten: Leertaste blättert · R Lesemodus · Strg+T neuer Tab · Strg+L Adresse · Strg+D Lesezeichen · Strg+F Suchen', 'Keys: Space turns the page · R reader · Ctrl+T new tab · Ctrl+L address · Ctrl+D bookmark · Ctrl+F find'))));
  return input;
}
