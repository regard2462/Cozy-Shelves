// The one film/video player of the app (Mediathek, live TV, downloaded films).
//
// There is exactly ONE <video> element. It is shown in four ways ("modes"):
//   'panel'  – inside the Mediathek panel (the panel calls mediaPlayer.attach(container))
//   'audio'  – nothing visible, it keeps playing while you walk around (mini player in the HUD)
//   'screen' – projected onto the roll-down screen in the hall: app/src/world/cinema.js renders
//              mediaPlayer.video as a THREE.VideoTexture and rolls the screen down / up.
//   'full'   – full screen over the whole app (app/src/ui/film-fullscreen.js hands its container through
//              attach(container, 'full')); leaving it goes back to 'screen' or 'audio' with setMode().
// Subtitles are drawn by the browser in 'panel' and 'full'. The distance to the screen (setSpatialGain) only
// counts in 'screen'.
//
// One source at a time (app/src/media/focus.js): a film that starts claims the focus as 'film', a podcast or a
// reading that starts later pauses it (hold), and it pauses them in turn.
//
// WebGL refuses "tainted" (cross-origin without CORS) videos, so the element must always be
// CORS-clean: remote sources go through the media:// proxy of the main process
// (electron/mediathek), local files through lfile://, and video.crossOrigin is 'anonymous'.
// HLS (live TV, SRF, ORF) is played by hls.js; its playlist and segment requests go through the proxy
// as well, because the proxy rewrites every address inside the playlists to media://.
//
// Contract (docs/CONTRACTS.md → "Medien"):
//   mediaPlayer.video                      HTMLVideoElement
//   mediaPlayer.current                    item or null  { id, title, topic?, channel?, description?, duration?,
//                                            live?, poster?, src?, hls?, subtitle?, stream? (MediaStream, tests),
//                                            video?: { low, sd, hd } (Mediathek qualities), subtitleUrl?, local? }
//   mediaPlayer.mode                       'panel' | 'audio' | 'screen' | 'full' | null
//   mediaPlayer.state                      snapshot (see snapshot())
//   mediaPlayer.onChange(fn) → off         fn(snapshot) on every change (time updates ≈ 4×/s)
//   mediaPlayer.play(item, { mode, startAt, quality, restart }) → Promise
//   mediaPlayer.setMode(mode) · toggle() · pause() · resume() · seek(s) · skip(Δs) · stop()
//   mediaPlayer.setVolume(v) · setSpatialGain(g)   element volume = volume × spatialGain ('screen' only: distance)
//   mediaPlayer.attach(container, mode = 'panel') · detach()
// Additions of the Mediathek (0.3):
//   setQuality('auto' | a key | a height, see below) keeps the position · setSubtitles(on) · toggleMute() · retry()
//   snapshot also carries: quality, qualities [{ id, height, label }], height, subtitles, hasSubtitles, cue (text of
//   the current subtitle), muted, buffered (s), errorKind, local
// Video quality (0.7, quality.js): the qualities are the real picture sizes of the film ("1080p", "720p" …): the
// renditions of item.video with their heights (item.heights, mediathek:heights, the video element itself) or the
// levels of an HLS master. Every film starts with settings.mediathek.quality: 'auto' or a preferred height (1080,
// 720, 480, 360), it plays the closest rendition it has. The quick switch (setQuality) takes 'auto', a rendition key
// ('sd', 'h720' …), a level key ('h720') or a height, keeps the position and applies to the running film only.
// Snapshot: choice (what was chosen), quality (the key that plays; HLS levels: the chosen key), height (the class of
// the picture that plays), level (its label, "720p"), qualities [{ id, height, label }].
// 'auto' with one address per size: the biggest up to the window height, one step down after repeated or long
// stalls; with HLS levels hls.js adapts by itself. As sound only the smallest rendition is loaded.
import { bus } from '../core/bus.js';
import { api } from '../core/api.js';
import { tr } from '../core/i18n.js';
import { mediaFocus } from './focus.js';
import { preferenceOf, renditionsOf, closest, autoPick, lower, levelsOf, labelOf, classOf } from './quality.js';

const VOLUME_KEY = 'lesesaal.media.volume';
const QUALITY_KEY = 'lesesaal.media.quality';
const SUBS_KEY = 'lesesaal.media.subtitles';
const REPORT_EVERY = 10000;       // ms between resume reports while playing
const AUDIO_LOW_DELAY = 4000;     // ms in 'audio' mode before the film switches to its smallest quality
/** Names of MediathekViewWeb's qualities while their size is not known yet (the panel shows them translated). */
const OLD_NAMES = { auto: 'Automatisch', low: 'Niedrig', sd: 'Mittel', hd: 'Hoch (HD)' };
// 'auto': one step down after STALL_COUNT stalls within STALL_WINDOW ms, or one stall longer than STALL_LONG ms
const STALL_COUNT = 3, STALL_WINDOW = 60000, STALL_LONG = 5000;
// a film whose sizes are still being read waits at most this long before it picks the rendition to start with
const HEIGHTS_WAIT = 1500;

/** base64url of a UTF-8 string (the media:// proxy decodes it in the main process). */
export function b64url(s) {
  const bytes = new TextEncoder().encode(String(s));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const tailOf = (u) => { try { return (new URL(u).pathname.split('/').pop() || 'x').replace(/[^\w.-]+/g, '_').slice(-60) || 'x'; } catch { return 'x'; } };
/** Remote http(s) address → media://proxy/…; everything else (lfile:, media:, blob:, data:) stays. */
export const proxied = (url) => (/^https?:\/\//i.test(url || '') ? `media://proxy/${b64url(url)}/${tailOf(url)}` : url);
export const subtitleTrackUrl = (item) => item?.subtitleUrl || (item?.subtitle && /^https?:/i.test(item.subtitle) ? `media://subs/${b64url(item.subtitle)}/untertitel.vtt` : null);
const invoke = (ch, ...a) => { try { return api?.invoke ? Promise.resolve(api.invoke(ch, ...a)) : Promise.resolve(null); } catch { return Promise.resolve(null); } };
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
/** German sentence for an error kind (same wording as electron/mediathek/errors.js). */
const ERROR_TEXT = {
  geo: 'Diese Sendung ist in deinem Land gesperrt (Geoblocking).',
  'geo-at': 'Diese Sendung zeigt der ORF nur in Österreich (Geoblocking).',
  'geo-ch': 'Diese Sendung zeigt der SRF nur in der Schweiz (Geoblocking).',
  gone: 'Diese Sendung ist nicht mehr in der Mediathek.',
  offline: 'Keine Verbindung zum Sender. Bitte die Internetverbindung prüfen.',
  forbidden: 'Der Sender verweigert den Abruf dieser Sendung.',
  server: 'Der Server des Senders hat gerade eine Störung.',
  format: 'Das Videoformat wird nicht unterstützt.',
  missing: 'Die heruntergeladene Datei fehlt.',
  unknown: 'Die Sendung lässt sich gerade nicht abspielen.',
};
/** A live channel that does not answer (refused, gone, no connection): one sentence in the language of the interface. */
const LIVE_UNREACHABLE = { de: 'Dieser Sender ist gerade nicht erreichbar. Bitte später noch einmal versuchen.', en: 'This channel is not reachable right now. Please try again later.' };
const kindOfStatus = (code) => (code === 451 ? 'geo' : code === 404 || code === 410 ? 'gone' : code === 403 ? 'forbidden' : code >= 500 ? 'server' : code === 0 ? 'offline' : 'unknown');

function createPlayer() {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.playsInline = true;
  video.preload = 'auto';
  video.className = 'media-video';
  // parked off-screen while nobody shows it (audio / screen mode) – a detached element would still
  // play, but some Chromium builds stop decoding frames of a video that is not in the document
  const parking = document.createElement('div');
  parking.className = 'media-parking';
  parking.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;height:180px;opacity:0;pointer-events:none;';
  const park = () => { if (!parking.isConnected) document.body.appendChild(parking); if (video.parentNode !== parking) parking.appendChild(video); };

  const listeners = new Set();
  const st = {
    mode: null, playing: false, buffering: false, position: 0, duration: 0, volume: 1, spatialGain: 1, error: null, errorKind: null,
    quality: null, qualities: [], subtitles: store.get(SUBS_KEY) === '1', hasSubtitles: false, cue: '', muted: false, buffered: 0, live: false,
    choice: null, level: null, height: 0,
  };
  let current = null, hls = null, lastEmit = 0, audioCtx = null, token = 0, track = null, triedQualities = new Set();
  let lastReport = 0, audioLowTimer = null, remoteUrl = null;
  let heldToken = -1;   // the play() with this token was put on hold by another source before it started
  // 'source': one address per size (MP4, SRF HLS) · 'levels': one HLS master with several levels (live TV, NHK)
  // choice: what was chosen for the running film ('auto' | a rendition or level key | a preferred height),
  // autoCap: the height 'auto' fell back to after stalls of this film, renditions: quality.js renditionsOf
  let qualityMode = null, choice = 'auto', autoCap = null, renditions = [];
  try { const v = parseFloat(store.get(VOLUME_KEY)); if (v >= 0 && v <= 1) st.volume = v; } catch {}
  // the distance to the screen only matters while the film is on it: in full screen it would be far too quiet
  const applyVolume = () => { video.volume = Math.max(0, Math.min(1, st.volume * (st.mode === 'screen' ? st.spatialGain : 1))); };
  applyVolume();
  // 'panel' and 'full' show the video inside a container (attach), the other modes park it
  const inContainer = (mode) => mode === 'panel' || mode === 'full';

  const snapshot = () => ({ ...st, qualities: st.qualities.slice(), current, live: !!(current?.live || st.live), local: !!current?.local });
  const emit = (force) => {
    const now = performance.now();
    if (!force && now - lastEmit < 240) return;
    lastEmit = now;
    const snap = snapshot();
    for (const fn of [...listeners]) { try { fn(snap); } catch (e) { console.error('[media]', e); } }
    bus.emit('media:change', snap);
  };
  // the background music ducks, and with settings.audio.pauseForMedia (default) it pauses while the film plays
  const duck = (on) => { try { audioCtx?.audio?.duck?.(on, 'film'); audioCtx?.audio?.hold?.(on, 'film'); } catch {} };
  /** The quality a new film starts with: settings.mediathek.quality ('auto' or a preferred height). */
  const settingsChoice = () => preferenceOf(audioCtx?.state?.settings?.mediathek?.quality);

  // ---- resume positions ----------------------------------------------------------------------------
  function report(force) {
    const it = current;
    if (!it || !it.id || it.live || st.live || it.stream || it.noResume) return;
    const dur = isFinite(video.duration) ? video.duration : st.duration || it.duration || 0;
    const pos = video.currentTime || 0;
    if (!force && (Date.now() - lastReport < REPORT_EVERY)) return;
    lastReport = Date.now();
    invoke('mediathek:position', it, pos, dur).then((entry) => bus.emit('media:position', { id: it.id, entry })).catch(() => {});
  }

  // every start (play(), resume, the controls of the panel) takes the focus: a podcast or a reading pauses
  video.addEventListener('play', () => { st.playing = true; st.error = null; st.errorKind = null; duck(true); if (current) mediaFocus.claim('film'); emit(true); });
  video.addEventListener('pause', () => { st.playing = false; duck(false); report(true); emit(true); });
  video.addEventListener('ended', () => {
    st.playing = false; duck(false); report(true); emit(true);
    const was = current;
    bus.emit('media:ended', was);
    // on the screen, as sound or in full screen the film ends for good: the screen rolls up, the mini player goes away
    if (st.mode === 'screen' || st.mode === 'audio' || st.mode === 'full') setTimeout(() => { if (current === was && video.ended) player.stop(); }, 5000);
  });
  video.addEventListener('waiting', () => { st.buffering = true; emit(true); });
  video.addEventListener('playing', () => { st.buffering = false; emit(true); });
  // 'auto' with one address per quality: stalls while the film plays (not just after a start or a seek) take it
  // one step down for the rest of the film, keeping the position
  let stallAt = 0, stallTimer = null, stalls = [], loadedAt = 0, seekedAt = 0;
  const autoWatch = () => qualityMode === 'source' && choice === 'auto' && !audioLowActive && !!current && !current.local
    && performance.now() - loadedAt > 4000 && performance.now() - seekedAt > 2500;
  video.addEventListener('seeking', () => { seekedAt = performance.now(); });
  video.addEventListener('waiting', () => {
    clearTimeout(stallTimer); stallAt = 0;
    if (!st.playing || video.seeking || !autoWatch()) return;
    stallAt = performance.now();
    stallTimer = setTimeout(() => stepDown('long'), STALL_LONG);
  });
  video.addEventListener('playing', () => {
    clearTimeout(stallTimer);
    if (!stallAt) return;
    const now = performance.now();
    stallAt = 0;
    stalls = [...stalls.filter((t) => now - t < STALL_WINDOW), now];
    if (stalls.length >= STALL_COUNT) stepDown('often');
  });
  video.addEventListener('pause', () => { clearTimeout(stallTimer); stallAt = 0; });
  video.addEventListener('volumechange', () => { if (st.muted !== video.muted) { st.muted = video.muted; emit(true); } });
  video.addEventListener('loadedmetadata', () => { st.duration = isFinite(video.duration) ? video.duration : (current?.duration || 0); st.buffering = false; noteSize(); emit(true); });
  video.addEventListener('resize', () => { if (noteSize()) emit(true); });
  video.addEventListener('progress', () => { updateBuffered(); });
  video.addEventListener('timeupdate', () => {
    st.position = video.currentTime || 0;
    if (isFinite(video.duration)) st.duration = video.duration;
    updateBuffered();
    if (st.playing) report(false);
    emit(false);
  });
  video.addEventListener('error', () => { if (hls || !video.getAttribute('src')) return; onSourceError(video.error?.code || 0); });
  function updateBuffered() {
    const b = video.buffered, t = video.currentTime || 0;
    let end = 0;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.5 && b.end(i) >= t) end = b.end(i);
    st.buffered = end;
  }

  // ---- subtitles -----------------------------------------------------------------------------------
  /** Subtitles are drawn by the browser inside the panel and in full screen ('showing') and only read for the
   *  HUD line on the screen ('hidden'). Our own <track> (MP4 films, downloads) is switched directly, the subtitle
   *  renditions of HLS streams through hls.js (live streams list the same subtitles twice). */
  function applySubtitleMode() {
    const shown = inContainer(st.mode);
    if (track) track.track.mode = st.subtitles ? (shown ? 'showing' : 'hidden') : 'disabled';
    let hlsSubs = 0;
    if (hls) {
      try {
        hlsSubs = hls.subtitleTracks?.length || 0;
        if (st.subtitles && hlsSubs) { if (hls.subtitleTrack < 0) hls.subtitleTrack = 0; hls.subtitleDisplay = shown; }
        else { hls.subtitleDisplay = false; if (hls.subtitleTrack >= 0) hls.subtitleTrack = -1; }
      } catch {}
    }
    st.hasSubtitles = !!track || hlsSubs > 0;
    if (!st.subtitles) st.cue = '';
  }
  function onCueChange(e) {
    const t = e.target;
    if (t.mode === 'disabled') return;
    const cues = [...(t.activeCues || [])];
    st.cue = cues.map((c) => c.text || '').join('\n').replace(/<[^>]+>/g, '').trim();
    emit(true);
  }
  video.textTracks.addEventListener('addtrack', (e) => { e.track.addEventListener('cuechange', onCueChange); applySubtitleMode(); emit(true); });
  function setTrack(url) {
    if (track) { track.remove(); track = null; }
    if (!url) { applySubtitleMode(); return; }
    track = document.createElement('track');
    track.kind = 'subtitles'; track.srclang = 'de'; track.label = 'Deutsch'; track.src = url; track.default = false;
    video.appendChild(track);
    track.track.mode = st.subtitles ? 'hidden' : 'disabled';
    const el = track;
    track.addEventListener('load', () => applySubtitleMode());
    // no subtitles from the broadcaster (removed, broken file): the button disappears again
    track.addEventListener('error', () => { if (track !== el) return; el.remove(); track = null; applySubtitleMode(); emit(true); });
    applySubtitleMode();
  }

  // ---- sources -------------------------------------------------------------------------------------
  /** The quick switch offers 'auto' and every size the film has (renditions or HLS levels), biggest first. */
  function qualitiesOf() {
    const list = qualityMode === 'levels' ? levelsOf(hls?.levels) : qualityMode === 'source' ? renditions : [];
    if (list.length < 2) return [];
    return [{ id: 'auto', label: OLD_NAMES.auto }, ...list.map((r) => ({ id: r.key, height: r.known === false ? 0 : r.height, label: r.label || OLD_NAMES[r.key] || r.key }))];
  }
  /** The size of the picture that plays, from the element (exact) or the rendition; true when it changed. */
  function noteSize() {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h || video.srcObject) return false;
    const p = classOf(w, h);
    // the playing rendition had no size yet: now it has one (its label appears in the menu)
    if (qualityMode === 'source' && st.quality && current?.video?.[st.quality]) {
      const known = current.heights?.[st.quality];
      if (!known || !known.height) {
        current.heights = { ...(current.heights || {}), [st.quality]: { width: w, height: h, p } };
        renditions = renditionsOf(current.video, current.heights);
        st.qualities = qualitiesOf();
      }
    }
    if (p === st.height) return false;
    st.height = p; st.level = labelOf(p);
    return true;
  }
  /** The rendition key the choice stands for right now: a key as it is, a height the closest size, 'auto' the biggest
   *  up to the window height (never above the size stalls brought it down to), as sound only the smallest. */
  function targetKey() {
    if (!renditions.length) return null;
    if (audioLowActive) return renditions[renditions.length - 1].key;
    if (typeof choice === 'string' && choice !== 'auto') {
      if (renditions.some((r) => r.key === choice)) return choice;
      const m = /^h(\d{3,4})$/.exec(choice);
      return (closest(renditions, m ? +m[1] : 'auto') || renditions[0]).key;
    }
    if (typeof choice === 'number') return closest(renditions, choice).key;
    return autoPick(renditions, (window.innerHeight || 0) * (window.devicePixelRatio || 1), autoCap).key;
  }
  /** 'auto' stalled: one step below the rendition that plays, for the rest of this film. */
  function stepDown(why) {
    if (!autoWatch() || !current?.video) return;
    const next = lower(renditions, st.quality);
    if (!next || next.url === current.video[st.quality]) return;
    console.info('[media] auto quality: ' + st.quality + ' → ' + next.key + ' (' + why + ' stalls)');
    autoCap = next.height; stalls = [];
    reloadAt(next.key);
  }
  /** The address for a rendition key (or the next one not tried yet, smaller ones first), not yet proxied. */
  function remoteFor(item, key) {
    if (item.src) return { url: item.src, quality: null };
    const list = renditions.length ? renditions : renditionsOf(item.video, item.heights);
    const i = Math.max(0, list.findIndex((r) => r.key === key));
    const order = [...list.slice(i), ...list.slice(0, i).reverse()];
    const r = order.find((x) => !triedQualities.has(x.key));
    return r ? { url: r.url, quality: r.key } : null;
  }
  /** Sizes of the renditions a film did not name (MediathekViewWeb): the main process reads them from the files. */
  function askHeights(item, my) {
    if (!item?.video || item.local || item.src || !renditions.some((r) => !r.known)) return Promise.resolve(false);
    return invoke('mediathek:heights', item).then((hs) => {
      if (my !== token || !hs || typeof hs !== 'object' || !Object.keys(hs).length) return false;
      item.heights = { ...(item.heights || {}), ...hs };
      renditions = renditionsOf(item.video, item.heights);
      st.qualities = qualitiesOf();
      if (st.quality) { const r = renditions.find((x) => x.key === st.quality); if (r && r.known && !st.height) { st.height = r.height; st.level = r.label; } }
      emit(true);
      return true;
    }).catch(() => false);
  }

  function teardownSource() {
    if (hls) { try { hls.destroy(); } catch {} hls = null; }
    try { video.pause(); } catch {}
    video.srcObject = null;
    video.removeAttribute('src');
    try { video.load(); } catch {}
  }

  /** Play an HLS address with hls.js; false when hls.js cannot run here (then the browser tries itself). */
  async function loadHls(url, my) {
    let Hls;
    try { Hls = (await import('hls.js/dist/hls.js')).default; }
    catch { Hls = (await import('hls.js')).default; }
    if (my !== token) return true;
    if (!Hls?.isSupported?.()) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) return false;
      throw Object.assign(new Error(ERROR_TEXT.format), { kind: 'format' });
    }
    hls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 60, maxBufferLength: 40, renderTextTracksNatively: true, subtitleDisplay: !!st.subtitles, capLevelToPlayerSize: false, startLevel: -1 });
    let recovered = false;
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (qualityMode !== 'source' && hls.levels?.length > 1) { qualityMode = 'levels'; st.quality = levelChoiceKey(); }
      st.qualities = qualitiesOf();
      applyHlsQuality();
      applySubtitleMode();
      emit(true);
    });
    hls.on(Hls.Events.LEVEL_LOADED, (_e, data) => { if (data?.details?.live && !st.live) { st.live = true; emit(true); } });
    // what plays at the moment (the quick switch shows it next to "Automatisch")
    hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
      if (qualityMode !== 'levels') return;
      const l = hls.levels?.[data?.level];
      const p = l ? classOf(l.width, l.height) : 0;
      if (p && p !== st.height) { st.height = p; st.level = labelOf(p); emit(true); }
    });
    hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => { applySubtitleMode(); emit(true); });
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data?.fatal || my !== token) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) { recovered = true; try { hls.recoverMediaError(); } catch {} return; }
      const code = data.response?.code ?? data.networkDetails?.status ?? 0;
      let kind = null;
      try { kind = data.networkDetails?.getResponseHeader?.('X-Mediathek-Error') || null; } catch {}
      if (!kind) kind = data.type === Hls.ErrorTypes.NETWORK_ERROR ? kindOfStatus(code) : data.type === Hls.ErrorTypes.MEDIA_ERROR ? 'format' : 'unknown';
      fail(kind);
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    return true;
  }
  /** The level the choice stands for: a level key as it is, a height or an old name the closest size, else 'auto'. */
  function levelFor(levels) {
    if (choice === 'auto' || choice == null) return null;
    const byKey = typeof choice === 'string' && levels.find((l) => l.key === choice);
    if (byKey) return byKey;
    const pref = typeof choice === 'number' ? choice : preferenceOf(choice);
    if (pref === 'auto') return null;
    return closest(levels.filter((l) => l.height), pref) || null;
  }
  const levelChoiceKey = () => { const l = levelFor(levelsOf(hls?.levels)); return l ? l.key : 'auto'; };
  function applyHlsQuality() {
    if (!hls || qualityMode !== 'levels' || !hls.levels?.length) return;
    const levels = levelsOf(hls.levels);
    const inAudio = st.mode === 'audio' && audioLowActive;
    const pick = inAudio ? levels[levels.length - 1] : levelFor(levels);
    st.quality = inAudio ? st.quality : (pick ? pick.key : 'auto');
    if (!pick) { hls.autoLevelCapping = -1; hls.nextLevel = -1; return; }
    if (inAudio) { hls.autoLevelCapping = pick.index; hls.nextLevel = pick.index; }
    else { hls.autoLevelCapping = -1; hls.currentLevel = pick.index; }
  }

  /** Load the film; `quality` is a rendition key, without one the choice decides. */
  async function loadSource(item, quality, my) {
    teardownSource();
    st.live = !!item.live;
    loadedAt = performance.now();
    if (item.stream) { video.srcObject = item.stream; remoteUrl = null; st.qualities = []; renditions = []; return; }
    renditions = item.src ? [] : renditionsOf(item.video, item.heights);
    qualityMode = renditions.length > 1 ? 'source' : null;
    const pick = remoteFor(item, quality || targetKey());
    if (!pick) throw Object.assign(new Error(ERROR_TEXT.unknown), { kind: 'unknown' });
    remoteUrl = /^https?:/i.test(pick.url) ? pick.url : null;
    const r = renditions.find((x) => x.key === pick.quality);
    st.quality = qualityMode === 'source' ? pick.quality : null;
    st.height = r && r.known ? r.height : 0; st.level = st.height ? labelOf(st.height) : null;
    const src = proxied(pick.url);
    const isHls = item.hls || /\.m3u8(\?|$)/i.test(pick.url) || /^media:\/\/local\//.test(src);
    st.qualities = qualitiesOf();
    // hls.js (MSE) even where Chromium announces native HLS: only hls.js loads every playlist and segment
    // through media:// (CORS-clean for the screen), the native player fails on the rewritten playlists
    if (isHls && await loadHls(src, my)) return;
    video.src = src;
  }

  // ---- errors --------------------------------------------------------------------------------------
  function fail(kind, message) {
    st.playing = false; st.buffering = false;
    st.errorKind = kind || 'unknown';
    st.error = current?.live && st.errorKind !== 'format' ? tr(LIVE_UNREACHABLE) : message || ERROR_TEXT[st.errorKind] || ERROR_TEXT.unknown;
    duck(false);
    emit(true);
    if (waiter) { const w = waiter; waiter = null; w(); }
  }
  /** video.play(), but settled as soon as a failure is known: with hls.js a broken stream (geo blocking,
   *  expired) never lets the element's own play() promise settle. */
  let waiter = null;
  function startPlayback() {
    return new Promise((resolve, reject) => {
      const done = () => { if (waiter === done) waiter = null; resolve(); };
      waiter = done;
      video.play().then(done, (e) => { if (waiter === done) waiter = null; reject(e); });
    });
  }
  /** The <video> element failed: try another quality first, then ask the main process why. */
  async function onSourceError(code) {
    const it = current, my = token;
    if (!it) return;
    if (qualityMode === 'source' && st.quality) {
      triedQualities.add(st.quality);
      const next = remoteFor(it, lower(renditions, st.quality)?.key || st.quality);
      if (next) {
        const at = video.currentTime || st.position || 0;
        try { await loadSource(it, next.quality, my); if (at > 1) seekWhenReady(at); await startPlayback(); return; } catch {}
      }
    }
    if (it.local) { fail(code === 4 ? 'missing' : 'format'); return; }
    fail('unknown');
    if (remoteUrl) {
      const d = await invoke('mediathek:diagnose', remoteUrl).catch(() => null);
      if (my === token && d?.kind) fail(d.kind === 'format' ? 'format' : d.kind, ERROR_TEXT[d.kind] || d.message);
    }
  }

  function seekWhenReady(sec) {
    const go = () => { try { video.currentTime = sec; } catch {} };
    if (video.readyState >= 1) go();
    else video.addEventListener('loadedmetadata', go, { once: true });
  }

  // ---- 'audio' mode: switch to the smallest quality after a while ------------------------------------
  // (a film started as sound only begins with it: play() sets audioLowActive)
  let audioLowActive = false;
  function scheduleAudioLow() {
    clearTimeout(audioLowTimer);
    if (st.mode === 'audio') {
      if (audioLowActive) return;
      audioLowTimer = setTimeout(() => {
        if (st.mode !== 'audio' || !current) return;
        audioLowActive = true;
        applyChoice();
      }, AUDIO_LOW_DELAY);
    } else if (audioLowActive) {
      audioLowActive = false;
      applyChoice();
    }
  }

  /** Follow the choice (and the 'audio' mode): HLS levels switch in place, MP4 loads the matching address at the
   *  same position. */
  function applyChoice() {
    if (!current) return Promise.resolve();
    st.choice = choice;
    if (qualityMode === 'levels') { applyHlsQuality(); emit(true); return Promise.resolve(); }
    if (qualityMode !== 'source') { emit(true); return Promise.resolve(); }
    const v = current.video || {};
    const q = targetKey();
    if (!q || q === st.quality) { emit(true); return Promise.resolve(); }
    // two names for the same file (some broadcasters list it twice): nothing to load
    if (v[q] === v[st.quality]) { st.quality = q; emit(true); return Promise.resolve(); }
    return reloadAt(q);
  }
  /** Load the address of another quality and go on at the same position (playing or paused as before). */
  async function reloadAt(q) {
    if (!current || qualityMode !== 'source' || !current.video?.[q] || st.quality === q) { emit(true); return; }
    const at = video.currentTime || 0, wasPlaying = !video.paused, my = ++token;
    triedQualities = new Set();
    st.buffering = true; emit(true);
    try {
      await loadSource(current, q, my);
      setTrack(subtitleTrackUrl(current));
      if (at > 1) seekWhenReady(at);
      if (wasPlaying) await startPlayback();
    } catch (e) { if (e?.name !== 'AbortError' && my === token) fail(e.kind || 'unknown', e.message); }
  }
  /** What the quick switch, a setting or a test hands in → the choice: 'auto', a rendition or level key, or a height
   *  ('720p', 720; the old names 'low' | 'sd' | 'hd' stay keys when the film has them). */
  function choiceOf(q) {
    if (q === 'auto' || q == null) return 'auto';
    if (typeof q === 'string' && (current?.video?.[q] || /^h\d{3,4}$/.test(q))) return q;
    return preferenceOf(q);
  }
  /** Up to 0.5 the quick switch remembered the last quality in localStorage: it becomes the setting, once (as the
   *  height it stands for since 0.7). */
  function migrateQuality() {
    const old = store.get(QUALITY_KEY);
    if (old == null) return;
    try { localStorage.removeItem(QUALITY_KEY); } catch {}
    if (!['low', 'sd', 'hd'].includes(old)) return;
    try { Promise.resolve((audioCtx?.api || api)?.settings?.set?.({ mediathek: { quality: preferenceOf(old) } })).catch(() => {}); } catch {}
  }

  const player = {
    video,
    get current() { return current; },
    get mode() { return st.mode; },
    get state() { return snapshot(); },
    get hls() { return hls; },
    /** ctx.audio ducks (and pauses) the background music while a film plays, ctx.state.settings.mediathek.quality is
     *  the quality a film starts with; a new choice in the settings applies to the running film as well. */
    bindContext(ctx) {
      audioCtx = ctx;
      migrateQuality();
      let last = settingsChoice();
      try {
        (ctx.api || api)?.settings?.onChange?.((s) => {
          const q = preferenceOf(s?.mediathek?.quality);
          if (q === last) return;
          last = q;
          if (current) player.setQuality(q);
        });
      } catch {}
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async play(item, { mode = 'panel', startAt = 0, quality, restart = false } = {}) {
      if (!item || (!item.src && !item.stream && !item.video)) throw new Error('Keine Videoquelle');
      // the same film again (e.g. "Ansehen" while it plays as audio): only change the way it is shown
      if (!restart && current && item.id && current.id === item.id && !st.error && !!item.local === !!current.local) {
        player.setMode(mode);
        if (video.paused) player.resume();
        return;
      }
      if (current && current !== item) report(true);
      const prevMode = st.mode;
      const my = ++token;
      // as sound only the film starts in its smallest quality (scheduleAudioLow)
      current = item; triedQualities = new Set(); audioLowActive = mode === 'audio'; clearTimeout(audioLowTimer);
      st.error = null; st.errorKind = null; st.position = 0; st.duration = item.duration || 0; st.buffering = true; st.cue = ''; st.buffered = 0; st.live = !!item.live;
      st.mode = mode;
      choice = quality != null ? choiceOf(quality) : settingsChoice(); autoCap = null; stalls = []; clearTimeout(stallTimer); stallAt = 0;
      st.choice = choice; st.quality = null; st.level = null; st.height = 0; renditions = [];
      if (!inContainer(mode) || !video.parentNode || video.parentNode === parking) park();
      applyVolume();
      video.poster = item.poster || '';
      // the start itself takes the focus (not only the 'play' event): a podcast pauses at once, and a film that
      // fails before it plays still shows up in the mini player
      mediaFocus.claim('film');
      emit(true);
      if (prevMode !== mode) bus.emit('media:mode', mode);
      try {
        // a film whose sizes are not all known (MediathekViewWeb): a preferred height waits a moment for them, so
        // that the closest size plays from the start; 'auto' starts at once and the labels follow
        renditions = item.src ? [] : renditionsOf(item.video, item.heights);
        const asked = askHeights(item, my);
        if (typeof choice === 'number' && renditions.some((r) => !r.known)) await Promise.race([asked, new Promise((r) => setTimeout(r, HEIGHTS_WAIT))]);
        if (my !== token) return;
        await loadSource(item, undefined, my);
        if (my !== token) return;
        setTrack(subtitleTrackUrl(item));
        if (startAt > 1 && !item.live) seekWhenReady(startAt);
        // a podcast or a reading was started while the film was still loading: it stays loaded but paused
        if (heldToken === my) { st.buffering = false; emit(true); return; }
        await startPlayback();
        lastReport = Date.now();
        scheduleAudioLow();
      } catch (e) {
        if (e?.name === 'AbortError' || my !== token) return;       // a newer play() replaced this one
        fail(e?.kind || (e?.name === 'NotSupportedError' ? 'format' : 'unknown'), e?.kind ? e.message : undefined);
        if (e?.name === 'NotSupportedError') onSourceError(4);
      }
    },
    /** 'panel' and 'full' need a container: enter them with attach(container, mode); setMode() parks the video
     *  for 'audio' and 'screen'. */
    setMode(mode) {
      if (mode === st.mode) return;
      st.mode = current ? mode : null;
      if (!inContainer(mode)) park();
      applyVolume();
      applySubtitleMode();
      scheduleAudioLow();
      emit(true);
      bus.emit('media:mode', st.mode);
    },
    toggle() { if (!current) return; if (video.paused) player.resume(); else video.pause(); },
    pause() { video.pause(); },
    resume() {
      if (!current) return;
      if (st.error) { player.retry(); return; }
      video.play().catch((e) => { if (e?.name !== 'AbortError') fail('unknown', e.message); });
    },
    /** Load the current film again (after an error), at the position it had. */
    retry() {
      if (!current) return;
      const it = current, at = st.position;
      return player.play(it, { mode: st.mode || 'panel', startAt: at, quality: choice, restart: true });
    },
    seek(sec) { if (!current || current.live || st.live) return; const d = isFinite(video.duration) ? video.duration : sec; video.currentTime = Math.max(0, Math.min(sec, d)); st.position = video.currentTime; emit(true); },
    skip(delta) { player.seek((video.currentTime || 0) + delta); },
    stop() {
      const was = current;
      if (was) report(true);
      token++;
      clearTimeout(audioLowTimer); audioLowActive = false; clearTimeout(stallTimer); stallAt = 0; autoCap = null;
      setTrack(null);
      teardownSource();
      video.poster = '';
      current = null; remoteUrl = null; st.mode = null; st.playing = false; st.buffering = false; st.position = 0; st.duration = 0; st.error = null; st.errorKind = null;
      st.qualities = []; st.quality = null; qualityMode = null; st.hasSubtitles = false; st.cue = ''; st.buffered = 0; st.live = false;
      st.choice = null; st.level = null; st.height = 0; renditions = [];
      park(); duck(false); applyVolume();
      emit(true);
      if (was) bus.emit('media:stopped', was);
      mediaFocus.changed();   // a paused podcast becomes the active source again
    },
    setVolume(v) { st.volume = Math.max(0, Math.min(1, v)); if (st.volume > 0 && video.muted) video.muted = false; applyVolume(); store.set(VOLUME_KEY, String(st.volume)); emit(true); },
    setSpatialGain(g) { const n = Math.max(0, Math.min(1, g)); if (Math.abs(n - st.spatialGain) < 0.005) return; st.spatialGain = n; applyVolume(); },
    toggleMute() { video.muted = !video.muted; st.muted = video.muted; emit(true); },
    setMuted(m) { video.muted = !!m; st.muted = video.muted; emit(true); },
    /** The quick switch: a quality for the running film ('auto', a rendition or level key like 'sd' or 'h720', or a
     *  height like 720 or '720p'), at the same position. */
    setQuality(q) {
      if (!current) return Promise.resolve();
      choice = choiceOf(q); autoCap = null; stalls = [];
      return applyChoice();
    },
    setSubtitles(on) { st.subtitles = !!on; store.set(SUBS_KEY, on ? '1' : '0'); applySubtitleMode(); emit(true); },
    /** Show the video inside a container: a panel layout ('panel') or the full screen view ('full'). */
    attach(container, mode = 'panel') {
      container.appendChild(video);
      if (current && st.mode !== mode) { st.mode = mode; applyVolume(); applySubtitleMode(); scheduleAudioLow(); emit(true); bus.emit('media:mode', mode); }
    },
    /** Take the video out of a panel again (it keeps playing, parked). */
    detach() { park(); },
  };
  mediaFocus.register('film', {
    hold() { heldToken = token; if (!video.paused) video.pause(); },
    loaded: () => !!current,
  });
  park();
  window.addEventListener('beforeunload', () => report(true));
  return player;
}

export const mediaPlayer = (globalThis.__cozyshelvesMediaPlayer ||= createPlayer());
export const formatTime = (s) => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(sec).padStart(2, '0'); };
export default mediaPlayer;
