// The fixtures of the text view tests (app/src/ui/reader/__tests__/run.js): the raw page data that
// app/src/ui/reader/pdf-text-extract.js reads with pdf.js, for the invented test books, together with what was set.
//
//   python build/testlib/gen_reader_books.py <books>
//   python build/testlib/gen_chess.py lib <chess>
//   node build/testlib/dump_reader_fixtures.mjs <books> <chess>
// writes app/src/ui/reader/__tests__/fixtures/pdf-text-pages.json
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// pdf.js 5.5 in Node: the few things of a newer browser it expects (only text and operator lists are read)
for (const [proto, name, fn] of [
  [Map.prototype, 'getOrInsertComputed', function (k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); }],
  [Map.prototype, 'getOrInsert', function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); }],
  [WeakMap.prototype, 'getOrInsertComputed', function (k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); }],
  [WeakMap.prototype, 'getOrInsert', function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); }],
]) if (typeof proto[name] !== 'function') Object.defineProperty(proto, name, { value: fn, writable: true, configurable: true });
globalThis.DOMMatrix ||= class DOMMatrix { constructor(m) { const a = Array.isArray(m) ? m : [1, 0, 0, 1, 0, 0]; [this.a, this.b, this.c, this.d, this.e, this.f] = a; } multiplySelf() { return this; } preMultiplySelf() { return this; } translate() { return this; } scale() { return this; } invertSelf() { return this; } };
if (typeof Promise.try !== 'function') Promise.try = function (fn, ...args) { return new Promise((resolve) => resolve(fn(...args))); };
if (typeof Uint8Array.prototype.toHex !== 'function') Uint8Array.prototype.toHex = function () { return Array.from(this, (b) => b.toString(16).padStart(2, '0')).join(''); };
if (typeof Uint8Array.prototype.toBase64 !== 'function') Uint8Array.prototype.toBase64 = function () { return Buffer.from(this).toString('base64'); };
if (typeof Uint8Array.fromBase64 !== 'function') Uint8Array.fromBase64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
globalThis.Path2D ||= class Path2D {};
const pdfjsDir = path.join(ROOT, 'vendor-src', 'foliate-js', 'vendor', 'pdfjs');
const log = console.log;
console.log = (...a) => { if (!/legacy/.test(String(a[0]))) log(...a); };
await import(pathToFileURL(path.join(pdfjsDir, 'pdf.mjs')).href);
console.log = log;
const pdfjs = globalThis.pdfjsLib;
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(pdfjsDir, 'pdf.worker.mjs')).href;
const { extractPage } = await import(pathToFileURL(path.join(ROOT, 'app', 'src', 'ui', 'reader', 'pdf-text-extract.js')).href);

async function pages(file, picks) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), standardFontDataUrl: pdfjsDir.replace(/\\/g, '/') + '/standard_fonts/', isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  const out = [];
  for (let i = 0; i < pdf.numPages; i++) if (!picks || picks.includes(i)) out.push(await extractPage(pdf, i, pdfjs));
  await pdf.destroy();
  return out;
}

const [books, chess] = process.argv.slice(2);
if (!books || !chess) { console.log('usage: node build/testlib/dump_reader_fixtures.mjs <reader books> <chess library>'); process.exit(1); }
const truth = JSON.parse(fs.readFileSync(path.join(books, 'reader-truth.json'), 'utf8'));
const chessTruth = JSON.parse(fs.readFileSync(path.join(chess, 'chess-truth.json'), 'utf8'));
const out = {
  about: 'pdf.js 5.5 raw page data (pdf-text-extract.js) of the invented test books of build/testlib/gen_reader_books.py and gen_chess.py, with what the generators set',
  books: {
    de: { file: 'Sachbuch/Der Fluss im Jahreslauf.pdf', pages: await pages(path.join(books, 'lib', 'Sachbuch', 'Der Fluss im Jahreslauf.pdf')), truth: truth['Sachbuch/Der Fluss im Jahreslauf.pdf'] },
    en: { file: 'Englisch/The River Year.pdf', pages: await pages(path.join(books, 'lib', 'Englisch', 'The River Year.pdf')), truth: truth['Englisch/The River Year.pdf'] },
    chess: { file: chessTruth.pdf, pages: await pages(path.join(chess, chessTruth.pdf), [0, 1, 3, 4, 5]), truth: { diagrams: chessTruth.diagrams.filter((d) => [1, 3, 4, 5].includes(d.page)).map((d) => ({ page: d.page, kind: d.kind, board: d.board })) } },
  },
};
const dest = path.join(ROOT, 'app', 'src', 'ui', 'reader', '__tests__', 'fixtures', 'pdf-text-pages.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out));
console.log('fixtures written:', dest, Math.round(fs.statSync(dest).size / 1024), 'KB');
