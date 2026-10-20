// Python sidecar for German text-to-speech (Kartoffelbox = German fine-tune of Resemble AI's Chatterbox).
// Manages tts-server/server.py: locates the venv, spawns the server on a free port, waits for READY, restarts it
// after crashes (max 3), kills it on app exit. IPC channels (see electron/preload.js api.tts.*):
//   tts:status      → status object (see status())
//   tts:german      (text, { voice, speed, prompt, exaggeration, cfg_weight }) → { sampleRate, pcm (base64 int16), seconds }
//                    or { error, code: 'not-installed'|'start-failed'|'request-failed', status }
//   tts:start       ({ restart? }) → status          tts:stop → status
//   tts:setup       → launches tts-server/setup_tts.bat (visible console) / setup_tts.sh
//   tts:pickPrompt  → file dialog for a reference WAV (voice cloning prompt) → path; saved to settings.tts.germanPrompt
//   tts:clearPrompt → removes the prompt          tts:log → last stderr lines        tts:openFolder → reveals tts-server/
// The server's stdout protocol: "PORT=<n>", "STATUS=<text>", "MODEL=<name>", "DEVICE=<cuda|cpu>", "READY".
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const MAX_RESTARTS = 3;
const START_TIMEOUT_MS = 15 * 60 * 1000;   // first start may download model weights
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;  // long paragraph on CPU
const LOG_LINES = 200;

let ctx = null;
let child = null;
let startPromise = null;
let stopping = false;
let restarts = 0;
const log = [];
const state = { available: false, running: false, starting: false, port: null, model: null, device: null, error: null, message: '', dir: null, python: null, pid: null, restarts: 0 };

// --- location -----------------------------------------------------------------------------------------------------
function candidates() {
  const list = [];
  if (process.env.COZYSHELVES_TTS_SERVER) list.push(process.env.COZYSHELVES_TTS_SERVER);
  if (process.resourcesPath) list.push(path.join(process.resourcesPath, 'tts-server'));
  list.push(path.join(__dirname, '..', '..', 'tts-server'));
  try { if (ctx?.app?.getPath) list.push(path.join(ctx.app.getPath('userData'), 'tts-server')); } catch {}
  return list;
}
function serverDir() {
  const list = candidates();
  return list.find((d) => fs.existsSync(path.join(d, 'server.py'))) || list[list.length - 2] || list[0];
}
function pythonPath(dir) {
  if (process.env.COZYSHELVES_TTS_PYTHON) return process.env.COZYSHELVES_TTS_PYTHON;
  const custom = ttsSettings().pythonPath;
  if (custom && fs.existsSync(custom)) return custom;
  const venv = path.join(dir, 'venv');
  return process.platform === 'win32' ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python');
}
function ttsSettings() { try { return ctx?.settings?.get('tts') || {}; } catch { return {}; } }
function refresh() {
  state.dir = serverDir();
  state.python = pythonPath(state.dir);
  state.available = fs.existsSync(path.join(state.dir, 'server.py')) && fs.existsSync(state.python);
  state.pid = child?.pid || null;
  state.restarts = restarts;
  return state;
}
function status() { refresh(); return { ...state, promptPath: ttsSettings().germanPrompt || null, platform: process.platform }; }
function emit(message) {
  if (message !== undefined) state.message = message;
  try { ctx?.broadcast?.('tts:status', status()); } catch {}
}
function addLog(line) { log.push(line); if (log.length > LOG_LINES) log.splice(0, log.length - LOG_LINES); }

// --- process management --------------------------------------------------------------------------------------------
function start(opts = {}) {
  // a restart always kills the old process AND the memoised promise – otherwise the caller gets the
  // pending promise of the process we just killed and no new server is ever spawned
  if (opts.restart) { if (child) stop(); startPromise = null; }
  if (child && state.running) return Promise.resolve(status());
  if (startPromise) return startPromise;
  startPromise = new Promise((resolve, reject) => {
    refresh();
    if (!state.available) {
      state.error = 'not-installed';
      emit('Deutsche Sprachausgabe ist nicht eingerichtet (tts-server/venv fehlt). Bitte setup_tts ausführen.');
      const err = new Error(state.message); err.code = 'not-installed';
      return reject(err);
    }
    const t = ttsSettings();
    const model = t.germanModel === 'v0.1' ? 'v0.1' : 'turbo';
    const args = [path.join(state.dir, 'server.py'), '--port', '0', '--model', model, '--watch-stdin'];
    if (t.germanDevice) args.push('--device', String(t.germanDevice));
    if (process.env.COZYSHELVES_TTS_FAKE) args.push('--fake');
    state.starting = true; state.running = false; state.error = null; state.port = null; state.model = model; stopping = false;
    emit('Kartoffelbox wird gestartet, das Modell wird geladen …');
    let proc;
    try {
      proc = spawn(state.python, args, {
        cwd: state.dir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
    } catch (e) {
      state.starting = false; state.error = e.message; emit('Start fehlgeschlagen: ' + e.message);
      const err = new Error('Python konnte nicht gestartet werden: ' + e.message); err.code = 'start-failed';
      return reject(err);
    }
    child = proc;
    state.pid = proc.pid;
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err); else resolve(status());
    };
    const timer = setTimeout(() => {
      const err = new Error('Zeitüberschreitung beim Start des TTS-Servers'); err.code = 'start-failed';
      try { proc.kill(); } catch {}
      finish(err);
    }, START_TIMEOUT_MS);

    let outBuf = '';
    proc.stdout.on('data', (d) => {
      outBuf += d.toString('utf8');
      let i;
      while ((i = outBuf.indexOf('\n')) >= 0) {
        const line = outBuf.slice(0, i).trim(); outBuf = outBuf.slice(i + 1);
        if (!line) continue;
        addLog('[out] ' + line);
        if (line.startsWith('PORT=')) { state.port = parseInt(line.slice(5), 10) || null; }
        else if (line.startsWith('STATUS=')) emit(line.slice(7));
        else if (line.startsWith('MODEL=')) state.model = line.slice(6);
        else if (line.startsWith('DEVICE=')) state.device = line.slice(7);
        else if (line === 'READY') {
          if (!state.port) { const err = new Error('TTS-Server hat keinen Port gemeldet'); err.code = 'start-failed'; try { proc.kill(); } catch {} finish(err); continue; }
          waitHealthy(state.port).then((h) => {
            if (child !== proc) return;
            if (!h) {
              // READY was printed but the HTTP socket is unreachable (port taken, firewall, wrong interface)
              state.starting = false; state.running = false;
              state.error = 'TTS-Server antwortet nicht auf /health';
              try { proc.kill(); } catch {}
              emit(state.error);
              const err = new Error(state.error); err.code = 'start-failed';
              return finish(err);
            }
            state.model = h.model || state.model; state.device = h.device || state.device;
            state.running = true; state.starting = false; state.error = null; restarts = 0;
            emit(`Kartoffelbox bereit (${state.model}, ${state.device || '?'})`);
            finish(null);
          });
        }
      }
    });
    let errBuf = '';
    proc.stderr.on('data', (d) => {
      errBuf += d.toString('utf8');
      let i;
      while ((i = errBuf.indexOf('\n')) >= 0) {
        const line = errBuf.slice(0, i).replace(/\r$/, ''); errBuf = errBuf.slice(i + 1);
        if (line.trim()) { addLog('[err] ' + line); if (!state.running && /downloading|fetching|loading|lade|%/i.test(line) && line.length < 160) emit(line.trim()); }
      }
    });
    proc.on('error', (e) => {
      addLog('[spawn-error] ' + e.message);
      state.error = e.message; state.starting = false; state.running = false; child = null;
      emit('TTS-Server konnte nicht gestartet werden: ' + e.message);
      const err = new Error(state.message); err.code = 'start-failed'; finish(err);
    });
    proc.on('exit', (code, signal) => {
      addLog(`[exit] code=${code} signal=${signal}`);
      if (child !== proc) { finish(Object.assign(new Error('gestoppt'), { code: 'stopped' })); return; } // stopped or replaced deliberately
      const wasRunning = state.running;
      child = null;
      state.running = false; state.starting = false; state.port = null; state.pid = null;
      if (stopping) { emit('TTS-Server beendet'); finish(Object.assign(new Error('gestoppt'), { code: 'stopped' })); return; }
      const tail = log.filter((l) => l.startsWith('[err]')).slice(-6).map((l) => l.slice(6)).join('\n');
      if (!wasRunning) {
        state.error = `TTS-Server beendet (Code ${code})${tail ? ': ' + tail : ''}`;
        emit(state.error);
        const err = new Error(state.error); err.code = 'start-failed'; err.log = tail; finish(err);
        return;
      }
      // crashed while running → restart (max 3)
      if (restarts < MAX_RESTARTS) {
        restarts++;
        state.error = `TTS-Server abgestürzt (Code ${code}), Neustart ${restarts}/${MAX_RESTARTS}`;
        emit(state.error);
        setTimeout(() => { if (!child && !stopping) start().catch(() => {}); }, 1500 * restarts);
      } else {
        state.error = `TTS-Server wiederholt abgestürzt (Code ${code})${tail ? ': ' + tail : ''}`;
        emit(state.error);
      }
    });
  }).finally(() => { startPromise = null; });
  return startPromise;
}

function waitHealthy(port, tries = 40) {
  return new Promise((resolve) => {
    const attempt = (n) => {
      if (!port) return resolve(null);
      request(port, 'GET', '/health', null, 3000).then((r) => resolve(r)).catch(() => { if (n <= 0) resolve(null); else setTimeout(() => attempt(n - 1), 250); });
    };
    attempt(tries);
  });
}

function stop() {
  const proc = child;
  child = null;
  stopping = true;
  if (proc) {
    try { proc.stdin.end(); } catch {}
    try { proc.kill(); } catch {}
    if (process.platform === 'win32') { try { spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {}); } catch {} }
  }
  state.running = false; state.starting = false; state.port = null; state.pid = null;
  emit(proc ? 'TTS-Server gestoppt' : '');
  return status();
}

async function ensureRunning() {
  if (child && state.running && state.port) return;
  await start();
}

// --- HTTP -----------------------------------------------------------------------------------------------------------
function request(port, method, urlPath, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = body != null ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json ?? { text });
        else reject(new Error((json && (json.error || json.message)) || `HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
      });
    });
    req.setTimeout(timeoutMs || REQUEST_TIMEOUT_MS, () => { req.destroy(new Error('Zeitüberschreitung bei der Anfrage an den TTS-Server')); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function resolvePrompt(voice) {
  const t = ttsSettings();
  if (voice === 'builtin' || voice === 'none') return null;
  if (voice && voice !== 'default' && typeof voice === 'string' && path.isAbsolute(voice) && fs.existsSync(voice)) return voice;
  return t.germanPrompt && fs.existsSync(t.germanPrompt) ? t.germanPrompt : null;
}

async function german(text, opts = {}) {
  const clean = String(text || '').trim();
  if (!clean) return { sampleRate: 24000, pcm: '', seconds: 0 };
  try {
    await ensureRunning();
  } catch (e) {
    return { error: e.message, code: e.code || 'start-failed', status: status() };
  }
  const body = {
    text: clean,
    voice_prompt: opts.prompt && fs.existsSync(opts.prompt) ? opts.prompt : resolvePrompt(opts.voice),
    exaggeration: typeof opts.exaggeration === 'number' ? opts.exaggeration : undefined,
    cfg_weight: typeof opts.cfg_weight === 'number' ? opts.cfg_weight : undefined,
    temperature: typeof opts.temperature === 'number' ? opts.temperature : undefined,
    // NOTE: Chatterbox has no speed parameter – the client applies playbackRate for this engine
    // (see NATIVE_SPEED in app/src/ui/reader/tts-client.js). Sending `speed` here was a no-op.
  };
  try {
    const res = await request(state.port, 'POST', '/tts', body);
    if (!res || !res.pcm) return { error: (res && res.error) || 'Leere Antwort des TTS-Servers', code: 'request-failed', status: status() };
    return { sampleRate: res.sampleRate || res.sample_rate || 24000, pcm: res.pcm, seconds: res.seconds };
  } catch (e) {
    return { error: e.message, code: 'request-failed', status: status() };
  }
}

// --- setup ------------------------------------------------------------------------------------------------------------
function setup() {
  refresh();
  const dir = state.dir;
  try {
    if (process.platform === 'win32') {
      const bat = path.join(dir, 'setup_tts.bat');
      if (!fs.existsSync(bat)) return { ok: false, error: 'setup_tts.bat nicht gefunden in ' + dir };
      const p = spawn(`start "Cozy Shelves: Sprachausgabe einrichten" /D "${dir}" cmd /k "${bat}"`, [], { shell: true, detached: true, stdio: 'ignore', windowsHide: false });
      p.on('error', (e) => addLog('[setup-error] ' + e.message));
      p.unref();
      emit('Einrichtung läuft in einem separaten Konsolenfenster …');
      return { ok: true, dir };
    }
    const sh = path.join(dir, 'setup_tts.sh');
    if (!fs.existsSync(sh)) return { ok: false, error: 'setup_tts.sh nicht gefunden in ' + dir };
    const logFile = path.join(dir, 'setup.log');
    let p = null;
    if (process.platform === 'darwin') {
      try { fs.chmodSync(sh, 0o755); } catch {}
      p = spawn('open', ['-a', 'Terminal', sh], { detached: true, stdio: 'ignore', env: { ...process.env, COZYSHELVES_SETUP_PAUSE: '1' } });
    } else {
      const terms = [['x-terminal-emulator', ['-e']], ['gnome-terminal', ['--']], ['konsole', ['-e']], ['xfce4-terminal', ['-e']], ['xterm', ['-e']]];
      for (const [bin, pre] of terms) {
        const found = (process.env.PATH || '').split(path.delimiter).some((d) => fs.existsSync(path.join(d, bin)));
        if (found) { p = spawn(bin, [...pre, 'bash', sh], { cwd: dir, detached: true, stdio: 'ignore', env: { ...process.env, COZYSHELVES_SETUP_PAUSE: '1' } }); break; }
      }
    }
    if (!p) {
      const out = fs.openSync(logFile, 'a');
      p = spawn('bash', [sh], { cwd: dir, detached: true, stdio: ['ignore', out, out] });
      emit('Einrichtung läuft im Hintergrund. Protokoll: ' + logFile);
    } else emit('Einrichtung läuft in einem Terminalfenster …');
    p.on('error', (e) => addLog('[setup-error] ' + e.message));
    p.unref();
    return { ok: true, dir, log: logFile };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function pickPrompt() {
  const win = ctx.getMainWindow?.() || null;
  const r = await ctx.dialog.showOpenDialog(win, {
    title: 'Referenz-Aufnahme für die deutsche Stimme wählen (5–20 s, WAV)',
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a', 'opus'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  // a reference recording is a Kartoffelbox feature: choose that engine explicitly ('default' now means Thorsten)
  const t = { ...ttsSettings(), germanPrompt: file, germanVoice: 'kartoffelbox:default' };
  ctx.settings.set('tts', t);
  try { ctx.broadcast('settings:changed', ctx.settings.get()); } catch {}
  emit('Referenzstimme gesetzt: ' + path.basename(file));
  return file;
}

// --- registration ----------------------------------------------------------------------------------------------------
function register(context) {
  ctx = context;
  const { ipcMain } = ctx;
  refresh();
  ipcMain.handle('tts:status', () => status());
  ipcMain.handle('tts:german', (e, text, opts) => german(text, opts || {}));
  ipcMain.handle('tts:start', async (e, opts) => { try { return await start(opts || {}); } catch (err) { return { ...status(), error: err.message, code: err.code || 'start-failed' }; } });
  ipcMain.handle('tts:stop', () => stop());
  ipcMain.handle('tts:setup', () => setup());
  ipcMain.handle('tts:pickPrompt', () => pickPrompt());
  ipcMain.handle('tts:clearPrompt', () => { const t = { ...ttsSettings(), germanPrompt: null }; ctx.settings.set('tts', t); try { ctx.broadcast('settings:changed', ctx.settings.get()); } catch {} emit('Referenzstimme entfernt'); return true; });
  ipcMain.handle('tts:log', () => log.slice());
  ipcMain.handle('tts:openFolder', () => { try { require('electron').shell.openPath(state.dir); } catch {} return state.dir; });
  // restart with the other model when the setting changes while the server is running
  try {
    let lastModel = ttsSettings().germanModel || 'turbo';
    ctx.settings.onChange?.(() => {
      const m = ttsSettings().germanModel || 'turbo';
      if (m !== lastModel) {
        lastModel = m;
        if (child) { stop(); startPromise = null; start().catch((e) => emit('Neustart fehlgeschlagen: ' + e.message)); }
      }
    });
  } catch {}
}

function shutdown() {
  stopping = true;
  const proc = child;
  child = null;
  if (proc) {
    try { proc.stdin.end(); } catch {}
    try { proc.kill(); } catch {}
    if (process.platform === 'win32') { try { spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {}); } catch {} }
  }
}

module.exports = { register, shutdown, status, start, stop, german, setup, _internal: { state, log, serverDir, pythonPath } };
