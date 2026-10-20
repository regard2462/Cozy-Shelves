// espeak-ng for the German voices: copies the WebAssembly build of piper-phonemize (@diffusionstudio/piper-wasm,
// piper-phonemize + rhasspy/espeak-ng) into app/vendor/espeak-ng/:
//   piper_phonemize.mjs     the emscripten loader as an ES module (the TTS workers are module workers)
//   piper_phonemize.wasm
//   espeak-ng-data/…        the German part of the data package (0.9 of 18 MB), listed in files.json
//   README.txt              what it is, licence, sources
// build/vendor.js calls it; the Node tests (electron/tts/test-phonemes.js) extract into a temporary folder when
// app/vendor has not been built yet.
const fs = require('fs');
const path = require('path');

// the same list as ESPEAK_DE_FILES in app/src/workers/espeak-ng.js (the test compares them)
const ESPEAK_DE_FILES = ['phontab', 'phonindex', 'phondata', 'intonations', 'de_dict', 'en_dict', 'lang/gmw/de'];

const packageDir = (nodeModules) => path.join(nodeModules, '@diffusionstudio', 'piper-wasm', 'build');

/**
 * @returns {{ dir: string, files: { path: string, bytes: number }[] } | null}  null when the package is missing
 */
function vendorEspeak(nodeModules, outDir) {
  const src = packageDir(nodeModules);
  const gluePath = path.join(src, 'piper_phonemize.js');
  if (!fs.existsSync(gluePath)) return null;
  const glue = fs.readFileSync(gluePath, 'utf8');
  // the file packager put the table of contents of piper_phonemize.data into the loader
  const m = /loadPackage\((\{"files":.*?"remote_package_size":\s*\d+\})\)/s.exec(glue);
  if (!m) throw new Error('piper_phonemize.js: Inhaltsverzeichnis des Datenpakets nicht gefunden');
  const meta = JSON.parse(m[1]);
  const blob = fs.readFileSync(path.join(src, 'piper_phonemize.data'));
  if (blob.length !== meta.remote_package_size) throw new Error('piper_phonemize.data hat eine unerwartete Größe');

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'espeak-ng-data'), { recursive: true });
  // a classic script that assigns `var createPiperPhonemize`: as a module it only needs an export
  fs.writeFileSync(path.join(outDir, 'piper_phonemize.mjs'), glue + '\nexport default createPiperPhonemize;\n');
  fs.copyFileSync(path.join(src, 'piper_phonemize.wasm'), path.join(outDir, 'piper_phonemize.wasm'));
  const files = [];
  for (const rel of ESPEAK_DE_FILES) {
    const f = meta.files.find((x) => x.filename === '/espeak-ng-data/' + rel);
    if (!f) throw new Error('espeak-ng-data/' + rel + ' fehlt im Datenpaket');
    const dst = path.join(outDir, 'espeak-ng-data', ...rel.split('/'));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, blob.subarray(f.start, f.end));
    files.push({ path: rel, bytes: f.end - f.start });
  }
  fs.writeFileSync(path.join(outDir, 'espeak-ng-data', 'files.json'), JSON.stringify(files));
  let version = '';
  try { version = require(path.join(src, '..', 'package.json')).version; } catch {}
  fs.writeFileSync(path.join(outDir, 'README.txt'), [
    'espeak-ng für die deutschen Vorlesestimmen (Piper und Kokoro "Martin").',
    '',
    `piper_phonemize.mjs/.wasm: @diffusionstudio/piper-wasm ${version} (npm), WebAssembly-Build von`,
    'piper-phonemize (https://github.com/rhasspy/piper-phonemize, MIT) mit espeak-ng',
    '(https://github.com/rhasspy/espeak-ng, GPL-3.0-or-later). Quellen und Bauanleitung:',
    'https://github.com/diffusion-studio/piper-wasm',
    'espeak-ng-data/: der deutsche Teil der espeak-ng-Daten aus demselben Paket (GPL-3.0-or-later).',
    'Der Text der GPL-3.0 liegt z. B. unter https://www.gnu.org/licenses/gpl-3.0.html.',
    '',
  ].join('\n'));
  return { dir: outDir, files };
}

module.exports = { vendorEspeak, packageDir, ESPEAK_DE_FILES };
