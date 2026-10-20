// Feeds / podcasts / wikipedia / dictionary backend.
// Registers IPC handlers: feeds:*, podcasts:*, wiki:*, dict:*  (see electron/preload.js)
// NOTE: implemented in feeds.js, podcasts.js, wiki.js, dict.js — this file wires them up.
let mods = {};
function register(ctx) {
  for (const name of ['feeds', 'podcasts', 'wiki', 'dict']) {
    try { mods[name] = require('./' + name); mods[name].register(ctx); }
    catch (e) { console.error('[feeds] module not available yet:', name, e.message); }
  }
}
module.exports = { register };
