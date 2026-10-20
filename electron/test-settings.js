// Tests of electron/settings.js: the merge of a settings patch from the renderer (settings:set) and the appearance.
// Run: node electron/test-settings.js
'use strict';
const assert = require('assert');
const { deepMerge, themeOf, DEFAULTS, THEMES } = require('./settings');

let passed = 0, failed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log('  ok  ', name); } catch (e) { failed++; console.log('  FAIL', name, '\n', e); } };

test('a patch merges into nested objects and replaces arrays and scalars', () => {
  const d = { ui: { theme: 'sepia' }, folders: [{ path: 'C:\\Bücher' }], graphics: { quality: 'high', bloom: true } };
  deepMerge(d, { ui: { theme: 'dark' }, folders: [], graphics: { bloom: false }, language: 'en' });
  assert.deepStrictEqual(d, { ui: { theme: 'dark' }, folders: [], graphics: { quality: 'high', bloom: false }, language: 'en' });
});
test('a key the settings do not have yet is added as it is', () => {
  const d = { ui: { theme: 'sepia' } };
  deepMerge(d, { sky: { mode: 'live', place: { name: 'Lissabon', lat: 38.7, lon: -9.1 } } });
  assert.deepStrictEqual(d.sky, { mode: 'live', place: { name: 'Lissabon', lat: 38.7, lon: -9.1 } });
});
test('a patch with "__proto__", "constructor" or "prototype" keys never reaches Object.prototype', () => {
  // what JSON.parse (and the structured clone of the IPC) makes of such a key: an own property, not the prototype
  const patch = JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted2":2}},"ui":{"__proto__":{"polluted3":3},"theme":"dark"}}');
  const d = { ui: { theme: 'sepia' } };
  deepMerge(d, patch);
  assert.strictEqual(({}).polluted, undefined, 'Object.prototype was polluted');
  assert.strictEqual(({}).polluted2, undefined, 'Object.prototype was polluted through constructor.prototype');
  assert.strictEqual(({}).polluted3, undefined, 'Object.prototype was polluted through a nested key');
  assert.strictEqual(Object.getPrototypeOf(d), Object.prototype);
  assert.deepStrictEqual(d, { ui: { theme: 'dark' } });
  assert(!Object.hasOwn(d, '__proto__') && !Object.hasOwn(d, 'constructor'), 'the unsafe keys were stored');
});
test('themeOf falls back to the default appearance', () => {
  assert.strictEqual(themeOf({ ui: { theme: 'dark' } }), 'dark');
  assert.strictEqual(themeOf({ ui: { theme: 'neon' } }), DEFAULTS.ui.theme);
  assert.strictEqual(themeOf(null), DEFAULTS.ui.theme);
  assert(THEMES.includes(DEFAULTS.ui.theme));
});

const { migratePhoneGraphics, PHONE_GRAPHICS } = require('./settings-defaults');
test('a phone of 0.10.1 (quality low, six tenths of the pixels) gets the quality mobile once', () => {
  const d = { graphics: { quality: 'low', bloom: false, shadows: false, ssao: false, godrays: false, resolutionScale: 0.6, frameCap: 30, fov: 80, scaleSchema: 1 } };
  assert.strictEqual(migratePhoneGraphics(d, true), true);
  assert.deepStrictEqual(d.graphics, { quality: 'mobile', bloom: false, shadows: false, ssao: false, godrays: false, resolutionScale: 1, frameCap: 30, fov: 80, scaleSchema: 1, tierSchema: 1 });
  // once: a later choice of 'low' stays
  d.graphics.quality = 'low'; d.graphics.resolutionScale = 0.8;
  assert.strictEqual(migratePhoneGraphics(d, true), false);
  assert.strictEqual(d.graphics.quality, 'low'); assert.strictEqual(d.graphics.resolutionScale, 0.8);
});
test('the phone migration keeps medium and high, and leaves a computer alone', () => {
  for (const quality of ['medium', 'high']) {
    const d = { graphics: { quality, resolutionScale: 0.9, frameCap: 30, fov: 80 } };
    migratePhoneGraphics(d, true);
    assert.strictEqual(d.graphics.quality, quality); assert.strictEqual(d.graphics.resolutionScale, 0.9); assert.strictEqual(d.graphics.tierSchema, 1);
  }
  const pc = { graphics: { quality: 'low', resolutionScale: 0.7 } };
  migratePhoneGraphics(pc, false);
  assert.strictEqual(pc.graphics.quality, 'low'); assert.strictEqual(pc.graphics.resolutionScale, 0.7); assert.strictEqual(pc.graphics.tierSchema, 1);
  assert.strictEqual(PHONE_GRAPHICS.quality, 'mobile'); assert.strictEqual(PHONE_GRAPHICS.resolutionScale, 1); assert.strictEqual(PHONE_GRAPHICS.frameCap, 30);
});

console.log(`SETTINGS ${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
