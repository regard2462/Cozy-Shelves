// How fast the audiobook scanner reads a large collection, and how much: writes `books` audiobooks of `tracks` MP3
// files each (an ID3v2.3 tag with a picture of `pictureKB` in every file, as many rips have it), then scans the folder
// twice (the second time from the tag cache) and prints the time, the bytes read and the memory.
//   node build/testlib/audiobook-scan-bench.js <folder> [books=40] [tracks=250] [pictureKB=64]
const fs = require('fs');
const path = require('path');
const W = require('./audiobook-writer');
const { scanFolders } = require('../../electron/audiobooks/scan');
const { readTags } = require('../../electron/audiobooks/tags');
const { TagCache } = require('../../electron/audiobooks/cache');

(async () => {
  const [dir, books = 40, tracks = 250, picKB = 64] = [process.argv[2], ...process.argv.slice(3).map(Number)];
  if (!dir) { console.error('usage: node build/testlib/audiobook-scan-bench.js <folder> [books] [tracks] [pictureKB]'); process.exit(1); }
  const lib = path.join(dir, 'lib');
  if (!fs.existsSync(lib)) {
    const t0 = Date.now();
    const pic = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(picKB * 1024 - 4, 7)]);
    const frames = Buffer.concat(W.mp3Frames(20));
    for (let b = 1; b <= books; b++) {
      const album = `Großes Hörbuch ${b}`;
      for (let t = 1; t <= tracks; t++) {
        const tag = W.id3Tag([W.id3.text('TIT2', `Kapitel ${t}`), W.id3.text('TALB', album), W.id3.text('TPE1', 'Erika Muster'), W.id3.text('TRCK', `${t}/${tracks}`), W.id3.apic('image/jpeg', pic)], 3, 1024);
        const f = path.join(lib, `Erika Muster - ${album}`, `CD${Math.ceil(t / 25)}`, `${String(t).padStart(3, '0')} Kapitel ${t}.mp3`);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, Buffer.concat([tag, frames]));
      }
    }
    console.log(`written: ${books} audiobooks × ${tracks} files in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  // bytes read: count them through the tag reader
  let bytes = 0, files = 0;
  const cacheFile = path.join(dir, 'tags.json');
  try { fs.rmSync(cacheFile); } catch {}
  const rss0 = process.memoryUsage().rss;
  let peak = rss0;
  const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 50);
  const cache = new TagCache(cacheFile);
  let t = Date.now();
  const r1 = await scanFolders([{ path: lib }], { cache, onProgress: () => {} });
  const first = Date.now() - t;
  cache.prune(r1.seen); cache.flush();
  for (const b of r1.books) for (const tr of b.tracks) { files++; void tr; }
  // a sample of files read again just to count their bytes
  const sample = r1.books.slice(0, 2).flatMap((b) => b.tracks.slice(0, 50));
  for (const tr of sample) bytes += (await readTags(tr.path)).bytes || 0;
  t = Date.now();
  const r2 = await scanFolders([{ path: lib }], { cache: new TagCache(cacheFile), onProgress: () => {} });
  const second = Date.now() - t;
  clearInterval(sampler);
  const size = r1.books.reduce((a, b) => a + b.size, 0);
  console.log(JSON.stringify({
    audiobooks: r1.books.length, files, gigabytes: +(size / 1e9).toFixed(2),
    firstScanSeconds: +(first / 1000).toFixed(2), perFileMs: +(first / files).toFixed(2), bytesReadPerFile: Math.round(bytes / sample.length),
    secondScanSeconds: +(second / 1000).toFixed(2), filesReadAgain: r2.read, cacheMB: +(fs.statSync(cacheFile).size / 1e6).toFixed(2),
    peakRssMB: Math.round(peak / 1e6), rssGrowthMB: Math.round((peak - rss0) / 1e6), tracksOfFirst: r1.books[0]?.tracks.length,
  }));
})();
