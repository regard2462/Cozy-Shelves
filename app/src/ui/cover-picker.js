// The cover in the book info card: where it comes from, and "Anderes Cover" (another cover): the pictures the book
// catalogues have of this book (Open Library, Goodreads, Apple Books, the DNB, Amazon, the Internet Archive, Google
// Books), on request those of an image search
// (Bing, Yandex, DuckDuckGo), a picture of the reader's own ("Eigenes Bild wählen"), the generated title card and the
// book's own page 1. The choice is permanent: no search in the background replaces it (electron/library/web-covers.js).
import { h } from '../core/dom.js';
import { tr } from '../core/i18n.js';
import { typoCoverUrl } from '../core/cover-art.js';

const T = (de, en, vars) => tr({ de, en }, vars);
/** The catalogues by name. */
export function sourceName(source) {
  return { openlibrary: 'Open Library', apple: 'Apple Books', dnb: T('Deutsche Nationalbibliothek', 'German National Library'), google: 'Google Books', goodreads: 'Goodreads', amazon: 'Amazon', archive: 'Internet Archive', duckduckgo: 'DuckDuckGo', bing: 'Bing', yandex: 'Yandex' }[source] || '';
}
const CATALOGUES = ['openlibrary', 'apple', 'dnb', 'google', 'goodreads', 'amazon', 'archive'];
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }

/**
 * The cover part of the info card. `getBook()` the book shown, `render()` draws the card again; `tools()` goes under
 * the cover, `panel()` below the card (null while closed), `onKey(e)` closes the choice with Escape.
 */
export function createCoverPicker({ ctx, getBook, render }) {
  const { api } = ctx;
  // null (closed) or { state: 'search'|'list'|'error', items, own, web, busyKey, note, error }
  let pick = null;

  const applyResult = (res, msg) => {
    if (res?.book) Object.assign(getBook(), res.book);
    pick = null;
    ctx.toast?.(msg);
    render();
  };

  function tools() {
    const book = getBook();
    const web = book.coverSource === 'web' && book.coverWeb;
    let from = null;
    if (web && web.via === 'file') from = h('div.rd-bi-cover-src', T('Eigenes Bild', 'Your own picture'));
    else if (web) {
      // a catalogue by its name, a picture of the image search by the website it was found on
      const name = CATALOGUES.includes(web.via) ? sourceName(web.via) : (web.site || hostOf(web.page) || hostOf(web.image));
      from = h('div.rd-bi-cover-src', T('Cover von ', 'Cover from '),
        web.page ? h('button.linkish', { type: 'button', title: web.page, onclick: () => ctx.openPanel?.('browser', { url: web.page }) }, name) : h('span', name));
    } else if (book.coverChoice === 'card') from = h('div.rd-bi-cover-src', T('Generiertes Titelbild', 'Generated title card'));
    return h('div.rd-bi-cover-tools', from,
      h('button.btn.small.ghost', { type: 'button', 'aria-expanded': pick ? 'true' : 'false', onclick: () => (pick ? close() : open(false)) }, T('Anderes Cover', 'Choose another cover')));
  }
  function close() { pick = null; render(); }
  async function open(refresh, web = false) {
    const keepItems = pick?.items && web ? pick.items : null;
    pick = { state: keepItems ? 'list' : 'search', items: keepItems || [], own: pick?.own || null, web: { state: web ? 'searching' : 'none' } };
    render();
    let res = null;
    try { res = await api.invoke('covers:candidates', getBook().id, { refresh, web }); } catch (e) { res = { ok: false, error: 'offline' }; }
    if (!pick) return;
    if (res?.ok) pick = { state: 'list', items: res.items || [], own: res.own || null, web: res.web || { state: 'none' }, offline: !!res.offline };
    else pick = { state: 'error', items: [], own: null, web: { state: 'none' }, error: res?.error || 'offline' };
    render();
  }
  async function choose(item) {
    if (!pick || pick.busyKey) return;
    pick.busyKey = item.key;
    render();
    let res = null;
    try { res = await api.invoke('covers:choose', getBook().id, item.key); } catch { res = null; }
    if (!pick) return;
    if (res?.ok) { applyResult(res, T('Neues Cover übernommen', 'New cover applied')); return; }
    if (res?.error === 'stale') { open(false); return; }
    pick.busyKey = null; pick.note = T('Das Bild ließ sich nicht laden.', 'The picture could not be loaded.');
    render();
  }
  async function ownFile() {
    if (!pick || pick.busyKey) return;
    pick.busyKey = 'file';
    render();
    let res = null;
    try { res = await api.invoke('covers:chooseFile', getBook().id); } catch { res = null; }
    if (!pick) return;
    pick.busyKey = null;
    if (res?.ok) { applyResult(res, T('Eigenes Bild übernommen', 'Your picture is the cover now')); return; }
    if (res?.error !== 'canceled') pick.note = T('Dieses Bild ließ sich nicht öffnen.', 'This picture could not be opened.');
    render();
  }
  async function titleCard() {
    let res = null;
    try { res = await api.invoke('covers:useCard', getBook().id); } catch { res = null; }
    applyResult(res, T('Das generierte Titelbild wird verwendet', 'Using the generated title card'));
  }
  async function bookCover() {
    let res = null;
    try { res = await api.invoke('covers:useBook', getBook().id); } catch { res = null; }
    applyResult(res, T('Das Cover aus dem Buch wird verwendet', 'Using the book’s own cover'));
  }

  function tile({ key, cls = '', img, label, sub, title, onclick, current = false }) {
    return h('button.rd-bi-pick-item', {
      type: 'button', class: [cls, current ? 'current' : '', pick.busyKey === key ? 'busy' : ''].filter(Boolean).join(' '),
      title: title || label || '', disabled: !!pick.busyKey, onclick, 'aria-pressed': current ? 'true' : null,
    },
    img ? h('img', { src: img, alt: '' }) : h('span.rd-bi-pick-icon', { 'aria-hidden': 'true' }, '🖼'),
    h('span.rd-bi-pick-site', label || ''),
    h('span.rd-bi-pick-count', current ? T('aktuell', 'current') : sub || ''));
  }

  function panel() {
    if (!pick) return null;
    const book = getBook();
    const head = h('div.rd-bi-pick-head', h('strong', T('Cover wählen', 'Choose a cover')), h('span.spacer'),
      h('button.btn.small.ghost', { type: 'button', onclick: close }, T('Schließen', 'Close')));
    if (pick.state === 'search') return h('div.rd-bi-pick', head, h('div.rd-bi-pick-note', T('Suche in den Buchkatalogen …', 'Searching the book catalogues …')));
    const tiles = pick.items.map((it) => tile({
      key: it.key, img: it.preview, current: it.current, onclick: () => choose(it),
      label: CATALOGUES.includes(it.source) ? sourceName(it.source) : it.site,
      sub: CATALOGUES.includes(it.source) ? it.info : it.sites > 1 ? T('auf {n} Seiten', 'on {n} sites', { n: it.sites }) : (it.engines || []).map(sourceName).join(', '),
      title: it.title,
    }));
    // what else the cover can be: a picture of the reader's own, the title card, the book's own page 1
    tiles.push(tile({ key: 'file', cls: 'rd-bi-pick-act', label: T('Eigenes Bild wählen', 'Choose your own picture'), sub: T('eine Datei', 'a file'), onclick: ownFile, current: book.coverWeb?.via === 'file' && book.coverSource === 'web' }));
    tiles.push(tile({ key: 'card', cls: 'rd-bi-pick-act', img: typoCoverUrl({ ...book, coverGenerated: true }, 220, 330), label: T('Generiertes Titelbild', 'Generated title card'), onclick: titleCard, current: book.coverChoice === 'card' }));
    if (pick.own?.preview) tiles.push(tile({ key: 'book', cls: 'rd-bi-pick-act', img: pick.own.preview, label: T('Cover aus dem Buch', 'The book’s own cover'), sub: T('Seite 1', 'page 1'), onclick: bookCover }));
    let note = pick.note || null;
    if (!note && pick.state === 'error') note = T('Keine Verbindung zu den Buchkatalogen.', 'No connection to the book catalogues.');
    if (!note && pick.offline) note = T('Ohne Internet bleiben nur das eigene Bild und das Titelbild.', 'Without internet only your own picture and the title card remain.');
    if (!note && !pick.items.length) note = T('Die Buchkataloge kennen kein passendes Bild.', 'The book catalogues know no matching picture.');
    if (!note) note = T('Vorn stehen die Bilder der Ausgabe, die am besten zum Buch passt.', 'The pictures of the edition that fits the book best come first.');
    const w = pick.web || { state: 'none' };
    const min = Math.max(1, Math.ceil((w.wait || 0) / 60000));
    const webNote = {
      searching: T('Suche im Web …', 'Searching the web …'),
      wait: T('Die Bildersuche ist in etwa {n} Minuten wieder möglich.', 'The image search is possible again in about {n} minutes.', { n: min }),
      busy: T('Die Suchmaschinen nehmen gerade keine Suche an. Später noch einmal versuchen.', 'The search engines are not taking searches right now. Try again later.'),
      offline: T('Keine Verbindung zu den Suchmaschinen.', 'No connection to the search engines.'),
      off: T('Die Bildersuche ist in den Einstellungen ausgeschaltet.', 'The image search is switched off in the settings.'),
    }[w.state] || null;
    const hasWeb = pick.items.some((it) => !CATALOGUES.includes(it.source));
    return h('div.rd-bi-pick', head,
      h('div.rd-bi-pick-note', note),
      h('div.rd-bi-pick-grid', tiles),
      webNote ? h('div.rd-bi-pick-note', webNote) : null,
      h('div.rd-bi-pick-foot',
        !hasWeb && !pick.offline ? h('button.btn.small.ghost', { type: 'button', disabled: !!pick.busyKey || w.state === 'searching', onclick: () => open(false, true) }, T('Im Web suchen', 'Search the web')) : null,
        !pick.offline ? h('button.btn.small.ghost', { type: 'button', disabled: !!pick.busyKey, onclick: () => open(true) }, T('Neu suchen', 'Search again')) : null));
  }
  return {
    tools, panel,
    get open() { return !!pick; },
    onKey(e) { if (e.key === 'Escape' && pick) { close(); return true; } return false; },
  };
}
