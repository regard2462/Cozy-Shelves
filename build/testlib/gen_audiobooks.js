// A folder of invented test audiobooks (no real ones): every layout the scanner knows, all formats it reads.
//   node build/testlib/gen_audiobooks.js <folder> [--extra N]
// <folder>/
//   Erika Muster - Erzählungen am Kamin/   11 WAV tracks "1 …" … "11 …" (10 after 9), cover.jpg, RIFF INFO tags
//   Der Leuchtturmwärter/CD1/…, CD2/…       MP3 with ID3v2.3, discs, the narrator as composer, a JPEG in the first track
//   Einzelne Hörbücher/Die lange Nacht.m4b  M4B: QuickTime and Nero chapters, iTunes tags, series, PNG cover
//   Einzelne Hörbücher/Kurzgeschichten vom See.mp3   ID3v2.4 with CHAP/CTOC chapters and a PNG cover
//   Einzelne Hörbücher/Sterne über dem See.flac       FLAC with CHAPTER comments and a JPEG picture
//   Die Reihe vom Wald/01 Das erste Licht/, 02 Der Sturm/, 03 Die Rückkehr/   a series, cover.png in each volume
//   Sammlung/Hörbuch 001 …/ (with --extra N)  N small audiobooks with covers, for a cabinet that is too small
const fs = require('fs');
const path = require('path');
const W = require('./audiobook-writer');

const PALETTES = [
  [[44, 72, 112], [12, 22, 44], [240, 200, 90]], [[150, 64, 52], [60, 22, 20], [250, 220, 160]], [[42, 110, 96], [12, 40, 36], [230, 240, 200]],
  [[96, 70, 140], [30, 20, 52], [250, 200, 230]], [[200, 140, 60], [90, 50, 20], [255, 245, 220]], [[60, 60, 64], [20, 20, 22], [230, 120, 90]],
  [[110, 140, 70], [36, 52, 22], [250, 240, 180]], [[30, 110, 150], [10, 40, 60], [255, 210, 120]],
];
const MOTIFS = ['sun', 'moon', 'tower', 'waves', 'trees', 'stars'];
function cover(i, title, author, kind = 'jpeg') {
  const [top, bottom, accent] = PALETTES[i % PALETTES.length];
  const r = W.drawCover({ size: 360, top, bottom, accent, motif: MOTIFS[i % MOTIFS.length], title, author });
  return kind === 'png' ? W.png(r) : W.jpeg(r, 88);
}
const write = (file, buf) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf); };

/** Writes the test audiobooks into `dir`; returns what was written (for the checks). */
function generate(dir, { extra = 0 } = {}) {
  const out = [];
  // 1. a folder of WAV tracks with a cover image next to them
  {
    const book = path.join(dir, 'Erika Muster - Erzählungen am Kamin');
    const names = ['Der Anfang', 'Am Feuer', 'Die Katze', 'Ein Brief', 'Der Garten', 'Regen', 'Die Brücke', 'Am See', 'Der Abend', 'Die Nacht', 'Das Ende'];
    names.forEach((n, i) => write(path.join(book, `${i + 1} ${n}.wav`), W.wavFile({ seconds: 14 + ((i * 7) % 17), seed: i + 1, info: { INAM: n, IART: 'Erika Muster', IPRD: 'Erzählungen am Kamin', ITRK: String(i + 1) } })));
    write(path.join(book, 'cover.jpg'), cover(0, 'Erzählungen am Kamin', 'Erika Muster'));
    write(path.join(book, 'back.jpg'), cover(5, 'Rückseite', ''));
    out.push({ title: 'Erzählungen am Kamin', tracks: names.length });
  }
  // 2. two discs of MP3 tracks, ID3v2.3, the cover embedded in the first track
  {
    const book = path.join(dir, 'Der Leuchtturmwärter');
    const discs = [['Ankunft', 'Der Turm', 'Das Licht'], ['Der Sturm', 'Heimkehr']];
    const pic = cover(2, 'Der Leuchtturmwärter', 'Jonas Beispiel');
    discs.forEach((tracks, d) => tracks.forEach((n, i) => {
      const frames = [W.id3.text('TIT2', n), W.id3.text('TALB', 'Der Leuchtturmwärter'), W.id3.text('TPE1', 'Jonas Beispiel'), W.id3.text('TCOM', 'Max Sprecher'),
        W.id3.text('TRCK', `${i + 1}/${tracks.length}`), W.id3.text('TPOS', `${d + 1}/2`), W.id3.text('TYER', '2019')];
      if (d === 0 && i === 0) frames.push(W.id3.apic('image/jpeg', pic), W.id3.comm('Ein Leuchtturmwärter erzählt von einem Winter auf einer kleinen Insel, von Stürmen, Schiffen und einem Brief, der zu spät kommt.'));
      write(path.join(book, `CD${d + 1}`, `${String(i + 1).padStart(2, '0')} ${n}.mp3`), W.mp3File({ seconds: 40 + ((d * 3 + i) * 11) % 31, tag: W.id3Tag(frames, 3) }));
    }));
    out.push({ title: 'Der Leuchtturmwärter', tracks: 5 });
  }
  // 3. single files with chapters of their own in a shared folder
  {
    const shared = path.join(dir, 'Einzelne Hörbücher');
    const chapters = [{ start: 0, title: 'Prolog' }, { start: 120, title: 'Erstes Kapitel' }, { start: 300, title: 'Zweites Kapitel' }, { start: 480, title: 'Drittes Kapitel' }, { start: 640, title: 'Epilog' }];
    write(path.join(shared, 'Die lange Nacht.m4b'), W.mp4File({ seconds: 720, chapters, cover: { data: cover(1, 'Die lange Nacht', 'Lena Probe', 'png'), mime: 'image/png' },
      tags: { '©nam': 'Die lange Nacht', '©alb': 'Die lange Nacht', '©ART': 'Lena Probe', '©nrt': 'Max Sprecher', '©day': '2021', '©gen': 'Hörbuch', '----:com.apple.iTunes:SERIES': 'Nachtgeschichten', '----:com.apple.iTunes:SERIES-PART': '1' } }));
    out.push({ title: 'Die lange Nacht', tracks: 1, chapters: 5 });
    const chap = [['Der Steg', 0], ['Die Seerose', 95], ['Der Reiher', 190], ['Das Boot', 300], ['Der Nebel', 400]];
    const tag4 = W.id3Tag([W.id3.text('TIT2', 'Kurzgeschichten vom See', 4), W.id3.text('TALB', 'Kurzgeschichten vom See', 4), W.id3.text('TPE1', 'Erika Muster', 4), W.id3.txxx('NARRATOR', 'Lisa Lesend', 4),
      W.id3.ctoc('toc', chap.map((_, i) => 'ch' + i), 4), ...chap.map(([t, s], i) => W.id3.chap('ch' + i, s * 1000, (chap[i + 1]?.[1] ?? 480) * 1000, t, 4)), W.id3.apic('image/png', cover(3, 'Kurzgeschichten vom See', 'Erika Muster', 'png'), 4)], 4);
    write(path.join(shared, 'Kurzgeschichten vom See.mp3'), W.mp3File({ seconds: 480, tag: tag4 }));
    out.push({ title: 'Kurzgeschichten vom See', tracks: 1, chapters: 5 });
    write(path.join(shared, 'Sterne über dem See.flac'), W.flacFile({ seconds: 150, seed: 7, picture: { data: cover(4, 'Sterne über dem See', 'Lena Probe'), mime: 'image/jpeg' },
      comments: ['TITLE=Sterne über dem See', 'ALBUM=Sterne über dem See', 'ARTIST=Lena Probe', 'DATE=2023', 'CHAPTER001=00:00:00.000', 'CHAPTER001NAME=Dämmerung', 'CHAPTER002=00:00:50.000', 'CHAPTER002NAME=Die ersten Sterne', 'CHAPTER003=00:01:40.000', 'CHAPTER003NAME=Mitternacht'] }));
    out.push({ title: 'Sterne über dem See', tracks: 1, chapters: 3 });
  }
  // 4. a series: numbered volumes in one folder
  {
    const series = path.join(dir, 'Die Reihe vom Wald');
    const vols = [['Das erste Licht', 2], ['Der Sturm', 2], ['Die Rückkehr', 3]];
    vols.forEach(([title, n], v) => {
      const vdir = path.join(series, `${String(v + 1).padStart(2, '0')} ${title}`);
      for (let i = 0; i < n; i++) write(path.join(vdir, `${String(i + 1).padStart(2, '0')}.mp3`), W.mp3File({ seconds: 30 + i * 9, tag: W.id3Tag([W.id3.text('TALB', title), W.id3.text('TPE1', 'Paul Platzhalter'), W.id3.text('TRCK', String(i + 1))], 3) }));
      write(path.join(vdir, 'cover.png'), cover(5 + v, title, 'Paul Platzhalter', 'png'));
      out.push({ title, tracks: n, series: 'Die Reihe vom Wald', seriesIndex: v + 1 });
    });
  }
  // 5. many small audiobooks (a cabinet in the hall shows only the newest ones)
  for (let k = 1; k <= extra; k++) {
    const title = `Hörbuch ${String(k).padStart(3, '0')}`;
    const pic = cover(k, title, 'Sammlung');
    write(path.join(dir, 'Sammlung', title, '01.mp3'), W.mp3File({ seconds: 12, tag: W.id3Tag([W.id3.text('TALB', title), W.id3.text('TPE1', 'Testsammlung'), W.id3.apic('image/jpeg', pic)], 3) }));
    out.push({ title, tracks: 1 });
  }
  return out;
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node build/testlib/gen_audiobooks.js <folder> [--extra N]'); process.exit(1); }
  const i = process.argv.indexOf('--extra');
  const list = generate(path.resolve(dir), { extra: i > 0 ? parseInt(process.argv[i + 1], 10) || 0 : 0 });
  console.log(`${list.length} audiobooks written to ${path.resolve(dir)}`);
}

module.exports = { generate };
