// What the Windows and the Linux package share: the staged app (dist/stage with the runtime dependencies and the
// license texts), the copyright line and the note on the source code.
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const stage = path.join(dist, 'stage');
const pkg = require(path.join(root, 'package.json'));
// the copyright line of the program's version info and of the packages, and where the source code of a release is: an
// archive of it comes with every release (no address goes into the packages)
const COPYRIGHT = '© Cozy Shelves contributors, GPL-3.0-or-later';
const SOURCE_NOTE = [
  'Quellcode: Zu jeder Veröffentlichung gibt es das Quellcode-Archiv dieser Version.',
  'Source code: the source archive comes with each release.',
];
// the guides and license files that go into the package (resources/app)
const DOCS = ['README.md', 'README.de.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'LIZENZEN.md'];

function copyDir(src, dst, filter) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name), d = path.join(dst, ent.name);
    const rel = path.relative(root, s);
    if (filter && !filter(rel, ent)) continue;
    if (ent.isDirectory()) copyDir(s, d, filter); else fs.copyFileSync(s, d);
  }
}

/** The guides in docs/ (its files only: the working notes in docs/strands and any other folder stay out of the package;
 *  copying a folder as a file ended the build with EPERM or EISDIR). */
function copyDocs(dst) {
  const src = path.join(root, 'docs');
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) if (ent.isFile()) fs.copyFileSync(path.join(src, ent.name), path.join(dst, ent.name));
}

/** dist/stage: the app files, a runtime package.json with the main process's dependencies installed, the licenses. */
function makeStage() {
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  copyDir(path.join(root, 'electron'), path.join(stage, 'electron'));
  copyDir(path.join(root, 'app'), path.join(stage, 'app'), (rel, ent) => !/^app[\\/](src|dev-samples)$/.test(rel) && !rel.endsWith('.map') && ent.name !== 'dev.html' && !/[\\/]tests?$/.test(rel) && !/[\\/]fixtures$/.test(rel));
  copyDir(path.join(root, 'tts-server'), path.join(stage, 'tts-server'), (rel, ent) => ent.name !== 'venv' && ent.name !== '__pycache__');
  copyDir(path.join(root, 'assets'), path.join(stage, 'assets'));
  for (const f of DOCS) if (fs.existsSync(path.join(root, f))) fs.copyFileSync(path.join(root, f), path.join(stage, f));
  copyDocs(path.join(stage, 'docs'));
  // runtime package.json: main-process dependencies only. desktopName: the launcher entry of the Linux package, which
  // Electron names to the desktop so that the window and the menu entry belong together
  const thirdParty = require('./third-party');
  const p = {
    name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description, main: pkg.main,
    author: pkg.author, license: pkg.license, desktopName: 'cozy-shelves.desktop', private: true,
    dependencies: Object.fromEntries(thirdParty.RUNTIME_DEPS.map((d) => [d, pkg.dependencies[d]])),
  };
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(p, null, 2));
  // the lock file keeps the versions the app was tested with (without it npm takes the newest its ranges allow)
  fs.copyFileSync(path.join(root, 'package-lock.json'), path.join(stage, 'package-lock.json'));
  console.log('installing runtime dependencies…');
  execSync('npm install --omit=dev --no-audit --no-fund --ignore-scripts', { cwd: stage, stdio: 'inherit' });
  // the license texts of every third-party component in the package, the main process's packages in the versions
  // just installed (build/third-party.js)
  fs.writeFileSync(path.join(stage, 'THIRD_PARTY_LICENSES.txt'), thirdParty.fullText(thirdParty.collect({ runtimeFrom: stage })));
  return stage;
}

const electronVersion = () => require(path.join(root, 'node_modules', 'electron', 'package.json')).version;

module.exports = { root, dist, stage, pkg, COPYRIGHT, SOURCE_NOTE, copyDir, copyDocs, makeStage, electronVersion };
