// Tests for the covers from the internet: the check of page 1, the perceptual hashes, the clustering and the choice
// of the cover (with made-up DuckDuckGo searches as fixtures: fixtures/covers, written by fixtures/make-fixtures.js), and
// the background search with its
// pauses, back-off, misses and fallback, against a fake network and a fake picture decoder.
// Plain Node – no Electron, no network.  Run:  node electron/library/test-covers.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const assert = require('assert');

const M = require('./cover-match');
const { WebCovers, proxied } = require('./web-covers');
const { Library } = require('./library');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); }
}

// ---------------------------------------------------------------- pictures -------------------------------------------
/** An RGBA picture filled with `bg`, with helpers to paint rectangles and discs. */
function picture(w, h, bg = [255, 255, 255]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([bg[0], bg[1], bg[2], 255], i * 4);
  const pic = {
    w, h, data,
    rect(x, y, rw, rh, c) { for (let yy = Math.max(0, y); yy < Math.min(h, y + rh); yy++) for (let xx = Math.max(0, x); xx < Math.min(w, x + rw); xx++) data.set([c[0], c[1], c[2], 255], (yy * w + xx) * 4); return pic; },
    disc(cx, cy, r, c, ring = 0) { for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const d = Math.hypot(xx - cx, yy - cy); if (d <= r && (!ring || d >= r - ring)) data.set([c[0], c[1], c[2], 255], (yy * w + xx) * 4); } return pic; },
    noise(amount, seed = 1) { let s = seed; const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296); for (let i = 0; i < w * h * 4; i += 4) for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, data[i + c] + Math.round((rnd() - 0.5) * 2 * amount))); return pic; },
  };
  return pic;
}
/** The picture scaled to w × h (box filter), as the indexer window's smaller copy would be. */
function scaled(p, w, h) {
  const out = picture(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.floor((x * p.w) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * p.w) / w)), y0 = Math.floor((y * p.h) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * p.h) / h));
    const s = [0, 0, 0]; let k = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { for (let c = 0; c < 3; c++) s[c] += p.data[(yy * p.w + xx) * 4 + c]; k++; }
    out.data.set([s[0] / k, s[1] / k, s[2] / k, 255], (y * w + x) * 4);
  }
  return out;
}
/** A book cover of its own design: a coloured ground, a disc, a band and "lines of type". */
function designCover(w, h, { ground = [196, 72, 52], disc = [240, 196, 80], band = [38, 64, 98], ink = [250, 246, 236] } = {}) {
  const p = picture(w, h, ground);
  p.disc(w * 0.7, h * 0.72, w * 0.42, disc);
  p.rect(0, 0, w, Math.round(h * 0.12), band);
  for (let i = 0; i < 4; i++) p.rect(Math.round(w * 0.12), Math.round(h * (0.2 + i * 0.07)), Math.round(w * (0.62 - i * 0.08)), Math.round(h * 0.035), ink);
  return p;
}
const fp = (p) => { const box = M.coverBox(p.data, p.w, p.h); return M.fingerprint(M.gridOf(p.data, p.w, p.h, box), (box.x1 - box.x0) / (box.y1 - box.y0)); };

/** A minimal PNG reader (8 bit RGB or RGBA, not interlaced): enough for the fixture pictures. */
function readPng(file) {
  const buf = fs.readFileSync(file);
  let pos = 8, w = 0, h = 0, type = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), name = buf.toString('latin1', pos + 4, pos + 8), body = buf.subarray(pos + 8, pos + 8 + len);
    if (name === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); type = body[9]; }
    else if (name === 'IDAT') idat.push(body);
    pos += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp;
  const out = Buffer.alloc(w * h * 3), prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      cur[i] = (row[i] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255;
    }
    for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) out[(y * w + x) * 3 + c] = cur[x * bpp + c];
    cur.copy(prev);
  }
  return { w, h, rgb: out };
}

// the searches of the fixtures: results and the analysed thumbnails (32 × 32 grids, one row of the PNG per search)
const FIX = path.join(__dirname, 'fixtures', 'covers');
const SEARCHES = JSON.parse(fs.readFileSync(path.join(FIX, 'searches.json'), 'utf8'));
const SPRITE = readPng(path.join(FIX, 'thumbnails.png'));
function gridAt(row, col) {
  const N = SEARCHES.grid, g = new Uint8Array(N * N * 3);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) for (let c = 0; c < 3; c++) g[(y * N + x) * 3 + c] = SPRITE.rgb[((row * N + y) * SPRITE.w + col * N + x) * 3 + c];
  return g;
}
/** The candidates of a search of the fixtures, as web-covers.js analyse() builds them. */
function candidatesOf(s) {
  const row = SEARCHES.searches.indexOf(s);
  return s.analysed.map((a, col) => {
    const r = s.results[a.rank];
    return { rank: a.rank, site: M.siteOf(r.url), title: r.title, url: r.url, image: r.image, thumbnail: r.thumbnail, width: r.width, height: r.height, aspect: a.aspect, fp: M.fingerprint(gridAt(row, col), a.aspect), thumbHeight: a.boxHeight };
  });
}
const search = (slug) => SEARCHES.searches.find((s) => s.slug === slug);

(async () => {
  // ---------------------------------------------------------------- the query --------------------------------------
  console.log('query');
  await test('title and author, the word for "book" and the region follow the language', () => {
    const q = M.coverQuery({ title: 'Die Leiden des jungen Werthers', author: 'Goethe, Johann Wolfgang von', language: 'de' });
    assert.strictEqual(q.q, 'Die Leiden des jungen Werthers Johann Wolfgang von Goethe Buch');
    assert.strictEqual(q.region, 'de-de');
    const e = M.coverQuery({ title: 'Frankenstein: or, The Modern Prometheus', author: 'Mary Shelley', language: 'en' });
    assert.strictEqual(e.q, 'Frankenstein Mary Shelley book cover');
    assert.strictEqual(e.region, 'us-en');
  });
  await test('a file name "Author - Title" gives the author back, so does "Title - Author"', () => {
    const a = M.coverQuery({ title: 'Mary Shelley - The Last Man', author: '' });
    assert.strictEqual(a.title, 'The Last Man'); assert.strictEqual(a.author, 'Mary Shelley'); assert.strictEqual(a.lang, 'en');
    const b = M.coverQuery({ title: 'Der grüne Heinrich - Gottfried Keller', author: null });
    assert.strictEqual(b.title, 'Der grüne Heinrich'); assert.strictEqual(b.author, 'Gottfried Keller'); assert.strictEqual(b.region, 'de-de');
    const c = M.coverQuery({ title: 'Heinrich von Kleist - Michael Kohlhaas', author: '' });
    assert.strictEqual(c.author, 'Heinrich von Kleist'); assert.strictEqual(c.title, 'Michael Kohlhaas');
  });
  await test('what files and shops add is dropped, an author that is no name is not searched for', () => {
    const q = M.coverQuery({ title: 'Moby_Dick (example.org) [eBook] 2019', author: 'Microsoft Office User' });
    assert.strictEqual(q.title, 'Moby Dick');
    assert.strictEqual(q.author, '');
    assert.strictEqual(q.q, 'Moby Dick book cover');
    assert.strictEqual(M.cleanTitle('Die Räuber (books.example.net)'), 'Die Räuber', 'any domain');
    assert.strictEqual(M.cleanTitle('Reisebilder (St.Gallen)'), 'Reisebilder (St.Gallen)', 'a place is no domain');
    assert.strictEqual(q.region, 'wt-wt');
  });
  await test('words: case, accents and umlauts folded, stop words dropped; partial matches of long words count', () => {
    assert.deepStrictEqual(M.words('Die Leiden des jungen Werthers'), ['leiden', 'jungen', 'werthers']);
    assert.deepStrictEqual(M.words('Mörike'), M.words('Moerike'));
    assert.strictEqual(M.wordMatch(M.words('Der grüne Heinrich'), 'Grüner Heinrich, Roman von Gottfried Keller (Buch) - buchladen.example'), 1);
    assert.strictEqual(M.wordMatch(M.words('Die vergessene Kartografie der Nebelinseln'), 'Die Vermessung der Erde'), 0);
  });

  // ---------------------------------------------------------------- page 1 -----------------------------------------
  console.log('page 1');
  const W = 140, H = 200;
  const kind = (p) => M.weakKind(M.pageStats(p.data, p.w, p.h));
  await test('an empty page and a page with only its number are blank', () => {
    assert.strictEqual(kind(picture(W, H)), 'blank');
    assert.strictEqual(kind(picture(W, H).rect(68, 190, 3, 4, [40, 40, 40])), 'blank');
    assert.strictEqual(kind(picture(W, H, [238, 232, 216]).noise(6)), 'blank', 'empty scanned paper');
  });
  await test('one flat colour is uniform', () => {
    assert.strictEqual(kind(picture(W, H, [158, 153, 143])), 'uniform');
    assert.strictEqual(kind(picture(W, H, [20, 40, 90])), 'uniform');
  });
  await test('a title page, a page of text, a scanned leaf with a library stamp are text', () => {
    const title = picture(W, H).rect(52, 40, 36, 2, [30, 30, 30]).rect(30, 56, 80, 4, [10, 10, 10]).rect(50, 66, 40, 2, [60, 60, 60]).rect(55, 180, 30, 2, [90, 90, 90]);
    assert.strictEqual(kind(title), 'text');
    const body = picture(W, H);
    for (let y = 14; y < 186; y += 3) for (let x = 12; x < 128; x += 5) body.rect(x, y, 3, 1, [25, 25, 25]);   // about a fifth of the text block inked
    assert.strictEqual(kind(body), 'text');
    const stamp = picture(W, H, [232, 226, 210]).noise(8).disc(88, 60, 26, [92, 70, 150], 3).rect(30, 160, 40, 2, [90, 90, 96]);
    assert.strictEqual(kind(stamp), 'text');
  });
  await test('covers are covers: colour fields, a dark ground, a photo, a picture on white', () => {
    assert.strictEqual(kind(designCover(W, H)), null);
    const dark = picture(W, H, [24, 30, 44]).rect(20, 40, 90, 8, [250, 246, 236]).rect(20, 56, 70, 8, [250, 246, 236]);
    assert.strictEqual(kind(dark), null);
    assert.strictEqual(kind(picture(W, H, [128, 128, 128]).noise(120, 7)), null);
    const photo = picture(W, H).rect(20, 50, 100, 90, [70, 110, 60]).noise(30, 3).rect(30, 20, 80, 6, [20, 20, 20]);
    assert.strictEqual(kind(photo), null);
  });

  // ---------------------------------------------------------------- frames, hashes ----------------------------------
  console.log('hashes');
  await test('a cover inside a white square is cut out, a white cover keeps its own margins', () => {
    const square = picture(180, 180).rect(0, 0, 180, 180, [255, 255, 255]);
    const cover = designCover(90, 135);
    for (let y = 0; y < 135; y++) for (let x = 0; x < 90; x++) square.data.set(cover.data.subarray((y * 90 + x) * 4, (y * 90 + x) * 4 + 4), ((y + 22) * 180 + x + 45) * 4);
    const box = M.coverBox(square.data, 180, 180);
    assert(box.trimmed && Math.abs((box.x1 - box.x0) / (box.y1 - box.y0) - 90 / 135) < 0.03, JSON.stringify(box));
    const white = picture(120, 180).rect(20, 30, 80, 6, [20, 20, 20]).rect(30, 150, 60, 3, [200, 30, 30]);
    assert.strictEqual(M.coverBox(white.data, 120, 180).trimmed, false);
    assert.strictEqual(M.trimBox(picture(100, 150, [128, 128, 128]).noise(90).data, 100, 150).trimmed, false, 'no uniform frame');
  });
  await test('copies of one cover are the same picture: other sizes, noise, a sticker, a frame', () => {
    const big = designCover(300, 450);
    const a = fp(scaled(big, 120, 180));
    const b = fp(scaled(big, 133, 200).noise(10, 5));
    const sticker = scaled(big, 120, 180).disc(96, 40, 12, [230, 30, 30]);
    // a square shop picture: the cover on white
    const framed = picture(200, 200);
    const small = scaled(big, 120, 180);
    for (let y = 0; y < 180; y++) for (let x = 0; x < 120; x++) framed.data.set(small.data.subarray((y * 120 + x) * 4, (y * 120 + x) * 4 + 4), ((y + 10) * 200 + x + 40) * 4);
    assert(M.samePicture(a, b), 'noise');
    assert(M.samePicture(a, fp(sticker)), 'sticker');
    assert(M.samePicture(a, fp(framed)), 'white frame');
    assert.strictEqual(M.hamming(a.ph, a.ph), 0);
  });
  await test('another edition, another book, a photo of the book are not', () => {
    const big = designCover(300, 450);
    const a = fp(scaled(big, 120, 180));
    assert(!M.samePicture(a, fp(designCover(120, 180, { ground: [30, 90, 70], disc: [220, 220, 210], band: [200, 60, 40] }))), 'other colours');
    const other = picture(120, 180, [240, 236, 226]).rect(10, 100, 100, 70, [30, 30, 30]).rect(20, 20, 80, 10, [200, 40, 40]);
    assert(!M.samePicture(a, fp(other)), 'other book');
    const photo = picture(150, 200, [150, 104, 60]).noise(40, 9);
    const small = scaled(big, 90, 135);
    for (let y = 0; y < 135; y++) for (let x = 0; x < 90; x++) photo.data.set(small.data.subarray((y * 90 + x) * 4, (y * 90 + x) * 4 + 4), ((y + 40) * 150 + x + 34) * 4);
    assert(!M.samePicture(a, fp(photo)), 'photo on a table');
  });

  // ---------------------------------------------------------------- the choice (searches of the fixtures) ----------
  console.log('clustering and choice');
  for (const s of SEARCHES.searches) {
    await test(`${s.slug}: ${s.expect ? (s.expect.group ? 'the picture on the most sites wins' : 'a single shop page that names the book') : 'a made-up title finds nothing'}`, () => {
      const query = M.coverQuery(s.book);
      const pick = M.pickCover(candidatesOf(s), query);
      if (!s.expect) { assert.strictEqual(pick, null, 'picked #' + pick?.group?.rep?.rank); return; }
      assert(pick, 'nothing picked');
      assert.strictEqual(pick.confidence, s.expect.confidence);
      if (s.expect.group) assert.deepStrictEqual(pick.group.members.map((m) => m.rank).sort((a, b) => a - b), s.expect.group);
      else assert.strictEqual(pick.group.members.some((m) => m.rank === s.expect.single), true);
      // the copies at least 900 px tall first, the smallest of them first (the cache keeps 900 px), then the rest from
      // the largest down; nothing under 300 px
      const order = M.downloadOrder(pick.group);
      assert(order.length, 'nothing to download');
      const big = order.filter((m) => m.height >= 900), rest = order.slice(big.length);
      assert(rest.every((m) => m.height < 900 && m.height >= 300));
      for (let i = 1; i < big.length; i++) assert(big[i - 1].height <= big[i].height);
      for (let i = 1; i < rest.length; i++) assert(rest[i - 1].height >= rest[i].height);
    });
  }
  await test('each site counts once: a shop with the same picture five times is one vote', () => {
    const s = search('schiller-de');
    const cands = candidatesOf(s);
    const copy = cands.find((c) => c.rank === 3);
    assert.strictEqual(cands.find((c) => c.rank === 0).site, 'buchhandlung-eins.example');
    const flood = [...cands, ...[50, 51, 52, 53].map((rank) => ({ ...cands.find((c) => c.rank === 0), rank, site: 'buchhandlung-eins.example' }))];
    const groups = M.scoreClusters(M.clusterCandidates(flood), M.coverQuery(s.book));
    const g0 = groups.find((g) => g.members.some((m) => m.rank === 0));
    assert.strictEqual(g0.sites, 1);
    assert(groups[0].members.includes(copy) || groups[0].score >= g0.score);
  });
  await test('a group without a page that names the book, or in the wrong proportions, does not win', () => {
    const s = search('storm-de');
    const query = M.coverQuery({ title: 'Ein ganz anderes Buch', author: 'Niemand Bekannt' });
    assert.strictEqual(M.pickCover(candidatesOf(s), query), null);
    const wide = candidatesOf(search('werther-de')).map((c) => ({ ...c, aspect: 1.6, fp: { ...c.fp, aspect: 1.6 } }));
    assert.strictEqual(M.pickCover(wide, M.coverQuery(search('werther-de').book)), null);
  });
  await test('stock photos are never downloaded, placeholders neither', () => {
    assert.strictEqual(M.downloadable({ image: 'https://c8.alamy.com/comp/X/book.jpg', site: 'alamy.de' }), false);
    assert.strictEqual(M.downloadable({ image: 'https://shop.example/img/no_image_available.png', site: 'shop.example' }), false);
    assert.strictEqual(M.downloadable({ image: 'https://img.buchhandlung-eins.example/cover.jpg', site: 'buchhandlung-eins.example' }), true);
  });

  // ---------------------------------------------------------------- the search in the background --------------------
  console.log('background search');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesesaal-covers-'));
  let clock = Date.UTC(2026, 9, 3, 12, 0, 0);
  const now = () => clock;
  const setup = (name) => {
    const ud = path.join(tmp, name);
    fs.mkdirSync(path.join(ud, 'covers'), { recursive: true });
    // the image search of 0.6: DuckDuckGo alone (Bing and Yandex: test-cover-sources.js)
    const settingsData = { webCovers: true, folders: [], coverEngines: { bing: false, yandex: false, duckduckgo: true } };
    const settings = { get: (k) => (k ? settingsData[k] : settingsData), data: settingsData };
    const lib = new Library({ userData: ud, settings, emit: () => {}, getIndexer: () => null });
    const add = (id, title, extra = {}) => {
      lib.books[id] = { id, path: 'C:/b/' + id + '.pdf', relPath: id + '.pdf', folder: 'C:/b', format: 'pdf', pageCount: 240, title, author: '', indexed: true, hasCover: true, coverGenerated: false, coverWeak: 'text', coverCheck: M.COVER_CHECK, bookmarks: [], annotations: [], positions: [], ...extra };
      fs.writeFileSync(lib.coverPath(id), Buffer.from('page one of ' + id));
      return lib.books[id];
    };
    return { lib, settings, add, ud };
  };
  // the fake network: DuckDuckGo answers with a search of the fixtures, its proxy with "pictures" the fake decoder knows
  const net = { log: [], refuse: 0, ddg: true, ol: {} };
  const bySearch = (q) => SEARCHES.searches.find((s) => M.coverQuery(s.book).q === q);
  const fetch = async (url) => {
    net.log.push(url);
    const u = new URL(url);
    // pictures are padded to a plausible size (web-covers.js ignores answers of a few bytes)
    const ok = (body, type = 'text/html') => ({ ok: true, status: 200, contentType: type, buffer: /^image\//.test(type) ? Buffer.concat([Buffer.from(body), Buffer.alloc(4000)]) : Buffer.from(body) });
    if (u.hostname === 'duckduckgo.com' && u.pathname === '/') {
      if (!net.ddg) throw new Error('net::ERR_CONNECTION_RESET');
      return ok('<html><script>vqd="4-1234567890"</script></html>');
    }
    if (u.hostname === 'duckduckgo.com' && u.pathname === '/i.js') {
      if (net.refuse > 0) { net.refuse--; return { ok: false, status: 403, contentType: '', buffer: Buffer.from('If this error persists, please let us know: ops@duckduckgo.com') }; }
      const s = bySearch(u.searchParams.get('q'));
      return ok(JSON.stringify({ results: s ? s.results : [] }), 'application/json');
    }
    if (u.hostname === 'external-content.duckduckgo.com') {
      // the thumbnails are asked for 300 px tall (web-covers.js smallThumb)
      const target = u.searchParams.get('u').replace(/[?&]h=300$/, '');
      for (const s of SEARCHES.searches) for (const r of s.results) {
        if (r.thumbnail === target) return ok(`fx:${s.slug}:${r.rank}:thumb`, 'image/jpeg');
        if (r.image === target) return ok(`fx:${s.slug}:${r.rank}:full`, 'image/jpeg');
      }
      return { ok: false, status: 404, contentType: '', buffer: Buffer.alloc(0) };
    }
    if (u.hostname === 'openlibrary.org') return ok(JSON.stringify({ docs: net.ol.docs || [] }), 'application/json');
    if (u.hostname === 'covers.openlibrary.org') return /\/b\/id\/\d+/.test(u.pathname) ? ok('ol:' + u.pathname, 'image/jpeg') : { ok: false, status: 404, contentType: '', buffer: Buffer.alloc(0) };
    // the other catalogues know none of these books (test-cover-sources.js tests them)
    if (u.hostname === 'services.dnb.de') return ok('<searchRetrieveResponse><numberOfRecords>0</numberOfRecords></searchRetrieveResponse>', 'application/xml');
    if (u.hostname === 'itunes.apple.com') return ok('{"resultCount":0,"results":[]}', 'application/json');
    if (u.hostname === 'www.googleapis.com') return ok('{"totalItems":0}', 'application/json');
    throw new Error('unexpected request ' + url);
  };
  const ddgOnly = (list) => list.filter((x) => /duckduckgo\.com/.test(new URL(x).hostname));
  // the fake decoder: the fixture grid of a result (its full picture is the same), a page grid for Open Library
  const decode = async (job) => {
    const tag = Buffer.from(job.bytes || '').toString('utf8').replace(/\0+$/, '');
    const m = /^fx:([\w-]+):(\d+):(thumb|full)$/.exec(tag);
    const jpeg = 'data:image/jpeg;base64,' + Buffer.from('JPEG ' + tag).toString('base64');
    if (m) {
      const s = search(m[1]), row = SEARCHES.searches.indexOf(s), col = s.analysed.findIndex((a) => a.rank === +m[2]);
      if (col < 0) return { ok: false, error: 'not analysed' };
      const a = s.analysed[col];
      const height = m[3] === 'full' ? s.results[a.rank].height : a.boxHeight;
      return { ok: true, width: Math.round(height * a.aspect), height, aspect: a.aspect, boxHeight: height, grid: gridAt(row, col), preview: 'data:image/jpeg;base64,AAAA', jpeg, color: '#808080', jpegWidth: 600, jpegHeight: 900, stats: { w: 100, h: 150, ink: 0.4, strong: 0.1, filled: 0.5, lumaStd: 60, bgLuma: 120, bgSat: 40 } };
    }
    if (/^ol:/.test(tag)) {
      const g = new Uint8Array(32 * 32 * 3).map((_, i) => (i * 37) % 256);
      return { ok: true, width: 400, height: 620, aspect: 0.65, boxHeight: 620, grid: g, jpeg, color: '#335577', jpegWidth: 400, jpegHeight: 620, stats: { w: 100, h: 150, ink: 0.4, strong: 0.1, filled: 0.5, lumaStd: 60, bgLuma: 120, bgSat: 40 } };
    }
    return { ok: false, error: 'undecodable' };
  };
  const quiet = process.env.COVERS_DEBUG ? console : { log() {}, warn() {} };

  await test('a book without a cover gets the most frequent picture, the book\'s own cover is kept', async () => {
    const { lib, settings, add, ud } = setup('a');
    const book = add('frank', 'Mary Shelley - Frankenstein');
    const wc = new WebCovers({ library: lib, settings, userData: ud, decode, fetch, now, pause: 0, pace: 0, gap: 0, log: quiet });
    assert(wc.needsCover(book));
    const found = await wc.findCover(book);
    assert(found, 'nothing found');
    assert.strictEqual(book.coverSource, 'web');
    // the winning picture (one edition's cover, on two sites); of its copies the smallest one that is 900 px tall
    assert.strictEqual(book.coverWeb.site, 'lantern-books.example');
    assert(/frankenstein-lantern-960/.test(book.coverWeb.image), book.coverWeb.image);
    assert.strictEqual(book.coverWeb.via, 'duckduckgo');
    assert.strictEqual(book.coverGenerated, false);
    assert(book.coverVersion >= 1);
    assert.strictEqual(fs.readFileSync(lib.coverBackupPath('frank'), 'utf8'), 'page one of frank');
    assert(/^JPEG fx:shelley-en:2:full/.test(fs.readFileSync(lib.coverPath('frank'), 'utf8')));
    // every picture came through DuckDuckGo's proxy, no image host was asked directly
    const hosts = new Set(net.log.map((x) => new URL(x).hostname));
    assert.deepStrictEqual([...hosts].sort(), ['duckduckgo.com', 'external-content.duckduckgo.com']);
    assert(!wc.needsCover(book));
    // "Cover aus dem Buch verwenden": back to page 1, and the search leaves the book alone
    const res = wc.useBookCover('frank');
    assert(res.ok);
    assert.strictEqual(book.coverSource, 'book'); assert.strictEqual(book.coverChoice, 'book');
    assert.strictEqual(fs.readFileSync(lib.coverPath('frank'), 'utf8'), 'page one of frank');
    assert(!fs.existsSync(lib.coverBackupPath('frank')));
    assert(!wc.needsCover(book));
    wc.stop();
  });
  await test('"Anderes Cover": after the catalogues the groups of the last image search, best first; the picked one stays', async () => {
    const { lib, settings, add, ud } = setup('b');
    const book = add('kabale', 'Kabale und Liebe', { author: 'Friedrich Schiller', language: 'de' });
    const wc = new WebCovers({ library: lib, settings, userData: ud, decode, fetch, now, pause: 0, pace: 0, gap: 0, log: quiet });
    await wc.findCover(book);
    const before = ddgOnly(net.log).length;
    const res = await wc.candidates('kabale');
    const web = res.items.filter((it) => it.source === 'web');
    assert(res.ok && web.length >= 5, JSON.stringify(res).slice(0, 200));
    assert.strictEqual(ddgOnly(net.log).length, before, 'the cached search is used, DuckDuckGo is not asked again');
    assert(web[0].current && web[0].sites >= 2, 'the picture on most sites first, marked as the current one');
    const other = web.find((it) => !it.current);
    const chosen = await wc.choose('kabale', other.key);
    assert(chosen.ok, JSON.stringify(chosen));
    assert.strictEqual(book.coverChoice, 'web');
    assert(!wc.needsCover(book));
    assert.strictEqual((await wc.choose('kabale', 'd:1:99')).error, 'stale');
    wc.stop();
  });
  await test('a made-up title is a miss, asked again after a week, at once when the title changes', async () => {
    const { lib, settings, add, ud } = setup('c');
    const book = add('fake', 'Die vergessene Kartografie der Nebelinseln', { author: 'Hartmut Quellbrunn', language: 'de' });
    net.ol.docs = [];
    const wc = new WebCovers({ library: lib, settings, userData: ud, decode, fetch, now, pause: 0, pace: 0, gap: 0, log: quiet });
    assert.strictEqual(wc.nextBook(), null, 'the catalogues come first');
    assert.strictEqual((await wc.fastCover(book)).found, false);
    assert.strictEqual(await wc.findCover(book), null);
    assert.strictEqual(book.coverSource, undefined);
    assert.strictEqual(wc.state.misses.fake.tries, 1);
    assert.strictEqual(wc.nextBook(), null, 'not asked again right away');
    clock += 8 * 86400e3;
    assert.strictEqual(wc.nextBook(), book, 'asked again after a week');
    await wc.findCover(book);
    assert.strictEqual(wc.state.misses.fake.tries, 2);
    clock += 8 * 86400e3;
    assert.strictEqual(wc.nextBook(), null, 'the second miss waits two weeks');
    book.title = 'Die Kartografie der Nebelinseln';
    assert.strictEqual(wc.nextFast(), book, 'a changed title is asked at once (the catalogues first)');
    wc.stop();
  });
  await test('DuckDuckGo declines: back off a quarter of an hour, then longer, search less often; the catalogues meanwhile', async () => {
    const { lib, settings, add, ud } = setup('d');
    const book = add('werther', 'Die Leiden des jungen Werthers', { author: 'Johann Wolfgang von Goethe', language: 'de' });
    const wc = new WebCovers({ library: lib, settings, userData: ud, decode, fetch, now, pause: 90e3, pace: 0, gap: 0, log: quiet });
    net.refuse = 2;
    net.ol.docs = [];
    let r = await wc.searchDdg(M.coverQuery(book));
    assert(r.blocked);
    assert.strictEqual(wc.state.ddg.until - clock, 15 * 60e3);
    assert.strictEqual(wc.state.ddg.pause, 135e3);
    assert(wc.ddgWait() >= 15 * 60e3 - 1);
    r = await wc.searchDdg(M.coverQuery(book));
    assert.strictEqual(wc.state.ddg.until - clock, 30 * 60e3, 'the second refusal doubles the wait');
    // refused twice and away for long: the loop asks the catalogues, never DuckDuckGo
    net.ol.docs = [{ key: '/works/OL1W', title: 'Die Leiden des jungen Werthers', author_name: ['Johann Wolfgang von Goethe'], cover_i: 4711, language: ['ger'], edition_count: 9 }];
    const asked = net.log.length;
    clock += 10e3;
    await wc.pump();
    assert.strictEqual(book.coverSource, 'web');
    assert.strictEqual(book.coverWeb.via, 'openlibrary');
    assert.strictEqual(ddgOnly(net.log.slice(asked)).length, 0, 'DuckDuckGo was not asked while it declines');
    // back to normal after a successful search
    clock += 31 * 60e3;
    const book2 = add('keller', 'Der grüne Heinrich', { author: 'Gottfried Keller', language: 'de' });
    r = await wc.searchDdg(M.coverQuery(book2));
    assert(r.ok && r.pick);
    assert.strictEqual(wc.state.ddg.strikes, 0);
    wc.stop();
  });
  await test('offline: no strike, a short pause, the book is asked again later', async () => {
    const { lib, settings, add, ud } = setup('e');
    const book = add('storm', 'Der Schimmelreiter', { author: 'Theodor Storm', language: 'de' });
    const wc = new WebCovers({ library: lib, settings, userData: ud, decode, fetch, now, pause: 0, pace: 0, gap: 0, log: quiet });
    net.ddg = false;
    await wc.findCover(book);
    assert.strictEqual(wc.state.ddg.strikes || 0, 0);
    assert(wc.state.ddg.until - clock === 5 * 60e3);
    assert(wc.state.misses.storm.soft);
    clock += 61 * 60e3;
    net.ddg = true;
    wc.state.fast.storm = { at: clock, q: wc.qkey(book), hit: false };     // the catalogues did not know it
    assert.strictEqual(wc.nextBook(), book);
    await wc.findCover(book);
    assert.strictEqual(book.coverWeb?.site, 'leseecke.example', JSON.stringify(book.coverWeb));
    wc.stop();
  });
  await test('which books: not one with a cover, set back by the reader, missing, a short PDF, notes, a web page', () => {
    const { lib, settings, add, ud } = setup('f');
    const wc = new WebCovers({ library: lib, settings, userData: ud, decode, fetch, now, pause: 0, pace: 0, gap: 0, log: quiet });
    add('real', 'Ein Buch mit Cover', { coverWeak: null });
    add('chosen', 'Ein Buch', { coverChoice: 'book' });
    add('gone', 'Ein Buch', { missing: true });
    add('letter', 'Brief an die Versicherung', { pageCount: 2 });
    add('notes', 'Meine Notizen zum Schach', { format: 'docx', coverGenerated: true, coverWeak: null });
    add('page', 'Eine gespeicherte Seite', { format: 'html', coverGenerated: true, coverWeak: null });
    const card = add('card', 'Ein Buch mit Titelkarte', { coverWeak: null, coverGenerated: true });
    const first = add('mustread', 'Zuletzt im Alphabet', { mustRead: true });
    assert.strictEqual(wc.nextFast(), first, 'must-read books first');
    first.coverSource = 'web';
    assert.strictEqual(wc.nextFast(), card);
    wc.prioritize('chosen');
    assert.strictEqual(wc.nextFast(), card, 'a book the reader set back is not searched, also when its card is open');
    for (const c of ['web', 'own', 'card']) { card.coverChoice = c; assert(!wc.needsCover(card), 'a choice of the reader stays: ' + c); }
    delete card.coverChoice;
    settings.data.webCovers = false;
    assert.strictEqual(wc.enabled(), false);
    wc.stop();
  });
  await test('page 1 judged while indexing; a new index keeps a cover from the internet while the book still has none', async () => {
    const { lib, add } = setup('g');
    const book = add('re', 'Ein Buch', { coverWeak: null, coverCheck: 0 });
    lib.indexing = { id: 're' };
    const page = (fill) => 'data:image/jpeg;base64,' + Buffer.from(fill).toString('base64');
    const blank = M.pageStats(picture(60, 90).data, 60, 90);
    await lib.onIndexResult('re', { metadata: {}, cover: page('blank page'), coverColor: '#ffffff', coverStats: blank });
    assert.strictEqual(book.coverWeak, 'blank'); assert.strictEqual(book.coverCheck, M.COVER_CHECK);
    lib.applyWebCover('re', { jpeg: Buffer.from('web cover'), color: '#336699', image: 'https://x/y.jpg', page: 'https://x/', site: 'x', via: 'duckduckgo' });
    lib.indexing = { id: 're' };
    await lib.onIndexResult('re', { metadata: {}, cover: page('still blank'), coverColor: '#fefefe', coverStats: blank });
    assert.strictEqual(fs.readFileSync(lib.coverPath('re'), 'utf8'), 'web cover');
    assert.strictEqual(fs.readFileSync(lib.coverBackupPath('re'), 'utf8'), 'still blank');
    assert.strictEqual(book.coverColor, '#336699');
    // the file now starts with a real cover: it replaces the one from the internet
    lib.indexing = { id: 're' };
    await lib.onIndexResult('re', { metadata: {}, cover: page('a real cover'), coverColor: '#aa3311', coverStats: M.pageStats(designCover(60, 90).data, 60, 90) });
    assert.strictEqual(book.coverSource, 'book'); assert.strictEqual(book.coverWeak, null);
    assert.strictEqual(fs.readFileSync(lib.coverPath('re'), 'utf8'), 'a real cover');
    assert(!fs.existsSync(lib.coverBackupPath('re')));
  });
  await test('placeholders are no covers: empty or one-coloured thumbnails drop out, however many sites show them', async () => {
    const { lib, settings, add, ud } = setup('h');
    const book = add('goethe', 'Die Leiden des jungen Werthers', { author: 'Johann Wolfgang von Goethe', language: 'de' });
    const flat = { w: 100, h: 150, ink: 0.001, strong: 0, filled: 0, lumaStd: 1, bgLuma: 230, bgSat: 3 };
    const placeholderDecode = async (job) => { const d = await decode(job); return d.ok ? { ...d, stats: flat } : d; };
    const wc = new WebCovers({ library: lib, settings, userData: ud, decode: placeholderDecode, fetch, now, pause: 0, pace: 0, gap: 0, log: quiet });
    net.ol.docs = [];
    const res = await wc.searchDdg(M.coverQuery(book));
    assert(res.ok);
    assert.strictEqual(res.cands.length, 0);
    assert.strictEqual(res.pick, null);
    wc.stop();
  });
  await test('the proxy address carries the picture\'s address, nothing else', () => {
    const u = new URL(proxied('https://img.buchhandlung-eins.example/a b.jpg?x=1'));
    assert.strictEqual(u.hostname, 'external-content.duckduckgo.com');
    assert.strictEqual(u.searchParams.get('u'), 'https://img.buchhandlung-eins.example/a b.jpg?x=1');
  });

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(`\n${passed} passed, ${failed} failed`);
  // the book catalogues, the metadata and "Alle Cover jetzt laden" (test-cover-sources.js)
  console.log('\ncatalogues, metadata, batch');
  const more = await require('./test-cover-sources').run();
  process.exit(failed || more.failed ? 1 : 0);
})();
