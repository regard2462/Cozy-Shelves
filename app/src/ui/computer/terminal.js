// Shared primitives for the library computer: keyboard lists, storage, sound helpers and the small UI kit
// (icons, buttons, cards, headings, meters, covers, segmented toggles). The colours come from the app's tokens
// (styles/ui.css), so everything follows the appearance (Hell, Sepia, Dunkel).
// NOTE: despite the file name this is NOT a shell – it is the widget library of the computer panel.
import { h, clear } from '../../core/dom.js';
import { tr } from '../../core/i18n.js';
import { coverSrc } from '../../core/cover-art.js';

/** Line icons (24 × 24, stroke = currentColor) for sections, programmes and actions. */
const ICONS = {
  home: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5v10h12v-10"/><path d="M10 19.5v-5h4v5"/>',
  catalog: '<path d="M3.5 5.5h6a2.5 2.5 0 0 1 2.5 2.5v11a2 2 0 0 0-2-2H3.5z"/><path d="M20.5 5.5h-6A2.5 2.5 0 0 0 12 8v11a2 2 0 0 1 2-2h6.5z"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4.5v4h4"/><path d="M12 8v4.2l2.8 1.8"/>',
  diary: '<path d="M5 19.5h4l10-10a2.1 2.1 0 0 0-3-3l-10 10z"/><path d="M14.5 8l3 3"/><path d="M13 19.5h6"/>',
  stats: '<path d="M4 20h16"/><path d="M6.5 16.5v-5"/><path d="M11 16.5V7"/><path d="M15.5 16.5v-7"/>',
  games: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/>',
  system: '<path d="M4 7h9"/><path d="M17 7h3"/><circle cx="15" cy="7" r="2"/><path d="M4 17h3"/><path d="M11 17h9"/><circle cx="9" cy="17" r="2"/>',
  browser: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.4 3.4 5.2 3.4 8.5s-1 6.1-3.4 8.5c-2.4-2.4-3.4-5.2-3.4-8.5s1-6.1 3.4-8.5z"/>',
  mediathek: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M10.5 9.5v5l4-2.5z" fill="currentColor"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  read: '<path d="M3.5 6.5c3-1.3 5.8-1.3 8.5.5 2.7-1.8 5.5-1.8 8.5-.5v12c-3-1.3-5.8-1.3-8.5.5-2.7-1.8-5.5-1.8-8.5-.5z"/><path d="M12 7v12"/>',
  basket: '<path d="M4 9.5h16l-1.6 9a1.5 1.5 0 0 1-1.5 1.2H7.1a1.5 1.5 0 0 1-1.5-1.2z"/><path d="M8.5 9.5L11 4.5"/><path d="M15.5 9.5L13 4.5"/>',
  shelf: '<path d="M4 20h16"/><path d="M4 4v16"/><path d="M20 4v16"/><path d="M8 17V8"/><path d="M11 17V6.5"/><path d="M14.5 17l2.2-9"/>',
  folder: '<path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  flame: '<path d="M12 20.5c3.6 0 6-2.4 6-5.7 0-3.3-2.4-5.3-3.6-8.3-1.2 1.6-1.6 3-1.8 4.3-1-1.7-2.7-3.3-4.4-4.8.3 3.2-2.2 5.2-2.2 8.8 0 3.3 2.4 5.7 6 5.7z"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  note: '<path d="M6 3.5h9l4 4v13H6z"/><path d="M14.5 3.5v4.5h4.5"/><path d="M9 12.5h7"/><path d="M9 16h5"/>',
  bookmark: '<path d="M7 3.5h10v17l-5-3.8-5 3.8z"/>',
  file: '<path d="M6 3.5h8.5l4 4v13H6z"/><path d="M14 3.5V8h4.5"/>',
  arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  sort: '<path d="M8 19V5"/><path d="M4.5 8.5L8 5l3.5 3.5"/><path d="M16 5v14"/><path d="M12.5 15.5L16 19l3.5-3.5"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
  power: '<path d="M12 3.5v8"/><path d="M7 6.8a7.5 7.5 0 1 0 10 0"/>',
  language: '<path d="M4 5.5h9"/><path d="M8.5 3.5v2"/><path d="M11 5.5c-.8 4-3.2 6.8-6.5 8.5"/><path d="M6.5 9c1.2 2.2 3.1 3.9 5.5 5"/><path d="M13 20.5l3.5-9 3.5 9"/><path d="M14.3 17.5h4.4"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 2-.8 2-1.8 0-1.3-1.1-1.6-1.1-2.7 0-1 .8-1.7 1.9-1.7h2.2a3.5 3.5 0 0 0 3.5-3.6C20.5 7 16.7 3.5 12 3.5z"/><circle cx="7.8" cy="11.5" r="1.1" fill="currentColor"/><circle cx="10.3" cy="7.6" r="1.1" fill="currentColor"/><circle cx="15" cy="7.8" r="1.1" fill="currentColor"/>',
};
/** An icon as an inline SVG element (aria-hidden). */
export function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'term-ico' + (cls ? ' ' + cls : ''));
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = ICONS[name] || ICONS.catalog;
  return svg;
}

/** A book cover (real image, title card, or the initials on the binding colour while none exists). */
export function cover(b, api, cls = '') {
  const wrap = h('span.term-cov' + (cls ? '.' + cls.split(/\s+/).filter(Boolean).join('.') : ''));
  const fallback = () => {
    const words = String(b?.title || '?').split(/\s+/).filter((w) => /\p{L}/u.test(w)).slice(0, 2);
    wrap.classList.add('ph');
    wrap.style.background = b?.coverColor || 'var(--accent)';
    wrap.textContent = words.map((w) => w.match(/\p{L}/u)[0]).join('').toUpperCase() || '?';
  };
  const url = b ? coverSrc(b, api) : null;
  if (url) wrap.appendChild(h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async', draggable: false, dataset: { coverId: b.id }, onerror: (e) => { e.target.remove(); fallback(); } }));
  else fallback();
  return wrap;
}

/** A thin progress bar with the percentage next to it. */
export function progress(frac, { label = true, cls = '' } = {}) {
  const f = Math.max(0, Math.min(1, +frac || 0));
  return h('span.term-prog' + (cls ? '.' + cls : ''), h('span.term-prog-bar', h('i', { style: { width: (f * 100).toFixed(1) + '%' } })), label ? h('span.term-prog-val', Math.round(f * 100) + ' %') : null);
}

/** Horizontal meter as a DOM element (replaces the old ASCII [████░░░░] bar). */
export function meter(frac, opts = {}) {
  const f = Math.max(0, Math.min(1, +frac || 0));
  return h('span.term-meter' + (opts.cls ? '.' + opts.cls : ''), { style: opts.width ? { width: opts.width } : null },
    h('i', { style: { width: (f * 100).toFixed(1) + '%' } }));
}
/** Kept for callers that really want a text bar (fixed-width contexts). */
export function bar(frac, width = 16) {
  const f = Math.max(0, Math.min(1, +frac || 0));
  const n = Math.round(f * width);
  return '█'.repeat(n) + '░'.repeat(width - n);
}
export function pct(frac) { return Math.round((+frac || 0) * 100) + '%'; }
export function pad(s, n, right = false) { s = String(s ?? ''); if (s.length >= n) return s.slice(0, n); return right ? ' '.repeat(n - s.length) + s : s + ' '.repeat(n - s.length); }
export function fmtTime(sec) { sec = Math.round(sec || 0); const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60); return hh ? `${hh} h ${mm} min` : `${mm} min`; }
export function fmtDate(ts, lang = 'de') { if (!ts) return '—'; const d = new Date(ts); return d.toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
export function fmtDateTime(ts, lang = 'de') { if (!ts) return '—'; const d = new Date(ts); return fmtDate(ts, lang) + ' ' + d.toLocaleTimeString(lang === 'de' ? 'de-DE' : 'en-GB', { hour: '2-digit', minute: '2-digit' }); }
export function clock() { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
export const isEditable = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
export function formatLabel(f) { return String(f || '').toUpperCase(); }

/** Direct-select shortcuts for menus: 1-9 then a-z, so a menu never runs out of keys. */
export const SHORTCUT_KEYS = '123456789abcdefghijklmnopqrstuvwxyz';
export function shortcutLabel(i) { return i >= 0 && i < SHORTCUT_KEYS.length ? SHORTCUT_KEYS[i].toUpperCase() : '·'; }
/** -1 when the key is not a shortcut. Modifier presses never count. */
export function shortcutIndex(e) {
  if (!e || e.ctrlKey || e.metaKey || e.altKey) return -1;
  if (typeof e.key !== 'string' || e.key.length !== 1) return -1;
  return SHORTCUT_KEYS.indexOf(e.key.toLowerCase());
}
/** "1-6" / "1-9, A-C" – generated from the real list length so hints can never drift. */
export function shortcutRange(n) {
  if (n <= 0) return '';
  if (n === 1) return '1';
  if (n <= 9) return '1-' + n;
  const last = shortcutLabel(Math.min(n, SHORTCUT_KEYS.length) - 1);
  return n <= 10 ? '1-9, A' : '1-9, A-' + last;
}

/** localStorage best scores: best('2048') → number|null, best('2048', 4096) stores when better */
const KEY = 'lesesaal.term.';
export function store(key, value) {
  try { if (value === undefined) { const v = localStorage.getItem(KEY + key); return v == null ? null : JSON.parse(v); } localStorage.setItem(KEY + key, JSON.stringify(value)); } catch { return null; }
  return value;
}
export function makeBest(game) {
  return {
    get: (variant = '') => store(`best.${game}${variant ? '.' + variant : ''}`),
    /** higher=true → keep the maximum, else the minimum (times) */
    set: (value, variant = '', higher = true) => {
      const k = `best.${game}${variant ? '.' + variant : ''}`; const old = store(k);
      if (old == null || (higher ? value > old : value < old)) { store(k, value); return true; }
      return false;
    },
  };
}

/** Sound helper with throttled typing sound. */
export function makeSfx(ctx) {
  let lastType = 0;
  const play = (name) => { try { ctx.audio?.sfx?.(name); } catch { /* ignore */ } };
  return {
    type() { const now = performance.now(); if (now - lastType > 70) { lastType = now; play('type'); } },
    click() { play('click'); }, error() { play('error'); }, move() { play('chess-move'); }, open() { play('open'); }, page() { play('page'); },
  };
}

// While the keyboard is in use, a resting mouse must not move the selection: Chromium sends mouseenter to the row
// that appears under a still pointer after every re-render. Only a real movement counts again.
let lastKeyAt = 0, lastMoveAt = 0;
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', () => { lastKeyAt = performance.now(); }, true);
  document.addEventListener('mousemove', (e) => { if (e.movementX || e.movementY) lastMoveAt = performance.now(); }, true);
}
const pointerIsResting = () => lastKeyAt > lastMoveAt;

/**
 * Keyboard navigable list. rows = HTMLElements (already in the DOM). Returns controller.
 * opts: { onEnter(row, i), horizontal, onChange(i), wrap }
 */
export function keyList(rows, opts = {}) {
  let idx = -1;
  const api = {
    rows,
    get index() { return idx; },
    get current() { return rows[idx] || null; },
    set(i, scroll = true) {
      if (!rows.length) { idx = -1; return; }
      i = Math.max(0, Math.min(rows.length - 1, i));
      if (idx >= 0 && rows[idx]) rows[idx].classList.remove('term-sel');
      idx = i; rows[idx].classList.add('term-sel');
      if (scroll) rows[idx].scrollIntoView?.({ block: 'nearest' });
      opts.onChange?.(idx, rows[idx]);
    },
    move(d) { if (!rows.length) return; let n = idx + d; if (opts.wrap) n = (n + rows.length) % rows.length; api.set(n); },
    clearSel() { if (idx >= 0 && rows[idx]) rows[idx].classList.remove('term-sel'); idx = -1; },
    onKey(e) {
      if (!rows.length) return false;
      if (opts.spatial && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key];
        if (dir) { spatialMove(dir); return true; }
      }
      const prev = opts.horizontal ? 'ArrowLeft' : 'ArrowUp', next = opts.horizontal ? 'ArrowRight' : 'ArrowDown';
      if (e.key === prev) { api.move(-1); return true; }
      if (e.key === next) { api.move(1); return true; }
      if (e.key === 'Home') { api.set(0); return true; }
      if (e.key === 'End') { api.set(rows.length - 1); return true; }
      if (e.key === 'PageDown') { api.set(idx + 10); return true; }
      if (e.key === 'PageUp') { api.set(idx - 10); return true; }
      if (e.key === 'Enter' || e.key === ' ') { if (idx < 0) api.set(0); else opts.onEnter?.(rows[idx], idx, e); return true; }
      return false;
    },
  };
  /** Cards in a grid: the arrow keys go to the nearest card in that direction (rows of different widths too). */
  function spatialMove(dir) {
    if (idx < 0) { api.set(0); return; }
    const r0 = rows[idx].getBoundingClientRect();
    const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    let best = -1, bestScore = Infinity;
    rows.forEach((r, i) => {
      if (i === idx || !r.isConnected || r.offsetParent === null) return;
      const b = r.getBoundingClientRect();
      const dx = b.left + b.width / 2 - cx, dy = b.top + b.height / 2 - cy;
      let primary, secondary;
      if (dir === 'up') { if (b.bottom > r0.top + 4) return; primary = -dy; secondary = Math.abs(dx); }
      else if (dir === 'down') { if (b.top < r0.bottom - 4) return; primary = dy; secondary = Math.abs(dx); }
      else if (dir === 'left') { if (b.right > r0.left + 4 || b.bottom < r0.top || b.top > r0.bottom) return; primary = -dx; secondary = Math.abs(dy); }
      else { if (b.left < r0.right - 4 || b.bottom < r0.top || b.top > r0.bottom) return; primary = dx; secondary = Math.abs(dy); }
      const score = primary + secondary * 1.6;
      if (score < bestScore) { bestScore = score; best = i; }
    });
    if (best >= 0) api.set(best);
  }
  rows.forEach((r, i) => {
    r.classList.add('term-row');
    r.addEventListener('mouseenter', () => { if (!pointerIsResting()) api.set(i, false); });
    r.addEventListener('click', (e) => { api.set(i, false); opts.onEnter?.(r, i, e); });
  });
  return api;
}

/** A real button. tabindex -1 on purpose: the panel drives focus through its lists, not the tab ring. */
export function btn(label, onclick, cls = '') {
  return h('button.term-btn' + (cls ? '.' + cls.split(/[\s.]+/).filter(Boolean).join('.') : ''),
    { type: 'button', tabindex: -1, onclick: (e) => { e.stopPropagation(); onclick?.(e); } }, label);
}
export function key(k) { return h('kbd.term-key', k); }
export function line(...c) { return h('div.term-line', ...c); }
export function hr() { return h('div.term-hr'); }
export function heading(text, ...rest) { return h('h3.term-h', text, ...rest); }
export function dim(text) { return h('span.term-dim', text); }
export function bright(text) { return h('span.term-bright', text); }
export function hint(list) {
  // list: [[key, label], ...]
  return h('span.term-hints', list.map(([k, l]) => h('span.term-hint', key(k), ' ', l)));
}

/** Panel-style card with an optional heading. */
export function card(title, ...children) {
  return h('section.term-card', title ? h('h3.term-card-h', title) : null, ...children);
}
/** Small labelled figure for dashboards. */
export function stat(label, value, sub) {
  return h('div.term-stat', h('div.term-stat-v', value), h('div.term-stat-l', label), sub ? h('div.term-stat-s', sub) : null);
}

/** Segmented control: options = [[value, label], …]. Returns { el, set(v), get() }. */
export function segmented(options, value, onchange) {
  const btns = options.map(([v, l]) => h('button.term-seg-btn', { type: 'button', tabindex: -1, dataset: { v: String(v) }, onclick: () => set(v, true) }, l));
  const el = h('div.term-seg', btns);
  let cur = value;
  function paint() { btns.forEach((b) => b.classList.toggle('on', b.dataset.v === String(cur))); }
  function set(v, fire) { cur = v; paint(); if (fire) onchange?.(v); }
  paint();
  return { el, set: (v) => set(v, false), get: () => cur, cycle: (d) => { const i = options.findIndex(([v]) => String(v) === String(cur)); set(options[(i + d + options.length) % options.length][0], true); } };
}

export function input(props = {}) {
  return h('input.term-input', { type: 'text', spellcheck: false, autocomplete: 'off', ...props });
}
export function select(options, value, onchange) {
  const el = h('select.term-select', { onchange: (e) => onchange?.(e.target.value) }, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  return el;
}

/** Message box (info / error). */
export function notice(text, cls = '') { return h('div.term-notice' + (cls ? '.' + cls : ''), text); }

export function bookLabel(b) { return b ? `${b.title || '?'}${b.author ? ' — ' + b.author : ''}` : '?'; }
export const T = (de, en, vars) => tr({ de, en }, vars);
/** A count with the right noun: Tn(n, ['1 Buch', '1 book'], ['{n} Bücher', '{n} books']) (extra vars allowed). */
export const Tn = (n, one, many, vars = {}) => (n === 1 ? T(one[0], one[1], { n, ...vars }) : T(many[0], many[1], { n, ...vars }));
export { clear };
