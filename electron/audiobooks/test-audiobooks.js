// Tests for the audiobooks backend: the tag reader (ID3v2.2/2.3/2.4 with chapters, MP3 durations, MP4 tags and chapters,
// FLAC, Ogg, WAV), folder grouping and natural order, metadata fallbacks, the tag cache and the progress store.
// Plain Node, no Electron, no network; the test files are written by build/testlib/audiobook-writer.js.
//   node electron/audiobooks/test-audiobooks.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const W = require('../../build/testlib/audiobook-writer');
const { generate } = require('../../build/testlib/gen_audiobooks');
const { readTags, readPicture, _test } = require('./tags');
const S = require('./scan');
const { TagCache } = require('./cache');
const { AudiobookLibrary } = require('./library');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesesaal-audiobooks-'));
const put = (rel, buf) => { const p = path.join(tmp, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf); return p; };
const near = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;
const titles = (books) => books.map((b) => b.title).sort();

(async () => {
  console.log('names and order');
  await test('natural order: 10 after 9, "Teil 2" before "Teil 10", CD1/… before CD2/…', () => {
    assert.deepStrictEqual(['10.mp3', '9.mp3', '1.mp3'].sort(S.naturalCompare), ['1.mp3', '9.mp3', '10.mp3']);
    assert.deepStrictEqual(['Teil 10', 'Teil 2', 'teil 1'].sort(S.naturalCompare), ['teil 1', 'Teil 2', 'Teil 10']);
    assert.deepStrictEqual(['CD2/01.mp3', 'CD1/10.mp3', 'CD1/02.mp3', 'CD10/01.mp3'].sort(S.comparePaths), ['CD1/02.mp3', 'CD1/10.mp3', 'CD2/01.mp3', 'CD10/01.mp3']);
  });
  await test('disc folder names', () => {
    for (const [n, v] of [['CD1', 1], ['CD 2', 2], ['Disc 03', 3], ['disk-4', 4], ['Teil 2', 2], ['Seite B', 2], ['3', 3]]) assert.strictEqual(S.discNumber(n), v, n);
    for (const n of ['Das erste Licht', '01 Das erste Licht', 'CDs', 'Volume 1', '123']) assert.strictEqual(S.discNumber(n), null, n);
  });
  await test('leading numbers, clean names, author and title from a folder name', () => {
    assert.deepStrictEqual(S.leadingNumber('01 Das erste Licht'), { index: 1, rest: 'Das erste Licht' });
    assert.deepStrictEqual(S.leadingNumber('Band 2 - Der Sturm'), { index: 2, rest: 'Der Sturm' });
    assert.strictEqual(S.leadingNumber('Das Licht'), null);
    assert.strictEqual(S.cleanName('03 - Der_Reiher.mp3'), 'Der Reiher');
    assert.deepStrictEqual(S.splitAuthorTitle('Erika Muster - Erzählungen am Kamin'), { author: 'Erika Muster', title: 'Erzählungen am Kamin' });
    assert.deepStrictEqual(S.splitAuthorTitle('Der Sturm - Jonas Beispiel'), { author: 'Jonas Beispiel', title: 'Der Sturm' });
    assert.strictEqual(S.splitAuthorTitle('Ein Roman - Teil 1'), null);
    assert.strictEqual(S.albumKey('Der Sturm (CD 2)'), 'der sturm');
    assert.strictEqual(S.albumKey('Der Sturm - Teil 3/4'), 'der sturm');
  });

  console.log('tags');
  await test('ID3v2.3: UTF-16 text, TXXX series, track/disc, comment, embedded JPEG; Xing duration', async () => {
    const jpg = W.jpeg(W.drawCover({ size: 64, title: 'X' }));
    const f = put('t/a.mp3', W.mp3File({ seconds: 65, tag: W.id3Tag([W.id3.text('TIT2', 'Kapitel eins'), W.id3.text('TALB', 'Der Leuchtturmwärter'), W.id3.text('TPE1', 'Jonas Beispiel'), W.id3.text('TRCK', '3/12'), W.id3.text('TPOS', '2/3'), W.id3.txxx('SERIES', 'Die Insel'), W.id3.txxx('SERIES-PART', '4'), W.id3.comm('Ein Text'), W.id3.apic('image/jpeg', jpg)], 3) }));
    const m = await readTags(f);
    assert.strictEqual(m.title, 'Kapitel eins'); assert.strictEqual(m.album, 'Der Leuchtturmwärter'); assert.strictEqual(m.artist, 'Jonas Beispiel');
    assert.deepStrictEqual([m.track, m.trackTotal, m.disc, m.discTotal], [3, 12, 2, 3]);
    assert.strictEqual(m.series, 'Die Insel'); assert.strictEqual(m.seriesPart, 4); assert.strictEqual(m.comment, 'Ein Text');
    assert(m.durationExact && near(m.duration, 65, 0.1), String(m.duration));
    const pic = await readPicture(f, m.picture);
    assert.strictEqual(pic.mime, 'image/jpeg'); assert(pic.data.equals(jpg), 'picture bytes differ');
  });
  await test('ID3v2.4 chapters (CHAP/CTOC): titles, start and end, the order of the table of contents', async () => {
    const tag = W.id3Tag([W.id3.text('TIT2', 'Kurzgeschichten', 4), W.id3.ctoc('toc', ['b', 'a', 'c'], 4), W.id3.chap('a', 30000, 60000, 'Zweites', 4), W.id3.chap('b', 0, 30000, 'Erstes', 4), W.id3.chap('c', 60000, 90000, 'Drittes', 4)], 4);
    const m = await readTags(put('t/b.mp3', W.mp3File({ seconds: 90, tag })));
    assert.deepStrictEqual(m.chapters, [{ start: 0, end: 30, title: 'Erstes' }, { start: 30, end: 60, title: 'Zweites' }, { start: 60, end: 90, title: 'Drittes' }]);
  });
  await test('ID3v2.2 (three-letter frames, PIC) and ID3v1 as the last resort', async () => {
    const frame = (id, data) => Buffer.concat([Buffer.from(id, 'latin1'), Buffer.from([(data.length >> 16) & 255, (data.length >> 8) & 255, data.length & 255]), data]);
    const txt = (s) => Buffer.concat([Buffer.from([0]), Buffer.from(s, 'latin1')]);
    const body = Buffer.concat([frame('TT2', txt('Alter Titel')), frame('TAL', txt('Altes Album')), frame('TP1', txt('Alte Autorin')), frame('PIC', Buffer.concat([Buffer.from([0]), Buffer.from('PNG', 'latin1'), Buffer.from([3, 0]), Buffer.from([1, 2, 3, 4])])), Buffer.alloc(32)]);
    const ss = (n) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
    const v22 = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([2, 0, 0]), ss(body.length), body]);
    const m = await readTags(put('t/c.mp3', Buffer.concat([v22, ...W.mp3Frames(5)])));
    assert.strictEqual(m.title, 'Alter Titel'); assert.strictEqual(m.album, 'Altes Album'); assert.strictEqual(m.artist, 'Alte Autorin');
    assert.strictEqual(m.picture.mime, 'image/png');
    assert.deepStrictEqual([...(await readPicture(path.join(tmp, 't/c.mp3'), m.picture)).data], [1, 2, 3, 4]);
    const v1 = Buffer.alloc(128); v1.write('TAG', 0, 'latin1'); v1.write('Titel Eins', 3, 'latin1'); v1.write('Autor Zwei', 33, 'latin1'); v1.write('Album Drei', 63, 'latin1'); v1.write('2004', 93, 'latin1'); v1[126] = 7;
    const m1 = await readTags(put('t/d.mp3', Buffer.concat([...W.mp3Frames(5), v1])));
    assert.deepStrictEqual([m1.title, m1.artist, m1.album, m1.year, m1.track], ['Titel Eins', 'Autor Zwei', 'Album Drei', 2004, 7]);
  });
  await test('unsynchronisation: a whole ID3v2.3 tag and a single ID3v2.4 frame', async () => {
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0x00, 0x42, 0xff, 0xd9]);
    const plain = W.id3Tag([W.id3.text('TIT2', 'Ganz'), W.id3.apic('image/jpeg', jpg)], 3, 0);
    const unsync = (b) => { const o = []; for (let i = 0; i < b.length; i++) { o.push(b[i]); if (b[i] === 0xff && (i + 1 >= b.length || b[i + 1] === 0x00 || (b[i + 1] & 0xe0) === 0xe0)) o.push(0); } return Buffer.from(o); };
    const body = unsync(plain.subarray(10));
    const ss = (n) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
    const tagged = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([3, 0, 0x80]), ss(body.length), body]);
    const f = put('t/e.mp3', Buffer.concat([tagged, ...W.mp3Frames(3)]));
    const m = await readTags(f);
    assert.strictEqual(m.title, 'Ganz');
    assert((await readPicture(f, m.picture)).data.equals(jpg), 'tag-level unsync picture');
    // v2.4: the APIC frame alone is unsynchronised (format flag 0x02)
    const apic = W.id3.apic('image/jpeg', jpg, 4);
    const data = unsync(apic.subarray(10));
    const fr = Buffer.concat([Buffer.from('APIC', 'latin1'), ss(data.length), Buffer.from([0, 0x02]), data]);
    const t4 = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([4, 0, 0]), ss(fr.length + W.id3.text('TIT2', 'Vier', 4).length), W.id3.text('TIT2', 'Vier', 4), fr]);
    const f4 = put('t/f.mp3', Buffer.concat([t4, ...W.mp3Frames(3)]));
    const m4 = await readTags(f4);
    assert.strictEqual(m4.title, 'Vier');
    assert((await readPicture(f4, m4.picture)).data.equals(jpg), 'frame-level unsync picture');
  });
  await test('MP3 duration: Xing frame count, else the bit rate (CBR), TLEN as a hint', async () => {
    const x = await readTags(put('t/g.mp3', W.mp3File({ seconds: 30 })));
    assert(x.durationExact && near(x.duration, 30, 0.05), String(x.duration));
    const cbr = await readTags(put('t/h.mp3', W.mp3File({ seconds: 30, xing: false })));
    assert(!cbr.durationExact && near(cbr.duration, 30, 0.1), String(cbr.duration));
    const big = W.id3Tag([W.id3.text('TLEN', '30500')], 3, 300000);   // a large tag (a picture) in front of the frames
    const t = await readTags(put('t/i.mp3', Buffer.concat([big, ...W.mp3Frames(30, { xing: false })])));
    assert(near(t.duration, 30.5, 0.01), 'TLEN close to the estimate wins: ' + t.duration);
    assert(t.reads <= 8, 'reads ' + t.reads);
  });
  await test('MP4/M4B: iTunes tags, freeform series, track/disc, covr; QuickTime chapter track', async () => {
    const png = W.png(W.drawCover({ size: 32 }));
    const f = put('t/j.m4b', W.mp4File({ seconds: 300, nero: false, chapters: [{ start: 0, title: 'Prolog' }, { start: 100, title: 'Mitte' }, { start: 250.5, title: 'Schluss' }],
      cover: { data: png, mime: 'image/png' }, tags: { '©nam': 'Die lange Nacht', '©ART': 'Lena Probe', aART: 'Lena Probe', '©nrt': 'Max Sprecher', '©day': '2021-04-01', trkn: [2, 9], disk: [1, 2], '----:com.apple.iTunes:SERIES': 'Nachtgeschichten', '----:com.apple.iTunes:SERIES-PART': '3' } }));
    const m = await readTags(f);
    assert.strictEqual(m.format, 'mp4'); assert(near(m.duration, 300, 0.05));
    assert.deepStrictEqual([m.title, m.artist, m.albumArtist, m.narrator, m.year, m.track, m.trackTotal, m.disc, m.discTotal, m.series, m.seriesPart], ['Die lange Nacht', 'Lena Probe', 'Lena Probe', 'Max Sprecher', 2021, 2, 9, 1, 2, 'Nachtgeschichten', 3]);
    assert.deepStrictEqual(m.chapters.map((c) => [c.start, c.title]), [[0, 'Prolog'], [100, 'Mitte'], [250.5, 'Schluss']]);
    assert((await readPicture(f, m.picture)).data.equals(png));
  });
  await test('MP4: Nero chapters (chpl) when there is no chapter track', async () => {
    const m = await readTags(put('t/k.m4a', W.mp4File({ seconds: 200, qt: false, brand: 'M4A ', chapters: [{ start: 0, title: 'Eins' }, { start: 60.25, title: 'Zwei' }, { start: 120, title: 'Drei' }] })));
    assert.deepStrictEqual(m.chapters, [{ start: 0, end: 60.25, title: 'Eins' }, { start: 60.25, end: 120, title: 'Zwei' }, { start: 120, end: null, title: 'Drei' }]);
    assert.deepStrictEqual(_test.neroChapters(Buffer.from([1, 0, 0, 0, 0, 0, 0, 0, 0])), []);
  });
  await test('FLAC: STREAMINFO duration, Vorbis comments with CHAPTERxxx, PICTURE', async () => {
    const jpg = W.jpeg(W.drawCover({ size: 32 }));
    const f = put('t/l.flac', W.flacFile({ seconds: 9, picture: { data: jpg, mime: 'image/jpeg' }, comments: ['TITLE=Sterne', 'ALBUM=Sterne über dem See', 'ARTIST=Lena Probe', 'TRACKNUMBER=2/5', 'CHAPTER001=00:00:00.000', 'CHAPTER001NAME=Abend', 'CHAPTER002=00:00:04.5', 'CHAPTER002NAME=Nacht'] }));
    const m = await readTags(f);
    assert(near(m.duration, 9, 0.01) && m.durationExact);
    assert.deepStrictEqual([m.title, m.album, m.artist, m.track, m.trackTotal], ['Sterne', 'Sterne über dem See', 'Lena Probe', 2, 5]);
    assert.deepStrictEqual(m.chapters, [{ start: 0, end: 4.5, title: 'Abend' }, { start: 4.5, end: null, title: 'Nacht' }]);
    assert((await readPicture(f, m.picture)).data.equals(jpg));
  });
  await test('Ogg Vorbis and Opus: comments, picture in the comments, duration from the last granule', async () => {
    const png = W.png(W.drawCover({ size: 300 }));   // big enough for a comment packet over several pages
    const v = put('t/m.ogg', W.oggFile({ kind: 'vorbis', seconds: 125.5, comments: ['TITLE=Ogg', 'ALBUM=Ogg Album', 'ARTIST=Erika Muster', 'SERIES=Reihe'], picture: { data: png, mime: 'image/png' } }));
    const m = await readTags(v);
    assert.deepStrictEqual([m.format, m.title, m.album, m.artist, m.series], ['ogg', 'Ogg', 'Ogg Album', 'Erika Muster', 'Reihe']);
    assert(near(m.duration, 125.5, 0.01));
    assert((await readPicture(v, m.picture)).data.equals(png));
    const o = await readTags(put('t/n.opus', W.oggFile({ kind: 'opus', seconds: 42, comments: ['TITLE=Opus', 'NARRATOR=Max Sprecher'] })));
    assert.deepStrictEqual([o.format, o.title, o.narrator], ['opus', 'Opus', 'Max Sprecher']);
    assert(near(o.duration, 42, 0.001), String(o.duration));
  });
  await test('WAV: duration from the data chunk, RIFF INFO tags; a broken file gives an error, never a throw', async () => {
    const m = await readTags(put('t/o.wav', W.wavFile({ seconds: 3, info: { INAM: 'Eins', IART: 'Erika Muster', IPRD: 'Kamin' } })));
    assert.deepStrictEqual([m.title, m.artist, m.album], ['Eins', 'Erika Muster', 'Kamin']); assert(near(m.duration, 3, 0.001));
    const bad = await readTags(put('t/p.m4b', Buffer.from('ftypM4B kaputt')));
    assert(bad.error, 'error expected');
  });

  console.log('grouping');
  const lib = path.join(tmp, 'lib');
  generate(lib, { extra: 0 });
  const scan1 = await S.scanFolders([{ path: lib }]);
  const by = (t) => scan1.books.find((b) => b.title === t);
  await test('the test library: eight audiobooks of every layout', () => {
    assert.deepStrictEqual(titles(scan1.books), ['Das erste Licht', 'Der Leuchtturmwärter', 'Der Sturm', 'Die lange Nacht', 'Die Rückkehr', 'Erzählungen am Kamin', 'Kurzgeschichten vom See', 'Sterne über dem See'].sort());
  });
  await test('a folder of tracks: natural order (10 after 9), chapters per track, author from the tags, cover.jpg not back.jpg', () => {
    const b = by('Erzählungen am Kamin');
    assert.deepStrictEqual(b.tracks.map((t) => parseInt(t.name, 10)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    assert.strictEqual(b.author, 'Erika Muster'); assert.strictEqual(b.kind, 'folder');
    assert.strictEqual(b.chapters.length, 11); assert.strictEqual(b.chapters[9].title, 'Die Nacht');
    assert.strictEqual(path.basename(b.cover.file), 'cover.jpg');
    assert(near(b.tracks[2].start, b.tracks[0].duration + b.tracks[1].duration, 0.001));
  });
  await test('disc folders CD1/CD2 are one audiobook; the narrator comes from the composer, the cover from the first track', () => {
    const b = by('Der Leuchtturmwärter');
    assert.deepStrictEqual(b.tracks.map((t) => t.title), ['Ankunft', 'Der Turm', 'Das Licht', 'Der Sturm', 'Heimkehr']);
    assert.deepStrictEqual([b.author, b.narrator, b.year], ['Jonas Beispiel', 'Max Sprecher', 2019]);
    assert.strictEqual(b.cover.kind, 'embedded'); assert(b.description && b.description.startsWith('Ein Leuchtturmwärter'));
  });
  await test('single files with chapters in a shared folder are audiobooks of their own', () => {
    const n = by('Die lange Nacht'), k = by('Kurzgeschichten vom See'), s = by('Sterne über dem See');
    for (const b of [n, k, s]) assert.strictEqual(b.kind, 'file');
    assert.deepStrictEqual(n.chapters.map((c) => c.offset), [0, 120, 300, 480, 640]);
    assert.deepStrictEqual([n.series, n.seriesIndex, n.narrator], ['Nachtgeschichten', 1, 'Max Sprecher']);
    assert.strictEqual(k.narrator, 'Lisa Lesend'); assert.strictEqual(k.chapters[2].title, 'Der Reiher');
    assert.strictEqual(s.chapters.length, 3);
  });
  await test('numbered folders are the volumes of a series', () => {
    for (const [t, i] of [['Das erste Licht', 1], ['Der Sturm', 2], ['Die Rückkehr', 3]]) { const b = by(t); assert.strictEqual(b.series, 'Die Reihe vom Wald'); assert.strictEqual(b.seriesIndex, i); assert.strictEqual(path.basename(b.cover.file), 'cover.png'); }
  });
  await test('fallbacks without tags: "Autor - Titel", the author folder, one m4b of several parts, album split', async () => {
    const root = path.join(tmp, 'fb');
    for (let i = 1; i <= 3; i++) put(`fb/Jonas Beispiel - Ohne Tags/${i}.mp3`, W.mp3File({ seconds: 5 }));
    for (let i = 1; i <= 2; i++) put(`fb/Erika Muster/Das Buch ohne Namen/${i}.mp3`, W.mp3File({ seconds: 5 }));
    // two m4b parts of one album stay one audiobook
    for (let i = 1; i <= 2; i++) put(`fb/Zwei Teile/Teil ${i}.m4b`, W.mp4File({ seconds: 30, tags: { '©alb': 'Zwei Teile', '©nam': 'Teil ' + i }, chapters: [{ start: 0, title: 'A' + i }, { start: 10, title: 'B' + i }] }));
    // two albums of several files in one folder: two audiobooks
    for (const [alb, n] of [['Erstes Album', 2], ['Zweites Album', 3]]) for (let i = 1; i <= n; i++) put(`fb/Gemischt/${alb} ${i}.mp3`, W.mp3File({ seconds: 4, tag: W.id3Tag([W.id3.text('TALB', alb)], 3) }));
    // disc folders with different albums are different audiobooks
    put('fb/Zwei Bücher/CD1/01.mp3', W.mp3File({ seconds: 4, tag: W.id3Tag([W.id3.text('TALB', 'Buch A')], 3) }));
    put('fb/Zwei Bücher/CD2/01.mp3', W.mp3File({ seconds: 4, tag: W.id3Tag([W.id3.text('TALB', 'Buch B')], 3) }));
    // a single file without tags in its own folder takes the folder's name
    put('fb/Lena Probe - Die Insel/insel.mp3', W.mp3File({ seconds: 4 }));
    const r = await S.scanFolders([{ path: root }]);
    const b = (t) => r.books.find((x) => x.title === t);
    assert(b('Ohne Tags') && b('Ohne Tags').author === 'Jonas Beispiel', JSON.stringify(titles(r.books)));
    assert.strictEqual(b('Das Buch ohne Namen')?.author, 'Erika Muster');
    const two = b('Zwei Teile'); assert(two && two.tracks.length === 2 && two.chapters.length === 4, 'two parts');
    assert.deepStrictEqual(two.chapters.map((c) => [c.track, c.offset, c.title]), [[0, 0, 'A1'], [0, 10, 'B1'], [1, 0, 'A2'], [1, 10, 'B2']]);
    assert.strictEqual(b('Erstes Album')?.tracks.length, 2); assert.strictEqual(b('Zweites Album')?.tracks.length, 3);
    assert(b('Buch A') && b('Buch B'), 'disc folders with two albums');
    assert.strictEqual(b('Die Insel')?.author, 'Lena Probe');
  });

  console.log('cache and store');
  await test('the tag cache: a second scan reads no file, a changed file is read again, a removed one is forgotten', async () => {
    const root = path.join(tmp, 'cache');
    for (let i = 1; i <= 4; i++) put(`cache/Buch/${i}.mp3`, W.mp3File({ seconds: 3 + i, tag: W.id3Tag([W.id3.text('TALB', 'Buch')], 3) }));
    const file = path.join(tmp, 'tags.json');
    let cache = new TagCache(file);
    const a = await S.scanFolders([{ path: root }], { cache });
    assert.strictEqual(a.read, 4);
    cache.prune(a.seen); cache.flush();
    cache = new TagCache(file);                                  // from disk, as after a restart
    const b = await S.scanFolders([{ path: root }], { cache });
    assert.strictEqual(b.read, 0, 'nothing read again');
    assert.strictEqual(b.books[0].tracks.length, 4);
    const f2 = path.join(root, 'Buch', '2.mp3');
    fs.writeFileSync(f2, W.mp3File({ seconds: 20, tag: W.id3Tag([W.id3.text('TALB', 'Buch')], 3) }));
    const c = await S.scanFolders([{ path: root }], { cache });
    assert.strictEqual(c.read, 1, 'only the changed file'); assert(near(c.books[0].tracks[1].duration, 20, 0.1));
    fs.rmSync(path.join(root, 'Buch', '4.mp3'));
    const d = await S.scanFolders([{ path: root }], { cache });
    cache.prune(d.seen);
    assert.strictEqual(cache.size, 3); assert.strictEqual(d.books[0].tracks.length, 3);
    // an unreadable folder keeps its entries
    cache.prune(new Set(), [root]); assert.strictEqual(cache.size, 3);
  });
  await test('the library: progress survives a restart, a moved audiobook keeps it, measured durations move the tracks', async () => {
    const ud = path.join(tmp, 'ud');
    const root = path.join(tmp, 'mv');
    for (let i = 1; i <= 2; i++) put(`mv/Alt/${i}.mp3`, W.mp3File({ seconds: 10, xing: false, tag: W.id3Tag([W.id3.text('TALB', 'Wanderbuch'), W.id3.text('TPE1', 'Erika Muster')], 3) }));
    const events = [];
    const mk = () => new AudiobookLibrary({ userData: ud, getFolders: () => [{ path: root }], emit: (c, p) => events.push([c, p]), urlFor: (p) => 'u:' + p });
    let l = mk();
    await l.scan();
    const id = l.books[0].id;
    l.setProgress(id, { track: 1, offset: 4.5, position: 14.5, rate: 1.25 });
    assert(events.some(([c, p]) => c === 'audiobooks:progress' && p.id === id && p.progress.position === 14.5));
    l.dispose();
    l = mk(); await l.scan();
    let st = l.state().books[0];
    assert.deepStrictEqual([st.progress.track, st.progress.offset, st.progress.rate], [1, 4.5, 1.25]);
    assert(st.added > 0);
    const full = l.book(id);
    assert.strictEqual(full.tracks.length, 2); assert(full.tracks[0].url.startsWith('u:'));
    assert.strictEqual(l.setTrackDuration(id, 0, 12), true);
    assert(near(l.book(id).tracks[1].start, 12, 0.01) && near(l.book(id).duration, 22, 0.2));
    // moved: same title, author, length under a new folder name
    fs.renameSync(path.join(root, 'Alt'), path.join(root, 'Neu'));
    await l.scan();
    st = l.state().books[0];
    assert.notStrictEqual(st.id, id);
    assert(st.progress && st.progress.position === 14.5, 'progress carried over');
    l.dispose();
  });
  await test('covers: made once per picture, again when it changes; an audiobook without a picture has none', async () => {
    const ud = path.join(tmp, 'ud2');
    const root = path.join(tmp, 'cv');
    put('cv/Mit Bild/01.mp3', W.mp3File({ seconds: 3 })); put('cv/Mit Bild/cover.png', W.png(W.drawCover({ size: 40 })));
    put('cv/Ohne Bild/01.mp3', W.mp3File({ seconds: 3 }));
    let made = 0;
    const makeThumbs = (buf, base) => { made++; fs.writeFileSync(base + '-thumb.jpg', buf); return { thumb: base + '-thumb.jpg', large: base + '-thumb.jpg', color: '#123456' }; };
    const l = new AudiobookLibrary({ userData: ud, getFolders: () => [{ path: root }], makeThumbs });
    await l.scan(); await new Promise((r) => setTimeout(r, 50));
    const st = () => Object.fromEntries(l.state().books.map((b) => [b.title, b.cover]));
    assert.strictEqual(made, 1); assert(st()['Mit Bild'].thumb && st()['Mit Bild'].color === '#123456'); assert.strictEqual(st()['Ohne Bild'], null);
    await l.scan(); await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(made, 1, 'not made again');
    fs.writeFileSync(path.join(root, 'Mit Bild', 'cover.png'), W.png(W.drawCover({ size: 48 })));
    await l.scan(); await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(made, 2, 'a changed picture is made again');
    l.dispose();
  });

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
