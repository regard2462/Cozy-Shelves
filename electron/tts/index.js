// German TTS bridges.
//   piper.js    – DEFAULT: Piper/VITS voices (Thorsten & Co.) as ONNX files, no Python (see docs/TTS.md)
//   sidecar.js  – LEGACY/optional: Kartoffelbox (Chatterbox) through a Python sidecar; only reachable when
//                 the user explicitly installed tts-server/ and picked that voice. Never started on its own.
// Both register their own IPC channels (see electron/preload.js api.tts.* and api.invoke('tts:piper*')).
let piper = null;
let sidecar = null;

function register(ctx) {
  try { piper = require('./piper'); piper.register(ctx); }
  catch (e) {
    console.error('[tts] piper module failed:', e.message);
    try { ctx.ipcMain.handle('tts:piperVoices', () => ({ voices: [], dir: null, error: e.message })); } catch {}
    try { ctx.ipcMain.handle('tts:piperEnsure', () => ({ error: e.message, code: 'download-failed' })); } catch {}
  }
  try { sidecar = require('./sidecar'); sidecar.register(ctx); }
  catch (e) {
    console.error('[tts] sidecar module not available:', e.message);
    try { ctx.ipcMain.handle('tts:status', () => ({ available: false, running: false, reason: 'not-implemented' })); } catch {}
  }
}

function shutdown() { try { piper?.shutdown?.(); } catch {} try { sidecar?.shutdown?.(); } catch {} }

module.exports = { register, shutdown, piper: () => piper, sidecar: () => sidecar };
