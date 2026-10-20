// Kokoro text-to-speech Web Worker (English). Runs fully locally via kokoro-js / Transformers.js / onnxruntime-web.
//
// Bundled by build/bundle.js to app/dist/tts-worker.js. kokoro-js is bundled from its ESM source so that the
// Transformers.js version inside the bundle matches the onnxruntime-web wasm files copied to app/vendor/ort/
// (build/vendor.js). The model (onnx-community/Kokoro-82M-v1.0-ONNX) is downloaded from Hugging Face on first
// use and stored in the browser Cache API ('transformers-cache' / 'kokoro-voices'), so it is a one-time download
// (~90 MB q8 for WASM, ~330 MB fp32 for WebGPU). Under app:// the Cache API fails ("Unexpected internal error"),
// so the model files are then kept in IndexedDB instead (idbCache below); otherwise every new worker would
// download the model again.
//
// Protocol (postMessage):
//   → { type: 'init', opts?: { device?: 'webgpu'|'wasm', dtype?: 'fp32'|'q8'|…, model?: string } }
//   ← { type: 'status', state: 'loading'|'ready'|'error', progress?: 0..1, message?, device?, dtype?, files? }
//   → { type: 'speak', id, text, voice?: 'af_heart', speed?: 1 }
//   ← { type: 'audio', id, sampleRate, samples: Float32Array (transferred), text }
//   ← { type: 'error', id, error }             (a failed request; the worker stays alive)
//   ← { type: 'cancelled', id }                (request was cancelled before/while running)
//   → { type: 'voices' }        ← { type: 'voices', voices: [{ id, name, language, gender, grade, traits }] }
//   → { type: 'cached', id, opts? }  ← { type: 'cached', id, cached, device, dtype, bytes }  (is the model on this
//                                       computer? nothing is loaded or downloaded)
//   → { type: 'cancel', id }    (removes the request from the queue; a running one is dropped when it finishes)
//   → { type: 'cancelAll' }
//   → { type: 'dispose' }       (frees the model)
// Requests are processed strictly sequentially in the order received.

import { KokoroTTS } from 'kokoro-js';
import { env } from '@huggingface/transformers';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const SAMPLE_RATE = 24000;

// Static voice table (mirrors kokoro-js' list; used when the model is not loaded yet).
const VOICES = [
  ['af_heart', 'Heart', 'en-us', 'Female', 'A', '❤️'], ['af_bella', 'Bella', 'en-us', 'Female', 'A-', '🔥'],
  ['af_nicole', 'Nicole', 'en-us', 'Female', 'B-', '🎧'], ['af_aoede', 'Aoede', 'en-us', 'Female', 'C+'],
  ['af_kore', 'Kore', 'en-us', 'Female', 'C+'], ['af_sarah', 'Sarah', 'en-us', 'Female', 'C+'],
  ['af_alloy', 'Alloy', 'en-us', 'Female', 'C'], ['af_nova', 'Nova', 'en-us', 'Female', 'C'],
  ['af_sky', 'Sky', 'en-us', 'Female', 'C-'], ['af_jessica', 'Jessica', 'en-us', 'Female', 'D'],
  ['af_river', 'River', 'en-us', 'Female', 'D'],
  ['am_michael', 'Michael', 'en-us', 'Male', 'C+'], ['am_fenrir', 'Fenrir', 'en-us', 'Male', 'C+'],
  ['am_puck', 'Puck', 'en-us', 'Male', 'C+'], ['am_echo', 'Echo', 'en-us', 'Male', 'D'],
  ['am_eric', 'Eric', 'en-us', 'Male', 'D'], ['am_liam', 'Liam', 'en-us', 'Male', 'D'],
  ['am_onyx', 'Onyx', 'en-us', 'Male', 'D'], ['am_santa', 'Santa', 'en-us', 'Male', 'D-'],
  ['am_adam', 'Adam', 'en-us', 'Male', 'F+'],
  ['bf_emma', 'Emma', 'en-gb', 'Female', 'B-'], ['bf_isabella', 'Isabella', 'en-gb', 'Female', 'C'],
  ['bf_alice', 'Alice', 'en-gb', 'Female', 'D'], ['bf_lily', 'Lily', 'en-gb', 'Female', 'D'],
  ['bm_george', 'George', 'en-gb', 'Male', 'C'], ['bm_fable', 'Fable', 'en-gb', 'Male', 'C'],
  ['bm_lewis', 'Lewis', 'en-gb', 'Male', 'D+'], ['bm_daniel', 'Daniel', 'en-gb', 'Male', 'D'],
].map(([id, name, language, gender, grade, traits]) => ({ id, name, language, gender, grade, traits: traits || '' }));

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

// --- environment ----------------------------------------------------------------------------------------------
// Everything is resolved relative to this worker script (app://lesesaal/dist/tts-worker.js or the dev server),
// so the wasm files come from app/vendor/ort/ and never from a CDN.
const baseUrl = new URL('../', self.location.href).href; // …/app/

// --- model cache: Cache API when it works, IndexedDB otherwise ------------------------------------------------
const IDB_NAME = 'lesesaal-kokoro', IDB_STORE = 'files';
let idbPromise = null;
const idb = () => (idbPromise ||= new Promise((resolve, reject) => {
  const req = indexedDB.open(IDB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => { idbPromise = null; reject(req.error); };
}));
const idbCall = (mode, fn) => idb().then((db) => new Promise((resolve, reject) => {
  const tx = db.transaction(IDB_STORE, mode);
  const r = fn(tx.objectStore(IDB_STORE));
  tx.oncomplete = () => resolve(r?.result);
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
}));
/** The subset of the Cache API that Transformers.js uses (env.customCache: match + put). */
const idbCache = {
  async match(key) {
    try {
      const rec = await idbCall('readonly', (st) => st.get(String(key)));
      return rec?.blob ? new Response(rec.blob, { headers: rec.headers || {} }) : undefined;
    } catch { return undefined; }
  },
  async put(key, response) {
    const blob = await response.blob();
    const headers = { 'content-type': response.headers.get('content-type') || 'application/octet-stream', 'content-length': String(blob.size) };
    await idbCall('readwrite', (st) => st.put({ blob, headers, at: Date.now() }, String(key)));
  },
};
let cacheChecked = false;
async function chooseCache() {
  if (cacheChecked) return;
  cacheChecked = true;
  let browserCache = false;
  try { if (typeof caches !== 'undefined') { await caches.open('transformers-cache'); browserCache = true; } } catch { browserCache = false; }
  env.useBrowserCache = browserCache;
  if (!browserCache && typeof indexedDB !== 'undefined') { env.useCustomCache = true; env.customCache = idbCache; }
}

function configureEnv(opts = {}) {
  try {
    const wasmPaths = opts.wasmPaths || new URL('vendor/ort/', baseUrl).href;
    env.backends.onnx.wasm.wasmPaths = wasmPaths;
    // avoid the multi-threaded path when SharedArrayBuffer is not available (no COOP/COEP under app://)
    if (typeof SharedArrayBuffer === 'undefined' || !self.crossOriginIsolated) env.backends.onnx.wasm.numThreads = 1;
    env.allowRemoteModels = true;
    // optional offline mirror: app/vendor/models/onnx-community/Kokoro-82M-v1.0-ONNX/{config.json,tokenizer.json,onnx/…}
    env.allowLocalModels = true;
    env.localModelPath = opts.localModelPath || new URL('vendor/models/', baseUrl).href;
  } catch (e) {
    console.warn('[tts-worker] env configuration failed', e);
  }
}

// Voice style vectors: kokoro-js fetches them from huggingface.co (cached in the 'kokoro-voices' Cache).
// If the .bin files were copied to app/vendor/kokoro/voices/ we serve them from there instead (offline use).
const realFetch = self.fetch.bind(self);
const VOICE_RE = /\/Kokoro-82M-v1\.0-ONNX\/resolve\/main\/voices\/([a-z]{2}_[a-z]+)\.bin$/;
self.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url;
  const m = url && VOICE_RE.exec(url);
  if (m) {
    try {
      const local = await realFetch(new URL(`vendor/kokoro/voices/${m[1]}.bin`, baseUrl).href);
      if (local.ok && Number(local.headers.get('content-length') || 1) > 0) return local;
    } catch {}
  }
  return realFetch(input, init);
};

// --- model lifecycle ------------------------------------------------------------------------------------------
let tts = null;
let loading = null;
let current = { device: null, dtype: null };

/** WebGPU only when an adapter really exists: navigator.gpu alone says nothing (software GL, blocked drivers). */
async function pickBackend(opts = {}) {
  let device = opts.device;
  if (!device) {
    device = 'wasm';
    try { if (typeof navigator !== 'undefined' && navigator.gpu && await navigator.gpu.requestAdapter()) device = 'webgpu'; } catch { device = 'wasm'; }
  }
  const dtype = opts.dtype || (device === 'webgpu' ? 'fp32' : 'q8');
  return { device, dtype };
}

function makeProgress() {
  const files = new Map();
  let lastPost = 0;
  return (p) => {
    if (!p || typeof p !== 'object') return;
    if (p.status === 'progress' && p.file) files.set(p.file, { loaded: p.loaded || 0, total: p.total || 0 });
    if (p.status === 'done' && p.file && files.has(p.file)) { const f = files.get(p.file); f.loaded = f.total || f.loaded; }
    let loaded = 0, total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    const now = Date.now();
    if (p.status === 'progress' && now - lastPost < 120) return;
    lastPost = now;
    const progress = total ? Math.min(1, loaded / total) : 0;
    const mb = (n) => (n / 1048576).toFixed(0);
    const message = p.status === 'progress'
      ? `Lade Kokoro-Modell … ${mb(loaded)} / ${mb(total)} MB`
      : p.status === 'ready' ? 'Modell geladen' : p.status === 'initiate' ? `Prüfe ${p.file || ''}` : (p.file ? `${p.status}: ${p.file}` : String(p.status || ''));
    post({ type: 'status', state: 'loading', progress, message, device: current.device, dtype: current.dtype, files: files.size });
  };
}

async function loadModel(opts = {}) {
  if (tts) return tts;
  if (loading) return loading;
  loading = (async () => {
    configureEnv(opts);
    await chooseCache();
    const att = await pickBackend(opts);
    current = att;
    post({ type: 'status', state: 'loading', progress: 0, message: `Initialisiere Kokoro (${att.device}, ${att.dtype}) …`, device: att.device, dtype: att.dtype });
    try {
      const model = await KokoroTTS.from_pretrained(opts.model || MODEL_ID, { dtype: att.dtype, device: att.device, progress_callback: makeProgress() });
      // warm-up: a tiny synthesis compiles the WebGPU shaders / initialises the wasm session
      try { await model.generate('Hi.', { voice: 'af_heart', speed: 1 }); } catch (e) { console.warn('[tts-worker] warm-up failed', e); }
      tts = model;
      post({ type: 'status', state: 'ready', progress: 1, message: `Kokoro bereit (${att.device}, ${att.dtype})`, device: att.device, dtype: att.dtype });
      return tts;
    } catch (e) {
      console.warn('[tts-worker] load failed on', att.device, e);
      const error = describeError(e);
      // Transformers.js keeps the first InferenceSession promise: after a failed WebGPU session every later
      // session in this worker fails with the same error, the wasm one too. A fresh worker has to try wasm.
      const restart = att.device === 'webgpu' && !opts.device ? { device: 'wasm', dtype: 'q8' } : null;
      post({ type: 'status', state: 'error', progress: 0, message: error, device: att.device, dtype: att.dtype, restart });
      throw Object.assign(new Error(error), { restart });
    }
  })();
  try { return await loading; } finally { loading = null; }
}

// --- is the model on this computer? (the voice menu and "download all voices" ask before anything is loaded) ------
// Transformers.js names the model file after the dtype and keeps every file under its huggingface.co URL.
const DTYPE_SUFFIX = { fp32: '', fp16: '_fp16', q8: '_quantized', int8: '_int8', uint8: '_uint8', q4: '_q4', q4f16: '_q4f16', bnb4: '_bnb4' };
// bytes of the files of a download, for the sizes the interface shows (huggingface.co, onnx-community/Kokoro-82M-v1.0-ONNX)
const MODEL_BYTES = { fp32: 325532232, q8: 92361116 };
const SMALL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json'];
const SMALL_BYTES = 3654;
async function cachedModel(opts = {}) {
  configureEnv(opts);
  await chooseCache();
  const att = await pickBackend(opts);
  const files = [...SMALL_FILES, `onnx/model${DTYPE_SUFFIX[att.dtype] ?? ''}.onnx`];
  let cached = true;
  for (const f of files) {
    const key = `https://huggingface.co/${opts.model || MODEL_ID}/resolve/main/${f}`;
    let hit = null;
    try {
      if (env.useCustomCache && env.customCache) hit = await env.customCache.match(key);
      else if (env.useBrowserCache && typeof caches !== 'undefined') hit = await (await caches.open('transformers-cache')).match(key);
    } catch { hit = null; }
    if (!hit) { cached = false; break; }
  }
  return { cached, device: att.device, dtype: att.dtype, bytes: (MODEL_BYTES[att.dtype] || MODEL_BYTES.q8) + SMALL_BYTES };
}

function describeError(e) {
  const msg = String(e?.message || e || 'unknown error');
  if (msg.startsWith('Kokoro-Modell konnte nicht geladen werden')) return msg;
  if (/failed to fetch|networkerror|network|ENOTFOUND|ECONN|load failed|404|Unable to load/i.test(msg)) {
    return 'Kokoro-Modell konnte nicht geladen werden (kein Internet? Der Download von huggingface.co ist einmalig nötig). ' + msg;
  }
  return msg;
}

// --- request queue --------------------------------------------------------------------------------------------
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
        const model = await loadModel(req.opts || {});
        const text = String(req.text || '').trim();
        let samples, sampleRate = SAMPLE_RATE;
        if (req.voice && !VOICES.some((v) => v.id === req.voice)) {
          // never silently substitute another voice – a German id routed here would sound plain wrong
          post({ type: 'error', id: req.id, error: `Unbekannte Kokoro-Stimme: ${req.voice}` });
          continue;
        }
        if (!text) {
          samples = new Float32Array(0);
        } else {
          const voice = req.voice || 'af_heart';
          const speed = Math.min(2, Math.max(0.5, Number(req.speed) || 1));
          const audio = await model.generate(text, { voice, speed });
          samples = audio.audio instanceof Float32Array ? audio.audio : new Float32Array(audio.audio);
          sampleRate = audio.sampling_rate || SAMPLE_RATE;
        }
        if (cancelled.has(req.id)) { cancelled.delete(req.id); post({ type: 'cancelled', id: req.id }); continue; }
        post({ type: 'audio', id: req.id, sampleRate, samples, text }, [samples.buffer]);
      } catch (e) {
        if (cancelled.has(req.id)) { cancelled.delete(req.id); post({ type: 'cancelled', id: req.id }); }
        else post({ type: 'error', id: req.id, error: describeError(e), restart: e?.restart || null });
      } finally { runningId = null; }
    }
  } finally { busy = false; }
}

self.onmessage = (ev) => {
  const msg = ev.data || {};
  switch (msg.type) {
    case 'init':
      loadModel(msg.opts || {}).catch(() => {});
      break;
    case 'speak':
      queue.push({ id: msg.id, text: msg.text, voice: msg.voice, speed: msg.speed, opts: msg.opts });
      pump();
      break;
    case 'voices': {
      const voices = VOICES.map((v) => ({ ...v }));
      post({ type: 'voices', voices, id: msg.id });
      break;
    }
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
      post({ type: 'status', state: tts ? 'ready' : loading ? 'loading' : 'idle', progress: tts ? 1 : 0, device: current.device, dtype: current.dtype });
      break;
    case 'cached':
      cachedModel(msg.opts || {}).then((r) => post({ type: 'cached', id: msg.id, ...r }), (e) => post({ type: 'cached', id: msg.id, cached: false, error: describeError(e) }));
      break;
    case 'dispose':
      try { tts?.model?.dispose?.(); } catch {}
      tts = null;
      post({ type: 'status', state: 'idle', progress: 0 });
      break;
    default:
      break;
  }
};

// Stray failures (e.g. onnxruntime's wasm loader) must never surface as uncaught exceptions in the page.
const stray = (what, e) => {
  console.warn('[tts-worker]', what, e);
  if (!tts) { try { post({ type: 'status', state: 'error', progress: 0, message: describeError(e), device: current.device, dtype: current.dtype }); } catch {} }
};
self.onerror = (e) => { stray('error', e?.message || e); return true; };
self.onunhandledrejection = (e) => { stray('unhandled rejection', e?.reason); e.preventDefault?.(); };

post({ type: 'status', state: 'idle', progress: 0, message: 'worker loaded' });
