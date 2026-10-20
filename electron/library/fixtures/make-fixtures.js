// The fixtures of the cover tests, made up from scratch: nothing in them was recorded. Book catalogues, image search
// engines and pictures are invented here in the formats the parsers read, for the sample of build/testlib/cover-sample.js
// (public-domain classics and invented titles) and a few made-up searches:
//   sources.json.gz         the answers of Open Library, Goodreads, Apple Books, the DNB, the Internet Archive, Google Books
//                           and Amazon's pictures for every question the lookup can ask about a sample book (test-cover-sources.js)
//   engines.json.gz         Bing's and Yandex's answers for the parsers, the pages of engines that want a captcha, and
//                           image searches of Bing, Yandex and DuckDuckGo about sample books with their thumbnails
//   covers/searches.json    DuckDuckGo image searches of 20 results each (test-covers.js) and
//   covers/thumbnails.png   their thumbnails as the indexer window analyses them: 32 × 32 grids, one row per search
// The pictures are drawn below (flat covers with bars of "type", copies of one cover in other sizes, with noise, a
// sticker or on a white square like a shop's product picture, photos of a book on a table, banners, portraits, pages of
// text, empty placeholders) and looked at like the indexer does (cover-match.js pageStats, trimBox, coverBox, gridOf).
// Every web address is made up (*.example) except the hosts of the catalogues and engines themselves and the kinds of
// sites cover-match.js knows by name (a second-hand market, a stock photo site, portfolio sites).
//   node electron/library/fixtures/make-fixtures.js           writes the four files
//   node electron/library/fixtures/make-fixtures.js --check   writes nothing, checks the designed picks of the searches
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const S = require('../cover-sources');
const BM = require('../book-match');
const M = require('../cover-match');
const IE = require('../image-engines');
const { proxied } = require('../web-covers');
const SAMPLE = require('../../../build/testlib/cover-sample');

const OUT = __dirname;
const CHECK = process.argv.includes('--check');
const NOTE = 'Synthetic: made by electron/library/fixtures/make-fixtures.js, nothing recorded; invented answers in the formats of the real services, drawn pictures, made-up addresses.';

// ---------------------------------------------------------------- numbers --------------------------------------------
const hash = (s) => crypto.createHash('sha1').update(String(s)).digest();
const num = (s, mod) => hash(s).readUInt32BE(0) % mod;
/** A made-up ISBN-13 for a label (978-3-9…, a valid check digit). */
function isbnOf(label) {
  const core = '97839' + String(num('isbn ' + label, 1e7)).padStart(7, '0');
  let s = 0;
  for (let i = 0; i < 12; i++) s += (i % 2 ? 3 : 1) * +core[i];
  return core + ((10 - (s % 10)) % 10);
}
const token = (label, n = 22) => hash('token ' + label).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, n);
/** A small random generator with a seed (the same pictures on every run). */
function rng(seed) { let s = hash('rng ' + seed).readUInt32BE(0) || 1; return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296); }

// ---------------------------------------------------------------- pictures -------------------------------------------
/** An RGBA picture filled with `bg`, with helpers to paint rectangles, discs and noise. */
function picture(w, h, bg = [255, 255, 255]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([bg[0], bg[1], bg[2], 255], i * 4);
  const pic = {
    w, h, data,
    rect(x, y, rw, rh, c) { x = Math.round(x); y = Math.round(y); rw = Math.round(rw); rh = Math.round(rh); for (let yy = Math.max(0, y); yy < Math.min(h, y + rh); yy++) for (let xx = Math.max(0, x); xx < Math.min(w, x + rw); xx++) data.set([c[0], c[1], c[2], 255], (yy * w + xx) * 4); return pic; },
    disc(cx, cy, r, c) { for (let yy = Math.max(0, Math.floor(cy - r)); yy < Math.min(h, Math.ceil(cy + r)); yy++) for (let xx = Math.max(0, Math.floor(cx - r)); xx < Math.min(w, Math.ceil(cx + r)); xx++) if (Math.hypot(xx - cx, yy - cy) <= r) data.set([c[0], c[1], c[2], 255], (yy * w + xx) * 4); return pic; },
    noise(amount, seed) { const r = rng('noise ' + seed); for (let i = 0; i < w * h * 4; i += 4) for (let c = 0; c < 3; c++) data[i + c] = data[i + c] + Math.round((r() - 0.5) * 2 * amount); return pic; },
    paste(p, x, y) { for (let yy = 0; yy < p.h; yy++) for (let xx = 0; xx < p.w; xx++) { const X = x + xx, Y = y + yy; if (X >= 0 && Y >= 0 && X < w && Y < h) data.set(p.data.subarray((yy * p.w + xx) * 4, (yy * p.w + xx) * 4 + 4), (Y * w + X) * 4); } return pic; },
  };
  return pic;
}
/** The picture scaled to w × h (box filter), as a smaller copy of it would be. */
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
const PALETTE = [[196, 72, 52], [38, 64, 98], [30, 90, 70], [232, 196, 80], [120, 40, 90], [24, 30, 44], [210, 120, 40], [70, 130, 160], [150, 30, 40], [90, 110, 50], [236, 226, 206], [60, 60, 66], [180, 150, 110], [40, 110, 120]];
/**
 * A flat book cover of its own design for a name: a coloured ground, a band, a disc, a frame or stripes, bars of
 * "type" for title and author. One name, one cover; other names give other covers.
 */
function coverArt(name, w = 120, h = 180) {
  const r = rng('cover ' + name);
  const pick = () => PALETTE[Math.floor(r() * PALETTE.length)];
  const ground = pick();
  let band = pick(); while (band === ground) band = pick();
  let accent = pick(); while (accent === ground || accent === band) accent = pick();
  const ink = (0.299 * ground[0] + 0.587 * ground[1] + 0.114 * ground[2]) > 140 ? [28, 26, 30] : [250, 246, 236];
  const p = picture(w, h, ground);
  const layout = Math.floor(r() * 4);
  if (layout === 0) p.disc(w * (0.3 + r() * 0.4), h * (0.55 + r() * 0.2), w * (0.25 + r() * 0.2), accent);
  else if (layout === 1) { p.rect(w * 0.08, h * 0.45, w * 0.84, h * 0.4, accent); p.rect(w * 0.14, h * 0.5, w * 0.72, h * 0.3, band); }
  else if (layout === 2) for (let i = 0; i < 5; i++) p.rect(0, h * (0.42 + i * 0.1), w, h * 0.05, i % 2 ? accent : band);
  else { p.rect(w * 0.5, 0, w * 0.5, h, accent); p.disc(w * 0.5, h * 0.62, w * 0.22, band); }
  p.rect(0, 0, w, h * (0.08 + r() * 0.08), band);
  const lines = 2 + Math.floor(r() * 3), top = h * (0.18 + r() * 0.06);
  for (let i = 0; i < lines; i++) p.rect(w * 0.1, top + i * h * 0.065, w * (0.8 - r() * 0.35), h * 0.035, ink);
  p.rect(w * 0.1, h * 0.9, w * (0.3 + r() * 0.3), h * 0.025, ink);
  return p;
}
/** A copy of a cover as another site shows it: another size, a little noise, maybe a sticker, maybe on a white square. */
function copyOf(art, { w = 120, h = 180, noise = 6, sticker = false, square = false, seed = '' } = {}) {
  const c = scaled(art, w, h).noise(noise, 'copy ' + seed + w + 'x' + h);
  if (sticker) c.disc(w * 0.8, h * 0.2, w * 0.1, [230, 30, 30]);
  if (!square) return c;
  const s = Math.round(h * 1.1), sq = picture(s, s, [255, 255, 255]);
  return sq.paste(c, Math.round((s - w) / 2), Math.round((s - h) / 2));
}
/** A photo of a book lying on a table (wood, a hand's shadow): the cover small and turned out of the frame. */
function photoOf(art, name, w = 180, h = 135) {
  const p = picture(w, h, [150, 104, 60]).noise(40, 'table ' + name);
  p.paste(scaled(art, Math.round(h * 0.5), Math.round(h * 0.75)), Math.round(w * 0.35), Math.round(h * 0.12));
  return p.rect(0, h * 0.85, w, h * 0.15, [90, 60, 40]).noise(12, 'photo ' + name);
}
/** A wide banner (a blog's header, a film still): a gradient sky, a horizon, a few shapes. */
function banner(name, w = 240, h = 120) {
  const r = rng('banner ' + name), top = PALETTE[Math.floor(r() * PALETTE.length)], low = PALETTE[Math.floor(r() * PALETTE.length)];
  const p = picture(w, h);
  for (let y = 0; y < h; y++) { const t = y / h; p.rect(0, y, w, 1, top.map((v, i) => v * (1 - t) + low[i] * t)); }
  for (let i = 0; i < 4; i++) p.disc(r() * w, h * (0.4 + r() * 0.5), h * (0.1 + r() * 0.2), PALETTE[Math.floor(r() * PALETTE.length)]);
  return p.noise(10, 'banner ' + name);
}
/** A portrait of a person (a face on a dark ground): what an author's page shows. */
function portrait(name, w = 120, h = 160) {
  const r = rng('portrait ' + name);
  const p = picture(w, h, [30 + r() * 40, 30 + r() * 40, 40 + r() * 40]);
  p.disc(w / 2, h * 0.95, w * 0.45, [60 + r() * 60, 50, 50]);
  p.disc(w / 2, h * 0.42, w * 0.24, [214, 172, 140]);
  return p.noise(14, 'portrait ' + name);
}
/** A page of text on paper (a scanned flap): light, sparse marks. */
function textPage(name, w = 120, h = 180) {
  const p = picture(w, h, [246, 242, 232]);
  const r = rng('text ' + name);
  for (let y = 14; y < h - 14; y += 4) for (let x = 10; x < w - 14; x += 6 + Math.floor(r() * 4)) p.rect(x, y, 3, 1, [40, 40, 40]);
  return p;
}

/**
 * What the indexer window sees in a picture (record-cover-sources.js decode): the content inside a uniform border,
 * its proportions and height, whether it sits on a white ground (`framed`), weakKind of the whole, the 32 × 32 grid.
 * `height`: the height of the picture the grid stands for (its proportions are those of the drawing).
 */
function look(p, height = p.h) {
  const stats = M.pageStats(p.data, p.w, p.h);
  const ring = M.trimBox(p.data, p.w, p.h);
  const box = M.coverBox(p.data, p.w, p.h, ring);
  const c = ring.color || [0, 0, 0];
  const framed = !!ring.trimmed && 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] >= 225 && Math.max(...c) - Math.min(...c) <= 24;
  const aspect = Math.round(((box.x1 - box.x0) / (box.y1 - box.y0)) * 1000) / 1000;
  const grid = M.gridOf(p.data, p.w, p.h, box);
  return { framed, weak: M.weakKind(stats), aspect, boxHeight: Math.round(((box.y1 - box.y0) / p.h) * height), grid };
}
const g16 = (grid) => Buffer.from(M.reduceGrid(grid, 32, 16)).toString('base64');

// ---------------------------------------------------------------- catalogue answers ----------------------------------
const xml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const LITTLE = { de: ' der die das und ist mit sich auch eine für wie der und die ', en: ' the and of to is with that this are for your you the and ' };
/** Open Library: a work with the edition its search puts first. */
const olWork = ({ id, title, subtitle, authors, cover, langs = ['eng'], year, edition = null }) => ({
  key: `/works/OL${id}W`, title, ...(subtitle ? { subtitle } : {}), author_name: authors, ...(cover ? { cover_i: cover } : {}), language: langs, first_publish_year: year, edition_count: edition ? 3 : 1,
  editions: { numFound: edition ? 1 : 0, start: 0, numFoundExact: true, docs: edition ? [{ key: `/books/OL${id}M`, title: edition.title || title, ...(edition.subtitle ? { subtitle: edition.subtitle } : {}), ...(edition.cover ? { cover_i: edition.cover } : {}),
    language: [edition.lang || langs[0]], publisher: [edition.publisher || 'Lantern Classics'], publish_date: [String(edition.year || 2001)], ...(edition.isbn ? { isbn: [edition.isbn, BM.isbn10(edition.isbn)].filter(Boolean) } : {}) }] : [] },
});
/** Apple Books: an e-book whose artwork is named after its ISBN. */
const appleBook = ({ id, title, artist, isbn, released = '2012-05-01T07:00:00Z', lang = 'en' }) => {
  const dir = token('apple ' + id, 32).toLowerCase().replace(/(.{2})(.{2})(.{2})(.{8})(.{4}).*/, '$1/$2/$3/$1$2$3$4-$5');
  const art = (s) => `https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/${dir}/${isbn}.jpg/${s}x${s}bb.jpg`;
  return { kind: 'ebook', trackId: 6000000000 + num('apple ' + id, 9e8), trackName: title, artistName: artist, artworkUrl60: art(60), artworkUrl100: art(100),
    trackViewUrl: `https://books.apple.com/${lang === 'de' ? 'de' : 'us'}/book/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}/id${6000000000 + num('apple ' + id, 9e8)}?uo=4`, releaseDate: released, description: LITTLE[lang] || LITTLE.en };
};
const appleArtUrl = (rec, size) => S.appleArt(rec.artworkUrl100, size);
/** Goodreads: a suggestion of its search box. */
const grBook = ({ id, title, bare = title, author }) => ({ bookId: String(id), title, bookTitleBare: bare, author: { name: author }, imageUrl: `https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1600000000i/${id}._SY75_.jpg` });
const grFull = (rec) => S.goodreadsImage(rec.imageUrl);
/** The DNB: a MARC21 record (the fields parseDnb reads). `audio`: an audio book (leader 6 'i'). */
function marc({ id, title, n = null, p = null, sub = null, author = null, coauthor = null, isbn = null, lang = 'ger', publisher = null, year = 2010, series = null, series830 = null, online = false, audio = false }) {
  const df = (tag, i1, i2, subs) => `<datafield tag="${tag}" ind1="${i1}" ind2="${i2}">` + subs.filter((s) => s[1] != null).map(([c, v]) => `<subfield code="${c}">${xml(v)}</subfield>`).join('') + '</datafield>';
  const c008 = ('260101s' + year + '    gw |||||' + (online ? 'o' : ' ') + '|||| 00||||').padEnd(35, '|') + lang + '  ';
  return `<recordData><record><leader>00000n${audio ? 'i' : 'a'}m a2200000 c 4500</leader><controlfield tag="001">${id}</controlfield><controlfield tag="008">${c008}</controlfield>` +
    (isbn ? df('020', ' ', ' ', [['a', isbn]]) : '') + df('041', ' ', ' ', [['a', lang]]) + (author ? df('100', '1', ' ', [['a', author], ['4', 'aut']]) : '') +
    df('245', '1', '0', [['a', title], ['b', sub], ['n', n], ['p', p]]) + df('264', ' ', '1', [['b', publisher], ['c', String(year)]]) +
    (online ? df('338', ' ', ' ', [['a', 'Online-Ressource']]) : '') + (series ? df('490', '1', ' ', [['a', series[0]], ['v', series[1]]]) : '') +
    (coauthor ? df('700', '1', ' ', [['a', coauthor], ['4', 'aut']]) : '') + (series830 ? df('830', ' ', '0', [['a', series830[0]], ['v', series830[1]]]) : '') + '</record></recordData>';
}
const dnbAnswer = (recs) => `<searchRetrieveResponse><numberOfRecords>${recs.length}</numberOfRecords><records>${recs.join('')}</records></searchRetrieveResponse>`;
const isbnOfMarc = (m) => (/<datafield tag="020"[^>]*><subfield code="a">(\d+)</.exec(m) || [])[1] || null;
/** The Internet Archive: a scanned copy. */
const iaDoc = ({ id, title, creator, date, language = 'eng', isbn = null, publisher = null }) => ({ identifier: id, title, creator, ...(date ? { date } : {}), language, ...(isbn ? { isbn: [BM.isbn10(isbn), isbn].filter(Boolean) } : {}), ...(publisher ? { publisher } : {}) });

// sizes of the catalogues' pictures (width, height)
const SIZE = { openlibrary: [400, 600], apple: [600, 900], dnb: [391, 599], goodreads: [400, 600], archive: [600, 900], amazon: [316, 500] };
const img = (w, h, extra = {}) => ({ w, h, framed: false, weak: null, aspect: Math.round((w / h) * 1000) / 1000, boxHeight: h, ...extra });

/**
 * The world of each sample book: what each catalogue knows (`ol` docs, `gr` suggestions, `apple` e-books, `dnb` MARC
 * records, `ia` copies), which ISBNs it also finds by number (`byIsbn`), and the pictures (`images`: url → picture,
 * null for none; every cover of a record has a picture of the usual size unless named here; Amazon: `amazon` ISBN-10s
 * that have a picture, every other ISBN gets Amazon's 1 × 1 GIF). `pick`: the picture the lookup must choose.
 */
const OLC = (id) => `https://covers.openlibrary.org/b/id/${id}-L.jpg?default=false`;
const DNBC = (isbn) => S.dnbCover(isbn).url;
const AMZ = (isbn) => S.amazonCover(isbn).url;
const WORLD = {
  "The Beekeeper's First Workbook Practical Exercises and": () => {
    const pb = isbnOf('bee-pb'), eb = isbnOf('bee-eb');
    const ap = appleBook({ id: 'bee', title: "The Beekeeper's First Workbook: Practical Exercises and Field Notes for Beginners", artist: 'Maren Holloway & Tobias Fairweather', isbn: eb, released: '2021-03-04T08:00:00Z' });
    return {
      ol: [olWork({ id: 101, title: "The Beekeeper's First Workbook", authors: ['Maren Holloway', 'Tobias Fairweather'], year: 2021, edition: { isbn: pb, publisher: 'Hollow Oak Press', year: 2021 } })],
      gr: [grBook({ id: 59000101, title: "The Beekeeper's First Workbook: Practical Exercises and Field Notes for Beginners", author: 'Maren Holloway' }), grBook({ id: 59000102, title: 'The Beekeeping Year: A Diary', author: 'Ottilie Vane' })],
      apple: [ap, appleBook({ id: 'bee2', title: 'Bees of the Northern Meadows', artist: 'Ottilie Vane', isbn: isbnOf('bee-other') })],
      amazon: [pb], images: { [AMZ(pb)]: img(386, 500), [appleArtUrl(ap, 900)]: img(695, 900) }, pick: AMZ(pb),
    };
  },
  'Frankenstein: or, The Modern Prometheus': () => ({
    ol: [olWork({ id: 102, title: 'Frankenstein', subtitle: 'or, The Modern Prometheus', authors: ['Mary Wollstonecraft Shelley'], cover: 7100101, year: 1818, edition: { cover: 7100102, publisher: 'Lantern Classics', year: 1994 } })],
    gr: [grBook({ id: 59000103, title: 'Frankenstein: or, The Modern Prometheus', author: 'Mary Shelley' })],
    pick: OLC(7100101),
  }),
  'Pride and Prejudice': () => {
    const ap = appleBook({ id: 'pride', title: 'Pride and Prejudice', artist: 'Jane Austen', isbn: isbnOf('pride-eb'), released: '2012-05-01T07:00:00Z' });
    return {
      ol: [olWork({ id: 103, title: 'Pride and Prejudice', subtitle: 'A Study Guide', authors: ['Clara Notewell'], cover: 7100103, year: 2015 })],
      gr: [], apple: [ap],
      ia: [iaDoc({ id: 'prideprejudice00aust', title: 'Pride and prejudice', creator: 'Austen, Jane, 1775-1817', date: '1907-01-01T00:00:00Z' })],
      pick: appleArtUrl(ap, 900),
    };
  },
  'Great Expectations, Annotated Edition': () => ({
    ol: [olWork({ id: 104, title: 'Great Expectations', authors: ['Charles Dickens'], cover: 7100104, year: 1861, edition: { cover: 7100105, publisher: 'Lantern Classics', year: 2003 } })],
    pick: OLC(7100104),
  }),
  'Walden Life in the Woods': () => {
    const e = isbnOf('walden');
    return {
      ol: [olWork({ id: 105, title: 'Walden', subtitle: 'or, Life in the Woods', authors: ['Henry David Thoreau'], cover: 7100106, year: 1854, edition: { subtitle: 'Life in the Woods', isbn: e, publisher: 'Hollow Oak Press', year: 2004 } })],
      amazon: [e], pick: AMZ(e),
    };
  },
  Persuasion: () => {
    const e = isbnOf('persuasion');
    return { ol: [olWork({ id: 106, title: 'Persuasion', authors: ['Jane Austen'], cover: 7100107, year: 1817, edition: { isbn: e, cover: 7100108, year: 2010 } })], amazon: [e], pick: AMZ(e) };
  },
  'The Time Machine_ An Invention': () => ({
    ol: [olWork({ id: 107, title: 'The Time Machine', subtitle: 'An Invention', authors: ['H. G. Wells'], cover: 7100109, year: 1895, edition: { cover: 7100110, year: 1995 } })],
    pick: OLC(7100109),
  }),
  'Through the Looking-Glass, and What Alice Found There': () => {
    const e = isbnOf('looking-glass');
    return { ol: [olWork({ id: 108, title: 'Through the Looking-Glass, and What Alice Found There', authors: ['Lewis Carroll'], cover: 7100111, year: 1871, edition: { isbn: e, cover: 7100112, year: 2009 } })], amazon: [e], pick: AMZ(e) };
  },
  'The Sign of the Four (Sherlock Holmes, Book 2)': () => {
    const gr = grBook({ id: 59000104, title: 'The Sign of the Four (Sherlock Holmes, #2)', bare: 'The Sign of the Four', author: 'Arthur Conan Doyle' });
    // Open Library names no volume: 0.95 × 0.88 for the book's "Book 2" is too little
    return { ol: [olWork({ id: 109, title: 'The Sign of the Four', authors: ['Arthur Conan Doyle'], cover: 7100113, year: 1890 })], gr: [gr], pick: grFull(gr) };
  },
  'The Voyage of the Beagle': () => {
    const e = isbnOf('beagle');
    return { ol: [olWork({ id: 110, title: 'The Voyage of the Beagle', authors: ['Charles Darwin'], cover: 7100114, year: 1839, edition: { isbn: e, cover: 7100115, year: 1997 } })], amazon: [e], pick: AMZ(e) };
  },
  'The Call of the Wild': () => ({
    ol: [olWork({ id: 111, title: 'The Call of the Wild', authors: ['Jack London'], cover: 7100116, year: 1903, edition: { cover: 7100117, year: 1999 } })],
    pick: OLC(7100116),
  }),
  'Moby-Dick': () => {
    const gr = grBook({ id: 59000105, title: 'Moby-Dick', author: 'Herman Melville' });
    return {
      ol: [olWork({ id: 112, title: 'Moby-Dick', authors: ['Herman Melville'], cover: 7100118, year: 1851 })], gr: [gr],
      images: { [OLC(7100118)]: img(600, 600, { framed: true, aspect: 0.66, boxHeight: 540 }) }, pick: grFull(gr),
    };
  },
  'Microsoft Word - manuscript_final': () => {
    const e = '9783950590166';
    return {
      ol: [olWork({ id: 113, title: 'On the Origin of Species', authors: ['Charles Darwin'], cover: 7100119, year: 1859, edition: { isbn: e, cover: 7100120, year: 2008 } })], byIsbn: { ol: [e] },
      amazon: [e], pick: AMZ(e),
    };
  },
  'Quantum Gardening for Retired Lighthouse Keepers': () => ({
    ol: [olWork({ id: 114, title: 'Gardening for Lighthouse Keepers', authors: ['Ottilie Vane'], cover: 7100121, year: 1998 })],
    gr: [grBook({ id: 59000106, title: 'Quantum Physics for Gardeners', author: 'Bertram Ashdown' })],
    pick: null,
  }),
  // ---- German
  'Die Leiden des jungen Werthers': () => {
    const a = isbnOf('werther-1'), b = isbnOf('werther-2');
    return {
      dnb: [marc({ id: '9990000101', title: 'Die Leiden des jungen Werthers', author: 'Goethe, Johann Wolfgang von', isbn: a, publisher: 'Lindenhof Verlag', year: 2019 }),
        marc({ id: '9990000102', title: 'Die Leiden des jungen Werthers', author: 'Goethe, Johann Wolfgang von', isbn: b, publisher: 'Kieselstein Verlag', year: 2008 }),
        marc({ id: '9990000103', title: 'Die Leiden des jungen Werthers', sub: 'vollständige Lesung', author: 'Goethe, Johann Wolfgang von', publisher: 'Hörverlag Elster', year: 2016, audio: true })],
      ol: [olWork({ id: 201, title: 'Die Leiden des jungen Werthers', authors: ['Johann Wolfgang von Goethe'], cover: 7100201, langs: ['ger', 'eng'], year: 1774, edition: { isbn: b, cover: 7100202, lang: 'ger', publisher: 'Kieselstein Verlag', year: 2008 } })],
      ia: [iaDoc({ id: 'dieleidendesjung0000goet', title: 'Die Leiden des jungen Werthers', creator: 'Goethe, Johann Wolfgang von 1749-1832 VerfasserIn', date: '1999-01-01T00:00:00Z', language: 'ger', isbn: a })],
      amazon: [a, b], pick: DNBC(a),
    };
  },
  'Maler Nolten': () => {
    const a = isbnOf('nolten');
    return { dnb: [marc({ id: '9990000201', title: 'Maler Nolten', sub: 'Novelle in zwei Teilen', author: 'Mörike, Eduard', isbn: a, publisher: 'Lindenhof Verlag', year: 2012 })], pick: DNBC(a) };
  },
  'Der Schimmelreiter': () => {
    const k = isbnOf('schimmel-klett'), d = isbnOf('schimmel-bod'), n = isbnOf('schimmel');
    return {
      dnb: [marc({ id: '9990000301', title: 'Der Schimmelreiter', sub: 'Textausgabe mit Materialien', author: 'Storm, Theodor', isbn: k, publisher: 'Ernst Klett Verlag', year: 2018, series: ['Klett Lektüre ;', '12'] }),
        marc({ id: '9990000302', title: 'Der Schimmelreiter', author: 'Storm, Theodor', isbn: d, publisher: 'BoD - Books on Demand', year: 2021 }),
        marc({ id: '9990000303', title: 'Der Schimmelreiter', sub: 'Novelle', author: 'Storm, Theodor', isbn: n, publisher: 'Kieselstein Verlag', year: 2006 })],
      pick: DNBC(n),
    };
  },
  'Michael Kohlhaas': () => {
    const a = isbnOf('kohlhaas');
    return { dnb: [marc({ id: '9990000401', title: 'Michael Kohlhaas', sub: 'aus einer alten Chronik', author: 'Kleist, Heinrich von', isbn: a, publisher: 'Lindenhof Verlag', year: 2011 })], pick: DNBC(a) };
  },
  'Lotta Haldenbruck und die Glocke von Nebelstein': () => {
    const a = isbnOf('lotta-3'), b = isbnOf('lotta-3-tb');
    return {
      dnb: [marc({ id: '9990000501', title: 'Lotta Haldenbruck und die Glocke von Nebelstein', author: 'Brandhuber, Ilse', isbn: a, publisher: 'Kieselstein Verlag', year: 2001, series: ['\u0098Die\u009c Lotta-Haldenbruck-Reihe ;', '3'] }),
        marc({ id: '9990000502', title: 'Lotta Haldenbruck und die Glocke von Nebelstein', author: 'Brandhuber, Ilse', isbn: b, publisher: 'Kieselstein Verlag', year: 2007, series830: ['Lotta Haldenbruck', '3'] })],
      pick: DNBC(a),
    };
  },
  'Die Gezeiten von Morland Band 2 Die stille Bucht': () => ({
    dnb: [marc({ id: '9990000601', title: 'Die Gezeiten von Morland', n: 'Band 1', p: 'Das graue Ufer', author: 'Wieseneck, Konrad', isbn: isbnOf('morland-1'), publisher: 'Lindenhof Verlag', year: 2014 }),
      marc({ id: '9990000602', title: 'Die Gezeiten von Morland', n: 'Band 3', p: 'Brennende Flut', author: 'Wieseneck, Konrad', isbn: isbnOf('morland-3'), publisher: 'Lindenhof Verlag', year: 2018 })],
    ol: [olWork({ id: 202, title: 'Die Gezeiten von Morland, Band 2: Die stille Bucht', authors: ['Konrad Wieseneck'], cover: 7100203, langs: ['ger'], year: 2016 })],
    pick: OLC(7100203),
  }),
  'Der grüne Heinrich': () => {
    const a = isbnOf('gruene-1'), b = isbnOf('gruene-2');
    return {
      dnb: [marc({ id: '9990000701', title: '\u0098Der\u009c grüne Heinrich', sub: 'Roman', author: 'Keller, Gottfried', isbn: a, publisher: 'Lindenhof Verlag', year: 2015 }),
        marc({ id: '9990000702', title: '\u0098Der\u009c grüne Heinrich', sub: 'Roman', author: 'Keller, Gottfried', isbn: b, publisher: 'Kieselstein Verlag', year: 2003 })],
      images: { [DNBC(a)]: null, [DNBC(b)]: null }, amazon: [a, b], pick: AMZ(a),
    };
  },
  'Das Fräulein von Scuderi': () => {
    const a = isbnOf('scuderi');
    return { dnb: [marc({ id: '9990000801', title: '\u0098Das\u009c Fräulein von Scuderi', sub: 'Erzählung aus dem Zeitalter Ludwig des Vierzehnten', author: 'Hoffmann, E. T. A.', isbn: a, publisher: 'Lindenhof Verlag', year: 2009 })], pick: DNBC(a) };
  },
  Woyzeck: () => {
    const a = isbnOf('woyzeck-1'), b = isbnOf('woyzeck-2'), k = isbnOf('woyzeck-klett');
    return {
      dnb: [marc({ id: '9990000901', title: 'Woyzeck', author: 'Büchner, Georg', isbn: a, publisher: 'Lindenhof Verlag', year: 2015 }),
        marc({ id: '9990000902', title: 'Woyzeck', author: 'Büchner, Georg', isbn: k, publisher: 'Ernst Klett Verlag', year: 2017, series: ['Klett Lektüre ;', '7'] }),
        marc({ id: '9990000903', title: 'Woyzeck', author: 'Büchner, Georg', isbn: b, publisher: 'Kieselstein Verlag', year: 2003 }),
        marc({ id: '9990000904', title: 'Woyzeck', sub: 'Hörspiel', author: 'Büchner, Georg', publisher: 'Hörverlag Elster', year: 2010, audio: true })],
      gr: [grBook({ id: 59000201, title: 'Woyzeck', author: 'Georg Büchner' }), grBook({ id: 59000202, title: 'Woyzeck und andere Dramen', author: 'Georg Büchner' })],
      ol: [olWork({ id: 203, title: 'Woyzeck', authors: ['Georg Büchner'], cover: 7100204, langs: ['ger'], year: 1879 })],
      pick: DNBC(a),
    };
  },
  'Effi Briest': () => {
    const k = isbnOf('effi-klett'), a = isbnOf('effi');
    return {
      dnb: [marc({ id: '9990001001', title: 'Effi Briest', sub: 'Roman. Mit Materialien', author: 'Fontane, Theodor', isbn: k, publisher: 'Ernst Klett Verlag', year: 2019 }),
        marc({ id: '9990001002', title: 'Effi Briest', sub: 'Roman', author: 'Fontane, Theodor', isbn: a, publisher: 'Lindenhof Verlag', year: 2010 })],
      pick: DNBC(a),
    };
  },
  Immensee: () => {
    const k = isbnOf('immensee-klett'), a = isbnOf('immensee');
    const gr = grBook({ id: 59000301, title: 'Immensee', author: 'Theodor  Storm' });
    return {
      dnb: [marc({ id: '9990001101', title: 'Immensee', author: 'Storm, Theodor', isbn: k, publisher: 'Ernst Klett Verlag', year: 2016, series: ['Klett Lektüre ;', '3'] }),
        marc({ id: '9990001102', title: 'Immensee', sub: 'Novelle', author: 'Storm, Theodor', isbn: a, publisher: 'Kieselstein Verlag', year: 2005 })],
      gr: [gr, grBook({ id: 59000302, title: 'Immensee und andere Novellen', author: 'Theodor Storm' })],
      pick: DNBC(a),
    };
  },
  'Der Proceß': () => {
    const d = isbnOf('process-bod'), a = isbnOf('process');
    return {
      dnb: [marc({ id: '9990001201', title: '\u0098Der\u009c Proceß', sub: 'Roman', author: 'Kafka, Franz', isbn: d, publisher: 'BoD - Books on Demand', year: 2012 }),
        marc({ id: '9990001202', title: '\u0098Der\u009c Proceß', author: 'Kafka, Franz', isbn: a, publisher: 'Kieselstein Verlag', year: 1990 }),
        marc({ id: '9990001203', title: '\u0098Der\u009c Proceß', author: 'Kafka, Franz', publisher: 'Hörverlag Elster', year: 2008, audio: true }),
        marc({ id: '9990001204', title: '\u0098Der\u009c Proceß', sub: 'Roman', author: 'Kafka, Franz', isbn: isbnOf('process-ebook'), publisher: 'Lindenhof Verlag', year: 2014, online: true })],
      pick: DNBC(a),
    };
  },
  'Faust. Der Tragödie erster Teil': () => {
    const k = isbnOf('faust-klett'), a = isbnOf('faust-1');
    return {
      dnb: [marc({ id: '9990001301', title: 'Faust', sub: 'der Tragödie erster Teil ; Textausgabe mit Materialien', author: 'Goethe, Johann Wolfgang von', isbn: k, publisher: 'Ernst Klett Verlag', year: 2020 }),
        marc({ id: '9990001302', title: 'Faust', sub: 'der Tragödie zweiter Teil', author: 'Goethe, Johann Wolfgang von', isbn: isbnOf('faust-2'), publisher: 'Lindenhof Verlag', year: 2011 }),
        marc({ id: '9990001303', title: 'Faust', sub: 'der Tragödie erster Teil', author: 'Goethe, Johann Wolfgang von', isbn: a, publisher: 'Lindenhof Verlag', year: 2011 })],
      pick: DNBC(a),
    };
  },
  'Der Hofmeister': () => {
    const a = isbnOf('hofmeister');
    return { dnb: [marc({ id: '9990001401', title: '\u0098Der\u009c Hofmeister', sub: 'oder Vorteile der Privaterziehung ; eine Komödie', author: 'Lenz, Jakob Michael Reinhold', isbn: a, publisher: 'Lindenhof Verlag', year: 2013 })], pick: DNBC(a) };
  },
  'Gespräche mit Goethe in den letzten Jahren seines': () => {
    const a = isbnOf('eckermann-1'), b = isbnOf('eckermann-2');
    // the file name is cut off ("… seines"): the catalogues' main title starts it, the rest is their subtitle
    const gr = grBook({ id: 59000401, title: 'Gespräche mit Goethe: in den letzten Jahren seines Lebens', author: 'Johann Peter Eckermann' });
    return {
      dnb: [marc({ id: '9990001501', title: 'Gespräche mit Goethe', sub: 'in den letzten Jahren seines Lebens', author: 'Eckermann, Johann Peter', isbn: a, publisher: 'Lindenhof Verlag', year: 2011 }),
        marc({ id: '9990001502', title: 'Gespräche mit Goethe', sub: 'in den letzten Jahren seines Lebens', author: 'Eckermann, Johann Peter', isbn: b, publisher: 'Kieselstein Verlag', year: 1999 })],
      ol: [olWork({ id: 204, title: 'Gespräche mit Goethe', subtitle: 'in den letzten Jahren seines Lebens', authors: ['Johann Peter Eckermann'], cover: 7100205, langs: ['ger'], year: 1836 })],
      gr: [gr], images: { [S.goodreadsImage(gr.imageUrl, 300)]: img(200, 300) }, amazon: [a], pick: DNBC(a),
    };
  },
  'Peter Schlemihls wundersame Geschichte': () => {
    const a = isbnOf('schlemihl');
    return { dnb: [marc({ id: '9990001601', title: 'Peter Schlemihls wundersame Geschichte', author: 'Chamisso, Adelbert von', isbn: a, publisher: 'Lindenhof Verlag', year: 2010 })], pick: DNBC(a) };
  },
  'Kabale und Liebe. Ein bürgerliches Trauerspiel': () => {
    const a = isbnOf('kabale');
    return { dnb: [marc({ id: '9990001701', title: 'Kabale und Liebe', sub: 'ein bürgerliches Trauerspiel', author: 'Schiller, Friedrich', isbn: a, publisher: 'Lindenhof Verlag', year: 2013 })], pick: DNBC(a) };
  },
  'Der arme Spielmann': () => {
    const e = '9783997985857';
    // the DNB does not know the number, Open Library has the edition: Amazon's picture of it
    return {
      ol: [olWork({ id: 205, title: '\u0098Der\u009c arme Spielmann', authors: ['Franz Grillparzer'], langs: ['ger'], year: 1848, edition: { title: 'Der arme Spielmann', isbn: e, lang: 'ger', publisher: 'Lindenhof Verlag', year: 2014 } })],
      byIsbn: { ol: [e] }, amazon: [e], pick: AMZ(e),
    };
  },
  'Die Gezeiten von Morland 3. Brennende Flut (example.org)': () => {
    const a = isbnOf('morland-3');
    return {
      dnb: [marc({ id: '9990000602', title: 'Die Gezeiten von Morland', n: '3', p: 'Brennende Flut', author: 'Wieseneck, Konrad', isbn: a, publisher: 'Lindenhof Verlag', year: 2018, series: ['Die Gezeiten von Morland ;', '3'] })],
      pick: DNBC(a),
    };
  },
  'Die vergessene Kartografie der Nebelinseln': () => ({
    dnb: [marc({ id: '9990001801', title: 'Kartografie der Inseln', sub: 'eine Einführung', author: 'Ostermann, Lieselotte', isbn: isbnOf('karto'), publisher: 'Lindenhof Verlag', year: 2017 })],
    pick: null,
  }),
  Strategie: () => ({
    dnb: [marc({ id: '9990001901', title: 'Strategie', sub: 'Grundlagen der Unternehmensführung', author: 'Keller, Anna', isbn: isbnOf('strategie-1'), publisher: 'Lindenhof Verlag', year: 2016 }),
      marc({ id: '9990001902', title: 'Strategie', author: 'Brandt, Peter', isbn: isbnOf('strategie-2'), publisher: 'Kieselstein Verlag', year: 2009 })],
    ol: [olWork({ id: 206, title: 'Strategie', authors: ['Ottilie Vane'], cover: 7100206, langs: ['ger'], year: 2001 })],
    pick: null,
  }),
  Gartenbau: () => {
    const gr = grBook({ id: 59000501, title: 'Gartenbau', author: 'Lieselotte Ostermann' });
    return {
      ol: [olWork({ id: 207, title: 'Gartenbau', authors: ['Lieselotte Ostermann'], cover: 7100207, langs: ['ger'], year: 1987 })], gr: [gr],
      images: { [OLC(7100207)]: img(333, 500, { pic: 'gartenbau' }), [grFull(gr)]: img(400, 600, { pic: 'gartenbau' }) }, pick: grFull(gr),
    };
  },
};

/** The questions the lookup can ask about a book (web-covers.js lookup), each as { by, q } with the URL of every catalogue. */
function questionsOf(book) {
  const k = BM.bookKey(book);
  const surname = k.surnames[0] ? (BM.personName(BM.splitNames(k.author)[0] || '').split(/\s+/).pop() || '') : '';
  const out = [];
  if (k.isbns.length) out.push({ by: 'isbn', q: { isbn: k.isbns[0], isbns: k.isbns, lang: k.qlang } });
  for (const t of BM.queriesFor(k)) out.push({ by: 'title', q: { title: t.title, author: surname, lang: k.qlang } });
  return out.map(({ by, q }) => ({
    by, q,
    urls: {
      openlibrary: S.olUrl({ title: q.title, author: q.author, lang: q.lang, isbn: q.isbn }),
      goodreads: S.goodreadsUrl(q),
      apple: S.appleUrl({ title: q.title, author: q.author, lang: q.lang, isbns: q.isbns }),
      dnb: S.dnbUrl({ title: q.title, author: q.author, isbn: q.isbn }),
      archive: S.archiveUrl({ title: q.title, author: q.author, isbn: q.isbn }),
      google: S.googleUrl({ title: q.title, author: q.author, lang: by === 'title' ? k.lang : q.lang, isbn: q.isbn }),
    },
  }));
}
const json = (o, type = 'application/json') => ({ status: 200, ok: true, contentType: type, text: JSON.stringify(o) });
const QUOTA = { status: 429, ok: false, contentType: 'application/json; charset=UTF-8', text: JSON.stringify({ error: { code: 429, message: 'Quota exceeded for quota metric Queries and limit Queries per day', status: 'RESOURCE_EXHAUSTED' } }) };
const GIF = { status: 200, ok: true, contentType: 'image/gif', image: { w: 1, h: 1, framed: false, weak: 'uniform', aspect: 1, boxHeight: 1 } };
const NOT_FOUND = { status: 404, ok: false, contentType: 'text/html', text: '' };

/** Every answer about one sample book: the catalogues for each question, the pictures of every record, Amazon's. */
function answersOfBook(book, w) {
  const res = {};
  const isbns = new Set();
  const hasIsbn = (isbn, list) => (list || []).includes(isbn);
  for (const qu of questionsOf(book)) {
    const isbnQ = qu.by === 'isbn' ? qu.q.isbn : null;
    const known = (src, recIsbns) => !isbnQ || hasIsbn(isbnQ, w.byIsbn?.[src]) || (recIsbns || []).includes(isbnQ);
    const ol = (w.ol || []).filter((d) => known('ol', d.editions.docs.flatMap((e) => e.isbn || [])));
    res[qu.urls.openlibrary] = json({ numFound: ol.length, start: 0, numFoundExact: true, docs: ol });
    const gr = isbnQ ? [] : w.gr || [];
    res[qu.urls.goodreads] = json(gr, 'application/json; charset=utf-8');
    const ap = (w.apple || []).filter((a) => !isbnQ || a.artworkUrl100.includes(isbnQ));
    res[qu.urls.apple] = json({ resultCount: ap.length, results: ap }, 'text/javascript; charset=utf-8');
    const dnb = (w.dnb || []).filter((m) => known('dnb', [isbnOfMarc(m)]));
    res[qu.urls.dnb] = { status: 200, ok: true, contentType: 'text/xml;charset=UTF-8', text: dnbAnswer(dnb) };
    const ia = (w.ia || []).filter((d) => known('ia', d.isbn));
    res[qu.urls.archive] = json({ response: { numFound: ia.length, docs: ia } });
    res[qu.urls.google] = QUOTA;
  }
  // the pictures of every record, the ISBNs for Amazon
  const pics = [];
  for (const d of w.ol || []) {
    if (d.cover_i) pics.push(['openlibrary', OLC(d.cover_i)]);
    for (const e of d.editions.docs) { if (e.cover_i) pics.push(['openlibrary', OLC(e.cover_i)]); for (const i of e.isbn || []) if (BM.isbn13(i)) isbns.add(BM.isbn13(i)); }
  }
  for (const a of w.apple || []) { pics.push(['apple', appleArtUrl(a, 900)]); const i = /\/(97[89]\d{10})\.jpg/.exec(a.artworkUrl100); if (i) isbns.add(i[1]); }
  for (const g of w.gr || []) if (grFull(g)) pics.push(['goodreads', grFull(g)]);
  for (const m of w.dnb || []) { const i = isbnOfMarc(m); if (i) { pics.push(['dnb', DNBC(i)]); isbns.add(i); } }
  for (const d of w.ia || []) { pics.push(['archive', S.archiveCover(d.identifier).url]); for (const i of d.isbn || []) if (BM.isbn13(i)) isbns.add(BM.isbn13(i)); }
  for (const [src, url] of pics) {
    const given = w.images && url in w.images ? w.images[url] : undefined;
    if (given === null) res[url] = NOT_FOUND;
    else res[url] = { status: 200, ok: true, contentType: 'image/jpeg', image: given || img(...SIZE[src]) };
  }
  for (const [url, v] of Object.entries(w.images || {})) if (!(url in res)) res[url] = v === null ? NOT_FOUND : { status: 200, ok: true, contentType: 'image/jpeg', image: v };
  for (const i of isbns) {
    const url = AMZ(i);
    if (!url || url in res) continue;
    res[url] = (w.amazon || []).includes(i) ? { status: 200, ok: true, contentType: 'image/jpeg', image: img(...SIZE.amazon) } : GIF;
  }
  return res;
}

function sources() {
  const books = [];
  for (const s of SAMPLE) {
    const make = WORLD[s.book.title];
    if (!make) throw new Error('no world for the sample book ' + s.book.title);
    const w = make();
    books.push({ book: s.book, pick: w.pick, responses: answersOfBook(s.book, w) });
  }
  for (const t of Object.keys(WORLD)) if (!SAMPLE.some((s) => s.book.title === t)) throw new Error('a world without a sample book: ' + t);
  return { recorded: 'synthetic', note: NOTE, books };
}

// ---------------------------------------------------------------- image search engines --------------------------------
/**
 * One made-up search result: `art` names the picture (results with the same art show the same cover, `copy` makes them
 * differ a little), `kind` what the picture is (cover, photo, banner, portrait, product: the cover on a white square,
 * text, blank), `site`, `title` of the page, `w` × `h` of the original picture.
 */
function drawResult(r, i) {
  const art = coverArt(r.art || 'other ' + r.site + i);
  const seed = `${r.site}-${i}`;
  switch (r.kind || 'cover') {
    case 'photo': return photoOf(art, seed);
    case 'banner': return banner(seed);
    case 'portrait': return portrait(seed);
    case 'product': return copyOf(art, { w: 100, h: 150, noise: 4, square: true, seed });
    case 'text': return textPage(seed);
    case 'blank': return picture(120, 180, [244, 244, 244]);
    case 'wide': return copyOf(art, { w: 192, h: 120, noise: 4, seed });
    default: return copyOf(art, { w: 120, h: 180, noise: r.noise ?? 5, sticker: !!r.sticker, seed });
  }
}
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

/** The results of one engine's search, with their thumbnails as the engine's cache sends them. */
function engineResults(name, list) {
  return list.map((r, i) => {
    const pic = drawResult(r, i);
    const w = r.w || 600, h = r.h || Math.round((w * pic.h) / pic.w);
    const id = token(`${name} ${i} ${r.site}`, 26);
    return { ...r, i, pic, w, h, id, page: r.page || `https://www.${r.site}/${slug(r.title)}/${num(name + i, 90000) + 10000}`, image: r.image || `https://img.${r.site}/covers/${slug(r.title).slice(0, 24)}-${i}.jpg` };
  });
}
const htmlEsc = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const bingTurl = (x) => `https://ts${(x.i % 4) + 1}.mm.bing.net/th?id=OIP.${x.id}&pid=15.1`;
const bingHtml = (results) => '<!doctype html><ul class="dgControl_list">' + results.map((x) => `<li><a class="iusc" m="${htmlEsc(JSON.stringify({ purl: x.page, murl: x.image, turl: bingTurl(x), t: x.title }))}" href="#"></a><div class="img_info"><span class="nowrap">${x.w}&#215;${x.h}</span></div></li>`).join('') + '</ul>';
const yandexThumb = (x) => `//avatars.mds.yandex.net/i?id=${x.id.toLowerCase()}-${num(x.id, 9e6)}-images-thumbs&n=13`;
function yandexHtml(results) {
  const ents = {};
  results.forEach((x, i) => { ents['e' + i] = { pos: i, image: yandexThumb(x), alt: x.title, origWidth: x.w, origHeight: x.h, origUrl: x.image, snippet: { title: x.title, url: x.page } }; });
  return `<!doctype html><div data-state="${htmlEsc(JSON.stringify({ initialState: { serpList: { items: { entities: ents } } } }))}"></div>`;
}
const ddgThumb = (x) => `https://tse${(x.i % 4) + 1}.mm.bing.net/th/id/OIP.${x.id}?pid=Api`;
/** web-covers.js smallThumb: Bing's thumbnails in 300 px for the comparison. */
const smallThumb = (u) => (/^https:\/\/tse\d*\.(mm|explicit)\.bing\.net\/th/i.test(u) && !/[?&]h=\d/.test(u) ? u + (u.includes('?') ? '&' : '?') + 'h=300' : u);
/** A thumbnail as an answer in the height asked for: its size, what the decoder sees, the 16 × 16 colours. */
function thumbAt(x, height) {
  const l = look(x.pic, height);
  const k = Math.min(1, height / x.h);
  const h = Math.round(x.h * k);
  return { status: 200, ok: true, contentType: 'image/jpeg', image: { w: Math.round(x.w * k), h, framed: l.framed, weak: l.weak, aspect: l.aspect, boxHeight: Math.round((l.boxHeight / height) * h), g16: g16(l.grid) } };
}

// the made-up searches of the engines about sample books (`want`: cover-sample.js web)
const SHOP = (n) => ['buchhandlung-eins.example', 'verlag-zwei.example', 'buchladen-drei.example', 'buchladen-vier.example', 'lantern-books.example', 'leseecke.example', 'antiquariat-fuenf.example'][n];
const nameOf = (b) => `${M.coverQuery(b).title} von ${M.firstAuthor(b.author)}`;
const ENGINE_SAMPLES = {
  bing: {
    "The Beekeeper's First Workbook Practical Exercises and": (b) => [
      { art: 'bee-a', site: SHOP(0), title: "The Beekeeper's First Workbook - Buch" }, { art: 'bee-b', site: 'imkerforum.example', title: 'Workbooks for beekeepers: our five favourites', kind: 'photo', w: 1200, h: 900 },
      { art: 'bee-c', site: SHOP(3), title: 'A Beekeeping Workbook for Schools' }, { site: 'imkerblog.example', title: 'Spring at the hives', kind: 'banner', w: 1600, h: 800 },
      { art: 'bee-d', site: SHOP(1), title: "The Beekeeper's Second Workbook" }, { site: 'imkerforum.example', title: 'Our beekeeper of the month', kind: 'portrait', w: 600, h: 800 },
    ],
    'Frankenstein: or, The Modern Prometheus': (b) => [
      { art: 'frank-film', site: 'filmarchiv.example', title: 'Frankenstein (film poster, 1931)', w: 800, h: 1200 },
      { art: 'frank', site: SHOP(4), title: 'Frankenstein - Mary Shelley - Lantern Classics', w: 900, h: 1350 },
      { art: 'frank-other', site: SHOP(6), title: 'Frankenstein by Mary Shelley, an old paperback', kind: 'photo', w: 1200, h: 900 },
      { art: 'frank', site: SHOP(0), title: 'Frankenstein von Mary Shelley - Buch', w: 400, h: 600, sticker: true },
      { site: 'gothic-blog.example', title: 'Ten gothic novels for a long night', kind: 'banner', w: 1600, h: 900 },
      { art: 'frank', site: 'bookshelf-blog.example', title: 'What I read in October', kind: 'product', w: 700, h: 700 },
      { art: 'frank-comic', site: SHOP(2), title: 'Frankenstein: the graphic novel', w: 600, h: 900 },
    ],
    'Die Leiden des jungen Werthers': (b) => [
      { art: 'werther', site: SHOP(0), title: nameOf(b) + ' - Buch', w: 791, h: 1200 },
      { site: 'feuilleton.example', title: 'Briefromane, die man kennen sollte', kind: 'banner', w: 1100, h: 619 },
      { art: 'werther-old', site: SHOP(6), title: 'Die Leiden des jungen Werthers, Erstausgabe 1774', kind: 'photo', w: 1000, h: 750 },
      { art: 'werther', site: SHOP(1), title: 'Die Leiden des jungen Werthers | Lindenhof Verlag', w: 920, h: 1400, noise: 8 },
      { art: 'werther-school', site: SHOP(3), title: 'Die Leiden des jungen Werthers. Textausgabe mit Materialien', w: 600, h: 900 },
      { site: 'literaturforum.example', title: 'Goethe in Wetzlar', kind: 'portrait', w: 600, h: 800 },
      { art: 'werther', site: 'leserunde.example', title: 'Leserunde: Die Leiden des jungen Werthers', kind: 'product', w: 800, h: 800 },
    ],
    'Maler Nolten': (b) => [
      { art: 'nolten', site: SHOP(1), title: 'Maler Nolten von Eduard Mörike - Buch', w: 640, h: 980 },
      { art: 'nolten-old', site: 'antiquariat-sechs.example', title: 'Mörike, Maler Nolten, zwei Bände 1832', kind: 'photo', w: 1200, h: 900 },
      { site: 'feuilleton.example', title: 'Eduard Mörike zum Geburtstag', kind: 'portrait', w: 600, h: 800 },
      { art: 'nolten-x', site: SHOP(5), title: 'Gedichte von Eduard Mörike', w: 600, h: 900 },
      { site: 'reiseblog.example', title: 'Ein Sommer in Cleversulzbach', kind: 'banner', w: 1400, h: 700 },
    ],
    'Michael Kohlhaas': (b) => [
      { art: 'kohlhaas', site: SHOP(2), title: 'Michael Kohlhaas - Heinrich von Kleist | Buchladen Drei', w: 600, h: 920 },
      { art: 'kohlhaas-film', site: 'filmarchiv.example', title: 'Michael Kohlhaas (Film)', kind: 'banner', w: 1280, h: 720 },
      { art: 'kohlhaas', site: SHOP(3), title: 'Kleist: Michael Kohlhaas, Taschenbuch', w: 1000, h: 1530, noise: 7 },
      { art: 'kohlhaas-school', site: 'lernhilfen.example', title: 'Michael Kohlhaas Zusammenfassung und Analyse', w: 600, h: 900 },
      { site: 'literaturforum.example', title: 'Heinrich von Kleist', kind: 'portrait', w: 600, h: 800 },
      { art: 'kohlhaas', site: SHOP(5), title: 'Michael Kohlhaas', kind: 'product', w: 800, h: 800 },
    ],
    // a designer's poster on two portfolio sites comes first; the shops agree on the edition
    'Der Proceß': (b) => [
      { art: 'process-poster', site: 'behance.net', title: 'Der Prozess - Franz Kafka (poster design)', w: 1200, h: 1700 },
      { art: 'process-poster', site: 'dribbble.com', title: 'Kafka: Der Prozeß, a cover concept', w: 800, h: 1130, noise: 8 },
      { art: 'process', site: SHOP(1), title: 'Der Prozeß. Buch von Franz Kafka', w: 640, h: 1000 },
      { art: 'process-old', site: SHOP(6), title: 'Kafka, Der Process, 1925', kind: 'photo', w: 1000, h: 750 },
      { art: 'process', site: SHOP(0), title: 'Der Prozess - Franz Kafka (Buch)', w: 1000, h: 1560, noise: 7 },
      { site: 'literaturforum.example', title: 'Franz Kafka in Prag', kind: 'portrait', w: 600, h: 800 },
      { art: 'process-audio', site: 'hoerbuch.example', title: 'Der Prozess Hörbuch von Franz Kafka', w: 600, h: 600 },
    ],
    // two summary sites show the picture of their own booklet; one shop page names the book
    'Peter Schlemihls wundersame Geschichte': (b) => [
      { art: 'schlemihl-guide', site: 'zusammenfassungen.example', title: 'Peter Schlemihls wundersame Geschichte Zusammenfassung', w: 600, h: 900 },
      { art: 'schlemihl-guide', site: 'lektuerehilfen.example', title: 'Peter Schlemihl: Analyse und Zusammenfassung von Adelbert von Chamisso', w: 600, h: 900, noise: 7 },
      { art: 'schlemihl', site: SHOP(2), title: 'Peter Schlemihls wundersame Geschichte von Adelbert von Chamisso - Buch', w: 640, h: 980 },
      { site: 'feuilleton.example', title: 'Der Mann ohne Schatten', kind: 'banner', w: 1400, h: 700 },
      { art: 'schlemihl-x', site: SHOP(5), title: 'Chamisso: Gedichte', w: 600, h: 900 },
    ],
    'Die vergessene Kartografie der Nebelinseln': (b) => [
      { art: 'karte-a', site: 'kartenshop.example', title: 'Kartografie: Eine Einführung', w: 600, h: 900 }, { site: 'reiseblog.example', title: 'Nebel über den Inseln', kind: 'banner', w: 1200, h: 700 },
      { art: 'karte-b', site: SHOP(3), title: 'Die Vermessung der Erde', w: 600, h: 900 }, { site: 'reiseblog.example', title: 'Leuchttürme im Nebel', kind: 'photo', w: 1200, h: 900 },
      { art: 'karte-c', site: SHOP(0), title: 'Inseln im Nordmeer - Bildband', w: 900, h: 700 },
    ],
  },
  yandex: {
    "The Beekeeper's First Workbook Practical Exercises and": (b) => [
      { art: 'bee-a', site: SHOP(0), title: "The Beekeeper's First Workbook" }, { art: 'bee-e', site: 'bienenbuecher.example', title: 'Bee workbooks for children', w: 600, h: 900 },
      { site: 'imkerblog.example', title: 'Honey harvest', kind: 'photo', w: 1200, h: 900 }, { art: 'bee-f', site: SHOP(4), title: 'Practical Beekeeping', w: 600, h: 900 },
    ],
    'Pride and Prejudice': (b) => [
      { art: 'pride', site: SHOP(3), title: 'Pride and Prejudice by Jane Austen - Book', w: 800, h: 1240 },
      { art: 'pride-film', site: 'filmarchiv.example', title: 'Pride and Prejudice (2005 film)', kind: 'banner', w: 1280, h: 720 },
      { art: 'pride', site: SHOP(4), title: 'Pride and Prejudice | Jane Austen | Lantern Classics', w: 1000, h: 1550, noise: 7 },
      { site: 'regency-blog.example', title: 'Jane Austen at home', kind: 'portrait', w: 600, h: 800 },
      { art: 'pride-zombies', site: SHOP(6), title: 'Pride and Prejudice, a graphic novel', w: 600, h: 900 },
    ],
    Woyzeck: (b) => [
      { art: 'woyzeck', site: SHOP(3), title: 'Woyzeck von Georg Büchner - Buch', w: 800, h: 1200 },
      { art: 'woyzeck-stage', site: 'theater.example', title: 'Woyzeck am Stadttheater', kind: 'banner', w: 1400, h: 700 },
      { art: 'woyzeck', site: SHOP(1), title: 'Georg Büchner: Woyzeck', w: 1200, h: 1800, noise: 7 },
      { art: 'woyzeck-school', site: 'lernhilfen.example', title: 'Woyzeck Lektürehilfe', w: 600, h: 900 },
    ],
    'Quantum Gardening for Retired Lighthouse Keepers': (b) => [
      { art: 'q-a', site: SHOP(4), title: 'Quantum Physics for Gardeners', w: 600, h: 900 }, { site: 'lighthouse-blog.example', title: 'Lighthouses of the north', kind: 'photo', w: 1200, h: 900 },
      { art: 'q-b', site: SHOP(0), title: 'Gardening by the Sea', w: 600, h: 900 }, { site: 'lighthouse-blog.example', title: 'A keeper retires', kind: 'portrait', w: 600, h: 800 },
    ],
  },
  duckduckgo: {
    "The Beekeeper's First Workbook Practical Exercises and": (b) => [
      { art: 'bee-a', site: SHOP(0), title: "The Beekeeper's First Workbook - Practical Exercises" }, { art: 'bee-g', site: SHOP(1), title: "Beekeeper's Handbook" },
      { site: 'imkerblog.example', title: 'Workbook pages', kind: 'text', w: 600, h: 900 }, { art: 'bee-h', site: 'bienenbuecher.example', title: 'First steps with bees', w: 600, h: 900 },
    ],
    Immensee: (b) => [
      { art: 'immensee', site: SHOP(2), title: 'Immensee von Theodor Storm - Buch', w: 640, h: 990 },
      { art: 'immensee-old', site: 'antiquariat-sechs.example', title: 'Storm, Immensee, 1852', kind: 'photo', w: 1200, h: 900 },
      { art: 'immensee', site: SHOP(5), title: 'Theodor Storm: Immensee. Novelle', w: 800, h: 1240, noise: 7 },
      { site: 'reiseblog.example', title: 'Am See', kind: 'banner', w: 1400, h: 700 },
    ],
  },
};
// what each engine must pick (by design): the art of the winning picture and the site of its first copy to load
const ENGINE_PICK = {
  bing: { 'Frankenstein: or, The Modern Prometheus': 1, 'Die Leiden des jungen Werthers': 0, 'Maler Nolten': 0, 'Michael Kohlhaas': 0, 'Der Proceß': 2, 'Peter Schlemihls wundersame Geschichte': 2 },
  yandex: { 'Pride and Prejudice': 0, Woyzeck: 0 },
  duckduckgo: { Immensee: 0 },
};

/** The answers of one engine's search about a book: the search, every thumbnail (and every picture, for the download). */
function engineSample(engine, s, list) {
  const b = s.book, query = M.coverQuery(b), results = engineResults(engine + ' ' + b.title, list);
  const responses = {};
  if (engine === 'bing') {
    responses[IE.bingUrl(query)] = { status: 200, ok: true, contentType: 'text/html; charset=utf-8', text: bingHtml(results) };
    for (const x of results) for (const hgt of [240, 900]) responses[IE.bingThumb(bingTurl(x), hgt)] = thumbAt(x, hgt);
  } else if (engine === 'yandex') {
    responses[IE.yandexUrl(query)] = { status: 200, ok: true, contentType: 'text/html; charset=utf-8', text: yandexHtml(results) };
    for (const x of results) { responses['https:' + yandexThumb(x)] = thumbAt(x, 320); responses[proxied(x.image)] = thumbAt(x, Math.min(x.h, 1800)); }
  } else {
    responses['https://duckduckgo.com/?' + new URLSearchParams({ q: query.q, iax: 'images', ia: 'images', kp: '1', kl: query.region })] = { status: 200, ok: true, contentType: 'text/html; charset=utf-8', text: '<html><script>vqd="4-0"</script></html>' };
    const js = { results: results.map((x) => ({ title: x.title, url: x.page, image: x.image, thumbnail: ddgThumb(x), width: x.w, height: x.h })) };
    responses['https://duckduckgo.com/i.js?' + new URLSearchParams({ l: query.region, o: 'json', q: query.q, vqd: '4-0', f: ',,,,,', p: '1', kp: '1' })] = { status: 200, ok: true, contentType: 'application/json', text: JSON.stringify(js) };
    for (const x of results) { responses[proxied(smallThumb(ddgThumb(x)))] = thumbAt(x, 300); responses[proxied(x.image)] = thumbAt(x, Math.min(x.h, 1800)); }
  }
  const at = ENGINE_PICK[engine]?.[b.title];
  return { engine, book: b, pick: at == null ? null : results[at].image, responses };
}

/** Bing's and Yandex's answer for the parsers: 24 results about one book. */
function parseAnswers() {
  const b = { title: 'Die Leiden des jungen Werthers', author: 'Johann Wolfgang von Goethe', language: 'de' };
  const list = Array.from({ length: 24 }, (_, i) => {
    const kinds = ['cover', 'cover', 'photo', 'cover', 'banner', 'portrait', 'cover', 'product'];
    const kind = kinds[i % kinds.length];
    const site = [SHOP(0), SHOP(1), 'feuilleton.example', SHOP(3), 'literaturforum.example', 'leserunde.example'][i % 6];
    const title = i % 3 === 0 ? `Die Leiden des jungen Werthers von Johann Wolfgang von Goethe - Buch` : i % 3 === 1 ? `Goethe: Werther, Ausgabe ${2000 + i}` : `Briefromane & Co. | Teil ${i}`;
    return { art: 'werther-' + (i % 5), site, title, kind, w: kind === 'banner' ? 1200 : 600 + i * 10, h: kind === 'banner' ? 675 : 900 + i * 15 };
  });
  return { bing: { status: 200, html: bingHtml(engineResults('parse bing', list)) }, yandex: { status: 200, html: yandexHtml(engineResults('parse yandex', list)) } };
}

function engines() {
  const samples = [];
  for (const engine of IE.ENGINES) {
    for (const [title, make] of Object.entries(ENGINE_SAMPLES[engine])) {
      const s = SAMPLE.find((x) => x.book.title === title);
      if (!s) throw new Error('an engine sample without a sample book: ' + title);
      samples.push(engineSample(engine, s, make(s.book)));
    }
  }
  return {
    recorded: 'synthetic', note: NOTE, ...parseAnswers(),
    // engines that want a human: a captcha page, a redirect to a captcha, a challenge script, a proof-of-work page
    challenges: {
      brave: { status: 429, html: '<!doctype html><html><head><title>Captcha - Search</title></head><body><div id="captcha"></div><script>/* captcha */</script></body></html>' },
      qwant: { status: 403, html: '{"url":"https://captcha.example/interstitial/?initialCid=x&hash=x"}' },
      ecosia: { status: 403, html: '<!doctype html><html><head><title>Just a moment...</title></head><body><div id="challenge-error-text"></div><script>window._cf_chl_opt={}; /* challenge */</script></body></html>' },
      startpage: { status: 200, html: '<!doctype html><html lang="en"><head><script id="anubis_challenge" type="application/json">{"rules":{"algorithm":"fast","difficulty":4}}</script></head><body></body></html>' },
    },
    samples,
  };
}

// ---------------------------------------------------------------- DuckDuckGo searches (test-covers.js) ---------------
// Each search: 20 results; `group`: the ranks that show the winning picture, `single`: the one shop page that names the
// book. The other results show other pictures (other editions, photos, banners, portraits, a few placeholders).
const SEARCHES = [
  { slug: 'shelley-en', book: { title: 'Frankenstein', author: 'Mary Shelley', language: 'en' }, expect: { group: [1, 2], confidence: 'cluster' },
    special: { 1: { site: 'bookshelf-blog.example', title: 'Frankenstein by Mary Shelley: my copy', h: 1920, w: 1280 }, 2: { site: 'lantern-books.example', title: 'Frankenstein - Mary Shelley - Lantern Classics', h: 960, w: 640, image: 'https://img.lantern-books.example/covers/frankenstein-lantern-960.jpg' } } },
  { slug: 'werther-de', book: { title: 'Die Leiden des jungen Werthers', author: 'Johann Wolfgang von Goethe', language: 'de' }, expect: { group: [0, 1, 15, 18], confidence: 'cluster' } },
  { slug: 'keller-de', book: { title: 'Der grüne Heinrich', author: 'Gottfried Keller', language: 'de' }, expect: { group: [1, 13, 16], confidence: 'cluster' } },
  { slug: 'schiller-de', book: { title: 'Kabale und Liebe', author: 'Friedrich Schiller', language: 'de' }, expect: { group: [3, 6, 18], confidence: 'cluster' }, special: { 0: { site: SHOP(0), kind: 'cover', title: 'Kabale und Liebe, eine andere Ausgabe' } } },
  { slug: 'storm-de', book: { title: 'Der Schimmelreiter', author: 'Theodor Storm', language: 'de' }, expect: { group: [0, 4, 5], confidence: 'cluster' }, special: { 0: { site: 'leseecke.example', h: 900, w: 600 }, 4: { h: 1500, w: 1000 }, 5: { h: 640, w: 420 } } },
  { slug: 'austen-en', book: { title: 'Pride and Prejudice', author: 'Jane Austen', language: 'en' }, expect: { single: 0, confidence: 'single' } },
  { slug: 'dufresne-de', book: { title: 'Kleines Lehrbuch des Schachspiels', author: 'Jean Dufresne', language: 'de' }, expect: { single: 0, confidence: 'single' } },
  { slug: 'fake1-de', book: { title: 'Die vergessene Kartografie der Nebelinseln', author: 'Hartmut Quellbrunn', language: 'de' }, expect: null },
];
const OTHER_TITLES = {
  de: ['Romane des 19. Jahrhunderts im Überblick', 'Leseliste für den Herbst', 'Klassiker neu gelesen', 'Bücher für lange Abende', 'Ein Spaziergang durch die Altstadt', 'Das Lesezimmer', 'Neuerscheinungen im März', 'Poster und Drucke', 'Unsere Lieblingsausgaben', 'Lesekreis am Donnerstag'],
  en: ['Classic novels for a rainy weekend', 'Our reading list', 'The reading room', 'Posters and prints', 'New this month', 'A walk through the old town', 'Book club picks', 'Bookshop of the week', 'Library sale', 'Rare editions'],
};
const OTHER_SITES = ['buchblog.example', 'feuilleton.example', 'leserunde.example', 'reiseblog.example', 'kleinanzeigen.de', 'antiquariat-sechs.example', 'poster-shop.example', 'literaturforum.example', 'alamy.de', 'stadtbibliothek.example'];
const KINDS = ['cover', 'photo', 'banner', 'portrait', 'cover', 'product', 'cover', 'text', 'blank', 'cover'];
function searchFixture(s, si) {
  const words = s.book.language === 'en' ? 'by' : 'von';
  const results = [], analysed = [], grids = [];
  for (let rank = 0; rank < 20; rank++) {
    const inGroup = s.expect?.group?.includes(rank), single = s.expect?.single === rank;
    const sp = s.special?.[rank] || {};
    let site, title, kind, art, w, h;
    if (inGroup || single) {
      kind = inGroup && rank === s.expect.group[s.expect.group.length - 1] && s.expect.group.length > 2 ? 'product' : 'cover';
      art = s.slug;
      site = sp.site || SHOP((rank + si) % 7);
      title = sp.title || (rank % 2 ? `${s.book.title} ${words} ${s.book.author} - Buch` : `${s.book.title} | ${s.book.author} | Taschenbuch`);
      w = sp.w || 600 + rank * 20; h = sp.h || Math.round(w * 1.5);
    } else {
      kind = sp.kind || (s.slug === 'fake1-de' && rank < 3 ? 'cover' : KINDS[(rank + si) % KINDS.length]);
      art = `${s.slug} other ${rank}`;
      site = sp.site || OTHER_SITES[(rank + si * 3) % OTHER_SITES.length];
      if (kind === 'cover' && s.slug !== 'fake1-de' && rank % 3 === 0) { site = sp.site || SHOP((rank + 3) % 7); title = sp.title || (s.book.language === 'en' ? `Another edition of a classic` : `Eine andere Ausgabe`); }
      else title = sp.title || OTHER_TITLES[s.book.language === 'en' ? 'en' : 'de'][(rank + si) % 10];
      w = kind === 'banner' ? 1600 : kind === 'product' ? 800 : 600 + rank * 10; h = kind === 'banner' ? 800 : kind === 'product' ? 800 : kind === 'photo' ? Math.round(w * 0.75) : Math.round(w * 1.5);
    }
    const pic = drawResult({ art, site, kind, noise: 5 + (rank % 3) }, rank + si * 20);
    const l = look(pic, h);
    const id = token(`ddg ${s.slug} ${rank}`, 26);
    const r = { rank, title, url: `https://www.${site}/${slug(title)}/${num(s.slug + rank, 90000) + 10000}`, image: sp.image || (site === 'alamy.de' ? `https://c8.alamy.com/comp/${id.slice(0, 7).toUpperCase()}/book.jpg` : kind === 'blank' ? `https://img.${site}/no_image_available.png` : `https://img.${site}/covers/${slug(s.book.title).slice(0, 24)}-${rank}.jpg`), thumbnail: `https://tse${(rank % 4) + 1}.mm.bing.net/th/id/OIP.${id}?pid=Api`, width: w, height: h };
    results.push(r);
    // the thumbnail is analysed in the height DuckDuckGo's proxy sends (at most 474 px)
    analysed.push({ rank, aspect: l.aspect, boxHeight: look(pic, Math.min(h, 474)).boxHeight });
    grids.push(l.grid);
  }
  return { search: { slug: s.slug, book: s.book, results, analysed, expect: s.expect }, grids };
}
/** A PNG of 8-bit RGB rows (filter 0). */
function png(w, h, rgb) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type, 'latin1'), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body)); return Buffer.concat([len, body, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function searches() {
  const N = 32, out = [], rows = [];
  SEARCHES.forEach((s, si) => { const f = searchFixture(s, si); out.push(f.search); rows.push(f.grids); });
  const W = 20 * N, H = rows.length * N, rgb = Buffer.alloc(W * H * 3);
  rows.forEach((grids, row) => grids.forEach((g, col) => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) for (let c = 0; c < 3; c++) rgb[((row * N + y) * W + col * N + x) * 3 + c] = g[(y * N + x) * 3 + c]; }));
  const note = NOTE + ' DuckDuckGo image searches of 20 results each; thumbnails.png holds the analysed thumbnails as 32 x 32 grids: one row per search, one column per entry of "analysed".';
  return { json: { note, grid: N, searches: out }, png: png(W, H, rgb), rows };
}

// ---------------------------------------------------------------- checks and output -----------------------------------
/** The designed picks of the DuckDuckGo searches, by the rules of cover-match.js (a mistake in the design shows here). */
function checkSearches(sr) {
  let bad = 0;
  sr.json.searches.forEach((s, row) => {
    const cands = s.analysed.map((a, col) => { const r = s.results[a.rank]; return { rank: a.rank, site: M.siteOf(r.url), title: r.title, url: r.url, image: r.image, thumbnail: r.thumbnail, width: r.width, height: r.height, aspect: a.aspect, fp: M.fingerprint(sr.rows[row][col], a.aspect) }; });
    const pick = M.pickCover(cands, M.coverQuery(s.book));
    const got = pick ? (pick.confidence === 'cluster' ? 'group ' + pick.group.members.map((m) => m.rank).sort((a, b) => a - b).join(',') : 'single ' + pick.group.members.map((m) => m.rank).join(',')) : 'none';
    const want = !s.expect ? 'none' : s.expect.group ? 'group ' + s.expect.group.join(',') : 'single';
    const ok = want === got || (want === 'single' && pick?.confidence === 'single' && pick.group.members.some((m) => m.rank === s.expect.single));
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'BAD '} search ${s.slug}: ${got} (designed: ${want})`);
  });
  return bad;
}

function main() {
  const src = sources(), eng = engines(), sr = searches();
  const bad = checkSearches(sr);
  if (CHECK) { process.exit(bad ? 1 : 0); }
  if (bad) { console.error('the designed picks do not hold: nothing written'); process.exit(1); }
  const write = (file, buf) => { fs.writeFileSync(path.join(OUT, file), buf); console.log(`${file}: ${Math.round(buf.length / 1024)} KB`); };
  write('sources.json.gz', zlib.gzipSync(JSON.stringify(src), { level: 9 }));
  write('engines.json.gz', zlib.gzipSync(JSON.stringify(eng), { level: 9 }));
  fs.mkdirSync(path.join(OUT, 'covers'), { recursive: true });
  write(path.join('covers', 'searches.json'), Buffer.from(JSON.stringify(sr.json, null, 1)));
  write(path.join('covers', 'thumbnails.png'), sr.png);
}
if (require.main === module) main();
module.exports = { isbnOf, coverArt, look, WORLD, SEARCHES };
