// Fixture tests of 0.7: the English-language sources (DW, NHK WORLD-JAPAN, NASA, Internet Archive, TED), the real
// picture sizes (addresses, MP4 headers, HLS masters), the quality choice of the player (app/src/media/
// quality.js, bundled with esbuild), the settings migration, downloads by picture size and the English live channels.
// Called by test-mediathek.js: run({ test, resp, tmpDir }). Plain Node, no network: every answer is a recorded fixture.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const FX = path.join(__dirname, 'fixtures', 'en');
const readFx = (f) => fs.readFileSync(path.join(FX, f), 'utf8');
const jsonFx = (f) => JSON.parse(readFx(f));

/** A fetch that answers from a table: [[RegExp|string, (url, init) → Response]]; everything else is a test failure. */
function fakeFetch(routes, calls = []) {
  return async (url, init = {}) => {
    calls.push({ url, init });
    for (const [m, fn] of routes) if (typeof m === 'string' ? url === m : m.test(url)) return fn(url, init);
    throw new Error('unexpected request ' + url);
  };
}

/** Bundle an ES module of the renderer for Node (the app sources are ES modules inside a CommonJS package). */
function loadEsm(rel) {
  const esbuild = require('esbuild');
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lesesaal-esm-')), 'm.cjs');
  esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', '..', rel)], outfile: out, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning' });
  try { return require(out); } finally { try { fs.rmSync(path.dirname(out), { recursive: true, force: true }); } catch {} }
}

// ---- MP4 files for the header reader --------------------------------------------------------------------------------
const box = (type, ...kids) => { const body = Buffer.concat(kids.map((k) => (Buffer.isBuffer(k) ? k : Buffer.from(k)))); const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length); h.write(type, 4, 'latin1'); return Buffer.concat([h, body]); };
function tkhd(w, h) { const b = Buffer.alloc(84); b.writeUInt32BE(w * 65536, 76); b.writeUInt32BE(h * 65536, 80); return box('tkhd', b); }
function hdlr(kind) { const b = Buffer.alloc(24); b.write(kind, 8, 'latin1'); return box('hdlr', b); }
function stsd(codec) { const b = Buffer.alloc(16); b.writeUInt32BE(1, 4); b.writeUInt32BE(8, 8); b.write(codec, 12, 'latin1'); return box('stsd', b); }
function mvhd(seconds) { const b = Buffer.alloc(100); b.writeUInt32BE(1000, 12); b.writeUInt32BE(seconds * 1000, 16); return box('mvhd', b); }
const trak = (w, h, kind, codec, pad = 0) => box('trak', tkhd(w, h), box('mdia', hdlr(kind), box('minf', box('stbl', stsd(codec), box('stsz', Buffer.alloc(pad)))))) ;
const moov = (...traks) => box('moov', mvhd(754), ...traks);
/** A file that exists only in pieces ({ offset: Buffer }), `size` bytes long, served with Range like a CDN. */
function rangeServer(pieces, size, { ranges = true } = {}) {
  const read = (start, end) => {
    const out = Buffer.alloc(end - start + 1);
    for (const [off, buf] of Object.entries(pieces)) {
      const o = +off;
      for (let i = Math.max(start, o); i <= Math.min(end, o + buf.length - 1); i++) out[i - start] = buf[i - o];
    }
    return out;
  };
  return async (url, init) => {
    const m = /bytes=(\d+)-(\d+)/.exec((init.headers || {}).Range || '');
    if (!ranges || !m) {
      const head = read(0, Math.min(size, 70000) - 1);
      return new Response(new ReadableStream({ start(c) { c.enqueue(head); c.close(); } }), { status: 200, headers: { 'content-length': String(size) } });
    }
    const s = +m[1], e = Math.min(+m[2], size - 1);
    return new Response(read(s, e), { status: 206, headers: { 'content-range': `bytes ${s}-${e}/${size}` } });
  };
}

async function run({ test, resp, tmpDir }) {
  const heightsLib = require('./heights');
  const playlist = require('./playlist');
  const common = require('./sources/common');
  const { createDw } = require('./sources/dw');
  const { createNhk, fromEpisode } = require('./sources/nhk');
  const { createNasa, filesOf: nasaFiles } = require('./sources/nasa');
  const { createArchive, queryFor, filesOf: iaFiles, fromDoc } = require('./sources/archive');
  const { createTed } = require('./sources/ted');
  const { createSources, interleave } = require('./sources');
  const json = (data) => resp(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  const xml = (text) => resp(text, { headers: { 'content-type': 'application/rss+xml' } });
  const NOW = Date.parse('2026-10-04T12:00:00Z');

  console.log('Englischsprachige Quellen');
  await test('DW: media centre list (videos only), detail with six MP4 sizes, search in the newest pages', async () => {
    const list = jsonFx('dw-list.json'), detail = jsonFx('dw-detail.json');
    const calls = [];
    const fetch = fakeFetch([[/api\.dw\.com\/api\/list\/mediacenter\/2\?pageIndex=1$/, () => json(list)], [/api\.dw\.com\/api\/list\/mediacenter\/2\?pageIndex=\d+$/, () => json({ items: [], paginationInfo: list.paginationInfo })], [/\/detail\/video\/\d+$/, () => json(detail)]], calls);
    const dw = createDw({ fetch, now: () => NOW });
    const r = await dw.list({ size: 10 });
    assert.strictEqual(r.items.length, 7, 'the photo gallery is no film');
    const it = r.items.find((x) => x.id === 'dw:' + detail.id);
    assert.ok(it && it.lazy && it.source === 'dw' && it.channel === 'DW.EN' && it.lang === 'en');
    assert.ok(/^https:\/\/static\.dw\.com\/image\//.test(it.image) && it.timestamp > 0 && it.duration > 0);
    assert.ok(r.hasMore && r.total > 1000);
    const full = await dw.resolve(it);
    assert.deepStrictEqual(Object.keys(full.video).sort(), ['h1080', 'h270', 'h288', 'h360', 'h540', 'h720']);
    assert.deepStrictEqual(full.heights.h720, { width: 1280, height: 720 });
    assert.ok(Object.values(full.video).every((u) => /^https:\/\/tvdownloaddw-a\.akamaihd\.net\//.test(u)));
    assert.ok(!full.lazy && full.topic === detail.categoryName);
    assert.ok(it.website === null && full.website === detail.permaLink, 'the page is the permanent link DW publishes');
    // a search looks through the newest pages; a word must begin a word of the film
    const word = it.title.split(/\s+/).find((w) => w.length > 4).toLowerCase();
    const s = await dw.list({ text: word.slice(0, 4) });
    assert.ok(s.items.some((x) => x.id === it.id));
    assert.strictEqual((await dw.list({ text: 'zzqxv' })).items.length, 0);
    const long = await dw.list({ topic: 'long' });
    assert.ok(long.items.length >= 1 && long.items.every((x) => x.duration >= 1200));
    await assert.rejects(dw.resolve({ id: 'dw:../../etc', source: 'dw' }), /Unbekannt/);
  });
  await test('NHK WORLD-JAPAN: episodes as HLS masters, expired ones left out, categories as topics', async () => {
    const eps = jsonFx('nhk-episodes.json'), cats = jsonFx('nhk-categories.json');
    const calls = [];
    const fetch = fakeFetch([[/showsapi\/v1\/en\/video_episodes\?limit=\d+&offset=0$/, () => json(eps)], [/showsapi\/v1\/en\/categories\/15\/video_episodes/, () => json({ ...eps, items: eps.items.slice(0, 2) })], [/showsapi\/v1\/en\/categories$/, () => json(cats)]], calls);
    const nhk = createNhk({ fetch, now: () => NOW });
    const r = await nhk.list({ size: 6 });
    assert.strictEqual(r.items.length, eps.items.length);
    const it = r.items[0];
    assert.ok(it.hls && /^https:\/\/masterpl\.hls\.nhkworld\.jp\/.+\.m3u8$/.test(it.video.hls) && !it.lazy);
    assert.ok(it.image.startsWith('https://www3.nhk.or.jp/') && it.website.startsWith('https://www3.nhk.or.jp/'));
    assert.strictEqual(it.topic, eps.items[0].video_program.title);
    const gone = { ...eps.items[0], video: { ...eps.items[0].video, expired_at: '2026-10-01T00:00:00Z' } };
    assert.strictEqual(fromEpisode(gone, NOW), null);
    const t = await nhk.topics();
    assert.ok(t.length > 5 && t.every((x) => /^category:\d+$/.test(x.id) && x.count > 0));
    assert.ok(t[0].count >= t[t.length - 1].count);
    const c = await nhk.list({ topic: 'category:15', size: 10 });
    assert.strictEqual(c.items.length, 2);
    assert.ok(calls.some((x) => /categories\/15\/video_episodes\?limit=10&offset=0/.test(x.url)));
  });
  await test('NASA: search, popular videos, files of an asset (no master upload, no preview), captions', async () => {
    const search = jsonFx('nasa-search.json'), popular = jsonFx('nasa-popular.json'), coll = jsonFx('nasa-collection.json');
    const fetch = fakeFetch([[/images-api\.nasa\.gov\/search\?/, () => json(search)], [/images-assets\.nasa\.gov\/popular\.json$/, () => json(popular)], [/collection\.json$/, () => json(coll)]]);
    const fake = { ofItem: async ({ video }) => Object.fromEntries(Object.keys(video).map((k) => [k, { width: 0, height: 1, p: { small: 360, mobile: 180, medium: 360 }[k] || 720, duration: 2902 }])) };
    const nasa = createNasa({ fetch, heights: fake, now: () => NOW });
    const r = await nasa.list({ text: 'apollo 11', size: 5 });
    assert.strictEqual(r.items.length, 5);
    assert.ok(r.items.every((x) => x.lazy && x.source === 'nasa' && x.id.startsWith('nasa:') && /^https:\/\/images-assets\.nasa\.gov\//.test(x.image || 'https://images-assets.nasa.gov/')));
    assert.ok(r.hasMore && r.total === search.collection.metadata.total_hits);
    const pop = await nasa.list({ topic: 'popular' });
    assert.ok(pop.items.length >= 1);
    const f = nasaFiles(coll);
    assert.ok(!Object.keys(f.video).includes('orig') && !Object.values(f.video).some((u) => /preview/.test(u)));
    assert.ok(Object.values(f.video).every((u) => u.startsWith('https://images-assets.nasa.gov/')));
    assert.ok(/\.(vtt|srt)$/.test(f.subtitle));
    const full = await nasa.resolve(r.items[0]);
    assert.ok(Object.keys(full.video).length >= 1 && full.duration === 2902 && full.subtitle);
    assert.deepStrictEqual(nasaFiles(['http://images-assets.nasa.gov/video/x/x~orig.mp4']).video, { orig: 'https://images-assets.nasa.gov/video/x/x~orig.mp4' });
  });
  await test('Internet Archive: public-domain query, adult titles left out, H.264 files by size, subtitles', async () => {
    const q = queryFor('feature_films', 'night of the');
    assert.ok(/collection:\(feature_films\) AND licenseurl:\*publicdomain\*/.test(q) && /title:\(night\)/.test(q));
    assert.ok(!/licenseurl/.test(queryFor('prelinger', '')));
    assert.ok(/collection:\(prelinger\) OR/.test(queryFor(null, '')));
    const search = jsonFx('ia-search.json'), meta = jsonFx('ia-metadata.json');
    const calls = [];
    const fetch = fakeFetch([[/archive\.org\/advancedsearch\.php\?/, () => json(search)], [/archive\.org\/metadata\/his_girl_friday$/, () => json(meta)]], calls);
    const ia = createArchive({ fetch, now: () => NOW });
    const r = await ia.list({ topic: 'prelinger', size: 5 });
    assert.strictEqual(r.items.length, search.response.docs.length);
    assert.ok(r.items.every((x) => x.topic === 'Prelinger Archives' && x.image.startsWith('https://archive.org/services/img/') && x.website.startsWith('https://archive.org/details/')));
    assert.ok(r.items.some((x) => x.duration > 0) && r.items.every((x) => x.year >= 1900 && x.timestamp === Date.UTC(x.year, 0, 1)));
    assert.ok(/sort%5B%5D=downloads\+desc/.test(calls[0].url) && !/fl%5B%5D=collection/.test(calls[0].url));
    assert.strictEqual(fromDoc({ identifier: 'x', title: 'Diary of a Nudist' }), null);
    const f = iaFiles(meta, 'his_girl_friday');
    assert.ok(f.video.h480 && f.video.h240 && !Object.values(f.video).some((u) => /\.ogv$/.test(u)));
    assert.deepStrictEqual(f.heights.h480, { width: 640, height: 480, size: Number(meta.files.find((x) => x.name === 'his_girl_friday.mp4').size) });
    assert.ok(/his_girl_friday\.asr\.srt$/.test(f.subtitle) && f.duration > 5000);
    const full = await ia.resolve({ id: 'ia:his_girl_friday', source: 'archive', ref: 'his_girl_friday', title: 'His Girl Friday', lazy: true });
    assert.ok(!full.lazy && full.video.h480.startsWith('https://archive.org/download/his_girl_friday/'));
  });
  await test('TED: HD and SD feed joined per talk, speaker as topic', async () => {
    const fetch = fakeFetch([[/TedtalksHD$/, () => xml(readFx('ted-hd.xml'))], [/TEDTalks_video$/, () => xml(readFx('ted-sd.xml'))]]);
    const ted = createTed({ fetch, now: () => NOW });
    const r = await ted.list({});
    assert.strictEqual(r.items.length, 3);
    const both = r.items.filter((x) => x.video.hd && x.video.sd);
    assert.strictEqual(both.length, 2);
    const it = r.items[0];
    assert.ok(!/ \| /.test(it.title) && it.topic && it.speaker === it.topic);
    assert.ok(/^https:\/\/download\.ted\.com\//.test(it.video.hd));
    const raw = common.parseRss(readFx('ted-hd.xml')).items.find((e) => e.enclosure === it.video.hd);
    assert.ok(raw && it.image === (raw.image || null) && it.website === (raw.link || null), 'picture and page exactly as the feed names them');
    assert.strictEqual((await ted.list({ text: it.speaker.split(' ')[0] })).items[0].id, it.id);
  });
  await test('sources: one search over several (cursor per source, interleaved), hosts of every source', async () => {
    assert.deepStrictEqual(interleave([[1, 2, 3], ['a'], ['x', 'y']]), [1, 'a', 'x', 2, 'y', 3]);
    const mk = (id, n) => ({ id, channel: id.toUpperCase(), list: async ({ offset = 0, size }) => { const all = Array.from({ length: n }, (_, i) => ({ id: `${id}:${i}`, title: id + i, timestamp: 1000 - i, duration: i * 60 })); const items = all.slice(offset, offset + size); return { items, total: n, hasMore: offset + size < n, received: items.length }; } });
    const src = createSources({ fetch: async () => { throw new Error('no network'); }, extra: [mk('aa', 10), mk('bb', 3)] });
    const r1 = await src.query({ sources: ['aa', 'bb'], size: 12 });
    assert.deepStrictEqual(r1.items.slice(0, 4).map((x) => x.id), ['aa:0', 'bb:0', 'aa:1', 'bb:1']);
    assert.deepStrictEqual(r1.cursor, { aa: 6, bb: null });
    const r2 = await src.query({ sources: ['aa', 'bb'], size: 12, cursor: r1.cursor });
    assert.deepStrictEqual(r2.items.map((x) => x.id), ['aa:6', 'aa:7', 'aa:8', 'aa:9']);
    assert.strictEqual(r2.hasMore, false);
    const byLength = await src.query({ sources: ['aa', 'bb'], size: 12, sort: 'long' });
    assert.ok(byLength.items[0].duration >= byLength.items[1].duration);
    assert.ok(src.isMediaHost('https://tvdownloaddw-a.akamaihd.net/x.mp4') && src.isMediaHost('https://archive.org/download/a/b.mp4'));
    assert.ok(!src.isMediaHost('https://evil.example.com/x.mp4') && !src.isMediaHost('https://static.dw.com/image/1.jpg'));
    assert.ok(src.isImageHost('https://static.dw.com/image/1.jpg') && !src.isImageHost('https://archive.org.evil.com/x.jpg'));
    assert.ok(common.matches({ title: 'Rocket launch', topic: '', description: '' }, 'laun') && !common.matches({ title: 'Prelaunch', topic: '', description: '' }, 'launch'));
    assert.strictEqual(common.parseDuration('1:31:44'), 5504); assert.strictEqual(common.parseDuration('106 min'), 6360); assert.strictEqual(common.parseDuration('19:29'), 1169);
  });

  console.log('Bildgrößen');
  await test('picture classes: letterboxed, anamorphic, portrait, odd sizes', () => {
    const c = heightsLib.classOf;
    assert.deepStrictEqual([c(1920, 1080), c(1280, 544), c(1920, 800), c(1551, 720), c(1280.4, 594), c(720, 406), c(853.3, 480), c(640, 480), c(1080, 1920), c(746, 420), c(0, 0)],
      [1080, 720, 1080, 720, 720, 406, 480, 480, 1080, 420, 0]);
  });
  await test('sizes named by the addresses of the broadcasters', () => {
    const f = (u) => { const r = heightsLib.fromUrl(u); return r ? r.height : null; };
    assert.strictEqual(f('https://ctv-videos.daserste.de/int/2026/09/13/X/X_3863984_sendeton_1280x720-50p-3200kbit.mp4'), 720);
    assert.strictEqual(f('https://mdr-progressive.ard-mcdn.de/mdr/video/x.avc540.mp4'), 540);
    assert.strictEqual(f('https://rbb-progressive.ard-mcdn.de/c/x_hd1080-avc360.mp4'), 360);
    assert.strictEqual(f('https://swr-pd.ard-mcdn.de/swr/geo/de/video/film/2354748.avc-1080.mp4'), 1080);
    assert.strictEqual(f('https://wdr-progressive.ard-mcdn.de/media/p/x_AVC-720.mp4'), 720);
    assert.strictEqual(f('https://rbprogressivedl-a.akamaihd.net/clips/1/x_576i.mp4'), 576);
    assert.strictEqual(f('https://nrodlzdf-a.akamaihd.net/none/zdf/26/10/x/1/x_6660k_p37v17.mp4'), 1080);
    assert.strictEqual(f('https://rodlzdf-a.akamaihd.net/none/zdf/26/10/x/1/x_808k_p11v17.mp4'), null, 'p11 is read from the file');
    assert.strictEqual(f('https://arteptweb-a.akamaihd.net/am/ptweb/1/x_EQ_0_VO_1_MP4-1500_AMM-PTWEB-1_x.mp4'), 406);
    assert.strictEqual(f('https://ndr-progressive.ard-mcdn.de/progressive/2024/0927/TV-1.hd.mp4'), 720);
    assert.strictEqual(f('https://cdn-storage.br.de/b0/13/x/x_X.mp4'), 720);
    assert.strictEqual(f('https://srstorage01-a.akamaihd.net/Video/FS/X/X-1_H.mp4'), 1080);
    assert.strictEqual(f('https://tvdownloaddw-a.akamaihd.net/dwtv_video/flv/x/x_AVC_512x288.mp4'), 288);
    assert.strictEqual(f('https://funk-02dd.akamaized.net/22679/files/26/10/02/1/4-VNb3g.mp4'), null);
  });
  await test('MP4 header: moov in front, moov at the end, video track behind an audio track, no Range support', async () => {
    const front = Buffer.concat([box('ftyp', 'isom0000'), moov(trak(0, 0, 'soun', 'mp4a', 2000), trak(1280, 720, 'vide', 'avc1', 3000)), box('mdat', Buffer.alloc(1000))]);
    let calls = [];
    let r = await heightsLib.probeMp4('https://cdn.example.org/a.mp4', { fetch: fakeFetch([[/a\.mp4/, rangeServer({ 0: front }, front.length)]], calls) });
    assert.deepStrictEqual([r.width, r.height, r.codec, Math.round(r.duration)], [1280, 720, 'avc1', 754]);
    assert.strictEqual(calls.length, 1);
    // moov behind a 40 MB mdat; a subtitle track with a size first, the audio track's tables longer than one read
    const ftyp = box('ftyp', 'mp42abcd');
    const mdatHead = Buffer.alloc(8); mdatHead.writeUInt32BE(40e6); mdatHead.write('mdat', 4, 'latin1');
    const tail = moov(trak(1920, 1080, 'text', 'tx3g'), trak(0, 0, 'soun', 'mp4a', 70000), trak(1920, 1080, 'vide', 'avc1'));
    const size = ftyp.length + 40e6 + tail.length;
    calls = [];
    r = await heightsLib.probeMp4('https://cdn.example.org/b.mp4', { fetch: fakeFetch([[/b\.mp4/, rangeServer({ 0: Buffer.concat([ftyp, mdatHead]), [ftyp.length + 40e6]: tail }, size)]], calls) });
    assert.deepStrictEqual([r.width, r.height, r.codec, r.size], [1920, 1080, 'avc1', size]);
    assert.ok(calls.length <= 5, 'a few small requests: ' + calls.length);
    // a server without Range support: the first bytes are enough when the moov box is in front
    r = await heightsLib.probeMp4('https://cdn.example.org/c.mp4', { fetch: fakeFetch([[/c\.mp4/, rangeServer({ 0: front }, front.length, { ranges: false })]]) });
    assert.strictEqual(r.height, 720);
    // recorded: the first 8 KB of a FRANCE 24 file in 720p
    const rec = fs.readFileSync(path.join(FX, 'mp4-head-faststart.bin'));
    r = await heightsLib.probeMp4('https://cdn.example.org/d.mp4', { fetch: fakeFetch([[/d\.mp4/, rangeServer({ 0: rec }, 409991808)]]) });
    assert.deepStrictEqual([r.width, r.height, r.codec], [1280, 720, 'avc1']);
    assert.strictEqual(await heightsLib.probeMp4('https://cdn.example.org/e.mp4', { fetch: async () => resp('<html>nope</html>', { status: 200 }) }), null);
  });
  await test('sizes of a film: address, cache, MP4 header; a playlist stays without a size and nothing next to it is asked', async () => {
    const store = new Map();
    const variant = 'https://srf-vod.example.org/world/hls/x/film.mp4.csmil/index-f3-v1-a1.m3u8';
    const calls = [];
    const fetch = fakeFetch([[/opaque\.mp4$/, rangeServer({ 0: Buffer.concat([box('ftyp', 'isom0000'), moov(trak(960, 540, 'vide', 'avc1'))]) }, 2000)]], calls);
    const hs = heightsLib.createHeights({ fetch, store: { get: (u) => store.get(u) || null, set: (u, v) => store.set(u, v) }, now: () => NOW });
    const out = await hs.ofItem({ video: { low: 'https://funk.example.org/opaque.mp4', sd: 'https://ctv-videos.daserste.de/x_1280x720-50p-3200kbit.mp4', hd: variant } });
    assert.deepStrictEqual([out.low.p, out.sd.p], [540, 720]);
    assert.ok(!out.hd, 'a variant playlist names no size');
    assert.ok(calls.length > 0 && calls.every((c) => c.url === 'https://funk.example.org/opaque.mp4'), 'only the published file was asked');
    assert.strictEqual(out.low.label, '540p');
    assert.ok(store.get('https://funk.example.org/opaque.mp4').height === 540 && !store.has(variant));
    const again = await heightsLib.createHeights({ fetch: async () => { throw new Error('no network'); }, store: { get: (u) => store.get(u) || null, set() {} } }).sizeOf('https://funk.example.org/opaque.mp4');
    assert.strictEqual(again.from, 'cache');
    assert.deepStrictEqual(await hs.ofItem({ hls: true, video: { hls: 'https://masterpl.hls.nhkworld.jp/hls/w/1/master.m3u8' } }), {});
    const m = playlist.parseMaster(readFx('nhk-master.m3u8'), 'https://masterpl.hls.nhkworld.jp/hls/w/1/master.m3u8');
    assert.deepStrictEqual([...new Set(m.variants.map((v) => v.height))].sort((a, b) => b - a).slice(0, 2), [720, 360]);
    assert.strictEqual(playlist.pickVariant(m.variants, 'h480').height, 360);
    assert.strictEqual(playlist.pickVariant(m.variants, 'h720').height, 720);
    assert.strictEqual(playlist.pickVariant(m.variants, 'h100').height, Math.min(...m.variants.map((v) => v.height)));
  });

  console.log('Qualitätswahl');
  const Q = loadEsm('app/src/media/quality.js');
  await test('preference: Automatisch, 1080p … and the old names of 0.6', () => {
    assert.deepStrictEqual(Q.PREFERENCES, ['auto', 1080, 720, 480, 360]);
    assert.deepStrictEqual(['hd', 'sd', 'low', 'auto', '720p', 720, '1080', 'Quatsch', null].map(Q.preferenceOf), [1080, 480, 360, 'auto', 720, 720, 1080, 'auto', 'auto']);
  });
  await test('renditions of a film: real sizes, guesses for unknown ones, doubles collapse', () => {
    const v = { low: 'l.mp4', sd: 's.mp4', hd: 'h.mp4' };
    let r = Q.renditionsOf(v, { sd: { width: 1280, height: 720 }, hd: { width: 1920, height: 1080, p: 1080 } });
    assert.deepStrictEqual(r.map((x) => [x.key, x.height, x.label]), [['hd', 1080, '1080p'], ['sd', 720, '720p'], ['low', 360, '']]);
    r = Q.renditionsOf({ sd: 'a.mp4', hd: 'b.mp4' }, { sd: { height: 720 }, hd: { height: 720 } });
    assert.deepStrictEqual(r.map((x) => x.key), ['hd'], 'two files of one size: the bigger name stays');
    r = Q.renditionsOf({ sd: 'same.m3u8', hd: 'same.m3u8' }, {});
    assert.strictEqual(r.length, 1);
    r = Q.renditionsOf({ h1080: 'a', h720: 'b', h540: 'c', h360: 'd', h288: 'e', h270: 'f' }, {});
    assert.deepStrictEqual(r.map((x) => x.label), ['1080p', '720p', '540p', '360p', '288p', '270p']);
  });
  await test('the closest size to a preference, auto by window height, one step down', () => {
    const L = (...hs) => hs.map((h) => ({ key: 'h' + h, height: h }));
    assert.strictEqual(Q.closest(L(1080, 540, 360), 720).height, 540);
    assert.strictEqual(Q.closest(L(576, 360), 480).height, 576);
    assert.strictEqual(Q.closest(L(840, 600), 720).height, 600, 'equal distance: the smaller one');
    assert.strictEqual(Q.closest(L(720, 360), 1080).height, 720);
    assert.strictEqual(Q.closest(L(720, 360), 'auto').height, 720);
    assert.strictEqual(Q.autoPick(L(1080, 720, 360), 1440).height, 1080);
    assert.strictEqual(Q.autoPick(L(1080, 720, 360), 960).height, 1080);
    assert.strictEqual(Q.autoPick(L(1080, 720, 360), 700).height, 720);
    assert.strictEqual(Q.autoPick(L(1080, 720, 360), 1440, 720).height, 720);
    assert.strictEqual(Q.autoPick(L(1080), 300).height, 1080);
    assert.strictEqual(Q.lower(L(1080, 720, 360), 'h720').key, 'h360');
    assert.strictEqual(Q.lower(L(1080, 720, 360), 'h360'), null);
    assert.strictEqual(Q.defaultDownload(L(1080, 720, 360), 'auto').height, 1080);
    assert.strictEqual(Q.defaultDownload(L(1080, 720, 360), 'sd').height, 360, '0.6 "Mittel" stands for 480: 360 is closer than 720');
  });
  await test('HLS levels: one per size, the best bitrate, biggest first', () => {
    const lv = Q.levelsOf([{ width: 1280, height: 720, bitrate: 1.8e6 }, { width: 1920, height: 1080, bitrate: 7e6 }, { width: 1280, height: 720, bitrate: 3.5e6 }, { width: 640, height: 360, bitrate: 1.1e6 }]);
    assert.deepStrictEqual(lv.map((l) => [l.key, l.index]), [['h1080', 1], ['h720', 2], ['h360', 3]]);
  });

  console.log('Einstellungen, Downloads, Live');
  await test('settings: the old quality names become heights, the newspaper switch is off', () => {
    const { migrateSettings, DEFAULTS } = require('../settings');
    assert.strictEqual(DEFAULTS.mediathek.quality, 'auto');
    assert.deepStrictEqual(DEFAULTS.news, { otherLanguages: false });
    for (const [old, now] of [['hd', 1080], ['sd', 480], ['low', 360], ['auto', 'auto'], [720, 720]]) {
      const d = { tts: { voiceSchema: 2 }, mediathek: { quality: old } };
      migrateSettings(d);
      assert.strictEqual(d.mediathek.quality, now, String(old));
    }
    const none = { tts: { voiceSchema: 2 } };
    assert.strictEqual(migrateSettings(none), false);
  });
  await test('downloads: options with real sizes, a size of a source, a size of one HLS master', async () => {
    const { createDownloads } = require('./downloads');
    const { Allowlist } = require('./allowlist');
    const allow = new Allowlist();
    allow.add('https://tvdownloaddw-a.akamaihd.net/'); allow.add('https://masterpl.hls.nhkworld.jp/');
    const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3500000,RESOLUTION=1280x720\nv720.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x720\nv720b.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1100000,RESOLUTION=640x360\nv360.m3u8\n';
    const media = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\ns1.ts\n#EXTINF:4,\ns2.ts\n#EXT-X-ENDLIST\n';
    const fetch = async (url, init = {}) => {
      if (/\.mp4$/.test(url)) return resp(Buffer.alloc(1), { status: 206, url, headers: { 'content-range': `bytes 0-0/${/720/.test(url) ? 300e6 : 100e6}` } });
      if (/master\.m3u8$/.test(url)) return resp(master, { url });
      if (/v360\.m3u8$/.test(url)) return resp(media, { url });
      if (/\.ts$/.test(url)) return resp(Buffer.alloc(188 * 4, 0x47), { url });
      return resp('?', { status: 404, url });
    };
    const folder = path.join(tmpDir, 'en-dl');
    const trusted = (it) => { const v = {}; for (const [k, u] of Object.entries(it.video || {})) if (allow.has(u)) v[k] = u; return Object.keys(v).length ? { ...it, video: v } : null; };
    const dl = createDownloads({ fetch, indexFile: path.join(tmpDir, 'en-dl.json'), folder: () => folder, trusted, channelName: (c) => c });
    const dwItem = { id: 'dw:1', channel: 'DW.EN', title: 'Young startups', timestamp: NOW, duration: 1700, video: { h720: 'https://tvdownloaddw-a.akamaihd.net/a_AVC_1280x720.mp4', h360: 'https://tvdownloaddw-a.akamaihd.net/a_AVC_640x360.mp4' }, heights: { h720: { width: 1280, height: 720, p: 720 }, h360: { width: 640, height: 360, p: 360 } } };
    const opts = await dl.options(dwItem, async () => ({}));
    assert.deepStrictEqual(opts.map((o) => [o.quality, o.height, o.bytes]), [['h720', 720, 300e6], ['h360', 360, 100e6]]);
    const nhkItem = { id: 'nhk:1', channel: 'NHK', title: 'Furniture in Blue', duration: 900, hls: true, video: { hls: 'https://masterpl.hls.nhkworld.jp/hls/w/1/master.m3u8' } };
    const hopts = await dl.options(nhkItem);
    assert.deepStrictEqual(hopts.map((o) => [o.quality, o.height, o.bytes]), [['h720', 720, 3500000 / 8 * 900], ['h360', 360, 1100000 / 8 * 900]]);
    const d = dl.start(nhkItem, 'h360');
    assert.strictEqual(d.quality, 'h360'); assert.strictEqual(d.height, 360); assert.strictEqual(d.kind, 'hls');
    for (let i = 0; i < 80; i++) { const x = dl.get(d.id); if (x.status === 'done' || x.status === 'error') break; await new Promise((r) => setTimeout(r, 50)); }
    const done = dl.get(d.id);
    assert.strictEqual(done.status, 'done', done.error);
    assert.ok(fs.statSync(done.file).size === 2 * 188 * 4);
    const m = dl.start(dwItem, 'h720');
    assert.strictEqual(m.quality, 'h720'); assert.strictEqual(m.height, 720);
    dl.remove(m.id, { files: true });
    assert.strictEqual(dl.start(dwItem, 'gibtsnicht').quality, 'h720', 'an unknown key takes the first one');
    dl.shutdown();
  });
  await test('English live channels: only addresses the broadcasters publish, unchanged; FRANCE 24 with its official master', async () => {
    const live = require('./live');
    const en = live.loadBundled().filter((c) => c.group === 'en');
    assert.deepStrictEqual(en.map((c) => c.id).sort(), ['aljazeera_en', 'dw_en', 'france24_en', 'nhk_world']);
    assert.ok(en.every((c) => c.lang === 'en' && (live.validStream(c.stream) || live.validResolve(c.resolve)) && !c.levels), 'no master is put together');
    const f24 = en.find((c) => c.id === 'france24_en');
    assert.strictEqual(f24.stream, 'https://live.france24.com/hls/live/2037218/F24_EN_HI_HLS/master.m3u8');
    // the documents the broadcasters' own web players read (recorded answers)
    const DW_STREAM = 'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/master.m3u8';
    const NHK_STREAM = 'https://masterpl.hls.nhkworld.jp/hls/w/live/master.m3u8';
    let dwUp = true;
    const docs = fakeFetch([
      [/dw\.com\/graph-api\/en\/livestream\/english$/, () => (dwUp ? json({ data: { livestreamChannels: [{ hlsVideoSrc: DW_STREAM, nextTimeSlots: [] }] } }) : resp('down', { status: 503 }))],
      [/livepl\.nhkworld\.jp\/hlslive_web\.json$/, () => json({ main: { jstrm: NHK_STREAM } })],
      [/zapp\.mediathekview\.de/, () => resp('offline', { status: 503 })],
    ]);
    let t = NOW;
    const l = live.createLive({ fetch: docs, now: () => t });
    const shown = await l.list();
    const srcOf = (id) => shown.find((c) => c.id === id).src;
    assert.deepStrictEqual(['dw_en', 'nhk_world', 'france24_en', 'aljazeera_en'].map(srcOf), ['media://live/dw_en/master.m3u8', 'media://live/nhk_world/master.m3u8', undefined, undefined]);
    assert.strictEqual(await l.stream('nhk_world'), NHK_STREAM);
    assert.strictEqual(await l.stream('dw_en'), DW_STREAM);
    assert.strictEqual(await l.stream('france24_en'), f24.stream);
    assert.strictEqual(await l.stream('gibtsnicht'), null);
    // DW's document not reachable a few minutes later: the address published there on the day of the list
    dwUp = false; t += 5 * 60e3;
    assert.strictEqual(await l.stream('dw_en'), en.find((c) => c.id === 'dw_en').stream);
    // the media:// route: the master from the published address, unchanged, its addresses through the proxy
    const { createMediaProtocol } = require('./proxy');
    const { Allowlist } = require('./allowlist');
    const allow = new Allowlist();
    const asked = [];
    const variant = 'https://media-tyo.hls.nhkworld.jp/hls/w/live/1/sig/5302/v3.m3u8';
    const masterText = `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\n${variant}\n`;
    const upstream = async (url) => { asked.push(url); return url === NHK_STREAM ? resp(masterText, { headers: { 'content-type': 'application/vnd.apple.mpegurl' } }) : resp('refused', { status: 403 }); };
    let images = 0;
    const mp = createMediaProtocol({ fetch: upstream, allow, thumbs: { thumb: async () => null, image: async () => { images++; return null; } }, toVtt: (x) => x,
      liveStream: async (id) => { const u = await l.stream(id); if (u) allow.add(u); return u; } });
    let r = await mp.handle(new Request('media://live/nhk_world/master.m3u8'));
    const body = await r.text();
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(asked, [NHK_STREAM], 'the master comes from the published address, unchanged');
    const lines = body.split('\n').filter((x) => x.startsWith('media://proxy/'));
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(Buffer.from(lines[0].split('/')[3], 'base64url').toString(), variant);
    assert.ok(allow.has(variant), 'the addresses inside the published master may follow');
    r = await mp.handle(new Request('media://live/gibtsnicht/master.m3u8'));
    assert.ok(r.status >= 400);
    // FRANCE 24 English refuses its master: the answer says so, no other address is tried
    allow.add(f24.stream);
    asked.length = 0;
    r = await mp.handle(new Request('media://proxy/' + Buffer.from(f24.stream).toString('base64url') + '/master.m3u8'));
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.headers.get('x-mediathek-error'), 'forbidden');
    assert.deepStrictEqual(asked, [f24.stream]);
    r = await mp.handle(new Request('media://image/' + Buffer.from('https://static.dw.com/image/1_303.jpg').toString('base64url') + '/bild.jpg'));
    assert.strictEqual(r.status, 204); assert.strictEqual(images, 1);
  });
  await test('allowlist and stored items: source hosts only, every size kept, lazy items without addresses', () => {
    const { Allowlist } = require('./allowlist');
    const { slim } = require('./library');
    const allow = new Allowlist();
    const src = createSources({ fetch: async () => { throw new Error('x'); } });
    allow.addItem({ source: 'dw', video: { h720: 'https://tvdownloaddw-a.akamaihd.net/a.mp4', h360: 'https://evil.example.com/b.mp4' }, subtitle: 'https://evil.example.com/s.vtt' }, src.isMediaHost);
    assert.ok(allow.has('https://tvdownloaddw-a.akamaihd.net/x') && !allow.has('https://evil.example.com/x'));
    const s = slim({ id: 'ted:1', source: 'ted', lazy: true, image: 'https://pi.tedcdn.com/x.jpg', title: 'T', video: { hd: 'https://download.ted.com/1.mp4', sd: 'https://download.ted.com/2.mp4' }, heights: { hd: { width: 1920, height: 1080, p: 1080 }, bogus: { height: 5 } } });
    assert.strictEqual(s.source, 'ted'); assert.ok(s.lazy && s.image);
    assert.strictEqual(s.video.hd, 'https://download.ted.com/1.mp4');
    assert.deepStrictEqual(Object.keys(s.heights), ['hd']);
  });
}

module.exports = { run };
