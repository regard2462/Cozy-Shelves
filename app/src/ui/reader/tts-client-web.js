// Read-aloud in the browser version: the browser's own speech output (speechSynthesis) in place of the local
// voices of the desktop (tts-client.js: Kokoro, Piper, hundreds of megabytes of models that a web page must not
// carry). The surface is the one the reader, the read-aloud buttons, the voice menu and the settings use, so they work
// unchanged: status(), voices(lang), speak(sentences, opts) → session, speakText(text, opts), stopAll(), the bus
// events 'tts:speak' and 'tts:stop'. Downloads do not exist here: installVoice & co. answer at once.
// build/web.js resolves './tts-client.js' to this module; the desktop build never sees it.
import { api } from '../../core/api.js';
import { bus } from '../../core/bus.js';
import { tr } from '../../core/i18n.js';
import { audio } from '../../audio/engine.js';
import { mediaFocus } from '../../media/focus.js';
import { detectLanguage, splitSentences, planLanguages, normalizeLangCode } from './tts-lang.js';
import { hasChessNotation, speakChess } from './tts-chess.js';
import { DEFAULT_GERMAN_VOICE, KOKORO_DE_VOICE, engineForVoice, resolveGermanVoice } from './tts-voice-id.js';

export { DEFAULT_GERMAN_VOICE, KOKORO_DE_VOICE, engineForVoice, resolveGermanVoice };
export const KOKORO_VOICES = [];
export const PIPER_VOICES_FALLBACK = [];

const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
const WEB_PREFIX = 'web:';
const SENTENCE_PAUSE_MS = 180;

let settingsCache = null;
async function getSettings() {
  if (settingsCache) return settingsCache;
  try { settingsCache = await api.settings.get(); } catch { settingsCache = {}; }
  return settingsCache;
}
try { api.settings.onChange?.((s) => { settingsCache = s; }); } catch {}
const ttsSettings = () => settingsCache?.tts || {};

// ---- the voices of the browser ------------------------------------------------------------------------------------
let voiceList = [];
let voicesReady = null;
function loadVoices() {
  if (!synth) return Promise.resolve([]);
  if (voicesReady) return voicesReady;
  voicesReady = new Promise((resolve) => {
    const take = () => { voiceList = synth.getVoices() || []; if (voiceList.length) { resolve(voiceList); return true; } return false; };
    if (take()) return;
    // Chromium hands the list out asynchronously; some builds never fire the event when the list is empty
    const t = setTimeout(() => { take(); resolve(voiceList); }, 1500);
    synth.addEventListener?.('voiceschanged', () => { if (take()) clearTimeout(t); }, { once: true });
  });
  return voicesReady;
}
const langOfVoice = (v) => String(v.lang || '').toLowerCase().slice(0, 2);
/** The voices of a language as the voice menu lists them: { id, name, plainName, language, engine, installed }. */
function voicesFor(lang) {
  const list = voiceList.filter((v) => langOfVoice(v) === lang);
  // the local voices first (they work offline), then by name
  list.sort((a, b) => (b.localService ? 1 : 0) - (a.localService ? 1 : 0) || String(a.name).localeCompare(String(b.name)));
  return list.map((v) => ({ id: WEB_PREFIX + v.voiceURI, name: v.name + (v.localService ? '' : tr({ de: ' (online)', en: ' (online)' })), plainName: v.name, language: lang, gender: '', engine: 'browser', installed: true, downloading: false, bytes: 0, quality: '', note: v.lang }));
}
/** The browser voice for a language: the chosen one when it is one of ours, else the default of the browser for it. */
function pickVoice(lang, wanted) {
  const list = voiceList.filter((v) => langOfVoice(v) === lang);
  if (!list.length) return null;
  if (wanted && String(wanted).startsWith(WEB_PREFIX)) { const uri = wanted.slice(WEB_PREFIX.length); const v = list.find((x) => x.voiceURI === uri); if (v) return v; }
  return list.find((v) => v.default && v.localService) || list.find((v) => v.localService) || list[0];
}

// ---- status ------------------------------------------------------------------------------------------------------
const sessions = new Set();
function snapshot() {
  const de = voiceList.some((v) => langOfVoice(v) === 'de'), en = voiceList.some((v) => langOfVoice(v) === 'en');
  const active = [...sessions].find((s) => !s.stopped) || null;
  return {
    english: !synth ? 'unavailable' : en ? 'ready' : 'unavailable',
    german: !synth ? 'unavailable' : de ? 'ready' : 'unavailable',
    englishDetail: { engine: 'browser', voices: voiceList.filter((v) => langOfVoice(v) === 'en').length },
    germanDetail: { engine: 'browser', device: tr({ de: 'Sprachausgabe des Browsers', en: 'the browser’s speech output' }), voices: voiceList.filter((v) => langOfVoice(v) === 'de').length },
    piperDetail: { state: 'ready' },
    active: !!active, paused: !!active?.paused, index: active?.index ?? -1, total: active?.total ?? 0, lang: active?.lang || null,
    message: !synth ? tr({ de: 'Dieser Browser hat keine Sprachausgabe.', en: 'This browser has no speech output.' }) : '',
  };
}
function emitStatus(extra = {}) { bus.emit('tts:status', { ...snapshot(), ...extra }); }

// ---- a reading ---------------------------------------------------------------------------------------------------
let sessionSeq = 0;
/**
 * Speaks the sentences one after the other with speechSynthesis. The session has the shape of the desktop's:
 * pause(), resume(), stop(), skip(±1), update({ voice, speed }), paused, playing, index, total, lang, timeline.
 * Callbacks: onSentence(i), onEnd(), onError(e), onStatus(st).
 */
function createSession(sentences, opts = {}) {
  const preset = (i) => (opts.langs?.[i] === 'de' || opts.langs?.[i] === 'en' ? opts.langs[i] : null);
  const items = sentences.map((text, i) => ({ i, text: String(text || ''), preset: preset(i) }));
  const forced = opts.lang === 'de' || opts.lang === 'en' ? opts.lang : null;
  const majority = () => { const n = { de: 0, en: 0 }; for (const it of items) if (it.preset) n[it.preset] += it.text.length; return n.de + n.en ? (n.de >= n.en ? 'de' : 'en') : null; };
  const base = forced || majority() || detectLanguage(items.slice(0, 20).map((x) => x.text).join(' ')) || null;
  const s = { id: ++sessionSeq, lang: base || 'de', total: items.length, index: -1, stopped: false, paused: false, playing: false, started: false, ended: false, timeline: [], t0: performance.now(), firstAudioMs: null, utter: null, gen: 0 };
  let speed = 1, voices = { en: null, de: null };
  function prepare() {
    const t = ttsSettings();
    speed = Math.min(2, Math.max(0.5, Number(opts.speed) || Number(t.speed) || 1));
    if (!base) s.lang = normalizeLangCode(settingsCache?.language) === 'en' ? 'en' : 'de';
    const chosenEn = String(opts.voice || '').startsWith(WEB_PREFIX) ? opts.voice : t.englishVoice;
    const chosenDe = String(opts.voice || '').startsWith(WEB_PREFIX) ? opts.voice : t.germanVoice;
    voices = { en: pickVoice('en', chosenEn), de: pickVoice('de', chosenDe) };
  }
  const langOf = (it) => it.preset || s.lang;
  /** What is said for a sentence: chess moves in words (tts-chess.js), else the text as it is. */
  const spoken = (it) => { const lang = langOf(it); return opts.chess && hasChessNotation(it.text) ? speakChess(it.text, lang) : it.text; };

  function finish(stopped) {
    if (s.stopped) return;
    s.stopped = true; s.playing = false;
    const gen = ++s.gen;
    try { if (synth && (synth.speaking || synth.pending)) synth.cancel(); } catch {}
    sessions.delete(session);
    try { audio.duck?.(false, 'tts'); } catch {}
    mediaFocus.changed();
    emitStatus();
    if (!stopped && !s.ended) { s.ended = true; try { opts.onEnd?.(); } catch (e) { console.warn('[tts-web] onEnd', e); } }
    void gen;
  }
  function speakAt(i) {
    if (s.stopped || !synth) return;
    if (i >= items.length) { finish(false); return; }
    const it = items[i];
    const gen = ++s.gen;
    s.index = i;
    const u = new SpeechSynthesisUtterance(spoken(it));
    const lang = langOf(it);
    const v = voices[lang] || voices[lang === 'de' ? 'en' : 'de'];
    if (v) u.voice = v;
    u.lang = v?.lang || (lang === 'en' ? 'en-US' : 'de-DE');
    u.rate = speed;
    const startedAt = performance.now();
    u.onstart = () => {
      if (gen !== s.gen || s.stopped) return;
      s.playing = true; s.started = true;
      if (s.firstAudioMs == null) s.firstAudioMs = performance.now() - s.t0;
      s.timeline.push({ index: i, start: (performance.now() - s.t0) / 1000, late: false, synthMs: performance.now() - startedAt });
      if (s.timeline.length > 500) s.timeline.splice(0, s.timeline.length - 500);
      try { opts.onSentence?.(i); } catch (e) { console.warn('[tts-web] onSentence', e); }
      emitStatus();
    };
    u.onend = () => {
      if (gen !== s.gen || s.stopped) return;
      const tl = s.timeline[s.timeline.length - 1]; if (tl && tl.index === i) tl.end = (performance.now() - s.t0) / 1000;
      s.playing = false;
      setTimeout(() => { if (gen === s.gen && !s.stopped && !s.paused) speakAt(i + 1); }, SENTENCE_PAUSE_MS);
    };
    u.onerror = (e) => {
      if (gen !== s.gen || s.stopped) return;
      // 'interrupted' and 'canceled' are our own cancel() (skip, stop); everything else is a real failure
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      const err = new Error(e.error === 'not-allowed' ? tr({ de: 'Die Sprachausgabe braucht zuerst einen Klick in die Seite.', en: 'Speech output needs a click into the page first.' }) : (e.error || 'speech failed'));
      try { opts.onError?.(err); } catch {}
      finish(true);
    };
    s.utter = u;
    try { synth.speak(u); } catch (e) { try { opts.onError?.(e); } catch {} finish(true); }
  }
  const session = {
    get paused() { return s.paused; },
    get playing() { return s.playing; },
    get stopped() { return s.stopped; },
    get index() { return s.index; },
    get total() { return s.total; },
    get lang() { return s.lang; },
    get speed() { return speed; },
    get timeline() { return { firstAudioMs: s.firstAudioMs, entries: s.timeline.slice() }; },
    pause() {
      if (s.stopped || s.paused) return;
      s.paused = true;
      // pause() of speechSynthesis is unreliable across browsers: the sentence is cancelled and spoken again on resume
      s.gen++; try { synth?.cancel(); } catch {}
      s.playing = false;
      emitStatus();
    },
    resume() {
      if (s.stopped || !s.paused) return;
      s.paused = false;
      mediaFocus.claim('tts');
      speakAt(Math.max(0, s.index));
    },
    stop() { finish(true); },
    skip(delta = 1) {
      if (s.stopped) return;
      const next = Math.max(0, Math.min(items.length, (s.index < 0 ? 0 : s.index) + (delta || 1)));
      s.gen++; try { synth?.cancel(); } catch {}
      s.paused = false;
      speakAt(next);
    },
    update(patch = {}) {
      if ('voice' in patch) opts.voice = patch.voice || undefined;
      if ('speed' in patch) opts.speed = patch.speed;
      prepare();
      if (!s.stopped && !s.paused && s.index >= 0) { s.gen++; try { synth?.cancel(); } catch {} speakAt(s.index); }
    },
  };
  sessions.add(session);
  (async () => {
    await getSettings();
    await loadVoices();
    if (s.stopped) return;
    prepare();
    if (!synth) { const e = new Error(tr({ de: 'Dieser Browser hat keine Sprachausgabe.', en: 'This browser has no speech output.' })); try { opts.onError?.(e); } catch {} finish(true); return; }
    if (!items.length) { finish(false); return; }
    try { audio.duck?.(true, 'tts'); } catch {}
    mediaFocus.claim('tts');
    try { opts.onStatus?.({ message: tr({ de: 'Sprachausgabe startet …', en: 'Speech output starting …' }) }); } catch {}
    speakAt(0);
  })();
  return session;
}

// ---- public API ---------------------------------------------------------------------------------------------------
export const ttsClient = {
  async status() { await getSettings(); await loadVoices(); return snapshot(); },
  async voices(lang) {
    await getSettings(); await loadVoices();
    if (lang === 'en' || lang === 'en-us' || lang === 'en-gb') return voicesFor('en');
    if (lang === 'de') return voicesFor('de');
    return [...voicesFor('de'), ...voicesFor('en')];
  },
  async installVoice(id) { return { id, name: id, installed: true }; },
  async removeVoice() { return []; },
  cancelVoiceDownload() { return false; },
  englishVoices() { return voicesFor('en'); },
  englishModel() { return { cached: true, bytes: 0, dtype: 'browser' }; },
  installEnglish() { return Promise.resolve(true); },
  cancelEnglish() {},
  voiceInventory() { return []; },
  downloadAllVoices() { return Promise.resolve({ running: false, items: [], total: 0, received: 0, progress: 1, failed: 0 }); },
  cancelDownloads() {},
  get downloads() { return { running: false, cancelled: false, current: null, items: [], total: 0, received: 0, progress: 1, failed: 0 }; },
  async missingVoice() { return null; },
  async missingGermanVoice() { return null; },
  speak(sentences, opts = {}) {
    const list = (Array.isArray(sentences) ? sentences : [String(sentences ?? '')]).map((x) => String(x ?? '').trim()).filter(Boolean);
    this.stopAll();
    return createSession(list, opts);
  },
  speakText(text, opts = {}) {
    const lang = opts.lang === 'de' || opts.lang === 'en' ? opts.lang : null;
    if (opts.force && lang) { const sentences = splitSentences(String(text || ''), lang); return this.speak(sentences, { ...opts, lang, langs: sentences.map(() => lang) }); }
    const paras = String(text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const plan = planLanguages(paras, { meta: lang, ui: settingsCache?.language });
    const sentences = [], langs = [];
    paras.forEach((p, k) => { for (const sent of splitSentences(p, plan.langs[k])) { sentences.push(sent); langs.push(plan.langs[k]); } });
    return this.speak(sentences, { ...opts, lang: plan.base, langs });
  },
  stopAll() { for (const s of [...sessions]) { try { s.stop(); } catch {} } },
  async warmup() { await loadVoices(); },
  dispose() { this.stopAll(); },
  get active() { return [...sessions].find((s) => !s.stopped) || null; },
  get context() { return null; },
  get timeline() { const a = this.active; return a ? a.timeline : { firstAudioMs: null, entries: [] }; },
  render() { return Promise.reject(new Error('render() is not available with the browser’s speech output')); },
  splitSentences, detectLanguage, engineForVoice,
  web: true,
};
try { if (typeof window !== 'undefined') window.__ttsClient = ttsClient; } catch {}

getSettings();
loadVoices().then(() => emitStatus());

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
window.addEventListener('beforeunload', () => { try { ttsClient.stopAll(); } catch {} });

export default ttsClient;
