// A keyboard on the screen for the text fields of the panels while the gamepad is in use (search in the Mediathek, the
// world map, the catalogue, the address of the reading browser …): letters in the order of the keyboard of the
// interface language (QWERTZ, QWERTY), digits, umlauts, a few signs, space, delete, the cursor and "Fertig".
// The D-pad or the left stick moves between the keys, A types, X deletes, Y puts a space, LT switches to capitals,
// LB and RB move the cursor, Start or "Fertig" confirms like Enter, B closes the keyboard and keeps the text.
// The field receives what is typed as if from a keyboard: an 'input' event for every change (search fields search as
// you type) and Enter as a key press. A key on the real keyboard closes it (input/gamepad.js setActive).
import { h } from '../core/dom.js';
import { i18n, tr } from '../core/i18n.js';
import { fillGlyphs } from './pad-hints.js';

const ROWS = {
  de: [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'ß'],
    ['q', 'w', 'e', 'r', 't', 'z', 'u', 'i', 'o', 'p', 'ü'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ö', 'ä'],
    ['shift', 'y', 'x', 'c', 'v', 'b', 'n', 'm', '-', '.', 'back'],
    ['@', '/', ':', 'space', 'left', 'right', 'done'],
  ],
  en: [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '\''],
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '?'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ',', '&'],
    ['shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '-', '.', 'back'],
    ['@', '/', ':', 'space', 'left', 'right', 'done'],
  ],
};
const SPAN = { space: 4, done: 2 };
const COLS = 11;
const LABEL = {
  shift: '⇧', back: '⌫', left: '←', right: '→',
  space: { de: 'Leerzeichen', en: 'Space' }, done: { de: 'Fertig', en: 'Done' },
};

export class PadKeyboard {
  constructor() {
    this.open = false; this.el = null; this.cur = 0; this.caps = false; this.keys = [];
  }

  /** Show the keyboard for a text field (it gets the browser's focus, the caret at the end). */
  openFor(field, { onClose } = {}) {
    if (!field) return;
    this.close();
    this.field = field; this.onClose = onClose; this.caps = false;
    try { field.focus({ preventScroll: true }); } catch {}
    try { const n = field.value?.length ?? 0; field.setSelectionRange?.(n, n); } catch {}
    this.#build();
    this.open = true;
    this.cur = Math.max(0, this.keys.findIndex((k) => k.id === 'q'));
    this.#mark();
    this.offLang = i18n.onChange?.(() => { if (this.open) { this.#build(); this.#mark(); } });
  }
  close() {
    if (!this.open && !this.box) return;
    this.open = false;
    this.offLang?.(); this.offLang = null;
    this.box?.remove(); this.box = null;
    const cb = this.onClose; this.onClose = null;
    cb?.();
  }
  /** The keyboard and mouse took over: the keyboard on the screen goes. */
  dim(on) { if (on) this.close(); }

  #build() {
    this.box?.remove();
    const lang = i18n.lang === 'en' ? 'en' : 'de';
    this.keys = [];
    const grid = h('div.osk-grid');
    ROWS[lang].forEach((row, r) => {
      let col = 0;
      for (const id of row) {
        const span = SPAN[id] || 1;
        const label = LABEL[id] ? (typeof LABEL[id] === 'string' ? LABEL[id] : tr(LABEL[id])) : id;
        const el = h('button.osk-key', { type: 'button', tabindex: -1, dataset: { key: id }, class: id.length > 1 ? 'osk-wide osk-' + id : '', style: { gridColumn: `span ${span}` },
          onmousedown: (e) => e.preventDefault(), onclick: () => { this.cur = this.keys.findIndex((k) => k.el === el); this.#mark(); this.press(id); } }, label);
        this.keys.push({ id, el, row: r, col, span });
        grid.appendChild(el);
        col += span;
      }
    });
    const hint = h('div.osk-hint', { html: fillGlyphs(tr({
      de: '{A} Taste · {X} Löschen · {Y} Leerzeichen · {LT} Groß · {LB} {RB} Cursor · {START} Fertig · {B} Schließen',
      en: '{A} Key · {X} Delete · {Y} Space · {LT} Capitals · {LB} {RB} Cursor · {START} Done · {B} Close',
    })) });
    this.box = h('div#pad-osk', { role: 'dialog', 'aria-label': tr({ de: 'Tastatur', en: 'Keyboard' }) }, grid, hint);
    document.body.appendChild(this.box);
    // below the field when there is room, else above it
    const fr = this.field?.getBoundingClientRect?.();
    const bh = this.box.offsetHeight || 300;
    this.box.classList.toggle('top', !!fr && fr.bottom > innerHeight - bh - 28);
    this.#caps();
  }
  #caps() {
    for (const k of this.keys) if (k.id.length === 1 && k.id.toLowerCase() !== k.id.toUpperCase()) k.el.textContent = this.caps ? (k.id === 'ß' ? 'ẞ' : k.id.toUpperCase()) : k.id;
    this.keys.find((k) => k.id === 'shift')?.el.classList.toggle('on', this.caps);
  }
  #mark() { this.keys.forEach((k, i) => k.el.classList.toggle('cur', i === this.cur)); }

  /** One frame of the pad while the keyboard is open (input/gamepad.js). */
  step(pad, dt) {
    if (!this.field?.isConnected) { this.close(); return; }
    if (pad.pressed('b')) { this.close(); return; }
    if (pad.pressed('start')) { this.press('done'); return; }
    if (pad.pressed('x')) this.press('back');
    if (pad.pressed('y')) this.press('space');
    if (pad.pressed('lt')) this.press('shift');
    if (pad.pressed('lb')) this.press('left');
    if (pad.pressed('rb')) this.press('right');
    const dir = pad.direction(dt);
    if (dir) this.#move(dir);
    if (pad.pressed('a')) this.press(this.keys[this.cur]?.id);
  }
  #move(dir) {
    const k = this.keys[this.cur]; if (!k) return;
    const row = this.keys.filter((x) => x.row === k.row);
    if (dir === 'left' || dir === 'right') {
      const i = row.indexOf(k), n = row.length;
      this.cur = this.keys.indexOf(row[(i + (dir === 'right' ? 1 : -1) + n) % n]);
    } else {
      const rows = Math.max(...this.keys.map((x) => x.row)) + 1;
      const r = (k.row + (dir === 'down' ? 1 : -1) + rows) % rows;
      const mid = k.col + k.span / 2;
      let best = null, bd = Infinity;
      for (const x of this.keys) if (x.row === r) { const d = Math.abs(x.col + x.span / 2 - mid); if (d < bd) { bd = d; best = x; } }
      if (best) this.cur = this.keys.indexOf(best);
    }
    this.#mark();
  }

  /** A key: a character, or shift, back, space, left, right, done. */
  press(id) {
    const f = this.field; if (!f || !id) return;
    if (id === 'shift') { this.caps = !this.caps; this.#caps(); return; }
    if (id === 'done') { this.#enter(); return; }
    if (id === 'left' || id === 'right') { this.#caret(id === 'left' ? -1 : 1); return; }
    if (id === 'back') { this.#erase(); return; }
    let ch = id === 'space' ? ' ' : id;
    if (this.caps && ch.length === 1) ch = ch === 'ß' ? 'ẞ' : ch.toUpperCase();
    this.#insert(ch);
  }
  #insert(text) {
    const f = this.field;
    if (f.isContentEditable) { document.execCommand?.('insertText', false, text); return; }
    try {
      const s = f.selectionStart ?? f.value.length, e = f.selectionEnd ?? s;
      f.setRangeText(text, s, e, 'end');
    } catch { f.value += text; }
    f.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
  }
  #erase() {
    const f = this.field;
    if (f.isContentEditable) { document.execCommand?.('delete'); return; }
    try {
      const s = f.selectionStart ?? f.value.length, e = f.selectionEnd ?? s;
      if (s === e && s === 0) return;
      f.setRangeText('', s === e ? s - 1 : s, e, 'end');
    } catch { f.value = f.value.slice(0, -1); }
    f.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
  }
  #caret(d) {
    const f = this.field;
    try { const p = Math.max(0, Math.min(f.value.length, (f.selectionStart ?? f.value.length) + d)); f.setSelectionRange(p, p); } catch {}
  }
  /** "Fertig": Enter for the field (a search starts), then the keyboard closes. */
  #enter() {
    const f = this.field;
    const o = { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true };
    const down = new KeyboardEvent('keydown', o);
    f.dispatchEvent(down);
    f.dispatchEvent(new KeyboardEvent('keyup', o));
    f.dispatchEvent(new Event('change', { bubbles: true }));
    if (!down.defaultPrevented && f.form && f.isConnected) { try { f.form.requestSubmit(); } catch {} }
    this.close();
  }
}
