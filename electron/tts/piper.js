// German text-to-speech voice files – no Python, no CUDA, no 8 GB download.
//
// This module owns the *voice files* of both German ONNX engines: it knows the catalogue (the Piper/VITS
// voices in huggingface.co/rhasspy/piper-voices and the Kokoro/StyleTTS2 voice "Martin" in
// huggingface.co/Godelaune/Kokoro-82M-ONNX-German-Martin), downloads a voice once into
// <userData>/piper-voices/ (resumable, with progress), verifies it and hands the renderer
// lfile:// URLs plus – for Piper – the parsed <voice>.onnx.json. The actual inference runs in the renderer
// (app/src/workers/piper-worker.js resp. kokoro-de-worker.js) on the onnxruntime-web wasm that already
// ships in app/vendor/ort.
//
// IPC (reached from the renderer through the generic api.invoke escape hatch, see electron/preload.js):
//   tts:piperVoices  ()                  → { voices: [Voice], dir, offline }
//   tts:piperEnsure  (id, { download? }) → { ok, id, engine, modelUrl, voicesUrl?, config, path, bytes }
//                                        | { error, code:'offline'|'not-installed'|'download-failed'|'unknown-voice' }
//   tts:piperStatus  ()                  → { voices, active, downloading, dir }
//   tts:piperCancel  (id)                → true          tts:piperRemove (id) → true
//   broadcast 'tts:piper' { id, state:'idle'|'downloading'|'ready'|'error', progress, message, voices }
//
// Voice = { id, name, language:'de', gender, quality, sampleRate, bytes, installed, engine:'piper'|'kokoro-de', gpu, speakers? }
//   gpu = a heavy voice that the worker runs on WebGPU when the computer has it (app/src/workers/ort-runtime.js)
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

// COZYSHELVES_PIPER_BASE overrides the download location (mirror, offline copy, tests).
const REPO = process.env.COZYSHELVES_PIPER_BASE || 'https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/';
// The Kokoro German voice lives in its own repository; COZYSHELVES_KOKORO_DE_BASE overrides it the same way.
const KOKORO_DE_REPO = process.env.COZYSHELVES_KOKORO_DE_BASE || 'https://huggingface.co/Godelaune/Kokoro-82M-ONNX-German-Martin/resolve/main/';
const DOWNLOAD_TIMEOUT_MS = 60 * 1000;   // per socket, not for the whole file
const MAX_RESUME_ATTEMPTS = 4;

// The catalogue is static: these files exist in the repository (verified against the HF file listing).
// `bytes` is the exact size and doubles as the integrity check after a download.
// Two engines share this module: 'piper' (a .onnx + .onnx.json next to each other in rhasspy/piper-voices)
// and 'kokoro-de' (a .onnx graph + a .npz voice pack). `files` describes the second kind explicitly.
const CATALOGUE = [
  // the default voice first (DEFAULT_VOICE below)
  {
    id: 'de_DE-martin-kokoro', engine: 'kokoro-de', name: 'Martin (Kokoro)', gender: 'male', quality: 'high',
    sampleRate: 24000, bytes: 325512630 + 522506, voiceName: 'martin', gpu: true,
    note: 'kikiri-tts/Kokoro-82M, natürlichste deutsche Stimme (Standard), 311 MB, rechnet auf der Grafikkarte (WebGPU)',
    files: [
      { key: 'model', ext: '.onnx', path: 'kokoro-martin.onnx', bytes: 325512630, base: KOKORO_DE_REPO },
      { key: 'voices', ext: '.voices.npz', path: 'voices-martin.npz', bytes: 522506, base: KOKORO_DE_REPO },
    ],
  },
  { id: 'de_DE-thorsten-medium', dir: 'thorsten/medium', name: 'Thorsten (mittel)', gender: 'male', quality: 'medium', sampleRate: 22050, bytes: 63201294, note: 'Thorsten-Voice, läuft auf jedem Rechner flüssig' },
  { id: 'de_DE-thorsten-high', dir: 'thorsten/high', name: 'Thorsten (hoch)', gender: 'male', quality: 'high', sampleRate: 22050, bytes: 113895201, gpu: true, note: 'beste Piper-Qualität, rechnet auf der Grafikkarte (WebGPU)' },
  { id: 'de_DE-thorsten-low', dir: 'thorsten/low', name: 'Thorsten (schnell)', gender: 'male', quality: 'low', sampleRate: 16000, bytes: 63104526, note: 'für langsame Rechner' },
  { id: 'de_DE-thorsten_emotional-medium', dir: 'thorsten_emotional/medium', name: 'Thorsten emotional', gender: 'male', quality: 'medium', sampleRate: 22050, bytes: 76745905, note: 'acht Stimmungen (neutral, fröhlich, ärgerlich …)' },
  { id: 'de_DE-karlsson-low', dir: 'karlsson/low', name: 'Karlsson (männlich)', gender: 'male', quality: 'low', sampleRate: 16000, bytes: 63104526, note: 'ruhige männliche Erzählstimme' },
  { id: 'de_DE-pavoque-low', dir: 'pavoque/low', name: 'Pavoque (männlich)', gender: 'male', quality: 'low', sampleRate: 16000, bytes: 63104526 },
  { id: 'de_DE-kerstin-low', dir: 'kerstin/low', name: 'Kerstin (weiblich)', gender: 'female', quality: 'low', sampleRate: 16000, bytes: 63104526 },
  { id: 'de_DE-ramona-low', dir: 'ramona/low', name: 'Ramona (weiblich)', gender: 'female', quality: 'low', sampleRate: 16000, bytes: 63104526 },
  { id: 'de_DE-eva_k-x_low', dir: 'eva_k/x_low', name: 'Eva (weiblich, klein)', gender: 'female', quality: 'x_low', sampleRate: 16000, bytes: 20628813, note: 'kleinster Download (20 MB)' },
];
const DEFAULT_VOICE = 'de_DE-martin-kokoro';   // = DEFAULT_GERMAN_VOICE in app/src/ui/reader/tts-voice-id.js

let ctx = null;
const downloads = new Map();  // id → { received, total, aborted, req }
const configs = new Map();    // id → parsed onnx.json
let lastError = null;

// --- paths ------------------------------------------------------------------------------------------
function baseDir() {
  if (process.env.COZYSHELVES_PIPER_DIR) return process.env.COZYSHELVES_PIPER_DIR;
  try { return path.join(ctx.app.getPath('userData'), 'piper-voices'); }
  catch { return path.join(__dirname, '..', '..', '.piper-voices'); }
}
const modelPath = (id) => path.join(baseDir(), id + '.onnx');
const configPath = (id) => path.join(baseDir(), id + '.onnx.json');
const entryFor = (id) => CATALOGUE.find((v) => v.id === id) || null;

/**
 * Every file a voice consists of, in download order, with its exact size.
 * Piper: <id>.onnx.json (size unknown, a few kB) + <id>.onnx. Kokoro: the entries of `entry.files`.
 * @returns {{ key: string, url: string, dest: string, bytes: number }[]}
 */
function filesFor(entry) {
  if (entry.engine === 'kokoro-de') {
    return entry.files.map((f) => ({
      key: f.key, url: (f.base || KOKORO_DE_REPO) + f.path,
      dest: path.join(baseDir(), entry.id + f.ext), bytes: f.bytes || 0,
    }));
  }
  return [
    { key: 'config', url: REPO + entry.dir + '/' + entry.id + '.onnx.json', dest: configPath(entry.id), bytes: 0 },
    { key: 'model', url: REPO + entry.dir + '/' + entry.id + '.onnx', dest: modelPath(entry.id), bytes: entry.bytes || 0 },
  ];
}

function installed(entry) {
  try {
    for (const f of filesFor(entry)) {
      const st = fs.statSync(f.dest);
      if (!st.isFile() || st.size < 16) return false;
      if (f.bytes && st.size !== f.bytes) return false;
    }
    return true;
  } catch { return false; }
}

/**
 * Bytes of a voice that are on disk already: complete files and the .part files of a download that was cancelled or
 * broke off (the next download goes on from there with a Range request).
 */
function bytesOnDisk(entry) {
  let n = 0;
  for (const f of filesFor(entry)) {
    for (const p of [f.dest, f.dest + '.part']) {
      try { const st = fs.statSync(p); if (st.isFile()) { n += f.bytes ? Math.min(st.size, f.bytes) : 0; break; } } catch {}
    }
  }
  return Math.min(n, entry.bytes || n);
}

/** The voice list the renderer shows (settings + reader bar). */
function voices() {
  return CATALOGUE.map((v) => {
    const done = installed(v);
    return {
      id: v.id, name: v.name, language: 'de', gender: v.gender, quality: v.quality,
      sampleRate: v.sampleRate, bytes: v.bytes, note: v.note || '', engine: v.engine || 'piper', gpu: !!v.gpu,
      installed: done, downloading: downloads.has(v.id),
      // what a download already left on disk (resumed, not loaded again)
      received: done ? v.bytes : (downloads.get(v.id)?.received || bytesOnDisk(v)),
      speakers: configs.get(v.id)?.speaker_id_map ? Object.keys(configs.get(v.id).speaker_id_map) : undefined,
    };
  });
}

function status() {
  const active = [...downloads.entries()][0];
  return {
    dir: baseDir(), voices: voices(), defaultVoice: DEFAULT_VOICE,
    downloading: active ? active[0] : null,
    progress: active && active[1].total ? active[1].received / active[1].total : 0,
    received: active ? active[1].received : 0,
    error: lastError,
  };
}
function emit(extra) {
  try { ctx?.broadcast?.('tts:piper', { ...status(), ...(extra || {}) }); } catch {}
}

// --- download ---------------------------------------------------------------------------------------
const MAX_REDIRECTS = 10;
function httpGet(url, headers, onResponse, hops = 0) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('http://') ? http : https;
    const req = mod.get(url, { headers: { 'user-agent': 'CozyShelves/0.7 (voice download)', ...(headers || {}) } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        // a mirror that sends the download round in circles: an end instead of requests without end
        if (hops >= MAX_REDIRECTS) return reject(Object.assign(new Error(`Zu viele Weiterleitungen für ${url}`), { code: 'download-failed' }));
        let next;
        try { next = new URL(res.headers.location, url).href; } catch { return reject(Object.assign(new Error(`Ungültige Weiterleitung für ${url}`), { code: 'download-failed' })); }
        if (!/^https?:\/\//i.test(next)) return reject(Object.assign(new Error(`Ungültige Weiterleitung für ${url}`), { code: 'download-failed' }));
        return httpGet(next, headers, onResponse, hops + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        return reject(Object.assign(new Error(`HTTP ${res.statusCode} für ${url}`), { code: res.statusCode === 404 ? 'unknown-voice' : 'download-failed' }));
      }
      onResponse(res, req);
      res.on('end', () => resolve(res));
      res.on('error', reject);
    });
    req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => req.destroy(Object.assign(new Error('Zeitüberschreitung beim Download'), { code: 'download-failed' })));
    req.on('error', (e) => {
      if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH/.test(e.code || '')) e.code = 'offline';
      reject(e);
    });
  });
}

async function downloadFile(url, dest, expectedBytes, onProgress, state) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = dest + '.part';
  let attempt = 0;
  for (;;) {
    if (state?.aborted) throw Object.assign(new Error('Download abgebrochen'), { code: 'cancelled' });
    let have = 0;
    try { have = fs.statSync(part).size; } catch {}
    if (expectedBytes && have > expectedBytes) { try { fs.unlinkSync(part); } catch {} have = 0; }
    if (expectedBytes && have === expectedBytes) break;
    try {
      await new Promise((resolve, reject) => {
        let out = null, received = have;
        let settled = false;
        // every path (finish, error, abort, half-closed socket) has to settle this promise exactly once,
        // otherwise a cancelled or dropped download hangs forever
        const done = (err) => {
          if (settled) return;
          settled = true;
          try { out?.destroy(); } catch {}
          if (err) reject(err); else resolve();
        };
        httpGet(url, have ? { Range: `bytes=${have}-` } : null, (res, req) => {
          if (state) state.req = req;   // cancel() destroys it at once, also when the server sends nothing
          // a server that ignores the Range header (a plain mirror) answers 200 with the whole file: that replaces the
          // part instead of being appended to it (a voice file with the first bytes twice was no voice)
          if (res.statusCode === 200 && have) { have = 0; received = 0; }
          out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
          const total = expectedBytes || (Number(res.headers['content-length'] || 0) + have);
          res.on('data', (chunk) => {
            if (state?.aborted) {
              try { req.destroy(); } catch {}
              try { res.destroy(); } catch {}
              return done(Object.assign(new Error('Download abgebrochen'), { code: 'cancelled' }));
            }
            received += chunk.length;
            onProgress?.(received, total);
          });
          res.pipe(out);
          out.on('finish', () => done());
          out.on('error', done);
          res.on('error', done);
          res.on('aborted', () => done(Object.assign(new Error('Verbindung abgebrochen'), { code: 'download-failed' })));
          res.on('close', () => { if (!res.complete) done(Object.assign(new Error('Verbindung abgebrochen'), { code: 'download-failed' })); });
        }).catch(done);
      });
    } catch (e) {
      if (state?.aborted) throw Object.assign(new Error('Download abgebrochen'), { code: 'cancelled' });
      if (e.code === 'offline' || e.code === 'unknown-voice' || ++attempt > MAX_RESUME_ATTEMPTS) throw e;
      await new Promise((r) => setTimeout(r, 800 * attempt));
      continue; // resume where the partial file ended
    }
    if (state?.aborted) throw Object.assign(new Error('Download abgebrochen'), { code: 'cancelled' });
    const size = fs.statSync(part).size;
    if (!expectedBytes || size === expectedBytes) break;
    if (size > expectedBytes) { try { fs.unlinkSync(part); } catch {} }
    if (++attempt > MAX_RESUME_ATTEMPTS) throw Object.assign(new Error(`Download unvollständig (${size} von ${expectedBytes} Bytes)`), { code: 'download-failed' });
  }
  fs.renameSync(part, dest);
}

/** Makes sure the voice files are on disk; downloads them once when `download` is not false. */
async function ensure(id, opts = {}) {
  const entry = entryFor(id) || entryFor(DEFAULT_VOICE);
  if (!entry) return { error: 'Unbekannte Stimme: ' + id, code: 'unknown-voice' };
  if (installed(entry)) return ready(entry);
  if (opts.download === false) return { error: 'Die Stimme ist noch nicht heruntergeladen', code: 'not-installed', id: entry.id };
  // a second request (read-aloud while the settings panel downloads the same voice) waits for that download
  const running = downloads.get(entry.id);
  if (running) return running.promise;

  const state = { received: 0, total: entry.bytes, aborted: false, req: null, promise: null };
  downloads.set(entry.id, state);
  state.promise = download(entry, state);
  return state.promise;
}

async function download(entry, state) {
  lastError = null;
  emit({ id: entry.id, state: 'downloading', message: `Lade Stimme ${entry.name} …` });
  let lastPost = 0;
  try {
    // all files of the voice, one after the other; the progress is reported over their combined size
    const parts = filesFor(entry);
    const grandTotal = parts.reduce((n, f) => n + (f.bytes || 0), 0) || entry.bytes || 0;
    let done = 0;
    for (const f of parts) {
      // a file that is already complete is kept – repairing one broken 500 kB member of a voice must
      // never re-download its 311 MB sibling
      if (f.bytes) { try { if (fs.statSync(f.dest).size === f.bytes) { done += f.bytes; continue; } } catch {} }
      await downloadFile(f.url, f.dest, f.bytes, (received, total) => {
        state.received = done + received;
        state.total = grandTotal || done + total;
        const now = Date.now();
        if (now - lastPost < 300) return;
        lastPost = now;
        const mb = (n) => (n / 1048576).toFixed(0);
        emit({ id: entry.id, state: 'downloading', message: `Lade Stimme ${entry.name} … ${mb(state.received)} / ${mb(state.total)} MB` });
      }, state);
      done += f.bytes || fs.statSync(f.dest).size;
    }
    const res = ready(entry);
    emit({ id: entry.id, state: 'ready', message: `Stimme ${entry.name} ist bereit` });
    return res;
  } catch (e) {
    if (e.code === 'cancelled') {
      lastError = null;
      emit({ id: entry.id, state: 'idle', message: `Download von ${entry.name} abgebrochen` });
      return { error: 'Der Download wurde abgebrochen.', code: 'cancelled', id: entry.id };
    }
    lastError = e.code === 'offline'
      ? 'Keine Internetverbindung. Die Stimme muss einmalig heruntergeladen werden.'
      : `Download fehlgeschlagen: ${e.message}`;
    emit({ id: entry.id, state: 'error', message: lastError });
    return { error: lastError, code: e.code || 'download-failed', id: entry.id };
  } finally {
    downloads.delete(entry.id);
  }
}

const url = (file) => { try { return ctx?.lfileUrl ? ctx.lfileUrl(file) : null; } catch { return null; } };

function ready(entry) {
  const parts = filesFor(entry);
  if (entry.engine === 'kokoro-de') {
    const model = parts.find((f) => f.key === 'model');
    const pack = parts.find((f) => f.key === 'voices');
    return {
      ok: true, id: entry.id, name: entry.name, engine: 'kokoro-de', path: model.dest,
      modelUrl: url(model.dest), voicesUrl: url(pack.dest), voiceName: entry.voiceName || null,
      bytes: entry.bytes, sampleRate: entry.sampleRate, config: null, gpu: !!entry.gpu,
    };
  }
  let config = configs.get(entry.id);
  if (!config) {
    try { config = JSON.parse(fs.readFileSync(configPath(entry.id), 'utf8')); }
    catch (e) { return { error: 'Die Stimmkonfiguration ist beschädigt: ' + e.message, code: 'download-failed', id: entry.id }; }
    configs.set(entry.id, config);
  }
  const file = modelPath(entry.id);
  return {
    ok: true, id: entry.id, name: entry.name, engine: 'piper', path: file, modelUrl: url(file),
    bytes: entry.bytes, sampleRate: entry.sampleRate, config, gpu: !!entry.gpu,
  };
}

function remove(id) {
  const entry = entryFor(id);
  if (!entry) return false;
  for (const f of filesFor(entry)) {
    for (const p of [f.dest, f.dest + '.part']) {
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
    }
  }
  configs.delete(id);
  emit({ id, state: 'idle', message: `Stimme ${entry.name} entfernt` });
  return true;
}

function cancel(id) {
  const st = downloads.get(id);
  if (!st) return false;
  st.aborted = true;
  try { st.req?.destroy(Object.assign(new Error('Download abgebrochen'), { code: 'cancelled' })); } catch {}
  return true;
}

// --- registration -----------------------------------------------------------------------------------
function register(context) {
  ctx = context;
  const { ipcMain } = ctx;
  ipcMain.handle('tts:piperVoices', () => ({ voices: voices(), dir: baseDir(), defaultVoice: DEFAULT_VOICE }));
  ipcMain.handle('tts:piperEnsure', (e, id, opts) => ensure(id, opts || {}));
  ipcMain.handle('tts:piperStatus', () => status());
  ipcMain.handle('tts:piperRemove', (e, id) => remove(id));
  ipcMain.handle('tts:piperCancel', (e, id) => cancel(id));
  ipcMain.handle('tts:piperOpenFolder', () => {
    try { fs.mkdirSync(baseDir(), { recursive: true }); require('electron').shell.openPath(baseDir()); } catch {}
    return baseDir();
  });
}

function shutdown() { for (const [, st] of downloads) st.aborted = true; }

module.exports = { register, shutdown, voices, ensure, status, remove, cancel, CATALOGUE, DEFAULT_VOICE, _internal: { baseDir, modelPath, configPath, filesFor, installed, downloadFile, setContext: (c) => { ctx = c; } } };
