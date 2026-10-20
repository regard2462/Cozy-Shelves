// The gamepad's pointer in the panels: the right stick pressed (R3) shows a mouse pointer where the ring was, the left
// stick moves it (the D-pad by a few pixels), A is the left mouse button (held: drag), the right stick turns the mouse
// wheel, B or R3 again ends it. The input goes through Electron (electron/pad-input.js) and counts as a real mouse:
// pieces on the chess board, the brush on the easel, links in the reading browser and Street View answer to it.
import { h } from '../core/dom.js';
import { tr } from '../core/i18n.js';
import { api } from '../core/api.js';
import { fillGlyphs } from './pad-hints.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const SPEED = 1300;      // px a second at full tilt
const NUDGE = 4;         // px per press of the D-pad

export class PadCursor {
  constructor() {
    this.on = false; this.x = 0; this.y = 0; this.down = false;
    this.recent = [];    // the points sent last: the mouse events they bring back are ours, not a real mouse
    this.wheel = { x: 0, y: 0, at: 0 };
  }

  /** Show the pointer at (x, y) (CSS pixels of the window). */
  show(x, y) {
    this.on = true; this.down = false;
    this.x = clamp(x, 0, innerWidth - 1); this.y = clamp(y, 0, innerHeight - 1);
    if (!this.el) {
      this.el = h('div#pad-cursor', { 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2.5v17.2l4.6-4.4 3 6.9 3.1-1.4-3-6.8h6.4z" fill="#fff" stroke="#1d1d1f" stroke-width="1.6" stroke-linejoin="round"/></svg>' });
      this.hint = h('div#pad-cursor-hint');
    }
    this.hint.innerHTML = fillGlyphs(tr({
      de: '{LS} Zeiger · {A} Klicken, gehalten ziehen · {RS} Rollen · {B} Zeiger aus',
      en: '{LS} Pointer · {A} Click, hold to drag · {RS} Scroll · {B} Pointer off',
    }));
    document.body.append(this.el, this.hint);
    this.#draw();
    this.#send('mouseMove');
  }
  /** End the pointer (a held button is let go first). */
  hide() {
    if (!this.on) return;
    if (this.down) { this.down = false; this.#send('mouseUp'); }
    this.on = false;
    this.el?.remove(); this.hint?.remove();
  }

  /** One frame of the pad while the pointer shows (input/gamepad.js). Returns 'exit' when it ended. */
  step(pad, dt) {
    if (pad.pressed('b') || pad.pressed('r3')) { this.hide(); return 'exit'; }
    const [lx, ly, lm] = pad.stick('left');
    let moved = false;
    if (lm > 0) {
      // slow near the middle for aiming at a square, fast at the edge
      const v = SPEED * Math.pow(lm, 1.7) / lm;
      this.x = clamp(this.x + lx * v * dt, 0, innerWidth - 1);
      this.y = clamp(this.y + ly * v * dt, 0, innerHeight - 1);
      moved = true;
    }
    const dir = pad.direction(dt, false);
    if (dir) {
      this.x = clamp(this.x + (dir === 'left' ? -NUDGE : dir === 'right' ? NUDGE : 0), 0, innerWidth - 1);
      this.y = clamp(this.y + (dir === 'up' ? -NUDGE : dir === 'down' ? NUDGE : 0), 0, innerHeight - 1);
      moved = true;
    }
    if (moved) { this.#draw(); this.#send('mouseMove'); }
    if (pad.pressed('a')) { this.down = true; this.#draw(); this.#send('mouseDown'); }
    else if (!pad.down('a') && this.down) { this.down = false; this.#draw(); this.#send('mouseUp'); }
    // the right stick turns the wheel (a few times a second, up to 1500 px a second)
    const [rx, ry, rm] = pad.stick('right');
    if (rm > 0) { this.wheel.x += rx * 1500 * rm * dt; this.wheel.y += ry * 1500 * rm * dt; }
    const now = performance.now();
    if ((Math.abs(this.wheel.x) >= 1 || Math.abs(this.wheel.y) >= 1) && now - this.wheel.at > 50) {
      // Chromium's wheel: a positive delta scrolls back up the page
      this.#send('mouseWheel', { dx: -Math.round(this.wheel.x), dy: -Math.round(this.wheel.y) });
      this.wheel.x = this.wheel.y = 0; this.wheel.at = now;
    }
    return null;
  }

  /** Is this (trusted) mouse event one the pointer sent? A real mouse elsewhere is not. */
  owns(e) {
    if (!this.on && !this.recent.length) return false;
    const now = performance.now();
    this.recent = this.recent.filter((p) => now - p.t < 800);
    return this.recent.some((p) => Math.abs(e.clientX - p.x) < 2 && Math.abs(e.clientY - p.y) < 2);
  }

  #draw() {
    if (!this.el) return;
    this.el.style.transform = `translate(${Math.round(this.x)}px, ${Math.round(this.y)}px)`;
    this.el.classList.toggle('down', this.down);
  }
  #send(type, extra = {}) {
    const p = { type, x: Math.round(this.x), y: Math.round(this.y), down: this.down, ...extra };
    this.recent.push({ x: p.x, y: p.y, t: performance.now() });
    if (this.recent.length > 24) this.recent.shift();
    try { Promise.resolve(api.invoke?.('pad:mouse', p)).catch(() => {}); } catch {}
  }
}
