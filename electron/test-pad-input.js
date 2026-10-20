// node electron/test-pad-input.js — the gamepad's pointer may move, press the left button and turn the wheel in the app's
// own window, nothing else; only the main window may ask.
const assert = require('assert');
const { toInputEvent, register } = require('./pad-input');

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; console.log('  ok  ', name); } catch (e) { failed++; console.log('  FAIL', name, '-', e.message); } };

t('a move, a press and a release of the left button at a point', () => {
  assert.deepStrictEqual(toInputEvent({ type: 'mouseMove', x: 10.4, y: 20.6 }), { type: 'mouseMove', x: 10, y: 21 });
  assert.deepStrictEqual(toInputEvent({ type: 'mouseDown', x: 5, y: 6 }), { type: 'mouseDown', x: 5, y: 6, button: 'left', clickCount: 1 });
  assert.deepStrictEqual(toInputEvent({ type: 'mouseUp', x: 5, y: 6, button: 'right' }), { type: 'mouseUp', x: 5, y: 6, button: 'left', clickCount: 1 });
});
t('a move with the button held drags', () => assert.deepStrictEqual(toInputEvent({ type: 'mouseMove', x: 1, y: 2, down: true }).modifiers, ['leftButtonDown']));
t('the wheel, within limits', () => {
  const w = toInputEvent({ type: 'mouseWheel', x: 1, y: 2, dx: 0, dy: -90000 });
  assert.strictEqual(w.deltaY, -2000); assert.strictEqual(w.canScroll, true);
});
t('keys, the right button, odd types and odd points are refused', () => {
  for (const ev of [null, 'mouseDown', { type: 'keyDown', keyCode: 'A' }, { type: 'char', keyCode: 'a' }, { type: 'mouseEnter', x: 1, y: 1 }, { type: 'mouseMove', x: 'a', y: 1 }, { type: 'mouseMove', x: -5, y: 1 }, { type: 'mouseMove', x: 1e9, y: 1 }]) assert.strictEqual(toInputEvent(ev), null, JSON.stringify(ev));
});
t('only the main window may send, and only into itself', () => {
  let handler = null; const sent = [];
  const wc = { sendInputEvent: (e) => sent.push(e) };
  const win = { isDestroyed: () => false, webContents: wc };
  register({ ipcMain: { handle: (ch, fn) => { if (ch === 'pad:mouse') handler = fn; } }, getMainWindow: () => win });
  assert.strictEqual(handler({ sender: { sendInputEvent: () => assert.fail('a guest got input') } }, { type: 'mouseDown', x: 1, y: 1 }), false);
  assert.strictEqual(handler({ sender: wc }, { type: 'mouseDown', x: 1, y: 1 }), true);
  assert.strictEqual(handler({ sender: wc }, { type: 'keyDown', keyCode: 'A' }), false);
  assert.strictEqual(sent.length, 1);
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
