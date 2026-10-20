#!/usr/bin/env node
// Unit tests of small pieces of the interface that run without Electron (Cozy Shelves 0.8). Run: node app/src/ui/__tests__/run.js
//   the placeholders of the texts (core/i18n.js): a book title with a dollar sign in it stays as it is
//   numbers and dates in the language of the interface (reading browser, Fernleihe)
//   the German texts of the interface: no dash as punctuation (the style rule of the project)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const importApp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) { failed++; console.log('  FAIL', name, '\n', e?.stack || e); }
}
// the modules only need the document when a language is set
globalThis.document = globalThis.document || { documentElement: {} };

(async () => {
  const I = await importApp('app/src/core/i18n.js');
  const U = await importApp('app/src/ui/browser/util.js');
  const R = await importApp('app/src/ui/browser/reader.js');

  console.log('placeholders of the texts (core/i18n.js)');
  await test('a value with "$&", "$\'", "$$" and "$1" is put in as it is', () => {
    const title = 'Rock $& Roll $\' and $$ $1 $<x>';
    const s = I.t('hud.inBasket', { title });
    assert(s.includes(title), s);
    assert.strictEqual(s, `„${title}“ liegt im Korb. <kbd>B</kbd> öffnet den Korb.`);
    assert.strictEqual(I.tr({ de: 'Hallo {x}', en: 'Hello {x}' }, { x: 'A$&B' }), 'Hallo A$&B');
  });
  await test('a value that contains the placeholder itself is not filled twice', () => {
    assert.strictEqual(I.tr({ de: '{a} und {b}' }, { a: '{b}', b: 'B' }), '{b} und B');
  });
  await test('every occurrence of a placeholder is filled, numbers and missing values included', () => {
    assert.strictEqual(I.tr({ de: '{n} von {n}, {m}' }, { n: 3, m: undefined }), '3 von 3, undefined');
    assert.strictEqual(I.t('hud.scanning', { done: 1, total: 20 }), 'Bücher werden einsortiert: 1 / 20');
    assert.strictEqual(I.t('unknown.key'), 'unknown.key');
  });

  console.log('numbers and dates in the language of the interface');
  await test('reading browser: file sizes with the decimal separator of the language', () => {
    assert.strictEqual(U.formatBytes(2.4 * 1048576), '2,4 MB');
    assert.strictEqual(U.formatBytes(2.4 * 1048576, 'en'), '2.4 MB');
    assert.strictEqual(U.formatBytes(24 * 1048576, 'en'), '24 MB');
    assert.strictEqual(U.formatBytes(512 * 1024, 'en'), '512 KB');
    assert.strictEqual(U.decimal('de'), ','); assert.strictEqual(U.decimal('en'), '.');
  });
  await test('reader mode: the date of an article in German and in English', () => {
    const d = new Date(2026, 9, 14, 12).toISOString();
    assert.strictEqual(R.formatDate(d), '14. Oktober 2026');
    assert.strictEqual(R.formatDate(d, 'en'), '14 October 2026');
    assert.strictEqual(R.formatDate('not a date', 'en'), '');
  });

  console.log('the German texts of the interface');
  await test('no dash as punctuation in a German text of the panels', () => {
    const dirs = [path.join(ROOT, 'app', 'src', 'ui'), path.join(ROOT, 'app', 'src', 'i18n'), path.join(ROOT, 'app', 'src', 'input')];
    const files = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'tests') walk(p); } else if (p.endsWith('.js')) files.push(p); } };
    for (const d of dirs) walk(d);
    const bad = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      // the German text is the first argument of T('…', '…') and tr({ de: '…' }), or the value of a key in i18n/de.js
      for (const m of src.matchAll(/(?:\bT\(|\bde:\s*)(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
        if (/\s[–—]\s/.test(m[2])) bad.push(path.relative(ROOT, f) + ': ' + m[2].slice(0, 80));
      }
    }
    assert.deepStrictEqual(bad, []);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
