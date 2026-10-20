// Minimal event bus shared by all modules.
export class Bus {
  constructor() { this.map = new Map(); }
  on(evt, fn) { if (!this.map.has(evt)) this.map.set(evt, new Set()); this.map.get(evt).add(fn); return () => this.off(evt, fn); }
  once(evt, fn) { const off = this.on(evt, (...a) => { off(); fn(...a); }); return off; }
  off(evt, fn) { this.map.get(evt)?.delete(fn); }
  emit(evt, ...args) { for (const fn of [...(this.map.get(evt) || [])]) { try { fn(...args); } catch (e) { console.error('[bus]', evt, e); } } }
}
export const bus = new Bus();
