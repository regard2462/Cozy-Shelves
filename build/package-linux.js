// Builds the Linux packages for x64:
//   dist/CozyShelves-linux-x64/                         the program folder
//   dist/CozyShelves-<version>-linux-x64.tar.gz         portable: unpack anywhere, start ./cozy-shelves
//   dist/cozy-shelves_<version>_amd64.deb                Debian, Ubuntu, Mint …: /opt/CozyShelves, menu entry, `cozy-shelves`
// Pure Node (tar, gzip and ar are written here), so it runs on Linux and on Windows alike; the file modes of the
// archives come from the rules below, not from the file system the package was built on.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { root, dist, pkg, COPYRIGHT, SOURCE_NOTE, makeStage, electronVersion } = require('./package-common');

// NAME: the program folder and the archives; TITLE: the name people see (menu entry, window class, which Electron takes
// from productName); BIN: the command, the menu entry's file, the icon and the Debian package
const NAME = 'CozyShelves', TITLE = pkg.productName, BIN = 'cozy-shelves';
const MAINTAINER = 'Cozy Shelves contributors <noreply@cozy-shelves.invalid>';
const MTIME = Math.floor(Number(process.env.SOURCE_DATE_EPOCH) || Date.now() / 1000);
// what the program needs from the system (Electron's libraries). The t64 names of Debian 13 / Ubuntu 24.04 come first:
// there the old names are only virtual, and apt took "libasound2" from liboss4-salsa-asound2 on a fresh Ubuntu 24.04,
// whose ALSA lacks snd_device_name_get_hint, so the program stopped at once ("symbol lookup error"). Older systems
// have no t64 package and take the second name.
const DEPENDS = ['libgtk-3-0t64 | libgtk-3-0', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils', 'libatspi2.0-0t64 | libatspi2.0-0',
  'libuuid1', 'libsecret-1-0', 'libgbm1', 'libasound2t64 | libasound2'];

// ------------------------------------------------------------------ tar ------
/** The mode of a file of the program folder (path relative to it, with /). */
function modeOf(rel, setuid = false) {
  if (rel === 'chrome-sandbox' && setuid) return 0o4755;   // in the .deb, where it belongs to root
  if (rel === BIN || rel === 'chrome_crashpad_handler' || /\.so(\.\d+)*$/.test(rel) || /\.sh$/.test(rel)) return 0o755;
  return 0o644;
}

function header(o) {
  const b = Buffer.alloc(512);
  const str = (s, off, len) => { const v = Buffer.from(s, 'utf8'); if (v.length > len) throw new Error('tar field too long: ' + s); v.copy(b, off); };
  const oct = (n, off, len) => str(n.toString(8).padStart(len - 1, '0'), off, len - 1);
  str(o.name, 0, 100);
  oct(o.mode & 0o7777, 100, 8); oct(o.uid || 0, 108, 8); oct(o.gid || 0, 116, 8);
  oct(o.size || 0, 124, 12); oct(o.mtime, 136, 12);
  b.fill(0x20, 148, 156);
  str(o.type, 156, 1);
  if (o.linkname) str(o.linkname, 157, 100);
  str('ustar\0', 257, 6); str('00', 263, 2);
  str(o.uname || 'root', 265, 32); str(o.gname || 'root', 297, 32);
  if (o.prefix) str(o.prefix, 345, 155);
  let sum = 0; for (let i = 0; i < 512; i++) sum += b[i];
  str(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return b;
}
const pad512 = (n) => (512 - (n % 512)) % 512;
/** A PAX record "<len> key=value\n" (the length counts itself). */
function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body);
  return `${len}${body}`;
}
/** The ustar name/prefix split of a path, or null when only a PAX header can hold it. */
function ustarName(p) {
  if (!/^[\x20-\x7e]*$/.test(p)) return null;
  if (p.length <= 100) return { name: p, prefix: '' };
  for (let i = p.indexOf('/'); i >= 0; i = p.indexOf('/', i + 1)) {
    if (i <= 155 && p.length - i - 1 <= 100 && p.length - i - 1 > 0) return { prefix: p.slice(0, i), name: p.slice(i + 1) };
  }
  return null;
}

class TarGz {
  constructor(file, { setuid = false } = {}) {
    this.setuid = setuid;
    this.out = fs.createWriteStream(file);
    this.gz = zlib.createGzip({ level: 9 });
    this.gz.pipe(this.out);
    this.done = new Promise((res, rej) => { this.out.on('finish', res); this.out.on('error', rej); this.gz.on('error', rej); });
  }
  async write(buf) { if (!this.gz.write(buf)) await new Promise((r) => this.gz.once('drain', r)); }
  async entry({ name, type = '0', mode = 0o644, size = 0, linkname = '' }) {
    const u = ustarName(name), l = !linkname || (/^[\x20-\x7e]*$/.test(linkname) && linkname.length <= 100);
    if (!u || !l) {
      const pax = Buffer.from((u ? '' : paxRecord('path', name)) + (l ? '' : paxRecord('linkpath', linkname)), 'utf8');
      await this.write(header({ name: 'PaxHeader/' + path.posix.basename(name).replace(/[^\x20-\x7e]/g, '_').slice(0, 80), type: 'x', mode: 0o644, size: pax.length, mtime: MTIME }));
      await this.write(Buffer.concat([pax, Buffer.alloc(pad512(pax.length))]));
    }
    const nm = u || { name: name.replace(/[^\x20-\x7e]/g, '_').slice(-100), prefix: '' };
    await this.write(header({ name: nm.name, prefix: nm.prefix, type, mode, size, linkname: l ? linkname : '', mtime: MTIME }));
  }
  async dir(name) { await this.entry({ name: name.endsWith('/') ? name : name + '/', type: '5', mode: 0o755 }); }
  async symlink(name, target) { await this.entry({ name, type: '2', mode: 0o777, linkname: target }); }
  async data(name, buf, mode = 0o644) {
    await this.entry({ name, mode, size: buf.length });
    await this.write(Buffer.concat([buf, Buffer.alloc(pad512(buf.length))]));
  }
  async file(name, src, mode) {
    const size = fs.statSync(src).size;
    await this.entry({ name, mode, size });
    const fd = fs.openSync(src, 'r'), chunk = Buffer.alloc(1 << 20);
    try { for (let pos = 0; pos < size;) { const n = fs.readSync(fd, chunk, 0, chunk.length, pos); if (!n) throw new Error('short read ' + src); await this.write(Buffer.from(chunk.subarray(0, n))); pos += n; } }
    finally { fs.closeSync(fd); }
    await this.write(Buffer.alloc(pad512(size)));
  }
  /** Every file of a folder (sorted), under `prefix`; returns the bytes it holds. */
  async tree(dir, prefix, rel = '') {
    let bytes = 0;
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { await this.dir(prefix + r); bytes += await this.tree(dir, prefix, r); }
      else if (e.isSymbolicLink()) await this.symlink(prefix + r, fs.readlinkSync(path.join(dir, r)));
      else { await this.file(prefix + r, path.join(dir, r), modeOf(r, this.setuid)); bytes += fs.statSync(path.join(dir, r)).size; }
    }
    return bytes;
  }
  async close() { await this.write(Buffer.alloc(1024)); this.gz.end(); await this.done; }
}

// ------------------------------------------------------------------ ar (.deb) ------
function arHeader(name, size) {
  const f = (s, len) => String(s).padEnd(len, ' ').slice(0, len);
  return Buffer.from(f(name, 16) + f(MTIME, 12) + f(0, 6) + f(0, 6) + f('100644', 8) + f(size, 10) + '`\n', 'latin1');
}
function writeAr(file, members) {
  const fd = fs.openSync(file, 'w');
  try {
    fs.writeSync(fd, Buffer.from('!<arch>\n', 'latin1'));
    for (const m of members) {
      const size = m.buf ? m.buf.length : fs.statSync(m.file).size;
      fs.writeSync(fd, arHeader(m.name, size));
      if (m.buf) fs.writeSync(fd, m.buf);
      else { const src = fs.openSync(m.file, 'r'), chunk = Buffer.alloc(1 << 20); try { for (let n; (n = fs.readSync(src, chunk, 0, chunk.length, null));) fs.writeSync(fd, chunk, 0, n); } finally { fs.closeSync(src); } }
      if (size % 2) fs.writeSync(fd, Buffer.from('\n'));
    }
  } finally { fs.closeSync(fd); }
}

// ------------------------------------------------------------------ texts ------
const desktopEntry = (exec, icon) => [
  '[Desktop Entry]',
  'Type=Application',
  `Name=${TITLE}`,
  'Comment=A walkable 3D library for the books on your own computer',
  'Comment[de]=Eine begehbare 3D-Bücherei für die Bücher auf deinem Rechner',
  `Exec=${exec} %U`,
  `Icon=${icon}`,
  'Terminal=false',
  'Categories=Office;Viewer;Education;',
  'Keywords=books;library;ebook;pdf;epub;audiobook;reader;',
  `StartupWMClass=${TITLE}`,
  '',
].join('\n');

const START = [
  'Cozy Shelves starten: im Programmordner ./cozy-shelves ausführen. Anleitung: README.de.md',
  'Start Cozy Shelves: run ./cozy-shelves in the program folder. Guide: README.md',
  '',
  'Eintrag im Anwendungsmenü / menu entry: ./install-desktop-entry.sh',
  '',
  'Bricht Cozy Shelves mit einer Meldung über "chrome-sandbox" ab, erlaubt das System keine Sandbox ohne Hilfsprogramm',
  '(Ubuntu ab 23.10). Dann im Programmordner einmal:',
  'If Cozy Shelves stops with a message about "chrome-sandbox", the system needs Chromium\'s sandbox helper',
  '(Ubuntu 23.10 and later). Run this once in the program folder:',
  '  sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox',
  'Das .deb-Paket erledigt das bei der Installation. / The .deb package does this when it is installed.',
  '',
  'Cozy Shelves ist freie Software unter der GNU General Public License, Version 3 oder neuer (COPYING.txt).',
  'Cozy Shelves is free software under the GNU General Public License, version 3 or later (COPYING.txt).',
  'Third-party components: THIRD_PARTY_NOTICES.md, THIRD_PARTY_LICENSES.txt',
  ...SOURCE_NOTE,
  '',
].join('\n');

// a menu entry for the portable folder, for the current user only
const INSTALL_ENTRY = `#!/bin/sh
# Adds Cozy Shelves to the application menu of the current user (~/.local/share/applications), pointing at this folder.
# Run it again after moving the folder. Remove the entry with: rm ~/.local/share/applications/cozy-shelves.desktop
set -e
here=$(cd "$(dirname "$0")" && pwd)
apps="\${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$apps"
sed -e "s|^Exec=.*|Exec=\\"$here/cozy-shelves\\" %U|" -e "s|^Icon=.*|Icon=$here/cozy-shelves.png|" "$here/cozy-shelves.desktop" > "$apps/cozy-shelves.desktop"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$apps" || true
echo "menu entry written: $apps/cozy-shelves.desktop"
`;

const POSTINST = `#!/bin/sh
set -e
# Chromium's sandbox helper must belong to root and carry the setuid bit where the system restricts user namespaces
# (Ubuntu 23.10 and later); dpkg keeps the bit from the package, this repeats it after an upgrade.
chmod 4755 /opt/${NAME}/chrome-sandbox || true
if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database -q /usr/share/applications || true; fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true; fi
exit 0
`;
const POSTRM = `#!/bin/sh
set -e
if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database -q /usr/share/applications || true; fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true; fi
exit 0
`;
const COPYRIGHT_FILE = `Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: ${TITLE}
Comment: The source archive comes with each release.

Files: *
Copyright: ${COPYRIGHT.replace(/, GPL.*$/, '')}
License: GPL-3.0-or-later
 The full text is in /opt/${NAME}/COPYING.txt and in /usr/share/common-licenses/GPL-3.
 Third-party components and their licenses: /opt/${NAME}/THIRD_PARTY_NOTICES.md and
 /opt/${NAME}/THIRD_PARTY_LICENSES.txt.
`;

// ------------------------------------------------------------------ build ------
// the writers are exported for build/test-package.js; the build runs when this file is the script
module.exports = { TarGz, header, paxRecord, ustarName, writeAr, arHeader, modeOf, desktopEntry, MTIME };
if (require.main === module) (async () => {
  const stage = makeStage();
  const { packager } = require('@electron/packager');
  console.log('packaging with electron', electronVersion(), 'for linux x64');
  const outPaths = await packager({
    dir: stage, out: dist, platform: 'linux', arch: 'x64', electronVersion: electronVersion(), asar: false, overwrite: true, prune: false,
    name: NAME, executableName: BIN, appVersion: pkg.version, appCopyright: COPYRIGHT,
    ignore: [/\.git/],
  });
  const outDir = outPaths[0];
  const finalDir = path.join(dist, `${NAME}-linux-x64`);
  if (path.resolve(outDir) !== path.resolve(finalDir)) { fs.rmSync(finalDir, { recursive: true, force: true }); fs.renameSync(outDir, finalDir); }
  console.log('packaged to', finalDir);

  // the guides, licenses, icon and menu entry next to the program
  fs.writeFileSync(path.join(finalDir, 'START.txt'), START);
  for (const f of ['README.md', 'README.de.md', 'THIRD_PARTY_NOTICES.md']) fs.copyFileSync(path.join(root, f), path.join(finalDir, f));
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(finalDir, 'COPYING.txt'));
  fs.copyFileSync(path.join(stage, 'THIRD_PARTY_LICENSES.txt'), path.join(finalDir, 'THIRD_PARTY_LICENSES.txt'));
  fs.copyFileSync(path.join(root, 'assets', 'icon-512.png'), path.join(finalDir, 'cozy-shelves.png'));
  fs.writeFileSync(path.join(finalDir, 'cozy-shelves.desktop'), desktopEntry(BIN, BIN));
  fs.writeFileSync(path.join(finalDir, 'install-desktop-entry.sh'), INSTALL_ENTRY);
  if (process.platform !== 'win32') for (const f of fs.readdirSync(finalDir)) { const m = modeOf(f); if (m !== 0o644) fs.chmodSync(path.join(finalDir, f), m & 0o777); }

  // portable archive
  const tarName = `${NAME}-${pkg.version}-linux-x64.tar.gz`, top = `${NAME}-${pkg.version}-linux-x64/`;
  const tgz = new TarGz(path.join(dist, tarName));
  await tgz.dir(top);
  await tgz.tree(finalDir, top);
  await tgz.close();
  console.log('TAR:', path.join(dist, tarName), (fs.statSync(path.join(dist, tarName)).size / 1e6).toFixed(1), 'MB');

  // Debian package
  const debName = `${BIN}_${pkg.version}_amd64.deb`;
  const dataFile = path.join(dist, '_data.tar.gz'), controlFile = path.join(dist, '_control.tar.gz');
  const data = new TarGz(dataFile, { setuid: true });
  for (const d of ['./', './opt/', `./opt/${NAME}/`]) await data.dir(d);
  let bytes = await data.tree(finalDir, `./opt/${NAME}/`);
  for (const d of ['./usr/', './usr/bin/', './usr/share/', './usr/share/applications/', './usr/share/icons/', './usr/share/icons/hicolor/',
    './usr/share/icons/hicolor/256x256/', './usr/share/icons/hicolor/256x256/apps/', './usr/share/icons/hicolor/512x512/', './usr/share/icons/hicolor/512x512/apps/',
    './usr/share/doc/', `./usr/share/doc/${BIN}/`]) await data.dir(d);
  await data.symlink(`./usr/bin/${BIN}`, `/opt/${NAME}/${BIN}`);
  const desktop = Buffer.from(desktopEntry(BIN, BIN));
  await data.data(`./usr/share/applications/${BIN}.desktop`, desktop);
  await data.file(`./usr/share/icons/hicolor/256x256/apps/${BIN}.png`, path.join(root, 'assets', 'icon.png'), 0o644);
  await data.file(`./usr/share/icons/hicolor/512x512/apps/${BIN}.png`, path.join(root, 'assets', 'icon-512.png'), 0o644);
  await data.data(`./usr/share/doc/${BIN}/copyright`, Buffer.from(COPYRIGHT_FILE));
  bytes += desktop.length + fs.statSync(path.join(root, 'assets', 'icon.png')).size + fs.statSync(path.join(root, 'assets', 'icon-512.png')).size;
  await data.close();

  const control = [
    `Package: ${BIN}`,
    `Version: ${pkg.version}`,
    'Section: misc',
    'Priority: optional',
    'Architecture: amd64',
    `Installed-Size: ${Math.ceil(bytes / 1024)}`,
    `Depends: ${DEPENDS.join(', ')}`,
    `Maintainer: ${MAINTAINER}`,
    'Description: walkable 3D library for the books on your own computer',
    ' Cozy Shelves puts the books and audiobooks on your computer on shelves in a',
    ' 3D library you can walk through, with a reader for PDF and EPUB, a garden,',
    ' a cinema for the public broadcasters\' media libraries, newspapers and podcasts.',
    '',
  ].join('\n');
  const ctl = new TarGz(controlFile);
  await ctl.dir('./');
  await ctl.data('./control', Buffer.from(control));
  await ctl.data('./postinst', Buffer.from(POSTINST), 0o755);
  await ctl.data('./postrm', Buffer.from(POSTRM), 0o755);
  await ctl.close();

  writeAr(path.join(dist, debName), [
    { name: 'debian-binary', buf: Buffer.from('2.0\n') },
    { name: 'control.tar.gz', file: controlFile },
    { name: 'data.tar.gz', file: dataFile },
  ]);
  fs.rmSync(dataFile, { force: true }); fs.rmSync(controlFile, { force: true });
  console.log('DEB:', path.join(dist, debName), (fs.statSync(path.join(dist, debName)).size / 1e6).toFixed(1), 'MB');
})().catch((e) => { console.error(e); process.exit(1); });
