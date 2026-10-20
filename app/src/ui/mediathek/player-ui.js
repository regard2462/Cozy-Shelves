// The film stage of the Mediathek panel: the one <video> of mediaPlayer plus custom controls
// (play/pause, ±10 s, seek bar, time, volume, quality, subtitles, screen, audio only, fullscreen inside
// the panel). Keys: Space/K pause · J/L ±10 s · ←/→ ±5 s · F fullscreen · M mute · Q quality (see onKey).
import { h, clear } from '../../core/dom.js';
import { tr } from '../../core/i18n.js';
import { mediaPlayer, formatTime } from '../../media/media-player.js';
import { qualityName } from './format.js';
import { icon } from './icons.js';

/** Swap the icon of a button (the one .mt-ico child). */
function setIcon(btn, name) {
  if (btn._icon === name) return;
  btn._icon = name;
  const old = btn.querySelector('.mt-ico');
  const next = icon(name);
  if (old) old.replaceWith(next); else btn.prepend(next);
}

const T = (de, en, vars) => tr({ de, en }, vars);
const IDLE_MS = 2600;

export function createStage({ onScreen, onAudio, onFullscreen }) {
  const videoHost = h('div.mt-video-host');
  const posterHost = h('div.mt-stage-poster');
  const spinner = h('div.mt-spinner.hidden', { 'aria-hidden': 'true' });
  const errorText = h('p');
  const errorBox = h('div.mt-stage-error.hidden', h('div.mt-stage-error-icon', '!'), errorText,
    h('button.btn.small', { onclick: () => mediaPlayer.retry() }, T('Erneut versuchen', 'Try again')));
  const bigPlay = h('button.mt-bigplay.hidden', { 'aria-label': T('Abspielen', 'Play'), onclick: (e) => { e.stopPropagation(); mediaPlayer.resume(); } }, icon('play'));

  // ---- controls ----
  const playBtn = h('button.mt-cbtn.mt-cplay', { onclick: () => mediaPlayer.toggle() });
  const backBtn = h('button.mt-cbtn', { title: T('10 Sekunden zurück (J)', 'Back 10 seconds (J)'), onclick: () => mediaPlayer.skip(-10) }, icon('back'));
  const fwdBtn = h('button.mt-cbtn', { title: T('10 Sekunden vor (L)', 'Forward 10 seconds (L)'), onclick: () => mediaPlayer.skip(10) }, icon('forward'));
  const time = h('span.mt-ctime');
  const played = h('i.mt-seek-played'), buffered = h('i.mt-seek-buffered'), knob = h('i.mt-seek-knob'), tip = h('span.mt-seek-tip.hidden');
  const seek = h('div.mt-seek', { role: 'slider', tabindex: -1, 'aria-label': T('Position', 'Position') }, buffered, played, knob, tip);
  const muteBtn = h('button.mt-cbtn', { onclick: () => mediaPlayer.toggleMute() });
  const volume = h('input.range.mt-vol', { type: 'range', min: 0, max: 1, step: 0.02, value: mediaPlayer.state.volume, 'aria-label': T('Lautstärke', 'Volume'), oninput: () => mediaPlayer.setVolume(parseFloat(volume.value)) });
  const qualityBtn = h('button.mt-cbtn.mt-ctext', { title: T('Qualität', 'Quality'), onclick: (e) => { e.stopPropagation(); toggleMenu(); } });
  const qualityMenu = h('div.mt-qmenu.hidden', { role: 'menu' });
  const subsBtn = h('button.mt-cbtn', { title: T('Untertitel', 'Subtitles'), onclick: () => mediaPlayer.setSubtitles(!mediaPlayer.state.subtitles) }, icon('subtitles'));
  const screenBtn = h('button.mt-cbtn.mt-ctext', { title: T('Auf der Leinwand in der Halle zeigen', 'Show on the screen in the hall'), onclick: () => onScreen?.() }, icon('screen'), h('span', T('Leinwand', 'Screen')));
  const audioBtn = h('button.mt-cbtn.mt-ctext', { title: T('Nur den Ton hören, auch bei geschlossenem Fenster', 'Listen only, also with the window closed'), onclick: () => onAudio?.() }, icon('headphones'), h('span', T('Nur Ton', 'Audio')));
  const fullBtn = h('button.mt-cbtn', { onclick: () => toggleFullscreen() });
  const liveBadge = h('span.mt-clive.hidden', h('i'), 'LIVE');
  const controls = h('div.mt-controls', { onclick: (e) => e.stopPropagation(), ondblclick: (e) => e.stopPropagation() },
    seek,
    h('div.mt-crow', playBtn, backBtn, fwdBtn, liveBadge, time, h('span.spacer'), muteBtn, volume, h('span.mt-qwrap', qualityBtn, qualityMenu), subsBtn, screenBtn, audioBtn, fullBtn));

  const el = h('div.mt-stage', { tabindex: -1, onclick: () => { if (mediaPlayer.current && mediaPlayer.mode === 'panel') mediaPlayer.toggle(); }, ondblclick: () => toggleFullscreen() },
    posterHost, videoHost, spinner, bigPlay, errorBox, controls);

  let full = false, idleTimer = null, dragging = false, off = null, attached = false;
  const poke = () => {
    el.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (mediaPlayer.state.playing && !dragging && qualityMenu.classList.contains('hidden')) el.classList.add('idle'); }, IDLE_MS);
  };
  el.addEventListener('pointermove', poke);
  el.addEventListener('focusin', poke);

  // ---- seeking: click or drag on the bar ----
  const frac = (e) => { const r = seek.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  const durNow = () => { const s = mediaPlayer.state; return isFinite(s.duration) && s.duration > 0 && !s.live ? s.duration : 0; };
  seek.addEventListener('pointerdown', (e) => {
    const d = durNow(); if (!d) return;
    dragging = true; seek.setPointerCapture(e.pointerId);
    const f = frac(e); played.style.width = f * 100 + '%'; knob.style.left = f * 100 + '%';
  });
  seek.addEventListener('pointermove', (e) => {
    const d = durNow(); if (!d) { tip.classList.add('hidden'); return; }
    const f = frac(e);
    tip.textContent = formatTime(f * d); tip.style.left = f * 100 + '%'; tip.classList.remove('hidden');
    if (dragging) { played.style.width = f * 100 + '%'; knob.style.left = f * 100 + '%'; }
  });
  seek.addEventListener('pointerleave', () => { if (!dragging) tip.classList.add('hidden'); });
  const endDrag = (e) => { if (!dragging) return; dragging = false; const d = durNow(); if (d) mediaPlayer.seek(frac(e) * d); tip.classList.add('hidden'); };
  seek.addEventListener('pointerup', endDrag);
  seek.addEventListener('pointercancel', () => { dragging = false; });

  /** Which entry of the menu is chosen: 'auto', or the size that plays (a preferred height of the settings means the
   *  closest size, and that is the one playing). */
  const chosenId = (s) => (s.choice === 'auto' || s.choice == null ? 'auto' : s.quality || s.choice);
  /** The quick switch: the picture sizes this film offers ("1080p", "720p" …), biggest first, the chosen one marked.
   *  It applies to the running film; new films start with the setting (Einstellungen → Mediathek). */
  function toggleMenu(force) {
    const open = force ?? qualityMenu.classList.contains('hidden');
    qualityMenu.classList.toggle('hidden', !open);
    if (open) {
      clear(qualityMenu);
      const s = mediaPlayer.state;
      const chosen = chosenId(s);
      qualityMenu.appendChild(h('div.mt-qhead', T('Videoqualität', 'Video quality')));
      for (const q of s.qualities) {
        const name = q.id === 'auto' ? T('Automatisch', 'Automatic') : qualityName(q.id, q.height);
        const now = q.id === 'auto' && chosen === 'auto' && s.height ? h('span.mt-qnow', `${s.height}p`) : null;
        qualityMenu.appendChild(h('button.mt-qitem', { role: 'menuitemradio', 'aria-checked': String(q.id === chosen), class: q.id === chosen ? 'on' : '', dataset: { q: q.id, height: q.height || '' }, onclick: () => { mediaPlayer.setQuality(q.id); toggleMenu(false); } }, name, now));
      }
      setTimeout(() => qualityMenu.querySelector('.mt-qitem.on')?.focus({ preventScroll: true }), 0);
    }
    return open;
  }
  /** "Auto · 720p", "1080p" … on the button: the size of the picture that plays. */
  function qualityLabel(s) {
    const size = s.height ? `${s.height}p` : '';
    if (chosenId(s) === 'auto') return size ? `${T('Auto', 'Auto')} · ${size}` : T('Auto', 'Auto');
    return size || qualityName(s.quality);
  }

  function toggleFullscreen(force) {
    full = force ?? !full;
    el.classList.toggle('full', full);
    onFullscreen?.(full);
    poke();
  }

  function render(s) {
    const mine = !!s.current && s.mode === 'panel' && attached;
    el.classList.toggle('playing', mine && s.playing);
    el.classList.toggle('active', mine);
    const d = isFinite(s.duration) && s.duration > 0 ? s.duration : 0;
    const live = !!s.live;
    spinner.classList.toggle('hidden', !(mine && s.buffering && !s.error));
    errorBox.classList.toggle('hidden', !(mine && s.error));
    if (mine && s.error) errorText.textContent = s.error;
    bigPlay.classList.toggle('hidden', !(mine && !s.playing && !s.buffering && !s.error));
    setIcon(playBtn, s.playing ? 'pause' : 'play');
    playBtn.title = s.playing ? T('Pause (Leertaste)', 'Pause (space)') : T('Abspielen (Leertaste)', 'Play (space)');
    backBtn.disabled = live; fwdBtn.disabled = live;
    liveBadge.classList.toggle('hidden', !live);
    time.textContent = live ? '' : d ? `${formatTime(s.position)} / ${formatTime(d)}` : formatTime(s.position);
    if (!dragging) {
      const f = !live && d ? Math.min(1, s.position / d) : 0;
      played.style.width = f * 100 + '%'; knob.style.left = f * 100 + '%';
    }
    buffered.style.width = (!live && d ? Math.min(100, (s.buffered / d) * 100) : 0) + '%';
    seek.classList.toggle('disabled', live || !d);
    const muted = s.muted || s.volume === 0;
    setIcon(muteBtn, muted ? 'mute' : 'volume');
    muteBtn.title = muted ? T('Ton an (M)', 'Unmute (M)') : T('Stumm (M)', 'Mute (M)');
    if (document.activeElement !== volume) volume.value = String(s.muted ? 0 : s.volume);
    qualityBtn.classList.toggle('hidden', (s.qualities || []).length < 2);
    const ql = qualityLabel(s);
    if (qualityBtn.textContent !== ql) qualityBtn.textContent = ql;
    qualityBtn.title = T('Videoqualität für diesen Film (Q)', 'Video quality for this film (Q)');
    subsBtn.classList.toggle('hidden', !s.hasSubtitles);
    subsBtn.classList.toggle('on', !!s.subtitles);
    subsBtn.setAttribute('aria-pressed', String(!!s.subtitles));
    setIcon(fullBtn, full ? 'shrink' : 'expand');
    fullBtn.title = full ? T('Vollbild verlassen (F)', 'Leave full screen (F)') : T('Vollbild im Panel (F)', 'Full screen in the panel (F)');
    if (!s.playing) el.classList.remove('idle');
  }

  return {
    el,
    /** Show a poster (image element or typographic card) until the film runs. */
    setPoster(node) { clear(posterHost); if (node) posterHost.appendChild(node); },
    attach() {
      attached = true;
      mediaPlayer.attach(videoHost);
      if (!off) off = mediaPlayer.onChange(render);
      render(mediaPlayer.state);
      poke();
    },
    detach() {
      attached = false;
      if (videoHost.contains(mediaPlayer.video)) mediaPlayer.detach();
      render(mediaPlayer.state);
    },
    get attached() { return attached; },
    get fullscreen() { return full; },
    toggleFullscreen,
    closeMenus() { if (!qualityMenu.classList.contains('hidden')) { toggleMenu(false); return true; } return false; },
    onKey(e) {
      if (!attached || !mediaPlayer.current || mediaPlayer.mode !== 'panel') return false;
      const k = e.key;
      if (e.ctrlKey || e.altKey || e.metaKey) return false;
      // inside the open quick switch: arrows move, Enter chooses (the buttons take Enter themselves)
      if (!qualityMenu.classList.contains('hidden') && (k === 'ArrowDown' || k === 'ArrowUp')) {
        const items = [...qualityMenu.querySelectorAll('.mt-qitem')];
        const i = items.indexOf(document.activeElement);
        items[(i + (k === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus({ preventScroll: true });
        poke();
        return true;
      }
      if (!qualityMenu.classList.contains('hidden') && (k === 'Enter' || k === ' ') && qualityMenu.contains(document.activeElement)) { document.activeElement.click(); return true; }
      if (k === ' ' || k === 'k' || k === 'K') { mediaPlayer.toggle(); poke(); return true; }
      if (k === 'j' || k === 'J') { mediaPlayer.skip(-10); poke(); return true; }
      if (k === 'l' || k === 'L') { mediaPlayer.skip(10); poke(); return true; }
      if (k === 'ArrowLeft') { mediaPlayer.skip(-5); poke(); return true; }
      if (k === 'ArrowRight') { mediaPlayer.skip(5); poke(); return true; }
      if (k === 'f' || k === 'F') { toggleFullscreen(); return true; }
      if (k === 'm' || k === 'M') { mediaPlayer.toggleMute(); poke(); return true; }
      if ((k === 'q' || k === 'Q') && (mediaPlayer.state.qualities || []).length > 1) { toggleMenu(); poke(); return true; }
      return false;
    },
    destroy() { clearTimeout(idleTimer); off?.(); off = null; if (attached) this.detach(); },
  };
}
