// Fernleihe / online catalog: a card-catalog cabinet (drawers = free sources such as Project Gutenberg,
// Wikisource, Wikibooks, Internet Archive, LibriVox …) and a desk with index-card results. Books can be
// downloaded straight into the library folder (auto-shelved by the scanner), read at once or – for
// audiobooks – handed to the podcast player. Backend: electron/catalog (IPC catalog:*).
import { h, clear } from '../../core/dom.js';
import { tr, i18n } from '../../core/i18n.js';
import { makeTypographicCover } from '../../core/cover-art.js';
import { createNavHistory } from '../nav-history.js';

const CSS_HREF = './styles/catalog.css';
const COVER_RETRIES = 2;          // a failed cover request is retried before the card gives up
const SUBJECTS_SHOWN = 6;
function ensureCss() {
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => /catalog\.css/.test(l.getAttribute('href') || ''))) return;
  document.head.appendChild(h('link', { rel: 'stylesheet', href: CSS_HREF, id: 'cat-css' }));
}

const KIND_ICON = { audiobook: '🎧', paper: '📄', wiki: '🖋️', web: '🌐', book: '📖' };
const LANG_LABEL = { de: 'DE', en: 'EN', fr: 'FR', es: 'ES', it: 'IT', la: 'LA', nl: 'NL', pt: 'PT', ru: 'RU', el: 'EL' };
const FORMAT_LABEL = { epub: 'EPUB', pdf: 'PDF', mobi: 'MOBI', html: 'HTML', txt: 'TXT', auto: 'EPUB/PDF', 'audio-rss': 'Podcast' };
// numbers in the language of the interface (the English catalogue showed German thousands separators and decimal commas)
const locale = () => (i18n.lang === 'en' ? 'en-GB' : 'de-DE');
const fmtNum = (n) => Number(n).toLocaleString(locale());
const fmtBytes = (n) => (n == null ? '' : n > 1e6 ? (n / 1e6).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' MB' : n > 1e3 ? Math.round(n / 1e3) + ' kB' : n + ' B');
/** append children, skipping null/false (the DOM's own append() would insert the text "null") */
const put = (el, ...kids) => { for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.appendChild(k instanceof Node ? k : document.createTextNode(String(k))); return el; };
const hashHue = (s) => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 360; };

/** Public entry: full panel (paper frame, close button). */
export async function mount(container, ctx, params = {}) {
  ensureCss();
  const panel = h('div.panel.paper.cat-panel');
  container.appendChild(panel);
  return build(panel, ctx, params, { embedded: false });
}
/** Embeddable variant (e.g. inside the computer terminal): no frame, no close button. */
export async function mountEmbedded(container, ctx, params = {}) {
  ensureCss();
  const root = h('div.cat-panel.cat-embedded');
  container.appendChild(root);
  return build(root, ctx, params, { embedded: true });
}

function build(panel, ctx, params, { embedded }) {
  const { api, bus } = ctx;
  const T = (de, en, vars) => tr({ de, en }, vars);
  const sfx = (n) => { try { ctx.audio?.sfx?.(n); } catch {} };
  const toast = (m) => ctx.toast?.(m);
  // the mock API exposes a fixture-backed `catalog` namespace; Electron routes through the generic invoke/on
  const rpc = (ch, ...a) => (api.catalog?.invoke ? api.catalog.invoke(ch, ...a) : api.invoke(ch, ...a));
  const listen = (ch, fn) => (api.catalog?.on ? api.catalog.on(ch, fn) : api.on(ch, fn));

  const st = {
    sources: [], source: null, query: params.query || '', lang: 'all', langAuto: false, browseId: null, mode: 'browse',
    items: [], total: null, page: 1, hasMore: false, cont: null, loading: false, loadingMore: false, error: null, note: null, token: 0,
    jobs: {}, expanded: new Set(), subjectsOpen: new Set(), reading: null, readingItem: null, cards: new Map(), offs: [],
    covers: new Map(),
  };

  // ---- back and forward: every drawer, shelf chip, search and language is a step ----------------------
  let restoring = false;
  const snapshot = () => ({ source: st.source, lang: st.lang, mode: st.mode, browseId: st.mode === 'browse' ? st.browseId : null, query: st.mode === 'search' ? st.query : '' });
  const hist = createNavHistory({ onGo: (s) => restore(s) });
  const navBtns = hist.buttons();
  const record = () => { if (!restoring && st.source) hist.push(snapshot()); };
  function restore(s) {
    if (!s) return;
    restoring = true;
    try {
      st.source = s.source; st.lang = s.lang || 'all'; st.langAuto = false; st.query = s.query || '';
      st.items = []; st.error = null; st.total = null; st.cont = null;
      if (st.reading) hideReading();
      renderCabinet(); renderDeskHead(); renderChips();
      if (s.mode === 'search' && s.query) search(); else browse(s.browseId || defaultBrowse());
    } finally { restoring = false; }
  }

  // ---- skeleton ------------------------------------------------------------------------------------
  const header = h('div.cat-header');
  const cabinet = h('aside.cat-cabinet');
  const desk = h('section.cat-desk');
  const deskHead = h('div.cat-desk-head');
  const chips = h('div.cat-chips');
  const results = h('div.cat-results');
  const foot = h('div.cat-foot');
  const readingLayer = h('div.cat-reading', { hidden: true });
  desk.append(deskHead, chips, results, foot, readingLayer);
  panel.append(header, h('div.cat-body', cabinet, desk));

  function renderHeader() {
    clear(header);
    put(header, 
      navBtns,
      h('div.cat-brand', h('span.cat-brand-orn', '❦'), h('div', h('div.cat-brand-title', T('Fernleihe', 'Interlibrary Loan')), h('div.cat-brand-sub', T('Online-Katalog · freie Bibliotheken der Welt', 'Online catalogue · free libraries of the world')))),
      h('div.cat-plaque', T('Auskunft', 'Reference desk')),
      h('span.spacer'),
      Object.keys(st.jobs).some((k) => st.jobs[k] && !st.jobs[k].done) ? h('span.cat-hdr-busy', h('span.cat-spinner.small'), T('Wird geladen …', 'Downloading …')) : null,
      h('button.btn.small', { title: T('Den Lesebrowser öffnen (mit Lesemodus)', 'Open the reading browser (with reader mode)'), onclick: () => openBrowser(currentSource()?.urlInput && input?.value ? input.value : undefined) }, '🕮 ', T('Lesebrowser', 'Reading browser')),
      embedded ? null : h('button.btn.small.icon', { title: T('Schließen', 'Close'), onclick: () => ctx.close() }, '✕'),
    );
  }

  // ---- cabinet (source drawers) --------------------------------------------------------------------
  function renderCabinet() {
    clear(cabinet);
    cabinet.appendChild(h('div.cat-cabinet-title', T('Karteikästen', 'Card drawers')));
    const groups = [['books', T('Bücher', 'Books')], ['wiki', T('Wikis', 'Wikis')], ['academic', T('Wissenschaft', 'Academic')], ['audiobooks', T('Hörbücher', 'Audiobooks')]];
    for (const [kind, label] of groups) {
      const list = st.sources.filter((s) => (s.kind || 'books') === kind);
      if (!list.length) continue;
      cabinet.appendChild(h('div.cat-cabinet-group', label));
      for (const s of list) {
        cabinet.appendChild(h('button.cat-drawer', { class: s.id === st.source ? 'active' : '', title: tr(s.description), onclick: () => selectSource(s.id) },
          h('span.cat-drawer-plate', h('span.cat-drawer-icon', s.icon || '📚'), h('span.cat-drawer-name', s.name), h('span.cat-drawer-langs', (s.lang || []).slice(0, 3).map((l) => LANG_LABEL[l] || l.toUpperCase()).join(' · '))),
          h('span.cat-drawer-handle')));
      }
    }
  }

  // ---- desk head: source info + search -------------------------------------------------------------
  let input, langSel;
  function renderDeskHead() {
    clear(deskHead);
    const s = currentSource();
    if (!s) return;
    const wiki = s.kind === 'wiki';
    const langs = wiki ? ['de', 'en'] : ['all', 'de', 'en'];
    if (wiki && st.lang === 'all') { st.lang = i18n.lang === 'en' ? 'en' : 'de'; st.langAuto = true; }
    else if (!wiki && st.langAuto) { st.lang = 'all'; st.langAuto = false; }
    input = h('input.input.cat-search', { value: st.query, placeholder: s.urlInput ? T('https://… Adresse einer Seite oder eines Werks einfügen', 'https://… paste the address of a page or work') : T('Titel, Autor oder Thema in {name} suchen …', 'Search {name} by title, author or topic …', { name: s.name }), autocomplete: 'off', spellcheck: false, type: s.urlInput ? 'url' : 'search' });
    langSel = h('select.input.cat-lang', { title: T('Sprache', 'Language'), onchange: () => { st.lang = langSel.value; sfx('click'); rerun(); } },
      langs.map((l) => h('option', { value: l, selected: st.lang === l }, l === 'all' ? T('Alle Sprachen', 'All languages') : l === 'de' ? 'Deutsch' : 'English')));
    const form = h('form.cat-search-row', { onsubmit: (e) => { e.preventDefault(); st.query = input.value.trim(); if (st.query) search(); else browse(st.browseId || defaultBrowse()); } },
      h('span.cat-search-icon', '🔍'), input, s.urlInput ? null : langSel,
      h('button.btn.primary.small', { type: 'submit' }, s.urlInput ? T('Als Buch öffnen', 'Open as book') : T('Suchen', 'Search')),
      st.query ? h('button.btn.small.ghost', { type: 'button', title: T('Suche leeren', 'Clear search'), onclick: () => { st.query = ''; input.value = ''; browse(st.browseId || defaultBrowse()); } }, '✕') : null);
    put(deskHead, 
      h('div.cat-source-line', h('span.cat-source-icon', s.icon || '📚'), h('div', h('div.cat-source-name', s.name), h('div.cat-source-desc', tr(s.description)))),
      form,
    );
  }

  function renderChips() {
    clear(chips);
    const s = currentSource();
    if (!s) return;
    chips.appendChild(h('span.cat-chips-label', T('Stöbern:', 'Browse:')));
    for (const b of s.browse || []) {
      chips.appendChild(h('button.cat-chip', { class: st.mode === 'browse' && st.browseId === b.id ? 'active' : '', onclick: () => { st.query = ''; if (input) input.value = ''; sfx('click'); browse(b.id); } }, typeof b.label === 'string' ? b.label : tr(b.label)));
    }
  }

  // ---- results --------------------------------------------------------------------------------------
  function renderResults() {
    clear(results); st.cards.clear();
    const s = currentSource();
    if (st.loading && !st.items.length) {
      results.appendChild(h('div.cat-state', h('div.cat-spinner'), h('p', T('Die Bibliothekarin blättert durch die Karteikästen …', 'The librarian is leafing through the drawers …')),
        st.slow ? h('p.cat-slow', T('{s} antwortet langsam. Manche Server brauchen bis zu einer halben Minute.', '{s} is answering slowly. Some servers take up to half a minute.', { s: s?.name || T('Die Quelle', 'The source') })) : null));
      renderFoot(); return;
    }
    if (st.error && !st.items.length) {
      const offline = /ENOTFOUND|ECONN|network|fetch failed|timeout|offline|getaddrinfo/i.test(st.error);
      results.appendChild(h('div.cat-state', h('div.cat-state-icon', offline ? '🔌' : '⚠️'), h('p', offline ? T('Keine Verbindung zur Quelle. Bitte die Internetverbindung prüfen.', 'No connection to the source – are you online?') : T('Da ist etwas schiefgegangen.', 'Something went wrong.')), h('p.cat-err', st.error), h('button.btn', { onclick: rerun }, T('Erneut versuchen', 'Try again'))));
      renderFoot(); return;
    }
    if (!st.items.length) {
      results.appendChild(h('div.cat-state', h('div.cat-state-icon', s?.urlInput ? '🌐' : '🗃️'), h('p', st.note || (s?.urlInput ? T('Oben eine Adresse einfügen, die Seite wird als Buch aufbereitet.', 'Paste an address above – the page is turned into a book.') : st.mode === 'search' ? T('Nichts gefunden. Andere Wörter oder eine andere Quelle helfen.', 'Nothing found. Try other words or another drawer.') : T('Diese Schublade ist leer.', 'This drawer is empty.')))));
      renderFoot(); return;
    }
    if (st.note) results.appendChild(h('div.cat-note', '☞ ', st.note));
    for (const it of st.items) results.appendChild(card(it));
    renderFoot();
  }

  function renderFoot() {
    clear(foot);
    if (!st.items.length) return;
    const n = st.items.length;
    put(foot, h('span.cat-count', st.total != null && st.total > n ? T('{n} von {t} Einträgen', '{n} of {t} entries', { n, t: st.total.toLocaleString(i18n.lang === 'de' ? 'de-DE' : 'en-GB') }) : T('{n} Einträge', '{n} entries', { n })));
    if (st.hasMore) put(foot, h('button.btn', { disabled: st.loadingMore, onclick: loadMore }, st.loadingMore ? h('span.cat-spinner.small') : '⤓ ', T('Mehr laden', 'Load more')));
  }

  function card(it) {
    const kindIcon = KIND_ICON[it.kind] || KIND_ICON.book;
    const downloadable = it.formats.filter((f) => f.type !== 'audio-rss');
    const audio = it.formats.find((f) => f.type === 'audio-rss');
    const expanded = st.expanded.has(it.id);
    const desc = it.description || '';
    const meta = [];
    if (it.year) meta.push(it.year);
    if (it.language) meta.push(LANG_LABEL[it.language] || it.language.toUpperCase());
    if (it.meta?.hours) meta.push(T('{h} Std.', '{h} h', { h: it.meta.hours }));
    if (it.meta?.sections) meta.push(T('{n} Abschnitte', '{n} sections', { n: it.meta.sections }));
    if (it.meta?.words) meta.push(T('{n} Wörter', '{n} words', { n: fmtNum(it.meta.words) }));
    if (it.meta?.pages) meta.push(T('{n} S.', '{n} pp.', { n: it.meta.pages }));
    if (it.meta?.publisher) meta.push(it.meta.publisher);
    if (it.downloads != null) meta.push('⤓ ' + fmtNum(it.downloads));
    if (it.license) meta.push(it.license);

    let fmtSel = null;
    // Gutenberg names its format in German (electron/catalog/sources/gutenberg.js): the English interface says it in English
    const fmtLabel = (f) => (f.label === 'EPUB (mit Bildern)' ? T('EPUB (mit Bildern)', 'EPUB (with images)') : f.label || FORMAT_LABEL[f.type] || f.type);
    if (downloadable.length > 1) fmtSel = h('select.input.cat-fmt', { title: T('Format', 'Format') }, downloadable.map((f, i) => h('option', { value: String(it.formats.indexOf(f)), selected: i === 0 }, fmtLabel(f) + (f.size ? ' · ' + fmtBytes(f.size) : ''))));
    const actions = h('div.cat-card-actions');
    if (downloadable.length) put(actions, fmtSel, h('button.btn.primary.small', { onclick: () => download(it, fmtSel ? parseInt(fmtSel.value, 10) : it.formats.indexOf(downloadable[0])) }, '⤓ ', T('In die Bücherei laden', 'Add to library')));
    // "Lesen" on every card: either the text is read directly, or the file is fetched and opened in the reader
    if (it.canRead || downloadable.length) {
      const direct = !!it.canRead;
      put(actions, h('button.btn.small', {
        title: direct ? T('Den Text sofort in Cozy Shelves aufschlagen', 'Open the text in the reading room right away') : T('Wird geladen und dann in Cozy Shelves geöffnet', 'Downloaded, then opened in the reading room'),
        onclick: () => readNow(it, fmtSel ? parseInt(fmtSel.value, 10) : (downloadable[0] ? it.formats.indexOf(downloadable[0]) : 0)),
      }, '📖 ', T('Jetzt lesen', 'Read now')));
    }
    if (audio) put(actions, h('button.btn.primary.small', { onclick: () => listenNow(it, audio) }, '🎧 ', T('Im Podcast-Player anhören', 'Listen in the podcast player')));
    if (it.readOnlineUrl) put(actions, h('button.btn.small.ghost', { title: it.readOnlineUrl, onclick: () => openBrowser(it.readOnlineUrl) }, '🕮 ', T('Im Lesebrowser öffnen', 'Open in the reading browser')));
    const progress = h('div.cat-progress', { hidden: true });
    const cover = coverFor(it);
    const el = h('article.cat-card', { dataset: { id: it.id } },
      h('div.cat-card-cover', cover, h('span.cat-card-kind', { title: it.kind }, kindIcon)),
      h('div.cat-card-body',
        h('div.cat-card-head', h('h3.cat-card-title', it.title), it.author ? h('div.cat-card-author', it.author) : null),
        meta.length ? h('div.cat-card-meta', meta.map((m, i) => [i ? h('span.cat-dot', '·') : null, h('span', m)])) : null,
        desc ? h('p.cat-card-desc', { class: expanded ? 'open' : '' }, desc, desc.length > 220 ? h('button.cat-more', { onclick: (e) => { e.preventDefault(); if (expanded) st.expanded.delete(it.id); else st.expanded.add(it.id); el.replaceWith(card(it)); } }, expanded ? T(' weniger', ' less') : T(' mehr', ' more')) : null) : null,
        subjects(it, () => el.replaceWith(card(it))),
        actions, progress,
      ));
    st.cards.set(it.id, { el, progress, actions });
    if (st.jobs[it.id]) updateProgress(it.id);
    return el;
  }

  /** Subject chips: the first few, the rest behind a "+N" chip (Open Library ships dozens). */
  function subjects(it, rerender) {
    const all = it.subjects || [];
    if (!all.length) return null;
    const open = st.subjectsOpen.has(it.id);
    const shown = open ? all : all.slice(0, SUBJECTS_SHOWN);
    const box = h('div.cat-card-subjects', { class: open ? 'open' : '' }, shown.map((s) => h('span.cat-tag', s)));
    if (all.length > SUBJECTS_SHOWN) {
      box.appendChild(h('button.cat-tag.cat-tag-more', {
        title: open ? T('Weniger Schlagwörter', 'Fewer subjects') : T('Alle Schlagwörter zeigen', 'Show all subjects'),
        onclick: () => { if (open) st.subjectsOpen.delete(it.id); else st.subjectsOpen.add(it.id); sfx('click'); rerender(); },
      }, open ? T('weniger', 'less') : `+${all.length - SUBJECTS_SHOWN}`));
    }
    return box;
  }

  /** A card is never empty: the coloured tile shows at once, a failed <img> is retried twice and a
   *  source without any cover gets a typographic one (core/cover-art.js). */
  function coverFor(it) {
    const wrap = h('div.cat-cover-wrap');
    const ph = placeholder(it);
    wrap.appendChild(ph);
    if (!it.cover) { typographicCover(it, ph); return wrap; }
    // NB: the image must not be display:none while it loads – Chromium never starts a lazy load for a
    // hidden image. It is laid over the tile and only faded in once it really arrived.
    const img = h('img.cat-cover', { src: it.cover, alt: '', loading: 'lazy', style: { opacity: '0' } });
    let tries = 0;
    img.addEventListener('load', () => { if (img.naturalWidth < 2) return; img.style.opacity = '1'; ph.style.display = 'none'; });
    img.addEventListener('error', () => {
      img.style.opacity = '0'; ph.style.display = '';
      if (tries < COVER_RETRIES) {
        const wait = tries === 0 ? 1000 : 4000;
        tries++;
        setTimeout(() => { if (img.isConnected) img.src = it.cover + (it.cover.includes('?') ? '&' : '?') + 'lsr=' + tries; }, wait);
      } else { img.remove(); typographicCover(it, ph); }
    });
    wrap.appendChild(img);
    return wrap;
  }

  async function typographicCover(it, ph) {
    const key = it.id;
    try {
      if (!st.covers.has(key)) st.covers.set(key, makeTypographicCover(it.title, it.author || '', 'catalog:' + it.id));
      const { dataUrl } = await st.covers.get(key);
      if (!ph.isConnected || !dataUrl) return;
      ph.replaceWith(h('img.cat-cover', { src: dataUrl, alt: '' }));
    } catch { /* the coloured tile stays */ }
  }

  function placeholder(it) {
    const words = String(it.title || '?').replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean);
    const initials = (words.slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase();
    return h('div.cat-cover-ph', { style: `--hue:${hashHue(it.id)}` }, h('span.cat-cover-ini', initials), h('span.cat-cover-ti', it.title.slice(0, 40)));
  }

  function updateProgress(id) {
    const c = st.cards.get(id); const j = st.jobs[id];
    if (!c) return;
    if (!j) { c.progress.hidden = true; return; }
    clear(c.progress); c.progress.hidden = false;
    if (j.error) { put(c.progress, h('span.cat-prog-err', '⚠ ', j.error)); c.actions.classList.remove('busy'); return; }
    if (j.done) { put(c.progress, h('span.cat-prog-done', '✓ ', j.existed ? T('Schon im Regal: ', 'Already shelved: ') : T('Steht jetzt im Regal: ', 'Now on the shelf: '), h('span.cat-path', j.path || ''))); c.actions.classList.remove('busy'); return; }
    c.actions.classList.add('busy');
    const pct = j.total ? Math.min(100, Math.round((j.received / j.total) * 100)) : null;
    const phase = j.phase === 'pages' ? T('{n} Seiten geholt …', '{n} pages fetched …', { n: j.pages || j.received || 0 }) : j.phase === 'build' ? T('EPUB wird gebunden …', 'Binding the EPUB …') : j.phase === 'fetch' ? T('Text wird geholt …', 'Fetching the text …') : j.reading ? T('Wird aufgeschlagen …', 'Opening …') : pct != null ? `${pct} % · ${fmtBytes(j.received)} / ${fmtBytes(j.total)}` : fmtBytes(j.received) + ' …';
    put(c.progress, h('div.progress-bar', { class: pct == null ? 'indet' : '' }, h('i', { style: { width: (pct ?? 40) + '%' } })), h('span.cat-prog-text', phase));
  }

  // ---- data ------------------------------------------------------------------------------------------
  const currentSource = () => st.sources.find((s) => s.id === st.source) || null;
  const defaultBrowse = () => currentSource()?.browse?.[0]?.id || null;
  const langOpt = () => (st.lang === 'all' ? null : st.lang);

  async function run(fetcher, { append = false } = {}) {
    const token = ++st.token;
    if (append) st.loadingMore = true; else { st.loading = true; st.error = null; st.note = null; if (!append) st.items = []; }
    st.slow = false;
    renderChips(); renderResults();
    // arXiv, OAPEN and Wikisource can take half a minute: say so instead of spinning silently
    const slowTimer = setTimeout(() => { if (token === st.token && st.loading) { st.slow = true; renderResults(); } }, 8000);
    try {
      const r = await fetcher();
      if (token !== st.token) return;
      const items = (r?.items || []).filter((x) => x && x.id);
      st.items = append ? [...st.items, ...items.filter((x) => !st.items.some((y) => y.id === x.id))] : items;
      st.total = r?.total ?? null; st.hasMore = !!r?.hasMore; st.cont = r?.cont || null; st.note = r?.note || null; st.page = r?.page || st.page;
    } catch (e) {
      if (token !== st.token) return;
      st.error = e?.message || String(e);
      if (!append) st.items = [];
      else toast(T('Nachladen fehlgeschlagen: ', 'Loading more failed: ') + st.error);
    }
    clearTimeout(slowTimer);
    st.loading = false; st.loadingMore = false; st.slow = false;
    renderResults();
  }
  function search() { st.mode = 'search'; st.page = 1; sfx('type'); record(); run(() => rpc('catalog:search', st.source, st.query, { lang: langOpt(), page: 1 })); }
  function browse(id) { st.mode = 'browse'; st.browseId = id; st.page = 1; record(); run(() => rpc('catalog:browse', st.source, id, { lang: langOpt(), page: 1 })); }
  function rerun() { renderDeskHead(); if (st.mode === 'search' && st.query) search(); else browse(st.browseId || defaultBrowse()); }
  function loadMore() {
    const page = st.page + 1; st.page = page; sfx('page');
    run(() => (st.mode === 'search' ? rpc('catalog:search', st.source, st.query, { lang: langOpt(), page }) : rpc('catalog:browse', st.source, st.browseId, { lang: langOpt(), page, cont: st.cont })), { append: true });
  }
  function selectSource(id) {
    if (id === st.source) return;
    st.source = id; st.browseId = null; st.items = []; st.error = null; st.total = null; st.cont = null;
    sfx('book-pull');
    renderCabinet(); renderDeskHead(); renderChips();
    if (st.query && currentSource()?.canSearch && !currentSource()?.urlInput) search(); else browse(defaultBrowse());
    setTimeout(() => input?.focus(), 50);
  }

  // ---- actions ---------------------------------------------------------------------------------------
  async function download(it, formatIndex, { silent = false } = {}) {
    if (st.jobs[it.id] && !st.jobs[it.id].done) return null;
    sfx('click');
    st.jobs[it.id] = { received: 0, total: it.formats[formatIndex]?.size || null, done: false }; updateProgress(it.id); renderHeader();
    let result = null;
    try {
      const r = await rpc('catalog:download', it, formatIndex);
      st.jobs[it.id] = { ...(st.jobs[it.id] || {}), done: true, path: r?.path, existed: !!r?.existed, bookId: r?.bookId };
      sfx('book-place');
      if (!silent) toast(r?.existed ? T('„{t}“ steht schon im Regal.', '“{t}” is already on the shelf.', { t: it.title }) : T('„{t}“ steht jetzt im Regal.', '“{t}” is now on the shelf.', { t: it.title }));
      bus.emit('catalog:downloaded', { path: r?.path, item: it, existed: !!r?.existed, bookId: r?.bookId });
      result = r || null;
    } catch (e) {
      st.jobs[it.id] = { done: true, error: e?.message || String(e) };
      sfx('error');
      toast(T('Laden fehlgeschlagen: ', 'Download failed: ') + (e?.message || e));
    }
    updateProgress(it.id); renderHeader();
    return result;
  }

  /** "Jetzt lesen": read the text directly, or fetch the file and open it in the reader. */
  async function readNow(it, formatIndex = 0) {
    if (st.jobs[it.id] && !st.jobs[it.id].done) return;
    if (!it.canRead) return readDownloaded(it, formatIndex);
    sfx('page');
    st.jobs[it.id] = { reading: true, done: false }; updateProgress(it.id);
    try {
      const r = await rpc('catalog:readHtml', it, { chapters: 'all' });
      if (!r || !r.html) throw new Error(T('Kein lesbarer Text erhalten', 'No readable text received'));
      const payload = { title: r.title || it.title, author: r.author || it.author || null, html: r.html, source: currentSource()?.name || it.source, url: r.url || it.readOnlineUrl, language: r.language || it.language || null, chapters: r.chapters || [], item: it };
      delete st.jobs[it.id]; updateProgress(it.id);
      // the main app wires this event to the reader; without a listener (dev harness) we show the text inline
      const handled = bus.map?.get?.('book:open-external')?.size > 0;
      bus.emit('book:open-external', payload);
      if (!handled) showReading(payload);
    } catch (e) {
      st.jobs[it.id] = { done: true, error: e?.message || String(e) }; updateProgress(it.id);
      sfx('error'); toast(T('Aufschlagen fehlgeschlagen: ', 'Could not open: ') + (e?.message || e));
    }
  }

  /** Sources without an online full text (OAPEN, Standard Ebooks fallback, scans …): load the file
   *  into the library and open it in the reader – the download returns the library id for that. */
  async function readDownloaded(it, formatIndex) {
    const r = await download(it, formatIndex, { silent: true });
    if (!r || !r.path) return;
    const id = r.bookId;
    if (!id) { toast(T('„{t}“ steht im Regal und ist in Cozy Shelves zu finden.', '“{t}” is on the shelf – find it in the reading room.', { t: it.title })); return; }
    sfx('book-pull');
    toast(T('„{t}“ wird aufgeschlagen …', 'Opening “{t}” …', { t: it.title }));
    // wait until the scanner has picked the new file up (it is watched, a rescan only hurries it along)
    let book = null;
    for (let i = 0; i < 20 && !book; i++) {
      try { book = await api.library?.book?.(id); } catch {}
      if (book) break;
      if (i === 2) { try { await api.library?.rescan?.(); } catch {} }
      await new Promise((res) => setTimeout(res, 700));
    }
    if (!book) { toast(T('„{t}“ steht im Regal. Der Scanner braucht noch einen Moment.', '“{t}” is on the shelf – the scanner needs a moment.', { t: it.title })); return; }
    // the bus event borrows the book and opens the reader; if the world has not caught up with the new
    // book yet, open the reader panel directly (it fetches the record itself)
    const before = document.querySelector('.rd-root');
    bus.emit('book:open', { id });
    setTimeout(() => { if (document.querySelector('.rd-root') === before) ctx.openPanel('reader', { id }); }, 700);
  }

  async function listenNow(it, audio) {
    sfx('click');
    try {
      await api.podcasts.subscribe(audio.url, { title: it.title, author: it.author, artwork: it.cover, homepage: it.readOnlineUrl });
      toast(T('Hörbuch abonniert, der Podcast-Player öffnet sich.', 'Audiobook subscribed – opening the podcast player.'));
      ctx.openPanel('podcasts', { feedUrl: audio.url, title: it.title });
    } catch (e) { sfx('error'); toast(T('Abonnieren fehlgeschlagen: ', 'Subscribing failed: ') + (e?.message || e)); }
  }

  // ---- in-app browser --------------------------------------------------------------------------------
  /** Open a page in the reading browser panel (never in the system browser). It stacks on the Fernleihe,
   *  Esc leads back here. Without a URL the browser starts on its home page. */
  async function openBrowser(url) {
    sfx('click');
    try { await ctx.openPanel('browser', url ? { url } : {}); }
    catch (e) { toast(T('Der Lesebrowser konnte nicht geöffnet werden: ', 'The reading browser could not be opened: ') + (e?.message || e)); }
  }

  // ---- inline reading view (fallback / preview) -------------------------------------------------------
  function showReading(p) {
    st.reading = p;
    clear(readingLayer); readingLayer.hidden = false;
    const body = h('div.cat-reading-body', { html: p.html });
    for (const a of body.querySelectorAll('a[href]')) a.addEventListener('click', (e) => { e.preventDefault(); openBrowser(a.getAttribute('href')); });
    const chapSel = p.chapters?.length > 1 ? h('select.input.cat-fmt', { onchange: (e) => { const t = body.querySelector('#' + CSS.escape(e.target.value)); t?.scrollIntoView({ block: 'start' }); } }, p.chapters.map((c) => h('option', { value: c.id }, c.title))) : null;
    put(readingLayer, 
      h('div.cat-reading-head',
        h('div', h('div.cat-reading-title', p.title), p.author ? h('div.cat-reading-author', p.author) : null),
        h('span.spacer'), chapSel,
        p.item?.formats?.some((f) => f.type === 'epub') ? h('button.btn.small', { onclick: () => { download(p.item, p.item.formats.findIndex((f) => f.type === 'epub')); } }, '⤓ ', T('Als EPUB ins Regal', 'Shelve as EPUB')) : null,
        p.url ? h('button.btn.small.ghost', { title: T('Im Lesebrowser öffnen', 'Open in the reading browser'), onclick: () => openBrowser(p.url) }, '↗') : null,
        h('button.btn.small.icon', { title: T('Zurück zum Katalog', 'Back to the catalogue'), onclick: hideReading }, '✕')),
      body,
      h('div.cat-reading-foot', p.source ? T('Quelle: {s}', 'Source: {s}', { s: p.source }) : null),
    );
    readingLayer.scrollTop = 0;
  }
  function hideReading() { st.reading = null; readingLayer.hidden = true; clear(readingLayer); }

  // ---- progress events + lifecycle ---------------------------------------------------------------------
  st.offs.push(listen('catalog:progress', (p) => {
    if (!p || !p.id) return;
    const prev = st.jobs[p.id] || {};
    st.jobs[p.id] = { ...prev, ...p, reading: false };
    updateProgress(p.id);
    if (p.done) renderHeader();
  }));
  st.offs.push(bus.on('i18n:change', () => { if (input) st.query = input.value.trim(); renderHeader(); renderCabinet(); renderDeskHead(); renderChips(); renderResults(); }));

  (async () => {
    renderHeader(); renderCabinet();
    results.appendChild(h('div.cat-state', h('div.cat-spinner'), h('p', T('Die Karteikästen werden geöffnet …', 'Opening the card drawers …'))));
    try { st.sources = (await rpc('catalog:sources')) || []; }
    catch (e) { st.sources = []; st.error = e?.message || String(e); }
    if (!st.sources.length) { clear(results); results.appendChild(h('div.cat-state', h('div.cat-state-icon', '🗃️'), h('p', T('Der Katalog ist nicht verfügbar.', 'The catalogue is not available.')), st.error ? h('p.cat-err', st.error) : null)); return; }
    st.source = st.sources.some((s) => s.id === params.source) ? params.source : st.sources[0].id;
    if (params.lang) st.lang = params.lang;
    renderCabinet(); renderDeskHead(); renderChips();
    if (st.query) search(); else browse(defaultBrowse());
    setTimeout(() => input?.focus(), 80);
  })();

  return {
    unmount() { for (const off of st.offs) { try { off?.(); } catch {} } st.token++; navBtns.dispose?.(); },
    /** the mouse's side buttons (panels.js) */
    onNav(dir) { hist.go(dir); return true; },
    onKey(e) {
      if (hist.onKey(e)) return true;
      if (e.key === 'Escape' && st.reading) { hideReading(); return true; }
      if (e.key === 'Escape' && document.activeElement === input && input.value) { input.value = ''; return true; }
      if (e.key === '/' && document.activeElement !== input) { input?.focus(); return true; }
      return false;
    },
  };
}
