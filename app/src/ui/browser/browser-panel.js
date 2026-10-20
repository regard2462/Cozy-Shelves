// Lesebrowser: the app's reading browser, modelled on EinkBro (https://github.com/plateaukao/einkbro).
// Tabs with an overview and a start page, pages that turn instead of scrolling (edge strips, Space/PageDown,
// an overlap line), a reader mode with its own typography and real pagination, read-aloud with the app's
// voices, find, bookmarks, reading list and history, switches for blocker / JavaScript / images / text only,
// translation on request, and three ways to keep a page: EPUB into the library, a chapter in a Sammelband, PDF.
//
// Every page lives in a sandboxed <webview> (partition 'persist:lesesaal-browser', no node, no preload, no
// popups; see hardenWebviews/hardenSessions in electron/main.js and electron/browser/index.js). Without
// <webview> (browser dev harness) only the start page and the server-side reader ('catalog:readUrl') work.
//
//   mount(container, ctx, { url, reader })        panel 'browser'
//   createBrowser(container, ctx, { url, onClose }) embedded (catalogue); returns { go(url), unmount(), onKey(e) }
import { h, clear } from '../../core/dom.js';
import { tr } from '../../core/i18n.js';
import { icon } from './icons.js';
import { normalizePrefs } from './prefs.js';
import { currentTheme, onTheme } from '../../core/theme.js';
import { createStore } from './store.js';
import { guestScript, guestCss, SNAPSHOT_SCRIPT } from './guest.js';
import { toArticle, fromCatalog } from './extract.js';
import { createReader } from './reader.js';
import { createReadAloud } from './tts.js';
import { renderStart } from './start-page.js';
import { buildSheet } from './sheets.js';
import { parseInput, hostOf, isWeb, isAppPage, cleanUrl, displayUrl, samePage, withTimeout, uid, SEARCH_ENGINES, monogram } from './util.js';

const CSS_HREF = './styles/browser.css';
const PARTITION = 'persist:lesesaal-browser';
const MAX_LIVE_VIEWS = 6;
const MAX_TABS = 30;
const ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

function ensureCss() {
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => /browser\.css/.test(l.getAttribute('href') || ''))) return;
  document.head.appendChild(h('link', { rel: 'stylesheet', href: CSS_HREF, id: 'br-css' }));
}

// Electron's own <webview> element throws "Invalid guestInstanceId" from its disconnectedCallback when it
// leaves the document after its guest is already gone. That is a custom element reaction, so no try/catch
// around remove() can reach it; it has no consequence, so it is kept out of the console as a page error.
if (typeof window !== 'undefined' && !window.__cozyshelvesWebviewQuirk) {
  window.__cozyshelvesWebviewQuirk = true;
  window.addEventListener('error', (e) => { if (/Invalid guestInstanceId/.test(String(e?.message || ''))) e.preventDefault(); });
}

/** Panel entry: the panel manager owns the layer, ctx.close() closes it. */
export async function mount(container, ctx, params = {}) {
  ensureCss();
  container.classList.add('br-host');
  const panel = h('div.panel.br-panel');
  container.appendChild(panel);
  return build(panel, ctx, params, { onClose: () => ctx.close?.() });
}

/** Embedded variant: the caller owns the frame (the catalogue opens the browser as a layer). */
export function createBrowser(container, ctx, params = {}) {
  ensureCss();
  const panel = h('div.panel.br-panel');
  container.appendChild(panel);
  return build(panel, ctx, params, { onClose: params.onClose });
}

function build(panel, ctx, params, { onClose }) {
  const { api, bus } = ctx;
  const T = (de, en, vars) => tr({ de, en }, vars);
  const sfx = (n) => { try { ctx.audio?.sfx?.(n); } catch {} };
  const toast = (m) => ctx.toast?.(m);
  const rpc = (ch, ...a) => (typeof api.invoke === 'function' ? api.invoke(ch, ...a) : Promise.reject(new Error(T('Diese Funktion gibt es nur in der Cozy-Shelves-App.', 'Only available in the Cozy Shelves app.'))));
  const quiet = (p) => { if (p && typeof p.catch === 'function') p.catch(() => {}); return p; };
  const canWebview = !!api.isElectron && typeof document.createElement('webview').getWebContentsId === 'function';

  const store = createStore(api);
  const tabs = [];
  let activeId = null;
  let prefs = normalizePrefs({});
  let info = { ua: '', mobileUA: '' };
  let sheet = null;
  let destroyed = false;
  let booted = false;
  const find = { open: false, query: '', result: null, reqId: null };
  const offs = [];
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!destroyed) fn(); }, ms); timers.add(t); return t; };
  const activeTab = () => tabs.find((t) => t.id === activeId) || null;

  // ---- the shared context of the browser modules ------------------------------------------------------------------
  const B = {
    ctx, api, bus, T, rpc, store, sfx, toast,
    get prefs() { return prefs; },
    get lang() { return ctx.i18n?.lang || 'de'; },
    get tabs() { return tabs; },
    activeTab,
  };

  // ---- skeleton ---------------------------------------------------------------------------------------------------
  const ib = (name, label, onclick, cls = '') => h('button.br-ibtn' + cls, { type: 'button', title: label, 'aria-label': label, onclick, onmousedown: (e) => e.preventDefault(), html: icon(name) });
  const btnBack = ib('back', T('Zurück (Alt+←)', 'Back (Alt+←)'), () => goBack());
  const btnFwd = ib('forward', T('Vorwärts (Alt+→)', 'Forward (Alt+→)'), () => goForward());
  const btnReload = ib('reload', T('Neu laden (F5)', 'Reload (F5)'), () => reloadOrStop());
  const lockEl = h('span.br-lock');
  const address = h('input.br-address', {
    type: 'text', spellcheck: false, autocomplete: 'off', 'aria-label': T('Adresse oder Suchbegriff', 'Address or search term'),
    placeholder: T('Adresse oder Suchbegriff', 'Address or search term'),
  });
  const suggestEl = h('div.br-suggest', { hidden: true, role: 'listbox' });
  const btnStar = ib('star', T('Lesezeichen (Strg+D)', 'Bookmark (Ctrl+D)'), () => toggleBookmark(), '.br-star');
  const omni = h('div.br-omni', lockEl, address, btnStar, suggestEl);
  const btnReader = h('button.br-readbtn', { type: 'button', title: T('Lesemodus (R). Zeigt nur den Text der Seite, in Buchschrift.', 'Reader mode (R). Shows just the text of the page, in book type.'), onmousedown: (e) => e.preventDefault(), onclick: () => toggleReader() }, h('span', { html: icon('reader') }), h('span.br-readbtn-label', T('Lesemodus', 'Reader')));
  const tabCount = h('span.br-tabcount', '1');
  const btnTabs = h('button.br-ibtn.br-tabsbtn', { type: 'button', title: T('Tabs', 'Tabs'), 'aria-label': T('Tabs', 'Tabs'), onmousedown: (e) => e.preventDefault(), onclick: () => openSheet('tabs') }, h('span', { html: icon('tabs') }), tabCount);
  const btnMenu = ib('menu', T('Menü', 'Menu'), () => (sheet?.name === 'menu' ? closeSheet() : openSheet('menu')));
  const btnClose = onClose ? ib('close', T('Lesebrowser schließen', 'Close the reading browser'), () => onClose(), '.br-closebtn') : null;
  const bar = h('div.br-bar', btnBack, btnFwd, btnReload, omni, btnReader, btnTabs, btnMenu, btnClose);
  const progressEl = h('div.br-progress', h('i'));

  const turn = (dir) => h('button.br-turn' + (dir < 0 ? '.prev' : '.next'), {
    type: 'button', tabindex: '-1', title: dir < 0 ? T('Vorige Seite', 'Previous page') : T('Nächste Seite', 'Next page'),
    'aria-label': dir < 0 ? T('Vorige Seite', 'Previous page') : T('Nächste Seite', 'Next page'),
    onmousedown: (e) => e.preventDefault(), onclick: () => pageTurn(dir),
    onwheel: (e) => { e.preventDefault(); wheelTurn(e); },
    html: icon(dir < 0 ? 'prev' : 'next'),
  });
  const turnPrev = turn(-1), turnNext = turn(1);
  const stage = h('div.br-stage');
  const startEl = h('div.br-start', { hidden: true });
  const errorEl = h('div.br-error', { hidden: true });
  const reader = createReader(B);
  B.reader = reader;
  stage.append(startEl, reader.el, errorEl);
  const mainEl = h('div.br-main', turnPrev, stage, turnNext);

  const findBar = h('div.br-find', { hidden: true });
  const tts = createReadAloud(B);
  B.tts = tts;
  const ttsBusy = () => tts.active || !!tts.error || !!tts.offer;

  const stTitle = h('span.br-st-title');
  const stHover = h('span.br-st-hover', { hidden: true });
  const stPage = h('span.br-st-page');
  const stTrack = h('span.br-bar-track', h('i'));
  const stShieldCount = h('span.br-st-count');
  const btnLook = ib('type', T('Darstellung', 'Appearance'), () => (sheet?.name === 'look' ? closeSheet() : openSheet('look')));
  const btnSpeak = ib('speak', T('Vorlesen (V)', 'Read aloud (V)'), () => tts.toggle());
  // a right click on the icon opens the voice menu (Shift+V as well, see handleKey)
  btnSpeak.addEventListener('contextmenu', (e) => { e.preventDefault(); tts.openMenu(btnSpeak); });
  const btnShield = h('button.br-ibtn.br-shield', { type: 'button', title: T('Schutz und Schalter', 'Protection and switches'), 'aria-label': T('Schutz und Schalter', 'Protection and switches'), onmousedown: (e) => e.preventDefault(), onclick: () => (sheet?.name === 'toggles' ? closeSheet() : openSheet('toggles')) }, h('span', { html: icon('shield') }), stShieldCount);
  const status = h('div.br-status', stTitle, stHover, h('span.spacer'), h('span.br-st-pos', stPage, stTrack), h('span.spacer'), btnLook, btnSpeak, btnShield);
  const sheetLayer = h('div.br-sheets', { hidden: true });
  const hint = h('div.br-hint', { hidden: true, role: 'status' });
  panel.append(bar, progressEl, mainEl, findBar, tts.el, status, sheetLayer, hint);

  // ---- preferences --------------------------------------------------------------------------------------------------
  let prefsTimer = null;
  function persistPrefs(now) {
    clearTimeout(prefsTimer);
    prefsTimer = null;
    const write = () => { prefsTimer = null; const { sites, ...rest } = prefs; return quiet(api.settings?.set?.({ browser: { ...rest, sites: sitesForSave(sites) } })); };
    if (now) return write() || Promise.resolve();
    prefsTimer = setTimeout(write, 350);
    return Promise.resolve();
  }
  // settings.set merges deeply, so a removed site exception must be written as null
  let lastSites = {};
  function sitesForSave(sites) {
    const out = {};
    for (const [host, v] of Object.entries(lastSites)) out[host] = { js: null, adblock: null, zoom: null, ...(sites[host] || {}) };
    for (const [host, v] of Object.entries(sites)) out[host] = { js: null, adblock: null, zoom: null, ...v };
    lastSites = { ...sites };
    return out;
  }

  /** opts.reload: the rules of the main process changed (blocker, JavaScript, images, user agent). */
  async function setPrefs(patch, opts = {}) {
    const before = prefs;
    prefs = normalizePrefs({ ...prefs, ...patch });
    applyTheme();
    if (patch.mobile !== undefined && patch.mobile !== before.mobile) {
      for (const t of tabs) if (t.view) { try { t.view.setUserAgent(prefs.mobile ? info.mobileUA : info.ua); } catch {} }
    }
    const typo = ['font', 'fontSize', 'lineHeight', 'measure', 'margin', 'align', 'hyphens', 'bold', 'black', 'readerImages', 'images', 'columns', 'paging'];
    if (typo.some((k) => k in patch)) reader.applyPrefs();
    for (const t of tabs) applyGuest(t);
    if (opts.reload) {
      await persistPrefs(true);
      const tab = activeTab();
      for (const t of tabs) if (t.view && t !== tab) t.stale = true;
      if (tab?.view && isWeb(tab.url)) reload(tab);
    } else persistPrefs();
    render();
  }
  B.setPrefs = setPrefs;
  function setSiteRule(host, patch) {
    const sites = { ...prefs.sites, [host]: { ...(prefs.sites[host] || {}), ...patch } };
    for (const [k, v] of Object.entries(sites[host])) if (v === undefined || v === null) delete sites[host][k];
    if (!Object.keys(sites[host]).length) delete sites[host];
    return setPrefs({ sites }, { reload: 'js' in patch || 'adblock' in patch });
  }
  B.setSiteRule = setSiteRule;
  /** The page theme: Papier follows the appearance (Nacht with "Dunkel") until a theme is chosen in the look sheet. */
  function pageTheme() { return !prefs.themeChosen && prefs.theme === 'paper' && currentTheme() === 'dark' ? 'night' : prefs.theme; }
  B.pageTheme = pageTheme;
  function applyTheme() {
    panel.dataset.theme = pageTheme();
    panel.classList.toggle('br-nozones', !prefs.zones);
  }

  // ---- tabs ---------------------------------------------------------------------------------------------------------
  function makeTab({ url = '', title = '', mode, progress = 0 } = {}) {
    const web = isWeb(url);
    return {
      id: uid(), url: web ? url : '', title: title || (web ? hostOf(url) : ''), mode: web ? (mode === 'reader' ? 'reader' : 'web') : 'start',
      view: null, wcId: null, loading: false, domReady: false, canBack: false, canForward: false,
      article: null, readerProgress: mode === 'reader' ? progress : 0, wantReader: web && mode === 'reader', pendingFrac: mode === 'reader' ? 0 : progress,
      webPos: null, blocked: 0, zoom: 1, error: null, thumb: null, lastActive: Date.now(), stale: false,
      translatedFrom: null, hoverUrl: '', fullscreen: false, cssKey: null, cssText: '', loadStarted: 0,
    };
  }

  function openTab(url, { background = false, mode = 'web', progress = 0, after = null } = {}) {
    if (tabs.length >= MAX_TABS) { toast(T('Es sind schon {n} Tabs offen. Bitte zuerst einen schließen.', '{n} tabs are open already. Please close one first.', { n: MAX_TABS })); return null; }
    const tab = makeTab({ url, mode, progress });
    const ref = after || activeTab();
    const i = ref ? tabs.indexOf(ref) : -1;
    tabs.splice(i >= 0 ? i + 1 : tabs.length, 0, tab);
    if (background) { if (tab.mode !== 'start') ensureView(tab); render(); }
    else activate(tab);
    saveSessionSoon();
    return tab;
  }
  function newTab() {
    const tab = openTab('', {});
    if (tab) later(() => (startInput || address).focus(), 30);
    return tab;
  }
  B.newTab = newTab;

  function activate(tab) {
    if (!tab || destroyed) return;
    const prev = activeTab();
    if (prev && prev !== tab) {
      prev.lastActive = Date.now();
      if (ttsBusy()) tts.stop(true);
      if (find.open) closeFind();
      try { prev.view?.blur(); } catch {}
    }
    activeId = tab.id;
    tab.lastActive = Date.now();
    if (tab.mode !== 'start') ensureView(tab);
    if (tab.stale && tab.view && tab.domReady) { tab.stale = false; reload(tab); }
    render();
    if (tab.mode === 'reader') {
      if (tab.article) reader.show(tab.article, { progress: tab.readerProgress });
      else openReader(tab);
    } else if (tab.mode === 'web') focusView(tab);
    saveSessionSoon();
  }
  B.activate = activate;

  function closeTab(tab = activeTab()) {
    if (!tab) return;
    const i = tabs.indexOf(tab);
    if (i < 0) return;
    if (isWeb(tab.url)) store.closedTab({ url: tab.translatedFrom || tab.url, title: tab.title, mode: tab.mode, frac: tab.mode === 'reader' ? tab.readerProgress : tab.webPos?.frac || 0 });
    if (tab === activeTab() && ttsBusy()) tts.stop(true);
    destroyView(tab);
    tabs.splice(i, 1);
    if (!tabs.length) tabs.push(makeTab({}));
    if (activeId === tab.id || !activeTab()) activate(tabs[Math.min(i, tabs.length - 1)]);
    else render();
    saveSessionSoon();
  }
  B.closeTab = closeTab;

  function restoreClosed(url, { here = false } = {}) {
    const c = store.popClosed(url);
    if (!c) { toast(T('Kein geschlossener Tab mehr da.', 'No closed tab left.')); return; }
    const cur = activeTab();
    if (here && cur && cur.mode === 'start') loadInTab(cur, c.url, { reader: c.mode === 'reader', progress: c.frac });
    else openTab(c.url, { mode: c.mode, progress: c.frac });
  }
  B.restoreClosed = restoreClosed;

  function cycleTab(dir) {
    if (tabs.length < 2) return;
    const i = tabs.indexOf(activeTab());
    activate(tabs[(i + dir + tabs.length) % tabs.length]);
  }

  // ---- webviews ----------------------------------------------------------------------------------------------------
  function ensureView(tab) {
    if (tab.view || !canWebview || !isWeb(tab.url) || destroyed) return tab.view;
    const wv = document.createElement('webview');
    wv.className = 'br-view';
    wv.setAttribute('partition', PARTITION);
    // popups are the business of main.js (hardenWebviews): a window-open request becomes a tab here, never a window
    wv.setAttribute('webpreferences', 'nodeIntegration=no,contextIsolation=yes,sandbox=yes,javascript=yes');
    if (prefs.mobile && info.mobileUA) wv.setAttribute('useragent', info.mobileUA);
    wv.setAttribute('src', tab.url);
    tab.view = wv; tab.domReady = false; tab.loading = true; tab.loadStarted = Date.now();
    wireView(tab, wv);
    stage.insertBefore(wv, startEl);
    evictViews();
    return wv;
  }
  /** At most MAX_LIVE_VIEWS pages stay loaded; the others are reloaded when their tab comes back. */
  function evictViews() {
    const live = tabs.filter((t) => t.view && t.id !== activeId).sort((a, b) => a.lastActive - b.lastActive);
    while (live.length > MAX_LIVE_VIEWS - 1) {
      const t = live.shift();
      if (t.mode === 'web' && t.webPos) t.pendingFrac = t.webPos.frac;
      destroyView(t);
    }
  }
  function destroyView(tab) {
    const wv = tab.view;
    tab.view = null; tab.wcId = null; tab.domReady = false; tab.loading = false; tab.cssKey = null; tab.cssText = '';
    if (!wv) return Promise.resolve();
    wv.classList.remove('on');
    // A <webview> removed while it is still attaching, or with a request in flight, makes Electron log
    // "Invalid guestInstanceId": stop it first, and wait for the attachment when it has not happened yet.
    // This also holds when the whole panel closes: unmount() returns a promise and the panel manager keeps
    // the layer in the document until every guest is gone (closing right after opening used to log it).
    let done = false, finish;
    const gone = new Promise((res) => { finish = res; });
    const dispose = () => {
      if (done) return;
      done = true;
      try { quiet(wv.stopFindInPage('clearSelection')); } catch {}
      try { quiet(wv.stop()); } catch {}
      try { wv.remove(); } catch {}
      finish();
    };
    if (attached.has(wv)) dispose();
    else { wv.addEventListener('did-attach', () => setTimeout(dispose, 0), { once: true }); setTimeout(dispose, 5000); }
    return gone;
  }
  const attached = new WeakSet();
  function focusView(tab) {
    if (!tab?.view || tab !== activeTab() || tab.mode !== 'web') return;
    if (document.activeElement === address || panel.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    try { tab.view.focus(); } catch {}
  }
  const exec = (tab, code, ms = 5000) => {
    if (!tab?.view || !tab.domReady) return Promise.resolve(null);
    return withTimeout(tab.view.executeJavaScript(code), ms).catch(() => null);
  };

  function wireView(tab, wv) {
    const isMine = () => tab.view === wv && !destroyed;
    wv.addEventListener('did-attach', () => attached.add(wv), { once: true });
    wv.addEventListener('did-start-loading', () => {
      if (!isMine()) return;
      tab.loading = true; tab.loadStarted = Date.now();
      if (tab === activeTab()) { renderBar(); renderProgress(); }
    });
    wv.addEventListener('did-stop-loading', () => {
      if (!isMine()) return;
      tab.loading = false;
      syncNav(tab);
      applyGuest(tab);
      if (tab.pendingFrac) { const f = tab.pendingFrac; tab.pendingFrac = 0; exec(tab, `window.__cozyshelvesBrowser && window.__cozyshelvesBrowser.goFrac(${Number(f) || 0})`).then((p) => setWebPos(tab, p)); }
      if (tab.wantReader && tab === activeTab()) openReader(tab);
      if (tab === activeTab()) { render(); later(() => captureThumb(tab), 900); }
      // the map after Google's consent page is loaded once more (see onNavigated)
      if (tab.reloadAfterConsent) { const u = tab.reloadAfterConsent; tab.reloadAfterConsent = null; later(() => { if (tab.view === wv) loadView(tab, u); }, 1500); }
    });
    wv.addEventListener('dom-ready', () => {
      if (!isMine()) return;
      try { tab.wcId = wv.getWebContentsId(); } catch {}
      tab.domReady = true; tab.cssKey = null; tab.cssText = '';
      applyGuest(tab);
      applyZoom(tab);
      if (tab.wcId != null) quiet(rpc('browser:blocked', tab.wcId).then((n) => { if (Number.isFinite(n)) { tab.blocked = n; if (tab === activeTab()) renderStatus(); } }));
      syncNav(tab);
    });
    wv.addEventListener('did-navigate', (e) => { if (isMine()) onNavigated(tab, e.url, true); });
    wv.addEventListener('did-navigate-in-page', (e) => { if (isMine() && e.isMainFrame) onNavigated(tab, e.url, false); });
    wv.addEventListener('page-title-updated', (e) => {
      if (!isMine()) return;
      tab.title = e.title || hostOf(tab.url);
      store.retitle(tab.url, tab.title);
      if (tab === activeTab()) renderStatus();
      saveSessionSoon();
    });
    wv.addEventListener('did-fail-load', (e) => {
      if (!isMine() || !e.isMainFrame || e.errorCode === -3) return;
      tab.loading = false;
      tab.error = { code: e.errorCode, text: e.errorDescription || '', url: e.validatedURL || tab.url };
      if (tab === activeTab()) render();
    });
    wv.addEventListener('render-process-gone', () => {
      if (!isMine()) return;
      tab.error = { code: 'crashed', text: T('Die Seite ist abgestürzt.', 'The page crashed.'), url: tab.url };
      tab.domReady = false;
      if (tab === activeTab()) render();
    });
    wv.addEventListener('found-in-page', (e) => {
      if (!isMine() || tab !== activeTab()) return;
      const r = e.result || {};
      if (find.reqId != null && r.requestId != null && r.requestId !== find.reqId) return;
      if (r.finalUpdate === false && !r.matches) return;
      find.result = { active: r.activeMatchOrdinal || 0, total: r.matches || 0 };
      renderFindCount();
    });
    wv.addEventListener('console-message', (e) => { if (isMine()) onGuestMessage(tab, e.message); });
    wv.addEventListener('update-target-url', (e) => { if (!isMine()) return; tab.hoverUrl = e.url || ''; if (tab === activeTab()) renderHover(); });
    wv.addEventListener('enter-html-full-screen', () => { tab.fullscreen = true; panel.classList.add('br-fullscreen'); });
    wv.addEventListener('leave-html-full-screen', () => { tab.fullscreen = false; panel.classList.remove('br-fullscreen'); });
    wv.addEventListener('context-menu', (e) => { if (isMine()) showContextMenu(tab, e.params || {}); });
  }

  function onNavigated(tab, url, full) {
    tab.url = url;
    tab.error = null;
    if (full) {
      tab.article = null;
      tab.webPos = null;
      tab.domReady = false;
      if (tab.translatedFrom && !/translate\.goog$|translate\.google\./.test(hostOf(url))) tab.translatedFrom = null;
      store.visit(url);
      if (tab.mode === 'reader' && !tab.wantReader) { tab.mode = 'web'; if (tab === activeTab()) { tts.stop(true); reader.hide(); } }
      // Google's consent page sends the page back to the address it came from; a Street View link opened that way
      // asks for the panorama without its id and stays black. After that first visit the map is loaded once more.
      if (/^https:\/\/consent\.(google|youtube)\./i.test(url)) tab.consentSeen = true;
      else if (tab.consentSeen) {
        tab.consentSeen = false;
        if (isAppPage(url)) tab.reloadAfterConsent = url;
      }
    }
    syncNav(tab);
    if (tab === activeTab()) { renderBar(); renderStatus(); }
    saveSessionSoon();
  }
  function syncNav(tab) {
    if (!tab.view) return;
    try { tab.canBack = tab.view.canGoBack(); tab.canForward = tab.view.canGoForward(); } catch {}
    if (tab === activeTab()) renderBar();
  }

  /** CSS and helper script for the guest page, after each load and after every change of the settings. */
  function applyGuest(tab) {
    if (!tab.view || !tab.domReady) return;
    const wv = tab.view;
    const app = isAppPage(tab.url);
    const css = guestCss(prefs, pageTheme(), { app });
    if (css !== tab.cssText) {
      const old = tab.cssKey;
      tab.cssText = css;
      quiet(wv.insertCSS(css, { cssOrigin: 'user' }).then((key) => {
        if (tab.view !== wv) return;
        tab.cssKey = key;
        if (old) quiet(wv.removeInsertedCSS(old));
      }));
    }
    exec(tab, guestScript(prefs, pageTheme(), { app })).then((p) => setWebPos(tab, p));
  }
  function applyZoom(tab) {
    if (!tab.view) return;
    const z = prefs.sites[hostOf(tab.url)]?.zoom || 1;
    tab.zoom = z;
    try { tab.view.setZoomFactor(z); } catch {}
  }
  function zoom(dir) {
    const tab = activeTab();
    if (!tab) return;
    if (tab.mode === 'reader' || !tab.view) { setPrefs({ fontSize: dir === 0 ? 21 : prefs.fontSize + dir }); return; }
    const cur = tab.zoom || 1;
    let next = 1;
    if (dir > 0) next = ZOOMS.find((z) => z > cur + 0.001) || ZOOMS[ZOOMS.length - 1];
    else if (dir < 0) next = [...ZOOMS].reverse().find((z) => z < cur - 0.001) || ZOOMS[0];
    tab.zoom = next;
    try { tab.view.setZoomFactor(next); } catch {}
    const host = hostOf(tab.url);
    if (host) setSiteRule(host, { zoom: Math.abs(next - 1) < 0.001 ? undefined : next });
    showHint(T('Zoom {z} %', 'Zoom {z} %', { z: Math.round(next * 100) }));
  }
  B.zoom = zoom;

  function onGuestMessage(tab, msg) {
    if (typeof msg !== 'string' || !msg.startsWith('__cozyshelves:')) return;
    let o;
    try { o = JSON.parse(msg.slice(11)); } catch { return; }
    if (o?.t === 'pos') setWebPos(tab, o);
    else if (o?.t === 'key' && tab === activeTab() && !sheet) {
      if (o.k === 'r') toggleReader();
      else if (o.k === 'v') tts.toggle();
    }
  }
  function setWebPos(tab, p) {
    if (!p || typeof p !== 'object' || !Number.isFinite(p.page) || !Number.isFinite(p.pages)) return;
    tab.webPos = { page: Math.max(1, Math.round(p.page)), pages: Math.max(1, Math.round(p.pages)), frac: Math.min(1, Math.max(0, Number(p.frac) || 0)), atEnd: !!p.atEnd };
    if (tab === activeTab() && tab.mode === 'web') renderPage();
    trackProgress(tab);
  }
  let progressTimer = null;
  function trackProgress(tab) {
    clearTimeout(progressTimer);
    progressTimer = later(() => {
      if (!store.laterOf(tab.url)) return;
      if (tab.mode === 'reader') store.progress(tab.url, tab.readerProgress, 'reader');
      else if (tab.webPos) store.progress(tab.url, tab.webPos.atEnd ? 1 : tab.webPos.frac, 'web');
    }, 700);
  }
  B.onReaderPos = (p) => {
    const tab = activeTab();
    if (!tab || tab.mode !== 'reader') return;
    tab.readerProgress = p.progress;
    renderPage();
    trackProgress(tab);
  };

  // ---- navigation ------------------------------------------------------------------------------------------------------
  /** input: URL or search text. opts: newTab, background, reader, mode ('reader'|'web'), progress. */
  function navigate(input, opts = {}) {
    const parsed = isWeb(input) ? { url: String(input) } : parseInput(input, prefs.searchEngine);
    if (!parsed) return null;
    const wantReader = !!opts.reader || opts.mode === 'reader';
    if (opts.newTab) return openTab(parsed.url, { background: !!opts.background, mode: wantReader ? 'reader' : 'web', progress: opts.progress || 0 });
    let tab = activeTab();
    if (!tab) { tab = makeTab({}); tabs.push(tab); activeId = tab.id; }
    loadInTab(tab, parsed.url, { reader: wantReader, progress: opts.progress || 0 });
    return tab;
  }
  B.navigate = navigate;
  function loadInTab(tab, url, { reader: wantReader = false, progress = 0 } = {}) {
    if (tab === activeTab()) { if (ttsBusy()) tts.stop(true); if (find.open) closeFind(); }
    tab.url = url; tab.title = hostOf(url); tab.article = null; tab.error = null; tab.webPos = null; tab.hoverUrl = '';
    tab.mode = wantReader ? 'reader' : 'web';
    tab.wantReader = wantReader;
    tab.readerProgress = wantReader ? progress : 0;
    tab.pendingFrac = wantReader ? 0 : progress;
    if (tab.view) { tab.loading = true; tab.loadStarted = Date.now(); loadView(tab, url); }
    else ensureView(tab);
    if (tab === activeTab()) {
      render();
      if (wantReader) reader.showLoading(T('Die Seite wird geladen …', 'Loading the page …'));
      else later(() => focusView(tab), 60);
      if (!canWebview) openReader(tab);
    }
    saveSessionSoon();
  }
  /** Navigation of a live view. Through the main process when possible: a navigation that is replaced by the
   *  next one rejects its promise, and <webview>.loadURL() has Electron log that as an error. */
  function loadView(tab, url) {
    const wv = tab.view;
    if (tab.wcId != null) {
      rpc('browser:navigate', tab.wcId, url).then((ok) => { if (!ok && tab.view === wv) quiet(wv.loadURL(url)); }).catch(() => { if (tab.view === wv) quiet(wv.loadURL(url)); });
    } else quiet(wv.loadURL(url));
  }
  // in reader mode "back" returns to the page itself; the page history comes next
  function goBack() { const t = activeTab(); if (t?.mode === 'reader') { closeReader(t); return; } try { if (t?.view?.canGoBack()) t.view.goBack(); } catch {} }
  function goForward() { const t = activeTab(); try { if (t?.view?.canGoForward()) t.view.goForward(); } catch {} }
  function reload(tab = activeTab()) {
    if (!tab || !isWeb(tab.url)) return;
    tab.error = null;
    if (tab.mode === 'reader') tab.article = null;
    if (tab.view) { try { tab.view.reload(); } catch {} }
    else ensureView(tab);
    if (tab.mode === 'reader') { tab.wantReader = true; if (tab === activeTab()) reader.showLoading(); }
    if (tab === activeTab()) render();
  }
  function reloadOrStop() {
    const tab = activeTab();
    if (tab?.loading && tab.view) { try { tab.view.stop(); } catch {} tab.loading = false; render(); return; }
    reload(tab);
  }

  // ---- paging ----------------------------------------------------------------------------------------------------
  async function pageTurn(dir) {
    const tab = activeTab();
    if (!tab || sheet?.kind === 'dialog') return;
    if (tab.mode === 'reader') { if (reader.visible && (dir > 0 ? reader.next() : reader.prev())) sfx('page'); return; }
    if (tab.mode !== 'web' || !tab.view || !tab.domReady) return;
    const p = await exec(tab, `window.__cozyshelvesBrowser ? window.__cozyshelvesBrowser.page(${dir > 0 ? 1 : -1}) : (window.scrollBy(0, ${dir > 0 ? 1 : -1} * innerHeight * 0.85), null)`);
    setWebPos(tab, p);
  }
  let wheelAt = 0;
  function wheelTurn(e) {
    const now = performance.now();
    if (now - wheelAt < 260 || Math.abs(e.deltaY) < 4) return;
    wheelAt = now;
    pageTurn(e.deltaY > 0 ? 1 : -1);
  }
  function edge(end) {
    const tab = activeTab();
    if (tab?.mode === 'reader') return end ? reader.last() : reader.first();
    exec(tab, `(() => { const s = document.scrollingElement || document.documentElement; s.scrollTo({ top: ${end ? 's.scrollHeight' : '0'}, behavior: 'instant' }); return window.__cozyshelvesBrowser ? window.__cozyshelvesBrowser.pos() : null; })()`).then((p) => setWebPos(tab, p));
  }
  function lineScroll(dir) {
    const tab = activeTab();
    if (tab?.mode === 'reader') {
      if (prefs.paging === 'pages') return pageTurn(dir);
      reader.el.querySelector('.br-rd-viewport')?.scrollBy({ top: dir * 60, behavior: 'instant' });
      return;
    }
    exec(tab, `window.scrollBy({ top: ${dir * 60}, behavior: 'instant' })`);
  }

  // ---- reader mode ---------------------------------------------------------------------------------------------------
  let readerTimer = null;
  async function openReader(tab = activeTab(), { force = false } = {}) {
    if (!tab || !isWeb(tab.url)) return false;
    if (tab === activeTab() && tab.mode !== 'reader') { if (ttsBusy()) tts.stop(true); if (find.open) closeFind(); }
    tab.mode = 'reader';
    if (tab === activeTab()) render();
    if (tab.article && samePage(tab.article.url, tab.url) && !force) {
      tab.wantReader = false;
      if (tab === activeTab()) { reader.show(tab.article, { progress: tab.readerProgress }); reader.el.focus({ preventScroll: true }); }
      return true;
    }
    if (tab === activeTab()) { reader.showLoading(); reader.el.focus({ preventScroll: true }); try { tab.view?.blur(); } catch {} }
    // a page that is still loading: wait for it (up to 8 s, some pages never finish)
    if (tab.view && (tab.loading || !tab.domReady) && Date.now() - tab.loadStarted < 8000) {
      tab.wantReader = true;
      clearTimeout(readerTimer);
      readerTimer = later(() => { if (tab.wantReader && tab.mode === 'reader') { tab.loadStarted = 0; openReader(tab); } }, 8100 - (Date.now() - tab.loadStarted));
      return false;
    }
    tab.wantReader = false;
    let art = null, err = null;
    if (tab.view && tab.domReady) {
      try { art = await toArticle(await withTimeout(tab.view.executeJavaScript(SNAPSHOT_SCRIPT), 15000)); } catch (e) { err = e; }
    }
    if (!art) {
      try { art = fromCatalog(await rpc('catalog:readUrl', tab.url, { follow: false }), tab.url); } catch (e) { err = err || e; }
    }
    if (destroyed || tab.mode !== 'reader') return false;
    if (!art) {
      if (tab === activeTab()) reader.showError(String(err?.message || err || T('Kein Text gefunden.', 'No text found.')), [
        { label: T('Zur Seite', 'Back to the page'), primary: true, onclick: () => closeReader(tab) },
        { label: T('Erneut versuchen', 'Try again'), onclick: () => openReader(tab, { force: true }) },
      ]);
      return false;
    }
    tab.article = art;
    if (!tab.title || tab.title === hostOf(tab.url)) tab.title = art.title;
    if (!tab.readerProgress) { const it = store.laterOf(tab.url); if (it && it.mode === 'reader' && !it.read) tab.readerProgress = it.progress || 0; }
    if (tab === activeTab()) { reader.show(art, { progress: tab.readerProgress }); render(); }
    saveSessionSoon();
    return true;
  }
  function closeReader(tab = activeTab()) {
    if (!tab) return;
    if (tab === activeTab()) { if (ttsBusy()) tts.stop(true); if (find.open) closeFind(); }
    tab.mode = isWeb(tab.url) ? 'web' : 'start';
    tab.wantReader = false;
    if (tab === activeTab()) { reader.hide(); render(); focusView(tab); }
    saveSessionSoon();
  }
  function toggleReader() {
    const tab = activeTab();
    if (!tab || !isWeb(tab.url)) return;
    sfx('click');
    if (tab.mode === 'reader') closeReader(tab); else openReader(tab);
  }
  B.ensureReader = async () => {
    const tab = activeTab();
    if (!tab || !isWeb(tab.url)) return false;
    if (tab.mode === 'reader' && reader.visible) return true;
    await openReader(tab);
    for (let i = 0; i < 40 && tab.mode === 'reader' && !reader.visible && !destroyed; i++) await new Promise((r) => setTimeout(r, 250));
    return tab === activeTab() && reader.visible;
  };

  // ---- find -----------------------------------------------------------------------------------------------------------
  let findInput = null, findCount = null;
  function openFind() {
    const tab = activeTab();
    if (!tab || tab.mode === 'start') return;
    find.open = true;
    renderFind();
    later(() => { findInput?.focus(); findInput?.select(); }, 20);
  }
  B.openFind = openFind;
  function closeFind() {
    find.open = false; find.result = null;
    reader.clearFind();
    const tab = activeTab();
    if (tab?.view) { try { quiet(tab.view.stopFindInPage('clearSelection')); } catch {} }
    renderFind();
  }
  function runFind(fresh, back) {
    const tab = activeTab();
    const q = find.query.trim();
    if (!tab) return;
    if (tab.mode === 'reader') {
      find.result = q ? reader.find(q, { fresh, back }) : (reader.clearFind(), null);
      renderFindCount();
      return;
    }
    if (!tab.view) return;
    if (!q) { try { quiet(tab.view.stopFindInPage('clearSelection')); } catch {} find.result = null; renderFindCount(); return; }
    // every keystroke starts a new request; answers to the older ones (often "0 matches") are ignored
    // Electron: findNext true starts a new search session, false continues the current one
    try { find.reqId = tab.view.findInPage(q, { forward: !back, findNext: !!fresh, matchCase: false }); } catch {}
  }
  function renderFind() {
    clear(findBar);
    findBar.hidden = !find.open;
    if (!find.open) return;
    findInput = h('input.br-input.br-find-input', {
      type: 'text', enterkeyhint: 'search', value: find.query, spellcheck: false, placeholder: T('Auf der Seite suchen …', 'Find on page …'), 'aria-label': T('Auf der Seite suchen', 'Find on page'),
      oninput: (e) => { find.query = e.target.value; runFind(true); },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); runFind(false, e.shiftKey); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); } },
    });
    findCount = h('span.br-find-count');
    findBar.append(h('span.br-find-ico', { html: icon('search') }), findInput, findCount,
      ib('back', T('Vorheriger Treffer (Umschalt+F3)', 'Previous match (Shift+F3)'), () => runFind(false, true), '.rot'),
      ib('forward', T('Nächster Treffer (F3)', 'Next match (F3)'), () => runFind(false, false), '.rot'),
      ib('close', T('Suche schließen', 'Close search'), () => closeFind()));
    renderFindCount();
  }
  function renderFindCount() {
    if (!findCount) return;
    const r = find.result;
    findCount.textContent = !find.query.trim() ? '' : r && r.total ? T('{a} von {b}', '{a} of {b}', { a: r.active, b: r.total }) : T('keine Treffer', 'no matches');
  }

  // ---- bookmarks, reading list, copy, translate ------------------------------------------------------------------------------
  function toggleBookmark() {
    const tab = activeTab();
    if (!tab || !isWeb(tab.url)) return;
    const url = tab.translatedFrom || tab.url;
    const b = store.bookmarkOf(url);
    if (b) { store.removeBookmark(b.id); showHint(T('Lesezeichen entfernt', 'Bookmark removed')); }
    else { store.addBookmark(url, tab.mode === 'reader' && tab.article ? tab.article.title : tab.title); showHint(T('Lesezeichen gesetzt', 'Bookmarked')); }
    sfx('click');
    renderBar();
  }
  function toggleLater() {
    const tab = activeTab();
    if (!tab || !isWeb(tab.url)) return;
    const url = tab.translatedFrom || tab.url;
    if (store.laterOf(url)) { store.removeLater(url); showHint(T('Aus der Leseliste genommen', 'Removed from the reading list')); }
    else {
      store.addLater(url, tab.mode === 'reader' && tab.article ? tab.article.title : tab.title, tab.mode === 'reader' ? 'reader' : 'web', tab.mode === 'reader' ? tab.readerProgress : tab.webPos?.frac || 0);
      showHint(T('In der Leseliste', 'On the reading list'));
    }
    sfx('click');
  }
  B.toggleLater = toggleLater;
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
    const ta = h('textarea', { style: { position: 'fixed', left: '-9999px', top: '0' } }, text);
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    return ok;
  }
  B.copyUrl = async () => { const t = activeTab(); if (t && isWeb(t.url)) showHint((await copyText(t.translatedFrom || t.url)) ? T('Adresse kopiert', 'Address copied') : T('Kopieren nicht möglich', 'Copying failed')); };
  B.openExternal = () => { const t = activeTab(); if (t && isWeb(t.url)) api.app?.openExternal?.(t.translatedFrom || t.url); };
  B.translate = () => {
    const tab = activeTab();
    if (!tab || !isWeb(tab.url)) return;
    if (tab.translatedFrom) { const orig = tab.translatedFrom; tab.translatedFrom = null; loadInTab(tab, orig); return; }
    const orig = tab.url;
    const lang = B.lang === 'en' ? 'en' : 'de';
    loadInTab(tab, `https://translate.google.com/translate?sl=auto&tl=${lang}&u=${encodeURIComponent(orig)}`);
    tab.translatedFrom = orig;
    showHint(T('Die Seite wird von Google übersetzt. Über das Menü geht es zurück zum Original.', 'Google translates the page. The menu leads back to the original.'));
  };

  // ---- saving -------------------------------------------------------------------------------------------------------------
  async function currentArticle(tab) {
    if (tab.article && samePage(tab.article.url, tab.url)) return tab.article;
    let art = null;
    if (tab.view && tab.domReady) { try { art = await toArticle(await withTimeout(tab.view.executeJavaScript(SNAPSHOT_SCRIPT), 15000)); } catch {} }
    if (!art) { try { art = fromCatalog(await rpc('catalog:readUrl', tab.url, { follow: false }), tab.url); } catch {} }
    if (art) tab.article = art;
    return art;
  }
  const articlePayload = (art, title) => ({ url: art.url, title: (title || art.title || '').trim().slice(0, 180) || art.title, byline: art.byline, site: art.site, lang: art.lang, excerpt: art.excerpt, html: art.html });
  function webItem(url, title, follow) {
    return { id: 'web:' + url, source: 'web', title: (title || hostOf(url)).slice(0, 180), author: hostOf(url), year: null, language: null, subjects: [], cover: null, description: null,
      formats: [{ type: 'epub', url: 'build://epub', label: 'EPUB' }], readOnlineUrl: url, downloads: null, license: null, canRead: true, kind: 'web', meta: { web: true, url, follow: !!follow } };
  }
  B.saveBook = async ({ title, images, follow }) => {
    const tab = activeTab();
    if (!tab || !isWeb(tab.url)) throw new Error(T('Diese Seite lässt sich nicht speichern.', 'This page cannot be saved.'));
    const url = tab.translatedFrom || tab.url;
    let r, name;
    const art = follow ? null : await currentArticle(tab);
    if (art) {
      r = await rpc('browser:saveBook', { ...articlePayload(art, title), images: images !== false });
      name = r.title || art.title;
    } else {
      // several pages or no article: the catalogue's "Webseite als Buch" pipeline follows "weiter" links
      const item = webItem(url, title || tab.title, follow);
      r = await rpc('catalog:toEpub', item);
      name = item.title;
    }
    sfx('book-place');
    bus.emit('catalog:downloaded', { path: r?.path, bookId: r?.bookId, existed: !!r?.existed, item: { title: name } });
    return { text: r?.existed ? T('„{t}“ stand schon im Regal.', '“{t}” was already on the shelf.', { t: name }) : T('„{t}“ steht jetzt im Regal.', '“{t}” is now on the shelf.', { t: name }), bookId: r?.bookId, path: r?.path };
  };
  B.appendToCollection = async ({ path, name, title, images }) => {
    const tab = activeTab();
    const art = tab && isWeb(tab.url) ? await currentArticle(tab) : null;
    if (!art) throw new Error(T('Auf dieser Seite wurde kein Artikeltext gefunden.', 'No article text was found on this page.'));
    const r = await rpc('browser:appendChapter', { target: path ? { path } : { title: name }, chapter: articlePayload(art, title), images: images !== false });
    sfx('book-place');
    if (r.created) bus.emit('catalog:downloaded', { path: r.path, bookId: r.bookId, item: { title: name } });
    return {
      text: r.created ? T('Sammelband „{n}“ steht im Regal. Erstes Kapitel: „{t}“.', 'Collection “{n}” is on the shelf. First chapter: “{t}”.', { n: name, t: articlePayload(art, title).title })
        : T('Als Kapitel {n} angehängt.', 'Added as chapter {n}.', { n: r.chapters }),
      bookId: r.bookId, path: r.path,
    };
  };
  B.savePdf = async ({ title }) => {
    const tab = activeTab();
    if (!tab || !isWeb(tab.url)) throw new Error(T('Diese Seite lässt sich nicht speichern.', 'This page cannot be saved.'));
    let r;
    if (tab.mode === 'reader' && tab.article) r = await rpc('browser:pdf', { article: articlePayload(tab.article, title) });
    else if (tab.wcId != null) r = await rpc('browser:pdf', { wcId: tab.wcId, title });
    else throw new Error(T('Die Seite ist noch nicht geladen.', 'The page has not loaded yet.'));
    sfx('book-place');
    bus.emit('catalog:downloaded', { path: r.path, bookId: r.bookId, item: { title } });
    return { text: T('Die PDF-Datei steht jetzt im Regal.', 'The PDF is now on the shelf.'), bookId: r.bookId, path: r.path };
  };
  B.shelveDownload = async (d, fmt, onProgress) => {
    let title = String(d.filename || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' ').trim();
    // "pg2229-images.epub" says little: the title of the page that offered the file is the better name
    const page = tabs.find((t) => t.wcId != null && t.wcId === d.id);
    const pageTitle = String(page?.title || '').split(/\s+[|·»]\s+/)[0].trim();
    if ((!title || (!/\s/.test(title) && /\d/.test(title))) && pageTitle && pageTitle !== hostOf(page?.url)) title = pageTitle;
    title = title || hostOf(d.url);
    const item = { id: 'web-dl:' + d.url, source: 'web', title, author: hostOf(d.url), year: null, language: null, subjects: [], cover: null, description: null,
      formats: [{ type: fmt, url: d.url, label: fmt.toUpperCase() }], readOnlineUrl: d.url, downloads: null, license: null, canRead: false, kind: 'web', meta: { url: d.url } };
    const off = typeof api.on === 'function' ? api.on('catalog:progress', (p) => { if (p?.id === item.id && p.total) onProgress?.(Math.min(1, p.received / p.total)); }) : null;
    try {
      const r = await rpc('catalog:download', item, 0);
      sfx('book-place');
      bus.emit('catalog:downloaded', { path: r?.path, bookId: r?.bookId, existed: !!r?.existed, item });
      return r;
    } finally { try { off?.(); } catch {} }
  };
  /** "Jetzt lesen": enabled as soon as the library knows the new book. */
  B.readButton = (bookId) => {
    const b = h('button.br-btn.small', { type: 'button', disabled: true, onclick: () => { bus.emit('book:open', { id: bookId }); } }, T('Jetzt lesen', 'Read now'));
    let n = 0;
    const check = () => {
      if (destroyed || !b.isConnected && n > 2) return;
      const known = (ctx.state?.library?.books || []).some((x) => x.id === bookId);
      if (known) { b.disabled = false; return; }
      if (++n < 60) later(check, 700);
    };
    check();
    return b;
  };

  // ---- context menu of a page -----------------------------------------------------------------------------------------------
  function showContextMenu(tab, p) {
    const items = [];
    const link = isWeb(p.linkURL) ? p.linkURL : '';
    if (link) {
      items.push([T('In neuem Tab öffnen', 'Open in new tab'), 'tabs', () => openTab(link, { background: true })]);
      items.push([T('Im Lesemodus öffnen', 'Open in reader mode'), 'reader', () => openTab(link, { mode: 'reader' })]);
      items.push([T('Später lesen', 'Read later'), 'later', () => { store.addLater(link, (p.linkText || '').trim() || hostOf(link)); showHint(T('In der Leseliste', 'On the reading list')); }]);
      items.push([T('Link kopieren', 'Copy link'), 'link', () => copyText(link)]);
    }
    const sel = String(p.selectionText || '').trim();
    if (sel) {
      items.push([T('Kopieren', 'Copy'), 'link', () => copyText(sel)]);
      items.push([T('Auswahl vorlesen', 'Read the selection aloud'), 'speak', () => bus.emit('tts:speak', { text: sel.slice(0, 20000) })]);
      items.push([T('Suchen nach „{s}“', 'Search for “{s}”', { s: sel.length > 24 ? sel.slice(0, 22) + ' …' : sel }), 'search', () => openTab(parseInput(sel, prefs.searchEngine)?.url || '', {})]);
    }
    if (!link && !sel) {
      items.push([T('Zurück', 'Back'), 'back', () => goBack()]);
      items.push([T('Lesemodus', 'Reader mode'), 'reader', () => openReader(tab)]);
      items.push([T('Später lesen', 'Read later'), 'later', () => toggleLater()]);
    }
    const rect = tab.view?.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    openSheet('context', { items, x: (rect?.left || 0) - pr.left + (p.x || 0), y: (rect?.top || 0) - pr.top + (p.y || 0) });
  }

  // ---- sheets -------------------------------------------------------------------------------------------------------------
  let startInput = null;
  function openSheet(name, opts = {}) {
    closeSheet();
    let s;
    if (name === 'context') s = contextSheet(opts);
    else s = buildSheet(B, name, opts);
    if (!s) return;
    if (name === 'tabs' && !opts.fresh) { const t = activeTab(); if (t) captureThumb(t, () => { if (sheet?.name === 'tabs') openSheet('tabs', { fresh: true }); }); }
    sheet = { name, opts, ...s };
    clear(sheetLayer);
    sheetLayer.hidden = false;
    sheetLayer.dataset.kind = s.kind;
    const box = h('div.br-sheet', { role: s.kind === 'dialog' || s.kind === 'side' ? 'dialog' : 'menu', 'aria-modal': s.kind === 'dialog' ? 'true' : null }, s.el);
    box.classList.add(s.kind);
    if (s.kind === 'context') Object.assign(box.style, { left: Math.round(opts.x) + 'px', top: Math.round(opts.y) + 'px' });
    sheetLayer.append(h('div.br-scrim', { onclick: () => closeSheet(), oncontextmenu: (e) => { e.preventDefault(); closeSheet(); } }), box);
    if (s.kind === 'context') {
      // keep the menu inside the panel
      const pr = panel.getBoundingClientRect(), br = box.getBoundingClientRect();
      if (br.right > pr.right - 8) box.style.left = Math.max(8, Math.round(opts.x - br.width)) + 'px';
      if (br.bottom > pr.bottom - 8) box.style.top = Math.max(8, Math.round(opts.y - br.height)) + 'px';
    }
    // the keyboard lands in the sheet (its field, or the sheet itself: no focus ring on the first button)
    box.tabIndex = -1;
    later(() => { (s.focus || (s.kind === 'menu' || s.kind === 'context' ? box.querySelector('button:not(:disabled)') : box))?.focus({ preventScroll: true }); }, 20);
  }
  function closeSheet() {
    if (!sheet) return;
    sheet = null;
    sheetLayer.hidden = true;
    clear(sheetLayer);
    const tab = activeTab();
    if (tab?.mode === 'web') focusView(tab);
    if (tab?.mode === 'start') renderStartPage();
  }
  B.openSheet = openSheet;
  B.closeSheet = closeSheet;
  B.refresh = () => { renderBar(); if (activeTab()?.mode === 'start') renderStartPage(); };
  function contextSheet({ items }) {
    const el = h('div.br-menu.br-ctx', items.map(([label, ico, fn]) => h('button.br-mitem', { type: 'button', onclick: () => { closeSheet(); fn(); } }, h('span.br-mitem-ico', { html: icon(ico) }), h('span.br-mitem-label', label))));
    return { el, kind: 'context' };
  }

  function captureThumb(tab, done) {
    // only a visible, finished page: capturing a hidden guest fails in Electron ("UnknownVizError")
    if (!tab.view || tab.mode !== 'web' || !tab.domReady || tab.loading || tab.error || tab !== activeTab() || sheet?.kind === 'dialog' || !tab.view.classList.contains('on')) return;
    quiet(withTimeout(tab.view.capturePage(), 3000).then((img) => {
      if (!img || typeof img.toDataURL !== 'function' || img.isEmpty?.()) return;
      const small = typeof img.resize === 'function' ? img.resize({ width: 360 }) : img;
      tab.thumb = small.toDataURL();
      done?.();
    }));
  }

  // ---- hints -------------------------------------------------------------------------------------------------------------
  let hintTimer = null;
  function showHint(text, ms = 2200) {
    hint.textContent = text;
    hint.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = later(() => { hint.hidden = true; }, ms);
  }

  // ---- rendering ----------------------------------------------------------------------------------------------------------
  function render() {
    if (destroyed) return;
    const tab = activeTab();
    applyTheme();
    for (const t of tabs) if (t.view) t.view.classList.toggle('on', t === tab && t.mode === 'web' && !t.error);
    const mode = tab ? tab.mode : 'start';
    panel.dataset.mode = mode;
    // a map application (Google Maps, Street View): no page-turn strips, no page counter
    panel.classList.toggle('br-app', mode === 'web' && isAppPage(tab?.url));
    startEl.hidden = mode !== 'start';
    if (mode === 'start') renderStartPage();
    if (mode !== 'reader') reader.hide();
    renderError(tab);
    renderBar(); renderProgress(); renderStatus();
  }
  B.render = render;

  function renderStartPage() {
    if (activeTab()?.mode !== 'start' || destroyed) return;
    const focused = document.activeElement === startInput;
    const val = startInput?.value || '';
    startInput = renderStart(B, startEl);
    if (focused) { startInput.value = val; startInput.focus(); }
  }

  function renderError(tab) {
    const e = tab?.error;
    errorEl.hidden = !e || tab.mode !== 'web';
    if (errorEl.hidden) return;
    clear(errorEl);
    const offline = /INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|-106|-105/.test(String(e.code) + e.text);
    errorEl.append(h('div.br-error-card',
      h('span.br-error-ico', { html: icon('reader') }),
      h('h2', e.code === 'crashed' ? T('Die Seite ist abgestürzt', 'The page crashed') : T('Die Seite konnte nicht geladen werden', 'The page could not be loaded')),
      h('p', offline ? T('Es besteht keine Verbindung zu {h}. Bitte die Internetverbindung prüfen.', 'No connection to {h}. Please check the internet connection.', { h: hostOf(e.url) || e.url }) : displayUrl(e.url)),
      e.text && e.code !== 'crashed' ? h('p.br-error-code', `${e.text} (${e.code})`) : null,
      h('div.br-error-actions',
        h('button.br-btn.primary', { type: 'button', onclick: () => reload(tab) }, T('Erneut versuchen', 'Try again')),
        h('button.br-btn', { type: 'button', onclick: () => { tab.error = null; openReader(tab, { force: true }); } }, T('Im Lesemodus versuchen', 'Try reader mode')),
        h('button.br-btn', { type: 'button', onclick: () => api.app?.openExternal?.(e.url) }, T('Im Systembrowser öffnen', 'Open in the system browser')))));
  }

  function renderBar() {
    if (destroyed) return;
    const tab = activeTab();
    const web = !!tab && isWeb(tab.url);
    btnBack.disabled = !(tab?.canBack || (tab?.mode === 'reader' && tab.view));
    btnFwd.disabled = !tab?.canForward;
    const loading = !!tab?.loading && tab.mode !== 'start';
    btnReload.innerHTML = icon(loading ? 'close' : 'reload');
    btnReload.title = loading ? T('Laden abbrechen', 'Stop loading') : T('Neu laden (F5)', 'Reload (F5)');
    btnReload.disabled = !web;
    if (document.activeElement !== address) address.value = web ? displayUrl(tab.translatedFrom || tab.url) : '';
    const secure = web && /^https:/i.test(tab.url);
    lockEl.innerHTML = web ? `<svg class="br-ico" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${secure ? '<rect x="5.5" y="10.5" width="13" height="9.5" rx="1.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>' : '<path d="M12 4.5l8.5 15h-17z"/><path d="M12 10v4.5M12 17.2v.1"/>'}</g></svg>` : icon('search');
    lockEl.title = !web ? '' : secure ? T('Verschlüsselte Verbindung', 'Encrypted connection') : T('Unverschlüsselte Verbindung', 'Unencrypted connection');
    lockEl.classList.toggle('insecure', web && !secure);
    const marked = web && !!store.bookmarkOf(tab.translatedFrom || tab.url);
    btnStar.innerHTML = icon(marked ? 'star-on' : 'star');
    btnStar.classList.toggle('on', marked);
    btnStar.disabled = !web;
    btnReader.classList.toggle('on', tab?.mode === 'reader');
    btnReader.disabled = !web || isAppPage(tab?.url);
    btnReader.setAttribute('aria-pressed', tab?.mode === 'reader' ? 'true' : 'false');
    tabCount.textContent = String(tabs.length);
    btnSpeak.disabled = !web;
    btnSpeak.classList.toggle('on', tts.active);
  }
  function renderProgress() {
    const tab = activeTab();
    const on = !!tab?.loading && tab.mode !== 'start';
    progressEl.classList.toggle('on', on);
  }
  function renderStatus() {
    if (destroyed) return;
    const tab = activeTab();
    const title = !tab || tab.mode === 'start' ? T('Startseite', 'Start page') : tab.mode === 'reader' && tab.article ? tab.article.title : (tab.title || hostOf(tab.url));
    stTitle.textContent = title;
    stTitle.title = title;
    renderPage();
    renderHover();
    const n = tab?.blocked || 0;
    stShieldCount.textContent = prefs.adblock && n ? String(n > 999 ? '999+' : n) : '';
    btnShield.classList.toggle('off', !prefs.adblock || !prefs.js || !prefs.images || prefs.textOnly);
    btnShield.title = prefs.adblock ? T('Schutz und Schalter ({n} blockiert)', 'Protection and switches ({n} blocked)', { n }) : T('Schutz und Schalter (Blocker aus)', 'Protection and switches (blocker off)');
  }
  function renderPage() {
    const tab = activeTab();
    let p = null;
    if (tab?.mode === 'reader' && reader.visible) p = reader.pos();
    else if (tab?.mode === 'web' && tab.webPos) p = { page: tab.webPos.page, pages: tab.webPos.pages, progress: tab.webPos.atEnd ? 1 : tab.webPos.frac };
    stPage.textContent = p && p.pages ? T('Seite {a} von {b}', 'Page {a} of {b}', { a: p.page, b: p.pages }) : '';
    stTrack.hidden = !p || !p.pages;
    stTrack.firstChild.style.width = p ? Math.round(Math.max(0, Math.min(1, p.progress)) * 100) + '%' : '0';
    turnPrev.disabled = !p || p.page <= 1;
    turnNext.disabled = !p || (tab?.mode === 'reader' ? p.page >= p.pages : !!tab?.webPos?.atEnd);
  }
  function renderHover() {
    const tab = activeTab();
    const u = tab?.mode === 'web' ? tab.hoverUrl : '';
    stHover.hidden = !u;
    stHover.textContent = u ? displayUrl(u) : '';
    stTitle.hidden = !!u;
  }

  // ---- address field with suggestions ----------------------------------------------------------------------------------------
  let sugItems = [], sugIndex = -1;
  function suggestions(q) {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const out = [], seen = new Set();
    const add = (url, title, kind) => { const k = cleanUrl(url); if (seen.has(k) || out.length >= 7) return; seen.add(k); out.push({ url, title, kind }); };
    const d = store.data;
    const hit = (x) => (x.title || '').toLowerCase().includes(s) || (x.url || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').includes(s);
    for (const b of d.bookmarks) if (hit(b)) add(b.url, b.title, 'bookmark');
    for (const r of d.readingList) if (hit(r)) add(r.url, r.title, 'later');
    for (const e of d.history) if (hit(e)) add(e.url, e.title, 'clock');
    const parsed = parseInput(q, prefs.searchEngine);
    if (parsed?.query) out.unshift({ url: parsed.url, title: T('Suchen nach „{q}“ mit {e}', 'Search for “{q}” with {e}', { q: parsed.query, e: (SEARCH_ENGINES[prefs.searchEngine] || SEARCH_ENGINES.duckduckgo).name }), kind: 'search' });
    else if (parsed) out.unshift({ url: parsed.url, title: T('Öffnen: {u}', 'Open: {u}', { u: displayUrl(parsed.url) }), kind: 'forward' });
    return out.slice(0, 8);
  }
  function renderSuggest() {
    clear(suggestEl);
    suggestEl.hidden = !sugItems.length;
    sugItems.forEach((s, i) => suggestEl.appendChild(h('div.br-sug' + (i === sugIndex ? '.on' : ''), {
      role: 'option', 'aria-selected': i === sugIndex ? 'true' : 'false',
      onmousedown: (e) => { e.preventDefault(); address.blur(); navigate(s.url); },
    }, h('span.br-sug-ico', { html: icon(s.kind) }), h('span.br-sug-title', s.title || hostOf(s.url)), s.kind !== 'search' && s.kind !== 'forward' ? h('span.br-sug-url', displayUrl(s.url)) : null)));
  }
  address.addEventListener('focus', () => { address.select(); });
  address.addEventListener('blur', () => { later(() => { sugItems = []; renderSuggest(); renderBar(); }, 120); });
  address.addEventListener('input', () => { sugItems = suggestions(address.value); sugIndex = -1; renderSuggest(); });
  address.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && sugItems.length) { e.preventDefault(); sugIndex = (sugIndex + 1) % sugItems.length; renderSuggest(); return; }
    if (e.key === 'ArrowUp' && sugItems.length) { e.preventDefault(); sugIndex = (sugIndex - 1 + sugItems.length) % sugItems.length; renderSuggest(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const pick = sugIndex >= 0 ? sugItems[sugIndex] : null;
      const value = address.value;
      sugItems = []; renderSuggest();
      address.blur();
      if (pick) navigate(pick.url, { newTab: e.altKey });
      else if (value.trim()) navigate(value, { newTab: e.altKey });
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (sugItems.length) { sugItems = []; renderSuggest(); return; }
      address.blur();
      focusView(activeTab());
    }
  });

  // ---- keyboard ---------------------------------------------------------------------------------------------------------------
  let escAt = 0;
  const typingIn = (el) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
  /** k: { key, ctrl, shift, alt, fromGuest, passive }. true = handled. */
  function handleKey(k) {
    const key = k.key;
    const lower = String(key || '').toLowerCase();
    const tab = activeTab();
    if (key === 'Escape') {
      if (sheet) { closeSheet(); return true; }
      if (sugItems.length) { sugItems = []; renderSuggest(); return true; }
      if (find.open) { closeFind(); return true; }
      if (tts.closeMenu()) return true;
      if (ttsBusy()) { tts.stop(true); return true; }
      if (tab?.fullscreen) { exec(tab, 'document.fullscreenElement && document.exitFullscreen()'); return true; }
      if (typingIn(document.activeElement) && panel.contains(document.activeElement)) { document.activeElement.blur(); return true; }
      if (k.fromGuest && Date.now() - escAt > 2500) {
        escAt = Date.now();
        try { tab?.view?.blur(); } catch {}
        panel.focus({ preventScroll: true });
        showHint(T('Esc noch einmal schließt den Lesebrowser', 'Press Esc again to close the reading browser'), 2500);
        return true;
      }
      if (onClose) { onClose(); return true; }
      return false;
    }
    if (k.ctrl) {
      if (lower === 't' && k.shift) { restoreClosed(); return true; }
      if (lower === 't') { newTab(); return true; }
      if (lower === 'w') { closeTab(); return true; }
      if (lower === 'tab') { cycleTab(k.shift ? -1 : 1); return true; }
      if (lower === 'pagedown') { cycleTab(1); return true; }
      if (lower === 'pageup') { cycleTab(-1); return true; }
      if (lower === 'l') { focusAddress(); return true; }
      if (lower === 'd') { toggleBookmark(); return true; }
      if (lower === 'f') { openFind(); return true; }
      if (lower === 'h') { openSheet('library', { tab: 'history' }); return true; }
      if (lower === 's') { if (tab && isWeb(tab.url)) openSheet('save', { mode: 'book' }); return true; }
      if (lower === 'p') { if (tab && isWeb(tab.url)) openSheet('save', { mode: 'pdf' }); return true; }
      if (lower === 'r') { reload(); return true; }
      if (key === '+' || key === '=' || key === 'Add') { zoom(1); return true; }
      if (key === '-' || key === 'Subtract') { zoom(-1); return true; }
      if (key === '0') { zoom(0); return true; }
      return false;
    }
    if (k.alt) {
      if (key === 'ArrowLeft') { goBack(); return true; }
      if (key === 'ArrowRight') { goForward(); return true; }
      if (key === 'Home') { const t = activeTab(); if (t) { if (t.mode === 'reader') closeReader(t); loadStart(t); } return true; }
      return false;
    }
    if (key === 'F5') { reload(); return true; }
    if (key === 'F6') { focusAddress(); return true; }
    if (key === 'F3') { if (!find.open) openFind(); else runFind(false, k.shift); return true; }
    if (k.fromGuest) return false;
    if (sheet && sheet.kind !== 'context') return false;
    if (sheet) closeSheet();
    // in a map the keys belong to the page: the first one puts the focus there instead of turning a page
    if (tab?.mode === 'web' && tab.view && isAppPage(tab.url)) {
      if ([' ', 'Spacebar', 'PageDown', 'PageUp', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Backspace'].includes(key) || lower === 'r' || lower === 'v') { focusView(tab); return true; }
    }
    switch (key) {
      case ' ': case 'Spacebar': pageTurn(k.shift ? -1 : 1); return true;
      case 'PageDown': case 'ArrowRight': pageTurn(1); return true;
      case 'PageUp': case 'ArrowLeft': pageTurn(-1); return true;
      case 'ArrowDown': lineScroll(1); return true;
      case 'ArrowUp': lineScroll(-1); return true;
      case 'Home': edge(false); return true;
      case 'End': edge(true); return true;
      case 'Backspace': goBack(); return true;
      default: break;
    }
    if (lower === 'r' && !k.shift) { toggleReader(); return true; }
    if (lower === 'v' && !k.shift) { if (tab && isWeb(tab.url)) tts.toggle(); return true; }
    if (lower === 'v' && k.shift) { tts.openMenu(tts.active ? null : btnSpeak); return true; }   // the voice menu (tts.js)
    return false;
  }
  function focusAddress() { address.focus(); address.select(); }
  function loadStart(tab) {
    destroyView(tab);
    Object.assign(tab, { url: '', title: '', mode: 'start', article: null, error: null, webPos: null, canBack: false, canForward: false });
    render();
  }
  // Ctrl shortcuts also work while the address field or a sheet input has the focus (main.js skips inputs)
  panel.addEventListener('keydown', (e) => {
    if (!typingIn(e.target)) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const lower = e.key.toLowerCase();
    if (!['t', 'w', 'tab', 'pagedown', 'pageup', 'd', 'h', 'l'].includes(lower)) return;
    if (handleKey({ key: e.key, ctrl: true, shift: e.shiftKey, alt: e.altKey })) { e.preventDefault(); e.stopPropagation(); }
  });
  panel.tabIndex = -1;
  reader.el.tabIndex = -1;

  // ---- events from the main process ---------------------------------------------------------------------------------------------
  const listen = (ch, fn) => { if (typeof api.on === 'function') { const off = api.on(ch, fn); if (typeof off === 'function') offs.push(off); } };
  const tabOf = (wcId) => tabs.find((t) => t.wcId != null && t.wcId === wcId) || null;
  listen('browser:key', (k) => {
    if (!k || destroyed) return;
    const tab = tabOf(k.id);
    if (!tab || tab !== activeTab()) return;
    handleKey({ key: k.key, ctrl: !!k.ctrl, shift: !!k.shift, alt: !!k.alt, fromGuest: true, passive: !!k.passive });
  });
  listen('browser:popup', (p) => {
    if (!p || destroyed) return;
    const tab = tabOf(p.id);
    if (!tab || !isWeb(p.url)) return;
    openTab(p.url, { background: p.disposition === 'background-tab', after: tab });
  });
  listen('browser:download', (d) => {
    if (!d || destroyed || !isWeb(d.url)) return;
    if (d.id != null && !tabOf(d.id)) return;
    openSheet('download', { download: d });
  });
  listen('browser:blocked', (b) => {
    const tab = b && tabOf(b.id);
    if (!tab) return;
    tab.blocked = b.count || 0;
    if (tab === activeTab()) renderStatus();
  });
  offs.push(store.onChange(() => { if (!destroyed) { renderBar(); if (activeTab()?.mode === 'start' && !sheet) renderStartPage(); } }));
  offs.push(onTheme(() => { if (destroyed) return; const before = panel.dataset.theme; applyTheme(); if (panel.dataset.theme !== before) { for (const t of tabs) applyGuest(t); render(); } }));
  offs.push(bus.on('i18n:change', () => {
    btnReader.querySelector('.br-readbtn-label').textContent = T('Lesemodus', 'Reader');
    render(); if (find.open) renderFind();
    if (sheet) openSheet(sheet.name, sheet.opts);
  }));

  // ---- session -------------------------------------------------------------------------------------------------------------------
  let sessionTimer = null;
  function sessionSnapshot() {
    return {
      tabs: tabs.map((t) => ({ url: t.translatedFrom || t.url, title: t.title, mode: t.mode, frac: t.mode === 'reader' ? t.readerProgress : t.webPos?.frac || t.pendingFrac || 0 })),
      active: Math.max(0, tabs.indexOf(activeTab())),
    };
  }
  function saveSessionSoon() {
    if (!booted) return;
    clearTimeout(sessionTimer);
    sessionTimer = later(() => store.saveSession(sessionSnapshot()), 1200);
  }

  // ---- boot -----------------------------------------------------------------------------------------------------------------------
  async function boot() {
    let legacy = null;
    try {
      const s = (await api.settings?.get?.()) || {};
      legacy = s.browser || null;
      prefs = normalizePrefs(s.browser || {});
      lastSites = { ...prefs.sites };
    } catch { prefs = normalizePrefs({}); }
    applyTheme();
    try { const i = await rpc('browser:info'); if (i) info = i; } catch {}
    await store.load(legacy);
    if (legacy && (Array.isArray(legacy.bookmarks) || Array.isArray(legacy.history))) quiet(api.settings?.set?.({ browser: { bookmarks: null, history: null, fontIndex: null, paged: null } }));
    if (destroyed) return;
    const saved = prefs.restoreSession ? store.data.session : null;
    if (saved?.tabs?.length) {
      for (const t of saved.tabs) tabs.push(makeTab({ url: t.url, title: t.title, mode: t.mode, progress: t.frac || 0 }));
    }
    const wanted = isWeb(params.url) ? params.url : params.url ? parseInput(params.url, prefs.searchEngine)?.url : null;
    let first = tabs[saved?.active ?? 0] || null;
    if (wanted) {
      const have = tabs.find((t) => samePage(t.url, wanted));
      if (have) { first = have; if (params.reader) { have.mode = 'reader'; have.wantReader = true; } }
      else { const t = makeTab({ url: wanted, mode: params.reader ? 'reader' : 'web' }); tabs.push(t); first = t; }
    }
    if (!tabs.length) tabs.push(makeTab({}));
    booted = true;
    activate(first || tabs[0]);
    if (!canWebview && first && isWeb(first.url)) openReader(first);
  }
  // the app may quit with a settings write or a session save still waiting in a timer
  const flushNow = () => { if (prefsTimer) persistPrefs(true); try { if (booted) store.saveSession(sessionSnapshot()); } catch {} quiet(store.flush()); };
  window.addEventListener('beforeunload', flushNow);
  offs.push(() => window.removeEventListener('beforeunload', flushNow));

  // handle for build/scripts/browser-check.js (state inspection in the Electron tests)
  Object.defineProperty(panel, '__br', { value: B, configurable: true });
  B.handleKey = (k) => handleKey(k);
  B.pageTurn = (d) => pageTurn(d);
  B.openReader = () => openReader(activeTab());
  B.closeReader = () => closeReader(activeTab());

  applyTheme();
  render();
  boot().catch((e) => { console.error('[browser] start failed', e); if (!tabs.length) { tabs.push(makeTab({})); booted = true; activate(tabs[0]); } });

  return {
    /** Catalogue: open another address while the browser is open (a new tab keeps the current page). */
    go(url) { if (isWeb(url)) openTab(url, {}); else if (url) navigate(url, { newTab: true }); },
    /** the mouse's side buttons (panels.js): back and forward in the current tab */
    onNav(dir) { if (destroyed) return false; if (dir < 0) goBack(); else goForward(); return true; },
    unmount() {
      if (destroyed) return;
      try { if (booted) store.saveSession(sessionSnapshot()); } catch {}
      try { tts.stop(true); tts.destroy(); } catch {}
      destroyed = true;
      if (prefsTimer) persistPrefs(true);
      clearTimeout(sessionTimer); clearTimeout(progressTimer); clearTimeout(hintTimer); clearTimeout(readerTimer);
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const off of offs.splice(0)) { try { off?.(); } catch {} }
      quiet(store.flush());
      reader.destroy();
      return Promise.all(tabs.map((t) => destroyView(t)));
    },
    onKey(e) {
      if (destroyed) return false;
      if (typingIn(e.target) && e.key !== 'Escape') return false;
      // a focused button, link or list keeps its own Space and Enter (keyboard use of the chrome)
      if ((e.key === ' ' || e.key === 'Enter') && e.target?.closest?.('button, [role="button"], [role="switch"], a[href], select, summary')) return false;
      return handleKey({ key: e.key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey, repeat: e.repeat });
    },
  };
}

export default { mount, createBrowser };
