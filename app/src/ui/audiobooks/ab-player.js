// The audiobook player: one <audio> element for the track that plays. It lives outside the panels, so an audiobook goes
// on while you walk through the world or read the newspaper; the HUD mini player (ui/media-bar.js), the keys K/J/L, the
// system media keys (media/transport.js) and the cabinet in the hall act on it.
//   • position = start of the track in the book + time in the track; chapters are { track, offset, title }
//   • where the listener is is saved every 5 s while it plays, on pause, after a jump and when it stops
//     (electron/audiobooks); going on after a pause starts a few seconds earlier (3 s after a short pause, up to 15 s)
//   • speed 0.75 to 2.5 (per audiobook), sleep timer 15, 30, 45, 60 minutes or to the end of the chapter, the volume
//     fades out over the last 20 seconds
//   • one source at a time (media/focus.js): an audiobook that starts pauses a film, a podcast or the reading aloud, and
//     the background music pauses with settings.audio.pauseForMedia (otherwise it only gets quieter)
// Test hook: player.testTime = { minute: s, fade: s } makes a minute of the sleep timer and its fade that long.
import { mediaFocus } from '../../media/focus.js';
import { bus } from '../../core/bus.js';
import { abStore } from './ab-store.js';
import { coverUrl } from './ab-format.js';

export const RATES = [0.75, 0.9, 1, 1.1, 1.2, 1.25, 1.3, 1.4, 1.5, 1.75, 2, 2.25, 2.5];
export const SLEEP_MINUTES = [15, 30, 45, 60];
const SAVE_EVERY = 5000;
const FADE = 20;                         // seconds of fading before the sleep timer stops the audiobook
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** How far to go back when the listener goes on: nothing after a moment, a few seconds after a pause, more after a long one. */
export function rewindFor(pauseMs) {
  if (!(pauseMs > 10000)) return 0;
  if (pauseMs < 5 * 60000) return 3;
  if (pauseMs < 60 * 60000) return 8;
  return 15;
}
/** Map a media error to a kind the UI puts into words. */
const errorKind = (code) => ({ 1: 'aborted', 2: 'network', 3: 'decode', 4: 'format' }[code] || 'format');

function createPlayer() {
  const audio = new Audio();
  audio.preload = 'auto';
  const listeners = new Set();
  let book = null;                       // the record with tracks and chapters (abStore.book)
  let track = 0;
  let loadSeq = 0, pendingSeek = null, wantPlay = false;
  let ctx = null;
  let lastSave = 0, lastEmit = 0, pausedAt = 0, saveTimer = null;
  let quietPauses = 0;                   // pauses of our own (another audiobook, stop): their event saves nothing
  let error = null, buffering = false, finished = false;
  let sleep = null;                      // { mode: 'minutes', left } | { mode: 'chapter', chapter }
  let sleepTimer = null, sleepLast = 0, fadeGain = 1;
  let volume = 1, defaultRate = 1;
  let artwork = '';                      // the cover for the system media overlay (blob: or data:, never lfile:)
  try {
    const v = parseFloat(localStorage.getItem('lesesaal.audiobook.volume')); if (v >= 0 && v <= 1) volume = v;
    const r = parseFloat(localStorage.getItem('lesesaal.audiobook.rate')); if (RATES.includes(r)) defaultRate = r;
  } catch {}
  audio.volume = volume;

  const tracks = () => book?.tracks || [];
  const duration = () => { const t = tracks(); return t.length ? t[t.length - 1].start + (t[t.length - 1].duration || 0) : 0; };
  const position = () => (book ? (tracks()[track]?.start || 0) + (audio.currentTime || 0) : 0);
  const chapterStart = (i) => { const c = book?.chapters?.[i]; return c ? (tracks()[c.track]?.start || 0) + c.offset : 0; };
  function chapterAt(pos) {
    const ch = book?.chapters || [];
    let i = 0;
    for (let k = 0; k < ch.length; k++) if (chapterStart(k) <= pos + 0.05) i = k;
    return i;
  }
  const chapterEnd = (i) => (i + 1 < (book?.chapters?.length || 0) ? chapterStart(i + 1) : duration());

  function snapshot() {
    const pos = position(), ci = book ? chapterAt(pos) : -1;
    const c = book?.chapters?.[ci];
    let sleepLeft = null;
    if (sleep?.mode === 'minutes') sleepLeft = sleep.left;
    else if (sleep?.mode === 'chapter') sleepLeft = Math.max(0, (chapterEnd(sleep.chapter) - pos) / (audio.playbackRate || 1));
    return {
      book, playing: !!book && !audio.paused, buffering, error, finished, position: pos, duration: duration(), track,
      chapter: ci, chapterTitle: c?.title || null, chapterStart: ci >= 0 ? chapterStart(ci) : 0, chapterEnd: ci >= 0 ? chapterEnd(ci) : 0,
      rate: audio.playbackRate || 1, volume, artwork, sleep: sleep ? { mode: sleep.mode, left: sleepLeft, chapter: sleep.chapter ?? null, minutes: sleep.minutes ?? null } : null, rates: RATES,
    };
  }
  const emit = () => { lastEmit = performance.now(); const s = snapshot(); for (const fn of [...listeners]) { try { fn(s); } catch (e) { console.error('[audiobook]', e); } } };
  // the background music: quieter while an audiobook plays, paused with settings.audio.pauseForMedia (audio/engine.js)
  const duck = (on) => { try { ctx?.audio?.duck?.(on, 'audiobook'); ctx?.audio?.hold?.(on, 'audiobook'); } catch {} };

  // ---- saving ------------------------------------------------------------------------------------------------
  function save({ done = false } = {}) {
    if (!book) return null;
    lastSave = Date.now();
    const t = tracks()[track];
    const patch = done ? { track: tracks().length - 1, offset: tracks()[tracks().length - 1]?.duration || 0, position: duration(), duration: duration(), finished: true, rate: audio.playbackRate }
      : { track, offset: +(audio.currentTime || 0).toFixed(2), position: +(t ? t.start + (audio.currentTime || 0) : 0).toFixed(2), duration: duration(), finished: false, rate: audio.playbackRate };
    return abStore.saveProgress(book.id, patch);
  }
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => save(), 900); };

  // ---- loading tracks ------------------------------------------------------------------------------------------
  /** Put track i into the element at `offset` seconds; plays when `play`. */
  function load(i, offset, play) {
    const t = tracks()[i]; if (!t) return;
    const seq = ++loadSeq;
    track = i; pendingSeek = offset > 0.05 ? offset : null; wantPlay = play;
    error = null; buffering = true;
    audio.src = t.url;
    audio.defaultPlaybackRate = player.rate; audio.playbackRate = player.rate;
    const ready = () => {
      audio.removeEventListener('loadedmetadata', ready);
      if (seq !== loadSeq) return;
      // the real length of the track: an MP3 without a frame count is only estimated while scanning
      const real = audio.duration;
      if (isFinite(real) && real > 0 && Math.abs(real - (t.duration || 0)) > 0.5) correctDuration(i, real);
      if (pendingSeek != null) { try { audio.currentTime = Math.min(pendingSeek, Math.max(0, (real || pendingSeek) - 0.25)); } catch {} pendingSeek = null; }
      if (wantPlay) audio.play().catch(playFailed); else buffering = false;
      emit();
    };
    audio.addEventListener('loadedmetadata', ready);
    emit();
  }
  function correctDuration(i, real) {
    const list = tracks(); if (!list[i]) return;
    list[i].duration = real;
    let s = 0; for (const x of list) { x.start = s; s += x.duration || 0; }
    book.duration = s;
    abStore.trackDuration(book.id, i, real);
  }
  function playFailed(e) {
    if (e?.name === 'AbortError') return;
    error = e?.name === 'NotSupportedError' ? 'format' : 'play';
    buffering = false; emit();
  }

  /** The overlay of the system takes pictures only from http, https, data and blob addresses: the cover as a blob. */
  function setArtwork(rec) {
    if (artwork.startsWith('blob:')) URL.revokeObjectURL(artwork);
    artwork = '';
    if (!rec) return;
    const id = rec.id;
    if (!rec.cover?.thumb) { artwork = coverUrl(rec, 'thumb'); return; }
    fetch(rec.cover.thumb).then((r) => (r.ok ? r.blob() : null)).then((b) => {
      if (!b || book?.id !== id) return;
      artwork = URL.createObjectURL(b); emit();
    }).catch(() => {});
  }

  // ---- the element's events ----------------------------------------------------------------------------------
  audio.addEventListener('play', () => { error = null; duck(true); if (book) mediaFocus.claim('audiobook'); bus.emit('audiobook:play', book?.id); emit(); });
  audio.addEventListener('playing', () => { buffering = false; emit(); });
  audio.addEventListener('waiting', () => { buffering = true; emit(); });
  audio.addEventListener('pause', () => {
    duck(false);
    if (quietPauses > 0) { quietPauses--; emit(); return; }
    pausedAt = Date.now();
    // the pause between two tracks is no pause of the listener
    if (!audio.ended) save();
    emit();
  });
  audio.addEventListener('ended', () => {
    if (!book) return;
    if (track + 1 < tracks().length) {
      // the sleep timer runs to the end of a chapter that ends with this file: here it stops, the next file waits
      const t = tracks()[track];
      if (sleep?.mode === 'chapter' && chapterEnd(sleep.chapter) <= t.start + (t.duration || 0) + 0.25) {
        sleepOff(); load(track + 1, 0, false); saveSoon();
        bus.emit('audiobook:sleep-ended', book.id);
        return;
      }
      load(track + 1, 0, true);
      return;
    }
    finished = true; duck(false); sleepOff();
    save({ done: true });
    bus.emit('audiobook:ended', book.id);
    emit();
  });
  audio.addEventListener('timeupdate', () => {
    if (!book) return;
    const now = Date.now();
    if (!audio.paused && now - lastSave > SAVE_EVERY) save();
    if (performance.now() - lastEmit > 250) emit();
  });
  audio.addEventListener('ratechange', () => emit());
  audio.addEventListener('error', () => { if (!audio.getAttribute('src')) return; error = errorKind(audio.error?.code); buffering = false; duck(false); emit(); });

  // ---- sleep timer -----------------------------------------------------------------------------------------------
  const scale = () => player.testTime || null;
  function sleepOff() {
    clearInterval(sleepTimer); sleepTimer = null; sleep = null;
    if (fadeGain !== 1) { fadeGain = 1; audio.volume = volume; }
  }
  function sleepTick() {
    if (!sleep || !book) return;
    const now = performance.now(), dt = (now - sleepLast) / 1000; sleepLast = now;
    if (audio.paused) return;                                   // the timer counts listening time
    const fadeLen = scale()?.fade ?? FADE;
    let left;
    if (sleep.mode === 'minutes') { sleep.left = Math.max(0, sleep.left - dt); left = sleep.left; }
    else left = Math.max(0, (chapterEnd(sleep.chapter) - position()) / (audio.playbackRate || 1));
    fadeGain = left < fadeLen ? clamp(left / fadeLen, 0, 1) : 1;
    audio.volume = volume * fadeGain;
    // at the end of the chapter (or of the time): stop there; a chapter that already lies behind ends at once
    if (left <= 0.05 || (sleep.mode === 'chapter' && chapterAt(position()) > sleep.chapter)) {
      const wasChapter = sleep.mode === 'chapter' ? sleep.chapter : null;
      sleepOff();
      audio.pause();
      if (wasChapter != null) { try { player.seek(chapterEnd(wasChapter)); } catch {} }
      bus.emit('audiobook:sleep-ended', book.id);
    }
    emit();
  }

  const player = {
    audio,
    get state() { return snapshot(); },
    get current() { return book; },
    get rate() { return book?.rate || defaultRate; },
    attach(c) { ctx = c; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    testTime: null,
    /**
     * Play an audiobook (id or record). Where: `at` (seconds in the book), `chapter` (index), else where the listener
     * stopped, a few seconds earlier; a finished one from the beginning. The one that is loaded already just goes on.
     */
    async open(idOrBook, { at = null, chapter = null, play = true } = {}) {
      const id = typeof idOrBook === 'string' ? idOrBook : idOrBook?.id;
      if (!id) return false;
      if (book && book.id === id) {
        if (chapter != null) player.seekChapter(chapter, { play });
        else if (at != null) player.seek(at);
        if (play && audio.paused) player.resume();
        return true;
      }
      const rec = await abStore.book(id);
      if (!rec || !rec.tracks?.length) { error = 'missing'; emit(); return false; }
      if (book) { save(); if (!audio.paused) { quietPauses++; audio.pause(); } }
      sleepOff();
      book = { ...rec, rate: rec.progress?.rate || defaultRate };
      finished = false; error = null;
      setArtwork(book);
      const p = rec.progress;
      let ti = 0, off = 0;
      if (chapter != null && rec.chapters[chapter]) { ti = rec.chapters[chapter].track; off = rec.chapters[chapter].offset; }
      else if (at != null) { const s = player.locate(at); ti = s.track; off = s.offset; }
      else if (p && !p.finished && (p.position || 0) > 0) {
        ti = clamp(p.track | 0, 0, rec.tracks.length - 1);
        const back = rewindFor(p.lastPlayed ? Date.now() - p.lastPlayed : 0);
        off = Math.max(0, (p.offset || 0) - back);
        if (back && (p.offset || 0) < back && ti > 0) { ti -= 1; off = Math.max(0, (rec.tracks[ti].duration || 0) - (back - (p.offset || 0))); }
      } else if (p?.finished) abStore.saveProgress(id, { reset: true, touch: false });
      load(ti, off, play);
      bus.emit('audiobook:open', id);
      mediaFocus.changed();
      return true;
    },
    /** { track, offset } of a position in the book. */
    locate(sec) {
      const list = tracks(); const pos = clamp(sec, 0, Math.max(0, duration() - 0.05));
      for (let i = list.length - 1; i >= 0; i--) if (list[i].start <= pos) return { track: i, offset: pos - list[i].start };
      return { track: 0, offset: 0 };
    },
    pause() { audio.pause(); },
    resume() {
      if (!book) return;
      if (finished) { finished = false; load(0, 0, true); abStore.saveProgress(book.id, { reset: true, touch: false }); return; }
      const back = rewindFor(pausedAt ? Date.now() - pausedAt : 0);
      if (back && position() > back) { pausedAt = 0; player.seek(position() - back, { play: true }); return; }
      if (pendingSeek != null || audio.readyState < 1) { wantPlay = true; if (audio.readyState >= 1) audio.play().catch(playFailed); return; }
      audio.play().catch(playFailed);
    },
    toggle() { if (!book) return; if (audio.paused || finished) player.resume(); else audio.pause(); },
    /** Stop and unload (the position is saved). */
    stop() {
      if (!book) return;
      const id = book.id;
      save();
      if (!audio.paused) { quietPauses++; audio.pause(); }
      sleepOff();
      loadSeq++; book = null; track = 0; pendingSeek = null; wantPlay = false; error = null; buffering = false; finished = false;
      setArtwork(null);
      audio.removeAttribute('src'); audio.load();
      duck(false);
      bus.emit('audiobook:stop', id);
      emit();
      mediaFocus.changed();
    },
    /** Jump to a position in the book (seconds); it keeps playing or pausing as it did. */
    seek(sec, { play = null } = {}) {
      if (!book) return;
      const { track: ti, offset } = player.locate(sec);
      finished = false;
      const keepPlaying = play ?? !audio.paused;
      if (ti === track && audio.readyState >= 1 && pendingSeek == null) {
        try { audio.currentTime = offset; } catch {}
        if (play && audio.paused) audio.play().catch(playFailed);
      } else load(ti, offset, keepPlaying);
      saveSoon(); emit();
    },
    skip(delta) { if (book) player.seek(position() + delta); },
    seekChapter(i, { play = null } = {}) { if (book?.chapters?.[i]) player.seek(chapterStart(i) + 0.01, { play }); },
    /** The next chapter; the previous one, or the start of this one when more than 3 s of it have passed. */
    nextChapter() { if (!book) return; const i = chapterAt(position()); if (i + 1 < book.chapters.length) player.seekChapter(i + 1); },
    prevChapter() { if (!book) return; const pos = position(), i = chapterAt(pos); player.seekChapter(pos - chapterStart(i) > 3 || i === 0 ? i : i - 1); },
    setRate(r) {
      const v = clamp(Number(r) || 1, RATES[0], RATES[RATES.length - 1]);
      audio.defaultPlaybackRate = v; audio.playbackRate = v; defaultRate = v;
      if (book) { book.rate = v; saveSoon(); }
      try { localStorage.setItem('lesesaal.audiobook.rate', String(v)); } catch {}
      emit();
    },
    setVolume(v) { volume = clamp(v, 0, 1); audio.volume = volume * fadeGain; try { localStorage.setItem('lesesaal.audiobook.volume', String(volume)); } catch {} emit(); },
    /** Sleep timer: minutes (15, 30, 45, 60), 'chapter' (to the end of this chapter) or null (off). */
    setSleep(mode) {
      sleepOff();
      if (!mode || !book) { emit(); return; }
      const minute = scale()?.minute ?? 60;
      sleep = mode === 'chapter' ? { mode: 'chapter', chapter: chapterAt(position()) } : { mode: 'minutes', left: Number(mode) * minute, minutes: Number(mode) };
      sleepLast = performance.now();
      sleepTimer = setInterval(sleepTick, 200);
      emit();
    },
    chapterStart,
    chapterAt: (sec) => chapterAt(sec),
    /** Mark an audiobook (the loaded one or any other) as finished or not. */
    markFinished(id, done) {
      if (book && book.id === id) { if (done) { audio.pause(); finished = true; save({ done: true }); } else { finished = false; abStore.saveProgress(id, { reset: true }); } emit(); return; }
      if (done) { const b = abStore.get(id); abStore.saveProgress(id, { finished: true, position: b?.duration || 0 }); } else abStore.saveProgress(id, { reset: true });
    },
  };
  mediaFocus.register('audiobook', { hold() { if (!audio.paused) audio.pause(); }, loaded: () => !!book });
  // the app closes while an audiobook plays: where the listener is goes out with the last message of the page
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { if (book && !audio.paused) save(); });
  return player;
}

// one instance, also when a second bundle loads this module again (like the podcast player)
export const audiobookPlayer = (globalThis.__cozyshelvesAudiobookPlayer ||= createPlayer());
export default audiobookPlayer;
