// Where the program keeps its data. It was called Lesesaal until 0.7.2 and Cozystacks from 0.8.0 to 0.9.2; its folder
// was <appData>/Lesesaal, then <appData>/Cozystacks (%APPDATA%\... on Windows, ~/.config/... on Linux). While the folder
// under the new name holds no data yet, the first former folder with data stays in use, Cozystacks before Lesesaal:
// the settings, the library, the covers, the reading positions and the stores of the app's pages are all in it. An
// update from Lesesaal to Cozystacks kept using the Lesesaal folder (the Cozystacks folder only got Electron's own
// files), so that folder is still found after the next update.
// Electron creates the folder under the new name before the main script runs (empty but for "Local State"), so the
// test is whether it holds the program's own files, not whether it exists. A folder given on the command line
// (--user-data-dir, the test runs) always wins.
'use strict';
const fs = require('fs');
const path = require('path');

// the former names, newest first
const FORMER_NAMES = ['Cozystacks', 'Lesesaal'];
// files the program writes into its data folder; one of them means the folder is in use
const OWN_FILES = ['settings.json', 'library.json'];

const holdsData = (dir, exists) => OWN_FILES.some((f) => exists(path.join(dir, f)));

/**
 * @param {{ given: boolean, current: string, appData: string, exists?: (p: string) => boolean }} o
 *   given: --user-data-dir was passed; current: Electron's folder under the new name; appData: the parent of all of them
 * @returns {string} the folder to use
 */
function dataFolder({ given, current, appData, exists = fs.existsSync }) {
  if (given || holdsData(current, exists)) return current;
  for (const name of FORMER_NAMES) {
    const former = path.join(appData, name);
    if (path.resolve(former) !== path.resolve(current) && holdsData(former, exists)) return former;
  }
  return current;
}

/** The same for a folder the program made inside another one (the Mediathek's downloads in Videos): nobody else
 *  creates it, so there the folder itself counts. formerNames: one name or a list, newest first. */
function keptFolder(parent, name, formerNames, exists = fs.existsSync) {
  const now = path.join(parent, name);
  if (exists(now)) return now;
  for (const former of [].concat(formerNames)) {
    const before = path.join(parent, former);
    if (exists(before)) return before;
  }
  return now;
}

module.exports = { dataFolder, keptFolder, FORMER_NAMES, OWN_FILES };
