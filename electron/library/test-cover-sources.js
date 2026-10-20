// Tests for covers and metadata from the book catalogues and the image search engines (cover-sources.js, book-match.js,
// image-engines.js, web-covers.js, cover-batch.js): the parsers on made-up answers of Open Library, Goodreads, Apple Books,
// the DNB, the Internet Archive and Google Books (fixtures/sources.json.gz) and of Bing, Yandex and DuckDuckGo
// (fixtures/engines.json.gz), both written by fixtures/make-fixtures.js for the sample in build/testlib/cover-sample.js
// (nothing recorded: public-domain classics and invented titles in the formats of the real answers); the matching of
// tricky titles, the metadata a book gets, the manners towards each host and engine (budgets, rests), the agreement of
// several engines, the choice in the book info and "Alle Cover jetzt laden" with the image search, pause, cancel and a restart.
// Plain Node, no Electron, no network.
//   node electron/library/test-cover-sources.js        (also run by test-covers.js)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const assert = require('assert');

const BM = require('./book-match');
const M = require('./cover-match');
const S = require('./cover-sources');
const IE = require('./image-engines');
const { WebCovers } = require('./web-covers');
const { Library } = require('./library');
const SAMPLE = require('../../build/testlib/cover-sample');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 5).join('\n       ')); }
}
const FIX = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'sources.json.gz'))).toString('utf8'));
const fixtureOf = (title) => FIX.books.find((b) => b.book.title === title);
const answersOf = (title, host) => Object.entries(fixtureOf(title)?.responses || {}).filter(([u]) => u.includes(host)).map(([u, r]) => ({ url: u, ...r }));

// a picture as the fake network sends it: its size, its address and what the decoder would see in it
// (`framed`: on a white ground, `weak`: no picture, cover-match.js weakKind, `g16`: its 16 × 16 colours, `pic`: the name of
// a made-up picture, the same for two catalogues that show one cover); the fake decoder reads all of it back
const fakeImage = (url, w, h, seen = {}) => Buffer.concat([Buffer.from('IMG ' + JSON.stringify({ url, w, h, ...seen }) + '\n'), Buffer.alloc(3000)]);
// the 32 × 32 colours of a picture: the 16 × 16 of the fixture, each one four times, or made up from a name (one name,
// one picture: an address in all its sizes, or the `pic` of two results that show the same cover)
const seeded = (name) => { const seed = crypto.createHash('sha1').update(name).digest(); return new Uint8Array(32 * 32 * 3).map((_, i) => (seed[i % 20] * (1 + (i % 7))) & 255); };
function upsample(g) {
  const out = new Uint8Array(32 * 32 * 3);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) for (let c = 0; c < 3; c++) out[(y * 32 + x) * 3 + c] = g[((y >> 1) * 16 + (x >> 1)) * 3 + c];
  return out;
}
const STATS = { cover: { w: 100, h: 150, ink: 0.4, strong: 0.1, filled: 0.5, lumaStd: 60, bgLuma: 120, bgSat: 40 }, text: { w: 100, h: 150, ink: 0.05, strong: 0, filled: 0.02, lumaStd: 30, bgLuma: 240, bgSat: 4 },
  blank: { w: 100, h: 150, ink: 0.001, strong: 0, filled: 0, lumaStd: 1, bgLuma: 250, bgSat: 2 }, uniform: { w: 100, h: 150, ink: 0.001, strong: 0, filled: 0, lumaStd: 1, bgLuma: 90, bgSat: 60 } };
function fakeDecode(job) {
  const buf = Buffer.from(job.bytes || '');
  const s = buf.toString('utf8', 0, Math.min(buf.length, 16384));
  if (!s.startsWith('IMG ') || s.indexOf('\n') < 0) return Promise.resolve({ ok: false, error: 'undecodable' });
  const p = JSON.parse(s.slice(4, s.indexOf('\n')));
  const w = p.w, h = p.h;
  if (!(w > 0 && h > 0)) return Promise.resolve({ ok: false, error: 'undecodable' });
  const grid = p.g16 ? upsample(Buffer.from(p.g16, 'base64')) : seeded(p.pic ? 'picture ' + p.pic : String(p.url).replace(/[-_]?(?:[SML]|\d+x\d+bb|size=m)(?=\.jpg|$)/, ''));
  const data = 'data:image/jpeg;base64,' + Buffer.from('JPEG ' + p.url).toString('base64');
  const aspect = p.aspect || w / h, boxHeight = p.boxHeight || h;
  return Promise.resolve({ ok: true, width: w, height: h, aspect, boxHeight, framed: !!p.framed, grid, jpeg: data, preview: data, jpegWidth: Math.round(Math.min(h, 900) * aspect), jpegHeight: Math.min(boxHeight, 900), color: '#456789',
    stats: STATS[p.weak || 'cover'] });
}
/** A network that answers from the fixture answers of all sample books (unknown addresses: offline). */
const ALL = {};
for (const b of FIX.books) Object.assign(ALL, b.responses);
function replayFetch(seen = []) {
  return async (url) => {
    seen.push(url);
    if (/duckduckgo/.test(url)) throw new Error('offline (DuckDuckGo is never asked in these tests)');
    // a small copy for the choice in the book info: the picture of the fixture in its large size
    const large = url.replace(/-M\.jpg/, '-L.jpg').replace(/\/200x200bb\.jpg$/, '/900x900bb.jpg').replace(/&size=m$/, '').replace(/zoom=1$/, 'zoom=1&fife=w800-h1200');
    const r = ALL[url] || (ALL[large]?.image ? { ...ALL[large], image: { ...ALL[large].image, w: Math.round(ALL[large].image.w / 3), h: Math.round(ALL[large].image.h / 3) } } : null);
    if (!r) throw new Error('offline (no fixture for ' + url.slice(0, 90) + ')');
    if (r.image) return { ok: r.ok, status: r.status, contentType: r.contentType, buffer: r.ok ? fakeImage(url, r.image.w, r.image.h, r.image) : Buffer.from('not found') };
    return { ok: r.ok, status: r.status, contentType: r.contentType, buffer: Buffer.from(r.text || '') };
  };
}
const quiet = process.env.COVERS_DEBUG ? console : { log() {}, warn() {} };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesesaal-sources-'));
let n = 0;
function setup({ fetch, settings: extra = {}, ud: given = null, now = () => Date.now() } = {}) {
  const ud = given || path.join(tmp, 'u' + ++n);
  fs.mkdirSync(path.join(ud, 'covers'), { recursive: true });
  const data = { webCovers: true, webMetadata: true, folders: [], ...extra };
  const settings = { get: (k) => (k ? data[k] : data), data };
  const lib = new Library({ userData: ud, settings, emit: () => {}, getIndexer: () => null });
  const add = (id, book) => {
    lib.books[id] = { id, path: `C:/Bücher/${id}.pdf`, relPath: id + '.pdf', folder: 'C:/Bücher', format: 'pdf', pageCount: 240, indexed: true, hasCover: true, coverGenerated: true, bookmarks: [], annotations: [], positions: [], ...book };
    fs.writeFileSync(lib.coverPath(id), Buffer.from('title card of ' + id));
    return lib.books[id];
  };
  const wc = new WebCovers({ library: lib, settings, userData: ud, decode: fakeDecode, fetch, now, log: quiet, pace: 0, gap: 0 });
  return { lib, wc, add, settings, ud };
}

async function run() {
  // ---------------------------------------------------------------- small pieces ------------------------------------
  console.log('language, ISBN, series, year');
  await test('languages: codes, names and the garbage of PDF metadata', () => {
    assert.deepStrictEqual(['de', 'de-DE', 'ger', 'German', 'eng', 'en_US', 'fre', 'Germa', '<¦', 'to˚‹j', '', null].map(BM.normLang), ['de', 'de', 'de', 'de', 'en', 'en', 'fr', null, null, null, null, null]);
    assert.strictEqual(BM.textLanguage('Dies ist ein Buch über die Welt, und es ist nicht für jeden, wie man sich denkt. Die Geschichte der Menschen'), 'de');
    assert.strictEqual(BM.textLanguage('This is the story of a book that is for you and your friends, with the history of the world'), 'en');
  });
  await test('ISBN-10 becomes ISBN-13, a wrong check digit is none', () => {
    assert.strictEqual(BM.isbn13('3-928-39237-9'), '9783928392372');
    assert.strictEqual(BM.isbn13('978-3-928-39237-2'), '9783928392372');
    assert.strictEqual(BM.isbn13('9783928392371'), null);
    assert.strictEqual(BM.isbn13('391458355X'), '9783914583555');
  });
  await test('volumes, series numbers and years as catalogues and file names write them', () => {
    assert.deepStrictEqual(['Band 3', 'Bd. 2', 'Vol. IV', 'Der Tragödie zweiter Teil', 'Book Two', 'Lotta Haldenbruck (Lotta Haldenbruck 3)', '#5', '1000 Taktikaufgaben', 'Matt in zwei'].map(BM.volumeOf), [3, 2, 4, 2, 2, 3, 5, null, null]);
    assert.deepStrictEqual(['3', 'Bd. 3', 'Teil 2', '17,1', '[4]', 'IX'].map(BM.seriesNumber), [3, 3, 2, 17.1, 4, 9]);
    assert.strictEqual(BM.seriesName('\u0098Die\u009c Lotta-Haldenbruck-Reihe ;'), 'Die Lotta-Haldenbruck-Reihe');
    assert.deepStrictEqual(['[2025]', 'c2017', 'Nov 14, 2016', '25', '2021-09-06T07:00:00Z', 'ca. 1832'].map(BM.yearOf), [2025, 2017, 2016, null, 2021, 1832]);
  });
  await test('authors: "Last, First", credit lines with several names, the surnames', () => {
    assert.strictEqual(BM.personName('Fontane, Theodor'), 'Theodor Fontane');
    assert.strictEqual(BM.personName('La Fontaine, Jean de'), 'Jean de La Fontaine');
    assert.deepStrictEqual(BM.splitNames('Maren Holloway & Tobias Fairweather'), ['Maren Holloway', 'Tobias Fairweather']);
    assert.deepStrictEqual(BM.splitNames('Anna Beispiel, Peter Hoffmann & Julia M. Winter'), ['Anna Beispiel', 'Peter Hoffmann', 'Julia M. Winter']);
    assert.deepStrictEqual(BM.surnames('Heinrich von Kleist'), ['kleist']);
    assert.deepStrictEqual(BM.surnames('Eduard Mörike'), BM.surnames('Eduard Moerike'));
  });

  // ---------------------------------------------------------------- the matching ----------------------------------
  console.log('matching');
  const rec = (o) => S.record({ source: 'apple', ...o });
  const match = (book, r) => BM.matchRecord(BM.bookKey(book), rec(r));
  await test('a title cut off in its file name ("… Practical Exercises and") finds the book, its first words are searched too', () => {
    const book = { title: "The Beekeeper's First Workbook Practical Exercises and", author: '', language: 'en' };
    const bk = BM.bookKey(book);
    assert(bk.cut, 'cut off');
    assert.deepStrictEqual(BM.queriesFor(bk).map((q) => q.title), ["The Beekeeper's First Workbook Practical Exercises", "The Beekeeper's First Workbook"]);
    const m = match(book, { title: "The Beekeeper's First Workbook", authors: ['Maren Holloway', 'Tobias Fairweather'], language: 'en' });
    assert(m.ok && m.level === 'title' && m.how === 'prefix', JSON.stringify(m));
    assert(match(book, { title: "The Beekeeper's First Workbook", subtitle: 'Practical Exercises and Field Notes for Beginners' }).how === 'prefix+sub');
    assert(!match(book, { title: 'The Beekeeping Year: A Diary' }).ok);
    assert(!match(book, { title: 'Workbook' }).ok, 'a short title is not enough');
  });
  await test('subtitles, umlauts, ß, underscores and edition notes do not stand in the way', () => {
    assert.strictEqual(match({ title: 'Walden', author: 'Henry David Thoreau' }, { title: 'Walden', subtitle: 'or, Life in the Woods', authors: ['Henry David Thoreau'] }).level, 'author');
    assert.strictEqual(match({ title: 'The Time Machine_ An Invention', author: 'H. G. Wells' }, { title: 'The Time Machine', subtitle: 'An Invention', authors: ['H. G. Wells'] }).level, 'author');
    assert.strictEqual(match({ title: 'Der Proceß', author: 'Franz Kafka' }, { title: 'Der Prozess', authors: ['Kafka, Franz'] }).ok, false, 'ß and ss are other words (a different title)');
    assert.strictEqual(match({ title: 'Das Fräulein von Scuderi', author: 'E. T. A. Hoffmann' }, { title: 'Das Fraeulein von Scuderi', authors: ['Ernst Theodor Amadeus Hoffmann'] }).level, 'author');
    assert.strictEqual(match({ title: 'Great Expectations, Annotated Edition', author: 'Charles Dickens' }, { title: 'Great Expectations', subtitle: 'A Novel', authors: ['Charles Dickens', 'Marcus Stone'] }).level, 'author');
    assert.strictEqual(match({ title: 'Effi Briest (example.org) [eBook] 2. Auflage', author: 'Theodor Fontane' }, { title: 'Effi Briest', authors: ['Theodor Fontane'] }).level, 'author');
  });
  await test('another volume, an audio book, a summary, another language, another author: refused', () => {
    assert.strictEqual(match({ title: 'Faust. Der Tragödie erster Teil', author: 'Goethe' }, { title: 'Faust', subtitle: 'Der Tragödie zweiter Teil', authors: ['Goethe, Johann Wolfgang von'] }).why, 'volume');
    assert.strictEqual(match({ title: 'Die Gezeiten von Morland Band 2', author: 'Wieseneck' }, { title: 'Die Gezeiten von Morland', authors: ['Konrad Wieseneck'], seriesIndex: 3 }).why, 'volume');
    assert.strictEqual(match({ title: 'Die Leiden des jungen Werthers', author: 'Johann Wolfgang von Goethe' }, { source: 'dnb', title: 'Die Leiden des jungen Werthers', subtitle: 'vollständige Lesung', kind: 'audio' }).why, 'kind');
    assert.strictEqual(match({ title: 'Die Leiden des jungen Werthers', author: 'Johann Wolfgang von Goethe' }, { title: 'Die Leiden des jungen Werthers. Zusammenfassung & Analyse des Klassikers von Johann', authors: ['Lernhilfen Verlag'] }).why, 'companion');
    assert.strictEqual(match({ title: 'Lotta Haldenbruck und die Glocke von Nebelstein', author: 'Ilse Brandhuber' }, { title: 'Glockenmotive in "Lotta Haldenbruck und die Glocke von Nebelstein". Eine Motivanalyse', authors: ['Jonas Wendler'] }).ok, false);
    assert.strictEqual(match({ title: 'Walden', author: 'Henry David Thoreau', language: 'de' }, { title: 'Walden', authors: ['Henry David Thoreau'], language: 'en' }).why, 'language');
    assert.strictEqual(match({ title: 'Die Brüder Karamasow', author: 'Fjodor Dostojewski' }, { title: 'Die Brüder Karamasow', authors: ['Fyodor Dostoyevsky'] }).why, 'author');
    assert.strictEqual(match({ title: 'Propaganda', author: 'Julia Winter' }, { title: 'Propaganda', authors: ['Otto Brenner'] }).why, 'author');
  });
  await test('"Title, or Subtitle" is a subtitle; a part of a split edition ("Walden, Part One") is another book', () => {
    const walden = { title: 'Walden', author: 'Henry David Thoreau', language: 'en' };
    assert.strictEqual(match(walden, { source: 'goodreads', title: 'Walden, or Life in the Woods', authors: ['Henry David Thoreau'] }).level, 'author');
    assert.strictEqual(match(walden, { source: 'goodreads', title: 'Walden, Part One', authors: ['Henry David Thoreau'] }).why, 'volume');
    assert.strictEqual(match({ title: 'Faust Teil 1', author: 'Goethe' }, { title: 'Faust. Teil 1', authors: ['Goethe, Johann Wolfgang von'] }).ok, true, 'the book names the part itself');
    assert.strictEqual(match({ title: 'Lotta Haldenbruck und die Glocke von Nebelstein', author: 'Ilse Brandhuber' }, { source: 'dnb', title: 'Lotta Haldenbruck und die Glocke von Nebelstein (Lotta Haldenbruck 3)', authors: ['Brandhuber, Ilse'] }).ok, true, 'a series number in parentheses is no part');
  });
  await test('a plain title without an author is weak (only when two catalogues show the same picture); the ISBN decides alone', () => {
    assert.strictEqual(match({ title: 'Strategie', author: '' }, { title: 'Strategie', authors: ['Hans Dampf'] }).level, 'weak');
    assert.strictEqual(match({ title: 'Woyzeck', author: 'Georg Büchner' }, { title: 'Woyzeck', authors: ['Georg Büchner'] }).level, 'author');
    const isbnRec = { source: 'dnb', title: 'On the Origin of Species', authors: ['Charles Darwin'], isbns: ['9783950590166'] };
    assert.strictEqual(match({ title: 'Microsoft Word - manuscript_final', author: 'Microsoft Office User', isbn: '9783950590166' }, isbnRec).level, 'isbn', 'a file title: the ISBN is the book');
    assert.strictEqual(match({ title: 'Ein ganz anderes Buch über Gärten', author: 'Anna Lehmann', isbn: '9783950590166' }, isbnRec).ok, false, 'an ISBN from the text of another book');
  });

  // ---------------------------------------------------------------- the catalogues' answers ------------------------
  console.log("the catalogues' answers (" + FIX.recorded + ")");
  await test('Open Library: the work and the edition in the book\'s language, ISBN-13, the picture by its id', () => {
    const a = answersOf('Die Leiden des jungen Werthers', 'openlibrary.org/search.json').find((x) => x.text && /docs/.test(x.text));
    assert(a, 'in the fixtures');
    const recs = S.parseOpenLibrary(JSON.parse(a.text));
    assert(recs.length >= 1);
    for (const r of recs) { assert(r.title); assert(r.isbns.every((i) => /^97[89]\d{10}$/.test(i))); if (r.cover) assert(/^https:\/\/covers\.openlibrary\.org\/b\/id\/\d+-L\.jpg\?default=false$/.test(r.cover.url)); }
  });
  await test('Apple Books: e-books, artwork at 900 px, the ISBN in the file name, the language of the blurb', () => {
    const a = answersOf("The Beekeeper's First Workbook Practical Exercises and", 'itunes.apple.com').map((x) => S.parseApple(JSON.parse(x.text))).flat();
    const holloway = a.find((r) => /Holloway/.test(r.authors.join(' ')));
    assert(holloway, 'the book is in the answers');
    assert.deepStrictEqual(holloway.authors, ['Maren Holloway', 'Tobias Fairweather']);
    assert.strictEqual(holloway.subtitle, 'Practical Exercises and Field Notes for Beginners', 'the subtitle after the colon');
    assert(/\/900x900bb\.jpg$/.test(holloway.cover.url) && /\/200x200bb\.jpg$/.test(holloway.cover.preview));
    assert.strictEqual(holloway.isbnOwn, '9783972337299');
    assert.strictEqual(holloway.language, 'en');
  });
  await test('DNB: MARC21 records with author, year, publisher, ISBN, series and volume, audio books marked', () => {
    const xmls = answersOf('Lotta Haldenbruck und die Glocke von Nebelstein', 'services.dnb.de').map((x) => x.text);
    const recs = xmls.map(S.parseDnb).flat();
    assert(recs.length, 'records');
    assert(recs.every((r) => r.source === 'dnb' && r.title));
    const withSeries = recs.find((r) => r.series && r.seriesIndex);
    assert(withSeries, 'a record with its series');
    assert(withSeries.series === 'Die Lotta-Haldenbruck-Reihe' && withSeries.seriesIndex === 3, JSON.stringify(withSeries));
    assert(recs.some((r) => r.series === 'Lotta Haldenbruck' && r.seriesIndex === 3), 'the series of field 830');
    assert(recs.every((r) => r.authors[0] === 'Ilse Brandhuber' && r.publisher === 'Kieselstein Verlag' && /^97839\d{8}$/.test(r.isbnOwn)), JSON.stringify(recs));
    assert(recs.some((r) => r.year >= 1990), 'years');
    const kafka = answersOf('Der Proceß', 'services.dnb.de').map((x) => S.parseDnb(x.text)).flat();
    assert(kafka.length && kafka.every((r) => ['book', 'ebook', 'audio', 'video', 'other'].includes(r.kind)));
    assert.deepStrictEqual(kafka.map((r) => r.kind), ['book', 'book', 'audio', 'ebook'], 'printed, audio book (leader), e-book (338 Online-Ressource)');
    assert(kafka.every((r) => r.title === 'Der Proceß'), 'the marks of the article are gone');
  });
  await test('Goodreads and the Internet Archive: the book with its author and picture', () => {
    const gr = answersOf('Immensee', 'goodreads.com/book/auto_complete').map((x) => S.parseGoodreads(JSON.parse(x.text))).flat();
    assert(gr.some((r) => r.title === 'Immensee' && r.authors[0] === 'Theodor Storm' && /^https:\/\/i\.gr-assets\.com\/.*\.jpg$/.test(r.cover?.url || '') && !/_SY75_/.test(r.cover.url)), JSON.stringify(gr.slice(0, 3)));
    const ia = answersOf('Die Leiden des jungen Werthers', 'archive.org/advancedsearch').map((x) => S.parseArchive(JSON.parse(x.text))).flat();
    assert(ia.some((r) => /Werthers/.test(r.title) && r.authors.join(' ') === 'Johann Wolfgang von Goethe' && /cover_w600\.jpg$/.test(r.cover.url)), JSON.stringify(ia.slice(0, 3)));
    // Amazon's pictures: the editions' covers by ISBN-10, the GIF for none
    const amz = Object.entries(ALL).filter(([u]) => /m\.media-amazon\.com/.test(u));
    assert(amz.length >= 20 && amz.some(([, r]) => r.image && r.image.h >= 400), 'Amazon pictures of 400 px and more');
  });
  await test('Google Books without a key: "no quota" makes it rest half a day (no request until then)', async () => {
    const g = Object.entries(ALL).find(([u]) => /googleapis/.test(u));
    assert(g, 'in the fixtures');
    const net = new S.Net({ fetch: async () => ({ ok: false, status: 429, contentType: 'application/json', buffer: Buffer.from(g[1].text || 'quota') }), pace: 0, log: quiet });
    await assert.rejects(net.get('https://www.googleapis.com/books/v1/volumes?q=x'), (e) => e.code === 'busy');
    assert(net.resting('https://www.googleapis.com/books/v1/volumes?q=y') > 11 * 3600e3);
    await assert.rejects(net.get('https://www.googleapis.com/books/v1/volumes?q=z'), (e) => e.code === 'rest');
    // the documented answer of a key that has quota: volumes with pictures, ISBNs, series numbers
    const recs = S.parseGoogle({ items: [{ id: 'abc', volumeInfo: { title: 'Die stille Bucht', subtitle: 'Roman', authors: ['Konrad Wieseneck'], publisher: 'Lindenhof Verlag', publishedDate: '2016-01-16', language: 'de', printType: 'BOOK', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9783928392372' }, { type: 'ISBN_10', identifier: '3928392379' }], imageLinks: { thumbnail: 'http://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api' }, seriesInfo: { volumeSeries: [{ orderNumber: 2 }] } } }] });
    assert.strictEqual(recs[0].isbnOwn, '9783928392372');
    assert(/^https:.*fife=w800-h1200$/.test(recs[0].cover.url) && !/edge=curl/.test(recs[0].cover.url));
    assert.strictEqual(recs[0].seriesIndex, 2);
  });

  // the whole sample with the made-up answers of make-fixtures.js: the cover each book gets
  for (const s of SAMPLE) {
    const exp = s.expect || null;
    await test(`sample: ${s.book.title.slice(0, 64)}` + (exp ? (exp.cover ? ` → ${exp.cover}` : ' → no cover') : ''), async () => {
      const r = fixtureOf(s.book.title);
      assert(r, 'in the fixtures');
      const { wc, add, lib } = setup({ fetch: replayFetch() });
      wc.net.rests['www.googleapis.com'] = { until: Date.now() + 3600e3, why: 'quota' };
      const book = add('b', s.book);
      const res = await wc.fastCover(book);
      if (exp && exp.cover === null) { assert(!res.found, 'better no cover than a wrong one: ' + JSON.stringify(book.coverWeb)); return; }
      if (exp && exp.cover) {
        assert(res.found, 'a cover');
        assert.strictEqual(book.coverWeb.via, exp.cover);
        if (exp.image) assert(book.coverWeb.image.includes(exp.image), book.coverWeb.image);
      }
      // the metadata that came with it
      if (exp?.author) assert(exp.author.test(book.author), 'author filled in: ' + book.author);
      if (exp?.series) assert(exp.series.test(book.series || ''), 'series: ' + book.series);
      if (exp?.seriesIndex) assert.strictEqual(book.seriesIndex, exp.seriesIndex);
      if (exp?.publisher) assert(exp.publisher.test(book.publisher || ''), 'publisher: ' + book.publisher);
      if (exp?.publisherNot) assert(!exp.publisherNot.test(book.publisher || ''), 'no lesser edition: ' + book.publisher);
      if (exp?.yearMin) assert(!book.year || book.year >= exp.yearMin, 'year: ' + book.year);
      if (exp && 'isbn' in exp) assert.strictEqual(book.isbn || null, exp.isbn, 'isbn: ' + book.isbn);
      // the picture make-fixtures.js meant to win
      const want = r.pick;
      if (want !== undefined) assert.strictEqual(res.found ? book.coverWeb.image : null, want, 'the designed picture');
      lib.db.flush?.();
    });
  }

  // ---------------------------------------------------------------- the metadata -----------------------------------
  console.log('metadata');
  await test('only missing fields are filled in, from where they came; year of the earliest edition, publisher of the cover\'s', () => {
    const recs = [
      { source: 'dnb', id: 'a', rank: 3, authors: ['Fontane, Theodor'], year: 2017, publisher: 'Lindenhof Verlag', isbnOwn: '9783928392372', language: 'de' },
      { source: 'dnb', id: 'b', rank: 3, authors: ['Fontane, Theodor'], year: 2014, publisher: 'Kieselstein Verlag', isbnOwn: '9783914583555', language: 'de' },
      { source: 'apple', id: 'c', rank: 3, authors: ['Theodor Fontane'], year: '2012-06-27', language: 'de' },
      { source: 'openlibrary', id: '/works/OL1W', rank: 3, authors: ['Theodor Fontane'], year: 1825 },
      { source: 'dnb', id: 'd', rank: 3, authors: ['Fontane, Theodor'], year: 2009, publisher: 'BoD - Books on Demand', isbnOwn: '9783000000002' },
    ];
    const { patch, src } = BM.metadataFrom({ title: 'Effi Briest', author: '', year: null, publisher: null, language: 'de' }, recs, { chosen: recs[1] });
    assert.deepStrictEqual(patch, { author: 'Theodor Fontane', year: 2014, publisher: 'Kieselstein Verlag' }, 'the cover\'s edition; no ISBN of several editions');
    assert.deepStrictEqual(src, { author: 'dnb', year: 'dnb', publisher: 'dnb' });
    const noCover = BM.metadataFrom({ title: 'Effi Briest', author: '', language: 'de' }, recs);
    assert.strictEqual(noCover.patch.year, 2012, 'without a cover the earliest edition (Apple\'s e-book can only be later), never the work\'s 1825 or a print on demand\'s 2009');
    const own = BM.metadataFrom({ title: 'X', author: 'Theodor Fontane', year: 2011, publisher: 'Mein Verlag', isbn: '9783950590166', language: 'de' }, recs);
    assert.deepStrictEqual(own.patch, {}, 'what the file says stays');
    const lotta = { source: 'dnb', id: 'h', rank: 4, isbnOwn: '9783989128484', series: '\u0098Die\u009c Lotta-Haldenbruck-Reihe ;', seriesIndex: 3, language: 'de' };
    const one = BM.metadataFrom({ title: 'Lotta Haldenbruck und die Glocke von Nebelstein', author: 'A B', language: 'de' }, [lotta], { chosen: lotta });
    assert.deepStrictEqual(one.patch, { isbn: '9783989128484', series: 'Die Lotta-Haldenbruck-Reihe', seriesIndex: 3 }, 'the only edition of the DNB, with the cover from it');
    const line = BM.metadataFrom({ title: 'Woyzeck', author: 'Georg Büchner' }, [{ source: 'dnb', id: 'm', rank: 3, series: 'dtv Taschenbuch', seriesIndex: 7 }, { source: 'dnb', id: 'n', rank: 3, series: 'Easy Readers', seriesIndex: 2 }]);
    assert(!('series' in line.patch), 'a paperback line or a school series is no series of the story: ' + JSON.stringify(line.patch));
    const junk = BM.metadataFrom({ title: 'X', author: 'Microsoft Office User' }, [{ source: 'openlibrary', rank: 4, authors: ['Theodor Fontane'] }]);
    assert.strictEqual(junk.patch.author, 'Theodor Fontane', 'a program\'s name is no author');
  });
  await test('a book gets its metadata with the cover; the file\'s values win; lost values come back without a request', async () => {
    const seen = [];
    const { wc, add, lib } = setup({ fetch: replayFetch(seen) });
    wc.net.rests['www.googleapis.com'] = { until: Date.now() + 3600e3 };
    const book = add('hp', { title: 'Lotta Haldenbruck und die Glocke von Nebelstein', author: 'Ilse Brandhuber', language: 'de', publisher: 'Mein Verlag' });
    await wc.fastCover(book);
    assert.strictEqual(book.publisher, 'Mein Verlag', 'the file\'s publisher stays');
    assert(book.year > 1990, 'year ' + book.year);
    assert(/Lotta.Haldenbruck/.test(book.series || '') && book.seriesIndex === 3, `series ${book.series} ${book.seriesIndex}`);
    assert.strictEqual(book.metaWeb.src.series, 'dnb');
    assert(!('publisher' in book.metaWeb.src));
    const pub = lib.publicBook(book);
    assert('series' in pub && 'seriesIndex' in pub && 'metaWeb' in pub, 'the renderer sees them (sorting by metadata)');
    // the file is read again and has no year: the year comes back from metaWeb, nobody is asked
    const asked = seen.length;
    book.year = null; book.series = null; book.seriesIndex = null;
    assert.strictEqual(wc.nextMeta(), null);
    assert(book.year > 1990 && book.seriesIndex === 3);
    assert.strictEqual(seen.length, asked);
  });
  await test('"Metadaten aus dem Internet ergänzen" off: covers still come, no field is filled in', async () => {
    const { wc, add } = setup({ fetch: replayFetch(), settings: { webMetadata: false } });
    wc.net.rests['www.googleapis.com'] = { until: Date.now() + 3600e3 };
    const book = add('k', { title: "The Beekeeper's First Workbook Practical Exercises and", author: '', language: 'en' });
    const r = await wc.fastCover(book);
    assert(r.found);
    assert.strictEqual(book.author, '');
    assert(!book.metaWeb);
    assert.strictEqual(wc.nextMeta(), null);
  });

  // ---------------------------------------------------------------- hosts --------------------------------------------
  console.log('hosts');
  await test('one host at a time with its pause, retries after a network error, a rest after 429 (Retry-After)', async () => {
    const calls = [];
    let fail = 2;
    const net = new S.Net({ log: quiet, pace: 0.05, fetch: async (url) => {
      calls.push([url, Date.now()]);
      if (/flaky/.test(url) && fail-- > 0) throw new Error('net::ERR_CONNECTION_RESET');
      if (/busy/.test(url)) return { ok: false, status: 429, retryAfter: '120', contentType: 'text/plain', buffer: Buffer.from('slow down') };
      return { ok: true, status: 200, contentType: 'application/json', buffer: Buffer.from('{}') };
    } });
    await Promise.all([1, 2, 3].map((i) => net.get('https://openlibrary.org/search.json?q=' + i)));
    const t = calls.map((c) => c[1]);
    assert(t[1] - t[0] >= 40 && t[2] - t[1] >= 40, 'a pause between two requests (1 s × 0.05): ' + (t[1] - t[0]) + ' ' + (t[2] - t[1]));
    const r = await net.get('https://covers.openlibrary.org/flaky');
    assert(r.ok && calls.filter((c) => /flaky/.test(c[0])).length === 3, 'two retries');
    await assert.rejects(net.get('https://itunes.apple.com/busy'), (e) => e.code === 'busy');
    const rest = net.resting('https://itunes.apple.com/search');
    assert(rest > 115e3 && rest <= 120e3, 'Retry-After: ' + rest);
    await assert.rejects(net.get('https://itunes.apple.com/search?term=x'), (e) => e.code === 'rest');
  });
  await test('Apple: never more than 18 requests a minute', async () => {
    const net = new S.Net({ log: quiet, pace: 1, fetch: async () => ({ ok: true, status: 200, contentType: 'application/json', buffer: Buffer.from('{}') }) });
    const h = net.host('itunes.apple.com');
    h.conf = { conc: 1, gap: 0, window: [18, 60e3] };
    for (let i = 0; i < 18; i++) await net.get('https://itunes.apple.com/search?term=' + i);
    const t0 = Date.now();
    const p = net.get('https://itunes.apple.com/search?term=19');
    const raced = await Promise.race([p.then(() => 'answered'), new Promise((r) => setTimeout(() => r('waiting'), 300))]);
    assert.strictEqual(raced, 'waiting', 'the 19th waits for the window');
    h.recent = h.recent.map((x) => x - 60e3);             // a minute later
    assert.strictEqual(await Promise.race([p.then(() => 'answered'), new Promise((r) => setTimeout(() => r('waiting'), 2500))]), 'answered');
    assert(Date.now() - t0 < 4000);
  });

  // ---------------------------------------------------------------- the choice -------------------------------------
  console.log('the choice in the book info');
  await test('"Anderes Cover": the pictures of all catalogues, the book\'s own page, the title card; a choice stays', async () => {
    const { wc, add, lib } = setup({ fetch: replayFetch() });
    wc.net.rests['www.googleapis.com'] = { until: Date.now() + 3600e3 };
    const book = add('dk', { title: 'Gespräche mit Goethe in den letzten Jahren seines', author: 'Johann Peter Eckermann', language: 'de', coverGenerated: false, coverWeak: 'text' });
    fs.writeFileSync(lib.coverPath('dk'), fakeImage('page-one-of-dk', 600, 900));
    await wc.fastCover(book);
    assert.strictEqual(book.coverSource, 'web');
    const res = await wc.candidates('dk');
    assert(res.ok && res.items.length >= 1, JSON.stringify(res).slice(0, 300));
    assert(res.items.every((it) => it.preview && it.key.startsWith('f:') && it.source), 'catalogue pictures with previews');
    assert(res.items.some((it) => it.current), 'the current one is marked');
    assert(res.own && res.own.preview, 'the book\'s own page 1 can come back');
    assert.strictEqual(res.web.state, 'none', 'DuckDuckGo only on request');
    const other = res.items.find((it) => !it.current) || res.items[0];
    const c = await wc.choose('dk', other.key);
    assert(c.ok && book.coverChoice === 'web');
    assert(!wc.needsCover(book), 'a chosen cover is never searched again');
    assert.strictEqual((await wc.choose('dk', 'f:1:0')).error, 'stale');
    // the title card, for good; then the book's own cover
    assert(wc.useTitleCard('dk').ok && book.coverChoice === 'card' && book.coverSource === 'book');
    assert(!wc.needsCover(book));
    assert(wc.useBookCover('dk').ok && book.coverChoice === 'book');
  });
  await test('"Eigenes Bild wählen": the picture becomes the cover, stays when the file is read again', async () => {
    const { wc, add, lib } = setup({ fetch: replayFetch() });
    const book = add('own', { title: 'Woyzeck', author: 'Georg Büchner', coverGenerated: false, coverWeak: null });
    const file = path.join(tmp, 'mein-bild.jpg');
    fs.writeFileSync(file, fakeImage('my-own-picture', 500, 760));
    const r = await wc.chooseFile('own', file);
    assert(r.ok && book.coverSource === 'web' && book.coverChoice === 'own' && book.coverWeb.via === 'file');
    lib.indexing = { id: 'own' };
    const page = 'data:image/jpeg;base64,' + Buffer.from('page one').toString('base64');
    await lib.onIndexResult('own', { metadata: {}, cover: page, coverColor: '#aa3311', coverStats: { w: 100, h: 150, ink: 0.4, strong: 0.1, filled: 0.5, lumaStd: 60, bgLuma: 120, bgSat: 40 } });
    assert.strictEqual(book.coverSource, 'web', 'the own picture stays');
    assert(/my-own-picture/.test(fs.readFileSync(lib.coverPath('own'), 'utf8')));
    assert.strictEqual((await wc.chooseFile('own', path.join(tmp, 'gibt-es-nicht.jpg'))).error, 'file');
  });
  await test('placeholders: the same file for two different books is no cover, the first book gets its card back', async () => {
    const same = fakeImage('https://example.invalid/no-cover.gif', 400, 600);
    const answer = (title) => ({ docs: [{ key: '/works/X', title, author_name: ['Anna Beispiel'], language: ['ger'], cover_i: 77, editions: { docs: [] } }] });
    const fetch = async (url) => {
      const u = new URL(url);
      if (u.hostname === 'openlibrary.org') return { ok: true, status: 200, contentType: 'application/json', buffer: Buffer.from(JSON.stringify(answer(u.searchParams.get('q')))) };
      if (u.hostname === 'covers.openlibrary.org') return { ok: true, status: 200, contentType: 'image/jpeg', buffer: same };
      if (u.hostname === 'services.dnb.de') return { ok: true, status: 200, contentType: 'application/xml', buffer: Buffer.from('<searchRetrieveResponse/>') };
      return { ok: true, status: 200, contentType: 'application/json', buffer: Buffer.from('{"results":[]}') };
    };
    const { wc, add } = setup({ fetch });
    wc.net.rests['www.googleapis.com'] = { until: Date.now() + 3600e3 };
    const a = add('a', { title: 'Die Ordnung der Gartenbeete', author: 'Anna Beispiel', language: 'de' });
    const b = add('b', { title: 'Das Rauschen der Fichtenwälder', author: 'Anna Beispiel', language: 'de' });
    assert((await wc.fastCover(a)).found, 'the first book takes the picture');
    assert(!(await wc.fastCover(b)).found, 'the second one sees it is a placeholder');
    assert.strictEqual(a.coverSource, 'book', 'the first book is set back');
    assert.strictEqual(wc.state.placeholders.length, 1);
    assert(wc.fastDue(a), 'and is looked up again');
  });

  // ---------------------------------------------------------------- the image search engines -------------------------
  console.log('the image search engines');
  const ENG = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'engines.json.gz'))).toString('utf8'));
  const NO_ENGINES = { bing: false, yandex: false, duckduckgo: false };
  await test('Bing and Yandex: page, picture, thumbnail from the engine\'s own cache and size of each result', () => {
    const b = IE.parseBing(ENG.bing.html), y = IE.parseYandex(ENG.yandex.html);
    assert(b.length >= 20 && y.length >= 20, b.length + ' ' + y.length);
    for (const r of [...b, ...y]) assert(/^https?:\/\//.test(r.url) && /^https?:\/\//.test(r.image) && r.width > 0 && r.height > 0, JSON.stringify(r));
    assert(b.every((r) => /^https:\/\/[\w.-]+\.bing\.net\/th\?/.test(r.thumbnail)), 'Bing: thumbnails from its cache');
    assert(y.every((r) => /^https:\/\/avatars\.mds\.yandex\.net\//.test(r.thumbnail)), 'Yandex: thumbnails from its cache');
    assert(b.some((r) => /goethe/i.test(r.title)) && y.some((r) => /goethe/i.test(r.title)), 'the titles of the pages');
    assert.deepStrictEqual(y.map((r) => r.rank), y.map((r) => r.rank).sort((p, q) => p - q), 'in the engine\'s order');
    const t = IE.bingThumb(IE.bingThumb(b[0].thumbnail, 240), 900);
    assert(/&h=900$/.test(t) && !/h=240/.test(t), 'a thumbnail in the height asked for: ' + t);
  });
  await test('a captcha, a challenge, 429 or 403 is throttling; an answer with results is none', () => {
    for (const [name, c] of Object.entries(ENG.challenges)) assert(IE.isChallenge({ status: c.status, buffer: Buffer.from(c.html) }), name);
    assert(!IE.isChallenge({ status: 200, buffer: Buffer.from(ENG.bing.html) }) && !IE.isChallenge({ status: 200, buffer: Buffer.from(ENG.yandex.html) }));
    assert(IE.isChallenge({ status: 200, url: 'https://yandex.com/showcaptcha?retpath=x', buffer: Buffer.from('<html></html>') }), 'sent on to a captcha');
    assert(IE.isChallenge({ status: 200, buffer: Buffer.from('<html><title>Are you a robot?</title></html>') }));
    assert(!IE.isChallenge({ status: 404, buffer: Buffer.from('not found') }));
  });
  await test('strict safe search, the market of the book\'s language, nothing but the query', () => {
    const q = M.coverQuery({ title: 'Woyzeck', author: 'Georg Büchner', language: 'de' });
    const u = new URL(IE.bingUrl(q));
    assert.strictEqual(u.searchParams.get('adlt'), 'strict');
    assert.strictEqual(u.searchParams.get('mkt'), 'de-DE');
    assert.strictEqual(u.searchParams.get('q'), q.q);
    assert.deepStrictEqual([...u.searchParams.keys()].sort(), ['adlt', 'count', 'first', 'mkt', 'mmasync', 'q', 'setlang']);
    const y = new URL(IE.yandexUrl(q));
    assert.strictEqual(y.searchParams.get('family'), 'yes');
    assert.deepStrictEqual([...y.searchParams.keys()].sort(), ['family', 'text']);
  });
  await test('each engine within its own budget: Bing 8 searches a minute, Yandex 2; a captcha means a rest, longer each time, and half the budget', async () => {
    let clock = 1e12;
    const captcha = async () => ({ ok: true, status: 200, contentType: 'text/html', buffer: Buffer.from('<html><body><div class="captcha">Please confirm you are not a robot</div></body></html>') });
    const { wc, settings } = setup({ fetch: captcha, now: () => clock });
    wc.net.pace = 1;
    const bing = wc.net.host('www.bing.com'), yandex = wc.net.host('yandex.com');
    bing.recent = Array.from({ length: 8 }, (_, i) => clock - 50e3 + i * 5e3); bing.last = clock - 15e3;
    assert.strictEqual(wc.engineWait('bing'), 10e3, 'the ninth search waits until the first is a minute old');
    yandex.recent = [clock - 30e3, clock - 25e3]; yandex.last = clock - 25e3;
    assert.strictEqual(wc.engineWait('yandex'), 30e3, 'two a minute');
    assert.strictEqual(wc.imageWait(), 0, 'DuckDuckGo is free');
    wc.state.ddg.last = clock;
    assert.strictEqual(wc.imageWait(), 10e3, 'the time until the first engine is free');
    clock += 60e3;
    const q = M.coverQuery({ title: 'Woyzeck', author: 'Georg Büchner', language: 'de' });
    const r = await wc.searchEngine('bing', q);
    assert(!r.ok && r.blocked, 'a captcha is no answer');
    assert.strictEqual(wc.engineWait('bing'), 30 * 60e3, 'Bing rests half an hour');
    assert.strictEqual(wc.net.budget('www.bing.com'), 4, 'and asks half as often afterwards');
    clock += 30 * 60e3;
    await wc.searchEngine('bing', q);
    assert.strictEqual(wc.engineWait('bing'), 60 * 60e3, 'twice as long the next time');
    assert.strictEqual(wc.net.budget('www.bing.com'), 2);
    assert.strictEqual(wc.state.rests['www.bing.com'].n, 2, 'kept with the other state (a restart keeps it)');
    clock += 60 * 60e3 + 25 * 3600e3;
    assert.strictEqual(wc.net.budget('www.bing.com'), 8, 'a day later the full budget again');
    // an engine switched off in the settings is never asked
    settings.data.coverEngines = NO_ENGINES;
    assert.strictEqual(wc.imageWait(), Infinity);
  });

  // a made-up image search: the results as Bing and Yandex send them; `pic` names the picture behind a result (two
  // results with one name show the same cover, as two shops do)
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const bingAnswer = (results) => '<ul>' + results.map((r, i) => `<li><a class="iusc" m="${esc(JSON.stringify({ purl: r.page, murl: `https://img.example/${r.pic}-${i}.jpg`, turl: `https://ts${(i % 4) + 1}.mm.bing.net/th?id=OIP.${r.pic}-${i}&pid=15.1`, t: r.title }))}" href="#"></a><span class="nowrap">${r.w || 600} × ${r.h || 900}</span></li>`).join('') + '</ul>';
  const yandexAnswer = (results) => {
    const ents = {};
    results.forEach((r, i) => { ents['e' + i] = { pos: i, image: `//avatars.mds.yandex.net/i?id=${r.pic}-${i}&n=13`, origUrl: `https://img.example/${r.pic}-y${i}.jpg`, origWidth: r.w || 600, origHeight: r.h || 900, alt: r.title, snippet: { title: r.title, url: r.page } }; });
    return `<div data-state="${esc(JSON.stringify({ initialState: { serpList: { items: { entities: ents } } } }))}"></div>`;
  };
  /** The network of such a search: the catalogues know nothing, the engines answer with `answers.bing(q)` and `answers.yandex(q)`. */
  function engineFetch(answers, calls = []) {
    return async (url) => {
      const u = new URL(url);
      calls.push({ url, host: u.hostname, at: Date.now() });
      const json = (o) => ({ ok: true, status: 200, contentType: 'application/json', buffer: Buffer.from(JSON.stringify(o)) });
      const html = (t) => ({ ok: true, status: 200, contentType: 'text/html', buffer: Buffer.from(t) });
      if (u.hostname === 'openlibrary.org') return json({ numFound: 0, docs: [] });
      if (u.hostname === 'itunes.apple.com') return json({ resultCount: 0, results: [] });
      if (u.hostname === 'services.dnb.de') return { ok: true, status: 200, contentType: 'application/xml', buffer: Buffer.from('<searchRetrieveResponse><numberOfRecords>0</numberOfRecords></searchRetrieveResponse>') };
      if (u.hostname === 'www.goodreads.com') return json([]);
      if (u.hostname === 'archive.org' && u.pathname === '/advancedsearch.php') return json({ response: { numFound: 0, docs: [] } });
      if (u.hostname === 'www.bing.com') { const a = answers.bing ? answers.bing(u.searchParams.get('q')) : []; return a === 'captcha' ? html('<html><title>Captcha</title><body>captcha</body></html>') : html(bingAnswer(a)); }
      if (u.hostname === 'yandex.com') return html(yandexAnswer(answers.yandex ? answers.yandex(u.searchParams.get('text')) : []));
      // the engines' image caches: the picture named in the address, in the height asked for (Yandex: 320 px)
      const pic = /id=OIP\.(\w+)-\d+/.exec(url)?.[1] || /\/i\?id=(\w+)-\d+/.exec(url)?.[1];
      if (pic) { const h = Math.min(900, +(/[?&]h=(\d+)/.exec(url)?.[1] || 320)); return { ok: true, status: 200, contentType: 'image/jpeg', buffer: fakeImage(url, Math.round((h * 2) / 3), h, { pic }) }; }
      throw new Error('offline');
    };
  }
  const NEBEL = { title: 'Die vergessene Kartografie der Nebelinseln', author: 'Hartmut Quellbrunn', language: 'de' };
  const named = 'Die vergessene Kartografie der Nebelinseln von Hartmut Quellbrunn';
  await test('the picture two engines found wins over the single result of one; the second engine only when the first is not sure', async () => {
    const calls = [];
    const fetch = engineFetch({
      bing: () => [{ pic: 'X', page: 'https://www.buchladen-eins.example/nebelinseln', title: named }, { pic: 'A', page: 'https://www.verlag-zwei.example/kartografie', title: named },
        { pic: 'L', page: 'https://www.reiseblog.example/nebel', title: 'Nebel über den Inseln', w: 1200, h: 700 }],
      yandex: () => [{ pic: 'A', page: 'https://www.buchhandlung-drei.example/p/1', title: named }, { pic: 'Y', page: 'https://www.forum.example/t/2', title: 'Karten zeichnen im Nebel', w: 900, h: 600 }],
    }, calls);
    const { wc, add } = setup({ fetch, settings: { coverEngines: { bing: true, yandex: true, duckduckgo: false } } });
    wc.net.rests['www.googleapis.com'] = { until: Date.now() + 3600e3 };
    const book = add('n', NEBEL);
    await wc.fastCover(book);
    assert(wc.imageDue(book), 'the catalogues did not know it');
    const r = await wc.imageCover(book);
    assert(r.cover, 'a cover');
    assert.strictEqual(book.coverWeb.via, 'bing', 'loaded from Bing\'s cache');
    assert(/\/A-1\.jpg$/.test(book.coverWeb.image), 'the picture both engines found: ' + book.coverWeb.image);
    assert.deepStrictEqual(wc.stats.engines, { bing: 1, yandex: 1 });
    const c = wc.cache.get('n');
    const bingOnly = M.pickCover(c.cands.filter((x) => x.engine === 'bing'), c.query);
    assert(bingOnly && /\/X-0\.jpg$/.test(bingOnly.group.rep.image), 'Bing alone would have taken its first result');
    assert.strictEqual(M.pickCover(c.cands, c.query).group.engines, 2);
    assert(!calls.some((x) => /img\.example/.test(x.url)), 'no picture from the websites themselves');
    // the choice in the book info shows which engines found a picture
    const items = (await wc.candidates('n')).items.filter((it) => it.source === 'web');
    assert(items.some((it) => it.engines.length === 2 && it.current), JSON.stringify(items.map((it) => [it.engines, it.current])));
  });
  await test('a picture two sites of the first engine agree on: no other engine is asked', async () => {
    const fetch = engineFetch({ bing: () => [{ pic: 'A', page: 'https://www.verlag-zwei.example/k', title: named }, { pic: 'A', page: 'https://www.buchhandlung-drei.example/p/1', title: named }], yandex: () => [] });
    const { wc, add } = setup({ fetch, settings: { coverEngines: { bing: true, yandex: true, duckduckgo: false } } });
    wc.net.rests['www.googleapis.com'] = { until: Date.now() + 3600e3 };
    const book = add('n', NEBEL);
    await wc.fastCover(book);
    assert((await wc.imageCover(book)).cover);
    assert.deepStrictEqual(wc.stats.engines, { bing: 1 });
  });
  await test('free engines in proportion to their budgets: Bing most, DuckDuckGo seldom; after Bing\'s answer DuckDuckGo is not asked', async () => {
    const calls = [];
    const { wc, add } = setup({ fetch: engineFetch({ bing: () => [], yandex: () => [] }, calls) });   // all three engines on
    wc.net.rests['www.googleapis.com'] = { until: Date.now() + 3600e3 };
    const book = add('n', NEBEL);
    await wc.fastCover(book);
    const engineOf = (c) => (/bing\.com/.test(c.host) ? 'bing' : /yandex\.com/.test(c.host) ? 'yandex' : /duckduckgo/.test(c.host) ? 'duckduckgo' : null);
    const asked = (from) => calls.slice(from).map(engineOf).filter((e, i, a) => e && a.indexOf(e) === i);
    let from = calls.length;
    await wc.webSearch(book);
    assert.deepStrictEqual(asked(from), ['bing', 'yandex'], 'Bing first, then an index of its own (DuckDuckGo shows Bing\'s pictures)');
    // many searches later: DuckDuckGo's turn (one search in about thirty); when it cannot answer, Bing and Yandex still can
    wc.stats.engines = { bing: 30, yandex: 8, duckduckgo: 0 };
    from = calls.length;
    await wc.webSearch(book);
    assert.deepStrictEqual(asked(from), ['duckduckgo', 'bing', 'yandex']);
    assert(wc.stats.ddgRequests >= 1, 'counted');
  });
  await test('DuckDuckGo and Bing agreeing is one voice (one index); Bing and Yandex agreeing are two', () => {
    const q = M.coverQuery(NEBEL);
    const fp = M.fingerprint(seeded('picture A'), 0.667);
    const c = (engine, rank) => ({ rank, engine, site: 'buchladen-eins.example', title: named, url: 'https://www.buchladen-eins.example/nebel', image: 'https://img.example/a.jpg', thumbnail: 'https://t.example/a', width: 600, height: 900, aspect: 0.667, fp });
    assert.strictEqual(M.pickCover([c('bing', 0), c('duckduckgo', 0)], q).confidence, 'single');
    assert.strictEqual(M.pickCover([c('bing', 0), c('yandex', 0)], q).confidence, 'cluster');
    // without a known author one site is not enough, two indexes are
    const q0 = M.coverQuery({ ...NEBEL, author: '' });
    assert.strictEqual(M.pickCover([c('bing', 0), c('duckduckgo', 0)], q0), null);
    assert.strictEqual(M.pickCover([c('bing', 0), c('yandex', 0)], q0).confidence, 'cluster');
  });
  await test('pages about a summary or the audio book do not name the book for their picture', () => {
    const q = M.coverQuery({ title: 'Das Fräulein von Scuderi', author: 'E. T. A. Hoffmann', language: 'de' });
    const c = (pic, rank, site, title) => ({ rank, engine: 'bing', site, title, url: `https://www.${site}/p/${rank}`, image: `https://img.example/${pic}-${rank}.jpg`, thumbnail: 'https://t.example/' + rank, width: 600, height: 905, aspect: 0.663, fp: M.fingerprint(seeded('picture ' + pic), 0.663) });
    // a summary site shows an edition in another language twice; the shop's one picture names the book
    const cands = [c('P', 0, 'zusammenfassungen.example', 'Hoffmann Zusammenfassung | Das Fräulein von Scuderi von E. T. A. Hoffmann'), c('P', 1, 'hoerbuch.example', 'Das Fräulein von Scuderi Hörbuch von E. T. A. Hoffmann'), c('H', 2, 'buchhandlung.example', 'Das Fräulein von Scuderi von E. T. A. Hoffmann - Buch')];
    const pick = M.pickCover(cands, q);
    assert(pick && /\/H-2\.jpg$/.test(pick.group.rep.image), 'the picture of the shop: ' + JSON.stringify(pick && pick.group.rep.image));
    assert(M.companionPage(cands[0]) && M.companionPage(cands[1]) && !M.companionPage(cands[2]));
    assert.strictEqual(M.pickCover(cands.slice(0, 2), q), null, 'the summary and the audio book alone: no cover');
  });
  await test('a title without an author that says little ("Strategie") never goes to the image search', async () => {
    const calls = [];
    const { wc, add } = setup({ fetch: engineFetch({ bing: () => [] }, calls) });
    wc.net.rests['www.googleapis.com'] = { until: Date.now() + 3600e3 };
    const vague = add('v', { title: 'Strategie', author: '', language: 'de' });
    const long = add('l', { title: 'Die vergessene Kartografie der Nebelinseln', author: '', language: 'de' });
    await wc.fastCover(vague);
    await wc.fastCover(long);
    assert(!wc.imageDue(vague) && wc.imageDue(long), 'a title of several words may go');
    assert.strictEqual(wc.nextBook(), long);
    const st = wc.status();
    assert(st.missed === 1 && st.waiting === 1, JSON.stringify({ missed: st.missed, waiting: st.waiting }));
  });
  await test('a long word in another spelling still names the book ("Proceß", "Prozeß", "Prozess"); a portfolio site never alone', () => {
    const q = M.coverQuery({ title: 'Der Proceß', author: 'Franz Kafka', language: 'de' });
    assert.strictEqual(M.wordMatch(q.titleWords, 'Der Prozeß. Buch von Franz Kafka'), 1);
    assert.strictEqual(M.wordMatch(q.titleWords, 'Der Prozess - Franz Kafka (Buch)'), 1);
    assert.strictEqual(M.wordMatch(['mutter'], 'Butter und Brot'), 0, 'another first letter: another word');
    assert(M.siteWeight('behance.net') < 1 && M.siteWeight('dribbble.com') < 1 && M.siteWeight('buchhandlung-eins.example') === 1);
  });
  await test('an engine that sends a captcha rests, the next free one answers in its place', async () => {
    const fetch = engineFetch({ bing: () => 'captcha', yandex: () => [{ pic: 'A', page: 'https://www.verlag-zwei.example/k', title: named }, { pic: 'A', page: 'https://www.buchhandlung-drei.example/p/1', title: named }] });
    const { wc, add } = setup({ fetch, settings: { coverEngines: { bing: true, yandex: true, duckduckgo: false } } });
    wc.net.rests['www.googleapis.com'] = { until: Date.now() + 3600e3 };
    const book = add('n', NEBEL);
    await wc.fastCover(book);
    const r = await wc.imageCover(book);
    assert(r.cover && book.coverWeb.via === 'yandex', JSON.stringify(book.coverWeb));
    assert(wc.engineWait('bing') > 29 * 60e3, 'Bing rests');
    assert.strictEqual(wc.stats.refused, 1);
    // nothing convincing on the engine that answers: a miss, asked again after days
    const other = add('o', { title: 'Das stille Archiv der Wolkenleser', author: 'Hartmut Quellbrunn', language: 'de' });
    await wc.fastCover(other);
    assert(!(await wc.imageCover(other)).cover);
    assert(wc.state.misses.o && !wc.state.misses.o.soft, 'a miss: ' + JSON.stringify(wc.state.misses.o));
  });
  await test('the image search only for books the catalogues did not know; every request to DuckDuckGo is counted', async () => {
    const { wc, add } = setup({ fetch: replayFetch(), settings: { coverEngines: { bing: false, yandex: false, duckduckgo: true } } });
    wc.net.rests['www.googleapis.com'] = { until: Date.now() + 3600e3 };
    const known = add('k', { title: 'Woyzeck', author: 'Georg Büchner', language: 'de' });
    const unknown = add('u', { title: 'Die vergessene Kartografie der Nebelinseln', author: 'Hartmut Quellbrunn', language: 'de' });
    assert.strictEqual(wc.nextBook(), null, 'nobody before the catalogues');
    await wc.fastCover(known);
    await wc.fastCover(unknown);
    assert.strictEqual(wc.nextBook(), unknown);
    await wc.findCover(unknown);
    assert(wc.stats.ddgRequests >= 1 && wc.state.ddg.count >= 1, 'counted');
    assert(wc.state.misses.u?.soft, 'not reachable: asked again within hours');
    // all engines switched off: no book waits for them
    wc.settings.data.coverEngines = NO_ENGINES;
    delete wc.state.misses.u;
    assert(!wc.imageDue(unknown) && wc.nextBook() === null);
  });

  // the made-up searches of the engines about sample books (make-fixtures.js), with what each engine must give by the
  // present rules (cover-sample.js `web`)
  for (const smp of ENG.samples || []) {
    const want = SAMPLE.find((x) => x.book.title === smp.book.title)?.web?.[smp.engine];
    await test(`${IE.ENGINE_NAME[smp.engine]}: ${smp.book.title.slice(0, 50)} → ${want === null ? 'no cover' : want || 'the designed picture'}`, async () => {
      const fetch = async (url) => {
        const r = smp.responses[url.replace(/([?&]vqd=)[\d-]+/, '$14-0')];
        if (!r) throw new Error('offline (no fixture for ' + url.slice(0, 90) + ')');
        if (r.image) return { ok: r.ok, status: r.status, contentType: r.contentType, buffer: r.ok ? fakeImage(url, r.image.w, r.image.h, r.image) : Buffer.from('') };
        return { ok: r.ok, status: r.status, contentType: r.contentType, buffer: Buffer.from(r.text || '') };
      };
      const { wc, add } = setup({ fetch });
      const book = add('e', { ...smp.book });
      const res = await wc.webSearch(book, { only: [smp.engine], max: 1 });
      assert(res.answered, 'answered');
      const found = res.pick ? await wc.downloadGroup(res.pick.group) : null;
      if (want === null) { assert.strictEqual(found, null, 'better no cover than a wrong one: ' + (found && found.image)); return; }
      if (want) assert.strictEqual(found && found.site, want);
      assert.strictEqual(found ? found.image : null, smp.pick, 'the designed picture');
    });
  }

  // ---------------------------------------------------------------- Alle Cover jetzt laden ---------------------------
  console.log('Alle Cover jetzt laden');
  // a catalogue for a whole made-up library: Open Library knows six of seven titles and has a picture of each
  const synthFetch = (delay = 5) => async (url) => {
    await new Promise((r) => setTimeout(r, delay));
    const u = new URL(url);
    const h = (s) => crypto.createHash('sha1').update(s).digest().readUInt32BE(0);
    if (u.hostname === 'openlibrary.org') {
      const q = u.searchParams.get('q') || '';
      if (!q || h(q) % 7 === 0) return { ok: true, status: 200, contentType: 'application/json', buffer: Buffer.from('{"numFound":0,"docs":[]}') };
      return { ok: true, status: 200, contentType: 'application/json', buffer: Buffer.from(JSON.stringify({ docs: [{ key: '/works/W' + h(q), title: q, author_name: [u.searchParams.get('author') || 'X'], language: ['ger'], cover_i: h(q) % 1e7, editions: { docs: [] } }] })) };
    }
    if (u.hostname === 'covers.openlibrary.org') return { ok: true, status: 200, contentType: 'image/jpeg', buffer: fakeImage(url, 400, 600) };
    if (u.hostname === 'services.dnb.de') return { ok: true, status: 200, contentType: 'application/xml', buffer: Buffer.from('<searchRetrieveResponse/>') };
    if (u.hostname === 'itunes.apple.com') return { ok: true, status: 200, contentType: 'application/json', buffer: Buffer.from('{"results":[]}') };
    throw new Error('offline');
  };
  const WORDS = ['Garten', 'Fluss', 'Berge', 'Stadt', 'Licht', 'Wolken', 'Sterne', 'Meer', 'Wald', 'Insel', 'Brücke', 'Turm', 'Feuer', 'Winter', 'Sommer', 'Sprache'];
  const library = (add, count) => { for (let i = 0; i < count; i++) add('x' + i, { title: `Die Geschichte der ${WORDS[i % 16]} von ${WORDS[(i * 7 + 3) % 16]} Teil ${1 + (i % 9)}${i}`, author: ['Anna Lehmann', 'Peter Hoffmann', 'Julia Winter'][i % 3], language: 'de', relPath: `F${i % 4}/x${i}.pdf` }); };
  await test('a run over all books: six at a time, each cover stored at once, found and not found counted', async () => {
    const events = [];
    const { wc, add, lib } = setup({ fetch: synthFetch(), settings: { coverEngines: NO_ENGINES } });
    wc.net.rests['www.googleapis.com'] = { until: Date.now() + 3600e3 };
    wc.batch.emit = (s) => events.push(s);
    library(add, 40);
    add('done', { title: 'Ein Buch mit Cover', coverGenerated: false, coverWeak: null });
    const st = wc.batch.start();
    assert.strictEqual(st.total, 40);
    let most = 0;
    const tick = setInterval(() => { most = Math.max(most, wc.batch.current.size); }, 2);
    while (wc.batch.running) await new Promise((r) => setTimeout(r, 20));
    clearInterval(tick);
    const s = wc.batch.status();
    assert.strictEqual(s.state, 'done');
    assert.strictEqual(s.done, 40);
    assert.strictEqual(s.found + s.missed + s.failed + s.skipped, 40);
    assert(s.found >= 30 && s.missed >= 1, JSON.stringify(s));
    assert(most <= 6 && most >= 4, 'six books at a time at most: ' + most);
    // the events are throttled in time: on Windows the 40 books take about 1.3 s and give 6 or 7 of them, on a fast
    // Ubuntu runner they finish sooner and give 4. Progress during the run and far fewer than one per request is the point.
    assert(events.length >= 3 && events.length < 200, 'progress events, not one per request: ' + events.length);
    const got = Object.values(lib.books).filter((b) => b.coverSource === 'web');
    assert.strictEqual(got.length, s.found);
    assert(got.every((b) => fs.readFileSync(lib.coverPath(b.id), 'utf8').startsWith('JPEG ')), 'stored');
    assert.strictEqual(wc.status().pending, 0, 'nothing left for the catalogues');
    assert(wc.picks.size === 0 && wc.cache.size === 0, 'no pictures kept in memory');
  });
  await test('pause, continue, cancel; a restart continues a running batch where it stopped', async () => {
    const ud = path.join(tmp, 'restart');
    let { wc, add, lib } = setup({ fetch: synthFetch(15), ud, settings: { coverEngines: NO_ENGINES } });
    wc.net.rests['www.googleapis.com'] = { until: Date.now() + 3600e3 };
    library(add, 30);
    lib.db.flush();
    wc.batch.start();
    while (wc.batch.status().done < 6) await new Promise((r) => setTimeout(r, 5));
    wc.batch.pause();
    while (wc.batch.active) await new Promise((r) => setTimeout(r, 5));
    const paused = wc.batch.status();
    assert.strictEqual(paused.state, 'paused');
    await new Promise((r) => setTimeout(r, 120));
    assert.strictEqual(wc.batch.status().done, paused.done, 'nothing happens while paused');
    wc.batch.resume();
    while (wc.batch.status().done < paused.done + 6) await new Promise((r) => setTimeout(r, 5));
    // the app quits in the middle of the run: the books asked about right then are remembered
    wc.stop();
    const saved = JSON.parse(fs.readFileSync(path.join(ud, 'web-covers.json'), 'utf8')).batch;
    assert(saved.state === 'running' && saved.active.length >= 1, 'in flight: ' + JSON.stringify(saved.active));
    while (wc.batch.active) await new Promise((r) => setTimeout(r, 5));
    wc.store.flush(); lib.db.flush();
    const before = wc.batch.status();
    assert.strictEqual(before.state, 'running', 'it was running when the app quit');
    // the next start: the same data folder, the run goes on by itself
    ({ wc, lib } = setup({ fetch: synthFetch(5), ud, settings: { coverEngines: NO_ENGINES } }));
    wc.net.rests['www.googleapis.com'] = { until: Date.now() + 3600e3 };
    assert.strictEqual(wc.batch.status().done, before.done, 'where it stopped');
    wc.batch.restore();
    while (wc.batch.running) await new Promise((r) => setTimeout(r, 10));
    const after = wc.batch.status();
    assert.strictEqual(after.state, 'done');
    assert.strictEqual(after.done, after.total);
    assert(Object.values(lib.books).filter((b) => b.coverSource === 'web').length >= 22);
    // cancel: stops, keeps what was found, forgets the rest
    for (const b of Object.values(lib.books)) if (b.coverSource === 'web') wc.useTitleCard(b.id) && delete b.coverChoice && (b.coverSource = undefined);
    wc.forgetMisses();
    wc.batch.start();
    while (wc.batch.status().done < 3) await new Promise((r) => setTimeout(r, 5));
    wc.batch.cancel();
    while (wc.batch.active) await new Promise((r) => setTimeout(r, 5));
    const c = wc.batch.status();
    assert.strictEqual(c.state, 'cancelled');
    assert(c.done < c.total);
    assert.strictEqual(wc.state.batch.ids.length, 0);
    wc.stop();
  });
  await test('after a restart the books that were in flight come first again; those waiting for an engine keep waiting', () => {
    const { CoverBatch } = require('./cover-batch');
    const fake = { state: { batch: { state: 'paused', ids: ['a', 'b', 'c', 'd'], next: 3, active: ['b', 'c'], later: ['e'], total: 5, done: 1 } }, store: { save() {} } };
    new CoverBatch(fake).restore();
    assert.deepStrictEqual(fake.state.batch.ids, ['b', 'c', 'd']);
    assert.strictEqual(fake.state.batch.next, 0);
    assert.deepStrictEqual(fake.state.batch.active, []);
    assert.deepStrictEqual(fake.state.batch.later, ['e']);
  });
  await test('books the catalogues do not know go to the image search at once, or wait for an engine\'s budget', async () => {
    const calls = [];
    // every book's picture on two sites of Bing (Yandex and DuckDuckGo switched off)
    const pic = (q) => 'P' + crypto.createHash('sha1').update(q).digest('hex').slice(0, 10);
    const fetch = engineFetch({ bing: (q) => [{ pic: pic(q), page: 'https://www.verlag.example/' + pic(q), title: q }, { pic: pic(q), page: 'https://www.buchhandlung.example/' + pic(q), title: q }] }, calls);
    const { wc, add, lib } = setup({ fetch, settings: { coverEngines: { bing: true, yandex: false, duckduckgo: false } } });
    wc.net.rests['www.googleapis.com'] = { until: Date.now() + 3600e3 };
    // the manners in small: Bing three searches in 400 ms, the other hosts without pauses
    wc.net.pace = 1;
    for (const k of ['openlibrary.org', 'covers.openlibrary.org', 'services.dnb.de', 'itunes.apple.com', 'www.goodreads.com', 'archive.org', 'bing.net']) wc.net.host(k).conf = { conc: 3, gap: 0 };
    wc.net.host('www.bing.com').conf = { conc: 1, gap: 0, window: [3, 400] };
    library(add, 12);
    const events = [];
    wc.batch.emit = (st) => events.push(st);
    wc.batch.start();
    while (wc.batch.running) await new Promise((r) => setTimeout(r, 20));
    const st = wc.batch.status();
    assert.strictEqual(st.state, 'done');
    assert.strictEqual(st.found, 12, JSON.stringify(st));
    assert(Object.values(lib.books).every((b) => b.coverWeb?.via === 'bing'), 'from Bing\'s cache');
    assert(events.some((e) => e.later > 0), 'books waited for the budget');
    const searches = calls.filter((c) => c.host === 'www.bing.com').map((c) => c.at);
    assert.strictEqual(searches.length, 12, 'one search a book');
    for (let i = 3; i < searches.length; i++) assert(searches[i] - searches[i - 3] >= 390, 'never more than three in 400 ms: ' + (searches[i] - searches[i - 3]));
    assert(!calls.some((c) => /img\.example/.test(c.url)), 'no picture from the websites themselves');
    wc.stop();
  });
  await test('every engine switched off while books wait for one: they count as not found, the run ends', async () => {
    const fetch = engineFetch({ bing: (q) => [{ pic: 'Q', page: 'https://www.verlag.example/q', title: q }, { pic: 'Q', page: 'https://www.buchhandlung.example/q', title: q }] });
    const { wc, add, settings } = setup({ fetch, settings: { coverEngines: { bing: true, yandex: false, duckduckgo: false } } });
    wc.net.rests['www.googleapis.com'] = { until: Date.now() + 3600e3 };
    wc.net.pace = 1;
    for (const k of ['openlibrary.org', 'covers.openlibrary.org', 'services.dnb.de', 'itunes.apple.com', 'www.goodreads.com', 'archive.org', 'bing.net']) wc.net.host(k).conf = { conc: 3, gap: 0 };
    wc.net.host('www.bing.com').conf = { conc: 1, gap: 0, window: [1, 60e3] };
    library(add, 6);
    wc.batch.start();
    for (let i = 0; i < 500 && wc.batch.status().later < 5; i++) await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(wc.batch.status().later, 5, 'five books wait for Bing\'s next minute');
    settings.data.coverEngines = NO_ENGINES;
    while (wc.batch.running) await new Promise((r) => setTimeout(r, 20));
    const st = wc.batch.status();
    assert.strictEqual(st.state, 'done');
    assert(st.done === st.total && st.found === 1 && st.missed === 5, JSON.stringify(st));
    wc.stop();
  });
  await test('"Erneut versuchen": the books without a match are asked again', async () => {
    const { wc, add } = setup({ fetch: synthFetch(), settings: { coverEngines: NO_ENGINES } });
    wc.net.rests['www.googleapis.com'] = { until: Date.now() + 3600e3 };
    library(add, 20);
    wc.batch.start();
    while (wc.batch.running) await new Promise((r) => setTimeout(r, 10));
    const missed = wc.batch.status().missed;
    assert(missed >= 1);
    assert.strictEqual(wc.batch.start().total, 0, 'a new run asks nobody again');
    while (wc.batch.running) await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(wc.forgetMisses(), missed);
    const again = wc.batch.start({ retry: true });
    assert.strictEqual(again.total, missed);
    while (wc.batch.running) await new Promise((r) => setTimeout(r, 10));
    wc.stop();
  });

  // ---------------------------------------------------------------- more catalogues, spread over all ---------------
  console.log('more catalogues, spread over all');
  await test('ISBN-10 for Amazon (978 only), the ASIN of a file name, Amazon\'s 1 × 1 GIF is no cover', async () => {
    assert.strictEqual(BM.isbn10('9783928392372'), '3928392379');
    assert.strictEqual(BM.isbn10('9783914583555'), '391458355X');
    assert.strictEqual(BM.isbn10('9791032305690'), null, '979 has no ISBN-10');
    const k = BM.bookKey({ title: 'Neue Wege im Damengambit Band 1 (B0XAMPLE12)', author: '', relPath: 'Schach/x.pdf' });
    assert.strictEqual(k.asin, 'B0XAMPLE12');
    assert(!k.all.includes('b0xample12'), 'the ASIN is no word of the title');
    assert.strictEqual(BM.bookKey({ title: 'Woyzeck', relPath: 'Dramen/Woyzeck (B07XYZ1234).epub' }).asin, 'B07XYZ1234');
    assert.strictEqual(S.amazonCover('9783928392372').url, 'https://m.media-amazon.com/images/P/3928392379.01._SCLZZZZZZZ_.jpg');
    assert.strictEqual(S.amazonCover('B0XAMPLE12').url, 'https://m.media-amazon.com/images/P/B0XAMPLE12.01._SCLZZZZZZZ_.jpg');
    // the GIF Amazon sends for an ISBN it has no picture of
    const gif = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
    const { wc } = setup({ fetch: async () => ({ ok: true, status: 200, contentType: 'image/gif', buffer: gif }) });
    assert.strictEqual(await wc.fetchCover(S.amazonCover('9783928392372').url), null);
  });
  await test('Goodreads: title, author, series out of the title, the picture in full size; none for "nophoto"', () => {
    const recs = S.parseGoodreads([
      { bookId: '1', title: 'Die stille Bucht (Die Gezeiten von Morland, #2)', bookTitleBare: 'Die stille Bucht', author: { name: 'Konrad  Wieseneck' }, imageUrl: 'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1i/2._SY75_.jpg' },
      { bookId: '3', title: 'Neue Wege im Damengambit Band 1 (German Edition)', bookTitleBare: 'Neue Wege im Damengambit Band 1 (German Edition)', author: { name: 'Lorenz Kiefer' }, imageUrl: 'https://s.gr-assets.com/assets/nophoto/book/50x75.png' },
    ], { isbn: '9783928392372' });
    assert.deepStrictEqual([recs[0].title, recs[0].authors[0], recs[0].series, recs[0].seriesIndex, recs[0].isbnOwn], ['Die stille Bucht', 'Konrad Wieseneck', 'Die Gezeiten von Morland', 2, '9783928392372']);
    assert.strictEqual(recs[0].cover.url, 'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1i/2.jpg');
    assert.strictEqual(recs[1].title, 'Neue Wege im Damengambit Band 1');
    assert.strictEqual(recs[1].cover, null, 'no picture');
    assert.strictEqual(recs[1].isbnOwn, null, 'the ISBN asked for belongs to the first one only');
    assert.strictEqual(new URL(S.goodreadsUrl({ title: 'Woyzeck', author: 'Georg Büchner' })).searchParams.get('q'), 'Woyzeck', 'the title alone');
  });
  await test('Internet Archive: books by title and surname, the creator without years and roles, the scanned cover', () => {
    const recs = S.parseArchive({ response: { docs: [{ identifier: 'effibriestroman0000font', title: 'Effi Briest, Roman', creator: 'Fontane, Theodor 1819- VerfasserIn', date: '2017-01-01T00:00:00Z', language: 'ger' }] } });
    assert.deepStrictEqual([recs[0].authors[0], recs[0].language, BM.yearOf(recs[0].year)], ['Theodor Fontane', 'de', 2017]);
    assert.strictEqual(recs[0].cover.url, 'https://archive.org/download/effibriestroman0000font/page/cover_w600.jpg');
    const q = new URL(S.archiveUrl({ title: 'Effi Briest, Roman', author: 'Fontane, Theodor' })).searchParams.get('q');
    assert.strictEqual(q, 'title:(Effi Briest Roman) AND creator:(Fontane) AND mediatype:(texts)');
  });
  await test('Google Books with the reader\'s key: the key goes along, a rest of the keyless requests ends, the key is never recorded', async () => {
    assert.strictEqual(new URL(S.googleUrl({ title: 'Woyzeck', author: 'Büchner', key: 'TEST-KEY-123' })).searchParams.get('key'), 'TEST-KEY-123');
    const seen = [];
    const fetch = async (url) => { seen.push(url); return { ok: true, status: 200, contentType: 'application/json', buffer: Buffer.from(/googleapis/.test(url) ? '{"items":[]}' : /goodreads/.test(url) ? '[]' : /archive\.org/.test(url) ? '{"response":{"docs":[]}}' : /dnb/.test(url) ? '<searchRetrieveResponse/>' : '{"docs":[],"results":[]}') }; };
    const { wc, add, settings } = setup({ fetch });
    wc.net.rests['www.googleapis.com'] = { until: Date.now() + 3600e3, why: 'quota' };
    const book = add('m', { title: 'Woyzeck', author: 'Georg Büchner', language: 'de' });
    await wc.lookup(book, { cover: true, every: true });
    assert(!seen.some((u) => /googleapis/.test(u)), 'without a key: not asked while resting');
    settings.data.googleBooksKey = 'TEST-KEY-123';
    await wc.lookup(book, { cover: true, every: true });
    assert(seen.some((u) => /googleapis.*key=TEST-KEY-123/.test(u)), 'with the key: asked');
    // a recording keeps the address without the key
    const dir = fs.mkdtempSync(path.join(tmp, 'fx-'));
    const rec = require('./web-covers').fixtureFetch(dir, async () => ({ ok: true, status: 200, contentType: 'application/json', buffer: Buffer.from('{}') }), true);
    await rec('https://www.googleapis.com/books/v1/volumes?q=x&key=TEST-KEY-123');
    const saved = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
    assert(saved && !/TEST-KEY/.test(saved), saved);
  });
  // a made-up world of catalogues that know every title: each answers after a moment
  const knowAll = (calls, delay = 30) => async (url) => {
    const u = new URL(url);
    calls.push({ host: u.hostname, path: u.pathname, at: Date.now() });
    await new Promise((r) => setTimeout(r, delay));
    const json = (o) => ({ ok: true, status: 200, contentType: 'application/json', buffer: Buffer.from(JSON.stringify(o)) });
    const words = (q) => String(q || '').split(/\s+/);
    const num = (t) => crypto.createHash('sha1').update(String(t)).digest().readUInt32BE(0) % 1e7;   // one picture per title
    const isbnFor = (n) => { const core = '978' + String(100000000 + (n % 900000000)).slice(0, 9); let sum = 0; for (let i = 0; i < 12; i++) sum += (i % 2 ? 3 : 1) * +core[i]; return core + ((10 - (sum % 10)) % 10); };
    if (u.hostname === 'openlibrary.org') { const q = u.searchParams.get('q'); return json({ docs: [{ key: '/works/W' + num(q), title: q, author_name: [u.searchParams.get('author')], language: ['ger'], cover_i: num(q), editions: { docs: [] } }] }); }
    if (u.hostname === 'www.goodreads.com') { const w = words(u.searchParams.get('q')); return json([{ bookId: String(num(w)), title: w.slice(0, -1).join(' '), bookTitleBare: w.slice(0, -1).join(' '), author: { name: w[w.length - 1] }, imageUrl: `https://i.gr-assets.com/images/S/x/books/1i/${num(w)}._SY75_.jpg` }]); }
    if (u.hostname === 'archive.org' && u.pathname === '/advancedsearch.php') { const q = u.searchParams.get('q'); const t = /title:\(([^)]*)\)/.exec(q)[1], c = /creator:\(([^)]*)\)/.exec(q)?.[1]; return json({ response: { docs: [{ identifier: 'id' + num(t), title: t, creator: [c], language: 'ger' }] } }); }
    if (u.hostname === 'services.dnb.de') { const m = /^tit=(.+?)(?: and per=(.+))?$/.exec(u.searchParams.get('query')); return { ok: true, status: 200, contentType: 'application/xml', buffer: Buffer.from(`<searchRetrieveResponse><records><recordData><record><leader>00000nam a2200000 c 4500</leader><datafield tag="100" ind1="1" ind2=" "><subfield code="a">${m[2]}</subfield></datafield><datafield tag="245" ind1="1" ind2="0"><subfield code="a">${m[1]}</subfield></datafield><datafield tag="020" ind1=" " ind2=" "><subfield code="a">${isbnFor(num(m[1]))}</subfield></datafield></record></recordData></records></searchRetrieveResponse>`) }; }
    if (u.hostname === 'itunes.apple.com') return json({ results: [] });
    if (/covers\.openlibrary\.org|gr-assets|portal\.dnb\.de|media-amazon|archive\.org/.test(u.hostname)) return { ok: true, status: 200, contentType: 'image/jpeg', buffer: fakeImage(url, 400, 600) };
    throw new Error('offline');
  };
  await test('a run spreads over the catalogues: each book asks the one free right now, each catalogue keeps its pause', async () => {
    // every catalogue one request at a time, 200 ms apart; the pictures without pauses; `only`: the others rest
    const runOf = async (only = null) => {
      const calls = [];
      const { wc, add } = setup({ fetch: knowAll(calls), settings: { coverEngines: NO_ENGINES } });
      wc.net.rests['www.googleapis.com'] = { until: Date.now() + 3600e3 };
      wc.net.pace = 1;
      for (const k of ['openlibrary.org', 'www.goodreads.com', 'services.dnb.de', 'archive.org']) {
        wc.net.host(k).conf = { conc: 1, gap: 200 };
        if (only && k !== only) wc.net.rests[k] = { until: Date.now() + 3600e3 };
      }
      for (const k of ['covers.openlibrary.org', 'i.gr-assets.com', 'portal.dnb.de', 'm.media-amazon.com']) wc.net.host(k).conf = { conc: 4, gap: 0 };
      library(add, 24);
      const t0 = Date.now();
      wc.batch.start();
      while (wc.batch.running) await new Promise((r) => setTimeout(r, 10));
      const ms = Date.now() - t0;
      const st = wc.batch.status();
      wc.stop();
      const by = {};
      for (const c of calls) if (['openlibrary.org', 'www.goodreads.com', 'services.dnb.de'].includes(c.host) || (c.host === 'archive.org' && c.path === '/advancedsearch.php')) (by[c.host] = by[c.host] || []).push(c.at);
      return { ms, st, by, count: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.length])) };
    };
    const one = await runOf('openlibrary.org');
    const all = await runOf();
    assert.strictEqual(all.st.found, 24, JSON.stringify(all.st));
    assert.strictEqual(one.st.found, 24, JSON.stringify(one.st));
    assert(Object.keys(all.by).length >= 3, 'several catalogues at once: ' + JSON.stringify(all.count));
    for (const [host, times] of Object.entries(all.by)) for (let i = 1; i < times.length; i++) assert(times[i] - times[i - 1] >= 190, `${host} keeps its pause: ${times[i] - times[i - 1]} ms`);
    const searches = Object.values(all.count).reduce((a, b) => a + b, 0);
    // which catalogue a book gets depends on the timing, and some answers lead to one more search for the missing
    // fields: 26 or 27 searches for the 24 books on Windows, 31 on Ubuntu. More than 1.4 a book would be a fault.
    assert(searches <= 34, 'about one search a book: ' + searches);
    assert(all.ms < one.ms * 0.75, `faster than one catalogue alone: ${all.ms} ms against ${one.ms} ms ` + JSON.stringify(all.count));
  });
  await test('Amazon\'s picture of an edition a catalogue names by ISBN; the metadata stay the catalogue\'s', async () => {
    const calls = [];
    const fetch = async (url) => {
      const u = new URL(url);
      calls.push(url);
      if (u.hostname === 'services.dnb.de') return { ok: true, status: 200, contentType: 'application/xml', buffer: Buffer.from('<searchRetrieveResponse><records><recordData><record><leader>00000nam a2200000 c 4500</leader><datafield tag="020" ind1=" " ind2=" "><subfield code="a">9783928392372</subfield></datafield><datafield tag="100" ind1="1" ind2=" "><subfield code="a">Fontane, Theodor</subfield></datafield><datafield tag="245" ind1="1" ind2="0"><subfield code="a">Effi Briest</subfield></datafield><datafield tag="264" ind1=" " ind2="1"><subfield code="b">Lindenhof Verlag</subfield><subfield code="c">2016</subfield></datafield></record></recordData></records></searchRetrieveResponse>') };
      if (u.hostname === 'portal.dnb.de') return { ok: false, status: 404, contentType: 'text/html', buffer: Buffer.from('') };
      if (u.hostname === 'm.media-amazon.com') return { ok: true, status: 200, contentType: 'image/jpeg', buffer: fakeImage(url, 316, 500) };
      throw new Error('offline');
    };
    const { wc, add } = setup({ fetch });
    wc.net.rests['www.googleapis.com'] = { until: Date.now() + 3600e3 };
    const book = add('k', { title: 'Effi Briest', author: 'Theodor Fontane', language: 'de' });
    const r = await wc.fastCover(book);
    assert(r.found && book.coverWeb.via === 'amazon' && /3928392379/.test(book.coverWeb.image), JSON.stringify(book.coverWeb));
    assert.strictEqual(book.metaWeb.src.publisher, 'dnb', 'the metadata from the DNB record');
    assert(calls.some((u) => /portal\.dnb\.de/.test(u)), 'the DNB\'s own picture was tried first');
  });
  await test('an ASIN in the file name: Goodreads names the book, Amazon has its picture', async () => {
    const fetch = async (url) => {
      const u = new URL(url);
      if (u.hostname === 'www.goodreads.com') return { ok: true, status: 200, contentType: 'application/json', buffer: Buffer.from(u.searchParams.get('q') === 'B0XAMPLE12' ? JSON.stringify([{ bookId: '59000901', title: 'Neue Wege im Damengambit Band 1 (German Edition)', bookTitleBare: 'Neue Wege im Damengambit Band 1', author: { name: 'Lorenz  Kiefer' }, imageUrl: 'https://s.gr-assets.com/assets/nophoto/book/50x75.png' }]) : '[]') };
      if (u.hostname === 'm.media-amazon.com') return { ok: true, status: 200, contentType: 'image/jpeg', buffer: fakeImage(url, 344, 500) };
      if (u.hostname === 'services.dnb.de') return { ok: true, status: 200, contentType: 'application/xml', buffer: Buffer.from('<searchRetrieveResponse/>') };
      if (u.hostname === 'archive.org') return { ok: true, status: 200, contentType: 'application/json', buffer: Buffer.from('{"response":{"docs":[]}}') };
      return { ok: true, status: 200, contentType: 'application/json', buffer: Buffer.from('{"docs":[],"results":[]}') };
    };
    const { wc, add } = setup({ fetch });
    wc.net.rests['www.googleapis.com'] = { until: Date.now() + 3600e3 };
    const book = add('w', { title: 'Neue Wege im Damengambit Band 1', author: 'Lorenz Kiefer', language: 'de', relPath: 'Schach/Neue Wege im Damengambit Band 1 (B0XAMPLE12).pdf' });
    const r = await wc.fastCover(book);
    assert(r.found && book.coverWeb.via === 'amazon' && /B0XAMPLE12/.test(book.coverWeb.image), JSON.stringify(book.coverWeb));
  });
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(`\n${passed} passed, ${failed} failed`);
  return { passed, failed };
}

module.exports = { run };
if (require.main === module) run().then((r) => process.exit(r.failed ? 1 : 0), (e) => { console.error(e); process.exit(1); });
