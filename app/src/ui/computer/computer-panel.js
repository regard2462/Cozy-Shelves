// Library computer – the catalogue terminal in the hall.
// A header with back/forward, breadcrumbs and the clock; a sidebar with the overview, the sections and the
// programmes; the stage; a footer with the keys. Every step (section, a book's detail view, filters and sorting
// in the catalogue, a game) is an entry of a history: the arrows in the header, Alt+←/→, Backspace and the side
// buttons of a mouse lead back and forward through it (app/src/ui/nav-history.js).
// mount(container, ctx, params)   params: { section?: 'catalog'|'history'|'diary'|'stats'|'games'|'system', game?, book?, q? }
import { h, clear } from '../../core/dom.js';
import { tr } from '../../core/i18n.js';
import { makeSfx, clock, isEditable, T, hint, shortcutLabel, icon } from './terminal.js';
import { createNavHistory } from '../nav-history.js';
import * as home from './sections/home.js';
import * as catalog from './sections/catalog.js';
import * as history from './sections/history.js';
import * as diary from './sections/diary.js';
import * as stats from './sections/stats.js';
import * as games from './sections/games.js';
import * as system from './sections/system.js';
import { has } from '../../core/platform.js';

export const SECTIONS = [
  { id: 'catalog', mod: catalog, icon: 'catalog', label: { de: 'Katalog', en: 'Catalogue' }, desc: { de: 'Bestand durchsuchen, Bücher finden', en: 'Search the collection, find books' } },
  { id: 'history', mod: history, icon: 'history', label: { de: 'Ausleihe & Verlauf', en: 'Loans & history' }, desc: { de: 'Ausgeliehene Bücher, Leseverlauf', en: 'Borrowed books, reading history' } },
  { id: 'diary', mod: diary, icon: 'diary', label: { de: 'Lesetagebuch', en: 'Reading diary' }, desc: { de: 'Anmerkungen und Lesezeichen', en: 'Annotations and bookmarks' } },
  { id: 'stats', mod: stats, icon: 'stats', label: { de: 'Statistik', en: 'Statistics' }, desc: { de: 'Lesezeit, Serie, Bestand', en: 'Reading time, streak, collection' } },
  { id: 'games', mod: games, icon: 'games', label: { de: 'Spiele', en: 'Games' }, desc: { de: 'Go, Schach, Rätsel, Klassiker', en: 'Go, chess, puzzles, classics' } },
  { id: 'system', mod: system, icon: 'system', label: { de: 'System', en: 'System' }, desc: { de: 'Erscheinungsbild, Sprache, Ordner', en: 'Appearance, language, folders' } },
];
/** Programmes: they open their own panel on top of the computer (Esc leads back here). The browser version has
 *  neither of them (core/platform.js), its computer shows only the sections. */
export const APPS = [
  { id: 'browser', panel: 'browser', icon: 'browser', label: { de: 'Lesebrowser', en: 'Reading browser' }, desc: { de: 'Webseiten lesen, mit Lesemodus', en: 'Read web pages, with a reading mode' } },
  { id: 'mediathek', panel: 'mediathek', icon: 'mediathek', label: { de: 'Mediathek', en: 'Media library' }, desc: { de: 'Filme und Sendungen von ARD, ZDF, arte …', en: 'Films and programmes from ARD, ZDF, arte …' } },
].filter((a) => has(a.id));
const HOME = { id: 'menu', mod: home, icon: 'home', label: { de: 'Übersicht', en: 'Overview' } };

/** params worth keeping in a history entry: no empty values, no internals */
const cleanParams = (p = {}) => Object.fromEntries(Object.entries(p || {}).filter(([k, v]) => v != null && v !== '' && !k.startsWith('_') && k !== 'section' && k !== 'reopen'));

export async function mount(container, ctx, params = {}) {
  const sfx = makeSfx(ctx);

  // ---- DOM skeleton -------------------------------------------------------
  const content = h('div.term-content');
  const stage = h('main.term-stage', { tabindex: 0 }, content);
  const crumbs = h('nav.term-crumbs', { 'aria-label': T('Pfad', 'Path') });
  const clockEl = h('span.term-clock', clock());
  const hist = createNavHistory({ onGo: (entry) => applyEntry(entry) });
  const navBtns = hist.buttons({ cls: 'term-hbtn' });
  const brandSub = h('span.term-brand-sub', T('Katalog-Terminal', 'Catalogue terminal'));
  const brand = h('button.term-brand', { type: 'button', tabindex: -1, title: T('Zur Übersicht', 'To the overview'), onclick: () => { sfx.click(); showMenu(); } },
    h('span.term-brand-mark', '❦'), h('span.term-brand-name', 'Cozy Shelves'), brandSub);
  const closeBtn = h('button.term-hbtn.term-close', { type: 'button', tabindex: -1, title: T('Schließen (Esc)', 'Close (Esc)'), 'aria-label': T('Schließen', 'Close'), onclick: () => { sfx.click(); ctx.close(); } }, '✕');
  const header = h('header.term-header', navBtns, brand, crumbs, h('span.spacer'), clockEl, closeBtn);
  const nav = h('nav.term-nav', { 'aria-label': T('Bereiche', 'Sections') });
  const appNav = h('nav.term-nav.term-nav-apps', { 'aria-label': T('Programme', 'Programmes') });
  const sideFoot = h('div.term-side-foot');
  const sideHead = h('div.term-side-head', T('Bereiche', 'Sections'));
  const appHead = h('div.term-side-head.term-side-head-apps', T('Programme', 'Programmes'));
  const sidebar = h('aside.term-sidebar', sideHead, nav, appHead, appNav, sideFoot);
  const statusHints = h('div.term-status-hints');
  const histHint = h('div.term-status-nav');
  const footer = h('footer.term-footer', statusHints, histHint);
  const panel = h('div.panel.paper.computer', header, h('div.term-main', sidebar, stage), footer);
  container.appendChild(panel);

  // ---- state --------------------------------------------------------------
  let current = null;         // { id, instance, params }
  let disposed = false;
  let mountSeq = 0;
  const clockTimer = setInterval(() => { clockEl.textContent = clock(); }, 15000);

  const setHints = (list) => { clear(statusHints); if (list) statusHints.appendChild(typeof list === 'string' ? h('span', list) : hint(list)); };
  const paintHistHint = () => { clear(histHint); histHint.appendChild(hint([['Alt ←→', T('zurück / vor', 'back / forward')]])); };
  /** Breadcrumbs: Start › parts … – a part is a string or { label, go } (a link back to that level). */
  const setCrumbs = (...parts) => {
    clear(crumbs);
    const all = [{ label: T('Start', 'Home'), go: () => showMenu() }, ...parts.filter(Boolean).map((p) => (typeof p === 'string' ? { label: p } : p))];
    all.forEach((p, i) => {
      if (i) crumbs.appendChild(h('span.term-crumb-sep', '›'));
      const last = i === all.length - 1;
      crumbs.appendChild(last
        ? h('span.term-crumb.current', { 'aria-current': 'page', title: p.label }, p.label)
        : h('button.term-crumb', { type: 'button', tabindex: -1, onclick: () => { sfx.click(); (p.go || (() => showMenu()))(); } }, p.label));
    });
  };
  const setTitle = (t) => setCrumbs(t);

  /** One history entry per step. replace: the current entry changes (typing in a search field). */
  function record(id, p, { replace = false } = {}) {
    const entry = { id, params: cleanParams(p) };
    if (replace) hist.replace(entry); else hist.push(entry);
  }

  const sctx = {
    ctx, sfx, panel, content, setHints, setTitle, setCrumbs,
    tr, T,
    sections: SECTIONS, apps: APPS,
    toast: (m) => ctx.toast?.(m),
    goMenu: () => showMenu(),
    goSection: (id, p) => showSection(id, p),
    openApp: (id) => openApp(id),
    /** the sections record their inner steps: push = a new step, replace = the same step changed */
    nav: {
      push: (p) => { if (current && current.id !== 'menu') { current.params = cleanParams(p); record(current.id, p); } },
      replace: (p) => { if (current && current.id !== 'menu') { current.params = cleanParams(p); record(current.id, p, { replace: true }); } },
      back: () => hist.back(),
      peek: (d) => hist.peek(d),
      same: (a, b) => JSON.stringify(cleanParams(a)) === JSON.stringify(cleanParams(b)),
    },
    focusScreen: () => { try { stage.focus({ preventScroll: true }); } catch { /* ignore */ } },
    /** a book from the collection straight into the reader */
    readBook: (id, location) => { sfx.open(); ctx.bus?.emit?.('book:open', location ? { id, location } : { id }); ctx.close(); },
  };

  // ---- sidebar ------------------------------------------------------------
  const navRows = [];
  function buildNav() {
    clear(nav); clear(appNav); navRows.length = 0;
    const homeRow = h('button.term-nav-item.term-nav-home', { type: 'button', tabindex: -1, dataset: { id: 'menu' }, onclick: () => { sfx.click(); showMenu(); } },
      h('span.term-nav-icon', icon('home')), h('span.term-nav-label', tr(HOME.label)));
    navRows.push(homeRow); nav.appendChild(homeRow);
    SECTIONS.forEach((s, i) => {
      const row = h('button.term-nav-item', { type: 'button', tabindex: -1, dataset: { id: s.id }, title: tr(s.desc),
        onclick: () => { sfx.click(); showSection(s.id); } },
        h('span.term-nav-icon', icon(s.icon)), h('span.term-nav-label', tr(s.label)), h('kbd.term-nav-key', shortcutLabel(i)));
      navRows.push(row); nav.appendChild(row);
    });
    APPS.forEach((a, i) => {
      appNav.appendChild(h('button.term-nav-item.term-nav-app', { type: 'button', tabindex: -1, dataset: { app: a.id }, title: tr(a.desc),
        onclick: () => openApp(a.id) },
        h('span.term-nav-icon', icon(a.icon)), h('span.term-nav-label', tr(a.label)), h('kbd.term-nav-key', shortcutLabel(SECTIONS.length + i))));
    });
  }
  /** Lesebrowser / Mediathek: a panel of their own, stacked on the computer. */
  function openApp(id) {
    const app = APPS.find((a) => a.id === id);
    if (!app || disposed) return;
    sfx.open();
    ctx.openPanel?.(app.panel, {});
  }
  function paintNav() { navRows.forEach((r) => r.classList.toggle('active', !!current && r.dataset.id === current.id)); }
  function paintSideFoot() {
    clear(sideFoot);
    const lib = ctx.state?.library || {};
    const basket = ctx.state?.basket || [];
    sideFoot.append(...[
      h('div.term-side-stat', h('b', String((lib.books || []).length)), ' ', T('Bücher', 'books')),
      h('div.term-side-stat', h('b', String((lib.departments || []).length)), ' ', T('Abteilungen', 'departments')),
      basket.length ? h('div.term-side-stat.accent', h('b', String(basket.length)), ' ', T('im Korb', 'in the basket')) : null,
    ].filter(Boolean));
  }
  buildNav(); paintSideFoot(); paintHistHint();

  // ---- sections -----------------------------------------------------------
  /** Mounts a section module ('menu' is the overview). record=false: the step comes from the history itself. */
  async function mountSection(def, p, { record: rec = true } = {}) {
    if (disposed) return;
    const seq = ++mountSeq;
    unmountCurrent();
    clear(content);
    content.scrollTop = 0;
    current = { id: def.id, instance: null, params: cleanParams(p) };
    paintNav(); paintSideFoot();
    if (def.id === 'menu') setCrumbs(); else setCrumbs(tr(def.label));
    setHints([['Esc', T('zurück', 'back')]]);
    if (rec) record(def.id, p);
    try {
      const inst = await def.mod.mount(content, sctx, { ...p });
      if (seq === mountSeq && current && current.id === def.id) current.instance = inst || {};
      else inst?.unmount?.();
    } catch (e) {
      console.error('[computer] section failed', def.id, e);
      if (seq !== mountSeq) return;
      clear(content);
      content.appendChild(h('div.term-notice.error', T('Fehler: ', 'Error: '), String(e?.message || e)));
    }
    if (seq === mountSeq) sctx.focusScreen();
  }
  function showMenu(opts) { return mountSection(HOME, {}, opts); }
  function showSection(id, p = {}, opts) {
    const sec = SECTIONS.find((s) => s.id === id);
    if (!sec) return showMenu(opts);
    return mountSection(sec, p, opts);
  }
  /** A history entry: the open section takes it in place when it can (list ↔ detail, a game), else it is mounted. */
  function applyEntry(entry) {
    if (!entry || disposed) return;
    sfx.click();
    const inst = current?.instance;
    if (current && current.id === entry.id && inst?.navigate) {
      let handled = false;
      try { handled = inst.navigate({ ...(entry.params || {}) }) === true; } catch (e) { console.error('[computer] navigate', e); }
      if (handled) { current.params = entry.params || {}; return; }
    }
    if (entry.id === 'menu') showMenu({ record: false }); else showSection(entry.id, entry.params || {}, { record: false });
  }

  function unmountCurrent() {
    try { current?.instance?.unmount?.(); } catch (e) { console.error(e); }
    current = null;
  }

  if (params.section) showSection(params.section, cleanParams(params)); else showMenu();

  // ---- language switch re-renders ----------------------------------------
  const offLang = ctx.bus?.on?.('i18n:change', () => {
    brandSub.textContent = T('Katalog-Terminal', 'Catalogue terminal');
    brand.title = T('Zur Übersicht', 'To the overview');
    sideHead.textContent = T('Bereiche', 'Sections');
    nav.setAttribute('aria-label', T('Bereiche', 'Sections'));
    appHead.textContent = T('Programme', 'Programmes');
    appNav.setAttribute('aria-label', T('Programme', 'Programmes'));
    closeBtn.title = T('Schließen (Esc)', 'Close (Esc)'); closeBtn.setAttribute('aria-label', T('Schließen', 'Close'));
    const keep = current ? { id: current.id, params: current.params || {} } : null;
    buildNav(); paintHistHint();
    if (!keep || keep.id === 'menu') showMenu({ record: false }); else showSection(keep.id, keep.params, { record: false });
  });
  const offBasket = ctx.bus?.on?.('basket:change', () => paintSideFoot());

  const onStageDown = () => { if (!isEditable(document.activeElement)) sctx.focusScreen(); };
  stage.addEventListener('mousedown', onStageDown);

  return {
    unmount() {
      disposed = true;
      clearInterval(clockTimer);
      offLang?.(); offBasket?.(); navBtns.dispose?.();
      unmountCurrent();
      stage.removeEventListener('mousedown', onStageDown);
    },
    /** the mouse's side buttons (panels.js) */
    onNav(dir) { if (disposed) return false; hist.go(dir); return true; },
    /** for tests and the audit scripts */
    get history() { return { length: hist.length, canBack: hist.canBack, canForward: hist.canForward, current: hist.current }; },
    onKey(e) {
      if (disposed) return false;
      if (hist.onKey(e)) return true;
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) sfx.type();
      // global: Alt+<shortcut> jumps to a section or programme from anywhere
      if (e.altKey && !e.ctrlKey && !e.metaKey && typeof e.key === 'string' && e.key.length === 1) {
        const gi = '123456789abcdefghijklmnopqrstuvwxyz'.indexOf(e.key.toLowerCase());
        if (gi >= 0 && SECTIONS[gi]) { sfx.click(); showSection(SECTIONS[gi].id); return true; }
        if (gi >= SECTIONS.length && APPS[gi - SECTIONS.length]) { openApp(APPS[gi - SECTIONS.length].id); return true; }
      }
      const inst = current?.instance;
      if (inst?.onKey) { try { if (inst.onKey(e) === true) return true; } catch (err) { console.error(err); } }
      if (e.key === 'Backspace' && !isEditable(e.target)) {
        if (hist.back()) return true;
        if (current?.id && current.id !== 'menu') { sfx.click(); showMenu(); return true; }
        return false;
      }
      if (current?.id === 'menu') return false;   // Escape on the overview closes the panel
      if (e.key === 'Escape') { if (isEditable(e.target)) { e.target.blur(); sctx.focusScreen(); return true; } sfx.click(); showMenu(); return true; }
      return false;
    },
  };
}
