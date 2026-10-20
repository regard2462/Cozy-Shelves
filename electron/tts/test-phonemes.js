// Tests for the German phonemes and the audio clean-up of read-aloud. Run by electron/tts/test-tts.js (npm test).
//   espeak-ng (piper-phonemize as WebAssembly) against piper-phonemize 1.1.0, the Kokoro conversion against misaki,
//   the vendored files, the text normalisation, the rule fallback and tts-audio.js.
// Uses app/vendor/espeak-ng when `npm run build` made it, else extracts the same files into a temporary folder.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');
const NM = path.join(ROOT, 'node_modules');
const importApp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

/** espeak-ng data: the vendored folder, or a fresh extraction from node_modules */
function espeakDir() {
  const vendored = path.join(ROOT, 'app', 'vendor', 'espeak-ng');
  if (fs.existsSync(path.join(vendored, 'espeak-ng-data', 'files.json'))) return { dir: vendored, temp: null };
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesesaal-espeak-'));
  const res = require('../../build/espeak-vendor').vendorEspeak(NM, path.join(temp, 'espeak-ng'));
  if (!res) return { dir: null, temp };
  return { dir: res.dir, temp };
}

// word-level comparison: punctuation and spaces out, ʏ out (Kokoro's vocabulary has none, misaki writes it)
const stripKokoro = (s) => Array.from(String(s)).filter((c) => !/[\s;:,.!?—…"()“”«»\-'‘’‚„]/.test(c) && c !== 'ʏ').join('');
function levenshtein(a, b) {
  const d = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) d[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
}

async function run(test) {
  const es = await importApp('app/src/workers/espeak-ng.js');
  const de = await importApp('app/src/workers/piper-de.js');
  const audio = await importApp('app/src/ui/reader/tts-audio.js');
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'de-phonemes.json'), 'utf8')).sentences;
  const { dir, temp } = espeakDir();
  let espeak = null;
  try {
    console.log('espeak-ng (piper-phonemize wasm)');
    await test('the German espeak-ng files are listed the same in the vendor script and in the worker', () => {
      assert.deepStrictEqual(require('../../build/espeak-vendor').ESPEAK_DE_FILES, es.ESPEAK_DE_FILES);
    });
    await test('vendored layout: loader as module, wasm, 7 data files with their sizes', () => {
      assert(dir, 'node_modules/@diffusionstudio/piper-wasm is missing');
      assert(/export default createPiperPhonemize;\s*$/.test(fs.readFileSync(path.join(dir, 'piper_phonemize.mjs'), 'utf8')));
      assert(fs.statSync(path.join(dir, 'piper_phonemize.wasm')).size > 500000);
      const list = JSON.parse(fs.readFileSync(path.join(dir, 'espeak-ng-data', 'files.json'), 'utf8'));
      assert.deepStrictEqual(list.map((f) => f.path), es.ESPEAK_DE_FILES);
      for (const f of list) assert.strictEqual(fs.statSync(path.join(dir, 'espeak-ng-data', ...f.path.split('/'))).size, f.bytes, f.path);
      assert(list.reduce((n, f) => n + f.bytes, 0) < 1.2e6, 'only the German part of espeak-ng-data');
    });
    if (fs.existsSync(path.join(ROOT, 'app', 'vendor'))) {
      await test('vendored onnxruntime-web 1.30 for WebGPU next to the 1.22 build of the English worker', () => {
        for (const f of ['ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.asyncify.mjs']) assert(fs.existsSync(path.join(ROOT, 'app', 'vendor', 'ort-webgpu', f)), f);
        assert(fs.existsSync(path.join(ROOT, 'app', 'vendor', 'ort', 'ort-wasm-simd-threaded.jsep.wasm')));
      });
    }
    const files = {};
    for (const f of es.ESPEAK_DE_FILES) files[f] = fs.readFileSync(path.join(dir, 'espeak-ng-data', ...f.split('/')));
    espeak = await es.createEspeak({
      factory: require(path.join(NM, '@diffusionstudio', 'piper-wasm', 'build', 'piper_phonemize.js')),
      wasm: fs.readFileSync(path.join(dir, 'piper_phonemize.wasm')),
      files,
    });
    const got = await espeak.phonemize(fixture.map((x) => x.text));
    await test(`${fixture.length} sentences: identical to piper-phonemize 1.1.0, sentence by sentence`, () => {
      const bad = fixture.filter((x, i) => JSON.stringify(got[i]) !== JSON.stringify(x.piper));
      assert.strictEqual(bad.length, 0, bad.slice(0, 3).map((x) => x.text).join(' | '));
    });
    await test('typical German symbols: NFD ç, r and ɾ, ɑː, no ʁ and no glottal stop', () => {
      const all = got.flat().join(' ');
      assert(all.includes('ç') && !all.includes('ç'), 'ç is decomposed like Piper does it');
      for (const sym of ['ɾ', 'ɑː', 'ɜ']) assert(all.includes(sym), sym);
      for (const sym of ['ʁ', 'ʔ']) assert(!all.includes(sym), sym);
    });
    await test('several espeak-ng sentences in one text come back separately, "??" (wurde) stays inside its word', async () => {
      const [r] = await espeak.phonemize(['Er wurde gefragt. Wie geht es dir? Gut!']);
      assert.strictEqual(r.length, 3, JSON.stringify(r));
      assert(r[0].includes('??'), r[0]);
      assert(r[1].endsWith('?') && r[2].endsWith('!'));
    });
    await test('empty and whitespace-only texts give no sentences', async () => {
      assert.deepStrictEqual(await espeak.phonemize(['', '   ', '\n']), [[], [], []]);
    });
    await test('300 calls in a row (the instance is renewed before emscripten runs out of memory)', async () => {
      for (let i = 0; i < 300; i++) { const [r] = await espeak.phonemize([`Das ist Satz Nummer ${i}, und er ist nicht sehr lang.`]); assert(r.length === 1, String(i)); }
    });
    await test('a long text (10 000 characters) in one call', async () => {
      const long = fixture.map((x) => x.text).join(' ').slice(0, 10000);
      const [r] = await espeak.phonemize([long]);
      assert(r.length > 20);
    });

    console.log('Kokoro "Martin": espeak-ng → misaki conventions');
    // sentences with figures are left out: the app writes numbers out before espeak-ng sees them, misaki did not
    await test('word by word like misaki 0.9.4 for at least 97 % of the sentences, under 0.5 % of the phonemes differ', () => {
      let exact = 0, edits = 0, total = 0, n = 0;
      fixture.forEach((x, i) => {
        if (/\d/.test(x.text)) return;
        n++;
        const want = stripKokoro(x.misaki), have = stripKokoro(de.espeakToKokoro(got[i], x.text).phonemes);
        if (want === have) exact++;
        edits += levenshtein(Array.from(have), Array.from(want)); total += Array.from(want).length;
      });
      assert(exact / n >= 0.97, `${exact}/${n} exact`);
      assert(edits / total < 0.005, `${(100 * edits / total).toFixed(2)} % edits`);
    });
    await test('folded symbols: diphthongs, ʦ from z/tz, t+s from the letters t and s, ʧ only for word-initial tsch', async () => {
      const k = async (t) => de.espeakToKokoro((await espeak.phonemize([t]))[0], t).phonemes;
      assert((await k('Zeit')).includes('ʦ'));
      assert((await k('Katze')).includes('ʦ'));
      assert(!(await k('nichts')).includes('ʦ'));
      assert((await k('Tschüss')).includes('ʧ'));
      assert(!(await k('Deutschland')).includes('ʧ'));
      assert(/I/.test(await k('Eis')) && /W/.test(await k('Haus')));
      const wurde = await k('wurde');
      assert(wurde.includes('ʊɐ') && !wurde.includes('?'), wurde);
      const all = await k(fixture.map((x) => x.text).join(' ').slice(0, 3000));
      assert([...all].every((c) => Object.prototype.hasOwnProperty.call(de.KOKORO_VOCAB, c)), 'only symbols of the Kokoro vocabulary');
    });
  } finally {
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
  }

  console.log('text normalisation');
  const N = de.normalizeGermanText;
  for (const [input, want] of [
    ['Am 3. Oktober 1990 wurde Deutschland wiedervereinigt.', 'Am dritten Oktober neunzehnhundertneunzig wurde Deutschland wiedervereinigt.'],
    ['Im 19. Jahrhundert wuchsen die Städte.', 'Im neunzehnten Jahrhundert wuchsen die Städte.'],
    ['Das war auf Seite 3. Danach kam nichts.', 'Das war auf Seite drei. Danach kam nichts.'],
    ['Das Buch kostet 24,95 € und 5,– € Porto.', 'Das Buch kostet vierundzwanzig Euro fünfundneunzig und fünf Euro Porto.'],
    ['Er war 1,85 m groß und wog 80 kg.', 'Er war eins Komma acht fünf Meter groß und wog achtzig Kilogramm.'],
    ['Der Zug fährt um 14:30 Uhr, das Spiel endete 2:1.', 'Der Zug fährt um vierzehn Uhr dreißig, das Spiel endete zwei zu eins.'],
    ['Treffpunkt 8.30 Uhr an der 3. Stelle.', 'Treffpunkt acht Uhr dreißig an der dritten Stelle.'],
    ['Gemälde aus dem 17. und 18. Jahrhundert, vom 5. bis 7. Mai.', 'Gemälde aus dem siebzehnten und achtzehnten Jahrhundert, vom fünften bis siebten Mai.'],
    ['Vgl. z. B. S. 12 ff. und Kap. IV.', 'vergleiche zum Beispiel Seite zwölf folgende und Kapitel vier.'],
    ['Ludwig XIV. regierte im XVII. Jahrhundert.', 'Ludwig der Vierzehnte regierte im siebzehnten Jahrhundert.'],
    ['Er lief 1 h, 3 km/h und trank 1/2 Liter.', 'Er lief eine Stunde, drei Kilometer pro Stunde und trank einhalb Liter.'],
    ['Abschnitt 3.2 nennt 1.250.000 Einwohner.', 'Abschnitt drei Punkt zwei nennt eine Million zweihundertfünfzigtausend Einwohner.'],
    ['Ein Sof­a mit „Kissen“ – und mehr…', 'Ein Sofa mit Kissen, und mehr.'],
  ]) {
    await test(`normalizeGermanText ${JSON.stringify(input)}`, () => assert.strictEqual(N(input), want));
  }

  const lang = await importApp('app/src/ui/reader/tts-lang.js');
  for (const [input, want] of [
    ['Die Wör- ter wurden getrennt, Ein- und Ausgang bleiben.', 'Die Wörter wurden getrennt, Ein- und Ausgang bleiben.'],
    ['Mehr unter https://www.zeit.de/politik/artikel. Danach www.spiegel.de/x, fertig.', 'Mehr unter zeit.de. Danach spiegel.de, fertig.'],
  ]) {
    await test(`normalizeForSpeech ${JSON.stringify(input)}`, () => assert.strictEqual(lang.normalizeForSpeech(input), want));
  }
  await test('letters and digits in one word: B12, A320', () => assert.strictEqual(N('Vitamin B12 im Airbus A320.'), 'Vitamin B zwölf im Airbus A dreihundertzwanzig.'));

  console.log('phoneme ids and the rule fallback');
  await test('Piper ids: BOS, PAD, (id, PAD)…, EOS; unknown symbols dropped', () => {
    const map = { '^': [1], $: [2], _: [0], a: [14], b: [15], ' ': [3], c: [16], '̧': [140] };
    const { ids, dropped } = de.phonemesToIds('ab çx', map);
    assert.deepStrictEqual(ids, [1, 0, 14, 0, 15, 0, 3, 0, 16, 0, 140, 0, 2]);
    assert.deepStrictEqual(dropped, ['x']);
  });
  await test('rule fallback in espeak-ng style: no ʁ, no ʔ, NFD ç, ɑː', () => {
    const ph = de.germanPhonemesEspeakStyle('Ich habe am Abend das Wasser getrunken.');
    for (const sym of ['ʁ', 'ʔ', 'ç', 'aː']) assert(!ph.includes(sym), sym + ' in ' + ph);
    assert(ph.includes('ç') && ph.includes('ɑː'), ph);
  });

  console.log('audio clean-up (tts-audio.js)');
  const tone = (sec, rate, amp) => Float32Array.from({ length: Math.round(sec * rate) }, (_, i) => amp * Math.sin(2 * Math.PI * 220 * i / rate));
  const join = (...parts) => { const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
  await test('cleanPiece trims the silence around the speech, keeps a little and fades the edges', () => {
    const rate = 22050;
    const x = join(new Float32Array(rate * 0.4), tone(1, rate, 0.3), new Float32Array(rate * 0.5));
    const c = audio.cleanPiece(x, rate);
    assert(Math.abs(c.lead - 0.37) < 0.02, 'lead ' + c.lead);
    assert(Math.abs(c.tail - 0.43) < 0.02, 'tail ' + c.tail);
    assert(Math.abs(c.samples.length / rate - 1.1) < 0.03, 'length ' + c.samples.length / rate);
    assert.strictEqual(c.samples[0], 0);
    assert(Math.abs(c.samples[c.samples.length - 1]) < 1e-3);
    assert(Math.abs(c.level - 0.3 / Math.SQRT2) < 0.01, 'level ' + c.level);
  });
  await test('cleanPiece of pure silence is empty', () => assert.strictEqual(audio.cleanPiece(new Float32Array(16000), 16000).samples.length, 0));
  await test('nextGain levels towards the target, smoothly, within 0.4…4 and below clipping', () => {
    assert(Math.abs(audio.nextGain(null, 0.075, 0.3) - 1) < 1e-9);
    assert.strictEqual(audio.nextGain(null, 0.001, 0.01), 4);
    assert.strictEqual(audio.nextGain(null, 0.9, 0.99), 0.4);
    const g = audio.nextGain(1, 0.0375, 0.2);
    assert(g > 1 && g < 2, 'smoothed ' + g);
    assert(audio.nextGain(null, 0.02, 0.6) * 0.6 <= audio.MAX_PEAK + 1e-9, 'no clipping');
  });
  await test('analyseReading measures the pauses between sentences and silences inside them', () => {
    const rate = 16000;
    const x = join(tone(1, rate, 0.3), new Float32Array(rate * 0.32), tone(0.5, rate, 0.3), new Float32Array(rate * 0.3), tone(0.5, rate, 0.3));
    const r = audio.analyseReading(x, rate, [{ start: 0, end: 1 }, { start: 1.32, end: 2.62 }]);
    assert.deepStrictEqual(r.gaps, [0.32]);
    assert(Math.abs(r.longestInside - 0.3) < 0.02, String(r.longestInside));
    assert.strictEqual(r.clipped, 0);
  });
}

module.exports = { run };
