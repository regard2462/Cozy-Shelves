// Gamepad: Xbox, PlayStation and every pad the browser reports with its standard mapping.
//
// In the world the left stick walks (its tilt sets the speed), the right stick looks (sensitivity and "Y invertieren"
// in the settings, a small dead zone, a gentle curve and more speed at the edge), the triggers aim finely (LT) and
// zoom in (RT). The buttons do what the keys do: A = E, B back (stand up), X jumps, Y opens the basket, LB and RB the
// second and third key of the book card (R Lesen, F Info), the left stick pressed runs, the right one stands up or
// sits down, Start opens the menu, View the places (held: the department wheel), the D-pad steps from book to book.
// In the panels a ring moves between the buttons (input/pad-nav.js, per panel input/pad-panels.js), A presses, B goes
// back, LB and RB switch tabs, the right stick scrolls; text fields get a keyboard on the screen (input/pad-osk.js), and
// the right stick pressed shows a mouse pointer for what is made for the mouse (input/pad-cursor.js).
//
// Nothing runs while no pad is connected: the loop starts with 'gamepadconnected' and ends with the last
// 'gamepaddisconnected' (Chromium reports a pad once one of its buttons was pressed). The HUD shows the pad's buttons
// while the pad is the input used last and the keys again as soon as the keyboard or the mouse is used
// (padState.active, the bus event 'input:device', <html data-input="pad">).
import { bus } from '../core/bus.js';
import { padState, familyOf, padName } from './pad-hints.js';
import { currentPanel } from '../ui/panels.js';
import { PadNav } from './pad-nav.js';
import { adapterFor, hudAdapter } from './pad-panels.js';
import { PadKeyboard } from './pad-osk.js';
import { PadCursor } from './pad-cursor.js';
import { activeTransport } from '../media/transport.js';
import { mediaPlayer } from '../media/media-player.js';

// the standard mapping (https://w3c.github.io/gamepad/#remapping)
const BUTTONS = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'view', 'start', 'l3', 'r3', 'up', 'down', 'left', 'right', 'home'];
const DEAD = 0.15;                 // radial dead zone of the sticks
const WAKE = 0.4;                  // a stick tilted this far counts as input (the pad becomes the input used last)
const HOLD_VIEW = 0.32;            // View held this long opens the department wheel
const REPEAT_FIRST = 0.36, REPEAT_NEXT = 0.09;   // a held direction repeats (menus, lists)
const LOOK_YAW = 2.6, LOOK_PITCH = 1.75;         // rad/s at full tilt and sensitivity 1
const EDGE_BOOST = 0.75;           // up to this much faster after the stick rests at the edge for a moment
const PITCH_MAX = 1.35;            // as with the mouse (player.js)

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/** A stick with a radial dead zone, rescaled so that the edge of the dead zone is 0 and full tilt 1. */
function stick(x = 0, y = 0) {
  const m = Math.hypot(x, y);
  if (m < DEAD) return [0, 0, 0];
  const k = Math.min(1, (m - DEAD) / (1 - DEAD));
  return [x / m * k, y / m * k, k];
}

export class GamepadInput {
  /** world, wheel (CategoryWheel), ctx (the panel context of main.js), filmFull (FilmFullscreen) */
  constructor({ world, wheel, ctx, filmFull }) {
    this.world = world; this.wheel = wheel; this.ctx = ctx; this.filmFull = filmFull;
    this.index = -1;               // the pad in use (navigator.getGamepads() index)
    this.count = 0;
    this.raf = 0; this.lastT = 0;
    this.prev = new Array(BUTTONS.length).fill(false);
    this.now = new Array(BUTTONS.length).fill(false);
    this.values = new Array(BUTTONS.length).fill(0);
    this.axes = [0, 0, 0, 0];
    this.held = new Array(BUTTONS.length).fill(0);
    this.rep = { dir: null, t: 0, next: 0 };
    this.lookV = { x: 0, y: 0 }; this.edgeT = 0;
    this.run = false; this.restT = 0; this.stickCentred = true;
    this.aim = null;               // a glide of the view onto a book (the D-pad)
    this.hudZone = false;          // the D-pad leads into the mini player (its buttons)
    this.viewWheel = false;
    this.context = null;
    this.calls = 0;                // getGamepads() calls (controller-check: none without a pad)
    this.paused = false;           // build/scripts/controller-check.js steps the pad itself (step())
    this.nav = new PadNav();
    this.osk = new PadKeyboard();
    this.cursor = new PadCursor();   // the pointer in the panels (R3), real mouse input through electron/pad-input.js
    this.loop = (t) => this.#tick(t);
    this.onConnect = (e) => this.#connected(e);
    this.onDisconnect = (e) => this.#disconnected(e);
    window.addEventListener('gamepadconnected', this.onConnect);
    window.addEventListener('gamepaddisconnected', this.onDisconnect);
    // a book taken: a short rumble (main.js reports the basket)
    this.basketN = ctx?.state?.basket?.length || 0;
    bus.on('basket:change', (ids) => { const n = ids?.length || 0; if (n > this.basketN) this.rumble('take'); this.basketN = n; });
    // a pad pressed while the app was still loading
    try { if ([...(navigator.getGamepads?.() || [])].some(Boolean)) this.#connected(); } catch {}
  }

  get settings() { return this.ctx?.state?.settings?.gamepad || {}; }

  // ------------------------------------------------------------------ connection ----
  #pads() { this.calls++; try { return [...(navigator.getGamepads?.() || [])].filter((p) => p && p.connected !== false); } catch { return []; } }
  #connected() {
    this.#bindDevice();
    this.#scan();
    if (this.count && !this.raf) { this.lastT = 0; this.raf = requestAnimationFrame(this.loop); }
  }
  #disconnected(e) {
    const gone = e?.gamepad?.index;
    this.#scan(gone);
    if (this.count) return;
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.#leaveWorld();
    this.run = false;   // (a run toggled on with L3 does not wait for the next pad: it would set off running at a touch)
    this.nav.clear(); this.osk.close(); this.cursor.hide();
    this.hudZone = false;
    this.setActive(false);
  }
  /** Which pads there are; the one in use keeps its place unless it is gone. */
  #scan(gone = -1) {
    const pads = this.#pads().filter((p) => p.index !== gone);
    this.count = pads.length;
    let pad = pads.find((p) => p.index === this.index) || pads.find((p) => p.mapping === 'standard') || pads[0] || null;
    this.index = pad ? pad.index : -1;
    this.#describe(pad);
  }
  #describe(pad) {
    const was = `${padState.connected}|${padState.name}|${padState.family}`;
    padState.connected = !!pad;
    padState.name = pad ? padName(pad.id) : '';
    padState.family = pad ? familyOf(pad.id) : padState.family;
    padState.standard = !pad || pad.mapping === 'standard';
    padState.vibration = !!pad?.vibrationActuator;
    if (was !== `${padState.connected}|${padState.name}|${padState.family}`) bus.emit('pad:connection', { ...padState });
  }
  /** Keyboard and mouse take over the hints again (only real input: the keys this module sends do not count). */
  #bindDevice() {
    if (this.bound) return;
    this.bound = true;
    this.moveAcc = 0;
    // (the pad's own pointer sends real mouse events too: those do not count)
    const back = (e) => { if (e.isTrusted && padState.active && !(e.type !== 'keydown' && this.cursor.owns(e))) this.setActive(false); };
    document.addEventListener('keydown', back, true);
    document.addEventListener('mousedown', back, true);
    document.addEventListener('wheel', back, { capture: true, passive: true });
    document.addEventListener('mousemove', (e) => {
      if (!e.isTrusted || !padState.active || this.cursor.owns(e)) return;
      // a resting mouse reports nothing; a few pixels of real movement in a moment switch back
      const now = performance.now();
      if (now - (this.moveAt || 0) > 300) this.moveAcc = 0;
      this.moveAt = now;
      this.moveAcc += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
      if (this.moveAcc > 8) this.setActive(false);
    }, { capture: true, passive: true });
  }

  /** The pad (true) or the keyboard and mouse (false) is the input used last. */
  setActive(on) {
    on = !!on;
    if (padState.active === on) return;
    padState.active = on;
    this.moveAcc = 0;
    if (on) document.documentElement.dataset.input = 'pad'; else delete document.documentElement.dataset.input;
    if (!on) { this.nav.hide(); this.osk.dim(true); this.cursor.hide(); this.#leaveWorld(); this.hudZone = false; }
    else this.osk.dim(false);
    bus.emit('input:device', on ? 'pad' : 'keys');
  }

  /** A short rumble (a book taken), only when the setting allows it and the pad can. force: the test button of the
   *  settings (also with the mouse, whatever the setting). */
  rumble(kind = 'take', { force = false } = {}) {
    if (!force && (!padState.active || this.settings.vibration === false)) return false;
    const pad = this.#pads().find((p) => p.index === this.index);
    const act = pad?.vibrationActuator;
    if (!act?.playEffect) return false;
    const fx = { take: { duration: 110, strongMagnitude: 0.3, weakMagnitude: 0.6 }, test: { duration: 260, strongMagnitude: 0.6, weakMagnitude: 0.9 } }[kind] || { duration: 100, strongMagnitude: 0.3, weakMagnitude: 0.5 };
    try { Promise.resolve(act.playEffect(act.type || 'dual-rumble', { startDelay: 0, ...fx })).catch(() => {}); return true; } catch { return false; }
  }

  // ------------------------------------------------------------------ the frame ----
  #tick(t) {
    this.raf = 0;
    if (!this.count) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = this.lastT ? clamp((t - this.lastT) / 1000, 0, 0.1) : 1 / 60;
    this.lastT = t;
    if (this.paused) return;
    try { this.step(dt); } catch (e) { console.error('[pad]', e); }
  }

  /** One poll: read the pad, then the context on top acts (also called by build/scripts/controller-check.js). */
  step(dt = 1 / 60) {
    const pads = this.#pads();
    if (!pads.length) return;
    // the pad that was used last: another one takes over with a button
    let pad = pads.find((p) => p.index === this.index) || null;
    for (const p of pads) if (p !== pad && p.buttons?.some((b) => b?.pressed)) { pad = p; break; }
    if (!pad) pad = pads[0];
    if (pad.index !== this.index) { this.index = pad.index; this.prev.fill(true); this.#describe(pad); }
    this.#read(pad, dt);
    const woke = this.#woke();
    if (woke && !padState.active) { this.setActive(true); this.justWoke = true; }
    if (!padState.active) { this.#leaveWorld(); return; }
    this.#route(dt);
    this.justWoke = false;
  }
  #read(pad, dt) {
    const b = pad.buttons || [];
    for (let i = 0; i < BUTTONS.length; i++) {
      this.prev[i] = this.now[i];
      const v = b[i] ? (typeof b[i] === 'object' ? b[i].value ?? (b[i].pressed ? 1 : 0) : +b[i]) : 0;
      const pressed = !!(b[i] && (typeof b[i] === 'object' ? b[i].pressed : v > 0.5));
      this.values[i] = v;
      // the triggers count as pressed beyond half way
      this.now[i] = i === 6 || i === 7 ? v > 0.5 : pressed;
      this.held[i] = this.now[i] ? this.held[i] + dt : 0;
    }
    const a = pad.axes || [];
    for (let i = 0; i < 4; i++) this.axes[i] = Number.isFinite(a[i]) ? a[i] : 0;
  }
  #woke() {
    for (let i = 0; i < BUTTONS.length; i++) if (this.now[i] && !this.prev[i]) return true;
    if (Math.hypot(this.axes[0], this.axes[1]) > WAKE || Math.hypot(this.axes[2], this.axes[3]) > WAKE) return true;
    return this.values[6] > 0.3 || this.values[7] > 0.3;
  }
  pressed(name) { const i = BUTTONS.indexOf(name); return this.now[i] && !this.prev[i]; }
  released(name) { const i = BUTTONS.indexOf(name); return !this.now[i] && this.prev[i]; }
  down(name) { return this.now[BUTTONS.indexOf(name)]; }
  heldFor(name) { return this.held[BUTTONS.indexOf(name)]; }
  trigger(name) { return clamp(this.values[BUTTONS.indexOf(name)] || 0, 0, 1); }
  stick(which) { return which === 'right' ? stick(this.axes[2], this.axes[3]) : stick(this.axes[0], this.axes[1]); }

  /**
   * The direction of this frame for menus and lists: a fresh press of the D-pad or the left stick, then repeats while
   * it is held. useStick: the left stick counts as well.
   */
  direction(dt, useStick = true) {
    let dir = this.down('up') ? 'up' : this.down('down') ? 'down' : this.down('left') ? 'left' : this.down('right') ? 'right' : null;
    if (!dir && useStick) {
      const [x, y] = [this.axes[0], this.axes[1]];
      const m = Math.max(Math.abs(x), Math.abs(y));
      // pressed beyond 0.6, let go below 0.35 (no flicker at the threshold)
      const on = this.rep.stick ? m > 0.35 : m > 0.6;
      this.rep.stick = on;
      if (on) dir = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
    }
    if (dir !== this.rep.dir) { this.rep.dir = dir; this.rep.t = 0; this.rep.next = REPEAT_FIRST; return dir; }
    if (!dir) return null;
    this.rep.t += dt;
    if (this.rep.t >= this.rep.next) { this.rep.next += Math.max(0.05, REPEAT_NEXT - this.rep.t * 0.01); return dir; }
    return null;
  }

  /** A key press for the panel on top (and whatever has the focus): main.js routes it as it routes the keyboard. */
  key(code, key, extra = {}) {
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document;
    const o = { code, key, bubbles: true, cancelable: true, ...extra };
    const down = new KeyboardEvent('keydown', o);
    target.dispatchEvent(down);
    target.dispatchEvent(new KeyboardEvent('keyup', o));
    return down.defaultPrevented;
  }

  // ------------------------------------------------------------------ routing ----
  #route(dt) {
    if (this.cursor.on) {
      // the pointer belongs to the panels (and the film in full screen): without them it goes
      if (!currentPanel() && !this.filmFull?.isOpen) this.cursor.hide();
      else { this.#enter('cursor'); this.nav.hide(); if (this.cursor.step(this, dt) === 'exit') this.nav.draw(true); return; }
    }
    if (this.osk.open) { this.#enter('osk'); this.osk.step(this, dt); return; }
    if (this.filmFull?.isOpen) { this.#enter('film'); this.#film(dt); return; }
    if (this.wheel?.open) { this.#enter('wheel'); this.#wheel(dt); return; }
    const top = currentPanel();
    if (top?.el?.isConnected) { this.#enter('panel'); this.#panel(top, dt); return; }
    if (this.hudZone) { this.#enter('hud'); this.#hud(dt); return; }
    this.#enter('world');
    this.#world(dt);
  }
  #enter(name) {
    if (this.context === name) return;
    if (this.context === 'world') { this.#leaveWorld(); this.viewArmed = false; }
    if (name !== 'panel' && name !== 'hud' && name !== 'osk' && name !== 'cursor') this.nav.clear();
    this.context = name;
    // a direction held across the change does not repeat in the new place (a button held is no new press anyway)
    const held = ['up', 'down', 'left', 'right'].find((d) => this.down(d) && this.prev[BUTTONS.indexOf(d)]);
    this.rep.dir = held || (this.rep.stick ? this.rep.dir : null);
    this.rep.t = 0; this.rep.next = REPEAT_FIRST;
  }
  /** The player's share of the pad goes back to rest (a panel opened, the pad is gone, the mouse took over). */
  #leaveWorld() {
    const p = this.world?.player;
    if (p) { p.pad = null; p.zoom = 1; }
    this.lookV.x = this.lookV.y = 0; this.edgeT = 0; this.aim = null;
  }

  // ------------------------------------------------------------------ the world ----
  #world(dt) {
    const w = this.world, p = w.player, act = (k) => w.actions.act(k);
    // ---- buttons
    if (this.pressed('start')) { this.ctx.openPanel('menu', {}); return; }
    if (this.pressed('y')) { this.ctx.openPanel('basket', {}); return; }
    if (this.pressed('a')) act('E');
    if (this.pressed('x')) act('Space');
    if (this.pressed('b') && p.seated) act('Space');
    if (this.pressed('r3')) { if (p.seated) act('Space'); else if (w.actions.target?.type === 'seat' && w.actions.target.near) act('E'); }
    if (this.pressed('l3')) this.run = !this.run;
    // LB and RB: the second and the third key of the book card (R Lesen and F Info; on the table F Info and R Ins Regal)
    const t = w.actions.target;
    if (this.pressed('lb') || this.pressed('rb')) {
      const left = this.pressed('lb');
      if (t?.type === 'book') act(left ? 'R' : 'F');
      else if (t?.type === 'tablebook') act(left ? 'F' : 'R');
    }
    // View: tapped the places, held the department wheel (released: walk there, as with Tab). Only a press that began
    // here counts, and only once: a wheel closed with B while View is still held opens nothing on letting go.
    if (this.pressed('view')) this.viewArmed = true;
    if (this.viewArmed && this.down('view') && this.heldFor('view') >= HOLD_VIEW && !this.wheel?.open) {
      this.viewArmed = false;
      this.viewWheel = true;
      this.wheel?.show(true);
      return;
    }
    if (this.released('view')) {
      const tap = this.viewArmed;
      this.viewArmed = false;
      if (tap) { this.ctx.openPanel('menu', { tab: 'places' }); return; }
    }
    // ---- the D-pad: from book to book, else the film or podcast (left, right) and the mini player (down)
    const dir = this.direction(dt, false);
    if (dir) {
      if (!this.#stepBook(dir)) {
        const tp = activeTransport();
        // like J and L: an audiobook goes 15 s back and 30 s forward (back, fwd), a film and a podcast their step
        if ((dir === 'left' || dir === 'right') && tp) tp.skip(dir === 'left' ? -(tp.back || tp.step) : (tp.fwd || tp.step));
        else if (dir === 'down' && document.querySelector('#media-bar:not(.hidden)')) { this.hudZone = true; return; }
      }
    }
    // ---- the left stick: walk, or stand up with a fresh push
    const [lx, ly, lm] = this.stick('left');
    if (lm < 0.2) { this.restT += dt; if (this.restT > 0.35) this.run = false; } else this.restT = 0;
    if (p.seated) {
      p.pad = null;
      if (lm < 0.25) this.stickCentred = true;
      else if (lm > 0.6 && this.stickCentred) { this.stickCentred = false; act('Move'); }
    } else {
      this.stickCentred = lm < 0.25;
      p.pad = lm > 0 ? { x: lx, y: -ly, run: this.run } : null;
    }
    // ---- the right stick and the triggers: look, aim finely (LT), zoom (RT)
    const lt = this.trigger('lt'), rt = this.trigger('rt');
    p.zoom = 1 + 1.4 * Math.max(0, (rt - 0.08) / 0.92);
    if (!p.enabled || p.transition) { this.lookV.x = this.lookV.y = 0; return; }
    const [rx, ry, rm] = this.stick('right');
    const s = this.settings;
    const sens = clamp(+s.sensitivity || 1, 0.2, 4);
    const inv = s.invertY ? -1 : 1;
    // a curve: small tilts turn slowly (aiming at one spine), full tilt fast; resting at the edge turns faster still
    const curve = rm > 0 ? Math.pow(rm, 1.7) / rm : 0;
    if (rm > 0.94) this.edgeT += dt; else this.edgeT = Math.max(0, this.edgeT - dt * 3);
    const boost = 1 + EDGE_BOOST * clamp((this.edgeT - 0.2) / 0.45, 0, 1);
    const k = sens * (1 - 0.65 * lt) / p.zoom;
    const vx = -rx * curve * LOOK_YAW * boost * k, vy = -ry * curve * LOOK_PITCH * boost * k * inv;
    // smooth: the turn speed follows the stick within some 60 ms
    const f = 1 - Math.exp(-dt / 0.06);
    this.lookV.x += (vx - this.lookV.x) * f; this.lookV.y += (vy - this.lookV.y) * f;
    // the stick let go: the turn ends (no creeping on)
    if (rm === 0 && Math.abs(this.lookV.x) < 0.02 && Math.abs(this.lookV.y) < 0.02) this.lookV.x = this.lookV.y = 0;
    if (rm > 0) this.aim = null;   // the hand on the stick ends a glide onto a book
    if (Math.abs(this.lookV.x) > 1e-4 || Math.abs(this.lookV.y) > 1e-4) {
      p.yaw += this.lookV.x * dt;
      p.pitch = clamp(p.pitch + this.lookV.y * dt, -PITCH_MAX, PITCH_MAX);
    }
    // the glide onto a book chosen with the D-pad
    if (this.aim) {
      const g = 1 - Math.exp(-dt / 0.055);
      let dy = this.aim.yaw - p.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      const dp = this.aim.pitch - p.pitch;
      p.yaw += dy * g; p.pitch = clamp(p.pitch + dp * g, -PITCH_MAX, PITCH_MAX);
      if (Math.abs(dy) < 0.002 && Math.abs(dp) < 0.002) this.aim = null;
      w.actions.rayTimer = Math.min(w.actions.rayTimer, 0.02);
    }
  }

  /**
   * The D-pad on the shelves: the neighbouring book in that direction (the next one in the row, the row above or
   * below), on the same wall: a case around a corner is not "next to" a book. It counts while a book is aimed at, or
   * when one stands close to the crosshair; the view glides onto it.
   */
  #stepBook(dir) {
    const w = this.world, cam = w.camera, t = w.actions.target;
    if (!w.books?.entries?.size || !w.player.enabled || w.player.transition) return false;
    const reach = w.player.seated ? 2.0 : 2.9;
    const cur = t?.type === 'book' && !t.display ? t.entry : null;
    const v = this._v || (this._v = cam.position.clone());
    const look = this._look || (this._look = cam.position.clone());
    cam.getWorldDirection(look);
    const aspect = innerWidth / Math.max(1, innerHeight);
    // the foot of a book: the books of one row stand on the same board, whatever their height
    const at = (e) => { v.copy(e.pos); v.y -= e.h / 2; v.project(cam); return { x: v.x * aspect, y: v.y, z: v.z }; };
    const from = cur ? at(cur) : { x: 0, y: 0 };
    let best = null, bs = Infinity;
    for (const e of w.books.entries.values()) {
      if (e === cur || e.hidden) continue;
      const d = e.pos.distanceTo(cam.position);
      if (d > reach) continue;
      // the same wall as the book aimed at (else a case that faces the eye), at most 40 degrees off the view
      if (cur ? e.forward.dot(cur.forward) < 0.97 : -(e.forward.x * look.x + e.forward.z * look.z) < 0.5) continue;
      v.copy(e.pos).sub(cam.position);
      if (v.dot(look) < d * 0.76) continue;
      const q = at(e);
      if (q.z > 1) continue;
      const dx = q.x - from.x, dy = q.y - from.y;
      // left and right stay on the board (the cases of a wall share their board heights), up and down change it
      const sameRow = !!cur && Math.abs(e.row.y - cur.row.y) < 0.02;
      let s;
      if (dir === 'right') { if (dx <= 0.004 || (cur && !sameRow)) continue; s = dx + Math.abs(dy) * 4; }
      else if (dir === 'left') { if (dx >= -0.004 || (cur && !sameRow)) continue; s = -dx + Math.abs(dy) * 4; }
      else if (dir === 'up') { if (dy <= 0.04 || sameRow) continue; s = dy + Math.abs(dx) * 2.5; }
      else { if (dy >= -0.04 || sameRow) continue; s = -dy + Math.abs(dx) * 2.5; }
      // without a book aimed at: only one close to the crosshair
      if (!cur && Math.hypot(dx, dy) > 0.32) continue;
      if (s < bs) { bs = s; best = e; }
    }
    if (!best) return !!cur;      // at the end of the row: nothing happens, the D-pad stays with the books
    const eye = cam.position;
    const dx = best.pos.x - eye.x, dz = best.pos.z - eye.z;
    this.aim = { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(best.pos.y - eye.y, Math.hypot(dx, dz)), id: best.book.id };
    return true;
  }

  // ------------------------------------------------------------------ the mini player of the HUD ----
  #hud(dt) {
    const bar = document.querySelector('#media-bar:not(.hidden)');
    if (!bar || this.pressed('b') || this.pressed('start')) { this.hudZone = false; this.nav.clear(); if (this.pressed('start')) this.ctx.openPanel('menu', {}); return; }
    if (this.nav.root !== bar) this.nav.setRoot(bar, hudAdapter);
    this.nav.ensure();
    const dir = this.direction(dt);
    // up from the top row leaves the player
    if (dir && !this.nav.move(dir) && dir === 'up') { this.hudZone = false; this.nav.clear(); return; }
    if (this.pressed('a')) this.nav.activate();
    this.nav.draw();
  }

  // ------------------------------------------------------------------ panels ----
  #panel(top, dt) {
    const adapter = adapterFor(top);
    const nav = this.nav;
    if (nav.root !== top.el) { nav.setRoot(top.el, adapter); this.after = null; }
    const io = this.#io(top, adapter, dt);
    // the first touch after the keyboard only shows where the ring is
    if (this.justWoke && !this.pressed('start') && !this.pressed('b')) { nav.ensure(); nav.draw(true); adapter?.frame?.(io); return; }
    if (this.after) { const fn = this.after; this.after = null; try { fn(); } catch (e) { console.warn('[pad]', e); } }
    nav.ensure();
    adapter?.frame?.(io);
    // the buttons: the panel's own meaning first, then the common one
    for (const name of ['a', 'b', 'x', 'y', 'lb', 'rb', 'start', 'view', 'l3', 'r3']) {
      if (!this.pressed(name)) continue;
      if (adapter?.button?.(name, io)) continue;
      this.#panelButton(name, top, io);
      if (currentPanel() !== top) return;   // the panel closed or another opened
    }
    const dir = this.direction(dt, !adapter?.ownsStick);
    if (dir && !adapter?.dir?.(dir, io)) nav.move(dir);
    // the right stick scrolls (up to 1400 px a second)
    const [rx, ry, rm] = this.stick('right');
    if (rm > 0 && !adapter?.scroll?.(rx, ry, rm, io)) nav.scroll(rx * 1400 * rm, ry * 1400 * rm, dt);
    nav.draw();
  }
  #panelButton(name, top, io) {
    const nav = this.nav;
    if (name === 'a') {
      const r = nav.activate();
      if (r === 'text' && nav.el) this.osk.openFor(nav.el, { onClose: () => nav.draw() });
      return;
    }
    if (name === 'b') { this.key('Escape', 'Escape'); return; }
    if (name === 'lb' || name === 'rb') { this.#switchTab(top.el, name === 'lb' ? -1 : 1); return; }
    // the right stick pressed: a mouse pointer where the ring was (for boards and pages made for the mouse)
    if (name === 'r3') {
      const r = nav.el?.isConnected ? nav.el.getBoundingClientRect() : top.el.getBoundingClientRect();
      nav.hide();
      this.cursor.show(r.left + r.width / 2, r.top + r.height / 2);
      return;
    }
    if (name === 'start') {
      // in the menu Start goes back to where you were (its first button), elsewhere it opens the menu
      if (top.name === 'menu') top.el.querySelector('.menu-btn.primary')?.click();
      else this.ctx.openPanel('menu', {});
    }
  }
  /** LB and RB: the tab before or after the chosen one in the panel's row of tabs (sections, pages). */
  #switchTab(root, d) {
    const lists = [...root.querySelectorAll('[role="tablist"], .tabs, nav.mt-nav, nav.term-nav:not(.term-nav-apps)')].filter((l) => l.getClientRects().length && l.checkVisibility?.({ visibilityProperty: true }) !== false);
    if (!lists.length) return false;
    // the row that holds the ring, else the first one
    const list = lists.find((l) => this.nav.el && l.contains(this.nav.el)) || lists[0];
    const items = [...list.querySelectorAll('[role="tab"], .tab, .mt-navitem, .term-nav-item, :scope > button')].filter((x) => x.getClientRects().length && !x.disabled);
    if (items.length < 2) return false;
    const on = (x) => x.matches('.active, [aria-selected="true"], [aria-current="page"], .on');
    const i = items.findIndex(on);
    const next = items[clamp((i < 0 ? 0 : i) + d, 0, items.length - 1)];
    if (!next || on(next)) return false;
    const inList = this.nav.el && list.contains(this.nav.el);
    next.click();
    // the ring follows the tab when it was on the row, otherwise it starts again in the new page
    this.after = () => {
      const fresh = [...this.nav.root.querySelectorAll('[role="tablist"], .tabs, nav.mt-nav, nav.term-nav:not(.term-nav-apps)')];
      const now = fresh.flatMap((l) => [...l.querySelectorAll('[role="tab"], .tab, .mt-navitem, .term-nav-item, :scope > button')]).find((x) => x.matches('.active, [aria-selected="true"], [aria-current="page"], .on'));
      if (inList && now) this.nav.focus(now);
      else if (!this.nav.el?.isConnected) { this.nav.el = null; this.nav.last = null; this.nav.ensure(); }
    };
    return true;
  }
  /** What the panel adapters get: the pad's state of this frame and a few helpers. */
  #io(top, adapter, dt) {
    return {
      pad: this, top, dt, nav: this.nav, ctx: this.ctx, instance: top.instance, adapter,
      pressed: (n) => this.pressed(n), down: (n) => this.down(n), released: (n) => this.released(n),
      stick: (n) => this.stick(n), trigger: (n) => this.trigger(n),
      key: (code, key, extra) => this.key(code, key, extra),
      osk: this.osk,
    };
  }

  // ------------------------------------------------------------------ the department wheel ----
  #wheel(dt) {
    const wh = this.wheel;
    if (this.pressed('b')) { wh.onKey({ code: 'Escape' }); this.viewWheel = false; return; }
    if (this.pressed('a')) { wh.onKey({ code: 'Enter' }); this.viewWheel = false; return; }
    // LB or RB swap the rings (the departments, the places), as they switch the tabs in the panels
    if (this.pressed('lb') || this.pressed('rb')) { wh.toggleRing?.(); return; }
    // View held: let go to walk there, as with Tab
    if (this.viewWheel && this.released('view')) { this.viewWheel = false; wh.release(); return; }
    const dir = this.direction(dt, false);
    if (dir === 'left' || dir === 'up') wh.onKey({ code: 'ArrowLeft' });
    else if (dir === 'right' || dir === 'down') wh.onKey({ code: 'ArrowRight' });
    // a stick points at a sector (the one tilted further)
    const [lx, ly, lm] = stick(this.axes[0], this.axes[1]), [rx, ry, rm] = stick(this.axes[2], this.axes[3]);
    if (Math.max(lm, rm) > 0.5) wh.point?.(rm > lm ? rx : lx, rm > lm ? ry : ly);
  }

  // ------------------------------------------------------------------ the film in full screen ----
  #film(dt) {
    // the overlay listens on the window for its keys: K pause, J and L 10 s, Esc back
    const send = (code, key) => window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true }));
    if (this.pressed('b') || this.pressed('start')) { send('Escape', 'Escape'); return; }
    if (this.pressed('a') || this.pressed('x')) send('KeyK', 'k');
    if (this.pressed('lb')) send('KeyJ', 'j');
    if (this.pressed('rb')) send('KeyL', 'l');
    const dir = this.direction(dt);
    if (dir === 'left') send('KeyJ', 'j');
    if (dir === 'right') send('KeyL', 'l');
    if (this.pressed('y')) {
      if (mediaPlayer.state?.hasSubtitles) mediaPlayer.setSubtitles(!mediaPlayer.state.subtitles);
      this.filmFull?.poke?.();
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf); this.raf = 0; this.count = 0;
    window.removeEventListener('gamepadconnected', this.onConnect);
    window.removeEventListener('gamepaddisconnected', this.onDisconnect);
    this.nav.destroy(); this.osk.close(); this.cursor.hide();
  }
}

let instance = null;
/** Called once by main.js; without a pad it only listens for 'gamepadconnected'. */
export function initGamepad(opts) {
  if (!instance) instance = new GamepadInput(opts);
  return instance;
}
/** The running instance (tests, the settings: rumble test, live button state). */
export const gamepadInput = () => instance;
