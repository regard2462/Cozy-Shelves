// Full screen film: the film of the screen in the hall (or one that plays as sound) fills the window, black around
// the picture, seated or standing. Opened by F in the world when no book is aimed at, the "Vollbild" button of the
// mini player or the bus event 'media:fullscreen' (all in main.js). The one <video> moves in here ('full' mode of
// media/media-player.js, subtitles drawn by the browser) and goes back to 'screen' or 'audio' when you leave; the
// film keeps running. Where the Fullscreen API may be used, the view also covers the whole display; it works
// without it as well (hidden test windows never go full screen).
// Keys while open: Esc or F leave · K or Space pause · J/L −/+10 s · ←/→ −/+5 s. No key reaches the world.
// The controls fade out after a moment without mouse movement.
import { h } from '../core/dom.js';
import { tr } from '../core/i18n.js';
import { mediaPlayer, formatTime } from '../media/media-player.js';
import { channelLabel } from '../media/transport.js';
import { icon } from './mediathek/icons.js';

const IDLE_MS = 2600;
const T = (de, en, vars) => tr({ de, en }, vars);

export class FilmFullscreen {
  /** hooks: onOpen() / onClose() (main.js: world loop, pointer lock) · nativeFullscreen() → may the Fullscreen API be used */
  constructor({ onOpen, onClose, nativeFullscreen } = {}) {
    this.hooks = { onOpen, onClose, nativeFullscreen };
    this.open_ = false; this.native = false; this.prevMode = null; this.dragging = false; this.idleTimer = null; this.off = null;
    this.host = h('div.ff-video');
    this.spinner = h('div.ff-spinner.hidden', { 'aria-hidden': 'true' });
    this.errorText = h('p');
    this.errorBox = h('div.ff-error.hidden', this.errorText, h('button.btn.small', { onclick: () => mediaPlayer.retry() }, T('Erneut versuchen', 'Try again')));
    this.bigPlay = h('button.ff-bigplay.hidden', { 'aria-label': T('Abspielen', 'Play'), onclick: (e) => { e.stopPropagation(); mediaPlayer.resume(); } }, icon('play'));
    this.title = h('div.ff-title');
    this.sub = h('div.ff-sub');
    this.exitTop = h('button.ff-btn.ff-x', { onclick: () => this.close() }, icon('close'));
    const top = h('div.ff-top', h('div.ff-head', this.title, this.sub), this.exitTop);
    this.playBtn = h('button.ff-btn.ff-play', { onclick: () => mediaPlayer.toggle() });
    this.backBtn = h('button.ff-btn', { onclick: () => mediaPlayer.skip(-10) }, icon('back'));
    this.fwdBtn = h('button.ff-btn', { onclick: () => mediaPlayer.skip(10) }, icon('forward'));
    this.time = h('span.ff-time');
    this.played = h('i.ff-seek-played'); this.buffered = h('i.ff-seek-buffered'); this.knob = h('i.ff-seek-knob');
    this.seekBar = h('div.ff-seek', { role: 'slider', 'aria-label': T('Position', 'Position') }, this.buffered, this.played, this.knob);
    this.subsBtn = h('button.ff-btn.ff-subs', { onclick: () => mediaPlayer.setSubtitles(!mediaPlayer.state.subtitles) }, icon('subtitles'));
    this.exitBtn = h('button.ff-btn.ff-exit', { onclick: () => this.close() }, icon('shrink'), h('span.ff-exit-label'));
    const controls = h('div.ff-controls', this.seekBar, h('div.ff-row', this.playBtn, this.backBtn, this.fwdBtn, this.time, h('span.spacer'), this.subsBtn, this.exitBtn));
    // clicks on the controls must not reach the picture (pause) or anything behind the overlay
    for (const part of [top, controls, this.errorBox]) part.addEventListener('click', (e) => e.stopPropagation());
    // the controls stay while the pointer rests on them
    this.hover = false;
    for (const part of [top, controls]) {
      part.addEventListener('pointerenter', () => { this.hover = true; this.poke(); });
      part.addEventListener('pointerleave', () => { this.hover = false; this.poke(); });
    }
    this.el = h('div#film-full.hidden', { role: 'dialog', 'aria-modal': 'true', tabindex: -1 }, this.host, this.spinner, this.bigPlay, this.errorBox, top, controls);
    // the picture: a click pauses or resumes, a double click leaves the full screen
    this.el.addEventListener('click', () => { if (this.open_) mediaPlayer.toggle(); });
    this.el.addEventListener('dblclick', (e) => { if (this.open_ && !e.target.closest('.ff-controls, .ff-top, .ff-error')) this.close(); });
    this.el.addEventListener('pointermove', () => this.poke());
    // the world (main.js: a click acts, a click into the view catches the mouse) never sees what happens in here
    for (const type of ['mousedown', 'mouseup', 'pointerdown', 'wheel', 'contextmenu']) this.el.addEventListener(type, (e) => e.stopPropagation());
    this.#bindSeek();
    document.body.appendChild(this.el);
    this.onKeyEvent = (e) => this.#key(e);
    this.onFsChange = () => {
      // the browser left full screen by itself (Esc is handled by Chromium before the page sees it): leave as well
      if (this.open_ && this.native && document.fullscreenElement !== this.el) { this.native = false; this.close(); }
    };
    document.addEventListener('fullscreenchange', this.onFsChange);
  }

  get isOpen() { return this.open_; }

  /** Show the running film in full screen. false when there is no film (or it is already open). */
  open() {
    const s = mediaPlayer.state;
    if (this.open_ || !s.current) return false;
    this.prevMode = s.mode === 'screen' ? 'screen' : 'audio';
    this.open_ = true; this.hover = false; this.dragging = false;
    this.el.classList.remove('hidden', 'idle');
    this.el.setAttribute('aria-label', T('Film im Vollbild', 'Film in full screen'));
    // the focus leaves the mini player link underneath (Enter would press it again)
    try { this.el.focus({ preventScroll: true }); } catch {}
    mediaPlayer.attach(this.host, 'full');
    window.addEventListener('keydown', this.onKeyEvent, true);
    window.addEventListener('keyup', this.onKeyEvent, true);
    this.off = mediaPlayer.onChange((st) => this.#onMedia(st));
    this.#render(mediaPlayer.state);
    this.poke();
    try { this.hooks.onOpen?.(); } catch (e) { console.error('[film-full] onOpen', e); }
    // needs the key press or click that opened the view; without it (or when not allowed) the window stays as it is
    if (this.hooks.nativeFullscreen?.() && this.el.requestFullscreen) {
      this.el.requestFullscreen({ navigationUI: 'hide' }).then(() => {
        if (!this.open_) { document.exitFullscreen?.().catch(() => {}); return; }
        this.native = true;
      }).catch(() => {});
    }
    return true;
  }

  /** Leave: the film goes back to the screen (or plays on as sound). restore=false: someone else took the video. */
  close({ restore = true } = {}) {
    if (!this.open_) return false;
    this.open_ = false;
    window.removeEventListener('keydown', this.onKeyEvent, true);
    window.removeEventListener('keyup', this.onKeyEvent, true);
    this.off?.(); this.off = null;
    clearTimeout(this.idleTimer);
    this.el.classList.add('hidden');
    if (this.native || document.fullscreenElement === this.el) { this.native = false; document.exitFullscreen?.().catch(() => {}); }
    if (restore && mediaPlayer.current && mediaPlayer.mode === 'full') mediaPlayer.setMode(this.prevMode || 'audio');
    try { this.hooks.onClose?.(); } catch (e) { console.error('[film-full] onClose', e); }
    return true;
  }

  poke() {
    this.el.classList.remove('idle');
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { if (this.open_ && mediaPlayer.state.playing && !this.dragging && !this.hover) this.el.classList.add('idle'); }, IDLE_MS);
  }

  #key(e) {
    // everything is swallowed while the film fills the screen: the world must not walk, act or open panels
    e.stopImmediatePropagation(); e.stopPropagation();
    if (e.type !== 'keydown') { if (e.code === 'Space') e.preventDefault(); return; }
    const c = e.code;
    let done = true;
    if (c === 'Escape' || c === 'KeyF') { if (!e.repeat) this.close(); }
    else if (c === 'KeyK' || c === 'Space') { if (!e.repeat) mediaPlayer.toggle(); }
    else if (c === 'KeyJ') mediaPlayer.skip(-10);
    else if (c === 'KeyL') mediaPlayer.skip(10);
    else if (c === 'ArrowLeft') mediaPlayer.skip(-5);
    else if (c === 'ArrowRight') mediaPlayer.skip(5);
    else done = false;
    if (done || c === 'Tab' || c === 'F11') e.preventDefault();
    if (done && this.open_) this.poke();
  }

  #onMedia(s) {
    // stopped, ended, or another view took the video (the Mediathek panel): the full screen is over
    if (!s.current || s.mode !== 'full') { this.close({ restore: false }); return; }
    this.#render(s);
  }

  #bindSeek() {
    const bar = this.seekBar;
    const frac = (e) => { const r = bar.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
    const dur = () => { const s = mediaPlayer.state; return !s.live && isFinite(s.duration) && s.duration > 0 ? s.duration : 0; };
    const show = (f) => { this.played.style.width = f * 100 + '%'; this.knob.style.left = f * 100 + '%'; };
    bar.addEventListener('pointerdown', (e) => { if (!dur()) return; this.dragging = true; try { bar.setPointerCapture(e.pointerId); } catch {} show(frac(e)); });
    bar.addEventListener('pointermove', (e) => { if (this.dragging) show(frac(e)); });
    bar.addEventListener('pointerup', (e) => { if (!this.dragging) return; this.dragging = false; const d = dur(); if (d) mediaPlayer.seek(frac(e) * d); this.poke(); });
    bar.addEventListener('pointercancel', () => { this.dragging = false; });
  }

  #render(s) {
    const c = s.current;
    if (!c) return;
    const live = !!s.live;
    const d = !live && isFinite(s.duration) && s.duration > 0 ? s.duration : 0;
    // live TV: the programme that runs now, the channel below it
    const title = (live && c.now) || c.title || '';
    if (this.title.textContent !== title) this.title.textContent = title;
    const sub = [channelLabel(c), live ? T('Live', 'Live') : (c.topic && c.topic !== c.title ? c.topic : '')].filter(Boolean).join(' · ');
    if (this.sub.textContent !== sub) this.sub.textContent = sub;
    this.el.classList.toggle('playing', !!s.playing);
    this.spinner.classList.toggle('hidden', !(s.buffering && !s.error));
    this.errorBox.classList.toggle('hidden', !s.error);
    if (s.error && this.errorText.textContent !== s.error) this.errorText.textContent = s.error;
    this.bigPlay.classList.toggle('hidden', !!(s.playing || s.buffering || s.error));
    const playIcon = s.playing ? 'pause' : 'play';
    if (this.playBtn._icon !== playIcon) { this.playBtn._icon = playIcon; this.playBtn.replaceChildren(icon(playIcon)); }
    this.playBtn.title = s.playing ? T('Pause (K oder Leertaste)', 'Pause (K or space)') : T('Abspielen (K oder Leertaste)', 'Play (K or space)');
    this.backBtn.title = T('10 Sekunden zurück (J)', 'Back 10 seconds (J)');
    this.fwdBtn.title = T('10 Sekunden vor (L)', 'Forward 10 seconds (L)');
    this.backBtn.disabled = live; this.fwdBtn.disabled = live;
    this.time.textContent = live ? T('live', 'live') : d ? `${formatTime(s.position)} / ${formatTime(d)}` : formatTime(s.position);
    if (!this.dragging) { const f = d ? Math.min(1, s.position / d) : 0; this.played.style.width = f * 100 + '%'; this.knob.style.left = f * 100 + '%'; }
    this.buffered.style.width = (d ? Math.min(100, (s.buffered / d) * 100) : 0) + '%';
    this.seekBar.classList.toggle('disabled', live || !d);
    this.subsBtn.classList.toggle('hidden', !s.hasSubtitles);
    this.subsBtn.classList.toggle('on', !!s.subtitles);
    this.subsBtn.setAttribute('aria-pressed', String(!!s.subtitles));
    this.subsBtn.title = s.subtitles ? T('Untertitel aus', 'Subtitles off') : T('Untertitel an', 'Subtitles on');
    const exit = T('Vollbild verlassen', 'Leave full screen');
    this.exitBtn.title = exit + ' (Esc, F)'; this.exitTop.title = exit + ' (Esc)';
    const label = this.exitBtn.querySelector('.ff-exit-label');
    if (label.textContent !== exit) label.textContent = exit;
    if (!s.playing) this.el.classList.remove('idle');
  }
}
export default FilmFullscreen;
