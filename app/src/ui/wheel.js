// Radial category menu ("Abteilungs-Rad"): hold Tab, sweep the mouse, release to walk to a department of the
// book room (a library too big for its walls shows one department at a time: then the room switches to it).
// The weapon-wheel idea from video games. It works while the pointer is locked (raw mouse deltas) and with a
// free cursor, and it stays legible with a dozen departments and more (hyphenation, smaller type).
// Since 0.7.2 the wheel has two rings: the departments and the places of the house and the garden, the same list
// as the places tab of the menu (G). The centre disc is a target of its own: the cursor coming back into it swaps
// the rings (so do Q and, on the pad, LB or RB), and a place picked teleports as the places tab does (onTeleport).
import { h, $, clear } from '../core/dom.js';
import { t, i18n, tr } from '../core/i18n.js';
import { hintText, padState, glyph } from '../input/pad-hints.js';

const R_OUT = 230, R_IN = 96, CENTER = 260;   // SVG units
// The centre disc as a target: the cursor is in the centre below CENTRE_IN and out in the ring from CENTRE_OUT on (a
// little hysteresis against jitter at the rim of the disc). The virtual cursor of the locked pointer counts raw mouse
// pixels as SVG units, the free cursor is scaled to them: both meet the drawn disc.
const CENTRE_IN = R_IN - 12, CENTRE_OUT = R_IN;
const DENSE = 13;                              // from this many sectors the labels sit further out (the places ring)
const RING_KEY = 'KeyQ';                       // swaps the rings while the wheel is open (next to Tab)
// the mark of the centre pill: a dot in a ring
const RINGS_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="2.5" fill="currentColor"/></svg>';

export class CategoryWheel {
  /**
   * @param root  a DOM element inside #hud
   * @param ctx   { state, api, audio, world } – world needs setDepartment()/department and places()
   * @param opts  { onPick(name), onTeleport(placeId) }
   */
  constructor(root, ctx, opts = {}) {
    this.ctx = ctx; this.opts = opts;
    this.open = false;
    this.items = [];
    this.index = -1;
    this.cursor = { x: 0, y: 0 };
    this.ring = 'deps';            // 'deps' | 'places': the ring shown
    this.inCentre = true;          // the cursor rests in the centre disc (it starts there)
    this.el = h('div#wheel.hidden', { 'aria-hidden': 'true' });
    root.appendChild(this.el);
    this._onMove = (e) => this.#onMouseMove(e);
    this._onWheel = (e) => { if (!this.open) return; e.preventDefault(); this.#step(e.deltaY > 0 ? 1 : -1); };
    this._onDown = (e) => { if (!this.open) return; e.preventDefault(); e.stopPropagation(); this.#commit(); };
  }

  destroy() { this.#unbind(); this.el.remove(); }

  #bind() {
    document.addEventListener('mousemove', this._onMove, true);
    document.addEventListener('wheel', this._onWheel, { passive: false, capture: true });
    document.addEventListener('mousedown', this._onDown, true);
  }
  #unbind() {
    document.removeEventListener('mousemove', this._onMove, true);
    document.removeEventListener('wheel', this._onWheel, true);
    document.removeEventListener('mousedown', this._onDown, true);
  }

  /** Departments with books, in the library's own (stable) order, plus the "recently read" shelf. */
  #collect() {
    const deps = (this.ctx.state.library?.departments || []).filter((d) => d.count > 0);
    const items = deps.map((d) => ({ kind: 'dep', name: d.name, count: d.count, label: d.name }));
    items.push({ kind: 'recent', name: null, count: this.ctx.recentCount?.() ?? 0, label: tr({ de: 'Zuletzt gelesen', en: 'Recently read' }) });
    // the case "Gelesen" next to it, when it stands (ui/shelves.js readShelf)
    const read = this.ctx.world?.readShelf?.();
    if (read) items.push({ kind: 'finished', name: null, count: read.count, label: tr({ de: 'Gelesen', en: 'Read' }) });
    return items;
  }
  /** The places of the house and the garden, group by group as the places tab of the menu lists them (ui/menu.js). */
  #collectPlaces() {
    const places = this.ctx.world?.places?.() || [];
    const groups = [['hall', t('places.hall')], ['entrance', t('places.entrance')], ['rooms', t('places.rooms')], ['garden', tr({ de: 'Garten', en: 'Garden' })]];
    const item = (p, group) => ({ kind: 'place', id: p.id, label: placeLabel(p), group });
    const items = [];
    for (const [g, label] of groups) for (const p of places) if (p.group === g) items.push(item(p, label));
    for (const p of places) if (!groups.some(([g]) => g === p.group)) items.push(item(p, t('menu.places')));
    return items;
  }
  #itemsOf(ring) { return ring === 'places' ? this.#collectPlaces() : this.#collect(); }

  toggle(fromKey) { if (this.open) this.close(true); else this.show(fromKey); }

  show(fromKey = false) {
    if (this.open) return;
    this.ring = 'deps';
    this.items = this.#collect();
    if (!this.items.length) return;
    this.open = true; this.fromKey = fromKey; this.openedAt = performance.now(); this.moved = false;
    this.cursor = { x: 0, y: 0 }; this.inCentre = true;
    const cur = this.ctx.state.department;
    this.index = Math.max(0, this.items.findIndex((i) => i.kind === 'dep' && i.name === cur));
    this.#render();
    this.el.classList.remove('hidden');
    this.el.setAttribute('aria-hidden', 'false');
    this.#bind();
    this.opts.onToggle?.(true);     // the player must not walk or turn while choosing
    this.ctx.audio?.sfx?.('open');
  }

  /** @param cancel true = close without switching */
  close(cancel = false) {
    if (!this.open) return;
    this.open = false;
    this.#unbind();
    this.el.classList.add('hidden');
    this.el.setAttribute('aria-hidden', 'true');
    this.opts.onToggle?.(false);
    if (!cancel) this.#apply();
  }

  /** Tab released: a quick tap keeps the wheel open, a hold selects and closes. */
  release() {
    if (!this.open) return;
    if (performance.now() - this.openedAt < 260 && !this.moved) return;  // tap → stays open
    this.close(false);
  }

  /**
   * The other ring: the places while the departments are shown, the departments again from the places. The cursor
   * out in the ring picks the sector under it at once; in the centre nothing is highlighted until it moves out (or
   * the arrow keys step). Called from the centre disc (#pick), from Q (onKey) and from the pad (gamepad.js: LB, RB).
   */
  toggleRing() {
    if (!this.open) return false;
    const ring = this.ring === 'places' ? 'deps' : 'places';
    const items = this.#itemsOf(ring);
    if (!items.length) return false;
    this.ring = ring; this.items = items; this.index = -1; this.moved = true;
    this.#render();
    if (!this.inCentre) this.#pick();
    this.ctx.audio?.sfx?.('page', { volume: 0.4 });
    return true;
  }

  #commit() { this.close(false); }

  #apply() {
    const it = this.items[this.index];
    if (!it) return;
    this.ctx.audio?.sfx?.('click');
    if (it.kind === 'place') this.opts.onTeleport?.(it.id);   // as the places tab of the menu (main.js teleportTo)
    else if (it.kind === 'recent') this.opts.onTeleport?.('recent');
    else if (it.kind === 'finished') this.opts.onTeleport?.('finished');
    else this.opts.onPick?.(it.name);
  }

  #step(d) {
    if (!this.items.length) return;
    const n = this.items.length;
    // nothing highlighted (the rings were just swapped): the arrows start at the first or the last sector
    this.index = this.index < 0 ? (d > 0 ? 0 : n - 1) : (this.index + d + n) % n;
    this.moved = true;
    this.#highlight();
  }

  #onMouseMove(e) {
    if (!this.open) return;
    const locked = !!document.pointerLockElement;
    if (locked) { this.cursor.x += e.movementX; this.cursor.y += e.movementY; }
    else {
      // the free cursor in SVG units, so that the disc on the screen is the centre of the wheel
      const r = this.svg.getBoundingClientRect(), k = r.width / (CENTER * 2) || 1;
      this.cursor.x = (e.clientX - (r.left + r.width / 2)) / k;
      this.cursor.y = (e.clientY - (r.top + r.height / 2)) / k;
    }
    this.#pick();
  }

  /** A gamepad stick (input/gamepad.js) points at a sector: x to the right, y down, both -1 … 1. */
  point(x, y) {
    if (!this.open || Math.hypot(x, y) < 0.5) return;
    this.cursor = { x: x * 200, y: y * 200 };
    this.#pick();
  }

  /** The sector the virtual cursor points at; the centre disc, entered again, swaps the rings. */
  #pick() {
    const len = Math.hypot(this.cursor.x, this.cursor.y);
    const max = 260;
    if (len > max) { this.cursor.x *= max / len; this.cursor.y *= max / len; }
    if (this.inCentre) { if (len < CENTRE_OUT) return; this.inCentre = false; }
    else if (len < CENTRE_IN) { this.inCentre = true; this.toggleRing(); return; }
    this.moved = true;
    // -y is up; sector 0 starts at the top and runs clockwise
    let a = Math.atan2(this.cursor.x, -this.cursor.y);
    if (a < 0) a += Math.PI * 2;
    const n = this.items.length;
    const idx = Math.floor((a + Math.PI / n) / (Math.PI * 2 / n)) % n;
    if (idx !== this.index) { this.index = idx; this.ctx.audio?.sfx?.('page', { volume: 0.25 }); this.#highlight(); }
  }

  /** Keys handled while the wheel is open. Returns true when consumed. */
  onKey(e) {
    if (!this.open) return false;
    if (e.code === 'Escape') { this.close(true); return true; }
    if (e.code === 'Enter' || e.code === 'Space') { this.#commit(); return true; }
    if (e.code === RING_KEY) { if (!e.repeat) this.toggleRing(); return true; }
    if (e.code === 'ArrowRight' || e.code === 'ArrowDown' || e.code === 'KeyD' || e.code === 'KeyS') { this.#step(1); return true; }
    if (e.code === 'ArrowLeft' || e.code === 'ArrowUp' || e.code === 'KeyA' || e.code === 'KeyW') { this.#step(-1); return true; }
    const num = /^Digit([1-9])$/.exec(e.code);
    if (num) { const i = +num[1] - 1; if (i < this.items.length) { this.index = i; this.#commit(); } return true; }
    return true;   // swallow everything else so the player does not walk while choosing
  }

  // ------------------------------------------------------------------ rendering ----
  #render() {
    clear(this.el);
    this.el.dataset.ring = this.ring;
    // the label type of the current theme, read once per drawing
    labelFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim() || 'Georgia, serif';
    const n = this.items.length, dense = n >= DENSE;
    const step = 360 / n;
    // a crowded ring (the places): the labels sit further out, where the sectors are wider, with less margin
    const rr = R_IN + (R_OUT - R_IN) * (dense ? 0.6 : 0.5), margin = dense ? 10 : 16;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${CENTER * 2} ${CENTER * 2}`);
    svg.setAttribute('class', 'wheel-svg');
    const disc = document.createElementNS(svgNS, 'circle');
    disc.setAttribute('cx', CENTER); disc.setAttribute('cy', CENTER); disc.setAttribute('r', R_IN + 2);
    disc.setAttribute('class', 'wheel-disc');
    svg.appendChild(disc);
    this.sectors = [];
    for (let i = 0; i < n; i++) {
      const a0 = (-90 - step / 2 + i * step) * Math.PI / 180;
      const a1 = (-90 + step / 2 + i * step) * Math.PI / 180;
      const p = document.createElementNS(svgNS, 'path');
      p.setAttribute('d', sectorPath(CENTER, CENTER, R_IN, R_OUT, a0, a1));
      p.setAttribute('class', 'wheel-sector');
      p.addEventListener('mouseenter', () => { this.index = i; this.#highlight(); });
      p.addEventListener('click', (ev) => { ev.stopPropagation(); this.index = i; this.#commit(); });
      svg.appendChild(p);
      this.sectors.push(p);

      const mid = (a0 + a1) / 2;
      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('x', CENTER + Math.cos(mid) * rr);
      label.setAttribute('y', CENTER + Math.sin(mid) * rr);
      label.setAttribute('class', 'wheel-label');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'middle');
      // as large as the sector allows: long words are hyphenated, a crowded wheel gets a smaller type; a place
      // loses its clarification in brackets here (the centre shows the whole name)
      const text = this.items[i].kind === 'place' ? shortLabel(this.items[i].label) : this.items[i].label;
      const { lines: words, size } = fitLabel(text, 2 * rr * Math.sin(Math.PI / n) - margin, (R_OUT - R_IN) * 0.78);
      label.style.fontSize = size + 'px';
      words.forEach((w, k) => {
        const ts = document.createElementNS(svgNS, 'tspan');
        ts.setAttribute('x', CENTER + Math.cos(mid) * rr);
        ts.setAttribute('dy', k === 0 ? `${-(words.length - 1) * 0.55}em` : '1.1em');
        ts.textContent = w;
        label.appendChild(ts);
      });
      svg.appendChild(label);
    }
    this.svg = svg;
    this.el.appendChild(svg);
    this.centre = h('div.wheel-centre',
      h('div.wheel-switch'),       // the centre as a target: the other ring and its key
      h('div.wheel-title', ''),
      h('div.wheel-count', ''),
      h('div.wheel-hint'),
    );
    this.el.appendChild(this.centre);
    this.#highlight();
  }
  #highlight() {
    if (!this.sectors) return;
    this.sectors.forEach((s, i) => s.classList.toggle('active', i === this.index));
    const places = this.ring === 'places', it = this.items[this.index];
    const other = places ? tr({ de: 'Abteilungen', en: 'Departments' }) : t('menu.places');
    // the pill: what the centre disc (the cursor coming back into it), Q or the pad's LB and RB do next
    const sw = this.centre.querySelector('.wheel-switch');
    sw.innerHTML = `<span class="ws-rings">${RINGS_ICON}</span><span class="ws-name"></span>${padState.active ? glyph('lb') + glyph('rb') : '<kbd>Q</kbd>'}`;
    sw.querySelector('.ws-name').textContent = other;
    sw.classList.toggle('active', !it);
    this.centre.querySelector('.wheel-hint').innerHTML = hintText(places ? 'wheel.hintPlaces' : 'wheel.hint');
    const title = this.centre.querySelector('.wheel-title'), count = this.centre.querySelector('.wheel-count');
    if (!it) {
      // nothing highlighted (the rings were just swapped): the ring's own name and size
      const n = places ? this.items.length : this.items.filter((x) => x.kind === 'dep').length;
      title.textContent = places ? t('menu.places') : tr({ de: 'Abteilungen', en: 'Departments' });
      count.textContent = places ? tr({ de: n === 1 ? '1 Ort' : '{n} Orte', en: n === 1 ? '1 place' : '{n} places' }, { n })
        : tr({ de: n === 1 ? '1 Abteilung' : '{n} Abteilungen', en: n === 1 ? '1 department' : '{n} departments' }, { n });
      return;
    }
    title.textContent = it.label;
    count.textContent = it.kind === 'place' ? it.group
      : it.kind === 'recent' || (it.kind === 'finished' && !it.count) ? t('wheel.recent')
      : it.kind === 'finished' && it.count === 1 ? tr({ de: '1 Buch', en: '1 book' }) : t('wheel.books', { n: it.count });
  }
  refresh() { if (this.open) { this.items = this.#itemsOf(this.ring); this.#render(); } }
}

/** A place label is a plain string or { de, en } (as in ui/menu.js). */
const placeLabel = (p) => (typeof p.label === 'string' ? p.label : (p.label?.[i18n.lang] || p.label?.de || p.label?.en || p.id));
/** The label without a clarification in brackets at its end and without quotes: "Regal „Gelesen“" → "Regal Gelesen". */
const shortLabel = (s) => String(s).replace(/\s*\([^()]*\)\s*$/, '').replace(/[„“”"]/g, '').trim() || String(s);

function sectorPath(cx, cy, r0, r1, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const x0 = cx + Math.cos(a0) * r1, y0 = cy + Math.sin(a0) * r1;
  const x1 = cx + Math.cos(a1) * r1, y1 = cy + Math.sin(a1) * r1;
  const x2 = cx + Math.cos(a1) * r0, y2 = cy + Math.sin(a1) * r0;
  const x3 = cx + Math.cos(a0) * r0, y3 = cy + Math.sin(a0) * r0;
  return `M ${x0} ${y0} A ${r1} ${r1} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${r0} ${r0} 0 ${large} 0 ${x3} ${y3} Z`;
}

let measureCtx = null, labelFamily = null;
/** Width of `text` in the wheel's label type at `size` (SVG units are CSS pixels here). */
function textWidth(text, size) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = `600 ${size}px ${labelFamily || 'Georgia, serif'}`;
  return measureCtx.measureText(text).width;
}
// consonant clusters that begin a syllable: a cut goes in front of the whole cluster ("Glas-front", "Haupt-straße")
const ONSETS = new Set(['bl', 'br', 'dr', 'fl', 'fr', 'gl', 'gn', 'gr', 'kl', 'kn', 'kr', 'pf', 'pl', 'pr', 'qu', 'sk', 'sp', 'st', 'tr', 'zw', 'chr', 'phr', 'thr', 'str', 'spr', 'spl', 'skr', 'pfl', 'pfr']);
/**
 * Where a long word may be cut: where a syllable starts (a consonant before a vowel, never inside "ch", "ck", "sh",
 * "ph" or "th"), in front of a consonant cluster that starts a syllable ("Glas-front", "Futter-stelle"), and before
 * "sch" ("Wissen-schaften"). Every part keeps at least three letters.
 */
function cutsOf(word) {
  const V = /[aeiouyäöü]/i, L = /[a-zäöüß]/i, out = [];
  for (let i = 3; i <= word.length - 3; i++) {
    const a = word[i - 1], b = word[i], c = word[i + 1] || '';
    if (!L.test(a)) continue;
    if (/^sch[aeiouyäöü]/i.test(word.slice(i)) && !/s/i.test(a)) { out.push(i); continue; }
    if (!L.test(b) || V.test(b) || !V.test(c)) continue;
    if ((/[hk]/i.test(b) && /[cs]/i.test(a)) || (/h/i.test(b) && /[pt]/i.test(a))) continue;   // ch, ck, sh, ph, th
    // the longest cluster ending in b that begins a syllable: the cut moves in front of it
    let j = i;
    for (let k = i - 1; k >= i - 2 && k >= 1; k--) if (ONSETS.has(word.slice(k, i + 1).toLowerCase())) j = k;
    if (j === i) out.push(i);
    else if (j >= 3 && L.test(word[j - 1]) && !out.includes(j)) out.push(j);
  }
  return out;
}
/**
 * A long word cut so that every part fits `maxW` at `size`: two parts if they do, else three ("Natur-wissen-schaften"),
 * the parts as even as the syllables allow. A word that cannot be cut stays whole.
 */
function splitWord(word, size, maxW) {
  if (textWidth(word, size) <= maxW) return [word];
  const cuts = cutsOf(word), n = word.length;
  const widest = (parts) => Math.max(...parts.map((p) => textWidth(p, size)));
  let best = null, bestW = Infinity;
  for (const i of cuts) {
    const parts = [word.slice(0, i) + '-', word.slice(i)];
    const w = widest(parts);
    if (w < bestW) { best = parts; bestW = w; }
  }
  if (best && bestW <= maxW) return best;
  for (const i of cuts) for (const j of cuts) {
    if (j < i + 3) continue;
    const parts = [word.slice(0, i) + '-', word.slice(i, j) + '-', word.slice(j, n)];
    const w = widest(parts);
    if (w < bestW) { best = parts; bestW = w; }
  }
  return best || [word];
}
/** Lines and type size for a label that has to fit `maxW` × `maxH` (three lines at most). */
function fitLabel(text, maxW, maxH) {
  const words = String(text).split(/\s+/).filter(Boolean);
  let pending = null;   // a fitting layout with a word in three parts: two parts one size smaller beat it
  // whole words down to 14 px first; only then long words are split
  for (const [size, split] of [[17, false], [16, false], [15, false], [14, false], [17, true], [16, true], [15, true], [14, true], [13, true], [12, true], [11, true]]) {
    if (pending && size < pending.size - 1) return pending;
    const lines = [];
    let line = '', ok = true, three = false;
    for (const word of words) {
      const parts = split ? splitWord(word, size, maxW) : [word];
      if (parts.length > 2) three = true;
      for (const part of parts) {
        const test = line ? line + ' ' + part : part;
        if (line && (textWidth(test, size) > maxW || line.endsWith('-'))) { lines.push(line); line = part; } else line = test;
        if (textWidth(part, size) > maxW) ok = false;
      }
    }
    if (line) lines.push(line);
    if (!(ok && lines.length <= 3 && lines.length * size * 1.15 <= maxH)) continue;
    if (!three) return { lines, size };
    if (!pending) pending = { lines, size };
  }
  return pending || { lines: words.slice(0, 3), size: 11 };
}
