// The gamepad's pointer (app/src/input/pad-cursor.js): mouse input at a point of the app's own window, sent through
// Electron so that the page takes it like a real mouse. The chess board, the easel, web pages in the reading browser
// and Street View only trust real input, a click made up in the page does nothing there.
// Only the main window may ask, only for itself, and only for moves, the left button and the wheel.
const TYPES = new Set(['mouseMove', 'mouseDown', 'mouseUp', 'mouseWheel']);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** The input event for webContents.sendInputEvent, or null when the request is not one of ours. */
function toInputEvent(ev) {
  if (!ev || typeof ev !== 'object' || !TYPES.has(ev.type)) return null;
  const x = Math.round(Number(ev.x)), y = Math.round(Number(ev.y));
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 20000 || y > 20000) return null;
  const input = { type: ev.type, x, y };
  if (ev.type === 'mouseDown' || ev.type === 'mouseUp') { input.button = 'left'; input.clickCount = 1; }
  if (ev.type === 'mouseMove' && ev.down) input.modifiers = ['leftButtonDown'];
  if (ev.type === 'mouseWheel') {
    input.deltaX = clamp(Number(ev.dx) || 0, -2000, 2000);
    input.deltaY = clamp(Number(ev.dy) || 0, -2000, 2000);
    input.canScroll = true;
    input.hasPreciseScrollingDeltas = true;
  }
  return input;
}

function register({ ipcMain, getMainWindow }) {
  ipcMain.handle('pad:mouse', (e, ev) => {
    const win = getMainWindow?.();
    if (!win || win.isDestroyed() || e.sender !== win.webContents) return false;
    const input = toInputEvent(ev);
    if (!input) return false;
    win.webContents.sendInputEvent(input);
    return true;
  });
}

module.exports = { register, toInputEvent };
