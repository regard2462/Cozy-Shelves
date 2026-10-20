// Stockfish worker (classic worker, bundled to app/dist/chess-worker.js).
// Loads vendor/stockfish/stockfish-18-lite-single.js and pipes UCI strings in both directions:
//   main → worker: 'uci' | 'isready' | 'position …' | 'go …' | 'stop' | …   (plain strings)
//   worker → main: engine output lines (plain strings) or { type: 'error', error } / { type: 'loaded' }
//
// stockfish.js finds its .wasm through the first part of the worker URL hash (`#<wasm url>`), which
// engine.js sets when creating the worker. As a fallback we redirect its default guess
// (<worker>.wasm) to the vendor folder, and we make WebAssembly.instantiateStreaming tolerant of
// servers that do not send `application/wasm`.
/* global importScripts */
const VENDOR = new URL('../vendor/stockfish/', self.location.href).href;
const SF_JS = VENDOR + 'stockfish-18-lite-single.js';
const SF_WASM = VENDOR + 'stockfish-18-lite-single.wasm';

// fallback for a missing hash: the engine would fetch "<worker-name>.wasm" next to this script
const originalFetch = self.fetch.bind(self);
self.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (/chess-worker\.wasm$/i.test(url.split(/[?#]/)[0])) return originalFetch(SF_WASM, init);
  return originalFetch(input, init);
};

if (typeof WebAssembly !== 'undefined' && WebAssembly.instantiateStreaming) {
  const streaming = WebAssembly.instantiateStreaming.bind(WebAssembly);
  WebAssembly.instantiateStreaming = async function (source, imports) {
    const response = await source;
    let clone = null;
    try { clone = response.clone(); } catch (e) { clone = null; }
    try {
      return await streaming(response, imports);
    } catch (e) {
      if (!clone) throw e;
      const buffer = await clone.arrayBuffer();
      return WebAssembly.instantiate(buffer, imports);
    }
  };
}

try {
  importScripts(SF_JS);
  // stockfish.js installed its own onmessage; wrap it so the main thread can ping us
  const engineOnMessage = self.onmessage;
  self.onmessage = (e) => {
    const d = e.data;
    if (d && typeof d === 'object') {
      if (d.type === 'ping') self.postMessage({ type: 'pong' });
      return;
    }
    if (typeof d === 'string' && engineOnMessage) engineOnMessage(e);
  };
  self.postMessage({ type: 'loaded' });
} catch (e) {
  self.postMessage({ type: 'error', error: String(e && e.message || e) });
}
