// Reading room newspaper: curated RSS/Atom feeds rendered as a broadsheet, full-text article view, feed management.
// Since 0.7 it shows the papers in the language of the interface; "Auch Zeitungen in anderen Sprachen"
// (settings.news.otherLanguages, a switch at the foot of the side bar) adds the others (news-lang.js). A change of the
// language or of the switch applies at once.
import { h, clear, escapeHtml } from '../../core/dom.js';
import { tr, i18n } from '../../core/i18n.js';
import { openInApp, openSystemBrowser, sanitizeFragment, interceptLinks, externalLabel } from '../reader/link-nav.js';
import { readAloudButton } from '../reader/tts-button.js';
import { createNavHistory } from '../nav-history.js';
import { feedsFor, categoriesFor, filterKey } from './news-lang.js';

const CONCURRENCY = 4;
const MAX_MERGED = 90;

const fmtDate = (ts, lang, withTime = false) => {
  if (!ts) return '';
  const d = new Date(ts);
  const loc = lang === 'de' ? 'de-DE' : 'en-GB';
  const diff = Date.now() - ts;
  if (diff < 3600e3 && diff > 0) { const m = Math.max(1, Math.round(diff / 60e3)); return tr({ de: `vor ${m} Min.`, en: `${m} min ago` }); }
  if (diff < 20 * 3600e3 && diff > 0) { const hh = Math.round(diff / 3600e3); return tr({ de: `vor ${hh} Std.`, en: `${hh} h ago` }); }
  return d.toLocaleDateString(loc, { day: 'numeric', month: 'short', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) });
};
const todayLong = (lang) => new Date().toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const catLabel = (c) => (c ? tr({ de: c.de, en: c.en }) : '');

export async function mount(container, ctx, params = {}) {
  const { api, bus } = ctx;
  const st = {
    categories: [], feeds: [], category: params.category || 'news', feedId: params.feedId || null, items: [], view: 'list', article: null, articleItem: null, index: -1,
    loading: false, error: null, loadToken: 0, artToken: 0, scroller: null, health: { running: false, done: 0, total: 0 }, dialog: null,
  };
  const read = new Set();
  let offUpdate = null, offLang = null;

  // back and forward: every section, feed and article is a step
  let restoring = false;
  const listState = () => ({ view: 'list', category: st.category, feedId: st.feedId || null });
  const hist = createNavHistory({ onGo: (e) => restore(e) });
  const navBtns = hist.buttons();
  const record = (e) => { if (!restoring) hist.push(e); };
  async function restore(e) {
    restoring = true;
    try {
      const sameList = e.category === st.category && (e.feedId || null) === (st.feedId || null);
      if (!sameList) {
        st.category = e.category; st.feedId = e.feedId || null;
        st.view = 'list'; st.article = null; st.scroller = null; ++st.artToken; aloud.stop();
        renderSide();
        const loading = loadItems();
        if (e.view !== 'article') return;
        await loading;
      } else if (e.view === 'list') { if (st.view === 'article') backToList(); return; }
      const idx = st.items.findIndex((i) => i.id === e.id);
      if (idx >= 0) openArticle(idx);
    } finally { restoring = false; }
  }

  // ---- shell ----------------------------------------------------------------------------------------
  const panel = h('div.panel.paper.news-panel');
  const masthead = h('div.news-masthead');
  const side = h('aside.news-side');
  const main = h('main.news-main');
  const progress = h('div.news-progress');
  panel.append(masthead, progress, h('div.news-body', side, main));
  container.appendChild(panel);

  const toast = (m) => ctx.toast?.(m);
  const sfx = (n) => ctx.audio?.sfx?.(n);
  // one read-aloud button for the whole panel: it survives the re-renders of an article and stops on close
  const aloud = readAloudButton({
    toast,
    getText: () => { const a = st.article || (st.articleItem ? articleFromItem(st.articleItem) : null); return a ? (a.title ? a.title + '. ' : '') + (a.textContent || '') : ''; },
    getLang: () => st.article?.lang || st.articleItem?.feedLang || 'de',
  });
  // the papers in the language of the interface (or all of them with the switch); a paper asked for by id stays
  const othersOn = () => ctx.state?.settings?.news?.otherLanguages === true;
  const shownFeeds = () => feedsFor(st.feeds, i18n.lang, othersOn(), params.feedId || null);
  const shownCats = () => categoriesFor(st.categories, shownFeeds());
  let shownKey = filterKey(i18n.lang, othersOn());
  const currentFeed = () => shownFeeds().find((f) => f.id === st.feedId) || null;
  const currentCat = () => st.categories.find((c) => c.id === st.category) || null;
  const feedsOfCat = () => shownFeeds().filter((f) => f.category === st.category);

  function renderMasthead() {
    clear(masthead);
    const lang = i18n.lang;
    const cat = currentCat(); const feed = currentFeed();
    const title = feed ? feed.title : catLabel(cat) || 'Cozy Shelves';
    const tagline = feed ? (feed.homepage ? feed.homepage.replace(/^https?:\/\//, '').replace(/\/$/, '') : '') : (cat?.tagline ? tr(cat.tagline) : '');
    const unread = feedsOfCat().reduce((a, f) => a + (f.unread || 0), 0);
    masthead.append(
      h('div.news-mast-top', h('span', todayLong(lang)), h('span.news-mast-brand', tr({ de: 'Cozy Shelves · Lesezimmer', en: 'Cozy Shelves · Reading Room' })), h('span', tr({ de: 'Ausgabe {n}', en: 'Issue {n}' }, { n: Math.floor((Date.now() - Date.UTC(2024, 0, 1)) / 864e5) }))),
      h('h1.news-mast-title', title),
      h('div.news-mast-sub',
        h('span.news-mast-tagline', tagline, feed && feed.lang ? h('span.news-lang', feed.lang.toUpperCase()) : null, unread ? h('span.muted', ` · ${tr({ de: '{n} ungelesen', en: '{n} unread' }, { n: unread })}`) : null),
        h('span.spacer'),
        h('div.news-tools',
          navBtns,
          h('button.btn.small', { title: tr({ de: 'Neu laden', en: 'Reload' }), onclick: () => loadItems(true) }, '↻ ', tr({ de: 'Aktualisieren', en: 'Refresh' })),
          h('button.btn.small', { title: tr({ de: 'Feed hinzufügen', en: 'Add feed' }), onclick: () => openAddDialog() }, '+ ', tr({ de: 'Feed', en: 'Feed' })),
          h('button.btn.small', { title: tr({ de: 'Alle Feeds prüfen', en: 'Check all feeds' }), onclick: () => runHealth(), disabled: st.health.running }, st.health.running ? `${st.health.done}/${st.health.total}` : '♥ ' + tr({ de: 'Prüfen', en: 'Check' })),
          h('button.btn.small.icon', { title: tr({ de: 'Schließen (Esc)', en: 'Close (Esc)' }), onclick: () => ctx.close() }, '✕'),
        )),
    );
  }

  function renderSide() {
    clear(side);
    const cats = h('div.news-cats');
    const visible = shownFeeds();
    for (const c of shownCats()) {
      const feedsIn = visible.filter((f) => f.category === c.id);
      if (c.id === 'custom' && !feedsIn.length) { cats.appendChild(h('div.news-cat.muted', { onclick: () => openAddDialog() }, h('span.news-cat-icon', c.icon), h('span.news-cat-label', catLabel(c)), h('span.news-cat-count', '+'))); continue; }
      const unread = feedsIn.reduce((a, f) => a + (f.unread || 0), 0);
      cats.appendChild(h('div.news-cat', { class: c.id === st.category ? 'active' : '', onclick: () => selectCategory(c.id) }, h('span.news-cat-icon', c.icon), h('span.news-cat-label', catLabel(c)), unread ? h('span.news-cat-count', unread) : null));
    }
    const list = h('div.news-feeds');
    const inCat = feedsOfCat();
    const allUnread = inCat.reduce((a, f) => a + (f.unread || 0), 0);
    list.appendChild(h('div.news-feed', { class: !st.feedId ? 'active' : '', onclick: () => selectFeed(null) }, h('span.news-feed-title', tr({ de: 'Alle Artikel', en: 'All articles' })), h('span.news-feed-meta', `${inCat.length} ${tr({ de: 'Quellen', en: 'sources' })}`), allUnread ? h('span.news-unread', allUnread) : null));
    for (const f of inCat) {
      const hs = f.health?.status || 'unknown';
      list.appendChild(h('div.news-feed', { class: f.id === st.feedId ? 'active' : '', onclick: () => selectFeed(f.id), title: hs === 'broken' ? (tr({ de: 'Feed nicht erreichbar: ', en: 'Feed unreachable: ' }) + (f.health?.error || '')) : f.url },
        h('i.news-dot', { class: hs }),
        h('span.news-feed-title', f.title),
        h('span.news-lang', (f.lang || '').toUpperCase()),
        f.unread ? h('span.news-unread', f.unread) : null,
        f.custom ? h('button.news-feed-remove', { title: tr({ de: 'Entfernen', en: 'Remove' }), onclick: (e) => { e.stopPropagation(); removeFeed(f); } }, '×') : null,
      ));
    }
    // the papers of the other language: one switch, the same as in the settings (Allgemein)
    const others = h('input', { type: 'checkbox', checked: othersOn(), onchange: () => { api.settings.set({ news: { otherLanguages: others.checked } }).catch?.(() => {}); } });
    const hidden = st.feeds.length - visible.length;
    side.append(cats, h('div.news-side-rule'), list,
      h('label.news-langs', others, h('span', tr({ de: 'Auch Zeitungen in anderen Sprachen', en: 'Also papers in other languages' }),
        !othersOn() && hidden > 0 ? h('span.news-langs-count', ' ' + tr({ de: '({n} weitere)', en: '({n} more)' }, { n: hidden })) : null)));
  }

  /** The language or the switch changed: the side bar and the list follow at once. */
  function applyLanguageFilter() {
    const key = filterKey(i18n.lang, othersOn());
    if (key === shownKey) return false;
    shownKey = key;
    if (st.feedId && !shownFeeds().some((f) => f.id === st.feedId)) st.feedId = null;
    if (!shownCats().some((c) => c.id === st.category)) st.category = shownCats().find((c) => c.id !== 'custom')?.id || shownCats()[0]?.id || 'news';
    renderSide(); renderMasthead();
    if (st.view === 'list') { record(listState()); loadItems(); }
    return true;
  }

  // ---- data --------------------------------------------------------------------------------------------
  async function loadList() {
    const res = await api.feeds.list();
    st.categories = res?.categories || [];
    st.feeds = res?.feeds || [];
    if (!st.categories.some((c) => c.id === st.category)) st.category = st.categories[0]?.id || 'news';
    if (st.feedId) { const f = st.feeds.find((x) => x.id === st.feedId); if (f) st.category = f.category; else st.feedId = null; }
    // a section without a paper in this language: the first one that has some
    if (!shownCats().some((c) => c.id === st.category)) st.category = shownCats().find((c) => c.id !== 'custom')?.id || 'news';
    try { const rs = await api.feeds.readState(); for (const k of Object.keys(rs?.read || {})) read.add(k); } catch {}
  }

  async function loadItems(force = false) {
    const token = ++st.loadToken;
    st.loading = true; st.error = null; st.items = [];
    renderMasthead(); renderList();
    const feeds = st.feedId ? [currentFeed()].filter(Boolean) : feedsOfCat();
    if (!feeds.length) { st.loading = false; st.error = tr({ de: 'Keine Feeds in dieser Rubrik. Füge einen Feed hinzu.', en: 'No feeds in this section yet. Add one.' }); renderList(); return; }
    let done = 0, failed = 0; const queue = [...feeds];
    const worker = async () => {
      while (queue.length) {
        const f = queue.shift();
        try {
          const res = await api.feeds.fetch(f.id, { force });
          if (token !== st.loadToken) return;
          const items = (res?.items || []).map((i) => ({ ...i, feedId: f.id, feedTitle: res.feed?.title || f.title, feedLang: res.feed?.lang || f.lang, read: read.has(i.id) || !!i.read }));
          st.items = mergeItems(st.items, items);
          const local = st.feeds.find((x) => x.id === f.id); if (local) { local.unread = items.filter((i) => !i.read).length; if (local.health?.status !== 'ok') local.health = { ...(local.health || {}), status: 'ok' }; }
        } catch (e) {
          failed++;
          const local = st.feeds.find((x) => x.id === f.id); if (local) local.health = { status: 'broken', error: e.message };
          if (feeds.length === 1) st.error = e.message;
        }
        done++;
        if (token === st.loadToken) { st.loading = done < feeds.length; renderList(); if (done === feeds.length) { renderSide(); renderMasthead(); } }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, feeds.length) }, worker));
    if (token !== st.loadToken) return;
    st.loading = false;
    if (failed && failed === feeds.length && !st.items.length) st.error = st.error || tr({ de: 'Keine Verbindung. Die Feeds konnten nicht geladen werden.', en: 'Offline – the feeds could not be loaded.' });
    renderList();
  }
  function mergeItems(a, b) {
    const seen = new Set(a.map((i) => i.id));
    const out = [...a, ...b.filter((i) => !seen.has(i.id))];
    out.sort((x, y) => (y.date || 0) - (x.date || 0));
    return st.feedId ? out : out.slice(0, MAX_MERGED);
  }

  function selectCategory(id) { sfx('page'); st.category = id; st.feedId = null; st.view = 'list'; record(listState()); renderSide(); loadItems(); }
  function selectFeed(id) { sfx('click'); st.feedId = id; st.view = 'list'; record(listState()); renderSide(); loadItems(); }

  // ---- list view ---------------------------------------------------------------------------------------
  function renderList() {
    if (st.view !== 'list') return;
    clear(main);
    main.className = 'news-main';
    progress.style.width = '0';
    if (st.error && !st.items.length) { main.appendChild(h('div.news-state', h('div.news-state-icon', '☕'), h('p', st.error), h('button.btn', { onclick: () => loadItems(true) }, tr({ de: 'Erneut versuchen', en: 'Try again' })))); return; }
    if (!st.items.length) { main.appendChild(h('div.news-state', h('div.news-spinner'), h('p.muted', tr({ de: 'Die Druckerpresse läuft …', en: 'The presses are running …' })))); return; }
    const items = st.items;
    const showSource = !st.feedId;
    const [lead, ...rest] = items;
    const wrap = h('div.news-list');
    if (st.loading) wrap.appendChild(h('div.news-loading-bar'));
    wrap.appendChild(itemCard(lead, 0, { lead: true, showSource }));
    const withImg = rest.filter((i) => i.image);
    const grid = h('div.news-grid');
    const cols = h('div.news-cols');
    rest.forEach((it, i) => {
      const idx = i + 1;
      if (it.image && withImg.length >= 3) grid.appendChild(itemCard(it, idx, { showSource }));
      else cols.appendChild(itemCard(it, idx, { showSource, text: true }));
    });
    if (grid.children.length) wrap.appendChild(grid);
    if (cols.children.length) wrap.appendChild(cols);
    wrap.appendChild(h('div.news-end', '— ', tr({ de: 'Ende der Ausgabe', en: 'End of issue' }), ' —'));
    main.appendChild(wrap);
  }

  function itemCard(it, index, { lead = false, showSource = false, text = false } = {}) {
    const lang = it.feedLang || 'de';
    const kicker = h('div.news-kicker', showSource ? h('b', it.feedTitle) : (it.kicker || it.categories?.[0] ? h('b', it.kicker || it.categories[0]) : null), h('span', fmtDate(it.date, lang)), it.hasFullText ? h('span.news-full', { title: tr({ de: 'Volltext im Feed', en: 'Full text in feed' }) }, '¶') : null);
    const card = h('article.news-item', { class: [lead ? 'lead' : '', text ? 'text' : '', it.read ? 'read' : ''].filter(Boolean).join(' '), onclick: () => openArticle(index), tabindex: 0, onkeydown: (e) => { if (e.key === 'Enter') openArticle(index); } },
      it.image && !text ? h('div.news-item-img', h('img', { src: it.image, alt: '', loading: 'lazy', onerror: (e) => e.target.parentNode.remove() })) : null,
      h('div.news-item-body', kicker, h('h3.news-item-title', it.title), h('p.news-item-summary', it.summary || ''), it.author ? h('div.news-item-author', it.author) : null),
    );
    return card;
  }

  // ---- article view -------------------------------------------------------------------------------------
  async function openArticle(index) {
    const it = st.items[index];
    if (!it) return;
    sfx('page');
    aloud.stop();
    st.view = 'article'; st.index = index; st.articleItem = it; st.article = null;
    record({ ...listState(), view: 'article', id: it.id });
    if (!it.read) { it.read = true; read.add(it.id); api.feeds.markRead(it.feedId, it.id).catch?.(() => {}); const f = st.feeds.find((x) => x.id === it.feedId); if (f && f.unread > 0) f.unread--; renderSide(); }
    renderArticle();
    const token = ++st.artToken;
    try {
      const art = await api.feeds.article(it.link, it.feedId);
      if (token !== st.artToken || st.view !== 'article') return;
      st.article = art || articleFromItem(it);
    } catch (e) {
      if (token !== st.artToken) return;
      st.article = { ...articleFromItem(it), error: e.message, partial: true };
    }
    renderArticle();
  }
  const articleFromItem = (it) => ({ title: it.title, byline: it.author, content: it.content || `<p>${escapeHtml(it.summary || '')}</p>`, textContent: it.summary || '', excerpt: it.summary, image: it.image, siteName: it.feedTitle, lang: it.feedLang, published: it.date, url: it.link, readingMinutes: null, partial: !it.hasFullText });

  function renderArticle() {
    clear(main);
    main.className = 'news-main article';
    const it = st.articleItem; const art = st.article;
    const lang = art?.lang || it.feedLang || 'de';
    const loading = !art;
    const a = art || articleFromItem(it);
    const toolbar = h('div.news-art-toolbar',
      h('button.btn.small', { onclick: backToList }, '← ', tr({ de: 'Zur Übersicht', en: 'Back to list' })),
      h('button.btn.small.icon', { title: tr({ de: 'Vorheriger Artikel (←)', en: 'Previous article (←)' }), disabled: st.index <= 0, onclick: () => openArticle(st.index - 1) }, '‹'),
      h('button.btn.small.icon', { title: tr({ de: 'Nächster Artikel (→)', en: 'Next article (→)' }), disabled: st.index >= st.items.length - 1, onclick: () => openArticle(st.index + 1) }, '›'),
      h('span.news-art-pos', `${st.index + 1} / ${st.items.length}`),
      h('span.spacer'),
      loading ? null : aloud.el,
      a.url ? h('button.btn.small', { title: tr({ de: 'Die ganze Seite im Lesebrowser lesen', en: 'Read the whole page in the reading browser' }), onclick: () => openInApp(a.url, ctx, { from: 'news', reader: true, title: a.title || it.title }) }, '📖 ', tr({ de: 'Ganze Seite lesen', en: 'Read full page' })) : null,
      a.url ? h('button.btn.small.ghost', { title: externalLabel() + ': ' + a.url, onclick: () => openSystemBrowser(api, a.url) }, '↗') : null,
    );
    const scroller = h('div.news-art-scroll', { tabindex: -1, onscroll: (e) => { const el = e.target; const p = el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 1; progress.style.width = (p * 100).toFixed(1) + '%'; } });
    st.scroller = scroller;
    // the byline is often the site name again ("BBC News · BBC News"): each entry only once
    const meta = [a.siteName || it.feedTitle, a.byline ? a.byline : null, fmtDate(a.published || it.date, lang, true), a.readingMinutes ? tr({ de: '{n} Min. Lesezeit', en: '{n} min read' }, { n: a.readingMinutes }) : null]
      .filter(Boolean).filter((m, i, all) => all.findIndex((x) => String(x).trim().toLowerCase() === String(m).trim().toLowerCase()) === i);
    // remote article HTML is sanitized before it enters the DOM, and every link stays in the app
    const baseUrl = a.url || it.link || '';
    const body = h('div.news-art-body');
    body.append(sanitizeFragment(a.content || '', baseUrl));
    interceptLinks(body, ctx, baseUrl);
    for (const img of body.querySelectorAll('img')) img.addEventListener('error', () => { const fig = img.closest('figure'); (fig || img).remove(); });
    const long = (a.textContent || '').length > 2500 && !body.querySelector('table');
    const heroInBody = a.image && a.content && a.content.includes(a.image);
    const article = h('article.news-art', { class: long ? 'two-col' : '' },
      h('header.news-art-header',
        h('div.news-kicker', ...meta.map((m, i) => h('span', (i ? ' · ' : '') + m))),
        h('h1.news-art-title', a.title || it.title),
        a.excerpt && a.excerpt !== a.title ? h('p.news-art-excerpt', a.excerpt) : null,
      ),
      a.image && !heroInBody ? h('figure.news-art-hero', h('img', { src: a.image, alt: '', onerror: (e) => e.target.closest('figure').remove() })) : null,
      loading ? h('div.news-art-loading', h('div.news-spinner'), h('span.muted', tr({ de: 'Artikel wird geholt …', en: 'Fetching article …' }))) : null,
      body,
      !loading && a.partial ? h('div.news-art-note', a.error ? h('span', tr({ de: 'Der volle Text konnte nicht geladen werden: ', en: 'The full text could not be loaded: ' }), a.error) : tr({ de: 'Dieser Feed liefert nur eine Zusammenfassung.', en: 'This feed only provides a summary.' }), ' ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); openInApp(a.url, ctx, { from: 'news', reader: true, title: a.title || it.title }); } }, tr({ de: 'Ganze Seite im Lesebrowser lesen →', en: 'Read the full page in the reading browser →' }))) : null,
      h('footer.news-art-footer', h('span.muted', a.url || '')),
    );
    scroller.appendChild(article);
    main.append(toolbar, scroller);
    progress.style.width = '0';
    scroller.focus?.();
  }
  function backToList() {
    // "Zur Übersicht" and Escape: back when the list is the step before, else a new step
    if (!restoring) {
      const prev = hist.peek(-1);
      if (prev && prev.view === 'list' && prev.category === st.category && (prev.feedId || null) === (st.feedId || null)) { hist.back(); return; }
      record(listState());
    }
    sfx('page'); aloud.stop(); st.view = 'list'; st.article = null; st.scroller = null; ++st.artToken; renderList(); renderSide();
  }

  // ---- add feed dialog -------------------------------------------------------------------------------------
  function openAddDialog() {
    if (st.dialog) return;
    sfx('click');
    let preview = null;
    const url = h('input.input', { placeholder: 'https://example.org/feed.xml', autofocus: true });
    const cat = h('select.input', st.categories.map((c) => h('option', { value: c.id, selected: c.id === (st.category === 'custom' ? 'custom' : st.category) }, catLabel(c))));
    const lang = h('select.input', h('option', { value: 'de' }, 'Deutsch'), h('option', { value: 'en', selected: i18n.lang === 'en' }, 'English'));
    const result = h('div.news-dialog-result');
    const addBtn = h('button.btn.primary', { disabled: true, onclick: () => add() }, tr({ de: 'Hinzufügen', en: 'Add' }));
    const checkBtn = h('button.btn', { onclick: () => check() }, tr({ de: 'Prüfen', en: 'Check' }));
    async function check() {
      const u = url.value.trim(); if (!u) return;
      clear(result); result.appendChild(h('div.news-spinner.small')); checkBtn.disabled = true;
      try {
        preview = await api.feeds.check(u);
        clear(result);
        if (!preview?.ok) { result.appendChild(h('p.news-err', '✗ ', preview?.error || tr({ de: 'Kein Feed gefunden', en: 'No feed found' }))); addBtn.disabled = true; return; }
        if (preview.lang && /^(de|en)$/.test(preview.lang)) lang.value = preview.lang;
        result.append(
          h('p', h('b', preview.title || u), preview.discoveredFrom ? h('span.muted', ' · ' + tr({ de: 'Feed auf der Seite entdeckt', en: 'feed discovered on page' })) : null),
          h('p.small', `${preview.itemCount} ${tr({ de: 'Einträge', en: 'entries' })} · ${preview.fullText ? tr({ de: '✓ Volltext im Feed', en: '✓ full text in feed' }) : tr({ de: '○ nur Anriss (Artikel werden nachgeladen)', en: '○ summaries only (articles fetched on demand)' })} · ${preview.imageCount} ${tr({ de: 'Bilder', en: 'images' })}`),
          h('ul.news-dialog-sample', (preview.sample || []).map((t) => h('li', t))),
        );
        addBtn.disabled = false;
      } catch (e) { clear(result); result.appendChild(h('p.news-err', '✗ ' + e.message)); }
      finally { checkBtn.disabled = false; }
    }
    async function add() {
      addBtn.disabled = true;
      try {
        const f = await api.feeds.add(preview?.url || url.value.trim(), cat.value, lang.value);
        toast(tr({ de: 'Feed hinzugefügt: ', en: 'Feed added: ' }) + (f?.title || ''));
        closeDialog();
        await loadList();
        st.category = f?.category || cat.value; st.feedId = f?.id || null;
        renderSide(); renderMasthead(); loadItems();
      } catch (e) { addBtn.disabled = false; clear(result); result.appendChild(h('p.news-err', '✗ ' + e.message)); }
    }
    url.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); check(); } });
    st.dialog = h('div.news-dialog-layer', { onclick: (e) => { if (e.target === st.dialog) closeDialog(); } },
      h('div.news-dialog',
        h('h2', tr({ de: 'Feed hinzufügen', en: 'Add a feed' })),
        h('p.muted.small', tr({ de: 'Die Adresse eines RSS- oder Atom-Feeds oder einfach die Adresse der Website. Den Feed einer Website sucht Cozy Shelves selbst.', en: 'The address of an RSS or Atom feed, or simply the address of the website. The reading room looks for the feed of a website itself.' })),
        h('label', 'URL', url),
        h('div.row', h('label', tr({ de: 'Rubrik', en: 'Section' }), cat), h('label', tr({ de: 'Sprache', en: 'Language' }), lang)),
        result,
        h('div.row.news-dialog-actions', checkBtn, h('span.spacer'), h('button.btn', { onclick: closeDialog }, tr({ de: 'Abbrechen', en: 'Cancel' })), addBtn),
      ));
    panel.appendChild(st.dialog);
    setTimeout(() => url.focus(), 50);
  }
  function closeDialog() { st.dialog?.remove(); st.dialog = null; }

  async function removeFeed(f) {
    if (!confirm(tr({ de: `„${f.title}“ entfernen?`, en: `Remove “${f.title}”?` }))) return;
    await api.feeds.remove(f.id);
    await loadList();
    if (st.feedId === f.id) st.feedId = null;
    renderSide(); renderMasthead(); loadItems();
  }

  // The "Prüfen" button used to stay disabled forever whenever the backend sent no 'health-done'
  // (offline, no update channel, a crashed check): a watchdog always releases it again.
  let healthTimer = null;
  const HEALTH_TIMEOUT = 45000;
  function armHealthWatchdog() {
    clearTimeout(healthTimer);
    healthTimer = setTimeout(() => finishHealth(tr({ de: 'Feed-Prüfung ohne Rückmeldung abgebrochen.', en: 'Feed check timed out.' })), HEALTH_TIMEOUT);
  }
  function finishHealth(msg) {
    clearTimeout(healthTimer); healthTimer = null;
    if (!st.health.running && !msg) return;
    st.health = { running: false, done: 0, total: 0 };
    renderMasthead(); renderSide();
    if (msg) toast(msg);
  }
  async function runHealth() {
    if (st.health.running) return;
    st.health = { running: true, done: 0, total: st.feeds.length };
    renderMasthead();
    armHealthWatchdog();
    try {
      const r = api.feeds.health ? await api.feeds.health() : await api.invoke('feeds:health');
      if (r && r.total) st.health.total = r.total;
      // no progress channel (or an already finished result): release the button right away
      if (!offUpdate || (r && (r.done != null || r.finished || Array.isArray(r.results)))) finishHealth();
      else renderMasthead();
    } catch (e) { finishHealth(e.message); }
  }

  // ---- events -------------------------------------------------------------------------------------------
  offUpdate = api.feeds.onUpdate?.((p) => {
    if (!p) return;
    if (p.type === 'health') { const f = st.feeds.find((x) => x.id === p.feedId); if (f) f.health = p.health; renderSide(); }
    else if (p.type === 'health-progress') { st.health.done = p.done; st.health.total = p.total; armHealthWatchdog(); renderMasthead(); }
    else if (p.type === 'health-done') { finishHealth(tr({ de: 'Feed-Prüfung abgeschlossen', en: 'Feed check finished' })); }
    else if (p.type === 'feed') { const f = st.feeds.find((x) => x.id === p.feedId); if (f) { f.unread = p.unread; f.itemCount = p.itemCount; } renderSide(); }
    else if (p.type === 'list') { loadList().then(() => { renderSide(); renderMasthead(); }); }
  }) || null;
  // every change of the settings passes here (main.js sets the language again): the papers follow the language and
  // the switch, the texts the language
  offLang = bus.on('i18n:change', () => { if (applyLanguageFilter()) return; renderMasthead(); renderSide(); if (st.view === 'list') renderList(); else renderArticle(); });

  // ---- boot --------------------------------------------------------------------------------------------
  try { await loadList(); } catch (e) { st.error = e.message; }
  hist.push(listState());
  renderMasthead(); renderSide();
  loadItems();

  /** keyboard scrolling of the article view – the scroller never had focus, so arrows/space did nothing */
  function scrollArticle(key, shift) {
    const el = st.scroller;
    if (!el || !el.isConnected) return false;
    const page = Math.max(120, el.clientHeight - 60);
    const by = { ArrowDown: 90, ArrowUp: -90, PageDown: page, PageUp: -page, ' ': shift ? -page : page, Spacebar: shift ? -page : page }[key];
    if (by != null) { el.scrollBy({ top: by, behavior: 'smooth' }); return true; }
    if (key === 'Home') { el.scrollTo({ top: 0, behavior: 'smooth' }); return true; }
    if (key === 'End') { el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); return true; }
    return false;
  }

  return {
    unmount() { offUpdate?.(); offLang?.(); aloud.dispose(); navBtns.dispose?.(); clearTimeout(healthTimer); ++st.loadToken; ++st.artToken; },
    /** the mouse's side buttons (panels.js) */
    onNav(dir) { hist.go(dir); return true; },
    onKey(e) {
      if (!st.dialog && hist.onKey(e)) return true;
      if (st.dialog) { if (e.key === 'Escape') { closeDialog(); return true; } return false; }
      if (st.view === 'article') {
        if (e.key === 'Escape') { backToList(); return true; }
        if (e.key === 'ArrowLeft' && st.index > 0) { openArticle(st.index - 1); return true; }
        if (e.key === 'ArrowRight' && st.index < st.items.length - 1) { openArticle(st.index + 1); return true; }
        if (scrollArticle(e.key, e.shiftKey)) return true;
        return false;
      }
      if (e.key === 'ArrowRight' && st.items.length) { openArticle(0); return true; }
      return false;
    },
  };
}

/** Convenience: open the newspaper on a category (e.g. from a 3D hotspot). */
export function openNewspaper(ctx, { category, feedId } = {}) { return ctx.openPanel('news', { category, feedId }); }
