// Kokoro/StyleTTS2 text-to-speech Web Worker – the German voice "Martin".
//
// Same architecture as the English Kokoro voice, but a German fine-tune that ships as a plain ONNX graph
// (Godelaune/Kokoro-82M-ONNX-German-Martin, Apache-2.0, based on kikiri-tts/kikiri-german-martin), so it
// runs on onnxruntime-web directly instead of Transformers.js (ort-runtime.js): on WebGPU (onnxruntime-web 1.30,
// app/vendor/ort-webgpu/) when the computer has it, else on the CPU (app/vendor/ort/, about two times slower than
// real time). The two model files (kokoro-martin.onnx, voices-martin.npz) are downloaded once by the main
// process into <userData>/piper-voices/ and handed over as lfile:// URLs (electron/tts/piper.js).
//
// Text → phonemes is espeak-ng (de-phonemes.js, the same as for the Piper voices); `espeakToKokoro()` turns its
// output into Kokoro's 178-symbol alphabet the way misaki (the phonemizer of the training) does. See docs/TTS.md.
//
// Protocol (identical to the Piper worker, so the client can reuse its worker host):
//   → { type:'load',  voice: Voice }
//   → { type:'speak', id, text, voice: Voice, speed?:1, phonemes?:string }
//   ← { type:'status', state:'idle'|'loading'|'ready'|'error', progress:0..1, message, voice, device }
//   ← { type:'audio', id, sampleRate:24000, samples:Float32Array (transferred), phonemes, phonemizer, synthMs }
//   ← { type:'error', id, error }        ← { type:'cancelled', id }
//   → { type:'cancel', id } | { type:'cancelAll' } | { type:'dispose' } | { type:'status' }
// Voice = { id, name, modelUrl, voicesUrl, voiceName?, device? }   device = 'webgpu'|'wasm' forces one
//
// Requests are processed strictly sequentially, exactly like the Piper and Kokoro workers.
import { loadOrt, hasWebGPU } from './ort-runtime.js';
import {
  espeakToKokoro, splitKokoroPhonemes, kokoroTokens, kokoroStyle, buildKokoroInputs,
  parseNpz, kokoroVoicePack, KOKORO_MAX_PHONEMES, KOKORO_SAMPLE_RATE,
} from './piper-de.js';
import { germanSentences, warmEspeak, phonemizerKind } from './de-phonemes.js';

const post = (msg, transfer) => self.postMessage(msg, transfer || []);
const baseUrl = new URL('../', self.location.href).href; // …/app/

// --- model cache ------------------------------------------------------------------------------------
const MODEL_CACHE = 'kokoro-de-models';
const sessions = new Map();   // voiceId → { session, pack, device, inputNames, outputName }
let loading = null;
let currentVoice = null;

function describeError(e) {
  const msg = String(e?.message || e || 'unbekannter Fehler');
  if (/failed to fetch|networkerror|load failed|ENOTFOUND|ECONN|404|offline/i.test(msg)) {
    return 'Die Stimme „Martin“ konnte nicht geladen werden (keine Verbindung?). Der Download von huggingface.co ist einmalig nötig. ' + msg;
  }
  if (/out of memory|allocation|RangeError/i.test(msg)) {
    return 'Für die Stimme „Martin“ reicht der Arbeitsspeicher nicht (das Modell ist 325 MB groß). ' + msg;
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
  const label = voice.name || voice.id;
  const promise = (async () => {
    post({ type: 'status', state: 'loading', progress: 0, message: `Lade Stimme ${label} …`, voice: voice.id });
    if (!voice.modelUrl || !voice.voicesUrl) throw new Error('Die Stimme „Martin“ ist nicht vollständig installiert (Modell oder Stimmdatei fehlt)');
    const phonemizer = warmEspeak(baseUrl);   // in parallel with the model
    const packBytes = await fetchWithProgress(voice.voicesUrl);
    const pack = kokoroVoicePack(await parseNpz(packBytes), voice.voiceName || 'martin');
    const bytes = await fetchWithProgress(voice.modelUrl, (p, loaded, total) => {
      post({ type: 'status', state: 'loading', progress: p, message: `Lade Sprachmodell … ${mb(loaded)} / ${mb(total)} MB`, voice: voice.id });
    });
    await phonemizer;
    // WebGPU when there is an adapter (the CPU is about two times slower than real time for this model), the CPU
    // as the fallback
    const attempts = [];
    if (voice.device === 'webgpu' || (voice.device !== 'wasm' && await hasWebGPU())) attempts.push('webgpu');
    attempts.push('wasm');
    let lastErr = null;
    for (const device of attempts) {
      try {
        const ort = await loadOrt(device, baseUrl);
        const session = await ort.InferenceSession.create(bytes, { executionProviders: [device], graphOptimizationLevel: 'all', logSeverityLevel: 3 });
        const entry = {
          ort, session, voice, pack: pack.data, device,
          inputNames: session.inputNames, outputName: session.outputNames[0],
          // older exports call the token input "input_ids" instead of "tokens" (kokoro-onnx does the same)
          tokensInput: session.inputNames.includes('input_ids') ? 'input_ids' : 'tokens',
        };
        sessions.set(voice.id, entry);
        currentVoice = voice.id;
        post({ type: 'status', state: 'ready', progress: 1, message: `Stimme bereit (${label}, ${device})` + (device === 'wasm' ? '. Ohne WebGPU spricht diese Stimme langsamer als in Echtzeit.' : ''), voice: voice.id, device, phonemizer: phonemizerKind() });
        return entry;
      } catch (e) { lastErr = e; console.warn('[kokoro-de-worker] session failed on', device, e); }
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
async function runChunk(entry, phonemes, speed) {
  const { ids, tokens } = kokoroTokens(phonemes);
  if (!ids.length) return new Float32Array(0);
  const spec = buildKokoroInputs(tokens, kokoroStyle(entry.pack, ids.length), speed);
  const feeds = {};
  for (const [name, t] of Object.entries(spec)) {
    const key = name === 'tokens' ? entry.tokensInput : name;
    if (!entry.inputNames.includes(key)) continue;
    feeds[key] = new entry.ort.Tensor(t.type, t.data, t.dims);
  }
  let res;
  try { res = await entry.session.run(feeds); }
  catch (e) {
    // a graph can load on WebGPU and still fail at run time (unsupported kernels): switch this voice to wasm
    // for good and run the chunk again
    // (not when the session was released under a running request: dispose, the worker is about to end)
    if (entry.device !== 'webgpu' || !entry.voice || entry.released) throw e;
    console.warn('[kokoro-de-worker] webgpu run failed, switching to wasm:', e?.message || e);
    sessions.delete(entry.voice.id);
    try { entry.session.release?.(); } catch {}
    const cpu = await loadVoice({ ...entry.voice, device: 'wasm' });
    Object.assign(entry, cpu);   // the next chunks of this request use the wasm session as well
    return runChunk(cpu, phonemes, speed);
  }
  const out = res[entry.outputName] || Object.values(res)[0];
  const raw = out.data instanceof Float32Array ? out.data : Float32Array.from(out.data);
  const samples = new Float32Array(raw.length);
  samples.set(raw);
  return samples;
}

async function synthesize(entry, text, speed, prePhonemes, isCancelled) {
  const t0 = performance.now();
  let phonemes = prePhonemes, phonemizer = 'given';
  if (!phonemes) {
    const { norm, sentences, source } = await germanSentences(text, baseUrl);
    const mapped = espeakToKokoro(sentences, norm);
    phonemes = mapped.phonemes;
    phonemizer = source;
    if (mapped.dropped.some((d) => d !== 'ʏ')) console.warn('[kokoro-de-worker] unknown phonemes dropped:', [...new Set(mapped.dropped)].join(' '));
  }
  const done = (samples) => ({ sampleRate: KOKORO_SAMPLE_RATE, samples, phonemes, phonemizer, synthMs: Math.round(performance.now() - t0) });
  const pieces = splitKokoroPhonemes(phonemes, KOKORO_MAX_PHONEMES);
  if (!pieces.length) return done(new Float32Array(0));
  const parts = [];
  let total = 0;
  for (const piece of pieces) {
    if (isCancelled?.()) return { ...done(new Float32Array(0)), cancelled: true };
    const part = await runChunk(entry, piece, speed);
    if (part.length) { parts.push(part); total += part.length; }
  }
  if (parts.length === 1) return done(parts[0]);
  const samples = new Float32Array(total);
  let off = 0;
  for (const p of parts) { samples.set(p, off); off += p.length; }
  return done(samples);
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
        const { sampleRate, samples, phonemes, phonemizer, synthMs } = await synthesize(entry, req.text, req.speed, req.phonemes, () => cancelled.has(req.id));
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
  console.warn('[kokoro-de-worker]', what, e);
  if (!sessions.size) { try { post({ type: 'status', state: 'error', progress: 0, message: describeError(e), voice: currentVoice }); } catch {} }
};
self.onerror = (e) => { stray('error', e?.message || e); return true; };
self.onunhandledrejection = (e) => { stray('unhandled rejection', e?.reason); e.preventDefault?.(); };

post({ type: 'status', state: 'idle', progress: 0, message: 'worker loaded' });
