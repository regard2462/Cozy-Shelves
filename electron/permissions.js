// Which browser permissions the app's own pages (app://) may use. Everything else stays denied, and the
// reading browser's guests (their own partition) get nothing but full screen.
//
// pointerLock is essential: Electron routes Pointer Lock through the permission handler, and denying it
// meant that a click into the 3D view never captured the mouse, so there was no way to look around.
const APP_PERMISSIONS = new Set([
  'pointerLock',                 // looking around in the library (mouse captured by a click into the view)
  'fullscreen',                  // films and panels in full screen (Fullscreen API)
  'clipboard-sanitized-write',   // "Link kopieren", copying quotes
]);

const isAppOrigin = (url) => /^app:\/\//i.test(String(url || ''));

/** Decision for a permission request / check coming from `url`. { fullscreen: false } (hidden test windows) denies
 *  the Fullscreen API: a test window placed beside every display must never cover a real one. */
function allowAppPermission(permission, url, { fullscreen = true } = {}) {
  if (!fullscreen && String(permission) === 'fullscreen') return false;
  return APP_PERMISSIONS.has(String(permission)) && isAppOrigin(url);
}

/** A web page in the reading browser (or the Street View of the world map) may go full screen on request, a film or
 *  Street View, and nothing else. A refused request left the page's requestFullscreen() waiting for good, and the
 *  Lesebrowser's full-screen view never came up. A hidden test window never goes full screen. */
function allowGuestPermission(permission, { fullscreen = true } = {}) {
  return !!fullscreen && String(permission) === 'fullscreen';
}
function applyGuestPermissions(sess, opts = {}) {
  sess.setPermissionRequestHandler((wc, permission, cb) => cb(allowGuestPermission(permission, opts)));
  sess.setPermissionCheckHandler((wc, permission) => allowGuestPermission(permission, opts));
  sess.setDevicePermissionHandler(() => false);
}

/** Wires the handlers into the app's own session. */
function applyAppPermissions(sess, opts = {}) {
  sess.setPermissionRequestHandler((wc, permission, cb, details) => {
    let url = details?.requestingUrl || '';
    if (!url) { try { url = wc?.getURL?.() || ''; } catch {} }
    cb(allowAppPermission(permission, url, opts));
  });
  sess.setPermissionCheckHandler((wc, permission, requestingOrigin) => allowAppPermission(permission, requestingOrigin, opts));
}

module.exports = { APP_PERMISSIONS, allowAppPermission, applyAppPermissions, allowGuestPermission, applyGuestPermissions };
