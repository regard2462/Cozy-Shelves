// Tests for the German read-aloud voice. Run:  node electron/tts/test-tts.js
// A fresh start and the settings of older builds (Kartoffelbox: 'default', 'builtin', 'kartoffelbox:…' or the path
// of a reference recording) must both lead to a German voice that exists: the default Martin (de_DE-martin-kokoro).
// A voice chosen explicitly (for example de_DE-karlsson-low) stays.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { DEFAULTS, migrateSettings } = require('../settings');
const { Store } = require('../store');
const piper = require('./piper');

const DEFAULT = 'de_DE-martin-kokoro';
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) { failed++; console.log('  FAIL', name, '\n', e); }
}
const fresh = () => structuredClone(DEFAULTS);

(async () => {
  const ids = await import(pathToFileURL(path.join(__dirname, '../../app/src/ui/reader/tts-voice-id.js')).href);

  console.log('default voice');
  await test('the default German voice is Martin (Kokoro) and exists in the catalogue', () => {
    assert.strictEqual(DEFAULTS.tts.germanVoice, DEFAULT);
    assert.strictEqual(ids.DEFAULT_GERMAN_VOICE, DEFAULT);
    assert.strictEqual(piper.DEFAULT_VOICE, DEFAULT);
    assert(piper.CATALOGUE.some((v) => v.id === DEFAULT && v.gpu));
  });
  await test('fresh settings stay on the default voice and get the migration mark', () => {
    const s = fresh();
    assert.strictEqual(migrateSettings(s), true);
    assert.strictEqual(s.tts.germanVoice, DEFAULT);
    assert.strictEqual(s.tts.voiceSchema, 2);
    assert.strictEqual(migrateSettings(s), false, 'the migration runs once');
  });

  console.log('settings of older builds');
  for (const old of ['default', 'builtin', 'kartoffelbox:default', 'kartoffelbox:builtin', 'C:\\Users\\x\\stimme.wav', '/home/x/stimme.wav', 'af_heart', '', null]) {
    await test(`germanVoice ${JSON.stringify(old)} becomes the default voice`, () => {
      const s = fresh(); s.tts.germanVoice = old; delete s.tts.voiceSchema;
      migrateSettings(s);
      assert.strictEqual(s.tts.germanVoice, DEFAULT);
    });
  }
  await test('a chosen Piper or Kokoro voice is kept', () => {
    for (const id of ['de_DE-karlsson-low', 'de_DE-thorsten-medium', 'de_DE-thorsten_emotional-medium', 'de_DE-martin-kokoro', 'de_DE-eva_k-x_low']) {
      const s = fresh(); s.tts.germanVoice = id;
      migrateSettings(s);
      assert.strictEqual(s.tts.germanVoice, id);
    }
  });
  await test('an explicit Kartoffelbox choice after the migration is kept', () => {
    const s = fresh(); s.tts.germanVoice = 'kartoffelbox:default'; s.tts.voiceSchema = 2;
    assert.strictEqual(migrateSettings(s), false);
    assert.strictEqual(s.tts.germanVoice, 'kartoffelbox:default');
  });
  await test('0.6: a page colour chosen before follows the appearance once, a colour picked afterwards stays', () => {
    const s = fresh(); s.reader.theme = 'night'; s.reader.themeChosen = true;
    assert.strictEqual(migrateSettings(s), true);
    assert.strictEqual(s.reader.themeChosen, false);
    assert.strictEqual(s.reader.theme, 'paper');
    assert.strictEqual(s.reader.pageSchema, 1);
    s.reader.theme = 'night'; s.reader.themeChosen = true;   // picked again in the Aa menu
    assert.strictEqual(migrateSettings(s), false);
    assert.strictEqual(s.reader.theme, 'night');
    assert.strictEqual(s.reader.themeChosen, true);
  });
  await test('0.6: a render scale above 1 (it never reached the post effects) is set back once, a later one stays', () => {
    const s = fresh(); s.graphics.resolutionScale = 1.4;
    assert.strictEqual(migrateSettings(s), true);
    assert.strictEqual(s.graphics.resolutionScale, 1);
    assert.strictEqual(s.graphics.scaleSchema, 1);
    s.graphics.resolutionScale = 1.3;
    assert.strictEqual(migrateSettings(s), false);
    assert.strictEqual(s.graphics.resolutionScale, 1.3);
    const t = fresh(); t.graphics.resolutionScale = 0.8;
    migrateSettings(t);
    assert.strictEqual(t.graphics.resolutionScale, 0.8);
  });
  await test('settings.json of an older build: stored through Store, migrated, other values untouched', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesesaal-tts-'));
    try {
      const file = path.join(dir, 'settings.json');
      fs.writeFileSync(file, JSON.stringify({ language: 'en', tts: { englishVoice: 'bf_emma', germanVoice: 'default', speed: 1.2, autoLang: true, germanPrompt: null } }));
      const store = new Store(file, DEFAULTS);
      assert.strictEqual(migrateSettings(store.data), true);
      store.flush();
      const back = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.strictEqual(back.tts.germanVoice, DEFAULT);
      assert.strictEqual(back.tts.englishVoice, 'bf_emma');
      assert.strictEqual(back.tts.speed, 1.2);
      assert.strictEqual(back.language, 'en');
      // the next start leaves it alone
      assert.strictEqual(migrateSettings(new Store(file, DEFAULTS).data), false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  console.log('voice ids in the renderer (tts-voice-id.js)');
  await test('resolveGermanVoice: old and empty values mean the default voice, Kartoffelbox only when chosen explicitly', () => {
    for (const v of ['default', 'builtin', '', null, undefined, 'af_heart', 'bm_george', 'unknown']) assert.strictEqual(ids.resolveGermanVoice(v), DEFAULT, String(v));
    assert.strictEqual(ids.resolveGermanVoice('de_DE-karlsson-low'), 'de_DE-karlsson-low');
    assert.strictEqual(ids.resolveGermanVoice('de_DE-martin-kokoro'), 'de_DE-martin-kokoro');
    assert.strictEqual(ids.resolveGermanVoice('kartoffelbox:default'), 'kartoffelbox:default');
  });
  await test('engineForVoice', () => {
    assert.strictEqual(ids.engineForVoice('de_DE-thorsten-medium'), 'piper');
    assert.strictEqual(ids.engineForVoice('de_DE-martin-kokoro'), 'kokoro-de');
    assert.strictEqual(ids.engineForVoice('af_heart'), 'kokoro');
    assert.strictEqual(ids.engineForVoice('kartoffelbox:default'), 'kartoffelbox');
    assert.strictEqual(ids.engineForVoice(''), null);
  });
  await test('every Piper catalogue id resolves to itself and to the piper or kokoro-de engine', () => {
    for (const v of piper.CATALOGUE) {
      assert.strictEqual(ids.resolveGermanVoice(v.id), v.id);
      assert(['piper', 'kokoro-de'].includes(ids.engineForVoice(v.id)), v.id);
    }
  });

  console.log('voice downloads (piper.js downloadFile, a local server)');
  await test('a resumed download takes the whole file when the server ignores the Range header, the rest when it honours it', async () => {
    const http = require('http');
    const body = Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
    const log = [];
    const server = http.createServer((req, res) => {
      log.push(req.headers.range || 'all');
      const m = /^bytes=(\d+)-$/.exec(req.headers.range || '');
      if (m && req.url.startsWith('/ranges/')) {
        const from = +m[1];
        res.writeHead(206, { 'Content-Range': `bytes ${from}-${body.length - 1}/${body.length}`, 'Content-Length': body.length - from });
        res.end(body.subarray(from));
      } else { res.writeHead(200, { 'Content-Length': body.length }); res.end(body); }   // a plain mirror: the whole file, whatever was asked
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cozy-shelves-voice-'));
    try {
      // a config file (its size is not known in advance) whose first download broke off after four bytes
      let dest = path.join(dir, 'a.onnx.json');
      fs.writeFileSync(dest + '.part', body.subarray(0, 4));
      await piper._internal.downloadFile(base + '/plain/a.onnx.json', dest, 0, null, null);
      assert.strictEqual(fs.readFileSync(dest).toString(), body.toString(), 'the mirror sent the whole file, the part was appended to');
      assert.deepStrictEqual(log, ['bytes=4-'], 'one request');
      // a voice file of known size on the same mirror: whole in one request as well
      log.length = 0;
      dest = path.join(dir, 'b.onnx');
      fs.writeFileSync(dest + '.part', body.subarray(0, 10));
      await piper._internal.downloadFile(base + '/plain/b.onnx', dest, body.length, null, null);
      assert.strictEqual(fs.readFileSync(dest).toString(), body.toString());
      assert.deepStrictEqual(log, ['bytes=10-'], 'the broken file was downloaded again');
      // a server with Range support sends only the rest
      log.length = 0;
      dest = path.join(dir, 'c.onnx');
      fs.writeFileSync(dest + '.part', body.subarray(0, 10));
      let progress = 0;
      await piper._internal.downloadFile(base + '/ranges/c.onnx', dest, body.length, (received) => { progress = received; }, null);
      assert.strictEqual(fs.readFileSync(dest).toString(), body.toString());
      assert.deepStrictEqual(log, ['bytes=10-']);
      assert.strictEqual(progress, body.length, 'the progress counts the bytes already on disk');
      assert(!fs.existsSync(dest + '.part'), 'the part is renamed');
    } finally {
      await new Promise((r) => server.close(r));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  await test('a download follows a redirect, and a mirror that redirects in circles ends with an error instead of requests without end', async () => {
    const http = require('http');
    const body = Buffer.from('voice bytes');
    let hits = 0;
    const server = http.createServer((req, res) => {
      hits++;
      if (req.url === '/loop') { res.writeHead(302, { Location: '/loop' }); res.end(); return; }
      if (req.url === '/hop') { res.writeHead(302, { Location: '/file.onnx' }); res.end(); return; }
      res.writeHead(200, { 'Content-Length': body.length }); res.end(body);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cozy-shelves-voice-'));
    try {
      await piper._internal.downloadFile(base + '/hop', path.join(dir, 'a.onnx'), body.length, null, null);
      assert.strictEqual(fs.readFileSync(path.join(dir, 'a.onnx')).toString(), body.toString(), 'one redirect is followed');
      hits = 0;
      const t0 = Date.now();
      await assert.rejects(piper._internal.downloadFile(base + '/loop', path.join(dir, 'b.onnx'), body.length, null, null), (e) => e.code === 'download-failed' && /Weiterleitungen/.test(e.message));
      assert(Date.now() - t0 < 20000, 'the redirect loop ran for too long');
      assert(hits <= 12 * 5, `the loop was followed ${hits} times`);
      assert(!fs.existsSync(path.join(dir, 'b.onnx')));
    } finally {
      await new Promise((r) => server.close(r));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // German phonemes (espeak-ng), the Kokoro conversion, the text normalisation and the audio clean-up
  await require('./test-phonemes').run(test);
  // what reaches the voices: language of books and paragraphs, PDF text, chess notation, junk (0.7)
  await require('./test-reading').run(test);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
