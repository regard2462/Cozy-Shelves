// Playback of the user's own music files (HTMLAudioElement → MediaElementSource → music bus).
// One <audio> element is reused for all tracks; positions are remembered per track id.
import { fadeTo } from './dsp.js';

export class UserPlayer {
  constructor() {
    this.el = null; this.src = null; this.gain = null; this.ctx = null;
    this.positions = {}; this.current = null; this.onEnded = null; this.onError = null; this.playing = false;
  }
  attach(ctx, dest) {
    if (this.ctx === ctx) return;
    this.ctx = ctx;
    if (!this.el) {
      this.el = new Audio();
      this.el.preload = 'auto';
      this.el.addEventListener('ended', () => { this.playing = false; this.onEnded?.(this.current); });
      this.el.addEventListener('error', () => { this.playing = false; this.onError?.(this.current, this.el.error); });
    }
    try {
      this.src = ctx.createMediaElementSource(this.el);
      this.gain = ctx.createGain(); this.gain.gain.value = 0;
      this.src.connect(this.gain); this.gain.connect(dest);
      this.routed = true;
    } catch (e) { // element already bound to another context – fall back to plain element playback
      console.warn('[audio] media element routing failed', e); this.routed = false;
    }
  }
  _savePos() { if (this.current && this.el && !this.el.ended && this.el.currentTime > 2 && this.el.duration - this.el.currentTime > 5) this.positions[this.current.id] = this.el.currentTime; else if (this.current) delete this.positions[this.current.id]; }
  async play(track, { fade = 2 } = {}) {
    if (!this.el) return false;
    const t = this.ctx?.currentTime ?? 0;
    if (this.current && this.current.id !== track.id) this._savePos();
    if (this.current?.id !== track.id) {
      this.current = track;
      this.el.src = track.url;
      const pos = this.positions[track.id] || 0;
      if (pos) { const seek = () => { try { this.el.currentTime = pos; } catch (e) { /* */ } }; if (this.el.readyState >= 1) seek(); else this.el.addEventListener('loadedmetadata', seek, { once: true }); }
    }
    this.playing = true;
    if (this.gain) fadeTo(this.gain.gain, 1, t, fade);
    if (!this.routed) this.el.volume = 1;
    try { await this.el.play(); return true; } catch (e) { console.warn('[audio] play failed', e); this.playing = false; return false; }
  }
  stop({ fade = 2 } = {}) {
    if (!this.el || !this.current) return;
    const t = this.ctx?.currentTime ?? 0;
    this._savePos();
    this.playing = false;
    if (this.gain) fadeTo(this.gain.gain, 0, t, fade);
    const el = this.el, cur = this.current;
    setTimeout(() => { if (!this.playing && this.current === cur) { try { el.pause(); } catch (e) { /* */ } } }, fade * 1000 + 50);
  }
  pause() { if (this.el && this.playing) { this._savePos(); try { this.el.pause(); } catch (e) { /* */ } } }
  resume() { if (this.el && this.playing) this.el.play().catch(() => {}); }
  get position() { return this.el ? this.el.currentTime : 0; }
  get duration() { return this.el ? this.el.duration || 0 : 0; }
}
