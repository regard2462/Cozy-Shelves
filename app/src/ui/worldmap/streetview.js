// Street View and Google Maps inside the world map panel: a <webview> in the reading browser's partition
// ('persist:lesesaal-browser', hardened in electron/main.js; the content blocker of electron/browser applies), so the
// cookie choice made on Google's consent page once holds here and in the Lesebrowser. The page gets no helper
// script and no style sheet of the reading browser: Street View keeps every key and mouse movement for itself.
//
// Street View opens at a point through the Maps URL API (no key needed):
//   https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=LAT,LNG
// Google shows the nearest panorama. When there is none (the address never switches to the panorama view within a
// few seconds), the map of the place opens instead, with a note. Esc (also from inside the page) returns to the map.
import { h, clear } from '../../core/dom.js';
import { tr, i18n } from '../../core/i18n.js';

const PARTITION = 'persist:lesesaal-browser';
const PANO_WAIT = 9000;

if (typeof window !== 'undefined' && !window.__cozyshelvesWebviewQuirk) {
  // the same guard as the reading browser: a <webview> removed after its guest is gone throws from a custom element
  // reaction ("Invalid guestInstanceId"), which no try/catch can reach and which has no consequence
  window.__cozyshelvesWebviewQuirk = true;
  window.addEventListener('error', (e) => { if (/Invalid guestInstanceId/.test(String(e?.message || ''))) e.preventDefault(); });
}

export function mapsUrl(mode, lat, lon) {
  const hl = i18n.lang === 'en' ? 'en' : 'de';
  const ll = `${(+lat).toFixed(6)},${(+lon).toFixed(6)}`;
  if (mode === 'pano') return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${ll}&hl=${hl}`;
  return `https://www.google.com/maps/@?api=1&map_action=map&center=${ll}&zoom=${mode === 'sat' ? 17 : 15}&basemap=${mode === 'sat' ? 'satellite' : 'roadmap'}&hl=${hl}`;
}
/** true when a Google Maps address shows a panorama (Street View or a photo sphere): it names the panorama's id,
 *  "…/data=!3m7!1e1!3m5!1s<id>!2e0…". Without imagery the address keeps the Street View form without an id
 *  ("…/data=!3m3!1e1!3m1!6s…") and Maps only says that there are no pictures here. */
export const isPanoUrl = (u) => /!3m\d+!1e1!3m\d+!1s[\w-]{6,}/.test(String(u || '').split('data=')[1] || '');
const isConsent = (u) => /^https:\/\/consent\.(google|youtube)\./i.test(String(u || ''));

/**
 * @param ctx   panel context ({ api, openPanel, toast })
 * @param opts  { onClose(), onNav() (the view's history changed) }
 * @returns { el, open({ lat, lon, title, mode }), close(), isOpen(), back(), forward(), canForward(), onKey(e), state(), destroy() }
 */
export function createStreetView(ctx, { onClose, onNav } = {}) {
  const { api } = ctx;
  const T = (de, en, vars) => tr({ de, en }, vars);
  const canWebview = !!api?.isElectron && typeof document.createElement('webview').getWebContentsId === 'function';
  const rpc = (ch, ...a) => (typeof api?.invoke === 'function' ? api.invoke(ch, ...a) : Promise.reject(new Error('no api')));

  let wv = null, wcId = null, attached = false, target = null, mode = 'pano', open = false;
  let loading = false, error = null, panoState = 'idle', panoTimer = 0, panoStart = 0, fellBack = false, everLoaded = false;
  const offs = [];

  const btn = (label, onclick, cls = '', title) => h('button.wm-sv-btn' + cls, { type: 'button', title: title || label, onclick, onmousedown: (e) => e.preventDefault() }, label);
  const back = btn('‹', () => nav(-1), '.icon', T('Zurück (Alt+←)', 'Back (Alt+←)'));
  const fwd = btn('›', () => nav(1), '.icon', T('Vorwärts (Alt+→)', 'Forward (Alt+→)'));
  const toMap = btn(T('‹ Weltkarte', '‹ World map'), () => close(), '.home', T('Zurück zur Weltkarte (Esc)', 'Back to the world map (Esc)'));
  const titleEl = h('div.wm-sv-title');
  const modes = h('div.wm-sv-modes', { role: 'tablist' });
  const inBrowser = btn(T('Im Lesebrowser', 'In the reading browser'), () => handOver(), '', T('Diese Seite im Lesebrowser weiterlesen', 'Continue with this page in the reading browser'));
  const closeBtn = btn('✕', () => close(), '.icon', T('Schließen (Esc)', 'Close (Esc)'));
  const bar = h('div.wm-sv-bar', toMap, back, fwd, titleEl, modes, inBrowser, closeBtn);
  const progress = h('div.wm-sv-progress', h('i'));
  const stage = h('div.wm-sv-stage');
  const note = h('div.wm-sv-note', { hidden: true, role: 'status' });
  const errorEl = h('div.wm-sv-error', { hidden: true });
  stage.append(errorEl, note);
  const el = h('div.wm-sv', { hidden: true }, bar, progress, stage);

  function renderBar() {
    clear(modes);
    for (const [m, label] of [['pano', 'Street View'], ['map', T('Karte', 'Map')], ['sat', T('Satellit', 'Satellite')]]) {
      modes.append(h('button.wm-sv-mode', { type: 'button', role: 'tab', 'aria-selected': m === mode ? 'true' : 'false', class: m === mode ? 'on' : '', onmousedown: (e) => e.preventDefault(), onclick: () => setMode(m) }, label));
    }
    titleEl.textContent = target ? target.title : '';
    let canBack = false, canFwd = false;
    try { canBack = !!wv && attached && wv.canGoBack(); canFwd = !!wv && attached && wv.canGoForward(); } catch {}
    back.disabled = !canBack; fwd.disabled = !canFwd;
    progress.classList.toggle('on', loading);
    onNav?.();
  }
  let noteKind = '';
  function showNote(text, ms = 0, kind = '') {
    note.textContent = text; note.hidden = !text; noteKind = text ? kind : '';
    clearTimeout(showNote.t);
    if (text && ms) showNote.t = setTimeout(() => { note.hidden = true; noteKind = ''; }, ms);
  }
  function showError(e) {
    error = e;
    clear(errorEl);
    errorEl.hidden = !e;
    if (!e) return;
    errorEl.append(h('div.wm-sv-error-card',
      h('h3', T('Google Maps ließ sich nicht laden', 'Google Maps could not be loaded')),
      h('p', e.text || ''),
      h('div.wm-sv-error-actions',
        h('button.btn.small.primary', { type: 'button', onclick: () => { showError(null); load(mapsUrl(mode, target.lat, target.lon)); } }, T('Erneut versuchen', 'Try again')),
        h('button.btn.small', { type: 'button', onclick: () => api.app?.openExternal?.(currentUrl()) }, T('Im Systembrowser öffnen', 'Open in the system browser')))));
  }

  function currentUrl() { try { return wv && attached ? wv.getURL() : ''; } catch { return ''; } }

  function create(url) {
    const v = document.createElement('webview');
    v.className = 'wm-sv-view';
    v.setAttribute('partition', PARTITION);
    v.setAttribute('webpreferences', 'nodeIntegration=no,contextIsolation=yes,sandbox=yes,javascript=yes');
    v.setAttribute('src', url);
    wv = v; attached = false; wcId = null; loading = true;
    const mine = () => wv === v && open;
    v.addEventListener('did-attach', () => { attached = true; }, { once: true });
    v.addEventListener('dom-ready', () => {
      if (!mine()) return;
      try { wcId = v.getWebContentsId(); } catch {}
      if (!everLoaded) { everLoaded = true; try { v.focus(); } catch {} }
      renderBar();
    });
    v.addEventListener('did-start-loading', () => { if (mine()) { loading = true; renderBar(); } });
    v.addEventListener('did-stop-loading', () => { if (mine()) { loading = false; renderBar(); } });
    // Google's consent page: a note while it shows. After the choice Google sends the page back to the address, but
    // Street View then asks for the panorama's data without its id (HTTP 400) and stays black; the same address,
    // loaded once more after that first visit, shows it.
    let sawConsent = false, reloadAfterConsent = false;
    v.addEventListener('did-navigate', (e) => {
      if (!mine()) return;
      if (isConsent(e.url)) { sawConsent = true; showNote(T('Google fragt vor der ersten Nutzung, welche Cookies erlaubt sind. Die Wahl gilt danach auch im Lesebrowser.', 'Before the first use Google asks which cookies it may set. The choice then also applies in the reading browser.'), 0, 'consent'); }
      else {
        if (noteKind === 'consent') showNote('');
        if (sawConsent && /^https:\/\/www\.google\.[a-z.]+\/maps/i.test(e.url)) { sawConsent = false; reloadAfterConsent = true; }
      }
      renderBar();
    });
    v.addEventListener('did-stop-loading', () => {
      if (!mine() || !reloadAfterConsent) return;
      reloadAfterConsent = false;
      setTimeout(() => { if (mine() && target) setMode(mode); }, 1500);
    });
    v.addEventListener('did-navigate-in-page', () => { if (mine()) renderBar(); });
    v.addEventListener('did-fail-load', (e) => {
      if (!mine() || !e.isMainFrame || e.errorCode === -3) return;
      loading = false;
      showError({ code: e.errorCode, text: `${e.errorDescription || ''} (${e.errorCode})` });
      renderBar();
    });
    v.addEventListener('render-process-gone', () => { if (mine()) showError({ code: 'crashed', text: T('Die Seite ist abgestürzt.', 'The page crashed.') }); });
    // full screen from inside the page (the window goes full screen, the view covers it)
    v.addEventListener('enter-html-full-screen', () => { if (mine()) el.classList.add('fullscreen'); });
    v.addEventListener('leave-html-full-screen', () => el.classList.remove('fullscreen'));
    stage.prepend(v);
  }
  function load(url) {
    showError(null);
    if (!wv) { create(url); return; }
    loading = true; renderBar();
    if (wcId != null) rpc('browser:navigate', wcId, url).then((ok) => { if (!ok && wv) wv.loadURL(url).catch(() => {}); }).catch(() => { if (wv) wv.loadURL(url).catch(() => {}); });
    else wv.setAttribute('src', url);     // not attached yet: the address is taken over when it is
  }
  function destroyView() {
    const v = wv;
    wv = null; wcId = null; attached = false; loading = false;
    if (!v) return Promise.resolve();
    // like the reading browser: stop first and wait for the attachment, or Electron logs "Invalid guestInstanceId"
    return new Promise((resolve) => {
      let done = false;
      const dispose = () => { if (done) return; done = true; try { v.stop(); } catch {} try { v.remove(); } catch {} resolve(); };
      let isAttached = false;
      try { isAttached = v.getWebContentsId() != null; } catch {}
      if (isAttached) dispose();
      else { v.addEventListener('did-attach', () => setTimeout(dispose, 0), { once: true }); setTimeout(dispose, 5000); }
    });
  }

  function watchPano() {
    clearTimeout(panoTimer);
    panoState = 'wait'; panoStart = Date.now(); fellBack = false;
    const check = () => {
      if (!open || mode !== 'pano' || !wv) return;
      const u = currentUrl();
      if (isConsent(u) || !u) { panoStart = Date.now(); panoTimer = setTimeout(check, 800); return; }   // the user decides first
      if (isPanoUrl(u)) { panoState = 'found'; showNote(''); return; }
      if (Date.now() - panoStart > PANO_WAIT) {
        setMode('map', { keepNote: true });
        panoState = 'none'; fellBack = true;
        showNote(T('Hier gibt es keine Street-View-Aufnahmen. Die Karte zeigt die Umgebung.', 'There is no Street View imagery here. The map shows the surroundings.'), 9000);
        return;
      }
      panoTimer = setTimeout(check, 600);
    };
    panoTimer = setTimeout(check, 1200);
  }

  function setMode(m, { keepNote = false } = {}) {
    if (!target) return;
    mode = m;
    if (!keepNote) showNote('');
    load(mapsUrl(m, target.lat, target.lon));
    renderBar();
    if (m === 'pano') watchPano(); else { clearTimeout(panoTimer); panoState = 'idle'; }
  }
  function nav(d) { try { if (d < 0 && wv?.canGoBack()) wv.goBack(); else if (d > 0 && wv?.canGoForward()) wv.goForward(); } catch {} }
  const canGo = (d) => { try { return !!wv && attached && (d < 0 ? wv.canGoBack() : wv.canGoForward()); } catch { return false; } };
  /** Back like in a browser: the page before, and from the first page back to the map. */
  function goBack() { if (!open) return false; if (canGo(-1)) nav(-1); else close(); return true; }
  function goForward() { if (!open || !canGo(1)) return false; nav(1); return true; }

  function openAt(t) {
    target = { lat: +t.lat, lon: +t.lon, title: t.title || '' };
    open = true; el.hidden = false; everLoaded = false;
    if (!canWebview) {
      showError({ text: T('Street View gibt es nur in der Cozy-Shelves-App.', 'Street View is only available in the Cozy Shelves app.') });
      renderBar();
      return;
    }
    setMode(t.mode || 'pano');
    ctx.audio?.sfx?.('click');
  }
  function close() {
    if (!open) return Promise.resolve();
    open = false; el.hidden = true; el.classList.remove('fullscreen');
    clearTimeout(panoTimer); panoState = 'idle';
    showNote(''); showError(null);
    const p = destroyView();
    onClose?.();
    return p;
  }
  /** The page goes on in the reading browser (the panel opens on top of the map). */
  function handOver() {
    const url = currentUrl() || (target ? mapsUrl(mode, target.lat, target.lon) : '');
    close();
    if (/^https?:/i.test(url)) ctx.openPanel?.('browser', { url });
  }

  /** Esc: out of full screen first, then back to the map. */
  function escape() {
    if (el.classList.contains('fullscreen')) { try { wv?.executeJavaScript('document.fullscreenElement && document.exitFullscreen()').catch(() => {}); } catch {} return; }
    close();
  }

  // keys pressed inside the page: the main process forwards Esc and the browser shortcuts (electron/browser)
  if (typeof api?.on === 'function') {
    offs.push(api.on('browser:key', (k) => {
      if (!open || !k || wcId == null || k.id !== wcId) return;
      if (k.key === 'Escape') escape();
      else if (k.key === 'F5' || (k.ctrl && String(k.key).toLowerCase() === 'r')) { try { wv?.reload(); } catch {} }
      else if (k.alt && k.key === 'ArrowLeft') goBack();
      else if (k.alt && k.key === 'ArrowRight') goForward();
    }));
    // "open in a new window" inside Maps: into the reading browser
    offs.push(api.on('browser:popup', (p) => { if (open && p && wcId != null && p.id === wcId && /^https?:/i.test(p.url || '')) ctx.openPanel?.('browser', { url: p.url }); }));
  }

  return {
    el,
    open: openAt,
    close,
    isOpen: () => open,
    back: goBack,
    forward: goForward,
    canForward: () => canGo(1),
    /** Keys that reach the panel while the page itself does not have the focus. */
    onKey(e) {
      if (!open) return false;
      if (e.key === 'Escape') { escape(); return true; }
      if (e.altKey && e.key === 'ArrowLeft') { goBack(); return true; }
      if (e.altKey && e.key === 'ArrowRight') { goForward(); return true; }
      if (e.key === 'F5') { try { wv?.reload(); } catch {} return true; }
      return false;
    },
    state: () => ({ open, mode, url: currentUrl(), wcId, loading, pano: panoState, fellBack, error: error ? error.text : null, note: note.hidden ? '' : note.textContent }),
    destroy() { for (const off of offs.splice(0)) { try { off?.(); } catch {} } clearTimeout(panoTimer); open = false; return destroyView(); },
  };
}
