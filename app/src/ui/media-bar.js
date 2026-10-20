// HUD mini player for films (Mediathek / live TV) and podcasts. It shows the active source (media/transport.js:
// the one that started last and still has something loaded) with play/pause, skipping, the position and its actions:
//   film in 'audio' or 'screen' mode: ±10 s, a switch between listening and the screen, full screen, the panel
//   podcast: artwork, episode and show, ±15 s, the podcast panel
//   audiobook: cover, title, author and chapter, 15 s back and 30 s forward, the sleep timer, the panel "Hörbücher"
// It sits bottom right (bottom left is the basket, top right the clock, bottom centre the hints).
// In the world the mouse turns the view, so every action has a key, and each button shows its key cap
// (handled in main.js): K pause · J/L back/forward · P onto the screen / sound only · F full screen · O in the window
// (film) or the podcasts · X stop · V Mediathek. The buttons still work with the mouse when it is free.
// While the film is on the screen and subtitles are on, their text is shown as a line above the hints
// (the WebGL texture of the screen carries no subtitles).
import { h } from '../core/dom.js';
import { tr } from '../core/i18n.js';
import { mediaPlayer, formatTime } from '../media/media-player.js';
import { podcastPlayer } from './podcasts/player.js';
import { activeTransport, onTransportChange, channelLabel } from '../media/transport.js';
import { audiobookPlayer } from './audiobooks/ab-player.js';
import { coverUrl as audiobookCover, chapterName, sleepText } from './audiobooks/ab-format.js';
import { fillGlyphs, padState } from '../input/pad-hints.js';

/**
 * The mini player's actions, for its buttons and for the keys in the world (main.js): 'screen' (P: the film onto the
 * screen in the hall, from there back to sound only), 'window' (O: the film in the Mediathek, a podcast in the
 * podcasts), 'stop' (X). True when there was something to do.
 */
export function mediaAction(name, ctx) {
  const tp = activeTransport();
  if (!tp) return false;
  if (name === 'stop') { tp.stop(); return true; }
  if (name === 'window') {
    if (tp.id === 'podcast') ctx.openPanel('podcasts', {});
    else if (tp.id === 'audiobook') ctx.openPanel('audiobooks', { show: 'player' });
    else ctx.openPanel('mediathek', { show: 'player' });
    return true;
  }
  if (name === 'screen') {
    if (tp.id !== 'film' || !mediaPlayer.current) return false;
    if (mediaPlayer.mode === 'screen') { mediaPlayer.setMode('audio'); return true; }
    if (mediaPlayer.mode !== 'audio') return false;
    mediaPlayer.setMode('screen');
    ctx.bus?.emit('cinema:watch');
    return true;
  }
  return false;
}

export class MediaBar {
  constructor(root, ctx) {
    this.ctx = ctx; this.root = root;
    const T = (de, en) => tr({ de, en });
    this.T = T;
    this.icon = h('span.mb-icon', { 'aria-hidden': 'true' });
    this.channel = h('span.mb-channel');
    this.title = h('div.mb-title');
    this.sub = h('div.mb-sub');
    this.playBtn = h('button.mb-btn.mb-play', { onclick: () => activeTransport()?.toggle() });
    this.backBtn = h('button.mb-btn', { onclick: () => this.skip(-1) }, '↺');
    this.fwdBtn = h('button.mb-btn', { onclick: () => this.skip(1) }, '↻');
    this.fill = h('i');
    this.buf = h('b');
    this.progress = h('div.mb-progress', { onclick: (e) => this.seekFromClick(e) }, this.buf, this.fill);
    this.time = h('span.mb-time');
    // the actions, each with its key cap (the label is the .mb-label inside)
    this.modeBtn = keyButton('P', () => mediaAction('screen', ctx));
    this.fullBtn = keyButton('F', () => this.ctx.bus?.emit('media:fullscreen'), 'mb-link.mb-full');
    this.panelBtn = keyButton('O', () => mediaAction('window', ctx));
    this.stopBtn = keyButton('X', () => mediaAction('stop', ctx));
    // the transport keys and the Mediathek, below the actions
    this.pauseKey = keyButton('K', () => activeTransport()?.toggle(), 'mb-key');
    this.skipKey = keyButton(['J', 'L'], null, 'mb-key');
    this.mediathekKey = keyButton('V', () => this.ctx.openPanel('mediathek', {}), 'mb-key');
    this.foot = h('div.mb-row.mb-foot');
    this.keys = h('div.mb-keys');
    // with a gamepad: the D-pad seeks, down leads into the player's buttons (input/gamepad.js)
    this.padKeys = h('div.mb-padkeys');
    this.error = h('div.mb-error.hidden');
    this.el = h('div#media-bar.hidden', { role: 'region' },
      h('div.mb-row', this.icon, h('div.mb-text', h('div.mb-head', this.channel, this.title), this.sub), this.backBtn, this.playBtn, this.fwdBtn),
      h('div.mb-row.mb-line', this.progress, this.time),
      this.error,
      this.foot,
      this.keys,
      this.padKeys);
    this.subs = h('div#media-subs.hidden', { 'aria-live': 'polite' });
    root.appendChild(this.el);
    root.appendChild(this.subs);
    // its height as --mb-h on the HUD: the book card on the right fits itself in above it (hud.css)
    this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
      const hgt = Math.round(entries[0]?.borderBoxSize?.[0]?.blockSize ?? this.el.offsetHeight);
      if (hgt > 0 && hgt !== this.barHeight) { this.barHeight = hgt; root.style.setProperty('--mb-h', hgt + 'px'); }
    }) : null;
    this.ro?.observe(this.el);
    this.off = onTransportChange(() => this.render());
    this.offLang = ctx.bus?.on?.('i18n:change', () => { this.footKey = null; this.keysKey = null; this.padKey = null; this.render(); });
    this.offDevice = ctx.bus?.on?.('input:device', () => { this.padKey = null; this.render(); });
    this.render();
  }
  destroy() { this.off?.(); this.offLang?.(); this.offDevice?.(); this.ro?.disconnect(); this.el.remove(); this.subs.remove(); }

  skip(dir) { const tp = activeTransport(); if (tp) tp.skip(dir < 0 ? -(tp.back || tp.step) : (tp.fwd || tp.step)); }
  seekFromClick(e) {
    const tp = activeTransport();
    const info = tp?.info();
    if (!info || !info.duration || info.live) return;
    const r = this.progress.getBoundingClientRect();
    tp.seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * info.duration);
  }

  render() {
    const tp = activeTransport();
    const film = tp?.id === 'film' ? mediaPlayer.state : null;
    const pod = tp?.id === 'podcast' ? podcastPlayer.state : null;
    const book = tp?.id === 'audiobook' ? audiobookPlayer.state : null;
    // a film is visible anyway in the panel and in full screen: here only while it plays as sound or on the screen
    const show = !!pod?.current || !!book?.book || (!!film?.current && (film.mode === 'audio' || film.mode === 'screen'));
    this.el.classList.toggle('hidden', !show);
    // the book card on the right keeps clear of the mini player (hud.css)
    if (this.shown !== show) { this.shown = show; this.root.classList.toggle('has-media-bar', show); }
    const subs = show && !!film && film.mode === 'screen' && film.subtitles && film.cue;
    this.subs.classList.toggle('hidden', !subs);
    if (subs && this.subs.textContent !== film.cue) this.subs.textContent = film.cue;
    if (!show) return;
    const info = tp.info();
    if (pod) this.#renderPodcast(pod, info); else if (book) this.#renderAudiobook(book, info); else this.#renderFilm(film, info);
    // shared: play button, time and progress
    const T = this.T;
    this.el.classList.toggle('busy', !!info.buffering && !info.error);
    this.playBtn.textContent = info.playing ? '❚❚' : '▶';
    this.playBtn.title = info.playing ? T('Pause (K)', 'Pause (K)') : T('Weiter (K)', 'Play (K)');
    setLabel(this.pauseKey, info.playing ? T('Pause', 'Pause') : T('Weiter', 'Play'));
    // time: position / length; only the running time when the length is unknown; "live" for streams
    const dur = info.duration;
    this.time.textContent = info.live ? T('live', 'live') : dur ? `${formatTime(info.position)} / ${formatTime(dur)}` : formatTime(info.position);
    this.fill.style.width = (info.live ? 100 : dur ? Math.min(100, (info.position / dur) * 100) : 0) + '%';
    this.progress.classList.toggle('disabled', info.live || !dur);
    this.progress.title = info.live || !dur ? '' : T('Zur Stelle springen', 'Jump to position');
    this.error.classList.toggle('hidden', !info.error);
    if (info.error && this.error.textContent !== info.error) this.error.textContent = info.error;
  }

  #renderFilm(s, info) {
    const T = this.T;
    const c = s.current;
    const live = info.live;
    this.el.classList.remove('podcast', 'audiobook');
    this.el.classList.toggle('screen', s.mode === 'screen');
    this.el.classList.toggle('live', live);
    this.el.setAttribute('aria-label', T('Film', 'Film'));
    this.#setIcon('text', s.mode === 'screen' ? '▣' : '♫');
    this.icon.title = s.mode === 'screen' ? T('Auf der Leinwand', 'On the screen') : T('Nur Ton', 'Audio only');
    const ch = channelLabel(c);
    this.channel.textContent = ch;
    this.channel.classList.toggle('hidden', !ch || ch === c.title);
    if (this.title.textContent !== (c.title || '')) { this.title.textContent = c.title || ''; this.title.title = c.title || ''; }
    const bits = [];
    if (live) bits.push(c.now || T('Live', 'Live'));
    else if (c.topic && c.topic !== c.title) bits.push(c.topic);
    if (c.local) bits.push(T('heruntergeladen', 'downloaded'));
    this.sub.textContent = bits.join(' · ');
    this.backBtn.title = T('10 Sekunden zurück (J)', 'Back 10 seconds (J)');
    this.fwdBtn.title = T('10 Sekunden vor (L)', 'Forward 10 seconds (L)');
    this.backBtn.disabled = live; this.fwdBtn.disabled = live;
    this.buf.style.width = (!live && info.duration ? Math.min(100, (s.buffered / info.duration) * 100) : 0) + '%';
    setLabel(this.modeBtn, s.mode === 'screen' ? T('Nur Ton', 'Audio only') : T('Auf die Leinwand', 'To the screen'),
      s.mode === 'screen' ? T('Leinwand einrollen und weiter zuhören (P)', 'Roll up the screen and keep listening (P)') : T('Den Film auf der Leinwand in der Halle zeigen (P)', 'Show the film on the screen in the hall (P)'));
    setLabel(this.fullBtn, T('Vollbild', 'Full screen'), T('Den Film im Vollbild ansehen (F)', 'Watch the film in full screen (F)'));
    setLabel(this.panelBtn, T('Im Fenster', 'In a window'), T('Den Film in der Mediathek ansehen (O)', 'Watch the film in the Mediathek (O)'));
    setLabel(this.stopBtn, T('Beenden', 'Stop'), T('Film beenden (X)', 'Stop the film (X)'));
    this.#foot('film', [this.modeBtn, this.fullBtn, this.panelBtn, this.stopBtn]);
    setLabel(this.skipKey, T('10 s', '10 s'), T('10 Sekunden zurück (J) oder vor (L)', '10 seconds back (J) or forward (L)'));
    setLabel(this.mediathekKey, T('Mediathek', 'Mediathek'), T('Mediathek öffnen (V)', 'Open the Mediathek (V)'));
    this.pauseKey.title = T('Anhalten und fortsetzen (K)', 'Pause and play (K)');
    this.#keys(live ? 'film-live' : 'film', live ? [this.pauseKey, this.mediathekKey] : [this.pauseKey, this.skipKey, this.mediathekKey]);
    this.#padKeys(live ? null : T('10 s', '10 s'));
  }

  #renderPodcast(s, info) {
    const T = this.T;
    this.el.classList.add('podcast');
    this.el.classList.remove('screen', 'live', 'audiobook');
    this.el.setAttribute('aria-label', T('Podcast', 'Podcast'));
    if (info.artwork) this.#setIcon('img', info.artwork); else this.#setIcon('text', '🎙');
    this.icon.title = T('Podcast', 'Podcast');
    this.channel.textContent = ''; this.channel.classList.add('hidden');
    if (this.title.textContent !== info.title) { this.title.textContent = info.title; this.title.title = info.title; }
    this.sub.textContent = info.artist;
    this.backBtn.title = T('15 Sekunden zurück (J)', 'Back 15 seconds (J)');
    this.fwdBtn.title = T('15 Sekunden vor (L)', 'Forward 15 seconds (L)');
    this.backBtn.disabled = false; this.fwdBtn.disabled = false;
    this.buf.style.width = '0%';
    setLabel(this.panelBtn, T('Podcasts', 'Podcasts'), T('Die Podcasts öffnen (O)', 'Open the podcasts (O)'));
    setLabel(this.stopBtn, T('Beenden', 'Stop'), T('Podcast beenden (X)', 'Stop the podcast (X)'));
    this.#foot('podcast', [this.panelBtn, this.stopBtn]);
    setLabel(this.skipKey, T('15 s', '15 s'), T('15 Sekunden zurück (J) oder vor (L)', '15 seconds back (J) or forward (L)'));
    this.pauseKey.title = T('Anhalten und fortsetzen (K)', 'Pause and play (K)');
    this.#keys('podcast', [this.pauseKey, this.skipKey]);
    this.#padKeys(T('15 s', '15 s'));
  }

  #renderAudiobook(s, info) {
    const T = this.T, b = s.book;
    this.el.classList.add('podcast', 'audiobook');
    this.el.classList.remove('screen', 'live');
    this.el.setAttribute('aria-label', T('Hörbuch', 'Audiobook'));
    this.#setIcon('img', audiobookCover(b, 'thumb'));
    this.icon.title = T('Hörbuch', 'Audiobook');
    this.channel.textContent = ''; this.channel.classList.add('hidden');
    if (this.title.textContent !== info.title) { this.title.textContent = info.title; this.title.title = info.title; }
    // the author, the chapter and a sleep timer that runs
    const bits = [];
    if (b.author) bits.push(b.author);
    if (s.chapter >= 0 && b.chapters?.length > 1) bits.push(chapterName(b.chapters[s.chapter], s.chapter));
    if (s.sleep) bits.push('☾ ' + sleepText(s.sleep));
    this.sub.textContent = bits.join(' · ');
    this.backBtn.title = T('15 Sekunden zurück (J)', 'Back 15 seconds (J)');
    this.fwdBtn.title = T('30 Sekunden vor (L)', 'Forward 30 seconds (L)');
    this.backBtn.disabled = false; this.fwdBtn.disabled = false;
    this.buf.style.width = '0%';
    setLabel(this.panelBtn, T('Hörbücher', 'Audiobooks'), T('Den Player der Hörbücher öffnen (O)', 'Open the audiobook player (O)'));
    setLabel(this.stopBtn, T('Beenden', 'Stop'), T('Hörbuch beenden (X)', 'Stop the audiobook (X)'));
    this.#foot('audiobook', [this.panelBtn, this.stopBtn]);
    setLabel(this.skipKey, T('15 s · 30 s', '15 s · 30 s'), T('15 Sekunden zurück (J) oder 30 Sekunden vor (L)', '15 seconds back (J) or 30 seconds forward (L)'));
    this.pauseKey.title = T('Anhalten und fortsetzen (K)', 'Pause and play (K)');
    this.#keys('audiobook', [this.pauseKey, this.skipKey]);
    // the pad's row as well: without it the row kept the film's "10 s" or stayed an empty strip with a rule above it
    this.#padKeys(T('15 s · 30 s', '15 s · 30 s'));
  }

  /** The row of actions under the progress bar, rebuilt only when the source changes. */
  #foot(key, buttons) {
    if (this.footKey === key) return;
    this.footKey = key;
    this.foot.replaceChildren(...buttons);
  }
  /** The row with the transport keys and the Mediathek. */
  #keys(key, items) {
    if (this.keysKey === key) return;
    this.keysKey = key;
    this.keys.replaceChildren(...items);
  }
  /** The gamepad's row (shown instead of the keys while the pad is in use): ◀▶ seek, ▼ into the player's buttons. */
  #padKeys(skip) {
    if (!padState.active) return;
    const key = `${skip}|${padState.family}`;
    if (this.padKey === key) return;
    this.padKey = key;
    const item = (glyph, label) => `<span class="mb-key">${glyph}<span class="mb-label">${label}</span></span>`;
    this.padKeys.innerHTML = fillGlyphs((skip ? item('{DPAD_H}', skip) : '') + item('{DPAD_DOWN}', this.T('Bedienen', 'Controls')));
  }
  /** A glyph (film: ▣ screen, ♫ sound) or the podcast's artwork (an audiobook's cover). */
  #setIcon(kind, value) {
    const key = kind + ':' + value;
    if (this.iconKey === key) return;
    this.iconKey = key;
    this.icon.replaceChildren();
    if (kind !== 'img') { this.icon.textContent = value; return; }
    const img = h('img', { src: value, alt: '', draggable: false });
    img.addEventListener('error', () => { if (this.iconKey === key) { img.remove(); this.icon.textContent = '🎙'; } }, { once: true });
    this.icon.appendChild(img);
  }
}

/** A button with its key cap(s) in front of the label; without an action a plain legend entry. */
function keyButton(keys, onclick, cls = 'mb-link') {
  const caps = [].concat(keys).map((k) => h('kbd', k));
  const label = h('span.mb-label');
  return onclick ? h('button.' + cls, { type: 'button', onclick }, ...caps, label) : h('span.' + cls, ...caps, label);
}
function setLabel(el, text, title) {
  const label = el.querySelector('.mb-label');
  if (label.textContent !== text) label.textContent = text;
  if (title != null && el.title !== title) el.title = title;
}
export default MediaBar;
