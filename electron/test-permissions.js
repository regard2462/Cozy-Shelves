// node electron/test-permissions.js — the app may capture the mouse, nothing else leaks through.
const assert = require('assert');
const { allowAppPermission, allowGuestPermission } = require('./permissions');

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ok  ', name); } catch (e) { failed++; console.log('  FAIL', name, '-', e.message); } };

t('the library page may capture the mouse (look around)', () => assert.strictEqual(allowAppPermission('pointerLock', 'app://lesesaal/index.html'), true));
t('full screen and copying are allowed for the app itself', () => {
  assert.strictEqual(allowAppPermission('fullscreen', 'app://lesesaal/index.html'), true);
  assert.strictEqual(allowAppPermission('clipboard-sanitized-write', 'app://lesesaal'), true);
});
t('a hidden test window may not go full screen, but keeps pointer lock', () => {
  assert.strictEqual(allowAppPermission('fullscreen', 'app://lesesaal/index.html', { fullscreen: false }), false);
  assert.strictEqual(allowAppPermission('pointerLock', 'app://lesesaal/index.html', { fullscreen: false }), true);
});
t('camera, microphone, location, notifications stay denied', () => {
  for (const p of ['media', 'geolocation', 'notifications', 'midi', 'clipboard-read', 'display-capture', 'openExternal', 'keyboardLock']) assert.strictEqual(allowAppPermission(p, 'app://lesesaal/index.html'), false, p);
});
t('web pages get nothing, not even pointer lock', () => {
  for (const u of ['https://example.org/', 'http://localhost/', 'file:///C:/x.html', '', null]) assert.strictEqual(allowAppPermission('pointerLock', u), false, String(u));
});
t('a page in the reading browser may go full screen (a film, Street View), nothing else', () => {
  assert.strictEqual(allowGuestPermission('fullscreen'), true);
  for (const p of ['pointerLock', 'geolocation', 'media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'keyboardLock', 'openExternal']) assert.strictEqual(allowGuestPermission(p), false, p);
});
t('in a hidden test window a page may not go full screen either', () => assert.strictEqual(allowGuestPermission('fullscreen', { fullscreen: false }), false));

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
