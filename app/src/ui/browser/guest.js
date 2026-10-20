// What the reading browser puts into a web page (the <webview> guest):
//  * a small script (installed with executeJavaScript, not affected by the page's CSP) that turns pages
//    instead of scrolling: a page step is the visible height minus fixed headers/footers minus an overlap of
//    a few lines, and a thin dashed line marks where the previous page ended. It also reports the position
//    ("Seite 3 von 12") through console.debug('__cozyshelves:{…}'), which the panel reads from 'console-message'.
//    Those messages only move the page counter or toggle the reader, so a page imitating them gains nothing.
//  * CSS for the themes, bold/black text, the web font, hidden images, cookie banners and "Nur Text".
import { FONTS, LINE_COLOR } from './prefs.js';

/* eslint-disable no-undef */
function guestMain(cfg) {
  const KEY = '__cozyshelvesBrowser';
  const existing = window[KEY];
  if (existing && existing.v === cfg.v) { existing.config(cfg); return existing.pos(); }
  let C = cfg;
  const log = console.debug.bind(console);
  const se = () => document.scrollingElement || document.documentElement;
  const editable = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return !/^(button|checkbox|radio|range|submit|reset|image|color|file)$/i.test(el.type || '');
    const role = el.getAttribute && el.getAttribute('role');
    return role === 'textbox' || role === 'combobox' || role === 'searchbox';
  };
  const scrollable = (el) => {
    if (!el || el === document.body || el === document.documentElement) return false;
    const s = getComputedStyle(el);
    return /(auto|scroll|overlay)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 8 && el.clientHeight > innerHeight * 0.45;
  };
  let inner = null;
  function scroller() {
    const root = se();
    if (root.scrollHeight > innerHeight + 8 && getComputedStyle(document.body || root).overflowY !== 'hidden') return root;
    if (inner && inner.isConnected && scrollable(inner)) return inner;
    inner = null;
    // an app-like page that scrolls an inner box: take the one under the middle of the window
    let el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    while (el && el !== document.body) { if (scrollable(el)) { inner = el; return el; } el = el.parentElement; }
    return root;
  }
  function insets(sc) {
    const box = sc === se() ? { top: 0, bottom: innerHeight } : sc.getBoundingClientRect();
    const vh = box.bottom - box.top;
    let top = 0, bottom = 0;
    const fixed = (el) => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const p = getComputedStyle(e).position; if (p === 'fixed' || p === 'sticky') return e; } return null; };
    for (const fx of [0.2, 0.5, 0.8]) {
      const x = Math.round(innerWidth * fx);
      const t = fixed(document.elementFromPoint(x, box.top + 3));
      if (t) { const r = t.getBoundingClientRect(); if (r.top <= box.top + 4 && r.bottom - box.top < vh * 0.35) top = Math.max(top, r.bottom - box.top); }
      const b = fixed(document.elementFromPoint(x, box.bottom - 3));
      if (b) { const r = b.getBoundingClientRect(); if (r.bottom >= box.bottom - 4 && box.bottom - r.top < vh * 0.35) bottom = Math.max(bottom, box.bottom - r.top); }
    }
    return { top: Math.max(0, Math.round(top)), bottom: Math.max(0, Math.round(bottom)), boxTop: box.top, vh };
  }
  const lineH = () => { const fs = parseFloat(getComputedStyle(document.body || se()).fontSize) || 16; return Math.round(fs * 1.5); };
  function metrics() {
    const sc = scroller();
    const root = sc === se();
    const ins = insets(sc);
    const y = root ? window.scrollY : sc.scrollTop;
    const h = sc.scrollHeight;
    const vh = root ? innerHeight : sc.clientHeight;
    const stepPx = Math.max(Math.round(vh * 0.3), vh - ins.top - ins.bottom - C.overlap * lineH());
    return { sc, root, ins, y, h, vh, stepPx, max: Math.max(0, h - vh) };
  }
  function pos() {
    const m = metrics();
    const pages = m.max <= 2 ? 1 : Math.ceil(m.max / m.stepPx) + 1;
    const atEnd = m.y >= m.max - 2;
    const page = atEnd ? pages : Math.min(pages, Math.floor((m.y + 2) / m.stepPx) + 1);
    return { t: 'pos', page, pages, frac: m.max ? Math.min(1, m.y / m.max) : 0, atEnd, atStart: m.y <= 2 };
  }
  function scrollTo(m, y) {
    if (m.root) window.scrollTo({ top: y, behavior: 'instant' });
    else m.sc.scrollTo({ top: y, behavior: 'instant' });
  }
  let lineHost = null, lineBar = null, lineTimer = 0;
  function line(y) {
    if (!C.line) return;
    if (!lineHost) {
      lineHost = document.createElement('lesesaal-seitenrand');
      lineHost.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:100%;height:0;z-index:2147483647;pointer-events:none;display:block;';
      const sh = lineHost.attachShadow({ mode: 'closed' });
      lineBar = document.createElement('div');
      sh.appendChild(lineBar);
    }
    lineBar.style.cssText = `position:absolute;left:0;right:0;top:${Math.round(y)}px;height:0;border-top:2px dashed ${C.color};opacity:${C.eink ? 1 : 0.8};`;
    if (!lineHost.isConnected) document.documentElement.appendChild(lineHost);
    clearTimeout(lineTimer);
    lineTimer = setTimeout(() => { try { lineHost.remove(); } catch {} }, 1600);
  }
  function page(dir) {
    const m = metrics();
    const before = m.y;
    const target = Math.max(0, Math.min(m.max, before + dir * m.stepPx));
    scrollTo(m, target);
    const after = m.root ? window.scrollY : m.sc.scrollTop;
    const moved = after - before;
    if (moved) {
      const top = m.ins.boxTop + m.ins.top, bottom = m.ins.boxTop + m.vh - m.ins.bottom;
      const y = moved > 0 ? bottom - moved : top - moved;
      if (y > m.ins.boxTop + 4 && y < m.ins.boxTop + m.vh - 4) line(y);
    }
    const p = pos();
    p.moved = moved;
    return p;
  }
  function goFrac(f) {
    const m = metrics();
    scrollTo(m, Math.round(Math.max(0, Math.min(1, f)) * m.max));
    return pos();
  }
  let notifyTimer = 0;
  function notify(obj) { try { log('__cozyshelves:' + JSON.stringify(obj)); } catch {} }
  function onScroll() {
    if (notifyTimer) return;
    notifyTimer = setTimeout(() => { notifyTimer = 0; notify(pos()); }, 220);
  }
  function onKey(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    if (editable(e.target) || editable(document.activeElement)) return;
    let dir = 0;
    switch (e.key) {
      case ' ': case 'Spacebar': dir = e.shiftKey ? -1 : 1; break;
      case 'PageDown': dir = 1; break;
      case 'PageUp': dir = -1; break;
      case 'ArrowRight': dir = C.arrows ? 1 : 0; break;
      case 'ArrowLeft': dir = C.arrows ? -1 : 0; break;
      case 'r': case 'v': if (!C.app) notify({ t: 'key', k: e.key }); return;   // reader mode, read aloud (the panel decides; not in a map)
      default: return;
    }
    if (!dir || !C.keys) return;
    e.preventDefault();
    notify(page(dir));
  }
  // Consent walls the style sheet does not know: a large fixed layer over the page whose text (or frame) is
  // about cookies and consent is hidden, together with its empty veil, and the page scrolls again.
  const CONSENT_WORDS = /(cookie|einwillig|zustimm|datenschutz|partner|consent|privacy|tracking|akzeptier|accept|werbung|personalis)/gi;
  const CONSENT_NAMES = /(consent|privacy-mgmt|sourcepoint|sp_message|\bcmp\b|cmp-|cookie|usercentrics|onetrust|didomi|quantcast|trustarc|cookiebot|borlabs)/i;
  function bigFixed(el) {
    let cand = null;
    for (let x = el; x && x !== document.body && x !== document.documentElement; x = x.parentElement) {
      if (getComputedStyle(x).position !== 'fixed') continue;
      const r = x.getBoundingClientRect();
      if (r.width >= innerWidth * 0.3 && r.height >= innerHeight * 0.2) cand = x;
    }
    return cand;
  }
  function consentLike(el) {
    const frames = el.tagName === 'IFRAME' ? [el] : [...el.querySelectorAll('iframe')];
    if (frames.some((f) => CONSENT_NAMES.test([f.id, f.title, f.name, f.src].join(' ')))) return true;
    if (CONSENT_NAMES.test((el.id || '') + ' ' + String(el.className || ''))) return true;
    const words = new Set(((el.innerText || '').slice(0, 6000).match(CONSENT_WORDS) || []).map((w) => w.toLowerCase().slice(0, 6)));
    return words.size >= 3;
  }
  function hideWalls() {
    if (!C.cookies || !document.body) return 0;
    const seen = new Set();
    let hidden = 0;
    const layers = [];
    for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.3], [0.5, 0.75], [0.06, 0.5], [0.94, 0.5]]) {
      for (const el of document.elementsFromPoint(innerWidth * fx, innerHeight * fy)) {
        const f = bigFixed(el);
        if (f && !seen.has(f)) { seen.add(f); layers.push(f); }
      }
    }
    for (const f of layers) if (consentLike(f)) { f.style.setProperty('display', 'none', 'important'); hidden++; }
    if (!hidden) return 0;
    // the grey veil behind such a dialog: a nearly full-window fixed layer without text of its own
    for (const f of layers) {
      if (f.style.display === 'none') continue;
      const r = f.getBoundingClientRect();
      if (r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9 && (f.innerText || '').trim().length < 20 && !f.querySelector('img, video, canvas')) f.style.setProperty('display', 'none', 'important');
    }
    for (const e of [document.documentElement, document.body]) {
      const s = getComputedStyle(e);
      if (s.overflowY === 'hidden' || s.overflow === 'hidden') e.style.setProperty('overflow', 'auto', 'important');
      if (s.position === 'fixed') e.style.setProperty('position', 'static', 'important');
    }
    return hidden;
  }
  for (const ms of [300, 1500, 4000, 8000, 15000]) setTimeout(hideWalls, ms);

  window.addEventListener('keydown', onKey);
  document.addEventListener('scroll', onScroll, { passive: true, capture: true });
  window.addEventListener('resize', onScroll, { passive: true });
  window[KEY] = {
    v: cfg.v, page, pos, goFrac, hideWalls,
    config(c) { const was = C.cookies; C = { ...C, ...c }; if (C.cookies && !was) hideWalls(); },
    // the page's own text of the current selection (read aloud "from here")
    selection: () => String(getSelection() || '').trim().slice(0, 20000),
  };
  return pos();
}

/** Source code of the guest script call for the current settings. */
export function guestScript(prefs, theme, { app = false } = {}) {
  const cfg = {
    v: 5,
    app: !!app,                 // a map application (util.js isAppPage): its keys and its dialogs stay its own
    overlap: prefs.overlap,
    line: prefs.line,
    keys: !app,
    arrows: !app,
    eink: theme === 'eink',
    color: theme === 'night' && prefs.webStyle ? LINE_COLOR.night : theme === 'night' ? '#b5562a' : LINE_COLOR[theme] || LINE_COLOR.paper,
    cookies: !!prefs.cookies && !app,
  };
  return `(${guestMain.toString()})(${JSON.stringify(cfg)})`;
}

/** Full HTML of the page for the reader mode: the live DOM after the page's scripts ran. Elements the page
 *  hides with its style sheets (menus, dialogs, off-canvas navigation) are marked for the extraction, and the
 *  marks are removed again right away. */
export const SNAPSHOT_SCRIPT = `(() => {
  const d = document, el = d.documentElement;
  const marked = [];
  try {
    const all = d.body ? d.body.getElementsByTagName('*') : [];
    for (let i = 0; i < all.length && marked.length < 30000; i++) {
      const e = all[i];
      if (e.parentElement && e.parentElement.closest('[data-lsb-hidden]')) continue;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') { e.setAttribute('data-lsb-hidden', ''); marked.push(e); }
    }
  } catch (err) {}
  let html = el ? el.outerHTML : '';
  for (const e of marked) e.removeAttribute('data-lsb-hidden');
  if (html.length > 8e6) html = html.slice(0, 8e6);
  return { html, url: location.href, title: d.title || '', lang: (el && el.lang) || '' };
})()`;

// Cookie and consent dialogs of the common consent platforms. Hidden, never answered: the page then behaves
// as if nothing was accepted. Scroll locks these dialogs put on <html>/<body> are lifted as well.
const COOKIE_SELECTORS = [
  '#onetrust-consent-sdk', '#onetrust-banner-sdk', '.onetrust-pc-dark-filter', '#CybotCookiebotDialog', '#CybotCookiebotDialogBodyUnderlay',
  '[id^="sp_message_container"]', 'iframe[id^="sp_message_iframe"]', 'iframe[src*="privacy-mgmt.com"]', 'iframe[title="SP Consent Message"]', '.sp_veil',
  '#usercentrics-root', '#usercentrics-cmp-ui', '#uc-banner-modal', '.fc-consent-root', '.fc-dialog-overlay', '#didomi-host', '.didomi-popup-backdrop',
  '.qc-cmp2-container', '#qc-cmp2-container', '#cmpbox', '#cmpbox2', '.cmpboxBG', '#cmpwrapper', '.cmp-root',
  '#cookie-law-info-bar', '.cky-consent-container', '.cky-overlay', '#cookiescript_injected', '.cc-window', '.cc-banner', '.cookiefirst-root',
  '#BorlabsCookieBox', '#iubenda-cs-banner', '.truste_overlay', '.truste_box_overlay', '#truste-consent-track', '#consent_blackbar', '.evidon-banner',
  '#gdpr-consent-tool-wrapper', '#cmp-app-container', '#__tealiumGDPRecModal', '.klaro .cookie-modal', '.klaro .cookie-notice', '.osano-cm-window',
  '#ccc', '#cookieChoiceInfo', '#cookie-notice', '.cookie-notice', '#cookie-banner', '.cookie-banner', '#cookieBanner', '.cookieBanner',
  '#cookie-consent', '.cookie-consent', '#gdpr-banner', '.gdpr-banner', 'div[aria-label="Cookie banner"]', '.consent-banner', '#consent-banner',
];
const COOKIE_UNLOCK = ['html.sp-message-open', 'html.sp-message-open body', 'body.didomi-popup-open', 'html.didomi-popup-open', 'body.qc-cmp-ui-showing', 'body.cmp-open', 'html.cmp-open', 'body.cookiebanner-open', 'html.has-cookie-banner', 'body.uc-overflow-hidden', 'body.cky-modal-open', 'body.cmpbox-open'];

/** The CSS for a guest page (one string, replaced as a whole when a setting changes). It is inserted as a
 *  user style sheet, and every rule is !important: that beats the page's own !important rules and inline
 *  styles, which consent dialogs like to use. */
export function guestCss(prefs, theme, { reduceMotion, app = false } = {}) {
  const out = ['html { scroll-behavior: auto !important; }'];
  // a map application keeps its own look: no inverted night colours (Street View and the map tiles would be filtered
  // twice), no grey E-Ink pictures, no hidden images, no book font
  if (app) return out.join('\n');
  const style = prefs.webStyle;
  if (theme === 'eink' || reduceMotion) {
    out.push('*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; scroll-behavior: auto !important; }');
  }
  if (style && theme === 'eink') out.push('@media screen { img, video, picture, canvas { filter: grayscale(1) contrast(1.08) !important; } }');
  if (style && theme === 'night') {
    // screen only: "Als PDF speichern" prints the page with its own colours
    out.push('@media screen { html { filter: invert(1) hue-rotate(180deg) contrast(0.92) !important; background: #fff !important; }');
    out.push('img, video, picture, canvas, iframe, embed, object, svg image, [style*="background-image"] { filter: invert(1) hue-rotate(180deg) !important; } }');
  }
  if (style && prefs.bold) {
    out.push('body, body *:not(svg):not(path) { font-weight: 600 !important; }');
    out.push('h1, h2, h3, h4, h5, h6, b, strong, th, h1 *, h2 *, h3 *, b *, strong * { font-weight: 800 !important; }');
  }
  if (style && prefs.black) {
    out.push('body, body *:not(svg):not(path):not(a):not(a *) { color: #000 !important; -webkit-text-fill-color: #000 !important; }');
    out.push('a, a * { color: #000 !important; -webkit-text-fill-color: #000 !important; text-decoration-line: underline !important; }');
  }
  if (prefs.webFont) {
    const fam = (FONTS[prefs.font] || FONTS.garamond).web;
    out.push(`body, body *:not(code):not(pre):not(kbd):not(samp):not(tt):not(i):not([class*="icon"]):not([class*="Icon"]):not([class*="fa-"]):not([class*="material"]):not([class*="symbol"]) { font-family: ${fam} !important; }`);
  }
  if (!prefs.images || prefs.textOnly) {
    out.push('img, picture, video, amp-img, image { display: none !important; } *, *::before, *::after { background-image: none !important; }');
  }
  if (prefs.cookies) {
    out.push(`${COOKIE_SELECTORS.join(', ')} { display: none !important; visibility: hidden !important; }`);
    out.push(`${COOKIE_UNLOCK.join(', ')} { overflow: auto !important; position: static !important; height: auto !important; }`);
  }
  if (prefs.textOnly) {
    const ink = theme === 'night' ? '#ecebe8' : theme === 'eink' ? '#000' : theme === 'sepia' ? '#2b1d12' : '#1f1d1b';
    const bg = theme === 'night' ? '#151516' : theme === 'eink' ? '#fff' : theme === 'sepia' ? '#efe2c6' : '#fdfcfa';
    const fam = (FONTS[prefs.font] || FONTS.garamond).web;
    out.push(`html, body { background: ${bg} !important; }`);
    out.push(`*, *::before, *::after { background-color: transparent !important; box-shadow: none !important; text-shadow: none !important; border-color: rgba(128,128,128,.35) !important; }`);
    out.push(`body, body *:not(svg):not(path) { color: ${ink} !important; -webkit-text-fill-color: ${ink} !important; }`);
    out.push(`body p, body li, body td, body dd, body blockquote, body article, body main { font-family: ${fam} !important; line-height: 1.6 !important; }`);
    out.push('iframe, svg, canvas, object, embed, audio, video, [role="img"], figure, picture { display: none !important; } a { text-decoration: underline !important; }');
    // wrappers that only held a picture (fixed aspect-ratio boxes) collapse with it
    out.push(':is(div, span, a, p):has(> :is(img, picture, figure, video):only-child) { display: none !important; }');
  }
  return out.join('\n');
}
