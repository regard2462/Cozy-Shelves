// Tests of the packaging scripts that run without a build: the tar and ar writers of the Linux package
// (build/package-linux.js) read back with a small reader of this file, and the staging helpers of build/package-common.js.
// Run: node build/test-package.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { TarGz, header, paxRecord, ustarName, writeAr, modeOf, desktopEntry, MTIME } = require('./package-linux');
const { copyDocs, root } = require('./package-common');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) { failed++; console.log('  FAIL', name, '\n', e); }
}

/** A tar archive → [{ name, type, mode, size, linkname, data }], PAX path and linkpath records applied. */
function readTar(buf) {
  const out = [];
  let pax = {};
  for (let off = 0; off + 512 <= buf.length;) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, n) => h.toString('utf8', a, a + n).replace(/\0.*$/s, '');
    const oct = (a, n) => parseInt(str(a, n).trim() || '0', 8);
    // the checksum: the sum of the header bytes with the checksum field read as spaces
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
    assert.strictEqual(oct(148, 8), sum, 'checksum of ' + str(0, 100));
    assert.strictEqual(str(257, 6), 'ustar', 'magic');
    const size = oct(124, 12), type = str(156, 1) || '0';
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      for (const m of data.toString('utf8').matchAll(/(\d+) ([^=]+)=([^\n]*)\n/g)) { assert.strictEqual(Buffer.byteLength(m[0]), +m[1], 'PAX record length'); pax[m[2]] = m[3]; }
      continue;
    }
    const prefix = str(345, 155);
    const name = pax.path ?? (prefix ? prefix + '/' + str(0, 100) : str(0, 100));
    out.push({ name, type, mode: oct(100, 8), size, mtime: oct(136, 12), uid: oct(108, 8), uname: str(265, 32), linkname: pax.linkpath ?? str(157, 100), data });
    pax = {};
  }
  return out;
}

(async () => {
  console.log('package-common');
  await test('copyDocs copies the files of docs/ and leaves its folders (docs/strands) out', () => {
    const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'cozy-shelves-docs-'));
    try {
      copyDocs(dst);
      const names = fs.readdirSync(dst, { withFileTypes: true });
      assert(names.some((e) => e.name === 'CONTRACTS.md'), 'CONTRACTS.md missing');
      assert(names.every((e) => e.isFile()), 'a folder was copied: ' + names.filter((e) => !e.isFile()).map((e) => e.name));
      const files = fs.readdirSync(path.join(root, 'docs'), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
      assert.deepStrictEqual(names.map((e) => e.name).sort(), files);
    } finally { fs.rmSync(dst, { recursive: true, force: true }); }
  });

  console.log('package-linux: tar');
  await test('ustar names: a short path, a split at a slash, none for a long single name or non-ASCII', () => {
    assert.deepStrictEqual(ustarName('opt/CozyShelves/cozy-shelves'), { name: 'opt/CozyShelves/cozy-shelves', prefix: '' });
    const long = 'opt/CozyShelves/resources/app/node_modules/some-package/' + 'f'.repeat(90) + '.js';
    const u = ustarName(long);
    assert(u && u.prefix.length <= 155 && u.name.length <= 100 && u.prefix + '/' + u.name === long, JSON.stringify(u));
    assert.strictEqual(ustarName('x'.repeat(120)), null);
    assert.strictEqual(ustarName('opt/Bücher.txt'), null);
    assert.strictEqual(paxRecord('path', 'a'), '9 path=a\n');
    assert.strictEqual(paxRecord('path', 'a'.repeat(120)).length, 130);
  });
  await test('modes: the program, the crash handler, shared libraries and shell scripts 755, chrome-sandbox 4755 in the .deb, the rest 644', () => {
    assert.strictEqual(modeOf('cozy-shelves'), 0o755);
    assert.strictEqual(modeOf('chrome_crashpad_handler'), 0o755);
    assert.strictEqual(modeOf('libffmpeg.so'), 0o755);
    assert.strictEqual(modeOf('libvk_swiftshader.so.1'), 0o755);
    assert.strictEqual(modeOf('install-desktop-entry.sh'), 0o755);
    assert.strictEqual(modeOf('chrome-sandbox'), 0o644, 'the portable archive leaves the sandbox helper a plain file (START.txt tells how to set it up)');
    assert.strictEqual(modeOf('chrome-sandbox', true), 0o4755);
    assert.strictEqual(modeOf('resources/app/package.json'), 0o644);
    assert.strictEqual(modeOf('README.md'), 0o644);
    const h = header({ name: 'x', mode: 0o4755, size: 0, mtime: MTIME, type: '0' });
    assert.strictEqual(h.toString('latin1', 100, 107), '0004755');
  });
  await test('a tree becomes a tar.gz that reads back: long and non-ASCII names, modes, a symlink, big files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cozy-shelves-tar-'));
    const tree = path.join(dir, 'tree');
    const deep = path.join(tree, 'resources', 'app', 'node_modules', 'a-package-with-a-rather-long-name-that-goes-on-and-on-and-on-and-on-and-on-and-on-and-on-and-on-and-on');
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, 'index-with-a-long-file-name-so-that-the-path-exceeds-the-ustar-limits-by-far.js'), 'module.exports = 1;');
    fs.writeFileSync(path.join(tree, 'Bücher-Übersicht.txt'), 'umlaut');
    fs.writeFileSync(path.join(tree, 'chrome-sandbox'), 'sb');
    fs.writeFileSync(path.join(tree, 'cozy-shelves'), 'bin');
    fs.writeFileSync(path.join(tree, 'empty'), '');
    const big = Buffer.alloc(2 * 1024 * 1024 + 123);
    for (let i = 0; i < big.length; i++) big[i] = i % 253;
    fs.writeFileSync(path.join(tree, 'big.bin'), big);
    const file = path.join(dir, 'out.tar.gz');
    try {
      const tgz = new TarGz(file, { setuid: true });
      await tgz.dir('./');
      await tgz.dir('./opt/');
      await tgz.dir('./opt/CozyShelves/');
      const bytes = await tgz.tree(tree, './opt/CozyShelves/');
      await tgz.symlink('./usr/bin/cozy-shelves', '/opt/CozyShelves/cozy-shelves');
      await tgz.data('./usr/share/applications/cozy-shelves.desktop', Buffer.from(desktopEntry('cozy-shelves', 'cozy-shelves')), 0o644);
      await tgz.close();
      assert.strictEqual(bytes, big.length + 19 + 6 + 2 + 3, 'the bytes of the tree');
      const entries = readTar(zlib.gunzipSync(fs.readFileSync(file)));
      const by = Object.fromEntries(entries.map((e) => [e.name, e]));
      assert.deepStrictEqual(entries.slice(0, 3).map((e) => [e.name, e.type, e.mode]), [['./', '5', 0o755], ['./opt/', '5', 0o755], ['./opt/CozyShelves/', '5', 0o755]]);
      const long = './opt/CozyShelves/resources/app/node_modules/' + path.basename(deep) + '/index-with-a-long-file-name-so-that-the-path-exceeds-the-ustar-limits-by-far.js';
      assert(by[long], 'the long path (PAX) is missing: ' + Object.keys(by).join(' | '));
      assert.strictEqual(by[long].data.toString(), 'module.exports = 1;');
      assert.strictEqual(by['./opt/CozyShelves/Bücher-Übersicht.txt'].data.toString(), 'umlaut', 'the non-ASCII name (PAX)');
      assert.strictEqual(by['./opt/CozyShelves/chrome-sandbox'].mode, 0o4755);
      assert.strictEqual(by['./opt/CozyShelves/cozy-shelves'].mode, 0o755);
      assert.strictEqual(by['./opt/CozyShelves/empty'].mode, 0o644);
      assert.strictEqual(by['./opt/CozyShelves/empty'].size, 0);
      assert(by['./opt/CozyShelves/big.bin'].data.equals(big), 'the big file is not byte-identical');
      const link = by['./usr/bin/cozy-shelves'];
      assert.strictEqual(link.type, '2'); assert.strictEqual(link.linkname, '/opt/CozyShelves/cozy-shelves'); assert.strictEqual(link.size, 0);
      assert(/^\[Desktop Entry\]\n/.test(by['./usr/share/applications/cozy-shelves.desktop'].data.toString()));
      for (const e of entries) { assert.strictEqual(e.uid, 0, 'root owns ' + e.name); assert.strictEqual(e.uname, 'root'); assert.strictEqual(e.mtime, MTIME); }
      // every entry of the tree is there (sorted, folders before their files)
      const names = entries.map((e) => e.name);
      assert(names.indexOf('./opt/CozyShelves/resources/') < names.indexOf(long));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  console.log('package-linux: ar (.deb) and the menu entry');
  await test('the ar archive holds debian-binary, control and data in this order, members padded to even sizes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cozy-shelves-ar-'));
    try {
      const data = path.join(dir, 'data.tar.gz');
      fs.writeFileSync(data, Buffer.alloc(1001, 7));
      const deb = path.join(dir, 'x.deb');
      writeAr(deb, [{ name: 'debian-binary', buf: Buffer.from('2.0\n') }, { name: 'control.tar.gz', buf: Buffer.from('ctl') }, { name: 'data.tar.gz', file: data }]);
      const b = fs.readFileSync(deb);
      assert.strictEqual(b.toString('latin1', 0, 8), '!<arch>\n');
      const members = [];
      for (let off = 8; off < b.length;) {
        const h = b.toString('latin1', off, off + 60);
        assert.strictEqual(h.slice(58, 60), '`\n', 'member header end at ' + off);
        const size = parseInt(h.slice(48, 58).trim(), 10);
        members.push({ name: h.slice(0, 16).trim(), size, mode: h.slice(40, 48).trim(), mtime: h.slice(16, 28).trim(), body: b.subarray(off + 60, off + 60 + size) });
        off += 60 + size + (size % 2);
      }
      assert.deepStrictEqual(members.map((m) => [m.name, m.size]), [['debian-binary', 4], ['control.tar.gz', 3], ['data.tar.gz', 1001]]);
      assert(members.every((m) => m.mode === '100644' && m.mtime === String(MTIME)));
      assert(members[2].body.every((x) => x === 7), 'the data member');
      assert.strictEqual(b.length, 8 + (60 + 4) + (60 + 3 + 1) + (60 + 1001 + 1), 'odd members are padded with one byte');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  await test('the desktop entry names the command, the icon and the window class', () => {
    const e = desktopEntry('cozy-shelves', 'cozy-shelves');
    assert(/^Exec=cozy-shelves %U$/m.test(e) && /^Icon=cozy-shelves$/m.test(e) && /^StartupWMClass=Cozy Shelves$/m.test(e) && /^Type=Application$/m.test(e), e);
    assert(e.endsWith('\n'));
  });

  console.log(`PACKAGE ${passed}/${passed + failed} passed`);
  process.exit(failed ? 1 : 0);
})();
