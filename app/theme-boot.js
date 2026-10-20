// Sets the appearance (light = Hell, sepia = Sepia, dark = Dunkel) on <html> before the first paint, so the
// loading screen and every panel start in the chosen theme without a bright flash. A classic script, not a module:
// it runs while <head> is parsed. Order: ?theme=… (dev and test override), settings.json through the preload
// (api.ui.themeSync), the last value the renderer mirrored into localStorage, then the default Sepia.
(function () {
  var ok = { light: 1, sepia: 1, dark: 1 };
  var t = null;
  try { t = new URLSearchParams(location.search).get('theme'); } catch (e) {}
  if (!ok[t]) { try { t = window.api && window.api.ui && window.api.ui.themeSync ? window.api.ui.themeSync() : null; } catch (e) { t = null; } }
  if (!ok[t]) { try { t = localStorage.getItem('lesesaal.theme'); } catch (e) { t = null; } }
  if (!ok[t]) t = 'sepia';
  document.documentElement.setAttribute('data-theme', t);
})();
