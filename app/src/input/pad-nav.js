// Spatial focus for the gamepad in the panels: a visible ring moves between the buttons, fields, cards and tabs of the
// open panel. A direction goes to the nearest thing that lies that way, the ones in the same row (or column) first.
// A presses what the ring rests on; a slider and a choice list change with left and right; a text field opens the
// keyboard on the screen (input/pad-osk.js). A list that scrolls follows the ring, the right stick scrolls by hand.
// Panels may name "stages" (input/pad-panels.js): a film, the page of a book, the map. While the ring rests on a stage,
// the stage's own buttons act (play and pause, seek, turn the page), and down leads into the controls it holds.
// Only the panel on top is searched, and only when the pad moves: nothing here runs per frame but the ring's position.

const NATIVE = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY']);
const ROLES = new Set(['button', 'tab', 'switch', 'link', 'option', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'checkbox', 'radio']);
// clickable without a role or a tab stop of their own (shared classes of ui.css and a few panels)
const CLICKABLE = ['.tab', '.list-item', '.toggle', '.news-feed', '.news-cat', '.wiki-card', '.wiki-toc-item', '.pod-show',
  '.term-memory-card', '.chess-move', '.rd-toggle-row', '.br-row', '.rd-sb-item', '.chess-pos', '.rd-toc-row', '.rd-toc-item'].join(',');
const QUERY = `button, a, input:not([type="hidden"]), select, textarea, summary, [role], [tabindex], [contenteditable="true"], ${CLICKABLE}`;
// buttons a panel should not start on: close, back and forward in the header
const NOT_FIRST = '.panel-header .btn.icon, [aria-label="Schließen"], [aria-label="Close"], .mt-close, .wm-close, .term-close, .rd-btn-close, .nav-back, .nav-forward, .nav-btn, .wm-nav-back, .wm-nav-fwd, .rd-btn-nav';
const TEXT_TYPES = new Set(['text', 'search', 'url', 'email', 'password', 'number', 'tel', '']);

export const isTextField = (el) => !!el && ((el.tagName === 'INPUT' && TEXT_TYPES.has(String(el.getAttribute('type') || '').toLowerCase())) || el.tagName === 'TEXTAREA' || el.isContentEditable);

/** Is `el` something the ring may rest on (interactive, enabled, visible)? */
function interactive(el) {
  if (NATIVE.has(el.tagName)) return !(el.disabled || el.type === 'hidden');
  if (el.tagName === 'A') return el.hasAttribute('href') || el.matches(CLICKABLE);
  if (el.matches(CLICKABLE)) return true;
  const tab = el.getAttribute('tabindex');
  const role = el.getAttribute('role');
  if (role && ROLES.has(role)) return tab !== '-1';
  if (el.isContentEditable && el.getAttribute('contenteditable') === 'true') return true;
  return tab != null && tab !== '-1';
}
function visible(el, r) {
  if (r.width < 2 || r.height < 2) return false;
  if (el.getAttribute('aria-disabled') === 'true' || el.closest('[inert], [aria-hidden="true"]')) return false;
  try { return el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true; } catch { return true; }
}
/** The ancestors that scroll (up to `root`), innermost first. */
function scrollers(el, root) {
  const out = [];
  for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    const cs = getComputedStyle(n);
    const y = /(auto|scroll|overlay)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1;
    const x = /(auto|scroll|overlay)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1;
    if (x || y) out.push({ n, x, y });
    if (n === root) break;
  }
  return out;
}
const centre = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

export class PadNav {
  constructor() {
    this.root = null; this.el = null; this.stage = null; this.adapter = null;
    this.memory = new WeakMap();      // root → the element the ring rested on (back to it when a panel above closes)
    this.last = null;                 // { x, y, sig } of the element, to find it again after the panel drew itself anew
    this.ring = document.createElement('div');
    this.ring.id = 'pad-ring';
    this.ring.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.ring);
    this.shown = false;
    this.scrollAcc = { x: 0, y: 0 };
  }

  /** The area the ring moves in (a panel layer, the HUD's mini player, the film in full screen). */
  setRoot(root, adapter = null) {
    if (root === this.root && adapter === this.adapter) return;
    if (this.root && this.el) this.memory.set(this.root, this.el);
    this.root = root; this.adapter = adapter; this.el = null; this.stage = null; this.last = null;
    if (!root) { this.hide(); return; }
    const back = this.memory.get(root);
    if (back?.isConnected && root.contains(back)) this.focus(back, { reveal: false });
  }
  clear() { if (this.root && this.el) this.memory.set(this.root, this.el); this.root = null; this.el = null; this.stage = null; this.hide(); }

  /** Stages the adapter names for the current root: [{ el, ring, entry, onA, onDir }]. */
  stages() { try { return (this.adapter?.stages?.(this.root) || []).filter((s) => s?.el?.isConnected); } catch (e) { console.warn('[pad] stages', e); return []; } }

  /** Everything the ring may rest on in the root, with its rectangle. */
  candidates() {
    const root = this.root; if (!root) return [];
    const rr = root.getBoundingClientRect();
    const area = Math.max(1, rr.width * rr.height);
    const out = [];
    const stages = this.stages();
    for (const s of stages) { const r = s.el.getBoundingClientRect(); if (r.width > 2 && r.height > 2) out.push({ el: s.el, r, stage: s }); }
    const skip = this.adapter?.skip;
    for (const el of root.querySelectorAll(QUERY)) {
      if (!interactive(el)) continue;
      if (skip && el.matches(skip)) continue;
      const r = el.getBoundingClientRect();
      // a big container with a tab stop of its own (a terminal's screen): its parts are the targets
      if (r.width * r.height > area * 0.45) continue;
      if (!visible(el, r)) continue;
      // out of sight and nothing that could scroll it in
      const away = r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth;
      if (away && !scrollers(el, root).length) continue;
      out.push({ el, r, stage: null });
    }
    return out;
  }

  /** The stage descriptor of an element, if it is one. */
  stageOf(el) { return el ? this.stages().find((s) => s.el === el) || null : null; }

  /** Put the ring on `el` (and the browser's focus, for a button: Enter on a keyboard then presses it too). */
  focus(el, { reveal = true } = {}) {
    if (!el) return false;
    const changed = el !== this.el;
    this.el = el;
    this.stage = this.stageOf(el);
    if (reveal) revealIn(el, this.root);
    const r = el.getBoundingClientRect();
    this.last = { ...centre(r), sig: signature(el) };
    // real focus for buttons and the like (no text field: that waits for A, and no stage)
    if (!this.stage && !isTextField(el) && el !== document.activeElement && (NATIVE.has(el.tagName) || el.hasAttribute('tabindex'))) {
      try { el.focus({ preventScroll: true }); } catch {}
    }
    if (changed) { try { this.adapter?.onFocus?.(el, this.stage, this); } catch (e) { console.warn('[pad] onFocus', e); } }
    this.draw(changed && !this.shown);
    return true;
  }

  /** Where the ring starts in a root: what the adapter wants, the remembered element, else the first thing in
   *  reading order (a primary button first; never the close button in the header). */
  ensure() {
    if (!this.root) return null;
    if (this.el && this.el.isConnected && this.root.contains(this.el)) return this.el;
    // the panel drew itself anew: the same control again, else the one nearest to where the ring was
    const cands = this.candidates();
    if (this.el && this.last) {
      const same = cands.find((c) => signature(c.el) === this.last.sig);
      if (same) { this.focus(same.el, { reveal: false }); return this.el; }
      let best = null, bd = Infinity;
      for (const c of cands) { const p = centre(c.r), d = (p.x - this.last.x) ** 2 + (p.y - this.last.y) ** 2; if (d < bd) { bd = d; best = c; } }
      if (best) { this.focus(best.el, { reveal: false }); return this.el; }
    }
    let first = null;
    try { first = this.adapter?.initial?.(this.root, cands, this) || null; } catch (e) { console.warn('[pad] initial', e); }
    if (!first) {
      const order = cands.filter((c) => !c.el.matches(NOT_FIRST)).sort((a, b) => (Math.abs(a.r.top - b.r.top) > 6 ? a.r.top - b.r.top : a.r.left - b.r.left));
      const inView = order.filter((c) => c.r.top >= 0 && c.r.bottom <= innerHeight);
      first = (inView.find((c) => c.el.matches('.primary, [aria-selected="true"].active')) || inView[0] || order[0] || cands[0])?.el || null;
    }
    if (first) this.focus(first, { reveal: false });
    return this.el;
  }

  /** One step in a direction: the stage or a slider may take it first. True when something happened. */
  move(dir) {
    const cur = this.ensure();
    if (!cur) return false;
    if (this.stage?.onDir?.(dir)) { this.draw(); return true; }
    if (adjust(cur, dir)) { this.draw(); return true; }
    const sc = scrollers(cur, this.root)[0];
    // the ring went out of sight (the list was scrolled by hand): the first thing in view that way, else on through
    // the list, else back to the ring
    if (sc && outOfView(cur, sc.n)) {
      const nr = sc.n.getBoundingClientRect();
      const inView = this.candidates().filter((c) => sc.n.contains(c.el) && c.r.top >= nr.top && c.r.bottom <= nr.bottom && c.r.left >= nr.left - 1 && c.r.right <= nr.right + 1).sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
      const pick = dir === 'up' || dir === 'left' ? inView[inView.length - 1] : inView[0];
      if (pick) { this.focus(pick.el); return true; }
      if (canScroll(sc.n, dir)) { scrollOn(sc.n, dir); this.draw(); return true; }
      revealIn(cur, this.root); this.draw();
      return true;
    }
    const next = this.find(dir, cur);
    // the list goes on (things that cannot be chosen, a picture, a text): show them before the ring leaves the list
    if (next && sc && !sc.n.contains(next) && canScroll(sc.n, dir)) { scrollOn(sc.n, dir); this.draw(); return true; }
    if (next) { this.focus(next); return true; }
    // nothing more that way: scroll the list on (it may draw more), then stop
    if (sc && canScroll(sc.n, dir)) { scrollOn(sc.n, dir); this.draw(); return true; }
    return false;
  }

  /** The nearest candidate from `cur` in direction `dir` (the same row or column first), or null. */
  find(dir, cur = this.el) {
    const cands = this.candidates();
    const from = cur.getBoundingClientRect();
    const stage = this.stage;
    // down from a stage: into the controls it holds (its entry first)
    if (stage && dir === 'down') {
      const inner = cands.filter((c) => c.el !== cur && stage.el.contains(c.el));
      if (inner.length) {
        const entry = stage.entry ? inner.find((c) => c.el.matches(stage.entry)) : null;
        return (entry || inner.sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left)[0]).el;
      }
    }
    const holder = this.stages().find((s) => s.el !== cur && s.el.contains(cur));
    const pool = cands.filter((c) => c.el !== cur && !(c.el.contains(cur) && !c.stage) && !(cur.contains(c.el) && !stage));
    const pick = bestIn(pool, from, dir);
    // up out of the controls of a stage: the stage itself, when nothing else of it lies above
    if (holder && dir === 'up' && (!pick || !holder.el.contains(pick))) return holder.el;
    return pick;
  }

  /** A presses what the ring rests on. Returns 'text' for a text field (the caller opens the keyboard). */
  activate() {
    const el = this.ensure(); if (!el) return false;
    if (this.stage) return this.stage.onA ? (this.stage.onA() !== false) : false;
    if (isTextField(el)) return 'text';
    if (el.tagName === 'SELECT') { cycleSelect(el, 1); return true; }
    if (el.tagName === 'INPUT' && el.type === 'range') return false;
    const role = el.getAttribute('role');
    // a choice in a list of results reacts to the press itself (the world map's search)
    if (role === 'option' && !el.closest('[role="menu"]')) {
      const r = el.getBoundingClientRect(), o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
      el.dispatchEvent(new MouseEvent('mousedown', o));
      if (el.isConnected) { el.dispatchEvent(new MouseEvent('mouseup', o)); el.click(); }
      return true;
    }
    try { el.focus({ preventScroll: true }); } catch {}
    el.click();
    return true;
  }

  /** The right stick: scroll what holds the ring (or the biggest list of the root), `vx`/`vy` in px per second. */
  scroll(vx, vy, dt) {
    if (!this.root) return false;
    this.scrollAcc.x += vx * dt; this.scrollAcc.y += vy * dt;
    const dx = Math.trunc(this.scrollAcc.x), dy = Math.trunc(this.scrollAcc.y);
    if (!dx && !dy) return false;
    this.scrollAcc.x -= dx; this.scrollAcc.y -= dy;
    let target = null;
    if (this.el?.isConnected) target = scrollers(this.el, this.root).find((s) => (dy ? s.y : s.x)) || null;
    if (!target) target = biggestScroller(this.root, !!dy);
    if (!target) return false;
    target.n.scrollBy({ left: dx, top: dy, behavior: 'instant' });
    this.draw();
    return true;
  }

  /** Place the ring on the element (every frame of the poll loop: lists scroll, cards animate). */
  draw(jump = false) {
    const ring = this.ring, el = this.el;
    const stage = this.stage;
    const show = !!el && el.isConnected && document.documentElement.dataset.input === 'pad' && !(stage && stage.ring === 'none');
    if (!show) { this.hide(); return; }
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) { this.hide(); return; }
    const inset = stage?.ring === 'inset';
    const pad = inset ? -3 : 4;
    const x = Math.round(r.left - pad), y = Math.round(r.top - pad), w = Math.round(r.width + pad * 2), h = Math.round(r.height + pad * 2);
    const key = `${x},${y},${w},${h},${inset}`;
    if (key === this.drawn && this.shown) return;
    this.drawn = key;
    if (jump || !this.shown) ring.classList.add('jump'); else ring.classList.remove('jump');
    ring.style.transform = `translate(${x}px, ${y}px)`;
    ring.style.width = w + 'px'; ring.style.height = h + 'px';
    if (el !== this.radiusOf) { this.radiusOf = el; const br = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0; ring.style.borderRadius = Math.min(Math.max(0, br + (inset ? 0 : 4)), Math.min(w, h) / 2) + 'px'; }
    ring.classList.toggle('inset', inset);
    if (!this.shown) { this.shown = true; ring.classList.add('show'); }
    if (jump) requestAnimationFrame(() => ring.classList.remove('jump'));
  }
  hide() { if (this.shown || this.ring.classList.contains('show')) { this.shown = false; this.drawn = null; this.ring.classList.remove('show'); } }
  destroy() { this.ring.remove(); }
}

/** A short description of a control that survives a fresh drawing of its panel. */
function signature(el) {
  const ds = el.dataset ? Object.entries(el.dataset).map(([k, v]) => k + '=' + v).join('&') : '';
  return [el.tagName, el.getAttribute('role') || '', el.getAttribute('aria-label') || '', ds, (el.textContent || '').trim().slice(0, 40), el.className && typeof el.className === 'string' ? el.className.replace(/\b(active|on|term-sel|focus\S*)\b/g, '').trim() : ''].join('|');
}

/** The best of `pool` from rectangle `from` in direction `dir`: first among the things wholly beyond the edge, only
 *  then among those whose middle lies that way (overlapping layouts). The nearest wins; a sideways offset counts
 *  two and a half times, so the next thing in the same row or column comes first unless another is much nearer. */
function bestIn(pool, from, dir) { return pickIn(pool, from, dir, true) || pickIn(pool, from, dir, false); }
function pickIn(pool, from, dir, strict) {
  const c0 = centre(from);
  const horizontal = dir === 'left' || dir === 'right';
  let best = null, bs = Infinity;
  for (const c of pool) {
    const r = c.r, p = centre(r);
    const tol = Math.min(8, (horizontal ? Math.min(from.width, r.width) : Math.min(from.height, r.height)) * 0.3);
    let gap, overlap, cross;
    if (dir === 'right') { if (strict ? r.left < from.right - tol : (p.x <= c0.x + 1 || r.right <= from.right + 1)) continue; gap = Math.max(0, r.left - from.right); overlap = Math.min(from.bottom, r.bottom) - Math.max(from.top, r.top); cross = Math.abs(p.y - c0.y); }
    else if (dir === 'left') { if (strict ? r.right > from.left + tol : (p.x >= c0.x - 1 || r.left >= from.left - 1)) continue; gap = Math.max(0, from.left - r.right); overlap = Math.min(from.bottom, r.bottom) - Math.max(from.top, r.top); cross = Math.abs(p.y - c0.y); }
    else if (dir === 'down') { if (strict ? r.top < from.bottom - tol : (p.y <= c0.y + 1 || r.bottom <= from.bottom + 1)) continue; gap = Math.max(0, r.top - from.bottom); overlap = Math.min(from.right, r.right) - Math.max(from.left, r.left); cross = Math.abs(p.x - c0.x); }
    else { if (strict ? r.bottom > from.top + tol : (p.y >= c0.y - 1 || r.top >= from.top - 1)) continue; gap = Math.max(0, from.top - r.bottom); overlap = Math.min(from.right, r.right) - Math.max(from.left, r.left); cross = Math.abs(p.x - c0.x); }
    const crossGap = overlap > 0 ? 0 : -overlap;
    const s = gap + crossGap * 2.5 + cross * 0.15;
    if (s < bs) { bs = s; best = c.el; }
  }
  return best;
}

/** Left and right change a slider and a choice list: true when they did. */
function adjust(el, dir) {
  if (el.tagName === 'INPUT' && el.type === 'range') {
    if (dir !== 'left' && dir !== 'right') return false;
    const min = parseFloat(el.min || '0'), max = parseFloat(el.max || '100');
    const step = parseFloat(el.step) || 1;
    // at least a 40th of the way: a reading position slider has steps of 0.0001
    const by = Math.max(step, (max - min) / 40);
    const v = Math.min(max, Math.max(min, (parseFloat(el.value) || 0) + (dir === 'right' ? by : -by)));
    const snapped = Math.round((v - min) / step) * step + min;
    el.value = String(+snapped.toFixed(6));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (el.tagName === 'SELECT' && (dir === 'left' || dir === 'right')) { cycleSelect(el, dir === 'right' ? 1 : -1); return true; }
  return false;
}
function cycleSelect(el, d) {
  const n = el.options.length; if (!n) return;
  const i = Math.max(0, Math.min(n - 1, el.selectedIndex + d));
  if (i === el.selectedIndex) return;
  el.selectedIndex = i;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Scroll the lists that hold `el` until it is in view (never the page itself: the 3D view must not move). */
export function revealIn(el, root) {
  const m = 20;
  for (const s of scrollers(el, root)) {
    const er = el.getBoundingClientRect(), nr = s.n.getBoundingClientRect();
    let dx = 0, dy = 0;
    if (s.y) { if (er.top < nr.top + m) dy = er.top - nr.top - m; else if (er.bottom > nr.bottom - m) dy = Math.min(er.bottom - nr.bottom + m, er.top - nr.top - m); }
    if (s.x) { if (er.left < nr.left + m) dx = er.left - nr.left - m; else if (er.right > nr.right - m) dx = Math.min(er.right - nr.right + m, er.left - nr.left - m); }
    if (dx || dy) s.n.scrollBy({ left: dx, top: dy, behavior: 'instant' });
  }
}
/** True when the element lies wholly outside the visible part of the list `n`. */
function outOfView(el, n) {
  const r = el.getBoundingClientRect(), nr = n.getBoundingClientRect();
  return r.bottom < nr.top || r.top > nr.bottom || r.right < nr.left || r.left > nr.right;
}
/** Can the list `n` scroll further in direction `dir`? */
function canScroll(n, dir) {
  if (dir === 'down') return n.scrollTop + n.clientHeight < n.scrollHeight - 1;
  if (dir === 'up') return n.scrollTop > 0;
  if (dir === 'right') return n.scrollLeft + n.clientWidth < n.scrollWidth - 1;
  return n.scrollLeft > 0;
}
/** Scroll the list a good part of its height (or width) on. */
function scrollOn(n, dir) {
  const k = dir === 'up' || dir === 'left' ? -1 : 1;
  if (dir === 'up' || dir === 'down') n.scrollBy({ top: k * Math.round(n.clientHeight * 0.45), behavior: 'instant' });
  else n.scrollBy({ left: k * Math.round(n.clientWidth * 0.45), behavior: 'instant' });
}
/** The largest list of `root` that scrolls in the wanted direction. */
function biggestScroller(root, vertical) {
  let best = null, ba = 0;
  for (const n of root.querySelectorAll('*')) {
    if (vertical ? n.scrollHeight <= n.clientHeight + 1 : n.scrollWidth <= n.clientWidth + 1) continue;
    const cs = getComputedStyle(n);
    if (!/(auto|scroll|overlay)/.test(vertical ? cs.overflowY : cs.overflowX)) continue;
    const r = n.getBoundingClientRect(), a = r.width * r.height;
    if (a > ba) { ba = a; best = { n, x: !vertical, y: vertical }; }
  }
  return best;
}
