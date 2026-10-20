// Test runs only (COZYSHELVES_COVERS_FIXTURES with COZYSHELVES_COVERS_SYNTH=1): made-up answers of the book catalogues and of
// Bing's image search for the invented titles of a test library, in the formats of the real ones, so that "Alle Cover
// jetzt laden" can go through hundreds of books without any network. Each catalogue knows a share of the titles and has
// a picture of its own for each (a JPEG drawn here): Open Library six in seven, Goodreads five in six, the DNB and Apple
// Books one in two, the Internet Archive one in three; Amazon has a picture for three in four ISBNs (else its 1 × 1
// GIF); Google Books answers like it does without a key ("no quota"). Bing shows the picture of three in four titles on
// two shops' pages (its thumbnails drawn in the height asked for); Yandex and DuckDuckGo are never answered.
'use strict';

const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
function isbnOf(n) {
  const core = '978' + String(100000000 + (n % 900000000)).slice(0, 9);
  let s = 0;
  for (let i = 0; i < 12; i++) s += (i % 2 ? 3 : 1) * +core[i];
  return core + ((10 - (s % 10)) % 10);
}
const json = (o) => ({ ok: true, status: 200, contentType: 'application/json', buffer: Buffer.from(JSON.stringify(o)) });
const html = (t) => ({ ok: true, status: 200, contentType: 'text/html; charset=utf-8', buffer: Buffer.from(t) });
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const jpeg = (buffer) => ({ ok: true, status: 200, contentType: 'image/jpeg', buffer });
const notFound = () => ({ ok: false, status: 404, contentType: 'text/html', buffer: Buffer.from('not found') });
/** "Titel Wörter Nachname" (a search of title and surname) → [title, surname]. */
const titleAndSurname = (q) => { const w = String(q || '').trim().split(/\s+/); return w.length > 1 ? [w.slice(0, -1).join(' '), w[w.length - 1]] : [w.join(' '), '']; };
const xmlEsc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A cover of its own for the number n: a ground, a band, a disc and lines of "type" in colours of n (BGRA → JPEG). */
function drawCover(n, w, h, nativeImage) {
  const buf = Buffer.alloc(w * h * 4);
  const hue = (k) => [(n >> (k * 3)) & 255, (n >> (k * 5 + 1)) & 255, (n >> (k * 7 + 2)) & 255];
  const ground = hue(1), band = hue(2), disc = hue(3);
  const cx = w * (0.3 + ((n >> 4) % 40) / 100), cy = h * (0.55 + ((n >> 9) % 30) / 100), r = w * (0.25 + ((n >> 13) % 20) / 100);
  // the lines of "type" in proportion to the height: the picture looks the same in every size
  const lp = Math.max(6, Math.round(h / 27)), lt = Math.max(2, Math.round(lp * 0.4));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c = ground;
    if (y < h * 0.14 || (y > h * 0.86 && x > w * 0.2)) c = band;
    else if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) c = disc;
    else if (y > h * 0.2 && y < h * 0.42 && (y % lp) < lt && x > w * 0.1 && x < w * (0.85 - (Math.floor(y / lp) % 3) * 0.12)) c = [250, 246, 236];
    const o = (y * w + x) * 4;
    buf[o] = c[2]; buf[o + 1] = c[1]; buf[o + 2] = c[0]; buf[o + 3] = 255;
  }
  return nativeImage.createFromBitmap(buf, { width: w, height: h }).toJPEG(85);
}

function makeSynth() {
  const { nativeImage } = require('electron');
  // COZYSHELVES_COVERS_SYNTH_DELAY: milliseconds each answer takes (a run that lasts long enough to watch it)
  const delay = +(process.env.COZYSHELVES_COVERS_SYNTH_DELAY || 0);
  return async (url) => {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    let u;
    try { u = new URL(url); } catch { return null; }
    const host = u.hostname;
    if (host === 'openlibrary.org' && u.pathname === '/search.json') {
      const q = u.searchParams.get('q') || u.searchParams.get('isbn') || '';
      const n = hash(q.toLowerCase());
      if (n % 7 === 0 || u.searchParams.get('isbn')) return json({ numFound: 0, start: 0, docs: [] });
      const author = u.searchParams.get('author');
      const lang = u.searchParams.get('lang') === 'de' ? 'ger' : 'eng';
      const cover = 10000000 + (n % 8000000);
      return json({ numFound: 1, start: 0, docs: [{
        key: `/works/OL${n % 10000000}W`, title: q, author_name: author ? [author] : [], cover_i: cover, language: [lang], first_publish_year: 1980 + (n % 40), edition_count: 1 + (n % 5),
        editions: { numFound: 1, start: 0, docs: [{ key: `/books/OL${n % 10000000}M`, title: q, cover_i: cover, language: [lang], publisher: ['Testverlag'], publish_date: [String(1990 + (n % 34))], isbn: [isbnOf(n)] }] },
      }] });
    }
    if (host === 'covers.openlibrary.org') {
      const m = /\/b\/id\/(\d+)-([SML])\.jpg/.exec(u.pathname);
      if (!m) return { ok: false, status: 404, contentType: 'text/html', buffer: Buffer.from('not found') };
      const [w, h] = m[2] === 'L' ? [400, 600] : [180, 270];
      return { ok: true, status: 200, contentType: 'image/jpeg', buffer: drawCover(+m[1], w, h, nativeImage) };
    }
    // Apple Books: the e-book, its artwork named after its ISBN (one title in two)
    if (host === 'itunes.apple.com') {
      const term = u.searchParams.get('term');
      const n = hash('apple ' + String(term || '').toLowerCase());
      if (!term || n % 2) return json({ resultCount: 0, results: [] });
      const [title, author] = titleAndSurname(term);
      return json({ resultCount: 1, results: [{ kind: 'ebook', trackId: n, trackName: title, artistName: author, artworkUrl100: `https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/${n}/${isbnOf(n)}.jpg/100x100bb.jpg`,
        trackViewUrl: 'https://books.apple.com/de/book/id' + n, releaseDate: '2019-03-01T08:00:00Z', description: ' der die das und ist mit ' }] });
    }
    if (/\.mzstatic\.com$/.test(host)) { const m = /\/v4\/(\d+)\//.exec(u.pathname); return m ? jpeg(drawCover(+m[1], 600, 900, nativeImage)) : notFound(); }
    // the DNB: a MARC21 record with author, ISBN, publisher and year (one title in two), the publisher's cover by ISBN
    if (host === 'services.dnb.de') {
      const query = u.searchParams.get('query') || '';
      const m = /^tit=(.+?)(?: and per=(.+))?$/.exec(query);
      const n = hash('dnb ' + query.toLowerCase());
      const empty = '<?xml version="1.0" encoding="UTF-8"?><searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/"><version>1.1</version><numberOfRecords>0</numberOfRecords></searchRetrieveResponse>';
      if (!m || n % 2) return { ok: true, status: 200, contentType: 'application/xml', buffer: Buffer.from(empty) };
      const c008 = '2010101s2020    gw ||||| |||| 00||||'.padEnd(35, '|') + 'ger  ';
      const rec = `<record><recordData><record><leader>00000nam a2200000 c 4500</leader><controlfield tag="001">S${n}</controlfield><controlfield tag="008">${c008}</controlfield>` +
        `<datafield tag="020" ind1=" " ind2=" "><subfield code="a">${isbnOf(n)}</subfield></datafield>` +
        (m[2] ? `<datafield tag="100" ind1="1" ind2=" "><subfield code="a">${xmlEsc(m[2])}</subfield><subfield code="4">aut</subfield></datafield>` : '') +
        `<datafield tag="245" ind1="1" ind2="0"><subfield code="a">${xmlEsc(m[1])}</subfield></datafield><datafield tag="264" ind1=" " ind2="1"><subfield code="b">Testverlag</subfield><subfield code="c">2020</subfield></datafield></record></recordData></record>`;
      return { ok: true, status: 200, contentType: 'application/xml', buffer: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/"><version>1.1</version><numberOfRecords>1</numberOfRecords><records>${rec}</records></searchRetrieveResponse>`) };
    }
    if (host === 'portal.dnb.de') { const isbn = u.searchParams.get('isbn'); return isbn ? jpeg(drawCover(hash('dnbcover ' + isbn), u.searchParams.get('size') ? 200 : 600, u.searchParams.get('size') ? 300 : 900, nativeImage)) : notFound(); }
    // Goodreads: the suggestions of its search box (five titles in six)
    if (host === 'www.goodreads.com' && u.pathname === '/book/auto_complete') {
      const q = u.searchParams.get('q') || '';
      const n = hash('gr ' + q.toLowerCase());
      if (n % 6 === 0 || /^\d{10,13}$|^B0/.test(q)) return json([]);
      // asked with the title alone: the made-up record names no author (a long title is enough to be sure)
      return json([{ bookId: String(n), title: q, bookTitleBare: q, author: { name: '' }, imageUrl: `https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1i/${n}._SY75_.jpg` }]);
    }
    if (host === 'i.gr-assets.com') { const m = /\/books\/1i\/(\d+)(\._SY(\d+)_)?\.jpg$/.exec(u.pathname); if (!m) return notFound(); const h = m[3] ? +m[3] : 600; return jpeg(drawCover(+m[1], Math.round((h * 2) / 3), h, nativeImage)); }
    // the Internet Archive: a copy of the book (one title in three), its scanned cover
    if (host === 'archive.org' && u.pathname === '/advancedsearch.php') {
      const q = u.searchParams.get('q') || '';
      const t = /title:\(([^)]*)\)/.exec(q), c = /creator:\(([^)]*)\)/.exec(q);
      const n = hash('ia ' + q.toLowerCase());
      if (!t || n % 3) return json({ response: { numFound: 0, docs: [] } });
      return json({ response: { numFound: 1, docs: [{ identifier: 'synth' + n, title: t[1], creator: c ? [c[1]] : [], language: 'ger', date: '2015-01-01T00:00:00Z', mediatype: 'texts' }] } });
    }
    if (host === 'archive.org') {
      const m = /\/(?:download|services\/img)\/synth(\d+)/.exec(u.pathname);
      if (!m) return notFound();
      return jpeg(/services\/img/.test(u.pathname) ? drawCover(+m[1], 180, 270, nativeImage) : drawCover(+m[1], 600, 900, nativeImage));
    }
    // Amazon: the picture of an ISBN-10 or ASIN (three in four), else its 1 × 1 GIF
    if (host === 'm.media-amazon.com') {
      const m = /\/images\/P\/([0-9A-Z]{10})\./.exec(u.pathname);
      if (!m || hash('amz ' + m[1]) % 4 === 0) return { ok: true, status: 200, contentType: 'image/gif', buffer: Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64') };
      return jpeg(drawCover(hash('amz ' + m[1]), 316, 500, nativeImage));
    }
    if (host === 'www.googleapis.com') return { ok: false, status: 429, contentType: 'application/json', buffer: Buffer.from(JSON.stringify({ error: { code: 429, message: "Quota exceeded for quota metric 'Queries' and limit 'Queries per day'", status: 'RESOURCE_EXHAUSTED' } })) };
    // Bing's image search: two shops show the book's picture (three in four titles), a blog another one
    if (host === 'www.bing.com' && u.pathname === '/images/async') {
      const q = u.searchParams.get('q') || '';
      const n = hash('bing ' + q.toLowerCase());
      if (n % 4 === 0) return html('<ul class="dgControl_list"></ul>');
      const results = [[n, 'https://www.buchhandlung.example/'], [n, 'https://www.verlag.example/'], [(n ^ 0x5a5a5a) >>> 0, 'https://www.blog.example/']];
      return html('<ul class="dgControl_list">' + results.map(([k, site], i) => `<li><a class="iusc" m="${esc(JSON.stringify({ purl: site + 'buch/' + n, murl: site + 'bilder/' + k + '.jpg', turl: `https://ts${i + 1}.mm.bing.net/th?id=OIP.S${k}-${i}&pid=15.1`, t: q }))}" href="#"></a><span class="nowrap">600 × 900</span></li>`).join('') + '</ul>');
    }
    if (/\.mm\.bing\.net$/.test(host) && u.pathname === '/th') {
      const m = /^OIP\.S(\d+)-/.exec(u.searchParams.get('id') || '');
      if (!m) return null;
      const h = Math.min(900, +(u.searchParams.get('h') || 300));
      return { ok: true, status: 200, contentType: 'image/jpeg', buffer: drawCover(+m[1], Math.round((h * 2) / 3), h, nativeImage) };
    }
    return null;
  };
}

module.exports = { makeSynth, drawCover, isbnOf };
