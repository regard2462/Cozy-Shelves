// Covers, the pure part: is page 1 a cover at all, perceptual hashes, the clustering of image search results and
// the choice of the picture. No Electron, no network, no Node APIs: the indexer window (app/src/indexer.js) decodes
// pictures and runs the pixel functions on them, the main process (web-covers.js) runs the rest, and the unit tests
// (test-covers.js) call everything directly.
'use strict';

/** Version of the first-page check: raise it when weakKind changes, then every cover is looked at again. */
const COVER_CHECK = 1;

// ---------------------------------------------------------------- pixels -----------------------------------------
// All pixel functions take RGBA data as canvas getImageData() returns it (row by row, 4 bytes a pixel).

const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * What page 1 of a book looks like, measured on a small rendering (about 200 px tall): the background (the most
 * frequent colour), how much of the page differs from it (`ink`), how much of it is covered by larger areas of
 * picture or colour (`filled`: cells of a 10 × 14 grid whose pixels differ from the background on average), strongly
 * coloured pixels (`strong`) and the spread of the brightness (`lumaStd`). Text alone hardly fills a cell: its strokes
 * cover a tenth or a fifth of the area, a photo, a colour field or a dark ground cover all of it.
 */
function pageStats(rgba, w, h) {
  const n = w * h;
  if (!n || !rgba || rgba.length < n * 4) return null;
  const hist = new Uint32Array(4096);
  for (let i = 0, o = 0; i < n; i++, o += 4) hist[((rgba[o] >> 4) << 8) | ((rgba[o + 1] >> 4) << 4) | (rgba[o + 2] >> 4)]++;
  let best = 0;
  for (let k = 1; k < 4096; k++) if (hist[k] > hist[best]) best = k;
  let br = 0, bgr = 0, bb = 0, bn = 0;
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    if ((((rgba[o] >> 4) << 8) | ((rgba[o + 1] >> 4) << 4) | (rgba[o + 2] >> 4)) !== best) continue;
    br += rgba[o]; bgr += rgba[o + 1]; bb += rgba[o + 2]; bn++;
  }
  br /= bn; bgr /= bn; bb /= bn;
  const CW = 10, CH = 14;
  const cellD = new Float64Array(CW * CH), cellS = new Float64Array(CW * CH), cellN = new Uint32Array(CW * CH);
  let ink = 0, strong = 0, sum = 0, sum2 = 0;
  for (let y = 0, o = 0; y < h; y++) {
    const cy = Math.min(CH - 1, Math.floor((y * CH) / h));
    for (let x = 0; x < w; x++, o += 4) {
      const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
      const d = Math.max(Math.abs(r - br), Math.abs(g - bgr), Math.abs(b - bb));
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      if (d > 32) { ink++; if (sat > 70) strong++; }
      const l = luma(r, g, b);
      sum += l; sum2 += l * l;
      const c = cy * CW + Math.min(CW - 1, Math.floor((x * CW) / w));
      cellD[c] += d; cellS[c] += sat; cellN[c]++;
    }
  }
  let filled = 0;
  for (let c = 0; c < CW * CH; c++) if (cellN[c] && (cellD[c] / cellN[c] > 64 || (cellS[c] / cellN[c] > 64 && cellD[c] / cellN[c] > 24))) filled++;
  const mean = sum / n;
  return {
    w, h,
    ink: ink / n, strong: strong / n, filled: filled / (CW * CH),
    lumaStd: Math.sqrt(Math.max(0, sum2 / n - mean * mean)),
    bgLuma: luma(br, bgr, bb), bgSat: Math.max(br, bgr, bb) - Math.min(br, bgr, bb),
  };
}

/**
 * Is page 1 no real cover? 'blank' (an empty page), 'uniform' (one flat colour, nothing on it), 'text' (light paper
 * with nothing but sparse marks: a title page, plain text, a library stamp on a scanned leaf) or null (a cover: a
 * picture, colour fields, a dark or coloured ground).
 */
function weakKind(s) {
  if (!s || !(s.w > 0)) return null;
  const light = s.bgLuma >= 165 && s.bgSat <= 48;
  if (s.ink < 0.004) return light ? 'blank' : 'uniform';
  if (s.lumaStd < 4 && s.strong < 0.01) return 'uniform';
  if (light && s.filled <= 0.06 && s.strong <= 0.02) return 'text';
  return null;
}

/**
 * The content of a picture inside a uniform border (white padding around a cover, a letterbox): the colour of the
 * outer ring, and the box of rows and columns that are not that colour. The whole picture when there is no uniform
 * border or the content would be tiny.
 */
function trimBox(rgba, w, h, tol = 26) {
  const full = { x0: 0, y0: 0, x1: w, y1: h, trimmed: false };
  if (w < 8 || h < 8) return full;
  const ring = [];
  const push = (x, y) => { const o = (y * w + x) * 4; ring.push(rgba[o], rgba[o + 1], rgba[o + 2]); };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, 1); push(x, h - 1); push(x, h - 2); }
  for (let y = 2; y < h - 2; y++) { push(0, y); push(1, y); push(w - 1, y); push(w - 2, y); }
  const med = [0, 1, 2].map((c) => { const v = []; for (let i = c; i < ring.length; i += 3) v.push(ring[i]); v.sort((a, b) => a - b); return v[v.length >> 1]; });
  let near = 0;
  for (let i = 0; i < ring.length; i += 3) if (Math.max(Math.abs(ring[i] - med[0]), Math.abs(ring[i + 1] - med[1]), Math.abs(ring[i + 2] - med[2])) <= tol) near++;
  if (near < (ring.length / 3) * 0.85) return full;
  const off = (o) => Math.max(Math.abs(rgba[o] - med[0]), Math.abs(rgba[o + 1] - med[1]), Math.abs(rgba[o + 2] - med[2])) > tol;
  const rowBusy = (y, x0, x1) => { let k = 0; for (let x = x0; x < x1; x++) if (off((y * w + x) * 4)) k++; return k > Math.max(1, (x1 - x0) * 0.02); };
  const colBusy = (x, y0, y1) => { let k = 0; for (let y = y0; y < y1; y++) if (off((y * w + x) * 4)) k++; return k > Math.max(1, (y1 - y0) * 0.02); };
  let y0 = 0, y1 = h, x0 = 0, x1 = w;
  while (y0 < h && !rowBusy(y0, 0, w)) y0++;
  while (y1 > y0 && !rowBusy(y1 - 1, 0, w)) y1--;
  while (x0 < w && !colBusy(x0, y0, y1)) x0++;
  while (x1 > x0 && !colBusy(x1 - 1, y0, y1)) x1--;
  if (x1 - x0 < w * 0.2 || y1 - y0 < h * 0.2) return full;
  return { x0, y0, x1, y1, trimmed: x0 > 0 || y0 > 0 || x1 < w || y1 < h, color: med };
}

/**
 * A cover sits in a frame of its own colour on many shop pictures (square product shots, banners). The frame is cut
 * off when that turns a picture of other proportions into the proportions of a book; a picture that already has
 * them keeps its margins (a white or black cover would lose its own, and copies of it would be cut differently).
 */
function coverBox(rgba, w, h, t = trimBox(rgba, w, h)) {
  if (!t.trimmed) return { x0: 0, y0: 0, x1: w, y1: h, trimmed: false };
  const before = w / h, after = (t.x1 - t.x0) / (t.y1 - t.y0);
  return bookLike(before) || !bookLike(after) ? { x0: 0, y0: 0, x1: w, y1: h, trimmed: false } : t;
}

/** n × n RGB grid (area means) of the box of a picture: the input of the hashes. */
function gridOf(rgba, w, h, box = null, n = 32) {
  const b = box || { x0: 0, y0: 0, x1: w, y1: h };
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  const out = new Uint8Array(n * n * 3);
  for (let gy = 0; gy < n; gy++) {
    const ya = b.y0 + Math.floor((gy * bh) / n), yb = Math.max(ya + 1, b.y0 + Math.floor(((gy + 1) * bh) / n));
    for (let gx = 0; gx < n; gx++) {
      const xa = b.x0 + Math.floor((gx * bw) / n), xb = Math.max(xa + 1, b.x0 + Math.floor(((gx + 1) * bw) / n));
      let r = 0, g = 0, bl = 0, k = 0;
      for (let y = ya; y < yb && y < h; y++) for (let x = xa; x < xb && x < w; x++) { const o = (y * w + x) * 4; r += rgba[o]; g += rgba[o + 1]; bl += rgba[o + 2]; k++; }
      const i = (gy * n + gx) * 3;
      out[i] = k ? Math.round(r / k) : 0; out[i + 1] = k ? Math.round(g / k) : 0; out[i + 2] = k ? Math.round(bl / k) : 0;
    }
  }
  return out;
}

// ---------------------------------------------------------------- hashes -----------------------------------------
const HEX = '0123456789abcdef';
const bitsToHex = (bits) => { let s = ''; for (let i = 0; i < bits.length; i += 4) s += HEX[(bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]]; return s; };
const POP4 = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
/** Number of differing bits of two hashes (hex strings of the same length). */
function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += POP4[HEX.indexOf(a[i]) ^ HEX.indexOf(b[i])];
  return d;
}

let dctTable = null;
/** pHash: the 8 × 8 lowest frequencies of the DCT of the 32 × 32 brightness, one bit each: above their median. */
function phash(grid, n = 32) {
  const N = 32;
  const gray = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) gray[i] = luma(grid[i * 3], grid[i * 3 + 1], grid[i * 3 + 2]);
  if (n !== N) throw new Error('phash needs a 32 × 32 grid');
  if (!dctTable) { dctTable = new Float64Array(8 * N); for (let u = 0; u < 8; u++) for (let x = 0; x < N; x++) dctTable[u * N + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N)); }
  const rows = new Float64Array(N * 8);               // the DCT along x, for the 8 lowest frequencies
  for (let y = 0; y < N; y++) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < N; x++) s += gray[y * N + x] * dctTable[u * N + x]; rows[y * 8 + u] = s; }
  const coef = new Float64Array(64);
  for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) { let s = 0; for (let y = 0; y < N; y++) s += rows[y * 8 + u] * dctTable[v * N + y]; coef[v * 8 + u] = s; }
  const sorted = [...coef].sort((a, b) => a - b);
  const median = (sorted[31] + sorted[32]) / 2;
  return bitsToHex([...coef].map((c) => (c > median ? 1 : 0)));
}

/** dHash: 9 × 8 brightness means, one bit for every left neighbour that is brighter than the right one. */
function dhash(grid, n = 32) {
  const cell = (x0, x1, y0, y1) => { let s = 0, k = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * n + x) * 3; s += luma(grid[i], grid[i + 1], grid[i + 2]); k++; } return k ? s / k : 0; };
  const bits = [];
  for (let gy = 0; gy < 8; gy++) {
    const y0 = Math.floor((gy * n) / 8), y1 = Math.floor(((gy + 1) * n) / 8);
    const row = [];
    for (let gx = 0; gx < 9; gx++) row.push(cell(Math.floor((gx * n) / 9), Math.max(Math.floor((gx * n) / 9) + 1, Math.floor(((gx + 1) * n) / 9)), y0, y1));
    for (let gx = 0; gx < 8; gx++) bits.push(row[gx] > row[gx + 1] ? 1 : 0);
  }
  return bitsToHex(bits);
}

/** The grid reduced to m × m cells (area means): RGB (3 numbers a cell) or brightness (one). */
function reduceGrid(grid, n, m, gray = false) {
  const s = n / m, out = [];
  for (let by = 0; by < m; by++) for (let bx = 0; bx < m; bx++) {
    let r = 0, g = 0, b = 0;
    for (let y = by * s; y < (by + 1) * s; y++) for (let x = bx * s; x < (bx + 1) * s; x++) { const i = (y * n + x) * 3; r += grid[i]; g += grid[i + 1]; b += grid[i + 2]; }
    const k = s * s;
    if (gray) out.push(Math.round(luma(r / k, g / k, b / k))); else out.push(Math.round(r / k), Math.round(g / k), Math.round(b / k));
  }
  return out;
}
/** Mean colour difference of two colour grids, 0 (same) … 1. */
function colorDist(a, b) {
  if (!a || !b || a.length !== b.length) return 1;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length / 255;
}
/** Correlation of two brightness grids, −1 … 1 (1: the same layout of light and dark, whatever the contrast). */
function correlation(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; ab += x * y; aa += x * x; bb += y * y; }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : (aa === bb ? 1 : 0);
}

/**
 * The fingerprints of a picture from its 32 × 32 grid: the perceptual hashes (pHash, dHash), a 16 × 16 brightness
 * grid and an 8 × 8 colour grid, plus the proportions of the content.
 */
function fingerprint(grid, aspect = 0) {
  return { ph: phash(grid), dh: dhash(grid), l16: reduceGrid(grid, 32, 16, true), c8: reduceGrid(grid, 32, 8), aspect: +aspect || 0 };
}

/**
 * The same picture? Copies of one cover differ in size, compression, a sticker or a few pixels of frame: their
 * light and dark parts lie in the same places and their colours match. A photo of the book on a table, another
 * edition or another book differs in one of the two. (The pHash alone is too unsteady on the mostly white covers of
 * many books: two copies of one cover were up to 24 bits apart, two different photos 12.)
 */
function samePicture(a, b) {
  if (!a || !b) return false;
  if (a.aspect > 0 && b.aspect > 0 && Math.abs(Math.log(a.aspect / b.aspect)) > 0.2) return false;
  const ncc = correlation(a.l16, b.l16), col = colorDist(a.c8, b.c8);
  return (ncc >= 0.86 && col <= 0.08) || (ncc >= 0.8 && col <= 0.04) || (hamming(a.ph, b.ph) <= 6 && col <= 0.08);
}
/** How far apart two pictures are (for picking the closest group), lower is closer. */
const pictureDistance = (a, b) => (1 - correlation(a.l16, b.l16)) * 10 + colorDist(a.c8, b.c8) * 20;

// ---------------------------------------------------------------- words ------------------------------------------
const STOP = new Set(('der die das den dem des und oder ein eine einer eines einem einen von vom zum zur im in an am auf aus mit für fur bei ' +
  'the a an of and or to for on with by at from how what why is are le la les un une de des du et el los las y il lo gli di e da het een en van').split(' '));
/** Words of a text for matching: lower case, without accents, umlauts folded (ä, ae → a), no stop words. */
function words(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ß/g, 'ss')
    .replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u')
    .split(/[^a-z0-9]+/).filter((x) => x.length >= 2 && !STOP.has(x));
}
/** Two spellings of one long word: six letters or more, the same first letter, one letter different ("Proceß", "Prozess"). */
const respelled = (a, b) => a.length >= 6 && a.length === b.length && a[0] === b[0] && [...a].filter((ch, i) => ch !== b[i]).length === 1;
/**
 * Share of `wanted` words that occur in `text`: a longer word also counts when it starts with one of 5+ letters, and a
 * long word in another spelling (respelled).
 */
function wordMatch(wanted, text) {
  if (!wanted || !wanted.length) return 0;
  const have = words(text);
  let hit = 0;
  for (const w of wanted) if (have.some((x) => x === w || (w.length >= 5 && (x.startsWith(w) || w.startsWith(x)) && Math.min(x.length, w.length) >= 5) || respelled(w, x))) hit++;
  return hit / wanted.length;
}

// ---------------------------------------------------------------- the query --------------------------------------
const REGION = { de: 'de-de', en: 'us-en', fr: 'fr-fr', es: 'es-es', it: 'it-it', nl: 'nl-nl', pl: 'pl-pl', pt: 'pt-pt', ru: 'ru-ru', sv: 'se-sv', da: 'dk-da', no: 'no-no', nb: 'no-no', fi: 'fi-fi', cs: 'cz-cs', hu: 'hu-hu', tr: 'tr-tr' };
const BOOK_WORD = { de: 'Buch', en: 'book cover', fr: 'livre', es: 'libro', it: 'libro', nl: 'boek', pt: 'livro', pl: 'książka', sv: 'bok', da: 'bog', no: 'bok', nb: 'bok' };
const NAME_PART = /^(?:[A-ZÄÖÜÀ-Ý][\p{L}'’.-]*|von|van|de|der|den|du|da|di|le|la|zu|y)$/u;
// what PDF files put into their author field instead of a person
const NOT_A_NAME = /\b(user|admin|administrator|owner|author|autor|unknown|unbekannt|microsoft|office|word|adobe|acrobat|windows|scanner|scan|pdf|calibre|inc|gmbh|ltd|llc|corp|corporation|verlag|press|publishing|library|bibliothek|hewlett|packard|canon|epson|xerox)\b/i;
/** "Mary Shelley", "Jack London", "Henry David Thoreau", "Heinrich von Kleist": two to four capitalised words, no digits. */
function looksLikeName(s) {
  const t = String(s || '').trim();
  if (!t || t.length > 40 || /\d/.test(t) || NOT_A_NAME.test(t)) return false;
  const parts = t.split(/\s+/);
  return parts.length >= 2 && parts.length <= 4 && parts.every((p) => NAME_PART.test(p)) && /^[A-ZÄÖÜÀ-Ý]/.test(parts[0]);
}
/**
 * The title without what files and shops add: a download site's note "(example.org)" (a domain in lower case), "[eBook]",
 * "2. Auflage", a year, underscores.
 */
function cleanTitle(s) {
  return String(s || '').replace(/_/g, ' ')
    .replace(/\((?:pdf|epub|ebook|e-book)\)|\[[^\]]*\]/gi, ' ')
    .replace(/\(\s*(?:[a-z0-9][a-z0-9-]*\.)+(?![ivxlcdm]+\s*\))[a-z]{2,6}\s*\)/g, ' ')
    .replace(/\b\d+\.\s*(?:auflage|aufl\.|edition)\b|\b(?:ebook|e-book)\b/gi, ' ')
    .replace(/\(\s*\d{4}\s*\)|\s\d{4}$/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
/** The main title: what stands before a subtitle (": …", " - …"), when that is long enough to find the book. */
function mainTitle(s) {
  const t = cleanTitle(s);
  const cut = t.split(/\s*:\s+|\s+[-–—]\s+|\.\s+(?=[A-ZÄÖÜ])/)[0].trim();
  return cut.length >= 8 || cut.split(' ').length >= 2 ? cut : t;
}
/** "Fontane, Theodor" → "Theodor Fontane"; of several authors the first. */
function firstAuthor(a) {
  let s = String(a || '').split(/;|\s&\s|\sund\s|\sand\s/)[0].trim();
  const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length === 2 && !/\s/.test(parts[0]) && parts[1].split(/\s+/).length <= 3) s = parts[1] + ' ' + parts[0];
  else s = parts[0] || '';
  return s.replace(/\s+/g, ' ').slice(0, 60);
}
/** A rough language guess from a title, for books without one. */
function titleLanguage(t) {
  const s = ' ' + String(t || '').toLowerCase() + ' ';
  if (/[äöüß]| (der|die|das|und|ein|eine|des|im|für|vom|zur|zum|wie|über) /.test(s)) return 'de';
  if (/ (the|of|and|how|to|for|a|an|in|with|your|what|why) /.test(s)) return 'en';
  return null;
}

/**
 * The image search for a book: main title, the first author and a word that asks for the book ("Buch", "book
 * cover"), the region of the book's language. A file name like "Mary Shelley - Frankenstein" (no author
 * in the record) gives its author back.
 */
function coverQuery(book) {
  let title = cleanTitle(book?.title || '');
  let author = firstAuthor(book?.author || '');
  if (author && !looksLikeName(author)) author = '';
  if (!author && / [-–] /.test(title)) {
    const [head, ...rest] = title.split(/ [-–] /);
    const tail = rest.join(' - ').trim();
    if (looksLikeName(head) && tail.length >= 3) { author = head.trim(); title = tail; }
    else if (rest.length === 1 && looksLikeName(tail) && head.length >= 3) { author = tail; title = head.trim(); }
  }
  const main = mainTitle(title);
  const lang = String(book?.language || '').slice(0, 2).toLowerCase() || titleLanguage(main) || null;
  const word = BOOK_WORD[lang] || 'book cover';
  const q = [main, author, word].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  const last = words(author).slice(-1);
  return { q, region: REGION[lang] || 'wt-wt', lang, title: main, author, titleWords: words(main), authorWords: last };
}

// ---------------------------------------------------------------- the choice -------------------------------------
/** Proportions of a book cover (width / height): about 0.6 to 0.75, a little room on both sides. */
const bookLike = (a) => a >= 0.52 && a <= 0.85;
function aspectWeight(a) {
  if (!(a > 0)) return 0.3;
  if (a >= 0.58 && a <= 0.74) return 1;
  if (a >= 0.55 && a <= 0.8) return 0.8;       // the edges: camera photos (3 : 4), covers with a frame
  if (bookLike(a)) return 0.6;                 // large formats (workbooks), narrow mass-market editions
  if ((a >= 0.45 && a < 0.52) || (a > 0.85 && a <= 0.95)) return 0.4;
  return 0.2;
}

/** The words of a page address ("…/Die-Leiden-des-jungen-Werthers-Goethe/dp/…"). */
function pageWords(u) {
  let s = String(u || '');
  try { s = decodeURIComponent(s); } catch {}
  return s.replace(/[-_+/.]/g, ' ');
}

/** The site an image was found on, without "www." ("www.amazon.de" → "amazon.de"). */
function siteOf(u) {
  try { return new URL(u).hostname.toLowerCase().replace(/^(www\d?|m|de|en|mobile)\./, ''); } catch { return ''; }
}
// Second-hand markets show photos of used copies (a table, a hand, a carpet around the book); stock photo sites
// carry watermarks: both count less, and stock pictures are never downloaded. Portfolio sites show designs of a cover
// (a designer's or a student's idea), seldom an edition: they count little and never alone.
const MARKET = /(^|\.)(ricardo\.ch|ebay\.[a-z.]+|kleinanzeigen\.de|ebay-kleinanzeigen\.de|willhaben\.at|vinted\.[a-z.]+|booklooker\.de|zvab\.com|abebooks\.[a-z.]+|etsy\.com|picclick\.[a-z.]+|tutti\.ch|anibis\.ch|marktplaats\.nl|leboncoin\.fr|wallapop\.com|subito\.it|olx\.[a-z.]+|mercadolibre\.[a-z.]+|mercadolivre\.[a-z.]+)$/;
const STOCK = /(^|\.)(alamy\.[a-z.]+|shutterstock\.com|dreamstime\.com|gettyimages\.[a-z.]+|istockphoto\.com|depositphotos\.com|123rf\.com|stock\.adobe\.com|adobestock\.com|bigstockphoto\.com|pond5\.com|agefotostock\.com)$/;
const PLACEHOLDER = /no[-_]?(image|photo|cover|picture|img)|placeholder|image[-_]?not[-_]?(found|available)|default[-_]?(cover|book|image)|nocover|nophoto|missing[-_]?(cover|image)/i;
// Pages about something that comes with the book (a summary, an analysis, the audio book) name its title but show
// another picture (the summary's own cover, the audio book's, an edition in another language): they count little and
// never name the book for their group.
const COMPANION_PAGE = /\b(?:zusammenfassung|summary|summaries|analyse|analysis|study guide|lekt(?:ü|ue|u)rehilfe|lekt(?:ü|ue|u)reschl(?:ü|ue|u)ssel|h(?:ö|oe|o)rbuch|h(?:ö|oe|o)rprobe|h(?:ö|oe|o)rspiel|audiobook|audible|lesung)\b/i;
const companionPage = (m) => COMPANION_PAGE.test(String(m.title || '') + ' ' + pageWords(m.url));
const DESIGN = /(^|\.)(behance\.net|dribbble\.com|artstation\.com|deviantart\.com)$/;
function siteWeight(site) {
  if (STOCK.test(site) || DESIGN.test(site)) return 0.4;
  if (MARKET.test(site)) return 0.6;
  return 1;
}
/** May the picture be downloaded as the cover (no stock photo with a watermark, no placeholder)? */
const downloadable = (c) => !STOCK.test(siteOf(c.image)) && !STOCK.test(c.site || '') && !PLACEHOLDER.test(c.image || '');

/**
 * Groups the analysed search results into pictures. `cands` in the order of the search, each
 * { rank, site, title, url, image, width, height, aspect (of the content), fp: fingerprint }. A result joins the
 * group with the closest member that shows the same picture, otherwise it starts a group of its own (no chains of
 * merely similar pictures).
 */
function clusterCandidates(cands) {
  const groups = [];
  for (const c of cands) {
    if (!c || !c.fp) continue;
    let best = null, bestD = Infinity;
    for (const g of groups) for (const m of g.members) {
      if (!samePicture(c.fp, m.fp)) continue;
      const d = pictureDistance(c.fp, m.fp);
      if (d < bestD) { bestD = d; best = g; }
    }
    if (best) best.members.push(c); else groups.push({ members: [c] });
  }
  return groups;
}

/**
 * Scores the groups: every site counts once (a shop that shows the cover five times is one vote), a vote weighs
 * by the rank of its result, the proportions of the picture, the kind of site and whether the page names the book.
 * A picture that several search engines found in their own indexes (`engine` of the results; Yandex, and Bing whose
 * pictures DuckDuckGo shows too) gets a vote more for every further one.
 * The group seen on the most sites wins. Returns the groups, best first, each with
 * { members, score, sites, engines, matched (a page names the book), aspect (median), rep (the best member) }.
 */
function scoreClusters(groups, query) {
  const N = 20;
  for (const g of groups) {
    const bySite = new Map();
    for (const m of g.members) {
      const other = companionPage(m);
      m.match = other ? 0 : Math.max(wordMatch(query.titleWords, m.title), wordMatch(query.titleWords, pageWords(m.url)));
      const w = (1 - 0.5 * Math.min(m.rank, N) / N) * aspectWeight(m.aspect) * siteWeight(m.site || '') * (m.match >= 0.5 ? 1 : 0.6) * (other ? 0.5 : 1);
      const key = m.site || m.url || String(m.rank);
      if (!bySite.has(key) || bySite.get(key) < w) bySite.set(key, w);
    }
    // engines with an index of their own (DuckDuckGo shows Bing's pictures: the two are one voice)
    g.engines = new Set(g.members.map((m) => (m.engine === 'yandex' ? 'yandex' : 'bing'))).size;
    g.score = [...bySite.values()].reduce((a, b) => a + b, 0) + (g.engines - 1) * 0.8;
    g.sites = bySite.size;
    g.matched = g.members.some((m) => m.match >= 0.5);
    const asp = g.members.map((m) => m.aspect).filter((a) => a > 0).sort((a, b) => a - b);
    g.aspect = asp.length ? asp[asp.length >> 1] : 0;
    g.rep = [...g.members].sort((a, b) => (b.match >= 0.5) - (a.match >= 0.5) || aspectWeight(b.aspect) - aspectWeight(a.aspect) || a.rank - b.rank)[0];
  }
  return [...groups].sort((a, b) => b.score - a.score || a.rep.rank - b.rep.rank);
}

/**
 * The cover among the analysed results: the picture that appears on most sites, in the proportions of a book, on at
 * least two sites (or found by two search engines) one of whose pages names the book. Failing that, a single result
 * whose page names title and the known author and that has the proportions of a book, among the first eight. null
 * when nothing is convincing (a title the search does not know: better no cover than a wrong one).
 * @returns { group, confidence: 'cluster'|'single', groups } or null
 */
function pickCover(cands, query) {
  const groups = scoreClusters(clusterCandidates(cands), query);
  const authorOk = (m) => !query.authorWords?.length || wordMatch(query.authorWords, m.title + ' ' + pageWords(m.url)) >= 1;
  const top = groups.find((g) => (g.sites >= 2 || g.engines >= 2) && g.matched && g.members.some(authorOk) && bookLike(g.aspect) && g.members.some(downloadable));
  if (top) return { group: top, confidence: 'cluster', groups };
  // a single result: a shop or publisher page (no second-hand market, no stock photo) that names title and author;
  // a picture of 600 px and more before a small one (small ones are mostly mock-ups and thumbnails), then by rank. A
  // book without a known author needs the agreement of two sites (a page may show the picture of another book)
  const single = !query.authorWords?.length ? null : cands.filter((c) => c && c.fp && c.rank < 8 && bookLike(c.aspect) && downloadable(c) && siteWeight(c.site || '') >= 1 && c.match >= 0.75 && authorOk(c))
    .sort((a, b) => ((b.height || 0) >= 600) - ((a.height || 0) >= 600) || a.rank - b.rank)[0];
  if (single) {
    const group = groups.find((g) => g.members.includes(single));
    return { group, confidence: 'single', groups };
  }
  return null;
}

/**
 * The members of the winning group to download, best first: downloadable and at least 300 px tall (the size the
 * search reports). The cover cache keeps 900 px: of the copies that have them, the smallest comes first (the same
 * picture for a fraction of the bytes), then the others from the largest down.
 */
function downloadOrder(group, minHeight = 300, enough = 900) {
  const ok = group.members.filter((m) => downloadable(m) && (m.height || 0) >= minHeight);
  const big = ok.filter((m) => m.height >= enough).sort((a, b) => a.height - b.height || a.rank - b.rank);
  const rest = ok.filter((m) => m.height < enough).sort((a, b) => b.height - a.height || a.rank - b.rank);
  return [...big, ...rest];
}

/** A downloaded picture is the expected one (not a placeholder the host sends instead, not another picture). */
function verifyDownload(expected, got) {
  if (!got || !expected) return false;
  return correlation(expected.l16, got.l16) >= 0.8 && colorDist(expected.c8, got.c8) <= 0.1;
}

module.exports = {
  COVER_CHECK, pageStats, weakKind, trimBox, coverBox, gridOf,
  phash, dhash, reduceGrid, colorDist, correlation, hamming, fingerprint, samePicture, pictureDistance,
  words, wordMatch, coverQuery, mainTitle, cleanTitle, firstAuthor, looksLikeName, titleLanguage,
  bookLike, aspectWeight, siteOf, siteWeight, downloadable, companionPage,
  clusterCandidates, scoreClusters, pickCover, downloadOrder, verifyDownload,
};
