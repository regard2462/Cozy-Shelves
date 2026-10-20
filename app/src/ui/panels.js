// Panel manager: 2D overlays (reader, computer, newspaper, chess, watercolor …) on top of the 3D world.
// Each panel module exports  { mount(container, ctx, params) -> {unmount?(), onKey?(e)} }
import { h } from '../core/dom.js';
import { bus } from '../core/bus.js';
import { has } from '../core/platform.js';

const registry = {
  reader: () => import('./reader/reader-panel.js'),
  computer: () => import('./computer/computer-panel.js'),
  news: () => import('./news/news-panel.js'),
  podcasts: () => import('./podcasts/podcast-panel.js'),
  wiki: () => import('./wiki/wiki-panel.js'),
  chess: () => import('./chess/chess-panel.js'),
  watercolor: () => import('./watercolor/watercolor-panel.js'),
  gallery: () => import('./gallery/gallery-panel.js'),
  basket: () => import('./basket.js'),
  menu: () => import('./menu.js'),
  settings: () => import('./settings.js'),
  records: () => import('./records.js'),
  bookinfo: () => import('./bookinfo.js'),
  catalog: () => import('./catalog/catalog-panel.js'),
  browser: () => import('./browser/browser-panel.js'),
  mediathek: () => import('./mediathek/mediathek-panel.js'),
  worldmap: () => import('./worldmap/worldmap-panel.js'),
  // the card over the start menu while no books folder is set
  welcome: () => import('./welcome.js'),
  audiobooks: () => import('./audiobooks/ab-panel.js'),
  duplicates: () => import('./duplicates.js'),   // "Doppelte Bücher" (settings, computer)
  search: () => import('./search/search-panel.js'),
};

const stack = [];
const pending = new Map();   // name -> the mount promise that is still running
let root;
let seq = 0;

export function initPanels(container) {
  root = container;
  // the side buttons of a mouse (4 = back, 5 = forward) lead through the history of the topmost panel
  const side = (e) => e.button === 3 || e.button === 4;
  document.addEventListener('mousedown', (e) => { if (side(e) && currentPanel()) e.preventDefault(); }, true);
  document.addEventListener('mouseup', (e) => {
    if (!side(e) || !currentPanel()) return;
    e.preventDefault();
    panelNav(e.button === 3 ? -1 : 1, 'mouse');
  }, true);
}

/** Back (-1) or forward (1) in the topmost panel: its onNav(dir) decides. A press of a mouse side button can
 *  also arrive as a Windows app command ('browser-backward'); the second report of the same press is dropped. */
let lastNav = { at: 0, dir: 0, source: '' };
export function panelNav(dir, source = 'key') {
  const now = performance.now();
  if (now - lastNav.at < 450 && lastNav.dir === dir && lastNav.source !== source) return true;
  lastNav = { at: now, dir, source };
  const top = currentPanel();
  if (!top) return false;
  try { return top.instance?.onNav?.(dir) === true; } catch (e) { console.error('[panels] nav', e); return false; }
}

export function currentPanel() { return stack[stack.length - 1] || null; }
export function isPanelOpen(name) { return stack.some((p) => p.name === name); }

export async function openPanel(name, params = {}, ctx = {}) {
  if (!registry[name]) throw new Error('unknown panel ' + name);
  // without the full-text index (the browser version) the search is the computer's catalogue in its text mode
  if (name === 'search' && !has('fulltext')) { name = 'computer'; params = { section: 'catalog', q: params?.q || '' }; }
  // A mount of the same panel may still be running (double click, Escape-then-click). Wait for it, so that the
  // replacement below closes a *finished* instance and can run its real unmount() instead of orphaning it –
  // an orphan keeps its bus listeners, timers and WebGL contexts alive for the rest of the session.
  const inflight = pending.get(name);
  if (inflight) { try { await inflight; } catch { /* the failed mount has rendered its own error card */ } }
  // A panel that is already open is rebuilt with the new params (another book, painting slot, section …);
  // params.reopen stacks a second instance on top instead.
  if (!params.reopen) { while (closePanel(name)) { /* close every instance of this panel */ } }

  const el = h('div.panel-layer', { dataset: { panel: name } });
  root.appendChild(el);
  const entry = { id: ++seq, name, el, params, instance: null };
  stack.push(entry);
  bus.emit('panel:open', name, params);

  const task = (async () => {
    const panelCtx = { ...ctx, close: () => closeEntry(entry), openPanel: (n, p) => openPanel(n, p, ctx) };
    let instance = {};
    try {
      const mod = await registry[name]();
      instance = (await mod.mount(el, panelCtx, params)) || {};
    } catch (e) {
      console.error('[panels] mount failed', name, e);
      el.appendChild(h('div.panel.panel-error', h('h2', 'Fehler / Error'), h('pre', String((e && e.stack) || e)), h('button.btn', { onclick: () => closeEntry(entry) }, 'Schließen')));
    }
    if (!stack.includes(entry)) {          // closed or replaced while mounting → tear the orphan down
      try { instance.unmount?.(); } catch (err) { console.error('[panels] orphan unmount', err); }
      el.remove();
      return entry;
    }
    entry.instance = instance;
    requestAnimationFrame(() => el.classList.add('open'));
    return entry;
  })();

  pending.set(name, task);
  try { return await task; } finally { if (pending.get(name) === task) pending.delete(name); }
}

/** Closes one concrete instance – this is what ctx.close() of that instance is bound to. */
function closeEntry(entry) {
  const idx = stack.indexOf(entry);
  if (idx < 0) return false;
  stack.splice(idx, 1);
  let done = null;
  try { done = entry.instance?.unmount?.(); } catch (e) { console.error('[panels] unmount', e); }
  entry.el.classList.remove('open');
  entry.el.classList.add('closing');
  // an unmount may return a promise (the reading browser tears its <webview>s down first); the layer stays
  // in the document until then, at most 6 s
  const settle = done && typeof done.then === 'function' ? Promise.race([done.catch(() => {}), new Promise((r) => setTimeout(r, 6000))]) : Promise.resolve();
  settle.then(() => setTimeout(() => entry.el.remove(), 260));
  bus.emit('panel:close', entry.name);
  return true;
}

/** Closes the topmost panel, or the topmost instance of `name`. */
export function closePanel(name) {
  let entry = null;
  if (name) { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].name === name) { entry = stack[i]; break; } }
  else entry = stack[stack.length - 1] || null;
  return entry ? closeEntry(entry) : false;
}

export function closeAllPanels() { while (stack.length) closePanel(); }

export function dispatchPanelKey(e) {
  const top = currentPanel();
  if (!top) return false;
  if (top.instance?.onKey?.(e) === true) return true;
  return false;
}

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, webview, iframe, [tabindex], [contenteditable=""], [contenteditable="true"]';
const focusables = (root) => [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.disabled && (el.tabIndex >= 0 || el.tagName === 'WEBVIEW') && !el.closest('[inert]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');

/**
 * Tab stays inside the topmost panel. The HUD and the mini player lie before the panels in the document, so Tab from a
 * freshly opened panel (nothing focused yet) landed on the mini player's buttons behind the scrim, and Enter pressed
 * them unseen. The browser keeps its own order inside the panel; only the step out of it, at either end or from
 * outside, is turned into the first or last control of the panel. Returns true when the key was taken.
 */
export function trapTab(e) {
  const top = currentPanel();
  if (!top || e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return false;
  const items = focusables(top.el);
  if (!items.length) { e.preventDefault(); return true; }
  const a = document.activeElement;
  const inside = !!a && a !== document.body && top.el.contains(a);
  let target = null;
  if (!inside) target = e.shiftKey ? items[items.length - 1] : items[0];
  else if (items.includes(a)) {
    if (!e.shiftKey && a === items[items.length - 1]) target = items[0];
    else if (e.shiftKey && a === items[0]) target = items[items.length - 1];
  } else {
    // a focused element that is not in the order itself (the computer's stage, tabindex -1): its neighbour in the
    // document, wrapping around the panel
    const following = items.filter((el) => a.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    target = e.shiftKey ? items.filter((el) => !following.includes(el)).pop() || items[items.length - 1] : following[0] || items[0];
  }
  if (!target) return false;
  e.preventDefault();
  try { target.focus({ preventScroll: false }); } catch { /* ignore */ }
  return true;
}
