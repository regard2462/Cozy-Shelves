// Reader panel: full-screen book reading on top of the 3D library.
// Renders EPUB/MOBI/AZW3/FB2/CBZ/PDF with foliate-js and TXT/MD/HTML/DOCX/RTF through a small
// text→book adapter (text-book.js). Themes, page-turn animation, bookmarks, annotations,
// dictionary/translation/Wikipedia, sidebar (TOC/bookmarks/notes/search/chess positions), TTS and
// a chess side pane for chess books. See docs/CONTRACTS.md.
import { h, $, clear, formatDuration } from '../../core/dom.js';
import { tr } from '../../core/i18n.js';
import { makeTextBook } from './text-book.js';
import { DEFAULTS, THEMES, FONTS, PAGE_THEME_FOR_UI, FONT_SIZES, bookCSS, pageLayout, migrateReader, loadFont } from './reader-styles.js';
import { typographyGroups, textViewGroup, switchRow } from './reader-aa.js';
import { createTextViewSwitch } from './reader-textview.js';
import { pdfPageCfi, pageOfPdfCfi } from './pdf-text-view.js';
import { createPageTheme } from './page-theme.js';
import { currentTheme, onTheme, THEME_LABELS } from '../../core/theme.js';
import { createAnnotations } from './annotations.js';
import { createSidebar } from './sidebar.js';
import { createTTS } from './reader-tts.js';
import { createSnip } from './reader-snip.js';
import { createSearchHit, SEARCH_ICON } from './reader-hit.js';
import { fetchReadable, openSystemBrowser, openBrowserPanel, resolveUrl, isHttpUrl, isLocalUrl, hostOf, externalLabel, fileUrlFromPath, pathFromFileUrl, localizeResources } from './link-nav.js';

const VENDOR = new URL('vendor/foliate-js/', document.baseURI).href;
const FOLIATE_FORMATS = ['pdf', 'epub', 'mobi', 'azw3', 'fb2', 'fbz', 'cbz'];
const sessionState = { chessOpen: new Map() }; // per-session UI state (chess pane) keyed by book id

// pdf.js 5.5 uses the "Map upsert" proposal (Chromium ≥ 142); older Chromiums (e.g. Playwright's) get a tiny polyfill
for (const [proto, name, fn] of [
  [Map.prototype, 'getOrInsertComputed', function (k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); }],
  [Map.prototype, 'getOrInsert', function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); }],
  [WeakMap.prototype, 'getOrInsertComputed', function (k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); }],
  [WeakMap.prototype, 'getOrInsert', function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); }],
]) if (typeof proto[name] !== 'function') Object.defineProperty(proto, name, { value: fn, writable: true, configurable: true });

let foliateMods = null;
async function loadFoliate() {
  if (!foliateMods) {
    const [view, CFI, overlayer] = await Promise.all([
      import(/* @vite-ignore */ VENDOR + 'view.js'),
      import(/* @vite-ignore */ VENDOR + 'epubcfi.js'),
      import(/* @vite-ignore */ VENDOR + 'overlayer.js'),
    ]);
    foliateMods = { makeBook: view.makeBook, CFI, Overlayer: overlayer.Overlayer };
  }
  return foliateMods;
}

const str = (x) => {
  if (!x) return '';
  if (typeof x === 'string') return x;
  if (Array.isArray(x)) return x.map(str).filter(Boolean).join(', ');
  if (typeof x === 'object') return str(x.name ?? Object.values(x)[0]);
  return String(x);
};
const extOf = (url) => (String(url || '').split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
const pct = (f) => Math.round(Math.max(0, Math.min(1, f || 0)) * 100);

/* ---------- overlay for fixed-layout documents (PDF), since foliate only overlays reflowable pages ---------- */
class DocOverlay {
  constructor(doc) {
    this.doc = doc; this.map = new Map();
    this.svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    Object.assign(this.svg.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none', zIndex: '5', overflow: 'visible' });
    this.resize();
    doc.body.appendChild(this.svg);
  }
  resize() { const de = this.doc.documentElement; this.svg.setAttribute('width', de.scrollWidth || 1); this.svg.setAttribute('height', de.scrollHeight || 1); }
  #rects(range) {
    const dpr = window.devicePixelRatio || 1;
    const sx = this.doc.defaultView.scrollX || 0, sy = this.doc.defaultView.scrollY || 0;
    return Array.from(range.getClientRects(), (r) => ({ left: (r.left + sx) * dpr, top: (r.top + sy) * dpr, width: r.width * dpr, height: r.height * dpr, right: (r.right + sx) * dpr, bottom: (r.bottom + sy) * dpr }));
  }
  add(key, range, draw, options) {
    if (this.map.has(key)) this.remove(key);
    if (typeof range === 'function') range = range(this.doc);
    this.resize();
    const clientRects = Array.from(range.getClientRects());
    const el = draw(this.#rects(range), options);
    this.svg.appendChild(el);
    this.map.set(key, { range, draw, options, element: el, clientRects });
  }
  remove(key) { const o = this.map.get(key); if (!o) return; o.element.remove(); this.map.delete(key); }
  redraw() { for (const [k, o] of [...this.map.entries()]) this.add(k, o.range, o.draw, o.options); }
  hitTest({ x, y }) {
    const arr = [...this.map.entries()];
    for (let i = arr.length - 1; i >= 0; i--) { const [key, o] = arr[i]; for (const r of o.clientRects) if (r.top <= y && r.left <= x && r.bottom > y && r.right > x) return [key, o.range]; }
    return [];
  }
}

export async function mount(container, ctx, params = {}) {
  const { api, bus } = ctx;
  const id = params.id || null;
  const settingsAll = ctx.state?.settings || (await api.settings.get().catch(() => ({}))) || {};
  const settings = { ...DEFAULTS, ...(settingsAll.reader || {}) };
  const widthMigrated = migrateReader(settings);   // the margin presets of 0.6 → page width (the main process does it as well)
  if (!FONTS[settings.font]) settings.font = DEFAULTS.font;
  // Until a page colour is chosen in the reader, the pages follow the appearance: paper with "Hell", sepia with
  // "Sepia", night pages with "Dunkel". The stored value stays 'paper' then, so a later change of the appearance
  // still counts. The switch "Wie das Erscheinungsbild" in the Aa menu returns to that.
  let pagesFollowUi = !settings.themeChosen && (settings.theme || 'paper') === 'paper';
  const uiPageTheme = () => PAGE_THEME_FOR_UI[currentTheme()] || 'paper';
  if (pagesFollowUi) settings.theme = uiPageTheme();
  const storedReader = () => ({ ...settings, theme: pagesFollowUi ? 'paper' : settings.theme });
  const uiLang = ctx.i18n?.lang || settingsAll.language || 'de';

  /* ---------- reader instance shared with the sub-modules ---------- */
  const R = {
    ctx, api, bus, params, id, settings, uiLang, VENDOR,
    record: null, fbook: null, view: null, CFI: null, Overlayer: null, isFixed: false, loc: null, closed: false,
    lang: 'de', title: '', author: '', els: {}, docOverlays: new WeakMap(), docIndex: new WeakMap(), chess: null,
    bookUrl: null, docUrl: null, baseHref: null,
  };
  // in-app link navigation: a back/forward stack of reading targets (book ↔ fetched web pages)
  const nav = { back: [], fwd: [], busy: false };
  let bookState = null; // last progress/excerpt of the library book itself (see emitClosed)
  const T = (de, en, vars) => tr({ de, en }, vars);
  R.T = T;
  R.toast = (m) => ctx.toast?.(m);

  /* ---------- DOM ---------- */
  const els = R.els;
  els.root = h('div.panel.full.rd-root', { dataset: { theme: settings.theme }, tabindex: -1 });
  els.main = h('div.rd-main');
  els.stage = h('div.rd-stage');
  els.paper = h('div.rd-paper');
  els.view = document.createElement('foliate-view'); els.view.className = 'rd-view';
  els.fold = h('div.rd-fold');
  els.zoneL = h('button.rd-zone.rd-zone-left', { title: T('Vorherige Seite (←)', 'Previous page (←)'), onclick: () => turn('left') }, h('span', '‹'));
  els.zoneR = h('button.rd-zone.rd-zone-right', { title: T('Nächste Seite (→)', 'Next page (→)'), onclick: () => turn('right') }, h('span', '›'));
  els.loading = h('div.rd-loading', h('div.rd-spinner'), h('div.rd-loading-text', T('Buch wird geöffnet …', 'Opening book …')));

  // top bar
  els.title = h('span.rd-title');
  els.author = h('span.rd-author');
  els.chapter = h('span.rd-chapter');
  const btn = (cls, label, title, onclick, key) => h(`button.rd-btn${cls ? '.' + cls : ''}`, { title: title + (key ? ` [${key}]` : ''), onclick, 'aria-label': title }, label);
  els.btnBack = btn('rd-btn-nav', '‹', T('Zurück', 'Back'), () => goBack(), 'Alt+←');
  els.btnFwd = btn('rd-btn-nav', '›', T('Vorwärts', 'Forward'), () => goForward(), 'Alt+→');
  els.btnExt = btn('rd-btn-ext', '↗', externalLabel(), () => openCurrentExternally());
  els.crumbs = h('div.rd-crumbs.hidden');
  els.btnBookmark = btn('rd-btn-bookmark', '🔖', T('Lesezeichen setzen/entfernen', 'Toggle bookmark'), () => toggleBookmark(), 'B');
  els.btnToc = btn('', '☰', T('Inhalt, Lesezeichen, Notizen, Suche', 'Contents, bookmarks, notes, search'), () => R.sidebar.toggle(), 'T');
  els.btnTts = btn('', '🔈', T('Vorlesen', 'Read aloud'), () => R.tts.toggle(), 'V');
  // the voice menu at the read-aloud icon: the arrow, a right click on the icon, or Shift+V (reader-tts.js)
  els.btnTtsMenu = btn('rd-btn-ttsmenu', '▾', T('Stimme und Tempo', 'Voice and speed'), () => R.tts.openMenu(els.btnTtsMenu), T('Umschalt+V', 'Shift+V'));
  els.btnTtsMenu.setAttribute('aria-haspopup', 'dialog');
  els.btnTts.addEventListener('contextmenu', (e) => { e.preventDefault(); R.tts.openMenu(els.btnTtsMenu); });
  els.btnChess = btn('', '♞', T('Schachbrett ein/aus', 'Toggle chess board'), () => toggleChess(), 'C');
  els.btnSettings = btn('', 'Aa', T('Darstellung', 'Appearance'), () => toggleSettings(), 'S');
  els.btnClose = btn('rd-btn-close', '✕', T('Schließen', 'Close'), () => closeReader(), 'Esc');
  els.top = h('div.rd-top', h('div.rd-top-left', h('div.rd-nav', els.btnBack, els.btnFwd), els.title, h('span.rd-sep', '·'), els.author), h('div.rd-top-center', els.chapter),
    h('div.rd-top-right', els.btnExt, els.btnBookmark, els.btnToc, els.btnTts, els.btnTtsMenu, els.btnChess, els.btnSettings, els.btnClose));
  // bottom bar
  els.slider = h('input.rd-slider', { type: 'range', min: 0, max: 1, step: 0.0001, value: 0, list: 'rd-ticks-' + (id || 'dev'), oninput: (e) => onSliderInput(e), onchange: (e) => onSliderChange(e) });
  els.ticks = h('datalist', { id: 'rd-ticks-' + (id || 'dev') });
  els.pageLabel = h('span.rd-page');
  els.percent = h('span.rd-percent');
  els.timeLeft = h('span.rd-timeleft');
  els.bottom = h('div.rd-bottom', els.pageLabel, h('div.rd-slider-wrap', els.slider, els.ticks), els.percent, els.timeLeft);
  els.ribbon = h('div.rd-ribbon', { title: T('Lesezeichen', 'Bookmark') });
  els.turnLayer = h('div.rd-turn-layer');
  els.settings = h('div.rd-settings.hidden');
  els.notice = h('div.rd-notice.hidden');
  els.chess = h('div.rd-chess.hidden');

  els.stage.append(els.paper, els.view, els.fold, els.turnLayer, els.ribbon, els.zoneL, els.zoneR, els.top, els.crumbs, els.bottom, els.settings, els.notice, els.loading);
  els.main.append(els.stage, els.chess);
  els.root.append(els.main);
  container.appendChild(els.root);

  // sub-modules
  R.pageTheme = createPageTheme();   // page colours of PDF and comic pages
  R.annotations = createAnnotations(R);
  R.sidebar = createSidebar(R);
  R.tts = createTTS(R);
  R.snip = createSnip(R);   // diagram snip for the chess pane
  els.stage.append(R.sidebar.el, R.annotations.el, R.tts.el);
  // the full-text search: a hit opens here with its words marked, Strg+F and this button search all books
  R.hit = createSearchHit(R);
  els.btnFwd.parentNode.after(R.hit.el);
  els.btnFts = btn('rd-btn-fts', '', T('In allen Büchern suchen', 'Search all books'), () => R.hit.openPanel(), T('Strg+F', 'Ctrl+F'));
  els.btnFts.innerHTML = SEARCH_ICON;
  els.btnToc.before(els.btnFts);
  // the text view of PDFs (reader-textview.js); the hooks reach into this panel
  R.tvs = createTextViewSwitch(R, {
    flushSave: () => flushSave(),
    showLoading: (t) => showLoading(t),
    hideLoading: () => hideLoading(),
    persist: () => persistSettings(),
    afterOpen: () => { applySettings(); renderTicks(); },
    afterSwitch: () => { R.sidebar.refresh(); updateRibbon(); renderNav(); if (!els.settings.classList.contains('hidden')) renderSettings(); showChrome(); },
  });

  /* ---------- chrome auto-hide ---------- */
  let hideTimer = null;
  let padBars = false;   // the gamepad's ring rests on the bars (input/pad-panels.js): they stay
  const popupOpen = () => !els.settings.classList.contains('hidden') || R.sidebar.isOpen() || R.annotations.isOpen() || R.tts.isActive();
  const showChrome = () => {
    els.root.classList.remove('rd-chrome-hidden');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!popupOpen() && !padBars && !els.top.matches(':hover') && !els.bottom.matches(':hover')) els.root.classList.add('rd-chrome-hidden'); }, 2800);
  };
  R.showChrome = showChrome;
  els.stage.addEventListener('mousemove', showChrome);
  els.stage.addEventListener('mousedown', (e) => { if (e.target.closest?.('.rd-annot, .rd-top, .rd-bottom, .rd-sidebar, .rd-settings, .rd-ttsbar')) return; if (!R.annotations.isOpen()) R.annotations.hideToolbar(); });
  showChrome();

  /* ---------- helpers exposed to modules ---------- */
  R.currentDoc = () => R.view?.renderer?.getContents?.()[0]?.doc || null;
  R.docs = () => (R.view?.renderer?.getContents?.() || []).map((c) => c.doc).filter(Boolean);
  /** foliate's overlayer for `doc`, or our own fixed-layout overlay. With `create` false (the default)
   *  no overlay is built, so callers that only remove marks (TTS) cannot inject a stray <svg> into a
   *  reflowable section body (finding 9). */
  R.overlayFor = (doc, create = false) => {
    if (!R.view?.renderer) return null;
    const c = R.view.renderer.getContents().find((x) => x.doc === doc);
    if (c?.overlayer) return c.overlayer;
    const existing = R.docOverlays.get(doc);
    if (existing) return existing;
    // only fixed-layout pages (PDF) need our own overlay; a reflowable section gets foliate's one
    // lazily, so building one here would leave a stray <svg> in the book body
    if (!(create || R.isFixed) || !doc?.body) return null;
    const o = new DocOverlay(doc);
    R.docOverlays.set(doc, o);
    return o;
  };
  R.stageRect = () => els.stage.getBoundingClientRect();
  /** rect of a Range inside a section document, in stage coordinates */
  R.rangeRect = (range, doc) => {
    doc = doc || range.startContainer?.ownerDocument;
    const frame = doc?.defaultView?.frameElement;
    if (!frame) return null;
    const fr = frame.getBoundingClientRect();
    let rr = range.getBoundingClientRect();
    if (!rr.width && !rr.height) { const rects = range.getClientRects(); if (rects.length) rr = rects[0]; }
    const sr = R.stageRect();
    // fixed layout iframes are CSS-scaled; map through the frame's scale
    const scaleX = frame.offsetWidth ? fr.width / frame.offsetWidth : 1, scaleY = frame.offsetHeight ? fr.height / frame.offsetHeight : 1;
    return { left: fr.left - sr.left + rr.left * scaleX, top: fr.top - sr.top + rr.top * scaleY, width: rr.width * scaleX, height: rr.height * scaleY };
  };
  /** the layout of reflowable pages for the page width (reader-styles.js pageLayout) in the reading area of now */
  const layoutNow = () => pageLayout(settings, els.view.clientWidth || els.stage.clientWidth, els.view.clientHeight || els.stage.clientHeight);
  R.visibleColumns = () => {
    if (R.isFixed || settings.flow === 'scrolled') return 1;
    return layoutNow().columns;
  };
  R.isRangeVisible = (range) => {
    const vis = R.loc?.range; if (!vis || !range) return true;
    // range.start >= vis.start  &&  range.start <= vis.end
    try { return range.compareBoundaryPoints(Range.START_TO_START, vis) >= 0 && range.compareBoundaryPoints(Range.END_TO_START, vis) <= 0; } catch { return true; }
  };

  /* ---------- persistence (throttled) ---------- */
  // The record can change while the panel lives (in-app link navigation opens web pages), so the
  // target id always comes from the record that is on screen – never from the closure (finding 4).
  let pending = null, saveTimer = null;
  const canPersist = () => !!(R.record && R.record.id && !R.record._dev);
  R.canPersist = canPersist;
  const flushSave = async () => {
    clearTimeout(saveTimer); saveTimer = null;
    if (!pending || !canPersist()) { pending = null; return; }
    const patch = pending; pending = null;
    const record = R.record;
    try { await api.library.update(record.id, patch); Object.assign(record, patch); } catch (e) { console.warn('[reader] save failed', e); }
  };
  R.queueSave = (patch, immediate) => {
    pending = { ...(pending || {}), ...patch };
    if (immediate) return flushSave();
    if (!saveTimer) saveTimer = setTimeout(flushSave, 3000);
  };
  R.saveNow = (patch) => R.queueSave(patch, true);

  /* ---------- reading time ---------- */
  let secondsAcc = 0;
  const timeTicker = setInterval(() => {
    if (R.closed || !document.hasFocus() || document.hidden) return;
    secondsAcc++;
    if (secondsAcc >= 60) { secondsAcc -= 60; if (canPersist()) api.library.addReadingTime(R.record.id, 60).catch(() => {}); }
  }, 1000);
  const flushTime = () => { if (secondsAcc >= 5 && canPersist()) api.library.addReadingTime(R.record.id, secondsAcc).catch(() => {}); secondsAcc = 0; };

  /* ---------- page turning ---------- */
  let turnBusy = 0;
  const playTurn = (side) => {
    if (!settings.pageAnimation) return;
    const cols = R.visibleColumns();
    const el = h('div.rd-turn', { class: `rd-turn-${side}${cols === 2 ? ' rd-turn-half' : ''}` });
    els.turnLayer.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400);
  };
  async function turn(side) {
    const v = R.view; if (!v?.renderer || R.closed) return;
    const r = v.renderer;
    const goingNext = (side === 'right') !== (v.book?.dir === 'rtl');
    if (goingNext && r.atEnd) return; if (!goingNext && r.atStart) return;
    if (settings.flow !== 'scrolled') playTurn(side);
    ctx.audio?.sfx?.('page');
    try { await (side === 'right' ? v.goRight() : v.goLeft()); } catch (e) { console.warn(e); }
  }
  R.turn = turn;
  // a page index or a page CFI of a PDF also finds its place in the text view (reader-textview.js)
  R.goTo = async (target) => { try { await R.view.goTo(R.tvs.mapTarget(target)); } catch (e) { console.warn('[reader] goTo failed', e); } };
  let wheelAt = 0;
  const onWheel = (e) => {
    if (settings.flow === 'scrolled' && !R.isFixed) return;
    if (Math.abs(e.deltaY) < 4 && Math.abs(e.deltaX) < 4) return;
    if (R.isFixed) {
      // a zoomed PDF page scrolls natively; only a page that fits is turned (finding 5)
      const doc = e.target?.ownerDocument || e.currentTarget?.ownerDocument || null;
      const de = doc?.documentElement;
      if (de && (settings.pdfZoom || 'fit-page') !== 'fit-page') {
        const down = (e.deltaY || 0) > 0;
        const canScroll = de.scrollHeight - de.clientHeight > 2;
        const atEdge = down ? de.scrollTop >= de.scrollHeight - de.clientHeight - 2 : de.scrollTop <= 2;
        if (canScroll && !atEdge) return; // let the iframe scroll
      }
    }
    e.preventDefault();
    const now = performance.now(); if (now - wheelAt < 380) return; wheelAt = now;
    turn((e.deltaY || e.deltaX) > 0 ? 'right' : 'left');
  };
  els.stage.addEventListener('wheel', onWheel, { passive: false });

  /* ---------- settings ---------- */
  let settingsSaveTimer = null;
  const persistSettings = () => { clearTimeout(settingsSaveTimer); settingsSaveTimer = setTimeout(() => { settingsSaveTimer = null; api.settings.set({ reader: storedReader() }).catch(() => {}); }, 400); };
  if (widthMigrated) persistSettings();
  function applySettings() {
    const v = R.view, r = v?.renderer;
    els.root.dataset.theme = settings.theme;
    els.root.classList.toggle('rd-fixed', !!R.isFixed);
    els.root.classList.toggle('rd-scrolled', settings.flow === 'scrolled');
    if (r) {
      if (!R.isFixed) {
        applyLayout(r);
        r.setStyles?.(bookCSS(settings));
      } else {
        r.setAttribute('zoom', settings.pdfZoom || 'fit-page');
        for (const doc of R.docs()) R.pageTheme.apply(doc, settings.theme);
      }
    }
    updateFold();
  }
  /** the page width (characters per line), the columns and the gaps of reflowable pages; only what changed is set
   *  (every attribute makes foliate lay the section out again) */
  function applyLayout(r) {
    const L = layoutNow();
    const want = { flow: settings.flow, 'max-column-count': String(L.columns), gap: L.gap, margin: L.margin, 'max-inline-size': L.maxInline + 'px' };
    for (const [k, v] of Object.entries(want)) if (r.getAttribute(k) !== v) r.setAttribute(k, v);
    els.root.style.setProperty('--rd-measure', Math.round(L.text) + 'px');
  }
  function updateFold() { els.fold.classList.toggle('hidden', R.visibleColumns() !== 2); }
  let resizeRaf = 0;
  const resizeObs = new ResizeObserver(() => {
    updateFold(); R.annotations.hideToolbar();
    // the number of columns that fit the page width depends on the width of the reading area
    if (!resizeRaf) resizeRaf = requestAnimationFrame(() => { resizeRaf = 0; const r = R.view?.renderer; if (r && !R.isFixed && !R.closed) applyLayout(r); });
  });
  resizeObs.observe(els.stage);
  R.setSetting = (k, val) => {
    if (k === 'theme') { pagesFollowUi = false; settings.themeChosen = true; }
    settings[k] = val; applySettings(); persistSettings(); renderSettings(); if (R.isFixed && k === 'columns') reopen();
    // a font that is not loaded yet changes the width of a character: the layout follows once it is there
    if (k === 'font') loadFont(val).then(() => { if (!R.closed && settings.font === val) applySettings(); });
  };
  /** a slider moves: the change is shown at once (one layout per frame) and saved, the menu stays as it is */
  let liveRaf = 0;
  R.setLive = (k, val) => {
    settings[k] = val;
    persistSettings();
    if (!liveRaf) liveRaf = requestAnimationFrame(() => { liveRaf = 0; if (!R.closed) applySettings(); });
  };
  /** Ctrl+Plus, Ctrl+Minus, Ctrl+0: the font size (the zoom of a PDF page in the page view) */
  function stepSize(dir) {
    if (R.isFixed) {
      const zooms = ['fit-page', 'fit-width', '1', '1.5', '2'];
      const i = zooms.indexOf(settings.pdfZoom || 'fit-page');
      const next = dir === 0 ? 'fit-page' : zooms[Math.max(0, Math.min(zooms.length - 1, i + dir))];
      if (next !== settings.pdfZoom) R.setSetting('pdfZoom', next);
      return;
    }
    const size = dir === 0 ? DEFAULTS.fontSize : Math.max(FONT_SIZES.min, Math.min(FONT_SIZES.max, (settings.fontSize || DEFAULTS.fontSize) + dir));
    if (size !== settings.fontSize) { settings.fontSize = size; applySettings(); persistSettings(); if (!els.settings.classList.contains('hidden')) renderSettings(); }
    showNotice(T('Schriftgröße {n} px', 'Font size {n} px', { n: size }), 1200);
  }
  /** on: the page colour follows the appearance of the app again (Hell → Papier, Sepia → Sepia, Dunkel → Nacht) */
  R.setPagesFollow = (on) => {
    pagesFollowUi = !!on; settings.themeChosen = !on;
    if (on) settings.theme = uiPageTheme();
    applySettings(); persistSettings(); renderSettings();
  };
  const offTheme = onTheme(() => { if (pagesFollowUi && settings.theme !== uiPageTheme()) { settings.theme = uiPageTheme(); applySettings(); if (els.settings?.isConnected) renderSettings(); } });
  // the width of a character is measured in the reading font itself: once it is loaded, the page width is set again
  loadFont(settings.font).then(() => { if (!R.closed && !R.isFixed && R.view?.renderer) applySettings(); });

  function renderSettings() {
    clear(els.settings);
    const group = (label, ...kids) => h('div.rd-set-group', h('div.rd-set-label', label), h('div.rd-set-row', kids));
    const seg = (key, options) => options.map(([val, label, title]) => h('button.rd-seg', { class: settings[key] === val ? 'active' : '', title: title || '', onclick: () => R.setSetting(key, val) }, label));
    const toggle = (key, label) => switchRow(label, !!settings[key], () => R.setSetting(key, !settings[key]));
    const pageLabels = { white: T('Weiß', 'White'), paper: T('Papier', 'Paper'), sepia: 'Sepia', night: T('Nacht', 'Night') };
    els.settings.append(
      h('div.rd-set-head', T('Darstellung', 'Appearance'), h('span.spacer'), h('button.rd-btn.small', { onclick: () => toggleSettings(false) }, '✕')),
      group(T('Seitenfarbe', 'Page colour'), Object.keys(THEMES).map((k) => h('button.rd-swatch', { class: (settings.theme === k ? 'active ' : '') + 'rd-swatch-' + k, title: pageLabels[k], dataset: { theme: k }, 'aria-pressed': settings.theme === k ? 'true' : 'false', onclick: () => R.setSetting('theme', k) }, pageLabels[k]))),
      h('button.rd-toggle-row.rd-follow', { type: 'button', role: 'switch', 'aria-checked': pagesFollowUi ? 'true' : 'false', onclick: () => R.setPagesFollow(!pagesFollowUi) },
        h('span.rd-toggle-label', T('Wie das Erscheinungsbild', 'Match the appearance'), h('span.rd-set-hint', ` (${tr(THEME_LABELS[currentTheme()] || THEME_LABELS.sepia)})`)),
        h('span.toggle', { class: pagesFollowUi ? 'on' : '' })),
    );
    // PDFs: the text view (font, size and width for the text of the PDF)
    if (R.tvs.available()) els.settings.append(textViewGroup(R, R.tvs.active, () => R.tvs.toggle()));
    if (!R.isFixed) {
      els.settings.append(...typographyGroups(R, { settings, set: R.setSetting, live: R.setLive, group, seg }));
    } else {
      els.settings.append(
        group('Zoom', seg('pdfZoom', [['fit-page', T('Seite', 'Page')], ['fit-width', T('Breite', 'Width')], ['1', '100 %'], ['1.5', '150 %'], ['2', '200 %']])),
        group(T('Anzeige', 'Layout'), seg('columns', [[1, T('Eine Seite', 'One page')], [2, T('Doppelseite', 'Two pages')]])),
      );
    }
    els.settings.append(h('div.rd-set-group', toggle('pageAnimation', T('Umblätter-Animation', 'Page-turn animation'))));
  }
  function toggleSettings(force) {
    const open = force ?? els.settings.classList.contains('hidden');
    if (open) { renderSettings(); R.sidebar.close(); R.annotations.hideAll(); }
    // closing must not leave the focus in the line-height range input, or every reader shortcut dies
    // (app/src/main.js ignores keys typed in INPUT/TEXTAREA/SELECT) – finding 3
    else if (els.settings.contains(document.activeElement)) { document.activeElement.blur?.(); els.root.focus?.(); }
    els.settings.classList.toggle('hidden', !open);
    showChrome();
  }
  R.toggleSettings = toggleSettings;

  /* ---------- bookmarks ---------- */
  const bookmarks = () => { if (!R.record) return []; if (!R.record.bookmarks) R.record.bookmarks = []; return R.record.bookmarks; };
  const currentPageBookmark = () => {
    // the text view of a PDF: a bookmark belongs to a PDF page, shown while that page is on screen
    if (R.loc?.pdf) { const { page, last } = R.loc.pdf; return bookmarks().find((b) => { const p = R.tvs.bookmarkPages(b); return p != null && p >= page && p <= last; }) || null; }
    const cfi = R.loc?.cfi; if (!cfi || !R.CFI) return null;
    let start, end;
    try { start = R.CFI.collapse(cfi); end = R.CFI.collapse(cfi, true); } catch { return null; }
    return bookmarks().find((b) => { try { return R.CFI.compare(b.location, start) >= 0 && R.CFI.compare(b.location, end) <= 0; } catch { return false; } }) || null;
  };
  R.currentPageBookmark = currentPageBookmark;
  function updateRibbon() { const has = !!currentPageBookmark(); els.ribbon.classList.toggle('show', has); els.btnBookmark.classList.toggle('active', has); }
  R.pageLabel = (loc = R.loc) => {
    if (!loc) return '';
    if (loc.pdf) return T('Seite {p}', 'Page {p}', { p: loc.pdf.page + 1 });
    if (R.isFixed) return T('Seite {p}', 'Page {p}', { p: (loc.section?.current ?? 0) + 1 });
    if (loc.pageItem?.label) return T('Seite {p}', 'Page {p}', { p: loc.pageItem.label });
    return `${pct(loc.fraction)} %`;
  };
  async function toggleBookmark() {
    if (!R.loc) return;
    const existing = currentPageBookmark();
    if (existing) {
      R.record.bookmarks = bookmarks().filter((b) => b !== existing);
      R.toast(T('Lesezeichen entfernt', 'Bookmark removed'));
    } else {
      let location = R.loc.cfi;
      try { location = R.CFI.collapse(R.loc.cfi); } catch {}
      // the text view of a PDF marks the PDF page (the bookmark works in both views)
      if (R.loc.pdf) location = pdfPageCfi(R.loc.pdf.page);
      const chapter = str(R.loc.tocItem?.label);
      const label = [chapter, R.pageLabel()].filter(Boolean).join(' · ') || T('Lesezeichen', 'Bookmark');
      const page = R.loc.pdf ? R.loc.pdf.page + 1 : R.isFixed ? (R.loc.section?.current ?? 0) + 1 : undefined;
      bookmarks().push({ id: 'bm' + Date.now().toString(36), location, label, createdAt: Date.now(), page, excerpt: (R.loc.range?.toString() || '').replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim().slice(0, 140) });
      R.toast(canPersist() ? T('Lesezeichen gesetzt', 'Bookmark added') : T('Lesezeichen gesetzt, nur für diese Sitzung (Online-Text)', 'Bookmark added – this session only (online text)'));
    }
    ctx.audio?.sfx?.('click');
    updateRibbon();
    R.sidebar.refresh('bookmarks');
    R.queueSave({ bookmarks: bookmarks() }, true);
  }
  R.toggleBookmark = toggleBookmark;
  R.removeBookmark = (bm) => { R.record.bookmarks = bookmarks().filter((b) => b.id !== bm.id); updateRibbon(); R.sidebar.refresh('bookmarks'); R.queueSave({ bookmarks: bookmarks() }, true); };

  /* ---------- progress bar / running heads ---------- */
  function onSliderInput(e) { els.percent.textContent = pct(parseFloat(e.target.value)) + ' %'; }
  function onSliderChange(e) {
    const f = parseFloat(e.target.value);
    // the text view of a PDF: the slider stands for the PDF pages
    if (R.loc?.pdf) { R.goTo(Math.max(0, Math.min(R.loc.pdf.total - 1, Math.round(f * R.loc.pdf.total) - 1))); return; }
    if (R.view) R.view.goToFraction(f).catch(() => {});
  }
  function renderTicks() {
    clear(els.ticks);
    try { for (const f of R.view.getSectionFractions()) els.ticks.append(h('option', { value: f })); } catch {}
  }
  function updateHeads() {
    const r = R.view?.renderer; if (!r?.heads) return;
    const heads = r.heads, feet = r.feet;
    const chapter = str(R.loc?.tocItem?.label);
    if (heads.length) { heads[0].textContent = R.title; heads[heads.length - 1].textContent = heads.length > 1 ? chapter : (chapter || R.title); }
    if (feet.length && R.loc) {
      const l = R.loc.location;
      feet[0].textContent = R.loc.pdf ? T('Seite {p}', 'Page {p}', { p: R.loc.pdf.page + 1 }) : R.loc.pageItem?.label ? T('Seite {p}', 'Page {p}', { p: R.loc.pageItem.label }) : (l ? `${l.current + 1} / ${l.total}` : '');
      if (feet.length > 1) feet[feet.length - 1].textContent = pct(R.loc.fraction) + ' %';
    }
  }

  /* ---------- relocate ---------- */
  function onRelocate(detail) {
    // the text view of a PDF: the place in PDF pages ({ page, last, total }, reader-textview.js)
    const pdf = R.tvs.relocate(detail);
    if (pdf) detail.pdf = pdf;
    R.loc = detail;
    R.chess?.setLocation?.(placeNow());   // a position saved at the board belongs to the place on screen
    // foliate reports no fraction while #sectionProgress is missing (right after close(), or for books
    // without splitTOCHref) – keeping the last known value stops progress from being wiped (finding 10)
    const hasFraction = Number.isFinite(detail.fraction) || !!pdf;
    // the text view: the PDF page on screen; the end of the book is all of it (several pages may begin on its last screen)
    const fraction = pdf ? (R.view?.renderer?.atEnd ? 1 : (pdf.page + 1) / pdf.total) : hasFraction ? detail.fraction : (R.progress ?? 0);
    if (pdf) detail.fraction = fraction;   // the running foot shows the same progress as the bar
    els.slider.value = fraction;
    els.percent.textContent = pct(fraction) + ' %';
    const l = detail.location;
    els.pageLabel.textContent = pdf ? T('Seite {p} von {n}', 'Page {p} of {n}', { p: pdf.page + 1, n: pdf.total })
      : R.isFixed ? T('Seite {p} von {n}', 'Page {p} of {n}', { p: (detail.section?.current ?? 0) + 1, n: detail.section?.total ?? '?' })
      : detail.pageItem?.label ? T('Seite {p}', 'Page {p}', { p: detail.pageItem.label }) : l ? T('Position {a} von {b}', 'Loc {a} of {b}', { a: l.current + 1, b: l.total }) : '';
    const mins = detail.time?.total;
    els.timeLeft.textContent = Number.isFinite(mins) && mins > 0.5 && !R.isFixed && !pdf ? T('noch ~{t}', '~{t} left', { t: formatDuration(mins * 60) }) : '';
    els.chapter.textContent = str(detail.tocItem?.label) || '';
    R.sidebar.setCurrentHref(detail.tocItem?.href);
    updateHeads();
    updateRibbon();
    R.annotations.hideToolbar();
    // only a look at a hit of the full-text search: the reading position stays where it was
    if (R.hit.isPeek(detail)) return;
    // persist position
    let text = '';
    try { text = (detail.range?.toString() || (R.isFixed ? R.currentDoc()?.body?.textContent : '') || '').replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim().slice(0, 600); } catch {}
    R.currentPageText = text;
    if (hasFraction) R.progress = fraction;
    // remember the library book's own state – a web page opened via a link must not overwrite it
    if (id && R.record?.id === id) bookState = { progress: R.progress ?? 0, currentPageText: text };
    // the text view keeps the PDF page as the place (the page view and the shelves understand it)
    const patch = { lastLocation: pdf ? pdfPageCfi(pdf.page) : detail.cfi, lastRead: Date.now(), currentPageText: text };
    if (hasFraction) patch.progress = fraction;
    R.queueSave(patch);
  }
  /** the place on screen for what is kept with the book (chess positions): a PDF page in the text view, else the CFI */
  function placeNow() { return R.loc?.pdf ? pdfPageCfi(R.loc.pdf.page) : (R.loc?.cfi || null); }

  /* ---------- section document loaded ---------- */
  function onDocLoad({ doc, index }) {
    if (!doc) return;
    // PDF and comic pages are pictures: the page colour goes into the page document before pdf.js paints it
    if (R.view?.isFixedLayout) { R.docIndex.set(doc, index); R.pageTheme.apply(doc, settings.theme); }
    doc.addEventListener('keydown', (e) => { if (handleKey(e)) { e.preventDefault(); e.stopPropagation(); } else if (e.key === 'Escape') closeReader(); });
    doc.addEventListener('wheel', onWheel, { passive: false });
    doc.addEventListener('mousemove', showChrome);
    doc.addEventListener('click', (e) => {
      if (e.target.closest?.('a[href]')) return;
      const sel = doc.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) return;
      if (R.annotations.handleDocClick(doc, e)) return;
      R.annotations.hideAll();
      if (!els.settings.classList.contains('hidden')) { toggleSettings(false); return; }
      if (R.sidebar.isOpen()) { R.sidebar.close(); return; }
      if (R.isFixed || settings.flow === 'scrolled') return;
      const frame = doc.defaultView?.frameElement; if (!frame) return;
      const fr = frame.getBoundingClientRect(), sr = R.stageRect();
      const x = (fr.left + e.clientX - sr.left) / sr.width;
      if (x < 0.09) turn('left'); else if (x > 0.91) turn('right');
    });
    R.annotations.onLoad(doc, index);
    R.tts.onLoad(doc, index);
    R.hit.onLoad(doc, index);
    updateHeads();
  }

  /* ---------- keys ---------- */
  function handleKey(e) {
    if (R.closed) return false;
    const target = e.target;
    const inInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (e.key === 'Escape') {
      if (R.tts.closeMenu()) return true;
      if (R.snip.cancel()) return true;
      if (R.chess?.recognition?.onKey(e)) return true;
      if (inInput) { target.blur(); return true; }
      if (R.annotations.hideAll()) return true;
      if (!els.settings.classList.contains('hidden')) { toggleSettings(false); return true; }
      if (R.sidebar.isOpen()) { R.sidebar.close(); return true; }
      if (R.tts.isActive() || R.tts.isVisible()) { R.tts.stop(); return true; }
      if (els.stage.querySelector('.rd-linkerr')) { els.stage.querySelector('.rd-linkerr').remove(); return true; }
      if (nav.back.length) { goBack(); return true; }   // back to the book before closing the reader
      closeReader(); return true;
    }
    // in-app navigation – checked before the modifier guard below, which swallows every Alt combination
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      if (e.key === 'ArrowLeft') { if (!canGoBack()) return false; goBack(); } else { if (!canGoForward()) return false; goForward(); }
      return true;
    }
    if (e.key === 'Backspace' && !inInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!canGoBack()) return false;
      goBack(); return true;
    }
    // Strg+F: the full-text search over all books (F alone searches this book)
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'f' || e.key === 'F')) { R.hit.openPanel(); return true; }
    // Ctrl+Plus / Ctrl+Minus / Ctrl+0: the font size (in the page view of a PDF the zoom); consumed, so that the
    // whole window is not zoomed instead
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !inInput) {
      const k = e.key, c = e.code;
      if (k === '+' || k === '=' || c === 'NumpadAdd') { stepSize(1); return true; }
      if (k === '-' || k === '_' || c === 'NumpadSubtract') { stepSize(-1); return true; }
      if (k === '0' || c === 'Numpad0') { stepSize(0); return true; }
    }
    if (inInput || e.ctrlKey || e.metaKey || e.altKey) return false;
    switch (e.key) {
      case 'ArrowLeft': case 'PageUp': turn('left'); return true;
      case 'ArrowRight': case 'PageDown': turn('right'); return true;
      case ' ': turn(e.shiftKey ? 'left' : 'right'); return true;
      case 'Home': R.view?.renderer?.firstSection?.() ?? R.view?.goTo(0); return true;
      case 'End': R.view?.renderer?.lastSection?.() ?? R.view?.goTo(R.view.book.sections.length - 1); return true;
      case 'b': case 'B': toggleBookmark(); return true;
      case 't': case 'T': R.sidebar.toggle(); return true;
      case 'f': case 'F': R.sidebar.open('search'); return true;
      case 'v': case 'V': if (e.shiftKey) R.tts.openMenu(els.btnTtsMenu); else R.tts.toggle(); return true;
      case 'c': case 'C': toggleChess(); return true;
      // a diagram from the page onto the board, while the chess pane is open
      case 'd': case 'D': if (els.chess.classList.contains('hidden')) return false; R.snip.begin(); return true;
      case 's': case 'S': toggleSettings(); return true;
      case 'n': case 'N': R.sidebar.open('notes'); return true;
      // the text view of a PDF on and off
      case 'x': case 'X': if (!R.tvs.available()) return false; R.tvs.toggle(); return true;
      default: return false;
    }
  }

  /* ---------- chess pane ---------- */
  async function toggleChess(force) {
    const open = force ?? els.chess.classList.contains('hidden');
    els.chess.classList.toggle('hidden', !open);
    els.root.classList.toggle('rd-with-chess', open);
    els.btnChess.classList.toggle('active', open);
    if (id) sessionState.chessOpen.set(id, open);
    if (open && !R.chess) {
      clear(els.chess);
      els.chess.append(h('div.rd-chess-loading', T('Schachbrett wird geladen …', 'Loading chess board …')));
      try {
        const mod = await import('../chess/chess-panel.js');
        if (typeof mod.createChessSidebar !== 'function') throw new Error('createChessSidebar missing');
        clear(els.chess);
        R.chess = await mod.createChessSidebar(els.chess, ctx, { bookId: id, location: placeNow(), book: R.record, onSnip: () => R.snip.begin() });
        R.chess = R.chess || {};
        // the diagram templates of this computer, prepared while the reader idles (the first snip is then quick)
        const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
        idle(() => { if (!R.closed) import('../chess/diagram/templates.js').then((m) => m.loadTemplates()).catch(() => {}); }, { timeout: 4000 });
      } catch (e) {
        console.warn('[reader] chess sidebar unavailable', e);
        clear(els.chess);
        els.chess.append(h('div.rd-chess-fallback', h('div.rd-chess-fallback-icon', '♞'), h('div', T('Das Schachbrett ist noch nicht verfügbar.', 'The chess board is not available yet.')), h('button.btn.small', { onclick: () => toggleChess(false) }, T('Schließen', 'Close'))));
        R.chess = {};
      }
    }
    if (!open && R.chess) { try { R.chess.destroy?.(); } catch {} R.chess = null; clear(els.chess); }
    setTimeout(() => R.view?.renderer?.render?.(), 320);
  }
  R.toggleChess = toggleChess;
  /** a captured snip (reader-snip.js) → recognised and set up on the board of the chess pane */
  R.onSnip = async (shot) => {
    if (!R.chess?.recognition) await toggleChess(true);
    const { recognizeShot } = await import('../chess/diagram-ui.js');
    const rec = await recognizeShot(shot, { bookId: id });
    R.lastSnip = { shot: { width: shot.width, height: shot.height, source: shot.source, hints: shot.hints }, result: rec.res };
    R.chess?.recognition?.show(rec, shot);
  };

  /* ---------- in-app link navigation ----------
   * Clicking a hyperlink inside a book, an article or a web page never leaves the app: the target is
   * fetched through the backend (catalog:readUrl → Readability, api.app.fetch as fallback), turned
   * into a foliate book and shown in this very reading view. A back/forward stack plus a breadcrumb
   * lead back to the book; "Im Systembrowser öffnen" stays as an explicit opt-in. (findings 1, 2, 12)
   */
  const MAX_NAV = 12;
  const canGoBack = () => nav.back.length > 0 || !!R.view?.history?.canGoBack;
  const canGoForward = () => nav.fwd.length > 0 || !!R.view?.history?.canGoForward;
  const webTitle = (doc, url) => doc?.title || hostOf(url) || T('Webseite', 'Web page');

  const snapshot = () => ({
    fbook: R.fbook, record: R.record, title: R.title, author: R.author, lang: R.lang, progress: R.progress ?? 0,
    cfi: R.loc?.cfi || null, url: R.docUrl, baseHref: R.baseHref, bookUrl: R.bookUrl, owned: !!R.docOwned,
  });

  function trimStack() {
    while (nav.back.length > MAX_NAV) {
      const dropped = nav.back.shift();
      if (dropped?.owned && dropped.fbook !== R.fbook) { try { dropped.fbook?.destroy?.(); } catch {} }
    }
  }

  function renderNav() {
    els.btnBack.disabled = !canGoBack();
    els.btnFwd.disabled = !canGoForward();
    const url = R.docUrl || '';
    const ext = isHttpUrl(url) || isHttpUrl(R.bookUrl || '');
    els.btnExt.classList.toggle('hidden', !ext);
    els.btnExt.title = ext ? externalLabel() + ': ' + (url || R.bookUrl) : externalLabel();
    renderCrumbs();
  }
  function renderCrumbs() {
    clear(els.crumbs);
    if (!nav.back.length) { els.crumbs.classList.add('hidden'); return; }
    els.crumbs.classList.remove('hidden');
    els.crumbs.append(h('button.rd-crumb.rd-crumb-back', { title: T('Zurück (Alt+← / Rücktaste)', 'Back (Alt+← / Backspace)'), onclick: () => goBack() }, '‹'));
    nav.back.forEach((entry, i) => {
      els.crumbs.append(h('button.rd-crumb', { title: entry.url || entry.title || '', onclick: () => goToStackIndex(i) }, entry.title || T('Buch', 'Book')));
      els.crumbs.append(h('span.rd-crumb-sep', '›'));
    });
    els.crumbs.append(h('span.rd-crumb.current', { title: R.docUrl || '' }, R.title || ''));
  }

  function showLoading(text) {
    clear(els.loading);
    els.loading.append(h('div.rd-spinner'), h('div.rd-loading-text', text || T('Buch wird geöffnet …', 'Opening book …')));
    if (!els.loading.isConnected) els.stage.append(els.loading);
  }
  const hideLoading = () => els.loading.remove();

  function showLinkError(url, err, opts = {}) {
    els.stage.querySelector('.rd-linkerr')?.remove();
    const box = h('div.rd-linkerr');
    box.append(h('div.rd-linkerr-card',
      h('div.rd-error-icon', '🔗'),
      h('div.rd-error-title', opts.title || T('Diese Seite lässt sich nicht in Cozy Shelves anzeigen.', 'This page cannot be shown in the reading room.')),
      h('div.rd-linkerr-url', url),
      err ? h('pre.rd-error-msg', String(err?.message || err)) : null,
      h('div.rd-linkerr-actions',
        opts.noRetry ? null : h('button.btn.small', { onclick: () => { box.remove(); navigateToUrl(url); } }, T('Erneut versuchen', 'Try again')),
        h('button.btn.small', { onclick: () => { box.remove(); openSystemBrowser(api, url); } }, '↗ ' + externalLabel()),
        h('button.btn.small.primary', { onclick: () => box.remove() }, T('Weiterlesen', 'Keep reading')))));
    els.stage.append(box);
  }

  /** Swap the document shown in the reading view (book ⇄ fetched page) without remounting the panel. */
  async function showBook(fbook, meta, opts = {}) {
    await flushSave();
    flushTime();
    try { R.tts.stop?.(); } catch {}
    R.annotations.hideAll();
    els.stage.querySelector('.rd-linkerr')?.remove();
    try { R.view.close(); } catch {}
    // let the destroyed renderer's pending ResizeObserver/render callbacks run out before a new one
    // is built – otherwise foliate styles a half-created iframe document
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (R.closed) return;
    R.fbook = fbook;
    R.record = meta.record;
    R.title = meta.title || T('Ohne Titel', 'Untitled');
    R.author = meta.author || '';
    R.lang = meta.lang || R.lang;
    R.docUrl = meta.url || null; R.baseHref = meta.baseHref || null; R.bookUrl = meta.bookUrl || null;
    R.docOwned = !!meta.owned;
    R.loc = null; R.progress = meta.progress ?? 0;
    els.title.textContent = R.title; els.author.textContent = R.author;
    els.root.querySelector('.rd-sep')?.classList.toggle('hidden', !R.author);
    await R.view.open(fbook);
    if (R.closed) return;
    R.isFixed = !!R.view.isFixedLayout;
    await new Promise((r) => requestAnimationFrame(r));   // the new renderer's iframe needs a document
    applySettings();
    clear(els.ticks);
    try { for (const f of R.view.getSectionFractions()) els.ticks.append(h('option', { value: f })); } catch {}
    const target = opts.location || null;
    try { await R.view.init({ lastLocation: target, showTextStart: !target }); }
    catch (e) { console.warn('[reader] init failed', e); try { await R.view.init({}); } catch {} }
    R.sidebar.refresh();
    updateRibbon();
    renderNav();
    showChrome();   // the breadcrumb must be visible after a jump
  }

  async function navigateToUrl(url, opts = {}) {
    if (nav.busy || R.closed) return false;
    const target = String(url || '').trim();
    if (!target) return false;
    if (/^(mailto|tel|sms|geo):/i.test(target)) {
      showLinkError(target, null, { noRetry: true, title: T('Dieser Link öffnet ein anderes Programm.', 'This link opens another application.') });
      return false;
    }
    nav.busy = true;
    showLoading(T('Seite wird geholt …', 'Fetching page …'));
    try {
      let doc;
      if (/^file:/i.test(target)) {
        // a neighbouring page of a local HTML book: read through lfile://, links and images resolve against the file
        const lurl = await api.files?.url?.(pathFromFileUrl(target));
        if (!lurl) throw new Error(T('Diese Datei liegt außerhalb deiner Bücherordner.', 'This file lies outside your library folders.'));
        doc = await fetchReadable(api, lurl, { baseUrl: target });
        const name = decodeURIComponent(target.split(/[?#]/)[0].split('/').pop() || '');
        doc = { ...doc, url: target, title: doc.title || name };
        if (doc.html) doc.html = await localizeResources(doc.html, target, api);
      } else doc = await fetchReadable(api, target);
      const src = doc.html != null ? { html: doc.html } : { text: doc.text || '' };
      const docUrl = doc.url || target;
      const fbook = makeTextBook(src, { title: doc.title, author: doc.author, language: doc.language || '', format: 'html', baseHref: docUrl });
      if (!opts.replace) { nav.back.push(snapshot()); trimStack(); nav.fwd.length = 0; }
      await showBook(fbook, {
        record: { id: null, title: webTitle(doc, docUrl), author: doc.author || '', format: 'html', language: doc.language || '', bookmarks: [], annotations: [], positions: [], _dev: true },
        title: webTitle(doc, docUrl), author: doc.author || '', lang: (doc.language || '').slice(0, 2).toLowerCase() || R.lang,
        url: docUrl, baseHref: docUrl, owned: true, progress: 0,
      });
      ctx.audio?.sfx?.('page');
      showNotice(T('Gelesen aus {h}. Die Rücktaste führt zurück.', 'Read from: {h} – Backspace goes back', { h: hostOf(docUrl) }), 3200);
      return true;
    } catch (e) {
      console.warn('[reader] in-app navigation failed', target, e);
      if (await openBrowserPanel(target, ctx)) return false;  // an in-app browser panel, if one exists
      showLinkError(target, e);
      return false;
    } finally {
      nav.busy = false;
      hideLoading();
      renderNav();
    }
  }
  R.navigateToUrl = navigateToUrl;

  async function restore(entry) {
    if (!entry) return;
    nav.busy = true;
    try {
      if (entry.fbook === R.fbook) { if (entry.cfi) await R.goTo(entry.cfi); }
      else await showBook(entry.fbook, entry, { location: entry.cfi });
      ctx.audio?.sfx?.('page');
    } catch (e) { console.warn('[reader] restore failed', e); }
    finally { nav.busy = false; renderNav(); }
  }
  async function goBack() {
    if (nav.busy) return false;
    if (nav.back.length) { nav.fwd.push(snapshot()); await restore(nav.back.pop()); return true; }
    if (R.view?.history?.canGoBack) { R.view.history.back(); renderNav(); return true; }
    return false;
  }
  async function goForward() {
    if (nav.busy) return false;
    if (nav.fwd.length) { nav.back.push(snapshot()); trimStack(); await restore(nav.fwd.pop()); return true; }
    if (R.view?.history?.canGoForward) { R.view.history.forward(); renderNav(); return true; }
    return false;
  }
  async function goToStackIndex(i) {
    if (nav.busy || i < 0 || i >= nav.back.length) return;
    const target = nav.back[i];
    const rest = nav.back.slice(i + 1);
    nav.back.length = i;
    nav.fwd.push(snapshot(), ...rest.reverse());
    await restore(target);
  }
  R.goBack = goBack;

  function openCurrentExternally() {
    const url = R.docUrl || R.bookUrl || '';
    if (!isHttpUrl(url)) { R.toast(T('Für diesen Text gibt es keine Webadresse.', 'This text has no web address.')); return; }
    openSystemBrowser(api, url).then((ok) => R.toast(ok ? T('Im Systembrowser geöffnet', 'Opened in the system browser') : T('Konnte nicht geöffnet werden', 'Could not be opened')));
  }

  /** absolute URL for a foliate link event (detail = { a, href_ } / { a, href }) */
  function absoluteFromDetail(detail) {
    const raw = String(detail?.href_ ?? detail?.href ?? '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
    const own = detail?.a?.href || '';
    if (own && !/^(blob|about):/i.test(own)) return own;
    return resolveUrl(raw, R.baseHref || R.docUrl || R.bookUrl || '') || raw;
  }

  /* ---------- open the book ---------- */
  async function openBook() {
    const { makeBook, CFI, Overlayer } = await loadFoliate();
    R.CFI = CFI; R.Overlayer = Overlayer;
    let record = null;
    if (id) { try { record = await api.library.book(id); } catch (e) { console.warn(e); } }
    let url = params.url || (id ? await api.library.bookUrl(id).catch(() => null) : null);
    if (!record) record = { id: id || null, title: '', author: '', format: extOf(url) || 'txt', bookmarks: [], annotations: [], positions: [], _dev: !id };
    record.bookmarks ||= []; record.annotations ||= []; record.positions ||= [];
    R.record = record;
    R.bookUrl = url || null;
    R.baseHref = url && /^(https?|book|app|lfile|file):/i.test(url) ? url : null;
    const format = (params.url ? extOf(params.url) : record.format) || 'txt';
    R.lang = (record.language || '').slice(0, 2).toLowerCase() || '';

    const view = els.view; R.view = view;
    view.addEventListener('relocate', (e) => onRelocate(e.detail));
    view.addEventListener('load', (e) => onDocLoad(e.detail));
    view.addEventListener('create-overlay', (e) => R.annotations.onCreateOverlay(e.detail));
    view.addEventListener('create-overlay', (e) => R.hit.onCreateOverlay(e.detail));
    view.addEventListener('draw-annotation', (e) => R.annotations.onDraw(e.detail));
    view.addEventListener('show-annotation', (e) => R.annotations.onShow(e.detail));
    // hyperlinks stay inside the reading view (finding 1); only the ↗ button opens the system browser
    view.addEventListener('external-link', (e) => {
      e.preventDefault();
      const target = absoluteFromDetail(e.detail);
      if (!target) return;
      if (isHttpUrl(target) || isLocalUrl(target)) navigateToUrl(target);
      else showLinkError(target, null, { noRetry: true, title: T('Dieser Link öffnet ein anderes Programm.', 'This link opens another application.') });
    });
    // internal targets (EPUB hrefs, footnotes, TOC, #anchors) keep foliate's own handling; only an
    // absolute http(s) target that slipped through is taken over by the in-app navigator
    view.addEventListener('link', (e) => {
      const href = e.detail?.href;
      if (typeof href === 'string' && isHttpUrl(href)) { e.preventDefault(); navigateToUrl(href); }
    });

    let fbook;
    if (params.external) {
      // text handed over by the online catalogue (Gutenberg / Wikisource / web page as book) or a
      // link that another panel routed into the reading view (only a URL, fetched here)
      let ex = params.external;
      if (!ex.html && !ex.text && !ex.url) throw new Error(T('Kein Text übergeben', 'No text handed over'));
      if (!ex.html && !ex.text && ex.url) {
        showLoading(T('Seite wird geholt …', 'Fetching page …'));
        ex = { ...ex, ...(await fetchReadable(api, ex.url)) };
      }
      const exUrl = ex.url || params.external.url || null;
      record.title = ex.title || record.title; record.author = ex.author || record.author; record.language = ex.language || record.language;
      record._dev = true; record.id = null; // online texts have no library record (see canPersist)
      R.docUrl = exUrl; R.baseHref = exUrl; R.docOwned = true;
      fbook = makeTextBook(ex.html != null ? { html: ex.html } : { text: ex.text || '' },
        { title: ex.title, author: ex.author, language: ex.language, format: 'html', baseHref: exUrl });
    } else if (url && FOLIATE_FORMATS.includes(format)) {
      fbook = await makeBook(url);
    } else {
      let src = null;
      if (params.url && !id) {
        const res = await fetch(params.url); const text = await res.text();
        src = format === 'html' || format === 'htm' ? { html: text } : { text };
      } else if (id) {
        src = await api.library.readText(id);
      }
      if (!src) throw new Error(T('Buch konnte nicht geladen werden', 'Could not load book'));
      if (format === 'html' && src.text != null && src.html == null) src = { html: src.text };
      // local HTML and Markdown: relative links resolve against the file itself, relative images are
      // served through lfile:// (the lfile URL of the book cannot resolve paths relative to it)
      const fileBase = (format === 'html' || format === 'md') && record.path ? fileUrlFromPath(record.path) : null;
      if (fileBase && src.html) { src = { ...src, html: await localizeResources(src.html, fileBase, api) }; R.baseHref = fileBase; }
      fbook = makeTextBook(src, { title: record.title || src.title, author: record.author, language: record.language, format, baseHref: fileBase || (format === 'html' && url ? url : null) });
    }
    if (fbook.rendition?.layout === 'pre-paginated' && (settings.columns || 2) === 1) fbook.rendition.spread = 'none';
    R.fbook = fbook;
    R.title = record.title || str(fbook.metadata?.title) || T('Ohne Titel', 'Untitled');
    R.author = record.author || str(fbook.metadata?.author || fbook.metadata?.creator) || '';
    if (!R.lang) R.lang = str(fbook.metadata?.language).slice(0, 2).toLowerCase() || uiLang;
    els.title.textContent = R.title; els.author.textContent = R.author;
    els.root.querySelector('.rd-sep').classList.toggle('hidden', !R.author);

    // go to last position; a PDF that is read in the text view opens there (reader-textview.js)
    let target = R.hit.initialTarget() ?? (params.location || record.lastLocation || null);
    const textStart = await R.tvs.initial(target);
    if (R.closed) return;
    await view.open(textStart ? textStart.book : fbook);
    if (textStart) target = textStart.target;
    R.isFixed = !!view.isFixedLayout;
    applySettings();
    // section ticks on the slider
    renderTicks();
    try { await view.init({ lastLocation: target, showTextStart: !target }); }
    catch (e) { console.warn('[reader] init at last location failed', e); try { await view.init({}); } catch {} }
    R.hit.afterOpen();
    if (R.isFixed && !R.record._dev && record.format === 'pdf') {
      // the first times: the offer of the text view, else the note about highlights in PDFs
      R.tvs.maybeHint().then((shown) => { if (!shown && !R.closed) showNotice(T('PDF: Markierungen werden auf der Textebene versucht; Lesezeichen funktionieren immer.', 'PDF: highlights use the text layer; bookmarks always work.'), 4000); });
    }
    R.sidebar.refresh();
    if (!R.record._dev && id) api.library.open(id).catch(() => {});
    // night pages of a chess book keep its diagrams in their own colours (found on the page, see page-theme.js)
    if (R.isFixed && record.isChess) {
      R.pageTheme.setFinder(async (canvas) => (await import('../chess/diagram/find-boards.js')).findBoardsOnCanvas(canvas));
      for (const doc of R.docs()) R.pageTheme.apply(doc, settings.theme);
    }
    if (id) {
      // the backend decides (folder, title, move notation); the department "Spiele & Schach" alone says nothing
      const isChessBook = !!record.isChess;
      const want = sessionState.chessOpen.has(id) ? sessionState.chessOpen.get(id) : isChessBook;
      if (want) toggleChess(true);
    }
    if (params.fullscreen) { R.setFullscreen = true; api.app?.setFullscreen?.(true).catch?.(() => {}); }
    renderNav();
    els.loading.remove();
  }

  async function reopen() {
    // used when a change requires re-rendering the book (PDF spread)
    const target = R.loc?.cfi;
    try { R.view.close(); } catch {}
    // NB: never wipe els.loading's children – that deleted the spinner permanently (finding 6)
    showLoading(T('Buch wird neu aufgebaut …', 'Rebuilding book …'));
    try {
      if (R.fbook.rendition) R.fbook.rendition.spread = (settings.columns || 2) === 1 ? 'none' : 'auto';
      await R.view.open(R.fbook); applySettings();
      await R.view.init({ lastLocation: target });
    } catch (e) { console.warn(e); }
    hideLoading();
  }

  let noticeTimer = null;
  function showNotice(msg, ms = 3500) {
    els.notice.textContent = msg; els.notice.classList.remove('hidden');
    clearTimeout(noticeTimer); noticeTimer = setTimeout(() => els.notice.classList.add('hidden'), ms);
  }
  R.showNotice = showNotice;

  /* ---------- close ---------- */
  let unmounted = false, emitted = false;
  const emitClosed = () => {
    if (emitted) return; emitted = true;
    const own = id && R.record?.id === id;
    bus.emit('reader:closed', {
      id,
      progress: (own ? R.progress : bookState?.progress) ?? R.record?.progress ?? 0,
      currentPageText: (own ? R.currentPageText : bookState?.currentPageText) || '',
    });
  };
  function teardown() {
    if (unmounted) return; unmounted = true; R.closed = true;
    emitClosed();
    clearInterval(timeTicker); clearTimeout(hideTimer); resizeObs.disconnect();
    // timers that used to keep running after unmount (finding 7)
    clearTimeout(noticeTimer); noticeTimer = null;
    offTheme();
    if (settingsSaveTimer) { clearTimeout(settingsSaveTimer); settingsSaveTimer = null; api.settings.set({ reader: storedReader() }).catch(() => {}); }
    try { R.tts.destroy(); } catch {}
    try { R.annotations.destroy(); } catch {}   // MutationObservers of PDF pages (finding 8)
    try { R.pageTheme.destroy(); } catch {}
    try { R.hit.destroy(); } catch {}
    try { R.tvs.destroy(); } catch {}
    try { R.chess?.destroy?.(); } catch {}
    flushTime();
    flushSave();
    try { R.view?.close(); } catch {}
    try { R.fbook?.destroy?.(); } catch {}
    for (const entry of [...nav.back, ...nav.fwd]) { if (entry.fbook !== R.fbook) { try { entry.fbook?.destroy?.(); } catch {} } }
    nav.back.length = 0; nav.fwd.length = 0;
    if (R.setFullscreen) api.app?.setFullscreen?.(false).catch?.(() => {});
  }
  async function closeReader() {
    if (R.closed) return;
    R.closed = true;
    try { await flushSave(); } catch {}
    emitClosed();
    ctx.close();
    teardown();
  }
  R.close = closeReader;

  renderNav();
  openBook().catch((e) => {
    console.error('[reader] open failed', e);
    els.loading.remove();
    const webUrl = params.external?.url || (isHttpUrl(R.bookUrl || '') ? R.bookUrl : null);
    els.stage.append(h('div.rd-error', h('div.rd-error-icon', '📕'),
      h('div.rd-error-title', T('Das Buch konnte nicht geöffnet werden.', 'The book could not be opened.')),
      h('pre.rd-error-msg', String(e?.message || e)),
      h('div.rd-linkerr-actions',
        webUrl ? h('button.btn', { onclick: () => openSystemBrowser(api, webUrl) }, '↗ ' + externalLabel()) : null,
        h('button.btn.primary', { onclick: () => closeReader() }, T('Schließen', 'Close')))));
  });

  return {
    unmount() { teardown(); },
    onKey(e) { return handleKey(e); },
    // the gamepad (input/pad-panels.js): pages, the bars, reading aloud, the bookmark
    pad: {
      stage: () => els.stage,
      firstBar: () => els.btnToc,
      slider: () => els.slider,
      turn: (side) => turn(side),
      readAloud: () => R.tts.toggle(),
      bookmark: () => toggleBookmark(),
      // a card over the page (contents, appearance, a note): B closes it first
      popupOpen: () => !els.settings.classList.contains('hidden') || R.sidebar.isOpen() || R.annotations.isOpen(),
      keepBars(on) {
        const was = padBars; padBars = !!on;
        if (padBars ? (!was || els.root.classList.contains('rd-chrome-hidden')) : was) showChrome();
      },
    },
  };
}
