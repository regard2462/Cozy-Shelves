// Tests of electron/data-folder.js: an update from Cozystacks (0.8.0 to 0.9.2) or from Lesesaal (up to 0.7.2) keeps its
// data folder and the Mediathek's download folder.
// Run: node electron/test-data-folder.js
'use strict';
const assert = require('assert');
const path = require('path');
const { dataFolder, keptFolder } = require('./data-folder');

const appData = path.join(path.sep, 'cfg');
const now = path.join(appData, 'Cozy Shelves'), cozy = path.join(appData, 'Cozystacks'), before = path.join(appData, 'Lesesaal');
const has = (...paths) => (p) => paths.some((d) => path.resolve(d) === path.resolve(p));
const settingsIn = (dir) => path.join(dir, 'settings.json');
const libraryIn = (dir) => path.join(dir, 'library.json');
// what Electron itself puts into the folder under a program's name before the main script runs
const electronOnly = (dir) => [dir, path.join(dir, 'Local State')];
const pick = (...paths) => dataFolder({ given: false, current: now, appData, exists: has(...paths) });
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('a fresh computer gets the folder under the new name', () => assert.strictEqual(pick(now), now));
t('an update from Cozystacks keeps its folder', () => assert.strictEqual(pick(cozy, settingsIn(cozy)), cozy));
t('an update from Lesesaal keeps the Lesesaal folder', () => assert.strictEqual(pick(before, settingsIn(before)), before));
// Electron makes the folder under the new name before the main script runs: empty, it must not win
t('the empty folder Electron made under the new name does not count', () => assert.strictEqual(pick(...electronOnly(now), cozy, libraryIn(cozy)), cozy));
// an update from Lesesaal to Cozystacks went on with the Lesesaal folder: the Cozystacks folder only got Electron's files
t('Lesesaal data used by Cozystacks stays in use', () => assert.strictEqual(pick(...electronOnly(now), ...electronOnly(cozy), before, libraryIn(before)), before));
t('Cozystacks comes before Lesesaal when both hold data', () => assert.strictEqual(pick(cozy, settingsIn(cozy), before, settingsIn(before)), cozy));
t('once the new folder holds settings it wins', () => assert.strictEqual(pick(now, settingsIn(now), cozy, settingsIn(cozy), before, settingsIn(before)), now));
t('the library alone counts as well', () => assert.strictEqual(pick(now, libraryIn(now), cozy, settingsIn(cozy)), now));
t('former folders without data are not taken', () => assert.strictEqual(pick(now, ...electronOnly(cozy), before), now));
t('--user-data-dir always wins', () => assert.strictEqual(dataFolder({ given: true, current: '/tmp/x', appData, exists: has(cozy, settingsIn(cozy), before, settingsIn(before)) }), '/tmp/x'));

const V = path.join(path.sep, 'v'), NEW = 'Cozy Shelves Mediathek', FORMER = ['Cozystacks Mediathek', 'Lesesaal Mediathek'];
const kept = (...names) => keptFolder(V, NEW, FORMER, has(...names.map((x) => path.join(V, x))));
t('the Mediathek keeps the download folder of Cozystacks', () => assert.strictEqual(kept('Cozystacks Mediathek'), path.join(V, 'Cozystacks Mediathek')));
t('and the one of Lesesaal', () => assert.strictEqual(kept('Lesesaal Mediathek'), path.join(V, 'Lesesaal Mediathek')));
t('Cozystacks comes before Lesesaal', () => assert.strictEqual(kept('Cozystacks Mediathek', 'Lesesaal Mediathek'), path.join(V, 'Cozystacks Mediathek')));
t('the folder under the new name wins once it exists', () => assert.strictEqual(kept(NEW, 'Cozystacks Mediathek', 'Lesesaal Mediathek'), path.join(V, NEW)));
t('and is taken on a fresh computer', () => assert.strictEqual(kept(), path.join(V, NEW)));
t('a single former name still works', () => assert.strictEqual(keptFolder(V, NEW, 'Lesesaal Mediathek', has(path.join(V, 'Lesesaal Mediathek'))), path.join(V, 'Lesesaal Mediathek')));
console.log(`DATA-FOLDER ${n}/${n} passed`);
