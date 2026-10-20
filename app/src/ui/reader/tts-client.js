// Read-aloud client. Four engines behind one façade:
//   English  – Kokoro in a Web Worker (app/dist/tts-worker.js), unchanged.
//   German   – Piper/VITS (Thorsten, Karlsson, Pavoque, Kerstin, Eva …) in a Web Worker
//              (app/dist/piper-worker.js); the voice files are downloaded once by the main process
//              (electron/tts/piper.js) into <userData>/piper-voices and handed over as lfile:// URLs.
//   German   – Kokoro/StyleTTS2 "Martin" in a Web Worker (app/dist/kokoro-de-worker.js); same download
//              mechanism, two files (kokoro-martin.onnx + voices-martin.npz).
//   German   – Kartoffelbox/Chatterbox via the Python sidecar: LEGACY, only used when the user explicitly
//              selects that voice and tts-server/ is installed. Never started on its own any more.
// Everything plays through a single AudioContext: the sentences are synthesized ahead and put on its timeline
// sample-exactly, trimmed to the speech, levelled in loudness and separated by fixed pauses (tts-audio.js).
//
//   import { ttsClient } from './tts-client.js';
//   await ttsClient.status()  → { english, german, englishDetail, germanDetail, piperDetail, … }
//   await ttsClient.voices('de'|'en') → [{ id, name, language, gender, engine, installed?, bytes? }]
//   const session = ttsClient.speak(sentences, { lang, voice, speed, onSentence(i), onEnd(), onError(e), onStatus(s) });
//   session.pause() / resume() / stop() / skip(±1) / session.playing / session.paused / session.index
//   ttsClient.speakText(text, opts), ttsClient.stopAll(), ttsClient.warmup('en'|'de'), ttsClient.dispose()
//   ttsClient.installVoice(id) / removeVoice(id)      (German Piper voices – used by the settings panel)
//   ttsClient.englishModel() → { cached, bytes, dtype }; installEnglish(); downloadAllVoices() / cancelDownloads()
//   bus: 'tts:speak' {text, lang} → speakText, 'tts:stop' → stopAll, emits 'tts:status' and 'tts:downloads'
// Every sentence can carry its own language (opts.langs): a German book with an English quote reads the quote with
// the English voice. Chess notation is written out in words for the voice (tts-chess.js), text that is junk
// (tts-junk.js) never reaches a voice. A voice or speed chosen while a reading runs takes over from the next sentence.
// One source at a time (app/src/media/focus.js): a reading that starts or resumes pauses a film or a podcast, and a
// film or a podcast that starts pauses the reading (session.paused; the bars follow it through onStatus).
import { api } from '../../core/api.js';
import { bus } from '../../core/bus.js';
import { tr } from '../../core/i18n.js';
import { audio } from '../../audio/engine.js';
import { mediaFocus } from '../../media/focus.js';
import { detectLanguage, scoreLanguages, splitSentences, normalizeForSpeech, planLanguages, normalizeLangCode } from './tts-lang.js';
import { hasChessNotation, speakChess } from './tts-chess.js';
import { inspectText } from './tts-junk.js';
import { cleanPiece, nextGain, applyGain, resample } from './tts-audio.js';
import { DEFAULT_GERMAN_VOICE, KOKORO_DE_VOICE, KARTOFFEL_PREFIX, GERMAN_ENGINES, engineForVoice, resolveGermanVoice } from './tts-voice-id.js';

export { DEFAULT_GERMAN_VOICE, KOKORO_DE_VOICE, engineForVoice, resolveGermanVoice };

const PREFETCH = 3;          // sentences synthesized ahead of the one playing
const CHUNK_LEN = 300;       // max characters per synthesis request (all engines degrade on very long inputs)
const FIRST_CHUNK_LEN = 90;  // the first sentence of a reading goes out in shorter pieces: the first audio comes sooner
const SENTENCE_PAUSE = 0.32; // seconds between two sentences at speed 1 (the voices' own silence is trimmed first)
const CLAUSE_PAUSE = 0.12;   // between the pieces of one long sentence
const LEAD = 0.06;           // seconds between scheduling a sound and its start
const HORIZON = 6;           // at most this many seconds of audio are scheduled ahead of what sounds now
const IDLE_DISPOSE_MS = 120000; // free the models when nothing has been spoken for two minutes
const HEAVY_IDLE_DISPOSE_MS = 600000; // ten minutes for the voices on the graphics card: they need 5 to 10 s to start

export const KOKORO_VOICES = [
  ['af_heart', 'Heart (US, weiblich)', 'en-us', 'Female'], ['af_bella', 'Bella (US, weiblich)', 'en-us', 'Female'],
  ['af_nicole', 'Nicole (US, weiblich)', 'en-us', 'Female'], ['af_aoede', 'Aoede (US, weiblich)', 'en-us', 'Female'],
  ['af_kore', 'Kore (US, weiblich)', 'en-us', 'Female'], ['af_sarah', 'Sarah (US, weiblich)', 'en-us', 'Female'],
  ['af_nova', 'Nova (US, weiblich)', 'en-us', 'Female'], ['af_sky', 'Sky (US, weiblich)', 'en-us', 'Female'],
  ['af_alloy', 'Alloy (US, weiblich)', 'en-us', 'Female'], ['af_jessica', 'Jessica (US, weiblich)', 'en-us', 'Female'],
  ['af_river', 'River (US, weiblich)', 'en-us', 'Female'],
  ['am_michael', 'Michael (US, männlich)', 'en-us', 'Male'], ['am_fenrir', 'Fenrir (US, männlich)', 'en-us', 'Male'],
  ['am_puck', 'Puck (US, männlich)', 'en-us', 'Male'], ['am_adam', 'Adam (US, männlich)', 'en-us', 'Male'],
  ['am_echo', 'Echo (US, männlich)', 'en-us', 'Male'], ['am_eric', 'Eric (US, männlich)', 'en-us', 'Male'],
  ['am_liam', 'Liam (US, männlich)', 'en-us', 'Male'], ['am_onyx', 'Onyx (US, männlich)', 'en-us', 'Male'],
  ['am_santa', 'Santa (US, männlich)', 'en-us', 'Male'],
  ['bf_emma', 'Emma (GB, weiblich)', 'en-gb', 'Female'], ['bf_isabella', 'Isabella (GB, weiblich)', 'en-gb', 'Female'],
  ['bf_alice', 'Alice (GB, weiblich)', 'en-gb', 'Female'], ['bf_lily', 'Lily (GB, weiblich)', 'en-gb', 'Female'],
  ['bm_george', 'George (GB, männlich)', 'en-gb', 'Male'], ['bm_fable', 'Fable (GB, männlich)', 'en-gb', 'Male'],
  ['bm_lewis', 'Lewis (GB, männlich)', 'en-gb', 'Male'], ['bm_daniel', 'Daniel (GB, männlich)', 'en-gb', 'Male'],
].map(([id, name, language, gender]) => ({ id, name, language, gender, engine: 'kokoro' }));
const KOKORO_IDS = new Set(KOKORO_VOICES.map((v) => v.id));

/** Fallback list when the main process cannot be reached (browser mock): same ids as electron/tts/piper.js. */
export const PIPER_VOICES_FALLBACK = [{
  id: 'de_DE-martin-kokoro', name: 'Martin (Kokoro)', gender: 'male', bytes: 326035136,
  language: 'de', engine: 'kokoro-de', installed: false, quality: 'high', gpu: true,
  note: 'kikiri-tts/Kokoro-82M, natürlichste deutsche Stimme (Standard), 311 MB, rechnet auf der Grafikkarte (WebGPU)',
}].concat([
  { id: 'de_DE-thorsten-medium', name: 'Thorsten (mittel)', gender: 'male', bytes: 63201294 },
  { id: 'de_DE-thorsten-high', name: 'Thorsten (hoch)', gender: 'male', bytes: 113895201, gpu: true },
  { id: 'de_DE-thorsten-low', name: 'Thorsten (schnell)', gender: 'male', bytes: 63104526 },
  { id: 'de_DE-thorsten_emotional-medium', name: 'Thorsten emotional', gender: 'male', bytes: 76745905 },
  { id: 'de_DE-karlsson-low', name: 'Karlsson (männlich)', gender: 'male', bytes: 63104526 },
  { id: 'de_DE-pavoque-low', name: 'Pavoque (männlich)', gender: 'male', bytes: 63104526 },
  { id: 'de_DE-kerstin-low', name: 'Kerstin (weiblich)', gender: 'female', bytes: 63104526 },
  { id: 'de_DE-ramona-low', name: 'Ramona (weiblich)', gender: 'female', bytes: 63104526 },
  { id: 'de_DE-eva_k-x_low', name: 'Eva (weiblich, klein)', gender: 'female', bytes: 20628813 },
].map((v) => ({ ...v, language: 'de', engine: 'piper', installed: false })));
/** The two German engines that run as an ONNX graph in a Web Worker (same voice-file mechanism). */
const GERMAN_ONNX_ENGINES = ['piper', 'kokoro-de'];
/** Engines with a real speed parameter – only the others need the pitch-shifting playbackRate hack. */
const NATIVE_SPEED = { kokoro: true, piper: true, 'kokoro-de': true, kartoffelbox: false };
/** The Piper voice a fallback to Piper prefers when the chosen voice belongs to another engine. */
const PIPER_FALLBACK_VOICE = 'de_DE-thorsten-medium';

// --- shared state ---------------------------------------------------------------------------------------------
let ctx = null;                 // AudioContext
let settingsCache = null;
let settingsPromise = null;
const sessions = new Set();
let ducked = false;

// cached: is the English model on this computer (null = not asked yet), bytes: its size for the interface
const english = { state: 'idle', progress: 0, message: '', device: null, dtype: null, error: null, cached: null, bytes: 92364770 }; // idle|loading|ready|error
const german = { known: false, available: false, running: false, starting: false, port: null, model: null, device: null, error: null, message: '', progress: 0 };
const piper = { known: false, available: false, state: 'idle', progress: 0, message: '', voice: null, error: null, voices: [], dir: null };

function getContext() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' }); }
    catch (e) { throw new Error('Web Audio nicht verfügbar: ' + (e?.message || e)); }
  }
  return ctx;
}

function getSettings() {
  if (settingsCache) return Promise.resolve(settingsCache);
  if (settingsPromise) return settingsPromise;
  settingsPromise = (async () => {
    try { settingsCache = (await api.settings.get()) || {}; } catch { settingsCache = {}; }
    try {
      api.settings.onChange?.((s) => {
        const before = voiceKey();
        settingsCache = s || settingsCache;
        // a voice or a speed chosen during a reading (voice menu, settings) takes over from the next sentence
        if (voiceKey() !== before) for (const ses of sessions) { try { ses.retune(); } catch {} }
      });
    } catch {}
    return settingsCache;
  })().finally(() => { settingsPromise = null; });
  return settingsPromise;
}
const ttsSettings = () => (settingsCache && settingsCache.tts) || {};
const voiceKey = () => { const t = ttsSettings(); return [t.germanVoice, t.englishVoice, t.speed, t.germanSpeaker].join('|'); };

// --- test hooks: what reaches the voices (build/scripts/reader-tts-check.js) -------------------------------------
// window.__ttsTrace = [] collects one entry per sentence: the text, what is spoken, language, engine and voice, and the
// phonemes the German workers made. window.__ttsDryRun = true answers every request with a short quiet tone instead of
// a voice, so that the checks run without models and fast (the harness is muted anyway); a number is the length of
// that tone in seconds.
function traceEntry(entry) {
  try { const t = window.__ttsTrace; if (!Array.isArray(t)) return null; t.push(entry); if (t.length > 3000) t.splice(0, t.length - 3000); return entry; } catch { return null; }
}
const dryRun = () => { try { return !!window.__ttsDryRun; } catch { return false; } };
function dryAudio(text) {
  let per = null;
  try { per = typeof window.__ttsDryRun === 'number' ? window.__ttsDryRun : null; } catch {}
  const sampleRate = 24000, secs = per ?? Math.min(2.5, 0.12 + String(text).length * 0.035);
  const samples = new Float32Array(Math.round(sampleRate * secs));
  for (let i = 0; i < samples.length; i++) samples[i] = 0.05 * Math.sin(i * 2 * Math.PI * 220 / sampleRate);
  return new Promise((r) => setTimeout(() => r({ sampleRate, samples, phonemes: null, phonemizer: 'dry', synthMs: 5 }), 5));
}

function setDuck(on) {
  if (on === ducked) return;
  ducked = on;
  try { if (typeof audio?.duck === 'function') audio.duck(on, 'tts'); } catch (e) { console.warn('[tts] duck failed', e); }
}
function refreshDuck() {
  setDuck([...sessions].some((s) => !s.stopped && s.started));
}

// --- status -----------------------------------------------------------------------------------------------------
function englishState() {
  if (typeof Worker === 'undefined') return 'unavailable';
  if (english.state === 'ready') return 'ready';
  if (english.state === 'error') return 'unavailable';
  return 'loading'; // idle (loads on first use) or loading
}
function germanState() {
  // Piper is the default German engine; the sidecar only counts when it is actually installed.
  if (piper.state === 'ready') return 'ready';
  if (piper.state === 'loading') return 'loading';
  if (piper.available) return piper.state === 'error' ? 'unavailable' : 'loading';
  if (german.running) return 'ready';
  if (german.starting) return 'starting';
  if (german.known && german.available) return 'starting';
  // voices are known but not downloaded yet – they are fetched on the first read-aloud
  if (piper.voices.length && typeof api.invoke === 'function' && piper.state !== 'error') return 'loading';
  return piper.known || german.known ? 'not-installed' : 'unavailable';
}
function snapshot(extra = {}) {
  const active = [...sessions].find((s) => !s.stopped) || null;
  return {
    english: englishState(), german: germanState(),
    englishDetail: { ...english }, germanDetail: { ...german }, piperDetail: { ...piper, voices: piper.voices.map((v) => ({ ...v })) },
    active: !!active, paused: !!active?.paused, index: active ? active.index : -1, total: active ? active.total : 0, lang: active?.lang || null,
    message: extra.message || piper.message || german.message || english.message || '',
    ...extra,
  };
}
let statusTimer = null;
let pendingExtra = null;
function emitStatus(extra) {
  // coalesce bursts (download progress) into one event – but never drop the newest message
  if (extra) pendingExtra = extra;
  if (statusTimer) return;
  statusTimer = setTimeout(() => {
    statusTimer = null;
    const e = pendingExtra; pendingExtra = null;
    const s = snapshot(e || undefined);
    try { bus.emit('tts:status', s); } catch {}
    for (const ses of sessions) { try { ses.opts.onStatus?.(s); } catch {} }
  }, 30);
}

function applyGermanStatus(st) {
  if (!st || typeof st !== 'object') return;
  german.known = true;
  if ('available' in st) german.available = !!st.available;
  if ('running' in st) german.running = !!st.running;
  if ('starting' in st) german.starting = !!st.starting;
  if ('port' in st) german.port = st.port || null;
  if ('model' in st) german.model = st.model || null;
  if ('device' in st) german.device = st.device || null;
  german.error = st.error || null;
  german.message = st.message || '';
  german.progress = typeof st.progress === 'number' ? st.progress : german.progress;
  if (german.running) german.starting = false;
  emitStatus();
}
try { api.tts?.onStatus?.((st) => applyGermanStatus(st)); } catch {}

async function refreshGerman() {
  try { const st = await api.tts?.status?.(); if (st) applyGermanStatus(st); else { german.known = true; german.available = false; } }
  catch (e) { german.known = true; german.available = false; german.error = e?.message || String(e); }
  return german;
}

// --- German: Piper voice files (main process) ---------------------------------------------------------------------
const piperVoiceCache = new Map(); // id → { modelUrl, config, name }
let piperVoicesPromise = null;

function applyPiperStatus(st) {
  if (!st || typeof st !== 'object') return;
  piper.known = true;
  if (Array.isArray(st.voices)) { piper.voices = st.voices; piper.available = st.voices.some((v) => v.installed); }
  if (st.dir) piper.dir = st.dir;
  if (st.state) piper.state = st.state === 'downloading' ? 'loading' : st.state;
  if (typeof st.progress === 'number') piper.progress = st.progress;
  if (st.message) piper.message = st.message;
  if (st.id) piper.voice = st.id;
  piper.error = st.error || null;
  emitStatus(st.message ? { message: st.message } : undefined);
}
try { api.on?.('tts:piper', (st) => applyPiperStatus(st)); } catch {}

async function refreshPiper(force) {
  if (piperVoicesPromise && !force) return piperVoicesPromise;
  piperVoicesPromise = (async () => {
    try {
      const res = await api.invoke?.('tts:piperVoices');
      if (res && Array.isArray(res.voices) && res.voices.length) {
        piper.known = true;
        piper.voices = res.voices.map((v) => ({ ...v, language: 'de', engine: v.engine || 'piper' }));
        piper.available = piper.voices.some((v) => v.installed);
        piper.dir = res.dir || piper.dir;
        piper.error = res.error || null;
      } else {
        piper.known = true; piper.available = false;
        piper.voices = PIPER_VOICES_FALLBACK.map((v) => ({ ...v }));
        piper.error = res?.error || null;
      }
    } catch (e) {
      piper.known = true; piper.available = false;
      piper.voices = PIPER_VOICES_FALLBACK.map((v) => ({ ...v }));
      piper.error = e?.message || String(e);
    }
    return piper.voices;
  })().finally(() => { piperVoicesPromise = null; });
  return piperVoicesPromise;
}

/** Downloads the voice on first use (progress goes out as tts:status) and caches its URL + config. */
async function ensurePiperVoice(id, opts = {}) {
  const voiceId = id || DEFAULT_GERMAN_VOICE;
  const hit = piperVoiceCache.get(voiceId);
  if (hit) return hit;
  if (!api.invoke) throw new Error('Deutsche Sprachausgabe ist in dieser Umgebung nicht verfügbar');
  piper.state = 'loading'; piper.voice = voiceId;
  piper.message = piper.message || 'Deutsche Stimme wird vorbereitet …';
  emitStatus({ message: piper.message });
  let res;
  try { res = await api.invoke('tts:piperEnsure', voiceId, opts); }
  catch (e) { piper.state = 'error'; piper.error = e?.message || String(e); emitStatus({ message: piper.error }); throw e; }
  if (!res || res.error) {
    const code = res?.code || 'download-failed';
    const err = new Error(res?.error || 'Die deutsche Stimme konnte nicht geladen werden');
    err.code = code;
    if (code === 'offline') err.message = 'Keine Internetverbindung. Die deutsche Stimme muss einmalig heruntergeladen werden.';
    // a download the user cancelled is no failure of the engine: the status goes back to "not loaded yet"
    if (code === 'cancelled') { piper.state = 'idle'; piper.error = null; piper.message = ''; }
    else { piper.state = 'error'; piper.error = err.message; }
    emitStatus({ message: code === 'cancelled' ? 'Download abgebrochen' : err.message });
    throw err;
  }
  const entry = {
    id: voiceId, name: res.name || voiceId, modelUrl: res.modelUrl, config: res.config,
    sampleRate: res.sampleRate, engine: res.engine || engineForVoice(voiceId) || 'piper',
    voicesUrl: res.voicesUrl || null, voiceName: res.voiceName || null, gpu: !!res.gpu,
  };
  piperVoiceCache.set(voiceId, entry);
  piper.available = true; piper.state = 'ready'; piper.error = null;
  const v = piper.voices.find((x) => x.id === voiceId);
  if (v) v.installed = true;
  emitStatus();
  return entry;
}

// --- worker plumbing ------------------------------------------------------------------------------------------
function makeWorkerHost(name, file, onStatusMessage) {
  const host = {
    worker: null, seq: 0, pending: new Map(), readyWaiters: [], idleTimer: null,
    url: () => new URL('dist/' + file, document.baseURI).href,
  };
  host.ensure = () => {
    if (host.idleTimer) { clearTimeout(host.idleTimer); host.idleTimer = null; }
    if (host.worker) return host.worker;
    if (typeof Worker === 'undefined') throw new Error('Web Worker nicht verfügbar');
    const w = new Worker(host.url(), { type: 'module', name });
    host.worker = w;
    w.onmessage = (ev) => {
      const m = ev.data || {};
      if (m.type === 'status') { onStatusMessage(m, host); if (m.restart && host.restart) host.restart(m.restart); return; }
      // the worker asked for a fresh instance (see tts-worker.js): the request is sent again, not failed
      if (m.type === 'error' && m.restart && host.restart) return;
      const p = m.id != null ? host.pending.get(m.id) : null;
      if (!p) return;
      host.pending.delete(m.id);
      clearTimeout(p.timer);
      p.off?.();
      if (m.type === 'cached') p.resolve(m);
      else if (m.type === 'audio') p.resolve({ sampleRate: m.sampleRate || 24000, samples: m.samples, phonemes: m.phonemes || null, phonemizer: m.phonemizer || null, synthMs: m.synthMs || 0 });
      else if (m.type === 'cancelled') p.reject(Object.assign(new Error('cancelled'), { cancelled: true }));
      else p.reject(new Error(m.error || 'Synthese fehlgeschlagen'));
    };
    w.onerror = (e) => {
      console.error('[tts]', name, 'worker error', e?.message || e);
      const msg = e?.message || 'Worker-Fehler';
      for (const [, p] of host.pending) { clearTimeout(p.timer); p.off?.(); p.reject(new Error(msg)); }
      host.pending.clear();
      try { w.terminate(); } catch {}
      if (host.worker === w) host.worker = null; // a later request creates a fresh worker
      const waiters = host.readyWaiters; host.readyWaiters = [];
      for (const f of waiters) f(new Error(msg));
      onStatusMessage({ type: 'status', state: 'error', message: msg }, host);
    };
    return w;
  };
  host.terminate = () => {
    if (host.idleTimer) { clearTimeout(host.idleTimer); host.idleTimer = null; }
    const w = host.worker;
    host.worker = null;
    if (!w) return;
    try { w.postMessage({ type: 'dispose' }); } catch {}
    try { w.terminate(); } catch {}
    for (const [, p] of host.pending) { clearTimeout(p.timer); p.off?.(); p.reject(new Error('gestoppt')); }
    host.pending.clear();
  };
  host.scheduleIdleDispose = () => {
    if (!host.worker || host.pending.size || host.idleTimer) return;
    host.idleTimer = setTimeout(() => { host.idleTimer = null; host.terminate(); }, host.heavy ? HEAVY_IDLE_DISPOSE_MS : IDLE_DISPOSE_MS);
  };
  return host;
}

const REQUEST_TIMEOUT_MS = 120000; // per sentence once the model is loaded (WASM on a slow CPU can be slow)
function armTimeout(host, p, message) {
  if (p.timer) return;
  // the worker answers in order: a request behind others in its queue gets their time as well
  const ahead = Math.max(0, host.pending.size - 1);
  p.timer = setTimeout(() => {
    if (!host.pending.has(p.id)) return;
    host.pending.delete(p.id);
    p.off?.();
    try { host.worker?.postMessage({ type: 'cancel', id: p.id }); } catch {}
    p.reject(new Error(message));
  }, REQUEST_TIMEOUT_MS * (1 + ahead));
}

// --- English: Kokoro worker -------------------------------------------------------------------------------------
const kokoro = makeWorkerHost('kokoro-tts', 'tts-worker.js', (m, host) => {
  if (m.state === 'ready') { english.state = 'ready'; english.error = null; english.progress = 1; english.cached = true; }
  else if (m.state === 'error' && m.restart) { english.state = 'loading'; english.error = null; }   // retried on wasm
  else if (m.state === 'error') { english.state = 'error'; english.error = m.message || 'Fehler'; }
  else if (m.state === 'loading') { english.state = 'loading'; english.error = null; }
  else if (m.state === 'idle') { if (english.state === 'ready') english.state = 'idle'; }
  english.message = m.message || english.message;
  if (typeof m.progress === 'number') english.progress = m.progress;
  english.device = m.device || english.device; english.dtype = m.dtype || english.dtype;
  if (m.state === 'ready' || (m.state === 'error' && !m.restart)) {
    const w = host.readyWaiters; host.readyWaiters = [];
    for (const f of w) f(m.state === 'ready' ? null : new Error(english.error));
  }
  if (m.state === 'ready') for (const p of host.pending.values()) armTimeout(host, p, 'Kokoro antwortet nicht (Zeitüberschreitung)');
  emitStatus(m.state === 'error' && m.message ? { message: m.message } : undefined);
});

function workerInitOpts() {
  const t = ttsSettings();
  const o = {};
  if (t.englishDevice) o.device = t.englishDevice;
  if (t.englishDtype) o.dtype = t.englishDtype;
  // a WebGPU session that failed in this app session: every later worker starts on wasm right away
  if (!t.englishDevice && english.forceOpts) Object.assign(o, english.forceOpts);
  return o;
}
/**
 * Transformers.js keeps the promise of the first InferenceSession of a worker, so a failed WebGPU start
 * poisons every later attempt in the same worker. The worker then asks for a restart: a new worker gets the
 * wasm backend and all requests that were waiting are sent to it again.
 */
kokoro.restart = (opts) => {
  english.forceOpts = { ...opts };
  const waiting = [...kokoro.pending.values()];
  const old = kokoro.worker;
  kokoro.worker = null;
  try { old?.terminate(); } catch {}
  const w = kokoro.ensure();
  english.state = 'loading'; english.error = null; emitStatus();
  if (!waiting.length) { w.postMessage({ type: 'init', opts: workerInitOpts() }); return; }
  for (const p of waiting) if (p.msg) w.postMessage({ ...p.msg, opts: workerInitOpts() });
};
function warmupEnglish() {
  const w = kokoro.ensure();
  if (english.state === 'idle' || english.state === 'error') { english.state = 'loading'; english.error = null; emitStatus(); w.postMessage({ type: 'init', opts: workerInitOpts() }); }
  return new Promise((resolve, reject) => {
    if (english.state === 'ready') return resolve();
    kokoro.readyWaiters.push((err) => (err ? reject(err) : resolve()));
  });
}
/**
 * Is the English model (Kokoro) on this computer? The worker looks into its cache without loading anything:
 * { cached: true|false|null, bytes, dtype }. The answer is kept; a loaded model counts as cached.
 */
let englishModelPromise = null;
function englishModel(force = false) {
  if (english.state === 'ready') english.cached = true;
  if (english.cached !== null && !force) return Promise.resolve({ cached: english.cached, bytes: english.bytes, dtype: english.dtype });
  if (englishModelPromise) return englishModelPromise;
  englishModelPromise = (async () => {
    try {
      if (typeof Worker === 'undefined') return { cached: null, bytes: english.bytes };
      const w = kokoro.ensure();
      const id = 'c' + (++kokoro.seq);
      const r = await new Promise((resolve) => {
        const p = { id, resolve, reject: () => resolve(null), timer: setTimeout(() => { kokoro.pending.delete(id); resolve(null); }, 20000), off: null };
        kokoro.pending.set(id, p);
        w.postMessage({ type: 'cached', id, opts: workerInitOpts() });
      });
      if (r && typeof r.cached === 'boolean') {
        english.cached = english.state === 'ready' ? true : r.cached;
        if (r.bytes) english.bytes = r.bytes;
        english.dtype = r.dtype || english.dtype;
      }
    } catch (e) { console.warn('[tts] English model status', e?.message || e); }
    if (![...sessions].some((x) => !x.stopped)) kokoro.scheduleIdleDispose();
    emitStatus();
    return { cached: english.cached, bytes: english.bytes, dtype: english.dtype };
  })().finally(() => { englishModelPromise = null; });
  return englishModelPromise;
}
function speakEnglish(text, voice, speed, tracker) {
  const w = kokoro.ensure();
  const id = 'k' + (++kokoro.seq);
  if (english.state === 'idle' || english.state === 'error') { english.state = 'loading'; english.error = null; emitStatus(); }
  return new Promise((resolve, reject) => {
    // the message is kept: a worker restart (kokoro.restart) sends it again
    const msg = { type: 'speak', id, text, voice, speed, opts: workerInitOpts() };
    const p = { id, resolve, reject, timer: null, off: null, msg };
    kokoro.pending.set(id, p);
    if (english.state === 'ready') armTimeout(kokoro, p, 'Kokoro antwortet nicht (Zeitüberschreitung)');
    p.off = tracker?.add(() => { try { kokoro.worker?.postMessage({ type: 'cancel', id }); } catch {} });
    w.postMessage(msg);
  });
}

// --- German: Piper and Kokoro workers ----------------------------------------------------------------------------
// Both run an ONNX graph in a worker with the identical protocol, and both report into the same `piper`
// status object – the UI only ever shows one "German engine" state.
const GERMAN_TIMEOUT_MESSAGE = 'Die deutsche Stimme antwortet nicht (Zeitüberschreitung)';
function germanWorkerStatus(m, host) {
  // `piper.state` is now shared by both German workers, so the per-request timeout must not be armed
  // from the *other* worker's readiness – remember which worker instance actually has a model loaded.
  if (host) host.readyWorker = m.state === 'ready' ? host.worker : null;
  if (m.state === 'ready') { piper.state = 'ready'; piper.error = null; piper.progress = 1; }
  else if (m.state === 'error') { piper.state = 'error'; piper.error = m.message || 'Fehler'; }
  else if (m.state === 'loading') { piper.state = 'loading'; piper.error = null; }
  else if (m.state === 'idle' && piper.state === 'ready') piper.state = 'idle';
  if (m.message) piper.message = m.message;
  if (typeof m.progress === 'number') piper.progress = m.progress;
  if (m.voice) piper.voice = m.voice;
  if (m.state === 'ready' && host) for (const p of host.pending.values()) armTimeout(host, p, GERMAN_TIMEOUT_MESSAGE);
  emitStatus(m.message && (m.state === 'error' || m.state === 'loading') ? { message: m.message } : undefined);
}
const piperHost = makeWorkerHost('piper-tts', 'piper-worker.js', germanWorkerStatus);
const kokoroDeHost = makeWorkerHost('kokoro-de-tts', 'kokoro-de-worker.js', germanWorkerStatus);
const germanHost = (engine) => (engine === 'kokoro-de' ? kokoroDeHost : piperHost);

/** The payload a German worker needs: urls, config and (multi-speaker Piper models) the chosen speaker. */
function germanVoiceMessage(voice) {
  const speaker = ttsSettings().germanSpeaker || null;   // e.g. 'neutral' for de_DE-thorsten_emotional-medium
  return {
    id: voice.id, name: voice.name, modelUrl: voice.modelUrl, config: voice.config, speaker,
    voicesUrl: voice.voicesUrl || null, voiceName: voice.voiceName || null,
    gpu: !!voice.gpu,   // a heavy voice: the worker runs it on WebGPU when there is an adapter
  };
}

async function speakGermanOnnx(engine, text, voiceId, speed, tracker) {
  const voice = await ensurePiperVoice(voiceId);
  const host = germanHost(voice.engine || engine);
  host.heavy = !!voice.gpu;
  const w = host.ensure();
  const id = (engine === 'kokoro-de' ? 'm' : 'p') + (++host.seq);
  return new Promise((resolve, reject) => {
    const p = { id, resolve, reject, timer: null, off: null };
    host.pending.set(id, p);
    // the timeout only starts once THIS worker has its model in memory – the first load may take a while
    if (host.readyWorker === w) armTimeout(host, p, GERMAN_TIMEOUT_MESSAGE);
    p.off = tracker?.add(() => { try { w.postMessage({ type: 'cancel', id }); } catch {} });
    w.postMessage({ type: 'speak', id, text, speed, voice: germanVoiceMessage(voice) });
  });
}
async function warmupGerman(voiceId) {
  const wanted = voiceId || resolveGermanVoice(ttsSettings().germanVoice);
  const voice = await ensurePiperVoice(GERMAN_ONNX_ENGINES.includes(engineForVoice(wanted)) ? wanted : DEFAULT_GERMAN_VOICE);
  const w = germanHost(voice.engine).ensure();
  w.postMessage({ type: 'load', voice: germanVoiceMessage(voice) });
}

// --- German: Python sidecar via IPC (legacy) ----------------------------------------------------------------------
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function pcm16ToFloat(bytes) {
  const n = Math.floor(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}
async function speakKartoffelbox(text, voice, speed) {
  if (!api.tts?.germanSpeak) throw new Error('Kartoffelbox ist nicht verfügbar');
  const t = ttsSettings();
  const raw = String(voice || '').replace(KARTOFFEL_PREFIX, '') || t.germanPrompt || 'default';
  const opts = { voice: raw, speed, prompt: t.germanPrompt || null };
  if (!german.running) { german.starting = true; german.message = german.message || 'Kartoffelbox wird gestartet …'; emitStatus(); }
  const res = await api.tts.germanSpeak(text, opts);
  if (!res) { german.known = true; german.available = false; german.starting = false; emitStatus(); throw new Error('Kartoffelbox ist nicht eingerichtet'); }
  if (res.error) {
    german.starting = false;
    if (res.status) applyGermanStatus(res.status);
    if (res.code === 'not-installed') { german.known = true; german.available = false; }
    german.error = res.error; emitStatus();
    throw new Error(res.error);
  }
  german.running = true; german.starting = false; german.error = null;
  if (res.pcm) return { sampleRate: res.sampleRate || 24000, samples: pcm16ToFloat(b64ToBytes(res.pcm)) };
  if (res.wavBase64) {
    const buf = await getContext().decodeAudioData(b64ToBytes(res.wavBase64).buffer);
    return { sampleRate: buf.sampleRate, samples: buf.getChannelData(0) };
  }
  if (res.samples) return { sampleRate: res.sampleRate || 24000, samples: res.samples instanceof Float32Array ? res.samples : Float32Array.from(res.samples) };
  throw new Error('Unbekannte Antwort des TTS-Servers');
}

// --- helpers -------------------------------------------------------------------------------------------------------
class Tracker { // collects cancel callbacks for in-flight synthesis requests
  constructor() { this.fns = new Set(); }
  /** @returns {() => void} a function that removes the callback again (call it when the request settles) */
  add(fn) { this.fns.add(fn); return () => this.fns.delete(fn); }
  cancel() { for (const f of this.fns) { try { f(); } catch {} } this.fns.clear(); }
}

function sentenceLang(text, base, forced) {
  if (forced && forced !== 'auto') return forced;
  const det = detectLanguage(text);
  if (!det || det === base) return base || det || 'en';
  // sticky: only switch away from the book language on strong evidence
  const sc = scoreLanguages(text);
  const ratio = det === 'de' ? sc.de / Math.max(0.01, sc.en) : sc.en / Math.max(0.01, sc.de);
  if (sc.tokens >= 5 && ratio >= 2) return det;
  return base || det;
}

// --- session -------------------------------------------------------------------------------------------------------
// The sentences are synthesized ahead (PREFETCH) and put on the AudioContext timeline as soon as they are ready, up to
// HORIZON seconds ahead: every sound starts sample-exactly after the one before, with a fixed pause, however late the
// renderer's timers run (a busy 3D frame, a minimized window). A sentence that was not ready in time starts as soon as
// it is (and is logged as late in the timeline). A ticker announces each sentence when it starts to sound (onSentence).
// A voice or a speed chosen during the reading (retune) takes over from the next sentence: what was synthesized or
// scheduled after the sentence that sounds now is dropped and made again.
let sessionSeq = 0;
function createSession(sentences, opts = {}) {
  const preset = (i) => (opts.langs?.[i] === 'de' || opts.langs?.[i] === 'en' ? opts.langs[i] : null);
  const items = sentences.map((text, i) => ({ i, text: String(text || ''), lang: null, preset: preset(i), pieces: null, state: 'idle', error: null, promise: null, engine: null, synthMs: 0, readyAt: 0, gen: 0, cancels: new Set() }));
  const forced = opts.lang === 'de' || opts.lang === 'en' ? opts.lang : null;
  // the language of the reading: given, else the one most sentences were given, else detected from the beginning
  const majority = () => {
    const n = { de: 0, en: 0 };
    for (const it of items) if (it.preset) n[it.preset] += it.text.length;
    return n.de + n.en ? (n.de >= n.en ? 'de' : 'en') : null;
  };
  const base = forced || majority() || detectLanguage(items.slice(0, 20).map((x) => x.text).join(' ')) || null;
  const s = {
    id: ++sessionSeq, opts, sentences: items.map((x) => x.text), lang: base || 'de', speed: 1, total: items.length, index: -1,
    stopped: false, paused: false, playing: false, started: false,
    tracker: new Tracker(), gain: null, skipDelta: 0, ended: false, retuneAt: false,
    sources: [],        // scheduled sounds { src, end, index }
    queue: [],          // scheduled sentences that have not started to sound yet { index, start, end }
    cursor: 0,          // context time at which the next sentence may start (end of the last one + pause)
    lastEnd: 0,         // end of the last scheduled sound
    level: null,        // loudness gain of the last piece (tts-audio.js nextGain)
    timeline: [],       // what was scheduled when: { index, start, end, late, synthMs, pieces, phonemizer }
    t0: performance.now(), firstAudioMs: null, ticker: null,
    pendingIndex: null, // where a skip landed, until that sentence sounds
    freedUpTo: 0,       // sentences before this one have given their audio back
  };
  // resolved in run() once the settings cache is warm (see prepare())
  let speed = 1;
  let baseLang = base || 'de';
  let voices = { en: 'af_heart', de: DEFAULT_GERMAN_VOICE };
  const pauseAfter = (opts.gap != null ? opts.gap / 1000 : SENTENCE_PAUSE);
  const failed = { kokoro: false, piper: false, 'kokoro-de': false, kartoffelbox: false };

  function prepare() {
    const t = ttsSettings();
    speed = Math.min(2, Math.max(0.5, Number(opts.speed) || Number(t.speed) || 1));
    baseLang = base || (normalizeLangCode(settingsCache?.language) === 'en' ? 'en' : 'de');
    s.lang = baseLang;
    s.speed = speed;
    const optEngine = engineForVoice(opts.voice);
    const en = optEngine === 'kokoro' ? opts.voice : (KOKORO_IDS.has(t.englishVoice) ? t.englishVoice : 'af_heart');
    // 'default' from older builds, an empty setting or a stale English id all mean the default voice (tts-voice-id.js)
    const de = GERMAN_ENGINES.includes(optEngine) ? opts.voice : resolveGermanVoice(t.germanVoice);
    voices = { en, de };
  }

  /** Which engine speaks a sentence of `lang`, honouring the selected voice and earlier failures. */
  const engineFor = (lang) => {
    const germanEngines = [];
    const picked = engineForVoice(voices.de);
    const chosen = GERMAN_ENGINES.includes(picked) ? picked : 'piper';
    // the chosen engine first, then the others in catalogue order as a fallback
    for (const e of [chosen, ...GERMAN_ENGINES.filter((x) => x !== chosen)]) {
      if (failed[e]) continue;
      if (GERMAN_ONNX_ENGINES.includes(e) && piper.known && !piper.available && !api.invoke) continue;
      // a second ONNX engine is only a fallback when its voice is already on disk – never a surprise download
      if (e !== chosen && GERMAN_ONNX_ENGINES.includes(e) && !piper.voices.some((v) => (v.engine || 'piper') === e && v.installed)) continue;
      if (e === 'kartoffelbox' && german.known && !german.available) continue;
      germanEngines.push(e);
    }
    if (lang === 'en') {
      // an English paragraph in a German reading while the English model is not on this computer: the German voice
      // reads it, as before 0.7 (never a download of 90 to 330 MB in the middle of a book)
      if (!failed.kokoro && (english.cached !== false || baseLang === 'en' || english.state === 'ready')) return 'kokoro';
      if (baseLang !== 'en' && germanEngines.length) return germanEngines[0];
      // the Chatterbox base model speaks English too – Piper de_DE does not
      return germanEngines.includes('kartoffelbox') ? 'kartoffelbox' : null;
    }
    if (germanEngines.length) return germanEngines[0];
    // a single German sentence inside an English book may still be read by Kokoro
    return baseLang !== 'de' && !failed.kokoro ? 'kokoro' : null;
  };

  /**
   * The voice id to use for `engine`: the chosen one, or for a fallback engine a voice of it that is on disk
   * (Piper: Thorsten (mittel) when it is there, else the first installed Piper voice).
   */
  function germanVoiceFor(engine) {
    if (engineForVoice(voices.de) === engine) return String(voices.de).replace(KARTOFFEL_PREFIX, '');
    if (engine === 'kokoro-de') return KOKORO_DE_VOICE;
    if (engine === 'piper') {
      const onDisk = piper.voices.filter((v) => (v.engine || 'piper') === 'piper' && v.installed);
      return (onDisk.find((v) => v.id === PIPER_FALLBACK_VOICE) || onDisk[0])?.id || PIPER_FALLBACK_VOICE;
    }
    return KARTOFFEL_PREFIX + 'default';
  }
  const voiceOf = (engine) => (engine === 'kokoro' ? voices.en : germanVoiceFor(engine));
  /** A tracker for the requests of one sentence: a retune cancels them, a stop cancels all. */
  const itemTracker = (item) => ({ add: (fn) => { item.cancels.add(fn); const off = s.tracker.add(fn); return () => { item.cancels.delete(fn); off(); }; } });
  function synthChunk(text, engine, item) {
    if (dryRun()) return dryAudio(text);
    const tracker = itemTracker(item);
    if (engine === 'kokoro') return speakEnglish(text, voices.en, speed, tracker);
    if (GERMAN_ONNX_ENGINES.includes(engine)) return speakGermanOnnx(engine, text, germanVoiceFor(engine), speed, tracker);
    return speakKartoffelbox(text, germanVoiceFor('kartoffelbox'), speed);
  }
  const settle = (p) => p.then((r) => ({ ok: true, r }), (e) => ({ ok: false, e }));
  async function synth(item) {
    const gen = item.gen;
    const live = () => item.gen === gen && !s.stopped;
    item.state = 'synth';
    item.lang = item.preset || sentenceLang(item.text, baseLang, forced);
    let text = normalizeForSpeech(item.text);
    const t0 = performance.now();
    const bail = (err) => { if (item.gen !== gen) return; item.state = 'error'; item.error = err; };
    const nothing = () => { item.pieces = []; item.state = 'ready'; item.readyAt = performance.now(); };
    // a page number, a lone figure or an ornament: nothing to say; junk (a broken font, the rows of a diagram font)
    // never reaches a voice
    if (!/\p{L}/u.test(text) || inspectText(text).junk) { traceEntry({ session: s.id, i: item.i, text: item.text, spoken: '', lang: item.lang, engine: null, voice: null, skipped: true }); return nothing(); }
    let engine = engineFor(item.lang);
    if (!engine) throw new Error(item.lang === 'de'
      ? 'Keine deutsche Sprachausgabe verfügbar (die Stimme muss einmalig heruntergeladen werden)'
      : 'Keine englische Sprachausgabe verfügbar (Kokoro konnte nicht geladen werden)');
    // chess notation in words, in the language of the voice that speaks it ("Sf3" → "Springer f drei" / "knight F three")
    const voiceLang = engine === 'kokoro' ? 'en' : 'de';
    if (opts.chess || hasChessNotation(text)) text = speakChess(text, voiceLang, { chessBook: !!opts.chess });
    // the first sentence of a reading goes out in shorter pieces, so that the first audio comes sooner
    const parts = splitSentences(text, voiceLang, { maxLen: item.i === s.firstIndex ? FIRST_CHUNK_LEN : CHUNK_LEN });
    const trace = traceEntry({ session: s.id, i: item.i, text: item.text, spoken: text, lang: item.lang, engine, voice: voiceOf(engine), phonemes: [] });
    // all pieces go to the worker at once, so that its queue holds them back to back; each one is handed to the
    // timeline as soon as it is there (item.pieces grows, wake() tells run())
    const first = parts.map((p) => settle(synthChunk(p, engine, item)));
    item.pieces = [];
    for (let k = 0; k < parts.length; k++) {
      let res = await first[k];
      let retried = false;
      // the reason the *chosen* engine failed – that is what the user has to read, not "Kartoffelbox
      // ist nicht verfügbar" from the last engine of the fallback chain
      let firstError = null;
      while (!res.ok) {
        const e = res.e;
        if (!live()) return bail(new Error('gestoppt'));
        if (e?.cancelled) return bail(Object.assign(new Error('abgebrochen'), { cancelled: true }));
        console.warn('[tts] synthesis failed (' + engine + '):', e?.message || e);
        const fatal = /nicht eingerichtet|not-installed|nicht verfügbar|konnte nicht geladen|heruntergeladen|Internetverbindung/i.test(e?.message || '');
        if (!retried && !fatal) { retried = true; res = await settle(synthChunk(parts[k], engine, item)); continue; } // transient? once more
        if (!firstError) firstError = e;
        failed[engine] = true;
        const alt = engineFor(item.lang);
        if (!alt || alt === engine) throw firstError;
        emitStatus({ message: FALLBACK_MESSAGE[alt] || 'Andere Stimme wird verwendet' });
        engine = alt; retried = false;
        if (trace) { trace.engine = engine; trace.voice = voiceOf(engine); }
        res = await settle(synthChunk(parts[k], engine, item));   // the same piece with the other engine
      }
      if (!live()) return bail(new Error('gestoppt'));
      if (!item.pieces) return;   // a skip back freed the sentence while it was synthesized: it starts over
      const { sampleRate, samples } = res.r;
      item.phonemizer = res.r.phonemizer || item.phonemizer;
      item.engine = engine;
      if (trace && res.r.phonemes) trace.phonemes.push(res.r.phonemes);
      const clean = cleanPiece(samples instanceof Float32Array ? samples : Float32Array.from(samples || []), sampleRate);
      if (clean.samples.length) item.pieces.push({ ...clean, sampleRate, engine });
      wake();
    }
    item.synthMs = Math.round(performance.now() - t0);
    item.readyAt = performance.now();
    item.state = 'ready';
  }
  function ensurePrefetch(from) {
    for (let k = from; k <= from + PREFETCH && k < items.length; k++) {
      const it = items[k];
      if (it.state === 'idle') {
        const gen = it.gen;
        it.promise = synth(it).catch((e) => { if (it.gen === gen) { it.state = 'error'; it.error = e; } }).finally(() => wake());
      }
    }
  }
  /** Forgets what was made for a sentence (a retune): its requests are cancelled, a late answer is ignored (gen). */
  function resetItem(it) {
    it.gen++;
    for (const f of [...it.cancels]) { try { f(); } catch {} }
    it.cancels.clear();
    it.pieces = null; it.state = 'idle'; it.promise = null; it.error = null; it.engine = null;
  }
  // one shared promise per wake-up: any number of waiters, nothing piles up between two wake() calls
  let wakePromise = null, wakeResolve = null;
  const wakeable = () => (wakePromise ||= new Promise((r) => { wakeResolve = r; }));
  const wake = () => { const r = wakeResolve; wakePromise = null; wakeResolve = null; r?.(); };
  async function waitIfPaused() { while (s.paused && !s.stopped) await wakeable(); }
  /** Waits until the context time `t` (returns early on stop, skip and retune; a paused context simply does not advance). */
  async function waitUntil(t) {
    for (let guard = 0; guard < 1e6; guard++) {
      if (s.stopped || s.skipDelta || s.retuneAt || !ctx) return;
      const left = t - ctx.currentTime;
      if (left <= 0) return;
      await Promise.race([new Promise((r) => setTimeout(r, Math.max(15, Math.min(200, left * 1000)))), wakeable()]);
    }
  }

  /**
   * Puts a sentence on the timeline: right after the previous one with the sentence pause, or as soon as possible
   * when it was not ready in time (logged as `late`). Its pieces follow with placePiece() as they arrive.
   */
  function beginItem(item) {
    const now = getContext().currentTime;
    const start = Math.max(now + LEAD, s.cursor);
    const late = s.cursor > 0 ? Math.max(0, start - s.cursor) : 0;
    if (s.firstAudioMs == null && item.pieces.length) s.firstAudioMs = Math.round(performance.now() - s.t0 + (start - now) * 1000);
    const entry = { index: item.i, start, end: start };
    s.queue.push(entry);
    const tl = { index: item.i, start: +start.toFixed(3), end: +start.toFixed(3), late: +late.toFixed(3), pieceLate: 0, synthMs: 0, pieces: 0, engine: null, phonemizer: null };
    s.timeline.push(tl);
    if (s.timeline.length > 500) s.timeline.splice(0, s.timeline.length - 500);
    return { t: start, first: true, entry, tl };
  }
  function placePiece(p, span) {
    const c = getContext();
    let t = span.first ? span.t : span.t + CLAUSE_PAUSE / speed;
    if (!span.first && t < c.currentTime + LEAD) { span.tl.pieceLate = +(span.tl.pieceLate + c.currentTime + LEAD - t).toFixed(3); t = c.currentTime + LEAD; }
    span.first = false;
    // only engines without a native speed control need the pitch-shifting playbackRate hack
    const rate = !NATIVE_SPEED[p.engine] && Math.abs(speed - 1) > 0.01 ? speed : 1;
    const buf = c.createBuffer(1, p.samples.length, Math.min(384000, Math.max(3000, p.sampleRate || 24000)));
    buf.copyToChannel(p.samples, 0);
    const src = c.createBufferSource();
    src.buffer = buf;
    if (rate !== 1) src.playbackRate.value = rate;
    // the loudness is levelled with a gain node, the samples stay untouched (a skip back schedules them again)
    s.level = nextGain(s.level, p.level, p.peak);
    const g = c.createGain();
    g.gain.value = s.level;
    src.connect(g); g.connect(s.gain);
    try { src.start(t); } catch (e) { console.warn('[tts] start failed', e); }
    span.t = t + buf.duration / rate;
    s.sources.push({ src, end: span.t, index: span.entry.index });
    s.lastEnd = Math.max(s.lastEnd, span.t);
  }
  function endItem(item, span) {
    span.entry.end = span.t;
    if (item.pieces?.length) s.cursor = span.t + pauseAfter / speed;
    Object.assign(span.tl, { end: +span.t.toFixed(3), synthMs: item.synthMs, pieces: item.pieces?.length || 0, engine: item.engine, phonemizer: item.phonemizer || null });
  }
  function stopScheduled() {
    for (const x of s.sources) { try { x.src.stop(); } catch {} try { x.src.disconnect(); } catch {} }
    s.sources = []; s.queue = []; s.cursor = 0; s.lastEnd = 0;
  }
  /**
   * A retune: the sentence that sounds now plays to its end with the old voice, everything after it is stopped,
   * forgotten and made again with the new one. Returns the index to continue with.
   */
  function retuneAfter(keep) {
    const kept = [];
    for (const x of s.sources) {
      if (x.index > keep) { try { x.src.stop(); } catch {} try { x.src.disconnect(); } catch {} }
      else kept.push(x);
    }
    s.sources = kept;
    s.queue = s.queue.filter((e) => e.index <= keep);
    const end = kept.reduce((m, x) => Math.max(m, x.end), 0);
    s.lastEnd = end;
    s.cursor = end ? end + pauseAfter / speed : 0;
    for (const it of items) if (it.i > keep && it.state !== 'idle') resetItem(it);
    s.freedUpTo = Math.min(s.freedUpTo, keep + 1);
    return keep + 1;
  }
  /** Announces the sentence that starts to sound, forgets finished sounds and frees the audio of played sentences. */
  function tick() {
    if (s.stopped || !ctx) return;
    const now = ctx.currentTime;
    while (s.queue.length && s.queue[0].start <= now + 0.01) {
      const e = s.queue.shift();
      s.index = e.index;
      s.pendingIndex = null;
      s.playing = true;
      try { opts.onSentence?.(e.index); } catch (err) { console.error('[tts] onSentence', err); }
      emitStatus();
    }
    if (s.sources.length && s.sources[0].end < now) s.sources = s.sources.filter((x) => x.end >= now);
    // a played sentence gives its audio back (a skip back synthesizes it again); after a skip back nothing from
    // where it landed on
    const limit = s.pendingIndex != null ? Math.min(s.index, s.pendingIndex) : s.index;
    for (; s.freedUpTo < limit; s.freedUpTo++) {
      const it = items[s.freedUpTo];
      if (it.state === 'ready' && it.pieces) { it.pieces = null; it.state = 'idle'; it.promise = null; }
    }
  }

  async function run() {
    await getSettings();          // the first read-aloud after startup must not race the settings cache
    if (s.stopped) return;
    prepare();
    // is the English model on this computer? (an English paragraph of a German book is only read in English then)
    if (items.some((it) => it.preset === 'en' || (!it.preset && baseLang === 'en'))) await englishModel().catch(() => null);
    if (s.stopped) return;
    const c = getContext();
    try { if (c.state !== 'running') await c.resume(); } catch {}
    if (s.stopped) return;        // stop()/stopAll() during the await – never duck or connect afterwards
    s.started = true;
    s.gain = c.createGain(); s.gain.gain.value = opts.volume ?? 1; s.gain.connect(c.destination);
    refreshDuck();
    // a film or a podcast that started in the meantime already paused this reading: it does not take the focus back
    if (!s.paused) mediaFocus.claim('tts');
    emitStatus();
    s.ticker = setInterval(tick, 40);
    let idx = 0;
    s.firstIndex = 0;
    // an item that has not started to sound may be given up for a retune; the one that sounds is placed to its end
    const retuneNow = () => s.retuneAt && idx > s.index;
    for (;;) {
      if (s.stopped) break;
      if (s.skipDelta) {
        // a second skip before the first one sounds counts from where the first one landed
        const from = s.pendingIndex ?? (s.index >= 0 ? s.index : idx);
        idx = Math.max(0, Math.min(items.length, from + s.skipDelta));
        s.skipDelta = 0;
        s.pendingIndex = idx;
        s.freedUpTo = Math.min(s.freedUpTo, idx);
        stopScheduled();
        continue;
      }
      if (s.retuneAt) {
        s.retuneAt = false;
        prepare();
        // nothing sounds yet (the first sentence is still being made, or a skip waits for its sentence): from there
        idx = s.index >= 0 && s.pendingIndex == null ? retuneAfter(s.index) : retuneAfter((s.pendingIndex ?? idx) - 1);
        continue;
      }
      if (idx >= items.length) {
        // all scheduled: wait until the last sound has ended
        if (ctx.currentTime >= s.lastEnd && !s.queue.length) break;
        await waitUntil(Math.max(s.lastEnd, s.queue.length ? s.queue[s.queue.length - 1].start : 0) + 0.02);
        tick();
        continue;
      }
      ensurePrefetch(idx);
      const item = items[idx];
      if (!item.pieces?.length && s.lastEnd <= ctx.currentTime) emitStatus({ message: (baseLang === 'de' ? piper.message || german.message : english.message) || '' });
      // wait for the first piece of the sentence (or for its end when it has nothing to say)
      let guard = 0;
      while (!item.pieces?.length && item.state !== 'ready' && item.state !== 'error' && !s.stopped && !s.skipDelta && !retuneNow()) {
        await Promise.race([item.promise || Promise.resolve(), wakeable()]);
        // a synthesis that resolved without reaching a terminal state must never spin the event loop
        if (++guard > 10000) { item.state = 'error'; item.error = new Error('Synthese hängt'); break; }
      }
      if (s.stopped) break;
      if (s.skipDelta || retuneNow()) continue;
      if (item.state === 'error') {
        // a cancelled chunk (stale cancel from an earlier session) may be retried – but only twice
        if (item.error?.cancelled && (item.retries = (item.retries || 0) + 1) <= 2) { item.state = 'idle'; item.promise = null; continue; }
        throw item.error || new Error('Synthese fehlgeschlagen');
      }
      // never more than HORIZON seconds of scheduled audio ahead of what sounds now
      await waitUntil(s.lastEnd - HORIZON);
      if (s.stopped) break;
      if (s.skipDelta || retuneNow()) continue;
      await waitIfPaused();
      if (s.stopped) break;
      if (s.skipDelta || retuneNow()) continue;
      if (!item.pieces) continue;   // freed by a skip back in the meantime
      // the pieces go on the timeline as they arrive
      const span = beginItem(item);
      let placed = 0;
      for (let rounds = 0; rounds < 100000; rounds++) {
        while (item.pieces && placed < item.pieces.length) placePiece(item.pieces[placed++], span);
        if (item.state === 'ready' || item.state === 'error' || !item.pieces || s.stopped || s.skipDelta || retuneNow()) break;
        await Promise.race([item.promise || Promise.resolve(), wakeable()]);
      }
      if (s.stopped) break;
      if (s.skipDelta || retuneNow()) continue;
      if (item.state === 'error') throw item.error || new Error('Synthese fehlgeschlagen');
      endItem(item, span);
      tick();
      idx++;
    }
    s.playing = false;
  }

  const session = {
    get playing() { return s.playing && !s.paused && !s.stopped; },
    get paused() { return s.paused; },
    get stopped() { return s.stopped; },
    get started() { return s.started; },   // true once run() actually reached the audio graph (see refreshDuck)
    get index() { return s.index; },
    get total() { return s.total; },
    get lang() { return s.lang; },
    get id() { return s.id; },
    get sentences() { return s.sentences; },
    get opts() { return opts; },
    /** The language of sentence i (once it was synthesized or announced), 'de' or 'en'. */
    langOf(i) { const it = items[i]; return it ? it.lang || it.preset || baseLang : baseLang; },
    /** What was scheduled when ({ index, start, end, late, synthMs, … }, context seconds) and the time to the first sound. */
    get timeline() { return { firstAudioMs: s.firstAudioMs, entries: s.timeline.slice() }; },
    pause() {
      if (s.stopped || s.paused) return;
      s.paused = true;
      try { if (ctx && ctx.state === 'running') ctx.suspend(); } catch {}
      emitStatus();
    },
    resume() {
      if (s.stopped || !s.paused) return;
      s.paused = false;
      try { if (ctx && ctx.state === 'suspended') ctx.resume(); } catch {}
      wake();
      if (s.started) mediaFocus.claim('tts');
      emitStatus();
    },
    stop() { finish(true); },
    skip(delta = 1) {
      if (s.stopped) return;
      s.skipDelta = (Number(delta) || 1);
      if (s.paused) session.resume();
      stopScheduled();
      wake();
    },
    /** The voices or the speed changed (settings): from the next sentence on (see retuneAfter). */
    retune() { if (s.stopped) return; s.retuneAt = true; wake(); },
    /** Another voice or speed for this reading only: { voice, speed }; takes over from the next sentence. */
    update(patch = {}) {
      if ('voice' in patch) opts.voice = patch.voice || undefined;
      if ('speed' in patch) opts.speed = patch.speed;
      session.retune();
    },
  };

  function teardown(extra) {
    if (s.stopped) return false;
    s.stopped = true; s.playing = false;
    clearInterval(s.ticker); s.ticker = null;
    stopScheduled();
    s.tracker.cancel();
    wake();
    try { if (s.paused && ctx && ctx.state === 'suspended') ctx.resume(); } catch {}
    s.paused = false;
    try { s.gain?.disconnect(); } catch {}
    s.gain = null;
    sessions.delete(session);
    lastTimeline = session.timeline;
    refreshDuck();
    scheduleIdleDispose();
    emitStatus(extra);
    return true;
  }
  function finish(byUser) {
    if (!teardown()) return;
    if (!byUser && !s.ended) { s.ended = true; try { opts.onEnd?.(); } catch (e) { console.error('[tts] onEnd', e); } }
  }

  sessions.add(session);
  run().then(() => { if (!s.stopped) finish(false); })
    .catch((e) => {
      if (!teardown({ message: e?.message || String(e) })) return;
      console.warn('[tts] session failed', e);
      try { opts.onError?.(e instanceof Error ? e : new Error(String(e))); } catch (err) { console.error('[tts] onError', err); }
    });
  return session;
}
let lastTimeline = null;

/**
 * Renders sentences the way a reading would sound, into one buffer, without playing anything (tests, analysis):
 * the same engines, pieces, trimming, levelling and pauses as speak(). Returns the mix and where every sentence lies.
 * @returns {Promise<{ sampleRate, samples: Float32Array, marks: {index,start,end}[], pieces: object[], synthMs: number[] }>}
 */
async function renderSentences(sentences, opts = {}) {
  await getSettings();
  const t = ttsSettings();
  const speed = Math.min(2, Math.max(0.5, Number(opts.speed) || Number(t.speed) || 1));
  const lang = opts.lang === 'en' ? 'en' : 'de';
  const engine = lang === 'en' ? 'kokoro' : (engineForVoice(opts.voice) || engineForVoice(resolveGermanVoice(t.germanVoice)) || 'piper');
  const voice = opts.voice || (lang === 'en' ? (KOKORO_IDS.has(t.englishVoice) ? t.englishVoice : 'af_heart') : resolveGermanVoice(t.germanVoice));
  const tracker = new Tracker();
  const out = [];
  let level = null, rate = 0;
  const marks = [], pieceInfo = [], synthMs = [];
  let cursor = 0;
  const pauseAfter = opts.gap != null ? opts.gap / 1000 : SENTENCE_PAUSE;
  for (const [i, sentence] of sentences.entries()) {
    // the same text as a reading: junk never reaches the voice, chess notation is spoken in words
    let text = normalizeForSpeech(sentence);
    if (!/\p{L}/u.test(text) || inspectText(text).junk) continue;
    if (opts.chess || hasChessNotation(text)) text = speakChess(text, lang, { chessBook: !!opts.chess });
    const parts = splitSentences(text, lang, { maxLen: i === 0 ? FIRST_CHUNK_LEN : CHUNK_LEN });
    const t0 = performance.now();
    const results = await Promise.all(parts.map((p) => (engine === 'kokoro' ? speakEnglish(p, voice, speed, tracker) : speakGermanOnnx(engine, p, voice, speed, tracker))));
    synthMs.push(Math.round(performance.now() - t0));
    const start = cursor;
    results.forEach((r, k) => {
      rate ||= r.sampleRate;
      const clean = cleanPiece(r.samples, r.sampleRate);
      level = nextGain(level, clean.level, clean.peak);
      const x = applyGain(resample(clean.samples, r.sampleRate, rate), level);
      out.push({ at: cursor, x });
      pieceInfo.push({ index: i, piece: k, lead: +clean.lead.toFixed(3), tail: +clean.tail.toFixed(3), level: +clean.level.toFixed(4), peak: +clean.peak.toFixed(3), gain: +level.toFixed(3), phonemizer: r.phonemizer || null, phonemes: r.phonemes || null });
      cursor += x.length / rate + (k < results.length - 1 ? CLAUSE_PAUSE / speed : 0);
    });
    marks.push({ index: i, start: +start.toFixed(3), end: +cursor.toFixed(3) });
    cursor += pauseAfter / speed;
  }
  const total = Math.ceil(Math.max(0, cursor - pauseAfter / speed) * (rate || 24000)) + 1;
  const samples = new Float32Array(total);
  for (const p of out) samples.set(p.x.subarray(0, Math.max(0, total - Math.round(p.at * rate))), Math.round(p.at * rate));
  return { sampleRate: rate || 24000, samples, marks, pieces: pieceInfo, synthMs };
}

const FALLBACK_MESSAGE = {
  kokoro: 'Deutsche Stimme nicht verfügbar, der Satz wird mit Kokoro gesprochen',
  piper: 'Die gewählte deutsche Stimme ist nicht verfügbar, es wird eine Piper-Stimme verwendet',
  'kokoro-de': 'Die gewählte deutsche Stimme ist nicht verfügbar, es wird Martin (Kokoro) verwendet',
  kartoffelbox: 'Keine ONNX-Stimme verfügbar, es wird Kartoffelbox verwendet',
};

function scheduleIdleDispose() {
  if ([...sessions].some((x) => !x.stopped)) return;
  kokoro.scheduleIdleDispose();
  piperHost.scheduleIdleDispose();
  kokoroDeHost.scheduleIdleDispose();
}

// --- the English model on its own (voice menu, all voices) --------------------------------------------------------
/** Downloads the English model once (it lands in the worker's cache) and frees it again unless a reading needs it. */
async function installEnglish() {
  await getSettings();
  await warmupEnglish();
  english.cached = true;
  if (![...sessions].some((x) => !x.stopped)) { kokoro.terminate(); english.state = 'idle'; english.progress = 1; }
  emitStatus();
  return { cached: true, bytes: english.bytes, dtype: english.dtype };
}
/** Stops a download of the English model (the worker goes; files that were complete stay in the cache). */
function cancelEnglish() {
  const waiters = kokoro.readyWaiters; kokoro.readyWaiters = [];
  kokoro.terminate();
  english.state = 'idle'; english.progress = 0; english.message = '';
  for (const f of waiters) f(Object.assign(new Error('Download abgebrochen'), { code: 'cancelled' }));
  emitStatus();
}

// --- all voices at once (settings → Vorlesen) ---------------------------------------------------------------------
// One after the other with the download code the voices always use: the German ones through the main process
// (electron/tts/piper.js: resumable .part files, exact sizes), the English model through its worker (Transformers.js
// cache). Voices that are on this computer are skipped; a cancelled German download goes on from its .part file the
// next time; a failure does not stop the others and can be tried again.
const ENGLISH_MODEL_ID = 'kokoro-en';
const downloads = { running: false, cancelled: false, items: [], current: null };
function downloadsSnapshot() {
  const items = downloads.items.map((x) => ({ ...x }));
  const todo = items.filter((x) => x.state !== 'skipped');
  const total = todo.reduce((n, x) => n + (x.bytes || 0), 0);
  const received = todo.reduce((n, x) => n + Math.min(x.bytes || 0, x.received || 0), 0);
  return { running: downloads.running, cancelled: downloads.cancelled, current: downloads.current, items, total, received, progress: total ? received / total : 1, failed: items.filter((x) => x.state === 'failed').length };
}
let downloadsTimer = null;
function emitDownloads(now) {
  if (now) { clearTimeout(downloadsTimer); downloadsTimer = null; try { bus.emit('tts:downloads', downloadsSnapshot()); } catch {} return; }
  if (downloadsTimer) return;
  downloadsTimer = setTimeout(() => { downloadsTimer = null; try { bus.emit('tts:downloads', downloadsSnapshot()); } catch {} }, 150);
}
// the progress of the voice that is loading: German from the broadcasts of the main process, English from the worker
bus.on('tts:status', (st) => {
  if (!downloads.running) return;
  const cur = downloads.items.find((x) => x.state === 'downloading');
  if (!cur) return;
  if (cur.kind === 'de' && st?.piperDetail?.voice === cur.id && typeof st.piperDetail.progress === 'number' && st.piperDetail.state === 'loading') cur.received = Math.max(cur.received || 0, Math.round(st.piperDetail.progress * cur.bytes));
  if (cur.kind === 'en' && typeof st?.englishDetail?.progress === 'number' && st.englishDetail.state === 'loading') cur.received = Math.max(cur.received || 0, Math.round(st.englishDetail.progress * cur.bytes));
  emitDownloads();
});

/**
 * Every voice of this app: [{ id, name, kind: 'de'|'en', bytes, received, installed }]. `received` is what a
 * cancelled download left on disk (it is not loaded again). Kartoffelbox (legacy) is not part of it.
 */
async function voiceInventory() {
  await getSettings();
  await refreshPiper(true);
  const en = await ttsClient.englishModel(true);   // the public method: the checks stand in for the English model there
  const list = piper.voices.filter((v) => GERMAN_ONNX_ENGINES.includes(v.engine || 'piper')).map((v) => ({
    id: v.id, name: voiceName(v.name), kind: 'de', bytes: v.bytes || 0, received: v.installed ? v.bytes || 0 : Math.min(v.bytes || 0, v.received || 0), installed: !!v.installed,
  }));
  list.push({ id: ENGLISH_MODEL_ID, name: 'Kokoro', kind: 'en', bytes: en.bytes || english.bytes, received: en.cached ? en.bytes || english.bytes : 0, installed: en.cached === true });
  return list;
}

async function downloadAllVoices({ only } = {}) {
  if (downloads.running) return downloadsSnapshot();
  downloads.running = true; downloads.cancelled = false;
  try {
    const inventory = await voiceInventory();
    downloads.items = inventory.map((v) => ({ ...v, state: v.installed ? 'skipped' : (only && !only.includes(v.id) ? 'skipped' : 'pending'), error: null }));
    emitDownloads(true);
    for (const item of downloads.items) {
      if (downloads.cancelled) break;
      if (item.state !== 'pending') continue;
      item.state = 'downloading'; downloads.current = item.id;
      emitDownloads(true);
      try {
        // through the public methods: the checks put a stand-in for the English download there
        if (item.kind === 'en') await ttsClient.installEnglish();
        else await ensurePiperVoice(item.id);
        item.state = 'done'; item.received = item.bytes; item.error = null;
      } catch (e) {
        if (downloads.cancelled || e?.code === 'cancelled') { item.state = 'pending'; break; }
        item.state = 'failed'; item.error = String(e?.message || e);
      }
      emitDownloads(true);
    }
  } catch (e) {
    console.warn('[tts] all voices', e);
  } finally {
    downloads.running = false; downloads.current = null;
    await refreshPiper(true).catch(() => {});
    emitDownloads(true);
  }
  return downloadsSnapshot();
}
function cancelDownloads() {
  if (!downloads.running) return;
  downloads.cancelled = true;
  const cur = downloads.items.find((x) => x.state === 'downloading');
  if (cur?.kind === 'de') { try { api.invoke?.('tts:piperCancel', cur.id); } catch {} }
  if (cur?.kind === 'en') cancelEnglish();
  emitDownloads(true);
}

/** "Karlsson (männlich)", "Thorsten (mittel)", "Heart (US, weiblich)" in the language of the interface. */
const QUALIFIERS = { 'männlich': 'male', 'weiblich': 'female', 'mittel': 'medium', 'hoch': 'high', 'schnell': 'fast', 'klein': 'small' };
function voiceName(name) {
  return String(name || '').replace(/\(([^)]*)\)/, (m, inner) => '(' + inner.split(/,\s*/).map((w) => (QUALIFIERS[w] ? tr({ de: w, en: QUALIFIERS[w] }) : w)).join(', ') + ')');
}

// --- public API --------------------------------------------------------------------------------------------------------
export const ttsClient = {
  /** { english, german, englishDetail, germanDetail, piperDetail, active, paused, index, total, lang, message } */
  async status() {
    await getSettings();
    await Promise.allSettled([refreshPiper(), refreshGerman()]);
    return snapshot();
  },
  /** Available voices for a language (German: Piper voices first, Kartoffelbox only when installed). */
  async voices(lang) {
    await getSettings();
    if (lang === 'en' || lang === 'en-us' || lang === 'en-gb') return KOKORO_VOICES.map((v) => ({ ...v, name: voiceName(v.name), plainName: voiceName(v.name) }));
    if (lang === 'de') {
      await refreshPiper();
      const list = piper.voices.map((v) => ({
        id: v.id, name: voiceName(v.name) + (v.installed ? '' : tr({ de: ' ({mb} MB laden)', en: ' (download {mb} MB)' }, { mb: Math.round((v.bytes || 0) / 1048576) })),
        plainName: voiceName(v.name),   // without the size note
        language: 'de', gender: v.gender || '', engine: v.engine || 'piper', installed: !!v.installed, downloading: !!v.downloading, bytes: v.bytes || 0,
        quality: v.quality || '', note: v.note || '', speakers: v.speakers,
      }));
      if (german.known && german.available) {
        const prompt = ttsSettings().germanPrompt;
        list.push({ id: KARTOFFEL_PREFIX + 'default', name: prompt ? 'Eigene Referenzstimme (Kartoffelbox)' : 'Standardstimme (Kartoffelbox)', language: 'de', gender: '', engine: 'kartoffelbox', installed: true });
        if (prompt) list.push({ id: KARTOFFEL_PREFIX + 'builtin', name: 'Eingebaute Stimme (ohne Referenz)', language: 'de', gender: '', engine: 'kartoffelbox', installed: true });
      }
      return list;
    }
    return [...(await this.voices('de')), ...(await this.voices('en'))];
  },
  /** Downloads a German voice now (settings panel). Progress arrives as 'tts:status' / 'tts:piper'. */
  async installVoice(id) {
    const entry = await ensurePiperVoice(id);
    await refreshPiper(true);
    return entry;
  },
  async removeVoice(id) {
    piperVoiceCache.delete(id);
    try { await api.invoke?.('tts:piperRemove', id); } catch {}
    return refreshPiper(true);
  },
  cancelVoiceDownload(id) { try { return api.invoke?.('tts:piperCancel', id); } catch { return false; } },
  /** The 28 English voices (all in one model, see englishModel). */
  englishVoices() { return KOKORO_VOICES.map((v) => ({ ...v, name: voiceName(v.name) })); },
  /** Is the English model on this computer? { cached: true|false|null, bytes, dtype } (nothing is loaded). */
  englishModel(force = false) { return englishModel(force); },
  /** Downloads the English model now; cancelEnglish() stops it. */
  installEnglish() { return installEnglish(); },
  cancelEnglish() { cancelEnglish(); },
  /** Every voice with its size and whether it is here (settings → "Alle Stimmen herunterladen"). */
  voiceInventory() { return voiceInventory(); },
  /** Downloads every voice that is missing, one after the other; progress as 'tts:downloads' (see downloadsSnapshot). */
  downloadAllVoices(opts) { return downloadAllVoices(opts); },
  cancelDownloads() { cancelDownloads(); },
  get downloads() { return downloadsSnapshot(); },
  /**
   * The voice a reading in `lang` would have to download first ({ id, name, bytes, lang }), or null. German: the chosen
   * voice (see missingGermanVoice); English: the model, when it is known not to be on this computer.
   */
  async missingVoice(lang, voiceId) {
    if (lang === 'en') {
      const m = await englishModel();
      return m.cached === false ? { id: ENGLISH_MODEL_ID, name: 'Kokoro', bytes: m.bytes || english.bytes, lang: 'en' } : null;
    }
    const de = await this.missingGermanVoice(voiceId);
    return de ? { ...de, lang: 'de' } : null;
  },
  /**
   * The German voice that a read-aloud would have to download first ({ id, name, bytes }), or null when it is on
   * disk already or Kartoffelbox was chosen. The reader and the read-aloud buttons ask before such a download.
   */
  async missingGermanVoice(voiceId) {
    await getSettings();
    const id = voiceId && GERMAN_ENGINES.includes(engineForVoice(voiceId)) ? voiceId : resolveGermanVoice(ttsSettings().germanVoice);
    if (!GERMAN_ONNX_ENGINES.includes(engineForVoice(id)) || piperVoiceCache.has(id)) return null;
    const list = await refreshPiper();
    const v = (list || []).find((x) => x.id === id);
    if (!v || v.installed) return null;
    return { id, name: String(v.name || id), bytes: v.bytes || 0 };
  },
  /**
   * Speak a list of sentences. Returns the session synchronously; audio starts as soon as the first sentence
   * is synthesized (the session waits for the settings cache internally). Any other session is stopped.
   * opts.gap (ms) replaces the pause between two sentences (default SENTENCE_PAUSE).
   */
  speak(sentences, opts = {}) {
    const list = (Array.isArray(sentences) ? sentences : [String(sentences ?? '')]).map((x) => String(x ?? '').trim()).filter(Boolean);
    this.stopAll();
    return createSession(list, opts); // an empty list ends immediately (onEnd)
  },
  /**
   * Split free text (article, wiki page …) into sentences and speak it. Every paragraph gets its language from its
   * text (an English quote on a German page is read in English); opts.lang (the page language) only decides text
   * that says nothing clear.
   */
  speakText(text, opts = {}) {
    const lang = opts.lang === 'de' || opts.lang === 'en' ? opts.lang : null;
    // a language chosen in the voice menu: every sentence in it (opts.force)
    if (opts.force && lang) { const sentences = splitSentences(String(text || ''), lang); return this.speak(sentences, { ...opts, lang, langs: sentences.map(() => lang) }); }
    const paras = String(text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const plan = planLanguages(paras, { meta: lang, ui: settingsCache?.language });
    const sentences = [], langs = [];
    paras.forEach((p, k) => { for (const sent of splitSentences(p, plan.langs[k])) { sentences.push(sent); langs.push(plan.langs[k]); } });
    return this.speak(sentences, { ...opts, lang: plan.base, langs });
  },
  stopAll() { for (const s of [...sessions]) { try { s.stop(); } catch {} } },
  /** Pre-load an engine: 'en' downloads/initialises Kokoro, 'de' downloads/loads the Piper voice. */
  async warmup(lang) {
    await getSettings();
    if (lang === 'en') return warmupEnglish();
    if (lang === 'de') { await refreshPiper(); return warmupGerman(); }
    await Promise.allSettled([this.warmup('en'), this.warmup('de')]);
  },
  /** Frees both worker models immediately (reader close, panel unmount). */
  dispose() {
    this.stopAll();
    kokoro.terminate();
    piperHost.terminate();
    kokoroDeHost.terminate();
    english.state = 'idle'; english.progress = 0;
    piper.state = piper.available ? 'idle' : piper.state;
    emitStatus();
  },
  get active() { return [...sessions].find((s) => !s.stopped) || null; },
  get context() { return ctx; },
  /** Timeline of the active or the last reading: { firstAudioMs, entries: [{ index, start, end, late, … }] }. */
  get timeline() { const a = this.active; return a ? a.timeline : lastTimeline; },
  /**
   * Renders sentences into one buffer the way a reading sounds, without playing anything (tests and analysis):
   * { sampleRate, samples, marks: [{ index, start, end }], pieces, synthMs }.
   */
  render(sentences, opts = {}) { return renderSentences((Array.isArray(sentences) ? sentences : [sentences]).map(String), opts); },
  splitSentences, detectLanguage, engineForVoice,
};
// the Electron check scripts (build/scripts/tts-de-check.js) reach the client here; the bundle does not export it
try { if (typeof window !== 'undefined') window.__ttsClient = ttsClient; } catch {}

getSettings();
refreshPiper();

// a film or a podcast that starts pauses the reading instead of talking over it (resume goes on where it stopped)
mediaFocus.register('tts', {
  hold() { for (const s of sessions) if (!s.stopped && !s.paused) s.pause(); },
  loaded: () => [...sessions].some((s) => !s.stopped),
});

// other panels (newspaper, wiki …) read aloud through the bus
bus.on('tts:speak', (p) => {
  const text = typeof p === 'string' ? p : p?.text;
  if (!text) return;
  ttsClient.speakText(text, { lang: p?.lang, voice: p?.voice, speed: p?.speed, onSentence: p?.onSentence, onEnd: p?.onEnd, onError: p?.onError || ((e) => console.warn('[tts] read-aloud failed', e?.message || e)) });
});
bus.on('tts:stop', () => ttsClient.stopAll());
window.addEventListener('beforeunload', () => { try { ttsClient.stopAll(); kokoro.terminate(); piperHost.terminate(); kokoroDeHost.terminate(); } catch {} });

export default ttsClient;
