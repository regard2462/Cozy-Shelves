// The project is published: nothing in it may point to a person. This check fails on the home folders of concrete
// users (C:\Users\<name>, /home/<name>) and on the names, account names, e-mail addresses and private folder names of
// a forbidden list. That list stays on the developer's computer: a list in the repository would tell anyone who tries
// common first names which one is on it, even as hashes. It lives in .privacy-words.json next to package.json (ignored
// by git) or in the file PRIVACY_WORDS names: { "salt": "<a secret of your own>", "forbidden": [hashes],
// "allowedPairs": [hashes] }. Without it only the home folders are checked.
// It reads every file git would publish (tracked or new, not ignored; without git: the working tree minus the build
// output), in text files the words and pairs of words, in binary files the text of PDF and EPUB/ZIP containers,
// PNG text chunks, the name table of WOFF2 fonts and the plain strings.
//   node build/privacy-check.js                 exit code 1 when something is found
//   node build/privacy-check.js --hash <words>  the hash of a word or a two-word phrase for the list, with its salt
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const LIST_FILE = process.env.PRIVACY_WORDS || path.join(root, '.privacy-words.json');
const LIST = (() => { try { return JSON.parse(fs.readFileSync(LIST_FILE, 'utf8')); } catch { return null; } })();
const SALT = LIST?.salt || 'privacy-self-test';
const hash = (s) => crypto.createHash('sha256').update(SALT + ':' + s).digest('hex').slice(0, 20);

// words and two-word phrases (lower case; umlauts are also checked as ae, oe, ue, ss)
const FORBIDDEN = new Set(LIST?.forbidden || []);
// pairs that are allowed although their first word is on the list (the full name of a public person, say)
const ALLOWED_PAIRS = new Set(LIST?.allowedPairs || []);
// placeholders and virtual homes that may stand in a home folder path ('web_user': the home of Emscripten's virtual file system)
const PLACEHOLDER_HOMES = new Set(['<name>', '<user>', '<benutzer>', '%username%', 'username', 'name', 'x', 'you', 'user', 'public', 'default', 'all users', 'web_user', '...', '…', '*']);

const SKIP_DIRS = new Set(['.git', '.privacy-words.json', 'node_modules', 'dist', 'shots', '__pycache__', 'venv']);
const SKIP_PATHS = ['app/dist/', 'app/vendor/', 'tts-server/venv/'];
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.markdown', '.txt', '.html', '.htm', '.xhtml', '.css', '.py', '.ps1', '.bat', '.cmd', '.sh',
  '.xml', '.svg', '.opf', '.ncx', '.csv', '.m3u8', '.vtt', '.glsl', '.vert', '.frag', '.wgsl', '.yml', '.yaml', '.toml', '.ini', '.gitignore', '.editorconfig', '.lock']);

// ------------------------------------------------------------------ files ------
function listFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\0').filter(Boolean).filter((f) => fs.existsSync(path.join(root, f)) && fs.statSync(path.join(root, f)).isFile());
  } catch {
    const files = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(e.name)) continue;
        const p = path.join(dir, e.name), rel = path.relative(root, p).split(path.sep).join('/');
        if (SKIP_PATHS.some((s) => (rel + '/').startsWith(s))) continue;
        if (e.isDirectory()) walk(p); else if (e.isFile()) files.push(rel);
      }
    };
    walk(root);
    return files;
  }
}

// ------------------------------------------------------------------ text out of binaries ------
/** Printable runs of ASCII/Latin-1 and of UTF-16 (both byte orders), four characters and longer. */
function strings(buf) {
  const out = [];
  let run = '';
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if ((c >= 0x20 && c < 0x7f) || c >= 0xc0) run += String.fromCharCode(c); else { if (run.length >= 4) out.push(run); run = ''; }
  }
  if (run.length >= 4) out.push(run);
  for (const le of [true, false]) {
    run = '';
    for (let i = 0; i + 1 < buf.length; i += 2) {
      const code = le ? buf[i] | (buf[i + 1] << 8) : (buf[i] << 8) | buf[i + 1];
      if ((code >= 0x20 && code < 0x7f) || (code >= 0xc0 && code < 0x250)) run += String.fromCharCode(code); else { if (run.length >= 4) out.push(run); run = ''; }
    }
    if (run.length >= 4) out.push(run);
  }
  return out.join('\n');
}
/** The entries of a ZIP container (EPUB, CBZ, DOCX …) by their local headers. */
function zipEntries(buf) {
  const out = [];
  for (let i = 0; i + 30 <= buf.length;) {
    if (buf.readUInt32LE(i) !== 0x04034b50) { i++; continue; }
    const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18), nameLen = buf.readUInt16LE(i + 26), extraLen = buf.readUInt16LE(i + 28);
    const name = buf.toString('utf8', i + 30, i + 30 + nameLen);
    const start = i + 30 + nameLen + extraLen;
    const data = buf.subarray(start, start + size);
    try { out.push([name, method === 8 ? zlib.inflateRawSync(data) : data]); } catch { out.push([name, data]); }
    i = start + Math.max(size, 1);
  }
  return out;
}
/** The text of a PDF: its strings (literal and hex, UTF-16 too) and the inflated streams. */
function pdfText(buf) {
  const raw = buf.toString('latin1');
  const parts = [raw];
  for (const m of raw.matchAll(/<(FEFF[0-9A-Fa-f]+)>/g)) parts.push(Buffer.from(m[1].slice(4), 'hex').swap16().toString('utf16le'));
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length, end = raw.indexOf('endstream', start);
    if (end < 0) continue;
    try { parts.push(zlib.inflateSync(buf.subarray(start, end)).toString('latin1')); } catch {}
  }
  return parts.join('\n');
}
/** tEXt, zTXt and iTXt chunks of a PNG (also inside an ICO). */
function pngText(buf) {
  const out = [];
  for (let i = buf.indexOf('\x89PNG\r\n\x1a\n', 0, 'latin1'); i >= 0 && i < buf.length; i = buf.indexOf('\x89PNG\r\n\x1a\n', i + 8, 'latin1')) {
    for (let p = i + 8; p + 12 <= buf.length;) {
      const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
      if (type === 'tEXt') out.push(data.toString('latin1'));
      else if (type === 'zTXt') { const z = data.indexOf(0); try { out.push(data.toString('latin1', 0, z) + ' ' + zlib.inflateSync(data.subarray(z + 2)).toString('latin1')); } catch {} }
      else if (type === 'iTXt') {
        const z = data.indexOf(0), compressed = data[z + 1] === 1;
        let q = data.indexOf(0, z + 3); q = data.indexOf(0, q + 1);
        try { out.push(data.toString('utf8', 0, z) + ' ' + (compressed ? zlib.inflateSync(data.subarray(q + 1)) : data.subarray(q + 1)).toString('utf8')); } catch {}
      }
      if (type === 'IEND') break;
      p += 12 + len;
    }
  }
  return out.join('\n');
}
/** The tables of a WOFF2 font, decompressed (the name table holds designer, copyright and the like). */
function woff2Text(buf) {
  if (buf.toString('latin1', 0, 4) !== 'wOF2') return '';
  const numTables = buf.readUInt16BE(12), compressed = buf.readUInt32BE(20);
  let p = 48;
  const base128 = () => { let v = 0; for (let k = 0; k < 5; k++) { const b = buf[p++]; v = v * 128 + (b & 0x7f); if (!(b & 0x80)) break; } return v; };
  for (let t = 0; t < numTables; t++) {
    const flags = buf[p++];
    const tagIndex = flags & 0x3f, transform = (flags >> 6) & 3;
    let tag = null;
    if (tagIndex === 0x3f) { tag = buf.toString('latin1', p, p + 4); p += 4; }
    base128();
    const glyfOrLoca = tagIndex === 10 || tagIndex === 11 || tag === 'glyf' || tag === 'loca';
    if (glyfOrLoca ? transform !== 3 : transform !== 0) base128();
  }
  try { return strings(zlib.brotliDecompressSync(buf.subarray(p, p + compressed))); } catch { return ''; }
}

/** [name, text] pieces of a file: the text itself, or what can be read out of a binary. */
function pieces(rel, buf) {
  const ext = path.extname(rel).toLowerCase();
  const head = buf.toString('latin1', 0, 8);
  const container = head.startsWith('%PDF-') || head.startsWith('PK\x03\x04') || head.startsWith('\x89PNG') || head.startsWith('wOF2') || ext === '.ico';
  const isText = !container && (TEXT_EXT.has(ext) || (!buf.subarray(0, 8000).includes(0) && buf.length < 2e6 && /^[\x09\x0a\x0d\x20-\x7e\x80-\xff]*$/.test(buf.toString('latin1', 0, Math.min(buf.length, 4000)))));
  if (isText) return [[rel, buf.toString('utf8')]];
  const out = [[rel + ' (strings)', strings(buf)]];
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) for (const [name, data] of zipEntries(buf)) out.push([rel + '!' + name + ' (entry name)', name], ...pieces(rel + '!' + name, data));
  if (buf.toString('latin1', 0, 5) === '%PDF-') out.push([rel + ' (pdf)', pdfText(buf)]);
  if (buf.includes('\x89PNG', 0, 'latin1')) out.push([rel + ' (png)', pngText(buf)]);
  if (ext === '.woff2') out.push([rel + ' (font)', woff2Text(buf)]);
  return out;
}

// ------------------------------------------------------------------ the checks ------
const fold = (s) => s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
const HOME = [
  /\b[a-z]:(?:\\{1,2}|\/)users(?:\\{1,2}|\/)([^\\/\r\n"'`<>|*?:;,)]+)/gi,
  /(?:^|[\s"'`(=:])\/(?:home|Users)\/([a-z_][\w.-]*)/gm,
];
function findings(text) {
  const found = [];
  const lower = text.normalize('NFC').toLowerCase();
  const tokens = [...lower.matchAll(/[\p{L}\p{N}]+/gu)];
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i][0];
    const next = tokens[i + 1]?.[0];
    const hits = [w, fold(w)];
    if (next) hits.push(w + ' ' + next, fold(w + ' ' + next));
    for (const h of new Set(hits)) {
      if (!FORBIDDEN.has(hash(h))) continue;
      if (next && (ALLOWED_PAIRS.has(hash(w + ' ' + next)) || ALLOWED_PAIRS.has(hash(fold(w + ' ' + next))))) continue;
      found.push({ at: tokens[i].index, what: h });
    }
  }
  for (const re of HOME) {
    for (const m of text.matchAll(re)) {
      const name = m[1].trim().toLowerCase();
      if (!PLACEHOLDER_HOMES.has(name) && !/^\$|^%|^<|^\{/.test(name)) found.push({ at: m.index, what: 'home folder of a user: ' + m[0].trim() });
    }
  }
  return found.map((f) => ({ ...f, line: text.slice(0, f.at).split('\n').length }));
}

if (process.argv[2] === '--hash') {
  if (!LIST?.salt) { console.error(`no word list with a salt in ${LIST_FILE}`); process.exit(2); }
  const words = process.argv.slice(3).join(' ').toLowerCase().normalize('NFC');
  console.log(hash(words));
  process.exit(0);
}

// --self-test: a harmless test word must be found in every kind of container this check reads
if (process.argv[2] === '--self-test') {
  const word = 'Zebrafink';
  FORBIDDEN.add(hash(word.toLowerCase()));
  const u16be = (s) => Buffer.from(s, 'utf16le').swap16().toString('hex').toUpperCase();
  const zip = (name, text) => {
    const data = zlib.deflateRawSync(Buffer.from(text)), head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(8, 8);
    head.writeUInt32LE(data.length, 18); head.writeUInt32LE(text.length, 22); head.writeUInt16LE(name.length, 26);
    return Buffer.concat([head, Buffer.from(name), data]);
  };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]); };
  const samples = {
    'sample.pdf (Info, UTF-16)': Buffer.from(`%PDF-1.4\n1 0 obj << /Author <FEFF${u16be(word)}> >> endobj\n`, 'latin1'),
    'sample.pdf (compressed stream)': Buffer.concat([Buffer.from('%PDF-1.4\n2 0 obj << /Filter /FlateDecode >> stream\n', 'latin1'), zlib.deflateSync(Buffer.from(`BT (${word}) Tj ET`)), Buffer.from('\nendstream\n', 'latin1')]),
    'sample.epub (deflated entry)': zip('OEBPS/content.opf', `<dc:creator>${word}</dc:creator>`),
    'sample.png (tEXt)': Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), chunk('IHDR', Buffer.alloc(13)), chunk('tEXt', Buffer.from(`Author\0${word}`, 'latin1')), chunk('IEND', Buffer.alloc(0))]),
    'sample.bin (UTF-16 string)': Buffer.concat([Buffer.alloc(16), Buffer.from(word, 'utf16le'), Buffer.alloc(16)]),
    'sample.txt (umlauts folded)': Buffer.from(`Grüße von ${word}`),
    'sample.js (home folder)': Buffer.from("const p = 'C:\\\\Users\\\\Erika\\\\Bücher';"),
  };
  let ok = 0;
  for (const [name, buf] of Object.entries(samples)) {
    const hit = pieces(name.split(' ')[0], buf).some(([, text]) => findings(text).length > 0);
    console.log(`${hit ? 'PASS' : 'FAIL'} finds the test word in ${name}`);
    if (hit) ok++;
  }
  const clean = pieces('clean.txt', Buffer.from('C:\\Users\\<name>\\Bücher, /home/user/books, Zebra fink')).every(([, text]) => findings(text).length === 0);
  console.log(`${clean ? 'PASS' : 'FAIL'} placeholders and other words pass`);
  const total = Object.keys(samples).length + 1, passed = ok + (clean ? 1 : 0);
  console.log(`PRIVACY-SELF-TEST ${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
}

const files = listFiles();
let bad = 0, badFiles = new Set();
for (const rel of files) {
  if (rel === 'build/privacy-check.js') continue;
  let buf;
  try { buf = fs.readFileSync(path.join(root, rel)); } catch { continue; }
  // the path itself (folder and file names), then the content
  for (const [name, text] of [[rel + ' (file name)', rel.replace(/[\\/]/g, ' / ')], ...pieces(rel, buf)]) {
    for (const f of findings(text)) {
      bad++; badFiles.add(rel);
      console.log(`FAIL ${name}${/ \(/.test(name) ? '' : ':' + f.line} ${f.what}`);
    }
  }
}
const scope = LIST ? `${FORBIDDEN.size} listed words and home folders` : `home folders only (no word list in ${path.relative(root, LIST_FILE) || LIST_FILE})`;
console.log(bad ? `PRIVACY-CHECK FAILED: ${bad} finding(s) in ${badFiles.size} file(s) of ${files.length}` : `PRIVACY-CHECK passed: ${files.length} files, ${scope}`);
process.exit(bad ? 1 : 0);
