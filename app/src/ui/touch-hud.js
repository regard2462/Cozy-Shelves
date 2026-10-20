// The on-screen controls of a touch screen (a phone, the Android app), laid over the world in #hud: a stick bottom
// left that feeds TouchInput.stick (input/touch.js, which also turns a drag on the canvas into looking and a tap into
// using), the buttons bottom right (use, jump, read, info), a run toggle above the stick, the menu and the department
// wheel top left. Hidden while a panel is open (#hud.panel-open, styles/touch.css) and so before the library was
// entered. Every target is 50 px or more; nothing here renders into the world.
//   new TouchHud($('#hud'), { touch: touchInput, act: (key) => world.actions.act(key), onMenu, onWheel })
import { h } from '../core/dom.js';
import { tr } from '../core/i18n.js';
import { touchState } from '../input/pad-hints.js';

const RUN_AT = 0.85;   // the knob pushed this far out runs (like the gamepad's stick)
const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
const ICONS = {
  // an open hand: use what the crosshair rests on
  use: svg('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5V4.5a1.5 1.5 0 0 1 3 0V12M14 11.5V6a1.5 1.5 0 0 1 3 0v6.5M17 12.5V8.5a1.5 1.5 0 0 1 3 0V15c0 3.5-2.5 6-6 6h-1.5c-2 0-3.3-.7-4.3-2L5 14.6a1.6 1.6 0 0 1 2.6-1.9L8 13.5"/>'),
  jump: svg('<path d="M12 20V6M6 12l6-6 6 6"/>'),
  read: svg('<path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H11v16H5.5A2.5 2.5 0 0 0 3 21zM21 5.5A2.5 2.5 0 0 0 18.5 3H13v16h5.5a2.5 2.5 0 0 1 2.5 2z"/>'),
  run: svg('<path d="M13.5 4.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0M8 21l3-7 3 2v5M6 13l2.5-4.5L12 7l3 1.5 2.5 3.5H20M14 11l-2 4"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  wheel: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3.5v6M12 14.5v6M3.5 12h6M14.5 12h6"/>'),
};

export class TouchHud {
  constructor(root, { touch, act, onMenu, onWheel }) {
    this.root = root; this.touch = touch; this.act = act;
    this.runLock = false;
    this.pointer = null;          // the finger on the stick: { id, cx, cy, r }
    touchState.active = true;
    root.classList.add('touch');
    const L = (de, en) => tr({ de, en });
    const button = (cls, icon, label, on) => h('button.th-btn.' + cls, { type: 'button', 'aria-label': label, title: label, html: icon, onpointerdown: (e) => { e.preventDefault(); e.stopPropagation(); on(); } });
    this.knob = h('div.th-knob');
    this.stick = h('div.th-stick', { 'aria-label': L('Bewegen', 'Move') }, this.knob);
    this.runBtn = button('th-run', ICONS.run, L('Laufen', 'Run'), () => this.#toggleRun());
    this.el = h('div.touch-hud',
      this.stick, this.runBtn,
      button('th-menu', ICONS.menu, L('Menü', 'Menu'), () => onMenu?.()),
      button('th-wheel', ICONS.wheel, L('Abteilungen', 'Departments'), () => onWheel?.()),
      button('th-info', 'i', L('Info', 'Info'), () => act('F')),
      button('th-read', ICONS.read, L('Lesen', 'Read'), () => act('R')),
      button('th-jump', ICONS.jump, L('Springen', 'Jump'), () => act('Space')),
      button('th-use', ICONS.use, L('Benutzen', 'Use'), () => act('E')),
    );
    root.appendChild(this.el);
    this._down = (e) => this.#down(e);
    this._move = (e) => this.#move(e);
    this._up = (e) => this.#up(e);
    this.stick.addEventListener('pointerdown', this._down);
    this.stick.addEventListener('pointermove', this._move);
    this.stick.addEventListener('pointerup', this._up);
    this.stick.addEventListener('pointercancel', this._up);
    this.stick.addEventListener('lostpointercapture', this._up);
  }

  #down(e) {
    if (this.pointer) return;
    e.preventDefault(); e.stopPropagation();
    const r = this.stick.getBoundingClientRect();
    // the knob travels half the ring's radius beyond the centre: a short thumb movement is the full speed
    this.pointer = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width * 0.3 };
    try { this.stick.setPointerCapture(e.pointerId); } catch {}
    this.stick.classList.add('active');
    this.#apply(e.clientX, e.clientY);
  }
  #move(e) {
    const p = this.pointer;
    if (!p || e.pointerId !== p.id) return;
    e.preventDefault();
    this.#apply(e.clientX, e.clientY);
  }
  #up(e) {
    const p = this.pointer;
    if (!p || e.pointerId !== p.id) return;
    this.pointer = null;
    try { this.stick.releasePointerCapture(e.pointerId); } catch {}
    this.stick.classList.remove('active', 'running');
    this.knob.style.transform = '';
    this.touch.stick.set(0, 0, false);
  }
  #apply(x, y) {
    const p = this.pointer;
    let dx = x - p.cx, dy = y - p.cy;
    const len = Math.hypot(dx, dy);
    if (len > p.r) { dx *= p.r / len; dy *= p.r / len; }
    const share = Math.min(1, len / p.r);
    const run = this.runLock || share >= RUN_AT;
    this.stick.classList.toggle('running', run);
    this.knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    // x right, y forward, as the gamepad's left stick (player.pad)
    this.touch.stick.set(dx / p.r, -dy / p.r, run);
  }
  #toggleRun() {
    this.runLock = !this.runLock;
    this.runBtn.classList.toggle('on', this.runLock);
    if (this.pointer) this.stick.classList.toggle('running', this.runLock || this.touch.stick.run);
  }

  dispose() {
    this.stick.removeEventListener('pointerdown', this._down);
    this.stick.removeEventListener('pointermove', this._move);
    this.stick.removeEventListener('pointerup', this._up);
    this.stick.removeEventListener('pointercancel', this._up);
    this.stick.removeEventListener('lostpointercapture', this._up);
    this.el.remove();
    this.root.classList.remove('touch');
    touchState.active = false;
  }
}
