// The online measurement of the covers from the internet: the real catalogues and engines about the sample of
// build/testlib/cover-sample.js. The tests do not use what it records: their fixtures are made up by
// electron/library/fixtures/make-fixtures.js. Runs in Electron's main process (no window, a data folder of its own) for
// the real picture decoder:
//   npx electron build/testlib/record-cover-sources.js <out folder> [--catalogues] [--engines] [--batch] [--no-save]
//   --catalogues  the book catalogues (Open Library, Goodreads, Apple Books, the DNB, the Internet Archive, Amazon's
//                 pictures by ISBN, Google Books) about the sample: per catalogue the books it knew and had a picture of,
//                 the cover the lookup picks, the time per book; their answers → <out>/answers/sources.json.gz
//   --engines     each image search engine about a handful of books of the sample (Bing 8, Yandex 4, DuckDuckGo 2):
//                 the picture each one picks; their answers → <out>/answers/engines.json.gz
//                 (--only=bing,yandex: these engines again, the answers of the others stay)
//   --batch       "Alle Cover jetzt laden" over the sample with the real budgets of every host, half of the books sent
//                 straight to the image search: books per minute and the work of each engine
//   --spread      "Alle Cover jetzt laden" over the sample as the app runs it (the catalogues first, spread over all of
//                 them): books per minute, the covers and requests of each catalogue
// The pictures go to <out> for a look by eye (python build/testlib/cover-sheet.py <out>). Every host is asked with the
// pauses and budgets of the app (DuckDuckGo: one search every three minutes). Only titles, authors and ISBNs are sent.
// The fixtures keep only what the parsers read (no request ids, no regions, no blurbs beyond their little words).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { app, nativeImage } = require('electron');
const M = require('../../electron/library/cover-match');
const BM = require('../../electron/library/book-match');
const IE = require('../../electron/library/image-engines');
const { imageSize } = require('../../electron/library/cover-sources');
const SAMPLE = require('./cover-sample');

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const out = path.resolve(argv.find((a) => !a.startsWith('--') && !/electron|record-cover/i.test(a)) || path.join(os.tmpdir(), 'lesesaal-cover-sample'));
const save = !flags.has('--no-save');
const parts = ['--catalogues', '--engines', '--batch', '--spread'].filter((f) => flags.has(f));
const only = (argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
if (!parts.length) parts.push('--catalogues');
fs.mkdirSync(out, { recursive: true });
app.setPath('userData', path.join(out, 'electron-data'));
app.disableHardwareAcceleration();
// the answers stay with the measurement (they hold real covers and searches): never in the repository
const FIX = path.join(out, 'answers');
fs.mkdirSync(FIX, { recursive: true });

// ---------------------------------------------------------------- the network ----------------------------------------
let memo = new Map(), log = [], allowDdg = false, ddgRequests = 0;
async function realFetch(url, { headers = {}, timeout = 15000, maxBytes = 8 << 20 } = {}) {
  if (/duckduckgo\.com/i.test(url)) { if (!allowDdg) throw new Error('DuckDuckGo is not asked in this part'); ddgRequests++; }
  if (memo && memo.has(url)) { log.push({ url, cached: true }); return memo.get(url); }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal, redirect: 'follow' });
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error('response too large');
    const r = { ok: res.ok, status: res.status, contentType: res.headers.get('content-type') || '', retryAfter: res.headers.get('retry-after'), url: res.url, buffer };
    if (memo) memo.set(url, r);
    log.push({ url, status: r.status, bytes: buffer.length, at: Date.now() });
    return r;
  } catch (e) { throw new Error(ctrl.signal.aborted ? 'timeout' : e.message); }
  finally { clearTimeout(timer); }
}

// the indexer window's look at a picture (app/src/indexer.js imageJob), with Electron's decoder in the main process
const seen = new Map();                 // bytes → what the decoder saw (for the fixture)
function decode(job) {
  const img = nativeImage.createFromBuffer(Buffer.from(job.bytes || []));
  if (img.isEmpty()) return Promise.resolve({ ok: false, error: 'undecodable' });
  const { width: W, height: H } = img.getSize();
  const s = Math.min(1, 200 / H);
  const small = s < 1 ? img.resize({ width: Math.max(1, Math.round(W * s)), height: Math.max(1, Math.round(H * s)), quality: 'good' }) : img;
  const { width: w, height: h } = small.getSize();
  const bgra = small.toBitmap();
  const rgba = Buffer.alloc(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) { rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = 255; }
  const o = { ok: true, width: W, height: H, stats: M.pageStats(rgba, w, h) };
  const ring = M.trimBox(rgba, w, h);
  const box = M.coverBox(rgba, w, h, ring);
  const crop = { x: Math.round(box.x0 / s), y: Math.round(box.y0 / s), width: Math.max(1, Math.round((box.x1 - box.x0) / s)), height: Math.max(1, Math.round((box.y1 - box.y0) / s)) };
  crop.width = Math.min(crop.width, W - crop.x); crop.height = Math.min(crop.height, H - crop.y);
  o.aspect = crop.width / crop.height; o.boxHeight = crop.height; o.trimmed = !!box.trimmed;
  const c = ring.color || [0, 0, 0];
  o.framed = !!ring.trimmed && 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] >= 225 && Math.max(...c) - Math.min(...c) <= 24;
  o.grid = M.gridOf(rgba, w, h, box);
  const content = img.crop(crop);
  const jpegOf = (maxH) => { const k = Math.min(1, maxH / crop.height); const r = k < 1 ? content.resize({ height: Math.round(crop.height * k), quality: 'best' }) : content; return { url: 'data:image/jpeg;base64,' + r.toJPEG(88).toString('base64'), size: r.getSize() }; };
  if (job.jpeg) { const j = jpegOf(job.jpeg); Object.assign(o, { jpeg: j.url, jpegWidth: j.size.width, jpegHeight: j.size.height, color: '#808080' }); }
  if (job.preview) o.preview = jpegOf(job.preview).url;
  // g16: the picture as 16 × 16 colours (the replay compares the results of the image search with it)
  seen.set(job.bytes, { framed: o.framed, weak: M.weakKind(o.stats), aspect: Math.round(o.aspect * 1000) / 1000, boxHeight: o.boxHeight, g16: Buffer.from(M.reduceGrid(o.grid, 32, 16)).toString('base64') });
  return Promise.resolve(o);
}

// ---------------------------------------------------------------- what the fixtures keep -----------------------------
const LITTLE = new Set('und der die das nicht ist mit sich auch eine für wie the and of to is with that this are for your you'.split(' '));
/** A blurb reduced to its little words: all the language guess of a record needs, nothing of its content. */
const littleWords = (t) => ' ' + String(t || '').toLowerCase().replace(/<[^>]*>/g, ' ').split(/[^a-zäöüß]+/).filter((w) => LITTLE.has(w)).join(' ') + ' ';
// the MARC fields the parser reads (cover-sources.js parseDnb) and their subfields; contributors only as authors
const MARC_KEEP = { '020': 'a', '041': 'a', '100': 'a4', '245': 'abnp', '260': 'bc', '264': 'bc', '338': 'a', '490': 'av', '700': 'a4', '800': 'tv', '810': 'tv', '830': 'av' };
/** A DNB answer with only what the parser reads: no notes, no subjects, no narrators or translators. */
function cleanDnb(xml) {
  const n = (/<numberOfRecords>(\d+)/.exec(xml) || [])[1] || '0';
  const recs = String(xml).split('<recordData>').slice(1).map((chunk) => {
    const leader = (/<leader>[^<]*<\/leader>/.exec(chunk) || [''])[0];
    const ctrl = (chunk.match(/<controlfield tag="00[18]">[^<]*<\/controlfield>/g) || []).join('');
    const fields = (chunk.match(/<datafield tag="\d{3}" ind1="." ind2=".">[\s\S]*?<\/datafield>/g) || []).filter((f) => {
      const tag = /tag="(\d{3})"/.exec(f)[1];
      return MARC_KEEP[tag] && (tag !== '700' || /<subfield code="4">aut<\/subfield>/.test(f));
    }).map((f) => {
      const keep = MARC_KEEP[/tag="(\d{3})"/.exec(f)[1]];
      return f.replace(/<subfield code="(.)">[^<]*<\/subfield>/g, (m, c) => (keep.includes(c) ? m : ''));
    });
    return `<recordData><record>${leader}${ctrl}${fields.join('').replace(/>\s+</g, '><')}</record></recordData>`;
  });
  return `<searchRetrieveResponse><numberOfRecords>${n}</numberOfRecords><records>${recs.join('')}</records></searchRetrieveResponse>`;
}
/** Goodreads' suggestions with the fields the parser reads (no descriptions, no request ids). */
function cleanGoodreads(text) {
  try { return JSON.stringify((JSON.parse(text) || []).map((d) => ({ bookId: d.bookId, title: d.title, bookTitleBare: d.bookTitleBare, author: { name: d.author?.name }, imageUrl: d.imageUrl }))); } catch { return text; }
}
/** The Archive's answer with the fields the parser reads. */
function cleanArchive(text) {
  try { const d = JSON.parse(text); return JSON.stringify({ response: { numFound: d.response?.numFound || 0, docs: (d.response?.docs || []).map((x) => ({ identifier: x.identifier, title: x.title, creator: x.creator, date: x.date, language: x.language, isbn: x.isbn, publisher: x.publisher })) } }); } catch { return text; }
}
/** Google's "no quota" without anything else. */
const cleanGoogle = (text, status) => (status === 429 ? JSON.stringify({ error: { code: 429, message: 'Quota exceeded for quota metric Queries and limit Queries per day', status: 'RESOURCE_EXHAUSTED' } }) : text);
/** An Apple answer with the fields the parser reads, the blurb as its little words. */
function cleanApple(text) {
  try {
    const d = JSON.parse(text);
    return JSON.stringify({ resultCount: d.resultCount, results: (d.results || []).map((r) => ({ kind: r.kind, trackId: r.trackId, trackName: r.trackName, artistName: r.artistName, artworkUrl60: r.artworkUrl60, artworkUrl100: r.artworkUrl100, trackViewUrl: r.trackViewUrl, releaseDate: r.releaseDate, description: littleWords(r.description) })) });
  } catch { return text; }
}
const unhtml = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
/** Bing's answer: the result links with their data and size, nothing of the page around them. */
function cleanBing(html) {
  return '<!doctype html><ul>' + IE.parseBing(html).map((r) => `<li><a class="iusc" m="${esc(JSON.stringify({ purl: r.url, murl: r.image, turl: r.thumbnail, t: r.title }))}" href="#"></a><span class="nowrap">${r.width}&#215;${r.height}</span></li>`).join('') + '</ul>';
}
/** Yandex's answer: the entities of its state with the fields the parser reads. */
function cleanYandex(html) {
  const ents = {};
  IE.parseYandex(html).forEach((r, i) => { ents['e' + i] = { pos: r.rank, image: r.thumbnail, alt: r.title, origWidth: r.width, origHeight: r.height, origUrl: r.image, snippet: { title: r.title, url: r.url } }; });
  return `<!doctype html><div data-state="${esc(JSON.stringify({ initialState: { serpList: { items: { entities: ents } } } }))}"></div>`;
}
/** DuckDuckGo: the token of its page, the results of its JSON. */
function cleanDdg(text, url) {
  if (/\/i\.js/.test(url)) { try { const d = JSON.parse(text); return JSON.stringify({ results: (d.results || []).map((r) => ({ title: r.title, url: r.url, image: r.image, thumbnail: r.thumbnail, width: r.width, height: r.height })) }); } catch { return text; } }
  return '<html><script>vqd="4-0"</script></html>';
}
function clean(text, url, status) {
  if (/googleapis\.com/.test(url)) return cleanGoogle(text, status);
  if (/goodreads\.com\/book\/auto_complete/.test(url)) return cleanGoodreads(text);
  if (/archive\.org\/advancedsearch/.test(url)) return cleanArchive(text);
  if (/itunes\.apple\.com/.test(url)) return cleanApple(text);
  if (/services\.dnb\.de/.test(url)) return cleanDnb(text);
  if (/www\.bing\.com/.test(url)) return cleanBing(text);
  if (/yandex\.com/.test(url)) return cleanYandex(text);
  if (/duckduckgo\.com/.test(url)) return cleanDdg(text, url);
  return text;
}
const ENGINE_HOST = /bing\.(?:com|net)|yandex|duckduckgo/i;
/**
 * The answers of a stretch of the log: texts kept as the parsers need them, pictures by status, size and what the
 * decoder saw (the 16 × 16 colours only for the image search, whose results are compared with each other).
 */
function answers(from) {
  const res = {};
  for (const x of log.slice(from)) {
    const r = memo.get(x.url);
    if (!r) continue;
    const size = imageSize(r.buffer);
    const key = x.url.replace(/([?&]vqd=)[\d-]+/, '$14-0');
    if (size || /^image\//i.test(r.contentType || '')) {
      const { g16, ...look } = seen.get(r.buffer) || {};
      res[key] = { status: r.status, ok: r.ok, contentType: r.contentType, image: { w: size?.w || 0, h: size?.h || 0, ...look, ...(g16 && ENGINE_HOST.test(x.url) ? { g16 } : {}) } };
    } else res[key] = { status: r.status, ok: r.ok, contentType: r.contentType, text: clean(r.buffer.toString('utf8'), x.url, r.status) };
  }
  return res;
}
/** Nothing about the machine that asked: no address, no region, no request ids. */
function checkClean(text) {
  const bad = /\b(?:\d{1,3}\.){3}\d{1,3}\b|[?&;]lr=\d|"lr"|reqid|"region"|x-forwarded/i.exec(text);
  if (bad) throw new Error('the recording holds something about the asker: ' + text.slice(Math.max(0, bad.index - 60), bad.index + 60));
}

// ---------------------------------------------------------------- the library -----------------------------------------
function makeWc(settingsExtra = {}, { pace = 1 } = {}) {
  const { WebCovers } = require('../../electron/library/web-covers');
  const { Library } = require('../../electron/library/library');
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'lesesaal-record-'));
  fs.mkdirSync(path.join(ud, 'covers'), { recursive: true });
  const data = { webCovers: true, webMetadata: true, folders: [], ...settingsExtra };
  const settings = { get: (k) => (k ? data[k] : data), data };
  const lib = new Library({ userData: ud, settings, emit: () => {}, getIndexer: () => null });
  const wc = new WebCovers({ library: lib, settings, userData: ud, decode, fetch: realFetch, log: { log() {}, warn: (...a) => console.log('  !', ...a) }, pace, gap: 0, pause: 180e3 });
  const add = (i, s) => { const id = 's' + String(i).padStart(2, '0'); lib.books[id] = { id, path: `C:/Bücher/${id}.pdf`, relPath: id + '.pdf', folder: 'C:/Bücher', format: 'pdf', pageCount: 240, indexed: true, hasCover: true, coverGenerated: true, addedAt: Date.now(), bookmarks: [], annotations: [], positions: [], ...s.book }; return lib.books[id]; };
  return { wc, lib, add, ud };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function catalogues() {
  const { wc, add, ud } = makeWc();
  // the pick the tests replay: every catalogue free, so the order of the catalogues alone decides (the timed run above
  // asks whichever is free and may take another, equally right picture)
  const still = makeWc({}, { pace: 0 });
  const fixtures = [], report = [];
  const sources = ['openlibrary', 'goodreads', 'apple', 'dnb', 'archive', 'amazon', 'google'];
  const hostOf = { openlibrary: 'openlibrary.org/search', goodreads: 'goodreads.com/book/auto_complete', apple: 'itunes.apple.com', dnb: 'services.dnb.de', archive: 'archive.org/advancedsearch', amazon: 'media-amazon.com', google: 'googleapis.com' };
  for (const [i, s] of SAMPLE.entries()) {
    const book = add(i, s), id = book.id;
    const start = log.length;
    const t0 = Date.now();
    const res = await wc.lookup(book, { cover: true });
    const ms = Date.now() - t0;
    const every = await wc.lookup(book, { cover: true, every: true });
    const per = {};
    for (const src of sources) {
      let own = every.matched.filter((m) => m.rec.source === src), pic = null;
      if (src === 'amazon') {
        // Amazon's pictures of the editions the sure records name by ISBN (Amazon is no catalogue of its own)
        own = wc.coverOrder(every.bk, every.matched).filter((m) => m.rec.source === 'amazon' && m.rank >= 2);
        for (const m of own.slice(0, 3)) {
          const c = await wc.fetchCover(m.rec.cover.url);
          if (c) { pic = wc.coverOf(c.d, { image: m.rec.cover.url, via: 'amazon' }); pic.suspect = c.suspect; break; }
        }
      } else if (own.some((m) => m.rank >= 2 && m.rec.cover)) pic = await wc.pickCover(every.bk, own);
      if (pic) fs.writeFileSync(path.join(out, `${id}-${src}.jpg`), pic.jpeg);
      per[src] = { asked: log.slice(start).some((x) => x.url.includes(hostOf[src])), known: own.filter((m) => m.rank >= 2).length, picture: pic ? pic.image : null, suspect: !!pic?.suspect };
    }
    if (res.cover) fs.writeFileSync(path.join(out, `${id}-pick.jpg`), res.cover.jpeg);
    const meta = BM.metadataFrom(book, res.matched.filter((m) => m.rank >= 2).map((m) => ({ ...m.rec, rank: m.rank })), { chosen: res.cover?.rec || null });
    report.push({ id, title: s.book.title, author: s.book.author, ms, requests: log.slice(start).filter((x) => !x.cached).length,
      pick: res.cover ? { via: res.cover.via, image: res.cover.image, level: res.cover.level, w: res.cover.width, h: res.cover.height, suspect: !!res.cover.suspect } : null,
      matched: res.matched.slice(0, 5).map((m) => `${m.rec.source}:${m.level}:${m.how}:${m.score}${BM.isLesser(m.rec) ? ':lesser' : ''}`), per, meta: meta.patch });
    console.log(`${id} ${String(ms).padStart(6)} ms  ${(res.cover ? res.cover.via + ' ' + res.cover.level + (res.cover.suspect ? ' (doubtful)' : res.cover.lesser ? ' (lesser)' : '') : '-').padEnd(26)} ${s.book.title.slice(0, 56)}`);
    const replay = await still.wc.lookup(still.add(i, s), { cover: true });
    if (replay.cover) fs.writeFileSync(path.join(out, `${id}-replay.jpg`), replay.cover.jpeg);
    fixtures.push({ book: s.book, pick: replay.cover ? replay.cover.image : null, responses: answers(start) });
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  const sum = {};
  for (const src of sources) sum[src] = { asked: report.filter((r) => r.per[src].asked).length, known: report.filter((r) => r.per[src].known).length, picture: report.filter((r) => r.per[src].picture).length };
  console.log('\nper catalogue (books asked / known / with a picture): ' + JSON.stringify(sum));
  const times = report.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`picked: ${report.filter((r) => r.pick).length} of ${report.length}, requests: ${log.filter((x) => !x.cached).length}, time per book: median ${times[times.length >> 1]} ms, mean ${Math.round(times.reduce((a, b) => a + b, 0) / times.length)} ms, max ${times[times.length - 1]} ms`);
  if (save) {
    const file = path.join(FIX, 'sources.json.gz');
    const text = JSON.stringify({ recorded: new Date().toISOString().slice(0, 10), books: fixtures });
    checkClean(text);
    fs.writeFileSync(file, zlib.gzipSync(text, { level: 9 }));
    console.log('saved ' + file + ' (' + Math.round(fs.statSync(file).size / 1024) + ' KB)');
  }
  still.wc.stop();
  try { fs.rmSync(ud, { recursive: true, force: true }); fs.rmSync(still.ud, { recursive: true, force: true }); } catch {}
}

// the books each engine is asked about: classics in both languages, the example of a cut-off title, made-up ones
// (the books of make-fixtures.js ENGINE_SAMPLES)
const ENGINE_SAMPLE = { bing: [0, 1, 14, 15, 17, 25, 29, 33], yandex: [0, 2, 22, 13], duckduckgo: [0, 24] };
async function engines() {
  const { wc, add, ud } = makeWc();
  allowDdg = true;
  const recorded = [], report = [];
  for (const [engine, list] of Object.entries(ENGINE_SAMPLE)) {
    if (only.length && !only.includes(engine)) continue;
    for (const i of list) {
      const s = SAMPLE[i], book = add(i, s);
      // wait for the engine's budget (DuckDuckGo: three minutes between two searches)
      for (let w = wc.engineWait(engine); w > 0; w = wc.engineWait(engine)) await sleep(Math.min(w + 200, 5000));
      const start = log.length, t0 = Date.now();
      const res = await wc.webSearch(book, { only: [engine], max: 1 });
      const found = res.pick ? await wc.downloadGroup(res.pick.group) : null;
      const ms = Date.now() - t0;
      if (found) fs.writeFileSync(path.join(out, `${book.id}-${engine}.jpg`), found.jpeg);
      const g = res.pick?.group;
      report.push({ engine, id: book.id, title: s.book.title, ms, answered: res.answered, results: res.cands.length, pick: found ? { site: found.site, image: found.image, sites: g.sites, engines: g.engines, confidence: res.pick.confidence } : null });
      console.log(`${engine.padEnd(10)} ${book.id} ${String(ms).padStart(6)} ms  ${res.answered ? String(res.cands.length).padStart(2) + ' results' : 'not answered'}  ${found ? `${found.site} (${g.sites} sites, ${res.pick.confidence})` : '-'}  ${s.book.title.slice(0, 50)}`);
      recorded.push({ engine, book: s.book, pick: found ? found.image : null, responses: answers(start) });
    }
  }
  fs.writeFileSync(path.join(out, 'engines-report.json'), JSON.stringify(report, null, 1));
  const sum = {};
  for (const e of Object.keys(ENGINE_SAMPLE)) { const r = report.filter((x) => x.engine === e); if (r.length) sum[e] = { asked: r.length, answered: r.filter((x) => x.answered).length, picked: r.filter((x) => x.pick).length }; }
  console.log('\nper engine (asked / answered / picked): ' + JSON.stringify(sum) + ', DuckDuckGo requests: ' + ddgRequests);
  if (save) {
    const file = path.join(FIX, 'engines.json.gz');
    const prev = fs.existsSync(file) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')) : {};
    // the samples of the engines not asked this time stay as they were recorded
    const kept = (prev.samples || []).filter((x) => only.length && !only.includes(x.engine));
    const samples = [...recorded, ...kept].sort((a, b) => IE.ENGINES.indexOf(a.engine) - IE.ENGINES.indexOf(b.engine));
    const text = JSON.stringify({ ...prev, recorded: new Date().toISOString().slice(0, 10), samples });
    checkClean(text);
    fs.writeFileSync(file, zlib.gzipSync(text, { level: 9 }));
    console.log('saved ' + file + ' (' + Math.round(fs.statSync(file).size / 1024) + ' KB)');
  }
  allowDdg = false;
  try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
}

async function batch({ force = true } = {}) {
  memo = null;                                   // every request for real, as the app makes it
  // DuckDuckGo stays out of this measurement: its few searches are measured above, and its block would hit the address
  const { wc, add, ud } = makeWc({ coverEngines: { bing: true, yandex: true, duckduckgo: false } });
  const books = SAMPLE.map((s, i) => add(i, s));
  // --batch: every second book as if the catalogues had not known it, straight to the image search engines
  const forced = new Set();
  if (force) books.forEach((b, i) => { if (i % 2) { wc.state.fast[b.id] = { at: Date.now(), q: wc.qkey(b), hit: false }; forced.add(b.id); } });
  const start = log.length, t0 = Date.now();
  wc.batch.start();
  let last = '';
  while (wc.batch.running) {
    await sleep(2000);
    const s = wc.batch.status();
    const line = `${Math.round((Date.now() - t0) / 1000)} s: ${s.done} of ${s.total}, found ${s.found}, later ${s.later}, engines ${JSON.stringify(wc.stats.engines)}`;
    if (line !== last) console.log('  ' + line);
    last = line;
  }
  const st = wc.batch.status();
  const secs = (Date.now() - t0) / 1000;
  const via = {}, list = [];
  for (const b of books) {
    const cur = wc.library.books[b.id], v = cur.coverSource === 'web' ? cur.coverWeb?.via || '?' : '-';
    via[v] = (via[v] || 0) + 1;
    list.push({ id: b.id, title: b.title, author: b.author, image: forced.has(b.id), via: v, site: cur.coverWeb?.site || null });
    if (v !== '-') fs.writeFileSync(path.join(out, `${b.id}-batch.jpg`), fs.readFileSync(wc.library.coverPath(b.id)));
  }
  const hosts = {};
  for (const x of log.slice(start)) { let h = ''; try { h = new URL(x.url).hostname; } catch {} hosts[h] = (hosts[h] || 0) + 1; }
  // each source's covers per minute of the run
  const perSource = Object.fromEntries(Object.entries(via).filter(([k]) => k !== '-').map(([k, n]) => [k, Math.round((n / secs) * 60 * 10) / 10]));
  const result = { books: st.total, seconds: Math.round(secs), perMinute: Math.round((st.total / secs) * 60 * 10) / 10, found: st.found, missed: st.missed, failed: st.failed, via, perSource, searches: wc.stats.engines, requests: hosts, ddgRequests, rests: wc.state.rests, peak: st.peak };
  fs.writeFileSync(path.join(out, force ? 'batch-report.json' : 'spread-report.json'), JSON.stringify({ ...result, list }, null, 1));
  console.log('\nBATCH ' + JSON.stringify(result));
  wc.stop();
  try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
}

async function main() {
  if (parts.includes('--catalogues')) await catalogues();
  if (parts.includes('--engines')) await engines();
  if (parts.includes('--batch')) await batch();
  if (parts.includes('--spread')) await batch({ force: false });
}
app.whenReady().then(main).catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => app.quit());
