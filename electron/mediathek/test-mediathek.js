// Fixture tests for the Mediathek backend: API normalisation, playlist rewriting, TTML → WebVTT, the
// media:// proxy with its allowlist, resume logic, downloads (MP4 with resume, HLS into one file) and
// preview images, and (test-en.js) the English-language sources and the picture sizes of 0.7.
// Run:  node electron/mediathek/test-mediathek.js      Plain Node: no Electron, no network.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const mvw = require('./mvw');
const channels = require('./channels');
const playlist = require('./playlist');
const subtitles = require('./subtitles');
const resume = require('./resume');
const errors = require('./errors');
const { Allowlist } = require('./allowlist');
const { createMediaProtocol, b64, proxyUrl } = require('./proxy');
const { createDownloads, baseName } = require('./downloads');
const { createLibrary } = require('./library');
const thumbs = require('./thumbs');
const live = require('./live');

const FX = path.join(__dirname, 'fixtures');
const read = (f) => fs.readFileSync(path.join(FX, f), 'utf8');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 5).join('\n       ')); }
}
/** Response with a settable url (fetch() responses carry the address after redirects). */
function resp(body, { status = 200, headers = {}, url = '' } = {}) {
  const r = new Response(body, { status, headers });
  Object.defineProperty(r, 'url', { value: url });
  return r;
}
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediathek-test-'));
const isInside = (p, root) => { const rel = path.relative(path.normalize(root), path.normalize(p)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };

(async () => {
  console.log('API');
  const api = JSON.parse(read('mvw-query.json'));
  const items = api.result.results.map(mvw.normalize);

  await test('normalize: fields, units and URLs', () => {
    const it = items[0];
    assert.ok(it.id && it.channel === 'ARD');
    assert.strictEqual(it.timestamp, api.result.results[0].timestamp * 1000);
    assert.strictEqual(typeof it.duration, 'number');
    assert.ok(/^https:\/\//.test(it.video.sd));
    assert.ok(it.video.low && it.video.hd);
    assert.strictEqual(it.hls, false);
    for (const x of items) { assert.ok(x.title); assert.ok(x.video.sd); assert.ok(x.video.sd !== x.video.hd); }
  });
  await test('normalize: HLS (SRF, ORF), geo hint, missing hd (PHOENIX)', () => {
    const srf = items.find((x) => x.channel === 'SRF');
    assert.ok(srf.hls && /\.m3u8/.test(srf.video.sd));
    const orf = items.find((x) => x.channel === 'ORF');
    assert.strictEqual(orf.geo, 'at');
    const phx = items.find((x) => x.channel === 'PHOENIX');
    assert.strictEqual(phx.video.hd, null);
    assert.strictEqual(mvw.normalize({ channel: 'X', title: 'kein Film' }), null);
  });
  await test('variants: Audiodeskription and friends are recognised and hidden by dedupe', () => {
    assert.strictEqual(mvw.variantOf('Donuts (Audiodeskription)'), 'ad');
    assert.strictEqual(mvw.variantOf('heute journal (S2026/E287) (Gebärdensprache)'), 'dgs');
    assert.strictEqual(mvw.variantOf('Die letzten Menschen von Köln (2026) (klare Sprache)'), 'ks');
    assert.strictEqual(mvw.variantOf('Côte d´Azur (mit Untertitel)'), 'ut');
    assert.strictEqual(mvw.variantOf('The Crown (Originalversion mit Untertitel)'), 'ov');
    assert.strictEqual(mvw.variantOf('Tatort: Donuts'), null);
    assert.strictEqual(mvw.baseTitle('Donuts (Audiodeskription)'), 'Donuts');
    const d = mvw.dedupe(items);
    assert.ok(!d.some((x) => x.variant === 'ad'));
    // "Schlafende Hunde" is listed twice with the same time → once
    assert.strictEqual(d.filter((x) => x.title === 'Schlafende Hunde').length, 1);
    assert.ok(mvw.dedupe(items, { variants: true }).some((x) => x.variant === 'ad'));
  });
  await test('query body: text, exact channels, topics, duration, sort, search syntax', () => {
    let b = mvw.buildBody({ text: 'tatort münster', channels: ['ARD', 'WDR'], sort: 'long', durationMin: 3600, size: 30 });
    assert.deepStrictEqual(b.queries[0], { fields: ['title', 'topic'], query: 'tatort münster' });
    assert.deepStrictEqual(b.queries.slice(1).map((q) => q.query), ['ARD', 'WDR']);
    assert.ok(b.queries.slice(1).every((q) => q.fields[0] === 'channel.keyword'));
    assert.strictEqual(b.sortBy, 'duration'); assert.strictEqual(b.duration_min, 3600); assert.strictEqual(b.size, 30);
    b = mvw.buildBody({ text: '!zdf #terra >20 <60 lesch' });
    assert.deepStrictEqual(b.queries.map((q) => q.fields.join()), ['title,topic', 'topic', 'channel']);
    assert.strictEqual(b.duration_min, 1200); assert.strictEqual(b.duration_max, 3600);
    b = mvw.buildBody({});
    assert.strictEqual(b.queries.length, channels.germanIds().length);
    assert.ok(!b.queries.some((q) => q.query === 'ARTE.FR'));
    b = mvw.buildBody({ topic: 'Tatort', channels: ['ARD'], sort: 'relevance' });
    assert.deepStrictEqual(b.queries[0], { fields: ['topic.keyword'], query: 'Tatort' });
    assert.strictEqual(b.sortBy, undefined);
    assert.strictEqual(mvw.buildBody({ size: 5000 }).size, 200);
    b = mvw.buildBody({ topicsLike: ['Terra X', 'Leschs Kosmos'], channels: ['ZDF'] });
    assert.deepStrictEqual(b.queries.slice(0, 2), [{ fields: ['topic'], query: 'Terra X' }, { fields: ['topic'], query: 'Leschs Kosmos' }]);
  });
  await test('client: cache, allowlist hook, friendly errors', async () => {
    let calls = 0, seen = 0;
    const fetch = async (url, init) => { calls++; assert.strictEqual(init.headers['User-Agent'], mvw.UA); assert.strictEqual(init.headers['Content-Type'], 'text/plain'); JSON.parse(init.body); return resp(JSON.stringify(api), { headers: { 'content-type': 'application/json' } }); };
    const c = mvw.createClient({ fetch, onItems: (list) => { seen += list.length; } });
    const r1 = await c.query({ text: 'tatort' });
    const r2 = await c.query({ text: 'tatort' });
    assert.strictEqual(calls, 1);
    assert.strictEqual(r1, r2);
    assert.strictEqual(seen, items.length);
    assert.strictEqual(r1.total, 1234);
    const bad = mvw.createClient({ fetch: async () => { throw new Error('getaddrinfo ENOTFOUND mediathekviewweb.de'); } });
    await assert.rejects(bad.query({ text: 'x' }), /Keine Verbindung zu MediathekViewWeb/);
    const down = mvw.createClient({ fetch: async () => resp('oops', { status: 503 }) });
    await assert.rejects(down.query({ text: 'x' }), /Störung/);
  });

  console.log('Playlists');
  const zdfBase = 'https://zdf-hls-15.akamaized.net/hls/live/2016498/de/high/master.m3u8';
  const map = (abs, kind) => `media://proxy/${b64(abs)}/${kind}`;
  await test('rewrite: master with EXT-X-MEDIA (root-relative URIs)', () => {
    const out = playlist.rewrite(read('live-master-zdf.m3u8'), zdfBase, map);
    const lines = out.split('\n');
    for (const l of lines) {
      if (!l.trim()) continue;
      if (l.startsWith('#')) { const uris = [...l.matchAll(/URI="([^"]*)"/g)].map((m) => m[1]); for (const u of uris) assert.ok(u.startsWith('media://proxy/'), l); }
      else assert.ok(l.startsWith('media://proxy/') && l.endsWith('/playlist'), l);
    }
    const first = /URI="media:\/\/proxy\/([^/"]+)\/playlist"/.exec(out)[1];
    assert.strictEqual(Buffer.from(first, 'base64url').toString(), 'https://zdf-hls-15.akamaized.net/hls/live/2016498/de/fa6afb24b6bda4102241c439ffe2c94e/4/4.m3u8');
    assert.ok(/SUBTITLES,GROUP-ID="T1-2011680127"/.test(out), 'attributes other than URI stay');
  });
  await test('rewrite: I-frame playlists and trailing EXT-X-MEDIA (tagesschau24)', () => {
    const base = 'https://tagesschau.akamaized.net/hls/live/2020117/tagesschau/tagesschau_3/master.m3u8';
    const out = playlist.rewrite(read('live-master-tagesschau.m3u8'), base, map);
    assert.ok(!/URI="(?!media:)/.test(out));
    assert.ok(!out.split('\n').some((l) => l && !l.startsWith('#') && !l.startsWith('media://')));
    const iframe = /I-FRAME-STREAM-INF:.*URI="media:\/\/proxy\/([^/"]+)\/playlist"/.exec(out);
    assert.ok(Buffer.from(iframe[1], 'base64url').toString().endsWith('/tagesschau_3/master-360p-1200_I-Frame.m3u8'));
  });
  await test('rewrite: media playlist with query strings, keys, init section, byte ranges, data: URIs', () => {
    const base = 'https://cdn.example.org/vod/film/index.m3u8?token=abc';
    const src = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-TARGETDURATION:6', '#EXT-X-MAP:URI="init.mp4",BYTERANGE="720@0"',
      '#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example.org/k?id=1",IV=0x1', '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://drm"',
      '#EXTINF:6.0,', '#EXT-X-BYTERANGE:1000@720', 'film.mp4', '#EXTINF:6.0,', 'seg-2.m4s?caption=a%3Ab&x=1', '#EXTINF:4.0,', '/root/seg-3.m4s', '#EXTINF:1.0,', 'data:video/mp2t;base64,AAAA', '#EXT-X-ENDLIST'].join('\n');
    const kinds = [];
    const out = playlist.rewrite(src, base, (abs, kind) => { kinds.push(kind); return proxyUrl(abs); });
    assert.deepStrictEqual(kinds, ['map', 'key', 'segment', 'segment', 'segment']);
    assert.ok(out.includes('BYTERANGE="720@0"') && out.includes('#EXT-X-BYTERANGE:1000@720'));
    assert.ok(out.includes('URI="skd://drm"') && out.includes('data:video/mp2t;base64,AAAA'));
    const segs = out.split('\n').filter((l) => l.startsWith('media://proxy/'));
    const decoded = segs.map((s) => Buffer.from(s.split('/')[3], 'base64url').toString());
    assert.deepStrictEqual(decoded, ['https://cdn.example.org/vod/film/film.mp4', 'https://cdn.example.org/vod/film/seg-2.m4s?caption=a%3Ab&x=1', 'https://cdn.example.org/root/seg-3.m4s']);
    const media = playlist.parseMedia(src, base);
    assert.strictEqual(media.segments.length, 4);
    assert.ok(media.encrypted && media.endlist);
    assert.deepStrictEqual(media.map.byterange, { length: 720, offset: 0 });
    assert.deepStrictEqual(media.segments[0].byterange, { length: 1000, offset: 720 });
  });
  await test('parse: variants, qualities, German audio rendition, VOD playlist', () => {
    const m = playlist.parseMaster(read('live-master-zdf.m3u8'), zdfBase);
    assert.strictEqual(m.variants.length, 6);
    assert.deepStrictEqual(['low', 'sd', 'hd'].map((q) => playlist.pickVariant(m.variants, q).height), [360, 540, 720]);
    const a = playlist.pickAudio(m.media, m.variants[0].audio);
    assert.strictEqual(a.name, 'TV Ton');
    const t = playlist.parseMaster(read('live-master-tagesschau.m3u8'), 'https://x.de/a/master.m3u8');
    assert.strictEqual(playlist.pickAudio(t.media, 'program_audio').name, 'Deutsch');
    const v = playlist.parseMedia(read('vod-srf.m3u8'), 'https://srf-vod-amd.akamaized.net/world/hls/x/index-f4-v1-a1.m3u8');
    assert.ok(v.endlist && !v.encrypted);
    assert.strictEqual(v.segments.length, 8);
    assert.strictEqual(Math.round(v.duration * 100) / 100, 61.52);
  });
  await test('byte-range playlist of a download is consistent', () => {
    const parts = [{ duration: 4, length: 1000 }, { duration: 6, length: 2500 }, { duration: 1.52, length: 300 }];
    const txt = playlist.buildByteRangePlaylist('Film (ARD).ts', parts, { targetDuration: 10 });
    const back = playlist.parseMedia(txt, 'file:///x/');
    assert.ok(back.endlist);
    assert.deepStrictEqual(back.segments.map((s) => s.byterange), [{ length: 1000, offset: 0 }, { length: 2500, offset: 1000 }, { length: 300, offset: 3500 }]);
    const withInit = playlist.parseMedia(playlist.buildByteRangePlaylist('f.mp4', parts, { init: { length: 720 } }), 'file:///x/');
    assert.deepStrictEqual(withInit.map.byterange, { length: 720, offset: 0 });
    assert.strictEqual(withInit.segments[0].byterange.offset, 720);
    const master = playlist.buildLocalMaster({ video: 'v.m3u8', audio: 'a.m3u8', bandwidth: 2e6, width: 960, height: 540, codecs: 'avc1.4d401f' });
    const pm = playlist.parseMaster(master, 'file:///x/');
    assert.strictEqual(pm.variants[0].audio, 'aud');
    assert.strictEqual(pm.media[0].uri, 'file:///x/a.m3u8');
  });

  console.log('Subtitles');
  await test('TTML (ARD EBU-TT-D) → WebVTT with speaker colours', () => {
    const vtt = subtitles.toVtt(read('ttml-ard.xml'));
    assert.ok(vtt.startsWith('WEBVTT\n'));
    assert.ok(vtt.includes('00:00:02.600 --> 00:00:04.600\nUT\n'));
    assert.ok(vtt.includes('<c.yellow>(Jo)</c>\n<c.magenta>(Vera)</c><c.cyan> (Bruno)</c>'));
    assert.ok(!/\n\n\n/.test(vtt));
    const cues = vtt.split('\n\n').filter((b) => b.includes('-->'));
    assert.ok(cues.length >= 20);
  });
  await test('TTML (ZDF, SRF with 2-digit fractions) → WebVTT', () => {
    const z = subtitles.toVtt(read('ttml-zdf.xml'));
    assert.ok(z.includes('00:00:03.440 --> 00:00:06.240\nEine Branche,\ndie Millionen verdient.'));
    const s = subtitles.toVtt(read('ttml-srf.xml'));
    assert.ok(s.includes('00:00:12.160 --> 00:00:15.680\nSchnelles Wachstum\nund knapper Boden -'));
    assert.ok(s.includes('<c.yellow>Wir sind davon überzeugt,</c>'));
  });
  await test('TTML details: entities, dur, frames, ticks, 10-hour offset', () => {
    const xml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:frameRate="25" ttp:tickRate="10000000"><body><div>
      <p begin="10:00:01.000" end="10:00:02.500">A &amp; B &lt;C&gt; &#228;</p>
      <p begin="10:00:03:12" dur="1s">Frames</p>
      <p begin="360400000000t" end="360410000000t">Ticks</p></div></body></tt>`;
    const vtt = subtitles.toVtt(xml);
    assert.ok(vtt.includes('00:00:01.000 --> 00:00:02.500\nA &amp; B &lt;C&gt; ä'), vtt);
    assert.ok(vtt.includes('00:00:03.480 --> 00:00:04.480\nFrames'), vtt);
    assert.ok(vtt.includes('00:00:40.000 --> 00:00:41.000\nTicks'), vtt);
    assert.strictEqual(subtitles.parseTime('1500ms'), 1.5);
    assert.strictEqual(subtitles.formatTime(3725.5), '01:02:05.500');
    assert.strictEqual(subtitles.colorClass('#FFFF00'), 'yellow');
    assert.strictEqual(subtitles.colorClass('#ffffffc2'), null);
  });
  await test('SRT and WebVTT pass, garbage is refused', () => {
    assert.ok(subtitles.toVtt('1\n00:00:01,000 --> 00:00:02,000\nHallo\n').includes('00:00:01.000 --> 00:00:02.000'));
    assert.strictEqual(subtitles.toVtt('WEBVTT\r\n\r\n1\r\n00:00:01.000 --> 00:00:02.000\r\nx\r\n'), 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nx\n');
    assert.throws(() => subtitles.toVtt('<html>Fehler</html>'));
  });

  console.log('media:// proxy');
  const allow = new Allowlist();
  allow.add('https://videos.example.org/film.mp4');
  allow.add('https://live.example.org/master.m3u8');
  allow.add('https://subs.example.org/x.xml');
  const requests = [];
  const upstream = async (url, init) => {
    requests.push({ url, init });
    const u = new URL(url);
    if (u.pathname === '/film.mp4') {
      const range = init.headers.Range;
      if (range === 'bytes=100-199') return resp(Buffer.alloc(100, 7), { status: 206, url, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 100-199/1000', 'content-length': '100', 'access-control-allow-origin': 'https://www.ardmediathek.de' } });
      return resp(Buffer.alloc(1000, 1), { url, headers: { 'content-type': 'video/mp4', 'content-length': '1000', 'accept-ranges': 'bytes' } });
    }
    if (u.pathname === '/master.m3u8') return resp('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2000\nhttps://cdn2.example.org/hi/index.m3u8\n', { url, headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    if (u.pathname === '/gone.mp4') return resp('nope', { status: 404, url });
    if (u.pathname === '/geo.m3u8') return resp('#EXTM3U\n', { url: 'https://videos.example.org/gp_nas/insert_geoprotection_hr.smil/playlist.m3u8', headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    if (u.hostname === 'subs.example.org') return resp(read('ttml-zdf.xml'), { url, headers: { 'content-type': 'application/xml' } });
    return resp('?', { status: 500, url });
  };
  const localDir = path.join(tmpDir, 'local');
  fs.mkdirSync(localDir, { recursive: true });
  const mp = createMediaProtocol({ fetch: upstream, allow, thumbs: { thumb: async () => null }, toVtt: subtitles.toVtt, localRoots: () => [localDir], lfileUrl: (p) => 'lfile://local/' + b64(p) + '/' + encodeURIComponent(path.basename(p)), isInside });
  const get = (target, init) => mp.handle(new Request(`media://${target}`, init));

  await test('proxy refuses hosts outside the Mediathek and non-web targets', async () => {
    let r = await get('proxy/' + b64('https://evil.example.com/x.mp4'));
    assert.strictEqual(r.status, 403);
    r = await get('proxy/' + b64('file:///C:/Windows/win.ini'));
    assert.strictEqual(r.status, 400);
    r = await get('proxy/' + b64('https://videos.example.org.evil.com/film.mp4'));
    assert.strictEqual(r.status, 403);
    assert.strictEqual(requests.length, 0);
    assert.ok(!allow.has('http://localhost/'));
  });
  await test('proxy forwards Range and passes status and headers through, with CORS', async () => {
    const r = await get('proxy/' + b64('https://videos.example.org/film.mp4') + '/film.mp4', { headers: { Range: 'bytes=100-199' } });
    assert.strictEqual(r.status, 206);
    assert.strictEqual(r.headers.get('content-range'), 'bytes 100-199/1000');
    assert.strictEqual(r.headers.get('content-length'), '100');
    assert.strictEqual(r.headers.get('content-type'), 'video/mp4');
    assert.strictEqual(r.headers.get('accept-ranges'), 'bytes');
    assert.strictEqual(r.headers.get('access-control-allow-origin'), '*');
    assert.strictEqual((await r.arrayBuffer()).byteLength, 100);
    assert.strictEqual(requests[0].init.headers.Range, 'bytes=100-199');
    assert.strictEqual(requests[0].init.headers['User-Agent'], 'CozyShelves/0.3 (Mediathek)');
    const full = await get('proxy/' + b64('https://videos.example.org/film.mp4'));
    assert.strictEqual(full.status, 200);
    assert.strictEqual(full.headers.get('content-length'), '1000');
    const opt = await get('proxy/' + b64('https://videos.example.org/film.mp4'), { method: 'OPTIONS' });
    assert.strictEqual(opt.status, 204);
  });
  await test('proxy rewrites playlists and learns the hosts inside them', async () => {
    assert.ok(!allow.has('https://cdn2.example.org/hi/index.m3u8'));
    const r = await get('proxy/' + b64('https://live.example.org/master.m3u8'));
    assert.strictEqual(r.status, 200);
    assert.ok(/mpegurl/.test(r.headers.get('content-type')));
    const text = await r.text();
    const uris = text.split('\n').filter((l) => l && !l.startsWith('#'));
    assert.strictEqual(uris.length, 2);
    assert.ok(uris.every((u) => u.startsWith('media://proxy/')));
    assert.strictEqual(Buffer.from(uris[0].split('/')[3], 'base64url').toString(), 'https://live.example.org/low/index.m3u8');
    assert.ok(allow.has('https://cdn2.example.org/hi/index.m3u8'));
  });
  await test('proxy reports expired films and geo blocking', async () => {
    let r = await get('proxy/' + b64('https://videos.example.org/gone.mp4'));
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.headers.get('x-mediathek-error'), 'gone');
    r = await get('proxy/' + b64('https://videos.example.org/geo.m3u8'));
    assert.strictEqual(r.status, 451);
    assert.ok(/geo/.test(r.headers.get('x-mediathek-error')));
  });
  await test('media://subs converts to WebVTT, media://local maps downloads to lfile://', async () => {
    let r = await get('subs/' + b64('https://subs.example.org/x.xml'));
    assert.strictEqual(r.status, 200);
    assert.ok(/text\/vtt/.test(r.headers.get('content-type')));
    assert.ok((await r.text()).startsWith('WEBVTT'));
    r = await get('subs/' + b64('https://other.example.org/x.xml'));
    assert.strictEqual(r.status, 403);
    const pl = path.join(localDir, 'Film (ARD, 1.1.2026).m3u8');
    fs.writeFileSync(pl, playlist.buildByteRangePlaylist(encodeURIComponent('Film (ARD, 1.1.2026).ts'), [{ duration: 5, length: 10 }]));
    r = await get('local/' + b64(pl));
    const t = await r.text();
    const seg = t.split('\n').find((l) => l.startsWith('lfile://'));
    assert.ok(seg, t);
    assert.strictEqual(Buffer.from(seg.split('/')[3], 'base64url').toString(), path.join(localDir, 'Film (ARD, 1.1.2026).ts'));
    r = await get('local/' + b64(path.join(tmpDir, 'elsewhere.m3u8')));
    assert.strictEqual(r.status, 403);
  });

  console.log('Weiterschauen');
  await test('resume thresholds', () => {
    assert.strictEqual(resume.classify(10, 3600), 'none');
    assert.strictEqual(resume.classify(600, 3600), 'resume');
    assert.strictEqual(resume.classify(3550, 3600), 'done');
    assert.strictEqual(resume.classify(3430, 3600), 'done');     // 95 %
    assert.strictEqual(resume.classify(60, 120), 'none');        // too short to resume
    assert.strictEqual(resume.startAt({ state: 'resume', position: 600 }), 595);
    assert.strictEqual(resume.startAt({ state: 'done', position: 3590 }), 0);
    assert.strictEqual(resume.startAt(null), 0);
  });
  await test('resume map: update, forget early positions, prune, list', () => {
    const m = {};
    const a = { id: 'a', title: 'A' }, b = { id: 'b', title: 'B' };
    resume.update(m, a, 700, 3600, 1000);
    resume.update(m, b, 900, 3600, 2000);
    assert.deepStrictEqual(resume.continueList(m).map((e) => e.id), ['b', 'a']);
    resume.update(m, a, 5, 3600, 3000);                             // restarted from the beginning
    assert.ok(!m.a);
    resume.update(m, b, 3590, 3600, 4000);
    assert.strictEqual(m.b.state, 'done');
    assert.strictEqual(resume.continueList(m).length, 0);
    assert.strictEqual(resume.update(m, { id: 'l', live: true }, 900, 0), null);
    for (let i = 0; i < 10; i++) resume.update(m, { id: 'x' + i }, 600, 3600, 5000 + i);
    resume.prune(m, 5);
    assert.strictEqual(Object.keys(m).length, 5);
    assert.ok(m.x9 && !m.x0);
  });
  await test('library keeps only allowlisted addresses of renderer items', () => {
    const al = new Allowlist();
    al.add('https://ok.example.org/');
    const lib = createLibrary({ file: path.join(tmpDir, 'lib.json'), allow: al });
    assert.strictEqual(lib.setFavorite({ id: 'f1', title: 'F', video: { sd: 'https://evil.example.com/x.mp4' } }, true), false);
    assert.strictEqual(lib.setFavorite({ id: 'f2', title: 'G', video: { sd: 'https://ok.example.org/x.mp4', hd: 'https://evil.example.com/y.mp4' } }, true), true);
    assert.deepStrictEqual(lib.favorites()[0].video, { low: null, sd: 'https://ok.example.org/x.mp4', hd: null });
    lib.position({ id: 'f2', title: 'G', video: { sd: 'https://ok.example.org/x.mp4' } }, 1200, 3600);
    assert.strictEqual(lib.startAt('f2'), 1195);
    lib.flush();
    const again = createLibrary({ file: path.join(tmpDir, 'lib.json'), allow: new Allowlist() });
    assert.strictEqual(again.favorites().length, 1);
    assert.strictEqual(again.continueList().length, 1);
  });

  console.log('Fehler');
  await test('error classification', () => {
    assert.strictEqual(errors.classify({ status: 404 }), 'gone');
    assert.strictEqual(errors.classify({ status: 410 }), 'gone');
    assert.strictEqual(errors.classify({ status: 403, url: 'https://nrodlzdf-a.akamaihd.net/de/zdf/x.mp4' }), 'geo');
    assert.strictEqual(errors.classify({ status: 200, url: 'https://apasfiis.sf.apa.at/ipad/cms-austria/x.m3u8', finalUrl: 'https://apasfiis.sf.apa.at/gp_nas/insert_geoprotection_hr.smil/playlist.m3u8' }), 'geo-at');
    assert.strictEqual(errors.classify({ status: 0, error: 'net::ERR_INTERNET_DISCONNECTED' }), 'offline');
    assert.strictEqual(errors.classify({ status: 503 }), 'server');
    assert.ok(/Geoblocking/.test(errors.message('geo')));
    for (const m of Object.values(errors.MESSAGES)) assert.ok(!/ [–—-] /.test(m), 'no dash as punctuation: ' + m);
  });

  console.log('Downloads');
  const film = Buffer.alloc(300000);
  for (let i = 0; i < film.length; i++) film[i] = i % 251;
  const segs = [Buffer.alloc(1880, 0x47), Buffer.alloc(3760, 0x47), Buffer.alloc(940, 0x47)];
  let failAt = null, fetches = [];
  const dlFetch = async (url, init) => {
    fetches.push({ url, range: init.headers.Range || null });
    const u = new URL(url);
    if (u.pathname === '/film.mp4') {
      const m = /bytes=(\d+)-(\d*)/.exec(init.headers.Range || '');
      if (m) {
        const start = +m[1], end = m[2] ? +m[2] : film.length - 1;
        if (start >= film.length) return resp('', { status: 416, url, headers: { 'content-range': `bytes */${film.length}` } });
        return resp(film.subarray(start, end + 1), { status: 206, url, headers: { 'content-type': 'video/mp4', 'content-range': `bytes ${start}-${end}/${film.length}`, 'content-length': String(end - start + 1) } });
      }
      if (failAt != null) {
        // deliver the first `failAt` bytes, then break the connection
        const part = film.subarray(0, failAt);
        let sent = false;
        const stream = new ReadableStream({ pull(c) { if (!sent) { sent = true; c.enqueue(new Uint8Array(part)); } else c.error(new Error('net::ERR_CONNECTION_RESET')); } });
        return resp(stream, { url, headers: { 'content-type': 'video/mp4', 'content-length': String(film.length) } });
      }
      return resp(film, { url, headers: { 'content-type': 'video/mp4', 'content-length': String(film.length) } });
    }
    if (u.pathname === '/slow.mp4') {
      // a film that trickles in for as long as nobody cancels it (a download that is removed while it runs)
      const stream = new ReadableStream({ async pull(c) { await new Promise((r) => setTimeout(r, 25)); c.enqueue(new Uint8Array(4096)); } });
      return resp(stream, { url, headers: { 'content-type': 'video/mp4', 'content-length': String(50 * 1024 * 1024) } });
    }
    if (u.pathname === '/vod/index.m3u8') return resp('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:4.0,\nseg-1.ts?x=1\n#EXTINF:6.0,\nseg-2.ts?x=1\n#EXTINF:1.5,\nseg-3.ts?x=1\n#EXT-X-ENDLIST\n', { url, headers: { 'content-type': 'application/x-mpegURL' } });
    if (u.pathname === '/live/index.m3u8') return resp('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg-1.ts\n', { url });
    const sm = /\/vod\/seg-(\d)\.ts$/.exec(u.pathname);
    if (sm) return resp(segs[+sm[1] - 1], { url, headers: { 'content-type': 'video/mp2t' } });
    if (u.pathname === '/subs.xml') return resp(read('ttml-srf.xml'), { url });
    return resp('nope', { status: 404, url });
  };
  const events = [];
  const dlDir = path.join(tmpDir, 'Cozy Shelves Mediathek');
  const makeDl = () => createDownloads({ fetch: dlFetch, indexFile: path.join(tmpDir, 'downloads.json'), folder: () => dlDir, broadcast: (ch, p) => events.push(p), channelName: (c) => channels.info(c).name, lfileUrl: (p) => 'lfile://local/' + b64(p) });
  const waitFor = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); } throw new Error('timeout waiting'); };
  const mp4Item = { id: 'mp4-1', channel: 'ARD', topic: 'Tatort', title: 'Schlafende Hunde', timestamp: Date.UTC(2026, 8, 21, 20, 15), duration: 5280, video: { low: 'https://dl.example.org/film.mp4', sd: 'https://dl.example.org/film.mp4', hd: null }, subtitle: 'https://dl.example.org/subs.xml', hls: false };
  const hlsItem = { id: 'hls-1', channel: 'SRF', topic: 'Kulturplatz', title: 'Kulturplatz: Hochhäuser', timestamp: Date.UTC(2026, 8, 23), duration: 12, video: { low: 'https://dl.example.org/vod/index.m3u8', sd: 'https://dl.example.org/vod/index.m3u8', hd: null }, hls: true };

  await test('file names', () => {
    assert.strictEqual(baseName(mp4Item, (c) => channels.info(c).name), 'Tatort · Schlafende Hunde (ARD, 21.09.2026)');
    assert.strictEqual(baseName({ ...hlsItem, title: 'a/b: c?' }, (c) => c), 'Kulturplatz · a b c (SRF, 23.09.2026)');
    assert.ok(!/[<>:"/\\|?*]/.test(baseName({ title: 'x<>:"/\\|?*y' })));
    assert.strictEqual(baseName({ ...mp4Item, topic: 'tagesschau', title: 'tagesschau 20:00 Uhr, 23.09.2026' }, (c) => c), 'tagesschau 20.00 Uhr, 23.09.2026 (ARD, 21.09.2026)');
    assert.strictEqual(baseName({ ...hlsItem, topic: 'Hypegenossen', title: 'KIND oder KARRIERE?!' }, (c) => c), 'Hypegenossen · KIND oder KARRIERE! (SRF, 23.09.2026)');
  });
  await test('MP4 download: interrupted, resumed with Range, subtitles as .vtt', async () => {
    failAt = 120000;
    let dl = makeDl();
    const first = dl.start(mp4Item, 'sd');
    assert.ok(['queued', 'running'].includes(first.status));
    const errored = await waitFor(() => dl.get(first.id).status === 'error' && dl.get(first.id));
    assert.ok(/unterbrochen|Verbindung/.test(errored.error), errored.error);
    const part = path.join(dlDir, 'Tatort · Schlafende Hunde (ARD, 21.09.2026).mp4.part');
    assert.strictEqual(fs.statSync(part).size, 120000);
    failAt = null;
    // a restart in between: the index knows the download, the .part file stays
    dl.flush();
    dl = makeDl();
    assert.strictEqual(dl.get(first.id).status, 'error');
    fetches = [];
    dl.resume(first.id);
    const done = await waitFor(() => dl.get(first.id).status === 'done' && dl.get(first.id));
    assert.strictEqual(fetches[0].range, 'bytes=120000-');
    const out = fs.readFileSync(done.file);
    assert.ok(out.equals(film), 'resumed file is byte-identical');
    assert.ok(!fs.existsSync(part));
    assert.ok(fs.readFileSync(done.subtitle, 'utf8').startsWith('WEBVTT'));
    const p = dl.playable(first.id);
    assert.ok(p.src.startsWith('lfile://') && p.hls === false && p.subtitleUrl.startsWith('lfile://'));
    assert.strictEqual(dl.start(mp4Item, 'sd').status, 'done', 'the same film is not fetched twice');
    assert.ok(events.some((e) => e.status === 'running' && e.bytes > 0));
  });
  await test('HLS download: one .ts file, byte-range playlist, live streams refused', async () => {
    const dl = makeDl();
    const v = dl.start(hlsItem, 'sd');
    const done = await waitFor(() => dl.get(v.id).status === 'done' && dl.get(v.id));
    dl.flush();
    const ts = fs.readFileSync(done.file);
    assert.ok(done.file.endsWith('.ts'));
    assert.ok(ts.equals(Buffer.concat(segs)));
    const pl = done.file.replace(/\.ts$/, '.m3u8');
    const plText = fs.readFileSync(pl, 'utf8');
    assert.ok(plText.includes(encodeURIComponent(path.basename(done.file))), 'file name URL-encoded in the playlist');
    const media = playlist.parseMedia(plText, 'file:///x/');
    assert.deepStrictEqual(media.segments.map((s) => s.byterange), [{ length: 1880, offset: 0 }, { length: 3760, offset: 1880 }, { length: 940, offset: 5640 }]);
    assert.strictEqual(media.segments[0].duration, 4);
    const p = dl.playable(v.id);
    assert.ok(p.hls && p.src.startsWith('media://local/'));
    const l = dl.start({ ...hlsItem, id: 'live-1', video: { sd: 'https://dl.example.org/live/index.m3u8' } }, 'sd');
    const bad = await waitFor(() => dl.get(l.id).status === 'error' && dl.get(l.id));
    assert.strictEqual(bad.errorKind, 'live');
    assert.ok(/Live/.test(bad.error));
    dl.flush();
  });
  await test('download of an expired film and removal of files', async () => {
    const dl = makeDl();
    const g = dl.start({ ...mp4Item, id: 'gone-1', video: { sd: 'https://dl.example.org/weg.mp4' } }, 'sd');
    const bad = await waitFor(() => dl.get(g.id).status === 'error' && dl.get(g.id));
    assert.strictEqual(bad.errorKind, 'gone');
    const all = dl.list();
    const hls = all.find((d) => d.item.id === 'hls-1');
    const files = fs.readdirSync(dlDir).filter((f) => f.startsWith('Kulturplatz'));
    assert.ok(files.length >= 2);
    await dl.remove(hls.id, { files: true });
    assert.strictEqual(fs.readdirSync(dlDir).filter((f) => f.startsWith('Kulturplatz')).length, 0);
    assert.ok(fs.existsSync(dl.list().find((d) => d.item.id === 'mp4-1').file), 'other downloads stay');
  });
  await test('removing a running download waits for its file to close and leaves no .part behind', async () => {
    const dl = makeDl();
    const s = dl.start({ ...mp4Item, id: 'slow-1', topic: 'Langsam', title: 'Ein langer Film', video: { sd: 'https://dl.example.org/slow.mp4' } }, 'sd');
    await waitFor(() => dl.get(s.id).status === 'running' && dl.get(s.id).bytes > 8192);
    const base = 'Langsam · Ein langer Film (ARD, 21.09.2026)';
    assert.strictEqual(fs.existsSync(path.join(dlDir, base + '.mp4.part')), true, 'the part is being written');
    // the file is open while the renderer removes the download: on Windows an open file cannot be deleted, so the
    // removal has to wait for the download to end before it deletes the files
    assert.strictEqual(await dl.remove(s.id, { files: true }), true);
    assert.deepStrictEqual(fs.readdirSync(dlDir).filter((f) => f.startsWith('Langsam')), [], 'files of the removed download stayed behind');
    assert.ok(!dl.list().some((d) => d.id === s.id), 'the download is still listed');
    assert.ok(!dl.get(s.id));
  });
  await test('sizes per quality from Range answers', async () => {
    const dl = makeDl();
    const s = await dl.sizes(mp4Item);
    assert.strictEqual(s.sd, film.length);
    assert.strictEqual(s.hd, undefined);
  });

  console.log('Vorschaubilder, Live');
  await test('og:image, twitter:image, JSON-LD, arte ids, image sizes', () => {
    assert.strictEqual(thumbs.extractImage('<head><meta property="og:image" content="https://a.b/x.jpg?a=1&amp;b=2"></head>', 'https://x.de/'), 'https://a.b/x.jpg?a=1&b=2');
    assert.strictEqual(thumbs.extractImage('<meta content="/img/p.png" name="twitter:image">', 'https://x.de/a/b'), 'https://x.de/img/p.png');
    assert.strictEqual(thumbs.extractImage('<script type="application/ld+json">{"thumbnailUrl":["https://c.d/t.jpg"]}</script>', 'https://x.de/'), 'https://c.d/t.jpg');
    assert.strictEqual(thumbs.extractImage('<meta property="og:image" content="https://www.ardmediathek.de/sharing-icon-1280x720.png">', 'https://x.de/'), null);
    assert.deepStrictEqual(thumbs.arteProgramId('https://www.arte.tv/de/videos/104415-000-A/lars/'), ['de', '104415-000-A']);
    assert.strictEqual(thumbs.sizedImage('https://www.ardmediathek.de/img?imwidth=1280&url=x'), 'https://www.ardmediathek.de/img?imwidth=640&url=x');
    assert.strictEqual(thumbs.sizedImage('https://www.zdf.de/assets/a-100~1920x1080?cb=1'), 'https://www.zdf.de/assets/a-100~768x432?cb=1');
    assert.strictEqual(thumbs.sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  });
  await test('thumbnails: page head only, cache on disk, misses remembered', async () => {
    let pageReads = 0, imageReads = 0;
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(2000, 1)]);
    const fetch = async (url) => {
      if (url.includes('/page')) { pageReads++; return resp('<html><head><meta property="og:image" content="/bild.png"></head><body>' + 'x'.repeat(5000) + '</body>', { url, headers: { 'content-type': 'text/html' } }); }
      if (url.includes('/bild.png')) { imageReads++; return resp(png, { url, headers: { 'content-type': 'image/png' } }); }
      return resp('<html><head></head></html>', { url, headers: { 'content-type': 'text/html' } });
    };
    const t = thumbs.createThumbs({ fetch, dir: path.join(tmpDir, 'thumbs'), resize: (b) => Buffer.concat([Buffer.from([0xff, 0xd8]), b]) });
    const a = await t.thumb('https://www.example.de/page');
    assert.ok(a && a.type === 'image/jpeg' && fs.existsSync(a.file));
    await t.thumb('https://www.example.de/page');
    assert.strictEqual(pageReads, 1); assert.strictEqual(imageReads, 1);
    assert.strictEqual(await t.thumb('https://www.example.de/leer'), null);
    assert.strictEqual(await t.thumb('https://www.example.de/leer'), null);
    const denied = thumbs.createThumbs({ fetch, dir: path.join(tmpDir, 'thumbs2'), isWebsite: () => false });
    assert.strictEqual(await denied.thumb('https://www.example.de/page'), null);
  });
  await test('live list: bundled channels, Zapp updates only with https m3u8', () => {
    const list = live.loadBundled();
    assert.ok(list.length >= 25);
    // a channel without a fixed address looks it up in a document of its broadcaster when it starts (0.7, live.js)
    assert.ok(list.every((c) => (/^https:\/\/.+\.m3u8$/.test(c.stream) || live.validResolve(c.resolve)) && c.name && c.color && c.group));
    assert.strictEqual(new Set(list.map((c) => c.id)).size, list.length);
    const upd = live.applyZapp(list, { das_erste: { streamUrl: 'https://neu.example.org/master.m3u8' }, zdf: { streamUrl: 'http://unsicher.example.org/master.m3u8' }, arte: { streamUrl: 'javascript:alert(1)' } });
    assert.strictEqual(upd.find((c) => c.id === 'das_erste').stream, 'https://neu.example.org/master.m3u8');
    assert.strictEqual(upd.find((c) => c.id === 'zdf').stream, list.find((c) => c.id === 'zdf').stream);
    assert.strictEqual(upd.find((c) => c.id === 'arte').stream, list.find((c) => c.id === 'arte').stream);
  });

  // 0.7: English-language sources, picture sizes, quality choice, settings, downloads by size (test-en.js)
  await require('./test-en').run({ test, resp, tmpDir });

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
