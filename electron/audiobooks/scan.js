// The audiobook folders: walk them, read the tags of every audio file (cached by path, size and mtime, so a rescan
// reads only new or changed files), and group the files into audiobooks:
//   • a folder with audio files is one audiobook; sub folders named like discs ("CD1", "Disc 2", "Teil 3", "Seite A")
//     belong to it, and its tracks are in natural order ("CD1/01" before "CD2/01", "10" after "9");
//   • a single .m4b, or an audio file with chapters of its own, is an audiobook by itself (unless all files of the
//     folder are parts of one album);
//   • files of different albums in one folder are different audiobooks when each album has several files, or when
//     each file is long (a folder of single-file audiobooks); otherwise the folder stays one audiobook;
//   • numbered sub folders ("Reihe/01 Band eins/…") are the volumes of a series named after their parent.
// Title, author, narrator, series, cover and chapters come from the tags, else from the folder and file names.
// Nothing here needs Electron: covers are made by the `makeCovers` function the caller hands in.
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { readTags, AUDIO_EXT, clean } = require('./tags');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);
const SKIP_DIRS = new Set(['node_modules', '$recycle.bin', 'system volume information', '__macosx']);
const MAX_DEPTH = 12;
const LONG_FILE = 20 * 60;          // a file of this length without album siblings is an audiobook of its own

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
/** Natural order of names: "Teil 2" before "Teil 10", "9" before "10", case and accents ignored. */
const naturalCompare = (a, b) => collator.compare(String(a), String(b));
/** Natural order of relative paths, folder by folder ("CD1/10" after "CD1/9", before "CD2/01"). */
function comparePaths(a, b) {
  const x = String(a).split(/[\\/]/), y = String(b).split(/[\\/]/);
  for (let i = 0; i < Math.min(x.length, y.length); i++) { const c = naturalCompare(x[i], y[i]); if (c) return c; }
  return x.length - y.length;
}

const DISC_NAME = /^(?:cd|disc|disk|teil|part|seite|side|tape|kassette|mc)\s*[-_.#]?\s*(\d{1,3}|[a-d])\b/i;
const DISC_SUFFIX = /[\s,._-]*[[(]?\s*(?:cd|disc|disk|teil|part|seite|side)\s*\d{1,3}(?:\s*(?:\/|von|of)\s*\d{1,3})?\s*[\])]?\s*$/i;
/** The number of a disc folder ("CD 2" → 2, "Seite B" → 2), null for any other name. */
function discNumber(name) {
  const m = DISC_NAME.exec(String(name).trim());
  if (m) { const v = m[1]; return /\d/.test(v) ? parseInt(v, 10) : v.toLowerCase().charCodeAt(0) - 96; }
  return /^\d{1,2}$/.test(String(name).trim()) ? parseInt(name, 10) : null;
}
/** An album without its disc part: "Der Sturm (CD 2)" → "der sturm". */
const albumKey = (s) => clean(String(s || '').replace(DISC_SUFFIX, ''))?.toLowerCase() || null;

/** "01 - Das Licht" → { index: 1, rest: 'Das Licht' }; "Band 2: Der Sturm" → { index: 2, … }; no number → null. */
function leadingNumber(name) {
  const m = /^\s*(?:(?:band|teil|folge|buch|book|vol(?:ume)?|part|episode|ep|nr|no|#)\.?\s*)?(\d{1,3})(?:[.)]|\s*[-–:_]\s*|\s+)(.*)$/i.exec(String(name));
  return m ? { index: parseInt(m[1], 10), rest: m[2].trim() } : null;
}
/** A folder or file name as a title: no extension, no underscores, no leading track number. */
function cleanName(name, { stripNumber = true } = {}) {
  let s = String(name || '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (stripNumber) { const n = leadingNumber(s); if (n && n.rest) s = n.rest; }
  return s.replace(/^[-–:.\s]+|[-–:\s]+$/g, '').trim() || String(name || '');
}
// "Ein Roman", "Teil 2" and the like are no names (library.js has the same idea for book files)
const NOT_A_NAME = /^(ein|eine|der|die|das|the|a|an|teil|band|folge|cd|disc|roman|hörbuch|hoerbuch|audiobook|gelesen|ungekürzt|gekürzt|lesung|hörspiel|kapitel|chapter)\b/i;
/** Does the text look like a person's name ("Erika Muster", "E. T. A. Hoffmann")? */
function looksLikeName(s) {
  const t = String(s || '').trim();
  if (!t || t.length > 48 || /\d/.test(t) || NOT_A_NAME.test(t)) return false;
  const words = t.split(/\s+/);
  return words.length >= 2 && words.length <= 5 && words.every((w) => /^[A-ZÄÖÜÉÈ][\p{L}'’.-]*$/u.test(w) || /^(von|van|de|der|du|da|le|la|zu|y)$/.test(w));
}
/** "Erika Muster - Der Sturm" → { author, title }; the side that looks like a name is the author (left first). */
function splitAuthorTitle(name) {
  const parts = String(name).split(/\s+[-–]\s+/);
  if (parts.length < 2) return null;
  const left = parts[0], right = parts.slice(1).join(' - ');
  if (looksLikeName(left) && !looksLikeName(right)) return { author: left, title: right };
  if (looksLikeName(right) && !looksLikeName(left)) return { author: right, title: left };
  if (looksLikeName(left)) return { author: left, title: right };
  return null;
}
/** The most frequent non-empty value (ties: the first seen). */
function majority(values) {
  const count = new Map(); let best = null, n = 0;
  for (const v of values) { if (v == null || v === '') continue; const c = (count.get(v) || 0) + 1; count.set(v, c); if (c > n) { n = c; best = v; } }
  return best;
}
const idFor = (p) => crypto.createHash('sha1').update(path.normalize(p).toLowerCase()).digest('hex').slice(0, 16);

// --------------------------------------------------------------------------------------------- walking the tree --
/**
 * Every folder below `root` with its audio files, images and sub folders: Map dir → { audio: [{ path, name, size,
 * mtime }], images: [...], subdirs: [abs] }. Hidden and system folders are skipped. `false` when root is unreadable.
 */
async function walkTree(root, { maxDepth = MAX_DEPTH } = {}) {
  const tree = new Map();
  const visit = async (dir, depth) => {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return depth > 0; }
    const node = { audio: [], images: [], subdirs: [] };
    tree.set(dir, node);
    const stats = [];
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth >= maxDepth || e.name.startsWith('$') || SKIP_DIRS.has(e.name.toLowerCase())) continue;
        node.subdirs.push(p);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (AUDIO_EXT.has(ext)) stats.push([node.audio, p, e.name]);
        else if (IMAGE_EXT.has(ext)) stats.push([node.images, p, e.name]);
      }
    }
    // the sizes and times of the files of this folder, a few at a time
    for (let i = 0; i < stats.length; i += 32) {
      await Promise.all(stats.slice(i, i + 32).map(async ([list, p, name]) => {
        try { const st = await fsp.stat(p); if (st.size > 0) list.push({ path: p, name, size: st.size, mtime: Math.round(st.mtimeMs) }); } catch {}
      }));
    }
    node.audio.sort((a, b) => naturalCompare(a.name, b.name));
    node.subdirs.sort(comparePaths);
    for (const sub of node.subdirs) await visit(sub, depth + 1);
    return true;
  };
  const ok = await visit(root, 0);
  return ok ? tree : false;
}

// ---------------------------------------------------------------------------------------------- reading tags --
/**
 * The tags of every file (from the cache when path, size and mtime match), `concurrency` files at a time.
 * onProgress(done, total) after every file that had to be read.
 */
async function readAll(files, cache, { concurrency = 6, onProgress, shouldStop } = {}) {
  const metas = new Map();
  const todo = [];
  for (const f of files) {
    const hit = cache?.get(f.path, f.size, f.mtime);
    if (hit) metas.set(f.path, hit); else todo.push(f);
  }
  let done = 0, next = 0;
  const worker = async () => {
    while (next < todo.length) {
      if (shouldStop?.()) return;
      const f = todo[next++];
      const meta = await readTags(f.path, { size: f.size });
      metas.set(f.path, meta);
      cache?.set(f.path, f.size, f.mtime, meta);
      done++;
      onProgress?.(done, todo.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  return { metas, read: done };
}

// ---------------------------------------------------------------------------------------------- grouping --
const hasChapters = (m) => (m?.chapters?.length || 0) >= 2;
/**
 * The audiobooks of one root folder. tree: walkTree(), metas: path → readTags().
 * @returns [{ id, kind: 'folder'|'file', path, dir, root, files: [{ …file, disc }], series?, seriesIndex? }]
 */
function groupTree(root, tree, metas) {
  const books = [];
  const meta = (f) => metas.get(f.path) || {};
  const audioBelow = new Map();      // dir → does any folder below hold audio
  const below = (dir) => {
    if (audioBelow.has(dir)) return audioBelow.get(dir);
    const n = tree.get(dir); let v = false;
    if (n) v = n.audio.length > 0 || n.subdirs.some((s) => below(s));
    audioBelow.set(dir, v); return v;
  };
  const visit = (dir) => {
    const node = tree.get(dir); if (!node) return;
    // disc folders: audio files and nothing deeper; they belong to this folder's audiobook
    const discs = [];
    for (const sub of node.subdirs) {
      const n = tree.get(sub), num = discNumber(path.basename(sub));
      if (num != null && n && n.audio.length && !n.subdirs.some((s) => below(s))) discs.push({ dir: sub, num });
    }
    // pure numbers ("1", "2") are discs only when this folder has nothing else and they share an album
    const realDiscs = discs.filter((d) => !/^\d{1,2}$/.test(path.basename(d.dir).trim()));
    const numbered = discs.filter((d) => /^\d{1,2}$/.test(path.basename(d.dir).trim()));
    if (numbered.length) {
      const albums = new Set(numbered.flatMap((d) => tree.get(d.dir).audio.map((f) => albumKey(meta(f).album)).filter(Boolean)));
      if (albums.size <= 1 && numbered.length >= 2) realDiscs.push(...numbered);
    }
    // discs of one audiobook share their album (when the tags name one): different albums are different audiobooks
    const discAlbums = new Set([...node.audio, ...realDiscs.flatMap((d) => tree.get(d.dir).audio)].map((f) => albumKey(meta(f).album)).filter(Boolean));
    if (discAlbums.size > 1) realDiscs.length = 0;
    const discDirs = new Set(realDiscs.map((d) => d.dir));
    for (const sub of node.subdirs) if (!discDirs.has(sub)) visit(sub);
    const pool = node.audio.map((f) => ({ ...f, disc: meta(f).disc || 0 }));
    for (const d of realDiscs.sort((a, b) => a.num - b.num || comparePaths(a.dir, b.dir))) for (const f of tree.get(d.dir).audio) pool.push({ ...f, disc: d.num, discDir: path.basename(d.dir) });
    if (!pool.length) return;
    books.push(...splitFolder(dir, root, pool, meta));
  };
  visit(root);
  markSeries(books, tree);
  return books;
}

/** The audiobooks among the files of one folder (with its discs), see the rules at the top. */
function splitFolder(dir, root, pool, meta) {
  const out = [];
  const single = (f) => ({ id: idFor(f.path), kind: 'file', path: f.path, dir, root, files: [f] });
  const standalone = pool.filter((f) => path.extname(f.name).toLowerCase() === '.m4b' || hasChapters(meta(f)));
  const sameAlbum = (list) => { const keys = new Set(list.map((f) => albumKey(meta(f).album))); return keys.size === 1 && !keys.has(null); };
  let rest = pool;
  if (standalone.length && !(standalone.length === pool.length && pool.length > 1 && sameAlbum(pool))) {
    // m4b files and files with chapters are audiobooks of their own
    for (const f of standalone) out.push(single(f));
    rest = pool.filter((f) => !standalone.includes(f));
  }
  if (!rest.length) return out;
  const groups = new Map();
  for (const f of rest) { const k = albumKey(meta(f).album) || '\u0000'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f); }
  const list = [...groups.values()];
  if (list.length > 1 && list.every((g) => g.length === 1) && rest.every((f) => (meta(f).duration || 0) >= LONG_FILE)) {
    for (const f of rest) out.push(single(f));                 // a folder of single-file audiobooks
  } else if (list.length > 1 && list.every((g) => g.length >= 2) && !groups.has('\u0000')) {
    for (const g of list) out.push({ id: idFor(dir + '\u0000' + albumKey(meta(g[0]).album)), kind: 'folder', path: dir, dir, root, files: g, albumSplit: true });
  } else {
    out.push({ id: idFor(dir), kind: 'folder', path: dir, dir, root, files: rest });
  }
  // a single-file book that is the only thing in its folder belongs to the folder (its cover, its name)
  if (out.length === 1 && out[0].kind === 'file' && pool.length === 1) { out[0].ownFolder = true; }
  return out;
}

/** Numbered sub folders of one parent ("01 Das Licht", "02 Der Sturm") are the volumes of a series. */
function markSeries(books, tree) {
  const byParent = new Map();
  for (const b of books) {
    if (b.kind !== 'folder' || b.dir === b.root || b.albumSplit) continue;
    const parent = path.dirname(b.dir);
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(b);
  }
  for (const [parent, list] of byParent) {
    if (list.length < 2) continue;
    const nums = list.map((b) => leadingNumber(path.basename(b.dir)));
    if (nums.filter(Boolean).length < Math.max(2, Math.ceil(list.length * 0.6))) continue;
    const name = cleanName(path.basename(parent), { stripNumber: false });
    list.forEach((b, i) => { b.folderSeries = name; if (nums[i]) b.folderSeriesIndex = nums[i].index; });
  }
  // files of one folder named "01 …", "02 …" (single-file audiobooks) are a series of that folder
  const fileGroups = new Map();
  for (const b of books) if (b.kind === 'file' && !b.ownFolder && b.dir !== b.root) { if (!fileGroups.has(b.dir)) fileGroups.set(b.dir, []); fileGroups.get(b.dir).push(b); }
  for (const [dir, list] of fileGroups) {
    if (list.length < 2) continue;
    const nums = list.map((b) => leadingNumber(path.basename(b.path)));
    if (nums.filter(Boolean).length < list.length) continue;
    const name = cleanName(path.basename(dir), { stripNumber: false });
    list.forEach((b, i) => { b.folderSeries = name; b.folderSeriesIndex = nums[i].index; });
  }
  void tree;
}

// ---------------------------------------------------------------------------------------------- the records --
/** Tracks in their order: by disc, then by name in natural order (by the track numbers of the tags when the names
 *  carry no numbers at all). */
function orderTracks(files, meta) {
  const byDisc = new Map();
  for (const f of files) { if (!byDisc.has(f.disc || 0)) byDisc.set(f.disc || 0, []); byDisc.get(f.disc || 0).push(f); }
  const out = [];
  for (const disc of [...byDisc.keys()].sort((a, b) => a - b)) {
    const list = byDisc.get(disc);
    const nums = list.map((f) => meta(f).track);
    const byTag = list.length > 1 && list.every((f) => !/\d/.test(cleanName(f.name, { stripNumber: false }))) && nums.every((n) => n != null) && new Set(nums).size === nums.length;
    list.sort(byTag ? (a, b) => meta(a).track - meta(b).track : (a, b) => comparePaths(a.discDir ? a.discDir + '/' + a.name : a.name, b.discDir ? b.discDir + '/' + b.name : b.name));
    out.push(...list);
  }
  return out;
}
/** The title of a track as a chapter name: its title tag unless that is the book's own, else the cleaned file name;
 *  null when nothing but a number is left (the player then says "Kapitel 3"). */
function trackTitle(f, m, bookTitle, album) {
  const t = clean(m.title);
  const generic = (s) => !s || /^(track|titel|title|kapitel|chapter|cd|teil|part)?\s*\d+$/i.test(s) || s.toLowerCase() === String(bookTitle || '').toLowerCase() || s.toLowerCase() === String(album || '').toLowerCase();
  if (t && !generic(t)) return t;
  let n = cleanName(f.name);
  for (const prefix of [bookTitle, album]) if (prefix && n.toLowerCase().startsWith(String(prefix).toLowerCase())) n = n.slice(String(prefix).length).replace(/^[\s\-–:._]+/, '').trim();
  const lead = leadingNumber(n); if (lead) n = lead.rest;
  return generic(n) ? null : n;
}

/**
 * The record of an audiobook from its group: tracks, chapters, title, author, narrator, series, year, the cover
 * source (an embedded picture of a track, or an image file next to it).
 * @param images  the image files of the book's folder and its disc folders
 */
function buildRecord(group, meta, images) {
  const tracks = orderTracks(group.files, meta);
  const metas = tracks.map(meta);
  const first = metas[0] || {};
  const folderName = path.basename(group.dir);
  const fileBase = group.kind === 'file' ? path.basename(group.path) : null;
  const album = majority(metas.map((m) => clean(m.album)));
  // names from the folder ("Erika Muster - Der Sturm"), for a single file from its own name
  const ownName = group.kind === 'file' && !group.ownFolder ? cleanName(fileBase) : cleanName(folderName);
  const split = splitAuthorTitle(ownName);
  let title = group.kind === 'file' ? (clean(first.album) && hasChapters(first) ? clean(first.album) : null) || clean(first.title) || clean(first.album) : album;
  if (group.albumSplit && !title) title = clean(first.album);
  if (!title) title = split ? split.title : ownName;
  // the folder above the audiobook (for a single file: its own folder) may be named after the author
  const authorDir = group.kind === 'file' && !group.ownFolder ? group.dir : path.dirname(group.dir);
  const dirAuthor = authorDir.length >= group.root.length ? cleanName(path.basename(authorDir), { stripNumber: false }) : null;
  const author = majority(metas.map((m) => clean(m.albumArtist))) || majority(metas.map((m) => clean(m.artist))) || (split ? split.author : null)
    || (dirAuthor && looksLikeName(dirAuthor) ? dirAuthor : null);
  let narrator = majority(metas.map((m) => clean(m.narrator)));
  if (!narrator) { const c = majority(metas.map((m) => clean(m.composer))); if (c && c !== author) narrator = c; }
  const series = majority(metas.map((m) => clean(m.series))) || group.folderSeries || null;
  let seriesIndex = metas.find((m) => m.seriesPart != null)?.seriesPart ?? group.folderSeriesIndex ?? null;
  if (seriesIndex == null && series && group.kind === 'folder') seriesIndex = leadingNumber(folderName)?.index ?? null;
  const year = majority(metas.map((m) => m.year));
  const genre = majority(metas.map((m) => clean(m.genre)));
  const description = metas.map((m) => clean(m.comment)).find((c) => c && c.length >= 40) || null;
  // tracks with their place in the book; chapters from the tags, else one per track
  let start = 0;
  const outTracks = tracks.map((f, i) => {
    const m = metas[i]; const duration = m.duration > 0 ? m.duration : 0;
    const t = { path: f.path, name: f.name, size: f.size, mtime: f.mtime, duration, exact: !!m.durationExact, start, title: trackTitle(f, m, title, album), format: m.format || path.extname(f.name).slice(1) };
    start += duration;
    return t;
  });
  const chapters = [];
  outTracks.forEach((t, i) => {
    const own = metas[i].chapters || [];
    if (own.length >= 2 || (own.length === 1 && outTracks.length === 1)) {
      for (const c of own) if (!(t.duration && c.start >= t.duration)) chapters.push({ track: i, offset: Math.max(0, c.start), title: clean(c.title) || null });
      if (!chapters.length || chapters[chapters.length - 1].track !== i) chapters.push({ track: i, offset: 0, title: t.title });
    } else chapters.push({ track: i, offset: 0, title: own[0]?.title || t.title });
  });
  // the cover: a front cover embedded in a track (the first one that has one), else an image file
  let cover = null;
  const withPic = metas.findIndex((m) => m.picture && (m.picture.type === 3 || m.picture.type == null));
  const anyPic = withPic >= 0 ? withPic : metas.findIndex((m) => m.picture);
  if (anyPic >= 0) cover = { kind: 'embedded', file: tracks[anyPic].path, size: tracks[anyPic].size, mtime: tracks[anyPic].mtime, picture: metas[anyPic].picture };
  else {
    const img = pickImage(images, group, fileBase);
    if (img) cover = { kind: 'image', file: img.path, size: img.size, mtime: img.mtime };
  }
  if (cover) cover.sig = crypto.createHash('sha1').update([cover.file, cover.size, cover.mtime, cover.picture?.offset ?? ''].join('|')).digest('hex').slice(0, 10);
  const formats = [...new Set(outTracks.map((t) => t.format))];
  return {
    id: group.id, kind: group.kind, path: group.path, root: group.root,
    title, author, narrator, series, seriesIndex: Number.isFinite(seriesIndex) ? seriesIndex : null, year, genre, description,
    duration: start, tracks: outTracks, chapters, cover, formats,
    size: outTracks.reduce((a, t) => a + t.size, 0), mtime: Math.max(0, ...outTracks.map((t) => t.mtime)),
  };
}
const PREFER_IMAGE = /(^|[\s_.-])(cover|folder|front|vorne|vorderseite|albumart|album)([\s_.-]|$)/i;
/** The cover image file of a book: next to a single file the one with its name, in a book's own folder the one
 *  called cover/folder/front, else the largest. A folder of several single-file books shares no picture. */
function pickImage(images, group, fileBase) {
  if (!images?.length) return null;
  if (group.kind === 'file' && !group.ownFolder) {
    const base = path.basename(fileBase, path.extname(fileBase)).toLowerCase();
    return images.find((i) => path.basename(i.name, path.extname(i.name)).toLowerCase() === base) || null;
  }
  const preferred = images.filter((i) => PREFER_IMAGE.test(path.basename(i.name, path.extname(i.name))) && !/back|rück|inlay|disc|cd\d/i.test(i.name));
  const pool = preferred.length ? preferred : images.filter((i) => !/back|rück|inlay/i.test(i.name));
  return [...(pool.length ? pool : images)].sort((a, b) => b.size - a.size)[0] || null;
}

/**
 * Scan the audiobook folders: [{ path }] → { books, files, read, unavailable: [paths], seen: Set(files) }.
 * cache: { get(path, size, mtime), set(path, size, mtime, meta) } (cache.js). onProgress({ phase, done, total }).
 */
async function scanFolders(folders, { cache = null, onProgress, shouldStop, concurrency = 6 } = {}) {
  const trees = [];
  const unavailable = [];
  onProgress?.({ phase: 'walk', done: 0, total: 0 });
  for (const f of folders || []) {
    const root = f?.path; if (!root) continue;
    const tree = await walkTree(root);
    if (!tree) { unavailable.push(root); continue; }
    trees.push([root, tree]);
  }
  const files = trees.flatMap(([, t]) => [...t.values()].flatMap((n) => n.audio));
  const { metas, read } = await readAll(files, cache, { concurrency, shouldStop, onProgress: (done, total) => onProgress?.({ phase: 'tags', done, total }) });
  const books = [];
  const seenIds = new Set();
  for (const [root, tree] of trees) {
    for (const group of groupTree(root, tree, metas)) {
      if (seenIds.has(group.id)) continue;
      seenIds.add(group.id);
      // the pictures of the book's folder and its disc folders
      const dirs = new Set([group.dir, ...group.files.map((f) => path.dirname(f.path))]);
      const images = [...dirs].flatMap((d) => tree.get(d)?.images || []);
      books.push(buildRecord(group, (f) => metas.get(f.path) || {}, images));
    }
  }
  return { books, files: files.length, read, unavailable, seen: new Set(files.map((f) => f.path)) };
}

module.exports = { scanFolders, walkTree, groupTree, buildRecord, orderTracks, naturalCompare, comparePaths, discNumber, leadingNumber, cleanName, splitAuthorTitle, looksLikeName, albumKey, idFor, readAll };
