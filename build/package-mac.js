// Builds the macOS packages, unsigned: dist/CozyShelves-<version>-mac-arm64.zip and dist/CozyShelves-<version>-mac-x64.zip,
// each with "Cozy Shelves.app" and the guides. @electron/packager puts the main process and the built page (the stage with the runtime dependencies) into the Electron app of the architecture; the archive is written here (jszip) because the app holds symbolic
// links and executables whose modes must survive, and the zip tools of Windows keep neither.
// Runs on Windows, Linux and macOS (packaging needs permission to make symbolic links; on Windows that is Developer Mode
// or an administrator shell). Nothing is signed or notarized: see START.txt in the archive. Run `npm run build` first (npm run dist:mac does).
// The icon assets/icon.icns comes from `python build/make-icns.py` (needs Pillow) and is kept in the repository.
//   node build/package-mac.js [arm64|x64]     default both
'use strict';
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { root, dist, pkg, COPYRIGHT, SOURCE_NOTE, makeStage, electronVersion } = require('./package-common');

const NAME = 'Cozy Shelves';
const APP = NAME + '.app';
const ARCHS = process.argv.slice(2).filter((a) => a === 'arm64' || a === 'x64');
const NL = String.fromCharCode(10);

const START = [
  'Cozy Shelves starten: ' + APP + ' in den Ordner Programme ziehen und öffnen. Anleitung: README.de.md',
  'Start Cozy Shelves: drag ' + APP + ' to the Applications folder and open it. Guide: README.md',
  '',
  'Dieses Paket ist weder signiert noch notarisiert und wurde auf keinem Mac getestet.',
  'This package is neither signed nor notarized, and it has not been tested on a Mac.',
  '',
  'macOS meldet dann, die App sei beschädigt oder von einem nicht verifizierten Entwickler. Im Terminal einmal:',
  'macOS then says the app is damaged or from an unidentified developer. Run this once in a terminal:',
  '  xattr -dr com.apple.quarantine "/Applications/' + APP + '"',
  'Oder: Rechtsklick auf die App, dann Öffnen. / Or: right-click the app, then Open.',
  'Auf Macs mit Apple-Chip (arm64) braucht die geänderte App außerdem eine Ad-hoc-Signatur:',
  'On Macs with Apple silicon (arm64) the modified app also needs an ad-hoc signature:',
  '  codesign --force --deep --sign - "/Applications/' + APP + '"',
  '',
  'Cozy Shelves ist freie Software unter der GNU Affero General Public License, Version 3 oder neuer (COPYING.txt).',
  'Cozy Shelves is free software under the GNU Affero General Public License, version 3 or later (COPYING.txt).',
  'Third-party components: THIRD_PARTY_NOTICES.md, THIRD_PARTY_LICENSES.txt',
  ...SOURCE_NOTE,
  '',
].join(NL);

const MACHO = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);
/** Executable files of the app: Mach-O binaries (programs, libraries, frameworks) and scripts with a #! line. */
function isExecutable(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(4);
    if (fs.readSync(fd, b, 0, 4, 0) < 4) return false;
    return MACHO.has(b.readUInt32BE(0)) || (b[0] === 0x23 && b[1] === 0x21);
  } finally { fs.closeSync(fd); }
}

/** Adds a folder to the archive under `prefix`, symbolic links as links, executables with mode 755. */
function addTree(zip, dir, prefix) {
  const date = new Date();
  zip.file(prefix + '/', null, { dir: true, unixPermissions: 0o755, date });
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const src = path.join(dir, e.name), name = prefix + '/' + e.name;
    if (e.isSymbolicLink()) zip.file(name, fs.readlinkSync(src).split(path.sep).join('/'), { unixPermissions: 0o120755, date });
    else if (e.isDirectory()) addTree(zip, src, name);
    else zip.file(name, fs.createReadStream(src), { unixPermissions: isExecutable(src) ? 0o100755 : 0o100644, date });
  }
}

async function build(arch) {
  const stage = makeStage();
  const { packager } = require('@electron/packager');
  console.log('packaging with electron', electronVersion(), 'for darwin ' + arch);
  const outPaths = await packager({
    dir: stage, out: dist, platform: 'darwin', arch, electronVersion: electronVersion(), asar: false, overwrite: true, prune: false,
    name: NAME, appBundleId: 'com.cozyshelves.app', appCategoryType: 'public.app-category.productivity', icon: path.join(root, 'assets', 'icon.icns'),
    appVersion: pkg.version, appCopyright: COPYRIGHT, ignore: [/\.git/],
  });
  if (!outPaths.length) throw new Error('@electron/packager made no darwin package (on Windows it needs permission to make symbolic links)');
  const outDir = outPaths[0];
  const app = path.join(outDir, APP);
  if (!fs.existsSync(app)) throw new Error('no ' + APP + ' in ' + outDir);

  const zip = new JSZip();
  addTree(zip, app, APP);
  zip.file('START.txt', START);
  for (const f of ['README.md', 'README.de.md', 'THIRD_PARTY_NOTICES.md']) zip.file(f, fs.readFileSync(path.join(root, f)));
  zip.file('COPYING.txt', fs.readFileSync(path.join(root, 'LICENSE')));
  zip.file('THIRD_PARTY_LICENSES.txt', fs.readFileSync(path.join(stage, 'THIRD_PARTY_LICENSES.txt')));
  const zipName = `CozyShelves-${pkg.version}-mac-${arch}.zip`, zipPath = path.join(dist, zipName);
  fs.rmSync(zipPath, { force: true });
  await new Promise((res, rej) => {
    zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, platform: 'UNIX', compression: 'DEFLATE', compressionOptions: { level: 9 } })
      .pipe(fs.createWriteStream(zipPath)).on('finish', res).on('error', rej);
  });
  console.log('ZIP:', zipPath, (fs.statSync(zipPath).size / 1e6).toFixed(1), 'MB');
  fs.rmSync(outDir, { recursive: true, force: true });
}

(async () => {
  for (const arch of ARCHS.length ? ARCHS : ['arm64', 'x64']) await build(arch);
})().catch((e) => { console.error(e); process.exit(1); });
