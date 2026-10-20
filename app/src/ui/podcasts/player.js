// Module-level podcast player: one HTMLAudioElement that keeps playing after the panel closes.
// The HUD mini player (ui/media-bar.js) and the system media controls use  podcastPlayer.current / onChange(fn) /
// toggle() / pause() / skip() / stop(). One source at a time (media/focus.js): a podcast that starts pauses a
// film or a reading, and a film or a reading that starts pauses the podcast (it keeps its position).
import { api } from '../../core/api.js';
import { bus } from '../../core/bus.js';
import { mediaFocus } from '../../media/focus.js';

const RATES = [0.8, 1, 1.2, 1.5, 1.75, 2];
const SAVE_EVERY = 10000;
// MediaError codes (HTMLMediaElement.error.code) in words; the browser's own messages are English and empty
const MEDIA_ERRORS = {
  1: 'Die Wiedergabe wurde abgebrochen.',
  2: 'Die Folge konnte wegen eines Netzwerkfehlers nicht geladen werden.',
  3: 'Die Audiodatei ist beschädigt oder in einem Format, das nicht abgespielt werden kann.',
  4: 'Diese Folge kann nicht abgespielt werden (Adresse oder Format).',
};

function createPlayer() {
  const audio = new Audio();
  audio.preload = 'metadata';
  const listeners = new Set();
  const state = { playing: false, position: 0, duration: 0, rate: 1, volume: 1, buffering: false, error: null, sleepUntil: null, sleepTimer: null };
  let current = null; // { episode, show }
  let ctx = null;
  let lastSave = 0, lastEmit = 0, saveTimer = null;
  let fadeTimer = null, fadeVolume = 1;   // sleep timer: the 10 s fade-out at the end
  // every new source (next episode, stop) resets playbackRate to defaultPlaybackRate: both carry the chosen speed
  try { const v = parseFloat(localStorage.getItem('lesesaal.podcast.volume')); if (v >= 0 && v <= 1) audio.volume = v; const r = parseFloat(localStorage.getItem('lesesaal.podcast.rate')); if (RATES.includes(r)) { audio.defaultPlaybackRate = r; audio.playbackRate = r; } } catch {}
  state.volume = audio.volume; state.rate = audio.playbackRate;

  const emit = () => { for (const fn of [...listeners]) { try { fn(snapshot()); } catch (e) { console.error('[podcast]', e); } } };
  const snapshot = () => ({ ...state, current, rates: RATES });
  // the background music ducks, and with settings.audio.pauseForMedia (default) it pauses until the episode stops
  const duck = (on) => { try { ctx?.audio?.duck?.(on, 'podcast'); ctx?.audio?.hold?.(on, 'podcast'); } catch {} };
  /** A rejected audio.play(). AbortError only means that a newer play() or a new source replaced this one. */
  const playFailed = (e) => {
    if (e?.name === 'AbortError') return;
    state.error = e?.name === 'NotSupportedError' ? MEDIA_ERRORS[4] : (e?.message || MEDIA_ERRORS[4]);
    state.buffering = false;
    emit();
  };

  async function save(done = false) {
    // stop() clears `current` while this save is still waiting for the backend: keep our own reference
    const cur = current;
    if (!cur) return;
    lastSave = Date.now();
    const secs = Math.round(audio.currentTime || 0);
    const finished = !!(done || (audio.duration && secs > audio.duration - 15));
    try { await api.podcasts.setPosition(cur.episode.id, secs, finished); } catch {}
    cur.episode.position = { seconds: secs, done: finished, updatedAt: Date.now() };
  }

  audio.addEventListener('play', () => { state.playing = true; state.error = null; duck(true); if (current) mediaFocus.claim('podcast'); bus.emit('podcast:play', current); emit(); });
  audio.addEventListener('pause', () => { state.playing = false; duck(false); save(); bus.emit('podcast:pause', current); emit(); });
  audio.addEventListener('ended', () => { state.playing = false; duck(false); save(true); bus.emit('podcast:ended', current); emit(); });
  audio.addEventListener('timeupdate', () => {
    state.position = audio.currentTime || 0; state.duration = audio.duration || state.duration || 0;
    const now = Date.now();
    if (state.playing && now - lastSave > SAVE_EVERY) save();
    if (now - lastEmit > 250) { lastEmit = now; emit(); }
  });
  audio.addEventListener('durationchange', () => { state.duration = audio.duration || 0; emit(); });
  audio.addEventListener('loadedmetadata', () => { state.duration = audio.duration || 0; state.buffering = false; emit(); });
  audio.addEventListener('waiting', () => { state.buffering = true; emit(); });
  audio.addEventListener('playing', () => { state.buffering = false; emit(); });
  audio.addEventListener('ratechange', () => { state.rate = audio.playbackRate; emit(); });
  audio.addEventListener('volumechange', () => { state.volume = audio.volume; emit(); });
  audio.addEventListener('error', () => { state.buffering = false; state.playing = false; state.error = MEDIA_ERRORS[audio.error?.code] || MEDIA_ERRORS[4]; duck(false); emit(); });

  const player = {
    audio,
    get current() { return current; },
    get state() { return snapshot(); },
    attach(c) { ctx = c; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Play an episode ({id,title,audio,duration,image,position}) of a show ({title,artwork,feedUrl}). Resumes at the saved position. */
    async play(episode, show, { startAt } = {}) {
      if (current && current.episode.id === episode.id) { if (audio.paused) await audio.play().catch(playFailed); return; }
      if (current) await save();
      current = { episode, show };
      state.error = null; state.buffering = true; state.position = 0; state.duration = episode.duration || 0;
      audio.src = episode.audio;
      const pos = startAt ?? (episode.position && !episode.position.done ? episode.position.seconds : 0);
      if (pos > 5) { const seekTo = () => { audio.currentTime = pos; audio.removeEventListener('loadedmetadata', seekTo); }; audio.addEventListener('loadedmetadata', seekTo); }
      mediaFocus.claim('podcast');   // the start itself: a film pauses at once, even if this episode fails to load
      emit();
      try { await audio.play(); } catch (e) { playFailed(e); }
    },
    pause() { audio.pause(); },
    resume() { if (current) audio.play().catch(playFailed); },
    toggle() { if (!current) return; if (audio.paused) player.resume(); else audio.pause(); },
    stop() {
      const was = current;
      audio.pause(); save(); current = null;
      audio.removeAttribute('src'); audio.load();
      // load() drops the 'pause' event that pause() queued: without these lines the state stayed "playing" and
      // the music of the reading room stayed ducked after a stop
      state.playing = false; state.buffering = false; state.position = 0; state.duration = 0;
      duck(false);
      if (was) bus.emit('podcast:pause', was);
      emit();
      mediaFocus.changed();   // a paused film becomes the active source again
    },
    seek(sec) { if (!current) return; audio.currentTime = Math.max(0, Math.min(sec, audio.duration || sec)); state.position = audio.currentTime; emit(); },
    skip(delta) { player.seek((audio.currentTime || 0) + delta); },
    setRate(r) { audio.defaultPlaybackRate = r; audio.playbackRate = r; try { localStorage.setItem('lesesaal.podcast.rate', String(r)); } catch {} },
    cycleRate() { const i = RATES.indexOf(audio.playbackRate); player.setRate(RATES[(i + 1) % RATES.length]); },
    setVolume(v) { audio.volume = Math.max(0, Math.min(1, v)); try { localStorage.setItem('lesesaal.podcast.volume', String(audio.volume)); } catch {} },
    /** Sleep timer in minutes (null clears). Fades out over the last 10 seconds. */
    setSleep(minutes) {
      clearTimeout(state.sleepTimer); state.sleepTimer = null; state.sleepUntil = null;
      // a fade that is already running belongs to the old timer: stop it and give the volume back
      if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; audio.volume = fadeVolume; }
      if (minutes) {
        state.sleepUntil = Date.now() + minutes * 60000;
        state.sleepTimer = setTimeout(() => {
          fadeVolume = audio.volume;
          const t0 = Date.now();
          fadeTimer = setInterval(() => {
            const k = Math.min(1, (Date.now() - t0) / 10000);
            audio.volume = fadeVolume * (1 - k);
            if (k >= 1) { clearInterval(fadeTimer); fadeTimer = null; audio.pause(); audio.volume = fadeVolume; state.sleepUntil = null; state.sleepTimer = null; emit(); }
          }, 250);
        }, Math.max(0, minutes * 60000 - 10000));
      }
      emit();
    },
    markDone(episode, done = true) { return api.podcasts.setPosition(episode.id, done ? (episode.duration || 0) : 0, done); },
    RATES,
  };
  mediaFocus.register('podcast', { hold() { if (!audio.paused) audio.pause(); }, loaded: () => !!current });
  void saveTimer;
  return player;
}

export const podcastPlayer = (globalThis.__cozyshelvesPodcastPlayer ||= createPlayer());
export const formatTime = (s) => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(sec).padStart(2, '0'); };
