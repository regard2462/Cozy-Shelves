// The third-party components that ship with Cozy Shelves and their licenses: every npm package bundled into app/dist
// (found through the source maps of the bundle, so run `npm run build` first), the files build/vendor.js copies into
// app/vendor, the main process's runtime packages (build/package-win.js installs them into the package) and the code
// kept in vendor-src/. For each: name, version, license, source and the text of its license file.
//   node build/third-party.js                 one line per component and a count per license
//   node build/third-party.js --md            the table of npm packages for THIRD_PARTY_NOTICES.md
//   node build/third-party.js --text <file>   all license texts in one file (build/package-win.js puts it into the package)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const NM = path.join(root, 'node_modules');

/** The packages the main process needs at run time (build/package-win.js installs them, with their dependencies). */
const RUNTIME_DEPS = ['@mozilla/readability', 'chokidar', 'jsdom', 'jszip', 'mammoth', 'marked', 'rss-parser'];
/** Packages whose files build/vendor.js copies into app/vendor (fonts, chess pieces, engine, voices, WebAssembly). */
const VENDOR_COPIES = {
  '@fontsource/eb-garamond': 'font files', '@fontsource/cormorant-garamond': 'font files', '@fontsource/caveat': 'font files',
  '@fontsource/vt323': 'font files', '@fontsource/playfair-display': 'font files',
  chessground: 'board styles and the cburnett chess pieces (Colin M.L. Burnett, GPL-2.0-or-later)',
  leaflet: 'its stylesheet (the world map)',
  stockfish: 'Stockfish 18 lite, single-threaded (JavaScript and WebAssembly)',
  'kokoro-js': 'kokoro.web.js (with Transformers.js, phonemizer and eSpeak NG data) and the voice style vectors',
  'onnxruntime-web': 'WebAssembly runtime', 'onnxruntime-web-webgpu': 'WebAssembly runtime (WebGPU build)',
  '@diffusionstudio/piper-wasm': 'piper-phonemize with eSpeak NG as WebAssembly and the German eSpeak NG data (GPL-3.0-or-later)',
};
/** Code that is not on npm, or is contained in another package's files. */
const OTHER = [
  { name: 'foliate-js', version: 'vendor-src', license: 'MIT', source: 'https://github.com/johnfactotum/foliate-js', where: 'vendor-src/foliate-js', file: 'vendor-src/foliate-js/LICENSE' },
  { name: 'PDF.js', version: '5.5.207', license: 'Apache-2.0', source: 'https://github.com/mozilla/pdf.js', where: 'vendor-src/foliate-js/vendor/pdfjs', file: 'vendor-src/foliate-js/vendor/pdfjs/pdf.mjs', head: 15 },
  { name: 'Adobe CMaps (in PDF.js)', version: '', license: 'BSD-3-Clause', source: 'https://github.com/adobe-type-tools/cmap-resources', where: 'vendor-src/foliate-js/vendor/pdfjs/cmaps', file: 'vendor-src/foliate-js/vendor/pdfjs/cmaps/LICENSE' },
  { name: 'Foxit fonts (PDF.js standard fonts, from PDFium)', version: '', license: 'BSD-3-Clause', source: 'https://pdfium.googlesource.com/pdfium/', where: 'vendor-src/foliate-js/vendor/pdfjs/standard_fonts', file: 'vendor-src/foliate-js/vendor/pdfjs/standard_fonts/LICENSE_FOXIT' },
  { name: 'Liberation Sans (PDF.js standard fonts)', version: '', license: 'OFL-1.1', source: 'https://github.com/liberationfonts/liberation-fonts', where: 'vendor-src/foliate-js/vendor/pdfjs/standard_fonts', file: 'vendor-src/foliate-js/vendor/pdfjs/standard_fonts/LICENSE_LIBERATION' },
  { name: 'fflate (in foliate-js)', version: '', license: 'MIT', source: 'https://github.com/101arrowz/fflate', where: 'vendor-src/foliate-js/vendor/fflate.js', file: 'vendor-src/foliate-js/vendor/LICENSE-fflate.txt' },
  { name: 'zip.js (in foliate-js)', version: '', license: 'BSD-3-Clause', source: 'https://github.com/gildas-lormeau/zip.js', where: 'vendor-src/foliate-js/vendor/zip.js', file: 'vendor-src/foliate-js/vendor/LICENSE-zipjs.txt' },
  { name: 'Twemoji Country Flags', version: '', license: 'CC-BY-4.0 (graphics), Apache-2.0 / MIT (font)', source: 'https://github.com/talkjs/country-flag-emoji-polyfill', where: 'app/data/worldmap/TwemojiCountryFlags.woff2',
    text: 'The flag graphics are Twemoji, Copyright 2019 Twitter, Inc. and other contributors, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).\nThe font is a subset of Twemoji Mozilla (https://github.com/mozilla/twemoji-colr, code Apache-2.0, Copyright 2016-2018 Mozilla Foundation) made by TalkJS for country-flag-emoji-polyfill (MIT).\n' },
  { name: 'Natural Earth', version: '5.1', license: 'Public domain', source: 'https://www.naturalearthdata.com', where: 'app/data/worldmap (the world map\'s atlas and profiles)', text: 'Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com. Natural Earth data is in the public domain.\n' },
  { name: 'Wikidata', version: '', license: 'CC0-1.0', source: 'https://www.wikidata.org', where: 'app/data/worldmap (languages, currencies, areas, city populations)', text: 'Data from Wikidata, available under the Creative Commons CC0 1.0 Universal Public Domain Dedication.\n' },
  // the reading fonts of the reader, copied from Fontsource 5.3.0 into app/data/fonts (not an npm dependency)
  { name: 'Literata (Fontsource)', version: '5.3.0', license: 'OFL-1.1', source: 'https://github.com/googlefonts/literata', where: 'app/data/fonts/literata (reading font)', file: 'app/data/fonts/literata/OFL.txt' },
  { name: 'Source Serif 4 (Fontsource)', version: '5.3.0', license: 'OFL-1.1', source: 'https://github.com/adobe-fonts/source-serif', where: 'app/data/fonts/source-serif-4 (reading font)', file: 'app/data/fonts/source-serif-4/OFL.txt' },
  { name: 'Atkinson Hyperlegible Next (Fontsource)', version: '5.3.0', license: 'OFL-1.1', source: 'https://github.com/googlefonts/atkinson-hyperlegible-next', where: 'app/data/fonts/atkinson-hyperlegible-next (reading font)', file: 'app/data/fonts/atkinson-hyperlegible-next/OFL.txt' },
  { name: 'SQLite (in the Node.js of Electron, node:sqlite)', version: '', license: 'Public domain', source: 'https://sqlite.org', where: 'index of the full-text search (electron/search)', text: 'SQLite is in the public domain (https://sqlite.org/copyright.html). Cozy Shelves uses the copy built into the Node.js runtime of Electron through node:sqlite, with FTS5.\n' },
];

/** The standard texts of the short licenses (for the packages without a license file of their own). */
const STANDARD = {
  MIT: 'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
  ISC: 'Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.',
  'BSD-2-Clause': 'Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:\n\n1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.\n\n2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.\n\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.',
};

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const licenseOf = (pkg) => (typeof pkg.license === 'string' ? pkg.license : pkg.license?.type || (Array.isArray(pkg.licenses) ? pkg.licenses.map((l) => l.type || l).join(' OR ') : '') || 'UNKNOWN');
const sourceOf = (pkg) => {
  let u = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || pkg.homepage || '';
  u = u.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/^(ssh:\/\/)?git@github\.com[:/]/, 'https://github.com/').replace(/\.git$/, '');
  if (/^[\w-]+\/[\w.-]+$/.test(u)) u = 'https://github.com/' + u;
  return u;
};
const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)([._-].*)?$/i;
function licenseText(dir) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => LICENSE_FILE.test(n) && fs.statSync(path.join(dir, n)).isFile()); } catch {}
  return names.sort().map((n) => fs.readFileSync(path.join(dir, n), 'utf8').trim()).join('\n\n');
}

/** A package without a license file: its copyright holder and the license it names (the text is at the end). */
function fallbackText(pkg) {
  const who = (typeof pkg.author === 'string' ? pkg.author : pkg.author?.name || (/^onnxruntime/.test(pkg.name) ? 'Microsoft Corporation' : '')).replace(/\s*[<(].*$/, '');
  return `${who ? `Copyright (c) ${who}\n` : ''}Licensed under ${licenseOf(pkg)}; the package carries no license file of its own. The standard text of this license is printed at the end of this file.`;
}

/** The package directory of a file inside node_modules (the last node_modules segment wins: nested installs). */
function packageDirOf(file) {
  const parts = path.normalize(file).split(path.sep);
  const i = parts.lastIndexOf('node_modules');
  if (i < 0 || i + 1 >= parts.length) return null;
  const n = parts[i + 1].startsWith('@') ? 2 : 1;
  return parts.slice(0, i + 1 + n).join(path.sep);
}

/** @param runtimeFrom the folder whose node_modules hold the main process's packages: the repository, or the package
 *  being built (build/package-win.js installs them there)
 *  @param bundled the input files of the browser version's bundle (build/web.js), read in place of app/dist; the
 *  browser version has no main process, so its packages are left out then */
function collect({ runtimeFrom = root, bundled = null } = {}) {
  const found = new Map();      // real package dir → { dir, pkg, where: Set }
  // one entry per package, however its path was reached (node_modules may be a link to another folder)
  const realOf = (dir) => { try { return fs.realpathSync(dir); } catch { return dir; } };
  const add = (dir, where) => {
    const pkg = readJson(path.join(dir, 'package.json'));
    if (!pkg || !pkg.name) return null;
    const real = realOf(dir);
    let e = found.get(real);
    if (!e) found.set(real, e = { dir, pkg, where: new Set() });
    e.where.add(where);
    return e;
  };
  // 1. bundled into app/dist: the sources of every source map (the browser version: the inputs of its bundle)
  if (bundled) {
    for (const f of bundled) {
      const dir = packageDirOf(path.resolve(root, f));
      if (dir && fs.existsSync(path.join(dir, 'package.json'))) add(dir, 'bundled into the browser version');
    }
  } else {
    const dist = path.join(root, 'app', 'dist');
    if (!fs.existsSync(dist)) throw new Error('app/dist is missing: run `npm run build` first');
    for (const f of fs.readdirSync(dist)) {
      if (!f.endsWith('.map')) continue;
      const map = readJson(path.join(dist, f));
      for (const s of map?.sources || []) {
        const dir = packageDirOf(path.resolve(dist, s));
        if (dir && fs.existsSync(path.join(dir, 'package.json'))) add(dir, 'bundled into app/dist');
      }
    }
  }
  // 2. copied into app/vendor
  for (const [name, what] of Object.entries(VENDOR_COPIES)) {
    const dir = path.join(NM, ...name.split('/'));
    if (fs.existsSync(dir)) add(dir, 'app/vendor: ' + what);
  }
  // 3. the main process's packages and everything they depend on (node resolution from the requiring package)
  const resolve = (name, from) => {
    for (let d = from; ; d = path.dirname(d)) {
      const p = path.join(d, 'node_modules', ...name.split('/'));
      if (fs.existsSync(path.join(p, 'package.json'))) return p;
      if (path.dirname(d) === d) return null;
    }
  };
  const visit = (name, from) => {
    const dir = resolve(name, from);
    if (!dir) return;
    const had = found.get(realOf(dir))?.where.has('main process (installed into the package)');
    const e = add(dir, 'main process (installed into the package)');
    if (!e || had) return;
    for (const dep of Object.keys(e.pkg.dependencies || {})) visit(dep, dir);
  };
  if (!bundled) for (const name of RUNTIME_DEPS) visit(name, runtimeFrom);
  const npm = [...found.values()].map((e) => ({
    name: e.pkg.name, version: e.pkg.version || '', license: licenseOf(e.pkg), source: sourceOf(e.pkg), where: [...e.where].join('; '),
    text: licenseText(e.dir) || fallbackText(e.pkg), dir: e.dir,
  })).sort((a, b) => a.name.localeCompare(b.name) || String(a.version).localeCompare(String(b.version)));
  const other = OTHER.map((o) => {
    let text = o.text || '';
    if (o.file) { const t = fs.readFileSync(path.join(root, o.file), 'utf8'); text = o.head ? t.split('\n').slice(0, o.head).join('\n') : t; }
    return { ...o, text: text.trim() };
  });
  return { npm, other };
}

function markdown({ npm }) {
  const cell = (s) => String(s || '').replace(/\|/g, '\\|');
  const rows = npm.map((p) => `| ${cell(p.name)} | ${cell(p.version)} | ${cell(p.license)} | ${cell(p.where)} | ${p.source ? `<${p.source}>` : ''} |`);
  return ['| Package | Version | License | Where | Source |', '|---|---|---|---|---|', ...rows].join('\n') + '\n';
}

function fullText({ npm, other }) {
  const line = '-'.repeat(78);
  const out = [
    'Cozy Shelves: licenses of the third-party components',
    '='.repeat(48), '',
    'Cozy Shelves itself is licensed under the GNU Affero General Public License, version 3 or (at your option) any later version',
    '(LICENSE in the source code, COPYING.txt in the packages; a LICENSE file next to the program is Electron\'s). Its text',
    'is also at the end of this file. The components below keep their own licenses. THIRD_PARTY_NOTICES.md describes them',
    'and the data and voice models that are downloaded at run time.', '',
  ];
  for (const c of [...npm, ...other]) {
    out.push(line, `${c.name}${c.version ? ' ' + c.version : ''}`, `License: ${c.license}`, `Source: ${c.source || 'n/a'}`, `In Cozy Shelves: ${c.where}`, '');
    out.push(c.text || `(The package carries no license file; its package.json names the license "${c.license}".)`, '');
  }
  // the standard texts the entries above refer to
  out.push('='.repeat(78), 'Standard license texts', '='.repeat(78), '');
  for (const [id, text] of Object.entries(STANDARD)) out.push(line, id, '', text, '');
  const apache = path.join(NM, '@mozilla', 'readability', 'LICENSE.md');
  if (fs.existsSync(apache)) out.push(line, 'Apache-2.0', '', fs.readFileSync(apache, 'utf8').trim(), '');
  out.push(line, 'GPL-3.0 (chessground, Stockfish, eSpeak NG)', '', fs.readFileSync(path.join(root, 'licenses', 'GPL-3.0.txt'), 'utf8').trim(), '');
  out.push(line, 'AGPL-3.0 (the license of Cozy Shelves)', '', fs.readFileSync(path.join(root, 'LICENSE'), 'utf8').trim(), '');
  return out.join('\n');
}

if (require.main === module) {
  const data = collect();
  const arg = process.argv[2];
  if (arg === '--md') process.stdout.write(markdown(data));
  else if (arg === '--text') {
    const file = process.argv[3] || path.join(root, 'dist', 'THIRD_PARTY_LICENSES.txt');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, fullText(data));
    console.log(`${data.npm.length + data.other.length} components, ${file}`);
  } else {
    for (const c of [...data.npm, ...data.other]) console.log(`${c.name} ${c.version} | ${c.license} | ${c.where}${c.text ? '' : ' | NO LICENSE TEXT'}`);
    const count = {};
    for (const c of [...data.npm, ...data.other]) count[c.license] = (count[c.license] || 0) + 1;
    console.log(JSON.stringify(count));
  }
}

module.exports = { RUNTIME_DEPS, collect, markdown, fullText };
