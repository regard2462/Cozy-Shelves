const path = require('path');
const { app } = require('electron');
const { Store } = require('./store');
// the defaults, the migrations and the appearance helpers are pure and shared with the browser version
const { DEFAULTS, deepMerge, migrateSettings, THEMES, themeOf, THEME_BG } = require('./settings-defaults');

let store;
function getSettings() {
  if (!store) {
    store = new Store(path.join(app.getPath('userData'), 'settings.json'), DEFAULTS);
    if (migrateSettings(store.data)) store.save();
  }
  return store;
}

module.exports = { getSettings, DEFAULTS, deepMerge, migrateSettings, THEMES, themeOf, THEME_BG };
