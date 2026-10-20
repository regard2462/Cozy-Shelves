// Piper (VITS) text-to-speech Web Worker – German voices (Thorsten, Karlsson, Pavoque, Kerstin, Eva …).
//
// Runs the rhasspy/piper-voices ONNX models with onnxruntime-web (ort-runtime.js): the light voices on the CPU
// (wasm from app/vendor/ort/), Thorsten (hoch) on the graphics card when WebGPU is there (app/vendor/ort-webgpu/),
// never from a CDN. The model file itself is downloaded once by the main process into <userData>/piper-voices/
// and handed to the worker as an lfile:// URL (electron/tts/piper.js); in a plain browser (app/dev.html) the
// worker falls back to fetching the URL directly and caching the bytes in the Cache API.
//
// Protocol (postMessage):
//   → { type:'load',  voice: Voice }
//   → { type:'speak', id, text, voice: Voice, speed?:1, phonemes?:string }
//   ← { type:'status', state:'idle'|'loading'|'ready'|'error', progress:0..1, message, voice, device, phonemizer }
//   ← { type:'audio', id, sampleRate, samples:Float32Array (transferred), phonemes, phonemizer, synthMs }
//   ← { type:'error', id, error }        ← { type:'cancelled', id }
//   → { type:'cancel', id } | { type:'cancelAll' } | { type:'dispose' } | { type:'status' }
// Voice = { id, modelUrl, config, speakerId?, gpu?, device? }   config = the parsed <model>.onnx.json,
//   gpu = a heavy voice that should run on WebGPU, device = 'webgpu'|'wasm' forces one
//
// The phonemes come from espeak-ng (de-phonemes.js), like in Piper itself: one model run per espeak-ng sentence,
// joined with Piper's sentence pause. Requests are processed strictly sequentially, exactly like the Kokoro worker.
import { loadOrt, hasWebGPU } from './ort-runtime.js';
import { phonemesToIds, buildPiperInputs, speakerId } from './piper-de.js';
import { germanSentences, warmEspeak, phonemizerKind } from './de-phonemes.js';

const SENTENCE_SILENCE = 0.2;   // seconds between two sentences of one request (Piper's --sentence_silence)

const post = (msg, transfer) => self.postMessage(msg, transfer || []);
const baseUrl = new URL('../', self.location.href).href; // …/app/

// --- model cache ------------------------------------------------------------------------------------
const MODEL_CACHE = 'piper-models';
const sessions = new Map();   // voiceId → { session, config, inputNames, outputName }
let loading = null;
let currentVoice = null;

function describeError(e) {
  const msg = String(e?.message || e || 'unbekannter Fehler');
  if (/failed to fetch|networkerror|load failed|ENOTFOUND|ECONN|404|offline/i.test(msg)) {
    return 'Das Sprachmodell konnte nicht geladen werden (keine Verbindung?). Der Download von huggingface.co ist einmalig nötig. ' + msg;
  }
  return msg;
}

async function fetchWithProgress(url, onProgress) {
  const cacheable = /^https?:/i.test(url) && typeof caches !== 'undefined';
  if (cacheable) {
    try {
      const cache = await caches.open(MODEL_CACHE);
      const hit = await cache.match(url);
      if (hit) return new Uint8Array(await hit.arrayBuffer());
    } catch {}
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} beim Laden des Sprachmodells`);
  const total = Number(res.headers.get('content-length') || 0);
  if (!res.body || !total) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (cacheable) { try { (await caches.open(MODEL_CACHE)).put(url, new Response(buf)); } catch {} }
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0, last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    const now = Date.now();
    if (now - last > 120) { last = now; onProgress?.(loaded / total, loaded, total); }
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  if (cacheable) { try { (await caches.open(MODEL_CACHE)).put(url, new Response(out)); } catch {} }
  onProgress?.(1, loaded, total);
  return out;
}

async function loadVoice(voice) {
  if (!voice?.id) throw new Error('Keine Stimme angegeben');
  const have = sessions.get(voice.id);
  if (have) return have;
  if (loading && loading.id === voice.id) return loading.promise;
  const mb = (n) => (n / 1048576).toFixed(0);
  const promise = (async () => {
    post({ type: 'status', state: 'loading', progress: 0, message: `Lade Stimme ${voice.name || voice.id} …`, voice: voice.id });
    if (!voice.modelUrl) throw new Error('Das Sprachmodell ist nicht installiert');
    const phonemizer = warmEspeak(baseUrl);   // in parallel with the model
    const bytes = await fetchWithProgress(voice.modelUrl, (p, loaded, total) => {
      post({ type: 'status', state: 'loading', progress: p, message: `Lade Sprachmodell … ${mb(loaded)} / ${mb(total)} MB`, voice: voice.id });
    });
    await phonemizer;
    // the CPU for the light voices; the heavy ones (voice.gpu) on WebGPU when there is an adapter, with the CPU
    // as the fallback
    const attempts = [];
    if (voice.device === 'webgpu' || (voice.device !== 'wasm' && voice.gpu && await hasWebGPU())) attempts.push('webgpu');
    attempts.push('wasm');
    let lastErr = null;
    for (const device of attempts) {
      try {
        const ort = await loadOrt(device, baseUrl);
        const session = await ort.InferenceSession.create(bytes, { executionProviders: [device], graphOptimizationLevel: 'all', logSeverityLevel: 3 });
        const entry = { ort, session, voice, config: voice.config || {}, device, inputNames: session.inputNames, outputName: session.outputNames[0], speakerName: voice.speaker || null, speaker: typeof voice.speakerId === 'number' ? voice.speakerId : null };
        sessions.set(voice.id, entry);
        currentVoice = voice.id;
        post({ type: 'status', state: 'ready', progress: 1, message: `Stimme bereit (${voice.name || voice.id}, ${device})` + (device === 'wasm' && voice.gpu ? '. Ohne WebGPU spricht diese Stimme langsamer als in Echtzeit.' : ''), voice: voice.id, device, phonemizer: phonemizerKind() });
        return entry;
      } catch (e) { lastErr = e; console.warn('[piper-worker] session failed on', device, e); }
    }
    throw lastErr || new Error('ONNX-Sitzung konnte nicht erstellt werden');
  })();
  loading = { id: voice.id, promise };
  try { return await promise; }
  catch (e) {
    const error = describeError(e);
    post({ type: 'status', state: 'error', progress: 0, message: error, voice: voice.id });
    throw new Error(error);
  } finally { if (loading && loading.id === voice.id) loading = null; }
}

// --- synthesis --------------------------------------------------------------------------------------
// Symbols the model does not know are dropped, as Piper does it (the low models have no combining marks, so "ç"
// arrives as "c" there – exactly what they were trained on). Each unexpected symbol is reported once.
const reported = new Set(['\u0327', '\u0303', '\u032A', '\u032F', '\u0329']);
async function synthesize(entry, text, speed, prePhonemes) {
  const cfg = entry.config || {};
  const sampleRate = cfg.audio?.sample_rate || 22050;
  const t0 = performance.now();
  const { sentences, source } = prePhonemes ? { sentences: [prePhonemes], source: 'given' } : await germanSentences(text, baseUrl);
  const pieces = [];
  for (const phonemes of sentences) {
    const { ids, dropped } = phonemesToIds(phonemes, cfg.phoneme_id_map || {});
    const fresh = [...new Set(dropped)].filter((d) => !reported.has(d));
    if (fresh.length) { fresh.forEach((d) => reported.add(d)); console.warn('[piper-worker] unknown phonemes dropped:', fresh.join(' ')); }
    if (ids.length <= 3) continue;
    const audio = await runModel(entry, ids, speed);
    if (pieces.length) pieces.push(new Float32Array(Math.round(SENTENCE_SILENCE * sampleRate / Math.max(0.5, Number(speed) || 1))));
    pieces.push(audio);
  }
  const samples = new Float32Array(pieces.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of pieces) { samples.set(p, off); off += p.length; }
  return { sampleRate, samples, phonemes: sentences.join(' '), phonemizer: source, synthMs: Math.round(performance.now() - t0) };
}

/** One model run: phoneme ids → samples (a copy, so that the buffer can be transferred). */
async function runModel(entry, ids, speed) {
  const cfg = entry.config || {};
  const spec = buildPiperInputs(ids, cfg, speed, {
    multiSpeaker: entry.inputNames.includes('sid'),
    speakerId: entry.speaker != null ? entry.speaker : speakerId(cfg, entry.speakerName),
  });
  const feeds = {};
  for (const [name, t] of Object.entries(spec)) {
    if (name === 'sid' && !entry.inputNames.includes('sid')) continue;
    feeds[name] = new entry.ort.Tensor(t.type, t.data, t.dims);
  }
  let res;
  try { res = await entry.session.run(feeds); }
  catch (e) {
    // a WebGPU session that fails at run time (device lost, an unsupported kernel): switch this voice to the CPU
    // for good and speak the sentence again
    // (not when the session was released under a running request: dispose, the worker is about to end)
    if (entry.device !== 'webgpu' || !entry.voice || entry.released) throw e;
    console.warn('[piper-worker] webgpu run failed, switching to wasm:', e?.message || e);
    sessions.delete(entry.voice.id);
    try { entry.session.release?.(); } catch {}
    const cpu = await loadVoice({ ...entry.voice, device: 'wasm' });
    Object.assign(entry, cpu);   // the next sentences of this request use the wasm session as well
    return runModel(cpu, ids, speed);
  }
  const out = res[entry.outputName] || Object.values(res)[0];
  const raw = out.data instanceof Float32Array ? out.data : Float32Array.from(out.data);
  // the graph returns [1, 1, N] – copy so that the buffer can be transferred
  const samples = new Float32Array(raw.length);
  samples.set(raw);
  return samples;
}

// --- request queue ----------------------------------------------------------------------------------
const queue = [];
const cancelled = new Set();
let busy = false;
let runningId = null;

async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const req = queue.shift();
      if (cancelled.has(req.id)) { cancelled.delete(req.id); post({ type: 'cancelled', id: req.id }); continue; }
      runningId = req.id;
      try {
        const entry = await loadVoice(req.voice);
        if (cancelled.has(req.id)) { cancelled.delete(req.id); post({ type: 'cancelled', id: req.id }); continue; }
        const { sampleRate, samples, phonemes, phonemizer, synthMs } = await synthesize(entry, req.text, req.speed, req.phonemes);
        if (cancelled.has(req.id)) { cancelled.delete(req.id); post({ type: 'cancelled', id: req.id }); continue; }
        post({ type: 'audio', id: req.id, sampleRate, samples, phonemes, phonemizer, synthMs }, [samples.buffer]);
      } catch (e) {
        if (cancelled.has(req.id)) { cancelled.delete(req.id); post({ type: 'cancelled', id: req.id }); }
        else post({ type: 'error', id: req.id, error: describeError(e) });
      } finally { runningId = null; }
    }
  } finally { busy = false; }
}

function disposeAll() {
  for (const [, entry] of sessions) { entry.released = true; try { entry.session.release?.(); } catch {} }
  sessions.clear();
  currentVoice = null;
}

self.onmessage = (ev) => {
  const msg = ev.data || {};
  switch (msg.type) {
    case 'load':
      loadVoice(msg.voice || {}).catch(() => {});
      break;
    case 'speak':
      queue.push({ id: msg.id, text: msg.text, voice: msg.voice, speed: msg.speed, phonemes: msg.phonemes });
      pump();
      break;
    case 'cancel': {
      const idx = queue.findIndex((r) => r.id === msg.id);
      if (idx >= 0) { queue.splice(idx, 1); post({ type: 'cancelled', id: msg.id }); }
      else if (runningId === msg.id) cancelled.add(msg.id);
      break;
    }
    case 'cancelAll': {
      for (const r of queue.splice(0)) post({ type: 'cancelled', id: r.id });
      if (runningId != null) cancelled.add(runningId);
      break;
    }
    case 'status':
      post({ type: 'status', state: sessions.size ? 'ready' : loading ? 'loading' : 'idle', progress: sessions.size ? 1 : 0, voice: currentVoice });
      break;
    case 'dispose':
      disposeAll();
      post({ type: 'status', state: 'idle', progress: 0, voice: null });
      break;
    default:
      break;
  }
};

// Stray failures (onnxruntime's wasm loader) must never surface as uncaught exceptions in the page.
const stray = (what, e) => {
  console.warn('[piper-worker]', what, e);
  if (!sessions.size) { try { post({ type: 'status', state: 'error', progress: 0, message: describeError(e), voice: currentVoice }); } catch {} }
};
self.onerror = (e) => { stray('error', e?.message || e); return true; };
self.onunhandledrejection = (e) => { stray('unhandled rejection', e?.reason); e.preventDefault?.(); };

post({ type: 'status', state: 'idle', progress: 0, message: 'worker loaded' });
