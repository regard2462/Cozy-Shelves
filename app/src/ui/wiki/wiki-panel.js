// Lexikon: Wikipedia (de/en) on the lectern – featured content, search with suggestions, sanitized articles
// with internal navigation (history), table of contents, read-aloud and open-in-browser.
import { h, clear } from '../../core/dom.js';
import { tr, i18n } from '../../core/i18n.js';
import { openInApp, openSystemBrowser, sanitizeFragment, externalLabel } from '../reader/link-nav.js';
import { readAloudButton } from '../reader/tts-button.js';
import { chevron } from '../nav-history.js';

const WIKI_KEEP = { keepClasses: true, keepIds: true, keepData: ['data-wiki', 'data-ext', 'data-anchor', 'data-frag'] };

export async function mount(container, ctx, params = {}) {
  const { api, bus } = ctx;
  const st = { lang: params.lang || (i18n.lang === 'en' ? 'en' : 'de'), view: 'home', featured: null, featuredError: null, page: null, pageError: null, loading: false, history: [], hIndex: -1, suggestions: [], sugToken: 0, token: 0, sugTimer: null };
  const sfx = (n) => ctx.audio?.sfx?.(n);
  const toast = (m) => ctx.toast?.(m);
  // survives the header re-renders; a new page or closing the lectern stops the reading
  const aloud = readAloudButton({ toast, getText: () => (st.page ? (st.page.title + '. ' + (st.page.textContent || '')).slice(0, 20000) : ''), getLang: () => st.lang });

  const panel = h('div.panel.paper.wiki-panel');
  const header = h('div.wiki-header');
  const body = h('div.wiki-body');
  panel.append(header, body);
  container.appendChild(panel);

  const wikiName = () => (st.lang === 'de' ? 'Wikipedia · Die freie Enzyklopädie' : 'Wikipedia · The Free Encyclopedia');

  // ---- header --------------------------------------------------------------------------------------------------
  let searchInput;
  function renderHeader() {
    clear(header);
    searchInput = h('input.input.wiki-search', { placeholder: tr({ de: 'Im Lexikon nachschlagen …', en: 'Look something up …' }), autocomplete: 'off', spellcheck: false });
    const sug = h('div.wiki-suggest');
    searchInput.addEventListener('input', () => scheduleSuggest(searchInput.value, sug));
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const first = st.suggestions[0]; const q = searchInput.value.trim(); if (!q) return; navigate(first && first.title.toLowerCase() === q.toLowerCase() ? first.title : q); sug.hidden = true; }
      if (e.key === 'Escape') { sug.hidden = true; searchInput.blur(); }
      if (e.key === 'ArrowDown') { const a = sug.querySelector('.wiki-sug'); if (a) { a.focus(); e.preventDefault(); } }
    });
    searchInput.addEventListener('focus', () => { if (st.suggestions.length) sug.hidden = false; });
    searchInput.addEventListener('blur', () => setTimeout(() => { sug.hidden = true; }, 180));
    header.append(
      h('div.wiki-brand', h('div.wiki-brand-orn', '❦'), h('div.wiki-brand-text', h('div.wiki-brand-title', tr({ de: 'Lexikon', en: 'Encyclopædia' })), h('div.wiki-brand-sub', wikiName()))),
      h('div.wiki-nav',
        h('button.btn.small.icon.ghost.nav-btn', { title: tr({ de: 'Zurück (Alt+←)', en: 'Back (Alt+←)' }), 'aria-label': tr({ de: 'Zurück', en: 'Back' }), disabled: st.hIndex <= 0, onclick: () => go(-1) }, chevron('back')),
        h('button.btn.small.icon.ghost.nav-btn', { title: tr({ de: 'Vor (Alt+→)', en: 'Forward (Alt+→)' }), 'aria-label': tr({ de: 'Vor', en: 'Forward' }), disabled: st.hIndex >= st.history.length - 1, onclick: () => go(1) }, chevron('forward')),
        h('button.btn.small', { title: tr({ de: 'Startseite', en: 'Home' }), class: st.view === 'home' ? 'primary' : '', onclick: () => push({ type: 'home' }) }, '⌂ ', tr({ de: 'Heute', en: 'Today' })),
        h('button.btn.small', { title: tr({ de: 'Zufälliger Artikel', en: 'Random article' }), onclick: randomArticle }, '⚄ ', tr({ de: 'Zufall', en: 'Random' })),
      ),
      h('div.wiki-search-wrap', searchInput, sug),
      h('div.wiki-langs', ['de', 'en'].map((l) => h('button.wiki-lang', { class: st.lang === l ? 'active' : '', onclick: () => setLang(l) }, l.toUpperCase()))),
      h('div.wiki-actions',
        st.view === 'page' && st.page ? aloud.el : null,
        st.view === 'page' && st.page ? h('button.btn.small.ghost', { title: externalLabel() + ': ' + st.page.url, onclick: () => openSystemBrowser(api, st.page.url) }, '↗ ', tr({ de: 'Systembrowser', en: 'System browser' })) : null,
        h('button.btn.small.icon', { title: tr({ de: 'Schließen', en: 'Close' }), onclick: () => ctx.close() }, '✕'),
      ),
    );
  }
  function scheduleSuggest(q, sug) {
    clearTimeout(st.sugTimer);
    q = q.trim();
    if (q.length < 2) { st.suggestions = []; sug.hidden = true; return; }
    st.sugTimer = setTimeout(async () => {
      const token = ++st.sugToken;
      try {
        const r = await api.wiki.search(st.lang, q);
        if (token !== st.sugToken) return;
        st.suggestions = r || [];
        clear(sug);
        for (const s of st.suggestions.slice(0, 10)) sug.appendChild(h('button.wiki-sug', { onmousedown: (e) => e.preventDefault(), onclick: () => { sug.hidden = true; searchInput.value = ''; navigate(s.title); }, onkeydown: (e) => { if (e.key === 'ArrowDown') e.target.nextSibling?.focus(); if (e.key === 'ArrowUp') (e.target.previousSibling || searchInput).focus(); if (e.key === 'Escape') { sug.hidden = true; searchInput.focus(); } } },
          s.thumbnail ? h('img', { src: s.thumbnail, alt: '', onerror: (e) => e.target.remove() }) : h('span.wiki-sug-ph', '§'), h('span.wiki-sug-body', h('b', s.title), s.description ? h('small', s.description) : null)));
        sug.hidden = !st.suggestions.length;
      } catch { st.suggestions = []; sug.hidden = true; }
    }, 220);
  }

  // ---- navigation / history ---------------------------------------------------------------------------------------
  function push(entry) { st.history = st.history.slice(0, st.hIndex + 1); st.history.push(entry); st.hIndex = st.history.length - 1; show(entry); }
  function go(d) { const i = st.hIndex + d; if (i < 0 || i >= st.history.length) return; st.hIndex = i; show(st.history[i]); }
  function navigate(title, frag) { sfx('page'); push({ type: 'page', title, frag, lang: st.lang }); }
  function setLang(l) { if (l === st.lang) return; st.lang = l; st.featured = null; sfx('click'); if (st.view === 'page' && st.page) navigate(st.page.title); else push({ type: 'home' }); }
  async function randomArticle() { sfx('page'); try { const s = await api.wiki.random(st.lang); if (s?.title) navigate(s.title); } catch (e) { toast(e.message); } }

  async function show(entry) {
    const token = ++st.token;
    aloud.stop();
    if (entry.type === 'home') {
      st.view = 'home'; st.page = null; renderHeader(); renderHome();
      if (!st.featured || st.featured.lang !== st.lang) {
        st.loading = true; st.featuredError = null; renderHome();
        try { st.featured = await api.wiki.featured(st.lang); } catch (e) { st.featuredError = e.message; }
        if (token !== st.token) return;
        st.loading = false; renderHome();
      }
      return;
    }
    st.view = 'page'; st.loading = true; st.pageError = null; st.page = st.page && st.page.title === entry.title && st.page.lang === entry.lang ? st.page : null;
    if (entry.lang && entry.lang !== st.lang) st.lang = entry.lang;
    renderHeader(); renderPage();
    try {
      const p = await api.wiki.page(st.lang, entry.title);
      if (token !== st.token) return;
      st.page = p; entry.title = p?.title || entry.title;
    } catch (e) { if (token !== st.token) return; st.pageError = e.message; }
    st.loading = false;
    renderHeader(); renderPage();
    if (entry.frag) setTimeout(() => scrollToAnchor(entry.frag), 60);
  }

  // ---- home view ----------------------------------------------------------------------------------------------------
  const summaryCard = (s, { big = false, extra } = {}) => s ? h('div.wiki-card', { class: big ? 'big' : '', onclick: () => navigate(s.title) },
    s.thumbnail?.url || s.image ? h('div.wiki-card-img', h('img', { src: (big && s.image) || s.thumbnail?.url || s.image, alt: '', onerror: (e) => e.target.parentNode.remove() })) : null,
    h('div.wiki-card-body', h('h3', s.displayTitle || s.title), s.description ? h('div.wiki-card-desc', s.description) : null, s.extract ? h('p', big ? s.extract : s.extract.slice(0, 180) + (s.extract.length > 180 ? ' …' : '')) : null, extra || null, big ? h('span.wiki-more', tr({ de: 'Artikel lesen →', en: 'Read the article →' })) : null)) : null;

  function renderHome() {
    clear(body); body.className = 'wiki-body home';
    const f = st.featured;
    const date = new Date().toLocaleDateString(st.lang === 'de' ? 'de-DE' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    body.appendChild(h('div.wiki-home-head', h('span.wiki-rule'), h('span.wiki-home-date', date), h('span.wiki-rule')));
    if (st.loading && !f) { body.appendChild(h('div.wiki-state', h('div.wiki-spinner'), h('p.muted', tr({ de: 'Das Lexikon wird aufgeschlagen …', en: 'Opening the encyclopedia …' })))); return; }
    if (!f) { body.appendChild(h('div.wiki-state', h('div.wiki-state-icon', '📚'), h('p', st.featuredError || tr({ de: 'Keine Verbindung.', en: 'Offline.' })), h('button.btn', { onclick: () => { st.featured = null; show({ type: 'home' }); } }, tr({ de: 'Erneut versuchen', en: 'Try again' })))); return; }
    const left = h('div.wiki-col.main');
    const right = h('div.wiki-col.side');
    if (f.tfa) left.append(h('h2.wiki-sec', tr({ de: 'Artikel des Tages', en: 'Featured article' })), summaryCard(f.tfa, { big: true }));
    if (f.news?.length) left.append(h('h2.wiki-sec', tr({ de: 'In den Nachrichten', en: 'In the news' })), h('ul.wiki-news', f.news.map((n) => { const li = h('li'); li.append(sanitizeFragment(n.storyHtml || n.story || '', `https://${st.lang}.wikipedia.org/`, WIKI_KEEP)); bindLinks(li); return li; })));
    if (f.onthisday?.length) left.append(h('h2.wiki-sec', tr({ de: 'Was geschah heute?', en: 'On this day' })), h('dl.wiki-otd', f.onthisday.map((e) => [h('dt', String(e.year)), h('dd', e.text, e.pages?.length ? h('span.wiki-otd-links', e.pages.map((p) => h('a', { onclick: () => navigate(p.title) }, p.displayTitle || p.title))) : null)])));
    if (f.image) right.append(h('h2.wiki-sec', tr({ de: 'Bild des Tages', en: 'Picture of the day' })), h('figure.wiki-potd', h('img', { src: f.image.thumbnail || f.image.image, alt: '', onerror: (e) => e.target.remove() }), h('figcaption', f.image.description, f.image.artist ? h('small', ` — ${f.image.artist}${f.image.license ? ', ' + f.image.license : ''}`) : null)));
    if (f.mostread?.length) right.append(h('h2.wiki-sec', tr({ de: 'Meistgelesen', en: 'Most read' })), h('ol.wiki-mostread', f.mostread.slice(0, 8).map((m) => h('li', { onclick: () => navigate(m.title) }, m.thumbnail?.url ? h('img', { src: m.thumbnail.url, alt: '', onerror: (e) => e.target.replaceWith(h('span.wiki-mr-ph', '§')) }) : h('span.wiki-mr-ph', '§'), h('span', h('b', m.displayTitle || m.title), m.description ? h('small', m.description) : null)))));
    body.appendChild(h('div.wiki-home', left, right));
  }

  // ---- page view ------------------------------------------------------------------------------------------------------
  function bindLinks(root) {
    const open = (e) => {
      const a = e.target.closest('a'); if (!a || !root.contains(a)) return;
      e.preventDefault();
      const href = a.getAttribute('href') || '';
      if (a.dataset.wiki) navigate(a.dataset.wiki, a.dataset.frag);
      else if (a.dataset.anchor) scrollToAnchor(a.dataset.anchor);
      else if (href.startsWith('#')) scrollToAnchor(href.slice(1));
      else if (a.dataset.ext || /^https?:/i.test(href)) {
        // an article of the German or English Wikipedia stays in the lexicon, every other page opens in the reading browser
        const m = /^https?:\/\/(de|en)\.(?:m\.)?wikipedia\.org\/wiki\/([^?#]+)(?:#(.*))?$/i.exec(href);
        let title = null;
        if (m) { try { title = decodeURIComponent(m[2]).replace(/_/g, ' '); } catch { title = null; } }
        if (title && !/^[^:]+:/.test(title)) { if (m[1].toLowerCase() !== st.lang) st.lang = m[1].toLowerCase(); navigate(title, m[3] || null); }
        else openInApp(href, ctx, { from: 'wiki', title: (a.textContent || '').trim().slice(0, 80) });
      }
    };
    root.addEventListener('click', open);
    root.addEventListener('auxclick', (e) => { if (e.button === 1 && e.target.closest('a')) open(e); });
  }
  function scrollToAnchor(id) {
    const content = body.querySelector('.wiki-content'); if (!content) return;
    const el = content.querySelector('#' + CSS.escape(id)) || content.querySelector(`[id="${id.replace(/"/g, '')}"]`) || content.querySelector('#' + CSS.escape(id.replace(/ /g, '_')));
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.add('wiki-flash'); setTimeout(() => el.classList.remove('wiki-flash'), 1600); }
  }

  function renderPage() {
    clear(body); body.className = 'wiki-body page';
    const p = st.page;
    if (!p) {
      if (st.loading) body.appendChild(h('div.wiki-state', h('div.wiki-spinner'), h('p.muted', tr({ de: 'Artikel wird geholt …', en: 'Fetching article …' }))));
      else body.appendChild(h('div.wiki-state', h('div.wiki-state-icon', '❔'), h('p', st.pageError || tr({ de: 'Artikel nicht gefunden.', en: 'Article not found.' })), h('button.btn', { onclick: () => push({ type: 'home' }) }, tr({ de: 'Zur Startseite', en: 'Home' }))));
      return;
    }
    const toc = h('nav.wiki-toc', h('div.wiki-toc-title', tr({ de: 'Inhalt', en: 'Contents' })), h('a.wiki-toc-item.l2', { onclick: () => body.querySelector('.wiki-scroll').scrollTo({ top: 0, behavior: 'smooth' }) }, p.displayTitle || p.title),
      (p.toc || []).map((t) => h('a.wiki-toc-item', { class: 'l' + t.level, onclick: () => scrollToAnchor(t.id) }, t.text)));
    const content = h('div.wiki-content.mw-parser-output');
    content.append(sanitizeFragment(p.html || '', p.url || `https://${st.lang}.wikipedia.org/`, WIKI_KEEP));
    bindLinks(content);
    for (const img of content.querySelectorAll('img')) img.addEventListener('error', () => { const fig = img.closest('figure, .thumb'); (fig || img).remove(); });
    const scroll = h('div.wiki-scroll',
      h('article.wiki-article',
        h('header.wiki-art-head', h('h1.wiki-art-title', p.displayTitle || p.title), p.description ? h('div.wiki-art-desc', p.description) : null, h('div.wiki-art-meta', wikiName(), p.readingMinutes ? ` · ${tr({ de: '{n} Min. Lesezeit', en: '{n} min read' }, { n: p.readingMinutes })}` : '', st.loading ? h('span.wiki-inline-spinner') : null)),
        content,
        h('footer.wiki-art-foot', tr({ de: 'Text: Wikipedia, Lizenz CC BY-SA 4.0 · ', en: 'Text: Wikipedia, CC BY-SA 4.0 license · ' }), h('a', { role: 'link', tabindex: 0, title: tr({ de: 'Im Lesebrowser öffnen', en: 'Open in the reading browser' }), onclick: () => openInApp(p.url, ctx, { from: 'wiki', title: p.title }) }, p.url)),
      ));
    body.append(toc, scroll);
  }

  const offLang = bus.on('i18n:change', () => { renderHeader(); if (st.view === 'home') renderHome(); else renderPage(); });

  // ---- boot ------------------------------------------------------------------------------------------------------------
  if (params.title) push({ type: 'page', title: params.title, lang: st.lang }); else push({ type: 'home' });
  // only the start page grabs the search field – with an article open the keyboard belongs to the text
  if (!params.title) setTimeout(() => searchInput?.focus(), 100);

  return {
    unmount() { offLang(); aloud.dispose(); ++st.token; clearTimeout(st.sugTimer); },
    /** the mouse's side buttons (panels.js) and Alt+arrows from the search field */
    onNav(dir) { go(dir); return true; },
    onKey(e) {
      if (e.target && /input|textarea/i.test(e.target.tagName)) return false;
      // Escape walks the history back (article → previous article → Heute) and only then closes the
      // panel; it used to jump straight to the home page and could never close the panel from a page.
      if (e.key === 'Escape') {
        if (st.hIndex > 0) { go(-1); return true; }
        // an article opened directly (from the world map, a book): Esc leads to the start page, which then is the only
        // entry of the history. Pushed onto it, the next Esc went back to the article, and Esc never closed the lectern.
        if (st.view === 'page') { st.history = [{ type: 'home' }]; st.hIndex = 0; show(st.history[0]); return true; }
        return false; // at the start page: let the panel manager close the lectern
      }
      if (e.altKey && e.key === 'ArrowLeft') { go(-1); return true; }
      if (e.altKey && e.key === 'ArrowRight') { go(1); return true; }
      if (e.key === 'Backspace') { if (st.hIndex > 0) { go(-1); return true; } return false; }
      if (e.key === '/') { searchInput?.focus(); return true; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'PageDown' || e.key === 'PageUp' || e.key === 'Home' || e.key === 'End' || e.key === ' ') {
        const el = body.querySelector('.wiki-scroll') || body;
        if (!el || el.scrollHeight <= el.clientHeight) return false;
        const page = Math.max(120, el.clientHeight - 60);
        const by = { ArrowDown: 90, ArrowUp: -90, PageDown: page, PageUp: -page, ' ': e.shiftKey ? -page : page }[e.key];
        if (by != null) { el.scrollBy({ top: by, behavior: 'smooth' }); return true; }
        el.scrollTo({ top: e.key === 'Home' ? 0 : el.scrollHeight, behavior: 'smooth' });
        return true;
      }
      return false;
    },
  };
}
