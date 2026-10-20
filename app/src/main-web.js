// The entry of the browser version (build/web.js bundles it as dist/app.js): the backend of the page is installed as
// window.api first (core/api-web.js), then the app starts exactly as on the desktop (main.js). The dynamic import keeps
// the order: a static import of main.js would evaluate core/api.js before window.api exists and fall back to the mock.
import { installWebApi } from './core/api-web.js';

// A phone held sideways gives the page 360 to 420 CSS pixels of height, and the panels were laid out for a window:
// the page is zoomed out so that at least 560 lie in the viewport (a 411 px phone shows the page at 73 %, which the
// floor of 0.72 keeps readable; a tablet stays at 1). The world renders at the same number of device pixels either way
// (core/api-web.js lowers the render resolution on a phone to match).
(function fitPhoneViewport() {
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta || !matchMedia('(pointer: coarse)').matches) return;
  const short = Math.min(screen.width, screen.height);
  const scale = Math.round(Math.max(0.72, Math.min(1, short / 560)) * 100) / 100;
  if (scale >= 1) return;
  meta.content = `width=device-width, initial-scale=${scale}, minimum-scale=${scale}, maximum-scale=${scale}, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content`;
})();

try {
  await installWebApi();
} catch (e) {
  console.error('[web] backend failed to start', e);
  const el = document.getElementById('loading');
  if (el) el.textContent = 'Fehler beim Start / Failed to start: ' + (e?.message || e);
}
await import('./main.js');
