// espeak-ng phonemes for the German voices (Piper and Kokoro "Martin").
//
// Every Piper voice was trained on the phonemes of piper-phonemize 1.1 (rhasspy/espeak-ng), and Piper speaks with
// exactly those: espeak-ng phonemizes clause by clause, the clause punctuation is kept (", " ": " "; " "." "?" "!"),
// language flags such as "(en)" are removed and the result is decomposed into NFD code points (ç → c + U+0327).
// @diffusionstudio/piper-wasm is that very program (piper-phonemize + rhasspy/espeak-ng, emscripten 3.1.47). On
// 1 487 German test sentences its output is identical to piper-phonemize 1.1.0 (docs/TTS.md), so this module runs
// it unchanged:
//
//   const espeak = await loadEspeak(appBaseUrl);          // worker: wasm + data from app/vendor/espeak-ng/
//   const espeak = await createEspeak({ factory, wasm, files });   // Node tests
//   await espeak.phonemize(['Guten Tag.', 'Wie geht es dir? Gut!'])
//   → [['ɡˈuːtən tˈɑːk.'], ['viː ɡˈeːt ɛs dˈiːɾ?', 'ɡˈuːt!']]       one array per text, one string per espeak sentence
//
// Kept on purpose because the voices learned it that way: the German vowel ʊɐ ("wurde") comes out as "??", short ü
// as "y". The data are the German part of espeak-ng-data (de_dict, en_dict for English loanwords, phoneme tables).
//
// The build is a command-line program: every call runs main(), which initialises espeak-ng, reads JSON lines and
// prints JSON. Each run leaks a few hundred kilobytes of its fixed 16 MB heap (45 to 70 runs of short sentences
// end in an emscripten abort), so an instance is replaced after CALLS_PER_INSTANCE runs or INPUT_PER_INSTANCE
// characters; the compiled module and the data files are reused (a new instance takes about 5 ms).
// espeak-ng and piper-phonemize are GPL-3.0 (LIZENZEN.md).

/** The files of espeak-ng-data that German needs (relative to espeak-ng-data/). */
export const ESPEAK_DE_FILES = ['phontab', 'phonindex', 'phondata', 'intonations', 'de_dict', 'en_dict', 'lang/gmw/de'];
export const ESPEAK_VOICE = 'de';
const CALLS_PER_INSTANCE = 8;
const INPUT_PER_INSTANCE = 12000;
const MAX_INPUT_CHARS = 3000;   // per run; the JSON input also travels on the 64 KB emscripten stack

// The symbols of piper-phonemize's default phoneme_id_map, in id order. The program reports the ids of each espeak
// sentence with this map; counting these symbols splits the flat phoneme list back into sentences.
const DEFAULT_SYMBOLS = new Set(Array.from(
  '_^$ !\'(),-.:;?abcdefhijklmnopqrstuvwxyzæçðøħŋœǀǁǂǃɐɑɒɓɔɕɖɗɘəɚɛɜɞɟɠɡɢɣɤɥɦɧɨɪɫɬɭɮɯɰɱɲɳɴɵɶɸɹɺɻɽɾʀʁʂʃʄʈʉʊʋʌʍʎʏʐʑʒʔʕʘʙʛʜʝʟʡʢʲˈˌːˑ˞βθχᵻⱱ0123456789'
  + '\u0327\u0303\u032A\u032F\u0329ʰˤε↓#"↑\u033A\u033BgʦX'));

/**
 * One program output line → the phoneme strings of its espeak sentences.
 * `phoneme_ids` holds [BOS, PAD, (id, PAD)*, EOS] per sentence: the number of pairs is the number of phonemes of
 * that sentence that the default map knows.
 */
export function splitEspeakOutput(obj) {
  const phonemes = Array.isArray(obj?.phonemes) ? obj.phonemes : [];
  const ids = Array.isArray(obj?.phoneme_ids) ? obj.phoneme_ids : [];
  const counts = [];
  let i = 0, ok = true;
  while (i < ids.length) {
    if (ids[i] !== 1 || ids[i + 1] !== 0) { ok = false; break; }
    i += 2;
    let n = 0;
    while (i < ids.length && ids[i] !== 2) { n++; i += 2; }
    if (i >= ids.length) { ok = false; break; }
    counts.push(n);
    i++;
  }
  const known = phonemes.filter((p) => DEFAULT_SYMBOLS.has(p)).length;
  const sizes = counts.filter((n) => n > 0);
  if (!ok || sizes.reduce((a, b) => a + b, 0) !== known) return phonemes.length ? [phonemes.join('')] : [];
  const out = [];
  let cur = [], n = 0, s = 0;
  for (const p of phonemes) {
    cur.push(p);
    if (DEFAULT_SYMBOLS.has(p) && ++n === sizes[s]) { out.push(cur.join('')); cur = []; n = 0; s++; }
  }
  // symbols the default map does not know (dropped by every voice anyway) stay with the last sentence
  if (cur.length) { if (out.length) out[out.length - 1] += cur.join(''); else out.push(cur.join('')); }
  return out;
}

/**
 * @param {{ factory: (opts: object) => Promise<object>, wasm: WebAssembly.Module|ArrayBuffer|Uint8Array,
 *           files: Record<string, Uint8Array>, voice?: string }} opts
 *   factory = createPiperPhonemize of the emscripten build, files = { 'phontab': bytes, 'lang/gmw/de': bytes, … }
 */
export async function createEspeak({ factory, wasm, files, voice = ESPEAK_VOICE }) {
  if (typeof factory !== 'function') throw new Error('espeak-ng: keine WebAssembly-Fabrik');
  const missing = ESPEAK_DE_FILES.filter((f) => !files?.[f]?.length);
  if (missing.length) throw new Error('espeak-ng: Daten fehlen (' + missing.join(', ') + ')');
  const module = wasm instanceof WebAssembly.Module ? wasm : await WebAssembly.compile(wasm);
  let inst = null, calls = 0, chars = 0;

  async function instantiate() {
    const lines = [];
    const M = await factory({
      print: (s) => lines.push(s),
      printErr: () => {},
      // the loader would fetch the data package of all languages (18 MB): it gets an empty one, the German files
      // are written below
      getPreloadedPackage: () => new ArrayBuffer(0),
      locateFile: (f) => f,
      instantiateWasm(imports, done) {
        WebAssembly.instantiate(module, imports).then((instance) => done(instance, module));
        return {};
      },
    });
    const FS = M.FS;
    // the empty placeholders of the full package go, so that espeak-ng only ever sees German
    const clear = (dir) => {
      for (const name of FS.readdir(dir)) {
        if (name === '.' || name === '..') continue;
        const p = dir + '/' + name;
        if (FS.isDir(FS.stat(p).mode)) { clear(p); FS.rmdir(p); } else FS.unlink(p);
      }
    };
    try { clear('/espeak-ng-data'); } catch { FS.mkdirTree('/espeak-ng-data'); }
    for (const [rel, bytes] of Object.entries(files)) {
      const p = '/espeak-ng-data/' + rel;
      FS.mkdirTree(p.slice(0, p.lastIndexOf('/')));
      FS.writeFile(p, bytes);
    }
    return { M, lines };
  }

  async function run(batch) {
    const size = batch.reduce((n, t) => n + t.length, 0);
    if (!inst || calls >= CALLS_PER_INSTANCE || chars + size > INPUT_PER_INSTANCE) { inst = await instantiate(); calls = 0; chars = 0; }
    calls++; chars += size;
    const { M, lines } = inst;
    lines.length = 0;
    const input = JSON.stringify(batch.map((text) => ({ text })));
    try { M.callMain(['-l', voice, '--input', input, '--espeak_data', '/espeak-ng-data', '--allow_missing_phonemes']); }
    catch (e) { inst = null; throw new Error('espeak-ng: ' + (e?.message || e)); }   // an abort poisons the instance
    if (lines.length !== batch.length) { inst = null; throw new Error('espeak-ng: unerwartete Ausgabe'); }
    return lines.map((line) => splitEspeakOutput(JSON.parse(line)));
  }

  /**
   * @param {string[]} texts
   * @returns {Promise<string[][]>}  per text the phoneme strings of its espeak sentences (NFD, like Piper)
   */
  async function phonemize(texts) {
    // whitespace runs (line breaks are paragraph ends for espeak-ng) become single spaces
    const list = (Array.isArray(texts) ? texts : [texts]).map((t) => String(t ?? '').replace(/\s+/g, ' ').trim());
    const out = new Array(list.length);
    const todo = [];
    list.forEach((t, k) => { if (t) todo.push(k); else out[k] = []; });
    for (let k = 0; k < todo.length;) {
      const batch = [];
      let size = 0;
      while (k < todo.length && (!batch.length || size + list[todo[k]].length < MAX_INPUT_CHARS)) { batch.push(todo[k]); size += list[todo[k]].length; k++; }
      const input = batch.map((j) => list[j].slice(0, MAX_INPUT_CHARS));
      let res;
      try { res = await run(input); } catch { res = await run(input); }   // once more on a fresh instance
      batch.forEach((j, n) => { out[j] = res[n]; });
    }
    return out;
  }

  return { phonemize, voice, get calls() { return calls; } };
}

/**
 * Loads the vendored build (app/vendor/espeak-ng/, see build/espeak-vendor.js) and creates the phonemizer.
 * @param {string} appBaseUrl  URL of app/ (…/app/)
 */
export async function loadEspeak(appBaseUrl) {
  const base = new URL('vendor/espeak-ng/', appBaseUrl).href;
  const get = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`espeak-ng: HTTP ${r.status} für ${url}`); return r; };
  const [glue, wasm, list] = await Promise.all([
    import(/* @vite-ignore */ base + 'piper_phonemize.mjs'),
    get(base + 'piper_phonemize.wasm').then((r) => r.arrayBuffer()).then((b) => WebAssembly.compile(b)),
    get(base + 'espeak-ng-data/files.json').then((r) => r.json()),
  ]);
  const files = {};
  await Promise.all(list.map(async (f) => { files[f.path] = new Uint8Array(await (await get(base + 'espeak-ng-data/' + f.path)).arrayBuffer()); }));
  return createEspeak({ factory: glue.default, wasm, files });
}

export default { createEspeak, loadEspeak, splitEspeakOutput, ESPEAK_DE_FILES, ESPEAK_VOICE };
