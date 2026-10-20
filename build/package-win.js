// Builds the portable Windows package: dist/CozyShelves-win64/ + dist/CozyShelves-<version>-win64-portable.zip
// Runs on Linux without wine: @electron/packager (asar off) + resedit for the icon/version info.
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { root, dist, pkg, COPYRIGHT, SOURCE_NOTE, makeStage, electronVersion } = require('./package-common');

(async () => {
  const stage = makeStage();
  const { packager } = require('@electron/packager');
  console.log('packaging with electron', electronVersion());
  const outPaths = await packager({
    dir: stage, out: dist, platform: 'win32', arch: 'x64', electronVersion: electronVersion(), asar: false, overwrite: true, prune: false,
    name: 'CozyShelves', executableName: 'CozyShelves', appVersion: pkg.version, appCopyright: COPYRIGHT,
    ignore: [/\.git/],
  });
  const outDir = outPaths[0];
  console.log('packaged to', outDir);

  // icon + version info via resedit (pure JS, no wine needed)
  try {
    const resedit = require('resedit');
    const exePath = path.join(outDir, 'CozyShelves.exe');
    const exe = resedit.NtExecutable.from(fs.readFileSync(exePath));
    const res = resedit.NtExecutableResource.from(exe);
    const iconFile = resedit.Data.IconFile.from(fs.readFileSync(path.join(root, 'assets', 'icon.ico')));
    resedit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, iconFile.icons.map((i) => i.data));
    const vi = resedit.Resource.VersionInfo.fromEntries(res.entries)[0] || resedit.Resource.VersionInfo.createEmpty();
    const ver = pkg.version.split('.').map((n) => parseInt(n) || 0);
    vi.setFileVersion(ver[0], ver[1], ver[2], 0, 1033); vi.setProductVersion(ver[0], ver[1], ver[2], 0, 1033);
    vi.setStringValues({ lang: 1033, codepage: 1200 }, { ProductName: pkg.productName, FileDescription: `${pkg.productName}, a walkable 3D library`, CompanyName: 'Cozy Shelves contributors', LegalCopyright: COPYRIGHT, OriginalFilename: 'CozyShelves.exe', InternalName: 'CozyShelves' });
    vi.outputToResourceEntries(res.entries);
    res.outputResource(exe);
    fs.writeFileSync(exePath, Buffer.from(exe.generate()));
    console.log('icon & version info set');
  } catch (e) { console.warn('resedit failed (icon not set):', e.message); }

  // portable launcher note, the guides and the licenses next to the program (Electron's own LICENSE and
  // LICENSES.chromium.html are there already: the license of Cozy Shelves goes in as COPYING.txt) + zip
  fs.writeFileSync(path.join(outDir, 'START.txt'), [
    'Cozy Shelves starten: CozyShelves.exe doppelklicken. Anleitung: README.de.md',
    'Start Cozy Shelves: double-click CozyShelves.exe. Guide: README.md',
    '',
    'Cozy Shelves ist freie Software unter der GNU Affero General Public License, Version 3 oder neuer (COPYING.txt).',
    'Cozy Shelves is free software under the GNU Affero General Public License, version 3 or later (COPYING.txt).',
    'Third-party components: THIRD_PARTY_NOTICES.md, THIRD_PARTY_LICENSES.txt',
    ...SOURCE_NOTE,
    '',
  ].join('\r\n'));
  for (const f of ['README.md', 'README.de.md', 'THIRD_PARTY_NOTICES.md']) if (fs.existsSync(path.join(root, f))) fs.copyFileSync(path.join(root, f), path.join(outDir, f));
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(outDir, 'COPYING.txt'));
  fs.copyFileSync(path.join(stage, 'THIRD_PARTY_LICENSES.txt'), path.join(outDir, 'THIRD_PARTY_LICENSES.txt'));
  const finalDir = path.join(dist, 'CozyShelves-win64');
  fs.rmSync(finalDir, { recursive: true, force: true });
  fs.renameSync(outDir, finalDir);
  const zipName = `CozyShelves-${pkg.version}-win64-portable.zip`;
  fs.rmSync(path.join(dist, zipName), { force: true });
  // `zip` only exists on unix-likes; on Windows fall back to PowerShell's Compress-Archive
  if (process.platform === 'win32') {
    const psScript = path.join(dist, '_zip.ps1');
    fs.writeFileSync(psScript, `Compress-Archive -Path "${finalDir}" -DestinationPath "${path.join(dist, zipName)}" -CompressionLevel Optimal -Force\n`);
    execSync(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${psScript}"`, { stdio: 'inherit' });
    fs.rmSync(psScript, { force: true });
  } else {
    execSync(`cd "${dist}" && zip -q -r -9 "${zipName}" "CozyShelves-win64"`, { stdio: 'inherit' });
  }
  const size = fs.statSync(path.join(dist, zipName)).size;
  console.log('ZIP:', path.join(dist, zipName), (size / 1e6).toFixed(1), 'MB');
})().catch((e) => { console.error(e); process.exit(1); });
