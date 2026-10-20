// The onnxruntime-web builds of the two German workers (Piper and Kokoro "Martin").
//
//   wasm    onnxruntime-web 1.22 – the build the English worker uses as well; wasm from app/vendor/ort/. It starts
//           in about two seconds and is the fastest on the CPU: the right choice for the light Piper voices
//           (real-time factor 0.15 to 0.25, docs/TTS.md).
//   webgpu  onnxruntime-web 1.30 with the new WebGPU execution provider (installed as onnxruntime-web-webgpu);
//           wasm from app/vendor/ort-webgpu/. The JSEP WebGPU provider of 1.22 fails on every Piper graph (GatherND
//           on int64) and computes wrong durations for "Martin" (the speech comes out a quarter shorter and cannot
//           be understood); 1.30 gets both right and runs Thorsten (hoch) and Martin about 15 times faster than the
//           CPU. Its wasm (27 MB) needs a few seconds more to start, so only the heavy voices use it.
// Each build has its own `env`; tensors must come from the module that runs the session (entry.ort).

const cache = new Map();

/** @param {'wasm'|'webgpu'} kind  @param {string} appBaseUrl  URL of app/ */
export function loadOrt(kind, appBaseUrl) {
  const key = kind === 'webgpu' ? 'webgpu' : 'wasm';
  if (!cache.has(key)) {
    const p = (key === 'webgpu' ? import('onnxruntime-web-webgpu/webgpu') : import('onnxruntime-web')).then((ort) => {
      try {
        ort.env.wasm.wasmPaths = new URL(key === 'webgpu' ? 'vendor/ort-webgpu/' : 'vendor/ort/', appBaseUrl).href;
        // no SharedArrayBuffer without cross-origin isolation (app://): single-threaded wasm
        if (typeof SharedArrayBuffer === 'undefined' || !self.crossOriginIsolated) ort.env.wasm.numThreads = 1;
        ort.env.logLevel = 'error';
      } catch (e) { console.warn('[tts] onnxruntime env configuration failed', e); }
      return ort;
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return cache.get(key);
}

let adapterPromise = null;
/** true when this worker can get a WebGPU adapter (asked once). */
export function hasWebGPU() {
  if (!adapterPromise) {
    adapterPromise = (async () => {
      try { return !!(typeof navigator !== 'undefined' && navigator.gpu && await navigator.gpu.requestAdapter()); }
      catch { return false; }
    })();
  }
  return adapterPromise;
}
