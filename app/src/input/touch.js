// Touch input for the world (the browser version on a phone or a tablet, the Android app later): the hooks, not the
// on-screen controls. Pointer events on the world's canvas:
//   • a finger on the right half (or anywhere, when no stick is attached) drags the view: yaw and pitch
//   • a short tap without movement uses what the crosshair rests on (like E, or a click)
//   • a virtual stick (the Android strand draws one) feeds player.pad like the gamepad's left stick: { x, y, run }
// The mouse keeps its pointer lock; touch never locks the pointer. Nothing here renders anything.
//
//   const touch = new TouchInput(canvas, world, { onUse: () => world.actions.act('E'), onMenu: () => … });
//   touch.stick.set(x, y, run)   // -1 … 1 each, from an on-screen stick; (0, 0) releases
//   touch.enabled = false        // while a panel is open
//   touch.dispose()
const TAP_MS = 280, TAP_PX = 10;

export class TouchInput {
  constructor(canvas, world, { onUse = null, lookSpeed = 0.0045 } = {}) {
    this.canvas = canvas; this.world = world; this.onUse = onUse;
    this.lookSpeed = lookSpeed;
    this.enabled = true;
    this.look = null;          // the finger that looks around: { id, x, y, t, moved }
    this.active = false;       // a touch has been used (the HUD can hide the mouse hints)
    this.stick = { x: 0, y: 0, run: false, set: (x, y, run = false) => this.#setStick(x, y, run) };
    this._down = (e) => this.#down(e);
    this._move = (e) => this.#move(e);
    this._up = (e) => this.#up(e);
    canvas.addEventListener('pointerdown', this._down);
    canvas.addEventListener('pointermove', this._move);
    canvas.addEventListener('pointerup', this._up);
    canvas.addEventListener('pointercancel', this._up);
    // the browser must not scroll, zoom or select while a finger steers the world
    this._prevTouchAction = canvas.style.touchAction;
    canvas.style.touchAction = 'none';
  }
  #player() { return this.world?.player || null; }
  #down(e) {
    if (e.pointerType !== 'touch' || !this.enabled) return;
    this.active = true;
    if (this.look) return;     // a second finger: the stick's or ignored
    this.look = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    try { this.canvas.setPointerCapture(e.pointerId); } catch {}
  }
  #move(e) {
    const l = this.look;
    if (!l || e.pointerId !== l.id || !this.enabled) return;
    const dx = e.clientX - l.x, dy = e.clientY - l.y;
    if (!l.moved && Math.hypot(e.clientX - l.x, e.clientY - l.y) < TAP_PX) return;
    l.moved = true;
    const p = this.#player();
    if (p && p.enabled) {
      p.yaw -= dx * this.lookSpeed * (p.sensitivity || 1);
      p.pitch = Math.max(-1.35, Math.min(1.35, p.pitch - dy * this.lookSpeed * (p.sensitivity || 1)));
    }
    l.x = e.clientX; l.y = e.clientY;
  }
  #up(e) {
    const l = this.look;
    if (!l || e.pointerId !== l.id) return;
    this.look = null;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch {}
    if (!this.enabled) return;
    if (!l.moved && performance.now() - l.t < TAP_MS && e.type === 'pointerup') this.onUse?.();
  }
  #setStick(x, y, run) {
    const p = this.#player();
    this.stick.x = x; this.stick.y = y; this.stick.run = !!run;
    if (!p) return;
    // player.pad is the gamepad's left stick (input/gamepad.js); the stick of the screen takes the same slot while
    // it is pressed and gives it back when released, so a gamepad that is connected too keeps working
    if (x || y) { this._padSet = { x, y, run: !!run }; p.pad = this._padSet; }
    else if (this._padSet && p.pad === this._padSet) { p.pad = null; this._padSet = null; }
  }
  dispose() {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this._down);
    c.removeEventListener('pointermove', this._move);
    c.removeEventListener('pointerup', this._up);
    c.removeEventListener('pointercancel', this._up);
    c.style.touchAction = this._prevTouchAction || '';
    this.stick.set(0, 0, false);
  }
}
