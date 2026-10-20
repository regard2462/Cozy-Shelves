// Copies third-party runtime assets that the renderer loads directly (not bundled)
// into app/vendor. Run via `npm run vendor`.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const nm = path.join(root, 'node_modules');
const out = path.join(root, 'app', 'vendor');

function copy(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true, force: true });
}

// Fonts (@fontsource): copy css + files for the weights we use
const fonts = {
  'eb-garamond': ['400', '400-italic', '500', '600', '700'],
  'cormorant-garamond': ['400', '400-italic', '500', '600', '700'],
  'caveat': ['400', '500', '600', '700'],
  'vt323': ['400'],
  'playfair-display': ['400', '400-italic', '700', '900'],
};
const fontCss = [];
for (const [name, weights] of Object.entries(fonts)) {
  const src = path.join(nm, '@fontsource', name);
  const dst = path.join(out, 'fonts', name);
  copy(path.join(src, 'files'), path.join(dst, 'files'));
  for (const w of weights) {
    const f = path.join(src, `${w}.css`);
    if (fs.existsSync(f)) {
      copy(f, path.join(dst, `${w}.css`));
      fontCss.push(`@import url("./${name}/${w}.css");`);
    }
  }
}
fs.writeFileSync(path.join(out, 'fonts', 'fonts.css'), fontCss.join('\n') + '\n');

// chessground assets (CSS + piece SVGs)
copy(path.join(nm, 'chessground', 'assets'), path.join(out, 'chessground'));
// Leaflet's stylesheet (the world map, ui/worldmap/osm-view.js; the script is bundled)
copy(path.join(nm, 'leaflet', 'dist', 'leaflet.css'), path.join(out, 'leaflet', 'leaflet.css'));

// stockfish lite single-threaded engine
fs.mkdirSync(path.join(out, 'stockfish'), { recursive: true });
for (const f of ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm']) {
  copy(path.join(nm, 'stockfish', 'bin', f), path.join(out, 'stockfish', f));
}

// kokoro-js web bundle (Transformers.js + phonemizer included) for the TTS worker
copy(path.join(nm, 'kokoro-js', 'dist', 'kokoro.web.js'), path.join(out, 'kokoro', 'kokoro.web.js'));

// onnxruntime-web wasm binaries (transformers.js loads them relative to its wasm path)
const ortDist = path.join(nm, 'onnxruntime-web', 'dist');
if (fs.existsSync(ortDist)) {
  fs.mkdirSync(path.join(out, 'ort'), { recursive: true });
  for (const f of fs.readdirSync(ortDist)) {
    if (f.startsWith('ort-wasm') && (f.endsWith('.wasm') || f.endsWith('.mjs'))) copy(path.join(ortDist, f), path.join(out, 'ort', f));
  }
}

// onnxruntime-web 1.30 (installed as onnxruntime-web-webgpu) for the heavy German voices on WebGPU: its new WebGPU
// execution provider (the asyncify build) runs Thorsten (hoch) and Martin correctly, the JSEP provider of 1.22 does
// not (app/src/workers/ort-runtime.js). The English worker keeps the 1.22 files in app/vendor/ort/.
const ortGpuDist = path.join(nm, 'onnxruntime-web-webgpu', 'dist');
if (fs.existsSync(ortGpuDist)) {
  fs.mkdirSync(path.join(out, 'ort-webgpu'), { recursive: true });
  for (const f of ['ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.asyncify.mjs']) copy(path.join(ortGpuDist, f), path.join(out, 'ort-webgpu', f));
} else console.warn('WARNING: node_modules/onnxruntime-web-webgpu is missing - the German voices cannot use WebGPU.');

// espeak-ng (piper-phonemize as WebAssembly) for the German phonemes of the Piper and Kokoro voices: the loader,
// the wasm and the German part of espeak-ng-data (build/espeak-vendor.js)
const espeak = require('./espeak-vendor').vendorEspeak(nm, path.join(out, 'espeak-ng'));
if (espeak) console.log(`espeak-ng: ${espeak.files.length} data files, ${Math.round(espeak.files.reduce((n, f) => n + f.bytes, 0) / 1024)} KB`);
else console.warn('WARNING: node_modules/@diffusionstudio/piper-wasm is missing - German read-aloud falls back to the rule-based phonemes.');

// Kokoro voice style vectors: app/src/workers/tts-worker.js serves them from app/vendor/kokoro/voices/
// and only falls back to huggingface.co when a file is missing (the documented offline mirror, which was
// dead before because nothing ever copied the .bin files). Only the voices the UI offers are copied
// (28 of 54 files, ~14 MB instead of 28 MB).
const kokoroVoices = ['af_heart', 'af_bella', 'af_nicole', 'af_aoede', 'af_kore', 'af_sarah', 'af_nova', 'af_sky',
  'af_alloy', 'af_jessica', 'af_river', 'am_michael', 'am_fenrir', 'am_puck', 'am_adam', 'am_echo', 'am_eric',
  'am_liam', 'am_onyx', 'am_santa', 'bf_emma', 'bf_isabella', 'bf_alice', 'bf_lily', 'bm_george', 'bm_fable',
  'bm_lewis', 'bm_daniel'];
const voiceSrc = path.join(nm, 'kokoro-js', 'voices');
if (fs.existsSync(voiceSrc)) {
  fs.mkdirSync(path.join(out, 'kokoro', 'voices'), { recursive: true });
  let copied = 0;
  for (const id of kokoroVoices) {
    const f = path.join(voiceSrc, id + '.bin');
    if (fs.existsSync(f)) { copy(f, path.join(out, 'kokoro', 'voices', id + '.bin')); copied++; }
  }
  console.log(`kokoro voices: ${copied}/${kokoroVoices.length} copied`);
} else console.warn('WARNING: node_modules/kokoro-js/voices is missing - Kokoro always loads voices from huggingface.co.');

// foliate-js (EPUB/MOBI/AZW3/FB2/CBZ + pdf.js) is not on npm - it ships in vendor-src/
const foliateSrc = path.join(root, 'vendor-src', 'foliate-js');
if (fs.existsSync(foliateSrc)) copy(foliateSrc, path.join(out, 'foliate-js'));
else console.warn('WARNING: vendor-src/foliate-js is missing - EPUB/PDF reading will not work.');

console.log('vendor assets copied to', out);
